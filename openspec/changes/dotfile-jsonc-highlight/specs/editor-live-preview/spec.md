# editor-live-preview 增量规格

## ADDED Requirements

### Requirement: dotfile 与 JSONC 文件的语法高亮

打开 `.gitignore`、`.gitattributes`（按 basename **精确、大小写敏感**匹配）与
`.jsonc`（按扩展名）文件时，编辑器 SHALL 以 code 模式按对应语言着色：gitignore 的
`#` 注释、行首 `!` 取反标记与行尾 `/` 目录标记、gitattributes 的属性名与
`attr=value` 值、jsonc 的 `//` 与 `/* */` 注释、对象键、字符串、数字与布尔各归其
语义配色。文件名匹配 SHALL 优先于扩展名匹配（basename 约定是比扩展名更具体的信号）；
两个匹配表的键集 MUST 不重叠。未收录的 dotfile 与未收录扩展名 SHALL 保持纯文本
（MUST NOT 用近似 parser 冒充着色——既有口径不变）。配色 MUST 只取自既有 editorial
token，MUST NOT 为本次新增颜色。着色 MUST NOT 改写文档内容，`EditorState.doc` 与
磁盘文件逐字节不变（ADR 0003 §3 铁律）。同一段内容在围栏代码块（`gitignore` /
`gitattributes` / `jsonc` 三个 info string）与整文件打开时 SHALL 得到同一套 tag 与
配色——该一致性
SHALL 由两侧共用同一张语言表（`src/preview/code.ts` 的 `LANGUAGES`）保证，MUST NOT
由两侧各自维护。

#### Scenario: .gitignore 的注释与取反着色

- **WHEN** 用户打开内容为 `# comment`、`!keep.txt`、`build/` 三行的 `.gitignore`
  文件（code 模式）
- **THEN** `#` 至行尾取注释配色、行首 `!` 与行尾 `/` 取关键字配色，模式本体保持
  正文色，文档逐字节不变

#### Scenario: .gitattributes 的属性与值着色

- **WHEN** 用户打开内容为 `*.md text eol=lf` 的 `.gitattributes` 文件
- **THEN** `text` / `eol` 取属性名配色、`lf` 取字符串配色、`#` 注释行取注释配色，
  行首 pattern 保持正文色

#### Scenario: .jsonc 的注释与尾逗号

- **WHEN** 用户打开含 `//` 行注释、`/* */` 块注释与对象尾逗号的 `.jsonc` 文件
- **THEN** 注释取注释配色、对象键取属性名配色、字符串值与数字各归其配色，尾逗号
  不产生 error 着色；同一段内容在 md 围栏 `jsonc` 代码块里取到同一套配色

#### Scenario: 未收录 dotfile 保持纯文本

- **WHEN** 用户打开 `.secret`、`.env.local` 等未收录的 dotfile
- **THEN** 文件仍以 code 模式打开但按纯文本显示原文，不着色

#### Scenario: 文件名匹配优先于扩展名

- **WHEN** 某 basename 同时能命中文件名表与扩展名表（构造用例）
- **THEN** 按文件名表的条目裁决分类与语言

### Requirement: dotfile 与 JSONC 文件的可编辑性

`.gitignore`、`.gitattributes`、`.jsonc` 文件 SHALL 随注册表文件类（code 类）经
非 md 文本文件可编辑通道（change `editable-non-md-files`，M231）可编辑：编辑产生
dirty、Cmd+S 与自动保存、CAS 冲突恢复、崩溃备份、外部修改重载与 md 走同一保存链路。
可编辑性 SHALL 只由注册表文件类推导——本 capability MUST NOT 为这三类文件单设
可编辑开关或第二份白名单（REVIEW.md 第 8 条双表漂移防线）。若可编辑通道按白名单
形态落地，这三类 SHALL 在白名单内。可编辑通道落地前，三类文件维持只读 code 模式
（着色不受影响）。

#### Scenario: 三类文件随可编辑通道可编辑

- **WHEN** 非 md 可编辑通道已落地，用户打开 `.gitignore`（或 `.gitattributes` /
  `.jsonc`）并编辑、保存
- **THEN** 编辑落盘成功，保存链路（Cmd+S / 自动保存 / 冲突恢复）与 md 同口径；
  可编辑性的来源是注册表文件类，不存在仅作用于这三类文件的独立开关
