import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M272（change enter-auto-indent）的**按键链路**：真 CM view + 真实 DOM KeyboardEvent
//（`page.keyboard.press("Enter")`）→ CM keymap（本项目那条 `Prec.highest`）→ 命令 → 文档。
//
// 本层与既有两层的分工（别重复也别留缺口）：
//   - `tests/unit/enter-indent.test.ts`：命令体本体的判定（委派上游 / 自动缩进 / 关配置不接管 /
//     只读会话），假 view + 真 EditorState。
//   - 本场景：**键位链路**——优先级是否真的让我们先跑、上游 `markdownKeymap` 是否真的在我们返回
//     false 时接手、`Shift-Enter` 是否真的不命中本绑定、`config.editor.auto_indent` 是否真的经
//     `src/main.ts` 的消费点到达编辑器。这四件事都不是命令体的性质，单测层看不到。
//   - `scripts/acceptance/scenarios/59-enter-auto-indent.md`：真机 WKWebView 上的同一链路 + 落盘。
//
// 判据一律落在 **CM 文档源码**（`readDocument`）——缩进是文档内容，不是渲染态。
// 本场景零像素断言（按 change 的 design §8）：静止态渲染零足迹，任何整页差异都按缺陷处理。

const JS = "const alpha = () => {";
const TOML = "[a]\n  [b]";
const FENCE = "```js\n  beta();\n```\n";
const BULLET = "- alpha\n- bravo\n";
const PARAGRAPH = "这一行是普通段落。\n";

/** 打开 fixture 里的某个文件（装载 vault → 点树行）。code 模式由扩展名裁决（`.js`）。 */
async function openFile(page: Page, name: string, doc: string, config: Record<string, unknown> = {}): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: name, kind: "file", size: doc.length, mtime_ms: 0 }],
    files: { [name]: doc },
    ...(Object.keys(config).length > 0 ? { config } : {}),
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${name}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(name);
}

/** 把光标放到 `needle` 之后并聚焦（editor 作用域的键位要求事件目标在 contentDOM 内）。 */
async function cursorAfter(page: Page, doc: string, needle: string): Promise<void> {
  const at = doc.indexOf(needle);
  expect(at, `fixture 里找不到 ${JSON.stringify(needle)}（判据会落空）`).toBeGreaterThanOrEqual(0);
  await page.locator(".cm-content").evaluate((el, pos) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: pos } });
    view.focus();
  }, at + needle.length);
  await expect
    .poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.className ?? ""))
    .toContain("cm-content");
}

test("code 模式：`.js` 的行尾按 Enter 得到语法缩进（两空格）", async ({ page }) => {
  await openFile(page, "code.js", JS);
  await cursorAfter(page, JS, "=> {");

  await page.keyboard.press("Enter");

  // 语法缩进由编辑器内核算法的缩进服务给出（legacy mode 的 indent 规则），本 change 不自写缩进表。
  await expect.poll(() => readDocument(page)).toBe(`${JS}\n  `);
});

test("code 模式：无缩进规则的语言沿用当前行行首空白（`.toml`）", async ({ page }) => {
  await openFile(page, "cfg.toml", TOML);
  await cursorAfter(page, TOML, "  [b]");

  await page.keyboard.press("Enter");

  await expect.poll(() => readDocument(page)).toBe(`[a]\n  [b]\n  `);
});

test("md 围栏代码块内：沿用块内该行的缩进，且不把围栏内容当列表续写", async ({ page }) => {
  await openFile(page, "fence.md", FENCE);
  await cursorAfter(page, FENCE, "  beta();");

  await page.keyboard.press("Enter");
  await expect.poll(() => readDocument(page)).toBe("```js\n  beta();\n  \n```\n");

  // 围栏内的 `- x` 是代码文本：上游在围栏里返回 false（`getContext` 遇 `FencedCode` 返回空），
  // 本层的自动缩进也不产生 `- `。
  const dash = "```\n- x\n```\n";
  await openFile(page, "dash.md", dash);
  await cursorAfter(page, dash, "- x");
  await page.keyboard.press("Enter");
  await expect.poll(() => readDocument(page)).toBe("```\n- x\n\n```\n");
});

test("md 列表续行不被本 change 打断（委派上游后逐字节不变）", async ({ page }) => {
  await openFile(page, "list.md", BULLET);
  await cursorAfter(page, BULLET, "alpha");

  await page.keyboard.press("Enter");

  // 上游 `markdownKeymap`（`Prec.high`）在我们返回 true 时不会跑，但它在**我们返回 false 时**
  // 必须照旧跑——本 change 的实现是「先委派它」，因此这条判据钉的是委派本身没被写坏。
  await expect.poll(() => readDocument(page)).toBe("- alpha\n- \n- bravo\n");
});

test("md 正文段落：平换行（MUST NOT 凭空加缩进）", async ({ page }) => {
  await openFile(page, "para.md", PARAGRAPH);
  await cursorAfter(page, PARAGRAPH, "普通段落。");

  await page.keyboard.press("Enter");

  await expect.poll(() => readDocument(page)).toBe(`${PARAGRAPH}\n`);
});

test("Shift-Enter 维持裸换行（Non-goal 的不对称：两键在 code 模式从此不同）", async ({ page }) => {
  await openFile(page, "shift.js", JS);
  await cursorAfter(page, JS, "=> {");

  await page.keyboard.press("Shift+Enter");

  // CM 的键位查表在按住 Shift 时只查 `Shift-Enter`（本绑定是 `Enter`，收不到）；按键落回
  // 浏览器默认 = 裸换行。这条同时是「不缩进的裸换行」逃生口的判据。
  await expect.poll(() => readDocument(page)).toBe(`${JS}\n`);
});

test("`editor.auto_indent = false`：经配置链回退到裸换行，md 列表续行不受影响", async ({ page }) => {
  // 6a：code 模式回退（配置走 `src/main.ts` 的真实消费点 → `editor.setAutoIndent`）
  await openFile(page, "off.js", JS, { auto_indent: false });
  await cursorAfter(page, JS, "=> {");
  await page.keyboard.press("Enter");
  await expect.poll(() => readDocument(page)).toBe(`${JS}\n`);

  // 6b：md 列表续行**不受本键影响**（D5a 的显式不对称：上游键位不读本配置）
  await openFile(page, "off-list.md", BULLET, { auto_indent: false });
  await cursorAfter(page, BULLET, "alpha");
  await page.keyboard.press("Enter");
  await expect.poll(() => readDocument(page)).toBe("- alpha\n- \n- bravo\n");
});

test("一次 Enter 是一次撤销步（MUST NOT 产生两步撤销）", async ({ page }) => {
  await openFile(page, "undo.js", JS);
  await cursorAfter(page, JS, "=> {");

  await page.keyboard.press("Enter");
  await expect.poll(() => readDocument(page)).toBe(`${JS}\n  `);

  await page.keyboard.press("Meta+z");

  await expect.poll(() => readDocument(page)).toBe(JS);
});
