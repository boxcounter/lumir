import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/markdown-combo/${name}`, import.meta.url), "utf8");

const combo = fixture("combo.md");
const longFrontmatter = fixture("frontmatter-200.md");
const image = fixture("sample.svg");
const images = fixture("images.md");

/** 图片附件 fixture：键是 vault 相对路径，值是文件内容（本层按 UTF-8 读文本，经 base64 回给前端）。 */
const imageAssets: Record<string, string> = {
  "assets/sample.svg": image,
  "assets/wide.svg": fixture("wide.svg"),
  "assets/zero-size.svg": fixture("zero-size.svg"),
  "assets/script.svg": fixture("script.svg"),
  "assets/external-ref.svg": fixture("external-ref.svg"),
  "assets/empty.png": fixture("empty.png"),
};

/** images.md 里九条图片引用的原文（widget 的 rawRef 即这一串，也是 img 的 alt）。 */
const REFS = {
  fixed: "![fixed svg](assets/sample.svg)",
  wide: "![wide svg](assets/wide.svg)",
  percent: "![percent svg](assets/zero-size.svg)",
  percentWiki: "![[zero-size.svg]]",
  empty: "![empty bitmap](assets/empty.png)",
  missing: "![missing bitmap](assets/missing.png)",
  remote: "![remote image](https://example.invalid/remote.png)",
  script: "![script svg](assets/script.svg)",
  externalRef: "![external ref svg](assets/external-ref.svg)",
} as const;

/**
 * `fs_read_attachment` 的桩：tauri-stub 的 invoke 路由里没有这个命令（缺省按 unknown_command
 * 抛错 → 图片一律走「读取失败」占位），本场景要验真实渲染，因此在 stub 之后包一层。
 * 必须在 `page.goto` 之前调用（addInitScript 按注册顺序执行，stubTauri 在前）。
 */
async function stubAttachmentReads(page: Page, files: Record<string, string>): Promise<void> {
  await page.addInitScript((map: Record<string, string>) => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = async (command: string, args: { path?: string }) => {
      if (command !== "fs_read_attachment") return original(command, args);
      const content = map[args.path ?? ""];
      if (content === undefined) throw { code: "fs_not_found", message: `文件不存在：${args.path}` };
      const bytes = new TextEncoder().encode(content);
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary);
    };
  }, files);
}

async function open(
  page: Parameters<typeof stubTauri>[0],
  text = combo,
  path = "combo.md",
  failures?: Record<string, { code: string; message: string }>,
  reads?: Record<string, string>,
) {
  await stubTauri(page, {
    entries: [path, "assets/sample.svg", "assets/missing.png", "assets/missing.svg", "assets/wide.svg", "assets/zero-size.svg", "assets/script.svg", "assets/external-ref.svg", "assets/empty.png"].map((entry) => ({ path: entry, kind: "file", size: text.length, mtime_ms: 0 })),
    files: { [path]: text, ...imageAssets },
    links: {
      "![[sample.svg]]": { status: "resolved", path: "assets/sample.svg", candidates: [], embed_target: "attachment", anchor: { status: "none", heading: null, line: null } },
      "![[missing.svg]]": { status: "unresolved", path: null, candidates: [], embed_target: null, anchor: { status: "none", heading: null, line: null } },
      "![[zero-size.svg]]": { status: "resolved", path: "assets/zero-size.svg", candidates: [], embed_target: "attachment", anchor: { status: "none", heading: null, line: null } },
    },
    failures,
  });
  // 顺序要紧：stubTauri 的 init script 先跑（它才挂出 __TAURI_INTERNALS__），我们的包装在后。
  if (reads) await stubAttachmentReads(page, reads);
  await page.goto("/");
  await page.locator(`.ft-row[title="${path}"]`).click();
}

/** 某条图片引用的替换区读数：布局盒（替换区可见尺寸）+ 引擎给出的自然尺寸。两个一起记—— */
/** 只记自然尺寸会把中招形态读成「加载正常」（实则布局盒 0×0，design §3.2）。 */
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

  // 九条引用全部落地到终态（加载中状态块已撤）再一次性读数。
  await expect(page.locator(".cm-lp-image")).toHaveCount(9);
  await expect(page.locator(".cm-lp-image-status")).toHaveCount(0);

  // 中招形状（`width="100%"` + 仅 viewBox）修复前的两个读数是「布局盒 0×0 / 自然尺寸 300×100」——
  // 只记自然尺寸会把它读成「加载正常」（design §3.2）。尺寸兜底按自然宽度显式设像素宽度后，
  // 布局盒回到 300×100（引擎给出的默认对象尺寸）。
  expect(await imageReadings(page, REFS.percent), "零尺寸 svg 的读数（布局盒 / 自然尺寸）").toEqual({ box: "300x100", natural: "300x100", complete: true });
  // 同一条处置覆盖 Obsidian 方言形态（三种引用形态共用终态，不为 svg 单立分支）。
  expect(await imageReadings(page, REFS.percentWiki), "方言形态的读数（与标准形态同处置）").toEqual({ box: "300x100", natural: "300x100", complete: true });

  // 正常图片零行为变化：读数与修复前逐值相同（固定尺寸 240×80；2000×600 按栏宽收窄）。
  expect(await imageReadings(page, REFS.fixed)).toEqual({ box: "240x80", natural: "240x80", complete: true });
  expect(await imageReadings(page, REFS.wide), "超宽图仍按既有 max-width 口径收窄").toEqual({ box: "829x249", natural: "2000x600", complete: true });

  // 不可见的三处各自落地可见占位，且占位文本含原始引用串（alt 与路径都在其中）。
  const chips = page.locator(".cm-lp-image-error");
  await expect(chips).toHaveCount(3);
  await expect(chips.filter({ hasText: REFS.empty })).toHaveText(`图片无法显示：${REFS.empty}`);
  await expect(chips.filter({ hasText: REFS.remote })).toHaveText(`图片无法显示：${REFS.remote}`);
  await expect(chips.filter({ hasText: REFS.missing })).toContainText(`图片读取失败：${REFS.missing}`);

  // 通用不变量：九条引用无一留下零高度空白（宽度或高度为 0 即判）。
  const areas = await replacementAreas(page);
  expect(areas).toHaveLength(9);
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
  await expect(page.locator(".cm-lp-image-error")).toHaveCount(3);

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
