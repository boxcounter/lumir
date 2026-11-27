# Tasks: add-editor-transition-oracle-nov27

## 1. 独立模型（状态迁移）

- [x] 1.1 在 `tests/unit/editing-oracle-model.ts` 追加 `EditState` / `SelectionShape` /
      `EditContext` / `EditAction` 类型与 `TransitionOracle`：四态（idle / composing /
      settling / readOnly）各自的源码与选区期望，含组合提交、组合中删除、settling 窗口与
      只读空转。
- [x] 1.2 模型自检（Node 层，零生产依赖）：只读全空转、组合中删除只吃 marked 区、
      组合提交把 marked 文本写回且不改其他字节、settling 结算不改源码、一次 undo 回到动作前 /
      一次 redo 回到动作后。**组合自身的撤销粒度不在自检内**：`input.type.compose` 的提交并入
      上一笔 changes 属 IME / CM 历史语义，模型诚实给 `steps:null`（见 N/A 表与 spec）；
      真引擎层只对「提交之后再键入」的那一步判一次 undo。

## 2. 矩阵定义与覆盖契约

- [x] 2.1 新增 `tests/unit/editor-transition-matrix.ts`：五个上下文 fixture（plain /
      inline-replace / block-replace / list-marker / table-cell）与每个动作的源码位置、
      高风险族清单、N/A 组合及理由。
- [x] 2.2 pairwise 生成器 + 高风险族并集；矩阵规模、各维取值数、pairwise 可行对覆盖率
      机器可读（`LUMIR_TRANSITION_MATRIX_REPORT=1` 时打印逐行读数）。
- [x] 2.3 `tests/unit/editor-transition-matrix.test.ts`：断言「非全笛卡尔」「全部可行 pair
      被覆盖」「高风险族逐一在场」「每格有预期与至少一个 case」「N/A 必须带理由」。

## 3. 真引擎执行层

- [x] 3.1 新增 `tests/visual/scenes/editor-transition-matrix.spec.ts`：每次打开一个上下文
      fixture 后捕获 pristine state，逐格 `setState` 复位（含一次空 dispatch 同步会话
      state），用真键盘 / 合成 `beforeinput` / 合成 `CompositionEvent` 驱动。
- [x] 3.2 每格断言：动作前该上下文的 replace 装饰在场（plain 断言目标行无此类装饰）、
      动作后源码与选区逐字节等于模型、一次 undo 回到动作前、一次 redo 回到动作后、
      非目标行不变、`⌘S` 载荷等于 `EditorState.doc` 且不含渲染层字形（`–` / `◦` / `→`）。
- [x] 3.3 composing / settling 两态在单个 `page.evaluate` 同步拍内完成（先 compositionstart
      → 组合文本 → compositionend / 组合中动作），避免 settle 定时器把窗口提前关掉。

## 4. 判红能力（反向验证）

- [x] 4.1 临时移除 `src/editor.ts` 的 `nativeEditGate`，按族逐个取证（`LUMIR_TRANSITION_FOCUS`
      单格聚焦），MUST 各有代表格变红、恢复后变绿：
      - 删除族：`idle/collapsed/block-replace/deleteBackward`（chromium，红读数 `alphatail\n`）；
      - 非空选区族：`idle/range/list-marker/deleteBackward`（chromium；inline / table 的选区删除
        在 chromium 原生路径本来就符合合同，只有跨隐藏 marker 的格子有区分度）；
      - 只读族覆盖由高风险族自身保证（18 格全部标 `readonly-noop`，不依赖 pairwise 偶然选中）；
      - 表格 cell 族：`idle/collapsed/table-cell/type` 在 **WebKit** 取证（M855 是 WebKit 原生
        target range 缺陷；chromium 原生路径本来就对）——红读数实际 `| cQ| d |`、期望 `| cQ | d |`。
      日志：`red-*.log` / `green-*.log`（`.local/missions/add-editor-transition-oracle-nov27/`）。
- [x] 4.2 恢复后三格分别复跑全绿（`green-*.log`），全量 8 个 test 亦全绿；红 / 绿读数只落
      `.local/`，不留在代码里。
- [x] 4.3 记录矩阵发现的**新**产品缺陷：只给最小复现与现状读数，不在本 change 修复。

## 5. 验证

- [x] 5.1 `pnpm test`（单测层，含矩阵覆盖契约）通过
- [x] 5.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 5.3 `scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行）
      —— `GATE RESULT: 13/13 PASS（SKIP 0）`，exit 0。首次跑 `unit-tests` 判红的是**既有**时序
      预算用例 `link-suggest`「万文件过滤 16ms」实测 19.2ms（与本 change 无关；`pnpm test` 单跑
      2167/2167 全绿、同树立即重跑 gate 全绿），已按「不与本改动相关」的口径记录，不掩盖。
- [x] 5.4 真引擎矩阵场景单独跑通（chromium）；读数与用例数记进报告
      —— 8 个 test 全绿（15.6s），矩阵 65 格 / 55 高风险格 / pairwise 27 行 / 可行取值对 87/87 /
      70 个 case（4 个 settling type 格带「有内容的组合提交」case；只读族 18 格全展开：折叠
      6 动作 × 2 上下文 + 选区 3 动作 × 2 上下文）。读数与红绿证据日志
      `.local/missions/add-editor-transition-oracle-nov27/`（`matrix-report.log` /
      `red-*.log` / `green-*.log` / `red-no-nativeEditGate.log` / `red-settle-mutation.log`）。
      WebKit 未登记：逐格 `view.setState` 复位在 Playwright WebKit 下会让 Enter 多出一个空行
      （同一文档不做 setState 时与模型一致），差异来自复位手法而非产品行为，见场景头注记。
- [ ] 5.5 节点 2 / 归档由 tower 执行，本 change 不自行归档
