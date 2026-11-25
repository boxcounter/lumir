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
- [x] 1.3 复审补红（机械报告 §4/§5/§8 的区分度缺口）：纯键盘删除流程与 `onVaultLoaded` 身份标记
      同步在实现前判红；被动关闭的负断言用「把点浮层外临时改回主动关闭」的变异体重跑，确认它确实
      会 FAIL（红证据落 `.local/probes/selector-ime-aria-nov25/`，不是只读日志推断）；组合期按键补
      `defaultPrevented === false` 与 `⌃N` / `⌃P` 矩阵。

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
      `aria-disabled="true"` 且仍不进 `rows`；当前 vault 失效时该行同时保留 `aria-current="true"`
      （当前身份不因不可用而丢失）；`suspendRow` 清 `aria-selected`；`close()` 清
      `aria-activedescendant`。
- [x] 2.6 `src/vault-switcher.ts`：行切换钮、删除钮、确认态两个按钮 `tabIndex = -1`；新增
      `Delete` / `Backspace` 纯键盘删除入口——查询为空且键对游标落在可移除行时进入与指针同一套
      两步确认、第二次按下提交；查询非空 / 当前项 / 无游标时不消费按键（退格仍是输入框的编辑键）。
      行点击、键盘 Enter、删除两步确认语义不变。
- [x] 2.7 `src/style.css`：只给 `.lumir-toc-item.is-active:hover` 与 `.vault-row.is-active:hover`
      补回 `--sel` 底色（hover 不清掉游标标记）；不动 token、布局与其它表面。
- [x] 2.8 目标 chromium 矩阵转绿；既有 `list-filter` / `mv-vault-switcher` / `m668-vault-remove-focus`
      场景不回归。
- [x] 2.9 `src/vault-switcher.ts`：`onVaultLoaded` 换 `currentId` 时若浮层打开，按新身份重建行 DOM
      ——✓ / 「当前」flag / `is-current` / `aria-current` 与移除钮同一拍跟上（程序化切 vault 不关
      浮层时不留滞后）。单测钉住。

## 3. 规格

- [x] 3.1 `specs/toc-outline/spec.md`：MODIFIED「大纲浮层」（关闭焦点口径，整条复制后改）+
      ADDED「浮层选择列表的 IME、ARIA 与焦点口径」（引用 `docs/specs/selector-contract.md`）。
- [x] 3.2 `specs/vault-workspace/spec.md`：ADDED「vault 列表浮层的 IME、ARIA 与 Tab 口径」——
      含当前 vault 失效时保留 `aria-current="true"` + `aria-disabled="true"` 的语义，以及
      `Delete` / `Backspace` 纯键盘删除入口与其两步确认场景。

## 4. 真机验收场景（更新随实现同 PR）

- [x] 4.1 `scripts/acceptance/scenarios/13-toc.md`：补「筛选输入框持焦时 Tab 离开 → 浮层收起」与
      「Esc 后焦点回到编辑器」两条真机可判的步骤；组合期 IME 的代码级守卫由 chromium 矩阵判，
      真机清单单列（见 5.4）。
- [x] 4.2 `scripts/acceptance/scenarios/17-multi-vault-switch.md`：补「Escape 后浮层收起且焦点回
      编辑器」与「同一次打开里连续 Esc / ⌘O 不残留」；文末补「纯键盘删除」一步（↓ 到非当前行 →
      `Delete` 进入确认句 → 再按一次移除）；列表行与删除钮的 `tabindex`、`aria-*` 由 chromium
      矩阵判（AX 读不到该属性，见 README 的已知边界）。

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 5.2 `bash scripts/docs-check.sh` 通过（含归档对账、验收场景契约与覆盖表）。
- [x] 5.3 目标测试：`bash scripts/visual/run.sh scenes/selector-aria-ime-nov25.spec.ts` 全绿（10 条：
      原 8 条 + 纯键盘删除 + 失效当前项）；`pnpm test` / `pnpm exec tsc --noEmit` 与 `tests/visual`
      的 tsc 通过；单测补 `onVaultLoaded` 身份标记同步与 `Delete` / `Backspace` 状态机。
- [ ] 5.4 真机复跑（主会话串行）：`node scripts/acceptance/run.mjs 13`、`17` 通过；另按真机清单
      手工复核组合期行为（真实中文 IME 下组合期 `↓` / `Enter` 不导航、不接受，组合结束后列表
      按最终串刷新一次）。
- [ ] 5.5 完整门禁由主会话执行：`bash scripts/gate.sh quick` 与 `bash scripts/gate.sh visual`
      （动过 `src/style.css`，像素层必跑）。

## 备注（合并时由主会话统一）

- `docs/specs/selector-contract.md` 由并行 change（`fix/selector-scroll-auto-select-nov25`）落地，
  本 change 只引用、不编辑。该合同的 C5 写「已打开的候选在 `compositionstart` 关闭」，与本 delta
  的「组合期冻结刷新、保持打开」不是同一口径；合并时需在合同里给 list-filter 类浮层写明例外（或
  统一措辞），两条 canonical 文本不得并存两种说法。
- 证据口径（机械核验 §8 的要求）：最终矩阵的红跑是**回退源码重跑**，归档说明不要引用
  `red-before-fix.log`（`ERR_CONNECTION_REFUSED`，无效红）；「32 回归」实为 32 passed（24 条既有
  + 8 条新增）。
