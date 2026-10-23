# Design: 全屏遮罩内的文本可选中、可复制

- Change ID: fullscreen-table-text-selection
- 日期: 2026-10-23

## 1. 复现与读数（起草期实测）

### 1.1 方法

真前端 + 假后端：在基准提交（master `18c21ef2`）的前端上跑 `vite` 开发服务器，用 playwright 的
`stubTauri` 注入假 Tauri 后端，打开含表格 / 代码块的合成文档，经 hover 触发钮打开全屏遮罩，然后读
`document.getSelection()`、`document.activeElement` 与 `getComputedStyle`。两个引擎各跑一遍：

- **chromium**（视觉门禁的引擎）；
- **Playwright WebKit + 真机同款 UA**（`tests/visual/playwright.config.ts` 的 `REAL_WEBKIT_UA`：
  系统 WKWebView 的 UA 没有 `Version/` token，CM 的分支判定因此与真机一致）。

剪贴板读数用 `navigator.clipboard.readText()`（chromium 授权后可读；WebKit 下权限被拒，只能读选区）。

### 1.2 读数

| 动作 | chromium | WebKit（真机同款 UA） |
|---|---|---|
| 表格全屏打开后 | 选区空；`activeElement` = `.lumir-table-fs-overlay` | 同左 |
| **⌘A** | 选区 **601 字符**，锚点**不在**遮罩内 | 选区 **627 字符**，锚点**不在**遮罩内（含标题栏「Lumir · 9.9.9」） |
| ⌘A 后 ⌘C | 剪贴板 = `scene.md × demo-vault scene 24 行 · 修改于 … # 表格全屏场景 …`（整页） | 剪贴板读不到（权限），选区内容与左列同形 |
| **⌘A**（代码块全屏） | 选区 **201 字符**，锚点不在遮罩内 | **223 字符**，同上 |
| ⌘A 后 ⌘C（代码块全屏） | 剪贴板 = `cb.md × demo-vault cb 11 行 …`（整页） | — |
| **鼠标拖选**（表格全屏，首行 cell 内） | 29 字符，锚点在遮罩内 | 32 字符（含链接尾的 `↗︎`），锚点在遮罩内 |
| **鼠标拖选**（跨 3 行 / 跨 cell） | 29 字符，锚点在遮罩内 | 32 字符，锚点在遮罩内 |
| 拖选后 ⌘C | 剪贴板 = 选区原文（逐字相同） | — |
| 拖选终点落在蒙层（scrim）上 | 遮罩**不关**，选区坍缩 | 同左 |
| 选中后 Esc | 遮罩关闭、焦点回 `.cm-content`、**DOM 选区清空** | 同左 |
| Esc 后 ⌘C | 复制到的是编辑器自己的选区（`# 表格全屏场景`），**不是**遮罩里的旧文本 | — |
| 编辑器里 ⌘A | 23 字符、锚点在 `.cm-content` 内（`editor.select-all` 正常） | 同左 |
| 原生输入框（大纲筛选）里 ⌘A | `selectionStart/End = 0/3`（原生全选正常） | 同左 |

### 1.3 结论

- **鼠标拖选已经成立**：遮罩里的文本可选、可复制，两个引擎都成立，跨 cell 也成立。
  所以 mission 里「文本不可选中」这一表述在引擎层**不成立**——需要 Alex 的真机旁证（§6.3）。
- **键盘全选不成立**：⌘A 在遮罩里选中的是**整份文档**（含蒙层后的正文），复制出来的是整页。
  这是本 change 修的缺口，读数可复现、两个引擎一致。
- 遮罩内的计算样式全部是 `user-select: auto` / `-webkit-user-select: text`、`pointer-events: auto`、
  无 `contenteditable`——不存在「CSS 关掉了选中」这回事。

## 2. 根因

机制链三环，逐环有源码落点：

1. **原生 ⌘A 加速键已被让出**（M627）。`src-tauri/src/lib.rs:485` 的 `swap_select_all_item` 把 Edit
   菜单里预置的 SelectAll 换成自定义项，注释写明「加速键刻意不设——设了就等于把 ⌘A 又截走」。菜单项
   仍在，点击经 `app:menu_command` 回到前端（`src-tauri/src/lib.rs:658` 的 `selectAll` 载荷）。
2. **前端只给两个文本面补了 ⌘A**。`src/keys.ts:599` 的绑定 `Cmd-a → editor.select-all`，作用域由
   `scopeOfCommand` 派生为 `text`；作用域闸 `src/keys.ts:1083-1088` 的判据是「事件来自编辑器内容区，
   或来自 composer」——两者都不是就**不消费、不 preventDefault**，按键原样留给原生路径。
3. **遮罩是第三个能持焦、且有可选文本的面，但没有全选实现**。`src/table-fullscreen.ts:164` 与
   `src/code-block-fullscreen.ts:158` 的 `keydown` 只处理 `Esc`（就地消费）与 `Tab`（挡在遮罩内）；
   ⌘A 落到 `handleKeyToken` 返回 false，事件继续冒泡到 window 的分发器，被第 2 环的作用域闸放行，
   最后由引擎做**文档级**全选。

一句话：**「全选」这个能力今天只存在于两个文本面上；遮罩不是它的一员，而原生兜底已经被 M627 拆掉了。**

## 3. 排除的候选（逐条给判据）

| 候选 | 判据 | 结论 |
|---|---|---|
| CSS `user-select: none` | 遮罩 / 面板 / 快照 / 表格 / cell 的计算样式全是 `auto`（WebKit 下 `-webkit-user-select: text`）；全仓 `user-select: none` 只有 `.titlebar-identity`（`src/style.css:435`）；`::selection` 有可见底色（`src/style.css:299`） | 不成立 |
| 遮罩的事件拦截 | `mousedown` 只在 `event.target === overlay` 时关闭（`src/table-fullscreen.ts:157`）；面板 / 内容上的按下不 preventDefault；拖选终点落在 scrim 上遮罩**不关**（读数表） | 不成立 |
| 焦点层 / blur 兜底 | 整个拖选过程 `activeElement` 恒为遮罩；没有触发 `blur`（`src/table-fullscreen.ts:182`） | 不成立 |
| 摘录手势抢选区 | `src/quote-gesture.ts` 的 `currentSelectionRect` 要求选区锚点在 `view.contentDOM` 内；遮罩在编辑器之外 | 不成立 |
| 关闭后残留可复制的旧选区 | Esc 后 DOM 选区长度 0（焦点交还时坍缩），⌘C 拿到的是编辑器自己的内容 | 不成立（写成不变量防回归） |

## 4. 修法

### 4.1 共享助手（一份实现，两处调用）

新建 `src/overlay-select.ts`，导出 `selectAllOf(root: HTMLElement): void`：取 `window.getSelection()`，
`removeAllRanges()`，`Range.selectNodeContents(root)`，`addRange(range)`。

理由：两个遮罩各写一份「怎么选中」就是 REVIEW.md『同一语义两处真源』的形态；这份实现只有一处，
输入是各遮罩自己的内容根。

### 4.2 遮罩内就地消费 ⌘A

在两个遮罩既有的 `keydown` 监听里、`handleKeyToken` 之前加一档（token 归一化走既有 `keyToken`，
`Meta+a` → `Cmd-a`）：

- `token === "Cmd-a"` ⇒ `event.preventDefault()` + `selectAllOf(<内容根>)`，直接返回。
- 表格侧内容根 = 快照容器（`.lumir-table-fs-snapshot` 那个元素）；代码块侧 = 内容容器
  （`.lumir-codeblock-fs-content`）。都是各模块里已有的局部变量，MUST NOT 从装配层去查 DOM。
- 监听器挂在遮罩元素上，只有在遮罩持有焦点时才会收到这个键——不需要额外的「现在开着吗」判据。

顺序为什么成立：遮罩上的监听器先于 window 上的分发器执行；分发器对 `defaultPrevented` 的事件让路
（`src/keys.ts:1033`），因此不会再有第二条路径处理同一个 ⌘A。

### 4.3 菜单「全选」同口径（D3）

`src/main.ts:3220` 的 `selectAllByFocusedFace` 按焦点面路由，今天只有 composer / 编辑器两档。加一档：
遮罩开着就调该遮罩端口的 `selectAll()`（端口新增一个方法，内部复用 4.1 的助手），否则维持原判。
MUST NOT 在装配层直接查遮罩的 DOM——内容根归遮罩自己管。

### 4.4 显式声明可选

`.lumir-table-fs-snapshot` 补 `user-select: text`（与 `.lumir-codeblock-fs-content` 同款，
`src/style.css:1881`）。今天靠继承来的 `auto` 成立，声明之后「可选」是契约而不是默认值——将来任何
祖先加 `user-select: none` 都会被这条规则挡住。

### 4.5 不动的东西

四条关闭路径、单实例语义、焦点交还（`restoreFocus` 注入）、`Tab` 挡在遮罩内、读屏名来源，全部一字不改。

## 5. 为什么不写进统一键位表（D2）

- 表的构造期不变量是「一个 token 一条绑定」，重复绑定直接抛错（`src/keys.ts:1010-1012`）；`Cmd-a`
  已被 `editor.select-all` 占用。
- 同形态的先例就在遮罩里：`Esc` 已被 `editor.widget-escape` 占用，遮罩仍就地消费 Esc
  （`src/code-block-fullscreen.ts:22` 的头注写明这条理由）。⌘A 走同一条路，不新立第三种机制。
- 已知边界（与 Esc 同款）：用户经 `[keys]` 改绑 ⌘A 后，遮罩里的 ⌘A 仍是「选遮罩内容」——
  遮罩内的就地键不参与重绑。这是既有先例的延续，不是本 change 新造的例外。

## 6. 判据与测试

### 6.1 视觉场景（chromium，判别层）

新场景 `tests/visual/scenes/m642-overlay-select-all.spec.ts`：

1. 表格全屏：打开 → ⌘A → 断言 **① 选区非空；② 锚点在 `.lumir-table-fs-snapshot` 内；
   ③ 选区含首行 cell 的文本；④ 选区**不含**遮罩外的文档标题**（负向，与 ②③ 配对，防「选到整页也算
   非空」）；⑤ 剪贴板（chromium 授权后 `navigator.clipboard.readText()`）与 ③ 一致。
2. 代码块全屏：同形，锚点在 `.lumir-codeblock-fs-content` 内。
3. 选中后 Esc：遮罩关闭、DOM 选区清空、焦点回编辑器（行为判据用既有的「⌃D 真删一个字符」口径）。
4. 鼠标拖选（跨 cell）：选区落在遮罩内、文本与 cell 可见文本一致——把「可选」从继承值变成判据。

**先造 FAIL**：这套断言在今天的基准提交上必须红（第 ①–④ 条在 ⌘A 之后就是「锚点在遮罩外」）。
实现前先跑一次确认红，再改代码（REVIEW.md『断言等价于子串』条的口径）。

### 6.2 WebKit 真机同款 UA（第二层）

把该场景加进 `tests/visual/playwright.config.ts` 的 `webkit-realua` project 的 `testMatch`：
选中 / 焦点是引擎差异敏感面（m280 的成立理由同款），chromium 绿不代 WebKit 绿。剪贴板读不到时该
断言降级为「选区内容」，并在场景里写明为什么（权限拒绝不是产品缺陷）。

### 6.3 真机验收的边界（如实登记）

- 套件的 AX 通道**读不到选区**（不暴露 `AXSelectedTextRange`，见 `scripts/acceptance/README.md` 的
  「光标/选区不可断言」条）；原生 ⌘C 经键盘注入**不落地**（M345）。因此真机场景**不能**断言
  「选中了什么、复制到了什么」。
- 真机可断言的是**退出路径不因选中而变**：遮罩内 ⌘A 之后按 Esc，遮罩关闭、焦点回编辑器。
  新增一条这样的验收场景，并在场景头注记「选区与复制不在真机判据内，理由见上」。
- **如果 Alex 观测到的现象是「拖选也选不中」**：那是本次实测覆盖不到的真机差异。处置顺序是
  先真机探针（`pnpm tauri dev` + 真实 WKWebView，读数落 `.local/`）定位，再按本 change 的合同补
  断言——MUST NOT 跳过探针直接写案例级补丁（[rendering-defect-contract-first.md](../../../docs/process/rendering-defect-contract-first.md)）。

### 6.4 单测

这一层是 DOM 行为，按仓内纪律（`tests/unit` 不造 DOM 替身）不新增单测；「哪些 token 归遮罩」若是
纯函数、值得单测，就抽成纯函数并覆盖「Cmd-a 命中 / 其它 token 不命中」两条。

## 7. 已知边界

- **harness transcript（非全屏面）**：它不是两个文本面之一，⌘A 今天同样会选中整页。本 change 不覆盖
  （Alex 原话的范围是 table 全屏）；若需要，另立 change 把「按面路由」做成通用能力。
- **复制是原生纯文本**：表格的列语义不保留（cell 之间是空白 / 换行），链接尾的 `↗︎` 字形可能进选区
  （WebKit 读数实测）。要结构化的复制走块级复制 / 摘录，不是这条路径。
- **长表只复制已渲染的部分**：快照本身只含打开那一刻已渲染的行（既有边界，见 living spec 的
  「全屏查看的快照与性能边界」）。
- **`[keys]` 改绑 ⌘A 不影响遮罩内**（§5）。
- **拖选终点落在 scrim 上**：选区坍缩、遮罩不关——既有行为，本 change 不改；用户要么在面板内起止，
  要么重新选。

## 8. 与 M634（harness 块全屏）的关系与落地时机

- **实现覆盖**：harness 面板的表格 / 代码块全屏走同一份 `createTableFullscreen` /
  `createCodeBlockFullscreen`，本 change 在遮罩模块里的修法对 harness 面**自动生效**，不需要 M634
  改一行。
- **条款分两次**（D5）：M634 已于 2026-10-23 合并进 master（merge `3b5b51d9`，feat 提交
  `8ba8ac4c`），但**尚未归档**——`harness` 的那条 ADDED requirement 还在 `openspec/changes/` 的
  change 目录里、没进 living spec；本 change 若写它的 MODIFIED，`validate --all --strict` 会因
  「同名 requirement 不存在」失败。因此本 change 只定义 `editor-live-preview` 的契约，M634 归档后
  另立一次微型 change 把 harness 条款补上（登记为 follow-up，不在本 change 里伪造 MODIFIED）。
- **落地时机**：M634 已合并（见上），本 change 实现时把分支 rebase 到含它的 master 之上即可。两个
  change 的同文件风险面只有 `src/style.css`（本 change 加一行 `user-select: text`）与 `src/main.ts`
  （本 change 在 `selectAllByFocusedFace` 加一档，M634 已改过装配段）——实现期按 rebase 后的现状
  核对这两处。
- **反向不成立的地方**：M634 的 spec 已经写了「面板里的块全屏复用既有两条能力」；本 change 不改它的
  呈现与关闭路径，因此 M634 的 tasks / spec 无需回改。

## 9. 视觉保真

本 change **无原型、零视觉变化**：选中底色取既有 `::selection`（`src/style.css:299`），不新增色值、
字号、间距与任何可见元素；新增的 CSS 只有一条不可见的 `user-select: text`。因此不适用「有原型时的
视觉保真合同」——实现 PR 不产生视觉基线更新；若出现基线差异，说明改到了不该改的地方。
