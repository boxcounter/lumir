# harness 增量规格

> 起草注记（非规格正文）：本 change 不改行为，只给 Skill 候选的「游标完整可见」补**机器判据**。
> 行为条款仍以 `docs/specs/selector-contract.md` C2 / C3 与 `docs/specs/skill-menu.md` S2/S4 为
> 唯一真源，本条不重抄其语义；根因与证据见 [design.md](../../design.md)。ADDED 条不与 living
> spec 现有 requirement 同名。

## ADDED Requirements

### Requirement: Skill 候选可见性的机器判据

Skill 候选「游标 option 完整落在真实可见带内」的机器判据 SHALL 独立于实现计算真实可见带：
取候选盒与**全部裁切祖先**矩形及视口的交集，再扣掉候选自身（滚动口）的边框与 padding。
判据 MUST NOT 复用实现里的裁剪辅助函数、MUST NOT 以候选自身的盒或 `clientHeight` 代餐——
与实现同源的判据只能证明「实现与自己一致」，祖先裁切或滚动口 padding 出错时它照样通过。

判据 SHALL 在**每一次**游标变化上成立，而不是只在某个代表步：真实规模目录（超过一屏、含长描述）、
`↑` / `↓` 与 `⌃N` / `⌃P` 两种键族、向下与向上两个方向，逐拍走完整个列表。每一拍 SHALL 同时断言
（a）游标 option 完整落在真实可见带内；（b）可见标记（`.is-selected`）与 `aria-selected` 在**同一个**
option 上、且同一时刻至多一个可见标记，标记本身可辨（线宽 / 颜色与底色差成立）。
候选滚动位置发生变化、或 AX 树里存在该行，MUST NOT 单独作为「可见」的判据。

该判据 SHALL 在 chromium 与真机同款 UA 的 WebKit project 各判一次：揭示只写 `scrollTop`，两引擎的
滚动钳制与子像素取整不同，chromium 绿 MUST NOT 替代真机分支。

真机验收场景 SHALL 为同一条不变量给出 AX 判据：AX 快照会过滤真实可见区之外的行，因此「选中行的
文本出现在快照里」即「该行在可见区内」；只留截图 MUST NOT 被当作可见性判据。

#### Scenario: 长目录逐拍导航

- **WHEN** 真实规模目录（30 项、长描述）打开候选，并逐拍按 `⌃N` 走到底、再逐拍按 `⌃P` 走回顶
- **THEN** 每一拍的选中 option 都完整落在独立计算的真实可见带内，`.is-selected` 与
  `aria-selected` 指向同一项，且恰好一个可见标记

#### Scenario: 候选盒不得越出裁切祖先

- **WHEN** 短视口、共享字号缩放、窄 harness pane 或窗口收缩后候选重排
- **THEN** 候选盒的上下缘仍在裁切祖先与视口之内（必要时收缩 `max-height`），游标 option 仍完整在带内；
  原本完整可见的游标被新几何挤出带时补揭示，被用户手动滚开的位置不被拉回

#### Scenario: 真机选中行可见性

- **WHEN** 真机场景把游标移到列表末项与倒数第二项
- **THEN** 该行的文本出现在 AX 快照的候选行里（离屏行会被过滤），判据不依赖截图
