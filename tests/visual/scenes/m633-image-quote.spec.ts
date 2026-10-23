import { expect, test, type Page } from "@playwright/test";
import { attachmentReads, harnessImageWrites, stubTauri, type VaultFixture } from "./tauri-stub";

// M633（change add-image-quote-to-chat）：图片摘录的 DOM / 结构判据。
//
//   1. **图片上的引用钮**：悬停终态图片 → 钮浮现（D370 读屏名）；点击 → composer 出现图片
//      卡片（编号 1、缩略图可见、来源路径落 hover title）；vault 只读、harness 侧写入一次；
//      一次 ⌘Z 撤掉整次插入。
//   2. **跨图片的选区**：选区跨文字与图片 → composer 依次出现「引用卡片 + 图片块」，
//      引用正文保留图片源码（design §5），一次 ⌘Z 全撤。
//   3. **占位不可引用**：读取失败的图片占位没有 `<img>` ⇒ 没有引用钮（结构性事实，
//      不是开关）；笔记嵌入与未解析引用同样没有钮。
//   4. **不支持的格式**：svg 引用 → 既有错误文案 toast、不插卡片（D1 的格式面）。
//
// 本场景刻意**不做像素基线**（零新基线、零既有基线更新）：钮的浮现手感 / 图片卡片观感归 Alex
// dogfood；这里只钉结构、可见性与通信面。行为层（发送后 parts / transcript）归验收场景 161。

const PIC = "assets/pic.png";
const LOGO = "assets/logo.svg";
const BROKEN = "assets/broken.png";

const DOC = [
  "# 图片摘录",
  "",
  "第一段文字，随后是图：",
  "",
  "![[pic.png]]",
  "",
  "第二段文字。",
  "",
  "![坏图](assets/broken.png)",
  "",
  "![[assets/logo.svg]]",
  "",
  "![[note]]",
  "",
].join("\n");

/** 合成 SVG（信息卫生：纯几何、无真实内容）；读取走 attachments 的 base64 覆写。
 *  base64 由下面这串 UTF-8 字节直接编码而来（场景文件不引 Buffer：tests/visual 未装
 *  @types/node，node-env.d.ts 只声明了用到的几个 API）。 */
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="80" viewBox="0 0 140 80"><rect width="140" height="80" fill="#2f6f8f"/></svg>';
const SVG_BASE64 =
  "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNDAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCAxNDAgODAiPjxyZWN0IHdpZHRoPSIxNDAiIGhlaWdodD0iODAiIGZpbGw9IiMyZjZmOGYiLz48L3N2Zz4=";

/** 合成 96×48 纯色 PNG（无真实内容）：由 `scripts/acceptance/lib/png.mjs` 的 encodePng
 *  生成后钉成常量——桩层的 1×1 合成 PNG 太小，引用钮（26×24）会盖住整张图、指针悬停
 *  落点被钮拦截（本场景首跑实证）。 */
const PIC_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAAAwCAIAAABhdOiYAAAAZElEQVR4nO3QMQ0AIADAMBwhDSlYxgGc7GgyAUvHXFuXxveDeIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBygRwcA+ys871nBlgAAAABJRU5ErkJggg==";

const resolved = (path: string): unknown => ({
  status: "resolved",
  path,
  candidates: [],
  embed_target: "attachment",
  anchor: { status: "none", heading: null, line: null },
});

const VAULT: VaultFixture = {
  entries: [
    { path: "harness-image-quote.md", kind: "file", size: DOC.length, mtime_ms: 0 },
    { path: "assets", kind: "dir", size: 0, mtime_ms: 0 },
    { path: PIC, kind: "file", size: 69, mtime_ms: 0 },
    { path: LOGO, kind: "file", size: SVG.length, mtime_ms: 0 },
    { path: BROKEN, kind: "file", size: 4, mtime_ms: 0 },
  ],
  files: { "harness-image-quote.md": DOC, [PIC]: "", [LOGO]: "", [BROKEN]: "" },
  links: {
    "![[pic.png]]": resolved(PIC),
    "![[assets/logo.svg]]": resolved(LOGO),
  },
  // 坏图的字节可读、却解不出像素：终态是可见占位（没有 <img>）。
  // 合成 96×48 的 PNG 字节给主图（避免 1×1 时引用钮盖住整张图，见 PIC_BASE64 的注释）。
  attachments: {
    [PIC]: PIC_BASE64,
    [LOGO]: SVG_BASE64,
    [BROKEN]: "QUJD",
  },
};

/** `harness_state` 的零态桩（与 m303 / m345 同款：不补会停在「未初始化」空壳）。 */
async function stubHarnessState(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approval: null,
          warn_ctx_pct: 85,
        });
      }
      return invoke(cmd, args);
    };
  });
}

async function openDoc(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await stubHarnessState(page);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-image-quote.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段文字");
  // 终态：合成 PNG 与 SVG 都渲染出 <img>（坏图不留 <img>，由它的用例单独判）。
  await expect(page.locator(".cm-lp-image img")).toHaveCount(2);
}

/** 程序化选区（m345 同手法）：CM 在 focused 时把选区写进 DOM，摘录手势的 selectionchange 因此触发。 */
async function selectRange(page: Page, fromNeedle: string, toNeedle: string): Promise<void> {
  await page.evaluate(
    ({ a, b }) => {
      const view = (document.querySelector(".cm-content") as unknown as {
        cmTile: { root: { view: any } };
      }).cmTile.root.view;
      const text: string = view.state.doc.toString();
      const start = text.indexOf(a);
      const end = text.indexOf(b) + b.length;
      view.focus();
      view.dispatch({ selection: { anchor: start, head: end } });
    },
    { a: fromNeedle, b: toNeedle },
  );
}

test("悬停图片出现引用钮 → 点击入 composer（图片卡片、编号 1、来源 title）→ 一次 ⌘Z 撤掉", async ({
  page,
}) => {
  await openDoc(page);
  const trigger = page.locator(".lumir-image-quote-trigger").first();
  // 静止态：钮在 DOM 里但不可见（visibility: hidden——不占位、不进读屏树）。
  await expect(trigger).toBeHidden();

  await page.locator(".cm-lp-image img").first().hover();
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-label", "摘录到对话");

  await trigger.click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".pane-divider")).toBeVisible();

  const composer = page.locator(".lumir-hp-composer");
  const imageCard = composer.locator(".lumir-hp-imgcard");
  await expect(imageCard).toHaveCount(1);
  // 选区只有图片（单图入口没有文本卡片）：引用卡片 MUST NOT 出现。
  await expect(composer.locator(".lumir-hp-qcard")).toHaveCount(1);
  await expect(composer.locator(".lumir-hp-qcard.lumir-hp-imgcard")).toHaveCount(1);
  // 编号徽标 1（块序列的派生读数）与缩略图在场。
  await expect(imageCard.locator(".lumir-hp-qc-ord")).toHaveText("1");
  await expect(imageCard.locator(".lumir-hp-qc-img")).toBeVisible();
  // 来源标注只在人侧：缩略图 hover title = vault 相对路径（design §4.2；不进投递）。
  await expect(imageCard.locator(".lumir-hp-qc-thumb")).toHaveAttribute("title", PIC);

  // 字节链路：读的是 vault 里那张图，写的是 harness 侧存储，MIME 透传原样。
  expect(await attachmentReads(page)).toContain(PIC);
  const writes = await harnessImageWrites(page);
  expect(writes).toHaveLength(1);
  expect(writes[0]?.source_mime).toBe("image/png");

  // 一次 ⌘Z 撤掉整次插入（单结构编辑步的可见判据）。
  await page.keyboard.press("Meta+z");
  await expect(composer.locator(".lumir-hp-imgcard")).toHaveCount(0);
});

test("跨文字与图片的选区：引用卡片 + 图片块按文档序进入，一次 ⌘Z 全撤", async ({ page }) => {
  await openDoc(page);
  await selectRange(page, "第一段文字", "第二段文字。");
  await expect(page.locator(".quote-gesture-btn")).toBeVisible();
  await page.locator(".quote-gesture-btn").click();

  const composer = page.locator(".lumir-hp-composer");
  const quote = composer.locator(".lumir-hp-qcard:not(.lumir-hp-imgcard)");
  const imageCard = composer.locator(".lumir-hp-imgcard");
  await expect(quote).toHaveCount(1);
  await expect(imageCard).toHaveCount(1);
  // 块序 = [卡片, 图片, 段落]（D3：卡片在前、图片按文档序在后）。
  const order = await page.evaluate(() => {
    const el = document.querySelector(".lumir-hp-composer") as HTMLElement;
    return [...el.children].map((child) =>
      child.classList.contains("lumir-hp-imgcard")
        ? "image"
        : child.classList.contains("lumir-hp-qcard")
          ? "quote"
          : "paragraph",
    );
  });
  expect(order.slice(0, 2)).toEqual(["quote", "image"]);
  // 引用正文保留图片源码（design §5：不剥离，锚校验要逐字前缀）。
  await expect(quote.locator(".lumir-hp-qc-ex")).toContainText("![[pic.png]]");
  await expect(quote.locator(".lumir-hp-qc-src")).toContainText("harness-image-quote.md");

  await page.keyboard.press("Meta+z");
  await expect(composer.locator(".lumir-hp-qcard")).toHaveCount(0);
});

test("占位不可引用：读取失败的图片 / 笔记嵌入 / 未解析引用都没有引用钮", async ({ page }) => {
  await openDoc(page);
  // 坏图终态是可见占位（没有 <img>），引用钮挂在它的替换区里不存在——结构性事实。
  const broken = page.locator(".cm-lp-image").filter({ has: page.locator(".cm-lp-image-error") });
  await expect(broken).toHaveCount(1);
  await expect(broken.locator("img")).toHaveCount(0);
  await broken.hover();
  await expect(broken.locator(".lumir-image-quote-trigger")).toHaveCount(0);
  // 笔记嵌入 / 未解析引用走 AttachmentNoticeWidget（不是图片替换区），同样没有钮。
  await expect(page.locator(".cm-lp-embed-unsupported .lumir-image-quote-trigger")).toHaveCount(0);
  // 反向验证：同一文档里的两张终态图片各有且只有一个钮（坏图缺席不是选择器写错）。
  await expect(page.locator(".cm-lp-image img")).toHaveCount(2);
  await expect(page.locator(".lumir-image-quote-trigger")).toHaveCount(2);
});

test("不支持的格式：svg 引用给既有错误文案 toast、不插卡片", async ({ page }) => {
  await stubTauri(page, {
    ...VAULT,
    harnessImageFailures: {
      "image/svg+xml": {
        code: "attachment_type_unsupported",
        message: "不支持的剪贴板图片格式",
        params: { type: "image/svg+xml" },
      },
    },
  });
  await stubHarnessState(page);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-image-quote.md"]').click();

  const logo = page.locator('.cm-lp-image img[alt*="logo.svg"]');
  await expect(logo).toBeVisible();
  await logo.hover();
  // 悬停到 svg 那张图上的钮（两张终态图片各有一个钮，按文档序 pic 在前、logo 在后；
  // 只有正被悬停的那一个可见——`.last()` 命中 svg 这一张）。
  await expect(page.locator(".lumir-image-quote-trigger")).toHaveCount(2);
  await page.locator(".lumir-image-quote-trigger").last().click();

  await expect(page.locator(".lumir-toast", { hasText: "image/svg+xml" })).toBeVisible();
  await expect(page.locator(".lumir-hp-composer .lumir-hp-imgcard")).toHaveCount(0);
  const writes = await harnessImageWrites(page);
  expect(writes.map((write) => write.source_mime)).toContain("image/svg+xml");
});

/** 长图 fixture（600×2000）：它的右下水远在可视区之外——引用钮的钳制判据需要这个现场。 */
const TALL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="2000" viewBox="0 0 600 2000"><rect width="600" height="2000" fill="#cfe0c8"/></svg>';
const TALL_DOC = "# 长图\n\n![[tall.svg]]\n\n尾段。\n";

test("长图越出可视区：引用钮被钳进编辑器可视区（同一钳制口径）", async ({ page }) => {
  await stubTauri(page, {
    entries: [
      { path: "harness-tall.md", kind: "file", size: TALL_DOC.length, mtime_ms: 0 },
      { path: "tall.svg", kind: "file", size: TALL_SVG.length, mtime_ms: 0 },
    ],
    files: { "harness-tall.md": TALL_DOC, "tall.svg": "" },
    links: { "![[tall.svg]]": resolved("tall.svg") },
    attachments: { "tall.svg": btoa(TALL_SVG) },
  });
  await stubHarnessState(page);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-tall.md"]').click();

  const img = page.locator(".cm-lp-image img").first();
  await expect(img).toBeVisible();
  await img.hover();
  const trigger = page.locator(".lumir-image-quote-trigger").first();
  await expect(trigger).toBeVisible();

  const geometry = await page.evaluate(() => {
    const band = document.querySelector(".cm-scroller") as HTMLElement;
    const button = document.querySelector(".lumir-image-quote-trigger") as HTMLElement;
    const image = document.querySelector(".cm-lp-image img") as HTMLElement;
    const bandRect = band.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    return {
      band: { top: bandRect.top, bottom: bandRect.bottom, left: bandRect.left, right: bandRect.right },
      button: { top: buttonRect.top, bottom: buttonRect.bottom, left: buttonRect.left, right: buttonRect.right },
      image: { top: imageRect.top, bottom: imageRect.bottom },
    };
  });
  // 前提（区分度）：图片右下水远在可视区之外——未钳制时钮会落在那里（判据因此不会空转）。
  expect(geometry.image.bottom, "前提：长图底部越出可视区").toBeGreaterThan(geometry.band.bottom);
  // 结论：钮整体落在可视区内（钳制留白 4px，与文本选区摘录钮同一份实现）。
  expect(geometry.button.top).toBeGreaterThanOrEqual(geometry.band.top - 0.5);
  expect(geometry.button.bottom).toBeLessThanOrEqual(geometry.band.bottom - 4 + 0.5);
  expect(geometry.button.left).toBeGreaterThanOrEqual(geometry.band.left - 0.5);
  expect(geometry.button.right).toBeLessThanOrEqual(geometry.band.right - 4 + 0.5);
});
