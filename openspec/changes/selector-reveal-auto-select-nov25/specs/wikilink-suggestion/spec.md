# Delta: wikilink-suggestion

## MODIFIED Requirements

### Requirement: 候选浮层的不透明视觉与几何合同

候选浮层 SHALL 以 `view.coordsAtPos(head)` 为锚点、`position: fixed`，水平宽度与视口夹取复用 `placeOverlay` 的 `list` 档；垂直方向下方空间不足时上翻，resize / 滚动后 MUST 重夹或关闭，不得停留在视口外。路径行 SHALL 复用 Quick Open 的目录先让宽、文件名后裁与全文提示，同名候选必须可区分。

浮层壳 SHALL 使用 `--preview-bg`、1px `--border`、`--r10`、`--shadow-raise` 与 `--fs-ui-s`；light / dark / eink 三主题计算后的背景 alpha MUST 等于 1，正文 MUST NOT 透过候选壳。行几何、文字、目录、活动与 hover 状态 SHALL 复用 Quick Open 对应的现有 spacing、`--r6`、`--text`、`--text-3`、`--sel`、`--hover` 和 currentColor，MUST NOT 新增颜色、字号、圆角或阴影 token。滚动列表 SHALL 登记到既有原生 overlay 豁免档，MUST NOT 新增自绘滚动条或 `scrollbar-gutter`，右缘 12px 内不得新增常驻按钮。

列表揭示 SHALL 遵守 `docs/specs/selector-contract.md` C3：先恢复正确的 `max-height` 再揭示，MUST NOT 在写入定位样式之前清掉定高——清掉会把列表从「可滚」变成「内容高」、把 `scrollTop` 归零，揭示随之丢失。活动行 SHALL 完整落在 `listRect ∩ viewport`（扣掉列表自身 padding）内；已可见时 `scrollTop` MUST NOT 改变；越界时只滚动列表并保留一行上下文；MUST NOT 滚动编辑器、页面或任何祖先。

#### Scenario: 三主题与长路径均不透明且不越界

- **WHEN** 分别在 light / dark / eink、默认与放大字号下打开含长路径和同名项的候选，并把光标移到视口边缘后 resize
- **THEN** 浮层背景计算值完全不透明，路径身份可辨，水平夹取来自 `placeOverlay`，垂直按可用空间重夹或上翻，浮层不越出视口

#### Scenario: 浮层滚动容器遵守既有分档

- **WHEN** 候选超过可视高度并滚动列表
- **THEN** 列表使用已登记的原生 overlay 豁免档，没有新增自绘滚动条、`scrollbar-gutter` 或右缘常驻按钮，活动项始终滚入视野

#### Scenario: 长列表逐项导航不丢滚动位置

- **WHEN** 候选超过一屏（如 30 项），用户逐次按 `↓` 从首项走到第 21 项，再逐次按 `↑` 返回首项
- **THEN** 每一步活动行都完整落在 `listRect ∩ viewport` 内；向下的 `scrollTop` 单调不减、向上单调不增，
  MUST NOT 在每次重建后被归零；编辑器与页面的滚动位置全程不变，回到首项时 `scrollTop` 回到 0
