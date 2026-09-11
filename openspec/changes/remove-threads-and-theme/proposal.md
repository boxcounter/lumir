# Proposal: 移除 Thread 特性与三主题实现（定位转向落地）

- Change ID: remove-threads-and-theme
- 日期: 2026-09-12
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

[ADR 0006](../../../docs/adr/0006-agent-positioning-deferred.md)（2026-09-12）裁决：AI/Agent 定位延后，已实现的 Thread 形态被明确否定；视觉方向推倒重做（对 `design/` 下三个探索方向均不满意）。本 change 是该裁决在功能面的落地。

同时作废并删除 change `add-editorial-design-language`：其 tasks 全未勾选、spec delta（`editorial-design`）从未归档进 living spec、核心裁决（三主题 token、Thread 最小模型）已被 ADR 0006 推翻。该 change 目录随本 change 一并删除；其「Vault 引用稳定持久化」条目中已实现且仍有效的部分（vault 注册表 + 显式重映射）由本 change 的 vault-workspace 增量追认进 living spec。

## What Changes

1. **删除 Thread 特性**：前端 `src/threads.ts` 及 `main.ts` / `shell.ts` / `ipc.ts` / `style.css` 全部接线；后端五个 `thread_*` command 与 `Thread/ThreadFile/ThreadStatus` 类型；`src/bindings/Thread*.ts` 生成物；视觉测试 stub 与相关场景；`文案-Copy.md` 相关条目。本地数据 `~/.config/lumir/threads/` 保留不删。
2. **拆分 `src-tauri/src/threads.rs`**：vault 注册表逻辑（`VaultWorkspace`、`reconcile_vault`、`vault_register`、`vault_remap`、`remap_candidates`）搬入新模块 `workspaces.rs`；`remap_candidates` 的候选排序由「thread 最近活跃度」简化为按稳定 id 排序（thread 数据源已删除）。
3. **删除 agent 接入空壳模块** `acp_client.rs` / `mcp_server.rs` / `cli.rs`（未注册任何 command 的占位骨架）及 `lib.rs` 对应声明。
4. **三主题收敛为单套排版基线**：`style.css` 删 dark/eink 覆盖与 callout 多主题色板，`:root` 排版 token（字体/行高/行宽/栏宽）保留为基线；`main.ts` 删主题切换与 `lumir-theme` localStorage；`mermaid.ts` 主题维度收敛为固定默认配置；`design/` 目录删除。
5. **视觉测试收敛单主题**：各场景 spec 的 dark/eink 走查分支删除，基线截图相应更新。

## Non-goals

- 不动 `src/preview/theme.ts` 与 `editor.ts` baseTheme：它们是 Live Preview 的功能排版层（标题/callout/列表/frontmatter/wikilink/math/mermaid 的装饰样式），不是多主题机制。
- 不动 `openspec/specs/` 既有 living spec 条目：thread/theme 从未归档进 living spec，无可 REMOVED 条目。
- 不做新视觉方向设计（另案探索）；不做 Emacs keybinding（后续 change）；不做 review 整改。
- 不删除用户本地数据。

## Impact

- 影响的 specs：`vault-workspace` ADDED 一条「vault 注册表与显式重映射」（追认既有实现，并更新候选排序语义）。
- 影响的代码：`src/threads.ts`、`src/main.ts`、`src/shell.ts`、`src/ipc.ts`、`src/style.css`、`src/bindings/Thread*.ts`、`src-tauri/src/`（threads.rs 拆分为 workspaces.rs；lib.rs、commands.rs 接线；删 acp_client.rs/mcp_server.rs/cli.rs）、`tests/visual/scenes/` 相关 spec 与基线、`文案-Copy.md`、`design/`（删除）、`openspec/changes/add-editorial-design-language/`（删除）。
- 关联约束：ADR 0002 §6 性能合同不变；ADR 0006 为本 change 的裁决来源。

## 评审节点记录

- 节点 1（提案评审）：本 change 的范围与取舍已随《Lumir 定位转向执行方案》于 2026-09-12 获 Alex 批准，视为节点 1 通过。
