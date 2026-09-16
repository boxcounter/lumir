# Backlog — findings 与待裁决队列

唯一的积压载体（2026-09-16 起自 HANDOFF.md 迁入并入 git）。

维护规则：

- 新 findings 由发现者（worker / reviewer / tower）落成条目，注明**来源 mission/批次**与**日期**；HANDOFF.md 只记 session 状态，不再积压。
- 条目状态：`待裁决` / `待修` / `待验收` / `记录在案`；核销后移入文末「已核销」并定期清理。
- 每条尽量附复现/证据指针；裁决类条目给出选项与推荐。

## 待 Alex 裁决

1. **历史敏感信息是否 filter-repo**：M111/M115 历史提交中的真实文件名；`docs/design-parity-contract/evidence/*.log` 约 20 行本机路径。tower 建议不必（仓库 M3 前不公开）。遗留自批次一。
2. **demo 右侧探针栏去留**：版面/文案决策，建议随 theme 重做一并处理。遗留自批次二。
3. **「保留我的版本」后自动保存暂停但用户无感知**：无回归；提示文案留 UX 重做阶段。遗留自批次二。
4. **宽表横向溢出裁切是否预期**：实测溢出 1549pt vs 栏宽 766pt，AX 层完整。待 Alex 对照设计规格确认。遗留自桌面复验（M116 期）。
5. **Emacs 档 3 与全产品键位**：isearch / mark / region / ⌃X 前缀，及左栏 tree/shell 零键盘支持——待 UX 重做会话与 dogfood 反馈后立项。批次三遗留。

## 待修 findings（不阻塞）

### 编辑器 / 键位

- **Alt+Shift token 口径**（M132，medium）：`keyToken` 对含 Alt 组合忽略 Shift，`Alt-KeyF` 同时命中 ⌥F 与 ⌥⇧F。修法已录 spec 已知限制：Alt 分支纳入 shiftKey + 别名拆两条绑定。
- **`ConfigSnapshot.warnings` 无 UI 出口**（M132，medium）：[keys] 配置的未知命令 warning 只进 console。提示文案/UI 留 UX 重做阶段。
- **toast z-index 10 衬在 ⌘/ 面板遮罩（20）下**（M133）：面板打开时非 sticky toast 自动消失可能未被看见。dogfood v0 可接受，留 UX 重做会话。
- **mermaid/frontmatter 无键盘进入路径**（M118 findings）。
- **caret 停靠隐藏边界时短暂不可见**（M118 已知外观残留）。
- **`\$` 转义误判**（M106，低优先级）。
- **mathSpanCrossed ±4KB 窗口对超大公式块的切割**（M111 review 观察）。
- **代码围栏行尾恰为 `$...$` 时跨行 Ctrl+B 一次移两字符**（M113，罕见且良性）。
- **相邻 grid 表连排时 Ctrl+N/P 每按一次过一张表**（M113，与裁决不冲突）。

### shell / 系统

- **退出守卫菜单结构假设**（M101 review）；Dock/系统关机路径不覆盖。
- **注册表目录 `{id}.json.tmp` 无扩展名过滤会被当注册项解析**（M126 finding；修复时顺带清掉 sweep_registry 对非 .json 文件的写面）。

### 未复现

- **编辑区全空白偶发**：M114 一次、M116 0/3，复现条件未锁定。待运行时诊断日志（openspec/changes/add-diagnostics-logging）落地后靠事件序列定位。

## 待真机验收

行为判定已下沉为 agent 可执行场景（入口 [scripts/acceptance/](../scripts/acceptance/README.md)，
设计见 [docs/process/real-machine-acceptance.md](process/real-machine-acceptance.md)）；手感/审美项仍归 Alex。

**2026-09-16 实跑结果（M135）**：`node scripts/acceptance/run.mjs` —— 10 场景 / 87 断言 / **10 PASS 0 FAIL**，
约 3.2 分钟；证据 `test-results/acceptance/2026-09-16/`（git 外，含 summary.md、逐场景 steps.md、截图、失败时 AX dump）。

**已机验（行为判定落定）**

1. **Mermaid 点击进源码编辑** —— `01-mermaid-click`：渲染态（成功块为 `help=围栏原文` 的 widget、失败块给
   「图表解析失败」+ 原文）→ 点击 widget → 源码显露、widget 让位。渲染中(pending)态窗口极短，只留截图。
7. **M124 恢复路径** —— `07-recovery-paths`、`07b-recovery-saveas`：外部改写后保存给出「保存冲突」双动作
   （重新载入 / 强制覆盖）、内存改动未丢、磁盘未被静默覆盖；文件被外部清空后保存，内存改动仍在。
8. **M127 自动保存落盘** —— `08-autosave`：输入后磁盘文件 sha256 变化且内容含本次输入（真机 2s 去抖生效）。
9. **Emacs 键位 / ⌘Z / ⌘/ 面板 / [keys]** —— `09-emacs-keys`、`09b-keys-config`：
   **⌘Z 未被 macOS 视图层级吃掉**（插入 → ⌘Z → 内容消失，即 M? 的 menu swap 真机成立，回退方案不必启用）；
   ⌘/ 面板打开/关闭且打开期间文档逐字节不变（作用域键不穿透）；`keys` 表解绑 ⌘S / 重绑 ⌃S 生效。

**已机验到渲染/结构层，行为细节仍缺可观测面**

2. 公式进编辑 —— `02-math-click`：行内/块级公式均渲染为 KaTeX、源码不显露。
   **「公式后 ⌃B 是否 1–2 次」仍待判定**：该判定要求光标停在公式 span 之后，而 AX 输出不暴露光标/选区，
   纯键盘落位无法回读校验（代码口径 1 次，`mathSpanCrossed` 落点 = span.to−1）。
3. Ctrl+N/P 表格行为 —— `03-table-ctrl-np`：grid 表确实渲染成 `AXTable (Markdown 表格 N)` + `AXRow` 单元格文本；
   ⌃N/⌃P 序列后表格与文档内容完好。**逐 cell 落点不可回读**（同上光标面缺失），实测按坐标点进 AXTable 的
   bbox 内也不会让渲染态表格让位给源码行，故不做该断言。
5. cell 内公式 —— `05-cell-math`：`$y$`/`$$y$$` 在 cell 内按行内样式渲染（AX 行文本为 `行内 / y / 块级 / y`）。
   **「点击渲染态公式进编辑」不可机验**（KaTeX span 既不进 AX 树也不带 bbox，与项 2 同因）。
6. Callout —— `06-callout-and-width`：渲染态下 `[!note]` 标记与 `>` 前缀都不显露、内容按块渲染。
   **「光标进该行后源码显露」不可机验**（需光标落在 callout 首行）；表格宽度只留截图证据。

**仍归 Alex 手感（不下沉）**

4. 表头 cell 双击 padding 的选中手感。
5. 表格 cell 内公式点击手感；6. 表格宽度观感（欠宽不拉伸、超宽横滚是否合意，与「待 Alex 裁决」4 同源）；
7. WKWebView 下三条恢复路径的手感；9. Emacs 翻屏/扩选真机手感。截图在证据目录，判定归 Alex。

## 记录在案（无需动作）

- **KimiCU AX 服务全局退化**（2026-09-16，M135 期间实测）：`get_app_state` 只剩菜单栏（`element_count`
  1–16、`truncated: [closed_menu, cycle]`、`window_bounds x=0 y=0 w=1 h=1`），Finder / Reminders / Lumir
  **一起坏**；`xpc-ping` 仍报 `accessibility=true screenRecording=true`。判定为 KimiCU 后台服务进了坏状态，
  恢复手段是重启服务（`/Applications/KimiCU.app/Contents/MacOS/kimi-cu install`）。这是机器级动作，
  已上报 tower 待 Alex 处理；套件本身无问题，恢复后重跑即可。
- **磁盘满**（2026-09-16 实测）：`/System/Volumes/Data` 一度仅剩 219MB，`pnpm tauri dev` 因 vite 写临时
  文件 ENOSPC 起不来。各 worktree 的 `src-tauri/target` 各占 1.5–3G 是主因。已由他人清出 3G+；若复发，
  考虑 worktree 共享 `CARGO_TARGET_DIR`（代价：并发构建互相阻塞）。
- **r1 格式崩溃备份**（无 base_revision）恢复后首次保存必报一次冲突——安全方向，仅限跑过 r1 build 的人。
- **kimi-cu `type_text` 走 AX 注入**，编辑器失焦时文本落陈旧原生选区——工具观测，非 app 缺陷。
- **[keys] 解绑 ≠ 关闭能力**（已录 spec）：解绑后 macOS 原生选择器可能接手（如 ⌃K → `deleteToEndOfLine:`）——dogfood 改配置时预期内行为。

## 已核销（留痕，定期清理）

- 2026-09-16：**视觉门禁容差假绿** → Alex 裁决收紧 `maxDiffPixelRatio` 0.005→0.001 + 删 UI 后核对相关基线时间戳（卫生步骤入 tests/visual/README.md 与 AGENTS.md）。
- 2026-09-16：**lists 100k 性能预算** → Alex 裁决放宽 p95 40→60ms（间歇超属环境噪声；随 dogfood 性能专项复核是否回调）。
- 2026-09-16：**run.sh 端口占用检查只查 4173** → 已修，检查 `${LUMIR_VISUAL_PORT:-4173}` 实际端口。
- 批次三：键位分发三轨并行 + 扩展名注册表漂移（M130/M131/M132）；save-ipc.ts 折回 ipc.ts（M132）；Ctrl-K/D/T 原生路径风险（M132）。
- 批次二：DeepSeek Flash 试用结论——可做 build，review 环节（k3-256k）不能省。
