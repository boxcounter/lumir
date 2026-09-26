import { expect, test } from "@playwright/test";
import { DEMO_VAULT, dirtyReports, documentWrites, fileText, stubTauri } from "./tauri-stub";

// 非 md 文本文件的可编辑性：M130（只读堵漏）→ editable-non-md-files（裁决 D1/D2/D3）的翻转证据。
//
// **M130 的旧口径**：一切非 md 文件——含未知扩展、dotfile 与 basename 无点的
// LICENSE/Makefile——一律**只读** code 模式，dirty 不可能产生（当时的理由是「没有磁盘
// revision 可保存 → 死态」）。
//
// **本 change 的新口径**（注册表全量文本类可编辑）：md / code / text 三族以**可编辑** code
// 模式打开（纯文本 + 既有语法高亮，无 live preview 装饰层），撤销 / dirty / Cmd+S / 自动保存
// / 冲突恢复与 md 走同一条链路（`saveDocument` + `saveBaseline` 的 editable 闸）。image / binary
// 类不进编辑器，维持「暂不支持预览」。
//
// **断言口径**（REVIEW.md 第 1/2 条）：每条正向断言都配一次**必须让它 FAIL 的反向输入**——
// 打字前先断言标记文本不在文档里（旧口径下它永远不会出现），键入后断言**回读的文档文本**与
// **落盘字节**都含它；只断言 `contenteditable` 属性在场是不够的（属性在场而 dispatch 层吞键
// 正是「假可编辑」形态，M241 实现在 test-results/m241/ 有反向输入的实测记录）。
// 标签切换序列那一条（md → code → code → md）额外盯住 changeFilter 的投影同步：漏掉
// `syncProjection` 时切过去那一态会静默吞键，本场景必须红。

/** 默认 light 主题的语义 token 色（与 m120-code-highlight.spec.ts 同口径：--tk-k）。 */
const LIGHT = { keyword: "rgb(58, 95, 205)" };

/** 键入的探针文本：ASCII、无空格、不可能是原文子串。 */
const NEEDLE = "EDITM241";

/** 取 token 文本首个匹配 span 的计算颜色；未找到（未着色）返回 null。 */
async function tokenColor(page: import("@playwright/test").Page, token: string): Promise<string | null> {
  return page.evaluate((needle) => {
    for (const span of document.querySelectorAll<HTMLElement>(".cm-line span")) {
      if (span.textContent === needle) return getComputedStyle(span).color;
    }
    return null;
  }, token);
}

/** 覆盖矩阵：未知扩展（txt/log/csv/xyz）、原两套注册表的差集（hpp/bash/zsh/php/
 *  svelte 与 cc/scss）、dotfile、无扩展名文件（LICENSE/Makefile）与 md 对照。
 *  `logo.png` 是 image 类（分流证据），`bundle.zip` 是 binary 类。 */
const FILES: Record<string, string> = {
  "readme.md": "# 真 Markdown\n\n正文段落。\n",
  "notes.txt": "# 不是标题\n\n纯文本原文。\n",
  "app.log": "2026-09-13 10:00:00 INFO started\n",
  "data.csv": "name,count\nlumir,3\n",
  "mystery.xyz": "unknown extension payload\n",
  ".secret": "dotfile 也按文本类打开\n",
  "page.php": "<?php echo 1; ?>\n",
  "widget.svelte": "<script>let n = 1;</script>\n",
  "engine.hpp": "class Engine { public: int limit = 7; };\n",
  "run.bash": "if [ -f \"$1\" ]; then\n  echo ok\nfi\n",
  "env.zsh": "if [ -z \"$HOME\" ]; then\n  echo empty\nfi\n",
  "paint.cc": "class Painter { public: int width = 2; };\n",
  "theme.scss": "$ink: #333;\n.body { color: $ink; }\n",
  LICENSE: "MIT License\n\nPermission is hereby granted.\n",
  Makefile: "all:\n\t@echo lumir\n",
  "logo.png": "",
  "bundle.zip": "",
};

const VAULT = {
  entries: Object.keys(FILES).map((path) => ({ path, kind: "file", size: 0, mtime_ms: 0 })),
  files: FILES,
};

/** image / binary 类：不进编辑器（文件树点击给「暂不支持预览」）。 */
const NON_EDITOR = ["logo.png", "bundle.zip"];

/** 注册表文本类：可编辑 code 模式打开（M130 前它们是「只读 code」，更早前是「可编辑 md」）。 */
const EDITABLE = Object.keys(FILES).filter((path) => path !== "readme.md" && !NON_EDITOR.includes(path));

test("非 md 文本文件一律以可编辑 code 模式打开（可编辑、无只读态、有行号）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  const content = page.locator(".cm-content");

  for (const path of EDITABLE) {
    await page.locator(`.ft-row[title="${path}"]`).click();
    // 打开的是原文（不是 fs 错误提示）：code 模式不做 md 装饰，标记符照原样可见
    await expect(content).toContainText(FILES[path].split("\n")[0]);
    // 可编辑合同（editable-non-md-files）：contenteditable 在场、无 aria-readonly 只读态
    await expect(content).toHaveAttribute("contenteditable", "true");
    await expect(content).toHaveAttribute("aria-readonly", "false");
    // code 模式特征（行号 gutter；md 模式没有）
    await expect(page.locator(".cm-gutters")).toHaveCount(1);
  }

  // 对照：md 文件照旧可编辑（保存链路不受本 change 影响）
  await page.locator('.ft-row[title="readme.md"]').click();
  await expect(content).toContainText("真 Markdown");
  await expect(content).toHaveAttribute("contenteditable", "true");
});

test("键入生效 / dirty / ⌘S 落盘（回读磁盘字节）/ 撤销回到原文后 dirty 收窄", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  const content = page.locator(".cm-content");

  // 三种形态各一：收录的代码扩展、未收录扩展、basename 无点
  for (const path of ["notes.txt", "data.csv", "LICENSE"]) {
    await page.locator(`.ft-row[title="${path}"]`).click();
    // 反向输入的前置断言：标记**不在**原文里（只读口径下它永远不会出现，同一断言会红）
    await expect(content).not.toContainText(NEEDLE);

    await content.click();
    await page.keyboard.type(NEEDLE);
    await expect(content).toContainText(NEEDLE); // 回读文档文本，不是只看属性
    expect(await dirtyReports(page)).toContain(true);

    // 撤销回原文：dirty 收窄（cleanDoc 比较口径，与 md 同一条链路）
    await page.keyboard.press("Meta+z");
    await expect(content).not.toContainText(NEEDLE);
    await expect.poll(async () => (await dirtyReports(page)).at(-1)).toBe(false);

    // 再键入一次并保存：真落盘（桩的 files 表 = 「磁盘」，回读比对字节）
    await content.click();
    await page.keyboard.type(NEEDLE);
    await page.keyboard.press("Meta+s");
    await expect.poll(async () => (await documentWrites(page)).some((w) => w.path === path)).toBe(true);
    const written = (await documentWrites(page)).filter((w) => w.path === path).at(-1)!;
    expect(written.content).toContain(NEEDLE);
    expect(await fileText(page, path)).toContain(NEEDLE);
  }
});

test("切标签序列（md → code → code → md）下投影与前台会话逐态一致：每一态都能键入", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  const content = page.locator(".cm-content");

  // 每次切换后键入一个**只属于这一态**的标记：投影（changeFilter 的 editable 判据）
  // 若漏同步，切过去那一态会静默吞键（REVIEW.md 第 1 条的「假可编辑」形态），本用例红。
  for (const [path, marker] of [
    ["readme.md", "MD1"],
    ["notes.txt", "TXT1"],
    ["data.csv", "CSV1"],
    ["readme.md", "MD2"],
  ] as const) {
    await page.locator(`.ft-row[title="${path}"]`).click();
    await expect(content).not.toContainText(marker);
    await content.click();
    await page.keyboard.type(marker);
    await expect(content).toContainText(marker);
  }

  // 切回 md 时它自己的会话内容仍在（切标签不重建文档）
  await page.locator('.ft-row[title="notes.txt"]').click();
  await expect(content).toContainText("TXT1");
});

test("无语言包（php）与未知扩展仍是纯文本可编辑：不着色但不吞键", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  const content = page.locator(".cm-content");

  await page.locator('.ft-row[title="page.php"]').click();
  await expect(content).toContainText("<?php");
  await expect.poll(() => tokenColor(page, "echo")).toBe(null); // 无近似 parser 冒充高亮
  await content.click();
  await page.keyboard.type(NEEDLE);
  await expect(content).toContainText(NEEDLE);

  await page.locator('.ft-row[title="mystery.xyz"]').click();
  await content.click();
  await page.keyboard.type(NEEDLE);
  await expect(content).toContainText(NEEDLE);
});

test("注册表差集的裁决落地：hpp/cc 走 C++、bash/zsh 走 shell、php 兜底不着色", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  const content = page.locator(".cm-content");

  // 原 tree.ts CODE_EXTS 独有项：hpp → cpp 语言包（clike cpp）
  await page.locator('.ft-row[title="engine.hpp"]').click();
  await expect(content).toContainText("class Engine");
  await expect.poll(() => tokenColor(page, "class")).toBe(LIGHT.keyword);

  // 原 editor.ts CODE_EXTENSIONS 独有项：cc → cpp 语言包
  await page.locator('.ft-row[title="paint.cc"]').click();
  await expect(content).toContainText("class Painter");
  await expect.poll(() => tokenColor(page, "class")).toBe(LIGHT.keyword);

  // tree.ts 独有项 bash/zsh → shell 语言包
  await page.locator('.ft-row[title="env.zsh"]').click();
  await expect(content).toContainText("echo empty");
  await expect.poll(() => tokenColor(page, "if")).toBe(LIGHT.keyword);

  // php 无对应 legacy mode（node_modules/@codemirror/legacy-modes/mode/ 无 php）：
  // 按兜底纯文本，不用近似 parser 冒充高亮（可编辑性不改变这条着色口径）
  await page.locator('.ft-row[title="page.php"]').click();
  await expect(content).toContainText("<?php");
  await expect.poll(() => tokenColor(page, "echo")).toBe(null);
});

test("image / binary 仍不进编辑器：点击给「暂不支持预览」，不产生会话与 dirty", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  // 装载 vault 但一个标签都没有 = M163 的空 vault 首入态：D107 的引导层盖住正文
  await expect(page.locator(".editor-notice")).toContainText("这个 vault 还没有打开的文件");

  for (const path of NON_EDITOR) {
    await page.locator(`.ft-row[title="${path}"]`).click();
    await expect(page.locator(".editor-notice")).toContainText(`暂不支持预览：${path}`);
    await expect(page.locator(".tab")).toHaveCount(0);
  }
  expect(await dirtyReports(page)).not.toContain(true);
  expect(await documentWrites(page)).toHaveLength(0);
});

test("没有打开文件时 Cmd+S 必须给出可见反馈（不得静默 return）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await expect(page.locator(".editor-notice")).toContainText("这个 vault 还没有打开的文件");
  await expect(page.locator(".modeline-path")).toHaveText("无当前文件");

  // M164 判据变更：未命名空文档不再由「装载后直接可得」到达，改走「打开一个文件再关掉它的
  // 标签」——`closeTabNow` 关掉最后一个标签时落在未命名空文档上并撤下覆盖层。本场景验的是
  // 未命名 dirty 文档上的 ⌘S 反馈与切换守卫，与「怎么到达它」无关。
  await page.locator('.ft-row[title="readme.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("readme.md");
  await page.keyboard.press("Meta+w");
  await expect(page.locator(".modeline-path")).toHaveText("无当前文件");
  await expect(page.locator(".tab")).toHaveCount(0);

  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.type("draft");
  await expect(content).toContainText("draft");
  await expect.poll(() => dirtyReports(page)).toContain(true);

  // dirty 会锁死切换与退出，保存入口的静默失败必须被可见反馈替代
  await page.keyboard.press("Meta+s");
  await expect(page.locator(".lumir-toast", { hasText: "无法保存" })).toBeVisible();

  // 切换文件的 dirty 守卫不得建议「请先保存（Cmd+S）」这条走不通的动作：
  // 无落盘基准时必须指向真正的出口（撤销修改），且不真的切走
  await page.locator('.ft-row[title="readme.md"]').click();
  const blocked = page.locator(".lumir-toast", { hasText: "无法切换文件" });
  await expect(blocked).toContainText("Cmd+Z");
  await expect(blocked).not.toContainText("请先保存");
  await expect(page.locator(".modeline-path")).toHaveText("无当前文件");
});

test("无扩展名文件（LICENSE/Makefile）与 dotfile 同属文本类：可编辑且能落盘", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  const content = page.locator(".cm-content");

  // basename 无点 → 扩展名解析为空串；「非 md」的模式裁决不依赖有无扩展名（M130 的语义保留），
  // editable-non-md-files 解除的只是只读。
  for (const path of ["LICENSE", "Makefile", ".secret"]) {
    await page.locator(`.ft-row[title="${path}"]`).click();
    await expect(content).toContainText(FILES[path].split("\n")[0]);
    await expect(content).toHaveAttribute("contenteditable", "true");
    await expect(content).toHaveAttribute("aria-readonly", "false");
    await content.click();
    await page.keyboard.type(NEEDLE);
    await expect(content).toContainText(NEEDLE);
  }
});

test("demo vault 的既有非 md 条目也可编辑打开（stub 最小内容能力）", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="docs"]').click();
  await page.locator('.ft-row[title="docs/notes.txt"]').click();

  const content = page.locator(".cm-content");
  await expect(content).toContainText("纯文本原文");
  await expect(content).toHaveAttribute("contenteditable", "true");
  await content.click();
  await page.keyboard.type(NEEDLE);
  await expect(content).toContainText(NEEDLE);
});
