import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

const combo = readFileSync(new URL("../fixtures/markdown-combo/combo.md", import.meta.url), "utf8");
const longFrontmatter = readFileSync(new URL("../fixtures/markdown-combo/frontmatter-200.md", import.meta.url), "utf8");
const image = readFileSync(new URL("../fixtures/markdown-combo/sample.svg", import.meta.url), "utf8");

async function open(page: Parameters<typeof stubTauri>[0], text = combo, path = "combo.md", failures?: Record<string, { code: string; message: string }>) {
  await stubTauri(page, {
    entries: [path, "assets/sample.svg", "assets/missing.png", "assets/missing.svg"].map((entry) => ({ path: entry, kind: "file", size: text.length, mtime_ms: 0 })),
    files: { [path]: text, "assets/sample.svg": image },
    links: {
      "![[sample.svg]]": { status: "resolved", path: "assets/sample.svg", candidates: [], embed_target: "attachment", anchor: { status: "none", heading: null, line: null } },
      "![[missing.svg]]": { status: "unresolved", path: null, candidates: [], embed_target: null, anchor: { status: "none", heading: null, line: null } },
    },
    failures,
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${path}"]`).click();
}

for (const width of [1280, 640] as const) {
  test(`Markdown组合首帧、宽窄与源码保护 ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await open(page);
      await expect(page.locator(".cm-content")).toContainText("Combination heading");
      await expect(page.locator(".cm-lp-frontmatter")).toContainText("Combination fixture");
      await expect(page.locator(".cm-lp-frontmatter .cm-lp-tag")).toHaveCount(2);
      await expect(page.locator(".cm-lp-list-marker")).toHaveCount(4);
      await page.locator(".cm-scroller").evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await expect(page.locator(".cm-lp-embed-unsupported")).toHaveCount(1);
      await expect(page.locator(".cm-lp-image-status, .cm-lp-image-error").first()).toBeVisible();
      await expect(page.locator(".cm-scroller")).toHaveCSS("overflow-y", "auto");
      expect(await readDocument(page)).toBe(combo);
      await page.locator(".cm-content").click();
      await page.setViewportSize({ width: width === 640 ? 1280 : 640, height: 1000 });
      expect(await readDocument(page)).toBe(combo);
      // md 自本地保存契约（f80ef8b）起可编辑：键盘输入按设计进文档，装饰层不得
      // 拦截编辑。旧断言来自 M1 只读时代，与已落地特性冲突，按现行特性修正。
      await page.keyboard.type("a");
      expect(await readDocument(page)).not.toBe(combo);
    });
}

test("frontmatter空、非法、未闭合与超过200行边界稳定降级", async ({ page }) => {
  const cases = [
    ["empty.md", "---\n---\n\n# empty"],
    ["invalid.md", "---\ntitle: [unterminated\n---\n\n# invalid"],
    ["unclosed.md", "---\ntitle: never closes\n\n# body"],
    ["long.md", longFrontmatter],
  ] as const;
  await stubTauri(page, {
    entries: cases.map(([path]) => ({ path, kind: "file", size: 100, mtime_ms: 0 })),
    files: Object.fromEntries(cases),
  });
  await page.goto("/");
  await page.locator('.ft-row[title="empty.md"]').click();
  await expect(page.locator(".cm-lp-fm-empty")).toHaveText("（空 frontmatter）");
  await page.locator('.ft-row[title="invalid.md"]').click();
  await expect(page.locator(".cm-lp-fm-error")).toContainText("解析失败");
  await expect(page.locator(".cm-lp-fm-raw")).toContainText("unterminated");
  await page.locator('.ft-row[title="unclosed.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("never closes");
  await expect(page.locator(".cm-lp-frontmatter")).toHaveCount(0);
  await page.locator('.ft-row[title="long.md"]').click();
  await expect(page.locator(".cm-lp-frontmatter")).toContainText("key204");
  expect(await readDocument(page)).toBe(longFrontmatter);
});

test("附件读取失败后保持明确错误占位", async ({ page }) => {
  await open(page, combo, "combo.md", { fs_read_attachment: { code: "fs_denied", message: "fixture read failure" } });
  await expect(page.locator(".cm-lp-image-error")).toHaveCount(3);
  await expect(page.locator(".cm-lp-image-error").first()).toContainText("图片读取失败");
  expect(await readDocument(page)).toBe(combo);
});

test("图片解码失败后错误占位保持可见", async ({ page }) => {
  await stubTauri(page, {
    entries: [{ path: "decode-failure.md", kind: "file", size: 53, mtime_ms: 0 }, { path: "assets/broken.svg", kind: "file", size: 13, mtime_ms: 0 }],
    files: { "decode-failure.md": "# Decode failure\n\n![broken image](assets/broken.svg)\n" },
  });
  await page.goto("/");
  await page.evaluate(() => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = async (command: string, args: unknown) => command === "fs_read_attachment" ? "not-valid-base64" : original(command, args);
  });
  await page.locator('.ft-row[title="decode-failure.md"]').click();
  await expect(page.locator(".cm-lp-image-error")).toContainText("图片解码失败");
  await expect(page.locator(".cm-lp-image img")).toHaveCount(0);
});
