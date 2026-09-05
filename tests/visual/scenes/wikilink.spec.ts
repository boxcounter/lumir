import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { locateWikilinkSpans } from "../../../src/preview/wikilinks";
import { stubTauri } from "./tauri-stub";
import type { VaultFixture } from "./tauri-stub";

// wikilink 前端纪律（架构复查 P1-4 / fixture README）：前端只断言 parseCases 的
// span/embed（span 定位是前端唯一持有的逻辑），解析字段与 resolve/create 由 Rust 侧断言。
// 两侧消费同一 cases.json（frozen spec v1.1 的机器可执行形态）。

interface ParseCase {
  id: string;
  input: string;
  expect: { links: { span: [number, number]; embed: boolean }[] };
}

test("parseCases：span/embed 与 cases.json 一致（双解析器纪律前端侧）", () => {
  const cases = JSON.parse(
    readFileSync(join(process.cwd(), "../wikilink-fixtures/cases.json"), "utf8"),
  ) as { parseCases: ParseCase[] };
  expect(cases.parseCases.length).toBeGreaterThan(0);
  for (const c of cases.parseCases) {
    const spans = locateWikilinkSpans(c.input).map((s) => [s.from, s.to, s.embed]);
    const want = c.expect.links.map((l) => [l.span[0], l.span[1], l.embed]);
    expect(spans, `case ${c.id}`).toEqual(want);
  }
});

// ---------------------------------------------------------------------------
// UI 场景：语义结果由桩按 fixture 注入（前端不复制解析语义，桩也只查表）。
// ---------------------------------------------------------------------------

const ANCHOR_NONE = { status: "none", heading: null, line: null };

const WIKI_VAULT: VaultFixture = {
  entries: [
    { path: "a.md", kind: "file", size: 0, mtime_ms: 1757000000000 },
    { path: "b.md", kind: "file", size: 0, mtime_ms: 1757000000000 },
    { path: "c.md", kind: "file", size: 0, mtime_ms: 1757000000000 },
    { path: "sub", kind: "dir", size: 0, mtime_ms: 1757000000000 },
    { path: "sub/c.md", kind: "file", size: 0, mtime_ms: 1757000000000 },
  ],
  files: {
    "a.md":
      "# A\n\n链到 [[b]]，歧义 [[c]]，未创建 [[missing]]，带锚点 [[b#目标]]，锚点缺失 [[b#没有]]。\n",
    "b.md": "# B\n\n## 目标\n\n目标内容。\n",
    "c.md": "# C\n",
    "sub/c.md": "# C2\n",
  },
  links: {
    "[[b]]": { status: "resolved", path: "b.md", candidates: [], embed_target: null, anchor: ANCHOR_NONE },
    "[[c]]": {
      status: "ambiguous",
      path: "c.md",
      candidates: ["c.md", "sub/c.md"],
      embed_target: null,
      anchor: ANCHOR_NONE,
    },
    "[[b#目标]]": {
      status: "resolved",
      path: "b.md",
      candidates: [],
      embed_target: null,
      anchor: { status: "found", heading: "目标", line: 3 },
    },
    "[[b#没有]]": {
      status: "resolved",
      path: "b.md",
      candidates: [],
      embed_target: null,
      anchor: { status: "missing", heading: "没有", line: null },
    },
    // [[missing]] 未收录 → 桩按 unresolved 应答
  },
  creates: { "[[missing]]": "missing.md" },
};

async function openA(page: import("@playwright/test").Page): Promise<void> {
  await stubTauri(page, WIKI_VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="a.md"]').click();
}

test("链接三态显示（resolved / ambiguous / unresolved）", async ({ page }) => {
  await openA(page);
  // resolved：正常链接样式，显示 target
  await expect(page.locator('.cm-lp-wikilink-resolved', { hasText: "b" }).first()).toBeVisible();
  // ambiguous：链接样式 + 歧义标识 + 悬停候选列表
  const ambiguous = page.locator(".cm-lp-wikilink-ambiguous");
  await expect(ambiguous).toContainText("c");
  await expect(ambiguous.locator(".cm-lp-wikilink-badge")).toHaveText("歧义");
  await expect(ambiguous).toHaveAttribute("title", /c\.md\nsub\/c\.md/);
  // unresolved：未创建样式，区分显示但不是错误
  await expect(page.locator(".cm-lp-wikilink-unresolved")).toContainText("missing");
  await expect(page).toHaveScreenshot("wikilink-states.png");
});

test("点击跳转：Mod-Click 跟随，锚点命中定位，锚点缺失给提示", async ({ page }) => {
  await openA(page);
  // 裸点击不拦截：不跳转、无 toast，选区正常落点（编辑器当前全局只读，
  // 「可编辑」以 selection 落进 .cm-content 为判定；修复前 preventDefault 会吞掉落点）
  const anchored = page.locator(".cm-lp-wikilink-resolved", { hasText: "b#目标" });
  await anchored.waitFor();
  await anchored.click();
  await expect(page.locator(".cm-content")).toContainText("b#目标"); // 仍在 a.md
  await expect(page.locator(".lumir-toast")).toHaveCount(0);
  const selInEditor = await page.evaluate(() => {
    const s = window.getSelection();
    const content = document.querySelector(".cm-content");
    return s !== null && content !== null && content.contains(s.anchorNode);
  });
  expect(selInEditor).toBe(true);
  await page.locator('.ft-row[title="a.md"]').click(); // 还原现场

  // Mod-Click 锚点命中：打开 b.md 并定位到标题行
  await anchored.waitFor();
  await anchored.click({ modifiers: ["Meta"] });
  await expect(page.locator(".cm-content")).toContainText("目标内容");

  // Mod-Click 锚点缺失：打开文件并提示「标题未找到」，不静默停在顶部
  await page.locator('.ft-row[title="a.md"]').click();
  const missingAnchor = page.locator(".cm-lp-wikilink-resolved", { hasText: "b#没有" });
  await missingAnchor.waitFor();
  await missingAnchor.click({ modifiers: ["Meta"] });
  await expect(page.locator(".cm-content")).toContainText("目标内容");
  await expect(page.locator(".lumir-toast")).toContainText("标题未找到：没有");
});

test("未创建链接一键创建并转为正常态", async ({ page }) => {
  await openA(page);
  const unresolved = page.locator(".cm-lp-wikilink-unresolved");
  await unresolved.waitFor();
  await unresolved.click({ modifiers: ["Meta"] });
  const toastEl = page.locator(".lumir-toast");
  await expect(toastEl).toContainText("未创建的链接：[[missing]]");
  await toastEl.getByRole("button", { name: "创建并打开" }).click();
  await expect(page.locator(".lumir-toast")).toContainText("已创建：missing.md");
});
