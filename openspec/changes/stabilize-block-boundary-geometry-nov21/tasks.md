# Tasks: stabilize-block-boundary-geometry-nov21

> 节点 1 已由 Alex 于 2026-11-22 明确采纳。顺序：先记录旧实现红证据，再实现；禁止以更新基线代替修复。
> 本批只执行 P0–P4；真机、完整视觉、归档与 CI 由主会话统一安排。

## P0 合同与先红证据

- [x] 0.1 起草 proposal / tasks / `editor-live-preview` spec delta，并在 `docs/specs/lists.md` 写入
      「列表项纵向几何与组扫描解耦」不变量
- [x] 0.2 新增 `tests/unit/block-geometry.test.ts` 与 `tests/unit/list-group-estimate.test.ts`；覆盖
      前序行类型 × marker 前缀 × 文档位置、边界单调性、无中段翻转、取值表、嵌套与对照组
- [x] 0.3 在旧实现上运行新增测试与逐帧场景，保存红输出到主仓
      `.local/missions/block-geometry-nov21/`；实现后再做缺陷条件反向验证

## P1 纵向单写者

- [x] 1.1 新增 `src/preview/block-geometry.ts`：`lineShapes()` 纯函数 + 同步 ViewPlugin；数值保持
      段落 8、列表 2、标题 24/20/16/14/12/10 与 9/6/5/5/4/4，首内容块标题上距 0
- [x] 1.2 `livePreview.ts` 移除标题与段落的纵向 padding 写入但保留 class；`theme.ts` 删除段落末行
      与列表首行的对应规则；`style.css` 删除裸 marker 的 0px 补偿及失效注释
- [x] 1.3 几何插件不随 selection 重建；组合期映射并冻结装饰，收到共享 `compositionSettled` 后恢复

## P2 横向首帧估算

- [x] 2.1 新列表组首帧使用同步估算；估算与扫描共用显示标记 / 宽度 helper，覆盖 ul / ol / 任务项和嵌套
      复合编号，既有组仍遵守陈旧值保留与后台重扫合同
- [x] 2.2 单测对同一文档状态比较估算与扫描的 width / body / labels；不允许异步结果改变纵向 padding

## P3 逐帧与结构回归

- [x] 3.1 扩展 `markdown-editing-stability.spec.ts` 的 rAF 采样：覆盖 Alex 的
      `Enter → - → 空格 → 中文`、`+` 族、空行对照与嵌套有序列表，记录 DOM caret 与 `coordsAtPos`
      差值但不对既有 DOM 一帧滞后新增承诺
- [x] 3.2 运行相关既有列表、编辑稳定性与 IME 结构场景；记录移除首帧估算、恢复树驱动边界后的红证据

## P4 新视觉场景与基线边界

- [x] 4.1 新增 `block-boundary-geometry.spec.ts`，覆盖 `para\n- `、`para\n+ `、`para\n---`、
      `para\n===` 的结构与计算样式断言
- [x] 4.2 不执行任何 `--update`；新场景只生成 actual 并复制到主仓证据目录供 Alex 过目，未经批准
      不在 `tests/visual/baselines/` 留新基线

## 独立评审返修

- [x] R1.1 修复连续正文首行查询的递归 / 二次方缺陷：`classifyBoundary` 只判 kind / boundary，
      `classifyLine` 才计算 top / bottom；6000 行连续正文只取首行的旧实现红证据为
      `RangeError: Maximum call stack size exceeded`（`review-p1-red-before-fix.log`）
- [x] R1.2 修复后目标单测 11/11、全量单测 1736/1736、根 / 单测 / 视觉三份 tsc 全绿，
      原目标结构视觉 161/161；证据为 `review-p1-green-target.log`、`review-p1-unit-all.log`、
      `review-p1-tsc-root-unit.log`、`review-p1-tsc-visual.log`、`review-p1-target-structural.log`

## 验证与后续边界

- [x] 5.1 跑相关单测、根 / 视觉 / 单测三份 tsc、目标结构视觉、性能夹具与 OpenSpec 严格校验；
      命令原文和结果落主仓证据目录
- [ ] 5.2 P5 真机验收、完整视觉、独立评审、归档与 CI 不在本批执行，由主会话统一继续；不得据此
      宣称这些层次已覆盖
