# Tasks: <change-id>

## 1. <任务分组名>

- [ ] 1.1 <可勾选的原子任务>
- [ ] 1.2 <……>

## 2. 验证

- [ ] 2.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 2.2 <该 change 的验收动作，如某 CI 门禁绿、某 fixture 跑通>
- [ ] 2.3 新增 / 修改的断言逐条做**反向必红**实测：构造必须让它 FAIL 的输入（标记挪到错误节点 /
      探测串放错位置 / 断开被测通道 / 改错目标值），实测判红；恢复输入后判绿。两次读数记进证据；
      无断言变化写「无新增断言」。
- [ ] 2.4 节点 2 记录按 `proposal.md` 的「节点 2：归档记录」五态表填写（口径见
      `docs/process/openspec-workflow.md`「状态分列」）implemented / released / machine PASS /
      native PASS / archived；失败项按「失败与 finding 归类」四类归因，不混算。
