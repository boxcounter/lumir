# Tasks: improve-harness-action-targets-nov27

> `openspec/specs/**` 活跃期只读；所有产品规格变更只写本 change 的 delta。
> 提案与 canonical 文档已交付；生产实施在依赖合并并 rebase 后进行。实现期发现 proposal 意图需要变更时，
> 停下更新 proposal 并重新走节点 1。

## 0. 提案、节点 1 与实施依赖

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/harness/spec.md` / 本文件与
      `docs/specs/pointer-targets.md`；只读核对基线源码与 living spec，不写未发生的技术验证
- [x] 0.2 本 change 的 OpenSpec strict validate 与 `bash scripts/openspec-links.sh` 通过；结果写入本轮报告
- [x] 0.3 节点 1 通过：主会话确认 Alex 2026-11-27 对既定方向的「好，采纳」及治理回复构成本次既定范围批准；
      依据已回填 proposal，不新增产品语义
- [x] 0.4 `clarify-harness-withdraw-scope-nov27` 已合并，已 rebase 到 master `b6fe012b`；重读最终撤回 living /
      DOM / CSS / 场景，保留 12px 撤销图标、20×20 可见盒、双激活源预览与 tail notice 不预览，仅扩命中层

## 1. 三层尺寸与轻量视觉实现

- [x] 1.1 在 `src/harness-panel.css` / `src/harness-panel.ts` 为复制、撤回、composer ×、图片 @ 建立
      「图标 / 可见底板 / 实际命中区」三层；实际命中默认 28×28 CSS px，任何方向不得低于 24
- [x] 1.2 复制改为无依赖内联 14×14 SVG，× 为紧凑 14px glyph；保留既有小底板、token、圆角与 @ 的 mono 视觉，
      不新增依赖、颜色、阴影或 44px 桌面按钮
- [x] 1.3 复制 / 撤回保持 hover / focus-visible 才显现，图片 @ / × 保持恒显；命中盒静止态已稳定，
      显现与消退零布局跳动，Withdraw 不变常驻
- [x] 1.4 保留全部既有 accessible name、复制 Markdown 源与约 1.5s success、撤回 12px 图标 / disabled 语义 /
      双激活源预览 / tail notice 不预览、@ 插入行为；撤回不恢复文字、不常驻；composer 卡片 / 动作继续
      `tabIndex=-1`，文本、选区、anchor、history 与键盘模型不变
- [x] 1.5 更新触及代码附近仍描述 16×16 / 24×20 为「实际命中尺寸」或旧字符复制图标的注释；
      可见底板尺寸与命中尺寸不得再混写

## 2. 几何与嵌套事件实现

- [x] 2.1 消息动作透明扩展优先消耗既有 gap / padding，不改 who / 正文行高、消息间距或文档内容；
      composer 为 28px 动作槽预留真实空间，不靠遮住摘录 / 出处 / 正文取得命中
- [x] 2.2 复制 / 撤回及 @ / × 命中区无正面积重叠，且不被祖先裁切、不越过容器形成不可达区；
      覆盖首条 / 末条 / 容器边缘、zh / en 与相关缩放档
- [x] 2.3 复制 success 文案变宽时撤回动作层同步让位且至少保留 2px 间隙，反馈消退后复位；
      disabled / hover / focus / success 均不推挤消息几何
- [x] 2.4 引用 / 消息摘录卡 × 的中心与透明边缘只执行一次移除、父卡零跳转；区域外父卡保留既有跳转。
      图片 @ / × 不串动作，保留 mousedown、选区与焦点语义

## 3. 结构、几何与真实命中测试

- [x] 3.1 新增 / 更新 Harness 视觉结构场景，以 `getBoundingClientRect()` 断言真实尺寸、相邻不重叠、容器边界、
      正文 / 摘录 / 出处文本不相交及 hover / focus / success 前后布局稳定；只断言 CSS 声明不算完成
- [x] 3.2 用 `document.elementFromPoint()` 或等效方法逐动作采样中心、四边与近角，确认透明扩展真实归属按钮；
      覆盖复制 / 撤回正常与 success / disabled、引用 ×、图片 @ + ×
- [x] 3.3 用真实指针事件验证复制源与 success、disabled 撤回零副作用、@ 只插入一次、× 只移除一次；
      引用 × 中心 / 边缘均不触发父卡 jump，紧邻区域外父卡仍正常跳转
- [x] 3.4 断言既有 accessible name、inline SVG 不产生额外读屏控件、composer Tab 序及文档 / 选区 / history 不变
- [x] 3.5 **每条新增 / 修改断言逐条做反向必红**：分别注入 16 / 20px 尺寸、相邻重叠、祖先裁切、正文覆盖、
      移除 × 冒泡隔离、错误 accessible name / Tab 序等必红输入，实测对应断言 FAIL；逐项恢复后 PASS。
      红 / 绿原始日志落 `.local/reviews/harness-action-targets-nov27/logs/`（16 类反例 + 最终恢复绿），
      不得以整组曾红替代逐条证据

## 4. 视觉候选与 Alex 基线裁决

- [x] 4.1 用同一合成 fixture 产出 light / dark / eink 的现状与候选同屏或并排对比；覆盖默认 / 窄 pane、
      复制、success、撤回正常 / disabled、引用 ×、图片 @ + ×，以及真实 hover / focus 状态
- [x] 4.2 候选材料落 `.local/reviews/harness-action-targets-nov27/`（before / after 各 24 张 + 三主题并排图，
      worker 已实际查看）；独立 reviewer 出 verdict 前
      必须实际查看并排图，审美 / 手感仍归 Alex，不用机器 PASS 代替
- [ ] 4.3 正式视觉基线 `--update` 前把候选截图交 Alex 过目并取得明确批准；未批准不得更新。
      获批后核对所有受影响整页基线的时间戳与变化面，无基线变化则记录「不更新 + 原因」

## 5. 真机验收

- [x] 5.1 新增 / 更新 `scripts/acceptance/` 场景：WKWebView 真实指针点击引用 × 的中心与透明边缘，
      证明移除一次且父卡零跳转；点击 @ / × 相邻边缘证明不串动作；不得只用 AXPress 冒充边缘命中
- [ ] 5.2 覆盖复制 success、撤回 disabled / focus、卡片几何与三主题中受影响的视觉证据；真机断言同样逐条反向必红并恢复判绿
- [x] 5.3 运行 `node scripts/acceptance/coverage.mjs` 更新覆盖表，`node scripts/acceptance/run.mjs --check` 通过：
      312 场景；原始日志 `.local/reviews/harness-action-targets-nov27/logs/acceptance-{coverage,check}.log`
- [ ] 5.4 真机由主会话统一执行新增 / 修改场景并取得 PASS，证据与 `status.txt` 落 `.local/acceptance/`；
      worker 不预写 native PASS

## 6. 门禁、独立终审与状态证据

- [x] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（quick 内原文
      `Totals: 39 passed, 0 failed (39 items)`）；规格 delta 与实现逐项对账，
      活跃期未提前改写 living spec
- [x] 6.2 `scripts/gate.sh quick` 通过：`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0；
      原始日志 `.local/reviews/harness-action-targets-nov27/logs/quick-r1.log`
- [ ] 6.3 完整 `scripts/gate.sh visual` 通过，报告照抄 `GATE RESULT` 原文行与退出码；CI 结构层不得替代本地像素层
- [ ] 6.4 独立 K3 reviewer 对当前 tip 做代码与视觉终审，结论 clean / merge 并绑定最终 tip；核验真实几何 / 命中、
      逐条反向证据及并排图。tip 后续有改动则重新评审
- [x] 6.5 证据路径在写入报告时实际可 `ls`；报告与 proposal 节点 2 分列视觉候选、implemented、machine PASS、
      native PASS、released、archived，分别附证据或「否 / 不适用 + 原因」，失败按四类归因

## 7. 合并、归档与 CI 终态

- [ ] 7.1 实现合并时在 `docs/backlog.md` 归档跟踪队列登记唯一条目；节点 2 五要件逐项记录，
      命中审美 / 基线等例外时先经 Alex 裁决，不自行归档
- [ ] 7.2 执行 `node scripts/openspec-archive.mjs improve-harness-action-targets-nov27`，提交归档目录、
      living spec 与修链结果，记录包装器实际输出和修链读数
- [ ] 7.3 归档提交后运行
      `node scripts/openspec-archive-check.mjs --archived improve-harness-action-targets-nov27`，
      取得 PASS 并记录归档提交 hash；未 PASS 不算归档完成
- [ ] 7.4 merge / push 后用 `gh run list --branch master` 或等价渠道跟进本次 push 触发的每条 workflow 到
      `success` / `failure` / `cancelled` / `timed_out` 终态；任一失败继续处理并附 run 链接与原因，未全绿不宣称批次完成
