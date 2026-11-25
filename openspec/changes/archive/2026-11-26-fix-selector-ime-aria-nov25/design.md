# Design: 输入面的 ⌘A 全选（同 change 增补）

- Change ID: `fix-selector-ime-aria-nov25`
- 日期: 2026-11-25
- 角色: AI agent（诊断与实现），Alex Lee（缺陷报告与修复要求）

## 1. 现场与根因

用户实测：Vault Switch 与 Outline 的筛选框按 `⌘A` 不能全选输入串，Quick Open 可以。代码层核对：

- Quick Open 在浮层就地键处理里有一条 `Cmd-A` 分支：`event.preventDefault()` + `input.select()`
  （`src/quick-open.ts`），并有独立的合同条「输入面内的全选（⌘A）」；
- TOC 与 Vault 的 `onKeydown` 没有这条分支（组合期守卫已在前一版落地，但 `⌘A` 落到 `default`
  分支直接返回）；
- ⌘A 的全局绑定是 `editor.select-all`、作用域 `text`，只命中编辑器 / composer；筛选输入框不在
  该作用域里，因此既没有产品接管，也不能指望 `editor.select-all` 代劳（那会选中正文、丢掉输入串）；
- WKWebView / 原生 Select All 菜单是否把该键送进 input 不归本仓控制（M627 起菜单项已让出加速键）。

## 2. 决策

**复用 Quick Open 的总输入面条款，不在两个 capability 各写一份实现口径。** TOC / Vault 的筛选框
都是「输入面」，合同本体是 `quick-open` 的「输入面内的全选（⌘A）」：

- 输入框持焦时由浮层的就地键处理显式接管：`preventDefault` + 对输入框执行原生全选；
- MUST NOT 依赖 webview / 原生 Select All 的默认行为；
- MUST NOT 绕到 `editor.select-all`；
- 组合期（`isComposing` / `keyCode === 229`）不接管、不改变输入框选区；
- 其余文本编辑键（复制 / 剪切 / 粘贴 / 撤销 / 重做 / 移动 / 删除 / `⌫` / `⌥⌫` / `⌦` / 左右方向键）
  继续走原生输入框路径；浮层关闭后编辑器内的 `⌘A` 语义不变。

两份 delta 只写「本条与 `quick-open` 的同名条同一套」及本表面的作用面（TOC / Vault），不复制条款
正文——避免出现第三份实现口径（REVIEW.md「同一语义两处真源」条）。

## 3. 实现落点

两个浮层的 `onKeydown` 在组合期守卫、Escape 准入与 `keyToken` 之后，`switch` 里各加一条：

```ts
case "Cmd-A":
  event.preventDefault();
  this.input.select();
  return;
```

- 位置必须在组合期守卫之后：组合期的 `⌘A` 归输入法 / 原生路径；
- 用 `return` 而不是 `break`：该分支自己完成 `preventDefault`，不必落到 switch 末尾的统一
  `preventDefault`；
- 不抽共享函数：两处各三行，抽出来只会多一层间接；合同单一来源在 spec，不在代码形状。

## 4. 判据

- **chromium 真实按键**（`tests/visual/scenes/selector-aria-ime-nov25.spec.ts`）：输入多字符后
  `page.keyboard.press("Meta+a")`，断言窗口冒泡末端 `defaultPrevented === true`、
  `selectionStart === 0` / `selectionEnd === value.length`、输入值不变、浮层不关；随后键入一个字符，
  整串被替换、列表按新串筛；编辑器选区不变（证明没有绕到 `editor.select-all`）。
  旧实现没有分支时 `defaultPrevented` 为假——Chromium 的原生路径会顺手做出选区，但 WKWebView 不会，
  所以这个读数才是区分「产品接管」与「上游顺手」的判据。
- **组合期反例**：组合事件序列里派发 `⌘A`（`isComposing` 与 `keyCode === 229` 各一路），断言
  `defaultPrevented` 为假、输入框没有建立全选。
- **真机**：验收场景 13 / 17 用 `channel: cgevent` 发真实 `⌘A`（AX 全选兼容路径会掩盖产品分支），
  随后注入替换串，按 AX 里出现的候选集合判「整串替换」而不是「追加」。

## 5. 边界

- 不改视觉、不改基线；不新增 token。
- 不改变其它文本编辑键的原生路径，不改 `editor.select-all` 的键位与作用域。
- 不把这条合同扩到 Quick Open / Skill 之外的其它浮层；本 change 只覆盖 TOC 与 Vault 两个筛选框。
