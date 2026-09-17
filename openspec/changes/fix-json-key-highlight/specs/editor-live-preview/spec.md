# editor-live-preview Specification

## ADDED Requirements

### Requirement: JSON 键名与值分色

json 文档里的**对象键** SHALL 以属性名配色（`--callout-note`）呈现，MUST NOT 与字符串值同色；字符串值 SHALL 保持字符串配色（`--callout-tip`），数字、布尔与 null 值 SHALL 保持字面量配色（`--callout-warning`）。该口径 SHALL 对任意键形态恒成立——顶层、嵌套对象与数组内对象里的键，纯数字键、非 ASCII 键、含点/冒号/空格/转义引号的键——MUST NOT 只对某一类键生效。键同时带 string 与 propertyName 两个 tag 时命中属性名规则；配色 MUST 只取自既有 editorial token，MUST NOT 为本次修复新增颜色。同一段 json 在 code 模式（只读 `.json` 文件）与 md 围栏 ```json 代码块里的配色 SHALL 一致。装饰 MUST NOT 改写文档内容，`EditorState.doc` 与磁盘文件逐字节不变（ADR 0003 §3 铁律）。

#### Scenario: .json 文件键与值分色

- **WHEN** 用户打开内容为 `{"name": "lumir", "count": 3}` 的 `.json` 文件（只读 code 模式）
- **THEN** `"name"` 以属性名色呈现、`"lumir"` 以字符串色呈现、`3` 以字面量色呈现，三者互不相同，且文件仍不可编辑

#### Scenario: 围栏 json 代码块同口径

- **WHEN** md 文档里有 ```json 围栏代码块 `{"name": "lumir", "count": 3}`
- **THEN** 块内键取属性名色、字符串值取字符串色，与打开 `.json` 文件时一致，且用色不越出既有 editorial token

#### Scenario: 键形态不影响判定

- **WHEN** json 文档的键是纯数字（`"123"`）、非 ASCII（`"中文键"`）、含点/冒号/空格或转义引号，或位于嵌套对象与数组内
- **THEN** 每个键都以属性名色呈现、每个字符串值都以字符串色呈现、字面量值都以字面量色呈现

#### Scenario: 其它语言的字符串键不跟着变

- **WHEN** md 围栏 ```javascript 代码块里出现对象字面量 `const a = {"name": "lumir"}`
- **THEN** 该字符串键仍取字符串色（json 的复合 token 修正 MUST NOT 外溢到 javascript/typescript）
