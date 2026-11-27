// replace 装饰构造的责任登记与设计闸门（change register-replace-widget-contracts-nov27）。
//
// 合同居所：`docs/specs/replace-widget-contracts.md`；spec 增量：
// `openspec/changes/register-replace-widget-contracts-nov27/specs/editor-live-preview/spec.md`。
//
// 为什么是静态对账而不是给每个构造补行为用例：缺陷形态是「新增一个 replace 构造，显露 /
// 指针 / 原生编辑 / 几何 / IME 的责任没人回答」。逐构造行为用例只证明已知构造，抓不到
// 「下一个新构造」；把判据反过来（凡 `Decoration.replace` 必须先在注册表归位）才拦得住。
// 行为正确性仍由各条目 `tests` 字段指向的既有单测 / 视觉场景 / 验收场景承担。
//
// 机器定位：`(file, owner, widget 类 / null, inline|block, 同组出现序号)`。序号只在同一
// `(file, owner, widget, span)` 组内计数——同组内插入 / 删除 / 换序会让后续序号后移并判红，
// 这是「新构造进入准入面」的信号，刻意的准入成本。MUST NOT 改用行号：行号会随无关改动漂移。
//
// 扫描边界（如实登记）：只认直接调用 `Decoration.replace(...)`。别名（`const replace =
// Decoration.replace` / 解构 / 整体赋值 / import 重命名 / 字面量元素访问 `Decoration["replace"]`）
// 会让扫描失明，故由「单一实现」用例单独判红；`Decoration[method]` 这类计算动态属性访问与
// 第三方库内部构造不在本层判据内。`src/preview/**` 出现 `beforeinput` 同样判红
// ——原生编辑只允许有 `src/editor.ts` 的 `absorbNativeEdit` 这一份实现。

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcDir = path.join(root, "src");

// ---------------------------------------------------------------------------
// 类型与受控词表
// ---------------------------------------------------------------------------

type Span = "inline" | "block";
type RevealPolicy =
  | "always-rendered"
  | "selection-line"
  | "selection-line-inclusive"
  | "selection-range-inclusive"
  | "selection-node"
  | "selection-overlap";
type PointerPolicy =
  | "none"
  | "enter-source"
  | "follow-link"
  | "wikilink-source-or-restore"
  | "image-actions"
  | "image-or-notice";
type ReadonlyPolicy = "same-as-editable" | "restores-selection" | "not-consumed";
type ImePolicy = "native" | "shared-settle";

const REVEAL_POLICIES: ReadonlySet<RevealPolicy> = new Set([
  "always-rendered",
  "selection-line",
  "selection-line-inclusive",
  "selection-range-inclusive",
  "selection-node",
  "selection-overlap",
]);
const POINTER_POLICIES: ReadonlySet<PointerPolicy> = new Set([
  "none",
  "enter-source",
  "follow-link",
  "wikilink-source-or-restore",
  "image-actions",
  "image-or-notice",
]);
const READONLY_POLICIES: ReadonlySet<ReadonlyPolicy> = new Set([
  "same-as-editable",
  "restores-selection",
  "not-consumed",
]);
const IME_POLICIES: ReadonlySet<ImePolicy> = new Set(["native", "shared-settle"]);

interface Anchor {
  file: string;
  kind: "symbol" | "text";
  needle: string;
}

interface Responsibility<P extends string> {
  policy: P;
  anchors: Anchor[];
  note: string;
}

interface PointerReadonly extends Responsibility<PointerPolicy> {
  readonlyPolicy: ReadonlyPolicy;
}

interface RegistryEntry {
  id: string;
  file: string;
  owner: string;
  widget: string | null;
  span: Span;
  /** 同 `(file, owner, widget, span)` 组内的出现序号，从 1 开始。 */
  ordinal: number;
  reveal: Responsibility<RevealPolicy>;
  pointerReadonly: PointerReadonly;
  nativeEdit: Responsibility<"shared-gate">;
  geometry: { owner: string; anchors: Anchor[]; note: string };
  ime: Responsibility<ImePolicy>;
  tests: string[];
  note: string;
}

interface Site {
  file: string;
  owner: string;
  widget: string | null;
  span: Span;
  ordinal: number;
  line: number;
}

// ---------------------------------------------------------------------------
// 扫描器
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out.sort();
}

function rel(file: string): string {
  return path.relative(root, file).replaceAll("\\", "/");
}

const PARSED = new Map<string, ts.SourceFile>();
const TEXT = new Map<string, string>();

function textOf(file: string): string {
  let text = TEXT.get(file);
  if (text === undefined) {
    text = readFileSync(file, "utf8");
    TEXT.set(file, text);
  }
  return text;
}

/** 同一文件在本文件的多组判据里只解析 / 读取一次：扫描器 + 锚点 + 单一实现共用缓存，
 *  避免给同层的时间预算用例（如 link-suggest 的 16ms 同步预算）添无谓的并发负载。 */
function parse(file: string, text?: string): ts.SourceFile {
  if (text !== undefined) {
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  }
  const cached = PARSED.get(file);
  if (cached !== undefined) return cached;
  const source = ts.createSourceFile(file, textOf(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  PARSED.set(file, source);
  return source;
}

/** 对象字面量方法回调的通用名：它们不是「构造的归属函数」，真正的归属是外层命名函数。 */
const CALLBACK_NAMES = new Set([
  "enter",
  "update",
  "create",
  "read",
  "write",
  "dispatch",
  "destroy",
  "eq",
  "toDOM",
  "coordsAt",
  "compare",
  "render",
  "draw",
]);

/** 最近的非回调命名函数 / 方法；类方法带类名前缀（`ListLayout.build`）。 */
function ownerOf(node: ts.Node): string {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isMethodDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      !CALLBACK_NAMES.has(current.name.text)
    ) {
      const klass =
        ts.isClassDeclaration(current.parent) && current.parent.name
          ? `${current.parent.name.text}.`
          : "";
      return `${klass}${current.name.text}`;
    }
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.initializer &&
      (ts.isArrowFunction(current.initializer) || ts.isFunctionExpression(current.initializer))
    ) {
      return current.name.text;
    }
    if (
      ts.isPropertyAssignment(current) &&
      ts.isIdentifier(current.name) &&
      (ts.isArrowFunction(current.initializer) || ts.isFunctionExpression(current.initializer)) &&
      !CALLBACK_NAMES.has(current.name.text)
    ) {
      return current.name.text;
    }
    current = current.parent;
  }
  return "<top>";
}

function expressionName(expr: ts.Expression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.getText();
  return expr.getText().replace(/\s+/g, " ");
}

interface WidgetResolution {
  widget: string | null;
  problem?: string;
}

/** 只接受 `new X(...)` / 工厂调用；标识符、条件、成员访问等动态形式无法静态对账，必须判红。 */
function widgetOfInitializer(init: ts.Expression): WidgetResolution {
  if (ts.isNewExpression(init)) return { widget: expressionName(init.expression) };
  if (ts.isCallExpression(init)) return { widget: expressionName(init.expression) };
  return {
    widget: null,
    problem: "widget 初始值必须是 new X(...) 或工厂调用；标识符 / 条件等动态形式无法静态对账",
  };
}

/** `{ widget }` 简写：在同层（或外层）块里找最近一个在调用之前的 `const widget = ...`，
 *  其初始化式仍必须是 `new X(...)` / 工厂调用；找不到或初始化式动态同样判红。 */
function resolveShorthandWidget(call: ts.CallExpression): WidgetResolution {
  let scope: ts.Node | undefined = call.parent;
  while (scope) {
    if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
      for (const statement of scope.statements) {
        if (statement.getStart() >= call.getStart()) break;
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === "widget" &&
            declaration.initializer
          ) {
            return widgetOfInitializer(declaration.initializer);
          }
        }
      }
    }
    scope = scope.parent;
  }
  return {
    widget: null,
    problem: "widget 简写找不到同层 `const widget = ...` 初始化，无法静态对账",
  };
}

function isDecorationReplaceCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "replace" &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Decoration"
  );
}

function readCallShape(call: ts.CallExpression): {
  widget: string | null;
  span: Span;
  problems: string[];
} {
  const problems: string[] = [];
  let widget: string | null = null;
  let span: Span = "inline";
  const arg = call.arguments[0];
  if (call.arguments.length !== 1 || !arg || !ts.isObjectLiteralExpression(arg)) {
    problems.push(
      "Decoration.replace 必须恰好一个对象字面量参数；非对象 / 变量 / 多余参数无法静态对账",
    );
    return { widget, span, problems };
  }
  for (const prop of arg.properties) {
    if (ts.isSpreadAssignment(prop)) {
      problems.push("不支持展开属性（...spec）：widget / block 可能被静态扫描漏掉");
      continue;
    }
    if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) {
      problems.push("不支持方法 / 访问器 / 其他属性形态，widget / block 必须可静态对账");
      continue;
    }
    if (!ts.isIdentifier(prop.name)) {
      problems.push("不支持计算属性名：widget / block 必须写成静态标识符");
      continue;
    }
    if (prop.name.text === "widget") {
      if (ts.isShorthandPropertyAssignment(prop)) {
        const resolved = resolveShorthandWidget(call);
        if (resolved.widget === null) problems.push(resolved.problem ?? "widget 简写无法静态识别");
        else widget = resolved.widget;
      } else {
        const resolved = widgetOfInitializer(prop.initializer);
        if (resolved.widget === null) problems.push(resolved.problem ?? "widget 初始值无法静态识别");
        else widget = resolved.widget;
      }
    } else if (prop.name.text === "block") {
      if (ts.isShorthandPropertyAssignment(prop)) {
        problems.push("block 简写不是字面量 true / false，无法静态对账");
      } else if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) {
        span = "block";
      } else if (prop.initializer.kind !== ts.SyntaxKind.FalseKeyword) {
        problems.push("block 属性必须是字面量 true / false（动态值会让注册表无法对账）");
      }
    }
  }
  return { widget, span, problems };
}

function scanSourceFile(file: string, text?: string): { sites: Site[]; problems: string[] } {
  const source = parse(file, text);
  const raw: Omit<Site, "ordinal">[] = [];
  const problems: string[] = [];
  const visit = (node: ts.Node): void => {
    if (isDecorationReplaceCall(node)) {
      const shape = readCallShape(node);
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      for (const problem of shape.problems) problems.push(`${rel(file)}:${line} ${problem}`);
      raw.push({
        file: rel(file),
        owner: ownerOf(node),
        widget: shape.widget,
        span: shape.span,
        line,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  raw.sort((a, b) => a.line - b.line);
  const counters = new Map<string, number>();
  const sites = raw.map((site) => {
    const base = groupBase(site.file, site.owner, site.widget, site.span);
    const ordinal = (counters.get(base) ?? 0) + 1;
    counters.set(base, ordinal);
    return { ...site, ordinal };
  });
  return { sites, problems };
}

function groupBase(file: string, owner: string, widget: string | null, span: Span): string {
  return [file, owner, widget ?? "(hide)", span].join(" | ");
}

function siteKey(site: Pick<Site, "file" | "owner" | "widget" | "span" | "ordinal">): string {
  return `${groupBase(site.file, site.owner, site.widget, site.span)} | #${site.ordinal}`;
}

function scanSrc(): { sites: Site[]; problems: string[] } {
  const sites: Site[] = [];
  const problems: string[] = [];
  for (const file of sourceFiles(srcDir)) {
    // 只解析真的出现 `Decoration` 的文件：本层不要求每个 src 文件都过一遍 TS 解析器，
    // 同层的 link-suggest 16ms 同步预算用例对并发负载敏感，扫描器不应无谓抢 CPU。
    if (!textOf(file).includes("Decoration")) continue;
    const result = scanSourceFile(file);
    sites.push(...result.sites);
    problems.push(...result.problems);
  }
  return { sites: sites.sort((a, b) => siteKey(a).localeCompare(siteKey(b))), problems };
}

// ---------------------------------------------------------------------------
// 责任字段的锚点
// ---------------------------------------------------------------------------

const symbol = (file: string, needle: string): Anchor => ({ file, kind: "symbol", needle });
const text = (file: string, needle: string): Anchor => ({ file, kind: "text", needle });

const A = {
  nativeEdit: symbol("src/editor.ts", "absorbNativeEdit"),
  compositionStarted: symbol("src/editor.ts", "compositionStarted"),
  settle: symbol("src/composition-settle.ts", "scheduleCompositionSettle"),
  listSettled: symbol("src/preview/lists.ts", "compositionSettled"),
  touchesSource: symbol("src/preview/reveal-gate.ts", "touchesSource"),
  rangeReveals: symbol("src/preview/reveal-gate.ts", "rangeRevealsSource"),
  lineTouches: symbol("src/preview/lists.ts", "lineTouchesSelection"),
  enterSource: symbol("src/preview/replaced-source.ts", "enterReplacedSource"),
  followLink: symbol("src/link-follow.ts", "followLink"),
  tableWrappers: symbol("src/preview/livePreview.ts", "tableWrappers"),
  listLineRender: symbol("src/preview/lists.ts", "listLineRender"),
  blockGeometry: symbol("src/preview/block-geometry.ts", "lineShapes"),
  imageReserve: symbol("src/preview/attachments.ts", "imageReserve"),
  knownGeometry: symbol("src/preview/attachments.ts", "knownGeometry"),
  imageQuote: symbol("src/preview/attachments.ts", "imageQuoteButtonPlacement"),
  emptyCellWidget: symbol("src/preview/livePreview.ts", "EmptyTableCellWidget"),
  attachmentNotice: symbol("src/preview/attachments.ts", "AttachmentNoticeWidget"),
  imageWidget: symbol("src/preview/attachments.ts", "ImageWidget"),
  listMarker: symbol("src/preview/lists.ts", "ListMarker"),
  sourceShield: symbol("src/preview/lists.ts", "SourceShield"),
  collectTable: symbol("src/preview/livePreview.ts", "collectTableDecorations"),
  collectSyntax: symbol("src/preview/livePreview.ts", "collectSyntaxDecorations"),
  hideMark: symbol("src/preview/livePreview.ts", "hideMark"),
  buildStandardImage: symbol("src/preview/livePreview.ts", "buildStandardImage"),
  buildWikilink: symbol("src/preview/livePreview.ts", "buildWikilink"),
  wikilinkWidget: symbol("src/preview/livePreview.ts", "WikilinkWidget"),
  hrWidget: symbol("src/preview/livePreview.ts", "HorizontalRuleWidget"),
  frontmatterWidget: symbol("src/preview/frontmatter.ts", "FrontmatterWidget"),
  inlineMath: symbol("src/preview/math.ts", "InlineMathWidget"),
  mathSelection: text("src/preview/math.ts", "state.selection.ranges.some"),
  mermaidDiagram: symbol("src/preview/mermaid.ts", "isMermaidDiagram"),
  frontmatterOuter: text("src/preview/theme.ts", ".cm-lp-frontmatter-outer"),
  calloutType: text("src/preview/theme.ts", ".cm-lp-callout-type"),
  hrStyle: text("src/preview/theme.ts", ".cm-lp-hr"),
  wikilinkStyle: text("src/preview/theme.ts", ".cm-lp-wikilink"),
  noticeStyle: text("src/preview/theme.ts", ".cm-lp-embed-unsupported"),
  listMarkerStyle: text("src/preview/theme.ts", "--lp-list-marker"),
  listBodyStyle: text("src/preview/theme.ts", "--lp-list-body"),
  emptyCellStyle: text("src/style.css", ".cm-lp-table-cell-empty"),
  blockMathStyle: text("src/style.css", ".cm-lp-math-block"),
  mermaidStyle: text("src/style.css", ".cm-lp-mermaid"),
};

const SHARED_NATIVE_EDIT: Responsibility<"shared-gate"> = {
  policy: "shared-gate",
  anchors: [A.nativeEdit],
  note: "原生键入 / 删除只走 src/editor.ts 的 absorbNativeEdit（只读 EditorState）；构造不另写 beforeinput 或 DOM 回读",
};

const NATIVE_IME: Responsibility<ImePolicy> = {
  policy: "native",
  anchors: [A.compositionStarted],
  note: "组合期交编辑器的原生组合路径；本构造没有自有组合生命周期",
};

const SHARED_SETTLE: Responsibility<ImePolicy> = {
  policy: "shared-settle",
  anchors: [A.settle, A.listSettled],
  note: "组合结束经共享 composition-settle 等 pending MutationRecord 落净后再重建列表装饰",
};

function always(anchor: Anchor, note: string): Responsibility<RevealPolicy> {
  return { policy: "always-rendered", anchors: [anchor], note };
}

function revealLine(note: string): Responsibility<RevealPolicy> {
  return { policy: "selection-line", anchors: [A.touchesSource], note };
}

function revealLineInclusive(note: string): Responsibility<RevealPolicy> {
  return { policy: "selection-line-inclusive", anchors: [A.rangeReveals], note };
}

function revealListLine(note: string): Responsibility<RevealPolicy> {
  return { policy: "selection-line-inclusive", anchors: [A.lineTouches], note };
}

function revealRangeInclusive(note: string): Responsibility<RevealPolicy> {
  return { policy: "selection-range-inclusive", anchors: [A.rangeReveals], note };
}

function revealNode(note: string): Responsibility<RevealPolicy> {
  return { policy: "selection-node", anchors: [A.touchesSource], note };
}

function revealOverlap(anchor: Anchor, note: string): Responsibility<RevealPolicy> {
  return { policy: "selection-overlap", anchors: [anchor], note };
}

function noPointer(anchor: Anchor, note: string): PointerReadonly {
  return {
    policy: "none",
    readonlyPolicy: "not-consumed",
    anchors: [anchor],
    note: `${note}；只读会话下同样不消费`,
  };
}

function enterSource(): PointerReadonly {
  return {
    policy: "enter-source",
    readonlyPolicy: "same-as-editable",
    anchors: [A.enterSource],
    note: "点击 widget 经 enterReplacedSource 把光标送入源码并聚焦；只读会话只改选区、不改文档",
  };
}

function followLink(): PointerReadonly {
  return {
    policy: "follow-link",
    readonlyPolicy: "same-as-editable",
    anchors: [A.followLink],
    note: "点击链接文本走既有链接跟随；只读会话同样可跟随",
  };
}

function imageActions(): PointerReadonly {
  return {
    policy: "image-actions",
    readonlyPolicy: "same-as-editable",
    anchors: [A.imageQuote, text("src/preview/attachments.ts", "dblclick")],
    note: "双击终态 <img> 放大、引用钮摘录；只读会话同样可用，不改文档",
  };
}

function geometry(
  owner: string,
  anchors: Anchor[],
  note: string,
): { owner: string; anchors: Anchor[]; note: string } {
  return { owner, anchors, note };
}

// ---------------------------------------------------------------------------
// 注册表（本条的可执行居所；人读版本是 docs/specs/replace-widget-contracts.md）
//
// 每条 = 一个 replace 责任构造。`ordinal` 是同组出现序号；新增 / 删除 / 换序会让它漂移并
// 判红，要求在同一 change 内重新登记。
// ---------------------------------------------------------------------------

const REGISTRY: readonly RegistryEntry[] = [
  {
    id: "callout-label",
    file: "src/preview/callout.ts",
    owner: "calloutMarkerDecorations",
    widget: "CalloutLabelWidget",
    span: "inline",
    ordinal: 1,
    reveal: revealLine("callout 首行被选区严格重叠即显示 [!type] 源码；标记由 livePreview 的 Blockquote 分支按同一判据撤下"),
    pointerReadonly: noPointer(A.calloutType, "widget 不挂指针监听，点击交 CM 原生选区"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("theme.ts .cm-lp-callout-type", [A.calloutType], "类型标签是行内 flex 节点，行盒由 callout 行样式承担"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/callout.spec.ts", "tests/visual/scenes/m119-callout-source.spec.ts"],
    note: "callout 首行标记替换为类型标签",
  },
  {
    id: "list-marker-first",
    file: "src/preview/lists.ts",
    owner: "ListLayout.build",
    widget: "ListMarker",
    span: "inline",
    ordinal: 1,
    reveal: always(A.listLineRender, "真列表项首行恒按列表行渲染；源 marker 的隐藏不看选区（与裸 marker 的编辑态门控相反）"),
    pointerReadonly: noPointer(A.listMarker, "widget 不挂指针监听；水平移动的原子步由 listHiddenRangeAt 处理"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("lists.ts ListMarker.coordsAt / theme .cm-lp-list-marker", [A.listMarker, A.listMarkerStyle], "marker 宽度进 --lp-list-marker，纵向 coordsAt 对齐正文行盒"),
    ime: SHARED_SETTLE,
    tests: ["tests/unit/list-indent.test.ts", "tests/visual/scenes/lists.spec.ts"],
    note: "真列表项首行的 marker 渲染",
  },
  {
    id: "list-continuation-indent",
    file: "src/preview/lists.ts",
    owner: "ListLayout.build",
    widget: null,
    span: "inline",
    ordinal: 1,
    reveal: always(A.listLineRender, "真续行行首缩进恒隐藏；源码缩进由 listHiddenRangeAt 作为原子步跨过"),
    pointerReadonly: noPointer(A.listLineRender, "纯隐藏范围没有 widget / 监听"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("lists.ts 行样式 --lp-list-body", [A.listBodyStyle], "续行落点由行装饰的 --lp-list-body 悬挂缩进承担"),
    ime: SHARED_SETTLE,
    tests: ["tests/unit/list-lazy-continuation.test.ts", "scripts/acceptance/scenarios/120-list-lazy-continuation-indent.md"],
    note: "真续行行首的源码空白隐藏",
  },
  {
    id: "list-marker-bare",
    file: "src/preview/lists.ts",
    owner: "ListLayout.build",
    widget: "ListMarker",
    span: "inline",
    ordinal: 2,
    reveal: revealListLine("裸 marker 行只在编辑态（判据选区与该行相接，含端点）渲染 marker；离开即回字面文本"),
    pointerReadonly: noPointer(A.listMarker, "widget 不挂指针监听；在行首 / 行内点击由 lineTouchesSelection 进入编辑态"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("lists.ts ListMarker.coordsAt / --lp-list-marker", [A.listMarker, A.listMarkerStyle], "裸行按字面 marker 宽与前缀列算悬挂缩进"),
    ime: SHARED_SETTLE,
    tests: ["tests/unit/ordered-list-auto-mode.test.ts", "tests/visual/scenes/lists.spec.ts"],
    note: "裸 marker 行的列表编辑态 widget",
  },
  {
    id: "list-setext-shield",
    file: "src/preview/lists.ts",
    owner: "ListLayout.build",
    widget: "SourceShield",
    span: "inline",
    ordinal: 1,
    reveal: revealListLine("setext 候选行只在编辑态（行相接）把字面 `- ` 换成不可编辑原子节点；离开编辑态即撤下"),
    pointerReadonly: noPointer(A.sourceShield, "SourceShield 是 contenteditable=false 的原子节点，不挂指针监听"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("lists.ts SourceShield", [A.sourceShield], "屏蔽节点保持字面文本的 inline 几何，不另加行高"),
    ime: SHARED_SETTLE,
    tests: ["tests/unit/ordered-list-auto-mode.test.ts", "scripts/acceptance/scenarios/271-ime-list-composition-wkwebview.md"],
    note: "setext 候选的 `- ` 源码隔离",
  },
  {
    id: "frontmatter-block",
    file: "src/preview/livePreview.ts",
    owner: "frontmatterSet",
    widget: "FrontmatterWidget",
    span: "block",
    ordinal: 1,
    reveal: revealOverlap(A.touchesSource, "选区与 frontmatter 块严格重叠即撤下 widget 显示 YAML（touchesSource，按压期取快照）"),
    pointerReadonly: enterSource(),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("theme.ts .cm-lp-frontmatter-outer", [A.frontmatterOuter], "纵向 padding 由 outer 承载，CM 量 widget 高度"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/doc-title.spec.ts", "tests/unit/frontmatter-caret.test.ts"],
    note: "frontmatter 整块 properties 盒 + doc-title",
  },
  {
    id: "table-gap-start",
    file: "src/preview/livePreview.ts",
    owner: "collectTableDecorations",
    widget: null,
    span: "inline",
    ordinal: 1,
    reveal: always(A.tableWrappers, "矩形表恒以 grid 渲染；行首到首 cell 的间隙保持隐藏，cell 内容就地可编辑"),
    pointerReadonly: noPointer(A.collectTable, "纯隐藏间隙没有 widget / 监听"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("livePreview.ts tableWrappers", [A.tableWrappers], "grid 容器与列宽由 BlockWrapper + CSS grid 决定"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/m119-table-width.spec.ts", "tests/visual/scenes/table-foundation-v2.spec.ts"],
    note: "表格行首到首 cell 的结构间隙",
  },
  {
    id: "table-empty-cell",
    file: "src/preview/livePreview.ts",
    owner: "collectTableDecorations",
    widget: "EmptyTableCellWidget",
    span: "inline",
    ordinal: 1,
    reveal: always(A.tableWrappers, "空 cell 占位恒渲染；判据是 slot 内容 trim 为空，不看选区"),
    pointerReadonly: noPointer(A.emptyCellWidget, "占位 widget 不挂指针监听"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("style.css .cm-lp-table-cell-empty", [A.emptyCellStyle], "空 cell 占位按 grid-column 落在列上"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/m119-table-math.spec.ts", "tests/visual/scenes/table-foundation-v2.spec.ts"],
    note: "非零宽空 slot 的占位 cell",
  },
  {
    id: "table-gap-end",
    file: "src/preview/livePreview.ts",
    owner: "collectTableDecorations",
    widget: null,
    span: "inline",
    ordinal: 2,
    reveal: always(A.tableWrappers, "矩形表恒以 grid 渲染；末 cell 到行尾的间隙保持隐藏"),
    pointerReadonly: noPointer(A.collectTable, "纯隐藏间隙没有 widget / 监听"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("livePreview.ts tableWrappers", [A.tableWrappers], "grid 容器与列宽由 BlockWrapper + CSS grid 决定"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/m119-table-width.spec.ts", "tests/visual/scenes/table-foundation-v2.spec.ts"],
    note: "表格末 cell 到行尾的结构间隙",
  },
  {
    id: "table-separator-row",
    file: "src/preview/livePreview.ts",
    owner: "collectTableDecorations",
    widget: null,
    span: "inline",
    ordinal: 3,
    reveal: always(A.tableWrappers, "分隔行整行隐藏；表格恒以 grid 渲染，分隔行由行装饰表达"),
    pointerReadonly: noPointer(A.collectTable, "纯隐藏行没有 widget / 监听"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("livePreview.ts tableWrappers", [A.tableWrappers], "分隔行不占 grid 行高（行装饰不生成内容）"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/m119-table-width.spec.ts", "tests/visual/scenes/table-foundation-v2.spec.ts"],
    note: "表格分隔行整行隐藏",
  },
  {
    id: "quote-mark",
    file: "src/preview/livePreview.ts",
    owner: "hideMark",
    widget: null,
    span: "inline",
    ordinal: 1,
    reveal: revealLine("引用行被选区严格重叠即显示 `>`（QuoteMark 分支的 touchesSelection）"),
    pointerReadonly: noPointer(A.hideMark, "纯隐藏范围没有 widget / 监听"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("block-geometry.ts lineShapes", [A.blockGeometry], "引用行高由 block-geometry 的 lineShapes 写入"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/render-quote-list.spec.ts", "tests/unit/live-preview-reveal-gate.test.ts"],
    note: "引用续行 `>` 标记隐藏",
  },
  {
    id: "heading-marks",
    file: "src/preview/livePreview.ts",
    owner: "collectSyntaxDecorations",
    widget: null,
    span: "inline",
    ordinal: 1,
    reveal: revealLineInclusive("标题行被选区含端点相接即显示 `#`（整行判据，含缩进标题）"),
    pointerReadonly: noPointer(A.collectSyntax, "纯隐藏范围没有 widget / 监听"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("block-geometry.ts lineShapes", [A.blockGeometry], "标题层级行盒由 block-geometry 的 HEADING_TOP / BOTTOM 写入"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/m297-heading-caret-source.spec.ts", "tests/unit/syntax-envelope.test.ts"],
    note: "ATX 标题首尾 `#` 标记隐藏",
  },
  {
    id: "emphasis-marks",
    file: "src/preview/livePreview.ts",
    owner: "collectSyntaxDecorations",
    widget: null,
    span: "inline",
    ordinal: 2,
    reveal: revealRangeInclusive("强调范围被选区含端点相接即整段显示源码；callout 内容行另有行级显露（revealInlineSource）"),
    pointerReadonly: noPointer(A.collectSyntax, "纯隐藏定界符没有 widget / 监听"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("block-geometry.ts lineShapes", [A.blockGeometry], "行内标记不改变行盒；行高仍由 block-geometry 统一"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/m168-emphasis-caret-source.spec.ts", "tests/unit/syntax-envelope.test.ts"],
    note: "强调 / 删除线定界符隐藏",
  },
  {
    id: "horizontal-rule",
    file: "src/preview/livePreview.ts",
    owner: "collectSyntaxDecorations",
    widget: "HorizontalRuleWidget",
    span: "inline",
    ordinal: 1,
    reveal: revealLine("分隔线行被选区严格重叠即显示 `---` 源码"),
    pointerReadonly: noPointer(A.hrWidget, "widget 不挂指针监听；点击交 CM 原生选区"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("theme.ts .cm-lp-hr", [A.hrStyle], "横线本体 0 高 + border，垂直位置由行样式承担"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/render-hr.spec.ts", "tests/visual/scenes/m110-interaction.spec.ts"],
    note: "分隔线整行替换为 <hr>",
  },
  {
    id: "link-marks",
    file: "src/preview/livePreview.ts",
    owner: "collectSyntaxDecorations",
    widget: null,
    span: "inline",
    ordinal: 3,
    reveal: revealNode("标准链接范围被选区严格重叠即整条显示源码（touchesSelection，含 label 内强调）"),
    pointerReadonly: followLink(),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("block-geometry.ts lineShapes", [A.blockGeometry], "链接尾标与 label 都在行内，行盒仍由 block-geometry 统一"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/render-link.spec.ts", "tests/unit/literal-link.test.ts"],
    note: "标准链接 `](target)` 与尾标隐藏",
  },
  {
    id: "autolink-brackets",
    file: "src/preview/livePreview.ts",
    owner: "collectSyntaxDecorations",
    widget: null,
    span: "inline",
    ordinal: 4,
    reveal: revealNode("裸 URL / 角括号链接被选区严格重叠即显示原文；URL 本身从不隐藏，只有角括号可隐藏"),
    pointerReadonly: followLink(),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("block-geometry.ts lineShapes", [A.blockGeometry], "链接样式不改变行盒；行高仍由 block-geometry 统一"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/render-link.spec.ts", "tests/unit/literal-link.test.ts"],
    note: "角括号自动链接的两个尖括号隐藏",
  },
  {
    id: "image-remote",
    file: "src/preview/livePreview.ts",
    owner: "buildStandardImage",
    widget: "ImageWidget",
    span: "inline",
    ordinal: 1,
    reveal: always(A.buildStandardImage, "远程 http(s) 引用没有字节来源，恒走占位终态；不随选区显露源码"),
    pointerReadonly: noPointer(A.imageWidget, "远程占位没有 <img>，不挂放大 / 引用路径"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("attachments.ts knownGeometry / imageReserve", [A.knownGeometry, A.imageReserve], "图片几何按会话缓存预留终态尺寸"),
    ime: NATIVE_IME,
    tests: ["tests/unit/image-widget.test.ts", "tests/visual/scenes/m182-image-first-open-width.spec.ts"],
    note: "标准 ![alt](https://...) 的占位终态",
  },
  {
    id: "image-notice-standard",
    file: "src/preview/livePreview.ts",
    owner: "buildStandardImage",
    widget: "AttachmentNoticeWidget",
    span: "inline",
    ordinal: 1,
    reveal: always(A.attachmentNotice, "附件 provider 未接线时恒显示提示；不随选区显露源码"),
    pointerReadonly: noPointer(A.attachmentNotice, "提示 widget 不挂指针监听"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("theme.ts .cm-lp-embed-unsupported", [A.noticeStyle], "提示是行内 chip，行盒由正文承担"),
    ime: NATIVE_IME,
    tests: ["tests/unit/image-widget.test.ts", "scripts/acceptance/scenarios/render-markdown.md"],
    note: "标准图片在 provider 未接线时的提示",
  },
  {
    id: "image-local",
    file: "src/preview/livePreview.ts",
    owner: "buildStandardImage",
    widget: "ImageWidget",
    span: "inline",
    ordinal: 2,
    reveal: always(A.buildStandardImage, "本地图片恒渲染为 <img>；不随选区显露 `![...](...)` 源码"),
    pointerReadonly: imageActions(),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("attachments.ts knownGeometry / imageReserve", [A.knownGeometry, A.imageReserve], "首开按栏宽、重开按缓存几何预留，避免 heightmap 突变"),
    ime: NATIVE_IME,
    tests: ["tests/unit/image-widget.test.ts", "tests/visual/scenes/m633-image-quote.spec.ts"],
    note: "标准本地图片渲染 + 双击放大 / 引用钮",
  },
  {
    id: "wikilink-embed-fallback",
    file: "src/preview/livePreview.ts",
    owner: "buildWikilink",
    widget: "buildWikiEmbedWidget",
    span: "inline",
    ordinal: 1,
    reveal: always(A.buildWikilink, "无解析器时的 ![[...]] 降级分支先于 revealSource 返回；图片 / 提示恒渲染"),
    pointerReadonly: {
      policy: "image-or-notice",
      readonlyPolicy: "same-as-editable",
      anchors: [A.imageWidget, A.attachmentNotice],
      note: "工厂返回 ImageWidget 时可双击 / 引用，返回提示时不消费；只读会话不改文档",
    },
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("attachments.ts knownGeometry / imageReserve；theme.ts .cm-lp-embed-unsupported", [A.knownGeometry, A.noticeStyle], "按工厂实际返回的 widget 取图片预留或提示 chip 几何"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/wikilink.spec.ts", "scripts/acceptance/scenarios/865-wikilink-caret-reveal-nov24.md"],
    note: "无 wikilink 解析器时的嵌入降级入口",
  },
  {
    id: "wikilink-notice-unsupported",
    file: "src/preview/livePreview.ts",
    owner: "buildWikilink",
    widget: "AttachmentNoticeWidget",
    span: "inline",
    ordinal: 1,
    reveal: always(A.buildWikilink, "块引用不支持是语义终态，恒显示提示；不随选区显露源码"),
    pointerReadonly: noPointer(A.attachmentNotice, "提示 widget 不挂指针监听"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("theme.ts .cm-lp-embed-unsupported", [A.noticeStyle], "提示是行内 chip，行盒由正文承担"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/wikilink.spec.ts", "scripts/acceptance/scenarios/865-wikilink-caret-reveal-nov24.md"],
    note: "`![[...#^block]]` 之类不支持形态的提示",
  },
  {
    id: "wikilink-notice-unresolved",
    file: "src/preview/livePreview.ts",
    owner: "buildWikilink",
    widget: "AttachmentNoticeWidget",
    span: "inline",
    ordinal: 2,
    reveal: always(A.buildWikilink, "未解析的嵌入是语义终态，恒显示提示；不随选区显露源码"),
    pointerReadonly: noPointer(A.attachmentNotice, "提示 widget 不挂指针监听"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("theme.ts .cm-lp-embed-unsupported", [A.noticeStyle], "提示是行内 chip，行盒由正文承担"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/wikilink.spec.ts", "scripts/acceptance/scenarios/865-wikilink-caret-reveal-nov24.md"],
    note: "嵌入目标不存在时的提示",
  },
  {
    id: "wikilink-notice-note",
    file: "src/preview/livePreview.ts",
    owner: "buildWikilink",
    widget: "AttachmentNoticeWidget",
    span: "inline",
    ordinal: 3,
    reveal: always(A.buildWikilink, "笔记内容嵌入不支持（ADR 0003 §2），恒显示提示；不随选区显露源码"),
    pointerReadonly: noPointer(A.attachmentNotice, "提示 widget 不挂指针监听"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("theme.ts .cm-lp-embed-unsupported", [A.noticeStyle], "提示是行内 chip，行盒由正文承担"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/wikilink.spec.ts", "scripts/acceptance/scenarios/865-wikilink-caret-reveal-nov24.md"],
    note: "`![[note]]` 笔记嵌入的提示",
  },
  {
    id: "wikilink-notice-provider",
    file: "src/preview/livePreview.ts",
    owner: "buildWikilink",
    widget: "AttachmentNoticeWidget",
    span: "inline",
    ordinal: 4,
    reveal: always(A.buildWikilink, "附件 provider 未接线或路径为空时恒显示提示；不随选区显露源码"),
    pointerReadonly: noPointer(A.attachmentNotice, "提示 widget 不挂指针监听"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("theme.ts .cm-lp-embed-unsupported", [A.noticeStyle], "提示是行内 chip，行盒由正文承担"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/wikilink.spec.ts", "scripts/acceptance/scenarios/865-wikilink-caret-reveal-nov24.md"],
    note: "嵌入附件 provider 缺失 / 路径为空时的提示",
  },
  {
    id: "wikilink-image",
    file: "src/preview/livePreview.ts",
    owner: "buildWikilink",
    widget: "ImageWidget",
    span: "inline",
    ordinal: 1,
    reveal: always(A.buildWikilink, "嵌入图片分支先于 revealSource 返回；`![[img]]` 恒渲染为 <img>，不显露源码"),
    pointerReadonly: imageActions(),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("attachments.ts knownGeometry / imageReserve", [A.knownGeometry, A.imageReserve], "嵌入图片与标准图片共用预留 / 终态几何"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/wikilink.spec.ts", "scripts/acceptance/scenarios/865-wikilink-caret-reveal-nov24.md"],
    note: "wiki 嵌入图片的渲染",
  },
  {
    id: "wikilink-link",
    file: "src/preview/livePreview.ts",
    owner: "buildWikilink",
    widget: "WikilinkWidget",
    span: "inline",
    ordinal: 1,
    reveal: revealNode("普通 wikilink 被选区严格重叠即整条显示源码（collectWikilinks 把 touchesSource 传入 revealSource）"),
    pointerReadonly: {
      policy: "wikilink-source-or-restore",
      readonlyPolicy: "restores-selection",
      anchors: [A.enterSource, text("src/preview/livePreview.ts", "view.state.readOnly")],
      note: "可编辑会话点击入源；只读会话不 preventDefault，手势结束恢复原选区与焦点",
    },
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("theme.ts .cm-lp-wikilink", [A.wikilinkStyle], "链接是行内节点，行盒由正文承担"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/wikilink-caret-reveal.spec.ts", "scripts/acceptance/scenarios/865-wikilink-caret-reveal-nov24.md"],
    note: "普通 wikilink 的 label widget",
  },
  {
    id: "inline-math",
    file: "src/preview/math.ts",
    owner: "collectInlineMath",
    widget: "InlineMathWidget",
    span: "inline",
    ordinal: 1,
    reveal: revealOverlap(A.mathSelection, "选区与行内公式范围严格重叠即跳过装饰、显示 $...$（判据取活选区，不用 reveal-gate 快照）"),
    pointerReadonly: enterSource(),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("math.ts InlineMathWidget", [A.inlineMath], "行内公式是 inline widget，宽度由渲染内容决定，不写行高"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/math.spec.ts", "tests/visual/scenes/m111-math-interaction.spec.ts"],
    note: "行内 $...$（含 cell 内同行 $$...$$）",
  },
  {
    id: "block-math",
    file: "src/preview/math.ts",
    owner: "mathBlockSet",
    widget: "BlockMathWidget",
    span: "block",
    ordinal: 1,
    reveal: revealOverlap(A.mathSelection, "选区与块范围严格重叠即跳过装饰、显示 $$...$$（StateField 全文档路径）"),
    pointerReadonly: enterSource(),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("style.css .cm-lp-math-block", [A.blockMathStyle], "块级纵向 padding + 横向滚动容器"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/math.spec.ts", "scripts/acceptance/scenarios/02-math-click.md"],
    note: "跨行 $$...$$ 块级公式",
  },
  {
    id: "mermaid-block",
    file: "src/preview/mermaid.ts",
    owner: "mermaidBlockSet",
    widget: "MermaidBlockWidget",
    span: "block",
    ordinal: 1,
    reveal: revealOverlap(A.mermaidDiagram, "选区与围栏块范围严格重叠即显示源码（isMermaidDiagram 的选区判据）"),
    pointerReadonly: enterSource(),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("style.css .cm-lp-mermaid", [A.mermaidStyle], "块级纵向 padding + 横向滚动容器"),
    ime: NATIVE_IME,
    tests: ["tests/visual/scenes/mermaid.spec.ts", "tests/visual/scenes/m112-mermaid-click.spec.ts", "scripts/acceptance/scenarios/01-mermaid-click.md"],
    note: "```mermaid 围栏块整块替换",
  },
];

// ---------------------------------------------------------------------------
// 对账
// ---------------------------------------------------------------------------

interface DiffResult {
  unregistered: Site[];
  stale: RegistryEntry[];
  duplicate: string[];
}

function diff(sites: readonly Site[], registry: readonly RegistryEntry[]): DiffResult {
  const siteKeys = new Set(sites.map(siteKey));
  const seen = new Map<string, RegistryEntry>();
  const duplicate: string[] = [];
  for (const entry of registry) {
    const key = siteKey(entry);
    if (seen.has(key)) duplicate.push(key);
    seen.set(key, entry);
  }
  const unregistered = sites.filter((site) => !seen.has(siteKey(site)));
  const stale = registry.filter((entry) => !siteKeys.has(siteKey(entry)));
  return { unregistered, stale, duplicate };
}

/** 符号锚点只认 TS AST 的 Identifier 节点：注释、字符串、正则里的同名字串都不算。
 *  这是「符号锚点可以冒充」的机器判据——用文本正则时，`// InlineMathWidget` 就能喂绿。 */
function symbolExistsInSource(source: ts.SourceFile, needle: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === needle) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function makeProbeEntry(): RegistryEntry {
  const probe: Site = {
    file: "src/preview/probe.ts",
    owner: "probe",
    widget: "ProbeWidget",
    span: "inline",
    ordinal: 1,
    line: 1,
  };
  return {
    id: "probe",
    ...probe,
    reveal: always(A.buildStandardImage, "probe"),
    pointerReadonly: noPointer(A.imageWidget, "probe"),
    nativeEdit: SHARED_NATIVE_EDIT,
    geometry: geometry("probe", [A.imageWidget], "probe"),
    ime: NATIVE_IME,
    tests: ["tests/unit/image-widget.test.ts"],
    note: "probe",
  };
}

function anchorProblem(anchor: Anchor): string | null {
  const full = path.join(root, anchor.file);
  if (!existsSync(full)) return `${anchor.file} 不存在`;
  if (anchor.kind === "symbol") {
    if (!full.endsWith(".ts")) return `${anchor.file} 不是 .ts 文件，symbol 锚点只支持 TS 标识符`;
    return symbolExistsInSource(parse(full), anchor.needle)
      ? null
      : `${anchor.file} 中找不到标识符 ${anchor.needle}（注释 / 字符串不算）`;
  }
  return textOf(full).includes(anchor.needle)
    ? null
    : `${anchor.file} 中找不到文本 ${anchor.needle}`;
}

function fieldProblems(entry: RegistryEntry): string[] {
  const problems: string[] = [];
  if (entry.id.length === 0) problems.push(`${siteKey(entry)} 缺少 id`);
  if (entry.note.length === 0) problems.push(`${entry.id} 缺少说明`);
  if (!REVEAL_POLICIES.has(entry.reveal.policy)) problems.push(`${entry.id} 的显露策略不在词表：${entry.reveal.policy}`);
  if (!POINTER_POLICIES.has(entry.pointerReadonly.policy)) {
    problems.push(`${entry.id} 的指针策略不在词表：${entry.pointerReadonly.policy}`);
  }
  if (!READONLY_POLICIES.has(entry.pointerReadonly.readonlyPolicy)) {
    problems.push(`${entry.id} 的只读策略不在词表：${entry.pointerReadonly.readonlyPolicy}`);
  }
  if (!IME_POLICIES.has(entry.ime.policy)) problems.push(`${entry.id} 的 IME 策略不在词表：${entry.ime.policy}`);
  if (entry.nativeEdit.policy !== "shared-gate") {
    problems.push(`${entry.id} 的原生编辑策略必须是 shared-gate（共享 state 闸门），实际 ${entry.nativeEdit.policy}`);
  }
  const nativeAnchors = entry.nativeEdit.anchors;
  if (
    nativeAnchors.length !== 1 ||
    nativeAnchors[0].file !== "src/editor.ts" ||
    nativeAnchors[0].kind !== "symbol" ||
    nativeAnchors[0].needle !== "absorbNativeEdit"
  ) {
    problems.push(
      `${entry.id} 的原生编辑锚点必须恰好是 src/editor.ts 的 absorbNativeEdit（唯一共享 state 闸门）`,
    );
  }
  if (entry.geometry.owner.trim() === "") {
    problems.push(`${entry.id} 的几何写入者 owner 为空`);
  }
  for (const [field, anchors] of [
    ["reveal", entry.reveal.anchors],
    ["pointerReadonly", entry.pointerReadonly.anchors],
    ["nativeEdit", entry.nativeEdit.anchors],
    ["geometry", entry.geometry.anchors],
    ["ime", entry.ime.anchors],
  ] as const) {
    if (anchors.length === 0) problems.push(`${entry.id} 的 ${field} 缺少锚点`);
    for (const anchor of anchors) {
      const problem = anchorProblem(anchor);
      if (problem) problems.push(`${entry.id} 的 ${field} 锚点失效：${problem}`);
    }
  }
  if (entry.tests.length === 0) problems.push(`${entry.id} 缺少测试指针`);
  for (const pointer of entry.tests) {
    if (!pointer.startsWith("tests/") && !pointer.startsWith("scripts/acceptance/scenarios/")) {
      problems.push(`${entry.id} 的测试指针不在允许目录：${pointer}`);
    } else if (!existsSync(path.join(root, pointer))) {
      problems.push(`${entry.id} 的测试指针不存在：${pointer}`);
    }
  }
  return problems;
}

/** 人读清单里的测试路径也必须当下可达：抽取反引号里的 `tests/...` / 验收场景路径，
 *  逐条查在不在。机器注册表的 tests 字段与文档清单是两份读者面，二者都可能腐烂。 */
function docPointerProblems(text: string): string[] {
  const paths = [...text.matchAll(/`((?:tests|scripts\/acceptance\/scenarios)\/[^`\s]+)`/g)]
    .map((match) => match[1])
    .filter((value) => value.endsWith(".ts") || value.endsWith(".md"));
  return [...new Set(paths)]
    .filter((pointer) => !existsSync(path.join(root, pointer)))
    .map((pointer) => `文档测试路径不存在：${pointer}`);
}

function beforeinputSites(file: string): number[] {
  if (!textOf(file).includes("beforeinput")) return [];
  const source = parse(file);
  const hits: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "beforeinput") {
      hits.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    if (ts.isStringLiteralLike(node) && node.text === "beforeinput") {
      hits.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

function aliasesInSource(source: ts.SourceFile): number[] {
  const hits: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Decoration" &&
      node.name.text === "replace"
    ) {
      const call = node.parent;
      if (!ts.isCallExpression(call) || call.expression !== node) {
        hits.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Decoration" &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "replace"
    ) {
      hits.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      node.initializer.text === "Decoration"
    ) {
      hits.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    if (
      ts.isImportSpecifier(node) &&
      node.propertyName?.text === "Decoration" &&
      node.name.text !== "Decoration"
    ) {
      hits.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

function decorationAliases(file: string): number[] {
  if (!textOf(file).includes("Decoration")) return [];
  return aliasesInSource(parse(file));
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

test("覆盖与新鲜度：每个 replace 站点恰好一条登记，每条登记都落到站点", () => {
  const { sites, problems } = scanSrc();
  assert.deepEqual(problems, [], `扫描器发现问题：\n${problems.join("\n")}`);
  assert.ok(sites.length > 0, "扫描器没有找到任何 Decoration.replace——判据形同没有");
  const { unregistered, stale, duplicate } = diff(sites, REGISTRY);
  const errors: string[] = [];
  for (const site of unregistered) {
    errors.push(
      `未登记站点（新增构造必须先登记）：${site.file} · ${site.owner} · ${site.widget ?? "(hide)"} · ${site.span} · #${site.ordinal}（line ${site.line}）`,
    );
  }
  for (const entry of stale) {
    errors.push(`僵尸条目（源码里已找不到对应站点）：${entry.id} → ${siteKey(entry)}`);
  }
  for (const key of duplicate) errors.push(`注册表重复条目（同一站点被登记两次）：${key}`);
  assert.deepEqual(
    errors,
    [],
    `replace 注册表与源码双向对账失败（登记表：tests/unit/replace-widget-registry.test.ts 的 REGISTRY；合同：docs/specs/replace-widget-contracts.md）：\n${errors.join("\n")}`,
  );
});

test("字段：七项责任齐全，锚点与测试指针当下可解析", () => {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const entry of REGISTRY) {
    if (ids.has(entry.id)) errors.push(`重复的 id：${entry.id}`);
    ids.add(entry.id);
    errors.push(...fieldProblems(entry));
  }
  assert.deepEqual(errors, [], `注册表责任字段不完整或锚点已失效：\n${errors.join("\n")}`);
});

test("单一实现：原生编辑只走共享闸门，preview 无 beforeinput，Decoration.replace 无别名", () => {
  const errors: string[] = [];
  for (const file of sourceFiles(srcDir)) {
    if (rel(file).startsWith("src/preview/")) {
      for (const line of beforeinputSites(file)) {
        errors.push(`${rel(file)}:${line} 出现 beforeinput——replace 构造 MUST NOT 自带原生编辑闸门，统一走 src/editor.ts 的 absorbNativeEdit`);
      }
    }
    for (const line of decorationAliases(file)) {
      errors.push(`${rel(file)}:${line} 出现 Decoration.replace 别名 / 元素访问 / 解构——静态扫描会失明，MUST 直接调用`);
    }
  }
  assert.deepEqual(errors, [], `单一实现判据失败：\n${errors.join("\n")}`);
});

test("扫描器形态：纯隐藏 / widget / 工厂 / 简写 / block 都认得出", () => {
  const text = [
    'Decoration.replace({}).range(0, 1);',
    'Decoration.replace({ widget: new AlphaWidget() }).range(0, 1);',
    'Decoration.replace({ widget: factoryWidget() }).range(0, 1);',
    'Decoration.replace({ widget: new BlockWidget(), block: true }).range(0, 1);',
    'const widget = new ShorthandWidget();',
    'Decoration.replace({ widget }).range(0, 1);',
    '// Decoration.replace({}) 注释里的不算',
  ].join("\n");
  const { sites, problems } = scanSourceFile("src/preview/probe.ts", text);
  assert.deepEqual(problems, []);
  assert.deepEqual(
    sites.map((site) => [site.widget, site.span, site.ordinal]),
    [
      [null, "inline", 1],
      ["AlphaWidget", "inline", 1],
      ["factoryWidget", "inline", 1],
      ["BlockWidget", "block", 1],
      ["ShorthandWidget", "inline", 1],
    ],
    "扫描器没有按实际形态识别站点（纯隐藏 / widget / 工厂 / 简写 / block）",
  );
});

test("反向输入：缺登记 / 僵尸 / 序号漂移 / 锚点失效 / 别名都判红", () => {
  const probe: Site = {
    file: "src/preview/probe.ts",
    owner: "probe",
    widget: "ProbeWidget",
    span: "inline",
    ordinal: 1,
    line: 1,
  };
  const entry = makeProbeEntry();

  // ① 源码有站点、注册表没有 → 未登记。
  assert.deepEqual(
    diff([probe], []).unregistered.map(siteKey),
    [siteKey(probe)],
    "缺登记没有被判红",
  );
  // ② 注册表有条目、源码没有站点 → 僵尸。
  assert.deepEqual(
    diff([], [entry]).stale.map((item) => item.id),
    ["probe"],
    "僵尸条目没有被判红",
  );
  // ③ 同组序号漂移 → 原序号成僵尸、新序号成未登记。
  const drifted = diff([{ ...probe, ordinal: 2 }], [entry]);
  assert.deepEqual(drifted.unregistered.map(siteKey), [siteKey({ ...probe, ordinal: 2 })]);
  assert.deepEqual(drifted.stale.map((item) => item.id), ["probe"]);
  // ④ 锚点失效。
  assert.notEqual(anchorProblem({ file: "src/preview/probe.ts", kind: "symbol", needle: "Nope" }), null);
  assert.notEqual(anchorProblem({ file: "src/preview/math.ts", kind: "symbol", needle: "NoSuchSymbol" }), null);
  // ⑤ 别名引用被识别。
  const aliasFile = path.join(srcDir, "__probe-alias.ts");
  const aliasText = [
    "import { Decoration as D } from \"@codemirror/view\";",
    "const replace = Decoration.replace;",
    "const { replace: destructured } = Decoration;",
    "const d = Decoration;",
    "Decoration.replace({}).range(0, 1);",
  ].join("\n");
  const aliasSource = ts.createSourceFile(aliasFile, aliasText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const inlineHits = aliasesInSource(aliasSource);
  assert.equal(inlineHits.length, 4, "别名 / 解构 / 整体赋值 / import 重命名没有被识别");
});

test("反向输入：不支持的 replace 参数形态必须 problems 判红", () => {
  const text = [
    "Decoration.replace(spec);",
    "Decoration.replace({ ...spec });",
    'Decoration.replace({ ["widget"]: new ComputedWidget() });',
    'Decoration.replace({ ["block"]: true });',
    "Decoration.replace({ block });",
    "const dynamic = true;",
    "Decoration.replace({ widget: new W(), block: dynamic });",
    "Decoration.replace({ widget: w });",
    "Decoration.replace();",
  ].join("\n");
  const { problems } = scanSourceFile("src/preview/__probe-unsupported.ts", text);
  const joined = problems.join("\n");
  for (const expected of [
    "对象字面量",
    "展开属性",
    "计算属性名",
    "block 简写",
    "block 属性必须是字面量",
    "widget 初始值必须是 new",
  ]) {
    assert.ok(joined.includes(expected), `不支持的参数形态没有被判红：缺少「${expected}」\n实际：\n${joined}`);
  }
});

test("反向输入：空白 geometry.owner / 错误的 nativeEdit 锚点必须判红", () => {
  const entry = makeProbeEntry();
  const emptyOwner: RegistryEntry = {
    ...entry,
    geometry: { ...entry.geometry, owner: "  " },
  };
  assert.ok(
    fieldProblems(emptyOwner).some((problem) => problem.includes("几何写入者")),
    "geometry.owner 为空没有被判红",
  );
  const wrongNative: RegistryEntry = {
    ...entry,
    nativeEdit: { policy: "shared-gate", anchors: [A.imageWidget], note: entry.nativeEdit.note },
  };
  assert.ok(
    fieldProblems(wrongNative).some((problem) => problem.includes("absorbNativeEdit")),
    "nativeEdit 锚点没有精确指向 src/editor.ts / absorbNativeEdit 时没有判红",
  );
});

test("反向输入：注释 / 字符串里的同名符号不能冒充符号锚点", () => {
  const commentOnly = ts.createSourceFile(
    "probe.ts",
    '// InlineMathWidget\nconst label = "InlineMathWidget";',
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  assert.equal(symbolExistsInSource(commentOnly, "InlineMathWidget"), false);
  const realIdentifier = ts.createSourceFile(
    "probe.ts",
    "const InlineMathWidget = 1;",
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  assert.equal(symbolExistsInSource(realIdentifier, "InlineMathWidget"), true);
  assert.notEqual(
    anchorProblem({
      file: "tests/unit/fixtures/replace-anchor-comment-probe.ts",
      kind: "symbol",
      needle: "InlineMathWidget",
    }),
    null,
    "注释 / 字符串里的同名字串被当成了符号锚点",
  );
});

test("人读文档的测试指针全部存在（缺一条即红）", () => {
  const doc = textOf(path.join(root, "docs/specs/replace-widget-contracts.md"));
  assert.deepEqual(docPointerProblems(doc), [], "人读文档里的测试路径有缺失");
  assert.deepEqual(
    docPointerProblems("| x | `tests/visual/scenes/__missing__.spec.ts` |"),
    ["文档测试路径不存在：tests/visual/scenes/__missing__.spec.ts"],
    "文档测试路径缺失没有被判红",
  );
});

test("别名边界：字面量元素访问判红，计算动态访问不在扫描范围", () => {
  const source = ts.createSourceFile(
    "probe.ts",
    [
      'Decoration["replace"]({});',
      "const method = \"replace\";",
      "Decoration[method]({});",
    ].join("\n"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  assert.equal(aliasesInSource(source).length, 1, "字面量元素访问必须判红，计算动态访问不在范围");
});
