// 附件图片显示（attachment-display capability）。
// 字节来源契约（add-vault-workspace 裁决点 A，invoke+base64 形态）：
//   invoke<string>("fs_read_attachment", { path }) → base64，错误走 CommandError 信封。
// vault 波未合并前：默认 provider 已按该契约编码，调用会失败并自然走占位路径；
// 渲染成功路径用 createStubAttachmentProvider 验证。vault 合并后由其在装配处
// 经 EditorHandle.setAttachmentProvider 注入真实索引（全 vault 相对路径列表）。

import { invoke } from "@tauri-apps/api/core";
import { WidgetType } from "@codemirror/view";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);

const MIME_BY_EXTENSION: Record<string, string> = {
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

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
}

export function isImageName(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(name));
}

/** 附件能力提供者：文件名解析 + 字节读取，均由 vault 侧能力支撑。 */
export interface AttachmentProvider {
  /**
   * vault 内按文件名唯一匹配（裁决点 F 口径）：返回 vault 相对路径；
   * 无匹配返回 null；同名歧义按路径字典序取第一个（确定性，不随机）。
   */
  resolveByName(name: string): string | null;
  /** 按 vault 相对路径读取附件，返回 data: URL；失败 reject（CommandError 或 Error）。 */
  readDataUrl(path: string): Promise<string>;
}

/** 在路径列表内按文件名唯一匹配；matches 先按字典序排序保证歧义时确定性。 */
export function resolveByNameUnique(paths: readonly string[], name: string): string | null {
  const matches = paths
    .filter((p) => p.slice(p.lastIndexOf("/") + 1) === name)
    .sort();
  return matches.length > 0 ? matches[0] : null;
}

/**
 * 生产 provider：读取走 fs_read_attachment 契约；文件名匹配消费 vault 文件索引
 * （vault 波注入；未注入时 index 为空，wiki 引用一律走「附件未找到」占位）。
 */
export function createInvokeAttachmentProvider(
  index: () => readonly string[] = () => [],
): AttachmentProvider {
  return {
    resolveByName: (name) => resolveByNameUnique(index(), name),
    async readDataUrl(path) {
      const base64 = await invoke<string>("fs_read_attachment", { path });
      const mime = MIME_BY_EXTENSION[extensionOf(path)] ?? "application/octet-stream";
      return `data:${mime};base64,${base64}`;
    },
  };
}

/**
 * 渲染路径验证用 stub：任意图片名解析为 stub/<name>，返回内联 SVG data URL。
 * vault 合并前自测用；生产装配不引用它。
 */
export function createStubAttachmentProvider(): AttachmentProvider {
  return {
    resolveByName: (name) => (isImageName(name) ? `stub/${name}` : null),
    readDataUrl(path) {
      if (!path.startsWith("stub/")) {
        return Promise.reject(new Error(`附件未找到：${path}（stub）`));
      }
      const label = path.slice("stub/".length);
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120">` +
        `<rect width="320" height="120" fill="#dfe8f5"/>` +
        `<text x="16" y="66" font-family="monospace" font-size="16" fill="#345">${label}</text>` +
        `</svg>`;
      return Promise.resolve(`data:image/svg+xml;base64,${btoa(svg)}`);
    },
  };
}

/** 目录部分（vault 相对路径）；无目录返回空串。 */
export function dirnameOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/**
 * 标准 md 图片路径解析（spec「附件路径解析口径」）：相对当前文件路径解析；
 * currentFilePath 缺失或解析结果逃逸 vault 根时，回退为 vault 根相对。
 */
export function resolveImagePath(ref: string, currentFilePath: string | undefined): string {
  const base = currentFilePath === undefined ? "" : dirnameOf(currentFilePath);
  const combined = base === "" ? ref : `${base}/${ref}`;
  const parts: string[] = [];
  for (const seg of combined.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) {
        // 逃逸 vault 根：回退为 vault 根相对解析。
        return resolveImagePath(ref, undefined);
      }
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join("/");
}

/** 内联图片 widget：异步读字节，成功渲染 <img>，失败原地换占位（不抛错、不破图）。 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly load: () => Promise<string>,
    readonly rawRef: string,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.key === this.key;
  }

  toDOM(): HTMLElement {
    // 内联 replace widget（块级 widget 不允许由插件装饰提供），根元素用 span。
    const wrap = document.createElement("span");
    wrap.className = "cm-lp-image";
    const status = document.createElement("span");
    status.className = "cm-lp-image-status";
    status.textContent = `加载中… ${this.rawRef}`;
    wrap.append(status);

    this.load().then(
      (src) => {
        const img = document.createElement("img");
        img.alt = this.rawRef;
        img.onerror = () => {
          wrap.replaceChildren(errorChip(`图片解码失败：${this.rawRef}`));
        };
        img.src = src;
        wrap.replaceChildren(img);
      },
      (e: unknown) => {
        const reason = e instanceof Error ? e.message : String(e);
        wrap.replaceChildren(errorChip(`图片读取失败：${this.rawRef}（${reason}）`));
      },
    );
    return wrap;
  }
}

function errorChip(text: string): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "cm-lp-image-error";
  chip.textContent = text;
  return chip;
}

/** 附件引用占位（未找到 / 未接线）或笔记嵌入不支持的提示块；保留原始引用文本。 */
export class AttachmentNoticeWidget extends WidgetType {
  constructor(
    readonly message: string,
    readonly rawRef: string,
  ) {
    super();
  }

  eq(other: AttachmentNoticeWidget): boolean {
    return other.message === this.message && other.rawRef === this.rawRef;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-lp-embed-unsupported";
    el.textContent = `${this.message}：${this.rawRef}`;
    return el;
  }
}
