# Tasks: add-harness-activity-presence

> `openspec/specs/**` 活跃期只读；所有规格变更只写本 change 的 delta。
> 实现期发现 proposal 意图需要变更时，停下更新 proposal 并重新走节点 1，不静默扩 scope。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/harness/spec.md` / 本文件
- [x] 0.2 只读调查：面板收起（`attachTo(null)`）后的状态存活、`sendPhase` 的唯一写入口、快照
      `StateSnapshot` 缺在途读数、`resetView` 强刷 idle、事件按 vault 过滤、cron 两槽位差异
      （事实表见 `design.md` §1，逐条 file:line）
- [x] 0.3 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 实跑通过：`✓ change/add-harness-activity-presence`，
      `Totals: 34 passed, 0 failed (34 items)`，退出码 0；`scripts/docs-check.sh` PASS；归档对账门禁 PASS
      （r1 修订后复跑，读数相同）
- [ ] 0.4 Alex 节点 1 评审：D1 提示形态 / D2 失败未读归类 / D3 跨 vault 未读是否要做；裁决结果回填
      proposal 的「评审记录」块

## 1. 后端：快照暴露在途读数（唯一真源）

- [ ] 1.1 `src-tauri/src/harness/session.rs`：`StateSnapshot` 增 `busy` 字段，`Session::snapshot()` 从
      会话自身取 `is_busy()`；`StateSnapshot::empty` 同形给 `false`（键恒在场，缺键语义留给旧快照）
- [ ] 1.2 Rust 用例：`acquire_turn` 后 `snapshot().busy == true`、`release_turn` 后为 `false`；
      空态快照 `busy == false`（判据落在序列化后的线上形状）
- [ ] 1.3 `src-tauri/src/harness.rs`：确认 `harness_state` 走同一份 `Runtime::snapshot`，不新增第二条读值路径

## 2. 前端：相位以后端为真源（且只在进入点回填）

- [ ] 2.1 快照按用途分档：**进入快照**（面板挂载 / `vaultChanged` / `reloadSession`）才允许改相位与
      `turnOpen`；**对账快照**（§4.2）只重建内容。`restoreSnapshot` 必须显式带档位参数，
      MUST NOT 出现「某条路径走了完整恢复却只想重建内容」的形态
- [ ] 2.2 世代守卫：`phaseEpoch` 随事件推进自增，快照请求记 epoch，响应 epoch 不一致时丢弃相位部分
      （消息 / usage 等照旧应用）
- [ ] 2.3 `afterTerminal` 守门（r1 P2-1）：终态置真、`sent` / `auto_turn_started` / `vault_changed` 置假；
      进入快照的 `busy:true` 仅在它为假时应用，为真时整条丢弃——覆盖「done / error / aborted 之后读到
      `busy:true` 不得复活 running」这条时序
- [ ] 2.4 轮次闸门随相位恢复：仅当进入快照把相位拉到 running 时 `turnOpen` 置真（切回后的增量不再被
      `GATED_EVENT_TYPES` 丢弃）；终态置假之后 MUST NOT 被任何快照或对账路径重开
- [ ] 2.5 `harness_busy` 拒绝走 `busy_rejected`：无条件把相位拉回 running 并清 `afterTerminal`，
      不留下「看似可发送」的持续假空闲（也是 2.3 守门挡下新轮时的出口）
- [ ] 2.6 删除 / 改写 `resetView` 里「相位归 idle」那条口径的注释，写明「复位后由进入快照回填」的次序，
      并注明「对账快照不回填相位」（注释不得继续描述旧行为）

## 3. 未读状态机与呈现

- [ ] 3.1 纯函数状态机（`design.md` §3 的转移表）：入参含 `mounted`，出参 `{ phase, unread, afterTerminal }`；
      相位逐条委托既有 `reduceSendPhase`（`sent` / `stop_clicked` / `finished` 三个事件），
      **必须包含 `stop_clicked` 输入**（r1 P2-2：否则 stopping 会有两个持有者）；无 DOM、可零 DOM 单测
- [ ] 3.2 接线：`done` / `error` / `aborted` 三个终态把 `mountEl !== null` 传进状态机；停止按钮点击
      经状态机的 `stop_clicked` 输入（不绕过状态机直接调 `applySendPhase`）；`attachTo(null)`
      MUST NOT 清相位、MUST NOT 清未读（收起 ≠ 复位）；`attachTo(mount)` 清未读
- [ ] 3.3 `vaultChanged` 清未读并清 `afterTerminal`（作用域口径）；无人值守 cron 与 `notice` 不进入状态机
- [ ] 3.4 toggle 钮三态：状态点子元素常驻 DOM，经单一函数施加 `data-activity`；空闲态 `display:none`
      保证零像素漂移
- [ ] 3.5 可访问性：三态经 `aria-describedby` 指向视觉隐藏的状态文本；终态经 `aria-live="polite"` 播报一次
- [ ] 3.6 文案：`src/copy-data.ts` 增状态文案 zh/en 双档（处理中 / 有新的回复 / 有失败结果），
      随 `onRelabel` 重绘；不新增中文字面量（`tests/unit/copy.test.ts` 迁移门禁）
- [ ] 3.7 样式：`src/harness-panel.css` 状态点（6×6、锚在钮内右下、三态形状、三主题、无动画）；
      所有取值走 token 层

## 4. 在途轮次的重连续与终态对账

- [ ] 4.1 「中途接管」标志：由**进入快照**把相位拉到 running 时置位，`sent` / 终态后清除
- [ ] 4.2 终态到达且标志置位时按后端快照重建渲染面一次（手法同 `cronRunAdopted` 的 `reloadSession`），
      且 MUST 走「只内容」档位：MUST NOT 读该快照的 `busy`、MUST NOT 改相位、MUST NOT 重开 `turnOpen`
      （r1 P2-1：终态后读到的 `busy:true` 是合法时序）；重建 MUST NOT 违反「强制回底白名单」
      （终态不在白名单里，视口不因对账被拽回底部）
- [ ] 4.3 `done` / `error` / `aborted` 三类终态一致处理（重建幂等；无新消息时是空动作）

## 5. 测试与验收场景（随实现同批）

- [ ] 5.1 `tests/unit/harness-activity-presence.test.ts`：状态机全表（每条转移一条断言）、
      `opened` 清未读、`aborted` 不置未读、`vault_changed` 清未读与 `afterTerminal`、epoch 不一致丢弃
      快照相位
- [ ] 5.2 `tests/unit/harness-activity-wiring.test.ts`：源码级结构对账（进入快照路径调相位 / 闸门恢复、
      **对账路径只走内容档位且不读 `busy`**、三类终态传 `mounted`、停止点击经状态机、`attachTo(null)`
      不复位、三态由唯一函数施加）——同一层、同一理由见 `tests/unit/harness-cron-click-run.test.ts`
- [ ] 5.2a **r1 P2-1 确定性回归**：`terminal(done|error|aborted, mounted=false)` → `enter_snapshot(busy:true,
      epoch 一致)` ⇒ 相位仍为 idle、`afterTerminal` 为真、未读按终态种类；反例守卫：`vault_changed` 后
      同一快照 ⇒ running、`terminal → sent → enter_snapshot(busy:true)` ⇒ running；出口守卫：
      `terminal → busy_rejected` ⇒ running。每条断言都写明「实现改成无条件回填 / 永不回填时它必红」
- [ ] 5.2b **r1 P2-2 确定性回归**：`idle + stop_clicked ⇒ idle`、`running + stop_clicked ⇒ stopping`、
      `stopping + stop_clicked ⇒ stopping`（幂等）、`stopping + terminal ⇒ idle`、
      `stopping + enter_snapshot(busy:true|false) ⇒ stopping`；并逐条断言相位输出与 `reduceSendPhase`
      的同事件输出相等（委托而非重写）
- [ ] 5.3 先红证据：在 master 上跑 252 / 253 留红（当前无状态文本、切回呈空闲），证据落
      `.local/acceptance/<日期>/`，再在实现分支跑绿
- [ ] 5.4 新增 `scripts/acceptance/scenarios/252-harness-activity-presence.md`：收起期间完成 → 在途 →
      未读 → 打开面板后状态文本消失、回答在场；失败轮次点亮失败档；停止不点亮
- [ ] 5.5 新增 `scripts/acceptance/scenarios/253-harness-vault-activity.md`：跨 vault 往返仍在途 → 切回后
      发送钮为停止态 + 状态文本为处理中 + 后续增量上屏 + 终态后完整回答（对账生效）；完成后往返
      （切走 → 该轮结束 → 切回）：指示空闲、快照完整铺开；重复切换 A→B→A→B→A 不丢在途态、终态只收口一次
- [ ] 5.6 `node scripts/acceptance/coverage.mjs` 重生成 `COVERAGE.md`；`node scripts/acceptance/run.mjs --check` 绿
- [ ] 5.7 `tests/visual/scenes/m756-harness-activity-presence.spec.ts`：三态结构断言 + 状态点锚在钮矩形内
      + 空闲态无新增节点上屏；**不新增整页像素基线**（基线新增是 Alex 人肉裁决点）
- [ ] 5.8 回扫既有整页基线：`rg -l 'hp-toggle' tests/visual/scenes` 命中的场景逐个跑过，确认零像素漂移
      （未漂移则基线时间戳不动，也不该动）

## 6. 门禁与证据

- [ ] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` PASS（提案期读数：见完工报告）
- [ ] 6.2 `node tests/unit/run.mjs` + 三份 `tsc --noEmit`（根 / 单测 / 视觉）全绿
- [ ] 6.3 `scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行与退出码）
- [ ] 6.4 `scripts/gate.sh visual` 全绿（动过 `src/harness-panel.css`，**必须本地跑**；CI 绿不代表像素层没回归）
- [ ] 6.5 真机跑 252 / 253，证据落 `.local/acceptance/<日期>/`
- [ ] 6.6 `bash scripts/docs-check.sh` PASS

## 7. 收尾

- [ ] 7.1 实现 PR 合并时在 `docs/backlog.md` 的归档跟踪队列落一条记录（五要件状态如实写）
- [ ] 7.2 节点 2：独立 reviewer clean/merge + 五要件齐后由 tower 归档；命中例外类别才送 Alex
