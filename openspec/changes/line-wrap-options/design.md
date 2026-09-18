# Design: line-wrap-options

本 change 的现状盘点（逐条给文件:行号）、落点、加载时点、作用域边界与被否决方案。
盘点是 2026-09-18 在 worktree `wt-166`（base master `2f16f86`）上实测所得，行号即该 base 的现值；
凡本 worktree 无法复核的（该 worktree 没有 `node_modules`）都在出处上标注「待实现期复核」，
并在 §4 列出对应动作。

## 0. 对任务书前提的一处更正

任务书写「代码块 widget（language-data 着色块）」。实测：**围栏代码块不是 widget**，而是普通文档行
加装饰——`src/preview/livePreview.ts:792-798` 只对块内每行 push
`Decoration.line({ class: "cm-lp-codeblock-line" })`，随后 `collectCodeTokens(...)` 给 token 上 mark
（`:796`），函数返回 `false`（不隐藏任何源码）。全仓 `rg -n "cm-lp-codeblock" src/` 只有两处：
`livePreview.ts:794`（加类）与 `src/preview/theme.ts:59`（样式，只有背景色与等宽字体）。

这个更正决定了实现形态：代码块的折行不能用「widget 自己的 CSS」解决，只能在**行级 `white-space`
+ 块级 wrapper** 两层上做（见 §2.3）。

## 1. 现状盘点

### 1.1 EditorConfig / `config.rs` 字段结构与默认值装配链

| 事实 | 锚点 |
|---|---|
| 配置根类型 `AppConfig`：`version` / `last_vault` / `editor` / `keys` / `log` | `src-tauri/src/config.rs:44-56`（字段 `:45` `:48` `:49` `:53` `:55`） |
| `EditorConfig` **当前只有一个字段** `mode: EditorMode`（struct 本体 `:72-75`） | `config.rs:70-75`（derive/ts 属性 `:70-71`、`mode` 在 `:74`） |
| `RawEditorConfig`（解析侧容忍镜像）只有一个 `mode: Option<String>` | `config.rs:142-146`（`:145`） |
| 对外类型只 derive `Serialize + TS`，**不 derive `Deserialize`**；输入一律走 `Raw*` 镜像 | `config.rs:42` `:70` `:85` `:94` `:110`；镜像 `:129-140` `:142-146` |
| **不给配置字段做 serde rename**：JSON 键名 = Rust 字段名的 snake_case，嵌套表字面量就是 `"editor"` | `config.rs:49` `:53` `:134`；仅枚举有 rename（`#[serde(rename_all = "lowercase")]`，`:86` `:111`） |
| 真实配置形状（验收 harness 写入的即此形） | `scripts/acceptance/lib/app.mjs:28-33`：`{ version, last_vault, editor: { mode }, keys? }`（`writeConfig` 只认 `mode` 与 `keys` 两个可选项，新增字段要一并扩） |
| 默认值三层：各类型 `impl Default` + 镜像上的 `#[serde(default)]` + `validate()` 逐字段回落 | `EditorConfig` 的 `Default` `config.rs:77-83`（`mode: Md` 在 `:80`）；`#[serde(default)]` `:130` `:143`；`validate` `:213-265` |
| `validate()` 的 editor 分支：字段缺失 → 该字段的 `Default` | `config.rs:237-247`（keys `:249`、log `:252`） |
| 版本字段只做「更高版本 → warning + 按当前版本解释」，**没有字段迁移代码** | `config.rs:39`（`SCHEMA_VERSION = 1`）、`:217-226`；新增字段对旧文件的先例是测试而非迁移器：`missing_log_table_defaults_to_info` `:519-526` |
| 整文件解析失败 → 全部默认 + warning（**含字段类型不符**：宽容镜像的字段类型仍是具体的 `Option<T>`，类型错即整份解析失败） | `config.rs:191-209`；文件不存在不算错 `:173-189`。对照：`[keys]` 与 `[log]` 整表收成 `serde_json::Value` 后逐项判定，因此**表级**形状错只丢自己（`:135-139`、`:270-305`、`:310-341`） |
| `config_get` command，注册处 | `src-tauri/src/commands.rs:84-85`；`src-tauri/src/lib.rs:67` |
| ts-rs 导出目标 | 每个类型上的 `#[ts(export, export_to = "../../src/bindings/")]`（`config.rs:43` `:71` `:87` `:95` `:113` `:120`）→ 产物 `src/bindings/EditorConfig.ts` |
| bindings 漂移门禁：`cargo test` 负责导出，随后比对 `src/bindings/` 的 git 差异（含未跟踪新文件） | `scripts/gate.sh:61-70`（`git status --porcelain -- src/bindings/` 在 `:66-70`） |
| 前端只读一次配置：`configGet()` → `snapshot.config.editor.mode` | `src/ipc.ts:38-39`；`src/main.ts:805`（`setMode` 在 `:806`、`applyKeyConfig` 在 `:807`） |
| **无热重载**：`configGet` 全仓只有 import（`src/main.ts:8`）、调用（`:805`）与定义（`src/ipc.ts:38`）三处；无 watcher、无重载 command | 全仓 grep `configGet` 只有上述三处 |
| 唯一的运行期写入只碰 `last_vault`（读取整个 JSON 为 `Value`、改一个键、原子 tmp+rename） | `src-tauri/src/commands.rs:394-428`（保未知字段 `:395-402`；原子替换 `:411-427`）、`:433-439` |

### 1.2 `[keys]` 覆盖机制

| 事实 | 锚点 |
|---|---|
| 配置字段：key 是**键位 token**，value 是**命令 id**，`null` = 解绑 | `config.rs:53`（`HashMap<String, Option<String>>`）、`:137`（raw 槽）；形状说明在模块头 `:10-15` |
| 形状校验：整表形状 `:273-281`、token 空或含空白（多段 chord）拒绝 `:283-288`、值为 null/非空串分支 `:289-302` | `config.rs:270-305` |
| **命令 id 合法性由前端判定**（Rust 不复制命令清单） | `config.rs:12-15`；测试 `keys_unknown_command_is_passed_through_for_frontend_validation` `:507-517` |
| 前端套用：`applyKeyOverrides(overrides, bindings = KEY_BINDINGS)`；token 归一 `:428`、非法 token 警告丢弃 `:430-441`、解绑未绑定的键给警告 `:442-446`、**未知命令 id → 警告 + 保留默认** `:447-450`、作用域派生 `const scope = EDITOR_COMMAND_IDS.includes(command) ? "editor" : "global"` `:451`、新增绑定的来由串 `:456` | `src/keys.ts:422-460` |
| 生效表挂进分发器：`applyKeyConfig` 在无覆盖时直接返回，否则 detach + `new Keymap(bindings).attach(window, commands, keymapContext)` | `src/main.ts:438-448`（由 `:807` 调用） |
| 命令 id 单一真源：`EDITOR_CORE_COMMAND_IDS`(28) / `WIDGET_COMMAND_IDS`(5) / `EDITOR_COMMAND_IDS`(33) / `TAB_GOTO_IDS`(9) / `TAB_COMMAND_IDS` / `NON_TAB_GLOBAL_COMMAND_IDS`(6) / `GLOBAL_COMMAND_IDS`(18) / `COMMAND_IDS`(51) | `src/keys.ts:89-120`、`:125-131`、`:136`、`:142-152`、`:157`、`:160-172`、`:175-179`、`:182` |
| 默认绑定表 47 条字面量 + 9 条生成的 `TAB_GOTO_BINDINGS`；每条必带 `doc` | `src/keys.ts:240-314`（生成 `:220-225`、`:313`）；接口 `:187-202` |
| 命令实现是**全量记录**（编译期强制）：`Record<CommandId, CommandRunner>` | `src/keys.ts:323`；编辑器侧记录 `src/editor.ts:1258-1348`；装配侧记录 `src/main.ts:393-420` |
| `Keymap.attach` 只校验「绑定 → 有实现」，**不**遍历命令清单 | `src/keys.ts:494-503`；重复 token 在构造期抛 `:486-488` |
| **不存在「按 id 调用命令」的通用入口**：全仓 grep `runCommand` / `invokeCommand` / `commandById` / `dispatchCommand` / `executeCommand` 零命中；唯一的无事件按 id 调用是菜单桥 `MENU_COMMANDS` | `src/main.ts:473-480`（`commands["editor.undo"]` 等三条，直接索引记录）；`CommandRunner = (event?: KeyboardEvent) => void` `src/keys.ts:320` |
| **无孤儿命令门禁**：`COMMAND_IDS` 每条必须在 `KEY_BINDINGS` 里有绑定；编辑器子集另有独立一处 | `tests/visual/scenes/m131-keymap-table.spec.ts:52-58`（含 `命令 ${command} 没有任何绑定` 文案）与 `:63-66` |
| 单测只做反方向（每条绑定 → 命令 ∈ `COMMAND_IDS`），没有孤儿检查 | `tests/unit/keys.test.ts:87-95` |
| widget 滚动键的命中条件按「事件目标是否落在容器内」判定（`closest`） | `src/keys.ts:205-211`（`TABLE_SCROLL_CLASS` `:205`、`isWidgetKeyTarget` `:208-211`）；场景用 `focus()` 显式把焦点放到容器上（`tests/visual/scenes/m131-keymap-behavior.spec.ts:171-174`，注释记明「点击走 CM 的 mousedown 会把焦点收回 contentDOM」） |
| 键位面板分组表 9 组，未归组的命令自动落「其他」（`rest.length > 0` 时才渲染） | `src/bindings-panel.ts:31-45`、`:118-119` |
| 面板未绑定行的文案是**面板自带的通用串**（不是命令或绑定的 `doc`）：`未绑定` + `当前没有键位指向它（配置解绑或尚未绑定）` | `src/bindings-panel.ts:93-103`（`binding?.doc ?? "当前没有键位指向它（配置解绑或尚未绑定）"` 在 `:101`）；文案条目 `文案-Copy.md` D65 / D66 |
| 面板场景冻结分组标题数组（9 个，含「标签」）、行数 = `KEY_BINDINGS.length`、未绑定行数 = 0 | `tests/visual/scenes/m133-describe-bindings.spec.ts:66`、`:69`、`:70` |

### 1.3 CM6 `EditorView.lineWrapping` 现状

| 事实 | 锚点 |
|---|---|
| 折行**无条件**装在每个会话上：`sessionState(...)` 的扩展数组里一行 `EditorView.lineWrapping` | `src/editor.ts:1227`（扩展数组 `:1178-1233`；其余项：`history()` `:1197`、domEventHandlers `:1204`、`lumirSearch()` `:1210`、`modeCompartment.of(...)` `:1211`、`changeFilter` `:1216`、`updateListener` `:1217-1226`） |
| 模式差异**不涉及折行**：`modeExtensions` 只有 highlight `:1100-1120`、baseTheme `:1123-1157`、editability `:1163-1167`、md 分支加 `livePreview(...)` `:1169`、code 分支加 `lineNumbers()/highlightActiveLine()` `:1170` | `src/editor.ts:1097-1171` |
| 因此折行对 **md 模式与只读 code 模式一视同仁**；没有独立的只读预览渲染器 | 同上 |
| `EditorView.lineWrapping` 的实现是给 content 加类：`contentAttributes.of({"class": "cm-lineWrapping"})`；样式给 `.cm-content.cm-lineWrapping` `white-space: break-spaces; word-break: break-word; overflow-wrap: anywhere; flex-shrink: 1`，基座 `.cm-content` 是 `white-space: pre`，`.cm-line` **自身不带** `white-space` 声明 | 上游 [view/src/theme.ts](https://raw.githubusercontent.com/codemirror/view/main/src/theme.ts)（main 分支；本仓锁定 `@codemirror/view@6.43.11`，`pnpm-lock.yaml:108`——**待实现期复核**：本 worktree 没有 `node_modules`，未做本地 dist/.d.ts 复核，故「`.cm-line` 自身无 `white-space`」与「`.cm-lineWrapping` 落在 content 上」两条要在实现期用本地 dist 或 `getComputedStyle` 复核一次，见 §4-0） |
| `.cm-scroller` 带 `overflow-x: auto`（CM 基础主题给），本仓主题没取消它 | 本仓 `.cm-scroller` 主题：`src/editor.ts:1129-1135`（md 列 `minmax(24px,1fr) minmax(0,var(--measure)) minmax(24px,1fr)`，code 列首列 `minmax(max-content,1fr)`）；`.cm-content { min-width: 0; width: 100% }` `:1136-1141`；`.cm-line { padding: 0 }` `:1143`；`--measure: 80%` `src/style.css:9` |
| 本仓**没有**任何针对 `.cm-content` / `.cm-line` / `.cm-scroller` 的 `white-space` 覆盖（`src/style.css` 里的 `white-space` 命中都属表格 cell `:325-326`、masthead `:62`、文件树等非编辑器内容面） | `src/style.css` 全量 grep |
| 全前端只有一个 Compartment：`modeCompartment`，重配点四处（挂载 `:1211`、装载 `:1371`、`setMode` `:1409`、前台重载 `:1448`） | `src/editor.ts:979`、`:1211`、`:1371`、`:1409`、`:1448` |
| 会话级状态先例与其陷阱：`mode` 存在会话对象上（逐会话真源），因为 `changeFilter` 的闭包在 state 创建时绑好、只能读实例变量，故内核另存一份「投影」`currentMode`，唯一写入点是 `syncMode()`，由激活 / 装载 / `setMode` 三处调用 | `src/editor.ts:825-858`（`mode` `:836-841` 的注释就是这条陷阱原文）、`:980-986`、`syncMode()` `:1354-1357`、`activate` 里 `:1385` |

### 1.4 代码块（围栏 + language-data 着色）的折行现状

| 事实 | 锚点 |
|---|---|
| 围栏块按**行装饰**呈现：`FencedCode` / `CodeBlock` 的每一行 push `Decoration.line({ class: "cm-lp-codeblock-line" })`，token 由 `collectCodeTokens(...)` 上 mark，源码一行不隐藏 | `src/preview/livePreview.ts:792-798`、`:618-635` |
| 代码块的**全部**样式只有背景色 + 等宽字体；无 `overflow`、无 `white-space`、无宽度 | `src/preview/theme.ts:59`：`".cm-line.cm-lp-codeblock-line": { backgroundColor: "var(--bg-2)", fontFamily: "var(--font-mono)" }` |
| 全仓 `cm-lp-codeblock` 只有两处命中（加类 + 样式） | `src/preview/livePreview.ts:794`、`src/preview/theme.ts:59` |
| 结论：**代码块行今天折行**（继承 `.cm-content.cm-lineWrapping` 的 `break-spaces`），且没有块级滚动容器 | 由上述三条推出 |
| 已有**局部**横向滚动容器的三类结构：表格、块级公式、mermaid | 表格：`src/style.css:273-289`（`.cm-lp-table-scroll { max-inline-size: 100%; overflow-x: auto; overflow-y: hidden; scrollbar-gutter: stable; padding-block: 12px }`）；公式 `src/preview/theme.ts:196`；mermaid `:218` |
| 表格滚动容器的注入机制（复用对象）：`tableWrappers(view)` 返回 `BlockWrapper.set([外层 rank 10 滚动 div, 内层 rank 0 grid div], true)`；只包「矩形且未降级」的表，其余从数组里省掉 | `src/preview/livePreview.ts:234-279`（filter 在 `:254`、`BlockWrapper.create` 在 `:259` `:264`）、注册处 `:317` |
| `EditorView.blockWrappers` 的契约（**待实现期复核**）：facet 值可以是 `RangeSet<BlockWrapper>` 或 `(view: EditorView) => RangeSet<BlockWrapper>`；renderer 遍历**全部** facet 值，故多个 wrapper 函数可并存；`rank` 决定嵌套（小者在内）；wrapper 影响「起点落在其范围内的行/块 widget」；**不许返回 null，跳过 = 从数组里省掉**。出处：上游 `view/src/extension.ts` 与发布的 `index.d.ts`——本 worktree 无 `node_modules`，未做本地复核，故列为 §4-0 的首验项 | 本仓用法见上一行；验证动作见 §4-0 |
| 高度纪律：CM 按 border-box 量行高，**margin 对高度图不可见**，会造成 pos↔coords 漂移，故块级容器只用 padding 不用 margin | `src/preview/theme.ts:95-101`（frontmatter 外层 padding 的注释）、`:206`（降级块同款）、`src/style.css:284-288`；表格容器的 `padding-block: 12px` 正是这条下的选择 |
| 表格 cell 自己有 `white-space: pre-wrap; overflow-wrap: anywhere`（既有例外，本 change 不动） | `src/style.css:325-326` |

### 1.5 键位层「无孤儿命令」不变量的现状

- 不变量在 living spec 里：`openspec/specs/keymap-commands/spec.md:12`（「表内的每条命令 SHALL 至少
  有一条绑定，每条绑定 SHALL 有归属命令」）。
- 门禁在视觉场景的两处循环：`tests/visual/scenes/m131-keymap-table.spec.ts:52-58`（全量）与
  `:63-66`（编辑器子集）。
- 面板侧还有两处隐含假设：行数 = `KEY_BINDINGS.length`、未绑定行数 = 0
  （`tests/visual/scenes/m133-describe-bindings.spec.ts:69` `:70`），以及「打开面板看到生效表」
  scenario 里那句「无「未绑定」行」。
- 追加两条默认不绑键的命令会同时踩到这四处——这不是实现细节，是本 change 必须一并修订的成品面。

## 2. 设计落点

### 2.1 配置面（Rust）

- `EditorConfig` 增两个字段：`line_wrap: bool`、`code_block_wrap: bool`；`Default` 给 `true` / `false`
  （`config.rs:77-83` 就在 `mode` 旁边，装配链与 `mode` 完全同路）。
- `RawEditorConfig` 增 `line_wrap: Option<bool>`、`code_block_wrap: Option<bool>`（`config.rs:142-146`），
  沿用 `#[serde(default)]`：字段缺失 → `None` → `validate()` 回落到 `Default`。
- `validate()` 的 editor 分支按同一形状扩两行（`config.rs:237-247`）。
- **边界如实记录**：`Option<bool>` 遇到类型不符（`"line_wrap": "yes"`）会在 serde 解析期失败，走的是
  **整文件回落**路径（`config.rs:191-209`，全部默认 + warning），与 `editor.mode` 给错类型时同路。
  本 change 不发明「逐字段类型容忍」（那是解析模型的变更，不是新增字段的顺带）。实现期须实测确认
  并留一条单测钉住这条边界（断言此时 `line_wrap` 与 `mode` 一起回到默认，不会出现混合态）。
- ts-rs 自动导出到 `src/bindings/EditorConfig.ts`；`scripts/gate.sh:66-70` 的 bindings 漂移门禁会比对
  该文件的 diff——实现时必须把重新生成的绑定一起提交。
- 命令 id 清单 MUST NOT 出现在 Rust 侧（`config.rs:12-15` 的既有裁决）；本 change 不新增任何 Rust
  侧的命令知识。

### 2.2 前端落点：折行状态的持有者与重配

- **真源在会话对象上**：`EditorSession`（`src/editor.ts:825-858`）新增折行状态字段，与 `mode`
  （`:836-841`）并列。理由是同一份：折行是「这个标签页的显示属性」，内核单值会在切标签页后错位。
- **新增一个模块级 `wrapCompartment = new Compartment()`**，与 `modeCompartment`（`src/editor.ts:979`）
  并列。CM 的 Compartment 以实例身份定位，一个实例可服务多个 state，每个 state 持有自己的那份——
  这正是逐标签页状态天然正确的原因。
- **折行相关扩展只有一处装配**：`wrapExtensions(mode, wrap)`（新增），由 `wrapCompartment` 承载；
  触发重配的只有两个入口——`setMode`（模式变了，md 专属的那部分要跟着变）与 `setWrap`（折行值变了），
  二者共用同一个 `reconfigureWrap()`。**MUST NOT 在 `livePreview()` 内部旁路读折行状态**：那是创建期
  闭包读可变变量，正是 `:836-841` 记下的 `currentMode` 陷阱形态。
- `sessionState(doc, path, mode)`（`src/editor.ts:1178-1233`）增加折行参数，与 `mode` 同形。
- 新会话（`makeSession` `:1235-1246`、`createSession` `:1416-1422`）从**配置默认基线**开始，与
  `defaultMode`（`:980-986`）同形：内核另存一个 `defaultWrap`，**只有配置加载会移动它**。
  toggle 命令 MUST NOT 移动 `defaultWrap`——翻转当前标签页不该改变「新标签页从什么值开始」。
- 状态切回标签页不需要额外同步动作：折行值与 `mode` 不同，它不参与任何创建期闭包，值是随 state 走的，
  `setState` 换 state 即换值（`activate` `:1377-1397`）。这是**不重复 `currentMode` 那套投影**的理由。

### 2.3 代码块「不折行」的实现（两层）

1. **行级 `white-space`**：给 `.cm-content` 加一个内容级类（经 `contentAttributes.of({class})`，与
   `src/editor.ts:1166` 既有用法同路；CM 对 `class` 做拼接，与 `cm-lineWrapping` 不冲突），CSS 在
   「代码块不折行」时把 `.cm-line.cm-lp-codeblock-line` 的 `white-space` 压回 `pre`
   （`overflow-wrap: normal`）。规则只此一条，判定只看 `editor.code_block_wrap`。
2. **块级滚动容器**：新增 `codeBlockWrappers(view)`，与 `tableWrappers`（`src/preview/livePreview.ts:234-279`）
   同形——从语法树取 `FencedCode` / `CodeBlock` 节点的行范围，为每个块返回一个 `BlockWrapper`
   （`div` + 横滚类）。同 facet 的多个 wrapper 函数并存是 §1.4 记下的 CM 契约（**待复核**）；
   若实测 facet 的合并语义是「取最后一个值」，退路是把代码块的容器并入 `tableWrappers` 同一套
   函数（改名为 `blockWrappersFor(view)`，一个函数返回两类容器），语义与 rank 口径不变。
3. **MUST NOT 拷贝表格容器的 `padding-block: 12px`**：给代码块加块级内边距会改变文档高度、把下方所有行
   推走，而 CM 的高度图按 border-box 量（`src/preview/theme.ts:95-101` `:206`；`src/style.css:284-288`）。
   翻转开关带来的几何变化 SHALL 只来自折行本身。容器自己的间距一律走 padding、不用 margin。
4. **内容不可丢**：滚动容器里的仍然是文档真文本，围栏行与源码照常可选中、可编辑
   （`openspec/specs/editor-live-preview/spec.md:156` 的现行口径）。MUST NOT 为了横滚把源码换成
   只读的 `pre` 副本。
5. **性能纪律**：`codeBlockWrappers` 的块发现 SHALL 视口有界（沿用 `tableWrappers` 的做法——
   `tableDiscoveryRange(view)`，`livePreview.ts:234-243`），MUST NOT 全文档扫描。CM 在视图更新时调用
   该函数；表格已经在这条路上，不新增量级。
6. **键盘可达性（本 change 一并做，见 proposal D4）**：容器 SHALL 可聚焦（`tabindex=0`）并带
   `role="region"` 与读屏名（与表格容器同形，`livePreview.ts:262`），且 SHALL 与表格容器**共用同一
   判据**，使既有五条 widget 滚动键对代码块生效。判据的单一来源在 `src/keys.ts`：新增一个泛化的
   「块级横滚容器」class（如 `cm-lp-block-scroll`）由两类容器共用，`isWidgetKeyTarget`
   （`:208-211`）改查它；表格容器**同时保留原 class** `cm-lp-table-scroll`（`TABLE_SCROLL_CLASS`
   `:205`）——既有选择器与断言按它定位（`tests/visual/scenes/m119-table-width.spec.ts`、
   `tests/visual/scenes/m131-keymap-behavior.spec.ts:171-174` 等多处，`tests/unit/keys.test.ts:249`
   还断言该常量字面量），改名会把这些断言一并拖进来，收益只是名字好听。
   **实现期须确认**：判据现在表达的是「事件目标在容器内」，而期望语义是「容器自己持有这次按键的
   焦点」（M132 的既有 scenario 要求「文本编辑中的方向键不受影响」；`m131-keymap-behavior` 的 widget
   场景用 `focus()` 显式制造该状态，其注释也记明点击会把焦点收回 contentDOM）。若实测发现光标落在
   代码块文本里时方向键被容器吞掉（表格上同源的疑点），把判据收紧为
   `closest(...) && document.activeElement?.closest(...)`——只放行「容器自身是活动元素」的按键；
   该收紧对表格同样适用，并按既有场景回归。
7. **底板背景**：横滚到右侧时行盒之外没有底色（`.cm-lp-codeblock-line` 的背景只覆盖行盒宽度，
   `src/preview/theme.ts:59`），故容器本身 SHALL 提供 `--bg-2` 底板，保证「滚到右端不露白底」。
   实现期用视觉断言钉住（见 §4-3）。

### 2.4 文件级「不折行」的实现

- `wrapExtensions` 在 `line_wrap = false` 时**不装** `EditorView.lineWrapping`：`.cm-content` 落回 CM
  基础主题的 `white-space: pre`，超长行不折行、溢出内容列（md 的中列是 `minmax(0, var(--measure))`，
  `src/editor.ts:1132-1133`，列宽不因长行变宽），由 CM 基础主题给 `.cm-scroller` 的 `overflow-x: auto`
  提供横向滚动。语义与 Emacs 的 truncate 一致——官方手册明说「Horizontal scrolling automatically
  causes line truncation」（[Line Truncation](https://www.gnu.org/software/emacs/manual/html_node/emacs/Line-Truncation.html)）。
- 只读 code 模式的折行由同一开关控制（折行是视图属性，与 `editable(false)` 的只读保证无关）。
- 已知的几何面：整窗横滚的滚动条落在 `.cm-scroller` 上，masthead 与文件树在编辑器之外不受影响；
  滚动条出现时是否引起行内水平位移，实现期用视觉断言钉住（候选手段是表格同款的 `scrollbar-gutter: stable`）。

### 2.5 优先级与作用面边界

- **一元素一条规则**：代码块行（`.cm-line.cm-lp-codeblock-line`）由 `editor.code_block_wrap` 裁决，
  与 `editor.line_wrap` 无关；其余所有行由 `editor.line_wrap` 裁决。`line_wrap = false` 且
  `code_block_wrap = true` 时，代码块折行而普通行截断——组合合法且定义明确。
- 既有例外原样保留：表格 cell 有自己的 `white-space: pre-wrap`（`src/style.css:325-326`），不受两个开关
  影响；块级公式与 mermaid 走自身 widget 渲染路径，同样不受影响（`code_block_wrap` 只管围栏代码块）。
- **模式边界**：`editor.code_block_wrap` 的作用面只有 md 模式（围栏代码块只在 live preview 里渲染）。
  非 md 文件以只读 code 模式打开、没有围栏渲染，该开关对它们无可观测效果——这不是缺口，是作用面
  如此，写进 spec 避免被读成漏实现。

### 2.6 命令面与键位层

- 命令 id：`view.toggle-line-wrap`、`view.toggle-code-block-wrap`，进 `NON_TAB_GLOBAL_COMMAND_IDS`
  （`src/keys.ts:160-172`）。作用域由 `applyKeyOverrides` 机械派生（`:451`）：非 `EDITOR_COMMAND_IDS`
  → `global`。
  - id 前缀取 `view.` 而不是 `editor.`：本仓的既有约定是 `editor.` 前缀 = 编辑器作用域命令
    （`EDITOR_COMMAND_IDS` 的 33 条，`src/keys.ts:89-136`）。这两条命令作用于「当前标签页」这一窗口级
    对象（与 `tab.close` / `toc.toggle` 同族），作用域取 `global`，`editor.` 前缀会与作用域互相打脸。
  - 作用域取 `global` 的理由：用户点了文件树、焦点不在编辑器内容区时，仍应能切换当前标签页的显示；
    这与 `tab.*` 和 `toc.toggle` 的理由同族。若 Alex 更希望「只有焦点在编辑器里才生效」，改动是把 id
    改回 `editor.` 前缀并放进 `EDITOR_COMMAND_IDS`，行为差别只是「哪些焦点下按键有效」（proposal D3）。
  - 边界如实记录：`global` 作用域意味着面板 / 大纲浮层 / 搜索框持有焦点时这两条命令同样命中。
    这不与「面板打开期间编辑键不穿透」的既有保证冲突——那条保证针对会改文档的 `editor` 命令，
    而这两条只改显示状态、MUST NOT 碰文档（spec 的「折行开关的瞬态口径」有对应 scenario）。
- 实现落在装配层 `src/main.ts` 的 `commands` 记录里（`src/main.ts:393-420`）；该记录类型是全量的
  `Record<CommandId, CommandRunner>`（`src/keys.ts:323`），所以「声明了命令 id 但没有实现」是 tsc 错误，
  编译期就挡住。
- **默认不绑键的显式化**：`src/keys.ts` 新增导出的 `KEYLESS_COMMAND_IDS`（默认不绑键清单），并修订
  「无孤儿命令」的判据为三项对账：
  1. `COMMAND_IDS` 里每条命令要么在 `KEY_BINDINGS` 里出现，要么在 `KEYLESS_COMMAND_IDS` 里；
  2. `KEYLESS_COMMAND_IDS` 的每一项 ∈ `COMMAND_IDS`（清单里不许有幻影 id）；
  3. 两者交集为空（登记为「默认不绑键」的命令 MUST NOT 又出现在绑定表里——否则该清单在说谎）。
  这样「默认不绑键」是显式决定、可被门禁核对，而不是静默遗漏；改动落到
  `tests/visual/scenes/m131-keymap-table.spec.ts:52-66` 的两处循环与 `tests/unit/keys.test.ts` 的新断言。
- `[keys]` 绑定零改动即可用：未知命令拒绝（`src/keys.ts:447`）不会命中它们（id 在 `COMMAND_IDS` 里），
  为一个未绑定的 token 新增绑定是既有能力（`:456`）。`Keymap.attach` 只查「绑定 → 有实现」
  （`:494-503`），因此绑定后立即生效。
- 面板：两条命令会落进既有「全局」组（`src/bindings-panel.ts:42` 用 `NON_TAB_GLOBAL_COMMAND_IDS`），
  **不新增分组**——分组标题是 `文案-Copy.md` D63–D67 的条目，不新增分组就不动文案。面板会把它们渲染成
  「未绑定」行（既有能力），行数与未绑定行数的断言要跟着改（`m133` 的 `:69` `:70`）。
- 面板未绑定行的**说明串要跟着扩**：现状是面板自带的通用串
  「当前没有键位指向它（配置解绑或尚未绑定）」（`src/bindings-panel.ts:101`，文案条目 D66），
  它把「尚未绑定」写成了一种过渡态，读不出「默认就该不占键位」这个**有意**的成因。本 change 把 D66
  的串扩为覆盖两种成因并指出下一步（默认不占键位 / 已被配置解绑，可用 `[keys]` 绑定），编号沿用、
  附修订记录（既有先例：D86 于 M160 扩写后编号不变）。

### 2.7 加载时点与生命周期

- 启动：`configGet()`（`src/main.ts:805`）→ 在 `editor.setMode(...)`（`:806`）之后加一次折行配置应用，
  它做两件事——写 `defaultWrap`（新标签页的起点）、把两个值应用到当前前台会话。启动早期（配置到达前）
  的会话按 TS 侧出厂默认跑，与 Rust 默认值相同。
- **两处默认值的处置**：TS 侧出厂默认（`DEFAULT_LINE_WRAP = true` / `DEFAULT_CODE_BLOCK_WRAP = false`）
  与 Rust 的 `Default` 是同一语义的两份写值。既有先例就是 `initialMode = "md"`
  （`src/editor.ts:978`）对 `EditorConfig::default` 的 `mode: Md`（`config.rs:80`），本 change 沿用该先例，
  并按 REVIEW.md 第 8 条的口径加两道防线：两侧各有测试钉住各自的默认值（Rust 单测 + 前端单测），
  两侧常量处各写一行指针注释指向对方。
- 运行期：toggle 只改当前会话的折行值并重配 Compartment，**不写 `config.json`**（本 change 不新增任何
  配置写入路径），因此重启后回到配置值；`config.json` 的 mtime 与内容在翻转前后逐字节不变——这是可断言的。
- 配置 warning 沿用既有出口：console + `logEvent("config_warning")`（`src/main.ts:811-814`），本版不加
  新 UI 面（配置 warning 无 UI 出口是既有已知项，`docs/backlog.md:105`）。
- **观测缺口（自觉取舍，proposal D5）**：无 mode line、无 toast，故「当前折行口径」在界面上不可读；
  文档里没有超长行 / 没有代码块时，翻转连可见变化都没有。真机验收与 agent 侧的判据因此只能靠 DOM
  断言（`getComputedStyle` 的 `white-space`、容器的存在与 scrollWidth > clientWidth），不能靠截图
  判断状态；若 dogfood 后确认需要常驻指示，另提 change（候选落点：masthead 指示段）。

## 3. 被否决的方案与理由

| 方案 | 否决理由 |
|---|---|
| 内核一个全局布尔代替会话级状态 | 切标签页后错位，正是 `src/editor.ts:836-841` 记下的陷阱；而把值放进 state（Compartment）后逐标签页天然正确 |
| 在 `livePreview()` 内部读折行状态 | 创建期闭包读可变变量 = 同一个陷阱；且折行扩展会因此有两处装配入口，违反 M131 的「单一分发路径」精神 |
| 代码块只做行级 `white-space: pre`，不做块级容器 | 溢出的长行会把 `.cm-scroller`（CM 基础主题的 `overflow-x: auto`）拉出整窗横滚，连标题一起横移；与表格 / 公式 / mermaid 的「局部容器」口径不符 |
| 把代码块源码换成 `<pre>` 只读副本 | 破坏「围栏源码保持可选可编辑」（`openspec/specs/editor-live-preview/spec.md:156`）与 md 模式可编辑性 |
| 用 `overflow: hidden` 代替 `auto` | 截断掉的内容不可达——「看不到的内容」是不可接受的失败形态，Emacs 的 truncate 也配横向滚动 |
| 代码块容器直接复用 `cm-lp-table-scroll` 这个 class 名 | 名字说谎（代码块不是表格），且该 class 的语义会被两处解释；改法是在 keys.ts 引入泛化的「块级横滚容器」class，表格保留原 class 兼顾既有断言（§2.3-6） |
| 代码块容器不做键盘可达（不聚焦、不接入 widget 滚动键） | 与表格容器「同形而不同能力」：同一种块级横滚容器，一个能用键盘、一个不能。代价是 MODIFY 一条既有 requirement，已在 proposal D4 交出切出选项 |
| 为两个新配置项发明「逐字段类型容忍」 | 那是解析模型的变更（会与 `editor.mode` 形成同类不同治），不应附带在新增字段里；改为如实记录边界 + 单测钉住（§2.1） |
| 顺手给翻转加 toast 播报 / masthead 常驻指示 | 新增可见面 → 新增文案条目、视觉覆盖与「何时不播报」的判定，超出本 change 的边界；先按最小心智模型做，dogfood 后再按证据立项（proposal D5 / Non-goals） |
| 只加配置项、不加命令 | 失去「运行期改主意」的能力；Emacs 侧的对应物 `C-x x t` 就是一个 buffer 局部的瞬态开关 |
| 删掉 m131 的无孤儿断言 | 断言失去区分度（REVIEW.md 第 1 条）；改为显式清单 + 三项对账，判据更严不更松 |
| 顺手做菜单入口（View 菜单项） | 可见面从「配置 + 命令」扩成「配置 + 命令 + 原生菜单」，并背上菜单结构假设校验那一套；见 proposal 的 Non-goals 与 D2 |
| 顺手做 M-x / 命令面板 | 通用能力（现有 51 条命令里被解绑的同样受益），远超本 change 的边界，且需要新增 dispatch-by-id 入口 |

## 4. 实现期必须验证 / 未决的点

0. **CM 侧两条契约（本 worktree 无 `node_modules`，未本地复核）**：① 折行的 `white-space` 声明落在
   `.cm-content.cm-lineWrapping` 上、`.cm-line` 自身没有（§1.3）；② `EditorView.blockWrappers` 可以
   并存多个 facet 值（表格那套 + 代码块那套，§1.4/§2.3-2）。两条都用本地 dist 或一次最小实测复核；
   ②不成立时的退路已写明（并入同一个 wrapper 函数）。
1. **嵌套语境**（引用块、列表项内的围栏代码块）下 block wrapper 的范围与滚动是否正确。机制是通用的，
   但表格当前只在顶层用。实测后如实记录：能承载局部容器的写进 requirement 的 scenario；某形态确实
   承载不了的，写进 spec 的已知边界——**不许静默退化成「折行」或「整窗横滚」**。
2. **容器判据的语义**（§2.3-6）：光标落在代码块文本里（未经 `Tab` 聚焦容器）时方向键的归属。
   期望是 caret 路径不受影响；不成立则按 §2.3-6 的收紧方案改判据，并把表格的既有场景一并回归。
3. **横滚容器的几何面**：滚动条出现时的水平位移、「翻转前后除折行本身外行盒不变」的断言取法、
   以及「滚到右端不露白底」的底板（§2.3-7）。
4. **类型不符配置**（`{"editor": {"line_wrap": "yes"}}`）的现行为实测确认（预期走整文件回落），
   留单测钉住（§2.1）。
5. **现有基线暴露不了本次默认变更**（代码块 fixture 最长行 45 字符）：视觉验收必须自带超长代码行
   fixture，并逐张核对出现过代码块的整页基线（REVIEW.md 第 3 条）。
6. **`[keys]` 绑定后真的能触发**：需要一条视觉或真机断言（不是只看面板显示改对了）；键位注入类断言
   按 acceptance README 的口径走「回读 + 只在字节未变时重试」。
7. 启动早期（配置到达前）与配置到达后的折行状态是否出现可见跳变——文件级折行只在有超长行时可见，
   若实测有跳变，考虑把配置应用提前到首次渲染前（不改设计，只调时序）。
8. **面板未绑定行的说明串**（§2.6）与 `文案-Copy.md` D66 的修订要在同一批里落地，并按 m133 加断言——
   文案改了而断言仍只看「未绑定」两个字，等于没验。

## 5. 与 REVIEW.md 的对表（本 change 的实现面）

| REVIEW.md 条目 | 本 change 的落点 |
|---|---|
| 1 断言等价于子串 / 无区分度 | 视觉断言必须用**含超长行**的 fixture；负向断言（「开关翻转后除折行外无变化」）先造能 FAIL 的输入再提交 |
| 3 容差吞掉真实变化 | 默认值变更在现有基线上不可见（代码块 fixture 最长 45 字符）→ 新 fixture 是硬要求；逐张核对出现过代码块的整页基线，并做元素级基线补偿 |
| 6 覆盖声明超出真实验证 | tasks 逐条要求可 `ls` 的证据指针；跑不动的写「未验」 |
| 8 同一语义两处真源 | 折行优先级规则只有一条；块级横滚容器的 class 只在 keys.ts 定义一次；TS/Rust 两处默认值按 §2.7 的处置（两侧测试 + 指针注释） |
| 9 声明即被消费 | 两个配置项都有消费者（启动应用 + toggle）；`KEYLESS_COMMAND_IDS` 有消费者（单测 + m131 对账 + 面板行），不留假开关 |
| 8/9 的既有教训 | `editor.measure` 那种「能配但不生效」的假开关不得重现：凡声明必给断言 |
| 11 真机键盘注入丢键 | toggle 的真机断言走回读判据，不用重试次数当判据 |
| 14 前台盲等 | 本 mission 纯文档；实现期的后台命令按 spawn 指令走 WaitFor |
