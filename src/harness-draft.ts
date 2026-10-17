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
// （一个 vault 一份表，键在表内），草稿是**一个 vault 一份整体内容**、按 vault 稳定 id 编址且落点
// 由后端按当前 scope 解析（前端不持有 id）。两者的键、载荷与 flush 语义都不同，复用会把两套
// 语义糊在一处（REVIEW.md 「同一语义两处真源」条：同一语义不造两处真源——反过来，不同语义也不该塞进一处）。

import type { ComposerBlock, DraftCaret } from "./quote-card";
import { parseComposerDraft, serializeComposerDraft } from "./quote-card";

/**
 * 落盘防抖窗口（ms）：编辑停顿后合并到这一档落盘一次。与标签会话的 `SESSION_WRITE_DEBOUNCE_MS`
 * 和阅读位置的 `READING_POSITION_DEBOUNCE_MS` **同值同族**——草稿是 KB 级、写一次可忽略，
 * 但它是「用户没发出去的字」，丢一次就是一次可感知的丢失；窗口内的崩溃只能恢复到上一次落盘
 * （best-effort 边界，如实声明，design §4）。
 */
export const DRAFT_WRITE_DEBOUNCE_MS = 1000;

/** 存储依赖（装配层注入；单测注入桩）。落点与会话作用域全在后端，前端不传 vault。 */
export interface HarnessDraftStoreDeps {
  /** 读当前 vault 的草稿原文；无草稿 / 无 vault → `null`（后端口径）。 */
  getDraft(): Promise<string | null>;
  /** 写当前 vault 的草稿原文（写失败 reject 错误信封，由 `warn` 降级为人话提示）。 */
  putDraft(draftJson: string): Promise<void>;
  /** 写失败的人话出口（**只降级，不阻断输入**；错误信封原样交给装配层按 code 取文案）。 */
  warn(error: unknown): void;
  /** 防抖窗口（单测注入短窗口；缺省 [`DRAFT_WRITE_DEBOUNCE_MS`]）。 */
  debounceMs?: number;
}

export interface HarnessDraftStore {
  /** composer 内容变化后调用（防抖落盘；与「上次已落盘的内容」相同则不排期）。 */
  schedule(blocks: readonly ComposerBlock[], caret: DraftCaret | null): void;
  /** 把待写内容立刻落盘（切 vault 前、面板关闭、窗口失焦 / 退出）。无待写则不写盘。 */
  flush(): Promise<void>;
  /** 丢弃待写内容（装载新 vault 时：旧 vault 的待写已由该次切换前的 flush 写走）。 */
  discard(): void;
  /** 读回当前 vault 的草稿（无草稿 / 损坏 → `null`）；内部先丢弃上一 vault 的待写。 */
  load(): Promise<ComposerDraftLoaded | null>;
  /** 清除草稿（发送成功后）：取消待写 + 删文件。 */
  clear(): Promise<void>;
}

/** [`HarnessDraftStore.load`] 的返回：块序列 + 恢复用的光标落位。 */
export interface ComposerDraftLoaded {
  blocks: ComposerBlock[];
  caret: DraftCaret | null;
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
  /** 作废世代：`discard`（切 vault / clear 的取消待写）递增。**在途写**落地时若世代已变，
   *  它不再回填待写、也不更新「已落盘」基准——那次写属于已经被作废的那一版内容。 */
  let epoch = 0;
  /** 装载世代：读盘是异步的，读盘途中再次装载 vault 时本次结果整体作废（同阅读位置的让位
   *  规则）。它守的是**store 内部状态**；装配层渲染侧另有一道世代（面板自己的 draftSeq）。 */
  let loadGen = 0;

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
   *  （`written` 不动，下一次比对照旧认为「盘上没有这份内容」）。两条回填 / 记账都带世代守卫。 */
  function write(draftJson: string): Promise<void> {
    const gen = epoch;
    return enqueue(async () => {
      try {
        await deps.putDraft(draftJson);
        // 期间发生过 clear / 切 vault（世代变了）：这次写属于被作废的那一版内容，不许再记账
        // ——否则 clear 设的 `written = ""` 会被改回旧内容，用户接着打同样的字会被「无变更
        // 不写」吞掉（盘上其实没有那份）。文件本身由串行链上的那次删除收尾。
        if (gen === epoch) written = draftJson;
      } catch (e) {
        // 回填**只在期间没有更新的编辑**时发生（`??=`）：在途写失败 MUST NOT 把用户刚打的新
        // 内容覆盖回旧内容（review r1 的 P2-1）——新内容自带防抖定时器，会自己写走。
        if (gen === epoch) pending ??= draftJson;
        deps.warn(e);
      }
    });
  }

  function schedule(blocks: readonly ComposerBlock[], caret: DraftCaret | null): void {
    const draftJson = serializeComposerDraft(blocks, caret);
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
    pending = null;
    await write(draftJson);
  }

  function discard(): void {
    cancelTimer();
    pending = null;
    // 作废一切在途写的下落（回填待写 / 更新「已落盘」基准都不再适用）：调用点都是「这一版内容
    // 已经不该再由本 store 负责」——切 vault 装载（旧 vault 的待写已由切换前的 flush 写走）、
    // 发送成功后的清除（内容已进会话）。
    epoch += 1;
  }

  async function load(): Promise<ComposerDraftLoaded | null> {
    // 上一次装载留下的待写内容属于上一个 vault：键已经换了（后端按当前 scope 解析落点），
    // 留着就会把旧 vault 的草稿写进新 vault 的文件。丢弃——它已由切换前的 flush 写走。
    discard();
    const gen = (loadGen += 1);
    let text: string | null = null;
    try {
      text = await deps.getDraft();
    } catch {
      text = null; // 读不到等价于「没有草稿」，不影响这次装载（spec：安静回落）
    }
    if (gen !== loadGen) return null; // 读盘途中又装载了一次：本次结果作废
    if (text === null) {
      written = null;
      return null;
    }
    const draft = parseComposerDraft(text);
    if (draft === null) {
      written = null; // 损坏 / 版本不符：盘上那份不可用，下一次落盘直接覆盖它
      return null;
    }
    // 比对基准用**本实现的规范序列化**（不是文件原文）：手改过格式 / 换过键序的文件在
    // 下一次编辑时被规范形态覆写一次，此后「无变更不写」照常生效。
    written = serializeComposerDraft(draft.blocks, draft.caret);
    return { blocks: draft.blocks, caret: draft.caret };
  }

  async function clear(): Promise<void> {
    // 发送成功后：取消窗口里那一份旧内容的待写 + 作废在途写（否则它会在 1s 后把已发送的内容
    // 写回盘上），再删文件——**删除排在串行链上**，必然落在在途写之后（P2-2：防 rename 压在
    // remove 之后把已发送内容复活成草稿）。删除失败由后端降级（stderr，不当成保存失败报出来）；
    // 这里只兜住取配置目录失败这类更早的错误——它不影响「内容已进会话」这个事实，也不该把发送
    // 路径上的 promise 变成 reject。
    discard();
    written = "";
    await enqueue(async () => {
      try {
        await deps.putDraft("");
      } catch (e) {
        deps.warn(e);
      }
    });
  }

  return { schedule, flush, discard, load, clear };
}
