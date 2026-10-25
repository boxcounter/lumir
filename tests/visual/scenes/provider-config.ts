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
// M738 已在 `tests/visual/scenes/tauri-stub.ts` 里落了一份同规则的局部 `providerEntry`
// （它不在本 mission 的 scope 内）。两处应在 M738 合并后收敛成「stub 从本文件导入」——已按
// finding 上报，本条只保证视觉场景这一侧不再各抄一份。

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
    // kimi / deepseek 的空 Key 会让条目「未配置」；场景要的是「后端已配置」的常见形态，
    // 因此给一把合成 Key（真后端从不回传完整 Key，这里只驱动前端读数）。
    api_key: fields.api_key ?? (preset === "kimi" || preset === "deepseek" ? "test-key-visual" : ""),
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
  return {
    kimi: providerEntry("kimi", { model: "k2" }),
    deepseek: providerEntry("deepseek", { model: "d" }),
    mock: providerEntry("mock", { fixture: "f.json" }),
  };
}
