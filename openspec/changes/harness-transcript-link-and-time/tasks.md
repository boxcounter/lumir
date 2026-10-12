# Tasks: harness-transcript-link-and-time

> 实现期注记：两条缺陷都按 `rendering-defect-contract-first` 走「先红后绿」——每条都留了
> **红证据**（断言对着缺陷形态实测变红）与**绿证据**（修复后全绿）。读数照抄命令原文行。

## 1. 合同先行（先红）

- [x] 1.1 缺陷一（裸 URL 隐身）先落必红断言：`tests/unit/harness-transcript-render.test.ts`
      以最小 DOM 替身驱动**真渲染件**（`renderMarkdownInto`，本 change 为单测导出）——段落里的
      裸 URL 必须产出 `.lumir-hp-link` 锚（`href` 与文本 = URL 原文）、表格 cell 同样、
      `Link` 之下的 URL 子节点不二次上屏。
      **红证据**（把 `case "URL"` 临时改回「整段跳过」的缺陷形态后重跑）：
      `node tests/unit/run.mjs` → **875 tests / 872 pass / 3 fail**，三条红分别是
      「段落里的裸 URL…」「表格 cell 里的裸 URL…」「无 scheme 的字面 URL…」；同批里
      「Link 不重复上屏」「Autolink 形态不变」「代码里不产锚」与 when 两形态用例**照旧绿**
      （区分度：红的恰好是缺陷面，不是整批）
- [x] 1.2 缺陷二（恢复消息无时间）先落必红断言，两层：
      - **后端（ts 归属，缺陷的本体）**：`harness.rs` 的
        `restored_panel_messages_carries_envelope_ts_per_item` + `restored_messages_ts_walks_the_record_sequence`
        + `jsonl.rs` 的 `read_session_file_keeps_per_record_envelope_ts`。**红证据**（只加
        `restored_ts` 参数、`ts` 仍恒 0 时跑）：
        `cargo test --lib -- harness::tests::restored` →
        `restored_panel_messages_carries_envelope_ts_per_item ... FAILED`，
        `left: [0, 0, 0] right: [100, 105, 105]`（7 passed / 1 failed）
      - **前端（读数形态与接线）**：`harness-transcript-render.test.ts` 的 `whenTextOf` 两形态 +
        视觉场景 `m460-…spec.ts` 的恢复重放 who 行。**红证据**（把 who 行的读数形态临时钉回
        live 档后跑）：
        `LUMIR_VISUAL_PORT=4297 bash scripts/visual/run.sh scenes/m460-…spec.ts --grep 会话恢复重放`
        → **1 failed**：`Expected pattern: /· \d+月\d+日/` / `Received string: "· 昨天"`，
        元素实况 `<span class="lumir-hp-when" data-when-form="live" …>· 昨天</span>`
- [x] 1.3 不变量条款落 `openspec/changes/harness-transcript-link-and-time/specs/harness/spec.md`
      （MODIFIED ×2：对话面板「链接上屏形态」/ 消息呈现「读数两档 + 会话恢复的 ts 来源」），
      proposal 的「评审记录」块注明来历 = Alex 2026-10-12 dogfood 原话（含原话逐字引用）

## 2. 缺陷一：裸 URL 上屏为链接

- [x] 2.1 `SKIP_NODES` 去掉 `"URL"`，`renderInlineNode` 增 `case "URL"`：`node.parent` 是
      `Link` / `Autolink` 时 `return`（保住「URL 不二次上屏」的正当语义），否则渲染为锚
      —— `src/harness-panel.ts` 的 `SKIP_NODES`（注释改准）+ `renderInlineNode` 的 `URL` 分支
- [x] 2.2 抽 `createLinkEl(href)` 收编三条入口（`Link` / `Autolink` / 独立 `URL`）——`href` 只作
      展示与 `title`，点击一律 `preventDefault` + `openExternalUrl`（信任边界只有一份）
      —— `src/harness-panel.ts` 的 `createLinkEl`
- [x] 2.3 无 scheme 的字面 URL（`www.` / 裸邮箱 / `mailto:`）同样上屏为锚（GFM 同一种节点；
      修复前同样隐身），前端**不**自行判 scheme——proposal 裁决点 1 取 A，理由见 design §2
- [x] 2.4 前端单测：`tests/unit/harness-transcript-render.test.ts` 6 条（段落 / 表格 cell /
      Link 子节点不重复上屏 / Autolink / 无 scheme 三态 / 代码里不产锚）
- [x] 2.5 视觉场景（真 DOM）：段落与表格 cell 的锚 `href` / 文本、`td` 内在场、标准链接正文本
      与 URL 不上屏、点击后 `open_external_url` 收到 URL 原文
      —— `tests/visual/scenes/m460-harness-transcript-link-and-time.spec.ts`

## 3. 缺陷二：恢复消息带留存时间

- [x] 3.1 `jsonl.rs`：`SessionFile` 增 `record_ts`（每行信封 ts，与 `records` 逐位对齐；缺字段
      记 `None`），`read_session_file` 一并填 —— `src-tauri/src/harness/jsonl.rs` 的
      `SessionFile::record_ts` / `read_session_file`
- [x] 3.2 `harness.rs` 新增 `restored_messages_ts(records, record_ts, request_index, system)`：
      沿记录序归位（user 项 = 所属请求的信封 ts；assistant / function_call / function_call_output
      项 = 产出它的那条响应的信封 ts；前缀延续项沿用上次归属；压缩调用不参与；归属不到记 `None`）
      —— `src-tauri/src/harness.rs` 的 `restored_messages_ts`（doc 写了规则与依据）
- [x] 3.3 `restored_panel_messages` 收 `restored_ts` 参数，逐项取自己那一项的戳（缺 = 0）
      —— `src-tauri/src/harness.rs` 的 `restored_panel_messages`；doc 的「无 ts」段改准为
      「ts 来自留存信封」
- [x] 3.4 `resume_session`：灌回数组与 ts 表**同步增长**（折叠末尾响应的项归那条响应的信封 ts），
      两条通道（`SessionResumeInfo.messages` 与新会话 `panel`）同时带出
      —— `src-tauri/src/harness.rs` 的 `resume_session` 里 `restored_ts` 的构造与消费
- [x] 3.5 `PanelMessage.ts` 的注释改准（恢复重建的戳不是当下时刻，而是信封归属值）
      —— `src-tauri/src/harness/session.rs` 的 `PanelMessage.ts`
- [x] 3.6 前端读数两档：`whenTextOf(at, now, form)` + `WhenForm`（live = 既有分档；restored =
      同日窄相对 / 跨天短日期），who 行与恢复工具行接线，形态落 `data-when-form` 供 30s 刷新 /
      语言切换读回（重绘不重算形态）—— `src/harness-panel.ts` 的 `whenTextOf` / `createWhoLine` /
      `refreshWhoLines` / `appendSnapshotMessage` / `appendRestoredToolRow`
- [x] 3.7 Rust 单测 3 条 + 前端单测 2 条 + 视觉场景 1 条（见 1.2）；
      全量 `cargo test --lib` → **451 passed / 0 failed**（M459 基线 448，+3）；
      `node tests/unit/run.mjs` → **875 passed / 0 failed**（M459 基线 867，+8）
- [x] 3.8 绑注重导出：`cargo test` 产出 `src/bindings/PanelMessage.ts` 的注释更新（ts-rs 带出
      doc comment）并已 `git add`（gate 的 bindings-drift 绿）

## 4. 验收场景

- [x] 4.1 新增 `scripts/acceptance/scenarios/152-harness-transcript-link-and-time.md` + fixture
      `harness-mock-link-time.json`（全合成：`example.com` 域、`lktsmark` 提问串）：一轮 mock 回答
      同时含段落裸 URL / 表格 cell 裸 URL / 标准链接；断言裸 URL 两处上屏、标准链接的 URL
      不上屏；随后＋新会话 → 会话浮层恢复 → 断言重放出的 `你 · N 秒/分钟前` 与
      `Agent · …` 读数、正文仍在
- [x] 4.2 `node scripts/acceptance/run.mjs --check` → **场景静态校验通过（155 个）**（M459 前 154）
- [x] 4.3 **如实登记**：本场景**未真机跑**（mission 只要求 `--check`）——断言形态借用场景 96/106
      的同款写法，读数未经机器证实；覆盖边界（跨天读数、后端 ts 归属、链接点击）在场景正文的
      「覆盖边界」节逐条写明

## 5. 视觉与验证

- [x] 5.1 `tests/visual/scenes/m460-harness-transcript-link-and-time.spec.ts` 两条用例在本机
      chromium 实跑：`LUMIR_VISUAL_PORT=4297 bash scripts/visual/run.sh scenes/m460-…` →
      **2 passed**（无像素基线新增：本场景只做结构断言）
- [x] 5.2 `bash scripts/gate.sh visual`（LUMIR_VISUAL_PORT=4297）全量 → 见 §6 读数
- [x] 5.3 信息卫生：改动面清扫（`example.com` 合成域、`lktsmark` / `HNL-ALPHA` 合成串；
      本机绝对路径 / 家目录 / 真实 vault 串零命中）——仓内新增制品无真实内容
## 6. 验证读数

- [x] 6.1 `bash scripts/gate.sh quick` @ 工作区（全部改动已 `git add`）→
      **`GATE RESULT: 10/10 PASS（SKIP 0）`**，exit 0
      （cargo-fmt / cargo-clippy / cargo-test / bindings-drift / tsc-root / tsc-visual / tsc-unit /
      unit-tests / docs-check / openspec-validate 十条全跑，SKIP 0 单列）
      - cargo-test：lib **451 passed / 0 failed**（M459 基线 448，+3 条本 change 的用例）
      - unit-tests：**875 passed / 0 failed**（M459 基线 867，+8 条）
      - openspec-validate：**31 passed / 0 failed**（M459 基线 30，+1 = 本 change）
      - **首跑是 9/10**：唯一 FAIL = `cargo-fmt`（我写的 `record_ts` 数组与一行 `if` 没按 rustfmt 折行）
        ——`cargo fmt --all` 后复跑得 10/10；读数照抄复跑那一份
- [x] 6.2 `bash scripts/gate.sh visual`（LUMIR_VISUAL_PORT=4297）→ **`GATE RESULT: 12/12 PASS（SKIP 0）`**，
      exit 0；`tests/visual/baselines/` 零改动（本 change 不动样式、不加像素基线）
- [x] 6.3 `node scripts/acceptance/run.mjs --check` → **场景静态校验通过（155 个）**（见 4.2）
