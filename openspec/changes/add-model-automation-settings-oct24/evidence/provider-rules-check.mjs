// provider 规则判定表（M716 r3）：把 design.md §2.2–§4 的规范写成可执行纯函数，
// 用合成输入断言迁移、默认回退、命名目标解析、删除保护与 id 规则。
//
// 它不是产品代码的替代，而是**实现的测试 oracle**：提案评审时机器可复核这些规则自洽；
// 实现 PR 把同一判定表移植成 Rust 单测（tasks 7.3），之后本脚本可删除。
//
// 判据有区分度（REVIEW.md「断言等价于子串，没有区分度」条）：关键规则组配 **13 个 mutant
// 对照**（迁移 R1/R2/R3/R4/R5、configured R6、回退顺序 R8/R9、删除 R13/R15/R16/R18、id R19），
// 每个 mutant 都必须被对应检查抓红；不是「每条规则各有一个 mutant」。
//
// 跑法：node openspec/changes/add-model-automation-settings-oct24/evidence/provider-rules-check.mjs

const PRESET_RANK = { kimi: 0, deepseek: 1, generic: 2, mock: 3 };
const PRESETS = ["kimi", "deepseek", "generic", "mock"];
const RESERVED_IDS = ["mock"];
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

const clone = (value) => JSON.parse(JSON.stringify(value));

// ── 规则实现（唯一的一份） ──────────────────────────────────────────────────

/** 一次性迁移：只给旧三档补 preset；已有 preset 不覆盖；未知 id 不动。 */
function migrateProviders(providers) {
  const next = clone(providers || {});
  let rewritten = false;
  const legacy = { kimi: "kimi", deepseek: "deepseek", mock: "mock" };
  for (const [id, entry] of Object.entries(next)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (typeof entry.preset === "string") continue;
    if (!Object.prototype.hasOwnProperty.call(legacy, id)) continue;
    entry.preset = legacy[id];
    rewritten = true;
  }
  return { providers: next, rewritten };
}

/** 缺 preset 的条目按 generic + warning 解释（design §2.1/§3.1）。 */
function resolvePreset(id, entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { preset: null, warning: `harness.providers.${id} 不是对象，已忽略` };
  }
  if (Object.prototype.hasOwnProperty.call(entry, "preset")) {
    if (PRESETS.includes(entry.preset)) return { preset: entry.preset, warning: null };
    return { preset: null, warning: `harness.providers.${id}.preset 取值 ${entry.preset} 非法，已忽略` };
  }
  return { preset: "generic", warning: `harness.providers.${id}.preset 缺失，按 generic 处理` };
}

/** 可用性判据（design §2.4）。 */
function configured(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (!PRESETS.includes(entry.preset)) return false;
  const models = Array.isArray(entry.models) ? entry.models.filter((m) => m && typeof m.id === "string" && m.id.trim()) : [];
  if (entry.preset === "mock") return Boolean(entry.fixture && String(entry.fixture).trim());
  if (entry.preset === "generic") return models.length > 0 && Boolean(entry.base_url && String(entry.base_url).trim());
  return Boolean(entry.api_key && String(entry.api_key).trim()) && models.length > 0;
}

/** 合法条目（preset 合法；mock 只允许 id 恰好为 mock）。 */
function validEntries(providers) {
  const out = [];
  for (const [id, entry] of Object.entries(providers || {})) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (!PRESETS.includes(entry.preset)) continue;
    if (entry.preset === "mock" && id !== "mock") continue;
    out.push([id, entry]);
  }
  return out;
}

/** 可作为当前使用项 / 删除替代目标的条目：排除 mock 与装载期被忽略的条目，按规范顺序。 */
function selectableEntries(providers) {
  return validEntries(providers)
    .filter(([, entry]) => entry.preset !== "mock" && entry.ignored !== true)
    .sort((a, b) => (PRESET_RANK[a[1].preset] - PRESET_RANK[b[1].preset]) || a[0].localeCompare(b[0]));
}

/** 规范顺序：preset 分组 kimi → deepseek → generic → mock，组内按 id 字典序。 */
function canonicalOrder(providers) {
  return validEntries(providers)
    .map(([id, entry]) => [id, entry])
    .sort((a, b) => (PRESET_RANK[a[1].preset] - PRESET_RANK[b[1].preset]) || a[0].localeCompare(b[0]));
}

/** 当前使用项解析（design §2.5）。显式 mock 生效；缺省回退不看 mock。 */
function resolveActive(providers, requested) {
  const entries = validEntries(providers);
  const requestedValid = requested && entries.some(([id]) => id === requested);
  if (requestedValid) return { active: requested, fallback: false, configuredPick: configured(providers[requested]) };
  const ordered = selectableEntries(providers);
  const picked = ordered.find(([, entry]) => configured(entry)) || ordered[0];
  return { active: picked ? picked[0] : null, fallback: Boolean(requested || picked), configuredPick: Boolean(picked && configured(picked[1])) };
}

/** 命名目标解析（design §2.6）；model 覆盖属于旧目标时清除。 */
function resolveNamingTarget(providers, active, override) {
  if (override && providers[override] && validEntries(providers).some(([id]) => id === override)) {
    return { provider: override, dangling: false, followsActive: false };
  }
  return { provider: active, dangling: Boolean(override), followsActive: true };
}

/** provider id 校验（design §2.3）。返回 null 或稳定错误码。 */
function validateProviderId(id, existing) {
  const value = String(id == null ? "" : id).trim();
  if (value === "") return "settings_provider_id_invalid";
  if (!ID_RE.test(value)) return "settings_provider_id_invalid";
  if (RESERVED_IDS.includes(value)) return "settings_provider_reserved_id";
  if ((existing || []).includes(value)) return "settings_provider_id_duplicate";
  return null;
}

/**
 * 删除计划（design §4.2）。state = { providers, active, naming: { session: {provider, model}, attachment: {provider, model} } }
 * options = { activeAfter, sessionAfter, attachmentAfter }，naming after 取 "follow" | provider id。
 * 返回 { ok, errors, next }；next 仅在 ok 时存在。
 */
function planDelete(state, id, options) {
  const opts = options || {};
  const errors = [];
  const providers = clone(state.providers || {});
  if (!providers[id]) {
    errors.push({ code: "settings_provider_not_found", path: `harness.providers.${id}` });
    return { ok: false, errors };
  }
  const remaining = selectableEntries(providers).map(([pid]) => pid).filter((pid) => pid !== id);
  const activeRef = state.active === id;
  const sessionRef = state.naming && state.naming.session && state.naming.session.provider === id;
  const attachmentRef = state.naming && state.naming.attachment && state.naming.attachment.provider === id;

  let nextActive = state.active;
  if (activeRef) {
    if (remaining.length) {
      if (!opts.activeAfter || !remaining.includes(opts.activeAfter)) {
        errors.push({ code: "settings_provider_delete_active_requires_target", path: "harness.provider" });
      } else {
        nextActive = opts.activeAfter;
      }
    } else {
      nextActive = null;
    }
  } else if (state.active && !providers[state.active] && remaining.length) {
    nextActive = resolveActive(providers, state.active).active;
  }

  const resolveRetarget = (kind, referenced, after) => {
    if (!referenced) return { provider: state.naming[kind].provider, model: state.naming[kind].model };
    if (!after) {
      errors.push({ code: "settings_provider_delete_referenced", path: `harness.${kind === "session" ? "session_naming" : "attachment_naming"}.provider` });
      return null;
    }
    if (after === "follow") return { provider: null, model: null };
    if (after === id || !remaining.includes(after)) {
      errors.push({ code: "settings_naming_target_missing", path: `harness.${kind === "session" ? "session_naming" : "attachment_naming"}.provider` });
      return null;
    }
    return { provider: after, model: null };
  };

  const nextSession = resolveRetarget("session", sessionRef, opts.sessionAfter);
  const nextAttachment = resolveRetarget("attachment", attachmentRef, opts.attachmentAfter);
  // 删除的是 active 且命名目标「跟随 active」：目标隐式改变，模型覆盖同样清除。
  if (activeRef && state.naming && state.naming.session.provider === null) {
    if (nextSession) nextSession.model = null;
  }
  if (activeRef && state.naming && state.naming.attachment.provider === null) {
    if (nextAttachment) nextAttachment.model = null;
  }

  if (errors.length) return { ok: false, errors };

  delete providers[id];
  return {
    ok: true,
    errors: [],
    next: {
      providers,
      active: nextActive,
      naming: {
        session: nextSession || { provider: null, model: null },
        attachment: nextAttachment || { provider: null, model: null },
      },
    },
  };
}

// ── 断言框架 ────────────────────────────────────────────────────────────────

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// ── 迁移 ────────────────────────────────────────────────────────────────────

const LEGACY = {
  kimi: { api_key: "sk-a", models: [{ id: "k3-256k", effort: true, vision: true, window: 262144 }], extra: { keep: true } },
  deepseek: { api_key: "sk-b", models: [{ id: "ds-chat", effort: false, vision: false, window: 131072 }] },
  mock: { fixture: "/tmp/fixture.json" },
};

check("R1 旧三档补齐 preset，其余键逐字不变", () => {
  const { providers, rewritten } = migrateProviders(LEGACY);
  assert(rewritten === true, "legacy config must rewrite");
  eq(Object.keys(providers), ["kimi", "deepseek", "mock"], "ids");
  eq(providers.kimi.preset, "kimi", "kimi preset");
  eq(providers.deepseek.preset, "deepseek", "deepseek preset");
  eq(providers.mock.preset, "mock", "mock preset");
  eq(providers.kimi.extra, { keep: true }, "unknown sub-key preserved");
  eq(providers.kimi.api_key, "sk-a", "api_key unchanged");
});

check("R2 迁移幂等：第二次不再改写", () => {
  const once = migrateProviders(LEGACY).providers;
  const twice = migrateProviders(once);
  assert(twice.rewritten === false, "second migration must not rewrite");
  eq(twice.providers, once, "idempotent result");
});

check("R3 显式 preset 优先，不被迁移覆盖", () => {
  const raw = { kimi: { preset: "generic", base_url: "http://127.0.0.1:8080/v1" } };
  const { providers, rewritten } = migrateProviders(raw);
  assert(rewritten === false, "explicit preset must not rewrite");
  eq(providers.kimi.preset, "generic", "explicit preset preserved");
});

check("R4 未知 id 不迁移，且按 generic + warning 解释", () => {
  const raw = { openai: { api_key: "sk-x", models: [{ id: "m" }] } };
  const { providers, rewritten } = migrateProviders(raw);
  assert(rewritten === false, "unknown id must not migrate");
  assert(!("preset" in providers.openai), "unknown id must not receive a preset");
  const resolved = resolvePreset("openai", providers.openai);
  eq(resolved.preset, "generic", "missing preset resolves to generic");
  assert(/缺失/.test(resolved.warning || ""), `missing-preset warning expected, got ${resolved.warning}`);
  assert(configured(providers.openai) === false, "generic entry without base_url is not configured");
});

check("R5 迁移不丢未知键、不改值", () => {
  const raw = { kimi: { api_key: "sk-a", models: [{ id: "m", future: 1 }], custom: "x" } };
  const { providers } = migrateProviders(raw);
  eq(providers.kimi.custom, "x", "entry unknown key");
  eq(providers.kimi.models[0].future, 1, "model unknown key");
  eq(providers.kimi.preset, "kimi", "preset added");
});

// mutant：覆盖显式 preset 的迁移必须被抓红。
function mutantOverwritePreset(providers) {
  const next = clone(providers);
  const legacy = { kimi: "kimi", deepseek: "deepseek", mock: "mock" };
  for (const [id, entry] of Object.entries(next)) {
    if (entry && typeof entry === "object" && legacy[id]) entry.preset = legacy[id];
  }
  return { providers: next, rewritten: true };
}
check("R3m mutant（覆盖显式预设）被 R3 抓住", () => {
  const raw = { kimi: { preset: "generic" } };
  assert(mutantOverwritePreset(raw).providers.kimi.preset === "kimi", "mutant must wrongly overwrite");
  assert(migrateProviders(raw).providers.kimi.preset === "generic", "correct migration must preserve the explicit preset");
});

// ── 可用性与 active 回退 ────────────────────────────────────────────────────

const FULL = {
  kimi: { preset: "kimi", api_key: "sk-a", models: [{ id: "k3-256k" }] },
  deepseek: { preset: "deepseek", api_key: "sk-b", models: [{ id: "ds-chat" }] },
  "local-lab": { preset: "generic", base_url: "http://127.0.0.1:8080/v1", models: [{ id: "local-chat" }] },
};

check("R6 configured 判据按预设分叉", () => {
  assert(configured(FULL.kimi) === true, "kimi with key + model");
  assert(configured({ preset: "kimi", api_key: "sk", models: [] }) === false, "kimi without models");
  assert(configured({ preset: "kimi", api_key: "", models: [{ id: "m" }] }) === false, "kimi without key");
  assert(configured({ preset: "generic", base_url: "http://x/v1", models: [{ id: "m" }] }) === true, "generic without key");
  assert(configured({ preset: "generic", base_url: "", models: [{ id: "m" }] }) === false, "generic without base_url");
  assert(configured({ preset: "mock", fixture: "/tmp/f" }) === true, "mock with fixture");
  assert(configured({ preset: "mock", fixture: "" }) === false, "mock without fixture");
});

check("R7 active 显式合法时保持（即使未配置）", () => {
  const providers = { kimi: FULL.kimi, deepseek: { preset: "deepseek", api_key: "", models: [] } };
  const res = resolveActive(providers, "deepseek");
  eq(res.active, "deepseek", "explicit active");
  assert(res.configuredPick === false, "explicit unconfigured must be reported");
  assert(res.fallback === false, "no fallback");
});

check("R8 缺省 active 优先第一个 configured（不是字典序第一个）", () => {
  const providers = {
    kimi: { preset: "kimi", api_key: "", models: [] },
    deepseek: FULL.deepseek,
    "local-lab": FULL["local-lab"],
  };
  const res = resolveActive(providers, null);
  eq(res.active, "deepseek", "configured provider wins over kimi");
  assert(res.configuredPick === true, "picked configured");
});

check("R9 全部未配置时按规范顺序取第一个合法条目", () => {
  const providers = {
    "aaa-generic": { preset: "generic", base_url: "", models: [] },
    kimi: { preset: "kimi", api_key: "", models: [] },
  };
  const res = resolveActive(providers, null);
  eq(res.active, "kimi", "preset order beats lexicographic order");
});

check("R10 空映射 → 无 active；悬空 → 回退 + warning 位", () => {
  eq(resolveActive({}, null).active, null, "empty map");
  const res = resolveActive(FULL, "deleted-one");
  eq(res.active, "kimi", "dangling falls back to first configured");
  assert(res.fallback === true, "fallback flag");
});

check("R10b mock 不被缺省回退自动选中", () => {
  const providers = { mock: { preset: "mock", fixture: "/tmp/f" }, kimi: { preset: "kimi", api_key: "", models: [] } };
  eq(resolveActive(providers, null).active, "kimi", "fallback skips mock and picks the ordinary provider");
  eq(resolveActive(providers, "mock").active, "mock", "explicit mock still works");
  eq(resolveActive({ mock: { preset: "mock", fixture: "/tmp/f" } }, null).active, null, "only mock → no active");
});

// mutant：按声明顺序取第一个（而不是 configured 优先）必须被 R8 抓红。
function mutantFirstDeclaredActive(providers) {
  const ids = Object.keys(providers).filter((id) => providers[id] && PRESETS.includes(providers[id].preset));
  return { active: ids[0] || null };
}
check("R8m mutant（按声明顺序取第一个）被 R8 抓住", () => {
  const providers = { kimi: { preset: "kimi", api_key: "", models: [] }, deepseek: FULL.deepseek };
  assert(mutantFirstDeclaredActive(providers).active === "kimi", "mutant must pick the unconfigured first entry");
  assert(resolveActive(providers, null).active === "deepseek", "correct implementation must pick the configured provider");
});

// ── 命名目标 ────────────────────────────────────────────────────────────────

check("R11 命名目标：覆盖合法 → 用它；悬空 → 回落 active 并标记", () => {
  eq(resolveNamingTarget(FULL, "kimi", "deepseek"), { provider: "deepseek", dangling: false, followsActive: false }, "valid override");
  eq(resolveNamingTarget(FULL, "kimi", "deleted-one"), { provider: "kimi", dangling: true, followsActive: true }, "dangling override");
  eq(resolveNamingTarget(FULL, "kimi", null), { provider: "kimi", dangling: false, followsActive: true }, "no override");
});

check("R12 命名目标的 mock 只认 id=mock", () => {
  const providers = { mock: { preset: "mock", fixture: "/tmp/f" }, "local-mock": { preset: "mock", fixture: "/tmp/f" } };
  eq(resolveNamingTarget(providers, "mock", "local-mock").provider, "mock", "local-mock is not a valid target");
});

// ── 删除保护 ────────────────────────────────────────────────────────────────

const DELETE_STATE = {
  providers: clone(FULL),
  active: "kimi",
  naming: { session: { provider: "kimi", model: "k3-256k" }, attachment: { provider: null, model: null } },
};

check("R13 删除 active 缺替代目标 → 拒绝，文件不动", () => {
  const res = planDelete(DELETE_STATE, "kimi", { sessionAfter: "follow" });
  assert(res.ok === false, "must block");
  assert(res.errors.some((e) => e.code === "settings_provider_delete_active_requires_target"), "active target error");
  assert(!res.next, "no next state");
});

check("R14 删除被命名引用的项缺重定向 → 拒绝", () => {
  const res = planDelete(DELETE_STATE, "kimi", { activeAfter: "deepseek" });
  assert(res.ok === false, "must block");
  assert(res.errors.some((e) => e.code === "settings_provider_delete_referenced"), "naming retarget error");
});

check("R15 删除 active + 命名引用，带替代目标 → 原子改写并清模型覆盖", () => {
  const res = planDelete(DELETE_STATE, "kimi", { activeAfter: "local-lab", sessionAfter: "follow", attachmentAfter: "follow" });
  assert(res.ok === true, `expected ok, got ${JSON.stringify(res.errors)}`);
  eq(res.next.active, "local-lab", "active retargeted");
  assert(!("kimi" in res.next.providers), "entry removed");
  eq(res.next.naming.session, { provider: null, model: null }, "naming follows active, model cleared");
});

check("R16 删除最后一个 provider → active 与命名目标全部清空", () => {
  const state = {
    providers: { kimi: FULL.kimi },
    active: "kimi",
    naming: { session: { provider: "kimi", model: "k3-256k" }, attachment: { provider: "kimi", model: "k3-256k" } },
  };
  const res = planDelete(state, "kimi", { sessionAfter: "follow", attachmentAfter: "follow" });
  assert(res.ok === true, `expected ok, got ${JSON.stringify(res.errors)}`);
  eq(res.next.active, null, "no active");
  eq(res.next.naming.session, { provider: null, model: null }, "session cleared");
  eq(res.next.naming.attachment, { provider: null, model: null }, "attachment cleared");
});

check("R16b 映射里还有 mock 时，删最后一个普通 provider 仍按「最后一个」处理", () => {
  const state = {
    providers: { kimi: FULL.kimi, mock: { preset: "mock", fixture: "/tmp/f" } },
    active: "kimi",
    naming: { session: { provider: null, model: null }, attachment: { provider: null, model: null } },
  };
  const res = planDelete(state, "kimi", {});
  assert(res.ok === true, `expected ok, got ${JSON.stringify(res.errors)}`);
  eq(res.next.active, null, "active is empty even though mock remains");
  assert("mock" in res.next.providers, "mock entry preserved");
});

check("R17 删除非引用项不动 active / 命名", () => {
  const state = {
    providers: clone(FULL),
    active: "kimi",
    naming: { session: { provider: "deepseek", model: "ds-chat" }, attachment: { provider: null, model: null } },
  };
  const res = planDelete(state, "local-lab", {});
  assert(res.ok === true, `expected ok, got ${JSON.stringify(res.errors)}`);
  eq(res.next.active, "kimi", "active unchanged");
  eq(res.next.naming.session, { provider: "deepseek", model: "ds-chat" }, "session unchanged");
});

check("R18 重定向到不存在的 id → 拒绝", () => {
  const res = planDelete(DELETE_STATE, "kimi", { activeAfter: "ghost", sessionAfter: "ghost" });
  assert(res.ok === false, "must block");
  assert(res.errors.some((e) => e.code === "settings_naming_target_missing" || e.code === "settings_provider_delete_active_requires_target"), "target error");
});

check("R18b mock 不能作为替代目标", () => {
  const state = clone(DELETE_STATE);
  state.providers.mock = { preset: "mock", fixture: "/tmp/f" };
  const res = planDelete(state, "kimi", { activeAfter: "mock", sessionAfter: "follow", attachmentAfter: "follow" });
  assert(res.ok === false, "must block mock as active_after");
  assert(res.errors.some((e) => e.code === "settings_provider_delete_active_requires_target"), "mock is not a valid replacement");
});

// mutant：允许删 active 无替代 → 被 R13 抓红。
function mutantAllowActiveDelete(state, id, options) {
  const providers = clone(state.providers);
  delete providers[id];
  return { ok: true, errors: [], next: { providers, active: state.active, naming: state.naming } };
}
check("R13m mutant（允许无替代删 active）被 R13 抓住", () => {
  assert(mutantAllowActiveDelete(DELETE_STATE, "kimi", {}).ok === true, "mutant must allow");
  assert(planDelete(DELETE_STATE, "kimi", { sessionAfter: "follow" }).ok === false, "correct implementation must block");
});

// mutant：只删条目、不重定向命名 → 被 R15 抓红。
function mutantForgetNaming(state, id, options) {
  const providers = clone(state.providers);
  delete providers[id];
  return { ok: true, errors: [], next: { providers, active: options.activeAfter || null, naming: state.naming } };
}
check("R15m mutant（不重定向命名）被 R15 抓住", () => {
  const m = mutantForgetNaming(DELETE_STATE, "kimi", { activeAfter: "local-lab" });
  eq(m.next.naming.session.provider, "kimi", "mutant leaves dangling naming");
  const correct = planDelete(DELETE_STATE, "kimi", { activeAfter: "local-lab", sessionAfter: "follow", attachmentAfter: "follow" });
  eq(correct.next.naming.session.provider, null, "correct implementation clears naming");
});

// ── id 规则 ─────────────────────────────────────────────────────────────────

check("R19 id 规则：合法 / 非法 / 保留 / 重复", () => {
  const existing = ["kimi", "deepseek"];
  eq(validateProviderId("kimi-work", existing), null, "kebab id");
  eq(validateProviderId("kimi_personal_2", existing), null, "underscore + digit");
  eq(validateProviderId("Kimi Work", existing), "settings_provider_id_invalid", "uppercase + space");
  eq(validateProviderId("kimi.work", existing), "settings_provider_id_invalid", "dot");
  eq(validateProviderId("", existing), "settings_provider_id_invalid", "empty");
  eq(validateProviderId("a".repeat(33), existing), "settings_provider_id_invalid", "too long");
  eq(validateProviderId("mock", existing), "settings_provider_reserved_id", "reserved");
  eq(validateProviderId("kimi", existing), "settings_provider_id_duplicate", "duplicate");
});

// mutant：允许大写 / 点的校验器 → R19 抓红。
function mutantLooseId(id, existing) {
  if (existing.includes(id)) return "settings_provider_id_duplicate";
  return null;
}
check("R19m mutant（放过大写 / 点）被 R19 抓住", () => {
  eq(mutantLooseId("Kimi.work", []), null, "mutant accepts bad id");
  assert(validateProviderId("Kimi.work", []) === "settings_provider_id_invalid", "correct implementation rejects");
});

// ── 其余关键规则组的 mutant 对照（共 13 个 mutant） ───────────────────────────

function mutantNoLegacyMigration(providers) {
  return { providers: clone(providers), rewritten: false };
}
check("R1m mutant（旧三档不补 preset）被 R1 抓住", () => {
  const mutated = mutantNoLegacyMigration(LEGACY).providers;
  assert(!("preset" in mutated.kimi), "mutant must leave the legacy entry without preset");
  eq(migrateProviders(LEGACY).providers.kimi.preset, "kimi", "correct migration adds the preset");
});

function mutantAlwaysRewrite(providers) {
  const result = migrateProviders(providers);
  return { providers: result.providers, rewritten: true };
}
check("R2m mutant（永远报告 rewritten）被 R2 抓住", () => {
  const once = migrateProviders(LEGACY).providers;
  assert(mutantAlwaysRewrite(once).rewritten === true, "mutant must always rewrite");
  assert(migrateProviders(once).rewritten === false, "correct migration is idempotent");
});

function mutantMissingPresetNoWarning(id, entry) {
  return { preset: entry.preset === undefined ? "generic" : entry.preset, warning: null };
}
check("R4m mutant（缺 preset 不告警）被 R4 抓住", () => {
  const raw = { openai: { api_key: "sk-x" } };
  const mutated = mutantMissingPresetNoWarning("openai", raw.openai);
  assert(mutated.warning === null, "mutant drops the missing-preset warning");
  assert(/缺失/.test(resolvePreset("openai", raw.openai).warning || ""), "correct resolution keeps the warning");
});

function mutantDropUnknownKeys(providers) {
  const next = clone(providers);
  const legacy = { kimi: "kimi", deepseek: "deepseek", mock: "mock" };
  for (const [id, entry] of Object.entries(next)) {
    if (!entry || typeof entry !== "object") continue;
    next[id] = { preset: entry.preset || legacy[id] || "generic", api_key: entry.api_key, models: entry.models };
  }
  return { providers: next, rewritten: true };
}
check("R5m mutant（迁移丢未知键）被 R5 抓住", () => {
  const raw = { kimi: { api_key: "sk-a", models: [{ id: "m" }], custom: "x" } };
  assert(!("custom" in mutantDropUnknownKeys(raw).providers.kimi), "mutant drops the unknown key");
  eq(migrateProviders(raw).providers.kimi.custom, "x", "correct migration preserves the unknown key");
});

function mutantGenericConfiguredWithoutBaseUrl(entry) {
  if (entry && entry.preset === "generic") return Array.isArray(entry.models) && entry.models.length > 0;
  return configured(entry);
}
check("R6m mutant（generic 不看 base_url）被 R6 抓住", () => {
  const entry = { preset: "generic", models: [{ id: "m" }] };
  assert(mutantGenericConfiguredWithoutBaseUrl(entry) === true, "mutant says configured");
  assert(configured(entry) === false, "correct predicate requires base_url");
});

function mutantFirstById(providers) {
  const ordered = selectableEntries(providers).slice().sort((a, b) => a[0].localeCompare(b[0]));
  const picked = ordered.find(([, entry]) => configured(entry)) || ordered[0];
  return { active: picked ? picked[0] : null };
}
check("R9m mutant（按 id 而不是 preset 顺序）被 R9 抓住", () => {
  const providers = {
    "aaa-generic": { preset: "generic", base_url: "", models: [] },
    kimi: { preset: "kimi", api_key: "", models: [] },
  };
  eq(mutantFirstById(providers).active, "aaa-generic", "mutant picks by id");
  eq(resolveActive(providers, null).active, "kimi", "correct fallback follows preset order");
});

function mutantKeepActive(state, id) {
  const providers = clone(state.providers);
  delete providers[id];
  return { ok: true, errors: [], next: { providers, active: state.active, naming: state.naming } };
}
check("R16m mutant（删最后一个仍保留 active）被 R16 抓住", () => {
  const state = {
    providers: { kimi: FULL.kimi },
    active: "kimi",
    naming: { session: { provider: null, model: null }, attachment: { provider: null, model: null } },
  };
  eq(mutantKeepActive(state, "kimi").next.active, "kimi", "mutant keeps the dangling active id");
  eq(planDelete(state, "kimi", {}).next.active, null, "correct plan clears active");
});

function mutantRetargetAcceptsMock(state, id, options) {
  const providers = clone(state.providers);
  delete providers[id];
  return { ok: true, errors: [], next: { providers, active: options.activeAfter || null, naming: state.naming } };
}
check("R18m mutant（允许 mock 作替代）被 R18b 抓住", () => {
  const state = clone(DELETE_STATE);
  state.providers.mock = { preset: "mock", fixture: "/tmp/f" };
  eq(mutantRetargetAcceptsMock(state, "kimi", { activeAfter: "mock" }).next.active, "mock", "mutant accepts mock");
  assert(planDelete(state, "kimi", { activeAfter: "mock", sessionAfter: "follow", attachmentAfter: "follow" }).ok === false, "correct plan rejects mock");
});

const failed = results.filter((entry) => !entry.ok);
console.log(`\nRESULT: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
if (failed.length) process.exitCode = 1;
