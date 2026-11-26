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
  /** 预算裁剪后实际回送模型的结果条数；非成功 Search / 失败 / 旧留存缺键 → null。
   *  MUST NOT 用 0 兜底（0 是「真正成功的空结果」这一合法读数）。 */
  result_count: number | null;
  /** 最终保留结果 title/snippet/summary/content 的 UTF-8 字节和；口径同 `result_count`。 */
  result_text_bytes: number | null;
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
  const code = (raw.code as string | null | undefined) ?? null;
  // 失败结果不携带读数（合同：缺失 / 不可信 / 失败时指标为 null）。即使坏记录带了数值，
  // 也在投影层归 null，而不是只靠渲染层不显示——下游消费者拿到的 metadata 本身是干净的。
  const failed = code !== null;
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
    code,
    // 两个读数各自独立降级：一个非法不连带丢掉另一个合法值；缺键同样归 null。
    result_count: failed ? null : nonNegativeInteger(raw.result_count),
    result_text_bytes: failed ? null : nonNegativeInteger(raw.result_text_bytes),
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
    result_count: raw.result_count,
    result_text_bytes: raw.result_text_bytes,
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

/** 可空非负整数读数：缺失 / null / 字符串 / 负数 / 小数一律 null（不 `?? 0`）。 */
function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** 面板工具记录随记录持久化的完整 Web 输入（`PanelWebInput`，评审 P1-1）。
 *  与 live started 的参数摘要同一份 arguments，但不截断；旧记录缺键 → undefined。 */
export interface WebPanelInput {
  query: string | null;
  url: string | null;
}

/** 宽容解析 `PanelMessage.web_input`：非对象 / 空值 → undefined；空串按缺席处理。 */
export function parseWebPanelInput(value: unknown): WebPanelInput | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const query = typeof raw.query === "string" && raw.query !== "" ? raw.query : null;
  const url = typeof raw.url === "string" && raw.url !== "" ? raw.url : null;
  if (query === null && url === null) return undefined;
  return { query, url };
}

/** 用持久化输入补全审计投影的 query / url（信封里的失败记录可能没有这两个值）。
 *  已有审计字段优先保留；输入只填空缺，MUST NOT 用输入覆盖不同的审计事实。 */
export function withWebPanelInput(
  audit: WebAuditMetadata | undefined,
  input: WebPanelInput | undefined,
): WebAuditMetadata | undefined {
  if (audit === undefined || input === undefined) return audit;
  const query = audit.query !== null && audit.query !== "" ? audit.query : input.query;
  const url = audit.url !== null && audit.url !== "" ? audit.url : input.url;
  return { ...audit, query, url };
}

/** 默认行应显示的 Web 输入：持久化完整输入 → 审计投影 → 空串（旧记录安全降级）。
 *  这是恢复行与乱序 live done 的**同一份**取值口径；不猜、不伪造。 */
export function webInputText(
  input: WebPanelInput | undefined,
  audit: WebAuditMetadata | undefined,
): string {
  if (input?.query !== null && input?.query !== undefined) return input.query;
  if (input?.url !== null && input?.url !== undefined) return input.url;
  if (audit?.operation === "search" && audit.query !== null) return audit.query;
  if (audit?.operation === "fetch" && audit.url !== null) return audit.url;
  return "";
}
