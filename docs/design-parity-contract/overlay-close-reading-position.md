# 浮层关闭交还焦点：阅读位置不变量（M280）

> 状态：**生效**（2026-09-27，M280；**2026-09-28 M286 增补 CL-2 / CL-3**，CL-1 及其判别层表未动）。
> 本文件与同目录的 `README.md`（M62 原型—生产一致性契约，
> 2026-09-12 已失效）是两份**独立**的契约，不要互相当作依据。

本契约收口的是**一类**缺陷的族名与判据，不是某一次现场：M186 记录族名、M240（表格全屏）与
M277（代码块全屏）各自踩到一次、M274/M279 两次调查给出机制与反例、M280 定位到「写回被自己的
落点判定吃掉」这个第二半根因并收敛实现。条款按
[rendering-defect-contract-first.md](../process/rendering-defect-contract-first.md) 写成
不变量，并逐条给出可证伪的判据与判别层。

## CL-1：浮层关闭交还焦点不得改变阅读位置

**条款**：任意「浮层打开 → 浮层持焦 → 关闭并把焦点交还编辑器」的动作序列，其**前后**
编辑器滚动容器的 `scrollTop` / `scrollLeft` MUST 与打开时恒等；关闭动作 MUST NOT 成为视口
位移的原因。（位移的合法来源只有用户输入与装载复位。）

**输入分布**（条款引用这些维度，不引用具体文档）：

| 维度 | 取值 | 为什么在分布里 |
|---|---|---|
| 浮层种类 | 表格全屏 / 代码块全屏 / 图片遮罩 / 键位面板 / 大纲浮层 / 搜索面板 | 四条已知落点 + 本轮全仓排查出的同形态路径 |
| 打开入口 | 命令（`[keys]` 绑定）/ 块的 hover 触发钮 / 全局键位 | 两条入口共用同一个 `close(reason)` 单入口，但装配点各一处，历史上正是「只改了一半」 |
| 关闭路径 | `Esc` / 点遮罩 / 再执行同一命令（toggle）/ 焦点兜底（`blur`） | 前三条交还焦点、第四条不抢焦点（不回写，见下） |
| 关闭前编辑器是否已持焦 | 已持焦（`view.hasFocus === true`，DOM 折叠选区已在内容区） / 未持焦 | **只有「已持焦」这一档会触发引擎的聚焦揭示**（M279 的 T1–T4 对照） |
| caret 相对视口 | 视口上方 ≥ 一屏 / 视口内 / 视口下方 | 视口上方是实测能稳定复现的那一档；视口内不触发揭示 |
| 捕获锚 | 非文档原点 / 文档原点（锚 = 0） | 文档原点那一档是唯一保留的早退（见「已知边界」） |

**判据（每条都必须能 FAIL）**：

1. **真机同款 UA 的 WebKit 分支下**（无 `Version/` token）：关闭前 / 关闭后的 `scrollTop`
   逐值相同（容差 ≤ 1px，仅吸收读数舍入）。**判别消费者**：
   `tests/visual/scenes/m280-overlay-esc-scroll.spec.ts` 在 `webkit-realua` project 下的那一遍
   （同一份 spec 在 chromium 下也跑，见下条 2）。
2. **chromium 分支**：**同一份场景照跑**（chromium project 没有 testMatch 限制，两条判据共用
   一个 spec 文件），作结构性回归护栏——它对这个机制结构性看不见，绿灯**不构成**条款通过的证据；
   留着是因为「场景能跑、前提断言成立」本身也要有回归（fixture 或前提被改坏时它先红）。
3. **真机层**：**暂无可用判据**。M280 试做过表格 / 代码块两条真机场景，因器材三约束做不出可证伪的
   判据（无 `scrollTop` 读数、AX 文本窗口宽达 ~2500–3600px、命令入口的块定位范围把「caret 在视口
   上方」的可用带子压到 ~2048 字符以内），场景未留在套件里；逐条实测与补齐路径见 docs/backlog.md
   的「验收套件表达不了 CL-1 的判据」条。在此之前真机结论只能由人肉复现给出。

## CL-2：应用自身造成的视口变动 MUST NOT 进入阅读位置（M286 增补）

**条款**：任意「**应用自己**推动滚动容器」的动作（① 交还焦点时引擎的聚焦揭示；② 装载复位
`scrollTop = 0`），其 **让位窗口**内到达的 `scroll` 事件 MUST NOT 被阅读位置的捕获侧记录——
窗口内到达的滚动事件对捕获侧**整体不可见**（不读位置、不排期）。窗口 MUST 覆盖
「中间态 → 目标位置」两拍；窗口的**边界** MUST 由推视口的一方自己的写回落地定义（本仓取
「本模块发放的 `scrollIntoView` 效果被 CM 的测量周期落地之后的那一拍」），MUST NOT 由任何时长量
定义。窗口 MUST NOT 打断已排期的落盘（窗口前用户自己造成的待写位置照旧落盘）。

**输入分布**（条款引用这些维度，不引用具体文档）：

| 维度 | 取值 | 为什么在分布里 |
|---|---|---|
| 推视口的一方 | 交还焦点原语（`focusPreservingReadingPosition`）/ 装载复位（`editor.reloadSession`） | 两条是当前全部的应用自推路径；纯计数器让位窗口对两者同形，新增第三条时 SHOULD 复用同一开窗器 |
| 中间态口径 | `0`（引擎揭示到 caret 处）/ `-1`（WebKit 实测的负值中间态）/ 目标位置本身 | **按值判一定漏**（两种口径都实测出现过），因此判据取「窗口整体」而不是「只忽略篇首」 |
| 窗口开前的状态 | 无待写位置 / 已有排期的待写位置（用户刚滚过） | 第二条是「窗口 MUST NOT 打断已排期的落盘」的触发面 |
| 捕获锚 | 非文档原点 / 文档原点 | 锚 = 0 是恢复侧的既有早退（M110），中间态落盘恰好落在这一档 ⇒ 静默丢失阅读位置 |

**判据（每条都必须能 FAIL）**：

1. **单测（确定性，判别消费者）**：`tests/unit/reading-position.test.ts` 的「转场窗口」一组——
   开窗 → 推入中间态（含 `0` 与负值形态）→ 关窗 → 越过防抖，落盘载荷 MUST 是窗口前的位置；
   同组另有一条**空窗对照**（同样的中间态在无窗口时如实落盘），保证判据有输入。
   `tests/unit/viewport-transition.test.ts` 判窗口本身（嵌套安全、多余 end 不压负计数）。
   **消融**：删掉 `scrolled()` 里那条早退 ⇒ 主用例如实红在 `0 !== 1200`
   （`test-results/m286/ablation-gate-unit.log`，git 外）。
2. **真机同款 UA 的 WebKit 分支（判别消费者）**：`tests/visual/scenes/m280-overlay-esc-scroll.spec.ts`
   的表格用例——越过 1s 防抖后，桩收到的 `reading_position_put` 载荷 MUST 落在 ESC 前那一拍的**真实锚**
   （行号差 ≤ 1）且 MUST NOT 为 `pos 0`。该用例**断言前提**：这一支必须看到引擎真的动过视口
   `focus` 调用 `before 1540 → after 0`（没动过即空转，MUST FAIL）。修后实测载荷 `pos 1628`。
3. **chromium 分支**：同一份 spec 照跑，作结构性护栏（`preventScroll` 挡住揭示 ⇒ 前提断言不成立，
   这一支只证明「场景能跑」，绿灯**不构成**条款通过证据）。
4. **真机层（系统 WKWebView）**：**暂无可用判据**（套件无 `scrollTop` 读数、AX 文本窗口过宽，
   与 CL-1 同族，见 docs/backlog.md 的「验收套件表达不了 CL-1 的判据」条）。真机上的间接观察是
   位置文件里不再出现 `pos 0`，但它不在套件判据内——如实登记为**未覆盖**。

**判别层（CL-2）**：

| 层 | 看得见吗 | 实测依据 |
|---|---|---|
| tests/unit（node） | **看得见**（确定性：注入中间态时间线，无需引擎） | 消融红：`test-results/m286/ablation-gate-unit.log` |
| chromium（Playwright） | 看不见（`preventScroll` 挡住揭示，中间态不发生） | 本轮读数：`focusCalls ... before 1541 after 1541` |
| Playwright WebKit，真机同款 UA | **看得见**（中间态真的发生，载荷判据在这里有输入） | 本轮读数：`before 1540 → after 0`，载荷 `pos 1628` |
| 系统 WKWebView（真机） | 机制上同上；判据**表达不了** | 与 CL-1 同一格的理由 |

## CL-3：文档就地重载 MUST 与装载同口径收口（M286 增补）

**条款**：前台文档被**就地重载**（外部改写自动重载 / 冲突放弃重载）之后：

1. 视口 SHALL 按**装载口径**恢复到该文档的阅读位置（与打开文档同一条恢复路径），MUST NOT 停在篇首；
2. **内容取自旧一份文档**的浮层 SHALL 退出并交还焦点（它们呈现的是打开那一刻的 DOM 快照），
   MUST NOT 停留在屏幕上展示已不存在的内容；
3. 尽上述两条只对**前台**文档成立：外部改写**后台**标签时 MUST NOT 拽走前台视口、
   MUST NOT 关掉前台浮层（后台标签只换代它的 state）。

**输入分布**：

| 维度 | 取值 | 为什么在分布里 |
|---|---|---|
| 触发源 | 外部改写（watch 命中且缓冲干净）/ 冲突放弃（用户选「重载（放弃我的修改）」）/ 自身写盘回声（**不重载**） | 前两条共用 `reloadDocument`；第三条是回声判据的正对照（不该产生重载） |
| 前台 / 后台 | 前台文档 / 后台标签 | 只有前台有视口与浮层；后台那条是「不许越界触发」的负向面 |
| 浮层种类 | 表格全屏 / 代码块全屏 /（图片遮罩：**未收**，见下） | 三者都是文档派生的快照；前两者收在 `closeDocumentOverlays()` |
| 文档是否有历史位置 | 有（读过一半）/ 无（从未滚过） | 无历史时 SHOULD 静默从篇首开始，与装载口径一致 |

**判据（每条都必须能 FAIL）**：

1. **chromium 场景（判别消费者）**：`tests/visual/scenes/m286-external-reload-viewport.spec.ts`
   第一条用例——重载后 `scrollTop` 逐值回到重载前（行号相同）、遮罩 `hidden === true`、载荷里
   不出现 `pos 0`；第二条用例（负向）——外部改写后台标签时前台视口与遮罩都不动。
   **消融**：去掉 `src/save-controller.ts` 的两处 dep 调用 ⇒ 第一条如实红
   （`重载前 scrollTop=1541、重载后=0`、`afterOverlayOpen: true`），第二条照旧绿
   （`test-results/m286/ablation-reload-deps.log` + 同目录的 `ablation-reload-deps.evidence.json`，git 外）。
2. **真机层（系统 WKWebView）**：场景 **65**（`scripts/acceptance/scenarios/65-external-reload-reading-position.md`）
   ——⌃V 到文档尾部 → ⌘J 开表格全屏 → 外部在**末尾追加**一段 → 断言「第 15 章两行在渲染行里 /
   第 1 章两行不在」+ 遮罩已退出 + 内容已重载；邻近护栏场景 07c（外部重载本身）同批重跑。
   AX 不暴露 `scrollTop`，因此「回到原处」是一对渲染行断言（与场景 28 同源）。
3. **载荷侧的确定性实证**：把装载复位那段窗口也消融掉时，同一场景会如实写出
   `{"pos":0,"y":115.109375}`（finding 引用的真实 vault 是 `pos 0 / y 114`）——
   读侧的恢复与写侧的让位是**两半独立防线**，读数与日志见 docs/backlog.md 的 M286 第 8 项。

**已知边界（如实登记）**：图片遮罩（`src/lightbox.ts`）**未**纳入第 2 条——`ImageLightbox` 的对外
接口只有 `open`（没有关闭口子），且它的状态机是 M184 留下的第二份实现。它与另外两处是同一族
（放大图复用内联 `<img>` 的 src），收口顺序与理由见 docs/backlog.md 的 M280 节第 7 项。

## 判别层（哪一层看得见这个缺陷）

| 层 | 看得见吗 | 实测依据 |
|---|---|---|
| chromium（Playwright） | **看不见**——聚焦揭示被 `preventScroll` 挡住 | M274 §2.2 的消融 G（chromium 全绿、WebKit 跳） |
| Playwright WebKit，**默认 UA**（带 `Version/26.x`） | **看不见**——CM6 据此关掉 `preventScroll`，改走它自己的同步回写栈，揭示被抹平 | M279 §0.2、`playwright.config.ts` 的 `REAL_WEBKIT_UA` 注释 |
| Playwright WebKit，**真机同款 UA**（无 `Version/`） | **看得见**——走原生 `preventScroll` 分支、没有任何回写兜底；实测 `focus({preventScroll:true})` 把 `scrollTop` 从 1540 拽到 0 | M279 §2 的 T4/T4b、M280 的 `test-results/m280/before-fix-red.log` |
| 系统 WKWebView（真机） | 机制上应当同第三行；M274 的离屏探针曾测得「`preventScroll` 被尊重」（与第三行相反，**两处结论互斥、未定性**） | M280 的真机批次只跑出场景 40/62 的 PASS（回归护栏，不判别）；真机判据**目前表达不了**——器材限制见 docs/backlog.md 的「验收套件表达不了 CL-1 的判据」条与 finding `20260927-worker-impl-esc-jump-improve-playwright-webkit-ua-wkwebview-preventscroll-webkit-playwrig.md` |

⇒ **条款通过的证据只能来自第三行与第四行**。前两行绿灯一律不作为条款通过的证据。

## 实现落点（唯一一份）

- 原语：`src/scroll-position-view.ts` 的 `focusPreservingReadingPosition(view)`
  —— 取位置（聚焦前）→ `view.focus()` → **无条件**按捕获值发放 `scrollIntoView`
  （运行期口径，**不再**就地复核落点）→ 叠一层 `requestAnimationFrame` 保底写回。
- 全部调用点（MUST NOT 再出现裸 `view.focus()` 交还焦点）：
  `src/main.ts` 的图片遮罩 / 表格全屏 / 代码块全屏 / 键位面板四处装配、`src/toc.ts` 的浮层收起、
  `src/search.ts` 的 `closeSearch`、`src/preview/livePreview.ts` 的 `editor.widget-escape`。
- 豁免（书面理由）：
  - `src/vault-switcher.ts` 的 `handOffFocus()`——它不是裸 focus：走 CM 自己的
    `scrollSnapshot` / 快照 effect 通道，M186 起就有保护且真机场景 25 PASS。两套通道并存是
    已知的「同一语义两处实现」（REVIEW.md 第 8 条），收敛进原语列为 backlog 待办。
  - `src/main.ts` 的 `focusEditor`（同上，vault 切换器的 dep）。
  - `src/preview/livePreview.ts` 的 Tab 进容器那条（`view.focus()` 之后立刻把焦点交给容器，
    是选区同步手法而非交还焦点）、`src/preview/math.ts` 的点击进源码（指针落点即 caret，
    揭示是期望行为）。

## 两个口径（MUST NOT 互换）

| | 装载（`applyLoadedScrollPosition`） | 运行期（`applyScrollPosition`） |
|---|---|---|
| 调用点 | `src/main.ts` 的 `readingPositions.applyPosition`（装载复位之后） | **只有** `focusPreservingReadingPosition`（交还焦点的全部调用点，`src/scroll-position-view.ts`）。**切标签 / 切模式不经这里**——`src/editor.ts` 的 `activate()` 走 CM 自己的 `scrollSnapshot` 通道（同文件 `:1812`），两个口径互不覆盖 |
| 读数基准 | `scrollTop = 0`（装载复位） | 当前 `scrollTop` |
| 同一算式的含义 | **绝对落点** | **差值**（还差多少才到位） |
| 早退 | 锚 = 0，或落点 ≤ 0（保 M110 的页首 44px 内边距） | 只有锚 = 0（**不许**按落点复核，见下） |

运行期**不许**就地在聚焦后复核落点：交还焦点那一拍布局还没反映引擎的滚动，复核拿到的还是旧
读数，差值恒为 0 ⇒ 写回被自己的守卫吃掉（M279 的 T4b 实测，M280 的根因）。**判据是「差值」，
不是「落点」**——这是原实现把这句守卫的适用面搞错的那一处。

## 已知边界（如实登记）

- **捕获锚落在文档原点时运行期不写回**：锚 = 0（视口停在文档最上沿）且 caret 在下方时，
  引擎若把视口拉下去，本条不修（沿用 M110 的「不做比做更稳」）。触发条件窄，列 backlog 待办。
- **`blur` 兜底那条关闭路径不在本条射程**：它不抢焦点（语义 MUST NOT 改），焦点去向由触发它的
  一方决定；M274 的 E 用例证明那条路径在 WebKit 下也会跳，但它的修法属于「别处把焦点交还给
  编辑器」这一族，需单独立项。
- **Playwright WebKit ≠ 系统 WKWebView**：见判别层第 4 行的互斥读数。真机层的判据目前表达不了
  （见「判据」第 3 条），因此第三行的绿灯 MUST NOT 被当作真机结论引用。

## 证据与反例

| 文件（git 外） | 内容 |
|---|---|
| `test-results/m280/before-fix-red.log` | master 状态：表格用例红（`1540 → 0`），时间线 `[[1729,0]]` |
| `test-results/m280/after-fix-green.log` | 修后：3/3 绿 |
| `test-results/m280/ablation-table-bare-focus.log` | 只把表格的 `restoreFocus` 改回裸 focus ⇒ **只有表格用例**变红 |
| `test-results/m280/ablation-codeblock-bare-focus.log` | 只把代码块的 `restoreFocus` 改回裸 focus ⇒ **只有代码块用例**变红 |
| `test-results/m280/scene-readings/*.json` | 每次跑的逐拍读数（scrollTop / caret 位置 / DOM 选区 / 聚焦调用参数） |
| `test-results/m279/REPORT.md` | 机制调查与 UA 分支对照 |
| `test-results/m278/REPORT.md` | 主矩阵与消融（M274） |
| `test-results/m286/ablation-gate-unit.log` | CL-2 的单测消融红（删掉窗口早退 ⇒ 载荷落成中间态 `0 !== 1200`） |
| `test-results/m286/ablation-reload-deps.log` | CL-3 的消融红（去掉两处 dep ⇒ `1541 → 0` 且遮罩仍开，后台那条照旧绿） |
| `test-results/m286/ablation-reload-deps-and-load-window.log` | 装载窗口消融后如实写出 `{"pos":0,"y":115.109375}`（与真实 vault 的 `pos 0 / y 114` 同形态） |
| `test-results/m286/scene-readings/*.json` | CL-3 场景的逐轮读数（`before` / `after` / 载荷） |
