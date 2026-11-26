# Tasks: add-explicit-skill-trace-nov26

## 1. 制品

- [x] 1.1 `proposal.md` 记录节点 1 批准原话与范围（2026-11-26「采纳」）
- [x] 1.2 `specs/harness/spec.md` 新增 requirement「显式 Skill 加载痕迹」与 7 条 scenario
- [x] 1.3 `design.md` 记录载体选择、工具行身份、live / 恢复单一产出点与失败面清单

## 2. 后端实现（src-tauri）

- [x] 2.1 显式加载管线产出统一痕迹项（成功 / 各类失败），替换 `emit_explicit_skill_error` 的 live-only 分支
- [x] 2.2 用户消息项写入本地字段 `lumir_skill_trace`（只含名称 / 终态 / 错误码 / 原因 / ts），`attachments::expand_image_refs_from` 在 wire 前剥除
- [x] 2.3 live 路径：用户消息入队后按痕迹项发 `explicit_skill` 的 started/done 并写面板行（单一构造函数）
- [x] 2.4 恢复路径：`restored_panel_messages` 从 `lumir_skill_trace` 重建同一批工具行，ts 取痕迹项
- [x] 2.5 失败面补齐：grammar 不合、不存在、SKILL.md 缺失 / 不可读 / 超限、加载无正文；权限 / 策略错误码沿用既有语义
- [x] 2.6 重试 / 重复恢复不重算、不重复留痕；自动 `skill_load` 路径零改动

## 3. 前端实现

- [x] 3.1 `keyArgOf` 增加 `explicit_skill` → 技能名（参数格人话化，与其余工具行同口径）
- [x] 3.2 复核 `explicit_skill` 失败行的尾注（`failureTextOf` 取痕迹重建的输出 JSON）无需新渲染分支

## 4. 测试（先红后绿）

- [x] 4.1 Rust：成功加载留一条 `explicit_skill` 行、面板文本仍只有用户原文、正文不进 title 素材
- [x] 4.2 Rust：多 Skill 一次发送每名字一行、同名只一行
- [x] 4.3 Rust：失败面逐类（grammar / 不存在 / 元数据非法 / 禁手动 / 权限 deny / 缺失 / 超限 / 无正文）各留失败行与具体原因
- [x] 4.4 Rust：`lumir_skill_trace` 进 `llm_request.messages`、provider wire 不含该字段与失败码
- [x] 4.5 Rust：恢复（`resume_session`）重建相同痕迹且不重新加载；重试不重复加载 / 留痕
- [x] 4.6 Rust：自动 `skill_load` 工具行与结果回送不回归
- [x] 4.7 前端单测：`explicit_skill` 参数格人话化、失败尾注取输出 JSON
- [x] 4.8 记录旧实现必红的实测（新测试在基线代码上的失败输出）

## 5. 验收场景

- [x] 5.1 更新 `scripts/acceptance/scenarios/726-harness-skill-hybrid-invocation.md`：显式成功 / 失败痕迹的正向断言、失败码只进本地痕迹字段的负向断言、恢复后痕迹仍在的断言
- [x] 5.2 保留自动基线场景 77 不被本场景修改

## 6. 验证

- [x] 6.1 `cargo test`（目标模块：harness turn / restore / attachments）
- [x] 6.2 `pnpm test`（`tests/unit/harness-restore.test.ts` 等）
- [x] 6.3 相关视觉结构断言（`LUMIR_VISUAL_STRUCTURAL=1`）与 `tests/visual` tsc
- [x] 6.4 `scripts/docs-check.sh`
- [x] 6.5 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`
- [x] 6.6 真机验收场景 726 + 77：实现批不执行真机；发布批补跑——首轮 77 **PASS**（8 断言）、
      726 FAIL（51 断言 / 2 失），按真实行为对齐场景期望（`58ab5fd1`，产品代码零改动）后 726 r2
      **PASS**（51 断言、36.5s）。证据 `.local/acceptance/2026-11-26-release-0.19.0/`（77）与
      `.local/acceptance/2026-11-26-release-0.19.0-r2/`（726）

## 7. 独立评审返修（verdict: needs-changes → 返修）

- [x] 7.1 P1-1 成功痕迹补可见且 AX 可读的终态词「已加载」（D1029；live 与恢复共用 `explicitSkillSuccessTail`），726 成功断言必须命中 `· 已加载`
- [x] 7.2 P2-1 长名只在展示字段截断；正文标题与 `lumir_skill` 使用完整原名，补 >80 字合法长名回归
- [x] 7.3 P2-2 目录在但 SKILL.md 缺席稳定报 `skill_file_missing`（与 `skill_not_found` 分列），修正测试与设计口径
- [x] 7.4 P2-3 726 负向断言改为键序无关的 `"text":"…<code>…"` 判据，并用两种键序 + 转义前缀反例实测必红（证据 `.local/missions/add-explicit-skill-trace-nov26/counterexample-p23.log`）
- [x] 7.5 返修后复跑：Rust 目标与全 lib / 前端单测 / 结构视觉子集 / docs-check / validate（读数见证据目录）
