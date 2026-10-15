# harness 增量规格

> 起草注记（非规格正文）：本 change 把 AGENTS 指令文件的自动装配从两层扩为三层，第三层为
> vault 根 `AGENTS.local.md`（本机本地覆盖层）。本增量只 MODIFY living spec 的
> 「AGENTS.md 自动加载」一条 requirement；装配顺序与覆盖语义的实现细节见
> [design.md](../../design.md) §2–§3。

## MODIFIED Requirements

### Requirement: AGENTS.md 自动加载

会话建立时，系统 SHALL 自动装配系统上下文，包含三层 AGENTS 指令文件内容，注入顺序为：user-wide（`~/.agents/AGENTS.md`）→ vault 根（`<vault>/AGENTS.md`）→ vault 根本地覆盖层（`<vault>/AGENTS.local.md`）。第三层 SHALL 排在 vault 根 `AGENTS.md` 之后注入，承担「本机本地覆盖层」语义——当两层对同一事项给出相互冲突的指示时，以后注入的 `AGENTS.local.md` 为准；该优先级口径 SHALL 在系统上下文中由 `AGENTS.local.md` 所在节的标题显式表达（模型读得到），MUST NOT 依赖模型从注入先后自行推断。三层文件各自不存在、非文件或读取失败时 SHALL 静默跳过（不注入、不告警、不阻断会话），与既有两层同口径；系统 SHALL NOT 为文件缺失或读取失败产出 config warning 或任何界面提示。装配清单（`session_open.assembly`，形态见「会话本地留存」）SHALL 为本层记一条来源条目，记录路径与存在与否（不存在的来源同样在场、`exists:false`）。嵌套子目录级 AGENTS 指令文件不在本期。requirement 名保留「AGENTS.md 自动加载」——`AGENTS.local.md` 属同一 AGENTS 指令文件族，本 change 的语义扩围以本条正文为准。

#### Scenario: 双层注入

- **WHEN** 两处 AGENTS.md（user-wide 与 vault 根）均存在并发起新会话
- **THEN** 系统上下文包含两份文件的内容；仅一处存在时注入存在的一份，不报错

#### Scenario: 本地层注入与顺序

- **WHEN** user-wide `~/.agents/AGENTS.md`、vault 根 `AGENTS.md`、vault 根 `AGENTS.local.md` 三处均存在并发起新会话
- **THEN** 系统上下文依次包含三份文件的内容；`AGENTS.local.md` 的内容在文本次序上晚于 vault 根 `AGENTS.md` 的内容

#### Scenario: 本地层缺失静默跳过

- **WHEN** vault 根 `AGENTS.local.md` 不存在（或非文件 / 读取失败），其余层照常存在，发起新会话
- **THEN** 系统上下文不包含本地层内容，会话正常建立，不产生告警或界面提示；其余各层的注入不受影响

#### Scenario: 装配清单记录本地层

- **WHEN** vault 根 `AGENTS.local.md` 不存在（或存在）并发起新会话
- **THEN** `session_open` 的装配清单含本地层来源条目：路径为 vault 根 `AGENTS.local.md`；不存在时 `exists:false` 且字节数为 0，存在时 `exists:true` 且字节数为该层注入文本的长度

#### Scenario: 覆盖语义随装配表达

- **WHEN** vault 根 `AGENTS.md` 与 vault 根 `AGENTS.local.md` 均存在且对同一事项给出相互冲突的指示
- **THEN** 系统上下文中 `AGENTS.local.md` 一节排在其后，且该节标题标明其为本地覆盖层、冲突时以该层为准；系统 MUST NOT 自行解析或合并两层的内容语义
