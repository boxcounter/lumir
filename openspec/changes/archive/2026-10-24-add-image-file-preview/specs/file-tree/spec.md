# file-tree 增量规格

> 起草注记（非规格正文）：本 delta 一条 MODIFIED，基线是 living spec
> [openspec/specs/file-tree/spec.md](../../../../../specs/file-tree/spec.md)。改动面只有一处：**图片文件**的
> 点击落点从「暂不支持预览提示」改为「在 content pane 里打开图片查看面」；其余二进制、md、非 md
> 文本的打开分类与可编辑性裁决逐字不变。图片查看面的能力条款在 `attachment-display` 的增量里，
> 形态与技术方案见 [design.md](../../design.md)。

## MODIFIED Requirements

### Requirement: 点击打开文件与可编辑性裁决

点击文件树条目 SHALL 在编辑器 pane 打开对应文件。打开分类与编辑器模式裁决 SHALL 同源于扩展名注册表（`src/preview/attachments.ts` 的单一事实源）：文件树与编辑器 MUST NOT 各持一套扩展名集合（`CODE_EXTS` / `CODE_EXTENSIONS` 之类），否则差集扩展会在文件树里显示为代码、进编辑器却落到配置默认模式。Markdown 文件走编辑器 md 模式；其余非二进制文本文件（已知代码扩展、未收录扩展、dotfile、basename 无点的 `LICENSE`/`Makefile`）SHALL 以**可编辑** code 模式打开（纯文本编辑 + 语法高亮，无 live preview 装饰层）——MUST NOT 落到 md 模式或可编辑性随配置默认漂移的形态；**图片文件**（注册表 image 分类，含 `svg`）SHALL 在内容区打开**图片查看面**（能力条款见 `attachment-display` 的「独立查看 vault 图片文件」），MUST NOT 再落到"暂不支持预览"提示；图片以外的二进制 SHALL 显示"暂不支持预览"提示而非空白或报错弹窗。目录点击 SHALL 只切换折叠状态。

#### Scenario: 不支持的二进制给出提示

- **WHEN** 用户点击一个 PDF 或可执行文件
- **THEN** 编辑器区域显示"暂不支持预览"提示

#### Scenario: 图片文件打开图片查看面

- **WHEN** 用户点击一个 `png` / `jpg` / `svg` 等注册表 image 分类的文件
- **THEN** 内容区显示该图片的查看面（图片在可视区内完整可见、不被拉伸），MUST NOT 出现"暂不支持预览"
  提示；该文件 MUST NOT 被当作可编辑文本装载

#### Scenario: 非 md 文本文件可编辑打开

- **WHEN** 用户在配置 `editor.mode = md` 下点击 `.php` / `.txt` / 未知扩展文件 / `LICENSE`（basename 无点）
- **THEN** 编辑器以可编辑 code 模式打开该文件原文：可键入、产生未保存状态，Cmd+S 真实可达（保存链路同 md），不会出现 Cmd+S 无效的保存死态

#### Scenario: md 文件仍可编辑

- **WHEN** 用户点击一个 `.md` 文件
- **THEN** 该文件以 md 模式（可编辑 + live preview）打开，保存链路不受本 change 影响

