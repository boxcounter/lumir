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

// ---------------------------------------------------------------------------
// 替换区尺寸的记忆与预留（M187）
//
// 缺陷现场：live preview 的装饰层只为渲染视口内的行建 widget（livePreview.ts 的视口增量），
// 行滚出渲染视口后 widget 被销毁。再次滚回来时 widget 从零重建——重建瞬间 DOM 里只有一行
// 「加载中…」文本，而 CM 的高度图里这个行块仍是上一次测得的整张图片高度。两个高度差一条
// 图片的差值，CM 的滚动锚定（`measure()` 的 scrollAnchorHeight 校正）如实把它翻译成一次
// scrollTop 位移：正文被推开一条图片的高度，字节到达后又被推回来。倒序慢滚经过图片时因此
// 出现「正文向下跳一下再弹回」；当图片底边正好压在正文区顶部（锚点落在该行块内）时，校正
// 无从抵消，用户看到的就是正文整体跳走、随后弹回原位——详见 docs/specs/image-reading.md §5。
//
// 落点：把「上次渲染出的替换区几何」按引用键记在会话内，重建时在字节到达前就按它把行高撑起来。
// 预留用 CSS 的比例式表达（`aspect-ratio` + 必要时 `max-width`），不写死像素高度：高度由浏览器
// 按当前栏宽算出，窗口变化后依然等于终态高度。预留样式挂在一个空的块级占位元素上（它挂进包装盒
// 里，包装盒自己的布局盒不动——M182 的宽度不变量拿包装盒当判据面）。
// ---------------------------------------------------------------------------

/** 重建时的预留样式：`aspectRatio` = 图片宽高比；`maxWidth` = 窄于栏宽的图片要钉住的宽度（px），
 *  `null` 表示不钉、让预留盒包住栏宽（两族的宽度规则见 §1）。 */
export interface ImageReserve {
  readonly aspectRatio: number;
  readonly maxWidth: number | null;
}

/** 替换区的渲染几何：`box` = 上次渲染出的图片布局盒，`column` = 那次渲染时的正文栏宽。 */
export interface ImageGeometry {
  readonly box: ImageBox;
  readonly column: number;
}

/**
 * 由上次渲染几何推出重建时的预留样式；几何不可用（零/负尺寸）时返回 null（不预留，走
 * 加载中状态的自然高度）。
 *
 * 窄图（上次渲染比栏宽窄）要把预留盒钉在那一档宽度上：这类引用的显示宽度是**图片自身的
 * 宽度**（§1 第一族），只给比例不给上限时预留盒会按栏宽算高度、比终态高一截。贴满栏宽的
 * 引用（含只声明 `viewBox` / 百分比宽的矢量图）反过来不能钉：它们的显示宽度就是栏宽，
 * 钉死会把窗口变宽后的显示宽度锁在旧值上（M182 的宽度不变量）。
 *
 * 判据只用「上次渲染坐标」与「那次渲染时的栏宽」，MUST NOT 用自然尺寸信号推断显示宽度
 * （该形态下 `naturalWidth` 是引擎的默认对象尺寸，§1 第二族）。
 */
export function imageReserve(geometry: ImageGeometry): ImageReserve | null {
  const { box, column } = geometry;
  if (!imageVisible(box)) return null;
  const narrow = column > 0 && box.width < column - 1;
  return { aspectRatio: box.width / box.height, maxWidth: narrow ? box.width : null };
}

/** 引用键 → 上次渲染几何。作用域是本会话（模块生存期）：切窗口 / 切文档都保留，
 *  下次重建同一个引用时直接可用。 */
const geometryCache = new Map<string, ImageGeometry>();

/** 缓存上限：只存两个数字，代价可忽略；限长只为「不无限增长」这一条。 */
const GEOMETRY_CACHE_LIMIT = 256;

/** 记下某引用的渲染几何（同键覆盖，超限淘汰最早的一条）。 */
export function rememberGeometry(key: string, geometry: ImageGeometry): void {
  geometryCache.delete(key);
  geometryCache.set(key, geometry);
  while (geometryCache.size > GEOMETRY_CACHE_LIMIT) {
    const oldest = geometryCache.keys().next().value;
    if (oldest === undefined) break;
    geometryCache.delete(oldest);
  }
}

/** 某引用的已知渲染几何；没有（本会话还没渲染过 / 已被失效）返回 undefined。 */
export function knownGeometry(key: string): ImageGeometry | undefined {
  return geometryCache.get(key);
}

/** 失效某引用的几何：字节读不到、终态不可见（图片可能已被换掉）时用——留着它会让重建时
 *  按旧尺寸预留一块空间，而终态是占位块。 */
export function forgetGeometry(key: string): void {
  geometryCache.delete(key);
}

/** 双击终态渲染出的图片时的接线口（拿到那张 `<img>` 与原始引用文本）。未接线（无 lightbox
 *  句柄的纯桩 / 单测）时不传——图片因此没有双击路径，与 attachmentProvider 未接线即走占位同一口径。 */
export type ImageOpenHandler = (img: HTMLImageElement, rawRef: string) => void;

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
  /** 放大查看的双击回调（未接线时为 undefined）。 */
  readonly onDoubleClick: ImageOpenHandler | undefined;

  constructor(key: string, load: () => Promise<string>, rawRef: string, onDoubleClick?: ImageOpenHandler) {
    super();
    this.key = key;
    this.load = load;
    this.rawRef = rawRef;
    this.onDoubleClick = onDoubleClick;
  }

  eq(other: ImageWidget): boolean {
    // rawRef 参与相等性：alt / 加载文案 / 占位文案都取自它——两条引用同一个目标但原文不同的
    // 引用（`![alt](a.svg)` 与 `![[a.svg]]`）必须各自渲染自己那条引用文本。
    // 双击回调**不参与**：它不改变渲染结果，参与进来只会让装饰无谓重建（change design §3）。
    return other.key === this.key && other.rawRef === this.rawRef;
  }

  toDOM(): HTMLElement {
    // 内联 replace widget（块级 widget 不允许由插件装饰提供），根元素用 span。
    const wrap = document.createElement("span");
    wrap.className = "cm-lp-image";
    // M187：本引用若已渲染过（几何在会话缓存里），先用一个空的占位元素把空间撑到终态尺寸，
    // 再落加载中状态。重建瞬间的行高因此与终态一致，CM 的高度图不会突变、滚动锚定也就不会
    // 推移正文（机制与现场见本文件「替换区尺寸的记忆与预留」节与 docs/specs/image-reading.md §5）。
    //
    // 预留样式挂在**子元素**上而不是包装盒上：包装盒的布局盒是 M182 宽度不变量的判据面
    //（首开 / 重开两态必须逐项一致），把 `max-width` 加到包装盒上会让窄图的两态宽度不同
    //（首开按栏宽、重开按自身宽度）。占位元素与图片同尺寸，包装盒的盒子两态一致。
    const known = knownGeometry(this.key);
    const reserve = known ? imageReserve(known) : null;
    const status = document.createElement("span");
    status.className = "cm-lp-image-status";
    status.textContent = imageLoadingText(this.rawRef);
    const placeholder = document.createElement("span");
    placeholder.className = IMAGE_RESERVE_CLASS;
    if (reserve) {
      applyReserve(placeholder, reserve);
      // 加载中状态移出正常流：留在流里会给包装盒塞进行盒、把 inline-block 的基线挪到文本
      // 基线上，与终态（块级图片 → 基线在盒子底边）差几像素（M187 探针实测 8px）。
      wrap.style.position = "relative";
      status.style.position = "absolute";
      status.style.insetInlineStart = "0";
      status.style.insetBlockStart = "0";
      wrap.append(placeholder);
    }
    // 加载中状态先落地、直到终态确认才撤：整条源码已被 replace 装饰藏起来，任何
    // 「先清空、再插入」的中间态都会让替换区出现可见空窗（spec 的可见回退不变量）。
    wrap.append(status);

    const boxOf = (el: Element): ImageBox => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    };
    // 终态不是图片（读取失败 / 解码不可见 / 零尺寸）时，预留随之作废：预留元素与状态块一并
    // 撤掉（占位块要紧凑），并失效缓存（那张图可能已被换掉，留着会按旧尺寸预留）。
    const fallback = () => {
      forgetGeometry(this.key);
      wrap.replaceChildren(errorChip(imageFallbackText(this.rawRef)));
    };

    this.load().then(
      (src) => {
        const img = document.createElement("img");
        img.alt = this.rawRef;
        img.onerror = fallback;
        // 放大查看（M184）：双击**只挂在这一张终态 `<img>` 上**——加载中状态块、读取失败与终态
        // 不可见三类形态都没有 `<img>`，因此「占位不可点开」是结构性事实，不是一条要维护的开关。
        // 阻止默认行为与公式 / mermaid widget 同款（src/preview/math.ts）：原生 caret / 选区若滞留
        // 在被替换的 widget DOM 上，装饰重建后 CM 读取会把落点映射到文档起点。但本 change
        // **不**把光标送进被替换的源码区间——与 M111 / M112「点击进源码编辑」的口径相反：看大图是
        // 查看动作，图片行又没有显露口径，往被替换区间里塞一个不可见光标只会让人以为点坏了
        //（openspec/changes/open-image-lightbox/design.md §4.4）。
        if (this.onDoubleClick !== undefined) {
          const open = this.onDoubleClick;
          img.addEventListener("mousedown", (event) => event.preventDefault());
          img.addEventListener("dblclick", (event) => {
            event.preventDefault();
            open(img, this.rawRef);
          });
        }
        // 终态处置（三种引用形态共用这一条，不为任何扩展名立分支）：状态块先撤、再量。
        // M182 起包装盒宽度与在场内容无关（theme.ts 的 `.cm-lp-image` `width: 100%`），状态块文本
        // 不再能决定图片宽度；这里先撤它是「终态确认后才撤加载中状态」这条可见性契约的落点
        //（spec 的可见回退不变量：从源码被替换到终态之间始终有可见内容）。撤与随后的插入在同一个
        // 任务内完成，中间不绘制，所以不产生空窗。
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          // 行已被渲染视口淘汰（widget 的 DOM 已脱离文档）时不量、不判、不写缓存：脱离文档的
          // getBoundingClientRect 恒为 0×0，量出来的「不可见」是假象——当真走占位路径还会
          // **把已缓存的几何误删**，下一次重建退回冷启动那条位移（M187 属性测试实测 532px：
          // 正向滚过的图片在字节到达前就被淘汰，settle 对脱离文档的 DOM 判成「不可见」）。
          if (!wrap.isConnected) return;
          status.remove();
          placeholder.remove();
          const box = boxOf(img);
          if (imageVisible(box)) {
            // 记下这次渲染的几何（含当时的栏宽），供本次会话内后续重建预留空间（M187）。
            rememberGeometry(this.key, { box, column: columnOf(wrap, box.width) });
            return;
          }
          const width = imageFallbackWidth(box, {
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
        // 同步完成时把 settle 推到微任务：CM 在同一次同步执行里把 widget 的 DOM 插进行里
        //（toDOM 返回后立即挂载），微任务因此能看到「已挂载 / 已被淘汰」的真实状态——上面那条
        // isConnected 判据靠它区分这两者。
        if (img.complete) {
          if (img.naturalWidth === 0) img.onerror(new Event("error"));
          else queueMicrotask(settle);
        }
      },
      (e: unknown) => {
        forgetGeometry(this.key);
        wrap.replaceChildren(errorChip(imageReadErrorText(this.rawRef, errorMessage(e))));
      },
    );
    return wrap;
  }
}

/** 应用预留样式到一个空的块级占位元素：比例给高度（随栏宽自动等于终态高度），上限给窄图的
 *  宽度档位。它是包装盒里唯一的常规流内容，所以它的盒子就是重建瞬间的行高。 */
function applyReserve(placeholder: HTMLElement, reserve: ImageReserve): void {
  placeholder.style.display = "block";
  placeholder.style.aspectRatio = String(reserve.aspectRatio);
  if (reserve.maxWidth !== null) placeholder.style.maxWidth = `${reserve.maxWidth}px`;
}

/** 正文栏宽 = 替换区所在行的宽度（包装盒自己是 `width: 100%`，量不出比它更外层的栏宽）；
 *  行量不到（脱离文档的桩）时退回替换区自身的宽度。 */
function columnOf(wrap: HTMLElement, fallback: number): number {
  const line = wrap.parentElement?.getBoundingClientRect().width ?? 0;
  return line > 0 ? line : fallback;
}

/** 预留占位元素的类名（样式全部内联：尺寸逐引用不同，theme.ts 里不设规则；类名留给
 *  排查时在 DOM 上认元素）。 */
const IMAGE_RESERVE_CLASS = "cm-lp-image-reserve";

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
