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
// 口径（spec「Enter 换行与自动缩进」）：
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
// 2. md 的换行回落按**行**的上下文分派（每个 range 各判，见 enterMarkdownNewline）：
//    - 围栏 / 缩进代码块内：沿用当前行行首空白（代码语义）；
//    - 其外（上游续行命令不接管的散文与列表续行，如 `alpha\n  + `、`alpha\n  - `、`  prose`）：
//      裸换行。md 没有缩进规则，`insertNewlineAndIndent` 在这种情况下会照抄当前行行首空白——
//      那对散文与「段首 marker 的下一行」都是无意义缩进（`alpha\n  + ` + Enter 曾留下两个空格
//      的空行），MUST NOT 再复制。
//    两条都保留上游的**行首空白归一化**：空光标在行首 / 行首空白内时换行落到整段空白之前，
//    空白原样留在下一行行首——MUST NOT 拆出 `" \n prose"` 或只含空白的行；
// 3. 其余上下文（非 md）：`insertNewlineAndIndent` 自动缩进——有缩进规则的语言取语法缩进
//    （`getIndentation`），取不到时它自己回落到「光标所在行的行首空白」（toml / yaml / shell
//    一类无规则的语言走这条）。md 代码块整场交给同一命令（见 enterMarkdownNewline）。本模块
//    **不自己写缩进表**；
// 4. `auto_indent = false`：code 模式与 md 代码块内的自动缩进不接管（返回 false），按键落回
//    浏览器默认 = 本 change 之前的行为。md 的列表 / 引用续行与裸行两态在开关检查之前执行，
//    不受本标志影响——这是 D5a 的显式不对称，不是漏实现。

import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import { countColumn } from "@codemirror/state";
import { insertNewlineAndIndent } from "@codemirror/commands";
import { insertNewlineContinueMarkupCommand } from "@codemirror/lang-markdown";
import { IndentContext, getIndentation, indentString, syntaxTree } from "@codemirror/language";
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
 * 只读会话里本命令返回 false、不产生任何文档变更。守卫在入口**统一**做（早于裸行分派与
 * 上游列表 / 引用委派）：上游 `insertNewlineContinueMarkupCommand` 自己不查 `readOnly`，
 * 只靠各分支自守会让真实列表 / 引用在只读会话里照旧改文档。
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
  const state = view.state;
  // 统一只读守卫：裸行分派、上游列表 / 引用委派、自动缩进都在此之后。上游续行命令自己不查
  // `readOnly`（M399 之前只靠键位层不投递，程序化调用会改文档），契约是「只读会话 MUST NOT
  // 产生任何文档变更」，故在这里挡一次、而不是各分支自守。
  if (state.readOnly) return false;
  if (mode === "md" && enterBareMarkerLine(view)) return true;
  if (mode === "md" && continueMarkupExitEmptyItem(view)) return true;
  if (!autoIndent) return false;
  if (mode !== "md") return insertNewlineAndIndent(view);
  return enterMarkdownNewline(view);
}

/** md 的换行回落：按**每个 range** 的代码块上下文分派（主光标不能替整个选区选模式）。
 *
 *  - 光标在围栏 / 缩进代码块内：沿用当前行行首空白（代码语义）；
 *  - 其外：裸换行，MUST NOT 把行首空白复制给新行（散文里它不是结构）。
 *
 *  两条共用上游 `newlineAndIndent`（`insertNewlineAndIndent` 的实现）的既有处理：光标右侧的
 *  空白并入删除区间（`foo   |` + Enter → `foo\n`）；光标在行首 / 行首空白内时，换行归一到
 *  整段空白之前，被下移的内容行**逐字节保留自己的行首空白**（Tab 仍是 Tab，不做列宽换算）——
 *  不拆开空白、不产生只含空白的行。区别只在「新行是否带缩进」：散文为空串。
 *
 *  为什么整段在这里而不是调 `insertNewlineAndIndent`：上游命令本身逐 range 取缩进
 *  （`getIndentation`），但它只有「自动缩进」一种模式；这里要按 range 在「散文零缩进」与
 *  「代码块沿用行首空白」之间选模式（review r1 P2-3），所以由本函数统一走一次
 *  `state.changeByRange` 分派。缩进取值仍交给编辑器内核的缩进服务（`getIndentation`，取不到
 *  时按上游口径回落到行首空白），md 没有子语言，围栏内容取到的恒是行首空白。
 *
 *  与上游的两个已知差异，都是有意的：
 *  1. 上游的行首空白归一化用**绝对位**切 `line.text`（`line.text.slice(0, from)`），非首行
 *     永远切到整行、归一化失效，会拆出 `" \n prose"` 或只含空白的行；本实现按行相对位判定，
 *     各行的归一化行为一致。
 *  2. 上游在光标夹于 `{}` / `()` / `[]` 之间时展开括号（多插一个换行）；这里复刻它的字面
 *     括号对分支。树侧 `closedBy` 分支在 md 里不可达（markdown 不为任何节点声明 `closedBy`，
 *     围栏内容也没有子语言），故不复制。 */
function enterMarkdownNewline(view: EditorView): boolean {
  const state = view.state;
  const changes = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    const leading = /^[ \t]*/.exec(line.text)?.[0] ?? "";
    const explode =
      range.empty && range.from > 0 && /(\(\)|\[\]|\{\})/.test(state.sliceDoc(range.from - 1, range.from + 1));
    // 代码块新行的缩进：取编辑器内核的缩进服务，取不到时按上游口径回落到行首空白的列数。
    // 归一化分支**不用**这份结果——`indentString` 把列数按缩进单位还原成空格，会把被下移
    // 内容行的 `\t` 改写成等宽空格；该分支必须原样回填 `leading` 原文。
    const lineIndent = indentString(
      state,
      getIndentation(new IndentContext(state, { simulateBreak: range.from }), range.from) ??
        countColumn(leading, state.tabSize),
    );
    // 新行的缩进：代码块沿用行首空白，散文为 0。
    const indent = inCodeBlockAt(state, range.from) ? lineIndent : "";
    let from = range.from;
    let to = range.to;
    let normalized = false;
    if (!explode) {
      while (to < line.to && /\s/.test(line.text[to - line.from])) to++;
      // 行首空白归一化：空光标在行首 / 行首空白内时，换行落到整段空白之前——被下移的内容
      // 行带着自己的行首空白原文（`leading`，Tab 不换算成空格），新行（光标所在的第一行）
      // 为空。不拆开空白、不产生只含空白的行；散文里新行也不带缩进（`indent` 为空串）。
      if (range.empty && from <= line.from + leading.length) {
        from = line.from;
        normalized = true;
      }
    }
    // 括号展开 = 光标处插两个换行（上游 `newlineAndIndent` 的 explode 分支；md 的
    // `cx.lineIndent(line.from, -1)` 恒为 0，故第二段缩进为空）。
    const insert = normalized ? `\n${leading}` : explode ? `\n${indent}\n` : `\n${indent}`;
    return {
      changes: { from, to, insert },
      range: EditorSelection.cursor(from + 1 + (normalized ? leading.length : indent.length)),
    };
  });
  view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
}

/** 光标所在**行**是否在 md 的代码块（围栏 / 缩进）内。
 *
 *  不能只看 `head` 的左邻：缩进代码块的 `CodeBlock` 从首个非空白字符起算，行首、缩进内部与
 *  正文起点在 `resolveInner(head, -1)` 下只解析到 `Document`。这里按行取三个锚点——行首
 *  （右邻，避免把上一行的代码块算进来）、首个非空白字符、行尾（左邻，覆盖空行/围栏边界）——
 *  任一落在 `FencedCode` / `CodeBlock` 内即算代码块。 */
function inCodeBlockAt(state: EditorState, head: number): boolean {
  const line = state.doc.lineAt(head);
  const lead = line.text.search(/\S/);
  const probes: Array<[pos: number, side: -1 | 1]> = [
    [line.from, 1],
    [line.to, -1],
  ];
  if (lead >= 0) probes.push([line.from + lead, 1]);
  for (const [pos, side] of probes) {
    for (let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, side); node; node = node.parent) {
      if (node.name === "FencedCode" || node.name === "CodeBlock") return true;
      if (node.name === "Document") break;
    }
  }
  return false;
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
//   落在删后位置（合法 `>` 引用前缀保留，行首缩进随 marker 一起删——纯空白缩进不是结构）、
//   MUST NOT 新增行；
// - 有内容 Enter = 续行：插 `\n` + 行首前缀原文 + 下一 marker（有序 = 字面序号 +1、分隔符
//   沿用；无序 = 同标记），光标落在新 marker 之后。这条与 M461 之前逐字节一致——续行落在
//   同一结构里，前缀（引用 / 缩进）都有意义，不在本 change 的收窄面内。
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
    // 删到行首缩进之后：引用前缀是行结构（删了会离开引用），缩进只是空白（留着就是
    // 一行纯空白，违反 src/list-indent.ts 的「纯空白行不写」）。光标落删后位置。
    const keep = line.from + bare.quote.length;
    view.dispatch(
      state.update({
        changes: { from: keep, to: line.to },
        selection: { anchor: keep },
      }),
    );
    return true;
  }
  const next = bare.ordered ? `${(bare.number ?? 0) + 1}${bare.delimiter} ` : `${bare.marker} `;
  const insert = `\n${bare.quote}${bare.indent}${next}`;
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
