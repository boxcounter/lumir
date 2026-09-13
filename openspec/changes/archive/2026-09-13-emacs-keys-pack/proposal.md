# Proposal: Emacs 键位包（编辑键档 1/2、shift-extend、表格删除纪律、[keys] 配置）

- Change ID: emacs-keys-pack
- 日期: 2026-09-13
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

M131 把键位收敛成**一张表 + 一个分发器**（`keymap-unify`，已合并 master），但表里只有 6 个光标移动键、撤销 / 重做与 ⌘S / ⌘Enter。Emacs 定位的**编辑族**（C-k/C-y/C-d/C-h/C-t/M-d/M-DEL/C-v/M-v/C-l/C-g）仍是空的：按下这些键走的是原生 contenteditable 路径，而原生路径在 widget 与隐藏 replace 边界上不可控——M103（垂直移动整屏跳变）、M110/M111（原生 caret 进不了公式 widget）、M113/M118（表格与公式边界落点退化、揭示滚动把整窗内容拉偏）是同一族根因的实证。补齐编辑族必须在统一键位层与既有硬化原语上做，不能留给原生路径。

三项已登记的待收编项也在本次落地（它们的来由分别在 M129 survey 与 M131 的现状记录里）：

1. **轨道 D 的 widget 滚动键**（表格滚动容器的 Escape / Home / End / 左右方向键）仍在 `livePreview.ts` 自己的 keydown 手柄里，是统一层之外的第二条键位旁路——正是 M131 要消灭的形态。
2. **鼠标路径的 ⌘/⌃ 未拆分**：`main.ts` 的 Mod-Click 仍是 `metaKey || ctrlKey`，D1 的拆分只落到键盘族。
3. **IPC 单一入口有两处例外**：崩溃备份的 `recovery_*` 封装暂居 `src/save-ipc.ts`（M127 因 scope 隔离所致，文件头已记待收编），菜单命令事件在装配层直连 `listen`（M131 现状记录已列）。

键位可配置此前完全缺失：ADR 0002 §5 已定「配置需人可读可改」，但用户对键位的偏好差异（本机实测 ⌃Space 归 Alfred；⌃S 想接 isearch）只能改代码。Alex 对 D1–D4 的裁决原话：「D1、D2、D3、D4 中你的建议都符合我的预期，都采纳。」——D1 ⌘/⌃ 拆、D2 ⌃A=行首、D3 ⌘S 唯一保存且 ⌃S 预留、D4 非 md 一律只读 code；⌃Space 实测归 Alfred，故不绑，set-mark 归档 3、默认 ⌃⇧Space。

## What Changes

1. **Emacs 编辑键（档 1 与档 2）**：⌃V/⌥V 视口翻屏、⌃L 居中、⌃D 前删、⌃H 后删、⌃T 转置、⌥D 前删词、⌥⌫ 后删词、⌃K kill 行、⌃Y yank、⌃G keyboard-quit。全部经统一键位表分发，命令实现建在既有硬化原语上（可见侧 assoc、`scrollIntoView` 传 SelectionRange、退化测量回退、原子块钳制），不换用 CM stock 命令、不留原生旁路。只读 code 模式（M130 方向 A）下一律无事发生。
2. **kill / yank 单槽**：连续同向 kill 相接时合并进同一槽（Emacs 的连续 kill 合并，⌃K ⌃K 先杀行内容再杀换行为同一槽），⌃Y 插回光标处并把光标落在插入内容之后；多槽 kill ring 不在本次。
3. **表格 cell 的删除边界纪律**：删除 / 转置 / kill 一律钳制在光标所在 grid 表格 cell 的可见内容区间内，绝不删隐藏管道符——M129 survey 实证跨过即破坏表格结构（表格随即降级为原始 Markdown）。落点在管道符区（cell 间隙 / 行首尾）时不动文档。
4. **shift-extend 扩选**：⌃⇧F/B（字符）、⌃⇧N/P（行）、⌃⇧A/E（行首尾）、⌥⇧F/B（词）——保持 anchor、只移动 head，落点复用对应移动命令的硬化落点（数学原子跨入钳制 / 跨原子块钳制 / 表格行路由 / 隐藏 replace 退化回退）。v0 不做 mark mode。
5. **轨道 D widget 滚动键收编**：表格滚动容器的 ←/→/Home/End/Escape 进统一键位表，`livePreview.ts` 的并列 keydown 手柄删除；由于这些键在文本编辑中另有原生语义，绑定用**命中条件**（`when`：事件目标是该容器）收窄——条件不满足时不消费事件，文本里的同名键照旧走原生 caret 路径。步进与逃逸语义与迁移前一致（120px / Home→最左 / End→最右 / Escape→焦点交还编辑器）。
6. **[keys] 配置表**：`~/.config/lumir/config.json` 新增 `keys` 表（键位 → 命令 id；`null` = 解绑），支持单键重绑与解绑。覆盖只替换「键 → 命令」的对应，作用域随命令归属（编辑器组 → editor，其余 → global），不允许配置改作用域。命令 id 的合法性由前端键位层判定（命令清单的单一来源是 `src/keys.ts` 的 `COMMAND_IDS`，Rust 侧复制即制造两份必然漂移的清单）：未知命令给 warning、忽略该条、保留默认绑定，不抛错。含空白的键位（多段 chord）本版不支持，按非法项忽略并 warning。
7. **鼠标路径 ⌘/⌃ 拆分**：⌘-Click 跟随 wikilink；⌃-Click 让位 macOS 系统级次级点击（右键等价手势），不再激活链接；裸点击照旧不拦截。
8. **IPC 与事件通道单一入口**：`recovery_*` 五个封装从 `src/save-ipc.ts` 折回 `src/ipc.ts`（该文件删除，`save-controller.ts` 的导入随之改），菜单命令事件收进 `ipc.ts` 的 `onMenuCommand`（装配层不再直连 `listen`）。

## Non-goals

- **不做 mark mode / set-mark**：⌃Space 本机归 Alfred（Alex 实测），不绑；set-mark 归档 3，默认 ⌃⇧Space。
- **不做 isearch**：⌃S 保持解绑（D3 的「预留」），配置可显式把它接上任何既有命令。
- **不做 kill ring（多槽）**：单槽 + 连续 kill 合并是本次全部能力。
- **不做多段 chord 的实际绑定**：[keys] 表明确不接受含空白的键位；trie 机制按 ADR 0001 §4 保留。
- **不绑 ⌥F / ⌥B（单词移动）**：不在本次键位清单内；且 M131 的 token 口径下它与 ⌥⇧F/B 同 token（见 Impact 的已知限制）。
- **不做配置 warning 的 UI 出口**：沿用 M1 以来 `ConfigSnapshot.warnings` 无 UI 出口的现状，本次只把 warning 记到 console（另报 finding）。
- **不做 Emacs 链式 undo / undo-tree**：M131 已定为 CM history 线性双栈。
- **⌃V/⌥V 不移动光标**：本次是纯视口滚动；光标滚出视口后由下一个移动命令的 `scrollIntoView` 揭示（Emacs 的「光标跟窗」不在本次）。
- **⌃L 只做居中**：不做 Emacs 的居中 / 页首 / 页尾三段循环。
- **不改非 md 只读态、不改保存链路保证**。

## Impact

- 影响的 specs：`keymap-commands`（ADDED 七条 requirement：Emacs 编辑键、kill/yank 单槽、表格 cell 删除边界、shift-extend、widget 滚动键入表、[keys] 配置覆盖、IPC 与事件通道单一入口）。
- 影响的代码：`src/keys.ts`（命令 id 清单、`when` 命中条件、`CommandRunner` 接收事件、`applyKeyOverrides`）、`src/editor.ts`（编辑命令 + 从既有光标命令抽取共用的落点原语）、`src/preview/livePreview.ts`（`widgetCommands`，删除 keydown 手柄）、`src/main.ts`（配置应用与分发器重挂、⌘-Click 收窄、菜单通道改经 ipc）、`src/ipc.ts`（收编 `recovery_*` 与 `onMenuCommand`）、`src/save-ipc.ts`（删除）、`src/save-controller.ts`（导入改口）、`src-tauri/src/config.rs`（`keys` 表形状校验 + 单元测试）、`src/bindings/AppConfig.ts`（ts-rs 重新导出）、`tests/visual/scenes/m132-*.spec.ts`（新增）、`tests/visual/scenes/tauri-stub.ts`（config 与菜单事件钩子）。
- **文案：本 change 不新增用户可见文案**（`[keys]` 是配置格式、配置 warning 走 console），故 `文案-Copy.md` 不改动；若后续为配置 warning 补 UI 出口，文案随那个 change 一并编号入册。
- **已知限制（如实记录）**：
  - ⌥⇧F/B 与 ⌥F/B 在 token 层不可分：M131 定下含 Alt 的组合按物理键（`code`）判定、Shift 不参与该判定，故二者归一到同一 token——⌥F 也会触发按词扩选。将来要绑 bare ⌥F/⌥B 的单词移动，必须先改 token 口径（已按 finding 报出，未在本 change 内改：那会动到 M131 的既有不变量与其测试）。
  - kill 槽的「连续 kill」判定用「上次 kill 后的光标位置 = 本次 kill 起点」近似：kill → 在同一位置做别的编辑 → 再 kill 会误判为连续（kill ring 落地时一并修）。
  - **解绑只解除本应用的绑定**：macOS 文本系统自带 Emacs 惯例键位（自证阶段实测：`⌃K` 解绑后按 `⌃K` 仍被原生 `deleteToEndOfLine:` 杀掉行内容），故解绑 `⌃` 系键的效果可能是「交给系统」，不等于关闭能力；要禁用须重绑到别的命令（首次写这条场景时即被该行为证伪，已改为用 `⌘S` 做端到端断言）。
  - ⌃G 只折叠选区；Emacs 的 C-g 还负责中断交互式命令，本 change 没有可中断的交互式命令。
  - **M131 的 `keymap-commands` 增量尚未 archive**，其中「widget 自己的焦点作用域键仍由该 widget 现有手柄先消费」一句被本 change 取代。因该 capability 还没有 living spec（无法用 MODIFIED 表达），本 change 在 ADDED requirement 里显式标注取代关系；M131 archive 时需按本 change 修订该句。
- 关联约束：ADR 0001 §4（chorded 非 modal 键位框架）、ADR 0006（Emacs 键位 PKM 定位）、ADR 0002 §5（配置路径 / 校验 / 人可读可改）、M103/M110/M111/M113/M118 的硬化口径、M129 survey（跨隐藏管道符破坏表格结构）、M131 的统一分发与撤销口径。
