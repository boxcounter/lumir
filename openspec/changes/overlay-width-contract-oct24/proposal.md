# Proposal: 浮层宽度按内容分档——内容固有宽 + em 上限 + 单点夹取

- Change ID: `overlay-width-contract-oct24`
- 日期: 2026-10-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**待 Alex 裁决**（2026-10-24 起草）。
> 来源是 Alex 的两张 dogfood 截图（`kimi-code-composer://attachments/m1` 与 `m2`）：
> ⌘P 浮层 300px 把长路径截断、harness Context 气泡 224px 把读数折成两行。只读 survey
> `.local/reports/m698-overlay-width-audit-oct24.md`（M698）实测确认这是**同族**缺陷：
> 14 个浮层里 5 处固定像素宽 + 4 处夹取各写一份，且宽度不跟随 `--lumir-hp-scale`（0.8–2.13）。
> 本提案不是「统一拉宽」——按内容分三档，短内容不空旷、长内容不折行、放大档不越 pane。
> 裁决点 D1–D5 见下，每项附倾向；不回即按倾向落地。节点 2（归档评审）：实现完成后填写。

## Why

### 现场（用户原话 + 实测）

- **Alex 的原始需求（节点 1 的来源）**：`m1` 截图中 ⌘P（快速打开）浮层的长路径被裁掉，
  `m2` 截图中 harness Context 气泡的读数行折行。两张图的共同点不是「整体偏窄」，而是
  **固定像素宽 + 内容会变长**——同一族的缺陷在别处还有 3 处。
- **⌘P（`.lumir-qo`）**：定宽 300px（`src/style.css:2054`），行内 `text-overflow: ellipsis`
  从尾部截断。M698 实测：48 字符的典型 vault 路径固有宽 302px（裁 8.8%，正好吃掉文件名尾段）；
  77 字符的深层路径 488px（裁 42.5%，**文件名整段不可见**），条目没有 `title` 兜底。
- **Context 气泡（`.lumir-hp-ctxpop`）**：定宽 224px，`clampCtxPop` 只会「超宽收窄」、
  **从不变宽**（`src/harness-panel.ts:6332`）。实测：越线警示句 234px → 必折 2 行；
  字号 2.13 倍时首行 482px → 3 行。窄 pane 下靠**平移 143px** 收编，浮层已脱离读数锚点。
- **选择器浮层（`.lumir-hp-selpop`）**：内容驱动但**没有任何夹取**。2.13 倍字号 + 320px pane
  时实测 391px 宽、右缘越出面板 85px，被 `.lumir-harness { overflow: hidden }` 裁掉
  （违反 `docs/specs/overlay-visibility.md` O1）。
- **夹取是三份近似复制**：`clampCtxPop` / `clampPermPop` / `placeSessPop` 各写一份，
  宽度下限 120 / 140 不一致、是否复位 `minWidth` 也不同——REVIEW.md「同一语义两处真源」的形态。

### 为什么不能「统一拉宽」

同一批浮层按内容分三类，处理手段不同：

1. **单行截断类**（qo / toc / 会话名 / 模型名）：宽度只解决一部分，剩下的靠**截断方向**
   ——仓内已有裁决级口径（M606：路径「文件名恒完整显示、中间目录折叠成 `…/`」,
   `src/harness-context.ts:91`），而 ⌘P 是它之后（M655）写的，**没遵守**。
2. **说明文字换行类**（ctxpop / permpop 释义 / effhint）：换行本身是对的，问题是盒子不够宽
   ——应「按内容固有宽取宽、到可读上限为止」，而不是给一个更大的定值。
3. **表格 / 代码横滚类**：不走宽度，走横滚（`scrollbar-tiers-oct24` 已收口），本次不动。

### 健康反例（要抄的四个形态）

指针菜单（`.ft-menu` 内容驱动 160–280 + 指针夹取）、删除确认（`width: min(440px, 100%)`）、
键位面板（`width: 100%; max-width: 680px`）、代码块全屏内容（`max-content` +
`max-width: 100%`）。**没有一个用「定值 + 越长越挤」**。这些是本次注册表里的 `exempt` 条目，
不改形态，只登记并守住。

## What Changes

对应 `specs/ui-design-system/spec.md` 的增量要求「浮层宽度分档与可读宽度注册表」：

1. **三档**（按内容类别，不按组件）：C 紧凑（单行定长）/ L 单行列表 / P 说明折行。
   宽度公式统一为 `clamp(内容固有宽, 档位下限, min(档位 em 上限, 宿主可用宽 − 2×inset))`；
   **不得拉伸**（短内容不超过 `max(固有宽, 下限)`），**不得写死 px 上限**。
2. **上限随字号**：凡文字随 `--lumir-hp-scale` 缩放的浮层，宽度上限 MUST 用 `em`
   （相对自身 font-size）。当前 px 定值在 2.13 档把 ctxpop 顶成 3 行、会话名裁 81%。
3. **单一夹取 helper**（`src/overlay-placement.ts`）：收窄 → 换边 → 平移三步收敛在一处，
   按「位移最小」选边；现有 `clampCtxPop` / `clampPermPop` / `placeSessPop` 收敛到它。
4. **逐组件落地**：
   - `.lumir-qo` / `.lumir-toc`：`width: min(26em, 100vw − 28px)`（字体基准 12.5px ⇒ 325px），
     ⌘P 的行渲染改「目录前缀可中段省略 + **文件名恒完整** + `title` 全路径」；
   - `.vault-pop`：`min(320px, 100vw − 16px)`；
   - `.lumir-hp-ctxpop` / `.lumir-hp-permpop` / `.lumir-hp-effhint`：P 档，内容驱动 +
     34em 上限 + 组件下限（ctxpop / effhint 224px、permpop 208px）；
   - `.lumir-hp-selpop` / `.lumir-hp-sesspop`：L 档，内容驱动 + 26em 上限 + 夹取；
   - 健康反例不动，只登记。
5. **打开后变化重夹**：面板尺寸变化（拖分隔条 / 窗口缩放）后，仍打开的浮层 SHALL 重夹或收起。
6. **机器判据**：纯几何单测（网格矩阵）+ 宽度注册表静态对账（新增浮层未登记即红）+
   chromium 结构矩阵（长路径 / 长说明 / 2.13 倍字号 / 窄 pane / 换边 / resize）+ 真机两条场景。

## Impact

- 代码：`src/overlay-placement.ts`（新增）、`src/style.css`、`src/harness-panel.css`、
  `src/quick-open.ts`、`src/harness-panel.ts`。
- 规格：`openspec/changes/overlay-width-contract-oct24/specs/ui-design-system/spec.md`（delta）；
  `docs/specs/overlay-visibility.md` 只加一行指针（它声明只管可见性，宽度属可读性）。
  **活跃期不改 living spec**（`openspec/specs/ui-design-system/**` 只读）。
- 测试：`tests/unit/overlay-placement.test.ts`、`tests/unit/overlay-width-registry.test.ts`、
  `tests/visual/scenes/m702-overlay-width.spec.ts`、
  `scripts/acceptance/scenarios/231-quick-open-long-path-width.md`、
  `scripts/acceptance/scenarios/232-harness-ctxpop-width.md`。
- **像素基线**：ctxpop 元素基线（`m347-ctxpop-cache-metrics.png`）为**组件下限 224px** 保持不变
  ——本方案靠「只增不减」的 floor 让既有 fixture 渲染零变化；若实测仍有漂移，按
  `tests/visual/README.md` 的人肉裁决点先给 Alex 过目，**禁止自行 `--update`**。
- 非目标：composer 控制行窄 pane 溢出（M698 §3.6 另案，是布局不是浮层）；
  `.lumir-hp-composer` / transcript（纵向滚动，已归 `scrollbar-tiers-oct24`）；
  跨主题几何（宽度与主题无关）。

## 裁决点（未回按倾向落地）

- **D1 档位数值**：C 24em / L 26em / P 34em，下限 C 160px、L 200px、P 200px（组件可覆盖）。
  倾向：按 M698 提案值落地；34em 是「CJK 一行 32–40 字」的通用排版经验，未在本产品做阅读实验
  ——若 Alex 觉得 ctxpop 更该短行（如 28em），只改一个 token。
- **D2 ⌘P 宽度**：`min(26em, 100vw − 28px)`（325px @12.5px），不再随内容抖动。
  倾向：采纳——列表需要稳定宽度，典型 48 字符路径恰好放下，深层路径靠截断方向 + title 解决。
- **D3 截断方向**：目录前缀可中段省略、**文件名恒完整**，全路径落 `title`；MUST NOT 无条件
  把所有行折成 `…/文件名`（同名文件在同一条列表里不可分辨，违背 quick-open 的匹配语义）。
  倾向：按 DOM 两段（`.lumir-qo-dirs` / `.lumir-qo-name`）实现，文本内容仍是完整路径。
- **D4 ctxpop 下限**：保留既有 224px 作为组件下限（P 档默认 200px），既有像素基线不动。
  倾向：采纳——先修「只缩不放」，不为短内容制造基线噪音。
- **D5 换边 vs 平移**：选「位移最小」的锚定边；若两侧位移相同取组件默认边。当浮层宽度接近
  宿主可用宽时（`width > 宿主/2`）两侧位移都大，此时按可用宽铺满并居中偏移，视作 pane 级
  浮层——不强行换边制造更差的落点。倾向：采纳。
