import { createShell } from "./shell";
import { createEditor } from "./editor";
import { Keymap } from "./keys";
import { createFileTree } from "./tree";
import {
  configGet,
  errorMessage,
  fsReadAttachment,
  fsReadFile,
  onFsEntryChanged,
  vaultCurrent,
  vaultOpen,
} from "./ipc";
import type { FsEntry } from "./bindings/FsEntry";
import { extensionOf, resolveByNameUnique } from "./preview/attachments";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
  throw new Error("#app mount point missing");
}

// M1 装配：app-shell 三栏 + 编辑器单内核 + 键位框架 + 全类型文件树
//（add-vault-workspace），M20 接上附件链路（add-editor-live-preview）。
// editor.ts 的 EditorHandle 由 editor 波持有，此处只消费，不改其签名。
const shell = createShell(app);
const editor = createEditor(shell.editor);

// 附件索引：vault 内全部文件（不含目录）的 vault 相对路径。provider 的
// resolveByName 闭包活读它，vault 切换 / watch 增量就地更新数组，无需重注。
let attachmentPaths: string[] = [];

// data: URL 的 MIME 推断，与 attachments.ts 私有 MIME_BY_EXTENSION 同口径。
// 该文件不在本 mission scope，对齐点（provider 工厂接受注入的读取函数 /
// 抽出公共 MIME 表）已报 tower，此处就地维护一份。
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

// 附件 provider：文件名匹配走 vault 索引（add-vault-workspace 裁决点 F），
// 字节读取走 ipc 的 fsReadAttachment 封装（裁决点 A，invoke + base64）。
// 索引未命中 → livePreview 出「附件未找到」占位；读取失败 → ImageWidget
// 原地换「图片读取失败」占位，都不抛错。
editor.setAttachmentProvider({
  resolveByName: (name) => resolveByNameUnique(attachmentPaths, name),
  async readDataUrl(path) {
    const base64 = await fsReadAttachment(path);
    const mime = IMAGE_MIME[extensionOf(path)] ?? "application/octet-stream";
    return `data:${mime};base64,${base64}`;
  },
});

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

// 打开文件：读出文本交给 editor.openDocument——模式裁决（文件类型优先，
// 无类型线索回落配置默认）和附件相对路径解析依赖的 currentFilePath 都在
// 内核里完成（spec「模式配置来源」）。不支持的二进制 → 提示而非报错弹窗。
async function openFile(path: string, kind: "md" | "code" | "text" | "binary") {
  if (kind === "binary") {
    showNotice(`暂不支持预览：${path}`);
    return;
  }
  try {
    const text = await fsReadFile(path);
    editor.openDocument(text, path);
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
        if (info) loadVault(info.root, info.entries);
      })
      .catch((e) => tree.showEmpty(errorMessage(e)));
  },
});

// vault 装载的两个入口（手动打开 / 启动恢复）共用：先换附件索引再装文件树。
function loadVault(root: string, entries: FsEntry[]) {
  attachmentPaths = entries.filter((e) => e.kind === "file").map((e) => e.path);
  tree.setVault(root, entries);
}

// watch 增量事件流 → 附件索引与文件树同步打补丁（都不全量重扫）。
// 无 Tauri 后端的环境（如纯浏览器预览）下 listen 会 reject，静默忽略。
onFsEntryChanged((changes) => {
  for (const change of changes) {
    if (change.kind === "deleted") {
      // 目录删除连同子孙一起出索引（与 tree.applyChanges 的级联删除同口径）
      attachmentPaths = attachmentPaths.filter(
        (p) => p !== change.path && !p.startsWith(`${change.path}/`),
      );
    } else if (
      (change.entry_kind ?? "file") === "file" &&
      !attachmentPaths.includes(change.path)
    ) {
      attachmentPaths.push(change.path);
    }
  }
  tree.applyChanges(changes);
}).catch(() => {});

// 启动恢复：后端 setup 已按 last_vault 尝试自动打开；这里拉取结果。
// 未打开 → 空态 + 打开入口；恢复失败 → 空态上人话提示。
vaultCurrent()
  .then((status) => {
    if (status.vault) {
      loadVault(status.vault.root, status.vault.entries);
    } else {
      tree.showEmpty(status.notice);
    }
  })
  .catch((e) => tree.showEmpty(errorMessage(e)));

// 契约链路探针：invoke config_get，把 editor.mode 配置默认应用到编辑器
//（openDocument 对无类型线索文件回落 currentMode，此处把它校准为配置值），
// 并把配置快照渲染进面板 pane。
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
    shell.panel.textContent = `config 加载失败：${errorMessage(e)}`;
  });

// ready 信号（前端一半）：webview 首屏挂载完成即打点。
// Rust core 启动完成后会打印 LUMIR_READY 结构化日志（见 src-tauri/src/lib.rs），
// 两端时间戳合起来构成 perf mission 的测量终点（ADR 0002 §6 委托 M0 定义测量方法学）。
const now = performance.now();
console.log(`lumir: webview editor mounted at ${now.toFixed(1)}ms`);
