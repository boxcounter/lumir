# Tasks: list-tab-indent

实现顺序：键位层登记 → 命令实现 → 单测 → 真机验收 → 收口。每条完成后就地勾选；
跑不动的项写「未验」并附原因，MUST NOT 写成已验（REVIEW.md 第 6 条）。

**口径基线（Alex 节点 1 裁决，2026-09-26，原话逐字）**：「D1：a. 绑给列表缩进（editor 作用域）；
D2: c. 缩进后重排有序列表源码编号；D3: a. 无操作；D4: a. 无操作（吞掉）；D5: a. 只作用 head
所在项」。**D2 = c 推翻了本稿的推荐项 a**（「每层 2 空格、只动行首空白、编号不重排」）：
缩进 / 凸排后有序列表的源码编号要**按新归属重排为规范序号**。本稿凡涉及写回口径的条目与
`design.md` §3、`specs/keymap-commands/spec.md` 的对应句均按本裁决改写（实现期发现口径偏差的
处理：**先改 spec/tasks 再写代码**，见 4.1）；`proposal.md` 的「待 Alex 裁决」节保留选项与
理由，裁决结果见该节末的「裁决结果（2026-09-26）」段。

## 1. 键位层登记（src/keys.ts）

- [ ] 1.1 `EDITOR_CORE_COMMAND_IDS` 增 `editor.list-indent` / `editor.list-outdent`
      （`src/keys.ts` 顶部清单；编辑器内核组，scope 随组派生为 editor）
- [ ] 1.2 `KEY_BINDINGS` 增 `Tab` → `editor.list-indent`、`Shift-Tab` → `editor.list-outdent`
      （scope editor）；doc 写清冲突核对：表内无 `Tab` / `Shift-Tab` token（`Ctrl-Tab` /
      `Ctrl-Shift-Tab` 归一化后是不同 token）、应用无补全扩展、CM 无 indentWithTab、
      原生焦点遍历被接管是 D1 知情接受的代价
- [ ] 1.3 `tests/unit/keys.test.ts` 既有不变量（无重复绑定 / 无孤儿命令 / KEYLESS 对账）
      对新条目自动生效；确认绿，不为新条目新写表级断言（既有断言已覆盖）

## 2. 命令实现（src/editor.ts）

- [ ] 2.1 纯函数 `listIndentChange(state, dir: "indent" | "outdent")`：按 design §2 状态机
      判定归属（`syntaxTree` + `resolveInner` 取最内 ListItem），按 §3 写回规则产出
      changes（或 null = no-op）；形态比照 `src/cell-geometry.ts` 的纯函数先例，
      headless 可测
- [ ] 2.2 runner 装配进 `commands` 记录：readOnly 提前返回；单次 dispatch 带
      `userEvent: "input.indent"` / `"input.outdent"`；选区交给 CM change mapping，
      不显式重设
- [ ] 2.3 引用内列表的插入 / 删除点在最内层 `>` 前缀之后（逻辑参照
      `src/preview/lists.ts:310-324` 的「跳过连续 `>` 与空格」）

## 3. 单测（tests/unit/）

- [ ] 3.1 新文件 `tests/unit/list-indent.test.ts`，真 EditorState + markdown 语言解析
      （先例 = `tests/unit/cell-geometry.test.ts`：真 EditorState + 真 markdown 解析器，
      文件头有该做法的记录）：
      indent 一层（无序项首行 + 续行 + 子树同一 delta 平移；无序列表 delta = 2）、
      outdent 一层、嵌套列表只动归属项
- [ ] 3.2 边界：顶层项 outdent = null（no-op）；**无上一同级项**（列表第一项）indent = null
      （无可嵌套目标，且写入会制造不可见空白 diff——D4c 的同一理由）；非列表行 / 代码块内 = null；
      行首空白不足一层步长的行宽容移除；行首 tab 读取宽容、写入只写空格
- [ ] 3.3 引用内列表：`> - a` indent 后 `>   - a`（`>` 后 2 空格），嵌套引用同口径
- [ ] 3.4 有序列表缩进 / 凸排后源码编号按新归属重排为规范序号（D2c）：被平移的有序项编号 = 它
      在新分组内的序号（`1. x` / `2. y` 的 `2. y` 缩进成子项后写回 `1.`）、其原分组中序号随之
      变化的兄弟项一并改写（`1. a` / `2. b` / `3. c` / `4. d` 缩进 `3. c` 后 `4. d` → `3. d`）；
      任务标记 `[ ]` / `[x]` 与标记字符逐字节不变
- [ ] 3.5 撤销集成：dispatch 后一次 `undo` 还原整次平移（含子树），dirty 随之收窄
- [ ] 3.6 `node tests/unit/run.mjs` 全绿（含既有计数）

## 4. spec 增量归档准备

- [ ] 4.1 `specs/keymap-commands/spec.md` 的 ADDED requirement 与最终实现逐句对账
      （实现期发现口径偏差时先改 spec 再写代码，不反向漂移）

## 5. 门禁

- [ ] 5.1 `bash scripts/gate.sh quick` 全绿，输出留档 `test-results/m239/`
- [ ] 5.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过

## 6. 真机验收（agent 执行，不进 CI；随实现同 PR）

本节场景序号按 tower 对账后的 registry 分配（content-width-drag r1 撞号后建立的口径）：
36 = live-theme-switch（M226，已合并）、37 = heading-hierarchy-ramp（M224）、
38 = content-width-drag（M223）、39 = product-version-display（M225，
`product-version-display/tasks.md:41`）、40 = table-fullscreen-view（M229，
`wt-229 proposal.md:128-134`）、41 / 42 = M231（nonmd-edit，tower 广播
2026-09-25）、**43 = list-tab-indent（本 change）**。对账经过：本稿初取 40，与 M229
撞号，经 M231 广播指出后让号改取 43。实现期新增场景前先核对
`scripts/acceptance/scenarios/` 的既有编号与本表，不再「续现有序列」盲取。

- [ ] 6.1 新增场景 `scripts/acceptance/scenarios/43-list-tab-indent.md`：合成 vault
      嵌套列表 fixture，KimiCU 注入 TAB / SHIFT+TAB，回读文档断言（缩进后源码、
      顶层 outdent 后逐字节不变、undo 一次还原）；断言走「回读 + 字节比对」，
      不用注入自报当判据（REVIEW.md 第 5 条）
- [ ] 6.2 场景含非列表行 TAB 无操作断言（文档与 dirty 均不变）与截图留档
- [ ] 6.3 `node scripts/acceptance/run.mjs --check 43` 静态校验绿；真机跑通后证据落
      `test-results/acceptance/`（git 外）
