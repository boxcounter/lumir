// M240 现状读数与打开成本探针（change table-fullscreen-view 的 tasks 1.1 / 1.3 / 2.4）。
//
// 这是**读数探针**，不是门禁断言：它把读数打成一行 `READINGS <json>`，由执行者落进
// `test-results/acceptance/<日期>/table-fullscreen-before/`（证据不入 git，REVIEW.md 第 7 条）。
// 因此它在实现前与实现后都能跑，唯一的硬断言是「从未触发时 DOM 里没有遮罩节点」
//（spec 的「文档打开路径零新增 / 惰性建立」scenario，两态都成立）。
//
// 读数四项（tasks 1.1）：① 遮罩节点数；② caret 与 docText；③ 表格 grid 的计算样式基线
//（字体 / 字号 / 行高 / cell padding / 字色——5.4 的克隆保真对照物）；④ 接近 64 KiB 上限表的
// 行数与 DOM 节点数。加一项 1.3 的机制读数：CM 选区层挂在哪一层（克隆卫生的依据）。
// tasks 2.4 的打开成本在第二组里（同一份读数格式，实现后才有值）。

import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubTauri, configGets } from "./tauri-stub";
import { readDocument } from "./parity-checks";

const fixtureDir = new URL("../fixtures/table-fullscreen/", import.meta.url);
const SOURCE = readFileSync(new URL("scene.md", fixtureDir), "utf8");
const SVG = readFileSync(new URL("../fixtures/markdown-combo/sample.svg", import.meta.url), "utf8");

/** 近 64 KiB 上限的 pipe table：降级阈值是 chars 与 UTF-8 bytes 两个判据（src/preview/table.ts
 *  的 oversize），这里按「两个都贴着上限但都没到」造 → 仍渲染为 grid（可放大）。 */
const TOTAL_ROWS = 700;
function bigTable(rows: number): string {
  const header = "| 序号 | 名称 | 说明 | 状态 |\n| --- | --- | --- | --- |\n";
  const body = Array.from({ length: rows }, (_, i) =>
    `| ${i + 1} | 条目 ${i + 1} | 说明文本若干字以凑到接近上限的字节数 | ${i % 3 === 0 ? "启用" : "停用"} |\n`,
  ).join("");
  return `# 大表场景\n\n${header}${body}`;
}

const BIG = bigTable(TOTAL_ROWS); // 实测约 30k chars / 61 KiB（读数写在报告里）

async function openDoc(page: Page, doc: string): Promise<void> {
  await stubTauri(page, {
    entries: [
      { path: "scene.md", kind: "file", size: doc.length, mtime_ms: 0 },
      { path: "assets/sample.svg", kind: "file", size: SVG.length, mtime_ms: 0 },
    ],
    files: { "scene.md": doc, "assets/sample.svg": SVG },
    config: { keys: { "Cmd-j": "table.toggle-fullscreen" } },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="scene.md"]').click();
  await expect(page.locator(".cm-lp-table")).not.toHaveCount(0);
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await page.waitForTimeout(80);
}

/** UTF-8 字节数（Node 的 `Buffer` 不在本套件的 node-env.d.ts 声明里，用 web 的 TextEncoder）。 */
const utf8Bytes = (text: string): number => new TextEncoder().encode(text).byteLength;

function report(label: string, payload: unknown): void {
  console.log(`READINGS ${label} ${JSON.stringify(payload)}`);
}

test("现状读数：遮罩惰性、caret / docText、grid 计算样式基线、选区层所在层级", async ({ page }) => {
  await openDoc(page, SOURCE);
  const caret = await page.evaluate(() => {
    const el = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: { state: { doc: { toString(): string }; selection: { main: { head: number } } }; dispatch(s: unknown): void; focus(): void } } } };
    const view = el.cmTile.root.view;
    const text = view.state.doc.toString();
    view.dispatch({ selection: { anchor: text.indexOf("| 甲 |") + 3 } });
    view.focus();
    return view.state.selection.main.head;
  });
  const docText = await readDocument(page);

  const reading = await page.evaluate(() => {
    const pick = (el: Element) => {
      const cs = getComputedStyle(el);
      return {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
        color: cs.color,
        backgroundColor: cs.backgroundColor,
      };
    };
    const grid = document.querySelector(".cm-content .cm-lp-table") as HTMLElement;
    const cell = grid.querySelector(".cm-lp-table-cell") as HTMLElement;
    const inlineCode = grid.querySelector(".cm-lp-inline-code") as HTMLElement | null;
    // CM 的选区 / 光标层挂在哪一层：克隆卫生与「快照不带当前选区」判据的依据。
    const selectionLayer = document.querySelector(".cm-selectionLayer");
    return {
      overlayNodes: document.querySelectorAll(".lumir-table-fs-overlay").length,
      triggerNodes: document.querySelectorAll(".lumir-table-fs-trigger").length,
      grid: pick(grid),
      cell: pick(cell),
      inlineCode: inlineCode ? pick(inlineCode) : null,
      gridWidth: grid.getBoundingClientRect().width,
      columns: grid.getAttribute("aria-colcount"),
      rows: grid.querySelectorAll(".cm-lp-table-row").length,
      gridDomNodes: grid.querySelectorAll("*").length,
      selectionLayerParent: selectionLayer?.parentElement?.className ?? null,
      selectionLayerInsideGrid: selectionLayer !== null && grid.contains(selectionLayer),
      drawSelectionLayers: [...document.querySelectorAll(".cm-selectionLayer, .cm-cursorLayer")].map(
        (el) => `${el.className} ← ${el.parentElement?.className ?? "?"}`,
      ),
    };
  });

  // 硬断言（两态都成立）：从未触发时遮罩节点不存在（惰性建立）。
  expect(reading.overlayNodes).toBe(0);
  report("baseline", { caret, docTextLength: docText.length, docText, ...reading });
});

test("打开成本读数：近 64 KiB 表的打开耗时与快照 DOM 规模", async ({ page }) => {
  await openDoc(page, BIG);
  const source = await page.evaluate(() => {
    const grid = document.querySelector(".cm-content .cm-lp-table") as HTMLElement | null;
    return {
      renderedRows: grid?.querySelectorAll(".cm-lp-table-row").length ?? 0,
      domNodes: grid?.querySelectorAll("*").length ?? 0,
      gridWidth: grid?.getBoundingClientRect().width ?? 0,
      gridHeight: grid?.getBoundingClientRect().height ?? 0,
      // CM 用 `.cm-gap` 表示「这一段没有渲染」：它在 grid 子树里，带着未渲染行的高度。
      hasGap: grid?.querySelectorAll(".cm-gap").length ?? 0,
      gapHeight: grid?.querySelector(".cm-gap")?.getBoundingClientRect().height ?? 0,
    };
  });

  const measured = await page.evaluate(() => {
    const hasFeature = document.querySelectorAll(".lumir-table-fs-trigger").length > 0;
    if (!hasFeature) return { featurePresent: false };
    // 先把 caret 放进表内（命中条件 ② 的前提），否则命令级门为假、什么都没发生——
    // 那种情形下读到的「0ms / 空快照」是假读数（REVIEW.md 第 2 条的形态）。
    const content = document.querySelector(".cm-content") as unknown as {
      cmTile: { root: { view: { state: { doc: { toString(): string } }; dispatch(s: unknown): void; focus(): void } } };
    };
    const view = content.cmTile.root.view;
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("| 序号 |") + 4 } });
    view.focus();

    const t0 = performance.now();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", metaKey: true, bubbles: true, cancelable: true }));
    const dispatched = performance.now();
    const snapshot = document.querySelector(".lumir-table-fs-snapshot") as HTMLElement | null;
    const clone = snapshot?.firstElementChild as HTMLElement | null;
    if (clone === null || clone === undefined) throw new Error("命令已分发但遮罩没打开：读数为假");
    // 读几何强制样式重算 + 布局，把「打开」的后半段成本也量进来。
    const box = clone.getBoundingClientRect();
    const laidOut = performance.now();
    return {
      featurePresent: true,
      dispatchMs: Math.round((dispatched - t0) * 1000) / 1000,
      layoutMs: Math.round((laidOut - dispatched) * 1000) / 1000,
      totalMs: Math.round((laidOut - t0) * 1000) / 1000,
      snapshotRows: clone.querySelectorAll(".cm-lp-table-row").length,
      snapshotDomNodes: clone.querySelectorAll("*").length,
      snapshotWidth: box.width,
      snapshotHeight: box.height,
      snapshotHasGap: clone.querySelectorAll(".cm-gap").length,
      snapshotTextLength: clone.textContent?.length ?? 0,
    };
  });

  report("open-cost", {
    fixture: { columns: 4, rows: TOTAL_ROWS, chars: BIG.length, bytes: utf8Bytes(BIG) },
    ...source,
    ...measured,
  });
  // 夹具自身的不变量（两态都成立）：doc 与字节数都在 64 KiB 降级阈值**之下**（chars 与
  // bytes 两个判据，见 src/preview/table.ts 的 oversize），且确实渲染成了 grid（不是降级表）。
  // 选择器限定在编辑器内容区：测量后遮罩里还有一份克隆的同名 grid。
  expect(BIG.length).toBeLessThanOrEqual(64 * 1024);
  expect(utf8Bytes(BIG)).toBeLessThanOrEqual(64 * 1024);
  await expect(page.locator(".cm-content .cm-lp-table")).toHaveCount(1);
});
