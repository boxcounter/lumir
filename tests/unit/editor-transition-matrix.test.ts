// tests/unit/editor-transition-matrix.test.ts —— 编辑状态迁移矩阵的 Node 层
//（change add-editor-transition-oracle-nov27）。
//
// 本层做两件事，都不需要浏览器：
//   1. **模型自检**：四态状态机的期望自己说得通（只读空转、组合中删除只吃 marked 区、
//      结算窗口不改源码、选区 Enter = 用换行替换选区）。
//   2. **覆盖契约**：矩阵没有退化成全笛卡尔、每个可行取值对都被覆盖、每个高风险族都在场、
//      每条 N/A 都有理由。覆盖读数在 `LUMIR_TRANSITION_MATRIX_REPORT=1` 时逐行打印。
//
// 生产执行在 `tests/visual/scenes/editor-transition-matrix.spec.ts`：`src/editor.ts` 的 import
// 图带参数属性，Node 的类型剥离层加载不了（既有约束，见 `src/cell-geometry.ts` 文件头），
// 闸门只能在真 `EditorView` 上驱动。本层不伪造 DOM、不 import 生产期望值。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BodyOracle,
  TransitionOracle,
  changedLineRange,
  graphemeBefore,
} from "./editing-oracle-model.ts";
import type { EditActionKind } from "./editing-oracle-model.ts";
import {
  ACTIONS,
  CONTEXTS,
  FIXTURES,
  HIGH_RISK_FAMILIES,
  NOT_APPLICABLE,
  SELECTIONS,
  STATES,
  buildMatrix,
  cellId,
  feasibleTuples,
  formatMatrixReport,
  notApplicableReason,
  pairwiseTuples,
} from "./editor-transition-matrix.ts";

const reportEnabled = Boolean(
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.LUMIR_TRANSITION_MATRIX_REPORT,
);

// ---------------------------------------------------------------------------
// 模型自检
// ---------------------------------------------------------------------------

test("模型自检：只读态的四类编辑动作全空转、撤销栈不新增事件", () => {
  for (const kind of ["type", "deleteBackward", "deleteForward", "enter", "paste"] as EditActionKind[]) {
    const oracle = new TransitionOracle("alpha\nbeta\n", 2, "readOnly");
    const before = oracle.snapshot();
    const expected = oracle.apply({ kind, text: "Q" });
    assert.deepEqual(oracle.snapshot(), before, `${kind}: 只读不得改文档 / 选区`);
    assert.deepEqual(
      { doc: expected.doc, anchor: expected.anchor, head: expected.head },
      before,
      `${kind}: 期望值也必须是空转`,
    );
    assert.equal(expected.history.steps, 0, `${kind}: 只读不得新增撤销步`);
    assert.equal(expected.touched, null, `${kind}: 没有触及行`);
  }
});

test("模型自检：组合中删除只吃 marked 区；marked 已空时起点再删不改文档", () => {
  const oracle = new TransitionOracle("词\n- s", 5, "composing");
  const before = oracle.snapshot();
  oracle.startComposition();
  oracle.compositionSetMarked("shuang");
  assert.equal(oracle.snapshot().doc, `${before.doc}shuang`);
  const composed = oracle.snapshot();

  oracle.compositionDelete();
  assert.equal(oracle.snapshot().doc, `${before.doc}shuan`, "只删 marked 区最后一个字素");
  assert.equal(oracle.snapshot().head, composed.head - 1);

  // 删空 marked 之后起点再按：文档 / 选区逐字节不变。
  for (let index = 0; index < 6; index += 1) oracle.compositionDelete();
  assert.equal(oracle.snapshot().doc, before.doc, "marked 删空后不得越过到 committed 文本");
  const atStart = oracle.snapshot();
  oracle.compositionDelete();
  assert.deepEqual(oracle.snapshot(), atStart, "起点再删不改文档");
});

test("模型自检：组合提交后进入 settling，结算回调不改源码；flush 后回到 idle", () => {
  const oracle = new TransitionOracle("alpha ", 6, "composing");
  oracle.startComposition();
  oracle.compositionSetMarked("候");
  const committed = oracle.snapshot();
  oracle.endComposition();
  assert.equal(oracle.state, "settling");
  assert.equal(oracle.pendingSettle, true);
  assert.deepEqual(oracle.snapshot(), committed, "组合结束不额外改源码");
  oracle.flushSettle();
  assert.equal(oracle.state, "idle");
  assert.deepEqual(oracle.snapshot(), committed, "结算回调 MUST NOT 改源码 / 选区");
});

test("模型自检：settling 窗口内的期望与 idle 同一格逐字节相等", () => {
  for (const action of [
    { kind: "deleteBackward" as const },
    { kind: "deleteForward" as const },
    { kind: "type" as const, text: "Q" },
  ]) {
    for (const context of CONTEXTS) {
      const fixture = FIXTURES[context];
      const caret = action.kind === "deleteBackward" ? fixture.lineStartAt : fixture.lineEndAt;
      const idle = new TransitionOracle(fixture.doc, caret, "idle");
      const settling = new TransitionOracle(fixture.doc, caret, "settling");
      settling.startComposition();
      settling.endComposition();
      const idleExpected = idle.apply(action);
      const settlingExpected = settling.apply(action);
      assert.deepEqual(
        { doc: settlingExpected.doc, anchor: settlingExpected.anchor, head: settlingExpected.head },
        { doc: idleExpected.doc, anchor: idleExpected.anchor, head: idleExpected.head },
        `${context}/${action.kind}: settling 不得改变期望落点`,
      );
      assert.equal(settlingExpected.settle, "pending", `${context}/${action.kind}: 动作后结算仍未跑`);
    }
  }
});

test("模型自检：非空选区的 Enter 一律是用换行替换选区（两引擎 probe 的四格）", () => {
  const cases: Array<{ doc: string; anchor: number; head: number; expected: string }> = [
    { doc: "alpha beta\ngamma\n", anchor: 2, head: 6, expected: "al\nbeta\ngamma\n" },
    { doc: "- a\n- b\n", anchor: 2, head: 4, expected: "- \n- b\n" },
    { doc: "| a | b |\n| --- | --- |\n| c | d |\n", anchor: 26, head: 30, expected: "| a | b |\n| --- | --- |\n| \nd |\n" },
    { doc: "alpha\n$$\nx+y\n$$\n", anchor: 2, head: 5, expected: "al\n\n$$\nx+y\n$$\n" },
  ];
  for (const item of cases) {
    const oracle = new BodyOracle(item.doc, item.anchor);
    oracle.setSelection(item.anchor, item.head);
    oracle.enter();
    assert.equal(oracle.doc, item.expected, JSON.stringify(item));
    assert.equal(oracle.head, item.anchor + 1, "光标落在换行之后");
  }
});

test("模型自检：一次 undo 回到动作前、一次 redo 回到动作后（idle 与 settling 同判）", () => {
  for (const state of ["idle", "settling"] as const) {
    const oracle = new TransitionOracle("- a\n- b\n", 4, state);
    if (state === "settling") {
      oracle.startComposition();
      oracle.endComposition();
    }
    const before = oracle.snapshot();
    const expected = oracle.apply({ kind: "deleteBackward" });
    assert.equal(expected.history.steps, 1, `${state}: 一个动作 = 一个撤销步`);
    assert.deepEqual(expected.history.restores, before);
    assert.equal(expected.doc, "- a- b\n", `${state}: 跨行合并只删换行`);
    oracle.body.undo();
    assert.deepEqual(oracle.snapshot(), before, `${state}: 一次 undo 复原`);
    oracle.body.redo();
    assert.equal(oracle.snapshot().doc, expected.doc, `${state}: 一次 redo 回到动作后`);
  }
});

test("changedLineRange 只标出真正变化的行（非目标行不变的失败定位）", () => {
  assert.equal(changedLineRange("a\nb\n", "a\nb\n"), null);
  assert.deepEqual(changedLineRange("alpha\nbeta\n", "alphaQ\nbeta\n"), { fromLine: 1, toLine: 1 });
  assert.deepEqual(changedLineRange("alpha\nbeta\n", "alphabeta\n"), { fromLine: 1, toLine: 1 });
  assert.deepEqual(graphemeBefore("👨‍👩‍👧x", 11), 8, "ZWJ 家庭是一个字素簇");
});

// ---------------------------------------------------------------------------
// 覆盖契约
// ---------------------------------------------------------------------------

test("矩阵覆盖契约：非全笛卡尔 + 可行对全覆盖 + 高风险族在场 + N/A 有理由", () => {
  const matrix = buildMatrix();
  if (reportEnabled) console.log(formatMatrixReport(matrix));

  assert.ok(matrix.cells.length > 0, "矩阵不能为空");
  assert.ok(
    matrix.cells.length < matrix.fullProduct,
    `矩阵退化为全笛卡尔：cells=${matrix.cells.length} full-product=${matrix.fullProduct}`,
  );
  assert.ok(matrix.feasible < matrix.fullProduct, "可行元组不得等于全乘积（否则 N/A 规则没生效）");

  // 1) 每个可行对都被覆盖。
  assert.equal(
    matrix.pairsCovered,
    matrix.pairsTotal,
    `可行取值对未覆盖：${matrix.pairsCovered}/${matrix.pairsTotal}`,
  );

  // 2) 高风险族逐一在场，且格里标了族名。
  for (const family of HIGH_RISK_FAMILIES) {
    for (const cell of family.cells) {
      const found = matrix.cells.find((item) => item.id === cellId(cell));
      assert.ok(found !== undefined, `高风险族 ${family.name} 缺格：${cellId(cell)}`);
      assert.equal(found.highRisk, family.name, `${cellId(cell)} 的高风险族名不符`);
    }
  }

  // 3) 每格都有条款、至少一个 case、每个 case 有说明；case 的动作必须与格子的动作维一致。
  for (const cell of matrix.cells) {
    assert.ok(cell.clause.length > 0, `${cell.id}: 缺合同条款`);
    assert.ok(cell.cases.length > 0, `${cell.id}: 缺 case`);
    for (const item of cell.cases) {
      assert.ok(item.note.length > 0, `${cell.id}: case 缺现场说明`);
      assert.equal(item.action.kind, cell.action, `${cell.id}: case 动作与格子动作维不一致`);
    }
  }

  // 4) 每条 N/A 都有非空理由；N/A 规则不得命中矩阵里的格。
  for (const rule of NOT_APPLICABLE) {
    assert.ok(rule.reason.trim().length > 0, `N/A 规则缺理由：${JSON.stringify(rule)}`);
  }
  for (const cell of matrix.cells) {
    assert.equal(
      notApplicableReason(cell.state, cell.selection, cell.context, cell.action),
      null,
      `${cell.id}: 被 N/A 规则命中却仍在矩阵里`,
    );
  }

  // 5) 四维每个取值至少出现一次（没有整维被 N/A 规则吞掉）。
  for (const state of STATES) assert.ok(matrix.cells.some((cell) => cell.state === state), `state ${state} 零覆盖`);
  for (const selection of SELECTIONS) {
    assert.ok(matrix.cells.some((cell) => cell.selection === selection), `selection ${selection} 零覆盖`);
  }
  for (const context of CONTEXTS) assert.ok(matrix.cells.some((cell) => cell.context === context), `context ${context} 零覆盖`);
  for (const action of ACTIONS) assert.ok(matrix.cells.some((cell) => cell.action === action), `action ${action} 零覆盖`);

  // 6) 可行元组数 = 全乘积 − 被 N/A 规则命中的元组数（规则之间不得互相遮蔽出意外）。
  const naCount = matrix.fullProduct - matrix.feasible;
  assert.ok(naCount > 0, "没有任何 N/A 组合：说明规则没生效");
  assert.equal(feasibleTuples().length, matrix.feasible);
});

test("矩阵规模读数：格数 / 高风险格 / pairwise 行 / 场景数在预算内", () => {
  const matrix = buildMatrix();
  const cases = matrix.cells.reduce((sum, cell) => sum + cell.cases.length, 0);
  // 预算不是审美：真引擎场景每格要开页 / 复位 / 动作 / 撤销 / 保存，格数失控会让
  // `scripts/gate.sh visual` 的时长再涨一个量级。上限按「必要时调大但必须说明」设。
  assert.ok(matrix.cells.length <= 90, `矩阵格数超预算：${matrix.cells.length}`);
  assert.ok(cases <= 110, `场景数超预算：${cases}`);
  assert.ok(matrix.highRiskCells >= 40, `高风险格太少：${matrix.highRiskCells}`);
  assert.ok(pairwiseTuples().length >= 10, `pairwise 行太少：${pairwiseTuples().length}`);
});

test("pairwise 生成器：确定性、无重复、行数少于可行元组", () => {
  const first = pairwiseTuples();
  const second = pairwiseTuples();
  assert.deepEqual(first, second, "pairwise 必须确定性（同输入同输出）");
  const ids = new Set(first.map((tuple) => cellId(tuple)));
  assert.equal(ids.size, first.length, "pairwise 行不得重复");
  assert.ok(first.length < feasibleTuples().length, "pairwise 必须真的减少行数");
});
