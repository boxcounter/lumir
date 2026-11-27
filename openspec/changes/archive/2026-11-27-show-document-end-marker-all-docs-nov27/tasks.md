# Tasks: show-document-end-marker-all-docs-nov27

## 1. 合同与实现

- [x] 1.1 MODIFIED `editor-live-preview`「正文末尾的结束标记」：判据改为「可用视口高度 > 0」；纵向位置条款改为「正文自然末尾之下、不贴窗口底」；替换两个 scenario、删除临界带与自我指涉 scenario（delta 见 `specs/editor-live-preview/spec.md`）。
- [x] 1.2 MODIFIED `editor-live-preview`「结束标记的非文档性与几何稳定」：判据只读视口高度；保留非文档性、滚动高度恒定、与作者分隔线可区分三条 scenario，新增「短文显示且不产生额外滚动余量」scenario。
- [x] 1.3 `src/preview/endMarker.ts`：`endMarkerVisible(viewportHeight)` 只判 `> 0`；`read` 返回 `{visible, top, left, width}`（`contentHeight` + 正文盒 / scroller 矩形 + 滚动偏移只做内容坐标换算）；`docChanged || geometryChanged` 与 scroller ResizeObserver 触发重算；保留单帧落地与 `destroyed` 生命周期闸门；清扫旧判据注释。
- [x] 1.4 `src/preview/theme.ts`：正文行保持 `minmax(max-content, 1fr)`、`.cm-content` 保持 CM 基础主题的 `min-height: 100%`（指针命中面）；END 改绝对定位 + `pointer-events: none`，top / left / width 由插件写入；删除「正文盒自然高度 / 已知代价」旧注释。
- [x] 1.7 指针命中面回归修复（采用前的自然流方案已判红）：保留正文盒铺满视口 + END 绝对定位在自然末尾；单击 / END 自身 / 双击 / 拖选全部走 CM 原生路径（design §3 A/C/D/E 的对照实测）。
- [x] 1.5 检查其它层无第二份判据 / 注释引用：`rg "endMarkerVisible|minmax\\(max-content, 1fr\\)|一屏装不下" src tests docs scripts`，只留一处真源。
- [x] 1.6 `src/editor.ts` 的 md 装配：`structuralReadOnly`（分栏空 pane / 首启 tips）不装 `endMarker`；打开带路径文档后随 modeCompartment 重配恢复（结构性空态不是文档，与空态无行号 / 无光标同口径）。

## 2. 测试（先红后绿）

- [x] 2.1 `tests/unit/end-marker.test.ts`：新真值表（0 / 负值 false；1 / 733 / 4000 true）。旧实现下新用例必须红（`endMarkerVisible(733)` 返回 false）。
- [x] 2.2 `tests/visual/scenes/end-marker.spec.ts`：
  - 短文几何：END 在场、`marker.top == 正文自然末尾（末行 + 下内边距）±1`、末行到标记的间距 = 正文下内边距 + 标记上内边距、离视口底 > 100px、`scrollHeight == clientHeight`；
  - 空 md 文档与带 frontmatter 的短文同样在场且贴正文自然末尾；
  - 指针行为：单击正文下方空白 / 点 END 自身 → 聚焦 + head=doc.length；双击空白（无尾随换行 fixture）→ 选中末词；从空白拖回正文 → 非空选区；四条都不改文档；
  - 视口 0：隐藏 scroller → 离场；恢复 → 回场（负向断言的配对正观测）；
  - resize：短文档在矮 / 中 / 高三档视口下 `marker.top` 不变；
  - 长文滚动恒定 / 滚到底可见 / 插件写入的内容坐标 top 不随滚动变化；M238「跨判据翻转」改为「跨视口变化始终在场且贴正文自然末尾」；
  - M251 矩阵期望改为「md ⇒ 1、code ⇒ 0」，短文不再按判据豁免；其余形态 / 非文档性 / code / 字号用例保留。
  - 旧断言必须先在 master 实现上判红（短文 count 0），证据落 `.local/reviews/end-marker-all-docs-nov27/evidence/`。
- [x] 2.3 `empty-line-height-stability-nov27.spec.ts` 一字不改，在终态下原样绿（END 位置稳定性 + 普通行 padding 恒 0 的合同不覆盖）。
- [x] 2.4 `scripts/acceptance/scenarios/27-document-end-marker.md`：短文侧改为 END 节点在场；新增短文翻页后仍在场；标题 / 说明 / 覆盖边界同步；`node scripts/acceptance/run.mjs --check` 通过。
- [x] 2.5 反向必红：构造违反不变量的输入（短文侧按 master 判据不显示 / 把 END 钉到窗口底 / 视口 0 仍显示），确认对应用例判红后恢复；读数记进证据。
- [x] 2.6 邻接测试保持原始落点：最终方案正文盒铺满视口（CM 命中面），`m399` 的 `.cm-content` 中心点击与 `m631` 的 y=300 hover 落点仍然成立；已从 master 恢复两处原始测试、撤销自然高度方案时期的改动，复跑 22/22 绿（`m399-m631-restored.log`）。
- [x] 2.7 `no-tab-empty-state-nov27.spec.ts`：S4 分栏空 pane 无 END、打开 b.md 后 END 出现；S3 首启 tips 无 END（结构性空态与空态无行号 / 无光标同格）。
- [x] 2.9 真机 27 的 oracle 修正：四处 `editor.not` 由裸子串 `"END"` 收紧为 `/^END$/`（只判独立一行）；新增场景说明分类为「测试 oracle 缺陷」。反向：给合成 fixture 临时加独立一行 `END` → 27 FAIL（`02-reverse-red/`），fixture 逐字恢复（sha256 `5550ce7bcada…`）→ 27 PASS（`03-final-pass/`，23 断言）。首轮误报不作反向证据。
- [x] 2.8 指针行为反向必红：在「正文自然流」回归实现（提交 `2abc3a3d`）上，主指针用例单击空白后 `activeElement=.cm-scroller` 判红（`pointer-red-regression.log`）；另以三条独立用例逐条判红——点 END 自身 / 双击空白 / 空白区按下均不落在 `.cm-content`，**3 failed**（`pointer-late-red-regression.log`，临时 detached worktree 跑完即移除）。改回「正文盒铺满 + END 绝对定位」后主用例 13/13 绿（`end-marker-final-hitarea.log`），全目标 120/120（`target-final-committed.log`）。

## 3. 视觉材料（候选，不更新正式基线）

- [x] 3.1 短文 fixture 的真实 master before（`9f872e8f` 源码构建，非 CSS 隐藏）/ 候选 after 截图与 DOM 读数（content / last line / marker / viewport 四组矩形），落 `.local/reviews/end-marker-all-docs-nov27/short/`、`readings.json`；来源见 `short/SOURCES.md`、`evidence/master-before.log`。
- [x] 3.2 全量视觉跑一次（非 `LUMIR_VISUAL_STRUCTURAL`），逐条收集因 END 新出现而变化的整页基线；候选 actual 复制到 `.local/reviews/end-marker-all-docs-nov27/candidates/`，生成待 Alex 审阅的基线清单（不执行 `--update`）。
- [x] 3.3 审阅页 `.local/reviews/end-marker-all-docs-nov27/index.html`：内置可点击控制面板（短文前后 / 长文对照 / 并排 / 单张），query 深链保留。

## 4. 验证

- [x] 4.1 目标视觉：`end-marker.spec.ts` 13/13 + `empty-line-height-stability-nov27.spec.ts` 17/17 + 结构空态 / m399 / m631 / m281 / m647 / reading-position 邻域共 **120/120**（`target-final-committed.log`）。
- [x] 4.2 `scripts/gate.sh quick`：`GATE RESULT: 13/13 PASS（SKIP 0）`（`gate-quick-review-clean.log`，exit 0；此前一次 12/13 仅为既有 link-suggest 16ms 预算在机器高负载下超时，隔离 `pnpm test` 2192/2192 绿）。
- [x] 4.3 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`：PASS。
- [x] 4.4 `node scripts/openspec-archive-check.mjs` 门禁模式：PASS（MODIFIED 无静默丢段；必要的「归档对账声明」已写）。
- [x] 4.5 `node scripts/acceptance/run.mjs --check`：PASS（场景 27 的静态校验与覆盖表）。
- [x] 4.6 完工报告：commit hash、测试计数、候选截图路径、待 Alex 基线清单、主会话真机项（场景 27）。
- [x] 4.8 K3 P2/P3 收口：`short/before.png` 改为真实 master `9f872e8f` 构建的干净截图（无 END / 选区 / 浮钮，`master-before.log`）；`m399` / `m631` 从 master 恢复原始落点（与 master 0 diff，22/22 绿，`m399-m631-restored.log`）；proposal / tasks / 测试注释 / endMarker / theme 的弃用自然流与 `offset*` 表述改为 rect + scrollTop/Left 换算，并写明绝对定位仍计入 scrollable overflow。
- [x] 4.9 最终完整视觉：`scripts/gate.sh visual`（全量，含像素）——**第三次 `GATE RESULT: 15/15 PASS（SKIP 0）` exit 0，visual-regression 1369s / 1938 passed / 0 failed / 13 skipped**（`evidence/gate-visual-final-15of15-summary.log`、`evidence/gate-visual-regression-final-15of15.log`）。前两次 14/15（1936/2/13、1937/1/13）作为历史保留，失败为 `editing-oracle` 1045/1143 的本地计时 oracle；A/B 候选 40/40 vs master 37/40 见 `evidence/ab-settle-oracle.md`，无候选稳定回归。
- [x] 4.10 获批基线更新：Alex 原话「批准 END 的 4 张基线」与「批准 END 的第 4 张新基线」；只更新 4 张：combo1-3 沿用首次批准 SHA，combo4 用新 SHA `1b37b892…`（旧 `78b72663…` 作废）；未改容差、未更新第 5 张。
- [x] 4.11 归档：`node scripts/openspec-archive.mjs show-document-end-marker-all-docs-nov27` → 归档提交 `bc597b3c`；`node scripts/openspec-archive-check.mjs --archived show-document-end-marker-all-docs-nov27` PASS（1 条 MODIFIED，对比 10 段；人工恢复 0，声明认领 0）。
- [x] 4.7 真机场景 27：首轮 FAIL 分类为测试 oracle 缺陷（旧 `not: "END"` 误命中短文说明句）；修正后最终 **PASS 23 断言**，证据 `.local/acceptance/2026-11-27-end-marker-all-docs/03-final-pass/`；反向 FAIL 在 `02-reverse-red/`，三类不混算（`README.md`）。

## 5. 证据（绝对路径）

- 红（master 实现）：`.local/reviews/end-marker-all-docs-nov27/evidence/unit-red-master.log`（新真值表 1 红 / 2 绿）、
  `visual-red-master.log`（3 failed / 7 passed：短文两态、视口 0、M251 矩阵在旧实现上判红）。
- 红（指针回归实现 `2abc3a3d`）：`pointer-red-regression.log`（单击空白后 activeElement 是 `.cm-scroller`，主用例判红）；
  `pointer-late-red-regression.log`（点 END 自身 / 双击空白 / 空白区按下三条独立用例 **3 failed**）；
  `pointer-regression-probe.log`（倒退布局的读数复核）。
- 绿：`end-marker-final-hitarea.log`（end-marker 13/13，含指针四条）、
  `target-final-review-clean.log`（end-marker + 行高 + 结构性空态 + m399 / m631 原始落点 + m281 / m647 + reading-position 共 120/120；含逐条指针手势）、
  `m399-m631-restored.log`（恢复 master 原始落点后 22/22）、
  `lineheight-green.log`（17/17）、`pointer-evidence-probe.log`（短文几何 + 四条手势读数）。
- 门禁：`gate-quick-final-hitarea.log` 的 `GATE RESULT: 13/13 PASS（SKIP 0）`；`docs-check-final.log` PASS；`openspec validate --all --strict` 39/39。
- 全量视觉：`full-visual.log`（首轮 1934 passed / 2 failed / 13 skipped，两项失败处置见 BASELINES.md）；
  `wrap-baseline-after-hitarea.log`（指针修复后重跑四种组合）；
  `gate-visual-final-15of15-summary.log` / `gate-visual-regression-final-15of15.log`（最终完整门禁：GATE RESULT: 15/15 PASS（SKIP 0） exit 0，1938/0/13，1369s）；`gate-visual-final.log` 与 `gate-visual-regression-second.log` 保留前两次 14/15 历史；`ab-settle-oracle.md` / `ab-settle/` 为 A/B 分布。
- 基线：4 张获批快照 SHA 为 combo1 `0a8c48ad…` / combo2 `6059a2b3…` / combo3 `21007c46…` /
  combo4 `1b37b892…`（旧 combo4 `78b72663…` 作废，`combo4-recheck.md`）。
- 候选材料：`.local/reviews/end-marker-all-docs-nov27/index.html`（审阅页）、`BASELINES.md`、`short/{before,criterion-only,after,pointer-selection}.png`、
  `short/readings.json`、`candidates/`。
- 真机 27：`.local/acceptance/2026-11-27-end-marker-all-docs/{00-oracle-fixed-pass,01-oracle-fail-repro,02-reverse-red,03-final-pass}/`
  + `README.md`（首轮 oracle FAIL 复现 / 反向 FAIL / 最终 PASS 三类，产品失败 0）。
