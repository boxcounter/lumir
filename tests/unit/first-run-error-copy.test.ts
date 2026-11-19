// M852 — 首次安装的错误上屏文案（M849 finding 两条）：harness 错误行绕过文案表、设置面板
// 非法 provider id 未本地化。
// M858 — 同类缺口收口：设置面板其余十条字段错误、`config_parse_failed` 的字段错误档、两条
// 流式事件字面量码（`harness_internal_error` / `harness_empty_response`）。
//
// 三条判据都是**机械的**（不靠人读上屏效果）：
//   ① en 界面的错误行不含中文（后端 message 是 Rust 侧中文原文，直接上屏即缺陷）；
//   ② 不含内部 URL / reqwest 原始技术串 / API key（真机现场：`error sending request for url
//      (http://127.0.0.1:9/v1/chat/completions)`）；
//   ③ 给出可行动方向（指向设置面板 / 网络与接入配置 / 重新载入 / 重试），不是一句干巴巴的「失败了」。
//
// 判据的区分度（REVIEW.md「断言等价于子串」条）：每条负向断言都配一条**正观测**——把后端
// 原始 message / params 喂给同一组谓词，必须命中；否则「不含中文 / 不含 URL」恒真，等于没判。

import assert from "node:assert/strict";
import { test } from "node:test";
import { COPY, FIELD_ERROR_COPY } from "../../src/copy-data.ts";
import { errorText, t } from "../../src/copy.ts";
import { localizeModelNotes, mapFieldErrors } from "../../src/settings-panel.ts";
import type { SettingsSnapshot } from "../../src/bindings/SettingsSnapshot.ts";

/** CJK 统一表意文字（含扩展 A 与兼容区）：en 上屏出现任何一个都算漏译。 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** 真机现场（M849 §C）：generic provider 指向 127.0.0.1:9 时后端给出的 message 与 params。 */
const NET_MESSAGE =
  "LLM 请求发送失败：error sending request for url (http://127.0.0.1:9/v1/chat/completions)";
const NET_REASON = "error sending request for url (http://127.0.0.1:9/v1/chat/completions)";

/** 无 provider 时 `send_preflight` 的信封（`src-tauri/src/harness/llm.rs`，无 params）。 */
const PROVIDER_MESSAGE =
  "还没有可用的 provider：请在设置面板添加一个 provider（或检查 config.json 的 harness.providers 条目是否合法）";

function assertNoInternalDetail(text: string, label: string): void {
  assert.ok(!CJK.test(text), `${label}：en 上屏不得含中文：${text}`);
  assert.ok(!/https?:\/\//i.test(text), `${label}：上屏不得出现任何 URL：${text}`);
  assert.ok(!text.includes("127.0.0.1"), `${label}：上屏不得出现内部端点：${text}`);
  assert.ok(!/error sending request/i.test(text), `${label}：不得把 reqwest 原始串当文案：${text}`);
  assert.ok(!/reqwest|hyper|tcp/i.test(text), `${label}：不得把传输层技术名当文案：${text}`);
  // 凭据与技术栈线索同样不上屏（错误文案不是诊断面）。
  assert.ok(!/(sk-[A-Za-z0-9]|Bearer\s|api[-_ ]?key\s*[:=])/i.test(text), `${label}：上屏不得出现凭据：${text}`);
  assert.ok(!/panic|stack trace|thread '/i.test(text), `${label}：上屏不得出现 Rust 技术串：${text}`);
}

test("网络失败：en 上屏是本地化整句，不含内部 URL 与 reqwest 原始串", () => {
  const envelope = { code: "harness_network_failed", message: NET_MESSAGE, params: { reason: NET_REASON } };
  const en = errorText(envelope, "en");
  assertNoInternalDetail(en, "harness_network_failed/en");
  assert.match(en, /network|provider/i, `要指出可行动方向（网络 / provider 接入）：${en}`);

  // 反向判据：同一组谓词喂后端原文必须命中——否则上面的负向断言没有区分度。
  assert.ok(CJK.test(NET_MESSAGE), "后端 message 确实是中文（负向断言的前提）");
  assert.ok(/https?:\/\//i.test(NET_REASON), "后端 params.reason 确实带内部 URL（负向断言的前提）");
  assert.ok(/error sending request/i.test(NET_REASON));
});

test("网络失败：zh 上屏同样不插内部 URL / 原始技术串", () => {
  const envelope = { code: "harness_network_failed", message: NET_MESSAGE, params: { reason: NET_REASON } };
  const zh = errorText(envelope, "zh");
  assert.ok(CJK.test(zh), `zh 上屏应是中文（正观测）：${zh}`);
  assert.ok(!/https?:\/\//i.test(zh), `zh 上屏不得出现 URL：${zh}`);
  assert.ok(!zh.includes("127.0.0.1"), `zh 上屏不得出现内部端点：${zh}`);
  assert.ok(!/error sending request/i.test(zh), `zh 上屏不得出现 reqwest 原始串：${zh}`);
  assert.match(zh, /网络/, `zh 要指出可行动方向：${zh}`);
});

test("无 provider：发送失败行在 en / zh 两档都本地化并可行动", () => {
  const envelope = { code: "harness_provider_missing", message: PROVIDER_MESSAGE };
  assert.ok(CJK.test(PROVIDER_MESSAGE), "后端 message 是中文原文（负向断言的前提）");

  const en = errorText(envelope, "en");
  assert.ok(!CJK.test(en), `en 上屏不得含中文：${en}`);
  assert.match(en, /settings/i, `en 要指向设置面板：${en}`);

  const zh = errorText(envelope, "zh");
  assert.ok(CJK.test(zh), `zh 上屏应是中文（正观测）：${zh}`);
  assert.match(zh, /设置/, `zh 要指向设置面板：${zh}`);

  // 组合形态 = 面板实际拼出的那一行（`appendError(t("D347", {reason: …}))`）。
  const enLine = t("D347", { reason: en }, "en");
  assert.ok(!CJK.test(enLine), `完整错误行不得含中文：${enLine}`);
  assert.match(enLine, /settings/i);
  const zhLine = t("D347", { reason: zh }, "zh");
  assert.ok(CJK.test(zhLine), `zh 完整错误行应是中文：${zhLine}`);
});

test("流式 error 事件：只带 {code, message} 时也按 code 取本地化文案", () => {
  // 事件载荷形状见 `src-tauri/src/harness/events.rs` 的 `error(code, message)`：没有 params，
  // 因此文案表里被流式路径消费的条目必须**不带占位**（带占位的会走 errorText 的缺参兜底）。
  const event = { code: "harness_provider_missing", message: PROVIDER_MESSAGE };
  const line = t("D348", { message: errorText(event, "en") }, "en");
  assert.ok(!CJK.test(line), `流式错误行不得含中文：${line}`);
  assert.match(line, /settings/i);

  // 网络失败同样只带 code + message：上屏不得回落到带内部 URL 的 message。
  const netLine = t("D348", { message: errorText({ code: "harness_network_failed", message: NET_MESSAGE }, "en") }, "en");
  assertNoInternalDetail(netLine, "harness:event error/en");
  assert.match(netLine, /network|provider/i);
});

test("设置面板字段错误：三个 provider id 校验 code 在 en 下都是英文", () => {
  // 真机现场（M849）：Add provider → id=Bad.Id → Save ⇒ 字段错误行是 Rust 硬编码中文。
  const fields = [
    {
      code: "settings_provider_id_invalid",
      message:
        'provider id "Bad.Id" 非法：只能用小写字母 / 数字 / - / _，首字符必须是字母或数字，至多 32 字符、不含点',
      expect: /provider id/i,
    },
    {
      code: "settings_provider_reserved_id",
      message: "mock 是验收专用的保留 id，不能新增",
      expect: /reserved/i,
    },
    {
      code: "settings_provider_id_duplicate",
      message: 'provider id "kimi" 已存在（或被本笔删除）：新增 MUST NOT 复用同一笔里删掉的 id，请拆成两次保存',
      expect: /already exists|another id/i,
    },
  ];
  for (const field of fields) {
    // `SettingsFieldError` 只有 {path, code, message}——这正是面板传给 errorText 的形状。
    const envelope = { path: "providers[0].id", code: field.code, message: field.message };

    const en = errorText(envelope, "en");
    assert.ok(!CJK.test(en), `${field.code}/en 不得含中文：${en}`);
    assert.match(en, field.expect, `${field.code}/en 措辞不对：${en}`);

    const zh = errorText(envelope, "zh");
    assert.ok(CJK.test(zh), `${field.code}/zh 应是中文（正观测）：${zh}`);
    assert.notEqual(en, zh, `${field.code}：两档必须是两份文案，不是同一句`);

    // 反向判据：后端原文确实是中文（上面的 en 断言有区分度）。
    assert.ok(CJK.test(field.message));
  }
  // 英文列与中文列确实不同（不是把英文列抄成中文）。
  assert.notEqual(COPY.D883.en, COPY.D883.zh);
});

test("既有契约不回退：带占位但缺参的 code 仍回落后端 message", () => {
  // errorText 的缺参兜底是既有契约（copy.ts 文件头）——本 mission 的改动只换调用点与模板，
  // MUST NOT 顺手改掉「缺参不打屏、回落 message」这一条。
  assert.equal(errorText({ code: "fs_not_found", message: "文件不存在：a.md" }, "en"), "文件不存在：a.md");
  assert.equal(errorText({ code: "no_such_code", message: "人话" }, "en"), "人话");
});

// ---------------------------------------------------------------------------
// M858：设置面板其余字段错误 / 两栖 config_parse_failed / 流式事件字面量码
// ---------------------------------------------------------------------------

/** 十条字段错误的现场 message：逐条取自 `src-tauri/src/settings.rs` 的 `field_error` 模板，
 *  只把 provider id / 模型名换成 fixture 值。`expect` / `zhExpect` 是**可行动方向**的关键词。 */
const SETTINGS_FIELD_CASES = [
  {
    code: "settings_patch_invalid",
    path: "",
    message: "patch 形状非法：unknown variant `setx`, expected `set` or `reset`",
    expect: /format|reload/i,
    zhExpect: /格式|重新载入/,
    key: "D886",
  },
  {
    code: "settings_unknown_field",
    path: "harness.unknown",
    message: "patch 里出现设置通道未定义的字段 harness.unknown",
    expect: /recognize|reload/i,
    zhExpect: /不认识|重载/,
    key: "D887",
  },
  {
    code: "settings_revision_conflict",
    path: "base_revision",
    message: "配置文件已在外部修改：请重新载入后再保存，或以本页为准重新应用",
    expect: /reload|apply/i,
    zhExpect: /重新载入|重新应用/,
    key: "D888",
  },
  {
    code: "settings_provider_not_found",
    path: "harness.providers.ghost",
    message: 'provider "ghost" 不存在或已被装载期忽略，无法编辑',
    expect: /exist|ignored|reload/i,
    zhExpect: /不存在|忽略/,
    key: "D889",
  },
  {
    code: "settings_active_provider_missing",
    path: "harness.provider",
    message: '替代的当前使用项 "ghost" 不是可用的 provider',
    expect: /active|provider/i,
    zhExpect: /当前使用|provider/,
    key: "D890",
  },
  {
    code: "settings_provider_preset_immutable",
    path: "providers[0].preset",
    message: "预设创建后不可修改；换协议请新增一个 provider 再删除旧的",
    expect: /preset|add/i,
    zhExpect: /预设|新增/,
    key: "D891",
  },
  {
    code: "settings_provider_delete_referenced",
    path: "harness.session_naming.provider",
    message:
      'provider "ghost" 正被会话命名使用：删除前必须选择「跟随当前 provider」或另一个替代目标',
    expect: /naming|follow/i,
    zhExpect: /命名|跟随当前/,
    key: "D892",
  },
  {
    code: "settings_provider_delete_active_requires_target",
    path: "harness.provider",
    message: 'provider "ghost" 是当前使用项：删除前必须选择替代 provider（可选：kimi）',
    expect: /active|replacement/i,
    zhExpect: /当前使用|替代/,
    key: "D893",
  },
  {
    code: "settings_naming_target_missing",
    path: "harness.session_naming.provider",
    message: '会话命名的新目标 "ghost" 不是可用的 provider（可选：kimi）',
    expect: /naming|provider/i,
    zhExpect: /命名|有效/,
    key: "D894",
  },
  {
    code: "settings_naming_model_missing",
    path: "harness.session_naming.model",
    message: '模型 "ghost-model" 不在 provider "kimi" 的 models 清单内；请先在该 provider 的清单里声明它',
    expect: /model|list/i,
    zhExpect: /模型|清单/,
    key: "D895",
  },
] as const;

test("设置面板字段错误：十条迁移 code 在 en / zh 两档都本地化、可行动、不露内部细节", () => {
  for (const item of SETTINGS_FIELD_CASES) {
    const envelope = { path: item.path, code: item.code, message: item.message };

    const en = errorText(envelope, "en");
    assertNoInternalDetail(en, `${item.code}/en`);
    assert.match(en, item.expect, `${item.code}/en 要给出可行动方向：${en}`);
    assert.equal(en, COPY[item.key].en, `${item.code}/en 与 deck 不一致`);

    const zh = errorText(envelope, "zh");
    assert.ok(CJK.test(zh), `${item.code}/zh 应是中文（正观测）：${zh}`);
    assert.match(zh, item.zhExpect, `${item.code}/zh 要给出可行动方向：${zh}`);
    assert.equal(zh, COPY[item.key].zh, `${item.code}/zh 与 deck 不一致`);
    assert.notEqual(en, zh, `${item.code}：两档必须是两份文案，不是同一句`);

    // 反向判据：后端原文确实是中文（上面的 en 断言有区分度）。
    assert.ok(CJK.test(item.message), `${item.code}：后端 message 应是中文原文`);
    // 字段错误走的路径没有 params：模板带占位就会被缺参兜底打回 message（= 没迁移）。
    assert.notEqual(en, item.message, `${item.code}：en 不得回落中文 message`);
  }
});

test("设置面板字段错误：迁移后 path 路由不变（文本换表、落点不动）", () => {
  // path → 控件的路由归 `mapFieldErrors`，与「code → 文案」是两层职责；本批只换后者。
  const mapped = mapFieldErrors([
    { path: "harness.provider", code: "settings_active_provider_missing", message: "替代的当前使用项不可用" },
    { path: "harness.session_naming.provider", code: "settings_naming_target_missing", message: "会话命名的新目标不可用" },
    { path: "harness.attachment_naming.model", code: "settings_naming_model_missing", message: "图片命名模型不在清单" },
    { path: "", code: "settings_patch_invalid", message: "文件级校验失败" },
    { path: "base_revision", code: "settings_revision_conflict", message: "配置文件已在外部修改" },
    { path: "harness.providers.kimi.api_key", code: "settings_provider_not_found", message: "provider 不存在" },
  ]);
  // 单测层的语言由 `tests/unit/register.mjs` 钉在 zh（`mapFieldErrors` 不传 lang）。
  assert.equal(mapped.active, COPY.D890.zh);
  assert.equal(mapped.sessionNaming, COPY.D894.zh);
  assert.equal(mapped.attachmentNaming, COPY.D895.zh);
  assert.equal(mapped.fileLevel, COPY.D886.zh);
  assert.equal(mapped.conflict, COPY.D888.zh);
  assert.equal(mapped.apiKey["kimi"], COPY.D889.zh);
});

test("config_parse_failed 的两条信封：字段错误档无 path、CommandError 档保留 path", () => {
  const path = "/mock/config/config.json";
  const message = `配置文件（${path}）无法解析：expected value at line 1 column 1`;

  // CommandError 档（带 params.path）：D697 插入路径。
  const command = errorText({ code: "config_parse_failed", message, params: { path } }, "en");
  assert.equal(command, COPY.D697.en.replace("{path}", path));
  assert.ok(command.includes(path), "CommandError 档要保留路径（诊断价值）");

  // 无覆盖表 = 旧行为：缺参回落中文 message（这正是 M852 finding 现场，作为反向判据）。
  assert.equal(
    errorText({ code: "config_parse_failed", message }, "en"),
    message,
    "没有 FIELD_ERROR_COPY 时 D697 的 {path} 必缺参、回落 message",
  );

  // 字段错误档（没有 params）：FIELD_ERROR_COPY → D896，不带路径、不缺参。
  const field = { code: "config_parse_failed", message };
  const fieldEn = errorText(field, "en", FIELD_ERROR_COPY);
  assert.equal(fieldEn, COPY.D896.en);
  assertNoInternalDetail(fieldEn, "config_parse_failed/field/en");
  assert.ok(!fieldEn.includes(path), `字段错误档不插路径（页头 D699 已有）：${fieldEn}`);
  const fieldZh = errorText(field, "zh", FIELD_ERROR_COPY);
  assert.equal(fieldZh, COPY.D896.zh);
  assert.ok(!fieldZh.includes(path));
  assert.notEqual(fieldEn, fieldZh);

  // 真实调用点：`mapFieldErrors` 传的就是这张表，读到 D896 而不是回落中文 message。
  const mapped = mapFieldErrors([{ path: "", code: "config_parse_failed", message }]);
  assert.equal(mapped.fileLevel, COPY.D896.zh);

  // 反向判据：后端 message 确实是中文 + 带路径（上面的断言有区分度）。
  assert.ok(CJK.test(message));
  assert.ok(message.includes(path));
});

test("流式事件字面量码：内部错误 / 空响应在 en / zh 两档都本地化、可行动", () => {
  const cases = [
    {
      code: "harness_internal_error",
      message: "对话线程发生内部错误，本轮已终止；请重试，必要时开新会话",
      expect: /internal error/i,
      actionable: /retry|new session/i,
      zhActionable: /重试|新会话/,
      key: "D897",
    },
    {
      code: "harness_empty_response",
      message: "模型返回了空响应（无文本也无工具调用），本轮已停止",
      expect: /empty response/i,
      actionable: /try again|empty response/i,
      zhActionable: /空响应|重试/,
      key: "D898",
    },
  ] as const;

  for (const item of cases) {
    // 事件载荷形状见 `src-tauri/src/harness/events.rs` 的 `error(code, message)`：没有 params。
    const event = { code: item.code, message: item.message };
    // 面板实际拼出的那一行（`appendError(t("D348", {message: errorText(...)}))`）。
    const enLine = t("D348", { message: errorText(event, "en") }, "en");
    assertNoInternalDetail(enLine, `${item.code}/en`);
    assert.match(enLine, item.expect);
    assert.match(enLine, item.actionable, `${item.code}/en 要给出可行动方向：${enLine}`);
    assert.equal(errorText(event, "en"), COPY[item.key].en, `${item.code}/en 与 deck 不一致`);

    const zhLine = t("D348", { message: errorText(event, "zh") }, "zh");
    assert.ok(CJK.test(zhLine), `${item.code}/zh 应是中文：${zhLine}`);
    assert.match(zhLine, item.zhActionable, `${item.code}/zh 要给出可行动方向：${zhLine}`);
    assert.equal(errorText(event, "zh"), COPY[item.key].zh);

    // 反向判据：后端 message 是中文原文（en 断言的区分度来源）。
    assert.ok(CJK.test(item.message));
  }
});

// ---------------------------------------------------------------------------
// M865：设置面板的**装载期配置诊断**（`ConfigDiagnostic{code, path, message}`）——
// `fillDiagnostics` / 被忽略 provider 的条目诊断 / 模型行 notes 三处此前直出 Rust 中文
// message，en 界面露中文且不在任何扫描门禁里。
// ---------------------------------------------------------------------------

/** 设置面可达诊断的现场（Rust message 逐字风格取自 `src-tauri/src/config.rs` 的 `sink.warn`）。
 *  `expect` / `zhExpect` 是可行动方向的关键词；`value` 是 message 里的读数，文案 MUST NOT 插它。 */
const DIAGNOSTIC_CASES = [
  {
    code: "harness_provider_preset_invalid",
    path: "harness.providers.legacy.preset",
    message: '配置项 harness.providers.legacy.preset 取值 "openai" 非法（可选：kimi、deepseek、generic、mock），已忽略该 provider',
    value: "openai",
    expect: /preset/i,
    actionable: /kimi|deepseek|generic|mock/i,
    zhExpect: /预设|kimi/,
    key: "D904",
  },
  {
    code: "harness_model_id_duplicate",
    path: "harness.providers.kimi-work.models[1]",
    message: '配置项 harness.providers.kimi-work.models[1] 的 id "k3-256k" 重复，已忽略',
    value: "k3-256k",
    expect: /id/i,
    actionable: /unique/i,
    zhExpect: /重复|唯一的 id/,
    key: "D915",
  },
  {
    code: "harness_model_window_missing",
    path: "harness.providers.kimi-work.models[0]",
    message: '配置项 harness.providers.kimi-work.models[0]（id "k3-256k"）未声明 window，已回退为 131072',
    value: "131072",
    expect: /window/i,
    actionable: /default|conservative/i,
    zhExpect: /window|默认值/,
    key: "D921",
  },
  {
    code: "harness_models_empty_when_configured",
    path: "harness.providers.kimi-work",
    message: "配置项 harness.providers.kimi-work 已配置 api_key 但没有声明任何模型：请至少声明一个模型，或清除 api_key",
    value: "kimi-work",
    expect: /model/i,
    actionable: /declare|clear/i,
    zhExpect: /模型|API Key/,
    key: "D910",
  },
  {
    code: "config_migration_write_failed",
    path: null,
    message: "改写后的配置未能落盘（Permission denied (os error 13)），下次启动会再试一次",
    value: "os error 13",
    expect: /config/i,
    actionable: /permission|retry|next launch/i,
    zhExpect: /写入权限|下次启动/,
    key: "D927",
  },
  {
    code: "harness_naming_provider_unknown",
    path: "harness.session_naming.provider",
    message: '配置项 harness.session_naming.provider 取值 "ghost" 不在 harness.providers 表内，会话命名已回退为会话当前 provider',
    value: "ghost",
    expect: /provider/i,
    actionable: /session/i,
    zhExpect: /会话|provider/,
    key: "D926",
  },
] as const;

test("配置诊断：设置面可达的 code 在 en / zh 两档都本地化、可行动、不插读数", () => {
  for (const item of DIAGNOSTIC_CASES) {
    // 上屏形状就是 `ConfigDiagnostic` 本身（`fillDiagnostics` 把它交给 errorText）。
    const entry = { code: item.code, path: item.path, severity: "warning", message: item.message };

    const en = errorText(entry, "en");
    assertNoInternalDetail(en, `${item.code}/en`);
    assert.match(en, item.expect, `${item.code}/en 要点名对象：${en}`);
    assert.match(en, item.actionable, `${item.code}/en 要给出可行动方向：${en}`);
    assert.equal(en, COPY[item.key].en, `${item.code}/en 与 deck 不一致`);
    assert.ok(!en.includes(item.value), `${item.code}/en 不得插入读数 ${item.value}：${en}`);

    const zh = errorText(entry, "zh");
    assert.ok(CJK.test(zh), `${item.code}/zh 应是中文（正观测）：${zh}`);
    assert.match(zh, item.zhExpect, `${item.code}/zh 要给出可行动方向：${zh}`);
    assert.equal(zh, COPY[item.key].zh, `${item.code}/zh 与 deck 不一致`);
    assert.ok(!zh.includes(item.value), `${item.code}/zh 不得插入读数 ${item.value}：${zh}`);
    assert.notEqual(en, zh, `${item.code}：两档必须是两份文案，不是同一句`);

    // 反向判据：后端原文确实是中文（上面的 en 断言有区分度）。
    assert.ok(CJK.test(item.message), `${item.code}：后端 message 应是中文原文`);
  }
});

test("配置诊断：模型行 notes 按同路径诊断的 code 取文案，后端中文 message 不上屏", () => {
  // `ProviderSettings.models[].diagnostics` 只有 message；code 在同一个快照的 diagnostics 里按
  // `harness.providers.<id>.models[<i>]` 前缀对齐（与 Rust `model_drafts` 同一归属规则）。
  const snapshot = {
    diagnostics: DIAGNOSTIC_CASES.filter((item) => item.path !== null && item.path.includes(".models[")).map(
      (item) => ({ code: item.code, path: item.path, severity: "warning", message: item.message }),
    ),
  } as unknown as SettingsSnapshot;
  assert.equal(snapshot.diagnostics.length, 2, "fixture 里应有两条模型行诊断");

  const kimiNotes = ["配置项 harness.providers.kimi-work.models[0]（id \"k3-256k\"）未声明 window，已回退为 131072"];
  assert.deepEqual(localizeModelNotes(snapshot, "kimi-work", 0, kimiNotes), [COPY.D921.zh]);

  // 别的 provider / 别的行不串：没有对应诊断时原样返回（不吞、不借用）。
  assert.deepEqual(localizeModelNotes(snapshot, "local-lab", 0, ["别的行"]), ["别的行"]);
  assert.deepEqual(localizeModelNotes(snapshot, "kimi-work", 3, ["没有诊断"]), ["没有诊断"]);
});

test("配置诊断：未知 code 安全回落 message（前向兼容，MUST NOT 显示空白或裸 code）", () => {
  const entry = { code: "harness_future_diagnostic", path: "harness.providers.kimi-work", severity: "warning", message: "未来版本的中文诊断" };
  assert.equal(errorText(entry, "en"), entry.message);
  assert.equal(errorText(entry, "zh"), entry.message);
});

test("同一 code 的两条信封：装载期诊断说「已忽略」，保存被拒说「改哪里才能保存」（M865）", () => {
  const message = '配置项 harness.providers.kimi-work.models[0] 的 id "dup" 重复，已忽略';
  const entry = {
    code: "harness_model_id_duplicate",
    path: "harness.providers.kimi-work.models[0]",
    severity: "reject_on_write",
    message,
  };

  // 诊断面（fillDiagnostics / 忽略条目 / 模型行 notes）：装载期发生了什么。
  const diagEn = errorText(entry, "en");
  assert.equal(diagEn, COPY.D915.en);
  assert.ok(!CJK.test(diagEn));
  assert.match(diagEn, /ignored/i);

  // 字段错误面（保存被拒）：改哪里才能保存，MUST NOT 说「已忽略」（文件没变）。
  const fieldEn = errorText(entry, "en", FIELD_ERROR_COPY);
  assert.equal(fieldEn, COPY.D929.en);
  assert.ok(!CJK.test(fieldEn));
  assert.match(fieldEn, /unique id/i);
  assert.notEqual(diagEn, fieldEn, "两条信封必须是两份措辞");

  // 真实调用点：`mapFieldErrors` 传的就是字段错误表（单测层语言钉在 zh）。
  const mapped = mapFieldErrors([
    { path: "harness.providers.kimi-work.models[0].id", code: "harness_model_id_duplicate", message: "模型 id 重复" },
  ]);
  assert.equal(mapped.models["kimi-work"]?.[0]?.id, COPY.D929.zh);
  // 诊断面不受字段错误表影响，仍是装载期措辞。
  assert.equal(errorText(entry, "zh"), COPY.D915.zh);
});

// ---------------------------------------------------------------------------
// M865 r1：多构造点 code 的**分支后果**断言（review P1-1）
//
// 上一版只判「双语 / 无 CJK / 含可行动关键词」——这组判据发现不了「句子把 A 分支的结局
// 写给了 B 分支」这类事实错误。这里按 Rust 构造点逐分支断言：
//   · `must`：该分支真实后果的**不可省略成分**（不是「有中文」「有动词」式的空判据）；
//   · `mustNot`：只在别的分支成立的结局被误写进这句时的形状。
// 同一 code 的多个现场 message 都会喂给 `errorText`，证明一条覆盖句同时说清各分支。
// ---------------------------------------------------------------------------

/** 会话命名 / 图片命名的真实 message（逐字取自 `src-tauri/src/config.rs` 的 sink 调用）。 */
const SESSION_NAMING_INVALID =
  '配置项 harness.session_naming.model 的值 "ghost" 不在 provider（kimi-work）的 models 清单内：命名调用已回落为 kimi-work 的生效模型；请在 harness.providers.kimi-work.models 中声明该模型';
const ATTACHMENT_NAMING_INVALID_VISION =
  '配置项 harness.attachment_naming.model 的值 "ghost" 未声明 vision 能力；语义命名将不会发起';

test("命名模型不可用：会话命名回退、图片命名原样保留并跳过——两分支的结局分别断言（M865 r1）", () => {
  const entry = (message: string, path: string) => ({ code: "harness_naming_model_invalid", path, message });

  const zh = errorText(entry(SESSION_NAMING_INVALID, "harness.session_naming.model"), "zh");
  // 会话分支（config.rs:3960-3984）：回退为该 provider 的生效模型。
  assert.match(zh, /会话命名[^；。]*生效模型/, `会话命名分支的结局缺失：${zh}`);
  // 图片分支（config.rs:4034-4110）：覆盖值原样保留、资格不满足即跳过、保留暂存名，不换模型。
  assert.match(zh, /图片命名[^；。]*(不换模型|跳过)/, `图片命名分支的结局缺失：${zh}`);
  assert.match(zh, /保留暂存名/, `图片命名必须写「保留暂存名」：${zh}`);
  // 成因清单必须含 attachment 的「未声明 vision」（config.rs:4087-4092），否则该分支无解释。
  assert.match(zh, /未声明 vision/, `缺少 vision 成因：${zh}`);
  // 反向：图片命名不得被写成「回退模型」——那正是会话分支的结局。
  assert.ok(!/图片命名[^；。]*回退/.test(zh), `图片命名不得写成回落模型：${zh}`);

  // 同一 code 的另一条分支 message 必须得到同一句覆盖文案（不是按 message 各写一句）。
  assert.equal(errorText(entry(ATTACHMENT_NAMING_INVALID_VISION, "harness.attachment_naming.model"), "zh"), zh);

  const en = errorText(entry(ATTACHMENT_NAMING_INVALID_VISION, "harness.attachment_naming.model"), "en");
  assert.match(en, /session naming[^;.]*effective model/i, `en 会话分支的结局缺失：${en}`);
  assert.match(en, /image naming[^;.]*skip/i, `en 图片分支的结局缺失：${en}`);
  assert.match(en, /temporary name/i, `en 图片分支要保留暂存名：${en}`);
  assert.ok(!/image naming[^;.]*falls back/i.test(en), `en 图片命名不得写成回落：${en}`);
});

/** wire_api 的两条构造点：字符串但取值非法（回退默认）与非字符串（整条 provider 忽略）。 */
const WIRE_API_INVALID_VALUE =
  '配置项 harness.providers.kimi-work.wire_api 取值 "chat" 非法（可选：responses、chat_completions），已回退为 responses';
const WIRE_API_NON_STRING =
  "配置项 harness.providers.kimi-work.wire_api 应为字符串（可选：responses、chat_completions），已忽略该 provider";

test("wire_api 非法：字符串取值回退默认协议、非字符串整条 provider 忽略——两分支都点名（M865 r1）", () => {
  for (const message of [WIRE_API_INVALID_VALUE, WIRE_API_NON_STRING]) {
    const entry = { code: "harness_wire_api_invalid", path: "harness.providers.kimi-work.wire_api", message };
    const zh = errorText(entry, "zh");
    // 非字符串分支（config.rs:3682-3687）：整条 provider 被忽略——只写「回退默认协议」是错的。
    assert.match(zh, /不是字符串[^；。]*忽略/, `非字符串分支的结局缺失：${zh}`);
    // 取值非法分支（config.rs:4145-4154）：回退为预设默认协议。
    assert.match(zh, /取值非法[^；。]*回退/, `取值非法分支的结局缺失：${zh}`);
    assert.match(zh, /默认协议/, `取值非法分支要写清落点是默认协议：${zh}`);

    const en = errorText(entry, "en");
    assert.match(en, /non-string wire_api[^;.]*ignored/i, `en 非字符串分支的结局缺失：${en}`);
    assert.match(en, /invalid value[^;.]*falls back/i, `en 取值非法分支的结局缺失：${en}`);
  }
});

test("当前使用项为空 / 悬空：没有可用 provider 时保持未配置（M865 r1）", () => {
  const empty = errorText(
    {
      code: "harness_provider_empty",
      path: "harness.provider",
      message: "配置项 harness.provider 为空，已按未写处理（按已配置的 provider 回退）",
    },
    "zh",
  );
  // 两个落点都要在：按预设顺序回退（design §2.5 第 2/3 步）与「没有可用 provider 时保持未配置」
  // （第 4 步，`default_active_provider` 返回空串）。
  assert.match(empty, /按预设顺序回退/, `缺少回退顺序：${empty}`);
  assert.match(empty, /没有可用 provider 时保持未配置/, `缺少「无可用 provider」落点：${empty}`);

  const unknown = errorText(
    {
      code: "harness_provider_unknown",
      path: "harness.provider",
      message: '配置项 harness.provider 取值 "ghost" 不在 harness.providers 表内，已回退为 无可用 provider',
    },
    "zh",
  );
  // 悬空分支的落点就是 `landing`：可能是具体 provider，也可能是「无可用 provider」。
  assert.match(unknown, /没有可用 provider 时保持未配置/, `悬空分支缺少「无可用 provider」落点：${unknown}`);

  const en = errorText(
    {
      code: "harness_provider_unknown",
      path: "harness.provider",
      message: '配置项 harness.provider 取值 "ghost" 不在 harness.providers 表内，已回退为 无可用 provider',
    },
    "en",
  );
  assert.match(en, /stays unset when none is available/i, `en 悬空分支缺少无可用 provider 落点：${en}`);
});

test("保存被拒的 base_url 为空：删除键只在预设自带官方地址时是出口（generic 没有）（M865 r1）", () => {
  const entry = {
    code: "harness_base_url_empty",
    path: "harness.providers.kimi-work.base_url",
    message: '配置项 harness.providers.kimi-work.base_url 为空，已回退为 https://api.moonshot.cn/v1',
  };
  const zh = errorText(entry, "zh", FIELD_ERROR_COPY);
  // 保存现场的真实出口：填写地址；删除键的回退只对自带官方地址的预设成立（generic 没有）。
  assert.match(zh, /删除该键只在预设自带官方地址时可用/, `删除键的条件没写清：${zh}`);
  assert.match(zh, /generic 没有官方地址/, `必须点名 generic 例外：${zh}`);
  // 反向：上一版的无条件出口「删除该键回退到官方地址」不得复现。
  assert.ok(!/删除该键回退到官方地址/.test(zh), `无条件回退的老说法仍在：${zh}`);

  const en = errorText(entry, "en", FIELD_ERROR_COPY);
  assert.match(en, /removing the key only helps when the preset has an official URL/i, `en 条件没写清：${en}`);
  assert.match(en, /generic has none/i);
});

test("保存被拒的 preset 非法：mock 与 id 的组合分支有独立出口（M865 r1）", () => {
  const entry = {
    code: "harness_provider_preset_invalid",
    path: "harness.providers.mockish.preset",
    message: '配置项 harness.providers.mockish.preset 为 mock，但 mock 是保留 id（只有 id 为 "mock" 的条目可使用该预设），已忽略该 provider',
  };
  const zh = errorText(entry, "zh", FIELD_ERROR_COPY);
  // 真实分支（config.rs:3626）：preset=mock + id≠mock——出口是改 preset 或改 id 的组合。
  assert.match(zh, /mock 预设配在了非 mock 的 id 上/, `mock/id 组合分支缺失：${zh}`);
  assert.match(zh, /mock 只能用于 id=mock/, `mock 的 id 约束没写：${zh}`);
  assert.match(zh, /改正 preset 或 id/, `出口必须同时允许改 preset 或 id：${zh}`);

  const en = errorText(entry, "en", FIELD_ERROR_COPY);
  assert.match(en, /mock preset is paired with a non-mock id/i, `en 组合分支缺失：${en}`);
  assert.match(en, /fix the preset or the id/i);
});

test("保存被拒的模型 id 缺失：非字符串分支同属本 code（M865 r1）", () => {
  const nonStringMessage =
    "配置项 harness.providers.kimi-work.models[0] 缺少 id（或 id 不是字符串），已忽略";
  const zh = errorText(
    { code: "harness_model_id_empty", path: "harness.providers.kimi-work.models[0]", message: nonStringMessage },
    "zh",
    FIELD_ERROR_COPY,
  );
  assert.match(zh, /id 不是字符串/, `非字符串分支缺失：${zh}`);
  // 装载期诊断档同样要点名该分支（D914）。
  const diagnosticZh = errorText(
    { code: "harness_model_id_empty", path: "harness.providers.kimi-work.models[0]", message: nonStringMessage },
    "zh",
  );
  assert.match(diagnosticZh, /不是非空字符串|不是字符串/, `诊断档缺非字符串分支：${diagnosticZh}`);
  assert.notEqual(zh, diagnosticZh, "两条信封仍是两份措辞");
});

test("preset 迁移：只给 kimi / deepseek / mock 补同名预设，不写成「补为 generic」（M865 r1）", () => {
  const preset = errorText(
    {
      code: "harness_provider_preset_migrated",
      path: "harness.providers",
      message: "配置项 harness.providers 的旧条目已补齐 preset（kimi、deepseek）",
    },
    "zh",
  );
  // `migrate_provider_presets` 只给 id 为 kimi / deepseek / mock 的条目补同名预设——不是「补为 generic」。
  assert.match(preset, /kimi、deepseek、mock/, `补预设的 id 清单缺失：${preset}`);
  assert.ok(!/补为 generic/.test(preset), `不得写成「补为 generic」（实现不补其它 id）：${preset}`);
});

test("退役模型改写：落点是「首个可用 id」，首个非法项会被跳过——文案必须说清跳过规则（M865 r2）", () => {
  // Rust 合同（`config.rs:2253-2265`）：`find_map` 逐项取 `as_object` + `id.as_str` + 非空白，
  // 跳过非对象 / id 非字符串 / id 为空的项。因此「首项非法、后续项有效」时改写目标是**后续项**，
  // 不是字面清单首项（r1 的 D922 正是在这条边界上说错，r2 review P1-1）。
  const entry = (lang: "zh" | "en") =>
    errorText(
      {
        code: "harness_model_retired_migrated",
        path: "harness.providers.kimi.model",
        message: "配置项 harness.providers.kimi.model 的旧模型名已退役，已自动改写为 k2",
      },
      lang,
    );

  const zh = entry("zh");
  // 落点：首个**可用** id（不是「清单首项」）。
  assert.match(zh, /models 清单的首个可用 id/, `落点没写「可用」：${zh}`);
  // 跳过规则：非对象 / id 不是非空字符串的项被跳过——这是「首项非法 → 目标是后续项」的唯一解释。
  assert.match(zh, /非对象[^。]*跳过/, `缺「非对象项被跳过」：${zh}`);
  assert.match(zh, /不是非空字符串/, `缺「id 不是非空字符串」的跳过条件：${zh}`);
  assert.ok(!/清单的首项|清单首项/.test(zh), `不得写成字面清单首项：${zh}`);
  assert.ok(!/等价/.test(zh), `不得声称「等价模型」：${zh}`);

  const en = entry("en");
  assert.match(en, /first usable id in that provider's models list/i, `en 落点没写「usable」：${en}`);
  assert.match(en, /non-empty string/i, `en 缺跳过条件：${en}`);
  assert.match(en, /skipped/i, `en 缺跳过规则：${en}`);
  assert.ok(!/first entry/i.test(en), `en 不得写成 first entry：${en}`);

  // 反向判据（REVIEW.md『断言等价于子串』条）：把上一版（错误）的说法喂给同一组谓词必须命中——
  // 否则上面的 mustNot 恒真，区分不出「首项」与「首个可用项」。
  const mutantZh = "配置里的旧模型名已退役，已自动改写为该 provider models 清单的首项";
  assert.ok(/清单的首项/.test(mutantZh), "负向判据对旧说法必须有区分度");
  assert.ok(!/首个可用 id/.test(mutantZh));
  const mutantEn = "The retired model name was rewritten to the first entry in that provider's models list";
  assert.ok(/first entry/i.test(mutantEn), "en 负向判据对旧说法必须有区分度");
  assert.ok(!/first usable id/i.test(mutantEn));
});
