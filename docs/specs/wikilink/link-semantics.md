# Wikilink 链接语义 spec（冻结 v1.0）

- 状态: frozen v1.0
- 日期: 2026-09-05
- 依据: [ADR 0003 §4](../../adr/0003-obsidian-compatibility-scope.md)（兼容性本体 = 冻结的 spec + fixture 测试集）
- Fixture: [tests/wikilink-fixtures/](../../../tests/wikilink-fixtures/)（本 spec 的机器可执行形态）

## 0. 地位与措辞纪律

本 spec 是 Lumir 对 wikilink 链接语义的**冻结定义**，是兼容性本体（ADR 0003 §4）：解析与跳转行为以本文为准，不以任何第三方实现的运行时行为为准。wikilink 语法是 wiki 时代的公共遗产，但解析语义无正式规范，现存行为是 Obsidian 方言且随版本漂移（ADR 0003 Context）；本 spec 取其阅读与导航语义中稳定、可验证的子集冻结成文。

对外与对内的统一措辞：**"兼容 Obsidian 方言的阅读与导航语义"**。禁止使用"兼容 Obsidian"（ADR 0003 §5：前者可验证，后者是无限责任）。本 spec 按 ADR 0003 §6 的既定计划作为独立公共件对外发布，措辞因此保持实现中立——本文不假定读者是 Lumir 用户。

铁律（ADR 0003 §3）：**Lumir 永不改写源文件格式**。本 spec 全部是读取侧义务；唯一的写入动作是"未创建链接的一键创建"（§4.4），且只允许创建新文件，不允许修改任何既有文件。

本 spec 同时作为 AI agent 的开发指令（ADR 0003 §4）：实现行为与本 spec 冲突时，以本 spec 为准并修订实现；发现本 spec 无法回答的行为问题时，按 §7 的修订纪律处理，不在代码里私造语义。

## 1. 范围

**在范围内**（ADR 0003 §1）：

- wikilink 解析与跳转：`[[note]]`、`[[note|alias]]`、`[[note#heading]]`（含 `[[note#heading|alias]]` 与多级 `[[note#A#B]]`）；
- 未创建链接的区分显示与一键创建；
- link graph 作为只读派生物，产出 backlinks；
- `![[...]]` 的**判别**：按解析结果区分"附件引用"与"笔记内容嵌入"（§5）。

**明确排除**（ADR 0003 §2，声明不做，不是"以后再做"）：

- `![[note]]` / `![[note#heading]]` 内容嵌入（transclusion）的递归渲染；
- `[[note#^block]]` 块引用；
- Dataview 查询、Canvas、一切插件语义。

## 2. 词法：什么是一条 wikilink

### 2.1 形态

一条 wikilink 由定界符与三段可选部分构成：

```
[[target]]                  基本形态
[[target|alias]]            带显示别名
![[target]]                 embed 前缀（语义判别见 §5）
```

- `target`：链接目标，非空。可含 `#` 段（见 §2.2）与 `/` 路径分隔。
- `alias`：显示文本。由 target 之后**第一个** `|` 分隔；alias 内允许再出现 `|`（`[[a|b|c]]` 的 alias 为 `b|c`）。alias 为空串（`[[note|]]`）时回落为按 target 显示。
- `!` 前缀：紧邻 `[[` 前的单个 `!` 构成 embed 形态；它只改变语义判别（§5），不改变 target 解析规则。

### 2.2 target 的分解

target 按 `#` 分解为 **path 段** 与 **heading path 段序列**：

```
[[folder/note#一级标题#二级标题]]
 └─────┬────┘ └───┬───┘ └───┬───┘
   path 段      段 1        段 2
```

- path 段 = 首个 `#` 之前的部分，可为空（`[[#heading]]` 指向当前文件内的标题）。
- heading path 段序列 = 其后按 `#` 切分的各段，逐段下钻匹配（§3.3）。
- 每个段去首尾空白后参与解析；target 整体也先去首尾空白（`[[ Beta ]]` 等价 `[[Beta]]`）。
- 空 heading 段忽略：`[[note#]]` 按 `[[note]]` 处理。
- 以 `#^` 开头的段是块引用（如 `[[note#^abc123]]`）：**不支持**，整条链接标记为"不支持的语法"（§6），不做任何解析。
- 已知边界：每个 `#` 都是分隔符，因此标题文本本身含 `#` 的标题（如 `C# 入门`）无法被精确锚定。这是与 Obsidian 方言一致的结构性限制，不引入转义机制。

### 2.3 不解析为链接的位置

以下位置出现的 `[[...]]` 字符序列**不是** wikilink，按原文显示：

- inline code（反引号包裹）与 fenced code block 内部；
- frontmatter（文件首部 `---` 包围的 YAML 区块）内部——frontmatter 的展示归 properties 区块，本 spec 不从其中提取链接；
- 标准 Markdown 链接 `[text](url)`、图片 `![alt](url)` 内部（它们不是 wikilink 语法）。

### 2.4 非法形态

以下不视为 wikilink，原样显示，不报"不支持的语法"：

- 空 target：`[[]]`、`[[ ]]`（去空白后为空）；
- target 内含 `[` 或 `]`（wikilink 不嵌套）。

## 3. 解析：target →  vault 内目标

解析输出三态：`resolved(path)` / `ambiguous(chosen, candidates)` / `unresolved`。解析全程**只读**。

### 3.1 文件名匹配的大小写

path 段的文件名匹配**大小写不敏感**：`[[case note]]`、`[[CASE NOTE]]` 均解析到 `Case Note.md`。理由：Obsidian 的 wikilink 解析大小写不敏感（[官方论坛确认](https://forum.obsidian.md/t/maintain-casing-of-text-when-using-link-autosuggestion/23041)），且主流文件系统（macOS 默认 APFS、Windows NTFS）本身大小写不敏感，敏感匹配会在真实 vault 上制造不可解析链接。若大小写折叠后候选增多，精确大小写匹配者优先于折叠匹配者。

### 3.2 path 段 → 文件

按以下顺序，命中即停：

1. **根相对精确路径**：path 段含 `/` 时，按 vault 根相对路径匹配 `<path>.md` 或 `<path>`（path 段自带 `.md` 后缀时等价处理）。不支持 `..` 与 `./`，含它们的 target 直接判 `unresolved`。
2. **短路径匹配**：path 段不含 `/` 时，在 vault 全部 `.md` 文件中找"文件名去扩展名后经 §3.1 大小写规则等于 path 段"的候选集：
   - 恰一个候选 → `resolved`；
   - 零个候选 → `unresolved`（未创建链接，§4.3）；
   - 多个候选 → `ambiguous`，按 ⚠ 裁决点 G 的规则选出 `chosen`。
3. path 段含 `/` 但第 1 步未命中时，按"路径后缀匹配"再走一次候选集逻辑（vault 内路径以 `/<path>.md` 结尾的文件），候选集规则同第 2 步。

**⚠ 裁决点 G——短路径歧义的选取规则**（本 spec 冻结的推荐值，提交 Alex 节点 1 确认）：

- 候选按相对路径的**段数最少**优先；并列时取路径**字典序第一**；
- 选出的 `chosen` 正常参与跳转，但链接 MUST 带歧义标识（§4.2），让用户知道存在其他同名笔记；
- 备选方案：仿 Obsidian"最短路径优先"但不给歧义标识。不推荐——静默猜测在知识库里是错误放大器。

该规则是**确定性**的：同一 vault 两次打开结果一致，与文件 mtime、扫描顺序无关。

### 3.3 heading path → 文件内锚点

文件解析成功后，heading path 各段在该文件的标题树中**逐段下钻**匹配：

- 匹配对象：ATX 标题（`#` 前缀）的**文本**，与标题层级无关——`[[note#设计]]` 匹配文本为"设计"的任何层级标题；
- 多级：`[[note#A#B]]` 在 A 标题的子树内找 B；任一段找不到即锚点缺失；
- 段文本去首尾空白后比较；
- **⚠ 裁决点 H——标题锚点匹配的大小写**（推荐值，提交 Alex 节点 1 确认）：**大小写敏感**精确匹配。理由：标题文本是作者写的自然语言，大小写折叠会把"Overview"与"overview"两类不同标题混为一谈，误匹配比漏匹配更难发现；大小写不敏感的文件名匹配（§3.1）是文件系统现实所迫，标题无此约束。备选：大小写不敏感。
- 标题锚点**无 slug 规则**：不做小写化、空格转连字符等任何 slug 变换，也不生成锚点 id。这与 GFM 锚点互不兼容是 Obsidian 方言的既定事实（ADR 0003 Context，[官方论坛记录](https://forum.obsidian.md/t/heading-link-compatibility/46988)），本 spec 原样冻结，不发明兼容层。

锚点缺失时跳转语义：打开目标文件并提示"标题未找到"（§4.2），MUST NOT 静默停在文件顶部而不给提示。

### 3.4 path 段为空（`[[#heading]]`）

目标文件 = 当前文件本身，按 §3.3 解析锚点。当前文件内锚点缺失时按 §3.3 末段处理。

## 4. 显示与导航语义

### 4.1 链接三态显示

| 解析结果 | 显示 |
|---|---|
| `resolved` | 正常链接样式，显示 alias 或 target |
| `ambiguous` | 链接样式 + 歧义标识，悬停提示候选列表 |
| `unresolved` | 未创建链接样式（与正常链接视觉可区分），显示 alias 或 target |

### 4.2 跳转

- `resolved` / `ambiguous`：打开目标文件；带 heading path 且锚点找到时滚动定位到该标题行；锚点缺失时打开文件并提示"标题未找到"；
- `unresolved`：不跳转，提供一键创建入口（§4.4）；
- `ambiguous` 的跳转目标为 `chosen`，歧义标识与候选列表在跳转前即可见。

### 4.3 未创建链接

`unresolved` 不是错误，是 wiki 工作流的正常状态（先立链接、后写笔记）。系统 MUST 区分显示（§4.1），MUST NOT 提示为错误。

### 4.4 一键创建

对 `unresolved` 链接提供一键创建：

- 创建位置：⚠ 裁决点 I 推荐值——path 段不含 `/` 时创建于 **vault 根**目录的 `<target>.md`；含 `/` 时按 vault 根相对路径创建，缺失的中间目录一并创建。Obsidian 对新建位置有设置项；本 spec 不引入设置，冻结单一确定行为；
- 创建内容：空文件。MUST NOT 写入任何模板内容、frontmatter 或标题——写入内容属于"改写源文件格式"的滑坡起点（ADR 0003 §3 铁律）；
- 创建 MUST NOT 覆盖既有文件（按定义目标是 `unresolved`，若创建时发现同名文件已存在，说明索引过期，应重新解析而不是覆盖）；
- 创建成功后该链接转为 `resolved`。

## 5. `![[...]]` 的双语义判别

`![[...]]` 在 Obsidian 方言中是复用语法（ADR 0003 §2）：可能指向附件文件（在范围内），也可能指向笔记内容（transclusion，明确排除）。判别**按解析结果**进行，顺序如下：

1. target 带非 `.md` 扩展名（如 `![[photo.png]]`），或按 §3.2 规则在**全部文件**（不限 `.md`）中解析到非 `.md` 文件 → **附件引用**：渲染语义归 attachment 显示能力，本 spec 只管解析与判别；alias 段的展示语义（如 Obsidian 的尺寸写法 `![[image.png|300]]`）同样归附件显示能力，本 spec 不冻结；
2. 解析到 `.md` 文件（含带 heading path）→ **笔记内容嵌入**：不支持（§1 排除项），显示原文与"内容嵌入不支持"提示，MUST NOT 递归渲染；
3. `unresolved` → 缺失占位，显示原始引用文本与"附件未找到"提示，不阻断文档其余渲染。

附件的短路径解析沿用 §3.1/§3.2 的大小写与歧义规则（候选集为全部非目录文件）。

## 6. 不支持的语法形态

`[[note#^block]]`（块引用）显示原文与"块引用不支持"提示。§1 排除项中的其他形态（Dataview 等）不是 wikilink 语法，不由本 spec 处理。

## 7. 实现与修订纪律

- **单实现解析**（架构复查 P1-4）：wikilink 的语义解析（§2–§5）在 Rust core 的 link graph 模块内实现且仅实现一份；前端只做链接**span 定位**（在视口文本中找出 `[[...]]` 的字面范围用于装饰），不复制任何解析语义，语义一律经 invoke 向 Rust 侧查询。
- **fixture 双喂**：`tests/wikilink-fixtures/` 是双方共享的判定基准——Rust 解析器跑全部 parse/resolve 用例，前端 span 定位跑 parse 用例的 spans 断言。任一侧与 fixture 不一致即缺陷。
- **修订纪律**：本 spec 冻结后，修订只由两个触发器发起——Obsidian 行为漂移影响存量 vault 的可读性（ADR 0003 Consequences），或 dogfood 发现真实 vault 长尾问题（ADR 0003 §4 裁决：人工补充用例，公开仓库只含合成 fixture）。修订须同步更新 fixture，并在本文头部升版本号。
