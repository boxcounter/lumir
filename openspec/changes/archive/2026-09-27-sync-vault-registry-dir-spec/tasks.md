# Tasks: sync-vault-registry-dir-spec

实现顺序：delta 定稿 → living spec 同步 → 门禁自验 → 归档对账（待 Alex 节点 2）。
本 change **不含代码改动**（实现已在 master 的 `d989197`），因此没有实现/真机分组。
每条完成后就地勾选；跑不动的项写「未验」并附原因，MUST NOT 写成已验（REVIEW.md 第 6 条）。

## 1. 制品与 living spec 同步

- [x] 1.1 delta 落 `openspec/changes/sync-vault-registry-dir-spec/specs/vault-workspace/spec.md`：
      MODIFIED ×1（「vault 注册表与显式重映射」），路径字面 `~/.config/lumir/workspaces/` →
      `~/.config/lumir/vault-registry/`，追加迁移口径段 + 新增 scenario「旧注册表目录在启动时迁移」；
      requirement 其余条款逐字携带、不作改写
- [x] 1.2 living spec 同步落盘：`openspec/specs/vault-workspace/spec.md` 的同一处路径更正 + 同一段
      迁移口径 + 同一 scenario（落盘内容与 delta 逐字节相同——这是归档幂等的前提，见 design §2）
- [x] 1.3 幂等自检：delta 与 living spec 的同名 requirement 正文用 `sed` 提取后 `diff` 为空

## 2. 验证

- [x] 2.1 `npx --yes @fission-ai/openspec@1.12.0 validate sync-vault-registry-dir-spec --strict` →
      `Change 'sync-vault-registry-dir-spec' is valid`
- [x] 2.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `28 passed, 0 failed`
      （含 `change/sync-vault-registry-dir-spec` 与 `spec/vault-workspace`）
- [x] 2.3 `bash scripts/gate.sh quick` 全绿（本 change 直接相关的是 openspec-validate 与 docs-check）
- [x] 2.4 全仓复核：合同路径字面（「注册表承载 id 到当前 vault 路径的映射」那句）已是
      `~/.config/lumir/vault-registry/`；`openspec/specs/**` 里 `workspaces/` 的剩余两处都在本次新增的
      迁移口径内、作为**旧名引用**存在（有意保留，不是漏改）；历史 change 文档（`multi-vault-workspaces`
      等）的旧名按 backlog #37「历史文档不改写」保留
- [x] 2.5 迁移条款逐条对齐实现、无发明语义：四态 + 启动调用点 + 诊断事件均有代码锚点
      （证据表见 design §3）

## 3. 归档对账（M255 执行，Alex 节点 2 已授权）

- [x] 3.1 **归档评审（Alex 节点 2）**：核 delta 与 living spec 合入结果逐句一致、requirement 名在
      living spec 里出现恰好一次、无实现期静默扩 scope；通过后执行
      `npx --yes @fission-ai/openspec@1.12.0 archive sync-vault-registry-dir-spec --yes`
      （预期幂等：living spec 零 diff）。
      **M255 执行记录**：Alex 2026-09-27 授权节点 2 全开，本件归档随 M255 落地。归档前复核：
      delta 与 living 的同名 requirement 正文（`### Requirement: vault 注册表与显式重映射` 至下一
      `### Requirement:` 前）sha256 均为 `0856d8dbd639a46b555a6a6205064e1569caef59e17ea9088a5e8c4e3ede4e1e`，
      逐字节相同；requirement 名在 living spec 出现恰好一次；`## 3` 之外无未勾任务。归档后
      `git diff openspec/specs/vault-workspace/` 为空（幂等成立），`validate --all --strict` 全绿
