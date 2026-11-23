# Tasks: add-persistence-health-status-nov23

> 本 change 当前处于**提案期**：第 1–2 组由本次起草 mission 完成；第 3 组是节点 1；第 4 组起
> 在节点 1 批准后推进。未完成项保持未勾选。V1–V7 的推荐值见 `proposal.md`，获批前不得按
> 推荐值开工。

## 1. 制品（提案期）

- [x] 1.1 `proposal.md`：为什么改、改什么、不做什么；V1–V7 裁决点与推荐值；明确「方向准入
      不等于节点 1 批准」；评审 r1 修订记录
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

## 3. 节点 1（Alex 裁决，硬门禁）

- [ ] 3.1 Alex 对 V1–V7 逐条裁决（接受推荐值或改值）；若裁决改变两条告警面的存在与否、
      `history_gap` 的展示契约或部分写合同，重新送节点 1
- [ ] 3.2 按裁决更新 `proposal.md` / `design.md` 的默认值与文案，不静默改 scope
- [ ] 3.3 节点 1 通过后由 tower 立项；本组未勾前 MUST NOT 开始第 4 组

## 4. 先红（实现前先写断言并记录红灯）

- [ ] 4.1 Rust R1–R10（`design.md` §10.1）：当前写健康、`history_gap` latch（失败→成功→缺口仍在）、
      压缩轮换沿用、切 vault 不清、severity / gap 触发、首行失败按 payload 判 gap（R6a history /
      R6b annotation 两例，断言首次 payload 未被补回）、前缀写故障注入、快照 / 事件同键、
      `history_written`、新会话重置与诊断日志；在当前代码上跑出失败，红灯输出存
      `.local/acceptance/` 或 mission 证据目录
- [ ] 4.2 前端 U1–U13（§10.2）：备份写失败横幅、失败态清除、成功语义、状态行分档、
      旧快照宽容、快照重建、sticky 首次 history（含 `annotation→history`）、IPC 白名单、
      `state=ok` + gap 仍显示、切 vault 不清、sticky 关闭不等于静音、枚举失败独立保留、
      `history_written=false` 的未落盘提示；在当前代码上跑出失败
- [ ] 4.3 视觉 V1–V4（§10.3）：健康态 `hidden` 与几何、当前写失败态、`state=ok` + gap 态、
      横幅三种形态与零占位；先加结构断言（像素基线留到第 9 组人肉过目）
- [ ] 4.4 真机 A1–A6（§10.4）：新增 / 更新验收场景文件，先在当前 app 上跑出红（A7 不可达，
      场景正文如实写明边界，不造假注入）

## 5. Rust 实现

- [ ] 5.1 `harness/jsonl.rs`：`PersistenceHealth` 两维 + `history_written`（`state` / `since_ts` /
      `severity` / `detail` + `history_written` + `history_gap { present, since_ts, detail }`，
      `Serialize`）；Writer 共享
      `Arc<Mutex<_>>`；`record()` 保持 `()`；失败分类（open / serialize / first_line / write /
      partial）
- [ ] 5.2 `jsonl.rs` 首行修复：写成功后再 `take()`（或失败回填）；MUST NOT 丢挂起行；
      首行失败按本次 payload 判 gap：history payload 置 gap、annotation 不置；不承诺部分写后
      可恢复（R6a / R6b）
- [ ] 5.3 `jsonl.rs` 部分写跟踪：`LineSink` 测试 seam（生产写 `File`，测试写 N 字节后 Err）；
      可能已写字节时置 `history_gap`、`severity=history`；无法区分时按可能部分写处理（R7）
- [ ] 5.4 `harness/session.rs`：`Session` 创建并持有两维 + `history_written`；`persistence()`
      只读投影；`rotate` 沿用两维与 `history_written`；新会话 / 恢复重置；`StateSnapshot` /
      `StateSnapshot::empty` 加两维 + `history_written` 键
- [ ] 5.5 `harness/events.rs`：`persistence` 构造函数（同一份序列化 + `type`）；两维 +
      `history_written` 跃迁（含 `degraded→ok` + gap true、`history_written false→true`）都发；
      与快照同键同值单测（R8）
- [ ] 5.6 `harness.rs` / `lib.rs` / `turn.rs`：`Runtime.forward` 事件出口；`TauriEventSink`
      提升为 `pub(crate)`；装配 `ScopedSink`；隔离运行不装配 forward；轮次外写点覆盖（R8）；
      切 vault 不动健康（R4）
- [ ] 5.7 `logging.rs`：`PersistenceWriteFailed` 事件 + 字段白名单（`kind` / `code` /
      `partial` / `path`）；单测断言不含正文类字段（R9）
- [ ] 5.8 新会话 / 恢复重置：两维 + `history_written` 从空健康起算；面板动作后不再显示旧状态；
      单测（R9）
- [ ] 5.9 重导 ts-rs bindings（`LogEventName` 新变体）；`git add src/bindings/**` 后再跑 quick

## 6. Harness 面板 UI

- [ ] 6.1 `src/ipc.ts`：`HarnessEvent` 联合加 `persistence`；`isHarnessEventType` 白名单加
      分支（`harness-event-whitelist.test.ts` U8 守）
- [ ] 6.2 `src/harness-panel.ts`：composer 上方常驻状态行（复用 `lumir-hp-qc-src` /
      `lumir-hp-quote-note` / `role="status"`，零新样式）；无告警时 `hidden`
- [ ] 6.3 状态行两维优先级：`history_gap.present=true` 时显示缺口文案（`state=ok` 时明确
      「写入已恢复，但此前记录缺失」），MUST NOT 回到健康态；`state=degraded` 且无 gap 时按
      severity 显示当前失败；`history_written=false` + 告警时追加「本次会话的新记录尚未落盘，退出后
      无法恢复」，true 后该句消失（U4 / U9 / U13）
- [ ] 6.4 快照 / 事件两路解析同一份两维 + `history_written`（U4 / U6）；缺 `persistence` /
      `history_gap` / `history_written` 键按 `ok` / `present=false` / `history_written=true`（U5）；
      新旧快照都不误报
- [ ] 6.5 sticky：本逻辑会话首次进入 `history`（含 `annotation→history`）一条，按文案去重、
      重挂载不重复（U7）；sticky 可点击关闭，关闭只移除提示，不隐藏状态行、不清 gap、
      不构成静音（U11）；`HarnessPanelDeps` 新增 `stickyToast`，装配层接线到既有 sticky 浮条
- [ ] 6.6 切 vault：按 vault 重拉快照，MUST NOT 本地清除健康；切回显示该会话自身状态（U10）
- [ ] 6.7 文案：`src/copy-data.ts` + 文案 deck 同批新增 D 编号（zh / en 占位名一致）；
      缺口文案、当前失败文案、未落盘提示、sticky 文案、枚举失败文案各自独立；
      `tests/unit/copy.test.ts` 漂移门禁绿

## 7. 文档侧 UI

- [ ] 7.1 `src/save-controller.ts`：`failedPaths`（路径 → `{at, code}`）；`backupDirty`
      失败记录、成功删除；`forgetBackup` / dirty 转 clean 订阅 / `noteRenamed` 清对应项
- [ ] 7.2 两个独立子条件：写失败 `failedPaths` 与枚举失败条件；写失败清空 MUST NOT 撤下枚举
      失败，重新检查成功 MUST NOT 清写失败
- [ ] 7.3 只读查询 + 变更通知接口；装配层不自存第二份失败集合
- [ ] 7.4 `src/main.ts`：文档区顶部 sticky 横幅（全局一条；`role="status"`、无关闭按钮；
      写失败段 = 条数 + 首个路径 + 「全部保存」；枚举段 = 「无法检查残留备份」+「重新检查」；
      两段可同时在场）；`hidden` 时零占位
- [ ] 7.5 `src/tabs.ts`：受影响路径的 `aria-label` / `title` 追加「（备份失败）」后缀；
      可见像素不变；失败集合变化时触发 `renderTabs`
- [ ] 7.6 V5（若采纳）：`checkRecovery` 的 `recovery_list` 失败进入枚举失败子条件，
      带「重新检查」动作；成功只清该子条件（U12）
- [ ] 7.7 诊断：`recovery_write_failed` / `recovery_list_failed` 失败落日志（已有事件名可复用，
      不新增事件则不动 bindings）
- [ ] 7.8 前端单测 U1–U3 / U12 转绿

## 8. 验收场景与真机（本地，不进 CI）

- [ ] 8.1 新增验收场景：健康时不打扰（A1）、文档备份失败横幅（A2）、全部保存清写失败子条件
      且无枚举失败时撤下（A3）、保存失败横幅保留（A4）、枚举失败独立保留（A5）、重启后再编辑
      重现（A6）
- [ ] 8.2 场景正文写明真实失败面的构造（`envWrite` / `seed.envFiles` 在 `<env>/lumir/recovery`
      写普通文件）与「为什么这是真实可达的失败面」；A7 的不可达边界如实写在场景说明里，
      不伪造 harness 注入
- [ ] 8.3 回扫既有场景：08c / 08d 等依赖 `env:recovery` 的断言，确认新横幅不改变期望；
      文案碰撞时改断言，不改产品语义
- [ ] 8.4 `scripts/acceptance/README.md` 与 `COVERAGE.md` 同步新场景条目（契约门禁会判）
- [ ] 8.5 真机跑套件：`node scripts/acceptance/run.mjs`；证据落 `.local/acceptance/`，
      不落 worktree；FAIL 项与手感项列给 Alex
- [ ] 8.6 真机复验：`pnpm tauri dev` 起真实 app（起实例前按 AGENTS.md 处理白屏陷阱），
      用 KimiCU 走 A1–A6；桌面 vault 用 `/tmp/lumir-m102-acceptance`，真实 vault 只读

## 9. 视觉门禁

- [ ] 9.1 结构层：`tests/visual/scenes/**` 新增 V1–V4 场景；CI 的 `LUMIR_VISUAL_STRUCTURAL=1`
      路径绿
- [ ] 9.2 本地像素：`scripts/gate.sh visual` 或 `scripts/visual/run.sh` 全量绿；健康态既有
      基线零漂移
- [ ] 9.3 `degraded` / `state=ok` + gap / 横幅三形态的像素基线：截图先交 Alex 过目，批准后
      才 `--update`（基线更新是人肉裁决点）

## 10. 门禁与收尾

- [ ] 10.1 `scripts/gate.sh quick` 全绿（fmt / clippy / cargo test / bindings 漂移 /
      gen-schemas 漂移 / tsc / 单测 / perf 夹具 / acceptance 契约 / docs-check / validate）
- [ ] 10.2 `scripts/gate.sh visual` 全绿（本地；CI 绿不代表像素层没回归）
- [ ] 10.3 `bash scripts/docs-check.sh` 全绿（含归档对账、验收场景契约、backlog 出口）
- [ ] 10.4 `PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH" npx --yes
      @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 10.5 实现 PR 合并时在 `docs/backlog.md` 归档跟踪队列落**有且仅有一条**条目（tasks
      全勾后 docs-check 会强制）
- [ ] 10.6 信息卫生：对改动面做 text 级 grep 清扫（真实 vault 内容 / 人名 / 绝对路径 /
      凭据）；截图与 fixture 用合成数据；诊断日志断言不含正文
- [ ] 10.7 独立 reviewer 评审：结论 clean / merge，绑定当前 tip；P1 / P2 清零
- [ ] 10.8 节点 2 五要件齐后归档：`node scripts/openspec-archive.mjs
      add-persistence-health-status-nov23` → 提交归档结果 → `--archived` 审计 PASS

## 11. 验证（change 的验收动作）

- [ ] 11.1 Rust 单测 R1–R10 全绿；前端单测 U1–U13 全绿
- [ ] 11.2 视觉 V1–V4 结构断言全绿；本地像素层全绿
- [ ] 11.3 真机 A1–A6 PASS（A7 由 R1–R10 + 视觉桩承担并写明）
- [ ] 11.4 门禁 `quick` + `visual` 全绿；`validate --all --strict` + `docs-check` 全绿
- [ ] 11.5 证据齐：`.local/acceptance/**`、`.local/reviews/**`（评审包）、门禁日志路径；
      门禁报告照抄 `GATE RESULT` 原文行并附退出码
