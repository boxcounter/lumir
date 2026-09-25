import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/markdown-combo/${name}`, import.meta.url), "utf8");

const combo = fixture("combo.md");
const longFrontmatter = fixture("frontmatter-200.md");
const image = fixture("sample.svg");
const images = fixture("images.md");

/** 位图 fixture（96×32 真 PNG，M209 新增）：本目录此前只有 0 字节的 `empty.png`，位图形态没有
 *  可用输入。字节先按 **latin1 读成二进制串再 `btoa`** 取 base64——附件读取本就是字节层，
 *  `readFileSync(…, "utf8")` 会把非 ASCII 字节换成替换字符、二进制 fixture 走那条路必然解码失败；
 *  latin1 与 `btoa` 是这份 tsconfig 下可用的等价物（tests/visual 未装 @types/node，node:fs 声明
 *  里没有 Buffer 形态）。 */
const bitmapBase64 = btoa(readFileSync(new URL("../fixtures/markdown-combo/bitmap.png", import.meta.url), "latin1"));
const BITMAP_REF = "![bitmap](assets/bitmap.png)";

/** 图片附件 fixture：键是 vault 相对路径，值是文件内容（本层按 UTF-8 读文本，经 base64 回给前端）。 */
const imageAssets: Record<string, string> = {
  "assets/sample.svg": image,
  "assets/wide.svg": fixture("wide.svg"),
  "assets/percent-width.svg": fixture("percent-width.svg"),
  "assets/script.svg": fixture("script.svg"),
  "assets/external-ref.svg": fixture("external-ref.svg"),
  "assets/empty.png": fixture("empty.png"),
  "assets/zero-declared.svg": fixture("zero-declared.svg"),
};

/** images.md 里九条图片引用的原文（widget 的 rawRef 即这一串，也是 img 的 alt）。 */
const REFS = {
  fixed: "![fixed svg](assets/sample.svg)",
  wide: "![wide svg](assets/wide.svg)",
  percent: "![percent svg](assets/percent-width.svg)",
  percentWiki: "![[percent-width.svg]]",
  empty: "![empty bitmap](assets/empty.png)",
  zeroDeclared: "![zero declared svg](assets/zero-declared.svg)",
  missing: "![missing bitmap](assets/missing.png)",
  remote: "![remote image](https://example.invalid/remote.png)",
  script: "![script svg](assets/script.svg)",
  externalRef: "![external ref svg](assets/external-ref.svg)",
} as const;

/**
 * `fs_read_attachment` 的桩：tauri-stub 的 invoke 路由里没有这个命令（缺省按 unknown_command
 * 抛错 → 图片一律走「读取失败」占位），本场景要验真实渲染，因此在 stub 之后包一层。
 * 必须在 `page.goto` 之前调用（addInitScript 按注册顺序执行，stubTauri 在前）。
 *
 * 每次调用在 `window.__lumirAttachmentReads` 上自增（M184 的「打开遮罩不重读字节」判据要读它：
 * 这是**可外部观测**的调用计数，比「实现里没有 invoke」这类代码面判据强）。
 *
 * 值有两种形态（M209）：`string` = 文本附件，按 UTF-8 编码成字节；`{ base64 }` = 已经编码好的
 * 原始字节（位图等二进制 fixture 必须走这条，否则 UTF-8 往返会损坏字节）。
 */
type AttachmentFixture = string | { base64: string };

async function stubAttachmentReads(page: Page, files: Record<string, AttachmentFixture>, delayMs = 0): Promise<void> {
  await page.addInitScript((args: { map: Record<string, AttachmentFixture>; delayMs: number }) => {
    const { map, delayMs } = args;
    const internals = (window as any).__TAURI_INTERNALS__;
    const original = internals.invoke;
    (window as any).__lumirAttachmentReads = 0;
    internals.invoke = async (command: string, argv: { path?: string }) => {
      if (command !== "fs_read_attachment") return original(command, argv);
      (window as any).__lumirAttachmentReads += 1;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const content = map[argv.path ?? ""];
      if (content === undefined) throw { code: "fs_not_found", message: `文件不存在：${argv.path}` };
      if (typeof content !== "string") return content.base64;
      const bytes = new TextEncoder().encode(content);
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary);
    };
  }, { map: files, delayMs });
}

async function open(
  page: Parameters<typeof stubTauri>[0],
  text = combo,
  path = "combo.md",
  failures?: Record<string, { code: string; message: string }>,
  reads?: Record<string, string>,
  readDelayMs = 0,
) {
  await stubTauri(page, {
    entries: [path, "assets/sample.svg", "assets/missing.png", "assets/missing.svg", "assets/wide.svg", "assets/percent-width.svg", "assets/script.svg", "assets/external-ref.svg", "assets/empty.png"].map((entry) => ({ path: entry, kind: "file", size: text.length, mtime_ms: 0 })),
    files: { [path]: text, ...imageAssets },
    links: {
      "![[sample.svg]]": { status: "resolved", path: "assets/sample.svg", candidates: [], embed_target: "attachment", anchor: { status: "none", heading: null, line: null } },
      "![[missing.svg]]": { status: "unresolved", path: null, candidates: [], embed_target: null, anchor: { status: "none", heading: null, line: null } },
      "![[percent-width.svg]]": { status: "resolved", path: "assets/percent-width.svg", candidates: [], embed_target: "attachment", anchor: { status: "none", heading: null, line: null } },
    },
    failures,
  });
  // 顺序要紧：stubTauri 的 init script 先跑（它才挂出 __TAURI_INTERNALS__），我们的包装在后。
  if (reads) await stubAttachmentReads(page, reads, readDelayMs);
  await page.goto("/");
  await page.locator(`.ft-row[title="${path}"]`).click();
}

/** 某条图片引用的替换区读数：布局盒（替换区可见尺寸）+ 引擎给出的自然尺寸。两个一起记—— */
/** 只记自然尺寸会把固有宽度不定的形态读成「加载正常」（实则布局盒 0×0，design §3.2）。 */
async function imageReadings(page: Page, ref: string) {
  return page.locator(`.cm-lp-image img[alt=${JSON.stringify(ref)}]`).evaluate((el) => {
    const img = el as HTMLImageElement;
    const box = img.getBoundingClientRect();
    return {
      box: `${Math.round(box.width)}x${Math.round(box.height)}`,
      natural: `${img.naturalWidth}x${img.naturalHeight}`,
      complete: img.complete,
    };
  });
}

/** 全部替换区的可见尺寸（用于「不得出现零高度空白」这条通用断言）。 */
async function replacementAreas(page: Page) {
  return page.locator(".cm-lp-image").evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      return { box: `${Math.round(box.width)}x${Math.round(box.height)}`, text: (el.textContent ?? "").slice(0, 40) };
    }),
  );
}

for (const width of [1280, 640] as const) {
  test(`Markdown组合首帧、宽窄与源码保护 ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await open(page, combo, "combo.md", undefined, imageAssets);
      await expect(page.locator(".cm-content")).toContainText("Combination heading");
      await expect(page.locator(".cm-lp-frontmatter")).toContainText("Combination fixture");
      await expect(page.locator(".cm-lp-frontmatter .cm-lp-tag")).toHaveCount(2);
      await expect(page.locator(".cm-lp-list-marker")).toHaveCount(4);
      await page.locator(".cm-scroller").evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await expect(page.locator(".cm-lp-embed-unsupported")).toHaveCount(1);
      // 两侧都判（M178）：此前这里只有 `.cm-lp-image-status, .cm-lp-image-error` 的 first 可见，
      // 而「加载中… {引用}」在图片插入前的第一帧就存在——渲染成功 / 原地变白板 / 最终报错
      // 三者都能让它 PASS（无区分度，REVIEW.md 第 1 条）。现在一侧判成功渲染出的图片可见，
      // 一侧判没有任何零高度替换区。
      await expect(page.locator(".cm-lp-image img").first()).toBeVisible();
      for (const area of await replacementAreas(page)) {
        expect(area.box, `零高度替换区：${JSON.stringify(area)}`).not.toMatch(/^(0x|.*x0$)/);
      }
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

test("图片无法显示时占位保持可见", async ({ page }) => {
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
  await expect(page.locator(".cm-lp-image-error")).toContainText("图片无法显示");
  await expect(page.locator(".cm-lp-image img")).toHaveCount(0);
});

test("图片终态：尺寸兜底画出来 + 不可见即可见占位", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  // 外部 URL 引用必然失败：abort 让它在两条路径（外部图片引用 / svg 内的外链）上都快而确定。
  await page.route("**/example.invalid/**", (route) => route.abort());
  await open(page, images, "images.md", undefined, imageAssets);

  // 十条引用全部落地到终态（加载中状态块已撤）再一次性读数。
  await expect(page.locator(".cm-lp-image")).toHaveCount(10);
  await expect(page.locator(".cm-lp-image-status")).toHaveCount(0);

  // 「栏宽」= 阅读列的文字实测宽（`.cm-content` 的内容盒）：restyle 后它是 680px 的框内含
  // 44px 左右内边距 ⇒ 576px。下面按它算期望读数，而不是写死像素（写死等于把栏宽复制一份）。
  const column = await page.evaluate(() => {
    const el = document.querySelector(".cm-content")!;
    const style = getComputedStyle(el);
    return el.getBoundingClientRect().width - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
  });
  const box = (aspect: number) => `${Math.round(column)}x${Math.round(column * aspect)}`;

  // 固有宽度不定的形状（`width="100%"` + 仅 viewBox，或只声明 viewBox）：终态按**包含块填充**
  //（引擎对「有比例、无固有尺寸」图片的既定规则）。包含块是替换区包装盒，其宽度由 M182 的
  // `width: 100%` 钉成栏宽：修复前它由加载中状态块先占（≈ 半栏宽）或被尺寸兜底写成 300px，
  // 终态因此取决于「布局时状态块在不在场」——正是 M182 消除的时序依赖（条款见
  // docs/specs/image-reading.md §2）。尺寸兜底（`imageFallbackWidth`）仍在，但只对真正画不出
  // 可见像素的形态生效（见下方四处占位）。
  expect(await imageReadings(page, REFS.percent), "固有宽度不定的 svg 按栏宽渲染").toEqual({ box: box(100 / 300), natural: "300x100", complete: true });
  // 同一条处置覆盖 Obsidian 方言形态（三种引用形态共用终态，不为 svg 单立分支）。
  expect(await imageReadings(page, REFS.percentWiki), "方言形态的读数（与标准形态同处置）").toEqual({ box: box(100 / 300), natural: "300x100", complete: true });

  // 正常图片零行为变化：固定尺寸的按固有值、超宽的按栏宽收窄（同一条 max-width 口径）。
  expect(await imageReadings(page, REFS.fixed)).toEqual({ box: "240x80", natural: "240x80", complete: true });
  expect(await imageReadings(page, REFS.wide), "超宽图仍按既有 max-width 口径收窄").toEqual({ box: box(600 / 2000), natural: "2000x600", complete: true });

  // 不可见的四处各自落地可见占位，且占位文本含原始引用串（alt 与路径都在其中）。
  // 两条分支各有输入：解码失败（空位图 / 外链被拦）与「兜底取不到宽度」（固有尺寸为零的 svg）。
  const chips = page.locator(".cm-lp-image-error");
  await expect(chips).toHaveCount(4);
  await expect(chips.filter({ hasText: REFS.empty })).toHaveText(`图片无法显示：${REFS.empty}`);
  await expect(chips.filter({ hasText: REFS.zeroDeclared })).toHaveText(`图片无法显示：${REFS.zeroDeclared}`);
  await expect(chips.filter({ hasText: REFS.remote })).toHaveText(`图片无法显示：${REFS.remote}`);
  await expect(chips.filter({ hasText: REFS.missing })).toContainText(`图片读取失败：${REFS.missing}`);

  // 通用不变量：十条引用无一留下零高度空白（宽度或高度为 0 即判）。
  const areas = await replacementAreas(page);
  expect(areas).toHaveLength(10);
  expect(areas.filter((a) => /^(0x|.*x0$)/.test(a.box))).toEqual([]);

  // 装饰层不改写文档（ADR 0003 §3）。
  expect(await readDocument(page)).toBe(images);
});

test("SVG 安全腿：脚本不执行、内嵌外链不发起请求、两处终态可见", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("**/example.invalid/**", (route) => route.abort());
  await open(page, images, "images.md", undefined, imageAssets);
  await expect(page.locator(".cm-lp-image-error")).toHaveCount(4);

  // 安全腿二（先判，防「不执行」这类负向断言在空转——REVIEW.md 第 2 条）：
  // 两处 svg 都真的渲染出来了（240×80）。
  expect(await imageReadings(page, REFS.script)).toEqual({ box: "240x80", natural: "240x80", complete: true });
  expect(await imageReadings(page, REFS.externalRef)).toEqual({ box: "240x80", natural: "240x80", complete: true });

  // 安全腿一：脚本的可观测副作用标记不存在，文档标题也没被改写。
  expect(await page.evaluate(() => (window as any).__lumirSvgScriptRan ?? null)).toBeNull();
  expect(await page.title()).toBe("Lumir");

  // 外部请求的**全集**：只有 md 里显式写的那条引用；svg 内嵌的
  // `https://example.invalid/lumir-svg-external-ref.png` 一次都没出现（外链腿有区分度：
  // 内联渲染时它必然出现，见 PR 说明里的临时内联实验）。
  const external = requests.filter((url) => !url.startsWith("http://127.0.0.1")).sort();
  expect(external).toEqual(["https://example.invalid/remote.png"]);
});

test("加载中状态在终态前始终可见（不留空窗）", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("**/example.invalid/**", (route) => route.abort());
  // 读字节慢一拍（读桩注入延迟，真机上这段窗口由附件大小与磁盘决定）：源码已被 replace
  // 装饰藏起来，此刻替换区若不可见就是用户看到的「空白」。延迟取得长一些，让采样落在
  // 加载中窗口内而不是与终态抢时间。
  await open(page, images, "images.md", undefined, imageAssets, 5000);

  const statuses = page.locator(".cm-lp-image-status");
  await expect(statuses.first()).toBeVisible();
  // 一次页面调用里同时取文本与布局盒：两件事不会落在不同的瞬间。
  const loading = await statuses.evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      return { text: (el.textContent ?? "").slice(0, 4), box: `${Math.round(box.width)}x${Math.round(box.height)}` };
    }),
  );
  expect(loading.length, "加载中窗口内应有多处状态块（一次也没采到说明断言没落在窗口里）").toBeGreaterThan(0);
  expect(loading.filter((item) => /^(0x|.*x0$)/.test(item.box)), "加载中状态块也必须占位").toEqual([]);
  expect(loading.every((item) => item.text.startsWith("加载中…")), "加载中状态块带原始引用文本").toBe(true);

  // 终态：加载中状态块全部撤下，替换区换成图片或可见占位（两者都不是空白）。
  await expect(statuses).toHaveCount(0, { timeout: 20000 });
  await expect(page.locator(".cm-lp-image-error")).toHaveCount(4);
  expect(await readDocument(page)).toBe(images);
});

// ---------------------------------------------------------------------------
// M184：图片双击放大查看（change open-image-lightbox 的实现期断言组）
// ---------------------------------------------------------------------------
// 判据口径（REVIEW.md 第 1 / 2 条）：
// - 「遮罩可见」用**几何读数**（放大图渲染盒宽高非零）与「与内联图同一图像源」判，不用 class
//   是否存在——class 在「遮罩开着但图是 0×0」时同样成立；
// - 「占位 / 加载态不可点开」与「同一份文档里成功渲染的图能打开」在**同一场景内配对**：只留负向
//   断言的话，「双击注入没落地」也会让它变绿；
// - 「焦点回到编辑器」用**行为判据**（关闭后 ⌃D 真的删掉一个字符，且 docText 的差异恰好是那一个
//   字符），不用「调用了 view.focus()」这类机制推断；
// - 「不重读字节」读的是读桩的**调用计数**（可外部观测），不是代码面 grep。
//
// 反向验证（1.2 / 5.6，红灯留档 test-results/m184/）：本组断言在实现落地前整组红（遮罩不存在）；
// 去掉 `src/style.css` 的 `.lumir-lightbox-img` `max-height` 后「大图不越界」那条必红。

const LIGHTBOX_OVERLAY = ".lumir-lightbox-overlay";

/** 双击某条引用渲染出的内联图片（双击只挂在这一张 `<img>` 上，见 preview/attachments.ts）。 */
const inlineImage = (page: Page, ref: string) => page.locator(`.cm-lp-image img[alt=${JSON.stringify(ref)}]`);

/** 读桩记下的 `fs_read_attachment` 调用次数。 */
async function attachmentReads(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__lumirAttachmentReads ?? 0);
}

/** 编辑器态：文档文本 + 选区（caret 落点）。逐值比较这四步的「不动文档、不动光标」共用一个读数。 */
async function editorState(page: Page) {
  return page.locator(".cm-content").evaluate((el) => {
    const tile = (el as unknown as {
      cmTile?: { root: { view: { state: { doc: { toString(): string }; selection: { main: { head: number; anchor: number } } } } } };
    }).cmTile;
    if (!tile) throw new Error("CodeMirror document inspection unavailable");
    const state = tile.root.view.state;
    return { doc: state.doc.toString(), head: state.selection.main.head, anchor: state.selection.main.anchor };
  });
}

/** 焦点归属：遮罩持有 / 编辑器持有（关闭后归还的那条断言读它）。 */
async function focusInfo(page: Page) {
  return page.evaluate((selector) => {
    const active = document.activeElement as HTMLElement | null;
    return {
      isOverlay: active !== null && active === document.querySelector(selector),
      inEditor: active !== null && active.closest(".cm-editor") !== null,
      tag: active?.tagName ?? null,
    };
  }, LIGHTBOX_OVERLAY);
}

/** 遮罩读数：可见性 + 放大图渲染盒与自然尺寸 + 遮罩可用区域（内容盒，已减掉内边距）+ 图像源。 */
async function lightboxReading(page: Page) {
  return page.evaluate((selector) => {
    const round = (n: number) => Math.round(n * 10) / 10;
    const overlay = document.querySelector(selector) as HTMLElement | null;
    if (!overlay) return { exists: false, hidden: true, box: null, area: null, natural: null, src: null, alt: null };
    const style = getComputedStyle(overlay);
    const rect = overlay.getBoundingClientRect();
    const img = overlay.querySelector("img") as HTMLImageElement | null;
    const box = img?.getBoundingClientRect();
    return {
      exists: true,
      hidden: overlay.hidden,
      box: box ? { width: round(box.width), height: round(box.height) } : null,
      area: {
        width: round(rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)),
        height: round(rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)),
      },
      natural: img ? { width: img.naturalWidth, height: img.naturalHeight } : null,
      src: img?.src ?? null,
      alt: img?.alt ?? null,
    };
  }, LIGHTBOX_OVERLAY);
}

/** 「关闭后焦点真的回到编辑器」的行为判据：⌃D 删掉光标处那一个字符，⌘Z 撤销复位。
 *  `before` 是打开遮罩之前的编辑器态：关闭后光标须停在原位（打开与关闭都不动选区），
 *  被删掉的须恰好是光标处那一个字符、且撤销后逐字节回到原文档。 */
async function deletesAtCaretAfterClose(page: Page, before: { doc: string; head: number }) {
  expect((await editorState(page)).head, "关闭后光标须停在打开前的位置（打开与关闭都不动选区）").toBe(before.head);
  expect(before.head, "光标处要有可删的字符（否则这条判据空转）").toBeLessThan(before.doc.length);
  await page.keyboard.press("Control+d");
  const deleted = await editorState(page);
  expect(deleted.doc.length, "关闭后 ⌃D 未生效说明焦点没回到编辑器").toBe(before.doc.length - 1);
  expect(
    deleted.doc.slice(0, before.head) + before.doc[before.head] + deleted.doc.slice(before.head),
    "被删掉的应当恰好是光标处那一个字符",
  ).toBe(before.doc);
  await page.keyboard.press("Meta+z");
  expect((await editorState(page)).doc, "撤销后应逐字节回到原文档").toBe(before.doc);
}

/** 等放大图真的画出来：赋 src 到完成布局之间有一拍，几何断言前先等渲染盒非零（否则读到 0×0，
 *  会把「还没布局」误判成「适配口径错了」）。 */
async function waitForLightboxImage(page: Page) {
  await expect.poll(async () => (await lightboxReading(page)).box?.width ?? 0).toBeGreaterThan(0);
}

test("M184 双击打开遮罩、三条关闭路径与焦点归还", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("**/example.invalid/**", (route) => route.abort());
  await open(page, images, "images.md", undefined, imageAssets);
  await expect(page.locator(".cm-lp-image-status")).toHaveCount(0);
  await expect(page.locator(".cm-lp-image img")).toHaveCount(6);

  const overlay = page.locator(LIGHTBOX_OVERLAY);
  // 惰性建立（2.5）：一次都没双击时 DOM 里没有遮罩节点。
  await expect(overlay).toHaveCount(0);
  // 先把光标落到第一行（后面「关闭后 ⌃D 真的删字符」需要一个确定的可删位置；单击不进
  // 图片行，也不在任何显露覆盖集内）。
  await page.locator(".cm-content").click({ position: { x: 8, y: 6 } });
  const before = await editorState(page);
  const readsBefore = await attachmentReads(page);

  // 打开：双击终态渲染出的那张图。
  await inlineImage(page, REFS.fixed).dblclick();
  await expect(overlay).toHaveCount(1);
  await expect(overlay).toBeVisible();
  await waitForLightboxImage(page);
  const opened = await lightboxReading(page);
  expect(opened.box?.width ?? 0, "放大图渲染盒宽度须非零（几何判据）").toBeGreaterThan(0);
  expect(opened.box?.height ?? 0, "放大图渲染盒高度须非零（几何判据）").toBeGreaterThan(0);
  expect(opened.alt, "放大图的 alt = 原始引用文本（与内联图同一口径）").toBe(REFS.fixed);
  expect(opened.src, "放大图须与内联图同一图像源").toBe(await inlineImage(page, REFS.fixed).evaluate((el) => (el as HTMLImageElement).src));
  expect(await attachmentReads(page), "打开遮罩不得再读一次附件字节").toBe(readsBefore);

  // 模态：编辑键不穿透、Tab 留在遮罩内，文档与光标逐值不变。
  for (const key of ["Control+d", "Control+k", "Control+a", "Tab"]) await page.keyboard.press(key);
  // M209 G2：scenario 的 WHEN 是「若干编辑键与字符键」，此前只按了 Control 组合与 Tab。
  // 字符键不在统一键位表里（`keyToken` 对它返回 null，遮罩不消费也不拦截），走的是文本插入
  // 路径——它能不能落到文档只取决于焦点在不在编辑器。**这一腿不是重复覆盖**：下面同一组
  // `editorState` 逐值断言是它唯一的接住点（焦点若被 TextInput 之类拉回编辑器，"abc" 就会
  // 进文档、doc 长度当场变，断言必红）。
  await page.keyboard.type("abc");
  await expect(overlay, "遮罩持有焦点期间不得被按键关掉").toBeVisible();
  expect(await focusInfo(page), "Tab 不得把焦点送出遮罩").toMatchObject({ isOverlay: true });
  expect(await editorState(page), "打开期间文档与光标必须逐值不变").toEqual(before);

  // 关闭路径一：Esc（就地消费）。
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  expect(await focusInfo(page), "Esc 关闭后焦点须回到编辑器").toMatchObject({ inEditor: true });
  expect((await editorState(page)).head, "打开与关闭都不得移动光标").toBe(before.head);
  await deletesAtCaretAfterClose(page, before);

  // 关闭路径二：点击遮罩（图片以外的区域）。
  await inlineImage(page, REFS.fixed).dblclick();
  await expect(overlay).toBeVisible();
  await waitForLightboxImage(page);
  await overlay.click({ position: { x: 4, y: 4 } });
  await expect(overlay).toBeHidden();
  expect(await focusInfo(page), "点击遮罩关闭后焦点须回到编辑器（mousedown preventDefault 的判据）").toMatchObject({ inEditor: true });
  await deletesAtCaretAfterClose(page, before);

  // 关闭路径三：遮罩内再次双击放大图。
  await inlineImage(page, REFS.fixed).dblclick();
  await expect(overlay).toBeVisible();
  await waitForLightboxImage(page);
  // 放大图的 alt 与内联图相同（同一引用原文），因此按「遮罩里那一张」定位。
  await overlay.locator("img").dblclick();
  await expect(overlay).toBeHidden();
  expect(await focusInfo(page), "双击图片关闭后焦点须回到编辑器").toMatchObject({ inEditor: true });
  await deletesAtCaretAfterClose(page, before);

  // 再次打开不会建出第二个遮罩节点（惰性建立 + 单实例）。
  await inlineImage(page, REFS.fixed).dblclick();
  await expect(overlay).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();

  // 全程不改写文档（ADR 0003 §3）：解引用、按键、三次关闭、三次撤销之后逐字节回到原文。
  expect(await readDocument(page)).toBe(images);
});

test("M184 放大口径：宽图与高图都不越出遮罩、小图不放大", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("**/example.invalid/**", (route) => route.abort());
  // 三个尺寸面各自需要一张会「被不同维度夹住」的图（VIEWPORT 1280×1000 → 遮罩可用 1120×720 左右）：
  // 宽图（2000×150）由**宽度**夹住、高图（600×2000）由**高度**夹住、小图（240×80）两个维度都不夹。
  // 只断言宽图的话，`max-height` 这一条规则根本没有区分度（2000×150 按宽度缩到 1120×84，
  // 高度远没到 720）——反向验证时实测「去掉 max-height 仍然全绿」，所以高图这一腿是必须的。
  const doc = [
    "# 放大口径样本",
    "",
    "宽图（2000×150）：",
    "",
    "![wide](assets/wide.svg)",
    "",
    "高图（600×2000）：",
    "",
    "![tall](assets/tall.svg)",
    "",
    "小图（240×80）：",
    "",
    "![fixed](assets/sample.svg)",
    "",
  ].join("\n");
  const assets = { "assets/wide.svg": fixture("wide.svg"), "assets/tall.svg": fixture("tall.svg"), "assets/sample.svg": image };
  await stubTauri(page, {
    entries: ["zoom.md", ...Object.keys(assets)].map((path) => ({ path, kind: "file", size: doc.length, mtime_ms: 0 })),
    files: { "zoom.md": doc, ...assets },
  });
  await stubAttachmentReads(page, assets);
  await page.goto("/");
  await page.locator('.ft-row[title="zoom.md"]').click();
  await expect(page.locator(".cm-lp-image-status")).toHaveCount(0);

  const overlay = page.locator(LIGHTBOX_OVERLAY);
  const cases = [
    { ref: "![wide](assets/wide.svg)", natural: { width: 2000, height: 600 }, clamp: "width" },
    { ref: "![tall](assets/tall.svg)", natural: { width: 600, height: 2000 }, clamp: "height" },
  ] as const;

  for (const item of cases) {
    await inlineImage(page, item.ref).dblclick();
    await expect(overlay).toBeVisible();
    await waitForLightboxImage(page);
    const big = await lightboxReading(page);
    expect(big.natural, "放大图就是内联那张图的自然尺寸").toEqual(item.natural);
    // 完整可见：两个维度都不越出遮罩的可用区域（不需要滚动或平移）。
    expect(big.box!.width, `${item.ref} 不得越出遮罩可用宽度`).toBeLessThanOrEqual(big.area!.width + 1);
    expect(big.box!.height, `${item.ref} 不得越出遮罩可用高度`).toBeLessThanOrEqual(big.area!.height + 1);
    // 区分度：被哪个维度夹住就断言那一条贴住可用区域——去掉对应的 max-width / max-height
    // 规则时这两条先红（反向验证留档 test-results/m184/）。
    const binding = item.clamp === "width" ? big.box!.width - big.area!.width : big.box!.height - big.area!.height;
    expect(Math.abs(binding), `${item.ref} 应被可用${item.clamp === "width" ? "宽" : "高"}度夹住（完整可见）`).toBeLessThanOrEqual(1);
    expect(big.box!.width, `${item.ref} 应收窄到遮罩内`).toBeLessThan(item.natural.width);
    await page.keyboard.press("Escape");
    await expect(overlay).toBeHidden();
  }

  // 小图（240×80）：按自然尺寸显示，不放大（MUST NOT 写 width: 100%，那会把它拉成可用宽度）。
  await inlineImage(page, "![fixed](assets/sample.svg)").dblclick();
  await expect(overlay).toBeVisible();
  await waitForLightboxImage(page);
  const small = await lightboxReading(page);
  expect(small.natural).toEqual({ width: 240, height: 80 });
  expect(small.box, "小图不得被放大（也不得被拉成其他尺寸）").toEqual({ width: 240, height: 80 });
});

test("M184 占位与加载态没有打开路径（同场景配对正观测）", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("**/example.invalid/**", (route) => route.abort());
  const doc = [
    "# 占位与加载态",
    "",
    "成功渲染的图（配对的正观测）：",
    "",
    "![ok](assets/sample.svg)",
    "",
    "读取失败：",
    "",
    "![failed](assets/missing.png)",
    "",
    "终态不可见（0 字节位图）：",
    "",
    "![invisible](assets/empty.png)",
    "",
    "附件未找到：",
    "",
    "![[gone.svg]]",
    "",
    "内容嵌入不支持：",
    "",
    "![[note.md]]",
    "",
    "外部 URL（安全策略拦下）：",
    "",
    "![remote](https://example.invalid/remote.png)",
    "",
  ].join("\n");
  const none = { status: "none", heading: null, line: null };
  await stubTauri(page, {
    entries: ["placeholders.md", "assets/sample.svg", "assets/missing.png", "assets/empty.png"].map((path) => ({
      path,
      kind: "file",
      size: doc.length,
      mtime_ms: 0,
    })),
    files: { "placeholders.md": doc, "assets/sample.svg": image, "assets/empty.png": fixture("empty.png") },
    links: {
      "![[gone.svg]]": { status: "unresolved", path: null, candidates: [], embed_target: null, anchor: none },
      "![[note.md]]": { status: "resolved", path: "note.md", candidates: [], embed_target: "note", anchor: none },
    },
  });
  await stubAttachmentReads(page, { "assets/sample.svg": image, "assets/empty.png": fixture("empty.png") });
  await page.goto("/");
  await page.locator('.ft-row[title="placeholders.md"]').click();
  await expect(page.locator(".cm-lp-image-status")).toHaveCount(0);

  const overlay = page.locator(LIGHTBOX_OVERLAY);
  // 先证明四类占位真的在场上（正观测）——否则下面的负向断言可能只是「文档没打开」的空转。
  await expect(page.locator(".cm-lp-image img")).toHaveCount(1);
  await expect(page.locator(".cm-lp-image-error")).toHaveCount(3);
  await expect(page.locator(".cm-lp-embed-unsupported")).toHaveCount(2);

  for (const selector of [".cm-lp-image-error", ".cm-lp-embed-unsupported"]) {
    const count = await page.locator(selector).count();
    expect(count, `${selector} 未就位，负向断言会空转`).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await page.locator(selector).nth(i).dblclick();
      await expect(overlay, `${selector} 第 ${i + 1} 处不得有打开路径`).toHaveCount(0);
    }
  }

  // 配对的正观测：同一份文档里成功渲染出的那张图能打开（否则上面那一组可能只是双击没落地）。
  await inlineImage(page, "![ok](assets/sample.svg)").dblclick();
  await expect(overlay).toBeVisible();
  await waitForLightboxImage(page);
  expect((await lightboxReading(page)).box!.width).toBeGreaterThan(0);
});

test("M184 加载中状态块没有打开路径", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("**/example.invalid/**", (route) => route.abort());
  // 读字节慢一拍：源码已被 replace 装饰藏起，此刻替换区是加载中状态块（还没有 `<img>`）。
  await open(page, images, "images.md", undefined, imageAssets, 5000);

  const statuses = page.locator(".cm-lp-image-status");
  await expect(statuses.first()).toBeVisible();
  expect(await statuses.count(), "加载中窗口内应有多处状态块（一次也没采到说明断言没落在窗口里）").toBeGreaterThan(0);
  await statuses.first().dblclick();
  await expect(page.locator(LIGHTBOX_OVERLAY)).toHaveCount(0);

  // 配对的正观测：终态之后同一位置的图能打开。
  await expect(statuses).toHaveCount(0, { timeout: 20000 });
  await inlineImage(page, REFS.fixed).dblclick();
  await expect(page.locator(LIGHTBOX_OVERLAY)).toBeVisible();
});

test("M184 打开遮罩不重读字节、惰性建立不预建", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("**/example.invalid/**", (route) => route.abort());
  await open(page, images, "images.md", undefined, imageAssets);
  await expect(page.locator(".cm-lp-image-status")).toHaveCount(0);
  await expect(page.locator(".cm-lp-image img")).toHaveCount(6);

  // 十条引用各自只读一次（读取计数 = 成功渲染 + 读取尝试的条数），且没有遮罩节点。
  const settled = await attachmentReads(page);
  expect(settled, "文档打开路径上的读取次数不得多于引用条数").toBeLessThanOrEqual(10);
  await expect(page.locator(LIGHTBOX_OVERLAY)).toHaveCount(0);

  await inlineImage(page, REFS.wide).dblclick();
  await expect(page.locator(LIGHTBOX_OVERLAY)).toBeVisible();
  expect(await attachmentReads(page), "打开遮罩前后调用计数必须不变").toBe(settled);
});

// ---------------------------------------------------------------------------
// M209：G1 / G2 断言缺口补口（change open-image-lightbox 归档前的覆盖收口）
// ---------------------------------------------------------------------------
// 缺口来自 M207 归档对账：delta 的 scenario「三种引用形态都打开遮罩、同一图像源、SVG 与位图同构」
// 在 lightbox 层零断言——M184 组的 12 次 dblclick 全落在 SVG 标准形态上，方言形态
//（`![[percent-width.svg]]`）与位图形态一次都没双击过；「遮罩持有焦点期间若干字符键」也没按过
// 字符键（G2 补在 M184 组那条模态循环里）。
//
// 判据口径与 M184 组完全同一套（几何读数 + 「与内联那张同一图像源」+ 正/负配对），不新造读数：
// 每条断言都先给出「目标真的在场上」的正观测，再判要判的那件事——只留 src 相等这类单腿断言时，
// 「双击没落地」或「图片是坏图」都能让它绿（REVIEW.md 第 1 / 2 条）。

test("M209 方言形态（![[percent-width.svg]]）打开遮罩且图像源一致（G1①）", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("**/example.invalid/**", (route) => route.abort());
  await open(page, images, "images.md", undefined, imageAssets);
  await expect(page.locator(".cm-lp-image-status")).toHaveCount(0);

  // 正观测先行：方言形态（wikilink 解析出的 embed 分支）的内联图真的渲染出来了。
  // 期望盒按阅读列的文字实测宽算（栏宽 = `.cm-content` 的内容盒；见「图片终态」那条的说明）。
  const wikiColumn = await page.evaluate(() => {
    const el = document.querySelector(".cm-content")!;
    const style = getComputedStyle(el);
    return el.getBoundingClientRect().width - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
  });
  expect(await imageReadings(page, REFS.percentWiki), "方言形态内联图读数").toEqual({
    box: `${Math.round(wikiColumn)}x${Math.round(wikiColumn / 3)}`,
    natural: "300x100",
    complete: true,
  });
  const inlineSrc = await inlineImage(page, REFS.percentWiki).evaluate((el) => (el as HTMLImageElement).src);

  await inlineImage(page, REFS.percentWiki).dblclick();
  const overlay = page.locator(LIGHTBOX_OVERLAY);
  await expect(overlay, "方言形态双击不得没有打开路径").toHaveCount(1);
  await expect(overlay).toBeVisible();
  await waitForLightboxImage(page);

  const big = await lightboxReading(page);
  expect(big.natural, "放大图就是内联那张（自然尺寸逐值相同）").toEqual({ width: 300, height: 100 });
  expect(big.alt, "放大图 alt = 方言引用的原文").toBe(REFS.percentWiki);
  expect(big.src, "放大图 src 与方言形态内联图逐字符相同（同一图像源）").toBe(inlineSrc);
  // 装饰层不改写文档（ADR 0003 §3）：解引用与打开遮罩都不动源文件。
  expect(await readDocument(page)).toBe(images);
});

test("M209 位图形态打开遮罩且图像源一致（G1②）", async ({ page }) => {
  const doc = ["# 位图形态（G1②）", "", "有效位图（96×32，可解码）：", "", BITMAP_REF, ""].join("\n");
  await page.setViewportSize({ width: 1280, height: 1000 });
  await stubTauri(page, {
    entries: [
      { path: "bitmap.md", kind: "file", size: doc.length, mtime_ms: 0 },
      { path: "assets/bitmap.png", kind: "file", size: 162, mtime_ms: 0 },
    ],
    files: { "bitmap.md": doc },
  });
  // 二进制 fixture 按 base64 进读桩（UTF-8 往返会把它变成替换字符，那样这条用例验的是解码失败）。
  await stubAttachmentReads(page, { "assets/bitmap.png": { base64: bitmapBase64 } });
  await page.goto("/");
  await page.locator('.ft-row[title="bitmap.md"]').click();
  await expect(page.locator(".cm-lp-image-status")).toHaveCount(0);

  // 正观测：位图真的解码出来了（96×32）。**只判 src 相等是不够的**——src 相同而图是坏图
  //（渲染盒 0×0）时那条断言照样绿，因此自然尺寸与渲染盒都判。
  expect(await imageReadings(page, BITMAP_REF), "位图内联图读数").toEqual({ box: "96x32", natural: "96x32", complete: true });
  const inlineSrc = await inlineImage(page, BITMAP_REF).evaluate((el) => (el as HTMLImageElement).src);

  await inlineImage(page, BITMAP_REF).dblclick();
  const overlay = page.locator(LIGHTBOX_OVERLAY);
  await expect(overlay).toBeVisible();
  await waitForLightboxImage(page);

  const big = await lightboxReading(page);
  expect(big.alt, "放大图 alt = 位图引用原文").toBe(BITMAP_REF);
  expect(big.src, "放大图 src 与内联那张位图逐字符相同").toBe(inlineSrc);
  expect(big.natural, "放大图就是内联那张位图（不是另一份解码结果）").toEqual({ width: 96, height: 32 });
  expect(big.box, "小位图按自然尺寸显示，不放大").toEqual({ width: 96, height: 32 });
  expect(await readDocument(page)).toBe(doc);
});

test("M209 放大层不发起外链请求、无脚本副作用（G1③）", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("**/example.invalid/**", (route) => route.abort());
  await open(page, images, "images.md", undefined, imageAssets);
  await expect(page.locator(".cm-lp-image-status")).toHaveCount(0);
  await expect(page.locator(".cm-lp-image")).toHaveCount(10);

  // 安全腿二（先判，防负向断言空转）：含外部 `<image href>` 的那张 svg 内联渲染成功。
  expect(await imageReadings(page, REFS.externalRef), "含外链的 svg 内联渲染成功").toEqual({ box: "240x80", natural: "240x80", complete: true });
  const external = () => requests.filter((url) => !url.startsWith("http://127.0.0.1")).sort();
  expect(external(), "内联层的外链集合（对照基线）").toEqual(["https://example.invalid/remote.png"]);

  const overlay = page.locator(LIGHTBOX_OVERLAY);
  await inlineImage(page, REFS.externalRef).dblclick();
  await expect(overlay).toBeVisible();
  await waitForLightboxImage(page);
  expect((await lightboxReading(page)).natural, "放大的是同一张 svg（含外链那张）").toEqual({ width: 240, height: 80 });
  // 放大层若把 svg 内容内联进 DOM（innerHTML / DOMParser 之类），svg 内嵌的
  // `https://example.invalid/lumir-svg-external-ref.png` 就会出现——内联渲染时的现场见上方
  // 「SVG 安全腿」用例。给一拍时间让迟到请求也落进集合，再比**全集**。
  await page.waitForTimeout(500);
  expect(external(), "放大层不得发起任何新的外部请求").toEqual(["https://example.invalid/remote.png"]);

  // 另一张含 `<script>` / `onload` 的 svg：放大同样不得执行它们（两个可观测副作用：window 标记
  // 与 document.title，后者若被改写说明脚本在放大层里真的跑了）。
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  await inlineImage(page, REFS.script).dblclick();
  await expect(overlay).toBeVisible();
  await waitForLightboxImage(page);
  expect((await lightboxReading(page)).natural, "放大的是含脚本那张 svg").toEqual({ width: 240, height: 80 });
  expect(await page.evaluate(() => (window as any).__lumirSvgScriptRan ?? null), "放大层不得执行 svg 内脚本").toBeNull();
  expect(await page.title(), "放大层不得改写文档标题（onload / script 两条都不跑）").toBe("Lumir");
  expect(await readDocument(page)).toBe(images);
});
