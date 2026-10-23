# Tasks: improve-harness-streaming-scroll

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现
> proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。
>
> 起草期裁决点 D1–D8 见 [proposal.md](proposal.md)；本文件按「倾向」列拆任务，若裁另一侧，先按
> proposal 的「若你选另一侧」改设计再动工。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/harness/spec.md` / 本文件
- [ ] 0.2 Alex 节点 1 评审通过（硬门禁；D1–D8 一并裁决，其中 D8 可默认）
- [ ] 0.3 按裁决结果修订 delta / design / 本文件（D1–D8 任一改侧时先改制品再动工）

## 1. 纯模型层（`src/harness-scroll-lock.ts`）

- [ ] 1.1 `ScrollMetrics` / `FOLLOW_ATTACH_PX=6` / `FOLLOW_DETACH_PX=16` / `distanceFromBottom` /
      `bottomScrollTop` / `reduceFollow`（design §2 的真值表，含滞回与负距底）
- [ ] 1.2 `createFollowController(surface)`：`onScroll`（唯一换态入口）/ `contentGrew`（following
      只排队、detached 只置未读）/ `flushNow`（rAF 尾部同帧写）/ `jumpToBottom` / `viewportChanged` /
      `reset`；`render` 只在 `{phase, unread}` 变化时调用
- [ ] 1.3 单测 `tests/unit/harness-scroll-lock.test.ts`（零 DOM）：**先造会红的输入**再实现——
      四行真值表、滞回区间两侧、橡皮筋负距底、不足一屏、detached 下 `contentGrew` 零写入、
      following 下增长只排队（手动调度器跑一次才写）、**排队后用户先滚走 → 零写入**、
      `contentGrew`/`flushNow`/`viewportChanged` 不改态、未读基线随 `scrollHeight` 增长、
      `jumpToBottom` 清未读、`reset` / `viewportChanged` 的写与不写
- [ ] 1.4 反向验证并落档：把「detached 不写」临时改成写底 → 1.3 的零写入断言必红；把滞回改成
      单一阈值 → 滞回断言必红（两条读数写进测试文件头）

## 2. 面板接线（`src/harness-panel.ts`）

- [ ] 2.1 16 处 `scrollToBottom()` 逐点分流（design §3.1 的表）：13 处「增长」走 `contentGrew()`，
      3 处「强制」（`appendUserMessage` / `restoreSnapshot` / `resumeSession`）走 `jumpToBottom()`；
      实现后 `rg "scrollTop" src/harness-panel.ts` 复核只剩适配器里的唯一写入口
- [ ] 2.2 transcript 的 `scroll` 监听（passive）+ 适配器（`read` / `writeScrollTop` / `render`）
- [ ] 2.3 rAF 合帧的未读补扫：`flushChunks()` 之后、仅 `detached` 时 `contentGrew()`（纯思考帧的
      未读；following 不新增「思考帧贴底」的行为）
- [ ] 2.4 `attachTo()` 挂载后 `jumpToBottom()`；`resetView()` 末尾 `reset()`；`ResizeObserver` 观察
      transcript 盒尺寸（覆盖窗口缩放与分栏拖拽两条路径），回调 `viewportChanged()`
- [ ] 2.5 适配器 `render`：浮钮 `hidden` 与未读类的唯一施加点；态 / 未读每次变化只走这一处

## 3. 浮钮与文案

- [ ] 3.1 `src/harness-panel.css`：`.lumir-hp-transcript-viewport`（relative 视口层）+ `.lumir-hp-jumpbottom`
      （26×26、`--r-pill`、`--preview-bg` 面、1px `--border`、`--shadow-raise`（eink none）、
      `--text-2` 图标、`--hover` 反馈、`z-index: 10`）+ 未读圆点（6px、`--accent`）；eink 与
      `prefers-reduced-motion` 分支；浮钮默认 `hidden`
- [ ] 3.2 浮钮 DOM（DOM API 构造，SVG ↓，`aria-hidden`）；`title` + `aria-label` 取文案；
      消息摘录浮动钮的 z 序高于回底钮；点击后若钮持有焦点则交还 composer（design §4.3）
- [ ] 3.3 两条新文案进 deck 与运行时表（当前最大 D550 → D551 / D552：「回到底部」/「有新内容，
      回到底部」及 en 列；若届时 deck 已续号，顺延取未占用编号）；`tests/unit/copy.test.ts`
      漂移门禁绿
- [ ] 3.4 `applyLabels()` 重取浮钮可访问名（语言切换 + 每次态 / 未读变化）；确认 `onRelabel`
      路径不重渲 transcript
- [ ] 3.5 视觉核对：浮钮 `hidden` 时既有基线零漂移（本地 `scripts/gate.sh visual`）；若漂移，
      先查视口层盒模型，**不得**自行 `--update`（基线更新是人肉裁决点）

## 4. 验收面

- [ ] 4.1 视觉场景 `tests/visual/scenes/m638-harness-scroll-lock.spec.ts`（design §5.2 的 10 条）：
      前提（确实 3 屏溢出）、跟随时贴底、上滚脱离、**核心断言（注入 20 chunk 后 scrollTop 不变
      ±1px）**、点钮回底、滞回、发送白名单、非用户事件不拽、不足一屏、三主题 + zh/en 文案
- [ ] 4.2 视觉场景反向验证：把 2.1 的「增长」临时改回无条件写底，核心断言必红；读数（修前 / 修后
      `scrollTop`）写进场景文件头
- [ ] 4.3 真机验收场景 `scripts/acceptance/scenarios/<编号>-harness-scroll-lock.md` + mock fixture
      （`chunk_delay_ms` 撑流式窗口）：首片 → 上滚 → 钮在场（`ax.has`）→ 末片上屏后钮仍在 →
      点钮 → 钮退场 + 底部行带像素有字形。编号按当时批次续，不复用
- [ ] 4.4 **滚动通道探针**（先于 4.3 的最终执行）：对 transcript 中心跑一次 `do: scroll`，确认能
      产出生效位移；若仍是 `scripts/acceptance/README.md` 已知边界的 `no scroll movement`，给
      `scripts/acceptance/lib/cgevent-click.swift` 补 wheel mode（与 `doubleClick` / `drag` 同通道），
      再落 4.3。若 wheel mode 也产不出位移：如实把 4.3 标为受阻上报 tower，不用 AX 文本冒充滚动生效
- [ ] 4.5 回扫既有场景与视觉基线：`rg` 既有 harness 场景里对「transcript 在底部 / 错误行可见 /
      恢复后末条可见」的期望，确认新判据不改变其语义；`node scripts/acceptance/run.mjs --check` 通过
- [ ] 4.6 真机执行 4.3（需 tower 协调窗口），把证据落 `.local/acceptance/<日期>/` 并在报告里给
      可 `ls` 的绝对路径

## 5. 验证

- [ ] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 5.2 `bash scripts/docs-check.sh` 通过（相对链接 + 归档对账：MODIFIED 的错误呈现不得静默丢段）
- [ ] 5.3 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码）
- [ ] 5.4 `bash scripts/gate.sh visual` 全绿（动过 `src/harness-panel.css` 与视觉场景，必须本地跑；
      CI 绿不代表像素层没回归）
- [ ] 5.5 信息卫生清扫：新增 fixture / 场景 / 文档对改动面做一次 text 级 grep，真实 vault 内容、
      真实路径、真实人名零命中

## 6. 归档准备（节点 2）

- [ ] 6.1 tasks 全部勾选或就地标注放弃原因；delta 与实现一致性逐条对账
- [ ] 6.2 `node scripts/openspec-archive-check.mjs` 通过；归档后对 `<change-id>` 跑一次 `--archived`
- [ ] 6.3 归档后核对 living spec 的 requirement 段落完整（MODIFIED 整块替换、ADDED 并入），并顺手
      核对本次两条文案的 deck 漂移门禁
