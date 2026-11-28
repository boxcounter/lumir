# first-run-onboarding 增量规格

> 起草注记（非规格正文）：本 change 后「无 Tab」统一为空工作区。本增量改准两处：Purpose 里
> 「非首启空 vault 保持既有 D107 + D882」；「首启工作区初始构成」里 tips 与空白草稿 / 空 pane
> 引导的关系（tips 在场时空工作区动作隐藏）。tips 的内容、生命周期与默认 harness 布局逐字保留。
> 机制见 [design.md](../../design.md)。

## Purpose

定义真正首次启动（启动快照 `last_vault === null`）的判定与作用域，以及首个 vault 的首启工作区引导：启动态复用既有 `#startup` 的首启模式（唯一居中的「添加 vault」入口，不建骨架 / 产品标记 / 阶段行，不因 `no_vault` / 安全阀超时撤下；在场期间 `#app` 对辅助技术隐藏且命令分发统一阻断）；首个 vault 无标签时在 content pane 呈现 tips 与默认 harness（`focusComposer = false`，不建会话 / JSONL、不发 preflight，既有 `harness_pane` 布局位照常落盘），tips 在场时空工作区正文结构性只读、打开首个文档即撤下。判定只取启动快照、不新增持久化字段；非首启空 vault 呈统一空工作区（「打开笔记…」/「新建笔记」）。由 change `add-first-run-onboarding-nov25` 归档并入（2026-11-27）。

## MODIFIED Requirements

### Requirement: 首启工作区初始构成

首个 vault 装载完成且 content pane 没有任何带路径的标签时，系统 SHALL 在 content pane 呈现首启
tips：一组真实产品功能与默认键位的引导，注明这些是默认键位，并以 `⌘/` 作为查看全部键位的出口。
tips MUST NOT 新增 pane，也 MUST NOT 覆盖 harness pane；它 SHALL 只覆盖 root doc pane。

tips SHALL 没有关闭钮、没有第二动作；打开首个文档（content pane 出现带路径的标签）时 SHALL 单帧
消失，且本会话 MUST NOT 再次出现。首个 vault 恢复出标签时 tips MUST NOT 出现，也 MUST NOT 补到
后续空态。首启 tips / 默认 harness 的资格 SHALL 在首个 `applyVault` 入口一次性领取；无论该 vault
是否恢复出标签，首个 applyVault 的恢复收尾都消费该资格。后续 vault MUST NOT 继承资格——即使第二
个空 vault 的空态先于第一个 vault 的恢复收尾到达。tips 在场时，文档 pane 的无路径空白正文 MUST NOT
接受文本输入（结构性只读）；打开文档后 SHALL 恢复可编辑。tips 是该 doc pane 的空态表面：空工作区
（`pane-layout` 的「无标签文档 pane 的空工作区」）的标题与两个动作 MUST NOT 同时出现，两者在同一个
在场写点统一裁决。

首个 vault 的初始布局 SHALL 默认包含 harness pane：以与 `harness.toggle` 相同的打开实现、
`focusComposer = false` 施加一次；MUST NOT 抢焦点、MUST NOT 新建 harness 会话 / JSONL、MUST NOT
发送 preflight。既有按 vault 持久化的 `harness_pane` 布局位 SHALL 照常落盘（允许写入 `true`）；
用户收起 harness 后，后续启动 MUST NOT 自动展开。该默认展开是装载后的初始布局，不是用户可触发
的第二开合通道；harness pane 的机械条款见 `pane-layout` 的「harness pane」。

#### Scenario: 首启空工作区呈 tips 与默认 harness

- **WHEN** 首个 vault 装载完成，且没有恢复出任何带路径的标签
- **THEN** content pane 显示 tips（真实功能 / 默认键位 / `⌘/` 出口）；tips 只覆盖 root doc pane，
  harness pane 按 1:1 仍可见；MUST NOT 出现空工作区的标题或两个动作（打开笔记… / 新建笔记）

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
- **THEN** 该空 vault MUST NOT 出现 tips，MUST NOT 默认展开 harness；首启资格已在首个
  `applyVault` 入口消费，后续 vault 不得继承

#### Scenario: tips 在场时草稿只读

- **WHEN** tips 在场，用户尝试在文档 pane 的空工作区正文里键入
- **THEN** 正文内容不变化、不产生 dirty；打开一个文件后，编辑器恢复可编辑，键入正常落进该文件
  （本 scenario 名沿用旧锚点；OpenSpec 的 MODIFIED 块不允许改 scenario 名）

#### Scenario: 老用户空 vault 不出现首启 tips

- **WHEN** 非首启的空 vault 装载完成
- **THEN** 呈统一空工作区（「没有打开的文档」+「打开笔记…」/「新建笔记」）；MUST NOT 出现首启
  tips，MUST NOT 默认展开 harness pane
