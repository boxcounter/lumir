import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M303 对话面板（change add-harness-probe）的表面基线；M346/HP1（change
// move-harness-to-pane-chat-frame）改写为 pane 口径：
//
//   1. **面板是 pane 内容件**——⌘⇧A/toggle 自动分栏（harness:文档 = 1:2），面板挂进旁侧
//      pane 的挂载元素；dock 列（--layout-dock-w / .dock-open）已移除，骨架回到两列。
//   2. **面板无头部栏**——会话身份（名下拉 + 新建会话钮）在标题栏 harness 段（.lumir-hp-seg），
//      段宽与 pane 比分宽、与分隔条对齐；ctx% 读数随头部栏退场（M347 已迁入 composer 控制行，
//      M351 图标化发送钮：钮面 SVG glyph，文案在 title/aria-label）。
//   3. **标题栏右簇**——产品标识块在 traffic 灯区内（系统按钮旁）；双 pane 时 harness
//      toggle 钮隐藏（退让条款），⌘⇧A 照走。
//   4. 行为层（发送、工具循环、批准闸）不在这里——归验收套件场景 70–77（真机 WKWebView
//      + mock provider）；这里只钉结构、在场性与像素锚。
//
// 面板打开是纯前端路径（装配层 split + attachTo），不触后端 invoke，stub 环境下即可展开。

const DOC = "# 面板基线笔记\n\n第一段，给上下文 chip 一个视口口径。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

/** `harness_state` 的零态桩：与 Rust `StateSnapshot::empty` 同形（session.rs：messages 空、
 *  usage 零值、pending_approval null、warn_ctx_pct 85）。真后端对新会话返回的就是这份；
 * 通用 stub 不认识 harness_* 命令，不补这条桩 transcript 会停在未初始化态——那不是用户看到
 * 的空会话形态（HP1 起用量读数随头部栏退场，本条桩只为 messages 空态服务）。 */
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

test("对话面板：pane 口径展开态结构 + 标题栏元素级基线", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarnessState(page);
  await page.goto("/");

  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");

  const panel = page.locator(".lumir-harness");
  const toggle = page.locator(".lumir-hp-toggle");
  // 收起态：面板未挂进 DOM（pane 不在场）、toggle 未按下——展开基线的对照起点。
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await toggle.click();
  // pane 口径的在场性正观测（像素基线的语义锚——基线里到底有什么，断言行说了算）：
  // 面板挂进**旁侧 pane**（dock 列已移除：骨架两列、无 dock-open 类），harness 段随在场
  // 出现在标题栏（会话名缺省「新会话」+ ＋新会话钮），面板无头部栏（.lumir-hp-head 零残留）。
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".lumir-hp-head")).toHaveCount(0);
  await expect(page.locator(".pane-divider")).toBeVisible();
  const shellCols = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell") as HTMLElement;
    return getComputedStyle(shell).gridTemplateColumns.split(" ").length;
  });
  expect(shellCols).toBe(2);
  await expect(page.locator(".app-shell")).not.toHaveClass(/dock-open/);
  // 默认宽度比 harness:文档 = 1:2（Alex 裁决）——分栏后文档 pane 宽约为 harness pane 两倍。
  const panes = await page.locator(".pane-editor > .editor-pane").all();
  const paneBoxes = await Promise.all(panes.map((pane) => pane.boundingBox()));
  const widths = paneBoxes.map((box) => box?.width ?? 0);
  expect(widths.length).toBe(2);
  expect(widths[0] / widths[1]).toBeGreaterThan(1.8);
  expect(widths[0] / widths[1]).toBeLessThan(2.2);
  // harness 段：与编辑器标签段同构（会话名 + 新建会话钮；段宽由比分宽、与分隔条对齐——
  // 这里钉在场与内容，对齐的几何钉在 m320 的分栏结构断言里）。
  const seg = page.locator(".lumir-hp-seg");
  await expect(seg).toBeVisible();
  await expect(seg.locator(".lumir-hp-sname")).toHaveText("新会话");
  await expect(seg.locator(".lumir-hp-seg-new")).toContainText("新会话");
  // 双 pane 右簇退让：harness toggle 钮隐藏（标题栏腾给标签段与 harness 段按比分宽）。
  await expect(toggle).toBeHidden();
  // 面板区块：空态提示、chip（视口口径）、composer、发送钮。
  await expect(page.locator(".lumir-hp-empty")).toContainText("与当前文档对话");
  await expect(page.locator(".lumir-hp-chip")).toContainText("上下文：harness-note.md · 视口");
  await expect(page.locator(".lumir-hp-composer")).toBeFocused();
  // M351 图标化：钮面是 SVG glyph（↑/■ 两态 [hidden] 切换），文案落 title/aria-label（D329）。
  const send = page.locator(".lumir-hp-send");
  await expect(send).toHaveAttribute("aria-label", "发送");
  await expect(send.locator(".lumir-hp-send-go")).toBeVisible();
  await expect(send.locator(".lumir-hp-send-stop")).toBeHidden();
  // 产品标识块在 traffic 灯区内（系统按钮旁），双 pane 也不退 modeline（右簇退让只剩 toggle）。
  await expect(
    page.locator(".titlebar-traffic .titlebar-identity"),
  ).toBeVisible();

  // 会话名下拉浮层（节点 1 裁决：只含「新建会话」一个动作项，不列历史）。
  await page.locator(".lumir-hp-session").click();
  const pop = page.locator(".lumir-hp-sesspop");
  await expect(pop).toBeVisible();
  await expect(pop.locator(".lumir-hp-sesspop-item")).toHaveCount(1);
  await expect(pop.locator(".lumir-hp-sesspop-item")).toContainText("新会话");
  // 浮层外交互收起。
  await page.locator(".lumir-hp-transcript").click();
  await expect(pop).toBeHidden();

  // 整页基线：harness 在场态全表面（pane 分栏形态、面板区块、标题栏三段）。
  await expectScreenshot(page, "harness-panel-open.png");

  // 元素级基线：标题栏 = traffic 灯区（含产品标识块）+ 标签段 + harness 段。
  await expectScreenshot(page.locator(".titlebar"), "titlebar-with-harness-toggle.png");

  // 收起（⌘⇧A 命令路径——焦点在浮层交互后已离开面板，命令路径与焦点无关）：pane 收拢、
  // 文档标签不丢、段随退场隐藏。
  await page.keyboard.press("Meta+Shift+A");
  await expect(panel).toBeHidden();
  await expect(page.locator(".lumir-hp-seg")).toBeHidden();
  await expect(page.locator(".pane-divider")).toHaveCount(0);
  await expect(page.locator(".tabstrip .tab")).toContainText(["harness-note.md"]);
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});
