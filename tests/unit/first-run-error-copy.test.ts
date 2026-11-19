// M852 — 首次安装的错误上屏文案（M849 finding 两条）：harness 错误行绕过文案表、设置面板
// 非法 provider id 未本地化。
//
// 三条判据都是**机械的**（不靠人读上屏效果）：
//   ① en 界面的错误行不含中文（后端 message 是 Rust 侧中文原文，直接上屏即缺陷）；
//   ② 不含内部 URL / reqwest 原始技术串（真机现场：`error sending request for url
//      (http://127.0.0.1:9/v1/chat/completions)`）；
//   ③ 给出可行动方向（指向设置面板 / 网络与接入配置），不是一句干巴巴的「失败了」。
//
// 判据的区分度（REVIEW.md「断言等价于子串」条）：每条负向断言都配一条**正观测**——把后端
// 原始 message / params 喂给同一组谓词，必须命中；否则「不含中文 / 不含 URL」恒真，等于没判。

import assert from "node:assert/strict";
import { test } from "node:test";
import { COPY } from "../../src/copy-data.ts";
import { errorText, t } from "../../src/copy.ts";

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
  assert.notEqual(COPY.D882.en, COPY.D882.zh);
});

test("既有契约不回退：带占位但缺参的 code 仍回落后端 message", () => {
  // errorText 的缺参兜底是既有契约（copy.ts 文件头）——本 mission 的改动只换调用点与模板，
  // MUST NOT 顺手改掉「缺参不打屏、回落 message」这一条。
  assert.equal(errorText({ code: "fs_not_found", message: "文件不存在：a.md" }, "en"), "文件不存在：a.md");
  assert.equal(errorText({ code: "no_such_code", message: "人话" }, "en"), "人话");
});
