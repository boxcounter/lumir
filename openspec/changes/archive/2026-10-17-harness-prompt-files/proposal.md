# Proposal: harness 系统提示词固定段抽成仓内 Markdown 文件

- Change ID: harness-prompt-files
- 日期: 2026-10-17
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：
> 节点 1（提案评审）：2026-10-17 Alex 批准（tower 转达）。命名按 tower 裁决取 kebab-case：
> 文件名 `quote-reference.md`，id ↔ 文件名的唯一差异是 `_` ↔ `-`。
> 节点 2（归档评审）：留白（实现完成后填写）。
>
> 口径来源：本 change 的方案由 tower 与 Alex 讨论收敛、Alex 已裁决，本文照写，不再另设裁决点——
> ① 方案 A：抽成 Markdown 文件 + `include_str!` 编译期嵌入；
> ② 布局 `src-tauri/src/harness/prompts/identity.md`、`quote-reference.md`，与 harness 模块同目录；
> ③ 文件名与装配清单 `source` id 一一对应；
> ④ 装配顺序留在代码里（顺序是逻辑，内容是数据）；
> ⑤ 装配处统一 `trim_end()` 一次，装配输出逐字节不变；
> ⑥ `AssemblySource::fixed` 的 `path` 从此记录真实来源路径；
> ⑦ 排除运行期配置目录覆盖（方案 B）、raw string 半吊子（方案 C）、工具描述抽取（后续独立 change）。
>
> 命名口径（tower 裁决，2026-10-17）：文件名取 kebab-case `quote-reference.md`（与仓内文件命名
> 惯例一致），id ↔ 文件名的唯一差异是 `_` ↔ `-`——`quote_reference` ↔ `quote-reference.md`。

## Why

Alex 原话（2026-10-17）：「我希望 system prompt 更加易找到、易读，现在硬编码在代码文件里，不容易找到、也不易读。」

现状（`src-tauri/src/harness/context.rs:21-54`）：系统提示词的两段固定正文是 Rust 字符串字面量——身份段 `IDENTITY`（`context.rs:21`）与摘录回指纪律 `QUOTE_REFERENCE`（`context.rs:44`）。两段都用行尾 `\` 续行把长段落折叠进多行源码，引号写成 `\"`。读的时候必须在脑内把续行拼回一行才算看见真正注入的文本；改一个字要先弄清哪一行末尾有 `\`——有续行与无续行决定了注不注入换行。由此三个问题：

- **找不到**：提示词不是独立制品，找 prompt 文案只能靠全文搜索 Rust 源码，和工具实现、装配逻辑混在一起。
- **不易读、易改**：续行与转义是 Rust 语法噪声，与文案本身无关；任何修订都要求改代码的人先反解语法。
- **审计链断点**：`AssemblySource::fixed` 的 `path` 恒为 `null`（`context.rs:64` 的注释自认「固定段与 Skill 索引无单一文件来源」）。会话留存 `session_open.assembly` 里这两段没有可追溯的来源；改造后文件就是来源，`null` 不再成立。

事实依据均为本仓现状：两条常量与 `fixed` 的实现（`src-tauri/src/harness/context.rs:21-54`、`75-84`），以及验收场景 105 对 `"path":null` 的断言（`scripts/acceptance/scenarios/105-harness-wire-retention.md:48-49`）——后者证明 `path:null` 已是外部可观察事实，改它必须同步改断言。

## What Changes

对应 `specs/harness/spec.md` 增量中的 1 个 ADDED requirement（「系统提示词固定段来源」）。逐条：

1. **唯一真源落到仓内 Markdown**：两段固定正文分别迁到 `src-tauri/src/harness/prompts/identity.md`（来源 id `identity`）与 `src-tauri/src/harness/prompts/quote-reference.md`（来源 id `quote_reference`），经 `include_str!` 编译期嵌入。运行期 MUST NOT 从配置目录 / vault 读取覆盖。
2. **文件名与来源 id 一一对应**：`identity` ↔ `identity.md`，`quote_reference` ↔ `quote-reference.md`；唯一差异是 `_` ↔ `-` 的命名转换。代码侧同时保留指向该文件的仓内路径常量，使「id → 文件」与「文件 → id」双向 grep 可达。
3. **装配顺序仍是代码逻辑**：identity → quote_reference → AGENTS 三层 → Skill 索引，顺序由 `assemble_system` 的调用序决定，MUST NOT 改为目录枚举或文件名字典序（新增一个 `.md` 不得改变装配结果）。
4. **装配处统一 `trim_end()` 一次**：消化文件尾换行 / 行尾空白与既有字面量的差异；注入文本其余字节与文件正文逐字节一致（不重排、不重折行）。**装配输出逐字节不变**是本 change 的硬验收（见 Impact）。
5. **装配清单补齐审计链**：固定段条目的 `path` 记录来源文件的**仓内相对路径**（`src-tauri/src/harness/prompts/identity.md` / `.../quote-reference.md`），不再为 `null`；`exists` 恒 `true`；`bytes` 仍为注入（trim 后）文本的字节数。MUST NOT 记录构建机绝对路径——那会把本机用户名写进会话留存（仓库信息卫生纪律）。

## Non-goals

- **运行期覆盖（方案 B）**：不新增「从配置目录 / vault 读提示词」的入口——多一个漂移面，且本次目标是「易找到、易读」，不是「可定制」。
- **raw string 半吊子（方案 C）**：把字面量换成 `r#"…"#` 仍留在代码文件里，只消转义噪声、不解决「找不到」，还会让两种写法长期并存。MUST NOT 保留旧 Rust 字面量作为后备。
- **工具描述抽取**：工具 schema 的 `description` 字符串不在本期（另一类制品：随工具定义与参数 schema 一起演进），留给后续独立 change。
- **Prompt 文案改动**：本次是纯搬迁，文案一个字都不改；任何文案修订都属另一次 change。
- **运行期热更新 / 文件监听 / 重装机制**：提示词是编译期常量，改文案要重新构建。
- **前端 / UI**：装配清单不被前端消费（`src/` 无 `session_open.assembly` 读者），无界面变化。
- **`AssemblySource` 序列化形状**：字段名与字段集不变，只填实既有 `path` 字段的取值；无 ts-rs 导出面变化。

## Impact

- **影响的 specs**：`harness`（ADDED ×1：「系统提示词固定段来源」）。
- **影响的代码 / 系统**：`src-tauri/src/harness/context.rs`——两常量改为 `include_str!` 嵌入 + 装配处 `trim_end()`，`AssemblySource::fixed` 增 path 参数，模块头注释改为指向提示词文件；新增 `src-tauri/src/harness/prompts/` 下两个 Markdown 文件。无工具集 / 权限 / 配置 schema / 前端改动。
- **外部可观察面**：会话 JSONL 首行的 `session_open.assembly` 中，`identity` / `quote_reference` 两段的 `path` 从 `null` 变仓内相对路径，`bytes` 不变（trim 后文本与迁移前逐字节相同）。`src/` 零消费者；仅验收套件与 dogfood 审计会读到。**验收场景 105 的固定段断言须同步改**（`105-harness-wire-retention.md:48-49` 现断言 `"path":null`，不改必红）；`src-tauri/src/harness/jsonl.rs:372-374` 的 `path:null` 只是序列化单测的自造 fixture、不断言 `assemble_system`，可不动。
- **行为不变证明（本 change 的验收口径）**：
  - 迁移期一次性判据：以确定性夹具（隔离空 HOME + 空 vault、无 AGENTS.md、无 Skill）调用 `assemble_system`，迁移前后各捕获一次全文，**`diff` 为空**（逐字节相同）；两次捕获件落 `test-results/`（git 外）并在完成报告给出绝对路径。
  - 常驻判据：Rust 单测钉住两段固定文本的字节指纹（迁移前字面量算出的 FNV-1a hash 常量）、来源文件与嵌入文本同源、尾空白不进入注入文本、清单 path / exists / bytes 形状、既有内容断言（`context.rs:412` 的「Lumir 的内置助手」等）原样通过；`cargo test` 全绿 + `scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行与退出码）。
  - 用指纹而不是 golden 全文副本：REVIEW.md「同一语义两处真源」——搬迁后不得留第二份正文副本；指纹能抓住任何字节漂移，又不制造一份会腐烂的 prompt 抄本。
- **关联约束**：ADR 0002 §6 性能合同（编译期嵌入 = 运行期零文件 I/O，会话装配路径不比现状慢）；ADR 0003 §3 铁律（只读，不触碰 vault 源文件）；仓库信息卫生（提示词与测试 fixture 全部合成文案；清单路径 MUST NOT 含本机绝对路径）。

## 观测闸三问（低成本口径）

- **怎么知道开发者用了它**：`rg 'Lumir 的内置助手' src-tauri/src/harness/prompts/` 一步命中（改造前要穿过 Rust 续行噪声）；`rg 'quote_reference'` 双向可达代码与文件名。
- **怎么知道它有效（行为未变）**：机器判据——迁移前后装配输出 diff 为空、字节指纹单测、`cargo test` 全绿、`scripts/gate.sh quick` 全绿。
- **出问题怎么发现**：字节指纹、清单 path / exists / bytes 断言、验收场景 105 三处，任一漂移即红。
