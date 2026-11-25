import type { WebOperation } from "./bindings/WebOperation";

export interface WebAuditMetadata {
  operation: WebOperation;
  query: string | null;
  url: string | null;
  provider: string | null;
  provider_id: string | null;
  attempts: number;
  cost_per_1000_success_cny: 5;
  local_precheck: boolean;
  provider_fetch: boolean;
  trust: "untrusted";
  truncated: boolean;
  truncated_fields: string[];
  code: string | null;
}

export function parseWebAudit(value: unknown): WebAuditMetadata | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const operation = raw.operation === "search" ? "search" : raw.operation === "fetch" ? "fetch" : undefined;
  if (operation === undefined) return undefined;
  if (!nullableString(raw.query) || !nullableString(raw.url)) return undefined;
  if (!nullableString(raw.provider) || !nullableString(raw.provider_id)) return undefined;
  if (!Number.isInteger(raw.attempts) || (raw.attempts as number) < 0) return undefined;
  if (raw.cost_per_1000_success_cny !== 5) return undefined;
  if (typeof raw.local_precheck !== "boolean" || typeof raw.provider_fetch !== "boolean") return undefined;
  if (raw.trust !== "untrusted" || typeof raw.truncated !== "boolean") return undefined;
  if (!Array.isArray(raw.truncated_fields) || !raw.truncated_fields.every((field) => typeof field === "string")) {
    return undefined;
  }
  if (!nullableString(raw.code)) return undefined;
  return {
    operation,
    query: (raw.query as string | null | undefined) ?? null,
    url: (raw.url as string | null | undefined) ?? null,
    provider: (raw.provider as string | null | undefined) ?? null,
    provider_id: (raw.provider_id as string | null | undefined) ?? null,
    attempts: raw.attempts as number,
    cost_per_1000_success_cny: 5,
    local_precheck: raw.local_precheck,
    provider_fetch: raw.provider_fetch,
    trust: "untrusted",
    truncated: raw.truncated,
    truncated_fields: raw.truncated_fields as string[],
    code: (raw.code as string | null | undefined) ?? null,
  };
}

export function webAuditFromEnvelope(value: unknown): WebAuditMetadata | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const operation = raw.operation === "search" ? "search" : raw.operation === "fetch" ? "fetch" : undefined;
  if (operation === undefined) return undefined;
  const source = typeof raw.source === "object" && raw.source !== null ? (raw.source as Record<string, unknown>) : {};
  const attempts = typeof raw.attempts === "number" ? raw.attempts : 0;
  // 实际发生的事实：新信封由 executor 写入 local_precheck（预检真的执行过才为 true）；
  // provider 是否被访问过由 attempts 决定。旧留存缺该键时按 attempts 推断——>0 必然经过
  // 预检并触达 provider，不得沿用「operation=fetch 就恒 true」的猜测。
  const localPrecheck =
    typeof raw.local_precheck === "boolean"
      ? raw.local_precheck
      : operation === "fetch" && attempts > 0;
  return parseWebAudit({
    operation,
    query: raw.query ?? null,
    url: source.url ?? null,
    provider: raw.provider ?? null,
    provider_id: raw.provider_id ?? null,
    attempts: raw.attempts,
    cost_per_1000_success_cny: 5,
    local_precheck: localPrecheck,
    provider_fetch: attempts > 0,
    trust: raw.trust,
    truncated: raw.truncated,
    truncated_fields: raw.truncated_fields,
    code: (raw.code as string | null | undefined) ?? null,
  });
}

export function webAuditFromPanelText(text: unknown): WebAuditMetadata | undefined {
  if (typeof text !== "string") return undefined;
  try {
    return webAuditFromEnvelope(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function nullableString(value: unknown): boolean {
  return value === null || value === undefined || typeof value === "string";
}
