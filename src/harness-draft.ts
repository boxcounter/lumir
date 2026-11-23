// composer 草稿的跨进程持久化（change composer-draft-persistence design §4/§5/§7）：防抖捕获、
// 整份落盘、无变更不写、离散时点 flush、装载时读回、发送成功后清除。
//
// 模块边界（谁在哪）：
//   - **形状与 (反)序列化**在 src/quote-card.ts（`serializeComposerDraft` / `parseComposerDraft`，
//     唯一实现点）；
//   - **落盘纪律**在 Rust（`src-tauri/src/harness/draft.rs`：tmp+rename 原子替换、vault 稳定 id
//     目录名校验、无 vault 静默不落盘、写失败返回错误信封）；
//   - **装配时机**在 src/harness-panel.ts（哪个时点 schedule / flush / 恢复 / 清除）。
//   本模块只回答「什么时候写、写什么、什么时候不写」以及「后端 mutation 的次序」（写与删除
//   都经一条串行链：并发会让 rename 压在 remove 之后，把已发送内容复活成草稿）——零 DOM
//   （防抖窗口 / 无变更不写 / flush / 切换丢弃待写都在 tests/unit 直接驱动）。
//
// 为什么与阅读位置（`src/reading-position.ts`）分开而不是复用它：那份的键是**vault 相对路径**
// （一个 vault 一份表，键在表内），草稿是**一个 vault 一份整体内容**、按 vault 稳定 id 编址。
// 两者的键、载荷与 flush 语义都不同，复用会把两套语义糊在一处（REVIEW.md「同一语义两处真源」条：同一语义不造两处真源——反过来，不同语义也不该塞进一处）。
//
// **归属在出发时绑定**（change fix-draft-vault-ownership-nov19）：store 在 `load(vaultId)`
// 时记下归属，此后每次写 / 清除都把该 id 随载荷下发，后端只按 id 解析落点。切 vault 前发出
// 的在途写无论何时执行都只落**旧** vault 的文件——不再依赖「命令执行时的当前 vault scope」
// （那会把迟到写写进新 vault，且新 vault 下次装载会把它当成自己的草稿恢复）。

import type { PlacedAttachment, PlacedAttachmentInput } from "./harness-composer";
import { readComposerDraft, serializeComposerDraft } from "./quote-card";

/**
 * 落盘防抖窗口（ms）：编辑停顿后合并到这一档落盘一次。与标签会话的 `SESSION_WRITE_DEBOUNCE_MS`
 * 和阅读位置的 `READING_POSITION_DEBOUNCE_MS` **同值同族**——草稿是 KB 级、写一次可忽略，
 * 但它是「用户没发出去的字」，丢一次就是一次可感知的丢失；窗口内的崩溃只能恢复到上一次落盘
 * （best-effort 边界，如实声明，design §4）。
 */
export const DRAFT_WRITE_DEBOUNCE_MS = 1000;

/** 存储依赖（装配层注入；单测注入桩）。归属 vault 由 store 在 `load` 时绑定，随每次读写下发。 */
export interface HarnessDraftStoreDeps {
  /** 读**归属 vault** 的草稿原文；无草稿 / 无 vault → `null`（后端口径）。 */
  getDraft(vaultId: string | null): Promise<string | null>;
  /** 写**归属 vault** 的草稿原文（写失败 reject 错误信封，由 `warn` 降级为人话提示）。
   *  归属在写 / 清除的出发点捕获——载荷在前、归属在后（桩可以只读载荷）。 */
  putDraft(draftJson: string, vaultId: string | null): Promise<void>;
  /** 写失败的人话出口（**只降级，不阻断输入**；错误信封原样交给装配层按 code 取文案）。 */
  warn(error: unknown): void;
  /** 防抖窗口（单测注入短窗口；缺省 [`DRAFT_WRITE_DEBOUNCE_MS`]）。 */
  debounceMs?: number;
}

export interface HarnessDraftStore {
  /** composer 内容变化后调用（防抖落盘；与「上次已落盘的内容」相同则不排期）。 */
  schedule(text: string, caret: number | null, cards: readonly PlacedAttachment[]): void;
  /** 把待写内容立刻落盘（切 vault 前、面板关闭、窗口失焦 / 退出）。无待写则不写盘。 */
  flush(): Promise<void>;
  /** 丢弃待写内容（装载新 vault 时：旧 vault 的待写已由该次切换前的 flush 写走）。 */
  discard(): void;
  /** 读回**归属 vault** 的草稿（无草稿 / 损坏 → `null`）；`vaultId` 自此成为本 store 的归属
   *  （缺省 / `null` = 无 vault，读写静默 no-op）。内部先丢弃上一 vault 的待写。 */
  load(vaultId?: string | null): Promise<ComposerDraftLoaded | null>;
  /** **只读编辑版本**（当前 bound vault 的那一份）：`schedule` 每次递增该 vault 的版本（内容 /
   *  光标 / 卡片变化同权，即使序列化结果相同）；别的 vault 的编辑不影响它。发送时定格，成功
   *  回执据此判断「发送之后有没有新编辑」——MUST NOT 用文本比较替代（用户可能重打相同的字）。 */
  editVersion(): number;
  /** 按**发送时定格的归属**（vault + 该 vault 的编辑版本）清除已发送内容的草稿（成功回执的
   *  唯一入口；语义与分支见实现注释）。 */
  clearSent(vaultId: string | null, version: number): Promise<void>;
  /** 清除归属 vault 的草稿（发送成功后）：取消待写 + 删文件。 */
  clear(): Promise<void>;
}

/** [`HarnessDraftStore.load`] 的返回：v3 归一文本、精确偏移附件与全文光标。 */
export interface ComposerDraftLoaded {
  text: string;
  caret: number | null;
  cards: PlacedAttachmentInput[];
}

export function createHarnessDraftStore(deps: HarnessDraftStoreDeps): HarnessDraftStore {
  const debounceMs = deps.debounceMs ?? DRAFT_WRITE_DEBOUNCE_MS;
  /** 待写内容（`null` = 没有待写）。防抖窗口内累积的最新一份，flush 时一次写走。 */
  let pending: string | null = null;
  /** 上次已落盘的内容（`null` = 未知——尚未读回 / 尚未写过）。「无变更不写」的比对基准。 */
  let written: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 后端 mutation 的串行链：一次写 / 一次删除落定之后才发出下一次（见 [`enqueue`]）。 */
  let chain: Promise<unknown> = Promise.resolve();
  /** 归属 vault 稳定 id（`load` 时绑定；`null` = 无 vault）。读写的落点只认它——在途期间
   *  后端切了 vault 也不改这次操作的目的地（change fix-draft-vault-ownership-nov19）。 */
  let boundVaultId: string | null = null;
  /** 作废世代：`discard`（切 vault / clear 的取消待写）递增。**在途写**落地时若世代已变，
   *  它不再回填待写、也不更新「已落盘」基准——那次写属于已经被作废的那一版内容。 */
  let epoch = 0;
  /** 装载世代：读盘是异步的，读盘途中再次装载 vault 时本次结果整体作废（同阅读位置的让位
   *  规则）。它守的是**store 内部状态**；装配层渲染侧另有一道世代（面板自己的 draftSeq）。 */
  let loadGen = 0;
  let editGeneration = 0;
  /** **每个 vault（含 null）各一份编辑版本**：`schedule` 只递增当前 `boundVaultId` 的那一份。
   *  成功回执的归属判据用它（发送时定格 `(vault, version)`）——别的 vault 的编辑不推进它的
   *  版本，所以「在 B 里编辑过、切回 A 未编辑」不会被误判成 A 有新编辑；反过来，A 内发送后
   *  继续编辑再切走，A 的版本已经前进，回执跨 vault 到达也会被跳过（不删更晚的草稿）。
   *  全局 `editGeneration` 仍然保留，但它只服务 store 内部的写竞态（`write` / `load` 的
   *  失败回填判据），不再承担回执归属。 */
  const vaultEditVersion = new Map<string | null, number>();
  /** **每个 vault（含 null）最近一次 `schedule` 的序列化内容**：`schedule` 在「无变更不写」
   *  早退**之前**记录，所以重打相同内容（不排期、无 pending）也留得下。跨 vault 的删除已在
   *  IPC 途中时，用户在这期间的新内容只能靠它在链尾补写（见 `clearSent` 的 repair）。 */
  const latestDraft = new Map<string | null, string>();

  function cancelTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  /**
   * 把一次后端 mutation 排进串行链：前一次落定之后才发出下一次。
   *
   * **为什么必须串行**（review r1 的 P2-2）：写是 tmp + rename、清除是 remove，两条 IPC 并发
   * 时**次序无保证**——在途的 rename 落在 remove 之后，盘上就留下一份「已发送内容」的草稿，
   * 下次装载把它恢复回来（发出去的字复活）。串行之后，`clear` 的删除必然排在在途写之后。
   */
  function enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = chain.then(op, op);
    chain = run.then(
      () => undefined,
      () => undefined, // 前一次失败不阻塞后续：错误由各 op 自己消化（降级为人话 warning）
    );
    return run;
  }

  /** 写盘：失败只降级（warn）+ 把「这份内容还没落盘」留在待写，**MUST NOT** 谎报已保存
   *  （`written` 不动，下一次比对照旧认为「盘上没有这份内容」）。成功记账守作废世代；
   *  失败回填还必须持有入链时的编辑世代，避免覆盖已入链的新编辑。`vaultId` 是**出发点**
   *  绑定的归属（调用方在把内容交给本函数时捕获），不随之后切 vault 改变。 */
  function write(draftJson: string, vaultId: string | null): Promise<void> {
    const gen = epoch;
    const writeEditGeneration = editGeneration;
    return enqueue(async () => {
      try {
        await deps.putDraft(draftJson, vaultId);
        // 期间发生过 clear / 切 vault（世代变了）：这次写属于被作废的那一版内容，不许再记账
        // ——否则 clear 设的 `written = ""` 会被改回旧内容，用户接着打同样的字会被「无变更
        // 不写」吞掉（盘上其实没有那份）。文件本身由串行链上的那次删除收尾。
        if (gen === epoch) written = draftJson;
      } catch (e) {
        // 只有期间没有更新编辑时，这份失败写仍拥有待写槽。新编辑即使已 flush、暂时清空 pending，
        // 也已递增 editGeneration；旧写不得借 `??=` 回填并在下一次 flush 覆盖新内容。
        if (gen === epoch && editGeneration === writeEditGeneration) pending ??= draftJson;
        deps.warn(e);
      }
    });
  }

  function schedule(text: string, caret: number | null, cards: readonly PlacedAttachment[]): void {
    editGeneration += 1;
    // 归属编辑版本只推进当前 bound vault 的那一份（发送回执按它判「发送后有没有新编辑」）。
    // 即使下面的「无变更不写」提前返回也照增：重打相同的字 / 只动 caret 也算用户动过草稿。
    vaultEditVersion.set(boundVaultId, (vaultEditVersion.get(boundVaultId) ?? 0) + 1);
    const draftJson = serializeComposerDraft(text, caret, cards.map(({ card, anchor }) => ({ card, at: anchor })));
    // 先记 latest、再允许「无变更不写」早退：重打相同内容不会被排期（没有 pending），但删除
    // 在途时的链尾补写要能拿到它（MUST NOT 用 `written` 推断——删除会把盘上那份拿掉）。
    latestDraft.set(boundVaultId, draftJson);
    // 内容没变就不排期：每次击键都重排定时器等于「一直在防抖窗口里」——用户连续编辑时永远
    // 不落盘。光标变化也算变更（落位要跟着走），但它不与内容分开排期：同一次 schedule 里带上。
    if (draftJson === (pending ?? written)) return;
    pending = draftJson;
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, debounceMs);
  }

  async function flush(): Promise<void> {
    cancelTimer();
    if (pending === null) return; // 无待写不写盘（与阅读位置同口径：没有新信息就不落一份）
    const draftJson = pending;
    // 出发时绑定：这次写的归属在此刻定格，入链后在途期间切 vault 也不改目的地。
    const vaultId = boundVaultId;
    pending = null;
    await write(draftJson, vaultId);
  }

  function discard(): void {
    cancelTimer();
    pending = null;
    // 作废一切在途写的下落（回填待写 / 更新「已落盘」基准都不再适用）：调用点都是「这一版内容
    // 已经不该再由本 store 负责」——切 vault 装载（旧 vault 的待写已由切换前的 flush 写走）、
    // 发送成功后的清除（内容已进会话）。
    epoch += 1;
  }

  async function load(vaultId: string | null = null): Promise<ComposerDraftLoaded | null> {
    // 归属就此绑定：本次装载的读、以及之后的一切写 / 清除都只认这个 id（null = 无 vault）。
    boundVaultId = vaultId;
    // 上一次装载留下的待写内容属于上一个 vault：归属已经换了，留着就会把旧 vault 的草稿写进
    // 新 vault 的文件。丢弃——它已由切换前的 flush 写走。
    discard();
    const gen = (loadGen += 1);
    const loadEpoch = epoch;
    const loadEditGeneration = editGeneration;
    let text: string | null = null;
    try {
      text = await deps.getDraft(vaultId);
    } catch {
      text = null; // 读不到等价于「没有草稿」，不影响这次装载（spec：安静回落）
    }
    if (gen !== loadGen) return null; // 读盘途中又装载了一次：本次结果作废
    if (text === null) {
      if (epoch === loadEpoch && editGeneration === loadEditGeneration) written = null;
      return null;
    }
    const parsed = readComposerDraft(text);
    if (parsed === null) {
      if (epoch === loadEpoch && editGeneration === loadEditGeneration) written = null;
      return null;
    }
    const { draft, migrated, changed } = parsed;
    const normalized = serializeComposerDraft(draft.text, draft.caret, draft.cards);
    // 检查与 write 入链之间没有 await：新编辑要么让旧迁移写整体跳过，要么排在已入链的写之后。
    if (epoch === loadEpoch && editGeneration === loadEditGeneration) {
      if (migrated || changed) await write(normalized, vaultId);
      else written = normalized;
    }
    return {
      text: draft.text,
      caret: draft.caret,
      cards: draft.cards.map(({ card, at }) => ({ card, anchor: at })),
    };
  }

  async function clear(): Promise<void> {
    // 发送成功后：取消窗口里那一份旧内容的待写 + 作废在途写（否则它会在 1s 后把已发送的内容
    // 写回盘上），再删文件——**删除排在串行链上**，必然落在在途写之后（P2-2：防 rename 压在
    // remove 之后把已发送内容复活成草稿）。删除失败由后端降级（stderr，不当成保存失败报出来）；
    // 这里只兜住取配置目录失败这类更早的错误——它不影响「内容已进会话」这个事实，也不该把发送
    // 路径上的 promise 变成 reject。归属在调用时捕获（发送回执与切 vault 交叠时也只删这份）。
    discard();
    written = "";
    const vaultId = boundVaultId;
    await enqueue(async () => {
      try {
        await deps.putDraft("", vaultId);
      } catch (e) {
        deps.warn(e);
      }
    });
  }

  /** 当前 bound vault 的编辑版本（发送时定格；其他 vault 的编辑不影响它）。 */
  function editVersion(): number {
    return vaultEditVersion.get(boundVaultId) ?? 0;
  }

  /**
   * 按**发送时定格**的归属（vault + 该 vault 的编辑版本）清除已发送内容的草稿——成功回执的
   * 唯一入口。归属按**目标 vault 自己的版本**判，不按全局计数、也不按调用时的绑定：
   *
   * - **目标 vault 的版本 ≠ 发送时版本**（发送后在这个 vault 里又编辑过）：无论当前 bound 是
   *   不是它，一律跳过——那份草稿是发送之后的输入，不能被这轮回执取消或删除。判据是编辑
   *   版本，MUST NOT 用文本比较（用户可能重打相同的字）。
   * - **版本相等且目标就是当前 bound**：沿用 [`clear`]——取消待写、作废在途写、`written`
   *   归空、串行删除（最常见的立即回执；切回原 vault 未编辑也走这里）。
   * - **版本相等但目标不是当前 bound**（发送后切了 vault、原 vault 没有再编辑）：走
   *   [`deleteCrossBoundWithRepair`] 的两阶段防护（执行前复检 + 删除在途期间编辑的链尾补写）。
   *
   * 版本按 vault 分账：在 B 里编辑只推进 B 的版本，不会让 A 的已发送草稿被「误判成有新编辑」
   * 而留下；A 内发送后继续编辑再切走，A 的版本已经前进，跨 vault 的回执同样跳过。
   */
  function clearSent(vaultId: string | null, version: number): Promise<void> {
    if ((vaultEditVersion.get(vaultId) ?? 0) !== version) return Promise.resolve();
    if (vaultId === boundVaultId) return clear();
    return deleteCrossBoundWithRepair(vaultId, version);
  }

  /**
   * 跨 bound 的删除（目标 vault 不是当前绑定）+ 两阶段防护：
   *
   * 1. **执行前复检**：入队到真正执行之间，用户可能已经切回目标 vault 并编辑（版本前进）。
   *    此时**不发送删除**——文件还在、版本已变，现有 `schedule` / `flush` 负责把它落盘。
   *    队列里的删除若照发，会删掉「重打相同内容」的那份（无 pending、written 又相等 ⇒
   *    flush 不会补），这是本条防护要堵的现场。
   * 2. **删除已发出（IPC 在途）无法撤回**：删除落定后若目标版本又变了，用该 vault 的
   *    `latestDraft` 在**链尾**补写（不经过 `schedule` 的「无变更不写」，也不因
   *    `draftJson === written` 跳过）。无论删除成功 / 失败都按版本判断——失败时文件还在，
   *    补写把最新内容再落一遍；成功时文件已没，补写就是唯一救回路径。
   *
   * **不自死锁**：repair 不在删除的 enqueue 回调里 `await`（那会等自己所在的链）；删除的
   * promise 落定后再排下一次 enqueue。
   */
  function deleteCrossBoundWithRepair(vaultId: string | null, version: number): Promise<void> {
    const deletion = enqueue(async (): Promise<"skipped" | number> => {
      // 执行前复检：排队期间版本变了就整条跳过（不发送删除，也不修复——交给 schedule）。
      if ((vaultEditVersion.get(vaultId) ?? 0) !== version) return "skipped";
      const startedVersion = vaultEditVersion.get(vaultId) ?? 0;
      try {
        await deps.putDraft("", vaultId);
        // 删除已落盘：若此刻目标正是当前 bound（用户切回来了），`written` 必须同步为「盘上
        // 没有这份」——否则同内容重打会被「无变更不写」吞掉，flush 也不补。
        if (vaultId === boundVaultId) written = "";
      } catch (e) {
        deps.warn(e);
      }
      return startedVersion;
    });
    return deletion.then((startedVersion) => {
      if (startedVersion === "skipped") return;
      // IPC 已发出：删除落定后按目标 vault 的最新版本判断是否需要链尾补写。
      if ((vaultEditVersion.get(vaultId) ?? 0) === startedVersion) return;
      const latest = latestDraft.get(vaultId);
      if (latest === undefined) return;
      return repairWrite(vaultId, latest);
    });
  }

  /**
   * 链尾补写（删除在途期间的新内容）：直接 enqueue 一次 put，**不经过** `schedule` 的无变更
   * 判据——删除已经把盘上那份拿掉，`written` 可能仍等于要补的内容，按它跳过就等于丢字。
   * 目标仍是当前 bound 时同步 `written` / `pending`：补写成功且仍是最新内容 ⇒ 清掉同内容的
   * 待写（盘上已就位）；失败且内容仍是最新 ⇒ 放回待写让下一次 flush 重试。
   */
  function repairWrite(vaultId: string | null, draftJson: string): Promise<void> {
    return enqueue(async () => {
      try {
        await deps.putDraft(draftJson, vaultId);
        if (vaultId === boundVaultId) {
          written = draftJson;
          if (pending === draftJson) {
            pending = null;
            cancelTimer();
          }
        }
      } catch (e) {
        if (vaultId === boundVaultId && latestDraft.get(vaultId) === draftJson) pending ??= draftJson;
        deps.warn(e);
      }
    });
  }

  return { schedule, flush, discard, load, clear, editVersion, clearSent };
}
