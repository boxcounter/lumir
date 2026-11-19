// M852 — 首次安装的错误上屏（M849 finding 两条）：harness 错误行绕过文案表、设置面板
// 非法 provider id 未本地化。
//
// 这一层判的是**真实渲染结果**（chromium + 真机同款 UA 的 WebKit 双引擎），不是纯函数的
// 返回值：`src/harness-panel.ts` 的三处调用点各自拼装过 `t()` 与 `errorText()`，纯函数单测
// 证不了「面板实际拼出来的那一行是什么」。
//
// 判据形态（REVIEW.md「断言等价于子串」条）：每条负向断言（不含中文 / 不含内部 URL）都配一条
// 正观测（同一屏里英文 / 中文确实上屏、后端原文确实带 URL），否则负向断言恒真。

import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

const DOC = "# 首次安装错误文案\n\n第一段，给上下文 chip 一个视口口径。\n";

const VAULT: VaultFixture = {
  root: "/mock/vault",
  vault_id: "v1",
  files: { "note.md": DOC },
  entries: [{ path: "note.md", name: "note.md", kind: "file" }],
  links: {},
};

/** 没有可用 provider 时 `harness_send` 的同步拒绝（信封与 `send_preflight` 逐字同形）。 */
const PROVIDER_MISSING = {
  code: "harness_provider_missing",
  message:
    "还没有可用的 provider：请在设置面板添加一个 provider（或检查 config.json 的 harness.providers 条目是否合法）",
};

/** 网络失败的**流式**错误：事件只有 `{code, message}`，message 带内部端点与 reqwest 原始串。 */
const NETWORK_MESSAGE =
  "LLM 请求发送失败：error sending request for url (http://127.0.0.1:9/v1/chat/completions)";

/** CJK 统一表意文字：en 上屏出现任何一个都算漏译。 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * 开面板并准备好可发送的空会话。
 *
 * `failures` 是 tauri-stub 的通用失败注入（信封原样抛出，与真后端同形）；`harness_state` /
 * `harness_list_sessions` 补零态桩（同 m303 的口径——通用桩不认识 harness_* 命令）。
 * 顺带把 `plugin:event|listen` 的 handler id 记下来，供 `__fireHarnessEvent` 驱动流式事件：
 * 流式错误不走 invoke，桩没有「后端 emit」的通道，只能按 @tauri-apps/api 的真实形状回调。
 */
async function openHarness(
  page: Page,
  language: "en" | "zh",
  failures?: Record<string, { code: string; message: string; params?: Record<string, unknown> }>,
): Promise<void> {
  await stubTauri(page, { ...VAULT, config: { language }, failures });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__harnessListeners = [] as number[];
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approval: null,
          warn_ctx_pct: 85,
        });
      }
      if (cmd === "harness_list_sessions") return JSON.stringify([]);
      const result = await invoke(cmd, args);
      if (cmd === "plugin:event|listen" && args !== null && args.event === "harness:event") {
        (w.__harnessListeners as number[]).push(args.handler as number);
      }
      return result;
    };
    w.__fireHarnessEvent = (payload: unknown) => {
      for (const id of w.__harnessListeners as number[]) {
        w.__TAURI_INTERNALS__.runCallback(id, { event: "harness:event", id, payload });
      }
    };
  });
  await page.goto("/");
  await page.locator('.ft-row[title="note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-hp-composer .cm-content")).toBeFocused();
  await expect.poll(async () => page.evaluate(() => (window as any).__harnessListeners.length)).toBeGreaterThan(0);
}

/** 发一条消息（发送会被 stub 拒绝，本组用例判的就是拒绝后的那行文案）。 */
async function sendAndExpectError(page: Page): Promise<void> {
  const composer = page.locator(".lumir-hp-composer .cm-content");
  await composer.click();
  await page.keyboard.type("ping");
  await page.locator(".lumir-hp-send").click();
  await expect(page.locator(".lumir-hp-error")).toHaveCount(1);
}

test.describe("首次安装错误文案：harness 错误行", () => {
  test("en：无 provider 的发送失败行是英文、可行动，且不出现后端中文原文", async ({ page }) => {
    await openHarness(page, "en", { harness_send: PROVIDER_MISSING });
    await sendAndExpectError(page);

    const line = page.locator(".lumir-hp-error");
    await expect(line).toContainText(/send failed/i);
    await expect(line).toContainText(/settings/i);
    // 正观测：后端原文确实是中文（下面的「不含中文」断言才有区分度）。
    expect(CJK.test(PROVIDER_MISSING.message)).toBe(true);
    const text = (await line.textContent()) ?? "";
    expect(CJK.test(text), `错误行不得含中文：${text}`).toBe(false);
    // 后端 message 一个字都不该上屏。
    await expect(page.locator(".lumir-hp-transcript")).not.toContainText("还没有可用的 provider");
  });

  test("zh：同一现场上屏中文（映射是两档，不是「一律英文」）", async ({ page }) => {
    await openHarness(page, "zh", { harness_send: PROVIDER_MISSING });
    await sendAndExpectError(page);

    const line = page.locator(".lumir-hp-error");
    await expect(line).toContainText(/发送失败/);
    await expect(line).toContainText(/设置面板/);
    await expect(page.locator(".lumir-hp-transcript")).not.toContainText("config.json");
  });

  test("en：流式网络错误不把内部 URL / reqwest 原始串送上屏", async ({ page }) => {
    await openHarness(page, "en");
    await page.evaluate(
      (payload) => (window as any).__fireHarnessEvent(payload),
      { type: "error", code: "harness_network_failed", message: NETWORK_MESSAGE },
    );
    const line = page.locator(".lumir-hp-error");
    await expect(line).toHaveCount(1);

    // 正观测：后端原文确实带内部端点与 reqwest 串（负向断言的前提）。
    expect(NETWORK_MESSAGE).toContain("http://127.0.0.1:9");
    expect(NETWORK_MESSAGE).toContain("error sending request");

    const text = (await line.textContent()) ?? "";
    expect(CJK.test(text), `错误行不得含中文：${text}`).toBe(false);
    expect(text, `不得出现内部 URL：${text}`).not.toContain("127.0.0.1");
    expect(text, `不得出现 URL 协议头：${text}`).not.toMatch(/https?:\/\//i);
    expect(text, `不得出现 reqwest 原始串：${text}`).not.toMatch(/error sending request/i);
    expect(text, `要给出可行动方向：${text}`).toMatch(/network|provider/i);
  });

  test("zh：流式网络错误同样不插内部 URL", async ({ page }) => {
    await openHarness(page, "zh");
    await page.evaluate(
      (payload) => (window as any).__fireHarnessEvent(payload),
      { type: "error", code: "harness_network_failed", message: NETWORK_MESSAGE },
    );
    const line = page.locator(".lumir-hp-error");
    await expect(line).toHaveCount(1);
    await expect(line).toContainText(/LLM 请求发送失败/);
    const text = (await line.textContent()) ?? "";
    expect(CJK.test(text), `zh 上屏应是中文：${text}`).toBe(true);
    expect(text, `不得出现内部 URL：${text}`).not.toContain("127.0.0.1");
    expect(text, `不得出现 reqwest 原始串：${text}`).not.toMatch(/error sending request/i);
  });
});
