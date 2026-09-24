// frontmatter properties 区块（frontmatter-properties capability）。
// 检测文档首部 --- 包围块，用 js-yaml 解析（裁决点 E 推荐项，不自造 YAML 子集），
// 渲染为键值表格 replace widget；tags 以标签形态展示，status 以语义 chip 展示，嵌套值以
// JSON 样式展示。解析失败回退：原文完整保留显示 + 人话提示（spec「解析失败回退」）。
//
// 形态口径（change restyle-ui-tokens-v1，R2b）：渲染结构不变（仍是键值表格 + 标签 + chip），
// 换的是样式与**值的呈现档位**——字段名 mono 11px 提示档灰、值 13px 正文色、整块为
// agent-bg 浅底圆角属性区（样式在 src/preview/theme.ts 的 `.cm-lp-frontmatter` / `.fm-*`）。
// status 的「值 → 语义档」映射不在本模块（只把原值写进 data-fm-status，映射表在 CSS 侧），
// 因此本模块不承担口径会变的那部分知识。构建逻辑（扫描上限、检测、StateField 装配时机）
// 本 change 零改动。

import { load as parseYaml } from "js-yaml";
import { WidgetType } from "@codemirror/view";
import type { Text } from "@codemirror/state";

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
 * 已知残留：Rust 的 link_graph.rs 仍自带一份 200（本 mission 未碰 Rust），201–512 行这一段
 * 两侧口径仍不同——改动前即如此，已另发 finding 建议对齐（或经 bindings 单向下发）。
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

function renderValue(v: unknown): string {
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return String(v);
}

function tagList(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
}

export class FrontmatterWidget extends WidgetType {
  constructor(readonly inner: string, readonly selected = false) {
    super();
  }

  eq(other: FrontmatterWidget): boolean {
    return other.inner === this.inner && other.selected === this.selected;
  }

  toDOM(): HTMLElement {
    // 纵向间距由 -outer 的 padding 承载（CM 测量的 widget 高度不含 margin），
    // 视觉边框/背景/圆角保持在内层 .cm-lp-frontmatter 上。
    const outer = document.createElement("div");
    outer.className = "cm-lp-frontmatter-outer";
    outer.append(this.buildBox());
    return outer;
  }

  private buildBox(): HTMLElement {
    const box = document.createElement("div");
    box.className = `cm-lp-frontmatter${this.selected ? " cm-lp-frontmatter-selected" : ""}`;

    let value: unknown;
    try {
      value = parseYaml(this.inner);
    } catch (e) {
      return this.fallback(box, `frontmatter 解析失败：${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
    if (value === null || value === undefined) {
      const empty = document.createElement("div");
      empty.className = "cm-lp-fm-empty";
      empty.textContent = "（空 frontmatter）";
      box.append(empty);
      return box;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      return this.fallback(box, "frontmatter 不是键值结构，按原文显示");
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
