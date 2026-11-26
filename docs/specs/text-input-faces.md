# 文本输入面合同（⌘A 与输入面归属）

> 适用面：产品里**用户可编辑的文本面**——编辑器正文、harness composer、浮层 / 内联编辑 / 设置 /
> 搜索里的原生 `input` / `textarea`、以及任何 contenteditable 宿主。
>
> 本文只固定**落面与接管口径**，不固定各输入面的筛选策略、初态、关闭与视觉——那些住各能力自己的
> spec。来源：Alex 2026-11-26「文件树重命名编辑框 ⌘A 不能全选；Quick Open 等输入框同类问题反复
> 出现，这不是个案而是模式」，以及 [渲染/交互缺陷合同先行规则](../process/rendering-defect-contract-first.md)。
>
> 实现居所：`src/keys.ts`（附加面派生 + 分发器）、`src/main.ts` 的 `selectAllAt`（唯一分派）、
> `tests/unit/text-input-faces.test.ts`（输入面清单与静态对账）。

## 术语

| 术语 | 定义 |
|---|---|
| 输入面 | 当前聚焦的、可编辑文本的宿主。两种实现：CM 面（编辑器 contentDOM / composer）与原生宿主（`input` / `textarea` / contenteditable） |
| CM 面 | CodeMirror 承载的可编辑面（编辑器正文、composer）；选区是 CM `EditorState.selection`，不是 DOM Selection |
| 原生宿主 | 浏览器原生编辑的宿主（浮层筛选框、内联重命名、设置、搜索、行号框、审批理由 textarea、任意 contenteditable） |
| 只读内容根 | 全屏遮罩渲染出来的、不可编辑的内容副本（表格 / 代码块）。**不是输入面**——它的 ⌘A 是「选中这段只读内容」，归 `overlay-select` 的既有合同 |
| 附加面 | `text` 作用域之外、由命令清单派生的命中扩展。当前只有 `editor.select-all`：除两处 CM 面外，原生宿主也命中（`NATIVE_INPUT_HOST_COMMAND_IDS`） |

## 不变量

### T1 — ⌘A 选中**当前输入面**的全部内容

焦点在任一输入面内时，`⌘A` SHALL 选中该面的全部内容：原生宿主选中其 `value` / 可编辑子树；
编辑器与 composer 选中 CM 文档（composer 只选文本，卡片不参与）；只读内容根选中其内容副本。
MUST NOT 选到另一个面的内容（输入框持焦时选中正文 = 违反本条）。

### T2 — 应用显式接管，不依赖原生兜底

被接管的 `⌘A` MUST `preventDefault`。M627 起 Edit 菜单的预置 Select All 已让出加速键，原生
`selectAll:` 的菜单通道与 webview 的默认路径都不再是本仓可依赖的兜底（WKWebView 上实测落空）。
判据 MUST 同时读「选区正确」与「`defaultPrevented` 为真」——只读选区在 chromium 上分不出
「应用接管」与「引擎顺手做了」。

### T3 — 单一分派：一条绑定、一处落面判定

`⌘A` SHALL 只有一条绑定（`src/keys.ts` 的 `Cmd-a` → `editor.select-all`）与一处落面分派
（`src/main.ts` 的 `selectAllAt`，键盘按事件目标、菜单按当前焦点）。输入面 MUST NOT 各自就地处理
`⌘A`（本地 `case "Cmd-A"` / `input.select()` 副本）；新增原生文本输入面 MUST NOT 需要新增分派分支
——它由 T1 的结构化判据自动纳入。静态对账见「证伪方式」。

### T4 — 组合期归输入法

输入法组合期（`isComposing` 为真或 `keyCode === 229`）的 `⌘A` MUST NOT 被本层接管、MUST NOT 建立
全选、MUST NOT 改变输入框选区；组合结束后的下一拍才回到 T1–T3。

### T5 — 焦点不在输入面时不消费

焦点不在任何可编辑文本宿主内（按钮、树行、标签、空白 chrome）时，`⌘A` MUST NOT 被全选分支消费
（不 `preventDefault`、不改变任何面的选区）。「全局 Select All」MUST NOT 抢错焦点。

### T6 — 其余编辑键仍走原生

复制 / 剪切 / 粘贴 / 撤销 / 重做 / 移动 / 删除 / Emacs 文本导航族在原生宿主内 SHALL 继续由原生
路径处理；输入面 MUST NOT 拦截它们。`text` 作用域的 Emacs 命令 MUST NOT 因附加面放宽到原生宿主
（它们实现作用于编辑器文档）。

## 输入面清单

判据的真源是 `tests/unit/text-input-faces.test.ts` 的 `REGISTRY`（新增原生文本输入未登记即红）。
本表是给人读的同一份清单。

| 输入面 | 实现 | ⌘A 落面 | 行为证据 |
|---|---|---|---|
| 编辑器正文 | CM contentDOM（`src/editor.ts`） | `selectAllAt` → 编辑器命令 | `m627-composer-select-all`、`text-input-select-all-nov26`（编辑器回归） |
| harness composer | CM contentDOM（`src/harness-panel.ts` / `src/harness-composer.ts`） | `selectAllAt` → composer 命令 | `m627-composer-select-all`、验收 215 |
| Quick Open 筛选框 | 原生 `input`（`src/quick-open.ts`） | `selectAllAt` → 宿主 `.select()` | `quick-open.spec.ts`、验收 230d |
| 大纲筛选框 | 原生 `input`（`src/toc.ts`） | 同上 | `selector-aria-ime-nov25.spec.ts`、验收 13 |
| vault 筛选框 | 原生 `input`（`src/vault-switcher.ts`） | 同上 | `selector-aria-ime-nov25.spec.ts`、验收 17 |
| 文件树内联编辑（重命名 / 新建） | 原生 `input`（`src/tree.ts`） | 同上 | `text-input-select-all-nov26`、验收 881 |
| 文件内搜索 | 原生 `input`（`src/search.ts`） | 同上 | `text-input-select-all-nov26`、验收 881 |
| 跳转到行 | 原生 `input`（`src/goto-line.ts`） | 同上 | `text-input-select-all-nov26`、验收 881 |
| 键位面板查询框 | 原生 `input`（`src/bindings-panel.ts`） | 同上 | `text-input-select-all-nov26` |
| 设置面板文本框 | 原生 `input`（`src/settings-panel.ts`） | 同上 | 静态清单 + 统一行为（无独立 ⌘A 用例） |
| 审批理由 | 原生 `textarea`（`src/harness-panel.ts`） | 同上 | 静态清单 + 统一行为 |
| 表格 / 代码块全屏 | 只读内容根（`src/table-fullscreen.ts` / `src/code-block-fullscreen.ts`） | 遮罩自己的 `selectAllOf`（**不在**输入面分派内） | `m642-overlay-select-all` |

Skill 候选与 wikilink 候选没有独立输入框——它们过滤的是 composer 文本，⌘A 归 composer 面。

## 证伪方式

- **单元（静态对账）**：`tests/unit/text-input-faces.test.ts` 四层——① 凡创建原生文本输入的模块
  必须登记；② 清单条目必须仍创建（僵尸条目红）；③ 除两个只读遮罩外，源码里出现字符串字面量
  `Cmd-A` 即红；④ `.select()` 只允许在统一分派入口与三处「打开即预选」的既有焦点动作里。反向
  探针（临时加一个未登记输入面 + 本地 `Cmd-A` + 未登记 `.select()`）实测三条判据分别判红。
- **单元（分派）**：`tests/unit/keys.test.ts`——附加面清单 ↔ 绑定表双向对账；⌘A 在原生宿主命中、
  `⌃F` 不命中；非文本面不消费；组合期让路；缺 `isTextInputEvent` 时既有替换件逐条不变。
- **浏览器结构（真实 DOM）**：`tests/visual/scenes/text-input-select-all-nov26.spec.ts`——每个面
  同时读「`defaultPrevented` 为真 + 选区/值正确 + 其它面的选区不变」。先红后绿：在实现前跑同一
  spec，重命名 / 新建 / 搜索 / 行号 / 键位面板 / 菜单六条按预期判红。
- **真机（WKWebView）**：`scripts/acceptance/scenarios/881-text-input-select-all-nov26.md`——键盘
  通道是否真的送达输入框只有真机可答；chromium 的原生 select-all 会掩盖缺失的接管。
- **边界（如实登记）**：静态扫描认 `document.createElement` 与共享 `element(...)` 两种工厂；另造
  工厂名的新输入面可能漏检——行为面由 T1 的结构化判据兜底（任何原生文本宿主都落分派）。
