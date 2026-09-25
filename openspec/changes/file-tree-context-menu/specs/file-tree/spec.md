# file-tree 增量规格

## ADDED Requirements

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
