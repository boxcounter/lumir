import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWebAudit,
  webAuditFromEnvelope,
  webAuditFromPanelText,
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
