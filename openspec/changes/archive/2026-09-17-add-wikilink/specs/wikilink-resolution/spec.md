# wikilink-resolution 增量规格

## ADDED Requirements

### Requirement: wikilink 词法识别与分解

系统 SHALL 按冻结的链接语义 spec（docs/specs/wikilink/link-semantics.md §2）识别并分解 wikilink：`[[target]]`、`[[target|alias]]`、`[[target#heading]]`（含多级 heading path 与 alias 组合）及 `![[...]]` embed 形态。inline code、fenced code block、frontmatter 内部的 `[[...]]` MUST NOT 识别为链接；空 target、含嵌套方括号的序列 MUST NOT 识别为链接；含 `#^` 块引用段的链接 SHALL 标记为不支持的语法（spec §6）。

#### Scenario: 全形态识别

- **WHEN** 对 `tests/wikilink-fixtures/cases.json` 的全部 parseCases 执行解析
- **THEN** 每条用例的 `span`/`embed`/`path`/`headingPath`/`alias`/`blockRef` 与期望一致

#### Scenario: 上下文排除

- **WHEN** `[[Beta]]` 出现在 inline code、fenced code block 或 frontmatter 内部
- **THEN** 该序列不被识别为 wikilink

### Requirement: 名称→路径解析

系统 SHALL 在 Rust core 的 link graph 模块维护 vault 名称→路径索引，并按 spec §3 解析：根相对精确路径优先，短路径候选集按大小写不敏感匹配；零候选为 `unresolved`，唯一候选为 `resolved`，多候选为 `ambiguous` 且按裁决点 G 的规则确定 `chosen`。索引 SHALL 随 vault 打开建立、随 `fs:entry_changed` 增量维护，同一 vault 两次打开的解析结果 MUST 一致（确定性）。

#### Scenario: 短路径歧义

- **WHEN** vault 含 `Beta.md` 与 `folder/Beta.md`，解析 `[[Beta]]`
- **THEN** 结果为 `ambiguous`，`chosen` 与 `candidates` 符合裁决点 G 规则（fixture r01）

#### Scenario: 大小写不敏感

- **WHEN** vault 含 `Case Note.md`，解析 `[[case note]]` 或 `[[CASE NOTE]]`
- **THEN** 均解析到 `Case Note.md`（fixture r04、r05）

### Requirement: 标题锚点解析

文件解析成功后，系统 SHALL 按 spec §3.3 在该文件标题树中逐段下钻匹配 heading path：匹配标题文本、与层级无关、无 slug 变换、大小写口径按裁决点 H。锚点缺失 SHALL 作为解析结果的一部分返回（打开文件并提示的语义归 wikilink-navigation），MUST NOT 导致整条链接判为 `unresolved`。

#### Scenario: 逐段下钻

- **WHEN** 解析 `[[Gamma#设计#子点]]`（fixture r09）
- **THEN** 文件解析到 `folder/Gamma.md` 且锚点命中标题"子点"；`[[Gamma#实现#子点]]` 锚点缺失（fixture r10）

### Requirement: `![[...]]` 双语义判别

系统 SHALL 按 spec §5 对 `![[...]]` 按解析结果判别：解析到非 `.md` 文件为附件引用，解析到 `.md` 文件为笔记内容嵌入（不支持递归渲染，ADR 0003 §2），`unresolved` 为缺失。判别结果 SHALL 作为解析输出的一部分供前端显示层使用。

#### Scenario: 附件与笔记嵌入区分

- **WHEN** 分别解析 `![[photo.png]]` 与 `![[Beta]]`（fixture r16、r17）
- **THEN** 前者判别为附件引用并解析到 `assets/photo.png`，后者判别为笔记内容嵌入

### Requirement: 单实现解析纪律

wikilink 语义解析（spec §2–§5）SHALL 在 Rust core 实现且仅实现一份（架构复查 P1-4）；webview 层 MUST NOT 复制任何解析语义，其链接 span 定位之外的语义判断一律经 invoke 查询 Rust 结果。

#### Scenario: fixture 双喂

- **WHEN** CI 运行 wikilink 测试
- **THEN** Rust 单测断言 cases.json 全部 parse/resolve/create 用例，前端测试仅断言 parseCases 的 span/embed，两侧消费同一文件

### Requirement: 未创建目标一键创建

系统 SHALL 提供 `wikilink_create` command 创建 `unresolved` 链接的目标文件：位置按裁决点 I（已定稿）——path 段不含 `/` 时创建于当前文件所在目录（当前文件在 vault 根时建于根）；path 段含 `/` 时按 vault 根相对路径创建并补齐中间目录。内容为空文件。该 command MUST NOT 覆盖或改写任何既有文件（ADR 0003 §3 铁律）；创建时发现目标已存在 SHALL 返回错误并触发重新解析。

#### Scenario: 从根文件创建

- **WHEN** 在 `Alpha.md`（vault 根）中对 `[[不存在的笔记]]` 调用 `wikilink_create`
- **THEN** vault 根新增空文件 `不存在的笔记.md`，既有文件零改动；随后该链接重解析为 `resolved`（fixture c01）

#### Scenario: 从子目录文件创建

- **WHEN** 在 `folder/Gamma.md` 中对 `[[新笔记]]` 调用 `wikilink_create`
- **THEN** 新增空文件 `folder/新笔记.md`（当前文件所在目录，而非 vault 根），既有文件零改动（fixture c02）

#### Scenario: 创建不覆盖

- **WHEN** `wikilink_create` 的目标路径已存在文件（索引过期）
- **THEN** 返回错误并触发重新解析，MUST NOT 覆盖既有文件
