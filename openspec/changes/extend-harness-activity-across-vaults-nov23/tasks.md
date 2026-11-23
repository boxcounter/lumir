# Tasks: extend-harness-activity-across-vaults-nov23

> 施工前提：**节点 1 已通过**（2026-11-23，Alex 原话「三项推荐。」）。D1–D6 全部按推荐值生效
> （D2 = 三态），可进入实现。实现期若范围 / 行为需求变化，停下更新 proposal 并重走节点 1，不静默扩
> scope。勾选状态在实现期维护；未勾项不删除，放弃的就地写理由。

## 0. 前置与红线

- [x] 0.1 节点 1 通过：2026-11-23 Alex 原话「三项推荐。」= D1–D6 全部按推荐值批准；结论已抄进
      `proposal.md` 的节点状态块
- [x] 0.2 D2 取值已确定：**三态（含 `inflight`）**；「只做未读两档」的退路不再适用，spec / design /
      tasks 不保留在途条款的分叉表述
- [x] 0.3 「切换窗口内到达的终态按不在屏幕上保守记未读」这条边界随提案整体获批（2026-11-23，
      未单列裁决点）；实现按此口径，不另立退路
- [ ] 0.4 开工前过一遍 `REVIEW.md`，逐条对照本 change 的改动面（尤其「同一语义两处真源」「断言等价于子串」「读不到当成空」）
- [ ] 0.5 不新增后端命令 / 事件类型 / 快照字段；若实现中发现必须动 Rust，停下走影响面升级线，不静默扩 scope

## 1. 先红（测试先行，旧实现上必须红）

- [ ] 1.1 新增 `tests/unit/harness-vault-activity.test.ts`：按 vault 隔离、`displayed` 门、`aborted`、两档未读、重复终态幂等、`reset_view`、`drop`、相位与 `reduceSendPhase` 逐条相等、`rollbackSend` 版本门（陈旧 token 不覆盖真实状态）、`finishIfStopping` 只收口 stopping、`subscribe` 触发面；断言**没有通用 `retain`**、未知键不分配
- [ ] 1.2 扩展 `tests/unit/harness-activity-wiring.test.ts`（结构补充）：`handleEvent` 记账在 vault 过滤 / `turnOpen` 闸门之前；`resetView` 原五调用点 + `reloadSessionView` 的「清哪个 vault / 不清」矩阵；`applyStoredLayout` 两条分支发信号；`vaultChanged("", null)` 无残留；无通用 `retain` / 无按注册表 `path` 的周期性清理；无新增定时器 / 每分片零新增工作
- [ ] 1.2a 新增 deferred Promise 的面板 / 装配**行为竞态**测试（建议 `tests/unit/harness-activity-races.test.ts`；不可用源码断言替代）：实际执行 A 动作 → 切 B → resolve/reject，观察 A/B store 与 DOM。至少覆盖：发送拒绝、停止拒绝、新会话回包、恢复回包、cron 发起失败回滚（A cron 发起 → 切 B → reject）、cron 通知打开会话（A cron 恢复 → 切 B → resolve）、token 版本交错、`resetView` 异步清除、显示门时序（布局落定前后）；若现有 factory 未暴露依赖，先加测试注入点或模块级 mock，不改变生产默认值
- [ ] 1.2b 新增 webview 重载 / app 重启区分测试：未读均不回放；重载后当前 vault 的在途由进入快照恢复、非当前 vault 无标记直到后续事件
- [ ] 1.3 扩展 `tests/unit/vault-switcher.test.ts`：非当前行三态、当前行永不建、标记无文本 / `aria-hidden`、`title` 格式、空闲无 title、浮层内就地更新不重拉、显式移除后不残留、无行记录不产生可见标记、筛选 / 游标 / `toHaveText` 不变、旧拼写无标记且不误删当前标题状态
- [ ] 1.4 新增 `tests/visual/scenes/mvp-vault-row-activity.spec.ts`（结构断言，不新增整页基线）：三态形状、点落在切换钮矩形内、不压移除钮、当前行无标记、空闲零新增像素、三主题 / eink 可分、浮层关闭后不可见
- [ ] 1.5 在旧实现上跑一次并留红：至少 1.1 的跨 vault 未读、1.2 的记账次序、1.4 的非当前行三态必须红（结构场景的「空闲零像素」旧实现天然绿，不作红判据）
- [ ] 1.6 真机场景骨架先落（下一步 6.1 的步骤表），旧实现跑出预期红：跨 vault 完成后的 A 行 / 钮不出现未读

## 2. 模型层（`src/harness-activity.ts`）

- [ ] 2.1 把 `activity` 单例扩为按 vault 键控的 store（`Map<string, ActivityState>`）：`of` 未知键返回 `INITIAL_ACTIVITY` 且不分配
- [ ] 2.2 事件面：`turn_started` / `stop_clicked` / `terminal { kind, displayed }` / `displayed` / `reset_view` / `enter_snapshot`；逐条委托 `reduceSendPhase`，不新增相位状态机
- [ ] 2.3 `beginSend` / `rollbackSend`（token 带 before + 版本；版本不符 no-op）、`finishIfStopping`（只在 stopping 收口）、`reset(vault)` 只清目标 vault；`drop(vault)` 只由显式删除 / 重定位调用；**不实现通用 `retain`**
- [ ] 2.4 `subscribe(listener)` 只在相位 / 未读跃迁时通知；分片、工具行、`notice` 不触发
- [ ] 2.5 导出 `displayed` 判据的单一辅助（`vault === current && panePresent`），面板与测试共用，防两处真源
- [ ] 2.6 单测全绿（1.1 转绿）

## 3. 面板接线（`src/harness-panel.ts`）

- [ ] 3.1 `handleEvent`：先解析归属并记账（terminal / `auto_turn_started`），再走既有 `inCurrentVault` 过滤；跨 vault 事件不碰 `turnOpen` / `midTakeover` / DOM
- [ ] 3.2 当前 vault 的终态仍按既有路径收口；`displayed` 取 `currentVault === vault && panePresent`
- [ ] 3.3 `send()`：发送时捕获 `sendVault` 与 `beginSend` token；同步拒绝先 `rollbackSend(sendVault, token)`，再走既有 `viewGeneration` 守卫决定 DOM / 错误行 / 输入区回滚
- [ ] 3.3a 停止路径：点击时捕获 `stopVault` 与 `viewGeneration`；`stop_clicked` 记到 `stopVault`；拒绝时 `finishIfStopping(stopVault)`，错误行只在视图世代未变时落地
- [ ] 3.4 `resetView(options: { clearActivityFor: string | null })`：原五调用点 + 新增 `reloadSessionView` 按 §7 表改准（切 vault = null；新会话 / cron 切屏 / cron 回滚 / 恢复会话 / cron 打开会话 = 调用前捕获的目标 vault，不在 `.then` 里读 `currentVault`）
- [ ] 3.4a `startNewSession` / `resumeSession` 的异步 `.then` / `.catch` 加视图守卫：发起时捕获 `actionVault` 与 `viewGeneration`；记录始终只清 `actionVault`，DOM 复位 / 渲染 / 错误行只在视图仍是发起视图时执行，切走后跳过（切回时由快照重建）
- [ ] 3.4b cron 两条异步路径同样加守卫：`beginCronRun` 捕获 `cronVault` + `cronToken`，失败时 `reloadSession(cronVault, cronToken)`；`handleCronOpenSession` 在 `harness_resume_session` 前捕获 `payload.vault` + `viewGeneration`，resolve 后 `reloadSessionView({ targetVault, viewToken })`。记录只复位目标 vault；DOM 打开 / 复位 / 渲染 / `fetchSnapshot` 只在目标仍当前且世代未变时执行，切走后跳过 B 的全部副作用
- [ ] 3.5 `vaultChanged`：更新 `currentVault` 后置 `panePresent = false`；同一 vault 早退不变；不再清未读
- [ ] 3.6 新增 `paneSettled(present)` API：置门；`present` 为真时对当前 vault 派发 `displayed`；幂等
- [ ] 3.7 `attachTo(mount)`：`mount !== null` → `panePresent = true` + 既有 `opened`；`null` → false
- [ ] 3.8 `applyActivityBadge` / `applySendPhase` 改为读当前 vault 的记录；不新增第二个 badge 写点
- [ ] 3.9 新增 `reloadSessionView({ targetVault, viewToken })`：清目标 vault 记录 + 仅当目标仍当前且 token 未变时 `resetView` + `fetchSnapshot`；`handleCronOpenSession` 用它替换 `vaultChanged("", null)` + `vaultChanged(root)`，MUST NOT 在 API 内部读 `currentVault`
- [ ] 3.10 装配对账测试全绿（1.2 转绿）

## 4. 装配层（`src/main.ts`）

- [ ] 4.1 创建 store 并注入面板 / 切换器；`subscribe` 的退订随 app 生命周期
- [ ] 4.2 `applyStoredLayout` 两条分支末尾（`applySplitChrome` / `syncActiveDocument` 之后）都调 `harnessPanel.paneSettled(present)`；已是目标形态（本次无改动）也照常发
- [ ] 4.3 `applyVault` 的 `vaultChanged` 调用点保持顺序（`vaultChanged` → `onVaultLoaded` → `applyStoredLayout`），不在 `vaultChanged` 前抢读布局
- [ ] 4.4 显式删除 vault 成功 → `store.drop(实际后端打开根)`；重定位成功 → `store.drop(旧的实际后端打开根)`（不迁移）；取不到实际根时宁可不 drop
- [ ] 4.5 不实现通用 `retain`、不按 `vault_list` 的注册表原 `path` 做周期性清理；无行记录 MAY 留到重载，且不产生可见标记
- [ ] 4.6 `handleCronOpenSession` 在 `harness_resume_session` 前捕获 `payload.vault` 与 `viewGeneration`，resolve 后用 `reloadSessionView({ targetVault, viewToken })`；全仓确认无 `vaultChanged("", null)` 残留

## 5. 切换器与样式（D2 已定：三态）

- [ ] 5.1 `src/vault-switcher.ts` deps 增加 `activityOf(path)` 与 `subscribeActivity(listener)`；装配层注入
- [ ] 5.2 `renderRow`：仅 `available && !current` 且有状态时插入 `span.vault-row-activity`（无文本、`aria-hidden`、`data-activity`）；状态词写进 `el.title`；空闲 / 当前行不设 title、不建节点
- [ ] 5.3 浮层打开期间订阅更新：就地更新标记与 title，不重拉列表、不重排、不改游标；关闭时零 DOM 工作
- [ ] 5.4 `src/style.css` 行标记三态：6×6、`var(--r-pill)`、在途空心环 / 回复实心点 / 失败实心点 + 外环；`margin-left: auto`、`pointer-events: none`；复用既有 token，不新增颜色；有态时名称省略号最多提前 12px，若 Alex 不接受该收缩，备选放摘要次行右端（裁点见 design §11.2）
- [ ] 5.5 三主题 / eink：eink 靠形状，在途描边提实；不加动画、不加过渡
- [ ] 5.6 结构断言：标记矩形在切换钮矩形内、与移除钮不相交；`.vault-list` 滚动条档位不变
- [ ] 5.7 行级测试全绿（1.3 转绿）；行只按三态实现（D2 已定，2026-11-23），不保留「两档」分支

## 6. 验收场景（真机矩阵）

- [ ] 6.1 新增真机场景：id / item 按 `scripts/acceptance/scenarios/` 当前最大值 +1 分配（起草时最大数字 id 272、item 708；**不预占 273**），文件名建议 `harness-vault-unread`；步骤覆盖：
  1. A 慢流 → 收起 → 切 B → 打开切换器 → A 行 `help` 含「处理中」
  2. 等终态 → A 行 `help` 含「有新的回复」
  3. 点 A（面板仍收起）→ 标题栏钮 `help` 含「有新的回复」；再次打开切换器，当前行 A 无标记
  4. 打开面板 → 回复在场；收起 → 钮回空闲
  5. A 失败一轮 → 切 B → A 行「有失败结果」；切 A（面板不在场）→ 钮仍失败；打开 → 清
  6. A 一轮主动停止 → 切 B → A 行无任何标记
  7. 时序回归：B 有未读 → 切到「存储布局无 harness pane」的 vault → 未读不得被误清算
  8. 编辑中途不切 vault 的对照：当前 vault 收起态与场景 252 逐字一致
- [ ] 6.2 回扫 `scripts/acceptance/scenarios/253-harness-vault-activity.md`：把第 154–171 行的「完成后往返 ⇒ 不伪造未读」正向断言改为「完成后往返 ⇒ 呈未读、切回并在面板在场时清算」；场景头部注释同步改准
- [ ] 6.3 场景 252 不改（当前 vault 语义不变）；逐条核对 252 / 253 的判据载体仍是 `title` → AX `help`
- [ ] 6.4 `node scripts/acceptance/coverage.mjs` 重新生成 `COVERAGE.md`；`coverage.mjs --check` 通过
- [ ] 6.5 真机跑新场景 + 253 + 252，证据落 `.local/acceptance/<批次>/`（git 外）；FAIL 项逐条定位，不把「偶发超窗」当产品缺陷也不静默重跑
- [ ] 6.6 证据目录用绝对路径 `ls` 一遍再写进报告（REVIEW.md「证据只在终端跑过」条）

## 7. 规格与文档

- [ ] 7.1 `specs/harness/spec.md` 的 MODIFIED 块保持「整条复制 living 再改」；实现期若需再改条款，仍按整块更新，不删段
- [ ] 7.2 `specs/vault-workspace/spec.md` 的 ADDED 块与实现逐条对账：三态、当前行不显示、空闲零像素、title 格式、浮层内更新、旧拼写 fail-closed
- [x] 7.3 `proposal.md` 的节点状态块已在获得节点 1 后更新：2026-11-23 原话「三项推荐。」与 D1–D6
      按推荐值生效；实现期范围变化仍重新走节点 1，不静默扩 scope
- [ ] 7.4 design.md 的行号 / API 名在实现后回改一次（若与最终符号不一致），避免下次误引
- [ ] 7.5 复用 D870–D872 时同步更新 `文案-Copy.md` 的消费点说明（行标记也消费同一状态词，不新增 key），并核对 zh/en 双档文案表
- [ ] 7.6 若实现期发现新的已知边界（如行宽收缩的替代形态），补进 design §15 与 spec 的已知边界，不口头流传

## 8. 门禁

- [ ] 8.1 `PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH" npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过，记录 `Totals:` 原文
- [ ] 8.2 `bash scripts/docs-check.sh` 通过（含 archive-check 门禁模式：MODIFIED 无静默丢段、归档队列、backlog、验收套件契约）；另跑 `node scripts/openspec-archive-check.mjs --change extend-harness-activity-across-vaults-nov23` 并记录 PASS
- [ ] 8.3 `scripts/gate.sh quick` 通过，照抄 `GATE RESULT` 原文行 + 退出码（SKIP 单列）
- [ ] 8.4 `scripts/gate.sh visual` 通过（动过 `src/style.css` / `src/harness-panel.css`，必须本地跑像素层；CI 绿不代表像素层没回归）
- [ ] 8.5 真机场景 PASS；证据指针可 `ls`；若动过标题栏内元素事件监听，另跑场景 39（REVIEW.md「标题栏 mousedown」条）
- [ ] 8.6 视觉基线未更新；如确需 `--update`，先送 Alex 过目（人肉裁决点），不机械执行

## 9. 信息卫生

- [ ] 9.1 所有 fixture / 视觉场景 / 验收场景只用合成 vault 名与路径（如 `/tmp/lumir-*`），MUST NOT 出现真实 vault 名、真实人名、真实文档正文
- [ ] 9.2 提交前对改动面做一次 text 级 grep 清扫（真实路径 / 项目名 / 文档片段），并核对截图类证据只落 `.local/`（git 外）
- [ ] 9.3 若新增原型或 HTML，控制面板可点击、截图同步重截；本 change 无原型则跳过并注明

## 10. 收尾

- [ ] 10.1 `tasks.md` 全部勾选，未勾项就地写放弃理由（不删任务项、不留空勾）
- [ ] 10.2 在 `docs/backlog.md` 的归档跟踪队列落一条本 change 记录（五要件齐待归档 / 命中例外待裁）
- [ ] 10.3 交独立 reviewer；评审判断层不降档；verdict 绑定当前 tip
- [ ] 10.4 归档前逐条核对节点 2 五要件；归档走 `node scripts/openspec-archive.mjs <change-id>`，归档提交后跑 `--archived` 审计至 PASS
