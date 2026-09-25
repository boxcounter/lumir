# Delta: editor-live-preview（editable-non-md-files）

> 工具链说明：openspec 的 MODIFIED 不允许删除/更名 scenario（archive 拒丢），同名
> REMOVED+ADDED 亦被拒。行为翻转的 scenario「非 md 文本文件只读打开」只能随其宿主
> requirement 整条 REMOVED + 新名 ADDED。living spec 他处对旧名「单内核双模式落地」的
> 引用（同 spec「代码文件的结构解析」「双击标识符高亮同一变量」等）在归档时改指新名，
> 见 tasks §6.4。

## REMOVED Requirements

### Requirement: 单内核双模式落地

整条移除并由下条新名 requirement 承接：模式裁决语义（按扩展名注册表选模式、MUST NOT
回落配置默认）逐字保留；其 scenario「非 md 文本文件只读打开」随 M130 只读裁决的翻转
（editable-non-md-files）而废止。

## ADDED Requirements

### Requirement: 单内核双模式与可编辑性落地

编辑器 SHALL 保持单一 CM6 内核、两种模式（ADR 0002 §2）：md 模式 = 语法高亮 + live preview 装饰层；code 模式 = 仅语法高亮（纯文本形态，无装饰层）。模式切换 SHALL 经既有 Compartment 热切换完成，MUST NOT 重建 EditorView、MUST NOT 丢失文档状态。打开文件时 SHALL 按扩展名注册表（`src/preview/attachments.ts` 的单一事实源）选择模式：`.md`/`.markdown` 用 md 模式；**其余一切已打开的文件一律用 code 模式**（含未收录扩展、dotfile 与 basename 无点的文件）——有语言包则高亮、无则纯文本；只有没有文件上下文（path 缺失）的文档才回落配置 `editor.mode`。

可编辑性 SHALL 按文件类裁决（editable-non-md-files，M130「非 md 即只读」的只读部分自此翻转，模式裁决语义保留）：md 模式恒可编辑；code 模式对注册表文本类（`fileClass` 为 `code` 或 `text`）文件**可编辑**——纯文本编辑 + 语法高亮，undo/redo、dirty、保存链路与 md 同口径；image/binary 类 MUST NOT 进入编辑器（分流与提示见 file-tree spec）。code 模式 MUST NOT 引入 live preview 装饰层。初始模式由配置 `editor.mode` 决定（既有接线保留）。

#### Scenario: 按文件类型选模式

- **WHEN** 用户在文件树点击一个 `.rs` 文件后又点击一个 `.md` 文件
- **THEN** 前者以 code 模式（仅高亮）打开，后者以 md 模式（高亮 + 装饰层）打开，切换不重建编辑器视图

#### Scenario: 非 md 文本文件可编辑打开

- **WHEN** 用户在配置 `editor.mode = md`（出厂值）下点击一个 `.php`、`.svelte`、`.txt`、未知扩展文件，或 `LICENSE`/`Makefile` 这类 basename 无点的文件
- **THEN** 该文件以可编辑 code 模式打开：视图层可编辑（`contenteditable` 在场、无 `aria-readonly` 只读态），键入/撤销生效并产生 dirty，Cmd+S 进入保存链路；无语言包时按纯文本显示原文

## MODIFIED Requirements

### Requirement: 模式配置来源

初始编辑器模式 SHALL 来自配置 `editor.mode`（config.rs 既有字段，ts-rs 导出）；该配置 SHALL 只作用于没有文件上下文的文档（空态 / 新建 / reset）。打开文件时的模式 SHALL 由扩展名注册表唯一裁决：`.md`/`.markdown` → md 模式；其余一切已打开的文件（含未收录扩展、dotfile 与 basename 无点的文件）→ code 模式，**MUST NOT 回落 `editor.mode`**。该裁决 MUST NOT 随 `editor.mode` 的取值漂移：把配置在 `md` 与 `code` 之间切换不改变任何已打开文件的模式。

#### Scenario: 配置默认与文件类型优先

- **WHEN** `editor.mode = code` 且用户打开 `.md` 文件
- **THEN** 该文件仍以 md 模式打开（可编辑 + live preview）；配置值只对空态 / 新建文档生效

#### Scenario: 未收录扩展不回落配置默认

- **WHEN** `editor.mode = md` 且用户打开 `.log`、`.csv` 或 `.xyz` 这类未收录扩展的文件
- **THEN** 文件以 code 模式打开（可编辑；无语言包时按纯文本显示原文），MUST NOT 进入 md 模式或套用其装饰层

#### Scenario: 无扩展名文件一并不回落配置默认

- **WHEN** 用户打开 basename 无点的文件（如 `LICENSE`、`Makefile`）
- **THEN** 文件以 code 模式打开（可编辑），MUST NOT 按 `editor.mode` 进入 md 模式（M130 评审裁决的模式语义保留：非 md 不走 md 模式；editable-non-md-files 解除的只是只读）
