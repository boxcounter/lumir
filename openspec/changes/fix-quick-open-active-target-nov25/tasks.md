# Tasks: fix-quick-open-active-target-nov25

## 0. 批准与合同

- [x] 0.1 记录 Alex 2026-11-25「选择器按推荐」节点 1 批准及范围（只改 Quick Open 游标起点）
- [x] 0.2 起草 proposal / design / quick-open delta；其余三个选择器与视觉基线不在范围
- [x] 0.3 不变量写进 delta：「高亮行 = Enter 目标，否则无高亮；`aria-activedescendant` 与之一致」
- [x] 0.4 记录 Alex 同日**追加批准**（原话「采纳建议」，不算一次新的节点 1 评审）及四项范围：
      未定判决约 120ms + 一次本地往返的高亮延迟 / 未定窗口第一次 ↓ 落首行 / 每个未定输入一次存在
      探测（普通查询一级、`path:行` 至多两级）/ 停驻后 Enter 复用已完成探测。同日记录 ④ 的边界：
      复用只按输入原文键控，离开再回来复用旧判决，外部变化不在复用点重新验证（design §6 / spec）

## 1. 旧实现红灯

- [x] 1.1 纯函数矩阵 5 条先在旧策略（恒首行）上跑红：多候选判决行不在首位、direct-only、探测在途
      ——`unit-red-old-policy.log`（43 pass / 3 fail）
- [x] 1.2 浏览器矩阵先在旧实现上跑红：多候选（期望 `plan.md`、实得 `notes/plan.md`）、移动覆盖默认、
      探测在途（期望 0 高亮、实得 1）——`visual-red-old.log`（3 passed / 4 failed，第 4 条为断言笔误，
      修正后 `visual-red-dir-guard.log` 绿）

## 2. 实现

- [x] 2.1 `quickOpenCandidates` 行构造收口（DOM 与测试共用）
- [x] 2.2 `quickOpenStartIndex` 纯函数（open → 判决行 / -1；undecided → -1；其余 → 首行）
- [x] 2.3 `apply()` 起点改调策略；异步保位行消失时回落策略起点（纯函数 `quickOpenCursorIndex`）
- [x] 2.4 `confirm()` 动作前同步游标（判决行 / 清空 / 首行），不改 direct 打开能力；
      游标行 = 判决路径时仍走精确打开（保住 `:行` 落点）

## 3. 测试与规格

- [x] 3.1 `tests/unit/quick-open.test.ts` 新增「游标起点」矩阵并全绿
- [x] 3.2 新增 `tests/visual/scenes/quick-open-active-target.spec.ts`（**12 条**，全绿）。
      计数与来历：首批 7 条（红跑 `visual-red-old.log` 的 7 条）→ 红/绿之后补第 8 条
      「游标落在判决行本身」→ 机械核验后补第 9 条（角落反例）与第 10 条（保位判别）→
      批准记录轮补第 11 条（输入后 <120ms 立即 Enter）与第 12 条（离开再回到同一输入）。
      旧实现复跑（`visual-red-old-impl.log`）：9 passed / 1 failed——**第 8 条在旧实现上是绿的**
      （`path:line` 的旧 `probing` 已抑制高亮，它不是红灯用例，是补充回归用例）；红灯只有第 9 条。
      第 11 / 12 条的红证据见 7.3 / 7.4（旧 `src` 上分别是「2 次探测」与「首访 0 次探测」）。
- [x] 3.3 既有 `quick-open.spec.ts` / `quick-open-directory-stable.spec.ts` 全绿（42 passed；
      其中「非目录查询：↓ 后一次 Enter」按「未定期间没有游标位置」更新了时序：等落地后再按 ↓）
- [x] 3.4 `openspec/changes/.../specs/quick-open/spec.md` 的 MODIFIED requirement：改写游标条款；
      living 9 个场景 → delta 13 个——改写 1 个（「直接行与候选行并存时 Enter 打开游标行」）+
      新增 4 个（「判决可打开但没有对应候选行」/「探测在途不冒充目标」/「普通查询恰好是索引外精确路径」/
      「离开再回到同一输入复用已落地判决」）；requirement 正文补「复用键是输入原文、外部变化不在
      复用点重新验证」一句

## 4. 验收场景（静态检查；真机由主会话串行）

- [x] 4.1 230a：多候选精确路径段增加的是**Enter 目标**观测（打开根层 `plan.md`、深层同名内容不进
      正文）；高亮行 / `aria-activedescendant` 不在真机断言，由 visual 场景钉住（覆盖边界注记见
      `230a:325-329`）
- [x] 4.2 230b：lazy 与 vault 外只读段**只登记覆盖边界**（候选高亮行不在真机断言，判据归 visual）；
      既有「Enter 仍直接打开」断言未改，未新增高亮观测
- [x] 4.3 230c：重启与焦点作用域段复核无「首行假高亮」的旧表述（覆盖边界注记）
- [x] 4.4 230d：⌘A 与目录子项段**只登记覆盖边界**（同 4.2 口径），未新增高亮断言
- [x] 4.5 231-quick-open-long-path-width：长路径段复核未写死「恒首行高亮」
- [x] 4.6 874：外部目录与稳定布局段**只登记覆盖边界**（候选高亮行同样不判，由 visual 钉住），
      未新增精确路径无高亮的真机观测

## 5. 验证与交付

- [x] 5.1 目标单测、目标视觉场景、tsc（根 / 视觉 / 单测三份）、`bash scripts/docs-check.sh`、
      `openspec validate --all --strict`。日志落盘：`target-unit-r3.log`（48/48）、
      `tsc-root.log` / `tsc-visual.log` / `tsc-unit.log`（均 exit 0）、`visual-green-target-r4.log`
      （10/10）、`visual-green-existing-r5.log`（42/42）、`visual-structural-target-r3.log`
      （10/10，CI 结构层同款）、`visual-green-adjacent-r3.log`（42/42 = escape 11 + focus 14 +
      gutter-copy 11 + m702 6）、`unit-all-r5.log`（1998/1998）、`docs-check-r4.log`（PASS）、
      `openspec-validate.log`（39/39）；红证据 `visual-red-old-impl.log` / `unit-probe-old-impl.log`
      / `visual-red-probe-count.log`（5 failed，全部为探测次数期望 1、实得 2）
- [x] 5.1a 批准记录轮的复跑（同一批命令，日志各自独立）：`target-unit-r4.log`（48/48）、
      `visual-green-target-r5.log`（**12/12**）、`visual-structural-target-r4.log`（12/12，CI 结构
      层同款）、`tsc-root-r2.log` / `tsc-visual-r2.log` / `tsc-unit-r2.log`（均 exit 0）、
      `unit-all-r6.log`（1998/1998）、`docs-check-r5.log`（PASS）、`openspec-validate-r2.log`
      （39/39）；本轮红证据 `visual-red-fast-enter.log` / `visual-red-return-raw.log`（见 7.3 / 7.4）。
      既有 42 条与相邻 42 条未复跑：本轮只动 change 文档与本场景文件，产品代码零改动。
      全量前端第一次跑撞上 `link-suggest` 的同步预算抖动（万文件过滤 23.01ms > 16ms，同进程其余
      1997 条全绿），空载重跑 1998/1998——是负载下的计时抖动，与本 change 无关（该文件不在改动面）
- [ ] 5.2 完整 `gate quick` / `gate visual` 与真机复验由主会话串行执行（本 worker 不启动真机）
- [x] 5.3 证据落 `.local/missions/quick-open-active-target/`；提交本分支，不 push / merge / archive

## 6. 机械核验后的修正（2026-11-25）

- [x] 6.1 角落修复：`undecided` 的游标起点改为**一律 -1**；`shouldProbe` 改为对每个未定判决发起
      （去抖 120ms 不变 = 一次停驻一次完整判决的探测）；同一输入的 Enter 复用这一份，不再探测
- [x] 6.2 `confirm()` 的游标同步提到动作之前、对所有判决生效：被抑制的游标不会把「有候选」误报成
      「找不到」，`open` 判决仍先落到判决行（或清空）再 `openDirect`
- [x] 6.3 纯函数 `quickOpenCursorIndex` 收口「按行身份保位 / 保位行消失回落策略起点」，单测直驱
      两个分支
- [x] 6.4 角落视觉反例：旧实现红（`visual-red-old-impl.log`：`.is-active` 期望 0、实得 1）、
      修后未定与落地都不亮且 Enter 打开索引外精确路径（`visual-green-target-r4.log` 第 9 条）
- [x] 6.5 保位判别视觉用例：探测在途移到非判决行，落地后仍在该行（不是判决行），Enter 打开保位行
      （`visual-green-target-r4.log` 第 10 条）
- [x] 6.6 spec / design / proposal 措辞同步（探测发起条件、普通过滤的默认承诺边界、已知边界）
- [x] 6.7 `openspec validate --all --strict` 输出落 `openspec-validate.log`
- [x] 6.8 探测次数收口：`confirm()` 与结果区补帧共用同一输入的判决（`resolutionFor`：已落地复用、
      在途加入、输入改变才重新探测）。visual 以精确次数断言：普通查询停驻 1 次、停驻后 Enter 仍 1 次；
      `path:行` 沿既有阶梯 1 次、Enter 后仍 1 次。红证据 `visual-red-probe-count.log`（5 failed，
      全部为期望 1、实得 2），修后 `visual-green-target-r4.log` 10/10
- [x] 6.9 ARIA 至多一行：`expectActiveRow` 增断言全列表 `aria-selected=true` 恰 1 条（无高亮时 0）
- [x] 6.10 相邻完整集重跑：`visual-green-adjacent-r3.log` 42/42（补回 `gutter-copy-path-line`
      11 条；上一版 `-r2.log` 的 31 条不含它，不作为 42 的等价回归）
- [x] 6.11 文档收口：proposal / tasks 的「新场景」口径统一为「改写 1 + 新增 3（living 9 → delta 12）」、
      纯函数单测改 7 条（游标起点 6 + 异步保位 1）；design §3 的「`confirm()` 的 open 分支」改为
      对所有判决生效；spec 的探测描述改为「沿阶梯逐级、同一输入的 Enter 复用已落地判决」
      （本轮新增第 4 个新场景后口径改为「改写 1 + 新增 4（living 9 → delta 13）」，见 7.6）

## 7. 批准记录、复用边界与补测（2026-11-25）

- [x] 7.1 proposal 评审记录：节点 1 原话「选择器按推荐」与其范围保持原文；新增同日「追加批准」段，
      原话「采纳建议」，逐条写四项（未定判决约 120ms + 一次本地往返 / 未定窗口第一次 ↓ 落首行 /
      每个未定输入一次存在探测 / 停驻后 Enter 复用已完成探测），并明写「不是另一次节点 1 评审」；
      「**待 Alex 确认**」段整段删除——归档时不把旧表述带走（全文件已无该措辞）
- [x] 7.2 复用边界落进 design §3 / §6 与 spec 的 requirement + 新场景：`settled` 只按输入原文键控，
      同一浮层内离开再回到同一串复用旧判决，外部文件 / 索引变化不在复用点重新验证；关闭浮层
      （`dismiss`）或进入目录（`enterDirectory`）复位
- [x] 7.3 visual 第 11 条（输入后 <120ms 立即 Enter）：Enter 先发起那唯一一次、去抖计时器到点后
      加入同一在途 promise，发起 1 次 / 应答 1 次。红证据 `visual-red-fast-enter.log`（`src` 取
      `9f3744a3`：停驻探测已存在而 `confirm` 不共享 ⇒ 发起 2 次）；绿 `visual-green-target-r5.log`。
      口径注记：更早的 `5c95abb0` 上这条是**绿**的——那版对普通查询根本不发起停驻探测，1 次全是
      Enter 发的；能判红的现场是「停驻探测存在但不共享」，所以红基线取 `9f3744a3` 而不是 `5c95abb0`
- [x] 7.4 visual 第 12 条（离开再回到同一输入）：回到时 `.is-active` 同步到位（一次性读，不轮询），
      离开期间 re-stub 的「`plan` 存在」不触发新探测，Enter 仍打开旧判决的游标行。红证据
      `visual-red-return-raw.log`（旧 `src`：同串首访根本不发探测，计数 0）；绿
      `visual-green-target-r5.log`
- [x] 7.5 机械核验 P2（批准记录）/ P3-1（`settled` 边界）/ P3-2（<120ms Enter）关闭；5.1a 的指针
      全部指向本轮日志，不复用上一轮文件名
- [x] 7.6 文档计数同步：proposal 第 3 / 4 条、tasks 3.2 / 3.4 / 5.1a、design §5 统一为「浏览器矩阵
      12 条」「living 9 → delta 13（改写 1 + 新增 4）」
