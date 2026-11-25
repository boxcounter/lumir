# Design: Skill 候选选中项可见性——修前复现、判据加固与真机待办

行为真源是 `docs/specs/selector-contract.md` C2 / C3 与 `docs/specs/skill-menu.md` S2/S4；本文只写
缺陷现场、根因定位、判据设计与证据。产品行为不改。

## 1. 现场与合同对照

用户截图（长真实 Skill 目录，`⌃N/P` 已能滚动列表）：

- 候选盒可见部分只露出 `…-06` / `…-07` / `…-08` / `…-09` 四行，**四行都没有选中标记**；
- 再按一次 `⌃N` 列表仍会滚，但选中状态始终落在可见区之外；
- 合同要求的形态是：游标 option 完整落在真实可见带内、越界时带边缘与游标之间留一行上下文。

## 2. 根因：修前实现的两处口径

把 `src/harness-panel.ts` 的放置与揭示换回 `d0b6927`（用户截图那个构建：`package.json` 仍是
0.16.0，已有 `skillMenuNavigationDelta` / `⌃N/P`，但还没有 clip 与 `max-height` 钳制）后复现：

```
选中项下缘越出真实可见带（默认视口 Control+n #4 selected=4 marked=4 scrollTop=0 maxScroll=766
  menu=643.0..843.0 h=200 inlineMaxH= panel=42.0..775.0
  clip=643.0..775.0 band=646.0..775.0 row={top:774,bottom:806,height:32}）
```

两处与合同冲突：

1. **放置以 composer 区为界，不以面板为界**。旧代码用
   `estimatedHeight = min(6, items.length) × 32 + 8` 估高，上翻分支的下限是 `host.top + 8`
   （composer 区的顶缘）——面板底部还有控制行 / 留白时，200px 的盒从 composer 区顶部起排就
   必然伸出面板，被 `.lumir-harness` 的 `overflow: hidden` 裁掉。
2. **揭示把候选自身当成视口**。旧代码拿 `menuRect.top + clientTop .. +clientHeight` 与 option
   矩形比，被裁掉的那一截仍在「视口」里——`scrollTop` 因此停在 0，选中行留在屏外的裁切区。
   这正是 C2 写明的那种假绿：「被裁区里的行物理上无法靠 `scrollTop` 搬进屏幕」。

master 的修法（`selector-scroll-auto-select` 系列，已在 `46d7669`）：`skillMenuClip` 取
`menuRect ∩ panelRect ∩ viewport`，可用空间不足时按实测高度收缩 inline `max-height`，揭示按
真实带 + 一行上下文计算。**本次不再改产品代码**。

## 3. 为什么既有判据没抓住

- **视觉 oracle 与实现同源**：`skill-hybrid.spec.ts` 的 `expectHighlightedVisible` 用
  `menuRect ∩ panelRect ∩ viewport` 求带（与实现同一公式），不扣滚动口自身的边框 / padding，
  也不扫其他裁切祖先；只查 `aria-selected`，不查 `.is-selected` 是否在同项上。改成独立计算后，
  该文件 68 条仍全绿（说明加固没有把判据写歪）。
- **真机场景只留截图**：868 末项那一步只有 `shot:`。r4 那次 PASS 的截图里恰好只有
  `…-06`–`…-09` 四行且无选中标记——缺陷在截图里，判据却没看它。

## 4. 判据设计

新增矩阵 `tests/visual/scenes/skill-visible-selection-nov25.spec.ts`（7 条）：

| 维度 | 取值 |
|---|---|
| 目录 | 30 项合成目录，名字 10–24 字符，描述 80–150 字（含一条短描述、一条空描述） |
| 键族 | `⌃N` / `⌃P` 全列表往返；上下两方向都在矩阵内 |
| 逐拍判据 | 选中项完整在真实带内；`.is-selected` 与 `aria-selected` 同项；左条 2px 且非透明；底色与候选底色可区分；候选未横向滚动 |
| 几何 | 默认 1200×800；短视口 1200×500；1000×360 + `--lumir-hp-scale: 1.5`；窄 pane 1200×682（harness 侧 ~17%，真机 20% 形态） |
| 时序 | 同步目录、异步目录晚到（`deferCatalog`）、静止指针停在候选上、窗口收缩后的 `if-clipped` 补揭示 |

真实可见带的算法（独立于实现）：`max(菜单顶 + clientTop + padding-top, 各裁切祖先顶, 0)` 到
`min(菜单顶 + clientTop + clientHeight − padding-bottom, 各裁切祖先底, innerHeight)`；「无滚动」
判据用实现的 0.5px 取整容差，「完整可见」断言用 1px 几何容差（合同 C3 的允许误差）。

## 5. 证据

- **红（修前实现，逐字复刻 `d0b6927` 的 `placeSkillMenu` 与 `clientHeight` 揭示）**：
  7/7 红，首条报错即上文的「选中项下缘越出真实可见带，scrollTop=0」。
- **绿（master `46d7669`；判据提交 `a79a5f0f` 上跑过完整 `scripts/gate.sh visual`，`GATE RESULT:
  15/15 PASS（SKIP 0）`）**：
  - chromium：新矩阵 7/7、`skill-hybrid.spec.ts` 68/68（含加固后的 oracle）；
  - WebKit（`webkit-realua`：真机同款 UA；该 project 只覆写 `browserName` 与 `userAgent`、**不覆写
    `deviceScaleFactor`**，实际 DPR 1）：新矩阵 7/7。

## 6. 真机判据（AX 暴露＝必要不充分；已补场景断言，真机复跑待主会话）

1. 868 的「末项 / 末段」两步已从「只留截图」改为 **AX 暴露**判据：WKWebView 的 AX 快照按离屏过滤只
   暴露**曝光窗口**内的行（`truncated: true [offscreen_filter]`，与 867 同一手法）。该窗口**比像素
   可见区多一行**（本场景 r4 实测：`04` 快照暴露 `acc-skill-05`–`09`，像素只显示 `06`–`09`），所以
   它是**必要不充分**判据，K3 复核时据此把它从「完整可见」的措辞降级：

   - 游标行文本**不在** AX 里 ⇒ 一定在真实可见带之外（充分条件，本次缺陷正是这种形态，可判红）；
   - 游标行文本**在** AX 里 ⇒ 只证明进入了曝光窗口，仍可能是被裁的下一行（不构成完整可见）。

   判据按正反两向成对、同一次运行里翻面：

   | 步骤 | 必须在场（曝光窗口内） | 必须不在场（必然在带外） |
   |---|---|---|
   | 首段（2 拍 ⌃N，窗口在顶部） | `acc-skill-00` | `acc-skill-11` |
   | 末段（12 拍 ⌃N 到底） | `acc-skill-11`、`acc-skill-10` | `acc-skill-00` |
   | 回退（⌃P 到倒数第二项） | `acc-skill-10` | `acc-skill-00` |

   正向只证明游标行进入了曝光窗口；反向证明「不在场」不是因为 AX 什么都没读到（否则首段的同一条
   判据也恒成立），且「不在场」本身就是充分判据。两条放在同一次运行里翻面，判据不可能恒真。
   整行 ⊆ 真实可见带、带内不动、留一行上下文这些**完整几何**仍由浏览器矩阵判定（见 §4/§5）。
   AX 读不到 `aria-selected` / `scrollTop`，所以「哪一行是游标」仍由 Enter 的实际 ref 判定，标记样式
   与几何仍归视觉套件，截图只留现场。
2. 修前构建上这三条会红：r4 的 `04` 快照里 AX 列表只有 `acc-skill-05`–`09`，游标行 `acc-skill-10`
   根本不在 AX 里。r4 那轮的截图是修前现场，不能作为当前树的证据。
3. **868 尚未在任何真机上跑过含本修复的构建**；复跑归主会话串行执行（本批不占真机窗口）。上面的
   15/15 门禁属于 `a79a5f0f`，不含真机层。
