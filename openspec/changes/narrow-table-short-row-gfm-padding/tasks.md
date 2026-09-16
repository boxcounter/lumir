# Tasks: narrow-table-short-row-gfm-padding

## 1. 模型与渲染

- [x] 1.1 `src/preview/table.ts`：数据行槽位数少于表头列数时在尾部补零宽空 slot（`from === to`）后按矩形判定；槽位数多于表头、槽位未能安全映射、表头与分隔行列数不一致仍判 `non-rectangular`；oversize 与兜底分支不变。
- [x] 1.2 `src/preview/livePreview.ts`：零宽空 slot 的空 cell 装饰改走 point widget（CM6 对零宽 replace 装饰抛 `RangeError`：`PointDecoration.range` 要求起点或终点 inclusive）；非零宽空槽保持原 replace 路径，行为不变。
- [x] 1.3 `degradationNotice` 文案措辞不动（收窄后非矩形只由多列/槽位不可映射触发，「第 N 行单元格数与表头不符（应为 M 列）」仍然准确）。

## 2. 合同与制品

- [x] 2.1 `docs/specs/table-reading.md` §2：改写「不得补列」为「短行尾部补空 cell（引 GFM §4.10 原文）、多列仍整块降级」，记录 Alex 2026-09-16 裁决；§9 fixture 矩阵同步区分少列/多列。
- [x] 2.2 未归档制品的口径对账：`openspec/changes/complete-markdown-reading/specs/editor-live-preview/spec.md` 与 `openspec/changes/foundation-table-reading/specs/foundation-table-reading/spec.md` 中同主题的旧口径同步收窄（避免归档时把旧规则写回 living spec）。
- [x] 2.3 `docs/backlog.md`：记入 GFM 短行收窄的裁决与落地（含日期、口径、证据指针）。

## 3. 测试与验收

- [x] 3.1 `tests/visual`：`table-foundation-v2` 的短行 fixture（`| one |` 类）翻转为「正常渲染」断言（空 cell 数量、每行 cell 数、列几何对齐）；多列降级改用多列形态 fixture 保持；新增 outline.md 同款形态（6 列表头 + 5 cell 行）的专门断言。
- [x] 3.2 `scripts/acceptance`：`render-table-degrade` 的降级表改多列形态（保留降级文案与出错行号断言），fixture 增补短行表并断言其渲染成表格；`node scripts/acceptance/run.mjs --check` 全绿。
- [x] 3.3 视觉基线：核对含表的场景均无 `toHaveScreenshot` 断言 → 预期基线零变化；若实际出现差异，逐场景留前后对比说明后再更新。

## 4. 验证

- [x] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 4.2 `scripts/gate.sh quick` 全绿（fmt / clippy / cargo test / bindings 漂移 / tsc / openspec validate）。
- [x] 4.3 `scripts/gate.sh visual` 全绿（含 `table-foundation-v2` 与既有表格场景的回归）。
- [x] 4.4 `node scripts/acceptance/run.mjs render-table-degrade` 在真实 WKWebView 下 PASS（或被环境阻塞时如实记录并上报，不用 chromium 结果替代）。
- [x] 4.5 新增相对链接目标逐一存在，`git diff --check` 与 scope diff 通过。
