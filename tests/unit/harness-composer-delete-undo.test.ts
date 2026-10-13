// M510 单测：删除族的撤销 force 语义。
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
} from "../../src/harness-panel.ts";
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

/** 复现链：贴图（force=true）→ 簇窗口内删除族一步 → 返回撤销栈、该步与删除后的模型。
 *  `forceOverride` 用于反向守卫——把删除族的 force 强制回缺陷值，验证断言确有区分度。 */
function pasteThenDelete(entry: (typeof ENTRIES)[number], forceOverride?: boolean) {
  const clock = { t: 1000 };
  const history = createUndoHistory<Snap>({
    now: () => clock.t,
    equals: (a, b) => JSON.stringify(a.blocks) === JSON.stringify(b.blocks),
  });
  history.push({ blocks: EMPTY, caret: { block: 0, offset: 0 } }, true); // 贴图：结构性操作
  clock.t = 1200; // 距贴图 200ms，落在 1000ms 聚簇窗口内
  const step = deleteFamilyStep(AFTER_PASTE, entry.sel, entry.op);
  assert.ok(step !== null, `${entry.label}：卡片档删除不应是空转`);
  const force = forceOverride ?? step.force;
  history.push({ blocks: AFTER_PASTE, caret: entry.caret }, force);
  const afterDelete = step!.op(AFTER_PASTE);
  return { history, step: step!, afterDelete };
}

for (const entry of ENTRIES) {
  test(`撤销：${entry.label}——贴图后簇窗口内删卡，⌘Z 复原卡片`, () => {
    const { history, step, afterDelete } = pasteThenDelete(entry);
    assert.equal(step.force, true, `${entry.label}：删除是结构性操作，MUST force 独立成步（不受聚簇吞并）`);
    const restored = history.undo({ blocks: afterDelete.blocks, caret: afterDelete.caret });
    assert.deepEqual(
      restored?.blocks,
      AFTER_PASTE,
      `${entry.label}：⌘Z 必须恢复「贴图后、删卡前」状态（卡片仍在），而非弹回贴图前的空态`,
    );
  });
}

test("反向守卫：同一复现链把删除族 force 强制回 false，⌘Z 弹回贴图前的空态", () => {
  for (const entry of ENTRIES) {
    const { history, afterDelete } = pasteThenDelete(entry, false);
    const restored = history.undo({ blocks: afterDelete.blocks, caret: afterDelete.caret });
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
