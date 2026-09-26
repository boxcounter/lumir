// 内容区域宽度拖拽场景（M228，change content-width-drag）。
//
// 判据一律是**读数**（token 计算值、列缘几何、写入序列、toast 文本），不是「某个函数被调用过」：
// 本 change 的可见结果就是栏宽本身与那两条手柄（REVIEW.md 第 1 / 11 条）。
//
// 覆盖：出厂口径（D1 = 760，默认值即下限）、手柄的读屏名与几何贴合（D5 含 code 模式）、
// hover/拖拽显现、对称拖拽换算（栏宽变化 = 2 × 位移）、上下限钳制（D2 = [760, 1200]）、
// 松手写一次且只在有变化时写（D3 = config_set_ui_value）、写失败的 toast 与不回滚（D121）、
// 配置值启动生效、空态无手柄。
//
// 刻意**不新增整页像素基线**：手柄常态不可见，既有基线唯一的变化面是 heading 阶梯
//（同 mission 的 heading-hierarchy-ramp）带来的位移，过目包统一在 test-results/m228/。

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";

/** 场景文档：一段足以撑满栏宽的长行（列缘矩形可读）+ 若干短行。 */
/** 首段刻意长于两个栏宽的可容纳量（约 990 字符 = 6 遍下句）：文字宽 672px（框宽 760）下约 12 个可视行、
 *  828px（拖到 920 后被 pane 钳住）下约 10 个——折行数明显不同且离折行边界有富余。
 *  为什么要这么长（M236 2026-09-26 改默认 760 时踩到）：原稿是一遍（165 字符），在 592px（框宽 680）
 *  下 3 行、752px 下 2 行，断言成立；改 760 后 672px 已是 2 行、拖宽后仍 2 行，「行盒变矮」这条
 *  会假红——判据落在折行边界附近就等于把断言绑死在字体度量上（CI 与本机字族不同）。 */
const PARAGRAPH =
  "Ordinary paragraph with enough words to wrap across the reading column so that the width of the column is measurable and the wrap count changes when the column widens. ";
const DOC = [
  PARAGRAPH.repeat(6).trim(),
  "",
  ...Array.from({ length: 30 }, (_, i) => `line ${String(i + 1).padStart(2, "0")} filler`),
  "",
].join("\n");

interface WidthConfig {
  content_width?: number;
}

/** 打开一个文档页。`config` 只放栏宽一项（缺省 = 出厂口径 760）。 */
async function open(page: Page, options: { config?: WidthConfig; text?: string; failures?: Record<string, { code: string; message: string }> } = {}): Promise<void> {
  const text = options.text ?? DOC;
  await stubTauri(page, {
    entries: [{ path: "doc.md", kind: "file", size: text.length, mtime_ms: 0 }],
    files: { "doc.md": text },
    config: options.config,
    failures: options.failures,
  });
  await page.goto("/");
  await page.locator('.ft-row[title="doc.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("doc.md");
  // 等配置装载完成（setContentWidth 在 config_get 的回调里，晚于首帧）
  await expect.poll(() => page.evaluate(() => (window as never as { __configGets: number }).__configGets)).toBeGreaterThan(0);
  await page.waitForTimeout(80);
}

/** 栏宽 token 的当前生效值（documentElement 的计算值：默认值来自样式表，运行期值是 inline 写入）。 */
async function widthToken(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--layout-doc-measure").trim());
}

/** 已记录的 `[ui]` 写入序列（桩侧真源）。 */
async function uiValueWrites(page: Page): Promise<Array<{ key: string; value: unknown }>> {
  return page.evaluate(() => [...((window as never as { __uiValueWrites: Array<{ key: string; value: unknown }> }).__uiValueWrites ?? [])]);
}

/** 拖一条手柄：`dx` 为指针位移（向右为正；左缘手柄向左拖 = 放宽）。分段移动模拟真实轨迹。 */
async function dragHandle(page: Page, side: "left" | "right", dx: number, options: { release?: boolean } = {}): Promise<void> {
  const handle = page.locator(`.content-width-handle-${side}`);
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x + (dx * i) / steps, y);
  }
  if (options.release !== false) await page.mouse.up();
}

// ---------------------------------------------------------------------------
// 默认口径与手柄形态
// ---------------------------------------------------------------------------

test("缺省配置即出厂口径（D1 = 760px），手柄读屏名与命中区就位", async ({ page }) => {
  await open(page);
  expect(await widthToken(page)).toBe("760px");
  // 列宽上限语义：内容列实测宽度 = 760（视口 1200 减左栏后足够宽，中列吃满上限）
  const contentWidth = await page.evaluate(() => document.querySelector(".cm-content")!.getBoundingClientRect().width);
  expect(contentWidth).toBe(760);

  // 手柄覆盖层可见（有前台文档），左右各一，读屏名 D120、role=separator、纵向
  const handles = page.locator(".content-width-handle");
  await expect(handles).toHaveCount(2);
  for (const side of ["left", "right"] as const) {
    const handle = page.locator(`.content-width-handle-${side}`);
    await expect(handle).toHaveAttribute("role", "separator");
    await expect(handle).toHaveAttribute("aria-orientation", "vertical");
    await expect(handle).toHaveAttribute("aria-label", "调整内容宽度");
  }

  // 几何贴合：两条手柄的命中区中线 = 内容列的左右缘（命中区 10px，向列缘两侧各伸 5px）
  const geometry = await page.evaluate(() => {
    const rect = document.querySelector(".cm-content")!.getBoundingClientRect();
    const left = document.querySelector(".content-width-handle-left")!.getBoundingClientRect();
    const right = document.querySelector(".content-width-handle-right")!.getBoundingClientRect();
    return { rectLeft: rect.left, rectRight: rect.right, leftMid: left.left + left.width / 2, rightMid: right.left + right.width / 2, hitWidth: left.width };
  });
  expect(geometry.hitWidth).toBe(10);
  expect(geometry.leftMid).toBeCloseTo(geometry.rectLeft, 0);
  expect(geometry.rightMid).toBeCloseTo(geometry.rectRight, 0);

  // 常态不可见：视觉线 opacity 0（不占布局、不吃命中区外的指针事件由结构保证）
  const idleOpacity = await page.evaluate(() => getComputedStyle(document.querySelector(".content-width-handle-right")!, "::before").opacity);
  expect(idleOpacity).toBe("0");
});

test("hover 显现视觉线，移开恢复", async ({ page }) => {
  await open(page);
  const handle = page.locator(".content-width-handle-right");
  const opacity = () => page.evaluate(() => getComputedStyle(document.querySelector(".content-width-handle-right")!, "::before").opacity);
  await handle.hover();
  expect(await opacity()).toBe("1");
  await page.locator(".cm-content").hover({ position: { x: 100, y: 400 } });
  expect(await opacity()).toBe("0");
});

test("空态无手柄（覆盖层在时隐藏，回文档恢复）", async ({ page }) => {
  // 空 vault：没有任何条目 → 启动即空态
  await stubTauri(page, { entries: [], files: {} });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => (window as never as { __configGets: number }).__configGets)).toBeGreaterThan(0);
  await expect(page.locator(".content-width-handles")).toBeHidden();
});

// ---------------------------------------------------------------------------
// 拖拽：对称换算、live 生效、松手写一次
// ---------------------------------------------------------------------------

test("右缘向右拖 80px → 栏宽 +160（对称律），live 生效，松手写一次", async ({ page }) => {
  await open(page);
  // 折行重算判据（design §4-3 的试金石之一）：首段是超长行，栏宽 +160 后折点数减少、
  // 行盒高度随之下降——没有显式 requestMeasure 时高度图停在旧宽度，这条会停在原值。
  const firstLineHeight = () =>
    page.evaluate(() => document.querySelector(".cm-line")!.getBoundingClientRect().height);
  const heightBefore = await firstLineHeight();
  await dragHandle(page, "right", 80, { release: false });
  // live（D4）：拖拽过程中 token 已经变了（rAF 合并后的最后一次 move）
  await expect.poll(() => widthToken(page)).toBe("920px");
  // 拖拽过程零写盘（持久化只在松手时发生一次）
  expect(await uiValueWrites(page)).toEqual([]);
  await page.mouse.up();
  expect(await uiValueWrites(page)).toEqual([{ key: "content_width", value: 920 }]);
  // 内容列随之变宽——但**要看两个不同的量**：token 是 920，视口里渲染出的列宽被 pane 容量钳住。
  // 中列轨道是 `minmax(0, var(--layout-doc-measure))`，语义是**上限**；两侧各留 24px 最小轨道，
  // 所以实际列宽 = min(token, paneWidth − 48)。760 + 160 = 920 > 964 − 48 = 916 ⇒ 这里读到 916。
  // （M228 时默认 680、拖到 840 < 916，两个量恰好相等，这条钳制因此一直没被断言暴露。）
  const geo = await page.evaluate(() => ({
    contentWidth: document.querySelector(".cm-content")!.getBoundingClientRect().width,
    paneWidth: document.querySelector(".pane-editor")!.getBoundingClientRect().width,
  }));
  expect(geo.contentWidth).toBeCloseTo(geo.paneWidth - 48, 0);
  expect(geo.contentWidth).toBeGreaterThan(840); // 确实比默认 760 宽出一档
  // 折行重算真的发生了：同一行文本在更宽的列里占更少的可视行
  const heightAfter = await firstLineHeight();
  expect(heightAfter, `折点重算后行盒应变矮（${heightBefore} → ${heightAfter}）`).toBeLessThan(heightBefore);
});

test("左缘向左拖 50px → 栏宽 +100（两手柄对称同效）", async ({ page }) => {
  await open(page);
  await dragHandle(page, "left", -50);
  await expect.poll(() => widthToken(page)).toBe("860px");
  expect(await uiValueWrites(page)).toEqual([{ key: "content_width", value: 860 }]);
});

test("上下限：默认即下限（往窄拖不动），触顶 1200 后钳住", async ({ page }) => {
  await open(page);
  await dragHandle(page, "right", -120);
  await expect.poll(() => widthToken(page)).toBe("760px");
  // 无变化 → 松手不写盘
  expect(await uiValueWrites(page)).toEqual([]);
  await dragHandle(page, "right", 2000);
  await expect.poll(() => widthToken(page)).toBe("1200px");
  expect(await uiValueWrites(page)).toEqual([{ key: "content_width", value: 1200 }]);
});

test("写盘失败：toast D121 + 诊断日志，运行期宽度不回滚", async ({ page }) => {
  await open(page, { failures: { config_set_ui_value: { code: "config_write_failed", message: "只读文件系统" } } });
  await dragHandle(page, "right", 60);
  await expect.poll(() => widthToken(page)).toBe("880px");
  await expect(page.locator(".lumir-toast", { hasText: "内容宽度没能存进配置" })).toContainText("只读文件系统");
  await expect(page.locator(".lumir-toast", { hasText: "内容宽度没能存进配置" })).toContainText("本次调整仍生效，重启后恢复");
  // 运行期宽度不回滚（与 remember_last_vault 的「主结果不受写失败影响」同口径）
  expect(await widthToken(page)).toBe("880px");
  const warnings = await page.evaluate(() =>
    ((window as never as { __logEvents: Array<{ event: string; fields: Record<string, string> }> }).__logEvents ?? [])
      .filter((entry) => entry.event === "config_warning")
      .map((entry) => entry.fields.message ?? ""),
  );
  expect(warnings.some((message) => message.includes("只读文件系统"))).toBe(true);
});

// ---------------------------------------------------------------------------
// 配置与模式
// ---------------------------------------------------------------------------

test("配置值启动生效（config 800 → token 800px）", async ({ page }) => {
  await open(page, { config: { content_width: 800 } });
  await expect.poll(() => widthToken(page)).toBe("800px");
  const contentWidth = await page.evaluate(() => document.querySelector(".cm-content")!.getBoundingClientRect().width);
  expect(contentWidth).toBe(800);
});

test("code 模式：手柄按实测矩形贴合（列不居中也不偏）", async ({ page }) => {
  const code = ["const alpha = 1;", "const bravo = 2;", "", "// filler", ...Array.from({ length: 20 }, (_, i) => `const line${i} = ${i};`)].join("\n");
  await stubTauri(page, {
    entries: [{ path: "main.ts", kind: "file", size: code.length, mtime_ms: 0 }],
    files: { "main.ts": code },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="main.ts"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("main.ts");
  await expect.poll(() => page.evaluate(() => (window as never as { __configGets: number }).__configGets)).toBeGreaterThan(0);
  await page.waitForTimeout(80);
  const geometry = await page.evaluate(() => {
    const rect = document.querySelector(".cm-content")!.getBoundingClientRect();
    const left = document.querySelector(".content-width-handle-left")!.getBoundingClientRect();
    const right = document.querySelector(".content-width-handle-right")!.getBoundingClientRect();
    return { rectLeft: rect.left, rectRight: rect.right, leftMid: left.left + left.width / 2, rightMid: right.left + right.width / 2 };
  });
  expect(geometry.leftMid).toBeCloseTo(geometry.rectLeft, 0);
  expect(geometry.rightMid).toBeCloseTo(geometry.rectRight, 0);
  // code 模式下拖拽同样生效（D5：手柄进 code 模式）
  await dragHandle(page, "right", 40);
  await expect.poll(() => widthToken(page)).toBe("840px");
});
