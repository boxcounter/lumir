# Tasks: foundation-vault-recovery

## 1. 保存恢复合同

- [ ] 1.1 固定 `(vault_id, normalized_path)` per-path CAS key、operation 参数绑定与不同 path 隔离。
- [ ] 1.2 固定临时文件、intent、atomic replace、parent directory fsync、result 与 intent 清理的顺序及 durable 边界。
- [ ] 1.3 逐一覆盖 intent durable 前/后、replace 前/后、parent fsync 前/后、result durable 前/后的唯一 `not-written`/`success`/`unknown` 结论。
- [ ] 1.4 定义启动恢复与同 `operation_id` 查询/重试的统一收敛，不允许 unknown 以新 id 重放。
- [ ] 1.5 统一 `document_write_unknown`，定义损坏、过期、清理失败、tombstone 与后续 operation 隔离。
- [ ] 1.6 明确 M79 living spec 与 M83 未合入设计的引用和实现边界，不复制旧 change 或实现产品代码。

## 2. 验证

- [ ] 2.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [ ] 2.2 执行 OpenSpec diff/link 检查，确认每个增量 requirement 有 scenario，文档链接可达，且未修改 M79、M83 或真实 vault。
- [ ] 2.3 以文档故障矩阵审阅每个阶段的唯一结果、同 id 幂等、不重复 replace、CAS 竞争、intent 生命周期和不同 path 隔离。
