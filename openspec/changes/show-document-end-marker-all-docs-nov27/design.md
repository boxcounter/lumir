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
2. **纵向位置**：END 的顶边 = 正文内容盒的自然底边（最后一行 + `.cm-content` 下内边距之后），
   视觉间距继续由「正文下内边距 20px + 标记上内边距 20px」构成。短文档 MUST NOT 被推到视口底部；
   视口高度变化 MUST NOT 改变它的纵坐标。
3. **非文档性 / 稳定性**：沿用 `document-end-marker` 的全部既有约束——不进 doc / 保存 / 复制 / 搜索，
   不进 heightmap，不参与按视口构建的装饰层；滚动高度在所有滚动位置恒定；高度固定、间距用 padding。
4. **模式边界**：code 模式 MUST NOT 出现；模式切换后元素不得成为孤儿（M251 的生命周期不变量不变）。
   结构性空态（分栏空 pane / 首启 tips）不是文档：装配层按 `structuralReadOnly` 不装标记，打开带路径
   文档后随 modeCompartment 重配恢复（与空态无行号 / 无插入光标同一口径）。
5. **不新增测量**：打开路径与键入路径不新增解析 / 测量。本 change 反而删掉了「文档变更时重算判据」
   这条调用（判据不再依赖内容）。

## 2. 现状几何与缺陷机制（实测）

测量环境：chromium 1200×800、`.cm-scroller` clientHeight 733px、合成短文 fixture
`tests/visual/fixtures/end-marker/short.md`（三小段）。

| 场景 | `.cm-content` 盒 | 末行底边 | END 盒 | 视口底边 | 读数 |
|---|---|---|---|---|---|
| 现状（判据隐藏 END） | top 152.1 / bottom 775.0（高 622.9，`min-height: 100%` 撑满） | 375.3 | —（不在场） | 775.0 | 内容盒被拉到视口高 |
| 只改判据、不改布局（反例实测） | top 152.1 / bottom 694.2（高 542.1，`min-height: 100%`） | 375.3 | top 694.2 / bottom 775.0（**正好贴住视口底**） | 775.0 | END 被推到窗口底（合同禁止） |
| 候选布局（正文行 `max-content` + md 内 `min-height: 0`） | top 152.1 / bottom 395.3（高 243.2） | 375.3 | top 395.3 / bottom 476.1 | 775.0 | END 在末行下 20px 起、整体离视口底 299px |

- `.cm-content` 的下内边距 20px（`--sp-9`）保留：末行底边 375.3 → 内容盒底边 395.3。
- END 的盒高 80.8px（padding 20 + 内容行 16.8 + padding 44），顶边与内容盒底边逐像素相等；
  文字基线因此距末行 40px，与长文档现状完全一致（「保留现有合理间距」）。
- 长文 fixture：内容自然高 2068.2px，END 顶边 2220.3（= 内容盒底边）；滚到顶 / 中 / 底 / 回顶，
  `scrollHeight` 恒为 2259px（标记在场与滚动位置无关）。
- 只改 CSS 行模板、不动 `.cm-content` 的 `min-height` 时，百分比 min-height 仍可能把内容盒撑到
  行高之外；因此 `.cm-content` 的 `min-height: 0` 与行模板必须成对落地（见 §3 候选 A）。

## 3. 机制候选与取舍

### A. 正文行自然高度 + END 作为下一行（采用）

- `src/preview/theme.ts` 的 md `.cm-scroller`：`gridTemplateRows: "max-content"`；有 document-top
  title 时 `gridTemplateRows: "max-content max-content"`；`gridAutoRows: "max-content"` 不变。
- md 内覆盖 `.cm-content { min-height: 0 }`（CM 基础主题的 `min-height: 100%` 只在 md 解除；
  code 模式与 composer 的 `.cm-content` 不受影响——本 theme 只装进 md 分支）。
- END 仍在 `gridColumn: 2`，无 document-top 时 row 2、有 title 时 row 3（隐式行，`max-content`）。
- 优点：纵向位置完全由 CSS 自然流给出，零 JS 几何、零陈旧读数；异步图片、缩放、窗口 resize、
  字体度量变化都会自然把 END 带到新的内容末尾。滚动高度仍只由内容 + 标记常量高度决定。
- 代价：正文盒不再铺满视口，正文下方空白不再属于 `.cm-content`。点击该空白时 `activeElement`
  变为 `.cm-scroller`、选区保持原值（探针：先置 `head=0`，点标记下方空白后仍为 0），因此不再把
  光标放到末尾 / 聚焦编辑器。这就是 proposal「已知代价」一条；本 change 不补点击兜底。

### B. 保留 1fr 铺满，用 JS 把 END 上移到自然末尾（不采用）

- 判据改成始终显示后，在 `apply` 里用 `view.contentHeight` 写 END 的 `margin-top`，让它在 1fr 行内
  贴住自然末尾，从而保住正文盒的点击面。
- 不采用的理由：
  1. 需要每次内容高度变化时重写几何；短文的内容盒高度被 min-height 钉住，ResizeObserver 观察
     `.cm-content` **看不到**自然内容变高，必须额外依赖 `ViewUpdate.geometryChanged` / 每次
     docChanged 的测量，触发面比 A 宽。
  2. END 的纵坐标变成 JS 派生量，和「异步图片到达后自动跟随」这条要求多一层时序风险；
     A 由布局引擎直接给出，没有这一层。
  3. 合同已明确「短文档不能被 min-height 推到一屏底」——解除 min-height 是这句话的直接落地。
- 若 Alex 要恢复「点正文下方空白」，那是一条独立的交互合同（点击 / 拖选的落点语义），应在
  A 的布局上单独裁决与测试，不塞进本 change。

### C. 只加点击兜底、不解除 min-height（不采用）

- 保留 1fr，用 scroller 上的 mousedown 把点击转成「光标到文档末尾」。
- 不采用：它只恢复「单击落光标」，恢复不了拖选起点 / 双击选词等 CM 在 contentDOM 上的手势；
  还要处理滚动条命中、左右空白区、END 自身命中，新增交互面大于收益。A 的布局让正文末行之后
  不再有「假装是正文」的空白，语义更一致。

## 4. 判据实现

- `endMarkerVisible(viewportHeight)`：`viewportHeight > 0`。`0` 与负值一律不在场（未布局 / 异常读数）。
- `EndMarkerView.read`：只读 `target.scrollDOM.clientHeight`（既有布局数，O(1)）。
- 重算触发点：只保留 `.cm-scroller` 的 ResizeObserver。删除 `update(update)` 里的
  `docChanged → requestMeasure`——内容高度不再影响显隐；内容位置变化由 CSS 自然流承担。
- 落地仍走**单帧**延迟（M238 实测：双帧会把阅读位置恢复推离 13px）；元素在场与否的落地不得在
  CM 测量周期内改布局。
- 生命周期（M251）：`destroyed` 闸门、构造时清理残留、`destroy` 摘元素原样保留。

## 5. 与非目标 / 既有能力的边界

| 既有能力 | 本 change 的关系 |
|---|---|
| 视口增量装饰层 | END 仍在装饰层之外；不改 livePreview 的构建范围 |
| `toc-outline` 的滚动位置语义 | 不读滚动位置，不新增第二份位置真源 |
| 行高 / 块边界纵向几何 | 普通正文行 padding 仍恒 0；END 位置只随内容高度变化。`empty-line-height-stability-nov27.spec.ts` 的 END 稳定性判据必须原样绿 |
| code 模式 / 非 md 文件 | theme 只装 md 分支；矩阵属性测试的「code 模式恒 0」不变 |
| 复制 / 搜索 / 保存 | 元素在 `.cm-content` 之外，机制不变；断言原样保留 |
| 视觉基线 | 短文与「一屏装得下」的 md 场景会新增 END，属预期变化；候选截图留档，基线更新另行裁决 |

## 6. 验证面（断言先行，反向必红）

1. **纯函数真值表**：视口 0 / 负值 → false；1 / 733 / 4000 → true。旧实现（两参且比较内容高度）
   必须让新用例判红（`endMarkerVisible(733)` 在旧签名下返回 false）。
2. **短文几何**：END 在场；`marker.top == content.bottom ±1`；`content.bottom - lastLine.bottom ==`
   正文下内边距；标记盒顶与末行的间距 == 正文下内边距，标记文字的顶边再下移标记上内边距；
   `viewport.bottom - marker.bottom > 100`（不在窗口底）；`scrollHeight == clientHeight`（短文不因
   END 产生滚动余量）。空文档与「带 frontmatter 的短文」各一条（后者没有 document-top title 行）。
3. **视口 0**：把 `.cm-scroller` 隐藏（display:none）→ clientHeight 0 → END 离场；恢复 → 回场。
   负向断言配正观测（恢复后必须回场，证明不是恒空转）。
4. **resize 不改变纵向位置**：短文在视口 733 → 更矮（如 400）→ 更高（如 1000）三档下，
   `marker.top` 不变（±1），且始终在内容末尾；长文跨判据两方向翻转时 END 仍在场、仍贴内容盒底边。
5. **长文滚动恒定**：顶 / 中 / 底 / 回顶 `scrollHeight`、`clientHeight` 逐项相同；END 四态都在场；
   滚到底时 END 进入视口。
6. **code 模式与切换历史**：M251 矩阵把期望改为「md ⇒ 1、code ⇒ 0」，短文不再豁免。
7. **结构性空态**：分栏空 pane（S4）与首启 tips（S3）不出现 END；在空 pane 打开带路径文档后 END
   出现（`no-tab-empty-state-nov27.spec.ts`）。这条与同批「空态无行号 / 无插入光标」同格。
8. **行高迁移**：`empty-line-height-stability-nov27.spec.ts` 原有 END 位置稳定判据不改、必须绿。
9. **真机场景 27**：短文侧从「节点缺席」改为「节点在场」；增加短文翻页后仍在场的断言；
   覆盖边界更新（END 无 bbox，可见性仍由 chromium 几何 + 截图承担）。

**反向必红**：§6.1 / §6.2 的新断言先在 master 实现上跑（短文 count 0 → 红），证据落
`.local/reviews/end-marker-all-docs-nov27/evidence/`；恢复实现后复跑转绿。只改声明（CSS / 注释）
不算验证，所有几何读数取渲染盒。

## 7. 已知边界

- END 的纵坐标依赖 `.cm-content` 的实际内容高度；字体加载完成前后若有度量差，END 会随内容重排
  自然移动（与正文自身移动同源，不是独立跳动）。
- 短文若「内容 + END」高于视口（例如窗口被压得很矮），会出现最小必要的滚动余量——这是「END 必须
  在正文末尾」的固有结果，不是贴底；测试只对「内容 + END 仍装得下」的短文断言零滚动余量。
- 空白区点击 / 拖选的行为变化见 §3 A 的代价段，是否恢复由 Alex 另行裁决。
- 观感（间距、线段长度）仍归 Alex；门禁只判几何与语义。
