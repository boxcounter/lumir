# Proposal: 草稿读写按出发时绑定的 vault id 落点（跨 vault 串台修复）

- Change ID: `fix-draft-vault-ownership-nov19`
- 日期: 2026-11-19
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：本条缺陷的修复由 Alex 直接要求（mission M848 的 Context 原话：「M844复现：
> harness_draft_put执行时按当前vault scope解析……用户要求安排修复。」）。提案与实现同批交付，
> 裁决点 D1–D3 见 [design.md](design.md) 末尾；节点 2 由 tower 按五要件处理。

## Why

M844 的对抗测试复现了一个跨 vault 串台缺陷（finding
`20261119-worker-persistence-faults-bug-vault-scope-vault-vault`，severity medium）：

1. 在 vault-a 里编辑 composer，防抖写 `harness_draft_put` 已发出但后端执行被挂住；
2. 后端切到 vault-b（`vault_open_path` 完成），面板丢弃旧待写并读回 b 的草稿；
3. 放行旧写：它按**命令执行时**的当前 vault scope 解析落点，写进了 vault-b 的草稿文件。

后果有两条，都是静默的：vault-b 下次装载会把 vault-a 的内容恢复进 composer（跨 vault 内容串台）；
vault-a 的草稿丢失。前端 store 的世代守卫只保护自己的 `pending` / `written` 基准，挡不住后端
写错文件。

根因是 change `composer-draft-persistence` 的原始设计前提：**「前端不知道 vault id，后端按当前
scope 解析落点」**（归档 proposal 的「后端命令自带当前 vault 的稳定 id」一节）。这个前提对
**单次、同步完成**的写成立，对**在途跨切 vault 的写**不成立——落点解析时刻晚于归属时刻。

## What Changes

1. **后端按显式 id 解析落点**（`harness` capability）：`harness_draft_get` 与 `harness_draft_put`
   SHALL 携带调用方绑定的 vault 稳定 id（`null` = 无 vault，静默 no-op），后端 MUST 只按该 id
   解析落点，MUST NOT 读取当前打开的 vault。迟到写因此只落它出发时的 vault。不引入双写、不做
   文件迁移（落点布局 `<config_dir>/harness/drafts/<vault 稳定 id>.json` 不变）。
2. **前端在出发时绑定归属**：草稿 store 在 `load(vaultId)` 时绑定；每次写 / 清除在出发点捕获
   该 id 随载荷下发，失败重试仍打同一 id。面板持有稳定 id（由装配层 `applyVault` 经
   `vaultChanged(root, vaultId)` 传入），MUST NOT 在 IPC 层维护「当前 vault id」的第二份缓存。
3. **规格**：修改 `harness` 的「composer 草稿 v2 与一次性 v1 转换」条，补归属绑定合同与三条
   交错场景（迟到写、迟到读、失败重试）。

## Non-goals

- **不改**防抖窗口、离散 flush 时点、无变更不写、串行写链、v1 一次性迁移、写失败降级这些既有
  语义——本 change 只改「落点由谁决定」。
- **不迁移**既有草稿文件，也不保留「不传 id 按当前 scope 解析」的兼容路径：前端是唯一调用方，
  切换是原子的（AGENTS.md 硬规则「变更默认直接切断」）。
- **不处理**「发送回执与切 vault 交叠时 `clear()` 按当时绑定删除」这一既有窗口——它不是本缺陷
  的路径（发送回执在切 vault 前完成是常态），且修复它需要面板记录发送时点，超出本次范围；如需要
  另立 change。
- **不改**草稿的编址粒度（仍然一个 vault 一份），也不新建跨 vault 的草稿索引。

## Impact

- 影响的 specs：`harness`（MODIFIED 一条 requirement）。
- 影响的代码/系统：Rust `harness::draft` 两个命令与注册注释；前端 `src/ipc.ts`、
  `src/harness-draft.ts`、`src/harness-panel.ts`、`src/main.ts`；新增单测与 Rust 集成测试。
- 关联约束：草稿 MUST NOT 写入 vault（ADR 0003 / `harness` spec 不变）；落点目录名纪律复用
  `jsonl::vault_dir_name`（`valid_id` 且 ≠ `_orphaned`）。
