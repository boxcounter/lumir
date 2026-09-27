# Proposal: .gitignore / .gitattributes / .jsonc 语法高亮与可编辑

- Change ID: dotfile-jsonc-highlight
- 日期: 2026-09-26
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 原话：「增加对 .gitignore、.gitattributes、.jsonc 格式的文件的高亮着色」；
随后预裁决（2026-09-26，逐字）：「顺带可编辑」。

现状（锚点 2026-09-26 master `649b64d` 核对，详见 design.md §1）：

1. **三类文件今天都是纯文本只读、零着色**。注册表（`src/preview/attachments.ts`，
   M130/M152 收敛后的单一事实源）只按扩展名查表：`.gitignore` 经
   `extensionOf`（`src/preview/attachments.ts:123-127`）得到「扩展名」`gitignore`——
   不在 `CODE_EXTENSIONS`（`:33-68`）里，`fileClass` 落 `text`（`:130-132`），
   `codeLanguage` 返回 null（`:135-137`），于是以只读 code 模式打开但无任何语言包
   （`src/editor.ts:1016-1021` 的 `codeLanguageFor` 返回 null → 纯文本）。
   `.gitattributes` 与 `.jsonc` 同此路径（`jsonc` 扩展名未收录）。
2. **同一内容两侧不一致**：md 围栏里的 `jsonc` 代码块**早已着色**——
   `src/preview/code.ts:133` 的 ALIASES 把 info string `jsonc` 归一到 `json`；
   整文件打开 `.jsonc` 却不着色。文件越大越常用（vault 级 git 仓库、VSCode 系配置）
   越刺眼。
3. **语法来源其实现成一半**：探针实测（design §1.4）既有 legacy json mode 已把
   `//` 与 `/* */` tokenize 为 `comment`、尾逗号不出 error token——`.jsonc` 的着色
   只差注册表一行映射；`.gitignore`/`.gitattributes` 在 `@codemirror/legacy-modes`
   6.5.4 全量清单与 CM6 生态里均**无现成实现**（核实过程见 design §1.3），需自写
   极小 StreamParser（gitignore(5)/gitattributes(5) 语义，行级语法、约数十行）。

## What Changes

以下按裁决点推荐项起草；「可编辑 vs 只读高亮」已由 Alex 预裁决（顺带可编辑），不再悬置。

1. **注册表引入文件名匹配**（判定顺序：basename 精确匹配优先于扩展名，design §2）：
   `src/preview/attachments.ts` 新增文件名注册表，`.gitignore` / `.gitattributes`
   登记为 code 类并各带语言名；`CODE_EXTENSIONS` 新增 `jsonc` → `jsonc`。
   文件树点击打开与状态栏语言名自动跟随（消费同一注册表，design §1.1）。
2. **语言表三新条目**（`src/preview/code.ts` 的 `LANGUAGES`，编译期合同）：
   - `jsonc`：复用既有 legacy json `StreamLanguage`（含 `JSON_TOKEN_TABLE` 键名修正），
     零新 parser——注释与尾逗号的 token 化已由探针证实正确（design §1.4）。
   - `gitignore` / `gitattributes`：自写两个极小 StreamParser（共享一个参数化
     tokenizer，design §4），token 只落到既有 TOKEN_GROUPS 的 role 上，零新增颜色。
   - 围栏代码块别名同步收录 `gitignore` / `gitattributes`（与 `jsonc` 既有口径一致）。
   - 编译期穷尽涟漪：`src/code-structure.ts:313` 的 `STRUCTURE_SUPPORT` 与
     `src/code-identifiers.ts:341` 的 `BINDING_RULES` 各补三个 null 条目
     （T3 无结构解析、无变量绑定高亮——与 json/yaml 等既有条目同口径）。
3. **顺带可编辑（Alex 预裁决）**：三类文件的可编辑性**经 M231
   （editable-non-md-files，评审返修中）的注册表通道获得**——本 change 不自建
   第二套可编辑开关。M231 D1 推荐项（注册表全量文本类 `code`+`text` 可编辑）落地后，
   三类文件随其文件类自动可编辑；若 M231 D1 被裁成白名单，本 change 的实现任务含
   「白名单显式收录三类」（design §5 的依赖与风险）。落地顺序：本 change 与 M231
   互不阻塞——先合本 change 则三类文件先只读高亮、M231 合入后自动转可编辑；
   先合 M231 则本 change 合入即高亮 + 可编辑同时生效。spec delta 据此只 ADD
   两条新 requirement，不触碰 M231 正在改写的只读 / 模式条款（design §6）。
4. **真机验收场景 46**（`46-dotfile-jsonc-highlight.md`）：三类文件在真实
   WKWebView 下的着色断言（注释 / 键值 / 取色 token）+ 未收录 dotfile（如 `.secret`）
   仍为纯文本的对照断言。可编辑断言走 M231 的场景 41/42 通道，本场景不重复
   （合并顺序与口径见 tasks.md §6）。

## 须提请 Alex 节点 1 裁决的选项

三项给了推荐项，delta 与 tasks 已按推荐项起草；裁决改备选则按备选改写。
（「可编辑 vs 只读高亮」已预裁决 = 顺带可编辑，不再列入。）

| # | 裁决点 | 推荐（已写进 delta） | 备选 | 一句话取舍 |
|---|---|---|---|---|
| D1 | **gitignore / gitattributes 无现成 mode 时的策略** | **自写 StreamParser**（约数十行，按 gitignore(5) / gitattributes(5) 行级语义；token 只落既有 TOKEN_GROUPS role）——生态核实（design §1.3）：legacy-modes 6.5.4 无此 mode、npm 无信誉可用的 CM6 实现；自写量小且语义由 git 官方文档界定 | a) 降级近似 mode（properties/shell 冒充）；b) 不着色只修 jsonc | a) 违反本仓既定先例（php 无 mode 即标 null，「不用近似 parser 冒充高亮」，`src/preview/attachments.ts:31` 与 code.ts:86 注释）；b) 直接违背需求原文 |
| D2 | **.jsonc 注释支持的实现方式** | **复用既有 legacy json StreamLanguage**——探针实测（design §1.4）`//`、`/* */` 已 tokenize 为 `comment`、尾逗号不出 error，注册表加一行 `jsonc` 即成；与围栏 `jsonc` 既有口径天然同源 | a) 引入 `@platformos/lang-jsonc`（MIT，但 0.1.0 且是 Lezer 语法，破坏 `LANGUAGES: Record<CodeLanguage, StreamLanguage>` 的单一形态编译合同，还要为它单开配色通道）；b) 自写 jsonc parser | a) 收益为零（json mode 已够用）、代价是注册表形态分裂；b) 重复造已验证可用的轮子 |
| D3 | **文件名匹配的收录范围** | **只收 `.gitignore` / `.gitattributes` 两个精确 basename**（大小写敏感、精确匹配，不匹配 `*.gitignore` 之类扩展名形态）——严格对齐 Alex 点名的两类；`.gitmodules`（INI 语法）、`.gitkeep`（空约定文件）等不在请求内 | 顺带收录其它 git dotfile / 常见约定文件名（Makefile、Dockerfile、LICENSE） | 备选扩大了语法正确性责任面（每个文件名都要核一门语法）而无需求支撑；Makefile/Dockerfile 的收录在 legacy-modes 有现成 mode，值得另立 change 裁决 |

## Non-goals

- **不自建可编辑通道**：可编辑性完全经 M231 的注册表通道获得（预裁决「顺带可编辑」的
  落点）；本 change 不动 `editable`/`readOnly` 门、revision 登记门与保存链路
  （那些是 M231 的施工面）。
- **不改模式裁决语义**：非 md 一律 code 模式、不回落配置默认（M130 方向 A）原样保留。
- **不收录其它 dotfile / 约定文件名**（D3）；不为 `.gitignore` 做 glob 语义检查、
  lint 或补全。
- **不改着色管线结构**：`LANGUAGES` / `TOKEN_GROUPS` / 配色 token 单一来源口径不变；
  不新增颜色 token。
- **不做 jsonc 的 schema 校验 / 格式化**。

## Impact

- **影响的 specs**：`editor-live-preview`（ADDED ×2：「dotfile 与 JSONC 的语法高亮」、
  「dotfile 与 JSONC 的可编辑性」——后者以 M231 的可编辑通道为前提，见 What Changes 3
  与 design §5）。`file-tree` 无 delta：`openKind` 对 `text` 与 `code` 同样进编辑器
  （`src/tree.ts:39-43`），`displayKind` 对两者同归 `other`（`:30-36`），分类从
  `text` 提到 `code` 不改变树的任何行为。
- **影响的代码/系统**（实现 mission 照 design 锚点施工）：
  - `src/preview/attachments.ts`：文件名注册表 + 判定顺序（`:104-137` 区域）；
  - `src/preview/code.ts`：`LANGUAGES` 三条目（`:88-110`）、gitignore/gitattributes
    StreamParser、ALIASES 同步（`:113-135`）；
  - `src/code-structure.ts:313`、`src/code-identifiers.ts:341`：穷尽表补 null 条目；
  - `src/editor.ts:1016-1021` / `src/tree.ts:32,40` / `src/main.ts:207,618`：
    消费侧从 ext 查询切到 path 感知查询（design §2.3，签名收口方案）；
  - `tests/unit/`：注册表判定顺序与 jsonc/gitignore token 化的属性测试；
  - `scripts/acceptance/scenarios/46-dotfile-jsonc-highlight.md`：真机着色场景
    （编号核对：36-45 已分配——36 live-theme / 37 heading / 38 width / 39 titlebar /
    40 table-fs（M229）/ 41+42 nonmd-edit（M231）/ 43 tab-indent（M230）/
    45 tab-cycle-keys（M232，wt-232），44 的归属未查到但 36-45 按 tower 口径视为已占；
    46 全仓 grep 无撞号）。
- **性能**：StreamLanguage 增量解析为既有依赖，三类目标文件都是小文件（KB 级）；
  打开路径性能合同（1MB <100ms，ADR 0002 §6）不受影响。
- **依赖关系**：可编辑部分依赖 M231（editable-non-md-files）的注册表通道与 D1 裁决；
  高亮部分独立可合。合并顺序与 M231 缩面应对见 design §5/§7。
- **关联约束**：ADR 0002 §2（单内核双模式）、§6（性能合同）；ADR 0003 §3 铁律
  （只读态不产生写入路径；可编辑落地后装饰仍不改写源码——code 模式无装饰层）；
  REVIEW.md 第 8 条（语言/扩展名表单一来源，本 change 沿用注册表一处改动）。
