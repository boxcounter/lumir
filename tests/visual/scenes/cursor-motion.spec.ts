import { expect, test } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// 回归（M103）：修复前编辑器未装 keymap，ArrowUp/Down 与 macOS Ctrl-P/N 全走原生
// contenteditable 路径——光标越出视口时浏览器延迟揭示，实测 scrollTop 单次跳 ~388px
// （整屏突变）。修复后由 CM6 moveVertically 逐行移动 + y:"nearest" 最小滚动跟随。

const LINES = Array.from({ length: 200 }, (_, i) => `第 ${i + 1} 行正文内容，用于撑起足够长的文档。`);
const SOURCE = LINES.join("\n\n");
const LINE_HEIGHT = 28; // 16px * 1.75

interface MotionSample {
  scrollTop: number;
  caretTop: number;
  caretBottom: number;
  scrollerTop: number;
  scrollerBottom: number;
  head: number;
  docLength: number;
}

async function sample(page: import("@playwright/test").Page): Promise<MotionSample> {
  return page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller")!;
    const sRect = scroller.getBoundingClientRect();
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const head: number = view.state.selection.main.head;
    const coords = view.coordsAtPos(head);
    return {
      scrollTop: scroller.scrollTop,
      caretTop: coords?.top ?? -1,
      caretBottom: coords?.bottom ?? -1,
      scrollerTop: sRect.top,
      scrollerBottom: sRect.bottom,
      head,
      docLength: view.state.doc.length,
    };
  });
}

async function expectSmoothFollow(page: import("@playwright/test").Page, key: string, presses: number, direction: 1 | -1) {
  let prev = await sample(page);
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(key);
    // CM6 在 measure 阶段（rAF）应用滚动，等一帧再采样
    await page.waitForTimeout(50);
    const cur = await sample(page);
    // 光标逐行移动；到达文档边界后停在边界（head 不变是合法的）
    const atDocBoundary = direction > 0 ? cur.head >= cur.docLength : cur.head === 0;
    expect(cur.head !== prev.head || atDocBoundary, `${key} 第 ${i + 1} 次按键光标未移动且不在文档边界`).toBeTruthy();
    // 光标始终位于视口内（滚动跟随后）
    expect(cur.caretBottom, `${key} 第 ${i + 1} 次按键后光标不得落在视口下方`).toBeLessThanOrEqual(cur.scrollerBottom + 1);
    expect(cur.caretTop, `${key} 第 ${i + 1} 次按键后光标不得落在视口上方`).toBeGreaterThanOrEqual(cur.scrollerTop - 1);
    // 滚动顺滑跟随：正常移动单次 ≤ 1 行；文档边界处光标可能一次走 2 行
    // （跳过空行）并叠加边界归位，放宽到 4 行——修复前实测单次跳 ~388px（14 行）。
    const delta = cur.scrollTop - prev.scrollTop;
    expect(delta * direction, `${key} 第 ${i + 1} 次按键滚动方向错误`).toBeGreaterThanOrEqual(0);
    expect(Math.abs(delta), `${key} 第 ${i + 1} 次按键滚动幅度 ${Math.abs(delta)}px 超过阈值`).toBeLessThanOrEqual(LINE_HEIGHT * 4);
    prev = cur;
  }
}

test("垂直光标移动：ArrowDown/ArrowUp 与 Ctrl-N/P 越出视口时顺滑跟随", async ({ page }) => {
  await stubTauri(page, { entries: [{ path: "long.md", kind: "file", size: SOURCE.length, mtime_ms: 0 }], files: { "long.md": SOURCE } });
  await page.goto("/");
  await page.locator('.ft-row[title="long.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第 1 行");
  // 光标放到第一行行首
  await page.locator(".cm-line").first().click({ position: { x: 4, y: 4 } });
  const start = await sample(page);
  expect(start.head).toBeLessThan(LINES[0].length);

  // 视口约 26 行：40 次下移必然多次越出底边
  await expectSmoothFollow(page, "ArrowDown", 40, 1);
  await expectSmoothFollow(page, "Control+n", 10, 1);
  await expectSmoothFollow(page, "ArrowUp", 40, -1);
  await expectSmoothFollow(page, "Control+p", 10, -1);

  // 只动选区，不动文档
  expect(await readDocument(page)).toBe(SOURCE);
});
