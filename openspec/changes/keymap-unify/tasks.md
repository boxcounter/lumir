# Tasks: keymap-unify

## 1. 统一分发表与旁路拆除

- [x] 1.1 `src/keys.ts` 建唯一 key → command 表：`KeyBinding`（key / command / scope / doc）+ `KEY_BINDINGS`；`CommandId` 由运行期 `COMMAND_IDS`（= `EDITOR_COMMAND_IDS` + `GLOBAL_COMMAND_IDS`）派生，`Record<CommandId, CommandRunner>` 构成编译期合同
- [x] 1.2 `Keymap` 构造函数对归一化后重复绑定抛错（旧实现是后注册者静默覆盖）；`attach` 注入命令实现时对缺实现抛错；保留 trie 与超时清空（ADR 0001 §4 chorded 非 modal）
- [x] 1.3 分发器语义：`defaultPrevented` 让路（轨道 D 的 widget 焦点键先消费）、输入法组合期不接管（`isComposing` / keyCode 229）、命中即吞默认行为、作用域判定（`global` / `editor` 目标包含于 contentDOM）
- [x] 1.4 轨道 A（keys.ts 的 window trie）拆除：`Mod-Enter` 迁入表（`Cmd-Enter`，作用域保持 global = 原 window 级）
- [x] 1.5 轨道 C（editor.ts 的 `domEventHandlers` ⌘A/⌃A）拆除：迁入表为 `editor.select-all` / `editor.line-start`
- [x] 1.6 轨道 E（main.ts 的裸 window ⌘S/⌃S 监听）拆除：迁入表为 `document.save`（global）
- [x] 1.7 轨道 B（editor.ts 的两个 `keymap.of`）拆除：6 键迁入表，命令函数与硬化原语一字未动（删掉 `@codemirror/view` 的 `keymap` 导入）

## 2. ⌘ / ⌃ 拆分（D1 / D2 / D3）

- [x] 2.1 token 归一化：逐修饰键（Cmd / Ctrl / Alt / Shift）+ 两类字符陷阱口径——US 布局需 Shift 的符号按「Shift 隐含在字符里」处理（⌃_ 物理为 ⌃⇧-）、含 Alt 的组合按物理键（`code`）判定（Alt 层替换字符，⌥⇧- → `—`）；表的写法与运行期事件共用同一函数
- [x] 2.2 ⌘A = 全选、⌃A = 行首（D2）
- [x] 2.3 ⌘S = 唯一保存键，⌃S 解绑不接任何功能（D3）
- [x] 2.4 新增 `moveCaretToLineStart`（与 `moveCaretToLineEnd` 镜像）：`moveToLineBoundary` 硬行首 + 行首紧贴隐藏 replace（两侧测量皆退化）时向前挪到行内第一个可测量位置，取可见侧 assoc（自证阶段实测未修前 scrollTop 下挫 62px，修后零位移）

## 3. 撤销能力

- [x] 3.1 `pnpm add @codemirror/commands`（package.json + pnpm-lock.yaml，6.11.0）
- [x] 3.2 `src/editor.ts` 接入 `history()`；导出编辑器侧命令记录（`EditorHandle.commands`），含 undo / redo / select-all / line-start
- [x] 3.3 装载事务带 `Transaction.addToHistory.of(false)`（与既有 `trustedLoad` 同事务）：打开文件 / 外部重载 / vault 复位不进撤销史，且旧事件随整篇替换的 mapping 力竭被丢弃（实测装载后 `undoDepth` 归零、`undo` 返回 false）
- [x] 3.4 dirty 口径：仍以文本 vs `cleanDoc` 比较（撤销回到已保存内容即 false），不依赖撤销栈位置；撤销/重做照常进自动保存 debounce 与守卫链路
- [x] 3.5 绑定 ⌘Z / ⌘⇧Z / ⌃/ / ⌃_ / ⌃⌥_（撤销与重做各三条入口；⌃⌥_ 以物理键 `Ctrl-Alt-Minus` 入表，真机 ⌃⌥⇧- 可命中）

## 4. macOS 菜单让位与命令交回

- [x] 4.1 `src-tauri/src/lib.rs`：把退出守卫与撤销/重做改造合成一个菜单安装入口（共用一次 `Menu::default()`，避免两次 `set_menu` 互相覆盖）
- [x] 4.2 Edit 子菜单的预置 Undo/Redo 换成自定义项（`lumir.undo` / `lumir.redo`），**不带 accelerator**（让 ⌘Z / ⌘⇧Z 留在 webview keydown 路径）；结构假设校验失败即跳过并告警
- [x] 4.3 `on_menu_event` 把两项点击经 `app:menu_command` 事件交回前端；`src/main.ts` 订阅后落到同一命令层（`editor.undo` / `editor.redo`）
- [x] 4.4 单元测试：预置项文案校验（含错位 / 缺项 / Windows 助记符文案）、菜单命令事件载荷只覆盖自己两项

## 5. 回归场景

- [x] 5.1 `tests/visual/scenes/m131-keymap-table.spec.ts`：表不变量（无重复键、每绑定有归属命令、无孤儿命令、scope 与实现方匹配）、⌘/⌃ 拆分（⌃A/⌘A/⌃S/⌘S 各归其位）、token 往返一致（每条绑定都能被真实事件命中）
- [x] 5.2 `tests/visual/scenes/m131-keymap-behavior.spec.ts`：⌃A 行首 / ⌘A 全选、widget 焦点下 ⌃A 仍走同一命令层（落点为行内第一个可测量位置、caret 不退化、scrollTop 零位移）、⌘Z 与 ⌃/ 撤销且 dirty 收回、⌘⇧Z 与 ⌃⌥_ 重做、⌘S 唯一保存（⌃S 不写入不清 dirty）、global 与 editor 作用域不越界、撤销不跨文档
- [x] 5.3 既有视觉场景零变化、无基线更新（迁移与拆分不改动既有按键的可见行为）

## 6. 验证

- [x] 6.1 `pnpm build`（含 `tsc --noEmit`）通过
- [x] 6.2 `cargo test` 与 `cargo fmt --check`（src-tauri）通过
- [x] 6.3 `LUMIR_VISUAL_PORT=4273 scripts/visual/run.sh` 视觉全量通过（既有场景 + M131 新增场景）
- [x] 6.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 6.5 分阶段自证：先做拆分与迁移（既有场景全绿）→ 再加 history 与新键（新增场景绿）→ 最后全量门禁
- [x] 6.6 评审 round 1 唯一 finding（p2：平台口径静默漂移）按建议补记：`src/keys.ts` 表头、本 change 的 proposal 与 spec delta 如实记录「迁移后绑定全平台无条件生效」及两处差异（⌃N/P/F/B/E 原 mac-only、`Mod-Enter` 的非 mac Ctrl-Enter 变体消失），并注明当前仅 macOS 目标无实害、跨平台时需重新引入平台门；改后复跑 `pnpm build` + `openspec validate --all --strict`（纯注释与文档改动，行为未变）
