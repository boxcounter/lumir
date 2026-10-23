# Tasks: add-harness-block-fullscreen

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现
> proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。
> 实现期与设计稿不符的五处事实已登记在 [design.md](design.md) §11（裁决侧取向一条未变）。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/harness/spec.md` / 本文件
- [x] 0.2 Alex 节点 1 评审通过（硬门禁；五个起草期取值 D1–D5 一并裁决）——2026-10-23
      「change 提案都通过」

## 1. 块级入口（面板侧）

- [x] 1.1 `src/harness-panel.ts` 的 `renderBlock`：代码块（`FencedCode` / `CodeBlock`）与表格包一层
      `.lumir-hp-block-slot`（零足迹定位容器），内挂全屏钮（共享类 `.lumir-block-trigger` + 一个位置
      class）；点击 `preventDefault` + `stopPropagation`；`<button type="button">` + Enter 触发
- [x] 1.2 `src/harness-panel.css`：slot 零足迹、钮位置 `top: 6px; right: 6px`；浮现规则只补一条选择器
      （hover slot / 钮 `:focus-visible`），MUST NOT 新写壳 / 热态 / eink 规则。实现期把
      `.lumir-hp-block-slot:hover` 补进 `src/style.css` 的三条既有共享规则（light / eink / eink-hover）
- [x] 1.3 读屏名：钮面取既有词条（代码块 D156 / 表格 D124，与 content pane 同一份常量）；遮罩取
      `Markdown 表格 N` / `Markdown 代码块 N`（D211 / D212）——**消息内序号**（只数同类块、1-based、
      点击那一刻从 DOM 现数的派生读数，不进任何数据模型、不持久化）。见 design §1.3 / §11
- [x] 1.4 渲染单测（`tests/unit/harness-transcript-render.test.ts`，驱动 `renderMarkdownInto` +
      最小 DOM 替身）：两类块产出 slot + 钮；`aria-label` 取自既有词条；流式尾块里围栏未闭合无钮、
      闭合后有钮（反向用例）；块内既有交互节点（路径链接）数量与落点逐值不变

## 2. 代码块内容计划（共享映射）

- [x] 2.1 把编辑器侧「节点 → 计划参数」的映射（原 `src/preview/livePreview.ts` 的 `codeBlockRender`）
      抽成共享函数 `planCodeBlockOfDocument`（落 `src/preview/code-block-content.ts`），编辑器侧改调它；
      `CodeText` 拼接抽成 `codeTextOf`，`src/preview/block-copy.ts` 的 `codeBlockContent` 转调——
      映射与拼接各只有一份
- [x] 2.2 面板侧用它产出 `CodeBlockRender` 交给既有代码块全屏（`planCodeBlock` 的 64 KiB 降级口径
      自动继承，未另立阈值）
- [x] 2.3 单测（`tests/unit/code-block-fullscreen.test.ts`）：同一份用例表（围栏 / 缩进 / 超 64 KiB）
      跑**字符串来源**（面板）与 **CM `Text` 来源**（编辑器）两条调用，产出逐项相同

## 3. 装配（单实例、焦点归还、主题来源）

- [x] 3.1 `src/main.ts`：两个遮罩端口增加「来源 = harness」一档（`OverlaySource` 联合）——打开时记
      来源与发起钮；`restoreFocus` 在来源为面板时回到该钮（仍在 DOM 时），否则回 composer；MUST NOT
      把焦点交给编辑器。实现期实测：静止态钮 `visibility: hidden` 不可聚焦，故先临时露出再聚焦
      （design §11.5）
- [x] 3.2 代码块全屏的 `themeScopeSource()` 改为按来源解析（面板 → 面板的 scope 宿主 transcript；
      编辑器 → 编辑器 DOM）；表格侧不改（既有实现从源元素镜像）。`mirrorThemeScope` 的来源解析补
      「已镜像宿主」标记（design §11.4）
- [x] 3.3 面板侧的**内容换代**关闭点：`resetView`（新会话 / 切 vault / cron 切屏 / 重载会话的共用
      出口）调端口 `close`——只关**面板来源**的那一份，编辑器里开的遮罩不因面板换会话退场
- [x] 3.4 单测：内容换代三态（同 vault 重复装载不关 / 切 vault 关 / 重载会话关，
      `tests/unit/harness-restore-block-defaults.test.ts`）；单实例与焦点三态（钮在场 / 钮已被重渲
      替换 / 从编辑器打开）由视觉场景 `m634` 与既有 `m277` / `m240` 场景共同覆盖

## 4. 流式口径

- [x] 4.1 打开即快照：表格走深克隆（既有）、代码块按那一刻的块源码生成计划；遮罩不订阅面板的渲染
      事件（实现上没有任何回灌通道——`openCodeBlock` 收到的是计划数据，不是活 DOM）
- [x] 4.2 关闭后再打开取最新内容（无缓存复用：每次点击都现取计划 / 现克隆）
- [x] 4.3 视觉覆盖（`tests/visual/scenes/m634-harness-block-fullscreen.spec.ts`）：流式中打开缩进块
      → 内容冻结；继续增长 → 遮罩不变且不清空；关闭再开 → 新内容；未闭合围栏没有入口、闭合后出现

## 5. 视觉与真机场景

- [x] 5.1 视觉场景（chromium + `tauri-stub`）：mock 回复含长代码块与宽表格 → 悬停出现钮 → 点击 →
      遮罩在场、内容逐字相同（代码块） / cell 逐字相同（表格）、遮罩内无钮副本、表格结构（cell 边框）
      随元素走、主题 scope 镜像成立（`white-space: pre`）→ `Esc` 关闭、焦点回面板；**既有整页基线零
      更新**（本场景只做结构断言，钮静止态 `visibility: hidden`）
- [x] 5.2 真机验收：新增 `scripts/acceptance/scenarios/220-harness-block-fullscreen.md` + 合成 fixture
      `scripts/acceptance/fixtures/harness-mock-block-fs.json`——真实 WKWebView 下悬停唤出钮、点开两类
      全屏、内容互斥（代码遮罩里没有表格 cell / 表格遮罩里没有代码行）、`Esc` 退出、焦点回面板。
      静态校验通过（`--check`）；**尚未真机跑过**（本轮只到静态校验，见 mission 纪律）
- [x] 5.3 回扫既有验收场景：新增的 slot 只包一层 div、不改任何文本节点，既有 harness 场景的文本断言
      不受影响；`node scripts/acceptance/run.mjs --check` 全量通过（217 个场景）
- [x] 5.4 如实登记覆盖边界：钮的浮现手感与遮罩观感归 Alex 手感裁决（不进机器判据）；场景 220 的
      hover 通道依赖静态文本节点的 bbox（已知边界写在场景文件末尾）

## 6. 验证

- [x] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 6.2 `bash scripts/gate.sh quick` 全绿（`GATE RESULT` 原文行见 mission 报告）
- [x] 6.3 `bash scripts/gate.sh visual` 全绿（动过 `src/harness-panel.css` / `src/style.css`，本地跑）
- [x] 6.4 信息卫生清扫：新增 fixture / 场景 / 文档对改动面做一次 text 级 grep，真实 vault 内容、真实
      路径、真实人名零命中
