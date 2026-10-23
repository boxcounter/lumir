// frontmatter properties 区块（frontmatter-properties capability）。
// 检测文档首部 --- 包围块，用 js-yaml 解析（裁决点 E 推荐项，不自造 YAML 子集），
// 渲染为键值表格 replace widget；tags 以标签形态展示，status 以语义 chip 展示，嵌套值以
// JSON 样式展示。解析失败回退：原文完整保留显示 + 人话提示（spec「解析失败回退」）。
//
// 形态口径（change restyle-ui-tokens-v1，R2b）：渲染结构不变（仍是键值表格 + 标签 + chip），
// 换的是样式与**值的呈现档位**——字段名 mono 11px 提示档灰、值 13px 正文色、整块为
// agent-bg 浅底圆角属性区（样式在 src/preview/theme.ts 的 `.cm-lp-frontmatter` / `.fm-*`）。
// status 的「值 → 语义档」映射不在本模块（只把原值写进 data-fm-status，映射表在 CSS 侧），
// 因此本模块不承担口径会变的那部分知识。
//
// 光标面（change cursor-visibility-oct23，合同 docs/specs/editor-caret.md）：本模块是
// frontmatter 块范围、指针入口与边界光标规范化的**唯一**出处——
//   · `frontmatterBlockField`：块范围的单一检测场（装饰层与光标规范化共读）；
//   · `firstBodyLineStart`：以 fm 开头的文档的初始光标（装载路径用）；
//   · `normalizeFrontmatterCaret`：边界空光标的规范化（focus / 合成面点击 / 装载共用）；
//   · `FrontmatterWidget` 的 mousedown 路由：properties 盒进 YAML 源码、合成面只聚焦。

import { load as parseYaml } from "js-yaml";
import { EditorSelection, StateField } from "@codemirror/state";
import type { Text, Transaction, TransactionSpec } from "@codemirror/state";
import { WidgetType } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { buildDocTitleDOM, sameDocTitleData } from "./doc-title";
import type { DocTitleData } from "./doc-title";
import { enterReplacedSource } from "./replaced-source";
import { touchesSource } from "./reveal-gate";
import { trustedLoad } from "../editor-annotations";
import { t } from "../copy";

/**
 * fm-outer 携带 doc-title 时的修饰 class（M222 回归 2 修复：title 折叠进 fm widget，
 * theme.ts 据此把 fm 盒下的 20px 间距从 -outer 的 paddingBottom 挪给 title 的 paddingTop）。
 * 取值被 tests/unit/doc-title-placement.test.ts 钉死。
 */
export const FRONTMATTER_HAS_TITLE_CLASS = "cm-lp-frontmatter-has-title";

export interface FrontmatterBlock {
  /** 整块（含两条 --- 围栏行）在文档中的范围。 */
  from: number;
  to: number;
  /** 围栏之间的 YAML 原文。 */
  inner: string;
}

/**
 * frontmatter 扫行上限：开围栏行之后最多再检查这么多行。**单一常量**（M152 收口，
 * 原值两处不同：frontmatter.ts 512 / wikilinks.ts 200）。
 * 取 **512** 的论证（把词法层的排除区对齐到渲染层，而不是反过来）：
 * - 512 是有意的产品口径，不是漂移出来的数——5041f63 专门把本文件的 200 抬到 512，并在
 *   同一次提交里加了 208 行的 fixture（tests/visual/fixtures/markdown-combo/frontmatter-200.md）
 *   与断言「超过 200 行仍渲染 properties 区块」（markdown-combo.spec.ts 的 key204 上屏）；
 * - 反之取 200 等于回退那次决策：201–512 行的 frontmatter 不再渲染区块，属产品行为变更，
 *   不是清扫范围；
 * - 排除区与渲染层必须同口径：wikilink 排除的范围就是「properties 区块盖住的那段文字」。
 *   改动前两者不同口径（512 vs 200），后果是 >200 行区块里「看不见却能激活」的链接。
 * 跨语言同口径已闭合（M469，2026-10-12）：Rust 的 link_graph.rs 上限已对齐 512，
 * 并有机械单测 frontmatter_limit_matches_ts_constant 读本文件抓值断言两侧一致。
 */
export const MAX_FRONTMATTER_LINES = 512;

/**
 * frontmatter 检测所需的行视图。CM 的 `Text` 结构上直接满足（`lines` + `line(n)`），
 * 纯字符串侧用 textLineView 适配——检测逻辑因此只有一份，装饰层与 wikilink 排除区
 * 不会各扫一遍、各得一个答案。
 */
export interface FrontmatterLineView {
  readonly lines: number;
  line(n: number): { from: number; to: number; text: string };
}

/** 纯字符串的行视图适配（偏移口径与 CM 的 Text 一致：`to` 不含换行符）。 */
export function textLineView(text: string): FrontmatterLineView {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return {
    lines: starts.length,
    line(n) {
      const from = starts[n - 1];
      const to = n < starts.length ? starts[n] - 1 : text.length;
      return { from, to, text: text.slice(from, to) };
    },
  };
}

/** frontmatter 围栏范围；closeLine 是闭合围栏行号（1 基，消费方据此续扫或取 inner 右界）。 */
export interface FrontmatterRange {
  from: number;
  to: number;
  closeLine: number;
}

/**
 * 检测文档首部 frontmatter 的围栏范围：首行 trim 后为 `---`，其后 MAX_FRONTMATTER_LINES
 * 行内出现 `---` / `...` 闭合行即成立；无或未闭合返回 null（扫描有界——未闭合的 --- 不会
 * 导致全文档扫描）。装饰层（本模块的 properties 区块）与 wikilinks.ts 的排除区共用此检测：
 * 同一份判定、同一个上限，两层对同一条链接不会给出不同答案。
 */
export function scanFrontmatter(source: FrontmatterLineView): FrontmatterRange | null {
  if (source.lines < 2 || source.line(1).text.trim() !== "---") return null;
  const last = Math.min(source.lines, MAX_FRONTMATTER_LINES + 1);
  for (let n = 2; n <= last; n++) {
    const line = source.line(n);
    const t = line.text.trim();
    if (t === "---" || t === "...") {
      return { from: source.line(1).from, to: line.to, closeLine: n };
    }
  }
  return null;
}

/** 检测文档首部 frontmatter；无（或未闭合）返回 null。 */
export function detectFrontmatter(doc: Text): FrontmatterBlock | null {
  const range = scanFrontmatter(doc);
  if (range === null) return null;
  return { from: range.from, to: range.to, inner: doc.sliceString(doc.line(1).to + 1, doc.line(range.closeLine).from) };
}

/**
 * 以 fm 开头的 md 文档的初始光标：闭围栏行之后第一行的行首；没有下一行返回 null。
 *
 * `fm.to` 不含换行：`doc.length` 大于它时存在下一行（含末空行——末空行仍有正常行高，
 * M399，光标画在它上面就是一个正常行盒）。输入是 CM 的 `Text`（`lineAt` 是 O(log n)），
 * 不在装载路径上构造全量行数组（打开 1MB 文档的性能路径，ADR 0002 §6）。
 */
export function firstBodyLineStart(doc: Text, fm: { from: number; to: number }): number | null {
  return fm.to < doc.length ? doc.lineAt(fm.to + 1).from : null;
}

/**
 * frontmatter 块的**单一检测场**（change cursor-visibility-oct23 的 C3 兜底）：
 * `create` 与 `docChanged` 时扫一次首部（≤512 行），其余帧 O(1)。
 *
 * 此前的检测分散在装饰层每次 update 里（`frontmatterSet` 自己 `detectFrontmatter`）；
 * 边界光标的焦点 / 事务规范化也要读同一个块范围，各扫一份就成两处真源（REVIEW.md
 * 「同一语义两处真源」条）。扩展组里必须排在 frontmatter 装饰**之前**——后者 `create`
 * 时就要读它。
 */
export const frontmatterBlockField = StateField.define<FrontmatterBlock | null>({
  create(state) {
    return detectFrontmatter(state.doc);
  },
  update(value, tr) {
    return tr.docChanged ? detectFrontmatter(tr.state.doc) : value;
  },
});

/**
 * 把「已渲染 frontmatter 块边界上的空光标」规范化到一条可见源码行（C3 的聚焦 / 事务
 * 共用实现，调用方是 livePreview 的 focus 处理器、widget 的合成面分支与装载路径）。
 *
 * 触发面刻意收窄：只处理**空光标且恰在 `fm.from` / `fm.to`** 的情形——
 *   · 块内位置已被严格重叠显露（源码可见，光标本来就画在可见行上）；
 *   · 块外位置与 frontmatter 无关；
 *   · 非空选区走显露（严格重叠负责撤下 widget，head 落在可见行）；
 *   · 块当前已显露（`touchesSource`）时再挪光标会把编辑态顶走——不动。
 * 规则：有正文行 → 正文首行；没有正文行 → 按边界侧推进块内一个字符（严格重叠成立，
 * 显露源码）。只改选区、不滚动、不改文档。
 */
export function normalizeFrontmatterCaret(view: EditorView): void {
  const fm = view.state.field(frontmatterBlockField, false);
  if (!fm) return;
  const sel = view.state.selection.main;
  if (!sel.empty) return;
  const head = sel.head;
  if (head !== fm.from && head !== fm.to) return;
  if (touchesSource(view.state, fm.from, fm.to)) return;
  const body = firstBodyLineStart(view.state.doc, fm);
  const target = body ?? (head === fm.from ? fm.from + 1 : fm.to - 1);
  view.dispatch({ selection: { anchor: target } });
}

function renderValue(v: unknown): string {
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return String(v);
}

function tagList(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
}

/**
 * frontmatter 边界光标的事务级兜底（合同 C3 / C4，change cursor-visibility-oct23）。
 *
 * goto-line、程序化选区、指针落点都可能把空光标直接放到已渲染 frontmatter 块的边界上
 * （`fm.from` / `fm.to`）——那里 CM 按整块 widget 的包围盒画光标（一条贯穿 properties +
 * doc-title 的竖线）。指针落在 properties 盒的路径由 widget 的 mousedown 显式 dispatch 到
 * 块内，不经过本分支；落在标题 / 纯装饰 padding 的路径只聚焦、由聚焦规范化处理。
 *
 * 按来源分流：
 *   · 垂直移动事务 → 推进块内一个字符（严格重叠成立，显露源码；C4）；
 *   · 其它事务 → 正文首行（C3；无正文行时同样推进块内）。
 * 装载事务（`trustedLoad`）原样放行——装载路径自己把初始光标放到正文首行，若在这里改，
 * 「打开只有 frontmatter 的文档」会立刻变成源码（design §3.3.1 的已知边界）。
 * 第二个事务的选区已不在边界（正文首行或块内），不会自我循环。
 *
 * 纯函数（入参只有事务），单测直接钉判定矩阵（tests/unit/frontmatter-caret.test.ts）。
 */
export function frontmatterCaretSpecs(tr: Transaction): readonly TransactionSpec[] | Transaction {
  const fm = tr.state.field(frontmatterBlockField, false);
  if (!fm) return tr;
  // 本事务**没有设置选区**时一律放行：`tr.newSelection` 此时等于「当前选区」，而当前选区
  // 恰好停在块边界（装载复位的 0）是常态——effects-only 的事务（滚动快照、previewRefresh、
  // 装饰刷新）若被当成「把光标放到边界」，打开只有 frontmatter 的文档就会自动变源码。
  if (!tr.selection) return tr;
  const sel = tr.newSelection.main;
  if (!sel.empty) return tr;
  const head = sel.head;
  if (head !== fm.from && head !== fm.to) return tr;
  if (tr.annotation(trustedLoad)) return tr;
  const inward = head === fm.from ? fm.from + 1 : fm.to - 1;
  const vertical = tr.isUserEvent("move.line.up") || tr.isUserEvent("move.line.down");
  const target = vertical ? inward : (firstBodyLineStart(tr.state.doc, fm) ?? inward);
  return [tr, { selection: EditorSelection.single(target) }];
}

export class FrontmatterWidget extends WidgetType {
  // 不用构造器参数属性：tests/unit 直接跑 src 源码（Node 类型剥离不支持参数属性，
  // 那是会生成代码的语法而不是纯类型标注——endMarker.ts 同口径；M222 起本文件被
  // doc-title 合同测试经 detectFrontmatter 直接 import）。
  readonly inner: string;
  /** 折叠进 outer 的 doc-title 数据（M222 回归 2 修复）；无 title 时为 null。 */
  readonly title: DocTitleData | null;

  constructor(inner: string, title: DocTitleData | null = null) {
    super();
    this.inner = inner;
    this.title = title;
  }

  eq(other: FrontmatterWidget): boolean {
    return other.inner === this.inner && sameDocTitleData(other.title, this.title);
  }

  toDOM(view: EditorView): HTMLElement {
    // 纵向间距由 -outer 的 padding 承载（CM 测量的 widget 高度不含 margin），
    // 视觉边框/背景/圆角保持在内层 .cm-lp-frontmatter 上。
    const outer = document.createElement("div");
    outer.className = "cm-lp-frontmatter-outer";
    outer.append(this.buildBox());
    if (this.title !== null) {
      outer.classList.add(FRONTMATTER_HAS_TITLE_CLASS);
      outer.append(buildDocTitleDOM(this.title));
    }
    // 指针入口（C2）：widget 内的事件 CM 默认不处理（`ignoreEvent` 返回 true），所以
    // 监听直接挂在 widget 根节点上；路由见 routeMouseDown。
    outer.addEventListener("mousedown", (event) => {
      this.routeMouseDown(event, view, outer);
    });
    return outer;
  }

  /**
   * 按下路由（D1=A）：properties 盒（含 tags / status chip 与解析失败回退块）是源码的
   * 渲染面 → 进 YAML 源码、落在点击行；doc-title 与纯装饰 padding 是**合成面**、没有
   * 对应源码 → 只把焦点交给编辑器，光标按 C3 规范化，不把光标放进 YAML。
   *
   * 绝对位置不存进 widget（会随文档漂移成第二处真源）：`from` 用 widget 根节点在运行期
   * 取块起点，内层区间按运行期文档算。
   */
  private routeMouseDown(event: MouseEvent, view: EditorView, outer: HTMLElement): void {
    if (event.button !== 0) return;
    const fm = view.state.field(frontmatterBlockField, false);
    if (!fm) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target !== null && target.closest(".cm-lp-frontmatter") !== null) {
      const from = view.posAtDOM(outer);
      const innerFrom = view.state.doc.line(1).to + 1 - from; // 跳过开围栏行
      const innerTo = view.state.doc.lineAt(fm.to).from - from; // 收在闭围栏行之前
      enterReplacedSource(event, view, outer, innerFrom, innerTo);
      return;
    }
    // 合成面：preventDefault 挡住原生 caret 进入 contenteditable=false 岛（M112 的机理，
    // 见 replaced-source.ts 文件头）。编辑器**已经聚焦**时点标题不会再触发 focus 事件，
    // 只靠 focus 处理器会漏掉这一支，所以这里显式规范化。
    event.preventDefault();
    view.focus();
    normalizeFrontmatterCaret(view);
  }

  private buildBox(): HTMLElement {
    const box = document.createElement("div");
    box.className = "cm-lp-frontmatter";

    let value: unknown;
    try {
      value = parseYaml(this.inner);
    } catch (e) {
      return this.fallback(box, t("D36", { reason: e instanceof Error ? e.message.split("\n")[0] : String(e) }));
    }
    if (value === null || value === undefined) {
      const empty = document.createElement("div");
      empty.className = "cm-lp-fm-empty";
      empty.textContent = t("D37");
      box.append(empty);
      return box;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      return this.fallback(box, t("D38"));
    }

    const table = document.createElement("table");
    table.className = "cm-lp-fm-table";
    for (const [key, v] of Object.entries(value)) {
      const row = document.createElement("tr");
      const keyCell = document.createElement("td");
      keyCell.className = "cm-lp-fm-key";
      keyCell.textContent = key;
      const valueCell = document.createElement("td");
      valueCell.className = "cm-lp-fm-value";
      if (key === "tags") {
        for (const tag of tagList(v)) {
          const chip = document.createElement("span");
          chip.className = "cm-lp-tag";
          chip.textContent = tag;
          valueCell.append(chip);
        }
      } else if (key === "status") {
        // status 的值不渲染裸字符串，渲染成语义 chip（restyle R2b 的 `.fm` 形态）。
        // 这里只出「chip 元素 + 原值」：值 → 语义档（ok / pending / danger / 中性兜底）的映射
        // 表在 CSS 侧（theme.ts 的 `.cm-lp-fm-status[data-fm-status=…]`），本模块不判语义——
        // 判定逻辑与取值清单只此一份，且不把「哪几个词算哪种状态」这种会变的口径写进构建路径。
        const chip = document.createElement("span");
        chip.className = "cm-lp-fm-status";
        chip.dataset.fmStatus = renderValue(v).trim().toLowerCase();
        chip.textContent = renderValue(v);
        valueCell.append(chip);
      } else {
        valueCell.textContent = renderValue(v);
      }
      row.append(keyCell, valueCell);
      table.append(row);
    }
    box.append(table);
    return box;
  }

  /** 回退：提示 + 原文完整保留（含围栏），不丢弃、不截断。 */
  private fallback(box: HTMLElement, hint: string): HTMLElement {
    const err = document.createElement("div");
    err.className = "cm-lp-fm-error";
    err.textContent = hint;
    const raw = document.createElement("pre");
    raw.className = "cm-lp-fm-raw";
    raw.textContent = `---\n${this.inner}---`;
    box.append(err, raw);
    return box;
  }
}
