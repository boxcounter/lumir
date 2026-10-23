import { expect, test } from "@playwright/test";
import { COPY } from "../../../src/copy-data";
import { fireVaultRestoreFinished, setBackendVault, stubTauri, type VaultFixture } from "./tauri-stub";

// M159（change startup-restore-off-main-thread）：启动三态与让位规则的前端侧。
//
// M645（change app-splash-screen）改判了「恢复中」的呈现面：从「未打开空态的布局 + 提示行」
// 改为**启动态 + 阶段行**（同一句 D95 文案，vault-workspace 的 MODIFIED 条款）。因此本文件
// 的恢复中断言落在应用启动面上（`#startup` / `.startup-phase` / `.startup-open`），终态断言
// 仍是既有的 `.ft-empty` / `.ft-notice` / 树行。
//
// 判别力已反向验证（REVIEW.md 「断言等价于子串」条的防线，删断言前请重做这一步）：把 `src/main.ts` 的
// 让位门（`applyRestoreFinished` 里的 `!vaultLoaded`）或 `refreshVaultStatus` 的恢复中分支
// 去掉后，本文件应有多条用例转红；只绿不红说明断言已退化成恒真。M645 的同族反向验证：把
// `applyVault` 里的 `startup?.notifyTreeReady()` 删掉，第 3 / 4 条会红在「`#startup` 仍在」。

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

// 文案 D95：规范文本的唯一居所是文案表（src/copy-data.ts），场景从那里取值——
// MUST NOT 在这里手抄一份字面量（M282 起文案一律经表，deck ↔ 表由单测的漂移门禁钉住）。
const RESTORING_NOTICE = COPY["D95"].zh;

test("恢复中 = 启动态 + 阶段行（D95），打开入口在场且不另建空态", async ({ page }) => {
  await stubTauri(page, RESTORING);
  await page.goto("/");
  await expect(page.locator("#startup")).toBeVisible();
  // 阶段行只在恢复进行中显示，文本取既有 D95（不新增文案条目）
  await expect(page.locator(".startup-phase")).toHaveText(RESTORING_NOTICE);
  // 启动态内的「打开 vault」入口（与树空态按钮同一形态 / 同一条链路）
  await expect(page.locator(".startup-open")).toBeVisible();
  await expect(page.locator(".startup-open")).toHaveText("打开 vault");
  // task 3.2：恢复中态不再走 tree.showEmpty(D95)——同一等待不两处呈现。
  await expect(page.locator(".ft-empty")).toHaveCount(0);
  await expect(page.locator(".ft-row")).toHaveCount(0);
  // task 2.1：启动面挂在 `#app` 之外——`createShell` 的 replaceChildren 不会抹掉它。
  await expect(page.locator(".app-shell")).toHaveCount(1);
  await expect(page.locator("#startup")).toHaveCount(1);
  await expect(page.locator("#app #startup")).toHaveCount(0);
});

test("未打开终态没有阶段行——启动态撤下后露出既有空态", async ({ page }) => {
  await stubTauri(page, null);
  await page.goto("/");
  // 终态到达即撤下启动态（reason=no_vault），露出既有空态与打开入口
  await expect(page.locator("#startup")).toHaveCount(0);
  await expect(page.locator(".ft-empty")).toBeVisible();
  await expect(page.locator(".ft-open-btn")).toBeVisible();
  // 判据是「无提示行」：恢复中态的文案现在只在启动态的阶段行里，终态空态不带它
  await expect(page.locator(".ft-notice")).toHaveCount(0);
  await expect(page.locator(".ft-row")).toHaveCount(0);
});

test("恢复完成信号唤醒一次权威拉取，树就绪即撤下启动态", async ({ page }) => {
  await stubTauri(page, RESTORING);
  await page.goto("/");
  await expect(page.locator(".startup-phase")).toHaveText(RESTORING_NOTICE);

  // 后端恢复线程提交完成（vault_current 从此应答已打开）并发出完成信号
  await setBackendVault(page, RESTORED);
  await fireVaultRestoreFinished(page);

  await expect(page.locator('.ft-row[title="readme.md"]')).toBeVisible();
  // 终点 1：树装载完成 → 启动态单帧撤下，没有阶段行残留
  await expect(page.locator("#startup")).toHaveCount(0);
  await expect(page.locator(".ft-notice")).toHaveCount(0);
});

test("恢复期间用户经启动态入口打开另一个 vault 后，完成信号不再生效（让位规则）", async ({ page }) => {
  await stubTauri(page, { ...RESTORING, switchTo: TAKEOVER });
  await page.goto("/");
  // 启动态在场期间入口可用（恢复期间保留打开入口的既有承诺，M159）。等阶段行就位再点：
  // 入口的点击回调由主模块装载后接线（启动层先画、主模块后载），阶段行出现即接线已完成。
  await expect(page.locator(".startup-phase")).toHaveText(RESTORING_NOTICE);
  await expect(page.locator(".startup-open")).toBeVisible();

  // 用户经启动态内的入口成功打开自己的 vault（vault_open 桩返回 TAKEOVER）
  await page.locator(".startup-open").click();
  await expect(page.locator('.ft-row[title="mine.md"]')).toBeVisible();
  await expect(page.locator("#startup")).toHaveCount(0);

  // 过期恢复随后完成：后端仍报上次那个 vault 并发出完成信号。
  // 前端已成功装载（vaultLoaded），因此 MUST NOT 再应用——若少了那道门，这里会装载成
  // restored-vault（mine.md 消失、readme.md 出现），断言即 FAIL。
  await setBackendVault(page, RESTORED);
  await fireVaultRestoreFinished(page);

  await expect(page.locator('.ft-row[title="mine.md"]')).toBeVisible();
  await expect(page.locator('.ft-row[title="readme.md"]')).toHaveCount(0);
  await expect(page.locator(".ft-notice")).toHaveCount(0);
});
