# Tasks: focus-created-document-nov23

> 施工前提：**F1 / F3 已按推荐批准（Alex 2026-11-23）；F2 修订已于 2026-11-23 追认通过
> （Alex 原话「好，按这个规则处理」）。** 0.1 / 0.2 / 0.3 记录批准、落值与追认闸门。未勾项
> 不删除，放弃的就地写理由（见 1.5 / 3.2 / 6.3 / 6.4）。
>
> ## 实现与验证状态（2026-11-23）
>
> 实现已合并并推送至 master（`57c64851`）；归档提交 `a977e5a4`，归档后审计 PASS。
>
> - 实现提交：`8d746878`（mission 分支 `feat/focus-created-document-nov23`）。验证制品返修
>   （harness composer / dirty 守卫 / 新建子目录 / 标签栏矩形 / 节点状态）单独一次
>   docs+test 提交，见分支 tip。
> - 浏览器层：`tests/visual/scenes/focus-created-document-nov23.spec.ts` **14 例全绿**
>   （含三入口、quick-open / goto-line × light / dark、真实 harness composer、树行、
>   dirty 守卫、新建子目录、快速打开回归、树点击反向、失败分支）。
> - 单元层：`tests/unit/focus-claim.test.ts`（判定矩阵）+ 全量 1857/1857。
> - 反向验证（判据不是恒真，日志在 `.local/missions/focus-created-document-nov23/`）：
>   旧实现 5 红 3 绿（`red-01`）；只保留 afterLoad passive → 浮层两例必红（`red-02`）；
>   去掉 `shouldClaimFocus` → harness composer 必红（`red-04`）；去掉 `opened` 闸门 →
>   dirty 守卫必红（`red-05`）；在新建子目录分支注入聚焦 → 子目录必红（`red-06`）；
>   去掉收尾判定 → 树行负例必红（`red-03`）。
> - 门禁（返修后重跑）：`scripts/gate.sh visual` → `GATE RESULT: 15/15 PASS（SKIP 0）`
>   （visual-regression 1272 passed / 1 intentional skip；基线未更新）。
> - 真机（返修后重跑）：`47c-create-and-delete` 1/1 PASS / 31.0s / 43 条断言（`ax: { focused:
>   "AXTextArea" }` + 键入 `focus47c` 读回），证据
>   `.local/acceptance/2026-11-23-focus-created-document/`。
> - 未验项：见 1.5 / 3.2 的就地理由。
> - **节点 2**：五要件材料齐（独立评审 clean / merge 绑定 `df1658d8`；门禁 quick 13/13、
>   visual 15/15 且 1272 passed；真机 47c 43 断言 PASS；archive-check 门禁模式 PASS、
>   `validate --all --strict` 37/37、归档队列唯一条目）。**merge 与归档待执行**，逐条读数见
>   `proposal.md` 文末「节点 2」块。

## 0. 节点 1 与红线

- [x] 0.1 节点 1 **通过**：F1 / F3 按 Alex 2026-11-23「按推荐」批准；F2 修订经 Alex
      2026-11-23「好，按这个规则处理」追认通过（记录见 `proposal.md` 节点状态块）
- [x] 0.2 F1 / F3 批准值与 F2 修订值已落到 `proposal.md` / `design.md` /
      `specs/file-tree/spec.md`；F2 的追认状态与送裁原文均已记录
- [x] 0.3 **F2 追认闸门已通过**：Alex 原话「好，按这个规则处理」（2026-11-23）已抄进
      `proposal.md` 节点状态与 F2 裁决行；实现项仍未勾
- [x] 0.4 开工前过一遍 `REVIEW.md`，重点对照「断言等价于子串」「读不到当成空」「同一语义两处
      真源」
- [x] 0.5 **不改默认行为**：树点击、快速打开、wikilink 跟随、会话恢复不因本 change 改变焦点
      语义；唯一新增是创建分支显式传入的 `passiveOverlayClose`（默认 `false`）。发现必须改默认
      值时停下走影响面升级线
- [x] 0.6 **不改快速打开的焦点交还**：成功打开后仍关闭输入面并把焦点交还编辑器（living spec
      的既有条款）；只补公开 `close(restoreFocus?: boolean)` 签名与转发，默认 `true` 不变
- [x] 0.7 **只用 `focusPreservingReadingPosition`**：MUST NOT 裸 `view.focus()`；不新增第二条
      聚焦通路 / `EditorHandle` 方法

## 1. 先红（旧实现上必须红）

- [x] 1.1 新增 chromium 结构场景（`tests/visual/scenes/`，沿用现有 create-file 场景的桩与
      harness）：
      - 目录下新建 → 断言 `document.activeElement === view.contentDOM`；旧实现焦点在 `body`，必红
      - `view.state.selection.main.head === firstBodyLineStart(view.state.doc)`；`scrollTop === 0`
- [x] 1.2 新增「装载中焦点被移到仍在场的目标」负例：给 `fs_read_snapshot` 加延时桩（新增
      `snapshotDelayMs`，照 `urlTitleDelayMs` 先例），装载途中把焦点移到仍在场的目标，
      断言焦点不被拽回、编辑器选区 / `scrollTop` 未变。**覆盖两档**：① 真实 harness pane 的
      composer（⌘⇧A 分栏、点进 composer 并键入，断言激活链零抢焦、输入不被清掉）；② 文件树
      另一行（目录行）
- [x] 1.3 新增「装载中打开 quick-open」负例：延时桩生效后发 `⌘P`；从提交起同时监听
      `focusin` 与 `lumir:source-ready`（记录 `detail.path`）。**唯一分界 = 目标路径的
      `lumir:source-ready`**（`detail.path === 创建路径`；该事件在 `reloadSession` 的装载
      事务与 `normalizeInitialCaret()` 之后发出，见 `src/editor.ts:3274`）。断言：分界之前
      **没有任何 `contentDOM` 获焦**；分界之后才允许出现创建链路的最终聚焦。`focusin` 记录
      时间 / 目标 / 当时前台 path 供失败诊断；最终 `activeElement === contentDOM` 只作补充
      判据。MUST NOT 用「旧文档标记消失 / 空文档文本」当分界
- [x] 1.4 新增「装载中打开 goto-line」负例：延时桩生效后发 `⌥G`；同一分界（目标路径的
      `lumir:source-ready`）与「分界前无 contentDOM 获焦」判据；最终 `activeElement` 只作补充
- [ ] 1.5 若测试装配允许，给 quick-open / goto-line 的 `restoreFocus` 加 spy，断言创建链路的
      被动关闭**没有调用**它；spy 只作补充，不替代 1.3 / 1.4 的事件序列
      ——**未做，就地登记理由**：`restoreFocus` 是装配层注入的回调（`editor.focusPreservingRead
      ingPosition`），页面侧不可观测；加 spy 要么在产品侧开测试钩子（与「不新增第二条聚焦通路」
      的窄口径冲突），要么改注入面。1.3 / 1.4 的事件序列判据已直接判定同一可观察结果（分界前
      零 `contentDOM` 获焦），且旧实现与「只保留 afterLoad passive」两轮反向验证都如实变红
      （证据见 `.local/missions/focus-created-document-nov23/red-0*.log`）。
- [x] 1.6 新增快速打开回归用例：打开 quick-open 并选中一个既有文件 → 浮层关闭后
      `document.activeElement === contentDOM`；旧实现与新实现都必须绿（钉住 passive close
      MUST NOT 波及默认路径）
- [x] 1.7 新增反向用例：文件树点击打开既有文件后 `document.activeElement` 不是 `contentDOM`；
      本用例 MUST NOT 断言快速打开「不聚焦」
- [x] 1.8 负例的区分度先验：**只保留 `afterLoad` 那处 passive、临时去掉激活阶段的透传**，
      确认 1.3 / 1.4 必红——激活阶段的默认 `close` 会在目标路径 `source-ready` 之前把焦点
      交给 `contentDOM`，事件序列判据必须抓住这一拍；再临时去掉 2.1 的判定条件，确认 1.2
      变红。两条反向验证都通过，才能证明判据不是在最终 `contentDOM` / DOM 文本上假绿

## 2. 实现（`src/main.ts` 为主，覆盖完整激活链）

- [x] 2.1 `submitInlineEdit` 的 `create-file` 分支：`await fsCreateFile` 之前捕获
      `const claim = document.activeElement`
- [x] 2.2 改为 `const opened = await openFile(created, openKind(created), "new", false,
      undefined, { passiveOverlayClose: true })`
- [x] 2.3 `openFile` / `loadSessionContent` 增加可选的 `passiveOverlayClose?: boolean`
      （默认 `false`）并向下透传；其他调用方不传
- [x] 2.4 `loadSessionContent` 把选项传给 `activateSessionInOwnerPane(session, options)` 与
      `afterLoad(options)`
- [x] 2.5 `activateSessionInOwnerPane(session, options?)` 把选项传给 `activatePane(paneId,
      options)` 与 `tabs.activateTab(session, options)`
- [x] 2.6 `activatePane(paneId, options?)` 把选项传给它的 `syncActiveDocument(options)`
- [x] 2.7 `TabsHandle.activateTab(session, options?)` 增加可选参数，并把选项转发给它的
      `syncActiveDocument` 注入；`src/main.ts` 里该注入改为接收并转发选项（默认 `false`）。
      `tabs.activateTab` 内部还会调 `TabsDeps.activatePane()`；本链路里
      `activateSessionInOwnerPane` 已先翻好 pane，该调用是 no-op。若实现发现它可能先执行并
      触发默认 sync，须把 options 一并透传（默认 `false`）
- [x] 2.8 `syncActiveDocument({ passiveOverlayClose = false } = {})`：
      `gotoLine.close(!passiveOverlayClose)`、`quickOpen.close(!passiveOverlayClose)`；
      默认分支逐字不变
- [x] 2.9 `src/quick-open.ts`：公开接口 `QuickOpenHandle.close` 与返回包装改为
      `close(restoreFocus?: boolean): void` 并转发；内部 `close(restoreFocus = true)` 不变
- [x] 2.10 判定抽成纯函数（`shouldClaimFocus(active, claim)`：`body` / `null` / `claim` 为真），
      便于单测；放在 `src/main.ts` 或就近纯逻辑模块
- [x] 2.11 `opened === true` 且判定为真时调用 `editor.focusPreservingReadingPosition()`；否则
      什么都不做
- [x] 2.12 注释写明「新文档阅读位置在原点，本调用退化为只聚焦」、M280 口径、以及 passive close
      只为创建链路生效、必须覆盖激活阶段与装载收尾两段同步点
- [x] 2.13 确认目录行 / 根级 / 空 vault 三入口都走同一条链路（`rg "beginCreate|create-file"`），
      不为任一入口另写聚焦
- [x] 2.14 纯函数单测：`body` / `null` / `claim` 同节点 / 焦点在别处 / `claim` 已从 DOM 移除

## 3. 焦点与几何矩阵（chromium）

- [x] 3.1 入口矩阵：目录行 / 根级 / 空 vault「新建笔记」三入口各一例，焦点与 caret 断言一致
- [ ] 3.2 文档形态矩阵：空文件、有 frontmatter 的文件、只有 frontmatter 的短文件——head 分别
      为 0 / 第一条正文行行首 / 文档起点后的合法落点；`scrollTop = 0`
      ——**只覆盖空文件（head = 0 / scrollTop = 0），就地登记理由**：本链路的文档恒为「新建的
      空文件」（spec「新建文件 SHALL 为空文件」），frontmatter 形态在这条路径上不可能出现；
      C3 对 frontmatter 的落点口径由既有的 cursor-visibility 场景覆盖，本 change 不改 caret。
- [x] 3.3 键入落点：新建后直接键入标记串，断言编辑器正文出现该串、文件树与 `body` 不接收
- [x] 3.4 失败分支：`openFile` 返回 `false` 时不聚焦、旧文档焦点不变。**覆盖两条真实路径**：
      ① 未命名 dirty 守卫（启动的未命名文档里键入草稿 → 根级菜单新建 → `save.guard` 拦下：
      文件照常建、不建标签、草稿留在前台、`.toast-dirty-guard` 上屏、提交后无编辑器获焦）；
      ② 装载读盘报错（该路径的 `fs_read_snapshot` 抛 `fs_not_found`：不建标签、失败提示上屏、
      旧文档仍是前台）
- [x] 3.5 反向矩阵：文件树点击既有文件、新建子目录两种情形焦点逐值不变；快速打开单独按 1.6
      的回归判据断言「交还编辑器」，MUST NOT 混进「不聚焦」矩阵。新建子目录用例同时断言
      标签数 / 前台标签 / 标签栏矩形 / 编辑器矩形逐值不变
- [x] 3.6 几何：聚焦前后标签栏、编辑器矩形与 `scrollTop` 不变（聚焦不得把视口滚走）。
      **两处断言**：新建文件（聚焦发生）与新建子目录（不聚焦）各比一次编辑器 + 标签栏矩形
- [x] 3.7 浮层级联：装载中打开 quick-open / goto-line 的两例（1.3 / 1.4）在 light / dark 各跑
      一次；每次都核对焦点事件序列（激活阶段无 `contentDOM` 获焦），最终 `activeElement`
      只作补充
- [x] 3.8 回归默认路径：不传 `passiveOverlayClose` 的打开（树点击 / 快速打开）仍按原语义
      关闭浮层并恢复焦点；用 1.6 的回归用例钉住

## 4. 真机与既有场景回扫

- [x] 4.1 扩展 `scripts/acceptance/scenarios/47c-create-and-delete.md`「新建文件并自动打开」步：
      加 `ax: { focused: "AXTextArea" }`；随后键入标记串并断言 `editor: { has: ... }`
- [x] 4.2 `rg "新建文件|新建笔记|beginCreate" scripts/acceptance/scenarios/` 回扫全部既有期望，
      逐条确认没有「焦点留在文件树 / body」的相反断言；有则按本 change 改准
- [x] 4.3 `rg "快速打开|quick-open" scripts/acceptance/scenarios/` 回扫既有焦点期望，确认
      「快速打开后交还编辑器」没有被本 change 改坏
- [x] 4.4 真机重跑 47c（删除 / 新建 / 撞名链路一起），证据落 `.local/acceptance/<批次>/`；用
      绝对路径 `ls` 确认后再写进报告
- [x] 4.5 真机不造「装载中焦点被抢」与「装载中打开浮层」时序（造不出稳定现场，已在 design
      写明分工）；这两族只由 chromium 的事件序列判据覆盖

## 5. 像素与门禁

- [x] 5.1 本地跑 `scripts/gate.sh visual`；焦点变化不应改像素（光标是瞬态），出现差异先定位
- [x] 5.2 如需新截图，只出候选落 `.local/reviews/ux-improvements/`（git 外）；`--update` 属
      Alex 人肉裁决点
- [x] 5.3 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过，记录 `Totals:` 原文
- [x] 5.4 `bash scripts/docs-check.sh` 通过（含 archive-check 门禁模式、验收场景契约与覆盖表）
- [x] 5.5 `scripts/gate.sh quick` 通过；照抄 `GATE RESULT` 原文行 + 退出码（SKIP 单列）
- [x] 5.6 `scripts/gate.sh visual` 通过（动过 `tests/visual/scenes/**`，必须本地跑）

## 6. 收尾

- [x] 6.1 `tasks.md` 全部勾选，未勾项就地写放弃理由
- [x] 6.2 实现后回改 `design.md` 的行号 / 符号名（若与最终代码不一致）
- [x] 6.3 实现 PR 合并时在 `docs/backlog.md` 的归档跟踪队列落一条本 change 记录（队列 76 行、
      硬上限 80；先核可删的僵尸条目，不为压行数删活条目）
      ——队列条目已随节点 2 材料落，并在本次归档提交中移除。
- [x] 6.4 交独立 reviewer；verdict 绑定当前 tip；归档前逐条核对节点 2 五要件
      ——本轮两轮评审：r1 判 needs-changes（代码本体无阻塞，阻塞在验证制品）绑定 `8d746878`，
      verdict `/Users/boxcounter/.kimi-code/sessions/wd_lumir_97a6261b51e9/session_fb5487b7-c3d6-4a95-8717-2dde1e8c3acc/agents/main/tasks/agent-k7ptmn91/output.log`；
      四项返修后复审 **clean / merge** 绑定 `df1658d8`，verdict
      `/Users/boxcounter/.kimi-code/sessions/wd_lumir_97a6261b51e9/session_fb5487b7-c3d6-4a95-8717-2dde1e8c3acc/agents/main/tasks/agent-9myars66/output.log`。
      五要件逐条读数见 `proposal.md` 文末「节点 2」块；merge、归档与归档后审计均已完成。

## 7. 信息卫生

- [x] 7.1 视觉桩与真机场景只用合成 vault 名 / 文件名 / 正文
- [x] 7.2 提交前对改动面做一次 text 级 grep 清扫；截图类证据只落 `.local/`（git 外）
