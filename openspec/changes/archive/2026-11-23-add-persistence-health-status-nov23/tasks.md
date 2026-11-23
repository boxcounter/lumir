# Tasks: add-persistence-health-status-nov23

> 节点 1 已通过（2026-11-23，Alex 原话「三项推荐。」）：V1–V7 全部按推荐值生效，第 4 组起
> 可按本清单推进。未完成项保持未勾选。实现期若范围 / 行为需求发生变化，停下更新 `proposal.md`
> 并重走节点 1，不静默扩 scope。

## 0. 设计调整（2026-11-23，Alex 同意）

实现完成后，Alex 于 2026-11-23 同意以下**呈现层**调整（不改 Rust 行为、不改告警的两维语义）：

- **Harness 历史风险**：从灰色元信息小字升级为 composer 上方**紧凑警示块**——浅警示色底 +
  左侧警示边条、完整换行、正文色，不用红色；不改成新面板 / 设置。文案改直白句：
  正在写失败 =「对话暂未保存。请检查磁盘空间或目录权限；恢复后会继续写入。」；写入恢复但
  历史缺失 =「此前部分对话记录未能保存；新内容已恢复写入。」；尚无 history 写入的退出风险 =
  「现在退出，这段对话将无法恢复。」。zh / en 同改，文案 deck 同步。
- **文档红色横幅**：保留强提醒与「全部保存」，主文案改「未保存的修改暂时没有备份，关闭应用
  可能丢失。」；数量 / 路径降为次要信息，避免「崩溃备份 / 首个」等实现术语。
- **独立视觉复核 P2 修复（2026-11-23）**：light 横幅前景在本横幅内局部加深为 `#b33d32`
  （实测 5.017:1），不改编全局 `--danger`；history sticky 增加原生可聚焦关闭钮与 Escape，
  Escape 复用 `escapeDisposition()`（组合期 / 修饰键不关），关闭后焦点归还到出现前元素
  （失效回落 composer），不自动抢焦点；其他无动作 sticky 不传 `dismissible`，DOM / 行为零变化。
- 该调整只影响本 change 的呈现与文案；告警触发、两维状态机、动作与生命周期不变。本轮未更新
  任何正式视觉基线（基线更新仍是 Alex 的人肉裁决点）。

## 1. 制品（提案期）

- [x] 1.1 `proposal.md`：为什么改、改什么、不做什么；V1–V7 裁决点与推荐值；节点状态块
      （现为节点 1 结论：原话与日期）；评审 r1 修订记录
- [x] 1.2 `design.md`：现状证据、两维状态机（当前写健康 + `history_gap` latch）、severity /
      gap 触发、事件 / 快照形状、首行与部分写边界、双面 UI、备选、先红后绿验收矩阵、已知边界
- [x] 1.3 `tasks.md`：本文件
- [x] 1.4 `specs/harness/spec.md`：MODIFIED「会话本地留存」（整块复制 + 末句改写）+
      ADDED「留存健康状态」（两维、latch、切 vault、部分写、sticky 升级）
- [x] 1.5 `specs/fs-io/spec.md`：MODIFIED「崩溃备份与恢复入口」（整块复制 + 写失败 / 枚举失败
      两个独立子条件 + 场景）

## 2. 提案期自验

- [x] 2.1 `PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH" npx --yes
      @fission-ai/openspec@1.12.0 validate add-persistence-health-status-nov23 --strict`
      通过（CLI 不接受 change id 时改跑 `validate --all --strict`）
- [x] 2.2 `node scripts/openspec-archive-check.mjs --change
      add-persistence-health-status-nov23` PASS（MODIFIED 整块复制、无静默丢段）
- [x] 2.3 `bash scripts/docs-check.sh` 通过（含 OpenSpec 相对链接、归档对账、归档队列、
      验收场景契约、backlog 出口）
- [x] 2.4 文本级信息卫生自检：制品不含真实 vault 内容 / 真实人名 / 真实绝对路径 / 凭据；
      `.local` 指针全部写在行内代码里，不产生仓内死链
- [x] 2.5 日志落主仓 `.local/reviews/harness-proposals/health-*.log`（validate / archive-check /
      docs-check，git 外）；整份 change 复制到
      `.local/reviews/harness-proposals/add-persistence-health-status-nov23/` 供 Alex 打开

## 3. 节点 1（Alex 裁决，硬门禁）—— 已通过（2026-11-23）

- [x] 3.1 Alex 对 V1–V7 逐条裁决：2026-11-23 原话「三项推荐。」（本批三项提案一次答复）
      = V1–V7 全部按推荐值批准，无改值、无否决项
- [x] 3.2 按裁决回填 `proposal.md` / `design.md`：状态块抄原话与日期、裁决表改为「按推荐值
      生效」、删去「若 V5 被拒绝」等退路表述；推荐值无改动 ⇒ 默认值与文案零变更
- [x] 3.3 节点 1 已通过 ⇒ 第 4 组起可推进；立项由 tower 执行，不在本 change 的制品面

## 4. 先红（实现前先写断言并记录红灯）

- [x] 4.1 Rust R1–R10（`design.md` §10.1）：当前写健康、`history_gap` latch（失败→成功→缺口仍在）、
      压缩轮换沿用、切 vault 不清、severity / gap 触发、首行失败按 payload 判 gap（R6a history /
      R6b annotation 两例，断言首次 payload 未被补回）、前缀写故障注入、快照 / 事件同键、
      `history_written`、新会话重置与诊断日志；在当前代码上跑出失败，红灯输出存
      `.local/acceptance/` 或 mission 证据目录
- [x] 4.2 前端 U1–U13（§10.2）：备份写失败横幅、失败态清除、成功语义、警示块分档、
      旧快照宽容、快照重建、sticky 首次 history（含 `annotation→history`）、IPC 白名单、
      `state=ok` + gap 仍显示、切 vault 不清、sticky 关闭不等于静音、枚举失败独立保留、
      `history_written=false` 的未落盘提示；在当前代码上跑出失败
- [x] 4.3 视觉 V1–V4（§10.3）：健康态 `hidden` 与几何、当前写失败态、`state=ok` + gap 态、
      横幅三种形态与零占位；先加结构断言（像素基线留到第 9 组人肉过目）
- [x] 4.4 真机 A1–A6（§10.4）：新增 / 更新验收场景文件，先在当前 app 上跑出红（A7 不可达，
      场景正文如实写明边界，不造假注入）——HEAD 原码上 709b 判红（横幅 / 全部保存 / 首个路径
      三条断言全缺，见 `red-acceptance-head.log`）；正面场景在旧代码上无横幅可断言。

## 5. Rust 实现

- [x] 5.1 `harness/jsonl.rs`：`PersistenceHealth` 两维 + `history_written`（`state` / `since_ts` /
      `severity` / `detail` + `history_written` + `history_gap { present, since_ts, detail }`，
      `Serialize`）；Writer 共享
      `Arc<Mutex<_>>`；`record()` 保持 `()`；失败分类（open / serialize / first_line / write /
      partial）
- [x] 5.2 `jsonl.rs` 首行修复：写成功后再 `take()`（或失败回填）；MUST NOT 丢挂起行；
      首行失败按本次 payload 判 gap：history payload 置 gap、annotation 不置；不承诺部分写后
      可恢复（R6a / R6b）
- [x] 5.3 `jsonl.rs` 部分写跟踪：`LineSink` 测试 seam（生产写 `File`，测试写 N 字节后 Err）；
      可能已写字节时置 `history_gap`、`severity=history`；无法区分时按可能部分写处理（R7）
- [x] 5.4 `harness/session.rs`：`Session` 创建并持有两维 + `history_written`；`persistence()`
      只读投影；`rotate` 沿用两维与 `history_written`；新会话 / 恢复重置；`StateSnapshot` /
      `StateSnapshot::empty` 加两维 + `history_written` 键
- [x] 5.5 `harness/events.rs`：`persistence` 构造函数（同一份序列化 + `type`）；两维 +
      `history_written` 跃迁（含 `degraded→ok` + gap true、`history_written false→true`）都发；
      与快照同键同值单测（R8）
- [x] 5.6 `harness.rs` / `lib.rs` / `turn.rs`：`Runtime.forward` 事件出口；`TauriEventSink`
      提升为 `pub(crate)`；装配 `ScopedSink`；隔离运行不装配 forward；轮次外写点覆盖（R8）；
      切 vault 不动健康（R4）
- [x] 5.7 `logging.rs`：`PersistenceWriteFailed` 事件 + 字段白名单（`kind` / `code` /
      `partial` / `path`）；单测断言不含正文类字段（R9）
- [x] 5.8 新会话 / 恢复重置：两维 + `history_written` 从空健康起算；面板动作后不再显示旧状态；
      单测（R9）
- [x] 5.9 重导 ts-rs bindings（`LogEventName` 新变体）；`git add src/bindings/**` 后再跑 quick

## 6. Harness 面板 UI

- [x] 6.1 `src/ipc.ts`：`HarnessEvent` 联合加 `persistence`；`isHarnessEventType` 白名单加
      分支（`harness-event-whitelist.test.ts` U8 守）
- [x] 6.2 `src/harness-panel.ts`：composer 上方常驻警示块（独立类 `lumir-hp-persist-warning`
      / `role="status"`；Alex 2026-11-23 裁决：浅警示底 + 左侧警示边条 + 正文色 + 完整
      换行，不复用引用失败状态行的小字样式）；无告警时 `hidden`
- [x] 6.3 警示块两维优先级：`history_gap.present=true` 时显示缺口文案（`state=ok` 时明确
      「此前部分对话记录未能保存；新内容已恢复写入。」），MUST NOT 回到健康态；`state=degraded`
      且无 gap 时按 severity 显示当前失败（history 档「对话暂未保存。请检查磁盘空间或目录权限；
      恢复后会继续写入。」）；`history_written=false` + 告警时追加「现在退出，这段对话将无法
      恢复。」，true 后该句消失（U4 / U9 / U13）
- [x] 6.4 快照 / 事件两路解析同一份两维 + `history_written`（U4 / U6）；缺 `persistence` /
      `history_gap` / `history_written` 键按 `ok` / `present=false` / `history_written=true`（U5）；
      新旧快照都不误报
- [x] 6.5 sticky：本逻辑会话首次进入 `history`（含 `annotation→history`）一条，按文案去重、
      重挂载不重复（U7）；sticky 可点击关闭，关闭只移除提示，不隐藏警示块、不清 gap、
      不构成静音（U11）；`HarnessPanelDeps` 新增 `stickyToast`，装配层接线到既有 sticky 浮条
- [x] 6.6 切 vault：按 vault 重拉快照，MUST NOT 本地清除健康；切回显示该会话自身状态（U10）
- [x] 6.7 文案：`src/copy-data.ts` + 文案 deck 同批新增 D 编号（zh / en 占位名一致）；
      缺口文案、当前失败文案、未落盘提示、sticky 文案、枚举失败文案各自独立；
      `tests/unit/copy.test.ts` 漂移门禁绿

## 7. 文档侧 UI

- [x] 7.1 `src/save-controller.ts`：`failedPaths`（路径 → `{at, code}`）；`backupDirty`
      失败记录、成功删除；`forgetBackup` / dirty 转 clean 订阅 / `noteRenamed` 清对应项
- [x] 7.2 两个独立子条件：写失败 `failedPaths` 与枚举失败条件；写失败清空 MUST NOT 撤下枚举
      失败，重新检查成功 MUST NOT 清写失败
- [x] 7.3 只读查询 + 变更通知接口；装配层不自存第二份失败集合
- [x] 7.4 `src/main.ts`：文档区顶部 sticky 横幅（全局一条；`role="status"`、无关闭按钮；
      写失败段 = 主句「未保存的修改暂时没有备份，关闭应用可能丢失。」+ 数量 / 至少一个路径的
      次要信息 + 「全部保存」（Alex 2026-11-23 裁决，不用「崩溃备份 / 首个」等实现术语）；
      枚举段 = 「无法检查残留备份」+「重新检查」；两段可同时在场）；`hidden` 时零占位
- [x] 7.5 `src/tabs.ts`：受影响路径的 `aria-label` / `title` 追加「（备份失败）」后缀；
      可见像素不变；失败集合变化时触发 `renderTabs`
- [x] 7.6 V5（已纳入）：`checkRecovery` 的 `recovery_list` 失败进入枚举失败子条件，
      带「重新检查」动作；成功只清该子条件（U12）
- [x] 7.7 诊断：`recovery_write_failed` / `recovery_list_failed` 失败落日志（已有事件名可复用，
      不新增事件则不动 bindings）
- [x] 7.8 前端单测 U1–U3 / U12 转绿

## 8. 验收场景与真机（本地，不进 CI）

- [x] 8.1 新增验收场景：健康时不打扰（A1）、文档备份失败横幅（A2）、全部保存清写失败子条件
      且无枚举失败时撤下（A3）、保存失败横幅保留（A4）、枚举失败独立保留（A5）、重启后再编辑
      重现（A6）
- [x] 8.2 场景正文写明真实失败面的构造（`envWrite` / `seed.envFiles` 在 `<env>/lumir/recovery`
      写普通文件）与「为什么这是真实可达的失败面」；A7 的不可达边界如实写在场景说明里，
      不伪造 harness 注入
- [x] 8.3 回扫既有场景：08c / 08d 等依赖 `env:recovery` 的断言，确认新横幅不改变期望；
      文案碰撞时改断言，不改产品语义
- [x] 8.4 `scripts/acceptance/README.md` 与 `COVERAGE.md` 同步新场景条目（契约门禁会判）
- [x] 8.5 真机跑套件：`node scripts/acceptance/run.mjs`；证据落 `.local/acceptance/`，
      不落 worktree；FAIL 项与手感项列给 Alex
- [x] 8.6 真机复验：`pnpm tauri dev` 起真实 app（起实例前按 AGENTS.md 处理白屏陷阱），
      用 KimiCU 走 A1–A6；桌面 vault 用 `/tmp/lumir-m102-acceptance`，真实 vault 只读

## 9. 视觉门禁

- [x] 9.1 结构层：`tests/visual/scenes/**` 新增 V1–V4 场景；CI 的 `LUMIR_VISUAL_STRUCTURAL=1`
      路径绿
- [x] 9.2 本地像素：`scripts/gate.sh visual` 全绿——`GATE RESULT: 15/15 PASS（SKIP 0）`，
      exit 0；`1227 passed / 0 failed / 1 skipped`。健康态既有基线零漂移：V1 零几何，
      m303 / m351 的整页 / composer 健康态基线重截后目检无警示块
- [x] 9.3 `degraded` / `state=ok` + gap / 横幅三形态的像素基线：Alex 2026-11-23 原话
      「批准候选并重截基线」，已按 `health-candidates/` 最新图转正式像素断言（V2p / V3p /
      V3bp / V4p，整页 + 元素各 4 张，共 8 张新基线，与候选逐字节相同）；41 条报告失败
      快照 + 7 张同测试后续快照（首张失败后从未比较）一并重截，共 48 张修改；无其他快照
      变动（`baseline-delta.txt`：modified=48 / added=8 / removed=0）

## 10. 门禁与收尾

- [x] 10.1 `scripts/gate.sh quick` 全绿（fmt / clippy / cargo test / bindings 漂移 /
      gen-schemas 漂移 / tsc / 单测 / perf 夹具 / acceptance 契约 / docs-check / validate）
- [x] 10.2 `scripts/gate.sh visual` 全绿（本地；CI 绿不代表像素层没回归）：
      `GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0；`1227 passed / 0 failed / 1 skipped`
- [x] 10.3 `bash scripts/docs-check.sh` 全绿（含归档对账、验收场景契约、backlog 出口）
- [x] 10.4 `PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH" npx --yes
      @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 10.5 实现 PR 合并时在 `docs/backlog.md` 归档跟踪队列落**有且仅有一条**条目（tasks
      全勾后 docs-check 会强制）。条目已先补（`docs/backlog.md:77`，grep count = 1）；
      合并时复核
- [x] 10.6 信息卫生：对改动面做 text 级 grep 清扫（真实 vault 内容 / 人名 / 绝对路径 /
      凭据）；截图与 fixture 用合成数据；诊断日志断言不含正文
- [x] 10.7 独立 reviewer 评审：结论 **clean / merge**，绑定 tip `e74cb727`；P1 / P2
      清零（2026-11-23 最终独立终审）
- [ ] 10.8 节点 2 五要件齐后归档：`node scripts/openspec-archive.mjs
      add-persistence-health-status-nov23` → 提交归档结果 → `--archived` 审计 PASS

## 11. 验证（change 的验收动作）

- [x] 11.1 Rust 单测 R1–R10 全绿；前端单测 U1–U13 全绿
- [x] 11.2 视觉 V1–V13 结构 / 可访问性断言 + V2p / V3p / V3bp / V4p 像素断言全绿；
      本地像素层全绿（`1227 passed / 0 failed / 1 skipped`）
- [x] 11.3 真机 A1–A6 PASS（A7 由 R1–R10 + 视觉桩承担并写明）
- [x] 11.4 门禁 `quick` + `visual` 全绿；`validate --all --strict` + `docs-check` 全绿：
      quick `GATE RESULT: 13/13 PASS（SKIP 0）`；visual `GATE RESULT: 15/15 PASS（SKIP 0）`；
      validate 39 passed / 0 failed；docs-check PASS
- [x] 11.5 证据齐：`.local/acceptance/**`、`.local/reviews/**`（评审包）、门禁日志路径；
      门禁报告照抄 `GATE RESULT` 原文行并附退出码

## 12. 实施证据（2026-11-23，本 mission 本机）

> 证据全部落在主仓 `.local/`（git 外），不落 worktree；路径均为本机可 `ls` 的绝对路径。

- Rust 先红（HEAD 原码 + 仅测试 seam）：`.local/missions/persistence-health-nov23/red-rust-head.log`
  —— 两条失败：`harness_state.persistence` 缺失（`Null`）、首行写失败后挂起行丢失
  （重试后文件首行是 `llm_response` 而不是 `session_open`）。
- 前端先红（HEAD 原码 + 新测试）：`.local/missions/persistence-health-nov23/red-frontend-head.log`
  —— `recoveryFailures` 不是函数（U1–U3 / U12）、面板新导出不存在（宽容解析 / 文案 / sticky）。
- 独立评审修复（P1-1 / P1-2 / P1-3 / P2-4 / P2-5 + 测试真实性）：
  - 先红：`red-p1-backup-enum.log`（4 条备份 / 枚举交错全红）、`red-p1p3-p2p5-visual.log`
    （V5/V6/V7 全红）、`red-p2-lock-partial.log`（sessions 锁内发送探针红）。
  - 后绿：同批测试全绿；`green-p1p3-p2p5-visual.log` 9/9。
  - PartialFail sink 改为**真实写入前缀字节**；新增 R7b 首行部分写 → 前缀 + 重试
    `session_open` 同行的坏行形态断言（不再只返回 `partial:true`）。
- 第二轮复审 P1（drain 顺序 / 快照 token 准入）：
  - 先红：`red-p1-flush-order.log`（阻塞 reporter 双线程发送顺序 `["B","A"]`）、
    `red-p1-snapshot-stale.log`（V8 空会话快照后到，告警被清）。
  - 后绿：`green-p1-snapshot-stale.log` 10/10；Rust 顺序测试绿。
  - `PersistenceTransitions::flush` 改为**单 drainer 持续 drain 到空**；快照准入同时看
    请求时事件序号 + session token，空会话 / 旧 token 快照丢弃并重读一次；
    `restoreSnapshot` 与轻量快照共用同一入口。
- 终审 panic 恢复（第三轮 P1）：
  - 先红：`red-p1-panic-recovery.log`——瞬时 panic / panic 期间入队 / 永久 panic 三条全红
    （旧实现整批 take 后 panic，未处理项丢失；guard 只复位标记）。
  - 后绿：`green-p1-panic-recovery.log` 4/4。
  - 策略：一次取一条（不整批 take），锁外 `catch_unwind` 包住 reporter；瞬时 panic 放回
    **队首**并在同一次 flush 内重试；panic 期间新入队项由同一 drainer 继续取；之后正常
    写入照常交付。单 drainer / 顺序 / sessions 锁外 emit 的既有测试保持。
- 终审 panic 保留（第四轮 P1，degraded 不得因丢弃制造假健康）：
  - 先红：`red-p1-panic-retention.log`——degraded 三次 panic 后被丢弃（队列 0）、持续 panic
    时事件未保留。
  - 后绿：`green-p1-panic-retention.log` 5/5。
  - 策略：三次立即重试后**不丢弃**，保留队首；单实例延迟重试线程按 20ms 指数退避（封顶
    2s）接管，reporter 恢复后无需自然写入即可交付。永久 panic 不忙转 / 不递归，诊断按
    累计次数节流（前 3 + 每 30 次）。degraded / ok 共用「保留重试」而非丢弃策略。
- 终审生命周期（第五轮 P1）：
  - 先红：`red-p1p2-lifecycle.log`——drainer 在途时 retry 误退出（scheduled 被清）、永久
    panic 强持队列 Arc（销毁强引用后 Weak 仍可 upgrade）。
  - 后绿：`green-p1p2-lifecycle-tests.log` 两条专项 PASS；全量 `green-p1p2-lifecycle.log`
    **1060 passed / 1 ignored**。
  - 策略：retry 退出在同一把锁内同时确认 `pending.is_empty() && !draining`；重试线程睡眠
    期间只持 `Weak<TransitionState>`，每轮 upgrade 后短暂强持完成一次 drain 再释放；Session /
    Writer 销毁后 upgrade 失败即退出，队列可释放。未交付告警保留、单 drainer、顺序、
    锁外 emit、精确重试次数均保持。
- Rust 后绿：`cargo test --lib` **1060 passed / 1 ignored**（含 R1–R10 + 锁外发送 +
  drain 顺序 + panic 恢复 / 保留 + 生命周期 + R7b）。
- 前端后绿：`pnpm test` **1804 passed**（含 U1–U13、请求世代双向交错、保存成功后旧备份
  迟到失败不回标、会话归属、快照 token 准入）。
- 视觉：`tests/visual/scenes/persistence-health-nov23.spec.ts` 6 条结构断言全绿；未新建 / 未更新
  任何像素基线（degraded 与横幅形态的像素基线属 Alex 人肉过目的 `--update` 裁决点）。
- 真机：评审修复后 `node scripts/acceptance/run.mjs 709` 单轮 **6/6 PASS**
  （`acceptance-709-postfix.log` 107.5s；`acceptance-709-final-tip2.log` 102.9s；
  `acceptance-709-final-tip3.log` 102.7s；第二轮复审修复后 `acceptance-709-r3.log` 112.5s，
  均 6/6）。
  证据目录 `.local/acceptance/2026-11-23-persistence-health/`（`red-head/` 是 HEAD 原码上
  709b 的红灯副本）。A7（harness 正面写失败）真机不可达，由 R1–R10 + 视觉桩承担（见 709
  场景正文）。
- 门禁（照抄原文）：
  - `gate-quick-lifecycle.log`：`GATE RESULT: 13/13 PASS（SKIP 0）`，gate.sh 退出码 0
    （终审生命周期修复后的最终代码；`gate-quick-panic-retention.log` /
    `gate-quick-panic.log` / `gate-quick-r3.log` / `gate-quick-fix3.log` 同结果）。
  - `gate-visual-final2.log`：`GATE RESULT: 14/15 PASS（SKIP 0）`，gate.sh 退出码 1；
    唯一 FAIL 是 `visual-regression`（`1171 passed / 41 failed / 1 skipped`，13.7m）。
    41 条失败与 HEAD 原码逐条相同，40/41 实际截图 byte-identical、m303 实际图仅差 6 像素
    （见下条分类证据）；本 change 的 9 条视觉结构断言全量 PASS。管道命令的 shell 退出码
    取自 `tail`，门禁判定以 `GATE RESULT` 与脚本尾部 `[ "$fail" -eq 0 ]` 为准。
- 交付提交：mission 分支 `feat/persistence-health-nov23` 的 tip（hash 见完工报告；
  `feat(harness): surface persistence write failures`）。最终完整 visual 跑在提交前的同一份
  代码上；此后只改了本文件的勾选与证据记录。未归档、未 merge、未 push。
- 视觉基线漂移：`visual-classification.md` —— 最终全量 41 条失败与 HEAD 原码跑同一批 spec
  的失败清单**逐条相同**；41 张实际截图中 40 张 byte-identical，m303 仅差 6 像素（右下角）。
  曾由本实现引入的 m633 严格 locator 歧义（6 条）已用 `:not([data-persistence-health])`
  精确隔离并转绿。按「基线更新是人肉裁决点」未更新任何基线。
- 呈现调整（2026-11-23，Alex 同意；见 §0）：
  - 机器断言先红后绿：`persistence-health-nov23.spec.ts` 20/20（V2b / V4d en 面、警示块
    颜色 / 左边条 / 正文色 / 完整换行 / 引用行隔离 / 健康态零几何、V4e 三主题实际 WCAG、
    V9–V13 sticky 关闭：Enter / Escape / 鼠标、焦点归还、失效回落、组合期 / 四修饰键反向
    准入）；m633 10/10；m303 / m345 / m347 / m351 / m423 / m440 / m454 结构层 47/47；
    `pnpm test` 1806 passed（新增 zh/en 逐字文案与 sticky 接线断言）。
  - `scripts/gate.sh quick`：`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0。
  - 基线更新前最后一次全量（P2 复审修复后，历史证据）：`GATE RESULT: 14/15 PASS（SKIP 0）`；
    `visual-regression` FAIL（`1182 passed / 41 failed / 1 skipped`，13.9m）。41 条与既有清单按
    `(spec, 行, 标题)` 逐条相同、无新增失败；m303 / m347 / m351 等 composer 场景的失败仍属
    既有基线漂移。
  - 独立视觉复核 P2 修复（2026-11-23）：
    - 横幅实际 WCAG：light `#b33d32` on `#f9ecea` **5.017:1**；dark `--danger` 在合成底
      `#3b3032` 上 **4.905:1**；eink 黑字白底 **21:1**。文字与按钮边界同值，均 ≥4.5 / ≥3；
      只改本横幅局部前景，全局 `--danger` 未动。
    - sticky 键盘：Tab 到原生关闭钮、Enter / Escape / 鼠标关闭；Escape 走 `escapeDisposition()`，
      组合期 / keyCode 229 不关不消费、四修饰键只消费不关；出现时不抢焦点；关闭后焦点回到出现
      前元素（失效回落 composer），警示块与 gap 文案仍在；新逻辑会话可再次提示（关闭非静音）。
      旧无动作 sticky 不传 `dismissible`，DOM / 行为零变化。
    - V4c 双条件几何：1200 宽两段并排一行、900 宽折两行；两段不重叠、不出界，横幅无横向 /
      纵向溢出。
  - 三种候选按新形态重截（4 张整页 + 4 张元素裁切，连跑两轮 8/8 byte-identical），落在
    主仓 `.local/reviews/pixel-drift-nov23/health-candidates/`，说明页为同目录 `README.md`；
    独立复核修复后 03 已按新前景重拍。
  - 基线更新（Alex 2026-11-23 原话「批准候选并重截基线」）：
    - 8 张新形态正式基线（V2p / V3p / V3bp / V4p，整页 + 元素各 4 张）与
      `health-candidates/` 最新 8 张 **逐字节相同**。
    - 41 条报告失败快照 + 7 张同测试后续快照（m734 900×700、render-codeblock wrap 2–4、
      search-panel nomatch、tree-menu trash-active / trash-dir；首张失败后从未被比较）一并
      重截；`baseline-delta.txt`：**modified=48 / added=8 / removed=0**，无其他快照变动。
    - 前后 hash 与目标清单：`.local/missions/persistence-health-nov23/baselines-before.sha256`
      / `baselines-after.sha256` / `baselines-41-targets.txt` / `baseline-delta.txt`。
    - 健康态：V1 零几何；m303 / m351 健康态基线重截后目检无警示块；新增基线只覆盖
      degraded / gap / banner 三形态，未新增健康态像素。
    - 最终全量 visual：`GATE RESULT: 15/15 PASS（SKIP 0）`，exit 0；
      `1227 passed / 0 failed / 1 skipped`（13.7m）。

**已知边界**：`docs-check` 的 `tsc-unit` / `bindings-drift` 在首次 quick 时因「bindings 未
`git add`」「测试 deps 缺 `stickyToast`」两条已修；重跑见最终门禁日志。`m303-harness-panel`
的旧 2183 像素差已随 Alex 2026-11-23「批准候选并重截基线」的本次重截消失（该基线在
48 张修改集内）；全量 visual 已 15/15 全绿。
