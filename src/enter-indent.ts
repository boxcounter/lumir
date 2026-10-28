// `Enter` 换行的自动缩进与裸 marker 行 Backspace——**内核键位命令体及其出厂默认**
//（change enter-auto-indent，M272；裸行 Backspace 见 change fix-bare-list-marker-backspace-oct28）。
//
// 为什么单独一个模块（不是 `src/editor.ts` 里的内联闭包）：判定要能在 `tests/unit` 层被直接
// 跑到，而 **`src/editor.ts` 在本仓的 Node 类型剥离口径下不可 import**——它的模块图里有若干
// TypeScript 参数属性（`src/preview/livePreview.ts` / `math.ts` / `mermaid.ts` 的 widget 类），
// `node --experimental-strip-types` 对参数属性直接报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`
//（不支持会生成代码的语法）。本模块只依赖 CM 的 state / view / commands 与 markdown 语言包，
// 没有 DOM 依赖、没有参数属性，因此单测跑的是**生产那份判定本身**，不是复刻一份
//（REVIEW.md 「同一语义两处真源」条：同语义不许两处真源）。
//
// 装配：`src/editor.ts` 的 `modeExtensions` 把 Enter 与裸行 Backspace 装成 `Prec.highest`
// keymap，只在编辑器内核里生效。**MUST NOT 进统一键位表**（`src/keys.ts` 的 KEY_BINDINGS）：
// 表内绑定表达不了「光标在围栏代码块内」这个语法上下文判据，且表内「命中即消费、MUST NOT
// 放回原生路径」的纪律会与「在列表 / 引用里让位给上游续行」直接冲突（裁决 D1a）。
//
// 三条口径（spec「Enter 换行与自动缩进」）：
// 0. md 裸 marker 行（M461，`para\n1. ` 等语法树不接管形态，判定在 src/preview/lists.ts
//    的 bareListMarkerLine）：Enter 两态分派——空项退出（删标记留空行）、有内容续行
//    （下一序号 / 同标记），先于下条的树驱动续行检查；详细口径见文件尾部的
//    enterBareMarkerLine 一节；
// 1. md 列表项 / 引用内：**委派上游** `insertNewlineContinueMarkupCommand`（编辑器内核自带的
//    markdown 语言包以 `Prec.high` 装了同一命令的默认配置版键位），续写标记、保持层级——既有行为，
//    MUST NOT 改变。**唯一例外（M399，Alex 裁决的主流模式）**：空列表项（marker 后只有空白）上的
//    `Enter` 恒走「删一级标记」——去掉行首列表符号、该行保留为普通空行、光标留在该行行首、
//    MUST NOT 额外新增行；嵌套空项则凸一级（Obsidian 式逐层退出）。上游默认配置对「tight 两
//    item 列表的空第二项」走的是「插空行把列表变松、marker 保留」分支（`- a\n- ` → `- a\n\n- `），
//    与裁决冲突，故这里用上游导出的工厂函数以 `{ nonTightLists: false }` 关掉该分支——其余路径
//    （续写、有序重排、引用）与默认配置逐字节一致，仍是同一份上游实现，不是抄来的副本
//   （REVIEW.md 「同一语义两处真源」条）。该委派在 `autoIndent` 检查**之前**：空项退出是列表语义的一部分，
//    与缩进开关无关（D5a 的不对称照旧：关掉自动缩进不影响列表 / 引用续行）；
// 2. 其余上下文：`insertNewlineAndIndent` 自动缩进——有缩进规则的语言取语法缩进
//    （`getIndentation`），取不到时它自己回落到「光标所在行的行首空白」（md 围栏与缩进代码块、
//    toml / yaml / shell 一类无规则的语言都走这条）。本模块**不自己写缩进表**；
// 3. `auto_indent = false`：md 列表 / 引用之外的上下文不接管（返回 false），按键落回浏览器默认
//    = 本 change 之前的行为。注意 md 的列表 / 引用续行与本标志无关（它照旧执行，见上）——这是
//    D5a 的显式不对称，不是漏实现。

import type { EditorView } from "@codemirror/view";
import { insertNewlineAndIndent } from "@codemirror/commands";
import { insertNewlineContinueMarkupCommand } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { bareListMarkerLine } from "./preview/lists";
import type { EditorMode } from "./bindings/EditorMode";

/**
 * 上游续行命令的本仓配置版（M399）：`nonTightLists: false` 关掉「空第二项把 tight 列表变松」
 * 分支，空列表项上的 Enter 恒为「删一级标记」（裁决行为）。工厂与默认导出
 * `insertNewlineContinueMarkup` 是上游同一份实现，仅这一项配置不同。
 */
const continueMarkupExitEmptyItem = insertNewlineContinueMarkupCommand({ nonTightLists: false });

/**
 * `editor.auto_indent` 的 TypeScript 侧出厂默认：键缺席 = 出厂 `true`。与
 * `src-tauri/src/config.rs` 的 `impl Default for EditorConfig` 同值，**两处写值各有单测
 * 钉住**（与 `src/preview/theme.ts` 的三个折行常量同一口径：配置真源在 Rust，TS 侧这一份是
 * 「未接到配置时编辑器自己怎么起步」的兜底）。
 */
export const DEFAULT_AUTO_INDENT = true;

/**
 * `Enter` 键位的命令体。返回 true = 已消费（CM 的 keymap 据此不再往下问别的处理器）；
 * 返回 false = 不接管，按键继续走（上游 `markdownKeymap` 或浏览器默认）。
 *
 * `insertNewlineAndIndent` 在只读会话（`state.readOnly`）与「没有可插入的选区」时返回 false，
 * 因此 `Enter` 在只读会话里不产生任何文档变更。
 *
 * `Shift-Enter` 收不到本命令：CM 的键位查表在按住 Shift 时只查 `Shift-Enter`
 *（`runHandlers` 的 `modifiers(name, event, !isChar)`，Enter 不是单字符键）——两键的不对称
 * 因此是机制性的，不是靠判据挡出来的。
 */
export function enterWithAutoIndent(
  view: EditorView,
  mode: EditorMode,
  autoIndent: boolean,
): boolean {
  if (mode === "md" && enterBareMarkerLine(view)) return true;
  if (mode === "md" && continueMarkupExitEmptyItem(view)) return true;
  if (!autoIndent) return false;
  return insertNewlineAndIndent(view);
}

// ---------------------------------------------------------------------------
// M461：裸 marker 行（`para\n1. ` 等语法树不接管形态）的 Enter 两态分派
// ---------------------------------------------------------------------------
//
// 背景（probe 证据见 test-results/m461-probe/readings.md）：空列表项按 CommonMark 不能
// 打断段落，`para\n1. ` 的行被解析为段落 lazy continuation——既有续行命令（树驱动）不认
// 它。Alex 2026-10-12 dogfood 裁决：输入「1. + 空格」即进入列表编辑（渲染判定在
// src/preview/lists.ts 的 bareListMarkerLine，与这里共用同一份纯判定）。
//
// 两态口径（tower 告 Alex 的 Obsidian 惯例）：
// - 空项（marker 后只有空白）Enter = 退出：删 marker 与其后空白，行保留为空行、光标
//   落在删后位置（引用前缀 / 行首缩进保留）、MUST NOT 新增行；
// - 有内容 Enter = 续行：插 `\n` + 前缀原文 + 下一 marker（有序 = 字面序号 +1、分隔符
//   沿用；无序 = 同标记），光标落在新 marker 之后。
// 两态都是**单次 dispatch**（一次 Enter = 一次撤销步）。光标在 marker 之前（行首结构
// 前缀内）时不接管——回到行首 Enter 的默认行为（该行之前插空行），与 M399 对真实列表
// 项的钉固同口径。判定与渲染层同源（REVIEW.md 「同一语义两处真源」条），MUST NOT 在此复写一份。

/** 光标所在行是裸 marker 行时的 Enter 分派；非裸行 / 只读 / 光标在 marker 前返回 false。 */
export function enterBareMarkerLine(view: EditorView): boolean {
  const state = view.state;
  if (state.readOnly) return false;
  const { head } = state.selection.main;
  const line = state.doc.lineAt(head);
  const bare = bareListMarkerLine(syntaxTree(state), state.doc, line);
  if (bare === null || head < bare.markerFrom) return false;
  const empty = state.doc.sliceString(bare.contentFrom, line.to).trim() === "";
  if (empty) {
    view.dispatch(
      state.update({
        changes: { from: bare.markerFrom, to: line.to },
        selection: { anchor: bare.markerFrom },
      }),
    );
    return true;
  }
  const next = bare.ordered ? `${(bare.number ?? 0) + 1}${bare.delimiter} ` : `${bare.marker} `;
  const insert = `\n${bare.prefix}${next}`;
  view.dispatch(
    state.update({
      changes: { from: head, to: state.selection.main.to, insert },
      selection: { anchor: head + insert.length },
    }),
  );
  return true;
}

/** 裸 marker 行内容起点的 Backspace：单次删去 marker 与其后空白，保留结构前缀。
 *  真列表 / 非空选区 / 正文其他位置 / 只读会话返回 false，让回上游或原生删除。 */
export function backspaceBareMarkerLine(view: EditorView): boolean {
  const state = view.state;
  if (state.readOnly) return false;
  const main = state.selection.main;
  if (!main.empty) return false;
  const line = state.doc.lineAt(main.head);
  const bare = bareListMarkerLine(syntaxTree(state), state.doc, line);
  if (bare === null || main.head !== bare.contentFrom) return false;
  view.dispatch(
    state.update({
      changes: { from: bare.markerFrom, to: bare.contentFrom },
      selection: { anchor: bare.markerFrom },
      userEvent: "delete",
    }),
  );
  return true;
}
