# Proposal: 新建文件打开成功后把焦点交给正文首行

- Change ID: `focus-created-document-nov23`
- 日期: 2026-11-23
- 角色: Alex Lee（裁决、节点 1），AI agent（起草）

> **节点状态（先读这一段）**
>
> - **节点 1：F1 / F3 已批准；F2 修订已追认。** Alex 2026-11-23 回话「按推荐」覆盖
>   F1 / F3；F2 修订经 Alex 2026-11-23 回复**「好，按这个规则处理」**追认通过。逐条落值见
>   下方裁决点表。
> - **F2 追认记录（2026-11-23）**：Alex 原话「好，按这个规则处理」。追认的是送裁文案里的
>   浮层例外：新建文件装载期间用户打开 quick-open / goto-line 时，文档切换仍关闭浮层，但不把
>   焦点交还旧编辑器；浮层关闭后若没有其他仍在场的焦点目标，焦点落到新文档正文首行；焦点若
>   已移到 composer、文件树行或编辑器等仍在场目标，仍严格不抢。
> - **实现已落地**（mission 分支 `feat/focus-created-document-nov23`，实现提交 `8d746878`，
>   验证制品返修提交 `df1658d8`；覆盖读数见本块下方「实现与验证状态」）。代码本体、测试与验收
>   场景均已提交；实现已合并并推送至 master（`57c64851`）。本次提交执行归档，living spec
>   的改动已由归档包装器并入。
> - **节点 2 材料已备**（2026-11-23，五要件齐）：最终独立评审 **clean / merge** 绑定 tip
>   `df1658d8`；merge 已完成，归档提交与归档后审计在本次收尾执行。五要件逐条读数见文末「节点 2」块。
> - **实现与验证状态（2026-11-23，返修后）**
>   - 代码：`src/focus-claim.ts`（新，判定纯函数）、`src/main.ts`（create 分支 `claim` + await
>     + 判定 + `focusPreservingReadingPosition`；`passiveOverlayClose` 沿完整激活链透传）、
>     `src/tabs.ts`（`DocumentSwitchOptions`）、`src/quick-open.ts`（公开 `close(restoreFocus?)`
>     与转发）、`src/goto-line.ts` / `src/quick-open.ts`（被动关闭把仍在浮层内的焦点显式
>     `blur()` 回 `body`，理由见 design §2.2 / §6）。
>   - 浏览器层（`tests/visual/scenes/focus-created-document-nov23.spec.ts`，14 例全绿）：
>     三入口（目录行 / 根级 / 空 vault）焦点与 caret / scrollTop；装载中打开 quick-open 与
>     goto-line（light / dark 各一次，目标路径 `source-ready` 为唯一分界）；**装载中焦点进入
>     真实 harness composer**；装载中焦点移到仍在场的树行；**未命名 dirty 守卫导致
>     `openFile=false`**；**新建子目录**焦点与标签栏 / 编辑器矩形逐值不变；快速打开仍交还
>     编辑器（回归）；树点击既有文件不聚焦（反向）；聚焦前后编辑器与标签栏矩形不变。
>   - 反向验证（判据有区分度）：旧实现 5 红 3 绿；只保留 `afterLoad` passive → quick-open /
>     goto-line 必红；去掉 `shouldClaimFocus` → harness composer 负例必红；去掉 `opened`
>     闸门 → dirty 守卫负例必红；在新建子目录分支注入聚焦 → 子目录负例必红。
>   - 门禁与真机读数见 `tasks.md` 的「实现与验证状态」块（quick / visual / 真机 47c）。
>   - **未验项（就地登记，不虚构）**：`restoreFocus` spy（页面侧不可观测，需产品侧测试钩子）、
>     新建文件的 frontmatter 形态矩阵（该链路文档恒为空文件）、合并节点的 backlog 记录与
>     独立评审（本 mission 不 merge / 不归档）。
> - 本 change 只到提案层：living spec 的改动以 delta 留在本目录，归档时并入，不提前改写。
> - **评审返修（2026-11-23，第二轮）**：① passive 值覆盖完整激活链（激活阶段与装载收尾的每个
>   `syncActiveDocument` 同步点），不只 `afterLoad`；② quick-open 公开 `close` 签名与包装改为
>   `close(restoreFocus?: boolean)` 并转发；③ 测试改为记录焦点事件顺序与当时文档内容 / 前台
>   session，不以共享 `contentDOM` 的最终获焦为唯一判据；④ F2 状态改为待追认（后续已追认，
>   见节点状态与 F2 裁决行）。

## Why

### 现场：新文件打开了，键盘却不在里面

从文件树新建文件后，用户的下一个动作几乎总是「开始写」。今天的链路是：

| 环节 | 位置 | 行为 |
|---|---|---|
| 创建分支 | `src/main.ts:2657-2667` | `await fsCreateFile` → `tree.endInlineEdit(true)` → `void openFile(created, openKind(created), "new")` |
| 退出内联编辑 | `src/tree.ts:1368-1378` | 成功时删掉临时行与输入框；`create` 没有 `restore`，焦点落到 `body` |
| 打开既有 / 新文件 | `src/main.ts:2824-2886` | 新文件走装载；“已打开”分支只激活标签，不聚焦 |
| 装载 | `src/editor.ts:3214-3279` | `reloadSession` 把 caret 放到 frontmatter 之后的第一条正文行（C3），**不调用 `focus()`** |
| 装载后同步 | `src/main.ts:2761-2764` | `afterLoad` 只 `showEditor()` + `syncActiveDocument()`，两者都不聚焦 |

结论：**caret 已经落在正确位置，缺的只是聚焦**。根因是创建链路的收尾只做装载与表现层同步，
没有「把焦点交给新文档」这一步。

### 为什么只在创建链路做

全仓只有一条「交还焦点」的合法实现：`editor.focusPreservingReadingPosition()`（M280 口径；
`src/main.ts:1166` 明文禁止裸 `view.focus()`）。「打开文件」的焦点语义按入口各不相同：文件树
点击不聚焦；快速打开成功后有既有的「关闭输入面并把焦点交还编辑器」条款（`quick-open` spec；
实现是 `src/quick-open.ts:672` 的 `close()` 默认 `restoreFocus`）。本 change **不统一**这些
语义，只在创建链路补「打开成功后聚焦」这一步；其他入口逐字不变。

新建文件不同——它是用户的显式创建动作，紧接着的意图就是输入。

`goto-line` 已有同族先例：焦点已被用户移走时不拽回（`src/goto-line.ts:72-77`）。本 change 沿用
这条纪律。

## What Changes

1. **聚焦判定**：`submitInlineEdit` 的 `create-file` 分支在 `await fsCreateFile` **之前**捕获
   `document.activeElement`（此时是内联输入框）。`openFile` 改为取返回值并携带一个仅本次装载
   生效的 `passiveOverlayClose` 选项。该值 MUST 覆盖本次装载激活经过的**全部**表现层同步点，
   不只装载收尾：`loadSessionContent` → `activateSessionInOwnerPane` →（必要的）
   `activatePane` 与 `TabsHandle.activateTab` → 各自的 `syncActiveDocument`，以及
   `afterLoad` → `syncActiveDocument`。这些同步点关闭 quick-open / goto-line 时 MUST 使用
   被动关闭（不恢复旧编辑器焦点）；默认值仍为 `false`，其他调用方不传。
   - 用户已把焦点移到**仍在场的**其它目标（文件树另一行、编辑器、harness composer）时
     MUST NOT 拽回。
   - 装载期间用户打开的 quick-open / goto-line 由文档切换被动关闭：关闭 MUST NOT 把焦点交给
     旧编辑器（这是本返修的核心），关闭后焦点按创建意图落到新文档。
   - 该「浮层例外」是 F2 的修订值，**已由 Alex 2026-11-23「好，按这个规则处理」追认**；
     它不是原「移走即不聚焦」批准的一部分，追认记录见节点状态块。
   - 打开成功后，仅当焦点停在 `body` / `null` / 原输入框上时，调用
     `editor.focusPreservingReadingPosition()`。
   - 不新增第二条聚焦通路，不新增 `EditorHandle` 方法；新文档的阅读位置本来就在原点，
     `focusPreservingReadingPosition` 退化为「只聚焦、不写回」，不违反 M280。
2. **覆盖面**：目录行菜单、vault 根级菜单、空 vault 的「新建笔记」按钮共用同一条
   `submitInlineEdit` 链路，自动覆盖；不为任一入口另写通道。
3. **规格**：`file-tree` 的「目录下新建」MODIFIED（焦点规则只写一次），「vault 根的新建入口」
   MODIFIED 只加指针与场景断言。新增场景：焦点落正文首行、仍在场的焦点不被抢、装载中打开的
   浮层被动关闭、**快速打开仍交还编辑器（回归）**、文件树打开既有文件不改焦点（反向）。
4. **排除面**：`openFile` 的默认行为（其他调用方不传 `passiveOverlayClose`）、
   `syncActiveDocument` 的默认行为、快速打开的焦点交还、启动时的未命名文档都不改。

## 节点 1 裁决点（F1 / F3 已批准；F2 修订已追认）

| # | 裁决点 | 推荐值 | 批准状态 | 备选 / 代价 |
|---|---|---|---|---|
| **F1** | 「新建文档」的范围 | **只指文件树创建的文件**（目录行 / 根级 / 空 vault 按钮），不含启动时的未命名文档 | **已批准**（Alex 2026-11-23「按推荐」） | 含启动未命名文档：启动即抢焦点，与「恢复上次现场」的其它启动动作竞争，且用户可能只想先看 |
| **F2** | 用户已移走焦点时是否放弃 | 原值「严格不抢」；**修订值**：仍在场的焦点目标不被拽回；装载中打开的浮层由文档切换**被动关闭**、不恢复旧编辑器焦点，随后焦点按创建意图落到新文档 | **已追认**（Alex 2026-11-23「好，按这个规则处理」） | 无条件聚焦：会把正在 composer 打字的用户拽走；默认 close：浮层关闭时在 `openFile` 返回前把焦点交给旧编辑器，事后无法撤销 |
| **F3** | 是否顺带关闭大纲 / 快速打开浮层 | **不额外处理**，沿用 `syncActiveDocument` 的既有收起（仅把创建链路的关闭改为被动） | **已批准**（Alex 2026-11-23「按推荐」） | 额外关闭：创建动作与这些浮层的打开状态无关，扩大副作用面 |

F2 的修订值来自 2026-11-23 第二轮评审：原「移走即不聚焦」无法在 `syncActiveDocument` 的既有
关闭路径上兑现（默认 `restoreFocus` 会在 `openFile` 返回前抢焦），被动关闭是本轮要求的修正。
它改变了 F2 的语义边界，因此单独送 Alex 追认。**追认结果：Alex 2026-11-23 回复「好，按这个
规则处理」，F2 修订通过。** 送裁文案原文如下（即获追认的规则）：

> **F2 修订追认（送裁文案）**：新建文件装载期间，如果用户打开 quick-open 或 goto-line，
> 文档切换仍关闭浮层，但不把焦点交还旧编辑器；浮层关闭后，若没有其他仍在场的焦点目标，
> 焦点落到新文档正文首行。焦点若已移到 composer、文件树行或编辑器等仍在场目标，仍严格不抢。
> 其他打开路径及 quick-open 默认的焦点交还行为不变。

## Non-goals

- **不改 `openFile` 的默认行为**：文件树点击、wikilink 跟随、会话恢复都不因此聚焦；快速打开
  成功后的既有「交还编辑器」行为保留。唯一新增是创建链路显式传入的
  `passiveOverlayClose`，其他调用方不传、行为不变。
- **不改快速打开的焦点语义**：成功打开后仍按 living spec 关闭输入面并把焦点交还编辑器。
- **不改启动行为**：应用启动时的未命名文档 / 恢复的最后一个文档不自动聚焦。
- **不改 caret 落点**：C3 已把 caret 放在正文首行；本 change 只补聚焦，不重算选区。
- 不新增命令、键位、配置项、`EditorHandle` 方法或第二条聚焦通路。
- 不处理「新建子目录」的焦点（它不打开文档，`endInlineEdit(true)` 的既有归还行为不变）。
- 不做「记住上次焦点」之类的通用焦点栈；判定只覆盖创建链路这一次。

## Impact

- 影响的 specs：`file-tree`（2 条 MODIFIED；焦点规则只在「目录下新建」写一次）。
- 影响的代码 / 系统：
  - `src/main.ts`：`submitInlineEdit` 的 `create-file` 分支 + 一个小的判定（必要时抽纯函数，
    便于单测）；`openFile` → `loadSessionContent` → `activateSessionInOwnerPane` →
    `activatePane` / `TabsHandle.activateTab` → 各自的 `syncActiveDocument`，以及 `afterLoad` →
    `syncActiveDocument`，逐层透传可选 `passiveOverlayClose`（默认 `false`）。
  - `src/tabs.ts`：`TabsHandle.activateTab` 增加可选 passive 参数并转发给它的
    `syncActiveDocument` 注入。
  - `src/quick-open.ts`：公开接口 `QuickOpenHandle.close()` 与返回包装改为
    `close(restoreFocus?: boolean)` 并转发；内部默认 `true` 不变。`goto-line` 的接口已支持
    `close(restoreFocus?: boolean)`，无需改签名。
  - 测试：chromium 视觉 / 结构场景（新建后 `document.activeElement`、选区 head、`scrollTop`），
    以及「装载途中焦点被移走」和「装载中打开 quick-open / goto-line」的时序反例（需要给
    `fs_read_snapshot` 加延时桩，照 `tests/visual/scenes/tauri-stub.ts` 的 `urlTitleDelayMs`
    先例）。浮层反例 MUST NOT 只断言最终 `contentDOM` 获焦（所有文档共享同一个 contentDOM，
    对旧实现会假绿），也 MUST NOT 用「旧文档标记消失 / 空文档文本」当装载完成分界（会话激活
    阶段就会清掉旧标记，早于真正的 `reloadSession`）。唯一分界是**目标路径**的
    `lumir:source-ready`（`detail.path === 创建路径`；在装载事务与初始 caret 规范化后发出）：
    分界之前不得有任何 `contentDOM` 获焦，分界之后才允许创建链路的最终聚焦；最终
    `activeElement` 只作补充判据。另保留「只保留 `afterLoad` passive 时测试必红」的反向验证。
    快速打开的既有交还焦点行为另立回归用例。
  - 真机：扩展 `scripts/acceptance/scenarios/47c-create-and-delete.md` 的「新建文件并自动打开」
    步；同步核对 `COVERAGE.md`。
- 关联约束：
  - 不写盘、不改源文件；ADR 0003 铁律无关。
  - 性能合同无关：只在一次创建后多做一次焦点判定与一次 `focus()`。
  - 焦点口径受 M280 约束：必须走 `focusPreservingReadingPosition`，不得裸 `view.focus()`。
- 仓库信息卫生：测试与验收场景只用合成文件名 / 内容。

## 与 ADR 的关系

不需要 ADR：只改一个 capability 的交互收尾，不改分层、不改技术选型、不引入新机制。

## 节点 2（归档放行材料，2026-11-23）

> 状态：**材料已备、五要件齐；merge 与归档待执行**（本 mission 不 merge / 不归档，归档由 tower
> 排期执行）。归档执行后在同一块追加归档提交 hash、包装器输出、修链读数与 `--archived` 审计读数。

1. **节点 1 批准依据**：Alex 2026-11-23「按推荐」批准 F1 / F3，同日「好，按这个规则处理」追认
   F2 修订值（浮层被动关闭、不交还旧编辑器焦点、无其它仍在场目标时焦点落新文档）。批准原文与逐条
   落值见本文件「节点 1 裁决点」表与节点状态块；实现期范围以本文件「What Changes」与
   `specs/file-tree/spec.md` 的 delta 为准，**无静默扩 scope**。
   - 实现期补充（不改行为边界，已记入 design §2.2 / §6）：被动关闭在 `dismiss()` 之后把仍在浮层内
     的焦点显式 `blur()` 回 `body`——浏览器对 `hidden` 元素的焦点修复晚一帧，晚于收尾判定；不补这
     一步则 F2 追认值（浮层关闭后焦点落新文档）在真实时序上不可达。该步只在焦点仍属于被关闭浮层
     时生效，不触碰用户的新焦点。
2. **独立评审**：最终结论 **clean / merge**，绑定 tip `df1658d8`，无 P1 / P2（2026-11-23）。
   verdict
   `/Users/boxcounter/.kimi-code/sessions/wd_lumir_97a6261b51e9/session_fb5487b7-c3d6-4a95-8717-2dde1e8c3acc/agents/main/tasks/agent-9myars66/output.log`。
   前一轮为 needs-changes（判代码本体无阻塞、阻塞在验证制品：composer / dirty 守卫 / 子目录三项
   覆盖不实 + 节点状态过期），绑定 `8d746878`，verdict
   `/Users/boxcounter/.kimi-code/sessions/wd_lumir_97a6261b51e9/session_fb5487b7-c3d6-4a95-8717-2dde1e8c3acc/agents/main/tasks/agent-k7ptmn91/output.log`；
   四项已逐条闭环并落在 `df1658d8`，同一 reviewer 复审 clean / merge。
   - 本节点材料以 **docs-only** 提交落地（只改本 change 的 `proposal.md` / `tasks.md` 与
     `docs/backlog.md`，不动 `src/**` / `tests/**` / `scripts/acceptance/**`），评审覆盖的实现面
     不变；tip 上因此多出的这一个文档提交不构成新的评审对象。
3. **tasks 完成数**：`tasks.md` 共 **54** 项，**51/54** 已勾。未勾 3 项就地写明理由（不删任务项、
   不留空勾）：1.5（`restoreFocus` spy 页面侧不可观测）、3.2（该链路文档恒为空文件）、6.3（队列条目
   已随本节点落，剩「合并时」这一时序动作，随 merge 待执行）。merge / 归档动作本身不在 tasks 的
   实施项里，见本块状态行。
4. **要求的门禁与真机证据**（全部落 `.local/`，git 外；worktree 会被清理，指针均为主仓绝对路径）：
   - `scripts/gate.sh visual`（含 quick 层 13 项 + 视觉两项；动过 `tests/visual/**`，必须本地跑）：
     **`GATE RESULT: 15/15 PASS（SKIP 0）`**，exit 0；`visual-regression` 861s、**1272 passed /
     1 intentional skip**。日志
     `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/focus-created-document-nov23/gate-visual-02.log`。
     quick 层逐项：cargo-fmt / clippy / test、bindings-drift、schemas-drift、tsc-root / visual /
     unit、unit-tests、perf-fixture-tests、acceptance-suite、docs-check、openspec-validate 全 PASS。
   - `pnpm test`：**1857/1857 PASS**（gate 的 unit-tests 项 PASS；本机直跑读数见
     `green-08-all-14.log` 同批会话）。本 change 的判定单测在
     `tests/unit/focus-claim.test.ts`。
   - 浏览器层：`tests/visual/scenes/focus-created-document-nov23.spec.ts` **14/14 PASS**
     （`green-08-all-14.log`）；相关视觉 80 passed（`visual-related-02.log`）。
     先红后绿与五轮反向验证日志同目录：`red-01`（旧实现 5 红 3 绿）、`red-02`（只保留 afterLoad
     passive）、`red-03`（去掉收尾判定）、`red-04`（去掉 `shouldClaimFocus`）、`red-05`（去掉
     `opened` 闸门）、`red-06`（子目录分支注入聚焦）。
   - 真机 `47c-create-and-delete`：**1/1 PASS / 31.0s / 43 条断言**（含 `ax: { focused:
     "AXTextArea" }` 与键入 `focus47c` 读回）。证据目录
     `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-23-focus-created-document/`
     （`47c-create-and-delete/steps.md`、`shots/`、`ax/`）；runner 日志
     `/Users/boxcounter/Code/Boxcounter/lumir/.local/missions/focus-created-document-nov23/acceptance-47c-02.log`。
   - **视觉基线未更新**：`git status tests/visual/baselines` 无改动；焦点是瞬态，本 change 不需要新基线。
5. **规格对账（归档前读数）**：
   - `node scripts/openspec-archive-check.mjs --change focus-created-document-nov23`：**PASS**
     （扫过 1 份 delta，2 条 MODIFIED，对比 23 段，无静默丢段）。
   - `validate --all --strict`：`Totals: 37 passed, 0 failed (37 items)`。
   - 归档跟踪队列：`docs/backlog.md` 有且仅有一条本 change 条目（`grep -c` = 1；队列 77 行 /
     硬上限 80）。按人读规则「tasks 全部勾选（或标注放弃原因）后落一条」已落地；本 change 的
     tasks 未全勾（3 项带理由），`archive-check` 的「已完成 change 必须有唯一条目」分支因此
     不触发——这一条的实际判据是上面的 `grep -c` 读数。

**已知边界（不计入上述 PASS 的覆盖面）**：未验项 1.5 / 3.2 的口径见 `tasks.md` 同名条目；
「装载中焦点被抢 / 装载中打开浮层」的时序反例只在 chromium 层覆盖，真机只验正常路径（分工见
`design.md` §3.2）。
