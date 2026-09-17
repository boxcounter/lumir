import { expect, test } from "@playwright/test";
import { fireVaultRestoreFinished, setBackendVault, stubTauri, type VaultFixture } from "./tauri-stub";

// M159（change startup-restore-off-main-thread）：启动三态与让位规则的前端侧。
//
// 这一层不新增/更新整页基线——恢复中态复用未打开空态的**同一份布局**（design §4.3 的手段），
// 因此断言落在元素与文本上：`.ft-empty` / `.ft-notice` / `.ft-hint` / `.ft-open-btn` 与
// 文件行的有/无。整页截图是 chromium 近似、容差 0.001，用它判「两态同布局」既看不到文本差异，
// 又会把新状态混进既有基线（下方第一条用例里的元素级断言才是判据）。
//
// 判别力已反向验证（REVIEW.md 第 1 条的防线，删断言前请重做这一步）：把 `src/main.ts` 的
// 让位门（`applyRestoreFinished` 里的 `!vaultLoaded`）与进行态分支（`status.restore_pending ?
// RESTORING_NOTICE : …`）分别去掉后，本文件 4 条用例应有 **3 条转红**（第 1/3/4 条）；只绿不红
// 说明断言已退化成恒真。

/** 恢复中：`vault_current` 按后端契约回 vault=null + restore_pending=true（尚未提交）。 */
const RESTORING: VaultFixture = { entries: [], restorePending: true };

/** 恢复完成的终态：已打开一个 vault。 */
const RESTORED: VaultFixture = {
  entries: [{ path: "readme.md", kind: "file", size: 20, mtime_ms: 1 }],
  files: { "readme.md": "# Restored\n" },
  root: "/Users/alex/restored-vault",
};

/** 恢复中用户抢先选中的另一个 vault（vault_open 桩的"选中结果"）。 */
const TAKEOVER: VaultFixture & { root: string } = {
  entries: [{ path: "mine.md", kind: "file", size: 20, mtime_ms: 1 }],
  files: { "mine.md": "# Mine\n" },
  root: "/Users/alex/mine-vault",
};

const RESTORING_NOTICE = "正在恢复上次打开的 vault……";

test("恢复中态 = 未打开空态布局 + 恢复中提示行 + 打开入口仍在", async ({ page }) => {
  await stubTauri(page, RESTORING);
  await page.goto("/");
  await expect(page.locator(".ft-empty")).toBeVisible();
  await expect(page.locator(".ft-notice")).toHaveText(RESTORING_NOTICE);
  // 与**终态**空态同一份说明行与同一个入口（D5/D6）：布局零新增，入口保留
  //（design §4.3 + §7 A4 的裁决「恢复期间保留打开入口」）。
  await expect(page.locator(".ft-hint")).toHaveText("打开一个目录作为 vault，开始浏览全部文件。");
  await expect(page.locator(".ft-open-btn")).toBeVisible();
  // 进行态不是「已装载」：没有任何文件行
  await expect(page.locator(".ft-row")).toHaveCount(0);
});

test("未打开终态没有提示行——恢复中态与终态可区分", async ({ page }) => {
  await stubTauri(page, null);
  await page.goto("/");
  await expect(page.locator(".ft-empty")).toBeVisible();
  await expect(page.locator(".ft-open-btn")).toBeVisible();
  // 判据是「无提示行」：恢复中态把提示行交给同一个 .ft-notice 位置，两态因此可判
  await expect(page.locator(".ft-notice")).toHaveCount(0);
  await expect(page.locator(".ft-row")).toHaveCount(0);
});

test("恢复完成信号唤醒一次权威拉取，无需用户操作进入该 vault", async ({ page }) => {
  await stubTauri(page, RESTORING);
  await page.goto("/");
  await expect(page.locator(".ft-notice")).toHaveText(RESTORING_NOTICE);

  // 后端恢复线程提交完成（vault_current 从此应答已打开）并发出完成信号
  await setBackendVault(page, RESTORED);
  await fireVaultRestoreFinished(page);

  await expect(page.locator('.ft-row[title="readme.md"]')).toBeVisible();
  await expect(page.locator(".ft-notice")).toHaveCount(0);
});

test("恢复期间用户抢先打开另一个 vault 后，完成信号不再生效（让位规则）", async ({ page }) => {
  await stubTauri(page, { ...RESTORING, switchTo: TAKEOVER });
  await page.goto("/");
  await expect(page.locator(".ft-open-btn")).toBeVisible();

  // 用户经空态入口成功打开自己的 vault（vault_open 桩返回 TAKEOVER）
  await page.locator(".ft-open-btn").click();
  await expect(page.locator('.ft-row[title="mine.md"]')).toBeVisible();

  // 过期恢复随后完成：后端仍报上次那个 vault 并发出完成信号。
  // 前端已成功装载（vaultLoaded），因此 MUST NOT 再应用——若少了那道门，这里会装载成
  // restored-vault（mine.md 消失、readme.md 出现），断言即 FAIL。
  await setBackendVault(page, RESTORED);
  await fireVaultRestoreFinished(page);

  await expect(page.locator('.ft-row[title="mine.md"]')).toBeVisible();
  await expect(page.locator('.ft-row[title="readme.md"]')).toHaveCount(0);
  await expect(page.locator(".ft-notice")).toHaveCount(0);
});
