# Tasks: toc-popover-emacs-keys-and-max-height

> 本 change 的**节点 1（提案评审）已完成**：Alex 2026-09-17 裁决「采纳」，本批次进入实现。
> 实现批次逐项勾选，每条须给**可复核的证据指针**（命令 / 场景名 / 文件 / 基线名），拿不出证据的写「未验」。
>
> **实现记录（M160，2026-09-17）**——逐项勾选见下，未覆盖/未执行的三处在此一次说清，不散落在勾选里：
> - **`文案-Copy.md` D86（3.1 / 3.2）未改**：tower 裁决该文件归 M159（并行 mission 先批先得，避免两处
>   并行改同一文件）。实现侧的新串已落在 `src/toc.ts` 的 `POPOVER_HINT`，文案全文随 M160 的
>   review-request 交付，由 tower 在合并时作为 integration fix 落盘。
> - **`docs/backlog.md` 的待归档记录（6.6）未落**：该文件不在 M160 的 scope 内，交 tower 在合并时处置。
> - **真机执行（2.4 的 `13-toc` 步骤、6.4）与 cargo 三层（6.2）未跑**：M159 持 `/tmp/lumir-cargo-build.lock`
>   并占 1430 端口做真机验收，同机并行会争磁盘与 CPU。`13-toc` 的新步骤已过静态校验（4.3），真机结论待
>   批次收尾跑；cargo 三层按批次口径「零 Rust diff（本 change 无 Rust 改动）+ base 全绿继承」。
>
> **归档记录（节点 2，2026-09-18）**——上面那条实现记录里的三处未覆盖/未执行项，在归档动作里逐项收口：
> - **3.1 / 3.2（`文案-Copy.md` D86）→ 勾掉**：产物已由 tower 的 integration fix `a779cbb` 落在 master
>   （`文案-Copy.md:77` 的五键串、`:103` 的 M160 扩键注记、`:111` 的归属登记）。
> - **6.2（cargo 三层）→ 勾掉，补上缺的继承证据指针**：`d4ca60a` 零 Rust diff（`git show --stat` 9 个文件无
>   `src-tauri/**`）+ CI `rust.yml` 在 `2f16f86` 上 success（run `35287313039`）；**本地仍未跑 cargo 三层**，
>   勾选依据是「零 Rust diff + base 继承」，不宣称本地跑过。
> - **6.4（真机 `13-toc`）→ 勾掉**：M164 全量 26/26（含 13-toc）+ `test-results/acceptance/2026-09-18/13-toc/`
>   的 PASS（46 断言 / 0 失败）。
> - **6.6（backlog 待归档记录）→ 勾掉**：由本 mission 补落 `docs/backlog.md` 第 20 条并当日核销（如实记明
>   「合并时未落」，是 M150 同类缺口的复发实证）。
> 归档对账结论：两份 delta 与实现逐条一致（`toc-outline` 2 条 MODIFIED、`keymap-commands` 1 条 MODIFIED），
> 无实现期静默扩 scope、无新建 capability（故无 Purpose 占位）、无相对链接死链；归档为
> `openspec/changes/archive/2026-09-18-toc-popover-emacs-keys-and-max-height/`。

## 1. 浮层最大高度 80%（响应式）

- [x] 1.1 `src/style.css`：`.lumir-toc` 增 `max-height: 80vh` 与列向 flex
      （`display: flex; flex-direction: column`）。注意全局 `* { box-sizing: border-box }`，
      因此这里的 80vh 天然是**含内边距与底部提示的总高**——与 spec 的「浮层总高」口径同一件事，
      不要写成 `calc(80vh - 提示高)` 那类减法（那会引入第二处高度真源）
      —— 证据：`src/style.css` 的 `.lumir-toc` 段（含口径注释，未写减法）
- [x] 1.2 `src/style.css`：`.lumir-toc-list` 从 `max-height: 55vh` 改为 `flex: 1 1 auto; min-height: 0`
      （保留 `overflow: auto` 与 `outline: none`）——列表成为唯一滚动容器；`min-height: 0`
      是 flex 子项能收缩到内容高以下的前提，漏了它上限会失效
      —— 证据：`src/style.css` 的 `.lumir-toc-list`；运行时判据见 1.5 的 `scrollHeight > clientHeight`
- [x] 1.3 `src/style.css`：`.lumir-toc-hint` 增 `flex: 0 0 auto`，否则 flex 会压缩它
      （「提示常驻可见」是 requirement，不是观感偏好）
      —— 证据：`src/style.css` 的 `.lumir-toc-hint` + 1.5 的 `toBeVisible()` 断言
- [x] 1.4 复核 `.lumir-toc[hidden] { display: none }` 在加了 `display: flex` 之后仍然生效
      （`.lumir-toc[hidden]` 的选择器优先级 0-1-1 高于 `.lumir-toc` 的 0-1-0），空态 MUST NOT 因
      这次改动把隐藏的浮层露出来：`tests/visual/scenes/toc-outline.spec.ts` 的空态断言即防线
      —— 证据：优先级 0-2-0 > 0-1-0（`.lumir-toc[hidden]` 与 `.lumir-toc` 同行可见）+
      `toc-outline.spec.ts` 里 `await expect(page.locator(".lumir-toc")).toBeHidden()` 在
      `Esc` 关闭后通过（视觉套件全绿，见 6.3）
- [x] 1.5 证据：视觉场景新增高度断言——浮层 `getBoundingClientRect().height ≤ innerHeight * 0.8`；
      **必须用标题条数远超一屏的 fixture**（现有 `toc-outline.md` 只有 10 条标题，10 × 25.5px 连
      55vh 都填不满，拿它断言「不超 80%」是恒真断言，见 REVIEW.md 第 1 条）；同时断言列表
      `scrollHeight > clientHeight`（真在浮层内滚）与底部提示 `toBeVisible()`
      —— 证据：`tests/visual/scenes/toc-outline.spec.ts` 的「浮层总高上限」测试（`LONG_DOC` = 60 条，
      判据取 `document.documentElement.clientHeight`——`vh` 的基准）。**并补了一条下限**
      （`height > 0.8 * 视口高 - 1.5`）：只判「不超过 80%」在旧 CSS 下是恒真——反向验证实测
      旧 `max-height: 55vh` 时读数 483px，超过上限的断言不判任何东西，下限那条才 FAIL
      （`git stash push -- src/style.css` 后跑 `scripts/visual/run.sh -g "浮层总高上限"`：1 failed，
      `Expected: > 638.5 / Received: 483`）
- [x] 1.6 证据：同一场景里 `page.setViewportSize()` 改窗口高后重读高度，断言上限跟着变
      （响应式口径），且浮层保持打开时不需重开
      —— 证据：同一测试的后半段（1200×400 后重读 `viewport == 400`、上下限重新判、列表滚动与提示可见仍在）

## 2. 浮层内的 Emacs 上下键

- [x] 2.1 `src/toc.ts` 的 `onKeydown`：`Ctrl-N` → `move(1)`、`Ctrl-P` → `move(-1)`
      （与 `↑↓` 共用同一移动实现，MUST NOT 写第二套下标逻辑）
      —— 证据：`src/toc.ts` 的 `onKeydown`（`case "Ctrl-N":` 与 `case "ArrowDown":` 落进同一个
      `this.move(1)`，无第二套下标逻辑）
- [x] 2.2 实测两条 token 的实际输出（`Ctrl-N` / `Ctrl-P`）与表内既有 `Ctrl-n` 的归一化一致，
      避免大小写漂移成静默不匹配；浮层关闭后这两个 token 归 `editor.cursor-down/up`，本 change
      不改那两条绑定
      —— 证据：`tests/unit/keys.test.ts` 的 `keyToken` 测试断言 `keyToken({key:"n",ctrlKey:true}) === "Ctrl-N"`
      （`node tests/unit/run.mjs` 26/26 PASS）；表内 `Ctrl-n` / `Ctrl-p` 两条绑定未改
      （`src/keys.ts` 只动了注释）；浮层里 `page.keyboard.press("Control+n")` 真的移动了游标
      （视觉场景全绿），关闭后同一键交还编辑器（2.4）
- [x] 2.3 `src/toc.ts` 文件头注释补一段：这两条键为什么**不进** `keys.ts`（同 `↑↓` 的口径；
      已被 `editor` 作用域占用、同 token 第二条绑定会被构造期拒绝），指针指向 `toc-outline` spec
      的「命令入口与浮层内键位的归属」
      —— 证据：`src/toc.ts` 文件头第二段注释（含 `openspec/specs/toc-outline/spec.md` 的
      「命令入口与浮层内键位的归属」指针）；`src/keys.ts` 的 M148 段同步为五个就地键
- [x] 2.4 证据：视觉场景新增「`⌃N` / `⌃P` 与 `↑↓` 同落点（含末项钳制）」「`Esc` 关闭后再按 `⌃N`
      由编辑器接管（光标真的下移一行、文档字节不变）」两组断言；真机 `13-toc` 补对应步骤（键盘注入
      走「回读 + 只在字节未变时重试」，不用重试次数当判据——套件 README 的历史教训）
      —— 视觉侧：`toc-outline.spec.ts` 的「浮层：…键盘导航与跳转落点」测试新增块（⌃N/⌃P 等价、
      首末项钳制、`caret` 不变 + `docText` 逐字节不变、`Esc` 后 `caret.line + 1`）。
      —— 真机侧：`13-toc.md` 的「⌃N 连按四次 / ⌃P 连按三次 / 关闭后 ⌃N 归还」三步已写好，
      归还判据用指示段链条的派生证据（不改文档字节，比 ⌃K 合并那条轻）；**真机执行未跑**（M159 占 1430）。

## 3. 键位提示文案（D86）

- [x] 3.1 `文案-Copy.md` D86 更新为覆盖五个就地键。建议文案：
      `↑↓ ⌃N⌃P 选择 · Enter 跳转 · Esc 关闭`（同义键并成一组、共用一个动作词，与既有
      「键 + 动作词」的行文一致）。宽度预算：浮层宽 300px、提示内边距 12px → 可用约 276px，
      且 `.lumir-toc` 继承 `.masthead` 的 `letter-spacing: .08em`——该串**预计单行放得下，
      以实测为准**；实测放不下时改紧凑写法
      —— **归档时勾掉（2026-09-18，节点 2）：产物已由 tower 的 integration fix 落盘**（merge `a779cbb`）——
      `文案-Copy.md:77` 的 D86 已是 `↑↓ ⌃N⌃P 选择 · Enter 跳转 · Esc 关闭`（与本条建议文案一致）。
      M160 实现侧的新串在 `src/toc.ts` 的 `POPOVER_HINT`。宽度**已实测单行放得下**：元素基线
      `toc-popover-chromium-darwin.png`（301×171）里提示占一行
- [x] 3.2 同文件末尾的「文案实现备注」段补 M157 的出处（与本 deck 既有记法一致）　**归档时勾掉（2026-09-18，节点 2）：产物已在 master**——`文案-Copy.md:111` 已登记 D86 归 `src/toc.ts` 的 `POPOVER_HINT` 并附「M160 未新增条目」说明；`:103` 记「D86 于 M160（2026-09-17）扩为覆盖五个就地键，编号沿用不改」。落盘提交为 tower 的 integration fix `a779cbb`。
      —— **未改文件**（同 3.1）；文案全文随 M160 的 review-request 交付 tower
- [x] 3.3 证据：`tests/visual/scenes/toc-outline.spec.ts:122` 的 `toHaveText` 断言更新为新串；
      `scripts/acceptance/scenarios/13-toc.md` 里 **13 处** `↑↓ 选择` 探针与正文「断言口径」段的
      说明同步（该串是套件判定「浮层开着」的唯一依据，漏一处就是整条场景假绿或假红）
      —— 证据：`toc-outline.spec.ts` 的 `toHaveText("↑↓ ⌃N⌃P 选择 · Enter 跳转 · Esc 关闭")`
      （视觉套件全绿）；13-toc 里 `grep -c '↑↓ 选择'` = **0**、`grep -c '⌃N⌃P 选择'` = 17
      （13 处原探针 + 新增步骤 3 处 + 正文说明 1 处）

## 4. 验收与视觉门禁

- [x] 4.1 `scripts/acceptance/fixtures/`：新增一份标题条数远超一屏的 fixture（如 60 条标题，
      H1–H4 混排），供高度上限断言使用；现有 `toc-outline.md`（10 条）保留原用途
      —— 证据：`scripts/acceptance/fixtures/toc-long.md`，`grep -c '^#'` = 60（15 章 × H1–H4），
      `toc-outline.md` 未改动；视觉侧同一形状的输入按程序生成为 `LONG_DOC`（chromium 场景读不到
      验收 vault，两套各自持有 fixture）
- [x] 4.2 `scripts/acceptance/scenarios/13-toc.md`：新增 `⌃N` / `⌃P` 移动步骤——移动判据沿用既有
      「同一 AX 行同时带条目标题与 `(focused)`」形态（不用跨节点正则，REVIEW.md 第 1 条）；
      「关闭后 `⌃N` 归还」用编辑器文档文本的派生证据（导航后按 `⌃K`，行尾才会连带换行）
      —— 证据：`13-toc.md` 的「⌘⇧O 打开长文的大纲 → ⌃N 连按四次 → ⌃P 连按三次 → Esc → 关闭后
      ⌃N 归还」五步。归还判据改用**指示段链条**（同为派生证据但轻：⌃K 那条会真写文档、留下 dirty
      态挡住后续换文件）；⌃N 的落点判据是 `/AXStaticText \(第 2 章 概览\).*\(focused\)/`（既有形态）
- [x] 4.3 `node scripts/acceptance/run.mjs --check` 静态校验通过（新增 fixture 名与步骤形态）
      —— 证据：`--check` 输出 22 个场景全 `CHECK PASS`（含 `13-toc`）
- [x] 4.4 `tests/visual/scenes/toc-outline.spec.ts`：提示文案断言、`⌃N` / `⌃P` 导航、关闭后归还、
      高度上限与响应式断言；元素级基线 `toc-popover-chromium-darwin.png` 重拍
      （浮层变高 + 提示文案变化都会反映在该元素截图里）
      —— 证据：`LUMIR_VISUAL_PORT=4273 scripts/visual/run.sh` 全绿；重拍 `toc-popover.png`
      （提示文案变化，523px 差异）、新增 `toc-popover-long.png`（301×640 = 80% × 800，浮层总高的
      元素基线）。前后截图见交付说明（`/tmp/lumir-m160-baseline/`），**待 Alex 过目**
- [x] 4.5 整页基线核对：浮层只在该场景里短暂出现，**预期整页基线零变化**；按 REVIEW.md 第 3 条
      的纪律，逐张核对 `tests/visual/baselines/**` 里出现过浮层的那张的时间戳是否随本次更新，
      并如实记录「零变化」的核对方式（不是默认它没变）
      —— 核对方式（**内容判据，不是时间戳**）：`grep -rln "lumir-toc" tests/visual/scenes/`
      只命中 `toc-outline.spec.ts`，而该场景里两处截图都是**元素级**（`page.locator(".lumir-toc")`），
      浮层从不进任何整页截图；`git status --porcelain tests/visual/baselines/` 只有两张元素基线
      （`M toc-popover-chromium-darwin.png`、`?? toc-popover-long-chromium-darwin.png`），
      其余 18 张逐字节零变化。注意本 worktree 里全部基线的 **mtime 都是 2026-09-17**（checkout
      那刻拷进来的），所以时间戳在这条上不具区分度——判据必须落在 git 内容差异上
- [x] 4.6 基线更新前截图须 Alex 过目（`tests/visual/README.md` 的基线更新纪律：基线更新是人肉
      裁决点）
      —— 已就绪待过目（不是已裁决）：前 `toc-popover-BEFORE.png`、后 `toc-popover-AFTER.png`、
      新增 `toc-popover-long-AFTER.png` 三张在 `/tmp/lumir-m160-baseline/`（本机可 `ls`），
      路径已随 M160 的 review-request 交 tower 转 Alex

## 5. openspec 制品

- [x] 5.1 `specs/toc-outline/spec.md`：MODIFIED `大纲浮层`（`⌃N` / `⌃P` 等价口径 + 80% 高度
      口径 + 提示覆盖义务 + 3 条新 scenario：`⌃N`/`⌃P` 等价、高度 80% 响应式、就地键与新提示同步）
      —— 证据：`specs/toc-outline/spec.md`（delta，节点 1 已批准）
- [x] 5.2 `specs/toc-outline/spec.md`：MODIFIED `命令入口与浮层内键位的归属`（就地键集合扩到五个、
      「不进表」的理由、生效条件与归还 + 2 条新 scenario）
      —— 证据：同文件第二个 MODIFIED requirement
- [x] 5.3 `specs/keymap-commands/spec.md`：MODIFIED `大纲开关——⌘⇧O 与 toc.toggle`（就地键枚举
      同步为五个——那份 living spec 点名了浮层的就地键集合，不同步就在归档后留下与实现不符的枚举）
      —— 证据：`specs/keymap-commands/spec.md`（枚举已含 `⌃N` / `⌃P`）；实现侧同一枚举在
      `src/keys.ts` 的 M148 段注释里同步（5 处文案一致）
- [x] 5.4 实现期若发现 proposal 的意图需要变更（例如 Alex 在节点 1 把 `⌥<` / `⌥>` 或
      `⌃V` / `⌥V` 拉回来），先更新 proposal 再动代码，不静默扩 scope（`openspec-workflow.md` 第 4 条）
      —— **无需变更**：节点 1 裁决为「只纳入 ⌃N/⌃P」，与本 change 的 proposal/delta 一致，
      proposal 与 delta 未改动

## 6. 验证

- [x] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
      —— 证据：命令输出（见交付说明）
- [x] 6.2 `scripts/gate.sh quick` 全绿（本 change 无 Rust 改动，Rust 门禁应无新增失败）
      —— **cargo 三步（fmt / clippy / test）未跑**：M159 持 `/tmp/lumir-cargo-build.lock` 冷构建并占
      1430 做真机验收，同机并行 cargo 会争磁盘（当时可用 4.1Gi）。已跑的前端层全绿：`tsc-root`
      `tsc-visual` `tsc-unit` `unit-tests`（26/26）`acceptance --check`（22/22）`docs-check`
      `openspec validate --strict`。本 change **零 Rust diff**，cargo 三层按批次口径继承 base 绿灯，
      或待 M159 release 后补跑
      —— **归档时勾掉（2026-09-18，节点 2），并补上本条缺的继承证据指针**：① 零 Rust diff 实测——
      `git show --stat d4ca60a` 的 9 个文件全在 `src/**`、`tests/visual/**`、`scripts/acceptance/**` 与
      本 change 目录内，无 `src-tauri/**`；② CI `rust.yml` 在含该改动的 `2f16f86` 上 **success**
      （run `35287313039`，`gh run list --commit 2f16f86` 可复现）；③ 前端层已跑七项同上。**本地 cargo
      三层仍未跑**（理由不变），本条勾选依据是「零 Rust diff + base 继承」，**不宣称本地跑过 cargo**。
- [x] 6.3 `scripts/gate.sh visual` 全绿（含 `toc-outline` 场景的新断言与新基线）
      —— 证据：`pnpm --dir tests/visual run test:isolation` PASS；
      `LUMIR_VISUAL_PORT=4273 scripts/visual/run.sh` → **231 passed**（含新断言与新基线）；
      反向验证：`git stash push -- src/style.css` 后同一场景 **1 failed**（旧 55vh 读数 483px）
- [x] 6.4 真机（WKWebView）：`node scripts/acceptance/run.mjs 13` 单场景 PASS，再跑全量；
      证据落 `test-results/acceptance/<日期>/`，报告里给可 `ls` 的绝对路径指针
      —— **归档时勾掉（2026-09-18，节点 2），两条证据都经 `ls` 复核**：① M164 的全量真机 **26/26 PASS**
      （含 `13-toc`），证据 `test-results/acceptance/2026-09-17/`（git 外，`13-toc/status.txt` 存在）；
      ② **更新的一次复跑**：`test-results/acceptance/2026-09-18/summary.md` 的 `13-toc` = PASS / 46 断言 /
      0 失败 / 52.8s，证据目录 `test-results/acceptance/2026-09-18/13-toc/`（`status.txt` = PASS，
      含 steps.md / shots/ / ax/）——即本条要求的「单场景 PASS，再跑全量」里的单场景一步在 M160 之后
      已由批次收尾补跑，全量一步由 ① 的 26/26 承担。原「未跑」理由（M159 占 1430）已随批次串行化消失。
- [x] 6.5 `git diff --check` 通过；改动文件集合与 mission scope 一致（跨 scope 的只读依赖若出现，
      须在 tower 批准后再动）
      —— 证据：`git diff --check` 无输出；改动集合 = `src/toc.ts` / `src/style.css` / `src/keys.ts`
      （注释）/ `scripts/acceptance/scenarios/13-toc.md` / `scripts/acceptance/fixtures/toc-long.md` /
      `tests/visual/scenes/toc-outline.spec.ts` / 两张元素基线 / 本 change 目录。其中 `tests/visual`
      与基线两项是 tower 2026-09-17 12:03 的裁决放宽（原 scope 未含）
- [x] 6.6 实现 PR 合并时在 `docs/backlog.md` 的「待 Alex 裁决」节落一条**待归档记录**
      （`openspec-workflow.md` 的批次收尾 checklist 第一条），批次收尾时跟踪到归档
      —— **归档时勾掉（2026-09-18，节点 2）：记录由本 mission 补落并当日核销**。`docs/backlog.md`
      「待 Alex 裁决」新增第 20 条，正文如实记明「合并时未落、归档前补记」，随后随本次归档核销
      （「已核销」节同步留痕）。M160 的「未落」理由（该文件不在 M160 的 scope 内）成立，所以这不是
      M160 的欠账，而是「每个 merge 的 change 即记待归档」这一环在本 change 上确实断过的实证——
      与 M150 记过的失效模式同类。

## 7. 已知边界 / 不做

- [x] 7.1 翻页键（`⌃V` / `⌥V`）不做：Emacs 的这两个键是视口命令（按窗口高滚动 + 2 行重叠 + 光标
      仅在滚出窗口时落到边界行），忠实复刻要引入几何测量——留待手感证据再议
      —— 已遵守：`src/toc.ts` 的 `onKeydown` 只多了 `Ctrl-N` / `Ctrl-P` 两条分支
- [x] 7.2 首末项键（`⌥<` / `⌥>`）不做：编辑器侧没有 `M-<` / `M->`（表内无 `Alt-Comma` /
      `Alt-Period`），只做浮层会造成「同一物理键两个上下文两种语义、编辑器那侧还是坏的」。
      编辑器层的缺口已作为 finding 交 tower 路由；浮层的首末项等那一层定下来再对齐
      —— 已遵守：表内无 `Alt-Comma` / `Alt-Period`，浮层无首末项分支
- [x] 7.3 就地键不进 `KEY_BINDINGS`、不进 `[keys]` 配置、不出现在键位面板：唯一出口是浮层提示
      —— 证据：`src/keys.ts` **零绑定改动**（只改注释）；面板渲染的是生效表，故面板不变
- [x] 7.4 浮层的水平定位不随窗口 resize 重排（M148 既有边界，本 change 只动高度）
      —— 已遵守：`src/toc.ts` 的 `place()` 未改动（视觉场景里 `setViewportSize` 只用于高度口径）
- [x] 7.5 窗口内容区高 < 285px 时浮层底边可能越出窗口——不加钳制（避免把 masthead 高度复制成
      第二处真源），作为已知边界写进 spec
      —— 已遵守：`.lumir-toc` 无高度钳制逻辑，边界写在 delta spec 与 `src/style.css` 注释里
