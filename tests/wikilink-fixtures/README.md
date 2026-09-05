# tests/wikilink-fixtures/

Wikilink 链接语义的**合成 fixture 集**——冻结 spec [docs/specs/wikilink/link-semantics.md](../../docs/specs/wikilink/link-semantics.md) 的机器可执行形态（ADR 0003 §4，2026-09-05 裁决口径：人工合成、覆盖 spec 全部语法形态；公开仓库不含真实 vault 内容）。

## 结构

- `vault/`：合成 vault。真实文件，覆盖：同名歧义（`Beta.md` / `folder/Beta.md`）、大小写（`Case Note.md`）、CJK 文件名（`中文笔记.md`）、子目录唯一短路径（`sub/Deep Note.md`）、带层级标题的锚点目标（`folder/Gamma.md`）、附件（`assets/*.png`）、汇集各形态的源笔记（`Alpha.md`）。
- `cases.json`：全部判定用例，单一权威来源（single source of truth）。

## cases.json 格式

顶层字段：

- `version` / `spec`：fixture 格式版本与对应 spec 路径；
- `vaultRoot`：resolve 用例的 vault 根（相对本目录）；
- `spanUnit: "unicode-code-point"`：span 偏移按 Unicode code point 计数。消费方各自换算：Rust 用 `chars()`，JS 用 `[...s]` 展开后的下标（不要用 UTF-16 码元或字节偏移直接比较）。

### parseCases（词法用例，喂 Rust 解析器与前端 span 定位两侧）

每条：`{ id, input, expect: { links: [...] } }`。

- `input`：一段独立文本（可含换行，覆盖 code fence / frontmatter 等上下文）。
- `expect.links[]`：每条被识别出的 wikilink：
  - `span: [start, end)`——整条链接的范围，**含 `!` 前缀**；
  - `embed`：是否 `![[...]]` 形态；
  - `path`：target 的 path 段（去首尾空白后，原文形态，不做大小写折叠）；
  - `headingPath`：heading 各段（去空白、空段已剔除；块引用段保留 `^` 前缀原文）；
  - `alias`：显示别名，`null` = 无 `|`；
  - `blockRef`：含 `#^` 块引用段（spec §6：不支持）。
- `expect.links` 为空数组 = 该 input 中没有任何 wikilink（负例）。

前端 span 定位只需断言 `span` 与 `embed`；解析字段由 Rust 侧断言。

### resolveCases（解析用例，喂 Rust link graph；以 `vault/` 为输入）

每条：`{ id, from, link, expect, pendingDecision? }`。

- `from`：发起链接的文件（vault 根相对路径），`[[#heading]]` 等当前文件链接以此为基准；
- `link`：链接原文；
- `expect.status`：`resolved` / `ambiguous` / `unresolved` / `unsupported`（块引用）；
- `expect.path`：解析结果的 vault 根相对路径（ambiguous 时为 `chosen`）；
- `expect.candidates`：歧义时的全部候选（有序性不作要求，按集合比较）；
- `expect.embedTarget`：`attachment` / `note`——`![[...]]` 双语义判别结果（spec §5）；
- `expect.anchor`：`{ status: "found", heading }` / `{ status: "missing" }` / `{ status: "none" }`。`found` 时按 spec §3.3 逐段下钻后落点标题的文本等于 `heading`；
- `pendingDecision`：该用例的期望值依赖 spec 中标注的 ⚠ 裁决点（`G` = 短路径歧义选取规则、`H` = 标题锚点大小写）。裁决结果与推荐值相反时，翻转该用例期望并更新 spec，fixture 与 spec 必须同步变更。

## 消费纪律（双解析器纪律，架构复查 P1-4）

- 语义解析只有一份实现：Rust core link graph。`parseCases` 的解析字段与全部 `resolveCases` 由 Rust 单测断言；
- 前端只做 span 定位（装饰用途），断言语义前先经 invoke 取 Rust 结果；前端测试只断言 `parseCases` 的 `span`/`embed`；
- 任一侧与 cases.json 不一致即缺陷；修改 spec 必须同步修改本 fixture（spec §7）。
