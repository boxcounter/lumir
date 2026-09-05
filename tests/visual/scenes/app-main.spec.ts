import { expect, test } from "@playwright/test";
import { DEMO_VAULT, fireFsEvent, stubTauri } from "./tauri-stub";

// 基线场景：主界面（文件树 + 编辑器 + 面板）。截图目标见 README.md 的选型说明——
// 这是 webview 内容截图，不含原生窗口装饰。Tauri 后端用 __TAURI_INTERNALS__ 桩
// 替代（见 tauri-stub.ts），invoke 走 fixture 路由。

test("未打开 vault 的空态主界面", async ({ page }) => {
  await stubTauri(page, null);
  await page.goto("/");
  const openBtn = page.getByRole("button", { name: "打开 vault" });
  await expect(openBtn).toBeVisible();
  // 等 CM 首帧内容就绪再截图（.cm-editor 可见 ≠ 首屏文本已绘制）；
  // 实测 headless 下文本进 DOM 后仍需一个绘制周期，waitForTimeout 兜住这个竞态。
  // SAMPLE 文档经 live preview 渲染：frontmatter 为 properties 区块，正文为装饰后形态。
  await expect(page.locator(".cm-content")).toContainText("标题一");
  await page.waitForTimeout(400);
  await expect(page).toHaveScreenshot("app-main.png");
});

test("打开 vault 后的全类型文件树", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await page.goto("/");

  // 全类型混合展示：md / 目录 / PDF / 无扩展名文本都在（spec: 不只展示 Markdown）
  await expect(page.locator(".ft-vault-name")).toHaveText("demo-vault");
  for (const name of ["README.md", "docs", "src", "assets", "archive.pdf", "LICENSE"]) {
    await expect(page.locator(`.ft-row[title="${name}"]`)).toBeVisible();
  }

  // 目录展开/折叠
  await page.locator('.ft-row[title="docs"]').click();
  await expect(page.locator('.ft-row[title="docs/guide.md"]')).toBeVisible();
  await page.locator('.ft-row[title="src"]').click();
  await expect(page.locator('.ft-row[title="src/main.ts"]')).toBeVisible();

  // 点击 md 文件在编辑器打开（走 fs_read_file 桩）
  await page.locator('.ft-row[title="README.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("Demo Vault");

  // 点击不支持的二进制给提示而非报错弹窗（spec scenario）
  await page.locator('.ft-row[title="archive.pdf"]').click();
  await expect(page.locator(".editor-notice")).toContainText("暂不支持预览");

  // 回到 md，提示层收起
  await page.locator('.ft-row[title="README.md"]').click();
  await expect(page.locator(".editor-notice")).toBeHidden();

  await expect(page).toHaveScreenshot("filetree-open.png");
});

test("watch 增量刷新保持展开状态", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="src"]').click();
  await expect(page.locator('.ft-row[title="src/main.ts"]')).toBeVisible();

  // 外部变更：根目录新建文件 + 删除 archive.pdf（spec scenario: 突发变更合并后的批次）
  await fireFsEvent(page, [
    { kind: "created", path: "scratch.md", entry_kind: "file" },
    { kind: "deleted", path: "archive.pdf", entry_kind: null },
  ]);

  // 新文件出现在对应位置，既有目录展开状态不丢（src/main.ts 仍可见）
  await expect(page.locator('.ft-row[title="scratch.md"]')).toBeVisible();
  await expect(page.locator('.ft-row[title="src/main.ts"]')).toBeVisible();
  await expect(page.locator('.ft-row[title="archive.pdf"]')).toHaveCount(0);
});

// 树头部常驻「切换 vault」入口（switcher-vault）：点击走与空态按钮相同的
// vault_open 流程，树整体替换为目标 vault。
const ALT_VAULT_ROOT = "/Users/alex/notes-vault";

test("树头部切换入口切换到另一个 vault", async ({ page }) => {
  await stubTauri(page, {
    ...DEMO_VAULT,
    switchTo: {
      root: ALT_VAULT_ROOT,
      entries: [
        { path: "inbox.md", kind: "file", size: 64, mtime_ms: 1757000000000 },
        { path: "projects", kind: "dir", size: 0, mtime_ms: 1757000000000 },
        { path: "projects/plan.md", kind: "file", size: 256, mtime_ms: 1757000000000 },
      ],
      files: {
        "inbox.md": "# Inbox\n\n第二个 vault 的收件箱。\n",
      },
    },
  });
  await page.goto("/");
  await expect(page.locator(".ft-vault-name")).toHaveText("demo-vault");

  await page.getByRole("button", { name: "切换 vault" }).click();

  // 头部与树整体替换为新 vault；旧 vault 条目不残留
  await expect(page.locator(".ft-vault-name")).toHaveText("notes-vault");
  await expect(page.locator('.ft-row[title="inbox.md"]')).toBeVisible();
  await expect(page.locator('.ft-row[title="projects"]')).toBeVisible();
  await expect(page.locator('.ft-row[title="README.md"]')).toHaveCount(0);

  // 新 vault 的文件可正常打开（附件索引 / fs_read_file 已指向新 vault）
  await page.locator('.ft-row[title="inbox.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("Inbox");
});
