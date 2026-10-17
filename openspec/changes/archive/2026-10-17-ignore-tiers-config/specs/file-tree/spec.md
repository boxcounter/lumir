# file-tree 增量规格

> 起草注记（非规格正文）：本 delta 三条 MODIFIED，基线是 living spec
> [openspec/specs/file-tree/spec.md](../../../../../specs/file-tree/spec.md)。变化有两点：① 树的可见集里
> 「被内置规则挡住的名字不出行」改为「被 `hidden` 档挡住的名字不出行」，而 `lazy` 档（默认
> `node_modules` / `target` / `dist` 等 14 名）与用户规则一致——出惰性行、可展开；② 内联编辑与新建的
> 忽略集判定改由后端权威判定（前端不再维护名单副本），前端只保留形状校验与结果回显。
>
> **节点 1 裁决（2026-10-17）**：`.git` 恒护栏被拒绝——树侧不新增任何名字级保护；后端拒绝名字时
> 只是把原因回显到行内 / toast（既有通道）。键名取 `hidden` / `lazy`。

## MODIFIED Requirements

### Requirement: 全类型文件树展示

系统 SHALL 在 app-shell 的侧栏（宽 236px，见 ui-design-system「应用骨架布局」）挂载文件树，展示当前 vault 的全类型条目（目录可折叠，默认排序：目录在前、同缀按名称）。条目 SHALL 显示文件名与类型区分（至少区分目录 / Markdown / 图片等可预览附件 / 其他）。树的行形态 SHALL 取 design tokens：行高 25px、层级缩进 `8px + 14px × 层深`、选中态底色 `--sel`、hover 底色 `--hover`；eink 主题下选中态 SHALL 为黑底反白，行内次级元素（徽标 / ghost 项）SHALL 同步反白（eink 降级规则 ④）。树的数据来源 SHALL 为 fs-io 的枚举结果、按需枚举结果（`fs_scan_dir`，见 fs-io「按需枚举目录」）与 watch 增量事件，webview MUST NOT 直接访问文件系统（ADR 0002 §3）。

**可见集 SHALL 包含惰性条目**：被 vault 自己的 VCS 忽略声明（用户规则）命中的目录与文件、以及命中 fs-io **惰性档**（`vault.lazy`，默认含 `node_modules` / `target` / `dist` / `test-results` 等 14 名）的目录与文件，SHALL 与普通条目一样出现在树里（同一行形态、可折叠 / 可点开、可右键），MUST NOT 因为「不在装载时的枚举结果里的深层」而被隐藏或渲染成不可用。惰性目录的子孙不在装载结果里，SHALL 在**用户展开时**经 `fs_scan_dir` 取回一层并合并进树模型；树 MUST NOT 把一个尚未取回子孙的惰性目录渲染成**空目录**（两种状态在模型里必须可区分——fs-io 的惰性标记即此用途），MUST NOT 因为取数在途而阻塞界面（ADR 0002 §6）。被 fs-io **不显示档**（`vault.hidden`，默认 `.git` / `.DS_Store`，另含恒定临时文件模式）挡住的名字不出现在树里（口径见 fs-io「全类型递归枚举」），且这必须靠**单一真源**保证：这些名字的增量事件在 fs-io 侧就被挡下（fs-io「watch 增量事件流」的组件判定），树侧 MUST NOT 依赖自己的一份名单做二次过滤（前端没有、也不该有第二份忽略名单）。

惰性条目的可见性 MUST NOT 被读成「它已进索引」：链接解析与附件索引只覆盖主动枚举的条目（见 fs-io 的确定性条款）。

#### Scenario: 全类型混合展示

- **WHEN** vault 含 md、代码、图片、嵌套目录
- **THEN** 文件树全部展示并正确区分类型，不只展示 Markdown

#### Scenario: 行形态与层级缩进

- **WHEN** 展开三层嵌套目录并选中其中一个文件
- **THEN** 各行高 25px，缩进按 `8px + 14px × 层深` 逐级递增；选中行取选中态底色（eink 下黑底反白）

#### Scenario: 被忽略规则挡住的目录与文件仍然可见

- **WHEN** vault 根的 `.gitignore` 声明 `.local/`（磁盘上有 `.local/tutorial.md`），用户打开该 vault
- **THEN** 树里出现 `.local` 行（与普通目录同一行形态），展开后出现 `tutorial.md`，点开可读到正文

#### Scenario: 惰性档名字出现在树里且可展开

- **WHEN** 默认配置下 vault 根有 `node_modules/` 与 `target/`
- **THEN** 树里出现 `node_modules` 与 `target` 两行（惰性行，与普通目录同一行形态）；展开其中一行后，其直接子条目出现在树里；未展开时 MUST NOT 渲染成空目录

#### Scenario: 惰性目录不被渲染成空目录

- **WHEN** 用户展开一个惰性目录而取数尚在途中
- **THEN** 该目录 MUST NOT 呈现为「没有子条目的空目录」（展开态与空态在树模型里由惰性标记区分），界面不被阻塞；取回后子条目按排序规则并入

#### Scenario: 内置规则名字不出现在树里

- **WHEN** vault 根含 `.git/`（即使 `.gitignore` 里写了 `!.git/` 把它取反）
- **THEN** 树里没有 `.git` 的行（与今日行为一致；不显示档不可被用户规则的取反推翻）

### Requirement: 条目内联重命名

菜单「重命名」SHALL 把该条目行名就地替换为输入框（树内联编辑，MUST NOT 使用模态对话框）。
Enter 提交、Esc 或失焦取消。末段名 SHALL 校验：非空、不含 `/`、不是 `.`/`..`、不与既有同缀条目同名；非法 SHALL 行内标红并给出原因，MUST NOT 提交。**忽略集判定（fs-io 的 `hidden` 档，含恒定临时文件模式；以及 `lazy` 档 / 用户规则名不被拒绝）MUST 由后端在提交时权威判定**：前端 MUST NOT 维护第二份忽略名单，后端返回 `fs_name_invalid` 时 SHALL 把其后端原因回显在该编辑行内（沿用既有失败通道），并保持编辑态。提交 SHALL 经后端命令完成同目录改名；撞名 MUST NOT 覆盖既有条目。编辑期间该行的打开/折叠/右键交互 SHALL 抑制，其余条目不受影响。

#### Scenario: 正常改名

- **WHEN** 用户对文件 `a.md` 发起重命名，输入 `b.md` 并 Enter
- **THEN** 树中该条目显示为 `b.md`（经 watcher 回响收敛），磁盘上完成改名

#### Scenario: 撞名拒绝

- **WHEN** 目标名与同目录既有条目同名
- **THEN** 改名被拒绝、行内给出原因，既有同名条目内容不变

#### Scenario: 忽略集名拒绝

- **WHEN** 用户输入 `.DS_Store` 作为新名
- **THEN** 后端拒绝（`fs_name_invalid`），树里该编辑行标红并显示后端原因；磁盘与树均不变

#### Scenario: 惰性档名允许

- **WHEN** 用户把某文件改名为 `target`（默认配置下属惰性档）
- **THEN** 改名成功，树里出现一行惰性条目（该名字可见、可打开，只是不进索引）

### Requirement: 目录下新建

目录行菜单「新建文件」「新建子目录」SHALL 以内联编辑形态（与内联重命名同一形态与校验规则）
收集名称，提交后经后端命令创建。创建 SHALL 使用原子语义（撞名即拒绝，MUST NOT 覆盖）。
新建文件 SHALL 为空文件，创建成功 SHALL 自动打开（Markdown 进 md 编辑模式，其余按既有打开
分类）。新建子目录 MUST NOT 强制展开父目录。忽略集判定与内联重命名同口径：由后端权威判定，前端 MUST NOT 维护第二份忽略名单；命中 fs-io 不显示档的名字 SHALL 被拒绝并把原因回显到编辑行，命中惰性档或用户规则的名字 MUST NOT 被拒绝（建出来的条目随该名字 / 目录呈惰性）。

#### Scenario: 新建并打开 Markdown

- **WHEN** 用户在目录 `sub` 上新建文件输入 `note.md` 并 Enter
- **THEN** 磁盘出现空文件 `sub/note.md`，树经 watcher 回响出现该条目，编辑器打开它（md 模式）

#### Scenario: 新建撞名拒绝

- **WHEN** 新名称与既有条目同名
- **THEN** 创建被拒绝并给出原因，既有条目逐字节不变

#### Scenario: 新建惰性档名字成功

- **WHEN** 用户在 vault 根新建目录并输入 `dist`（默认配置下属惰性档）
- **THEN** 创建成功，树里出现 `dist` 惰性行；展开后可见其（空）子条目
