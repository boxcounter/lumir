# Tasks: web-evidence-provenance-nov26

> 提案阶段只起草制品，本文件全部任务未勾选。实现期按序勾选；发现 proposal 意图需要变更时停下、
> 更新 proposal 并重走节点 1，不静默扩 scope。

## 1. 合同与数据形状

- [ ] 1.1 `src-tauri/src/harness/web/output.rs`：新增 `WebFetchMode` / `WebContentScope` /
      `WebCoverage` / `WebFetchedBy` / `WebBinding` 五个枚举（`serde(rename_all = "snake_case")` +
      `#[ts(export)]`），`WebEnvelope` 追加 `content_scope` / `coverage` / `fetched_by` / `binding` /
      `final_url` 五个 `Option` 字段（不带 `skip_serializing_if`，键恒在场）
- [ ] 1.2 `output.rs`：`WebEnvelope::base` 五字段置 `None`；`WebApprovalPayload` 追加
      `mode: Option<WebFetchMode>`
- [ ] 1.3 `output.rs::audit_metadata`：追加五个结果读数（逐字透传信封，不重算）与 `mode`
      （从 `input.mode` 投影，非法 / 缺省 → null）；保留既有 `local_precheck` / `provider_fetch`
- [ ] 1.4 重新生成 `src/bindings/**`（`cargo test` 触发 ts-rs 导出），按 AGENTS.md「bindings-drift」
      纪律先 `git add` 重导出产物；确认新增 `WebFetchMode.ts` / `WebContentScope.ts` /
      `WebCoverage.ts` / `WebFetchedBy.ts` / `WebBinding.ts` 且 `WebEnvelope.ts` 形状同步

## 2. 输入面与解析顺序

- [ ] 2.1 `src-tauri/src/harness/web/mod.rs::definitions`：`web_fetch` schema 增 `mode`
      （`enum: ["full","selected_chunks"]`，`default: "full"`）与 `query`（`minLength: 1`,
      `maxLength: 256`），`additionalProperties:false` 不变，仍不暴露 key / provider / base URL /
      超时 / 重试 / header
- [ ] 2.2 `mod.rs::basic_args`：实现 `mode` / `query` 一致性校验（`selected_chunks` 缺 query、
      `full` 带 query、query 超 256 或全空白、未知 mode → `web_args_invalid`），`BasicWebArgs::Fetch`
      携带 `mode` / `query`
- [ ] 2.3 `src-tauri/src/harness/web/provider.rs`：声明 `DEEPSEEK_FETCH_MODES = &[Full]` 与
      `DeepSeekWebProvider::fetch_modes()`；`mod.rs` 的判定只读这一处，MUST NOT 在 `config.rs` 或
      前端复制模式表
- [ ] 2.4 `mod.rs`：新增共用判定 `unsupported_mode(...) -> Option<WebEnvelope>`
      （`web_mode_unsupported`、provider / provider_id 在场、`attempts=0`、`local_precheck=false`、
      五读数 null、message 写明支持模式）
- [ ] 2.5 `mod.rs::ConfiguredWebToolPort::approval_preview`：provider 解析成功且模式不支持时返回
      `Err(failure_envelope)`（不进批准闸、不产卡）；解析失败仍走现有「未解析」预览
- [ ] 2.6 `mod.rs::ConfiguredWebToolPort::execute`：`resolve_web_provider` 成功后、构造 executor
      之前执行同一判定；`precheck` 与 deny 的既有先后顺序不动（能力检查 MUST NOT 抢在 deny 之前）
- [ ] 2.7 `web_fetch` 工具描述补三句语义：`full` 是不按查询选段的文档提取、不是「已验证完整」；
      `selected_chunks` 不支持时返回 `web_mode_unsupported` 且不降级；`truncated=true` 只表示
      Lumir 按预算裁剪

## 3. 执行与信封构造

- [ ] 3.1 `src-tauri/src/harness/web/executor.rs`：Fetch 成功路径写入
      `fetched_by=provider` / `binding=url_submitted` / `content_scope=full` / `coverage=unknown` /
      `final_url=null`；预检失败与 provider 前 deadline 用尽路径保持五读数 null
- [ ] 3.2 `provider.rs`：provider 已请求后失败的各分支写 `fetched_by=provider` /
      `binding=url_submitted`（`attempts>0`），五读数中 `content_scope` / `coverage` / `final_url`
      保持 null
- [ ] 3.3 `provider.rs` / `output.rs`：新增 `FetchProvenance` 与 `provider_full()`（生产唯一构造点）
      及 cfg 门控的 `scripted(...)` / `local_pinned(...)`；`budget::fetch_success` 接收 provenance
- [ ] 3.4 `budget.rs`：确认 `apply_truncation` 不读写五个新字段（截断与完整性是两个轴），
      30k 正文用例下 `coverage` 仍为 `unknown`
- [ ] 3.5 `provider.rs::attempt`：DeepSeek 请求 body 仍只有 `{"url": …}`，MUST NOT 因 `mode` 新增字段

## 4. 前端面板与审计

- [ ] 4.1 `src/web-audit.ts`：`WebAuditMetadata` 追加五字段与 `mode`；`parseWebAudit` 对缺键 / null
      归 null、对闭集合外的取值归 null（不猜映射），不做跨字段推导
- [ ] 4.2 `src/web-audit.ts`：`PanelWebInput` 与 `withWebPanelInput` 形状不变（`mode` / `query`
      已由审计投影承载）；确认 Fetch 选取 `query` 不被当作 Search 的默认行渲染
- [ ] 4.3 `src/harness-panel.ts`：Fetch 成功第二行证据徽标（`full`+`unknown` →
      `文档提取 · 完整性未验证`；`selected_chunks` → `相关段落`；`coverage=bounded` 追加
      ` · 完整性受限`；`truncated_fields` 含 `content` 追加 ` · 已截断`；失败 / null 不渲染）
- [ ] 4.4 `src/harness-panel.ts`：「查看详情」增 `证据形态` / `完整性` / `抓取方` / `绑定` /
      `最终 URL`（仅非 null）与 Fetch `selected_chunks` 的 `模式` / `选取查询`
- [ ] 4.5 `src/harness-panel.ts`：Fetch 外发文案改由 `fetched_by === "provider"` 判定，删除
      `local_precheck && provider_fetch` 判据（`harness-panel.ts:1080-1087`）
- [ ] 4.6 `src/harness-panel.ts`：批准预览在 `mode=selected_chunks` 时显示 query 与「query 随 URL
      一起发往 provider」说明；默认工具行仍只显示原始输入 URL
- [ ] 4.7 live 事件、快照恢复与 JSONL 恢复三条路径同形同默认态；旧留存缺字段不显示徽标 / 详情行

## 5. 文案

- [ ] 5.1 `src/copy-data.ts`：新增 `D1076`–`D1086`（徽标 2、后缀 2、行标签 5、模式 / 选取查询标签 2），
      中英两列同名占位
- [ ] 5.2 `文案-Copy.md`：同批补对应条目（`tests/unit/copy.test.ts` 的全量漂移门禁双向对账）

## 6. 单测（Rust）

- [ ] 6.1 `mod.rs` 测试：模式 / query 形状矩阵全部 `web_args_invalid`，五读数 null、`attempts=0`
- [ ] 6.2 `mod.rs` 测试：DeepSeek × `selected_chunks` → `web_mode_unsupported`，provider /
      provider_id 在场、`attempts=0`、`local_precheck=false`；注入带计数 resolver / transport 的
      executor，断言计数为 0（零连接 / 零 provider 请求的机器证据）
- [ ] 6.3 `mod.rs` 测试：`approval=ask` + `selected_chunks` 不产生批准载荷（预览返回失败信封）
- [ ] 6.4 `output.rs` 测试：五个键在成功 / 失败 / Search 下恒在场；Search 五者恒 null；序列化形状
      与「无 `site_icon`」等既有断言不回归
- [ ] 6.5 `provider_tests.rs`：DeepSeek 请求 body 只有 `url`；`fetched_by` / `binding` 在成功与
      provider 后失败两条路径的取值；provider 前失败保持 null
- [ ] 6.6 `budget.rs` 测试：30k 正文裁剪后 `truncated=true`、`truncated_fields=["content"]`、
      `coverage` 仍 `unknown`、`content_scope` 仍 `full`
- [ ] 6.7 工具描述断言：含「完整性未验证 / 不得声称页面缺少」与「不降级」语义（中文单语，见
      design §7）

## 7. 单测（前端）与验收装配

- [ ] 7.1 `tests/unit`：`parseWebAudit` 缺键 / 非法枚举 / 不推导；徽标三形态与全文案不含
      `全文` / `full page`；外发文案只由 `fetched_by` 决定；Fetch `selected_chunks` 的详情行取
      `mode` / `query`，旧记录缺键时整行不渲染
- [ ] 7.2 `web/acceptance.rs`：合成 provider 可声明 `[full, selected_chunks]` 并按脚本返回
      `content_scope` / `coverage`，只经 `LUMIR_ACCEPTANCE_WEB_ENDPOINTS` 的显式字段激活
      （`#[cfg(feature = "acceptance-web")]`）；不改 URL / DNS / redirect / 内容类型校验
- [ ] 7.3 `scripts/acceptance/web-production-check.sh`：源码层与产物层判据覆盖新注入面；新增
      「`fetched_by` / `binding` / `final_url` 的赋值点只在白名单文件内」的文本级兜底判据
      （`output.rs` 字段声明、`provider.rs` 构造漏斗、`budget.rs` 搬运；白名单外出现即红）

## 8. 真机验收场景

- [ ] 8.1 新增 `scripts/acceptance/scenarios/886-harness-web-evidence-badge.md`（item 886）：
      文档提取成功 → 徽标 `文档提取 · 完整性未验证`、详情含五字段、无「全文」字样
- [ ] 8.2 新增 `scripts/acceptance/scenarios/886b-harness-web-mode-unsupported.md`（item 886）：
      不支持的模式 → `web_mode_unsupported`、无批准卡、无徽标、`0 条结果` 类读数不出现
- [ ] 8.3 回扫既有 Web 验收场景（869 / 870 / 871 / 872 / 873 / 876）里对批准闸、外发文案、
      详情行的期望，逐条改准——本次把能力检查前移到批准与预检之前，旧期望不得残留
- [ ] 8.4 `node scripts/acceptance/coverage.mjs` 重生成 `COVERAGE.md`（新 item 一行）；更新
      `scripts/acceptance/scenarios` 对应 fixture（合成 provider 的脚本化响应）
- [ ] 8.5 真机执行 886 / 886b 与回扫后的 869–873、876，证据落 `.local/acceptance/`（不落 worktree）

## 9. 门禁与归档

- [ ] 9.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 9.2 `bash scripts/docs-check.sh` 通过（含 `openspec-archive-check` 门禁模式、链接、归档队列、
      验收场景契约与 backlog 判据）
- [ ] 9.3 `bash scripts/gate.sh quick` 全绿；改过面板后本地跑 `bash scripts/gate.sh visual`，
      像素基线变更交 Alex 裁决后更新（`tests/visual/README.md`）
- [ ] 9.4 `node scripts/acceptance/run.mjs --check` 通过
- [ ] 9.5 `docs/backlog.md` 归档跟踪队列落一条本 change 条目（tasks 全勾后由 docs-check 判据强制）
- [ ] 9.6 节点 2 五要件逐条核对并写进 `proposal.md` 的节点 2 块；独立 reviewer 结论绑定实现 tip
- [ ] 9.7 `node scripts/openspec-archive.mjs web-evidence-provenance-nov26` 归档；
      提交归档结果（归档目录 + living spec + 修链改动）
- [ ] 9.8 `node scripts/openspec-archive-check.mjs --archived web-evidence-provenance-nov26` 输出
      `PASS`；读数（归档提交 hash、包装器输出、修链处数、审计 PASS 时间）记进节点 2 块
