// 多 vault 切换器（M163，change multi-vault-workspaces 的 3.x / 4.x）：树头部入口（形态 A）
// 打开的列表浮层、切换流程的门与闸、按 vault 的标签会话落盘与装载后恢复。
//
// 模块边界（谁在哪）：
//   - 入口 DOM 与空态在 src/tree.ts（树头部是它的领地）；浮层与定位在这里，与 .lumir-toc
//     同一手法：绝对定位、不占常驻行高、关闭即消失。挂点取 app-shell 根——左栏的两个容器
//     （.pane-filetree / .tree-pane）都是 overflow:auto，浮层挂进去会被裁掉，而口径 12 明确
//     允许它溢出左栏（320px 宽 vs 244px 栏宽）。
//   - 打开链路（vault_open_path / vault_open + 整窗复位）在装配层 main.ts：它是唯一知道
//     「当前 vault 是什么、树与编辑器怎么复位」的地方。本模块只**发请求**（requestSwitch /
//     requestAdd / requestRelocate）并把列表行交过去，不自己调后端命令。
//   - 列表**每次打开重新拉取**（MUST NOT 维护常驻镜像——注册表是唯一真源）；排序由后端给出
//     （最近打开倒序 + 不可用项沉底），前端不重排（同一语义不做两处真源）。
//   - 会话（有序 vault 相对路径 + 激活项）与切换流程的三动作都在本模块，且都做成**无 DOM**
//     的纯逻辑（`createVaultSessionStore` / `createVaultSwitchGate` + 几个纯函数），DOM 只留在
//     浮层那一层。这样「预览不入盘 / 越界丢弃 / 激活项退化 / 跳过计数 / 三动作状态机 / 切换
//     进行中忽略新请求」这些判定能直接单测（tests/unit/vault-switcher.test.ts），不必靠浏览器
//     场景间接兜底（M153 的教训：判定落不到可复现的断言上就等于没有）。
//
// 浮层内的 ↑↓ / ⌃N⌃P / Enter / Esc 就地消费、**不进** keys.ts 的统一表：表的不变量是「一个
// token 一条绑定」，而 ↑↓ 与 ⌃N⌃P 已归 editor.cursor-*、Esc 已归 editor.widget-escape（带
// when 条件）。浮层打开期间持有焦点，editor 作用域因「事件目标不在 contentDOM 内」不命中；
// 就地消费后 preventDefault，window 上的分发器对已消费事件让路——与 M148 大纲浮层、M133 键位
// 面板、M139 搜索 panel 同一套口径（D86）。

import type { FsEntry } from "./bindings/FsEntry";
import type { VaultListEntry } from "./bindings/VaultListEntry";
import type { VaultSession } from "./bindings/VaultSession";
import type { EditorSession, ScrollSnapshot } from "./editor";
// 键位 token 走 keys.ts 的同一份归一化实现：浮层就地消费 ↑↓ / ⌃N⌃P / Enter / Esc 时也要用
// 统一口径判断按键（自写一份解析是 REVIEW.md 第 8 条那类漂移的温床）。
import { keyToken } from "./keys";
import type { ToastAction, VaultSwitchBlock } from "./save-controller";

/** 会话落盘的防抖窗口（ms）：标签集合 / 顺序 / 激活项变化后合并到这一档。
 *  比自动保存（2s）短：会话只有几百字节，且它是「下次打开恢复什么」的唯一凭据，
 *  丢一次就是一段可感知的体验落差。切换前与退出前另有 flush（MUST NOT 只依赖它）。 */
export const SESSION_WRITE_DEBOUNCE_MS = 1000;

// ---------------------------------------------------------------------------
// 文案（单一来源 文案-Copy.md：浮层与恢复侧 D97–D104、D108 与切换拦截 D109–D110 在本文件，
//  入口 D96 在 src/tree.ts，空态引导 D107 与重定位的两条拒绝 D105–D106 在装配层 main.ts）
// ---------------------------------------------------------------------------

/** D97 浮层读屏名。 */
const POPOVER_LABEL = "vault";
/** D98 当前项的唯一标记。 */
const CURRENT_FLAG = "当前";
/** D99 行摘要：当前项说「现在打开」，没有历史的行单独给 D101 的串。 */
const SUMMARY_CURRENT = "现在打开";
/** D101 没有标签历史的摘要。 */
const NO_TABS_TEXT = "还没有打开过文件";
/** D102 失效行的成因。 */
const MISSING_TEXT = "路径不可用：目录被移动，或所在卷未挂载";
/** D103 失效行的动作。 */
const RELOCATE_TEXT = "重新定位…";
/** D104 浮层底部新增入口（形态 A 下浮层内唯一的新增入口）。 */
const ADD_TEXT = "新增 vault…";
const ADD_TITLE = "选择一个目录作为新 vault";
/** D108 恢复时跳过缺失文件的计数提示（一次一条，MUST NOT 逐个报错）。 */
export function skippedText(count: number): string {
  return `${count} 个文件已不在这个 vault 里，已跳过`;
}

/** D99 行摘要的模板（入参是后端给的 `tab_count` 与 `last_opened_at`）。 */
export function summaryText(
  tabCount: number,
  lastOpenedAt: number | null,
  now: number,
  current: boolean,
): string {
  if (tabCount === 0) return NO_TABS_TEXT;
  if (current) return `${tabCount} 个标签 · ${SUMMARY_CURRENT}`;
  const when = relativeTime(lastOpenedAt, now);
  // 没有打开记录的老注册项（M163 之前登记的）：只给数字，不编一个时间出来。
  return when === "" ? `${tabCount} 个标签` : `${tabCount} 个标签 · ${when}`;
}

/** 浮层条目 id 前缀（aria-activedescendant 用；同页唯一即可）。 */
const ITEM_ID_PREFIX = "lumir-vault-opt-";

// ---------------------------------------------------------------------------
// 纯函数：会话快照 / 恢复计划 / 摘要里的时间与路径
// ---------------------------------------------------------------------------

/** 入盘内容的形状：有序 vault 相对路径 + 激活项。 */
export interface SessionSnapshot {
  tabs: string[];
  active: string | null;
}

/** 构造入盘内容（**唯一**构造点）。两条口径都在这里：
 *   - 预览（临时）标签不入盘：它是随时会被顶掉的槽位，恢复它等于在恢复结果里埋一个会
 *     消失的项（spec「按 vault 持久化标签列表」）；
 *   - 激活项不在入盘集合里时落为 null（例如前台是个预览标签）——恢复侧据此退化到第一个
 *     可打开的标签，不在盘上留一个指向不存在条目的值。 */
export function sessionSnapshot(
  sessions: readonly EditorSession[],
  activePath: string | undefined,
): SessionSnapshot {
  const tabs = sessions
    .filter((session) => session.path !== undefined && !session.preview)
    .map((session) => session.path as string);
  const active = activePath !== undefined && tabs.includes(activePath) ? activePath : null;
  return { tabs, active };
}

/** 两份入盘内容是否逐项一致（决定要不要写盘：内容没变就不排期）。 */
export function sameSnapshot(a: SessionSnapshot, b: SessionSnapshot): boolean {
  if (a.active !== b.active || a.tabs.length !== b.tabs.length) return false;
  return a.tabs.every((path, index) => path === b.tabs[index]);
}

/** 恢复计划：按存储顺序给出「可以打开的条目」、被跳过的条目数、要激活的条目。 */
export interface RestorePlan {
  open: string[];
  skipped: number;
  active: string | null;
}

/** `available` 是**本次枚举出来的 vault 条目集合**（文件树的那一份）。所有过滤都归结为
 *  「在不在这个集合里」：
 *   - 已删除 / 已移出 vault 的条目 → 不在集合里 → 跳过；
 *   - 绝对路径、含 `..`、越出 vault 的条目（会话文件在配置目录里，可被手工改写）→ 同样不在
 *     集合里 → 跳过，MUST NOT 被打开（ADR 0003 的边界不因会话文件放宽）。
 *  前端**不**另写一份「合法 vault 相对路径」的判定：那是后端 `vault_session::sanitize` 的
 *  语义（REVIEW.md 第 8 条），集合归属已经完整覆盖它。
 *
 *  激活项不可用（不在恢复出来的集合里）时退化为第一个可打开的条目；一个都打不开时为 null
 *  （调用方呈现空 vault 首入态）。 */
export function restorePlan(
  session: VaultSession | null,
  available: ReadonlySet<string>,
): RestorePlan {
  const stored = session?.tabs ?? [];
  const open = stored.filter((path) => available.has(path));
  const storedActive = session?.active ?? null;
  const usable = storedActive !== null && open.includes(storedActive);
  return {
    open,
    skipped: stored.length - open.length,
    active: usable ? storedActive : open[0] ?? null,
  };
}

/** 上次打开时间 → 摘要里的相对时间（D100）：比绝对时间好读，也比一直往下数好读——
 *  一小时以上按小时、一天以上按天、两天以上说「昨天」、一周以上给绝对日期。
 *  时钟回拨（记录时间在将来）落进「刚刚」，不产出负数。 */
export function relativeTime(at: number | null, now: number): string {
  if (at === null) return "";
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  if (hours < 48) return "昨天";
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 路径尾部三段（口径 5）：行宽只够三段，靠它区分同名的两个目录。 */
export function shortPath(path: string, segments = 3): string {
  const parts = path.split("/").filter((part) => part !== "");
  if (parts.length <= segments) return path;
  return `…/${parts.slice(-segments).join("/")}`;
}

/** 两个路径是否指同一处（重定位的占用判定）。只归一去尾斜杠——更强的比较要在文件系统上做
 *  （canonicalize），那是后端的语义（workspaces.rs 的 find_by_path），前端不复制一份近似实现。
 *  已知边界：注册表存的是 canonicalize 后的路径，系统目录选择器给出的是原样路径，走 /tmp
 *  这类软链接的 vault 上两者可能不相等。 */
export function samePath(a: string, b: string): boolean {
  const strip = (value: string) => (value.length > 1 ? value.replace(/\/+$/, "") : value);
  return strip(a) === strip(b);
}

// ---------------------------------------------------------------------------
// 切换流程的门与闸（4.1–4.3）：dirty 前置检查的三动作状态机 + 「一次只处理一个切换」
// ---------------------------------------------------------------------------

/** D109 切换 vault 的 dirty 拦截提示：点名**当前** vault 与它有未保存修改的标签数。
 *  未保存修改属于当前 vault、不属于切换目标（M158 r1 的修正）；哪些标签脏由标签栏逐标签的
 *  dirty 点承担（D90），因此这里不逐个列文件（那会变成第二处真源）。数量是「要不要放弃」
 *  这个决定的度量，判据又是全体标签，所以给数量而非文件名。 */
export function vaultGuardText(vaultName: string, dirtyCount: number): string {
  return `「${vaultName}」里有 ${dirtyCount} 个标签有未保存修改，切换会丢弃这些修改`;
}

export interface VaultSwitchGateDeps {
  /** dirty 前置判据（装配层注入 save-controller 的 vaultSwitchBlock）；null = 可以切换。 */
  block(): VaultSwitchBlock | null;
  /** 保存**全部**可保存的脏标签；返回是否已全部闭环（false 时 MUST NOT 继续切换）。 */
  saveAll(): Promise<boolean>;
  /** 当前 vault 的显示名（提示点名用）。 */
  currentName(): string;
  /** 拦下时的人话提示（sticky 三动作浮条；守卫提示的标识类由装配层补）。 */
  notify(text: string, actions: ToastAction[]): void;
  /** 「继续」这一步抛错时的一条人话提示。proceed 自己处置过的错误不该再抛到这里。 */
  fail(message: string): void;
}

export interface VaultSwitchGate {
  /** 请求一次切换。`proceed` = 「继续」这一步（打开目标并装载），成功与否由它自己的
   *  Promise 表达——在途窗口就是它。返回是否放行：false 表示被拦下（已给出三动作）或被
   *  忽略（已有一次切换在途）。 */
  request(proceed: () => Promise<void> | void): boolean;
}

/** 切换流程的门与闸：三条出口的各自动作、保存未闭环不继续、一次只处理一个切换。
 *  纯逻辑（无 DOM）：提示只经 `notify` 出去，因此可以脱离浏览器单测状态迁移。 */
export function createVaultSwitchGate(deps: VaultSwitchGateDeps): VaultSwitchGate {
  /** 切换在途（含「保存并切换」的保存阶段）：期间再来的请求直接忽略——两个 in-flight 切换
   *  会互相覆盖（先完成的装载上下文、后完成的又覆盖一次），还会与「落盘当前 vault 的会话」
   *  交错。忽略第二次请求是最省且可解释的口径。 */
  let inFlight = false;

  async function claim(): Promise<boolean> {
    if (inFlight) return false;
    inFlight = true;
    return true;
  }

  async function run(proceed: () => Promise<void> | void): Promise<void> {
    if (!(await claim())) return;
    try {
      await proceed();
    } catch (e) {
      deps.fail(errorText(e));
    } finally {
      inFlight = false;
    }
  }

  async function saveThenRun(proceed: () => Promise<void> | void): Promise<void> {
    if (!(await claim())) return;
    try {
      // 保存未闭环（冲突 / 写失败 / 无落盘基准）就不继续切换：保存链路已经给出提示与出口，
      // 这里再切等于替用户做了他没做的决定。
      if (!(await deps.saveAll())) return;
      await proceed();
    } catch (e) {
      deps.fail(errorText(e));
    } finally {
      inFlight = false;
    }
  }

  return {
    request(proceed) {
      if (inFlight) return false;
      const block = deps.block();
      if (block === null) {
        void run(proceed);
        return true;
      }
      const actions: ToastAction[] = [];
      // 不可保存的脏标签不给「保存并切换」：那是一条走不通的建议（无落盘基准的内容没有任何
      // 保存路径能写回磁盘），只留「放弃」与「取消」两条真出口。
      if (!block.hasUnsaveable) {
        actions.push({ label: "保存并切换", run: () => void saveThenRun(proceed) });
      }
      actions.push(
        { label: "放弃修改并切换", run: () => void run(proceed) },
        { label: "取消", run: () => {} },
      );
      deps.notify(vaultGuardText(deps.currentName(), block.dirtyCount), actions);
      return false;
    },
  };
}

/** 守卫类粘性提示的呈现（M163 r1 P2-1）：**先撤下既有守卫浮条再挂新的**。
 *
 *  装配层的 toast 对 sticky 按文案去重并直接复用既有元素（M107 为「连按 ⌘Q 同一守卫」设计，
 *  那时动作没有载荷）。守卫浮条的动作带着「切到哪一个」：文案刻意只点名当前 vault 与脏标签
 *  数（M158 r1），于是「dirty 拦下点 B → 不处置 → 再点 C」两次文案逐字相同，去重命中后 C 的
 *  proceed 被丢弃，用户看到的仍是绑着 B 的三条动作——一次静默的错目标切换。撤下旧的再挂新的
 *  是最小修法：同一文案的第二次请求必须换一份带着新 proceed 的浮条。 */
export function createGuardPromptPresenter(deps: {
  clearPrevious(): void;
  toast(text: string, actions: ToastAction[], sticky: boolean): unknown;
}): (text: string, actions: ToastAction[]) => void {
  return (text, actions) => {
    deps.clearPrevious();
    deps.toast(text, actions, true);
  };
}

/** remap 门短路回执里本模块要用的字段（不把整个 VaultInfo 拖进来）。 */
export interface VaultRemapInfo {
  root: string;
  remap_candidates: ReadonlyArray<{ id: string; path: string }>;
}

export interface VaultRemapPromptDeps {
  /** dirty 前置门（装配层的 switchGate.request）。 */
  guard(proceed: () => Promise<void> | void): boolean;
  /** 粘性两出口浮条的出口（装配层的守卫提示呈现）。 */
  notify(text: string, actions: ToastAction[]): void;
  /** 路径的显示名（= 目录 basename；装配层注入，本模块不依赖文件树模块）。 */
  displayName(path: string): string;
  /** 按已知路径重开并装载（`vault_open_path` + 装载的封装）。 */
  openPath(path: string): Promise<void>;
  /** 把某个注册项 id 绑到新路径（`vault_remap` 的封装）。 */
  remap(id: string, path: string): Promise<void>;
  /** 打开失败 / 绑定失败的人话提示。 */
  fail(message: string): void;
}

export interface VaultRemapPrompt {
  /** 摆出两个出口（M121/M126 既有形态）：作为新 vault 打开 / 确认映射到此路径。 */
  present(info: VaultRemapInfo): void;
}

/** 「未注册目录 + 存在失效注册项」时摆出的两个出口（既有形态）。
 *
 *  M163 r1 P1-1：两个动作都**必须在动作时点过 dirty 门**。这张浮条是 sticky、可无限期存活，
 *  期间用户照常编辑会产生 dirty，而两个动作最终都会经 `editor.reset()` 把全部标签一起作废
 *  ——不过门就等于静默丢弃未保存修改（spec「vault 切换与整窗上下文替换」）。
 *
 *  门还必须摆在 `openPath`（后端提交）**之前**：`vault_open_path` 一旦返回，后端就已经切到
 *  新 vault 了，那时再拦只会留下「后端在新 vault、前端显示旧的」的半切换态（此后相对路径的
 *  保存会落到错误的 vault 上）——这是装配层「先拦后开」那条不变量的同款。
 *
 *  「确认映射到此路径」先做 `remap` 再 `reopen`：remap 是用户显式确认的注册表修正、不丢内容，
 *  门拦在它之后（拦的是重开）语义无害。 */
export function createVaultRemapPrompt(deps: VaultRemapPromptDeps): VaultRemapPrompt {
  function reopen(root: string): void {
    deps.guard(() => deps.openPath(root).catch((e) => deps.fail(errorText(e))));
  }

  return {
    present(info) {
      const top = info.remap_candidates[0];
      // 调用方只在有候选时摆浮条；空数组不摆（不产出没有出口的提示）。
      if (top === undefined) return;
      deps.notify(
        `「${deps.displayName(info.root)}」尚未注册为 vault；发现可能已移动的 vault：${top.path}`,
        [
          { label: "作为新 vault 打开", run: () => reopen(info.root) },
          {
            label: "确认映射到此路径",
            run: () => {
              void deps
                .remap(top.id, info.root)
                .then(() => reopen(info.root))
                .catch((e) => deps.fail(errorText(e)));
            },
          },
        ],
      );
    },
  };
}

// ---------------------------------------------------------------------------
// 会话存储（4.4 / 4.5）：防抖写、切换前与退出前 flush、装载后按会话恢复标签
// ---------------------------------------------------------------------------

export interface VaultSessionStoreDeps {
  /** 会话列表与前台路径（入盘快照的两个输入，都活读装配层的真实状态）。 */
  sessions(): readonly EditorSession[];
  activePath(): string | undefined;
  /** 读 / 写某 vault 的标签会话（装配层给 ipc 封装）。 */
  getSession(vaultId: string): Promise<VaultSession | null>;
  putSession(vaultId: string, tabs: string[], active: string | null): Promise<void>;
  /** 按**固定标签**意图打开一个文件；返回是否成功。失败不落编辑器覆盖层（恢复是逐标签的
   *  批量动作，单个文件的失败不该把正文换成错误提示）。 */
  openPinned(path: string): Promise<boolean>;
  /** 激活某个已打开的标签（恢复存储的激活项）。 */
  activate(path: string): void;
  /** 恢复结束、一个标签都没恢复出来：空 vault 首入态。 */
  onEmptyVault(): void;
  /** 一条提示（恢复跳过的计数提示）。 */
  toast(text: string): void;
  /** 会话读写失败的人话提示（只降级，不拦停动作）。 */
  warn(text: string): void;
}

export interface VaultSessionStore {
  /** 标签集合 / 顺序 / 激活项变化后调用（防抖落盘）。 */
  sessionChanged(): void;
  /** 把待写内容立刻落盘（切换前 / 退出前）。没有待写内容也会写一份当前快照——退出路径上
   *  没有第二次机会，多写一次几百字节比漏一次便宜。 */
  flush(): Promise<void>;
  /** 当前 vault 装载完成：登记当前项（写盘的键）并按会话恢复标签列表。
   *  返回的 Promise 在恢复结束后 resolve（测试与「恢复完成」这类观察点要用）。 */
  onVaultLoaded(vaultId: string, entries: readonly FsEntry[]): Promise<void>;
}

/** 会话存储：无 DOM，可脱离浏览器单测（防抖窗口 / flush 时机 / 恢复的过滤与跳过）。 */
export function createVaultSessionStore(deps: VaultSessionStoreDeps): VaultSessionStore {
  /** 写盘的键：当前 vault 的稳定 id。没有它（启动早期）时一切写操作都是 no-op。 */
  let currentId: string | undefined;
  /** 待写内容与防抖定时器。 */
  let pending: SessionSnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 恢复世代：每次装载自增。逐标签装载是异步的，用户可能在恢复途中切走——旧 vault 的
   *  标签绝不许落到新 vault 的编辑器里，因此每一步都复查世代（M156 的让位规则同族：
   *  被让位的那次恢复整体丢弃，而不是只丢一半）。 */
  let restoreGen = 0;

  function snapshot(): SessionSnapshot {
    return sessionSnapshot(deps.sessions(), deps.activePath());
  }

  function cancelTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  async function write(vaultId: string, payload: SessionSnapshot): Promise<void> {
    try {
      await deps.putSession(vaultId, payload.tabs, payload.active);
    } catch (e) {
      // 写失败只降级（与 last_vault 写失败同口径）：会话只影响「下次打开恢复什么」，
      // 不值得拦停用户的一次切换或退出。
      deps.warn(errorText(e));
    }
  }

  async function restore(vaultId: string, gen: number, entries: readonly FsEntry[]): Promise<void> {
    let session: VaultSession | null = null;
    try {
      session = await deps.getSession(vaultId);
    } catch {
      session = null; // 会话读不到等价于「没有标签历史」，不影响这次打开
    }
    if (gen !== restoreGen) return;
    const available = new Set(
      entries.filter((entry) => entry.kind === "file").map((entry) => entry.path),
    );
    const plan = restorePlan(session, available);
    const opened: string[] = [];
    // 一律用**固定标签**意图逐个打开：预览语义会就地顶掉前一个标签，逐个下来只剩最后一个
    // （design §4.1 的推导，已写进 spec）。
    for (const path of plan.open) {
      if (gen !== restoreGen) return;
      if (await deps.openPinned(path)) opened.push(path);
    }
    if (gen !== restoreGen) return;
    // 一次计数提示：不在 vault 里的条目 + 在 vault 里却打不开的条目（MUST NOT 逐个报错）。
    const skipped = plan.skipped + (plan.open.length - opened.length);
    if (skipped > 0) deps.toast(skippedText(skipped));
    if (opened.length === 0) {
      // 全部不可用（或本来就没有历史）：空 vault 首入态——标签栏隐藏（没有标签自然隐藏）
      // + 正文一句引导，不伪造内容。
      deps.onEmptyVault();
      return;
    }
    const active = plan.active !== null && opened.includes(plan.active) ? plan.active : opened[0];
    deps.activate(active);
  }

  function sessionChanged(): void {
    if (currentId === undefined) return;
    const next = snapshot();
    // 与待写内容相同就不排期：切标签会经装配层的同步点反复回调到这里，内容没变时反复
    // 重置定时器等于永不落盘。
    if (pending !== null && sameSnapshot(pending, next)) return;
    pending = next;
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, SESSION_WRITE_DEBOUNCE_MS);
  }

  async function flush(): Promise<void> {
    cancelTimer();
    const payload = pending ?? snapshot();
    pending = null;
    const vaultId = currentId;
    if (vaultId === undefined) return; // 还没有 vault（启动路径）：没有可写的键
    await write(vaultId, payload);
  }

  async function onVaultLoaded(vaultId: string, entries: readonly FsEntry[]): Promise<void> {
    currentId = vaultId;
    cancelTimer();
    // 上一次装载留下的待写内容属于上一个 vault：键已经换了，直接丢弃（它已由那次切换前的
    // flush 写走，或随那次装载作废）。
    pending = null;
    const gen = ++restoreGen;
    await restore(vaultId, gen, entries);
  }

  return { sessionChanged, flush, onVaultLoaded };
}

// ---------------------------------------------------------------------------
// 浮层（DOM）与入口同步
// ---------------------------------------------------------------------------

export interface VaultSwitcherDeps extends VaultSessionStoreDeps {
  /** 浮层的挂点与定位块（app-shell 根，见文件头：左栏容器都带 overflow）。 */
  mount: HTMLElement;
  /** 树头部入口（src/tree.ts 建，形态 A）；未装载 vault 时为 undefined。 */
  entry(): HTMLElement | undefined;
  /** 列表来源（每次打开重新拉取，MUST NOT 常驻镜像）。 */
  list(): Promise<VaultListEntry[]>;
  /** 切换请求（装配层给 dirty 前置门 + vault_open_path + 装载）。 */
  requestSwitch(row: VaultListEntry): void;
  /** 新增 vault 请求（目录选择器 + remap 门的既有两出口）。 */
  requestAdd(): void;
  /** 失效项「重新定位…」请求；siblings 是本次渲染的整份列表（占用判定用它，不重新拉取）。 */
  requestRelocate(row: VaultListEntry, siblings: readonly VaultListEntry[]): void;
  /** 同步入口的展开态（`aria-expanded`：入口 DOM 归树模块，展开态归浮层）。 */
  expanded(expanded: boolean): void;
  /** 焦点交还编辑器（浮层里按 Esc / Enter 关闭后）。MUST NOT 改变正文的阅读位置——
   *  位置由 `readingPosition` / `restoreReadingPosition` 在这一步前后守住，见 handOffFocus。 */
  focusEditor(): void;
  /** 收起之前的阅读位置（`close` 在聚焦之前取，见 handOffFocus）。 */
  readingPosition(): ScrollSnapshot;
  /** 把阅读位置写回（与 readingPosition 同一份通道；装配层注入，本模块不解释它的形状）。 */
  restoreReadingPosition(snapshot: ScrollSnapshot): void;
}

export interface VaultSwitcherHandle extends VaultSessionStore {
  /** 打开 / 收起浮层（⌘O 命令与入口点击共用）。未装载 vault 时无操作。 */
  toggle(): void;
}

/** 装配多 vault 切换器（浮层 + 会话）；返回命令层与装配层要的入口。 */
export function createVaultSwitcher(deps: VaultSwitcherDeps): VaultSwitcherHandle {
  return new VaultSwitcher(deps);
}

class VaultSwitcher implements VaultSwitcherHandle {
  private readonly deps: VaultSwitcherDeps;
  private readonly store: VaultSessionStore;
  private readonly popover: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly addRow: HTMLButtonElement;
  private readonly separator: HTMLDivElement;

  /** 浮层状态：打开态、可选中行（供 ↑↓ 使用）、键盘游标（rows 下标）与当前项 id。 */
  private open = false;
  private rows: HTMLButtonElement[] = [];
  private rowEntries: VaultListEntry[] = [];
  private activeIndex = -1;
  /** 打开请求的令牌：拉取是异步的，回来时若已被关闭 / 又开过一次，本次结果整体丢弃。 */
  private openToken = 0;
  /** 当前 vault 的 id（列表里的当前项标记）。 */
  private currentId: string | undefined;

  constructor(deps: VaultSwitcherDeps) {
    this.deps = deps;
    this.store = createVaultSessionStore(deps);

    const popover = document.createElement("div");
    popover.className = "vault-pop";
    popover.hidden = true;
    const list = document.createElement("div");
    list.className = "vault-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", POPOVER_LABEL);
    list.tabIndex = -1;
    const separator = document.createElement("div");
    separator.className = "vault-sep";
    const addRow = document.createElement("button");
    addRow.type = "button";
    addRow.className = "vault-add";
    addRow.title = ADD_TITLE;
    addRow.setAttribute("aria-label", ADD_TITLE);
    const plus = document.createElement("span");
    plus.className = "vault-add-plus";
    plus.setAttribute("aria-hidden", "true");
    plus.textContent = "＋";
    const addLabel = document.createElement("span");
    addLabel.textContent = ADD_TEXT;
    addRow.append(plus, addLabel);
    popover.append(list, separator, addRow);
    deps.mount.append(popover);
    this.popover = popover;
    this.list = list;
    this.separator = separator;
    this.addRow = addRow;

    // 列表内导航：↑↓ / ⌃N⌃P 移动，Enter 切换，Esc 关闭。
    list.addEventListener("keydown", (event) => this.onKeydown(event));
    // 浮层内的行不夺焦点（与 .lumir-toc 的条目、标签栏同一手法）：mousedown 一旦夺焦，
    // list 的 blur 会先把浮层收起，随后的 click 落在已 display:none 的元素上，那一行的动作
    // 就永远不会执行——点击路径必须活到 click。
    popover.addEventListener("mousedown", (event) => event.preventDefault());
    // 焦点离开浮层即收起（Tab 出去、点到别处、窗口失活都走这条）——这条路径不抢焦点。
    list.addEventListener("blur", () => this.close(false));
    // 点击浮层与入口之外收起（编辑器、文件树、toast…）。入口要排除：它是「开→关」的切换点，
    // 第一次点击就收起会让随后的 click 走 toggle 又开一次（视觉上闪一下，aria-expanded 假翻），
    // 与 .lumir-toc 排除它的指示段同一手法。
    document.addEventListener("mousedown", (event) => {
      if (!this.open) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      const entry = deps.entry();
      if (popover.contains(target) || (entry !== undefined && entry.contains(target))) return;
      this.close(false);
    });
    addRow.addEventListener("click", () => {
      this.close(false);
      deps.requestAdd();
    });
  }

  // 会话能力整批转给无 DOM 的 store：装配层与命令层只与 Handle 打交道，浮层不参与会话。
  sessionChanged(): void {
    this.store.sessionChanged();
  }

  flush(): Promise<void> {
    return this.store.flush();
  }

  async onVaultLoaded(vaultId: string, entries: readonly FsEntry[]): Promise<void> {
    this.currentId = vaultId;
    await this.store.onVaultLoaded(vaultId, entries);
  }

  toggle(): void {
    if (this.open) {
      this.close();
      return;
    }
    const entry = this.deps.entry();
    if (entry === undefined) return; // 未装载 vault：没有列表入口，命令也无操作
    const token = ++this.openToken;
    void this.deps
      .list()
      .then((rows) => {
        if (token !== this.openToken || this.open) return;
        this.render(rows);
        this.open = true;
        this.popover.hidden = false;
        this.deps.expanded(true);
        this.place(entry);
        this.list.focus();
      })
      .catch((e) => {
        if (token !== this.openToken) return;
        // 列表读不到：只给一条人话提示，不弹空浮层（空列表会被误读成「一个 vault 都没有」）。
        this.deps.warn(errorText(e));
      });
  }

  /** 收起浮层。`restoreFocus` 为假时不抢焦点——焦点本来就去了别处（Tab 到别的控件、点了
   *  别的窗口、切换已接管上下文）时把焦点拽回编辑器是无礼的。 */
  close(restoreFocus = true): void {
    if (!this.open) return;
    this.open = false;
    this.popover.hidden = true;
    this.deps.expanded(false);
    if (restoreFocus) this.handOffFocus();
  }

  /** 把焦点交还编辑器，并**保住阅读位置**（M186）。
   *
   *  滚动位置是读者的位置，不是焦点的一部分：收起浮层不该让人丢掉刚才读到哪里。顺序本身就是
   *  口径：
   *   - 取快照 MUST 在聚焦之前——把焦点放进编辑器是**浏览器**接管的视口动作（聚焦时保证光标
   *     可见），它一旦把视口移走，聚焦后再取、取到的就是被改过的值（缺陷本身）；
   *   - 写回走编辑器自己的滚动通道（装配层注入），本模块不解释快照的形状、也不碰 DOM 滚动；
   *   - 位置本来没动时，写回是一次空动作（同一份快照报回同一处）。
   *  收起来自 `blur` / 点浮层外（`close(false)`）的不走这里：那条路上焦点归用户点的那个东西，
   *  不由我们接管，也 MUST NOT 拿旧位置把视口拽回去。 */
  private handOffFocus(): void {
    const position = this.deps.readingPosition();
    this.deps.focusEditor();
    this.deps.restoreReadingPosition(position);
  }

  // -------------------------------------------------------------------------
  // 渲染与交互
  // -------------------------------------------------------------------------

  private render(rows: readonly VaultListEntry[]): void {
    const now = Date.now();
    this.rowEntries = [...rows];
    this.rows = [];
    this.activeIndex = -1;
    this.list.replaceChildren(...rows.map((row, index) => this.renderRow(row, index, now)));
    // 新增入口是浮层内**唯一**的新增入口（形态 A），列表为空时也照常给出。
    this.separator.hidden = rows.length === 0;
    // 默认游标落在当前项（列表按最近打开倒序，当前项本来就在首位；这里不假定位置）。
    // 游标下标是**可选中行**的下标（this.rows 不含失效行），因此按元素回查，不用整份列表
    // 的下标。
    const currentIndex = this.rows.findIndex((el) => el.dataset.vault === this.currentId);
    this.setActive(this.rows.length === 0 ? -1 : Math.max(0, currentIndex));
  }

  /** 一行：显示名 + 摘要 + 路径尾部三段；失效行改给成因与「重新定位…」。
   *  失效行**不发起打开**（点击与 Enter 都走重定位），可用行点击即请求切换。 */
  private renderRow(row: VaultListEntry, index: number, now: number): HTMLButtonElement {
    const current = row.id === this.currentId;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "vault-row";
    el.setAttribute("role", "option");
    el.setAttribute("aria-selected", String(current));
    el.dataset.vault = row.id;
    if (row.available) {
      el.id = `${ITEM_ID_PREFIX}${index}`;
      if (current) el.classList.add("is-current");
      this.rows.push(el);
    } else {
      // 不可用：仍是可聚焦的一行（键盘要能走到「重新定位…」），语义是「不可选中」，
      // 点击不发起打开（spec「失效 vault 的处置」）。
      el.classList.add("is-missing");
      el.setAttribute("aria-disabled", "true");
    }

    const top = document.createElement("span");
    top.className = "vault-row-top";
    const dot = document.createElement("span");
    dot.className = current ? "vault-dot" : "vault-dot is-off";
    dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "vault-row-name";
    name.textContent = row.name;
    top.append(dot, name);
    if (current) {
      const flag = document.createElement("span");
      flag.className = "vault-row-flag";
      flag.textContent = CURRENT_FLAG;
      top.append(flag);
    }
    el.append(top, this.subLine(summaryText(row.tab_count, row.last_opened_at, now, current)));

    if (row.available) {
      el.append(this.subLine(shortPath(row.path)));
      el.addEventListener("click", () => {
        this.close(false);
        this.deps.requestSwitch(row);
      });
    } else {
      el.append(this.subLine(MISSING_TEXT, "is-warn"));
      const action = document.createElement("span");
      action.className = "vault-row-act";
      action.textContent = RELOCATE_TEXT;
      el.append(action);
      // 键盘路径与鼠标路径共用同一个落点（同一份 siblings 供占用判定）。
      el.addEventListener("click", () => {
        this.close(false);
        this.deps.requestRelocate(row, this.rowEntries);
      });
    }
    return el;
  }

  private subLine(text: string, extraClass?: string): HTMLSpanElement {
    const el = document.createElement("span");
    el.className = extraClass === undefined ? "vault-row-sub" : `vault-row-sub ${extraClass}`;
    el.textContent = text;
    return el;
  }

  private setActive(index: number): void {
    const previous = this.rows[this.activeIndex];
    if (previous) previous.classList.remove("is-active");
    this.activeIndex = index;
    const row = this.rows[index];
    if (!row) {
      this.list.removeAttribute("aria-activedescendant");
      return;
    }
    row.classList.add("is-active");
    this.list.setAttribute("aria-activedescendant", row.id);
    row.scrollIntoView({ block: "nearest" });
  }

  /** 把浮层对到入口下方（左端与入口对齐，右端不越出窗口）。 */
  private place(entry: HTMLElement): void {
    const anchor = entry.getBoundingClientRect();
    const host = this.deps.mount.getBoundingClientRect();
    const left = anchor.left - host.left;
    this.popover.style.top = `${anchor.bottom - host.top + 4}px`;
    const max = Math.max(0, host.width - this.popover.offsetWidth - 8);
    this.popover.style.left = `${Math.min(Math.max(left, 0), max)}px`;
  }

  private move(delta: number): void {
    if (this.rows.length === 0) return;
    const next = Math.min(this.rows.length - 1, Math.max(0, this.activeIndex + delta));
    if (next !== this.activeIndex) this.setActive(next);
  }

  /** 键盘游标（rows 下标）映射回列表行（rows 只含可用行）。 */
  private activeRow(): VaultListEntry | undefined {
    const el = this.rows[this.activeIndex];
    if (el === undefined) return undefined;
    return this.rowEntries.find((row) => row.id === el.dataset.vault);
  }

  private onKeydown(event: KeyboardEvent): void {
    const token = keyToken(event);
    if (token === null) return;
    switch (token) {
      // ⌃N / ⌃P 是 Emacs 的 next-line / previous-line，与 ↑↓ 完全等价（同一落点、同一钳制），
      // 共用 move() 这一份实现——浮层里 MUST NOT 有第二套下标逻辑（与大纲浮层 M157 同口径）。
      case "ArrowDown":
      case "Ctrl-N":
        this.move(1);
        break;
      case "ArrowUp":
      case "Ctrl-P":
        this.move(-1);
        break;
      case "Enter": {
        const row = this.activeRow();
        if (row === undefined) return;
        if (!row.available) {
          this.close(false);
          this.deps.requestRelocate(row, this.rowEntries);
        } else if (row.id === this.currentId) {
          this.close(); // 切到自己没有语义：只收起浮层，不做一次无谓的重载
        } else {
          this.close(false);
          this.deps.requestSwitch(row);
        }
        break;
      }
      case "Escape":
        this.close();
        break;
      default:
        return; // 其余键不消费：浮层不是模态，Tab 等照常走原生焦点路径
    }
    event.preventDefault();
  }
}

/** 命令错误信封 / 任意异常 → 人话（与 ipc.ts 的 errorMessage 同口径；本模块不 import
 *  ipc.ts，避免让纯逻辑单测把 Tauri 运行时拖进来）。 */
function errorText(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const message = (e as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(e);
}
