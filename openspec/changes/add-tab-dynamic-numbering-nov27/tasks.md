# Tasks: add-tab-dynamic-numbering-nov27

## 1. 合同与红测

- [x] 1.1 新建 proposal / design / spec delta，记录 Alex 批准、双 pane 边界、视觉保真与基线纪律
- [x] 1.2 先新增并实测红测：按住/松开、左右 Meta、blur/visibility/destroy、1–9 顺序、>9 无号、活跃 pane 隔离
- [x] 1.3 新增宽度与滚动零变化、既有 ⌘1 行为与文档不变、事件不消费/不多投、读屏名不变的浏览器断言

## 2. 实现

- [x] 2.1 在标签渲染中生成绝对定位、aria-hidden、pointer-events:none 的 1–9 序号
- [x] 2.2 实现可销毁的 Meta 状态与 blur/visibility 清理，并通过活跃 pane 只读注入避免跨 pane
- [x] 2.3 实现左内边距内的克制视觉落点，不替换关闭钮、不新增动作或设置

## 3. 验收制品

- [x] 3.1 更新真机 14-tabs 场景与覆盖表，提供按住期间截图及异常安全的 Command 松开通道
- [x] 3.2 运行 `node scripts/acceptance/run.mjs --check` 与验收套件相关自测
- [x] 3.3 生成三主题、窄 pane、长名称、1/9/>9 标签与双 pane 候选到主仓 `.local/reviews/tab-dynamic-numbering-nov27/` 并实际查看；不更新正式基线

## 4. 验证

- [x] 4.1 目标单元与浏览器测试通过，`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 4.2 `scripts/gate.sh quick` 全绿，照抄 `GATE RESULT` 原文与退出码并留存日志
- [x] 4.3 新增/修改断言逐条做反向必红实测；红绿读数落 `.local/reviews/tab-dynamic-numbering-nov27/`
- [ ] 4.4 完整 visual 由主会话串行执行（本任务不并行启动）；正式基线仍待 Alex 过目
- [ ] 4.5 真机 14-tabs 由主会话统一执行并留存 PASS 证据；本任务不启动真机
- [ ] 4.6 节点 2 记录按 proposal 五态表填写 implemented / released / machine PASS / native PASS / archived；独立 K3 评审、完整视觉、真机与归档均不提前宣称完成

## 5. 独立 K3 返修（tip a7b60f25 的两项 P2）

- [x] 5.1 Harness 持焦改用 `activeDocPane()` 命令目标口径；真实装配用例覆盖先持焦后按住、按住后开关面板、⌘1 与焦点不变，旧红/新绿落 `review-fixes/`
- [x] 5.2 CGEvent down 调用前登记侧别；执行器故障注入证明丢回执后 finally 仍发同侧 up，旧红/新绿落 `review-fixes/`
- [x] 5.3 复跑相关单测、浏览器、验收执行器/驱动与 quick，更新 rebased-readiness 与最终 tip；独立 K3 复核、完整视觉与真机仍归后续

## 6. 完整 visual 的既有键位合同返修

- [x] 6.1 将 typography「键位通路唯一」升级为精确三条职责：统一分发、Escape 安全消费、Meta 瞬态视觉；保留 ⌘= 一档与 Escape 功能判据，新增 Meta 不消费/不分发/不改文档或焦点与最后实例解绑回归
- [x] 6.2 对第四监听、Meta 消费/序号/副作用/粘住与解绑遗漏逐条反向必红并恢复绿；相关 spec、前端全量与 quick 通过，结果写入 rebased-readiness
