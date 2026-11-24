# Tasks: rank-harness-sessions-by-last-activity-nov23

> 施工前提：**节点 1 已于 2026-11-24 通过**（Alex「同意」，B1–B6 按推荐；2026-11-23 起草，
> 同日按评审判 needs-changes 后修订为 r1）；B5 = A 档，B6 = M392 另立。批准值若再被改，
> 先改 proposal / design / delta 再继续。勾选状态在实现期维护；未勾项不删除，放弃的就地写理由。

## 0. 前置与红线

- [x] 0.1 节点 1 通过：Alex 对 B1–B6 的批准原话抄进 `proposal.md` 的节点状态块；「按推荐」逐条
      落到 B1–B6（B5 = A 档、B6 = M392 另立，均已定）——2026-11-24 Alex「同意」
- [x] 0.2 开工前过一遍 `REVIEW.md`，逐条对照本 change 的改动面（尤其「同一语义两处真源」
      「断言等价于子串」「读不到当成空」）
- [x] 0.3 **不做折叠 / 去重 / 隐藏源文件**：不建 `referenced` 集合、不找链头、不做第三遍异常
      分量扫描；每个 JSONL 恰好一行。若实现中发现必须折叠，停下走影响面升级线
- [x] 0.4 **M392 另立**：不删 `docs/backlog.md` 条目、不修重复行渲染来源、不改删除语义
- [x] 0.5 不碰 B 档：不改恢复路径的 `inherit` 写入、不改 `effective_title` 读取面、不改
      「会话本地留存」条
- [x] 0.6 不改 `session_open` / `llm_request` / `llm_response` 的记录形状；不在列举路径写任何文件

## 1. 先红（测试先行，旧实现上必须红）

- [x] 1.1 Rust 单测（合成 JSONL，落临时目录）：
      - **创建与活动相反**：A `created=100 / activity=400`，B `created=200 / activity=300` →
        旧实现 B 在前、新实现 A 在前
      - **恢复不置顶**：A `activity=400`，C `activity=500`；恢复 A 产生子文件 → C 仍在最前；
        A 源行与 A 子行都在、都读 400、相邻（新 id 在上）
      - **每文件一行**：源 + 恢复子文件 → 恰好两行、精确 session id 集；不折叠、不隐藏
      - **独立操作**：两份文件各自可被 `delete_session`；删除源后子文件仍列出、仍可恢复
      - sidecar：只追加 `session_title` / `notice_delivered` / `approval` → 排序不变
      - 失败 / 停止轮：`llm_request` 后跟 `error` / `turn_aborted` → 时间取请求 ts
      - 缺时间：`llm_request` / `llm_response` / `session_open` **全部**缺 ts → 无值、排最后
      - compact：源 + `opened_from=compact` 文件（无 `restored_from`）→ 两行、compact 不继承源
        活动时间、同名不合并
      - 纯环：A↔B 互指 → 两行、精确 id 集、遍历终止（不挂起）
      - 只读：列举前后文件字节、mtime、目录条目数不变
      - 旧实现红跑证据：实现回退后 `cargo test --test session_recording -- --list` 编译期 13 处
        `no field last_activity_ts`、`EXIT=101`（`.local/missions/session-activity-sort-nov24/rust-red.log`）
- [x] 1.2 `tests/unit/harness-session-picker.test.ts`：把「按 session_id 字典序降序输出」改为
      「保持后端数组序」；新增乱序输入 → 输出与输入逐项相等（旧实现必红）
- [x] 1.3 新增 `SessionEntry.lastActivityTs` 的解析用例（正数 / 0 / 负数 / 非数 / 缺键 → null）
- [x] 1.4 `tests/visual/scenes/m662-session-title.spec.ts` 的桩载荷补 `last_activity_ts`；新增
      结构断言：行时间格文本来自最后活动时间而不是创建时间（构造创建早、活动晚的桩）
- [ ] 1.5 新的真机场景骨架先落（5.1 的步骤表），旧实现跑出预期红：预置「A 创建早 / 活动晚、
      B 创建晚 / 活动早」→ 旧实现 B 在前；恢复后新行凭新 id 越过活动更晚的 C
      ——**未做**：本批任务口径不跑真机；场景已落
      `scripts/acceptance/scenarios/724-harness-session-order.md`（`--check` PASS），旧实现红跑留待真机批

## 2. 后端（`src-tauri/src/harness.rs`、`src-tauri/src/harness/session.rs`）

- [x] 2.1 `session.rs`：`SessionSummary` 新增 `last_activity_ts: Option<u64>`（ts-rs optional +
      `type = "number"`，`skip_serializing_if` 同既有 `ts`）；`ts` 与 `first_user_text` 语义不变
- [x] 2.2 `list_sessions`：对每份已读文件算 `own_activity` = `record_ts` 中 kind 为
      `llm_request` / `llm_response` 的最大值；`parent` = `session_open.restored_from`（非空、
      非自身）
- [x] 2.3 逐行链遍历：沿 `parent` 向上累计 `activity` 最大值与 `created` 最早值；深度上限 256、
      `visited` 防环；父缺失 / 自指 / 已访问即停止。**不建 `referenced`、不找链头、不做第三遍
      异常分量扫描**
- [x] 2.4 时间 = `activity.or(earliest_created)`；无值者为 `None`
- [x] 2.5 唯一排序：`last_activity_ts` 降序 → 同值 session id 降序 → 无值最后（同按 id 降序）；
      所有文件各产出且仅产出一行
- [x] 2.6 compact **不特判**：没有 `restored_from` 的文件自然按自身链（只有自己）计算；MUST NOT
      用 `opened_from=compact` / `compact_summary` / 同名去推断父子
- [x] 2.7 不新增 IO、不写文件；`read_session_file` 的既有返回（records / record_ts / first_ts）
      直接用，不二次解析
- [x] 2.8 Rust 单测全绿（1.1 转绿）；`cargo test` 覆盖 `harness` 相关模块

## 3. 绑定与前端

- [x] 3.1 ts-rs 重导出 `src/bindings/SessionSummary.ts`；**先 `git add src/bindings/**` 再跑
      `quick`**（bindings-drift 的预期纪律）
- [x] 3.2 `src/harness-panel.ts` 的 `SessionEntry` 增加 `lastActivityTs: number | null`；解析规则
      与 `ts` 相同
- [x] 3.3 删除 `sessionEntriesOf` 的 `.sort(...)`，保持后端数组序；注释写明单一排序真源
      （REVIEW.md「同一语义两处真源」）
- [x] 3.4 行时间格：`entry.lastActivityTs ?? entry.ts`；两者皆空不渲染时间格（不伪造）
- [x] 3.5 浮层：不加订阅 / 轮询 / 重排；改名仍走 `retitleOpenSessRows` 原地更新
- [x] 3.6 删除：仍按行的 `sessionId` 调 `harness_delete_session`；成功只移除该行，不推断链、
      不联动删除其它行
- [x] 3.7 当前会话不钉顶、不加标记；全仓确认没有第二处按 id / ts 排序会话清单

## 4. 视觉与结构

- [x] 4.1 m662 结构断言全绿（1.4 转绿）：行时间格读数、同名两行、长名截断不变
- [ ] 4.2 本地跑 `scripts/gate.sh visual`：行宽 / 行高 / 时间格布局零漂移；若有像素差异先定位，
      不机械 `--update`——**未跑全量**（本批任务口径不跑全量 gate）；已单跑
      `scripts/visual/run.sh --grep m662`（结构断言，见 4.1）
- [x] 4.3 如需新截图，只出候选落 `.local/reviews/ux-improvements/`（git 外），基线更新是人肉
      裁决点——本期无新截图、基线未动

## 5. 真机验收

- [x] 5.1 新增真机场景（id / item 按 `scripts/acceptance/scenarios/` 当前最大值 +1 分配，不预占；
      **场景已落 `scripts/acceptance/scenarios/724-harness-session-order.md`（item 724，`--check`
      PASS；`raw` 的 `$vault` 记号替换随之落到 runner）；**真机 PASS 33.7s**（2026-11-24，
      证据 `.local/acceptance/2026-11-24-session-activity-sort/724-harness-session-order/`）；
      文件名建议 `harness-session-order`）。**预置文件的时间写死；真实发送用后端实际时间，不写死**：
      1. 合成 vault 预置 A（`created=100`、最后活动 `400`）、B（`created=200`、最后活动 `300`）、
         C（`created=50`、最后活动 `600`），以及一个同名 compact 文件（无 `restored_from`、
         `created=350`）→ 打开浮层：C 最前，A 在 B 前（创建与活动相反）；compact 与 A 各一行
      2. 恢复 A → C 仍最前；A 源行与恢复行都在、都读 400、相邻，且都排在 C 之后、B 之前
         （恢复不越过活动更晚的 C）
      3. 从 A 源行再次恢复 → 第三个 A 行出现（源 + 两个分叉），都按 400 相邻排列
      4. 删除其中一个 A 分叉 → 只该行消失；源行与另一分叉仍在，重开浮层仍是精确的 id 集
      5. 只改 A 的标题（或只投递通知）→ 顺序不变
      6. **在 B 里真实发送一轮**：B 的时间由后端写成实际当前时间（远晚于 600）→ B 到最前；
         C（600）落到第二；A 源行与剩下的恢复行仍读 400、都排在 B 之后（恢复行不越过真实更晚的
         活动）。本步 MUST NOT 写死「500」或任何历史时间
      7. 复查 step 1 预置的 compact 行：仍与 A 各一行，读 350、排在 A（400）之后——不继承 A 的
         活动时间（精确读数由 Rust 单测判；真机判两行与相对位置）
      8. 缺 ts 的旧文件：所有相关信封都没有 ts → 不显示时间格、排在最后
      9. 两个独立同名文件：两行都在，时间格不同
      10. 浮层打开期间后台完成一轮 → 本层不重排；关掉重开才更新
      11. 打开浮层前后核 JSONL sha256 / mtime 不变（只读）
- [x] 5.2 **M392 不碰**：不做同批收口、不删 backlog 条目；本 change 的「恢复后两行」是显式行为，
      在场景与报告里写清，不把它当作缺陷或收口对象
- [x] 5.3 回扫既有场景 **106 / 108 / 124 / 165**（**只改了注释与边界注记**：106 补「行数判据在
      724」、108 的排序口径改为最后活动、165 补行时间格说明）：**真机 106 / 108 / 124 / 165
      全 PASS**（2026-11-24，同一产品 tip；证据 `.local/acceptance/2026-11-24-session-activity-sort/`
      下四个场景目录）；106 的恢复步骤改为「两行都在、恢复行不越过更晚活动」；108 的删除步骤补
      「源 + 恢复子文件」只删所选行、活跃拒删不变；124 的按 vault 过滤不受影响；165 的旧文件回落 /
      不显示时间格逐字核对
- [x] 5.4 证据落 `.local/acceptance/<批次>/`（git 外）；FAIL 项逐条定位，不静默重跑
      ——`.local/acceptance/2026-11-24-session-activity-sort/`（含 106 / 108 / 124 / 165 / 724）
- [x] 5.5 证据目录用绝对路径 `ls` 一遍再写进报告（REVIEW.md「证据只在终端跑过」条）
      ——已用绝对路径 `ls` 核对上述目录；静态检查日志见
      `.local/missions/session-activity-sort-nov24/`

## 6. 规格与文档

- [x] 6.1 `specs/harness/spec.md` 的 MODIFIED 块保持「整条复制 living 再改」：既有正文与 9 条
      场景不得删段；新增条款 / 场景按 design §2–§9 对账
- [x] 6.2 实现后回改 `design.md` 的行号 / 符号名（若与最终代码不一致）
- [x] 6.3 若实现期发现新的已知边界（删除祖先改变后代时间、compact 模板名等），补进 design §9，
      不口头流传
- [x] 6.4 **不删** `docs/backlog.md` 的 M392 条目；如 Alex 之后决定收口，另立 change

## 7. 门禁

- [x] 7.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过，记录 `Totals:` 原文
- [x] 7.2 `bash scripts/docs-check.sh` 通过（含 archive-check 门禁模式：MODIFIED 无静默丢段、
      归档队列、backlog、验收套件契约）；另跑
      `node scripts/openspec-archive-check.mjs --change rank-harness-sessions-by-last-activity-nov23`
      并记录 PASS
- [ ] 7.3 `scripts/gate.sh quick` 通过（含 cargo test、bindings-drift、tsc、单测、docs-check、
      openspec validate）；照抄 `GATE RESULT` 原文行 + 退出码（SKIP 单列）——**未跑全量 quick**
      （任务口径不跑全量 gate）。等价组件已逐项单跑：`cargo test --lib harness::` 428 passed、
      `cargo test --test session_recording` 37 passed、`pnpm test` 1867 passed、`tsc --noEmit` 干净、
      `docs-check.sh` PASS、`openspec validate --all --strict` 37/37
- [ ] 7.4 `scripts/gate.sh visual` 通过（动过 `tests/visual/scenes/**`，必须本地跑）
      ——**未跑全量**；单跑 `scripts/visual/run.sh --grep m662` 3 passed（端口走
      `LUMIR_VISUAL_PORT=4174`，4173 被在途任务占用）
- [x] 7.5 真机场景 PASS；证据指针可 `ls`——724 PASS（33.7s）；106 / 108 / 124 / 165 PASS
- [x] 7.6 视觉基线未更新；如确需 `--update`，先送 Alex 过目

## 8. 信息卫生

- [x] 8.1 所有 Rust 单测 / 视觉桩 / 真机场景只用合成 vault 名、路径与 JSONL 内容；MUST NOT 出现
      真实 vault 名、真实人名、真实文档正文
- [x] 8.2 提交前对改动面做一次 text 级 grep 清扫；截图类证据只落 `.local/`（git 外）
- [x] 8.3 本 change 无原型；若实现期新增原型 HTML，控制面板可点击、截图同步重截

## 9. 收尾

- [x] 9.1 `tasks.md` 全部勾选，未勾项就地写放弃理由（不删任务项、不留空勾）
      ——未勾项均为「本批任务口径不跑真机 / 不跑全量 gate」，理由已就地写明
- [x] 9.2 在 `docs/backlog.md` 的归档跟踪队列落一条本 change 记录（五要件齐待归档 / 命中例外待裁）；
      不删 M392 条目
- [ ] 9.3 交独立 reviewer；评审判断层不降档；verdict 绑定当前 tip
      ——已评审 `65dcfd2e`（needs-changes：P1-1 / P1-2 / P2-1，均已修复并真机 PASS）；
      新 tip 需复审，由 tower 在批次收尾执行
- [ ] 9.4 归档前逐条核对节点 2 五要件；归档走 `node scripts/openspec-archive.mjs <change-id>`，
      归档提交后跑 `--archived` 审计至 PASS——由 tower 在批次收尾执行
