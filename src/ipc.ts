// invoke / event 契约的前端一半（薄封装，契约本体见 src-tauri/src/commands.rs）。
// 所有 command 调用经此模块进出：类型来自 src/bindings/（ts-rs 由 Rust 单一来源导出），
// 错误统一为 CommandError 信封，调用点不直接碰 invoke 的原始 reject 值。

import { invoke } from "@tauri-apps/api/core";
import type { CommandError } from "./bindings/CommandError";
import type { ConfigSnapshot } from "./bindings/ConfigSnapshot";

/** 判断 invoke 的 reject 值是否为 CommandError 信封。 */
export function isCommandError(e: unknown): e is CommandError {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as CommandError).code === "string" &&
    typeof (e as CommandError).message === "string"
  );
}

/** 读取当前生效配置（示例 command，见 src-tauri/src/commands.rs）。 */
export function configGet(): Promise<ConfigSnapshot> {
  return invoke<ConfigSnapshot>("config_get");
}
