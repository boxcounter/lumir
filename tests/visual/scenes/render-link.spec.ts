import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubTauri, openedUrls } from "./tauri-stub";
import { readDocument } from "./parity-checks";
import { externalUrlOf } from "../../../src/preview/links";

// 标准 Markdown 外链的 live preview 渲染与激活（M144）。
//
// 两个口径在本场景钉住：
// 1. 渲染——`[title](url)` 呈现为 `title` + 尾部 ↗︎ 标记，括号与 URL 源码被 replace
//    装饰隐藏，**文档逐字节不变**（ADR 0003 §3 铁律）。
// 2. 激活——⌘⏎ 与 ⌘-Click 走同一条外链路径。真机上这条路径的终点是系统浏览器；
//    chromium 里由桩的 invoke 路由记账（`open_external_url` → `window.__openedUrls`），
//    所以本场景能断言「开的是哪个 URL」而**不真的唤起浏览器**（Rust 侧的最终调用与
//    scheme 校验由 cargo 单测与真机验收场景覆盖）。

const links = readFileSync(new URL("../fixtures/render-link/links.md", import.meta.url), "utf8");
const SITE = "https://example.invalid/site";
const MAIL = "mailto:someone@example.invalid";
const WRAPPED = "https://example.invalid/wrapped";
const CELL = "https://example.invalid/cell";
// 五条外链：正文三处 + 表格两个数据行各一处（渲染数量在下面各断言里复用）。
const EXTERNAL_LINKS = 5;
// ↗︎ = U+2197 + U+FE0E（变体选择符 VS15，强制文字表现而非 emoji）。
const MARK = "\u2197\uFE0E";

/** scheme 白名单与解码口径是纯函数：直接钉住，不依赖渲染。 */
test("外链目标判定：scheme 白名单与尖括号/转义解码", () => {
  expect(externalUrlOf("https://example.invalid/a")).toBe("https://example.invalid/a");
  expect(externalUrlOf("HTTP://example.invalid/a")).toBe("HTTP://example.invalid/a");
  expect(externalUrlOf("mailto:a@b.invalid")).toBe("mailto:a@b.invalid");
  // 尖括号包裹（CommonMark 形式）与反斜杠转义：取出的是真正要打开的目标
  expect(externalUrlOf("<https://example.invalid/a>")).toBe("https://example.invalid/a");
  expect(externalUrlOf("https://example.invalid/a\\(b\\)")).toBe("https://example.invalid/a(b)");
  // 非外链：相对路径 / 锚点 / 其它 scheme / 无 scheme
  expect(externalUrlOf("note.md")).toBeNull();
  expect(externalUrlOf("./sub/note.md")).toBeNull();
  expect(externalUrlOf("#heading")).toBeNull();
  expect(externalUrlOf("javascript:alert(1)")).toBeNull();
  expect(externalUrlOf("file:///etc/hosts")).toBeNull();
  expect(externalUrlOf("obsidian://open?vault=x")).toBeNull();
  // 目标里含空白或控制字符：还原不可信，不开
  expect(externalUrlOf("https://example.invalid/a b")).toBeNull();
  expect(externalUrlOf("https://example.invalid/a\u0007b")).toBeNull();
});

async function open(page: Page): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: "links.md", kind: "file", size: links.length, mtime_ms: 0 }],
    files: { "links.md": links },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="links.md"]').click();
  await expect(page.locator(".cm-lp-link")).toHaveCount(EXTERNAL_LINKS);
}

/** 把 CM 选区设到某个偏移并聚焦（「光标落在链接上」的显式构造）。 */
async function setCursor(page: Page, pos: number): Promise<void> {
  await page.locator(".cm-content").evaluate((el, p) => {
    const tile = (el as unknown as { cmTile?: { root: { view: { dispatch: (t: unknown) => void; focus: () => void } } } }).cmTile;
    if (!tile) throw new Error("CodeMirror view unavailable");
    tile.root.view.dispatch({ selection: { anchor: p } });
    tile.root.view.focus();
  }, pos);
}

test("外链渲染为 title + ↗︎，非外链保持原文，文档逐字节不变", async ({ page }) => {
  await open(page);

  // 五条外链（https / mailto / 尖括号包裹 / 表格 cell 内两处）渲染成链接，其余一律原文
  await expect(page.locator(".cm-lp-link")).toHaveCount(EXTERNAL_LINKS);
  await expect(page.locator(".cm-lp-link-mark")).toHaveCount(EXTERNAL_LINKS);
  const marks = page.locator(".cm-lp-link-mark");
  await expect(marks).toHaveText([MARK, MARK, MARK, MARK, MARK]);

  // 显示文本是 title，URL 源码被隐藏（渲染态下不可见）
  const rendered = await page.locator(".cm-content").innerText();
  expect(rendered).toContain("示例站点");
  expect(rendered).not.toContain(SITE);
  expect(rendered).not.toContain(WRAPPED);

  // URL 经 title 属性给出（悬停可见、读屏可取——源码里的 URL 被隐藏后信息不丢）
  await expect(page.locator(".cm-lp-link").first()).toHaveAttribute("title", SITE);

  // 非外链保持原文：相对路径、锚点、裸网址、自动链接、行内代码、白名单外 scheme
  expect(rendered).toContain("[本地笔记](note.md)");
  expect(rendered).toContain("[去标题](#外链)");
  expect(rendered).toContain("https://example.invalid/bare");
  expect(rendered).toContain("<https://example.invalid/auto>");
  expect(rendered).toContain("`[代码里的](https://example.invalid/code)`");
  expect(rendered).toContain("[别开我](javascript:alert(1))");

  // 渲染不写文档（源码保护）
  expect(await readDocument(page)).toBe(links);

  await expect(page).toHaveScreenshot("render-link.png");
});

test("表格 cell 内的外链照常渲染，表格仍是 grid", async ({ page }) => {
  // spec delta 的「表格 cell 内的外链」场景：链接整条落在某个 cell 内时照常渲染。
  // 反例（链接标题里出现**未转义**管道符）不需要断言：那种写法会把行切成两个 cell，
  // lezer 至此不再产出 Link 节点（实测：`| [x | y](u) |` 里只有 URL 节点、没有 Link），
  // 该处自然保持原文；表格自身还会因为 cell 数多于表头而整块降级（表格合同，另有场景）。
  await open(page);

  await expect(page.locator(".cm-lp-table")).toHaveCount(1);
  const inCell = page.locator(".cm-lp-table .cm-lp-link", { hasText: "表格内外链" });
  await expect(inCell).toHaveCount(1);
  await expect(inCell).toHaveAttribute("title", CELL);
  await expect(page.locator(".cm-lp-table .cm-lp-link-mark")).toHaveCount(2);

  // 渲染态下 cell 内的 URL 源码同样被隐藏，显示文本是 title
  const rendered = await page.locator(".cm-content").innerText();
  expect(rendered).toContain("表格内外链");
  expect(rendered).not.toContain(CELL);
  expect(rendered).not.toContain("example.invalid/cell2");
  // cell 文本没有被链接装饰吞掉：同一行的第二列仍在
  expect(rendered).toContain("单元格文本");
  expect(await readDocument(page)).toBe(links);
});

test("光标落在链接上显露源码，离开即恢复渲染", async ({ page }) => {
  await open(page);
  const first = page.locator(".cm-lp-link").first();
  await expect(first).toBeVisible();

  // 光标进链接：该条整条显露源码（编辑态与渲染前一致，也避免长 URL 被隐藏后产生
  // 中间大段「按键光标不动」的死区）
  const start = links.indexOf("[示例站点]");
  await setCursor(page, start + 3);
  await expect(page.locator(".cm-lp-link")).toHaveCount(EXTERNAL_LINKS - 1);
  const revealed = await page.locator(".cm-content").innerText();
  expect(revealed).toContain("[示例站点](https://example.invalid/site)");

  // 光标离开：回到渲染态
  await setCursor(page, start - 1);
  await expect(page.locator(".cm-lp-link")).toHaveCount(EXTERNAL_LINKS);
  const restored = await page.locator(".cm-content").innerText();
  expect(restored).not.toContain(SITE);
  // 显露/恢复都只是装饰层的事，文档始终没变
  expect(await readDocument(page)).toBe(links);
});

test("光标停在链接起点也开得动（文档首字符即外链）", async ({ page }) => {
  // 真实情形：打开一份首行就是外链的笔记，选区复位到 0——恰好是链接的起点。
  // 这条路曾经断在 `resolveInner(pos, 0)` 上：起点处它给的是父节点（Paragraph /
  // Document）而不是 Link，⌘⏎ 静默无反应（无声失败最坏）。这里钉住起点可命中。
  const doc = "[起点外链](https://example.invalid/start)\n\n后续正文。\n";
  await stubTauri(page, {
    entries: [{ path: "start.md", kind: "file", size: doc.length, mtime_ms: 0 }],
    files: { "start.md": doc },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="start.md"]').click();
  await expect(page.locator(".cm-lp-link")).toHaveCount(1);

  await page.keyboard.press("Meta+Enter");
  await expect.poll(async () => openedUrls(page)).toEqual(["https://example.invalid/start"]);
});

test("⌘⏎ 与 ⌘-Click 打开外链：目标取自正文，非链接处无操作", async ({ page }) => {
  await open(page);
  const start = links.indexOf("[示例站点]");

  // 光标不在链接上：⌘⏎ 无操作
  await setCursor(page, start - 1);
  await page.keyboard.press("Meta+Enter");
  expect(await openedUrls(page)).toEqual([]);

  // 光标落在链接起点上：⌘⏎ 打开该 URL（起点算「在链接上」）
  await setCursor(page, start);
  await page.keyboard.press("Meta+Enter");
  await expect.poll(async () => openedUrls(page)).toEqual([SITE]);

  // ⌘-Click 走同一条路径：点邮件链接，打开的是 mailto 目标
  await page.locator(".cm-lp-link", { hasText: "写邮件" }).click({ modifiers: ["Meta"] });
  await expect.poll(async () => openedUrls(page)).toEqual([SITE, MAIL]);

  // 尖括号包裹形式：开的是包裹里的目标，不是带尖括号的原文
  await setCursor(page, links.indexOf("[包裹形式]"));
  await page.keyboard.press("Meta+Enter");
  await expect.poll(async () => openedUrls(page)).toEqual([SITE, MAIL, WRAPPED]);

  // 裸点击不跟随（链接文本照常可落点编辑），也不再产生打开请求
  await page.locator(".cm-lp-link", { hasText: "示例站点" }).click();
  const selectionInEditor = await page.evaluate(() => {
    const selection = window.getSelection();
    const content = document.querySelector(".cm-content");
    return selection !== null && content !== null && content.contains(selection.anchorNode);
  });
  expect(selectionInEditor).toBe(true);
  expect(await openedUrls(page)).toEqual([SITE, MAIL, WRAPPED]);
});
