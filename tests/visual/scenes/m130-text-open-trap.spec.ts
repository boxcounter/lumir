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
// 修复后（方向 A）：非 md 一律只读 code 模式，dirty 不可能产生；无扩展名文件
// （LICENSE）按 mission 明文仍回落配置默认，其不可保存由可见提示兜底（见本文件
// 后两个场景）。

/** 默认 light 主题的语义 token 色（与 m120-code-highlight.spec.ts 同口径）。 */
const LIGHT = { keyword: "rgb(178, 58, 44)" };

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
 *  svelte 与 cc/scss）、dotfile、无扩展名文件（LICENSE）与 md 对照。 */
const FILES: Record<string, string> = {
  "readme.md": "# 真 Markdown\n\n正文段落。\n",
  "notes.txt": "# 不是标题\n\n纯文本原文。\n",
  "app.log": "2026-09-13 10:00:00 INFO started\n",
  "data.csv": "name,count\nlumir,3\n",
  "mystery.xyz": "unknown extension payload\n",
  ".secret": "dotfile 也按有扩展名线索处理\n",
  "page.php": "<?php echo 1; ?>\n",
  "widget.svelte": "<script>let n = 1;</script>\n",
  "engine.hpp": "class Engine { public: int limit = 7; };\n",
  "run.bash": "if [ -f \"$1\" ]; then\n  echo ok\nfi\n",
  "env.zsh": "if [ -z \"$HOME\" ]; then\n  echo empty\nfi\n",
  "paint.cc": "class Painter { public: int width = 2; };\n",
  "theme.scss": "$ink: #333;\n.body { color: $ink; }\n",
  LICENSE: "MIT License\n\nPermission is hereby granted.\n",
};

const VAULT = {
  entries: Object.keys(FILES).map((path) => ({ path, kind: "file", size: 0, mtime_ms: 0 })),
  files: FILES,
};

/** 非 md 且「有扩展名线索」的文件：一律只读 code，M130 前全部是可编辑 md。 */
const READ_ONLY = Object.keys(FILES).filter((path) => path !== "readme.md" && path !== "LICENSE");

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
  // 装载 vault 但不打开文件：编辑器为空的默认模式文档（无 displayedPath）
  const content = page.locator(".cm-content");
  await expect(page.locator(".masthead-file")).toHaveText("无当前文件");

  await content.click();
  await page.keyboard.type("draft");
  await expect(content).toContainText("draft");
  await expect.poll(() => dirtyReports(page)).toContain(true);

  // dirty 会锁死切换与退出，保存入口的静默失败必须被可见反馈替代
  await page.keyboard.press("Meta+s");
  await expect(page.locator(".lumir-toast", { hasText: "无法保存" })).toBeVisible();
});

test("无扩展名文件回落配置默认：不可保存时 Cmd+S 给出可见反馈与脱困动作", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  const content = page.locator(".cm-content");
  await page.locator('.ft-row[title="LICENSE"]').click();
  await expect(content).toContainText("MIT License");

  // 无扩展名线索（basename 无点）→ 回落配置默认基线（defaultMode = md）。这是
  // mission 明文保留的边界（「ext 缺失/未知保持现状 fallback」），不是本次收紧的
  // 对象；它不可保存（kind !== "md" 故没有磁盘 revision），由下面的兜底覆盖。
  await expect(content).toHaveAttribute("contenteditable", "true");

  await content.click();
  await page.keyboard.type("edited");
  await expect(content).toContainText("edited");
  await expect(page.locator(".masthead-file")).toContainText("未保存");

  await page.keyboard.press("Meta+s");
  // 不得静默：说明该文件不支持保存，并给出脱离 dirty 的动作（Cmd+Z 撤销）
  const notice = page.locator(".lumir-toast", { hasText: "不支持保存" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Cmd+Z");
  // 内容没有被误标为已保存：仍留在 dirty
  await expect(page.locator(".masthead-file")).toContainText("未保存");

  // 切换文件的 dirty 守卫不得再建议「请先保存（Cmd+S）」这条走不通的动作：
  // 无落盘基准时必须指向真正的出口（撤销修改）
  await page.locator('.ft-row[title="readme.md"]').click();
  const blocked = page.locator(".lumir-toast", { hasText: "无法切换文件" });
  await expect(blocked).toContainText("Cmd+Z");
  await expect(blocked).not.toContainText("请先保存");
  await expect(page.locator(".masthead-file")).toContainText("LICENSE");
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
