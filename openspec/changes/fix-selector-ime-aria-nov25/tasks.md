# Tasks: fix-selector-ime-aria-nov25

> 顺序是硬约束：**先红后绿**。1.x 的 chromium 矩阵必须先在本实现之前的代码上判红并留证，再进 2.x。
> 真机复跑（13 / 17）由主会话串行执行，本 worker 只交付场景更新与运行清单。

## 1. 先红：chromium 矩阵

- [x] 1.1 新增 `tests/visual/scenes/selector-aria-ime-nov25.spec.ts`：TOC / Vault 各四条——
      组合期按键不导航不接受（`isComposing` 与 `keyCode === 229`）、组合结束只重建一次、
      `aria-selected` / `aria-current` / option id / activedescendant 闭合、Tab 与焦点、hover。
- [x] 1.2 在旧实现上跑该 spec 并留红跑证据（`.local/probes/selector-ime-aria-nov25/`）：四条 TOC
      用例按预期判红（游标被 `↓` 推走、重建计数 2、`aria-current` 为 0、hover 覆盖底色）；vault
      四条在旧实现上同样判红（见证据目录的第二份 run）。

## 2. 实现

- [x] 2.1 `src/toc.ts`：`onKeydown` 首行加组合期守卫（与 `src/quick-open.ts:1133` 同一条）；
      `compositionend` / `input` 改为按最终值去重，组合结束只 `render()` 一次。
- [x] 2.2 `src/toc.ts`：option 创建时写 `aria-selected="false"` 与 `aria-current`（当前段
      `true`，其余 `false`）；`setActive` 只改 `aria-selected`；`close()` 清
      `aria-activedescendant`。
- [x] 2.3 `src/toc.ts`：点浮层外改为 `close(false)`（被动关闭不抢焦点）；主动关闭路径不变。
- [x] 2.4 `src/vault-switcher.ts`：同一条组合期守卫与组合结束去重。
- [x] 2.5 `src/vault-switcher.ts`：所有 option（含失效行）分配唯一 `id`；`aria-selected` 初值
      统一 `false`、由 `setActive` 跟随游标；当前 vault 写 `aria-current="true"`；失效行
      `aria-current="false"` 且仍不进 `rows`；`suspendRow` 清 `aria-selected`；`close()` 清
      `aria-activedescendant`。
- [x] 2.6 `src/vault-switcher.ts`：行切换钮、删除钮、确认态两个按钮 `tabIndex = -1`；行点击、
      键盘 Enter、删除两步确认语义不变。
- [x] 2.7 `src/style.css`：只给 `.lumir-toc-item.is-active:hover` 与 `.vault-row.is-active:hover`
      补回 `--sel` 底色（hover 不清掉游标标记）；不动 token、布局与其它表面。
- [x] 2.8 目标 chromium 矩阵转绿；既有 `list-filter` / `mv-vault-switcher` / `m668-vault-remove-focus`
      场景不回归。

## 3. 规格

- [x] 3.1 `specs/toc-outline/spec.md`：MODIFIED「大纲浮层」（关闭焦点口径，整条复制后改）+
      ADDED「浮层选择列表的 IME、ARIA 与焦点口径」（引用 `docs/specs/selector-contract.md`）。
- [x] 3.2 `specs/vault-workspace/spec.md`：ADDED「vault 列表浮层的 IME、ARIA 与 Tab 口径」。

## 4. 真机验收场景（更新随实现同 PR）

- [x] 4.1 `scripts/acceptance/scenarios/13-toc.md`：补「筛选输入框持焦时 Tab 离开 → 浮层收起」与
      「Esc 后焦点回到编辑器」两条真机可判的步骤；组合期 IME 的代码级守卫由 chromium 矩阵判，
      真机清单单列（见 5.4）。
- [x] 4.2 `scripts/acceptance/scenarios/17-multi-vault-switch.md`：补「Escape 后浮层收起且焦点回
      编辑器」与「同一次打开里连续 Esc / ⌘O 不残留」；列表行与删除钮的 `tabindex` 由 chromium
      矩阵判（AX 读不到该属性，见 README 的已知边界）。

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 5.2 `bash scripts/docs-check.sh` 通过（含归档对账、验收场景契约与覆盖表）。
- [x] 5.3 目标测试：`bash scripts/visual/run.sh scenes/selector-aria-ime-nov25.spec.ts` 全绿；
      `pnpm test` / `pnpm exec tsc --noEmit` 与 `tests/visual` 的 tsc 通过。
- [ ] 5.4 真机复跑（主会话串行）：`node scripts/acceptance/run.mjs 13`、`17` 通过；另按真机清单
      手工复核组合期行为（真实中文 IME 下组合期 `↓` / `Enter` 不导航、不接受，组合结束后列表
      按最终串刷新一次）。
- [ ] 5.5 完整门禁由主会话执行：`bash scripts/gate.sh quick` 与 `bash scripts/gate.sh visual`
      （动过 `src/style.css`，像素层必跑）。
