# Design: 非 md 文本文件可编辑（editable code 模式）

- Change ID: editable-non-md-files
- 日期: 2026-09-26
- 行号锚点基于本 change 基线 master `5841002`。

## 1. 现状与历史决策复审

非 md 只读是三次决策的叠加，逐条列出当初的理由并评估其在今天是否仍成立。

### R1（M120，2026-09-11，commit `676a940`）：只读是既有口径，M120 只加高亮

M120 的动机是让只读的非 md 文件按扩展名着色：新增 `@codemirror/legacy-modes`，
`CODE_LANGUAGES` 按扩展名映射 `StreamParser` 接入 code 模式；提交自述明确「只读合同不动
（editable(false) + readOnly(true) + changeFilter 兜底）」。也就是说只读在先（M19 单内核
双模式落地时 code 模式即只读），M120 没有论证只读，只是不动它。

**今天仍成立的部分**：着色管线本身——`StreamLanguage` 是增量解析器，编辑期随文档变更
增量更新，可编辑化不需要动着色。`src/preview/code.ts:88` 的 `LANGUAGES`（M152 收口后的
单一来源）与围栏代码块共用，spec 已有「着色管线 MUST NOT 因本能力改变」级别的约束
（`openspec/specs/editor-live-preview/spec.md:459-463`），本 change 继承该口径。
**不再构成约束的部分**：「只读合同不动」是当时的不动，不是「不可动」的论证。

### R2（M130，2026-09-13，commit `e33e10b` / `7d64e79`）：保存死态堵漏，方向 A「非 md 即只读」

死态链路（archive proposal `openspec/changes/archive/2026-09-13-non-md-readonly-open/proposal.md:9-16`）：
分类依赖两套扩展名集合（`tree.ts` `CODE_EXTS` 32 项 vs `editor.ts` `CODE_EXTENSIONS` 29 项，
差集 7 项）→ 未收录扩展在 `modeForPath` 回落配置默认（出厂 md）→ 文件以可编辑 md 打开、
能 dirty，但 `main.ts` 只为 md 登记磁盘 revision → 保存入口在 dirty 时静默 return false
（Cmd+S 无反馈），dirty 又锁死切换文件/切换 vault/退出 → 用户被困，只能强杀，修改必丢。

Alex 裁决 D4 采纳方向 A：`modeForPath` 对非 md 一律返回只读 code（`src/editor.ts:1049-1059`，
含无扩展名文件，tower 评审裁决「D4 优先于任务书字面」），dirty 不可能产生，死态消除。
方向 B（放开保存）列为 Non-goal，理由原文：「放开 `fs_io::save_markdown` 的 md-only 守卫后，
CAS / 自动保存 / 崩溃备份 / 退出守卫全链路都要按非 md 重新验证（含 md 专属的 live preview
不该套在代码文件上），代价远超本次堵漏目标」（同 proposal :26-31）。

**今天的评估**：「要全链路重新验证」这条理由**仍然成立**——本 change 不主张跳过验证，
tasks §4 就是这份验证清单。但验证面已比 M130 时大幅收窄：M124（save recovery）与 M127
（save hardening）把保存链路收敛进 `src/save-controller.ts`，按路径键控、逐环节模式无关
（§3 逐环节复审）。初稿称「md 假设只剩两处窄门」——评审 r1 实证漏查两处，实为**四处**
（§2.2 的 changeFilter 闸、§3.1 的 revision 登记门、§3.2 的 saveBaseline 闸、§3.7 的
后端守卫），「窄门」定性不变、清单以本节为准。因此
「代价远超堵漏目标」在当时的成本判断不构成今天「不做」的理由——今天的成本就是本 change
一个实现 mission。
**仍然成立的部分**：方向 A 的**模式裁决**语义（非 md 不走 md 模式、MUST NOT 回落配置默认）
保留；本 change 只解除只读，不改模式选择（§2.1）。

### R3（live preview 只服务 md）：装饰层是 md 语义

`src/editor.ts:1355-1357`：`modeExtensions` 的 md 分支装 `livePreview(previewContext)`，
code 分支装 `codeBindingTheme + lineNumbers + highlightActiveLine`。spec「live preview
装饰层」条款逐字 md-only（`openspec/specs/editor-live-preview/spec.md:25`）。

**今天仍成立**：它是本 change 编辑形态的约束（D2：可编辑 code 模式 = 纯文本编辑 + 高亮，
不引入装饰层），不构成「不可编辑」的理由。

### R4（后端 md-only 守卫）：`fs_read_only` 是防线不是设计目标

`src-tauri/src/fs_io.rs:342-353`：`save_markdown` 对非 `.md`/`.markdown` 返回
`fs_read_only`「仅支持保存 Markdown 文件」；单测 `:924-933` 锁定该行为（`main.rs` 被拒）。
M130 archive proposal :29、:38 把它定位为「后端防线」：前端在 `displayedRevision === undefined`
处提前短路，该守卫当前不可达，但 MUST NOT 因不可达而删除。

**今天的评估**：防线职能（挡住前端 bug 把内容写进不该写的文件）仍然需要，但「md-only」
这条具体边界随编辑能力放开而放宽——放宽形态与防漂移机制见 §3.7。

### R5（M130/M152 的注册表收敛）：单一事实源已建成

M130 把扩展名分类收敛为 `src/preview/attachments.ts` 一处（`FileClass` =
md/image/binary/code/text，:22；`REGISTRY` :104-141；`fileClass()` :130-132），编译期由
`Record<CodeLanguage, …>` 锁语言覆盖；M152（commit `6e8e70a`）再把语言表收口到
`src/preview/code.ts:88` 的 `LANGUAGES`、frontmatter 检测收口到 `frontmatter.ts`。

**今天仍成立且直接可用**：可编辑范围按 `fileClass` 裁决（D1 推荐项），不需要新建任何表；
这正是当初收敛的红利——当初若没收敛，本 change 要先做收敛才能谈放开。

### R6（只读前提的消费者）：大纲/变量高亮的内容键缓存

code-outline 与 code-variable-highlight 的解析缓存按「语言 + 文档内容」键控，spec 已显式
预见可编辑：「本条的前提是 code 模式只读……若将来 code 模式可编辑，本条的内容键口径仍成立
（每次编辑即新内容、新键），须另行审视的只是缓存的淘汰口径」
（`openspec/specs/editor-live-preview/spec.md:455-457`）。

**今天仍成立**：内容键口径无需修改；缓存淘汰（编辑后旧内容键滞留）是实现期复核项
（tasks §4.3），不是架构障碍。

### R7（模式无关的既有机制）：undo / dirty / 搜索 / 折行

- 撤销栈：`history()` 装在会话基础层、模式无关（`src/editor.ts:1383-1398`）；只读期
  「命令在 `state.readOnly` 时返回 false」的注释（:1391-1393）在可编辑后自然翻转。
- dirty：`cleanDoc` 文本比较（`src/editor.ts:872-875`、updateListener :1418-1424），
  模式无关；标签 dirty 点（M149）、守卫提示族直接生效。
- 搜索：search panel 装在模式无关基础层（:1407-1409）。
- 折行：code 模式正文行走文件级 `editor.line_wrap`（:1067-1080；spec :378-381）。

**结论**：可编辑 code 模式免费获得撤销、dirty、搜索、折行；不需要为它们写新机制。

## 2. 目标形态与编辑态方案

### 2.1 模式裁决不动，只解除只读

`modeForPath`（`src/editor.ts:1056-1059`）维持 md/code 两模式裁决不变：`.md`/`.markdown`
→ md；其余一切已打开文件 → code；无文件上下文 → 配置默认。M130 方向 A 的语义（MUST NOT
回落 `editor.mode`、不随配置漂移）逐字保留——本 change 改的是 code 模式的**可编辑性**，
不是模式选择。

### 2.2 可编辑性从「按模式」改为「按文件类」

现状可编辑性硬绑模式（`src/editor.ts:1350-1354`）：`editable.of(mode === "md")`、
`readOnly.of(mode !== "md")`、`aria-readonly` 同步。目标：会话级「可编辑」标志
（`EditorSession.editable`，或等价承载），取值 = `fileClass(extensionOf(path)) ∈ {md, code, text}`
——md 恒可编辑；code 模式按注册表文本类可编辑；无文件上下文文档（空态/新建）按现状
可编辑（其模式由 `editor.mode` 决定，行为不变）。image/binary 类不进编辑器
（`src/tree.ts:38-42` 的 OpenKind 分流 + `src/main.ts:408-411` 的提示），无改动。

装配点：`modeExtensions` 的 code 分支（`src/editor.ts:1355-1357`）按会话 editable 决定
`editability` 数组取值；会话切换/装载走既有 Compartment 重配（`modeAndWrapEffects`
:1367-1372），不重建 EditorView。`aria-readonly` 与 `tabindex` 随标志同步。
M101/M130 留下的视图层只读合同注释（:1345-1349）改写为「按文件类」口径。

**changeFilter 闸必须同批放宽**（评审 r1 P1-2 实证，初稿漏查）：`src/editor.ts:1417` 的
`EditorState.changeFilter` 在 dispatch 层拦截 `currentMode !== "md"` 的一切 docChanged
事务（trustedLoad 标记的装载事务除外，:1413-1417）。只翻 editability 会得到**假可编辑**
编辑器——`contenteditable` 在场、视觉断言全绿，但按键在 dispatch 层被吞（REVIEW.md
第 1 条同族陷阱）。该闸的判据要与 editable 标志同源：按会话 editable 放行，不再看模式。
注意其闭包读的是实例级 `currentMode` 投影（:1415-1416 注释：切标签时必须由
`activateSession`/`syncMode` 同步，否则前台 code 会话而投影停在 md 会错判）——改为
editable 投影后这条同步纪律原样保留，且要补一条「投影与前台会话 editable 一致」的
断言（tasks §1.4）。

### 2.3 编辑态下的 code 模式行为清单

可编辑 code 模式 = 现状只读 code 模式 + 输入路径打开：

- 保留：语法高亮（`LANGUAGES` + `codeHighlight`，:1012-1047）、行号与 activeLine、
  `codeBindingTheme`、搜索面板、大纲/变量高亮、文件级折行。
- 新获得：键入/粘贴/IME/拖放编辑（`editable(true)` 后 CM6 原生路径）、undo/redo
  （`history()` 已在）、dirty 标记与守卫族、Cmd+S 与自动保存（§3）。
- 不获得：live preview 装饰层、endMarker、代码块横滚容器（`wrapExtensions` 的 md 分支，
  :1076-1078）——全部是 md 专属，逐字不动。

## 3. 保存链路复用论证（逐环节）

判据先行：复用成立 = 该环节的代码不携带 md 假设，或携带的 md 假设有窄门可开。以下
`save-controller.ts` 行号基于基线 master `5841002`。

### 3.1 revision 登记（开门点 1）

`src/main.ts:418-420`：`save.noteOpened(path, kind === "md" ? snapshot.revision : undefined)`
——前端 md 门之一。改为：可编辑文本类（`fileClass ∈ {md, code, text}`）登记
`snapshot.revision`。revision = 内容 SHA-256（`src-tauri/src/fs_io.rs:323-339`
`file_revision`/`read_snapshot`），扩展名无关，无需后端配合。

### 3.2 CAS 写入（开门点 2：saveBaseline 的 mode 闸）

`saveDocument`（`src/save-controller.ts:333-387`）本体无 md 假设：取基准、调
`documentSave(path, expectedRevision, content)`、成功即登记新 revision + `markCleanOf`、
失败分流 `document_conflict` / `fs_not_found`。但基准的来源有闸（评审 r1 P1-1 实证，
初稿漏查）：`saveBaseline`（:233-237）首行判 `session === undefined || session.mode
!== "md"` 即返回 null——code session 即便按 §3.1 登记了 revision，保存入口仍在这里被
提前短路（保存、强制保存后的基准刷新、崩溃备份的闸门、切换守卫的 `hasUnsaveable`
（:276）全部经它）。该闸改为按会话 editable 标志判定（与 §2.2 同一标志、同一真源），
注释（:230-232 的「非 md 是只读 code 模式」口径）同步改写。后端门见 §3.7。

### 3.3 自动保存与暂停边界

`reconcile`/debounce（`src/save-controller.ts:611-621`、:389-396）：判据 = dirty +
暂停态（conflict / watch-dirty / not-found），无 md 假设。spec「自动保存与冲突恢复」
scenario 的「编辑 Markdown 后停止输入」表述随 fs-io delta 泛化为「编辑文档」。

### 3.4 冲突恢复（M124）

`showConflictPrompt` 双逃生口（重新载入 / 强制覆盖保存）与强制覆盖的再冲突处理
（`src/save-controller.ts:365-387`、:424-458）：sticky 提示族按路径键控，无 md 假设。

### 3.5 崩溃备份与恢复入口

`backupDirty`（`src/save-controller.ts:625-636`）：闸门是 `saveBaseline(path) !== null`
——初稿据此写「非 md 登记 revision 后自然进入备份路径，无需改代码」，评审 r1 推翻：
闸门本身含 mode 判（§3.2），`saveBaseline` 不放宽则本条不成立；§3.2 修正后本条才
成立（备份路径代码本身仍零改动）。spec「无落盘基准不留
备份」条款的触发面收窄为「未打开文件 / 未登记磁盘 revision」（fs-io delta）。
恢复侧（:672-696）以备份信封的 revision 为 CAS 基准，扩展名无关。

### 3.6 外部修改重载

`reloadDocument`（`src/save-controller.ts:506-530`）与 watch 分流（:556-591）：
revision 比对 + dirty 分流（未 dirty 自动重载 / dirty 给 sticky 选择），无 md 假设；
watch 事件不按扩展名过滤（`fs_io.rs` watch 全类型，忽略集只管 ghost/临时文件）。

### 3.7 后端守卫放宽（开门点 3）

`save_markdown`（`src-tauri/src/fs_io.rs:342-353`）的 `.md`/`.markdown` 白名单改为
**拒绝清单**：扩展名属于注册表 image/binary 类即拒（`fs_read_only`，文案同步改为
「不支持保存该文件类型」）。函数名随守卫语义改为 `save_document`（command 名
`document_save` 已经叫 document，不变——前端 IPC 零改动）。

**双表防漂移**（REVIEW.md 第 8 条纪律）：注册表单一事实源在 TS
（`attachments.ts`），Rust 侧拒绝清单是第二份表。机制：(a) Rust 常量表注释指向
`attachments.ts` 为事实源；(b) 实现期新增一条 Rust 单测，把拒绝清单与一份从
`attachments.ts` 生成的核对文件（或由 TS 侧单测反向断言）逐一对账——两侧任一漂移即红。
对账的具体载体（生成文件还是双单测互锁）由实现 mission 定，本 design 只钉「必须有
机器对账，不靠注释自觉」。

### 3.8 「另存为新文件」泛化

现状 `saveAsNewFile`（`src/save-controller.ts:469-498`）是 md-only 链路：去原扩展名后
经 `wikilinkCreate` 创建 `原名-恢复.md`；`create_target` 强制拼 `.md`
（`src-tauri/src/link_graph.rs:742-747`）。非 md 文件被外部删除后，这条逃生口会把
`config.yaml` 恢复成 `config-恢复.md`——错误的文件类型。

方案：另存路径泛化保留原扩展名（`note.txt` → `note-恢复.txt`；无扩展名 `LICENSE` →
`LICENSE-恢复`）。落点二选一（实现期定）：(a) 新增通用 `create_file` 命令（O_EXCL +
补齐中间目录 + vault 内路径校验，与 `create_new_vault_file` 同语义），`saveAsNewFile`
对非 md 走它；(b) 扩展 `wikilink_create` 接受显式扩展名。**推荐 (a)**：`wikilink_create`
的语义是「从 wikilink 解析创建笔记」，为它开扩展名分支会把 md 特有的解析逻辑与通用
文件创建耦合；`create_file` 是窄接口，恢复场景的逐级重试（-2..-5）与提示文案不变。

## 4. 编辑器内集成点

### 4.1 撤销栈

`history()` 模式无关（§R7）。可编辑 code 模式的 undo/redo 经统一键位表（`src/keys.ts`）
既有绑定直接生效；`trustedLoad` 的 `addToHistory(false)` 口径（:1388-1390）不变——
外部重载不进撤销栈。

### 4.2 dirty 与守卫族

dirty = 文本与 `cleanDoc` 比较（§R7），保存成功/重载/撤销回原内容都自然收敛。逐标签
dirty 点（M149）、切换文件/切换 vault/退出守卫（M101/M163）对非 md dirty 直接生效——
这正是 M130 要消灭的「dirty 锁死」的反面：现在 dirty 有出口（Cmd+S 与自动保存真实可达）。
M130 兜底反馈（`src/save-controller.ts:312-322`「当前文件不支持保存：Lumir 只保存
Markdown 文件」）的触发面收窄为「未打开文件/未登记 revision」，文案同步更新（修订文案
归实现期，落 `文案-Copy.md` 口径核对）。

### 4.3 搜索面板

模式无关（§R7）。panel 无替换控件（只读期口径），本期不新增替换（Non-goal）。

### 4.4 大纲 / 变量高亮 / 结构解析缓存

内容键缓存口径 spec 已预见可编辑（§R6），无需改 spec。实现期复核项：编辑频繁时旧内容
键的缓存淘汰（现行淘汰策略若按 LRU/容量上限则天然成立；实现期读 `src/code-structure.ts`
确认并记录）。

### 4.5 折行与模式热切换

`wrapExtensions` code 分支不变；`modeAndWrapEffects` 的重配序不变。配置 `editor.mode`
热切换对「已打开文件」仍无影响（spec「模式配置来源」保留该条款，只改「只读」字样）。

## 5. 护栏

| 护栏 | 现状锚点 | 本 change |
|---|---|---|
| 二进制不入编辑器 | 注册表 image/binary 类分流（`src/tree.ts:38-42`）+ 「暂不支持预览」提示（`src/main.ts:408-411`） | 不变 |
| 未知扩展的真二进制 | 打开即 `fs_invalid_utf8` 拒读（`src-tauri/src/fs_io.rs:333-335`），走打开失败提示 | 不变（只读期同路径，已实证） |
| 超大文件 | 50MB 硬上限 `ATTACHMENT_MAX_BYTES`（:29-30），校验在分配前（:287-302） | 不变；D4 推荐项不新增只读阈值，实现期真机 perf 复测（打开 1MB <100ms 合同不因非 md 放宽；编辑态高亮走 `StreamLanguage` 增量解析），不达标再回来加阈值并记入本文件 |
| vault 边界 | `resolve_in_vault` / `validate_vault_relative` 全套路径校验 | 不变 |

## 6. 被否决方案

- **V1 白名单可编辑**（txt/json/yaml/toml + 有语言包扩展，其余只读）：重新引入「两套
  集合差集」陷阱——M130 保存死态的根因正是分类分裂；且 `.log`/`.csv`/`LICENSE` 恰是
  「目前只能编辑 md」抱怨的高发面。范围边界每调一次都要同步文案、测试与守卫，长期成本
  高于全量文本类。（D1 备选）
- **V2 非 md 套 live preview**：装饰层是 md 语义（§R3），代码/配置/日志文件没有可装饰
  对象；零收益且违反 spec md-only 口径。（D2 备选）
- **V3 手动保存-only**（非 md 不进自动保存与崩溃备份）：在模式无关的链路里新设模式
  分支，比全量复用更复杂；崩溃备份对「编辑了一个小时的 Makefile 后崩溃」的防护价值
  不低于 md。（D3 备选）
- **V4 前端裁决、后端删守卫**：后端防线的价值在防前端 bug 把内容写进 image/binary
  路径；保留拒绝清单的成本是一张几十项的常量表 + 一条对账单测（§3.7），删除节省的
  成本趋近于零而风险敞口真实存在。
- **V5 新增超大文件只读阈值（如 1MB）**：没有实测证据先立用户可感边界（1MB 的 `.log`
  只读、0.9MB 可编辑）；现有 50MB 硬上限已挡内存灾难。先全量可编辑 + 真机复测，
  不达标再立阈值。（D4 备选）
- **V6 泛化 `wikilink_create` 支撑另存**（§3.8 方案 b）：把 md 特有的 wikilink 解析与
  通用文件创建耦合；`create_file` 窄接口更干净。
