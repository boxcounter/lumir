# Tasks: editor-ordered-list-auto-mode-on-marker

> 实现期注记：两条缺陷按 `rendering-defect-contract-first` 走「先红后绿」——断言先落、
> 跑出红、再修到绿，红绿读数抄在下方各任务里。真机探针证据（先行的 task 0）在
> `test-results/m461-probe/`（git 外，不进 PR）。

## 0. 真机探针（先行，不动产品代码）

- [x] 0.1 合成 vault（/tmp/lumir-m461-probe，XDG 隔离 env）起 `pnpm tauri dev` 实例，
      页面临时插桩抓 beforeinput / composition* / input / keydown / DOM 变更。
- [x] 0.2 缺陷①确诊：`para\n1. ` 的 lezer 归属（lazy continuation）+ 真机视觉复现
      （行首 `1. ` 按普通文本渲染）；分布表（setext / 引用 / 代码块 / 真列表对照）落
      readings.md。
- [x] 0.3 缺陷②定界：英文态事件序列无 insertOrderedList；全部合成键盘通道绕过 TSM
      组合态不可达（compositionstart 零命中）；CM beforeinput 处理器对
      insertOrderedList/insertUnorderedList 不拦截（源码层实测）。边界如实登记。

## 1. 合同先行（先红）

- [x] 1.1 缺陷①（不进入列表编辑态）先落必红断言：
      `tests/unit/ordered-list-auto-mode.test.ts`——判定分布（裸行命中 / 树已接管让路 /
      setext 与代码块排除 / 分隔符与前缀形态）+ Enter 两态（退出 / 续行 / 撤销步数 /
      引用前缀 / 只读 / 真实路径回归）。
      **红证据**：`node tests/unit/run.mjs` → **876 tests / 875 pass / 1 fail**
      （新文件 import 层变红：`bareListMarkerLine` 尚不存在；875 条存量全绿 = 无连带破坏）。
- [x] 1.2 缺陷②（IME 重复）先落必红断言：同文件 E 组——
      `insertOrderedList` / `insertUnorderedList` 必须 preventDefault + 消费；
      `insertText` / `insertCompositionText` / 无 inputType 一律放行且不得 preventDefault。
      红形态同上（函数不存在，import 红）。
- [x] 1.3 不变量条款落 change 的 spec delta（ADDED ×2：裸 marker 行编辑态 / IME 不重复；
      MODIFIED ×1：Enter 换行与自动缩进的首条分派）；`docs/specs/lists.md` 增 B1/B2
      （门控相接即算 / 渲染不改文档）；proposal 评审记录节点 1 写明 Alex 2026-10-12
      原话与「已表达预期即裁决」来历，节点 2 留白。

## 2. 缺陷①：裸 marker 行的列表编辑态

- [x] 2.1 `src/preview/lists.ts` 增 `bareListMarkerLine` 纯判定（BARE_MARKER_RE +
      祖先排除 + `listLineInfo` 让路），文件头注释写明与 `listLineInfo` 的补集关系。
- [x] 2.2 `src/enter-indent.ts` 增 `enterBareMarkerLine`（只读守卫 / 光标在 marker 前
      不接管 / 空项退出单事务 / 续行单事务），挂进 `enterWithAutoIndent` 的 md 分支
      最前。
- [x] 2.3 `ListLayout.build` 增裸行分支（判据选区相接门控 + `cm-lp-bare` 行类 +
      既有 ListMarker widget + 悬挂缩进），`update()` 补 `selectionSet` 与
      `pointerPressFrame` 两个重建触发。
- [x] 2.4 **绿证据**：`node tests/unit/run.mjs` → **893 tests / 893 pass / 0 fail**。

## 3. 缺陷②：DOM 输入入口拒收原生自动列表

- [x] 3.1 `src/enter-indent.ts` 增 `swallowNativeListBeforeInput`（最小事件结构，
      单测直驱）；`src/editor.ts` md 模式经 `EditorView.domEventHandlers` 装配。
- [x] 3.2 英文路径回归 = 2.4 的同批读数（存量 875 条全绿，含 M399/Enter 全组）。
- [ ] 3.3 真机 dogfood：组合期复验（beforeinput 形态或裸 DOM 形态）——本 mission
      内不可自动化（探针 0.3），留 Alex dogfood；验收场景以派发事件的静态断言兜底。

## 4. 视觉 / 真机验收场景

- [x] 4.1 `tests/visual/scenes/lists.spec.ts` 增用例：裸行光标驻留行类在场 / 离开
      还原 / 真列表形态不受 `cm-lp-bare` 影响（结构性断言，chromium）。**绿证据**：
      `LUMIR_VISUAL_STRUCTURAL=1 bash scripts/visual/run.sh scenes/lists.spec.ts`
      → 12 passed / 0 failed（9 存量 + 3 新增；新增=门控 B1 正负侧、Enter 两态+
      单步撤销、setext 排除 + beforeinput 接线派发断言）。
- [x] 4.2 `scripts/acceptance/scenarios/153-ordered-list-auto-mode.md` 增场景：进入
      （由续行结果间接钉死）/ 续行（文档终态含 `2. `）/ 退出（空标记被删、行保留）+
      单步撤销 + 无重复 marker 对照；beforeinput 派发断言归 chromium 视觉层（套件无
      JS 通道）。`node scripts/acceptance/run.mjs --check` → 场景静态校验通过（156 个）。
      **真机实跑留 dogfood 批次**（本 mission 已用探针实例人工复验三态，证据
      test-results/m461-probe/fix1–4）。

## 5. 门禁与收尾

- [x] 5.1 `scripts/gate.sh quick` 全绿。**绿证据**：`GATE RESULT: 10/10 PASS（SKIP 0）`，
      退出码 0（首跑 9/10：tsc-unit 报 `assert.fail` 类型缺员——修为零标志位计数后复跑
      全绿；中间读数如实保留）。
- [x] 5.2 动了渲染面：本地 `scripts/gate.sh visual` 全绿。**绿证据**：
      `GATE RESULT: 12/12 PASS（SKIP 0）`（visual-regression 459s 整页像素基线零漂移
      ——新渲染态只在光标驻留裸行时出现，既有场景与基线画面不受影响）。
- [x] 5.3 真机复验：探针实例（合成 vault）三态逐态复验 + 截图证据（fix1–fix4，
      readings.md 末节）；探针插桩已回滚（src/probe-hook.ts 删除、main.ts import 摘除，
      git status 干净）。
