import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M703（change harness-table-horizontal-scroll-oct24）的**渲染面**判据：
//
// Alex 截图 `kimi-code-composer://attachments/m3`：harness 面板里的 Markdown 表格被挤窄、单元格
// 折行，要求「参考正文横向铺开、左右滑动」。M699 探针证明修法必须两半同时落地：
//   ① 表按内容固有宽布局（width: max-content）；
//   ② 表被 `.lumir-hp-table-scroll` 包裹，溢出只在该容器内滚。
// 只做①时溢出抬高整个正文列、transcript 整列横滚；只做②时表仍被 auto 表布局压回、容器永不
// 溢出。本场景用两组可区分的读数把这两条反例钉住：宽表场景**先**断言 wrapper 确实溢出
// （`scrollWidth − clientWidth > 20`），**再**断言 transcript 无横溢（`scrollWidth === clientWidth`）。
//
// 只做结构 / 计算属性断言，不碰像素基线：现有基线（m303 / m347 / m351 / m440 / m634 / m460）
// 都不含宽表，本场景的 fixture 也不进整页基线。真机 WKWebView 的观感与「确实横滚」归验收场景
// 234 的截图证据（AX 不给几何 / scrollTop，真机层不可机验）。

const DOC = "# 表格横滚笔记\n\n第一段，给上下文 chip 一个视口口径。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

/** 4 列宽表：自然宽 ≈ 580px，1:1 分栏（pane ≈ 481 / body ≈ 463）下必然横向溢出。 */
const WIDE = [
  "| 名称 | 说明 | 状态 | 备注 |",
  "| --- | --- | --- | --- |",
  "| WIDE-甲 | 第一列的说明文字写得再长一点也要放得下 | 进行中状态说明 | 备注文字也写得更长一些才够宽 |",
  "| WIDE-乙 | 第二列的说明文字同样很长也要放得下 | 已完成状态 | 备注文字的第二个例子也够宽了 |",
].join("\n");

/** 长 URL 单元格：URL 不折行时自然宽远超正文栏。 */
const URL_TABLE = [
  "| 目标 | 地址 |",
  "| --- | --- |",
  "| URL-甲 | https://example.com/really/long/path/segment/with/many/parts/that/keeps/going/and/going/final-document-name.md |",
].join("\n");

/** 窄表回归：自然宽明显小于正文栏（两列、标记列用于定位）。 */
const NARROW = ["| 名称 | 标记 |", "| --- | --- |", "| NARROW-甲 | 1 |"].join("\n");

/** 嵌套收缩：blockquote 的包含块比正文栏窄（padding-left + border-left 合计 10px），宽表仍须局部横滚。 */
const QUOTED = [
  "> | 名称 | 说明 | 状态 | 备注 |",
  "> | --- | --- | --- | --- |",
  "> | QUOTE-甲 | 引用块里的宽表说明文字也很长要放得下 | 进行中状态 | 引用块里的备注文字也够宽 |",
].join("\n");

const BODY = ["前文一段。", "", WIDE, "", "中间一段。", "", URL_TABLE, "", NARROW, "", QUOTED].join("\n");

const STATE = {
  messages: [{ role: "assistant", text: BODY, ts: Math.floor(Date.now() / 1000) - 30 }],
  usage: { ctx_pct: 0, cache_pct_session: 0 },
  pending_approval: null,
  warn_ctx_pct: 85,
};

async function stubHarness(page: Page): Promise<void> {
  await page.addInitScript(
    ([snap]) => {
      const w = window as unknown as Record<string, any>;
      const internals = w.__TAURI_INTERNALS__;
      const invoke = internals.invoke as (cmd: string, args: unknown) => unknown;
      internals.invoke = async (cmd: string, args: any) => {
        if (cmd === "harness_state") return JSON.stringify(snap);
        if (cmd === "harness_list_sessions") return [];
        if (cmd === "plugin:event|listen" && args.event === "harness:event") return 0;
        return invoke(cmd, args);
      };
    },
    [STATE] as const,
  );
}

async function openPanel(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  // 4 张表各自一个 slot（宽表 / 长 URL / 窄表 / blockquote 内的表）。
  await expect(page.locator('.lumir-hp-block-slot[data-hp-block="table"]')).toHaveCount(4, { timeout: 5000 });
}

interface Box {
  left: number;
  right: number;
  width: number;
  top: number;
  bottom: number;
  height: number;
}

interface TableGeometry {
  slot: Box;
  wrapper: Box;
  table: Box;
  body: Box;
  button: Box;
  wrapperScrollWidth: number;
  wrapperClientWidth: number;
  transcriptScrollWidth: number;
  transcriptClientWidth: number;
  cellLines: number[];
  overflowX: string;
  overflowY: string;
  scrollbarWidth: string;
  scrollbarGutter: string;
  structure: { slotChildIsWrapper: boolean; wrapperChildIsTable: boolean };
}

/** 按单元格标记定位那张表的整条几何链（slot > wrapper > table），一次 evaluate 取齐。 */
function tableGeometry(page: Page, marker: string): Promise<TableGeometry> {
  return page.evaluate((needle) => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, top: r.top, bottom: r.bottom, height: r.height };
    };
    const slots = [...document.querySelectorAll<HTMLElement>('.lumir-hp-block-slot[data-hp-block="table"]')];
    const slot = slots.find((el) => (el.textContent ?? "").includes(needle));
    if (!slot) throw new Error(`找不到含 ${needle} 的表格 slot`);
    const wrapper = slot.querySelector<HTMLElement>(":scope > .lumir-hp-table-scroll");
    if (!wrapper) throw new Error(`${needle} 的 slot 下没有 .lumir-hp-table-scroll`);
    const table = wrapper.querySelector<HTMLElement>(":scope > table.lumir-hp-table");
    if (!table) throw new Error(`${needle} 的 wrapper 下没有 table.lumir-hp-table`);
    const body = slot.closest<HTMLElement>(".lumir-hp-body");
    const transcript = slot.closest<HTMLElement>(".lumir-hp-transcript");
    const button = slot.querySelector<HTMLElement>(".lumir-hp-block-fs-trigger");
    if (!body || !transcript || !button) throw new Error(`${needle} 的 DOM 链不完整`);
    const cellLines = [...table.querySelectorAll<HTMLElement>("th, td")].map((cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      // 行数 = 不同 line-top 的个数：cell 里含行内元素（如裸 URL 的 <a>）时，Range 会为同一
      // line box 返回多个重叠 rect，直接数 rects 会把「一行」误判成「两行」。
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    });
    const s = getComputedStyle(wrapper);
    return {
      slot: box(slot),
      wrapper: box(wrapper),
      table: box(table),
      body: box(body),
      button: box(button),
      wrapperScrollWidth: wrapper.scrollWidth,
      wrapperClientWidth: wrapper.clientWidth,
      transcriptScrollWidth: transcript.scrollWidth,
      transcriptClientWidth: transcript.clientWidth,
      cellLines,
      overflowX: s.overflowX,
      overflowY: s.overflowY,
      scrollbarWidth: s.scrollbarWidth,
      scrollbarGutter: s.scrollbarGutter,
      structure: {
        slotChildIsWrapper: slot.firstElementChild === wrapper,
        wrapperChildIsTable: wrapper.firstElementChild === table,
      },
    };
  }, marker);
}

/** CSSOM 里的 `::-webkit-scrollbar` 规则；选择器组按逗号拆开匹配（style.css 里是同组共用规则）。 */
type ScrollbarRule = { selectors: string[]; width: string; height: string; cssText: string };

function scrollbarRules(page: Page): Promise<ScrollbarRule[]> {
  return page.evaluate(() => {
    const found: Array<{ selectors: string[]; width: string; height: string; cssText: string }> = [];
    const walk = (list: CSSRuleList): void => {
      for (const rule of Array.from(list)) {
        const anyRule = rule as unknown as {
          selectorText?: string;
          style?: CSSStyleDeclaration;
          cssRules?: CSSRuleList;
        };
        if (anyRule.cssRules) walk(anyRule.cssRules);
        if (anyRule.selectorText && anyRule.selectorText.includes("-webkit-scrollbar")) {
          found.push({
            selectors: anyRule.selectorText.split(",").map((s) => s.trim()),
            width: anyRule.style?.width ?? "",
            height: anyRule.style?.height ?? "",
            cssText: (anyRule.style?.cssText ?? "").replace(/\s+/g, " "),
          });
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      let list: CSSRuleList;
      try {
        list = sheet.cssRules;
      } catch {
        continue;
      }
      walk(list);
    }
    return found;
  });
}

test("窄 pane 宽表：表保持固有宽、cell 不折行，溢出只落在表格横滚容器内", async ({ page }) => {
  await openPanel(page);
  const g = await tableGeometry(page, "WIDE-甲");

  // 结构：slot > wrapper > table（全屏钮的定位容器在横滚容器之外）。
  expect(g.structure.slotChildIsWrapper).toBe(true);
  expect(g.structure.wrapperChildIsTable).toBe(true);

  // ① 区分度输入：这张表必须真的溢出，否则后面的「不撑宽正文」没有意义。
  expect(g.wrapperScrollWidth - g.wrapperClientWidth, "宽表在窄 pane 下必须横向溢出").toBeGreaterThan(20);

  // ② 固有宽：表宽 > 正文栏宽，且表格可视盒宽 = wrapper 的 scrollWidth。
  expect(g.table.width, "表必须宽于正文栏").toBeGreaterThan(g.body.width + 20);
  expect(Math.abs(g.table.width - g.wrapperScrollWidth), "表宽应与 wrapper 的 scrollWidth 相等").toBeLessThanOrEqual(1);

  // ③ 不撑宽正文列：transcript 的 scrollWidth === clientWidth。
  expect(g.transcriptScrollWidth, "transcript 不得出现横向溢出").toBe(g.transcriptClientWidth);

  // ④ 每个 cell 单行（同一输入在改动前是 2 行——M699 探针读数）。
  expect(g.cellLines.length).toBeGreaterThan(0);
  expect(g.cellLines.filter((n) => n !== 1), "所有 th/td 的文本都必须单行").toEqual([]);

  // ⑤ M660 #4 锚点不回退：slot 右缘 = wrapper 右缘，钮距 slot 右缘 6px。
  expect(Math.abs(g.slot.right - g.wrapper.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(g.slot.right - g.button.right - 6)).toBeLessThanOrEqual(1);

  // ⑥ 横滚能力真的在：scrollLeft 可动。
  const scrollLeft = await page.evaluate((needle) => {
    const slots = [...document.querySelectorAll<HTMLElement>('.lumir-hp-block-slot[data-hp-block="table"]')];
    const slot = slots.find((el) => (el.textContent ?? "").includes(needle))!;
    const wrapper = slot.querySelector<HTMLElement>(".lumir-hp-table-scroll")!;
    wrapper.scrollLeft = 120;
    return wrapper.scrollLeft;
  }, "WIDE-甲");
  expect(scrollLeft).toBeGreaterThan(0);
});

test("声明层：横滚容器只滚横向、归细条档、无 scrollbar-gutter", async ({ page }) => {
  await openPanel(page);
  const g = await tableGeometry(page, "WIDE-甲");
  expect(g.overflowX).toBe("auto");
  expect(g.overflowY).toBe("hidden");
  expect(g.scrollbarWidth).toBe("thin");
  expect(g.scrollbarGutter).toBe("auto");

  const rules = await scrollbarRules(page);
  const bar = rules.find((r) => r.selectors.includes(".lumir-hp-table-scroll::-webkit-scrollbar"));
  expect(bar, "缺 .lumir-hp-table-scroll::-webkit-scrollbar 声明").toBeTruthy();
  expect(bar!.width).toBe("4px");
  expect(bar!.height).toBe("4px");
  const thumb = rules.find((r) => r.selectors.includes(".lumir-hp-table-scroll::-webkit-scrollbar-thumb"));
  expect(thumb?.cssText, "thumb 取 --border").toContain("background: var(--border)");
  const track = rules.find((r) => r.selectors.includes(".lumir-hp-table-scroll::-webkit-scrollbar-track"));
  expect(track, "缺轨道声明").toBeTruthy();
  expect(track!.cssText, "轨道不涂色").not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/);
});

test("全屏入口仍以表格为快照源：遮罩里不出现横滚容器层", async ({ page }) => {
  await openPanel(page);
  const narrow = page
    .locator('.lumir-hp-block-slot[data-hp-block="table"]')
    .filter({ hasText: "NARROW-甲" })
    .first();
  await narrow.hover();
  await narrow.locator(".lumir-hp-block-fs-trigger").click();

  const overlay = page.locator(".lumir-table-fs-overlay");
  await expect(overlay).toBeVisible();
  const snapshot = overlay.locator(".lumir-table-fs-snapshot");
  // 直接子节点必须是 table：若 openers.table 收到 wrapper，这里会多一层 div。
  await expect(snapshot.locator(":scope > table.lumir-hp-table")).toHaveCount(1);
  await expect(snapshot.locator(".lumir-hp-table-scroll")).toHaveCount(0);
  await expect(snapshot).toContainText("甲");
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
});

test("长 URL 单元格：URL 不折行，宽度由表格自身承载", async ({ page }) => {
  await openPanel(page);
  const g = await tableGeometry(page, "URL-甲");
  expect(g.wrapperScrollWidth - g.wrapperClientWidth, "长 URL 表必须横向溢出").toBeGreaterThan(50);
  expect(g.table.width).toBeGreaterThan(g.body.width + 50);
  expect(g.cellLines.filter((n) => n !== 1), "URL 与表头都必须单行").toEqual([]);
  expect(g.transcriptScrollWidth).toBe(g.transcriptClientWidth);
});

test("宽 pane：同一张表不再溢出，仍按固有宽呈现、不被拉满", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 800 });
  await openPanel(page);
  const g = await tableGeometry(page, "WIDE-甲");
  expect(g.wrapperScrollWidth, "宽 pane 下不应有横向溢出").toBe(g.wrapperClientWidth);
  // 固有宽而非拉伸：三者的宽度一致且明显小于 pane 正文宽。
  expect(Math.abs(g.wrapper.width - g.table.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(g.slot.width - g.table.width)).toBeLessThanOrEqual(1);
  expect(g.table.width).toBeLessThan(g.body.width - 100);
  expect(g.transcriptScrollWidth).toBe(g.transcriptClientWidth);
});

test("窄表回归：slot / wrapper / 表三者同宽，钮仍贴表右缘 6px", async ({ page }) => {
  await openPanel(page);
  const g = await tableGeometry(page, "NARROW-甲");
  expect(g.wrapperScrollWidth, "窄表不应出现横向溢出").toBe(g.wrapperClientWidth);
  expect(Math.abs(g.slot.width - g.wrapper.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(g.wrapper.width - g.table.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(g.slot.right - g.table.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(g.slot.right - g.button.right - 6)).toBeLessThanOrEqual(1);
  expect(g.table.width).toBeLessThan(g.body.width - 100);
});

test("嵌套 blockquote：横滚容器随包含块收缩，溢出仍只落在容器内", async ({ page }) => {
  await openPanel(page);
  const g = await tableGeometry(page, "QUOTE-甲");
  expect(g.wrapperScrollWidth - g.wrapperClientWidth, "blockquote 内的宽表仍须横向溢出").toBeGreaterThan(20);
  // 包含块比正文栏窄（blockquote 的 padding-left + border-left）：wrapper 必须跟着收缩。
  expect(g.body.width - g.wrapper.width).toBeGreaterThanOrEqual(8);
  expect(g.table.width).toBeGreaterThan(g.wrapper.width + 20);
  expect(g.transcriptScrollWidth).toBe(g.transcriptClientWidth);
  expect(g.cellLines.filter((n) => n !== 1)).toEqual([]);
});
