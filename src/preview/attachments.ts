// 附件图片显示（attachment-display capability）。
// 字节来源契约（add-vault-workspace 裁决点 A，invoke+base64 形态）：
//   invoke<string>("fs_read_attachment", { path }) → base64，错误走 CommandError 信封。
// vault 波未合并前：默认 provider 已按该契约编码，调用会失败并自然走占位路径；
// vault 合并后由装配处经 EditorHandle.setAttachmentProvider 注入真实索引
//（全 vault 相对路径列表）。
//
// 扩展名注册表（M130 收敛）：本文件是「扩展名 → 打开/展示分类 + code 语言名 + 附件
// MIME」的唯一事实源，tree.ts（展示与点击分类）、editor.ts（模式裁决与语言包解析）、
// main.ts（附件 data: URL 的 MIME）都从这里消费，模块内不再各自维护集合。落点理由：
// 本模块已持有 extensionOf 与 MIME 表，且在依赖图上位于 editor 之下（editor →
// attachments），注册表放这里不引环；image/binary 分类与附件展示本就同源。

import { invoke } from "@tauri-apps/api/core";
import { WidgetType } from "@codemirror/view";
import { errorMessage } from "../ipc";

/** 扩展名的打开/展示分类。md = Markdown（md 模式，可编辑 + live preview）；
 *  code = 只读 code 模式（有语言包则高亮，无则纯文本）；image = 图片附件；
 *  binary = 明确二进制（不读原文，提示「暂不支持预览」）；text = 未收录扩展或
 *  无扩展名线索（按原文只读打开）。 */
export type FileClass = "md" | "image" | "binary" | "code" | "text";

/** Markdown 扩展名（md 模式 + 保存链接路的准入集合）。 */
const MD_EXTENSIONS = ["md", "markdown"];

/** code 模式扩展名 → legacy-modes 语言名；null = 该扩展无对应语言包（纯文本只读）。
 *  值域即 preview/code.ts 的 LANGUAGES 键（那张表的 `Record<CodeLanguage, …>` 编译期
 *  强制两边一致）。收录口径 = 原 tree.ts CODE_EXTS 与 editor.ts CODE_EXTENSIONS 的并集，
 *  差集逐项裁决：hpp → cpp、bash/zsh → shell、svelte → html（与 vue 同口径：SFC
 *  按 html 兜底）、php → null（legacy-modes 无 php mode，不用近似 parser 冒充高亮）、
 *  cc → cpp、scss → css(sCSS)。裁决记录见 openspec change non-md-readonly-open。 */
const CODE_EXTENSIONS = {
  rs: "rust",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  java: "java",
  rb: "ruby",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  json: "json",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  css: "css",
  scss: "scss",
  html: "html",
  vue: "html",
  svelte: "html",
  xml: "xml",
  swift: "swift",
  kt: "kotlin",
  lua: "lua",
  sql: "sql",
  php: null,
} as const;

/** code 模式的语言名（注册表推导）；preview/code.ts 的 LANGUAGES 用它约束实现覆盖
 *  （`Record<CodeLanguage, StreamLanguage>`：键缺失或多出都在那边编译失败）。 */
export type CodeLanguage = NonNullable<(typeof CODE_EXTENSIONS)[keyof typeof CODE_EXTENSIONS]>;

/** image 扩展名 → data: URL 的 MIME。键集即 image 分类（文件树展示与附件渲染同源；
 *  heic 原先只在文件树的展示集合里，收敛后一并进入附件 MIME 与 isImageName）。 */
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
  heic: "image/heic",
};

/** 明确二进制的扩展名：直接「暂不支持预览」，不浪费一次读取。 */
const BINARY_EXTENSIONS = [
  "pdf", "zip", "gz", "tar", "rar", "7z", "dmg", "exe", "dll", "so", "dylib",
  "app", "jar", "class", "wasm", "ttf", "otf", "woff", "woff2", "mp3", "mp4",
  "mov", "avi", "mkv", "wav", "flac", "sqlite", "db", "icns", "doc", "docx",
  "xls", "xlsx", "ppt", "pptx", "sketch", "fig",
];

interface ExtensionInfo {
  class: FileClass;
  language?: CodeLanguage;
  mime?: string;
}

/** ext（小写、不含点）→ 分类/语言/MIME；未收录的扩展不在此表（消费侧按 text 处理）。 */
const REGISTRY: ReadonlyMap<string, ExtensionInfo> = (() => {
  const map = new Map<string, ExtensionInfo>();
  for (const ext of MD_EXTENSIONS) map.set(ext, { class: "md" });
  for (const [ext, mime] of Object.entries(IMAGE_MIME)) map.set(ext, { class: "image", mime });
  for (const ext of BINARY_EXTENSIONS) map.set(ext, { class: "binary" });
  for (const [ext, language] of Object.entries(CODE_EXTENSIONS)) {
    map.set(ext, language === null ? { class: "code" } : { class: "code", language });
  }
  return map;
})();

/** 路径取扩展名（小写、不含点）；basename 无点（`LICENSE`/`Makefile`）返回空串 ""。
 *  口径（M130 收敛时统一，原先各模块不同）：只按 basename 里最后一个点切分——
 *  无点 basename → ""；dotfile `.gitignore` → "gitignore"（tree.ts 旧口径把点开头视为
 *  无扩展名，收敛后不再如此）。
 *  "" 与未收录扩展在分类上都是「未收录」（fileClass 返回 text）；模式裁决对两者的
 *  处置也一致：**只读 code**（见 editor.ts modeForPath——非 md 一律只读，含无扩展名；
 *  配置 `editor.mode` 只对没有文件上下文的文档有意义）。tree.ts 旧口径把 dotfile 视为
 *  无扩展名、进编辑器回落 md，收敛后这类文件也走只读 code。 */
export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** 扩展名分类；未收录（含无扩展名的 ""）按 text——按原文只读打开，不读成二进制。 */
export function fileClass(ext: string): FileClass {
  return REGISTRY.get(ext)?.class ?? "text";
}

/** code 模式的语言名；不是 code 类或该扩展无语言包时返回 null（纯文本不着色）。 */
export function codeLanguage(ext: string): CodeLanguage | null {
  return REGISTRY.get(ext)?.language ?? null;
}

/** 附件 data: URL 的 MIME；仅 image 类收录，其余返回 undefined（调用侧兜底）。 */
export function mimeTypeOf(ext: string): string | undefined {
  return REGISTRY.get(ext)?.mime;
}

export function isImageName(name: string): boolean {
  return fileClass(extensionOf(name)) === "image";
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
      const mime = mimeTypeOf(extensionOf(path)) ?? "application/octet-stream";
      return `data:${mime};base64,${base64}`;
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

/** 替换区或其内容的可见尺寸（布局盒，单位 px）。 */
export interface ImageBox {
  width: number;
  height: number;
}

/** 图片态文案（deck D111–D113），与 `文案-Copy.md` 逐字一致：本组函数是那三条的唯一真源。 */
export function imageLoadingText(rawRef: string): string {
  return `加载中… ${rawRef}`;
}

export function imageReadErrorText(rawRef: string, reason: string): string {
  return `图片读取失败：${rawRef}（${reason}）`;
}

/** 终态不可见的占位文案：成因中立（`<img>` 的 error 不携带原因，编不出准确成因），
 *  原始引用文本一律保留（alt 与路径都在其中）。 */
export function imageFallbackText(rawRef: string): string {
  return `图片无法显示：${rawRef}`;
}

/** 终态可见判据（纯函数）：替换区的**可见尺寸**非零才算画出来了。
 *  只读 naturalWidth/naturalHeight 不行——`width="100%"` + 仅 viewBox 的 svg 实测
 *  自然尺寸 300×100 而布局盒 0×0（design §8.1 实验矩阵）：内在尺寸对这一态看不见。 */
export function imageVisible(box: ImageBox): boolean {
  return box.width > 0 && box.height > 0;
}

/** 尺寸兜底取点（M178 的第二道保险，适用范围在 M182 后收窄）：替换区布局尺寸为零而引擎给出正
 *  自然尺寸时，按自然宽度设显式像素宽度（高度留 auto，宽高比由引擎的默认对象尺寸决定）；其余情况
 *  返回 null（走占位）。M182 起包装盒宽度与在场内容无关（theme.ts 的 `.cm-lp-image` `width: 100%`），
 *  「固有宽度不确定」的图片按栏宽填充、不再落到这里；本函数只兜引擎确实画不出可见像素的形态
 *  （如 `width="0"` 的 svg、解码失败后的零尺寸盒）。 */
export function imageFallbackWidth(box: ImageBox, natural: ImageBox): number | null {
  if (imageVisible(box)) return null;
  return imageVisible(natural) ? natural.width : null;
}

/** 内联图片 widget：异步读字节，成功渲染 <img>，读取失败 / 解码失败 / 渲染不出可见像素时
 *  原地换可见占位（不抛错、不破图、不留零高度空白）。
 *
 *  MUST 只经 `<img>`（含 `data:` URL）渲染，不得把 SVG 内容内联进 DOM：图片上下文关闭脚本执行
 *  与外部资源解析，内联插入会同时打开两者（规范依据与被禁的四条实现路径见
 *  openspec/changes/archive/2026-09-18-image-svg-and-fallback/design.md §4）。 */
export class ImageWidget extends WidgetType {
  readonly key: string;
  readonly load: () => Promise<string>;
  readonly rawRef: string;

  constructor(key: string, load: () => Promise<string>, rawRef: string) {
    super();
    this.key = key;
    this.load = load;
    this.rawRef = rawRef;
  }

  eq(other: ImageWidget): boolean {
    // rawRef 参与相等性：alt / 加载文案 / 占位文案都取自它——两条引用同一个目标但原文不同的
    // 引用（`![alt](a.svg)` 与 `![[a.svg]]`）必须各自渲染自己那条引用文本。
    return other.key === this.key && other.rawRef === this.rawRef;
  }

  toDOM(): HTMLElement {
    // 内联 replace widget（块级 widget 不允许由插件装饰提供），根元素用 span。
    const wrap = document.createElement("span");
    wrap.className = "cm-lp-image";
    // 加载中状态先落地、直到终态确认才撤：整条源码已被 replace 装饰藏起来，任何
    // 「先清空、再插入」的中间态都会让替换区出现可见空窗（spec 的可见回退不变量）。
    const status = document.createElement("span");
    status.className = "cm-lp-image-status";
    status.textContent = imageLoadingText(this.rawRef);
    wrap.append(status);

    const boxOf = (el: Element): ImageBox => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    };
    const fallback = () => wrap.replaceChildren(errorChip(imageFallbackText(this.rawRef)));

    this.load().then(
      (src) => {
        const img = document.createElement("img");
        img.alt = this.rawRef;
        img.onerror = fallback;
        // 终态处置（三种引用形态共用这一条，不为任何扩展名立分支）：状态块先撤、再量。
        // M182 起包装盒宽度与在场内容无关（theme.ts 的 `.cm-lp-image` `width: 100%`），状态块文本
        // 不再能决定图片宽度；这里先撤它是「终态确认后才撤加载中状态」这条可见性契约的落点
        //（spec 的可见回退不变量：从源码被替换到终态之间始终有可见内容）。撤与随后的插入在同一个
        // 任务内完成，中间不绘制，所以不产生空窗。
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          status.remove();
          if (imageVisible(boxOf(img))) return;
          const width = imageFallbackWidth(boxOf(img), {
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
          if (width !== null) img.style.width = `${width}px`;
          if (!imageVisible(boxOf(img))) fallback();
        };
        img.onload = settle;
        wrap.append(img);
        img.src = src;
        // data: URL 常在赋 src 后**同步** complete：不补一次探测就等不到 load 事件的终态处置。
        if (img.complete) {
          if (img.naturalWidth === 0) img.onerror(new Event("error"));
          else settle();
        }
      },
      (e: unknown) => {
        wrap.replaceChildren(errorChip(imageReadErrorText(this.rawRef, errorMessage(e))));
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
  readonly message: string;
  readonly rawRef: string;

  constructor(message: string, rawRef: string) {
    super();
    this.message = message;
    this.rawRef = rawRef;
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
