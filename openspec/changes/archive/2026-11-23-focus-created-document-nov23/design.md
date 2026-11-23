# Design: 新建文件打开成功后的焦点落点

> 本文件写实现合同与取舍，不是实现记录。行号是起草时（2026-11-23）在本 worktree 的读数，
> 实现时以符号为准（实现落地后的读数见 §6）。节点状态见 [proposal.md](proposal.md)：**F1 / F3
> 已批准；F2 修订已于 2026-11-23 追认通过（Alex「好，按这个规则处理」）**。第二轮评审返修
> （完整激活链、quick-open 签名、source-ready 分界）已并入本文件的合同与测试矩阵。

## 1. 事实底座（实现前必须成立，逐条可核）

| # | 事实 | 位置 |
|---|---|---|
| F1 | 三个创建入口共用 `submitInlineEdit` 的 `create-file` 分支 | `src/main.ts:2625`、`:2657-2667`；空 vault 按钮 `src/main.ts:1693-1696` |
| F2 | 成功分支先 `tree.endInlineEdit(true)`，再 `void openFile(..., "new")`，不看返回值 | `src/main.ts:2661-2666` |
| F3 | `endInlineEdit(true)` 删临时行与输入框；`create` 没有 `restore`，焦点落到 `body` | `src/tree.ts:1368-1378` |
| F4 | `openFile` 返回「这次打开是否成功」，新文件路径是异步装载 | `src/main.ts:2824-2886`；装载 `:2952-3011` |
| F5 | `reloadSession` 的 C3 已把 caret 放到正文首行，但不 `focus()` | `src/editor.ts:3214-3279`（`:3274` 的 `normalizeInitialCaret`） |
| F6 | `afterLoad` 只 `showEditor()` + `syncActiveDocument()`，两者不聚焦 | `src/main.ts:2761-2764`、`:2715-2756` |
| F7 | 全仓唯一合法的「交还焦点」实现是 `focusPreservingReadingPosition`；裸 `view.focus()` 被明文禁止 | `src/editor.ts:3527-3532`；`src/scroll-position-view.ts:174-184`；禁止说明 `src/main.ts:1166`、`:2541`、`:1467` |
| F8 | `syncActiveDocument()` 默认关闭 goto-line 与 quick-open，两者 `close()` 默认 `restoreFocus = true` | `src/main.ts:2720`；`src/goto-line.ts:118`；`src/quick-open.ts:672` |
| F9 | 快速打开有明文合同：打开成功后关闭输入面并把焦点交还编辑器 | `openspec/specs/quick-open/spec.md:353` |
| F10 | 视觉桩已有「按 fixture 延时应答」的先例，可造装载中的时序现场 | `tests/visual/scenes/tauri-stub.ts:122-125`、`:867-868` |
| F11 | 装载在 `afterLoad` **之前**就激活：`loadSessionContent` 调 `activateSessionInOwnerPane` | `src/main.ts:2984` |
| F12 | `activateSessionInOwnerPane` 调 `activatePane` 与 `tabs.activateTab`；两者各自调 `syncActiveDocument` | `src/main.ts:554-559`；`activatePane` 的同步点 `:479-483`；`src/tabs.ts:423-436`（同步点 `:435`） |
| F13 | `QuickOpenHandle.close` 的公开签名无参数、返回包装也不转发；`goto-line` 的接口已带 `restoreFocus?` | `src/quick-open.ts:472-477`、`:1173-1175`；`src/goto-line.ts:71-77` |
| F14 | 所有文档共享同一个 `EditorView/contentDOM`，最终 `activeElement` 不能区分「旧文档获焦」与「新文档获焦」 | `src/editor.ts` 的单 view 模型；`openspec/specs/multi-tabs/spec.md`「单 EditorView」 |

结论：不改 caret、不改 `openFile` 的默认行为；创建分支补一次**有条件**的聚焦，并给本次装载
一个**被动关闭浮层**的选项，避免 `syncActiveDocument` 在 `openFile` 返回前抢焦。

## 2. 实现合同

### 2.1 判定与调用

```ts
// create-file 分支，await fsCreateFile 之前：
const claim = document.activeElement;
const created = await fsCreateFile(request.parentRel, request.name);
tree.endInlineEdit(true);
const opened = await openFile(created, openKind(created), "new", false, undefined, {
  passiveOverlayClose: true, // 仅本次创建装载生效
});
if (opened && (document.activeElement === document.body ||
               document.activeElement === claim ||
               document.activeElement === null)) {
  editor.focusPreservingReadingPosition();
}
```

- `claim` 取自 `await` 之前：此时焦点在内联输入框上，`submitting` 已置位，失焦不会取消提交。
- `openFile` 必须 `await` 并取返回值：`false`（dirty 守卫等）时不聚焦，避免把焦点交给一个
  没有打开成功的旧文档。
- 判定收成纯函数（如 `shouldClaimFocus(active, claim)`）便于单测；只放在 `src/main.ts` 或就近
  的纯逻辑模块，不新建编辑器 API。
- 判据是「焦点仍在 `body` / `null`（哪里都不在）或仍在提交时的输入框上」；其余一律放弃。
  `body` 是 `endInlineEdit` 删除输入框后的自然落点，代表「用户没有把焦点移到任何新目标」。
- 新建路径不可能已经是打开中的会话（路径此前不存在），因此 `openFile` 的 existing 分支不在
  本链路的关注面；若实现期发现反例，停下按影响面升级处理，不静默扩 scope。

### 2.2 passive close：只在本次创建装载生效

问题：装载**激活阶段**与装载收尾都会关 goto-line / quick-open，并且都早于（或等于）
`openFile` 返回：

```
openFile
  └─ loadSessionContent
       ├─ activateSessionInOwnerPane(session)          // main.ts:2984
       │    ├─ activatePane(paneId)                    // main.ts:557 → syncActiveDocument()
       │    └─ tabs.activateTab(session)               // main.ts:558 → syncActiveDocument()
       ├─ reloadSession(...)                           // 正文换成本次新文档
       └─ afterLoad() → syncActiveDocument()           // main.ts:3004 → 再关一次
```

三处 `syncActiveDocument` 都会 `gotoLine.close()` / `quickOpen.close()`；两者 `close()` 默认
`restoreFocus()`，即把焦点交给**当前前台文档**。激活阶段的前台已是新会话（但正文还没装载），
所以只改 `afterLoad` 挡不住真正发生抢焦的那一处。事后检查 `activeElement` 只能放弃再次聚焦，
无法撤销已经发生的抢焦。

合同：

- `OpenFileOptions`（或等价的第六参数）新增 `passiveOverlayClose?: boolean`，默认 `false`。
- 参数 MUST 沿**完整激活链**透传，不只 `afterLoad`：
  - `openFile` → `loadSessionContent`
  - `loadSessionContent` → `activateSessionInOwnerPane(session, options)`
  - `activateSessionInOwnerPane` → `activatePane(paneId, options)` 与
    `tabs.activateTab(session, options)`
  - `activatePane` → `syncActiveDocument(options)`
  - `TabsHandle.activateTab` → 它的 `syncActiveDocument` 注入（`main.ts` 里改为接收并转发
    `options`）。`activateTab` 内部还会调 `TabsDeps.activatePane()`；本链路里
    `activateSessionInOwnerPane` 已先翻好 pane，该调用是 no-op；若实现发现它可能先执行并
    触发默认 sync，则把 `options` 一并透传。
  - `loadSessionContent` → `afterLoad(options)` → `syncActiveDocument(options)`
- 这些同步点的默认值一律 `false`；只有 `submitInlineEdit` 的 `create-file` 分支传 `true`。
- `syncActiveDocument({ passiveOverlayClose = false } = {})` 调
  `gotoLine.close(!passiveOverlayClose)` 与 `quickOpen.close(!passiveOverlayClose)`：
  - `passiveOverlayClose = false`：默认行为逐字不变（快速打开仍是「关闭 + 交还编辑器」）。
  - `passiveOverlayClose = true`：浮层照旧关闭，但不把焦点交给当前前台文档；焦点先落到
    `body`，随后由 2.1 的判定交给新文档。
- **类型断点**：`QuickOpenHandle.close` 的公开签名当前是 `close(): void`（`src/quick-open.ts`
  的接口与返回包装），MUST 改为 `close(restoreFocus?: boolean): void` 并转发到内部
  `close(restoreFocus = true)`。`goto-line` 的 `GotoLinePrompt.close(restoreFocus?: boolean)`
  已支持，无需改签名。
- 其他 `openFile` 调用方（树点击 / 快速打开 / wikilink / 会话恢复）不传该选项，行为不变。
- 被动关闭 MUST NOT 改变浮层的状态清理（输入清空、Escape 层注销、可见性回调）。除
  `restoreFocus` 参数外，实现期补了一步**必要的**焦点动作：`close(restoreFocus = false)` 在
  `dismiss()` 之后，若焦点仍在已收起的浮层里，显式 `blur()` 把焦点放回 `body`（见 §6 的落地
  记录）。原因：浏览器对 `hidden` 元素的焦点修复发生在**下一帧**（HTML 的 focusing fixup 走
  update the rendering），晚于 `openFile` 返回后的收尾判定——不显式处理时，判定拍上读到的
  仍是那个已隐藏的 input，`shouldClaimFocus` 因此永假，浮层场景永不聚焦。用户已把焦点放到
  浮层之外时（失焦 / 点外部关闭两条既有 `close(false)` 路径）这一步是空操作。
- 焦点可观察保证：
  1. 装载期间（含激活阶段），用户打开的浮层输入框保持焦点，直到浮层被关闭；新文档装载完成前
     MUST NOT 发生任何编辑器获焦；
  2. 关闭后，若用户没有另找焦点目标，焦点落到新文档正文首行；
  3. 若用户在浮层之外另点了仍在场的目标（树行 / 编辑器 / composer），2.1 判定放弃，不拽回。

### 2.3 为什么用 `focusPreservingReadingPosition`

- 它是 M280 收敛后的唯一交还焦点实现：先取阅读位置、再聚焦、再经 CM 的滚动通道写回。
- 新文档的阅读位置本来就在原点（`reloadSession` 复位到篇首），写回是空动作，等价于「只聚焦」。
- 若改在 `reloadSession` 里 `focus()`，会波及所有打开路径（树点击、快速打开、链接跟随、
  会话恢复），违反本 change 的窄口径。

### 2.4 覆盖矩阵

| 入口 | 是否走本分支 | 期望 |
|---|---|---|
| 目录行菜单「新建文件」 | 是 | 打开成功后聚焦正文首行 |
| vault 根级菜单「新建文件」 | 是（同链路） | 同上 |
| 空 vault「新建笔记」 | 是（`tree.beginCreate("", "file")`） | 同上 |
| 目录行 / 根级「新建子目录」 | 否（无文档） | 焦点归还行为不变 |
| 文件树点击既有文件 | 否 | 不聚焦（反向判据） |
| 快速打开成功 | 否 | **仍交还编辑器**（既有合同，回归判据） |
| wikilink 跟随 | 否 | 焦点口径逐字不变（调用时焦点本就在编辑器） |
| 启动时的未命名文档 | 否 | 不聚焦 |

### 2.5 时序与竞态

- `openFile` 的 `await` 覆盖装载完成；返回值 `true` 时文档已装载，C3 的 caret 已就位。
- 装载期间用户若点进 harness composer / 文件树 / 编辑器，`document.activeElement` 不再是
  `body` 或 `claim`，判定放弃——不拽回、不改选区。
- 装载期间用户若打开 quick-open / goto-line：浮层保持焦点直到装载**激活或收尾**的同步点；
  这些同步点被动关闭浮层，不把焦点交给当前前台文档；随后 2.1 判定把焦点交给新文档。
- 若用户在装载期间又发起另一个创建，两个请求各自持有自己的 `claim`；后完成的那个只在焦点
  仍属于自己时才聚焦，先完成者不会抢后完成者的焦点。
- 若用户在装载期间关闭标签导致 `openFile` 返回 `false` / 文档已被替换，不聚焦。

## 3. 测试合同

### 3.1 chromium（结构 / 焦点 / 几何）

| 用例 | 断言 |
|---|---|
| 目录下新建 | `document.activeElement === view.contentDOM`；`view.state.selection.main.head === firstBodyLineStart(doc)`；`scrollTop === 0` |
| 根级新建 | 同上（证明同链路） |
| 空 vault「新建笔记」 | 同上 |
| 空文件 / 有 frontmatter 的文件 | 空文件 head = 0；有 frontmatter 时 head = 第一条正文行行首 |
| 装载中焦点被移到仍在场的目标（负例） | 给 `fs_read_snapshot` 加延时桩；装载途中点进 harness composer；断言焦点仍在 composer、编辑器选区与 `scrollTop` 未变、文档仍正常打开 |
| 装载中打开 quick-open（负例） | 延时桩生效后发 `⌘P`；从提交起同时监听 `focusin` 与 `lumir:source-ready`。分界 = **目标路径**的 `lumir:source-ready`（`detail.path === createdPath`；该事件由 `reloadSession` 的装载事务与初始 caret 规范化之后发出，见 `src/editor.ts:3274`）。断言：分界之前**没有任何 `contentDOM` 获焦**；分界之后才允许出现创建链路的最终聚焦。`focusin` 记录时间 / 目标 / 当时前台 path 供失败诊断；最终 `activeElement === contentDOM` **只作补充判据** |
| 装载中打开 goto-line（负例） | 延时桩生效后发 `⌥G`；同一分界（目标路径的 `lumir:source-ready`）与「之前无 contentDOM 获焦」判据；最终 `activeElement` 只作补充 |
| 快速打开成功（回归） | 打开 quick-open 并选中一个既有文件；浮层关闭后 `document.activeElement === contentDOM`（既有合同不变） |
| 文件树打开既有文件（反向） | 树点击后 `document.activeElement` 不是 `contentDOM` |
| 新建子目录 | 焦点行为与改动前一致（不聚焦编辑器） |
| 打开失败 | `openFile` 返回 `false` 时不聚焦、旧文档焦点不变 |

注意：负例必须真的让「装载中」发生（延时桩生效），否则测试会在装载完成后才移焦点，恒真。
照 REVIEW.md「断言等价于子串」条，先造一个必须 FAIL 的输入（去掉 passive close 或判定条件）
实测一次。

**为什么不能只断言最终 `activeElement`**：所有文档共享同一个 `EditorView/contentDOM`（F14）。
旧实现先在激活阶段把焦点交给旧文档，随后 `reloadSession` 把同一个 `contentDOM` 换成了新文档，
最终 `activeElement === contentDOM` 照样成立——这条断言对旧实现假绿。

**也不能用「旧文档标记消失 / 空文档文本」当分界**：会话激活阶段会 `view.setState` 清掉旧文档
（`src/editor.ts:2945`），而 `activateTab` 的默认 `syncActiveDocument` 抢焦发生在这之后、
真正的 `reloadSession` 之前——旧实现会在这个窗口里假绿。唯一可信的分界是目标路径的
`lumir:source-ready`：它在 `reloadSession` 的装载事务**与** `normalizeInitialCaret()` 之后
才发出（`src/editor.ts:3274-3275`），即「新文档内容与初始 caret 都已就位」。判据因此是
「目标 `source-ready` 之前没有任何 `contentDOM` 获焦」，而不是 DOM 文本变化。

若测试装配允许，可另加一个浮层 `restoreFocus` spy，断言创建链路的被动关闭没有调用它；spy 是
补充，不替代 `source-ready` 分界。

### 3.2 真机

- 扩展 `scripts/acceptance/scenarios/47c-create-and-delete.md` 的「新建文件并自动打开」步：
  - 加 `ax: { focused: "AXTextArea" }`（编辑器正文的读屏形态）；
  - 随后 `do: keys` 键入一个标记串，断言 `editor: { has: "/^MARKER$/" }`——新文件是空文档，
    唯一内容即证明落点在文档起点。
- 「装载中焦点被抢」与「装载中打开浮层」的时序反例在真机不好造，留给 chromium；真机只验正常
  路径。
- 同步核对 `COVERAGE.md` 的 47c 行描述（若步骤数 / 标题变化）。

### 3.3 既有场景回扫

- `rg "新建文件|新建笔记|beginCreate" scripts/acceptance/scenarios/` 逐条确认没有与「焦点留在
  文件树」相反的既有期望；发现相反期望的，按本 change 语义改准并在 tasks 里记录。
- `rg "quick-open|快速打开" scripts/acceptance/scenarios/` 确认既有的「快速打开后交还编辑器」
  期望没有被本 change 改坏。
- 视觉场景里若有「新建后焦点在树」的断言，同样回改。

## 4. 风险与处置

| 风险 | 影响 | 处置 |
|---|---|---|
| 只改 `afterLoad`，漏掉激活阶段的三处同步点 | 抢焦仍在 `openFile` 返回前发生 | passive 值沿完整激活链透传（design §2.2）；焦点事件序列判据覆盖激活阶段 |
| quick-open 公开签名不转发 `restoreFocus` | `quickOpen.close(false)` 类型报错或静默恢复焦点 | 接口与返回包装改为 `close(restoreFocus?: boolean)` 并转发；内部默认 `true` |
| 装载收尾的默认 close 在 `openFile` 返回前抢焦 | 用户浮层输入被打断，事后无法撤销 | 创建链路专用 `passiveOverlayClose`；延时装载 + 浮层负例 |
| 把 passive close 做成全局默认 | 快速打开 / 其它打开路径的焦点语义回归 | 选项默认 `false`；只有创建分支传 `true`；快速打开回归用例 |
| 装载慢时抢走用户焦点 | 打断输入 | 用 `claim` + `activeElement` 判定；负例必须真造装载中现场 |
| 在 `openFile` / `reloadSession` 里聚焦，波及所有打开路径 | 面变大、行为回归 | 只改创建分支；反向判据钉住「既有文件打开不聚焦」 |
| 裸 `view.focus()` 绕过 M280 | 阅读位置被拽回 | 统一走 `focusPreservingReadingPosition`；code review 检查 |
| 新文件打开失败仍聚焦 | 焦点落到旧文档 | 用 `openFile` 返回值闸门 |
| 真机时序反例造不出 | 负例覆盖缺口 | 负例留在 chromium；真机只验正常路径，并在 tasks 写明分工 |

## 5. 明确不做

- 不改 `openFile`、`loadSessionContent`、`activateSessionInOwnerPane`、`activatePane`、
  `TabsHandle.activateTab`、`reloadSession`、`syncActiveDocument` 的**默认**行为；只增加一个
  默认 `false` 的可选参数供创建链路使用。
- 不改快速打开的焦点交还语义；只把它的 `close` 公开签名补上可选 `restoreFocus` 并转发
  （默认 `true` 不变）。
- 不新增 `EditorHandle` 方法、不新增第二条聚焦通路、不新增配置 / 命令 / 键位。
- 不聚焦启动文档、不聚焦树点击打开的既有文件、不聚焦新建子目录。
- 不做焦点栈 / 焦点记忆。

## 6. 落地记录（实现期回改，2026-11-23）

- 行号（本 worktree 实现后读数）：`submitInlineEdit` `src/main.ts:2672`、create-file 分支
  `:2705`、`openFile` 调用与判定 `:2722` / `:2729`；`syncActiveDocument` `:2783`；
  `afterLoad` `:2831`；`openFile` `:2894`；`loadSessionContent` `:3025`；
  `activateSessionInOwnerPane` `:563`；`activatePane` `:484`；`TabsHandle.activateTab` /
  `DocumentSwitchOptions` 在 `src/tabs.ts`；`QuickOpenHandle.close` 在 `src/quick-open.ts`；
  判定纯函数 `src/focus-claim.ts`。
- 口径落点：`passiveOverlayClose` 的类型是 `src/tabs.ts` 的 `DocumentSwitchOptions`（单一
  来源，`src/main.ts` 只 import），沿 §2.2 的完整激活链逐层透传；`src/main.ts` 的
  `syncActiveDocument` 把它翻成 `gotoLine.close(!passive)` / `quickOpen.close(!passive)`。
- 被动关闭的焦点落点：`close(false)` 在 `dismiss()` 后把仍在浮层内的焦点显式 `blur()` 回
  `body`（§2.2 的补充条款）。不这样做时浏览器的焦点修复晚一帧，收尾判定读到的是已隐藏的
  input（实现期实测：quick-open / goto-line 两例都停在「浮层关了但新文档没获焦」）。
- 测试装配：`tests/visual/scenes/tauri-stub.ts` 的 `snapshotDelayMs`（按路径延时
  `fs_read_snapshot`）；场景 `tests/visual/scenes/focus-created-document-nov23.spec.ts`
  记录 `focusin`（时间 / 目标 / 当时 `.tab.is-active` 的 path / 正文是否仍是旧文档）与
  目标路径的 `lumir:source-ready`。go-to-line 的键位作用域是 `editor`，装载期间打开它必须先
  由用户把焦点放进编辑器；那次获焦按 `gesture`（mousedown / keydown 200ms 窗口）标记并从
  「应用抢焦」判据里排除，同时单独正向断言（证明标记没有把一切都吞掉）。
- 记录器与 `editorState` 取「不在 `.lumir-harness` 里的那个 `.cm-content`」：分栏后 composer
  也是 CodeMirror 实例，`querySelector` 可能先命中它（会读错文档、也把 composer 获焦误判成
  正文获焦）。
- 覆盖矩阵（14 例）：三入口（目录行 / 根级 / 空 vault）；装载中打开 quick-open 与 goto-line
  （light / dark 各一次）；**装载中焦点进入真实 harness composer**（⌘⇧A 分栏 + 点进 composer
  并键入，断言激活链零抢焦、输入不被清掉、正文从未获焦）；装载中焦点移到仍在场的树行；
  **未命名 dirty 守卫（`openFile=false`）**——文件照常建、不建标签、草稿留在前台、
  `.toast-dirty-guard` 上屏、提交后无编辑器获焦；装载读盘报错（`openFile=false` 的第二条
  路径）；**新建子目录**（标签数 / 前台标签 / 编辑器矩形 / 标签栏矩形 / 焦点逐值不变）；
  快速打开仍交还编辑器（回归）；树点击既有文件不聚焦（反向）。几何断言同时比编辑器与标签栏
  矩形（新建文件与新建子目录两处）。
- 两条守卫各自的反向验证：去掉 `shouldClaimFocus` → harness composer 负例红；去掉 `opened`
  闸门 → dirty 守卫负例红；在新建子目录分支注入聚焦 → 子目录负例红（日志见
  `.local/missions/focus-created-document-nov23/red-04/05/06-*.log`）。
