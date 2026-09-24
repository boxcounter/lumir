import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";

// 三主题与主题选择（change restyle-ui-tokens-v1，tasks §1.2 / §2.4 / §7）：
// ① 「`data-theme="dark"` 下正文底色为 `#222326`」；② 「masthead 不存在」；
// ③ 「modeline 存在且含文件路径」——这三条是 tasks §1.2 写下的**实现前红灯**判据，
// 本场景是它们的转绿落点（红灯日志见 test-results/m211/red-before-implementation.log）。
//
// 主题通道走桩的 `config.theme`（→ `config_get` 的 `ui.theme` → 启动装配层写
// `documentElement.dataset.theme`，src/main.ts）。**不是**场景自己贴 `data-theme` 属性：
// 手贴属性只证明 CSS 有第三套取值，验不到「配置 → 施加」这条接线（§2.4 要的正是那条）。
//
// 三主题的**截图证据**取 `info.attach` 的产物（tests/visual/test-results/，git 外），
// 不新增像素基线：基线全量重建是 R4 的独立批次动作，本 change 实现期禁止零碎新增 / 更新
// （AGENTS.md 硬规则「基线更新是人肉裁决点」+ tasks §8.2）。

const DOC = "# 主题\n\n主题读数用的一段正文。\n";
const VAULT = {
  entries: [{ path: "doc.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "doc.md": DOC },
};

/** tokens 文档登记的三主题关键值（docs/specs/design-tokens-v1.md 的三主题对照表）。 */
const THEMES = {
  light: { frame: "#f4f4f1", contentBg: "#fdfdfc", text: "#21201a", accent: "#3a5fcd" },
  dark: { frame: "#1a1b1d", contentBg: "#222326", text: "#e3e2db", accent: "#8ba3ef" },
  eink: { frame: "#ffffff", contentBg: "#ffffff", text: "#000000", accent: "#000000" },
} as const;

function rgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff})`;
}

/** 打开文档并等主题施加完成（`dataset.theme` 与关键计算属性都到位）。 */
async function openWithTheme(page: Page, theme?: "light" | "dark" | "eink"): Promise<void> {
  await stubTauri(page, theme === undefined ? VAULT : { ...VAULT, config: { theme } });
  await page.goto("/");
  await page.locator('.ft-row[title="doc.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("doc.md");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme ?? "light");
}

/** 三主题共享的读数：token 的**计算值**（落到探针元素的 background 上读回）+ 关键表面的计算值。
 *
 *  为什么不用 `getPropertyValue` 的字面量：Chromium 会把颜色类自定义属性按其最短形式序列化
 *  （`#ffffff` 读回是 `#fff`、`#000000` 读回是 `#000`），拿文档里的字面量比会在「其实相等」时红。
 *  计算值是 `rgb(...)`，两侧同一口径。 */
async function readTheme(page: Page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const color = (name: string) => {
      probe.style.backgroundColor = `var(${name})`;
      return getComputedStyle(probe).backgroundColor;
    };
    const tokens = {
      frame: color("--frame"),
      contentBg: color("--content-bg"),
      text: color("--text"),
      accent: color("--accent"),
      sel: color("--sel"),
      codeBg: color("--code-bg"),
    };
    probe.remove();
    const surface = (selector: string) => {
      const el = document.querySelector(selector);
      return el ? getComputedStyle(el).backgroundColor : "(缺席)";
    };
    return {
      dataset: document.documentElement.dataset.theme ?? null,
      tokens,
      shadowPop: root.getPropertyValue("--shadow-pop").trim(),
      shadowRaise: root.getPropertyValue("--shadow-raise").trim(),
      editorBg: surface(".cm-editor"),
      editorColor: getComputedStyle(document.querySelector(".cm-editor")!).color,
      shellBg: surface(".app-shell"),
      modelineBg: surface(".modeline"),
      titlebarBg: surface(".titlebar"),
    };
  });
}

for (const theme of ["light", "dark", "eink"] as const) {
  test(`主题 ${theme}：配置驱动首帧，token 与关键表面的计算值逐项一致`, async ({ page }, info) => {
    await openWithTheme(page, theme);
    const now = await readTheme(page);
    const expected = THEMES[theme];

    // 施加通道的落点（配置 → dataset）：这就是「真实配置通道」的证据面
    expect(now.dataset).toBe(theme);
    // token 计算值 = tokens 文档登记值（文档字面量经 rgb() 归一后逐项对照）
    expect(now.tokens.frame).toBe(rgb(expected.frame));
    expect(now.tokens.contentBg).toBe(rgb(expected.contentBg));
    expect(now.tokens.text).toBe(rgb(expected.text));
    expect(now.tokens.accent).toBe(rgb(expected.accent));
    // 表面计算值追随 token（正文面 / 框体面各一条）
    expect(now.editorBg).toBe(rgb(expected.contentBg));
    expect(now.editorColor).toBe(rgb(expected.text));
    expect(now.shellBg).toBe(rgb(expected.frame));
    expect(now.modelineBg).toBe(rgb(expected.frame));
    expect(now.titlebarBg).toBe(rgb(expected.frame));
    // eink 是系统性降级档：阴影两档全退场（规则⑦）
    if (theme === "eink") {
      expect(now.shadowPop).toBe("none");
      expect(now.shadowRaise).toBe("none");
    }

    // 三主题的截图证据（artifact，不是像素基线；见文件头）
    await info.attach(`theme-${theme}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
}

test("未配置 ui.theme 时与 light 逐项一致（出厂默认 = light）", async ({ page, context }) => {
  await openWithTheme(page); // 不传 theme：桩给 ui.theme 的出厂值
  const fallback = await readTheme(page);
  const explicit = await context.newPage();
  await openWithTheme(explicit, "light");
  expect(await readTheme(explicit)).toEqual(fallback);
  expect(fallback.dataset).toBe("light");
});

test("判据①：dark 下正文底色为 #222326（tasks §1.2 的实现前红灯判据）", async ({ page }) => {
  await openWithTheme(page, "dark");
  const now = await readTheme(page);
  // 判据读的是**正文面**（`.cm-editor`）而不是 html 元素或 token 原文：主题是为了读文字
  expect(now.editorBg).toBe("rgb(34, 35, 38)");
  expect(now.tokens.contentBg).toBe("rgb(34, 35, 38)");
  expect(now.dataset).toBe("dark");
});

test("判据②③：masthead 不存在，modeline 存在且含文件路径（信息迁移落位）", async ({ page }) => {
  await openWithTheme(page);
  // ② 旧标题区整块不存在
  await expect(page.locator(".masthead")).toHaveCount(0);
  await expect(page.locator(".masthead-vault, .masthead-file, .masthead-section")).toHaveCount(0);
  // ③ 迁移后的三个承载点各自在场（vault 名 → 侧栏头 / 路径 → modeline / 行数语法编码 → modeline 右）
  await expect(page.locator(".ft-vault-name")).toHaveText("demo-vault");
  await expect(page.locator(".modeline-path")).toHaveText("doc.md");
  // 右段「语法 · 行数 · 编码」：行数派生自 doc.lines，不写死具体数字（写死会让本判据在
  // 文档改动时空转，且它守的是**派生接线**不是某个数字）
  await expect(page.locator(".modeline-meta")).toHaveText(/^Markdown · \d+ 行 · UTF-8$/);
  // modeline 在视口内（存在 ≠ 可见）
  await expect(page.locator(".modeline")).toBeVisible();
});

test("三主题共享同一套非色 token：字体阶梯 / 间距 / 圆角 / 动效逐项相同", async ({ page, context }) => {
  const read = async (theme: "light" | "dark" | "eink") => {
    const target = theme === "light" ? page : await context.newPage();
    await openWithTheme(target, theme);
    return target.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return [
        "--font-sans",
        "--font-mono",
        "--fs-body",
        "--fs-ui",
        "--lh-reading",
        "--lh-code",
        "--sp-8",
        "--r6",
        "--layout-sidebar-w",
        "--layout-titlebar-h",
        "--layout-modeline-h",
        "--layout-doc-measure",
        "--dur-hover",
        "--dur-ui",
      ].map((name) => `${name}=${root.getPropertyValue(name).trim()}`);
    });
  };
  const light = await read("light");
  expect(await read("dark")).toEqual(light);
  expect(await read("eink")).toEqual(light);
  // 非色 token 不是空串（否则上面三条会在「全是空字符串」上空转，REVIEW.md 第 2 条）
  expect(light.every((entry) => entry.split("=")[1] !== "")).toBe(true);
});
