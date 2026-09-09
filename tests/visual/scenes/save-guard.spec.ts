import { expect, test } from "@playwright/test";
import { DEMO_VAULT, dirtyReports, fireQuitBlocked, stubTauri } from "./tauri-stub";

// M101 保存守卫回归：真实桌面验收确认的三类缺陷。
// 1. 非 Markdown 文件必须在内存层拒绝用户编辑（视图层只读，不产生 dirty）——
//    旧实现只靠 changeFilter 事后回滚 DOM，真实 WKWebView 的 AX/IME 注入路径会漏。
// 2. dirty 状态的用户可见反馈（masthead 常驻标记 + 保存冲突/失败提示不静默）。
// 3. dirty 拦截切换/退出时必须有可理解的界面提示。
// 原生退出拦截本体在 Rust（RunEvent::ExitRequested/CloseRequested + DirtyState），
// 这里验证前端半边：dirty 经 document_set_dirty 镜像给后端、app:quit_blocked
// 事件转化为界面提示。

const VAULT = {
  ...DEMO_VAULT,
  files: {
    ...DEMO_VAULT.files,
    "src/main.ts": "export const answer = 42;\n",
  },
};

test("code 模式文件在视图层只读：键盘与 DOM 注入都无法改内存文档", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="src"]').click();
  await page.locator('.ft-row[title="src/main.ts"]').click();
  const content = page.locator(".cm-content");
  await expect(content).toContainText("answer = 42");

  // 视图层只读的直接证据：contenteditable 被摘掉（旧实现恒为 true）。
  await expect(content).toHaveAttribute("contenteditable", "false");

  // 键盘输入不得进文档。
  await content.click();
  await page.keyboard.type("HACKED");
  await expect(content).not.toContainText("HACKED");

  // DOM 层注入（execCommand，等价 AX 文本注入走的输入路径）同样不得生效。
  await page.evaluate(() => document.execCommand("insertText", false, "HACKED"));
  await expect(content).not.toContainText("HACKED");

  // 不产生 dirty：masthead 无标记，后端镜像无 true 上报。
  await expect(page.locator(".masthead-file")).toHaveText("src/main.ts");
  expect(await dirtyReports(page)).not.toContain(true);
});

test("md 编辑产生 dirty 标记并镜像后端，保存成功后复位", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="README.md"]').click();
  const content = page.locator(".cm-content");
  await expect(content).toContainText("Demo Vault");
  await expect(content).toHaveAttribute("contenteditable", "true");

  await content.click();
  await page.keyboard.type("edited");
  await expect(content).toContainText("edited");

  // dirty 持久可见（不只是一闪而过的 toast）。
  await expect(page.locator(".masthead-file")).toContainText("未保存");
  // dirty 已镜像给后端退出守卫。
  await expect.poll(() => dirtyReports(page)).toContain(true);

  await page.keyboard.press("Meta+s");
  await expect(page.locator(".lumir-toast")).toContainText("已保存");
  await expect(page.locator(".masthead-file")).not.toContainText("未保存");
  await expect.poll(() => dirtyReports(page)).toContain(false);
});

test("保存冲突：可理解的冲突提示，修改保留，切换与退出被拦截且有提示", async ({ page }) => {
  await stubTauri(page, {
    ...VAULT,
    failures: {
      document_save: { code: "document_conflict", message: "文件已被外部修改，请先协调冲突" },
    },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="README.md"]').click();
  const content = page.locator(".cm-content");
  await expect(content).toContainText("Demo Vault");

  await content.click();
  await page.keyboard.type("edited");
  await page.keyboard.press("Meta+s");

  // 冲突必须给出可理解提示，并说明修改未丢失（不得只剩技术化 message）。
  // 注意多个 toast 可并存（自动消隐前），断言一律按文本定位具体那条。
  await expect(page.locator(".lumir-toast", { hasText: "保存冲突" })).toContainText("未丢失");
  // 保存失败不标 clean：内存修改仍在，dirty 反馈保持。
  await expect(page.locator(".masthead-file")).toContainText("未保存");
  await expect(content).toContainText("edited");

  // dirty 拦截切换文件：必须有人话提示，且停留在当前文件。
  await page.locator('.ft-row[title="docs"]').click();
  await page.locator('.ft-row[title="docs/guide.md"]').click();
  await expect(page.locator(".lumir-toast", { hasText: "无法切换文件" })).toBeVisible();
  await expect(page.locator(".masthead-file")).toContainText("README.md");

  // dirty 拦截退出（后端守卫触发 app:quit_blocked）：必须有界面提示。
  await fireQuitBlocked(page);
  await expect(page.locator(".lumir-toast", { hasText: "无法退出" })).toBeVisible();
});

test("保存写入结果未知：提示核对内容且说明修改未丢失", async ({ page }) => {
  await stubTauri(page, {
    ...VAULT,
    failures: {
      document_save: { code: "document_write_unknown", message: "文档替换结果未知：io error" },
    },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="README.md"]').click();
  const content = page.locator(".cm-content");
  await expect(content).toContainText("Demo Vault");

  await content.click();
  await page.keyboard.type("edited");
  await page.keyboard.press("Meta+s");

  await expect(page.locator(".lumir-toast", { hasText: "保存结果未知" })).toContainText("未丢失");
  await expect(page.locator(".masthead-file")).toContainText("未保存");
});
