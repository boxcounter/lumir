# Tasks: improve-harness-streaming-scroll

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现
> proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。
>
> 起草期裁决点 D1–D8 见 [proposal.md](proposal.md)；本文件按「倾向」列拆任务，若裁另一侧，先按
> proposal 的「若你选另一侧」改设计再动工。
>
> 实现：mission M644（branch `feat/impl-harness-streaming-scroll-lock-oct23`）。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/harness/spec.md` / 本文件
- [x] 0.2 Alex 节点 1 评审通过（硬门禁；D1–D8 一并裁决，其中 D8 可默认）——2026-10-23「按倾向」，
      D1–D8 全部按「倾向」列定案（留痕已补进 `proposal.md` 的评审记录）
- [x] 0.3 按裁决结果修订 delta / design / 本文件——无改侧项；实现期只补两处实证记录（design §2
      「自写回声」守卫、§3.1 第 7 行改走 `contentReplaced()`），delta 与 proposal 的意图不变

## 1. 纯模型层（`src/harness-scroll-lock.ts`）

- [x] 1.1 `ScrollMetrics` / `FOLLOW_ATTACH_PX=6` / `FOLLOW_DETACH_PX=16` / `distanceFromBottom` /
      `bottomScrollTop` / `reduceFollow`（design §2 的真值表，含滞回与负距底）
- [x] 1.2 `createFollowController(surface)`：`onScroll`（唯一换态入口）/ `contentGrew`（following
      只排队、detached 只置未读）/ `flushNow`（rAF 尾部同帧写）/ `jumpToBottom` / `viewportChanged` /
      `reset`；`render` 只在 `{phase, unread}` 变化时调用。实现期新增两处同源收口：
      `contentReplaced()`（错误行同文案去重：高度不变也点亮未读，spec「脱离态下重复错误」条）与
      自写回声守卫（写底产生的 scroll 事件在布局变化后不误判成用户上滚）
- [x] 1.3 单测 `tests/unit/harness-scroll-lock.test.ts`（零 DOM）：**先造会红的输入**再实现——
      四行真值表、滞回区间两侧、橡皮筋负距底、不足一屏、detached 下 `contentGrew` 零写入、
      following 下增长只排队（手动调度器跑一次才写）、**排队后用户先滚走 → 零写入**、
      `contentGrew`/`flushNow`/`viewportChanged` 不改态、未读基线随 `scrollHeight` 增长、
      `jumpToBottom` 清未读、`reset` / `viewportChanged` 的写与不写、回声守卫（吞一次 + 补贴底）
- [x] 1.4 反向验证并落档：把「detached 不写」的排队复核删掉 → 「竞态…零写入」必红（实测
      `writes=[1500]`、期望 `[]`）；把滞回改成单一阈值 → 四条必红（含「滞回区间…10px 不脱离」
      实测 `detached`、期望 `following`）。两条读数写进测试文件头

## 2. 面板接线（`src/harness-panel.ts`）

- [x] 2.1 16 处 `scrollToBottom()` 逐点分流（design §3.1 的表）：13 处「增长」走 `contentGrew()`
      （其中 `appendError` 去重分支走 `contentReplaced()`），3 处「强制」（`appendUserMessage` /
      `restoreSnapshot` / `resumeSession`）走 `jumpToBottom()`；`scrollToBottom()` 定义整条删除，
      `rg "scrollTop" src/harness-panel.ts` 复核只剩适配器里的唯一写入口
- [x] 2.2 transcript 的 `scroll` 监听（passive）+ 适配器（`read` / `writeScrollTop` / `schedule` /
      `render`）
- [x] 2.3 rAF 合帧的未读补扫：`flushChunks()` 之后、仅 `detached` 时 `contentGrew()`（纯思考帧的
      未读；following 不新增「思考帧贴底」的行为）
- [x] 2.4 `attachTo()` 挂载后 `jumpToBottom()`；`resetView()` 末尾 `reset()`；`ResizeObserver` 观察
      transcript 盒尺寸（覆盖窗口缩放与分栏拖拽两条路径），回调 `viewportChanged()`
- [x] 2.5 适配器 `render`：浮钮 `hidden` 与未读类的唯一施加点（`applyJumpBottomState`）；态 / 未读
      每次变化只走这一处，`applyLabels()` 重取文案时走同一个函数

## 3. 浮钮与文案

- [x] 3.1 `src/harness-panel.css`：`.lumir-hp-transcript-viewport`（relative 视口层）+ `.lumir-hp-jumpbottom`
      （26×26、`--r-pill`、`--preview-bg` 面、1px `--border`、`--shadow-raise`（eink none）、
      `--text-2` 图标、`--hover` 叠层反馈、`z-index: 10`）+ 未读圆点（6px、`--accent`）；无动效
      （reduced-motion 天然零差异）；浮钮默认 `hidden`（作者样式的 `[hidden]` 显隐显式补一条）
- [x] 3.2 浮钮 DOM（DOM API 构造，SVG ↓，`aria-hidden`）；`title` + `aria-label` 取文案；
      消息摘录钮 z 序（15）高于回底钮（10）；点击后若钮持有焦点则交还 composer（design §4.3）
- [x] 3.3 两条新文案进 deck 与运行时表（动工时 deck 末位已到 D554 → 顺延取 **D555 / D556**：
      「回到底部」/「有新内容，回到底部」+ en 列）；`tests/unit/copy.test.ts` 漂移门禁绿
- [x] 3.4 `applyLabels()` 重取浮钮可访问名（语言切换 + 每次态 / 未读变化）；`onRelabel` 路径不
      重渲 transcript
- [x] 3.5 视觉核对：浮钮 `hidden` 时既有基线零漂移（本地 `scripts/gate.sh visual` 全量像素模式
      通过：`GATE PASS visual-regression 531s`）——视口层盒模型逐值接管 transcript 的 flex 位，
      未出现漂移，未做任何 `--update`

## 4. 验收面

- [x] 4.1 视觉场景 `tests/visual/scenes/m638-harness-scroll-lock.spec.ts`（design §5.2 的 10 条，
      另加 en 档文案一条）：前提（确实 3 屏溢出）、跟随时贴底、上滚脱离、**核心断言（注入 20 chunk
      后 scrollTop 不变 ±1px）**、点钮回底、滞回、发送白名单、非用户事件不拽、不足一屏、三主题 +
      zh/en 文案——5 条用例全绿（chromium 全量模式）
- [x] 4.2 视觉场景反向验证：把 2.1 的「增长」临时改回无条件写底，核心断言必红（实测
      `scrollTop` 相对锚点位移 **1702px**、判据 ≤ 1）；读数写进场景文件头
- [x] 4.3 真机验收场景 `scripts/acceptance/scenarios/224-harness-scroll-lock.md` + mock fixture
      `fixtures/harness-mock-scroll-lock.json`（`chunk_delay_ms: 600` 撑流式窗口；先等内容溢出
      视口再上滚）：首片 → 内容溢出 → 上滚 → 钮在场（`ax.has`）→ 末片上屏后钮仍在 + 未读名在场
      → 点钮 → 钮退场 + 底部行带像素有字形。编号接 223 之后（220–223 已占）
- [x] 4.4 **滚动通道探针**（静态半程）：`do: scroll` 的 KimiCU 通道在 M252 / M379 从未产出过位移，
      本次按 design 的可行修法给 `scripts/acceptance/lib/cgevent-click.swift` 补 wheel mode
      （mode 8，swift + CGEvent 与 doubleClick / drag 同一条已验证通道），`do: scroll` 在
      KimiCU 自报无位移且显式给了 `dy` / `dx` 时退到它，并在证据里留自报行。**真机探针未跑**
      （需 tower 协调窗口）：首跑结论回填 README「已知边界」的滚动条
- [x] 4.5 回扫既有场景与视觉基线：`rg` 既有 harness 场景里对「transcript 在底部 / 错误行可见 /
      恢复后末条可见」的期望——语义不变（16 处分流保持原有「内容增长即贴底」（follow 态）与
      「恢复 / 发送 / 重开面板强制回底」）；`node scripts/acceptance/run.mjs --check` 通过
      （221 个场景，含 224）
- [x] 4.6 真机执行 4.3（需 tower 协调窗口），把证据落 `.local/acceptance/<日期>/` 并在报告里给
      可 `ls` 的绝对路径——**已执行**（2026-10-24，M710 复核既有跑批）：`node scripts/acceptance/run.mjs 224`
      → `结论：1/1 PASS`（19 断言 / 0 失败 / 26.3s，exit 0）；证据
      `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-10-24/224-harness-scroll-lock/`
      （`steps.md` / `shots/` / `ax/` / `meta.json`）。断言覆盖：首片上屏、内容溢出、上滚后浮钮浮现、
      流式收口期间钮始终在场（没有任何一次增量把视口拽回）、末片上屏后未读名在场、点钮退场并回底

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（gate 的
      `openspec-validate` 门禁 PASS）
- [x] 5.2 `bash scripts/docs-check.sh` 通过（相对链接 + 归档对账；gate 的 `docs-check` 门禁 PASS）
- [x] 5.3 `bash scripts/gate.sh quick` 全绿——`GATE RESULT: 11/11 PASS（SKIP 0）`（退出码 0）
- [x] 5.4 `bash scripts/gate.sh visual` 全绿（动过 `src/harness-panel.css` 与视觉场景，必须本地跑；
      CI 绿不代表像素层没回归）——`GATE RESULT: 13/13 PASS（SKIP 0）`（退出码 0；含
      `isolation-runs` 与 `visual-regression 531s` 全量像素对比，m638 新场景 5 条用例在列）
- [x] 5.5 信息卫生清扫：新增 fixture / 场景 / 文档对改动面做了一次 text 级 grep，真实 vault 内容、
      真实路径、真实人名零命中（唯一 `.local/` 字样是证据目录指针，与既有场景同形）

## 6. 归档准备（节点 2）

- [x] 6.1 tasks 全部勾选或就地标注放弃原因；delta 与实现一致性逐条对账
      —— 2026-10-24（M710）对账：除 6.2 / 6.3 的「归档后」半步（归档动作本身，不是实现缺口）外全部
      勾选或就地标注；delta 两条 requirement 与实现逐条对上——ADDED「transcript 的跟随滚动与回到底部」
      = `src/harness-scroll-lock.ts`（`FOLLOW_ATTACH_PX = 6` / `FOLLOW_DETACH_PX = 16` 的双阈值滞回、
      `contentGrew` 只排队不写、`contentReplaced`、白名单 `jumpToBottom` / `reset`）+ `src/harness-panel.ts`
      的 16 处分流与 `ResizeObserver → viewportChanged()`（`:4180`）+ `src/harness-panel.css:326` 的
      视口层与 `:357` 的 `.lumir-hp-jumpbottom`（`:376` 有 `[hidden]` 显式补条）；MODIFIED「错误呈现」
      的「脱离态下重复错误不拽走视口」由 `contentReplaced()` 承担。判据面在场：单测
      `tests/unit/harness-scroll-lock.test.ts`（含两条反向必红读数）、视觉
      `tests/visual/scenes/m638-harness-scroll-lock.spec.ts`（5 条用例 + 反向必红 1702px 读数）、
      真机 224（19 断言 PASS，见 4.6）。文案 D555 / D556 在 `src/copy-data.ts:1751-1752` 与
      `文案-Copy.md:537-538` 两列同在。
- [ ] 6.2 `node scripts/openspec-archive-check.mjs` 通过；归档后对 `<change-id>` 跑一次 `--archived`
      —— **归档前半步已跑**（2026-10-24，M710）：门禁模式 `PASS`（该 delta 的两条 MODIFIED 逐段对比
      living spec，无静默丢段）；`--archived` 只能对已归档的 commit 跑，留给节点 2 归档后（动作记在
      `docs/backlog.md` 的归档跟踪队列条目）。
- [ ] 6.3 归档后核对 living spec 的 requirement 段落完整（MODIFIED 整块替换、ADDED 并入），并顺手
      核对本次两条文案的 deck 漂移门禁
      —— **归档后步骤**：living spec 的 `harness/spec.md` 归档后才含「跟随滚动与回到底部」条，归档前
      无从核对。文案 deck 漂移门禁本轮已跑：`node --experimental-strip-types --import
      ./tests/unit/register.mjs --test tests/unit/copy.test.ts` → `pass 15 / fail 0`（含 D555 / D556
      的取值门禁与两张表漂移对账）。
