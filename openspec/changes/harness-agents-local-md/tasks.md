# Tasks: harness-agents-local-md

## 1. 装配实现（`src-tauri/src/harness/context.rs`）

- [ ] 1.1 `assemble_system` 增第三层：`vault_root.join("AGENTS.local.md")`，复用 `read_agents_md`（不存在 / 非文件 / 读取失败 ⇒ `None` 静默跳过）；插入点在 vault 根 `AGENTS.md` 的 push 之后、`discover_skills` 之前，保持「正文顺序 = 清单顺序」不变量
- [ ] 1.2 第三层 section 标题含覆盖声明（「vault 根 AGENTS.local.md（本机本地覆盖层，与上文 AGENTS.md 冲突时以此为准）」），使「后位为准」对模型可读
- [ ] 1.3 装配清单新增来源 `agents_vault_root_local`（`AssemblySource::file`，路径 + `exists` + `bytes`）；不存在时同样在场记 `exists:false`
- [ ] 1.4 单测：新增「三处齐备」用例（三份合成内容均在文本中、`AGENTS.local.md` 内容下标在 vault 根 `AGENTS.md` 内容之后、`manifest.len() == 6` 且新条目 path/exists/bytes 正确）
- [ ] 1.5 单测：新增/扩展「本地层缺失」用例（文本不含其内容、不 panic、条目 `exists:false` 且 `bytes == 0`）
- [ ] 1.6 同步既有 `assemble_system_skips_missing_agents_and_includes_index`：`manifest.len()` 5→6、`skill_index` 下标 4→5，并在空 HOME + 空 vault 分支补断言本地层条目 `exists:false`

## 2. 验收场景（`scripts/acceptance`，随实现同 PR）

- [ ] 2.1 新增/更新真机验收场景（mock provider，fixture 全部合成）：新会话后读会话 JSONL 的 `session_open`，断言装配清单含 `agents_vault_root_local` 条目且 `exists` 与 fixture 布置一致
- [ ] 2.2 同场景（或独立场景）：fixture vault 预置三层文件时，断言 system prompt 中 `AGENTS.local.md` 内容排在 vault 根 `AGENTS.md` 内容之后

## 3. 验证

- [ ] 3.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 3.2 `cargo test` 的 harness context 装配单测全绿（含 1.4–1.6 新增/同步用例）
- [ ] 3.3 `scripts/gate.sh quick` 全绿（附 `GATE RESULT` 原文行与退出码）
- [ ] 3.4 本 change 归档时 living spec 增量并入核对（MODIFIED「AGENTS.md 自动加载」与实现一致），并同步 `openspec/specs/harness/spec.md` 的 Purpose 段——现有「AGENTS.md 双层（user-wide `~/.agents/AGENTS.md` + vault 根）」措辞须改为三层口径（archive 不会自动重写既有 capability 的 Purpose）
