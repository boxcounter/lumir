# Tasks: harness-cache-metrics

> 实现期注记（M443）：本文件逐条勾选时附上证据指针与两处如实登记的偏离——① 真 provider 实测
> `cache_write_tokens` 在 Kimi Code 端点恒 0（路径已钉死、取值恒 0，见设计 §6）；② §5.2 ④
> 的「webview 重载」用「切 vault 再切回」同源通道判（套件没有触发整页重载的动作，与场景 96
> 的既有处置一致，理由写在 131 场景正文）。

## 1. 数据模型与统计口径

- [x] 1.1 `Usage`（`src-tauri/src/harness/llm.rs`）增 `cache_write_tokens: u64`；`collect_final_response`
      解析该字段（字段路径见 4.1，双路试 + 0 兜底）；`FixtureUsage` 增 `#[serde(default)] cache_write_tokens`，
      mock 构造 `Usage` 带上它
      —— 实测路径 = `input_tokens_details.cache_write_tokens`（§4.1 / §6），顶层回退保留；解析真值表
      单测 4 条（详情块 / 顶层回退 / 缺键 0 / 两路齐全取详情块）+ 真机形状 1 条
- [x] 1.2 `Session`（`src-tauri/src/harness/session.rs`）增会话累计器（Σinput / Σcached / Σwrites / samples）；
      `set_usage` 改/增为 `record_usage(&Usage, window) -> UsageSnapshot`（先累加再算读数、返回快照）；
      整体重置语义保留（新会话 / 重置 / 压缩 / 恢复清零累计）
      —— `Session::record_usage` 是唯一入口（累计 → 算读数 → 存快照 → 返回）；「整体重置」由两个既有
      节点承担：新会话 / 恢复是新建 `Session`（累计器从零），压缩是 `Session::rotate` 就地清零
      `CacheTotals`。**偏离**：未保留无消费者的 `set_usage`（REVIEW.md 第 9 条），已写进设计 §6；
      `rotate` 只清累计、不动读数快照（与既有 ctx% 行为一致，两条通道同值）
- [x] 1.3 `UsageSnapshot` 扩为 `{ctx_pct, cache_pct_session, cache_pct_turn, cache_write_tokens,
      cache_write_tokens_session, cache_note}`（旧 `cache_pct` 键退役）；新增 `CacheNote`
      枚举（`ColdStart` / `BlockDilution`，`serde(rename_all="snake_case")`）
      —— 键集合单测（新六键在场、旧 `cache_pct` 键不在、`cache_note` 缺省序列化为 null）
- [x] 1.4 成因判定（后端一处）：`cached==0`（input>0）→ `ColdStart`；否则 `(input−cached) > cached/2`
      （cached>0）→ `BlockDilution`；否则 `None`
      —— `session.rs` 的 `cache_note(&Usage)` 一处产出（前端只按值取句）；整数口径 `(input−cached)*2 > cached`
      与实数口径等价、`saturating_sub` 防异常读数下溢；真值表 8 例（含 `input==0`、稳态不误报、cached>input）
- [x] 1.5 Rust 单测 / 属性测试：累计口径 `Σcached÷Σinput`、累计边界（新逻辑会话清零）、成因真值表
      （含 `input==0` 与稳态不误报）、`UsageSnapshot` 序列化键集合、`Usage` 解析（缺键 → 0、两种嵌套路径）
      —— `session.rs::tests` 5 条（读法拆分 / 三回合累计 / rotate 后重算 / 成因真值表 / 键集合）、
      `llm.rs::tests` 5 条解析用例；`cargo test` 全绿（429 → 430 lib + 集成）

## 2. 留存与事件

- [x] 2.1 `events::usage`（`src-tauri/src/harness/events.rs`）载荷扩为 `ctx_pct` / `cache_pct_session`
      （= 会话累计，与快照同名字段同值，写进函数 doc）/ `cache_pct_turn` / `cache_write_tokens` /
      `cache_write_tokens_session` / `cache_note`（无标注 → `null`）；旧 `cache_pct` 键退役；
      事件与快照同吃一个 `UsageSnapshot`，MUST NOT 两套算法
      —— 签名改为 `usage(&UsageSnapshot)`（一个来源喂两边）；集成测试断言事件与快照的
      `cache_pct_session` / `cache_pct_turn` 同值、事件载荷无 `cache_pct` 键
- [x] 2.2 `llm_response` 留存 payload 的 usage 块（`src-tauri/src/harness/turn.rs:645-651`）加
      `cache_write_tokens`；`turn.rs:363-368` 的读数改走 `record_usage`，`turn.rs:392-398` 的
      `set_usage` + `emit` 两处一并改准（同点、同源）
      —— 读数入口收在 `with_session` 内（`usage_snapshot = Some(s.record_usage(&usage, window))`），
      事件在其后用同一个返回值发出；留存恒带该键（不提供时 0）
- [x] 2.3 集成测试（`src-tauri/tests/harness_runtime.rs`）：多轮 fixture 后 `cache_pct_session` = 累计值、
      `cache_pct_turn` = 单回合值；既有 `:360-363` 断言按新字段改准；`llm_response.usage.cache_write_tokens` 落盘
      —— 既有断言改准（1300/2300 = 56.5% vs 1000/1400 = 71.4%，并断言两者分得开）+ 新增两条用例：
      `cache_write_tokens_flows_to_retention_event_and_snapshot`（60400 全链路 + BlockDilution）、
      `session_cache_reading_restarts_after_auto_compact`（压缩后累计重新起算：10% 而不是 97.6%）

## 3. 面板与文案

- [x] 3.1 `src/harness-panel.ts` 状态位：`lastCache`（语义 = 会话累计）、新增 `lastCacheTurn` /
      `lastCacheNote` / `lastCacheWrite` / `lastCacheWriteSession`；事件入口（`:4283-4290`）读新键，
      `cache_pct_session` 缺键 → `null`（回落单读数），新键缺省 → 对应气泡行不渲染（不伪造）
- [x] 3.2 `applyUsage`（`:3123-3140`）：控制行 D334 形态不变、`{cache}` = `cache_pct_session`；
      越线高亮（`usageOverWarn`）与单读数回落口径 MUST NOT 变
      —— 未改逻辑（只改注释说清口径）；事件入口与快照恢复走同一个 `usageReadings` 映射
      （键名与缺省口径一处，REVIEW.md 第 8 条），都经 `applyUsageReadings` 落状态
- [x] 3.3 `buildCtxPop`（`:3145-3154`）：D395 不变；D401 改形为「缓存命中率（会话累计）：{cache}%」；
      新增「本回合缓存命中：{turn}%」行（带 `cache_note` 成因句，`None` 时只出前半句）；新增「缓存写入：
      本回合 {w} · 本会话累计 {ws}」行（判定键 `cache_write_tokens` 为 0 则整行不渲染）；D335 越线行不变
      —— 行序 D395 → D401 → D452(+D453/D454) → D455 → D335；写法见 3.3 的判定键说明
      （写入为 0 **或**会话累计键缺失才不渲染——不拿本回合值冒充累计值）
- [x] 3.4 `restoreSnapshot`（`:4532-4540`）：从 `state.usage` 读 `cache_pct_session` 等新键；旧快照缺新键
      → 回落单读数、气泡缺行，MUST NOT 伪造
      —— 走 `usageReadings` + `applyUsageReadings`（与事件路径同一份）；旧快照只有退役的 `cache_pct`
      ⇒ 读到 null ⇒ 回落单读数（单测断言退役键不被复用）
- [x] 3.5 文案（`src/copy-data.ts` + `文案-Copy.md`）：D334 注释改准（cache = 会话累计）、D401 改形、
      新增两个 D-code（成因句 ×2 / 缓存写入行）；zh/en 双档，同步 copy drift 测试
      —— 实际取 **D452–D455 四条**（本回合行 / 冷启动句 / 摊薄句 / 缓存写入行）：D452 是本回合行模板、
      D453/D454 是两句成因句、D455 是写入行，共四条（任务里写的「两个 D-code」只数了成因句与写入行，
      漏了本回合行自身的模板——design §5.2 第 3 行明确要求该行）；D334/D335/D395/D401 编号沿用改形，
      deck 尾段补 M443 条目；`tests/unit/copy.test.ts` 的 deck ↔ 表漂移门禁全绿

## 4. 真机核实

- [x] 4.1 按 `src-tauri/tests/harness_real_deepseek.rs` 先例写真 provider 冒烟（`#[ignore]`、从
      `~/.config/lumir/config.json` 原地读 key、无 key 自动 SKIP、key 绝不打印），打印脱敏的真响应 usage
      键形状，钉死 `cache_write_tokens` 的嵌套路径（`input_tokens_details` 内 or 顶层），据此定/修 1.1 的解析
      并回写 design §6 与代码注释；deepseek 无该字段 → 恒 0
      —— 新文件 `src-tauri/tests/harness_real_kimi_cache.rs`（`#[ignore]`，一次跑通）：**路径 =
      `usage.input_tokens_details.cache_write_tokens`**（顶层不存在）；**取值在该端点恒 0**
      （`api.kimi.com/coding/v1` + `k3-256k`；`cached_tokens` 照常工作——重发同前缀 1024 → 2641 全命中，
      同一请求发两次的第二次 `cached=2659=input` 证明解析层带得出非零缓存命中）。design §6 已改写为
      实测结论；`llm.rs::collect_final_response` 的注释标了实测出处

## 5. 验收与测试

- [x] 5.1 更新验收场景 `scripts/acceptance/scenarios/76-harness-usage.md`：控制行仍 `50% · 50%`
      （单回合 == 累计）但口径文本改准；fixture 判别据更新
      —— 控制行断言不变；补一步 hover 判「缓存命中率（会话累计）：50%」+ 本回合行 + 零值写入行不渲染；
      JSONL 断言补 `cache_write_tokens:0`；正文口径段与改形沿革段改准
- [x] 5.2 mock fixture 增 `cache_write_tokens`；新增验收场景（fixture 全合成）：
      ① 两轮（首轮 `cached==0` + 次轮高命中）→ 控制行显示累计值、气泡出现 `ColdStart` 成因句；
      ② 大块摊薄（新增 > 已缓存/2）→ 控制行仍是累计值、气泡出现 `BlockDilution` 句；
      ③ 缓存写入行出现 + 留存 `llm_response.usage.cache_write_tokens` 在场；缺失字段的 fixture → 该行不渲染；
      ④ webview 重载后控制行累计读数仍在（真源在 Rust 侧）
      —— ① + ④ 合并在 `131-harness-cache-session`（两轮 65536/65536：累计 0% → 46%、单回合 92%，
      再加切 vault 往返判读数来自 core 快照）；② 在 `132-harness-cache-dilution`（12786/6400 =
      M438 实测形状）；③ 在 `133-harness-cache-write`（16000 → 0 两轮 + 留存两值）；三份 fixture
      `harness-mock-cache-{two,dilution,write}.json` 全合成。**偏离（④）**：套件没有触发前端整页重载的
      动作，改用「切 vault 再切回」这条同源通道（同一个 `restoreSnapshot`）——处置与场景 96 一致，
      理由写进 131 的正文与覆盖边界
- [ ] 5.3 `bash scripts/gate.sh quick` 全绿；若动过视觉场景 → `bash scripts/gate.sh visual` 全绿、既有基线
      零漂移、气泡新增两行经 Alex 过目
      —— quick 见 §6.2；视觉：m347 新增一条**元素像素基线**（`m347-ctxpop-cache-metrics-chromium-darwin.png`，
      首跑由 playwright 写入，非 `--update` 覆盖既有基线），既有基线零漂移（全量 654 条通过，唯一失败是
      该新基线「不存在、写 actual」）；截图已复制到主仓
      `test-results/alex-review-2026-10-11/m443/01-气泡四行-越线态-基线候选.png` 报 tower 呈 Alex 过目

## 6. 验证

- [x] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
      —— `GATE PASS openspec-validate`（gate.sh quick / visual 两次全绿）
- [ ] 6.2 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码，SKIP 单列）
      —— 收尾复跑后在 mission 报告里照抄原文行（首次跑出 1 FAIL = `cargo clippy` 的 `unused_mut` /
      `filter_next` 两条，已修；重跑见报告）
- [ ] 6.3 动过视觉面 → `bash scripts/gate.sh visual` 全绿；气泡新增行的基线经 Alex 过目后 `--update`
      —— 全绿读数与基线截图路径见 5.3；「Alex 过目」是外部裁决点，已把截图交 tower
- [x] 6.4 信息卫生：改动面一次 text 级 grep 清扫（fixture 数值与截图全合成，无真实留存内容）
      —— 改动面 37 个文件 grep 无真实 vault 内容 / 无本机路径 / 无凭据；三份 fixture 与三份场景
      全部合成（`harness-note.md` / `lumir-m102-acceptance` / 纯数值 usage）
- [x] 6.5 归档前逐条对账：tasks / spec 增量（MODIFIED ×2）/ 实现三者一致；确认 wire 请求体与留存结构
      （除 usage 加一字段）逐字节未变
      —— wire 侧零改动（`llm.rs` 的请求体构造一行未动，diff 里 `body` 段无变化）；留存结构除
      `llm_response.usage` 加 `cache_write_tokens` 外未动；spec 增量的两条 MODIFIED（上下文用量显示 /
      会话本地留存）与本文件逐条对应
