# Tasks: goto-line-command

> **状态**：本 mission（M261）只交付提案——实现期任务全部未勾选。**Alex 节点 1 裁决已于 2026-09-27 落地**（D1 / D2 / D3 按推荐项，D4 改判为「md 文档不再豁免行号 gutter」，原话见 [proposal.md](proposal.md) 的裁决节），delta / design / 本文件已按裁决同批修订（M271）。§0 是提案期已完成的动作。

## 0. 提案期（本 mission 已交付）

- [x] 0.1 起草 `openspec/changes/goto-line-command/` 四件套（proposal / design / tasks / `specs/keymap-commands/spec.md` 增量），`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 0.2 键位三条独立来源核对（表内 / 原生菜单 accelerator / macOS 系统级）逐条落地到 [design.md](design.md) §2.2；token 形态取 `Alt-KeyG`（含 Alt 的组合按物理键判定）
- [x] 0.3 落点原语核对：`revealLine`（`src/editor.ts:2019`）已具备 1-based 钳制 + 行首落点 + `y:"center"` 居中，本 change 复用它、不另写算式
- [x] 0.4 场景编号声明（§6）并在 tower 广播登记
- [x] 0.5 节点 1 裁决落地（2026-09-27，M271 同批修订）：D1 / D2 / D3 按推荐项；**D4 改判**为「md 文档不再豁免行号 gutter」，delta 的可见面口径与新增 scenario、[design.md](design.md) §5、本文件 2.9–2.14 与末表的 D4 行、[proposal.md](proposal.md) 的裁决节与「边界与已知限制」同批更新；`npx --yes @fission-ai/openspec@1.12.0 validate --strict` 仍绿

## 1. 键位与命令（`src/keys.ts` / `src/editor.ts`）

- [ ] 1.1 `src/keys.ts`：`EDITOR_CORE_COMMAND_IDS`（`:135`）加 `editor.goto-line`（属内核组 → 作用域机械派生为 `editor`）
- [ ] 1.2 `src/keys.ts`：`KEY_BINDINGS` 加 `{ key: "Alt-KeyG", command: "editor.goto-line", scope: "editor", doc }`——`doc` 写明来由（M-g 的单段近亲、与 `Alt-KeyV/D/B/F` 同族）与三条来源核对结论；**不得**登记进 `KEYLESS_COMMAND_IDS`
  **验收口径**：`tests/unit/keys.test.ts` 的表不变量全绿（无重复 token、每条绑定有实现、命令不在孤儿清单里）
- [ ] 1.3 `src/editor.ts`：`commands` 记录接 `editor.goto-line`——打开输入条（经注入的 opener）；确认回调先 `view.focus()` 再调既有 `revealLine(n)`；MUST NOT 复制 `revealLine` 的落点/滚动实现
- [ ] 1.4 `src/editor.ts`：新增注入口（形态照 `setTableFullscreen` / `refreshPreview`），签名只需 `{ open(defaultLine, totalLines) }` 一族
- [ ] 1.5 确认命令不产生任何文档变更：`revealLine` 之外不 dispatch 事务，不碰 dirty（`tests/unit` 与真机场景双证）

## 2. 输入条与 md 常驻行号 gutter（`src/goto-line.ts` 新增 / `src/main.ts` / `src/style.css` / `src/editor.ts` / `src/preview/theme.ts`）

- [ ] 2.1 `src/goto-line.ts` 纯逻辑层：`resolveGotoLine(raw, fallbackLine, totalLines)`（解析 + `[1, totalLines]` 钳制；空串 → `fallbackLine`），零 DOM
- [ ] 2.2 `src/goto-line.ts` DOM 适配层：`createGotoLinePrompt({ mount, onJump })` → `{ open(defaultLine, totalLines), close() }`；浮层 `position: absolute; bottom: 100%` 挂 `shell.modeline`（与 `.lumir-toc` 同挂点同定位）；`hidden` 常态
- [ ] 2.3 输入框：预填当前行号并全选（`focus()` + `select()`）、只接受数字字符（非数字键不产生字符）
- [ ] 2.4 就地键消费：Enter 确认、Escape / `⌃G` 取消、**`⌥G` 无操作且不把 `©` 打进输入框**（理由见 design §1.2：`editor` 作用域判定会让该键落回原生路径，输入条必须自己挡）
- [ ] 2.5 `focusout` 到浮层之外即收起且不跳转；`close()` 把焦点交还编辑器
- [ ] 2.6 `src/main.ts`：构造浮层（`mount: shell.modeline`）并注入 editor 的 opener；**前台会话切换时收起输入条且不跳转**（切标签、外部打开请求置换两条路径）
- [ ] 2.7 `src/style.css`：`.lumir-goto` / `.lumir-goto-input` / `.lumir-goto-hint`，tokens 复用（`--preview-bg` / `--border` / `--r10` / `--shadow-raise`），`[hidden]` 分支与 `.lumir-toc[hidden]` 同款；零新色值
- [ ] 2.8 键位面板核对：面板行数自动多一行（`EDITOR_COMMAND_IDS` 派生）；若哪个场景硬编码了行数，同批更新
- [ ] 2.9 `src/editor.ts`：md 分支（`:1436`）加装 `lineNumbers()` 与 `highlightActiveLineGutter()`——**常驻、不由任何命令开关**；**不**装 `highlightActiveLine`（md 阅读视图的正文行底色不在本 change 内）。行号 = 源文档逻辑行号（与 `doc.lines` 同口径）
- [ ] 2.10 `src/preview/theme.ts`：md 的 gutter 定位与配色——grid 落点与 md 的其它 grid 真源同居（doc-title 行 `:368-379`、end marker 列 `:523-546`），MUST NOT 让 base 规则的 `gridRow: "1"`（`src/editor.ts:1399`）在有 doc-title 落点时把行号整体上移一个标题高度；md 侧去掉 `--frame` 底与右缘分隔线，只留提示档行号色（口径见 design §5.2 第 3 / 4 条）
- [ ] 2.11 正文列居中的守恒：md 的 scroller 模板不为 gutter 改写（`src/editor.ts:1383-1390`），gutter 落在左侧空余轨道并贴正文列左缘；窄窗下 MUST NOT 让行号被裁
  **验收口径**：chromium 几何断言（实测 rect，不用 CSS 声明值）——① 正文列左右缘与「md 列居中」的判据一致（加 gutter 前后同值）；② 行号右缘 ≤ 正文列左缘、不重叠；③ 缩到窄窗（如 640px）行号仍完整可见
- [ ] 2.12 行号纵向对准（md 的新压力面）：行块高度不均匀（标题 / 图片 / 表格 widget / callout / 公式 widget），断言「行号元素顶 = 该行内容盒顶」，覆盖至少标题行、图片行、表格 widget 行三类
- [ ] 2.13 核对既有断言与判据（md 有 gutter 后会红或被静默放宽的那几处）：`tests/visual/scenes/markdown-parser.spec.ts:112`（md 的 `.cm-lineNumbers` 计数 0 → 1）、`tests/visual/scenes/end-marker.spec.ts:561`（以 `.cm-lineNumbers` 在场当 code 模式判据并在两判据同真时抛错 → 换判据）、`tests/visual/scenes/m130-text-open-trap.spec.ts:84-85` 与 `end-marker.spec.ts:543` 的口径注释、`src/editor.ts:2083` 与 `src/scroll-position.ts:42` 的注释及依赖 `getScrollMargins().left` 的横向恢复路径与其视觉场景（md 从 0 变为行号列宽）
- [ ] 2.14 已知边界（MUST NOT 当成缺陷回头修，且 MUST NOT 为它新增 `lineNumberWidgetMarker` 提供者）：块级替换覆盖的源行缺号——frontmatter 区块恒缺、块级数学 / mermaid 在块回退为源码时补上（机制见 design §1.4 第 2 条）

## 3. 文案（`文案-Copy.md`）

- [ ] 3.1 新增输入条文案条目（读屏名 / 占位 / `共 {M} 行` 提示模板），编号从 deck 末位续（2026-09-27 末位 D151；动工前先核一次末位编号）
- [ ] 3.2 文案常量落在 `src/goto-line.ts`，「能力在哪文案就在哪」；`tests/unit/goto-line.test.ts` 按 deck 逐字断言
- [ ] 3.3 **不新增**任何 toast / 提示文案：越界钳制（D3 推荐项）静默，取消静默

## 4. 单元与视觉测试

- [ ] 4.1 `tests/unit/goto-line.test.ts`：`resolveGotoLine` 的输入矩阵（`""` / `"1"` / `"0"` / `"M+10"` / 前导零 / 超长数字串 / 非数字已被输入层挡住但在纯函数层仍要给出定义）
- [ ] 4.2 `tests/unit/keys.test.ts`：既有表不变量自动纳入 `Alt-KeyG`（无需改断言，但**须跑一遍确认零红**）；补一条「`[keys]` 重绑 `Ctrl-j` → `editor.goto-line` / 解绑 `Alt-KeyG`」的覆盖用例
- [ ] 4.3 新增视觉场景（chromium 层）：输入条打开态（结构断言：预填值、`共 M 行` 文本、数字过滤、Enter 后编辑器滚动位置与光标行号）+ **md 常驻 gutter 的结构与几何断言**（在场且行号 = 源行号、正文列仍居中、降落到标题 / 图片 / 表格行的纵向对准、窄窗完整可见——见 2.11 / 2.12）+ 含 md 编辑区的整页基线**整批重拍**
  **验收口径**：整页基线是**人肉裁决点**——先出前后对比图请 Alex 过目，再 `--update-snapshots=all`（AGENTS.md 的基线纪律与 tests/visual/README.md）；新增元素同样要逐张归因（该元素出现在哪些整页基线里、时间戳是否随本次更新——视觉门禁卫生条的反面用法）
- [ ] 4.4 核对键位面板相关视觉场景（新增一行）与 `edit` 分组的既有断言，逐张判定「失配是否恰为预期」

## 5. 门禁

- [ ] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 5.2 `bash scripts/gate.sh quick` 全绿
- [ ] 5.3 `LUMIR_VISUAL_PORT=<自选> bash scripts/gate.sh visual` 全绿（改过 `src/style.css` 与新增浮层 → 必须本地跑，CI 只跑结构层）
- [ ] 5.4 `git diff --check` 通过；改动文件集合与 [proposal.md](proposal.md) 的 Impact 清单一致（出现跨 scope 的只读依赖先报 tower 批准）

## 6. 真机验收场景（WKWebView，`scripts/acceptance/`；随实现同 PR）

- [ ] 6.1 新增 `scripts/acceptance/scenarios/56-goto-line.md` + fixture（编号声明见下）
  **判据草案**（形态与既有场景一致，动工时按套件 README 的动作表落地）：
  - 前置：`open: <长文档>`（md fixture，行数 ≥ 40 便于越界）、`do: clickEditor` 建焦点；`record` 文档基线（sha256 + mtime）
  - 步 1：`do: key { key: "alt+g" }` → 断言**md 的常驻行号 gutter 在场**（`alt+g` 之前、打开文档后即可见——D4 改判的常显口径）+ 输入条在场（AX 读出读屏名）+ 预填值等于当前行号 + `共 M 行` 文本在场（**默认键**这条通道，不经 `[keys]` 重绑——先例 26 号场景的 `alt+v` 证明 `alt+` 可注入）
  - 步 2：`do: type { text: "37" }`（先 `clear`）+ `do: key { key: "return" }` → 断言编辑器文本里第 37 行的内容出现在第一屏（marker 用该行特征串）+ 光标行号可读（`AXTextArea` 的选中位置或 modeline 读数二者取一，实现期定口径）+ `file: { unchangedSince, mtimeUnchangedSince }`（**零写盘**：跳转不改文档）+ `ax: { not: "（未保存）" }`
  - 步 3：越界 `do: key { key: "alt+g" }` + `type "9999"` + `return` → 断言文档末尾段落在场（钳到末行）且文档逐字节不变
  - 步 4：取消路径 `alt+g` → `key escape` → 断言输入条不在 AX 树里、编辑器文本与滚动位置未变（`recordEditor` + `editor.unchangedSince`）
  - 步 5：`[keys]` 重绑通道：`configWrite { keys: { "Ctrl-j": "editor.goto-line" } }`（`restart`）→ `key "ctrl+j"` 打开输入条（先例 43 号场景同款写法），断言与步 1 同形
  **验收口径**：`node scripts/acceptance/run.mjs --check` 静态校验通过；`node scripts/acceptance/run.mjs 56` 真机 PASS，证据落 `test-results/acceptance/<日期>/56-goto-line/`（`status.txt` = PASS）
  **设计期记录**：套件 `type` 动作用真实点击聚焦编辑器，而输入条是浮层输入框——实现期须确认 `type` 能把字打进浮层输入框（落点仍是「先点击浮层输入框、再注入」，必要时在场景里用 `click` + `key` 组合并如实记录；若通道确实不可用，按 43 号场景的先例把「浮层输入」一步的覆盖降级为 chromium 层并如实记账，**MUST NOT** 用 `set_value` 伪造键盘语义）
- [ ] 6.2 反向验证：去掉命令实现（或把绑定摘掉）后跑同一场景，断言必须 FAIL，红灯留档（结果目录另开，不覆盖 PASS 证据）
- [ ] 6.3 性能读数：1MB fixture 跳末行的可见延迟量一次并落档（`test-results/`），读数写进 review-request（design §7；本 change 不设阈值，超预期则另落 finding）；同一次真机操作里顺带确认 md 长文档的滚动帧未因常驻 gutter 变慢

### 编号声明

真机场景取 **56**。依据（2026-09-27 实测）：本 mission 的 base 分支上 `scripts/acceptance/scenarios/` 现有最大编号 **50**（`50-tab-context-menu.md`）；master 上另有 **52**（`52-dir-rename-expand.md`，M258 已合并）；**51 / 53 归在飞的 M257 / M259**，**54 归 M260**（change `bare-url-cmd-click`，其 tasks.md §6 已声明该号，提案已合并进 master），**55 归 M267**（ui-language-i18n 提案预留）。因此本 change 取 **56**。实现期动工前须按既定纪律（`openspec/changes/archive/2026-09-27-list-tab-indent/tasks.md` §6 的口径）再核一次目录与在飞 change 的编号声明，不盲取。

## 7. 收口与归档跟踪

- [ ] 7.1 实现期若 spec 增量与 proposal 的意图出现变更：停下、更新 proposal 并重走节点 1，不静默扩 scope
- [ ] 7.2 视觉基线的失配逐张归因（改动的元素在哪些整页基线里出现过、时间戳是否随本次更新），零静默 `--update`
- [ ] 7.3 实现 PR 合并时在 `docs/backlog.md` 的「待 Alex 裁决」节落一条归档待办（批次收尾 checklist 的强制项：合并后没人跟进归档是 M150 实测的失效模式）
- [ ] 7.4 归档评审（节点 2）：tasks 全勾或标注放弃原因、spec 增量与实现一致后 `npx --yes @fission-ai/openspec@1.12.0 archive goto-line-command --yes`

## 裁决改写指引（D1–D4 任一项改判备选时照此执行）

| 裁决点 | 取备选时的改写动作 |
|---|---|
| D1 = `⌘L` | delta：默认键位与 token 改为 `Cmd-l`；三条来源核对重做一遍（⌘ 系需另核 muda 预置与 macOS 系统级）；design §2 改写；tasks 1.2 / 6.1 的注入键改 `cmd+l` |
| D1 = 真 chord `M-g g` | 前置新增一个 change（`[keys]` 的 chord 支持 + 面板渲染 + Rust 侧形态校验），本 change 降为它的依赖；tasks 1.2 写两段键位、6.1 的注入改 `alt+g, alt+g` |
| D2 = modeline 内联 | delta：输入条形态改写为「modeline 左段内联输入」并补「modeline 只读派生口径为瞬态输入态开口」的记述；新增 `ui-design-system` 的 MODIFIED requirement；tasks 2.2/2.5/2.7 改写、4.3 补窄窗（`<640px`）退让不被打断的断言；整页基线涉及 modeline 的全部重拍 |
| D3 = 越界拒绝 | delta：钳制那句改为「越界保留输入条 + 提示并要求改正」；新增一条提示文案（deck 追加）；tasks 3.3 改为「新增越界提示文案」、6.1 步 3 的断言从「落到末行」变为「输入条仍在、文档未动」 |
| D4 = **md 常驻行号 gutter**（2026-09-27 节点 1 改判，已落地） | **本次修订已完成**：delta 的可见面口径 + 新增「md 模式的常驻行号 gutter」scenario + 已知边界 ⑤⑥；[design.md](design.md) §5 与 §1.4 重核；tasks 2.9–2.14、4.3、6.1 步 1、末表本行；[proposal.md](proposal.md) 的裁决节、What Changes 第 5 条、Non-goals、Impact、边界第 2 与第 6 条 |
| D4 再改为「只在输入条在场时显示」 | delta：常显口径改为瞬态口径（gutter 随输入条开 / 关），已知边界 ⑤⑥ 与 requirement 的常显句同步改写；tasks 2.9–2.11 改为 gutter 的 compartment 重配与开关路径、4.3 补「开关瞬间正文列不跳动」的几何断言；proposal 的 D4 行与 What Changes 第 5 条重写 |
| D4 再改为「modeline 常驻行号段」 | 新增 `ui-design-system` 的 MODIFIED requirement（右段加光标行号段 + 窄窗退让顺序）；tasks 新增 modeline 显示位实现与全部整页基线重拍；proposal 的「边界与已知限制」第 2 条删除 |
