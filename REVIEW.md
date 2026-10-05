# REVIEW.md — 反复踩过的坑（开工前检查清单）

worker 动工前、reviewer 给出 verdict 前逐条过一遍。每条按「症状 / 根因 / 证据 / 防线」写，
防线是祈使句，指向下一次这类改动里可执行的一个动作。能落进 canonical 文档的规则不在这里复制
（AGENTS.md 原则），只给指针。

**收录门槛**：重复踩过 ≥2 次，或单次但代价高（静默丢失、假绿、不可逆）。无证据的条目不收。

**语料与挖掘口径**（2026-09-17，M146）：三条独立线各自挖完再归并——`.tower/comms/reviews/` 261 份
评审 verdict（130 份带 P1/P2，逐份读完）、`.tower/comms/findings/` 87 份 + `docs/backlog.md` 全文、
`git log` 的 fix/repair 提交簇 + `.tower/comms/log/activity.log` 中 >2 轮评审的 mission。`.tower/**`
不入 git（`.git/info/exclude`），所以证据优先给仓内锚点（commit / tracked 文件行），现场原卷另附
`.tower` 路径供本机复查。

## 一、假绿：断言看着有覆盖，实际不判任何东西

**1. 断言等价于子串，没有区分度**
- 症状：`/PAUSE-PROBE[\s\S]*$/m` 在探测串位于文档中部时同样 PASS；`AXTextArea[\s\S]*?\(focused\)` 在 `(focused)` 落于其后的节点（冲突 toast 的按钮）上照样匹配。
- 根因：判据没有区分度——「看着更强、其实等价于子串」。
- 证据：提交 `90ea069`；`scripts/acceptance/README.md:120-121`。
- 防线：下次写断言时，先造一个**必须让它 FAIL 的输入**（探测串放错位置、标记挪到别的节点）实测一次，确认它红了再提交；落点类断言用 `ax: { focused: … }` 解析形态，不用跨节点正则。

**2. 「读不到」被当成「为空」，比较在 `"" === ""` 上空转**
- 症状：modal 打开期间 AX 快照里没有 `AXTextArea`，`null ?? ""` 与逐字节基线比出「未变化」，负向断言与 `unchangedSince` 全程恒真（M135 r2 P1-1）。
- 根因：把「目标不可读」与「目标为空」混为一谈，判据因此没有输入。
- 证据：提交 `28aeade`；`scripts/acceptance/README.md:201-203`。
- 防线：下次写「未变化 / 不存在」类负向断言时，先确认读到的是真值不是缺失值——不可读一律判 FAIL；基线要在会挡住读取的动作（开 modal、切窗）之前记录。

**3. 容差宽到能吞掉一次真实变化**
- 症状：「删左栏 UI」级改动（`c9a3c20` 删 Thread UI）让两张整页基线静默通过，直到另一次超容差失配（`736b3f7`）才暴露；0.005 在 1200×800 下是 4800 像素。
- 根因：容差按「机器间抖动上限」设，没核「最小真实变化」的下限。
- 证据：`tests/visual/playwright.config.ts:9-14`（现行 0.001 及其来历）；提交 `c9a3c20` / `736b3f7` / `d439184`；`docs/backlog.md:257`。
  0.001 时代的两处新现场（2026-09-17）：M148 的 masthead 指示段约 100px 真实变化被吞（0.001×1200×800≈960px，15 张整页基线 sha256 逐字节零变化、普通模式照绿，最终靠新增元素级基线补偿，`openspec/changes/add-toc-outline/tasks.md` 基线对比说明节）；mermaid 两张整页基线停留在 `736b3f7`，M138（`ca81b7c`）起正文 js 着色产生 952px 差异（<960）被吞、期间门禁一直绿，M149 因标签栏位移重生成基线才把它带出来（reviewer-tabs 逐像素定位，`openspec/changes/add-multi-tabs/tasks.md` §8.4；finding `.tower/comms/findings/20260917-reviewer-tabs-improve-review-md-3-mermaid-952px-960px-m149.md`）。
  第三处现场（2026-10-04，M322，新形态）：分栏态空 pane 引导水印是**新增** UI 元素、整体 835px 落在 960 预算内（reviewer 自实现 pixelmatch threshold=0.2 独立复算坐实）——前两例是既有元素的变化被吞，这例是新增元素整体被吞，拿旧基线对比照绿；守卫完全在结构断言（toBeVisible / toHaveText / toBeHidden），基线仍落账锚定 intended 画面（review `.tower/comms/reviews/review-feat-empty-pane-guide-element-m322-reviewer-empty-pane-guide-m322-r1.md`）。
- 防线：下次动容差、或加会删/移 UI 的场景时，本地先把该元素删掉跑一次，确认门禁确实 FAIL；删 UI 后逐一核对该元素出现过的所有整页基线时间戳是否随本次更新；新增低于容差预算的 UI 元素时，「在场」守卫必须落在结构断言（存在性 / 文案 / 可见性），不能指望整页像素。

**4. 断言写死了会滚动或跨天复用的产物路径**
- 症状：诊断日志按 UTC 日期命名而验收 `env/` 目录跨天复用，写死日期的断言此后每天读到上次 run 的旧文件——永久空过；换机又直接 FAIL。
- 根因：断言路径假设「本次运行会生成什么」，而不是「取最新那一份」。
- 证据：提交 `10b8a35`；`scripts/acceptance/README.md:114`；`docs/backlog.md:204-208`。
- 防线：下次断言运行期生成的产物时，用 glob 取 mtime 最新一份，并做一次**反向验证**——放一个 mtime 更晚但不含目标内容的文件，确认断言如实 FAIL，再删掉它。

## 二、重试与校验口径

**5. 重试用「拼接后的串」或「出现次数」当成功判据**
- 症状：注入 `eedle` 只落地 `dl` 得 `ndl`，按次数口径重试拼成 `ndleedle`，`eedle` 恰现 1 次 = N+1 即放行，而输入框已坏、子串断言照样绿。M135 r2 发现 → M140 r1 独立复验 → M143 才修好。
- 根因：成功判据与被测行为耦合；子串/次数分不出「干净落地」与「残段 + 整串拼接」。
- 证据：提交 `26af222`、`d4f644b`；`scripts/acceptance/README.md:190-196`（「历史教训（别再回到旧口径）」）；`docs/backlog.md:199-204`。
- 防线：下次给不可靠通道（键鼠注入、外部进程、文件写）加重试时，把重试条件写死为「目标状态与重试前逐字节相同」，partial 状态一律报错不重试；改口径时把旧口径的假绿反例连同「别再回到旧口径」写进注释。

## 三、口径与制品脱节

**6. 覆盖声明超出真实验证**
- 症状：`tasks.md` 声称场景断言了「表格内收窄」而场景没做（M144 r1 P2-1）；M135 r1 把 7/8 标成「行为已验」，未覆盖的四条子行为在三个桶里全部消失；文档在跑通前写、跑通后没回改。
- 根因：覆盖分类按「场景写了」而不是「证据目录里真实 PASS」。
- 证据：`docs/backlog.md:155`；提交 `e5ef190`、`6ed8a63`、`6d48d47`（都是把数字/表述改准的收口）。
- 防线：下次写「已验 / 已覆盖」时逐条给出证据指针（场景名 + PASS 计数），拿不出 PASS 证据的一律写「未验」；跑完回来核对文档数字与证据目录一致。

**7. 证据只在终端跑过，没落成文件或指针已失效**
- 症状：评审复验发现报告里声称的证据目录不存在（M143 r1 P2-1）；另一处证据实际留在 worktree 内，worktree 清理后指针失效（M138 r1 P2-2）。
- 根因：自报证据不落盘，或落在会被清理的位置——合并评审无从复核。
- 证据：`scripts/acceptance/README.md:123`（证据布局）与 `:196`（「重试次数写进证据」）；`docs/backlog.md:248`（`_type-retry-unit/` 8 判定落盘的终态）；AGENTS.md 硬规则「批次收尾顺带 `git push origin master`」（同族：落地动作无人校验）。
- 防线：下次声称「跑过了」之前，用绝对路径 `ls` 一遍自己写下的证据路径再写进报告；证据落在 `test-results/`（本地留存、git 外）而不是 worktree 内；写不出可 `ls` 的指针就等于没跑。

**8. 同一语义两处真源，改动只落到一处**
- 症状：frontmatter 行数上限 `src/preview/wikilinks.ts:19` 是 200、`src/preview/frontmatter.ts:19` 是 512；`src/editor.ts:878` 与 `src/preview/code.ts:46` 各有一份着色语言表（后者注释自认「与 editor.ts 同批」）；扩展名集合也漂过（`e33e10b` 收敛过一次）。
- 根因：没有单一来源，跨文件一致性没有门禁。
- 证据：上列 file:line（本仓现值）；`docs/backlog.md:42-43`；提交 `e33e10b`。
- 防线：下次改「语言 / 扩展名 / 上限」这类表时先 `rg` 全仓确认是否已有同类表，只改一处就不算完成；发现存量两份时写进 `docs/backlog.md` 收口，不要就地再抄一份。

**9. 值或开关声明了却没有消费者**
- 症状：`src/preview/table.ts:37` 的 `"incomplete"` 在类型联合里、生产从不产出、`src/` 零消费者；`editor.measure` 能在 config.json 里配、还给校验 warning，但完全不生效（假开关）。
- 根因：数据结构先于消费者落地，没有「声明即被消费」的检查。
- 证据：`docs/backlog.md:42-43`；`src/preview/table.ts:37`；现场 `.tower/comms/findings/20260912-worker-hygiene-improve-src-tauri-editorconfig-measure-css-measure.md`。
- 防线：下次新增配置项、枚举值或字段时，同一 mission 内给出消费者或断言其功效；拿不出消费者的收进 `docs/backlog.md`，不要留在代码里冒充能力。

## 四、真机与并行环境

**10. `cargo test` 换掉二进制 flavour，整窗白屏被误判成产品缺陷**
- 症状：`cargo test` 会把 `target/debug/lumir` 重编译为不带 `custom-protocol` 的 dev flavour，此后裸跑该二进制去加载 devUrl 而整窗全白、无任何报错（M134 实测两次）。
- 根因：门禁步骤与真机启动共用同一个二进制路径，flavour 被悄悄改写。
- 证据：AGENTS.md 硬规则「白屏陷阱」；提交 `791ff0c`（真机白屏与 watch 断流——custom-protocol feature + event ACL）。
- 防线：下次用裸二进制起实例前先 `cargo build --features custom-protocol`（或直接用 `pnpm tauri dev`）；见到整窗白屏且无报错，先怀疑 flavour 再怀疑产品代码。

**11. 真机键盘注入整批丢键，同机第二个实例显著加剧**
- 症状：注入 `needle` 只落地 `ndl`、`a..z` 只落地 `abcdghijkl`，app 侧 keydown 探针证明被丢的键从未到达 DOM；M138 / M139 / M140 三方各自实证，第二实例常驻时复现率明显变高。
- 根因：KimiCU 逐键 CGEvent 链路对 WKWebView 间歇丢键（成因未定位），而工具自报 `ok` 无法自证落地。
- 证据：`docs/backlog.md:136-140`；`scripts/acceptance/README.md:177-199`。
- 防线：跑真机场景前确认 1420 与 1430 都没有 Lumir 实例；断言走「回读 + 只在字节未变才重试」，不用重试次数当判据；失败先按丢键复跑一次再判产品缺陷（同一场景曾 M138 FAIL、M142 PASS）。

**12. 磁盘水位与并行 worktree 的 target 预算**
- 症状：磁盘 <1G 时 ENOSPC 硬阻塞真机批次（219MiB 时 `pnpm tauri dev` 因 vite 写临时文件失败而中止）；建到一半 ENOSPC 会留下半截 target 且不回血，比不构建更糟。
- 根因：每个 worktree 各带 1.5–3G 的 debug target，磁盘是单例资源，预检是事后长出来的。
- 证据：`docs/backlog.md:111-120`；`scripts/acceptance/README.md:35`。
- 防线：起真机实例前 `df -h` 看水位，worktree 首次构建按 ≥3G 估；空间不够就只跑 chromium 视觉门禁，并在报告里如实声明覆盖范围，不写「全量验收」。

**13. 测试或套件污染真实环境、场景间串场**
- 症状：一个中间版本让单元测试把 13 行事件写进真实 `~/.config/lumir/logs/`（M134）；验收套件不清 `recovery/` 时 08c 恢复出了上一场景的 vault 内容；视觉门禁默认 4173 被别的 worktree 的 `vite preview` 占着，`reuseExistingServer` 复用别人的 dist，对比对象不是本次构建。
- 根因：并行 worktree + 真实主机，隔离没写进预检，靠事后逐条补。
- 证据：提交 `58b54bd`；`scripts/acceptance/README.md:51-53`；`tests/visual/README.md:53-55`；`tests/visual/playwright.config.ts:3-4`；「vite preview 服务 dist」操作坑的实测 finding `.tower/comms/findings/20260917-reviewer-tabs-improve-review-md-3-mermaid-952px-960px-m149.md`。
- 防线：下次写会碰全局状态的功能时，先确认落点在 `XDG_CONFIG_HOME` / 临时目录而不是 `~/.config`；跑视觉门禁前设 `LUMIR_VISUAL_PORT` 并确认无人占用；结论异常时先查 dist 是不是本次构建的；手动单跑 playwright 场景前先 `pnpm build`——webServer 是 `vite preview`，服务的是 dist 构建产物而不是 src 编译结果，改了 `src/` 不重建则改动不生效、反向验证会假绿（`gate.sh visual` 自带 build，只有手动迭代才踩）。

**16. 标题栏内元素上的 `mousedown` preventDefault 会静默打断窗口拖拽（真机场景 39 判红，成因未定位）**
- 症状：标题栏（`.titlebar` 带 `data-tauri-drag-region="deep"`）内任何元素挂了 `mousedown` + `preventDefault()`（「别抢焦点」是很自然的写法）之后，**真机**场景 39 的「标识块上按下拖拽窗口成立」稳定判红——`window_bounds` Δ=(0,0)，窗口纹丝不动，**无任何报错**，而拖拽落点根本不经过那个元素。chromium 层与 CI 都看不见（视觉门禁照绿），最容易被当成本机环境问题放过。单次现场，但形态是「静默失效 + 判据只存在于本地真机门禁」⇒ 按收录门槛的「单次但代价高」收。
- 根因：**未定位**。坐实的差异因子只有那一条监听（M238 的六行二分表）；机制候选照录 finding、均未坐实：tauri 2.11.5 的 `src/window/scripts/drag.js` 只在 document 的 mousedown 上按 `isDragRegion(composedPath)` 判定，**不检查 `defaultPrevented`**，按源码推不出因果；可能与 WKWebView 在「页面上存在阻止默认行为的 mousedown 监听」时的窗口激活 / 事件投递路径有关。
- 证据：M238（2026-09-26）二分表——修复版全量（容器级 click + 容器级 mousedown）FAIL ×3、只回退 `src/tabs.ts` PASS ×1、回退 + 补容器级 click PASS ×2、再补回容器级 mousedown FAIL ×1；现场 `test-results/acceptance/2026-09-26/39-titlebar-identity/`；原卷 `.tower/comms/findings/20260926-worker-fix-pack-improve-39-mousedown-preventdefault.md`。M238 的处置即此：容器级 mousedown 未采用（容器级 click 已满足需求），原监听留在按钮上，并在 `src/tabs.ts` 就地留注释。
- 防线：动过标题栏内元素的事件监听后，本地跑一次 `node scripts/acceptance/run.mjs 39`（这条判据只在真机层）；「阻止默认行为」不要挂在容器级元素上——需要它时挂在具体按钮上，并就地留一条指向本条的注释。

## 五、等待方式（agent 运行时）

**14. 用分钟级 sleep 盲等后台任务或等回话**
- 症状：worker-toc 在 M148 用 16 次 120–290s 的 `sleep` 撑 turn（累计约 61 分钟），直接耗尽 2 小时任务预算被超时重启；盲等醒来后读到的是「睡到那一刻」的半截现场，是假绿/假红的温床（与第 1/2 条同族）。
- 根因：误以为「结束 turn 会终止 run、看不到后台任务结果」；实际上后台任务完成通知与 tower 的 resume 都会唤醒 agent。每次 sleep 还烧一次 tool-call 往返的 context（该 worker 的 inputCacheRead 从 287k 涨到 418k）。
- 证据：finding `.tower/comms/findings/20260917-tower-improve-worker-sleep-tower-waitfor-turn.md`（现场：agent-57 会话日志 turnId 0 step 122–252）；对照组 worker-jsonhl 全程「结束 turn + 被 resume」、零消息丢失、近零 sleep。
- 复发（2026-09-18）：M164 worker-multivault-closeout（agent-108，deepseek-flash）用 `sleep 180/230/240; tail log` 前台盲等视觉门禁，4 次约 15 分钟（Alex 截图实证；现场 session_43197879/agents/agent-108），tower 中止后带纠正重启。教训：「开工前必读」对 Flash worker 不自觉生效。
- 防线：等自己的后台任务一律用 `WaitFor`（挂起零 LLM 请求、完成即唤醒，timeout ≤600s 可续等）；等 tower 或他人回话就结束 turn，回复经 resume 送达；只有无事件源的外部状态（锁文件、磁盘水位）才允许 ≤60s 的短采样，且采样须带诊断负载（如采样锁/磁盘状态做裁决复核），不是干睡。**tower 侧执行（2026-09-18 起）：每次 spawn/resume worker 的 instructions 显式写「>60s 的命令一律 run_in_background + WaitFor/结束 turn，禁止前台分钟级 sleep 轮询」，不再只靠本表自觉。**

## 六、多实例与调度（tower 侧）

**15. 同一 mission 被重复 spawn，两个 live loop 共写同一 worktree**
- 症状：M165–M168 四个 mission 在 spawn 时各被注册两次（两组 spawn 相隔约 94 秒，名字加 `-2` 后缀、**agent id 相同**）；M168 两个 loop 都活着，并行往同一 worktree 写同一批文件，分支上短暂出现两套互斥契约（⌃A cell 级 vs 行级）。通信层按 agent id 解析发送者名字，两个 loop 的消息都标成同一个 roster 名——重复工作对 tower 不可见；同名 roster 再注册还会把既有 reviewer 绑定挤到别的 target（agent-122 已完成的 M165 clean 评审因此无法落章）。
- 根因：未锁定。候选假说两个：① 另一会话/进程里的**孪生 tower 回路**——看得到同样的 inbox、复制 spawn（`-2` 后缀）、也自己评审与 merge；② 本机 CLI 会话的重启/窗口重放把同一批 tower 动作执行了两次（早先 `ps` 证据：本机只有一代 CLI 进程，倾向②但无法坐实）。**校正（批次收尾核对 activity.log 后）**：本条原稿称「M168 的 merge `44cd3a0` 非本 tower 会话执行」——不成立，本批四次 merge（`bda4fe4`/`44cd3a0`/`ef8f596`/`fe46310`）在 log 里全部记为 `tower merge`，即本会话执行；`01:04:43` 的 `merge.blocked` 是 M167 在 M166 合并后 tip-moved 的常规门禁拦截，不是外部发起的 merge 尝试。双写症状（同 agent id 双注册、同名 roster 挤绑）仍成立，根因照旧未锁定。
- 证据：`.tower/comms/log/activity.log`（`23:34:38` vs `23:36:12` 两组同 agent id 的 spawn）；findings `.tower/comms/findings/20260918-worker-interaction-fixes-2-improve-towerspawn-mission-agent-id-live-loop-worktree.md` 与 `20260918-worker-codeblock-lang-proposal-bug-agent-wt-167.md`；被拦评审 `.tower/comms/inbox/20260918-reviewer-interaction-fixes-b-tower-review-result-blocked-m165-tip-b9ce80c-clean-merge-roster-re.md`。
- 防线：spawn/resume 后约 2 分钟核 activity.log 尾部有无非本 tower 发起的 spawn/merge 行；发现 `-2` 同名注册立即收束到单一写者；resume 前确认旧实例已终态（`tower died` 行）。worker 侧：尽早 commit 让 tip 可评审；探针/临时目录带 mission 后缀（`/tmp/lumir-probe-<mission>`）；动工前 `ls -lT` 核对目标文件 mtime 是否晚于自己上次写入，发现被并发写入即停手上报，不靠覆盖取胜。

## 七、仓库信息卫生

**17. 真实 vault 内容混进入库制品（人名 / 项目名 / 文件名 / 正文）**
- 症状：Phase 2 原型第一版的 HTML 与 30 张截图直接搬了真实 vault——真实同事姓名（多处，含对话 fixture 与文档正文）、真实项目目录名、真实文档文件名与正文，Alex 过目时当场认出（2026-10-05）。前科：M117 已清过一轮「视觉场景注释与 preview 注释里的真实 vault 文件名」（提交 `6018215` / `b237e45`）——清了注释，没拦住原型与截图这两个更大的面。
- 根因：fixture 图省事直接抄真实 vault；截图类二进制把内容烧进像素，text 级清扫看不见，只能靠重截清除；纪律文本若引用真实字符串当反面例子，本身就再次违规。
- 证据：M333（2026-10-05，phase2 原型全量合成化 + 30 张重截 + 仓内其余命中清单报 tower）；M117 两次清理提交；Alex 裁决原文见 M333 mission context（检索针不落 git）。
- 防线：写 fixture 一律合成（人名 / 项目名 / 文件名 / 正文，宁可平淡不可求真）；提交原型 / 截图 / fixture 前对改动面跑一次 text 级 grep（针从当次需求取，不入库）；动过原型 HTML 后必须重截对应截图——HTML 清了而截图没重截等于没清；反面示例用「真实同事姓名」这类描述指代，MUST NOT 抄录原字符串。

**18. 原型要求人手改 URL 切换状态，评审成本转嫁给出裁决的人**
- 症状：Phase 2 原型第一版只能手改 `?screen=` / `?theme=` query 切屏切主题，Alex 过目时提出「不方便，应该提供控制面板」（2026-10-05）——裁决者要在地址栏敲十次以上的状态切换，评审节奏被打断。单次、代价不高，但 Alex 直接定为纪律，前置收录防下一轮原型重犯。
- 根因：原型作者把「自己知道 query 格式」当成了「读者可操作的界面」。
- 证据：M333（控制面板落地：页面右下角 pill 展开画面网格 + 主题行，query 保留作深链，截图脚本 `&panel=0` 关面板）；Alex 裁决原文见 M333 mission context。
- 防线：交互原型动工时把「页面内置可点击控制面板（全部状态选项点击可达）」列为验收项，与画面本身同 PR 交付；query 参数只作深链与脚本入口，不作为读者的主要切换方式。

## 维护

- 重复踩到表内某条：把新现场（commit / 证据路径）补进该条的「证据」，不要另起重复条目。
- 新坑：过门槛才收；能固化的部分落进 canonical 文档（门禁脚本、README、backlog），本表只留「开工前检查」这一层。
