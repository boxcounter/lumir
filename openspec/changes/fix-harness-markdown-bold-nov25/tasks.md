# Tasks: fix-harness-markdown-bold-nov25

## 1. 合同与复现

- [x] 1.1 阅读 living spec、最近排版 change 与渲染缺陷流程，沿真实解析/DOM 链定位根因
- [x] 1.2 增补 strong 流式一致性 requirement，并以合成 fixture 记录旧实现失败证据

## 2. 实现

- [x] 2.1 先添加真实渲染件单元矩阵与 Chromium 流式失败场景，再调整列表定稿边界
- [x] 2.2 保持普通块/已结束列表定稿、终态全量重渲及代码/链接/转义反例行为不变
- [x] 2.3 新增真机场景 875 与合成 mock fixture，覆盖流式中间态和终态；本分支不启动真机

## 3. 验证

- [x] 3.1 目标单测、前端全量单测与目标 Chromium 场景通过；记录实际命令和计数
- [x] 3.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`、`node scripts/acceptance/run.mjs --check 875` 与 `bash scripts/docs-check.sh` 通过
- [ ] 3.3 主会话在无并行视觉任务时串行补跑完整 `scripts/gate.sh visual`；本分支不抢视觉端口、不更新基线
- [ ] 3.4 Alex 指定的 2026-11-25 11:32–13:32 窗口内由后续主会话执行 `node scripts/acceptance/run.mjs 875` 并归档证据
