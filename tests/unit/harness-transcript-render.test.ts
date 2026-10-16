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
import { formatDate } from "../../src/copy.ts";
import { renderMarkdownInto, whenTextOf } from "../../src/harness-panel.ts";

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
}

function installFakeDom(): void {
  (globalThis as unknown as Record<string, unknown>).document = {
    createElement: (tag: string) => {
      const el = new FakeEl(tag);
      // `el.className = "a b"` 的赋值入口：替身把它落进类集合（find 按类名找）。
      Object.defineProperty(el, "className", {
        get: () => el.classNameValue,
        set: (value: string) => {
          el.classes.clear();
          for (const name of value.split(/\s+/).filter(Boolean)) el.classes.add(name);
        },
      });
      return el;
    },
    createTextNode: (text: string) => {
      const node = new FakeEl("#text", TEXT_NODE);
      node.textContent = text;
      return node;
    },
  };
}

/** 一段 Markdown → 渲染出的 DOM 根（真渲染件 + 替身 DOM）。 */
function render(source: string): FakeEl {
  installFakeDom();
  const host = new FakeEl("div");
  renderMarkdownInto(host as unknown as HTMLElement, source);
  return host;
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
