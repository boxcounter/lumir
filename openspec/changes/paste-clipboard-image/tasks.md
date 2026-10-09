# Tasks: paste-clipboard-image

> 本 change 是提案先行（节点 1 未过不进入实现）。以下任务在 Alex 批准提案后执行；
> 裁决点 ①–④ 的落地形态以节点 1 裁决为准，与起草倾向不同处先回改 spec delta 再实现。

## 1. 通道探针（实现期第一项，design §2）

- [ ] 1.1 真机探针：起 `pnpm tauri dev`，探针打印 paste 事件 `clipboardData` 的 types/items
  全集（合成 png 经 AppleScript 置剪贴板）；坐实 MIME 集合与 `getAsFile()` 可用性。
  形态与 design §2 假设不符 → 停手 TowerSend 上报 tower，不猜退路
- [ ] 1.2 确认成品/dev 两侧 `crypto.subtle` 可用（secure context 断言进构建验证）；
  不可用则上报改 Rust 侧 hash 方案（契约不变）

## 2. fs-io 二进制附件写入

- [ ] 2.1 `fs_io.rs` 实现 `fs_write_attachment`：`resolve_in_vault` 约束、base64 解码、
  50MB 上限、`.lumir-{pid}` 临时文件 + rename 原子写、自动建缺失父目录、撞名
  MUST NOT 覆盖（`fs_already_exists`）
- [ ] 2.2 命令注册 + ts-rs 绑定导出至 `src/bindings/`（bindings-drift 纪律：
  先 `git add` 重导出产物再跑 gate）
- [ ] 2.3 Rust 单测：路径逃逸拒绝 / 超限拒绝 / 撞名不覆盖 / 原子写半态不留 /
  父目录自动创建 / 结果不可确认报错不报成功

## 3. 前端粘贴链路

- [ ] 3.1 `src/editor.ts` 装配处挂 `EditorView.domEventHandlers({ paste })`：md 模式且
  可编辑才拦截；无 `image/*` 一律不消费（默认文本粘贴不变）
- [ ] 3.2 贴图链路：Blob → ArrayBuffer → sha256（crypto.subtle）→ 文件名
  `pasted-<hash16>.<ext>`（MIME↔扩展名映射收进 `attachments.ts` 既有注册表，不另立表）
- [ ] 3.3 去重：插入前 `fs_paths_exist(["attachments/<name>"])`；命中跳过写盘；
  `fs_already_exists` 按去重命中收敛继续插入
- [ ] 3.4 光标处插入 `![[<name>]]`（块级独占一行，见 design §5），普通 CM 事务
  （进 dirty/保存/undo）
- [ ] 3.5 失败矩阵接线（design §6）：未收录 MIME / 超限 / 写盘失败 → deck 化 toast；
  MUST NOT 静默失败、MUST NOT 插引用留破图
- [ ] 3.6 `文案-Copy.md` 新键补登（查末位键号追加，不预先占号）

## 4. 验证

- [ ] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 4.2 前端单测：拦截判定（image/非 image/非 md 模式/只读）、命名与去重分支、
  插入事务形态（mock invoke）
- [ ] 4.3 真机验收场景 S1–S4 落地并全 PASS（草案见 design §7：贴图入 vault / 同图去重 /
  文本粘贴回归 / 未保存新文档；S5 失败面按 design §7 分流 Rust 单测 + 前端 mock）
- [ ] 4.4 `scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行上报）
- [ ] 4.5 视觉门禁：引用语法渲染既有场景已覆盖，若动了 `src/style.css` /
  `src/preview/**` 则补跑 `scripts/gate.sh visual` 并在报告声明

## 5. 依赖同步

- [ ] 5.1 fs-io 条款一致性：本 change 的「父目录缺失自动创建」是对 vault_create 现行
  「父目录 MUST NOT 隐式创建」口径的刻意分叉（proposal 盘点第 6 条），与未合并 change
  `add-harness-permission-modes` 中 Alex 已批准的 vault_create 同向修订一致。归档前核对：
  若该 change 已合并/归档，确认 fs-io living spec 两处条款已一致（vault_create 改为
  自动建父目录），并把本 change 文本中的「刻意分叉」表述改为「同口径沿用」；若该修订
  仍悬空，在 `docs/backlog.md` 登记「fs-io 建父目录口径两条并存」的待裁决项，不带病归档
