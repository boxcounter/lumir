# Design: 按路径快速打开文件（quick-open）

- Change ID: quick-open-file-oct23
- 日期: 2026-10-23

本文只写「怎么做到 proposal 里已裁的行为」与「为什么这样做」。代码锚点是起草时在原分支逐一读过的
位置；行号会漂，实现前以符号名为准。

## 0. 事实清单（起草时核对过原文）

| 事实 | 锚点 | 与本 change 的关系 |
|---|---|---|
| 文件树点击 → 打开链路 | `src/tree.ts:687`（`cb.onOpenFile`）→ `src/main.ts:3612`（`openFile(..., "new")`） | 快速打开的落点与它**同一条**（D4） |
| 唯一打开链路 | `src/main.ts:2475` `openFile`：去重 → 跨 pane 移动 → 图片分流 → 壳态装载 → `loadSessionContent`（读快照 / 保存基准 / 装载事务 / 阅读位置 / `afterLoad`） | 只复用、不改写；外部只读是它之外的第二条装载入口（§5） |
| 文件分类 | `src/tree.ts:206` `openKind`（判据来自 `src/preview/attachments.ts` 的 `fileClassOfPath`） | 图片 / 二进制走各自既有处置，MUST NOT 另写扩展名集合 |
| wikilink 跟随 | `src/link-follow.ts:147` `followWikilink` → `openFile(path, openKind(path))`（缺省 `"current"`）+ 锚点 `revealLine` | 「就地替换」语义的既有持有者；快速打开**不**采用（D4） |
| 相对路径 md 链接 | `src/link-follow.ts:311` `followNoteLink` → Rust `link_resolve_note` → `openFile` | 同上；解析在 Rust（相对当前文件），与本 change 的「相对 vault 根」不同源，MUST NOT 混用 |
| 裸 URL ⌘-点击 / ⌘⏎ | `src/link-follow.ts:239` `linkTargetAt` 第三段 `literalLinkAt` → `openExternalLink`（系统默认应用） | **不开文件**：这类目标是外链，快速打开不接管它 |
| M632 行区间链接 | `src/harness-path-link.ts:20`（`LINE_SUFFIX`）、`:87`（`lineSuffixAt`）、`:321`（`openPathAtLine`）；装配在 `src/main.ts:2833` | 行号后缀的**唯一**语义来源；打开编排的既有形态 |
| 行落点唯一算式 | `src/editor.ts:2455` `revealLineAt`：`1..doc.lines` 钳制 + `scrollIntoView(y:"center")` + 转场窗口（CL-2） | 快速打开的行跳转 MUST 复用它，MUST NOT 另写 |
| vault 文件索引 | `src/main.ts:1081` `vaultFilePaths`（全部**非惰性**文件条目），`:3681` 装载时建、`:3734` watch 增量维护 | 候选列表的数据源；惰性条目不在其中（已知边界 §9） |
| 存在性兜底 | `src-tauri/src/commands.rs:868` `fs_paths_exist`（批量、只探测、不改写）；spec `fs-io`「vault 内路径存在探测」 | 精确路径不在索引里时用它判存在（惰性目录里的文件因此可开） |
| 匹配语义唯一实现 | `src/list-filter.ts:26` `isMatch` / `:32` `filterIndices`（大小写折叠子串，非模糊） | 候选列表直接复用；MUST NOT 写第二份匹配 |
| 浮层形态先例 | `src/toc.ts:329` `.lumir-toc`（输入框 + listbox + 空态 + 提示行，挂 modeline、向上展开；`aria-activedescendant` 在持焦元素上） | 快速打开浮层的形态、键位就地消费、`focusout` 外移挂点全部照抄 |
| 输入条先例 | `src/goto-line.ts:78` `createGotoLinePrompt`（`.lumir-goto`，同挂点；Enter / Esc / ⌃G 就地消费） | 同族；快速打开比它多一份候选列表 |
| 阅读位置合同 | `docs/design-parity-contract/overlay-close-reading-position.md` CL-1 | 浮层关闭交还焦点走 `focusPreservingReadingPosition`，MUST NOT 裸 `view.focus()` |
| vault 路径约束 | `src-tauri/src/fs_io.rs:803` `resolve_in_vault`（拒绝绝对路径 / `..` / 符号链接逃逸）；spec `fs-io`「vault 内路径约束」 | 外部只读**必须**新增通道，MUST NOT 放宽它（§5.1） |
| 绝对路径拼接唯一处 | `src/tree.ts:33` `vaultAbsolutePath`（「复制完整路径」的消费者）；spec `file-tree`「复制完整路径」 | 粘贴回填的**反向**收敛（根前缀剥离）与它同源 |
| 标签持久化的唯一构造点 | `src/vault-switcher.ts:131` `paneSnapshot`：所有**有路径**的会话都入盘；spec `vault-workspace`「按 vault 持久化标签列表」明写「MUST NOT 存在有的标签不入盘的例外」 | 外部只读标签的唯一例外要落在这里，并由 MODIFIED delta 认领（§5.2） |
| 唯一键位表 | `src/keys.ts` 的 `KEY_BINDINGS` / `scopeOfCommand` / `KEYLESS_COMMAND_IDS`；`⌘O` 已占（`:703`，`vault.switcher`）、`⌘F` 已占（`:701`） | 新命令落点；`⌘P` 三条来源均空闲（§6） |

## 1. 复用面与边界（任务 1 的交付）

### 1.1 五条既有链路，逐条说清「可复用 / 不可复用」

1. **文件树点击**——入口 `src/tree.ts:687`；判定只有 `openKind`；落点 = 活跃 pane 新标签
   （`src/main.ts:3612`）。**可复用**：这条是「用户显式打开一个文件」的语义原型，快速打开与它
   同落点（D4）。**不可复用**：树点击的输入是**条目**（路径已经过模型校验），快速打开的输入是
   **自由文本**，存在性与形状判定必须新写。
2. **wikilink 跟随**——入口 `src/link-follow.ts:147`；解析在 Rust `link_graph_resolve`（名称匹配）；
   落点 = 就地替换前台 + 锚点行。**可复用**：`revealLine` 落点；**不可复用**：名称解析语义（短名 /
   路径后缀 / 大小写折叠的候选集）与本 change 的「路径」概念不同源，MUST NOT 拿它来解析输入串。
3. **相对路径 md 链接**——入口 `src/link-follow.ts:311`；解析相对**当前文件所在目录**。
   **不可复用**：基准不同（快速打开相对 **vault 根**）；混用会让同一条输入在两种上下文里指向
   两个文件。
4. **裸 URL ⌘-点击 / ⌘⏎**——`src/link-follow.ts:239`；只产外链，交系统默认应用。
   **不可复用**：它不是文件打开路径；快速打开不接管外链。
5. **harness 输出里的路径（含 M632 行区间）**——`src/harness-path-link.ts:169` 的候选识别以
   **索引命中**为可点判据（候选宽、校验严）；点击落点 `src/main.ts:2833` 的 `openPathAtLine`
   （打开 → 转场窗口内 reveal → 下一帧复核补发）。**可复用**：① 行号后缀的解析语义
   （`LINE_SUFFIX` / `lineSuffixAt`）；② 行跳转编排 `openPathAtLine` 及其 `needsRescroll`
   复核口径；③ 索引判定的思路（候选宽、校验严）。**不可复用**：它的正则扫描是「在一段正文里
   找路径」，快速打开是「整个输入就是一个路径」——用扫描器去解析整串会引入「中文边界 / 句末
   点号」那一整套与这里无关的规则。

### 1.2 复用清单（实现时按此接线，MUST NOT 另写同义实现）

| 复用件 | 位置 | 用法 |
|---|---|---|
| `openFile` / `openKind` | `src/main.ts:2475` / `src/tree.ts:206` | 唯一打开链路与新标签意图 |
| `openPathAtLine` + `revealLine` | `src/harness-path-link.ts:321` / `src/editor.ts:2455` | 行跳转（含越界钳制与 CL-2 窗口） |
| `LINE_SUFFIX` 语义 | `src/harness-path-link.ts:20` / `:87` | 输入串尾部的 `:行` / `:行:列` / `:起-止` |
| `vaultFilePaths` | `src/main.ts:1081` | 候选来源（同步、零 IPC） |
| `fs_paths_exist` | `src-tauri/src/commands.rs:868` | 精确路径不在索引时的存在性兜底 |
| `isMatch` / `filterIndices` | `src/list-filter.ts:26` / `:32` | 子串匹配（大小写折叠，不重排） |
| `.lumir-toc` 浮层手法 | `src/toc.ts:329` 起 | 输入框 / listbox / `aria-activedescendant` / 组合期不刷新 / `focusout` 外移 / 点击外部收起 |
| `vaultAbsolutePath` | `src/tree.ts:33` | 反向收敛（`root + "/"` 前缀剥离）的同源凭据 |
| `focusPreservingReadingPosition` | `src/main.ts` 装配、`src/editor.ts` 公共面 | 关闭浮层交还焦点（CL-1） |
| 键位表的命令 / 作用域 / 对账 | `src/keys.ts` | 新命令与默认绑定 |

**实现期要做的一处抽取**：`src/main.ts:2833` 的行跳转 plan（`open` / `reveal` /
`duringTransition` / `nextFrame` / `needsRescroll` 五件套）目前是 harness 面板路径点击的内联
闭包。快速打开需要**逐字相同**的五件套 ⇒ 抽成一个装配层函数（例如 `jumpPlanFor(path, line)`），
两处共用。MUST NOT 复制第二份「下一帧复核」判据（REVIEW.md「同一语义两处真源」条：复核条件
一旦分叉，两处会给出不同的滚动行为）。

### 1.3 边界（这些**不**复用，且 MUST NOT 被本 change 放宽）

- **vault 内路径约束**是安全边界，由 Rust 侧强制（`fs_io::resolve_in_vault`），spec 明写
  「MUST NOT 由调用方（webview）自觉保证」。外部只读因此**新增**一条命令，既有接口一条不改。
- **惰性条目不进索引**：`vaultFilePaths` 只含主动枚举到的条目。精确路径打开经
  `fs_paths_exist` 兜底（可开）；**按名字检索**找不到惰性目录里的文件（已知边界，§9）。
- **图片 / 二进制分类**只由 `openKind` 判：图片走图片标签，二进制给既有「暂不支持预览」提示。
- **标签持久化**的「每一个有路径的标签都入盘」是 living spec 的硬句 ⇒ 外部只读标签需要一条
  显式例外（MODIFIED delta 认领）。
- **watch 只覆盖 vault**：外部文件被外部改写不会收到事件（§5.2 的已知边界）。
- **阅读位置按 vault + 路径**：外部会话不记（键空间与「换 vault 后相对路径仍有效」的前提都不成立）。
- **保存链路按 vault 相对路径 + revision CAS**：外部会话不登记保存基准。

## 2. 输入解析（`{path}:{line}`）

### 2.1 次序：存在性优先

```
input --trim--> raw
  1) 归一化（§2.3 的绝对路径收敛 / `./` 前缀）
  2) 若 raw 整串命中（索引 or fs_paths_exist）→ 打开 raw，无行号
  3) 否则若 raw 尾部是合法行号后缀 → 剥后缀得 p
       3a) p 命中 → 打开 p，落点 = 后缀的起始行
       3b) p 不命中 → 「找不到」
  4) 否则若输入是目录 → 提示「这是目录，不能打开」
  5) 否则 → 「找不到」+ 候选列表（查询 = raw）
```

**为什么存在性优先**：文件名里可以有冒号（POSIX 允许，APFS 上合法）。正则优先的实现里
`v1:2.md` 会被拆成路径 `v1` + 行 2 —— 这个文件从此打不开，而且失败形态是「看起来功能正常、
个别文件永远找不到」，最难归因的一类。先试整串，代价只是一次字符串比较（索引是内存数组）。

**为什么 `3b` 不再回退成候选直开**：剥出来的 `p` 不存在时直接给「找不到」，而不是挑一个
模糊命中——「我粘贴的是精确路径」这个语境下，猜一个近似文件比报错更糟。

### 2.2 后缀语义：复用，不重写

后缀解析复用 `src/harness-path-link.ts` 的 `LINE_SUFFIX` 语义，形态与落点口径逐字一致：

| 输入尾部 | 是否成立 | 落点 |
|---|---|---|
| `:12` | 是 | 第 12 行 |
| `:12:3` | 是（列号只解析） | 第 12 行（列不参与） |
| `:120-140` | 是 | 第 120 行（`止` 只参与「后缀是否成立」） |
| `:12-` / `:40-12` / `:9-12-15` / `:0` | 否（整段不成立） | 按无后缀路径处理，多半 = 找不到 |
| `:12x` / `:12/5` | 否（后缀之后是 ASCII 路径延续） | 同上 |

实现方式：把 `lineSuffixAt` 从 `harness-path-link.ts` 中**导出**（它现在是模块私有），或抽到
一个更小的纯函数模块。**MUST NOT 复制一份正则**——两种后缀解析一旦分叉，同一串在一个入口能开、
另一个入口打不开，属于最难发现的漂移。

**已知边界（如实记录）**：中文紧贴行号（`路径.md:12的`）在**正文扫描**里有既有的边界规则；
快速打开的输入是单串，不存在「紧贴中文行文」的问题——输入串里出现的非路径字符一律按不命中处理。

### 2.3 路径归一化

1. `trim()`（粘贴常带首尾空白 / 换行；单行 `<input>` 本身会剥掉换行）。
2. **绝对路径收敛**：以当前 vault 根（`loadedRoot`，`src/main.ts:1087`）为前缀的绝对路径 SHALL
   剥成 vault 相对路径；前缀剥离用 `vaultAbsolutePath` 的**同一拼接口径**（`src/tree.ts:33`），
   不在新模块里再拼一次 `/`。前缀比对 SHALL 容忍大小写差异（先原样比、再折叠比；macOS 文件系统
   默认大小写不敏感，从 Finder 复制的根路径大小写未必与注册项一致）——否则一个大小写不同的根
   前缀会把 vault 内文件误判成 vault 外、从而只读打开。剥完为空（= vault 根本身）按目录处理
   （提示，不打开）。
3. 绝对路径**不以** vault 根开头 → D2 的另一侧：外部只读（§5）。
4. `./` 前缀剥掉；其余相对路径按「相对 vault 根」解释。
5. 反斜杠一律视为不合法（本仓路径分隔符只有 `/`，与 `isWellFormedVaultPath` 同口径）。
6. **大小写**：逐字精确优先；无精确命中时按大小写折叠做一次等值回退（macOS 默认大小写不敏感，
   用户从 Finder 复制来的大小写未必与磁盘一致）。折叠后命中多条 ⇒ 不猜，列候选。
7. **目录判定**：复用文件树既有的只读查询 `FileTree.hasDir(path)`（harness 的目录链接已在用同一
   份模型）——MUST NOT 另建目录索引，也 MUST NOT 为「这是不是目录」再发一次后端探测。

### 2.4 例子（实现期的单测表就是这几行）

索引里有 `notes/plan.md`、`notes/v1:2.md`、`apps/api/package.json`，vault 根 `/v`：

| 输入 | 结果 |
|---|---|
| `notes/plan.md:12` | 打开 `notes/plan.md`，落第 12 行 |
| `/v/notes/plan.md:12` | 同上（根前缀剥离） |
| `notes/v1:2.md` | 打开该文件（整串命中，**不**拆成 `notes/v1` + 行 2） |
| `./notes/plan.md` | 打开 `notes/plan.md` |
| `NOTES/PLAN.md` | 折叠等值唯一命中 ⇒ 打开 `notes/plan.md` |
| `apps/api/package.json:71` | 打开并落第 71 行（原话里给的形态） |
| `notes/plan.md:12:3` | 打开并落第 12 行（列不参与） |
| `notes/plan.md:0` | 后缀不成立 ⇒ 整串不命中 ⇒ 找不到 |
| `notes/plan.md:9999` | 打开，落点钳制到末行（`revealLineAt` 的既有钳制） |
| `notes`（目录） | 提示「这是目录」 |
| `/etc/hosts` | D2 倾向侧：只读打开；另一侧：提示「不在当前 vault 内」 |

## 3. 候选列表与匹配

- **数据源**：`vaultFilePaths`（`src/main.ts:1081`）。它是「全部非惰性文件条目」的 vault 相对
  路径数组，已在内存、随 watch 增量维护 ⇒ 每键一次过滤是零 IPC 的同步操作。
- **匹配**：`filterIndices(vaultFilePaths, query)`（`src/list-filter.ts:32`）——大小写折叠子串，
  按源序（= 索引序），不重排、不打分、不高亮。**匹配对象是完整相对路径**（不是仅文件名）：粘贴
  的路径片段（`changes/x/spec.md`）因此能命中；只输文件名也能命中末段。
- **空查询**：不列全量（大 vault 会有上万条）。提示行给一行用法（「输入路径或文件名」）。
- **渲染上限**：`CANDIDATE_LIMIT = 100`。命中总数超过上限时，提示行显示总数并说明「只显示
  前 100 条」（如「命中 N 条，显示前 100 条」）。上限是 DOM 成本闸，不是匹配语义的一部分。
- **IME**：组合期不刷新（照 `src/toc.ts` 的 `composing` 手法：`compositionstart` / `end`）。
- **点击**：候选行 `mousedown` 不夺焦点（照 TOC 的既有写法），`click` 打开。
- **选中打开**：走 `openFile`，**不再经过路径解析**（候选的路径已经过索引校验）。

## 4. 打开编排（落点、行跳转、重入）

- **落点**：`openFile(path, openKind(path), "new")`——与文件树点击同落点（D4）。去重与跨 pane
  移动由 `openFile` 既有逻辑承担（`sessionForPath` → 移动 / 激活）。
- **行跳转**：`openPathAtLine(plan, path, line)`，`plan` 由 §1.2 抽出的 `jumpPlanFor` 提供。
  无行号时不碰视口（与 harness 路径点击同一条早退）。
- **关闭时机**（两条输入来源共用一条规则）：**打开成功之后才关浮层**。失败时浮层保持打开、提示行
  给原因、输入内容保留——「输错一个字」不必重开重粘。候选选中路径同理（候选的路径已经过索引校验，
  失败只会来自 I/O 或目标在打开瞬间消失）。实现上要等 `openFile` 的布尔结果，MUST NOT 在发起
  打开前就无条件关闭。
- **焦点交还**：浮层关闭后焦点 MUST NOT 落回 `body`（否则紧接着的键入无人接收）。成功打开时焦点
  SHALL 交还活跃 pane 的编辑器：无行号走 `focusPreservingReadingPosition`（CL-1 口径），带行号走
  既有「先交还焦点再落点」的路径（goto-line 的 `jumpToLine` 就是这一条：`revealLine` 只 dispatch
  选区，不负责 DOM 聚焦）。
- **并发 / 重入**：Enter 连按、异步存在性探测在途时再改输入——用一次请求序号（或 in-flight
  标记）丢弃过期结果；失败与过期都 MUST NOT 留下空标签（`loadSessionContent` 已保证「读失败
  不留标签」，外部路径同样按此收口）。
- **`{path}:{line}` 与打开意图的先后**：行号只在**打开成功**后使用；文件已打开（命中既有标签）
  时同样落点（`openPathAtLine` 的 `plan.open` 返回 true 即继续）。

## 5. vault 外只读会话（D2 倾向侧）

> 若 D2 裁另一侧（只认 vault 内），本节整节删除，`fs-io` 的 ADDED 与 `vault-workspace` 的
> MODIFIED 一并删除，`quick-open` delta 的第 5 条 requirement 改写为「拒绝并给人话提示」。

### 5.1 后端：一条显式路径读取命令

- 新命令 `fs_read_external(path: String) -> ExternalTextSnapshot`（`{ content: string }`）。
  **不返回 revision**：外部会话不保存，revision 没有消费者（REVIEW.md「值或开关声明了却没有
  消费者」条）。
- 校验顺序（全在 Rust，webview 不参与）：
  1. `Path::is_absolute()` 必须成立；
  2. 输入里不允许 `..` 段（形状明确，避免歧义；绝对路径下 `..` 本无逃逸含义，这里按「不认」
     处理，与 `isWellFormedVaultPath` 的口径一致）；
  3. `canonicalize()`（**跟随符号链接**——`/tmp` 本身是符号链接，拒绝符号链接会让最常见的
     临时路径不可用）后必须是**常规文件**（目录 → `fs_not_a_file`）；
  4. 大小上限复用 `ATTACHMENT_MAX_BYTES`（50MB，`src-tauri/src/fs_io.rs:371`）——它是「文本
     读取」与「附件」共用的那一个常量，MUST NOT 新写一个数；
  5. UTF-8 解码失败 → 与 vault 内读取**同一组错误码**（`fs_invalid_utf8` / `fs_read_failed`），
     MUST NOT 发明平行 code（错误码到文案的映射表在 `src/copy-data.ts` 的 `ERROR_COPY`，出新
     code 就多一行没人维护的文案）。
- **不提供**：目录列举、通配、递归、写入。命令只回答「读出这一个文件」。
- **调用约束**：只由用户的显式路径输入触发；MUST NOT 用在任何自动扫描 / 批量 / 后台任务上
  （spec 里写成约束，代码里也没有第二个调用点）。
- 注册进 `src-tauri/src/lib.rs` 的 `generate_handler!`（custom command，不需要 capability 项）；
  ts-rs 重导出 `src/bindings/ExternalTextSnapshot.ts`。

### 5.2 前端：外部只读会话

- **会话标记**：`EditorSession` 增一个显式字段（如 `external: boolean`，创建点定死、全生命周期
  不变），**MUST NOT** 用「`path` 是否以 `/` 开头」在各处现场推导——那会在每个消费点长出第二个
  判据。派生的唯一判据函数放在会话模型旁。
- **只读**：`editable === false` 走既有的结构性只读面（`modeExtensions` 的 `EditorView.editable`
  + `EditorState.readOnly` + `changeFilter` 兜底），MUST NOT 用 DOM 层吞键冒充。
  **风险点（实现期必须收敛）**：可编辑性有三处按路径重算——`makeSession`
  （`src/editor.ts:2083`，判据在 `:2086`）、`reloadSession`（`:2551`）、
  `remapSessionPaths`（实现 `:2620`，接口声明 `:1149`）。外部会话要在**这三处**落到同一判据（例如
  `editable = !external && isEditablePath(path)`），否则一次装载就能把只读翻回可编辑。
- **逐项不参与**（每条都有既有代码在按 vault 相对路径工作，必须显式跳过）：

  | 面 | 既有位置 | 外部会话的处置 |
  |---|---|---|
  | 保存 `⌘S` / 保存全部 | `src/save-controller.ts` | 无落点（结构性只读已挡住 dirty；保存链路按 `session.path` 直调后端会被 `fs_path_escape` 拒绝——仍须在入口早退，不让用户看到红字） |
  | 磁盘 revision 登记 | `loadSessionContent` 的 `save.noteOpened` | 不登记 |
  | 崩溃备份 | `recovery_*`（按 vault + 相对路径） | 不写 |
  | watch / 外部改写提示 | `fs:entry_changed` 增量 | 不参与（外部文件被改不会提示，见 §9） |
  | 阅读位置 | `readingPositions`（按 vault + 相对路径） | 不记、不恢复 |
  | 标签持久化 | `paneSnapshot`（`src/vault-switcher.ts:131`） | **不入盘**（唯一例外，MODIFIED delta 认领） |
  | 链接解析基准 | `src/link-follow.ts:78` `resolveBase()` | 外部会话不提供 from（wikilink / 相对链接在外部文档里不解析） |
  | mtime 读取 | `ensureMtime`（`src/editor.ts:1655`） | 不调用（否则每标签一次必然失败的 IPC） |
  | 树当前行高亮 | `tree.setCurrentPath` | 空动作（路径不在树模型里，天然 no-op） |

- **装载**：新增 `openExternal(path, line)`（装配层）——`fsReadExternal` → 建会话（`external:
  true`、`editable: false`）→ `reloadSession` → `afterLoad`。MUST NOT 走 `loadSessionContent`
  （它的每一步都假设 vault 相对路径）。
- **去重**：`sessionForPath(abs)` 天然按字符串相等去重；同一外部路径再次打开 = 切到既有标签。
- **视觉标记**：modeline 右段在外部会话上追加一段（「vault 外 · 只读」，实现期取文案号）；
  标签的可访问名（`aria-label`，现由「文件名 / 未保存变体 D90」两态派生，`src/tabs.ts:288`）
  追加同一句。标签的 `title` 本来就是完整路径（`src/tabs.ts:289`），外部会话因此天然显示绝对路径。
  **不加颜色 / 图标 token**：现有视觉场景里没有外部会话，既有基线因此零变化（若实现期发现基线
  变化，按「基线更新是人肉裁决点」报 Alex 过目）。
- **未覆盖**：外部图片 / 二进制（`openKind` 为 image / binary 时给一行提示「暂不支持在 vault 外
  打开这类文件」）。

### 5.3 安全面（如实写进 spec 的边界）

- 本命令让**应用**能读用户磁盘上任意一个被显式输入的文本文件。与「把某个目录开成 vault」相比，
  它扩大的是**方便度**而不是用户的权限；但它确实是一条新的读取通道，因此约束写成：显式输入触发、
  只读、只读单文件、有大小上限、不列举目录。
- 既有 vault 内接口的约束一条不放宽（spec 的「vault 内路径约束」逐字保留）。

## 6. 键位：`⌘P`

三条来源逐条核对（结论要写进绑定对象的来由与实现注释，表即文档）：

1. **表内**：`src/keys.ts` 的 `KEY_BINDINGS`（67 条显式绑定 + 9 条程序化生成的 `⌘1–⌘9`）无 `Cmd-p`（`⌘O` 已归
   `vault.switcher`（`:703`）、`⌘F` 归 `app.search-open`（`:701`）、`⌘⇧O` 归 `toc.toggle`）。
2. **原生菜单**：tauri 2.12.4 的 `Menu::default()` 在 macOS 上 File 子菜单只有 `CloseWindow`
   （`~/.cargo/registry/src/*/tauri-2.12.4/src/menu/menu.rs:202-213`）；muda 0.20.0 的预置加速键
   表（`.../muda-0.20.0/src/items/predefined.rs:617` 起）逐项是 ⌘C / ⌘X / ⌘V / ⌘Z / ⇧⌘Z / ⌘A /
   ⌘M / ⌘0 / ⇧⌘= / ⌘− / ⌃⌘F / ⌘H / ⌥⌘H / ⌘W / ⌘Q / ⌃⌘Space，**无 ⌘P**。本应用自建菜单项只有
   ⌘Q。
3. **系统级 / webview**：macOS 不把 ⌘P 预置为系统菜单键（打印是应用自己往 File 菜单里加的项，
   本应用没有打印能力）。**待真机核验**：WKWebView 自身是否另有一条 ⌘P 处理——实现期按既有真机
   套件加一条按键断言（与 M242 的「token 形态必须真机验」同口径）。

- 命令 id：`app.quick-open`，进 `NON_TAB_GLOBAL_COMMAND_IDS` ⇒ 作用域机械派生为 `global`（焦点
  在编辑器 / 树 / 浮层里都要能按）。**有默认绑定** ⇒ MUST NOT 进 `KEYLESS_COMMAND_IDS`。
- 单段、无空白 ⇒ 可经 `[keys]` 重绑 / 解绑（MUST NOT 用多段 chord 作默认键位，见 living spec
  「界面语言切换命令」的同款判词）。
- 浮层自己的键（Enter / Esc / ↑↓ / ⌃N⌃P）**不进** `KEY_BINDINGS`：输入框持焦时事件目标在
  浮层里，`editor` / `text` 作用域的绑定不命中；这些键由浮层就地消费（TOC 的既有形态）。`Tab`
  本版不接管（不补全、不跳候选），留给原生焦点遍历。
- 浮层打开时再按 `⌘P`：**收起**（toggle 语义；`⌘P` 是 chord，`isTypingKey` 守卫不拦它，命令
  必然到达命令层，因此「已打开就关」必须由命令实现处理）。

## 7. 文案（实现期取号，提案不占号）

需要的可见串（数量按实现时的实际 UI 定）：

1. 输入框读屏名 + 占位（用法提示）；
2. 提示行的三类：找不到 / 是目录 / 不在当前 vault 内（D2 另一侧才需要最后一条）；
3. 候选上限提示（命中 N 条，显示前 100 条）与空态；
4. 外部只读标记（modeline 段 + 标签 aria）；
5. 外部读取失败的人话句（尽量复用 `ERROR_COPY` 的既有 code，不新造 code）。

编号在实现期从当时的 master 末位顺延（HANDOFF 的取号规则），两列并排进 `文案-Copy.md`。

## 8. 视觉口径（无原型）

本 change **没有原型**（`design/prototypes/` 无对应物），浮层形态直接复用既有 `.lumir-toc` 的
几何：挂在 modeline 上沿、向上展开、列表是唯一滚动容器、输入框下划线形态、主题 token 自动继承
（eink 由既有规则覆盖）。**MUST NOT 新增色值 / 字号 / 圆角 token**；候选行的高亮沿用
`.lumir-toc-item.is-active` 的既有态。唯一新增的可见元素是 §5.2 的 modeline 只读段（文本，不占
新样式）。

## 9. 已知边界（如实记录，MUST NOT 当成缺陷回头修）

1. **惰性目录里的文件只能按精确路径打开**：`vaultFilePaths` 不含惰性条目，按名字检索不到；
   精确路径经 `fs_paths_exist` 可打开。
2. **vault 外文件不参与 watch，也不因切标签重读**：外部只读标签在它的生命周期内是**打开那一刻的
   快照**——切走再切回仍是同一份内容；要拿最新内容就关掉标签重开。这是只读 v1 的已知取舍。
3. **外部只读不覆盖图片 / 二进制**（§5.2）。
4. **候选只来自当前 vault**：不跨 vault 检索。
5. **不创建文件**：路径不存在只提示。
6. **大小写折叠只在「无精确命中」时使用**：磁盘上同时存在 `A.md` 与 `a.md` 时，精确输入必中其一，
   折叠输入列候选。
7. **行号后缀只认 `LINE_SUFFIX` 的三种形态**（`:行` / `:行:列` / `:起-止`）；`:起-止:列` 不叠加
   （与 M632 逐字同口径）。
8. **`⌘P` 的 WKWebView 层行为待真机核验**（§6 第 3 条）。

## 10. 测试与验收面

- **单测（纯函数）**：解析表（§2.4 每一行）、大小写折叠与多命中、后缀畸形、绝对路径收敛、
  候选过滤（复用 `list-filter` 的既有单测，不重测它的语义，只测「匹配对象是完整路径」）。
- **视觉场景（chromium）**：`⌘P` 开浮层 → 空态提示 → 输入命中 → 候选游标 / Enter 打开 →
  Esc 关闭且阅读位置不变（CL-1）；无 vault 时的提示。
- **真机场景**：粘贴 vault 内 `path:line` 一次 Enter 落行；粘贴 vault 外路径只读打开 + `⌘S`
  无反应 + modeline 只读段在场 + 重启后该标签不回来；`⌘P` 三处焦点（编辑器 / 树 / composer）
  各按一次。
- **Rust 单测**：外部读取命令的目录 / 超限 / 非法 UTF-8 / `..` / 非绝对路径五条拒绝路径。
- **性能**：大 vault（≥5k 文件）上每键过滤 + 100 条渲染的 keypress→列表可见读数，按既有 perf
  方法学记一次（不预称达标）。
