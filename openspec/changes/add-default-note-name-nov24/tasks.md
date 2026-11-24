# Tasks: add-default-note-name-nov24

> 节点 1 已由 Alex 2026-11-24 裁决「批准。」通过。实现范围以 proposal 的合同为准，不扩到模板 /
> AI / 按 vault 分类。

## 1. 配置与设置面（Rust）

- [x] 1.1 `config.rs`：`EditorConfig.prefill_note_name: bool`（默认 `false`）、`RawEditorConfig`
      的 `Option<bool>` 与 `validate()` 装配；补默认 / 显式 / 类型不符三组单测。
- [x] 1.2 `settings.rs`：`AutomationSettings` / `SettingsDefaults` / `AutomationPatch` /
      `check_automation` / `apply_automation` / `revision_of` / `in_settings_scope` 覆盖
      `editor.prefill_note_name`；补快照（默认 + 显式）、Set / Reset、revision 冲突三组单测。
- [x] 1.3 由 `cargo test` 重导出 `src/bindings/**`，把产物一并进提交。

## 2. 树侧（前端）

- [x] 2.1 `tree.ts` 导出 `uniqueNewNoteName(base, siblings)`：对最终落盘名判撞、按
      `名字 2` / `名字 3` 递增；单测覆盖空集合、连续撞号、Unicode / CJK、目录同名不误判。
- [x] 2.2 `FileTreeCallbacks` 增 `defaultNoteName?()`；`beginCreate(..., "file")` 预填并
      全选（`focus()` 后 `setSelectionRange(0, len)`）；`create-dir` 不预填。
- [x] 2.3 单测证明开关关闭时 `beginCreate` 不写 `input.value`；重命名路径不受影响。

## 3. 设置面板与装配

- [x] 3.1 `copy-data.ts` + `文案-Copy.md`：默认名（zh `未命名笔记` / en `Untitled note`）与
      第五行的标题 / 说明 / 生效时机；同步更新 D789 与自动化节元数据（含页级还原说明）的表述。
- [x] 3.2 `settings-panel.ts`：`AutomationKey` / `AUTOMATION_KEYS` / `FLAG_KEYS` /
      `automationCopy` 增第五项；`onApplied(snapshot)` 回调；单测覆盖 patch Set / Reset 与
      pageReset。
- [x] 3.3 `main.ts`：启动读数 + `createFileTree` 的 `defaultNoteName` 回调 + 设置保存后更新；
      不新增第二次 `config_get`。
- [x] 3.4 视觉桩 `tauri-stub.ts` 的 `config_get` 补 `prefill_note_name`（缺省 `false`），并
      m734 场景的快照 / 默认值补第五项。

## 4. 验收

- [x] 4.1 新增视觉场景 `default-note-name-nov24.spec.ts`：off 空输入、on 预填 + 全选、
      键入替换、Enter 落盘 + 焦点正文、Escape 不落盘、撞名递增、en 档默认名。
- [x] 4.2 新增真机验收场景 728（`scripts/acceptance/scenarios/728-default-note-name.md`）：
      合成 vault 下 `config.editor.prefill_note_name: true`，覆盖预填 / 全选后键入替换 /
      Enter 接受与正文焦点 / Escape 取消 / 撞名编号 / 自定义撞名 / 配置持久化与落盘断言。
- [x] 4.3 `docs/specs/config-reference.md` 的 `[editor]` 表补 `editor.prefill_note_name`。

## 5. 验证与提交

- [x] 5.1 相关单测（前端 `pnpm test` 定向、Rust 定向）与 `scripts/gate.sh quick` 全绿。
- [ ] 5.2 本地完整视觉门禁 `scripts/gate.sh visual`（隔离端口）通过；**不更新任何像素基线**
      （基线变更是 Alex 的人肉裁决点）。
      现状：功能断言全过；设置面板新增第五行使 `m734-settings-panel` 的 10 张元素像素基线出现
      约 1% 差异，候选截图登记在报告里，**等 Alex 裁决后另行更新基线**（本 change 不含 --update）。
- [x] 5.3 `openspec validate --all --strict`、`scripts/docs-check.sh`、
      `node scripts/acceptance/coverage.mjs --check`、`node scripts/acceptance/run.mjs --check`、
      以及 gate 内的 tsc / 语法静态项全部通过。
- [x] 5.4 提交实现（不含归档）；真机场景 728 在真机窗口执行，证据落 `.local/acceptance/`。
      r3：`2026-11-24-default-note-name-r3`，**1/1 PASS / 41 断言**（启动 5.5s / 就绪 2.5s /
      场景 24.0s；off 空占位、on 预填全选、键入替换、Enter 正文焦点、Escape、撞名递增、自定义
      撞名、配置持久化全部 PASS；两处空文件判据为 `file.exact: ""`，steps.md 写明
      `0 字符逐字一致`）。r2 先在 test-only `do: scroll` 修可见性后 PASS；r1 的失败是场景
      可见性问题（目录段在视口上方），未改产品代码与断言。
