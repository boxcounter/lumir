import { expect, test } from "@playwright/test";
import { DEMO_VAULT, dirtyReports, stubTauri } from "./tauri-stub";

// M130 非 md 文件保存死态：回归证据。
//
// 修复前的链路：扩展名不在 editor.ts CODE_EXTENSIONS 的文本文件（.txt/.php/.svelte/
// .hpp/... 以及一切未知扩展）在 modeForPath 里回落配置默认（出厂 md）→ 打开成
// **可编辑 md**：可改、可 dirty、套着 live preview，却没有磁盘 revision（main.ts
// 只为 md 登记）→ save-controller 两个保存入口在 dirty 时静默 return false，Cmd+S
// 无任何反馈；而 dirty 又锁死切换文件 / 切换 vault（guard）与退出（后端 ExitRequested
// 守卫），用户被困在「提示让他按 Cmd+S，而 Cmd+S 无效」的死态。
//
// 修复后（方向 A + tower 评审裁决）：一切非 md 文件——含未知扩展、dotfile 与
// basename 无点的 LICENSE/Makefile——一律只读 code 模式，dirty 不可能产生；
// 配置 `editor.mode` 只对没有文件上下文（空态 / 新建）的文档有意义。
// 不可保存态仍留一条兜底（下述第 3 个场景）：没有打开文件时的 dirty 文档
// Cmd+S 必须有可见反馈，切换守卫也不得建议走不通的「请先保存」。

/** 默认 light 主题的语义 token 色（与 m120-code-highlight.spec.ts 同口径：--tk-k）。 */
const LIGHT = { keyword: "rgb(58, 95, 205)" };

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
 *  svelte 与 cc/scss）、dotfile、无扩展名文件（LICENSE/Makefile）与 md 对照。 */
const FILES: Record<string, string> = {
  "readme.md": "# 真 Markdown\n\n正文段落。\n",
  "notes.txt": "# 不是标题\n\n纯文本原文。\n",
  "app.log": "2026-09-13 10:00:00 INFO started\n",
  "data.csv": "name,count\nlumir,3\n",
  "mystery.xyz": "unknown extension payload\n",
  ".secret": "dotfile 也按非 md 只读处理\n",
  "page.php": "<?php echo 1; ?>\n",
  "widget.svelte": "<script>let n = 1;</script>\n",
  "engine.hpp": "class Engine { public: int limit = 7; };\n",
  "run.bash": "if [ -f \"$1\" ]; then\n  echo ok\nfi\n",
  "env.zsh": "if [ -z \"$HOME\" ]; then\n  echo empty\nfi\n",
  "paint.cc": "class Painter { public: int width = 2; };\n",
  "theme.scss": "$ink: #333;\n.body { color: $ink; }\n",
  LICENSE: "MIT License\n\nPermission is hereby granted.\n",
  Makefile: "all:\n\t@echo lumir\n",
};

const VAULT = {
  entries: Object.keys(FILES).map((path) => ({ path, kind: "file", size: 0, mtime_ms: 0 })),
  files: FILES,
};

/** 除 Markdown 外的全部文件：一律只读 code（M130 前它们都是可编辑 md）。 */
const READ_ONLY = Object.keys(FILES).filter((path) => path !== "readme.md");

test("非 md 文本文件打开即只读 code 模式：不可编辑、不产生 dirty", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  const content = page.locator(".cm-content");

  for (const path of READ_ONLY) {
    await page.locator(`.ft-row[title="${path}"]`).click();
    // 打开的是原文（不是 fs 错误提示）：code 模式不做 md 装饰，标记符照原样可见
    await expect(content).toContainText(FILES[path].split("\n")[0]);
    // 只读合同（M97/M101 口径）与 code 模式特征（行号 gutter；md 模式没有）
    await expect(content).toHaveAttribute("contenteditable", "false");
    await expect(content).toHaveAttribute("aria-readonly", "true");
    await expect(page.locator(".cm-gutters")).toHaveCount(1);
    // 键盘输入被视图层拒收
    await content.click();
    await page.keyboard.type("HACKED");
    await expect(content).not.toContainText("HACKED");
  }

  // 修复前这里会出现 true：非 md 打开成可编辑 md，输入即 dirty（随后保存静默失败）
  expect(await dirtyReports(page)).not.toContain(true);

  // 对照：方向 A 只收紧非 md，md 文件照旧可编辑（保存链路不受影响）
  await page.locator('.ft-row[title="readme.md"]').click();
  await expect(content).toContainText("真 Markdown");
  await expect(content).toHaveAttribute("contenteditable", "true");
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
  // 按兜底纯文本只读，不用近似 parser 冒充高亮
  await page.locator('.ft-row[title="page.php"]').click();
  await expect(content).toContainText("<?php");
  await expect.poll(() => tokenColor(page, "echo")).toBe(null);
});

test("没有打开文件时 Cmd+S 必须给出可见反馈（不得静默 return）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  // 装载 vault 但一个标签都没有 = M163 的空 vault 首入态：D107 的引导层盖住正文
  //（`.editor-notice` 拦截指针事件，编辑器点不进去）。这条断言把新状态钉住。
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

test("无扩展名文件（LICENSE/Makefile）也一律只读 code：配置默认对文件打开不再生效", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  const content = page.locator(".cm-content");

  // basename 无点 → 扩展名解析为空串，但「非 md」的判定不依赖有无扩展名：
  // D4「非 md 即只读」优先于「无类型线索回落配置默认」的字面（tower 裁决 M130 评审）。
  for (const path of ["LICENSE", "Makefile"]) {
    await page.locator(`.ft-row[title="${path}"]`).click();
    await expect(content).toContainText(FILES[path].split("\n")[0]);
    await expect(content).toHaveAttribute("contenteditable", "false");
    await expect(content).toHaveAttribute("aria-readonly", "true");
    await expect(page.locator(".cm-gutters")).toHaveCount(1);
    await content.click();
    await page.keyboard.type("HACKED");
    await expect(content).not.toContainText("HACKED");
  }
  expect(await dirtyReports(page)).not.toContain(true);
});

test("demo vault 的既有非 md 条目也可只读打开（stub 最小内容能力）", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="docs"]').click();
  await page.locator('.ft-row[title="docs/notes.txt"]').click();

  const content = page.locator(".cm-content");
  await expect(content).toContainText("纯文本原文");
  await expect(content).toHaveAttribute("contenteditable", "false");
  expect(await dirtyReports(page)).not.toContain(true);
});
