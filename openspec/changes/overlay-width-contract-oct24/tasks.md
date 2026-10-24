# Tasks: overlay-width-contract-oct24

> 阶段门：0.2（Alex 节点 1 评审）通过前 MUST NOT 改产品代码 / living spec。本 change 的提案批只交付
> `proposal.md` / `design.md` / 本文件 / `specs/ui-design-system/spec.md`；实现批按本清单逐项勾选。
> 实现期发现 proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。
> `openspec/specs/ui-design-system/**` 活跃期只读；所有规格变更只写本 change 的 delta。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/ui-design-system/spec.md` / 本文件
- [x] 0.2 依据 M698 只读 survey（`.local/reports/m698-overlay-width-audit-oct24.md`）落三档数值、
      W1–W6 与逐组件目标；Alex 两张截图（m1 ⌘P 截断 / m2 ctxpop 折行）记为节点 1 来源
- [ ] 0.3 Alex 节点 1 评审通过（硬门禁；D1–D5 一并裁决，未回的按提案里的倾向落地）
- [ ] 0.4 裁决结果回填 proposal 的「评审记录」块（逐字），按裁决修正 design 与 delta

## 1. 几何 helper（`src/overlay-placement.ts`）

- [x] 1.1 档位表 `OVERLAY_TIERS`（C 24em / L 26em / P 34em，下限 160 / 200 / 200）
- [x] 1.2 纯函数 `resolveOverlayWidth`：`clamp(natural, floor, min(cap, avail))`，不拉伸
- [x] 1.3 纯函数 `placeOverlay`：两侧落点各夹进宿主 inset，选位移最小的一侧（换边优先于平移）
- [x] 1.4 DOM 适配 `measureOverlayNaturalWidth` / `overlayFontSize` / `applyOverlayPlacement`
- [x] 1.5 单测 `tests/unit/overlay-placement.test.ts`：host 240/320/420/700 × natural 140/240/490 ×
      fontSize 12/25.56 网格、换边、两侧都不够宽的负例、幂等、不拉伸

## 2. CSS 档位

- [x] 2.1 `src/style.css`：`.lumir-qo` / `.lumir-toc` 宽度 `min(26em, 100vw − 28px)`，容器字体基准 12.5px
- [x] 2.2 `src/style.css`：`.vault-pop` 宽度 `min(320px, 100vw − 16px)`
- [x] 2.3 `src/style.css`：⌘P 行的两段结构（`.lumir-qo-dirs` 可中段省略 / `.lumir-qo-name` 不先收缩）
- [x] 2.4 `src/harness-panel.css`：ctxpop / permpop / effhint / selpop / sesspop 改内容驱动
      （`width: max-content`）+ `max-width: 34em/26em` + 组件下限
- [x] 2.5 健康反例零改动（`.ft-menu` / `.tab-menu` / `.ft-confirm` / bindings / 全屏面板）

## 3. ⌘P 路径渲染（`src/quick-open.ts`）

- [x] 3.1 纯函数 `splitPathRowText`：把一行文本拆成 prefix / dirs / name / suffix（path 在文本里定位）
- [x] 3.2 候选行与直接打开行改两段 DOM，`title` = 全路径，textContent 仍是完整文本（既有断言不破）
- [x] 3.3 单测：深路径 / 根文件 / vault 外绝对路径 / 模板文本 / path 不在文本里的防御分支

## 4. 单点夹取与重夹（`src/harness-panel.ts`）

- [x] 4.1 `placePop` 统一入口；`clampCtxPop` / `clampPermPop` / `placeSessPop` 改为调用它
- [x] 4.2 selpop / effhint 打开与重建路径补夹取（此前完全没有）
- [x] 4.3 `ResizeObserver(panel)` + `window.resize`：仍打开的浮层重夹（幂等）

## 5. 注册表判据

- [x] 5.1 `tests/unit/overlay-width-registry.test.ts`：覆盖（position + shadow 配方）、新鲜度、档位声明、
      随字号条目 em 上限、L/P 无裸 px 宽
- [x] 5.2 反向输入逐条造红：未登记浮层 / ctxpop 定值回潮 / 删 em 上限 / 僵尸条目 / 豁免档写坏

## 6. 视觉结构矩阵

- [x] 6.1 `tests/visual/scenes/m702-overlay-width.spec.ts`：长路径（文件名可见 + title + 不横向溢出）
- [x] 6.2 长说明 + 2.13 档（真实 `font_size: 32` 配置）：ctxpop 不折行、不越 pane
- [x] 6.3 窄 pane（拖分隔条）+ selpop：包围盒 ⊂ pane
- [x] 6.4 resize 后重夹：拖分隔条后浮层仍在 pane 内
- [x] 6.5 ctxpop 既有像素基线：本方案靠组件下限 224px 兜住短内容；实测长读数档仍有漂移，
      已先给 Alex 过目再重截——`m347-ctxpop-cache-metrics-chromium-darwin.png` 225×103 → 262×67
      （同批 toc ×2 300→325，code-outline-popover 待确认后补；M702 提交 `18bc031e` / `22229b71`）。
      **禁止自行 `--update`**（`tests/visual/README.md` 的人肉裁决点）

## 7. 真机验收

- [x] 7.1 `scripts/acceptance/scenarios/231-quick-open-long-path-width.md`：长路径 ⌘P，浮层宽度 +
      文件名可见的正观测
- [x] 7.2 `scripts/acceptance/scenarios/232-harness-ctxpop-width.md`：长读数 hover——气泡翻出、
      三段内容齐全、`painted` 绘制段、mouseleave 收起（M702 r1 校正：宽度数字在真机层不可量，
      归 chromium 结构矩阵；本场景不含 `geom` / `minWidth` 断言）
- [x] 7.3 重生成 `scripts/acceptance/COVERAGE.md`；`node scripts/acceptance/run.mjs --check` 绿

## 8. 门禁与证据

- [x] 8.1 `node tests/unit/run.mjs` + `npx tsc --noEmit`（根 / 单测 / 视觉三份 tsconfig）
- [x] 8.2 `scripts/gate.sh quick`（照抄 `GATE RESULT` 与退出码）
- [x] 8.3 `scripts/gate.sh visual`（同上；像素层只看本地）
- [x] 8.4 `bash scripts/docs-check.sh` / `npx openspec validate --all --strict`
- [x] 8.5 真机跑 231 / 232，证据落 `.local/acceptance/`
      —— **2026-10-24 两条场景真机 PASS（0 FAIL）**：231（⌘P 长路径，5 断言；输入面几何
      ≥280 截图 px 的判据成立）、232（ctxpop 长读数，11 断言；绘制段亮度跨度 97 ≥ 60）；
      证据 `.local/acceptance/2026-10-24-m711/{231-quick-open-long-path-width,232-harness-ctxpop-width}/`
- [x] 8.6 证据与完工报告对账后提交（source only），TowerComplete

## 9. 归档（节点 2）

- [ ] 9.1 节点 2 归档评审通过后 `openspec archive overlay-width-contract-oct24`，并在 `docs/backlog.md`
      落一条归档跟踪条目（批次收尾执行；本 change 活跃期不动 backlog）
