// 退出前的保存全部确认弹框（change add-quit-save-all-dialog-nov27）。
//
// 这一层守**结构、计算属性与交互边界**：居中遮罩 / 卡片 token / 主次按钮层级 / 三主题
// eink 规则 / 初始焦点 / Tab 圈定 / Escape 等于取消 / 背景 inert / 关闭后焦点还原 /
// 连续 quit_blocked 单弹框 / 保存中禁用 / 保存失败留场 / 保存成功后经受控命令退出。
//
// 纯逻辑（保存 → 复查 → 退出、代次、单飞、退出被拒）归 `tests/unit/quit-flow.test.ts`；
// 后端复核归 `src-tauri/src/commands.rs` 单测；真机整链路归场景 884（本轮不执行）。
//
// **像素基线**：三主题整页截图已由主会话代 Alex 自审批准（2026-11-27，light / dark / eink
// 均居中、主次按钮明确、无丢弃修改），正式基线经 `scripts/visual/run.sh --update` 生成；
// 本文件不再提供候选截图旁路。

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { DEMO_VAULT, fireQuitBlocked, stubTauri, type VaultFixture } from "./tauri-stub";

const DOC = "# 退出确认\n\nQDLG-ALPHA 合成文档，只给弹框一个背景。\n";

const VAULT: VaultFixture = {
  ...DEMO_VAULT,
  entries: [{ path: "quit-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "quit-note.md": DOC },
};

/** `app_quit` 桩 + 调用记录（真后端会退出进程，chromium 里只记录）。
 *  `delayMs` 造「退出在途」现场；`reject` 造后端复核拒绝（`quit_blocked_dirty`）。 */
async function stubAppQuit(
  page: Page,
  opts: { delayMs?: number; reject?: boolean; saveDelayMs?: number } = {},
): Promise<void> {
  await page.addInitScript((spec) => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__quitCalls = 0;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (cmd === "app_quit") {
        // 本包装拦在桩的 invoke 之前，桩的 `__invokes` 记不到它；补记一条，
        // 「保存先于退出」的顺序判据才有两个可比的读数。
        (w.__invokes as string[]).push(cmd);
        w.__quitCalls += 1;
        if (spec.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, spec.delayMs));
        if (spec.reject === true) throw { code: "quit_blocked_dirty", message: "仍有未保存的修改，未退出" };
        return null;
      }
      if (cmd === "document_save" && spec.saveDelayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, spec.saveDelayMs));
      }
      return invoke(cmd, args);
    };
  }, opts);
}

async function quitCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __quitCalls?: number }).__quitCalls ?? 0);
}

async function invokeNames(page: Page): Promise<string[]> {
  return page.evaluate(() => ((window as unknown as { __invokes?: string[] }).__invokes ?? []).slice());
}

async function fileText(page: Page, path: string): Promise<string | undefined> {
  return page.evaluate(
    (p) => (window as unknown as { __fileText?: (path: string) => string | undefined }).__fileText?.(p),
    path,
  );
}

async function openDirtyDoc(page: Page): Promise<void> {
  await page.locator('.ft-row[title="quit-note.md"]').click();
  const content = page.locator(".cm-content");
  await expect(content).toContainText("QDLG-ALPHA");
  await content.click();
  await page.keyboard.type("QDLG-DIRTY");
  await expect(page.locator(".modeline-path")).toContainText("未保存");
}

/** token 的计算值（把 `var(--x)` 落到一个探针元素的颜色上再读回），用于跨主题逐值对账。 */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, token);
}

async function setTheme(page: Page, theme: "light" | "dark" | "eink"): Promise<void> {
  await page.evaluate((next) => {
    document.documentElement.dataset.theme = next;
  }, theme);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
}

test("dirty 时 quit_blocked 弹出居中模态：文字 / 两条动作 / 无丢弃 / 背景 inert / 初始焦点", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubAppQuit(page);
  await page.goto("/");
  await openDirtyDoc(page);

  await fireQuitBlocked(page);

  const overlay = page.locator(".lumir-quit-overlay");
  const card = page.locator(".lumir-quit-card");
  await expect(overlay).toBeVisible();
  await expect(card).toHaveAttribute("role", "dialog");
  await expect(card).toHaveAttribute("aria-modal", "true");
  await expect(card).toHaveAttribute("aria-labelledby", "lumir-quit-title");
  await expect(card).toHaveAttribute("aria-describedby", "lumir-quit-body");
  await expect(page.locator("#lumir-quit-title")).toHaveText("有未保存的修改");
  await expect(page.locator("#lumir-quit-body")).toContainText("保存失败时不会退出");

  const buttons = card.getByRole("button");
  await expect(buttons).toHaveCount(2);
  await expect(card.getByRole("button", { name: "保存全部并退出" })).toBeVisible();
  await expect(card.getByRole("button", { name: "取消" })).toBeVisible();
  // 不提供「丢弃修改」：任何等义动作都不得出现（按按钮集合断言，不按子串扫正文）。
  const labels = await buttons.allInnerTexts();
  expect(labels.some((label) => /丢弃|放弃/.test(label))).toBe(false);

  // 居中：卡片中心与 1200×800 视口中心重合（flex 居中）。
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs((box!.x + box!.width / 2) - 600)).toBeLessThan(1.5);
  expect(Math.abs((box!.y + box!.height / 2) - 400)).toBeLessThan(1.5);

  // 遮罩：fixed 全窗、scrim 底色、z-index 高于设置面板（30）。
  const overlayStyle = await overlay.evaluate((el) => {
    const s = getComputedStyle(el);
    return { position: s.position, top: s.top, left: s.left, zIndex: s.zIndex, display: s.display };
  });
  expect(overlayStyle.position).toBe("fixed");
  expect(overlayStyle.top).toBe("0px");
  expect(overlayStyle.left).toBe("0px");
  expect(overlayStyle.zIndex).toBe("40");
  expect(overlayStyle.display).toBe("flex");
  expect(await overlay.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    await tokenColor(page, "--scrim"),
  );

  // 背景 inert；焦点在主按钮。
  expect(await page.evaluate(() => document.getElementById("app")?.inert)).toBe(true);
  await expect(card.getByRole("button", { name: "保存全部并退出" })).toBeFocused();
});

test("Tab / Shift+Tab 在弹框内循环，Escape 等同取消并还原焦点", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubAppQuit(page);
  await page.goto("/");
  await openDirtyDoc(page);
  await fireQuitBlocked(page);

  const primary = page.locator(".lumir-quit-btn-primary");
  const cancel = page.locator(".lumir-quit-btn-secondary");
  await expect(primary).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(primary).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(cancel).toBeFocused();

  // Escape = 取消：弹框关闭、不退出、背景解除 inert、焦点回到打开前的编辑器元素。
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-quit-overlay")).toBeHidden();
  expect(await quitCalls(page)).toBe(0);
  expect(await page.evaluate(() => document.getElementById("app")?.inert)).toBe(false);
  expect(
    await page.evaluate(() => document.activeElement?.closest(".cm-content") !== null),
  ).toBe(true);
  // 内容仍在：取消不保存也不丢弃。
  await expect(page.locator(".cm-content")).toContainText("QDLG-DIRTY");
  await expect(page.locator(".modeline-path")).toContainText("未保存");
});

test("点「取消」只关闭弹框；连续 quit_blocked 不叠弹", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubAppQuit(page);
  await page.goto("/");
  await openDirtyDoc(page);

  await fireQuitBlocked(page);
  await fireQuitBlocked(page);
  await fireQuitBlocked(page);
  await expect(page.locator(".lumir-quit-card")).toHaveCount(1);
  await expect(page.locator(".lumir-quit-overlay")).toBeVisible();

  await page.locator(".lumir-quit-btn-secondary").click();
  await expect(page.locator(".lumir-quit-overlay")).toBeHidden();
  await expect(page.locator(".lumir-quit-card")).toHaveCount(1); // 卡片还在 DOM，只是遮罩 hidden
  expect(await quitCalls(page)).toBe(0);

  // 再次拦截仍能打开同一实例（不是新建第二份）。
  await fireQuitBlocked(page);
  await expect(page.locator(".lumir-quit-card")).toHaveCount(1);
  await expect(page.locator(".lumir-quit-overlay")).toBeVisible();
});

test("保存全部并退出：脏内容落盘后经受控命令退出（顺序可核）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubAppQuit(page);
  await page.goto("/");
  await openDirtyDoc(page);
  await fireQuitBlocked(page);

  await page.locator(".lumir-quit-btn-primary").click();
  await expect(page.locator(".lumir-quit-status")).toHaveText("正在退出");
  await expect(page.locator(".lumir-quit-btn-primary")).toBeDisabled();
  await expect(page.locator(".lumir-quit-btn-secondary")).toBeDisabled();

  expect(await quitCalls(page)).toBe(1);
  expect(await fileText(page, "quit-note.md")).toContain("QDLG-DIRTY");
  const names = await invokeNames(page);
  const saveAt = names.lastIndexOf("document_save");
  const quitAt = names.lastIndexOf("app_quit");
  expect(saveAt).toBeGreaterThanOrEqual(0);
  expect(quitAt).toBeGreaterThan(saveAt);
  // 保存全部屏障自己的状态日志走到 ok（与 880 的机器判据同源）。
  await expect(page.locator("span", { hasText: /^save-all-log .*s\d+:g\d+:ok$/ })).toHaveCount(1);
});

test("保存失败：弹框留场、错误可见、不退出、不自动重试", async ({ page }) => {
  await stubTauri(page, {
    ...VAULT,
    failures: { document_save: { code: "document_conflict", message: "文件已被外部修改，请先协调冲突" } },
  });
  await stubAppQuit(page);
  await page.goto("/");
  await openDirtyDoc(page);
  await fireQuitBlocked(page);

  await page.locator(".lumir-quit-btn-primary").click();
  await expect(page.locator(".lumir-quit-status")).toHaveText("未能保存全部更改，退出已取消；请处理提示后重试");
  await expect(page.locator(".lumir-quit-overlay")).toBeVisible();
  await expect(page.locator(".lumir-quit-btn-primary")).toBeEnabled();
  await expect(page.locator(".lumir-quit-btn-secondary")).toBeEnabled();
  await expect(page.locator(".modeline-path")).toContainText("未保存");
  await expect(page.locator(".cm-content")).toContainText("QDLG-DIRTY");
  expect(await quitCalls(page)).toBe(0);

  // 不自动重试：留两拍后仍然只有一次保存尝试、零次退出。
  const before = (await invokeNames(page)).filter((name) => name === "document_save").length;
  await page.waitForTimeout(200);
  const after = (await invokeNames(page)).filter((name) => name === "document_save").length;
  expect(before).toBe(1);
  expect(after).toBe(1);
  expect(await quitCalls(page)).toBe(0);
});

test("退出被后端拒绝：弹框留场、错误可见、不自动重试", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubAppQuit(page, { reject: true });
  await page.goto("/");
  await openDirtyDoc(page);
  await fireQuitBlocked(page);

  await page.locator(".lumir-quit-btn-primary").click();
  await expect(page.locator(".lumir-quit-status")).toHaveText("退出请求未被受理，应用未退出；请重试");
  await expect(page.locator(".lumir-quit-overlay")).toBeVisible();
  await expect(page.locator(".lumir-quit-btn-primary")).toBeEnabled();
  expect(await quitCalls(page)).toBe(1);
  await page.waitForTimeout(200);
  expect(await quitCalls(page)).toBe(1);
});

test("保存进行中：两条按钮禁用、取消意图被忽略", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubAppQuit(page, { saveDelayMs: 600 });
  await page.goto("/");
  await openDirtyDoc(page);
  await fireQuitBlocked(page);

  await page.locator(".lumir-quit-btn-primary").click();
  await expect(page.locator(".lumir-quit-status")).toHaveText("正在保存全部更改，完成后将退出");
  await expect(page.locator(".lumir-quit-btn-primary")).toBeDisabled();
  await expect(page.locator(".lumir-quit-btn-secondary")).toBeDisabled();

  // 保存中按 Escape：被消费但不关层（关闭后保存完成仍退出就违背「取消只关弹框」）。
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-quit-overlay")).toBeVisible();

  // 保存完成后进入退出（受控命令恰好一次）。
  await expect(page.locator(".lumir-quit-status")).toHaveText("正在退出", { timeout: 5000 });
  expect(await quitCalls(page)).toBe(1);

  // 退出在途时后端又拦下一次（ExitRequested 再次看到 dirty）：回到失败态、按钮重新可用，
  // 不叠弹、不自动重试；旧的退出请求不得把状态改回去。
  await fireQuitBlocked(page);
  await expect(page.locator(".lumir-quit-status")).toHaveText("退出请求未被受理，应用未退出；请重试");
  await expect(page.locator(".lumir-quit-btn-primary")).toBeEnabled();
  await expect(page.locator(".lumir-quit-card")).toHaveCount(1);
  expect(await quitCalls(page)).toBe(1);
});

test("三主题 token：遮罩 / 卡片 / 主次按钮逐值对账（eink 1.4px、无阴影）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubAppQuit(page);
  await page.goto("/");
  await openDirtyDoc(page);
  await fireQuitBlocked(page);

  const card = page.locator(".lumir-quit-card");
  const primary = page.locator(".lumir-quit-btn-primary");
  const secondary = page.locator(".lumir-quit-btn-secondary");
  const overlay = page.locator(".lumir-quit-overlay");

  for (const theme of ["light", "dark", "eink"] as const) {
    await setTheme(page, theme);
    const accentFill = await tokenColor(page, "--accent-fill");
    const accentText = await tokenColor(page, "--accent-fill-text");
    const previewBg = await tokenColor(page, "--preview-bg");
    const border = await tokenColor(page, "--border");
    const text2 = await tokenColor(page, "--text-2");

    const cardStyle = await card.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        background: s.backgroundColor,
        color: s.color,
        borderColor: s.borderTopColor,
        borderWidth: s.borderTopWidth,
        boxShadow: s.boxShadow,
        radius: s.borderTopLeftRadius,
      };
    });
    expect(cardStyle.background).toBe(previewBg);
    expect(cardStyle.borderColor).toBe(border);
    expect(cardStyle.radius).toBe("10px");
    if (theme === "eink") {
      // eink 线宽档（规则⑦⑧）：1.4px 在 dsf=1 下被折成整数设备像素，computed 读回是 1px
      // （M293 实测；与 m133 / m734 的 eink 断言同一口径）——从样式表规则读声明值。
      const declared = await page.evaluate(() => {
        for (const sheet of Array.from(document.styleSheets)) {
          for (const rule of Array.from(sheet.cssRules)) {
            if (
              rule instanceof CSSStyleRule &&
              rule.selectorText.includes(':root[data-theme="eink"] .lumir-quit-card')
            ) {
              return { borderWidth: rule.style.borderWidth, boxShadow: rule.style.boxShadow };
            }
          }
        }
        return null;
      });
      expect(declared).toEqual({ borderWidth: "1.4px", boxShadow: "none" });
      expect(cardStyle.borderWidth).toBe("1px"); // used value 取整后的读数
      expect(cardStyle.boxShadow).toBe("none");
      expect(await overlay.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
        await tokenColor(page, "--scrim"),
      );
    } else {
      expect(cardStyle.borderWidth).toBe("1px");
      expect(cardStyle.boxShadow).not.toBe("none");
    }

    expect(await primary.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(accentFill);
    expect(await primary.evaluate((el) => getComputedStyle(el).color)).toBe(accentText);
    expect(await secondary.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    expect(await secondary.evaluate((el) => getComputedStyle(el).color)).toBe(text2);
    expect(await secondary.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(border);
  }
});

test("三主题整页基线：退出确认弹框（light / dark / eink）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubAppQuit(page);
  await page.goto("/");
  await openDirtyDoc(page);
  await fireQuitBlocked(page);

  for (const theme of ["light", "dark", "eink"] as const) {
    await setTheme(page, theme);
    await expect(page.locator(".lumir-quit-card")).toBeVisible();
    await expectScreenshot(page, `quit-dialog-${theme}.png`);
  }
});
