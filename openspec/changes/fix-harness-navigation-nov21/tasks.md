# Tasks: fix-harness-navigation-nov21

> 阶段门：节点 1（Alex 提案评审）通过前 MUST NOT 改产品代码。本 change 由 tower 按 Alex
> 2026-11-21 的原始需求直接立项派发（原话见 proposal「Why」），节点 1 的裁决记录由 tower 回填。
> 实现期发现 proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / 本文件 / `specs/harness/spec.md` /
      `specs/cron/spec.md`；两份 delta 按 living spec 全文抄录后就地改（MODIFIED 整块替换）
- [x] 0.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与
      `bash scripts/docs-check.sh` 通过（读数见 §5）
- [ ] 0.3 节点 1 裁决记录回填（由 tower 按 Alex 2026-11-21 原始需求补记；worker 不代填）

## 1. 解析修复（`path:line` 句末标点）

- [x] 1.1 `src/harness-path-link.ts`：`lineSuffixAt` 的后缀后置守卫把点号段拆出来单判——连续点号段
      之后仍为路径延续字符（字母 / 数字 / `_` / `-` / `/`）才拒绝，句末句号 / 省略号不再使后缀失效
- [x] 1.2 单测（扩 `tests/unit/harness-path-link.test.ts`）：`design.md:69.` → `line = 69` /
      `lineEnd = 69` / `text = "design.md:69"`；行范围 `:69-72.` → `lineEnd = 72`；行列
      `:69:5.` → `column = 5`；省略号同判；反证 `a.md:12.5` 仍无 `line`，`12x` / `12/5` /
      `12_3` / `12-3` 逐字不变
- [x] 1.3 确认快速打开（`src/quick-open.ts` 的 `splitLineSuffix`）行为逐字不变：它额外要求
      后缀消耗到输入串末尾，`a.md:12.` 在那边仍不成立

## 2. cron 结果通知焦点修复

- [x] 2.1 `src/main.ts`：`openHarnessPane(focusComposer = true)`；新建 pane 后仅在 `true` 时
      `harnessPanel.focusComposer()`；pane 已存在时既有早退与内容恢复路径不变
- [x] 2.2 `src/main.ts`：`handleCronOpenSession` 改为 `openHarnessPane(false)`；其余调用点
      （`toggleHarnessPane` / `handleCronRun`）逐字不变（显式打开仍聚焦 composer）

## 3. 测试

- [x] 3.1 新增 `tests/visual/scenes/harness-navigation-nov21.spec.ts`：句号形态链接文本 / 落点 /
      单行与行范围高亮；小数形态反证
- [x] 3.2 同场景覆盖 cron 结果通知的 pane 关闭 / 已打开两态：pane 可见、恢复内容上屏、
      `document.activeElement` 仍在正文、光标行与 `scrollTop` 不变
- [x] 3.3 同场景保留回归锚点：显式 toggle 后 composer 仍持焦
- [x] 3.4 判别性实测：旧代码（`git checkout -- src/harness-path-link.ts src/main.ts`）上该场景
      2 条判红（句号形态的链接文本 / pane 关闭态的焦点），新代码 + 既有 m632 场景 12 条全绿；
      日志落 `.local/missions/harness-navigation-nov21/{red-visual-before-fix,green-visual-after-fix}.log`

## 4. 验收场景（真机由主会话统一跑）

- [x] 4.1 新增 `scripts/acceptance/scenarios/269-harness-path-line-sentence-period.md`（item 705，
      tier full）：句末句号形态的按钮名 = 整段 `path:12`、裸路径按钮不存在（判别性反证）、
      行范围不回归、小数形态仍只链接路径本身
- [x] 4.2 新增 `scripts/acceptance/scenarios/270-cron-open-session-keeps-doc-focus.md`（item 706，
      tier bundle / requires bundle）：点结果通知后 pane 展开 + 会话恢复 + 正文逐字节不变，
      随后键入落在正文（`editor.changedSince` + `editor.has "uvw"`）
- [x] 4.3 新增 mock fixtures（`harness-mock-path-line-sentence-period.json` /
      `harness-mock-cron-navigation.json`），`node scripts/acceptance/coverage.mjs` 重新生成
      `COVERAGE.md`，`coverage.mjs --check` 与 `run.mjs --check` PASS

## 5. 门禁与证据

- [x] 5.1 根 `pnpm exec tsc --noEmit`（exit 0）
- [x] 5.2 全量单测 `pnpm test`（1682 passed / 0 failed）
- [x] 5.3 受影响 Playwright specs（端口 4284，`LUMIR_VISUAL_STRUCTURAL=1`）：
      `harness-navigation-nov21.spec.ts` + `m632-path-line-range-link.spec.ts`（12 passed）
- [x] 5.4 `bash scripts/docs-check.sh` / `validate --all --strict` / `openspec-archive-check.mjs`
      读数（见下「门禁读数」）
- [ ] 5.5 真机：场景 269 / 270 由主会话统一跑并回填 PASS 指针（worker 不跑真机）

### 初版读数（commit 95e3d20a，2026-11-21；r1 复跑见 §7）

- `pnpm exec tsc --noEmit` → exit 0（日志 `.local/missions/harness-navigation-nov21/tsc.log`）
- `pnpm test` → `ℹ tests 1682` / `ℹ pass 1682` / `ℹ fail 0`（`unit-tests.log`）
- Playwright（4284 / 结构模式）→ `12 passed`（`green-visual-after-fix.log`）；旧代码红跑
  `2 failed / 2 passed`（`red-visual-before-fix.log`）
- `node scripts/acceptance/coverage.mjs` → `COVERAGE PASS（247 个场景 / 224 个 item）`；
  `run.mjs --check` → `场景静态校验通过（247 个）`
- `bash scripts/docs-check.sh` → `docs-check: PASS`（exit 0；`docs-check.log`）
- `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` →
  `Totals: 35 passed, 0 failed (35 items)`（exit 0；`openspec-validate.log`）
- `node scripts/openspec-archive-check.mjs`（门禁模式）→
  `PASS（扫过 9 份 delta，8 条 MODIFIED，对比 147 段，无静默丢段；归档队列 0 项已完成 change 均有唯一条目）`
  （exit 0；`archive-check.log`）

## 6. 实现评审 r1 处置（2026-11-21）

- [x] 6.1 **P1**：`lineSuffixAt` 的点号守卫改为「连续点号段整体判定」——点号段之后仍为
      `[A-Za-z0-9_\-/]` 时整个 suffix 拒绝；`.5` / `..5` / `.foo` / `.-3` / `._3` / `./3` 全部
      回到畸形侧，`.` / `...` / 点号段后接空白或中文仍放行。spec 第 33–35 行不再写「只拒绝点后
      数字」，改为点号段规则
- [x] 6.2 P1 单测：single / range / 行列三形态分别补 `.foo` / `..5` 反例（同表还含 `.5` /
      `.-3` / `._3` / `./3` / `...foo` / `....5`），并补「点后空白 / 中文仍放行」的正例
- [x] 6.3 **P2**：`tests/visual/scenes/harness-navigation-nov21.spec.ts` 新增 `cron:run` 显式
      发起用例——pane 上屏后 `.lumir-hp-composer .cm-content` 必须持焦（缺省
      `focusComposer = true` 的回归锚点）；显式 toggle 断言保留
- [x] 6.4 **P3**：视觉场景与真机 fixture 的 range 后标点由中文逗号改为英文句号
      （`design.md:69-72.` / `path-link-target.md:16-18.`），与声明覆盖一致
- [x] 6.5 复跑：根 tsc、全量单测、`harness-navigation-nov21` + `m632-path-line-range-link` +
      `quick-open` 相关 Playwright（端口 4284）、docs-check、OpenSpec validate、acceptance
      `--check`（读数见 §7）
- [ ] 6.6 真机 269 / 270 与完整 gate 由主会话执行（worker 不跑 cargo / 真机）

## 7. r1 复跑读数（2026-11-21）

- `pnpm exec tsc --noEmit` → exit 0（`r1-tsc.log`）
- `pnpm test` → `ℹ tests 1682` / `ℹ pass 1682` / `ℹ fail 0`（`r1-unit-tests.log`）
- Playwright（4284 / 结构模式）：`harness-navigation-nov21` + `m632-path-line-range-link` +
  `quick-open` → **30 passed**（`r1-visual-green.log`；新场景 5 条含 `cron:run` 回归）
- 判别性反证（P2）：把 `handleCronRun` 的调用临时改成 `openHarnessPane(false)` 后，`cron:run`
  用例在 `.lumir-hp-composer .cm-content` 的 `toBeFocused()` 处判红（`r1-p2-cron-run-red.log`，
  exit 1）；已还原并重建
- `bash scripts/docs-check.sh` → `docs-check: PASS`（`r1-docs-check.log`）
- `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` →
  `Totals: 35 passed, 0 failed (35 items)`（`r1-openspec-validate.log`）
- `node scripts/acceptance/run.mjs --check` → `场景静态校验通过（247 个）`（`r1-acceptance-check.log`）；
  `coverage.mjs --check` → `COVERAGE PASS（247 个场景 / 224 个 item）`
