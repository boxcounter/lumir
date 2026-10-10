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
  ): Promise<{ path: string; name: string }>;
  /** 失败出口：人话 toast。MUST NOT 静默失败、MUST NOT 插引用留破图。 */
  toast(error: unknown): void;
}

/**
 * `clipboardData.items` 里第一个 `image/*` **文件项**的序号；没有则 -1。
 *
 * 图文同板（types = `["Files","text/html"]`）时取首个 image file 项，即已定的「图优先」
 * （design §1）；多图剪贴板只取第一张（proposal 非目标）。
 */
function firstImageFileIndex(items: ArrayLike<{ kind: string; type: string }>): number {
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

/** Blob → 标准 base64（分块 btoa：大图不能一次性展开成超长 `fromCharCode` 参数表）。 */
async function blobToBase64(blob: Blob): Promise<string> {
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
): Promise<{ path: string; name: string }> {
  const dataBase64 = await blobToBase64(blob);
  return port.write(dirRel, dataBase64, blob.type);
}
