# Design: 行号 gutter 右键复制 `{path}:{line}`

## 1. 接线点：为什么用 CodeMirror 的 gutter `domEventHandlers`

行号 gutter 由 `lineNumbers()` 安装，DOM 是 `.cm-gutters > .cm-gutter.cm-lineNumbers`，每行一个
`.cm-gutterElement`。`lineNumbers(config)` 接受 `domEventHandlers`（`@codemirror/view` 的
`LineNumberConfig`），CM 把处理器挂在该 gutter 自己的 DOM 上，并在处理器返回 `true` 时调用
`event.preventDefault()`。由此得到三个直接好处：

- **在场判据仍只有 `mdGutterExtensions()` 一处**：右键处理器随 `lineNumbers()` 一起安装 / 卸载，
  档位为 `off` 或 `on-demand` 未打开输入条时 gutter 不在场，处理器也不存在。本 change 不改
  `mdGutterExtensions()` 的 `installed` 条件，也不改 code 分支的恒装。
- **只接 gutter 自己的事件**：处理器不会在正文、树、modeline 上误触发；无需自己判断坐标或
  选择器。
- **行号取源文档逻辑行**：处理器拿到 `BlockInfo`，用
  `view.state.doc.lineAt(block.from).number` 取 1-based 源行号。软换行只是同一 block 的视觉行，
  不会改变行号；与 gutter 显示的行号同源（CM 的 `lineNumberGutter` 也对 `doc.lineAt(line.from)`）。

`event.preventDefault()` 由 CM 在返回 `true` 后执行；实现 MUST NOT 自己再写一次
`preventDefault`（两份写法会漂移），也 MUST NOT 在处理器里 `dispatch` 或 `focus`——右键是只读动作。

辅助键（macOS 右键 = `button === 2`，Ctrl+左键同义）另挂一条 `mousedown` 处理器：`contextmenu`
只能消费右键菜单本身，拦不住 `mousedown` 的默认焦点转移。若不拦，编辑器会失焦；`on-demand` 档下
更严重——跳转输入条收到 `focusout` 会立即卸掉临时 gutter，`contextmenu` 到达时目标已不在 DOM，
右键复制在默认档下等于不可用。因此 `mousedown` 在复制端口已注入时返回 `true`（CM 调
`preventDefault`），焦点保持右键前的归属、临时 gutter 存活到随后的 `contextmenu`。左键不拦截，
gutter 的既有左键行为一字不动。

被采纳的替代方案与否决理由：

| 方案 | 否决理由 |
|---|---|
| 在 `main.ts` 给 `.cm-gutters` 挂 DOM 委托 | 需要自己判断 `.cm-lineNumbers`、坐标 → 行号、档位在场；行号映射会与 CM 的 gutter 各写一份，且从 `main` 反向依赖 CM 内部 DOM 结构。 |
| 读取被点中的 `.cm-gutterElement.textContent` 作为行号 | 文本是渲染产物（将来若加 `formatNumber` 或分组会漂）；`BlockInfo` 是结构化事实。 |
| 新增 `editor.gutter-copy` 命令 + 键位 | 需求是右键手势；加键位会扩大键位面与冲突审查，且不是 Alex 要的入口。 |

## 2. 路径口径：唯一来源是会话 `path`

`EditorSession.path` 的定义就是「文档的 vault 相对路径；vault 外只读会话是绝对路径；未命名文档
为 `undefined`」（见 `src/editor.ts` 的 `EditorSession` 与 `createExternalSession`）。modeline
路径段、快速打开、harness 路径链接都从它取值。本 change 直接把这一个值交给复制出口：

- vault 内：`笔记/日本 旅行.md` → `笔记/日本 旅行.md:12`；
- vault 外只读：`/tmp/外部 笔记.md` → `/tmp/外部 笔记.md:1`；
- 无路径：不写剪贴板，走失败反馈（reason = D207「无当前文件」），MUST NOT 拼出 `undefined:12`
  或 `:12`。

拼法只有一处：`src/gutter-copy.ts` 的 `pathLineText(path, line)`。成功 toast 也用这串
（`{target}` 占位），因此「剪贴板上是什么」与「回执说什么」不会各写一份。

## 3. 分层与注入

- `src/gutter-copy.ts`（新叶子模块）：`GutterCopyPort` 类型 + `pathLineText`。零 DOM / 零剪贴板，
  可被 `tests/unit` 直接加载（`src/editor.ts` 的 import 图带参数属性，Node 的 strip-only 装载
  吃不下，见 `src/enter-indent.ts` / `src/paste-image.ts` 的同款理由）。
- `src/editor.ts`：在 `createEditor` 内加 `gutterCopy` 实例变量与
  `lineNumberGutterExtensions()`（`lineNumbers({domEventHandlers}) + highlightActiveLineGutter()`）。
  md 分支（`mdGutterExtensions` 的 `installed` 为真时）与 code 分支引用**同一个** helper；
  `EditorHandle.setGutterCopy(port)` 注入出口。处理器在事件发生时读 `gutterCopy` 与 `active.path`，
  不缓存路径；未注入时返回 `false`（原生菜单照旧，不假装能复制）。
- `src/main.ts`：`injectEach((handle) => handle.setGutterCopy({ copy }))`，`copyPathLine` 负责
  `navigator.clipboard.writeText` 与 toast。剪贴板通道与块级复制 / 树复制路径同一条（M244 已
  实证 WKWebView 可用），零新依赖。

## 4. 行号与「实际可见的 gutter」

处理器挂在 `.cm-lineNumbers` 上，因此只有 gutter 的可见面会进入。落在某个行号元素上时取该行；
落在 gutter 的空白处（块级 widget 覆盖的源行没有渲染数字；首行上方 / 末行下方的 gutter 留白）
时，CM 的 `lineBlockAtHeight` 会给出该垂直位置的 block，按它的 `from` 取源行号（首块 / 末块在
越界处自然钳制）。这是 `BlockInfo` 的既有语义，不为本 change 新增映射表。

已知边界：frontmatter 等块级 replace 覆盖的源行在 gutter 里没有数字，右键该处会得到该块起始
源行的行号；这是「按 gutter 垂直位置取源行」的直接结果，与 goto-line 在同类行上的边界一致
（见 `keymap-commands` 的 goto-line 已知边界 ⑤）。

## 5. 反馈与失败

- 成功：`toast(t("D947", { target: text }), [], false, "success")`——与块级复制同一条 toast
  通道、同一个 success tone；`target` 就是写入剪贴板的那串。
- 失败（`navigator.clipboard.writeText` reject / `navigator.clipboard` 缺失）：`D155`
  「复制失败：{reason}」+ `console.warn` 诊断线索（`i18n-exempt: log`）。MUST NOT 在上屏成功提示，
  MUST NOT 吞掉异常。
- 无路径：同一失败通道，reason 取 `D207`「无当前文件」；不触碰剪贴板。
- 文案键：新增 `D947`（成功），失败复用通用 `D155`；两列文案同时进 `src/copy-data.ts` 与
  `文案-Copy.md`，由 `tests/unit/copy.test.ts` 的漂移门禁钉住。

## 6. 验证分层

| 层 | 判据 |
|---|---|
| `tests/unit/gutter-copy.test.ts` | `pathLineText` 的拼法：vault 相对、空格 / 中文、vault 外绝对、首行 / 末行、无字面花括号。 |
| `tests/visual/scenes/gutter-copy-path-line.spec.ts`（chromium） | 真 CM view + 真实右键事件：md / code 首末行、剪贴板逐字、成功 toast、路径含空格 / 中文、vault 外绝对路径、剪贴板拒绝的失败面、无路径（关闭最后标签）、frontmatter replace 块与后续正文、软换行源逻辑行号、code dirty + 撤销只撤此前编辑、非首屏滚动快照、`on-demand` 临时 gutter、`off` 档无 gutter、零副作用、`contextmenu` 默认行为被阻止、焦点不移动。 |
| `scripts/acceptance/scenarios/707-gutter-copy.md`（真机） | WKWebView 上的同一手势（右键走真实指针坐标）：md / code 首行、剪贴板逐字、成功提示；真机不模拟权限拒绝（该面在 chromium 层以 API 拒绝注入覆盖）。 |

## 7. 风险与边界

- **右键坐标**：真机套件里 gutter 数字不在 AX 树中（场景 56 已登记），验收场景用 AXTextArea
  的 bbox 按比例偏移右键到 gutter；坐标落在首行上方留白也归首行，故 `dy` 取小比例即可，不依赖
  字号 / 行高的像素标定。
- **`on-demand` 的临时 gutter**：跳转输入条打开时 gutter 才在场。右键的 `mousedown` 默认行为
  被消费后，输入条不会在 `focusout` 中先收起、gutter 也不会先被卸掉——右键复制因此在这条默认
  档路径上同样可用（chromium 场景有专门用例）。这不是改变三档合同：gutter 仍随输入条开 / 关。
- **多 pane**：`setGutterCopy` 经 `injectEach` 注入每个编辑器实例；处理器读**该实例**的 `active`，
  右键发生在哪个 pane 就复制哪个 pane 的路径与行号。
- **不改 gutter 合同**：`mdGutterExtensions()` 的 `installed` 表达式与 `setMarkdownLineNumbers` /
  `setGotoLineGutterVisible` 的重配逻辑一字不动；本 change 只换 `lineNumbers()` 的配置实参。
