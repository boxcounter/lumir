// 视觉场景的 provider 条目构造（change add-model-automation-settings-oct24；M738 finding 的
// 视觉侧收口）。
//
// M732 起 provider 从固定三字段条目改成「id 映射键 + 统一条目（自带 preset）」，`configured`
// 是后端**派生读数**。视觉场景就地覆写 `config_get` 的 `harness` 段时，覆写出来的对象是
// 「后端快照」的替身——必须与真后端的输出同形（preset / fixture / configured 齐全），否则
// 前端一旦消费这些字段（设置面板与 chip 都在消费），场景渲染的就是真后端不可能产出的状态。
//
// 派生规则照 `src-tauri/src/config.rs` 的 `HarnessProviderConfig::derive_configured` 逐条镜像
// （mock = fixture 非空；generic = models 与 base_url 均非空；kimi / deepseek = api_key 与
// models 均非空）。**桩在这里扮演后端**，因此由它算 `configured` 是正确的分工；产品代码
// MUST NOT 自己拼这条判据（REVIEW.md『同一语义两处真源』条）。
//
// 唯一实现：`tauri-stub.ts` 的出厂条目也从这个模块导入（M738 的修复以 cherry-pick 落进本
// mission，两处收敛成一份派生规则——桩扮演后端产出空条目，场景按需覆写字段）。

import type { HarnessProviderConfig } from "../../../src/bindings/HarnessProviderConfig";
import type { ProviderPreset } from "../../../src/bindings/ProviderPreset";

export interface ProviderFields {
  api_key?: string;
  model?: string;
  base_url?: string | null;
  /** 模型行用**数字**写（场景作者口径）；ts-rs 把 u64 导出成 bigint，构造时在边界处转。 */
  models?: Array<{ id: string; effort?: boolean; vision?: boolean; window?: number }>;
  wire_api?: "responses" | "chat_completions";
  fixture?: string | null;
}

/** 一条完整的 provider 条目（与 Rust `HarnessProviderConfig` 的序列化形状同形）。 */
export function providerEntry(preset: ProviderPreset, fields: ProviderFields = {}): HarnessProviderConfig {
  const model = fields.model ?? "";
  const models = (fields.models ?? (model === "" ? [] : [{ id: model }])).map((item) => ({
    id: item.id,
    effort: item.effort === true,
    vision: item.vision === true,
    window: (item.window ?? 131072) as unknown as bigint,
  }));
  const entry: HarnessProviderConfig = {
    preset,
    // 出厂空条目的 Key 是空串（与 Rust `HarnessProviderConfig::empty` 同态，桩的默认
    // providers 走这一档）；场景要「后端已配置」时显式给一把合成 Key。
    api_key: fields.api_key ?? "",
    model,
    base_url: fields.base_url ?? null,
    models,
    wire_api: fields.wire_api ?? (preset === "generic" ? "chat_completions" : "responses"),
    fixture: fields.fixture ?? null,
    configured: false,
  };
  entry.configured =
    preset === "mock"
      ? (entry.fixture ?? "").trim() !== ""
      : preset === "generic"
        ? entry.models.length > 0 && (entry.base_url ?? "").trim() !== ""
        : entry.api_key.trim() !== "" && entry.models.length > 0;
  return entry;
}

/** 视觉场景里最常见的三档 provider 映射（kimi / deepseek 各一个模型 + mock fixture）。 */
export function standardProviders(): Record<string, HarnessProviderConfig> {
  const key = "test-key-visual";
  return {
    kimi: providerEntry("kimi", { api_key: key, model: "k2" }),
    deepseek: providerEntry("deepseek", { api_key: key, model: "d" }),
    mock: providerEntry("mock", { fixture: "f.json" }),
  };
}
