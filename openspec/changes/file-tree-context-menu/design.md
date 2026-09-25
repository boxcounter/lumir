# Design: file-tree-context-menu

提案见 [proposal.md](proposal.md)。本文件给出六个操作项逐个的命令设计与被否决方案。
状态：提案稿（M234，2026-09-26），未进入实现。

## 1. 现状盘点

### 1.1 文件树模块（`src/tree.ts`，376 行）

- 行渲染与交互集中在 `renderRow`（`src/tree.ts:125-173`）：目录行 click = 折叠切换（`:157`），
  文件行 click = 打开（⌘-点击 = pinned，`:168`）、dblclick = pinned（`:169`）。**右键
  （`contextmenu` 事件）全仓零接线**（`src/` grep `contextmenu` / `ContextMenu` 零命中）。
- 树的数据流：全量枚举 → `setVault`（`:279-284`）；watch 增量 → `applyChanges`（`:294-350`），
  局部增删、保持展开状态（`expanded` 集合，`:113`）。deleted 事件连同子孙级联出模型
  （`:307-322`）。
- 路径工具：`baseName`（`:20-22`）是全前端唯一一份末段派生；`parentOf`（`:88-91`）模块私有。
- 浮层同形先例：树头部 vault 切换器入口（`:230-250`）+ `src/vault-switcher.ts` 的 listbox
  浮层——aria-haspopup/aria-expanded、↑↓/⌃N⌃P、Esc、外部点击关闭、筛选输入（D117-D119）。
  右键菜单复用这套模式（裁决点 1 推荐项的落点）。

### 1.2 后端命令与能力面

- `src-tauri/src/commands.rs` 现有 command 清单：`config_get`、`vault_open`、`vault_open_path`、
  `vault_current`、`fs_scan_workspace`、`fs_read_snapshot`、`fs_file_mtime`、`fs_read_attachment`、
  `fs_file_revision`、`document_save`、`document_set_dirty`、`log_event`、`open_external_url`、
  `link_resolve_note`、`link_open_path`、`recovery_backup` / `recovery_load`（及 recovery 其余）、
  vault 注册表/会话一族。**没有任何写类文件管理命令**（删除/改名/新建均不存在）。
- capabilities（`src-tauri/capabilities/default.json`）只有三条权限（event listen/unlisten、
  start-dragging）。自有 command 不受 ACL 门禁（`document_save` 等全部不在表内）；插件命令
  默认拒绝——opener 插件对 webview 保持默认拒绝，唯一入口是本仓 command
  （`src-tauri/Cargo.toml:35-40` 的注释即这条纪律的 canonical 记录）。
- **opener reveal 零新依赖实证**：本机 cargo registry 的 tauri-plugin-opener 2.5.4
  `src/lib.rs:156` 有 `OpenerExt::reveal_item_in_dir`（macOS 走 NSWorkspace
  `activateFileViewerSelectingURLs` 等价路径，语义 = Finder 中选中显示，正是「在系统文件查看器
  里打开」）。与 `link_open_path`（`commands.rs:760-813`）同一条最小权限路径。
- **Tauri 原生菜单可行性实证**：tauri 2.11.5 `src/menu/mod.rs:722` 有 `pub trait ContextMenu`
  （`popup(window)`），原生右键菜单在技术上可行；被否决理由见 proposal 裁决点 1。

### 1.3 vault 内路径约束与写纪律（`src-tauri/src/fs_io.rs`）

- `resolve_in_vault`（`:234-275`）：拒绝绝对路径、`..` 穿越、符号链接逃逸；**目标必须存在**
  （`canonicalize` 失败即 `fs_not_found`）。新建/改名的目标路径尚不存在，需要新变体
  `resolve_new_in_vault`（父目录走 `resolve_in_vault`，末段名单独校验），见 §3.1。
- 忽略集 `IGNORED_NAMES = [".git", ".DS_Store", "node_modules"]`（`:27`）：枚举与 watch 共用；
  新建/改名到这个名字必须拒绝（否则产物在树里不可见、事件被吞——静默丢失的温床）。
- 写纪律先例：`save_markdown`（`:342-431`）= 同目录 tmp + `create_new` + fsync + rename 原子
  替换 + 完成后回读 revision 确认；ghost tmp 治理（`:93-101`）。新建文件用 `create_new` 原子
  语义与此同族：撞名即 `AlreadyExists` 拒绝，MUST NOT 覆盖。

### 1.4 watcher 回响与已打开文档处置

- 改名的事件映射：notify 层 `RenameMode::Both` 拆成 deleted(from) + created(to)
  （`fs_io.rs:468-516`），flush 时 `refine_with_known` 按存在性探测修正（`:552-581`）。
  **watcher 无法区分「app 内发起的改名」与「外部改名」**——归因抑制只能在前端做（发起方知道
  old→new 对应关系）。
- 前端扇出（`src/main.ts:869-897`）：deleted → 附件索引级联剔除 + 逐个打开 session 的
  `save.handleExternalChange(path, kind)` + 链接索引失效 + `tree.applyChanges`。
- 打开中文件被删除的现状处置（`src/save-controller.ts:562-586`）：`pauseAutosave(path,
  "not-found")` + sticky toast「当前文件已被外部删除；编辑器中的内容未丢失」，tab 保留、
  内容不丢。被外部修改：dirty → sticky 二选一；clean → revision 比对后自动重载。
- session 路径 remap 可行性：`editor.ts:1722-1724` 的 `reloadSession` 已有 `session.path = path`
  语义（恢复链路在用）；标签栏按 session 渲染（`src/tabs.ts:63` 起），路径变化后重渲染即可，
  不需要新建 session。

### 1.5 剪贴板

仓内零先例：无 `navigator.clipboard` 调用、无 tauri clipboard 插件（Cargo.toml 无
`tauri-plugin-clipboard-manager`）。`navigator.clipboard.writeText` 在 Tauri 自定义协议
（secure context）+ 用户手势（菜单 click）下可用，是零新依赖路线；失败回落 toast（不引插件）。
验收侧断言剪贴板内容走 `osascript -e 'the clipboard'`（套件环境可直接执行）。

### 1.6 废纸篓

Rust 侧移到废纸篓的标准 crate 是 `trash`（v5，纯用户态、macOS 走 NSFileManager
`trashItemAtURL`）。它是本 change **唯一新增依赖**——opener（reveal）与 notify 都已在依赖树里。
`Cargo.toml` 新增条目须按既有格式附「为什么引、为什么不用替代」注释（低依赖取向，先例见
`base64_encode` 手写注释 `fs_io.rs:439-440` 与 rfd/opener 条目注释）。无 crate 的替代
（`osascript` 调 Finder）引入外部进程依赖与 quoting 注入面，否决（§4）。

## 2. 菜单总体设计（裁决点 1 推荐项落地）

### 2.1 形态与挂载

- 新增 `src/tree-menu.ts`：菜单浮层模块，vault-switcher 浮层同形——`role="menu"`（或 listbox，
  实现期按既有浮层最近的语义定）、项级 `role="menuitem"`、↑↓/⌃N⌃P 导航、Enter 触发、Esc 关闭、
  外部 mousedown 关闭、打开即持焦点、关闭归还树焦点。mousedown preventDefault 不夺焦手法沿用
  `src/tree.ts:249` 注释的先例。
- 接线：`renderRow` 的行 button 上挂 `contextmenu` 监听（preventDefault 拦系统菜单），按
  `node.entry.kind` 出文件版 / 目录版菜单。菜单锚定在指针位置（`clientX/Y`），视口边缘翻转。
- 右键的条目**不触发选中/打开**：右键只做菜单，不改变 currentPath 与 tab 状态（「右键不改
  上下文」——与 Finder 右键未选中项即改选中的行为不同，Lumir 树的选中即打开，代价不对称，
  保持保守）。
- 菜单 DOM 惰性建立、关闭即弃（ADR 0002 §6：无常驻结构）。

### 2.2 菜单项定义（v1）

| 条目类型 | 项（自上而下） |
|---|---|
| 文件 | 重命名…、复制完整路径、在 Finder 中显示、（分隔）、移到废纸篓… |
| 目录 | 新建文件…、新建子目录…、（分隔）、重命名…、复制完整路径、在 Finder 中显示、（分隔）、移到废纸篓… |

「…」后缀预告后面还有一步（确认对话框 / 内联输入），与文案-Copy.md 既有口径一致（D103/D104
省略号用法）。破坏性项（移到废纸篓）固定尾部 + 分隔线。菜单文案实现期登记 D120 起。

### 2.3 内联编辑形态（重命名 / 新建共用）

- 行名 `span.ft-name` 就地替换为 `<input>`（初始值：重命名 = 当前名；新建 = 空，占位「未命名」）。
- Enter 提交、Esc 取消、失焦取消（blur 即放弃，与 Finder 一致）；输入即时校验，非法时行内
  标红 + `aria-invalid`，MUST NOT 弹 toast 轰炸。
- 编辑期间该行的 click/dblclick/contextmenu 全部抑制；树的其余交互不受影响（编辑是行局部的，
  不是模态）。
- 校验规则（前后端同源，后端为权威）：非空、MUST NOT 含 `/`、MUST NOT 是 `.`/`..`、
  MUST NOT 命中 `IGNORED_NAMES`、MUST NOT 与既有同缀条目同名（冲突由后端 `create_new` / rename
  目标存在性原子判定，前端只做提示性预检）。

## 3. 六个操作项逐个设计

### 3.0 公共：`resolve_new_in_vault`（新建/改名的目标解析变体）

既有 `resolve_in_vault` 要求目标存在（`fs_io.rs:234-275`），新建/改名的目标不存在。新变体：
父目录相对路径走 `resolve_in_vault`（继承全部逃逸防护），末段名按 §2.3 校验规则判定后 join；
对 join 结果做 `symlink_metadata` 存在性探测——已存在 → `fs_already_exists`（不跟随后续
canonicalize，目标本来就允许不存在）。所有五个写类命令共用这一入口，安全边界不分散。

### 3.1 删除（移到废纸篓）

- **前端**：菜单项 → 确认对话框（模态；文件：「移到废纸篓？」+ 名称；目录：明示「连同其中全部
  内容」）→ 确认后 invoke `fs_trash_entry`。
- **后端 command**：`fs_trash_entry(rel)` → `resolve_in_vault` → `trash::delete(abs)`。
  目录递归进废纸篓由 trash crate 承担（macOS 语义即整项入篓，可整体放回）。
- **错误**：`fs_not_found`（菜单开着期间被外部删掉——透传人话）、`fs_trash_failed`（权限/
  卷不支持废纸篓，如部分外接卷；错误文案说明「未删除任何内容」——trash 失败是原子的，不留
  半删除状态，这是 proposal 裁决点 2 护栏的实现落点）。
- **watcher 联动**：不前端自绘补丁，等 `fs:entry_changed` 的 deleted 统一收敛树与索引
  （既有级联删除 `tree.ts:307-322` 直接复用）。
- **tab 联动**：命中打开中的 tab → watcher deleted 走 `handleExternalChange` 现状分支
  （pauseAutosave not-found + sticky toast），**不抑制、不特判**（proposal 裁决点 5 推荐项：
  提示文案即「内容未丢失」，语义正确，无需区分内外发起）。

### 3.2 重命名（树内联编辑）

- **前端**：内联编辑（§2.3）提交 → invoke `fs_rename_entry(rel, new_name)`。
- **后端 command**：`fs_rename_entry(rel, new_name)` → 源走 `resolve_in_vault`，目标走
  `resolve_new_in_vault`（父 = 源父目录，v1 同目录改名）→ `std::fs::rename`。
  冲突（目标已存在）→ `fs_already_exists`，MUST NOT 覆盖。
- **watcher 联动 + tab 联动（本 change 唯一的归因抑制点）**：改名成功后，前端对打开中的
  session 做就地 remap——文件：单个 session 路径替换；目录：其下所有打开 session 的路径前缀
  替换（`old + "/"` → `new + "/"`）。同时登记一次性抑制 `(old → new)` 对：随后 watcher 批里
  `deleted:old`（与目录子孙的 deleted）命中已 remap 的 session 时**跳过** `handleExternalChange`；
  `created:new` 照常吃（树的 upsert 幂等）。revision 基准不变（改名不改字节，CAS 依旧有效）；
  dirty 状态、滚动、光标全部保留。抑制条目在消费或超时（一个 debounce 窗口余量）后清除，
  MUST NOT 常驻。
- **外部改名**（Finder 发起）：无抑制条目，`deleted:old` 命中打开 session → 现状「已被外部
  删除」处置——语义正确（对 app 而言确实无法区分外部改名与删除+新建，内容保留是保守正确解）。
- **错误**：`fs_not_found` / `fs_already_exists` / `fs_name_invalid`（非法末段名）/
  `fs_rename_failed`（跨卷等 IO 失败）。toast 人话 + 行退出编辑态回到原名。

### 3.3 复制完整路径

- **纯前端**：`navigator.clipboard.writeText(root + "/" + rel)`（root 在 `loadVault` 时已持有，
  `main.ts` 装配层传入）。**零后端命令、零 capabilities 增量**。
- 成功 toast「已复制完整路径」；失败（剪贴板权限被拒等）toast 人话并 `log_event` 记一条
  （诊断埋点同既有口径）。
- 绝对路径裁决的落点：拼接逻辑一处（树模块导出或装配层），MUST NOT 每个调用点各自拼
  （REVIEW.md 第 8 条同族纪律）。

### 3.4 在 Finder 中显示（reveal）

- **后端 command**：`fs_reveal_in_finder(rel)` → `resolve_in_vault` →
  `app.opener().reveal_item_in_dir(abs)`（opener 2.5.4 Rust API 实证存在，§1.2）。
  与 `link_open_path` 同构：opener webview ACL 保持默认拒绝，唯一入口是本 command。
- 命令命名用跨平台语义 `reveal`（macOS 上是 Finder；他日 Linux/Windows 由插件持有平台语义），
  前端菜单文案按 macOS 写「在 Finder 中显示」。
- **错误**：`fs_not_found` / `fs_reveal_failed`。reveal 是只读动作，无护栏要求。
- **watcher 联动**：无（不产生文件系统变更）。

### 3.5 新建文件（目录行）

- **前端**：菜单项 → 目录行尾部/首位子节点位置出内联输入（§2.3 同形态，初始为空）→
  Enter → invoke `fs_create_file(parent_rel, name)` → 成功后自动打开新文件（`.md` 进 md
  编辑模式；其余类型按既有 `openKind` 分类）。**自动打开只发生在创建成功路径**。
- **后端 command**：`fs_create_file(parent_rel, name)` → `resolve_new_in_vault` →
  `OpenOptions::create_new(true)` 创建空文件。撞名 = `AlreadyExists` → `fs_already_exists`
  （原子，不存在「检查-创建」竞态窗口）。
- **watcher 联动**：等 `created` 回响收敛树；前端在 invoke 成功后即做自动打开，不等回响
  （打开走 `fs_read_snapshot`，与树展示互不依赖）。

### 3.6 新建子目录（目录行）

- 与 §3.5 同构：`fs_create_dir(parent_rel, name)` → `resolve_new_in_vault` →
  `std::fs::create_dir`（`create_dir` 本身撞名即报 AlreadyExists，原子语义等价）。
  成功后由 watcher 回响收敛树；新建目录不自动展开（保守：折叠态是用户状态，树不主动改）。

### 3.7 错误信封与日志口径汇总

| code | 触发 | 前端表现 |
|---|---|---|
| `vault_not_open` | 无 vault（菜单不可能出现，防御性） | 静默忽略 + log |
| `fs_not_found` | 目标已被外部移走 | toast 人话，树等 watcher 收敛 |
| `fs_already_exists` | 撞名（新建/改名） | 内联标红 + 原因，留在编辑态 |
| `fs_name_invalid` | 非法末段名 | 内联标红 + 原因 |
| `fs_path_escape` | 逃逸（理论上不可达，防御性） | toast 人话 + log |
| `fs_trash_failed` / `fs_rename_failed` / `fs_create_failed` / `fs_reveal_failed` | IO/权限/平台失败 | toast 人话 + log；删除类明示「未删除任何内容」 |

全部经 `CommandError` 信封（`commands.rs:63` 起的既有形态），前端 `errorMessage` 统一取人话。

## 4. 被否决的方案与理由

1. **Tauri 原生菜单（`ContextMenu::popup`）**：技术上可行（tauri 2.11.5 实证），否决理由见
   proposal 裁决点 1——主题一致性断裂、验收不可断言、键位体系不连通。
2. **永久删除 / ⌥修饰绕过确认**：Alex 已裁决进被否决项（proposal 裁决点 2）。
3. **重命名模态对话框**：Alex 已裁决进被否决项（proposal 裁决点 3）。
4. **复制 vault 相对路径**：Alex 已裁决进被否决项（proposal 裁决点 4）。
5. **删除时关闭对应 tab**：与 M127 内容不丢方向相反；dirty tab 强关会把正常操作推给事故兜底
   链路（proposal 裁决点 5）。
6. **`osascript` 调 Finder 做废纸篓**：外部进程依赖 + 路径 quoting 注入面；`trash` crate 是
   纯用户态调用，错误语义清晰。
7. **前端自绘树补丁（不等 watcher）**：操作成功后立刻改树模型会让「单一收敛通道」变成两处
   真源（REVIEW.md 第 8 条同族）；debounce 窗口 100ms 的延迟在可接受范围。唯一例外是新建文件
   的**自动打开**（不等回响，走读取链路，与树展示解耦）。
8. **前端 `Date.now` 式去重抑制改名的 watcher 回响**：抑制条目以「命令返回的 old→new 对」为键，
   消费即清；按时间窗盲抑会吞掉窗口内的真实外部删除（REVIEW.md 第 2 条同族：判据要有输入）。

## 5. 实现期必须验证 / 未决的点

1. **trash crate 选型确认**：锁版本前核对 `trash` 5.x 的 MSRV 与本仓 Rust toolchain 兼容；
   实证 macOS 上目录入篓后「放回原处」可用（Finder 语义）。若 crate 有重大缺陷，回到 tower
   复议 §4.6 而不是静默换实现。
2. **WKWebView 剪贴板权限实证**：真机场景 47 的第一条断言即「复制完整路径后 `osascript -e
   'the clipboard'` 读到期望值」；若 WKWebView 拒绝，退路是本仓自有 command +
   `tauri-plugin-clipboard-manager` Rust 侧 API（与 opener 同一条最小权限模式），**这是已实现
   预案不是新裁决点**——走哪条不改变「绝对路径、零确认、成功 toast」的行为契约。
3. **抑制对的窗口余量**：watcher debounce = 100ms（`fs_io.rs:33`）+ FSEvents 注册延迟，抑制
   条目寿命取「下一个 watcher 批到达或 1s 超时，先到为准」；实现期用真机改名 20 次验证零误报
   「已被外部删除」。
4. **目录改名时打开 session 的前缀 remap**：覆盖「目录下深层文件打开中改名祖先目录」用例
   （含 dirty session），真机场景必含。
5. **外接卷 / iCloud 卷的废纸篓失败路径**：`fs_trash_failed` 的文案与「未删除任何内容」承诺
   在实现期用不可写目录实测一次。

## 6. 与 REVIEW.md 的对表

- 第 1 条（断言无区分度）：场景 47 的剪贴板断言先写反向用例（清空剪贴板后断言读到空/旧值时
  FAIL），再跑正向。
- 第 2 条（读不到当为空）：树节点消失类断言必须区分「AX 树里没有该节点」与「AX 快照取失败」，
  后者一律 FAIL。
- 第 6 条（覆盖声明超出真实验证）：六个操作项逐个列场景断言计数；右键菜单若真机通道不可达
  （M184 的 dblclick 前科），按 M184 口径转 chromium 断言 + Alex 手感清单，不冒称。
- 第 7 条（证据落盘）：读数与截图落 `test-results/acceptance/<日期>/47-file-tree-context-menu/`。
- 第 8 条（同一语义两处真源）：路径拼接（§3.3）、名字校验（§2.3 前后端）、忽略集（新建/改名
  复用 `IGNORED_NAMES`，不另抄一份）。
- 第 13 条（环境隔离）：场景 47 全程在套件自带合成 vault（`/tmp/lumir-m102-acceptance`）与
  隔离 `XDG_CONFIG_HOME` 下跑；废纸篓断言用 `$HOME/.Trash` 的存在性探测须先确认套件 HOME
  是否隔离——未隔离则断言「vault 内文件消失 + trash crate 返回 Ok」，不碰真实废纸篓目录。
