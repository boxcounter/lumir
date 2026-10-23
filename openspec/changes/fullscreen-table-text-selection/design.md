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

**这层探针能证什么、不能证什么**（2026-10-23 Alex 的现场确认之后补的口径）：它跑在引擎上，不是真机
WKWebView。本次实测恰好证明两者的行为会分叉（§1.3），因此下面的读数只用于**定位代码结构层面的缺口**，
MUST NOT 当作真机行为的证据；真机事实以 Alex 的实测与 §6.1 的探针为准。

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
| **真机（WKWebView）里的鼠标拖选** | — | **没有出现选择块 / 选中状态**（Alex 2026-10-23 现场确认；原话见 proposal 的 Why） |

### 1.3 结论：两类事实，取证方式不同

- **代码结构可证的缺口（引擎层读数）**：`⌘A` 在遮罩里选中**整份文档**（601 / 627 字符，锚点在遮罩外），
  复制出来的是整页。这是本 change 修的确定项。
- **真机实测的事实（Alex，WKWebView）**：同样的鼠标拖选**没有出现选择块 / 选中状态**。
- **分叉本身是证据**：同一动作在引擎层探针里能建立选区（29 / 32 字符）并可复制，而在真机上没有选区
  反馈 ⇒ Playwright 的 WebKit 与真机 WKWebView 在这一行为上**不等价**，引擎层的「拖选能选中」**不能**
  用来否定 Alex 的现场。真机根因**未定位**，候选与判据见 §2.1，探针见 §6.1。
- 引擎层的计算样式全部是 `user-select: auto` / `-webkit-user-select: text`、`pointer-events: auto`、
  无 `contenteditable`——这只能排除「引擎里被 CSS 关掉」，**不能**排除真机上「选区建立了但看不见」
  或「选区压根没建立」（两种都在 §2.1 里）。

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

### 2.1 真机拖选不成立：根因未定位，候选与判别据

Alex 的现场（§1.3）是「拖选没有出现选择块 / 状态」。探针要在下面五条里做区分，五条互斥、各有可观测读数：

| # | 假设 | 探针要读什么 |
|---|---|---|
| H1 | 选区**没有建立**（WKWebView 不认这块内容可选） | 拖选后 `getSelection().rangeCount` / `toString().length` 仍为 0；⌘C 拿不到 cell 文本 |
| H2 | 选区建立了但**看不见**（`::selection` 与遮罩底色对比过低） | 选区非空、⌘C 能拿到 cell 文本；但截图里选中区域与未选中区域无可辨差异 |
| H3 | 选区建立后被**立刻清掉** | `selectionchange` 时间线：建立后紧跟一次清空；与 `blur` / `close` 事件时刻对得上 |
| H4 | 遮罩 / 焦点状态变化 | 拖选期间 `document.activeElement` 离开遮罩，或 `overlay.hidden` 变成 true |
| H5 | 事件未到达内容（tauri 注入脚本 / drag region / `pointer-events`） | `mousedown` 的 `defaultPrevented` 与 `composedPath()`；`pointer-events` / `user-select` 的计算值；`mousemove` 是否到达文档 |

**H2 已有量化证据**（起草期读 token 算出来的，不是猜测）：`::selection` 的底色取 `--accent-tint`，
遮罩壳的底色是 `--preview-bg`，两者对比：

| 主题 | 原生选区带 vs 遮罩底色 | 编辑器自绘选区带 `--sel-band` vs 正文底 |
|---|---|---|
| light | `#eef1fb` on `#ffffff` = **1.13:1** | `#c6c5bf` on `#fdfdfc` = 1.70:1 |
| dark | 合成 `rgb(52,56,71)` on `#26272b` = **1.28:1** | 合成 `rgb(83,83,86)` on `#222326` = 2.05:1 |
| eink | `--sel` `#b9b9b9` on 白底 ≈ 1.9:1 | 同值（两处同 token） |

也就是说：**应用的原生选区带一直比编辑器那条自绘的弱一半左右**；而全屏快照是应用里少有的一处「只能靠
原生 `::selection` 显示选中」的面（编辑器里看到的那条是 CM 自绘的 `.cm-selectionBackground`，
真源是 `src/preview/theme.ts` 的 `--sel-band`）。真机上「没有出现选择块」很可能就是这一档底色。

**最快的判别动作**（真机上一秒钟，建议作为探针第一步）：遮罩里拖选后按 ⌘C 粘到任意编辑器里——
粘出 cell 文本 ⇒ 选区已建立（H2）；粘不出或粘出旧内容 ⇒ 选区没建立（H1 或 H3–H5）。

## 3. 排除的候选（引擎层，逐条给判据）

> 下表是**引擎层**（chromium / Playwright WebKit）的计算样式与事件读数。真机未必同判——§1.3 的分叉
> 已经证明引擎与真机会不一致，因此探针（§6.1）要在真机上重读这几项，MUST NOT 把下表当成真机的排除清单。

| 候选 | 判据 | 结论 |
|---|---|---|
| CSS `user-select: none` | 遮罩 / 面板 / 快照 / 表格 / cell 的计算样式全是 `auto`（WebKit 下 `-webkit-user-select: text`）；全仓 `user-select: none` 只有 `.titlebar-identity`（`src/style.css:435`） | 引擎层不成立；真机待探针（`user-select` 在真机的计算值未读） |
| `::selection` 不可见 | `::selection` 有声明（`src/style.css:299`），但它与遮罩底色的对比只有 1.13:1（light）/ 1.28:1（dark）——**声明存在不等于看得见**，见 §2.1 H2 | **未排除**（本 change 的候选根因之一） |
| 遮罩的事件拦截 | `mousedown` 只在 `event.target === overlay` 时关闭（`src/table-fullscreen.ts:157`）；面板 / 内容上的按下不 preventDefault；拖选终点落在 scrim 上遮罩**不关**（读数表） | 引擎层不成立 |
| 焦点层 / blur 兜底 | 整个拖选过程 `activeElement` 恒为遮罩；没有触发 `blur`（`src/table-fullscreen.ts:182`） | 引擎层不成立 |
| 摘录手势抢选区 | `src/quote-gesture.ts` 的 `currentSelectionRect` 要求选区锚点在 `view.contentDOM` 内；遮罩在编辑器之外 | 引擎层不成立 |
| 关闭后残留可复制的旧选区 | Esc 后 DOM 选区长度 0（焦点交还时坍缩），⌘C 拿到的是编辑器自己的内容 | 引擎层不成立（写成不变量防回归） |

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

### 4.5 若探针结论是 H2（选区带太弱）：可见性口径

这一档**要等探针**，不在起草期定色值。方向是把遮罩内的选区带抬到与编辑器自绘选区带同强度：现在
`::selection` 用的 `--accent-tint` 与遮罩底色只有 1.13:1 / 1.28:1（§2.1 的表），而 `--sel-band` 是
1.70:1 / 2.05:1。可走的取法（实现期二选一，都要先给 Alex 看效果）：

- **遮罩内覆盖**：给 `.lumir-table-fs-snapshot` / `.lumir-codeblock-fs-content` 里的 `::selection` 换
  到 `--sel` / `--sel-band` 一档，作用域只在浮层——影响面最小，但「同一应用两种选中色」本身是一种分叉；
- **全局抬档**：把 `::selection` 的取值整体对齐 `--sel-band`——一致，但会改变编辑器以外所有原生选中的
  观感（原生输入框、transcript、路径链接），属跨切面的视觉变化，按基线纪律走。

MUST NOT 新增色值；MUST NOT 为了对比度改正文色（前景与带的可辨性是两条独立判据）。

### 4.6 拖选侧的根因修法（H1 / H3–H5）

由探针结论决定，MUST NOT 在结论之前写死。若落在跨切面（全局 CSS、Tauri 注入脚本、webview 配置），
按影响面升级线停下报 tower → Alex，不在本 change 里顺手改。

### 4.7 不动的东西

四条关闭路径、单实例语义、焦点交还（`restoreFocus` 注入）、`Tab` 挡在遮罩内、读屏名来源，全部一字不改。

## 5. 为什么不写进统一键位表（D2）

- 表的构造期不变量是「一个 token 一条绑定」，重复绑定直接抛错（`src/keys.ts:1010-1012`）；`Cmd-a`
  已被 `editor.select-all` 占用。
- 同形态的先例就在遮罩里：`Esc` 已被 `editor.widget-escape` 占用，遮罩仍就地消费 Esc
  （`src/code-block-fullscreen.ts:22` 的头注写明这条理由）。⌘A 走同一条路，不新立第三种机制。
- 已知边界（与 Esc 同款）：用户经 `[keys]` 改绑 ⌘A 后，遮罩里的 ⌘A 仍是「选遮罩内容」——
  遮罩内的就地键不参与重绑。这是既有先例的延续，不是本 change 新造的例外。

## 6. 判据与测试

### 6.1 第一步：真机探针（先于任何产品代码）

> 依据：Alex 2026-10-23 的现场确认（真机拖选没有出现选择块），以及引擎探针与真机的分叉（§1.3）。
> 合同先行见 [rendering-defect-contract-first.md](../../../docs/process/rendering-defect-contract-first.md)：
> 先定位不变量与判据，MUST NOT 只做案例级补丁。

- **环境**：`pnpm tauri dev` 起真实 WKWebView（合成长验收 vault；用户真实 vault 只读），Safari 的
  「开发」菜单连 Web Inspector 读 DOM 与事件。
- **样本**：一张渲染为 grid 的表（含行内 code 与链接）+ 一条长代码块。
- **读数**（按 §2.1 的 H1–H5 逐条取）：
  1. 拖选后 `getSelection()` 的 `rangeCount` / `toString()` / 锚点归属；`selectionchange` 事件序列
     （建立与清空的时间线）。
  2. 拖选后按 ⌘C 粘到编辑器里看内容——H1 与 H2 的分水岭（§2.1 末尾的判别动作）。
  3. 未选中 / 选中两张截图（同窗口、同滚动位），肉眼与像素比对选中带是否存在。
  4. `mousedown` / `mousemove` 的 `defaultPrevented` 与 `composedPath()`；`pointer-events` 与
     `user-select` 的计算值。
  5. 对照：同一拖选在**编辑器正文**（非全屏）里做一次。CM 的选区是自绘的，所以「编辑器里能看见选中」
     **不能**证明原生选区可见；但「编辑器里也选不中」会把问题指向全局，而不是遮罩这一层。
- **落盘**：读数、截图与 console 记录进 `.local/probes/2026-10-23-fullscreen-selection/`（git 外），
  任务与实现报告给可 `ls` 的绝对路径。
- **分流**：
  - H2（选区建立、看不见）⇒ 修法加一条**选区带可见性**（与 `--sel-band` 同强度口径），属视觉变化：
    三主题的 `::selection` 观感会变，按基线纪律先给 Alex 过目再改。
  - H1 / H3 / H4 / H5 ⇒ 按结论改实现面；若指向跨切面原因（全局 CSS、Tauri 注入脚本、webview 配置
    这类），命中影响面升级线——**停下报 tower → Alex**，不在本 change 里顺手改。

### 6.2 合同断言（跟随探针结论）

- **不依赖根因、可直接写的不变量**：遮罩内的 `user-select` 不得为 `none`；拖选后**若**选区建立，锚点
  必须在遮罩内容内；⌘A 的落面断言（6.3）。这些在任何根因下都必须成立。
- **跟随探针的部分**：
  - 确认 H2 ⇒ 加计算色彩断言：选中带与遮罩底色的对比不低于 `--sel-band` 与正文底色的对比（三主题
    各一档，取值口径见 §2.1 的表），并留一张选中态截图进本地视觉门禁。
  - 确认 H1 / H3 / H4 / H5 ⇒ 把该根因的最小复现写成断言再改代码（例如「被立即清空」⇒ 断言拖选后
    `selectionchange` 的收口次数；「事件未到达」⇒ 断言 `mousedown` 的 `defaultPrevented`）。

### 6.3 ⌘A 的判据（根因已核实，可直接落地）

新场景 `tests/visual/scenes/m642-overlay-select-all.spec.ts`：

1. 表格全屏：打开 → ⌘A → 断言 **① 选区非空；② 锚点在 `.lumir-table-fs-snapshot` 内；
   ③ 选区含首行 cell 的文本；④ 选区**不含**遮罩外的文档标题（负向，与 ②③ 配对，防「选到整页也算
   非空」）；⑤ 剪贴板（chromium 授权后 `navigator.clipboard.readText()`）与 ③ 一致。
2. 代码块全屏：同形，锚点在 `.lumir-codeblock-fs-content` 内。
3. 选中后 Esc：遮罩关闭、DOM 选区清空、焦点回编辑器（行为判据用既有「⌃D 真删一个字符」口径）。
4. **先造 FAIL**：这套断言在今天的基准提交上必须红（①–④ 在 ⌘A 之后就是「锚点在遮罩外」），
   确认红了再改代码（REVIEW.md『断言等价于子串』条的口径）。

### 6.4 WebKit 真机同款 UA 的作用降级

把该场景加进 `tests/visual/playwright.config.ts` 的 `webkit-realua` project 的 `testMatch` 仍然值得
（引擎族回归、焦点路径同 m280 的成立理由），但**它不能替代真机**——本次分叉（引擎能选中、真机看不见）
本身就是证据；真机判据只认 §6.1 的探针与 Alex 的观感裁决。

### 6.5 真机验收的边界（如实登记）

- 套件的 AX 通道**读不到选区**（不暴露 `AXSelectedTextRange`，见 `scripts/acceptance/README.md` 的
  「光标/选区不可断言」条）；原生 ⌘C 经键盘注入**不落地**（M345）。因此真机场景**不能**断言
  「选中了什么、复制到了什么」。
- 真机可断言的是**退出路径不因选中而变**：遮罩内 ⌘A 之后按 Esc，遮罩关闭、焦点回编辑器。
  新增一条这样的验收场景，并在场景头注记「选区与复制不在真机判据内，理由见上」。
- 选中的**可见性**属观感，归 Alex 手感裁决（套件只留截图证据）。

### 6.6 单测

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
- **引擎层读数不等于真机行为**：本次已经实测到分叉（引擎能建立选区、真机看不到选中态）。后续任何
  「选中相关」的结论，引擎层只能用来做回归，不能用来证真机成立。
- **若根因是 H2（选区带太弱），修法会改三主题的 `::selection` 观感**：属视觉变化，需 Alex 过目并按
  基线纪律处理；本 change 的 spec 只写「可辨」的判据，不写死色值。

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

本 change **无原型**：不新增色值、字号、间距与任何可见元素。**有一处刻意的可见变化**（实施期修正，
见 §10.2）：遮罩内的原生选区带从「被 CM 主题清成透明」改为 `--sel-band`，这正是「选中态可辨」的
需求本身。视觉基线与像素门禁的判据面是**未选中**的静态画面，基线场景不选中文本，因此实现 PR 不产生
基线更新；若出现基线差异，说明改到了不该改的地方（另见 §10.3 的截图证据）。

## 10. 实施期探针结论（2026-10-23，M650 实现）

> 本节是实现期的实测回流，不改写上文已评审的判定；两者冲突处以本节为准并标注。

### 10.1 真机计算样式（WKWebView）

在 `pnpm tauri dev` 的真实 WKWebView 上（端口 1430、隔离 XDG、合成 vault），遮罩打开、未选中时
读到的 `::selection` 计算底色：

| 元素 | `::selection` background |
|---|---|
| 快照容器 `.lumir-table-fs-snapshot` | `rgb(238, 241, 251)`（全局 `--accent-tint`，与 §2.1 H2 的读数一致） |
| 表格行 `.cm-line.cm-lp-table-row` / cell `.cm-lp-table-cell` | **`rgba(0, 0, 0, 0)`（透明）** |

### 10.2 根因修正：不是「选区带太弱」，是「被 CM 主题清成透明」

`@codemirror/view` 的 `hideNativeSelection`（`drawSelection` 的邻居主题，`Prec.highest`）对
`.cm-line ::selection` 声明 `background-color: transparent !important`——它把编辑器内原生选区
藏起来，让 CM 自绘的 `.cm-selectionBackground` 显示。快照克隆里的表格行带 `.cm-line`，而
`mirrorThemeScope`（§4.1 同族机制，`src/overlay-scope.ts`）把编辑器的主题 scope 类镜像到浮层
内容容器上 ⇒ **那条隐藏规则在遮罩内继续命中**。

因此 §2.1 H2 的机制从「`--accent-tint` 对比只有 1.13:1」修正为「cell / 行上的原生选区底色是
透明的；只有快照根自己的 `::selection` 还是 `--accent-tint`」。这正是 Alex 实测「拖选没有出现
选择块」的代码级解释：选区建立了，但选中带被静默抹成透明。

**修法**（实现已落地）：遮罩内容内的 `::selection` 覆盖到 `--sel-band`，必须带 `!important`
与比 CM 规则更高的特异度（三层类选择器），否则压不过 `Prec.highest` + `!important`。零新增色值。

### 10.3 真机拖选分流结论：H2 确认，H1/H3/H4/H5 排除

前置条件：窗口必须是 **key window**（先真实点击一次标题栏）。非 key 时首个 mousedown 被激活
吃掉，表现为「事件不到 DOM」——那是注入通道的边界，不是产品行为。

真机读数（证据 `.local/probes/2026-10-23-fullscreen-selection/`）：

| 动作 | 读数 | 判定 |
|---|---|---|
| 表格全屏内真实鼠标拖选（跨 cell） | `selectstart` → `selchange` len 24 → 32；松手后 60/300/1200ms 仍 `rangeCount=1, len=32`；锚点 / 焦点都在快照内；`activeElement` 恒为遮罩 | **H1/H3/H4/H5 排除** |
| 同一次选中的计算样式 | 修复前 `cell::sel bg=rgba(0,0,0,0)`；修复后 `rgb(198,197,191)`（= `--sel-band`） | **H2 确认** |
| 拖选后 ⌘C | `pbpaste` = 选中的 32 字符表格文本（含链接尾 `↗︎`） | 原生纯文本复制成立 |
| 代码块全屏内拖选（一行） | 40 字符选区、锚点在代码行；截图可见选区带；`pbpaste` = 那 40 字符 | 两个面同修法生效 |
| 遮罩内 ⌘A | 268 字符选区（该代码块内容），不是整页 | 就地全选成立 |

截图：`01-table-selection-light.jpg`（表格选中带）、`02-codeblock-selection-light.jpg`（代码块
选中带）。**⌘C / ⌘A 在真机可用（前提是窗口为 key window）**：⌘C 后 `pbpaste` 与选中文本逐字一致，
⌘A 选中浮层内容而非整页；验收 README 里 M345 的「原生剪贴板不落地」旧表述已按此口径收窄。dark / eink 的真机截图未取：真机操作中途弹出 macOS 屏幕录制授权弹窗（属系统隐私
授权，未点 Allow），GUI 操作就地停止；三主题的选区带对比由 chromium 场景
`tests/visual/scenes/m642-overlay-select-all.spec.ts` 逐主题钉住（计算值）。
