# harness 增量规格

> 起草注记（非规格正文）：本 change 把系统提示词的两段固定正文从 Rust 字面量搬到仓内
> Markdown 文件（编译期嵌入），并让装配清单的固定段条目记录真实来源路径。本增量只 ADD 一条
> requirement；「AGENTS.md 自动加载」与「会话本地留存」正文不变——固定段 `path` 从 `null`
> 变仓内相对路径属于既有的「记录路径」措辞的填实，不构成 requirement 修改。

## ADDED Requirements

### Requirement: 系统提示词固定段来源

系统提示词的两段固定正文——身份段（装配清单来源 id `identity`）与摘录回指纪律（来源 id `quote_reference`）——SHALL 以仓内 Markdown 文件为**唯一**真源：`src-tauri/src/harness/prompts/identity.md` 与 `src-tauri/src/harness/prompts/quote-reference.md`，经编译期嵌入进入程序。文件名与来源 id SHALL 一一对应（`identity` ↔ `identity.md`、`quote_reference` ↔ `quote-reference.md`，仅 `_` ↔ `-` 的命名转换不同），使「id → 文件」与「文件 → id」双向可检索；代码侧 SHALL 同时保留指向来源文件的仓内路径常量。系统 MUST NOT 在运行期从配置目录、vault 或任何外部路径读取这两段正文的覆盖内容，也 MUST NOT 在代码里保留第二份正文副本。

固定段的注入顺序 SHALL 仍由装配代码决定（identity → quote_reference → AGENTS.md 三层 → Skill 索引），MUST NOT 改为目录枚举顺序或文件名字典序——`prompts/` 目录内新增或重命名其他文件 MUST NOT 改变装配结果。装配处 SHALL 消化来源文件的末尾空白（每段统一 trim 一次，消化文件尾换行与既有字面量的差异），注入文本其余字节 SHALL 与来源文件正文逐字节一致（MUST NOT 重排、重折行、转义改写）；文件尾换行 / 行尾空白 MUST NOT 进入注入文本，固定段与相邻节的拼接格式（`\n\n===== 标题 =====\n` + 正文）SHALL 与改造前逐字节一致。

装配清单（`session_open.assembly`，形态见「会话本地留存」）中这两段的条目 SHALL 记录来源文件的**仓内相对路径**（`src-tauri/src/harness/prompts/identity.md` / `src-tauri/src/harness/prompts/quote-reference.md`）：`path` MUST NOT 为 `null`，MUST NOT 为构建机绝对路径（绝对路径会把本机用户名写进会话留存）；`exists` SHALL 恒为 `true`，`bytes` SHALL 为注入（trim 后）文本的字节数。

#### Scenario: 固定段正文来自仓内文件

- **WHEN** 修改 `src-tauri/src/harness/prompts/identity.md` 或 `quote-reference.md` 的正文，重新构建并发起新会话
- **THEN** 系统提示词中对应固定段逐字节等于文件正文（去掉末尾空白），不残留旧的硬编码文案

#### Scenario: 尾空白不进入注入文本

- **WHEN** 来源文件以换行（或行尾空白）结尾
- **THEN** 注入文本不以该换行 / 空白结尾，且固定段的拼接格式与改造前的装配输出逐字节一致

#### Scenario: 装配清单记录固定段来源路径

- **WHEN** 发起新会话
- **THEN** `session_open.assembly` 的 `identity` / `quote_reference` 条目 `source` 与文件名一一对应，`path` 为上述仓内相对路径（非 `null`、非绝对路径），`exists` 为 `true`，`bytes` 等于注入文本的字节数

#### Scenario: 装配顺序不随目录内容变化

- **WHEN** `prompts/` 目录内新增或重命名其他文件
- **THEN** 固定段的注入顺序仍为 identity → quote_reference，装配结果不随目录枚举顺序或文件名字典序变化
