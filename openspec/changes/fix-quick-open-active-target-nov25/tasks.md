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
- [x] 3.2 新增 `tests/visual/scenes/quick-open-active-target.spec.ts`（**14 条**，全绿）。
      计数与来历：首批 7 条（红跑 `visual-red-old.log` 的 7 条）→ 红/绿之后补第 8 条
      「游标落在判决行本身」→ 机械核验后补第 9 条（角落反例）与第 10 条（保位判别）→
      批准记录轮补第 11 条（立即 Enter 与停驻计时器共用同一次）与第 12 条（离开再回到同一输入）→
      最终复核轮补第 13 条（关闭浮层重开复位）与第 14 条（进入目录后复位）。
      旧实现复跑（`visual-red-old-impl.log`）：9 passed / 1 failed——**第 8 条在旧实现上是绿的**
      （`path:line` 的旧 `probing` 已抑制高亮，它不是红灯用例，是补充回归用例）；红灯只有第 9 条。
      第 11 / 12 条的红证据见 7.3 / 7.4（旧 `src` 上分别是「2 次探测」与「首访 0 次探测」）。
- [x] 3.3 既有 `quick-open.spec.ts` / `quick-open-directory-stable.spec.ts` 全绿（42 passed；
      其中「非目录查询：↓ 后一次 Enter」按「未定期间没有游标位置」更新了时序：等落地后再按 ↓）
- [x] 3.4 `openspec/changes/.../specs/quick-open/spec.md` 的 MODIFIED requirement：改写游标条款；
      living 9 个场景 → delta 14 个——改写 1 个（「直接行与候选行并存时 Enter 打开游标行」）+
      新增 5 个（「判决可打开但没有对应候选行」/「探测在途不冒充目标」/「普通查询恰好是索引外精确路径」/
      「离开再回到同一输入复用已落地判决」/「复位后重新探测并识别新文件」）；requirement 正文补
      「复用键是输入原文、外部变化不在复用点重新验证」一句

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
- [x] 4.7 230d 真机首跑暴露候选行可访问名被视觉分段插空格（`qo-dir/ 深层 /`）：候选行显式落
      `aria-label` = 整条显示路径（目录含尾 `/`），`title` 合同不变；`quick-open-directory-stable.spec.ts`
      补目录 / 中文长目录 / 外部目录三条 `toHaveAccessibleName`；230d 断言不放松（连续串反过来
      成为可访问名的判据，深后代负向断言同时恢复区分度）

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
      层同款）、`tsc-root-r2.log` / `tsc-visual-r2.log` / `tsc-unit-r2.log`（**该轮三份日志是 0 字节，
      不能自证 exit 0**；结论由最终复核轮的 r3 日志复核，见 8.5）、
      `unit-all-r6.log`（1998/1998）、`docs-check-r5.log`（PASS）、`openspec-validate-r2.log`
      （39/39）；本轮红证据 `visual-red-fast-enter.log` / `visual-red-return-raw.log`（见 7.3 / 7.4）。
      既有 42 条与相邻 42 条未复跑：本轮只动 change 文档与本场景文件，产品代码零改动。
      全量前端第一次跑撞上 `link-suggest` 的同步预算抖动（万文件过滤 23.01ms > 16ms，同进程其余
      1997 条全绿），空载重跑 1998/1998——是负载下的计时抖动，与本 change 无关（该文件不在改动面）
- [x] 5.1b 最终复核轮的全量复跑，跑在 tip 的**干净检出**上（`git worktree add --detach <tip>`，
      避开同 worktree 里并行任务的未提交改动）：`visual-green-target-r8.log`（**14/14**）、
      `visual-structural-target-r7.log`（14/14，CI 结构层同款）、`visual-green-existing-r8.log`
      （42/42）、`visual-green-adjacent-r6.log`（42/42 = escape 11 + focus 14 + gutter-copy 11 +
      m702 6）、`target-unit-r7.log`（48/48）、`unit-all-r13.log` / `unit-all-r14.log`
      （1998/1998，连跑两次）、`tsc-root-r5.log` / `tsc-visual-r5.log` / `tsc-unit-r5.log`
      （命令回显 + `EXIT=0`）、`docs-check-r9.log`（PASS）、`openspec-validate-r6.log`（39/39）；
      红证据 `visual-red-reset-slot.log` / `visual-red-reset-cache.log`（见 8.2）。上一版 tip
      `8a1f53a1` 上的同类干净复跑同样全绿（`-r7/r6/r7/r5/r6/r10/r4/r8/r5` 一组），留档不删
- [ ] 5.2 完整 `gate quick` / `gate visual` 与真机复验由主会话串行执行（本 worker 不启动真机）
- [x] 5.3 证据落 `.local/missions/quick-open-active-target/`；提交本分支，不 push / merge / archive
- [x] 5.4 230d 真机复跑（隔离端口 1431，runner 自带 XDG / 合成 vault / 锁）：**1/1 PASS**，
      证据 `.local/acceptance/2026-11-25-quick-open-active-target-final-r2/230d-quick-open-select-all-dir-children/`
      （主仓 `.local`，worktree 清理后仍可开）；AX 读数为
      `[312] AXStaticText (qo-dir/深层/)`（修复前 `(qo-dir/ 深层 /)`），
      `qo-dir/直接子项.md` 与「深层后代不混入」两条同时有区分度；失败首跑证据留在
      `.local/acceptance/2026-11-25-quick-open-active-target-final/230d-...`

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
- [x] 7.3 visual 第 11 条（立即 Enter 与停驻计时器共用同一次）：Enter 与去抖计时器谁先到，都由先到者
      发起、后到者加入同一在途 promise（或复用已落地判决），发起 1 次 / 应答 1 次；测试不冻结时钟，
      名称 / 注释不冒充测量 120ms 边界（最终复核轮改口径，见 8.3）。红证据 `visual-red-fast-enter.log`
      （`src` 取 `9f3744a3`：停驻探测已存在而 `confirm` 不共享 ⇒ 发起 2 次）；绿
      `visual-green-target-r5.log`。
      口径注记：更早的 `5c95abb0` 上这条是**绿**的——那版对普通查询根本不发起停驻探测，1 次全是
      Enter 发的；能判红的现场是「停驻探测存在但不共享」，所以红基线取 `9f3744a3` 而不是 `5c95abb0`
- [x] 7.4 visual 第 12 条（离开再回到同一输入）：回到时 `.is-active` 同步到位（一次性读，不轮询），
      离开期间 re-stub 的「`plan` 存在」不触发新探测，Enter 仍打开旧判决的游标行。红证据
      `visual-red-return-raw.log`（旧 `src`：同串首访根本不发探测，计数 0）；绿
      `visual-green-target-r5.log`
- [x] 7.5 机械核验 P2（批准记录）/ P3-1（`settled` 边界）/ P3-2（立即 Enter 口径）关闭；5.1a 的指针
      全部指向本轮日志，不复用上一轮文件名
- [x] 7.6 文档计数同步：proposal 第 3 / 4 条、tasks 3.2 / 3.4 / 5.1a、design §5 统一为「浏览器矩阵
      12 条」「living 9 → delta 13（改写 1 + 新增 4）」（最终复核轮改为 14 条 / delta 14，见 8.3 / 8.4）

## 8. 最终机械复核 P3 收口（2026-11-25）

- [x] 8.1 `enterDirectory()` 复位语义与 design 对齐（**产品代码零 diff**）：
      - `inflight` **不清**，理由写进 design §3：复用按输入原文键控，进目录换上的 raw 必是子项路径
        （`dir/child` 或 `dir/child/`），旧在途永远命不中；清掉它反而会在「进目录后删掉尾斜杠退回
        原串」时多发一条扫描。在途本身不可取消，旧 promise 的结果由 `renderSeq` + 原文校验丢弃。
      - `settled = null` **保留**，同时写明它是**防御性清空**：目录行只在扫描落地后才出现（`rows`
        来自 `directory.entries`），那次落地已把单槽记忆换成目录判决，所以「进入目录后回到文件串」
        的可见复位来自进入前的目录输入，不是这一行。design §3 / §6 按此措辞。
- [x] 8.2 复位翻转用例（visual 第 13 / 14 条），同一 re-stub 现场（盘上新增 `plan`、索引仍无此行）：
      - 第 13 条「关闭浮层重开」：复位后重新探测（发起 1→2）、判决翻成可打开、高亮清空、Enter 打开
        `plan`。红证据 `visual-red-reset-slot.log`：删掉 `dismiss()` 的 `settled = null` ⇒ 1 failed
        （Expected 2 / Received 1）。
      - 第 14 条「进入目录后回到同一串」：同一组断言。**只删 `enterDirectory()` 的 `settled = null`
        时它是绿的**——这是 8.1 的现场证据（可见复位来自进入前的目录输入）；它的红基线是「按 raw
        多槽缓存、跨复位复用」的实现：`visual-red-reset-cache.log` 两条都红（2 vs 1）。因此它捕获
        的是「跨导航复用」这一类错误，不是那一行赋值本身。
      - 绿：`visual-green-target-r6.log`（14/14）、`visual-structural-target-r5.log`（14/14）。
- [x] 8.3 第 11 条口径：名称 / 注释改为「Enter 与停驻计时器共用同一次探测」，明写不冻结时钟、谁先
      发起都只计 1 次，不冒充测量 120ms 边界；proposal 判据 3、design §5、本文件 3.2 / 7.3 同步
- [x] 8.4 复位场景进 spec delta：「复位后重新探测并识别新文件」⇒ living 9 → delta 14（改写 1 +
      新增 5）；proposal 判据 3 / 4、本文件 3.4 同步
- [x] 8.5 tsc 证据形式：三份日志带命令回显 + `EXIT=$?`（`tsc-root-r5.log` / `tsc-visual-r5.log` /
      `tsc-unit-r5.log`）；r2 的三份 0 字节日志作废，不再被任何指针引用
- [x] 8.6 全量复跑（5.1b）：目标 14/14、结构 14/14、既有 42/42、相邻 42/42、目标单测 48/48、
      全量前端 1998/1998、三份 tsc `EXIT=0`、docs-check PASS、validate 39/39
      （全量前端在并行负载下会命中 `link-suggest` 的 16ms 同步预算：早期 r9 实测 56.2ms、r12 同样
      红；本 tip 上 r13 / r14 连跑两次均 1998/1998 绿。该文件不在本 change 的改动面，属负载抖动）
