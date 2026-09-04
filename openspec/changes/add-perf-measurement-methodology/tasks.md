# Tasks: add-perf-measurement-methodology

> 首个全循环的特殊性说明：本 change 是 ADR 0004 第 4 条指定的流程验证对象，测量脚本与 CI 实现已随 M8（feat/perf-spec-ci）先于提案合并入库。1.x 项按实勾选并标注出处；正常循环中实现不得先于提案评审（节点 1），此处为例外，目的即是验证流程。

## 1. 测量方法学与实现（M8 已完成，先于提案——见上方说明）

- [x] 1.1 方法学 spec 定稿：`docs/specs/perf-measurement.md`（accepted，2026-09-05，M8 合并）
- [x] 1.2 冷启动测量脚本 `scripts/perf/cold-start.mjs` + ready 信号契约 `src-tauri/src/ready.rs`（M8）
- [x] 1.3 keypress-to-paint 测量脚本 `scripts/perf/keypress-to-paint.mjs`（CDP 注入近似，下界声明随读数输出）（M8）
- [x] 1.4 打开 1MB 文件测量脚本 `scripts/perf/open-file.mjs`（占位口径）（M8）
- [x] 1.5 常驻内存测量脚本 `scripts/perf/memory.mjs`（全进程树 RSS + WebKit XPC 差集归因）（M8）
- [x] 1.6 1MB fixture `tests/perf/fixtures/markdown-1mb.md`（恰好 1,048,576 字节）+ 确定性再生成器 `gen-fixture.mjs`（M8）
- [x] 1.7 阈值比较 `scripts/perf/check-thresholds.mjs` + `tests/perf/thresholds.json`（`enforce: false`，warn-only 阶段）（M8）
- [x] 1.8 CI 工作流 `.github/workflows/perf.yml`：`macos-15` runner、release 构建、四项脚本、`perf-results/` artifact 上传（保留 30 天）、超阈 `::warning::` 恒绿（M8）

## 2. 提案与评审（本 change）

- [x] 2.1 起草 `proposal.md` / `tasks.md` / `specs/perf-measurement/spec.md` 增量
- [ ] 2.2 Alex 提案评审（节点 1）通过：不看代码即可裁决——动机、四指标方法学要点、下界/占位两个风险口径、校准路径四者都答清楚

## 3. 校准与门禁启用（M0 末，本 change 归档前的外部依赖）

- [ ] 3.1 M0 末四项指标首次全量实测，按 ADR 0002 revisit 条款做一次性校准（如需修订数字，走 ADR 修订）
- [ ] 3.2 校准后将 `tests/perf/thresholds.json` 的 `enforce` 置 `true`，超阈即 CI 红、拒合

## 4. 验证

- [ ] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 4.2 CI `perf.yml` 在 master 上产出四项指标的 `perf-results/` artifact（warn-only 阶段 workflow 恒绿）
- [ ] 4.3 Alex 归档评审（节点 2）通过后执行 `openspec archive add-perf-measurement-methodology --yes`
