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
- [ ] 0.3 Alex 节点 1 评审通过（硬门禁；D1–D5 一并裁决，未回的按 proposal 里的倾向落地）
- [ ] 0.4 裁决结果回填 proposal 的「评审记录」块（逐字），按裁决修正 design 与 delta

## 1. 先红：真机场景与红跑证据

- [ ] 1.1 新增 `scripts/acceptance/scenarios/235-escape-overlay-close.md`（id 235 当前未占用；
      front-matter 的 `item` 按 `scripts/acceptance/COVERAGE.md` 当前队列取号，随后跑
      `node scripts/acceptance/coverage.mjs` 重新生成覆盖表）。主路径逐字对齐缺陷现场：
      ⌘⇧A 开 pane → 点权限 chip → 点「完全访问」（等 chip 读数翻档 + `config.json` 的
      `permission_mode` 落 `full_access`）→ **断言浮层仍然打开**（否则测的不是「收一个开着的
      浮层」）→ 记一次 Esc 之前的 AX 快照 → `do: key { key: escape }`
- [ ] 1.2 同场景的断言组：①应用仍在（AX 树仍有 `发送` 按钮与权限 chip）；②权限浮层已收
      （`完全访问` 项不再是可点节点）；③composer 仍在；④编辑器 `unchangedSince` 基线逐字节不变；
      ⑤`config.json` 的 `permission_mode` 仍是 `full_access`。缺一条不算覆盖
      （REVIEW.md「覆盖声明超出真实验证」条）
- [ ] 1.3 **红跑（实现前，master 代码）**：`node scripts/acceptance/run.mjs 235`，必须 FAIL 在
      Escape 后的第一条断言；证据落 `.local/acceptance/<日期>/235-escape-overlay-close/RED-before-fix/`，
      并额外记录四样读数：Esc 之前的 AX 快照（浮层在场、无 `(focused)` 节点——根因链「焦点落到
      body」的现场证据）、Esc 之后的 AX 快照（`element_count: 1`）、
      `ps -p <pid> -o pid=,command=` 空输出、统一日志同秒的
      `windowShouldClose → WebPageProxy::close → 进程终止` 链（`log show` 摘录）
- [ ] 1.4 红跑纪律：MUST NOT 用「改点 chip 收浮层」「跳步」「加 sleep」换绿；若树里已有这类临时
      处置（本缺陷报告里记过一次），先回退再跑红线，把回退记录写进证据
- [ ] 1.5 新增 `scripts/acceptance/scenarios/236-escape-quit-guard.md`（退出路径反例，见 5.3），
      同样先在当前代码上跑一遍，确认它判的是「既有语义」而不是新行为。预期读数：②③ 绿（守卫与
      正常退出都是既有行为）；①在应用存活一项上可能绿、在「不出现退出拦截提示」一项上红——两种
      结果都要如实写进证据，不得把①整条记成绿

## 2. 窗口级兜底（纯逻辑）

- [ ] 2.1 新增 `src/escape-router.ts`：`EscapeLayer { id, close }`、层栈（`push` 幂等置顶 /
      `remove` 幂等 / `top` 按打开序）、`handle(event)` 决策表（非 Escape / 组合期 / 已消费 /
      带修饰键 / 有层 / 无层六分支，见 design §3.1）
- [ ] 2.2 `installEscapeRouter(win, router)`：`window` 冒泡阶段挂一个 keydown，返回解绑函数；
      文件头注释写明「必须最后装」的理由（design §3.1 的弃案）
- [ ] 2.3 `tests/unit/escape-router.test.ts`：决策矩阵（键 × 组合期 × 已消费 × 层数 0/1/2 ×
      焦点位置）+ 幂等 + 顺序（假 window：消费型监听在前 / 路由在后不重复关层；路由在前时用例
      变红）+ 反向验证两条（去掉「无层也消费」→ body 用例红；栈顶改栈底 → 两层用例红）
- [ ] 2.4 `pnpm test` 绿（只这一层，不接装配时其余用例不受影响）

## 3. 层栈与装配

- [ ] 3.1 `src/main.ts`：首次 `Keymap.attach`（`:3483`）与配置重绑后的 `attach`（`:3500`）
      之后各调一次 `installEscapeRouter`；重绑时先解绑旧的再装，保持「最后装」
- [ ] 3.2 `src/harness-panel.ts`：抽出 `closeTopHarnessLayer()`（权限 / 合并 / 会话 / ctx 泡 /
      面板本体的关闭与焦点回还，按层栈取最上层），面板就地键处理器（`:9896-9915`）与段级会话
      浮层处理器（`:9869-9875`）改为调用它——**同一份关闭实现**，不留第二份检查顺序
      （REVIEW.md「同一语义两处真源」条）
- [ ] 3.3 登记点与开合点同源：`setPermPop` / `setSelPop` / `setSessPop` / `ctxPop` 的显示切换 /
      `deps.togglePane` 的收起路径（含装配层 `disposePaneHandle`）各登记 / 注销一次；面板收起走
      装配层而非组件 `setXxx` 的那条路径必须单独核对（design §6「层栈泄漏」）
- [ ] 3.4 其余层按 design §3.5 清单登记：⌘P、大纲、vault 切换器、跳转行、搜索面板、键位面板、
      文件树菜单、标签菜单、lightbox、表格全屏、代码块全屏；每处只调用既有 `close()`，不写第二
      份关闭
- [ ] 3.5 `tests/unit/escape-router.test.ts` 增补：层 `close` 抛错时栈仍前进（不让一次异常卡死
      后续 Esc）；同一 id 重复 `push` 后 `top` 指向最新一次打开

## 4. 重建保焦（根因修复）

- [ ] 4.1 `src/harness-panel.ts` 的 `buildPermPop` 调用方：重建前记 `permMode`（语义键），重建后
      焦点落回选中项；找不到回落 `permChip`（`isConnected` 守卫，见 design §6）
- [ ] 4.2 合并选择器同口径：语义键 = 当前 provider id / effort id；重建后按同一键找回，找不到
      回落 `modelChip`
- [ ] 4.3 单测（`tests/unit/harness-panel-control.test.ts` 或同目录新文件）：给定旧语义键与重建
      后的项列表，断言落点；语义键缺失 → 回落触发钮；反向验证：实现返回 `null`（丢焦点）时用例
      变红
- [ ] 4.4 真机复跑 235 → **后绿**，同一份场景文件、同一批步骤，证据目录
      `.local/acceptance/<日期>/235-escape-overlay-close/GREEN-after-fix/`；报告里逐条给出
      1.2 的五条断言与 PASS 计数

## 5. 同类路径回归与退出反例

- [ ] 5.1 其他浮层回归（同批新增或扩充场景，逐类一条，每步断言「应用仍在 + 层已收 + 焦点落点」）：
      ①会话浮层选中后按 Esc；②合并选择器切 provider 后按 Esc；③⌘P 输入筛选后按 Esc；④大纲浮层按
      Esc；⑤搜索面板按 Esc；⑥图片 / 表格 / 代码块全屏遮罩按 Esc；⑦面板内 Context hover 泡出现时
      按 Esc
- [ ] 5.2 编辑器既有归属回归：表格 / 代码块横滚容器持焦按 Esc 仍走 `editor.widget-escape`（焦点
      交还编辑器）；文档内容、dirty、撤销栈不变
- [ ] 5.3 `236-escape-quit-guard.md` 的三条反例：①dirty 文档按 Esc → 应用在、dirty 标记在、
      文档逐字节不变，且**不出现退出拦截提示**（用户按的是 Esc；提示出现即缺陷，哪怕数据没丢）；
      ②同一 dirty 文档按 `⌘Q` → 仍被守卫拦下、出现提示、应用不退出；③保存后按 `⌘Q` → 正常退出
      （放末步或单独 restart 场景）。证据里逐条写 PASS / FAIL，并记录①②的实际形态（有无提示）
- [ ] 5.4 全量真机跑批（`node scripts/acceptance/run.mjs`），证据落 `.local/acceptance/`；报告给
      逐场景 PASS / FAIL 与证据路径，FAIL 项区分「产品缺陷」与「运行无效（退出码 2）」

## 6. 验证

- [ ] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 6.2 `bash scripts/docs-check.sh` 通过（MODIFIED 段落逐字落定、覆盖表与场景一致、backlog 出口合规）
- [ ] 6.3 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行与退出码，不复述成 X/Y PASS）
- [ ] 6.4 `bash scripts/gate.sh visual` 全绿（动过焦点 / 浮层行为，本地必跑；CI 绿不代表像素层没回归）
- [ ] 6.5 `node scripts/acceptance/run.mjs --check` 通过（场景语法与断言形态）
- [ ] 6.6 反向验证记录写进完工报告：去掉窗口级兜底 → 235 必须变红（附红跑读数）；去掉重建保焦
      → 4.3 单测必须变红；把兜底改成「层栈为空不消费」→ 2.3 的 body 用例必须变红

## 7. 收尾

- [ ] 7.1 归档时核对 `openspec/specs/harness/spec.md` 的「浮层可访问性」条整块替换后逐段仍在
      （`node scripts/openspec-archive-check.mjs --archived fix-escape-overlay-close-oct24`）
- [ ] 7.2 `docs/backlog.md` 补一条归档跟踪条目（格式见 `scripts/openspec-archive-check.mjs` 的
      `QUEUE_ENTRY`：列表项 + 加粗首段 + 反引号包住的 change id），节点 2 状态与归档顺序按批次
      收尾口径填写
- [ ] 7.3 实现期发现的、不在本 change 射程的浮层重建 / 焦点缺陷：登记 finding，不就地扩 scope
