import { createShell } from "./shell";
import { createEditor } from "./editor";
import { Keymap } from "./keys";
import { createFileTree } from "./tree";
import {
  configGet,
  errorMessage,
  fsReadFile,
  onFsEntryChanged,
  vaultCurrent,
  vaultOpen,
} from "./ipc";
import type { EditorMode } from "./bindings/EditorMode";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
  throw new Error("#app mount point missing");
}

// M1 装配：app-shell 三栏 + 编辑器单内核 + 键位框架 + 全类型文件树
//（add-vault-workspace）。editor.ts 导出 API 由 editor 波持有，此处只消费
// createEditor / setMode / view，不改其签名。
const shell = createShell(app);
const editor = createEditor(shell.editor);

const keymap = new Keymap();
keymap.attach(window, (command) => {
  // M1 不绑定任何具体功能；分发骨架就位，后续波次在此接命令实现。
  console.log(`lumir: unbound command dispatched: ${command}`);
});

// 编辑器区域的"暂不支持预览 / 错误提示"覆盖层：显示提示时藏起编辑器本体。
const notice = document.createElement("div");
notice.className = "editor-notice";
notice.hidden = true;
shell.editor.append(notice);

function showNotice(text: string) {
  notice.textContent = text;
  notice.hidden = false;
  editor.view.dom.style.display = "none";
}

function showEditor() {
  notice.hidden = true;
  editor.view.dom.style.display = "";
}

// 打开文件的模式裁决（spec file-tree「点击打开文件」）：md → md 模式，
// 代码文件 → code 模式，无类型线索时用 editor.mode 配置默认值；
// 不支持的二进制 → 提示而非报错弹窗。
let defaultMode: EditorMode = "md";

async function openFile(path: string, kind: "md" | "code" | "text" | "binary") {
  if (kind === "binary") {
    showNotice(`暂不支持预览：${path}`);
    return;
  }
  try {
    const text = await fsReadFile(path);
    editor.view.dispatch({
      changes: { from: 0, to: editor.view.state.doc.length, insert: text },
    });
    editor.setMode(kind === "text" ? defaultMode : kind);
    showEditor();
  } catch (e) {
    // CommandError 的 message 是人话（如非法 UTF-8），直接展示
    showNotice(errorMessage(e));
  }
}

const tree = createFileTree(shell.fileTree, {
  onOpenFile: (path, kind) => void openFile(path, kind),
  onOpenVault: () => {
    vaultOpen()
      .then((info) => {
        // null = 用户在目录选择器取消，无错误状态（spec）
        if (info) tree.setVault(info.root, info.entries);
      })
      .catch((e) => tree.showEmpty(errorMessage(e)));
  },
});

// watch 增量事件流 → 文件树局部刷新（不全量重扫）。
// 无 Tauri 后端的环境（如纯浏览器预览）下 listen 会 reject，静默忽略。
onFsEntryChanged((changes) => tree.applyChanges(changes)).catch(() => {});

// 启动恢复：后端 setup 已按 last_vault 尝试自动打开；这里拉取结果。
// 未打开 → 空态 + 打开入口；恢复失败 → 空态上人话提示。
vaultCurrent()
  .then((status) => {
    if (status.vault) {
      tree.setVault(status.vault.root, status.vault.entries);
    } else {
      tree.showEmpty(status.notice);
    }
  })
  .catch((e) => tree.showEmpty(errorMessage(e)));

// 契约链路探针：invoke config_get，取 editor.mode 默认值并渲染进面板 pane。
configGet()
  .then((snapshot) => {
    defaultMode = snapshot.config.editor.mode;
    const lines = [
      `config: ok (mode=${snapshot.config.editor.mode})`,
      `path: ${snapshot.path}`,
      ...snapshot.warnings.map((w) => `warning: ${w}`),
    ];
    shell.panel.textContent = lines.join("\n");
  })
  .catch((e: unknown) => {
    shell.panel.textContent = `config 加载失败：${errorMessage(e)}`;
  });

// ready 信号（前端一半）：webview 首屏挂载完成即打点。
// Rust core 启动完成后会打印 LUMIR_READY 结构化日志（见 src-tauri/src/lib.rs），
// 两端时间戳合起来构成 perf mission 的测量终点（ADR 0002 §6 委托 M0 定义测量方法学）。
const now = performance.now();
console.log(`lumir: webview editor mounted at ${now.toFixed(1)}ms`);
