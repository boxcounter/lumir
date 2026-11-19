# Tasks: fix-save-response-ownership-nov19

> 范围：只改 `src/save-controller.ts` 的保存应答归属判定与新增回归文件；不改 CAS 语义、
> 提示文案、`main.ts` 调用点，也不碰草稿存储（M844 另一条 finding）。

## 1. 合同与实现

- [x] 1.1 读 REVIEW.md、finding `20261119-worker-persistence-faults-bug-vault-cas` 与
      save-controller 现有状态合同，确认缺陷面是「应答落地只查 `sessionOf(path)`」与
      「在途标记按路径整键删除」两处。
- [x] 1.2 `src/save-controller.ts` 增加路径级装载世代（`saveEpoch`）与保存凭据
      `SaveTicket { path, epoch, token }`；`beginSave` / `owns` / `endSave` 收口全部归属判定。
- [x] 1.3 `noteVaultReset` / `noteOpened` / `noteRenamed` 推进对应路径的世代并撤下在途标记：
      vault 复位清空世代表；同路径重开与改名使旧应答整体失效。
- [x] 1.4 `saveDocument` 的成功、失败（冲突 / 删除 / 其他）与 `finally` 分支全部先核对凭据；
      旧应答不写 revision、不清 dirty、不清备份、不弹提示；`finally` 只撤自己的 token。
- [x] 1.5 `forceSaveCurrentFile` 的读基准与写入两段 await 之后各复查一次凭据，失效即停止。

## 2. 回归与验证

- [x] 2.1 新增 `tests/unit/save-response-ownership.test.ts`（10 条）：同名跨 vault 的迟到
      成功 / 冲突、同路径重开、app 内改名成功 / 失败、旧 `finally` 不撤新租约、开新标签不
      误伤其他标签、正常保存不倒退、强制覆盖两段 wait 的失效窗口。
- [x] 2.2 反向验证：临时回退 `src/save-controller.ts` 跑同一批回归，旧实现下迟到应答与
      `finally` 判据必须判红；恢复实现后全绿。
- [x] 2.3 `node --experimental-strip-types --import ./tests/unit/register.mjs --test
      tests/unit/save-response-ownership.test.ts` 与 `pnpm exec tsc -p tests/unit/tsconfig.json`
      通过。
- [x] 2.4 最终 `scripts/gate.sh quick`（`CARGO_TARGET_DIR=/tmp/lumir-m847-target`，跑前原子
      `mkdir` cargo 锁并写 owner，跑完释放锁、删除 target）：`GATE RESULT: 13/13 PASS（SKIP 0）`，
      退出码 0；`tsc-visual` 在安装 `tests/visual` 既有依赖后不再 SKIP。

## 3. 归档（批次收尾，本 mission 不执行）

- [x] 3.1 在 `docs/backlog.md` 落本 change 的归档跟踪条目，并按节点 2 五要件归档（本 mission
      的 scope 不含 `docs/backlog.md`；条目与归档提交由 tower 批次收尾完成）。
