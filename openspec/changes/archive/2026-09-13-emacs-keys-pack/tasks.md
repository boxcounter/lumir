# Tasks: emacs-keys-pack

## 1. Emacs 编辑键（档 1 / 档 2）

- [x] 1.1 `src/keys.ts`：新增编辑器命令 id（delete-char-forward/backward、transpose-chars、delete-word-forward/backward、kill-line、yank、keyboard-quit、scroll-page-down/up、recenter）与绑定，全部 scope=editor、全平台无条件生效（沿用 M131 口径）
- [x] 1.2 删除 / 转置以字素簇为步长（`findClusterBreak`，不拆代理对）；`⌃D` / `⌃H` / `⌥D` / `⌥⌫` 在有选区时删除选区
- [x] 1.3 `⌃K` 实现 Emacs C-k 两段语义：行内杀到行尾、行尾连带换行（两行合并）
- [x] 1.4 kill / yank 单槽：连续同向 kill 相接即合并，`⌃Y` 插入并把光标落在插入内容之后（多槽 kill ring 不在本次）
- [x] 1.5 `⌃T` 转置光标两侧字素（光标移到两者之后）；行尾形态转置前两字素、光标原地
- [x] 1.6 `⌃V` / `⌥V` 视口翻屏（一屏减两行，光标不动）；`⌃L` 居中（`scrollIntoView y:"center"`）
- [x] 1.7 `⌃G` 撤下进行中的选择（折叠为光标，不动文档）
- [x] 1.8 全部命令建在既有硬化原语上：可见侧 assoc（`caretAssoc`）、`scrollIntoView` 传 SelectionRange、退化测量回退；只读模式（非 md）一律不动文档
- [x] 1.9 命令 id 与实现新增进 `Record<EditorCommandId, CommandRunner>` 编译期合同（无孤儿命令、无缺实现）

## 2. 表格 cell 的删除边界纪律

- [x] 2.1 `cellClamp`：取光标所在 grid 表格 cell 的可见内容区间，并标出落点是否在内容区（管道符区判 false）；非矩形 / 降级表不参与（管道符可见）
- [x] 2.2 删除 / 转置 / kill 一律以 cell 边界为限：`⌃D` / `⌃K` 不越过 cell 右缘、`⌃H` / `⌥⌫` 不越过 cell 左缘、`⌥D` 词扫描止于 cell 右缘
- [x] 2.3 落点在管道符区（cell 间隙 / 行首尾）时不动文档；`⌃T` 在管道符区直接返回
- [x] 2.4 视觉场景断言结构完好：管道符数量不变 + 表格仍以 grid 呈现（跨过即降级为原始 Markdown）

## 3. shift-extend 扩选

- [x] 3.1 从既有光标命令抽出共用落点原语（`verticalTarget` / `horizontalTarget` / `lineBoundaryTarget` / `caretAssoc`），既有 `⌃N/P/F/B/E` 与 `⌃A` 改为调用它们（行为零变化，由既有场景背书）
- [x] 3.2 绑定 `⌃⇧F/B`（字符）、`⌃⇧N/P`（逐行）、`⌃⇧A/E`（行首尾）、`⌥⇧F/B`（词）
- [x] 3.3 扩选保持 anchor、只移动 head，并保留 goalColumn（逐行扩选列位不漂）；揭示滚动传 SelectionRange
- [x] 3.4 词扫描器（`forwardWordEnd` / `backwardWordStart`，码点粒度）与 `⌥D` / `⌥⌫` 共用同一份
- [x] 3.5 v0 不做 mark mode；⌃Space 不绑（本机归 Alfred），set-mark 归档 3

## 4. 轨道 D 的 widget 滚动键纳入统一键位表

- [x] 4.1 `KeyBinding.when` 命中条件 + 分发器对条件不满足的绑定不消费事件（不 `preventDefault`，留给原生路径）
- [x] 4.2 `CommandRunner` 接收触发事件（可选参数，既有实现不受影响），供 widget 命令定位事件目标
- [x] 4.3 `livePreview.ts` 导出 `widgetCommands(view)`（←/→ 120px、Home→最左、End→最右、Escape→焦点交还编辑器），删除原 keydown 手柄（不留第二条旁路）
- [x] 4.4 `editor.ts` 把 widget 命令并入同一 `commands` 记录；绑定统一加 `when` 限定（否则会把文本里的 Home/End/方向键吞掉）
- [x] 4.5 场景断言：容器焦点内各键生效、文本里的 ← 仍走原生 caret 且不触发 widget 滚动；既有 `.cm-lp-table-scroll` 场景（End/Escape）不回归

## 5. [keys] 配置层

- [x] 5.1 `src-tauri/src/config.rs`：`AppConfig.keys`（键位 → 命令 id / null），宽容解析 + 逐项形状校验（键位空 / 含空白、值类型非字符串 / 非 null、命令为空）
- [x] 5.2 单元测试：缺字段落回空表、重绑与解绑解析、非对象 / 非法项逐项丢弃并 warning、未知命令透传（合法性由前端判定）、临时路径（不读写真实 `~/.config/lumir/`）
- [x] 5.3 `cargo test` 重新导出 `src/bindings/AppConfig.ts`（`keys: { [key in string]?: string | null }`）
- [x] 5.4 `src/keys.ts` 的 `applyKeyOverrides`：单键重绑 / 解绑、作用域随命令归属、未知命令 / 非法键位 / chord 各给 warning 并忽略该条
- [x] 5.5 `src/main.ts`：配置到位后重挂分发器（配置未到前先跑默认表，避免启动瞬间按键无响应）；warning 记 console
- [x] 5.6 场景：配置重绑生效（⌃J → undo、⌃S → 保存）、解绑生效（⌘S 不保存）、未知命令 warning 且默认表照常

## 6. 三条 finding 收编

- [x] 6.1 轨道 D widget 滚动键入表（见第 4 组；finding 原文落点在 `src/preview/livePreview.ts`，实现即在此文件）
- [x] 6.2 Mod-Click 拆 ⌘ / ⌃：`⌘`-Click 跟随 wikilink、`⌃`-Click 让位系统次级点击（实测落点在 `src/main.ts` 的 mousedown 监听，非 finding 所述 `src/preview/wikilinks.ts` —— 已 TowerSend 报备）；场景覆盖两条路径
- [x] 6.3 `recovery_*` 五个封装从 `src/save-ipc.ts` 折回 `src/ipc.ts`（该文件删除，`save-controller.ts` 导入改口）
- [x] 6.4 菜单命令事件收进 `ipc.ts` 的 `onMenuCommand`（装配层不再直连 `listen`）；场景用桩事件验证 undo 仍落到同一命令层
- [x] 6.5 `ipc.ts` 模块头更新（invoke 与 listen 两条通道的单一入口）

## 7. 回归场景与规格制品

- [x] 7.1 `tests/visual/scenes/m132-emacs-keys.spec.ts`：编辑键、kill/yank、表格边界、翻屏、recenter、keyboard-quit、shift-extend、只读回归、widget 键与文本方向键
- [x] 7.2 `tests/visual/scenes/m132-keymap-config.spec.ts`：表不变量（新键归属 + widget 键必带 `when`）、`applyKeyOverrides` 纯函数口径、配置重绑 / 解绑 / 未知命令、菜单通道、⌘/⌃-Click
- [x] 7.3 `tests/visual/scenes/tauri-stub.ts`：`config_get` 支持 fixture 注入（mode / keys / warnings）+ `__fireMenuCommand` 钩子 + `__configGets` 计数
- [x] 7.4 既有视觉场景零基线更新（键位迁移不改可见行为；`.cm-lp-table-scroll` 的既有 End/Escape 场景照旧通过）
- [x] 7.5 openspec 制品：proposal（Why / What Changes / Non-goals / Impact，含已知限制与取代关系）/ spec delta（keymap-commands 七条 ADDED requirement）/ 本 tasks
- [x] 7.6 文案：本 change 无新增用户可见文案（[keys] 是配置格式、warning 走 console），`文案-Copy.md` 不改动

## 9. 评审 round 1 修复（p2-2items → fix-then-merge）

- [x] 9.1 P2-1（`src/editor.ts`）：kill 槽的 `caret` 恒存 `from`——后向 kill 结束后光标落在 `from`，而相接端是本次 `to`（= 上次 kill 后的光标位置），原实现存 `to` 使后向相接判定恒假（⌥⌫⌥⌫ 只留下最后一次 kill）。补场景「后向连续 kill 合并：⌥⌫⌥⌫ → ⌃Y 一次插回两词」作回归
- [x] 9.2 P2-2(a)：M131 取代关系从 proposal Impact 落进 ADDED requirement 正文（widget requirement），并写明 archive M131 时 MUST 按该 requirement 修订原句
- [x] 9.3 P2-2(b)：Alt+Shift token 已知限制补进 spec delta 的 shift-extend requirement；`src/keys.ts` 的引用改指该处（不再悬空）
- [x] 9.4 9.1 的回归场景又暴露第二个缺陷（自证阶段实测）：`⌃Y` 在**插入前**的文档里测量插入后的光标位置（`caretAssoc` → `coordsAtPos`），插入目标越出当前文档长度时（在文档末尾 yank 且槽内容比剩余文档长）`doc.lineAt` 抛 RangeError → 命令无声失败。已修：越界时退化为按插入起点取 assoc；补场景「⌃Y 在文档末尾插入」并把该行为写进 spec 的 kill/yank requirement
- [x] 9.5 复跑全量门禁（pnpm build / 视觉全量 191 passed / cargo test + fmt / openspec validate --all --strict）并 push，向 tower 发 round 2 review request（注明新 tip）

## 10. 验证

- [x] 10.1 `pnpm build`（tsc --noEmit + vite build）通过
- [x] 10.2 `LUMIR_VISUAL_PORT=4273 scripts/visual/run.sh` 全量（既有 + M132 新增）通过，无基线更新（首轮 189 passed；r1 修复后 191 passed——新增后向合并与 yank 越界两条回归场景）
- [x] 10.3 `cargo test`（`src-tauri/`）与 `cargo fmt --check` 通过（70 + 19 tests，0 failed）
- [x] 10.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（15 passed，0 failed）
- [x] 10.5 自查：无真实 `~/.config/lumir/` 读写、无真实 vault 写入、无 scope 外文件改动

