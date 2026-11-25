import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { stubTauri, type VaultFixture } from "./tauri-stub";

const PLAN = "# Plan\n\nQO-DIRECTORY-PLAN\n";
const DEEP = "# Deep\n\nQO-DIRECTORY-DEEP\n";
const EXTERNAL = "# External\n\nQO-EXTERNAL-READONLY\n";
const CN_DIR = "项目资料/2026 年度/这是一个用于验证长目录路径与稳定提示的会议记录";
const USAGE = "输入路径或文件名；可加 :12 这样的行号后缀";
const BULK = Array.from({ length: 105 }, (_, index) => ({
  path: `bulk/item-${String(index).padStart(3, "0")}.md`,
  kind: "file" as const,
}));

const VAULT: VaultFixture = {
  root: "/v",
  entries: [
    { path: "notes", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "notes/plan.md", kind: "file", size: PLAN.length, mtime_ms: 0 },
    { path: "notes/spec.md", kind: "file", size: PLAN.length, mtime_ms: 0 },
    { path: "notes/sub", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "notes/sub/deep.md", kind: "file", size: DEEP.length, mtime_ms: 0 },
    { path: "notes-extra", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "notes-extra/outside.md", kind: "file", size: PLAN.length, mtime_ms: 0 },
    { path: "empty", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "dist", kind: "dir", size: 0, mtime_ms: 0, lazy: true },
    { path: "bulk", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "项目资料", kind: "dir", size: 0, mtime_ms: 0 },
  ],
  files: {
    "notes/plan.md": PLAN,
    "notes/spec.md": PLAN,
    "notes/sub/deep.md": DEEP,
    "dist/lazy.md": PLAN,
  },
  directoryEntries: {
    dist: [
      { path: "dist/lazy.md", kind: "file", size: PLAN.length, mtime_ms: 0, lazy: true },
      { path: "dist/sub", kind: "dir", size: 0, mtime_ms: 0, lazy: true },
    ],
    empty: [],
    bulk: BULK.map((entry) => ({ ...entry, size: PLAN.length, mtime_ms: 0 })),
    [CN_DIR]: [
      { path: `${CN_DIR}/第一次会议.md`, kind: "file", size: PLAN.length, mtime_ms: 0 },
      { path: `${CN_DIR}/归档`, kind: "dir", size: 0, mtime_ms: 0 },
    ],
  },
  externalFiles: {
    "/tmp/external/root.md": EXTERNAL,
    "/tmp/external/sub/child.md": EXTERNAL,
  },
  externalDirectories: {
    "/tmp/external": [
      { path: "/tmp/external/root.md", kind: "file" },
      { path: "/tmp/external/sub", kind: "dir" },
    ],
    "/tmp/external/sub": [{ path: "/tmp/external/sub/child.md", kind: "file" }],
  },
  links: {},
};

async function openQuickOpen(page: Page): Promise<void> {
  await expect(page.locator(".ft-row").first()).toBeVisible();
  await page.keyboard.press("Meta+p");
  await expect(page.locator(".lumir-qo-input")).toBeFocused();
}

async function start(page: Page, fixture: VaultFixture = VAULT): Promise<void> {
  await stubTauri(page, fixture);
  await page.goto("/");
  await openQuickOpen(page);
}

async function fill(page: Page, value: string): Promise<void> {
  await page.locator(".lumir-qo-input").fill(value);
}

test("目录候选：相对/绝对 vault 目录与根只列一层，子目录接受后进入下一层", async ({ page }) => {
  await start(page);
  const input = page.locator(".lumir-qo-input");
  const items = page.locator(".lumir-qo-item");
  for (const raw of ["notes/", "/v/notes/"]) {
    await fill(page, raw);
    await expect(items).toHaveText(["notes/plan.md", "notes/spec.md", "notes/sub/"]);
    await expect(page.locator(".lumir-qo-hint")).toContainText("直接子项 3 条");
    await expect(items.filter({ hasText: "deep.md" })).toHaveCount(0);
    await expect(items.filter({ hasText: "notes-extra" })).toHaveCount(0);
  }
  await page.locator('.lumir-qo-item[title="notes/sub"]').click();
  await expect(input).toHaveValue("notes/sub/");
  await expect(input).toBeFocused();
  await expect(items).toHaveText(["notes/sub/deep.md"]);
  await expect(page.locator(".lumir-qo")).toBeVisible();

  await fill(page, "/v/");
  await expect(page.locator('.lumir-qo-item[title="notes"]')).toHaveText("notes/");
  await expect(page.locator('.lumir-qo-item[title="dist"]')).toHaveText("dist/");
});

test("lazy 与中文长路径：显式目录可见但不进普通索引，目录名和尾斜杠完整", async ({ page }) => {
  await start(page);
  await fill(page, "dist/");
  await expect(page.locator(".lumir-qo-item")).toHaveText(["dist/lazy.md", "dist/sub/"]);
  await expect(page.locator('.lumir-qo-item[title="dist/sub"] .lumir-qo-name')).toHaveText("sub");
  await expect(page.locator('.lumir-qo-item[title="dist/sub"] .lumir-qo-suffix')).toHaveText("/");
  await fill(page, "lazy.md");
  await expect(page.locator(".lumir-qo-item")).toHaveCount(0);

  await fill(page, `${CN_DIR}/`);
  await expect(page.locator(".lumir-qo-item")).toHaveText([
    `${CN_DIR}/第一次会议.md`,
    `${CN_DIR}/归档/`,
  ]);
  await expect(page.locator('.lumir-qo-item[title$="归档"]')).toHaveAttribute(
    "title",
    `${CN_DIR}/归档`,
  );
});

test("外部目录：进入子目录后文件仍走只读打开链", async ({ page }) => {
  await start(page);
  await fill(page, "/tmp/external/");
  await expect(page.locator(".lumir-qo-item")).toHaveText([
    "/tmp/external/root.md",
    "/tmp/external/sub/",
  ]);
  await page.locator('.lumir-qo-item[title="/tmp/external/sub"]').click();
  await expect(page.locator(".lumir-qo-input")).toHaveValue("/tmp/external/sub/");
  await expect(page.locator(".lumir-qo-item")).toHaveText(["/tmp/external/sub/child.md"]);
  await page.locator(".lumir-qo-item").click();
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".modeline-meta")).toContainText("vault 外 · 只读");
  await expect(page.locator(".cm-content")).toContainText("QO-EXTERNAL-READONLY");
});

test("目录分态：文件加斜杠不打开，空目录与不存在不混成普通搜索空态", async ({ page }) => {
  await start(page);
  for (const [raw, text] of [
    ["notes/plan.md/", "目录不存在或不是目录：notes/plan.md"],
    ["ghost/", "目录不存在或不是目录：ghost"],
    ["empty/", "目录为空：empty"],
  ] as const) {
    await fill(page, raw);
    await expect(page.locator(".lumir-qo-item")).toHaveCount(0);
    await expect(page.locator(".lumir-qo-empty")).toBeVisible();
    await expect(page.locator(".lumir-qo-empty")).toHaveText(text);
    await expect(page.getByText(text, { exact: true })).toHaveCount(1);
    await expect(page.locator(".lumir-qo-hint")).toHaveText(USAGE);
    await expect(page.locator(".tab-open")).toHaveCount(0);
  }
});

test("目录不可读：UI 显示专属分态，状态句只在结果区出现一次", async ({ page }) => {
  await start(page, {
    ...VAULT,
    failures: {
      fs_scan_dir: {
        code: "fs_read_failed",
        message: "synthetic unreadable directory",
        params: { path: "notes", reason: "synthetic unreadable directory" },
      },
    },
  });
  await fill(page, "notes/");
  const status = "目录不可读：notes";
  await expect(page.locator(".lumir-qo-empty")).toHaveText(status);
  await expect(page.getByText(status, { exact: true })).toHaveCount(1);
  await expect(page.locator(".lumir-qo-hint")).toHaveText(USAGE);
  await expect(page.locator(".lumir-qo-item")).toHaveCount(0);
});

test("键盘 Enter 进入子目录：焦点保持，aria 与 .is-active 都复位首行", async ({ page }) => {
  await start(page);
  const input = page.locator(".lumir-qo-input");
  await fill(page, "notes/");
  await expect(page.locator(".lumir-qo-item")).toHaveText(["notes/plan.md", "notes/spec.md", "notes/sub/"]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".lumir-qo-item.is-active")).toHaveText("notes/sub/");
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("notes/sub/");
  await expect(input).toBeFocused();
  const first = page.locator(".lumir-qo-item").first();
  await expect(page.locator(".lumir-qo-item")).toHaveText(["notes/sub/deep.md"]);
  await expect(first).toHaveClass(/is-active/);
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(input).toHaveAttribute("aria-activedescendant", await first.getAttribute("id") ?? "");
});

test("目录 pending 与迟到结果：在途不落普通空态，旧扫描不得覆盖新输入", async ({ page }) => {
  const delayed: VaultFixture = {
    ...VAULT,
    directoryDelayMs: { notes: 400 },
  };
  await start(page, delayed);
  await fill(page, "notes/");
  await expect(page.locator(".lumir-qo-empty")).toBeVisible();
  await expect(page.locator(".lumir-qo-empty")).toHaveText("正在读取目录：notes");
  await expect(page.locator(".lumir-qo-empty")).not.toHaveText("没有匹配的条目");
  expect(await page.getByText("正在读取目录：notes", { exact: true }).count()).toBe(1);
  await expect(page.locator(".lumir-qo-hint")).toHaveText(USAGE);
  await fill(page, "plan");
  await expect(page.locator(".lumir-qo-item")).toHaveText(["notes/plan.md"]);
  await page.waitForTimeout(550);
  await expect(page.locator(".lumir-qo-item")).toHaveText(["notes/plan.md"]);
  await expect(page.locator('.lumir-qo-item[title="notes/sub"]')).toHaveCount(0);
});

test("目录候选超过 100 条：只渲染前 100，提示总数与截断", async ({ page }) => {
  await start(page);
  await fill(page, "bulk/");
  await expect(page.locator(".lumir-qo-item")).toHaveCount(100);
  await expect(page.locator(".lumir-qo-item").last()).toHaveText("bulk/item-099.md");
  await expect(page.locator(".lumir-qo-hint")).toContainText("直接子项 105 条，只显示前 100 条");
  for (let index = 0; index < 120; index += 1) await page.keyboard.press("ArrowDown");
  const last = page.locator(".lumir-qo-item").last();
  await expect(last).toHaveClass(/is-active/);
  await expect(last).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".lumir-qo-input")).toHaveAttribute(
    "aria-activedescendant",
    await last.getAttribute("id") ?? "",
  );
  await expect(page.locator(".lumir-qo-item.is-active")).toHaveCount(1);
});

const REVIEW_DIR = process.env.LUMIR_QO_REVIEW_DIR;

async function reviewShot(page: Page, theme: string, name: string): Promise<void> {
  if (REVIEW_DIR === undefined) return;
  mkdirSync(REVIEW_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(REVIEW_DIR, `quick-open-${theme}-${name}-chromium-darwin.png`),
    fullPage: true,
  });
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function inputRect(page: Page): Promise<Rect> {
  const box = await page.locator(".lumir-qo-input").boundingBox();
  expect(box, "输入框 bbox 缺失时必须 FAIL").not.toBeNull();
  return box as Rect;
}

async function expectOverlayInsideViewport(page: Page): Promise<void> {
  const box = await page.locator(".lumir-qo").boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 0.5);
}

for (const theme of ["light", "dark", "eink"] as const) {
  test(`O7 几何（${theme}）：0/1/多/pending/异步/长提示下 input bbox 逐值稳定，resize 不越界`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await start(page, { ...VAULT, config: { theme }, directoryDelayMs: { notes: 400 } });
    const baseline = await inputRect(page);
    const gridAreas = await page.evaluate(() => [".lumir-qo-list", ".lumir-qo-empty"].map((selector) => {
      const style = getComputedStyle(document.querySelector(selector)!);
      return [style.gridRowStart, style.gridColumnStart, style.gridRowEnd, style.gridColumnEnd];
    }));
    expect(gridAreas[0]).toEqual(["1", "1", "auto", "auto"]);
    expect(gridAreas[1]).toEqual(gridAreas[0]);
    expect((await page.locator(".lumir-qo-empty").boundingBox())!.height).toBeCloseTo(164, 0);
    await reviewShot(page, theme, "empty-query");
    const states = [
      { name: "zero-match", raw: "ghost" },
      { name: "one-exact-path-candidate", raw: "notes/plan.md", noDirect: true },
      { name: "many-candidates", raw: "bulk" },
      { name: "directory-pending", raw: "notes/" },
      { name: "async-line-suffix", raw: "notes/plan.md:12", noDirect: true },
      { name: "long-chinese-directory", raw: `${CN_DIR}/` },
      { name: "external-directory", raw: "/tmp/external/" },
      { name: "empty-directory", raw: "empty/" },
      { name: "long-missing-hint", raw: "这是一段用于制造很长提示且不可能存在的目录路径/它还会继续增长以触发折行/" },
    ];
    for (const state of states) {
      await fill(page, state.raw);
      await page.waitForTimeout(180);
      if (state.noDirect === true) await expect(page.locator(".lumir-qo-direct")).toHaveCount(0);
      expect(await inputRect(page), `状态 ${state.raw} 移动了输入框`).toEqual(baseline);
      await expectOverlayInsideViewport(page);
      await reviewShot(page, theme, state.name);
    }
    const popWidth = (await page.locator(".lumir-qo").boundingBox())!.width;
    expect(popWidth).toBeCloseTo(600, 0);
    await fill(page, "bulk");
    await expect(page.locator(".lumir-qo-item")).toHaveCount(100);
    const listHeight = await page.locator(".lumir-qo-list").evaluate((element) => element.getBoundingClientRect().height);
    expect(listHeight).toBeGreaterThanOrEqual(164);

    await page.setViewportSize({ width: 300, height: 320 });
    await expect(page.locator(".lumir-qo")).toBeVisible();
    const resized = await inputRect(page);
    const narrowWidth = (await page.locator(".lumir-qo").boundingBox())!.width;
    expect(narrowWidth).toBeCloseTo(272, 0);
    const narrowStates = [
      { name: "empty-query", raw: "" },
      { name: "zero-match", raw: "ghost" },
      { name: "one-candidate", raw: "notes/plan.md" },
      { name: "many-candidates", raw: "bulk" },
      { name: "long-chinese-directory", raw: `${CN_DIR}/` },
    ];
    for (const state of narrowStates) {
      await fill(page, state.raw);
      await page.waitForTimeout(180);
      expect(await inputRect(page), `窄窗状态 ${state.raw} 移动了输入框`).toEqual(resized);
      await expectOverlayInsideViewport(page);
      await reviewShot(page, theme, `narrow-${state.name}`);
    }
  });
}

test("O7 高度分布：空查询与单候选在可用高度足够时为六行，极端短窗按真实余量收缩", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await start(page);
  for (const height of [240, 320, 400, 440, 479, 800]) {
    await page.setViewportSize({ width: 1200, height });
    await fill(page, "");
    await expect(page.locator(".lumir-qo-empty")).toBeVisible();
    const baseline = await inputRect(page);
    const emptyHeight = (await page.locator(".lumir-qo-empty").boundingBox())!.height;
    if (height >= 320) expect(emptyHeight, `${height}px 空查询应保留六行`).toBeCloseTo(164, 0);
    else {
      expect(emptyHeight, `${height}px 应按可用高度收缩`).toBeLessThan(164);
      expect(emptyHeight).toBeGreaterThan(0);
    }

    await fill(page, "notes/plan.md");
    await expect(page.locator(".lumir-qo-direct")).toHaveCount(0);
    await expect(page.locator(".lumir-qo-item")).toHaveCount(1);
    await expect(page.locator(".lumir-qo-item")).toHaveClass(/is-active/);
    const oneHeight = (await page.locator(".lumir-qo-list").boundingBox())!.height;
    if (height >= 320) expect(oneHeight, `${height}px 单候选应保留六行`).toBeCloseTo(164, 0);
    else expect(oneHeight).toBeLessThan(164);
    expect(await inputRect(page)).toEqual(baseline);

    await fill(page, "这是一段用于制造很长提示且不可能存在的目录路径/它还会继续增长以触发折行/");
    await expect(page.locator(".lumir-qo-empty")).toContainText("目录不存在或不是目录");
    expect(await inputRect(page)).toEqual(baseline);
    await expectOverlayInsideViewport(page);

    await fill(page, "bulk");
    await expect(page.locator(".lumir-qo-item")).toHaveCount(100);
    expect(await inputRect(page)).toEqual(baseline);
    await expectOverlayInsideViewport(page);
    const overlayHeight = (await page.locator(".lumir-qo").boundingBox())!.height;
    expect(overlayHeight, `${height}px 的总高上限`).toBeCloseTo(Math.min(height * 0.8, height - 67), 0);
  }
});

for (const scale of [0.8, 1, 1.5]) {
  test(`O7 字号轴 ${scale}×：内容不改 input bbox，26em/56em 按计算字号夹取`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await start(page);
    const fontSize = 12.5 * scale;
    await page.addStyleTag({
      content: `:root { --fs-ui-s: ${fontSize}px; --fs-ui: ${13 * scale}px; --fs-label: ${12 * scale}px; }`,
    });
    await expect.poll(() => page.locator(".lumir-qo").evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeCloseTo(fontSize, 3);
    const baseline = await inputRect(page);
    for (const raw of ["", "notes/plan.md", "bulk", "这是一段用于制造很长提示且不可能存在的目录路径/它还会继续增长以触发折行/"]) {
      await fill(page, raw);
      if (raw === "bulk") await expect(page.locator(".lumir-qo-item")).toHaveCount(100);
      if (raw.endsWith("/")) await expect(page.locator(".lumir-qo-empty")).toContainText("目录不存在或不是目录");
      expect(await inputRect(page), `${scale}× 下 ${raw || "空查询"} 移动了输入框`).toEqual(baseline);
      await expectOverlayInsideViewport(page);
    }
    const middleWidth = (await page.locator(".lumir-qo").boundingBox())!.width;
    expect(middleWidth).toBeCloseTo(Math.min(Math.max(26 * fontSize, 600), 56 * fontSize), 0);

    const lowerViewport = Math.ceil(52 * fontSize - 40);
    await page.setViewportSize({ width: lowerViewport, height: 800 });
    expect((await page.locator(".lumir-qo").boundingBox())!.width, "26em 下界").toBeCloseTo(26 * fontSize, 0);
    await expectOverlayInsideViewport(page);

    const upperViewport = Math.ceil(112 * fontSize + 40);
    await page.setViewportSize({ width: upperViewport, height: 800 });
    expect((await page.locator(".lumir-qo").boundingBox())!.width, "56em 上界").toBeCloseTo(56 * fontSize, 0);
    await expectOverlayInsideViewport(page);
  });
}

test("Quick Open 独立宽度不改 TOC：打开前后 TOC 计算宽度逐值一致", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await start(page);
  await fill(page, "notes/plan.md");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toContainText("QO-DIRECTORY-PLAN");
  await page.locator(".modeline-section").click();
  const toc = page.locator(".lumir-toc");
  await expect(toc).toBeVisible();
  const before = await toc.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
  }));
  expect(before.width).toBeCloseTo(Math.min(26 * before.fontSize, 1200 - 28), 0);
  await page.keyboard.press("Escape");
  await openQuickOpen(page);
  expect((await page.locator(".lumir-qo").boundingBox())!.width).toBeCloseTo(600, 0);
  await page.keyboard.press("Escape");
  await page.locator(".modeline-section").click();
  const after = (await toc.boundingBox())!.width;
  expect(after).toBe(before.width);
});
