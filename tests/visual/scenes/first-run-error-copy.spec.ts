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
import { COPY } from "../../../src/copy-data";

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

// ---------------------------------------------------------------------------
// M858：流式事件里的**字面量 code**（`events::error("<code>", …)`）——不是 CommandError，
// 此前不在任何覆盖门禁的扫描面内，en 界面下会掉回 Rust 中文 message。
// ---------------------------------------------------------------------------

/** `turn.rs` 的两条后端中文原文（`events::error` 的第二个参数，逐字取自构造点）。 */
const INTERNAL_ERROR_MESSAGE = "对话线程发生内部错误，本轮已终止；请重试，必要时开新会话";
const EMPTY_RESPONSE_MESSAGE = "模型返回了空响应（无文本也无工具调用），本轮已停止";

test.describe("错误文案覆盖：流式事件字面量码", () => {
  test("en：内部错误与空响应都上屏英文，且不含后端技术串", async ({ page }) => {
    await openHarness(page, "en");

    // 正观测：后端原文确实是中文（下面的「不含中文」断言才有区分度）。
    expect(CJK.test(INTERNAL_ERROR_MESSAGE)).toBe(true);
    await page.evaluate(
      (payload) => (window as any).__fireHarnessEvent(payload),
      { type: "error", code: "harness_internal_error", message: INTERNAL_ERROR_MESSAGE },
    );
    const internal = page.locator(".lumir-hp-error");
    await expect(internal).toHaveCount(1);
    const internalText = (await internal.textContent()) ?? "";
    expect(CJK.test(internalText), `错误行不得含中文：${internalText}`).toBe(false);
    expect(internalText, `要给出可行动方向：${internalText}`).toMatch(/internal error/i);
    expect(internalText, `要给出可行动方向：${internalText}`).toMatch(/retry|new session/i);
    expect(internalText, `不得出现 Rust 技术串：${internalText}`).not.toMatch(/panic|stack trace|thread '/i);

    await page.evaluate(
      (payload) => (window as any).__fireHarnessEvent(payload),
      { type: "error", code: "harness_empty_response", message: EMPTY_RESPONSE_MESSAGE },
    );
    await expect(page.locator(".lumir-hp-error")).toHaveCount(2);
    const emptyText = (await page.locator(".lumir-hp-error").nth(1).textContent()) ?? "";
    expect(CJK.test(emptyText), `错误行不得含中文：${emptyText}`).toBe(false);
    expect(emptyText, `要点名空响应并给出重试方向：${emptyText}`).toMatch(/empty response/i);
    expect(emptyText, `要点名空响应并给出重试方向：${emptyText}`).toMatch(/try again/i);
    // 后端原文一个字都不该上屏。
    await expect(page.locator(".lumir-hp-transcript")).not.toContainText("模型返回了空响应");
  });

  test("zh：同两条事件上屏中文（映射是两档，不是一律英文）", async ({ page }) => {
    await openHarness(page, "zh");

    await page.evaluate(
      (payload) => (window as any).__fireHarnessEvent(payload),
      { type: "error", code: "harness_internal_error", message: INTERNAL_ERROR_MESSAGE },
    );
    const internal = page.locator(".lumir-hp-error");
    await expect(internal).toHaveCount(1);
    await expect(internal).toContainText(/内部错误/);
    await expect(internal).toContainText(/重试/);

    await page.evaluate(
      (payload) => (window as any).__fireHarnessEvent(payload),
      { type: "error", code: "harness_empty_response", message: EMPTY_RESPONSE_MESSAGE },
    );
    await expect(page.locator(".lumir-hp-error")).toHaveCount(2);
    const empty = page.locator(".lumir-hp-error").nth(1);
    await expect(empty).toContainText(/空响应/);
    await expect(empty).toContainText(/重试/);
    const text = (await empty.textContent()) ?? "";
    expect(CJK.test(text), `zh 上屏应是中文：${text}`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// M865：设置面板的装载期配置诊断（第三条信封 `ConfigDiagnostic{code, path, message}`）
//
// 这一组判的是**真实渲染结果**：诊断列表（`fillDiagnostics`）与被忽略 provider 的条目诊断都
// 从 Rust 中文 message 改为按 code 取文案表；模型行 notes 按 `harness.providers.<id>.models[<i>]`
// 前缀从同一快照取回 code。en 档任一诊断行露出中文即缺陷（M858 finding 的现场）。
// ---------------------------------------------------------------------------

/** 后端 message 的现场（逐字风格取自 `src-tauri/src/config.rs` 的 `sink.warn` / ConfigDiagnostic）。 */
const DIAG_PRESET_MESSAGE = "配置项 harness.providers 的旧条目已补齐 preset（kimi、legacy）";
const DIAG_WINDOW_MESSAGE =
  '配置项 harness.providers.kimi-work.models[0]（id "k3-256k"）的 window 应为 1..=10000000 的整数，已忽略该项';

/** 设置面快照（与 Rust `SettingsSnapshot` 的序列化形状同形；合成数据）。 */
function diagnosticSettingsSnapshot(): Record<string, unknown> {
  const models = [
    {
      id: "k3-256k",
      effort: true,
      vision: true,
      window: 262144,
      // 这一行会被装载期丢弃：notes 是 Rust message，code 在 snapshot.diagnostics 里按同一路径给。
      valid: false,
      diagnostics: [DIAG_WINDOW_MESSAGE],
      unknown_keys: [],
    },
  ];
  const namingTarget = {
    override_provider: null,
    override_model: null,
    provider_options: [{ id: "kimi-work", is_active: true, configured: true }],
    model_options: [{ id: "k3-256k", vision: true, is_effective: true }],
    resolved: {
      provider: "kimi-work",
      model: "k3-256k",
      follows_active: true,
      dangling: false,
      eligible: true,
      reason: null,
    },
  };
  const flag = { value: true, explicit: false };
  return {
    path: "/tmp/lumir-visual/config.json",
    file: { state: "valid" },
    revision: "rev-diag",
    providers: [
      {
        id: "kimi-work",
        preset: "kimi",
        raw_preset: "kimi",
        configured: true,
        status: "ok",
        api_key: { state: "set", hint: "3f9a" },
        models,
        model: "k3-256k",
        base_url: { kind: "absent" },
        wire_api: { kind: "absent" },
        effective: {
          official_base_url: "https://api.moonshot.cn/v1",
          base_url: "https://api.moonshot.cn/v1",
          wire_api: "responses",
          models: [{ id: "k3-256k", effort: true, vision: true, window: 262144 }],
        },
        references: { active: true, session_naming: false, attachment_naming: false },
        unknown_keys: [],
      },
    ],
    active: "kimi-work",
    active_explicit: true,
    automation: {
      auto_compact: flag,
      session_naming: flag,
      attachment_naming: flag,
      subagents: flag,
    },
    naming: { session: namingTarget, attachment: namingTarget },
    capabilities: {
      presets: [
        { preset: "kimi", official_base_url: "https://api.moonshot.cn/v1", supported_wire_apis: ["responses", "chat_completions"], default_wire_api: "responses", requires_api_key: true },
        { preset: "deepseek", official_base_url: "https://api.deepseek.com", supported_wire_apis: ["responses"], default_wire_api: "responses", requires_api_key: true },
        { preset: "generic", official_base_url: null, supported_wire_apis: ["chat_completions", "responses"], default_wire_api: "chat_completions", requires_api_key: false },
        { preset: "mock", official_base_url: null, supported_wire_apis: [], default_wire_api: "responses", requires_api_key: false },
      ],
      provider_id_pattern: "^[a-z0-9][a-z0-9_-]{0,31}$",
      reserved_provider_ids: ["mock"],
      provider_order: ["kimi", "deepseek", "generic", "mock"],
      model_window_min: 1,
      model_window_max: 10000000,
    },
    defaults: {
      auto_compact: true,
      session_naming_enabled: true,
      attachment_naming_enabled: true,
      subagents_enabled: true,
      model_window: 131072,
    },
    diagnostics: [
      {
        code: "harness_provider_preset_migrated",
        path: "harness.providers",
        severity: "warning",
        message: DIAG_PRESET_MESSAGE,
      },
      {
        code: "harness_model_window_invalid",
        path: "harness.providers.kimi-work.models[0]",
        severity: "reject_on_write",
        message: DIAG_WINDOW_MESSAGE,
      },
    ],
  };
}

/** 打开设置面板：`settings_get` 由本文件的 init script 覆写提供（与 m734 同口径）。 */
async function openDiagnosticSettings(page: Page, language: "en" | "zh"): Promise<void> {
  await stubTauri(page, { ...VAULT, config: { language } });
  await page.addInitScript((snapshot) => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
      if (cmd === "settings_get") return snapshot;
      return invoke(cmd, args);
    };
  }, diagnosticSettingsSnapshot());
  await page.goto("/");
  await page.locator(".modeline-language").waitFor({ state: "visible" });
  await page.keyboard.press("Meta+Comma");
  await expect(page.locator(".lumir-set-panel")).toBeVisible();
  await expect(page.locator(".lumir-set-diag-item").first()).toBeVisible();
  await expect(page.locator(".lumir-set-row-note").first()).toBeVisible();
}

test.describe("错误文案覆盖：设置面板装载期诊断", () => {
  test("en：诊断列表与模型行 notes 都是英文，后端中文 message 不上屏", async ({ page }) => {
    await openDiagnosticSettings(page, "en");

    // 正观测：后端原文确实是中文（下面的「不含中文」断言才有区分度）。
    expect(CJK.test(DIAG_PRESET_MESSAGE)).toBe(true);
    expect(CJK.test(DIAG_WINDOW_MESSAGE)).toBe(true);

    // 诊断列表（两条都在模型接入栏）：按 code 取英文列。
    const diag = page.locator(".lumir-set-diag");
    await expect(diag).toContainText(COPY.D905.en);
    await expect(diag).toContainText(COPY.D920.en);
    const diagText = (await diag.textContent()) ?? "";
    expect(CJK.test(diagText), `诊断列表不得含中文：${diagText}`).toBe(false);

    // 模型行 notes：同一份快照的诊断按 path 对齐，Rust message 不上屏。
    const note = page.locator(".lumir-set-row-note");
    await expect(note).toContainText(COPY.D920.en);
    await expect(note).not.toContainText("窗口");
    const noteText = (await note.textContent()) ?? "";
    expect(CJK.test(noteText), `模型行 notes 不得含中文：${noteText}`).toBe(false);
  });

  test("zh：同一现场上屏中文（映射是两档，不是「一律英文」）", async ({ page }) => {
    await openDiagnosticSettings(page, "zh");

    const diag = page.locator(".lumir-set-diag");
    await expect(diag).toContainText(COPY.D905.zh);
    await expect(diag).toContainText(COPY.D920.zh);

    const note = page.locator(".lumir-set-row-note");
    await expect(note).toContainText(COPY.D920.zh);
    const noteText = (await note.textContent()) ?? "";
    expect(CJK.test(noteText), `zh 下模型行 notes 应是中文：${noteText}`).toBe(true);
    // 后端原文（含读数与 Rust 措辞）不得逐字上屏——诊断文案来自 deck。
    expect(noteText).not.toContain(DIAG_WINDOW_MESSAGE);
  });
});
