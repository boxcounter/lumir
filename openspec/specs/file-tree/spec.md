# file-tree Specification

## Purpose

定义 app-shell `fileTree` pane 的文件树行为：全类型条目展示与折叠、点击打开文件（按文件类型选编辑器模式）、watch 驱动的增量刷新（不丢展开状态）、未打开 vault 空态。由 change `add-vault-workspace` 归档并入（2026-09-05，实现 M18 + M20 接线与 defaultMode 修复）。

## Requirements

### Requirement: 全类型文件树展示

系统 SHALL 在 app-shell 的 `fileTree` pane 挂载文件树，展示当前 vault 的全类型条目（目录可折叠，默认排序：目录在前、同缀按名称）。条目 SHALL 显示文件名与类型区分（至少区分目录 / Markdown / 图片等可预览附件 / 其他）。树的数据来源 SHALL 为 fs-io 的枚举结果与 watch 增量事件，webview MUST NOT 直接访问文件系统（ADR 0002 §3）。

#### Scenario: 全类型混合展示

- **WHEN** vault 含 md、代码、图片、嵌套目录
- **THEN** 文件树全部展示并正确区分类型，不只展示 Markdown

### Requirement: 点击打开文件

点击文件树条目 SHALL 在编辑器 pane 打开对应文件。打开分类与编辑器模式裁决 SHALL 同源于扩展名注册表（`src/preview/attachments.ts` 的单一事实源）：文件树与编辑器 MUST NOT 各持一套扩展名集合（`CODE_EXTS` / `CODE_EXTENSIONS` 之类），否则差集扩展会在文件树里显示为代码、进编辑器却落到配置默认模式。Markdown 文件走编辑器 md 模式；其余非二进制文本文件（已知代码扩展、未收录扩展、dotfile、basename 无点的 `LICENSE`/`Makefile`）SHALL 以只读 code 模式打开——MUST NOT 落到可编辑的配置默认模式；不支持的二进制 SHALL 显示"暂不支持预览"提示而非空白或报错弹窗。目录点击 SHALL 只切换折叠状态。

#### Scenario: 不支持的二进制给出提示

- **WHEN** 用户点击一个 PDF 或可执行文件
- **THEN** 编辑器区域显示"暂不支持预览"提示

#### Scenario: 非 md 文本文件只读打开

- **WHEN** 用户在配置 `editor.mode = md` 下点击 `.php` / `.txt` / 未知扩展文件 / `LICENSE`（basename 无点）
- **THEN** 编辑器以只读 code 模式打开该文件原文，不可编辑、不产生未保存状态，也不会出现 Cmd+S 无效的保存死态

#### Scenario: md 文件仍可编辑

- **WHEN** 用户点击一个 `.md` 文件
- **THEN** 该文件以 md 模式（可编辑 + live preview）打开，保存链路不受本 change 影响

### Requirement: watch 驱动的增量刷新

文件树 SHALL 消费 `fs:entry_changed` 增量事件对树做局部更新（新增节点、删除节点、更新条目），MUST NOT 在每次事件后全量重扫重绘。刷新 SHALL 保持用户的折叠/展开状态不丢失。

#### Scenario: 增量刷新保持展开状态

- **WHEN** 用户已展开若干目录，外部在 vault 内新建一个文件
- **THEN** 新文件出现在对应位置，既有目录的展开状态不变

### Requirement: 未打开 vault 空态

无打开的 vault 时，文件树 pane SHALL 显示空态与"打开 vault"入口；触发入口 SHALL 调 `vault_open`。`last_vault` 恢复失败时 SHALL 在空态上展示对应人话提示。

#### Scenario: 空态打开入口

- **WHEN** 应用启动且无可用 `last_vault`
- **THEN** 文件树 pane 显示空态与打开入口，点击入口弹出目录选择器
