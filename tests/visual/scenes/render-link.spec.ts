import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { readFileSync } from "node:fs";
import { stubTauri, openedUrls, openedPaths, noteResolves, logEvents, fileText } from "./tauri-stub";
import { readDocument } from "./parity-checks";
import { classifyLinkTarget } from "../../../src/preview/links";

// 链接的 live preview 渲染与激活（M144 引入外链，M145 补齐全形态矩阵，M272 把判定面从
// `Link` 节点扩到 `URL` 节点：裸 URL / 链接定义行 / 角括号自动链接）。
//
// 四个口径在本场景钉住：
// 1. **分类**——装饰与激活的判据只有目标原文（links.ts 的 classifyLinkTarget）：
//    http/https/mailto = 外链，相对路径 md = 应用内跳转，相对路径非 md = vault 内资产，
//    纯锚点 = 应用内语义（当前只提示），白名单外 scheme = 原文不装饰。
// 2. **渲染**——`[title](target)` 呈现为 `title` + 尾部标记（↗︎ 会离开本应用 / → 应用内
//    跳转），括号与目标源码被 replace 装饰隐藏；M272 的三种字面形态**没有可隐藏的源码**
//    （URL 本身就是原文），唯一的隐藏是角括号自动链接的两个尖括号。文档逐字节不变
//    （ADR 0003 §3 铁律）。
// 3. **激活**——⌘⏎ 与 ⌘-Click 走同一条 `link.follow`，M272 之后同样覆盖三种字面形态。
//    真机上外链的终点是系统浏览器、资产的终点是系统默认应用；chromium 里由桩的 invoke 路由
//    记账（`open_external_url` → `window.__openedUrls`，`link_open_path` → `window.__openedPaths`），
//    所以本场景能断言「开的是哪个目标」而**不真的唤起浏览器或打开文件**
//    （Rust 侧的校验由 cargo 单测与真机验收场景 12 / 54 覆盖）。
// 4. **不装饰的面**——白名单外 scheme、无 scheme 的字面（`www.` / 裸邮箱 / `xmpp:`）、引用式
//    链接的引用点、行内代码、围栏代码块、HTML 注释、frontmatter：一律原文。

const links = readFileSync(new URL("../fixtures/render-link/links.md", import.meta.url), "utf8");
const SITE = "https://example.invalid/site";
const MAIL = "mailto:someone@example.invalid";
const WRAPPED = "https://example.invalid/wrapped";
const CELL = "https://example.invalid/cell";
const BARE = "https://example.invalid/bare";
const AUTO = "https://example.invalid/auto";
const DEF = "https://example.invalid/home";
const REF_DEF = "https://example.invalid/ref";
const CELL_BARE = "https://example.invalid/table-cell-url";
// ↗︎ = U+2197 + U+FE0E（变体选择符 VS15，强制文字表现而非 emoji）；→ = U+2192。
const EXT = "\u2197\uFE0E";
const INT = "\u2192";
// 装饰掉的链接数（javascript: 那条、引用点与四种「不装饰」现场之外）与按文档顺序排列的标记。
const LINKS = 18;
const MARKS = [
  EXT, INT, INT, INT, INT, INT, EXT, EXT, INT, // 九条标准链接（形态 1）
  EXT, EXT, // 裸 URL + 角括号自动链接
  EXT, EXT, // 定义行 `[homepage]:` 与 `[ref]:`
  EXT, EXT, // mailto 与尖括号包裹
  EXT, INT, EXT, // 表格：标准外链、标准内链、cell 内裸 URL
];

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

  // 18 条链接都渲染成 title + 标记，标记按文档顺序与类别一一对应
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

  // 白名单外 scheme、行内代码里的链接、围栏里的 URL 一律原文
  expect(rendered).toContain("[别开我](javascript:alert(1))");
  expect(rendered).toContain("`[代码里的](https://example.invalid/code)`");
  expect(rendered).toContain("`https://example.invalid/in-code`");
  expect(rendered).toContain('const url = "https://example.invalid/in-fence";');

  // 渲染不写文档（源码保护）
  expect(await readDocument(page)).toBe(links);

  await expectScreenshot(page, "render-link.png");
});

test("字面 URL 三种形态：裸 URL / 定义行 / 角括号自动链接各自装饰为外链", async ({ page }) => {
  await open(page);

  // 形态 2：裸 URL 文本本身仍在场（它就是原文，没有可隐藏的源码），装饰是链接样式 + 尾标
  const bare = page.locator(".cm-lp-link", { hasText: BARE });
  await expect(bare).toHaveCount(1);
  await expect(bare).toHaveAttribute("title", BARE);
  const rendered = await page.locator(".cm-content").innerText();
  expect(rendered, "裸 URL 的文本 MUST NOT 被隐藏").toContain(BARE);

  // 形态 4：角括号自动链接——两个尖括号被隐藏（与标准链接隐藏 `[` / `(` 同款），URL 文本可见
  await expect(page.locator(".cm-lp-link", { hasText: AUTO })).toHaveAttribute("title", AUTO);
  expect(rendered).toContain(AUTO);
  expect(rendered, "尖括号是语法定界符，随目标一起被装饰隐藏").not.toContain(`<${AUTO}>`);

  // 形态 3：定义行只装饰 URL 部分，`[homepage]: ` 前缀保持原文；`[ref]:` 同款
  await expect(page.locator(".cm-lp-link", { hasText: DEF })).toHaveAttribute("title", DEF);
  await expect(page.locator(".cm-lp-link", { hasText: REF_DEF })).toHaveAttribute("title", REF_DEF);
  expect(rendered).toContain(`[homepage]: ${DEF}`);
  expect(rendered).toContain(`[ref]: ${REF_DEF}`);
  // 引用点保持原文（lezer 不把定义处的 URL 挂到引用点）
  expect(rendered).toContain("[正文][ref] 与 [ref] 保持原文");
  expect(rendered).not.toContain("正文][ref] ↗");

  // 文档逐字节不变
  expect(await readDocument(page)).toBe(links);

  await expectScreenshot(page, "render-link-bare-url.png");
});

test("不装饰的面：无 scheme 字面 / 白名单外 scheme / frontmatter 里的 URL 一律原文", async ({ page }) => {
  await open(page);
  const rendered = await page.locator(".cm-content").innerText();

  // 无 scheme 的字面（`www.` / 裸邮箱）没有 `URL` 节点的白名单 scheme ⇒ 保持原文；
  // 白名单外的 `xmpp:` 同理。三条都在同一行里，且同一份文档里的裸 URL 是正观测
  //（REVIEW.md 第 2 条：负向断言必须配正观测，否则「查询恒 null」也绿）。
  expect(rendered).toContain("www.example.invalid");
  expect(rendered).toContain("someone@example.invalid");
  expect(rendered).toContain("xmpp:someone@example.invalid");
  expect(await page.locator(".cm-lp-link", { hasText: "www.example.invalid" })).toHaveCount(0);
  expect(await page.locator(".cm-lp-link", { hasText: "xmpp:" })).toHaveCount(0);
  await expect(page.locator(".cm-lp-link", { hasText: BARE })).toHaveCount(1);

  // frontmatter 里的 URL 不装饰。**这条断言比它看起来弱**，如实记账：frontmatter 块被
  // FrontmatterWidget 整块替换，块内的 mark 装饰本来就不渲染——因此这里能证明的是「上屏的
  // 那一份里没有链接」，「不装饰」的真正依据是装饰循环的第一句 `inFrontmatter` 剪枝
  //（在 `name` 分派之前，见 livePreview 的 collectSyntaxDecorations）。
  expect(await page.locator(".cm-lp-frontmatter")).toHaveCount(1);
  expect(await page.locator(".cm-lp-link", { hasText: "in-fm" })).toHaveCount(0);
});

test("表格 cell 内的链接与裸 URL 照常渲染，表格仍是 grid", async ({ page }) => {
  // spec delta 的「表格 cell 内的链接」场景 + M272 的 D4 推荐项（cell 内的裸 URL 同口径）。
  // 反例（链接标题里出现**未转义**管道符）不需要断言：那种写法会把行切成两个 cell，
  // lezer 至此不再产出 Link 节点，该处自然保持原文；表格自身还会因为 cell 数多于表头
  // 而整块降级（表格合同，另有场景）。
  await open(page);

  await expect(page.locator(".cm-lp-table")).toHaveCount(1);
  const external = page.locator(".cm-lp-table .cm-lp-link", { hasText: "表格内外链" });
  await expect(external).toHaveCount(1);
  await expect(external).toHaveAttribute("title", CELL);
  const internal = page.locator(".cm-lp-table .cm-lp-link", { hasText: "表格内笔记" });
  await expect(internal).toHaveAttribute("title", "guide.md");
  // cell 内的裸 URL 与 cell 外的裸 URL 同一个口径（D4：不纳入会留下第二种语义）
  await expect(page.locator(".cm-lp-table .cm-lp-link", { hasText: CELL_BARE })).toHaveAttribute("title", CELL_BARE);
  // cell 内的三个标记：外链 ↗︎、内链 →、裸 URL ↗︎
  expect(await page.locator(".cm-lp-table .cm-lp-link-mark").allInnerTexts()).toEqual([EXT, INT, EXT]);

  // 渲染态下 cell 内的目标源码同样被隐藏，显示文本是 title
  const rendered = await page.locator(".cm-content").innerText();
  expect(rendered).toContain("表格内外链");
  expect(rendered).not.toContain(CELL);
  // cell 文本没有被链接装饰吞掉：同一行的第二列仍在（裸 URL 那条的尾标会改变 cell 内容宽度，
  // 因此同时钉住「表格仍是 grid」与「其余 cell 内容在场」）
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

test("光标落在裸 URL / 定义行上撤下装饰（D6），离开即恢复", async ({ page }) => {
  await open(page);
  const bareStart = links.indexOf(BARE);

  // 光标进裸 URL 中间：该处链接样式与尾标撤下（URL 原文本来就在场）
  await setCursor(page, bareStart + 4);
  await expect(page.locator(".cm-lp-link")).toHaveCount(LINKS - 1);
  await expect(page.locator(".cm-lp-link-mark")).toHaveCount(LINKS - 1);

  // 定义行：光标落在整条定义行内（含 `[homepage]: ` 前缀）同样撤下。
  // 定位必须带 URL——fixture 的正文段落里也出现过 `[homepage]: ` 这个字面（反引号包裹的说明文字），
  // 用 `indexOf("[homepage]:")` 会落到那一行上（第一版就这么错了一次）。
  await setCursor(page, links.indexOf(`[homepage]: ${DEF}`) + 2);
  await expect(page.locator(".cm-lp-link", { hasText: DEF })).toHaveCount(0);

  // 离开：恢复
  await setCursor(page, 0);
  await expect(page.locator(".cm-lp-link")).toHaveCount(LINKS);
  await expect(page.locator(".cm-lp-link", { hasText: DEF })).toHaveCount(1);
  expect(await readDocument(page)).toBe(links);
});

test("光标落在裸 URL 末位后继续键入：字符落在 URL 之后，无死区（design §9 未决项的实测）", async ({ page }) => {
  await open(page);
  const bareEnd = links.indexOf(BARE) + BARE.length;

  // 末位是**严格重叠**判据的边界（光标恰在 URL 之后、尾标 widget 之前）：这里实测的是
  // 「按键落点与刚敲的字符没被 widget 吃掉」——设计期标为未验的那一条。
  await setCursor(page, bareEnd);
  await page.keyboard.type("q");

  const doc = await readDocument(page);
  expect(doc, "键入的字符必须紧跟在 URL 之后（尾标 widget 不吞按键）").toContain(`${BARE}q`);
  // 文档确实被改了（正观测：这条断言不能只看「包含」——键入没落地时上面那条是红的）
  expect(doc.length).toBe(links.length + 1);
});

test("光标停在链接起点也开得动（文档首字符即外链 / 即裸 URL）", async ({ page }) => {
  // 真实情形：打开一份首行就是链接的笔记，选区复位到 0——恰好是链接的起点。
  // 这条路曾经断在 `resolveInner(pos, 0)` 上：起点处它给的是父节点（Paragraph /
  // Document）而不是 Link，⌘⏎ 静默无反应（无声失败最坏）。M272 给字面 URL 用了同款两侧试起点。
  const doc = "[起点外链](https://example.invalid/start)\n\n后续正文。\n";
  await openDoc(page, "start.md", doc);
  await expect(page.locator(".cm-lp-link")).toHaveCount(1);

  await page.keyboard.press("Meta+Enter");
  await expect.poll(async () => openedUrls(page)).toEqual(["https://example.invalid/start"]);

  const bareDoc = "https://example.invalid/bare-start\n\n后续正文。\n";
  await openDoc(page, "bare-start.md", bareDoc);
  await expect(page.locator(".cm-lp-link")).toHaveCount(1);
  await page.keyboard.press("Meta+Enter");
  await expect.poll(async () => openedUrls(page)).toEqual(["https://example.invalid/bare-start"]);
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

test("字面 URL 的激活：⌘⏎ 与 ⌘-Click 各自可单独触发（键盘 / 鼠标两条路径）", async ({ page }) => {
  await open(page);

  // 键盘路径（⌘⏎）：裸 URL
  await setCursor(page, links.indexOf(BARE) + 2);
  await page.keyboard.press("Meta+Enter");
  await expect.poll(async () => openedUrls(page)).toEqual([BARE]);

  // 鼠标路径（⌘-Click）：定义行的 URL 部分——点击落在被装饰的 URL 上，开的是 URL 而不是
  // 带前缀的整行原文
  await page.locator(".cm-lp-link", { hasText: DEF }).click({ modifiers: ["Meta"] });
  await expect.poll(async () => openedUrls(page)).toEqual([BARE, DEF]);

  // 角括号自动链接：开的是括号里的 URL
  await setCursor(page, links.indexOf(AUTO) + 2);
  await page.keyboard.press("Meta+Enter");
  await expect.poll(async () => openedUrls(page)).toEqual([BARE, DEF, AUTO]);

  // 末位端点：光标停在 URL 节点的 `to`（渲染态下就是 URL 文本的末尾、尖括号 `>` 的位置）
  // 同样算「在链接上」——与标准链接「起点算在链接上」同一条口径（真机场景 54 实测到这条，
  // 当时光标停在自动链接末位按 ⌘⏎ 无反应）。
  await setCursor(page, links.indexOf(AUTO) + AUTO.length);
  await page.keyboard.press("Meta+Enter");
  await expect.poll(async () => openedUrls(page)).toEqual([BARE, DEF, AUTO, AUTO]);

  // 无 scheme 的字面 URL 上 ⌘⏎ 无操作：不装饰也不激活（不产生任何打开请求）
  await setCursor(page, links.indexOf("www.example.invalid") + 4);
  await page.keyboard.press("Meta+Enter");
  await setCursor(page, links.indexOf("xmpp:") + 6);
  await page.keyboard.press("Meta+Enter");
  expect(await openedUrls(page)).toEqual([BARE, DEF, AUTO, AUTO]);

  // 引用点（`[ref]` / `[正文][ref]`）同样无操作：拿不到目标就不猜
  await setCursor(page, links.indexOf("[ref] 保持原文") + 2);
  await page.keyboard.press("Meta+Enter");
  expect(await openedUrls(page)).toEqual([BARE, DEF, AUTO, AUTO]);

  // 文档始终没被这些激活路径碰过
  expect(await readDocument(page)).toBe(links);
});

test("定义行的前缀不是链接本体：光标在 `[homepage]: ` 上 ⌘⏎ 无操作，移到 URL 上才生效", async ({ page }) => {
  // 装饰面与激活面的**判据差异**（真机场景 54 第一版栽在这里，换算到本层钉住）：
  // 装饰的显露范围是整条定义行（含前缀），而激活要求**光标落在 `URL` 区间内**。
  // 打开这个文件时选区复位到 0 —— 0 在前缀里，⌘⏎ 因此**不该**打开任何东西。
  const doc = "[homepage]: https://example.invalid/def\n\n正文段落。\n";
  await openDoc(page, "def.md", doc);
  await expect(page.locator(".cm-lp-link")).toHaveCount(1);

  // 起点（前缀内）：无操作
  await setCursor(page, 0);
  await page.keyboard.press("Meta+Enter");
  expect(await openedUrls(page), "前缀不是 URL 节点，⌘⏎ 在这里无操作").toEqual([]);

  // 前缀内任意位置同样无操作（区分度：不是「只有 0 特例」）
  await setCursor(page, 3);
  await page.keyboard.press("Meta+Enter");
  expect(await openedUrls(page)).toEqual([]);

  // 移到 URL 区间内（行尾 = URL 末位）：打开
  await setCursor(page, doc.indexOf("https://example.invalid/def") + 4);
  await page.keyboard.press("Meta+Enter");
  await expect.poll(async () => openedUrls(page)).toEqual(["https://example.invalid/def"]);
  // 激活不改文档
  expect(await readDocument(page)).toBe(doc);
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
