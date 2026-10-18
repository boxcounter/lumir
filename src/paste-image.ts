// 剪贴板图片粘贴的 **DOM 无关纯判据**（M416，change paste-clipboard-image）。
//
// 为什么单独一个模块（不是留在 `src/editor.ts`）：`tests/unit` 直接跑 `.ts` 源码（Node 的
// strip-only 类型剥离），而 `editor.ts` 的 import 链里有 `src/preview/livePreview.ts` 的
// **参数属性**（`constructor(readonly label: string, …)`）——剥离器直接抛
// `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。判据留在 editor.ts 就等于不可被测；拆到这里，
// 拦截判定 / 目录推导 / 插入事务形态 / 落盘段都能在本层直接钉住（`tests/unit/paste-image.test.ts`）。
//
// 链路本体（DOM paste 事件、EditorView 事务）仍在 `src/editor.ts`：本模块只回答「拦不拦」
// 「落在哪」「插成什么样」，不碰 DOM、不碰 CodeMirror。
//
// 一处硬约束（M415 真机探针，design §2 随批修订）：**检测面是 `clipboardData.items`，不是
// `types`**——本仓 WKWebView 的 `types` 从不出现 `image/*`（文件项一律叫 `"Files"`），
// 精确 MIME 只在 `items[i].type` 上。

import type { EditorMode } from "./bindings/EditorMode";

/** 一次写入的结果（后端 `WrittenAttachment`）：`fresh` = 本次是否新写盘（false = 去重命中）。 */
export interface WrittenPastedImage {
  path: string;
  name: string;
  fresh?: boolean;
}

/** 粘贴时刻的光标上下文快照（change add-semantic-image-naming，design §4.5）。 */
export interface PasteContext {
  /** 当前笔记的 vault 相对路径（无路径的新建文档为 undefined）。 */
  notePath?: string;
  /** 粘贴点（替换 [[前）光标前的段落文本。截断上限在 Rust 侧（唯一一份）。 */
  before: string;
  /** 粘贴点（替换 [[后）光标后的段落文本。 */
  after: string;
}

/** 投递给后端的语义命名任务（`attachment_semantic_name` 的载荷）。 */
export interface SemanticNameTask extends PasteContext {
  /** 刚落盘的图片路径（暂存名）。 */
  path: string;
}

/**
 * 剪贴板图片口令（装配层注入）：`write` 走 `ipc.ts` 的 `fsWriteAttachment`，`toast` 复用装配层
 * 既有的 deck 化提示出口（错误信封按 code 渲染，文案表见 `copy-data.ts` 的 `ERROR_COPY`）。
 * 未注入时整条拦截不启用——能力没接线是结构性表现，与 `setLightbox` 一族同口径。
 */
export interface PasteImagePort {
  /** 落盘一张剪贴板图片，返回内容寻址文件名（前端据此插引用）。 */
  write(
    dirRel: string,
    dataBase64: string,
    sourceMime: string,
  ): Promise<{ path: string; name: string; fresh?: boolean }>;
  /** 失败出口：人话 toast。MUST NOT 静默失败、MUST NOT 插引用留破图。 */
  toast(error: unknown): void;
  /** 语义命名开关（`harness.attachment_naming.enabled` 的粘贴时刻读数）。未注入 = 关。 */
  semanticNaming?(): boolean;
  /** 投递一次语义命名任务（**不 await**：粘贴事务已经完成，结果处理在装配层）。 */
  name?(task: SemanticNameTask): void;
}

/**
 * `clipboardData.items` 里第一个 `image/*` **文件项**的序号；没有则 -1。
 *
 * 图文同板（types = `["Files","text/html"]`）时取首个 image file 项，即已定的「图优先」
 * （design §1）；多图剪贴板只取第一张（proposal 非目标）。
 *
 * 导出给 harness composer 的粘贴分派复用同一条「找第一个 image file 项」语义
 * （change harness-composer-image-paste design §7——composer 没有编辑器模式判据，
 * 复用的是这一步语义本身）。
 */
export function firstImageFileIndex(items: ArrayLike<{ kind: string; type: string }>): number {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind === "file" && item.type.startsWith("image/")) return index;
  }
  return -1;
}

/**
 * **拦截判定**（纯判据，DOM 无关——单测直接喂形状）：md 模式且可编辑、且剪贴板含 `image/*`
 * 文件项时返回该项序号；任一不成立返回 null = 不消费事件（默认文本粘贴逐字节不变）。
 *
 * code / text 模式编辑器、只读文档 MUST NOT 触发本能力（spec「只读与非 md 模式不触发」）；
 * 无 `image/*` 的剪贴板（纯文本 / 富文本 / 非图片文件）走降级条款，一律不拦。
 */
export function imagePasteItemIndex(
  session: { mode: EditorMode; editable: boolean },
  items: ArrayLike<{ kind: string; type: string }>,
): number | null {
  if (session.mode !== "md" || !session.editable) return null;
  const index = firstImageFileIndex(items);
  return index < 0 ? null : index;
}

/** 落盘目录 = 当前文件 vault 相对路径的 dirname；无路径（未保存新文档）退 vault 根（空串）。 */
export function attachmentDirOf(path: string | undefined): string {
  if (path === undefined) return "";
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/**
 * 引用插入的事务形状：`![[<name>]]` **块级独占一行**（design §5）——选区两端若不在行首 /
 * 行尾，各补一个换行把引用顶成独立一行；已在空行（或文档首尾）则原样插。有选区时替换选区
 *（与键入同权；调用方把 `from`/`to` 取自当前选区）。返回 `@codemirror/state` 的 ChangeSpec 形状。
 */
export function pastedImageInsertion(
  doc: string,
  from: number,
  to: number,
  name: string,
): { from: number; to: number; insert: string } {
  const prefix = from > 0 && doc[from - 1] !== "\n" ? "\n" : "";
  const suffix = to < doc.length && doc[to] !== "\n" ? "\n" : "";
  return { from, to, insert: `${prefix}![[${name}]]${suffix}` };
}

/** Blob → 标准 base64（分块 btoa：大图不能一次性展开成超长 `fromCharCode` 参数表）。
 * 导出给 harness composer 的贴图链路复用（change harness-composer-image-paste）。 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

/**
 * 一次贴图的**落盘段**：Blob → base64 → 端口写（后端转码 + 内容寻址 + 去重）。失败**原样
 * 抛出**——调用方（`editor.ts` 的 paste 处理器）负责 toast。抽出来是因为它是链路里唯一可脱离
 * DOM 测的一段（单测用 mock 端口断言成功 / 失败路径与透传的载荷）。
 */
export async function writePastedImage(
  port: Pick<PasteImagePort, "write">,
  dirRel: string,
  blob: Blob,
): Promise<{ path: string; name: string; fresh?: boolean }> {
  const dataBase64 = await blobToBase64(blob);
  return port.write(dirRel, dataBase64, blob.type);
}

/**
 * 语义命名任务的投递判据（change add-semantic-image-naming，design §3 / task 6.4）：开关开、
 * 且本次确实新写盘（去重命中 / 竞态收敛都不投递）。返回 null = 不投递。
 *
 * 「文件名已是语义名」不需要在这里判：`fresh = true` 只可能来自本命令刚写下的暂存名
 * （`fs_io::write_attachment` 是唯一写入口）；再按文件名判一次就是第二份命名形态判据
 * （REVIEW.md「同一语义两处真源」条）。
 */
export function semanticNameTask(
  written: { path: string; fresh?: boolean },
  enabled: boolean,
  context: PasteContext,
): SemanticNameTask | null {
  if (!enabled || written.fresh !== true) return null;
  return { path: written.path, ...context };
}

/**
 * 粘贴时刻的**段落上下文**（design §4.5）：以空行为段落边界，取粘贴点所在段落里光标前 /
 * 光标后的文本。`from` / `to` 是替换区间（无选区时二者相等）。
 *
 * 只做切分，**不做截断**：前 / 后各 500 字符的上限在 Rust 侧（`attachment_naming` 的
 * `CONTEXT_CHARS`，唯一一份；提示词装配也在那一侧）。
 */
export function paragraphContext(
  doc: string,
  from: number,
  to: number,
): { before: string; after: string } {
  const lineStart = (pos: number): number => {
    const index = doc.lastIndexOf("\n", Math.max(0, pos - 1));
    return index < 0 ? 0 : index + 1;
  };
  const lineEnd = (pos: number): number => {
    const index = doc.indexOf("\n", pos);
    return index < 0 ? doc.length : index;
  };
  // 向上扩：只要上一行不是空行，段落就还没到头。
  let blockStart = lineStart(from);
  while (blockStart > 0) {
    const prevEnd = blockStart - 1;
    const prevStart = lineStart(prevEnd);
    if (doc.slice(prevStart, prevEnd).trim() === "") break;
    blockStart = prevStart;
  }
  // 向下扩：只要下一行不是空行，段落就还在继续。
  let blockEnd = lineEnd(to);
  while (blockEnd < doc.length) {
    const nextStart = blockEnd + 1;
    const nextEnd = lineEnd(nextStart);
    if (doc.slice(nextStart, nextEnd).trim() === "") break;
    blockEnd = nextEnd;
  }
  return { before: doc.slice(blockStart, from), after: doc.slice(to, blockEnd) };
}
