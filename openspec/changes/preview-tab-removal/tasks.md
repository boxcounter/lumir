# Tasks: preview-tab-removal

## 1. 打开意图收敛（树 → 装配层）

- [x] 1.1 `src/tree.ts`：`onOpenFile` 去掉意图参数（签名收成 `(path, kind)`），单击 / 双击 / ⌘-点击统一走 `open()`；删掉 `metaKey` 分支与 `dblclick` 监听（浏览器在 dblclick 前已派发两次 click，第二次命中「已打开 → 切到既有标签」）
- [x] 1.2 `src/main.ts`：`openFile` 的意图参数收成 `"new" | "current"`；文件树接线取 `"new"`
- [x] 1.3 `src/main.ts`：`save-controller` 的 `OpenIntent` 适配层（非 `"current"` 一律按 `"new"` 处理，附注释说明它的 union 收窄是后续改动）；`openPinned`（vault 恢复）取 `"new"`
- [x] 1.4 删除「预览标签首次输入即固定」的 `onDocChanged` 整块（连同它调 `switcher.sessionChanged()` 的说明），保留行数那条同通道监听
- [x] 1.5 删除 `openFile` 里 `if (intent === "pinned") existing.preview = false;`（已打开 → 切过去的短路保留）

## 2. 标签表现层去预览

- [x] 2.1 `src/tabs.ts`：`renderTabs` 去掉 `is-preview` 类；`targetSessionFor` 的 `"preview"` 分支删除，`"new"` 落点复用「还没有文件的干净空会话」，没有就新建
- [x] 2.2 `src/style.css`：删除 `.tab.is-preview .tab-name` 斜体规则与它的注释
- [x] 2.3 全仓核对 `is-preview` 零残留（`rg 'is-preview' src/ tests/` 零命中）

## 3. 数据面清理（tower 2026-09-27 扩大 scope 后）

- [x] 3.1 `src/editor.ts`：删除 `EditorSession.preview` 字段声明（含注释）与 `makeSession` 里的 `preview: false`
- [x] 3.2 `src/vault-switcher.ts`：`sessionSnapshot` 的过滤去掉 `&& !session.preview`（改成「全部有路径的标签入盘」），注释同步
- [x] 3.3 `tests/unit/vault-switcher.test.ts`：「预览标签不入盘」与「被提升为固定后落盘」两个用例改写 / 删除（前者改成「全部标签入盘、激活项落 null 的两种来由」，后者整条删除并留一段说明它在防什么）
- [x] 3.4 `文案-Copy.md`：D99 的「预览标签不入盘」改述为「全部有路径的标签都入盘」

## 4. 既有验收场景改齐（tower 2026-09-27 扩大 scope 后）

- [x] 4.1 `scripts/acceptance/scenarios/14-tabs.md`：标题、第一步（不再有预览态）、「单击第二个文件另开标签」、「空态之后继续开」、凑三标签的前置、结论段逐处改写
- [x] 4.2 `scripts/acceptance/scenarios/31-code-variable-highlight.md`：双击通道那条注解里过时的 `open("preview")` / 「双击固定预览标签」表述改准（判据失效的理由不变，换成 M254 的口径）
- [x] 4.3 `node scripts/acceptance/run.mjs --check` 全场景通过（57 个，含 14 / 31）

## 5. 视觉测试的判据同步（判据被本 change 改变了前提的三处）

- [x] 5.1 `tests/visual/scenes/m149-tabs.spec.ts`：「空态隐藏、单标签常驻、无预览字形、dirty 点」改为计算属性判据（`fontStyle` 全 normal）+ 基线改名 `tab-bar-preview` → `tab-bar-single`；「打开意图」改写为「单击 / ⌘-点击 / 双击都是开一个标签」+ 基线改名 `tab-bar-two-pinned` → `tab-bar-two-tabs`
- [x] 5.2 `tests/visual/scenes/m182-image-first-open-width.spec.ts`：warm 路径由「单击另一个文件再单击回来」改为「关掉标签再单击打开」——原流程在 M254 之前是**就地替换（重新装载）**，现在单击只切标签（不装载、且保留该标签自己的滚动位置 ⇒ 渲染范围比首开窄，末尾图片不在 DOM 里）。实测证据见 review-request：同一序列改用 ⌘-点击（改前改后同一条代码路径）复现同一读数，证明这不是本 change 引入的行为变化
- [x] 5.3 `tests/visual/scenes/m198-code-variable-highlight.spec.ts`：「切文件不残留」第三步改写——回到原文件现在是切到它自己的标签，装饰按那个标签的选区重建（逐标签保留语义），断言随之改成「新文件零装饰 + 切回按原选区重建」
- [x] 5.4 `tests/visual/scenes/readiness.spec.ts`：A/B/A 的第三次打开改为「先关掉 a 的标签再单击打开」——单击一个已打开的文件不再装载、因此不再派发 ready 事件（本用例要判的是「同一条路径的第二次装载把 ready 绑对」，必须走一次真正的装载）
- [x] 5.5 `tests/visual/scenes/tab-menu.spec.ts` 新增场景里的 `.ft-menu` 类名撞车修掉（见同批 change 的 design §二：标签菜单只带 `.tab-menu`，否则树菜单按 `.ft-menu` 找菜单的 14 条用例全变成 strict violation）

## 6. 验证

- [x] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（21 passed / 0 failed）
- [x] 6.2 `npx tsc --noEmit -p tsconfig.json` 通过（含 tests/unit 层）；`node tests/unit/run.mjs` 全绿（386 passed）
- [x] 6.3 `scripts/gate.sh quick` 全绿（10/10 PASS，SKIP 0）
- [x] 6.4 `scripts/gate.sh visual` 全绿（`test-results/m254/gate-visual.log`；全量末轮 478 passed / 1 skipped / 0 failed）
- [x] 6.5 真机复跑改齐后的场景 14：**PASS 51 断言 / 0 失败 / 49.8s**（`test-results/acceptance/2026-09-27/14-tabs/`）——「单击即开标签」在真实 WKWebView 上成立

## 7. 基线处置

- [x] 7.1 全量视觉跑一遍，列出失配清单；逐张判定「失配是否恰为去斜体的预期效果」（第一轮 19 failed 逐条归因：2 条改名基线的「缺失即写」、14 条标签菜单类名撞车、3 条判据前提被本 change 改变的用例【2+14+3=19，数字与 `visual-full-run1.log` 一致】；归因全文见 `visual-full-run1.log` 与过目包）
- [x] 7.2 生成前后对照过目包（主 checkout `test-results/m254/baseline-review/`：四张图 + 两张删除 + 逐张读数与人工读图结论）
- [x] 7.3 只重建判定通过的基线（两张改名重建 + 两张新增），删除两张失去对象的旧名基线；零静默更新——`tab-bar-dirty` / `tab-close-confirm-toast` 两张 sha256 未变即为「只动了该动的」的证明

## 8. 收口

- [x] 8.1 `docs/backlog.md` 登记：本批两个 change 的待归档跟踪（第 39 条）、`OpenIntent` union 与生成的 bindings 注释两处遗留（「待修 findings」新条目）
- [x] 8.2 review-request 逐任务对账
