// 持久化对抗测试（M844）：保存链路与 composer 草稿在**可控故障面**下的不变量。
//
// 为什么要有这一层：M831 终审的 P1 是一只真实发生过的读写竞态（v1 草稿迁移写回把用户
// 新输入静默覆盖），当时的取证靠人读代码 + 一两条挂起读写的用例。本层把「延迟、失败、
// 乱序、切换、外部变更、崩溃」做成可复用的故障夹具，让每一次注入都先**正观测到达注入点**
// （`FaultDeck.waitFor`），再验不变量；注入点没被命中即 FAIL，不靠「结果看起来对」空过
//（REVIEW.md 「读不到当成空」与「断言等价于子串」两条的同类防线）。
//
// 不变量（本文件的判据都归到这几条上）：
//   I1 新编辑不被旧读 / 旧写覆盖：任何在途操作的落地都不得改写比它更新的待写内容或
//      「已落盘」基准；
//   I2 保存点与 dirty 一致：写入成功只清它自己那份内容；期间继续编辑必须保持 dirty，
//      CAS 基准推进到后端返回值；失败不得清 dirty、不得推进基准；
//   I3 失败可重试：失败只降级（warn / toast），下一次 flush / ⌘S 必须真的再次到达后端；
//   I4 vault / 文档归属不串：迟到的结果只能落到它出发时的那份文档 / 那个 vault 上，
//      不得作为另一份文档的新基准，也不得把旧 vault 的草稿算到新 vault 头上。
//
// 夹具边界：假后端（tests/unit/harness.ts 的 `installBackend`）+ 故障闸（本文件）。
// 生产模块（src/save-controller.ts / src/harness-draft.ts）一行不改——这一层测的就是它们
// 自己的时序判据，替身只模拟「机器那一侧」。

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { createHarnessDraftStore } from "../../src/harness-draft.ts";
import type { ComposerAttachment } from "../../src/quote-card.ts";
import { serializeComposerDraft } from "../../src/quote-card.ts";
import { SAVE_GUARD_TOAST_CLASS, createSaveController } from "../../src/save-controller.ts";
import { commandError, createEditorDouble, createRig, createToastHost, installBackend } from "./harness.ts";
import type { Rig } from "./harness.ts";

// ---------------------------------------------------------------------------
// 故障闸：按「注入点」挂起 / 失败 / 放行，并记录到达
// ---------------------------------------------------------------------------

type FaultMode = "pass" | "hold" | "fail";

interface HeldCall {
  point: string;
  args: any;
  /** 放行（hold 模式）：body 继续执行，结果照常返回。 */
  release(): void;
  /** 以错误收场（hold 模式）：body 不执行，调用方拿到 reject。 */
  reject(error: unknown): void;
}

export interface FaultDeck {
  /** 配置某注入点的策略；缺省 pass。`after` 只对 hold 有意义：body 先执行、结果延迟交付。 */
  policy(point: string, mode: FaultMode, options?: { error?: unknown; after?: boolean }): void;
  /** 等某注入点的挂起数达到 n；没到达即抛（缺读不得空过）。 */
  waitFor(point: string, n?: number): Promise<void>;
  /** 当前挂起的调用（按到达顺序）。 */
  held(point: string): HeldCall[];
  /** 到达次数（含已放行 / 已失败）。 */
  arrivals(point: string): number;
  release(point: string): void;
  reject(point: string, error: unknown): void;
  /** 逃逸口：把所有挂起调用放行（测试异常退出时防止悬挂的 promise 拖住进程）。 */
  releaseAll(): void;
  /** 包一层 body：按策略挂起 / 失败 / 直接执行。 */
  run<T>(
    point: string,
    args: unknown,
    body: () => T | Promise<T>,
    options?: { after?: boolean },
  ): Promise<T>;
}

function createFaultDeck(): FaultDeck {
  interface Policy {
    mode: FaultMode;
    error?: unknown;
    after?: boolean;
  }
  const policies = new Map<string, Policy>();
  const counts = new Map<string, number>();
  const queues = new Map<string, HeldCall[]>();

  const queueOf = (point: string): HeldCall[] => {
    const existing = queues.get(point);
    if (existing !== undefined) return existing;
    const created: HeldCall[] = [];
    queues.set(point, created);
    return created;
  };

  return {
    policy(point, mode, options = {}) {
      policies.set(point, { mode, error: options.error, after: options.after });
    },
    async waitFor(point, n = 1) {
      for (let i = 0; i < 200; i += 1) {
        if (queueOf(point).length >= n) return;
        await new Promise((resolve) => setImmediate(resolve));
      }
      throw new Error(
        `故障注入点未到达：${point}（到达 ${counts.get(point) ?? 0} 次，挂起 ${queueOf(point).length} 个，期望挂起 ${n} 个）`,
      );
    },
    held: (point) => [...queueOf(point)],
    arrivals: (point) => counts.get(point) ?? 0,
    release(point) {
      const call = queueOf(point).shift();
      if (call === undefined) throw new Error(`没有挂起的调用可放行：${point}`);
      call.release();
    },
    reject(point, error) {
      const call = queueOf(point).shift();
      if (call === undefined) throw new Error(`没有挂起的调用可拒绝：${point}`);
      call.reject(error);
    },
    releaseAll() {
      for (const queue of queues.values()) {
        for (const call of queue.splice(0, queue.length)) call.release();
      }
    },
    async run<T>(point: string, args: unknown, body: () => T | Promise<T>, options: { after?: boolean } = {}) {
      counts.set(point, (counts.get(point) ?? 0) + 1);
      const policy = policies.get(point) ?? { mode: "pass" as const };
      if (policy.mode === "fail") throw policy.error ?? new Error(`故障注入：${point}`);
      if (policy.mode === "pass") return await body();
      const after = options.after ?? policy.after ?? false;
      // after = 结果先产生、交付延迟（模拟「读已发生 / 写已落地，只是应答在路上」）；
      // 缺省 = 执行本身被挡住（模拟「写还在磁盘上飞」）。
      const produced = after ? await body() : undefined;
      await new Promise<void>((resolve, reject) => {
        queueOf(point).push({
          point,
          args,
          release: () => resolve(),
          reject: (error) => reject(error),
        });
      });
      return after ? (produced as T) : await body();
    },
  };
}

/** 让 await 链跑完（mock timers 只接管 setTimeout，setImmediate 仍是真家伙）。 */
const flushAwait = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

// ---------------------------------------------------------------------------
// 草稿 store 的故障夹具：盘按 vault 稳定 id 分文件，写 / 读都经故障闸
// ---------------------------------------------------------------------------

/** 假后端按**显式 vault id** 分文件（M848 之后的契约）：落点只认调用方在出发点绑定的 id，
 *  无 id 归属（null）静默 no-op——不存在一个「执行时的当前 vault 作用域」供迟到操作误落。 */
interface DraftRig {
  store: ReturnType<typeof createHarnessDraftStore>;
  deck: FaultDeck;
  /** vault 稳定 id → 盘上草稿原文（undefined = 没有草稿）。 */
  drafts: Map<string, string>;
  /** 已执行（含成功清空）的写入，按**出发时绑定的 vault id** 记落点——跨 vault 判据的观测面。 */
  writes: Array<{ scope: string; value: string }>;
  warns: unknown[];
}

function createDraftRig(seed: Record<string, string> = {}): DraftRig {
  const deck = createFaultDeck();
  const drafts = new Map<string, string>(Object.entries(seed));
  const writes: DraftRig["writes"] = [];
  const warns: unknown[] = [];
  const rig: DraftRig = {
    deck,
    drafts,
    writes,
    warns,
    store: undefined as unknown as DraftRig["store"],
  };
  rig.store = createHarnessDraftStore({
    getDraft: (vaultId) =>
      deck.run("draft_get", { vaultId }, () => (vaultId === null ? null : rig.drafts.get(vaultId) ?? null), {
        after: true,
      }),
    putDraft: (draftJson, vaultId) =>
      deck.run("draft_put", { draftJson, vaultId }, () => {
        if (vaultId === null) return; // 与 Rust 侧同口径：无 vault 归属的写不落任何文件
        if (draftJson === "") rig.drafts.delete(vaultId);
        else rig.drafts.set(vaultId, draftJson);
        rig.writes.push({ scope: vaultId, value: draftJson });
      }),
    warn: (error) => void rig.warns.push(error),
    debounceMs: 1000,
  });
  return rig;
}

const CARD: ComposerAttachment = {
  kind: "quote",
  card: { file: "synth.md", heading: "H", headingPath: "H", lines: "1-1", text: "摘录" },
};
const CARDS = [{ id: 1, card: CARD, anchor: 0 }];
const LOADED_CARDS = CARDS.map(({ card, anchor }) => ({ card, anchor }));
const draft = (text: string, caret: number | null = null): string => serializeComposerDraft(
  text,
  caret,
  CARDS.map(({ card, anchor }) => ({ card, at: anchor })),
);

// ---------------------------------------------------------------------------
// 草稿：读 / 写交错
// ---------------------------------------------------------------------------

test("草稿 I1：延迟读在途时的新编辑不被旧读覆盖（旧读不得回写、不得占已落盘基准）", async () => {
  const rig = createDraftRig({ "vault-a": draft("旧草稿", 2) });
  rig.deck.policy("draft_get", "hold", { after: true });

  const loading = rig.store.load("vault-a");
  // 正观测：读确实到了注入点并挂住——否则下面验的就不是「延迟读」。
  await rig.deck.waitFor("draft_get");
  assert.deepEqual(
    rig.deck.held("draft_get")[0]!.args,
    { vaultId: "vault-a" },
    "读携带出发时绑定的 vault id（落点只认它）",
  );

  rig.store.schedule("新输入", 1, CARDS);
  await rig.store.flush();
  assert.equal(rig.drafts.get("vault-a"), draft("新输入", 1), "在途读期间的编辑已落盘");

  rig.deck.release("draft_get");
  const restored = await loading;
  assert.equal(restored?.text, "旧草稿", "旧读的结果确实被交付（证明这条路径真的跑了）");
  assert.equal(rig.drafts.get("vault-a"), draft("新输入", 1), "旧读不得把旧内容写回盘上");
  assert.equal(rig.warns.length, 0);

  // 关键回归面：旧读若错误地更新了 written 基准，用户把内容改回旧草稿时会被「无变更不写」
  // 吞掉——盘上仍是「新输入」，界面却以为「旧草稿」已保存。这里要求它真的写。
  rig.store.schedule("旧草稿", 2, CARDS);
  await rig.store.flush();
  assert.equal(rig.drafts.get("vault-a"), draft("旧草稿", 2), "改回旧内容仍必须落盘（基准未被旧读污染）");
  assert.deepEqual(
    rig.writes.map((write) => write.value),
    [draft("新输入", 1), draft("旧草稿", 2)],
    "两次写都到达后端（无空转、无吞写）",
  );
});

test("草稿 I4：切 vault 时迟到的读整体作废，旧 vault 的内容不得铺进新 vault", async () => {
  const rig = createDraftRig({ "vault-a": draft("A 的草稿", 1) });
  rig.deck.policy("draft_get", "hold", { after: true });

  const stale = rig.store.load("vault-a"); // A 的读，挂住
  await rig.deck.waitFor("draft_get");
  rig.deck.policy("draft_get", "pass"); // 只让 A 那次读挂住；后面的装载正常返回

  const fresh = await rig.store.load("vault-b"); // 切到 B：B 的读立刻返回（无草稿）
  assert.equal(fresh, null);
  assert.equal(rig.deck.arrivals("draft_get"), 2, "两次装载都真的读了盘");

  rig.deck.release("draft_get"); // A 的读现在才回来
  assert.equal(await stale, null, "切 vault 之后旧读结果整体作废（不得返回 A 的内容）");

  rig.store.schedule("B 的输入", 3, CARDS);
  await rig.store.flush();
  assert.deepEqual(
    rig.writes.map((write) => write.scope),
    ["vault-b"],
    "切换后的写只落在新 vault 的作用域上",
  );
  assert.equal(rig.drafts.get("vault-b"), draft("B 的输入", 3));
  assert.equal(rig.drafts.get("vault-a"), draft("A 的草稿", 1), "旧 vault 的草稿原样保留");
});

// finding 20261119-worker-persistence-faults-bug-vault-scope-vault-vault：M848 把归属绑到出发点的
// vault id 之后，这条从 `todo` 转普通 test（判据与故障交错不变）。
test("草稿 I4：在途写的落点按出发时的 vault 归属——切 vault 后落地的旧草稿不得写进新 vault", async () => {
  const rig = createDraftRig();
  await rig.store.load("vault-a"); // 装载即绑定归属
  rig.deck.policy("draft_put", "hold"); // 写已入链、停在执行前
  rig.store.schedule("A 的草稿", 1, CARDS);
  const flushing = rig.store.flush();
  await rig.deck.waitFor("draft_put");
  assert.equal(
    rig.deck.held("draft_put")[0]!.args.vaultId,
    "vault-a",
    "写带着出发时绑定的 vault id 到达后端",
  );

  await rig.store.load("vault-b"); // 后端切到 B 之后，这次写才真正执行；新 vault 装载丢弃旧待写
  rig.deck.release("draft_put");
  await flushing;

  // 归属不变量：写只能落在它出发时的 vault（A）——落点不接受「执行时的当前 vault」。
  assert.deepEqual(
    rig.writes.map((write) => write.scope),
    ["vault-a"],
    "在途写不得因为后端先切了 vault 而落到新 vault 上",
  );
  assert.equal(rig.drafts.get("vault-a"), draft("A 的草稿", 1));
  assert.equal(rig.drafts.get("vault-b"), undefined, "新 vault 的草稿盘不得被旧 vault 的内容写入");
});

test("草稿 I3：旧写在途时新写已入链——旧写失败后重试写的是新内容，不复活旧内容", async () => {
  const rig = createDraftRig();
  await rig.store.load("vault-a");
  rig.deck.policy("draft_put", "hold");

  rig.store.schedule("第一版", null, CARDS);
  const first = rig.store.flush();
  await rig.deck.waitFor("draft_put");
  assert.equal(rig.deck.held("draft_put")[0]!.args.draftJson, draft("第一版"), "旧写确实在途");

  rig.store.schedule("第二版", 4, CARDS);
  const second = rig.store.flush();
  await flushAwait();
  assert.equal(rig.deck.arrivals("draft_put"), 1, "串行链：旧写未落定，新写不得发出（乱序返回因此不可达）");
  assert.equal(rig.drafts.get("vault-a"), undefined, "旧写尚未执行");

  rig.deck.reject("draft_put", commandError("harness_draft_write_failed", "磁盘已满"));
  await first;
  await rig.deck.waitFor("draft_put"); // 新写紧接着入链并到达
  assert.equal(rig.deck.held("draft_put")[0]!.args.draftJson, draft("第二版", 4), "排在后面的写是新内容");
  rig.deck.release("draft_put");
  await second;

  assert.equal(rig.warns.length, 1, "旧写失败降级为一条 warning");
  assert.equal(rig.drafts.get("vault-a"), draft("第二版", 4), "最终落盘 = 新内容");
  assert.deepEqual(
    rig.writes.map((write) => write.value),
    [draft("第二版", 4)],
    "失败那份从未落盘；新写是唯一成功的写入",
  );

  // 缺陷若回归（旧失败把内容回填进待写），下面这次 flush 会再发一笔；闸放行以便它快速暴露，
  // 而不是把测试挂在「等待一个不该发生的写」上。
  rig.deck.policy("draft_put", "pass");
  await rig.store.flush();
  assert.equal(rig.deck.arrivals("draft_put"), 2, "无待写时不得再写（旧内容没有借失败回填复活）");
  assert.equal(rig.drafts.get("vault-a"), draft("第二版", 4), "盘上仍是新内容");
});

test("草稿 I3：旧写失败且期间无新编辑——内容留待下一次 flush 重试", async () => {
  const rig = createDraftRig();
  await rig.store.load("vault-a");
  rig.deck.policy("draft_put", "hold");

  rig.store.schedule("唯一一版", 1, CARDS);
  const first = rig.store.flush();
  await rig.deck.waitFor("draft_put");
  rig.deck.reject("draft_put", commandError("harness_draft_write_failed", "权限不足"));
  await first;
  assert.equal(rig.warns.length, 1);
  assert.equal(rig.drafts.get("vault-a"), undefined, "失败不得产生「已落盘」的假象");

  rig.deck.policy("draft_put", "pass");
  await rig.store.flush();
  assert.equal(rig.deck.arrivals("draft_put"), 2, "重试真的再次到达后端");
  assert.equal(rig.drafts.get("vault-a"), draft("唯一一版", 1), "重试写走的还是那份内容");
});

test("草稿 I3：写失败后紧接发送清除——删除仍排在写之后，不因失败而跳过", async () => {
  const rig = createDraftRig();
  await rig.store.load("vault-a");
  rig.deck.policy("draft_put", "hold");

  rig.store.schedule("要发出去的内容", null, CARDS);
  const flushing = rig.store.flush();
  await rig.deck.waitFor("draft_put");

  const clearing = rig.store.clear();
  await flushAwait();
  assert.equal(rig.deck.arrivals("draft_put"), 1, "清除必须排在进行中的写之后");

  rig.deck.reject("draft_put", commandError("harness_draft_write_failed", "磁盘满"));
  await flushing;
  await rig.deck.waitFor("draft_put");
  assert.equal(rig.deck.held("draft_put")[0]!.args.draftJson, "", "清除载荷是空串（后端删文件）");
  rig.deck.release("draft_put");
  await clearing;

  assert.equal(rig.drafts.get("vault-a"), undefined, "已发送内容不复活");
  assert.equal(rig.warns.length, 1, "失败仍降级，但不阻断清除");

  // 同样的内容再打一次必须重新落盘（清除把「已落盘」基准归空）。
  rig.deck.policy("draft_put", "pass");
  rig.store.schedule("要发出去的内容", null, CARDS);
  await rig.store.flush();
  assert.equal(rig.deck.arrivals("draft_put"), 3);
  assert.equal(rig.drafts.get("vault-a"), draft("要发出去的内容"));
});

test("草稿 崩溃恢复：新 store 从盘上读回 text/caret/cards，未编辑不再写盘", async () => {
  const rig = createDraftRig({ "vault-a": draft("崩溃前的字", 3) });
  const loaded = await rig.store.load("vault-a");
  assert.deepEqual(loaded, { text: "崩溃前的字", caret: 3, cards: LOADED_CARDS, skills: [] });

  rig.store.schedule("崩溃前的字", 3, CARDS);
  await rig.store.flush();
  assert.equal(rig.deck.arrivals("draft_put"), 0, "刚恢复、内容未变，不得写盘");
});

test("草稿：损坏 / 读失败安静回落 null，随后的编辑仍能正常落盘", async () => {
  const rig = createDraftRig({ "vault-a": "{not json" });
  assert.equal(await rig.store.load("vault-a"), null, "损坏 → null（不抛错）");

  const readsBefore = rig.deck.arrivals("draft_get");
  rig.deck.policy("draft_get", "fail", { error: commandError("io", "配置目录不可读") });
  assert.equal(await rig.store.load("vault-a"), null, "读失败 → null（不阻断装载）");
  assert.equal(rig.deck.arrivals("draft_get"), readsBefore + 1, "读失败那次确实到达了注入点");

  rig.deck.policy("draft_get", "pass");
  rig.store.schedule("读失败后的输入", 2, CARDS);
  await rig.store.flush();
  assert.equal(rig.drafts.get("vault-a"), draft("读失败后的输入", 2));
});

// ---------------------------------------------------------------------------
// 正文保存的故障夹具：盘按 vault 作用域存文件，document_save / fs_read_snapshot 经故障闸
// ---------------------------------------------------------------------------

interface DiskFile {
  content: string;
  revision: string;
}

interface SaveRig extends Rig {
  deck: FaultDeck;
  disk: {
    scope: string;
    files: Map<string, DiskFile>;
    /** 已成功落盘的写（跨 vault 归属的观测面）。 */
    writes: Array<{ scope: string; path: string; content: string; expected_revision: string }>;
    /** 到达后端的每一次保存尝试（含被 CAS 拒绝的）——「旧结果污染基准」这类缺陷的判据面。 */
    attempts: Array<{ scope: string; path: string; content: string; expected_revision: string }>;
  };
}

function createSaveRig(files: Record<string, string>, options: { scope?: string } = {}): SaveRig {
  const rig = createRig();
  const deck = createFaultDeck();
  const disk: SaveRig["disk"] = {
    scope: options.scope ?? "vault-a",
    files: new Map(
      Object.entries(files).map(([path, content], index) => [path, { content, revision: `rev:${path}:${index}` }]),
    ),
    writes: [],
    attempts: [],
  };
  const nextRevision = new Map<string, number>();

  rig.backend.handle("document_save", (args) =>
    deck.run("document_save", args, () => {
      disk.attempts.push({
        scope: disk.scope,
        path: args.path,
        content: args.content,
        expected_revision: args.expected_revision,
      });
      const file = disk.files.get(args.path);
      if (file === undefined) throw commandError("fs_not_found", `文件不存在：${args.path}`);
      if (args.expected_revision !== file.revision) {
        throw commandError("document_conflict", "文件已被外部修改，请先协调冲突");
      }
      const next = (nextRevision.get(args.path) ?? 0) + 1;
      nextRevision.set(args.path, next);
      file.content = args.content;
      file.revision = `rev:${args.path}:saved-${next}`;
      disk.writes.push({
        scope: disk.scope,
        path: args.path,
        content: args.content,
        expected_revision: args.expected_revision,
      });
      return file.revision;
    }),
  );
  rig.backend.handle("fs_read_snapshot", (args) =>
    deck.run("fs_read_snapshot", args, () => {
      const file = disk.files.get(args.path);
      if (file === undefined) throw commandError("fs_not_found", `文件不存在：${args.path}`);
      return { content: file.content, revision: file.revision };
    }, { after: true }),
  );
  return Object.assign(rig, { deck, disk });
}

/** 收尾：清掉崩溃备份排期的定时器（否则测试结束后它还会跑一次真的备份写入）。 */
const stopTimers = (rig: Rig) => rig.controller.noteVaultReset();

test("保存 I2：延迟写期间继续编辑——旧写成功只推进基准，不把新内容标成已保存", async () => {
  const rig = createSaveRig({ "a.md": "# A" });
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev:a.md:0");
  rig.editor.edit("a.md", "# A + 第一笔");

  rig.deck.policy("document_save", "hold");
  const saving = rig.controller.save();
  await rig.deck.waitFor("document_save");
  assert.deepEqual(
    rig.deck.held("document_save")[0]!.args,
    { path: "a.md", expected_revision: "rev:a.md:0", content: "# A + 第一笔" },
    "第一笔保存的内容与 CAS 基准都是当时的现场",
  );

  rig.editor.edit("a.md", "# A + 第一笔 + 第二笔"); // 在途期间继续输入
  rig.deck.release("document_save");
  await saving;

  const session = rig.editor.handle.sessionForPath("a.md")!;
  assert.equal(session.dirty, true, "写入的是旧快照，期间的新输入仍是未保存状态");
  assert.equal(session.cleanDoc, "# A", "clean 基准不得被旧内容的成功写推进");
  assert.equal(session.state.doc.toString(), "# A + 第一笔 + 第二笔", "内存内容原样保留");
  assert.ok(
    rig.toasts.texts().some((text) => text.includes("仍有未保存修改")),
    "必须如实提示「保存的是快照、仍有未保存修改」",
  );
  assert.equal(rig.disk.files.get("a.md")!.content, "# A + 第一笔", "磁盘上是第一笔（不是最新内容）");

  // 第二次保存：基准已推进到后端返回值（第一笔那次写），内容是最新的。
  rig.deck.policy("document_save", "pass");
  await rig.controller.save();
  const writes = rig.disk.writes;
  assert.equal(writes.length, 2);
  assert.equal(writes[1]!.expected_revision, "rev:a.md:saved-1", "下一次 CAS 基准 = 上一次成功写的返回 revision");
  assert.equal(writes[1]!.content, "# A + 第一笔 + 第二笔");
  assert.equal(session.dirty, false, "最新内容落盘后才清 dirty");
  assert.equal(session.cleanDoc, "# A + 第一笔 + 第二笔");
  stopTimers(rig);
});

test("保存 I3：写失败（磁盘满 / 权限）保留 dirty 与内容，重试真的再次写盘", async () => {
  const rig = createSaveRig({ "a.md": "# A" });
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev:a.md:0");
  rig.editor.edit("a.md", "# A + 修改");

  rig.deck.policy("document_save", "fail", {
    error: commandError("document_write_failed", "无法创建临时文件：No space left on device"),
  });
  await rig.controller.save();
  assert.equal(rig.deck.arrivals("document_save"), 1, "失败那次确实到达了注入点（不是被上层吞掉）");
  const session = rig.editor.handle.sessionForPath("a.md")!;
  assert.equal(session.dirty, true, "失败不得清 dirty");
  assert.equal(session.state.doc.toString(), "# A + 修改", "失败不得丢内容");
  assert.ok(
    rig.toasts.texts().some((text) => text.includes("保存失败") && text.includes("无法写入文档")),
    "失败提示按 code 渲染人话（不是只剩技术化 message）",
  );

  // 重试：同一 revision 基准仍然有效（失败没有推进它），内容与路径照旧。
  rig.deck.policy("document_save", "pass");
  await rig.controller.save();
  assert.equal(rig.disk.writes.length, 1, "重试真的到达后端并成功");
  assert.equal(rig.disk.writes[0]!.expected_revision, "rev:a.md:0", "失败不推进 CAS 基准");
  assert.equal(rig.disk.writes[0]!.content, "# A + 修改");
  assert.equal(session.dirty, false);
  stopTimers(rig);
});

test("保存 I3：在途写失败与新编辑交错——重试写最新内容，旧内容不复活", async () => {
  const rig = createSaveRig({ "a.md": "# A" });
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev:a.md:0");
  rig.editor.edit("a.md", "# A + 第一版");

  rig.deck.policy("document_save", "hold");
  const failed = rig.controller.save();
  await rig.deck.waitFor("document_save");
  rig.editor.edit("a.md", "# A + 第二版"); // 在途期间的新编辑
  rig.deck.reject("document_save", commandError("document_write_unknown", "文档替换结果未知：io error"));
  await failed;

  assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, true);
  assert.ok(rig.toasts.texts().some((text) => text.includes("保存结果未知")), "结果未知必须如实提示");

  // 旧写的失败没有留下任何待写队列——⌘S 重试走的是当前内容。
  rig.deck.policy("document_save", "pass");
  await rig.controller.save();
  assert.equal(rig.disk.writes.length, 1);
  assert.equal(rig.disk.writes[0]!.content, "# A + 第二版", "重试写当前内容，不是失败那版");
  assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, false);
  stopTimers(rig);
});

test("保存 I4：保存中切文档——迟到的成功只落在出发时的文档上，不碰另一份的基准", async () => {
  const rig = createSaveRig({ "a.md": "# A", "b.md": "# B" });
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev:a.md:0");
  rig.editor.open("b.md", "# B");
  rig.controller.noteOpened("b.md", "rev:b.md:1");

  rig.editor.edit("a.md", "# A 改");
  rig.editor.activate("a.md"); // ⌘S 只存前台标签
  rig.deck.policy("document_save", "hold");
  const savingA = rig.controller.save();
  await rig.deck.waitFor("document_save");

  // 切到 b 并保存 b：b 的写不受 a 在途影响，立刻完成。
  rig.editor.activate("b.md");
  rig.editor.edit("b.md", "# B 改");
  rig.deck.policy("document_save", "pass");
  await rig.controller.save();
  assert.deepEqual(
    rig.disk.writes.map((write) => write.path),
    ["b.md"],
    "b 的保存先落盘（a 仍在途）",
  );

  rig.deck.release("document_save"); // a 的成功晚到
  await savingA;

  assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, false, "a 的内容与写入一致，按自己的结果清 dirty");
  assert.equal(rig.editor.handle.sessionForPath("b.md")!.dirty, false);

  // b 的基准没有被 a 的迟到结果改写：再编辑 b 并保存，CAS 用 b 自己的上一版。
  rig.editor.edit("b.md", "# B 又改");
  rig.deck.policy("document_save", "pass");
  await rig.controller.save();
  const writesForB = rig.disk.writes.filter((write) => write.path === "b.md");
  assert.equal(writesForB.length, 2);
  assert.equal(writesForB[1]!.expected_revision, "rev:b.md:saved-1", "b 的基准来自 b 自己的写");
  assert.equal(rig.disk.files.get("a.md")!.content, "# A 改");
  assert.equal(rig.disk.files.get("b.md")!.content, "# B 又改");
  stopTimers(rig);
});

test("保存 I4：保存中改名——迟到的成功不得写到旧路径，也不得把旧路径的 dirty 带过去", async () => {
  const rig = createSaveRig({ "dir/a.md": "# A" });
  rig.editor.open("dir/a.md", "# A");
  rig.controller.noteOpened("dir/a.md", "rev:dir/a.md:0");
  rig.editor.edit("dir/a.md", "# A 改");

  rig.deck.policy("document_save", "hold");
  const saving = rig.controller.save();
  await rig.deck.waitFor("document_save");
  assert.equal(rig.deck.held("document_save")[0]!.args.path, "dir/a.md");

  // app 内改名（M244）：会话路径换键、状态迁移，旧路径的写在途。
  rig.editor.rename("dir/a.md", "dir/b.md");
  rig.controller.noteRenamed("dir/a.md", "dir/b.md");
  // 改名不改字节：新路径的磁盘 revision 仍是内容寻址的旧值（不是按路径伪造的新值）。
  rig.disk.files.set("dir/b.md", { content: "# A", revision: "rev:dir/a.md:0" });
  rig.disk.files.delete("dir/a.md"); // 后端改名：旧路径不再存在

  rig.deck.release("document_save");
  await saving;
  const session = rig.editor.handle.sessionForPath("dir/b.md")!;
  assert.equal(session.dirty, true, "旧路径的保存结果不得清掉新键的 dirty");
  assert.equal(session.state.doc.toString(), "# A 改", "迟到应答不得改动缓冲区");
  // 旧路径的写确实在改名之后才执行（后端按当时的盘面报 fs_not_found），但 M847 判定这次
  // 应答已不归新键所有：整体丢弃——不弹旧路径的「另存为新文件」等任何提示，也不写盘。
  assert.deepEqual(
    rig.disk.attempts.map((attempt) => attempt.path),
    ["dir/a.md"],
    "迟到的写到达了后端（证明这条应答路径真的跑了）",
  );
  assert.equal(rig.disk.writes.length, 0, "旧路径的写没有落盘");
  assert.deepEqual(rig.toasts.texts(), [], "丢弃的应答不得弹任何提示");

  // 新路径的保存用迁移过来的基准（改名不改字节）。
  rig.deck.policy("document_save", "pass");
  await rig.controller.save();
  const write = rig.disk.writes.at(-1)!;
  assert.equal(write.path, "dir/b.md", "写落点跟着改名的键走");
  assert.equal(write.expected_revision, "rev:dir/a.md:0", "CAS 基准随键迁移（不是旧路径的结果）");
  assert.equal(write.content, "# A 改");
  assert.equal(session.dirty, false);
  stopTimers(rig);
});

test("保存 I4：目录改名（move）期间的在途保存——旧路径结果丢弃，新键逐会话迁移", async () => {
  const rig = createSaveRig({ "sub/a.md": "# A", "sub/b.md": "# B" });
  rig.editor.open("sub/a.md", "# A");
  rig.controller.noteOpened("sub/a.md", "rev:sub/a.md:0");
  rig.editor.open("sub/b.md", "# B");
  rig.controller.noteOpened("sub/b.md", "rev:sub/b.md:1");
  rig.editor.edit("sub/a.md", "# A 改");
  rig.editor.activate("sub/a.md");

  rig.deck.policy("document_save", "hold");
  const saving = rig.controller.save();
  await rig.deck.waitFor("document_save");

  // 目录移动：装配层对每个受影响会话各喂一次 noteRenamed（editor.remapSessionPaths 的路径对）。
  for (const [from, to] of [
    ["sub/a.md", "sub2/a.md"],
    ["sub/b.md", "sub2/b.md"],
  ] as const) {
    rig.editor.rename(from, to);
    rig.controller.noteRenamed(from, to);
  }
  // 改名不改字节：新路径的 revision 仍是内容寻址的旧值。
  rig.disk.files.set("sub2/a.md", { content: "# A", revision: "rev:sub/a.md:0" });
  rig.disk.files.set("sub2/b.md", { content: "# B", revision: "rev:sub/b.md:1" });
  rig.disk.files.delete("sub/a.md");
  rig.disk.files.delete("sub/b.md");

  rig.deck.release("document_save");
  await saving;
  const sessionA = rig.editor.handle.sessionForPath("sub2/a.md")!;
  assert.equal(sessionA.dirty, true, "旧路径的在途结果不得清新键的 dirty");
  assert.equal(sessionA.state.doc.toString(), "# A 改", "迟到应答不得改动缓冲区");
  // 目录移动后旧路径的写才执行（后端报 fs_not_found）；M847 判定应答失效即整体丢弃，
  // 不弹旧路径的「另存为新文件」等任何提示，也不写盘。
  assert.deepEqual(
    rig.disk.attempts.map((attempt) => attempt.path),
    ["sub/a.md"],
    "迟到的写到达了后端（证明这条应答路径真的跑了）",
  );
  assert.equal(rig.disk.writes.length, 0, "旧路径的写没有落盘");
  assert.deepEqual(rig.toasts.texts(), [], "丢弃的应答不得弹任何提示");

  // 同一次目录移动里的另一个会话：基准随键迁移，保存落到新路径。
  rig.deck.policy("document_save", "pass");
  rig.editor.edit("sub2/b.md", "# B 改");
  rig.editor.activate("sub2/b.md");
  await rig.controller.save();
  const write = rig.disk.writes.at(-1)!;
  assert.equal(write.path, "sub2/b.md");
  assert.equal(write.expected_revision, "rev:sub/b.md:1", "目录移动后每个会话的基准随键迁移");
  assert.equal(write.content, "# B 改");
  assert.equal(rig.editor.handle.sessionForPath("sub2/b.md")!.dirty, false);

  // 在途保存出发时的会话（现键 sub2/a.md）不被旧 token 挡住：旧保存收尾后仍可立即保存，
  // 基准是迁移过来的、未被迟到应答污染的那一个。
  rig.editor.activate("sub2/a.md");
  await rig.controller.save();
  const writeA = rig.disk.writes.at(-1)!;
  assert.equal(writeA.path, "sub2/a.md", "在新键上重新发起保存，落点随键");
  assert.equal(writeA.expected_revision, "rev:sub/a.md:0", "基准未被旧路径的应答改写");
  assert.equal(writeA.content, "# A 改");
  assert.equal(sessionA.dirty, false);
  stopTimers(rig);
});

test("保存 I4：保存中外部改写——CAS 冲突，绝不静默覆盖第三方内容", async () => {
  const rig = createSaveRig({ "a.md": "# A" });
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev:a.md:0");
  rig.editor.edit("a.md", "# A 改");

  rig.deck.policy("document_save", "hold");
  const saving = rig.controller.save();
  await rig.deck.waitFor("document_save");

  // 外部编辑器在写盘落地之前改了同一文件（桩的 document_save 在放行时才执行，看到的是新内容）。
  rig.disk.files.set("a.md", { content: "# 外部版本", revision: "rev:external" });
  rig.deck.release("document_save");
  await saving;

  assert.equal(rig.disk.files.get("a.md")!.content, "# 外部版本", "第三方内容没有被覆盖");
  assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, true, "本地修改仍保留在内存");
  const conflict = rig.toasts.live().at(-1)!;
  assert.equal(conflict.sticky, true, "冲突提示在用户处置前不消隐");
  assert.deepEqual(conflict.actions.map((action) => action.label), ["重新载入（放弃我的修改）", "强制覆盖保存"]);
  stopTimers(rig);
});

test("保存 I4：保存中文件被外部删除——给出另存出口，内容不丢", async () => {
  const rig = createSaveRig({ "a.md": "# A" });
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev:a.md:0");
  rig.editor.edit("a.md", "# A 改");

  rig.deck.policy("document_save", "hold");
  const saving = rig.controller.save();
  await rig.deck.waitFor("document_save");
  rig.disk.files.delete("a.md");
  rig.deck.release("document_save");
  await saving;

  assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, true);
  const prompt = rig.toasts.live().at(-1)!;
  assert.equal(prompt.sticky, true);
  assert.deepEqual(prompt.actions.map((action) => action.label), ["另存为新文件"]);
  assert.match(prompt.text, /已被外部删除或移动/);
  stopTimers(rig);
});

test("保存 I2：在途写 / 失败期间 dirty 守卫仍拦切换与退出；成功后放行", async () => {
  const rig = createSaveRig({ "a.md": "# A" });
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev:a.md:0");
  rig.editor.edit("a.md", "# A 改");

  rig.deck.policy("document_save", "hold");
  const saving = rig.controller.save();
  await rig.deck.waitFor("document_save");
  assert.deepEqual(rig.controller.vaultSwitchBlock(), { dirtyCount: 1, hasUnsaveable: false }, "写盘在途也是未保存");

  rig.deck.reject("document_save", commandError("document_write_failed", "无法写入文档：Permission denied"));
  await saving;
  assert.deepEqual(
    rig.controller.vaultSwitchBlock(),
    { dirtyCount: 1, hasUnsaveable: false },
    "失败后仍拦（用户可重试）",
  );

  rig.deck.policy("document_save", "pass");
  await rig.controller.save();
  assert.equal(rig.controller.vaultSwitchBlock(), null, "写成功后不再拦");
  assert.equal(rig.toasts.live().filter((toast) => toast.classes.has(SAVE_GUARD_TOAST_CLASS)).length, 0);
  stopTimers(rig);
});

// ---------------------------------------------------------------------------
// 崩溃备份与恢复
// ---------------------------------------------------------------------------

interface RecoveryDisk {
  backups: Map<string, { content: string; baseRevision: string | null }>;
}

interface RecoveryRig {
  backend: ReturnType<typeof installBackend>;
  editor: ReturnType<typeof createEditorDouble>;
  toasts: ReturnType<typeof createToastHost>;
  controller: ReturnType<typeof createSaveController>;
  disk: RecoveryDisk & { files: Map<string, DiskFile> };
  deck: FaultDeck;
}

/**
 * 恢复入口（`restoreBackup`）会经 deps.openFile 重新装载并写进编辑器视图。
 * 生产装配层在 openFile 里读快照并 `noteOpened`；这里的替身做同一件事（先登记基准再
 * 交给 editor.open），否则 `saveBaseline` 会返回 null，测的就不是恢复链路。
 */
function createRecoveryRig(files: Record<string, string>): RecoveryRig {
  const backend = installBackend();
  const editor = createEditorDouble();
  const toasts = createToastHost();
  const deck = createFaultDeck();
  const disk: RecoveryRig["disk"] = {
    files: new Map(Object.entries(files).map(([path, content]) => [path, { content, revision: `rev:${path}:0` }])),
    backups: new Map(),
  };
  backend.handle("recovery_list", () => [...disk.backups.keys()]);
  backend.handle("recovery_load", (args) => disk.backups.get(args.path)?.content ?? null);
  backend.handle("recovery_base_revision", (args) => disk.backups.get(args.path)?.baseRevision ?? null);
  backend.handle("recovery_backup", (args) => {
    disk.backups.set(args.path, { content: args.content, baseRevision: args.base_revision });
  });
  backend.handle("recovery_discard", (args) => void disk.backups.delete(args.path));
  backend.handle("fs_read_snapshot", (args) => {
    const file = disk.files.get(args.path);
    if (file === undefined) throw commandError("fs_not_found", `文件不存在：${args.path}`);
    return { content: file.content, revision: file.revision };
  });

  let controller!: ReturnType<typeof createSaveController>;
  controller = createSaveController({
    editor: editor.handle,
    container: toasts.container,
    toast: toasts.toast,
    openFile: async (path) => {
      const file = disk.files.get(path);
      if (file === undefined) throw commandError("fs_not_found", `文件不存在：${path}`);
      editor.open(path, file.content);
      // 生产链路：装载后登记 CAS 基准（noteOpened 的调用点是读快照成功的装配层）。
      controller.noteOpened(path, file.revision);
    },
    invalidateResolve: () => {},
    showEditor: () => {},
    isNoticeHidden: () => true,
    restoreReadingPosition: () => {},
    documentReplaced: () => {},
  });
  // restoreBackup 直接把内容 dispatch 进 view；替身用同一个模型（换 state + 重算 dirty）。
  const viewFor = (path: string) => ({
    get state() {
      return editor.handle.sessionForPath(path)!.state;
    },
    dispatch(tr: { changes: { from: number; to: number; insert: string } }) {
      const session = editor.handle.sessionForPath(path)!;
      const current = session.state.doc.toString();
      const next = current.slice(0, tr.changes.from) + tr.changes.insert + current.slice(tr.changes.to);
      editor.edit(path, next);
    },
  });
  (editor.handle as unknown as { view: unknown }).view = viewFor("a.md");
  return { backend, editor, toasts, controller, disk, deck };
}

test("崩溃恢复 I2：备份内容恢复后仍是 dirty，保存走备份时的 CAS 基准；磁盘被改过则报冲突", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const rig = createRecoveryRig({ "a.md": "# A" });
    rig.editor.open("a.md", "# A");
    rig.controller.noteOpened("a.md", "rev:a.md:0");
    rig.editor.edit("a.md", "# A 未保存的修改");
    // 停止输入满 debounce → 写一份备份。
    mock.timers.tick(2000);
    await flushAwait();
    assert.equal(rig.disk.backups.get("a.md")?.content, "# A 未保存的修改", "备份已落盘");
    assert.equal(rig.disk.backups.get("a.md")?.baseRevision, "rev:a.md:0");

    // 模拟崩溃后重启：同一磁盘、新的编辑器与控制器（旧会话与内存全部消失）。
    const restarted = createRecoveryRig({ "a.md": "# A" });
    restarted.disk.backups = rig.disk.backups;
    await restarted.controller.checkRecovery();
    const prompt = restarted.toasts.live().at(-1)!;
    assert.deepEqual(prompt.actions.map((action) => action.label), ["恢复内容", "丢弃备份"]);

    prompt.actions[0]!.run();
    await flushAwait();
    const session = restarted.editor.handle.sessionForPath("a.md")!;
    assert.equal(session.state.doc.toString(), "# A 未保存的修改", "备份内容进了缓冲");
    assert.equal(session.dirty, true, "恢复出来的内容仍是未保存状态（不静默覆盖磁盘）");
    assert.equal(restarted.toasts.texts().at(-1), "已恢复未保存内容，请保存（Cmd+S）");

    // 保存：基准必须是备份记录的 base revision（rev:a.md:0），而不是恢复时刻的磁盘 revision。
    restarted.backend.handle("document_save", (args) => {
      assert.equal(args.expected_revision, "rev:a.md:0");
      restarted.disk.files.set("a.md", { content: args.content, revision: "rev:a.md:restored" });
      return "rev:a.md:restored";
    });
    await restarted.controller.save();
    assert.equal(session.dirty, false);
    assert.equal(restarted.disk.backups.get("a.md"), undefined, "保存成功即作废备份");
  } finally {
    mock.timers.reset();
  }
});

test("崩溃恢复 I4：备份之后磁盘被外部修改——恢复内容按备份基准保存必报冲突，不覆盖较新内容", async () => {
  const rig = createRecoveryRig({ "a.md": "# A" });
  rig.disk.backups.set("a.md", { content: "# 备份的内容", baseRevision: "rev:a.md:0" });
  // 备份之后、恢复之前，磁盘被外部改写。
  rig.disk.files.set("a.md", { content: "# 外部更新的版本", revision: "rev:a.md:newer" });
  rig.backend.handle("document_save", (args) => {
    const file = rig.disk.files.get("a.md")!;
    if (args.expected_revision !== file.revision) {
      throw commandError("document_conflict", "文件已被外部修改，请先协调冲突");
    }
    file.content = args.content;
    return "rev:unexpected";
  });

  await rig.controller.checkRecovery();
  rig.toasts.live().at(-1)!.actions[0]!.run();
  await flushAwait();

  const session = rig.editor.handle.sessionForPath("a.md")!;
  assert.equal(session.state.doc.toString(), "# 备份的内容");
  assert.equal(session.dirty, true);

  await rig.controller.save();
  assert.equal(rig.disk.files.get("a.md")!.content, "# 外部更新的版本", "恢复不得静默覆盖较新的磁盘版本");
  assert.equal(session.dirty, true);
  assert.match(rig.toasts.live().at(-1)!.text, /保存冲突/);
  rig.controller.noteVaultReset();
});

// finding 20261119-worker-persistence-faults-bug-vault-cas：M847 按路径装载世代判定保存应答归属之后，
// 这条从 `todo` 转普通 test（判据与故障交错不变）。
test("保存 I4：旧 vault 的保存应答晚到——不得覆盖新 vault 同名文档的 CAS 基准", async () => {
  const rig = createSaveRig({ "a.md": "# A" }, { scope: "vault-a" });
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev:a.md:0");
  rig.editor.edit("a.md", "# A 改");

  // 写已经落到 A 的盘上，只是应答还在路上（hold after）。
  rig.deck.policy("document_save", "hold", { after: true });
  const saving = rig.controller.save();
  await rig.deck.waitFor("document_save");
  assert.equal(rig.disk.writes.length, 1, "写已执行（A 的盘）");
  assert.equal(rig.disk.writes[0]!.scope, "vault-a", "这次写真的落在 A 的盘上——迟到应答的归属是 A");

  // 用户「放弃修改并切换」到 vault-b，并在那里打开同名的 a.md。
  rig.controller.noteVaultReset();
  rig.editor.close("a.md");
  rig.disk.scope = "vault-b";
  rig.disk.files.set("a.md", { content: "# B 文档", revision: "rev:b:0" });
  rig.editor.open("a.md", "# B 文档");
  rig.controller.noteOpened("a.md", "rev:b:0");

  rig.deck.release("document_save"); // A 的成功应答现在才到
  await saving;

  const session = rig.editor.handle.sessionForPath("a.md")!;
  assert.equal(session.dirty, false, "新文档未被编辑，本来就不是 dirty");
  assert.equal(session.state.doc.toString(), "# B 文档", "旧结果不得改写新文档的内容");

  // 现在编辑 B 的文档并保存：基准必须是 B 打开时登记的 rev:b:0。
  rig.editor.edit("a.md", "# B 文档改");
  rig.deck.policy("document_save", "pass");
  await rig.controller.save();
  const attempted = rig.disk.attempts.at(-1)!;
  assert.equal(
    attempted.expected_revision,
    "rev:b:0",
    "新文档的 CAS 基准不得被旧 vault 的保存结果覆盖",
  );
  assert.equal(attempted.content, "# B 文档改");
  assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, false);
  stopTimers(rig);
});
