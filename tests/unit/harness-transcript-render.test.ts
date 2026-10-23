// harness transcript 的两条渲染不变量单测（M460，Alex 2026-10-12 dogfood 反馈）：
//
//   1. **裸 URL 必须上屏为可点链接**（缺陷一）。现场原话：「harness pane 里的表格里的链接
//      没有渲染出来……但在会话 JSONL 里是有链接的」。根因：@lezer/markdown 的 GFM 配置下
//      `https://…` 裸 URL 产出的是**顶层 `URL` 节点**（段落与 TableCell 里都是，实测见下），
//      而渲染器的 SKIP_NODES 里含 `"URL"`（本意是不把 `[文字](url)` 括号里那段 URL 重复
//      上屏）⇒ 整段 URL 落入 default 分支被跳过、在面板里隐身。影响面不止表格：任何裸 URL
//      在 agent 消息里都不上屏。
//   2. **`[文字](url)` 的 URL 子节点不得二次上屏**（缺陷一的回归面）。`Link` 节点分支自己
//      消费 URL 子节点（取 href），故「独立 URL 节点」与「Link 之下的 URL 子节点」必须分开
//      对待——本文件用**同一份渲染器**驱动两种宿主形态，逐字比对两者产出的文本。
//
// 为什么这一层能测：`renderMarkdownInto` 是**真渲染件**（面板正文走的就是它），它只碰
// `document.createElement` / `createTextNode` / `append` 这一小撮 DOM 面，最小 DOM 替身
// 足以驱动——与 tests/unit/tabs.test.ts、harness-thinking-reset.test.ts 同一手法（各持一份
// 替身是刻意的，见 tabs.test.ts 文件头）。
//
// 覆盖什么：段落与表格 cell 两类宿主下的裸 URL 锚（href / 文本 = URL 原文）、`[文字](url)`
// 不重复上屏、`<…>` 自动链接形态不变、行内代码与围栏代码里的 URL 不产锚、无 scheme 的
// `www.` / 邮箱字面量同样产锚（GFM 同一种节点；点击能不能开由 Rust scheme 白名单判定）。
// 不覆盖什么：面板与真 DOM 的接线（who 行形态、快照/恢复重放的 DOM 面）归真机验收场景 152
// 与 tests/visual 的 m303 / m351。

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate, t } from "../../src/copy.ts";
import { renderMarkdownInto, whenTextOf } from "../../src/harness-panel.ts";
import type { HarnessBlockOpeners, PathLinkRenderContext } from "../../src/harness-panel.ts";
import type { CodeBlockRender } from "../../src/preview/code-block-content.ts";

// ---------------------------------------------------------------------------
// 最小 DOM 替身（只覆盖 markdown → DOM 这一小撮面）
// ---------------------------------------------------------------------------

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

class FakeEl {
  readonly tagName: string;
  readonly nodeType: number;
  parent: FakeEl | null = null;
  private nodes: FakeEl[] = [];
  private text = "";

  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  href = "";
  title = "";
  className = "";

  constructor(tagName: string, nodeType = ELEMENT_NODE) {
    this.tagName = tagName;
    this.nodeType = nodeType;
  }

  get textContent(): string {
    return this.text + this.nodes.map((node) => node.textContent).join("");
  }

  set textContent(value: string) {
    this.text = value;
    for (const node of this.nodes) node.parent = null;
    this.nodes = [];
  }

  get children(): FakeEl[] {
    return this.nodes.filter((node) => node.nodeType === ELEMENT_NODE);
  }

  get childElementCount(): number {
    return this.children.length;
  }

  get classNameValue(): string {
    return [...this.classes].join(" ");
  }

  append(...incoming: FakeEl[]): void {
    for (const node of incoming) {
      node.parent = this;
      this.nodes.push(node);
    }
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  /** 深度优先找出类名命中的后代（含自身）。 */
  find(className: string): FakeEl[] {
    const out: FakeEl[] = [];
    if (this.classes.has(className)) out.push(this);
    for (const child of this.children) out.push(...child.find(className));
    return out;
  }

  /** 深度优先找出标签名命中的后代（含自身）——宿主形态断言（表格 cell）用。 */
  findTag(tagName: string): FakeEl[] {
    const out: FakeEl[] = [];
    if (this.tagName === tagName) out.push(this);
    for (const child of this.children) out.push(...child.findTag(tagName));
    return out;
  }

  /** 最近的带该类名的祖先（含自身）——块全屏的「消息内序号」判据用（`.lumir-hp-msg`）。 */
  closest(selector: string): FakeEl | null {
    const name = selector.startsWith(".") ? selector.slice(1) : selector;
    let el: FakeEl | null = this;
    while (el !== null) {
      if (el.classes.has(name)) return el;
      el = el.parent;
    }
    return null;
  }

  /** 真 DOM 的父元素入口（`closest` 缺席时的退路；替身内部用 `parent`）。 */
  get parentElement(): FakeEl | null {
    return this.parent;
  }

  /** 类名选择器的后代查询（仅 `.name` 形态）：序号判据只查 `.lumir-hp-block-slot`，
   *  按数据集细分（替身不实现属性选择器）。 */
  querySelectorAll(className: string): FakeEl[] {
    const name = className.startsWith(".") ? className.slice(1) : className;
    return this.find(name).filter((el) => el !== this);
  }
}

/** `el.className = "a b"` 的赋值入口：替身把它落进类集合（find 按类名找）。 */
function withClassName(el: FakeEl): FakeEl {
  Object.defineProperty(el, "className", {
    get: () => el.classNameValue,
    set: (value: string) => {
      el.classes.clear();
      for (const name of value.split(/\s+/).filter(Boolean)) el.classes.add(name);
    },
  });
  return el;
}

function installFakeDom(): void {
  (globalThis as unknown as Record<string, unknown>).document = {
    createElement: (tag: string) => withClassName(new FakeEl(tag)),
    // 块全屏钮的图标经 createElementNS 建（面板零 innerHTML 的渲染纪律）；替身按标签名建节点。
    createElementNS: (_ns: string, tag: string) => withClassName(new FakeEl(tag)),
    createTextNode: (text: string) => {
      const node = new FakeEl("#text", TEXT_NODE);
      node.textContent = text;
      return node;
    },
  };
}

/** 一段 Markdown → 渲染出的 DOM 根（真渲染件 + 替身 DOM）。`ctx` 缺省 = 不链接化路径。 */
function render(
  source: string,
  ctx?: PathLinkRenderContext,
  openers?: HarnessBlockOpeners,
  host: FakeEl = new FakeEl("div"),
): FakeEl {
  installFakeDom();
  renderMarkdownInto(host as unknown as HTMLElement, source, ctx, openers);
  return host;
}

/** 触发假元素上注册的某个事件（事件对象只需满足处理器实际读到的面）。 */
function fire(el: FakeEl, type: string, event: Record<string, unknown> = {}): void {
  const listeners = el.listeners.get(type) ?? [];
  assert.ok(listeners.length > 0, `元素上没有 ${type} 监听`);
  for (const listener of listeners) listener({ preventDefault() {}, stopPropagation() {}, ...event });
}

/** 路径链接上下文：`files` = 文件索引，`dirs` = 目录模型（change harness-dir-link）；
 *  文件点击记进 `opened`（含行号），目录点击记进 `revealed`。 */
function pathCtxWith(
  files: string[],
  dirs: string[],
): {
  ctx: PathLinkRenderContext;
  opened: Array<[string, number | undefined]>;
  revealed: string[];
} {
  const fileSet = new Set(files);
  const dirSet = new Set(dirs);
  const opened: Array<[string, number | undefined]> = [];
  const revealed: string[] = [];
  return {
    opened,
    revealed,
    ctx: {
      isFile: (path) => fileSet.has(path),
      isDir: (path) => dirSet.has(path),
      openFile: (path, line) => opened.push([path, line]),
      revealDir: (path) => revealed.push(path),
    },
  };
}

/** 只有文件索引的上下文（既有用例的简写）。 */
function pathCtx(...paths: string[]) {
  return pathCtxWith(paths, []);
}

/** 只有目录模型的上下文。 */
function dirCtx(...dirs: string[]) {
  return pathCtxWith([], dirs);
}

const URL_TEXT = "https://example.com/a/b?x=1";

// ---------------------------------------------------------------------------
// 缺陷一：裸 URL 的上屏形态
// ---------------------------------------------------------------------------

test("段落里的裸 URL 渲染为 .lumir-hp-link（href 与文本都是 URL 原文）", () => {
  const host = render(`见 ${URL_TEXT} 结束`);
  const links = host.find("lumir-hp-link");
  assert.equal(links.length, 1, "裸 URL 必须产出锚元素（修复前整段 URL 被跳过、不上屏）");
  assert.equal(links[0].tagName, "a");
  assert.equal(links[0].href, URL_TEXT);
  assert.equal(links[0].textContent, URL_TEXT, "锚的可见文本 = URL 原文");
  assert.equal(host.textContent, `见 ${URL_TEXT} 结束`, "URL 周围文本逐字不变，且 URL 只出现一次");
});

test("表格 cell 里的裸 URL 同样渲染为锚（Alex 现场的那一格）", () => {
  const host = render(`| 列 |\n|---|\n| ${URL_TEXT} |`);
  const links = host.find("lumir-hp-link");
  assert.equal(links.length, 1, "TableCell(URL) 与段落同一种节点，必须同样上屏");
  assert.equal(links[0].href, URL_TEXT);
  assert.equal(links[0].textContent, URL_TEXT);
  const cell = host.findTag("td");
  assert.equal(cell.length, 1);
  assert.equal(cell[0].textContent, URL_TEXT);
  // 锚确实落在 cell 之内（宿主形态：不是飘在表格外的兄弟节点）。
  assert.equal(cell[0].find("lumir-hp-link").length, 1);
});

test("Link 节点之下的 URL 子节点不二次上屏（`[文字](url)` 只显示「文字」）", () => {
  const host = render(`写 [文字](${URL_TEXT}) 完`);
  const links = host.find("lumir-hp-link");
  assert.equal(links.length, 1);
  assert.equal(links[0].textContent, "文字", "链接显示文本仍是「文字」");
  assert.equal(links[0].href, URL_TEXT);
  // 回归判据（缺陷一的正当语义面）：URL 原文只在 href 里，**不得**作为可见文本再上屏一次。
  assert.equal(links[0].textContent.includes(URL_TEXT), false);
  assert.equal(host.textContent, "写 文字 完");
});

test("角括号自动链接形态不变（`<url>` → 文本 = URL，无尖括号）", () => {
  const host = render(`见 <${URL_TEXT}> 完`);
  const links = host.find("lumir-hp-link");
  assert.equal(links.length, 1);
  assert.equal(links[0].href, URL_TEXT);
  assert.equal(links[0].textContent, URL_TEXT);
});

test("无 scheme 的字面 URL（www. / 邮箱 / mailto:）按同一节点形态上屏为锚", () => {
  // 口径登记：GFM 对这三态都产 URL 节点，本修复一律上屏为锚；能不能打开由 Rust 侧 scheme
  // 白名单判定（前端不自行判——与 Link 分支同一条信任边界）。修复前这三态同样是隐身。
  const host = render("看 www.example.com 与 user@example.com 与 mailto:user@example.com");
  const texts = host.find("lumir-hp-link").map((el) => el.textContent);
  assert.deepEqual(texts, ["www.example.com", "user@example.com", "mailto:user@example.com"]);
  assert.equal(host.textContent.includes("www.example.com"), true, "URL 原文在正文里可见");
});

test("行内代码与围栏代码里的 URL 不产锚（代码即原文，语法树里没有 URL 节点）", () => {
  const host = render(`\`${URL_TEXT}\`\n\n\`\`\`\n${URL_TEXT}\n\`\`\`\n`);
  assert.equal(host.find("lumir-hp-link").length, 0);
  assert.equal(host.find("lumir-hp-codeblock").length, 1, "围栏代码块照常渲染成代码块");
  assert.equal(host.textContent.includes(URL_TEXT), true, "代码里的 URL 以原文可见（不上屏成链接）");
});

// ---------------------------------------------------------------------------
// 缺陷二：when 文本的两种形态（恢复重放的读数可跨天）
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 9, 12, 4, 0, 0); // 2026-10-12 12:00（东八区本地时）

test("live 形态：沿用 M351 分档（<10s 刚刚 / 分钟前 / 跨天仍是「昨天」）", () => {
  assert.equal(whenTextOf(NOW - 3_000, NOW, "live"), "· 刚刚");
  assert.equal(whenTextOf(NOW - 90_000, NOW, "live"), "· 1分钟前");
  assert.equal(whenTextOf(NOW - 3 * 3600_000, NOW, "live"), "· 3小时前");
  assert.equal(whenTextOf(NOW - 3 * 86_400_000, NOW, "live"), "· 昨天");
  // 缺省形态 = live（既有调用点不改行为）。
  assert.equal(whenTextOf(NOW - 90_000, NOW), "· 1分钟前");
});

test("restored 形态：同日窄相对、跨天短日期（与 sessionWhen 同族）", () => {
  assert.equal(whenTextOf(NOW - 30_000, NOW, "restored"), "· 30秒前");
  assert.equal(whenTextOf(NOW - 90_000, NOW, "restored"), "· 1分钟前");
  assert.equal(whenTextOf(NOW - 3 * 3600_000, NOW, "restored"), "· 3小时前");
  // 跨天 = 短日期（一周前的消息显示「昨天」是错读数——会话留存在盘上，读数可以很老）。
  const threeDaysAgo = NOW - 3 * 86_400_000;
  assert.equal(
    whenTextOf(threeDaysAgo, NOW, "restored"),
    `· ${formatDate(new Date(threeDaysAgo), "short")}`,
  );
  assert.equal(whenTextOf(NOW - 3 * 86_400_000, NOW, "live"), "· 昨天", "live 档不受本改动影响");
});

// ---------------------------------------------------------------------------
// 缺陷三：表格的矩形性（M528，Alex 2026-10-16 dogfood 反馈）
//
// 现场原话：「harness 里没有正确渲染表格，第一行的第一列应该是一个空白格，但渲染出来的时候
// 第一行少了它（从原本的 3 列变成了 2 列）」。根因：@lezer/markdown 的 GFM 对**空单元格不产
// `TableCell` 节点**，只产相邻的两个 `TableDelimiter`（实测见下各用例）——按 `TableCell` 子
// 节点渲染等于把空格从表格里抹掉，后面的格子整体左移。
//
// 不变量（合同条款见 openspec/specs/harness/spec.md「表格列数守恒」）：整表**每行格数相同**，
// 等于 delimiter 行的列数；空格占住自己的列位而不是消失。与编辑器侧的
// docs/specs/table-reading.md §2「空格空槽与 `||` 零宽空槽都必须占据原列」同一条矩形性合同。
// ---------------------------------------------------------------------------

/** 渲染出的表格形态：每行一个数组，元素是该行的格文本（`""` = 一个空槽）。 */
function tableShape(source: string): string[][] {
  return render(source).findTag("tr").map((tr) => tr.children.map((cell) => cell.textContent));
}

test("表格首列空白：空槽占住列位，三列不塌成两列（Alex 现场那一格）", () => {
  const shape = tableShape("| | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n");
  assert.deepEqual(shape, [
    ["", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("表格中列与末列空白：空槽各自占位，后续格子不左移", () => {
  assert.deepEqual(tableShape("| a |  | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n"), [
    ["a", "", "c"],
    ["1", "2", "3"],
  ]);
  assert.deepEqual(tableShape("| a | b |  |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n"), [
    ["a", "b", ""],
    ["1", "2", "3"],
  ]);
  // `||` 零宽空槽与空格空槽同解（parser 对两者产同一形状的节点序列）。
  assert.deepEqual(tableShape("| a || c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n"), [
    ["a", "", "c"],
    ["1", "2", "3"],
  ]);
});

test("无首尾 pipe 的写法同样按列位补空槽（列位判据不吃 pipe 写法）", () => {
  assert.deepEqual(tableShape("a |  | c\n--- | --- | ---\n1 | 2 | 3\n"), [
    ["a", "", "c"],
    ["1", "2", "3"],
  ]);
});

test("表体行格数少于表头：尾部按列数补齐（GFM 的 short row 补空 cell）", () => {
  assert.deepEqual(tableShape("| a | b | c |\n| --- | --- | --- |\n| 1 | 2 |\n"), [
    ["a", "b", "c"],
    ["1", "2", ""],
  ]);
  assert.deepEqual(tableShape("| a | b | c |\n| --- | --- | --- |\n| | | |\n"), [
    ["a", "b", "c"],
    ["", "", ""],
  ]);
});

test("表头格子是 th、表体是 td——空槽的格子与有内容的格子同类", () => {
  const host = render("| | b |\n| --- | --- |\n| 1 |  |\n");
  const rows = host.findTag("tr");
  assert.deepEqual(
    rows[0].children.map((cell) => cell.tagName),
    ["th", "th"],
  );
  assert.deepEqual(
    rows[1].children.map((cell) => cell.tagName),
    ["td", "td"],
  );
});

test("表体格数多于 delimiter 行：不吃掉 parser 已产出的格，整表按更宽的列数等宽", () => {
  // 口径登记：GFM 对多列是 excess ignored（静默丢列）。面板在这里选**不丢**——渲染器不吞
  // parser 已产出的 cell，同时保持「每行等宽」这条不变量（多出来的那格落在尾部空槽）。
  assert.deepEqual(tableShape("| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 | 4 |\n"), [
    ["a", "b", "c", ""],
    ["1", "2", "3", "4"],
  ]);
});

test("属性：任意列数与任意空槽位置下，每行格数守恒且等于表头列数", () => {
  for (let cols = 1; cols <= 5; cols++) {
    const align = Array.from({ length: cols }, () => "---");
    const body = Array.from({ length: cols }, (_, i) => `b${i}`);
    // 2^cols 种「哪几列是空槽」的组合（含全空、全实）。
    for (let mask = 0; mask < 1 << cols; mask++) {
      const header = Array.from({ length: cols }, (_, i) => ((mask >> i) & 1 ? `h${i}` : ""));
      const source = `| ${header.join(" | ")} |\n| ${align.join(" | ")} |\n| ${body.join(" | ")} |\n`;
      const shape = tableShape(source);
      assert.deepEqual(shape, [header, body], `cols=${cols} mask=${mask.toString(2)}：${source}`);
      for (const row of shape) {
        assert.equal(row.length, cols, `cols=${cols} mask=${mask.toString(2)}：每行恒 ${cols} 格`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// change harness-path-link：正文里的 vault 路径可点（真渲染件 + 最小 DOM 替身）
// ---------------------------------------------------------------------------

test("命中文件索引的路径产可点元素，可见文本逐字不变；点击把 path/行号交给装配层", () => {
  const { ctx, opened } = pathCtx("notes/a.md");
  const host = render("见 notes/a.md:12 完", ctx);
  const links = host.find("lumir-hp-pathlink");
  assert.equal(links.length, 1);
  assert.equal(links[0].tagName, "button");
  assert.equal(links[0].textContent, "notes/a.md:12", "展示文本含行号后缀，且不重写原文");
  assert.equal(host.textContent, "见 notes/a.md:12 完", "周围文本逐字不变");
  fire(links[0], "click");
  assert.deepEqual(opened, [["notes/a.md", 12]]);
});

test("未命中索引的路径仍是文本节点（反向对照）", () => {
  const { ctx } = pathCtx("notes/other.md");
  const host = render("见 notes/a.md 完", ctx);
  assert.equal(host.find("lumir-hp-pathlink").length, 0);
  assert.equal(host.textContent, "见 notes/a.md 完");
});

test("中文行文紧贴路径时只链接路径本身（见路径 / 路径的）", () => {
  const { ctx } = pathCtx("中文/笔记.md");
  const host = render("详见中文/笔记.md的内容", ctx);
  const links = host.find("lumir-hp-pathlink");
  assert.equal(links.length, 1);
  assert.equal(links[0].textContent, "中文/笔记.md");
  assert.equal(host.textContent, "详见中文/笔记.md的内容");
});

test("行内代码里的路径可点（起草期取值 2）；围栏代码块里的同形文本不可点", () => {
  const { ctx } = pathCtx("notes/a.md");
  const inline = render("见 `notes/a.md` 完", ctx);
  assert.equal(inline.find("lumir-hp-pathlink").length, 1);
  assert.equal(inline.find("lumir-hp-pathlink")[0].textContent, "notes/a.md");

  const fenced = render("```\nnotes/a.md\n```\n", ctx);
  assert.equal(fenced.find("lumir-hp-pathlink").length, 0, "代码块优先保证复制与选择手感");
  assert.equal(fenced.textContent, "notes/a.md");
});

test("锚内文本不产第二个可点元素（不产嵌套锚）", () => {
  const { ctx } = pathCtx("notes/a.md");
  const host = render("[看 notes/a.md](https://example.com)", ctx);
  assert.equal(host.find("lumir-hp-link").length, 1);
  assert.equal(host.find("lumir-hp-pathlink").length, 0);
  assert.equal(host.find("lumir-hp-link")[0].textContent, "看 notes/a.md");
});

test("表格 cell / 标题 / 列表项里的路径同样在列", () => {
  const { ctx } = pathCtx("notes/a.md");
  const table = render("| 位置 |\n|---|\n| notes/a.md |", ctx);
  assert.equal(table.findTag("td")[0].find("lumir-hp-pathlink").length, 1);

  const heading = render("# 见 notes/a.md", ctx);
  assert.equal(heading.find("lumir-hp-pathlink").length, 1);

  const list = render("- 见 notes/a.md", ctx);
  assert.equal(list.find("lumir-hp-pathlink").length, 1);
});

test("同一段里的多个路径按出现序产出，行号各自独立", () => {
  const { ctx, opened } = pathCtx("a.md", "notes/b.md");
  const host = render("先 a.md，再看 notes/b.md:3", ctx);
  const links = host.find("lumir-hp-pathlink");
  assert.deepEqual(
    links.map((el) => el.textContent),
    ["a.md", "notes/b.md:3"],
  );
  fire(links[1], "click");
  assert.deepEqual(opened, [["notes/b.md", 3]]);
});

test("Enter 键与点击同一出口；无行号时 open 收到 undefined", () => {
  const { ctx, opened } = pathCtx("a.md");
  const host = render("见 a.md", ctx);
  const link = host.find("lumir-hp-pathlink")[0];
  fire(link, "keydown", { key: "Enter" });
  assert.deepEqual(opened, [["a.md", undefined]]);
});

// ---------------------------------------------------------------------------
// change add-path-line-range-links：`:起-止` 行范围（渲染面）
// ---------------------------------------------------------------------------

test("行范围引用渲染成**一个**可点元素，文本逐字不变、点击只交出起始行", () => {
  const { ctx, opened } = pathCtx("notes/a.md");
  const source = "见 notes/a.md:12-40 完";
  const host = render(source, ctx);
  const links = host.find("lumir-hp-pathlink");
  assert.equal(links.length, 1, "整段一个元素，不按 `-` 或 `:` 拆成两个");
  assert.equal(links[0].tagName, "button");
  assert.equal(links[0].textContent, "notes/a.md:12-40", "展示文本含整个后缀，不重写原文");
  assert.equal(host.textContent, source, "周围文本逐字不变");
  fire(links[0], "click");
  assert.deepEqual(opened, [["notes/a.md", 12]], "落点 = 起；止不进装配层");
  fire(links[0], "keydown", { key: "Enter" });
  assert.deepEqual(opened, [
    ["notes/a.md", 12],
    ["notes/a.md", 12],
  ]);

  // 行内代码里的行范围同样在列（与既有路径链接同一宿主面）。
  const inline = render("见 `notes/a.md:12-40` 完", ctx);
  const inlineLinks = inline.find("lumir-hp-pathlink");
  assert.equal(inlineLinks.length, 1);
  assert.equal(inlineLinks[0].textContent, "notes/a.md:12-40");
});

test("畸形行范围只链接路径本身（点击不带行落点）", () => {
  const { ctx, opened } = pathCtx("notes/a.md");
  for (const [source, why] of [
    ["见 notes/a.md:40-12 完", "止 < 起"],
    ["见 notes/a.md:12- 完", "缺止段"],
    ["见 notes/a.md:9-12-15 完", "三段"],
  ] as Array<[string, string]>) {
    const host = render(source, ctx);
    const links = host.find("lumir-hp-pathlink");
    assert.equal(links.length, 1, `${source}：路径本身可点`);
    assert.equal(links[0].textContent, "notes/a.md", `${source}：${why} ⇒ 可点范围止于路径`);
    assert.equal(host.textContent, source, "后缀留作普通文本，逐字不变");
  }
  fire(render("见 notes/a.md:40-12 完", ctx).find("lumir-hp-pathlink")[0], "click");
  assert.deepEqual(opened.at(-1), ["notes/a.md", undefined], "不产行落点");
});

test("同一源两次渲染结果一致（流式尾块每帧重渲的确定性）", () => {
  const { ctx } = pathCtx("notes/a.md", "b.md");
  const source = "见 notes/a.md:3 与 b.md，再看 c.md 完";
  const first = render(source, ctx);
  const second = render(source, ctx);
  assert.equal(first.textContent, second.textContent);
  assert.deepEqual(
    first.find("lumir-hp-pathlink").map((el) => el.textContent),
    second.find("lumir-hp-pathlink").map((el) => el.textContent),
  );
  assert.deepEqual(
    first.find("lumir-hp-pathlink").map((el) => el.textContent),
    ["notes/a.md:3", "b.md"],
  );
});

// ---------------------------------------------------------------------------
// change harness-dir-link：目录引用 → 左栏定位（与文件链接共用同一元素形态）
// ---------------------------------------------------------------------------

test("目录模型命中的路径产可点元素，点击走定位（不开文件）", () => {
  const { ctx, opened, revealed } = dirCtx("projects/plans");
  const host = render("见 projects/plans 目录", ctx);
  const links = host.find("lumir-hp-pathlink");
  assert.equal(links.length, 1);
  assert.equal(links[0].textContent, "projects/plans");
  fire(links[0], "click");
  assert.deepEqual(revealed, ["projects/plans"], "目录点击只定位");
  assert.deepEqual(opened, [], "目录点击 MUST NOT 打开文档");
  fire(links[0], "keydown", { key: "Enter" });
  assert.deepEqual(revealed, ["projects/plans", "projects/plans"], "Enter 与点击同一出口");
});

test("尾斜杠目录引用：展示文本逐字保留，定位路径去掉尾斜杠", () => {
  const { ctx, revealed } = dirCtx("projects/plans");
  const host = render("见 projects/plans/ 目录", ctx);
  const links = host.find("lumir-hp-pathlink");
  assert.equal(links.length, 1);
  assert.equal(links[0].textContent, "projects/plans/");
  fire(links[0], "click");
  assert.deepEqual(revealed, ["projects/plans"]);
});

test("目录引用不消费行号后缀：只链接目录本身，:12 留作文本", () => {
  const { ctx, revealed } = dirCtx("projects/plans");
  const host = render("见 projects/plans:12 结束", ctx);
  const links = host.find("lumir-hp-pathlink");
  assert.equal(links.length, 1);
  assert.equal(links[0].textContent, "projects/plans");
  assert.equal(host.textContent, "见 projects/plans:12 结束");
  fire(links[0], "click");
  assert.deepEqual(revealed, ["projects/plans"]);
});

test("目录不在模型里时仍是文本（反向对照）；文件优先于目录的解析顺序可判", () => {
  const missing = render("见 projects/plans 完", dirCtx("projects/other").ctx);
  assert.equal(missing.find("lumir-hp-pathlink").length, 0);

  // 同一路径同时出现在两份索引里（真实 vault 不可能）：文件先判，点击走打开。
  const both = pathCtxWith(["docs/x"], ["docs/x"]);
  const host = render("见 docs/x", both.ctx);
  fire(host.find("lumir-hp-pathlink")[0], "click");
  assert.deepEqual(both.opened, [["docs/x", undefined]]);
  assert.deepEqual(both.revealed, []);
});

// ---------------------------------------------------------------------------
// 块级全屏入口（M634，change add-harness-block-fullscreen）
//
// 判据落在三处：入口**结构**（slot + 悬停钮、读屏名取既有词条）、**消息内序号**（D5：只数
// 同类块，跨消息重数）、**流式口径的入口事实**（围栏未闭合没有钮——@lezer/markdown 把未闭合
// 围栏也解析成 FencedCode，判据因此是块的尾 CodeMark，不是「有没有节点」）。
// 点击交出的内容（呈现计划 / 表格元素）由端口替身接住逐项断言；遮罩开合本身归视觉场景与
// 真机验收（本层不造遮罩 DOM）。
// ---------------------------------------------------------------------------

interface OpenedBlock {
  kind: "code" | "table";
  label: string;
  render?: CodeBlockRender;
  table?: FakeEl;
}

/** 块级全屏端口替身：记录每次打开请求（面板侧的 `openCodeBlock` / `openTable`）。 */
function fakeBlockOpeners(): { opened: OpenedBlock[]; openers: HarnessBlockOpeners } {
  const opened: OpenedBlock[] = [];
  const openers: HarnessBlockOpeners = {
    code: (render, label) => void opened.push({ kind: "code", label, render }),
    table: (source, label) => void opened.push({ kind: "table", label, table: source as unknown as FakeEl }),
  };
  return { opened, openers };
}

/** 一条消息根（`.lumir-hp-msg`）：序号判据从块容器向上找它。 */
function messageHost(): FakeEl {
  const msg = withClassName(new FakeEl("div"));
  msg.className = "lumir-hp-msg";
  return msg;
}

test("围栏代码块：包 slot + 悬停钮（读屏名取 D156），点击交出整块源码的呈现计划", () => {
  const { opened, openers } = fakeBlockOpeners();
  const host = render("前文\n\n```js\nconst a = 1\n```\n", undefined, openers);

  const slots = host.find("lumir-hp-block-slot");
  assert.equal(slots.length, 1, "围栏代码块必须包一层定位容器（全屏钮的包含块）");
  const slots2 = host.find("lumir-hp-block-slot");
  assert.deepEqual(slots2[0].dataset.hpBlock, "code", "slot 标记块类型（序号与断言共用）");
  const buttons = host.find("lumir-hp-block-fs-trigger");
  assert.equal(buttons.length, 1, "每个块一个悬停钮");
  assert.equal(buttons[0].tagName, "button");
  assert.equal(buttons[0].attrs.get("aria-label"), t("D156"), "钮面读屏名与 content pane 同一词条");
  assert.equal(buttons[0].classes.has("lumir-block-trigger"), true, "形态取共享类（不另写一套壳）");
  assert.equal(slots[0].find("lumir-hp-codeblock").length, 1, "块本体在 slot 内、内容照常上屏");

  fire(buttons[0], "click");
  assert.equal(opened.length, 1);
  assert.equal(opened[0].kind, "code");
  assert.equal(opened[0].label, t("D212", { index: 1 }), "遮罩读屏名 = Markdown 代码块 1");
  const render0 = opened[0].render;
  assert.ok(render0 !== undefined && render0.kind === "lines");
  assert.equal(render0.lines[0].text, "```js", "首行（围栏）是头部条");
  assert.equal(render0.lines[0].head, true);
  assert.equal(render0.lines[1].text, "const a = 1", "内容行逐字交给遮罩（快照源自块源码）");
});

test("缩进代码块：同样有入口，且没有头部条（与 content pane 逐项同口径）", () => {
  const { opened, openers } = fakeBlockOpeners();
  const host = render("段落\n\n    indented one\n    indented two\n", undefined, openers);

  const buttons = host.find("lumir-hp-block-fs-trigger");
  assert.equal(buttons.length, 1);
  fire(buttons[0], "click");
  const render0 = opened[0].render;
  assert.ok(render0 !== undefined && render0.kind === "lines");
  assert.equal(render0.lines.some((line) => line.head), false, "缩进块没有围栏行 ⇒ 没有头部条");
  assert.equal(render0.lines[0].text, "    indented one", "源码逐字（含语法缩进）");
});

test("表格：包 slot + 悬停钮（读屏名取 D124），点击交出渲染出的 <table> 与消息内序号", () => {
  const { opened, openers } = fakeBlockOpeners();
  const host = render("| 列 |\n|---|\n| 甲 |\n", undefined, openers);

  const buttons = host.find("lumir-hp-block-fs-trigger");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].attrs.get("aria-label"), t("D124"), "表格钮与 content pane 同一词条");
  fire(buttons[0], "click");

  assert.equal(opened.length, 1);
  assert.equal(opened[0].kind, "table");
  assert.equal(opened[0].label, t("D211", { index: 1 }), "遮罩读屏名 = Markdown 表格 1");
  assert.equal(opened[0].table?.tagName, "table", "深克隆的源就是这个渲染出的表格");
  assert.equal(opened[0].table?.classes.has("lumir-hp-table"), true, "结构样式随元素走（遮罩里不脱样式）");
});

test("消息内序号（D5）：只数同类块、1-based、跨消息重数", () => {
  // 第一条消息：表格 / 代码块 / 表格 —— 表格编号 1、2，代码块不占表格号。
  const first = messageHost();
  const body = withClassName(new FakeEl("div"));
  body.className = "lumir-hp-body";
  first.append(body);
  const open1 = fakeBlockOpeners();
  render("| a |\n|---|\n| 1 |\n\n```js\nx\n```\n\n| b |\n|---|\n| 2 |\n", undefined, open1.openers, body);
  for (const button of body.find("lumir-hp-block-fs-trigger")) fire(button, "click");
  assert.deepEqual(
    open1.opened.map((item) => item.label),
    [t("D211", { index: 1 }), t("D212", { index: 1 }), t("D211", { index: 2 })],
    "表格只数表格：第二张表是 2，中间那块代码块不占表格号",
  );

  // 第二条消息：编号重数。
  const second = messageHost();
  const body2 = withClassName(new FakeEl("div"));
  body2.className = "lumir-hp-body";
  second.append(body2);
  const open2 = fakeBlockOpeners();
  render("| c |\n|---|\n| 3 |\n", undefined, open2.openers, body2);
  fire(body2.find("lumir-hp-block-fs-trigger")[0], "click");
  assert.equal(open2.opened[0].label, t("D211", { index: 1 }), "序号按消息重数，不累加");
});

test("围栏未闭合（流式片段）没有入口；闭合那一帧起钮出现", () => {
  const open = fakeBlockOpeners();
  const streaming = render("```js\nconst a = 1", undefined, open.openers);
  assert.equal(streaming.find("lumir-hp-codeblock").length, 1, "未闭合围栏照常按代码块上屏");
  assert.equal(streaming.find("lumir-hp-block-fs-trigger").length, 0, "未闭合围栏不得有全屏钮");

  const closed = render("```js\nconst a = 1\n```", undefined, open.openers);
  assert.equal(closed.find("lumir-hp-block-fs-trigger").length, 1, "闭合后同一块出现入口");
});

test("块内既有交互不受入口影响：表格 cell 里的路径链接仍在、点击照常到达落点", () => {
  const { ctx, opened } = pathCtx("projects/plans");
  const host = render("| 列 |\n|---|\n| projects/plans |\n", ctx, fakeBlockOpeners().openers);
  const links = host.find("lumir-hp-pathlink");
  assert.equal(links.length, 1, "路径链接的数量与之前逐值相同（slot 只包一层，不改行内渲染）");
  fire(links[0], "click");
  assert.deepEqual(opened, [["projects/plans", undefined]]);
});
