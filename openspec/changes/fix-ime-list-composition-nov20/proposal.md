# Proposal: 修复列表行的 IME 组合输入与删除保真

- Change ID: `fix-ime-list-composition-nov20`
- 日期: 2026-11-20
- 角色: Alex Lee（原始缺陷报告、dev 复现与直接处理要求），AI agent（诊断 / 起草 / 实现）

> 评审记录
> 节点 1：Alex 报告生产版 Lumir 在中文输入法下于列表标记后输入 `s` 会多出横线，删除后相邻的
> 「词汇」行消失，并要求「请你直接处理」。本 change 只修复既有「列表内容起点输入的跨层一致性」
> 与源码保真合同，不新增产品行为。

## Why

Chromium 经 CDP `Input.imeSetComposition` 复现了删除后的相邻行消失：组合输入 `s` 后
`EditorState.doc` 为正确的 `词汇\n- s`；组合中 Backspace 后源码恢复为 `词汇\n- `，但第一行
`.cm-line` 的 DOM 文本被清空。首轮实现只处理 Chromium 的 `deleteContentBackward`，Alex 随后在
master 工作区的 dev 实例确认 WKWebView 现象完全不变。

dev 实例的 `editor_ime` 本地日志同时证明当前工作区代码已加载，并给出 WKWebView 的真实事件序：
首字符是 `insertCompositionText`；删空时是 `deleteCompositionText`，随后立即 compositionend。
现场没有 `insertOrderedList` / `insertUnorderedList`，首轮针对这两个命令的假设因此被反证。
额外横线是组合期间列表 marker widget 提前重建，与输入法仍持有的原始 `- ` 同时存在；删除未接管
则继续破坏相邻行 DOM。组合期冻结落地后，Alex 第二轮 dev 复验确认删除导致的相邻行消失已修复；
候选提交后 marker 未恢复——WKWebView 在 `insertFromComposition` 后立即结束组合，增量语法树尚未
覆盖新形成的列表。`compositionend` 因此先完成当前文档解析，再唤醒冻结期跳过的装饰重建；该版
仍待 Alex 复验。

## What Changes

- 组合中 Backspace 仅在即将删空 marked text 时改走显式 CodeMirror 事务，以 `compositionstart`
  的源码位置为下界；同时接受 Chromium 的 `deleteContentBackward` 与 WKWebView 的
  `deleteCompositionText`。组合内尚有剩余文本时交回原生 IME，避免候选提交残留。
- 组合期冻结列表装饰的 DOM 重建，保留组合前形态；compositionend 先补齐当前文档解析，再统一
  刷新，避免原始 marker 与新 widget 同时出现。文档源码、列表组映射与后台扫描仍随事务更新。
- `history.joinToEvent` 不再把 `input.type.compose.start` 与紧邻的前一笔普通输入并组；一次 undo
  精确回到组合前，后续组合事务仍由 CodeMirror 并成一步。
- 扩充 `docs/specs/lists.md` L6 与 editor-live-preview requirement，把组合更新、两种删除类型、
  组合期装饰稳定、相邻行 DOM 保真、历史与保存纳入同一不变量。
- 用真实 Chromium 组合事件覆盖真 bullet / 有序 / 嵌套 / 裸 marker / 段落后 setext 切换；另以
  合成 beforeinput 覆盖 WKWebView 实测的 `deleteCompositionText`，并断言组合期 marker 数量不增加、
  提交后才刷新。Alex 的 dev 复现日志用于确认事件路径，不把 Chromium 结果冒充 WKWebView 行为证据。

## Non-goals

- 不改变列表外观、裸 marker 语义、光标导航、Enter 续行或普通 Backspace 的字素合同。
- 不按横线、marker glyph、DOM/AX 文本或文件内容猜测编辑意图，不恢复旧 DOM 读回吞弃护栏。
- agent 不启动或操作生产版 / dev 版 Lumir，不执行真机验收；Playwright WebKit 合成事件不冒充
  原生 IME。Alex 自行启动的 dev 实例只用于现场复现与本地诊断日志采集。
- 不新增依赖，不修改视觉基线。

## Impact

- 影响的 specs：editor-live-preview；专项合同 `docs/specs/lists.md` L6。
- 影响的代码/系统：md 编辑器的 beforeinput 组合编辑闸门、列表装饰生命周期与浏览器回归测试。
- 关联约束：不改写源文件铁律、渲染 / 交互缺陷合同先行、真实 vault 只读与真机隔离要求。
