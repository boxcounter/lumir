## MODIFIED Requirements

### Requirement: 单内核双模式落地

编辑器 SHALL 保持单一 CM6 内核、两种模式（ADR 0002 §2）：md 模式 = 语法高亮 + live preview 装饰层；code 模式 = 仅语法高亮。模式切换 SHALL 经既有 Compartment 热切换完成，MUST NOT 重建 EditorView、MUST NOT 丢失文档状态。打开文件时 SHALL 按扩展名注册表（`src/preview/attachments.ts` 的单一事实源）选择模式：`.md`/`.markdown` 用 md 模式；其余有扩展名线索的文件（含未收录扩展）一律用只读 code 模式——有语言包则高亮、无则纯文本；只有无扩展名线索（未打开文件，或 basename 无点如 `LICENSE`）才回落配置 `editor.mode`。md 模式之外编辑器 MUST NOT 可编辑（`editable(false)` + `readOnly(true)` 的视图层只读合同）。初始模式由配置 `editor.mode` 决定（既有接线保留）。

#### Scenario: 按文件类型选模式

- **WHEN** 用户在文件树点击一个 `.rs` 文件后又点击一个 `.md` 文件
- **THEN** 前者以 code 模式（仅高亮）打开，后者以 md 模式（高亮 + 装饰层）打开，切换不重建编辑器视图

#### Scenario: 非 md 文本文件只读打开

- **WHEN** 用户在配置 `editor.mode = md`（出厂值）下点击一个 `.php`、`.svelte`、`.txt` 或未知扩展文件
- **THEN** 该文件以只读 code 模式打开：视图层不可编辑（`contenteditable` 摘除、`aria-readonly`），输入被拒收，不产生 dirty，后续 Cmd+S 不进入保存链路

### Requirement: 模式配置来源

初始编辑器模式 SHALL 来自配置 `editor.mode`（config.rs 既有字段，ts-rs 导出）；文件类型对模式的选择 SHALL 优先于配置默认值作用于每次打开。打开文件时的模式 SHALL 由扩展名注册表唯一裁决：`.md`/`.markdown` → md 模式；其余一切有扩展名线索的文件（含未收录扩展与 dotfile）→ 只读 code 模式，**MUST NOT 回落 `editor.mode`**；仅当文件没有扩展名线索（未打开文件 / path 缺失，或 basename 无点）时才使用 `editor.mode` 作默认。该裁决 MUST NOT 随 `editor.mode` 的取值漂移：把配置改成 `code` 不改变任何有扩展名线索文件的模式（它们已一律只读打开）。

#### Scenario: 配置默认与文件类型优先

- **WHEN** `editor.mode = code` 且用户打开 `.md` 文件
- **THEN** 该文件仍以 md 模式打开；配置值仅作为无类型线索时的默认

#### Scenario: 未收录扩展不回落配置默认

- **WHEN** `editor.mode = md` 且用户打开 `.log`、`.csv` 或 `.xyz` 这类未收录扩展的文件
- **THEN** 文件以只读 code 模式打开（无语言包时按纯文本显示原文），MUST NOT 进入可编辑 md 模式，不产生 dirty

#### Scenario: 无扩展名线索回落配置默认

- **WHEN** 用户打开 basename 无点的文件（如 `LICENSE`）
- **THEN** 按配置 `editor.mode` 打开（本 change 不改这一边界）；若它因此进入可编辑模式而该文档不可保存，Cmd+S SHALL 给出可见反馈（见 fs-io「不可保存文档的保存反馈」），MUST NOT 静默无反应
