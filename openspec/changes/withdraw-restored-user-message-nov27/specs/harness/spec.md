## MODIFIED Requirements

### Requirement: 撤回最近一条用户消息

面板 SHALL 在**最后一条用户消息**上提供撤回入口；撤回 SHALL 同时完成三件事：该消息及其后全部
轮次（assistant 正文、工具调用与结果、思考块）不再进入后续模型上下文、不再出现在显示历史、
原文回到 composer 供编辑。只把消息从显示面移除 MUST NOT 被当作撤回——模型上下文由会话 `input`
决定，显示面只是它的投影。

撤回 SHALL 创建新逻辑会话 B：`session_open` 记 `opened_from=withdraw` 与 `restored_from=<原会话
A>`，`system` / `assembly` 沿用 A，标题按 `session_title inherit` 继承，读数与子运行种子随首行
落账。B SHALL 在撤回动作内**立即发布**（不等首条真实请求），初始记录 SHALL 含
`withdraw_seed`——撤回点之前的 `input` 原样切片；恢复路径在没有 `llm_request` 时 SHALL 回落读它，
使「撤回后切走会话再回来」仍得到撤回点之前的历史而不是空会话。撤回 MUST NOT 改写 A 或任何既有
JSONL。

撤回成功 SHALL 删除 A 的留存文件：默认会话清单只剩 B 一行，MUST NOT 保留、隐藏或双份展示 A。
撤回 SHALL 封闭旧会话的事件源：`harness:event` 信封 SHALL 携带**逻辑会话令牌**，面板 SHALL 按与
`persistence` 相同的准入丢弃退役 / 更旧令牌的事件（含 `subagent_*` / `notice` / `title` 与回合
事件），旧会话的后台线程 MUST NOT 把行 / 通知 / 标题写进 B 的视图；后端写父会话的通道（通知插入、
投递标记）MUST 比较中枢建时的父会话令牌，不符即放弃。令牌水位 SHALL **按 vault 分账**：令牌是
进程级单调分配的，不同 vault 的会话各有各的号，MUST NOT 用单个全局水位——否则从大 token 的 A
切到小 token 的 B 后，B 的合法事件 / 快照会被持续误判为旧会话（含 `persistence`）。切到尚无水位
的 vault 时 SHALL 先接纳其首条事件 / 快照，随后按该 vault 自己的水位收紧；已退役令牌的集合仍
全局生效。缺 `session_token` 的兼容事件 SHALL 只放行、MUST NOT 清空该 vault 的既有水位（否则
未退役的旧令牌会重新通过），也 MUST NOT 阻止后续合法快照按同一水位纠偏。
A 已有任何派生 / 恢复会话（`restored_from` 链能走回 A）时，撤回 MUST 被拒绝并给出明确原因；
MUST NOT 级联删除这些会话，MUST NOT 静默保留 A。派生检测 SHALL 在动作前与「发布 B 之后、删除 A
之前」各复核一次（第二次排除 B 自身）。

删除 A 失败时，系统 MUST 撤销本次新建的 B（清掉其发布文件）并保留 A，MUST NOT 报成成功，也
MUST NOT 改动原会话与 composer。任何失败路径 MUST NOT 先丢弃 A。

撤回 SHALL 只对**本进程发起的交互轮 / 重试轮**、或**恢复出来且本进程尚未跑过任何轮时的恢复
目标**开放：在途（含 `Finishing` 与待批）MUST 被拒绝（用户先停止）；cron / 自动唤醒 / 子运行推入
的用户项 MUST 被拒绝并给出原因——本进程一旦跑过任何轮（含上述非交互轮），轮次来源 SHALL 优先于
恢复目标，恢复目标 MUST NOT 越过来源闸复活。停止 SHALL 保持「不再继续、不回滚」的既有语义，
MUST NOT 被当作撤回。

撤回目标 SHALL 是**入队时记录的那一条交互用户消息**（input 与 panel 两份下标），MUST NOT 用
「输入里最后一条 `role=user`」反推——后台通知（blocked / 触顶分支）同样以 user 项进入 input、
以 notice 行进入面板，反推会把它当成目标、错删真实用户轮次并让工具清单从空切片起算。该轮之后
混入任何其它 user 项时，撤回 MUST 被拒绝（不得吞掉通知），且 MUST NOT 产生任何文件或 composer
变化。

恢复出来的会话 SHALL 在恢复时从灌回的 input 重建撤回目标：取**最后一条带交互来源标记的用户项**及
其在重建面板里的行下标。该标记 SHALL 是用户项顶层的机器字段（`lumir_user_origin`，值
`interactive`），只在交互发送 / 重试轮的入队点写入、随 `llm_request.messages` 与 `withdraw_seed`
持久化，发送给 provider 前 SHALL 剥除（provider 永不看见）；来源 MUST NOT 由正文文本推断——后台
通知的正文标记不是来源证据。留存没有该标记（本 change 之前的旧记录）、命中项没有面板行、或历史
已被压缩替换时，恢复出来的会话 MUST 视为没有可撤回目标并安全拒绝（`harness_withdraw_not_applicable`），
MUST NOT 猜一条目标，MUST NOT 给旧记录补写标记。

恢复件上的撤回 SHALL 删除**恢复来源 A 的留存**——恢复本身尚未发布任何轮次，当前会话没有自己的
文件；B 的 `restored_from` SHALL 指向 A。删除前 SHALL 先释放本会话对 A 的恢复占用，再按既有栅栏与
派生检测复核。删除前 SHALL 沿 A 的 `restored_from` 祖先链逐项比对，确认没有更早的留存仍包含被撤回
的那一条消息；命中时撤回 MUST 被拒绝（`harness_withdraw_copy_exists`）并点名那些留存，MUST NOT
静默留下副本；祖先不可读按扫描失败 fail closed。

派生检测 MUST 与「恢复」共享同一把进程级栅栏：恢复在读取源文件之前 SHALL 登记占用，撤回从
「检查占用 / 扫描派生」到「删除 A」MUST 全程持有该栅栏；有会话正在从 A 恢复（包括尚未发布的
惰性恢复，如独立 Runtime 的 cron 专用会话）时撤回 MUST 被拒绝。扫描 MUST fail closed——目录项
不可读、任一留存首行不可读即拒绝撤回，MUST NOT 跳过不可读候选后删除 A。

B 的 `assembly` MUST 原样沿用 A 的装配记录；读取失败或记录缺 `assembly` 时撤回 MUST 失败并保留
A，MUST NOT 把缺失读数伪装成空装配。

A 删除失败时若撤销 B 的发布文件也失败，系统 MUST 显式暴露「回滚未完成」终态（原会话保留、
新建会话残留、清单可能多一行），MUST NOT 报成干净的失败，也 MUST NOT 声称清单唯一。

工具副作用 MUST NOT 回滚。该轮出现过 `function_call` 时，首次调用 SHALL **不做任何动作**、只
回执工具名（去重、按出现序）；用户确认后再次调用才执行，届时全部校验与派生检测重新复跑。

composer 回填 SHALL 包含：用户消息的序列化文本（引用卡 / 消息摘录卡 / 图片占位按原交错）、
图片附件引用、**全部显式 Skill 名**（成功加载与被拒 / 不存在都在，按选择顺序去重——名单来自
用户项的 `lumir_skill_trace` 与 `lumir_skill` part 两处），光标落在原文末尾；Skill 名 SHALL 用
**完整原名**（trace 的展示名可能被截断，MUST NOT 兼任恢复协议；原名随 `lumir_skill_trace` 在
provider wire 前整体剥除），旧记录缺完整原名时 SHALL 回落展示名并安全降级（MUST NOT 从 `…` 猜测）；MUST NOT 包含自动
注入的「当前编辑器上下文」节，MUST NOT 包含显式 Skill 的正文（注入内容）。composer 原有内容非空时 SHALL 合并（撤回内容在前、
当前输入在后），MUST NOT 丢弃任何一边。

#### Scenario: 撤回后显示与上下文同时移除

- **WHEN** 用户对最近一条用户消息执行撤回且本轮没有任何工具调用
- **THEN** transcript 不再显示该消息及其后的 assistant 内容；composer 得到该消息原文且光标在末尾；
  下一条 `llm_request.messages` 不含该消息及其后任何项

#### Scenario: 原会话被物理删除、只剩新会话

- **WHEN** 撤回成功
- **THEN** 原会话 A 的 JSONL 不存在；A 的 vault 会话目录里有且只有 B 一份 JSONL；B 的首行
  `opened_from` 为 `withdraw` 且 `restored_from` 为 A 的 session id

#### Scenario: 撤回后切走会话再回来不复活

- **WHEN** 撤回成功后切到另一个会话，再从清单选中 B
- **THEN** B 从 `withdraw_seed` 恢复出撤回点之前的历史；被撤回的消息与其后轮次既不在面板上、
  也不在模型上下文里

#### Scenario: 在途先停止

- **WHEN** 轮次在跑（含等待批准）时请求撤回
- **THEN** 请求被拒绝（`harness_busy`），会话与文件都不变；用户停止本轮后再次撤回才执行

#### Scenario: 非交互来源不开放撤回

- **WHEN** 最近一轮来自 cron / 自动唤醒 / 子运行，或恢复出来的会话在本进程已经跑过这样的轮次
- **THEN** 撤回被拒绝（`harness_withdraw_not_applicable`），并给出「不是你在本窗口发出的消息」
  的原因；文件与会话均不变；恢复目标 MUST NOT 越过该来源闸复活

#### Scenario: 恢复出来的会话可撤回最近一条真实用户消息

- **WHEN** 用户从会话清单恢复一份普通交互会话（最后一条用户消息带交互来源标记），未发送任何新消息
  就请求撤回
- **THEN** 撤回照常执行：恢复来源 A 的留存被删除，B 从撤回点之前的前缀发布；composer 得到该消息
  原文；面板只剩撤回点之前的历史

#### Scenario: 恢复后切走再回来不复活

- **WHEN** 在恢复出来的会话里撤回成功，之后切到新会话再从清单选中 B
- **THEN** B 从 `withdraw_seed` 恢复出撤回点之前的历史；被撤回的消息与其后轮次既不在面板上、也不
  在磁盘的任何会话留存里

#### Scenario: 旧记录或压缩后的恢复没有可撤回目标

- **WHEN** 恢复一份本 change 之前写下的会话（用户项没有来源标记），或恢复一份历史已被压缩替换的
  会话
- **THEN** 快照的 `withdrawable` 为 false；撤回被拒绝（`harness_withdraw_not_applicable`）；文件与
  会话均不变，MUST NOT 按正文文本猜目标、MUST NOT 给旧记录补写标记

#### Scenario: 恢复件的尾部后台通知不被当成目标

- **WHEN** 恢复出来的会话在最后一条交互消息之后还有后台通知（input 里是 user 项、面板里是 notice 行）
- **THEN** 撤回被拒绝（`harness_withdraw_tail_notice`）；通知不被吞掉、不创建 B、composer 不变

#### Scenario: 恢复来源的更早留存仍含该消息时拒绝

- **WHEN** 恢复来源 A 自身是另一份会话的恢复件，且被撤回的消息仍存在于 A 的更早留存里
- **THEN** 撤回被拒绝（`harness_withdraw_copy_exists`，回执点名那些留存）；A 不被删除、不创建 B

#### Scenario: 派生会话在场时拒绝

- **WHEN** A 的 `restored_from` 链上存在其它留存文件
- **THEN** 撤回被拒绝（`harness_withdraw_derived_exists`，回执列出派生 session id）；A 与派生
  文件都不被删除、也不创建 B

#### Scenario: 删除原会话失败时回滚

- **WHEN** B 已发布但删除 A 的 JSONL 失败
- **THEN** 本次新建的 B 被清理，A 仍是当前会话且其文件仍在；回执为失败
  （`harness_withdraw_delete_failed`），composer 不被改写

#### Scenario: 工具副作用只告知不回滚

- **WHEN** 被撤回的那一轮执行过 `vault_patch` / `cli_run` 等工具
- **THEN** 首次撤回请求不产生任何动作，只回执工具名；确认后的撤回照常完成，但已产生的副作用
  不被回滚——确认文案如实列出工具名并说明不会撤销

#### Scenario: composer 回填保留卡片与 Skill 引用

- **WHEN** 被撤回的消息含引用卡 / 图片引用 / 显式 Skill 选择
- **THEN** composer 里出现相同的文本、卡片与图片引用、Skill 名；文本不含自动注入的编辑器上下文
  节，也不含 Skill 正文

#### Scenario: 撤回不复活重试与自动命名

- **WHEN** 撤回前这一轮处于可重试失败态，或自动命名任务在途
- **THEN** 撤回后旧重试动作失效（`harness_turn_stale` / `harness_no_failed_turn`）；旧命名任务
  因 `session_id` 不符被丢弃，不给 B 落标题

#### Scenario: 重复触发幂等

- **WHEN** 撤回成功后再次请求撤回
- **THEN** 请求被拒绝且不产生第二份 B、不删除任何文件；会话清单仍只有 B

#### Scenario: 尾部后台通知不被当成撤回目标

- **WHEN** 交互轮结束后到达一条 blocked / 触顶后台通知（input 里是 user 项、面板里是 notice 行），
  用户随即请求撤回
- **THEN** 撤回被拒绝（`harness_withdraw_tail_notice`）；会话、留存文件与 composer 都不变，通知
  不被吞掉；工具确认流程不启动

#### Scenario: 旧会话的迟到事件不进入新会话

- **WHEN** 撤回完成（A→B）后，旧 A 的后台线程仍发出 `subagent_started` / `notice` / `title` 事件
- **THEN** 面板按会话令牌丢弃这些事件：任务区不出现旧 run、transcript 不出现旧通知、标题不被旧
  标题覆盖；B 的新令牌事件照常上屏

#### Scenario: 恢复进行中拒绝撤回

- **WHEN** 另一个 Runtime（如 cron 专用会话）已开始从 A 恢复但尚未发布派生文件，用户请求撤回
- **THEN** 撤回被拒绝（`harness_withdraw_resume_in_flight`），A 的留存不动；该恢复会话结束后撤回
  恢复可用

#### Scenario: 不可读候选使撤回 fail closed

- **WHEN** 会话目录里存在首行不可读的 `.jsonl`（或目录项读取失败）
- **THEN** 撤回被拒绝（`harness_withdraw_scan_failed`）并点名该路径；MUST NOT 跳过它删除 A

#### Scenario: 装配记录不可读时保留原会话

- **WHEN** A 的留存首行不可读或缺少 `assembly`
- **THEN** 撤回被拒绝（`harness_withdraw_read_failed`），A 仍是当前会话且不创建 B

#### Scenario: 双故障如实暴露回滚未完成

- **WHEN** 删除 A 失败，随后清理新建的 B 也失败
- **THEN** 回执为 `harness_withdraw_rollback_incomplete`（附残留 B 的 session id）；A 仍是当前会话，
  清单可能同时出现 A 与 B，MUST NOT 报成「原会话与输入区均未改变」的干净失败

#### Scenario: 失败 / 被拒的显式 Skill 随撤回恢复

- **WHEN** 被撤回的消息包含一个成功加载的 Skill 与一个不存在 / 被拒的显式 Skill
- **THEN** composer 后端的 Skill 名单同时包含两者（按选择顺序去重），重发后两个 `/name` 仍是
  显式调用；Skill 正文不回填

