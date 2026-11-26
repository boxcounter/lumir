# file-tree delta（change fix-text-input-select-all-nov26）

## ADDED Requirements

### Requirement: 内联编辑输入框的全选（⌘A）

文件树的内联编辑（重命名 / 新建文件 / 新建子目录）输入框是一种**输入面**：框内已有原条目名
（重命名）或预填默认名（新建文件）时，`⌘A` SHALL 选中其中的**全部输入内容**（输入框只含主文件名，
不含 `.md` 扩展名），MUST NOT 选中编辑器正文、文件树其它行或候选列表。

接管 SHALL 由**统一键位层**按输入面完成（`selectAllAt` 落到该输入框并调用其自身的全选、
`preventDefault`），合同见 `docs/specs/text-input-faces.md`；`src/tree.ts` 的 `wireEdit` MUST NOT
另写一份本地 `case "Cmd-A"` / `input.select()`。Enter 提交、Esc 取消、失焦取消与末段名校验的口径
逐字不变；输入法组合期（`isComposing` 或 `keyCode === 229`）的 `⌘A` MUST NOT 被接管、MUST NOT
建立全选。

#### Scenario: 重命名时 ⌘A 全选原名

- **WHEN** 用户对 `plan.md` 发起重命名，把光标移到输入框末尾后按 `⌘A`，再键入 `renamed.md` 并 Enter
- **THEN** 输入框内容在键入后是 `renamed.md`（MUST NOT 变成 `plan.mdrenamed.md` 一类的追加形态）；
  提交经既有改名链路完成，编辑器正文与选区不变

#### Scenario: 新建文件时 ⌘A 重新全选预填默认名

- **WHEN** 目录菜单「新建文件…」打开内联编辑框（默认名已预选），用户把选区收成光标后按 `⌘A`
- **THEN** 预填默认名被整体选中（`selectionStart = 0`、`selectionEnd = value.length`）；
  随后键入即替换整段，Esc 取消不产生创建调用

#### Scenario: 组合期 ⌘A 不被接管

- **WHEN** 内联编辑框里的输入法组合进行中（`isComposing` 为真或 `keyCode === 229`）按下 `⌘A`
- **THEN** 该键不被消费、输入框不建立全选、编辑态保持；组合结束后的下一拍才回到本要求
