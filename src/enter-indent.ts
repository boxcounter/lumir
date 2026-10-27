// `Enter` 换行的自动缩进——**键位命令体与其出厂默认**（change enter-auto-indent，M272）。
//
// 为什么单独一个模块（不是 `src/editor.ts` 里的内联闭包）：判定要能在 `tests/unit` 层被直接
// 跑到，而 **`src/editor.ts` 在本仓的 Node 类型剥离口径下不可 import**——它的模块图里有若干
// TypeScript 参数属性（`src/preview/livePreview.ts` / `math.ts` / `mermaid.ts` 的 widget 类），
// `node --experimental-strip-types` 对参数属性直接报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`
//（不支持会生成代码的语法）。本模块只依赖 CM 的 state / view / commands 与 markdown 语言包，
// 没有 DOM 依赖、没有参数属性，因此单测跑的是**生产那份判定本身**，不是复刻一份
//（REVIEW.md 「同一语义两处真源」条：同语义不许两处真源）。
//
// 装配：`src/editor.ts` 的 `modeExtensions` 把它装成 `Prec.highest(keymap.of([{ key: "Enter" }]))`，
// 只在编辑器内核里生效。**MUST NOT 进统一键位表**（`src/keys.ts` 的 KEY_BINDINGS）：
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
import type { Text } from "@codemirror/state";
import { bareListMarkerLine, markerTextAt, markerTokenAtStart } from "./preview/lists";
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

// ---------------------------------------------------------------------------
// M461②：DOM 输入入口拦 WebKit 原生自动列表（组合期重复插入 marker 的插入者）
// ---------------------------------------------------------------------------
//
// 探针结论（test-results/m461-probe/readings.md）：编辑器全仓无自写 marker 代码，CM 的
// beforeinput 处理器（@codemirror/view dist/index.js 的 handlers.beforeinput）对
// insertOrderedList / insertUnorderedList **不 preventDefault、返回 false**——WebKit
// contenteditable 的原生 smart-list 转换（Alex 中文 IME 组合期重复「1. 」的唯一候选
// 插入者）若触发，默认动作完整执行、CM 再把 DOM 读回成文档变更。这里在 DOM 入口拒收
// 这两个 inputType：编辑器自己的列表语义（裸 marker 行特判 + 上游续行 + TAB 缩进）是
// 唯一合法的列表编辑路径。英文直输路径无这两个事件（probe 实测逐键只有 insertText），
// 拦截对英文输入零影响。

/** WebKit 原生自动列表命令的 inputType 集合（本仓列表语义的「拒收名单」）。 */
export const NATIVE_LIST_INPUT_TYPES: ReadonlySet<string> = new Set([
  "insertOrderedList",
  "insertUnorderedList",
]);

/** beforeinput 入口拦截：inputType 命中拒收名单时 preventDefault 并消费事件。
 *  形态取最小结构（{inputType, preventDefault}）以便单测直驱，生产事件天然满足。 */
export function swallowNativeListBeforeInput(event: {
  inputType?: string;
  preventDefault?: () => void;
}): boolean {
  if (event.inputType === undefined || !NATIVE_LIST_INPUT_TYPES.has(event.inputType)) return false;
  event.preventDefault?.();
  return true;
}

// ---------------------------------------------------------------------------
// M529②：DOM 读回入口拦 WebKit 裸 DOM 变更的重复 marker（inputHandler 层）
// ---------------------------------------------------------------------------
//
// 背景（探针证据 .local/probes/m529-probe/readings.md）：M461② 的 beforeinput 拒收名单
// 只覆盖 insertOrderedList / insertUnorderedList 两个 inputType；Alex 2026-10-15 dogfood
// 踩到的逃逸形态是 WebKit smart-list 在 CM 已消费 Enter、续行「2. 」已渲染后，又把下一
// 序号「3. 」作为**裸 DOM 文本**插进 contenteditable（无上述 inputType）——CM 的
// MutationObserver 把它读回成文档变更，与 CM 自己的续行叠加成「2. 3.」。本机合成键盘
// 进不了组合态（M461 探针已登记），M529 探针以等价注入（probe-hook F11）复现其落点
// 形状：读回变更 = 纯插入，插入文本恰为裸 marker，落点行首至光标恰为裸 marker。M529
// 据此把判据写成「纯插入 + 行首至插入点恰为裸 marker」——M753 的复发证明这个落点假设
// 太窄（见下），判据因此改成按结果行判。
//
// 修复落在 CM 的 EditorView.inputHandler 扩展点：浏览器发起的 DOM 变更在读回成文档
// 变更之前先过 inputHandler（@codemirror/view applyDOMChangeInner），返回 true = 已
// 处理、不再 dispatch 默认插入；flush 随后发现 state 未变 + domChanged 在场会
// view.update([]) 把 DOM 自愈回 state（DOMObserver.flush 的既有行为）——因此吞掉是
// 自愈的：脏 DOM 被重置、无文档变更、无撤销步。键位层（Enter 续行）仍是唯一合法的
// 列表续行来源，本层 MUST NOT 产生任何文档变更。
//
// 判定（纯函数，可单测）：三条同时成立 = WebKit 重复序号，吞掉。
//   ① 变更**落在该行行首 marker 的区域**（marker 起点 … 内容起点，`to >= markerFrom &&
//      from <= contentFrom`，即纯插入 / marker 区内插入 / 覆盖该区的替换都算）；
//   ② 插入文本**以一个列表 marker token 开头**——token 识别走 lists.ts 的
//      `markerTokenAtStart`（与 `markerTextAt` 同一份语法，左边界 = 插入文本起点）；
//      MUST NOT 在本模块另写正则：M753 r1 P2 就是另写一条无左边界等价正则，把非法十位
//      序号 `1234567890. ` 里的九位子串当成 token，进而以「行首不再是 marker」误吞变更；
//   ③ 把变更套进该行后，结果行首**被破坏或变样**——行首不再是 marker（`2.3. `）、marker
//      字面被换掉（`2.` → `3.`），或 marker 之后紧跟另一个 marker（`2. 3. `）。
// 判据按**结果行**判而不是按读回的编码判（M753）：M529 的判据把落点钉死成「纯插入、
// 插入点恰在内容起点」，而 markdown 列表 marker 在 DOM 里被 ListLayout 的 widget **整段
// 替换**（`[行首, 内容起点)` 连尾随空白一起换成 ListMarker，DOM 里已没有「2. 」这串文本，
// 见 src/preview/lists.ts 的 build）——裸插入落在 widget 邻位时，CM 按 DOM 最小 diff 读回
// 出来的落点会落在 marker **区内**（`2.3. `）、表现为覆盖该区的替换，或夹带一个前排空白
// （`2.  3. `），全都不满足「插入点 == 内容起点」，于是从那条缝里逃逸。按结果行判就不必
// 枚举编码：只要读回让「行首已有 marker 的行」多出一个相邻序号、或把它的序号换掉，就吞。
// 放行面逐条核过：普通键入是逐字符 insertText（单字符凑不出「marker + 空白」）；粘贴走
// 剪贴板事件不经 DOM 读回；IME 组合提交是 CJK 文本；内容区（内容起点之后）的插入与替换
// 一律不碰 marker 区域；「\n + marker」的整段续行在内容行尾也不命中——MUST NOT 被误吞。

/** M529② 重复 marker 插入判定：DOM 读回变更是否会在这行造出重复序号（见上方三条件）。
 *
 *  判据三处都取 lists.ts 同一份 marker 语法（`markerTextAt` / `markerTokenAtStart`），
 *  MUST NOT 在本地另写正则——M753 r1 P2 正是另写一条无左边界等价正则，把非法十位序号
 *  `1234567890. ` 里的九位子串当成 token，进而以「行首不再是 marker」误吞用户变更。 */
export function isDuplicateMarkerInsertion(doc: Text, from: number, to: number, text: string): boolean {
  const line = doc.lineAt(from);
  const marker = markerTextAt(line.text, line.from);
  if (marker === null) return false;
  if (!markerTokenAtStart(text)) return false;
  if (to < marker.markerFrom || from > marker.contentFrom) return false;
  // 结果行（只取第一行：带换行的读回属于「新行」而不是本行的 marker）。
  const head = line.text.slice(0, from - line.from) + text + line.text.slice(to - line.from);
  const after = head.split("\n")[0];
  const afterMarker = markerTextAt(after);
  if (afterMarker === null || afterMarker.marker !== marker.marker) return true;
  // marker 之后紧跟另一个 marker（`2. 3. ` / `3. 2. ` / `2.  3. `）：切片从内容起点起解析。
  return markerTextAt(after.slice(afterMarker.contentFrom)) !== null;
}

/** inputHandler 入口：命中重复 marker 插入时返回 true 吞掉（不 dispatch，DOM 由 CM
 *  自愈回 state）；其余读回变更返回 false 走默认插入。 */
export function swallowDuplicateMarkerInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  return isDuplicateMarkerInsertion(view.state.doc, from, to, text);
}
