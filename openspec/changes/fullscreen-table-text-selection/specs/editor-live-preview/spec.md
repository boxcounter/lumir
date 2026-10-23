# editor-live-preview 增量规格

> 起草注记（非规格正文）：本 delta 一条 ADDED，基线是 living spec
> [openspec/specs/editor-live-preview/spec.md](../../../../specs/editor-live-preview/spec.md)。
> 既有的两条全屏 requirement（「表格放大全屏查看」「代码块放大全屏查看」）**逐字不动**——本增量只补
> 「遮罩里的文本怎么选中、怎么复制」这一条能力。起草期实测读数与根因见 [design.md](../../design.md)
> §1–§2；五个起草期取值见 [proposal.md](../../proposal.md) 的「起草期取值」表。
>
> harness 面的同族条款**不在本 delta 里**：`harness` 的那条 ADDED requirement 还在已合并、尚未归档的
> change `add-harness-block-fullscreen` 里、没进 living spec（写它的 MODIFIED 会让 `validate --strict`
> 失败）。实现由两个面共用的遮罩模块承担，因此行为上同时成立；条款待那个 change 归档后另立补上
> （design §8）。

## ADDED Requirements

### Requirement: 全屏遮罩内的文本可选中可复制

表格全屏与代码块全屏的遮罩内容 SHALL 是**原生可选文本**：遮罩、内容容器与其中全部后代的计算
`user-select` MUST NOT 为 `none`；内容容器 SHALL 显式声明 `user-select: text`（MUST NOT 依赖从祖先
继承来的默认值——那会让「可选」在任意祖先加上 `user-select: none` 时静默失效）。鼠标拖选 SHALL 在
遮罩内容内建立 DOM 选区，跨 cell、跨行的拖选同样成立；选中后经系统的复制动作 SHALL 得到该选区文本，
口径是**浏览器原生纯文本**（本能力 MUST NOT 为全屏另立 Markdown / TSV 之类的序列化格式）。

遮罩持有焦点期间，`⌘A` SHALL 选中遮罩内容（表格 = 快照容器，代码块 = 内容容器）；选区 MUST NOT
落到遮罩之外（应用 chrome 与蒙层之后的编辑器正文 MUST NOT 进入选区），MUST NOT 移动焦点，MUST NOT
改变编辑器的选区状态。该键 MUST NOT 写进统一键位表——表的不变量是「一个 token 一条绑定」，同 token
的第二条绑定会被构造期拒绝（`Cmd-a` 已归 `editor.select-all`）；由遮罩就地消费，与既有 `Esc` 同一
先例（`Esc` 同被 `editor.widget-escape` 占用，遮罩仍就地消费）。遮罩内的就地键不参与 `[keys]` 重绑，
与 `Esc` 同款，是既有先例的延续。

Edit 菜单的「全选」项（原生加速键已让出，点击经菜单事件回到前端）在遮罩持焦时 SHALL 与 `⌘A`
**同一落面**——MUST NOT 出现「键盘选遮罩内容、菜单选蒙层后正文」的两套结果。

既有四条关闭路径（`Esc`、点击遮罩、再次执行同一 toggle、焦点离开的 `blur` 兜底）在存在选区时 SHALL
逐条不变；关闭之后 MUST NOT 残留可被复制动作取到的遮罩文本。打开、选中与复制 MUST NOT 改写文档
（`EditorState.doc` 与磁盘文件逐字节不变）与会话留存（ADR 0003 §3）。

#### Scenario: 键盘全选落在遮罩内

- **WHEN** 打开一张表（或一个代码块）的全屏遮罩，随后按 `⌘A`
- **THEN** 选区非空且锚点落在遮罩的内容容器内；焦点仍在遮罩上；选区**不含**遮罩之外的应用 chrome
  与编辑器正文（这条负向判据与该场景同批断言：只判「非空」会在「选中整页」上假绿）

#### Scenario: 复制得到遮罩内的文本

- **WHEN** 在遮罩内用鼠标跨 cell 选中一段表格文本，随后执行系统的复制动作
- **THEN** 复制结果与遮罩内可见的选中文本一致；文档内容与磁盘文件逐字节不变

#### Scenario: 菜单「全选」与键盘同一落面

- **WHEN** 遮罩打开且持焦时，从 Edit 菜单点击「全选」
- **THEN** 选区落在遮罩内容上（与 `⌘A` 的结果同形），MUST NOT 选中蒙层之后的编辑器正文

#### Scenario: 选中之后退出路径不变

- **WHEN** 遮罩内已有选区时，依次验证 `Esc`、点击遮罩、再次执行同一 toggle
- **THEN** 三条路径都关闭遮罩，焦点按既有口径交还编辑器；关闭后执行复制 MUST NOT 取到遮罩里的旧文本

#### Scenario: 只读不改文档

- **WHEN** 在遮罩内全选并复制
- **THEN** `EditorState.doc` 与磁盘文件逐字节不变、会话留存无写入、不触发任何保存或投递
