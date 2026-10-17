# REVIEW.md — 反复踩过的坑（开工前检查清单）

worker 动工前、reviewer 给出 verdict 前逐条过一遍。每条按「症状 / 根因 / 证据 / 防线」写，
防线是祈使句，指向下一次这类改动里可执行的一个动作。能落进 canonical 文档的规则不在这里复制
（AGENTS.md 原则），只给指针。

**收录门槛**：重复踩过 ≥2 次，或单次但代价高（静默丢失、假绿、不可逆）。无证据的条目不收。

**条目生命周期：出口判据是「吸收」不是「沉默」**（2026-10-17 起）：条目的防线搬进更近的居所
（门禁机器判定 / canonical 文档 / AGENTS.md 硬规则）后，条目直接从本表删除——主题、居所指针
与证据锚点留 git 历史（`git log -p -- REVIEW.md`），已固化条目不留在活文件里占通读预算
（stub 连号删除，2026-10-17 Alex 裁决）。**没再犯不是删除理由**——沉默通常恰是防线在起作用。
复发不是升格触发器，是「当前居所没拦住」的信号：先查防线该不该往更近的居所搬
（人读 → tower 注入 → 机器门禁）。

**编号是 legacy ID，新引用用主题锚**（2026-10-17 起）：历史上全仓以「第 N 条」引用本表
（约 880 处，多在代码注释），编号因此**不复用、不重排**；但新写的引用一律用
「REVIEW.md『<条目主题词>』条」的主题关键词锚（与 backlog 维护规则同口径），不再用编号——
编号锚已兑现过一次歧义（曾有两条「第 5 条」：重试条与本条目，AX 裁切条 2026-10-17 改号为
第 24 条）。归档文件（`openspec/changes/archive/`）里的数字引用永不回改，解析走 git 历史；
活文件的存量数字引用已于 2026-10-17 全量换锚（约 556 处 / 250+ 文件），编号不再承重。

**语料与挖掘口径**（2026-09-17，M146）：三条独立线各自挖完再归并——`.tower/comms/reviews/` 261 份
评审 verdict（130 份带 P1/P2，逐份读完）、`.tower/comms/findings/` 87 份 + `docs/backlog.md` 全文、
`git log` 的 fix/repair 提交簇 + `.tower/comms/log/activity.log` 中 >2 轮评审的 mission。`.tower/**`
不入 git（`.git/info/exclude`），所以证据优先给仓内锚点（commit / tracked 文件行），现场原卷另附
`.tower` 路径供本机复查。

## 一、假绿：断言看着有覆盖，实际不判任何东西

**1. 断言等价于子串，没有区分度**
- 症状：`/PAUSE-PROBE[\s\S]*$/m` 在探测串位于文档中部时同样 PASS；`AXTextArea[\s\S]*?\(focused\)` 在 `(focused)` 落于其后的节点（冲突 toast 的按钮）上照样匹配。
- 根因：判据没有区分度——「看着更强、其实等价于子串」。
- 证据：提交 `90ea069`；`scripts/acceptance/README.md` 的「匹配值」段（正则一律带 `m` flag 的三处边界）。
- 防线：下次写断言时，先造一个**必须让它 FAIL 的输入**（探测串放错位置、标记挪到别的节点）实测一次，确认它红了再提交；落点类断言用 `ax: { focused: … }` 解析形态，不用跨节点正则。

**2. 读不到当成空：比较在 `"" === ""` 上空转**
- 症状：modal 打开期间 AX 快照里没有 `AXTextArea`，`null ?? ""` 与逐字节基线比出「未变化」，负向断言与 `unchangedSince` 全程恒真（M135 r2 P1-1）。
- 根因：把「目标不可读」与「目标为空」混为一谈，判据因此没有输入。
- 证据：提交 `28aeade`；`scripts/acceptance/README.md`「编辑器不可读 ≠ 文档为空」条。
- 防线：下次写「未变化 / 不存在」类负向断言时，先确认读到的是真值不是缺失值——不可读一律判 FAIL；基线要在会挡住读取的动作（开 modal、切窗）之前记录。

**4. 断言写死了会滚动或跨天复用的产物路径**
- 症状：诊断日志按 UTC 日期命名而验收 `env/` 目录跨天复用，写死日期的断言此后每天读到上次 run 的旧文件——永久空过；换机又直接 FAIL。
- 根因：断言路径假设「本次运行会生成什么」，而不是「取最新那一份」。
- 证据：提交 `10b8a35`；`scripts/acceptance/README.md` 的 `record` / `file` 断言条（glob 取 mtime 最新一份的口径）。
- 防线：下次断言运行期生成的产物时，用 glob 取 mtime 最新一份，并做一次**反向验证**——放一个 mtime 更晚但不含目标内容的文件，确认断言如实 FAIL，再删掉它。

## 二、重试与校验口径

**5. 重试用「拼接后的串」或「出现次数」当成功判据**
- 症状：注入 `eedle` 只落地 `dl` 得 `ndl`，按次数口径重试拼成 `ndleedle`，`eedle` 恰现 1 次 = N+1 即放行，而输入框已坏、子串断言照样绿。M135 r2 发现 → M140 r1 独立复验 → M143 才修好。
- 根因：成功判据与被测行为耦合；子串/次数分不出「干净落地」与「残段 + 整串拼接」。
- 证据：提交 `26af222`、`d4f644b`；`scripts/acceptance/README.md` 的「历史教训（别再回到旧口径）」段。
- 防线：下次给不可靠通道（键鼠注入、外部进程、文件写）加重试时，把重试条件写死为「目标状态与重试前逐字节相同」，partial 状态一律报错不重试；改口径时把旧口径的假绿反例连同「别再回到旧口径」写进注释。

## 三、口径与制品脱节

**6. 覆盖声明超出真实验证**
- 症状：`tasks.md` 声称场景断言了「表格内收窄」而场景没做（M144 r1 P2-1）；M135 r1 把 7/8 标成「行为已验」，未覆盖的四条子行为在三个桶里全部消失；文档在跑通前写、跑通后没回改。
- 根因：覆盖分类按「场景写了」而不是「证据目录里真实 PASS」。
- 证据：提交 `e5ef190`、`6ed8a63`、`6d48d47`（都是把数字/表述改准的收口）。
- 防线：下次写「已验 / 已覆盖」时逐条给出证据指针（场景名 + PASS 计数），拿不出 PASS 证据的一律写「未验」；跑完回来核对文档数字与证据目录一致。

**7. 证据只在终端跑过，没落成文件或指针已失效**
- 症状：评审复验发现报告里声称的证据目录不存在（M143 r1 P2-1）；另一处证据实际留在 worktree 内，worktree 清理后指针失效（M138 r1 P2-2）。
- 根因：自报证据不落盘，或落在会被清理的位置——合并评审无从复核。
- 证据：`scripts/acceptance/README.md` 的「证据布局」节与「重试次数写进证据」口径；AGENTS.md 硬规则「批次收尾顺带 `git push origin master`」（同族：落地动作无人校验）。
- 防线：下次声称「跑过了」之前，用绝对路径 `ls` 一遍自己写下的证据路径再写进报告；证据落在 `test-results/`（本地留存、git 外）而不是 worktree 内；写不出可 `ls` 的指针就等于没跑。

**8. 同一语义两处真源，改动只落到一处**
- 症状：frontmatter 行数上限 `src/preview/wikilinks.ts:19` 是 200、`src/preview/frontmatter.ts:19` 是 512；`src/editor.ts:878` 与 `src/preview/code.ts:46` 各有一份着色语言表（后者注释自认「与 editor.ts 同批」）；扩展名集合也漂过（`e33e10b` 收敛过一次）。跨层同理（M368，2026-10-07）：harness live 的 `done` 事件成功时 summary 是固定哨兵串「成功」，前端据此判成功 / 失败，而 M367 已把 `panel_summary` 的形状落进持久化路径（成功 = 参数摘要 / 失败 = 状态·错误码）——同一条成功语义被两端各判一次，改动只落到一处即静默改判。
- 根因：没有单一来源，跨文件（或跨进程）一致性没有门禁。
- 证据：上列 file:line（本仓现值）；提交 `e33e10b`；M368 的跨层现场，finding `.tower/comms/findings/20261007-tower-improve-live-tool-done-panel-summary.md`（落点 `src-tauri/src/harness/turn.rs` 与 `src/harness-panel.ts` 的 tool 行渲染）。
- 防线：下次改「语言 / 扩展名 / 上限」这类表时先 `rg` 全仓确认是否已有同类表，只改一处就不算完成；发现存量两份时写进 `docs/backlog.md` 收口，不要就地再抄一份。跨层 / 跨进程传递的语义同理（成功与否、摘要文本这类）：只应有一处产出——事件直接携带终态字段，不要让两端各判一次，也不要把「判成功」这件事建立在另一个模块的字符串字面上。

**9. 值或开关声明了却没有消费者**
- 症状：`src/preview/table.ts:37` 的 `"incomplete"` 在类型联合里、生产从不产出、`src/` 零消费者；`editor.measure` 能在 config.json 里配、还给校验 warning，但完全不生效（假开关）。
- 根因：数据结构先于消费者落地，没有「声明即被消费」的检查。
- 证据：`src/preview/table.ts:37`；现场 `.tower/comms/findings/20260912-worker-hygiene-improve-src-tauri-editorconfig-measure-css-measure.md`。
- 防线：下次新增配置项、枚举值或字段时，同一 mission 内给出消费者或断言其功效；拿不出消费者的收进 `docs/backlog.md`，不要留在代码里冒充能力。

**22. 设定类现状断言只读了 requirement 的一句话，把已过时的旧表述当现状引用**
- 症状：worker-m445 起草方案时把「一个 vault 一个会话」当**现状**写进依据；而 M433（change `harness-sessions-per-vault`）落地后，盘上早已按 vault 分目录并存多份历史会话 JSONL、浮层可切换 / 新建 / 恢复，内存态也只是「一个 vault 一个活跃会话」（`RuntimeInner.sessions` 按 vault 键控、resume 铸新 id 替换槽位）。它引用的是 living spec 里**与新版表述并存的旧句**，且三处旧注释（`harness.rs` / `events.rs` / `permission_cache.rs` 模块头）同口径残留，读到任一处即可坐实这个错误印象。
- 根因：现状断言的取证面太窄——只读了 requirement 里的**一句话**（恰好是 M433 没同步改到的那句），没读全条、也没 grep 最新 change 核对；同时 change 改设定时只落了**新增**表述，旧句与旧注释没同步清扫，living spec 里新旧并存，给「读到旧句」留了入口。
- 证据：worker-m445 把已过时「一个 vault 一个会话」当现状引用一事（`.tower/comms/` 该 mission 的起草依据，`.tower/**` 不入 git）；`openspec/specs/harness/spec.md` 会话边界 requirement 新旧表述并存（M448 一并改准）；三处旧注释 `src-tauri/src/harness.rs:5` / `src-tauri/src/harness/events.rs:14` / `src-tauri/src/harness/permission_cache.rs:47`；设定变更的事实源是 M433（change `harness-sessions-per-vault`）。
- 防线：断言「现状是什么」时 MUST 读**整条** requirement（不是其中一句）并 `rg` 最新相关 change 核对设定是否已改；change 改了设定后，MUST `rg` 旧表述（含注释）一并清扫，不留新旧并存——living spec 里一句过时的旧话就是下一次误引用的入口。

## 四、真机与并行环境

**16. 标题栏内元素上的 `mousedown` preventDefault 会静默打断窗口拖拽（真机场景 39 判红，成因未定位）**
- 症状：标题栏（`.titlebar` 带 `data-tauri-drag-region="deep"`）内任何元素挂了 `mousedown` + `preventDefault()`（「别抢焦点」是很自然的写法）之后，**真机**场景 39 的「标识块上按下拖拽窗口成立」稳定判红——`window_bounds` Δ=(0,0)，窗口纹丝不动，**无任何报错**，而拖拽落点根本不经过那个元素。chromium 层与 CI 都看不见（视觉门禁照绿），最容易被当成本机环境问题放过。单次现场，但形态是「静默失效 + 判据只存在于本地真机门禁」⇒ 按收录门槛的「单次但代价高」收。
- 根因：**未定位**。坐实的差异因子只有那一条监听（M238 的六行二分表）；机制候选照录 finding、均未坐实：tauri 2.11.5 的 `src/window/scripts/drag.js` 只在 document 的 mousedown 上按 `isDragRegion(composedPath)` 判定，**不检查 `defaultPrevented`**，按源码推不出因果；可能与 WKWebView 在「页面上存在阻止默认行为的 mousedown 监听」时的窗口激活 / 事件投递路径有关。
- 证据：M238（2026-09-26）二分表——修复版全量（容器级 click + 容器级 mousedown）FAIL ×3、只回退 `src/tabs.ts` PASS ×1、回退 + 补容器级 click PASS ×2、再补回容器级 mousedown FAIL ×1；现场 `test-results/acceptance/2026-09-26/39-titlebar-identity/`；原卷 `.tower/comms/findings/20260926-worker-fix-pack-improve-39-mousedown-preventdefault.md`。M238 的处置即此：容器级 mousedown 未采用（容器级 click 已满足需求），原监听留在按钮上，并在 `src/tabs.ts` 就地留注释。
- 防线：动过标题栏内元素的事件监听后，本地跑一次 `node scripts/acceptance/run.mjs 39`（这条判据只在真机层）；「阻止默认行为」不要挂在容器级元素上——需要它时挂在具体按钮上，并就地留一条指向本条的注释。

## 五、多实例与调度（tower 侧）

**15. 同一 mission 被重复 spawn，两个 live loop 共写同一 worktree**
- 症状：M165–M168 四个 mission 在 spawn 时各被注册两次（两组 spawn 相隔约 94 秒，名字加 `-2` 后缀、**agent id 相同**）；M168 两个 loop 都活着，并行往同一 worktree 写同一批文件，分支上短暂出现两套互斥契约（⌃A cell 级 vs 行级）。通信层按 agent id 解析发送者名字，两个 loop 的消息都标成同一个 roster 名——重复工作对 tower 不可见；同名 roster 再注册还会把既有 reviewer 绑定挤到别的 target（agent-122 已完成的 M165 clean 评审因此无法落章）。
- 根因：未锁定。候选假说两个：① 另一会话/进程里的**孪生 tower 回路**——看得到同样的 inbox、复制 spawn（`-2` 后缀）、也自己评审与 merge；② 本机 CLI 会话的重启/窗口重放把同一批 tower 动作执行了两次（早先 `ps` 证据：本机只有一代 CLI 进程，倾向②但无法坐实）。**校正（批次收尾核对 activity.log 后）**：本条原稿称「M168 的 merge `44cd3a0` 非本 tower 会话执行」——不成立，本批四次 merge（`bda4fe4`/`44cd3a0`/`ef8f596`/`fe46310`）在 log 里全部记为 `tower merge`，即本会话执行；`01:04:43` 的 `merge.blocked` 是 M167 在 M166 合并后 tip-moved 的常规门禁拦截，不是外部发起的 merge 尝试。双写症状（同 agent id 双注册、同名 roster 挤绑）仍成立，根因照旧未锁定。
- 证据：`.tower/comms/log/activity.log`（`23:34:38` vs `23:36:12` 两组同 agent id 的 spawn）；findings `.tower/comms/findings/20260918-worker-interaction-fixes-2-improve-towerspawn-mission-agent-id-live-loop-worktree.md` 与 `20260918-worker-codeblock-lang-proposal-bug-agent-wt-167.md`；被拦评审 `.tower/comms/inbox/20260918-reviewer-interaction-fixes-b-tower-review-result-blocked-m165-tip-b9ce80c-clean-merge-roster-re.md`。
- 防线：spawn/resume 后约 2 分钟核 activity.log 尾部有无非本 tower 发起的 spawn/merge 行；发现 `-2` 同名注册立即收束到单一写者；resume 前确认旧实例已终态（`tower died` 行）。worker 侧：尽早 commit 让 tip 可评审；探针/临时目录带 mission 后缀（`/tmp/lumir-probe-<mission>`）；动工前 `ls -lT` 核对目标文件 mtime 是否晚于自己上次写入，发现被并发写入即停手上报，不靠覆盖取胜。

## 维护

- 重复踩到表内某条：把新现场（commit / 证据路径）补进该条的「证据」，不要另起重复条目。命中已固化（已删除）条目的复发按批次收尾 checklist 的「复发对账」处理（`docs/process/openspec-workflow.md`）。
- 新坑：过门槛才收；能固化的部分**当场**落进 canonical 居所（门禁脚本、README、backlog、AGENTS.md），本表只留「开工前检查」这一层——固化完成即删除该条目（全文与居所映射走 git 历史），不等再犯。
- 编号永久不复用、不重排；引用写法（主题关键词锚）见文件头「编号是 legacy ID」段。
