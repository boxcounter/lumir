# quick-open 增量规格

> 起草注记（非规格正文）：本 change 只补空工作区的来源 pane 激活与焦点归还合同。Open note 按钮
> 已被 Alex 2026-11-28 删除；Quick Open 继续经既有全局命令 / 文件树链路进入，解析、候选、判决与
> 打开链路逐字不动。

## ADDED Requirements

### Requirement: 空工作区的打开入口与焦点归还

从空工作区（该文档 pane 没有带路径标签）经既有命令进入快速打开前，该 pane SHALL 先成为活跃 pane；
MUST NOT 把打开落点或焦点串到另一个 pane。空工作区没有 Open note 按钮，点击 / 聚焦静态 tips region
是合法的 pane 激活路径。

收起浮层时的焦点落点 SHALL 按该 pane 的当前状态决定：仍在空工作区（取消 / Esc / 外部关闭 /
被动收起）⇒ 焦点 SHALL 交还该 pane 的命名静态 region，MUST NOT 交给被覆盖且 inert 的正文；
成功打开了带路径文档 ⇒ SHALL 按既有打开语义把焦点交给新文档正文。

#### Scenario: 非活跃空 pane 的入口先激活所属 pane

- **WHEN** 双 pane：左 pane 开着 `a.md`，右 pane 为空工作区；聚焦右 pane 后经既有命令打开 Quick Open
- **THEN** 右 pane 先成为活跃 pane，浮层随即打开；左 pane 的前台文档与阅读位置不变

#### Scenario: 取消后焦点回到静态 region

- **WHEN** 从空工作区打开快速打开浮层，按 Esc（或点浮层外部）收起
- **THEN** 浮层收起、没有打开任何文件；焦点落在该 pane 的静态 region，MUST NOT 落在正文或 `body`

#### Scenario: 成功打开后聚正文

- **WHEN** 从空工作区的浮层输入一个存在的 vault 相对路径并按 Enter
- **THEN** 文件在该 pane 打开、空工作区离场；焦点落在新文档正文；标签与 modeline 按既有口径更新

#### Scenario: 双 pane 不串焦（取消时的落点按当下状态判）

- **WHEN** 双 pane 的左 pane 开着 `a.md`，右 pane 为空工作区；先在右 pane 的浮层取消一次，再打开 `b.md`，随后再从右 pane 打开浮层并取消
- **THEN** 第一次取消把焦点交还右 pane 的静态 region；`b.md` 落在右 pane 并把焦点交给它的正文；
  第二次取消把焦点交还 `b.md` 正文（此时右 pane 已不是空工作区，MUST NOT 回到已不存在的 region）；
  左 pane 的前台、焦点与阅读位置全程不变
