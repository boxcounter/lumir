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

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（39 passed / 0 failed）。
- [x] 5.2 `bash scripts/docs-check.sh` 通过（含归档对账、验收场景契约与覆盖表）。
- [x] 5.3 目标测试：`bash scripts/visual/run.sh scenes/selector-aria-ime-nov25.spec.ts` 全绿（12 条：
      原 10 条 + 焦点矩阵 + Esc / 游标移动取消）；回归 `list-filter` / `mv-vault-switcher` /
      `m668-vault-remove-focus` / `toc-outline` 24 条全绿；`pnpm test` 2001 pass / 0 fail；
      `tsc --noEmit` 与 `tests/visual` 的 tsc 均 exit 0。
- [ ] 5.4 真机复跑（主会话串行）：`node scripts/acceptance/run.mjs 13`、`17` 通过；另按真机清单
      手工复核组合期行为（真实中文 IME 下组合期 `↓` / `Enter` 不导航、不接受，组合结束后列表
      按最终串刷新一次）。
- [ ] 5.5 完整门禁由主会话执行：`bash scripts/gate.sh quick` 与 `bash scripts/gate.sh visual`
      （动过 `src/style.css`，像素层必跑）。

## 6. 第三轮（机械复核第二轮剩余边界）

> 依据：`.local/reviews/selector-ime-aria-nov25/mechanical.md` §4 的 1–4 / 7 / 11 六项。

- [x] 6.1 `src/vault-switcher.ts`：失效行进入**键盘游标空间**（`rows` = 本次渲染的全部行）。
      理由：把「清理失效项」留给指针等于把主用例关在键盘之外，而「筛出失效行再按 Delete」这条
      替代路径被「查询非空不消费」封死（筛出它必须输入查询）。`aria-disabled` 保留（只表示
      「不能切换过去」，与原生 `disabled` 不同）；`Enter` 落在失效行上走既有的重定位分支（此前
      是不可达的死代码）。**行为变更（Alex 已采纳）**：失效行进入游标空间、`Delete` 删除、`Enter`
      重定位；`↑↓` 因此会停在失效行上，master 的 `tests/visual/scenes/mv-vault-switcher.spec.ts`
      与 `list-filter.spec.ts` 的相应断言随之更新。delta 的「失效行 MUST NOT 进入游标空间」整句
      改写为「同样在游标空间里」。
- [x] 6.2 `src/vault-switcher.ts`：`Delete` / `Backspace` 只在 `document.activeElement === input`
      时接管（keydown 挂在浮层容器上，Tab 到「新增 vault…」后按键照样冒泡）。焦点矩阵有单测与
      chromium 用例。
- [x] 6.3 确认态改为 `{ rowId, commit, cancel }`：游标移动（`move` 先取消再移动）、查询变化
      （`render` 重建）都取消确认；`resumeRow` / `suspendRow` 记录「原本是不是游标行」，取消时
      游标在别处就**不**把它搬过去。
- [x] 6.4 `Esc` 第一次只撤确认、第二次才关层：撤确认走浮层就地处理器 + 同一份 `escapeDisposition`
      准入（组合期 / 带修饰键口径与窗口兜底一致），层栈不注销——不能下沉到 `escapeRouter`，它
      关层后会无条件把该层移出栈。撤确认前先看 `escapeRouter.top()`：别的层在栈顶时这一拍归
      路由（关顶层），MUST NOT 抢着撤确认（第四轮收口，见 7.1）。取消钮加
      `aria-keyshortcuts="Escape"`。
- [x] 6.5 `onVaultLoaded` 重建行 DOM 时按 id 保游标（确认态在场时按确认行 id）：装载不再把用户
      挪开的游标抢回当前项，重建丢掉确认态后下一次 `Delete` 仍指向同一行。
- [x] 6.6 组合期 `Delete` / `Backspace` 反例：单测两条（`isComposing` 与 `keyCode === 229`，含
      确认态在场时不提交）+ chromium 组合矩阵扩到 9 键。
- [x] 6.7 验收场景 17 补「Esc 第一次只撤确认 → 再按 Delete 重新武装 → 第二次提交」三步（真机
      复跑归主会话）。

## 7. 第四轮（机械核验第三轮剩余项收口）

> 依据：`.local/reviews/selector-ime-aria-nov25/mechanical.md` §4 的 2 / 3 / 4 / 5 / 6 / 9 六项。
> 证据落 `.local/probes/selector-ime-aria-nov25/`（`r4-green-*.log` / `r4-red-*.log`），索引与红根
> 说明见同目录 `r4-red-roots.md`（7.6）。

- [x] 7.1 `Esc` 撤确认尊重层栈：撤确认分支先看 `escapeRouter.top()`，别的层在栈顶时把这一拍交给
      `escapeRouter.handle`（关顶层），确认态不动；栈顶是本层时第一次 Esc 才撤确认（`onKeydown`）。
      单测「确认态的 Esc 尊重层栈」用后登记的层演更高层，逐拍断言：关顶层 → 撤确认 → 关浮层。
- [x] 7.2 确认态唯一：`enterConfirm` 进入时若已有确认，先撤掉它（该行逐字还原）再进入新的——
      指针先后对 A、B 两行点 × 只剩一处确认，提交路径只有一条、只发一次移除。单测钉住
      「替换后先前那行还在、提交只移除后者」。
- [x] 7.3 失效行 `Delete` 端到端：视觉场景补「↑ 到失效行 → 第一次 Delete 确认 → 第二次移除」；
      验收场景 17 追加同一条（seed 一条惰性缺失的注册项，`vault_list` 按目录存在性给
      `available=false`）。
- [x] 7.4 失效行 `Enter` 重定位：视觉场景用 `vault_open` 的重映射候选桩跑完整链路
      （`vault_open → vault_remap → vault_open_path`），断言映射点名失效项稳定 id、按新根装载、
      不发起切换。真机侧受原生目录选择器限制（套件不驱动原生对话框），由视觉层判。
- [x] 7.5 当前失效行 `is-current` + `is-missing`：补计算样式与 WCAG 对比度断言（行底色 / 前景 /
      名称与「路径不可用…」两处文字 ≥ 4.5:1，且与可用 vault 的当前行逐值一致——失效不另起一套
      色）。未改动 `src/style.css`。
- [x] 7.6 证据落盘：目标视觉 / 24 条回归 / 全量单测 / 两条 tsc / `docs-check` / `openspec validate`
      的绿跑日志，加两份**分开的红证据**：回退 `src/vault-switcher.ts` 到 `37cebd2c` 的整份红跑
      （组合期 Delete 那条的红根 = 失效行前置，须在说明里点明），以及只摘掉组合期守卫的 mutant
      红跑（证明守卫本身的区分度）。commit message 不再充当证据。

## 备注（合并时由主会话统一）

- `docs/specs/selector-contract.md` 由并行 change（`fix/selector-scroll-auto-select-nov25`）落地，
  本 change 只引用、不编辑。该合同的 C5 写「已打开的候选在 `compositionstart` 关闭」，与本 delta
  的「组合期冻结刷新、保持打开」不是同一口径；合并时需在合同里给 list-filter 类浮层写明例外（或
  统一措辞），两条 canonical 文本不得并存两种说法。
- 证据口径（机械核验 §8 的要求）：最终矩阵的红跑是**回退源码重跑**，归档说明不要引用
  `red-before-fix.log`（`ERR_CONNECTION_REFUSED`，无效红）；「32 回归」实为 32 passed（24 条既有
  + 8 条新增）。
- 第三轮的区分度：把 `src/vault-switcher.ts` 临时回退到 `37cebd2c` 后，本轮新增的 6 条单测全部
  判红（焦点矩阵、失效行清理、游标移动 / 查询变化取消、Esc 两次、组合期 Delete / Backspace、
  按 id 保位），恢复后全绿——新用例对旧代码有区分度。回退期间未提交、未改其它文件。
- **行为变更已获 Alex 采纳**：失效行进入键盘游标空间后，`↑↓` 会停在失效行上（此前跳过），
  并且 `Delete` 可清理它、`Enter` 走重新定位。master 的 `tests/visual/scenes/mv-vault-switcher.spec.ts`
  与 `list-filter.spec.ts` 的相应断言已同步更新。变更面：`renderRow` 的 `this.rows.push(el)`
  （失效行也进游标空间）连同本 delta 与上述测试的对应段落；其余项（焦点矩阵 / 取消语义 / Esc /
  组合期反例 / 按 id 保位 / 单一确认态 / 层栈准入）不依赖它。
