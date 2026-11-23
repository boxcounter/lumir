# Design: 光标宽度恢复 CodeMirror 默认

> 本文件写实现合同与取舍，不是实现记录。行号是起草时（2026-11-23）在本 worktree 的读数，
> 实现时以符号为准。节点状态见 [proposal.md](proposal.md)：**节点 1 已按推荐批准**。

## 1. 事实底座（实现前必须成立，逐条可核）

| # | 事实 | 位置 |
|---|---|---|
| F1 | 应用覆盖光标样式为 `borderLeft: "2px solid var(--text)"` + `marginLeft: "-1px"` | `src/editor.ts` 的 `baseTheme`（实现前读数 `:2186`） |
| F2 | CM 基础主题默认 `.cm-cursor` 为 `border-left: 1.2px solid black` + `margin-left: -0.6px` | `node_modules/@codemirror/view/dist/index.js` 的 `baseTheme`（检索 `cm-cursor`） |
| F2a | **计算样式会取整**：渲染引擎把亚像素 `border-width` 取整到整数 CSS 像素——Chromium DPR=1 下 `1.2px` 读回 `1px`（`1.5` / `1.6px` 同为 `1px`，`2px` 仍是 `2px`）；`marginLeft` 不取整。作者值只能从 CSSOM 的级联声明读 | 实现期实测（2026-11-23，chromium headless shell）：runs 记录在 `.local/missions/caret-default-nov23/` |
| F3 | 闪烁由 CM 基础主题挂在 `.cm-cursorLayer` 上（`cm-blink` / `cm-blink2` 交替，1.2s），本仓只写 `cursorBlinkRate` 的默认周期 | `src/editor.ts` 的 `baseTheme` 上方注释；`tests/visual/scenes/m647-caret-geometry.spec.ts` 的动画读数 |
| F4 | 颜色必须被覆盖：CM 默认 `black` 在 dark 主题（`--text: #e3e2db`）下不可见 | `src/style.css` 的 `--text` 行 |
| F5 | 现行机器判据钉死 2px / -1px | `tests/visual/scenes/m647-caret-geometry.spec.ts` 的三主题「光标计算样式」用例（实现前 `:485`、`:487`） |
| F6 | 现行文档把 2px 登记为组件常量 | `docs/specs/design-tokens-v1.md`「阴影与 hairline」；`docs/specs/editor-caret.md`「实现落点」 |
| F7 | 2026-10-23 的原始实现只覆盖颜色，宽度就是 CM 的 1.2px | `openspec/changes/archive/2026-10-24-cursor-visibility-oct23/proposal.md` §2 |
| F8 | 真机场景 228 的标题与说明写 2px，但不含线宽机器断言 | `scripts/acceptance/scenarios/228-caret-visibility.md` 的 front-matter 标题、eink 步骤说明、改裁说明、覆盖边界 |

## 2. 实现合同

### 2.1 覆盖面收缩到颜色

```ts
".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" }
```

- MUST NOT 保留 `borderLeft`（宽度 / 样式 / 颜色三合一的简写）——用简写就必须再写宽度，等于
  继续覆盖。
- MUST NOT 保留 `marginLeft: -1px` 覆盖——它是 2px 的居中量；1.2px 的居中量 `-0.6px` 由 CM
  给出，本仓不写。
- 宽度的唯一来源是 CM 基础主题；未来若 CM 升级改变默认值，本仓跟随升级，不另行钉值。
- 注释按三次改裁重写：2px 的来历、2026-10-24 的闪烁改判、2026-11-23 的宽度回退，并写明
  「MUST NOT 以再粗一点为由回改」。

### 2.2 eink

三主题同值。eink 的可发现性由闪烁承担，不由线宽承担：1.2px 与 eink 的 1px hairline 只差
0.2px，`--border` 与光标同为 `#000000`，宽度差在该档不可作为机器或人眼判据。若 dogfood 认为
eink 不可见，按「新的裁决」处理（改 requirement + 改裁记录），MUST NOT 在实现里私自加回 2px。

### 2.3 文档与判据的同批清扫

| 文件 | 改什么 |
|---|---|
| `openspec/changes/restore-default-caret-width-nov23/specs/ui-design-system/spec.md` | 本 change 的 delta（归档时并入 living） |
| `docs/specs/editor-caret.md` | 「实现落点」的光标段落与验证层表格里的 2px / -1px |
| `docs/specs/design-tokens-v1.md` | 「阴影与 hairline」的光标条目：撤销组件常量登记，写明取 CM 默认 |
| `tests/visual/scenes/m647-caret-geometry.spec.ts` | 三主题用例 `2px` → `1.2px`、`-1px` → `-0.6px`；新增反向断言 |
| `scripts/acceptance/scenarios/228-caret-visibility.md` | 标题、eink 说明、改裁说明、证据说明里的「2px」改准 |
| `scripts/acceptance/COVERAGE.md:208` | 与场景标题同一句改准 |
| `src/editor.ts` | 覆盖行 + 注释 |

`rg "2px"` 的命中里，引用块竖线、`is-active` 描边等其他 2px 用法不在本 change 面内，不要误改；
只改「光标宽度」这一语义的副本。

## 3. 验证合同

### 3.1 计算样式（权威判据）

`m647` 三主题各取一次：

| 读数 | 期望 | 区分度 |
|---|---|---|
| 级联声明：匹配光标元素的 `border-left-width`（CSSOM） | 恰好一条，值 `1.2px`（CM 基础主题；本仓主题规则不声明宽度） | 「声明列表 = `["1.2px"]`」——2px 覆盖回潮即变成 `["1.2px","2px"]`，必红 |
| `getComputedStyle(.cm-cursor-primary).borderLeftWidth` | `1px` 或 `1.2px`（引擎取整差异，见 F2a） | 反向断言 `!== "2px"`——回粗必红 |
| `marginLeft` | `-0.6px` | 反向断言 `!== "-1px"`（2px 宽度的居中量） |
| `borderLeftColor` | 该主题 `--text` 的计算值 | 防止顺手把颜色也还给 CM |
| `.cm-cursorLayer` 的 `animationName` / `duration` / 循环 / 运行态 | `cm-blink*` / `1.2s` / `infinite` / `running` | 防止把闪烁一起回退 |
| 0ms / 700ms 的 `opacity` | `1` / `0` | 既有相位判据不变 |
| 未聚焦 `display` | `none` | 既有判据不变 |

注意：`borderLeftWidth` 的**声明值**是 `1.2px`（CSS 值，不是设备像素），但计算样式在 Chromium
DPR=1 下会取整成 `1px`（F2a）——判据因此分两路：声明值钉 `1.2px`，计算值只钉「落在
1px / 1.2px 档且不是 2px」。**MUST NOT** 在截图里数设备像素当判据；DPR 与抗锯齿会让 1.2px 在
不同屏幕上落到 1 或 2 个设备像素。

### 3.2 真机

- 场景 228 的步骤与断言不变（它不读线宽）；只改标题与说明文字，截图重拍作为观感证据。
- 「光标是否够显眼」归 Alex 手感裁决，不进机器判据；eink 的残影 / 闪烁观感同样归手感项。
- 证据落 `.local/acceptance/<批次>/`（git 外），用绝对路径 `ls` 确认后再写进报告。

### 3.3 像素基线

光标是瞬态装饰，整页 / 元素基线通常不包含它。若 `scripts/gate.sh visual` 报像素差异：

1. 先确认差异是否来自光标（看 diff 图的位置与形状）；
2. 出候选截图落 `.local/reviews/ux-improvements/`（git 外）；
3. `--update` 是 Alex 人肉裁决点，未过目不得执行。

## 4. 风险与处置

| 风险 | 影响 | 处置 |
|---|---|---|
| 1.2px 在 WKWebView 上实际渲染偏细、观感回到 2026-10-23 之前 | 可发现性下降 | Alex 已裁决接受；dogfood 若仍觉得太细，走新裁决，不静默回改 |
| eink 下 1.2px 与 hairline 难分 | eink 可发现性 | 由闪烁承担；场景明写「不以宽度差为判据」 |
| 三次改裁来回翻 | 后续 agent 再改回 2px | requirement 本体 + 代码注释 + 文档三处写「MUST NOT 回改」 |
| 「同一语义两处真源」漏改 | 文档说 2px、代码是 1.2px | 交付前 `rg` 全仓 2px 命中逐条核对；任务单列清扫项 |
| 截图数像素造成假红 / 假绿 | 判据失真 | 权威判据只认计算样式；截图只作观感 |

## 5. 明确不做

- 不改 `EditorView.cursorBlinkRate`，不新增 animation 覆盖（`!important` 会压住 CM 的内联相位
  重启，见现有注释）。
- 不改光标高度、`drawSelection` 装配、选区底色、eink 描边规则。
- 不为光标新增 token；不把 1.2px 登记成新的「组件常量」——它就是依赖的默认值。
- 不做 1.5px，不做 eink 特例。
