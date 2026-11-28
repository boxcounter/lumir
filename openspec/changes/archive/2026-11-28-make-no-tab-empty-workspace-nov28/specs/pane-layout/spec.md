# pane-layout 增量规格

> 起草注记（非规格正文）：本 change 把「无 Tab」收敛为空工作区。旧的「分栏态空 pane 不接受文本
> 输入」与「无标签文档 pane 的空态呈现」两条整条移除（改名 / 合并通道 = REMOVED + ADDED）。
> Alex 2026-11-28 进一步裁决：空态不再有 Open / New 按钮，首启与普通 / 双 pane 共用同一组
> Lumir 特有 tips；焦点由静态 region 承接，不为留焦点伪造按钮。

## REMOVED Requirements

### Requirement: 分栏态空 pane 不接受文本输入

整条移除，由下面的「无标签文档 pane 的空工作区」承接：无路径会话恒为结构性只读（单 pane 与
分栏同一条规则），「dirty 草稿豁免」「单 pane 空态 scratch 不受此限」等分叉全部失去对象。

### Requirement: 无标签文档 pane 的空态呈现

整条移除并合入同一条新 requirement：行号、结构性只读、首启 tips、老用户空 vault 覆盖层不再是
四条并列的呈现条款，而是同一个空工作区的四个面。

## ADDED Requirements

### Requirement: 无标签文档 pane 的空工作区

任一文档 pane 没有**带路径标签**（`hasTabs=false`，与标签条 `visibleTabsOf` 同一定义）时，该 pane
SHALL 呈**空工作区**，MUST NOT 呈一份可编辑文档：

- **无隐式文档**：空工作区 MUST NOT 有可编辑正文，MUST NOT 接受键入、粘贴、输入法合成与拖放文本，
  MUST NOT 产生未保存修改或保存落点。无路径会话只作为内部占位，SHALL 结构性只读：
  `editable=false`（视图层与 changeFilter 双层拒收）且不画 CM 插入光标。被空态覆盖的编辑器宿主
  SHALL 为 `inert`，同时移出 Tab 序、程序焦点与辅助技术树；有文档后同一同步点恢复。
- **共享呈现**：首启、普通无 Tab、空 vault 与双 pane SHALL 使用同一块 `workspace-tips` 内容，顺序
  固定为 Outline、Quote to chat、Knowledge links、Harness pane，各有一句说明；只允许这四条。
  Outline 与 Harness 的键位 SHALL 从默认绑定表派生，Quote 显示「选中文本 →」，Knowledge links 显示
  `[[`。MUST NOT 出现 Open note / New note 按钮，MUST NOT 出现 Quick Open、文件内查找、设置、
  vault 切换、`⌘/` 查看全部等系统通用提示，也不以右键新建提示凑数。表面内 MUST NOT 有按钮、
  输入框或可编辑元素；布局可按 pane 容量退让，但内容、顺序和中英文语义不变。
- **读屏与焦点语义**：共享表面 SHALL 是由可见 `h2` 命名的 `role=region`，四条为列表项、标题为
  `h3`。region 仅 `tabindex=-1` 以承接程序焦点，MUST NOT 进入 Tab 序，MUST NOT 冒充按钮或新增
  键盘动作。需要交还焦点时（关闭最后一个标签、Close All、分栏 / 切 pane、浮层取消或关闭）
  SHALL 聚焦该 region；有带路径标签时仍交给正文。
- **行号**：空工作区 MUST NOT 显示行号 gutter，包括 `[ui] line_numbers = "on"` 与 `⌥G` 临时档。
- **pane 归属**：非活跃空 pane 的点击 / 聚焦 SHALL 先使所属 pane 成为活跃 pane；随后经既有全局
  命令打开 Quick Open 时 MUST NOT 把打开落点或焦点串到另一个 pane。取消 / 关闭浮层 SHALL 把焦点
  交还该 pane 的 region；成功打开文档后才按既有打开语义交给正文。
- **首启**：首启 tips 只覆盖 root doc pane，普通空工作区副本在该宿主隐藏；首启收起 harness 再
  分栏时，右 pane SHALL 直接显示同一共享内容。首启资格与打开首文档即撤下的生命周期不变。
- **既有链路**：Quick Open、文件树打开与 vault 右键内联新建继续可用；tips 不复制这些通用入口。
  harness pane 不受本条约束；有路径 dirty 的保护、vault 外只读会话行为不变。

#### Scenario: 关闭最后一个标签回到空工作区

- **WHEN** 单 pane 打开着一份文档，执行 `⌘W`（或点该标签的关闭钮），且它没有未保存修改
- **THEN** 标签区隐藏、modeline 显示「无当前文件」；该 pane 显示同一组四条 tips，无按钮、无通用
  提示、无行号 gutter、没有插入光标；焦点落在命名 region 而不是正文或 `body`；按任意字符键与
  `⌘S` 都不产生内容、dirty 或提示

#### Scenario: 分栏空 pane 与单 pane 同一条只读规则

- **WHEN** `ui.line_numbers = "on"`，单 pane 开着 `a.md`，执行 `pane.split` 得到空的右 pane
- **THEN** 右 pane 显示同一组四条 tips（无 gutter、无插入光标、`contenteditable=false`），编辑器
  宿主 inert；在右 pane 打开 `b.md` 后正文恢复可编辑与光标

#### Scenario: 非活跃空 pane 的动作先激活所属 pane

- **WHEN** 双 pane：左 pane 开着 `a.md`，右 pane 为空工作区；聚焦右 pane 后经既有命令打开 Quick Open
- **THEN** 右 pane 成为活跃 pane 后才打开浮层；取消后焦点回到右 pane 的命名 region；左 pane 的
  前台文档、焦点与阅读位置都不变

#### Scenario: 新建笔记走既有命名链路

- **WHEN** 空工作区在场，用户从既有 vault 右键菜单选择新建文件
- **THEN** 文件树出现内联命名输入框（预填默认名、整段选中），此时磁盘 MUST NOT 出现新文件；
  提交合法名字后才创建文件并自动打开，空工作区随标签出现而离场；取消不创建任何文件

#### Scenario: 首启 tips 在场时空工作区动作让位

- **WHEN** 真正首次启动的首个空 vault 装载完成
- **THEN** root doc pane 显示共享 tips，普通空工作区副本隐藏，harness composer 可见、可聚焦、
  可输入；首启与普通 / 双 pane 的四条内容、顺序与读屏语义逐项相同

#### Scenario: 打开文档后同一同步点恢复

- **WHEN** 空工作区在场时从文件树打开 `a.md`
- **THEN** 空工作区离场，标签出现，`a.md` 的正文可编辑、光标可见，编辑器宿主不再 inert，行号按
  当前 `line_numbers` 档恢复；焦点落在正文
