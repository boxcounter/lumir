// 行号 gutter 右键复制 `{path}:{line}`（change gutter-copy-path-line-nov21）的**纯取值层**。
//
// 分层与本仓既有同族模块一致（`src/goto-line.ts` / `src/paste-image.ts` / `src/list-indent.ts`）：
//   - 本模块：拼法（唯一真源）与装配层注入端口的类型。零 DOM、零剪贴板、零编辑器内核，
//     因此 `tests/unit` 能直接加载（`src/editor.ts` 的 import 图带参数属性，Node 的 strip-only
//     装载吃不下，理由同 `src/enter-indent.ts` 文件头）。
//   - 右键接线在 `src/editor.ts`（gutter 的 `domEventHandlers`），写剪贴板与 toast 在
//     `src/main.ts`。
//
// 路径口径的唯一来源是会话的 `path`（modeline / 快速打开 / harness 路径链接同一份）：vault 内是
// vault 相对路径，vault 外只读会话是绝对路径。本模块 MUST NOT 解析、补全或规范化路径——它只把
// 拿到的两个值拼成下游（快速打开、harness 路径链接）已经认识的 `{path}:{line}` 形态。

/** 行号 gutter 右键复制的出口（装配层注入 `src/editor.ts`）：只负责「复制什么」，怎么复制
 *  （剪贴板 / 反馈 / 失败处置）由装配层决定。 */
export interface GutterCopyPort {
  /**
   * 复制 `{path}:{line}`。`path` 缺省 = 文档没有路径（未命名文档 / 空态）——出口 MUST NOT
   * 编造路径，SHALL 走失败反馈且不写剪贴板。
   */
  copy(path: string | undefined, line: number): void;
}

/**
 * `{path}:{line}` 的**唯一拼法**（花括号是占位说明，不输出字面花括号）。
 *
 * 与快速打开 / harness 路径链接的 `:行号` 后缀同形：行号 1 基、路径原样、中间只有一个 `:`。
 * 不在冒号两侧加空格——那会让下游按「`path` + `:line`」解析时把空格算进路径。
 */
export function pathLineText(path: string, line: number): string {
  return `${path}:${line}`;
}
