// src/cell-geometry.ts 的纯位置判定单测（M185）：cell 归属 + ⌃E 的落点口径（M168 的「当前 cell
// 内容区内最右可停靠位」+ M185 的「右边界位按前向归属」）。
//
// 为什么这条口径能在本层测：判定只读 EditorState（文档文本 + 解析树），不碰 view、不碰坐标测量。
// 所以这里用**真 EditorState + 真 markdown 解析器**驱动（本层口径见 README：会话内容用真的
// EditorState 承载）。view 侧只剩「落点是否可停靠」的回退——那需要真 DOM 坐标，归 chromium 场景
// （tests/visual/scenes/m118-cursor-interaction.spec.ts、m168-table-cell-line-end.spec.ts）与真机套件
// （scripts/acceptance/scenarios/24-table-cell-ctrl-e-seq.md）。
//
// 形态矩阵里的一个关键事实（本层测不了、由 chromium 实测提供）：**⌃F 的落点**。从 cell 内容右缘
// 按 ⌃F 走一步，落点是紧随其后的隐藏管道符左缘（= 该 cell slot 的 `to`），不是下一 cell 的内容
// 起点——真 DOM 里那个位置的原生 caret 矩形退化为 0×0（`coordsAtPos(pos, ±1)` 两侧都退化），
// 浏览器把 caret 画到管道符之后第一个被绘制的内容上（用户即看到「光标进入下个 cell」）。
// 本文件因此只驱动「给定落点，⌃E 取哪个 cell 的内容右缘」这一半；下面每条用例的起点里，
// `boundary(...)` 就是那个 ⌃F 落点（= 该 cell 右边界位）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { cellClamp, cellContentEdge } from "../../src/cell-geometry.ts";

/** 一个 grid 表形态：表头 / 分隔线 / 数据行（列数一致，否则表判非矩形、不参与 cell 钳制）。 */
interface Shape {
  id: string;
  header: string;
  sep: string;
  row: string;
}

const SHAPES: Record<string, Shape> = {
  pad2: { id: "2 列 · 对齐空白", header: "| h1 | h2 |", sep: "| --- | --- |", row: "| c1 | c2 |" },
  pad3: { id: "3 列 · 对齐空白", header: "| h1 | h2 | h3 |", sep: "| --- | --- | --- |", row: "| c1 | c2 | c3 |" },
  padWide: { id: "2 列 · 多空格对齐空白", header: "| h1 | h2 |", sep: "| --- | --- |", row: "| c1   | c2 |" },
  padShortRow: { id: "3 列表头 · 短行补空列（M137）", header: "| h1 | h2 | h3 |", sep: "| --- | --- | --- |", row: "| c1 | c2 |" },
  emptySlot: { id: "3 列 · 中间空 cell（空格槽）", header: "| h1 | h2 | h3 |", sep: "| --- | --- | --- |", row: "| c1 |  | c3 |" },
  flush: { id: "2 列 · 内容紧贴管道符", header: "|h1|h2|", sep: "|---|---|", row: "|c1|c2|" },
  flushLast: { id: "3 列 · 内容紧贴管道符 · 末 cell", header: "|h1|h2|h3|", sep: "|---|---|---|", row: "|c1|c2|c3|" },
};

const DOC_TAIL = ["", "尾巴段。", ""].join("\n");

function stateFor(shape: Shape): EditorState {
  const doc = [shape.header, shape.sep, shape.row, DOC_TAIL].join("\n");
  return EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [GFM] })] });
}

function rowFrom(state: EditorState): number {
  return state.doc.line(3).from;
}

/** cell 内容右缘（行内偏移）：内容文本之后的位置。 */
function contentRight(shape: Shape, content: string): number {
  const at = shape.row.indexOf(content);
  assert.ok(at >= 0, `${shape.id}：行里找不到 cell 内容 ${JSON.stringify(content)}`);
  return at + content.length;
}

/** cell 右边界位（行内偏移）：内容之后那个隐藏管道符的左缘——就是 ⌃F 从内容右缘走一步的落点。 */
function boundary(shape: Shape, content: string): number {
  const after = contentRight(shape, content);
  const pipe = shape.row.indexOf("|", after);
  assert.ok(pipe >= 0, `${shape.id}：内容 ${JSON.stringify(content)} 之后没有管道符`);
  return pipe;
}

/** 归属 cell 的内容右缘（⌃E 的落点：`cellContentEdge` 返回区间的 `to`）。 */
function lineEndTarget(state: EditorState, local: number): number | null {
  const edge = cellContentEdge(state, rowFrom(state) + local);
  return edge === null ? null : edge.to - rowFrom(state);
}

test("⌃E→⌃F→⌃E：第二次 ⌃E 落在下一个 cell 的内容右缘（M185 修复点）", () => {
  for (const shape of [SHAPES.pad2, SHAPES.pad3, SHAPES.padWide]) {
    const state = stateFor(shape);
    const startLocal = contentRight(shape, "c1");
    const boundaryLocal = boundary(shape, "c1");

    // ① ⌃E：从 cell 1 内容内到它的内容右缘（M168 口径，未变）
    assert.equal(lineEndTarget(state, startLocal), startLocal, `${shape.id}：① ⌃E 应落在本 cell 内容右缘`);
    // ② ⌃F 的落点是该 cell 的右边界位 = 紧随其后的隐藏管道符左缘（chromium 实测，见文件头）
    assert.equal(shape.row[boundaryLocal], "|", `${shape.id}：边界位就是隐藏管道符的位置`);
    assert.ok(boundaryLocal > startLocal, `${shape.id}：边界位在内容右缘之后（⌃F 可达）`);
    // ③ ⌃E：归属顺延到下一个 cell，落点是它内容的右缘（修复前会回到 c1 之后的内容右缘）
    assert.equal(
      lineEndTarget(state, boundaryLocal),
      contentRight(shape, "c2"),
      `${shape.id}：③ ⌃E 应落在下一个 cell 的内容右缘，不得退回前一个 cell`,
    );
  }

  // Alex 现场那个形态：cell 两侧各一个空格时，⌃E 后按一次 ⌃F 就正好停在边界位上
  //（对齐空白多于一个空格时，要按到边界位需多按几次 ⌃F 跨过空白——边界位上的归属规则同一条）
  for (const shape of [SHAPES.pad2, SHAPES.pad3]) {
    assert.equal(boundary(shape, "c1"), contentRight(shape, "c1") + 1, `${shape.id}：单空格对齐空白下 ⌃F 一步到边界位`);
  }
  assert.equal(boundary(SHAPES.padWide, "c1"), contentRight(SHAPES.padWide, "c1") + 3, "多空格形态：边界位在空白之后");
});

test("前向规则不触发的三种形态：内容紧贴管道符 / 下一 cell 无内容 / 末 cell", () => {
  // ① 内容紧贴管道符：边界位就是内容右缘，归属本 cell（不动）
  const flush = stateFor(SHAPES.flush);
  const flushEdge = contentRight(SHAPES.flush, "c1");
  assert.equal(lineEndTarget(flush, flushEdge), flushEdge, "紧贴形态：边界位即内容右缘，⌃E 原地");

  // ② 下一 cell 无内容：空格槽（内容区间为空）
  const empty = stateFor(SHAPES.emptySlot);
  assert.equal(
    lineEndTarget(empty, boundary(SHAPES.emptySlot, "c1")),
    contentRight(SHAPES.emptySlot, "c1"),
    "下一 cell 是空格槽：不顺延，⌃E 回到本 cell 内容右缘",
  );
  // ② 下一 cell 无内容：短行补出来的零宽槽（M137）——末个真实 cell 的右侧边界
  const short = stateFor(SHAPES.padShortRow);
  assert.equal(
    lineEndTarget(short, boundary(SHAPES.padShortRow, "c2")),
    contentRight(SHAPES.padShortRow, "c2"),
    "下一 cell 是短行补空列：不顺延，⌃E 回到本 cell 内容右缘",
  );

  // ③ 末 cell：右侧是尾管道，本 row 没有后续 cell 可归属
  const pad3 = stateFor(SHAPES.pad3);
  assert.equal(
    lineEndTarget(pad3, boundary(SHAPES.pad3, "c3")),
    contentRight(SHAPES.pad3, "c3"),
    "末 cell：不顺延，⌃E 回到本 cell 内容右缘",
  );
  const flushLast = stateFor(SHAPES.flushLast);
  const flushLastEdge = contentRight(SHAPES.flushLast, "c3");
  assert.equal(lineEndTarget(flushLast, flushLastEdge), flushLastEdge, "紧贴形态末 cell：⌃E 原地");
});

test("边界位的归属口径：编辑命令按本 cell（inside + next），⌃E 按前向", () => {
  const shape = SHAPES.pad2;
  const state = stateFor(shape);
  const lineFrom = rowFrom(state);
  const clamp = cellClamp(state, lineFrom + boundary(shape, "c1"));

  assert.ok(clamp !== null);
  // 编辑命令（⌃K / ⌥D / ⌃T …）要的口径：边界位算本 cell 的右缘（inside=true），命令据此不动文档
  assert.equal(clamp.to - lineFrom, boundary(shape, "c1"), "边界位归属本 cell 的 slot");
  assert.equal(clamp.inside, true, "边界位在 slot 内（闭区间），这不变量是编辑命令「不动文档」的判据来源");
  // 同时把「后面还有哪个 cell」交给调用方——⌃E 的前向规则消费它
  assert.deepEqual(
    clamp.next && { from: clamp.next.from - lineFrom, to: clamp.next.to - lineFrom },
    { from: boundary(shape, "c1") + 1, to: boundary(shape, "c2") },
    "next 是同 row 的下一个 slot（从分隔管道之后到下一个管道；含它自己的对齐空白）",
  );
});

test("落点幂等：在归属 cell 的内容右缘上再算一次不漂移", () => {
  for (const shape of Object.values(SHAPES)) {
    const state = stateFor(shape);
    for (const content of ["c1", "c2", "c3"].filter((c) => shape.row.includes(c))) {
      const local = contentRight(shape, content);
      const first = lineEndTarget(state, local);
      assert.ok(first !== null, `${shape.id}：${content} 应在 grid 表内`);
      assert.equal(lineEndTarget(state, first), first, `${shape.id}：${content} 处重复取行尾不得漂移`);
    }
    assert.equal(state.doc.toString(), stateFor(shape).doc.toString(), `${shape.id}：判定是纯函数，文档逐字节不变`);
  }
});

test("非 grid 表格行不参与：降级表 / 非矩形表返回 null（调用方回落整篇文档口径）", () => {
  // 表头声明 3 列、数据行只有 2 列且不能被补空列解释的形态不成立；这里用「无分隔线」证明不参与钳制
  const doc = ["| h1 | h2 |", "| c1 | c2 |", "", "尾巴段。", ""].join("\n");
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [GFM] })] });
  assert.equal(cellContentEdge(state, state.doc.line(2).from + 2), null, "没有分隔线的表不是 grid 表，不参与 cell 钳制");
  assert.equal(cellClamp(state, state.doc.line(1).from), null, "元信息行同样不在 grid 表内");
});
