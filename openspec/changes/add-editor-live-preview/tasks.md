# Tasks: add-editor-live-preview

> 正常循环：实现未开始，全部任务未勾选。经 Alex 提案评审（节点 1）通过后才进入实现；附件图片显示另有跨 change 前置（见 4.2）。

## 1. 双模式与 live preview 装饰层（editor-live-preview）

- [ ] 1.1 双模式落地：md = 高亮 + 装饰层，code = 仅高亮；按文件类型选择模式（md → md，代码 → code），Compartment 热切换不重建 EditorView
- [ ] 1.2 装饰层在 `mdLivePreviewDecorations` 占位处实现：标题分级样式、加粗/斜体/删除线隐藏标记符、列表符号美化、引用块样式、代码块背景
- [ ] 1.3 装饰层构建策略按裁决点 D 的裁决结果实现（推荐视口增量 ViewPlugin）；只读口径，不做光标行 reveal
- [ ] 1.4 大文件验证：1MB Markdown 打开路径性能不回归（perf.yml 绝对阈值 <100ms）

## 2. frontmatter properties（frontmatter-properties）

- [ ] 2.1 YAML frontmatter 解析（裁决点 E：推荐 js-yaml）并渲染为 properties 键值区块，替换源码显示
- [ ] 2.2 tags 字段按标签形态展示；嵌套值以 JSON 样式展示
- [ ] 2.3 非法 YAML 回退原文显示并提示，不丢弃内容

## 3. 附件图片显示（attachment-display）

- [ ] 3.1 标准 `![alt](path)`：相对当前文件路径解析，内联渲染图片
- [ ] 3.2 `![[image.png]]`：按裁决点 F 口径（推荐 vault 内文件名唯一匹配）解析并渲染；不存在/读取失败显示占位与人话提示
- [ ] 3.3 `![[note]]` 等笔记内容嵌入不实现（ADR 0003 §2），显示为原文或不可解析提示

## 4. 提案评审（节点 1）

- [ ] 4.1 Alex 评审通过：不看代码即可裁决——裁决点 D/E/F、Non-goals、跨 change 依赖四者都答清楚
- [ ] 4.2 跨 change 前置确认：add-vault-workspace 已批准并实现 fs-io「二进制附件读取」（或 Alex 裁决两份并行、附件显示任务最后落地）

## 5. 验证

- [ ] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 5.2 用作者真实 vault 中的代表性 md 文件验收：live preview 渲染、frontmatter properties 区块、附件图片显示三者可见；perf.yml 与视觉门禁不回归
