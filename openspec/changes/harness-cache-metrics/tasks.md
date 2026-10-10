# Tasks: harness-cache-metrics

## 1. 数据模型与统计口径

- [ ] 1.1 `Usage`（`src-tauri/src/harness/llm.rs`）增 `cache_write_tokens: u64`；`collect_final_response`
      解析该字段（字段路径见 4.1，双路试 + 0 兜底）；`FixtureUsage` 增 `#[serde(default)] cache_write_tokens`，
      mock 构造 `Usage` 带上它
- [ ] 1.2 `Session`（`src-tauri/src/harness/session.rs`）增会话累计器（Σinput / Σcached / Σwrites / samples）；
      `set_usage` 改/增为 `record_usage(&Usage, window) -> UsageSnapshot`（先累加再算读数、返回快照）；
      整体重置语义保留（新会话 / 重置 / 压缩 / 恢复清零累计）
- [ ] 1.3 `UsageSnapshot` 扩为 `{ctx_pct, cache_pct_session, cache_pct_turn, cache_write_tokens,
      cache_write_tokens_session, cache_note}`（旧 `cache_pct` 键退役）；新增 `CacheNote`
      枚举（`ColdStart` / `BlockDilution`，`serde(rename_all="snake_case")`）
- [ ] 1.4 成因判定（后端一处）：`cached==0`（input>0）→ `ColdStart`；否则 `(input−cached) > cached/2`
      （cached>0）→ `BlockDilution`；否则 `None`
- [ ] 1.5 Rust 单测 / 属性测试：累计口径 `Σcached÷Σinput`、累计边界（新逻辑会话清零）、成因真值表
      （含 `input==0` 与稳态不误报）、`UsageSnapshot` 序列化键集合、`Usage` 解析（缺键 → 0、两种嵌套路径）

## 2. 留存与事件

- [ ] 2.1 `events::usage`（`src-tauri/src/harness/events.rs`）载荷扩为 `ctx_pct` / `cache_pct`
      （= 会话累计，口径改准并写进函数 doc）/ `cache_pct_turn` / `cache_write_tokens` /
      `cache_write_tokens_session` / `cache_note`（无标注 → `null`）；事件与快照同吃一个 `UsageSnapshot`，
      MUST NOT 两套算法
- [ ] 2.2 `llm_response` 留存 payload 的 usage 块（`src-tauri/src/harness/turn.rs:645-651`）加
      `cache_write_tokens`；`turn.rs:363-368` 的读数改走 `record_usage`，`turn.rs:392-398` 的
      `set_usage` + `emit` 两处一并改准（同点、同源）
- [ ] 2.3 集成测试（`src-tauri/tests/harness_runtime.rs`）：多轮 fixture 后 `cache_pct_session` = 累计值、
      `cache_pct_turn` = 单回合值；既有 `:360-363` 断言按新字段改准；`llm_response.usage.cache_write_tokens` 落盘

## 3. 面板与文案

- [ ] 3.1 `src/harness-panel.ts` 状态位：`lastCache`（语义 = 会话累计）、新增 `lastCacheTurn` /
      `lastCacheNote` / `lastCacheWrite` / `lastCacheWriteSession`；事件入口（`:4283-4290`）读新键，
      `cache_pct` 缺键 → `null`（回落单读数），新键缺省 → 对应气泡行不渲染（不伪造）
- [ ] 3.2 `applyUsage`（`:3123-3140`）：控制行 D334 形态不变、`{cache}` = `cache_pct_session`；
      越线高亮（`usageOverWarn`）与单读数回落口径 MUST NOT 变
- [ ] 3.3 `buildCtxPop`（`:3145-3154`）：D395 不变；D401 改形为「缓存命中率（会话累计）：{cache}%」；
      新增「本回合缓存命中：{turn}%」行（带 `cache_note` 成因句，`None` 时只出前半句）；新增「缓存写入：
      本回合 {w} · 本会话累计 {ws}」行（缺失且为零则整行不渲染）；D335 越线行不变
- [ ] 3.4 `restoreSnapshot`（`:4532-4540`）：从 `state.usage` 读 `cache_pct_session` 等新键；旧快照缺新键
      → 回落单读数、气泡缺行，MUST NOT 伪造
- [ ] 3.5 文案（`src/copy-data.ts` + `文案-Copy.md`）：D334 注释改准（cache = 会话累计）、D401 改形、
      新增两个 D-code（成因句 ×2 / 缓存写入行）；zh/en 双档，同步 copy drift 测试

## 4. 真机核实

- [ ] 4.1 按 `src-tauri/tests/harness_real_deepseek.rs` 先例写真 provider 冒烟（`#[ignore]`、从
      `~/.config/lumir/config.json` 原地读 key、无 key 自动 SKIP、key 绝不打印），打印脱敏的真响应 usage
      键形状，钉死 `cache_write_tokens` 的嵌套路径（`input_tokens_details` 内 or 顶层），据此定/修 1.1 的解析
      并回写 design §6 与代码注释；deepseek 无该字段 → 恒 0

## 5. 验收与测试

- [ ] 5.1 更新验收场景 `scripts/acceptance/scenarios/76-harness-usage.md`：控制行仍 `50% · 50%`
      （单回合 == 累计）但口径文本改准；fixture 判别据更新
- [ ] 5.2 mock fixture 增 `cache_write_tokens`；新增验收场景（fixture 全合成）：
      ① 两轮（首轮 `cached==0` + 次轮高命中）→ 控制行显示累计值、气泡出现 `ColdStart` 成因句；
      ② 大块摊薄（新增 > 已缓存/2）→ 控制行仍是累计值、气泡出现 `BlockDilution` 句；
      ③ 缓存写入行出现 + 留存 `llm_response.usage.cache_write_tokens` 在场；缺失字段的 fixture → 该行不渲染；
      ④ webview 重载后控制行累计读数仍在（真源在 Rust 侧）
- [ ] 5.3 `bash scripts/gate.sh quick` 全绿；若动过视觉场景 → `bash scripts/gate.sh visual` 全绿、既有基线
      零漂移、气泡新增两行经 Alex 过目

## 6. 验证

- [ ] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 6.2 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码，SKIP 单列）
- [ ] 6.3 动过视觉面 → `bash scripts/gate.sh visual` 全绿；气泡新增行的基线经 Alex 过目后 `--update`
- [ ] 6.4 信息卫生：改动面一次 text 级 grep 清扫（fixture 数值与截图全合成，无真实留存内容）
- [ ] 6.5 归档前逐条对账：tasks / spec 增量（MODIFIED ×2）/ 实现三者一致；确认 wire 请求体与留存结构
      （除 usage 加一字段）逐字节未变
