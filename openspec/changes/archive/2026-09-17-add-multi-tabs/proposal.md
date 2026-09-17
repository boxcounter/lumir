# Proposal: 多标签页（MultiTabs）

- Change ID: add-multi-tabs
- 日期: 2026-09-17
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Lumir 现在一次只能开一份文档：点文件树里的另一个文件就把当前文档换掉。做 PKM 时的高频动作是
「几篇笔记来回对照」——查一条 wikilink 指向的目标、翻一份参考资料、在索引页与正文之间跳——每
一次都得重新打开、重新滚动到刚才的位置，而且**会丢掉上一篇的撤销历史**。这是当前形态最硬的
一个瓶颈。

Alex 的需求原话（2026-09-17，M149 需求）：**「再增加几个需求：1. 支持多 TAB」**；并对「怎么在
新 TAB 里打开文件」给了明确要求：**「我希望坐上 ⌘1–9 直达」**。

现状锚点：全应用只有**一个** `EditorView` 与一份 `EditorState`（`src/editor.ts` 的
`createEditor`），「当前文档」是散布在四个模块里的单值——`src/editor.ts` 的 `currentPath` /
`cleanDoc` / `dirty`、`src/main.ts` 的 `currentPath`、`src/save-controller.ts` 的
`displayedPath` / `displayedRevision` / 单个 `reconcileTimer`、`src/tree.ts` 的 `currentPath`。
打开文件是「整篇替换当前 state 的内容」（`dispatchTrusted`），所以撤销史必然清空。

## What Changes

1. **架构：单 EditorView + 每标签留存 EditorState。** 切标签走 `view.setState(会话的 state)`——
   撤销史（CM `history()` 是 StateField）、语法树、选区、搜索查询、模式配置都随 state 走，切回来
   **不重新解析、不丢撤销栈**。标签顺序 = 打开顺序。
2. **标签栏**：≥1 个文件打开时常驻显示（单标签也显示——它承载 dirty 点与位置上下文），空态隐藏
   （不占行高，空态布局与改动前逐像素一致）。激活态高亮、dirty 点、预览标签斜体标题、点击切换、
   逐标签关闭钮。溢出用横向滚动（不做拖拽排序、不做 split view）。
3. **打开 / 固定语义**：单击文件树复用「预览标签」（下一次单击就地替换它，不新开）；双击或**首次
   输入**即固定；⌘-点击文件树文件 = 新建固定标签。同一个文件已经打开时切到既有标签，不重复开。
   文档内链接的 ⌘-点击维持 M144/M145 既有语义（**当前标签跟随跳转**），新的 ⌘-点击手势只加在
   文件树上。
4. **键位全进统一命令层**（`src/keys.ts` 的 `KEY_BINDINGS`，随 `COMMAND_IDS` 自动进
   `app.describe-bindings` 面板与 `[keys]` 配置覆盖）：`⌘W` 关当前标签、`⌘1–9` 直达第 1–9 个标签、
   `⌃⇥` / `⌃⇧⇥` 循环切换。四类键的冲突核实见下「键位冲突核实」。
5. **粒度升级：dirty / 外部变更 / revision / 保存全部按标签隔离。** 自动保存的 debounce 从
   「一个定时器」升级为「每路径一个」——旧实现切标签会把待写的定时器带到新文档上（把 A 的内容
   写进 B 的路径，静默数据损坏）。外部变更浮条点名文档，后台标签命中外部修改同样处置（旧实现只
   查前台路径，多标签下会漏报）。`⌘S` 只存当前标签。关闭有未保存修改的标签先给确认。
6. **文件树联动**：树高亮跟随当前标签的文件；关掉最后一个标签回到空态（无当前文件、树无高亮）。
7. **关闭菜单项让出 ⌘W**（`src-tauri/src/lib.rs`，按 M131 让出 ⌘Z / ⇧⌘Z 的同一先例）：原生
   `Menu::default()` 的 File / Window 两个子菜单里的**预置** Close 项自带 ⌘W 加速键，菜单键等价在
   NSApplication 分发阶段就被截获，webview 的 keydown 收不到该键。把它们换成不带加速键的自定义项，
   点击经 `app:menu_command` 交回前端同一条命令。详见「键位冲突核实」与「语义变化」。

## Alex 已裁决 / 已对齐的口径（直接执行，不再回到评审）

- **预览标签语义**：单击文件树 = 复用预览标签（标题斜体表临时），双击或开始编辑 = 固定。
- **⌘-点击文件树文件 = 在新固定标签打开**——这是对「需要新 TAB 时怎么做」的回答。
- **⌘1–9 直达第 1–9 个标签**（明确要求）；`⌘W` 关当前标签、标签循环切换键一并进首批。
- **文档内链接的 ⌘-点击维持既有语义**（当前标签跟随跳转），新的 ⌘-点击手势只加在文件树上。
- **会话恢复（重启后重开标签）不做**，留 backlog。
- **标签栏显示口径**（tower 补充裁决，轻量可逆）：≥1 个文件打开时常驻显示，空态隐藏。
- **溢出 v1 横向滚动**，不做拖拽排序、不做 split view。

## 键位冲突核实（注册前实测，三条独立来源）

| 键 | 表内既有 | 原生菜单 accelerator | 系统级 | 结论 |
|---|---|---|---|---|
| `⌘W` | 无 | **有（CloseWindow）** | 无 | 冲突 → 见「关闭菜单项让出 ⌘W」 |
| `⌘1`–`⌘9` | 无 | 无 | 无 | 零冲突 |
| `⌃⇥` / `⌃⇧⇥` | 无 | 无 | 无（macOS 窗口循环是 ⌘`） | 零冲突 |

原生菜单的 accelerator 集合来自库源码：tauri 2.11.5 的 `Menu::default()` 逐项构造 muda 0.19.3 的
预置项，其 `accelerator()`（`items/predefined.rs`）给出 Copy ⌘C / Cut ⌘X / Paste ⌘V / Undo ⌘Z /
Redo ⇧⌘Z / SelectAll ⌘A / Minimize ⌘M / Fullscreen ⌃⌘F / Hide ⌘H / HideOthers ⌥⌘H /
**CloseWindow ⌘W** / Quit ⌘Q。仓内旁证：`src-tauri/src/lib.rs` 的注释原本就写着「关窗（红灯按钮 /
**Cmd+W**）同理」，M131 的注释也记录了「`Menu::default()` 里的 Undo / Redo 确实占着 ⌘Z / ⇧⌘Z，
JS 收不到」这同一机制。

## 语义变化（需要 Alex 知悉）

1. **`⌘W` 从「关窗」变成「关当前标签」**。菜单里的关闭项保留，只是不再带加速键。单窗口应用里
   「关窗≈关应用」，而关标签是更高频动作（Obsidian / VS Code 同口径）；退出仍走 `⌘Q`（有 dirty
   守卫）与红灯按钮。零标签时 `⌘W` 无操作。
2. **有未保存修改时打开另一个文件不再被拦截**——它开成（或复用）标签，修改留在原标签上。唯一
   保留拦截的情形是**前台为未命名文档**（没有路径、草稿只活在内存里，被复用掉就等于丢弃）：沿用
   M130 的守卫与文案（「请按 Cmd+Z 撤销修改」）。
3. **切换 vault 的守卫升级为「任一标签有未保存修改即拦下」**——切 vault 会把全部标签一起作废。
4. **搜索面板的查询与开合状态逐标签**：它是 EditorState 的一部分，因此跟随标签。在同一标签内打开
   新文件时（预览标签复用、外部重载）状态**保留**（走事务派生而非新建 state），新建标签则从无查询
   开始——与 VS Code 的每编辑器查找状态同口径。

## 不做什么（非目标）

- **不做会话恢复**（重启后自动重开上次的标签）：留 `docs/backlog.md`。
- **不做拖拽排序 / 标签固定（pin）/ split view / 标签预览浮层**。
- **不改写源文件铁律**（ADR 0003）与性能合同（ADR 0002）——切标签不做文档解析。
- **不给标签加独立的「另存为 / 重命名」入口**。

## 影响面

- `src/editor.ts`：新增会话（`EditorSession`）与逐会话记账，`openDocument` 拆成
  `createSession` / `reloadSession` / `activateSession`；`appendConfig` 装的运行时扩展改为
  「新建会话时带上」（否则用 `appendConfig` 装的监听器会在新标签上静默失效）。
- `src/main.ts`：标签模型（顺序、预览标记）与标签栏渲染、打开意图分流（preview / pinned /
  current）、键位命令、`⌘W` 确认、外部变更按标签路由。
- `src/save-controller.ts`：状态从「当前展示文档」升级为**按路径键控**（revision / 在途标记 /
  暂停原因 / debounce 定时器）。
- `src/shell.ts` + `src/style.css`：标签栏容器与样式（只用 M55 既有 token）。
- `src/keys.ts`：`tab.close` / `tab.next` / `tab.prev` / `tab.goto-1`…`tab.goto-9`。
- `src-tauri/src/lib.rs`：关闭菜单项让出 ⌘W。
- 制品：`scripts/acceptance/scenarios/14-tabs.md` + fixtures、`tests/visual/scenes/m149-tabs.spec.ts`
  （元素级基线）、`文案-Copy.md` 新增 D 序列条目。
