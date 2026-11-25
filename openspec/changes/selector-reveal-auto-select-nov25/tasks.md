# Tasks: selector-reveal-auto-select-nov25

## 合同与纯逻辑

- [x] 新建 `docs/specs/selector-contract.md`（C1–C8：游标 / 武装 / 真实 clip / 最小揭示 / IME / ARIA / 呈现变体）
- [x] `docs/specs/skill-menu.md` S1 / S2 改到新口径并加合同指针
- [x] 新增 `src/selector-reveal.ts`：`revealScrollTop` + `revealElementWithin`
- [x] 新增 `tests/unit/selector-reveal.test.ts`（表驱动 + 属性矩阵）
- [x] `src/skill-menu.ts` 增 `armed` 与 `syncSkillMenuState` / `hoverSkillHighlight`；`skillSelectionSpec` 只在武装态成立
- [x] 重写 `tests/unit/skill-menu.test.ts` 为 highlighted × armed × source 矩阵

## Skill 候选

- [x] `placeSkillMenu` 改以面板矩形 + 视口夹取，收缩 `max-height`，实测高度替代硬编码 32
- [x] 揭示改用真实 clip（menuRect ∩ panelRect ∩ viewport）与一行上下文
- [x] `data-armed` 与 `aria-activedescendant` 逐拍一致；指针选意改 `mousemove`，揭示滚动不抢游标
- [x] IME 组合结束按最终文档重算一次（`composition-settle` 新增 `skill-menu` 消费者）

## wikilink 候选

- [x] 去掉 `scrollIntoView`；`schedulePlace` / `place` 保留并恢复 `scrollTop`
- [x] `writePlace` 先写 `max-height` 再按真实可见带揭示活动行

## 测试与场景

- [x] `skill-hybrid.spec.ts` oracle 改真实 clip（含盒不越界断言）
- [x] 新增：可见最底项再移一项 / 短视口 × 三主题 × 缩放 / 全名接受 / 普通路径不武装 / 异步不武装 / IME 重算
- [x] `wikilink-suggestion.spec.ts` 新增 30 项长列表逐项导航（活动行在带内、scrollTop 不被归零、编辑器与页面不滚）
- [x] 更新验收场景 867 / 868 的导航预期与截图步
- [ ] 主会话串行执行：`scripts/gate.sh quick` + `scripts/gate.sh visual` + 真机 867 / 868
- [ ] 归档时执行：delta 合并进 living spec，`--archived` 审计 PASS

## 机械核验收口（2026-11-25）

- [x] F1 武装只接受无修饰 Enter / Tab；Shift+Enter、Shift+Tab、Alt+Enter 反例（全名自动武装 + 显式导航两路）
- [x] F2 下方放置以 `.lumir-hp-ctl` 顶缘为界，补浏览器断言（单选项与长列表）
- [x] F3 `max-height` 以 CSS 为单一真源，补「改 CSS 不失配」的浏览器断言
- [x] F4 Skill 侧 `compositionend` 重算次数断言；文档回调 / catalog 回包 / settle 合并为一次重建
- [x] F5 测试标题 / 注释 `mouseenter` → `mousemove`
- [x] F6 带高 1–2 行时的余量口径写进 C3，补边界单测
- [x] F7 短视口上翻优先收缩 `max-height`，盒底不越过 caret
- [x] F9 技能全名恰好 `tmp` 的武装语义钉住（单元 + 浏览器各一条）

## 机械复核 R1–R3 收口（2026-11-25）

- [x] R1 短视口收缩态连续导航：清空 `max-height` 前记 `scrollTop`、定高后恢复再揭示；补 320px ↓/↑ 各 11 拍逐拍断言（已完整可见步 `scrollTop` 不变）
- [x] R2 `max-height` 非 px 计算值：删掉 `parseFloat`，改为实测受 CSS 约束的高度；补百分比上限浏览器用例（90% 下不得按误读的 90px 收缩）
- [x] R3 状态去重与几何重排分开：`relayoutSkillMenu` 复用于同状态回包、窗口缩放与面板尺寸变化；补「缩放后重排」「同状态回包重排」两条用例（items 不重建）

## 机械复核 N1–N4 收口（2026-11-25）

- [x] N1 几何重排与主动揭示分开：`relayoutSkillMenu("cursor" | "if-clipped")`；同状态回包与 resize 只在「重排前完整可见、被新几何挤出带」时揭示，用户手动滚开的 `scrollTop` 不被拉回；补同状态 / 缩放两条浏览器用例
- [x] N2 `max-height` 的 `em` / `vh` 实测路径各一条浏览器用例（percentage 已由 R2 覆盖）
- [x] N3 两条重排用例补 `aria-selected` / `data-armed` / `aria-activedescendant` 快照与样式重写计数（证明重排真的跑过）
- [x] N4 mission README 更新到当前 tip 与本轮红 / 绿证据

## wikilink 同合同收口（2026-11-25）

- [x] 几何重排与主动揭示分开：`schedulePlace` / `place` 携带 `"cursor" | "if-clipped"`；同状态刷新、resize 与滚动只在「重排前完整可见、被新几何挤出带」时揭示，用户手动滚开的 `scrollTop` 不被拉回；游标刚变仍按 C3 揭示
- [x] 清 `max-height` 的瞬时塌缩不再回灌：排队的重排跨拍期间挂起 `placementPending`，塌缩拍的 scroll 事件不得被当成用户新位置写回
- [x] 补 4 条浏览器用例：手动滚开后同状态刷新 / 窗口缩放 / 1px 极端 clip 边界不拉回，游标变化仍揭示；复用 `selector-reveal` 的 `revealBand` / `isFullyVisibleWithin` 单一几何
- [x] 守住既有能力：`preservedScrollTop` 恢复、read/write 分离、IME「零刷新 / 仅一次」计数路径不变
