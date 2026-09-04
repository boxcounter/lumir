// frontmatter properties 区块（frontmatter-properties capability）。
// 检测文档首部 --- 包围块，用 js-yaml 解析（裁决点 E 推荐项，不自造 YAML 子集），
// 渲染为键值表格 replace widget；tags 以标签形态展示，嵌套值以 JSON 样式展示。
// 解析失败回退：原文完整保留显示 + 人话提示（spec「解析失败回退」）。

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

/** 检测文档首部 frontmatter；无（或未闭合）返回 null。扫描上限防止未闭合的 --- 导致全文档扫描。 */
const MAX_FRONTMATTER_LINES = 200;

export function detectFrontmatter(doc: Text): FrontmatterBlock | null {
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") return null;
  const last = Math.min(doc.lines, MAX_FRONTMATTER_LINES);
  for (let n = 2; n <= last; n++) {
    const line = doc.line(n);
    const t = line.text.trim();
    if (t === "---" || t === "...") {
      return {
        from: doc.line(1).from,
        to: line.to,
        inner: doc.sliceString(doc.line(1).to + 1, line.from),
      };
    }
  }
  return null;
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
  constructor(readonly inner: string) {
    super();
  }

  eq(other: FrontmatterWidget): boolean {
    return other.inner === this.inner;
  }

  toDOM(): HTMLElement {
    const box = document.createElement("div");
    box.className = "cm-lp-frontmatter";

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
