# Design: END 标记统一到所有已完成布局的 md 文档

- Change ID: `show-document-end-marker-all-docs-nov27`
- 日期: 2026-11-27
- 读者：实现 mission、reviewer、Alex（只看有用户可见后果的取舍）

本文件记录判据与布局机制、实测几何、候选方案的取舍与验证面。为什么 / 做什么 / 不做什么见
[proposal.md](proposal.md)；任务见 [tasks.md](tasks.md)。

## 1. 合同（不可变量）

来源：Alex 2026-11-27 采纳的统一口径（mission 合同原文），落进 delta 的两条 MODIFIED requirement。

1. **在场判据**：任意时刻，md 文档的 END 在场 ⇔ 当前视图是 md 且可用视口高度 > 0。与文档内容高度、
   滚动位置、光标位置、文档长度无关。
2. **纵向位置**：END 的顶边 = 正文自然末尾（最后一行 + `.cm-content` 下内边距之后），视觉间距继续由
   「正文下内边距 20px + 标记上内边距 20px」构成。短文档 MUST NOT 被推到视口底部；视口高度变化
   MUST NOT 改变它的纵坐标。
3. **指针行为**：正文盒 SHALL 保持铺满可用视口（正文行 `minmax(max-content, 1fr)` + CM 基础主题的
   `min-height: 100%`），正文自然末尾之下的空白仍属于 `.cm-content`。单击 SHALL 聚焦编辑器并把光标
   放到文档末尾；双击、拖选 SHALL 继续走 CodeMirror 自己的手势路径。标记元素 MUST NOT 吞掉指针事件
   （`pointer-events: none`），点在其自身上也 SHALL 穿透到正文盒。MUST NOT 用只处理单击的自定义
   转发层替代 CM 手势。
4. **非文档性 / 稳定性**：沿用 `document-end-marker` 的全部既有约束——不进 doc / 保存 / 复制 / 搜索，
   不进 heightmap，不参与按视口构建的装饰层；滚动高度在所有滚动位置恒定；高度固定、间距用 padding。
5. **模式边界**：code 模式 MUST NOT 出现；模式切换后元素不得成为孤儿（M251 的生命周期不变量不变）。
   结构性空态（分栏空 pane / 首启 tips）不是文档：装配层按 `structuralReadOnly` 不装标记，打开带路径
   文档后随 modeCompartment 重配恢复（与空态无行号 / 无插入光标同一口径）。
6. **不新增解析 / 布局义务**：打开与键入路径不新增文档遍历；落点只用 O(1) 既有布局读数
   （`contentHeight` + 正文盒矩形）。文档变更 / 几何变更后重算落点，但不在测量周期内写布局。

## 2. 现状几何与缺陷机制（实测）

测量环境：chromium 1200×800、`.cm-scroller` clientHeight 733px、合成短文 fixture
`tests/visual/fixtures/end-marker/short.md`（三小段）。

| 场景 | `.cm-content` 盒 | 末行底边 | END 盒 | 视口底边 | 读数 |
|---|---|---|---|---|---|
| master（判据隐藏 END） | top 152.1 / bottom 775.0（高 622.9，`min-height: 100%` 撑满） | 375.3 | —（不在场） | 775.0 | 内容盒铺满视口（指针命中面） |
| 只改判据、不改布局（反例） | top 152.1 / bottom 694.2（高 542.1） | 375.3 | top 694.2 / bottom 775.0（**贴住视口底**） | 775.0 | END 被 1fr 行推到窗口底（合同禁止） |
| 正文自然流（回归实现，已弃用） | top 152.1 / bottom 395.3（高 243.2，`min-height: 0`） | 375.3 | top 395.3 / bottom 476.1 | 775.0 | END 位置正确，但正文下方空白不再属于 `.cm-content`：点空白 `activeElement=.cm-scroller`、选区不动 |
| **采用**：正文盒铺满 + END 绝对定位 | top 152.1 / bottom 775.0（高 622.9，`min-height: 100%`） | 375.3 | top 395.3 / bottom 476.1（left 338 / width 760 = 正文盒水平区间） | 775.0 | END 在自然末尾、离视口底 299px；正文盒仍是 CM 命中面 |

- `.cm-content` 的下内边距 20px（`--sp-9`）保留：末行底边 375.3 → 正文自然末尾 395.3。
- END 盒高 80.8px（padding 20 + 内容行 16.8 + padding 44），顶边与正文自然末尾逐像素相等；
  文字基线因此距末行 40px，与长文档现状完全一致（「保留现有合理间距」）。
- 长文 fixture：正文自然高 2068.2px，END 顶边 2220.3；滚到顶 / 中 / 底 / 回顶，`scrollHeight`
  恒为 2259px，插件写入的内容坐标 `top` 也恒定（标记在场与滚动位置无关）。
- **指针实测（采用方案）**：先置选区 0 后点正文下方空白 → `activeElement=.cm-content`、
  `head=doc.length`；点 END 自身 → 同上；双击无尾随换行 fixture 的空白 → 选中末词（6–9）；
  从空白拖回正文 → 非空选区（锚点 = 文档末尾、head 在正文内）；文档字节不变。

## 3. 机制候选与取舍

### A. 正文盒铺满视口 + END 绝对定位在自然末尾（采用）

- `src/preview/theme.ts` 的 md `.cm-scroller` 保持 `gridTemplateRows: "minmax(max-content, 1fr)"`；
  有 document-top title 时 `max-content minmax(max-content, 1fr)`。`.cm-content` 沿用 CM 基础主题的
  `min-height: 100%`（MUST NOT 在 md 内解除）。
- END 是 `.cm-scroller` 上的绝对定位元素：`position: absolute`、`pointer-events: none`；
  `top` / `left` / `width` 由 `src/preview/endMarker.ts` 在测量周期之外写入：
  `top = 正文盒矩形相对 scroller 的纵向偏移 + scrollTop + contentHeight`，
  `left = 正文盒矩形相对 scroller 的横向偏移 + scrollLeft`，`width = 正文盒宽`。
  `scrollTop/Left` 只用于把视口矩形换算成**内容坐标**，结果与滚动位置无关；不参与在场判据。
- 重算触发点：`.cm-scroller` 的 ResizeObserver（视口 / 宽度变化）+ `ViewUpdate` 的
  `docChanged || geometryChanged`（装载 / 键入 / 异步图片 / 字体度量 / 缩放）。
- 优点：
  1. 指针命中面就是 `.cm-content` 本身，单击 / 双击 / 拖选全部走 CM 原生手势，无需任何事件转发；
  2. END 绝对定位不参与正文布局、不进 heightmap、不改滚动锚点；短文档不产生多余滚动；
  3. 落点由 CM 的高度图（`contentHeight`）与正文盒矩形给出，不遍历文档，不把滚动位置当输入。
- 代价：一个 O(1) 的布局读数与一帧延迟（见 §4）；没有其它用户可见行为变化。

### B. 正文自然高度 + END 作为下一行（回归实现，不采用）

- 正文行 `max-content`、md 内 `.cm-content { min-height: 0 }`，END 排下一行。
- 不采用：正文盒不再铺满视口，正文下方空白落在 `.cm-scroller` 上，单击不再聚焦 / 落光标，
  双击与拖选也随之失效。这是既有 CodeMirror 指针行为的回归，不是可接受的代价。

### C. 正文盒跨两行、END 放第一行 `align-self: end`（不采用）

- 让正文跨 `max-content` + `1fr` 两行、END 放第一行末尾。
- 不采用：跨行元素的 max-content 贡献会落到 1fr 轨道，第一行只按 END 自身高度排版——实测 END 顶边
  停在 152（行顶）而不是 395（正文末尾）。

### D. `.cm-content::after` 伪元素撑命中面（不采用）

- 正文自然流 + 绝对伪元素从正文底边一直盖到视口底，点击目标仍是 `.cm-content`。
- 不采用：绝对伪元素的盒子进入 scroller 的 scrollable overflow——短文 `scrollHeight` 从 733
  变成 1153（平白多出 420px 滚动），长文从 2259 变成 2978。与「滚动高度恒定 / 短文无多余滚动」冲突。

### E. 只加单击处理器（不采用）

- 在 scroller 的空白区 mousedown 时把光标放到文档末尾。
- 不采用：只恢复单击；双击选词、拖选起点、Shift 扩展等 CM 手势仍丢失。合同明确要求这些手势
  走原生路径，不能用一个单击补丁暗中分叉。

## 4. 实现与测量不变量

- `endMarkerVisible(viewportHeight)`：`viewportHeight > 0`。`0` 与负值一律不在场（未布局 / 异常读数）。
- `read` 返回 `{ visible, top, left, width }`：`visible` 只读 `scrollDOM.clientHeight`；落点读
  `contentHeight` + 正文盒 / scroller 矩形 + `scrollTop/Left`（仅坐标换算）。这些读数都是 O(1)，
  不遍历文档、不含标记自身贡献。
- 触发：ResizeObserver 观察 `.cm-scroller`；`update` 在 `docChanged || geometryChanged` 时排队测量。
- 落地仍走**单帧**延迟（M238 实测：双帧会把阅读位置恢复推离 13px）；DOM / 样式改动不得在 CM
  测量周期内发生。
- 绝对定位的 chrome 盒子不改变正文档高 / heightmap / 滚动锚点；`top` 写入后不补排测量。但它是
  scroller 的绝对定位后代，**仍会计入 scrollable overflow**（END 自身高度）：长文四滚动位置
  `scrollHeight` 恒定，短文「内容 + END 装得下」时 `scrollHeight == clientHeight`；这条不是
  「绝对定位天然不影响滚动高度」。
- 生命周期（M251）：`destroyed` 闸门、构造时清理残留、`destroy` 摘元素与 observer 原样保留。
- 索引类读数（`contentHeight`、矩形）在切换文档后可能落后一帧：测试在切换后等 `settleFrames`
  再读几何；产品侧只影响一帧内的视觉落点，不改变布局或手势。

## 5. 与非目标 / 既有能力的边界

| 既有能力 | 本 change 的关系 |
|---|---|
| 视口增量装饰层 | END 仍在装饰层之外；不改 livePreview 的构建范围 |
| 正文下方空白的指针手势 | 正文盒铺满视口 + END `pointer-events:none`；单击 / 双击 / 拖选全部走 CM 原生路径 |
| `toc-outline` 的滚动位置语义 | 在场判据不读滚动位置；定位读 `scrollTop/Left` 只做内容坐标换算，不保存、不追踪当前位置 |
| 行高 / 块边界纵向几何 | 普通正文行 padding 仍恒 0；END 位置只随内容高度变化。`empty-line-height-stability-nov27.spec.ts` 的 END 稳定性判据必须原样绿 |
| code 模式 / 非 md 文件 | theme 只装 md 分支；矩阵属性测试的「code 模式恒 0」不变 |
| 复制 / 搜索 / 保存 | 元素在 `.cm-content` 之外，机制不变；断言原样保留 |
| 视觉基线 | 短文与「一屏装得下」的 md 场景会新增 END，属预期变化；候选截图留档，基线更新另行裁决 |

## 6. 验证面（断言先行，反向必红）

1. **纯函数真值表**：视口 0 / 负值 → false；1 / 733 / 4000 → true。旧实现（两参且比较内容高度）
   让新用例判红（`endMarkerVisible(733)` 在旧签名下返回 false）。
2. **短文几何**：END 在场；`marker.top == 自然末尾（末行 + 下内边距）±1`；末行到标记盒的间距 ==
   正文下内边距，标记文字顶边再下移标记上内边距；`viewport.bottom - marker.bottom > 100`；
   `scrollHeight == clientHeight`。空文档与「带 frontmatter 的短文」各一条。
3. **指针行为**：单击正文下方空白 → `.cm-content` 持焦、`head == doc.length`、文档不变；点 END 自身
   → 同上；双击无尾随换行 fixture 的空白 → 选中末词（`from < to == doc.length`）；从空白拖回正文 →
   非空选区（`from < to`、锚点在文档末尾、head 在正文内）。四条都在同一用例里，反向必红现场为
   「正文自然流」回归实现（第一条即 `activeElement=.cm-scroller` 判红）。
4. **视口 0**：隐藏 scroller → clientHeight 0 → END 离场；恢复 → 回场（负向断言配正观测）。
5. **resize**：短文在矮 / 原 / 高三档视口下 `marker.top` 不变（±1）。
6. **长文滚动恒定**：顶 / 中 / 底 / 回顶的 `scrollHeight`、`clientHeight` 逐项相同；END 四态都在场；
   插件写入的内容坐标 `top` 四态相同；滚到底时 END 进入视口。
7. **code 模式与切换历史**：M251 矩阵期望「md ⇒ 1、code ⇒ 0」，短文不再豁免。
8. **结构性空态**：分栏空 pane（S4）与首启 tips（S3）不出现 END；打开带路径文档后 END 出现。
9. **行高迁移**：`empty-line-height-stability-nov27.spec.ts` 原 END 位置稳定判据不改、必须绿。
10. **真机场景 27**：短文侧从「节点缺席」改为「节点在场」；增加短文翻页后仍在场的断言；
    覆盖边界更新（END 无 bbox，可见性仍由 chromium 几何 + 截图承担）。

**反向必红**：§6.1 / §6.3 的新断言先在旧实现上跑（`endMarkerVisible(733)` false、短文空白点击
`activeElement=.cm-scroller`），证据落 `.local/reviews/end-marker-all-docs-nov27/evidence/`；
恢复实现后复跑转绿。几何读数一律取渲染盒，不读 CSS 声明。

## 7. 已知边界

- END 的纵坐标依赖 `.cm-content` 的实际内容高度；字体加载完成前后若有度量差，END 会随内容重排
  自然移动（与正文自身移动同源，不是独立跳动）。
- 短文若「内容 + END」高于视口（例如窗口被压得很矮），会出现最小必要的滚动余量——这是「END 必须
  在正文末尾」的固有结果，不是贴底；测试只对「内容 + END 仍装得下」的短文断言零滚动余量。
- 观感（间距、线段长度）仍归 Alex；门禁只判几何与语义。
