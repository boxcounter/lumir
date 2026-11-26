# quick-open delta（change fix-text-input-select-all-nov26）

## MODIFIED Requirements

### Requirement: 输入面内的全选（⌘A）

输入面（本浮层的筛选框，以及任何原生文本输入宿主）持焦时，`⌘A` SHALL 全选该输入面的**全部输入内容**
（选中的是输入串本身，不是编辑器文档，也不是候选列表），且 MUST NOT 被编辑器命令或全局命令截走。
实现 SHALL 由**统一键位层**显式接管该键（change fix-text-input-select-all-nov26：`selectAllAt` 落到
当前输入面、选中其全部内容并 `preventDefault`），浮层 MUST NOT 再保留本地的 `input.select()` 副本；
MUST NOT 依赖 webview / 原生 Select All 菜单的默认行为——M627 起原生菜单的预置 Select All 已让出
`⌘A` 加速键，是否送达 input 不在本仓的合同内。合同本体见 `docs/specs/text-input-faces.md`。

其余文本编辑键（复制 / 剪切 / 粘贴 / 撤销 / 重做 / 移动 / 删除）SHALL 继续由原生输入框路径处理，
输入面 MUST NOT 拦截它们；输入法组合期间 `⌘A` 仍归输入法 / 原生路径（MUST NOT 在组合期接管）。
输入面关闭后，编辑器内的 `⌘A` SHALL 保持既有的全选文档语义（`editor.select-all`，键位与作用域
不变）。

#### Scenario: 输入框内 ⌘A 全选输入串

- **WHEN** 输入面打开、输入框里已有 `notes/plan.md`，用户按 `⌘A` 后键入 `x`
- **THEN** 输入框的内容变成 `x`（整串被替换，MUST NOT 变成 `notes/plan.mdxx` 一类的追加形态），
  编辑器文档与候选列表都不因这次全选被改动

#### Scenario: 编辑器内的 ⌘A 不回归

- **WHEN** 输入面关闭、焦点在编辑器内容区，用户按 `⌘A`
- **THEN** 选中的是整篇文档（既有 `editor.select-all` 语义逐字不变）
