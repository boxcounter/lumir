## MODIFIED Requirements

### Requirement: 点击打开文件

点击文件树条目 SHALL 在编辑器 pane 打开对应文件。打开分类与编辑器模式裁决 SHALL 同源于扩展名注册表（`src/preview/attachments.ts` 的单一事实源）：文件树与编辑器 MUST NOT 各持一套扩展名集合（`CODE_EXTS` / `CODE_EXTENSIONS` 之类），否则差集扩展会在文件树里显示为代码、进编辑器却落到配置默认模式。Markdown 文件走编辑器 md 模式；其余非二进制文本文件（已知代码扩展、未收录扩展、dotfile）SHALL 以只读 code 模式打开——未知扩展与无扩展名文本同样只读显示原文，MUST NOT 落到可编辑的配置默认模式；不支持的二进制 SHALL 显示"暂不支持预览"提示而非空白或报错弹窗。目录点击 SHALL 只切换折叠状态。

#### Scenario: 不支持的二进制给出提示

- **WHEN** 用户点击一个 PDF 或可执行文件
- **THEN** 编辑器区域显示"暂不支持预览"提示

#### Scenario: 非 md 文本文件只读打开

- **WHEN** 用户在配置 `editor.mode = md` 下点击 `.php` / `.txt` / 未知扩展文件
- **THEN** 编辑器以只读 code 模式打开该文件原文，不可编辑、不产生未保存状态，也不会出现 Cmd+S 无效的保存死态

#### Scenario: md 文件仍可编辑

- **WHEN** 用户点击一个 `.md` 文件
- **THEN** 该文件以 md 模式（可编辑 + live preview）打开，保存链路不受本 change 影响
