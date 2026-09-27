# Design: dotfile-jsonc-highlight

锚点日期 2026-09-26，基于 master `649b64d`（worktree wt-233 基线）。所有 file:line 均当日核对。

## 1. 现状

### 1.1 注册表与消费链（M130 收敛、M152 单一来源）

- 「扩展名 → 分类 + code 语言名 + 附件 MIME」的唯一事实源是
  `src/preview/attachments.ts`（文件头注释 `:8-12` 自述唯一事实源地位）：
  - `CODE_EXTENSIONS`（`:33-68`）：code 模式扩展名 → legacy-modes 语言名，
    值域即 `CodeLanguage` 联合（`:72`）；`json` → `"json"` 在 `:53`。
  - `REGISTRY`（`:104-113`）：ext → `ExtensionInfo` 的运行期表；`fileClass`
    （`:130-132`）与 `codeLanguage`（`:135-137`）是其仅有的两个分类/语言查询口。
  - `extensionOf`（`:123-127`）：只按 basename 最后一个点切分——无点 basename
    （`LICENSE`/`Makefile`）→ `""`；**dotfile `.gitignore` → `"gitignore"`**
    （`:115-122` 注释明示此口径，M130 收敛时统一）。
- 语言名 → CM6 Language 的唯一事实源是 `src/preview/code.ts` 的 `LANGUAGES`
  （`:88-110`，`Record<CodeLanguage, StreamLanguage<unknown>>` 编译期合同）；
  json 条目带 `JSON_TOKEN_TABLE`（`:65`，修 legacy json 的复合 token
  `string property`，fix-json-key-highlight 归档）。token 配色分组
  `TOKEN_GROUPS`（`code.ts:156-167`）六个 role 也是单一来源，code 模式侧由
  `src/editor.ts:1032-1047` 的 `CODE_COLORS`/`codeHighlight` 消费。
- 消费侧（全部经 `extensionOf(path)` 查 ext，无文件名概念）：
  - `src/editor.ts:1016-1021` `codeLanguageFor`（code 模式选语言包）、
    `:1056-1059` `modeForPath`（md/只读 code 裁决，M130 方向 A）；
  - `src/tree.ts:32`（`displayKind`）、`:40`（`openKind`）——text 与 code 同样
    进编辑器、同归 `other` 展示类，分类变化对树零行为差；
  - `src/main.ts:207`（IPC 语言名）与 `:606-618`（状态栏语言标签，
    `codeLanguage(...) ?? "Plain text"`）。

### 1.2 三类文件今天的实际路径

| 文件 | extensionOf | REGISTRY 命中 | fileClass | 打开形态 |
|---|---|---|---|---|
| `.gitignore` | `gitignore` | 否 | `text` | 只读 code 模式，无语言包 → 纯文本 |
| `.gitattributes` | `gitattributes` | 否 | `text` | 同上 |
| `x.jsonc` | `jsonc` | 否 | `text` | 同上 |

对照：md 围栏 `jsonc` **已着色**——`src/preview/code.ts:133` 的 ALIASES
`jsonc → "json"`。同一内容在围栏里着色、整文件打开不着色，是本 change 要消除的
两侧不一致（REVIEW.md 第 8 条同族）。

### 1.3 生态核实（gitignore / gitattributes / jsonc 的现成实现）

- `@codemirror/legacy-modes@6.5.4` 全量 mode 清单（`node_modules/@codemirror/
  legacy-modes/mode/` 目录列举，103 个 mode 文件）：**无 gitignore、无
  gitattributes、无 jsonc**。json 由 `mode/javascript.js:920` 导出
  （`json = mkJavaScript({name: "json", json: true})`）。
- npm/CM6 生态检索（2026-09-26，WebSearch）：gitignore / gitattributes 未见任何
  信誉可用的 CM6 语言包；jsonc 有 `@platformos/lang-jsonc`（npm registry 元数据：
  MIT、latest 0.1.0、Lezer grammar 生成物）——否决理由见 §6 V2。
- git 语法本身有权威文档界定：gitignore(5)（`#` 注释、`!` 取反、尾 `/` 目录、
  glob）与 gitattributes(5)（`pattern attr -attr attr=value` 行格式）——自写
  parser 的语义依据是一手文档，不抄任何实现，许可干净（§3）。

### 1.4 jsonc 复用可行性的探针证据（2026-09-26 实测）

探针（`/tmp/m233-probe-jsonc.cjs`，`NODE_PATH=node_modules node` 驱动
`StreamLanguage.define(json)` 逐行 token 化）输入：

```jsonc
{
  // line comment
  /* block */ "key": "value",
  "n": 1,
}
```

输出要点：`// line comment` → token `comment`；`/* block */` → token `comment`
（跨行块注释经 `state.tokenize = tokenComment` 续行，`mode/javascript.js:71-72`）；
`"key"` → 复合 token `string property`（正是 `JSON_TOKEN_TABLE` 修的那个）；
`1` → `number`；**尾逗号 `,` 走普通标点路径，不产出 error token**。
机制依据：注释的 tokenize 在 tokenizer 层、不受 jsonMode 约束
（`mode/javascript.js:69-75` 的 `/` 分支无 jsonMode 条件）；jsonMode 只影响语法层
（`:912` 的 `commentTokens: jsonMode ? undefined : …` 仅摘掉了 toggleComment 的
language data——只读高亮无消费者；M231 可编辑落地后 code 模式亦不绑注释命令，
无影响）。

结论：`.jsonc` 着色 = 注册表加一行映射 + `LANGUAGES` 加一条复用条目，零新 parser。

## 2. 注册表扩展方案

### 2.1 判定顺序：文件名精确匹配优先于扩展名

```
fileClassOf(path):
  base = basename(path)
  1. FILENAME_REGISTRY[base] 命中（精确、大小写敏感）→ 返回其条目
  2. 否则按 extensionOf(path) 走既有 REGISTRY 查表
  3. 均未命中 → "text"（既有口径不变）
```

文件名优先的理由：basename 约定（`.gitignore`）是**比扩展名更具体**的信号；反过来
（扩展名优先）会让一个假想的 `notes.gitignore` 抢在 `.gitignore` 文件名规则前面。
两个表不重叠（FILENAME 的键带点开头、CODE_EXTENSIONS 的键不含点），顺序只影响
未来的扩展空间，今天无实际冲突样本——但顺序必须在 spec 里写死，避免实现期随手。

**MUST NOT 走 `extensionOf` 的 dotfile 口径取巧**（把 `gitignore` 当扩展名塞进
`CODE_EXTENSIONS`）：那会同时命中 `foo.gitignore`（语义上可接受但不是请求）、漏掉
无点 basename `gitignore`，且把「文件名约定」伪装成「扩展名」，污染注册表语义
（否决细节 §6 V3）。

### 2.2 新增条目

| 表 | 键 | 值 |
|---|---|---|
| `FILENAME_REGISTRY`（新） | `.gitignore` | `{ class: "code", language: "gitignore" }` |
| `FILENAME_REGISTRY`（新） | `.gitattributes` | `{ class: "code", language: "gitattributes" }` |
| `CODE_EXTENSIONS` | `jsonc` | `"jsonc"` |

`CodeLanguage` 联合随注册表推导自动扩出 `"gitignore" | "gitattributes" | "jsonc"`；
`Record<CodeLanguage, …>` 编译期合同强迫以下三处同 PR 更新（缺一编译失败，
这正是 M152 设计的防漂移机制）：

- `src/preview/code.ts:88-110` `LANGUAGES`：三新条目（§4）；
- `src/code-structure.ts:313` `STRUCTURE_SUPPORT`：三条目均 `null`
  （T3 无结构解析，与 json/toml/yaml 等既有 null 条目同口径）；
- `src/code-identifiers.ts:341` `BINDING_RULES`：三条目均 `null`
  （无变量绑定高亮）。

### 2.3 消费侧签名收口

现状四个消费点都先 `extensionOf(path)` 再查表。方案：**注册表新增 path 感知的
`fileClassOfPath(path)` / `codeLanguageOfPath(path)`**（内部走 §2.1 顺序），
`fileClass(ext)` / `codeLanguage(ext)` 保留为 ext 查询的底层口（预览围栏等无路径
上下文处仍可用）；打开链路的四个消费点（editor.ts ×2、tree.ts ×2、main.ts ×2）
切到 path 版。REVIEW.md 第 8 条防线：两处查询口共存时在模块注释里写清分工
（path 版 = 文件打开裁决唯一入口；ext 版 = 无路径上下文的底层查询），并在
`fileClass(ext)` 注释标注「打开文件请用 path 版」。

### 2.4 别名表同步

`src/preview/code.ts` ALIASES（`:113-135`）新增 `gitignore` / `gitattributes`
两个 fenced info string（`jsonc → json` 已在 `:133`，无需动）——围栏与整文件同表的
单一来源口径对新增语言自动成立（`editor-live-preview` spec「两侧语言与配色表同源」）。

## 3. 语法来源与许可核查

| 语言 | 来源 | 许可 |
|---|---|---|
| `jsonc` | 复用既有 `@codemirror/legacy-modes` 的 json mode（已 vendored，项目依赖） | MIT（既有依赖，无新增） |
| `gitignore` / `gitattributes` | 自写 StreamParser，语义依据 gitignore(5) / gitattributes(5) 官方文档；不复制任何第三方实现代码 | 自研代码入仓，无外部许可引入 |

新增运行时依赖：**零**。新增 devDependency：**零**。

## 4. gitignore / gitattributes 的 token 设计

两个语言共用一个参数化 tokenizer（legacy-modes 的 `mkX` factory 形态），
行级语法、状态只需「是否在行首」级别的信息（StreamParser state 可平凡复制）。
token 只落既有 TOKEN_GROUPS 的 role，**零新增颜色**：

| 构造 | gitignore | gitattributes | token → role |
|---|---|---|---|
| `#` 至行尾（含 `\#` 转义判定） | 注释 | 注释 | `comment` → comment（`--tk-c`） |
| 行首 `!` | 取反标记 | — | `keyword` → keyword（`--tk-k`） |
| 行尾 `/` | 目录标记 | — | `keyword` → keyword |
| 属性名 / `-attr` 取反 | — | pattern 之后的词 | `property` → property（`--tk-k`） |
| `attr=value` 的 value | — | `=` 之后 | `string` → string（`--tk-s`） |
| glob 模式本体 | 其余文本 | 行首 pattern | 正文色（不赋 token，与 yaml spec 对
结构符号的「不赋予颜色语义」口径一致） |

范围纪律：只做**着色**，不做 glob 合法性校验、不做跨行状态（gitignore 无块构造）。
属性测试断言上表的 token 化（含 `\#` 转义、`!` 只在行首生效、`attr=value` 切分），
反向用例先行（错误形态的判定必须先红后绿）。

## 5. 与 M231（editable-non-md-files）的关系与依赖

- **分工**：M231 提供可编辑**通道**（按文件类的 editable 门、revision 登记门放宽、
  `save_markdown` 守卫放宽）；本 change 提供三类的**注册**（文件名/扩展名进注册表）
  与着色。本 change MUST NOT 自建 editable 开关（两套开关 = REVIEW.md 第 8 条的
  双表漂移形态）。
- **自动获得机制**：M231 D1 推荐项 = 注册表 `code`+`text` 全量文本类可编辑。三类
  文件今天是 `text`、本 change 后为 `code`——两种态都在 D1 覆盖面内，可编辑性
  随 M231 落地**自动**获得，无需本 change 额外接线。
- **合并顺序**：互不阻塞。本 change 先合 → 三类只读高亮，M231 合入当日自动转
  可编辑（无需回本 change 补代码）；M231 先合 → 本 change 合入即高亮 + 可编辑
  同时生效。spec delta 只 ADD 新 requirement、不 MODIFIED M231 正在改写的只读 /
  模式条款（`editor-live-preview` 的「单内核双模式落地」等），归档冲突面为零。
- **验收分工**：可编辑 + 保存 + 冲突防护的行为断言归 M231 的场景 41/42（其口径
  已是注册表全量文本类）；本 change 的场景 46 只断言着色与分类，不重复
  （AGENTS.md 验收纪律：场景守行为判定，不堆叠重复断言）。实现期若 M231 已先合，
  场景 46 顺手补一条「三类文件可编辑」的冒烟断言（tasks §6 的条件项）。

## 6. 被否决方案

- **V1 降级近似 mode**（properties / shell 冒充 gitignore）：properties 的
  key=value 语义与 gitignore 的行级 glob 不符，`!`、`/`、`**` 全会被错标；违反
  本仓既定先例（`php → null`，「不用近似 parser 冒充高亮」，
  `src/preview/attachments.ts:31`、`code.ts:86` 注释，及 editor-live-preview spec
  「MUST NOT 用近似 parser 冒充着色」条款）。
- **V2 引入 `@platformos/lang-jsonc`**（npm，MIT，0.1.0）：Lezer grammar 生成物，
  与 `LANGUAGES: Record<CodeLanguage, StreamLanguage>` 的单一形态编译合同冲突
  （要么破合同、要么为它单开 Lezer 配色通道）；0.1.0 成熟度 + 平台方专用定位；
  收益为零（§1.4 探针证明 legacy json 已够用）。
- **V3 把 `gitignore` / `gitattributes` 当扩展名塞进 `CODE_EXTENSIONS`**：依赖
  `extensionOf(".gitignore") = "gitignore"` 这个 dotfile 切分口径的副作用
  （`attachments.ts:115-122` 注释明示它本是「无扩展名文件也走只读 code」的副产
  口径，不是文件名匹配机制）；误命中 `foo.gitignore`、漏掉无点 basename、并把
  「文件名约定」伪装成「扩展名」污染注册表语义。
- **V4 顺带收录 `.gitmodules` / Makefile / Dockerfile 等**：超出 Alex 点名范围
  （D3）；`.gitmodules` 是 INI 语法（需另一门 mode）、Makefile/Dockerfile 在
  legacy-modes 有现成 mode 值得另立 change 裁决，不混入本次的责任面。

## 7. 风险与涟漪

1. **M231 缩面风险**：若 M231 D1 被裁成白名单而非全量文本类，三类文件不自动可编辑。
   应对已写进 tasks：实现任务含「白名单形态下显式收录三类」的条件项；本 change 的
   spec delta「可编辑性」requirement 措辞按「经注册表通道可编辑」写，与 M231 的
   最终形态解耦。若 M231 整体被弃，本 change 退化为纯高亮（只读），「可编辑性」
   requirement 在归档评审时摘除——delta 是提案，归档才并入 living spec，无烂尾。
2. **穷尽表涟漪**：`STRUCTURE_SUPPORT` / `BINDING_RULES` 各补三个 null——编译期
   合同保证不会漏；实现期顺手核对 `main.ts:606-618` 的状态栏语言标签显示
   （`codeLanguage` 命中后不再是 "Plain text"）。
3. **视觉基线**：本 change 不改 UI 结构；`m130-text-open-trap.spec.ts` 的 dotfile
   用例是 `.secret`（未收录，保持 `text` 纯文本），不受影响。实现期跑
   `gate.sh visual` 时若整页基线因 `.gitignore` fixture 出现着色差异，按
   AGENTS.md 视觉门禁卫生纪律逐一核对涉及基线的时间戳。
4. **大小写口径**：文件名匹配大小写敏感（`.GitIgnore` 不命中）——与 git 在
   大小写敏感文件系统上的行为一致；macOS 默认大小写不敏感 FS 上 git 仍按字面
   识别 `.gitignore`，不存在「用户写出 `.GITIGNORE` 且 git 认」的常态场景。
