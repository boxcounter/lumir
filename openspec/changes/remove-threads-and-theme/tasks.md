# Tasks

## 删除 Thread 特性

- [x] 删 `src/threads.ts` 及 `main.ts` / `shell.ts` / `ipc.ts` / `style.css` 全部 thread 接线
- [x] 删 `src/bindings/Thread.ts` / `ThreadFile.ts` / `ThreadStatus.ts`
- [x] `threads.rs` 拆分为 `workspaces.rs`（保留 vault 注册表逻辑），删五个 `thread_*` command 与 Thread 类型；`lib.rs` / `commands.rs` 接线更新
- [x] `remap_candidates` 排序简化为按稳定 id（移除 thread 活跃度数据源）
- [x] 删空壳模块 `acp_client.rs` / `mcp_server.rs` / `cli.rs` 及 lib.rs 声明
- [x] 视觉测试 `tauri-stub.ts` 与 `parity*` / `app-main` 场景移除 thread
- [x] `文案-Copy.md` 删 D2、D8–D18、D27–D29

## 三主题收敛为排版基线

- [x] `style.css` 删 `[data-theme="dark"]` / `[data-theme="eink"]` 全部规则与 callout 多主题色板；`:root` 基线保留
- [x] `main.ts` 删主题切换快捷键与 `lumir-theme` localStorage
- [x] `mermaid.ts` 主题维度收敛为固定默认配置
- [x] 删 `design/` 目录
- [ ] 视觉测试收敛单主题并更新基线截图

## 作废旧 change

- [x] 删 `openspec/changes/add-editorial-design-language/`

## 验证与门禁

- [x] `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] `pnpm build` 与 `cargo test`（src-tauri）通过
- [ ] `LUMIR_VISUAL_PORT=4273` 视觉测试单主题基线通过
- [ ] `pnpm dev:app` 冒烟：开 vault、编辑保存、wikilink 跳转、无 console 报错
