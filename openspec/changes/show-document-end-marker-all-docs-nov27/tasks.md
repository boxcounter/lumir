# Tasks: show-document-end-marker-all-docs-nov27

## 1. 合同与实现

- [x] 1.1 MODIFIED `editor-live-preview`「正文末尾的结束标记」：判据改为「可用视口高度 > 0」；纵向位置条款改为「正文自然末尾之下、不贴窗口底」；替换两个 scenario、删除临界带与自我指涉 scenario（delta 见 `specs/editor-live-preview/spec.md`）。
- [x] 1.2 MODIFIED `editor-live-preview`「结束标记的非文档性与几何稳定」：判据只读视口高度；保留非文档性、滚动高度恒定、与作者分隔线可区分三条 scenario，新增「短文显示且不产生额外滚动余量」scenario。
- [x] 1.3 `src/preview/endMarker.ts`：`endMarkerVisible(viewportHeight)` 只判 `> 0`；`read` 只读 `.cm-scroller` 的 clientHeight；删除 `docChanged` 触发的重算；保留单帧落地与 `destroyed` 生命周期闸门；清扫全部「一屏装不下 / 内容高度比较」注释。
- [x] 1.4 `src/preview/theme.ts`：md `.cm-scroller` 行模板改 `max-content`（有 document-top title 时 `max-content max-content`）；md 内 `.cm-content` 覆盖 `min-height: 0`；清扫 `1fr` / 「点正文下方空白」旧注释并记录代价（design §3 A）。
- [x] 1.5 检查其它层无第二份判据 / 注释引用：`rg "endMarkerVisible|minmax\\(max-content, 1fr\\)|一屏装不下" src tests docs scripts`，只留一处真源。
- [x] 1.6 `src/editor.ts` 的 md 装配：`structuralReadOnly`（分栏空 pane / 首启 tips）不装 `endMarker`；打开带路径文档后随 modeCompartment 重配恢复（结构性空态不是文档，与空态无行号 / 无光标同口径）。

## 2. 测试（先红后绿）

- [x] 2.1 `tests/unit/end-marker.test.ts`：新真值表（0 / 负值 false；1 / 733 / 4000 true）。旧实现下新用例必须红（`endMarkerVisible(733)` 返回 false）。
- [x] 2.2 `tests/visual/scenes/end-marker.spec.ts`：
  - 短文几何：END 在场、`marker.top == content.bottom ±1`、末行到标记的间距 = 正文下内边距 + 标记上内边距、离视口底 > 100px、`scrollHeight == clientHeight`；
  - 空 md 文档与带 frontmatter 的短文（两种 grid 行编排）同样在场且贴内容盒底边；
  - 视口 0：隐藏 scroller → 离场；恢复 → 回场（负向断言的配对正观测）；
  - resize：短文档在矮 / 中 / 高三档视口下 `marker.top` 不变；
  - 长文滚动恒定 / 滚到底可见；M238「跨判据翻转」改为「跨视口变化始终在场且贴内容盒底边」；
  - M251 矩阵期望改为「md ⇒ 1、code ⇒ 0」，短文不再按判据豁免；其余形态 / 非文档性 / code / 字号用例保留。
  - 旧断言必须先在 master 实现上判红（短文 count 0），证据落 `.local/reviews/end-marker-all-docs-nov27/evidence/`。
- [x] 2.3 `empty-line-height-stability-nov27.spec.ts` 一字不改，在终态下原样绿（END 位置稳定性 + 普通行 padding 恒 0 的合同不覆盖）。
- [x] 2.4 `scripts/acceptance/scenarios/27-document-end-marker.md`：短文侧改为 END 节点在场；新增短文翻页后仍在场；标题 / 说明 / 覆盖边界同步；`node scripts/acceptance/run.mjs --check` 通过。
- [x] 2.5 反向必红：构造违反不变量的输入（短文侧按 master 判据不显示 / 把 END 钉到窗口底 / 视口 0 仍显示），确认对应用例判红后恢复；读数记进证据。
- [x] 2.6 邻接测试的 oracle 修正：`m399-empty-lines.spec.ts` 的 P2 原用 `.cm-content` 中心点击来「落到文档末」，短文正文盒回到自然高度后中心落在中间行——改为点最后一行 + End（同一意图的显式写法），产品断言不变。
- [x] 2.7 `no-tab-empty-state-nov27.spec.ts`：S4 分栏空 pane 无 END、打开 b.md 后 END 出现；S3 首启 tips 无 END（结构性空态与空态无行号 / 无光标同格）。

## 3. 视觉材料（候选，不更新正式基线）

- [x] 3.1 短文 fixture 的 before（master）/ after（候选）截图与 DOM 读数（content / last line / marker / viewport 四组矩形），落 `.local/reviews/end-marker-all-docs-nov27/shots/`、`readings.json`。
- [x] 3.2 全量视觉跑一次（非 `LUMIR_VISUAL_STRUCTURAL`），逐条收集因 END 新出现而变化的整页基线；候选 actual 复制到 `.local/reviews/end-marker-all-docs-nov27/candidates/`，生成待 Alex 审阅的基线清单（不执行 `--update`）。
- [x] 3.3 审阅页 `.local/reviews/end-marker-all-docs-nov27/index.html`：内置可点击控制面板（短文前后 / 长文对照 / 并排 / 单张），query 深链保留。

## 4. 验证

- [x] 4.1 目标视觉：`end-marker.spec.ts` 全绿 + `empty-line-height-stability-nov27.spec.ts` 全绿 + 邻接受影响场景（m281 行号 / m399 空行 / m647 caret）全绿。
- [x] 4.2 `scripts/gate.sh quick`：全绿（含 tsc 根 / 视觉 / 单测、前端单测、docs-check、openspec validate）。
- [x] 4.3 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`：PASS。
- [x] 4.4 `node scripts/openspec-archive-check.mjs` 门禁模式：PASS（MODIFIED 无静默丢段；必要的「归档对账声明」已写）。
- [x] 4.5 `node scripts/acceptance/run.mjs --check`：PASS（场景 27 的静态校验与覆盖表）。
- [x] 4.6 完工报告：commit hash、测试计数、候选截图路径、待 Alex 基线清单、主会话真机项（场景 27）。

## 5. 证据（绝对路径）

- 红（master 实现）：`.local/reviews/end-marker-all-docs-nov27/evidence/unit-red-master.log`（新真值表 1 红 / 2 绿）、
  `visual-red-master.log`（3 failed / 7 passed：短文两态、视口 0、M251 矩阵在旧实现上判红）。
- 绿：`target-green-final.log`（end-marker + 行高 + m399 + m631 + m281 + m647 共 101/101）、
  `lineheight-green.log`（17/17）、`target-green-2.log`（m631 修复后 45/45）、
  `target-green-3.log`（end-marker + 结构性空态 + 行高 33/33）。
- 门禁：`gate-quick-4.log` 的 `GATE RESULT: 13/13 PASS（SKIP 0）`；`docs-check-final.log` PASS；`openspec validate --all --strict` 39/39。
- 全量视觉：`full-visual.log`（1934 passed / 2 failed / 13 skipped；两项失败处置见 BASELINES.md）；
  `wrap-candidates-2.log`（四种组合的 save-only 候选截图，未更新基线）。
- 候选材料：`.local/reviews/end-marker-all-docs-nov27/index.html`（审阅页）、`BASELINES.md`、`short/{before,criterion-only,after}.png`、
  `short/readings.json`、`candidates/`。
