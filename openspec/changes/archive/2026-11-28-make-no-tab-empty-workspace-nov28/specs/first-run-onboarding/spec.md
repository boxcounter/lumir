# first-run-onboarding 增量规格

> 起草注记（非规格正文）：Alex 2026-11-28 否决旧首启九条快捷键目录与普通空态 Open / New
> 按钮。首启、普通无 Tab、空 vault 与双 pane 现在共享同一组最多四条 Lumir 特有 tips；
> 首启资格、一次性生命周期与默认 harness 布局不变。

## Purpose

定义真正首次启动（启动快照 `last_vault === null`）的判定与作用域，以及首个 vault 的首启工作区
引导：启动态复用既有 `#startup` 的首启模式（唯一居中的「添加 vault」入口，不建骨架 / 产品标记 /
阶段行，不因 `no_vault` / 安全阀超时撤下；在场期间 `#app` 对辅助技术隐藏且命令分发统一阻断）；
首个 vault 无标签时在 content pane 呈现共享 tips 与默认 harness（`focusComposer = false`，不建
会话 / JSONL、不发 preflight，既有 `harness_pane` 布局位照常落盘），打开首个文档即撤下。
判定只取启动快照、不新增持久化字段；非首启空 vault 使用同一组共享 tips，但不继承首启资格与
默认 harness。由 change `add-first-run-onboarding-nov25` 归档并入（2026-11-27）。

## MODIFIED Requirements

### Requirement: 首启工作区初始构成

首个 vault 装载完成且 content pane 没有任何带路径的标签时，系统 SHALL 在 content pane 呈现首启
tips：与普通无 Tab、空 vault、双 pane 完全相同的四条 Lumir 特有功能，顺序为 Outline、Quote to
chat、Knowledge links、Harness pane。只有 Outline 与 Harness 可显示从产品默认绑定表派生的键位；
Quote 显示选择文本手势，Knowledge links 显示 `[[`。tips MUST NOT 包含 Quick Open、文件内查找、
设置、vault 切换、`⌘/` 查看全部等通用快捷键或右键新建提示，MUST NOT 提供 Open note / New note
按钮、输入框或可编辑元素。布局可按 pane 容量退让，但内容、顺序与中英文语义不变。

tips MUST NOT 新增 pane，也 MUST NOT 覆盖 harness pane；它 SHALL 只覆盖 root doc pane。共享表面
SHALL 是由可见 `h2` 命名的 `role=region`，四项有列表与 `h3` 语义；region 仅 `tabindex=-1`，用于
程序焦点归还而不进入 Tab 序，被覆盖编辑器宿主 SHALL 为 `inert`，避免正文焦点 / 输入与读屏旁路。

tips SHALL 没有关闭钮、没有第二动作；打开首个文档（content pane 出现带路径的标签）时 SHALL 单帧
消失，且本会话 MUST NOT 再次出现。首个 vault 恢复出标签时 tips MUST NOT 出现，也 MUST NOT 补到
后续空态。首启 tips / 默认 harness 的资格 SHALL 在首个 `applyVault` 入口一次性领取；无论该 vault
是否恢复出标签，首个 applyVault 的恢复收尾都消费该资格。后续 vault MUST NOT 继承资格——即使第二
个空 vault 的空态先于第一个 vault 的恢复收尾到达。首启收起 harness 再分栏时，右 pane 直接显示同一
共享内容，但首启资格仍不扩散。

首个 vault 的初始布局 SHALL 默认包含 harness pane：以与 `harness.toggle` 相同的打开实现、
`focusComposer = false` 施加一次；MUST NOT 抢焦点、MUST NOT 新建 harness 会话 / JSONL、MUST NOT
发送 preflight。既有按 vault 持久化的 `harness_pane` 布局位 SHALL 照常落盘（允许写入 `true`）；
用户收起 harness 后，后续启动 MUST NOT 自动展开。该默认展开是装载后的初始布局，不是用户可触发的
第二开合通道；harness pane 的机械条款见 `pane-layout` 的「harness pane」。

#### Scenario: 首启空工作区呈 tips 与默认 harness

- **WHEN** 首个 vault 装载完成，且没有恢复出任何带路径的标签
- **THEN** content pane 显示与普通 / 双 pane 完全相同的四条产品特有 tips；tips 只覆盖 root doc
  pane，harness pane 按 1:1 仍可见；MUST NOT 出现 Open note / New note 按钮或通用快捷键提示

#### Scenario: 打开首个文档即撤下 tips

- **WHEN** tips 在场时，用户从文件树打开一个文件
- **THEN** tips 在同一帧内消失；编辑器显示该文件且可编辑；本会话内 tips MUST NOT 再次出现

#### Scenario: 默认 harness 不建会话

- **WHEN** 首启空工作区的 harness pane 默认在场后，检查留存目录
- **THEN** `harness/sessions/<vaultId>/` 下没有新增 JSONL；没有发送 preflight；`harness_state` 仍
  是空会话快照；`vault-sessions/<vaultId>.json` 的 `harness_pane` 为 `true`

#### Scenario: tips 不覆盖已恢复的标签

- **WHEN** 首个 vault 装载后恢复了至少一个带路径的标签
- **THEN** tips MUST NOT 出现，MUST NOT 覆盖文档；后续把标签全部关掉也不补出 tips

#### Scenario: 首 vault 恢复标签后切空 vault 不出 tips

- **WHEN** 首个 vault 恢复了标签（tips 未出现），随后切换到一个空 vault
- **THEN** 该空 vault MUST NOT 出现首启专属 tips，MUST NOT 默认展开 harness；首启资格已在首个
  `applyVault` 入口消费，后续 vault 不得继承

#### Scenario: tips 在场时草稿只读

- **WHEN** tips 在场，用户尝试在文档 pane 的空工作区正文里键入
- **THEN** 正文内容不变化、不产生 dirty，编辑器宿主 inert 使正文无法取得程序焦点；打开一个文件后
  编辑器恢复可编辑，键入正常落进该文件（scenario 名沿用旧锚点）

#### Scenario: 老用户空 vault 不出现首启 tips

- **WHEN** 非首启的空 vault 装载完成
- **THEN** 呈现与普通无 Tab 相同的共享四条 tips，无按钮、无通用快捷键；MUST NOT 继承首启专属
  生命周期或默认展开 harness pane
