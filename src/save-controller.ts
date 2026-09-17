// 保存链路（手动保存 / 冲突恢复 / 外部修改处置 / 自动保存 / 崩溃备份）的唯一持有者。
// M127 从 main.ts 抽出：main.ts 收敛为装配层，本模块持有全部保存相关状态与决策。
//
// 状态边界（M149 多标签后按**路径**键控）：每个打开文档的 path / revision / 在途标记 /
// 自动保存暂停原因都在这里，键是 vault 相对路径。main.ts 不再自行维护副本，只经
// displayedPath()（前台标签的路径）、beginSwitch()、noteOpened()、noteVaultReset()、
// vaultSwitchBlock() / saveAllDirty()（切换 vault 的前置判据与「保存并切换」出口，M163
// 起提示与三动作由装配层在拦下它的地方给出）与本模块交互。
//
// 为什么从「当前展示文档」升级成「按路径」（M149）：多标签下「当前展示的文档」不再唯一，
// 自动保存的 debounce 必须逐标签独立——旧实现只有一个 reconcileTimer，切标签会把待写的
// 定时器带到新文档上（把 A 的内容写进 B 的路径，静默数据损坏）。逐路径键控同时给出
// 「后台标签被外部修改也要如实处置」的能力（旧实现只查 displayedPath，多标签会漏报）。
//
// 自动保存与 dogfood 场景（Lumir ↔ Obsidian 来回）：存在未解决冲突、外部修改待决或
// 保存目标已被外部删除时，自动保存 MUST 暂停（不硬冲 CAS），dirty 内容改走崩溃备份；
// 暂停态由成功的保存或重新载入清除。

import type { FsChangeKind } from "./bindings/FsChangeKind";
import { logEvent } from "./diagnostics";
import type { EditorHandle } from "./editor";
import {
  documentSave,
  errorMessage,
  fsReadSnapshot,
  isCommandError,
  recoveryBackup,
  recoveryBaseRevision,
  recoveryDiscard,
  recoveryLoad,
  recoveryList,
  wikilinkCreate,
} from "./ipc";

/** dirty 守卫提示（无法切换 / 无法退出）的标识类：dirty 清除时整批撤下。 */
export const SAVE_GUARD_TOAST_CLASS = "toast-dirty-guard";

/** 自动保存 debounce：停止输入后 2s。**停止输入**是语义关键——每次文档变化重置，
 * 连续打字期间不落盘（避免半句内容触发一串 CAS 写入）；2s 是「短暂停顿不打扰、
 * 长停顿已落盘」的折中。M149 起每个标签各有一份该定时器，互不重置。 */
export const AUTOSAVE_DEBOUNCE_MS = 2000;

/** 备份元数据里没有 CAS 基准（老格式备份 / 元数据读取失败）时用的哨兵：它不等于
 *  任何磁盘 revision，随后的保存必定按 CAS 报冲突，用户必须显式处置——宁可多一次
 *  冲突提示，也不静默覆盖磁盘上可能较新的版本。 */
const UNKNOWN_BASE_REVISION = "recovery-unknown-base";

/** 打开文件的落点意图（M149 多标签）。装配层（main.ts 的 openFile）据此决定内容落到
 *  哪个标签上；本模块只在「另存为新文件」与「恢复崩溃备份」两条链路上指定它——那两条
 *  都是「当前这份文档换个落点」的语义，必须就地替换前台标签，不能另开一个。 */
export type OpenIntent =
  /** 就地替换当前标签的文档（跟随链接、另存为新文件、恢复备份）。 */
  | "current"
  /** 复用可复用标签（单击文件树的默认语义）；没有可复用的就新建一个临时标签。 */
  | "preview"
  /** 新建固定标签（⌘-点击 / 双击文件树）。 */
  | "pinned";

export interface ToastAction {
  label: string;
  run(): void;
}

export type ToastFn = (text: string, actions?: ToastAction[], sticky?: boolean) => HTMLElement;

/** 切换 vault 的 dirty 前置判据（M149 判据，M163 起只给判据、不给提示）。 */
export interface VaultSwitchBlock {
  /** 有未保存修改的标签数（判据：任一**有路径**的标签 dirty）。 */
  dirtyCount: number;
  /** 这些脏标签里是否有**不可保存**的（非 md / 未登记 CAS 基准）——有则「保存并切换」
   *  这条出口给不出来（走不通的建议不给，change task 4.2）。 */
  hasUnsaveable: boolean;
}

export interface SaveControllerDeps {
  editor: EditorHandle;
  /** toast 挂载点（守卫提示的整批撤下要按 DOM 查询）。 */
  container: HTMLElement;
  toast: ToastFn;
  /** 另存为新文件 / 恢复备份后切换打开（main 的 openFile：含模式裁决与树/标签同步）。
   *  intent 为 "current"：两条链路都是「当前文档换个落点」，必须就地替换前台标签。 */
  openFile: (path: string, kind: "md" | "code" | "text" | "binary", intent?: OpenIntent) => Promise<void>;
  /** wikilink 解析缓存整批失效（内容/来源已换）。 */
  invalidateResolve: () => void;
  /** 撤下「暂不支持预览」覆盖层（重载成功后）。 */
  showEditor: () => void;
  /** 覆盖层是否处于隐藏（普通编辑态）；覆盖层在场时不重载文档。 */
  isNoticeHidden: () => boolean;
}

export interface SaveController {
  /** 前台标签的 vault 相对路径；未打开文件为 undefined。 */
  displayedPath(): string | undefined;
  /** 前台文档的 dirty 守卫；返回 false 时已给出人话提示。用于「就地替换前台标签」
   *  这一类会丢内容的动作（当前唯一调用点是打开文件时前台是未命名文档的情形）。 */
  guard(action: string): boolean;
  /** 切换 vault 的 dirty 前置判据（M149 判据原样，M163 起调用形态变了）：**任一**标签有
   *  未保存修改就拦下——切 vault 会把全部标签一起作废。返回被拦下的信息（脏标签数 +
   *  是否含不可保存的脏标签）；无脏标签返回 null。
   *
   *  本函数**不弹提示**：切 vault 是用户主动发起的整窗换上下文动作，提示与出口（保存并
   *  切换 / 放弃修改并切换 / 取消）必须摆在拦下它的地方，由调用方（装配层的切换流程）
   *  给出。这里只回答「能不能切」以及「规模有多大」。 */
  vaultSwitchBlock(): VaultSwitchBlock | null;
  /** 保存**全部**可保存的脏标签（切换的「保存并切换」出口用；手动 ⌘S 只存前台那一个）。
   *  返回「是否已无脏标签」：有任一条没闭环（冲突 / 写失败 / 无落盘基准）即 false，调用方
   *  据此**不**继续切换（change task 4.2）。每条失败的提示与出口由保存链路自己给出。 */
  saveAllDirty(): Promise<boolean>;
  /** 打开新文档前调用：世代自增、清空上一文档的暂停态与定时器。返回的世代号
   * 兼作 editor 装载的 requestId（原 fileRequest 与 documentGeneration
   * 恒同增同减，合并为一个计数器）。 */
  beginSwitch(): number;
  isCurrent(serial: number): boolean;
  /** 读快照成功后登记某个文档的磁盘 revision（CAS 基准）。非 md 传 undefined——
   *  该文档随后不可保存，见 saveBaseline。 */
  noteOpened(path: string, revision: string | undefined): void;
  /** vault 装载 / 复位：清空全部文档的展示状态、世代自增、撤下暂停态、定时器与恢复提示。 */
  noteVaultReset(): void;
  /** 手动保存（Cmd+S）：只存**前台**标签；当前文档不可保存而又有修改时必须给出可见
   *  反馈，MUST NOT 静默。 */
  save(): Promise<void>;
  /** watch 命中已打开文档的处置（M124 分流 + M127 暂停自动保存 + M149 按路径）。 */
  handleExternalChange(path: string, kind: FsChangeKind): void;
  /** dirty 清除时整批撤下守卫提示（保存成功 / 重载）。 */
  clearGuardToasts(): void;
  /** 退出/关窗被 dirty 守卫拦截的提示（sticky，属守卫提示族）。 */
  showQuitBlocked(): void;
  /** vault 装载后检查残留崩溃备份并给恢复入口。 */
  checkRecovery(): Promise<void>;
}

// 保存失败的界面反馈（M101 验收修复）：冲突 / 写入失败 / 结果未知都必须给出
// 可理解的提示并说明修改仍保留在内存，不得静默或只剩技术化 message。
// 冲突与「文件已被外部删除」另有带动作的恢复提示（M124），此处文案是两路共用的
// 兜底与人话化映射。
const SAVE_ERROR_HINTS: Record<string, string> = {
  document_conflict: "保存冲突：文件在磁盘上已被外部修改，内存中的修改未丢失",
  document_write_failed: "保存失败：无法写入文档，内存中的修改未丢失",
  document_write_unknown: "保存结果未知：写入可能未生效，请核对文件内容，内存中的修改未丢失",
  fs_not_found: "保存失败：文件已被外部删除或移动，内存中的修改未丢失",
};

export function createSaveController(deps: SaveControllerDeps): SaveController {
  const { editor, toast } = deps;

  /** 文件打开世代号：兼作装载事务的 requestId（main 的 openFile 用它丢弃迟到的快照）。
   *  保存链路**不用**它做失效判据——判据是「目标路径的标签是否还在」（见 saveDocument），
   *  否则开一个新标签会把另一个标签在途的自动保存结果误丢。 */
  let serial = 0;
  /** path → 磁盘 revision（CAS 基准）。非 md 文档登记 undefined。 */
  const revisions = new Map<string, string | undefined>();
  /** 在途保存的路径（原先是单文档的 saveInFlight 布尔）。 */
  const saving = new Set<string>();
  /** 自动保存暂停原因，按路径：path → {conflict|external|not-found}。任一在场即不自动保存。 */
  const paused = new Map<string, Set<string>>();
  /** 自动保存 debounce 定时器，按路径（M149：逐标签独立，切标签不互相重置）。 */
  const timers = new Map<string, number>();
  /** 崩溃备份恢复提示的浮条（换 vault 时整批撤下，避免提示指向旧 vault）。 */
  const recoveryPrompts = new Set<HTMLElement>();

  // ---------------------------------------------------------------------------
  // 按路径的会话访问（保存链路的全部「这是哪份文档」判定都经这里）
  // ---------------------------------------------------------------------------

  function sessionOf(path: string) {
    return editor.sessionForPath(path);
  }

  function contentOf(path: string): string | null {
    const session = sessionOf(path);
    return session === undefined ? null : session.state.doc.toString();
  }

  function isDirty(path: string): boolean {
    return sessionOf(path)?.dirty ?? false;
  }

  /** 暂停自动保存 + 诊断埋点：只在**跃迁**（该路径从无暂停原因到有）时记一条，
   *  否则暂停期间每 2s 一次 reconcile 会把日志灌满。 */
  function pauseAutosave(path: string, reason: string): void {
    const reasons = paused.get(path) ?? new Set<string>();
    const transition = reasons.size === 0;
    reasons.add(reason);
    paused.set(path, reasons);
    if (transition) logEvent("autosave_paused", { path, reason });
  }

  /** 暂停态解除（同一文档重新可自动保存）+ 诊断埋点。文档切换 / vault 复位经
   *  forget 清空暂停集合时**不记**：那是「上一份文档的处置随文档一起作废」，不是自动
   *  保存恢复——记成 resumed 会误导读日志的人。 */
  function resumeAutosave(path: string, reason: string): void {
    const reasons = paused.get(path);
    if (reasons === undefined) return;
    paused.delete(path);
    if (reasons.size > 0) logEvent("autosave_resumed", { path, reason });
  }

  function saveErrorMessage(e: unknown): string {
    if (isCommandError(e)) return SAVE_ERROR_HINTS[e.code] ?? `保存失败：${e.message}`;
    return `保存失败：${errorMessage(e)}`;
  }

  function cancelReconcile(path: string): void {
    const timer = timers.get(path);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    timers.delete(path);
  }

  function cancelScheduledState(path: string): void {
    // 直接删而不过 resumeAutosave：这里的解除是「上一份文档的处置随文档一起作废」
    //（切文件 / 切 vault），不是自动保存对当前文档恢复可用，不该记 resumed。
    paused.delete(path);
    cancelReconcile(path);
  }

  // ---------------------------------------------------------------------------
  // 文档切换与展示状态
  // ---------------------------------------------------------------------------

  function displayedPath(): string | undefined {
    return editor.activeSession().path;
  }

  /** 前台文档的落盘基准（CAS 用 revision）；不可保存返回 null——非 md 是只读 code 模式
   *（M130 方向 A），无 revision 表示没有基准（非 md 未登记，或 md 尚未读到快照），
   *  两者写回去都会失败或无从校验。 */
  function saveBaseline(path: string): string | null {
    const session = sessionOf(path);
    if (session === undefined || session.mode !== "md") return null;
    return revisions.get(path) ?? null;
  }

  /** 前台文档的 dirty 守卫（M130 语义不变）。用于「就地替换前台标签」这一类会丢内容的
   *  动作——当前唯一调用点是打开文件时前台是**未命名文档**：它没有路径，内容只活在内存
   *  里，被复用掉就等于丢弃；有文件路径的前台标签之间是标签切换，不丢内容，因此不设守卫。
   *
   *  无落盘基准的 dirty（未打开文件 / 非 md / 未登记 revision，M130）不能沿用
   *  「请先保存（Cmd+S）」——那是一条走不通的建议；改指撤销修改，给出真正的出口。 */
  function guard(action: string): boolean {
    const path = displayedPath();
    if (path === undefined) {
      if (!editor.isDirty()) return true;
      toast(`当前文档不支持保存，无法${action}；请按 Cmd+Z 撤销修改`)
        .classList.add(SAVE_GUARD_TOAST_CLASS);
      return false;
    }
    if (!isDirty(path)) return true;
    const blocked = saveBaseline(path) === null
      ? `当前文档不支持保存，无法${action}；请按 Cmd+Z 撤销修改`
      : `当前 Markdown 有未保存修改，无法${action}；请先保存（Cmd+S）`;
    toast(blocked).classList.add(SAVE_GUARD_TOAST_CLASS);
    return false;
  }

  /** 切换 vault 的守卫判据（M149 判据不变，M163 起**只给判据不弹提示**）：任一有路径的
   *  标签 dirty 即拦下。切 vault 会把全部标签一起作废，所以判据是全体——旧实现只有一个
   *  文档，两者等价。
   *
   *  旧实现（M149–M162）在这里自己弹一句点名单个脏标签的 sticky 提示；M163 把提示与出口
   *  移到拦下它的地方（切换流程的三动作，见装配层的 guardVaultSwitch），因为「哪些标签脏」
   *  已由标签栏逐标签的 dirty 点承担（D90），而这一句要回答的是「损失规模」——判据是全体
   *  标签，数量才是全体视角的信息。两条旧提示串随之退场，不再有消费者。 */
  function vaultSwitchBlock(): VaultSwitchBlock | null {
    const dirty = editor
      .sessions()
      .filter((session) => session.path !== undefined && session.dirty);
    if (dirty.length === 0) return null;
    return {
      dirtyCount: dirty.length,
      hasUnsaveable: dirty.some((session) => saveBaseline(session.path as string) === null),
    };
  }

  function beginSwitch(): number {
    return ++serial;
  }

  function noteOpened(path: string, revision: string | undefined): void {
    revisions.set(path, revision);
    cancelScheduledState(path);
  }

  function noteVaultReset(): void {
    ++serial;
    revisions.clear();
    saving.clear();
    paused.clear();
    for (const timer of timers.values()) window.clearTimeout(timer);
    timers.clear();
    removeRecoveryPrompts();
  }

  function clearGuardToasts(): void {
    deps.container.querySelectorAll(`.${SAVE_GUARD_TOAST_CLASS}`).forEach((el) => el.remove());
  }

  function showQuitBlocked(): void {
    toast("当前有未保存修改，无法退出；请先保存（Cmd+S）", undefined, true)
      .classList.add(SAVE_GUARD_TOAST_CLASS);
  }

  // ---------------------------------------------------------------------------
  // 保存：手动 / 自动共用同一条链路（dirty 清除语义与失败处置完全一致）
  // ---------------------------------------------------------------------------

  /** 手动 Cmd+S 不可达时的人话反馈（M130 兜底）：dirty 却无法保存时 MUST NOT 静默
   *  return——dirty 会锁死切换文件 / 切换 vault / 退出，静默失败把用户困在「提示让他
   *  按 Cmd+S，而 Cmd+S 无效」的死态。提示必须给出脱离 dirty 的动作（Cmd+Z 撤销）。
   *  两种成因文案不同，按前台文档有没有路径分：没有路径（空态 / 新建文档）说明「修改
   *  仍在编辑器内」，有路径（非 md，M130 方向 A）说明「只保存 Markdown」这条能力边界。
   *  自动保存路径不调用本函数（每 2s 一次会砸提示），其跳过口径见 reconcile。 */
  function reportUnsaveable(path: string | undefined): void {
    toast(
      path === undefined
        ? "当前没有打开的文件，无法保存；修改仍在编辑器内（按 Cmd+Z 可撤销）"
        : "当前文件不支持保存：Lumir 只保存 Markdown 文件；修改仍在编辑器内（按 Cmd+Z 可撤销）",
    ).classList.add(SAVE_GUARD_TOAST_CLASS);
  }

  /** toasts 里点名的文档：多标签下每条保存侧提示都必须说清「是哪一份」，
   *  否则用户看到「检测到外部修改」不知道说的是哪个标签（M149）。 */
  function nameOf(path: string): string {
    return `「${path}」`;
  }

  /** 保存指定文档；返回「内存内容是否已完全落盘（dirty 已清除）」。 */
  async function saveDocument(auto: boolean, path: string): Promise<boolean> {
    const expectedRevision = saveBaseline(path);
    if (expectedRevision === null) {
      if (!auto && isDirty(path)) reportUnsaveable(path);
      return false;
    }
    if (saving.has(path) || !isDirty(path)) return false;
    const content = contentOf(path);
    if (content === null) return false;
    saving.add(path);
    try {
      const revision = await documentSave(path, expectedRevision, content);
      // 目标标签在写入期间被关掉（或 vault 被切走）：结果丢弃——内存里已经没有这份
      // 文档可以对齐了。**不**用世代号判据：开一个新标签不该让别的标签的在途保存作废。
      if (sessionOf(path) === undefined) return false;
      revisions.set(path, revision);
      if (contentOf(path) === content) {
        editor.markCleanOf(path, content);
        resumeAutosave(path, "saved"); // 已与磁盘同步：冲突/外部修改待决状态一并解除
        void recoveryDiscard(path).catch(() => {}); // 保存成功即清除崩溃备份
        toast(auto ? "已自动保存" : "已保存");
        return true;
      }
      toast(auto ? "已自动保存当前快照，仍有未保存修改" : "已保存当前快照，仍有未保存修改");
      return false;
    } catch (e) {
      if (isCommandError(e) && e.code === "document_conflict") {
        // CAS 失败：重试必败（revision 已变），纯文案会把用户修改锁死在内存——
        // dirtyGuard 与退出守卫又堵死切换/退出，必须给逃生口（M124）。
        pauseAutosave(path, "conflict");
        showConflictPrompt(path);
      } else if (isCommandError(e) && e.code === "fs_not_found") {
        pauseAutosave(path, "not-found");
        showNotFoundPrompt(path);
      } else {
        toast(saveErrorWithPath(e, path));
      }
      return false;
    } finally {
      saving.delete(path);
    }
  }

  /** 保存失败的提示在多标签下必须点名文档：否则「保存失败」不知道是哪个标签。 */
  function saveErrorWithPath(e: unknown, path: string): string {
    return `${nameOf(path)}${saveErrorMessage(e)}`;
  }

  /** 保存**全部**脏标签（切换 vault 的「保存并切换」出口用）。顺序保存、逐条独立：一条
   *  失败不打断其余标签的保存（用户希望的是「尽量都存下来」）；最后再判一次是否还有脏标签，
   *  只要有一条没闭环（冲突 / 写失败 / 无落盘基准）就返回 false——调用方据此不继续切换。
   *  失败提示与出口由 saveDocument 给出（冲突与「已被外部删除」都带动作），不在这里再造一套。 */
  async function saveAllDirty(): Promise<boolean> {
    for (const session of editor.sessions()) {
      const path = session.path;
      if (path === undefined || !session.dirty) continue;
      await saveDocument(false, path);
    }
    return !editor.sessions().some((session) => session.path !== undefined && session.dirty);
  }

  /** 保存冲突的恢复提示：两个动作分别对应「放弃本地」与「覆盖磁盘」。sticky：
   *  冲突在用户处置前不得自动消隐。 */
  function showConflictPrompt(path: string): void {
    toast(
      `${nameOf(path)}${SAVE_ERROR_HINTS.document_conflict}`,
      [
        { label: "重新载入（放弃我的修改）", run: () => void discardAndReload(path) },
        { label: "强制覆盖保存", run: () => void showForceSaveConfirm(path) },
      ],
      true,
    );
  }

  /** 强制覆盖的二次确认：文案必须明示将覆盖磁盘上较新的内容（M124 裁决）。 */
  function showForceSaveConfirm(path: string): void {
    toast(
      `将覆盖磁盘上较新的内容，此操作不可撤销。确认强制覆盖保存「${path}」？`,
      [
        { label: "覆盖保存", run: () => void forceSaveCurrentFile(path) },
        { label: "取消", run: () => {} },
      ],
      true,
    );
  }

  /** 强制覆盖保存：先拉取磁盘当前 revision 作为新的 CAS 基准再写入（经既有
   * fsReadSnapshot 封装，revision 与 fs_file_revision 同 sha256 原文口径）。
   * 拉取与写入之间再有外部修改则仍报冲突——同样升级为带动作的恢复提示
   *（M127：不再退化为自动消隐的纯文案 toast，用户可重试或放弃本地）。 */
  async function forceSaveCurrentFile(path: string): Promise<void> {
    if (saving.has(path) || sessionOf(path) === undefined || saveBaseline(path) === null) return;
    const content = contentOf(path);
    if (content === null) return;
    saving.add(path);
    try {
      const snapshot = await fsReadSnapshot(path);
      if (sessionOf(path) === undefined) return;
      const revision = await documentSave(path, snapshot.revision, content);
      revisions.set(path, revision);
      if (contentOf(path) === content) {
        editor.markCleanOf(path, content);
        resumeAutosave(path, "force_saved");
        void recoveryDiscard(path).catch(() => {});
        toast("已强制覆盖保存");
      } else {
        toast("已强制覆盖保存当前快照，仍有未保存修改");
      }
    } catch (e) {
      if (isCommandError(e) && e.code === "document_conflict") {
        pauseAutosave(path, "conflict");
        showConflictPrompt(path);
      } else if (isCommandError(e) && e.code === "fs_not_found") {
        // 冲突处置期间文件又被外部删除：同样走另存出口。
        pauseAutosave(path, "not-found");
        showNotFoundPrompt(path);
      } else {
        toast(saveErrorWithPath(e, path));
      }
    } finally {
      saving.delete(path);
    }
  }

  /** 保存目标已被外部删除：内存修改是最后副本，给出另存入口（M124）。 */
  function showNotFoundPrompt(path: string): void {
    toast(`${nameOf(path)}${SAVE_ERROR_HINTS.fs_not_found}`, [
      { label: "另存为新文件", run: () => void saveAsNewFile(path) },
    ], true);
  }

  /** 另存为新文件：经 wikilink_create（后端 create_note，O_EXCL 语义不覆盖既有
   * 文件）在同目录建「原名-恢复.md」，把内存内容写入后切过去；撞名自动加序号
   * 重试（-2..-5，见 spec fs-io 的崩溃恢复 requirement）。
   *
   *  M149：就地替换前台标签（intent "current"）——另存的对象就是当前这份文档，
   *  原路径已被外部删除，没有理由为它再留一个标签。 */
  async function saveAsNewFile(fromPath: string): Promise<void> {
    const stem = fromPath.slice(fromPath.lastIndexOf("/") + 1).replace(/\.(md|markdown)$/i, "");
    const content = contentOf(fromPath);
    if (content === null) return;
    for (const suffix of ["", "-2", "-3", "-4", "-5"]) {
      try {
        const { created } = await wikilinkCreate(fromPath, `[[${stem}-恢复${suffix}]]`);
        const snapshot = await fsReadSnapshot(created); // 空文件 revision 作 CAS 基准
        await documentSave(created, snapshot.revision, content);
        // 缓冲内容已落到新文件，本地 dirty 处置完毕——否则随后的就地替换会把
        // 新文件标成「已修改」或让旧标签停在已删除文件上。
        editor.markCleanOf(fromPath, content);
        resumeAutosave(fromPath, "saved_as_new");
        // 旧路径的备份随内容迁走（旧文件已被外部删除，其备份不再可恢复）。
        void recoveryDiscard(fromPath).catch(() => {});
        await deps.openFile(created, "md", "current");
        toast(`已另存为：${created}`);
        return;
      } catch (e) {
        if (isCommandError(e) && e.code === "wikilink_target_exists") continue;
        toast(errorMessage(e));
        return;
      }
    }
    toast("另存为新文件失败：同名文件已存在，请手动导出");
  }

  // ---------------------------------------------------------------------------
  // 重新载入：冲突放弃与 watch 外部修改共用
  // ---------------------------------------------------------------------------

  /** 重载指定文档：读快照 → 写进该路径的标签 → 对齐 revision，不走 dirtyGuard——
   *  调用方自行承担处置语义（冲突放弃 / watch 外部修改）。
   *  onlyIfChanged：revision 未变即跳过（自身保存也触发 watch Modified，避免每次
   *  保存后重载闪烁、光标复位）；应用前发现用户已开始输入（dirty）也放弃。
   *
   *  M149：目标可以是**后台标签**（多标签下外部修改会命中非前台文档）。后台标签的就地
   *  换代由 editor.reloadSession 完成，不抢前台、不重置用户正在看的那一份的滚动位置。 */
  async function reloadDocument(
    path: string,
    opts: { onlyIfChanged?: boolean } = {},
  ): Promise<boolean> {
    if (sessionOf(path) === undefined || saveBaseline(path) === null) return false;
    // 覆盖层（暂不支持预览 / 读取错误）在场时前台文档不在编辑态，重载会把它藏起来。
    // 只对前台标签适用：后台标签不受覆盖层影响。
    if (path === displayedPath() && !deps.isNoticeHidden()) return false;
    const request = serial;
    try {
      const snapshot = await fsReadSnapshot(path);
      if (request !== serial || sessionOf(path) === undefined) return false;
      if (opts.onlyIfChanged && (snapshot.revision === revisions.get(path) || isDirty(path))) {
        return false;
      }
      if (saveBaseline(path) === null) return false;
      revisions.set(path, snapshot.revision);
      deps.invalidateResolve(); // from 未变，但内容已换，按 from 键控的缓存整批失效
      const session = sessionOf(path);
      if (session === undefined) return false;
      editor.reloadSession(session, snapshot.content, path, request);
      if (path === displayedPath()) deps.showEditor();
      return true;
    } catch (e) {
      if (request !== serial) return false;
      toast(errorMessage(e));
      return false;
    }
  }

  /** 重新载入（放弃我的修改）：冲突处置与 watch 重载共用的入口，给出完成反馈。 */
  async function discardAndReload(path: string): Promise<void> {
    if (await reloadDocument(path)) {
      resumeAutosave(path, "reloaded"); // 内容已回到磁盘版本，暂停态随冲突一并解除
      toast(`${nameOf(path)}已重新载入磁盘内容`);
    }
  }

  // ---------------------------------------------------------------------------
  // watch 命中已打开文档
  // ---------------------------------------------------------------------------

  /** 分流（M124 + M127 + M149）：保存进行中的批次跳过——自身保存也产生事件，由
   *  reloadDocument 的 revision 比对丢弃；外部删除无法重载，只提示内容仍保留；
   *  dirty 时把选择权交给用户（sticky 浮条而非 modal，不打断打字）；未 dirty 自动
   *  重载并提示。仅 md 模式：展示中的 md 才有内存修改可丢失。
   *  M127：dirty 分流一律暂停自动保存——磁盘已有更新版本，自动保存不能硬冲 CAS。
   *  M149：判据与提示一律带路径——多标签下同一个浮条区要能说清是哪一份文档，
   *  且**后台标签同样处置**（旧实现只查 displayedPath，后台标签的变更会漏报）。 */
  function handleExternalChange(path: string, kind: FsChangeKind): void {
    if (saving.has(path) || sessionOf(path) === undefined) return;
    if (kind === "deleted") {
      logExternalChange(path, kind);
      pauseAutosave(path, "not-found");
      toast(`${nameOf(path)}当前文件已被外部删除；编辑器中的内容未丢失`, [], true);
      return;
    }
    if (isDirty(path)) {
      logExternalChange(path, kind);
      pauseAutosave(path, "external");
      toast(
        `检测到外部修改：${nameOf(path)}`,
        [
          { label: "重载（放弃我的修改）", run: () => void discardAndReload(path) },
          { label: "保留我的版本", run: () => {} },
        ],
        true,
      );
    } else {
      void reloadDocument(path, { onlyIfChanged: true }).then((reloaded) => {
        if (!reloaded) return; // 回声：revision 与本次保存的结果一致，磁盘没有变化
        logExternalChange(path, kind);
        toast(`${nameOf(path)}检测到外部修改，已自动重载`);
      });
    }
  }

  /** 诊断埋点：外部修改命中**已打开的文档**。Rust 的 watch 流给的是全 vault 变更，
   *  「命中打开中的文档且不是自身保存」这个判定只有前端有（revision 链在前端），
   *  所以这一条由前端经 log_event 转发，而不是在 Rust 侧记全量文件变更
   *  （那会淹没真正的摩擦信号）。 */
  function logExternalChange(path: string, kind: FsChangeKind): void {
    logEvent("save_external_change", { path, change: kind });
  }

  // ---------------------------------------------------------------------------
  // 自动保存（停止输入 debounce）+ 崩溃备份
  // ---------------------------------------------------------------------------

  function onDocChanged(path: string | undefined): void {
    if (path === undefined || !isDirty(path)) return; // 装载/复位导致的文档替换不排期
    cancelReconcile(path);
    timers.set(path, window.setTimeout(() => {
      timers.delete(path);
      void reconcile(path);
    }, AUTOSAVE_DEBOUNCE_MS));
  }

  /** debounce 到期：自动保存一次；无法保存（暂停 / 未完全落盘）时把 dirty 内容
   * 落崩溃备份——进程崩溃 / 强杀后下次启动仍有内容可恢复。
   * 无落盘基准（saveBaseline 为 null：非 md / 未登记 revision）直接返回：这类内容
   * 没有任何保存路径能写回磁盘，备份只会在下次启动弹出一个无法闭环的恢复提示。 */
  async function reconcile(path: string): Promise<void> {
    if (saveBaseline(path) === null || !isDirty(path)) return;
    if ((paused.get(path)?.size ?? 0) > 0 || saving.has(path)) {
      await backupDirty(path);
      return;
    }
    if (!(await saveDocument(true, path))) await backupDirty(path);
  }

  /** 崩溃备份：写失败 / 无后端（纯浏览器预览桩）只作罢，不打断编辑。
   *  基准 revision 取编辑器已知的磁盘 revision（saveBaseline 保证非 null），它是
   *  恢复侧判定「备份之后磁盘是否被外部修改」的唯一依据。
   *
   *  M130 显式跳过无落盘基准的 dirty 内容（非 md / 未登记 revision）：备份的唯一用途
   *  是经恢复入口把内容写回磁盘，而写回必须走保存链路（要求 md 模式 + CAS 基准）——
   *  为这类内容写备份只会留下一个无法闭环的恢复提示。这是显式裁决，不是「静默没有
   *  备份」：决策记录见 openspec change non-md-readonly-open。 */
  async function backupDirty(path: string): Promise<void> {
    const revision = saveBaseline(path);
    const content = contentOf(path);
    if (!isDirty(path) || revision === null || content === null) return;
    await recoveryBackup(path, content, revision).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // 崩溃备份恢复入口（vault 装载后）
  // ---------------------------------------------------------------------------

  function removeRecoveryPrompts(): void {
    for (const el of recoveryPrompts) el.remove();
    recoveryPrompts.clear();
  }

  async function checkRecovery(): Promise<void> {
    removeRecoveryPrompts();
    let pending: string[];
    try {
      pending = await recoveryList();
    } catch {
      return; // 无后端（预览桩）/ vault 未打开：静默
    }
    for (const path of pending) showRecoveryPrompt(path);
  }

  /** 残留备份提示：sticky（不得在用户看到前消隐），两个动作各自闭环。 */
  function showRecoveryPrompt(path: string): void {
    const el = toast(
      `发现未保存的崩溃备份：${path}`,
      [
        { label: "恢复内容", run: () => void restoreBackup(path) },
        { label: "丢弃备份", run: () => void discardBackup(path) },
      ],
      true,
    );
    recoveryPrompts.add(el);
  }

  /** 恢复：把备份记录的 revision 作为保存基准（MUST NOT 吸收恢复时刻的磁盘
   *  revision，见 spec「恢复不静默覆盖磁盘」），再把备份内容放进编辑器缓冲并保持
   *  dirty——仍走保存链路：备份之后磁盘若被外部修改，随后的保存按 CAS 报冲突，
   *  绝不静默覆盖较新的磁盘版本。
   *
   *  M149：就地替换前台标签（intent "current"）——恢复出来的内容要落在用户面前，
   *  而不是另开一个内容相同、路径相同的第二个标签。 */
  async function restoreBackup(path: string): Promise<void> {
    let content: string | null;
    let baseRevision: string | null;
    try {
      content = await recoveryLoad(path);
      if (content === null) {
        toast("崩溃备份已不存在");
        return;
      }
      baseRevision = await recoveryBaseRevision(path).catch(() => null);
    } catch (e) {
      toast(errorMessage(e));
      return;
    }
    await deps.openFile(path, "md", "current");
    const session = sessionOf(path);
    if (session === undefined || saveBaseline(path) === null) return; // 切换被守卫拦下 / 未装载
    revisions.set(path, baseRevision ?? UNKNOWN_BASE_REVISION);
    if (session !== editor.activeSession()) editor.activateSession(session);
    const target = editor.view.state;
    editor.view.dispatch({
      changes: { from: 0, to: target.doc.length, insert: content },
    });
    toast("已恢复未保存内容，请保存（Cmd+S）");
  }

  async function discardBackup(path: string): Promise<void> {
    try {
      await recoveryDiscard(path);
      toast("已丢弃崩溃备份");
    } catch (e) {
      toast(errorMessage(e));
    }
  }

  // 文档内容变化 → 自动保存 debounce。M149 起由内核的 onDocChanged 回调提供（原先
  // save-controller 自己往 view 上 appendConfig 一个 updateListener，那条路径只作用于
  // 当时那一个 state——切标签后自动保存会静默失效，见 editor.ts 的 appendedExtensions）。
  // 回调不带参数，路径取前台标签：只有前台标签能被编辑（后台标签收到的是程序化重载，
  // 那条路径不排期自动保存——它本来就是「与磁盘同步」的动作）。
  //
  // 标签被关闭时不需要额外的清理钩子：noteOpened（重新打开同一路径时）会把该路径的
  // 暂停态、定时器与 revision 一并重置，而失效的定时器到期后 reconcile 会因为
  // saveBaseline 返回 null 直接返回——不会写错文档。
  editor.onDocChanged(() => onDocChanged(editor.activeSession().path));

  return {
    displayedPath,
    guard,
    vaultSwitchBlock,
    saveAllDirty,
    beginSwitch,
    isCurrent: (s) => s === serial,
    noteOpened,
    noteVaultReset,
    save: async () => {
      const path = displayedPath();
      if (path === undefined) {
        if (editor.isDirty()) reportUnsaveable(path);
        return;
      }
      await saveDocument(false, path);
    },
    handleExternalChange,
    clearGuardToasts,
    showQuitBlocked,
    checkRecovery,
  };
}
