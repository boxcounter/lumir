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
  return parseWebAudit({
    operation,
    query: raw.query ?? null,
    url: source.url ?? null,
    provider: raw.provider ?? null,
    provider_id: raw.provider_id ?? null,
    attempts: raw.attempts,
    cost_per_1000_success_cny: 5,
    local_precheck: operation === "fetch",
    provider_fetch: true,
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
