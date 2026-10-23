# quick-open 增量规格

> 起草注记（非规格正文）：本 delta 新建 capability `quick-open`——按路径快速打开文件（Emacs
> `C-x C-f` 形态：快捷键拉出一个路径输入面，也接受粘贴的完整路径与 `{path}:{line}`）。设计见
> [design.md](../../design.md)，裁决背景与五个起草期取值见 [proposal.md](../../proposal.md)。
> 本 capability 只回答「输入一条路径 → 打开哪个文件、落在哪一行」；键位层的合同在
> [keymap-commands delta](../keymap-commands/spec.md)（命令 id、默认键位与三条来源核对），打开落点
> 与标签语义在 `multi-tabs` 的「打开语义」，vault 外读取的命令边界在 `fs-io` 的「vault 外只读
> 读取通道」。
>
> 第 5 条 requirement 按 **D2 = 倾向侧（vault 外只读放行）** 书写。D2 若裁另一侧，该条改写为
> 「vault 外路径 SHALL 被拒绝并给人话提示」，其余四条不动。

## ADDED Requirements

### Requirement: 快速打开的唤起与输入面

快速打开 SHALL 由统一键位表分发的**一条**全局命令 `app.quick-open` 唤起，MUST NOT 存在第二条
分发通路（裸 window 监听、编辑器 keymap、原生菜单项一律不得承担同一动作）。命令实现 SHALL 落在
装配层。命令被触发时：

- 未装载 vault ⇒ SHALL 给人话提示且 MUST NOT 打开输入面（没有候选可言，空浮层只会误导）；
- 输入面已打开 ⇒ SHALL 收起（同一条命令承担开与关，与既有 `toc.toggle` 同款）；
- 否则 ⇒ SHALL 打开输入面。

输入面 SHALL 挂在 modeline 上沿并向上展开（与既有 `.lumir-toc` / `.lumir-goto` 同一挂点与同一
几何手法），SHALL 含一个单行输入框、一份候选列表与一行提示。输入框 SHALL 在打开时持有焦点；
输入框 SHALL 是真实的可编辑宿主（`input` 元素）——输入法组合事件只投向这类宿主，用 `div` 冒充
会让中文查询串打不进来（既有浮层的同款判据）。列表 SHALL 声明 `listbox` 语义，游标经持焦元素上的
`aria-activedescendant` 报出，MUST NOT 把该属性留在列表上。

输入面自己的键（`Enter` / `Escape` / `⌃G` / `↑` / `↓` / `⌃N` / `⌃P`）MUST NOT 进统一键位表：
输入框持焦时事件目标在浮层里，`editor` / `text` 作用域的绑定不命中，这些键 SHALL 由输入面就地
消费（`preventDefault` 同时是分发表让路的信号）。MUST NOT 因此新增旁路绑定。

关闭 SHALL 覆盖四条路径：`Escape` / `⌃G`、焦点离开输入面、点击输入面之外的区域、成功打开之后。
全部关闭路径 MUST NOT 改变打开前后的阅读位置；把焦点交还编辑器时 SHALL 走既有的「交还焦点且
保持阅读位置」入口（MUST NOT 裸调 `view.focus()`，见
[overlay-close-reading-position.md](../../../../../docs/design-parity-contract/overlay-close-reading-position.md)
的 CL-1）。前台会话发生切换（切标签 / 被外部打开请求置换）时输入面 SHALL 收起且 MUST NOT 打开
任何文件——输入串指向的是切换前那一刻的上下文。

打开输入面 MUST NOT 改动任何文档、撤销栈、dirty 状态或写盘。

#### Scenario: 快捷键打开与再按收起

- **WHEN** 焦点在编辑器内按 `⌘P`
- **THEN** 输入面出现在 modeline 上沿、输入框持焦且为空；再按一次 `⌘P` 输入面收起，阅读位置与
  选区逐值不变

#### Scenario: 焦点在三处时都能唤起

- **WHEN** 焦点分别在编辑器内容区、文件树条目、harness composer 内各按一次 `⌘P`
- **THEN** 三处都打开输入面（命令作用域为 `global`，与焦点无关）

#### Scenario: 未装载 vault 时不打开空浮层

- **WHEN** 应用尚未装载任何 vault 时按 `⌘P`
- **THEN** 出现一句人话提示，输入面不出现

#### Scenario: 取消与焦点交还

- **WHEN** 输入面已打开、输入框里有内容，分别按 `Escape`、按 `⌃G`、点击编辑器区域
- **THEN** 三次都收起输入面、不打开任何文件；焦点回到编辑器，且正文阅读位置与打开前逐值相同
  （CL-1）

#### Scenario: 前台会话切换时收起

- **WHEN** 输入面打开期间按 `⌘1` 切到另一个标签
- **THEN** 输入面收起且不打开任何文件

### Requirement: 输入解析——路径优先与行号后缀

输入串 SHALL 按下列次序解析（次序本身是合同的一部分，实现 MUST NOT 重排）：

1. `trim` 首尾空白（单行输入框已剥掉换行）；
2. 归一化：以当前 vault 根为前缀的绝对路径 SHALL 被收敛为 vault 相对路径（前缀比对 SHALL 容忍
   大小写差异——否则一个大小写不同的根前缀会让 vault 内文件被误判成 vault 外）；`./` 前缀 SHALL
   被剥除；含反斜杠的串 SHALL 不命中（本仓路径分隔符只有 `/`）；空串不解析；
3. **整串优先**：输入串整体作为一个 vault 内路径判定存在性，命中即打开该文件且**不带行号**；
4. 整串不命中且尾部是合法行号后缀 ⇒ 剥掉后缀再判定：命中则打开并落到后缀的**起始行**；
5. 整串不命中且不是合法后缀形态 ⇒ 按「找不到」处置。

行号后缀的语义 SHALL 与既有 `{path}:{行}` / `{path}:{行}:{列}` / `{path}:{起}-{止}` 的实现**同
一份**（`src/harness-path-link.ts` 的 `LINE_SUFFIX` 语义）：`列` 与 `止` 只参与「后缀是否成立」，
MUST NOT 参与落点（落点恒为起始行）；`止 < 起`、缺段、三段（`9-12-15`）、`:0`、后缀后紧跟 ASCII
路径延续字符（`:12x` / `:12/5`）一律使**整个**后缀不成立。本 change MUST NOT 复制第二份后缀
解析实现。

**整串优先是硬要求**：文件名里允许出现冒号，正则优先的解析会把 `v1:2.md` 拆成路径 `v1` + 行 2，
让这个文件永远打不开——失败形态是「看起来正常、个别文件找不到」，属于最难归因的一类。

存在性判定 SHALL 复用既有能力：vault 文件索引命中 ⇒ 存在；索引不含该路径时 SHALL 经既有的
批量存在探测（`fs_paths_exist`）兜底——被忽略规则挡在枚举结果之外、但在 vault 内的文件因此仍可
按精确路径打开。

大小写：逐字精确命中优先；无精确命中时 SHALL 按大小写折叠做一次等值回退（macOS 文件系统默认
大小写不敏感，从 Finder 复制的路径大小写未必与磁盘一致）；折叠命中多条时 MUST NOT 猜，SHALL 转为
列出候选。

上述次序对 **vault 外绝对路径**逐条同构（MUST NOT 为外部路径另立一套解析次序）：整串命中即只读
打开该文件（不带行号）；整串不成立时**同样**剥尾部行号后缀再判定，命中则只读打开并落到起始行——
`/tmp/x/notes.md:12` 因此与 vault 内的 `notes/plan.md:12` 是同一种输入，区别只在打开后的只读语义。

解析到**目录**时 MUST NOT 打开（本 capability 不做目录浏览）：SHALL 在提示行给出原因。
解析不到任何文件时 MUST NOT 创建文件（新建能力不在本 capability，MUST NOT 落盘），输入内容 SHALL
保留、提示行给出原因。

#### Scenario: 粘贴带行号的路径一次落行

- **WHEN** vault 内存在 `apps/api/package.json`，用户粘贴 `apps/api/package.json:71` 并按 Enter
- **THEN** 该文件被打开并激活标签，第 71 行滚入视口居中；文档内容逐字节不变、不产生 dirty

#### Scenario: 文件名含冒号不被拆开

- **WHEN** vault 内存在文件 `notes/v1:2.md`，用户输入 `notes/v1:2.md`
- **THEN** 打开的是 `notes/v1:2.md`（整串命中优先），MUST NOT 被解释为路径 `notes/v1` + 第 2 行

#### Scenario: 绝对路径收敛为相对路径

- **WHEN** vault 根为 `/v`、vault 内存在 `notes/plan.md`，用户粘贴 `/v/notes/plan.md:12`
- **THEN** 打开 `notes/plan.md` 并落到第 12 行（与输入 `notes/plan.md:12` 结果相同）

#### Scenario: 畸形后缀整段不成立

- **WHEN** vault 内存在 `notes/plan.md`，用户分别输入 `notes/plan.md:12-`、`notes/plan.md:40-12`、
  `notes/plan.md:9-12-15`、`notes/plan.md:0`
- **THEN** 四次都按「找不到」处置（后缀整段不成立、整串也不是一个存在的路径），
  MUST NOT 打开文件、MUST NOT 落到任何行

#### Scenario: 大小写不一致仍能打开

- **WHEN** vault 内存在 `notes/plan.md`，用户输入 `NOTES/PLAN.md`
- **THEN** 折叠等值唯一命中 ⇒ 打开 `notes/plan.md`；若折叠后命中多条，则列出候选而不打开

#### Scenario: 惰性目录里的文件按精确路径可打开

- **WHEN** vault 的 `.gitignore` 声明了 `.local/`（其条目不在装载枚举结果里），用户输入
  `.local/notes.md`
- **THEN** 经存在探测判定存在后打开该文件（候选列表里找不到它，但精确路径可开）

#### Scenario: 目录与不存在的路径

- **WHEN** 用户输入一个 vault 内**目录**的路径；随后改输一个不存在的文件路径
- **THEN** 前者提示「这是目录」、不打开；后者提示「找不到」、不创建任何文件；两次输入框的内容都
  保留，用户可继续修改

### Requirement: 候选列表与匹配语义

输入串非空、且既未命中 vault 内路径、也不是一个可打开的 vault 外绝对路径时，输入面 SHALL 显示
候选列表。候选来源 SHALL 是**当前 vault 的文件索引**（与 harness 路径链接、附件解析共用同一份
内存索引）；MUST NOT 另建索引、MUST NOT 跨 vault 检索。

匹配语义 SHALL 与既有浮层筛选**同一份实现**（`src/list-filter.ts` 的大小写折叠子串包含）：
匹配对象 SHALL 是文件的**完整 vault 相对路径**（不是仅文件名——粘贴的路径片段如
`changes/x/spec.md` 因此可命中）；结果 SHALL 保持索引顺序，MUST NOT 重排、MUST NOT 打分、MUST NOT
做命中高亮。MUST NOT 引入模糊 / 子序列匹配或任何第二套匹配口径。

查询为空时 MUST NOT 列出全量候选（大 vault 上是一次无意义的整表渲染）：SHALL 只给一行用法提示。
候选的渲染条数 SHALL 有上限（100 条），命中总数超过上限时提示行 SHALL 显示总数并说明只显示前
100 条——上限是渲染成本闸，MUST NOT 影响匹配结果本身。

输入法组合期间 MUST NOT 刷新候选（组合期的中间串必然零命中，刷新只会闪一下）；组合结束后 SHALL
补一次刷新。

选中一条候选（Enter 或点击）SHALL 直接打开该文件，**不再**经过路径解析（候选的路径已由索引
校验）。Enter 与鼠标点击 SHALL 落在**同一个**游标状态上——MUST NOT 让键盘游标与鼠标点击各持一份
选中行。

候选只覆盖索引里的文件：目录、以及被忽略规则挡在枚举结果之外的惰性条目 MUST NOT 出现在候选里
（已知边界：它们只能按精确路径打开）。

#### Scenario: 按路径片段筛出候选

- **WHEN** vault 内存在 `openspec/changes/x/spec.md` 与 `notes/spec.md`，用户输入 `changes/x`
- **THEN** 候选列表只出现第一条（完整相对路径的子串命中），顺序与索引一致、不打分

#### Scenario: 空查询不列全量

- **WHEN** 打开输入面、输入框为空
- **THEN** 列表为空并显示一行用法提示，MUST NOT 渲染整个 vault 的文件列表

#### Scenario: 命中超过上限时显示总数

- **WHEN** 输入一个在 vault 里命中 300 条文件的查询
- **THEN** 列表最多渲染 100 条，提示行显示命中总数并说明只显示前 100 条；游标移动不越过第 100 条

#### Scenario: 选中候选即打开

- **WHEN** 候选列表里有若干条命中，用户用 `↓` / `⌃N` 移到第 2 条后按 Enter
- **THEN** 打开该条对应的文件（与鼠标点击同一行的结果相同），输入面收起

### Requirement: 打开落点与行跳转

快速打开的落点 SHALL 与文件树点击**同一条**：在活跃 pane 打开一个**新标签**并激活；
MUST NOT 顶掉任何已打开的标签。目标文件已经在某个 pane 打开时 SHALL 执行既有的「移动标签并
激活」（不产生第二个标签、MUST NOT 复制 EditorState）。

打开 SHALL 走应用内唯一的打开链路与唯一的文件分类判据（`openFile` / `openKind`）——图片文件走
既有图片标签、二进制文件给既有「暂不支持预览」提示，MUST NOT 为快速打开另立一套分类或装载通道。

带行号时，打开成功后 SHALL 把目标行滚入视口居中，并复用既有行跳转的**同一份**落点算式与
「打开 → 转场窗口内落点 → 下一帧复核补发」编排（MUST NOT 另写行号 → 位置 → 滚动的换算，MUST NOT
另写下一帧复核判据）：越界行号 SHALL 静默钳制到 `[1, 文档总行数]`（既有钳制口径：越界不报错、
停在边界）。无行号时 MUST NOT 触碰视口（打开动作本身不滚动）。

打开成功后输入面 SHALL 关闭并把焦点交还活跃 pane 的编辑器（无行号走「交还焦点且保持阅读位置」的
既有入口，带行号走既有「先交还焦点再落点」的那条路径）——焦点 MUST NOT 落回文档 body，否则紧接着
的键入无人接收。

打开失败（读取失败 / 目标在打开瞬间消失 / 二进制不支持）SHALL 给人话提示，MUST NOT 留下空标签，
输入面 SHALL 保持打开、输入内容保留以便改正——MUST NOT 在发起打开之前就无条件关闭输入面。

#### Scenario: 快速打开新文件开一个标签

- **WHEN** 活跃 pane 的标签栏里已有 A，用户快速打开一个未打开的文件 B
- **THEN** 活跃 pane 新开一个指向 B 的标签并激活，A 的标签保留（位置不变，仍可切回）

#### Scenario: 打开已在他 pane 打开的文件

- **WHEN** 目标文件已在**另一个** pane 的标签里，用户快速打开它
- **THEN** 标签带其 EditorState 与滚动位置迁到活跃 pane 并激活，标签总数不变，源 pane 不再有该
  标签

#### Scenario: 行号越界钳制

- **WHEN** 目标文件共 40 行，用户粘贴 `path:9999`
- **THEN** 文件被打开、光标停在第 40 行行首，不报错、不提示

#### Scenario: 打开后焦点落在编辑器上

- **WHEN** 用快速打开打开一个文件（不带行号）并按 Enter
- **THEN** 输入面关闭，焦点在编辑器内容区（随后键入的字符落进文档），MUST NOT 出现「按键无人接收」
  的状态

#### Scenario: 图片与二进制的既有分类

- **WHEN** 快速打开一个 vault 内的 `png` 文件；随后快速打开一个 `pdf` 文件
- **THEN** 前者进入既有图片查看面（图片标签），后者给既有「暂不支持预览」提示；两者都不经过
  文本装载链路

### Requirement: vault 外文本文件的只读打开

当输入解析出一个**不落在当前 vault 内**的绝对路径时（D2 倾向侧），系统 SHALL 以**只读**方式在
内容区打开该文件，并 SHALL 在界面上标明它来自 vault 外且不可编辑。

只读 SHALL 是**结构性只读**：由编辑器可编辑性本身拒收键入 / 粘贴 / 输入法合成 / 拖放文本
（MUST NOT 用「可编辑面在场、按键被吞」冒充）。该会话 SHALL NOT：

- 写入任何文件（`⌘S` 无落点，MUST NOT 出现保存失败提示）；
- 产生未保存状态（dirty 恒假），MUST NOT 拦住切换 vault / 退出；
- 登记磁盘 revision、写崩溃备份；
- 参与 vault 的变更监听（外部改写不提示、不自动重载）；
- 记录或恢复阅读位置；
- 进入按 vault 持久化的标签列表（重启后不恢复，见 `vault-workspace` 的该条 requirement）。

外部会话的文档内 wikilink / 相对路径链接 MUST NOT 被解析（解析基准是 vault 相对路径，外部文档
没有这个基准）；链接保持原样、不可激活。

读取 SHALL 经**一条**专用的后端命令，其校验 MUST 在 Rust 侧完成（MUST NOT 由 webview 保证）：
入参必须是绝对路径、不得含 `..` 段、归一化（跟随符号链接）后必须是**常规文件**、大小不超过既有
的文本读取上限（50MB，与 vault 内文本读取同一常量）、非合法 UTF-8 时返回与 vault 内读取**同一组**
错误码。该命令 MUST NOT 列举目录、MUST NOT 通配、MUST NOT 递归、MUST NOT 写入；调用 MUST 只由
用户的显式路径输入触发（MUST NOT 用于自动扫描 / 批量 / 后台任务）。

带行号后缀时（如 `/tmp/x/notes.md:12`），外部文件 SHALL 与 vault 内文件走**同一条**落点编排：
打开成功后把起始行滚入视口居中，越界行号静默钳制到 `[1, 文档总行数]`（复用既有 `revealLine` 与
「下一帧复核」编排，MUST NOT 另写一套）。只读不因带行号而放宽。

目标不存在、是目录、超限或不是文本类时 SHALL 给人话提示，MUST NOT 打开空标签。同一外部绝对路径
再次打开 SHALL 切到既有标签（与 vault 内同一条去重语义）。外部**图片 / 二进制**文件 MUST NOT 被
本能力打开（提示不支持）。

#### Scenario: 粘贴 vault 外路径只读打开

- **WHEN** vault 为 `/v`，用户粘贴 `/tmp/notes/draft.md`（vault 外、存在）
- **THEN** 内容区打开该文件并激活一个新标签，可读可滚动；界面上有「vault 外 · 只读」标记

#### Scenario: vault 外绝对路径带行号落到起始行

- **WHEN** 用户粘贴 `/tmp/x/notes.md:12`（vault 外、存在、至少 12 行）并按 Enter
- **THEN** 该文件以只读方式打开（与不带行号的同一份文件是同一条只读语义），第 12 行滚入视口居中；
  文档内容逐字节不变、不产生 dirty、`⌘S` 无落点

#### Scenario: vault 外路径的后缀畸形整段不成立

- **WHEN** 用户粘贴 `/tmp/x/notes.md:0` 与 `/tmp/x/notes.md:12-`
- **THEN** 两次都按「找不到」处置（后缀整段不成立、整串也不是一个存在的路径），MUST NOT 打开文件、
  MUST NOT 落到任何行、MUST NOT 创建任何文件

#### Scenario: 只读面拒收输入且保存无落点

- **WHEN** 外部只读标签在前台时键入字符、粘贴文本、按 `⌘S`
- **THEN** 文档内容逐字节不变、不产生 dirty、不出现保存提示、不产生任何写盘调用

#### Scenario: 外部标签不入持久化且不参与监听

- **WHEN** 打开一个外部只读标签后退出应用并重启；另在应用运行期间于外部编辑器中改写该文件
- **THEN** 重启后该标签不恢复（标签列表与打开前一致）；运行期间不出现外部变更提示、文档内容
  保持打开时的快照

#### Scenario: 外部路径的失败面

- **WHEN** 用户粘贴一个 vault 外的目录路径、一个不存在的绝对路径、一个超过 50MB 的文本文件
- **THEN** 三种情形都给对应的人话提示（是目录 / 找不到 / 超过大小上限），不打开空标签，输入内容
  保留

#### Scenario: 既有 vault 内接口的约束不被放宽

- **WHEN** 以 `../../etc/passwd` 或一个 vault 外绝对路径调用既有的 vault 内读取接口
- **THEN** 仍返回路径越界错误（`fs-io`「vault 内路径约束」逐字不变）；外部读取只经新增的专用命令
