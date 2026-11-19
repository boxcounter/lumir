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
import { mapFieldErrors } from "../../src/settings-panel.ts";

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
