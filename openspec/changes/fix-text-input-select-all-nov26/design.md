# Design: 文本输入面的 ⌘A——派生附加面与单一分派

## 1. 根因与可选项

现状（基线 `675a804f`）：

- `src/keys.ts` 的 `Cmd-a` → `editor.select-all`，`scopeOfCommand` 派生为 `text`；分发器只在
  `isEditorEvent` 或 `isComposerEvent` 为真时命中（`Keymap.handle`）。
- `editor.select-all` 的实现由 `composerTextFaceCommands()` 包装：composer 目标 → 面板命令，
  其余 → 编辑器 CM 选区。
- quick-open / toc / vault 各自在浮层 keydown 里 `case "Cmd-A": input.select()`；tree 的内联输入
  没有这条分支；菜单路径 `selectAllByFocusedFace` 只认遮罩 / composer / 编辑器。

三条备选与取舍：

| 方案 | 做法 | 否决 / 采纳理由 |
|---|---|---|
| A. 逐个输入面补 `case "Cmd-A"` | 在 tree 再抄一份，其余面按需补 | 否决。正是复发形态（三份拷贝已存在）；新增面继续漏；静态判据无从建立 |
| B. 把 `text` 作用域整体放宽到原生输入宿主 | 改 `isEditorEvent ∪ isComposerEvent` 的判据 | 否决。族内 Emacs 导航（⌃A/⌃F/⌃K/⌥D…）会在输入框里抢走原生编辑语义；作用域是**命令族**的属性，不能为一个命令放宽整族 |
| C. 新增第四种作用域（`input`） | `KeyScope` 加值，面板加筛选与徽标 | 否决。键位面板的作用域筛选与行徽标是可截图像素面（`m133-describe-bindings` 有基线）；基线更新是人肉裁决点，本 change 不碰 |
| D. **派生的「附加面」标记** | `KeyBinding.inputHosts`，取值只来自 `coversNativeInputHosts`；分发器对 `text` 作用域多一支判定 | **采纳**。绑定表、作用域派生、键位面板逐字不变；附加面是命令的属性，判据单一来源（清单），单测双向对账 |

## 2. 落面模型

「输入面」= 当前聚焦的可编辑文本宿主。`selectAllAt(target)` 按固定优先级分派：

1. **全屏遮罩**（表格 / 代码块）：选遮罩渲染出来的内容根（只读、不可编辑；`overlay-select` 的
   `selectAllOf`）。遮罩自己的 keydown 先消费 ⌘A，这一支主要服务菜单路径。
2. **composer**：`harnessPanel.composerCommand("editor.select-all")`（CM 选区；卡片不参与）。
3. **编辑器内容区**：`editor.commands["editor.select-all"]`（CM 选区）。
4. **原生文本宿主**：`HTMLInputElement` / `HTMLTextAreaElement` → `.select()`；contenteditable →
   DOM Range（`selectAllOf`）。
5. **其余焦点**：编辑器整篇（与让位前的菜单口径一致；键盘路径到不了这里——作用域判定先挡住）。

判据助手各一份：`isComposerNode`（既有）、`isEditorDomNode`（从 `keymapContext.isEditorEvent`
的内联实现提取，两处共用）、`isTextEntryHost`（`keys.ts`，结构化、可脱 DOM 单测）。

顺序里「编辑器先于原生宿主」是必要的：CM contentDOM 与 composer 都是 contenteditable，
`isTextEntryHost` 对它们同样为真；若先判原生宿主，编辑器里的 ⌘A 会变成 DOM Range 全选而不进 CM
状态（选区读写、撤销与后续键入全部错层）。

## 3. 键位层的最小改动

- `NATIVE_INPUT_HOST_COMMAND_IDS = ["editor.select-all"]`；`coversNativeInputHosts(command)` 是
  唯一判据。
- `KeyBinding.inputHosts?: boolean`：只对 `text` 作用域有意义，取值 MUST 由上述函数派生。
- `KeymapContext.isTextInputEvent?(event)`：任意可编辑文本宿主（编辑器 ∪ composer ∪ 原生宿主）。
- `Keymap.handle` 的 `text` 分支：

  ```ts
  if (binding.scope === "text"
      && !(ctx.isEditorEvent(event) || ctx.isComposerEvent?.(event) === true)
      && !(binding.inputHosts === true && ctx.isTextInputEvent?.(event) === true)) return;
  ```

作用域派生（`scopeOfCommand`）一字不动：`editor.select-all` 仍是 `text`。键位面板因此零改动。

## 4. 菜单路径

`selectAllByFocusedFace()` 改为 `selectAllAt(document.activeElement)`。焦点在输入框里时选中输入串，
不再落到正文。菜单点击不改变第一响应者（Tauri 菜单是原生菜单栏），`document.activeElement`
仍是输入框——与既有 composer 判据同一读法。

## 5. 输入面清单与静态对账（为什么清单不是抄写）

`tests/unit/text-input-faces.test.ts` 四层判据：

1. **覆盖**：AST 扫描 `src/**/*.ts` 的 `document.createElement("input" | "textarea")` 与共享
   `element(...)` 工厂调用；每个命中文件必须在 `REGISTRY` 里，未登记即红（新增浮层 / 内联编辑面
   忘登记时在 PR 阶段就红）。
2. **新鲜度**：清单条目必须仍创建原生文本输入（改名 / 删除 / 搬走后的僵尸条目同样红）。
3. **单一分派**：字符串字面量 `Cmd-A` 只允许出现在两个只读全屏遮罩的文件里；其余任何文件出现
   本地 ⌘A 处理即红（本 change 收掉的复发形态）。白名单条目失效也红。
4. **`.select()` 白名单**：只允许统一分派入口与三处「打开即预选」的既有焦点动作
   （搜索 mount、行号 open、设置「替换」钮）；三处浮层的就地副本必须为 0。

行为面由 `tests/visual/scenes/text-input-select-all-nov26.spec.ts` 的真实 DOM 矩阵与真机场景
`881-text-input-select-all-nov26.md` 分工。静态面认不出「另造工厂名」的新输入面——这条边界写在
测试头部与合同文档里，不假装判据穷尽。

## 6. IME 与既有编辑命令

- 组合期：`Keymap.handle` 在作用域判定**之前**就 `return`（`isComposing` / keyCode 229），因此
  输入框里的 ⌘A 归输入法 / 原生路径，不消费、不建立全选。三处浮层删除的本地分支原本也各自带
  同一条守卫；收口后只剩分发器一处。
- 其它文本编辑键（⌃A / ⌃F / ⌃K / ⌥D / ⌘Z / 复制粘贴…）不进 `inputHosts`，在原生输入框里仍走
  原生路径；`isEditableHost` 的打字键守卫不变。
- 编辑器 / composer 的 CM 命令与撤销栈不受影响（`selectAllAt` 仍调用原命令实现）。

## 7. 兼容与迁移

单用户、无外部消费者：**直接切断**。三处就地分支与它们的注释一次删净，不留「本地优先、统一兜底」
的双写；`tree.ts` 只加一条「MUST NOT 在此另写 case "Cmd-A"」的就地注释防回潮。

## 8. 规格分层（单一居所）

- **合同本体**（输入面定义、T1–T6 不变量、清单）：`docs/specs/text-input-faces.md`。
- **键位层**（作用域、附加面派生、单一路径）：`keymap-commands` 的「统一键位分发表」与
  「⌘A 归文本面」（保留原名，正文改准）两条 requirement。
- **各面**：`quick-open`（输入面合同的原居所，改为指向统一分派）、`toc-outline` /
  `vault-workspace`（一句实现口径改准）、`file-tree`（新增内联编辑输入框 requirement）。
- 不在多处复制不变量：各面只写「本面如何进入统一分派」与自己的 scenario。

## 9. 验证

- unit：附加面双向对账、`isTextEntryHost` 矩阵、分发器命中/不命中/组合期、静态对账（含反向探针：
  故意新增输入面 / 本地 Cmd-A / 未登记 `.select()` 时三条判据分别判红）。
- visual：`text-input-select-all-nov26.spec.ts` 十条（rename 红→绿、新建、搜索、行号、键位面板、
  菜单路径、非文本面不抢焦点、组合期、编辑器回归、contenteditable 探针）；既有 quick-open /
  selector-aria-ime / m627 场景回归。
- 真机：场景 881（本轮只更新文件，不执行；由后续验收批跑 WKWebView 的键盘通道）。
