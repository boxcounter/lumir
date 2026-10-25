// 设置面板的纯模型层单测（change add-model-automation-settings-oct24 tasks §7.4）。
//
// 这一层是零 DOM 环境（tests/unit/README.md）：只驱动 src/settings-panel.ts 导出的纯函数
// ——草稿构造 / 脏判定 / patch 构造 / 命名目标预览 / 错误按 path 归类。DOM 面的断言
// （保存中禁用、ARIA 回填、焦点、单页无 TAB 的可见结构）归视觉场景
// `tests/visual/scenes/m734-settings-panel.spec.ts` 与真机验收场景。
//
// 判据方向刻意是「patch 的形状」而不是「前端校验」：design §6.3 规定校验只在 Rust，所以
// 本层 MUST NOT 出现「重复 id 被前端拒绝」这类断言——前端只负责把后端的错误按 path 挂回去。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addProviderDraft,
  applyDraftDelete,
  buildPatch,
  createDraft,
  defaultSelection,
  deleteCandidates,
  draftEffectiveModel,
  draftIsDirty,
  draftProviderDirty,
  draftReferences,
  emptyFieldErrors,
  errorCount,
  planProviderEdits,
  findProvider,
  mapFieldErrors,
  namingRowModel,
  pageResetDraft,
  renameDraftProviderId,
  setNamingModelDraft,
  setNamingProviderDraft,
} from "../../src/settings-panel.ts";
import type { Draft, DraftPresetCapability } from "../../src/settings-panel.ts";
import type { SettingsSnapshot } from "../../src/bindings/SettingsSnapshot.ts";
import type { ProviderSettings } from "../../src/bindings/ProviderSettings.ts";
import type { ModelDraft } from "../../src/bindings/ModelDraft.ts";
import type { SettingsFieldError } from "../../src/bindings/SettingsFieldError.ts";
import { COPY } from "../../src/copy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const PRESETS = [
  {
    preset: "kimi",
    official_base_url: "https://api.moonshot.cn/v1",
    supported_wire_apis: ["responses", "chat_completions"],
    default_wire_api: "responses",
    requires_api_key: true,
  },
  {
    preset: "deepseek",
    official_base_url: "https://api.deepseek.com",
    supported_wire_apis: ["responses"],
    default_wire_api: "responses",
    requires_api_key: true,
  },
  {
    preset: "generic",
    official_base_url: null,
    supported_wire_apis: ["chat_completions", "responses"],
    default_wire_api: "chat_completions",
    requires_api_key: false,
  },
  {
    preset: "mock",
    official_base_url: null,
    supported_wire_apis: [],
    default_wire_api: "responses",
    requires_api_key: false,
  },
] as const;

function modelDraft(
  id: string,
  fields: { effort?: boolean | null; vision?: boolean | null; window?: number | null } = {},
): ModelDraft {
  return {
    id,
    effort: fields.effort === undefined ? true : fields.effort,
    vision: fields.vision === undefined ? false : fields.vision,
    window: (fields.window === undefined ? 262144 : fields.window) as unknown as bigint,
    valid: true,
    diagnostics: [],
    unknown_keys: [],
  };
}

function provider(id: string, fields: Partial<ProviderSettings> = {}): ProviderSettings {
  const preset = fields.preset === undefined ? "kimi" : fields.preset;
  const official = PRESETS.find((item) => item.preset === preset)?.official_base_url ?? null;
  return {
    id,
    preset,
    raw_preset: preset ?? "",
    configured: true,
    status: "ok",
    api_key: { state: "set", hint: "3f9a" },
    models: [modelDraft("k3-256k", { effort: true, vision: true, window: 262144 })],
    model: "k3-256k",
    base_url: { kind: "absent" },
    wire_api: { kind: "absent" },
    effective: {
      official_base_url: official,
      base_url: official,
      wire_api: "responses",
      models: [{ id: "k3-256k", effort: true, vision: true, window: 262144 as unknown as bigint }],
    },
    references: { active: false, session_naming: false, attachment_naming: false },
    unknown_keys: [],
    ...fields,
  };
}

function snapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  const providers = overrides.providers ?? [provider("kimi-work")];
  const active = overrides.active !== undefined ? overrides.active : (providers[0]?.id ?? null);
  const withRefs = providers.map((item) => ({
    ...item,
    references: { active: item.id === active, session_naming: false, attachment_naming: false },
  }));
  const providerOptions = withRefs.map((item) => ({ id: item.id, is_active: item.id === active, configured: true }));
  return {
    path: "/tmp/config.json",
    file: { state: "valid" },
    revision: "rev-1",
    providers: withRefs,
    active,
    active_explicit: false,
    automation: {
      auto_compact: { value: true, explicit: false },
      session_naming: { value: true, explicit: false },
      attachment_naming: { value: true, explicit: false },
      subagents: { value: true, explicit: false },
    },
    naming: {
      session: {
        override_provider: null,
        override_model: null,
        provider_options: providerOptions,
        model_options: [{ id: "k3-256k", vision: true, is_effective: true }],
        resolved: {
          provider: active,
          model: "k3-256k",
          follows_active: true,
          dangling: false,
          eligible: true,
          reason: null,
        },
      },
      attachment: {
        override_provider: null,
        override_model: null,
        provider_options: providerOptions,
        model_options: [{ id: "k3-256k", vision: true, is_effective: true }],
        resolved: {
          provider: active,
          model: "k3-256k",
          follows_active: true,
          dangling: false,
          eligible: true,
          reason: null,
        },
      },
    },
    capabilities: {
      presets: PRESETS.map((item) => ({ ...item, supported_wire_apis: [...item.supported_wire_apis] })),
      provider_id_pattern: "^[a-z0-9][a-z0-9_-]{0,31}$",
      reserved_provider_ids: ["mock"],
      provider_order: ["kimi", "deepseek", "generic", "mock"],
      model_window_min: 1n,
      model_window_max: 10_000_000n,
    },
    defaults: {
      auto_compact: true,
      session_naming_enabled: true,
      attachment_naming_enabled: true,
      subagents_enabled: true,
      model_window: 131072n,
    },
    diagnostics: [],
    ...overrides,
  };
}

/** 草稿层的预设能力（camelCase；视图从快照的 snake_case 映射一次，测试直接用草稿形状）。 */
function metaOf(_id: string, preset: "kimi" | "deepseek" | "generic" | "mock") {
  const found = PRESETS.find((item) => item.preset === preset)!;
  return {
    officialBaseUrl: found.official_base_url,
    supportedWires: [...found.supported_wire_apis] as DraftPresetCapability["supportedWires"],
    defaultWire: found.default_wire_api as DraftPresetCapability["defaultWire"],
    requiresApiKey: found.requires_api_key,
  };
}

// ── 草稿构造 ───────────────────────────────────────────────────────────

test("createDraft：raw 与「键缺席」状态原样落到草稿（逐项恢复默认的出现判据）", () => {
  const draft = createDraft(
    snapshot({
      providers: [
        provider("kimi-work", {
          model: "explicit-model",
          base_url: { kind: "present", value: "http://127.0.0.1:8080/v1" },
          wire_api: { kind: "present", value: { kind: "string", text: "chat" } },
          effective: {
            official_base_url: "https://api.moonshot.cn/v1",
            base_url: "http://127.0.0.1:8080/v1",
            wire_api: "responses",
            models: [],
          },
        }),
      ],
    }),
  );
  const entry = draft.providers[0]!;
  assert.equal(entry.baseUrlPresent, true);
  assert.equal(entry.baseUrlValue, "http://127.0.0.1:8080/v1");
  assert.equal(entry.wirePresent, true);
  assert.equal(entry.wireRawText, "chat");
  assert.equal(entry.wireEffective, "responses");
  assert.equal(entry.effectiveModel, "explicit-model");
  assert.equal(draftIsDirty(draft), false);
});

test("createDraft：装载期被忽略的条目保留在列表里（可见、只读、只能删）", () => {
  const draft = createDraft(
    snapshot({
      providers: [provider("legacy", { preset: null, raw_preset: "openai", status: "invalid", configured: false })],
    }),
  );
  assert.equal(draft.providers[0]!.ignored, true);
  assert.equal(draft.providers[0]!.rawPreset, "openai");
});

test("createDraft：空清单 → 无选中项；defaultSelection 只取列表首项", () => {
  const draft = createDraft(snapshot({ providers: [], active: null }));
  assert.equal(draft.providers.length, 0);
  assert.equal(draft.selection, null);
  assert.equal(defaultSelection([]), null);
  assert.equal(defaultSelection([{ id: "a" }, { id: "b" }]), "a");
});

// ── patch 构造：增删改 ────────────────────────────────────────────────

test("buildPatch：干净草稿 → 空 patch（providers 空、无 active / naming）", () => {
  const base = snapshot();
  const patch = buildPatch(createDraft(base), base, base.revision!);
  assert.deepEqual(patch.providers, []);
  assert.equal(patch.active_provider, undefined);
  assert.equal(patch.naming, undefined);
  assert.deepEqual(patch.automation, {});
  assert.equal(patch.base_revision, "rev-1");
});

test("buildPatch：添加 provider 只带 id + preset；第一个 provider 同一笔设为当前使用", () => {
  const base = snapshot({ providers: [], active: null });
  const draft = createDraft(base);
  draft.active = null;
  addProviderDraft(draft, "kimi-work", "kimi", metaOf("kimi-work", "kimi"));
  const patch = buildPatch(draft, base, base.revision!);
  assert.deepEqual(patch.providers, [{ action: "add", id: "kimi-work", preset: "kimi" }]);
  assert.deepEqual(patch.active_provider, { kind: "set", value: "kimi-work" });
  assert.equal(draftIsDirty(draft), true);
});

test("buildPatch：编辑只带脏字段（Key 替换 / 清空、模型整表、Base URL 删键、Wire 写入）", () => {
  const base = snapshot();
  const draft = createDraft(base);
  const entry = draft.providers[0]!;
  entry.keyEdit = { kind: "replace", value: "test-key-1234" };
  entry.models = [{ id: "m1", effort: false, vision: true, window: 8192, notes: [], valid: true }];
  entry.modelsEdit = [...entry.models];
  entry.baseUrlEdit = { kind: "reset", value: "" };
  entry.wireEdit = { kind: "set", value: "chat_completions" };
  const patch = buildPatch(draft, base, base.revision!);
  assert.deepEqual(patch.providers, [
    {
      action: "update",
      id: "kimi-work",
      api_key: { kind: "replace", value: "test-key-1234" },
      models: [{ id: "m1", effort: false, vision: true, window: 8192 }],
      base_url: { kind: "reset" },
      wire_api: { kind: "set", value: "chat_completions" },
    },
  ]);
});

test("buildPatch：Key 清除 = 删键（不是写空串）", () => {
  const base = snapshot();
  const draft = createDraft(base);
  draft.providers[0]!.keyEdit = { kind: "clear", value: "" };
  assert.deepEqual(buildPatch(draft, base, base.revision!).providers[0], {
    action: "update",
    id: "kimi-work",
    api_key: { kind: "clear" },
  });
});

test("buildPatch：删除当前使用项 → 带 active_after；删除被命名引用项 → 带重定向（follow / 指定）", () => {
  const base = snapshot({
    providers: [provider("kimi-work"), provider("deepseek", { preset: "deepseek" })],
  });
  const draft = createDraft(base);
  // 引用面以**当前草稿**为准（P1-3 r1）：用户已把两个命名目标显式指到 kimi-work。
  draft.naming.session = { provider: "kimi-work", model: "k3-256k" };
  draft.naming.attachment = { provider: "kimi-work", model: "k3-256k" };
  findProvider(draft, "kimi-work")!.removed = true;
  draft.remove = {
    index: 0,
    activeAfter: "deepseek",
    sessionAfter: "follow",
    attachmentAfter: "deepseek",
  };
  const patch = buildPatch(draft, base, base.revision!);
  assert.deepEqual(patch.providers, [
    {
      action: "delete",
      id: "kimi-work",
      active_after: "deepseek",
      session_naming_after: { kind: "follow_active" },
      attachment_naming_after: { kind: "provider", value: "deepseek" },
    },
  ]);
});

test("buildPatch：删除最后一个 provider → 不带 active_after（后端删键），mock 不算可替代候选", () => {
  const base = snapshot({
    providers: [provider("kimi-work", { references: { active: true, session_naming: false, attachment_naming: false } })],
  });
  const draft = createDraft(base);
  findProvider(draft, "kimi-work")!.removed = true;
  draft.active = null;
  draft.activeTouched = true;
  draft.remove = { index: 0, activeAfter: "", sessionAfter: "follow", attachmentAfter: "follow" };
  const patch = buildPatch(draft, base, base.revision!);
  assert.deepEqual(patch.providers, [{ action: "delete", id: "kimi-work" }]);
  assert.deepEqual(patch.active_provider, { kind: "reset" });
  assert.deepEqual(deleteCandidates(draft, "kimi-work"), []);
});

// ── 删除确认的草稿改写（active / 命名目标） ────────────────────────────

test("applyDraftDelete：命名目标被引用时改写为计划目标，并清掉旧 provider 的 model 覆盖", () => {
  const base = snapshot({
    providers: [
      provider("kimi-work", { references: { active: true, session_naming: true, attachment_naming: true } }),
      provider("deepseek", { preset: "deepseek" }),
    ],
  });
  const draft = createDraft(base);
  draft.naming.session = { provider: "kimi-work", model: "k3-256k" };
  draft.naming.attachment = { provider: "kimi-work", model: "k3-256k" };
  draft.remove = {
    index: 0,
    activeAfter: "deepseek",
    sessionAfter: "follow",
    attachmentAfter: "deepseek",
  };
  applyDraftDelete(draft);
  assert.equal(findProvider(draft, "kimi-work")!.removed, true);
  assert.equal(draft.active, "deepseek");
  assert.deepEqual(draft.naming.session, { provider: null, model: null });
  assert.deepEqual(draft.naming.attachment, { provider: "deepseek", model: null });
  assert.equal(draft.remove, null);
  assert.equal(draft.selection, "deepseek");
  // 同一笔保存里两个命名目标都会被写入（follow = Reset，指定 = Set）。
  const patch = buildPatch(draft, base, base.revision!);
  assert.deepEqual(patch.naming, {
    session: { provider: { kind: "reset" } },
    attachment: { provider: { kind: "set", value: "deepseek" } },
  });
});

test("applyDraftDelete：未被引用的 provider 删除不影响 active / 命名目标", () => {
  const base = snapshot({
    providers: [provider("kimi-work"), provider("deepseek", { preset: "deepseek" })],
  });
  const draft = createDraft(base);
  draft.naming.session = { provider: "kimi-work", model: null };
  draft.namingTouched.session.provider = false;
  draft.remove = { index: 1, activeAfter: "kimi-work", sessionAfter: "follow", attachmentAfter: "follow" };
  applyDraftDelete(draft);
  assert.equal(draft.active, "kimi-work");
  assert.deepEqual(draft.naming.session, { provider: "kimi-work", model: null });
});

// ── 命名目标：内联选择与一行生效说明 ──────────────────────────────────

function namingInput(draft: Draft, kind: "session" | "attachment", enabled = true) {
  return { kind, draft, enabled, locked: false } as const;
}

test("namingRowModel：跟随当前 provider——选项首项是「跟随」，说明含目标 / 来源 / 时机", () => {
  const draft = createDraft(snapshot());
  const row = namingRowModel(namingInput(draft, "session"));
  assert.equal(row.providerOptions[0]!.value, "");
  assert.equal(row.providerValue, "");
  assert.equal(row.modelValue, "");
  assert.match(row.note, /kimi-work \/ k3-256k/);
  assert.match(row.note, /跟随当前 provider/);
  assert.match(row.note, /下一次评估触发点生效/);
  assert.equal(row.bad, false);
});

test("namingRowModel：换 provider 时草稿清 model 覆盖，选择器回到「生效模型（默认）」", () => {
  const draft = createDraft(
    snapshot({
      providers: [
        provider("kimi-work"),
        provider("deepseek", { preset: "deepseek", models: [modelDraft("ds-chat", { window: 65536 })], model: "ds-chat" }),
      ],
    }),
  );
  draft.naming.session = { provider: "kimi-work", model: "k3-256k" };
  setNamingProviderDraft(draft, "session", "deepseek");
  assert.equal(draft.naming.session.model, null);
  const row = namingRowModel(namingInput(draft, "session"));
  assert.equal(row.providerValue, "deepseek");
  assert.equal(row.modelValue, "");
  assert.match(row.note, /deepseek \/ ds-chat/);
  assert.match(row.note, /指定目标/);
  // 同一笔里显式重选模型时按新目标的清单校验（这里只验证 patch 会带上 model 键）。
  setNamingModelDraft(draft, "session", "ds-chat");
  const base = snapshot({
    providers: [provider("kimi-work"), provider("deepseek", { preset: "deepseek" })],
  });
  const patch = buildPatch(draft, base, base.revision!);
  assert.deepEqual(patch.naming?.session, {
    provider: { kind: "set", value: "deepseek" },
    model: { kind: "set", value: "ds-chat" },
  });
});

test("namingRowModel：会话命名的覆盖模型不在目标清单时回落生效模型（MUST NOT 写成「会跳过」）", () => {
  const draft = createDraft(
    snapshot({
      providers: [provider("deepseek", { preset: "deepseek", models: [modelDraft("ds-chat")], model: "ds-chat" })],
    }),
  );
  draft.naming.session = { provider: "deepseek", model: "k3-256k" };
  const row = namingRowModel(namingInput(draft, "session"));
  assert.match(row.note, /deepseek \/ ds-chat/);
  assert.match(row.note, /覆盖模型 k3-256k 不在清单，已回落生效模型/);
  assert.equal(/跳过/.test(row.note), false);
  assert.equal(row.modelValue, "k3-256k", "选择器保留原值，让用户看见文件里的旧值");
  assert.ok(row.modelOptions.some((item) => item.value === "k3-256k" && /已回落生效模型/.test(item.label)));
});

test("namingRowModel：图片命名按 vision 资格分流——合格写 ✓ vision，不合格写跳过并保留暂存名", () => {
  const draft = createDraft(
    snapshot({
      providers: [
        provider("local-lab", {
          preset: "generic",
          models: [
            modelDraft("local-vision", { vision: true }),
            modelDraft("local-chat", { vision: false }),
          ],
          // effective = local-chat：它占「生效模型（默认）」那一项，不再重复列出；
          // local-vision 作为可选的其它模型带 ✓ vision 后缀。
          model: "local-chat",
        }),
      ],
    }),
  );
  const optionLabels = namingRowModel(namingInput(draft, "attachment")).modelOptions.map((item) => item.label);
  assert.ok(optionLabels.some((label) => label.includes("local-vision") && label.includes("✓ vision")));
  assert.ok(optionLabels.some((label) => label.includes("生效模型（默认：local-chat）")));
  draft.naming.attachment = { provider: "local-lab", model: "local-chat" };
  const row = namingRowModel(namingInput(draft, "attachment"));
  assert.equal(row.bad, true);
  assert.match(row.note, /未声明 vision → 粘贴图片不会改名，保留暂存名/);
  assert.match(row.note, /指定目标/);
  assert.match(row.note, /下一次粘贴生效/);
});

test("namingRowModel：目标 provider 悬空时保留原始 id（选项标「不存在，已回落」）并回落到当前 provider", () => {
  const draft = createDraft(snapshot());
  draft.naming.session = { provider: "gone", model: null };
  const row = namingRowModel(namingInput(draft, "session"));
  assert.equal(row.providerValue, "gone");
  assert.ok(row.providerOptions.some((item) => item.value === "gone" && /不存在，已回落/.test(item.label)));
  assert.match(row.note, /覆盖项悬空，已回落当前 provider/);
  assert.match(row.note, /kimi-work/);
});

test("namingRowModel：关闭功能时禁用但保留选择，说明写「已关闭 … 选择保留」", () => {
  const draft = createDraft(snapshot());
  draft.naming.session = { provider: "kimi-work", model: "k3-256k" };
  draft.automation.session_naming = { value: false, explicit: true };
  const row = namingRowModel(namingInput(draft, "session", false));
  assert.equal(row.disabled, true);
  assert.equal(row.providerValue, "kimi-work");
  assert.equal(row.modelValue, "k3-256k");
  assert.match(row.note, /^已关闭：不发起命名调用；选择保留/);
  assert.equal(row.bad, false);
  // 关闭状态下 patch MUST NOT 删除或清空这两个键：这里没有任何 touched → 不带 naming。
  const base = snapshot();
  const patch = buildPatch(draft, base, base.revision!);
  assert.equal(patch.naming, undefined);
});

test("namingRowModel：没有任何 provider 时给出无目标说明（会话 / 图片两套后果）", () => {
  const draft = createDraft(snapshot({ providers: [], active: null }));
  const session = namingRowModel(namingInput(draft, "session"));
  assert.match(session.note, /无可用 provider · 不会生成标题/);
  const attachment = namingRowModel(namingInput(draft, "attachment"));
  assert.match(attachment.note, /无可用 provider · 粘贴图片不会改名/);
  assert.equal(session.disabled, true);
});

// ── 生效模型与显式值 ────────────────────────────────────────────────

test("draftEffectiveModel：显式 model 优先；空清单仍取显式值；都没有才是空串", () => {
  const draft = createDraft(
    snapshot({
      providers: [
        provider("a", { model: "explicit", models: [] }),
        provider("b", { model: "", models: [modelDraft("first"), modelDraft("second")] }),
        provider("c", { model: "", models: [] }),
      ],
    }),
  );
  assert.equal(draftEffectiveModel(draft.providers[0]!), "explicit");
  assert.equal(draftEffectiveModel(draft.providers[1]!), "first");
  assert.equal(draftEffectiveModel(draft.providers[2]!), "");
});

// ── 自动化：全局键，不随 provider 变化 ────────────────────────────────

test("buildPatch：四个开关各自独立（显式关闭 → Set；恢复默认 → Reset；键缺席不改）", () => {
  const base = snapshot();
  const draft = createDraft(base);
  draft.automation.auto_compact = { value: false, explicit: true };
  draft.automation.session_naming = { value: true, explicit: false };
  draft.automation.attachment_naming = { value: true, explicit: true };
  const patch = buildPatch(draft, base, base.revision!);
  assert.deepEqual(patch.automation, {
    auto_compact: { kind: "set", value: false },
    attachment_naming: { kind: "set", value: true },
  });
  const base2 = snapshot();
  const draft2 = createDraft(base2);
  draft2.automation.subagents = { value: true, explicit: false };
  assert.deepEqual(buildPatch(draft2, base2, base2.revision!).automation, {});
});

test("自动化不随 provider 增删改：开关值与显式状态在草稿操作前后不变", () => {
  const base = snapshot({
    providers: [provider("kimi-work"), provider("deepseek", { preset: "deepseek" })],
  });
  const draft = createDraft(base);
  draft.automation.session_naming = { value: false, explicit: true };
  const before = JSON.stringify(draft.automation);
  addProviderDraft(draft, "local-lab", "generic", metaOf("local-lab", "generic"));
  draft.remove = { index: 1, activeAfter: "kimi-work", sessionAfter: "follow", attachmentAfter: "follow" };
  applyDraftDelete(draft);
  assert.equal(JSON.stringify(draft.automation), before);
});

test("pageResetDraft：条目字段全标删键、active 与命名覆盖删键、开关回默认；provider 条目本身保留", () => {
  const base = snapshot();
  const draft = createDraft(base);
  const defaults = { auto_compact: true, session_naming: true, attachment_naming: true, subagents: true };
  pageResetDraft(draft, defaults);
  const entry = draft.providers[0]!;
  assert.equal(entry.removed, false, "provider id / preset 是身份，不是设置值");
  assert.deepEqual(entry.keyEdit, { kind: "clear", value: "" });
  assert.deepEqual(entry.modelsEdit, []);
  assert.deepEqual(entry.baseUrlEdit, { kind: "reset", value: "" });
  assert.deepEqual(entry.wireEdit, { kind: "reset", value: "responses" });
  assert.equal(draft.active, null);
  assert.equal(draft.naming.session.provider, null);
  const patch = buildPatch(draft, base, base.revision!);
  assert.deepEqual(patch.active_provider, { kind: "reset" });
  assert.deepEqual(patch.providers[0], {
    action: "update",
    id: "kimi-work",
    api_key: { kind: "clear" },
    models: [],
    base_url: { kind: "reset" },
    wire_api: { kind: "reset" },
  });
  // 基线没有 model 覆盖：页级还原只发 provider 的删键（无消费者的冗余 Reset 不发）。
  assert.deepEqual(patch.naming, {
    session: { provider: { kind: "reset" } },
    attachment: { provider: { kind: "reset" } },
  });

  // 基线**有** model 覆盖时，同一动作要把两个键都标为删键。
  const withOverride = snapshot();
  withOverride.naming.session.override_model = "k3-256k";
  withOverride.naming.attachment.override_model = "k3-256k";
  const draftWithOverride = createDraft(withOverride);
  pageResetDraft(draftWithOverride, defaults);
  assert.deepEqual(buildPatch(draftWithOverride, withOverride, withOverride.revision!).naming, {
    session: { provider: { kind: "reset" }, model: { kind: "reset" } },
    attachment: { provider: { kind: "reset" }, model: { kind: "reset" } },
  });
});

// ── 错误按 path 回填 ─────────────────────────────────────────────────

const errors = (items: Array<[string, string]>): SettingsFieldError[] =>
  items.map(([path, message]) => ({ path, code: "x", message }));

test("mapFieldErrors：重复模型 id 的两行都标（同一 code 落在两个 index 上）", () => {
  const mapped = mapFieldErrors(
    errors([
      ["harness.providers.kimi-work.models[0].id", "模型 id 重复"],
      ["harness.providers.kimi-work.models[1].id", "模型 id 重复"],
    ]),
  );
  assert.equal(mapped.models["kimi-work"]?.[0]?.id, "模型 id 重复");
  assert.equal(mapped.models["kimi-work"]?.[1]?.id, "模型 id 重复");
});

test("mapFieldErrors：新增 id 冲突（patch 相对路径）与保留 id 错误回到新增表单", () => {
  const mapped = mapFieldErrors(errors([["providers[0].id", "provider id 已存在"]]));
  assert.equal(mapped.addId, "provider id 已存在");
});

test("mapFieldErrors：条目级 / Base URL / Key / active / 命名目标 / 文件级各自归类", () => {
  const mapped = mapFieldErrors(
    errors([
      ["harness.providers.local-lab", "已填 Key 但模型清单为空"],
      ["harness.providers.local-lab.base_url", "generic 预设必须填 Base URL"],
      ["harness.providers.local-lab.api_key", "Key 非法"],
      ["harness.provider", "删除前必须选择替代 provider"],
      ["harness.session_naming.provider", "命名目标不可用"],
      ["harness.attachment_naming.model", "模型不在清单"],
      ["", "配置文件无法解析"],
    ]),
  );
  assert.equal(mapped.provider["local-lab"], "已填 Key 但模型清单为空");
  assert.equal(mapped.baseUrl["local-lab"], "generic 预设必须填 Base URL");
  assert.equal(mapped.apiKey["local-lab"], "Key 非法");
  assert.equal(mapped.active, "删除前必须选择替代 provider");
  assert.equal(mapped.sessionNaming, "命名目标不可用");
  assert.equal(mapped.attachmentNaming, "模型不在清单");
  assert.equal(mapped.fileLevel, "配置文件无法解析");
});

test("mapFieldErrors：revision 冲突归到 conflict（横幅两动作的判据）", () => {
  const mapped = mapFieldErrors(errors([["base_revision", "配置文件已在外部修改"]]));
  assert.equal(mapped.conflict, "配置文件已在外部修改");
  assert.equal(mapped.fileLevel, null);
});

// ── 脏判定 ───────────────────────────────────────────────────────────

test("draftIsDirty：只改草稿的选定 provider 不变脏；任何字段编辑 / 增删 / 开关 / 命名选择都脏", () => {
  const base = snapshot({
    providers: [provider("kimi-work"), provider("deepseek", { preset: "deepseek" })],
  });
  const draft = createDraft(base);
  draft.selection = "deepseek";
  assert.equal(draftIsDirty(draft), false);
  assert.equal(draftProviderDirty(findProvider(draft, "kimi-work")!), false);
  draft.providers[0]!.keyEdit = { kind: "replace", value: "x" };
  assert.equal(draftIsDirty(draft), true);
  assert.equal(draftProviderDirty(draft.providers[0]!), true);
});

test("draftIsDirty：关闭命名开关（不触及其他键）算脏——显式值要落盘", () => {
  const base = snapshot();
  const draft = createDraft(base);
  draft.automation.attachment_naming = { value: false, explicit: true };
  assert.equal(draftIsDirty(draft), true);
});

// ── 反向文案与结构断言（spec 的 MUST NOT） ───────────────────────────

test("文案：会话命名的节奏不承诺「每轮生成 / 下一轮必定生效」", () => {
  const desc = COPY.D794.zh;
  assert.match(desc, /5 轮/);
  assert.equal(/每轮生成/.test(desc), false);
  assert.equal(/下一轮必定生效/.test(desc), false);
});

test("结构：设置面板源码里没有 TAB / 侧边导航与独立命名摘要框", () => {
  const source = readFileSync(path.join(root, "src/settings-panel.ts"), "utf8");
  assert.equal(/role="tab(list)?"/.test(source), false);
  assert.equal(/naming-readout/.test(source), false);
  assert.equal(/摘要/.test(source), false);
});

test("结构：单页两节——源码里恰好两个设置节（模型接入 / 自动化）", () => {
  const source = readFileSync(path.join(root, "src/settings-panel.ts"), "utf8");
  assert.equal((source.match(/element\("section", "lumir-set-section"\)/g) ?? []).length, 2);
  assert.equal((source.match(/lumir-set-section-title/g) ?? []).length, 2);
});

test("draftIsDirty：配置里本来就有显式开关 → 打开即干净（基线比较，不把既有显式值当 dirty）", () => {
  const base = snapshot();
  base.automation.auto_compact = { value: false, explicit: true };
  const draft = createDraft(base);
  assert.equal(draftIsDirty(draft), false);
  // 改回默认（显式 → 删键）才变脏，patch 带 Reset。
  draft.automation.auto_compact = { value: true, explicit: false };
  assert.equal(draftIsDirty(draft), true);
  assert.deepEqual(buildPatch(draft, base, base.revision!).automation, {
    auto_compact: { kind: "reset" },
  });
});

test("buildPatch：同一笔「新增 + 继续填字段」→ Add 后跟 Update（否则填的内容会丢）", () => {
  const base = snapshot({ providers: [], active: null });
  const draft = createDraft(base);
  const added = addProviderDraft(draft, "kimi-work", "kimi", metaOf("kimi-work", "kimi"));
  added.keyEdit = { kind: "replace", value: "test-key-1234" };
  added.models = [{ id: "k3-256k", effort: true, vision: false, window: 262144, notes: [], valid: true }];
  added.modelsEdit = [...added.models];
  const patch = buildPatch(draft, base, base.revision!);
  assert.deepEqual(patch.providers, [
    { action: "add", id: "kimi-work", preset: "kimi" },
    {
      action: "update",
      id: "kimi-work",
      api_key: { kind: "replace", value: "test-key-1234" },
      models: [{ id: "k3-256k", effort: true, vision: false, window: 262144 }],
    },
  ]);
});

test("buildPatch：删掉一条从未落盘的新增项 = 草稿撤销，不发 delete（否则后端 not_found）", () => {
  const base = snapshot();
  const draft = createDraft(base);
  addProviderDraft(draft, "tmp-lab", "generic", metaOf("tmp-lab", "generic"));
  draft.selection = "tmp-lab";
  draft.remove = { index: 1, activeAfter: "kimi-work", sessionAfter: "follow", attachmentAfter: "follow" };
  applyDraftDelete(draft);
  const patch = buildPatch(draft, base, base.revision!);
  assert.deepEqual(patch.providers, []);
  assert.equal(findProvider(draft, "tmp-lab"), null);
  assert.equal(draftIsDirty(draft), false);
});

test("applyDraftDelete：替代目标失效时回落到第一个候选，不留空 active", () => {
  const base = snapshot({
    providers: [provider("kimi-work"), provider("deepseek", { preset: "deepseek" }), provider("local-lab", { preset: "generic" })],
  });
  const draft = createDraft(base);
  draft.remove = { index: 0, activeAfter: "gone", sessionAfter: "follow", attachmentAfter: "follow" };
  applyDraftDelete(draft);
  assert.equal(draft.active, "deepseek");
});

// ── r1 返修回归：新增被拒 / 撤销 / 引用面 / 命名后端口径 ─────────────────

test("planProviderEdits：Add 的 patch 下标能被定位（后端错误路径 providers[<n>].id 的锚点）", () => {
  const base = snapshot({
    providers: [provider("kimi-work"), provider("deepseek", { preset: "deepseek" })],
  });
  const draft = createDraft(base);
  draft.providers[0]!.keyEdit = { kind: "replace", value: "k" }; // 一条 Update 插在最前
  addProviderDraft(draft, "first-new", "kimi", metaOf("first-new", "kimi"));
  addProviderDraft(draft, "second-new", "deepseek", metaOf("second-new", "deepseek"));
  const plan = planProviderEdits(draft);
  assert.deepEqual(
    plan.adds.map((item) => ({ index: item.index, id: item.id })),
    [
      { index: 1, id: "first-new" },
      { index: 2, id: "second-new" },
    ],
  );
  assert.equal(plan.edits[1]?.action, "add");
});

test("mapFieldErrors：Add 的 id 错误带 patch 下标（不靠「最后一条新增」猜）", () => {
  const mapped = mapFieldErrors([{ path: "providers[2].id", code: "settings_provider_id_duplicate", message: "已存在" }]);
  assert.equal(mapped.addId, "已存在");
  assert.equal(mapped.addIdIndex, 2);
});

test("applyDraftDelete：撤销未落盘新增恢复 active 基线（空配置加第一项再删）", () => {
  const base = snapshot({ providers: [], active: null });
  const draft = createDraft(base);
  addProviderDraft(draft, "first", "kimi", metaOf("first", "kimi"));
  assert.equal(draft.active, "first");
  draft.remove = { index: 0, activeAfter: "", sessionAfter: "follow", attachmentAfter: "follow" };
  applyDraftDelete(draft);
  assert.equal(draft.providers.length, 0);
  assert.equal(draft.active, null);
  assert.equal(draft.activeTouched, false);
  const patch = buildPatch(draft, base, base.revision!);
  assert.equal(patch.active_provider, undefined, "不能留下指向已删 id 的 active_provider");
  assert.deepEqual(patch.providers, []);
});

test("applyDraftDelete：新增前的 active 仍有条目时撤销回到它（不是 null）", () => {
  const base = snapshot({
    providers: [provider("kimi-work"), provider("deepseek", { preset: "deepseek" })],
    active: "kimi-work",
  });
  const draft = createDraft(base);
  addProviderDraft(draft, "tmp-lab", "generic", metaOf("tmp-lab", "generic"));
  // 用户在新增后把 active 切到新条目，再撤销它。
  draft.active = "tmp-lab";
  draft.activeTouched = true;
  draft.remove = { index: 2, activeAfter: "kimi-work", sessionAfter: "follow", attachmentAfter: "follow" };
  applyDraftDelete(draft);
  assert.equal(draft.active, "kimi-work");
  assert.equal(draft.activeTouched, false);
});

test("draftReferences：引用面读当前草稿（先切 active / 命名再删除仍有保护块）", () => {
  const base = snapshot({
    providers: [provider("kimi-work"), provider("deepseek", { preset: "deepseek" })],
  });
  const draft = createDraft(base);
  draft.active = "deepseek";
  draft.activeTouched = true;
  draft.naming.session = { provider: "deepseek", model: null };
  draft.naming.attachment = { provider: "deepseek", model: null };
  assert.deepEqual(draftReferences(draft, "deepseek"), {
    active: true,
    session_naming: true,
    attachment_naming: true,
  });
  // 删除计划据此带替代目标，而不是按打开时的快照静默 follow / 首个候选。
  findProvider(draft, "deepseek")!.removed = true;
  draft.remove = { index: 1, activeAfter: "kimi-work", sessionAfter: "follow", attachmentAfter: "kimi-work" };
  assert.deepEqual(buildPatch(draft, base, base.revision!).providers[0], {
    action: "delete",
    id: "deepseek",
    active_after: "kimi-work",
    session_naming_after: { kind: "follow_active" },
    attachment_naming_after: { kind: "provider", value: "kimi-work" },
  });
});

test("applyDraftDelete：删 active 且命名 follow 时当场清掉旧 model 覆盖", () => {
  const base = snapshot({
    providers: [provider("kimi-work"), provider("deepseek", { preset: "deepseek" })],
  });
  const draft = createDraft(base);
  // 两个命名目标都是「跟随当前」，但文件里有旧 model 覆盖（属于 kimi-work 的清单）。
  draft.naming.session = { provider: null, model: "k3-256k" };
  draft.naming.attachment = { provider: null, model: "k3-256k" };
  draft.remove = { index: 0, activeAfter: "deepseek", sessionAfter: "follow", attachmentAfter: "follow" };
  findProvider(draft, "kimi-work")!.removed = true;
  applyDraftDelete(draft);
  assert.deepEqual(draft.naming.session, { provider: null, model: null });
  assert.deepEqual(draft.naming.attachment, { provider: null, model: null });
  assert.equal(draft.namingTouched.session.model, true);
  assert.equal(draft.namingTouched.attachment.model, true);
});

// ── r2 返修回归：重复 id 的草稿身份（删除 / 改名都按条目、不按 id 字面） ─────────

test("addProviderDraft：当前使用项指向列表外（只剩 mock 的配置）时，新增的第一条同一笔成为当前使用", () => {
  // mock 不出现在快照的 providers 里，但可是显式写下的 active（`provider: "mock"`）。
  const base = snapshot({ providers: [], active: "mock" });
  const draft = createDraft(base);
  const added = addProviderDraft(draft, "kimi-work", "kimi", metaOf("kimi-work", "kimi"));
  assert.equal(draft.active, "kimi-work");
  assert.equal(draft.activeTouched, true);
  assert.deepEqual(buildPatch(draft, base, base.revision!).active_provider, { kind: "set", value: "kimi-work" });
  // 撤销这条新增：active 回到盘上的 mock（不是 null，也不发一笔把 mock 删掉的 reset）。
  draft.remove = { index: draft.providers.indexOf(added), activeAfter: "", sessionAfter: "follow", attachmentAfter: "follow" };
  applyDraftDelete(draft);
  assert.equal(draft.active, "mock");
  assert.equal(draft.activeTouched, false);
  assert.equal(buildPatch(draft, base, base.revision!).active_provider, undefined);
});

test("addProviderDraft：当前使用项指向列表内条目时不改写它（新增不抢当前使用）", () => {
  const base = snapshot({
    providers: [provider("kimi-work"), provider("deepseek", { preset: "deepseek" })],
    active: "kimi-work",
  });
  const draft = createDraft(base);
  addProviderDraft(draft, "local-lab", "generic", metaOf("local-lab", "generic"));
  assert.equal(draft.active, "kimi-work");
  assert.equal(draft.activeTouched, false);
});

test("applyDraftDelete：同 id 的已保存条目 + 被拒新增，计划按草稿下标删掉的是新增那条", () => {
  const base = snapshot({
    providers: [provider("kimi-work"), provider("deepseek", { preset: "deepseek" })],
    active: "kimi-work",
  });
  const draft = createDraft(base);
  // 新增撞上已有 id（后端会按重复 id 拒绝，草稿里于是两条同 id：0 = 已保存，2 = 新增）。
  addProviderDraft(draft, "kimi-work", "kimi", metaOf("kimi-work", "kimi"));
  assert.equal(draft.focusedIndex, 2);
  draft.remove = { index: 2, activeAfter: "deepseek", sessionAfter: "follow", attachmentAfter: "follow" };
  applyDraftDelete(draft);
  assert.equal(draft.providers.length, 2, "只撤销新增那条");
  assert.equal(draft.providers[0]!.id, "kimi-work");
  assert.equal(draft.providers[0]!.removed, false, "已保存的 kimi-work 不能被标成删除");
  assert.equal(draft.active, "kimi-work", "active 指的是盘上那条，撤销新增不得改写它");
  assert.equal(draft.activeTouched, false);
  assert.deepEqual(buildPatch(draft, base, base.revision!).providers, []);
});

test("applyDraftDelete：同 id 时计划指向已保存条目 → 删的是它（不误删新增草稿）", () => {
  const base = snapshot({
    providers: [provider("kimi-work"), provider("deepseek", { preset: "deepseek" })],
    active: "kimi-work",
  });
  const draft = createDraft(base);
  addProviderDraft(draft, "kimi-work", "kimi", metaOf("kimi-work", "kimi"));
  draft.remove = { index: 0, activeAfter: "deepseek", sessionAfter: "follow", attachmentAfter: "follow" };
  applyDraftDelete(draft);
  assert.equal(draft.providers[0]!.removed, true, "计划指向 0 = 已保存条目");
  assert.equal(draft.providers[2]!.added, true, "同 id 的新增草稿还在");
  assert.equal(draft.providers[2]!.removed, false);
  assert.equal(draft.active, "deepseek");
});

test("renameDraftProviderId：草稿里另有同 id 条目时，改名不动 active 与两个命名目标", () => {
  const base = snapshot({
    providers: [provider("kimi-work"), provider("deepseek", { preset: "deepseek" })],
    active: "kimi-work",
  });
  const draft = createDraft(base);
  draft.naming.session = { provider: "kimi-work", model: "k3-256k" };
  draft.naming.attachment = { provider: "kimi-work", model: "k3-256k" };
  const added = addProviderDraft(draft, "kimi-work", "kimi", metaOf("kimi-work", "kimi"));
  renameDraftProviderId(draft, added, "kimi-personal");
  assert.equal(added.id, "kimi-personal");
  // 引用按 id 字面寻址：这个 id 的实体是盘上那条已保存条目，改新增项的 id 不能把它带走。
  assert.equal(draft.active, "kimi-work");
  assert.deepEqual(draft.naming.session, { provider: "kimi-work", model: "k3-256k" });
  assert.deepEqual(draft.naming.attachment, { provider: "kimi-work", model: "k3-256k" });
  assert.equal(draft.namingTouched.session.provider, false);
  assert.equal(draft.namingTouched.attachment.provider, false);
  const patch = buildPatch(draft, base, base.revision!);
  assert.equal(patch.active_provider, undefined);
  assert.equal(patch.naming, undefined);
  assert.deepEqual(
    patch.providers,
    [{ action: "add", id: "kimi-personal", preset: "kimi" }],
    "同一笔仍是这条新增，只是 id 换成了改正后的值",
  );
});

test("renameDraftProviderId：草稿是该 id 的唯一持有者时，active 与命名目标跟着改名", () => {
  const base = snapshot({ providers: [], active: null });
  const draft = createDraft(base);
  const added = addProviderDraft(draft, "first", "kimi", metaOf("first", "kimi"));
  assert.equal(draft.active, "first", "空配置首项自动成为当前使用");
  draft.naming.session = { provider: "first", model: null };
  renameDraftProviderId(draft, added, "renamed");
  assert.equal(draft.active, "renamed");
  assert.equal(draft.naming.session.provider, "renamed");
});

test("namingRowModel：未编辑状态消费后端 resolved / model_options（与草稿自算结果不同时以后端为准）", () => {
  const base = snapshot({
    providers: [provider("kimi-work"), provider("deepseek", { preset: "deepseek" })],
    active: "deepseek",
  });
  // 后端解析：显式 provider kimi-work，但 model 因清单/资格回落成 k3-256k（草稿层看到的是同一份
  // 数据也未必同结论——这里刻意让后端的 model 与草稿首项不同，钉住「读后端」这条）。
  base.naming.session = {
    override_provider: "kimi-work",
    override_model: "k3-256k",
    provider_options: [
      { id: "kimi-work", is_active: false, configured: true },
      { id: "deepseek", is_active: true, configured: true },
    ],
    model_options: [
      { id: "backend-effective", vision: false, is_effective: true },
      { id: "k3-256k", vision: true, is_effective: false },
    ],
    resolved: {
      provider: "kimi-work",
      model: "backend-effective",
      follows_active: false,
      dangling: false,
      eligible: true,
      reason: null,
    },
  };
  const draft = createDraft(base);
  const row = namingRowModel({ kind: "session", draft, enabled: true, locked: false, snapshot: base });
  assert.match(row.note, /kimi-work \/ backend-effective/);
  assert.match(row.note, /指定目标/);
  assert.equal(row.modelValue, "k3-256k");
  assert.ok(row.modelOptions.some((item) => item.label === "生效模型（默认：backend-effective）"));
});

test("namingRowModel：valid:false 的 raw 行不算有效声明——vision 不得假绿（会话回落 / 图片跳过）", () => {
  const base = snapshot({
    providers: [
      provider("kimi-work", {
        models: [modelDraft("broken-vision", { vision: true, window: 0 })],
        model: "broken-vision",
      }),
    ],
  });
  // 草稿里这一行会被装载期丢弃（valid = false）。
  const draft = createDraft(base);
  draft.providers[0]!.models = [
    { id: "broken-vision", effort: true, vision: true, window: 0, notes: ["窗口非法"], valid: false },
  ];
  draft.providers[0]!.effectiveModel = "broken-vision";
  draft.naming.attachment = { provider: "kimi-work", model: "broken-vision" };
  draft.namingTouched.attachment.provider = true;
  draft.namingTouched.attachment.model = true;
  const attachment = namingRowModel({ kind: "attachment", draft, enabled: true, locked: false });
  assert.match(attachment.note, /未声明 vision → 粘贴图片不会改名/);
  assert.equal(/✓ vision/.test(attachment.note), false);
  assert.ok(attachment.modelOptions.some((item) => item.label.includes("不在清单，会跳过")));
  // 会话命名：覆盖模型不在（有效）清单 → 回落生效模型，而不是显示「无模型」。
  draft.naming.session = { provider: "kimi-work", model: "broken-vision" };
  draft.namingTouched.session.provider = true;
  draft.namingTouched.session.model = true;
  const session = namingRowModel({ kind: "session", draft, enabled: true, locked: false });
  assert.match(session.note, /覆盖模型 broken-vision 不在清单，已回落生效模型/);
});

test("draftEffectiveModel(validOnly)：跳过 valid:false 的行", () => {
  const base = snapshot();
  const draft = createDraft(base);
  draft.providers[0]!.models = [
    { id: "bad", effort: true, vision: false, window: 1, notes: [], valid: false },
    { id: "good", effort: true, vision: false, window: 1, notes: [], valid: true },
  ];
  draft.providers[0]!.effectiveModel = "";
  assert.equal(draftEffectiveModel(draft.providers[0]!, { validOnly: true }), "good");
});

test("errorCount：命名目标的两个错误也计入「需要修正」的计数", () => {
  const counted = errorCount({
    ...emptyFieldErrors(),
    sessionNaming: "a",
    attachmentNaming: "b",
  });
  assert.equal(counted, 2);
});
