# Tasks: add-default-note-name-nov24

> 节点 1：Alex 2026-11-24 裁决「批准。」；2026-11-25 新决定「去掉它吧，也就是默认文件名不需要
> 设置项，默认就是这个行为。」本 change 按新决定改为**始终启用**，不设开关、不保留配置面。

## 1. 树侧行为

- [x] 1.1 `tree.ts` 导出 `uniqueNewNoteName(base, siblings)`：对最终落盘名判撞、按
      `名字 2` / `名字 3` 递增；单测覆盖空集合、连续撞号、缺口、Unicode / CJK、目录同名不误判。
- [x] 1.2 `beginCreate(..., "file")` 始终预填 `t("D988")` 并全选（`focus()` 后
      `setSelectionRange(0, len)`）；`create-dir` 不预填；提交路径只 trim + 补 `.md`。
- [x] 1.3 移除初稿的 `defaultNoteName` 回调与 `main.ts` 的运行期读数，行为只在树的一处实现。

## 2. 删除配置与设置面

- [x] 2.1 `config.rs`：删除 `EditorConfig.prefill_note_name` / `RawEditorConfig` 字段 /
      `validate()` 装配与三组测试。
- [x] 2.2 `settings.rs`：删除 `AutomationSettings` / `SettingsDefaults` / `AutomationPatch` /
      `check_automation` / `apply_automation` / `revision_of` / `in_settings_scope` 的对应暴露、
      三组测试与 `apply_editor_flag`。
- [x] 2.3 `settings-panel.ts`：删除第五个 `AutomationKey`、C 文案键、`FLAG_KEYS` 项、`onApplied`
      回调与 `automationScoped` 的 editor 分支；`createDraft` 恢复四开关手写副本；设置页保持
      四开关原样。
- [x] 2.4 `copy-data.ts` / `文案-Copy.md`：保留 D988；删除 D985–D987；D789、自动化节元数据与
      D831 恢复「四个开关」准确表述；D988 说明改为「始终预填」。
- [x] 2.5 由 `cargo test` 重导出 `src/bindings/**`（不含 `prefill_note_name`）。

## 3. 测试

- [x] 3.1 `tests/unit/default-note-name.test.ts` 保留纯逻辑与 D988 zh/en 文案断言。
- [x] 3.2 `tests/unit/settings-panel.test.ts` 恢复四开关 fixture / pageReset；删除第五开关
      的 patch 测试。
- [x] 3.3 视觉场景 `default-note-name-nov24.spec.ts`：始终预填 + 全选、键入替换、Tab 失焦取消、
      Enter 落盘 + 正文焦点、撞名递增、en 默认名、新建子目录 / 重命名不受影响；无 off 测试。
- [x] 3.4 验收工具自测补 `file.exact: ""` 的正向 / 反向用例（空文件 PASS；先空后非空 FAIL）。

## 4. OpenSpec 与验收

- [x] 4.1 删除 `specs/settings/spec.md`（本 change 不再改 settings）；`file-tree` delta 改为
      始终启用、无配置键、无 off 路径。
- [x] 4.2 更新 proposal / design：记录 Alex 2026-11-25 决定；说明不设开关、旧键不迁移。
- [x] 4.3 重写真机场景 734：无 `config:`、无设置面板步骤；始终预填及全选、替换、接受、Esc、
      撞名、自定义撞名、正文焦点。`COVERAGE.md` 重新生成。
- [x] 4.4 真机 734 串行复跑：**1/1 PASS / 28 断言**（启动 3.5s / 就绪 1.8s / 场景 18.7s；
      `exact: ""` 两处均 `0 字符逐字一致`），证据落
      `.local/acceptance/2026-11-25-default-note-name-734/`。

## 5. 验证与提交

- [x] 5.1 相关单测、`scripts/gate.sh quick`、`openspec validate --all --strict`、
      `scripts/docs-check.sh`、`git diff` 审阅全绿。quick：`GATE RESULT: 13/13 PASS（SKIP 0）`；
      validate：40 passed / 0 failed；docs-check PASS。
- [x] 5.2 完整视觉套件（隔离端口 4281）：`GATE PASS visual-regression 910s`；`gate.sh visual`
      当时汇总 `GATE RESULT: 14/15 PASS（SKIP 0）`，唯一 FAIL 是 `bindings-drift` 的「重导出
      未 staged」提示（非测试失败），staging 后 quick 中该项 PASS。设置面板 43/43（含原 10 张
      元素基线），**无任何像素基线差异，未更新基线，不需要基线批准**。
- [x] 5.3 提交新 tip（不含归档）；不更新基线。
