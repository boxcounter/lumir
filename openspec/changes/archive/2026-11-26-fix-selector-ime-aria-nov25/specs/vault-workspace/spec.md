# Delta: vault-workspace

## ADDED Requirements

### Requirement: vault 列表浮层的 IME、ARIA 与 Tab 口径

vault 列表浮层的就地键 SHALL 与 `toc-outline` 的「浮层选择列表的 IME、ARIA 与焦点口径」同一套：
组合期（`isComposing` 为真或 `keyCode === 229`）的 `↑↓` / `⌃N` / `⌃P` / `Enter` / `Delete` /
`Backspace` MUST NOT 移动游标、MUST NOT 发起切换或重定位、MUST NOT 关闭浮层、MUST NOT 进入删除确认；
组合期 MUST NOT 刷新结果集，组合结束 SHALL 按最终查询串刷新**恰一次**（`compositionend` 之后引擎
补发的同值 `input` MUST NOT 触发第二次刷新）。

筛选框的 `⌘A` SHALL 与 `quick-open` 的「输入面内的全选（⌘A）」条同一套（vault 筛选框同样是
**输入面**）：输入框持焦时由浮层的就地键处理显式接管（`preventDefault` 后选中输入串），MUST NOT
依赖 webview / 原生 Select All 菜单的默认行为，MUST NOT 绕到 `editor.select-all`（那会选中正文、
丢掉输入串）；组合期的 `⌘A` MUST NOT 由该分支消费、MUST NOT 改变输入框选区。其余文本编辑键 SHALL
继续走原生输入框路径。本条不在 vault 侧重述实现，只声明同一合同适用于本浮层的筛选框。

`aria-selected` SHALL 只表示**键盘游标**：任意时刻至多一条 option 为 `aria-selected="true"`，且它
SHALL 是 `aria-activedescendant` 指向的那一条。**当前 vault** SHALL 用 `aria-current="true"` 与既有
✓ 槽位 / 「当前」flag / `is-current` 视觉标记表示，MUST NOT 用 `aria-selected` 表示；游标移开后当前行 SHALL 是
`aria-selected="false"` + `aria-current="true"`。失效行 SHALL 有唯一、非空的 option `id` 与
`aria-disabled="true"`，**并 SHALL 同样在键盘游标空间里**：`aria-disabled` 表示「不能切换过去」，
MUST NOT 被读成「不可聚焦 / 不可指向」（与原生 `disabled` 不同），否则清理失效项这个主用例就只剩
指针一条路。可用性只决定 `Enter` 的分支（切换 / 重定位）与视觉标记（`is-missing`、成因行、
「重新定位…」），MUST NOT 决定可达性。**当前 vault 恰好失效时，该行 SHALL 同时保留
`aria-current="true"`**——「失效」是可用性维度，「当前」是身份维度，二者可以同时为真，MUST NOT 用
把失效行一律写成 `aria-current="false"` 的方式把当前身份抹掉；非当前的失效行才是
`aria-current="false"`。游标的策略起点仍是当前项（它失效时也一样），否则首条命中。

列表行切换钮与行尾删除钮 SHALL 为 `tabindex="-1"`：它们不进 Tab 序列——listbox 内的原生按钮会让
`Tab` 在浮层里形成不可预测的遍历。删除的两步确认语义保持既有，且 SHALL 有纯键盘入口：**焦点在筛选
输入框上**（判据是 `document.activeElement` 就是它，MUST NOT 只凭「查询为空」推断——keydown 挂在
浮层容器上，Tab 到「新增 vault…」后按键照样冒泡过来）、查询为空、游标落在**任何非当前行（可用或
失效）**时，`Delete` / `Backspace` 第一次按下 SHALL 进入与指针点击同一套两步确认，第二次按下 SHALL
提交移除。查询非空时这两个键 MUST NOT 被浮层消费（它们是输入框的编辑键）；焦点不在筛选输入框上时
同样 MUST NOT 被消费；当前 vault 行没有移除入口、按键 MUST NOT 被消费，也 MUST NOT 改指一个「旁边
的」行。确认态在场的键盘出口 SHALL 明确且可发现：第二次按下提交同一个动作；`Esc` 第一次只取消确认
（浮层保持打开、层不注销——第二次 `Esc` 才按既有规则关闭）；该「先取消确认」的口径 SHALL 尊重
`escapeRouter` 的层栈——本浮层不是栈顶时，`Esc` 先关栈顶层（如后打开的 hover 提示），确认态不动。
确认态 SHALL 唯一（屏幕上至多一处）：指针先后对两行点 × 时，后进入的确认替换前一份，先前的行逐字
还原、不发起任何移除。游标移动或查询变化 SHALL 取消确认
（确认属于那一行，游标挪走就是放弃，MUST NOT 让下一次按键删掉「刚才确认过的行」）；取消钮 SHALL
带 `aria-keyshortcuts="Escape"`，`tabindex="-1"` 因此不再是纯键盘的唯一出口。
指针点击、键盘 `Enter`（切换 / 重定位）与删除的其它语义保持既有。`Tab` MUST NOT 被浮层消费：焦点按
原生顺序落到浮层内的下一个可聚焦件（「新增 vault…」），离开浮层时按「焦点离开浮层即收起」收起。

浮层被外部事件重建行 DOM 时（`onVaultLoaded` 的程序化装载，含同一 vault 的重新装载）SHALL 按行
**id 保位**键盘游标：装载 MUST NOT 把用户挪开的游标抢回当前项；该行已不在列表里时回落策略起点。
重建会丢弃确认态，保位因此是「下一次 `Delete` / `Backspace` 仍指向用户刚才那一行」的唯一保证。

指针悬停游标行 MUST NOT 移除游标标记（选中底色与内描边保持不变）。关闭路径的焦点口径与
`toc-outline` 同一套：主动关闭（`Esc` / 再按 `⌘O` / `Enter` 撞当前项）交还编辑器并保持阅读位置，
被动关闭（点浮层外 / 焦点离开 / 行点击）不抢焦点。本条与 `docs/specs/selector-contract.md` 的选择器
交互合同同源；匹配与筛选规则仍引用 `toc-outline`，本 capability 不重述。

#### Scenario: 组合期不导航不切换

- **WHEN** 浮层打开、焦点在筛选输入框，输入法组合进行中（`isComposing` 为真或 `keyCode === 229`）
  依次按下 `↓` 与 `Enter`，随后结束组合并提交最终查询串
- **THEN** 组合期游标不动、浮层不关闭、没有发起 `vault_open_path` 或重定位请求；当前 vault 与右栏
  正文不变；组合结束后列表按最终查询串刷新，游标落在首条命中

#### Scenario: 输入框内 ⌘A 全选输入串

- **WHEN** 浮层打开、筛选框里已有 `notes-vault`，用户按 `⌘A` 后键入 `x`
- **THEN** 输入框内容变成 `x`（整串被替换，MUST NOT 变成 `notes-vaultx` 一类的追加形态），列表按
  `x` 筛；这次 `⌘A` 的 `defaultPrevented` 为真（输入面显式接管）；当前 vault 与右栏正文不因这次
  全选改变；组合期按下 `⌘A` 时浮层不消费该键、不建立全选

#### Scenario: 组合期不进入删除确认

- **WHEN** 浮层打开、查询为空、游标在一条非当前行上，输入法组合进行中按下 `Delete` 或 `Backspace`
- **THEN** 浮层不进入删除确认、不消费该键、不发起移除请求；组合结束后这两个键才按本条的删除语义
  处理

#### Scenario: 游标与当前 vault 的属性分离

- **WHEN** 浮层打开（游标初值在当前 vault），随后按 `↓` 把游标移到另一个行
- **THEN** 当前行保持 `aria-current="true"`、`aria-selected="false"` 与既有 ✓ / 「当前」标记；游标行
  `aria-selected="true"` 且 `aria-current="false"`；`aria-activedescendant` 指向游标行；任意时刻
  `aria-selected="true"` 的 option 至多一条

#### Scenario: 失效行的 option 标识与可达性

- **WHEN** 筛选结果只剩一条失效行，或失效行与可用行同时在场，用户用 `↑↓` 移动游标
- **THEN** 失效行有唯一、非空的 option `id` 与 `aria-disabled="true"`；游标可以停在它上面（此时
  它是 `aria-selected="true"` 且 `aria-activedescendant` 指向它的 `id`）；游标不在它上面时它是
  `aria-selected="false"`；`Enter` 落在失效行上 SHALL 发起重定位，MUST NOT 发起切换

#### Scenario: 当前 vault 失效时保留当前身份

- **WHEN** 当前 vault 的目录在应用打开期间被移走（外置盘拔出 / 目录改名），注册表把该行标为不可用，
  随后打开浮层
- **THEN** 该行仍带 `aria-current="true"` 与既有 ✓ 槽位 /「当前」flag / `is-current` 视觉标记，同时带 `aria-disabled="true"`；
  游标的策略起点仍是它（游标落在这一行上，`aria-activedescendant` 指向它），`↓` 离开后它只保留
  `aria-current="true"`

#### Scenario: 键盘删除走同一套两步确认

- **WHEN** 浮层打开、焦点在筛选输入框、查询为空，游标停在一条可移除的行上（非当前行），按下
  `Delete`（或 `Backspace`），随后再按一次同一个键
- **THEN** 第一次按下进入与点击行尾 × 相同的两步确认（确认句点名该行，浮层不收起、不发起切换、
  不请求移除）；第二次按下只发起一次移除请求，列表按后端结果重拉、该行消失；对当前 vault 行按同一个
  键不进入确认、不消费按键；查询非空时同一个键归输入框（删字），浮层不接管

#### Scenario: 失效行可纯键盘清理

- **WHEN** 浮层打开、焦点在筛选输入框、查询为空，游标停在一条失效行上（`↑↓` 可到达），第一次按下
  `Delete`、第二次按下 `Backspace`
- **THEN** 第一次进入与指针点击 × 相同的两步确认（确认句点名该失效行）；第二次只发起一次移除请求，
  列表按后端结果重拉、该行消失；整个过程浮层保持打开

#### Scenario: 焦点不在筛选输入框时按键不被接管

- **WHEN** 浮层打开、游标停在一条可移除行上，焦点经 `Tab` 落到「新增 vault…」，按下 `Delete` 或
  `Backspace`
- **THEN** 浮层不进入删除确认、不消费该键、不发起移除请求；焦点回到筛选输入框后同一个键才进入确认
  （目标仍是原来那一行）

#### Scenario: 确认态的取消

- **WHEN** 浮层进入删除确认态后（且本浮层是 `escapeRouter` 的栈顶），用户按 `Esc`（第一次）、或按
  `↑` / `↓` 移动游标、或修改查询串
- **THEN** 确认态被取消、该行逐字还原、不发起任何移除请求；`Esc` 的第一次不关闭浮层、不交还编辑器
  焦点（第二次 `Esc` 才按既有规则关闭）；游标移动后按键重新武装的是眼下这一行，MUST NOT 删掉原先
  确认的那一行

#### Scenario: 确认态的 Esc 尊重层栈

- **WHEN** 浮层处于删除确认态，且另一层（如后打开的 hover 提示）登记在 `escapeRouter` 的栈顶，用户
  按第一次 `Esc`
- **THEN** 这一拍只关闭栈顶层，浮层与确认态都保持不变；栈顶回到本浮层后，下一次 `Esc` 才取消确认

#### Scenario: 确认态唯一

- **WHEN** 浮层打开，用户先用指针点 A 行的 × 进入确认，再点 B 行的 ×
- **THEN** A 行逐字还原（切换钮与移除钮回来）、B 行进入确认；屏幕上至多一处确认，点「移除」只提交
  B 行、只发起一次移除请求，A 行 MUST NOT 被移除

#### Scenario: Tab 不使用行按钮与删除钮作为台阶

- **WHEN** 焦点在筛选输入框，连续按 `Tab`
- **THEN** 焦点不落在切换钮或行尾删除钮上（两者的 `tabindex` 为 `-1`），第一次 `Tab` 落到「新增
  vault…」，下一次 `Tab` 离开浮层并触发「焦点离开即收起」；`Tab` 的 `defaultPrevented` 为假（浮层
  不消费它）

#### Scenario: 程序化装载按 id 保位

- **WHEN** 浮层打开、游标已挪到某条非当前行，此时发生一次程序化 vault 装载（`onVaultLoaded`，浮层
  不关）
- **THEN** 身份标记（✓ /「当前」/ `is-current` / `aria-current` / 移除钮）按新身份重算，游标留在
  用户原来那一行；若当时有确认态，确认态随旧 DOM 丢弃，下一次 `Delete` / `Backspace` 重新武装的仍是
  同一行

#### Scenario: 指针悬停不清掉游标

- **WHEN** 指针悬停在当前键盘游标行上
- **THEN** 该行仍显示选中底色与内描边（游标标记不被 `--hover` 覆盖），游标位置不变
