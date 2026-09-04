import { createShell } from "./shell";
import { createEditor } from "./editor";
import { Keymap } from "./keys";
import { configGet, isCommandError } from "./ipc";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
  throw new Error("#app mount point missing");
}

// M1 接缝装配：app-shell 布局骨架 + 编辑器单内核 + 键位框架。
// 文件树 / live preview / wikilink 等功能是后续波次，此处只接线骨架。
const shell = createShell(app);
const editor = createEditor(shell.editor);

const keymap = new Keymap();
keymap.attach(window, (command) => {
  // M1 不绑定任何具体功能；分发骨架就位，后续波次在此接命令实现。
  console.log(`lumir: unbound command dispatched: ${command}`);
});

// 契约链路示例：invoke config_get，把结果渲染进面板 pane 作为联通探针。
// CommandError 信封的 message 为人话，可直接展示（见 src-tauri/src/commands.rs）。
configGet()
  .then((snapshot) => {
    editor.setMode(snapshot.config.editor.mode);
    const lines = [
      `config: ok (mode=${snapshot.config.editor.mode})`,
      `path: ${snapshot.path}`,
      ...snapshot.warnings.map((w) => `warning: ${w}`),
    ];
    shell.panel.textContent = lines.join("\n");
  })
  .catch((e: unknown) => {
    shell.panel.textContent = isCommandError(e)
      ? `config 加载失败：${e.message}`
      : `config 加载失败：${String(e)}`;
  });

// ready 信号（前端一半）：webview 首屏挂载完成即打点。
// Rust core 启动完成后会打印 LUMIR_READY 结构化日志（见 src-tauri/src/lib.rs），
// 两端时间戳合起来构成 perf mission 的测量终点（ADR 0002 §6 委托 M0 定义测量方法学）。
const now = performance.now();
console.log(`lumir: webview editor mounted at ${now.toFixed(1)}ms`);
