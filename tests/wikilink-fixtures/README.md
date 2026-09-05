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
- `pendingDecision`：该用例的期望值依赖 spec 中未定稿的裁决点时的临时标记；裁决落地后标记必须移除、期望转为硬断言。裁决点 G/H/I 已于 2026-09-05 全部定稿（G/H 按推荐值，I 改判为当前文件所在目录创建），当前用例集中无此标记。

### createCases（一键创建用例，喂 Rust `wikilink_create`；spec §4.4，裁决点 I）

每条：`{ id, from, link, expect }`。`from` / `link` 含义同 resolveCases；前提是该链接在 `from` 下解析为 `unresolved`。

- `expect.created`：创建成功后新增文件的 vault 根相对路径——path 段不含 `/` 时创建于 `from` 所在目录（`from` 在 vault 根时建于根）；path 段含 `/` 时按 vault 根相对路径创建并补齐中间目录。文件内容必须为空，且执行用例时不得改动 vault 内任何既有文件；
- "目标已存在"错误（索引过期时的运行时守卫，spec §4.4）无法在静态 vault 中建模——静态下创建路径被占用即意味着链接可解析、不属于 `unresolved`，故不设对应用例，由实现期单测直接构造。

## 消费纪律（双解析器纪律，架构复查 P1-4）

- 语义解析只有一份实现：Rust core link graph。`parseCases` 的解析字段、全部 `resolveCases` 与 `createCases` 由 Rust 单测断言；
- 前端只做 span 定位（装饰用途），断言语义前先经 invoke 取 Rust 结果；前端测试只断言 `parseCases` 的 `span`/`embed`；
- 任一侧与 cases.json 不一致即缺陷；修改 spec 必须同步修改本 fixture（spec §7）。
