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
