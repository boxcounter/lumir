# Proposal: 滚动条分档从「阅读面两档」扩到「全部滚动容器三档 + 可执行注册表」

- Change ID: `scrollbar-tiers-oct24`
- 日期: 2026-10-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：待填（tower 已按 Alex 2026-10-24 反馈 #1 的沉淀半立项；本 change 的规范口径
> 与实现同批落地，裁决点 D2 见下）。
> 节点 2（归档评审）：待实现完成后填写。

## Why

Alex 2026-10-24 原话（逐字）：

> 「横向滚动条粗这个问题我们之前似乎处理过……我们是否应该沉淀下来，成为设计规范里的一条/点？」

**规则已存在，缺口在作用域与执行面。** living spec 的「阅读面横向滚动条」
（`openspec/specs/ui-design-system/spec.md:190-216`）已定义两档（细条 4px / 隐藏）并要求新增容器先归挡，
但作用域只写「阅读面」，机器判据只钉了 3 个已知消费者（`tests/visual/scenes/m628-harness-bubble-and-scrollbar.spec.ts`
按 CSSOM 断言 harness 的代码块 / diff / argv 逐值一致）。仓内盘点出的 19 个滚动面里 **16 个未归任何档**
（`.local/reports/scrollbar-audit-oct24.md` §2）；新代码绕开 m628 那三个选择器就不再受任何约束。

同一份盘点给出了第二个、与「粗」不同的判据：**真正的缺陷是滚动条压在可点件上，而不是条本身的粗细**
（§0 结论 5）。overlay 条不占布局、直接画在内容上；vault 切换浮层每行右侧 20px 的 ✕ 与滚动条占同一条带，
滚动期间被整条盖住。把它写成一条不变量（右缘 12px 内不放常驻可交互件，除非归隐藏档）比笼统说「条要细」
可判定，也不会把右缘是空轨道 / 留白的面误伤。

因此本 change 只做三件事：把条款作用域扩到全部滚动容器、补齐第三档（原生 overlay 豁免的白名单）、
把「归挡」从文字承诺变成机器判据（静态注册表扫描）。P1 那三处浮层的隐藏档改法已由 M660 落地，
本 change 不重复实现，只把它们登记进注册表。

### D2 的实测前提：`.cm-scroller` 无法只改横向

盘点建议把「编辑器横向滚动条」并入细条档（P2 第 5 个面），并注明「只把横向纳入、纵向留在 P3」需要一次实测。
本轮实测（Playwright WebKit 26.5 / chromium 151，每次测量新开页，结论逐条可复现）：

| 声明 | WebKit 纵向 / 横向占位（px） | 视觉 |
|---|---|---|
| 不写任何滚动条声明（现状） | 0 / 0 | 平台 overlay 条 |
| `::-webkit-scrollbar { height: 4px }` | **17 / 4** | 横向 4px；纵向变成 17px 占位经典条 |
| `::-webkit-scrollbar { width: 4px; height: 4px }` | 4 / 4 | 两轴都变 4px 占位经典条 |
| `::-webkit-scrollbar:horizontal { height: 4px }` | 0 / 0 | 与不写任何声明**逐字节相同**（规则被忽略） |
| `scrollbar-width: thin`（标准通道） | 0 / 0 | 与不写任何声明逐字节相同（WKWebView 无视觉效果） |

机制：WebKit 一旦为某容器自绘 `::-webkit-scrollbar`，就把它的**两条轴一起**从 overlay 切成占位经典条；
逐轴的 `:horizontal` 伪类在 WKWebView 上是死规则；`scrollbar-width` 不改变 WKWebView 的 overlay 条。
所以「同一容器一轴细条、一轴 overlay」在实现上不可达，档位只能按**容器**分配。

## What Changes

1. **规范条款重写**（`ui-design-system`）：整条移除「阅读面横向滚动条」，由新名「滚动条分档与滚动容器
   注册表」承接（改名通道 = REMOVED + ADDED，理由见 delta 文件头）。新条款：
   - 作用域 = 全部滚动容器（任一轴 `overflow: auto|scroll`），含 chrome / 浮层 / 编辑器与预览横滚面；
   - 三档：**细条**（4px 共用一份声明组）/ **隐藏**（白名单）/ **原生 overlay 豁免**（白名单，逐条枚举）；
   - 档位按容器分配、不按轴分配（并写明上表的 WebKit 约束作为判据依据）；
   - 新增不变量：滚动容器右缘 12px 内 MUST NOT 放常驻可交互件，除非该容器归隐藏档；
   - 新增验收判据：浮层 / 列表类滚动容器的验收场景必须先断言确实溢出，再断言滚动条形态；
   - 新增禁则：横向细条容器 MUST NOT 声明 `scrollbar-gutter`（纵向已 `hidden`，无抖宽场景）。
2. **细条档落到预览横向滚动面**（P2 的 4 个可落地面）：`.cm-lp-block-scroll`（代码块横滚）、
   `.cm-lp-table-scroll`（宽表横滚）、`.cm-lp-math-block`（公式）、`.cm-lp-mermaid`（图）并入细条组。
   同时把该组从 `src/harness-panel.css` **迁到 `src/style.css`**——细条配方
   从此只有一份共用声明组（harness 的三处消费者选择器一并搬过去，声明值逐字不变）。
3. **删除 `.cm-lp-table-scroll` 的 `scrollbar-gutter: stable`**：该容器纵向已 `overflow-y: hidden`，
   这个声明防的是「纵向条出现导致抖宽」这件不会发生的事，只在 classic 滚动条环境换来常驻 15px 沟槽
   （M177 实测 `offsetWidth − clientWidth = 15`）。backlog 里 M177 条的「可选动作」随之核销。
4. **机器判据**：新增 `tests/unit/scrollbar-registry.test.ts`——静态扫 `src/style.css` /
   `src/harness-panel.css` / `src/preview/theme.ts` 里所有声明 `overflow(-x|-y): auto|scroll` 的选择器，
   与注册表**双向**比对：未登记即红（拦新增容器），登记了但源码里已不存在也红（拦改名 / 删除后的僵尸条目）。
   同一测试还按档位核验声明：细条 / 隐藏档消费者必须实际持有对应声明且全组共用一份规则，豁免档消费者
   MUST NOT 持有任何 `scrollbar-width` / `::-webkit-scrollbar` 声明。
5. **验收判据**：新增 `tests/visual/scenes/m663-scrollbar-tiers.spec.ts`——三个可溢出的预览横滚面
   （代码块 / 宽表 / 公式）各自先断言「确实横向溢出」（区分度输入），再断言计算档
   `scrollbar-width === "thin"` 与 CSSOM 的 `::-webkit-scrollbar` 4px 声明；`.cm-lp-mermaid` 只断言
   声明层（mermaid 自己的 `useMaxWidth` 把 svg 钳在容器宽内，横向溢出在当前渲染链上不可达，实测
   `scrollWidth === clientWidth`，场景把这个事实也钉住）；`.cm-scroller` 断言「无滚动条声明」
   （豁免档的机器面）；宽表容器的 `scrollbar-gutter` 计算值为 `auto`（删除生效）。
6. **人肉防线**：`REVIEW.md` 加一条开工前 checklist（新增 / 修改 overflow 容器：先定档；右缘 12px 内
   别放常驻钮）。

## 裁决点

### D2 `.cm-scroller`（编辑器主滚动）归哪一档

> **已裁 A**（tower 2026-10-24 裁决，与 survey §4-P3 同向；Alex 可推翻）。落地口径：`.cm-scroller`
> 两轴都归第三档，**不写任何滚动条声明**（写 `scrollbar-width: thin` 会动纵向 overlay 条的粗细，
> 写 `::-webkit-scrollbar` 会双轴转占位经典条——两者都违背本档「静止态不占宽」的前提）。

- **A（采纳）**：两轴都归第三档「原生 overlay 豁免」。P2 的落地面收缩为四个 `.cm-lp-*` 容器。
  代价：code 模式长行的横向条仍是平台 overlay 粗条（滚动瞬间可见）。收益：编辑器正文宽高不变、
  真机像素零变化（chromium 门禁侧本来就零变化）、与 P3 既有口径（正文两侧 `1fr` 空轨道，条不压正文）一致。
- **B**：两轴都归细条档（4px 占位）。兑现「任何阅读面都不出现粗条」，代价是编辑器右缘与下缘常驻两条
  4px 线、正文宽高各少 4px，真机全部编辑器画面变化，而这条变化**过不了任何机器门禁**（chromium 的
  overlay 条不占位，读数恒为 0）——只能靠 Alex 肉眼看，按基线纪律要先出真机对比截图。
- 倾向理由：B 的收益只在「滚动那一瞬间」，代价是常驻占宽与一次不可机器验证的真机像素变迁；A 的代价
  只落在「细」这件事上，不影响可点件（没有 12px 不变量问题）。若 Alex 要 B，注册表改一行、CSS 加三条声明、
  delta 改一段。

### 第三档白名单的准入判据是否照本提案落地

白名单 = `.cm-scroller`（两轴）、`.tree-pane`、`.lumir-bindings-body`、`.lumir-table-fs-panel`、
`.lumir-codeblock-fs-panel`、`.lumir-toc-list` / `.lumir-qo-list`、`.lumir-hp-transcript`、
`.lumir-hp-composer`、`.pane`（备而不用：编辑器撑满时不滚动）。准入判据写在条款正文：
**静止态不占宽 + 右缘 ≥8px 是留白或空轨道 + 改档会让像素基线全量失效而收益只是「滚动瞬间看着细」**。
白名单外新增容器走「先定档、再写 overflow」，不接受「先留系统默认等 review 发现」。

## Non-goals

- 不改 M660 已落地的 P1 三处浮层隐藏档实现（本 change 只把它们登记进注册表）。
- 不改任何颜色 / 字号 / 间距 token，不新增 token 档位；细条配方的取值（4px、`--border`、透明轨道）逐字沿用。
- 不改 harness 三处消费者的细条声明值（只搬居所）；不改它们的行为。
- 不动编辑器纵向滚动条的**渲染方式**（A 案下完全不写声明）。
- 不为 Firefox 等非 webkit 引擎补标准通道的逐轴能力（应用只发 macOS WKWebView；标准通道无逐轴 API）。
- 不改 `.cm-lp-*` 的 `overflow` 语义（纵向仍 `hidden`，横向仍 `auto`），只加滚动条外观。
- 不把右缘 12px 不变量做成机器判据（DOM 几何要逐浮层造溢出 fixture，收益与成本不成比例；它是
  REVIEW.md 的开工前 checklist + 条款正文，归人读层）。

## Impact

- **影响的 specs**：`ui-design-system`（REMOVED「阅读面横向滚动条」/ ADDED「滚动条分档与滚动容器注册表」）。
- **代码**：`src/style.css`（细条组迁入 + 扩面、删除 `scrollbar-gutter`）、`src/harness-panel.css`
  （细条组迁出后留一行指针注释；`::-webkit-scrollbar` 相关规则整体搬走）。
- **测试**：新增 `tests/unit/scrollbar-registry.test.ts`、新增 `tests/visual/scenes/m663-scrollbar-tiers.spec.ts`；
  既有 m628 场景不改（它按 CSSOM 精确选择器核验，构建产物会把 `::-webkit-scrollbar` 的组拆成单选择器规则，
  已实测照常命中）。
- **视觉基线**：chromium 侧零像素差（overlay 条不占位，`offsetWidth − clientWidth` 与
  `offsetHeight − clientHeight` 在四个新消费者上实测仍为 0）。真机 WKWebView 侧，横向溢出的预览块
  会从「overlay 条」变成「4px 占位条」，块高 +4px——这是 M406 / M628 已为 harness 代码块接受过的同一形态，
  但**门禁看不见**，按基线纪律另附真机前后对比截图供 Alex 过目（不自行 `--update`）。
- **关联约束**：ADR 0003 §3（不改写源文件）；M110 的块级高度经 `getBoundingClientRect` 测量，
  +4px 占位条是真实几何、heightmap 可见，表格 / 代码块场景需回归；M177（`scrollbar-gutter` 与
  `scrollWidth` 恒等式）随本 change 核销其「可选动作」。
