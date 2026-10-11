// 草稿 store 的单测（change composer-draft-persistence，tasks 3.1/3.5、4.3）：防抖窗口、
// 无变更不写、flush 的时点与内容、切走丢弃待写、装载读回、发送成功清除、写失败只降级。
//
// 这一层不碰 DOM（store 本身就是零 DOM 的写控制器，装配时机在 src/harness-panel.ts 归真机
// 场景），用假 deps 只测「什么时候读、什么时候写、写什么」——判据与 reading-position 同款
// （mock timers 控防抖，`flush()` 帮手让 await 链跑完）。

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { createHarnessDraftStore } from "../../src/harness-draft.ts";
import type { ComposerBlock } from "../../src/quote-card.ts";
import { serializeComposerDraft } from "../../src/quote-card.ts";

const MSG: ComposerBlock[] = [{ kind: "paragraph", text: "hi" }];
const MSG2: ComposerBlock[] = [{ kind: "paragraph", text: "hi there" }];

/** 让 await 链跑完（mock timers 只接管 setTimeout）。 */
const flushAwait = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

interface Rig {
  /** 后端盘上的草稿原文（vault 无关——落点由后端按当前 scope 解析，桩里就是一份字符串）。 */
  file: string | null;
  writes: string[];
  failWrite: boolean;
  warns: unknown[];
  getCalls: number;
  /** 读盘的实现（可替换：有的用例要把它挂住，用来模拟「读盘窗口里又切了一次 vault」）。 */
  getImpl: () => Promise<string | null>;
  /** 写盘的闸（可替换）：返回 promise 时 `putDraft` 会等它——模拟「这次 IPC 在途」。 */
  putGate: ((draftJson: string) => Promise<void> | undefined) | undefined;
}

function createRig() {
  const store = createHarnessDraftStore({
    getDraft: () => {
      rig.getCalls += 1;
      return rig.getImpl();
    },
    putDraft: async (draftJson) => {
      const gate = rig.putGate?.(draftJson);
      if (gate !== undefined) await gate;
      if (rig.failWrite) throw { code: "harness_draft_write_failed", message: "磁盘只读" };
      rig.writes.push(draftJson);
      rig.file = draftJson === "" ? null : draftJson;
    },
    warn: (e) => void rig.warns.push(e),
    debounceMs: 1000,
  });
  const rig: Rig = {
    file: null,
    writes: [],
    failWrite: false,
    warns: [],
    getCalls: 0,
    getImpl: async () => rig.file,
    putGate: undefined,
  };
  return { store, rig };
}

test("编辑后防抖窗口到点才落盘：窗口内不写，到点写一份且只写一份", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    store.schedule(MSG, null);
    await flushAwait();
    assert.deepEqual(rig.writes, [], "窗口内不落盘");

    // 窗口内继续编辑：重排定时器（合并成一次写），只写最后一份
    mock.timers.tick(600);
    store.schedule(MSG2, null);
    mock.timers.tick(600);
    await flushAwait();
    assert.deepEqual(rig.writes, [], "重排之后的窗口还没到点（旧窗口不该触发）");

    mock.timers.tick(600);
    await flushAwait();
    assert.equal(rig.writes.length, 1, "合并成一次落盘");
    assert.equal(rig.writes[0], serializeComposerDraft(MSG2, null));
  } finally {
    mock.timers.reset();
  }
});

test("无变更不写：同内容反复 schedule 不排期；光标变化按变更处理", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    store.schedule(MSG, null);
    mock.timers.tick(1200);
    await flushAwait();
    assert.equal(rig.writes.length, 1);

    store.schedule(MSG, null); // 内容相同：不排期
    mock.timers.tick(5000);
    await flushAwait();
    assert.equal(rig.writes.length, 1, "内容未变不写第二份");

    store.schedule(MSG, { block: 0, offset: 2 }); // 光标变了：落位要跟着走
    mock.timers.tick(1200);
    await flushAwait();
    assert.equal(rig.writes.length, 2);
    assert.equal(rig.writes[1], serializeComposerDraft(MSG, { block: 0, offset: 2 }));
  } finally {
    mock.timers.reset();
  }
});

test("flush：立刻写走待写（不等窗口）；无待写不写盘", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    await store.flush();
    assert.deepEqual(rig.writes, [], "没有待写就不落一份");

    store.schedule(MSG, null);
    await store.flush();
    assert.deepEqual(rig.writes, [serializeComposerDraft(MSG, null)], "待写立刻落盘");

    // flush 之后窗口到点不再重复写（定时器已清）
    mock.timers.tick(5000);
    await flushAwait();
    assert.equal(rig.writes.length, 1);
  } finally {
    mock.timers.reset();
  }
});

test("discard：切 vault 时丢弃上一 vault 的待写（不写、不残留到下一次）", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    store.schedule(MSG, null);
    store.discard();
    mock.timers.tick(5000);
    await flushAwait();
    assert.deepEqual(rig.writes, [], "丢弃之后窗口到点也不写");
    await store.flush();
    assert.deepEqual(rig.writes, [], "待写已丢，flush 也没有内容可写");
  } finally {
    mock.timers.reset();
  }
});

test("load：读回块序列与光标；无草稿 / 损坏 / 读失败都安静回落 null", async () => {
  const { store, rig } = createRig();
  assert.equal(await store.load(), null, "盘上没有草稿");

  rig.file = serializeComposerDraft(MSG, { block: 0, offset: 1 });
  assert.deepEqual(await store.load(), { blocks: MSG, caret: { block: 0, offset: 1 } });

  rig.file = "{not json";
  assert.equal(await store.load(), null, "损坏 → null（不抛错）");

  rig.getImpl = async () => {
    throw { code: "io", message: "配置目录不可读" };
  };
  assert.equal(await store.load(), null, "读失败 → null（不抛错）");
});

test("load：读盘途中再次装载 vault，前一次结果作废（不覆盖新 vault）", async () => {
  const { store, rig } = createRig();
  const gate: { release: (() => void) | undefined } = { release: undefined };
  rig.getImpl = () =>
    new Promise<string | null>((resolve) => {
      gate.release = () => resolve(serializeComposerDraft(MSG, null));
    });
  const first = store.load(); // 挂住：模拟「读盘窗口」
  // 窗口里装载了下一个 vault：第二次 load 先跑完（它的盘上内容是新 vault 的）
  rig.getImpl = async () => serializeComposerDraft(MSG2, null);
  const second = await store.load();
  assert.deepEqual(second, { blocks: MSG2, caret: null });
  const release = gate.release;
  assert.ok(release !== undefined, "读盘窗口确实挂住了（否则这条断言测的不是让位语义）");
  release();
  assert.equal(await first, null, "作废的那一次不返回内容");
});

test("clear：发送成功后取消待写 + 删除草稿（空载荷），旧内容不会被 debounce 写回", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    rig.file = serializeComposerDraft(MSG, null);
    store.schedule(MSG2, null); // 刚打了字、窗口还在
    await store.clear();
    assert.deepEqual(rig.writes, [""], "清除 = 空载荷（后端删文件）");
    mock.timers.tick(5000);
    await flushAwait();
    assert.deepEqual(rig.writes, [""], "窗口里那份旧内容被一并取消，不会写回盘上");
    assert.equal(rig.file, null);
  } finally {
    mock.timers.reset();
  }
});

test("写失败：只降级（warn 一次）+ 内容留待下一次 flush 重试，不谎报已保存", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    rig.failWrite = true;
    store.schedule(MSG, null);
    mock.timers.tick(1200);
    await flushAwait();
    assert.equal(rig.warns.length, 1, "失败降级为人话 warning（装配层再按 code 取 D456）");
    assert.deepEqual(rig.writes, []);

    // 同一份内容再 flush 一次：仍然要写（上次没写成就没有「已落盘」这个事实）
    rig.failWrite = false;
    await store.flush();
    assert.deepEqual(rig.writes, [serializeComposerDraft(MSG, null)], "重试写走");
  } finally {
    mock.timers.reset();
  }
});

test("load 之后「无变更不写」以读回的内容为基准（未编辑则不再写盘）", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    rig.file = serializeComposerDraft(MSG, { block: 0, offset: 1 });
    await store.load();
    store.schedule(MSG, { block: 0, offset: 1 }); // 与盘上那份逐字节相同
    mock.timers.tick(5000);
    await flushAwait();
    assert.deepEqual(rig.writes, [], "装载后未编辑不该再写一份");
  } finally {
    mock.timers.reset();
  }
});

test("写失败窗口内有新编辑：重试写的是新内容（旧内容的失败不覆盖待写，r1 P2-1）", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    // 第一份内容的写在途（挂住），期间用户继续编辑；随后这次写在途失败。
    const gate: { release: (() => void) | undefined } = { release: undefined };
    rig.putGate = (draftJson) =>
      draftJson === serializeComposerDraft(MSG, null)
        ? new Promise<void>((resolve) => void (gate.release = resolve))
        : undefined;

    store.schedule(MSG, null);
    mock.timers.tick(1200); // 防抖到点 → flush → 写 MSG（在途）
    await flushAwait();
    store.schedule(MSG2, null); // 在途期间的新编辑（更新的内容）
    rig.failWrite = true; // 这次在途写会失败

    const release = gate.release;
    assert.ok(release !== undefined, "第一份内容的写确实在途");
    release();
    await flushAwait();
    assert.equal(rig.warns.length, 1, "失败降级为人话 warning");
    assert.deepEqual(rig.writes, [], "失败的那一份没落盘");

    // 下一次 flush 写走的是**新内容**，不是被失败回填顶回来的旧内容
    rig.failWrite = false;
    rig.putGate = undefined;
    await store.flush();
    assert.deepEqual(rig.writes, [serializeComposerDraft(MSG2, null)], "重试写的是新内容");
  } finally {
    mock.timers.reset();
  }
});

test("flush 在途 + 发送成功 clear：删除排在在途写之后（已发送内容不复活，r1 P2-2）", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    const gate: { release: (() => void) | undefined } = { release: undefined };
    rig.putGate = (draftJson) =>
      draftJson === serializeComposerDraft(MSG, null)
        ? new Promise<void>((resolve) => void (gate.release = resolve))
        : undefined;

    store.schedule(MSG, null);
    mock.timers.tick(1200); // flush → 写 MSG（在途）
    await flushAwait();
    const clearing = store.clear(); // 发送成功：删除入队（须等在途写之后）
    await flushAwait();

    const release = gate.release;
    assert.ok(release !== undefined, "第一份内容的写确实在途");
    release(); // 在途写落地
    await clearing;
    await flushAwait();

    assert.deepEqual(
      rig.writes,
      [serializeComposerDraft(MSG, null), ""],
      "次序：写在先、删除在后（并发时 rename 可能压在 remove 之后）",
    );
    assert.equal(rig.file, null, "已发送内容不复活成草稿");

    // 「已落盘」基准也跟着归空：同样的内容再打一次要能写盘（MUST NOT 谎报已保存）
    rig.putGate = undefined; // 闸撤掉：第三次写不再挂住
    store.schedule(MSG, null);
    mock.timers.tick(1200);
    await flushAwait();
    assert.deepEqual(
      rig.writes,
      [serializeComposerDraft(MSG, null), "", serializeComposerDraft(MSG, null)],
      "清除后同样的内容再编辑一次仍然落盘",
    );
    assert.equal(rig.file, serializeComposerDraft(MSG, null));
  } finally {
    mock.timers.reset();
  }
});
