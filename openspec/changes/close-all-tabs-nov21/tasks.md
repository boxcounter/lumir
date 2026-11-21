# Tasks: close-all-tabs-nov21

> `openspec/specs/**` 活跃期只读；所有规格变更只写本 change 的 delta。
> 实现期发现 proposal 意图需要变更时，停下更新 proposal，不静默扩 scope。

## 0. 提案

- [x] 0.1 起草 `proposal.md` / `specs/multi-tabs/spec.md` / 本文件（最小 change：无独立 design.md，
      行为细节与裁决点写在 proposal）
- [x] 0.2 需求原话与 D1–D3 记入 proposal 的「评审记录」与「裁决点」块

## 1. 实现（`src/tabs.ts` / `src/main.ts`）

- [x] 1.1 `tabMenuItems()` 追加第五项 `{ action: "close-all", label: TAB_MENU_CLOSE_ALL() }`；
      `TabMenuAction` 加 `"close-all"`
- [x] 1.2 `closeAllTargets(sessions)`：本 pane 全部可见标签（`visibleTabsOf`），排除未命名草稿
- [x] 1.3 `runTabMenuAction` 的 `close-all` 分支：`activatePane()` → `closeEach(targets, resolveClose)`；
      复用的确认流是 `showCloseConfirm`（D92 / D93.x），不改一字节
- [x] 1.4 批量收尾：本 pane 一条可见标签都不剩时 `focusEditor()`（新增注入依赖
      `focusEditor = handle.focusPreservingReadingPosition`，MUST NOT 裸 `view.focus()`）；
      停手时不动焦点
- [x] 1.5 模块头 / 项集 / 菜单机制注释同步为新项（MUST NOT 留下「四项」口径的旧注释）

## 2. 文案

- [x] 2.1 `src/copy-data.ts` 新增 `D943`（`zh: 关闭全部标签` / `en: Close All Tabs` / `lock: "en"`）
- [x] 2.2 `文案-Copy.md`：新增 D943 行、更新「当前末位」、分配记录、D 区间映射表与锁列断言口径

## 3. 单测

- [x] 3.1 `tests/unit/tab-menu.test.ts`：项集五项与文案逐字、键盘末项钳制（Close All Tabs）、
      `closeAllTargets` 的集合 / 顺序 / 未命名草稿负向用例
- [x] 3.2 `tests/unit/tabs.test.ts`：全 clean 按打开顺序关完 + `focusEditor` 一次；
      多 dirty 的逐个确认、取消停手（已关不回滚）、放弃后继续到关完
- [x] 3.3 `tests/unit/copy.test.ts`：锁列断言覆盖 D943

## 4. 浏览器测试（`tests/visual/scenes/tab-menu.spec.ts`）

- [x] 4.1 菜单五项与键盘游标（⌃N 到末项、钳制、⌃P 回退）
- [x] 4.2 全 clean：全部关闭、`tabstrip` hidden、modeline「无当前文件」、树无高亮、
      `.cm-content` 获焦、标题栏与正文区顶边不动
- [x] 4.3 多 dirty：alpha 先关（不回滚）→ beta 确认 → 取消停手 → 放弃 beta → gamma 确认（只有一条）→
      保存并关闭 → 空态 + 焦点；磁盘：beta 未写、gamma 落盘
- [x] 4.4 vault 外只读 + 图片会话：一次关完、零确认
- [x] 4.5 双 pane 作用域：右键右 pane 的标签只关右 pane，左 pane 两条不动

## 5. 真机验收场景（真机由主会话统一执行）

- [x] 5.1 `scripts/acceptance/scenarios/50-tab-context-menu.md`：菜单断言补「Close All Tabs」；
      末尾新增一整段（多脏构造、取消停手、放弃/保存继续、空态 + `ax: { focused: "AXTextArea" }`、
      磁盘 `DISK-VERSION` 与 `ALL-GGG` 两条读数）
- [x] 5.2 场景注释登记覆盖分工与「未命名 dirty 在真机不可达」的边界（单测负向用例承担）
- [x] 5.3 `node scripts/acceptance/coverage.mjs` 重生成 `COVERAGE.md`；
      `bash scripts/acceptance/check-suite.sh` 绿
- [ ] 5.4 真机执行场景 50（主会话统一跑）；证据落 `.local/acceptance/`

## 6. 门禁与证据

- [x] 6.1 根 `tsc --noEmit` 与 `tests/visual/tsconfig.json` 均 0 错误
- [x] 6.2 `node tests/unit/run.mjs` 全绿（读数见完工报告）
- [x] 6.3 `LUMIR_VISUAL_STRUCTURAL=1 LUMIR_VISUAL_PORT=4285 playwright test scenes/tab-menu.spec.ts`
      14/14 PASS
- [ ] 6.4 像素层：两条菜单元素级基线因多一行而变化，待 Alex 过目后 `--update`（本 mission 不更新基线）
- [x] 6.5 `openspec validate --all --strict` / `bash scripts/docs-check.sh` / `run.mjs --check`
- [ ] 6.6 证据与完工报告对账后提交（source only），TowerComplete

## 7. 归档（节点 2）

- [ ] 7.1 节点 2 归档评审通过后 `openspec archive close-all-tabs-nov21`
      （批次收尾执行；本 change 活跃期不改 living spec / backlog）
