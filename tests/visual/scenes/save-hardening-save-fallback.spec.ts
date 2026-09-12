import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { DEMO_VAULT, externalDelete, externalWrite, fileText, stubTauri } from "./tauri-stub";

// M127 恢复动作的覆盖补齐与升级：
// 1. 「另存为新文件」的撞名重试循环（-2..-5）此前无测试（M124 reviewer 观察）——
//    用 stub 级注入 wikilink_target_exists 覆盖成功路径与全部撞名后的人工出口；
// 2. 强制覆盖保存再冲突时提示必须升级为带动作按钮的 sticky 提示（旧实现只剩
//    自动消隐的纯文案 toast，用户只能靠再按一次 Cmd+S）。

interface FallbackOpts {
  /** 这些链接原文的创建请求按「目标已存在」拒绝（模拟同目录同名副本已存在）。 */
  takenLinks?: string[];
}

async function stubFallback(page: Page, opts: FallbackOpts = {}): Promise<void> {
  await page.addInitScript((o: FallbackOpts) => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: any) => unknown;
    w.__createCalls = [] as string[];
    w.__raceForceSave = false;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (cmd === "wikilink_create") {
        (w.__createCalls as string[]).push(args.link);
        if ((o.takenLinks ?? []).includes(args.link)) {
          throw { code: "wikilink_target_exists", message: `目标已存在：${args.link}` };
        }
      }
      // 强制覆盖保存的竞态：拉取 revision 与写入之间磁盘又被外部程序改动。
      if (cmd === "document_save" && w.__raceForceSave) {
        w.__raceForceSave = false;
        w.__externalWrite(args.path, "# raced\n");
      }
      return invoke(cmd, args);
    };
  }, opts);
}

/** wikilink_create 收到的链接原文序列（撞名重试是否真的走到 -2/-3 的证据）。 */
async function createCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __createCalls: string[] }).__createCalls);
}

/** 打开 README.md 并敲入一段本地修改。 */
async function openAndEdit(page: Page, typed = "ZZZ") {
  await page.goto("/");
  await page.locator('.ft-row[title="README.md"]').click();
  const content = page.locator(".cm-content");
  await expect(content).toContainText("Demo Vault");
  await content.click();
  await page.keyboard.type(typed);
  await expect(page.locator(".masthead-file")).toContainText("未保存");
  return content;
}

/** 走到「保存目标已被外部删除」的另存入口。 */
async function openNotFoundPrompt(page: Page) {
  await openAndEdit(page);
  await externalDelete(page, "README.md");
  await page.keyboard.press("Meta+s");
  const lost = page.locator(".lumir-toast", { hasText: "已被外部删除或移动" });
  await expect(lost).toBeVisible();
  return lost;
}

test("另存为新文件：撞名沿 -2..-5 重试，在 -3 成功落地", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, creates: { "[[README-恢复-3]]": "README-恢复-3.md" } });
  await stubFallback(page, { takenLinks: ["[[README-恢复]]", "[[README-恢复-2]]"] });
  const lost = await openNotFoundPrompt(page);

  await lost.getByRole("button", { name: "另存为新文件" }).click();

  await expect(page.locator(".lumir-toast", { hasText: "已另存为：README-恢复-3.md" })).toBeVisible();
  // 重试序列逐级递增：-恢复 → -恢复-2 都撞名，-恢复-3 才成功。
  expect(await createCalls(page)).toEqual([
    "[[README-恢复]]",
    "[[README-恢复-2]]",
    "[[README-恢复-3]]",
  ]);
  // 内容落到新文件并切换过去。
  await expect.poll(() => fileText(page, "README-恢复-3.md")).toContain("ZZZ");
  await expect(page.locator(".masthead-file")).toHaveText("README-恢复-3.md");
  await expect(page.locator(".cm-content")).toContainText("ZZZ");
});

test("另存为新文件：-2..-5 全部撞名时给出人工出口，不静默失败", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await stubFallback(page, {
    takenLinks: [
      "[[README-恢复]]",
      "[[README-恢复-2]]",
      "[[README-恢复-3]]",
      "[[README-恢复-4]]",
      "[[README-恢复-5]]",
    ],
  });
  const lost = await openNotFoundPrompt(page);

  await lost.getByRole("button", { name: "另存为新文件" }).click();

  await expect(
    page.locator(".lumir-toast", { hasText: "另存为新文件失败：同名文件已存在，请手动导出" }),
  ).toBeVisible();
  // 五次候选全部试过才放弃（补 stub 级覆盖：此前无测试）。
  expect(await createCalls(page)).toEqual([
    "[[README-恢复]]",
    "[[README-恢复-2]]",
    "[[README-恢复-3]]",
    "[[README-恢复-4]]",
    "[[README-恢复-5]]",
  ]);
  // 内存修改仍在（未静默丢弃），dirty 保持。
  await expect(page.locator(".cm-content")).toContainText("ZZZ");
  await expect(page.locator(".masthead-file")).toContainText("未保存");
});

test("强制覆盖保存再冲突：提示升级为带动作按钮的 sticky 提示", async ({ page }) => {
  await stubTauri(page, DEMO_VAULT);
  await stubFallback(page);
  const content = await openAndEdit(page);

  // 第一次冲突（自然路径）：外部先保存 → Lumir 保存 → CAS 冲突。
  await externalWrite(page, "README.md", "# External version\n");
  await page.keyboard.press("Meta+s");

  // 覆盖动作前武装竞态：拉取 revision 与写入之间磁盘又被外部程序改动。
  await page.evaluate(() => {
    (window as unknown as { __raceForceSave: boolean }).__raceForceSave = true;
  });
  await page
    .locator(".lumir-toast", { hasText: "保存冲突" })
    .getByRole("button", { name: "强制覆盖保存" })
    .click();
  await page
    .locator(".lumir-toast", { hasText: "将覆盖磁盘上较新的内容" })
    .getByRole("button", { name: "覆盖保存" })
    .click();

  // 再冲突：必须再次给出恢复动作，而不是自动消隐的纯文案。
  const reconflict = page.locator(".lumir-toast", { hasText: "保存冲突" });
  await expect(reconflict).toBeVisible();
  await expect(reconflict).toContainText("未丢失");
  await expect(reconflict.getByRole("button", { name: "重新载入（放弃我的修改）" })).toBeVisible();
  await expect(reconflict.getByRole("button", { name: "强制覆盖保存" })).toBeVisible();

  // sticky：远超普通 toast 的消隐窗口后仍在，用户处置前不会消失。
  await page.waitForTimeout(4000);
  await expect(reconflict).toBeVisible();
  // 内存修改仍在，磁盘保持竞态写入的版本（未静默覆盖）。
  await expect(content).toContainText("ZZZ");
  expect(await fileText(page, "README.md")).toBe("# raced\n");
});
