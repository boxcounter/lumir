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
| **无热重载**：`configGet` 全仓只有 import（`src/main.ts:7`）、调用（`:805`）与定义（`src/ipc.ts:38`）三处；无 watcher、无重载 command | 全仓 grep `configGet` 只有上述三处 |
| 运行期对配置的写入只碰 `last_vault` 一个**字段**，写入点有两处（同一纪律：读整个 JSON 为 `Value`、只改该字段、tmp+rename；其余字段都是应用只读的输入面） | ① `src-tauri/src/commands.rs:394-428` 的 `write_last_vault_to`（保未知字段 `:395-402`；原子替换 `:411-427`；纯函数部分 `merge_last_vault` `:433-439`）；② `src-tauri/src/workspaces.rs:263-287` 的 `vault_remap`（M163 的 vault 重映射：`:267` 取配置路径、同样只改 `last_vault`、`:279-285` tmp+rename） |

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
| 会话级状态先例与其陷阱：`mode` 存在会话对象上（逐会话真源），因为 `changeFilter` 的闭包在 state 创建时绑好、只能读实例变量，故内核另存一份「投影」`currentMode`，唯一写入点是 `syncMode()`，由激活 / 装载 / `setMode` 三处调用。**M180 的折行状态不走这条**：D1 取应用级，真源在 `createEditor` 闭包里的一个值上，全部会话同步重配（§2.2） | `src/editor.ts:825-858`（`mode` `:836-841` 的注释就是这条陷阱原文）、`:980-986`、`syncMode()` `:1354-1357`、`activate` 里 `:1385` |

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

- **真源是应用运行期的一个值**（D1 裁决原文「应用级。」）：`createEditor` 闭包内一份
  `let wrap = { lineWrap, codeBlockWrap }`，初值取 TS 侧出厂默认常量；配置到达时由装配层写一次
  （`setWrap`）。**MUST NOT 存在第二份真源**：会话对象上不存折行值（那是初稿的标签页级口径），
  配置项也不是运行期真源（它只在启动时喂一次初值）。
- **新增一个 `wrapCompartment = new Compartment()`**，与 `modeCompartment`（`src/editor.ts:979`）
  并列。折行相关扩展只有一处装配：`wrapExtensions(mode, wrap)`（新增），由它承载。
  **MUST NOT 在 `livePreview()` 内部旁路读折行状态**：那是创建期闭包读可变变量，正是
  `:836-841` 记下的 `currentMode` 陷阱形态。
- **每次翻转是一次全量重配**：`setWrap(next)` 更新闭包里的值，再遍历 `sessions` 把每个会话的
  `state` 用 `wrapCompartment.reconfigure(wrapExtensions(...))` 派生成新 state——前台会话经
  `view.dispatch` 生效，后台会话只换 `session.state`（与 `reloadSession` 的既有分岔同形）。
  「全部会话同步」是应用级口径的定义，不是可选优化：漏掉后台会话会让切回去的标签页显示旧口径。
- **`setMode` 也走同一个重配入口**：`wrapExtensions` 的两项里有一项（代码块内容级 class）只在
  md 模式有意义，模式热切换时若不一起重配，code → md 切回来会丢掉那一层。`setMode` 与 `setWrap`
  共用同一个 `reconfigureWrap()`，`wrapExtensions` 只有一处装配。
- `sessionState(doc, path, mode, wrap)`（`src/editor.ts:1178-1233`）增加折行参数，与 `mode` 同形
  ——**这是「新会话从哪起步」的落点**：新建 / 装载会话时读的是当时的应用态，因此新标签页取
  **当前应用态**而不是配置默认（这正是 D1 与初稿的关键差异）。
- **不需要 `currentMode` 那套投影**：折行值不参与任何创建期闭包（`changeFilter` 之类只看 `mode`），
  它随 state 走；应用级口径下所有会话的取值本就一致，切标签页（`activate` `:1377-1397`）不涉及
  折行同步动作。
- 与 `mode` 的一处不对称要如实记录：`mode` 是**逐会话**的（装载时按路径裁决，`modeForPath`），
  折行是**应用级**的——折行因此不参与 `modeForPath` 那条裁决链，装载新文件只受应用态影响
  （会话 state 里的 Compartment 值由全量重配维持，`loadedState` 不必再动它）。

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
    （`EDITOR_COMMAND_IDS` 的 33 条，`src/keys.ts:89-136`）。这两条命令作用于**应用运行期的显示
    口径**（窗口级对象，与 `tab.*` / `toc.toggle` 同族），作用域取 `global`，`editor.` 前缀会与
    作用域互相打脸。
  - 作用域取 `global` 的理由：用户点了文件树、焦点不在编辑器内容区时，仍应能切换当前显示口径；
    这与 `tab.*` 和 `toc.toggle` 的理由同族。若 Alex 更希望「只有焦点在编辑器里才生效」，改动是把 id
    改回 `editor.` 前缀并放进 `EDITOR_COMMAND_IDS`，行为差别只是「哪些焦点下按键有效」（D3 已裁决
    取 `global`，见 proposal 的裁决记录）。
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
- 面板：两条命令会落进既有「全局」组（`src/bindings-panel.ts:44` 用 `NON_TAB_GLOBAL_COMMAND_IDS`），
  **不新增分组**——分组标题是 `文案-Copy.md` D63–D67 的条目，不新增分组就不动文案。面板会把它们渲染成
  「未绑定」行（既有能力），行数与未绑定行数的断言要跟着改（`m133` 的 `:69` `:70`）。
- 面板未绑定行的**说明串要跟着扩**：现状是面板自带的通用串
  「当前没有键位指向它（配置解绑或尚未绑定）」（`src/bindings-panel.ts:101`，文案条目 D66），
  它把「尚未绑定」写成了一种过渡态，读不出「默认就该不占键位」这个**有意**的成因。本 change 把 D66
  的串扩为覆盖两种成因并指出下一步（默认不占键位 / 已被配置解绑，可用 `[keys]` 绑定），编号沿用、
  附修订记录（既有先例：D86 于 M160 扩写后编号不变）。

### 2.7 加载时点与生命周期

- 启动：`configGet()`（`src/main.ts:805`）→ 在 `editor.setMode(...)`（`:806`）之后加一次折行配置应用，
  它做一件事——用配置的两个值初始化**应用运行期**的折行状态（`setWrap`）。新建 / 装载会话都从这份
  应用态取初值，因此不存在单独的「新标签页起点」变量（D1 之后 `defaultWrap` 这个方案被删掉）。
  启动早期（配置到达前）的会话按 TS 侧出厂默认跑，与 Rust 默认值相同。
- **两处默认值的处置**：TS 侧出厂默认（`DEFAULT_LINE_WRAP = true` / `DEFAULT_CODE_BLOCK_WRAP = false`）
  与 Rust 的 `Default` 是同一语义的两份写值。既有先例就是 `initialMode = "md"`
  （`src/editor.ts:978`）对 `EditorConfig::default` 的 `mode: Md`（`config.rs:80`），本 change 沿用该先例，
  并按 REVIEW.md 第 8 条的口径加两道防线：两侧各有测试钉住各自的默认值（Rust 单测 + 前端单测），
  两侧常量处各写一行指针注释指向对方。
- 运行期：toggle 改的是**应用运行期的折行状态**并重配**全部会话**的 Compartment（前台经 dispatch、
  后台只换 state），**不写 `config.json`**（本 change 不新增任何配置写入路径），因此重启后回到配置值；
  `config.json` 的 mtime 与内容在翻转前后逐字节不变——这是可断言的。
- 配置 warning 沿用既有出口：console + `logEvent("config_warning")`（`src/main.ts:811-814`），本版不加
  新 UI 面（配置 warning 无 UI 出口是既有已知项，`docs/backlog.md:105`）。
- **观测缺口（自觉取舍，proposal D5）**：无 mode line、无 toast，故「当前折行口径」在界面上不可读；
  文档里没有超长行 / 没有代码块时，翻转连可见变化都没有。真机验收与 agent 侧的判据因此只能靠 DOM
  断言（`getComputedStyle` 的 `white-space`、容器的存在与 scrollWidth > clientWidth），不能靠截图
  判断状态；若 dogfood 后确认需要常驻指示，另提 change（候选落点：masthead 指示段）。

## 3. 被否决的方案与理由

| 方案 | 否决理由 |
|---|---|
| 标签页级翻转（= Emacs buffer-local，本提案初稿的方案） | D1 裁决取**应用级**（原话「应用级。」）：折行是应用运行期的显示口径，切标签页时两种口径并存会让人以为开关坏了。代价如实记录：翻转要遍历全部会话 reconfigure；新标签页取当前应用态而不是配置默认——初稿的 `defaultWrap`（新标签页起点）方案因此被删掉（§2.2） |
| 内核一个全局单值但只应用到前台会话 | 后台会话停在旧口径，切回去看到的还是翻转前的呈现——「应用级」的定义就是全部会话同步，只改前台等于半个开关（§2.2） |
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

## 4. 实现期必须验证 / 未决的点（逐条写实测结论，2026-09-18）

0. **CM 侧两条契约**（本 worktree 开工时无 `node_modules`，故列为首验项）：**两条都成立，退路未使用**。
   - ① 折行的 `white-space` 落在 `.cm-content.cm-lineWrapping` 上、`.cm-line` 自身没有：本地
     `node_modules/@codemirror/view/dist/index.js` 的 baseTheme（`.cm-content { whiteSpace: "pre" }`、
     `.cm-lineWrapping { whiteSpace: "break-spaces"; wordBreak: "break-word"; overflowWrap: "anywhere" }`）
     与文件末尾的 `EditorView.lineWrapping = contentAttributes.of({ "class": "cm-lineWrapping" })`；
     版本 `@codemirror/view@6.43.11`（`node_modules/@codemirror/view/package.json`）。→ 内容级 class
     覆盖可行（选择器带 `.cm-content` 前缀压过 0,2,0 的 `.cm-lineWrapping`）。
   - ② `blockWrappers` 可并存多个 facet 值：facet 的值类型是
     `readonly (RangeSet<BlockWrapper> | ((view: EditorView) => RangeSet<BlockWrapper>))[]`
     （`index.d.ts:1330`），运行时取**全部**值（`index.js:3427` 的 `state.facet(blockWrappers).map(...)`），
     合并走 `RangeSet.iter(sets: readonly RangeSet<T>[])`（`@codemirror/state` `index.d.ts:1600`，按 rank 排）。
     → 表格一套 + 代码块一套可以并存，**不需要**并入同一个 `blockWrappersFor(view)`。
     成品形态补充：代码块那套装在 `wrapCompartment` 里（代码块折行时**不装**），所以「并存」只在默认
     口径下出现——这是刻意的，见 §2.3 与 spec 的「代码块折行可显式打开（MUST NOT 出现块内横向滚动容器）」。
1. **嵌套语境**（引用块内的围栏代码块）：**能承载局部容器**，已写进场景而不是「已知边界」。
   `tests/visual/fixtures/render-codeblock/wrap.md` 含一处引用块内的围栏代码块，
   `render-codeblock.spec.ts` 的「嵌套语境」场景断言：它有自己的容器、容器里是引用块那几行
   （`cm-lp-quote-line`）、`scrollWidth > clientWidth`、滚到右端后行尾进可视区，且编辑区
   `scrollWidth === clientWidth`——溢出没有退化成 §3 明确否决的整窗横滚。
2. **容器判据的语义**：已按预期**收紧**为「容器自身持有这次按键的焦点」（`src/keys.ts` 的
   `isWidgetKeyTarget`：`closest(BLOCK_SCROLL_CLASS) && ownerDocument.activeElement === 容器`）。
   现场理由写在实现处：光标落在块内文本时事件目标在容器内、但活动元素是编辑器内容区，只按
   `closest` 会把 caret 的方向键吞掉。两条断言钉住它：视觉层「光标落在代码块文本里时方向键仍归
   caret」（含 `activeElement` 是 `cm-content` 的前置断言，避免在错误状态上空转）与单测
   `keys.test.ts` 的 `FakeElement(true, false)` 一格（`closest` 命中但未持有焦点 → 不消费）。表格的
   既有场景（`m131-keymap-behavior` 用 `focus()` 显式制造容器焦点）在同一批里回归通过。
3. **横滚容器的几何面**：三条都用断言钉住，没有留观察项。
   - 「文字可达」：`overflow-x: auto` + `scrollWidth > clientWidth` + 滚到最右后**行尾文本右端距
     容器右缘 ≤ 1px**（用 `Range.selectNodeContents` 取文本右端，不是行盒右缘——行盒宽度不随
     溢出文本变宽，拿它断言等于没断言）。
   - 「不露白底」：底板取 `--bg-2`；滚到最右后容器右缘那一列的 `elementFromPoint` 底色与代码行
     同色（滚出去的行盒不再覆盖那里，露出的必须是容器底板）。
   - 「不改纵向节奏」：同一文档里容器装卸（`code_block_wrap` 翻转）前后，代码块**下方**那一行的
     `getBoundingClientRect().top` 变化 ≤ 0.5px。
4. **类型不符配置**：**确认走整文件回落**（预期成立）。Rust 单测
   `wrong_type_line_wrap_falls_back_entire_file` 断言 `{"last_vault":"/tmp/vault","editor":{"line_wrap":"yes","code_block_wrap":true}}`
   下 `line_wrap`、`code_block_wrap`、`mode` 与同文件里的合法字段**一起**回到默认、warning 恰一条
   ——不存在「部分按配置、部分按默认」的混合态。
5. **既有基线零变更**（实测，与 proposal 的预估一致）：定向跑 `render-codeblock.spec.ts`、
   `m133-describe-bindings.spec.ts`、`m131-keymap-table.spec.ts`，既有像素基线（含 m133 的面板元素
   基线与 render-codeblock 的 5 张）逐张零差异——代码块新增的横滚容器没有改动任何既有基线
   （默认口径下容器的底盒与代码行盒逐像素重合：无 padding、无 margin、无圆角、无 scrollbar-gutter）。
   新增基线只有 5 张，全部来自本 change 的新场景：4 张四组合整页 + 1 张「滚到最右」元素级
   （`wrap-combo-{1..4}-*`、`wrap-codeblock-scrolled-to-end`）。按 AGENTS.md 的基线纪律，这批新图
   **待 Alex 过目**后才算生效。
6. **`[keys]` 绑定后真的能触发**：已验，两层。
   - 视觉层：用 `Ctrl-j` / `Ctrl-k` 绑定后逐次按键，断言两轴按格翻转（`white-space` 与容器个数），
     四种组合各一张整页基线；另有一景断言「配置绑定后」启动的口径也生效（`config_get` 应答里补上
     `editor.line_wrap` / `editor.code_block_wrap`，即 main.ts 那条 `setWrap` 接线的端到端证据）。
   - 真机层：`scripts/acceptance/scenarios/22-wrap-toggle.md` 用 `Cmd-Shift-J` / `Cmd-Shift-K`
     （默认表空位，且不在原生菜单 accelerator 集合里）按键，断言容器在 AX 树里消失/回来、
     `Escape` 后焦点回 `AXTextArea`、`config.json` 逐字节与 mtime 不变。
7. **启动早期的可见跳变**：**未观察到跳变，故不改时序**。「配置缺省」与「启动口径来自配置」两条
   场景里，首帧呈现即为终态（`config_get` 与首帧同批到达）。
8. **面板未绑定行的说明串**与 `文案-Copy.md` D66 **同批落地**并有断言：`m133` 的新场景分别读
   「默认不占键位」与「已被配置解绑」两条行说明（两种成因读起来不一样），并断言分组标题数组不变
   （MUST NOT 新增分组）。

### 真机侧的覆盖边界（如实记录，别当 bug 追）

- 真机能给的**机器**判据只有三条：① 代码块横滚容器在不在 AX 树里（`role=region` + 读屏名）；
  ② 焦点归属（`Escape` 后 `AXTextArea`）；③ `config.json` 的 sha256 / mtime 不变。真机套件没有
  计算属性通道，「正文行折 / 不折」与「代码块行折 / 不折」的**视觉**口径只能看 `shots/`——
  该轴的计算属性断言在视觉层（`render-codeblock.spec.ts`）。
- 「启动口径来自 `config.json`」这条接线在**视觉层**验（同一份前端代码、只差引擎），真机套件当前
  的 `config` 通道只透传 `keys`（`scripts/acceptance/lib/execute.mjs` 的 `writeConfig({ mode, keys })`），
  要真机也验需扩那个调用——已按协议记成 finding，不在本 change 的 scope 内。

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
