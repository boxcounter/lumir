# Proposal: 保存应答只对发起时的文档生效（迟到响应归属）

- Change ID: `fix-save-response-ownership-nov19`
- 日期: 2026-11-19
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：由 M847 承载。任务书 Context 引用 Alex 原话「用户要求安排 finding 修复，
> 不长期保留 todo」，修复对象是 M844 交付的确定性缺陷，不含新增产品行为或取舍；实现按既有
> 保存合同收窄，不扩到无关存储（同一 finding 批次的 `harness_draft_put` vault 归属问题不在本
> change 射程）。

## Why

M844 的确定性故障注入复现了一个保存应答归属缺陷（finding
`20261119-worker-persistence-faults-bug-vault-cas`）：在途保存的应答若晚于「放弃修改并切换
vault + 在新 vault 打开同名相对路径」，旧 vault 返回的 revision 会被写进新文档的 CAS 基准
（`revisions["README.md"]`），下一次 ⌘S 携带旧基准、被后端按 CAS 拒绝，用户看到一次假冲突。
同一窗口里迟到的失败提示（`document_conflict` 的 sticky「保存冲突」、`fs_not_found` 的
「另存为新文件」）也会挂到新 vault 的同名文档上。

根因不是「迟到的 IPC」本身，而是应答落地时只按路径查会话是否存在：

```ts
if (sessionOf(path) === undefined) return false;
revisions.set(path, revision);
```

同名路径在新 vault 里命中一个**新**会话，于是旧应答被当成了新文档的应答。同族路径还有：
同一路径被重新打开（读快照重新登记基准）、app 内改名（键从旧路径迁到新路径）、强制覆盖
保存的两段 await（读基准 → 写入）。

现状里 `saving` 是按路径的集合并只承载「有没有保存在途」一个布尔语义，旧保存的 `finally`
按路径整键删除——如果失效之后新文档已经开始自己的保存，旧保存收尾会把新保存的在途标记
一起撤掉。这两件事都必须按「哪一次保存、哪一份文档」判，不能只按路径。

为什么是现在：finding 由 M844 交付、用户明确要求安排修复；假冲突会把用户锁进
「⌘S 报冲突 → 强制覆盖」的多余操作，且迟到提示指向错误文档，属于可复现的信任损耗。

## What Changes

1. **路径级装载世代（`fs-io` 新增一条 requirement：保存应答的归属与迟到响应）**
   每次保存发起时随路径捕获装载世代与本次在途 token。`noteVaultReset` / `noteOpened` /
   `noteRenamed` 推进对应路径的世代并撤下该路径的在途标记；旧应答落地时两项凭据任一不符
   即整体丢弃——不写 revision、不清 dirty、不清备份、不弹任何提示。

2. **在途标记按 token 绑定**
   旧保存的收尾（含 `finally`）只撤自己的 token，MUST NOT 撤下同一路径上新保存的标记；
   失效事件之后新文档可以立即发起保存，不被仍未收尾的旧保存挡住。

3. **路径级而非全局失效**
   不使用全局装载世代（`serial`）作保存失效判据：打开新标签 / 打开别的文档不得让其他标签
   在途的保存作废。现有 `serial` 继续只承担编辑器装载事务的 requestId。

4. **强制覆盖保存同口径**
   `forceSaveCurrentFile` 的两段 await（`fs_read_snapshot` 读基准、`document_save` 写入）
   之后各复查一次凭据；失效即不再写入 / 不再应用结果。

5. **确定性回归**
   新增 `tests/unit/save-response-ownership.test.ts`，用可控 deferred 应答构造保存开始 /
   成功 / 失败 / `finally` 与切 vault、同路径重开、改名、强制覆盖的交错；同名跨 vault、
   旧 `finally` 误删新标记、开新标签不误伤、正常保存不倒退各有独立判据，并做过「回退实现
   必须判红」的反向验证。

## Non-goals

- **不改保存的 CAS 语义、原子替换、冲突恢复动作与文案**：冲突仍给两个恢复动作，删除仍给
  另存为新文件；本 change 只决定「哪个应答算数」。
- **不修 M844 同一批的另一条 finding**（`harness_draft_put` 的 vault 归属）：那是草稿存储的
  scope 解析问题，需要后端携带 vault id，与保存链路无关，不在这里扩面。
- **不用全局 `serial` 或「切 vault 即作废全部在途保存」**：前者误伤其他标签，后者把范围扩到
  「所有保存」，与「开新标签不该让别的标签保存作废」的既有判据冲突。
- **不改 UI 与提示文案**，不加新的故障注入真机场景：交错在 Node 单测里确定性构造，真机不
  伪造故障（任务书明确口径）。
- **不动重载 / watch 外部变更链路的 `serial` 判据**：它们已经按装载事务作废，不在本次缺陷面。

## Impact

- 影响的 specs：`fs-io`（ADDED「保存应答的归属与迟到响应」）。
- 影响的代码：`src/save-controller.ts`（状态表、四个失效钩子、`saveDocument` /
  `forceSaveCurrentFile` 的归属复查）。`src/main.ts` 的调用点无需改动（三个钩子的调用时机
  已存在）。
- 影响的测试：新增 `tests/unit/save-response-ownership.test.ts`；`tests/unit/save-controller.test.ts`
  的既有行为断言不回归。
- 关联约束：ADR 0003（不改写源文件格式）、ADR 0004（AI-only 交付）；性能合同不受影响
  （每次保存只多两次常数时间的 Map 查写）。
