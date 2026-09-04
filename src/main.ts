import { createEditor } from "./editor";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
  throw new Error("#app mount point missing");
}

createEditor(app);

// ready 信号（前端一半）：webview 首屏挂载完成即打点。
// Rust core 启动完成后会打印 LUMIR_READY 结构化日志（见 src-tauri/src/lib.rs），
// 两端时间戳合起来构成 perf mission 的测量终点（ADR 0002 §6 委托 M0 定义测量方法学）。
const now = performance.now();
console.log(`lumir: webview editor mounted at ${now.toFixed(1)}ms`);
