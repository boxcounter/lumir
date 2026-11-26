# toc-outline delta（change fix-text-input-select-all-nov26）

## MODIFIED Requirements

### Requirement: 浮层选择列表的 IME、ARIA 与焦点口径

浮层的就地键处理 SHALL 与 Quick Open 共用同一条组合期准入：`KeyboardEvent.isComposing` 为真或
`keyCode === 229` 时，`↑↓` / `⌃N` / `⌃P` / `Enter` MUST NOT 移动游标、MUST NOT 接受当前项、MUST NOT
关闭浮层，也 MUST NOT 消费该键（不 `preventDefault`）。组合期 MUST NOT 刷新结果集；组合结束 SHALL 按
最终查询串刷新**恰一次**——真实引擎在 `compositionend` 之后补发的同值 `input` MUST NOT 触发第二次
刷新。

筛选输入框是**输入面**的一种，`⌘A` SHALL 沿用 `quick-open` 的「输入面内的全选（⌘A）」条：由**统一键位层**
按输入面**显式接管**（change fix-text-input-select-all-nov26：`selectAllAt` 落到筛选框、选中其全部输入
内容并 `preventDefault`；浮层 MUST NOT 再保留本地的 `input.select()` 副本），MUST NOT 依赖 webview /
原生 Select All 菜单的默认行为，MUST NOT 被 `editor.select-all` 截走（那会选中正文、丢掉输入串）。
其余文本编辑键（复制 / 剪切 / 粘贴 / 撤销 / 重做 / 移动 / 删除 / `⌫` / `⌥⌫` / `⌦` / 左右方向键）SHALL
继续走原生输入框路径；组合期的 `⌘A` MUST NOT 由统一分派消费、MUST NOT 改变输入框选区。浮层关闭后
编辑器内的 `⌘A` SHALL 保持既有 `editor.select-all` 语义。

`aria-selected` SHALL 只表示**键盘游标**：任意时刻至多一条 option 为 `aria-selected="true"`，且它
SHALL 是 `aria-activedescendant` 指向的那一条。当前段是**另一件事**：它 SHALL 用 `aria-current="true"`
与既有 `is-current` 视觉标记表示，MUST NOT 借 `aria-selected` 表达；游标移开后当前段 SHALL 保持
`aria-selected="false"` 且 `aria-current="true"`，两态因此可区分。

ARIA 关系 SHALL 闭合：持焦点的输入框是 `role=combobox` 且 `aria-controls` 指向列表的 `id`；列表是
`role=listbox` 且持有该 `id`；每个 option SHALL 有唯一、非空的 `id`；`aria-activedescendant` SHALL
指向当前游标 option 的 `id`，没有游标时 MUST NOT 出现该属性。没有键盘游标空间的条目（无命中态等）
MUST NOT 被写进 `aria-activedescendant`。

`Tab` MUST NOT 被浮层消费（仍走原生焦点遍历）；指针悬停游标行 MUST NOT 移除该行的游标标记——选中
底色与内描边 SHALL 保持不变。

关闭路径的焦点口径 SHALL 按主动 / 被动区分（与「大纲浮层」的关闭路径同一条）：主动关闭交还编辑器
并保持阅读位置，被动关闭不抢焦点。本条与 `docs/specs/selector-contract.md` 的选择器交互合同同源；
条目级细节以本合同为准，合同本身不在本文件复制。

#### Scenario: 组合期不导航不接受

- **WHEN** 浮层打开、焦点在筛选输入框，输入法组合进行中（`isComposing` 为真或 `keyCode === 229`）
  依次按下 `↓` 与 `Enter`，随后结束组合并提交最终查询串
- **THEN** 组合期游标不动、浮层不关闭、文档光标与选区不变；组合结束后列表按最终查询串刷新，游标
  落在该结果集的首条命中（查询为空时落在全量态起点）

#### Scenario: 输入框内 ⌘A 全选输入串

- **WHEN** 浮层打开、筛选框里已有 `乙小节`，用户按 `⌘A` 后键入 `甲`
- **THEN** 输入框内容变成 `甲`（整串被替换，MUST NOT 变成 `乙小节甲` 一类的追加形态），列表按 `甲`
  筛；这次 `⌘A` 的 `defaultPrevented` 为真（输入面显式接管）；编辑器文档与选区不因这次全选改变

#### Scenario: 组合期 ⌘A 不被输入面接管

- **WHEN** 输入法组合进行中（`isComposing` 为真或 `keyCode === 229`）按下 `⌘A`
- **THEN** 浮层不消费该键、不建立全选；组合结束后仍按最终查询串刷新一次

#### Scenario: 浮层关闭后编辑器内的 ⌘A 不回归

- **WHEN** 浮层关闭、焦点在编辑器内容区，用户按 `⌘A`
- **THEN** 选中的是整篇文档（既有 `editor.select-all` 语义逐字不变）

#### Scenario: 组合结束只刷新一次

- **WHEN** 组合结束（`compositionend`）后引擎补发一次 `isComposing=false` 的同值 `input`
- **THEN** 结果集与行 DOM 只重建一次（不是两次）；最终查询串生效、游标起点按组合结束后的口径摆放

#### Scenario: 游标与当前段的属性分离

- **WHEN** 浮层打开（游标初值在当前段），随后按 `↓` 把游标移开当前段
- **THEN** 当前段保持 `aria-current="true"` 且 `aria-selected="false"`，游标行 `aria-selected="true"`
  且 `aria-current="false"`；`aria-activedescendant` 指向游标行；任意时刻 `aria-selected="true"` 的
  option 至多一条

#### Scenario: 被动关闭不抢焦点

- **WHEN** 浮层打开时点击浮层以外的非编辑器目标（如文件树空白处）
- **THEN** 浮层收起，焦点归用户刚点的目标（或浏览器默认落点），MUST NOT 被拽回编辑器；同一浮层用
  `Esc` 关闭时焦点交还编辑器且阅读位置不变
