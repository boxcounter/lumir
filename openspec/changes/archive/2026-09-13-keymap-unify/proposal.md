# Proposal: 键位统一层与撤销能力

- Change ID: keymap-unify
- 日期: 2026-09-13
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

键位此前散在五条互不知情的旁路里（M129 survey 轨道 A–F，行号基于 master 81a613a）：

1. **A `src/keys.ts` 的 window 级 trie**：只注册了 `Mod-Enter`，多段 chord 从未使用、零测试。
2. **B `src/editor.ts` 的 CM keymap**（`verticalMotionKeymap` / `horizontalMotionKeymap`）：⌃N/P/F/B/E 与 ArrowUp/Down，用 `{ mac: ... }` 做平台分支。
3. **C `src/editor.ts` 的 `domEventHandlers`**：⌘A 与 ⌃A 都当全选（`event.metaKey || event.ctrlKey`）。
4. **D `src/preview/livePreview.ts` 的 widget 焦点作用域**：表格滚动容器自己的 Escape / Home / End / 左右方向键。
5. **E `src/main.ts` 的裸 window 监听**：⌘S 与 ⌃S 都当保存。

合并 `e.metaKey || e.ctrlKey` 让 ⌘ 与 ⌃ 无法分离；同一物理组合在两处各写一份（⌘A/⌃A、⌘S/⌃S），改一处必漏另一处。**D1–D3 经 Alex 裁决采纳**（原话：「D1、D2、D3、D4 中你的建议都符合我的预期，都采纳。」）：

- **D1**：⌘/⌃ 拆开——⌘ 系全归 mac 惯例、⌃ 系全归 Emacs。
- **D2**：⌃A = 行首（Emacs `C-a`）；全选由 ⌘A 保留。
- **D3**：⌘S = 保存唯一键，⌃S 解绑预留 isearch。

**撤销能力**（2026-09-13 对话）：Emacs 规范的 ⌃/ 与别名 ⌃_ 从「后续」提进本次，redo 加 ⌃⌥_ 别名；已向 Alex 说明 **CM `history()` 是线性双栈而非 Emacs 链式 undo**，dogfood 阶段够用，他无异议。

**硬约束（M129 survey 实证）**：所有光标/编辑命令必须建在现有 widget 硬化原语上（assoc 可见侧 / scrollIntoView 传 SelectionRange / 退化测量 / 原子块钳制），不得换用 CM stock 命令，不得把键留给原生 contenteditable 路径（M103/M110/M111/M113/M118 缺陷族同根因）。

**菜单占用 ⌘Z 的证据**：`Menu::default()` 的 Edit 子菜单用预置 Undo/Redo 项，而 muda 在 macOS 上给预置项**自带 key equivalent**——`PredefinedMenuItemType::Undo => Accelerator::new(Some(CMD_OR_CTRL), Code::KeyZ)`、Redo 为 `CMD_OR_CTRL | Modifiers::SHIFT`（muda 0.19.3 `src/items/predefined.rs:298-311`），经 `platform_impl/macos/mod.rs:374` 的 `item_type.accelerator()` 落到 NSMenuItem。tauri 2.11.5 的 `Menu::default`（`src/menu/menu.rs:216-227`）逐项复用这些预置项。这正是 survey 轨道 F「⌘Z/⌘⇧Z/⌘X/⌘C/⌘V/⌘A 被 Edit 菜单占用、JS 收不到」的来源。

## What Changes

1. **唯一分发表 + 单一分发路径**：`src/keys.ts` 的 `KEY_BINDINGS` 成为唯一 key → command 表，每条绑定标注作用域（`global` = 任意焦点；`editor` = 事件目标落在编辑器内容区内，含其中 widget）与归属命令，并附一句来由（表即文档）。旁路 A/B/C/E 全部拆除迁入，只剩一个 window 级分发器。命令实现留在各自模块（`editor.*` 在 editor.ts，`document.save` / `wikilink.follow` 在装配层），经 `attach` 注入；`CommandId` 由运行期 `COMMAND_IDS` 清单派生，`Record<CommandId, CommandRunner>` 让「表里每条绑定都有归属命令」成为编译期合同，构造函数对重复绑定直接抛错（旧实现是后注册者静默覆盖），attach 对缺实现抛错。分布表条目、scope 口径与 token 口径由 `tests/visual/scenes/m131-keymap-table.spec.ts` 守住（无重复键、无孤儿命令、每条绑定可被真实事件命中）。
2. **⌘ / ⌃ 拆分**：token 逐修饰键记录（`Cmd` / `Ctrl` / `Alt` / `Shift`），`Mod` 合并口径移除；`⌘A` = 全选、`⌃A` = 行首、`⌘S` = 唯一保存键、`⌃S` 解绑（预留给 isearch，不新增功能）。⌃A 的命令与既有 ⌃E 对称：同用 `moveToLineBoundary` + 退化测量处理，落点不落在隐藏 replace 里——行首紧贴隐藏管道符时两侧测量都退化为全零 rect（实测：表格行 col0 两侧皆退化），若把 caret 停在那里，`scrollIntoView(nearest)` 会把整窗内容下挫（自证阶段实测 scrollTop 掉 62px），故像 ⌃E 回退到末 cell 尾部那样把落点前挪到行内第一个可测量位置（首 cell 起点）。
3. **既有 6 键（⌃N/P/F/B/E + ArrowUp/Down）迁移零行为变化**：只换键位来源，命令实现与硬化原语一字未动；既有视觉场景（含 `routeGridTable` / `clampAcrossBlockWidgets` / `mathSpanCrossed` 的断言）全绿且**零基线更新**作证。
4. **撤销能力**：新增依赖 `@codemirror/commands`（package.json + pnpm-lock.yaml），接入 `history()`；绑定 ⌘Z=undo、⌘⇧Z=redo、⌃/=undo、⌃_=undo、⌃⌥_=redo。**⌃⌥_ 这条别名的入表口径**：macOS 的 Alt 层会替换字符（⌥⇧- 给的是 em dash `—`，实测 Playwright 合成事件也证实 `Control+Alt+_` 的 Shift 不在场），`e.key` 判别不了用户按的键，故含 Alt 的组合一律按物理键（`KeyboardEvent.code`）判定——表里写 `Ctrl-Alt-Minus`。代价是 Shift 不参与该判定，即 ⌃⌥-（不带 Shift）也会触发重做，属该别名的超集，对本键位无冲突（表内无其它 ⌃⌥ 绑定）。两条相容口径（均经源码与实测确认，详见 Impact 的现状记录）：
   - **装载不进撤销史**：打开文件 / 外部重载 / vault 复位的事务带 `trustedLoad` + `Transaction.addToHistory.of(false)`，CM history 把整篇替换累积成 mapping 并逐个丢弃力竭的旧事件（实测装载后 `undoDepth` 归零、`undo` 返回 false），因此 ⌘Z MUST NOT 把上一个文件的内容搬进新文档。
   - **dirty 与撤销解耦**：dirty 仍以「文本 vs cleanDoc 基线」比较，撤销回到已保存内容即收窄为 false，不依赖撤销栈位置；撤销/重做产生的文档变化照常进自动保存 debounce 与守卫链路。
5. **原生菜单与命令层一致**：macOS Edit 子菜单的预置 Undo/Redo 换成自定义项——预置项是 `undo:` / `redo:` selector 直连原生 responder chain 的撤销栈，等于第二套撤销（文档状态的唯一持有者是 CM），换成自定义项后点击经 `app:menu_command` 事件交回前端统一命令层。自定义项**刻意不设 accelerator**：让 ⌘Z / ⌘⇧Z 留在 webview 的 keydown 路径上由统一键位层接管（菜单点击另有事件通道，两条路进同一命令实现）。改造与退出守卫合成一个菜单安装入口（两者都基于 `Menu::default()`，各自 set_menu 会互相覆盖）。
6. **回归场景**：新增 `m131-keymap-behavior.spec.ts`（行为级：⌃A 行首 / ⌘A 全选、widget 焦点下 ⌃A 仍走同一命令层、⌘Z 与 ⌃/ 撤销且 dirty 收回、⌘⇧Z 与 ⌃⌥_ 重做、⌘S 唯一保存且 ⌃S 不保存、作用域不越界、撤销不跨文档）与 `m131-keymap-table.spec.ts`（表与 token 口径的不变量）。
7. **平台口径（评审 r1 F1 如实记录）**：迁移后表内绑定一律**全平台无条件生效**，平台门消失，因此第 3 条的「零行为变化」严格说只在 macOS 成立。两处差异均只在非 mac 平台可观测：⌃N/P/F/B/E 迁移前是 CM keymap 的 `{ mac: "Ctrl-n" }`（只绑 mac），现在非 mac 也接管（⌃N 在部分桌面环境是系统级「新建」惯例）；轨道 A 的 `Mod-Enter` 迁为 `Cmd-Enter`，非 mac 的 Ctrl-Enter 变体不再存在。当前运行目标只有 macOS（Tauri 桌面；CI 的 rust/perf/visual 门禁均为 macos-*，原生菜单全部 `cfg(macos)`），无实害；将来跨平台需重新引入平台门（给 ⌃ 系绑定加平台维度，或把 ⌃N 一类让回系统惯例）。本次不做平台门（无跨平台目标，引入即无测试可覆盖的死分支）。

## Non-goals

- **不做 isearch**：⌃S 只是解绑，不接任何新功能（D3 的「预留」就是本 change 的全部动作）。
- **不做 Emacs 链式 undo / undo-tree**：CM `history()` 是线性双栈，已向 Alex 说明并在 dogfood 阶段接受；链式撤销留待后续按需评估。
- **不动轨道 D 的实现文件**：`src/preview/livePreview.ts` 不在本 mission scope，其 widget 焦点内的滚动键（Escape / Home / End / 左右方向键）仍由该文件自己的手柄处理；本 change 保证的是「焦点落在 widget 内时 editor 作用域命令同样委托到统一命令层」（分发器入口对 `defaultPrevented` 让路）。
- **不新增其它 Emacs 键**（⌃K/⌃Y/⌃D/⌃H 等）、不做键位可配置、不做多段 chord 的实际绑定（trie 机制按 ADR 0001 §4 保留）。
- **不改非 md 只读态与保存链路的既有保证**：撤销命令在 `readOnly` 状态下返回 false（与 M130 方向 A 一致），不因「撤销能改文档」而放宽只读模式。
- **不做菜单文案中文化**：Edit 子菜单沿用平台默认英文（与本 deck 不收编原生菜单文案的既有口径一致，deck 里也没有 Quit 项）。

## Impact

- 影响的 specs：新增 capability `keymap-commands`（ADDED：统一分发表、⌘/⌃ 分离、硬化底座、撤销与重做、菜单与命令层一致）。
- 影响的代码：`src/keys.ts`（表 + 分发器）、`src/editor.ts`（拆除 keymap 与 domEventHandlers、`history()`、⌃A 命令、`commands` 记录、trustedLoad 标注）、`src/main.ts`（拆除裸 window 监听、装配命令表、菜单命令事件）、`src-tauri/src/lib.rs`（菜单安装入口合并 + 撤销/重做项让位 + 事件回交）、`package.json` / `pnpm-lock.yaml`（`@codemirror/commands`）。
- 影响的测试：`tests/visual/scenes/m131-keymap-table.spec.ts`、`tests/visual/scenes/m131-keymap-behavior.spec.ts`（新增）；既有视觉场景全部保持不变（无基线更新）。
- **现状记录（不属本 change 的改动面）**：
  - `src/ipc.ts` 是 IPC 契约的前端一半（「所有 command 调用经此模块进出」），但不在本 mission scope；菜单命令事件在装配层直接 `listen`（无 invoke 语义），下次动 ipc.ts 时应并入其 `onXxx` 族。
  - `history()` 自带一个 `beforeinput` 手柄（`historyUndo` / `historyRedo` 输入类型改走 CM 撤销栈），因此即使有别的路径触发浏览器原生撤销，落点仍在这一个栈上。
  - CM 的 undo/redo 事务带 `filter: false` 绕过变更过滤器，但命令在 `state.readOnly` 时返回 false（`@codemirror/commands` 6.11.0 `dist/index.js` 的 `cmd()`），非 md 只读模式不会因撤销而变更文档。
- **需要 dogfood 验证的一点（本机无法运行桌面 app，如实记录）**：macOS 下 ⌘Z / ⌘⇧Z 是否真的经 webview keydown 到达统一键位层。若实测收不到（即按键被 webview 自身的 key-equivalent 处理截走，而非菜单），菜单项不设 accelerator 就无从补救——macOS 的 key equivalent 分派顺序是先视图层级、后主菜单（[Key Event Handling in Cocoa Applications — WWDC 2010](https://nonstrict.eu/wwdcindex/wwdc2010/145/)、[Apple: Handling Key Events](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/EventOverview/HandlingKeyEvents/HandlingKeyEvents.html)、[Chromium: OS X keyboard handling](https://www.chromium.org/developers/os-x-keyboard-handling/)）——届时的最小回退是给两个菜单项补上 accelerator 并完全依赖事件通道（一行级改动，代价是该键不再能被 JS keydown 看到）。
- 关联约束：ADR 0001 §4（chorded 非 modal 键位框架）、ADR 0006（Emacs keybinding PKM 定位）、M103/M110/M111/M113/M118 的硬化口径、D1/D2/D3 裁决。
