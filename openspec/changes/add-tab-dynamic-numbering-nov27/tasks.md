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
