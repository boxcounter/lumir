// 文档阅读位置的跨会话持久化（change remember-reading-position 的 3.x / 4.x / 5.x）：
// 防抖捕获、整份落盘、装载后按本次枚举清理、装载复位之后恢复。
//
// 模块边界（谁在哪）：
//   - **值形态与两个口径**在 src/scroll-position.ts（`ScrollPosition` / `positionFromReadings` /
//     `restoreScrollTop`）：捕获要 view 的读数、恢复要 dispatch 到 view（实现在 src/editor.ts），
//     本模块只做「哪个键、什么时候读、什么时候写」。
//   - **落盘纪律**在 Rust（`src-tauri/src/reading_position.rs`）：tmp+rename、逐字段校验、上限
//     淘汰、损坏等价于无历史。本模块只消费 `getPositions` / `putPositions` 两个口子。
//   - **装载时机**在装配层（src/main.ts）：本模块的 `onVaultLoaded` 必须在「按标签列表恢复
//     标签」之前 resolve（那一步会经 openFile 走恢复），`restoreFor` 必须挂在装载复位之后。
//
// 为什么不与标签会话共用文件（design §3 候选 B 的取舍）：标签文件的写入触发点是标签集合变化，
// 位置随滚动改写——混进同一个文件会让每一次滚动牵动「打开哪些标签」这个关键状态，且那条
// requirement 的禁止语义正是「内容不含滚动位置」。两份状态各自落盘，各按自己的节奏写。
//
// 运行期内的切标签通道**一字不动**：运行期位置仍是 CM 的逐标签内存快照（`EditorSession.scroll`），
// 本模块只在装载（冷路径）上读盘与写盘。

import type { FsEntry } from "./bindings/FsEntry";
import type { ReadingPositionEntry } from "./bindings/ReadingPositionEntry";
import type { ReadingPositions } from "./bindings/ReadingPositions";
import type { ScrollPosition } from "./scroll-position";
import { errorMessage } from "./ipc";

/** 落盘防抖窗口（ms）：滚动停止后合并到这一档。与标签会话同一个量级
 *  （`src/vault-switcher.ts` 的 `SESSION_WRITE_DEBOUNCE_MS`）——位置只有几百字节，但它决定
 *  「下次打开从哪里开始」，丢一次就是一次可感知的落差。 */
export const READING_POSITION_DEBOUNCE_MS = 1000;

/** 每个 vault 的条目上限。**Rust 侧是权威**（`src-tauri/src/reading_position.rs` 的
 *  `MAX_ENTRIES`，读侧与写侧都在那里收口，手改过的文件也走那条路）；这里同值只为守住前端的
 *  内存镜像与载荷上界。两处任一处改动都要同步——跨技术栈的常量无法单向导出，这是本存储已知的
 *  一处人工同步点（Rust 侧同一常量处有对称的注释）。 */
export const READING_POSITION_MAX_ENTRIES = 200;

/** 落盘表（键 = vault 相对路径）。类型取自 ts-rs 导出的 `ReadingPositions`，不另立同义类型。 */
export type ReadingPositionMap = ReadingPositions["entries"];

export interface ReadingPositionStoreDeps {
  /** 前台文档的 vault 相对路径（捕获的键）；没有前台文件（未命名文档）时为 undefined。 */
  activePath(): string | undefined;
  /** 读当前视口的阅读位置（编辑器侧；不可读返回 null）。 */
  readPosition(): ScrollPosition | null;
  /** 施加一个阅读位置（编辑器侧；不可读 / 落点即篇首由它静默处理）。 */
  applyPosition(position: ScrollPosition): void;
  /** 读某 vault 的阅读位置表；无历史（首次 / 损坏 / 版本不符）resolve 为 null。 */
  getPositions(vaultId: string): Promise<ReadingPositions | null>;
  /** 写某 vault 的阅读位置表（整份镜像；写失败由后端降级为 warning）。 */
  putPositions(vaultId: string, entries: ReadingPositionMap): Promise<void>;
  /** 位置读写失败的人话提示（只降级，不拦停打开 / 切换 / 退出）。 */
  warn(text: string): void;
}

export interface ReadingPositionStore {
  /** 视口滚动后调用（防抖落盘；位置与待写内容相同则不排期）。 */
  scrolled(): void;
  /** 把待写内容立刻落盘（切文件 / 切标签 / 切 vault 前、退出前）。 */
  flush(): Promise<void>;
  /** 打开某文档后恢复它的位置（装载复位之后、文档已进入 view 时调用）。 */
  restoreFor(path: string): void;
  /** 装载 vault 完成：登记 vault id、读一次位置文件建内存镜像、按本次枚举清理不在 vault 内的键。 */
  onVaultLoaded(vaultId: string, entries: readonly FsEntry[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// 纯逻辑（无 DOM、无 IO，可直接单测）
// ---------------------------------------------------------------------------

/** 两个位置是否指向同一处（决定「内容没变就不排期」）。逐量精确比较：两份读数由同一段计算
 *  产出，同位置的浮点结果逐位相同；带容差会把真实的小幅移动吞掉。 */
export function samePosition(a: ScrollPosition, b: ScrollPosition): boolean {
  return a.pos === b.pos && a.y === b.y && a.x === b.x;
}

/** 上限淘汰：按写入时刻（`at`）最旧者淘汰，同一时刻按键名定序（结果与对象遍历顺序无关，
 *  因此可断言）。Rust 侧的同名规则是权威（见 `READING_POSITION_MAX_ENTRIES`）。 */
export function capEntries(
  entries: ReadingPositionMap,
  limit = READING_POSITION_MAX_ENTRIES,
): ReadingPositionMap {
  const keys = Object.keys(entries);
  if (keys.length <= limit) return { ...entries };
  keys.sort((a, b) => {
    const diff = (entries[a]?.at ?? 0) - (entries[b]?.at ?? 0);
    return diff !== 0 ? diff : a < b ? -1 : a > b ? 1 : 0;
  });
  const next: ReadingPositionMap = {};
  for (const key of keys.slice(keys.length - limit)) {
    const entry = entries[key];
    if (entry !== undefined) next[key] = entry;
  }
  return next;
}

/** 按本次枚举到的条目清理：不在 vault 内的键即时剔除（被删除 / 改名 / 移出 vault 的路径都在
 *  其中）。
 *
 *  **越界键（绝对路径 / 含 `..`）也由这一步一并剔除**——它们不可能出现在枚举结果里，因此不必
 *  在前端再抄一份键校验（Rust 的读侧已有同一份判定，REVIEW.md 第 8 条：同一语义不造两处真源）。
 *  打不开的键**只跳过不删**（权限一类的原因是临时的，spec「打不开的键 SHALL 只跳过、不删除」）：
 *  它们仍在枚举里，本函数保留它们。 */
export function pruneEntries(
  entries: ReadingPositionMap,
  available: ReadonlySet<string>,
): ReadingPositionMap {
  const next: ReadingPositionMap = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (entry === undefined) continue;
    if (!available.has(key)) continue;
    next[key] = entry;
  }
  return next;
}

/** 合并待写位置到镜像（`at` = 本次写入时刻），并做上限淘汰——**这是镜像与载荷的唯一收口**：
 *  装载时读回的超限内容（手改过的文件）也在下一次落盘时被削到上限，前端与 Rust 侧的口径一致。 */
export function mergePending(
  entries: ReadingPositionMap,
  pending: ReadonlyMap<string, ScrollPosition>,
  at: number,
): ReadingPositionMap {
  const next: ReadingPositionMap = { ...entries };
  for (const [path, position] of pending) {
    next[path] = { pos: position.pos, y: position.y, x: position.x, at };
  }
  return capEntries(next);
}

// ---------------------------------------------------------------------------
// 存储（无 DOM，可脱离浏览器单测）
// ---------------------------------------------------------------------------

export function createReadingPositionStore(
  deps: ReadingPositionStoreDeps,
): ReadingPositionStore {
  /** 写盘的键：当前 vault 的稳定 id。没有它（启动早期 / 未装载）时一切写操作都是 no-op。 */
  let currentId: string | undefined;
  /** 盘上内容的镜像（装载时读一次，此后每次打开文档只做一次查表）。 */
  let mirror: ReadingPositionMap = {};
  /** 待写位置：键 = vault 相对路径。只有前台会滚动，但用 Map 记而不是单个记录——切标签的
   *  瞬间可能同时有两个文档的位置停在窗口内，丢一个就是丢一次阅读位置。 */
  const pending = new Map<string, ScrollPosition>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 装载世代：读盘是异步的，用户可能在读盘途中切走 vault，旧 vault 的位置绝不许落到新
   *  vault 的镜像里（与标签会话恢复的让位规则同族）。 */
  let loadGen = 0;

  function cancelTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function asPosition(entry: ReadingPositionEntry | undefined): ScrollPosition | undefined {
    if (entry === undefined) return undefined;
    return { pos: entry.pos, y: entry.y, x: entry.x };
  }

  function snapshot(): ReadingPositionMap {
    return mergePending(mirror, pending, Date.now());
  }

  async function write(vaultId: string, entries: ReadingPositionMap): Promise<void> {
    try {
      await deps.putPositions(vaultId, entries);
    } catch (e) {
      // 写失败只降级（与 last_vault、标签会话写失败同口径）：位置只影响「下次打开从哪里开始」，
      // 不值得拦停用户的一次打开、切换或退出。
      deps.warn(errorMessage(e));
    }
  }

  async function flush(): Promise<void> {
    cancelTimer();
    const vaultId = currentId;
    const next = snapshot();
    pending.clear();
    mirror = next;
    if (vaultId === undefined) return; // 还没有 vault（启动路径）：没有可写的键
    await write(vaultId, next);
  }

  function scrolled(): void {
    if (currentId === undefined) return;
    const path = deps.activePath();
    if (path === undefined) return; // 前台是未命名文档：没有可记的键
    const position = deps.readPosition();
    if (position === null) return; // 锚处不可读：本次不记录，绝不写半个值
    const previous = pending.get(path) ?? asPosition(mirror[path]);
    // 位置没变就不排期：CM 的滚动锚点维护会在位置不变时也派发 scroll（装载复位、测量回落），
    // 反复重置定时器等于永不落盘；盘上已经是这一处时更没有必要再写一次。
    if (previous !== undefined && samePosition(previous, position)) return;
    pending.set(path, position);
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, READING_POSITION_DEBOUNCE_MS);
  }

  function restoreFor(path: string): void {
    if (currentId === undefined) return;
    const entry = mirror[path];
    if (entry === undefined) return; // 没有历史：从篇首开始，不给任何提示
    // 只在它仍是前台文档时施加：装载是逐标签的异步批量动作，期间用户可能已经切走——用盘上
    // 的位置拽走正在读别人的人，是这条能力最容易做错的那一处。
    if (deps.activePath() !== path) return;
    deps.applyPosition({ pos: entry.pos, y: entry.y, x: entry.x });
  }

  async function onVaultLoaded(vaultId: string, entries: readonly FsEntry[]): Promise<void> {
    currentId = vaultId;
    cancelTimer();
    // 上一次装载留下的待写内容属于上一个 vault：键已经换了，直接丢弃（它已由那次切换前的
    // flush 写走，或随那次装载作废）。
    pending.clear();
    const gen = ++loadGen;
    let file: ReadingPositions | null = null;
    try {
      file = await deps.getPositions(vaultId);
    } catch {
      file = null; // 读不到等价于「没有阅读位置历史」，不影响这次装载
    }
    if (gen !== loadGen) return; // 读盘途中又装载了一次 vault：本次结果整体作废
    // 清理挂在**已有的一次枚举**上（装载时本就拿到的全量条目表）：零新增 IO、零新增读取。
    const available = new Set(
      entries.filter((entry) => entry.kind === "file").map((entry) => entry.path),
    );
    // 上限在镜像上就收口：手改过的文件可能带来超限内容，下一次落盘（乃至内存镜像）都不许超过它。
    mirror = capEntries(pruneEntries(file?.entries ?? {}, available));
  }

  return { scrolled, flush, restoreFor, onVaultLoaded };
}
