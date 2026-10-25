// 设置面板的视觉 / 结构场景（change add-model-automation-settings-oct24 tasks §7.5）。
//
// 这一层守**结构、计算属性与交互边界**：单页两节（无 TAB）、面板落位与不溢出（O1/O2）、
// 三主题的描边配方、焦点圈定、保存中禁用、错误按 path 回填的 ARIA、删除保护三块的出现
// 判据、命名目标「关闭禁用但保留」与一行生效说明。
//
// **像素基线待批**：本 mission 的新场景还没有经 Alex 过目的基线（基线更新是人肉裁决点，
// tests/visual/README.md），因此这里不调 `expectScreenshot`——候选截图由 mission 报告附上，
// 批准后另起一批补像素断言与基线。结构断言照常进 CI（`LUMIR_VISUAL_STRUCTURAL=1` 只关像素，
// 不关这些断言）。
//
// 桩：`settings_get` / `settings_apply` 由本文件在 `stubTauri` 之后包一层 invoke 覆写来提供
// （设置面是独立快照，不从 `config_get` 推导）。`settings_apply` 的行为按用例注入：
// applied / blocked / pending（保存中）。

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { stubTauri, type VaultFixture } from "./tauri-stub";

const DOC = "# 设置面板\n\n合成文档，只给面板一个背景。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "settings-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "settings-note.md": DOC },
  links: {},
};

// ---------------------------------------------------------------------------
// 设置面快照（与 Rust `SettingsSnapshot` 的序列化形状同形；合成数据）
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function modelDraft(id: string, effort: boolean, vision: boolean, window: number): Json {
  return { id, effort, vision, window, valid: true, diagnostics: [], unknown_keys: [] };
}

function provider(id: string, preset: string, fields: Json = {}): Json {
  const models = (fields.models as Json[] | undefined) ?? [modelDraft("k3-256k", true, true, 262144)];
  return {
    id,
    preset,
    raw_preset: preset,
    configured: true,
    status: "ok",
    api_key: { state: "set", hint: "3f9a" },
    models,
    model: (fields.model as string | undefined) ?? (models[0]?.id as string) ?? "",
    base_url: { kind: "absent" },
    wire_api: { kind: "absent" },
    effective: {
      official_base_url: preset === "kimi" ? "https://api.moonshot.cn/v1" : null,
      base_url: preset === "kimi" ? "https://api.moonshot.cn/v1" : null,
      wire_api: "responses",
      models,
    },
    references: { active: false, session_naming: false, attachment_naming: false },
    unknown_keys: [],
    ...fields,
  };
}

function namingTarget(providers: Array<{ id: string; active: boolean }>, override: { provider: string | null; model: string | null }): Json {
  const target = override.provider ?? providers.find((item) => item.active)?.id ?? providers[0]?.id ?? null;
  return {
    override_provider: override.provider,
    override_model: override.model,
    provider_options: providers.map((item) => ({ id: item.id, is_active: item.active, configured: true })),
    model_options: [
      { id: "k3-256k", vision: true, is_effective: true },
      { id: "k3-128k", vision: false, is_effective: false },
    ],
    resolved: {
      provider: target,
      model: "k3-256k",
      follows_active: override.provider === null,
      dangling: false,
      eligible: true,
      reason: null,
    },
  };
}

function settingsSnapshot(overrides: Json = {}): Json {
  const {
    providers: providerOverride,
    active: activeOverride,
    naming: namingOverride,
    automation: automationOverride,
    ...rest
  } = overrides;
  const providers = (providerOverride as Json[] | undefined) ?? [
    provider("kimi-work", "kimi"),
    provider("local-lab", "generic", {
      model: "local-chat",
      models: [modelDraft("local-chat", false, false, 131072)],
    }),
  ];
  const active = activeOverride !== undefined ? (activeOverride as string | null) : ((providers[0]?.id as string) ?? null);
  const namingOverrides = (namingOverride ?? {}) as { session?: Json; attachment?: Json };
  const identities = providers.map((item) => ({ id: item.id as string, active: item.id === active }));
  const withRefs = providers.map((item) => ({
    ...item,
    references: {
      active: item.id === active,
      session_naming: namingOverrides.session?.provider === item.id,
      attachment_naming: namingOverrides.attachment?.provider === item.id,
    },
  }));
  return {
    path: "/tmp/lumir-visual/config.json",
    file: { state: "valid" },
    revision: "rev-visual",
    providers: withRefs,
    active,
    active_explicit: true,
    automation: (automationOverride as Json | undefined) ?? {
      auto_compact: { value: true, explicit: false },
      session_naming: { value: true, explicit: false },
      attachment_naming: { value: true, explicit: false },
      subagents: { value: true, explicit: false },
    },
    naming: {
      session: namingTarget(identities, {
        provider: (namingOverrides.session?.provider as string | null | undefined) ?? null,
        model: (namingOverrides.session?.model as string | null | undefined) ?? null,
      }),
      attachment: namingTarget(identities, {
        provider: (namingOverrides.attachment?.provider as string | null | undefined) ?? null,
        model: (namingOverrides.attachment?.model as string | null | undefined) ?? null,
      }),
    },
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
      model_window_max: 10_000_000,
    },
    defaults: {
      auto_compact: true,
      session_naming_enabled: true,
      attachment_naming_enabled: true,
      subagents_enabled: true,
      model_window: 131072,
    },
    diagnostics: [],
    ...rest,
  };
}

interface SettingsStubOptions {
  snapshot: Json;
  /** applied（默认）→ 返回同一份快照；blocked → 带 errors；conflict → revision 已变；
   *  pending → 永不 resolve（保存中）。 */
  apply?: "applied" | "blocked" | "conflict" | "pending";
  errors?: Array<{ path: string; code: string; message: string }>;
}

/** 在 `stubTauri` 之后包一层 invoke：设置面两条命令由这里提供。 */
async function stubSettings(page: Page, options: SettingsStubOptions): Promise<void> {
  await page.addInitScript((config: SettingsStubOptions) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "settings_get") return config.snapshot;
      if (cmd === "settings_apply") {
        if (config.apply === "pending") return new Promise(() => {});
        if (config.apply === "blocked") {
          return {
            status: "blocked",
            snapshot: config.snapshot,
            errors: config.errors ?? [],
            warnings: [],
          };
        }
        if (config.apply === "conflict") {
          return {
            status: "conflict",
            snapshot: { ...config.snapshot, revision: "rev-visual-external" },
            errors: [{ path: "base_revision", code: "settings_revision_conflict", message: "配置文件已在外部修改" }],
            warnings: [],
          };
        }
        return { status: "applied", snapshot: config.snapshot, errors: [], warnings: [] };
      }
      return original(cmd, args);
    };
  }, options);
}

async function openSettings(page: Page, options: SettingsStubOptions): Promise<void> {
  await stubTauri(page, VAULT);
  await stubSettings(page, options);
  await page.goto("/");
  await page.locator(".modeline-language").waitFor({ state: "visible" });
  await page.keyboard.press("Meta+Comma");
  await expect(page.locator(".lumir-set-panel")).toBeVisible();
  await expect(page.locator(".lumir-set-section-title")).toHaveCount(2);
  // 等 settings_get 落地：加载态里两节标题已经在 DOM 里（静态头），只看标题会读到半成品。
  await expect(page.locator(".lumir-set-status")).not.toHaveText("正在读取配置文件…");
  await page.locator(".lumir-set-provider-row, .lumir-set-empty").first().waitFor();
}

/** 评审截图（`.local/reviews/m734-settings/`，git 外）：只在 `LUMIR_SETTINGS_CAPTURE=1` 时落盘。
 *  像素基线要 Alex 过目后才提交，这之前靠这批候选图评审观感；门禁只跑结构断言。 */
async function capture(page: Page, name: string): Promise<void> {
  if (process.env.LUMIR_SETTINGS_CAPTURE !== "1") return;
  const dir = join(process.cwd(), "../../.local/reviews/m734-settings");
  mkdirSync(dir, { recursive: true });
  // 评审图固定从正文顶部开始（交互过程中的焦点滚动会把画面停在半截）。
  await page.locator(".lumir-set-body").evaluate((node) => {
    (node as HTMLElement).scrollTop = 0;
  });
  await page.locator(".lumir-set-panel").screenshot({ path: `${dir}/${name}.png` });
}

async function setTheme(page: Page, theme: "light" | "dark" | "eink"): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
}

// ---------------------------------------------------------------------------
// 1）单页两节、落位、焦点圈定、无 TAB
// ---------------------------------------------------------------------------

test("设置面板：单页两节、O1/O2 落位、无 TAB、背景 inert、焦点圈定", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openSettings(page, { snapshot: settingsSnapshot() });

  const titles = await page.locator(".lumir-set-section-title").allTextContents();
  expect(titles).toEqual(["模型接入", "自动化"]);
  await expect(page.locator('.lumir-set-panel [role="tab"], .lumir-set-panel [role="tablist"]')).toHaveCount(0);
  // 背景 inert（键盘 / 指针 / AT 三者都不可达）。
  expect(await page.locator("#app").evaluate((node) => (node as HTMLElement).inert)).toBe(true);
  // 面板完整落在视口内（O1 / O2），且没有水平溢出。
  const box = await page.locator(".lumir-set-panel").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1200);
  expect(box!.y + box!.height).toBeLessThanOrEqual(800);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // 焦点圈定：把焦点放到最后一个自动开关上再 Tab，焦点仍在面板内。
  await page.locator('[data-auto-row="subagents"] [role="switch"]').focus();
  await page.keyboard.press("Tab");
  const inside = await page.evaluate(() => document.querySelector(".lumir-set-panel")!.contains(document.activeElement));
  expect(inside).toBe(true);

  await capture(page, "01-configured");
  // Escape 关闭（干净态直接关），焦点回编辑器；背景解除 inert。
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-set-panel")).toBeHidden();
  expect(await page.locator("#app").evaluate((node) => (node as HTMLElement).inert)).toBe(false);
});

test("设置面板：1280×800 与 900×700 下打开即完整可见（含窄窗）", async ({ page }) => {
  for (const size of [
    { width: 1280, height: 800 },
    { width: 900, height: 700 },
  ]) {
    await page.setViewportSize(size);
    await openSettings(page, { snapshot: settingsSnapshot() });
    const box = await page.locator(".lumir-set-panel").boundingBox();
    expect(box, `${size.width}×${size.height}`).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
    expect(box!.width).toBeLessThanOrEqual(780);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await capture(page, `02-narrow-${size.width}x${size.height}`);
    await page.keyboard.press("Escape");
    await expect(page.locator(".lumir-set-panel")).toBeHidden();
  }
});

// ---------------------------------------------------------------------------
// 2）三主题的描边配方（eink 1.4px / 无阴影）
// ---------------------------------------------------------------------------

test("设置面板：light / dark 同几何；eink 面板 1.4px 描边、无阴影", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openSettings(page, { snapshot: settingsSnapshot() });

  const geometry = async (): Promise<{ width: number; height: number }> => {
    const box = await page.locator(".lumir-set-panel").boundingBox();
    return { width: Math.round(box!.width), height: Math.round(box!.height) };
  };
  const light = await geometry();
  await setTheme(page, "dark");
  await capture(page, "03-dark");
  const dark = await geometry();
  expect(dark.width).toBe(light.width);
  expect(dark.height).toBe(light.height);

  await setTheme(page, "eink");
  // eink 线宽档：border-width 的计算值是设备像素取整后的 used value（1.4px → 1px，M293 实测），
  // 因此从样式表规则本身读声明值（与 m133 的 eink 断言同一口径）。
  const declared = await page.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules)) {
        if (
          rule instanceof CSSStyleRule &&
          rule.selectorText.includes(':root[data-theme="eink"] .lumir-set-panel')
        ) {
          return { borderWidth: rule.style.borderWidth, boxShadow: rule.style.boxShadow };
        }
      }
    }
    return null;
  });
  expect(declared).toEqual({ borderWidth: "1.4px", boxShadow: "none" });
  expect((await geometry()).width).toBe(light.width);
  await capture(page, "03-eink");
});

// ---------------------------------------------------------------------------
// 3）空清单与添加表单的错误回填
// ---------------------------------------------------------------------------

test("设置面板：空清单只给空态卡（不渲染空表单骨架）+「添加第一个 provider」", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openSettings(page, {
    snapshot: settingsSnapshot({ providers: [], active: null }),
  });
  await expect(page.locator(".lumir-set-empty-title")).toHaveText("还没有 provider");
  await expect(page.locator(".lumir-set-empty .lumir-set-btn-primary")).toHaveText("添加第一个 provider");
  await expect(page.locator(".lumir-set-provider-row")).toHaveCount(0);
  await expect(page.locator(".lumir-set-api-key")).toHaveCount(0);
  await capture(page, "04-empty");
});

test("设置面板：新增 id 冲突 → 后端 blocked 按 path 回填到 id 输入框（aria-invalid + 错误文本）", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openSettings(page, {
    snapshot: settingsSnapshot(),
    apply: "blocked",
    errors: [{ path: "providers[0].id", code: "settings_provider_id_duplicate", message: "provider id \"kimi-work\" 已存在" }],
  });
  await page.locator(".lumir-set-add").click();
  await page.locator("#lumir-set-add-id").fill("kimi-work");
  await page.locator(".lumir-set-add-card .lumir-set-btn-primary").click();
  // 添加是草稿动作：保存时后端才拒绝重复 id，错误回填到重开的添加表单。
  await page.locator(".lumir-set-btn-primary").click();
  const input = page.locator("#lumir-set-add-id");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAttribute("aria-errormessage", "lumir-set-add-id-error");
  await expect(page.locator("#lumir-set-add-id-error")).toContainText("已存在");
  await expect(page.locator(".lumir-set-status")).toContainText("需要修正");
  await capture(page, "05-add-duplicate");
});

// ---------------------------------------------------------------------------
// 4）删除保护：三块说明按引用面出现
// ---------------------------------------------------------------------------

test("设置面板：删除当前使用项 + 两个命名引用 → 三块替代目标说明同时出现（不弹二级 modal）", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openSettings(page, {
    snapshot: settingsSnapshot({
      naming: { session: { provider: "kimi-work", model: "k3-256k" }, attachment: { provider: "kimi-work", model: "k3-256k" } },
    }),
  });
  await page.locator(".lumir-set-danger .lumir-set-btn-danger").click();
  await expect(page.locator(".lumir-set-delete-card")).toBeVisible();
  await expect(page.locator('[data-delete-block="active"]')).toHaveCount(1);
  await expect(page.locator('[data-delete-block="session"]')).toHaveCount(1);
  await expect(page.locator('[data-delete-block="attachment"]')).toHaveCount(1);
  // 删除是对草稿的动作：标题里明说「点保存才写入」。
  await expect(page.locator(".lumir-set-delete-card .lumir-set-hint").first()).toContainText("草稿");
  // 只有一层 dialog：没有二级 modal（面板内没有第二个 dialog）。
  await expect(page.locator(".lumir-set-panel")).toHaveCount(1);
  await expect(page.locator('.lumir-set-panel [role="dialog"]')).toHaveCount(0);
  await capture(page, "06-delete-confirm");
});

// ---------------------------------------------------------------------------
// 5）自动化：全局行不随 provider 切换重排；命名目标关闭禁用但保留
// ---------------------------------------------------------------------------

test("设置面板：切换 provider 不重排开关行；命名关闭时选择器禁用且值保留", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openSettings(page, {
    snapshot: settingsSnapshot({
      automation: {
        auto_compact: { value: true, explicit: false },
        session_naming: { value: false, explicit: true },
        attachment_naming: { value: true, explicit: false },
        subagents: { value: true, explicit: false },
      },
      naming: { session: { provider: "local-lab", model: "local-chat" } },
    }),
  });

  const rowOrder = async (): Promise<string[]> =>
    page.locator("[data-auto-row]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-auto-row") ?? ""));
  const before = await rowOrder();

  // 会话命名关闭：两个选择器 disabled，值仍是 local-lab / local-chat。
  const sessionRow = page.locator('[data-auto-row="session_naming"]');
  const selects = sessionRow.locator("select.lumir-set-naming-select");
  await expect(selects).toHaveCount(2);
  await expect(selects.nth(0)).toBeDisabled();
  await expect(selects.nth(1)).toBeDisabled();
  await expect(selects.nth(0)).toHaveValue("local-lab");
  await expect(selects.nth(1)).toHaveValue("local-chat");
  await expect(sessionRow.locator(".lumir-set-auto-effective")).toContainText("已关闭：不发起命名调用；选择保留");

  // 切到另一个 provider：开关行同一组、同一顺序（DOM 不重渲染）。
  await page.locator('.lumir-set-provider-row[data-provider-id="local-lab"]').click();
  expect(await rowOrder()).toEqual(before);
  await expect(page.locator('[data-auto-row="session_naming"] .lumir-set-auto-effective')).toContainText("选择保留");
  await capture(page, "07-naming-closed");
});

test("设置面板：图片命名的模型选项标 vision；不合格分支写跳过并保留暂存名", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openSettings(page, {
    snapshot: settingsSnapshot({
      providers: [
        provider("kimi-work", "kimi"),
        provider("local-lab", "generic", {
          model: "local-vision",
          models: [
            modelDraft("local-vision", false, true, 131072),
            modelDraft("local-chat", false, false, 131072),
          ],
        }),
      ],
      // 覆盖模型不在目标清单（"ghost"）：图片命名保留原值并标「不在清单，会跳过」（spec 的
      // 跳过分支）。模型选项同时含 vision / 未声明 vision 两档，验证选项上的资格后缀。
      naming: { attachment: { provider: "local-lab", model: "ghost" } },
    }),
  });
  const row = page.locator('[data-auto-row="attachment_naming"]');
  const modelSelect = row.locator("select.lumir-set-naming-select").nth(1);
  const labels = await modelSelect.locator("option").allTextContents();
  expect(labels.some((label) => label.includes("✓ vision"))).toBe(true);
  expect(labels.some((label) => label.includes("未声明 vision"))).toBe(true);
  expect(labels.some((label) => label.includes("不在清单，会跳过"))).toBe(true);
  await expect(row.locator(".lumir-set-auto-effective")).toContainText("未声明 vision → 粘贴图片不会改名，保留暂存名");
  await expect(row.locator(".lumir-set-auto-effective")).toContainText("下一次粘贴生效");
  await capture(page, "08-image-no-vision");
});

// ---------------------------------------------------------------------------
// 6）校验错误（重复模型 id 两行都标）与保存中禁用全部编辑控件
// ---------------------------------------------------------------------------

test("设置面板：重复模型 id → 两行都标 aria-invalid；焦点落第一个错误控件", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openSettings(page, {
    snapshot: settingsSnapshot({
      providers: [
        provider("kimi-work", "kimi", {
          models: [modelDraft("dup", true, false, 131072), modelDraft("dup", true, false, 131072)],
        }),
      ],
    }),
    apply: "blocked",
    errors: [
      { path: "harness.providers.kimi-work.models[0].id", code: "harness_model_id_duplicate", message: "模型 id 重复" },
      { path: "harness.providers.kimi-work.models[1].id", code: "harness_model_id_duplicate", message: "模型 id 重复" },
    ],
  });
  // 保存钮只在草稿脏时可用（干净态点保存是空动作）；改一下 effort 制造一次真实提交。
  await page.locator(".lumir-set-model-row input[type=checkbox]").first().click();
  await page.locator(".lumir-set-btn-primary").click();
  const invalid = page.locator(".lumir-set-model-row input[aria-invalid='true']");
  await expect(invalid).toHaveCount(2);
  await expect(invalid.nth(0)).toBeFocused();
  await expect(page.locator(".lumir-set-status")).toContainText("需要修正（2 项）");
  await capture(page, "09-validation-error");
});

test("设置面板：保存中禁用全部编辑控件（含取消 / 设置当前使用 / 恢复默认）", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openSettings(page, { snapshot: settingsSnapshot(), apply: "pending" });
  // 先制造一个脏改动，保存钮才可点。
  await page.locator('[data-auto-row="auto_compact"] [role="switch"]').click();
  await page.locator(".lumir-set-btn-primary").click();
  await expect(page.locator(".lumir-set-status")).toHaveText("保存中…");
  await expect(page.locator(".lumir-set-btn-primary")).toHaveText("保存中…");
  // 渲染是异步落定的（保存态的 render 与底栏刷新不在同一拍），用 poll 读到稳定值——单次快照
  // 会读到「保存中…」已上屏、控件还没全部禁用的中间态。
  await expect
    .poll(
      async () =>
        page.locator(".lumir-set-panel").evaluate((panel) =>
          [...panel.querySelectorAll<HTMLElement>("input, select, button")]
            .filter((node) => {
              if (node.getClientRects().length === 0) return false;
              if (node instanceof HTMLInputElement) return !node.readOnly && !node.disabled;
              return !(node as HTMLButtonElement).disabled;
            })
            .map((node) => `${node.tagName.toLowerCase()}.${node.className}`),
        ),
      { timeout: 5000 },
    )
    .toEqual([]);
  await capture(page, "10-saving");
});

test("设置面板：外部冲突 → 横幅给「重新载入 / 仍然保存」两动作；底栏保存禁用", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openSettings(page, { snapshot: settingsSnapshot(), apply: "conflict" });
  // 制造一次脏改动再保存（干净态保存是空动作）。
  await page.locator('[data-auto-row="auto_compact"] [role="switch"]').click();
  await page.locator(".lumir-set-btn-primary").click();
  const banner = page.locator('[data-banner="conflict"]');
  await expect(banner).toBeVisible();
  await expect(banner.locator(".lumir-set-banner-title")).toHaveText("配置文件已在外部修改");
  await expect(banner.locator(".lumir-set-btn")).toHaveText(["重新载入", "仍然保存"]);
  // 冲突态只走横幅动作：底栏保存用的是旧 revision，不能让它再点出一次冲突。
  await expect(page.locator(".lumir-set-actions .lumir-set-btn-primary")).toBeDisabled();
  await expect(page.locator(".lumir-set-status")).toContainText("外部冲突");
  await capture(page, "11-conflict");
  // 重新载入 → 横幅消失、回到干净态（外部值落地）。
  await banner.locator(".lumir-set-btn").first().click();
  await expect(banner).toBeHidden();
  await expect(page.locator(".lumir-set-status")).toHaveText("没有未保存的修改");
});
