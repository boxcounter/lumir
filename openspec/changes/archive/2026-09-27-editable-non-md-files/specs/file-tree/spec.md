# Delta: file-tree（editable-non-md-files）

> 工具链说明：同 editor-live-preview delta 首节——MODIFIED 不允许删除/更名 scenario，
> 「非 md 文本文件只读打开」随只读裁决翻转而废止，宿主 requirement 整条 REMOVED +
> 新名 ADDED。

## REMOVED Requirements

### Requirement: 点击打开文件

整条移除并由下条新名 requirement 承接：注册表同源裁决、二进制提示、目录折叠等条款
逐字保留；其 scenario「非 md 文本文件只读打开」随只读裁决翻转（editable-non-md-files）
而废止。

## ADDED Requirements

### Requirement: 点击打开文件与可编辑性裁决

点击文件树条目 SHALL 在编辑器 pane 打开对应文件。打开分类与编辑器模式裁决 SHALL 同源于扩展名注册表（`src/preview/attachments.ts` 的单一事实源）：文件树与编辑器 MUST NOT 各持一套扩展名集合（`CODE_EXTS` / `CODE_EXTENSIONS` 之类），否则差集扩展会在文件树里显示为代码、进编辑器却落到配置默认模式。Markdown 文件走编辑器 md 模式；其余非二进制文本文件（已知代码扩展、未收录扩展、dotfile、basename 无点的 `LICENSE`/`Makefile`）SHALL 以**可编辑** code 模式打开（纯文本编辑 + 语法高亮，无 live preview 装饰层）——MUST NOT 落到 md 模式或可编辑性随配置默认漂移的形态；不支持的二进制 SHALL 显示"暂不支持预览"提示而非空白或报错弹窗。目录点击 SHALL 只切换折叠状态。

#### Scenario: 不支持的二进制给出提示

- **WHEN** 用户点击一个 PDF 或可执行文件
- **THEN** 编辑器区域显示"暂不支持预览"提示

#### Scenario: 非 md 文本文件可编辑打开

- **WHEN** 用户在配置 `editor.mode = md` 下点击 `.php` / `.txt` / 未知扩展文件 / `LICENSE`（basename 无点）
- **THEN** 编辑器以可编辑 code 模式打开该文件原文：可键入、产生未保存状态，Cmd+S 与自动保存真实可达（保存链路同 md），不会出现 Cmd+S 无效的保存死态

#### Scenario: md 文件仍可编辑

- **WHEN** 用户点击一个 `.md` 文件
- **THEN** 该文件以 md 模式（可编辑 + live preview）打开，保存链路不受本 change 影响
