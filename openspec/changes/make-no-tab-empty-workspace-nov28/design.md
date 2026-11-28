# Design: make-no-tab-empty-workspace-nov28

## 1. 状态模型：空工作区 = 无带路径标签的文档 pane

现实现里每个 `EditorView` 恒有至少一个会话（`active` 永不为 undefined），没有标签时它就是一份无路径的空白会话。装配层已经有「有没有标签」的读数：`editor.sessions().some(session => session.path !== undefined)`（`renderAllTabStrips`，与标签条 `visibleTabsOf` 同一定义）。

本 change 不拆掉这个占位会话，而是改它的**身份**：

- 无路径会话 = 空工作区本身，不是一份可编辑文档；
- 它只在内部存在，用来承接「打开文件时就地复用」的既有语义（`targetSessionFor` 的复用分支、`closeSession` / `reset` 的兜底），避免 `active` 变成 undefined 所引发的全链路改造；
- 它 MUST NOT 可编辑、MUST NOT 产生 dirty、MUST NOT 成为保存目标。

这样「关闭最后一个 Tab / Close All / reset / 分栏 / 首启」不需要各自写一套空态逻辑：它们都已经汇到 `syncActiveDocument → renderAllTabStrips` 这一个同步点。

### 1.1 可编辑性的单点落定

`src/editor.ts` 的 `makeSession` 是全部路径的创建点（初始会话、`createSession`、`closeSession` 的兜底、`reset`、新 pane）。在这里把无路径会话定死为：

- `editable = false`（视图层 `contenteditable=false` + `changeFilter` 双层拒收）；
- `structuralReadOnly = true`（不画 CM 插入光标）。

`reloadSession` 在装载有路径文档时按既有表达式恢复 `editable` 并清 `structuralReadOnly`；装配层同步点随后按真实状态再裁决一次（幂等）。

`renderAllTabStrips` 的表达式同步收窄：

```ts
const structuralReadOnly = foreground.path === undefined || firstRunTipsVisible;
editor.setSessionEditable(
  foreground,
  !structuralReadOnly && isEditablePath(foreground.path),
  structuralReadOnly,
);
```

原先的 `paneBlocksInput(split, hasTabs, foregroundDirty)` 三个维度全部失效：单 pane 也封锁、dirty 的无路径草稿不再可能。`src/pane-layout.ts` 的 `paneBlocksInput` / `emptyPaneGuideVisible` 随之删除——留着一个「只在分栏态成立」的判据就是第二处真源。

### 1.2 空工作区没有 goto-line 目标

`editor.goto-line` 是 editor 作用域命令，但空工作区的正文仍有 `tabindex=0`（结构性只读宿主），
命令因此可达。占位会话此前被它当成一份可跳转的文档：⌥G 会打开输入条（真机 885 的 AXTextField
「1」即此）。本 change 在 `editor.goto-line` 的入口加门：`active.path === undefined` 时直接返回，
不打开输入条、不动焦点。有路径文档——含 vault 外只读、尚未装载等异常会话——行为不变。

回归：结构层「正文持焦 + ⌥G 不打开」；native 885 用真实 ⌥G 键位复验。

## 2. 空工作区表面

每个 doc pane 在 `createPaneHandle` 里建一个常驻、初态 `hidden` 的共享 region（`workspace-tips` + 装配选择器 `pane-empty-workspace`）。首启与普通 / 双 pane 只能调用同一个 `createWorkspaceTips()`：四条固定为 Outline、Quote to chat、Knowledge links、Harness pane，说明、顺序与读屏语义不另开真源。Open / New 按钮、系统通用快捷键与右键新建提示全部直接删除；Quick Open、文件树打开、vault 右键内联新建仍走既有入口。

region 由可见 `h2` 命名，四项是带 `h3` 的列表项，仅 `tabindex=-1` 承接程序焦点，不进 Tab 序。被首启或普通空态覆盖的编辑器宿主在同一个同步点置 `inert`，使正文同时退出 Tab 序、程序焦点与辅助技术树；有文档后恢复。视觉采用候选 A 的编号清单：宽 pane 同行排列，容器变窄后手势换行，极窄时仅装饰序号退场；全部使用既有 token，不加卡片、插画或依赖。

在场判据只有一条：**该 pane 没有带路径标签**（`hasTabs=false`）。首启 tips 在 root 宿主时普通副本让位；notice 覆盖宿主时副本也隐藏，避免不可见 region 留在焦点 / 读屏路径里。判据与写入收敛在 `renderAllTabStrips` 的同一个 `hasTabs` 读数上；notice / showEditor 的状态变化复用同一同步函数。

### 2.1 为什么不用 `.editor-notice`

`.editor-notice` 是**单个**元素，经 `placeNotice` 跟随活跃 pane；双 pane 时非活跃空 pane 仍需要自己的共享表面与焦点落点，因此空工作区必须是 per-pane 元素。notice 仍承担打开失败 / 暂不支持预览等瞬时覆盖层，两者职责不重叠。

### 2.2 首启 tips 的覆盖范围按宿主 pane

`firstRunTipsVisible` 是全局 flag，但 tips 元素只挂在 root doc pane 的 mountEl。空工作区的在场判据
因此 MUST 按**宿主关系**（`firstRunTipsEl.parentElement === assembly.mountEl`）收窄，MUST NOT 用全局
flag 隐藏所有 pane 的空工作区：首启收起 harness 再分栏时，右 pane 既没有 tips，也不该丢掉自己的
空工作区与动作（P2-2）。结构只读里 tips 那一维也按同一宿主判据收窄；无路径本身仍使右 pane 只读。

### 2.3 D107 空 vault 覆盖层并入空工作区

老用户空 vault（`onEmptyVault`）此前走 D107 + D882 的 notice 分支。它与「无 Tab」是同一个状态，保留两套表面就是同一语义两处真源。本 change 删除 `showEmptyVaultState`：空 vault 与普通无 Tab 一样呈现共享 tips；新建仍复用 vault 右键的同一条内联命名链路。D107 / D233 / D369 / D882 及后续 Open / New 文案随之删除，编号不复用。

## 3. 焦点落点

新增装配层唯一入口：

```ts
function focusDocPaneEntry(paneId: PaneId): void
```

- 首启 / 空工作区在场 → 焦点交给对应的静态 tips region；
- 否则 → 交给该 pane 的 `focusPreservingReadingPosition()`（M280 口径不变）。

所有「把焦点交还文档 pane」的路径改走它：复合句柄的 `focusPreservingReadingPosition`、标签条的 `focusEditor`、`pane.split` / `pane.other` / pane 收起、Close All 收尾、**vault 切换器**、Quick Open / goto-line / 遮罩 / 设置面板的 `restoreFocus`。空 pane 的正文因此 MUST NOT 成为焦点落点；有文档的 pane 行为逐字不变。vault 切换器保留自己的阅读位置快照取 / 写，只把 `focusEditor` 的实现换成这个入口（P2-1）。

关闭最后一个标签的路径补一次交还：`closeTabNow` 在同步点之后，若本 pane 已无可见标签则调用 `focusEditor`（在装配层解析为上面的入口）。这样 `×` 按钮随 DOM 移除后焦点不会掉回 `body`，⌘W 关掉最后一个标签也不会把焦点留在只读正文里。

### 3.1 非活跃空 pane 的激活

region 挂在所属 pane 的 mountEl 内，点击 / `focus()` 触发既有 `focusin → activatePane(paneId)`，不另写动作闭包。随后经既有全局命令打开 Quick Open 时，浮层读取正确的活跃 pane；取消后统一入口把焦点还给该 region，双 pane 不串焦。文件树新建仍由 vault 右键输入框自己接焦。

## 4. 旧合同的处置（按不再可达）

| 旧合同 | 处置 |
|---|---|
| `pane-layout`「分栏态空 pane 不接受文本输入」 | REMOVED，由新的「无标签文档 pane 的空工作区」承接 |
| `pane-layout`「无标签文档 pane 的空态呈现」 | REMOVED，并入同一条新 requirement |
| `multi-tabs`「未命名文档的 dirty 守卫」 | REMOVED，由「无 Tab 空工作区与 dirty 判定」承接（有路径 dirty / vault 切换条款原样保留） |
| `multi-tabs`「标签的关闭操作」的 Close All 焦点落点 | MODIFIED：空 pane 落到静态 region，有文档仍落正文 |
| `fs-io`「没有打开文件时的 Cmd+S 反馈」 | MODIFIED：删除无路径分支与场景；有路径未登记 revision 的 D234 不变 |
| `first-run-onboarding` tips 与空白草稿 | MODIFIED：首启与普通 / 双 pane 共用四条特有 tips；首启资格不变，空白正文结构性只读且宿主 inert |
| `keymap-commands` 行号条款里的「单 pane 未命名 scratch」 | MODIFIED：改为「无标签 pane / 空工作区」 |
| `keymap-commands`「行号 gutter 的右键复制」里「有标签 pane 中前台是未命名文档」 | MODIFIED：改为空工作区无 gutter / 无本手势；无路径不编造路径降为防御兜底 |
| `file-tree`「新建文件的默认名预填」里的「未命名内存文档等其它创建链路」 | MODIFIED：删除该不可达链路，改为「空工作区占位会话不在此列」 |
| `quick-open` | ADDED：空工作区入口、所属 pane 激活与焦点归还 |

不可达的代码分支同步删除：`save-controller` 的无路径 guard 反馈、`save()` 的无路径 dirty 反馈、`tabs.targetSessionFor` 的「dirty 草稿不复用」分支（无路径恒 clean）。依赖这些状态的单测按「不再可达」删除或改准；不保留兼容层。

## 5. 测试与证据

- 单测：`pane-layout` 旧判据用例删除；`save-controller` 无路径用例删除（有路径未登记 revision 用例保留）；`tabs` / `tab-menu` 的注释与不可达分支改准。`line-numbers` 的 `gutterVisible` 真值表不变。
- 视觉结构层：新建 `no-tab-empty-workspace-nov28.spec.ts` 覆盖单 pane / 双 pane / 首启 / 空 vault 四格，
  外加「vault 切换器取消回静态 region」与「首启收起 harness 再分栏」两条回归；覆盖中英文 × 三主题 × 窄窗，逐项比对首启与普通空态内容；改准 `m320`、`m281`、`first-run-empty-state`、`first-run-onboarding-nov25`、`gutter-copy-path-line` 等相邻场景。
- 反向必红：把无路径 `editable` 改回 true、移除编辑器 `inert`、把焦点落点改回正文、恢复一个通用提示或空态按钮，目标断言必须分别判红；恢复后判绿。
- 像素：不更新基线。两个候选各 11 张截图落 `.local/reviews/no-tab-empty-workspace-nov28/redesign/`，推荐 A，供 Alex 过目。
- 真机：本批不跑（主会话串行）；验收场景 885 只做静态 `--check`，真机读数由主会话排期。

## 6. 风险与边界

- **首帧时序**：初始会话的不可编辑性在 `makeSession` 定死，不依赖 `renderAllTabStrips` 首次运行，首帧就不会出现可输入的空文档。
- **打开文件复用占位会话**：`targetSessionFor` 的复用分支保留（只去掉 dirty 条件）；`reloadSession` 把路径、可编辑性与 `structuralReadOnly` 一起翻面，空工作区表面在同一同步点离场。
- **notice 与空工作区**：notice 只在宿主 pane 覆盖；空工作区隐藏不改变 notice 的既有层序与动作。
- **外部只读文档**：仍有 `contenteditable=false`，但不是无路径、不带 `structuralReadOnly`，光标保留（与 nov27 的判据一致）。
- **行号**：`gutterVisible(hasTabs, …)` 不变；无标签仍压过 `on` 与 ⌥G。
