# file-tree 增量规格

> 起草注记（非规格正文）：本 delta 一条 ADDED，基线是 living spec
> [openspec/specs/file-tree/spec.md](../../../../../specs/file-tree/spec.md)。既有「条目右键菜单」与
> 「目录下新建」两条 requirement 逐字不动——本增量只补**vault 根**这个没有行元素的入口，并明确它
> 与拖拽落点共用「不在任何条目行带内」这一条既有判据（M538 已把树头部与列表尾部空白定义为
> vault 根）。形态、命中面取值与项集取舍见 [design.md](../../design.md) §3 与 §4 的 D4 / D5。
>
> 第二条是 MODIFIED：`全类型文件树展示` 的首段把侧栏宽度写成了「宽 236px」——那是
> `ui-design-system`「应用骨架布局」拥有的事实，本 change 让它变成「可调、默认 236」，因此就地把这
> 句引用改成不再复述具体数值（REVIEW.md『设定类现状断言只读了 requirement 的一句话』条：living spec
> 里一句过时的旧话就是下一次误引用的入口）。该 requirement 其余段落与场景逐字不变。

## ADDED Requirements

### Requirement: vault 根的新建入口

指针落在文件树的**非条目行区域**时，右键 SHALL 弹应用内自绘的**根级菜单**（同一套菜单皮肤与键盘
导航：↑↓ / ⌃N / ⌃P 导航、Enter 触发、Esc 或点击外部关闭、打开即持焦点），并 SHALL 拦下 webview
的默认页面菜单。该区域的判据 SHALL 与拖拽落点「vault 根」的既有判据**同源**——「指针不在任何条目
行的行带内」，实现上 MUST NOT 为右键另写一套几何命中；范围 SHALL 覆盖树头部（vault 名那一行）与
列表尾部之下的空白两处。

根级菜单的项集 SHALL 只含「新建文件」与「新建子目录」两条（无破坏性项、无分隔线），MUST NOT 含
重命名 / 复制路径 / 在系统文件管理器中显示 / 移到废纸篓（这些以条目为对象，根不是条目）；也
MUST NOT 提供「重新载入 / 刷新」类动作——文件树由 watch 增量维护，产品侧没有需要手工刷新的状态，
webview 默认菜单里的 Reload 属页面刷新，不构成本能力的项。

选中的新建动作 SHALL 走与目录行「新建文件 / 新建子目录」**同一条**链路：以内联编辑形态收集名称、
后端命令权威创建（撞名拒绝、MUST NOT 覆盖）、忽略集判定由后端作出；新建文件成功 SHALL 自动打开
（Markdown 进 md 模式，其余按既有打开分类），新建子目录 MUST NOT 强制展开任何目录。根级菜单的
动作 MUST NOT 新增第二套创建路径或第二份忽略名单。

打开与关闭根级菜单 MUST NOT 改变当前打开文件、标签状态与树里的当前行标记；关闭后焦点 SHALL 归还
树头部的 vault 名入口（根没有行元素，取最近的等价锚点）。未装载 vault 时树容器不在场，因此
MUST NOT 出现根级菜单（空态右键不产本能力的任何动作）。

#### Scenario: 树头部右键出现根级菜单

- **WHEN** 已装载 vault，用户在树头部（显示 vault 名的那一行）按下右键
- **THEN** 出现自绘菜单，项集为「新建文件 / 新建子目录」两条；不出现重命名 / 复制路径 / 移到废纸篓 /
  Reload；webview 默认菜单被拦下

#### Scenario: 列表尾部空白右键同口径

- **WHEN** 列表比 pane 短、用户在下方的空白区域按下右键
- **THEN** 与树头部右键完全同形：同一菜单、同一项集、同一落点（vault 根）

#### Scenario: 在 vault 根新建文件并自动打开

- **WHEN** 在根级菜单选「新建文件」，输入 `note.md` 并回车
- **THEN** 磁盘出现根下空文件 `note.md`，树经 watcher 回响出现该行，编辑器以 md 模式打开它；
  树里的当前行标记与标签状态在菜单打开期间不被改变

#### Scenario: 在 vault 根新建目录不展开

- **WHEN** 在根级菜单选「新建子目录」，输入 `notes` 并回车
- **THEN** 根下出现 `notes` 目录行（未展开），当前打开文件与标签不变

#### Scenario: 条目行右键行为不变

- **WHEN** 用户右键一个条目行
- **THEN** 仍为既有的条目菜单（文件行 / 目录行各自的项集），不出现根级菜单；根级入口的存在不改变
  行菜单的任何项与顺序

#### Scenario: 撞名拒绝走同一链路

- **WHEN** 在根级菜单新建一个与根下既有条目同名的文件
- **THEN** 创建被拒绝并把原因回显到内联编辑行（与目录行新建的撞名拒绝逐条相同），既有条目逐字节不变

## MODIFIED Requirements

### Requirement: 全类型文件树展示

系统 SHALL 在 app-shell 的侧栏（宽度口径见 ui-design-system「应用骨架布局」）挂载文件树，展示当前 vault 的全类型条目（目录可折叠，默认排序：目录在前、同缀按名称）。条目 SHALL 显示文件名与类型区分（至少区分目录 / Markdown / 图片等可预览附件 / 其他）。树的行形态 SHALL 取 design tokens：行高 25px、层级缩进 `8px + 14px × 层深`、选中态底色 `--sel`、hover 底色 `--hover`；eink 主题下选中态 SHALL 为黑底反白，行内次级元素（徽标 / ghost 项）SHALL 同步反白（eink 降级规则 ④）。树的数据来源 SHALL 为 fs-io 的枚举结果、按需枚举结果（`fs_scan_dir`，见 fs-io「按需枚举目录」）与 watch 增量事件，webview MUST NOT 直接访问文件系统（ADR 0002 §3）。

**可见集 SHALL 包含惰性条目**：被 vault 自己的 VCS 忽略声明（用户规则）命中的目录与文件、以及命中 fs-io **惰性档**（`vault.ignore` 里档位为 `"lazy"` 的名字，默认含 `node_modules` / `target` / `dist` 等 12 名）的目录与文件，SHALL 与普通条目一样出现在树里（同一行形态、可折叠 / 可点开、可右键），MUST NOT 因为「不在装载时的枚举结果里的深层」而被隐藏或渲染成不可用。惰性目录的子孙不在装载结果里，SHALL 在**用户展开时**经 `fs_scan_dir` 取回一层并合并进树模型；树 MUST NOT 把一个尚未取回子孙的惰性目录渲染成**空目录**（两种状态在模型里必须可区分——fs-io 的惰性标记即此用途），MUST NOT 因为取数在途而阻塞界面（ADR 0002 §6）。被 fs-io **不显示档**（`vault.ignore` 里档位为 `"hidden"` 的名字，默认 `.git` / `.DS_Store`，另含恒定临时文件模式）挡住的名字不出现在树里（口径见 fs-io「全类型递归枚举」），且这必须靠**单一真源**保证：这些名字的增量事件在 fs-io 侧就被挡下（fs-io「watch 增量事件流」的组件判定），树侧 MUST NOT 依赖自己的一份名单做二次过滤（前端没有、也不该有第二份忽略名单）。名单的具体内容 MUST NOT 在树侧硬编码：默认 lazy 档自 2026-10-18 起不再含 `test-results` / `perf-results`，这类名单变动只改 fs-io 的默认地图，树的行为随「惰性标记」自动跟随。

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

