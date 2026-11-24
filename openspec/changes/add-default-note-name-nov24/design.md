# Design: add-default-note-name-nov24

## 1. 数据流（唯一真源）

```
config.json [editor].prefill_note_name
  ├─► ConfigSnapshot.config.editor.prefill_note_name ─► src/main.ts 启动读数
  └─► SettingsSnapshot.automation.prefill_note_name ─► 设置面板开关行
        （保存走 SettingsPatch.automation.prefill_note_name）
```

- 配置面的类型与默认值只在 `config.rs` 的 `EditorConfig`（`false`）；`RawEditorConfig` 用
  `Option<bool>` 承接缺席，类型不符沿用既有「整文件回落」模型，不发明逐字段容忍。
- 设置面快照 / patch 的字段名与键名同名（`prefill_note_name`），前端不复制默认值：开关行
  的「默认」徽标与「恢复默认」都消费快照的 `automation.*.explicit`。
- 前端运行期读数只有 `src/main.ts` 的一个模块级变量（启动时从 `ConfigSnapshot` 取，保存成功后
  从 `SettingsSnapshot` 更新）；树通过回调读取，不 import ipc、不自行读配置。

## 2. 树侧（src/tree.ts）

- `FileTreeCallbacks` 新增可选回调 `defaultNoteName?(): string | undefined`。返回 `undefined`
  表示不预填（开关关闭）；返回非空串表示默认名基础（已按当前语言取值）。
- `beginCreate(parentRel, "file")`：算出同级条目集合后，若回调给出基础名，调用导出纯函数
  `uniqueNewNoteName(base, siblings)` 得到不撞名的候选（对 `withDefaultFileExtension` 之后的
  最终名判），写入 `input.value`，`focus()` 后 `setSelectionRange(0, value.length)` 全选。
  `create-dir` 分支不预填。
- 输入值本身不含 `.md`，因此「只选主文件名、不选 `.md`」是结构性的，不靠字符串裁剪。
- `Escape` / `Enter` / 失焦沿用既有 `wireEdit` 处理；`Tab` 不接管。
- 自动递增只在 `uniqueNewNoteName` 内发生，提交路径（`submitEdit`）不改名字。

## 3. 设置面板与主装配

- `AutomationKey` / `AUTOMATION_KEYS` 增第五项 `prefill_note_name`，追加在列表末尾（既有行
  位置不变，最小化像素面变动）。文案三条（标题 / 说明 / 生效时机）走 `文案-Copy.md` 与
  `copy-data.ts` 的新 D 编号。
- `FLAG_KEYS` 映射到 `SettingsDefaults.prefill_note_name`；`buildPatch` / `pageResetDraft` /
  「恢复默认」都按现有通用循环自动覆盖。
- `SettingsPanelDeps` 增可选 `onApplied(snapshot)`：保存成功（`status=applied`）后回传快照；
  `main.ts` 用它更新模块级读数，避免再发一次 `config_get`，也不引入全局配置状态层。

## 4. 边界

- **惰性目录**：`siblingNames` 只有已加载的子条目；不可见的既有文件不参与自动编号。撞上时
  后端 `fs_already_exists` 拒绝、行内回显，用户改名；不为这个边界引入异步目录枚举。
- **语言**：默认名用既有 `t()`（真源 `<html lang>`），切语言后下一次新建自然取新语言。
- **其它创建链路**：wikilink 一键创建不经过 `beginCreate`；未命名内存文档没有 `create-file`
  编辑；重命名有既有的「原名预填 + 全选」口径，均不受本 change 影响。
- **不新增** provider / AI 调用 / 模板设置；默认名不写进文档正文。
