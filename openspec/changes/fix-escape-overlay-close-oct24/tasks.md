# Tasks: fix-escape-overlay-close-oct24

> 阶段门：0.3（Alex 节点 1 评审）通过前 MUST NOT 改产品代码 / living spec。本 change 的提案批只交付
> `proposal.md` / `design.md` / 本文件 / 两份 spec delta；实现批按本清单逐项勾选。
> 顺序是硬约束：**先红后绿**——1.x 的真机场景必须先在本实现之前的代码上判红并留证，再进 2.x–4.x。
> 实现期发现 proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / 本文件 / `specs/keymap-commands/spec.md` /
      `specs/harness/spec.md`；根因链、代码锚点与事实核验清单落进 design §2 / §8
- [x] 0.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与
      `bash scripts/docs-check.sh` 通过（含 MODIFIED delta 的归档对账）
- [x] 0.3 Alex 节点 1 评审通过（2026-10-24，原话「采纳你的提案。」；裁决口径：只关最上层并回
      还焦点、无浮层不新增任何产品动作、任何时候不能因此退出应用；兜底的安全 `preventDefault`
      不算产品行为——tower 按已认可意图裁定 B）。硬门禁已过；r1 的三项边界仍需在实现批落地并经
      fresh review，节点 1 批准不豁免它们
- [x] 0.4 裁决结果回填 proposal 的「评审记录」块，并按裁决 B 修正 design / delta 的「无浮层」
      措辞（不新增产品动作；兜底仅阻止原生默认关窗，不是新增产品行为）

## 1. 先红：真机场景与红跑证据

- [x] 1.1 新增 `scripts/acceptance/scenarios/238-escape-overlay-close.md`（**id 调整**：235/236 已被
      并行 change `improve-keybindings-lookup-oct24` 占用，改用 238/239；行为合同不变；
      front-matter 的 `item` 按 `scripts/acceptance/COVERAGE.md` 当前队列取号，随后跑
      `node scripts/acceptance/coverage.mjs` 重新生成覆盖表）。主路径逐字对齐缺陷现场：
      ⌘⇧A 开 pane → 点权限 chip → 点「完全访问」（等 chip 读数翻档 + `config.json` 的
      `permission_mode` 落 `full_access`）→ **断言浮层仍然打开**（否则测的不是「收一个开着的
      浮层」）→ 记一次 Esc 之前的 AX 快照 → `do: key { key: escape }`
- [x] 1.2 同场景的断言组：①应用仍在（AX 树仍有 `发送` 按钮与权限 chip）；②权限浮层已收
      （`完全访问` 项不再是可点节点）；③composer 仍在；④编辑器 `unchangedSince` 基线逐字节不变；
      ⑤`config.json` 的 `permission_mode` 仍是 `full_access`。缺一条不算覆盖
      （REVIEW.md「覆盖声明超出真实验证」条）
- [x] 1.3 **红跑（实现前，master 代码）**：`node scripts/acceptance/run.mjs 238`，必须 FAIL 在
      Escape 后的第一条断言；证据落 `.local/acceptance/<日期>/238-escape-overlay-close/RED-before-fix/`，
      并额外记录四样读数：Esc 之前的 AX 快照（浮层在场、无 `(focused)` 节点——根因链「焦点落到
      body」的现场证据）、Esc 之后的 AX 快照（`element_count: 1`）、
      `ps -p <pid> -o pid=,command=` 空输出、统一日志同秒的
      `windowShouldClose → WebPageProxy::close → 进程终止` 链（`log show` 摘录）
- [x] 1.4 红跑纪律：MUST NOT 用「改点 chip 收浮层」「跳步」「加 sleep」换绿；若树里已有这类临时
      处置（本缺陷报告里记过一次），先回退再跑红线，把回退记录写进证据
- [x] 1.5 新增 `scripts/acceptance/scenarios/239-escape-quit-guard.md`（退出路径反例，见 5.3；**id 调整**同 1.1），
      同样先在当前代码上跑一遍，确认它判的是「既有语义」而不是新行为。预期读数：②③ 绿（守卫与
      正常退出都是既有行为）；①在应用存活一项上可能绿、在「不出现退出拦截提示」一项上红——两种
      结果都要如实写进证据，不得把①整条记成绿

## 2. 准入判断与窗口级兜底（纯逻辑）

- [x] 2.1 新增 `src/escape-router.ts`：`escapeDisposition(event) -> "ignore" | "swallow" | "close"`
      （唯一准入：非 Escape / 组合期 → ignore；带修饰键 → swallow；无修饰 → close）、
      `EscapeLayer { id, close }`、层栈（`push` 幂等置顶 / `remove` 幂等 / `top` 按打开序）、
      `handle(event)`（先按 `defaultPrevented` 让路，再按 disposition 分派，见 design §3.1）
- [x] 2.2 `installEscapeRouter(win, router)`：`window` 冒泡阶段挂一个 keydown，返回解绑函数；
      文件头注释写明「必须最后装」的理由（design §3.1 的弃案）
- [x] 2.3 `tests/unit/escape-router.test.ts`：准入矩阵（键 × 修饰键 × 组合期 × 已消费）+ 层栈
      决策（0/1/2 层，关栈顶、关闭恰一次；无层时 `preventDefault` 但**不调用任何 `close`**）
      + 幂等 + 顺序（假 window：消费型监听在前 / 路由在后不重复关层；路由在前时用例变红）
      + 反向验证（去掉「无层也阻止默认行为」→ body 用例红并露出退出风险；栈顶改栈底 → 两层
      用例红；把 `swallow` 改成 `close` → 修饰键用例红）
- [x] 2.4 `pnpm test` 绿（只这一层，不接装配时其余用例不受影响）

## 3. 层栈与装配

- [x] 3.1 `src/main.ts`：首次 `Keymap.attach`（`:3483`）与配置重绑后的 `attach`（`:3500`）
      之后各调一次 `installEscapeRouter`；重绑时先解绑旧的再装，保持「最后装」
- [x] 3.2 `src/harness-panel.ts`：抽出 `closeTopHarnessLayer()`（权限 / 合并 / 会话 / ctx 泡 /
      effort 提示 / 面板本体的关闭与焦点回还，按层栈取最上层）；面板就地键处理器
      （`:9896-9915`）与段级会话浮层处理器（`:9869-9875`）改为**先调 `escapeDisposition`、再调
      它**——MUST NOT 保留「只看 `event.key === "Escape"` 就关层」的写法（组合期与 ⇧/⌘/⌃/⌥
      组合在兜底看到之前就会被它们关层；见 design §3.1 与 §6），也 MUST NOT 保留第二份检查顺序
      （REVIEW.md「同一语义两处真源」条）
- [x] 3.3 登记点与开合点同源：`setPermPop` / `setSelPop` / `setSessPop` / `ctxPop` 的显示切换 /
      `effHint` 的 `mouseenter` / `mouseleave` / `deps.togglePane` 的收起路径（含装配层
      `disposePaneHandle`）各登记 / 注销一次；面板收起走装配层而非组件 `setXxx` 的那条路径必须
      单独核对（design §6「层栈泄漏」）
- [x] 3.4 其余层按 design §3.5 清单登记：⌘P、大纲、vault 切换器、跳转行、搜索面板、键位面板、
      文件树菜单、标签菜单、lightbox、表格全屏、代码块全屏；每处只调用既有 `close()`，不写第二
      份关闭；这些组件的就地 Escape 处理器同样换成共享准入（组合期 / 带修饰键不关层）——逐文件
      核 `quick-open.ts` / `toc.ts` / `vault-switcher.ts` / `goto-line.ts` / `search.ts` /
      `bindings-panel.ts` / `tree-menu.ts` / `tabs.ts` / `lightbox.ts` / `table-fullscreen.ts` /
      `code-block-fullscreen.ts`，`--check` 与 3.6 场景守
- [x] 3.5 `tests/unit/escape-router.test.ts` 增补：层 `close` 抛错时栈仍前进（不让一次异常卡死
      后续 Esc）；同一 id 重复 `push` 后 `top` 指向最新一次打开
- [x] 3.6 **真实监听链**（不以 router 单测代替）：新增 `tests/visual/scenes/escape-admission.spec.ts`
      （chromium 真实 DOM + tauri-stub 装配，共 8 条；r1 P1-1 起补第 8 条「已被上游消费的 Escape
      不关层」）——①权限浮层持焦时 `⇧/⌘/⌃/⌥+Escape` 各不关层、焦点
      不动，裸 `Escape` 才关；②派发 `KeyboardEvent{ key: "Escape", isComposing: true }` 不关层；
      ③会话浮层的 `seg` 监听器重复①②；④effort 提示悬停打开后按 Escape 只收提示、焦点不动；
      ⑤反向验证：把 `panel` / `seg` 监听器改回字面判断 → 对应组必须变红（记录读数）。
      CI 的 `LUMIR_VISUAL_STRUCTURAL=1` 照跑（纯结构断言）

## 4. 重建保焦（根因修复）

- [x] 4.1 `src/harness-panel.ts` 的 `buildPermPop` 调用方：重建前记 `permMode`（语义键），重建后
      焦点落回选中项；找不到回落 `permChip`（`isConnected` 守卫，见 design §6）；条目补
      `data-mode`
- [x] 4.2 合并选择器同口径：语义键 = **段 + 该项 id**（provider 段取 provider id、model 段取
      `models[当前 provider].current`、effort 段取 `thinkLevel`）；键按**重建时的当前状态**取，
      不按点击目标取——成功路径落回新项、写回失败回滚后的重建落回旧项；条目补 `data-seg` /
      `data-id`，找回顺序 = 对应项 → 该段当前项（`is-current` / `aria-checked`）→ `modelChip`
- [x] 4.3 单测（`tests/unit/harness-panel-control.test.ts` 或同目录新文件）：三段各自的选择 →
      重建落点；写回失败回滚后的重建落点（不是失败的新项）；语义键缺失 → 回落触发钮；反向验证：
      实现返回 `null`（丢焦点）或用点击目标当键（回滚用例落错项）时用例 MUST 变红
- [x] 4.4 真机复跑 238 → **后绿**，同一份场景文件、同一批步骤，证据目录
      `.local/acceptance/<日期>/238-escape-overlay-close/GREEN-after-fix/`；报告里逐条给出
      1.2 的五条断言与 PASS 计数；同场景的 `shift+escape` 反例段一并跑绿

## 5. 同类路径回归与退出反例

- [ ] 5.1 其他浮层回归（同批新增或扩充场景，逐类一条，每步断言「应用仍在 + 层已收 + 焦点落点」）：
      **覆盖登记（2026-10-25，M718）**：③⌘P / 会话浮层 / ⑧effort 提示 / ②权限浮层已在
      `tests/visual/scenes/escape-admission.spec.ts`（真实 DOM，8 条用例全绿）覆盖；真机层
      逐类复跑：13（大纲）PASS、17（vault 切换器）PASS、109（权限 chip）PASS、
      search-01（搜索面板）PASS、227（表格全屏：Esc 关闭 + 焦点回编辑器）PASS、09（Emacs 键 /
      键位面板）PASS；223（代码块全屏）在**本分支与 master 同形 FAIL**（hover 通道取不到 bbox，
      归因见完工报告）；230（⌘P）本轮 FAIL 在**键盘注入丢键**（`nots/dp/plan.`，M497 的同族
      通道缺陷，与 Escape 无关）。**未覆盖**：⑦Context hover 泡与②合并选择器三段的「选后先断言
      焦点落在刚选中项」逐段复跑——两者在**真机层与真实 DOM 层都还没有判据**（`escape-admission`
      只覆盖权限浮层 / 会话浮层 / effort 提示 / ⌘P / 两层顺序 / body 兜底 / 重建保焦两条），留待下一批。
      ①会话浮层选中后按 Esc；②合并选择器分别选 provider / model / effort 后按 Esc（每次选择后先
      断言焦点落在刚选中的那一项）；③⌘P 输入筛选后按 Esc；④大纲浮层按 Esc；⑤搜索面板按 Esc；
      ⑥图片 / 表格 / 代码块全屏遮罩按 Esc；⑦面板内 Context hover 泡出现时按 Esc；⑧effort 提示
      悬停打开后按 Esc（只收提示、焦点不动）
- [x] 5.2 编辑器既有归属回归：表格 / 代码块横滚容器持焦按 Esc 仍走 `editor.widget-escape`（焦点
      交还编辑器）；文档内容、dirty、撤销栈不变
- [x] 5.3 `239-escape-quit-guard.md` 的三条反例：①dirty 文档按 Esc → 应用在、dirty 标记在、
      文档逐字节不变，且**不出现退出拦截提示**（用户按的是 Esc；提示出现即缺陷，哪怕数据没丢）；
      ②同一 dirty 文档按 `⌘Q` → 仍被守卫拦下、出现提示、应用不退出；③保存后按 `⌘Q` → 正常退出
      （放末步或单独 restart 场景）。证据里逐条写 PASS / FAIL，并记录①②的实际形态（有无提示）
- [ ] 5.4 全量真机跑批（`node scripts/acceptance/run.mjs`），证据落 `.local/acceptance/`；报告给
      **本轮做了定向批而非全量批**（238/239 + 上面 5.1 登记的 8 条，见完工报告）：全量 237 条单跑
      约 2–4 小时机时，超出本次窗口；残留的全量批由 tower 安排在批次收尾或 dogfood 合并后跑。报告给
      逐场景 PASS / FAIL 与证据路径，FAIL 项区分「产品缺陷」与「运行无效（退出码 2）」

## 6. 验证

- [x] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（37 passed / 0 failed）
- [x] 6.2 `bash scripts/docs-check.sh` 通过（MODIFIED 段落逐字落定、覆盖表与场景一致、backlog 出口合规）
- [x] 6.3 `bash scripts/gate.sh quick` 全绿（`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0）（照抄 `GATE RESULT` 原文行与退出码，不复述成 X/Y PASS）
- [x] 6.4 `bash scripts/gate.sh visual` 全绿（动过焦点 / 浮层行为，本地必跑；CI 绿不代表像素层没回归；
      含 3.6 的 `escape-admission` 结构场景）。**tower 批准 A 后**把 `typography.spec.ts` 的
      「窗口级 keydown 监听只有一条」判据改为「一条分发器 + 一条 Escape 安全消费者」，并按 tower
      要求补两条功能判据（⌘= 只放大一档 / 无层 Escape 不关层不移焦）；RV：摘掉兜底后该判据与
      `escape-admission` 的 body 用例同批变红。原文：`GATE RESULT: 15/15 PASS（SKIP 0）`（833 passed /
      1 skipped / 0 failed，9.0m）。
- [x] 6.5 `node scripts/acceptance/run.mjs --check` 通过（237 个场景）（场景语法与断言形态）
- [x] 6.6 反向验证记录写进完工报告：去掉窗口级兜底 → 238 必须变红（附红跑读数）；去掉重建保焦
      → 4.3 单测必须变红；把兜底改成「层栈为空不阻止默认行为」→ 2.3 的 body 用例必须变红；把
      `panel` / `seg` 监听器改回「只看 `key === "Escape"`」→ 3.6 的修饰键 / 组合期组必须变红
      （这是 r1 P1 的防线）

## 7. 收尾

- [ ] 7.1 归档时核对 `openspec/specs/harness/spec.md` 的「浮层可访问性」条整块替换后逐段仍在
      （`node scripts/openspec-archive-check.mjs --archived fix-escape-overlay-close-oct24`）
- [x] 7.2 `docs/backlog.md` 补一条归档跟踪条目（格式见 `scripts/openspec-archive-check.mjs` 的
      `QUEUE_ENTRY`：列表项 + 加粗首段 + 反引号包住的 change id），节点 2 状态与归档顺序按批次
      收尾口径填写
- [x] 7.3 实现期发现的、不在本 change 射程的浮层重建 / 焦点缺陷：登记 finding，不就地扩 scope
      （本轮登记：验收套件缺「断言进程死亡」的动词——239 的 ③ 因此只能判「⌘Q 不被守卫拦下 +
      app 能重起」；会话浮层的行内删除后重建仍会把焦点送出浮层（与本 change 同族，未修））
