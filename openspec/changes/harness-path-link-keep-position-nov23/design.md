# Design: harness 路径链接保持位置 + 标签闪烁

> 本文件写实现合同与取舍，不是实现记录。行号是起草时（2026-11-23）在本 worktree 的读数，
> 实现时以符号为准。节点状态见 [proposal.md](proposal.md)：**节点 1 已按推荐批准**。

## 1. 事实底座（实现前必须成立，逐条可核）

| # | 事实 | 位置 |
|---|---|---|
| F1 | 正文链接触发 `ctx.openFile(path, line, lineEnd)` | `src/harness-panel.ts:1893`（接口声明 `:259`） |
| F2 | `openVaultPath` 取活跃 pane 的 handle，交 `jumpPlanFor` | `src/main.ts:3382-3399` |
| F3 | `openPathAtLine` 先 `open`，`line === undefined` 直接返回，不碰视口 | `src/harness-path-link.ts:404-420`（返回在 `:411`） |
| F4 | 已在前台时 `activate()` 早退；切后台标签时存 / 恢复各自 `scrollSnapshot` | `src/editor.ts:2907`、`:2919`、`:2948` |
| F5 | `revealLineAt` 把选区移到行首 + 滚到居中；行高亮独立 | `src/editor.ts:3066-3075`、`:3106-3121`；`NAVIGATION_HIGHLIGHT_MS = 1400`（`src/navigation-highlight.ts:17`） |
| F6 | 标签栏全量重建，只有 `.is-active`，没有闪烁态 | `src/tabs.ts:336-469`；`src/style.css:554-616` |
| F7 | 文件树定位已有「短暂高亮」先例：按 DOM 行记账、1200ms、`--sel` 底色 | `src/tree.ts:152`、`:1177-1204`；`src/style.css:1285-1293` |
| F8 | 工具卡片与正文共用同一 `openVaultPath` | `src/harness-panel.ts:6337` |
| F9 | `sessionForPath` 是精确字符串比较；`.` / `..` 形态被候选校验拒绝 | `src/editor.ts:3382-3384`；`src/harness-path-link.ts:116-127` |
| F10 | harness 在场时文档 pane 至多一个（跨 pane 分支结构上不可达） | `openspec/specs/pane-layout/spec.md` 的 pane 容器模型 |

## 2. 行为合同

### 2.1 `openVaultPath` 分档

```ts
openVaultPath: (path, line, lineEnd) => {
  const existing = editor.sessionForPath(path);
  const foreground = existing !== undefined && existing === editor.activeSession();
  if (existing !== undefined && foreground && line === undefined) {
    activeTabs().flash(existing);   // 关键：不调 openPathAtLine / openFile
    return;
  }
  const handle = activeEditor();
  const plan = jumpPlanFor(handle, path, line);
  void openPathAtLine(plan, path, line, lineEnd).then((opened) => {
    if (opened && existing !== undefined) activeTabs().flash(existing);
  });
}
```

判定矩阵（`existing` = 已在任一处打开；`foreground` = 它就是活跃 pane 的前台会话）：

| `existing` | `foreground` | `line` | 动作 | 标签反馈 |
|---|---|---|---|---|
| 否 | — | 任意 | 既有 `openPathAtLine`（新标签 + 可选行锚） | 不闪 |
| 是 | 是 | `undefined` | **短路**：只 `flash` | 闪 |
| 是 | 是 | 有值 | 既有链路（`activate` 早退 + reveal + 行高亮） | 闪 |
| 是 | 否（同 pane 后台） | 任意 | 既有链路（切标签 + 恢复自身快照 + 可选行锚） | 闪 |

- 短路分支 MUST NOT 调 `openFile`：即使 `openFile` 对已在前台的文件是 no-op，它仍会经过
  `activateSessionInOwnerPane` / `syncActiveDocument`（收起 goto-line / 快速打开等），这些副作用
  不属于「点一条路径看它在哪」。
- 短路分支 MUST NOT 改 `scrollTop`、选区、`caret`、文档字节、dirty、撤销栈；MUST NOT 重载。
- 焦点：只写 class 与计时器，不调任何 `focus()`；焦点留在 harness composer。仅靠这一点不够：
  路径按钮是 `<button>`，鼠标按下会先聚焦按钮，`click` 阶段的 `preventDefault()` 救不回来。
  因此 `createPathLinkEl`（`src/harness-panel.ts:1849`，正文与卡片共用）SHALL 增加**按钮级**
  `mousedown` → `event.preventDefault()`（不 `stopPropagation`；MUST NOT 挂容器级监听，见
  REVIEW.md「标题栏 preventDefault」条的同族纪律）；既有 `click` 与 `keydown` Enter 两条激活
  路径不变。正文（`:1887`）与工具卡片（`:6208`）各测一例。
- 卡片带 `offset`：只滚动落行、**不产生正文行高亮**（既有禁令；卡片不传 `lineEnd`，见
  `src/harness-path-link.ts:344`），标签照常闪一次。正文行锚才是「滚动 + 行高亮」。
- 目录路径不经过本函数的分支（`revealVaultDir` 独立），行为不变。

### 2.2 纯函数与单测矩阵

把判定抽成纯函数（例如 `linkDisposition({ exists, foreground, line })` →
`"flash-only" | "open-and-maybe-flash"`），单测覆盖：

| 输入 | 期望 |
|---|---|
| 未打开 × 前台 × 无行锚 | `open-and-maybe-flash`，且 `existing` 为 `undefined` 时打开后不闪 |
| 已打开 × 前台 × 无行锚 | `flash-only` |
| 已打开 × 前台 × 有行锚 | `open-and-maybe-flash`（随后闪） |
| 已打开 × 后台 × 无行锚 / 有行锚 | `open-and-maybe-flash`（随后闪） |
| 已打开 × 非活跃 pane | 走既有 `openFile` 的移动语义；本 change 不新增语义 |

`openPathAtLine` 本身不改：它的「无行号不碰视口」语义对快速打开等其它调用方仍然正确。

### 2.3 标签闪烁 API

`TabsHandle` 新增：

```ts
flash(session: EditorSession): void
```

实现要点：

1. **按会话对象记账**：模块内 `let flashed: EditorSession | null` 与 `let flashTimer`；不把状态
   只存在 DOM 节点上。`renderTabs()` 全量重建时，对 `session === flashed` 的标签重新
   `classList.add("is-flash")`——重建不能丢闪烁态。
2. **重置语义**：再次 `flash(same)` 或 `flash(other)` 先清旧计时器与旧 class，再施加新 class 并
   重新计时；同一时刻至多一个标签闪烁。
3. **清理**：计时结束移除 class 并清空 `flashed`；会话关闭路径（`closeTabNow` / 批量关闭）与
   标签栏销毁时清计时器与状态。计时回调若发现槽已卸载，MUST 先清空 `flashed` 与计时器再返回，
   MUST NOT 只 `return` 留下状态。
4. **生命周期接线**：`TabsHandle` 新增 `dispose(): void`。`disposePaneHandle`
   （`src/main.ts:456`）SHALL 在 `handle.editor.view.destroy()` **之前**调用
   `assembly.tabs?.dispose()`（或等价地把它注册进 `assembly.unsubs`，保证收 pane 必达）；
   `dispose()` 清计时器、清 `flashed`、移除残留 class。双 pane 收拢与关 pane 两条路径都补
   「闪烁中收 pane」用例：不得留 class、不得留计时器、不得有指向已销毁节点的回调。
5. **时长**：`NAVIGATION_HIGHLIGHT_MS`（1400ms）。MUST NOT 新造第三个时长；与行高亮同长，
   两者同拍消退。
6. **不触碰**：激活态、dirty 点、关闭按钮、读屏名、`aria-selected`、标签顺序。

### 2.4 CSS 与 token

```css
.tab.is-flash { background: var(--sel-band); }
```

- 位置放在 `.tab:hover` 与 `.tab.is-active` **之后**：三条同特异性（`.tab` + 一个 class / 伪类），
  后声明者胜；指针停在标签上时闪烁仍可见。
- `--sel-band` 三主题现值：light `#c6c5bf`、dark `rgba(255,255,255,.22)`、eink `#b9b9b9`。
  与 `.tab.is-active` 的 `--content-bg`（light `#fdfdfc` / dark `#222326` / eink `#ffffff`）
  有足够对比；MUST NOT 用 `--sel`（light `#e8e7e1` 与激活底色过近）。
- 不改 `font-weight` / `border` / `box-shadow` / 尺寸；`.tab` 已有 `background` 过渡
  （`--dur-ui`），闪烁的进出沿用这条既有过渡，不新增动效曲线。
- eink：底色 `#b9b9b9` + 文字 `--text`（黑），不新增描边；与 `.ft-row.is-revealed` 的 eink
  处理同族，但本处只改底色，不改前景。

## 3. 测试合同

### 3.1 chromium（结构 / 几何 / 焦点矩阵）

| 用例 | 断言 |
|---|---|
| 前台裸路径（长文档滚到中部） | `scrollTop` / `selection.main` / 正文逐字节 / dirty 点逐值不变；**不触发打开 / 同步链路**的仪器：跳转行浮层不被收起（`syncActiveDocument` 的第一件事）、标签栏无 childList 重建、active 标签节点身份不变；点击前键入的字符可被真实 `Meta+z` 撤掉（撤销栈未清空）；`.tab.is-flash` 立刻在场；1.4s 后消失；`.tab.is-active` 全程不变 |
| 前台裸路径的焦点 | `document.activeElement` 仍是 harness composer 的 `.cm-content` |
| 后台标签裸路径 | 切到该标签；`scrollTop` 等于它离开时的快照（不是 0）；闪一次；标签总数不变 |
| 未打开裸路径 | 新标签打开并前台；无 `.tab.is-flash` |
| 行锚（`:39` / `:39-48`） | `scrollTop` 变化、目标行居中、`.cm-line-highlight` 在场；标签闪一次；既有的「重复点击重置高亮」「切标签清除」用例不变 |
| 工具卡片裸路径（已在前台） | 同前台裸路径：不滚、不动选区、只闪 |
| 工具卡片 `offset` | 滚动到落点行；**无 `.cm-line-highlight`**（既有禁令）；闪标签 |
| 正文路径按钮 mousedown | 在按钮上按下鼠标（不松开）→ `document.activeElement` 仍是 composer；完成 click 后打开 / 闪烁照旧；Enter 激活可用 |
| 工具卡片路径按钮 mousedown | 同上（卡片入口单独一例） |
| 重复快速点击同一路径 | 闪烁计时重置、只有一层高亮、无残留 |
| 标签栏重建 | 闪烁中途触发 `renderTabs`（如另一标签 dirty 变化），新 DOM 仍带 `.is-flash`，计时继续 |
| 闪烁中收 pane（视觉现场不可达，单测覆盖） | 现行布局 pane 上限二、harness 在场时文档 pane 唯一 ⇒ 右 pane 的标签不可能被 harness 路径链接闪烁命中。由单测验证：`dispose()` 后**不推进计时**即 `renderTabs()` 不复活 class（`flashed` 已清）、`clearTimeout` 被调用（旧 timer 已撤销）、计时推进后仍无残留；再加「只摘 class、留状态 / 计时器」的退化实现反证 |
| 目录链接（反向） | 编辑器 `scrollTop` / 选区 / 标签不变；树行高亮照旧；无 `.tab.is-flash` |
| 同名不同目录（反向） | 两个路径各开一个标签，不做 alias 去重；闪烁落在实际目标的标签上 |
| 标签几何 | 闪烁前后标签 `getBoundingClientRect()` 逐值不变（宽 / 高 / x） |

时序注意：`.tab.is-flash` 是瞬态，断言「1.4s 后消失」用有界轮询（如 `expect.poll`），不要
固定 `waitForTimeout` 后一次性读；截图前必须等它消退。

**「不重载」的判据口径**：不比较 `EditorState` / `Text` 对象身份——打开跳转行浮层会安装 md
行号 gutter，这是一次合法的 compartment 重配，同样会换 `EditorState`；用身份比较既会把合法
重配误判成缺陷，又放行「保留同一 `Text` 的重配」。页面读不到 CM 的 history depth，因此撤销栈
**不写深度读数**，改用真实行为：点击前键入一个字符（dirty 转真），点击后 `Meta+z` MUST 撤掉
它且 dirty 点回到隐藏——重载会清空历史，这条会红。正文与工具卡片两个入口各跑一遍同一组仪器；
两者共用 `openVaultPath`，没有第二份判定。

### 3.2 真机（场景 221 扩展）

- 新增一步「点裸路径（目标已在前台）」：点击前用 `do: recordEditor` 记基线 + 截图，点击后：
  - `editor: { unchangedSince: <基线名> }` 做**逐字节**比较（验收 README 的 `recordEditor` /
    `unchangedSince` 通道；MUST NOT 用「`has` 关键标记 + 目标行不出现」这类子串近似）；
  - 标签栏出现闪烁态截图（点击后 ~0.6s 内，1.4s 窗口内）；
  - 不点任何东西直接 `do: keys` 输入一个字符：`editor: { unchangedSince: <基线名> }` 仍成立、
    composer 文本变化——证明焦点没有被编辑器抢走；焦点判据同样复用这份基线，不另写子串断言。
- `scrollTop` 在 AX 读不到（`scripts/acceptance/README.md` 已登记），「不滚动」只能靠截图前后
  对照与「目标行不出现」间接判；不要伪造 AX 判据。
- 既有行锚步骤（`:39` / `:39-48`）保持并通过；新增的闪烁断言不改变它们的高亮判据。
- 若新增场景编号 / 标题，同步 `COVERAGE.md`。

### 3.3 既有场景回扫

- `rg "harness|路径|goto-line" scripts/acceptance/scenarios/` 找出所有点路径链接的场景
  （至少 221、可能 232 / 238 等），逐条确认：
  - 没有把「点裸路径后编辑器滚动」写成期望的；
  - 没有在闪烁窗口内截图的；
  - 有则按本 change 改准并在 tasks 记录。

## 4. 风险与处置

| 风险 | 影响 | 处置 |
|---|---|---|
| 闪烁被拍进整页 / 元素基线 | 基线假红或把瞬态固化 | 截图前等 1.4s + 一帧；CI 结构层不拍像素；本地 visual 先看 diff 位置 |
| 全量重建丢闪烁态 | 反馈时有时无 | 按会话对象记账，`renderTabs` 重新施加；专门用例 |
| 计时器泄漏 / 回调打到已销毁节点 | 运行时错误 | `TabsHandle.dispose()` 接入 `disposePaneHandle`；回调发现卸载先清状态再返回；「闪烁中收 pane」用例 |
| 只写 click.preventDefault，鼠标按下已夺焦 | 「焦点留在 composer」失效 | 按钮级 mousedown preventDefault；正文与卡片各一例；Enter 激活回归 |
| `--sel-band` 与激活态对比不足 | 闪烁看不见 | 三主题对比已列；eink 用 `#b9b9b9` + 黑字；不引入新色 |
| 短路分支漏掉必要的表现层同步 | 标签 / modeline 状态漂移 | 短路只发生在「前台 + 无行锚」，此时前台文档未变，`syncActiveDocument` 本来无事可做；用「无副作用」用例钉住 |
| 真机读不到 `scrollTop` | 「不滚动」判据弱 | 截图对照 + 目标行不出现 + 焦点输入证明；不伪造 AX 读数 |
| 卡片与正文判定分叉 | 同一路径两种反馈 | 两入口共用 `openVaultPath`；分档判定抽纯函数；卡片用例 |

## 5. 明确不做

- 不改 `openPathAtLine` 的两种语义、不改 `jumpPlanFor` 的复核算式、不改路径识别 / 行号解析。
- 不改 `openFile` / `activate` 的通用打开语义；不为跨 pane 设计新分支。
- 不给新标签闪烁、不给目录链接闪烁、不给文件树行加第二套闪烁。
- **不把工具卡片 `offset` 改成产生行高亮**：既有禁令保留；卡片只滚动落行 + 闪标签。要加卡片
  高亮属于新的行为变更，另行送裁。
- 不新增配置 / 命令 / 键位 / token / 时长常量。
- 不把焦点移入编辑器；不改变标签激活态、dirty 点、关闭按钮、读屏名。
