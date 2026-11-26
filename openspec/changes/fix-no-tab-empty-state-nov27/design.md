# Design: fix-no-tab-empty-state-nov27

## 1. 问题拆解

无 TAB 空态的「像 bug」由三个独立的呈现信号叠加而成：

| 信号 | 现状 | 用户读到的含义 | 实际状态 |
|---|---|---|---|
| 行号 gutter | `[ui] line_numbers=on` 或 ⌥G 打开时出现 | 这里有一份文档 | 空编辑器 / 未命名 scratch |
| CM 插入光标 | 聚焦时出现 | 这里能打字 | 分栏空 pane / 首启 tips 结构性只读 |
| 覆盖层 | D107 挂在 `editorRow`，`inset:0` | 整个内容区都不可用 | 只有 doc pane 没有文档 |

三者必须分别修正，不能把「无 TAB」整体改判为只读：M149 的单 pane 空态 scratch 是可编辑的合法形态，分栏前的 dirty scratch 也必须继续可编辑（M329 r1 P2-1 的豁免）。因此本 change 只改**呈现**与**覆盖层作用域**，不改「无 TAB 是否可编辑」这条主判据。

## 2. 行号：per-pane `hasTabs` 作为第三个维度

### 2.1 判据

行号 gutter 的在场判据原本是两条：持久开关 `lineNumbersOn` 或 ⌥G 临时档 `gotoGutterVisible`。新增第三条：**该 doc pane 有带路径标签**（`hasTabs`）。

- `hasTabs` 的定义复用 `renderAllTabStrips` 的既有读数：`editor.sessions().some(s => s.path !== undefined)`。它与标签条 `visibleTabsOf`、空 pane 引导同源，不另写一套「空」的表达式。
- 三条合成一个纯函数，放在 `src/line-numbers.ts`：

  ```ts
  export function gutterVisible(hasTabs, lineNumbersOn, gotoGutterVisible) {
    return hasTabs && (lineNumbersOn || gotoGutterVisible);
  }
  ```

- `src/editor.ts` 的 `gutterExtensions()` 是唯一消费者（原本就是「gutter 在场判据的唯一来源」），改为调用 `gutterVisible(paneHasTabs, lineNumbersOn, gotoGutterVisible)`。
- `paneHasTabs` 是**实例变量**，初值 `false`：任一 doc pane 的初始状态都没有标签，首帧起就不该有行号；打开 / 新建带路径文件后，`renderAllTabStrips` 经 `setPaneHasTabs(true)` 在同一同步点重配，按配置恢复。
- `setPaneHasTabs` 与 `setLineNumbers` / `setGotoLineGutterVisible` 共用 `reconfigureGutter()`（全部会话、md / code 两模式一起翻），保证后台标签切回时也是新态。

### 2.2 为什么必须包含 ⌥G 临时档

合同原文：「任一 doc pane `hasTabs=false` 时不显示行号（含 ⌥G 临时 gutter）」。⌥G 的临时 gutter 是有意义的「跳转到行号」输入辅助，只在有文档可跳时成立；空 scratch 上打开输入条仍然可用（可跳到第 1 行），但不该凭空长出一列行号。实现上不需要在 `goto-line.ts` 另加判断——`gutterExtensions()` 一次判掉，输入条自身的打开 / 收起 / 落点语义不动。

### 2.3 单 pane scratch 不被误伤

`paneBlocksInput` 只在分栏态为真，因此单 pane 空态 scratch 的 `editable` 仍为真；本 change 只把 gutter 压掉，不碰可编辑性与保存提示。S5 的视觉用例先观测「有文档时有 gutter」的对照面，再观测「关标签后无 gutter 但仍可输入」，两格同时成立才能证明压掉的是行号而不是整个编辑面。

## 3. 结构性只读：光标层按会话呈现标记隐藏

### 3.1 标记住哪

`EditorSession` 新增 `structuralReadOnly: boolean`，由装配层在 `renderAllTabStrips` 的唯一写点经 `setSessionEditable(foreground, editable, structuralReadOnly)` 写入：

```ts
const structuralReadOnly = paneBlocksInput(split, hasTabs, foreground.dirty) || firstRunTipsVisible;
editor.setSessionEditable(
  foreground,
  !structuralReadOnly && isEditablePath(foreground.path),
  structuralReadOnly,
);
```

- **两个来源**：分栏态空 pane（`paneBlocksInput`，含 dirty scratch 豁免）与首启 tips（`firstRunTipsVisible`）。它们本来就是「结构性不可编辑」的两条来源，只是此前没有单独的呈现维度。
- **为什么不用 `editable === false` 直接隐藏**：vault 外只读文档（M655）同样是 `contenteditable=false`，但它不是「无 TAB 的空态」，仍应保留插入光标（否则用户在只读文档里连光标位置都看不到）。结构性只读是 `editable=false` 的子集，必须单独标记。
- **幂等比较两个维度**：`setSessionEditable` 原先只比较 `editable`。打开一份 vault 外只读文档时，`editable` 可能保持 `false`，但结构性只读要从真翻假（空 pane → 外部文档），只比 `editable` 会漏掉光标标记的翻面。现在两个字段一起比较、一起重配。
- **装载即退出**：`reloadSession` 在写入新文档时清 `structuralReadOnly=false`，随后同一同步点的 `renderAllTabStrips` 再按真实 `hasTabs` / dirty 裁决。避免上一帧的空态标记留到有内容的文档上。
- **迁移**：`adoptSession` 的 `rebindEffects` 带上 `session.structuralReadOnly`；跨 pane 移动的会话对象带着自己的标记，目标实例的同步点随后重算。

### 3.2 怎么画

`modeExtensions(mode, path, editable, structuralReadOnly)` 在结构只读时装一条：

```ts
EditorView.editorAttributes.of({ class: "lumir-structural-readonly" })
```

它随 `modeCompartment` 与 editability 同批重配（`modeAndWrapEffects`），因此切会话 / 翻可编辑性时类跟着走。样式只有一条：

```css
.cm-editor.lumir-structural-readonly .cm-cursorLayer {
  visibility: hidden;
}
```

- 只隐藏**光标层**：`.cm-selectionLayer` 不受影响，只读内容仍可选中复制；CM 的 `drawSelection()` 与选区几何不变。
- 不改 `EditorView.editable` / `readOnly` / `contentAttributes` 的既有取值：`tabindex="0"` 与 `aria-readonly="true"` 照旧，点击仍可聚焦并激活 pane。
- **MUST NOT 用 `:has()`**：`contenteditable=false` 也覆盖 vault 外只读文档，从它反推会误伤；用逐会话标记是唯一能区分两者的判据。
- **MUST NOT 覆盖 `.cm-cursorLayer` 的 animation**：m647 场景钉住 CM 的光标闪烁相位重启，本 change 只写 `visibility`，不碰 animation。

### 3.3 空 pane 引导

`.pane-empty-guide` 的 `cursor: text` 改为 `default`。引导是「这里没有可编辑内容」的替代表面，`text` 光标会反向暗示可输入。点击行为不变（仍把焦点交给该 pane 的编辑器，focusin 翻活跃指针）。

## 4. D107 覆盖层收窄到活跃 doc pane

### 4.1 现状

`.editor-notice` 由 `shell.editorRow.append(notice)` 挂在分栏行盒上，CSS `position:absolute; inset:0`；`renderNotice` 还把 `editor.view.dom`（当时的活跃 pane 编辑器）整块 `display:none`。harness 打开时，覆盖层以整条行盒为界，把 harness 与 composer 一起盖住。

### 4.2 新形态

- 覆盖层改为挂在**活跃 doc pane 的 `.editor-pane` 挂载元素**里（`position: relative` 的定位包含块），`inset:0` 因此只覆盖该 pane；harness 与 composer 不在同一 pane，结构上不可能被盖住。
- 新增 `placeNotice()`：幂等，未显示时 no-op；显示时把 notice 移进当前活跃 doc pane，并只 `display:none` 该 pane 的编辑器 DOM。换宿主时先恢复上一个宿主的编辑器。
- `showNotice` / `renderNotice` 后调用 `placeNotice()`；`syncActiveDocument` 在 `renderAllTabStrips` 之后也调用一次，使覆盖层跟随活跃 pane 切换（旧 pane 的编辑器恢复显示）。
- `showEditor()` 统一撤下：`notice.hidden = true` + 恢复 `noticeHostEditor` 的 `view.dom.style.display`。不再按「当时的活跃 pane」现取，避免拆错对象。
- 覆盖层仍复用同一个元素与 D107/D882 文案、动作；不新增创建按钮，不改空态动作链路。

### 4.3 首启 tips 不动

tips 本来就挂在 `shell.editorPane`（root doc pane），不盖 harness。本 change 不改它的 DOM、生命周期、文案与可编辑门；只让它的前台通过 `structuralReadOnly` 获得「无光标」的呈现。tips 与 D107 覆盖层是两条独立表面，不合并、不互相替代。

## 5. 代裁事项的落点

| 代裁 | 落点 |
|---|---|
| S1/S5 单 pane scratch 保留可编辑、不删 scratch、无行号 | `renderAllTabStrips` 的 `paneBlocksInput` 只在分栏态为真；`gutterVisible` 的 `hasTabs=false` 只压行号；S5 视觉用例 |
| S2 D107 收窄到 doc pane、不盖 harness/composer | `placeNotice` + notice 挂载元素；S2 视觉用例 |
| S3 tips 原样、无行号、无光标 | `firstRunTipsVisible` 继续只参与 structural；S3 视觉用例 |
| S4 分栏空 pane 无行号/无光标/键入无效但可激活 | `paneBlocksInput` + structural 标记 + `setPaneHasTabs`；S4 视觉用例 |
| 有文档后同帧恢复 | `renderAllTabStrips` 是标签 / 分栏 / dirty 的唯一同步点；开文档 / 关标签 / 分栏 / 收起都经它 |
| 无 TAB 时 modeline 不改 | 本 change 不触碰 modeline 代码与断言 |

## 6. 测试与证据

- 单测：`gutterVisible` 真值表（无标签压过 on 与 ⌥G；有标签时按两档；`hasTabs` 翻面结果必须翻面——避免「加了参数但没参与判定」的假绿）。
- 视觉结构层：新增 `no-tab-empty-state-nov27.spec.ts` 覆盖 S2–S5；更新 `m281-goto-line.spec.ts` 的「新 pane」用例（空 pane 0、打开文档后 1/1）与 `gutter-copy-path-line.spec.ts` 的「关闭最后标签」用例（无 gutter、无手势、重开恢复）。
- 像素层：由主会话按 `scripts/gate.sh visual` 统一跑；候选截图落 `.local/missions/fix-no-tab-empty-state-nov27/`，不在本 change 内 `--update`。
- 真机：新增 `885-no-tab-empty-state.md`；本批只跑 `--check`，真机时段由主会话串行安排。

## 7. 风险与边界

- **行号开关的交叉态**：`setLineNumbers` 在 `off` 档下仍会按 `gotoGutterVisible` 重配；`paneHasTabs=false` 时两者都为假，重配幂等。不会出现「切开关把空 pane 的行号带回来」。
- **notice 与 transient 提示**：所有 `.editor-notice` 共用同一元素，因此装载 / 报错提示也随活跃 pane 收窄。这是同一语义的一致化（M317 2.6 已要求「提示点名跟随活跃 pane」），不是第二个实现。
- **视觉基线**：空态 / 分栏空 pane 的整页基线可能出现合法变化（行号列与光标消失、覆盖层几何变化）；基线更新是人肉裁决点，本 change 只提供候选截图。
- **外部只读文档**：保留光标（不属于结构性只读），行为不变；`setSessionEditable` 对 `external` 会话的早退不变。
