# Tasks: govern-editor-evidence-state-nov27

## 1. Canonical 口径

- [x] 1.1 `docs/process/openspec-workflow.md` 新增「状态分列」五态表（implemented / released /
      machine PASS / native PASS / archived），每态要求证据指针或「否 + 原因」，并写明
      released ≠ archived、machine PASS ≠ native PASS。
- [x] 1.2 同文新增「证据可复核性」：指针须当下可 `ls`；已清理只能写
      「归档记录报告 PASS（原证据已清理，当前不可复核）」；需要当前证据就复跑落新指针。
- [x] 1.3 同文新增「失败与 finding 归类」四类表（产品缺陷 / 测试 oracle 缺陷 / 环境 INVALID /
      需求或视觉迭代），只有产品缺陷计入失败轮数；「待归因」不结案。
- [x] 1.4 同文新增「新断言的反向必红」：任何新增 / 修改的断言逐条先造必须让它 FAIL 的输入并实测，
      恢复后判绿；未做反向实测不得写成「已验」。
- [x] 1.5 节点 2 要件 4 挂「状态分列」「证据可复核性」指针；批次收尾 finding 对账项挂
      「失败与 finding 归类」；「新断言的反向必红」由 tasks 模板 2.3 与 acceptance README 承接。
- [x] 1.6 `openspec/README.md` 与 workflow 制品清单标注零行为变更的 `.openspec.yaml`
      （`schema: spec-driven` + `skip_specs: true`）例外；本 change 首个消费者。

## 2. 模板与执行面

- [x] 2.1 `docs/process/templates/proposal.md` 的节点 2 记录改为五态分列表（值 + 证据指针）。
- [x] 2.2 `docs/process/templates/tasks.md` 验证节新增反向必红与五态记录两项。
- [x] 2.3 `scripts/acceptance/README.md` 加入新断言反向必红纪律、索引 PASS 的收口限定、FAIL 四类
      归因指针、旧证据可复核性指针。
- [x] 2.4 `docs/process/real-machine-acceptance.md` 覆盖映射表标注历史记录属性。
- [x] 2.5 `docs/process/rendering-defect-contract-first.md` 属性测试步骤加反向必红指针。

## 3. 验证

- [x] 3.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
      （`skip_specs: true` 生效，零 delta）。
- [x] 3.2 `bash scripts/docs-check.sh` 通过（含 links / archive-check / backlog-check / openspec-links）。
- [x] 3.3 逐条核对合同四项在文档中的落点：五态分列、四类归因、反向必红、旧证据限定语；
      用 `rg` 给出命中行。
- [x] 3.4 反重复核对：五态 / 四类只在 `openspec-workflow.md` 定义一次，其余文件为指针或
      执行面说明；`git diff` 逐文件过一遍，不新增第二套术语表。
- [x] 3.5 临时副本验证 `.openspec.yaml` 的 `skip_specs` 归档路径：`openspec archive` 退出码 0、
      目录移入 `archive/`（不在本仓执行归档）。

## 4. 交接

- [ ] 4.1 合并 / push / 归档由 tower 在评审后执行：合并后按 workflow 在 `docs/backlog.md` 的
      归档跟踪队列落一条唯一本 change 条目，再归档（本 mission 按指令不执行）。
