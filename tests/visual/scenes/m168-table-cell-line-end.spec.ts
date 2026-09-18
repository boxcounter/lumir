import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M168 ②：grid 表格 cell 内 ^E（Emacs C-e，行尾）的不变量——落点 SHALL 取**当前 cell**
// 内容区内的最右可停靠位，MUST NOT 落到隐藏管道符边界（那里没有可测坐标：caret 无位置，
// WKWebView 上表现为「光标串到下一行 cell」）。缺陷现场（Alex 2026-09-18 实测）：
// 「表格 cell 里 CTRL+E，光标会进入下面一行的 cell，而不是移动到当前 cell 的末尾」。
//
// 判据（条款见 openspec/specs/keymap-commands/spec.md 的「编辑器光标命令的硬化底座」）：
//   1. 落点与出发行同属一行（不得串到下一行 cell）；
//   2. 原生 caret 矩形非退化（用户看得见光标）——这是缺陷的可见症状本身，不用 coordsAtPos 代理；
//   3. 原生 caret 所在的可视元素就是出发时的那个 cell；
//   4. 落点在该 cell 内容区内（不越过 cell 内容右缘）；
//   5. 最右可停靠：落点右侧至 cell 内容右缘之间不存在可停靠位（否则 ^E 没走到 cell 末尾）。
// fixture 是表格形态矩阵（列数 × pad 空格 × 尾管道符 × 短行补空列）。

interface Shape {
  id: string;
  columns: number;
  /** true = `| a | b |`（cell 前后各一个空格），false = `|a|b|`。 */
  pad: boolean;
  /** 行尾是否带收尾管道符。 */
  trailing: boolean;
  /** 末行少一格（M137 补空列形态）。 */
  shortLastRow?: boolean;
}

const SHAPES: Shape[] = [
  { id: "2 列 · pad · 尾管道", columns: 2, pad: true, trailing: true },
  { id: "3 列 · pad · 尾管道", columns: 3, pad: true, trailing: true },
  { id: "4 列 · pad · 尾管道", columns: 4, pad: true, trailing: true },
  { id: "3 列 · 无 pad · 尾管道", columns: 3, pad: false, trailing: true },
  { id: "3 列 · pad · 无尾管道", columns: 3, pad: true, trailing: false },
  { id: "3 列 · 无 pad · 无尾管道", columns: 3, pad: false, trailing: false },
  { id: "3 列 · 短行补空列", columns: 3, pad: true, trailing: true, shortLastRow: true },
];

function rowText(cells: string[], shape: Shape): string {
  const body = cells.join(shape.pad ? " | " : "|");
  if (shape.pad) return `| ${body}${shape.trailing ? " |" : ""}`;
  return `|${body}${shape.trailing ? "|" : ""}`;
}

function buildDoc(shape: Shape): string {
  const header = rowText(Array.from({ length: shape.columns }, (_, j) => `h${j + 1}`), shape);
  const separator = rowText(Array.from({ length: shape.columns }, () => "---"), shape);
  const first = rowText(Array.from({ length: shape.columns }, (_, j) => `c${j + 1}r1`), shape);
  const secondCount = shape.shortLastRow ? shape.columns - 1 : shape.columns;
  const second = rowText(Array.from({ length: secondCount }, (_, j) => `c${j + 1}r2`), shape);
  return `${header}\n${separator}\n${first}\n${second}\n\n末尾段。\n`;
}

interface CaretInfo {
  head: number;
  line: number;
  lineFrom: number;
  lineText: string;
  /** 原生 caret（用户看到的那个）矩形；退化时为 null 或 height 0。 */
  caret: { top: number; left: number; height: number } | null;
  /** caret 处的可视元素所属 cell 的文本（不在 cell 内时为 null 或容器描述）。 */
  hit: string | null;
}

async function caretInfo(page: Page): Promise<CaretInfo> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const main = view.state.selection.main;
    const line = view.state.doc.lineAt(main.head);
    const sel = document.getSelection();
    let caret: { top: number; left: number; height: number } | null = null;
    let hit: string | null = null;
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      caret = { top: Math.round(r.top), left: Math.round(r.left), height: Math.round(r.height) };
      if (r.height > 0) {
        const el = document.elementFromPoint(r.left + 1, r.top + r.height / 2);
        const cell = el?.closest(".cm-lp-table-cell");
        hit = cell ? cell.textContent : (el?.className?.toString() ?? null);
      }
    }
    return { head: main.head, line: line.number, lineFrom: line.from, lineText: line.text, caret, hit };
  });
}

/** 逐个探测给定位置的原生 caret 高度（可停靠性），结束后恢复原落点。 */
async function caretHeights(page: Page, positions: number[]): Promise<Array<[number, number]>> {
  if (positions.length === 0) return [];
  return page.evaluate((positions) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const ES = view.state.selection.constructor as { cursor: (pos: number) => unknown };
    const original = view.state.selection.main;
    const out: Array<[number, number]> = [];
    for (const p of positions) {
      view.dispatch({ selection: ES.cursor(p) });
      const sel = document.getSelection();
      const r = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
      out.push([p, r ? Math.round(r.height) : -1]);
    }
    view.dispatch({ selection: ES.cursor(original.head) });
    return out;
  }, positions);
}

async function openDoc(page: Page, name: string, doc: string): Promise<void> {
  await stubTauri(page, { entries: [{ path: name, kind: "file", size: doc.length, mtime_ms: 0 }], files: { [name]: doc } });
  await page.goto("/");
  await page.locator(`.ft-row[title="${name}"]`).click();
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  await page.waitForTimeout(150);
}

for (const shape of SHAPES) {
  const doc = buildDoc(shape);

  test(`^E 在 cell 内落在当前 cell 最右可停靠位：${shape.id}`, async ({ page }) => {
    await openDoc(page, "cell.md", doc);
    const firstDataRow = doc.split("\n")[2];

    for (let column = 1; column <= shape.columns; column++) {
      const marker = `c${column}r1`;
      const cell = page.locator(".cm-lp-table-cell", { hasText: marker }).first();
      await cell.click();
      await page.waitForTimeout(80);

      // 前置条件：光标确实落在该 cell 内（否则后面的断言在空输入上空转）
      const before = await caretInfo(page);
      expect(before.hit, `${shape.id} 列${column}：点击后光标应在该 cell 内`).toContain(marker);
      expect(before.caret?.height ?? 0, `${shape.id} 列${column}：出发位 caret 应可见`).toBeGreaterThan(0);

      await page.keyboard.press("Control+e");
      await page.waitForTimeout(120);
      const after = await caretInfo(page);

      // 1) 不得串到下一行 cell
      expect(after.line, `${shape.id} 列${column}：^E 后应停在同一行`).toBe(before.line);
      // 2) caret 必须有可视位置（缺陷症状：原生 caret 退化 → WKWebView 上串到下一行 cell）
      expect(after.caret?.height ?? 0, `${shape.id} 列${column}：^E 后 caret 应可见（不得停在无位置的隐藏管道符边界）`).toBeGreaterThan(0);
      // 3) caret 的可视归属仍是出发的那个 cell
      expect(after.hit, `${shape.id} 列${column}：caret 应落在出发 cell 内`).toContain(marker);
      // 4) 落点在 cell 内容区内
      expect(after.lineText, `${shape.id} 列${column}：应仍在该行`).toBe(firstDataRow);
      const contentFrom = after.lineFrom + firstDataRow.indexOf(marker);
      const contentEnd = contentFrom + marker.length;
      expect(after.head, `${shape.id} 列${column}：落点不应越过 cell 内容右缘`).toBeLessThanOrEqual(contentEnd);
      expect(after.head, `${shape.id} 列${column}：落点不应回到 cell 内容左缘之前`).toBeGreaterThanOrEqual(contentFrom);
      // 5) 最右可停靠：落点右侧至内容右缘之间没有可停靠位
      const beyond = Array.from({ length: contentEnd - after.head }, (_, i) => after.head + 1 + i);
      for (const [pos, height] of await caretHeights(page, beyond)) {
        expect(height, `${shape.id} 列${column}：位置 ${pos} 仍可停靠 → ^E 未取到 cell 最右可停靠位`).toBe(0);
      }

      // 幂等：已在落点再按 ^E 不漂移
      await page.keyboard.press("Control+e");
      await page.waitForTimeout(80);
      expect((await caretInfo(page)).head, `${shape.id} 列${column}：重复 ^E 不得继续漂移`).toBe(after.head);
    }

    expect(await readDocument(page)).toBe(doc);
  });
}
