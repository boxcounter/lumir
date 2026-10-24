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
//   4. **可引用格式的边界（M662 / M666）**：svg 走栅格化**成功**路径（卡片拿到位图内容寻址名、
//      无失败留痕）；D585「暂不支持引用该格式」/ D586「1 张图片未能引用」的失败面留给**真正不
//      支持**的格式（本场景用 gif 判——它在可引用格式表之外，预览仍渲染得出）。
//   5. **含图读数（M662）**：引用卡片的出处行带派生角标「含 N 张图片」（人侧读数，不进投递）。
//
// 本场景刻意**不做像素基线**（零新基线、零既有基线更新）：钮的浮现手感 / 图片卡片观感归 Alex
// dogfood；这里只钉结构、可见性与通信面。行为层（发送后 parts / transcript）归验收场景 161。

const PIC = "assets/pic.png";
const LOGO = "assets/logo.svg";
const BROKEN = "assets/broken.png";
/** 合成 96×48 纯色 GIF（信息卫生：纯色、无内容）。M666 起 svg 已可引用，D586 的失败面需要一个新的
 *  「预览渲染得出、可引用表里没有」的格式夹具——gif 是那组差集里最普通的一个（三家 provider 都收
 *  gif，但落盘链路没扩格式，扩格式没有裁决）。base64 由一张纯色 PNG 经 `sips -s format gif`
 *  转出后钉成常量（tests/visual 不引 Buffer / 无图像编码依赖）。 */
const ANIM = "assets/anim.gif";
const ANIM_BASE64 =
  "R0lGODdhYAAwAJEAAAAAAMh4PP///wAAACH5BAQAAAAALAAAAABgADAAAAJJjI+py+0Po5y02ouz3rz7D4biSJbmiabqyrbuC8fyTNf2jef6zvf+DwwKh8Si8YhMKpfMpvMJjUqn1Kr1is1qt9yu9wsOi8e0AgA7";

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
  "![[anim.gif]]",
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
    { path: ANIM, kind: "file", size: 120, mtime_ms: 0 },
    { path: BROKEN, kind: "file", size: 4, mtime_ms: 0 },
  ],
  files: {
    "harness-image-quote.md": DOC,
    [PIC]: "",
    [LOGO]: "",
    [ANIM]: "",
    [BROKEN]: "",
  },
  links: {
    "![[pic.png]]": resolved(PIC),
    "![[assets/logo.svg]]": resolved(LOGO),
    "![[anim.gif]]": resolved(ANIM),
  },
  // 坏图的字节可读、却解不出像素：终态是可见占位（没有 <img>）。
  // 合成 96×48 的 PNG 字节给主图（避免 1×1 时引用钮盖住整张图，见 PIC_BASE64 的注释）。
  attachments: {
    [PIC]: PIC_BASE64,
    [LOGO]: SVG_BASE64,
    [ANIM]: ANIM_BASE64,
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
  // 终态：合成 PNG / SVG / GIF 都渲染出 <img>（坏图不留 <img>，由它的用例单独判）。
  await expect(page.locator(".cm-lp-image img")).toHaveCount(3);
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
  // 三态读数（M670，change image-hover-quote-btn-oct24「可见性双向跟随指针」的判据）：
  // 静止不可见 → 悬停可见 → 指针移开重新不可见。只读悬停态会漏掉「钮一直亮着」的假绿。
  await expect(trigger).toBeHidden();
  const image = page.locator(".cm-lp-image img").first();
  await image.hover();
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-label", "摘录到对话");
  // 指针移开（移回标题栏空白处）：悬停态必须跟着撤销，钮回到静止态。
  await page.mouse.move(600, 8);
  await expect(trigger).toBeHidden();
  // 移回来：判据双向（这一步同时证明上一条不是「钮再也不会出现」）。
  await image.hover();
  await expect(trigger).toBeVisible();

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
  // M662：摘录里的图片数 = 派生角标（人侧读数；卡片数据模型没有图片字段，见 survey §2.2）。
  await expect(quote.locator(".lumir-hp-qc-src")).toContainText("含 1 张图片");

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
  // 反向验证：同一文档里的三张终态图片各有且只有一个钮（坏图缺席不是选择器写错）。
  await expect(page.locator(".cm-lp-image img")).toHaveCount(3);
  await expect(page.locator(".lumir-image-quote-trigger")).toHaveCount(3);
});

test("svg 引用走栅格化成功路径（M666）：卡片是位图内容寻址名、无失败留痕", async ({ page }) => {
  await openDoc(page);
  const logoBox = page.locator(".cm-lp-image").filter({ has: page.locator('img[alt*="logo.svg"]') });
  await expect(logoBox.locator("img")).toBeVisible();
  // 三态读数（M670，同本条上方位图用例）：svg 与位图在预览层是同一条渲染路径，钮的形态与
  // 出现时机 MUST NOT 按扩展名分叉——静止不可见 → 悬停可见 → 指针移开重新不可见。
  const trigger = logoBox.locator(".lumir-image-quote-trigger");
  await expect(trigger).toBeHidden();
  await logoBox.locator("img").hover();
  await expect(trigger).toBeVisible();
  await page.mouse.move(600, 8);
  await expect(trigger).toBeHidden();
  await logoBox.locator("img").hover();
  await expect(trigger).toBeVisible();
  await trigger.click();

  const composer = page.locator(".lumir-hp-composer");
  const imageCard = composer.locator(".lumir-hp-imgcard");
  await expect(imageCard).toHaveCount(1);
  // 卡片引用的是**位图**内容寻址名（桩名的形态就是真后端的落盘形态 pasted-<hash16>.webp）——
  // 栅格化的产出走既有链路，卡片上不出现 svg 名、也不出现 SVG 字节（MUST NOT 原样存 SVG）。
  await expect(imageCard.locator(".lumir-hp-qc-src")).toContainText(
    "pasted-633ab12cd34ef567.webp",
  );
  await expect(imageCard.locator(".lumir-hp-qc-src")).not.toContainText(".svg");
  // 缩略图照常读回（与位图同一路径），来源仍只落 hover title。
  await expect(imageCard.locator(".lumir-hp-qc-thumb")).toHaveAttribute("title", LOGO);
  // 写请求带的是**源** MIME：栅格化在后端（前端只搬运字节与 MIME，格式面不在这里分叉）。
  const writes = await harnessImageWrites(page);
  expect(writes).toHaveLength(1);
  expect(writes[0]?.source_mime).toBe("image/svg+xml");
  // 成功路径没有失败留痕、没有格式不支持的 toast（D585 / D586 只留给真正不支持的类型）。
  // 状态行的元素是**常驻**的（`hidden = true` 即收起，见 `applyQuoteFailureNotice`），
  // 因此判据是「收起」而不是「没有这个元素」。
  await expect(page.locator(".lumir-hp-quote-note")).toBeHidden();
  await expect(imageCard.locator(".lumir-hp-qc-actions button[aria-label='插入图片引用']")).toHaveCount(1);
  await expect(page.locator(".lumir-toast", { hasText: "暂不支持引用该格式" })).toHaveCount(0);

  // 一次 ⌘Z 仍撤掉整次引用（svg 与位图同一撤销语义）。
  await page.keyboard.press("Meta+z");
  await expect(composer.locator(".lumir-hp-imgcard")).toHaveCount(0);
});

test("不支持的格式：gif 引用在预检被拒——引用语境文案 + 持久状态行，零 IPC、不插卡片", async ({
  page,
}) => {
  await openDoc(page);
  const gifBox = page.locator(".cm-lp-image").filter({ has: page.locator('img[alt*="anim.gif"]') });
  await expect(gifBox.locator("img")).toBeVisible();
  // 预览渲染这张 gif 时本来就读过它的字节（附件 provider）；判据是「点引用之后没有新读取」。
  const gifReadsBefore = (await attachmentReads(page)).filter((path) => path === ANIM).length;
  await gifBox.locator("img").hover();
  const trigger = gifBox.locator(".lumir-image-quote-trigger");
  await expect(trigger).toBeVisible();
  await trigger.click();

  // 文案是引用语境（D585），不是粘贴语境的 D436「剪贴板」（Alex 现场的原句）。
  const toast = page.locator(".lumir-toast", { hasText: "暂不支持引用该格式" });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("image/gif");
  await expect(toast).not.toContainText("剪贴板");
  // 持久留痕（D586）：不是 3 秒 toast 能代替的那条——输入区状态行在场。
  await expect(page.locator(".lumir-hp-quote-note")).toBeVisible();
  await expect(page.locator(".lumir-hp-quote-note")).toContainText("1 张图片未能引用");
  await expect(page.locator(".lumir-hp-composer .lumir-hp-imgcard")).toHaveCount(0);
  // 预检拦在 IPC 之前：既没读 vault 字节，也没发写请求（后端写原语仍是最后一道闸，
  // 但可引用的判定面在 `src/preview/attachments.ts` 一处，见 M662 的格式对账）。
  expect(await harnessImageWrites(page)).toHaveLength(0);
  expect((await attachmentReads(page)).filter((path) => path === ANIM)).toHaveLength(gifReadsBefore);
});

test("状态行的收口：文本摘录与消息摘录都是「下一次引用」（r1 P2-1）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarnessState(page);
  // 本用例要一条 transcript 消息做「消息摘录」的收口判据：发送成功即可（不推进轮次）。
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: unknown) =>
      cmd === "harness_send" ? null : invoke(cmd, args);
  });
  await page.goto("/");
  await page.locator('.ft-row[title="harness-image-quote.md"]').click();
  await page.locator(".lumir-hp-toggle").click();

  // 先发一条消息：transcript 里有一条用户消息，供后面的消息摘录用。
  await page.locator(".lumir-hp-composer").fill("上一轮的问题");
  await page.locator(".lumir-hp-send").click();
  await expect(page.locator(".lumir-hp-msg-user .lumir-hp-qtext")).toHaveText("上一轮的问题");

  const note = page.locator(".lumir-hp-quote-note");
  // 失败夹具 = gif（可引用格式表之外的格式）：M666 起 svg 走成功路径，不能再拿它造失败现场。
  // 预检在 IPC 之前失败 ⇒ 零写请求、零卡片，只留 D586 状态行——正是本用例要的收口对象。
  const gifBox = page.locator(".cm-lp-image").filter({ has: page.locator('img[alt*="anim.gif"]') });
  const triggerFailedQuote = async (): Promise<void> => {
    const img = gifBox.locator("img");
    await img.scrollIntoViewIfNeeded();
    await img.hover();
    await gifBox.locator(".lumir-image-quote-trigger").click();
    await expect(note).toBeVisible();
    await expect(note).toContainText("1 张图片未能引用");
  };

  // 失败 → 状态行在场。
  await triggerFailedQuote();

  // 路径一：**文本摘录**（insertQuoteCard）收口。选区取一段纯文字（不含图片），走卡片路径。
  await selectRange(page, "第一段文字", "第一段文字");
  await page.locator(".editor-pane > .quote-gesture-btn").click();
  await expect(page.locator(".lumir-hp-composer > .lumir-hp-qcard")).toHaveCount(1);
  await expect(note).toBeHidden();

  // 再失败一次 → 状态行重新在场（判据有区分度：不是一直隐藏）。
  await triggerFailedQuote();

  // 路径二：**消息摘录**（insertMessageQuoteCard）收口。
  await page.evaluate(() => {
    const el = document.querySelector(".lumir-hp-msg-user .lumir-hp-qtext");
    if (!el) throw new Error("没有 transcript 用户消息");
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    if (!selection) throw new Error("no selection");
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.locator(".lumir-hp-transcript > .quote-gesture-btn").click();
  await expect(page.locator(".lumir-hp-composer > .lumir-hp-msgquote")).toHaveCount(1);
  await expect(note).toBeHidden();
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

