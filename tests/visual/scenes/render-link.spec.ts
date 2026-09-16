import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubTauri, openedUrls, openedPaths, noteResolves, logEvents, fileText } from "./tauri-stub";
import { readDocument } from "./parity-checks";
import { classifyLinkTarget } from "../../../src/preview/links";

// 标准 Markdown 链接的 live preview 渲染与激活（M144 引入外链，M145 补齐全形态矩阵）。
//
// 三个口径在本场景钉住：
// 1. **分类**——装饰与激活的判据只有目标原文（links.ts 的 classifyLinkTarget）：
//    http/https/mailto = 外链，相对路径 md = 应用内跳转，相对路径非 md = vault 内资产，
//    纯锚点 = 应用内语义（当前只提示），白名单外 scheme = 原文不装饰。
// 2. **渲染**——`[title](target)` 呈现为 `title` + 尾部标记（↗︎ 会离开本应用 / → 应用内
//    跳转），括号与目标源码被 replace 装饰隐藏，**文档逐字节不变**（ADR 0003 §3 铁律）。
// 3. **激活**——⌘⏎ 与 ⌘-Click 走同一条 `link.follow`。真机上外链的终点是系统浏览器、
//    资产的终点是系统默认应用；chromium 里由桩的 invoke 路由记账（`open_external_url`
//    → `window.__openedUrls`，`link_open_path` → `window.__openedPaths`），所以本场景能
//    断言「开的是哪个目标」而**不真的唤起浏览器或打开文件**（Rust 侧的校验由 cargo 单测
//    与真机验收场景覆盖）。

const links = readFileSync(new URL("../fixtures/render-link/links.md", import.meta.url), "utf8");
const SITE = "https://example.invalid/site";
const MAIL = "mailto:someone@example.invalid";
const WRAPPED = "https://example.invalid/wrapped";
const CELL = "https://example.invalid/cell";
// ↗︎ = U+2197 + U+FE0E（变体选择符 VS15，强制文字表现而非 emoji）；→ = U+2192。
const EXT = "\u2197\uFE0E";
const INT = "\u2192";
// 装饰掉的链接数（javascript: 那条保持原文）与按文档顺序排列的标记。
const LINKS = 13;
const MARKS = [EXT, INT, INT, INT, INT, INT, EXT, EXT, INT, EXT, EXT, EXT, INT];

/** 形态分类是纯函数：直接钉住整张矩阵，不依赖渲染。 */
test("链接形态分类：外链 / 应用内 / 资产 / 锚点 / 不可用", () => {
  // 白名单内的 scheme = 外链（大小写不敏感，尖括号与反斜杠转义解码）
  expect(classifyLinkTarget("https://example.invalid/a")).toEqual({
    kind: "external",
    url: "https://example.invalid/a",
  });
  expect(classifyLinkTarget("HTTP://example.invalid/a")).toEqual({
    kind: "external",
    url: "HTTP://example.invalid/a",
  });
  expect(classifyLinkTarget("mailto:a@b.invalid")).toEqual({
    kind: "external",
    url: "mailto:a@b.invalid",
  });
  expect(classifyLinkTarget("<https://example.invalid/a>")).toEqual({
    kind: "external",
    url: "https://example.invalid/a",
  });
  expect(classifyLinkTarget("https://example.invalid/a\\(b\\)")).toEqual({
    kind: "external",
    url: "https://example.invalid/a(b)",
  });

  // 无 scheme：`.md` 与无扩展名 = 应用内笔记（含 `./` `../`、`../` 前缀、锚点后缀）
  for (const target of ["note.md", "./sub/note.md", "../note.md", "配置", "note.md#section"]) {
    expect(classifyLinkTarget(target)).toEqual({ kind: "internal", target });
  }
  // 目录与其它扩展名 = vault 内资产（交系统默认应用）
  for (const target of ["docs/manual.pdf", "docs/", "./", "archive.zip", "图片.png"]) {
    expect(classifyLinkTarget(target)).toEqual({ kind: "asset", target });
  }
  // 纯锚点
  expect(classifyLinkTarget("#heading")).toEqual({ kind: "anchor" });

  // 白名单外 scheme / 空目标 / 控制字符：不装饰也不激活
  for (const target of [
    "javascript:alert(1)",
    "file:///etc/hosts",
    "obsidian://open?vault=x",
    "https://example.invalid/a b",
    "https://example.invalid/a\u0007b",
    "",
    "\u0007",
  ]) {
    expect(classifyLinkTarget(target)).toEqual({ kind: "blocked" });
  }
});

async function open(page: Page): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: "links.md", kind: "file", size: links.length, mtime_ms: 0 }],
    files: { "links.md": links },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="links.md"]').click();
  await expect(page.locator(".cm-lp-link")).toHaveCount(LINKS);
}

/** 打开一份只含一条链接的最小文档（激活路径的场景用，互不干扰）。 */
async function openDoc(page: Page, name: string, doc: string, extra: Record<string, unknown> = {}): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: name, kind: "file", size: doc.length, mtime_ms: 0 }],
    files: { [name]: doc },
    ...extra,
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${name}"]`).click();
  await expect(page.locator(".cm-content")).toBeVisible();
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

test("全部形态都装饰：标记语义正确，白名单外 scheme 保持原文，文档逐字节不变", async ({ page }) => {
  await open(page);

  // 13 条链接都渲染成 title + 标记，标记按文档顺序与类别一一对应
  await expect(page.locator(".cm-lp-link")).toHaveCount(LINKS);
  await expect(page.locator(".cm-lp-link-mark")).toHaveCount(LINKS);
  expect(await page.locator(".cm-lp-link-mark").allInnerTexts()).toEqual(MARKS);

  // 目标源码被隐藏：外链 URL、相对路径、锚点都不在渲染态出现
  const rendered = await page.locator(".cm-content").innerText();
  expect(rendered).toContain("示例站点");
  expect(rendered).not.toContain(SITE);
  expect(rendered).not.toContain(WRAPPED);
  expect(rendered).not.toContain("note.md");
  expect(rendered).not.toContain("docs/manual.pdf");
  expect(rendered).not.toContain("#链接");

  // 目标经 title 属性给出：外链给解码后的 URL，应用内给原样的目标（悬停可见、读屏可取）
  await expect(page.locator(".cm-lp-link", { hasText: "示例站点" })).toHaveAttribute("title", SITE);
  await expect(page.locator(".cm-lp-link", { hasText: "说明书" })).toHaveAttribute("title", "docs/manual.pdf");
  await expect(page.locator(".cm-lp-link", { hasText: "本地笔记" })).toHaveAttribute("title", "note.md");

  // 白名单外 scheme、自动链接、裸网址、行内代码里的链接一律原文
  expect(rendered).toContain("[别开我](javascript:alert(1))");
  expect(rendered).toContain("https://example.invalid/bare");
  expect(rendered).toContain("<https://example.invalid/auto>");
  expect(rendered).toContain("`[代码里的](https://example.invalid/code)`");

  // 渲染不写文档（源码保护）
  expect(await readDocument(page)).toBe(links);

  await expect(page).toHaveScreenshot("render-link.png");
});

test("表格 cell 内的链接照常渲染，表格仍是 grid", async ({ page }) => {
  // spec delta 的「表格 cell 内的链接」场景：链接整条落在某个 cell 内时照常渲染，
  // 且外链与内链各走各的类别。反例（链接标题里出现**未转义**管道符）不需要断言：
  // 那种写法会把行切成两个 cell，lezer 至此不再产出 Link 节点（实测：`| [x | y](u) |`
  // 里只有 URL 节点、没有 Link），该处自然保持原文；表格自身还会因为 cell 数多于表头
  // 而整块降级（表格合同，另有场景）。
  await open(page);

  await expect(page.locator(".cm-lp-table")).toHaveCount(1);
  const external = page.locator(".cm-lp-table .cm-lp-link", { hasText: "表格内外链" });
  await expect(external).toHaveCount(1);
  await expect(external).toHaveAttribute("title", CELL);
  const internal = page.locator(".cm-lp-table .cm-lp-link", { hasText: "表格内笔记" });
  await expect(internal).toHaveAttribute("title", "guide.md");
  // cell 内的两个标记：外链 ↗︎、内链 →
  expect(await page.locator(".cm-lp-table .cm-lp-link-mark").allInnerTexts()).toEqual([EXT, INT]);

  // 渲染态下 cell 内的目标源码同样被隐藏，显示文本是 title
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
  await expect(page.locator(".cm-lp-link")).toHaveCount(LINKS - 1);
  const revealed = await page.locator(".cm-content").innerText();
  expect(revealed).toContain("[示例站点](https://example.invalid/site)");

  // 应用内链接同样整条显露（隐藏的是 `(target)` 而不是只有 URL）
  await setCursor(page, links.indexOf("[本地笔记]") + 2);
  expect(await page.locator(".cm-content").innerText()).toContain("[本地笔记](note.md)");

  // 光标离开：回到渲染态
  await setCursor(page, start - 1);
  await expect(page.locator(".cm-lp-link")).toHaveCount(LINKS);
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
  await openDoc(page, "start.md", doc);
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

test("相对路径 md 链接：⌘⏎ 走应用内跳转，打开目标笔记", async ({ page }) => {
  const doc = "[指南](docs/guide.md)\n\n正文段落。\n";
  await openDoc(page, "guides.md", doc, {
    entries: [
      { path: "guides.md", kind: "file", size: doc.length, mtime_ms: 0 },
      { path: "docs", kind: "dir", size: 0, mtime_ms: 0 },
      { path: "docs/guide.md", kind: "file", size: 20, mtime_ms: 0 },
    ],
    files: { "guides.md": doc, "docs/guide.md": "# 指南\n\n指南内容。\n" },
    noteLinks: { "guides.md\ndocs/guide.md": "docs/guide.md" },
  });
  await expect(page.locator(".cm-lp-link-mark")).toHaveText([INT]);

  // 起点即链接起点：⌘⏎ 经 link_resolve_note 解析后走既有 openFile 链路
  await setCursor(page, 0);
  await page.keyboard.press("Meta+Enter");
  await expect.poll(async () => noteResolves(page)).toEqual([
    { from: "guides.md", target: "docs/guide.md" },
  ]);
  await expect(page.locator(".cm-content")).toContainText("指南内容。");

  // 也没有走系统打开路径
  expect(await openedUrls(page)).toEqual([]);
  expect(await openedPaths(page)).toEqual([]);
  // 诊断事件记下类别与结果（internal-md），「按了 ⌘⏎ 之后发生了什么」可查
  expect(await logEvents(page, "link_open")).toEqual([
    { event: "link_open", fields: { category: "internal-md", outcome: "opened" } },
  ]);
});

test("相对路径 md 解析不到：只提示、不创建文件", async ({ page }) => {
  const doc = "[不存在的笔记](missing.md)\n\n正文段落。\n";
  await openDoc(page, "source.md", doc);
  await expect(page.locator(".cm-lp-link-mark")).toHaveText([INT]);

  await setCursor(page, 0);
  await page.keyboard.press("Meta+Enter");

  await expect(page.locator(".lumir-toast", { hasText: "链接目标不存在：missing.md" })).toBeVisible();
  // 没有跳到别处（仍在原文档），也没有凭空建出文件（一键创建是 wikilink 的动作）
  expect(await page.locator(".cm-content").innerText()).toContain("正文段落。");
  expect(await fileText(page, "missing.md")).toBeUndefined();
  expect(await openedUrls(page)).toEqual([]);
  expect(await logEvents(page, "link_open")).toEqual([
    { event: "link_open", fields: { category: "internal-md", outcome: "unresolved" } },
  ]);
});

test("纯锚点：装饰为 →，激活只给「暂不支持锚点跳转」提示", async ({ page }) => {
  const doc = "[去标题](#小节)\n\n正文段落。\n";
  await openDoc(page, "anchor.md", doc);
  await expect(page.locator(".cm-lp-link-mark")).toHaveText([INT]);

  await setCursor(page, 0);
  await page.keyboard.press("Meta+Enter");
  await expect(page.locator(".lumir-toast", { hasText: "暂不支持锚点跳转" })).toBeVisible();
  // 不滚动、不跳转、不开系统应用：文档与选区路径都没被碰过
  expect(await page.locator(".cm-content").innerText()).toContain("正文段落。");
  expect(await openedUrls(page)).toEqual([]);
  expect(await openedPaths(page)).toEqual([]);
  expect(await logEvents(page, "link_open")).toEqual([
    { event: "link_open", fields: { category: "anchor", outcome: "unsupported" } },
  ]);
});

test("白名单外 scheme：不装饰也不激活，无副作用", async ({ page }) => {
  const doc = "[别开我](javascript:alert(1))\n\n正文段落。\n";
  await openDoc(page, "blocked.md", doc);
  // 保持原文：没有链接 mark，也没有标记
  await expect(page.locator(".cm-lp-link")).toHaveCount(0);
  await expect(page.locator(".cm-lp-link-mark")).toHaveCount(0);
  expect(await page.locator(".cm-content").innerText()).toContain("[别开我](javascript:alert(1))");

  await setCursor(page, 1);
  await page.keyboard.press("Meta+Enter");
  // 「按了没反应」在日志里留下分类：不可用是被拒的，不是没实现
  expect(await logEvents(page, "link_open")).toEqual([
    { event: "link_open", fields: { category: "blocked-scheme", outcome: "rejected" } },
  ]);
  expect(await page.locator(".lumir-toast")).toHaveCount(0);
  expect(await openedUrls(page)).toEqual([]);
  expect(await openedPaths(page)).toEqual([]);
  expect(await readDocument(page)).toBe(doc);
});

test("相对路径非 md：⌘⏎ 交系统默认应用；被拒时给提示", async ({ page }) => {
  const doc = "[说明书](docs/manual.pdf)\n\n正文段落。\n";
  await openDoc(page, "asset.md", doc, {
    entries: [
      { path: "asset.md", kind: "file", size: doc.length, mtime_ms: 0 },
      { path: "docs/manual.pdf", kind: "file", size: 42, mtime_ms: 0 },
    ],
    files: { "asset.md": doc },
  });
  await expect(page.locator(".cm-lp-link-mark")).toHaveText([EXT]);

  await setCursor(page, 0);
  await page.keyboard.press("Meta+Enter");
  await expect.poll(async () => openedPaths(page)).toEqual([
    { from: "asset.md", target: "docs/manual.pdf" },
  ]);
  // 走的是资产路径，不是外链路径，也没有应用内跳转
  expect(await openedUrls(page)).toEqual([]);
  expect(await noteResolves(page)).toEqual([]);
  expect(await page.locator(".lumir-toast")).toHaveCount(0);
});

test("相对路径非 md 被拒（越出 vault / 不存在）：透传人话提示", async ({ page }) => {
  const doc = "[越界](../outside.pdf)\n\n正文段落。\n";
  await openDoc(page, "asset.md", doc, {
    failures: {
      link_open_path: {
        code: "link_path_rejected",
        message: "打不开这个目标：../outside.pdf——它不在 vault 内",
      },
    },
  });
  await expect(page.locator(".cm-lp-link-mark")).toHaveText([EXT]);

  await setCursor(page, 0);
  await page.keyboard.press("Meta+Enter");
  await expect(
    page.locator(".lumir-toast", { hasText: "打不开这个目标：../outside.pdf——它不在 vault 内" }),
  ).toBeVisible();
  // 打开失败不改文档，也不落在原地不动装作成功
  expect(await readDocument(page)).toBe(doc);
});
