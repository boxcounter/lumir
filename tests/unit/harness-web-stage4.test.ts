import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWebAudit,
  parseWebPanelInput,
  webAuditFromEnvelope,
  webAuditFromPanelText,
  webInputText,
  withWebPanelInput,
} from "../../src/web-audit.ts";

test("live Web 审计保留完整 query、provider、attempts、费用与 untrusted，且不携带正文", () => {
  const query = `  ${"q".repeat(180)}  `;
  const audit = parseWebAudit({
    operation: "search",
    query,
    url: null,
    provider: "deepseek",
    provider_id: "deepseek-work",
    attempts: 3,
    cost_per_1000_success_cny: 5,
    local_precheck: false,
    provider_fetch: true,
    trust: "untrusted",
    truncated: true,
    truncated_fields: ["results"],
    code: null,
  });
  assert.equal(audit?.query, query);
  assert.equal(audit?.provider_id, "deepseek-work");
  assert.equal(audit?.attempts, 3);
  assert.equal(audit?.cost_per_1000_success_cny, 5);
  assert.equal(audit?.trust, "untrusted");
  assert.deepEqual(audit?.truncated_fields, ["results"]);
  assert.equal("content" in (audit ?? {}), false);
  assert.equal("results" in (audit ?? {}), false);
});

test("JSONL/panel 恢复与 live 共用同一投影，24K 正文只留原 envelope", () => {
  const content = "x".repeat(24_000);
  const envelope = {
    ok: true,
    operation: "fetch",
    provider: "deepseek",
    provider_id: "deepseek-work",
    attempts: 1,
    trust: "untrusted",
    truncated: true,
    truncated_fields: ["content"],
    source: {
      url: "https://other.example/b",
      title: "",
      content,
      content_format: "markdown",
      site: "other.example",
      date: null,
      authority: null,
      snippet: null,
      summary: null,
    },
  };
  const text = JSON.stringify(envelope);
  const audit = webAuditFromPanelText(text);
  assert.equal(audit?.url, "https://other.example/b");
  assert.equal(audit?.local_precheck, true);
  assert.equal(audit?.provider_fetch, true);
  assert.equal(audit?.truncated, true);
  assert.deepEqual(audit?.truncated_fields, ["content"]);
  assert.equal("content" in (audit ?? {}), false);
  assert.equal(JSON.parse(text).source.content.length, 24_000);
  assert.deepEqual(audit, webAuditFromEnvelope(envelope));
});

test("失败恢复保留错误码与输入，坏形状不伪造审计块", () => {
  const audit = webAuditFromEnvelope({
    ok: false,
    operation: "search",
    query: "synthetic failure",
    provider: null,
    provider_id: null,
    attempts: 0,
    code: "web_provider_unconfigured",
    trust: "untrusted",
    truncated: false,
    truncated_fields: [],
  });
  assert.equal(audit?.query, "synthetic failure");
  assert.equal(audit?.code, "web_provider_unconfigured");
  assert.equal(audit?.provider, null);
  for (const malformed of [null, {}, { operation: "search" }, "{bad-json"]) {
    assert.equal(parseWebAudit(malformed), undefined);
  }
  assert.equal(webAuditFromPanelText("{bad-json"), undefined);
});

test("恢复投影读信封的 local_precheck / provider_fetch 事实，不按 operation 恒猜 true", () => {
  const base = {
    ok: false,
    operation: "fetch",
    provider: null,
    provider_id: null,
    attempts: 0,
    trust: "untrusted",
    truncated: false,
    truncated_fields: [],
    source: { url: "https://example.com/blocked", title: "" },
  };
  const cases = [
    // 未配置 / deny：预检没有发生，provider 也没有被访问。
    { envelope: { ...base, code: "web_provider_unconfigured" }, local: false, providerFetch: false },
    { envelope: { ...base, code: "permission_denied" }, local: false, providerFetch: false },
    // 预检执行过但失败：本地预检是事实，provider 未到达。
    {
      envelope: { ...base, code: "web_unsupported_content", local_precheck: true },
      local: true,
      providerFetch: false,
    },
    // 预检后 provider 请求过：两者都是事实。
    {
      envelope: { ...base, ok: true, attempts: 2, local_precheck: true },
      local: true,
      providerFetch: true,
    },
  ];
  for (const { envelope, local, providerFetch } of cases) {
    const audit = webAuditFromEnvelope(envelope);
    assert.equal(audit?.local_precheck, local, JSON.stringify(envelope));
    assert.equal(audit?.provider_fetch, providerFetch, JSON.stringify(envelope));
  }
  // 旧留存没有该键：按 attempts 推断（>0 说明 provider 确实被访问过），不得谎报为 true。
  const legacy = webAuditFromEnvelope({ ...base, attempts: 1, local_precheck: undefined });
  assert.equal(legacy?.local_precheck, true);
  assert.equal(legacy?.provider_fetch, true);
  const legacyDenied = webAuditFromEnvelope({ ...base, code: "permission_denied", local_precheck: undefined });
  assert.equal(legacyDenied?.local_precheck, false);
  const legacySearch = webAuditFromEnvelope({
    ...base,
    operation: "search",
    attempts: 1,
    local_precheck: undefined,
    source: undefined,
    query: "legacy",
  });
  assert.equal(legacySearch?.local_precheck, false, "Search 永远不执行本地预检");
  assert.equal(legacySearch?.provider_fetch, true);
});

/** 结果读数的宽容读取：实现前键不存在 → undefined（断言 null 会红，这正是先红判据）。 */
function metric(audit: unknown, key: "result_count" | "result_text_bytes"): unknown {
  return (audit as Record<string, unknown> | undefined)?.[key];
}

test("结果读数：缺失 / 非法 / 失败一律 null，不以 0 冒充空结果", () => {
  const base = {
    operation: "search" as const,
    query: "synthetic",
    url: null,
    provider: "deepseek",
    provider_id: "deepseek-work",
    attempts: 1,
    cost_per_1000_success_cny: 5 as const,
    local_precheck: false,
    provider_fetch: true,
    trust: "untrusted" as const,
    truncated: false,
    truncated_fields: [],
    code: null,
  };
  const ok = parseWebAudit({ ...base, result_count: 3, result_text_bytes: 128 });
  assert.equal(metric(ok, "result_count"), 3);
  assert.equal(metric(ok, "result_text_bytes"), 128);

  const absent = parseWebAudit(base);
  assert.equal(metric(absent, "result_count"), null, "缺键 = null，不是 undefined / 0");
  assert.equal(metric(absent, "result_text_bytes"), null);
  const explicitNull = parseWebAudit({ ...base, result_count: null, result_text_bytes: null });
  assert.equal(metric(explicitNull, "result_count"), null);
  assert.equal(metric(explicitNull, "result_text_bytes"), null);

  const individuallyBad = parseWebAudit({ ...base, result_count: -1, result_text_bytes: 12 });
  assert.equal(metric(individuallyBad, "result_count"), null, "负数不可信 → null");
  assert.equal(metric(individuallyBad, "result_text_bytes"), 12, "另一个合法读数不被连带丢掉");
  // 两个读数各自独立降级：一个非法不连带丢掉另一个合法值。
  const badPairs = [
    [{ result_count: 1.5, result_text_bytes: 12 }, null, 12],
    [{ result_count: 1, result_text_bytes: "12" }, 1, null],
    [{ result_count: "1", result_text_bytes: 12 }, null, 12],
  ] as const;
  for (const [bad, count, bytes] of badPairs) {
    const audit = parseWebAudit({ ...base, ...bad });
    assert.equal(metric(audit, "result_count"), count, JSON.stringify(bad));
    assert.equal(metric(audit, "result_text_bytes"), bytes, JSON.stringify(bad));
  }

  const failed = webAuditFromEnvelope({
    ok: false,
    operation: "search",
    query: "synthetic",
    provider: null,
    provider_id: null,
    attempts: 0,
    code: "web_provider_unconfigured",
    trust: "untrusted",
    truncated: false,
    truncated_fields: [],
  });
  assert.equal(metric(failed, "result_count"), null);
  assert.equal(metric(failed, "result_text_bytes"), null);

  // 坏 / 旧记录即使带了数值，失败结果也在投影层归 null（不只靠渲染层不显示）。
  const failedWithMetrics = parseWebAudit({
    ...base,
    code: "web_http_error",
    result_count: 3,
    result_text_bytes: 128,
  });
  assert.equal(metric(failedWithMetrics, "result_count"), null);
  assert.equal(metric(failedWithMetrics, "result_text_bytes"), null);
});

test("恢复投影透传信封的结果读数（不重算）", () => {
  const audit = webAuditFromEnvelope({
    ok: true,
    operation: "search",
    query: "synthetic",
    provider: "deepseek",
    provider_id: "deepseek-work",
    attempts: 1,
    trust: "untrusted",
    truncated: false,
    truncated_fields: [],
    result_count: 2,
    result_text_bytes: 6,
    results: [],
  });
  assert.equal(metric(audit, "result_count"), 2);
  assert.equal(metric(audit, "result_text_bytes"), 6);
});


test("面板 Web 输入：完整 query / URL 的宽容解析与审计补全", () => {
  assert.deepEqual(parseWebPanelInput({ query: "synthetic query" }), {
    query: "synthetic query",
    url: null,
  });
  assert.deepEqual(parseWebPanelInput({ url: "https://example.com/a" }), {
    query: null,
    url: "https://example.com/a",
  });
  assert.deepEqual(parseWebPanelInput({ query: "", url: "" }), undefined);
  for (const malformed of [null, undefined, {}, "synthetic", 42]) {
    assert.equal(parseWebPanelInput(malformed), undefined, JSON.stringify(malformed));
  }

  const base = {
    operation: "search" as const,
    query: null,
    url: null,
    provider: null,
    provider_id: null,
    attempts: 0,
    cost_per_1000_success_cny: 5 as const,
    local_precheck: false,
    provider_fetch: false,
    trust: "untrusted" as const,
    truncated: false,
    truncated_fields: [],
    code: "web_provider_unconfigured",
    input_url: null,
    result_count: null,
    result_text_bytes: null,
  };
  const filled = withWebPanelInput(base, { query: "synthetic query", url: null });
  assert.equal(filled?.query, "synthetic query");
  assert.equal(webInputText({ query: "synthetic query", url: null }, base), "synthetic query");
  assert.equal(webInputText(undefined, filled), "synthetic query");
  assert.equal(webInputText(undefined, base), "", "旧记录无输入 / 审计无 query 时为空");

  // 已有审计事实优先：输入只填空缺，不覆盖不同的 URL / query。
  const fetch = {
    ...base,
    operation: "fetch" as const,
    code: null,
    url: "https://final.example/b",
  };
  const merged = withWebPanelInput(fetch, { query: null, url: "https://input.example/a" });
  assert.equal(merged?.url, "https://final.example/b");
  assert.equal(webInputText({ query: null, url: "https://input.example/a" }, fetch), "https://input.example/a");
});
