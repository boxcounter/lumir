# Tasks: add-harness-block-fullscreen

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现
> proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。

## 0. 提案（节点 1）

- [ ] 0.1 起草 `proposal.md` / `design.md` / `specs/harness/spec.md` / 本文件
- [ ] 0.2 Alex 节点 1 评审通过（硬门禁；五个起草期取值 D1–D5 一并裁决）

## 1. 块级入口（面板侧）

- [ ] 1.1 `src/harness-panel.ts` 的 `renderBlock`：代码块（`FencedCode` / `CodeBlock`）与表格包一层
      `.lumir-hp-block-slot`（零足迹定位容器），内挂全屏钮（共享类 `.lumir-block-trigger` + 一个位置
      class）；点击 `preventDefault` + `stopPropagation`；`<button type="button">` + Enter 触发
- [ ] 1.2 `src/harness-panel.css`：slot 零足迹、钮位置 `top: 6px; right: 6px`；浮现规则只补一条选择器
      （hover slot / 钮 `:focus-visible`），MUST NOT 新写壳 / 热态 / eink 规则
- [ ] 1.3 读屏名：代码块取 `t("D156")`；表格取 `t("D203")` + **消息内序号**（只数表格块、1-based、
      纯派生读数不进任何数据模型、MUST NOT 持久化）
- [ ] 1.4 渲染单测（驱动 `renderMarkdownInto` + 最小 DOM 替身）：两类块产出 slot + 钮；`aria-label`
      取自既有词条；流式尾块里围栏未闭合无钮、闭合后有钮（反向用例）；块内既有交互节点（路径链接等）
      数量与之前逐值相同

## 2. 代码块内容计划（共享映射）

- [ ] 2.1 把编辑器侧「节点 → 计划参数」的映射（`src/preview/livePreview.ts:499` 的 `codeBlockRender`）
      抽成共享函数（落 `src/preview/code-block-content.ts`），编辑器侧改调它——MUST NOT 在面板侧复制
      第二份映射
- [ ] 2.2 面板侧用它产出 `CodeBlockRender` 交给既有代码块全屏（`planCodeBlock` 的 64 KiB 降级口径
      自动继承，MUST NOT 另立阈值）
- [ ] 2.3 单测：同一份用例表（围栏 / 缩进 / 超 64 KiB）跑编辑器侧与面板侧两条调用，产出逐项相同
      （防漂移的判别性用例）

## 3. 装配（单实例、焦点归还、主题来源）

- [ ] 3.1 `src/main.ts`：两个遮罩端口增加「来源 = harness」一档——打开时记来源；`restoreFocus` 在来源
      为面板时回到该块的触发钮（仍在 DOM 时），否则回 composer；MUST NOT 把焦点交给编辑器
- [ ] 3.2 代码块全屏的 `themeScopeSource()` 改为按来源解析（面板 → 面板根；编辑器 → 编辑器 DOM）；
      表格侧不改（既有实现从源元素镜像）
- [ ] 3.3 面板侧的**内容换代**关闭点：会话切换 / 面板重载 / 快照恢复处调用既有遮罩关闭入口（新增调用
      点，不新写关闭逻辑）
- [ ] 3.4 单测 / 走查：单实例语义（从面板打开会顶掉编辑器已开的同类遮罩，无叠加）；关闭后焦点归属
      三态（钮在场 / 钮已被重渲替换 / 从编辑器打开）

## 4. 流式口径

- [ ] 4.1 打开即快照：表格走深克隆（既有）、代码块按那一刻的块源码生成计划；后续尾块重渲不得回灌
      遮罩（MUST NOT 订阅面板的渲染事件来更新遮罩）
- [ ] 4.2 关闭后再打开取最新内容（无缓存复用）
- [ ] 4.3 视觉 / 真机覆盖：流式中打开 → 内容冻结；继续增长 → 遮罩不变；关闭再开 → 新内容（见 §5）

## 5. 视觉与真机场景

- [ ] 5.1 视觉场景（chromium + `tauri-stub`）：mock 回复含长代码块与宽表格 → 悬停出现钮 → 点击 →
      遮罩在场、内容逐字相同、遮罩内无钮副本 → `Esc` 关闭、焦点回面板；既有整页基线**零更新**
- [ ] 5.2 真机验收：`node scripts/acceptance/run.mjs` 新增场景——真实 WKWebView 下点开两类全屏、
      `Esc` 退出、流式中快照口径、关闭后焦点在面板
- [ ] 5.3 回扫既有验收场景：grep 所有对 harness 代码块 / 表格有 AX 期望的场景，确认新增钮不改变既有
      文本断言（`node scripts/acceptance/run.mjs --check` 通过）
- [ ] 5.4 如实登记覆盖边界（钮的浮现手感、遮罩观感归 Alex 手感裁决，不进机器判据）

## 6. 验证

- [ ] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 6.2 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码）
- [ ] 6.3 `bash scripts/gate.sh visual` 全绿（动过 `src/harness-panel.css` / `src/style.css`，必须本地跑）
- [ ] 6.4 信息卫生清扫：新增 fixture / 场景 / 文档对改动面做一次 text 级 grep，真实 vault 内容、真实
      路径、真实人名零命中
