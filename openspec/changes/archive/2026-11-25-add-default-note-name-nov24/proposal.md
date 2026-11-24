# Proposal: 新建文件时预填人类可读默认名

- Change ID: `add-default-note-name-nov24`
- 日期: 2026-11-24（初稿）；2026-11-25 按 Alex 新决定修订
- 角色: Alex Lee（评审/裁决），AI agent（起草与实现）

> **节点状态（先读这一段）**
>
> - **Alex 最终决定（2026-11-25）**：默认名**始终启用**，不设设置项——原话「去掉它吧，也就是
>   默认文件名不需要设置项，默认就是这个行为。」`editor.prefill_note_name` 配置键、Raw /
>   validate / settings snapshot / patch / revision / bindings 暴露、自动化节第五行与文案
>   D985–D987 已删除且编号不得复用；D988 接 D984 末位（D984 属 session lazy restore），设置面板恢复四开关原样。
> - **行为合同**：`create-file` 始终预填 D988 主名并全选；撞名递增、键入替换、Enter 接受、
>   Escape 取消、正文焦点保持；create-dir / 重命名 / wikilink / 未命名内存文档不变。
> - **集成重编号（2026-11-25 merge）**：session lazy restore 占用 D984 / 场景 728；本 change 的默认名
>   改为 D988、场景改为 734（D985–D987 已删除不得复用）。行为与 28 断言证据不变，r4 clean 结论沿用。
> - **节点 1**：Alex 2026-11-24「批准。」（初稿为可开关特性）；2026-11-25 新决定改为始终启用。
> - **独立复审 r4**：agent-374 对 `560a190e` 判 **clean / merge**，报告
>   `.local/reviews/default-note-name-r4.md`；r1 的 P2 断言 / 文案问题已修，r2/r3 无新增问题。
> - **tasks 19/19 全勾**；无基线批准需求（设置页相对 base 零改动，原 10 张基线不变）。
> - **归档已完成**：归档提交 `4c55d94a`；包装器 `+1 added`、修链 0 处；`--archived` PASS
>   （0 条 MODIFIED / 对比 0 段）。

> 评审记录
> 节点 1：Alex 2026-11-24 裁决原话「批准。」——方向为「可开启的小特性，新建文件时预填人类可读
> 默认名并选中」。初稿据此刻了 `editor.prefill_note_name` 配置开关与设置面板第五行。
>
> 2026-11-25 Alex 新决定原话：「去掉它吧，也就是默认文件名不需要设置项，默认就是这个行为。」
> 本稿据此改为**始终启用**：删除配置键与设置项，不保留兼容层或第二套配置；设置页保持四开关
> 原样，避免任何设置页基线变化。其余交互合同（预填、主名全选、替换、接受、取消、撞名递增、
> 焦点）不变。

## Why

当前新建文件时输入框为空，用户每建一个笔记都要先想一个名字，哪怕只是随手记一笔。文件树已有
内联编辑、默认补 `.md`、撞名预检与「新建后焦点落正文」的完整链路；在这个链路上始终预填一个
可读的默认名并全选，用户直接输入即替换、直接 `Enter` 即得到可接受的名字，不改变后端创建语义。

Alex 2026-11-25 的决定把「要不要预填」从用户偏好收回到产品默认行为：不设设置项，不引入配置
键，也不保留旧开关的第二条代码路径。

## What Changes

- 内联新建文件（目录行菜单 / vault 根级菜单 / 空 vault 新建入口共用的同一条 `beginCreate`
  链路）**始终**预填当前界面语言的默认名：zh `未命名笔记`、en `Untitled note`。输入框只含
  主文件名（不含 `.md`），`focus()` 之后整段全选。
- 用户直接输入即替换全选内容；`Enter` 接受并按既有创建链路补 `.md`、落盘、自动打开，随后
  焦点按既有 `focus-created-document-nov23` 链交给正文；`Escape` 按既有取消语义撤销；`Tab`
  不新增任何行为（沿用原生焦点移动与失焦取消）。
- 默认名与同级既有条目撞名时自动递增（`未命名笔记 2` / `Untitled note 2`…），判据对最终
  落盘名（补 `.md` 后）作出；**用户自己输入的名称仍走既有撞名校验，不静默改名**。
- 只作用于 `create-file` 的内联编辑；重命名、新建子目录、wikilink 一键创建、未命名内存文档
  等链路不受影响。不调用 AI、不按 vault 分类、不引入模板设置或新 provider。
- **不设配置开关**：删除初稿的 `editor.prefill_note_name` 配置键、Raw / validate / settings
  snapshot / patch / revision / bindings 暴露、设置面板自动化节第五行，以及对应文案 D985–D987。
  不保留兼容层、迁移或第二套配置路径；旧的 `editor.prefill_note_name` 不再被读取（按既有
  「未知 editor 键忽略」的解析口径处理，不迁移、不回写）。

## Non-goals

- 不引入模板、frontmatter 预填、目录级命名策略或按 vault 分类的默认名。
- 不改变后端创建命令、撞名拒绝、忽略集判定或 `.md` 默认扩展名规则。
- 不改变重命名、新建子目录、wikilink 创建或未命名内存文档的既有行为。
- 不新增 AI / provider 调用，不把默认名写进任何文档内容。
- 不把 `Tab` 变成接受键，不为预填引入新的键盘层或 escape 层。
- 不保留设置开关、配置键、迁移逻辑或「关闭预填」的代码路径。

## Impact

- 影响的 specs：`file-tree`（新增「新建文件的默认名预填」）。`settings` capability 不再受本
  change 影响，初稿的 settings delta 已删除。
- 影响的代码/系统：`src/tree.ts`（`beginCreate` 始终预填 + `uniqueNewNoteName`）、
  `src/copy-data.ts` / `文案-Copy.md`（D988，默认名本身）、视觉桩 / 视觉场景、真机验收场景
  734。`src-tauri` 不新增配置字段，设置面板不新增行。
- 关联约束：`openspec/project.md` 的「配置即数据」与性能合同；`REVIEW.md` 的「同一语义两处
  真源」「声明了却没有消费者」两条（默认名只由 copy 表产出，行为只在树的一处实现）。

## 待裁决点

1. **不设开关**：已由 Alex 2026-11-25 决定关闭此前的开关方案；本稿不再保留配置键或设置行。
2. **撞名递增的可见范围**：自动编号只看当前已加载的同级条目；惰性目录未取回的子条目不可见，
   此时默认名可能撞上后端已存在但前端未见的名字——由后端拒绝并在行内回显，用户改名即可。
   推荐接受这个边界，不为它引入一次目录枚举或异步等待。
3. **旧配置键**：不迁移、不警告、不双读；`editor.prefill_note_name` 不再被消费（AGENTS.md
   「变更默认直接切断」）。

## 节点 2 记录（归档前）

五要件：

1. **方案已批准**：Alex 2026-11-24「批准。」；2026-11-25 最终决定「去掉它吧，也就是默认文件名
   不需要设置项，默认就是这个行为。」本 change 据此改为始终启用，无配置键 / 设置行 / 兼容层。
2. **独立 reviewer clean / merge**：agent-374 对 `560a190e` 判 clean / merge（报告
   `.local/reviews/default-note-name-r4.md`）。其后仅 proposal / tasks 节点 2 记录、backlog
   跟踪与归档目录 / living spec 并入，无产品 / 测试代码改动。
3. **tasks 完成**：`tasks.md` 19/19 全勾（1.1–1.3、2.1–2.5、3.1–3.4、4.1–4.4、5.1–5.3）。
4. **门禁与真机证据**：
   - quick：`GATE RESULT: 13/13 PASS（SKIP 0）`（exit 0），含 bindings-drift PASS。
   - 完整视觉：`GATE PASS visual-regression 910s`；`gate.sh visual` 当时汇总
     `GATE RESULT: 14/15 PASS（SKIP 0）`，唯一 FAIL 是 `bindings-drift` 的「重导出未 staged」
     提示（非测试失败），staging 后 quick 中该项 PASS。
   - 设置面板 `m734-settings-panel` 43/43 PASS（含原 10 张元素像素基线）；**无任何基线文件
     改动，不需要 Alex 批准基线更新**。
   - 真机 734：1/1 PASS / **28 断言**，总 24.1s（启动 3.5 / 就绪 1.8 / 场景 18.7），
     `file.exact: ""` 两处 `0 字符逐字一致`；证据
     `.local/acceptance/2026-11-25-default-note-name-734/`。
5. **规格对账**：`node scripts/openspec-archive-check.mjs --change add-default-note-name-nov24`
   PASS；`openspec validate --all --strict` 40 passed / 0 failed；`scripts/docs-check.sh` PASS；
   `docs/backlog.md` 归档跟踪队列有且仅有一条本 change 条目。

## 归档记录（归档后）

- 归档提交：`4c55d94a`（`openspec(archive): archive add-default-note-name-nov24`）。
- 包装器：`Specs updated successfully`（file-tree `+1 added`）；归档目录
  `openspec/changes/archive/2026-11-25-add-default-note-name-nov24/`；归档后修链 0 处
  （扫过 4 篇 Markdown / 0 条相对链接），`openspec-links: PASS（699 条）`。
- `node scripts/openspec-archive-check.mjs --archived add-default-note-name-nov24`：PASS
  （0 条 MODIFIED，对比 0 段；人工恢复 0 段，声明认领 0 段）。
