import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";

// M242 标签循环键 `⌘}` / `⌘{` 的**按键链路**（change tab-cycle-keys 的 D1/D2/D3）。
//
// 为什么这条判据落在这里：真机通道产不出 `Cmd-}` 这个 token——KimiCU 注入 `cmd+shift+rightbracket`
// 落地的是 `key="]" + shiftKey`（Shift 标志在、字符没被替换），应用归一成 `Cmd-Shift-]`；字面量
// `cmd+}` 又被 KimiCU 的键名表直接拒（M242 三条实测，见 `scripts/acceptance/README.md` 的
// 「键盘注入通道的两类不可达」）。chromium 的 `keyboard.press` 按 US 布局**自己算 Shift 后的字符**
// （`BracketRight` 的 shifted 形态 = `}`），产出的正是硬件形态事件 —— 这是唯一能验「硬件 ⌘⇧] →
// `Cmd-}` → tab.next」这一步的通道。
//
// 表内 token 形态另由 `tests/unit/keys.test.ts` 专测（含「`Cmd-Shift-]` 不在表内」的反向断言）；
// 真机场景 45 验的是同两条命令的循环语义（`⌃⇥` / `⌃⇧⇥`，同一份 `cycleTab`）。三层口径互补，别互相
// 替代。

const VAULT = {
  entries: [
    { path: "alpha.md", kind: "file", size: 20, mtime_ms: 0 },
    { path: "beta.md", kind: "file", size: 20, mtime_ms: 0 },
  ],
  files: { "alpha.md": "# Alpha\n\n甲篇正文。\n", "beta.md": "# Beta\n\n乙篇正文。\n" },
};

const activeTab = (page: Page) => page.locator(".tab.is-active .tab-name");

/** 两个固定标签（顺序 [alpha, beta]），焦点交回编辑器——键盘事件的目标要在正文里，
 *  与真机场景 45「先取前台再注入」的前置同义。 */
async function twoTabs(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="alpha.md"]').click({ modifiers: ["Meta"] });
  await expect(page.locator(".tab")).toHaveCount(1);
  await page.locator('.ft-row[title="beta.md"]').click({ modifiers: ["Meta"] });
  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(activeTab(page)).toHaveText("beta.md");
  await page.locator(".cm-content").click();
}

test("⌘⇧]（硬件形态：key=`}` + shiftKey）命中 `Cmd-}` → tab.next，末端回卷", async ({ page }) => {
  await twoTabs(page);

  // 已激活的是最后一个标签：netx 回卷到第一个（D1 的环绕裁决）
  await page.keyboard.press("Meta+Shift+BracketRight");
  await expect(activeTab(page)).toHaveText("alpha.md");
  // 切标签必须真的换文档（只有 modeline/高亮变了不算）
  await expect(page.locator(".cm-content")).toContainText("甲篇正文");

  await page.keyboard.press("Meta+Shift+BracketRight");
  await expect(activeTab(page)).toHaveText("beta.md");
  await expect(page.locator(".cm-content")).toContainText("乙篇正文");
});

test("⌘⇧[（key=`{` + shiftKey）命中 `Cmd-{` → tab.prev", async ({ page }) => {
  await twoTabs(page);

  await page.keyboard.press("Meta+Shift+BracketLeft");
  await expect(activeTab(page)).toHaveText("alpha.md");
  await expect(page.locator(".cm-content")).toContainText("甲篇正文");
});

test("同一 token 的简写形态 `Meta+}` / `Meta+{` 等价命中（归一化把 Shift 隐含符号的 Shift 丢掉）", async ({
  page,
}) => {
  await twoTabs(page);

  await page.keyboard.press("Meta+}");
  await expect(activeTab(page)).toHaveText("alpha.md");
  await page.keyboard.press("Meta+{");
  await expect(activeTab(page)).toHaveText("beta.md");
});

test("边界固化：KimiCU 形态的事件（key=`]` + shiftKey）不命中——表只收硬件形态的 token", async ({ page }) => {
  await twoTabs(page);

  // 这条不是「产品应该支持」的断言，而是**把通道错配钉死**：真机注入恰恰给这种事件（key 是未按
  // Shift 的字符、shiftKey 在场），归一成 `Cmd-Shift-]`，而表里只有 `Cmd-}`。合成事件复刻它，
  // 断言「切不动」——将来若有人把 `Cmd-Shift-]` 也塞进表里「修」真机通道，这条会红，逼出一次
  // 显式裁决（M242 的 D2 裁决是只收硬件形态）。
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "]", metaKey: true, shiftKey: true, bubbles: true }));
  });
  await page.waitForTimeout(80);

  await expect(activeTab(page)).toHaveText("beta.md");
});
