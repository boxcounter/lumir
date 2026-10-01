# Tasks: tab-reveal-in-tree

## 1. 规格与文案

- [x] 1.1 `openspec/changes/tab-reveal-in-tree/` 三件套齐备（proposal / tasks / 两份 spec delta），
      且 proposal 记明 Alex 2026-10-01 的显式需求即提案批准记录
- [x] 1.2 `src/copy-data.ts` 追加 D322（zh + en），`文案-Copy.md` 追加同一条行（编号只追加）
- [x] 1.3 `tests/unit/copy.test.ts` 的漂移门禁在两边同改后仍绿

## 2. 文件树：定位能力（`src/tree.ts`）

- [x] 2.1 `FileTree` 接口新增 `revealPath(path: string): void`
- [x] 2.2 可达确认段：沿路径逐段确认每一段都在模型里且是目录；惰性祖先在这里按需取回一层
      （取数**不展开**，对用户不可见；取数登记由 `Set` 改 `Map<string, Promise<void>>`，让「在途」
      可等待——会话恢复出来的深标签可能落在本会话从没展开过的惰性目录下）
- [x] 2.3 落地段：把确认过的祖先逐级展开（复用 `expandNode`）→ 目标行 `scrollIntoView({ block:
      "nearest" })` → 标成当前行（与 `syncCurrent` 同一份 DOM 对齐）
- [x] 2.4 不可达（路径不在模型里 / 惰性取数失败）时全程空动作：不展开、不改当前行、不滚动
      （先确认再动手，因此不存在「展开了一半才发现走不通」的半截现场）

## 3. 标签菜单（`src/tabs.ts` + `src/main.ts`）

- [x] 3.1 `TabMenuAction` 新增 `"reveal-in-tree"`；`tabMenuItems()` 首项为定位项（D322）
- [x] 3.2 `runTabMenuAction` 派发到 `TabsDeps.revealInTree(path)`；三条关闭路径逐条不变
- [x] 3.3 `src/main.ts` 把 `tree.revealPath` 接进 `TabsDeps`（惰性闭包，与 `syncActiveDocument`
      同一条模式——`tree` 在装配层是 `let` 绑定，赋值晚于 `createTabs`）

## 4. 测试

- [x] 4.1 `tests/unit/tab-menu.test.ts`：项集（四项、顺序、文案逐字）与游标 / Enter 落点按新顺序更新
- [x] 4.2 `tests/unit/tab-menu.test.ts`：新增一条「选中定位项 → onSelect 收到 `reveal-in-tree` 与
      右键那一条会话」
- [x] 4.3 `tests/unit/tree-reveal.test.ts`（新增，6 条）：祖先逐级展开 + 滚动语义 + 当前行；重复定位
      幂等；路径不可达的空动作（配正向对照）；惰性祖先逐层按需取回；取数同步抛错后不滞留登记、
      下次重试仍成立
- [x] 4.4 `tests/visual/scenes/tab-menu.spec.ts`：菜单多一项（两张元素基线更新）与端到端定位用例
      （祖先展开 + 目标行完整落在左栏可视区 + 该行是唯一当前行 + 前台标签不变）
- [x] 4.5 `scripts/acceptance/scenarios/69-tab-reveal-in-tree.md`（新增）：真实 WKWebView 下的右键 →
      选定位项 → 祖先展开、目标行出现（滚动那一条归 chromium，已在场景正文登记）

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（`✓ change/tab-reveal-in-tree`，总计 20 passed / 0 failed）
- [x] 5.2 `scripts/gate.sh quick` 全绿（`GATE RESULT: 10/10 PASS`）
- [x] 5.3 `scripts/gate.sh visual` 全绿（`GATE RESULT: 12/12 PASS`，其中 visual-regression 480s：
      588 passed / 1 skipped / 0 failed，含两张已更新的 tab-menu 元素基线）
- [x] 5.4 `node scripts/acceptance/run.mjs --check` 通过（71 个场景静态校验，含新的 69）
- [ ] 5.5 场景 69 的真机执行（`node scripts/acceptance/run.mjs 69`）：由 tower 排期——同一时刻机上有
      别的 worktree 在跑视觉套件，真机套件会起第二个 Lumir 实例并抢前台，按 REVIEW.md 第 11 条
      （第二实例显著加剧键盘丢键）与 README 的前台纪律，本 mission 不并发跑它

## 6. 基线更新清单（人肉裁决点，供 Alex 过目）

本 change 只动了**两张**元素级基线，且各更新过**两轮**（均在 Alex 之前报备，第二轮由 Alex 的裁决
直接引发）：

| 基线 | 第一轮（M300 初版：菜单多一项） | 第二轮（D322 上屏列锁定 en 之后） | 路径 |
|---|---|---|---|
| `tab-menu.png` | 167×88 → 167×116，游标移到新的首项 | 167×116 → **167×114**（英文文案比中文短） | `tests/visual/baselines/tab-menu.spec.ts-snapshots/tab-menu-chromium-darwin.png` |
| `tab-menu-close-right-active.png` | 167×88 → 167×116，游标在末项 | 167×116 → **167×114** | `tests/visual/baselines/tab-menu.spec.ts-snapshots/tab-menu-close-right-active-chromium-darwin.png` |

对照副本（git 外）：`test-results/m300-baseline/before`+`after`（第一轮）与
`test-results/m300-baseline/r1-locked-before`+`r2-locked-after`（第二轮）。**其余基线零变化**
（整页 / 元素全套照绿）。

## 7. 裁决后的收口（Alex 2026-10-01，复审前的两处裁决）

- **裁决 1（树的高亮跟随被定位行）**：维持现状实现与 `multi-tabs`「文件树联动与空态」的例外条款，
  零改动。
- **裁决 2（菜单内语言统一到英文）**：D322 加 `lock: "en"`，上屏文案 `Reveal in File Tree`（中文列
  保留 Alex 原话作沿革备查）。连带改动：`src/copy-data.ts` / `文案-Copy.md`（标 `【上屏列锁定 en】`）/
  `src/tabs.ts` 的常量注释 / `tests/unit/tab-menu.test.ts` 的两处断言 / `tests/visual/scenes/tab-menu.spec.ts`
  的标签与点击目标 / 两张元素基线 / 场景 69 的四条 matcher 与边界说明 / 本 change 的 proposal 与
  multi-tabs delta 的措辞。判据：单测里「zh 界面下四项都取 English 列」这条断言即锁列判据。
