# Design: composer 竖直移动的字符列口径

## 决策

**列位单位 = 行内字符列（UTF-16 offset 差），行 = 渲染行（软折行的一屏行）。**

| 候选 | 结果 | 取舍 |
|---|---|---|
| 保持 CM 像素 goal column（现状） | 真机 140 FAIL；列位随字体度量漂移，CJK / 比例字体下不可预期 | 否——与 Alex 真机裁决的期望相反 |
| 只按逻辑行（`\n` 界）字符列移动 | 列位正确，但软折行段落到不了相邻屏行（M457 的「按视觉行」裁决被推翻） | 否——超范围 |
| 行选归 CM、列位按渲染行内字符列 | 140 绿、软折行逐屏行行为保留、列位与字体无关 | **采用** |

## 实现要点

1. `composerVerticalTarget(view, start, forward, fallback)`：
   - `view.moveVertically(EditorSelection.cursor(start.head, start.assoc), forward)` —— 只借它选行
     （折行点、视口边界、文档首末行归 CM）。**必须剥掉 `goalColumn`**：CM 会把它当像素 x。
   - 起点行：`composerRowBounds(view, start.head, start.assoc)`。
   - 目标列：`start.goalColumn ?? start.head - startRow.from`（都没有才现算）。
   - 目标行：`composerRowBounds(view, moved.head, moved.assoc)`。
   - 落点：`targetRow.from + min(goal, rowWidth)`；钳到行尾时 `assoc = -1`（光标画在该屏行行尾）。
   - 返回 `EditorSelection.cursor(pos, assoc, undefined, goal)`，把字符列继续带在 `goalColumn` 上。
2. `composerRowBounds`：`moveToLineBoundary(..., includeWrap = true)` 的左右两侧就是光标所在
   渲染行的行首 / 下一屏行行首；`assoc` 参与取行（assoc=-1 时按 `head - 1` 的 y 取行），折行点上的
   光标因此仍算前一屏行行尾——与 `coordsAtPos` 的画法一致。
3. 传 `SelectionRange` 给 `view.dispatch({selection})` 会被 CM 按单 range 重建并丢掉 `goalColumn`，
   必须包成 `EditorSelection.create([...])`（实测：`EditorSelection.cursor(5,0,undefined,2)` 直接派发后
   `goalColumn == null`）。
4. `⌃P/⌃N` 与 `⇧⌃P/⇧⌃N` 走同一个 `composerVerticalTarget`；前者文档首末行回落行首 / 行尾
   （与 CM `cursorByLine` 同序），后者 anchor 不动、无回落（与 CM `selectByLine` 同序）。

## 代价

- 每步竖直移动多两次 `moveToLineBoundary` 测量（各一次 `coordsAtPos` + `posAtCoords`）。composer
  文本短、按键频率低，未测出可见开销；不做像素测量就没有与字体度量耦合的列位来源。
- 字符列在**软折行行内**跨行时按屏行重算（第 3 屏行第 5 列 → 第 2 屏行第 5 列）。这是 Emacs
  `line-move-visual` 的同款语义：一屏行是独立的停靠行。
- `SelectionRange.goalColumn` 在本文件里是**字符数**，与 CM 的像素语义不同单位。消费者只有本文件的
  竖直移动（其余 CM 命令都会替换选区并丢掉它）；实现里凡调用 `moveVertically` 都先剥掉它。

## 与既有裁决的关系

- M455：修过同一形态（旧 contenteditable composer 的 `moveLineVertical` 在段落末缘丢列位），
  当时的判据就是「同列位」。
- M457（Alex 2026-10-12「按视觉行、与编辑器正文对齐」）：**行**的口径保留（渲染行优先），本 change
  只收敛**列**的单位。
- living spec 里「同 x 位」的措辞随之被字符列取代（见 spec delta 的 supersede 说明）。
