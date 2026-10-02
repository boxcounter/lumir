import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M303 对话面板（change add-harness-probe）的新表面基线。为什么单开这个场景：
//
//   1. **面板展开态是新表面，此前没有任何基线守它**——dock 列从 0px 撑到
//      --layout-dock-w，整页布局整体左移，只有一张「展开态整页基线」能钉住这个形态
//     （宽度 token、边框、内部区块的相对位置任何一处漂移都会红）。
//   2. **标题栏动作钮槽位只有元素级 crop 守得住**：toggle 钮 30×29px，整页 0.001 容差
//      （1200×800 ≈ 960px）吞得掉它（REVIEW.md 第 3 条，m149 标签栏两次实证同族）。
//   3. 行为层（发送、工具循环、批准闸）不在这里——归验收套件场景 70–77（真机 WKWebView
//      + mock provider）；这里只钉像素与在场性。
//
// 面板打开是纯前端路径（setOpen：dock-open 类 + hidden 翻转 + chip 刷新 + 焦点移交），
// 不触后端 invoke，stub 环境下即可展开。

const DOC = "# 面板基线笔记\n\n第一段，给上下文 chip 一个视口口径。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

/** `harness_state` 的零态桩：与 Rust `StateSnapshot::empty` 同形（session.rs：messages 空、
 *  usage 零值、pending_approval null、warn_ctx_pct 85）。真后端对新会话返回的就是这份
 *  （真机场景 76 实测首帧 `ctx 0% · cache 0%`）；通用 stub 不认识 harness_* 命令，
 *  不补这条桩用量条会停在「未初始化」的空串——那不是用户看到的形态。 */
async function stubHarnessState(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct: 0 },
          pending_approval: null,
          warn_ctx_pct: 85,
        });
      }
      return invoke(cmd, args);
    };
  });
}

test("对话面板：展开态整页基线 + 标题栏元素级基线", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarnessState(page);
  await page.goto("/");

  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");

  const panel = page.locator(".lumir-harness");
  const toggle = page.locator(".lumir-hp-toggle");
  // 收起态：面板 hidden、toggle 未按下——展开基线的对照起点。
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await toggle.click();
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // 在场性正观测（像素基线的语义锚——基线里到底有什么，断言行说了算）：
  // 头部标题 / 用量条零值 / 新会话钮、空态提示、chip（视口口径）、composer、发送钮。
  await expect(page.locator(".lumir-hp-title")).toHaveText("对话");
  await expect(page.locator(".lumir-hp-usage")).toHaveText("ctx 0% · cache 0%");
  await expect(page.locator(".lumir-hp-newsession")).toHaveText("新会话");
  await expect(page.locator(".lumir-hp-empty")).toContainText("与当前文档对话");
  await expect(page.locator(".lumir-hp-chip")).toContainText("上下文：harness-note.md · 视口");
  await expect(page.locator(".lumir-hp-composer")).toBeFocused();
  await expect(page.locator(".lumir-hp-send")).toHaveText("发送");
  // dock 列真的撑开了（不是浮层覆盖）：网格列宽切到 --layout-dock-w。
  await expect(page.locator(".app-shell")).toHaveClass(/dock-open/);

  // 整页基线：面板展开态全表面（dock 列宽、面板区块、被挤压的编辑区整体形态）。
  await expectScreenshot(page, "harness-panel-open.png");

  // 元素级基线：标题栏 = traffic 灯位 + toggle 钮 + 标识块（动作钮槽位的像素钉）。
  await expectScreenshot(page.locator(".titlebar"), "titlebar-with-harness-toggle.png");
});
