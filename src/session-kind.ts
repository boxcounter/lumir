// 会话档与「是不是文本文档」判据（M629，change add-image-file-preview §1.2）。
//
// 为什么单独一个模块（不是留在 `src/editor.ts`）：`tests/unit` 直接跑 `.ts` 源码（Node 的
// strip-only 类型剥离），而 `editor.ts` 的 import 链里有 `src/preview/livePreview.ts` 的
// **参数属性**（`constructor(readonly view: EditorView, …)`）——剥离器直接抛
// `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。保存链路（save-controller）与标签链路（tabs）的判别性
// 单测必须能在本层直接钉住「图片会话零写入」，判据因此留在零重依赖的叶子模块里
//（与 `src/paste-image.ts` 的拆法同源）。
//
// 语义：图片会话**不是**「空文本会话」——把图片伪装成一份空文档会打开「⌘S 把空文本写回
// 图片文件」这条真实的数据风险（design §1.2 的红线）。全应用只有 `isDocSession` 这一个判据，
// 所有写盘入口与「读 state 做语义」的入口（保存链路三入口、搜索面板、大纲、阅读位置、
// modeline 右段）都经它把关，MUST NOT 各自写一份 `kind !== "image"` 的否定式。

/** 会话的判别档：`"doc"` = 文本文档会话，`"image"` = 图片会话。全生命周期不变。 */
export type EditorSessionKind = "doc" | "image";

/**
 * 「这个会话是不是文本文档」的单一判据。
 *
 * 入参只要求 `kind` 这一格（结构化最小面）：编辑器会话、测试替身、装配层的局部快照都能直接喂。
 */
export function isDocSession(session: { readonly kind: EditorSessionKind }): boolean {
  return session.kind === "doc";
}
