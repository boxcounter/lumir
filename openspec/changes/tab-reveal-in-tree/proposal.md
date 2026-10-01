# Proposal: 标签右键菜单增加「在左栏中定位到此文件」

- Change ID: tab-reveal-in-tree
- 日期: 2026-10-01
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## 提案批准记录（Alex 节点 1）

**本 change 的提案批准 = Alex 2026-10-01 的显式需求原话**：

> 「TAB 右键菜单增加：在左栏中定位到此文件」

按 AGENTS.md 的流程分工，功能变更走 OpenSpec change（提案评审 → 实现 → 归档评审两个 Alex 节点）。
本条需求由 Alex 本人逐字给出、范围与落点在他那句话里已经说全（哪个菜单、加什么、干什么），
tower 据此把 proposal 与实现折进同一个 mission（M300），**Alex 的这句话即本 change 的提案批准记录**，
实现期不再另开一次提案评审；归档评审（节点 2）照常。

## Why

标签栏能回答「我开着哪些文件」，但回答不了「**这个文件在 vault 的哪个位置**」。用户在标签上看到
`deep.md` 时，无法从标签本身得到它属于哪个目录、旁边还有哪些兄弟文件——而这些正是他在树上做下一步
（重命名 / 新建兄弟文件 / 看同目录还有什么）需要的信息。

今天的左栏**没有任何一条通道**能把某个路径在树里显现出来（M300 侦察结论）：`src/tree.ts` 的
`setCurrentPath` 只切 `is-current` / `aria-current` 两个类，既不展开祖先、也不滚动；文件树条目菜单里
名字含 `reveal` 的那一项（`src/tree-menu.ts` 的 `reveal`，文案 D128「在 Finder 中显示」）是**在系统
文件管理器中显示**，与本需求无关。树里已经打开的目录不滚动、折叠的目录不展开——「在左栏中定位」这条
能力全仓不存在，本 change 是它的第一个落点。

需求形态与既有菜单一致（同一张菜单、同一套浮层口径）：右键菜单是「作用于指针下这一个标签」的那一层
（M254 的裁决：右键不改上下文），定位恰恰需要这个锚点——定位哪个文件由**指针落在哪一条标签上**决定，
与当前前台标签无关。

## What Changes

1. **文件树新增「定位路径」能力**（spec delta：`file-tree` 新增 requirement「在树中定位路径」）。
   给定一个 vault 相对路径，树把它显现出来：沿路径把**全部祖先目录**逐级展开（惰性目录经 fs-io 的
   `fs_scan_dir` 按需取回一层再继续向下）、把目标行滚动进视口、并把它标成当前行。路径不在树模型里
   （标签对应的文件已被外部删掉 / 换了 vault）时是**空动作**：不展开、不改当前行、不滚动——不留半截现场。
2. **标签右键菜单新增首项「在左栏中定位到此文件」**（spec delta：`multi-tabs`「标签的关闭操作」
   MODIFIED）。菜单项集因此由三项变四项，顺序为**定位项在前**、三条关闭路径照原相对顺序跟在后面；
   定位项作用于**指针落在的那一条标签**（右键不改上下文的既有口径不变），点它 MUST NOT 改变前台标签、
   MUST NOT 打开 / 关闭任何标签。
3. **新增一条文案** D322（`文案-Copy.md` + `src/copy-data.ts`，zh + en 双语；**只追加**，编号接在当时
   末位 D321 之后）。中文串取 Alex 原话「在左栏中定位到此文件」，英文串取 `Reveal in File Tree`。

**为什么定位项排在首位**（顺序是裁决面，写在这里给 Alex 一个拒绝面）：文件树条目菜单自己的口径是
「破坏性项固定尾部 + 分隔线」（`tree-menu.ts` 的 `menuItemsFor`），同族里 `reveal` 这类非破坏性项排在
`trash` 之前。标签菜单没有分隔线（`tab-menu.test.ts` 断言它 MUST NOT 出现分隔线），顺序是唯一的分组
表达方式——定位项在前，三条关闭路径仍是尾部连续的一块，与树菜单的分组方向一致；副作用是菜单的默认
游标（首项）从 `Close` 变成定位项，回车不再一按就关标签。

## Non-goals

- **不做「在左栏中定位」之外的第二个入口**：不加键位绑定、不在编辑器正文里加钮、不在标签以外的位置
  （如文件树菜单）加第二份实现——树里的菜单本来就在被定位的对象上，不需要这个动作。
- **不改右键的上下文语义**：定位 MUST NOT 顺带把该标签切到前台（右键不改上下文是 M254 的既有裁决，
  本 change 不动它）。
- **不给树加「定位高亮」之外的选中态**：目标行复用既有的当前行标记（`is-current`），不新造第三种
  行状态（不是 `is-menu-target`，那个的在场期严格等于「菜单开着」，语义是「菜单作用行」）。
- **不做跨 vault 定位**：标签的路径始终属于当前 vault（换 vault 会整窗替换上下文），因此不存在
  「在另一个 vault 的树里找」这条路径；路径不在当前模型里就是空动作。
- **不改文件树的滚动容器形态**（不改 `src/style.css`）：滚动用 `scrollIntoView({block: "nearest"})`，
  只在需要时补差，已在视口内的行一个像素都不动。

## Impact

- **影响的 specs**：
  - `file-tree`：1 条 ADDED（「在树中定位路径」）
  - `multi-tabs`：1 条 MODIFIED（「标签的关闭操作」——菜单项集三项 → 四项，首项为定位项；三条关闭
    路径的语义与确认流逐条不变）
- **影响的代码/系统**：
  - `src/tree.ts`：`FileTree` 新增 `revealPath(path)`；惰性目录的取数登记由 `Set<string>` 改为
    `Map<string, Promise<void>>`（定位要**等**在途的取数落地，`Set` 只能回答「发过没有」）
  - `src/tabs.ts`：`TabMenuAction` 新增 `"reveal-in-tree"`、`tabMenuItems()` 新增首项、`TabsDeps`
    新增 `revealInTree(path)` 注入口
  - `src/main.ts`：把 `tree.revealPath` 接进 `TabsDeps`（`tree` 是 `let` 绑定的装配层单例，接线是
    惰性闭包，与 `syncActiveDocument` 同一条模式）
  - `src/copy-data.ts` / `文案-Copy.md`：新增 D322（漂移门禁 `tests/unit/copy.test.ts` 两边同改）
  - `tests/unit/tab-menu.test.ts`：项集与游标断言按四项更新；新增一条「定位项能派发到 TabsDeps」
  - `tests/unit/tree-reveal.test.ts`（新增）：定位的展开 / 滚动 / 当前行三条行为与「路径不在模型里」
    的空动作
  - `tests/visual/scenes/tab-menu.spec.ts`：菜单元素基线（多一项）与一条端到端的定位用例（展开 +
    滚进视口 + 当前行；滚动这条判据只有 chromium 层给得出）
  - `scripts/acceptance/scenarios/69-tab-reveal-in-tree.md`（新增）：真实 WKWebView 下的右键 → 定位
    链路（真机层不覆盖滚动，见该场景的「通道与已知边界」）
- **关联约束**：
  - ADR 0002 §3（webview 不直接触文件系统）：定位只读树模型与按需枚举结果，不发新命令；
  - ADR 0006（Emacs keybinding PKM 定位）：本 change 不加键位——定位是鼠标路径上的动作，与左栏的
    键位面无关；
  - REVIEW.md 第 8 条（同一语义一处真源）：菜单项集仍在 `tabMenuItems()` 一处（渲染 / 单测 / 验收
    三处同源）；路径的 basename 派生仍只有 `baseName` 一处；
  - REVIEW.md 第 2 条（「读不到」不等于「为空」）：定位在模型里查不到路径时**不假装成功**（不展开、
    不滚动），惰性取数失败时同样止步。

## 编号声明

- **文案取 D322**。依据（2026-10-01 动工前核对）：`文案-Copy.md` 当前最大编号是 **D321**（原生目录
  选择器的标题，M282 批的末位），**D322 是当前的下一个可用号**。
- **真机场景取 69**（试占）。依据：`scripts/acceptance/scenarios/` 现有编号最大 **68**
  （`68-selection-contrast.md`），69 是下一个可用号。
- **OpenSpec change 目录名**：`tab-reveal-in-tree`（与分支 `feat/tab-menu-reveal-in-tree-m300` 同一
  语义，slug 只取能力名，不带 mission 号）。
