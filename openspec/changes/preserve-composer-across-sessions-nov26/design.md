# Design: 新建 / 切换会话保留 composer

- Change ID: `preserve-composer-across-sessions-nov26`
- 基线: `master` `a9152deca`
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

## 1. 入口盘点：谁在动 composer

| 入口 | 代码（基线） | 现状 | 本 change |
|---|---|---|---|
| 新建会话 | `startNewSession()`，`src/harness-panel.ts:10790` 起 | 成功回包 `resetView` 后 `resetComposer()` + `draft.clear()` | 删掉两条清空，改为「保留 + 作废在途草稿恢复」 |
| 重载目标会话 | `reloadTargetSession()`，同文件 `10905` 起 | 同样 `resetComposer()` + `draft.clear()` | 同上 |
| 选择 / 恢复历史会话 | `resumeSession()`，同文件 `11138` 起 | 只 `resetView` + 重放快照，不动 composer | 补「作废在途草稿恢复」，其余不动 |
| 切 vault | `vaultChanged()`，同文件 `10505` 起 | `resetView` + `resetComposer()` + `restoreDraft()`（按 vault 读回） | **不改**（per-vault 草稿恢复是批准合同的另一半） |
| 发送成功 | `performSend()` / `clearSent` | 清空 composer + 按发送时定格的 (vault, version) 清草稿 | **不改** |
| cron 点击发起运行 | `beginCronRun()` | `resetView` + prompt 上屏，不动 composer | 不改（不在批准范围） |

`resetView()` 只负责 transcript / 会话视图（transcript、会话名、活动记录、档位读数、快照世代、
`composerIme.reset` 的发送意图），输入区不在它的职责内——两条入口在它之后再清一次输入区，
是这次缺陷的形态。

## 2. 为什么是「删两条清空」，而不是「清完再恢复」

- **撤销历史只能靠不换 state 保住**：`resetComposer()` 走 `setState(createComposerState(...))`，
  新 `EditorState` 即新 history；把内容重新填回去也救不回撤销栈。批准合同明确要求撤销历史保留，
  所以唯一做法是不重建 state。
- **草稿只能靠不删文件保住**：`draft.clear()` 会 `putDraft("", vaultId)` 删除盘上草稿；要满足
  「只有发送成功或用户手动删除才清除」，不能在会话切换时调用它。
- 其他候选都已否决：
  - 清空后立即 `markDraft()` 重写一份相同内容：会与在途写 / 清删除竞态，且 history 仍丢；
  - 仅在 composer 为空时清（「反正没内容」）：对唯一有内容的情形恰好失效，且仍会清掉草稿；
  - 把清空移进 `resetView` 供所有入口共用：会让「选择会话 / 切 vault」也按错误方向统一，
    与合同相反。

## 3. 在途草稿恢复的作废（唯一新增的防线）

`vaultChanged()` → `resetView()` → `resetComposer()`（空）→ `void restoreDraft()`：读盘是一次
IPC 往返，回包落地时若输入区仍是原始空态就 `resetComposer(loaded)`。既有两道守卫是
`draftSeq`（读盘世代）与 `composerIsPristine()`（用户已动手则不覆盖）。

新增合同要求「会话切换只换消息列表」之后，出现一个新的交错：会话切换发生在草稿读回在途时，
迟到的读回会把**不属于这次会话切换**的内容铺进输入区，并重建编辑史（`resetComposer`）。防线：

- 新增一个小函数 `holdComposerAcrossSessionSwitch()`：只做 `draftSeq += 1`（作废在途恢复），
  不改 composer、不碰草稿 store；
- 调用点：`startNewSession` 成功分支、`reloadTargetSession`、`resumeSession` 成功分支
  （替换前两条里的 `resetComposer()` + `draft.clear()`）；
- **不放进 `resetView`**：`vaultChanged` 也走 `resetView`，而它随后就要调用 `restoreDraft()`
  ——把作废点放进 `resetView` 会让语义依赖调用顺序（先 `resetView` 再 `restoreDraft` 恰好
  还能工作），日后新增调用点就会踩空。放在三个会话切换入口，读代码即知「谁保留输入区」。

`restoreDraft()` 只在读到内容且 `seq === draftSeq`、`composerIsPristine()` 时 `resetComposer`。
会话切换推进 `draftSeq` 后，迟到的读回整体 no-op；随后切 vault 的 `restoreDraft()` 会拿到
新的 `seq`，不受影响。

## 4. 判据设计（先红后绿）

浏览器层（`tests/visual/scenes/harness-composer-session-preserve-nov26.spec.ts`，真面板 +
真 CodeMirror + 桩后端）按合同逐字段判：

1. **新建保留（纯文本 + caret）**：输入两段文字（中间隔开 CM 聚簇窗口）、把 caret 放到中部、
   点「＋新会话」→ transcript 清空、会话名回「新会话」；`doc` 与 `head` 逐字段相同。
2. **新建保留（卡片 / Skill / 撤销历史）**：插引用卡 + 贴图片 + `/` 接受一个 Skill 引用 →
   点「＋新会话」→ 卡片计数与摘录、Skill chip、composer 文本不变；按 `Meta+z` 撤销回到上一段
   输入（旧实现里 history 已换，撤销为空操作或清空——必红）。
3. **草稿未被清除**：输入后等防抖落盘，记 `harness_draft_put` 的载荷序列；点「＋新会话」后
   再等一拍，断言没有 `""` 载荷、桩里的草稿文件仍含原文（旧实现 `draft.clear()` 会写 `""`，
   必红）。
4. **会话重载保留**：输入内容后经 `cron:open_session` 事件触发
   `harness_resume_session(switched=true)` → `reloadSessionView` → `reloadTargetSession`；
   transcript 按快照重建，composer 逐字段不变（旧实现清空，必红）。
5. **失败回包不清**：`harness_new_session` 回包 reject → 只多一条错误行，composer 与草稿不变
   （旧实现也满足——这是防「修成提前清空」的守卫，不是红用例，测试里注明）。
6. **连续切换不被在途草稿恢复覆盖（三条）**：让 `harness_draft_get` 挂起，点「＋新会话」、再
   触发一次会话重载，然后放行读回。
   - 空态：composer 仍为空（旧实现：新会话先清空、读回再把盘上草稿铺进来，必红）；
   - history：先键入再撤销回 pristine 空态（redo 栈有内容），切换后放行读回，再 redo 必须回到
     切换前的输入——`resetComposer` 重建 state 会丢掉 redo 栈（必红）；
   - 已键入内容：内容与 `head` 逐字段不变，随后 ⌘Z 能回退这次键入（证明 history 没被重建）。
   同一条 stub 配一个**正向对照**（不切换、直接放行 ⇒ 草稿确实铺进输入区），证明链路是活的。
7. **切 vault 仍按 vault 恢复**：A 有草稿、B 无草稿；A → B 时输入区为空、B → A 时恢复 A 的
   草稿（防「为了保留会话，把切 vault 的恢复一起关掉」）。
8. **发送确实进入当前选中会话**：桩记录 `new` / `resume` 切换后的会话身份与世代，`harness_send`
   记录发送时的身份 / 世代。新建后与选择历史会话后各发送一次：身份与世代必须等于切换后的值
   （中间没有再次 new / resume），投递载荷含保留的文字 / 引用卡 excerpt / Skill 引用，transcript
   出现用户消息、composer 清空（旧实现在新建后已清空输入区，发送根本不会发生——必红）。

既有用例回扫（tasks 5.3）：`m831-harness-composer-codemirror.spec.ts` 两条旧行为断言改准；
其余点 `.lumir-hp-seg-new` 的场景在那一刻输入区为空，只把新会话当视图换代信号，逐条复跑确认。

真机层：新增场景 `878-composer-preserve-across-sessions.md`（新建 + 选择历史会话两条路径、
`unchangedSince` / AX 文本断言、草稿重启复验），本轮不执行。

## 5. 影响与未覆盖面

- 会话切换后 `firstUserText` / 会话名仍按 `resetView` 清空；下一次发送会按当前视图重新命名。
- 保留的草稿在「新会话后直接退出」时会于下次启动恢复——批准合同的直接结果。
- 未覆盖：真机 WKWebView 下的组合输入与撤销手感（归场景 878 与 Alex 手感裁决）；跨进程撤销
  历史（明确不做）。
