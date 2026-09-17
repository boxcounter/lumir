// 统一键位层（M131）——全应用唯一的 key → command 分发表。
//
// 收敛前同一物理组合散在五条互不知情的旁路里（M129 survey）：
//   A keys.ts 的 window 级 trie（Mod-Enter）
//   B editor.ts 的 CM keymap（⌃N/P/F/B/E + ArrowUp/Down）
//   C editor.ts 的 domEventHandlers（⌘A 与 ⌃A 都当全选）
//   E main.ts 的裸 window 监听（⌘S 与 ⌃S 都当保存）
//   D livePreview.ts 的 widget 焦点作用域（表格滚动容器的滚动键）
// 合并 e.metaKey || e.ctrlKey 让 ⌘ 与 ⌃ 无法分离（D1 裁决要求拆开）；同一组合两处各
// 写一份，改一处就会漏另一处。现在只有 KEY_BINDINGS 一张表 + Keymap 一个分发器：
//   - scope "global"：任意焦点都生效（轨道 E 的 ⌘S 与轨道 A 的 ⌘Enter 原样迁入）。
//   - scope "editor"：事件目标落在编辑器内容区内才生效。判定用「目标在 contentDOM 内」
//     而非「焦点在编辑器上」——轨道 D 的 widget（表格滚动容器）就在 contentDOM 里，
//     焦点落在其中时 editor 作用域的命令照常委托到同一命令层。M132 起该 widget 自己的
//     滚动键（Escape / Home / End / 左右方向键）也进了这张表：靠 KeyBinding.when 限定
//     「事件目标是该容器才命中」，文本编辑中的同名键照旧走原生 caret 路径（只按 scope
//     会把 Home/End/方向键从文本编辑里吞掉）。
//   - 命令实现留在各自模块（editor.* 在 editor.ts；widget 组在 livePreview.ts，由 editor.ts
//     统一装配；文档/链接命令在 main.ts），经 attach 注入。CommandId 由 COMMAND_IDS 派生，
//     Record<CommandId, CommandRunner> 把「表里每条绑定都有归属命令」变成编译期合同；
//     构造函数再对重复键抛错、attach 再对缺实现抛错（运行期兜底）。
//   - 分发器入口仍检查 event.defaultPrevented：更靠近事件目标的处理器（CM domEvent 手柄、
//     双击选词等）先消费的键不改 chord 状态、直接让路。
// chorded + 非 modal（ADR 0001 §4）不变：多段 chord 的 trie 与超时清空机制照搬，只是
// 建表来源从「各处 register 调用」换成 KEY_BINDINGS。当前表内没有多段 chord。
//
// M132：表可由 ~/.config/lumir 的 [keys] 覆盖（applyKeyOverrides：单键重绑 / 解绑；
// 多段 chord 本版不支持）。覆盖只换「键 → 命令」的对应，命令实现与作用域口径不变。
//
// M133：表新增一个只读消费者——键位查看面板（app.describe-bindings，实现在 main.ts）。
// 它渲染的是分发器**真正在用的**那份表（applyKeyOverrides 的产物，含配置覆盖），不是
// KEY_BINDINGS 默认表；分发语义不变。面板自己的关闭键（Escape / ⌃G）不进本表，理由见
// main.ts 的面板段落：一个 token 只有一条绑定，这两个 token 已被 editor 作用域占用。
//
// M139：表新增一条全局绑定（⌘F → app.search-open），命令实现在装配层 main.ts（搜索能力与
// panel 本体在 src/search.ts）。作用域取 global 而非 editor：mac 惯例是「⌘F 在哪儿都能开查找」，
// 且 panel 打开后焦点在 panel 的输入框里（不在 contentDOM 内），editor 作用域会让「已打开时
// 再按 ⌘F 把焦点移回输入框」这条官方行为失效。panel 自己的关闭键（Escape / ⌃G）与输入框内的
// Enter / ⇧Enter 不进本表，理由同 M133 的面板段落：表内一个 token 只能有一条绑定，Escape 已被
// editor.widget-escape（带 when 条件）占用；那条绑定在焦点落于 panel 时不命中（作用域判定看
// 事件目标是否在 contentDOM 内），两处不构成同一物理键的第二条分发路径。
//
// M148：表新增一条全局绑定（⌘⇧O → toc.toggle），命令实现在装配层 main.ts，能力与大纲浮层在
// src/toc.ts。作用域取 global 而非 editor：浮层打开时焦点在浮层里（不在 contentDOM 内），再按
// 要能收起；空标题文档也要能走到提示。浮层自己的导航键（↑↓ / Enter / Esc）不进本表，理由同
// M133 / M139 的面板段落：表内一个 token 只能有一条绑定，↑↓ 已被 editor.cursor-* 占用、Esc 已被
// editor.widget-escape 占用，浮层就地消费时那两条绑定因作用域判定不命中。
//
// 平台口径（M131 评审 r1 F1 如实记录）：迁移后**表内绑定一律全平台无条件生效**，不再有
// 平台门。两处与迁移前不同，均只在非 macOS 平台可观测：
//   - ⌃N/P/F/B/E 迁移前是 CM keymap 的 `{ mac: "Ctrl-n" }`（只绑 mac），现在非 mac 平台
//     同样接管（⌃N 在部分桌面环境是系统级「新建」惯例，接管它是个潜在的坑）。
//   - 轨道 A 的 `Mod-Enter` 迁为 `Cmd-Enter`：非 mac 平台原本匹配 Ctrl-Enter，该变体不再存在。
// 当前运行目标只有 macOS（Tauri 桌面；CI 的 rust/perf/visual 门禁均为 macos-*，原生菜单
// 全部 cfg(macos)），因此该口径变化无实害。将来若跨平台，需重新引入平台门（给 ⌃ 系绑定
// 加平台维度，或把 ⌃N 一类让回系统惯例）。

export type KeyScope = "global" | "editor";

/** 编辑器内核侧命令 id（实现落在 editor.ts 的 commands 记录）。 */
const EDITOR_CORE_COMMAND_IDS = [
  "editor.cursor-up",
  "editor.cursor-down",
  "editor.cursor-forward",
  "editor.cursor-backward",
  "editor.line-start",
  "editor.line-end",
  "editor.select-all",
  "editor.undo",
  "editor.redo",
  // M132：Emacs 编辑键（档 1/2）
  "editor.delete-char-forward",
  "editor.delete-char-backward",
  "editor.transpose-chars",
  "editor.delete-word-forward",
  "editor.delete-word-backward",
  "editor.kill-line",
  "editor.yank",
  "editor.keyboard-quit",
  "editor.scroll-page-down",
  "editor.scroll-page-up",
  "editor.recenter",
  // M132：shift-extend 扩选（v0 不做 mark mode）
  "editor.extend-char-forward",
  "editor.extend-char-backward",
  "editor.extend-line-down",
  "editor.extend-line-up",
  "editor.extend-line-start",
  "editor.extend-line-end",
  "editor.extend-word-forward",
  "editor.extend-word-backward",
] as const;

/** 轨道 D 的 widget 焦点作用域命令（M132 收编进统一表；实现在 livePreview.ts）。
 *  归在 editor 组：作用域同为 editor（事件目标落在 contentDOM 内的 widget 里），由
 *  editor.ts 的 commands 记录统一装配——分组只表达「谁提供实现」，不改变作用域语义。 */
export const WIDGET_COMMAND_IDS = [
  "editor.widget-scroll-left",
  "editor.widget-scroll-right",
  "editor.widget-scroll-home",
  "editor.widget-scroll-end",
  "editor.widget-escape",
] as const;

export type WidgetCommandId = (typeof WIDGET_COMMAND_IDS)[number];

/** 编辑器侧全部命令 id（内核 + widget）。 */
export const EDITOR_COMMAND_IDS = [...EDITOR_CORE_COMMAND_IDS, ...WIDGET_COMMAND_IDS] as const;

/** 全局命令 id（实现落在装配层 main.ts）。 */
export const GLOBAL_COMMAND_IDS = [
  "document.save",
  // M144：`wikilink.follow` → `link.follow`——命令现在跟随光标/点击处的**链接**，
  // 外链交给系统浏览器、wikilink 走既有跳转链路。名字不再只覆盖 wikilink。
  "link.follow",
  "app.describe-bindings",
  // M139：⌘F 打开文件内搜索（能力与 panel 在 src/search.ts，装配在 main.ts）
  "app.search-open",
  // M148：⌘⇧O 展开/收起轻量大纲浮层（能力与浮层在 src/toc.ts，装配在 main.ts）
  "toc.toggle",
] as const;

/** 全部命令 id：类型与运行期清单同源，测试据此断言无孤儿命令、无越界绑定。 */
export const COMMAND_IDS = [...EDITOR_COMMAND_IDS, ...GLOBAL_COMMAND_IDS] as const;

export type EditorCommandId = (typeof EDITOR_COMMAND_IDS)[number];
export type CommandId = (typeof COMMAND_IDS)[number];

export interface KeyBinding {
  /** 绑定写法：空格分段表示多段 chord；段内是修饰前缀 + `KeyboardEvent.key` 键名。 */
  key: string;
  command: CommandId;
  scope: KeyScope;
  /**
   * 可选的命中条件（M132）：返回 false 时本绑定不接管、事件原样留给原生路径。
   * 用于「同一个物理键在不同焦点下语义不同」的场景——轨道 D 的表格滚动容器键
   *（Home / End / 左右方向键 / Escape）只在焦点落在该 widget 内时生效，文本编辑
   * 中的同名按键必须照旧走原生 caret 路径。作用域（scope）只能表达「在不在编辑器
   * 内容区内」，表达不了这一层，故单列一个条件。
   */
  when?: (event: KeyboardEvent) => boolean;
  /** 这条绑定的归属与来由——表即文档，新绑定必须写清为什么是它。 */
  doc: string;
}

/** 表格滚动容器（livePreview 的 grid 表格 widget）的 class：widget 键的命中条件用。 */
export const TABLE_SCROLL_CLASS = "cm-lp-table-scroll";

/** 事件目标是否落在表格滚动容器内（含其后代）。 */
function isWidgetKeyTarget(event: KeyboardEvent): boolean {
  const target = event.target;
  return target instanceof Element && target.closest(`.${TABLE_SCROLL_CLASS}`) !== null;
}

/** 表格滚动容器内左右方向键的步进（原 livePreview 手柄口径，迁移不改行为）。 */
export const WIDGET_SCROLL_STEP_PX = 120;

/**
 * 唯一分发表（D1/D2/D3 落点见各条 doc）。键位 token 的口径：
 *
 * - 修饰键逐个记录：Cmd（⌘）/ Ctrl（⌃）/ Alt（⌥）/ Shift，**不再合并成 Mod**——
 *   ⌘ 系全归 mac 惯例、⌃ 系全归 Emacs（D1），两者必须可判别。
 * - 键名取 `KeyboardEvent.key` 拼写，单字符一律大写；修饰前缀顺序无关（归一化）。
 * - US 布局上必须按 Shift 才能打出的符号（`_ + { } | : " < > ? ~ ! @ # $ % ^ & * ( )`）
 *   按「Shift 已隐含在字符里」处理：⌃_ 在 mac 键盘上物理是 ⌃⇧-，事件给的是
 *   key="_" + shiftKey=true，表里写 `Ctrl-_` 即可匹配，不必写成 `Ctrl-Shift-_`。
 * - **含 Alt 的组合写物理键名**（`KeyboardEvent.code`，如 `Minus`）：macOS 的 Alt 层会
 *   替换字符（⌥⇧- → "—"、⌥a → "å"），`e.key` 判别不了用户按的键。⌃⌥_ 这条 Emacs 别名
 *   物理是 ⌃⌥⇧-，表里因此写 `Ctrl-Alt-Minus`；Shift 不参与该判定（已隐含在字符里）。
 */
export const KEY_BINDINGS: readonly KeyBinding[] = [
  // ── 编辑器内：垂直移动（M103 硬化路径：逐视觉行 + 跨原子块钳制 + SelectionRange 揭示）
  { key: "ArrowDown", command: "editor.cursor-down", scope: "editor", doc: "全平台接管：原生 contenteditable 路径越出视口时整屏跳变（M103）" },
  { key: "ArrowUp", command: "editor.cursor-up", scope: "editor", doc: "同上（M103）" },
  { key: "Ctrl-n", command: "editor.cursor-down", scope: "editor", doc: "macOS 文本系统 Emacs 惯例 ⌃N；原生路径跨原子块落点错误（M110 同族）" },
  { key: "Ctrl-p", command: "editor.cursor-up", scope: "editor", doc: "macOS 文本系统 Emacs 惯例 ⌃P" },

  // ── 编辑器内：水平移动（M110/M111 硬化路径：原子块跨入钳制 + 退化测量回退）
  { key: "Ctrl-f", command: "editor.cursor-forward", scope: "editor", doc: "原生 caret 进不了 replace 公式 widget，边界回弹（M110/M111）" },
  { key: "Ctrl-b", command: "editor.cursor-backward", scope: "editor", doc: "同上（M110/M111）" },

  // ── 编辑器内：行首 / 行尾（对称的一对；⌃E 既有，⌃A 本 mission 新增）
  { key: "Ctrl-e", command: "editor.line-end", scope: "editor", doc: "行尾；落点藏进隐藏 replace 时回退到最后可停靠位（M118）" },
  { key: "Ctrl-a", command: "editor.line-start", scope: "editor", doc: "D2 裁决：⌃A = 行首（Emacs C-a），与 ⌃E 对称；全选改由 ⌘A 承担" },

  // ── 编辑器内：全选（⌘ 系归 mac 惯例）
  { key: "Cmd-a", command: "editor.select-all", scope: "editor", doc: "D1/D2：⌘A 保留全选，与 macOS 原生 Edit 菜单同键（菜单项不带 accelerator 时由本层兜底，见 lib.rs）" },

  // ── 编辑器内：撤销 / 重做（M131 新增能力，CM history 线性双栈，见 editor.ts）
  { key: "Cmd-z", command: "editor.undo", scope: "editor", doc: "mac 惯例撤销；原生 Edit 菜单的 Undo 项已让出该键（lib.rs）" },
  { key: "Cmd-Shift-z", command: "editor.redo", scope: "editor", doc: "mac 惯例重做；原生 Edit 菜单的 Redo 项已让出该键（lib.rs）" },
  { key: "Ctrl-/", command: "editor.undo", scope: "editor", doc: "Emacs 规范绑定 C-/" },
  { key: "Ctrl-_", command: "editor.undo", scope: "editor", doc: "Emacs 别名 C-_（mac 物理为 ⌃⇧-，token 口径见上）" },
  { key: "Ctrl-Alt-Minus", command: "editor.redo", scope: "editor", doc: "Emacs 系重做别名 ⌃⌥_（mac 键盘物理为 ⌃⌥⇧-；Alt 层把 - 换成 —，故按物理键 Minus 判定，见上）" },

  // ── 编辑器内：翻屏与重定位（M132 档 1）
  { key: "Ctrl-v", command: "editor.scroll-page-down", scope: "editor", doc: "Emacs C-v（scroll-up）：视口向后翻一屏，光标不动——阅读推进用，不给原生路径（原生滚动与 CM 视口重建叠加会整屏跳变，M103 同族）" },
  { key: "Alt-KeyV", command: "editor.scroll-page-up", scope: "editor", doc: "Emacs M-v（scroll-down）；含 Alt 的组合按物理键判定（Alt 层把 v 换成 √，e.key 认不出，见文件头 token 口径）" },
  { key: "Ctrl-l", command: "editor.recenter", scope: "editor", doc: "Emacs C-l：把光标行滚到视口居中（revealLine 同款 y:\"center\"；v0 不做 Emacs 的三段循环）" },

  // ── 编辑器内：删除与转置（M132 档 1；表格 cell 内一律钳到 cell 边界，绝不跨过隐藏管道符）
  { key: "Ctrl-d", command: "editor.delete-char-forward", scope: "editor", doc: "Emacs C-d；表格 cell 内钳到 cell 尾（M129 survey 实证：跨过隐藏管道符即破坏表格结构）" },
  { key: "Ctrl-h", command: "editor.delete-char-backward", scope: "editor", doc: "Emacs C-h（macOS 文本系统的退格键位）；cell 边界同上" },
  { key: "Ctrl-t", command: "editor.transpose-chars", scope: "editor", doc: "Emacs C-t：转置光标两侧字符并把光标移到两者之后（行尾时转置前两个）" },
  { key: "Alt-KeyD", command: "editor.delete-word-forward", scope: "editor", doc: "Emacs M-d kill-word（Alt 层把 d 换成 ∂，按物理键判定）；cell 边界同 ⌃D" },
  { key: "Alt-Backspace", command: "editor.delete-word-backward", scope: "editor", doc: "Emacs M-DEL backward-kill-word（真机 ⌥⌫）；cell 边界同上" },

  // ── 编辑器内：kill / yank（M132 档 2；单槽 kill buffer，kill ring 后续）
  { key: "Ctrl-k", command: "editor.kill-line", scope: "editor", doc: "Emacs C-k：kill 到行尾（已在行尾则连带换行，Emacs 口径）；表格 cell 内只到 cell 尾，绝不跨过隐藏管道符" },
  { key: "Ctrl-y", command: "editor.yank", scope: "editor", doc: "Emacs C-y：插入 kill buffer（单槽；连续 ⌃K 的内容追加进同一槽，等价 Emacs 的连续 kill 合并）" },
  { key: "Ctrl-g", command: "editor.keyboard-quit", scope: "editor", doc: "Emacs C-g keyboard-quit：撤下进行中的选择（折叠为光标）；多段 chord 的 pending 本就在无关键上自动清空" },

  // ── 编辑器内：shift-extend 扩选（M132；v0 不做 mark mode，选区只有 anchor/head 两端）
  { key: "Ctrl-Shift-f", command: "editor.extend-char-forward", scope: "editor", doc: "macOS 文本系统的 ⌃⇧F（⌃F 的扩选变体）：保持 anchor，head 逐字符前移（沿用 ⌃F 的硬化落点）" },
  { key: "Ctrl-Shift-b", command: "editor.extend-char-backward", scope: "editor", doc: "同上，⌃⇧B" },
  { key: "Ctrl-Shift-n", command: "editor.extend-line-down", scope: "editor", doc: "⌃⇧N：按垂直移动的硬化落点向下扩选（跨原子块钳制与表格行路由同 ⌃N，只多保留 anchor）" },
  { key: "Ctrl-Shift-p", command: "editor.extend-line-up", scope: "editor", doc: "同上，⌃⇧P" },
  { key: "Ctrl-Shift-a", command: "editor.extend-line-start", scope: "editor", doc: "⌃⇧A：扩选到行首（落点口径同 ⌃A，含隐藏 replace 退化回退）" },
  { key: "Ctrl-Shift-e", command: "editor.extend-line-end", scope: "editor", doc: "⌃⇧E：扩选到行尾（落点口径同 ⌃E）" },
  { key: "Alt-KeyF", command: "editor.extend-word-forward", scope: "editor", doc: "⌥⇧F：按词向后扩选；含 Alt 的组合按物理键且 Shift 不参与判定（M131 token 口径），故与 ⌥F 同 token——v0 未绑 ⌥F 的单词移动，见 openspec change emacs-keys-pack 的 shift-extend requirement「本版已知限制」" },
  { key: "Alt-KeyB", command: "editor.extend-word-backward", scope: "editor", doc: "⌥⇧B：按词向前扩选；token 口径同 ⌥⇧F" },

  // ── 编辑器内：轨道 D 的表格滚动容器（widget）焦点键（M132 从 livePreview 手柄收编）
  // when 把命中限定在 widget 焦点内：文本编辑中的 Home / End / 左右方向键 / Escape
  // 必须照旧走原生 caret 路径（连同名键一起绑会把这些键从文本编辑里吞掉）。
  { key: "ArrowLeft", command: "editor.widget-scroll-left", scope: "editor", when: isWidgetKeyTarget, doc: "表格滚动容器焦点内的 ←（原手柄的 120px 步进）；when 保证文本编辑中的 ← 不受影响" },
  { key: "ArrowRight", command: "editor.widget-scroll-right", scope: "editor", when: isWidgetKeyTarget, doc: "容器焦点内的 →（原手柄口径）" },
  { key: "Home", command: "editor.widget-scroll-home", scope: "editor", when: isWidgetKeyTarget, doc: "容器焦点内的 Home：横向滚回最左" },
  { key: "End", command: "editor.widget-scroll-end", scope: "editor", when: isWidgetKeyTarget, doc: "容器焦点内的 End：横向滚到最右" },
  { key: "Escape", command: "editor.widget-escape", scope: "editor", when: isWidgetKeyTarget, doc: "容器焦点内的 Escape：焦点交还编辑器（view.focus()），随后按键回到文本上下文" },

  // ── 全局
  { key: "Cmd-s", command: "document.save", scope: "global", doc: "D3 裁决：⌘S 是唯一保存键；⌃S 解绑（预留给 isearch），不再触发保存" },
  { key: "Cmd-Enter", command: "link.follow", scope: "global", doc: "轨道 A 原样迁入（键位与作用域不变，迁移前挂在 window 上）；M144 起命令跟随光标/选区处的**链接**：外链经 Rust 交给系统浏览器，wikilink 走既有跳转链路——同一条命令，不再只管 wikilink" },
  { key: "Cmd-/", command: "app.describe-bindings", scope: "global", doc: "键位查看面板（M133）：mac 帮助惯例的简化形态——系统「帮助」菜单的 accelerator 实为 ⇧⌘?（Cmd-?），该键在本应用的原生菜单下会先被系统 Help 菜单截获，故取 ⌘/；Emacs 的 C-h b（describe-bindings）不可用——⌃H 已被后删字符占用" },
  { key: "Cmd-f", command: "app.search-open", scope: "global", doc: "文件内搜索（M139）：mac 惯例的查找键；取 global 而非 editor——焦点在文件树或已打开的搜索框里时同样要能开（已打开则把焦点移回输入框）。⌃F 已被 Emacs C-f（前移字符）占用，故沿用 ⌘ 系" },
  { key: "Cmd-Shift-o", command: "toc.toggle", scope: "global", doc: "轻量大纲（M148）：⌘⇧O 展开/收起 masthead 的标题路径浮层。取 global 而非 editor——浮层打开时焦点在浮层里（不在 contentDOM 内），再按要能收起；空标题文档也要能走到提示。冲突已核（零冲突）：表内 ⌘⇧ 系只有 ⇧⌘Z（重做），原生菜单的 accelerator 集合里 ⌘⇧ 系也只有 ⇧⌘Z（muda predefined：Redo），macOS 的 Help 子菜单在 tauri 默认菜单里为空" },
];

/** 命令实现：命中即已消费——分发器统一吞掉默认行为，命令本身无事可做也不放行原生路径。
 *  M132 起接收触发事件（可选）：widget 焦点键需要知道事件目标（焦点在哪个容器里），
 *  「哪个元素被按到」属于事件本身，不该让命令去猜全局焦点。既有实现不带参数，不受影响；
 *  菜单通道（无键盘事件）同样只是不传该参数。 */
export type CommandRunner = (event?: KeyboardEvent) => void;

/** 命令实现表：缺任何一条 command id 都是编译错误。 */
export type CommandRuntime = Record<CommandId, CommandRunner>;

export interface KeymapContext {
  /** 事件目标是否落在编辑器内容区内（含其中的 widget，如表格滚动容器）。 */
  isEditorEvent(event: KeyboardEvent): boolean;
}

/** chord 进行中 buffer 的清空超时（ms）。 */
const CHORD_TIMEOUT_MS = 1500;

/** 单独按下不构成键位的修饰键（`KeyboardEvent.key` 口径）。 */
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

/** 修饰前缀写法 → 表内规范拼写（大小写与别名都收，避免表内写法漂移成静默不匹配）。 */
const MODIFIER_ALIASES = new Map<string, string>([
  ["cmd", "Cmd"],
  ["command", "Cmd"],
  ["meta", "Cmd"],
  ["ctrl", "Ctrl"],
  ["control", "Ctrl"],
  ["alt", "Alt"],
  ["option", "Alt"],
  ["shift", "Shift"],
]);

/** 表内修饰前缀的规范顺序。 */
const MODIFIER_ORDER = ["Cmd", "Ctrl", "Alt", "Shift"] as const;

/** US 布局需 Shift 才能打出的符号：Shift 已隐含在字符本身，token 里不再重复。 */
const SHIFT_IMPLIED_KEYS = new Set([..."_+{}|:\"<>?~!@#$%^&*()"]);

/**
 * 规范化一个键位 token：修饰前缀按 Cmd/Ctrl/Alt/Shift 定序、键名单字符大写。
 * 表内绑定与运行期事件共用本函数，保证两侧口径一致（否则静默不匹配）。
 */
export function normalizeKey(raw: string): string {
  const parts = raw.split("-");
  const mods = new Set<string>();
  let index = 0;
  for (; index < parts.length; index++) {
    const prefix = MODIFIER_ALIASES.get(parts[index].toLowerCase());
    if (prefix === undefined) break;
    mods.add(prefix);
  }
  const key = parts.slice(index).join("-");
  if (key === "") throw new Error(`键位 token 缺键名：${raw}`);
  const named = key.length === 1 ? key.toUpperCase() : key;
  if (SHIFT_IMPLIED_KEYS.has(named)) mods.delete("Shift");
  return [...MODIFIER_ORDER.filter((mod) => mods.has(mod)), named].join("-");
}

/** 事件里与键位判定相关的字段（纯结构，便于脱离 DOM 断言口径）。
 *  `code` 允许缺省（测试合成事件）：缺省时含 Alt 的组合回落 `e.key`。 */
export type KeyEventLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> & {
  code?: string;
};

/** 把一个 keydown 事件规范化为 token（如 "Cmd-Shift-Z"）；纯修饰键返回 null。 */
export function keyToken(event: KeyEventLike): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const mods: string[] = [];
  if (event.metaKey) mods.push("Cmd");
  if (event.ctrlKey) mods.push("Ctrl");
  if (event.altKey) mods.push("Alt");
  // 含 Alt 的组合按**物理键**判定（`KeyboardEvent.code`，与布局无关）：macOS 的 Alt 层
  // 会替换字符——⌥⇧- 给的是 "—"（em dash）、⌥a 给的是 "å"——e.key 里拿不到用户想按的
  // 那个字符，只有 code 能判别（⌃⌥_ 这条 Emacs 别名在真机上就这么活）。Shift 一并忽略：
  // 需要 Shift 才能打出的字符已经写在绑定本身里（表内写物理键名），重复要求只会让平台间
  // 与合成事件（Playwright 的 Control+Alt+_ 不带 shiftKey）互相失配。
  if (event.altKey && event.code !== undefined) {
    return normalizeKey([...mods, event.code].join("-"));
  }
  if (event.shiftKey) mods.push("Shift");
  return normalizeKey([...mods, event.key].join("-"));
}

/** 多段 chord 拆段（空格分段）。 */
function segmentsOf(sequence: string): string[] {
  return sequence.trim().split(/\s+/).map(normalizeKey);
}

/** 一条键位覆盖的解析结果（`null` 值表示解绑）。 */
export type KeyOverrides = Readonly<Record<string, string | null | undefined>>;

/**
 * 把 [keys] 配置覆盖应用到键位表（M132）：单键重绑 / 解绑，返回新表与人话 warning。
 *
 * 口径：
 * - 覆盖**只换「键 → 命令」的对应**：作用域由命令的归属决定（editor 组 → editor，
 *   其余 → global），不随配置漂移，也不允许把 editor 命令绑成 global（否则焦点在
 *   别处时命令拿不到编辑器上下文）。
 * - 未知命令 id：warning + 忽略该条（保留默认绑定），MUST NOT 抛错——配置文件打错
 *   一个字不该让应用起不来。命令清单的单一来源是本文件的 COMMAND_IDS（Rust 侧只
 *   校验形状，不复制这张清单，见 openspec change emacs-keys-pack 的分层说明）。
 * - 空键位 / 多段 chord（含空白）：warning + 忽略（chord 后续版本才支持）。
 * - 解绑一个本来就没有默认绑定的键：warning（多半是笔误），不影响其余项。
 * - 解绑不删除命令实现：命令仍由运行期命令表提供，只是没有键指向它（M131 的
 *   「每条命令至少一条绑定」只约束默认表本身）。
 */
export function applyKeyOverrides(
  overrides: KeyOverrides,
  bindings: readonly KeyBinding[] = KEY_BINDINGS,
): { bindings: KeyBinding[]; warnings: string[] } {
  const warnings: string[] = [];
  const byToken = new Map<string, KeyBinding>();
  for (const binding of bindings) byToken.set(normalizeKey(binding.key), binding);
  for (const [rawKey, command] of Object.entries(overrides)) {
    const raw = (rawKey ?? "").trim();
    if (raw === "" || /\s/.test(raw)) {
      warnings.push(`配置项 keys 里的键位 "${rawKey}" 非法（空或含空白；多段 chord 暂不支持），已忽略`);
      continue;
    }
    let token: string;
    try {
      token = normalizeKey(raw);
    } catch {
      warnings.push(`配置项 keys 里的键位 "${rawKey}" 无法解析（缺键名），已忽略`);
      continue;
    }
    if (command === null || command === undefined) {
      if (byToken.delete(token)) continue;
      warnings.push(`配置项 keys 解绑了 ${rawKey}，但它没有默认绑定，已忽略`);
      continue;
    }
    if (!(COMMAND_IDS as readonly string[]).includes(command)) {
      warnings.push(`配置项 keys.${rawKey} 的命令 "${command}" 未知，已忽略该覆盖（保留默认绑定）`);
      continue;
    }
    const scope: KeyScope = (EDITOR_COMMAND_IDS as readonly string[]).includes(command) ? "editor" : "global";
    byToken.set(token, {
      key: raw,
      command: command as CommandId,
      scope,
      doc: `用户配置重绑（~/.config/lumir 的 keys 表）：${raw} → ${command}`,
    });
  }
  return { bindings: [...byToken.values()], warnings };
}

interface TrieNode {
  children: Map<string, TrieNode>;
  binding?: KeyBinding;
}

export class Keymap {
  private readonly bindings: readonly KeyBinding[];
  private readonly root: TrieNode = { children: new Map() };
  private pending: TrieNode | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(bindings: readonly KeyBinding[] = KEY_BINDINGS) {
    this.bindings = bindings;
    for (const binding of bindings) {
      let node = this.root;
      for (const segment of segmentsOf(binding.key)) {
        let child = node.children.get(segment);
        if (!child) {
          child = { children: new Map() };
          node.children.set(segment, child);
        }
        node = child;
      }
      // 一条键位只能有一个归属：重复即是表写错了（旧实现是后注册者覆盖前者，静默）。
      if (node.binding) {
        throw new Error(`键位表重复绑定：${binding.key} 与 ${node.binding.key} 归一到同一序列`);
      }
      node.binding = binding;
    }
  }

  /** 挂到目标上开始分发；返回解绑函数。 */
  attach(target: Window, runtime: CommandRuntime, ctx: KeymapContext): () => void {
    for (const binding of this.bindings) {
      if (runtime[binding.command] === undefined) {
        throw new Error(`键位表绑定 ${binding.key} → ${binding.command} 没有命令实现`);
      }
    }
    const onKeydown = (event: KeyboardEvent) => this.handle(event, runtime, ctx);
    target.addEventListener("keydown", onKeydown);
    return () => target.removeEventListener("keydown", onKeydown);
  }

  private handle(event: KeyboardEvent, runtime: CommandRuntime, ctx: KeymapContext): void {
    // 更靠近事件目标的处理器（widget 焦点内的滚动键、双击选词等）已经消费：让路。
    if (event.defaultPrevented) {
      this.reset();
      return;
    }
    // IME 组合期不接管（原 CM keymap 由 ignoreDuringComposition 挡住同一批事件；
    // 229 是旧口径的「输入法正在处理」信号）。
    if (event.isComposing || event.keyCode === 229) return;

    const token = keyToken(event);
    if (token === null) return; // 纯修饰键不改变 chord 状态

    const from = this.pending ?? this.root;
    const next = from.children.get(token);
    if (!next) {
      // 不在任何 chord 路径上：清空 pending，按键照常透传。
      this.reset();
      return;
    }

    const binding = next.binding;
    if (binding) {
      this.reset();
      if (binding.scope === "editor" && !ctx.isEditorEvent(event)) return; // 作用域外：不消费
      // 条件不满足（如表格容器键在文本里）：不消费、不 preventDefault，按键留给原生路径
      if (binding.when !== undefined && !binding.when(event)) return;
      event.preventDefault();
      runtime[binding.command](event);
      return;
    }

    // 命中 chord 前缀：进入 pending（吞掉默认行为），超时清空。
    event.preventDefault();
    this.pending = next;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reset(), CHORD_TIMEOUT_MS);
  }

  private reset(): void {
    this.pending = null;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
