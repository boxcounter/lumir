# attachment-display Specification

## Purpose

定义 md 文档内附件图片的内联显示（ADR 0003 §1 兼容范围）：Obsidian 方言 `![[image.png]]` 与标准 `![alt](path)` 两种语法、路径解析口径（唯一匹配 + 歧义确定性）、失败占位人话提示；内容嵌入（transclusion）明确不做（ADR 0003 §2）。字节来源为 fs-io「二进制附件读取」。由 change `add-editor-live-preview` 归档并入（2026-09-05，实现 M19 + M20 接线；完整短路径语义留 wikilink spec 冻结裁决）。

## Requirements

### Requirement: 附件图片内联显示

md 文档中的图片引用 SHALL 在文档内对应位置内联渲染图片，覆盖两种语法（ADR 0003 §1）：Obsidian 方言 `![[image.png]]` 与标准 Markdown `![alt](path)`。图片字节来源 SHALL 为 add-vault-workspace 的 fs-io「二进制附件读取」能力（跨 change 依赖，proposal 已显式声明）；webview MUST NOT 直接访问文件系统（ADR 0002 §3）。附件读取的接口形态（invoke+base64 / asset protocol）以 add-vault-workspace 裁决点 A 的裁决为准，本 capability 对两种形态 SHALL 均可适配。

#### Scenario: 两种语法均渲染

- **WHEN** 文档同时含 `![[photo.png]]` 与 `![截图](./assets/shot.png)`，且两附件存在
- **THEN** 两张图片在文档内对应位置内联显示

### Requirement: 附件路径解析口径

标准 md 图片路径 SHALL 按相对当前文件路径解析（解析不到时允许回退相对 vault 根）。`![[...]]` 不带目录前缀时 SHALL 按 vault 内文件名唯一匹配解析（⚠ 裁决点 F，推荐口径）：全 vault 恰有一个同名附件时解析成功；存在同名歧义时按确定性顺序取第一个，MUST NOT 随机或按修改时间选择。完整 Obsidian 短路径语义 MUST NOT 在本 change 实现——属于 wikilink spec 冻结范围（ADR 0003 §4），由 wikilink change 统一裁决。

#### Scenario: 唯一匹配解析

- **WHEN** `![[photo.png]]` 且 vault 内仅 `attachments/photo.png` 一个同名文件
- **THEN** 图片解析到该路径并显示

#### Scenario: 同名歧义确定性

- **WHEN** vault 内两个目录各有一个 `photo.png`
- **THEN** 按确定性顺序（如路径字典序）取第一个显示；同一 vault 两次打开显示同一结果

### Requirement: 解析或读取失败的占位

附件不存在、路径解析失败或读取返回错误时，系统 SHALL 在引用位置显示占位块与人话提示（含原始引用文本），MUST NOT 显示破图图标、抛错弹窗或阻断文档其余渲染。

#### Scenario: 附件缺失占位

- **WHEN** `![[missing.png]]` 指向的附件不存在
- **THEN** 该位置显示占位块，提示附件未找到并保留原始引用文本

### Requirement: 内容嵌入不做

`![[note]]`、`![[note#heading]]` 等指向笔记内容的嵌入（transclusion）MUST NOT 实现递归渲染（ADR 0003 §2 明确不做）。`![[...]]` 解析结果指向非附件（笔记）时 SHALL 按「解析或读取失败的占位」口径显示原文与"内容嵌入不支持"提示。

#### Scenario: 笔记嵌入不渲染

- **WHEN** 文档含 `![[another-note]]`
- **THEN** 显示原文与"内容嵌入不支持"提示，不递归渲染该笔记
