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
- [x] 2.2 Alex 提案评审（节点 1）通过：不看代码即可裁决——动机、四指标方法学要点、下界/占位两个风险口径、校准路径四者都答清楚（批准日期 2026-09-05）

## 3. 校准与门禁启用（M13 已完成，2026-09-05）

- [x] 3.1 M0 末四项指标首次全量实测，按 ADR 0002 revisit 条款做一次性校准（M13，commit `93a4903`）：CI 两次全量实测显示重指标噪声 3-4 倍（冷启动 p95 284ms vs 809ms、keypress-to-paint p95 70ms vs 255ms）、轻指标几乎一致（打开 1MB 约 2.6ms、常驻内存约 110MB）；据此修订 ADR 0002 第 6 条 CI 门禁口径——冷启动/keypress 改滚动基线相对回归（回退 >20% 拒合），绝对合同值保留并在标准化环境（裁决者本机）裁决；open-file/内存保持 CI 绝对阈值。ADR 0002 修订确认日期 2026-09-05，一次性校准额度同日用尽。
- [x] 3.2 校准后将 `tests/perf/thresholds.json` 的 `enforce` 置 `true`，超阈即 CI 红、拒合（M13：含 `mode: absolute|relative` 与 `regression` 结构；enforce 下任一指标结果缺失即 exit 1）

## 4. 验证

- [x] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（M14 归档前自验与归档后复验均通过）
- [x] 4.2 CI `perf.yml` 在 master 上产出四项指标的 `perf-results/` artifact（M13 校准依据即 CI 两次全量实测的 artifact 数值；warn-only 阶段 workflow 恒绿已验证，校准后 enforce:true 拒合行为随 M13 落地）
- [x] 4.3 归档由 M14 执行（`openspec archive add-perf-measurement-methodology --yes`，living spec 并入 `openspec/specs/perf-measurement/spec.md`）。按 M14 使命编排，次序与本任务原文相反：先在本分支完成归档，Alex 归档评审（节点 2）以归档结果本身（本 PR）为对象，批准后由 tower 合并——节点 2 的硬门禁性质不变，只是评审对象从"归档前制品"变为"归档后结果"。

## 5. 归档说明（M14 记录，供 Alex 节点 2 评审）

本节回答节点 2 的通过标准："spec 增量与 proposal 的意图一致，无实现期静默扩 scope"。

**校准落地与 proposal 意图的一致性**

- proposal「校准路径（两阶段门禁）」承诺：warn-only → M0 末一次性校准 → `enforce: true`。M13 完全沿此路径执行，无路径外动作。
- proposal 承诺"可修订 ADR 0002 的数字，仅此一次"。M13 **未改动四个绝对数字**（<300ms / <16ms / <100ms / <200MB 原样保留），修订的是 CI 门禁执行口径：重指标（冷启动、keypress-to-paint）在 CI 上改滚动基线相对回归，绝对合同值移到标准化环境（裁决者本机）按 ADR 0002 第 6 条既有口径裁决；轻指标（open-file、内存）保持 CI 绝对阈值。该修订走了 ADR 0002 revisit 条款的一次性校准额度，ADR 文本已同步标注"额度已于 2026-09-05 使用，此后不再可用"。
- 相对回归口径（滚动基线 = 最近 10 次 master 门禁值 median、回退 >20% 拒合、`actions/cache` 持久化、基线缺失只 warning 不拒合、结果缺失 exit 1）是校准期新引入的方法学细节，已写入 `docs/specs/perf-measurement.md`「相对回归门禁」一节，并同步进本 change 的 spec 增量（「门禁模式与一次性校准」requirement），living spec 并入后即反映校准后现状。
- `tests/perf/thresholds.json` 现状：`enforce: true`，`cold-start` / `keypress-to-paint` 为 `mode: relative`，`open-1mb-file` / `resident-memory` 为 `mode: absolute`，`regression.maxRegressionPct: 20`、`window: 10`。

**归档时对 spec 增量的修订（透明声明）**

- 「门禁两阶段启用与一次性校准」requirement 改写为「门禁模式与一次性校准」：两阶段描述（warn-only 阶段）已是历史，living spec 只保留校准后的现行口径；原"校准前超阈不拒合"scenario 删除，替换为相对回归拒合 / 基线缺失不拒合 / 结果缺失拒合三个 scenario。
- 「冷启动测量」「keypress-to-paint 测量」两个 requirement 各补一句：CI 门禁为相对回归模式，绝对合同值在标准化环境裁决。
- 以上修订属于"校准路径"承诺的兑现结果，不是新增意图；若 Alex 判定相对回归口径超出一次性校准的合理使用范围，应在本节点驳回，由后续 change 修订。

**待 Alex 裁决点**：相对回归（不动绝对数字、只动 CI 执行口径）是否构成对 ADR 0002 revisit 条款"一次性校准"的合理使用。
