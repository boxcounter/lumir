# Tasks: add-path-line-range-links

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现
> proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/harness/spec.md` / 本文件
- [x] 0.2 Alex 节点 1 评审通过（硬门禁；四个起草期取值 D1–D4 一并裁决，其中 D3 决定是否保留第二条
      MODIFIED）——Alex 2026-10-23：「change 提案都通过」，D1–D4 按提案倾向侧落地（记录见 proposal
      「评审记录」）

## 1. 后缀解析（纯函数层）

- [x] 1.1 `src/harness-path-link.ts`：`LINE_SUFFIX` 增加 `-(\d{1,7})` 分支（与 `:(\d{1,7})` 列分支
      互斥）；`PathCandidate` **不新增** `lineEnd` 字段（`止` 只用于「后缀是否成立」，见 design §2.3）
- [x] 1.2 `lineSuffixAt`：`止 < 起` ⇒ 整个后缀不成立（MUST NOT 回退成只有 `:起`）；沿用既有「后缀
      之后紧跟 ASCII 路径字符 ⇒ 整段不成立」守卫（因此 `9-12-15` 不吞半截）
- [x] 1.3 目录候选口径不变（不吞任何后缀）；展示文本仍取整段原文（`to` 覆盖整个后缀）
- [x] 1.4 单测（扩 `tests/unit/harness-path-link.test.ts`）：**先造会红的输入**再实现——`:40-12` /
      `:12-` / `:-9` / `:9-12-15` 不产行落点；`:12 - 40` 只认 `:12`；`:12-40` / `:1-1` / 中文紧邻
      （`见path:12-40的`）正向命中；`:12` / `:12:3` 逐字回归

## 2. 落点与接线

- [x] 2.1 跳转编排复用既有 `openPathAtLine`（`reveal` 入参取 `起` 行）；MUST NOT 新增落点算式或
      第二套转场窗口
- [x] 2.2 面板侧零改动核对：`createPathLinkEl` 的 `text` / `title` 都取自候选原文（整段后缀），因此
      不新增字段或渲染分支
- [x] 2.3 单测：行范围点击的编排顺序（open → 窗口内 reveal(起) → 下一帧复核）；**点击后文档选区不变**
      （`selection.main.empty` 仍为真、位置不变——D1 的反向断言）

## 3. 提示词纪律（D3；若裁「不改提示词」则整组作废并同步删除 delta 的第二条 MODIFIED）

- [x] 3.1 `src-tauri/src/harness/prompts/path-reference.md`：补一句「引用一段连续行时写 `:起-止`、
      两端行号取自实际读到的位置」
- [x] 3.2 Rust 单测核对：`context.rs` 的固定段注入文本包含该句、装配清单条目在场（字节数由 `len()`
      派生，MUST NOT 新增长度常量）——`path_reference_covers_reference_discipline` 已加该句的三条
      `contains` 断言

## 4. 视觉 / 真机场景

- [x] 4.1 视觉场景（`tests/visual/scenes/`，harness fixture）：回复正文含 `notes/x.md:3-5` → 整段是
      一个可点元素且文本逐字不变；点击 → 新标签打开、目标行文本进入视口（结构与计算属性断言即可，
      不需要新像素基线）
- [ ] 4.2 真机验收：mock provider 回复放一条 `path:起-止` → 点击落点正确、文档未被选中；同时核一条
      畸形形态仍按普通文本渲染（场景 221 + `harness-mock-path-line-range.json` 已落地、`--check`
      静态校验通过；**真机执行待 tower 协调窗口**，本 change 不声称已真机跑过。「选中」在真机层不可判
      ——AX 读不到选区，机器判据在 4.1 的视觉场景里）
- [x] 4.3 回扫既有验收场景：grep 所有 harness fixture 里带 `:行号` 的文本，确认新后缀不改变既有
      AX 文本期望；`node scripts/acceptance/run.mjs --check` 通过
- [x] 4.4 如实登记 prompt 遵从度为抽样观察（不进机器断言）

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 5.2 `node scripts/openspec-archive-check.mjs` 通过（两条 MODIFIED 均无静默丢段）
- [x] 5.3 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码）——本轮跑的是
      `gate.sh visual`（quick 的 11 条全含在其中，另加 isolation-runs 与 visual-regression）：
      `GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0
- [x] 5.4 信息卫生清扫：新增 fixture / 场景 / 文档对改动面做一次 text 级 grep，真实 vault 内容、
      真实路径、真实人名零命中
