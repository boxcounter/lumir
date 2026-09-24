import { expect, test } from "@playwright/test";
import {
  DEMO_VAULT,
  externalDelete,
  externalWrite,
  fileText,
  fireFsEvent,
  stubTauri,
} from "./tauri-stub";

// M124 保存冲突恢复与外部修改重载：dogfood 核心场景是「在 Lumir 和 Obsidian
// 之间来回」，保存冲突与外部修改是高频路径。错误触发分两路：
// - failures 注入（document_conflict / fs_not_found）：断言 sticky 提示与动作
//   按钮按合同出现（注入是持续语义，同 command 每次调用都抛）；
// - 自然路径（__externalWrite 改内容 → 真实 CAS 冲突；__externalDelete 删文件
//   → fs_not_found）：端到端走通恢复动作。
// 另覆盖 watch 命中打开中文件的三种处置与自身保存事件的 revision 比对丢弃。

const VAULT = {
  ...DEMO_VAULT,
  files: {
    ...DEMO_VAULT.files,
    "docs/guide.md": "# Guide\n\n指南内容。",
  },
};

/** 打开 README.md 并敲入一段本地修改。 */
async function openAndEdit(page: import("@playwright/test").Page, typed = "ZZZ") {
  await page.goto("/");
  await page.locator('.ft-row[title="README.md"]').click();
  const content = page.locator(".cm-content");
  await expect(content).toContainText("Demo Vault");
  await content.click();
  await page.keyboard.type(typed);
  await expect(page.locator(".modeline-path")).toContainText("未保存");
  return content;
}

test("保存冲突（failures 注入）：sticky 提示带两个恢复动作", async ({ page }) => {
  await stubTauri(page, {
    ...VAULT,
    failures: {
      document_save: { code: "document_conflict", message: "文件已被外部修改，请先协调冲突" },
    },
  });
  await openAndEdit(page);
  await page.keyboard.press("Meta+s");

  // 冲突必须给出可理解提示（保存守卫回归同时断言文案含「未丢失」）；
  // 处置前不自动消隐（sticky）。
  const conflict = page.locator(".lumir-toast", { hasText: "保存冲突" });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText("未丢失");
  // 两个逃生口缺一不可：CAS 下重试必败，没有动作用户修改将被锁死在内存。
  await expect(conflict.getByRole("button", { name: "重新载入（放弃我的修改）" })).toBeVisible();
  await expect(conflict.getByRole("button", { name: "强制覆盖保存" })).toBeVisible();
});

test("真实 CAS 冲突：重新载入放弃本地修改", async ({ page }) => {
  await stubTauri(page, VAULT);
  const content = await openAndEdit(page);

  // Obsidian 侧先保存了同文件（revision 变化），Lumir 再保存 → CAS 冲突。
  await externalWrite(page, "README.md", "# External version\n");
  await page.keyboard.press("Meta+s");
  const conflict = page.locator(".lumir-toast", { hasText: "保存冲突" });
  await expect(conflict).toBeVisible();

  await conflict.getByRole("button", { name: "重新载入（放弃我的修改）" }).click();
  await expect(page.locator(".lumir-toast", { hasText: "已重新载入磁盘内容" })).toBeVisible();
  // 本地修改被放弃，编辑器回到磁盘内容；dirty 清除。
  await expect(content).toContainText("External version");
  await expect(content).not.toContainText("ZZZ");
  await expect(page.locator(".modeline-path")).not.toContainText("未保存");
});

test("真实 CAS 冲突：强制覆盖保存，确认文案明示覆盖较新内容", async ({ page }) => {
  await stubTauri(page, VAULT);
  const content = await openAndEdit(page);

  await externalWrite(page, "README.md", "# External version\n");
  await page.keyboard.press("Meta+s");
  const conflict = page.locator(".lumir-toast", { hasText: "保存冲突" });
  await expect(conflict).toBeVisible();

  // 强制覆盖是破坏性动作：二次确认文案必须明示将覆盖磁盘上较新的内容。
  await conflict.getByRole("button", { name: "强制覆盖保存" }).click();
  const confirm = page.locator(".lumir-toast", { hasText: "将覆盖磁盘上较新的内容" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "覆盖保存" }).click();

  // 覆盖落盘：磁盘内容 = 本地修改；dirty 清除。
  await expect(page.locator(".lumir-toast", { hasText: "已强制覆盖保存" })).toBeVisible();
  await expect.poll(() => fileText(page, "README.md")).toContain("ZZZ");
  await expect(page.locator(".modeline-path")).not.toContainText("未保存");
  await expect(content).toContainText("ZZZ");
});

test("fs_not_found（failures 注入）：提示修改未丢失并提供另存动作", async ({ page }) => {
  await stubTauri(page, {
    ...VAULT,
    failures: {
      document_save: { code: "fs_not_found", message: "文件不存在：README.md" },
    },
  });
  await openAndEdit(page);
  await page.keyboard.press("Meta+s");

  const lost = page.locator(".lumir-toast", { hasText: "已被外部删除或移动" });
  await expect(lost).toBeVisible();
  await expect(lost).toContainText("未丢失");
  await expect(lost.getByRole("button", { name: "另存为新文件" })).toBeVisible();
});

test("文件被外部删除后另存为新文件：内容落地并切换过去", async ({ page }) => {
  await stubTauri(page, {
    ...VAULT,
    creates: { "[[README-恢复]]": "README-恢复.md" },
  });
  await openAndEdit(page);

  // 外部删除 → 保存自然命中 fs_not_found（failures 未注入，走桩的缺文件分支）。
  await externalDelete(page, "README.md");
  await page.keyboard.press("Meta+s");
  const lost = page.locator(".lumir-toast", { hasText: "已被外部删除或移动" });
  await expect(lost).toBeVisible();
  await lost.getByRole("button", { name: "另存为新文件" }).click();

  // 新文件经 create_note（O_EXCL）创建并写入内存内容，编辑器切过去。
  await expect(page.locator(".lumir-toast", { hasText: "已另存为：README-恢复.md" })).toBeVisible();
  await expect.poll(() => fileText(page, "README-恢复.md")).toContain("ZZZ");
  await expect(page.locator(".modeline-path")).toHaveText("README-恢复.md");
  await expect(page.locator(".cm-content")).toContainText("ZZZ");
});

test("watch 外部修改（未 dirty）：自动重载并提示", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="README.md"]').click();
  const content = page.locator(".cm-content");
  await expect(content).toContainText("Demo Vault");

  await externalWrite(page, "README.md", "# External version\n");
  await fireFsEvent(page, [{ kind: "modified", path: "README.md", entry_kind: "file" }]);

  await expect(content).toContainText("External version");
  await expect(page.locator(".lumir-toast", { hasText: "已自动重载" })).toBeVisible();
  await expect(page.locator(".modeline-path")).not.toContainText("未保存");
});

test("watch 外部修改（dirty）：sticky 提示二选一，保留或重载都可达", async ({ page }) => {
  await stubTauri(page, VAULT);
  const content = await openAndEdit(page);
  await externalWrite(page, "README.md", "# External version\n");
  await fireFsEvent(page, [{ kind: "modified", path: "README.md", entry_kind: "file" }]);

  const prompt = page.locator(".lumir-toast", { hasText: "检测到外部修改" });
  await expect(prompt).toBeVisible();
  const keep = prompt.getByRole("button", { name: "保留我的版本" });
  const reload = prompt.getByRole("button", { name: "重载（放弃我的修改）" });
  await expect(keep).toBeVisible();
  await expect(reload).toBeVisible();

  // 选保留：本地修改不动，磁盘的新内容不进编辑器。
  await keep.click();
  await expect(content).toContainText("ZZZ");
  await expect(content).not.toContainText("External version");

  // 再来一次外部保存：提示重现（非一次性），这次选重载。
  await externalWrite(page, "README.md", "# Second external\n");
  await fireFsEvent(page, [{ kind: "modified", path: "README.md", entry_kind: "file" }]);
  await expect(page.locator(".lumir-toast", { hasText: "检测到外部修改" })).toBeVisible();
  await page
    .locator(".lumir-toast", { hasText: "检测到外部修改" })
    .getByRole("button", { name: "重载（放弃我的修改）" })
    .click();
  await expect(content).toContainText("Second external");
  await expect(content).not.toContainText("ZZZ");
  await expect(page.locator(".modeline-path")).not.toContainText("未保存");
});

test("watch 外部删除打开中文件：提示内容未丢失，编辑器保留现状", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="README.md"]').click();
  const content = page.locator(".cm-content");
  await expect(content).toContainText("Demo Vault");

  await externalDelete(page, "README.md");
  await fireFsEvent(page, [{ kind: "deleted", path: "README.md", entry_kind: null }]);

  const gone = page.locator(".lumir-toast", { hasText: "已被外部删除" });
  await expect(gone).toBeVisible();
  await expect(gone).toContainText("未丢失");
  await expect(content).toContainText("Demo Vault");
});

test("自身保存产生的 watch 事件经 revision 比对丢弃：不重载、不提示", async ({ page }) => {
  await stubTauri(page, VAULT);
  const content = await openAndEdit(page);
  await page.keyboard.press("Meta+s");
  await expect(page.locator(".lumir-toast", { hasText: "已保存" })).toBeVisible();

  // 真后端下 document_save 的 rename 会触发 modified 事件（stub 不自动发，手动补）。
  await fireFsEvent(page, [{ kind: "modified", path: "README.md", entry_kind: "file" }]);
  await page.waitForTimeout(400);
  await expect(page.locator(".lumir-toast", { hasText: "已自动重载" })).toHaveCount(0);
  await expect(content).toContainText("ZZZ");
});
