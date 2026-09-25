// 排版与字号步进场景（M195，change typography-and-zoom）。
//
// 判据一律是**读数**（计算属性、px 值、几何、像素哈希），不是「某个函数被调用过」：
// 本 change 的可见结果就是字号与字体本身，读数就是它的证据面（REVIEW.md 第 1 / 11 条）。
//
// 覆盖：出厂口径读数（D1 裁决后的新基准：15px / 行高 1.7 / 标记 .9em）、配置生效且只作用于
// 编辑器、非法值 / 未安装字体退化为基线、三条步进命令与上下限、重置回配置值、不落盘不碰 dirty、
// 键位通路唯一、焦点在左栏同样命中、改字号后坐标 / 行高 / 标记宽度 / 光标可见性。
//
// 刻意**不为出厂口径新增像素基线**（D6：新增基线只放非默认口径）——出厂口径的回归由既有
// 整页基线与本场景的计算属性读数共同守。

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { expectScreenshot } from "./expect-screenshot";
import { readDocument } from "./parity-checks";

/** 场景文档：标题（改 sans 字重阶梯，restyle 后不再有独立的标题字族）+ 正文段落 +
 *  短行列表（每行独占一行，供「点击落行」这类几何判据用——行行等高的短行让陈旧 heightmap
 *  的落点错到别的行上，判据才有区分度）+ 围栏代码块（等宽族）。 */
const DOC = [
  "# 排版标题",
  "",
  "Ordinary paragraph with enough words to wrap across the reading column so that the line height is measurable.",
  "",
  "- alpha one",
  "- bravo two",
  "- charlie three",
  "- delta four",
  "- echo five",
  "- foxtrot six",
  "- golf seven",
  "- hotel eight",
  "",
  "```js",
  "const x = 1;",
  "```",
  "",
  "尾段。",
  "",
].join("\n");

/** 基线族的**期望字面量**（= src/style.css 的 `--font-sans` / `--font-mono` 默认值）。
 *  Chromium 序列化计算值时会按「同族取先出现的那个 + 别名归一」处理：`BlinkMacSystemFont` 与
 *  `-apple-system` 同族，序列化后写成 `"system-ui"`。因此这里的字面量是**归一后**的形态。 */
const BODY_BASELINE = '-apple-system, "system-ui", "SF Pro Text", "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", sans-serif';
/** `--font-sans` 的**原文**（不归一）：`applyTypography` 把用户值 + 后备栈**逐字**写进
 *  `documentElement.style`，inline 的 token 值因此保留 `BlinkMacSystemFont`。
 *  两种形态各有一条断言面：计算值比归一后的串，inline token 比原文串。 */
const BODY_STACK_RAW = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", sans-serif';
const MONO_BASELINE = 'ui-monospace, "SF Mono", Menlo, monospace';

/** 出厂正文锚（D1 裁决 = 15px）与行高比（`--lh-reading` = 1.7）——本场景多处按它换算。 */
const BASE_FONT_SIZE = 15;
const BASE_LINE_HEIGHT_RATIO = 1.7;

interface TypographyConfig {
  font_family?: string | null;
  mono_font_family?: string | null;
  font_size?: number;
}

/** 打开一个文档页。`config` 只放排版三项（缺省 = 出厂口径，既有场景的形态）。 */
async function open(page: Page, options: { config?: TypographyConfig; text?: string } = {}): Promise<void> {
  const text = options.text ?? DOC;
  await stubTauri(page, {
    entries: [{ path: "doc.md", kind: "file", size: text.length, mtime_ms: 0 }],
    files: { "doc.md": text },
    config: options.config,
  });
  await page.goto("/");
  await page.locator('.ft-row[title="doc.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("doc.md");
  await expect(page.locator(".cm-lp-list-marker").first()).toBeVisible();
  // 等配置装载完成（applyTypography 在 config_get 的回调里，晚于首帧）
  await expect.poll(() => page.evaluate(() => (window as never as { __configGets: number }).__configGets)).toBeGreaterThan(0);
  await page.waitForTimeout(80);
}

/** 编辑器内容面的排版读数（1.1 那份现状读数的字段集 + 需要对比的 shell 侧元素）。 */
async function readings(page: Page) {
  return page.evaluate(() => {
    const content = document.querySelector(".cm-content")!;
    const marker = document.querySelector(".cm-lp-list-marker")!;
    const codeLine = document.querySelector(".cm-lp-codeblock-line")!;
    const heading = document.querySelector(".cm-lp-h1")!;
    const ftRow = document.querySelector(".ft-row:not(.ft-dir)")!;
    const modeline = document.querySelector(".modeline")!;
    const line = [...document.querySelectorAll(".cm-line")].find((el) =>
      (el.textContent ?? "").includes("delta four"),
    )!;
    const cs = getComputedStyle(content);
    return {
      contentFontSize: cs.fontSize,
      contentFontFamily: cs.fontFamily,
      contentLineHeight: cs.lineHeight,
      editorFontFamily: getComputedStyle(document.querySelector(".cm-editor")!).fontFamily,
      listMarkerFontFamily: getComputedStyle(marker).fontFamily,
      listMarkerFontSize: getComputedStyle(marker).fontSize,
      listMarkerWidth: marker.getBoundingClientRect().width,
      codeLineFontFamily: getComputedStyle(codeLine).fontFamily,
      headingFontFamily: getComputedStyle(heading).fontFamily,
      headingFontWeight: getComputedStyle(heading).fontWeight,
      singleLineHeight: line.getBoundingClientRect().height,
      // shell 侧（MUST NOT 受排版配置影响）
      fileTreeRowFontSize: getComputedStyle(ftRow).fontSize,
      fileTreeRowFontFamily: getComputedStyle(ftRow).fontFamily,
      modelineFontFamily: getComputedStyle(modeline).fontFamily,
      rootInlineTokens: {
        size: document.documentElement.style.getPropertyValue("--editor-font-size"),
        family: document.documentElement.style.getPropertyValue("--editor-font-family"),
        mono: document.documentElement.style.getPropertyValue("--editor-mono-family"),
      },
    };
  });
}

async function contentFontSize(page: Page): Promise<number> {
  return page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".cm-content")!).fontSize));
}

/** 装一个 canvas 字体探针：`context.font = "..."` 的**原始赋值串**逐次记录。
 *  这是「测量与渲染同源」唯一可读的证据面——测量喂进去的是字符串，不是 CSS 引用。 */
async function watchCanvasFont(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as never as { __canvasFonts: string[] };
    w.__canvasFonts = [];
    const proto = CanvasRenderingContext2D.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "font")!;
    Object.defineProperty(proto, "font", {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value: string) {
        w.__canvasFonts.push(String(value));
        descriptor.set!.call(this, value);
      },
    });
  });
}

/** 最近一次喂给 canvas 的字体串（`<px>px <family>`）。 */
async function lastCanvasFont(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const list = (window as never as { __canvasFonts: string[] }).__canvasFonts;
    return list.length > 0 ? list[list.length - 1] : null;
  });
}

/** 喂给 canvas 的全部字体串（列表标记测量按 MARKER_FONT_RATIOS 三档各写一次）。 */
async function canvasFonts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as never as { __canvasFonts: string[] }).__canvasFonts.slice());
}

/** 装一个窗口级 keydown 监听计数器：本 change 的「键位通路唯一」判据靠它——
 *  Tauri 的 webview 缩放热键（MUST NOT 启用）正是以 window 级 keydown 监听实现的，
 *  启用后这里的计数会变 2，「同一物理键两条分发路径」当场可见。 */
async function countWindowKeydownListeners(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as never as { __windowKeydownListeners: string[] };
    w.__windowKeydownListeners = [];
    const original = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "keydown" && (this === window || this === document)) {
        const name = typeof listener === "function" ? listener.name || "anonymous" : "object";
        w.__windowKeydownListeners.push(name);
      }
      return original.call(this, type, listener, options);
    } as typeof EventTarget.prototype.addEventListener;
  });
}

/** 编辑器内容面的像素读数（元素级截图 → sha256）：用于「观感与缺省配置逐像素相同」这类判据。
 *
 *  焦点状态先归一（bringToFront + blur）：多标签页场景里只有一个是活动文档，而
 *  `.cm-focused` / 焦点相关的浏览器着色会让两张图无从比较。同一口径下两张**应当相同**的图
 *  必逐字节相同，因此本判据不经容差——它就是「逐像素相同」这句话的字面实现。
 *  仪器自证见「像素对比仪器自证」那条：两个同配置的页面必须给出同一个哈希。 */
async function contentPixelHash(page: Page): Promise<string> {
  await page.bringToFront();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(60);
  const buffer = await page.locator(".cm-content").screenshot({ animations: "disabled" });
  return digest(String((buffer as unknown as { toString(encoding: string): string }).toString("base64")));
}

/** 一阶 FNV-1a 摘要（含长度）：把整幅 base64 压成短串，避免断言失败时把两幅图的 base64
 *  全量打进日志。这里只用于「两次截图是否逐字节相同」，不是任何安全用途。 */
function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(36)}`;
}

async function invokeLog(page: Page): Promise<string[]> {
  return page.evaluate(() => [...((window as never as { __invokes: string[] }).__invokes ?? [])]);
}

/** 光标几何读数：CM 的 `coordsAtPos(head)` 与光标所在行的 DOM 矩形（spec 的
 *  「改字号后坐标与行高一致」判据）。CM 的 view 经 `.cm-content` 上的 `cmTile` 可达
 *（既有场景读文档全文用的就是这条路径，见 parity-checks.ts 的 readDocument）。 */
async function caretGeometry(page: Page, needle: string) {
  return page.evaluate((target: string) => {
    type CmView = {
      state: {
        selection: { main: { head: number } };
        doc: { lineAt: (pos: number) => { text: string } };
      };
      coordsAtPos: (pos: number) => { top: number; bottom: number } | null;
    };
    const content = document.querySelector(".cm-content") as HTMLElement & {
      cmTile?: { root: { view: CmView } };
    };
    const view = content.cmTile!.root.view;
    const head = view.state.selection.main.head;
    const coords = view.coordsAtPos(head);
    const selection = window.getSelection();
    let domRect: { top: number; bottom: number } | null = null;
    if (selection && selection.rangeCount > 0) {
      const box = selection.getRangeAt(0).cloneRange().getBoundingClientRect();
      // 折叠选区的矩形在部分情况下退化为全零（读不到 ≠ 为空，REVIEW.md 第 2 条）：只在它
      // 真的有几何时才拿它比较。
      if (box.height > 0) domRect = { top: box.top, bottom: box.bottom };
    }
    const line = [...document.querySelectorAll(".cm-line")].find((el) => (el.textContent ?? "").includes(target));
    if (!line) return { headText: view.state.doc.lineAt(head).text, coords, domRect, lineTop: null, lineBottom: null };
    const rect = line.getBoundingClientRect();
    return {
      headText: view.state.doc.lineAt(head).text,
      coords,
      domRect,
      lineTop: rect.top,
      lineBottom: rect.bottom,
    };
  }, needle);
}

// ---------------------------------------------------------------------------
// 默认口径：与 change 之前的读数逐项相同
// ---------------------------------------------------------------------------

test("缺省配置即出厂口径（D1 = 15px / 行高 1.7 / 标记 .9em）", async ({ page }) => {
  await watchCanvasFont(page);
  await open(page);
  const now = await readings(page);
  // M195 的现状读数（落 test-results/m195/typography-before/readings.json）在 restyle 后按新
  // 基准逐项平移：字号 16→15（D1 裁决）、行高 1.75→1.7、列表标记 .85em→.9em（tokens 阶梯的
  // 13.5px 档）。判据仍是「读到的字面量」，只是字面量本身换了。
  expect(now.contentFontSize).toBe(`${BASE_FONT_SIZE}px`);
  expect(now.contentFontFamily).toBe(BODY_BASELINE);
  expect(now.contentLineHeight).toBe(`${BASE_FONT_SIZE * BASE_LINE_HEIGHT_RATIO}px`);
  expect(now.editorFontFamily).toBe(BODY_BASELINE);
  expect(now.listMarkerFontFamily).toBe(BODY_BASELINE); // C3（M218）：标记族改 sans（--editor-font-family）
  expect(now.listMarkerFontSize).toBe(`${BASE_FONT_SIZE * 0.9}px`);
  expect(now.codeLineFontFamily).toBe(MONO_BASELINE);
  // 单行行盒 = 字号 × 1.7 + 2px 列表项间距（定稿 li margin 2px 由每个 item 首行的
  //  paddingTop 承载，theme.ts:306-309）——读数行是列表行，间距计入行盒。
  expect(now.singleLineHeight).toBeCloseTo(BASE_FONT_SIZE * BASE_LINE_HEIGHT_RATIO + 2, 1);
  // 唯一的写值点是 --editor-font-size（15px），字体族 token 未被写入（沿用 :root 的 var() 引用）
  expect(now.rootInlineTokens.size).toBe(`${BASE_FONT_SIZE}px`);
  expect(now.rootInlineTokens.family).toBe("");
  expect(now.rootInlineTokens.mono).toBe("");

  // 测量与渲染同源：canvas 拿到的族串 = token **原文**（`--font-sans` 的未归一字面量），
  // 与标记的**计算** fontFamily（Chromium 归一形态，BlinkMacSystemFont→"system-ui"）不是同一
  // 形态——mono 栈无别名时二者恰好相等，sans 栈有别名就分叉。canvas 侧钉原文串，归一形态由
  // 上面的 listMarkerFontFamily 断言钉。
  // C3（M218）起测量按 MARKER_FONT_RATIOS 三档标记字号（13.5/13/12.5 ÷ 正文锚，
  // lists.ts:34-37）各写一次 font——三档都要钉，只钉最后一次会漏掉档间分叉。
  const fonts = await canvasFonts(page);
  expect(fonts.length, "列表标记的 canvas 测量必须真的跑过").toBeGreaterThan(0);
  expect([...new Set(fonts.map((f) => f.slice(f.indexOf("px ") + 3)))]).toEqual([BODY_STACK_RAW]);
  const sizes = [...new Set(fonts.map((f) => parseFloat(f)))].sort((a, b) => b - a);
  expect(sizes).toHaveLength(3);
  const base = parseFloat(now.contentFontSize);
  for (const [i, ratio] of [13.5 / 15, 13 / 15, 12.5 / 15].entries()) {
    expect(sizes[i]).toBeCloseTo(base * ratio, 1);
  }
});

test("配置生效且只作用于编辑器（正文 / 等宽 / 字号各自取到新值，shell 逐项不变）", async ({ page, context }) => {
  await open(page);
  const before = await readings(page);
  const customPage = await context.newPage();
  await open(customPage, {
    config: {
      font_family: '"LXGW WenKai"',
      mono_font_family: '"JetBrains Mono"',
      font_size: 20,
    },
  });
  const after = await readings(customPage);

  // 配置值 + 基线后备栈（「本机没装这个字体」退化成基线观感，而不是浏览器默认字体）
  expect(after.contentFontFamily).toBe(`"LXGW WenKai", ${BODY_BASELINE}`);
  expect(after.contentFontSize).toBe("20px");
  expect(after.contentLineHeight).toBe("34px"); // 无单位行高 1.7 随字号等比
  // 标记族随正文族（C3）：sans 配置值落在标记上，mono 配置只管代码
  expect(after.listMarkerFontFamily).toBe(`"LXGW WenKai", ${BODY_BASELINE}`);
  expect(after.codeLineFontFamily).toBe(`"JetBrains Mono", ${MONO_BASELINE}`);
  expect(after.listMarkerFontSize).toBe("18px"); // .9em
  // 标题族：restyle 起标题**没有独立字族**（`--font-display` 随 token 层删除，h1–h6 改 sans
  // 字重阶梯）——标题族因此随正文族走（配了正文字族时一起变，这是「编辑器即阅读表面」的应有
  // 形态），不可配的是**字重阶梯**：它取自非色 token（`--fw-*` 是绝对值，不随字号/字族变）。
  expect(after.headingFontFamily).toBe(after.contentFontFamily);
  expect(after.headingFontWeight).toBe(before.headingFontWeight);
  expect(after.headingFontWeight).toBe("650");
  // shell（左栏文件树 / modeline）逐项不变——「配置只影响编辑器」由 token 分层保证
  expect(after.fileTreeRowFontSize).toBe(before.fileTreeRowFontSize);
  expect(after.fileTreeRowFontFamily).toBe(before.fileTreeRowFontFamily);
  expect(after.modelineFontFamily).toBe(before.modelineFontFamily);
  expect(after.rootInlineTokens.family).toBe(`"LXGW WenKai", ${BODY_STACK_RAW}`);
  expect(after.rootInlineTokens.mono).toBe(`"JetBrains Mono", ${MONO_BASELINE}`);

  // 非默认口径的**新增**基线（只增不改，待 Alex 过目后才生效；D6）
  await expectScreenshot(customPage, "typography-custom-font-20px.png");
  const bigPage = await context.newPage();
  await open(bigPage, { config: { font_size: 24 } });
  await expectScreenshot(bigPage, "typography-font-size-24.png");
});

test("像素对比仪器自证：同配置的两个页面必须给出同一个内容哈希", async ({ page, context }) => {
  // REVIEW.md 第 1 条：先证明仪器有区分度——「非法值 / 未安装字体与缺省配置逐像素相同」这两条
  // 判据全靠这个哈希；若哈希本身受焦点、时序等因素影响，那两条就变成恒真（或恒假）。
  await open(page);
  const twin = await context.newPage();
  await open(twin);
  expect(await contentPixelHash(page)).toBe(await contentPixelHash(twin));
  // 反向：字号一变，哈希必须不同（哈希真的在看内容，不是在看两张空白图）
  const changed = await context.newPage();
  await open(changed, { config: { font_size: 20 } });
  expect(await contentPixelHash(changed)).not.toBe(await contentPixelHash(page));
});

test("非法字体值退化为基线：warning 一条 + 观感与缺省配置逐像素相同", async ({ page, context }) => {
  await open(page);
  const baselineHash = await contentPixelHash(page);
  const badPage = await context.newPage();
  await open(badPage, { config: { font_family: "12px" } });
  // 计算属性回到基线
  const bad = await readings(badPage);
  expect(bad.contentFontFamily).toBe(BODY_BASELINE);
  // 非法值 MUST NOT 写进 token（写了就会在 computed-value 阶段失效、回落到浏览器默认字体）
  expect(bad.rootInlineTokens.family).toBe("");
  // warning 如实记录（装配层经 log_event 落诊断日志，与 [keys] 覆盖同一出口）
  const warnings = await badPage.evaluate(() => {
    const events = (window as never as { __logEvents: Array<{ event: string; fields: Record<string, string> }> }).__logEvents ?? [];
    return events.filter((entry) => entry.event === "config_warning").map((entry) => entry.fields.message ?? "");
  });
  expect(warnings.some((message) => message.includes("font_family") && message.includes("12px"))).toBe(true);
  // 逐像素相同（同一浏览器、同一文档、同一时刻的口径对比——不经容差）
  expect(await contentPixelHash(badPage)).toBe(baselineHash);
});

test("语法合法但未安装的字族：按基线后备栈呈现，观感与缺省配置逐像素相同", async ({ page, context }) => {
  await open(page);
  const baselineHash = await contentPixelHash(page);
  const missingPage = await context.newPage();
  await open(missingPage, { config: { font_family: '"NoSuchFontFamilyXyz"' } });
  const missing = await readings(missingPage);
  // 计算属性里能读到用户值在前、基线栈在后（这就是「退化」的机制）。注意 Chromium 会把
  // 只能是标识符的字族名去掉引号（`"NoSuchFontFamilyXyz"` → `NoSuchFontFamilyXyz`），
  // 所以这条断言用归一后的形态；带空格的名字（下面那条自定义字体用例）仍保留引号。
  expect(missing.contentFontFamily).toBe(`NoSuchFontFamilyXyz, ${BODY_BASELINE}`);
  expect(await contentPixelHash(missingPage)).toBe(baselineHash);
});

// ---------------------------------------------------------------------------
// 字号步进：三条命令、档位、上下限、重置、不落盘
// ---------------------------------------------------------------------------

test("⌘= / ⌘− / ⌘0 逐档变化，且不写文档、不碰 dirty、不新增写类 invoke", async ({ page }) => {
  await open(page);
  expect(await contentFontSize(page)).toBe(BASE_FONT_SIZE);
  await page.locator(".cm-content").click();
  const before = await invokeLog(page);
  const dirtyBefore = await page.evaluate(() => [...((window as never as { __dirtyReports: boolean[] }).__dirtyReports ?? [])]);

  await page.keyboard.press("Meta+Equal");
  expect(await contentFontSize(page)).toBe(17);
  await page.keyboard.press("Meta+Equal");
  expect(await contentFontSize(page)).toBe(19);
  await page.keyboard.press("Meta+Equal");
  expect(await contentFontSize(page)).toBe(21);
  await page.keyboard.press("Meta+Minus");
  expect(await contentFontSize(page)).toBe(19);
  await page.keyboard.press("Meta+Digit0");
  expect(await contentFontSize(page)).toBe(BASE_FONT_SIZE);

  expect(await readDocument(page)).toContain("delta four");
  const added = (await invokeLog(page)).slice(before.length);
  expect(
    added.filter((cmd) => /document_save|document_set_dirty|config|_put$|recovery_backup/.test(cmd)),
    `字号步进 MUST NOT 触发写类通道（实际新增：${added.join(", ")}）`,
  ).toEqual([]);
  expect(await page.evaluate(() => [...((window as never as { __dirtyReports: boolean[] }).__dirtyReports ?? [])])).toEqual(dirtyBefore);
});

test("上下限：到界后继续按无变化、无提示、不报错", async ({ page }) => {
  await open(page);
  await page.locator(".cm-content").click();
  for (let i = 0; i < 12; i++) await page.keyboard.press("Meta+Equal");
  expect(await contentFontSize(page)).toBe(32);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Meta+Equal");
  expect(await contentFontSize(page)).toBe(32);
  for (let i = 0; i < 20; i++) await page.keyboard.press("Meta+Minus");
  expect(await contentFontSize(page)).toBe(12);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Meta+Minus");
  expect(await contentFontSize(page)).toBe(12);
  // 到界不写日志噪音（唯一允许的是配置面 warning，这里连一条都不该有）
  expect(
    await page.evaluate(() =>
      ((window as never as { __logEvents: Array<{ event: string }> }).__logEvents ?? []).filter(
        (entry) => entry.event === "config_warning",
      ).length,
    ),
  ).toBe(0);
  await page.keyboard.press("Meta+Digit0");
  expect(await contentFontSize(page)).toBe(BASE_FONT_SIZE);
});

test("⌘0 回到**配置值**（不是出厂 15px）", async ({ page }) => {
  await open(page, { config: { font_size: 18 } });
  expect(await contentFontSize(page)).toBe(18);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+Equal");
  expect(await contentFontSize(page)).toBe(20);
  await page.keyboard.press("Meta+Equal");
  expect(await contentFontSize(page)).toBe(22);
  await page.keyboard.press("Meta+Digit0");
  expect(await contentFontSize(page)).toBe(18);
});

test("焦点在左栏文件树上：⌘= 同样命中（作用域 global）", async ({ page }) => {
  await open(page);
  // 焦点真的离开了编辑器（判据与分发器自己的 editor 作用域判定同源：事件目标在不在
  // contentDOM 内）——否则这条判据退化成了「编辑器内的键」那条。
  await page.locator(".pane-filetree").click({ position: { x: 4, y: 4 } });
  expect(
    await page.evaluate(() => document.querySelector(".cm-content")!.contains(document.activeElement)),
    "点击左栏空白后焦点不应在编辑器内容区",
  ).toBe(false);
  await page.keyboard.press("Meta+Equal");
  expect(await contentFontSize(page)).toBe(17);
  await page.keyboard.press("Meta+Digit0");
  expect(await contentFontSize(page)).toBe(BASE_FONT_SIZE);
});

test("键位通路唯一：窗口级 keydown 监听只有统一键位表这一条", async ({ page }) => {
  await countWindowKeydownListeners(page);
  await open(page);
  const listeners = await page.evaluate(() => [...((window as never as { __windowKeydownListeners: string[] }).__windowKeydownListeners ?? [])]);
  // Tauri 的 webview 缩放热键（zoom_hotkeys_enabled）正是 window 级 keydown 监听：启用它，
  // 这里立刻变成 2（同一物理键两条分发路径）。统一键位表只有一处 attach（src/main.ts）。
  expect(listeners.length, `窗口级 keydown 监听：${listeners.join(", ")}`).toBe(1);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+Equal");
  expect(await contentFontSize(page), "唯一那条监听就是统一键位表（⌘= 命中放大一档）").toBe(17);
});

// ---------------------------------------------------------------------------
// 重测量：坐标、行高、标记宽度、光标可见性
// ---------------------------------------------------------------------------

test("改字号后：行高与字号一致、点中该行落点正确、标记宽度按新字号重测", async ({ page }) => {
  await watchCanvasFont(page);
  await open(page);
  const before = await readings(page);
  const canvasBefore = await lastCanvasFont(page);
  // 光标落在目标行上（同一行内的坐标在字号变化前后可直接比对）
  await page.evaluate(() => {
    const line = [...document.querySelectorAll(".cm-line")].find((el) => (el.textContent ?? "").includes("foxtrot six"))!;
    const rect = line.getBoundingClientRect();
    const base = { clientX: rect.left + 24, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true, view: window, detail: 1 };
    line.dispatchEvent(new MouseEvent("mousedown", { ...base, button: 0, buttons: 1 }));
    window.dispatchEvent(new MouseEvent("mouseup", { ...base, button: 0, buttons: 0 }));
  });
  const caretBefore = await caretGeometry(page, "foxtrot six");
  expect(caretBefore.headText).toContain("foxtrot six");
  for (let i = 0; i < 8; i++) await page.keyboard.press("Meta+Equal"); // 15 → 31 → 触顶 32
  await page.waitForTimeout(60);
  const after = await readings(page);
  expect(after.contentFontSize).toBe("32px");
  // 行高 = 字号 × 1.7 + 2px 列表项间距（项间距是常量，不随字号缩放，见 :260 的注释）
  expect(after.singleLineHeight).toBeCloseTo(32 * BASE_LINE_HEIGHT_RATIO + 2, 1);
  expect((after.singleLineHeight - 2) / (before.singleLineHeight - 2)).toBeCloseTo(32 / BASE_FONT_SIZE, 2);
  // 列表标记宽度按新字号重测：它由 canvas 量出的「0」宽 × 组宽算出，字号按比例放大即等比放大。
  // 这条读数在**没有重测**时会停在旧值（比值 1.0）——判据有区分度。
  expect(after.listMarkerWidth / before.listMarkerWidth).toBeCloseTo(32 / BASE_FONT_SIZE, 1);
  // 测量与渲染同源（非默认字号同样成立）：canvas 侧钉 token 原文串（归一形态由 :272 场景钉）
  const canvasAfter = await lastCanvasFont(page);
  expect(canvasAfter).not.toBe(canvasBefore);
  expect(canvasAfter!.slice(canvasAfter!.indexOf("px ") + 3)).toBe(BODY_STACK_RAW);

  // 点中某一行的可视中心 → 光标必须落在那一行（CM 的 heightmap 陈旧时会落到别的行）
  const landed = await page.evaluate(() => {
    const line = [...document.querySelectorAll(".cm-line")].find((el) => (el.textContent ?? "").includes("foxtrot six"))!;
    const rect = line.getBoundingClientRect();
    const x = rect.left + 24;
    const y = rect.top + rect.height / 2;
    const base = { clientX: x, clientY: y, bubbles: true, cancelable: true, view: window, detail: 1 };
    line.dispatchEvent(new MouseEvent("mousedown", { ...base, button: 0, buttons: 1 }));
    window.dispatchEvent(new MouseEvent("mouseup", { ...base, button: 0, buttons: 0 }));
    const selection = window.getSelection()!;
    const node = selection.anchorNode;
    const el = node instanceof Element ? node : (node?.parentElement ?? null);
    return { landedText: (el?.closest(".cm-line")?.textContent ?? "").slice(0, 24), y: Math.round(y) };
  });
  expect(landed.landedText, `点 y=${landed.y} 应落在 foxtrot 那行`).toContain("foxtrot six");

  // spec 的判据原文：`coordsAtPos` 给出的光标位置与 DOM 几何一致（不出现错位）
  const caret = await caretGeometry(page, "foxtrot six");
  expect(caret.headText).toContain("foxtrot six");
  expect(caret.coords, "coordsAtPos 应给出坐标").not.toBeNull();
  // 光标落在**它自己那一行**的行盒里（列表标记 widget 让行盒高于文本行，故判包含关系而不是
  // 「等于行盒高度」；CM 的 coordsAtPos 给的是文本行盒，属实测读数）
  expect(caret.coords!.top).toBeGreaterThanOrEqual(caret.lineTop! - 1);
  expect(caret.coords!.bottom).toBeLessThanOrEqual(caret.lineBottom! + 1);
  // 与 DOM 选区矩形一致（原生 caret 的几何是浏览器给的，CM 的坐标是它自己算的）。
  // 折叠选区的 getBoundingClientRect 在 Chromium 上返回零高度（读不到 ≠ 为空），那种情况下
  // 退回上一条包含关系判据，并另用「坐标高度随字号等比」钉住几何确实跟着字号走。
  if (caret.domRect) {
    expect(caret.coords!.top).toBeCloseTo(caret.domRect.top, 1);
    expect(caret.coords!.bottom).toBeCloseTo(caret.domRect.bottom, 1);
  } else {
    const caretHeight = caret.coords!.bottom - caret.coords!.top;
    expect(caretHeight).toBeGreaterThan(0);
    expect(
      caretHeight / (caretBefore.coords!.bottom - caretBefore.coords!.top),
    ).toBeCloseTo(32 / BASE_FONT_SIZE, 1);
  }
});

test("改字号后光标仍在视口内（长文档 + 光标在视口下部）", async ({ page }) => {
  const long = Array.from({ length: 120 }, (_, i) => `- line ${String(i + 1).padStart(3, "0")} filler`).join("\n");
  await open(page, { text: `# 长文档\n\n${long}\n` });
  // 光标落在**可视区里最靠下**的那一行——字号变大把内容向下推时，这一行最先被挤出视口。
  // 用合成 mousedown 落光标（与真实点击同一条 posAtCoords 路径），落点由 view 的状态回读确认：
  // 判据不能建立在「我以为光标在哪」上。
  const placed = await page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller")!.getBoundingClientRect();
    const lines = [...document.querySelectorAll(".cm-line")].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.top >= scroller.top && box.bottom <= scroller.bottom;
    });
    const picked = lines[lines.length - 1];
    const rect = picked.getBoundingClientRect();
    const base = { clientX: rect.left + 24, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true, view: window, detail: 1 };
    picked.dispatchEvent(new MouseEvent("mousedown", { ...base, button: 0, buttons: 1 }));
    window.dispatchEvent(new MouseEvent("mouseup", { ...base, button: 0, buttons: 0 }));
    return (picked.textContent ?? "").trim();
  });
  expect(placed).toMatch(/line \d{3}/);

  const caretState = () =>
    page.evaluate(() => {
      const content = document.querySelector(".cm-content") as HTMLElement & {
        cmTile?: { root: { view: { state: { selection: { main: { head: number } }; doc: { lineAt: (pos: number) => { text: string } } }; coordsAtPos: (pos: number) => { top: number; bottom: number } | null } } };
      };
      const view = content.cmTile!.root.view;
      const head = view.state.selection.main.head;
      const coords = view.coordsAtPos(head);
      const box = document.querySelector(".cm-scroller")!.getBoundingClientRect();
      const scrollTop = (document.querySelector(".cm-scroller") as HTMLElement).scrollTop;
      return {
        headText: view.state.doc.lineAt(head).text,
        coords,
        scrollTop,
        // 「在视口内」= 光标盒与编辑区可视区有交叠
        visible: coords !== null && Math.min(coords.bottom, box.bottom) > Math.max(coords.top, box.top),
      };
    });

  const before = await caretState();
  // placed 是行的 textContent（含渲染态列表标记 glyph，C3 起 ul L1 = `–`）；
  // headText 是源码行——比对前剥掉 glyph。
  expect(before.headText, "光标应落在刚点的那一行").toContain(placed.replace(/^[–•◦]/, "").trim());
  expect(before.visible, "初始：光标在视口内").toBe(true);
  const scrollBefore = before.scrollTop;

  for (let i = 0; i < 5; i++) await page.keyboard.press("Meta+Equal"); // 15 → 25（每行高 ×1.67）
  await page.waitForTimeout(120);
  expect(await contentFontSize(page)).toBe(25);
  const after = await caretState();
  expect(after.headText, "光标 MUST NOT 被挪到别处（例如篇首）").toBe(before.headText);
  expect(
    after.visible,
    `字号 15→25 后光标应仍在视口内（读数：${JSON.stringify(after)}，改动前 scrollTop=${scrollBefore}）`,
  ).toBe(true);
});


// ---------------------------------------------------------------------------
// 标题六级阶梯（M228，change heading-hierarchy-ramp，稿 A 落槌值）
// ---------------------------------------------------------------------------

/** 阶梯文档：每级标题前都有正文行（首块标题上距为 0 的特判不触发，块距阶梯全档位可读）。 */
const HEADINGS_DOC = [
  "lead paragraph",
  "",
  "# H1 标题",
  "",
  "middle one",
  "",
  "## H2 标题",
  "",
  "middle two",
  "",
  "### H3 标题",
  "",
  "middle three",
  "",
  "#### H4 标题",
  "",
  "middle four",
  "",
  "##### H5 标题",
  "",
  "middle five",
  "",
  "###### H6 标题",
  "",
  "tail",
  "",
  "- alpha one",
  "- bravo two",
  "",
].join("\n");

/** 落槌阶梯（稿 A，2026-09-25）：字号 px / 字距 em / 块距 top/bottom px。字重全级 650、
 *  h1–h3 行高 --lh-reading（1.7）、h4–h6 行高 --lh-ui（1.5，本裁决不含行高）。 */
const RAMP = [
  { level: 1, size: 21, tracking: -0.009, top: 24, bottom: 9, lineHeightRatio: 1.7 },
  { level: 2, size: 18, tracking: -0.007, top: 20, bottom: 6, lineHeightRatio: 1.7 },
  { level: 3, size: 16, tracking: -0.005, top: 16, bottom: 5, lineHeightRatio: 1.7 },
  { level: 4, size: 15, tracking: -0.004, top: 14, bottom: 5, lineHeightRatio: 1.5 },
  { level: 5, size: 14, tracking: -0.002, top: 12, bottom: 4, lineHeightRatio: 1.5 },
  { level: 6, size: 13, tracking: 0, top: 10, bottom: 4, lineHeightRatio: 1.5 },
] as const;

test("标题六级阶梯：字号 / 字重 / 字距 / 行高 / 块距逐档读数（稿 A）", async ({ page }) => {
  await open(page, { text: HEADINGS_DOC });
  // 阶梯 token 逐字钉住（19 / 16.5 退场——负向判据由精确值承担：写回旧值这里立刻红）
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return [1, 2, 3, 4, 5, 6].map((n) => cs.getPropertyValue(`--fs-h${n}`).trim());
  });
  expect(tokens).toEqual(["21px", "18px", "16px", "15px", "14px", "13px"]);

  const bodyColor = await page.evaluate(() => getComputedStyle(document.querySelector(".cm-content")!).color);
  for (const row of RAMP) {
    const reading = await page.evaluate((level) => {
      const el = document.querySelector(`.cm-lp-h${level}`)!;
      const cs = getComputedStyle(el);
      return {
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        letterSpacing: cs.letterSpacing,
        lineHeight: cs.lineHeight,
        fontStyle: cs.fontStyle,
        color: cs.color,
        paddingTop: (el as HTMLElement).style.paddingTop,
        paddingBottom: (el as HTMLElement).style.paddingBottom,
      };
    }, row.level);
    // 字号经 token 取值（calc(1em * var(--fs-hN) / var(--editor-font-size))，出厂锚 15px）
    expect(parseFloat(reading.fontSize), `h${row.level} 字号`).toBeCloseTo(row.size, 1);
    expect(reading.fontWeight, `h${row.level} 字重`).toBe("650");
    // 字距 em 随本级字号换算成 px；h6 不写规则 → 计算值是 normal（与「0」等价，UA 归一形态）
    if (row.tracking === 0) expect(["normal", "0px"], `h${row.level} 字距`).toContain(reading.letterSpacing);
    else expect(parseFloat(reading.letterSpacing), `h${row.level} 字距`).toBeCloseTo(row.size * row.tracking, 1);
    expect(parseFloat(reading.lineHeight), `h${row.level} 行高`).toBeCloseTo(row.size * row.lineHeightRatio, 1);
    // 块距（livePreview 的 line decoration 内联样式；标题前均有正文行，上距非 0）
    expect(reading.paddingTop, `h${row.level} 上距`).toBe(`${row.top}px`);
    expect(reading.paddingBottom, `h${row.level} 下距`).toBe(`${row.bottom}px`);
    // 零装饰（稿 A）：h6 的 italic 与弱化色退场，全级 upright + 正文色
    expect(reading.fontStyle, `h${row.level} 无 italic`).toBe("normal");
    expect(reading.color, `h${row.level} 不取弱化色`).toBe(bodyColor);
  }
});
