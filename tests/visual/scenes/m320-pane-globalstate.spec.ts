import { expect, test, type Page } from "@playwright/test";
import { configGets, stubTauri, type VaultFixture } from "./tauri-stub";

// M320 tasks 7.4：跨实例全局态验证（只验证与登记，不改 src）。pane 化把 EditorView 从一例
// 变两例，src/preview/mermaid.ts 与 src/preview/lists.ts 里**进程级 / document 级**的全局态
// 随之第一次被两个实例共享——本 spec 在真实双 pane 页面里钉住它们的行为：
//
//   mermaid.ts（模块级单例：renderer / 串行 queue / 按源码键控的 renderCache / settle
//   监听器集合 / 主题世代号）：
//     1. 异文档两个 view 实例各自出图（串行队列不饿死任何一侧、内容不互相污染）；
//     2. 同内容源命中共享缓存也各自出图（「同文档两个 view」按同内容源验证——账本
//        不变量 2 决定同一路径不可能同时开在两个 pane，物理同文件双开不存在）；
//     3. 运行期主题切换后两个 pane 都按新主题重渲（invalidateMermaidTheme 清缓存 +
//        refreshPreview 广播到全部 pane + settle 桥逐 view 派发，缺任何一环后台 pane
//        就停在旧主题色）。
//
//   lists.ts（每个 view 一个 ListLayout 实例，但观察器挂在 document 级目标上：
//   documentElement 的 style/class MutationObserver + document.fonts 的 loadingdone）：
//     4. ⌘= 步进字号（typography 把 token 写进 documentElement.style）后，**两个** pane
//        的列表悬挂缩进都重测量变大——证明 document 级观察器在两个实例上各自生效，
//        不是只有活跃 pane 的那一个在工作。
//
// 全部结构断言、无像素基线（7.4 是行为登记，不是视觉表面）。

const MERMAID_LEFT = `# 左图

\`\`\`mermaid
graph TD
  A[甲起] --> B[乙终]
\`\`\`
`;
const MERMAID_RIGHT = `# 右图

\`\`\`mermaid
graph LR
  C[丙起] --> D[丁终]
\`\`\`
`;
const MERMAID_SAME_AS_LEFT = `# 与左图同源的副本

\`\`\`mermaid
graph TD
  A[甲起] --> B[乙终]
\`\`\`
`;
const LIST_LEFT = "# 左列表\n\n1. 左一\n2. 左二\n3. 左三\n";
const LIST_RIGHT = "# 右列表\n\n1. 右一\n2. 右二\n3. 右三\n";

function vault(files: Record<string, string>): VaultFixture {
  return {
    entries: Object.keys(files).map((path) => ({ path, kind: "file", size: files[path].length, mtime_ms: 0 })),
    files,
    links: {},
    config: { keys: { F2: "pane.split" } },
  };
}

/** 装载 vault、开好第一个文件并等配置就位（[keys] 覆盖生效后 F2 才能分栏）。 */
async function boot(page: Page, files: Record<string, string>, first: string): Promise<void> {
  await stubTauri(page, vault(files));
  await page.goto("/");
  await page.locator(`.ft-row[title="${first}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(first);
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await page.waitForTimeout(80);
}

/** 第 paneIndex 个 pane（0-based）里的 mermaid 渲染盒。 */
function mermaidBox(page: Page, paneIndex: number) {
  return page.locator(".editor-pane").nth(paneIndex).locator(".cm-lp-mermaid");
}

/** 等某 pane 的 mermaid 块 settle 成 SVG（懒加载 + 串行渲染，预算放宽到 20s）。 */
async function waitMermaidSvg(page: Page, paneIndex: number): Promise<void> {
  await expect(mermaidBox(page, paneIndex).locator("svg")).toBeVisible({ timeout: 20_000 });
}

test("mermaid：异文档两个 view 实例各自出图，内容互不污染", async ({ page }) => {
  const files = { "m1.md": MERMAID_LEFT, "m2.md": MERMAID_RIGHT };
  await boot(page, files, "m1.md");
  await waitMermaidSvg(page, 0);

  await page.keyboard.press("F2");
  await page.locator('.ft-row[title="m2.md"]').click();
  await expect(page.locator(".editor-pane").nth(1).locator(".cm-content")).toContainText("右图");

  // 两个 pane 都 settle（串行队列没有把后到的 pane 饿死）。
  await waitMermaidSvg(page, 0);
  await waitMermaidSvg(page, 1);
  // widget 的 title 是各自块的围栏原文：左含「乙终」、右含「丁终」——各自渲各自的源，
  // 不存在「后台 pane 渲染了活跃 pane 的图」这类交叉污染。
  await expect(mermaidBox(page, 0)).toHaveAttribute("title", /乙终/);
  await expect(mermaidBox(page, 1)).toHaveAttribute("title", /丁终/);
});

test("mermaid：同内容源两个 view 命中共享缓存，也各自出图", async ({ page }) => {
  const files = { "m1.md": MERMAID_LEFT, "m3.md": MERMAID_SAME_AS_LEFT };
  await boot(page, files, "m1.md");
  await waitMermaidSvg(page, 0);

  await page.keyboard.press("F2");
  await page.locator('.ft-row[title="m3.md"]').click();

  // 右 pane 的源与左 pane 逐字相同：缓存键命中（无需第二次渲染）也必须出图——
  // 命中路径不回退 pending、不缺装饰。
  await waitMermaidSvg(page, 1);
  await expect(mermaidBox(page, 1)).toHaveAttribute("title", /乙终/);
  // 左 pane 的装饰不被右 pane 的命中路径碰掉。
  await waitMermaidSvg(page, 0);
});

test("mermaid：运行期主题切换，两个 pane 都按新主题重渲（不留旧主题色）", async ({ page }) => {
  const files = { "m1.md": MERMAID_LEFT, "m2.md": MERMAID_RIGHT };
  await boot(page, files, "m1.md");
  await page.keyboard.press("F2");
  await page.locator('.ft-row[title="m2.md"]').click();
  await waitMermaidSvg(page, 0);
  await waitMermaidSvg(page, 1);

  const before = {
    left: await mermaidBox(page, 0).innerHTML(),
    right: await mermaidBox(page, 1).innerHTML(),
  };
  expect(before.left).toContain("<svg");
  expect(before.right).toContain("<svg");

  // cycleTheme 的同一条实现路径（modeline 主题钮 = view.theme-cycle 命令）：写 data-theme →
  // invalidateMermaidTheme → refreshPreview 广播全部 pane。
  await expect(page.locator(".modeline-theme")).toBeVisible();
  await page.locator(".modeline-theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // 两个 pane 都重渲（缓存整体失效 + 逐 view settle 桥；只刷活跃 pane 的话右侧会停在
  // 旧 SVG 上，下面两条断言一真一假）。
  await waitMermaidSvg(page, 0);
  await waitMermaidSvg(page, 1);
  const after = {
    left: await mermaidBox(page, 0).innerHTML(),
    right: await mermaidBox(page, 1).innerHTML(),
  };
  expect(after.left, "左 pane（活跃）应按新主题重渲").not.toBe(before.left);
  expect(after.right, "右 pane（后台）也应按新主题重渲").not.toBe(before.right);
  // 渲染身份不变：仍是各自的图（重渲的是主题色，不是内容串了）。
  await expect(mermaidBox(page, 0)).toHaveAttribute("title", /乙终/);
  await expect(mermaidBox(page, 1)).toHaveAttribute("title", /丁终/);
});

/** 读某 pane 第一根列表行的 --lp-list-body 像素值（悬挂缩进的测量落点；读不到 = FAIL）。 */
async function listBodyPx(page: Page, paneIndex: number): Promise<number> {
  return page.locator(".editor-pane").nth(paneIndex).locator(".cm-lp-list-line").first().evaluate((el) => {
    const match = (el.getAttribute("style") ?? "").match(/--lp-list-body:\s*([\d.]+)px/);
    if (!match) throw new Error("读不到 --lp-list-body（判 FAIL，不当成零）");
    return Number(match[1]);
  });
}

test("lists：document 级观察器两个实例各自重测量（⌘= 后两 pane 缩进同步变大）", async ({ page }) => {
  const files = { "l1.md": LIST_LEFT, "l2.md": LIST_RIGHT };
  await boot(page, files, "l1.md");
  // 左 pane 的列表标记先就位（测量 → 装饰是异步的）。
  await expect(page.locator(".editor-pane").nth(0).locator(".cm-lp-list-marker").first()).toBeVisible();

  await page.keyboard.press("F2");
  await page.locator('.ft-row[title="l2.md"]').click();
  await expect(page.locator(".editor-pane").nth(1).locator(".cm-lp-list-marker").first()).toBeVisible();

  const beforeLeft = await listBodyPx(page, 0);
  const beforeRight = await listBodyPx(page, 1);
  expect(beforeLeft).toBeGreaterThan(0);
  expect(beforeRight).toBeGreaterThan(0);

  // ⌘=（view.text-scale-up，global 作用域）：typography 把 --editor-font-size 写进
  // documentElement.style——两个 ListLayout 实例各自的 MutationObserver 都应开火。
  // 焦点放进左 pane（命令是 global，但给一个真实的用户前置）。
  await page.locator(".editor-pane").nth(0).locator(".cm-content").click();
  await page.keyboard.press("Meta+=");

  // 两个 pane 的悬挂缩进都按新字号重测量（步进 1.1 倍，给 5% 判定余量）——后台 pane
  // 的观察器若没生效，它的缩进会停在旧值。
  await expect.poll(() => listBodyPx(page, 0), { timeout: 5000 }).toBeGreaterThan(beforeLeft * 1.05);
  await expect.poll(() => listBodyPx(page, 1), { timeout: 5000 }).toBeGreaterThan(beforeRight * 1.05);
});
