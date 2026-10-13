// M510 单测：删除族（⌃D / ⌃H / 裸 Backspace·Delete）与 kill 族选区档（⌥D / ⌥⌫ / ⌃K）的撤销 force 语义。
//
// 合同：openspec/specs/harness/spec.md「混排输入区的撤销栈聚簇与结构操作独立成步」——结构性操作
// （卡片插入/移除、粘贴、拆段、删除族）SHALL 强制独立成撤销步（force=true），MUST NOT 与聚簇窗口内
// 的前一步共用一个前态。这条不变量 M343 只落在实现注释里、living spec 缺条款，M447/M453 的删除族
// 因此写成 force=false（M510 补条款 + 修实现）。
//
// 复现链（M508 finding）：贴图走 force=true 压入「贴图前空态」前态 → 1000ms 聚簇窗口内 ⌃H 删卡
// → 删除族若 force=false，这一步被聚簇早退吞掉（`createUndoHistory` 的 `at - lastEditAt < clusterMs`）
// → ⌘Z 弹回贴图前的空 composer。
//
// 这一层是零 DOM 环境（tests/unit/README.md）：驱动删除族三入口共用的纯函数 seam `deleteFamilyStep`
// 与 `createUndoHistory`（假时钟）。DOM 接线（键位分发 / keydown 分支）归真机验收场景 143。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backspaceAtCaret,
  createUndoHistory,
  deleteFamilyStep,
  deleteForwardAtCaret,
  selectionDeleteStep,
  softBreakStep,
} from "../../src/harness-panel.ts";
import type { ComposerEditStep } from "../../src/harness-panel.ts";
import type { ComposerBlock, QuoteCard } from "../../src/quote-card.ts";

type Caret = { block: number; offset: number };
type Sel = { anchor: Caret; focus: Caret };
type DeleteOp = (blocks: readonly ComposerBlock[], caret: Caret) => { blocks: ComposerBlock[]; caret: Caret } | null;
type Snap = { blocks: ComposerBlock[]; caret: Caret | null };

const para = (text: string): ComposerBlock => ({ kind: "paragraph", text });
const quoteCard: QuoteCard = { file: "synth.md", heading: "H", headingPath: "H", lines: "1-1", text: "合成摘录" };
const card = (): ComposerBlock => ({ kind: "quote", card: quoteCard });

/** 贴图前的 composer（空态）。 */
const EMPTY: ComposerBlock[] = [para("")];
/** 贴图后的 composer：图片/摘录卡片 + 卡片下一行的问题段落（光标落在该段落段首）。 */
const AFTER_PASTE: ComposerBlock[] = [card(), para("")];

/** 删除族三入口（M510 的改动面）——每档给出该入口喂给 `deleteFamilyStep` 的选区与模型操作。
 *  ⌃D / ⌃H 两档走 `runComposerCommand` 的 `deleteAtCaret`；裸 Backspace/Delete 档走 composer
 *  keydown 分支。三处今天共用同一份 `deleteFamilyStep`（force 的单一真源）。 */
const ENTRIES: ReadonlyArray<{ label: string; sel: Sel; op: DeleteOp; caret: Caret }> = [
  {
    label: "⌃D / ⌃H 选区档（deleteAtCaret 选区删除）",
    sel: { anchor: { block: 0, offset: 0 }, focus: { block: 1, offset: 0 } },
    op: backspaceAtCaret,
    caret: { block: 1, offset: 0 },
  },
  {
    label: "⌃D / ⌃H 就地档（deleteAtCaret 就地删除，光标在卡片前缘）",
    sel: { anchor: { block: 0, offset: 0 }, focus: { block: 0, offset: 0 } },
    op: deleteForwardAtCaret,
    caret: { block: 0, offset: 0 },
  },
  {
    label: "裸 Backspace 档（composer keydown，段首前块是卡片）",
    sel: { anchor: { block: 1, offset: 0 }, focus: { block: 1, offset: 0 } },
    op: backspaceAtCaret,
    caret: { block: 1, offset: 0 },
  },
];

/** 复现链：贴图（force=true 压栈）→ Δt=200ms（落在 1000ms 聚簇窗口内）→ 某一步删除。
 *  返回撤销栈、该步与删除后的模型；`forceOverride` 把 force 强制回缺陷值以验证断言有区分度。 */
function pasteThenStep(step: ComposerEditStep, caret: Caret, forceOverride?: boolean) {
  const clock = { t: 1000 };
  const history = createUndoHistory<Snap>({
    now: () => clock.t,
    equals: (a, b) => JSON.stringify(a.blocks) === JSON.stringify(b.blocks),
  });
  history.push({ blocks: EMPTY, caret: { block: 0, offset: 0 } }, true); // 贴图：结构性操作
  clock.t = 1200; // 距贴图 200ms，落在 1000ms 聚簇窗口内
  history.push({ blocks: AFTER_PASTE, caret }, forceOverride ?? step.force);
  const after = step.op(AFTER_PASTE);
  return { history, step, after };
}

/** 删除族三入口的模型步（走 `deleteFamilyStep`）。 */
function deleteStepFor(entry: (typeof ENTRIES)[number]): ComposerEditStep {
  const step = deleteFamilyStep(AFTER_PASTE, entry.sel, entry.op);
  assert.ok(step !== null, `${entry.label}：卡片档删除不应是空转`);
  return step;
}

for (const entry of ENTRIES) {
  test(`撤销：${entry.label}——贴图后簇窗口内删卡，⌘Z 复原卡片`, () => {
    const { history, step, after } = pasteThenStep(deleteStepFor(entry), entry.caret);
    assert.equal(step.force, true, `${entry.label}：删除是结构性操作，MUST force 独立成步（不受聚簇吞并）`);
    const restored = history.undo({ blocks: after.blocks, caret: after.caret });
    assert.deepEqual(
      restored?.blocks,
      AFTER_PASTE,
      `${entry.label}：⌘Z 必须恢复「贴图后、删卡前」状态（卡片仍在），而非弹回贴图前的空态`,
    );
  });
}

test("反向守卫：同一复现链把删除族 force 强制回 false，⌘Z 弹回贴图前的空态", () => {
  for (const entry of ENTRIES) {
    const { history, after } = pasteThenStep(deleteStepFor(entry), entry.caret, false);
    const restored = history.undo({ blocks: after.blocks, caret: after.caret });
    assert.deepEqual(
      restored?.blocks,
      EMPTY,
      `${entry.label}：force=false 时删除步被聚簇吞掉——这一步正是缺陷现场，证明上面的断言有区分度`,
    );
  }
});

test("删除族无动作（段首退格 / 前向删除到末缘 / 无选区）返回 null——空转不产生幽灵撤销步", () => {
  const blocks: ComposerBlock[] = [para("abc")];
  assert.equal(
    deleteFamilyStep(blocks, { anchor: { block: 0, offset: 0 }, focus: { block: 0, offset: 0 } }, backspaceAtCaret),
    null,
    "段首退格无物可删",
  );
  assert.equal(
    deleteFamilyStep(blocks, { anchor: { block: 0, offset: 3 }, focus: { block: 0, offset: 3 } }, deleteForwardAtCaret),
    null,
    "前向删除到末缘无物可删",
  );
  assert.equal(deleteFamilyStep(blocks, null, backspaceAtCaret), null, "无选区无动作");
});

// ── kill 族选区档（⌥D / ⌥⌫ 的 `killWordAtCaret`、⌃K 的 `killLineAtCaretCommand`）─────────
// 与删除族选区档同一缺陷机制：force=true 的结构操作后、聚簇窗口内的选区 kill 也不得被吞。
// 两个入口今天共用 `selectionDeleteStep`（force 的单一真源）。

const KILL_ENTRIES: ReadonlyArray<{ label: string; sel: Sel; caret: Caret }> = [
  {
    label: "⌥D / ⌥⌫ 选区档（killWordAtCaret）",
    sel: { anchor: { block: 0, offset: 0 }, focus: { block: 1, offset: 0 } },
    caret: { block: 1, offset: 0 },
  },
  {
    label: "⌃K 选区档（killLineAtCaretCommand）",
    sel: { anchor: { block: 0, offset: 0 }, focus: { block: 1, offset: 0 } },
    caret: { block: 1, offset: 0 },
  },
];

for (const entry of KILL_ENTRIES) {
  test(`撤销：${entry.label}——贴图后簇窗口内删选区，⌘Z 复原卡片`, () => {
    const step = selectionDeleteStep(entry.sel);
    assert.ok(step !== null, `${entry.label}：非折叠选区必有删除步`);
    const { history, after } = pasteThenStep(step!, entry.caret);
    assert.equal(step!.force, true, `${entry.label}：选区删除是结构性操作，MUST force 独立成步`);
    const restored = history.undo({ blocks: after.blocks, caret: after.caret });
    assert.deepEqual(
      restored?.blocks,
      AFTER_PASTE,
      `${entry.label}：⌘Z 必须恢复「贴图后、选区 kill 前」状态（卡片仍在），而非弹回贴图前的空态`,
    );
  });
}

test("反向守卫：kill 族选区档 force 强制回 false，⌘Z 弹回贴图前的空态", () => {
  for (const entry of KILL_ENTRIES) {
    const step = selectionDeleteStep(entry.sel)!;
    const { history, after } = pasteThenStep(step, entry.caret, false);
    const restored = history.undo({ blocks: after.blocks, caret: after.caret });
    assert.deepEqual(
      restored?.blocks,
      EMPTY,
      `${entry.label}：force=false 时选区删除被聚簇吞掉——缺陷现场，证明上面的断言有区分度`,
    );
  }
});

test("选区删除步：无选区 / 折叠选区返回 null（无动作不产生幽灵撤销步）", () => {
  assert.equal(selectionDeleteStep(null), null, "无选区无动作");
  assert.equal(
    selectionDeleteStep({ anchor: { block: 0, offset: 1 }, focus: { block: 0, offset: 1 } }),
    null,
    "折叠选区无动作",
  );
});

// ── 拆段（⇧Enter 软断行）────────────────────────────────────────────────────
// 同一缺陷机制第三实例（M510 r1 评审 P1-1）：贴图 force 压栈后 1s 内的 ⇧Enter 拆段若 force=false
// 会被聚簇吞掉，⌘Z 一步连贴图一起弹没。拆段是结构性操作——`withModel` 的 M343 文档自始即把
// 「拆段」列为 force=true。

const SOFT_BREAK_CARET: Caret = { block: 1, offset: 0 }; // 贴图后光标落在卡片下一行的问题段落

test("撤销：⇧Enter 拆段（softBreakStep）——贴图后簇窗口内拆段，⌘Z 复原贴图后态", () => {
  const step = softBreakStep(() => SOFT_BREAK_CARET);
  const { history, after } = pasteThenStep(step, SOFT_BREAK_CARET);
  assert.deepEqual(
    after.blocks,
    [card(), para(""), para("")],
    "前置：拆段确实落了新段落块（拆段是结构变化，不是空转）",
  );
  assert.equal(step.force, true, "拆段是结构性操作，MUST force 独立成步（不受聚簇吞并）");
  const restored = history.undo({ blocks: after.blocks, caret: after.caret });
  assert.deepEqual(
    restored?.blocks,
    AFTER_PASTE,
    "⌘Z 必须恢复「贴图后、拆段前」状态（卡片与问题段落仍在），而非弹回贴图前的空态",
  );
});

test("反向守卫：拆段 force 强制回 false，⌘Z 连贴图一起弹没", () => {
  const step = softBreakStep(() => SOFT_BREAK_CARET);
  const { history, after } = pasteThenStep(step, SOFT_BREAK_CARET, false);
  const restored = history.undo({ blocks: after.blocks, caret: after.caret });
  assert.deepEqual(
    restored?.blocks,
    EMPTY,
    "force=false 时拆段步被聚簇吞掉——这一步正是缺陷现场，证明上面的断言有区分度",
  );
});
