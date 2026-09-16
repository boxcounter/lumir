// 保存链路（手动保存 / 冲突恢复 / 外部修改处置 / 自动保存 / 崩溃备份）的唯一持有者。
// M127 从 main.ts 抽出：main.ts 收敛为装配层，本模块持有全部保存相关状态与决策。
//
// 状态边界：当前展示文档的 path / revision / 世代号 / 在途标记 / 自动保存暂停原因
// 都在这里。main.ts 不再自行维护副本，只经 displayedPath()、beginSwitch()、
// noteOpened()、noteVaultReset()、onDocChanged() 与本模块交互。
//
// 自动保存与 dogfood 场景（Lumir ↔ Obsidian 来回）：存在未解决冲突、外部修改待决或
// 保存目标已被外部删除时，自动保存 MUST 暂停（不硬冲 CAS），dirty 内容改走崩溃备份；
// 暂停态由成功的保存或重新载入清除。

import { StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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
 * 长停顿已落盘」的折中。 */
export const AUTOSAVE_DEBOUNCE_MS = 2000;

/** 备份元数据里没有 CAS 基准（老格式备份 / 元数据读取失败）时用的哨兵：它不等于
 *  任何磁盘 revision，随后的保存必定按 CAS 报冲突，用户必须显式处置——宁可多一次
 *  冲突提示，也不静默覆盖磁盘上可能较新的版本。 */
const UNKNOWN_BASE_REVISION = "recovery-unknown-base";

export interface ToastAction {
  label: string;
  run(): void;
}

export type ToastFn = (text: string, actions?: ToastAction[], sticky?: boolean) => HTMLElement;

export interface SaveControllerDeps {
  editor: EditorHandle;
  /** toast 挂载点（守卫提示的整批撤下要按 DOM 查询）。 */
  container: HTMLElement;
  toast: ToastFn;
  /** 另存为新文件 / 恢复备份后切换打开（main 的 openFile：含 dirtyGuard 与树/标题同步）。 */
  openFile: (path: string, kind: "md" | "code" | "text" | "binary") => Promise<void>;
  /** wikilink 解析缓存整批失效（内容/来源已换）。 */
  invalidateResolve: () => void;
  /** 撤下「暂不支持预览」覆盖层（重载成功后）。 */
  showEditor: () => void;
  /** 覆盖层是否处于隐藏（普通编辑态）；覆盖层在场时不重载文档。 */
  isNoticeHidden: () => boolean;
}

export interface SaveController {
  /** 当前展示文件的 vault 相对路径；未打开为 undefined。 */
  displayedPath(): string | undefined;
  /** 切换文件 / vault 的 dirty 守卫；返回 false 时已给出人话提示。 */
  guard(action: string): boolean;
  /** 打开新文档前调用：世代自增、清空上一文档的暂停态与定时器。返回的世代号
   * 兼作 editor.openDocument 的 requestId（原 fileRequest 与 documentGeneration
   * 恒同增同减，合并为一个计数器）。 */
  beginSwitch(): number;
  isCurrent(serial: number): boolean;
  /** 读快照成功后登记当前展示文档（非 md 文档 revision 传 undefined——该文档随后
   *  不可保存，见 saveBaseline）。 */
  noteOpened(path: string, revision: string | undefined): void;
  /** vault 装载 / 复位：清空展示状态、世代自增、撤下暂停态、定时器与恢复提示。 */
  noteVaultReset(): void;
  /** 编辑器文档内容变化（每次 docChanged）：重置自动保存 debounce。 */
  onDocChanged(): void;
  /** 手动保存（Cmd+S）；当前文档不可保存而又有修改时必须给出可见反馈，MUST NOT 静默。 */
  save(): Promise<void>;
  /** watch 命中打开中文件的处置（M124 分流 + M127 暂停自动保存）。 */
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

  let serial = 0;
  let displayedPath: string | undefined;
  let displayedRevision: string | undefined;
  let saveInFlight = false;
  /** 自动保存暂停原因：conflict / external / not-found。任一在场即不自动保存。 */
  const autosavePaused = new Set<string>();
  let reconcileTimer: number | undefined;
  /** 崩溃备份恢复提示的浮条（换 vault 时整批撤下，避免提示指向旧 vault）。 */
  const recoveryPrompts = new Set<HTMLElement>();

  /** 暂停自动保存 + 诊断埋点：只在**跃迁**（暂停集合从空变非空）时记一条，
   *  否则暂停期间每 2s 一次 reconcile 会把日志灌满。 */
  function pauseAutosave(path: string, reason: string): void {
    const transition = autosavePaused.size === 0;
    autosavePaused.add(reason);
    if (transition) logEvent("autosave_paused", { path, reason });
  }

  /** 暂停态解除（同一文档重新可自动保存）+ 诊断埋点。文档切换 / vault 复位经
   *  cancelScheduledState 清空暂停集合时**不记**：那是「上一份文档的处置随文档一起
   *  作废」，不是自动保存恢复——记成 resumed 会误导读日志的人。 */
  function resumeAutosave(path: string, reason: string): void {
    if (autosavePaused.size === 0) return;
    autosavePaused.clear();
    logEvent("autosave_resumed", { path, reason });
  }

  function saveErrorMessage(e: unknown): string {
    if (isCommandError(e)) return SAVE_ERROR_HINTS[e.code] ?? `保存失败：${e.message}`;
    return `保存失败：${errorMessage(e)}`;
  }

  function cancelReconcile(): void {
    if (reconcileTimer === undefined) return;
    window.clearTimeout(reconcileTimer);
    reconcileTimer = undefined;
  }

  function cancelScheduledState(): void {
    // 直接 clear 而不过 resumeAutosave：这里的解除是「上一份文档的处置随文档一起
    // 作废」（切文件 / 切 vault），不是自动保存对当前文档恢复可用，不该记 resumed。
    autosavePaused.clear();
    cancelReconcile();
  }

  // ---------------------------------------------------------------------------
  // 文档切换与展示状态
  // ---------------------------------------------------------------------------

  function guard(action: string): boolean {
    if (!editor.isDirty()) return true;
    // 无落盘基准的 dirty（未打开文件 / 非 md / 未登记 revision，M130）不能沿用
    // 「请先保存（Cmd+S）」——那是一条走不通的建议；改指撤销修改，给出真正的出口。
    const blocked = saveBaseline() === null
      ? `当前文档不支持保存，无法${action}；请按 Cmd+Z 撤销修改`
      : `当前 Markdown 有未保存修改，无法${action}；请先保存（Cmd+S）`;
    toast(blocked).classList.add(SAVE_GUARD_TOAST_CLASS);
    return false;
  }

  function beginSwitch(): number {
    const next = ++serial;
    cancelScheduledState();
    return next;
  }

  function noteOpened(path: string, revision: string | undefined): void {
    displayedPath = path;
    displayedRevision = revision;
    cancelScheduledState();
  }

  function noteVaultReset(): void {
    ++serial;
    displayedPath = undefined;
    displayedRevision = undefined;
    cancelScheduledState();
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

  /** 当前展示文档的落盘基准（CAS 用 revision）；不可保存返回 null——非 md 是只读
   *  code 模式（M130 方向 A），无 revision 表示没有基准（非 md 未登记，或 md 尚未
   *  读到快照），两者写回去都会失败或无从校验。 */
  function saveBaseline(): string | null {
    return editor.mode() === "md" ? displayedRevision ?? null : null;
  }

  /** 手动 Cmd+S 不可达时的人话反馈（M130 兜底）：dirty 却无法保存时 MUST NOT 静默
   *  return——dirty 会锁死切换文件 / 切换 vault / 退出，静默失败把用户困在「提示让他
   *  按 Cmd+S，而 Cmd+S 无效」的死态。提示必须给出脱离 dirty 的动作（Cmd+Z 撤销）。
   *  当前可达的触发路径是「没有打开文件」（空态 / 新建文档）；方向 A 下非 md 文件一律
   *  只读、不可能 dirty，第二个分支是防再犯的兜底（评审裁决后含无扩展名文件）。
   *  自动保存路径不调用本函数（每 2s 一次会砸提示），其跳过口径见 reconcile。 */
  function reportUnsaveable(): void {
    if (!editor.isDirty()) return; // 无修改可保存：Cmd+S 无事发生，保持静默
    toast(
      displayedPath === undefined
        ? "当前没有打开的文件，无法保存；修改仍在编辑器内（按 Cmd+Z 可撤销）"
        : "当前文件不支持保存：Lumir 只保存 Markdown 文件；修改仍在编辑器内（按 Cmd+Z 可撤销）",
    ).classList.add(SAVE_GUARD_TOAST_CLASS);
  }

  /** 保存当前文档；返回「内存内容是否已完全落盘（dirty 已清除）」。 */
  async function saveDocument(auto: boolean): Promise<boolean> {
    const path = displayedPath;
    const expectedRevision = saveBaseline();
    if (path === undefined || expectedRevision === null) {
      if (!auto) reportUnsaveable();
      return false;
    }
    if (saveInFlight || !editor.isDirty()) return false;
    const generation = serial;
    const content = editor.view.state.doc.toString();
    saveInFlight = true;
    try {
      const revision = await documentSave(path, expectedRevision, content);
      if (generation !== serial || displayedPath !== path) return false;
      displayedRevision = revision;
      if (editor.view.state.doc.toString() === content) {
        editor.markClean();
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
        toast(saveErrorMessage(e));
      }
      return false;
    } finally {
      saveInFlight = false;
    }
  }

  /** 保存冲突的恢复提示：两个动作分别对应「放弃本地」与「覆盖磁盘」。sticky：
   * 冲突在用户处置前不得自动消隐。 */
  function showConflictPrompt(path: string): void {
    toast(
      SAVE_ERROR_HINTS.document_conflict,
      [
        { label: "重新载入（放弃我的修改）", run: () => void discardAndReload(path) },
        { label: "强制覆盖保存", run: () => showForceSaveConfirm(path) },
      ],
      true,
    );
  }

  /** 强制覆盖的二次确认：文案必须明示将覆盖磁盘上较新的内容（M124 裁决）。 */
  function showForceSaveConfirm(path: string): void {
    toast(
      "将覆盖磁盘上较新的内容，此操作不可撤销。确认强制覆盖保存？",
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
    if (saveInFlight || displayedPath !== path || editor.mode() !== "md") return;
    const content = editor.view.state.doc.toString();
    saveInFlight = true;
    try {
      const snapshot = await fsReadSnapshot(path);
      if (displayedPath !== path) return;
      const revision = await documentSave(path, snapshot.revision, content);
      displayedRevision = revision;
      if (editor.view.state.doc.toString() === content) {
        editor.markClean();
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
        toast(saveErrorMessage(e));
      }
    } finally {
      saveInFlight = false;
    }
  }

  /** 保存目标已被外部删除：内存修改是最后副本，给出另存入口（M124）。 */
  function showNotFoundPrompt(path: string): void {
    toast(SAVE_ERROR_HINTS.fs_not_found, [
      { label: "另存为新文件", run: () => void saveAsNewFile(path) },
    ], true);
  }

  /** 另存为新文件：经 wikilink_create（后端 create_note，O_EXCL 语义不覆盖既有
   * 文件）在同目录建「原名-恢复.md」，把内存内容写入后切过去；撞名自动加序号
   * 重试（-2..-5，见 spec fs-io 的崩溃恢复 requirement）。 */
  async function saveAsNewFile(fromPath: string): Promise<void> {
    const stem = fromPath.slice(fromPath.lastIndexOf("/") + 1).replace(/\.(md|markdown)$/i, "");
    const content = editor.view.state.doc.toString();
    for (const suffix of ["", "-2", "-3", "-4", "-5"]) {
      try {
        const { created } = await wikilinkCreate(fromPath, `[[${stem}-恢复${suffix}]]`);
        const snapshot = await fsReadSnapshot(created); // 空文件 revision 作 CAS 基准
        await documentSave(created, snapshot.revision, content);
        // 缓冲内容已落到新文件，本地 dirty 处置完毕——否则 openFile 的 dirtyGuard
        // 会拦下这次切换，用户停在已删除文件上。
        editor.markClean();
        resumeAutosave(fromPath, "saved_as_new");
        // 旧路径的备份随内容迁走（旧文件已被外部删除，其备份不再可恢复）。
        void recoveryDiscard(fromPath).catch(() => {});
        await deps.openFile(created, "md");
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

  /** 重载当前展示文件：与 openFile 同序（读快照 → 校验世代 → openDocument），
   * 但不走 dirtyGuard——调用方自行承担处置语义（冲突放弃 / watch 外部修改）。
   * 不主动换代号：捕获当前世代并在应用前校验未被并发打开挤占，迟到响应自然丢弃。
   * onlyIfChanged：revision 未变即跳过（自身保存也触发 watch Modified，避免每次
   * 保存后重载闪烁、光标复位）；应用前发现用户已开始输入（dirty）也放弃。 */
  async function reloadDisplayedFile(
    path: string,
    opts: { onlyIfChanged?: boolean } = {},
  ): Promise<boolean> {
    if (displayedPath !== path || editor.mode() !== "md" || !deps.isNoticeHidden()) return false;
    const request = serial;
    try {
      const snapshot = await fsReadSnapshot(path);
      if (request !== serial || displayedPath !== path) return false;
      if (opts.onlyIfChanged && (snapshot.revision === displayedRevision || editor.isDirty())) {
        return false;
      }
      if (editor.mode() !== "md") return false;
      displayedRevision = snapshot.revision;
      deps.invalidateResolve(); // from 未变，但内容已换，按 from 键控的缓存整批失效
      editor.openDocument(snapshot.content, path, request);
      deps.showEditor();
      return true;
    } catch (e) {
      if (request !== serial) return false;
      toast(errorMessage(e));
      return false;
    }
  }

  /** 重新载入（放弃我的修改）：冲突处置与 watch 重载共用的入口，给出完成反馈。 */
  async function discardAndReload(path: string): Promise<void> {
    if (await reloadDisplayedFile(path)) {
      resumeAutosave(path, "reloaded"); // 内容已回到磁盘版本，暂停态随冲突一并解除
      toast("已重新载入磁盘内容");
    }
  }

  // ---------------------------------------------------------------------------
  // watch 命中打开中文件
  // ---------------------------------------------------------------------------

  /** 分流（M124 + M127）：保存进行中的批次跳过——自身保存也产生事件，由
   * reloadDisplayedFile 的 revision 比对丢弃；外部删除无法重载，只提示内容仍保留；
   * dirty 时把选择权交给用户（sticky 浮条而非 modal，不打断打字）；未 dirty 自动
   * 重载并提示。仅 md 模式：展示中的 md 才有内存修改可丢失。
   * M127：dirty 分流一律暂停自动保存——磁盘已有更新版本，自动保存不能硬冲 CAS。
   *
   * 诊断埋点（save_external_change）记在**判定为外部变更的那几个分支**里，不记在入口：
   * 自身保存也会经 watch 回流成事件，入口无条件记录会把「每次自动保存」都记成外部变更
   * （实测如此）。判据与 App 的既有分流口径完全一致：删除分支（无法重载）与 dirty 分支
   * （无法重载、只能暂停）本身就是外部变更；干净分支要 reloadDisplayedFile 真的重载了
   * 才算——revision 未变即自身保存的回声。 */
  function handleExternalChange(path: string, kind: FsChangeKind): void {
    if (saveInFlight) return;
    if (kind === "deleted") {
      logExternalChange(path, kind);
      pauseAutosave(path, "not-found");
      toast(`当前文件已被外部删除：${path}；编辑器中的内容未丢失`, [], true);
      return;
    }
    if (editor.isDirty()) {
      logExternalChange(path, kind);
      pauseAutosave(path, "external");
      toast(
        `检测到外部修改：${path}`,
        [
          { label: "重载（放弃我的修改）", run: () => void discardAndReload(path) },
          { label: "保留我的版本", run: () => {} },
        ],
        true,
      );
    } else {
      void reloadDisplayedFile(path, { onlyIfChanged: true }).then((reloaded) => {
        if (!reloaded) return; // 回声：revision 与本次保存的结果一致，磁盘没有变化
        logExternalChange(path, kind);
        toast("检测到外部修改，已自动重载");
      });
    }
  }

  /** 诊断埋点：外部修改命中**打开中的文档**。Rust 的 watch 流给的是全 vault 变更，
   *  「命中打开中的文档且不是自身保存」这个判定只有前端有（displayedPath 与 revision
   *  都在这），所以这一条由前端经 log_event 转发，而不是在 Rust 侧记全量文件变更
   *  （那会淹没真正的摩擦信号）。 */
  function logExternalChange(path: string, kind: FsChangeKind): void {
    logEvent("save_external_change", { path, change: kind });
  }

  // ---------------------------------------------------------------------------
  // 自动保存（停止输入 debounce）+ 崩溃备份
  // ---------------------------------------------------------------------------

  function onDocChanged(): void {
    if (!editor.isDirty()) return; // 装载/复位导致的文档替换不排期
    cancelReconcile();
    reconcileTimer = window.setTimeout(() => {
      reconcileTimer = undefined;
      void reconcile();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  /** debounce 到期：自动保存一次；无法保存（暂停 / 未完全落盘）时把 dirty 内容
   * 落崩溃备份——进程崩溃 / 强杀后下次启动仍有内容可恢复。
   * 无落盘基准（saveBaseline 为 null：非 md / 未登记 revision）直接返回：这类内容
   * 没有任何保存路径能写回磁盘，备份只会在下次启动弹出一个无法闭环的恢复提示。 */
  async function reconcile(): Promise<void> {
    const path = displayedPath;
    if (path === undefined || saveBaseline() === null || !editor.isDirty()) return;
    if (autosavePaused.size > 0 || saveInFlight) {
      await backupDirty(path);
      return;
    }
    if (!(await saveDocument(true))) await backupDirty(path);
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
    const revision = saveBaseline();
    if (!editor.isDirty() || revision === null) return;
    const content = editor.view.state.doc.toString();
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
   *  绝不静默覆盖较新的磁盘版本。 */
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
    await deps.openFile(path, "md");
    if (displayedPath !== path || editor.mode() !== "md") return; // 切换被守卫拦下 / 未装载
    displayedRevision = baseRevision ?? UNKNOWN_BASE_REVISION;
    editor.view.dispatch({
      changes: { from: 0, to: editor.view.state.doc.length, insert: content },
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

  // 文档内容变化 → 自动保存 debounce。editor.ts 不在本 mission scope（无「内容变化」
  // 回调），经 appendConfig 追加一个 updateListener——等价于创建期就带上该扩展。
  editor.view.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onDocChanged();
      }),
    ),
  });

  return {
    displayedPath: () => displayedPath,
    guard,
    beginSwitch,
    isCurrent: (s) => s === serial,
    noteOpened,
    noteVaultReset,
    onDocChanged,
    save: () => saveDocument(false).then(() => undefined),
    handleExternalChange,
    clearGuardToasts,
    showQuitBlocked,
    checkRecovery,
  };
}
