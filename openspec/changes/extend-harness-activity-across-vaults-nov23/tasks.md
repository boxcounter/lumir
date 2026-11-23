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
- [x] 0.4 开工前过一遍 `REVIEW.md`，逐条对照本 change 的改动面（尤其「同一语义两处真源」「断言等价于子串」「读不到当成空」）
- [x] 0.5 不新增后端命令 / 事件类型 / 快照字段；若实现中发现必须动 Rust，停下走影响面升级线，不静默扩 scope

## 1. 先红（测试先行，旧实现上必须红）

- [x] 1.1 新增 `tests/unit/harness-vault-activity.test.ts`：按 vault 隔离、`displayed` 门、`aborted`、两档未读、重复终态幂等、`reset_view`、`drop`、相位与 `reduceSendPhase` 逐条相等、`rollbackSend` 版本门（陈旧 token 不覆盖真实状态）、`finishIfStopping` 只收口 stopping、`subscribe` 触发面；断言**没有通用 `retain`**、未知键不分配
- [x] 1.2 扩展 `tests/unit/harness-activity-wiring.test.ts`（结构补充）：`handleEvent` 记账在 vault 过滤 / `turnOpen` 闸门之前；`resetView` 原五调用点 + `reloadSessionView` 的「清哪个 vault / 不清」矩阵；`applyStoredLayout` 两条分支发信号；`vaultChanged("", null)` 无残留；无通用 `retain` / 无按注册表 `path` 的周期性清理；无新增定时器 / 每分片零新增工作
- [x] 1.2a 新增 deferred Promise 的面板 / 装配**行为竞态**测试：实际执行 A 动作 → 切 B → resolve/reject，观察 A/B 两侧的记录与 DOM。
  - 落点（实现期决定，不改变合同）：**装配层**竞态落 `tests/visual/scenes/harness-vault-activity.spec.ts`（真 DOM + 真装配——`applyVault` / cron 桥只能在浏览器里跑），deferred 经 `src/ipc.ts` 的 `invoke` 桩注入（模块级 mock，生产默认值不变）。覆盖：发送拒绝、停止拒绝、新会话回包、token 版本交错、显示门时序（布局落定前后）、目标布局有 pane 的在场清算、cron 发起失败回滚、cron 通知打开会话。
  - **未**新建 `tests/unit/harness-activity-races.test.ts`：`createHarnessPanel` 需要一份 ~400 行 DOM 替身（本仓已有三份刻意副本），而它覆盖不到的正是装配层；第四份只重复断言同一行为。面板侧行为由 `harness-restore-block-defaults.test.ts`（真面板）与 `harness-vault-activity.test.ts`（store 返回值）覆盖。
  - 恢复回包跨 vault：**独立**场景（会话浮层选历史会话 → `harness_resume_session` deferred → 切 B → resolve），不复用 cron 通知用例（r1 评审判定两者不是同一份实现：`resumeSession` 在面板内、cron 通知在装配层）。
  - 重试拒绝跨 vault：独立场景两条（A 不残留假在途 / 期间已有真实终态时版本门阻止回滚），按点击时 vault + `beginSend` 令牌收口。
  - cron 两条失败路径：除快照计数外，还断言 **toast 集合不新增**（A 的失败提示不写进 B）与 **toggle 属性零写入**（目标非当前时不渲染 B 的 DOM）；另有一条「未切走时提示照常落地」的守卫（防过度抑制）。
  - r1 评审（needs-changes）后补：`enter_snapshot` 被拒不得推进回滚版本（公开 store 次序用例）、`beginRetry` 跨 vault 的两条视觉场景（A 不残留假在途 / 期间真实终态 ⇒ 版本门）、切换器的当前项变化 / 语言切换刷新（两条单测）。回滚收口把相位先收回 idle 后，终态是 idle → idle——**终态一律推进相位世代**（`projectActivity`），否则旧快照会复活已失效的重试动作（`harness-turn-retry-nov23` F5）。
  - r2 复审后补：cron 忙时（`beginCronRun` 返回 null、不 adopt）也要在调用前独立捕获发起视图（`origin`）——两条用例（A→B→reject 零 toast / 未切走照常）；`beginRetry` 的**活动回滚与轮次闸门分离**——当前视图拒绝不碰记录 / 闸门 / DOM（`harness-turn-retry-nov23` 新增「busy 窗口：挂起轻量快照 → 拒绝 → 分片上屏 → 快照返回恢复相位、旧动作不复活」）。
- [x] 1.2b 新增 webview 重载 / app 重启区分测试：未读均不回放；重载后当前 vault 的在途由进入快照恢复、非当前 vault 无标记直到后续事件。
  - 模型层：`enter_snapshot` 只回填相位、不动未读；store 是纯内存、无持久化 API（`harness-vault-activity.test.ts`）。
  - 装配层：切 vault 后由 `fetchSnapshot` 的 `in_flight` 回填；跨 vault 只靠事件——`tests/visual/scenes/m756-harness-activity-presence.spec.ts` 的往返用例与 `harness-vault-activity.spec.ts` 的显示门用例覆盖。**真机**的「webview 重载」不在本批（套件不重启 webview）：由模型层 + 装配层两层证据承担，已在完工报告登记为覆盖边界。
- [x] 1.3 扩展 `tests/unit/vault-switcher.test.ts`：非当前行三态、当前行永不建、标记无文本 / `aria-hidden`、`title` 格式、空闲无 title、浮层内就地更新不重拉、显式移除后不残留、无行记录不产生可见标记、筛选 / 游标 / `toHaveText` 不变、旧拼写无标记且不误删当前标题状态
- [x] 1.4 新增 `tests/visual/scenes/mvp-vault-row-activity.spec.ts`（结构断言，不新增整页基线）：三态形状、点落在切换钮矩形内、不压移除钮、当前行无标记、空闲零新增像素、三主题 / eink 可分、浮层关闭后不可见
- [x] 1.5 在旧实现上跑一次并留红：至少 1.1 的跨 vault 未读、1.2 的记账次序、1.4 的非当前行三态必须红（结构场景的「空闲零像素」旧实现天然绿，不作红判据）。红证据：`.local/missions/harness-activity-nov23/red/`（把 `src/` 的实现文件回退到基线 `8d9eb5ac` 后跑新测试的原始输出）
- [x] 1.6 真机场景骨架先落（下一步 6.1 的步骤表），旧实现跑出预期红：跨 vault 完成后的 A 行 / 钮不出现未读。旧实现的判据次序（`handleEvent` 首行即 `inCurrentVault` 过滤 ⇒ 跨 vault 终态在记账前被丢）由 1.2 的源码对账在旧实现上判红（见 `.local/missions/harness-activity-nov23/red/`）；本批未在真机上跑旧实现（旧分支无此场景）

## 2. 模型层（`src/harness-activity.ts`）

- [x] 2.1 把 `activity` 单例扩为按 vault 键控的 store（`Map<string, ActivityState>`）：`of` 未知键返回 `INITIAL_ACTIVITY` 且不分配
- [x] 2.2 事件面：`turn_started` / `stop_clicked` / `terminal { kind, displayed }` / `displayed` / `reset_view` / `enter_snapshot`；逐条委托 `reduceSendPhase`，不新增相位状态机
- [x] 2.3 `beginSend` / `rollbackSend`（token 带 before + 版本；版本不符 no-op）、`finishIfStopping`（只在 stopping 收口）、`reset(vault)` 只清目标 vault；`drop(vault)` 只由显式删除 / 重定位调用；**不实现通用 `retain`**
- [x] 2.4 `subscribe(listener)` 只在相位 / 未读跃迁时通知；分片、工具行、`notice` 不触发
- [x] 2.5 导出 `displayed` 判据的单一辅助（`vault === current && panePresent`），面板与测试共用，防两处真源
- [x] 2.6 单测全绿（1.1 转绿）

## 3. 面板接线（`src/harness-panel.ts`）

- [x] 3.1 `handleEvent`：先解析归属并记账（terminal / `auto_turn_started`），再走既有 `inCurrentVault` 过滤；跨 vault 事件不碰 `turnOpen` / `midTakeover` / DOM
- [x] 3.2 当前 vault 的终态仍按既有路径收口；`displayed` 取 `currentVault === vault && panePresent`
- [x] 3.3 `send()`：发送时捕获 `sendVault` 与 `beginSend` token；同步拒绝先 `rollbackSend(sendVault, token)`，再走既有 `viewGeneration` 守卫决定 DOM / 错误行 / 输入区回滚
- [x] 3.3a 停止路径：点击时捕获 `stopVault` 与 `viewGeneration`；`stop_clicked` 记到 `stopVault`；拒绝时 `finishIfStopping(stopVault)`，错误行只在视图世代未变时落地
- [x] 3.4 `resetView(options: { clearActivityFor: string | null })`：原五调用点 + 新增 `reloadSessionView` 按 §7 表改准（切 vault = null；新会话 / cron 切屏 / cron 回滚 / 恢复会话 / cron 打开会话 = 调用前捕获的目标 vault，不在 `.then` 里读 `currentVault`）
- [x] 3.4a `startNewSession` / `resumeSession` 的异步 `.then` / `.catch` 加视图守卫：发起时捕获 `actionVault` 与 `viewGeneration`；记录始终只清 `actionVault`，DOM 复位 / 渲染 / 错误行只在视图仍是发起视图时执行，切走后跳过（切回时由快照重建）
- [x] 3.4b cron 两条异步路径同样加守卫：`beginCronRun` 捕获 `cronVault` + `cronToken`，失败时 `reloadSession(cronVault, cronToken)`；`handleCronOpenSession` 在 `harness_resume_session` 前捕获 `payload.vault` + `viewGeneration`，resolve 后 `reloadSessionView({ targetVault, viewToken })`。记录只复位目标 vault；DOM 打开 / 复位 / 渲染 / `fetchSnapshot` 只在目标仍当前且世代未变时执行，切走后跳过 B 的全部副作用
- [x] 3.5 `vaultChanged`：更新 `currentVault` 后置 `panePresent = false`；同一 vault 早退不变；不再清未读
- [x] 3.6 新增 `paneSettled(present)` API：置门；`present` 为真时对当前 vault 派发 `displayed`；幂等
- [x] 3.7 `attachTo(mount)`：`mount !== null` → `panePresent = true` + 既有 `opened`；`null` → false
- [x] 3.8 `applyActivityBadge` / `applySendPhase` 改为读当前 vault 的记录；不新增第二个 badge 写点
- [x] 3.9 新增 `reloadSessionView({ targetVault, viewToken })`：清目标 vault 记录 + 仅当目标仍当前且 token 未变时 `resetView` + `fetchSnapshot`；`handleCronOpenSession` 用它替换 `vaultChanged("", null)` + `vaultChanged(root)`，MUST NOT 在 API 内部读 `currentVault`
- [x] 3.10 装配对账测试全绿（1.2 转绿）

## 4. 装配层（`src/main.ts`）

- [x] 4.1 创建 store 并注入面板 / 切换器；`subscribe` 的退订随 app 生命周期
- [x] 4.2 `applyStoredLayout` 两条分支末尾（`applySplitChrome` / `syncActiveDocument` 之后）都调 `harnessPanel.paneSettled(present)`；已是目标形态（本次无改动）也照常发
- [x] 4.3 `applyVault` 的 `vaultChanged` 调用点保持顺序（`vaultChanged` → `onVaultLoaded` → `applyStoredLayout`），不在 `vaultChanged` 前抢读布局
- [x] 4.4 显式删除 vault 成功 → `store.drop(实际后端打开根)`；重定位成功 → `store.drop(旧的实际后端打开根)`（不迁移）；取不到实际根时宁可不 drop
- [x] 4.5 不实现通用 `retain`、不按 `vault_list` 的注册表原 `path` 做周期性清理；无行记录 MAY 留到重载，且不产生可见标记
- [x] 4.6 `handleCronOpenSession` 在 `harness_resume_session` 前捕获 `payload.vault` 与 `viewGeneration`，resolve 后用 `reloadSessionView({ targetVault, viewToken })`；全仓确认无 `vaultChanged("", null)` 残留

## 5. 切换器与样式（D2 已定：三态）

- [x] 5.1 `src/vault-switcher.ts` deps 增加 `activityOf(path)` 与 `subscribeActivity(listener)`；装配层注入
- [x] 5.2 `renderRow`：仅 `available && !current` 且有状态时插入 `span.vault-row-activity`（无文本、`aria-hidden`、`data-activity`）；状态词写进 `el.title`；空闲 / 当前行不设 title、不建节点
- [x] 5.3 浮层打开期间订阅更新：就地更新标记与 title，不重拉列表、不重排、不改游标；关闭时零 DOM 工作
- [x] 5.4 `src/style.css` 行标记三态：6×6、`var(--r-pill)`、在途空心环 / 回复实心点 / 失败实心点 + 外环；`margin-left: auto`、`pointer-events: none`；复用既有 token，不新增颜色；有态时名称省略号最多提前 12px，若 Alex 不接受该收缩，备选放摘要次行右端（裁点见 design §11.2）
- [x] 5.5 三主题 / eink：eink 靠形状，在途描边提实；不加动画、不加过渡
- [x] 5.6 结构断言：标记矩形在切换钮矩形内、与移除钮不相交；`.vault-list` 滚动条档位不变
- [x] 5.7 行级测试全绿（1.3 转绿）；行只按三态实现（D2 已定，2026-11-23），不保留「两档」分支

## 6. 验收场景（真机矩阵）

- [x] 6.1 新增真机场景：id / item 按 `scripts/acceptance/scenarios/` 当前最大值 +1 分配（起草时最大数字 id 272、item 708；**不预占 273**），文件名建议 `harness-vault-unread`；步骤覆盖：
  1. A 慢流 → 收起 → 切 B → 打开切换器 → A 行 `help` 含「处理中」
  2. 等终态 → A 行 `help` 含「有新的回复」
  3. 点 A（面板仍收起）→ 标题栏钮 `help` 含「有新的回复」；再次打开切换器，当前行 A 无标记
  4. 打开面板 → 回复在场；收起 → 钮回空闲
  5. A 失败一轮 → 切 B → A 行「有失败结果」；切 A（面板不在场）→ 钮仍失败；打开 → 清
  6. A 一轮主动停止 → 切 B → A 行无任何标记
  7. 时序回归：B 有未读 → 切到「存储布局无 harness pane」的 vault → 未读不得被误清算
  8. 编辑中途不切 vault 的对照：当前 vault 收起态与场景 252 逐字一致
- [x] 6.2 回扫 `scripts/acceptance/scenarios/253-harness-vault-activity.md`：把第 154–171 行的「完成后往返 ⇒ 不伪造未读」正向断言改为「完成后往返 ⇒ 呈未读、切回并在面板在场时清算」；场景头部注释同步改准
- [x] 6.3 场景 252 不改（当前 vault 语义不变）；逐条核对 252 / 253 的判据载体仍是 `title` → AX `help`
- [x] 6.4 `node scripts/acceptance/coverage.mjs` 重新生成 `COVERAGE.md`；`coverage.mjs --check` 通过
- [x] 6.5 真机跑新场景 + 253 + 252，证据落 `.local/acceptance/2026-11-23-harness-activity/`（git 外）：
  - `721-harness-vault-unread` **PASS**（73.3s / 29 断言）
  - `253-harness-vault-activity`（回扫后）**PASS**（89.0s / 31 断言）
  - `252-harness-activity-presence`（精确 id；`252` 作为筛选词会先命中 item 252 = `49-vault-switch-feedback`）**PASS**（42.4s / 34 断言）
  - 附带：`49-vault-switch-feedback` **PASS**（19.4s / 22 断言）
  - 一轮 INVALID 都没有；无 FAIL 项需要定位
- [x] 6.6 证据目录用绝对路径 `ls` 过：`/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-23-harness-activity/`（四个场景目录 + `summary.md` / `results.json` / `run.log` / `app.log`；`summary.md` 四行全 PASS）

## 7. 规格与文档

- [x] 7.1 `specs/harness/spec.md` 的 MODIFIED 块保持「整条复制 living 再改」；实现期若需再改条款，仍按整块更新，不删段
- [x] 7.2 `specs/vault-workspace/spec.md` 的 ADDED 块与实现逐条对账：三态、当前行不显示、空闲零像素、title 格式、浮层内更新、旧拼写 fail-closed
- [x] 7.3 `proposal.md` 的节点状态块已在获得节点 1 后更新：2026-11-23 原话「三项推荐。」与 D1–D6
      按推荐值生效；实现期范围变化仍重新走节点 1，不静默扩 scope
- [x] 7.4 design.md 的行号 / API 名在实现后回改一次（若与最终符号不一致），避免下次误引
- [x] 7.5 复用 D870–D872 时同步更新 `文案-Copy.md` 的消费点说明（行标记也消费同一状态词，不新增 key），并核对 zh/en 双档文案表
- [x] 7.6 若实现期发现新的已知边界（如行宽收缩的替代形态），补进 design §15 与 spec 的已知边界，不口头流传

## 8. 门禁

- [x] 8.1 `PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH" npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（由 `gate.sh quick` 的 `openspec-validate` 项执行：`GATE PASS openspec-validate`）
- [x] 8.2 `bash scripts/docs-check.sh` 通过（`gate.sh quick` 的 `docs-check` 项 PASS）；另跑 `node scripts/openspec-archive-check.mjs --change extend-harness-activity-across-vaults-nov23` → PASS（2 份 delta / 1 条 MODIFIED / 42 段无静默丢段 / 归档队列对账通过）
- [x] 8.3 `scripts/gate.sh quick` 通过：`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0（`unit-tests` 1847 条）
- [x] 8.4 `scripts/gate.sh visual` 通过：`GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0；`visual-regression` **1258 passed**（含两个新场景、r1 / r2 评审修复后的重试与 cron 忙时场景、整页 / 元素像素层）
- [x] 8.5 真机场景 PASS（252 / 253 / 721，见 6.5/6.6）；**未动标题栏内元素的事件监听**（toggle 钮的 DOM / 监听一字未改，只改了它的三态取值与 title 写入路径），按 REVIEW.md「标题栏 mousedown」条的触发条件不需要跑场景 39
- [x] 8.6 视觉基线**未更新**（`git status tests/visual/baselines` 无改动；行标记是结构断言 + 空闲态零像素，不需要新基线）

## 9. 信息卫生

- [x] 9.1 所有 fixture / 视觉场景 / 验收场景只用合成 vault 名与路径（如 `/tmp/lumir-*`），MUST NOT 出现真实 vault 名、真实人名、真实文档正文
- [x] 9.2 提交前对改动面做一次 text 级 grep 清扫（真实路径 / 项目名 / 文档片段），并核对截图类证据只落 `.local/`（git 外）
- [x] 9.3 本 change 无原型 / 无新增 HTML（新增的只是结构视觉场景，不新增像素基线），跳过

## 10. 收尾

- [x] 10.1 `tasks.md` 全部勾选，未勾项就地写放弃理由（不删任务项、不留空勾）。
  - 10.3 / 10.4 **留给 tower**：独立 reviewer 与节点 2 归档是本 change 的下一段流程（worker 不归档、不 merge、不 push）；verdict 须绑定本次提交的 tip
- [x] 10.2 已在 `docs/backlog.md` 的归档跟踪队列落一条本 change 记录（见该文件「归档跟踪队列」末条）
- [ ] 10.3 交独立 reviewer；评审判断层不降档；verdict 绑定当前 tip
- [ ] 10.4 归档前逐条核对节点 2 五要件；归档走 `node scripts/openspec-archive.mjs <change-id>`，归档提交后跑 `--archived` 审计至 PASS
