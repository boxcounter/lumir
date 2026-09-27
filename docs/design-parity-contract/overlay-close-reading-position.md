# 浮层关闭交还焦点：阅读位置不变量（M280）

> 状态：**生效**（2026-09-27，M280）。本文件与同目录的 `README.md`（M62 原型—生产一致性契约，
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
   逐值相同（容差 ≤ 1px，仅吸收读数舍入）。消费者：
   `tests/visual/scenes/m280-overlay-esc-scroll.spec.ts`（`webkit-realua` project）。
2. **chromeium 分支**：同一份场景照跑，作结构性回归护栏（chromium 对这个机制结构性看不见，
   它的绿灯**不构成**条款通过的证据）。
3. **真机层**：**暂无可用判据**。M280 试做过表格 / 代码块两条真机场景，因器材三约束做不出可证伪的
   判据（无 `scrollTop` 读数、AX 文本窗口宽达 ~2500–3600px、命令入口的块定位范围把「caret 在视口
   上方」的可用带子压到 ~2048 字符以内），场景未留在套件里；逐条实测与补齐路径见 docs/backlog.md
   的「验收套件表达不了 CL-1 的判据」条。在此之前真机结论只能由人肉复现给出。

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
| 调用点 | `src/main.ts` 的 `readingPositions.applyPosition`（装载复位之后） | 交还焦点、切标签、切模式 |
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
