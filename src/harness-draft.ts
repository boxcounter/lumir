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

import type { ComposerAttachment } from "./quote-card";
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
  schedule(text: string, caret: number | null, cards: readonly ComposerAttachment[]): void;
  /** 把待写内容立刻落盘（切 vault 前、面板关闭、窗口失焦 / 退出）。无待写则不写盘。 */
  flush(): Promise<void>;
  /** 丢弃待写内容（装载新 vault 时：旧 vault 的待写已由该次切换前的 flush 写走）。 */
  discard(): void;
  /** 读回**归属 vault** 的草稿（无草稿 / 损坏 → `null`）；`vaultId` 自此成为本 store 的归属
   *  （缺省 / `null` = 无 vault，读写静默 no-op）。内部先丢弃上一 vault 的待写。 */
  load(vaultId?: string | null): Promise<ComposerDraftLoaded | null>;
  /** 清除归属 vault 的草稿（发送成功后）：取消待写 + 删文件。 */
  clear(): Promise<void>;
}

/** [`HarnessDraftStore.load`] 的返回：v2 文本、附件与全文光标。 */
export interface ComposerDraftLoaded {
  text: string;
  caret: number | null;
  cards: ComposerAttachment[];
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

  function schedule(text: string, caret: number | null, cards: readonly ComposerAttachment[]): void {
    editGeneration += 1;
    const draftJson = serializeComposerDraft(text, caret, cards);
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
    const { draft, migrated } = parsed;
    const normalized = serializeComposerDraft(draft.text, draft.caret, draft.cards);
    // 检查与 write 入链之间没有 await：新编辑要么让旧迁移写整体跳过，要么排在已入链的写之后。
    if (epoch === loadEpoch && editGeneration === loadEditGeneration) {
      if (migrated) await write(normalized, vaultId);
      else written = normalized;
    }
    return { text: draft.text, caret: draft.caret, cards: draft.cards };
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

  return { schedule, flush, discard, load, clear };
}
