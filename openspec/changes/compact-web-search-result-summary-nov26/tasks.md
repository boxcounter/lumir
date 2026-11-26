# Tasks: compact-web-search-result-summary-nov26

> 阶段门：节点 1 已批准（2026-11-26，Alex 原话「Web Search 按推荐」）。本 change 的提案批交付
> `proposal.md` / `design.md` / 本文件 / `specs/harness/spec.md`；实现批按本清单逐项勾选。
> 顺序是硬约束：**先红后绿**——1.x 的合同测试先在当前 master 代码上判红并留证，再进 2.x–5.x。
> 实现期发现 proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / 本文件 / `specs/harness/spec.md`（五条 MODIFIED
      整块复制，含批准原话与完整口径）
- [x] 0.2 Alex 节点 1 评审通过（2026-11-26，原话「Web Search 按推荐」）
- [x] 0.3 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与
      `bash scripts/docs-check.sh` 通过（含 MODIFIED delta 的归档对账）

## 1. 先红：合同测试（当前代码上判红并留证）

- [x] 1.1 Rust：`budget::search_success` 的 `result_count` / `result_text_bytes`（UTF-8、字段截断、
      结果整条移除、空结果）；`audit_metadata` 透传 / 失败 null；Web 参数摘要纯 query / URL
- [x] 1.2 前端：`parseWebAudit` / `webAuditFromEnvelope` 的两个可空读数（缺失 / 非法 → null）
- [x] 1.3 前端 DOM：单 Web 调用不出组摘要；两个真实调用 + 两个审计仍显示 2；组展开后审计仍默认
      关闭；健康摘要四形态；失败不显示条数 / 大小；旧记录降级；live 与 restored 同形；
      真实生产形状失败恢复（快照错误摘要 + web_input / JSONL 纯参数摘要 / 旧记录缺键，query 与
      fetch URL）；Fetch 重定向 A≠B 的 live / 快照 / JSONL 同形（默认行 A、详情 B）；
      secret-canary 不上屏；Ask 待决卡不变
- [x] 1.4 视觉结构（m384）：默认紧凑 + 详情默认关闭 + 展开完整 + 计数不变量
- [x] 1.5 在 master 代码上跑 1.1–1.4，把失败输出落
      `.local/missions/compact-web-search-result-summary-nov26/red/`

## 2. 后端

- [x] 2.1 `WebEnvelope` 加 `result_count: Option<u32>` / `result_text_bytes: Option<u64>`；
      ts-rs 重导出 `src/bindings/WebEnvelope.ts`
- [x] 2.2 `budget::search_success` 在全部裁剪后单一一次计算读数；非 Search / 失败保持 None
- [x] 2.3 `output::audit_metadata` 透传两个读数（缺键 → JSON null）；另投影 `input_url`（调用
      arguments 的原始 URL）与 `url`（实际提交 / 最终 `source.url`）分开，默认行用 `input_url`、
      详情用 `url`
- [x] 2.4 Web 工具参数摘要：`web_search` → 纯 query、`web_fetch` → 纯 URL；live started / 面板
      持久化 / JSONL 恢复三个调用点同源；面板工具记录另持久化完整 `web_input`（不截断），
      快照 / JSONL 恢复共用
- [x] 2.5 Rust 单测绿

## 3. 前端

- [x] 3.1 `src/byte-size.ts`：字节读数格式化单一来源，`image-viewer.ts` 的 `imageSizeText` 委托它
- [x] 3.2 `src/web-audit.ts`：审计投影加两个可空读数（缺失 / 非法 → null，不 `?? 0`）
- [x] 3.3 `src/harness-panel.ts`：Web 附属单元（健康摘要 + 默认关闭的「查看详情」），live / restored
      共用；审计单元不进 `rows`，组折叠与展开只动可见性、不改各详情展开态；恢复失败行从
      `PanelMessage.web_input` / 审计输入 / 参数摘要取 query / URL，不把失败摘要当参数；
      默认行取原始输入 URL（`input_url` / `web_input`），详情保留最终 `source.url`
- [x] 3.4 Web 失败行尾注剥状态前缀，live 与 restored 同形；非 Web 不变
- [x] 3.5 `applyLabels` 重渲附属单元（保留展开态），新增文案随语言切换
- [x] 3.6 `src/harness-panel.css`：第二行 / 详情入口样式，复用既有 token；不改普通工具行 padding；
      不新增 overflow 容器
- [x] 3.7 `src/copy-data.ts` + `文案-Copy.md`：D1030–D1033 四条双语模板与 deck 沿革（D1029 由并行 Skill 分支占用）
- [x] 3.8 前端单测（1.2–1.3）与 `tsc` 绿

## 4. 视觉结构

- [x] 4.1 更新 `tests/visual/scenes/m384-harness-approval-decided.spec.ts` 的 Web 审计结构用例：
      默认紧凑、详情默认关闭、展开完整、与普通工具行的计数不变量
- [x] 4.2 不新增像素基线；若发现既有像素基线必须变化，停下只产候选，不 `--update`

## 5. 真机场景（本轮只改期望，不执行）

- [x] 5.1 更新 869：单调用不再点组摘要；点「查看详情」后断言 provider 未解析 / attempts / untrusted，
      并保留 query 与 JSONL 断言
- [x] 5.2 更新 871 / 872：单调用不再点组摘要；错误码在默认行可见，attempts / 未解析经「查看详情」
- [x] 5.3 更新 873 / 876：两条真实调用仍折叠为 2（两审计不计入）；展开组后审计仍默认关闭，
      错误码仍在默认行
- [x] 5.4 核对 870（Ask 待决卡完整信息不变、拒绝无审计）与其它 Web 场景无过期期望

## 6. 验证与证据

- [x] 6.1 目标 Rust 测试、前端单测、视觉结构测试、根 / visual / unit tsc 绿
- [x] 6.2 `bash scripts/docs-check.sh`、`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`
      PASS
- [x] 6.3 `node scripts/acceptance/check-suite.sh 869` 等受影响场景 `--check` 通过
- [x] 6.4 绿跑输出落 `.local/missions/compact-web-search-result-summary-nov26/green/`；证据路径可 `ls`
- [x] 6.5 提交当前分支，返回精确 tip；不归档、不 push / merge，等独立评审
- [ ] 6.6 tower 在合并时落 `docs/backlog.md` 归档跟踪条目并勾选本项（backlog 当前 80 行硬上限，
      本 mission 不擅自改台账；未勾选 = change 未完成，不触发归档队列判据）
