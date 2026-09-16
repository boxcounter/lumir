// 诊断事件转发（change add-diagnostics-logging）：前端只有这一个出口，且**只转发**
// 不写文件——落盘全在 Rust 侧（`src-tauri/src/logging.rs`，事件名与字段白名单的唯一
// 来源）。事件名联合类型由 ts-rs 从 Rust 的 LogEventName 导出（src/bindings/），
// 前端不另立清单（两份清单必然漂移）。
//
// 转发是 best-effort：无后端（Node 测试 / 纯浏览器预览桩）、事件被白名单拒绝、写线程
// 不可用，都只是没有日志——日志永远不能反过来打断被观测的路径，所以这里不发也不抛。

import { invoke } from "@tauri-apps/api/core";
import type { LogEventName } from "./bindings/LogEventName";

/** 后台回调慢阈值（ms）：与性能合同 keypress-to-paint 的 16ms 预算同口径。 */
export const SLOW_CALLBACK_MS = 16;

/** 转发一条诊断事件。字段名 / 值域受 Rust 侧白名单约束，越界事件会被拒绝（无副作用）。 */
export function logEvent(event: LogEventName, fields: Record<string, string>): void {
  try {
    void invoke("log_event", { event, fields }).catch(() => {});
  } catch {
    // 无 Tauri 后端时 invoke 可能直接抛（非 Promise 路径）：吞掉，不影响调用方
  }
}

/** 后台回调耗时采样：同步执行 `run`，超过 16ms 记一条 slow_callback。
 *  `name` 区分回调族（fs_entry_changed / mermaid_settle），便于读日志时定位毛刺来源。
 *  run 的返回值与异常原样透传——采样不改变被采样路径的行为。 */
export function sampleCallback<T>(name: string, run: () => T): T {
  const start = performance.now();
  try {
    return run();
  } finally {
    const ms = performance.now() - start;
    if (ms > SLOW_CALLBACK_MS) {
      logEvent("slow_callback", { name, ms: ms.toFixed(1) });
    }
  }
}
