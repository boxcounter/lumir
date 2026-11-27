import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";

// M242 标签循环键 `⌘}` / `⌘{` 的**按键链路**（change tab-cycle-keys 的 D1/D2/D3），
// 以及 change fix-tab-cycle-shift-symbols-nov27 对 token 形态的收口。
//
// 形态证据（2026-11-27，独立 WKWebView 探针 + WebKit 源码）：WKWebView 的 `KeyboardEvent.key`
// 在无 Control 时取 `[event characters]`，而 ⌘⇧] 下这个值是**未按 Shift 的** `]` + `shiftKey`
// （NSEvent 层 `characters="]"`、`charactersIgnoringModifiers="}"`；自建 CGEvent 与 System Events
// 两条通道一致；合成注入通道，物理键盘形态未验）。旧口径只收 `Cmd-}`，于是该形态下的按键永不
// 命中——本 change 起 `SHIFTED_SYMBOLS` 把「未 Shift 字符 + shiftKey」与 Shift 后的字符归一到
// 同一 token，**两种事件形态都必须命中**。
//
// 两条通道各测一次形态：`page.keyboard.press`（chromium 按 US 布局算出 `}` / `{` / `<` / `>`）与
// `page.evaluate` 手工派发（复刻 WKWebView 的 `]` / `[` / `,` / `.` + shiftKey）。
// 表内 token 形态另由 `tests/unit/keys.test.ts` 专测；真机场景 45 验同两条命令的循环语义与
// `⌘⇧]` / `⌘⇧[` 的注入链路（物理键盘形态未验，归 Alex dogfood）。
//
// **M627 起**同一文件也守 `⌘⇧,` → tab.prev / `⌘⇧.` → tab.next（Alex「三键组合无法切换 TAB」）：
// 与 M242 同族，未 Shift 字符形态是 `,` / `.`，token 是 `Cmd-<` / `Cmd->`。方向映射是 tower
// 拟定的假设（, 在 . 左侧）。

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

test("⌘⇧]（Shift 后字符形态：key=`}` + shiftKey）命中 `Cmd-}` → tab.next，末端回卷", async ({ page }) => {
  await twoTabs(page);

  // 已激活的是最后一个标签：next 回卷到第一个（D1 的环绕裁决）
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

test("⌘⇧,（Shift 后字符形态：key=`<` + shiftKey）命中 `Cmd-<` → tab.prev（M627）", async ({ page }) => {
  await twoTabs(page);

  await page.keyboard.press("Meta+Shift+Comma");
  await expect(activeTab(page)).toHaveText("alpha.md");
  await expect(page.locator(".cm-content")).toContainText("甲篇正文");
});

test("⌘⇧.（Shift 后字符形态：key=`>` + shiftKey）命中 `Cmd->` → tab.next，末端回卷（M627）", async ({ page }) => {
  await twoTabs(page);

  // 已激活的是最后一个标签：next 回卷到第一个（与 ⌘} 同一条 cycleTab）。
  await page.keyboard.press("Meta+Shift+Period");
  await expect(activeTab(page)).toHaveText("alpha.md");
  await expect(page.locator(".cm-content")).toContainText("甲篇正文");

  await page.keyboard.press("Meta+Shift+Period");
  await expect(activeTab(page)).toHaveText("beta.md");
  await expect(page.locator(".cm-content")).toContainText("乙篇正文");
});

test("WKWebView 形态：`⌘⇧,` 的 key=`,` + shiftKey 命中 `Cmd-<` → tab.prev（M627 + nov27 收口）", async ({
  page,
}) => {
  await twoTabs(page);

  // change fix-tab-cycle-shift-symbols-nov27 之前这里断言的是「切不动」（表只收 Shift 后字符形态的
  // token）。WKWebView 的实际事件（合成注入通道；物理键盘未验）正是这种形态，归一后必须与
  // `Cmd-<` 同 token。
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", metaKey: true, shiftKey: true, bubbles: true }));
  });
  await expect(activeTab(page)).toHaveText("alpha.md");
  await expect(page.locator(".cm-content")).toContainText("甲篇正文");
});

test("WKWebView 形态：`⌘⇧]` 的 key=`]` + shiftKey 命中 `Cmd-}` → tab.next（nov27 收口）", async ({ page }) => {
  await twoTabs(page);

  // 与上一条同形：WKWebView 的实测事件是未按 Shift 的字符 + shiftKey（NSEvent `characters="]"`；
  // 合成注入通道，物理键盘形态未验）。
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "]", metaKey: true, shiftKey: true, bubbles: true }));
  });
  await expect(activeTab(page)).toHaveText("alpha.md");
  await expect(page.locator(".cm-content")).toContainText("甲篇正文");
});
