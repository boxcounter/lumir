# Design: 浮层宽度合同——三档、em 上限、单点夹取

> 依据：`.local/reports/m698-overlay-width-audit-oct24.md`（M698，只读 survey）。
> 本文件只写「怎么做」与判据落点；Requirement 正文在 `specs/ui-design-system/spec.md` delta。

## 1. 不变量

- **W1 内容优先**：打开态浮层的宽度 = `clamp(内容固有宽, 档位下限, min(档位 em 上限, 宿主可用宽 − 2×inset))`。
  MUST NOT 用与内容无关的定值同时承载「短内容不空旷」与「长内容不折行」；短内容 MUST NOT
  被拉伸到超过 `max(固有宽, 下限)`。**列表类浮层例外**：宽度取约定宽（em 上限 + 视口 / pane
  夹取）而不是逐帧测内容，避免打字时宽度抖动；其行内容按 W5 处理。
- **W2 上限随字号**：凡文字随 `--lumir-hp-scale`（或编辑器字号）缩放的浮层，宽度上限 MUST 用
  `em`（相对自身 font-size）。当前 px 上限在 2.13 档把 ctxpop 顶成 3 行、会话名裁 81%。
- **W3 单一夹取**：收窄 / 换边 / 平移 MUST 收敛在一处实现（`src/overlay-placement.ts` 的
  `placeOverlay`），消费者 MUST NOT 各写一份。判据：`harness-panel.ts` 只保留一处调用点族。
- **W4 换边优先于长距平移**：在两侧锚定边里选**位移最小**者；组件默认边只在位移相同时生效。
  宽度接近宿主可用宽时两侧位移都不可避免——此时按可用宽铺满（`width = avail`），不为了
  「换边」制造更大的位移。
- **W5 截断方向**：单行截断 MUST 保住内容的身份主体——路径保**文件名**（目录前缀可中段省略）、
  标题保开头、模型 / 会话名保全名；被截断的条目 MUST 有 `title`（或等价全文通道）。
  路径类 MUST 采用 `collapseMiddleDirs`（M606）的口径：文件名恒完整、目录只作消歧辅助；
  MUST NOT 再写第二份「从尾部截断整串」或「无条件折成 `…/文件名`」的折叠——前者吃掉文件名，
  后者让同名文件在列表里不可分辨。
- **W6 打开后变化重夹**：可用区从视口细化为**所属 pane**（harness 浮层）；打开态的浮层在
  pane / 视口尺寸变化后 MUST 重夹（或收起），MUST NOT 停在越界位置。

## 2. 三档（按内容类别，不按组件）

| 档 | 适用 | 宽度 | 下限 | 上限 | 单行处理 |
|---|---|---|---|---|---|
| **C 紧凑** | 单行定长（跳转行、浮钮） | `min(内容, 24em, 可用)` | 160px | 24em | 尾省略 + title |
| **L 列表** | 单行列表（⌘P / 大纲 / vault / 会话 / 选择器） | `clamp(内容, 200px, min(26em, 可用))` | 200px（组件可覆盖：sesspop 200 / selpop 188） | 26em | 路径保文件名、名字 + title |
| **P 说明** | 多行说明（ctxpop / permpop 释义 / effhint） | `clamp(内容, 200px, min(34em, 可用))` | 200px（组件可覆盖：ctxpop / effhint 224、permpop 208） | 34em | 折行，不截断 |

- `em` 的基准是**元素自身的 font-size**（含 `--lumir-hp-scale`）：`34em` 在 12px 基线下
  408px，在 2.13 档 12×2.13×34 ≈ 869px。
- 「可用」= 宿主宽 − 2×inset（inset 8px）。harness 浮层的宿主是 **pane**（`.lumir-harness`），
  不是视口——pane 是 `overflow: hidden`，越界即被裁（O1）；`position: fixed` 的会话浮层
  宿主是视口（其包含块不落在裁切祖先里，O3）。
- 健康反例（指针菜单 / 删除确认 / 键位面板 / 全屏内容）归 `exempt` 档，不改形态。

## 3. helper（`src/overlay-placement.ts`）

```ts
export type OverlayTier = "compact" | "list" | "prose";

export interface OverlayPlacementInput {
  tier: OverlayTier;
  natural: number;        // 内容固有宽（border-box px；DOM 侧用 width:max-content 量）
  host: number;           // 宿主可用宽（pane / 视口）
  hostLeft: number;       // 宿主左缘（视口坐标）
  fontSize: number;       // 浮层自身 font-size（em 上限的换算基准）
  anchor: { left: number; right: number }; // 锚点（wrapper）矩形，视口坐标
  preferred: "left" | "right";             // 组件默认锚定边
  leftOffset?: number;    // 默认左锚时的额外偏移（0）
  rightOffset?: number;   // 默认右锚时右缘越出锚点的距离（ctxpop = 18）
  inset?: number;         // 宿主两侧留白（缺省 8）
  minWidth?: number;      // 组件下限覆盖
}

export interface OverlayPlacement {
  width: number;          // 最终宽（收窄后）
  left: number;           // 最终左缘（视口坐标）——平移后的结果
  side: "left" | "right"; // 最终锚定边（换边与否）
  shift: number;          // 相对默认落点的位移（诊断 / 断言用）
  cap: number;            // 生效的 em 上限（px）
  avail: number;          // 宿主可用宽
}
```

算法（纯函数，无 DOM）：

1. `cap = maxEm(tier) × fontSize`；`avail = host − 2×inset`；`max = min(cap, avail)`；
   `floor = min(minWidth ?? tierMin(tier), max)`；
   `width = min(max(natural, floor), max)`。
2. 对两侧各算默认落点：
   - `left` 侧：`defaultLeft = anchor.left + leftOffset`；
   - `right` 侧：`defaultLeft = anchor.right + rightOffset − width`。
   再把 `defaultLeft` 夹进 `[hostLeft + inset, hostLeft + host − inset − width]`，记位移。
3. 选 `|shift|` 较小的一侧；相等取 `preferred`。返回 `{width, left, side, shift, cap, avail}`。

DOM 侧的三个适配函数（同模块，单测只覆盖纯函数）：

- `measureOverlayNaturalWidth(el)`：清 inline `width/min-width` → 读 `getBoundingClientRect().width`
  （CSS 的 `width: max-content` + `max-width: <N>em` 已先生效）；
- `overlayFontSize(el)`：`parseFloat(getComputedStyle(el).fontSize)`，非法回落 12；
- `applyOverlayPlacement(el, placement, host)`：写 `width` 与 `left`（`position: fixed` 以视口为
  基准；`absolute` 以 `offsetParent` 左缘折算），清 `right/translate`。

## 4. 逐组件落地

| 组件 | 现在 | 目标 | 机制 |
|---|---|---|---|
| `.lumir-qo` / `.lumir-toc` | 定值 300px | `min(26em, 100vw − 28px)` ≈ 325px | 纯 CSS；容器 `font-size: --fs-ui-s` 作 em 基准 |
| `.lumir-qo` 行 | 全文 + 尾省略、无 title | 目录前缀（可中段省略）+ 文件名（不收缩）+ `title` | DOM 两段 + flex 收缩比，textContent 仍是完整路径 |
| `.vault-pop` | 定值 320px | `min(320px, 100vw − 16px)` | 纯 CSS |
| `.lumir-hp-ctxpop` | 定值 224 / 只缩 | 内容驱动 + 34em + 下限 224 | CSS `max-content` + JS helper |
| `.lumir-hp-permpop` | 内容 + 收窄 | 内容驱动 + 34em + 下限 208 | CSS + helper（替换 clampPermPop） |
| `.lumir-hp-effhint` | 定值 224、无夹取 | 同 ctxpop | CSS + helper（新增） |
| `.lumir-hp-selpop` | 内容、无夹取 | 内容驱动 + 26em + 下限 188 | CSS + helper（新增） |
| `.lumir-hp-sesspop` | 定值 200 | 内容驱动 + 26em + 下限 200 | CSS + helper（替换 placeSessPop 的宽度段） |
| `.ft-menu` / `.tab-menu` / `.ft-confirm` / bindings / 全屏面板 | 已健康 | 不改 | 注册表 `exempt` |

**⌘P 行结构**（W5 / D3）：

```html
<div class="lumir-qo-item" title="notes/2026/projects/lumir/weekly.md">
  <span class="lumir-qo-dirs">notes/2026/projects/lumir/</span><span class="lumir-qo-name">weekly.md</span>
</div>
```

- `.lumir-qo-dirs { flex: 0 9999 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis }`；
- `.lumir-qo-prefix` / `.lumir-qo-suffix`（直接打开行的动作前缀与模板尾串）
  `{ flex: 0 99 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis }`——**先于文件名
  牺牲**：动作提示是辅助信息，文件名是身份主体；
- `.lumir-qo-name { flex: 0 1 auto; min-width: 0; }`（目录与前缀归零后才截，是「不可达上限 +
  title」的兜底）；
- `.lumir-qo-item { display: flex; overflow: hidden }`，textContent 拼接后仍是完整路径
  （匹配语义与既有逐条文本断言不变）。

**直接打开行的收缩次序**（M702 r1 的现场）：候选行只有目录 + 文件名；直接打开行多一段动作
前缀（`按 Enter 打开` / `按 Enter 只读打开`），英文模板还可能有尾串（` read-only`）。1200×800
正常窗口下，目录已归零后 224/231px 的文件名仍被裁 7px（前缀 `flex: none` 不可收缩）。修正后
收缩次序是 `dirs(10⁷) → prefix/suffix(10⁵) → name(1)`：正常可用宽度下文件名完整，动作前缀
出省略号；只有前缀也归零、宿主窄到放不下文件名本身时才轮到 `title` 兜底。

**为什么不是「无条件折叠成 `…/文件名`」**：quick-open 的匹配语义是完整相对路径，同名文件
（`a/plan.md` / `b/plan.md`）必须能在同一条列表里分辨；无条件折叠会让两条行文本相同。
中段省略只在放不下时发生，且文件名恒完整。

## 5. 单点夹取与重夹

- `harness-panel.ts` 里三份 clamp 收敛为 `placePop(el, {tier, host, preferred, ...})`；
  `clampCtxPop` / `clampPermPop` / `placeSessPop` 函数名与调用点保留（调用方语义不变），
  函数体内改调 `placePop`。
- 新挂 `ResizeObserver` 观察 `panel` + `window.resize`：任一处触发时对**仍打开**的浮层
  重跑同一套 `placePop`（幂等：先复位 inline 宽 / 位置再量）。
- `selpop` / `effhint` 原本没有夹取，打开路径补一次 `placePop`；重建内容（`buildSelPop` /
  `buildPermPop` / `buildCtxPop`）后同在下一个同步任务里重夹。

## 6. 判据落点

| 层 | 判据 | 区分度输入（缺了即假绿） |
|---|---|---|
| unit（纯函数） | 宽度 ∈ `[floor, min(cap, avail)]`、不拉伸、两侧位移最小、换边生效、幂等 | host 240/320/420/700 × natural 140/240/490 × fontSize 12/25.56 网格；两侧都不够宽的负例 |
| unit（注册表） | 浮层壳（`position: absolute/fixed` + `box-shadow: var(--shadow-raise)`）全部登记；登记条目全部存在；L/P 档无裸 px `width`；随字号缩放的条目必须有 `em` 上限 | 新增未登记浮层 / ctxpop 改回 `width:224px` / 删 em 上限 / 僵尸条目，逐条造红 |
| visual（chromium 结构层） | 浮层包围盒 ⊂ pane（±0.5）；`scrollWidth ≤ clientWidth`；行内文件名节点可见；宽度 ≈ `min(cap, avail)`；2.13 档不越界；resize 后重夹 | fixture 含 ≥60 字符深路径、长模型名、长会话名；2.13 档走真实 `font_size: 32` 配置 |
| acceptance（真机） | ⌘P 长路径浮层宽度 ≥ 320 且 `painted`；ctxpop 长读数宽度 ≥ 240、不折行、`painted` | 读数 fixture 用长读数（112.7k/131k）；对照现有「1k/131k 只剩 5px 余量」的最小内容锚 |

## 7. 备选方案（未采纳）

- **CSS 容器查询（`container-type: inline-size` + `100cqw`）**：无 JS、随 pane 自动重排；
  代价是给 `.lumir-harness` 加 containment（可能影响既有几何 / 基线），且 WKWebView 的
  `cqw` 未做真机探针。本 change 用 JS helper（纯几何可单测），容器查询留作后续简化。
- **纯 CSS `min(…, 100vw)`**：只适用于挂点在全窗宽的浮层（qo / toc / vault-pop）；harness
  浮层的边界是 pane、且要换边，CSS 表达不了。
- **统一把窗口 / pane 宽度乘一个比例**：这正是「统一拉宽」，短内容会空旷、放大档仍会越界。

## 8. 已知边界

- em 上限按**元素自身 font-size** 换算；嵌套字号（如 permpop 释义用 `--fs-label-s`）的
  行宽与盒子宽不同源——盒子按档位、行内按各自字号，这是有意的（盒子宽决定折行点）。
- 真机 WKWebView 的字形宽度与 chromium 有 <3% 差异（M698 §8），折行阈值的边界读数以真机
  场景的 `minWidth` 粗判为准，不做逐像素断言。
- `--lumir-hp-scale` 由编辑器字号驱动，2.13 档是 `FONT_SIZE_MAX / DEFAULT_FONT_SIZE`
  （32/15）——判据用真实配置通道，不在场景里手写 CSS 变量。
