import { expect, test } from "@playwright/test";
import { stubTauri } from "./tauri-stub";

// 应用骨架与信息落位（change restyle-ui-tokens-v1，tasks §4.1–§4.3）：
// 四区网格（标题栏 42 / 侧栏 236 + 正文 + dock 预留列 0 / modeline 25）、
// masthead 移除后的三处落位（vault 名 → 侧栏头、路径 → modeline 左、行数语法编码 → modeline 右）、
// 标签迁入标题栏。
//
// 判据全部是**几何读数与文本**（渲染盒宽高、网格轨道像素值、元素文本），不用「class 存在」。
// 本场景不新增像素基线（实现期禁止零碎基线动作，见 restyle-theme.spec.ts 的文件头说明）。

const DOC = `# 第一部分
正文段落。

## 甲小节
小节正文。
`;
const PLAIN = "没有标题的纯文本文档。\n";

const VAULT = {
  entries: [
    { path: "doc.md", kind: "file", size: DOC.length, mtime_ms: 0 },
    { path: "plain.md", kind: "file", size: PLAIN.length, mtime_ms: 0 },
  ],
  files: { "doc.md": DOC, "plain.md": PLAIN },
};

async function open(page: import("@playwright/test").Page, file: string, marker: string): Promise<void> {
  await page.goto("/");
  await page.locator(`.ft-row[title="${file}"]`).click();
  await expect(page.locator(".cm-content")).toContainText(marker);
}

test("骨架几何：侧栏 236 / 标题栏 42 / modeline 25 / dock 列 0 / 正文列 680 居中", async ({ page }) => {
  await stubTauri(page, VAULT);
  await open(page, "doc.md", "正文段落");

  const geo = await page.evaluate(() => {
    const rect = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    const root = getComputedStyle(document.documentElement);
    const shell = getComputedStyle(document.querySelector(".app-shell")!);
    const scroller = getComputedStyle(document.querySelector(".cm-scroller")!);
    return {
      token: {
        sidebar: root.getPropertyValue("--layout-sidebar-w").trim(),
        titlebar: root.getPropertyValue("--layout-titlebar-h").trim(),
        modeline: root.getPropertyValue("--layout-modeline-h").trim(),
        measure: root.getPropertyValue("--layout-doc-measure").trim(),
      },
      shellRows: shell.gridTemplateRows.split(" ").map((v) => Number.parseFloat(v)),
      shellCols: shell.gridTemplateColumns.split(" ").map((v) => Number.parseFloat(v)),
      scrollerCols: scroller.gridTemplateColumns.split(" ").map((v) => Number.parseFloat(v)),
      sidebarWidth: rect(".pane-filetree").width,
      titlebarHeight: rect(".titlebar").height,
      modelineHeight: rect(".modeline").height,
      contentWidth: rect(".cm-content").width,
      contentLeft: rect(".cm-content").left,
      paneLeft: rect(".pane-editor").left,
      paneRight: rect(".pane-editor").right,
    };
  });

  // 三档布局尺寸的单一来源是 token 层，读数与 token 逐项一致
  expect(geo.token).toEqual({ sidebar: "236px", titlebar: "42px", modeline: "25px", measure: "680px" });
  expect(geo.sidebarWidth).toBe(236);
  expect(geo.titlebarHeight).toBe(42);
  expect(geo.modelineHeight).toBe(25);
  // 网格轨道：行 = 标题栏 / 主行 / modeline；列 = 侧栏 / 正文 / dock 预留列（第三列零像素）
  expect(geo.shellRows).toEqual([42, 800 - 42 - 25, 25]);
  expect(geo.shellCols[0]).toBe(236);
  expect(geo.shellCols[2]).toBe(0);
  // 正文列 = 定值 680（框宽），两侧等分剩余空间 ⇒ 居中
  expect(geo.scrollerCols[1]).toBe(680);
  expect(geo.contentWidth).toBe(680);
  expect(Math.abs(geo.scrollerCols[0] - geo.scrollerCols[2])).toBeLessThanOrEqual(1);
  const leftGap = geo.contentLeft - geo.paneLeft;
  const rightGap = geo.paneRight - (geo.contentLeft + geo.contentWidth);
  expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1);
});

test("信息落位：vault 名入侧栏头、路径入 modeline 左、行数语法编码入 modeline 右，masthead 不在场", async ({
  page,
}) => {
  await stubTauri(page, VAULT);
  await open(page, "doc.md", "正文段落");

  // masthead 的三个旧选择器一个都不剩（tasks §4.2 的「rg 零命中」在视图侧的对照）
  await expect(page.locator(".masthead, .masthead-vault, .masthead-file, .masthead-section")).toHaveCount(0);

  // vault 名在侧栏头（切换器入口形态不变：button + aria-haspopup）
  const vaultEntry = page.locator(".ft-vault");
  await expect(vaultEntry).toBeVisible();
  await expect(page.locator(".ft-vault-name")).toHaveText("demo-vault");
  expect(await vaultEntry.getAttribute("aria-haspopup")).toBe("listbox");

  // 文件路径入 modeline 左段（vault 相对路径 = 打开时用的那个名字）
  await expect(page.locator(".modeline-left .modeline-path")).toHaveText("doc.md");
  // 右段三要素：语法 · 行数 · 编码（行数派生自 doc.lines，断言与文档行数一致）
  await expect(page.locator(".modeline-right .modeline-meta")).toHaveText(/^Markdown · \d+ 行 · UTF-8$/);
  await expect(page.locator(".modeline-meta")).toHaveText(
    new RegExp(`^Markdown · ${DOC.split("\n").length} 行 · UTF-8$`),
  );
});

test("位置指示段迁到 modeline：有标题显示链接、无标题隐藏、点击开浮层", async ({ page }) => {
  await stubTauri(page, VAULT);
  await open(page, "doc.md", "正文段落");

  const indicator = page.locator(".modeline-section");
  await expect(indicator).toBeVisible();
  // 光标在文档首 → 第一行就是 H1，链路只有它自己（toc 语义不变，只换承载面）
  await expect(indicator).toHaveText("第一部分");
  // 指示段在 modeline **内**（不是浮在编辑器上方）
  expect(await page.locator(".modeline .modeline-section").count()).toBe(1);

  // 点击打开大纲浮层（原 masthead 指示段的同一交互）
  await indicator.click();
  await expect(page.locator(".lumir-toc")).toBeVisible();
  await expect(page.locator(".lumir-toc-item").first()).toHaveText("第一部分");
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-toc")).toBeHidden();

  // 无标题文档：指示段收起（与旧承载面同一判据）
  await page.locator('.ft-row[title="plain.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("没有标题的纯文本文档");
  await expect(page.locator(".modeline-section")).toBeHidden();
});

test("标签迁入标题栏：打开文件后标签是标题栏的子节点，空态只剩 traffic 区", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");

  // 空态：标签区隐藏，标题栏的可见子节点只剩 traffic 灯区
  const emptyChildren = await page.locator(".titlebar").evaluate((bar) =>
    [...bar.children].filter((child) => (child as HTMLElement).offsetParent !== null).map((c) => c.className),
  );
  expect(emptyChildren).toEqual(["titlebar-traffic"]);

  await open(page, "doc.md", "正文段落");
  // 打开文件后标签在场，且**在标题栏内**（不是自成一个网格行）
  await expect(page.locator(".titlebar .tabstrip .tab")).toHaveCount(1);
  const rows = await page.evaluate(() => {
    const shell = getComputedStyle(document.querySelector(".app-shell")!);
    const tabstrip = document.querySelector(".tabstrip")!;
    return {
      shellRows: shell.gridTemplateRows.split(" ").length,
      titlebarContainsTabstrip: document.querySelector(".titlebar")!.contains(tabstrip),
    };
  });
  // 四区骨架只有三行（旧实现的独立标签栏行已并入标题栏行）
  expect(rows.shellRows).toBe(3);
  expect(rows.titlebarContainsTabstrip).toBe(true);
});
