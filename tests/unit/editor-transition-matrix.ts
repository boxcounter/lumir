// tests/unit/editor-transition-matrix.ts —— 编辑状态迁移矩阵的**定义**（change
// add-editor-transition-oracle-nov27）。
//
// 分工：
// - 本文件只声明「有哪几格、每格的上下文 fixture 与动作位置、哪些组合不可行及理由」，以及
//   pairwise 覆盖与覆盖读数；**期望值**一律由 `editing-oracle-model.ts` 的 TransitionOracle
//   按 fixture + 状态 + 选区 + 动作算出（不由本文件写死）。
// - 执行层两个：Node 层跑覆盖契约与模型自检（`editor-transition-matrix.test.ts`）；真引擎层
//   在 `tests/visual/scenes/editor-transition-matrix.spec.ts` 跑同一份格子。
//
// 覆盖策略（复盘 P0 的明确要求）：「高风险组合全覆盖 + 其余 pairwise」，**禁止全笛卡尔展开**。
// 高风险族的判据是「缺陷历史上在这里出现过，或这里的 DOM 回写风险最高」；族清单一处定义
// （`HIGH_RISK_FAMILIES`），矩阵由它 + pairwise 行取并集，覆盖契约再反向核对没有漏格。
//
// 不可行组合（N/A）MUST 带理由：无合同条款 / 合成通道无法忠实驱动。两类都写进
// `NOT_APPLICABLE`，覆盖契约逐条断言「理由非空」——静默丢弃等于把缺口藏起来。

import type { EditAction, EditActionKind, EditContext, EditState, SelectionShape } from "./editing-oracle-model.ts";

export const STATES: readonly EditState[] = ["idle", "composing", "settling", "readOnly"];
export const SELECTIONS: readonly SelectionShape[] = ["collapsed", "range"];
export const CONTEXTS: readonly EditContext[] = ["plain", "inline-replace", "block-replace", "list-marker", "table-cell"];
export const ACTIONS: readonly EditActionKind[] = ["type", "deleteBackward", "deleteForward", "enter", "paste", "pointer"];

/** 键入 / 粘贴的载荷：纯 ASCII，不会被 paste-url / paste-image 的专用链路改写。 */
export const TYPE_TEXT = "Q";
export const PASTE_TEXT = "Paste";
/** 组合提交 case 的 marked 文本（单字，位置算术保持一位偏移）。 */
export const COMMITTED_TEXT = "候";

/** 一个上下文 fixture：文档 + 每个动作的源码位置 + 装饰在场判据。
 *
 *  位置全部由 `indexOf` 从文档算出，不写魔法数字——fixture 改字时位置自动跟随。
 *  `widget` = 动作前必须在场的 replace 装饰选择器（null = 对照组的纯文本上下文）。 */
export interface ContextFixture {
  name: string;
  context: EditContext;
  doc: string;
  /** 键入 / 粘贴的折叠 caret（内容位）。 */
  typeAt: number;
  /** 行首：Backspace 吸收前一行（L7 跨行合并）。 */
  lineStartAt: number;
  /** 行尾：forward Delete 吸收下一行（L7），或 Enter 续行。 */
  lineEndAt: number;
  /** 指针动作点击的源码位置（null = 该上下文不做指针格）。 */
  pointerAt: number | null;
  /** 非空选区（起点 / 终点都落在隐藏源码区或跨行）。 */
  range: { anchor: number; head: number };
  /** 动作前必须出现的装饰；null = 对照组（目标行不得出现任何 replace 装饰）。 */
  widget: string | null;
  /** 装饰最小数量（按目标行内计数；块级 replace 例外，见执行层）。 */
  widgetMin: number;
  /** 该 fixture 的块级 replace 装饰是整块替换（不在 `.cm-line` 内）。 */
  blockWidget?: boolean;
  /** 目标行（1 基）。 */
  targetLine: number;
}

function at(doc: string, needle: string, offset = 0): number {
  const index = doc.indexOf(needle);
  if (index < 0) throw new Error(`fixture 缺少片段 ${JSON.stringify(needle)}`);
  return index + offset;
}

const PLAIN_DOC = "alpha beta\ngamma delta\n";
const INLINE_DOC = "alpha\nb [[target-note]] c\ntail\n";
const BLOCK_DOC = "alpha\n$$\nx+y\n$$\ntail\n";
const LIST_DOC = "intro\n1. item\n2. second\n";
const TABLE_DOC = "| a | b |\n| --- | --- |\n| c | d |\n";

export const FIXTURES: Record<EditContext, ContextFixture> = {
  plain: {
    name: "plain",
    context: "plain",
    doc: PLAIN_DOC,
    typeAt: at(PLAIN_DOC, "beta") - 1,
    lineStartAt: at(PLAIN_DOC, "gamma"),
    lineEndAt: at(PLAIN_DOC, "\n") ,
    pointerAt: at(PLAIN_DOC, "lph"),
    range: { anchor: at(PLAIN_DOC, "pha"), head: at(PLAIN_DOC, "pha") + 4 },
    widget: null,
    widgetMin: 0,
    targetLine: 1,
  },
  "inline-replace": {
    name: "inline-replace",
    context: "inline-replace",
    doc: INLINE_DOC,
    typeAt: at(INLINE_DOC, "target-note") + 2,
    lineStartAt: at(INLINE_DOC, "tail"),
    lineEndAt: at(INLINE_DOC, " c\n") + 2,
    pointerAt: at(INLINE_DOC, "target-note") + 2,
    // 起点在 `[[` 之前、终点在 `]]` 之后：整条隐藏区间跨在选区里（M854 的现场形态）。
    range: { anchor: at(INLINE_DOC, "[["), head: at(INLINE_DOC, "]]") + 2 },
    widget: ".cm-lp-wikilink",
    widgetMin: 1,
    targetLine: 2,
  },
  "block-replace": {
    name: "block-replace",
    context: "block-replace",
    doc: BLOCK_DOC,
    typeAt: at(BLOCK_DOC, "lph"),
    lineStartAt: at(BLOCK_DOC, "tail"),
    lineEndAt: at(BLOCK_DOC, "\n"),
    pointerAt: at(BLOCK_DOC, "x+y") + 1,
    // 整块（含两端的 `$$` 与中间换行）都在选区里。
    range: { anchor: at(BLOCK_DOC, "$$"), head: at(BLOCK_DOC, "$$\ntail") + 2 },
    widget: ".cm-lp-math-block",
    widgetMin: 1,
    blockWidget: true,
    targetLine: 1,
  },
  "list-marker": {
    name: "list-marker",
    context: "list-marker",
    doc: LIST_DOC,
    typeAt: at(LIST_DOC, "item"),
    lineStartAt: at(LIST_DOC, "2. second"),
    lineEndAt: at(LIST_DOC, "item") + 4,
    pointerAt: null,
    // 起点在 marker 前、终点落在下一项 marker 的数字内部（M854 的「端点落在 marker 里」）。
    range: { anchor: at(LIST_DOC, "1. item"), head: at(LIST_DOC, "2. second") + 1 },
    widget: ".cm-lp-list-marker",
    widgetMin: 1,
    targetLine: 2,
  },
  "table-cell": {
    name: "table-cell",
    context: "table-cell",
    doc: TABLE_DOC,
    // 内容右缘（`c` 之后、尾部对齐空白之前）；M855 的键入现场。
    typeAt: at(TABLE_DOC, "| c | d |") + 3,
    // 内容左缘（`c` 之前的对齐空白之后）：Backspace 只删这一个源空白。
    lineStartAt: at(TABLE_DOC, "| c | d |") + 2,
    lineEndAt: at(TABLE_DOC, "| c | d |") + 3,
    pointerAt: at(TABLE_DOC, "| c | d |") + 2,
    // `c` + 空格 + 隐藏管道 + 空格：跨 cell 的选区（M855 的键入替换现场）。
    range: { anchor: at(TABLE_DOC, "| c | d |") + 2, head: at(TABLE_DOC, "| c | d |") + 6 },
    widget: ".cm-lp-table-cell",
    widgetMin: 1,
    targetLine: 3,
  },
};

/** 每个动作在 fixture 里用的折叠 caret / 选区。 */
export function positionFor(fixture: ContextFixture, action: EditActionKind): { caret: number } | { anchor: number; head: number } {
  switch (action) {
    case "deleteBackward":
      return { caret: fixture.lineStartAt };
    case "deleteForward":
      return { caret: fixture.lineEndAt };
    case "enter":
      return { caret: fixture.lineEndAt };
    case "pointer":
      if (fixture.pointerAt === null) throw new Error(`${fixture.context}: 指针位置未声明`);
      // 指针动作的 setup 用中性 caret：动作前 context 的装饰必须仍在场（点击目标本身会 reveal 它）。
      return { caret: 0 };
    case "type":
    case "paste":
      return { caret: fixture.typeAt };
  }
}

export function actionFor(kind: EditActionKind): EditAction {
  switch (kind) {
    case "type":
      return { kind, text: TYPE_TEXT };
    case "paste":
      return { kind, text: PASTE_TEXT };
    case "pointer":
      return { kind };
    default:
      return { kind };
  }
}

/** 一格的动作前 setup：选区 + 是否先建立组合。 */
export interface MatrixSetup {
  /** 动作前的初始选区（组合起点也取它）。 */
  selection: { caret: number } | { anchor: number; head: number };
  /** 先建立组合（marked 文本）；`end: true` 表示组合已结束（settling 窗口）。 */
  composition?: { marked: string; end: boolean };
  /** 组合结束**之后**再设置的选区：settling + range 的真实序列是「组合结束 → 用户选一段 →
   *  在结算回调之前动手」，组合开始时选区必为折叠（IME 会替换选区）。 */
  finalSelection?: { anchor: number; head: number };
}

export interface MatrixCase {
  setup: MatrixSetup;
  action: EditAction;
  /** 执行层是否断言 beforeinput 被 preventDefault（闸门接管）；null = 不判。 */
  consumed: boolean | null;
  /** 该 case 的现场说明（失败读数里能看到是哪种缺陷形态）。 */
  note: string;
}

export interface MatrixCell {
  id: string;
  state: EditState;
  selection: SelectionShape;
  context: EditContext;
  action: EditActionKind;
  /** 高风险族名；null = 只由 pairwise 覆盖。 */
  highRisk: string | null;
  /** 合同条款（这个组合为什么值得测）。 */
  clause: string;
  cases: MatrixCase[];
}

const CONTEXT_CLAUSES: Record<EditContext, string> = {
  plain: "通用编辑（`editor-live-preview`「Enter 换行与自动缩进」/「折叠光标的字素步长前删」）",
  "inline-replace": "M836 / L7 跨 replace 装饰的跨行删除；M854 跨渲染隐藏区的非空选区编辑",
  "block-replace": "M836 块级 replace 的跨行合并；M854 块级 replace 上的选区编辑；C2 指针入口",
  "list-marker": "L6 / L7 列表 marker；M860 字素前删；Enter 续行与空项退出",
  "table-cell": "M855 表格 cell 内的原生键入与单字符删除；C2 指针落点",
};

/** 一格为什么值得测：状态 / 选区优先于上下文（同一上下文在不同态下的合同边不同）。 */
function clauseFor(key: CellKey): string {
  switch (key.state) {
    case "readOnly":
      return "只读会话 MUST NOT 产生文档变更（四段 requirement 的共同边界）";
    case "settling":
      return "组合结算窗口内动作仍按 state 判据落点，结算回调不改源码";
    case "composing":
      return "L6 组合中删除只吃 marked 区；起点再删不改文档";
    default:
      return key.selection === "range"
        ? "M854 非空选区统一事务（删除 / 键入替换）"
        : CONTEXT_CLAUSES[key.context];
  }
}

/** 高风险族：逐个取值展开（不是 pairwise）。 */
export interface HighRiskFamily {
  name: string;
  why: string;
  cells: Array<{ state: EditState; selection: SelectionShape; context: EditContext; action: EditActionKind }>;
}

export const HIGH_RISK_FAMILIES: readonly HighRiskFamily[] = [
  {
    name: "M854-selection-hidden-range",
    why: "非空选区端点落在隐藏源码区 / 跨 widget：DOM 回写会摧毁表格、吞 marker、把渲染文本写进源码",
    cells: (["type", "deleteBackward", "deleteForward", "paste"] as const).flatMap((action) =>
      (["inline-replace", "block-replace", "list-marker", "table-cell"] as const)
        .filter((context) => !(action === "paste" && context === "table-cell"))
        .map((context) => ({ state: "idle" as const, selection: "range" as const, context, action })),
    ),
  },
  {
    name: "M836-line-boundary-merge",
    why: "折叠光标在 replace 装饰的边界上合并两行：被吸收行的 widget 会被摊平成显示字形",
    cells: (["deleteBackward", "deleteForward"] as const).flatMap((action) =>
      (["inline-replace", "block-replace", "list-marker"] as const).map((context) => ({
        state: "idle" as const,
        selection: "collapsed" as const,
        context,
        action,
      })),
    ),
  },
  {
    name: "M855-table-cell-native",
    why: "表格 cell 内的原生键入 / 单字符删除：跨隐藏管道、吃对齐空白",
    cells: (["type", "deleteBackward", "deleteForward"] as const).map((action) => ({
      state: "idle" as const,
      selection: "collapsed" as const,
      context: "table-cell" as const,
      action,
    })),
  },
  {
    name: "L6-composition-delete",
    why: "组合中 Backspace 越过 marked 区 / 起点再删改了文档",
    cells: [{ state: "composing", selection: "collapsed", context: "list-marker", action: "deleteBackward" }],
  },
  {
    name: "settling-window",
    why: "组合结算回调未跑完时的编辑：闸门仍应按 state 接管，结算不得回写源码",
    cells: [
      ...(["plain", "inline-replace", "block-replace", "list-marker", "table-cell"] as const).map((context) => ({
        state: "settling" as const,
        selection: "collapsed" as const,
        context,
        action: "deleteBackward" as const,
      })),
      ...(["inline-replace", "block-replace", "list-marker"] as const).map((context) => ({
        state: "settling" as const,
        selection: "collapsed" as const,
        context,
        action: "deleteForward" as const,
      })),
      { state: "settling", selection: "collapsed", context: "table-cell", action: "type" },
      { state: "settling", selection: "range", context: "inline-replace", action: "type" },
      { state: "settling", selection: "range", context: "table-cell", action: "type" },
      { state: "settling", selection: "range", context: "list-marker", action: "type" },
    ],
  },
  {
    name: "readonly-noop",
    why: "只读会话的全部编辑动作必须空转（视图层拒收 + changeFilter 兜底）",
    cells: [
      // 只读 no-op 是全局的：表格 Enter / 折叠粘贴的「无条款」只针对可编辑态
      // （N/A 规则按状态集合收窄），因此这里**不按上下文过滤**，6 个动作 × 2 个上下文逐格在场。
      ...(["type", "deleteBackward", "deleteForward", "enter", "paste", "pointer"] as const).flatMap((action) =>
        (["plain", "table-cell"] as const).map((context) => ({
          state: "readOnly" as const,
          selection: "collapsed" as const,
          context,
          action,
        })),
      ),
      // 非空选区的三个对称动作：键入替换与两个方向的删除（只读同样必须空转）。
      ...(["type", "deleteBackward", "deleteForward"] as const).flatMap((action) =>
        (["plain", "table-cell"] as const).map((context) => ({
          state: "readOnly" as const,
          selection: "range" as const,
          context,
          action,
        })),
      ),
    ],
  },
];

/** 不可行组合及理由。`*` 表示该维任意取值。 */
export interface NotApplicable {
  /** `"*"` = 任意态；数组 = 只命中这些态（例如「无条款」只针对可编辑态，不得吞掉只读 no-op）。 */
  state: EditState | "*" | readonly EditState[];
  selection: SelectionShape | "*";
  context: EditContext | "*";
  action: EditActionKind | "*";
  reason: string;
}

export const NOT_APPLICABLE: readonly NotApplicable[] = [
  // --- 合同缺口：没有条款覆盖的组合（MUST 上报，不得静默当作通过） ---
  {
    state: ["idle", "settling", "composing"],
    selection: "collapsed",
    context: "table-cell",
    action: "enter",
    reason: "无合同条款；2026-11-27 probe 实测 Enter 会拆散 grid 表格（`| \\nd |`），属产品缺陷候选，见完工报告——本矩阵不把它固化成期望",
  },
  {
    state: ["idle", "settling", "composing"],
    selection: "collapsed",
    context: "table-cell",
    action: "paste",
    reason: "无合同条款：粘贴被 M854 闸门显式排除（语义交回原生），表格 cell 的粘贴结果未定义",
  },
  {
    state: ["idle", "settling", "composing"],
    selection: "collapsed",
    context: "block-replace",
    action: "paste",
    reason: "无合同条款：块级 replace 上的折叠粘贴未定义（选区粘贴归 M854，已覆盖）",
  },
  {
    state: "*",
    selection: "*",
    context: "inline-replace",
    action: "pointer",
    reason: "单击行内 replace widget 的落点由 widget 几何给出（渲染面坐标 → 源码边界的映射），落点判据归 C6 的专项场景；本矩阵不重复几何断言，只保留 plain / table-cell 的纯文本指针格",
  },
  {
    state: "*",
    selection: "*",
    context: "block-replace",
    action: "pointer",
    reason: "块级 replace 的指针入口（C2：显露 + 落点源行）由 C2 的专项场景覆盖；本矩阵不重复几何断言",
  },
  {
    state: "*",
    selection: "*",
    context: "list-marker",
    action: "pointer",
    reason: "C2 只规定块级 replace 的指针入口；marker widget 的点击落点归手感，无机器条款（实测点击 marker widget 不改变选区）",
  },
  // --- 合成通道无法忠实驱动（不是合同缺口） ---
  {
    state: "composing",
    selection: "*",
    context: "*",
    action: "type",
    reason: "组合文本更新由 IME 直接写 DOM，合成通道只能复刻适配器自身，判不了生产",
  },
  {
    state: "composing",
    selection: "*",
    context: "*",
    action: "enter",
    reason: "候选确认的 Enter 在真实 IME 里由 IME 持有；合成 CompositionEvent 不产生 `composing > 0`，CM 不会忽略 keydown",
  },
  {
    state: "composing",
    selection: "*",
    context: "*",
    action: "deleteForward",
    reason: "组合中 forward Delete 无生产接管（闸门只收 Backspace），且合成通道无法复现原生 IME 删除",
  },
  {
    state: "composing",
    selection: "*",
    context: "*",
    action: "paste",
    reason: "真实 IME 组合期不投递 paste；合成事件是测试自造路径",
  },
  {
    state: "composing",
    selection: "*",
    context: "*",
    action: "pointer",
    reason: "指针按下会结束组合（引擎行为），合成通道无法确定复现",
  },
  {
    state: "composing",
    selection: "*",
    context: "plain",
    action: "deleteBackward",
    reason: "普通段落的组合删除交回原生 IME（P2-1），合成通道没有「原生 IME」可交回",
  },
  {
    state: "composing",
    selection: "*",
    context: "table-cell",
    action: "deleteBackward",
    reason: "表格 cell 的组合删除同交回原生 IME（L6 的收窄），合成通道判不了",
  },
  {
    state: "composing",
    selection: "*",
    context: "inline-replace",
    action: "deleteBackward",
    reason: "行内 replace 上的组合删除同交回原生 IME（L6 的收窄），合成通道判不了",
  },
  {
    state: "composing",
    selection: "*",
    context: "block-replace",
    action: "deleteBackward",
    reason: "块级 replace 上的组合删除同交回原生 IME（L6 的收窄），合成通道判不了",
  },
  {
    state: "composing",
    selection: "range",
    context: "*",
    action: "*",
    reason: "组合起点必为折叠 caret（IME 组合替换选区的语义不在 L6 内），range 维对 composing 不成立",
  },
  {
    state: "settling",
    selection: "*",
    context: "*",
    action: "pointer",
    reason: "指针动作是异步的（Playwright 鼠标），会跑出 settle 定时器窗口，测到的其实是 idle",
  },
  {
    state: "settling",
    selection: "collapsed",
    context: "plain",
    action: "type",
    reason: "折叠 caret 的纯文本键入不经过 beforeinput 闸门，合成事件不会产生编辑；真键盘又跑出窗口",
  },
  {
    state: "settling",
    selection: "collapsed",
    context: "inline-replace",
    action: "type",
    reason: "同上：行内替换之外的折叠键入不经过闸门，窗口内无法同步驱动",
  },
  {
    state: "settling",
    selection: "collapsed",
    context: "block-replace",
    action: "type",
    reason: "同上：折叠键入不经过闸门，窗口内无法同步驱动",
  },
  {
    state: "settling",
    selection: "collapsed",
    context: "list-marker",
    action: "type",
    reason: "同上：折叠键入不经过闸门，窗口内无法同步驱动",
  },
  {
    state: "settling",
    selection: "collapsed",
    context: "table-cell",
    action: "enter",
    reason: "表格 cell 的 Enter 本就没有合同条款（见上），settling 不改这一点",
  },
  {
    state: "settling",
    selection: "collapsed",
    context: "block-replace",
    action: "enter",
    reason: "settling 窗口内 Enter 只能合成 keydown；块级公式旁的新行会先显露源码，落点无独立条款，按 idle 已覆盖",
  },
  {
    state: "readOnly",
    selection: "*",
    context: "inline-replace",
    action: "*",
    reason: "只读会话的拒收是全局的（readOnly + contenteditable=false），与上下文无关；plain / table-cell 已覆盖",
  },
  {
    state: "readOnly",
    selection: "*",
    context: "block-replace",
    action: "*",
    reason: "同上：只读拒收与上下文无关",
  },
  {
    state: "readOnly",
    selection: "*",
    context: "list-marker",
    action: "*",
    reason: "同上：只读拒收与上下文无关",
  },
];

function matches(rule: NotApplicable, state: EditState, selection: SelectionShape, context: EditContext, action: EditActionKind): boolean {
  const stateHit =
    rule.state === "*" || (Array.isArray(rule.state) ? rule.state.includes(state) : rule.state === state);
  return (
    stateHit &&
    (rule.selection === "*" || rule.selection === selection) &&
    (rule.context === "*" || rule.context === context) &&
    (rule.action === "*" || rule.action === action)
  );
}

export function notApplicableReason(
  state: EditState,
  selection: SelectionShape,
  context: EditContext,
  action: EditActionKind,
): string | null {
  return NOT_APPLICABLE.find((rule) => matches(rule, state, selection, context, action))?.reason ?? null;
}

export interface CellKey {
  state: EditState;
  selection: SelectionShape;
  context: EditContext;
  action: EditActionKind;
}

export function cellId(key: CellKey): string {
  return `${key.state}/${key.selection}/${key.context}/${key.action}`;
}

/** pairwise 的「可行对」：同一维取值对的全部可行组合。 */
function pairKeys(key: CellKey): string[] {
  const values: Array<[string, string]> = [
    ["state", key.state],
    ["selection", key.selection],
    ["context", key.context],
    ["action", key.action],
  ];
  const pairs: string[] = [];
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      pairs.push(`${values[i][0]}=${values[i][1]}|${values[j][0]}=${values[j][1]}`);
    }
  }
  return pairs;
}

/** 全部可行元组（四维乘积减 N/A）。 */
export function feasibleTuples(): CellKey[] {
  const tuples: CellKey[] = [];
  for (const state of STATES) {
    for (const selection of SELECTIONS) {
      for (const context of CONTEXTS) {
        for (const action of ACTIONS) {
          if (notApplicableReason(state, selection, context, action) === null) {
            tuples.push({ state, selection, context, action });
          }
        }
      }
    }
  }
  return tuples;
}

/** 贪心 pairwise：每轮选覆盖未覆盖对最多的可行元组。输入 ≤ 240 个元组，无需更聪明的算法。 */
export function pairwiseTuples(): CellKey[] {
  const tuples = feasibleTuples();
  const pairsOf = new Map<string, string[]>();
  const uncovered = new Set<string>();
  for (const tuple of tuples) {
    const pairs = pairKeys(tuple);
    pairsOf.set(cellId(tuple), pairs);
    for (const pair of pairs) uncovered.add(pair);
  }
  const chosen: CellKey[] = [];
  while (uncovered.size > 0) {
    let best: CellKey | null = null;
    let bestGain = -1;
    for (const tuple of tuples) {
      let gain = 0;
      for (const pair of pairsOf.get(cellId(tuple))!) if (uncovered.has(pair)) gain += 1;
      if (gain > bestGain) {
        best = tuple;
        bestGain = gain;
      }
    }
    if (best === null || bestGain <= 0) break;
    chosen.push(best);
    for (const pair of pairsOf.get(cellId(best))!) uncovered.delete(pair);
  }
  return chosen;
}

/** 给一格生成 cases（动作前的 setup + 动作 + 是否断言闸门消费）。 */
function caretOf(position: MatrixSetup["selection"]): number {
  return "caret" in position ? position.caret : position.anchor;
}

function casesFor(key: CellKey): MatrixCase[] {
  const fixture = FIXTURES[key.context];
  const position = key.selection === "range" ? fixture.range : positionFor(fixture, key.action);
  const action: EditAction =
    key.action === "pointer" ? { kind: "pointer", at: fixture.pointerAt ?? caretOf(position) } : actionFor(key.action);
  // 折叠 caret 的删除都经过 beforeinput 闸门（M860 / L7 / M855）；选区删除 / 选区键入归 M854；
  // 表格 cell 的折叠键入归 M855。其余动作（Enter / 粘贴 / 指针 / 行内折叠键入）不经过闸门。
  let gateHandled: boolean | null = null;
  if ((key.action === "deleteBackward" || key.action === "deleteForward") && key.selection === "collapsed") {
    gateHandled = true;
  }
  if (key.action === "type" && (key.selection === "range" || key.context === "table-cell")) {
    gateHandled = true;
  }

  switch (key.state) {
    case "idle":
      return [{ setup: { selection: position }, action, consumed: gateHandled, note: "idle 基准格" }];
    case "readOnly":
      return [
        {
          setup: { selection: position },
          action,
          consumed: key.action === "pointer" ? null : false,
          note: "只读会话：全部动作必须空转",
        },
      ];
    case "composing": {
      // 组合起点取列表内容起点（L6 的接管面：`listContentStartAt`），不是跨行合并的 lineStartAt。
      // 两个 case：marked 非空（只吃 marked 区）+ marked 已空（起点再删不改文档）。
      const start = fixture.typeAt;
      return [
        {
          setup: { selection: { caret: start }, composition: { marked: "候", end: false } },
          action,
          consumed: true,
          note: "组合中 marked 非空：只删 marked 区最后一个字素",
        },
        {
          setup: { selection: { caret: start }, composition: { marked: "", end: false } },
          action,
          consumed: true,
          note: "组合起点 marked 已空：消费事件但 MUST NOT 改文档",
        },
      ];
    }
    case "settling": {
      // 组合本身不带文本（compositionstart → compositionend），文档保持 fixture 原样；
      // 要测的是「结算回调未跑完」这个窗口，不是组合文本。range 格的真实序列是
      // 「组合结束 → 用户选一段 → 结算之前动手」，选区因此由 finalSelection 在组合之后落。
      const range = key.selection === "range";
      const cases: MatrixCase[] = [
        {
          setup: {
            selection: range ? { caret: fixture.typeAt } : position,
            composition: { marked: "", end: true },
            ...(range ? { finalSelection: fixture.range } : {}),
          },
          action,
          consumed: gateHandled,
          note: "compositionend 之后、结算回调之前（同一同步拍内动作）",
        },
      ];
      if (key.action === "type") {
        // 高风险族④「组合的删除与提交」的**提交**半边：组合里真有 marked 文本（`候`），
        // 提交后文档多一个字，再在提交 caret 上键入。源码 / 选区 / 保存载荷都判；
        // 组合自身的历史粒度仍按诚实边界给 steps:null（见模型与 N/A 表），不冒充撤销已验。
        const at = fixture.typeAt;
        const shift = (pos: number): number => (pos >= at ? pos + COMMITTED_TEXT.length : pos);
        const finalSelection = range
          ? { anchor: shift(fixture.range.anchor), head: shift(fixture.range.head) }
          : { anchor: at + COMMITTED_TEXT.length, head: at + COMMITTED_TEXT.length };
        cases.push({
          setup: {
            selection: { caret: at },
            composition: { marked: COMMITTED_TEXT, end: true },
            finalSelection,
          },
          action,
          consumed: gateHandled,
          note: `有内容的组合提交（marked=${JSON.stringify(COMMITTED_TEXT)}）之后键入：组合历史不判（steps:null）`,
        });
      }
      return cases;
    }
  }
}

export interface MatrixReport {
  cells: MatrixCell[];
  /** 四维全乘积（含 N/A）——「非全笛卡尔」的比较分母。 */
  fullProduct: number;
  feasible: number;
  highRiskCells: number;
  pairwiseCells: number;
  pairsTotal: number;
  pairsCovered: number;
  naRules: number;
}

export function buildMatrix(): MatrixReport {
  const cells = new Map<string, MatrixCell>();
  const add = (key: CellKey, highRisk: string | null): void => {
    const id = cellId(key);
    const existing = cells.get(id);
    if (existing !== undefined) {
      if (highRisk !== null && existing.highRisk === null) existing.highRisk = highRisk;
      return;
    }
    cells.set(id, {
      id,
      ...key,
      highRisk,
      clause: clauseFor(key),
      cases: casesFor(key),
    });
  };
  for (const family of HIGH_RISK_FAMILIES) {
    for (const cell of family.cells) {
      if (notApplicableReason(cell.state, cell.selection, cell.context, cell.action) !== null) {
        throw new Error(`高风险族 ${family.name} 声明了不可行格：${cellId(cell)}`);
      }
      add(cell, family.name);
    }
  }
  const pairwise = pairwiseTuples();
  for (const key of pairwise) add(key, null);

  const tuples = feasibleTuples();
  const allPairs = new Set<string>();
  for (const tuple of tuples) for (const pair of pairKeys(tuple)) allPairs.add(pair);
  const covered = new Set<string>();
  for (const cell of cells.values()) for (const pair of pairKeys(cell)) covered.add(pair);

  return {
    cells: [...cells.values()].sort((a, b) => a.id.localeCompare(b.id)),
    fullProduct: STATES.length * SELECTIONS.length * CONTEXTS.length * ACTIONS.length,
    feasible: tuples.length,
    highRiskCells: [...cells.values()].filter((cell) => cell.highRisk !== null).length,
    pairwiseCells: pairwise.length,
    pairsTotal: allPairs.size,
    pairsCovered: covered.size,
    naRules: NOT_APPLICABLE.length,
  };
}

/** 机器可读的覆盖读数（`LUMIR_TRANSITION_MATRIX_REPORT=1` 时由测试打印）。 */
export function formatMatrixReport(report: MatrixReport): string {
  const lines = [
    `TRANSITION MATRIX cells=${report.cells.length} high-risk=${report.highRiskCells} pairwise-rows=${report.pairwiseCells}`,
    `TRANSITION MATRIX dims states=${STATES.length} selections=${SELECTIONS.length} contexts=${CONTEXTS.length} actions=${ACTIONS.length}`,
    `TRANSITION MATRIX full-product=${report.fullProduct} feasible=${report.feasible} na-rules=${report.naRules}`,
    `TRANSITION MATRIX pairs=${report.pairsCovered}/${report.pairsTotal}`,
    `TRANSITION MATRIX cases=${report.cells.reduce((sum, cell) => sum + cell.cases.length, 0)}`,
  ];
  for (const cell of report.cells) {
    lines.push(
      `  ${cell.id} cases=${cell.cases.length}${cell.highRisk === null ? "" : ` high-risk=${cell.highRisk}`}`,
    );
  }
  return lines.join("\n");
}
