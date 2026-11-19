## ADDED Requirements

### Requirement: composer 竖直移动的同列位口径

> 与 `move-composer-to-codemirror-nov18` 的「CM composer 的 Emacs 文本导航族」同题：本条只收敛
> **竖直移动的列位单位**，不复制其余条款。living spec 里「同 x 位」的措辞由本条取代——真机 140
> 在 M831 之前交付的是字符列（旧实现 `caretRangeFromPoint` 两个引擎都取左侧边界），M831 换内核后
> CM 的像素 goal column 把它读成右一列，Alex 在真机上裁决期望为「上一行同列 2」。

composer 的 ⌃N / ⌃P（含 ⇧ 扩选形态）SHALL 在**渲染行**之间移动，同列位 SHALL 是**行内字符列**
（行首起的 UTF-16 offset 差），MUST NOT 是像素 x 或「像素上最近的字符边界」。软折行产生的一屏行
SHALL 是一个停靠行；行选择 MAY 交给引擎的竖直移动原语，列位 MUST 按目标渲染行的字符列重算。
落点超出目标行长度时 SHALL 钳到该行行尾。连续竖直移动 SHALL 保留目标列：越过短行被钳位后，继续
同方向到达长行时 MUST 回到原列。水平移动、键入与换行 SHALL 重置目标列。⌃N / ⌃P 本身 MUST NOT
修改文档或产生编辑 undo 事件；文档首 / 末行的原地不动 SHALL 回落行首 / 行尾。

实现 MUST NOT 读取 DOM Range 几何或重建第二套 caret 模型来定列位。

#### Scenario: 短行行尾回长行取字符列

- **WHEN** 文档是 `yabzcdw\nmn`、caret 在末行行尾（列 2），composer 字体为比例字体，按 ⌃P
- **THEN** caret 落到第一行第 2 列（`ya|bzcdw`），随后键入 `p` 得 `yapbzcdw`，MUST NOT 落到第 3 列
  （`yab|zcdw`，像素 goal column 的缺陷签名）

#### Scenario: 连续上下移动保留目标列

- **WHEN** caret 在第 3 行第 10 列，依次按 ⌃P、⌃P、⌃N、⌃N，中间一行只有 2 列
- **THEN** 落点依次为第 2 行行尾（列 2，钳位）、第 1 行第 10 列、第 2 行行尾、第 3 行第 10 列；
  文档与撤销栈全程不变

#### Scenario: 软折行仍逐屏行移动

- **WHEN** 一个逻辑行在 composer 宽度内软折成多屏行，caret 在第 2 屏行第 5 列
- **THEN** ⌃P 落到第 1 屏行第 5 列、⌃N 回到第 2 屏行第 5 列（MUST NOT 一步跳到上一 / 下一逻辑行）
