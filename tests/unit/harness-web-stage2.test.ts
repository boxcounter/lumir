import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTOMATION_KEYS,
  addWebOriginDraft,
  buildPatch,
  clearWebOriginsDraft,
  createDraft,
  draftIsDirty,
  pageResetDraft,
  removeWebOriginDraft,
  setWebApprovalDraft,
  setWebEnabledDraft,
  webProviderDestination,
} from "../../src/settings-panel.ts";
import {
  approvalArgsText,
  approvalReasonText,
  approvalSecondaryActions,
  parseDecisionReason,
  parseWebApprovalPreview,
} from "../../src/harness-panel.ts";
import type { SettingsSnapshot } from "../../src/bindings/SettingsSnapshot.ts";
import type { ProviderSettings } from "../../src/bindings/ProviderSettings.ts";

function provider(id: string, preset: "kimi" | "deepseek" | "generic"): ProviderSettings {
  return {
    id,
    preset,
    raw_preset: preset,
    configured: preset !== "generic",
    status: preset === "generic" ? "missing_base_url" : "ok",
    api_key: { state: "unset" },
    models: [],
    model: "",
    base_url: { kind: "absent" },
    wire_api: { kind: "absent" },
    effective: {
      official_base_url: preset === "deepseek" ? "https://api.deepseek.com" : null,
      base_url: null,
      wire_api: "responses",
      models: [],
    },
    references: { active: false, session_naming: false, attachment_naming: false },
    unknown_keys: [],
  };
}

function snapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  const providers = [provider("deepseek-work", "deepseek")];
  const naming = {
    override_provider: null,
    override_model: null,
    provider_options: [],
    model_options: [],
    resolved: {
      provider: null,
      model: "",
      follows_active: true,
      dangling: false,
      eligible: false,
      reason: "no_target_provider",
    },
  };
  return {
    path: "/tmp/stage2-config.json",
    file: { state: "valid" },
    revision: "rev-stage2",
    providers,
    active: "deepseek-work",
    active_explicit: true,
    automation: {
      auto_compact: { value: true, explicit: false },
      session_naming: { value: true, explicit: false },
      attachment_naming: { value: true, explicit: false },
      subagents: { value: true, explicit: false },
    },
    naming: { session: naming, attachment: naming },
    capabilities: {
      presets: [],
      provider_id_pattern: "^[a-z0-9][a-z0-9_-]{0,31}$",
      reserved_provider_ids: ["mock"],
      provider_order: ["kimi", "deepseek", "generic", "mock"],
      model_window_min: 1n,
      model_window_max: 10_000_000n,
      web_approval_options: ["allow_all", "ask"],
    },
    defaults: {
      auto_compact: true,
      session_naming_enabled: true,
      attachment_naming_enabled: true,
      subagents_enabled: true,
      model_window: 131072n,
      web_access_enabled: true,
      web_access_approval: "allow_all",
    },
    diagnostics: [],
    web_access: {
      enabled: { kind: "absent" },
      approval: { kind: "absent" },
      effective: { enabled: true, approval: "allow_all", status: "valid" },
      invalid: null,
      provider: { provider: "deepseek", provider_id: "deepseek-work", status: "ready" },
      origins: ["https://example.com"],
    },
    ...overrides,
  };
}

test("Web 草稿独立于四个自动 LLM 开关并生成两键与 origin patch", () => {
  const draft = createDraft(snapshot());
  assert.deepEqual(AUTOMATION_KEYS, ["auto_compact", "session_naming", "attachment_naming", "subagents"]);
  assert.equal(draft.web.enabled.value, true);
  assert.equal(draft.web.enabled.explicit, false);
  assert.equal(draft.web.approval.value, "allow_all");
  assert.equal(draftIsDirty(draft), false);

  setWebEnabledDraft(draft, false);
  setWebApprovalDraft(draft, "ask");
  addWebOriginDraft(draft, "HTTPS://EXAMPLE.ORG:443/a?q=1");
  assert.equal(draftIsDirty(draft), true);
  const patch = buildPatch(draft, snapshot(), "rev-stage2");
  assert.deepEqual(patch.web_access, {
    enabled: { kind: "set", value: false },
    approval: { kind: "set", value: "ask" },
    add_origin: "HTTPS://EXAMPLE.ORG:443/a?q=1",
  });
  assert.deepEqual(patch.automation, {});
});

test("origin 单删与全清共用同一 Web patch，不改自动开关", () => {
  const draft = createDraft(snapshot());
  removeWebOriginDraft(draft, "https://example.com");
  let patch = buildPatch(draft, snapshot(), "rev-stage2");
  assert.deepEqual(patch.web_access, { remove_origin: "https://example.com" });
  clearWebOriginsDraft(draft);
  patch = buildPatch(draft, snapshot(), "rev-stage2");
  assert.deepEqual(patch.web_access, { clear_origins: true });
  assert.deepEqual(patch.automation, {});
});

test("页级还原后再改 Web enabled/approval 优先于 reset，再恢复默认仍删键", () => {
  const base = snapshot({
    web_access: {
      enabled: { kind: "present", value: { kind: "bool", text: "false" } },
      approval: { kind: "present", value: { kind: "string", text: "ask" } },
      effective: { enabled: false, approval: "ask", status: "valid" },
      invalid: null,
      provider: { provider: null, provider_id: null, status: "not_evaluated" },
      origins: ["https://example.com"],
    },
  });
  const draft = createDraft(base);
  pageResetDraft(draft, base);
  setWebEnabledDraft(draft, false);
  setWebApprovalDraft(draft, "ask");
  assert.deepEqual(buildPatch(draft, base, base.revision!).web_access, {
    enabled: { kind: "set", value: false },
    approval: { kind: "set", value: "ask" },
  });

  draft.web.enabled = { value: base.defaults.web_access_enabled, explicit: false };
  draft.web.approval = { value: base.defaults.web_access_approval, explicit: false };
  assert.deepEqual(buildPatch(draft, base, base.revision!).web_access, {
    enabled: { kind: "reset" },
    approval: { kind: "reset" },
  });
});

test("字段级编辑与页级还原组合时只保留最新意图", () => {
  const base = snapshot();
  const draft = createDraft(base);
  setWebEnabledDraft(draft, false);
  pageResetDraft(draft, base);
  setWebApprovalDraft(draft, "ask");
  assert.deepEqual(buildPatch(draft, base, base.revision!).web_access, {
    enabled: { kind: "reset" },
    approval: { kind: "set", value: "ask" },
  });
});

test("页级还原取消此前 clear/add/remove，保留已保存 deny 且允许后续新编辑", () => {
  const base = snapshot();
  for (const kind of ["clear", "add", "remove"] as const) {
    const draft = createDraft(base);
    if (kind === "clear") clearWebOriginsDraft(draft);
    if (kind === "add") addWebOriginDraft(draft, "https://example.net");
    if (kind === "remove") removeWebOriginDraft(draft, "https://example.com");
    pageResetDraft(draft, base);
    assert.equal(draft.web.originEdit, null, kind);
    assert.deepEqual(draft.web.origins, ["https://example.com"], kind);
    assert.deepEqual(buildPatch(draft, base, base.revision!).web_access, {
      enabled: { kind: "reset" },
      approval: { kind: "reset" },
    }, kind);
  }

  const draft = createDraft(base);
  clearWebOriginsDraft(draft);
  pageResetDraft(draft, base);
  addWebOriginDraft(draft, "https://example.net");
  assert.deepEqual(buildPatch(draft, base, base.revision!).web_access, {
    enabled: { kind: "reset" },
    approval: { kind: "reset" },
    add_origin: "https://example.net",
  });
});

test("页级还原的 Web 显示值与字段级还原同取 snapshot defaults", () => {
  const base = snapshot();
  base.defaults.web_access_enabled = false;
  base.defaults.web_access_approval = "ask";
  base.web_access.effective = { enabled: false, approval: "ask", status: "valid" };
  const draft = createDraft(base);
  pageResetDraft(draft, base);
  assert.deepEqual(draft.web.enabled, { value: false, explicit: false });
  assert.deepEqual(draft.web.approval, { value: "ask", explicit: false });
  assert.deepEqual(buildPatch(draft, base, base.revision!).web_access, {
    enabled: { kind: "reset" },
    approval: { kind: "reset" },
  });
});

test("provider 跳转载到实际条目；未解析时落到 DeepSeek 管理面", () => {
  const ready = snapshot();
  const draft = createDraft(ready);
  assert.deepEqual(webProviderDestination(draft, ready), { kind: "provider", id: "deepseek-work" });

  const fallback = snapshot({
    web_access: {
      ...ready.web_access,
      provider: { provider: null, provider_id: null, status: "ambiguous" },
    },
  });
  assert.deepEqual(webProviderDestination(draft, fallback), { kind: "provider", id: "deepseek-work" });

  const empty = snapshot({ providers: [], active: null });
  const emptyDraft = createDraft(empty);
  assert.deepEqual(webProviderDestination(emptyDraft, empty), { kind: "add_deepseek" });
});

test("WebAccessPolicy 与完整 Ask 载荷可解析，且不产 remember/persist 动作", () => {
  const reason = parseDecisionReason({ kind: "web_access_policy", approval: "ask" });
  assert.deepEqual(reason, { kind: "web_access_policy", approval: "ask" });
  assert.equal(approvalReasonText(reason), "网页访问策略 = Ask");
  assert.equal(approvalReasonText({ kind: "mode_default", mode: "full_access" })?.includes("网页访问策略"), false);

  const raw = {
    operation: "fetch",
    query: null,
    url: "https://example.com/a?q=1",
    origin: "https://example.com",
    provider: "deepseek",
    provider_id: "deepseek-work",
    provider_status: "ready",
    trust: "untrusted",
    local_precheck: true,
    provider_fetch: true,
    cost_per_1000_success_cny: 5,
  };
  const preview = parseWebApprovalPreview(raw);
  assert.deepEqual(preview, raw);
  assert.equal(approvalArgsText({ web: preview }), raw.url);
  assert.deepEqual(approvalSecondaryActions({ remember: undefined, persistRule: undefined }), {
    remember: undefined,
    persistRule: undefined,
  });
});

test("Search 预览保留完整 query 与空 provider，不伪造配置身份", () => {
  const raw = {
    operation: "search",
    query: "  full synthetic query  ",
    url: null,
    origin: null,
    provider: null,
    provider_id: null,
    provider_status: "missing",
    trust: "untrusted",
    local_precheck: false,
    provider_fetch: true,
    cost_per_1000_success_cny: 5,
  };
  const preview = parseWebApprovalPreview(raw);
  assert.deepEqual(preview, raw);
  assert.equal(approvalArgsText({ web: preview }), raw.query);
});
