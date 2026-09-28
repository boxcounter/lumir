# file-tree Specification

## Purpose

定义 app-shell `fileTree` pane 的文件树行为：全类型条目展示与折叠、点击打开文件（按文件类型选编辑器模式）、watch 驱动的增量刷新（不丢展开状态）、未打开 vault 空态。由 change `add-vault-workspace` 归档并入（2026-09-05，实现 M18 + M20 接线与 defaultMode 修复）。

## Requirements

### Requirement: 全类型文件树展示

系统 SHALL 在 app-shell 的侧栏（宽 236px，见 ui-design-system「应用骨架布局」）挂载文件树，展示当前 vault 的全类型条目（目录可折叠，默认排序：目录在前、同缀按名称）。条目 SHALL 显示文件名与类型区分（至少区分目录 / Markdown / 图片等可预览附件 / 其他）。树的行形态 SHALL 取 design tokens：行高 25px、层级缩进 `8px + 14px × 层深`、选中态底色 `--sel`、hover 底色 `--hover`；eink 主题下选中态 SHALL 为黑底反白，行内次级元素（徽标 / ghost 项）SHALL 同步反白（eink 降级规则 ④）。树的数据来源 SHALL 为 fs-io 的枚举结果与 watch 增量事件，webview MUST NOT 直接访问文件系统（ADR 0002 §3）。

#### Scenario: 全类型混合展示

- **WHEN** vault 含 md、代码、图片、嵌套目录
- **THEN** 文件树全部展示并正确区分类型，不只展示 Markdown

#### Scenario: 行形态与层级缩进

- **WHEN** 展开三层嵌套目录并选中其中一个文件
- **THEN** 各行高 25px，缩进按 `8px + 14px × 层深` 逐级递增；选中行取选中态底色（eink 下黑底反白）

### Requirement: watch 驱动的增量刷新

文件树 SHALL 消费 `fs:entry_changed` 增量事件对树做局部更新（新增节点、删除节点、更新条目），MUST NOT 在每次事件后全量重扫重绘。刷新 SHALL 保持用户的折叠/展开状态不丢失。

目录经**树内重命名**（含改回原名）后，该目录 SHALL 仍可展开并列出其全部子条目——这是「刷新保持折叠/展开状态」在改名这一形态上的落点：重命名前处于展开状态的目录 SHALL 保持展开（展开态随目录迁移到新路径，含其子孙前缀），未展开的保持折叠；树内 MUST NOT 残留旧路径的行。**外部进程**发起的改名（树没有对应的提交登记）只保证「可展开且子树齐全」，展开态不迁移——判据只认 app 自己发起的那一次改名，避免把「同一 debounce 窗口里删了 A 又新建 B」误判成改名（M258）。

#### Scenario: 增量刷新保持展开状态

- **WHEN** 用户已展开若干目录，外部在 vault 内新建一个文件
- **THEN** 新文件出现在对应位置，既有目录的展开状态不变

#### Scenario: 树内重命名目录后保持展开且子树齐全

- **WHEN** 用户在树里展开目录 `a`（含 `a/x.md`），再经条目菜单把它改名为 `b`
- **THEN** 树中出现 `b` 行且仍为展开态（`b/x.md` 行在场）；旧路径的行不残留；改回 `a` 亦然

#### Scenario: 外部改名后目录仍可展开

- **WHEN** 外部进程把目录 `a` 改名为 `b`（树内没有对应的提交登记）
- **THEN** 树中出现 `b` 行，`b` 可展开并列出其全部子条目（展开态不迁移：判据只认 app 自己发起的改名）

### Requirement: 未打开 vault 空态

无打开的 vault 时，文件树 pane SHALL 显示空态与"打开 vault"入口；触发入口 SHALL 调 `vault_open`。`last_vault` 恢复失败时 SHALL 在空态上展示对应人话提示。

#### Scenario: 空态打开入口

- **WHEN** 应用启动且无可用 `last_vault`
- **THEN** 文件树 pane 显示空态与打开入口，点击入口弹出目录选择器

### Requirement: 点击打开文件与可编辑性裁决

点击文件树条目 SHALL 在编辑器 pane 打开对应文件。打开分类与编辑器模式裁决 SHALL 同源于扩展名注册表（`src/preview/attachments.ts` 的单一事实源）：文件树与编辑器 MUST NOT 各持一套扩展名集合（`CODE_EXTS` / `CODE_EXTENSIONS` 之类），否则差集扩展会在文件树里显示为代码、进编辑器却落到配置默认模式。Markdown 文件走编辑器 md 模式；其余非二进制文本文件（已知代码扩展、未收录扩展、dotfile、basename 无点的 `LICENSE`/`Makefile`）SHALL 以**可编辑** code 模式打开（纯文本编辑 + 语法高亮，无 live preview 装饰层）——MUST NOT 落到 md 模式或可编辑性随配置默认漂移的形态；不支持的二进制 SHALL 显示"暂不支持预览"提示而非空白或报错弹窗。目录点击 SHALL 只切换折叠状态。

#### Scenario: 不支持的二进制给出提示

- **WHEN** 用户点击一个 PDF 或可执行文件
- **THEN** 编辑器区域显示"暂不支持预览"提示

#### Scenario: 非 md 文本文件可编辑打开

- **WHEN** 用户在配置 `editor.mode = md` 下点击 `.php` / `.txt` / 未知扩展文件 / `LICENSE`（basename 无点）
- **THEN** 编辑器以可编辑 code 模式打开该文件原文：可键入、产生未保存状态，Cmd+S 真实可达（保存链路同 md），不会出现 Cmd+S 无效的保存死态

#### Scenario: md 文件仍可编辑

- **WHEN** 用户点击一个 `.md` 文件
- **THEN** 该文件以 md 模式（可编辑 + live preview）打开，保存链路不受本 change 影响

### Requirement: 条目右键菜单

文件树的每个条目行（文件与目录）SHALL 提供右键菜单（`contextmenu`），菜单 MUST 拦下系统默认
菜单。菜单 SHALL 为应用内自绘浮层（主题 token 与 eink 规则自动继承），SHALL 支持 ↑↓/⌃N/⌃P
导航、Enter 触发、Esc 或点击外部关闭，打开时持有焦点、关闭后焦点归还文件树。右键打开菜单
MUST NOT 改变当前打开文件与 tab 状态。

文件行菜单 SHALL 至少含：重命名、复制完整路径、在系统文件管理器中显示、移到废纸篓（尾部，
与余项分隔）。目录行菜单 SHALL 在此基础上追加：新建文件、新建子目录。破坏性项（移到废纸篓）
SHALL 固定为菜单尾部并以分隔线与余项隔开。

#### Scenario: 文件行菜单项集

- **WHEN** 用户右键一个文件条目
- **THEN** 浮层出现且含「重命名 / 复制完整路径 / 在 Finder 中显示 / 移到废纸篓」，不含新建项

#### Scenario: 目录行菜单项集

- **WHEN** 用户右键一个目录条目
- **THEN** 浮层在文件项集基础上多出「新建文件 / 新建子目录」

#### Scenario: 右键不改上下文

- **WHEN** 已有文件 A 打开，用户右键另一文件 B 并关闭菜单（Esc）
- **THEN** 当前打开文件仍是 A，tab 列表与树高亮不变

### Requirement: 条目内联重命名

菜单「重命名」SHALL 把该条目行名就地替换为输入框（树内联编辑，MUST NOT 使用模态对话框）。
Enter 提交、Esc 或失焦取消。末段名 SHALL 校验：非空、不含 `/`、不是 `.`/`..`、不命中忽略集
（`.git` / `.DS_Store` / `node_modules`）、不与既有同缀条目同名；非法 SHALL 行内标红并给出
原因，MUST NOT 提交。提交 SHALL 经后端命令完成同目录改名；撞名 MUST NOT 覆盖既有条目。编辑
期间该行的打开/折叠/右键交互 SHALL 抑制，其余条目不受影响。

#### Scenario: 正常改名

- **WHEN** 用户对文件 `a.md` 发起重命名，输入 `b.md` 并 Enter
- **THEN** 树中该条目显示为 `b.md`（经 watcher 回响收敛），磁盘上完成改名

#### Scenario: 撞名拒绝

- **WHEN** 目标名与同目录既有条目同名
- **THEN** 改名被拒绝、行内给出原因，既有同名条目内容不变

#### Scenario: 忽略集名拒绝

- **WHEN** 用户输入 `.DS_Store` 作为新名
- **THEN** 改名被拒绝并给出原因；磁盘与树均不变

### Requirement: 复制完整路径

菜单「复制完整路径」SHALL 把该条目的**绝对路径**（vault 根 + 相对路径拼接）写入系统剪贴板，
成功 SHALL 给提示；失败 SHALL 给人话提示并记诊断日志。本操作 MUST NOT 新增后端命令（纯前端
剪贴板通道；若 webview 剪贴板不可用，退路为后端剪贴板命令，行为契约不变）。

#### Scenario: 复制文件绝对路径

- **WHEN** vault 根为 `/vault`，用户对 `sub/a.md` 选择「复制完整路径」
- **THEN** 系统剪贴板内容为 `/vault/sub/a.md`

### Requirement: 在系统文件管理器中显示

菜单「在 Finder 中显示」SHALL 经后端命令调用系统文件管理器定位并选中该条目（macOS =
Finder）。目标不存在或调用失败 SHALL 给人话错误提示。本操作 MUST NOT 产生任何文件系统变更。

#### Scenario: 定位文件

- **WHEN** 用户对条目选择「在 Finder 中显示」
- **THEN** 后端命令成功返回，系统文件管理器被调起定位该条目；vault 内容不变

### Requirement: 目录下新建

目录行菜单「新建文件」「新建子目录」SHALL 以内联编辑形态（与内联重命名同一形态与校验规则）
收集名称，提交后经后端命令创建。创建 SHALL 使用原子语义（撞名即拒绝，MUST NOT 覆盖）。
新建文件 SHALL 为空文件，创建成功 SHALL 自动打开（Markdown 进 md 编辑模式，其余按既有打开
分类）。新建子目录 MUST NOT 强制展开父目录。

#### Scenario: 新建并打开 Markdown

- **WHEN** 用户在目录 `sub` 上新建文件输入 `note.md` 并 Enter
- **THEN** 磁盘出现空文件 `sub/note.md`，树经 watcher 回响出现该条目，编辑器打开它（md 模式）

#### Scenario: 新建撞名拒绝

- **WHEN** 新名称与既有条目同名
- **THEN** 创建被拒绝并给出原因，既有条目逐字节不变
