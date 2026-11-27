# Tasks: web-evidence-provenance-nov26

> 实现已完成，本文件按实际证据勾选；未勾项（真机、归档）就地注明未执行原因。发现 proposal 意图
> 需要变更时停下、更新 proposal 并重走节点 1，不静默扩 scope。
> r1 / r2：提案期按 needs-changes 收口；r3：机械核验（P1 socket 证据、P2 场景与 spec 截断、
> P3 文档与静态防线）逐项修复。

## 1. 合同与数据形状

- [x] 1.1 `src-tauri/src/harness/web/output.rs`：新增 `WebFetchMode` / `WebContentScope` /
      `WebCoverage` / `WebFetchedBy` / `WebBinding` 五个枚举（`serde(rename_all = "snake_case")` +
      `#[ts(export)]`），`WebEnvelope` 追加 `content_scope` / `coverage` / `fetched_by` / `binding` /
      `final_url` 五个 `Option` 字段（不带 `skip_serializing_if`，键恒在场）
- [x] 1.2 `output.rs`：`WebEnvelope::base` 五字段置 `None`；`WebApprovalPayload` 追加
      `mode: Option<WebFetchMode>`；`PanelWebInput` 追加可选 `mode`，Fetch 分支持久化选取
      `query`（不再固定 `None`），Search 分支行为不变
- [x] 1.3 `output.rs::audit_metadata`：追加五个结果读数（逐字透传信封，不重算）与 `mode`
      （从 `input.mode` 投影，非法 / 缺省 → null）；保留既有 `local_precheck` / `provider_fetch`
- [x] 1.4 重新生成 `src/bindings/**`（`cargo test` 触发 ts-rs 导出），先 `git add` 再跑门禁；
      核对清单：新增 `WebFetchMode.ts` / `WebContentScope.ts` / `WebCoverage.ts` /
      `WebFetchedBy.ts` / `WebBinding.ts`；变更 `WebEnvelope.ts`、`WebErrorCode.ts`
      （`web_mode_unsupported`）、`WebApprovalPayload.ts`（`mode`）、`PanelWebInput.ts`
      （`mode` + Fetch `query`）

## 2. 输入面、内部请求与解析顺序

- [x] 2.1 `src-tauri/src/harness/web/mod.rs::definitions`：`web_fetch` schema 增 `mode`
      （`enum: ["full","selected_chunks"]`，`default: "full"`）与 `query`（`minLength: 1`,
      `maxLength: 256`），`additionalProperties:false` 不变，仍不暴露 key / provider / base URL /
      超时 / 重试 / header
- [x] 2.2 `mod.rs::basic_args`：实现 `mode` / `query` 一致性校验（`selected_chunks` 缺 query、
      `full` 带 query、query 超 256 或全空白、未知 mode → `web_args_invalid`），`BasicWebArgs::Fetch`
      携带 `mode` / `query`
- [x] 2.3 `provider.rs::WebProviderRequest::Fetch` 增 `mode` / `query`（内部请求，不是 wire 字段）；
      测试 provider 消费 `query` 并记录，生产 DeepSeek 的请求 JSON 仍只有 `{"url": …}`
- [x] 2.4 `provider.rs` / `executor.rs`：适配器暴露 `fetch_modes()` 与 `identity()`；生产 DeepSeek
      恒 `[full]`，`WebExecutor` 透传；测试 provider 的能力覆盖只在 `acceptance-web` 装配里生效
- [x] 2.5 `mod.rs`：新增共用判定 `unsupported_mode(mode, adapter) -> Option<WebEnvelope>`
      （`web_mode_unsupported`、适配器身份、`attempts=0`、`local_precheck=false`、五读数 null、
      message 写明支持模式）
- [x] 2.6 `mod.rs::ConfiguredWebToolPort::approval_preview`：解析成功且模式不支持时返回
      `Err(failure_envelope)`（不进批准闸、不产卡）；解析失败仍走现有「未解析」预览
- [x] 2.7 `mod.rs::ConfiguredWebToolPort::execute`：把能力检查提到**注入 executor 提前返回之前**——
      先取当前活跃适配器的身份与能力（注入取 executor，生产取解析结果 + 适配器常量），再检查，
      最后分派；`precheck` 与 deny 的既有先后顺序不动（能力检查 MUST NOT 抢在 deny 之前）
- [x] 2.8 `web_fetch` 工具描述补三句语义：`full` 是不按查询选段的文档提取、不是「已验证完整」；
      `selected_chunks` 不支持时返回 `web_mode_unsupported` 且不降级；`truncated=true` 只表示
      Lumir 按预算裁剪

## 3. 执行与信封构造

- [x] 3.1 `provider.rs::execute_until` 收口处单一收口：仅 Fetch；`ok` 且信封已有 provenance
      （测试 provider 的 `scripted`）→ **保留、不覆盖**；`ok` 且无 provenance（生产 DeepSeek）→
      补 `provider_full()`；`!ok && attempts>0` → `provider_attempted()`；其余 → 五字段 null；
      Search 恒 null
- [x] 3.2 取消覆盖分支（`execute_until` 内 `aborted()` 替换错误码）保留原 `attempts`，因此仍走
      `provider_attempted()`；补一测证明取消不会把 `fetched_by` / `binding` 清空
- [x] 3.3 `FetchProvenance` 的构造器：`provider_full()` / `provider_attempted()` 生产可用；
      `scripted(scope, coverage)` 仅 `cfg(any(test, feature = "acceptance-web"))`，由测试 provider
      在成功信封上写入（`budget::fetch_success` 之后），MUST NOT 被收口覆盖；MUST NOT 新增
      `local_pinned()` 一类无消费者的构造函数
- [x] 3.4 `budget.rs`：`fetch_success` 不接收 provenance；`apply_truncation` 不读写五个新字段
      （30k 正文用例下 `coverage` 仍 `unknown`）
- [x] 3.5 `executor.rs`：成功与预检失败路径只负责 `local_precheck`，不写 provenance；provider 前
      deadline 用尽路径保持五字段 null

## 4. 前端面板与审计

- [x] 4.1 `src/web-audit.ts`：`WebAuditMetadata` 追加五字段与 `mode`；`parseWebAudit` 对缺键 / null
      归 null、对闭集合外的取值归 null（不猜映射），不做跨字段推导
- [x] 4.2 `src/web-audit.ts`：`PanelWebInput` 追加 `mode`；`withWebPanelInput` 对 `query` / `url` /
      `input_url` / `mode` 各自只补空缺、不覆盖审计事实；`webInputText` 改按 operation 分支
      （Fetch 恒取 `url`，Search 取 `query`）——否则 Fetch 的选取 query 会顶掉默认行 URL；
      旧记录缺键安全降级
- [x] 4.3 `src/harness-panel.ts`：Fetch 成功第二行证据徽标（`full`+`unknown` →
      `文档提取 · 完整性未验证`；`selected_chunks` → `相关段落`；`coverage=bounded` 追加
      ` · 完整性受限`；`truncated_fields` 含 `content` 追加 ` · 已截断`；失败 / null 不渲染）
- [x] 4.4 `src/harness-panel.ts`：「查看详情」增 `证据形态` / `完整性` / `抓取方` / `绑定` /
      `最终 URL`（仅非 null）与 Fetch `selected_chunks` 的 `模式` / `选取查询`
- [x] 4.5 `src/harness-panel.ts`：Fetch 外发文案改由 `fetched_by === "provider"` 判定，删除
      `local_precheck && provider_fetch` 判据（`harness-panel.ts:1080-1087`）
- [x] 4.6 `src/harness-panel.ts::parseWebApprovalPreview`：接受并保留 `mode`（现状会丢弃未知字段），
      预览在 `mode=selected_chunks` 时显示 query 与「query 随 URL 一起发往 provider」说明；
      默认工具行仍只显示原始输入 URL
- [x] 4.7 live 事件、快照恢复与 JSONL 恢复三条路径同形同默认态；旧留存缺字段不显示徽标 / 详情行

## 5. 文案

- [x] 5.1 `src/copy-data.ts`：新增 `D1076`–`D1087`（徽标 2、后缀 2、行标签 7、选取查询外发说明 1），
      中英两列同名占位
- [x] 5.2 `文案-Copy.md`：同批补对应条目（`tests/unit/copy.test.ts` 的全量漂移门禁双向对账）

## 6. 单测（Rust）

- [x] 6.1 `mod.rs`：模式 / query 形状矩阵全部 `web_args_invalid`，五读数 null、`attempts=0`
- [x] 6.2 `mod.rs`：DeepSeek × `selected_chunks` → `web_mode_unsupported`，适配器身份在场、
      `attempts=0`、`local_precheck=false`；注入带计数 resolver / transport 的 executor，断言计数为 0
      （零连接 / 零 provider 请求的机器证据）
- [x] 6.3 `mod.rs`：错误优先级四连——deny + 不支持 → `permission_denied`；静态非法 URL + 不支持 →
      `web_url_blocked` / `web_args_invalid`；未配置 + 不支持 → `web_provider_unconfigured`；
      已解析 + 不支持 + Ask → `web_mode_unsupported` 且 `approval_preview` 返回 Err（无卡）
- [x] 6.4 `provider_tests.rs`：失败真值表**逐行**各一测——① 参数 / deny / 未配置 / 不支持 →
      五字段 null、`local_precheck=false`；② 预检失败 → `local_precheck=true`、抓取字段 null、
      `attempts=0`；③ provider 前 deadline 用尽 → 同上；④ provider 已请求后失败 →
      `fetched_by=provider` / `binding=url_submitted` / `attempts>0`、其余 null；⑤ 成功 →
      `full` / `unknown` / null
- [x] 6.5 `provider_tests.rs`：取消覆盖分支——provider 已 attempt 后取消，`attempts>0` 保持、
      `fetched_by=provider` / `binding=url_submitted` 不被清空
- [x] 6.6 `provider_tests.rs` / `output.rs`：Search 成功与 provider 后失败五字段恒 null；
      五个键在成功 / 失败下恒在场
- [x] 6.7 `provider_tests.rs`：DeepSeek 请求 body 只有 `url`（MUST NOT 因 mode 扩字段）
- [x] 6.8 `budget.rs`：30k 正文裁剪后 `truncated=true`、`truncated_fields=["content"]`、
      `coverage` 仍 `unknown`、`content_scope` 仍 `full`
- [x] 6.9 工具描述断言：含「完整性未验证 / 不得声称页面缺少」与「不降级」语义（中文单语，见
      design §7）

## 7. 前端单测与验收装配

- [x] 7.1 `tests/unit` 消费者功效四项：`fetched_by=local` 不渲染 provider 外发文案；
      `binding=address_pinned` + 非空 `final_url` 在详情可见；闭集合外取值归 null 且不渲染；
      `coverage=bounded` 出现 ` · 完整性受限`
- [x] 7.2 `tests/unit`：`parseWebAudit` 缺键 / 非法枚举 / 不推导；`parseWebApprovalPreview` 保留
      `mode`；`PanelWebInput` 持久化 mode + Fetch query；`withWebPanelInput` 只补空缺；
      `webInputText` 对 Fetch 恒返回原始 URL（选取 query 不顶默认行）
- [x] 7.3 `tests/unit`（DOM 断言）：支持 `selected_chunks` 的 Ask 预览同时显示**完整原始 URL**、
      选取 `query` 与「query 随 URL 一起发往 provider」的外发说明；同一调用批准后，默认工具行仍只
      显示原始 URL（query 不顶默认行）
- [x] 7.4 `tests/unit` + `web_acceptance.rs`：同一 `selected_chunks` 记录的 live / 快照 / JSONL
      三路径逐字段同形——集成测试**真 resume** 后断言 `web_input.mode` / 选取 `query`；DOM 断言
      详情行的模式 / 选取查询，并断言旧成功记录（缺五字段）无徽标、无证据行
- [x] 7.5 `src-tauri/tests/web_acceptance.rs`（`--features acceptance-web`）：`selected_chunks` +
      `bounded` 成功端到端——测试 provider 声明 `[full, selected_chunks]` 并脚本化返回；真实 socket
      记录断言**测试专用请求头**（`X-Lumir-Test-Fetch-Mode` / `-Query`）携带 mode 与选取 query，
      body 仍只有 `url`；覆盖 `allow_all` 与 `ask` → 批准 → 执行两条路径
- [x] 7.6 `web_acceptance.rs` / 生产反向断言：生产 wire 不含测试头、body 没有 `mode` / `query`
      字段（与 7.5 的 header 记录对照；测试头字符串不进生产 rlib）
- [x] 7.7 `web/acceptance.rs`：合成 provider 经 `LUMIR_ACCEPTANCE_WEB_ENDPOINTS` 显式字段激活
      （`#[cfg(feature = "acceptance-web")]`），能力覆盖 `[full, selected_chunks]`；不改 URL / DNS /
      redirect / 内容类型校验
- [x] 7.8 `scripts/acceptance/web-production-check.sh`：源码层与产物层判据覆盖新注入面；新增
      五字段赋值点白名单判据（`output.rs` 字段声明、`provider.rs` 构造漏斗）与
      `FetchProvenance {` 结构体字面量白名单；白名单外出现即红

## 8. 真机验收场景

- [x] 8.1 新增 `scripts/acceptance/scenarios/886-harness-web-mode-unsupported.md`（item 886）：
      验收 vault 配置假 key 的 DeepSeek 条目 + `approval=ask` + `mode=selected_chunks` → 解析成功、
      能力检查在任何网络动作前失败 → `web_mode_unsupported`；「无批准卡」由 Ask 下 done 标记仍能
      到达语言无关地证明；JSONL 断言 `attempts=0` / `local_precheck=false`；无徽标、无条数读数
- [x] 8.2 新增 `scripts/acceptance/scenarios/886b-harness-web-no-fabricated-evidence.md`（item 886）：
      未配置 provider + `mode=full` → 错误、无证据徽标、五个字段不伪造
- [x] 8.3 覆盖边界写进证据：GUI 生产装配无法产出成功 Fetch，`selected_chunks+bounded` 成功链与
      `full+unknown` 徽标成功形态由 7.3 / 7.4 + TS DOM 单测覆盖，**MUST NOT 记成「真机已验」**
      （REVIEW.md「覆盖声明超出真实验证」条）
- [x] 8.4 回扫既有 Web 验收场景（869 / 870 / 871 / 872 / 873 / 876）里对批准闸、外发文案、
      详情行的期望，逐条改准——本次把能力检查前移到批准与预检之前，旧期望不得残留
- [x] 8.5 `node scripts/acceptance/coverage.mjs` 重生成 `COVERAGE.md`（新 item 一行）；更新
      `scripts/acceptance/scenarios` 对应 fixture（`selected_chunks` 调用与假 key 配置）
- [x] 8.6 真机执行 886 / 886b 与回扫后的 869–873、876：r1 8 场景 7 PASS / 1 FAIL（886 因 mock 文案
      「用相关段落模式」误命中负断言 `not: "相关段落"`；886b PASS），收窄为实际徽标 `相关段落 ·`
      后 r2 复跑 **886 PASS 14 断言**。证据 `.local/acceptance/2026-11-27-web-evidence-provenance/`
      （r1，含 869/870/871/872/873/876 与 886b）与 `.local/acceptance/2026-11-27-web-evidence-provenance-r2/`
      （886 复跑）。覆盖边界：成功 Fetch 形态仍由 `web_acceptance` + TS DOM 承担，MUST NOT 记成真机已验

## 9. 门禁与归档

- [x] 9.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 9.2 `bash scripts/docs-check.sh` 通过（含 `openspec-archive-check` 门禁模式、链接、归档队列、
      验收场景契约与 backlog 判据）
- [x] 9.3 `bash scripts/gate.sh quick` 全绿（13/13 PASS）；已跑目标视觉场景
      `m384-harness-approval-decided`（18/18），未更新任何基线
- [x] 9.3b 完整 `bash scripts/gate.sh visual` 终态证据：`bcc0faa2` 上
      `GATE RESULT: 15/15 PASS（SKIP 0）` exit 0（主会话读数）；其后仅 Ask 单测与 886 断言两处
      test-only 变化，无产品代码与视觉基线改动
- [x] 9.4 `node scripts/acceptance/run.mjs --check` 通过
- [x] 9.5 `docs/backlog.md` 归档跟踪队列落一条本 change 条目（同批压缩一个多余空行以守住 80 行硬上限）
- [x] 9.6 节点 2 五要件逐条核对并写进 `proposal.md` 的节点 2 块；独立 reviewer 结论绑定实现 tip `21b6da72`（rebase 后同内容 `9cb6200a`）
- [x] 9.7 `node scripts/openspec-archive.mjs web-evidence-provenance-nov26` 归档；
      提交归档结果（归档目录 + living spec + 修链改动）
- [x] 9.8 `node scripts/openspec-archive-check.mjs --archived web-evidence-provenance-nov26` 输出
      `PASS`；读数（归档提交 hash、包装器输出、修链处数、审计 PASS 时间）记进节点 2 块
