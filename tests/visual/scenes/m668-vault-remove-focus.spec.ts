import { expect, test, type Page } from "@playwright/test";
import { DEMO_VAULT, stubTauri, type VaultListRow } from "./tauri-stub";

// M668：vault 列表里**移除之后浮层必须还在、焦点必须还在浮层里**（撤销与再次移除可触达）。
//
// 为什么这条要在真实引擎里判（而不是只有单测）：缺陷来源是浏览器对「持焦节点被移除 / 被禁用」
// 的焦点修复——它把焦点送回 body 并派发 `focusout`，浮层的「焦点离开即收起」把这次派发读成
// 用户意图。单测那一层只能按我们**建模**的浏览器行为判（模型口径见 tests/unit/vault-switcher.test.ts
// 的假 DOM 注释）；这里跑的是真引擎：chromium 两条都会派发，真机 WKWebView 同样会（M667 现场：
// 确认移除后浮层整个收起、撤销行不可达）。
//
// 反向验证口径：把 `src/vault-switcher.ts` 的 rebuild 收口去掉，本条 MUST 在 chromium 判红
//（实测：确认钮持焦时被禁用 → focusout → 旧代码 close(false)）。

const REGISTRY: VaultListRow[] = [
  { id: "vault-gone", path: "/Volumes/ext/gone", name: "gone", available: false, last_opened_at: null, tab_count: 0 },
  { id: "fixture-vault", path: "/Users/alex/demo-vault", name: "demo-vault", available: true, last_opened_at: 1757000002000, tab_count: 2 },
  { id: "fixture-vault-b", path: "/Users/alex/notes-vault", name: "notes-vault", available: true, last_opened_at: 1757000001000, tab_count: 0 },
];

/** 焦点是否在浮层内（`document.activeElement` 是唯一真源：`focused` 伪类与 AX 都不判归属）。 */
async function focusInsidePopover(page: Page): Promise<{ inside: boolean; where: string }> {
  return page.evaluate(() => {
    const pop = document.querySelector(".vault-pop");
    const active = document.activeElement;
    return {
      inside: pop !== null && active !== null && pop.contains(active),
      where: active === null ? "null" : `${active.tagName.toLowerCase()}.${active.className || "(no class)"}`,
    };
  });
}

async function openSwitcher(page: Page): Promise<void> {
  await page.locator(".ft-vault").click();
  await expect(page.locator(".vault-row").first()).toBeVisible();
}

test("移除后浮层不收起、焦点留在浮层内：撤销与再次移除都可达（M668）", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, vaults: REGISTRY.map((row) => ({ ...row })) });
  await page.goto("/");
  await expect(page.locator(".ft-vault")).toBeVisible();
  await expect(page.locator(".ft-row").first()).toBeVisible();
  await openSwitcher(page);

  const pop = page.locator(".vault-pop");
  const rows = page.locator(".vault-row-wrap");
  await expect(rows).toHaveCount(3);

  // 1) 进入确认态：持焦节点先落在 × 上（真机点 × 的形态），换行壳时它被换下 DOM。
  const del = rows.nth(2).locator(".vault-row-del");
  await del.focus();
  await del.click();
  await expect(pop).toBeVisible();
  await expect(rows.nth(2).locator(".vault-row-confirm")).toBeVisible();
  expect((await focusInsidePopover(page)).inside).toBe(true);

  // 2) 确认移除：持焦落在「移除」钮上，点到它会被禁用（同样是焦点修复的触发形态）。
  const yes = rows.nth(2).locator(".vault-row-confirm-yes");
  await yes.focus();
  await yes.click();
  await expect(rows).toHaveCount(2); // 列表是重新拉取的：被移除项不再出现
  await expect(pop).toBeVisible();
  await expect(page.locator(".ft-vault")).toHaveAttribute("aria-expanded", "true");
  const afterRemove = await focusInsidePopover(page);
  expect(afterRemove.inside, `焦点应留在浮层内，实际在 ${afterRemove.where}`).toBe(true);

  // 焦点真的能用（不只是"没被挪走"）：焦点在筛选输入框上，键入即筛。
  await expect(page.locator(".vault-filter")).toBeFocused();
  await page.keyboard.type("go");
  await expect(rows).toHaveCount(1); // 只剩 gone 一行命中（输入事件走的就是同一条重建路径）
  await page.locator(".vault-filter").fill("");
  await expect(rows).toHaveCount(2);

  // 3) 同一个打开态浮层里可以继续移除另一行（M667 级联红的第 3 点）：点得进确认态，取消还原。
  // 剩下的两行里只有第 0 行（失效项 gone）可移除——当前项那一行本来就没有移除钮。
  await rows.nth(0).locator(".vault-row-del").click();
  await expect(rows.nth(0).locator(".vault-row-confirm")).toBeVisible();
  await rows.nth(0).locator(".vault-row-confirm-no").click();
  await expect(rows.nth(0).locator(".vault-row")).toHaveCount(1);
  await expect(pop).toBeVisible();

  // 4) 撤销可触达：提示上的「撤销」可点。点提示 = 点浮层外，按既有规则浮层随之收起
  //（这条不是本 mission 的行为，如实断言，避免把「点浮层外收起」误判成回归）。
  const undo = page.getByRole("button", { name: "撤销" });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(pop).toBeHidden();

  // 5) 重新打开：被撤销的行按原值写回，列表重新出现它（级联红第 1/2 点的可观测终态）。
  await openSwitcher(page);
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2).locator(".vault-row-del")).toBeVisible();
  await expect(rows.nth(2).locator(".vault-row-name")).toHaveText("notes-vault");
  expect((await focusInsidePopover(page)).inside).toBe(true);
});
