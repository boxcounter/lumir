# wikilink-resolution 增量规格

> 起草注记（非规格正文）：本 change 只改「未创建目标一键创建」一条——给一键创建补「索引外同名
> 探测」的前置判据：惰性目录里的同名笔记、多个候选、路径后缀命中都拒绝创建；探测不完整
> （超限 / 读不到 / vault 切换）同样拒绝。resolve 语义、创建位置、空文件与不覆盖语义全部不变。
> 机制、预算与安全边界见 [design.md](../../design.md)。MODIFIED 条基于当前 living spec
> （`openspec/specs/wikilink-resolution/spec.md`）的原文整块复制后改，未改动的段落逐字保留。

## MODIFIED Requirements

### Requirement: 未创建目标一键创建

系统 SHALL 提供 `wikilink_create` command 创建 `unresolved` 链接的目标文件：位置按裁决点 I（已定稿）——path 段不含 `/` 时创建于当前文件所在目录（当前文件在 vault 根时建于根）；path 段含 `/` 时按 vault 根相对路径创建并补齐中间目录。内容为空文件。该 command MUST NOT 覆盖或改写任何既有文件（ADR 0003 §3 铁律）；创建时发现目标已存在 SHALL 返回错误并触发重新解析。

一键创建 SHALL 在落盘前做一次**索引外同名探测**：链接解析只看索引，而索引按可见性规则建（惰性条目不进索引），因此「当前解析为 `unresolved`」不证明磁盘上没有同名笔记。探测 SHALL 覆盖 vault 内全部非 `hidden` 档目录（含配置 `lazy` 档与用户规则命中的惰性目录）、复用链接解析的**同一份**名称匹配语义（大小写折叠、alias、heading、`.md` 补全、根相对路径与路径后缀），MUST NOT 另写一套匹配规则。探测发现任一候选（解析为 `resolved` 或 `ambiguous`）SHALL 返回目标已存在错误（`wikilink_target_exists`）并触发重新解析；多个候选时 MUST NOT 选择其一、MUST NOT 自动打开或重绑。只有**完整扫描且零候选**才允许创建（`wikilink_create_failed` 之外的错误码不变）。

探测 SHALL 有界且无副作用：`hidden` 档子树 MUST NOT 遍历（它们不是候选来源）；符号链接目录 MUST NOT 跟随、MUST NOT 读取链接目标（链接条目本身按非目录候选参与匹配）；探测 MUST NOT 读取文档正文、MUST NOT 读新 `.gitignore`、MUST NOT 登记按需枚举的物化状态、MUST NOT 把结果合并进常驻索引（临时图用完即弃）。探测扫描 MUST NOT 持有 vault 状态锁（异步执行）；提交创建前 SHALL 重新核对 vault 根与打开世代，不一致即拒绝且两个 vault 都不得产生误写。扫描超限、目录或条目读取失败、异步任务异常一律视为「无法证明不存在」：SHALL 返回创建失败错误并 MUST NOT 创建文件。创建成功后的「创建并打开」与既有索引更新行为不变。

#### Scenario: 从根文件创建

- **WHEN** 在 `Alpha.md`（vault 根）中对 `[[不存在的笔记]]` 调用 `wikilink_create`
- **THEN** vault 根新增空文件 `不存在的笔记.md`，既有文件零改动；随后该链接重解析为 `resolved`（fixture c01）

#### Scenario: 从子目录文件创建

- **WHEN** 在 `folder/Gamma.md` 中对 `[[新笔记]]` 调用 `wikilink_create`
- **THEN** 新增空文件 `folder/新笔记.md`（当前文件所在目录，而非 vault 根），既有文件零改动（fixture c02）

#### Scenario: 创建不覆盖

- **WHEN** `wikilink_create` 的目标路径已存在文件（索引过期）
- **THEN** 返回错误并触发重新解析，MUST NOT 覆盖既有文件

#### Scenario: 惰性目录里的同名笔记

- **WHEN** 配置 `lazy` 档目录（如 `target/`）或用户规则命中的惰性目录（如 `.gitignore` 声明的 `drafts/`）里存在 `Note.md`，当前索引里没有它，用户在 `Alpha.md` 中对 `[[Note]]` 调用 `wikilink_create`
- **THEN** 返回 `wikilink_target_exists`（D192 文案），MUST NOT 在 `Alpha.md` 所在目录新建 `Note.md`；既有文件逐字节不变；常驻索引仍解析为 `unresolved`（惰性候选照旧不进索引）

#### Scenario: 多个同名候选不选择

- **WHEN** 两个或更多惰性目录里各有一份 `Note.md`（索引里都没有），调用 `wikilink_create` 创建 `[[Note]]`
- **THEN** 返回 `wikilink_target_exists`；MUST NOT 选择任一候选、MUST NOT 自动打开、MUST NOT 新建文件

#### Scenario: 路径后缀同名

- **WHEN** 链接为 `[[team/note]]`，而 `target/team/note.md`（路径后缀命中）存在于惰性目录，索引里没有它
- **THEN** 返回 `wikilink_target_exists`，MUST NOT 在 vault 根新建 `team/note.md`

#### Scenario: 探测不完整即拒绝

- **WHEN** 探测达到条目数 / 时长预算上限，或任一目录 / 条目读取失败
- **THEN** 返回 `wikilink_create_failed`（D194 文案），MUST NOT 创建任何文件——「无法证明不存在」不等于「不存在」

#### Scenario: hidden 档与符号链接边界

- **WHEN** `.git/Note.md` 只存在于 `hidden` 档子树；或符号链接目录指向 vault 外的同名文件；或 vault 内只有指向外部文件的符号链接 `Note.md`
- **THEN** hidden 子树与符号链接目录的内容不构成候选（前两种照常创建空文件，链接目标零访问）；符号链接条目自身可构成候选（第三种返回 `wikilink_target_exists`）

#### Scenario: 探测期间切换 vault

- **WHEN** 探测进行期间同一 vault 被重新打开（世代 +1）、或切换到另一个 vault
- **THEN** 提交段按根 + 世代对账拒绝，返回 `wikilink_create_failed`；旧、新两个 vault 都 MUST NOT 产生误写
