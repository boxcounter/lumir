# Design: Markdown 阅读栏可见窗口

## 1. 四个量的合同

- `X`：grid 中列的 border-box 宽，等于 `min(token,pane−48)`；包含既有左右各 44px padding。
- 自然宽：nowrap 行盒/文本的 intrinsic inline 长度，可大于 X，不因本 change 改小。
- 可见窗口：Markdown nowrap 的 `.cm-content` padding box。文字 Range 的**可见交集**必须落在该区间；原始 Range 可超出，超出由 overflow clip 裁掉。
- 横滚容器：正文是 contentDOM；代码块/宽表是各自块级容器；code 文件仍是外层 scrollDOM。

wrap 时装 `EditorView.lineWrapping`，contentDOM 不启用横向 auto。Markdown nowrap 才装专用 class 与主题 `overflow-x:auto`。外层 grid、行模板和 content width 不改。

## 2. 根机制与 CM 边界

生产探针：当前外层横滚使 content/title/END 同步离屏；给 contentDOM `overflow-x:auto` 后，外层 `scrollWidth/clientWidth` 从 5077/964 变为 964/964，inner 最大横滚为 4215，content/title/END 的左右缘在起点、500、最右均保持 338/1098。

CM 6.43.15 的 `scrollRectIntoView(scrollDOM,…)` 从外层向祖先遍历，不会下潜 contentDOM；仅加 CSS 时 caret 0/行尾揭示都未改变 inner x=4215。故实现新增公开 `EditorView.scrollHandler`：

1. 仅在专用 Markdown nowrap class 在场时接管水平分量。
2. 用公开 `view.domAtPos` 加折叠 DOM Range 读取 head/anchor 的实际 glyph 坐标，按 `nearest/start/end/center` 与 xMargin 计算 contentDOM 的水平增量。测量周期内 MUST NOT 改回 `coordsAtPos`——它会再次触发 `readMeasured()` 并被 CM 拒绝。nearest 必须带 `range.head < range.anchor ? -1 : 1`；宽矩形按 CM 原分支在首次端点对齐后做第二次方向修正，且保留 xMargin（显式 reveal 实测为 5px），不得把 active head 留在另一端越界。
3. 返回 `false`，让 CM 默认路径继续处理外层纵向；handler 不发起编辑器 update、不改文档/selection state。

CM 的 caret/selection layer 是 scrollDOM 的绝对定位子树，也会在自然长行上制造 outer overflow。Markdown nowrap 的专用 editor class 给图层 `inline-size:100% + overflow:hidden + clip-path`，使 outer overflow 归 0 并把绘制裁到 X；公开 ViewPlugin 用「caret 的实际 DOM Range 坐标 − marker 内联 left」计算同一水平补偿量，在 selection/geometry/docView/content-scroll 后更新。补偿对尚未刷新和已刷新 marker 都成立，不复制 CM 的选区矩形算法，也不回退到原生选区。探针/正式场景同时读 selection layer 与 caret，防止只看文字不看自绘层。

## 3. 阅读位置与会话快照

- `horizontalScrollLeft(view)` 是唯一读取口：专用 class 在场取 contentDOM，否则取 scrollDOM。
- 持久化捕获的 x 改用该读取口；恢复在既有 CM 纵向效果之后写回同一容器。
- contentDOM 的原生 scroll 事件与 scrollDOM 一样进入既有 `onScroll` 订阅，防抖/让位窗口不变。
- 会话的 CM `scrollSnapshot` 保留纵向锚；旁边记录 inner x。切回时先 dispatch CM 快照，再在下一帧恢复当前模式的真实 x。内部类型变化不进入磁盘格式。
- 新文档装载把外层与 contentDOM 的 x 都复位为 0；code 行为不变。

## 4. 行为矩阵

| 维度 | 取值 | 每格必须读/判 |
|---|---|---|
| 折行 | wrap / nowrap | wrap 无 inner 横滚；nowrap 有自然溢出时 inner 可滚 |
| 横滚 | 起点 / 中段 / 最右 | glyph 可见交集 ⊆ X；行尾在最右可达；外层 x 恒 0 |
| 行号 | off / on | gutter 留在 grid 左轨；X 不变；caret 与选区正确 |
| pane | 单 / 双 | 各自容量独立；root/第二 Markdown 均遵守同一合同 |
| 窗口 | 1200 宽 / 820 窄 | X=min(token,pane−48)，窄窗自然宽仍不越出可见窗口 |
| 主题 | light / dark / eink | 几何不变；文字、caret、选区可辨；不新增颜色/滚动条样式 |
| 文档 chrome | doc-title / END | 不随正文横滚移出 X；不进文档字节/全选复制 |
| 编辑 | 点击 / 键入 / 粘贴 / 删除 / undo | 只改预期文档与选区；caret 被最小揭示；无意外 scrollTop 改写 |
| 搜索 | 定位长行尾匹配 | 匹配进入 X，query 不被改写 |
| 阅读位置 | 捕获 / 恢复 / 切标签 | 纵向锚与真实 inner x 同时往返；content scroll 触发既有捕获 |

矩阵由场景生成器覆盖关键笛卡尔积；行尾、caret、选区、doc chrome 与编辑路径不能用一个“overflow=auto”声明断言代替。主题与 pane 的候选截图只落 `.local/reviews/`，不更新正式基线。

## 5. 反向必红

每条新断言分别构造反例：

- glyph 可见交集：去掉 inner overflow/把可见交集强制越出 X，必须红；恢复后绿。
- 行尾可达：把最右揭示写成 0，必须红。
- caret/search 揭示：卸掉 scrollHandler，caret 留在旧 x，必须红。
- selection：把 selection marker 向右偏移到 X 外，必须红。
- doc/undo/dirty：把预期编辑改成错误字节，必须红；导航场景若改文档必须红。
- 阅读位置：恢复时误写外层而非 inner，x 不等于捕获值，必须红。
- code/块级回归：把 code 或块容器误路由到 inner class，结构断言必须红。

红/绿输出保存到 `.local/reviews/markdown-visible-width-nov27/`；整批一次反证不代替逐条反证。

## 6. 视觉保真

- **布局节奏**：grid 中列、24px 最小侧轨、44px 正文内边距、doc-title 与 END 的既有位置不变；横滚只改变 contentDOM 内文字切片。
- **字层级**：标题/正文/meta 字号、字重、行高、字族不变。
- **框体**：不新增边框、卡片、阴影、遮罩或常驻手柄；行号 gutter 保持当前主题样式。
- **滚动条**：inner contentDOM 登记 native-overlay 档，不写 `::-webkit-scrollbar` 或 scrollbar-width；块级横滚仍用既有 thin 档。
- **主题**：light/dark/eink 消费既有 token；eink 不新增动效或残影路径。
- **候选图**：现状与候选使用相同 fixture、窗口、pane、主题和横滚百分比；不追求与独立原型逐像素相等，因为验收对象就是生产实现。

## 7. 依赖与接口

实现最初基于 ae15f97c，现已 rebase 到 master d356a0f7；code 满 pane 已由 2de2f4ef 合并。容量 change 可继续消费同一 contentDOM 矩形；本 change 不实现其容量反馈或 A/B 手柄。若后续手柄需要感知横滚，读取口是 contentDOM 的 x，而不是假设外层 scrollLeft 仍变化。
