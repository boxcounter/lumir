# Backlog — findings 与待裁决队列

唯一的积压载体（2026-09-16 起自 HANDOFF.md 迁入并入 git）。

维护规则：

- 新 findings 由发现者（worker / reviewer / tower）落成条目，注明**来源 mission/批次**与**日期**；HANDOFF.md 只记 session 状态，不再积压。
- 条目状态：`待裁决` / `待修` / `待验收` / `记录在案`；核销后移入「已核销」区并定期清理。
- 每条尽量附复现/证据指针；裁决类条目给出选项与推荐。
- **核销即移出正文**（2026-10-12 Alex 裁决：backlog 里的存量信息持续消耗阅读成本）：条目一经核销 / 裁决落地，在**当次批次收尾**即移出原所在区，只留一行索引（日期 + 主题 + 去向）——禁止以全文形态滞留；带未闭合尾巴的压缩成短条目放「承接残项」。
- **批次报告与总表不留正文**：mission 批次报告、全量回归总表一律只留指针（git 历史 / `test-results/` / `.tower/`），不把报告正文写进本文件。
- **体量红线 3000 行**：全文超 3000 行即触发一次结构清理，批次收尾时检查一次（`wc -l docs/backlog.md`）；这一条已同步进 `docs/process/openspec-workflow.md` 的批次收尾 checklist。

## 待 Alex 裁决

**编号对照（2026-10-12 M467 结构性清理时重编号一次）**：旧号 → 新号 = 1→1、2→2、4→3、5→4、7→5、8→6、9→7、11→8、13→9、14→10、15→11、16→12、18→13、21→14、41→15、42→16、43→17、44→18。本节原有的 32 / 33 各重复一次（已消除）；移出本节的僵尸条目（3、6、10、12、17、19、20、22–40）在「已核销」区按 `（原第 N 条）` 保留一行索引，带未闭合尾巴的见「承接残项」。仓内其它文件按旧号引用的几处（`docs/specs/perf-measurement.md` 的「第 7 条」、`docs/specs/config-reference.md` 的「#36① / #36② / #37」、`scripts/gate.sh` 的「#34」、`tests/unit/tree-increment.test.ts` 的「backlog 32」、`tests/visual/scenes/end-marker.spec.ts` 的「backlog #31」）在本 mission scope 之外，已投 finding 追改。

1. **历史敏感信息是否 filter-repo**：M111/M115 历史提交中的真实文件名；`docs/design-parity-contract/evidence/*.log` 约 20 行本机路径。tower 建议不必（仓库 M3 前不公开）。遗留自批次一。

2. **demo 右侧探针栏去留**：版面/文案决策，建议随 theme 重做一并处理。遗留自批次二。

3. **宽表横向溢出裁切是否预期**：实测溢出 1549pt vs 栏宽 766pt，AX 层完整。待 Alex 对照设计规格确认。遗留自桌面复验（M116 期）。

4. **Emacs 档 3 与全产品键位**：isearch / mark / region / ⌃X 前缀，及左栏 tree/shell 零键盘支持——待 UX 重做会话与 dogfood 反馈后立项。批次三遗留。

5. **内存合同存量超标**：2026-09-06 evidence 218–222MB 已超 <200MB 合同（2026-09-16 未复测）——放宽合同还是专项治理，随 dogfood 性能专项拍板。

6. **共享 `CARGO_TARGET_DIR` 与 dev-only 脚本化驱动入口**（工具链节 2/3 的长期候选）：是否立项待裁决。

7. **链接形态矩阵的两处 tower 裁决**（M145，2026-09-17，Alex 未逐条点头）：① 相对路径**非 md**（`[x](./doc.pdf)`）带 `↗︎`（语义「会离开本应用」）而不是 `→`；② **纯锚点** `[x](#sec)` 带 `→` 但激活只给「暂不支持锚点跳转」toast（不做文档内滚动）。附一处同批未单独确认的口径：`[x](note.md#sec)` 按「应用内跳转 + 锚点部分忽略」处理。三处若要翻转，落点是 `src/preview/links.ts` 的 `classifyLinkTarget`（标记）与 `src/main.ts` 的 `followLink`（激活）。

8. **跨语言 frontmatter 上限 Rust 200 vs TS 512（201–512 行分歧）**（**待裁决**；M152 finding，worker-langunify，
    2026-09-17，low）：M152 把 TS 侧上限收敛为单一常量 `src/preview/frontmatter.ts:19` 的 512（装饰层 /
    wikilink 排除区 / toc 同源），Rust 的 `src-tauri/src/link_graph.rs:106` 仍是 200，且 `:105` 的注释
    「与 src/preview/wikilinks.ts 同口径」在该文件不再持有这个常量后已成**错误自述**。后果：201–512 行的
    首部区块被 TS 当 frontmatter、被 Rust 当正文（`parse_links` 认出其中的 `[[...]]`、`extract_headings`
    认其中的 `#` 行），toc 与 Rust 标题树对同一段判定不同。此分歧在 M152 之前就存在（Rust 一直是 200），
    M152 只消掉了 TS 侧内部的两处漂移，未扩大也未缩小它，用户可感知面有限（反链能力已移除）。
    **tower 处置建议**：立项把 Rust 侧对齐 512，或由 Alex 裁「有意分歧」并把口径写进 spec。finding 给两条
    做法——(a) 直接改 Rust 常量 + 加一条 Rust 单测读 `src/preview/frontmatter.ts` 抓值断言两边一致（跨语言
    最省事的机械防线）；(b) 常量经 ts-rs bindings 单向下发。finding
    `20260917-worker-langunify-improve-frontmatter-rust-200-vs-ts-512-m152-201-512.md`。

9. **`save_markdown` 的 CAS 窗口实测 4–94ms，窗口内的外部改写会被 rename 静默覆盖**（**待裁决（先裁方案
    再立项）**；M154 survey，worker-rustasync，2026-09-17，medium，vuln）：CAS 检查
    （`src-tauri/src/fs_io.rs:347-353`）与 `rename`（`:408`）之间要做「建 tmp + 写全量内容 + fsync」，
    实测窗口 ≈3KB 4.0ms（max 4.8）/ 1MB 4.0ms（max 22.1）/ 50MB 58.0ms（max 94.1），慢盘与同步盘更宽。
    窗口内目标被外部进程改写（同步客户端、git checkout、另一个编辑器或第二个窗口），rename 会覆盖那份
    **更新**的版本——正是 CAS 想防的那次丢失。对照 `link_graph.rs:919-922` 的 `openat + O_EXCL` 是内核
    一步、天然无窗口，但 save 是「替换」语义，不能照抄。**需 Alex 先裁方案**：(a) **收窄（廉价、不关闭）**
    ——rename 前重新取 `(dev, ino, mtime, size)` 与 CAS 时快照比对，不符则报 `document_conflict`，窗口缩到
    微秒级但仍有理论间隙；(b) **关闭（需设计裁决）**——macOS `renameatx_np(RENAME_SWAP)` 原子交换 + 读交换
    出的旧内容算 hash 与 `expected_revision` 比对，不符则 swap 回来并报冲突，无未保护窗口；回滚语义
    （swap 回失败怎么办）要单独设计，属独立 mission。本仓已有直调 syscall 先例（`link_graph.rs:807-841`）。
    tower 处置建议：不要在窗口语义未定前直接从 backlog 拉实现。finding
    `20260917-worker-rustasync-vuln-save-markdown-cas-4ms-94ms-rename.md`。

10. **前端单测层（`tests/unit`，26 用例）只在本地 gate，未进任何 CI workflow**（**待裁决**；
    reviewer-testinfra finding，2026-09-17，low，无归属 mission）：M153 落地的单测层只接进
    `scripts/gate.sh quick`；`.github/workflows/rust.yml` 的路径过滤仅 `src-tauri/**` 与 `src/bindings/**`
    （不含 `src/**`），`visual.yml` 触发 `src/**` 但步骤里没有 `pnpm test`。于是 `keys.ts` 的 chord 解析、
    `save-controller` 状态机这类纯逻辑若回归，CI 全绿而只有本地红——而 `rust.yml` 文件头自称「AI-only
    模式下 CI 是唯一防线（ADR 0004）」。**tower 处置建议**：待 Alex 裁决「CI 是否也守前端纯逻辑」。
    若要做，成本极低：`visual.yml` 已有 node 22 + pnpm 环境，加一行 `run: pnpm test` 即可（单测层秒级）；
    M153 的 mission 书本身把这一层定位为「本地快速反馈层」，所以这属于**定位裁决**而非缺口补齐。finding
    `20260917-reviewer-testinfra-improve-gate-sh-quick-ci-workflow.md`。

11. **perf 端点 `open-1mb-file` 从「磁盘 IO 占位口径」修订为真实打开路径**（**待裁决（立项）**；
    worker-testinfra idea，M153，2026-09-17，medium）：该端点现在量的是「读 1MB 文件到内存 + UTF-8 解码」
    （M1 遗留占位，实测 p95 1.12ms / median 0.44ms），却被 `perf.yml` 与 `tests/perf/thresholds.json` 以
    100ms 绝对阈值 enforce——它变绿**不等于**「打开文档」体验没退化（不含读取后的解析、CodeMirror 装载与
    首帧渲染）。M153 已在脚本头、`meta.note` 与 artifact 里如实标注「占位端点 + 已 enforce + 修订义务」。
    **tower 处置建议**：立项一个「性能合同端点修订」mission——① 定端点（建议「打开请求 → 编辑器首帧
    渲染」，测量通道复用 keypress-to-paint 的 CDP 注入机制）；② 按新端点重标定 contract 与容忍线（不能
    沿用 100ms）；③ 重建滚动基线并归档旧口径结果，避免新旧数字混比；④ `docs/specs/perf-measurement.md`
    记口径变更与不可比说明。可等 dogfood 性能专项一起做。finding
    `20260917-worker-testinfra-idea-open-1mb-file-io.md`。

12. **「用户主动打开 / 切换 vault」仍走同步路径，大 vault 上会有等量级的界面无响应**（**待裁决（是否立项）**；
    change `multi-vault-workspaces` design §9 登记的后续项，M164 收口时按任务 7.2 落到这里）。M159 只把**启动恢复**
    移出了主线程（`lumir-vault-restore`），用户主动触发的打开/切换仍走 command 线程上的同步 `open_vault`：
    注册表 IO + 建 watch + `scan_workspace` + `build_graph` 全在一段里跑完才返回，实测真实 vault 约 125ms、
    4× 规模约 770ms（同一段代码，数字出自身为那次启动时序改造提供依据的冷启动实测，见「已核销」的 2026-09-18 三件核销条），期间界面不重绘。
    change 明确**不修**（非目标），且**刻意不引入进度条 / 遮罩**——同步路径下界面在此期间不重绘，这类元素不可见
    （口径见 spec「vault 切换与整窗上下文替换」最后一句）。**需 Alex 裁的是要不要立项异步化**：① 收益是切换
    「人手可感知的卡顿」消失；② 代价与 M159 同族——先后端把提交移出主线程、再处理与用户后续操作的让位规则
    （M159 已有的 `restore_pending` / 世代号是先例，可复用），前端则要重新设计过渡态（进度或乐观切换），
    这会推翻本变更「不做过渡元素」的口径，因此不属收口范畴。建议时机：与 dogfood 的性能专项一起裁
    （与那次启动时序改造同批），不要单独提前做。

13. **远程 http(s) 图片直连分支在现行 CSP 下必然失败，且错误文案误归因为「解码失败」**（M165 finding，
    worker-svg-proposal-2，2026-09-18，low，**待裁决**）：`src/preview/livePreview.ts:869-872` 把外链直接
    交给 `img.src`，而 `src-tauri/tauri.conf.json:21` 的 `img-src 'self' asset: data:` 不含 http(s)——
    该路径在打包态与 dev 态都 100% 走不通（静态核对，未真机坐实），用户看到的是 `attachments.ts:240-242`
    的「图片解码失败」误归因。选项：(a) **删直连分支**、并入 image-svg-and-fallback 的可见占位（成因中立
    文案「本应用不联网取图」）——推荐，失去的是今天本就不工作的能力，与 ADR 0001 本地优先口径一致；
    (b) 若要支持远程图片，需先裁「是否允许联网取图」，再改 CSP + Rust 侧代理下载，属独立 change 不是补丁。
    文案改「无法显示」一项已由 M165 的 spec delta 覆盖，实现期确认其同样覆盖外部 URL 分支即可。finding
    `20260918-worker-svg-proposal-2-bug-http-s-csp.md`。
    **实现期确认（M178，2026-09-18）**：外部 URL 分支（`src/preview/livePreview.ts:869-873`）与本地附件
    走**同一个** `ImageWidget` 终态处置，失败时给同一条 D113 占位并保留原始引用串——chromium 场景已断言
    （`tests/visual/scenes/markdown-combo.spec.ts`：`![remote image](https://example.invalid/remote.png)`
    的替换区文本逐字为 `图片无法显示：![remote image](https://example.invalid/remote.png)`，且不残留
    「解码失败」归因）。该路径在成品里仍 100% 走不通（CSP 不含 http(s)，静态核对、未真机坐实）；本批做的
    是**不撒谎的成因**，不是让它可用——(a)/(b) 的处置权仍在 Alex。

14. **行内（同一行还有正文）图片引用现在会独占一行**（M182，worker-img-width-fix，2026-09-18，medium，
    **待 Alex 裁决**）：M182 把图片替换区包装盒的宽度定成栏宽（`src/preview/theme.ts` 的 `.cm-lp-image`
    `width: 100%`，机制说明见 `docs/specs/image-reading.md` §3），换来「显示宽度不因加载时序 / 缓存命中 /
    打开次序而变」这条不变量（条款同文件 §2）。代价是行内图片引用会把所在行切开：引用前的正文 / 图片 /
    引用后的正文各自成行。**实测输入分布**（真实 vault 只读统计）：256 条独占行引用 / 16 条同行含他字符，
    后者多为被链接包裹的 `[![…](…)](…)`（本身仍独占一行）与样本文件里的 JSON 字符串，未见正文混排的
    行内图。**裁决选项**：(a) 维持现状——图片一律块级栏宽（口径简单，与 Obsidian 阅读观感一致；M182 已
    按此实现）；(b) 只在引用独占一行时给包装盒栏宽、行内引用保留旧的 shrink-to-fit（代价：行内引用回到
    时序依赖的旧宽度，不变量只覆盖独占行形态，需要一处行内容判定）。worker 建议 (a)。证据（真机两态
    几何读数 / 反向验证）：`test-results/m182/`、`test-results/acceptance/2026-09-18/23-image-first-open-width/`。

15. **M327 归档批：change `tab-reveal-in-tree` 与 `vault-open-ignore-set` 已归档（2026-10-05）**：
    两件均已由 Alex 归档评审（节点 2）批准后落档（2026-10-05 原话「都批准。」），归档的既有惯例
    （整块替换 MODIFIED、相对链接补一层、自指路径改指归档目录名）逐条照办。
    - **`tab-reveal-in-tree`** → `openspec/changes/archive/2026-10-05-tab-reveal-in-tree/`（实现 M300，
      merge `f9db4b8` + D322 上屏列锁 en `a41c3f0`）。tasks **20/20 全勾**（任务 5.5 的真机执行
      由 tower 排期后独立跑过：场景 69 PASS，`test-results/acceptance/2026-10-01/69-tab-reveal-in-tree/`，
      30 条断言全绿）。living spec 落 `file-tree` 的 ADDED「在树中定位路径」（1 条）+ `multi-tabs` 的
      2 条 MODIFIED（「标签的关闭操作」菜单由三项变四项、首项为定位项；「文件树联动与空态」补定位例外
      ——该 MODIFIED 块已由 pane 归档重基，逐 scenario 核对无丢失）。
    - **`vault-open-ignore-set`** → `openspec/changes/archive/2026-10-05-vault-open-ignore-set/`
      （实现 M292，merge `8b05a09` + r1 P1-1 修 `e80f530`，合并 `75aeece`；验收 M296，merge `9f7e012`，
      真机批 7/7 PASS `test-results/acceptance/2026-09-29-final/`）。living spec 落 `fs-io`
      （2 条 MODIFIED「全类型递归枚举」/「watch 增量事件流」+ 2 条 ADDED「按需枚举目录」/「vault 内路径
      存在探测」）、`file-tree`（2 条 MODIFIED）、`vault-workspace`（4 条 MODIFIED）。tasks **43 项勾 38、
      5 项如实保留未勾**（见「待修 findings」的同名条）。
    - **归档动作实测**：归档件内 **32 条**相对链接逐条补一层 `../`，用路径解析脚本核对**全部可达
      （0 broken）**；`tab-reveal-in-tree/tasks.md` 的自指路径 `openspec/changes/tab-reveal-in-tree/`
      改指归档目录名。`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → **20 passed /
      0 failed**（归档前 22 = 20 specs + 2 changes）。
    - **原「待 Alex 的一格」（8.4，Alex 本机 grep 四条读数）已核销（2026-10-12）**：Alex 裁决「grep `~/.config/lumir/logs/*.jsonl` 这一条没有输出，估计路径已经过期了（后续迭代改了路径），直接销掉吧」——读数动作随日志路径行进而失效，不再跟踪。
    归档记录与逐任务对账结果见该 mission（分支 `feat/archive-node2-tab-reveal-and-vault-ignor`）的
    review-request。

16. **会话名钮的可发现性**（2026-10-09，M397 期间 Alex 真机反馈）：harness 面板的会话名钮
    （`<会话名> ▾`，`src/harness-panel.ts:1380` 起）是「打开会话历史浮层」的唯一入口，但形态像
    文档标签、没有菜单感——Alex 在浮层被裁的 bug 修复前完全没意识到它可点。M397 只修了「点了不出来」，
    「看不出来能点」是独立的 UX 问题：是否强化（如下拉箭头加重 / hover 态 / 改成明显的菜单钮），
    待 UX 裁决，建议攒到会话管理 UI 一起做（该 UI 本身也是 RSR change 里暂缓的项）。

17. **横滚代码块的视觉形态：贴正文左边缘、右侧溢出阅读栏宽，是否内缩待裁决**（2026-10-09，tower finding，low；M399 基线过目时 Alex 发现）：不折行代码块的横向滚动容器为**全宽**设计——背景自正文左边缘起、向右超出阅读栏宽，观感「没有左 margin」。Alex 过目 M399 基线时认为观感异常；对照 before / after 证实是 M399 之前的既有形态（`tests/visual/scenes/render-codeblock.spec.ts` 的 wrap-combo-4「双不折行」场景），**非本批回归**。**裁决选项**：(a) 维持全宽横滚（现状，口径最简单）；(b) 横滚容器加左缩进 / 视觉边界（背景内缩或加边框）。若取 (b)，落点为 `src/preview/` 的代码块横滚容器样式 + 相关整页基线重拍（AGENTS.md「基线更新是人肉裁决点」）。finding `.tower/comms/findings/20261009-tower-improve-item.md`（证据：左边缘 before / after 位置一致）。

18. **harness ctx% meter 的分母口径（暂缓，待 M464 修复的活体验证后重估）**（2026-10-12，M463/M464）：**原结论「端点实际生效输入上限 ≈ 名义窗口的 38%」已作废**——Alex 驳回（标称 256k 用 10 万就拒不合理 + Kimi Code 同模型会话 159k 正常工作的截图），tower 复核证实驳回成立：Kimi Code 本机全部 wire 日志中，同端点（api.kimi.com/coding）同模型 k3-256k 成功服务到 **234,656 input tokens**（名义窗口 91%），零真实 token limit 报错。**M464 三发对照探测（Alex 授权，证据 `test-results/m464-probe/` git 外）钉死膨胀源**：同一事故请求体，A 原样带 `rs_*` id = 400、B 剥 id = 400（同一报错 ⇒ 「按 id 展开」假设未被支持）、C 删尽 62 条 reasoning 项 = **200**（非 reasoning 部分 30.6 万字节诚实报价 76,149 input tokens）。即 **reasoning 项本身（与 id 无关）是膨胀源**：62 条思考摘要（约 11.1 万字节，用量报价口径约 2.3 万 token）在上限闸被计成 ≥18.6 万 token——上限闸与用量报价对 reasoning 项的口径相差约 8 倍（上限闸疑似按完整思考原文展开，报价只算传输的摘要）。Kimi Code 不受影响的原因：它对 kimi 端点走 chat completions、思考全文以 `reasoning_content` 明文重放，两本账看到同一内容。判别力边界（如实）：未分离「展开原文」与「摘要按更大口径计账」（第四发等长文本替换可做未做，机制细节不改变产品决策）。**M464 修复**（重放对齐 OpenAI store:false 官方模式：请求 `include:["reasoning.encrypted_content"]`、回放 `{type:"reasoning", summary, encrypted_content}` 剥 id）：间接支持但未直接验证——带密文的会话要等合并后自然积累，届时报价是否回归诚实、会话是否不再早夭即活体验证；若 kimi 端点 `/responses` 路径对 `encrypted_content` 支持不良，退路是 kimi provider 改走 chat completions 形状（与 Kimi Code 完全一致）。**裁决暂缓维持**：meter 分子（服务端报价）在 reasoning 项上不可信已被实证，分母裁决等活体验证结果；在此之前超限兜底靠 M463 已修的「自动压缩重试」（`overflow_indicators` 补 "token limit"）。附带口径决策保留：超限时 meter 是否同步读数（现行错误路径 return 早于 record_usage，读数停在旧值）。

## 承接残项（原「待 Alex 裁决」区移出条目的未闭合尾巴）

已裁、只是尾巴还没收的条目集中在这里；每条都指回它在「已核销」区的索引行。

- **多标签会话恢复：观测缺口与边界（原第 10 条）**：启动日志的 `session_restored{count}` 没实现——`src-tauri/src/logging.rs` 的事件白名单里没有该事件，`src/vault-switcher.ts` 的恢复路径也不发埋点；「上次恢复了几个标签、跳过了几个」目前只能靠真机截图与场景断言看。补的落点是恢复结束时发一条 `log_event`（需同时扩 Rust 白名单）。光标位置、滚动位置与撤销史都不恢复（决策 3 的口径，未变；滚动那一格已由 change `remember-reading-position` 承接）。
- **图片行显露口径（原第 19 条）**：Alex 节点 1 裁 A = 维持现状（change `image-svg-and-fallback` 不动图片行）；「图片行是否与链接 / 分隔线同口径」留作将来单独立项，落点 = `src/preview/livePreview.ts` 的 Image 分支补 `touchesSelection` 判断 + `editor-live-preview` spec 的显露覆盖集枚举。
- **版本号 bump 动作补进批次收尾 checklist（原第 33 条）**：M238 落地了 bump 口径与真源清单，但「把 bump 动作写进 `docs/process/openspec-workflow.md` 的批次收尾 checklist」不在 M238 scope 内，待 tower 补。口径原文（原第 33 条的 canonical 段）：批次收尾时按 semver bump——0.x 期间功能批 MINOR、缺陷批 PATCH；唯一真源 `src-tauri/tauri.conf.json` 的 `version`，`package.json` 同步跟随；改真源副本时逐处跟改（视觉桩 `tests/visual/scenes/tauri-stub.ts` 的缺省 `appMeta`、`titlebar-identity.spec.ts` 的 `VERSION`、`src-tauri/Cargo.toml:3` 与 `Cargo.lock` 的 `[[package]] name = "lumir"`）。
- **describe-config 面板（原第 36②）**：Alex 裁决「中期另立项」——照 `describe-bindings` 模式做「每键当前生效值 / 出厂值 / 改法」的面板；本批未做面板、未留钩子（config 参考文档那半边已由 M247 落地 `docs/specs/config-reference.md`）。

## 待修 findings（不阻塞）

### composer 导航写回：行级命令在「后块是段落」时把光标写到下一段段首（worker-m462 finding，2026-10-12，medium，**M465 已修 2026-10-12，待验收**）

**修法落点与本条建议的两条候选都不同（`normalizeComposerCaret` 的折叠条件，而非写回形态）**：根因在**读侧**——折叠无条件把段落末缘折成后块前缘，那个被折出来的模型值是错的（它描述的是**下一行行首**），再由 `domCaretTarget` 如实写回就成了本条的现象。M465 把折叠条件收紧为「后块**无文本宿主前缘**」（卡片 / 末段之后）才折，后块是段落时保留 `(i, len)`：写回侧一行不改（它对每个模型值都是对的），⌃E 因此如实落在**本行行末**，⌃B 从后段前缘如实退回**前段末缘**（Alex 2026-10-12 的 ⌃B 现场，M465 mission 的缺陷）。

**改动面**：`src/harness-panel.ts` 的 `normalizeComposerCaret`（+ 三处函数头口径）；判据四条在 `tests/unit/composer-nav.test.ts`（复现 + 覆盖不丢点属性 + 相邻即互为一步属性 + 词步的段-段边界，前三条里前两条与第四条修前红）；真机判据 = 验收场景 `scripts/acceptance/scenarios/154-harness-composer-prev-line-end.md`。**这两档的同族缺口一并关闭**：⌃F 从段末不再跳过一个真实位（旧：一步落到后段第 1 个字符之后）、⌃P 的「列位超出取目标行行尾」不再写到下一段行首（`tests/unit/composer-nav.test.ts` 的 M455 clamp 档改准）。

**随之变更的第三处键行为（M465 r1 评审 P2-1 追出，已裁决采用新行为）**：词步 `⌥F` / `⌥B` 的基函数第一步过归一，折叠收紧后**段-段边界不再跨段**——段末 ⌥F = 无动作（旧：折进后段、跳到后段词尾）、段末 ⌥B = 回本段词首（旧：折到后段前缘 = 反向按键却向前跳）、段首 ⌥B = 停在本段段首（两版一致）。语义裁决（tower 2026-10-12）：与 ⌃B 段首无动作对称、与词级 kill 的段边界口径一致 ⇒ 保留新行为。判据：「M465 词步的段-段边界（两方向都钉）」单测；口径与两处残留见 `docs/specs/harness-composer.md` §实测依据 M465 节。

**未关闭的一条（M462 提到的「顺带关闭」没做，如实登记）**：`「末尾之后」`（`block = 块数`）仍写块级容器末尾边界（rect 0×0）——M465 选了折叠层修法，不动它；口径见 `docs/specs/harness-composer.md` 的 HC3 已知边界 + 该文件 §实测依据 M465 节的已知边界第 1 条（末尾空段落前缘与「末尾之后」同为零几何位，本通道判不了绘制位置）。

### 卡片档前删（⌃D / Delete）的光标落点与写回位那一路不一致（worker-m465 finding，2026-10-12，low，待裁决）

**症状（真机可感知）**：光标停在**卡片前缘**（模型位 `{block: n, offset: 0}`，M457 起它**画在**前一段落末缘那一行）时按 ⌃D / Delete：卡片整块被删，光标却留在 `{block: n, offset: 0}` = **后一块（段落）的前缘**，视觉上光标从上一行行尾**跳到下一行行首**。同一位置经「写回位」（`{block: n-1, offset: prev.text.length}`）那一档按同一键：光标**不动**（留在前段末缘）。两条路径的块序列逐字节一致，只有光标落点不同。

**成因**：`deleteForwardAtCaret` 的卡片档写 `caret: {block: at, offset: 0}`（被删块的原下标），与 `removeBlockAt` 的「光标优先贴被删块的前一个块」口径不一致；**只在被删卡片的后一块是段落**时可见——后一块是卡片时两个落点的写回位又重合（前段落非空 ⇒ 卡片前缘写回前段末缘），因此一直没暴露。

**为什么现在登记**：M465 之前 `normalizeComposerCaret` 的无条件折叠把这两处折成「同一等价类」，`tests/unit/harness-composer.test.ts` 的写回语义用例因此看不出差别；M465 收紧折叠后该用例改按各自落点断言（判据形态见该用例的例外分支）。**M465 未改删除族的行为**（mission 明确不动编辑动词），只把它暴露出来。

**建议**：把 `deleteForwardAtCaret` 的卡片档改成 `removeBlockAt` 同口径（前一块是段落 ⇒ 光标落 `{block: at-1, offset: prev.text.length}`；否则 `{block: at, offset: 0}`）——一行量级的改动，但要连带核 ⌃D / Delete 的真机判据（场景 143）与 `tests/unit/harness-composer.test.ts` 的例外分支（改后该分支可删）。判据面：单测断言两条路径的光标同值；真机面可复用场景 154 的探针串读数形态。

### 词步（⌥F / ⌥B）在卡片档与段落档不对称：段落后紧邻卡片时两个方向都「不动」（worker-m465 r1 追出，2026-10-12，low，记录在案）

**症状**：段落后**紧邻卡片**时（`[para("abc"), card]`，光标在段末 `(0,3)`）：⌥F 返回卡片前缘、⌥B 也返回卡片前缘——两个方向都**没有视觉位移**（卡片前缘的写回位就是本段末缘，M457 的卡片档）。而段落后紧邻**段落**时（M465 起）：⌥F 无动作（一致）、⌥B **回本段词首**。即同一个「光标在段落末缘」的现场，⌥B 在段落档回词首、在卡片档不动。

**成因**：`moveWordForward` / `moveWordBackward` 第一步过 `normalizeComposerCaret`；「后块是卡片」档仍折叠（M465 只拆了「后块是段落」档），归一后的块是**卡片** ⇒ `block.kind !== "paragraph"` 早退。**M465 之前卡片档同样如此**（该档折叠一直在），不是本次改动引入的不对称；M465 的语义裁决（段-段边界不跨段）没有涉及它，故未一并对齐。

**处置建议**：若要收口，把两个词步函数的基准位从「归一位」改成「段落内的原始位」（与 `lineBasisCaret` 同档：caret 所在块是段落就取原始位），卡片档即与段落档一致（⌥B 回本段词首、⌥F 无动作）；代价是卡片档的 ⌥B 从「不动」变成「回词首」——属可感知的键行为变更，按影响面纪律需先裁再改。判据面：`tests/unit/composer-nav.test.ts` 的「M465 词步的段-段边界」单测末尾两条卡片档断言即该档现状（改后同步改准）。口径见 `docs/specs/harness-composer.md` §实测依据 M465 节的已知边界。

### 导航「一步必有位移」的两处既有豁免档（worker-m465 finding，2026-10-12，low，记录在案）

**症状**：`composerCaretStops` 的相邻两点里有两处**写回同一个 DOM 位**（= 按 ⌃F / ⌃B 一次没有视觉位移，键被吞掉）：
1. **卡片前缘** `(i, 0)` 与它前一块（**空**段落）的前缘 `(i-1, 0)`——卡片档的写回是「前段末缘」，空段落只有这一个位，两者重合（`[para("前"), para(""), card]`：`(1,0)`→`{text,1,0}`、`(2,0)`→`{text,1,0}`）。
2. **末尾空段落前缘** `(i, 0)` 与 `「末尾之后」` `(n, 0)`——两者都是零几何位（`Range` 量不到位，M456 的 `:empty::after` 只撑行盒），本通道判不出绘制位置是否同一。

**M465 未折这两对**（不是改动面）：① 里的两个模型位**编辑语义不同**（卡片前缘的内容型键入物化新段落、空段落前缘插进该段，HC3 第 3 条），折掉任一个都会改掉可达行为；② 折算这两对需要先有一条能读出「绘制位置」的通道（套件只有 AX / 截图 / 键入注入，**没有 JS 求值**——真机读数只能走 `Range.getBoundingClientRect()` 那条 Playwright WebKit 探针，形状见 `test-results/m462-probe/`）。**判据面**：`tests/unit/composer-nav.test.ts` 的「相邻即互为一步」属性对 ① 显式豁免（豁免条件写成「其中一项是卡片前缘」，段落 - 段落这种同类碰撞不被豁免），② 则以「写回位不同」通过。要收口请先裁「卡片前缘的空段落档如何表现」与「零几何位的绘制位置算不算同一位」。

### 像素类验收场景的窗口几何不再被钉住 ⇒ 坐标静默腐烂（worker-m462 finding，2026-10-12，medium，117 已加固、其余场景未扫）

套件的 `--config` 只钉窗口**位置**不钉尺寸；M437 起主窗口尺寸按工作区 90% 现算（实测 1152×864 ≠ conf 的 1200×800）。像素采样点是窗口局部坐标，几何一漂整片读到亮度跨度 0，且失败形态与「元素不在场」不可区分——场景 117 自 M456（composer 布局变动）起整片静默落空，直到 M462 才发现。117 已加固：第一步 `do: resizeWindow {width:1200, height:800}` 钉尺寸、采样点改实测值、场景头写清 composer「底部锚定、向上生长」（同一条 y 在不同行数下装不同的行）。**其余用 `pixel` 断言的场景未全仓扫**。可选加固三档（成本从小到大）：① 场景纪律写进 `scripts/acceptance/README.md`（pixel 场景首步钉尺寸 + 采样点注明实测出处）；② `pixel` 断言加节点相对形态 `{node, dx, dy}`（采样点由目标 bbox 现算，顺带消掉行数变化坑）；③ 腐烂看守（contrast 读 0 时落「该点是否在字形行带内」诊断，区分坐标落空 vs 元素缺席）。finding `.tower/comms/findings/20261012-worker-m462-improve-m437-117-m456-m462.md`。

### worktree 的 node_modules 软链是未跟踪项：`git add -A` 会把断链提交进仓（worker-m462 finding，2026-10-12，low）

`.gitignore` 的 `node_modules/` 带尾斜杠只匹配**目录**，worktree 起手铺的 `ln -s <主仓>/node_modules` 软链因此显示为 `?? node_modules` 未跟踪项——worker 若用 `git add -A` / `git add .` 收尾就会把指向主仓的软链提交进仓（跨机器断链）。修法：`.gitignore` 去掉尾斜杠或补一行无斜杠 `node_modules`（一行改动堵死）+ 在 AGENTS.md 硬规则 / `scripts/gate.sh` 头部注释写清 worktree 的 node_modules 铺垫口径与「收尾不要 `git add -A`」。finding `.tower/comms/findings/20261012-worker-m462-improve-worktree-node-modules-gitignore-node-modules-git-add-a.md`。

### 验收套件注入通道：菜单 Paste 之后 CGEvent 与套件内 type_text 均不落地（worker-m456 finding，2026-10-11，**high**，阻塞 134/141）

**症状**：composer 上走完**原生菜单 Paste**（右键 → 菜单里的 Paste 项）之后，**所有合成键盘/文本注入都拿不到 DOM**：
- **通道 1（CGEvent 逐键）**：`do: keys` / `do: key`（KimiCU `press_key`）**确定性死亡**——3/3 注入后目标串 0 命中，工具自报 `ok:true, occluded:false`；
- **通道 2（AX-focus + editing-command）**：KimiCU `type_text` **带 `index` 定向 composer** 在**套件 spawn 的 MCP 会话里也不落**（工具返回 `{"verification_required":"screenshot","message":"delivery_unverified: input events were sent but the text was not observed via AX readback"}`）；**不带 `index` 的「当前焦点」分支**同样不落。

**为什么不是环境/落点/聚焦**（逐条排除，证据齐）：同期 `ax: { focused: "AXTextArea" }` 断言 **PASS**（composer 真的拿到键盘焦点）、`gate` 前台已取得、`do: focusWindow` 无效；**index 一致**（套件诊断打印 `index=236`，与插件侧直探的 `236` 相同）；**参数形状一致**（`lib/cu.mjs:190` 的 `typeText` 传 `{pid,text,index}`）；**时序排除**（注入前加 `sleep(600)` 无效）；**二进制一致**（套件 `spawn("/Applications/KimiCU.app/Contents/MacOS/kimi-cu", ["mcp"])`，插件 wrapper `bin/kimi-cu-mcp` 是 `exec "$APP" mcp`，同一个）。

**关键对照**：**插件侧**对**同一 index** 直调 `type_text`（`mcp__kimi-cu__type_text(index=236, text=… )`）**立刻落地**（回读 composer value 出现目标串、并生成对应 `AXStaticText`）。⇒ 差异落在**调用方 MCP 会话/上下文**（套件 spawn 的 stdio server vs 插件的 server；AX 编辑路径对该上下文的 TCC/会话归属敏感）。

**影响面**：真机场景 **134 / 141** 的探针串注入（HC3 落点判据的观测手段）**不可达**——两条场景头已如实标注「通道阻塞，判据待修复或换形态」，**判据未动**；HC3 的模型层语义由单测覆盖（`tests/unit/harness-composer.test.ts` 的边界光标位用例）。

**修它要查的方向**：
1. 套件 spawn 的 MCP server 与插件 server 的**上下文差异**——TCC 授权按（binary + **responsible process**）走：套件 server 的父进程是 `node`（从 shell 起），插件 server 的父进程是 kimi CLI；AX 编辑命令路径可能对 responsible process 敏感（而 `get_app_state`/`click` 等 AX 读取与 CGEvent 鼠标路径两边都通，只有这条编辑路径分化）。
2. KimiCU 对 `type_text` 的 AX 前置要求（是否需要同源 `get_app_state` 缓存、或某个 AX 信任标记）。
3. 备选：给套件加一条**不依赖键盘注入**的注入通道（如 `lib/cgevent-click.swift` 同族的 swift 键注入，绕过 KimiCU），或给 HC3 换一条可用通道观测的判据形态。

**证据（本地，git 外）**：`test-results/acceptance/2026-10-11/134-harness-composer-intercard-caret/steps.md`（`do=keys` 0/3 的那几轮 + 诊断 note `M456-probe: type target index=236 role=AXTextArea baselineLen=89`）；`scripts/acceptance/README.md` 已知边界的 M456 条（结论全文）。

**M457 补充（worker-m457，2026-10-12，同一条通道缺口）**：M457 在**真实 app + WebKit**（Playwright，
非真机套件）上把 composer 的边界光标位逐键量了一遍，得到两条**与本条同族、但成因在引擎侧**的
实测结论，一并登记在这里免得下次再花一轮排查：
1. **边界位不派 `beforeinput`**：光标锚在**两张相邻卡片之间**（块级容器边界）时，WebKit 只派
   `keydown`——`beforeinput` / `input` **都不派**、字也不落（对照：光标锚在**段落 + 卡片之间**时
   WebKit 会把编辑目标解析到相邻段落、`beforeinput` 照常派）。M450 的物化挂在 `beforeinput` 上，
   因此在两卡之间永远不可达。M457 的修法：内容型键入改由 composer `keydown` 那一拍走模型
   （`boundaryTypingCaret` 纯函数判据），已修。
2. **`Range(composer, N)` 量不出 caret 几何**（`getBoundingClientRect()` 全 0，WebKit 与 Blink
   同结果），画在哪由引擎自行决定——真机现场表现为「⌃B 之后光标落进卡片正文里」。M457 的修法：
   边界位的写回改成**有文本宿主的相邻位**，已修（见 `docs/specs/harness-composer.md` 的 HC3 与
   M457 实测表）。

### 「末尾之后」的光标写回仍是块级容器边界：caret 几何为零（worker-m457，2026-10-12，low，待修）

**症状**：composer 的「末尾之后」（模型 `{block: 块数, offset: 0}`，⌃F 在最后一块之后 / ⌃N 出段落的
落点）写回 DOM 时仍是 `Range(composer, 块数)`——与 M457 修掉的卡片边界位同族：**量不出 caret 几何**，
画在哪由引擎自行决定（真机表现为「光标不知道跑哪去了」）。
**为什么这次没修**：它与卡片边界位不同——**没有文本宿主也没有后一块**，任何替代落点都会改掉模型值
（等价类里没有真实位置），属于「模型语义要不要跟着改」的问题，超出 M457 的改动面。
**修它要先定的口径**：把「末尾之后」的写回归一到最后一段落的末缘（读回随之变成段落末缘位 ⇒ 该处键入
从「末尾追加一个新段落」变成「接进最后一段落」），还是保持现有模型值、只让它可见（例如把
`{block: 块数}` 的写回落回**最后一个块**的边界）。
**证据**：`test-results/m457-probe/`（M457 的 WebKit 探针读数，git 外）；`docs/specs/harness-composer.md`
§已知边界（HC3，M457）第一条。

### 两卡相邻之间无法用 IME 组合输入：组合需要一个可编辑行内宿主（worker-m457，2026-10-12，medium，待修/待验收）

**症状**：光标停在**两张相邻卡片之间**（卡片边界位）时，中文等 IME 组合输入起不来——组合要求插入点
落在**可编辑**的行内宿主上，而该位置在 DOM 里没有（卡片是 `contenteditable=false` 的原子块，块级
容器边界又不参与编辑）。M457 已让**拉丁字符键入**与粘贴在该位置可用（keydown 拍走模型物化），IME
这一档仍是死的。
**可行路径（已实测的一条）**：先按 ⇧Enter —— 模型在该处物化一个空段落、光标随之进入可编辑位，之后
组合正常。可作为**已知边界**先文档化（`docs/specs/harness-composer.md` §已知边界已写）。
**彻底修的方向**（都不便宜，别当小补丁做）：给边界位一个**零高、不产生行盒**的可编辑宿主元素（会
动「顶层块只有三类 + 段落」的结构不变量与 composer.children ↔ blocks 的逐位对应），或在 keydown 的
组合起始拍（`key` 为 `Process` / keyCode 229）先物化一个空段落再让组合接手（时序依赖 IME，须真机实测）。
**判据缺口**：本条的自动化判据要真机（合成的组合事件造不出真实 IME 会话），而注入通道即上一条条目
的缺口。

### M457 的 WebKit 探针未入 git：DOM 层的永久回归判据缺位（worker-m457，2026-10-12，medium）

**症状**：M457 的核心缺陷（边界位 caret 几何为零 ⇒ 光标画进卡片正文）**只在 DOM / 引擎层可见**，
而 M457 的改动面（`src/harness-panel.ts` 等 + `tests/unit/**` + `scripts/acceptance/**`）**不含**
`tests/visual/**`——探针只能作为诊断证据落 `test-results/m457-probe/`（git 外），**没有永久回归防线**：
下次谁把 `domCaretTarget` 的落点阶梯改回块级容器边界，单测会红（写回形态是模型层可判的），但
「光标到底画在哪 / 引擎会不会派 beforeinput」这两条**只有引擎层判得了**的判据没有任何机器守着。
**建议**：在 `tests/visual/scenes/**` 补一条 WebKit 回归（`playwright.config.ts` 已有 `webkit-realua`
project 与真机同款 UA 的现成先例），判据 = ① `Range(composer, N)` 形态不再被写回；② 两卡之间逐键
注入后块序列出现新段落且两卡不丢。**该目录不在 M457 的改动面**，故未做（finding
`.tower/comms/findings/20261012-worker-m457-improve-composer-dom-m457-git.md`）。

### ⌃N / ⌃P 的「行」：逻辑行 → **渲染行**（worker-m457，2026-10-12；**Alex 已裁决，M457 已落地**）

**症状**：Alex 原话（2026-10-12）「Ctrl+N/P 也无法移动光标」。**不是没派发**——M457 在真实 app + WebKit
上逐键实测：⌃N / ⌃P / ⌃F / ⌃A（段中）/ ⌃E 都按模型层语义动了（⌃N 从段中跨过卡片落到下一段落、
⌃P 从末段跨回上一段落）。真因是**「行」的定义**：composer 侧按 `\n` 划**逻辑行**（原 HC4 原文），
软折行出来的视觉行不算行——一个窄 composer 里打满一句（5 个视觉行）仍然只有**一个**逻辑行 ⇒
段内 ⌃N/⌃P 一动不动；而编辑器侧（CodeMirror `cursorLineDown/Up`）走的是**视觉行**。用户看到的
就是「⌃N/⌃P 是死的」，且同一物理键在两个文本面行为不一致（`text` 作用域的本意是「两处文本面
共用同一命令」）。

**裁决与落地（2026-10-12）**：Alex 裁「按视觉行，与编辑器正文对齐」，按**超集**做——
`⌃N / ⌃P` 先试渲染行（`document.caretRangeFromPoint` 按同 x 位解相邻行的位置，`visualLineStepCrossed`
判「真跨了一行」才采信），**段内没有相邻渲染行时**沿用既有跨段落行为；⌃⇧N / ⌃⇧P 走同一份实现；
模型层的停靠点序列与归一等价类（⌃F/⌃B 的语义）一字未动。合同条款见
`docs/specs/harness-composer.md` HC4；判据 = 单测的闸门判据 + WebKit 探针的几何读数。

**仍未收口的一半（待 tower 扩 scope）**：`openspec/changes/composer-emacs-nav/specs/harness/spec.md`
（待归档 change 的 delta，:25-26 与 :61-63 的场景）与同 change 的
`specs/keymap-commands/spec.md:72` 仍写着「⌃N / ⌃P 在逻辑行之间移动」——该 change 尚未归档，故
**living spec（`openspec/specs/harness/spec.md`）里还没有这句**。改它不在 M457 的改动面内，已按纪律
报 tower（等扩 scope；归档时 living spec 才会带上新口径）。

**证据**：`test-results/m457-probe/` 的探针 B 读数（第一段 447px 宽、5 个视觉行；修前：段末按 ⌃P
选区完全不动、按 ⌃N 才跨到下一段落；修后：⌃P/⌃N 各走一个**渲染行**）；`docs/specs/harness-composer.md` HC4。

### M443 的 tasks.md 把未经真机验证的读数当「已通过」登记（worker-m456 finding，2026-10-11，medium，对账口径）

**症状**：`openspec/changes/harness-cache-metrics/tasks.md` §5.2 末的「真机跑批读数（2026-10-11）」
把一串**具体读数**（`50% · 50%` / `10% · 50%` / `15% · 20%` / `17% · 60%` …）写成「非 hover 断言
**全部通过**」；但该轮真机跑批的证据（`test-results/alex-review-2026-10-11/m443/acceptance/summary.md`）
五个场景**全部 INVALID**——第一步 hover 就因前台被 Chrome（pid 8608）占用而抛 InfraError，
**第二轮从未跑到**。其中 `17% · 60%` 恰是 133 **第二轮**才出现的值，而 M456 实测该值在 master 上
根本产生不出来（见下「证据」）——那条读数不可能来自任何一次真实跑批。
**为什么会漏**：131/133 是第一批需要**跨轮推进** mock 脚本的场景（第二轮要弹 `responses[1]`），
而 mock 的脚本游标一直是**每轮重建、从 `responses[0]` 重放**（既有语义，场景 104/106 的头注与断言
都写明并依赖它）。M443 的真机对账因环境项整轮作废、没人回看，于是「第二轮拿不到 `responses[1]`」
这个缺口被当成「已通过」。根因形态同 REVIEW.md 第 6 条「覆盖声明超出真实验证」，只是这次越过了
场景层、直接进了 change 的验收对账。
**证据**：`test-results/alex-review-2026-10-11/m443/acceptance/summary.md`（5/5 INVALID）、
`.../131-harness-cache-session/steps.md`（第一步 hover 即 INVALID）；M456 现场
`test-results/acceptance/2026-10-11/133-harness-cache-write/ax/03-*等第二轮回答到达*.txt`
（第二轮 assistant 行 = `写缓存回答。` = `responses[0]`，控制行仍 `15% · 20%`）。
**建议防线**：① 真机读数只在**该轮 acceptance 的 `results.json` / `summary.md` 有对应 PASS 行**时
才写进 tasks.md，并把「跑于 / 证据目录」一并钉上——引用门禁/套件结论照抄脚本原文行，不复述
（REVIEW.md 第 6/7/20 条同一精神，这次是执行没跟上）；② acceptance 把因环境项 `INVALID` 的场景
与 `FAIL` 分列（脚本已如此），对账时**不得把 INVALID 计入「已通过」**；③ 起草 / 评审期遇到
「本 change 的验收依赖某个 mock 语义」时，先跑一遍最小场景确认真拿得到目标响应，再写进
「已通过」。

### gate quick 不解析验收套件 lib：块注释内 glob `*/` 闭合注释致全套件 SyntaxError 上了 master（2026-10-10，medium，防线缺口）

**现场**：M433 r2 的注释修订把 `env:harness/sessions/*/*.jsonl` 写进 `scripts/acceptance/lib/app.mjs:146`
的 `/** */` 块注释，`*/` 提前闭合注释 → import 阶段 SyntaxError，全 128 场景不可跑。gate quick 10/10
照常绿（它不含 acceptance 语法校验），reviewer r2 复跑 quick 也没抓住——**机器网与评审网同时漏**。
tower hotfix `cf3deea` 直接改措辞修掉（`node --check` + `run.mjs --check` 复绿）。
**修法方向**：① gate quick 增一项 `node --check scripts/acceptance/lib/*.mjs`（或 `run.mjs --check`，
秒级）；② REVIEW.md 补一条：块注释里写 glob/路径时警惕 `*/` 序列。两条都小，可随下个动 gate.sh /
REVIEW.md 的 mission 顺手做。

### 切 vault 后新开的 harness pane 缺标题栏会话段（worker-m433 finding，2026-10-10，**medium**）

**症状**：切 vault（⌘O）后用 ⌘⇧A 在新 vault 开 harness pane，面板本体在场且可用，但标题栏的
harness 段（会话名钮 + 新建会话钮）既不进 AX 树也不上屏——**该 vault 里恢复/删除历史会话在 UI 上
无路可走**（会话历史浮层只有会话名钮一个入口）。两次真机复现（有/无打开文档各一），单 vault 正常。
**代码线索**（未定位根因）：`src/harness-panel.ts:1768` 段是**一次性** insertBefore 进 titlebar 的
长驻元素；若切 vault 时 titlebar/pane 装配被重建，段不会被重新插入——与 M351 记过的「长驻元素被新
容器丢掉」同族。探针：attach/togglePane 路径上加 `seg.isConnected` 断言。
**修法方向**：定位根因修复后，在场景 78 或 124 的 B 侧补「标题栏段在场」结构断言
（`ax: { has: "/AXPopUpButton \\(/" }` 形态）——该缺口在套件里一直是空的（78 未断言标题栏段）。
finding 全文：`.tower/comms/findings/20261010-worker-m433-bug-vault-harness-pane-ax.md`（含 AX dump
与截图证据路径）。

### harness 附件落点未按 vault 分置（worker-m433 finding，2026-10-10，low，**已裁决已收口**）

**裁决（Alex，2026-10-10）**：采用「按 vault 分层」案。M436（`feat/revise-composer-image-paste-attachments`）
已把在途 change `harness-composer-image-paste` 的附件落点改准为 `attachments/<vault 稳定 id>/`（与
`sessions/<id>/` 同族命名纪律；零存量故无归位脚本；写时拿不到合格 vault id 则拒绝落盘；删会话不牵动
附件；按 vault 备份 = 取同名 id 两目录）。本条留档备查，不再待办。
**实现落点（M440 收口）**：`src-tauri/src/harness/attachments.rs` 落地（写/读/展开三件套 + 落点逃逸拒绝），
验收场景 127–128 覆盖两 vault 分置与互不可见；真机实测通过。
**原事实**：`harness-sessions-per-vault` 提案「排依赖」要求 harness 侧附件落 vault 层级，而在途
`harness-composer-image-paste` design §5 曾把附件落平铺的 `harness/attachments/`。
finding 全文：`.tower/comms/findings/20261010-worker-m433-improve-harness-m425-vault-change.md`。
另：`openspec/changes/harness-sessions-per-vault/tasks.md` 5.1 的 M433 核对结论（「未采用层级」）是当时
快照、现已过时，归档该 change 时顺手改准。

### harness 会话留存路径描述有两处真源（worker-m433 观察，2026-10-10，low）

**症状**：`src-tauri/src/harness/session.rs` 的 ts-rs doc 注释（导出进 `src/bindings/SessionSummary.ts`）与
`src/ipc.ts:457,471,485` 的 IPC 注释描述同一条 `sessions/...` 路径语义，REVIEW.md 第 8 条「同一事实多处
真源」形态。M433 只按 tasks 1.5 把四处路径描述改准，未动结构。
**修法方向**：长期看这类路径描述只留一处真源（Rust 侧 doc 为准，ipc.ts 指向它，或反之），随下次动
这两个文件的 mission 顺手收敛；非独立议题。

### living spec harness 未覆盖 M373/M381 的「models 逐项模型能力声明」（worker-m424 finding，2026-10-10，low）

**症状**：`[harness].providers.<id>.models` 的 `{id, effort, window}` 声明与保守默认口径（缺 effort → false、
缺 window → FALLBACK_CONTEXT_WINDOW、类型不符丢该项、未列出 = 不支持）已在实现与验收套件生效，
但 living spec「配置节 [harness]」（openspec/specs/harness/spec.md:200）没有 `models` 表——已实现未进 spec。
**修法方向**：补一条「模型清单与能力声明」requirement（或 MODIFY 配置节）；**与 change
harness-composer-image-paste 的 vision 能力增量同表合并归档最省事**——实现该 change 时一并带上。
finding：`.tower/comms/findings/20261010-worker-m424-improve-living-spec-harness-m373-m381-models.md`。

### 验收场景 123 的 focusWindow 机制描述失准（reviewer-m430 非阻塞观察，2026-10-10，low）

**症状**：`scripts/acceptance/scenarios/123-harness-agents-local-md.md` 文档称「focusWindow 拿不到前台即报错」，
实际 `scripts/acceptance/lib/execute.mjs:1680` 的 focusWindow 失败只记 note 不抛错，可归因性由随后的
`ax: { focused: "AXTextArea" }` 断言承担；且 123 用默认 retries=2，64/66 是显式 retries:4，flake 余量略小。
行为面零影响。**修法**：归档 harness-agents-local-md 节点顺手修正场景文档措辞，retries 是否对齐 4 一并定。

### 消息摘录跳回三层真机不可判：落点（类名 + 滚动位置）读不进 AX（worker-m423 留口，2026-10-10，low）

**症状**：harness-message-excerpt design §8 的④跳回三层（上屏卡点击跳回来源消息并高亮），真机侧落点
读不进 AX 树，场景 121 只能判到「点击后无报错」；结构半已由 chromium 场景覆盖
（`.is-jump-flash` 出现→退场、高亮落在来源消息）。
**修法方向**：真机侧若要判，需验收套件加一条「读回 DOM 选区/类名」的通道（evaluate 类动词），属独立议题。

### 消息摘录快照恢复 round-trip 真机无预置口（worker-m423 留口，2026-10-10，low）

**症状**：design §8 的⑤快照恢复「重启后摘录卡片从会话留存还原」——解析半已由
`tests/unit/message-quote-card.test.ts` 互逆测试钉住；真机「重启后卡片还原」需要预置 harness
会话留存（JSONL），验收套件当前无该预置口。
**修法方向**：套件加「预置 harness 会话留存」夹具（往隔离 `XDG_CONFIG_HOME` 写合成 JSONL），
随后补一条重启还原场景。

### transcript 静态文本在 AX 树无 bbox：选区类动词通道结论（worker-m423 finding，2026-10-10，**已有结论**，medium→low）

**症状**：harness transcript 的消息文本在 AX 树里是无 bbox 的 `AXStaticText`，`doubleClick`/`drag`
的节点定位报「找不到带 bbox 的节点」，`click` 的 AXPress 对静态文本不产选区。
**结论（tower 裁决，2026-10-10，取代 finding 原建议）**：**不加 `selectText` 动词**——KimiCU
`select_text` 只作用 AX 选区层、不产 DOM selectionchange（编辑器手势对照组实证），包成动词也是假通道。
真机选区通道用既有 `drag {x,y}`（真实 CGEvent 拖选），落点坐标用常量，配合三道内容判据兜底
（场景 121/122 已以此全绿）。finding 原建议（`cu.mjs` 封装 `select_text`）作废。
**残余**：将来任何「在只读文本上选中一段」的新场景，照场景 121/122 的 drag + 内容判据写法，
不要再提 selectText 方案。finding：`.tower/comms/findings/20261010-worker-m423-improve-transcript.md`。

### cargo 锁「先复核再创建」存在 check-then-create 竞态（tower finding，2026-10-10，low）

**症状**：worker-m419 与 worker-m421 同秒各自复核「锁不存在」后双双广播持有 `/tmp/lumir-cargo-build.lock`，
实际只有一方的 cargo 在跑（tower 亲查锁元数据坐实）。本次后果轻微（另一方 cargo 尚未启动即被叫停），窗口客观存在。
**修法方向**：锁获取改 mkdir 原子语义（创建成功=持有、失败=被占），去掉「先检查后创建」两步流程；
落点 REVIEW.md 或 HANDOFF 常备纪律的 cargo 锁条目。
finding：`.tower/comms/findings/20261010-tower-improve-cargo-check-then-create-m419-m421-claim.md`。

### playwright 探针不设 outputDir 会清空 worktree 的 test-results/（worker-m419 实证，2026-10-10，low）

**症状**：worker 在 worktree 内跑 playwright 探针未显式设 outputDir，playwright 默认把 worktree 的
`test-results/` 当输出目录并在跑前清空——已 PASS 的验收证据被清（已从副本重建，无实际损失）。
**修法方向**：纪律条目「worktree 内跑 playwright 探针必须显式 outputDir 指向 /tmp，绝不指向仓内 test-results/」，
落点 REVIEW.md 或 scripts/acceptance/README.md。
finding：`.tower/comms/findings/20261010-tower-improve-playwright-outputdir-worktree-test-results-m419.md`。

### 「未保存新文档」状态无 UI 入口：贴图退 vault 根这条行为真机不可达（worker-m416 finding，2026-10-10，medium）

**症状**：产品里没有任何可达路径能产生「无路径、可编辑」的文档，因此 paste-clipboard-image 裁决的
「未保存新文档贴图退 vault 根」真机验不到，只能由单测钉住（M416 收尾坐实，三条路径都封死）。
**修法方向**：将来若加「新建未保存文档」入口，补一条真机验收场景覆盖该形态。
finding：`.tower/comms/findings/20261010-worker-m416-idea-ui-vault.md`。

### toast 浮条缺 ARIA live region 语义，读屏不播报瞬时反馈（worker-m420 finding，2026-10-10，low）

**症状**：`.lumir-toast`（保存/复制成功与各类错误提示的唯一出口）无 role、无 aria-live，VoiceOver 不主动播报。
**未实测**：本仓验收走 KimiCU AX dump，覆盖不到播报行为；且实测加 `role="status"` 对 WKWebView AX 形态无影响
（浮条只产一个无 bbox 的 AXStaticText），验收层验不到。
**修法方向**：实现层加 `role="status"`（普通）/ 错误类 `role="alert"`；按「不做无声明的验证」处理，不配验收断言。
finding：`.tower/comms/findings/20261010-worker-m420-improve-toast-aria-live-region.md`。

### 列表 lazy continuation 渲染归属：引用块内与 1–3 空格缩进两档未覆盖（worker-m421 finding，2026-10-10，low）

**症状**：M421 的 L1 判据取「文档第 1 列即非空白」，两档同族形态未覆盖：① 引用块内 lazy 行（`> - a` 后 `> b`）；
② lazy 行带 1–3 空格（CommonMark 允许的 lazy 缩进区间）。已写进合同 docs/specs/lists.md「已知边界」。
**修法方向**：先补 Obsidian 对照（两档），再决定是否把判据推广到「剥离引用前缀后的内容列 == 0」；
推广前核对行首空白吞除装饰不会把 `> ` 前缀一起吃掉。
finding：`.tower/comms/findings/20261010-worker-m421-improve-lazy-continuation-1-3-m421-v1.md`。

### composer 显式光标 reveal 在真机验收层无区分度，chromium 侧可补断言（worker-m419 finding，2026-10-10，low）

**症状**：M419 的 `scrollCaretIntoView` 停用后真机场景 118 仍绿——WKWebView 程序化改选区时自己 reveal 光标；
Blink 不会（chromium 探针实测差整整一行）。该代码是「引擎无关的保证」，真机层拿不到区分度。
**修法方向**：chromium 视觉套件（tests/visual/scenes/**）补一条「断行后 scrollTop 触及滚动上限」结构断言；
非紧急，现有判据挂 caretScrollTop 单测已够。
finding：`.tower/comms/findings/20261010-worker-m419-improve-composer-reveal-chromium.md`。

### living spec 与实现的矛盾无机器防线：validate 只查结构、docs-check 只查链接（worker-m418 finding，2026-10-10，low）

**症状**：living spec harness「上下文用量显示」写「ⓘ 钮点击展开气泡」，实现 2026-10-07 起已是 hover 浮层
（无 focusable 入口），漂移 3 天无人发现；归档时 reshape delta 整块 MODIFIED 复述旧句，差点把漂移重新固化
（M418 归档评审抓到并已改准）。`openspec validate --strict` 与 `docs-check` 都看不见 spec↔实现矛盾，
目前唯一防线是归档评审的逐条对账。
**修法方向**：无现成机器方案；短期靠归档评审纪律兜底，长期可评估「spec 条款 ↔ 代码锚点」登记制。
finding：`.tower/comms/findings/20261010-worker-m418-improve-living-spec-harness-ctx-3-m418.md`。

### Full Access 档下 sudo / xargs / find -exec 间接调 rm 绕过危险命令黑名单（reviewer-m407 r1 finding，2026-10-09 登记；**Alex 2026-10-10 裁决：堵**，medium）

**缺口**：M407 的分类闸门对 argv 做字面命令名匹配，`sudo rm` / `xargs rm` / `find -exec rm` 这类包装/间接
调用形态不认得 `rm`，在 full_access 档免闸放行。**裁决**：堵——这些间接形态在 Full Access 档仍须进闸。
**修法方向**（落权限后续批次，`src-tauri/src/harness/permissions.rs` 分类表 + 单测）：把
sudo/xargs/find -exec（及 -execdir）等 wrapper 的**被包装命令**递归取出再进分类管线；取不出确定形态时
保守降级为询问（宁多问勿漏拦）。注意边界：递归解析只在「wrapper 名单内的命令」上展开，不做通用 shell
语义解析；`find -exec` 的 `;`/`+` 终止符与 `\;` 转义形态需用例钉死。
finding：`.tower/comms/findings/` 下 reviewer-m407 的 sudo/xargs/find -exec 条目（2026-10-09）。

### harness 恢复路径 decision 回填的次序启发式会错配（M413 r1 P2-2，low）

**症状**：`harness.rs::restored_panel_messages` 按 `(工具名, 第 N 次出现)` 次序把 JSONL approval sidecar
回填到工具行 decision 字段——同一会话内同一工具既有 allow 直执行又过批准闸时，sidecar（只记过闸调用）
与 function_call 出现次序对不齐，decision 贴错行。仅影响恢复路径展示字段（live 路径 decision 由
turn.rs handle_call 直写，无此问题），前端消费者随 UI 批次落地。
**修法方向**：approval sidecar 记录增 call id 字段（request id ↔ wire function_call 的 call_id 关联），
恢复时按 call id 精确配对。

### 验收套件可跑性靠人肉自觉：预检缺磁盘水位与实例占用硬门（worker-m414 finding，2026-10-10，low）

**症状**：M414 真机段差点跑不起来——数据卷仅剩 2.1G（低于 REVIEW.md 第 12 条「worktree 首次构建 ≥3G」
预算），且 1420 有 Alex 的 dev 实例在跑（REVIEW.md 第 11 条丢键风险）。runner 预检段
（scripts/acceptance/run.mjs）现在只查互斥锁与 1430 端口归属，磁盘水位靠 REVIEW.md 的人肉自觉。
（磁盘侧已由 tower 清理 15 个残留 worktree 恢复至 20Gi 解围，2026-10-10。）
**修法方向**：预检加两条硬门——可用磁盘 < 3G 直接 FAIL（不进 build，避免半途 ENOSPC 留半截 target）；
1420/1430 有 LISTEN 时按 REVIEW.md 第 11 条报警提示。

### 权限档位表前后端两份手工保持一致，漂移无机器防线（reviewer-m414 r1 观察项，2026-10-10，low）

**症状**：前端 `PERMISSION_MODES`（src/harness-panel.ts:703）与 Rust `PermissionMode` 闭集合是两份手工
保持一致的表；ts-rs 绑定 `src/bindings/PermissionMode.ts` 是类型别名、运行期不可遍历，bindings-drift
门禁抓不住取值漂移。漂了的前端表现是静默回落 vault_write（安全方向），注释已写明分工，故不阻塞。
**修法方向**：加一条类型层断言或单测对照后端 as_str 取值表，把两份表的等价性钉进门禁。

### 面板滚动行为无机器防线：AX 不反映滚动位置（M398 r1 reviewer 登记，2026-10-09，low）

**症状**：恢复重建后「滚动落底」这类行为没有任何机器断言能守——AX 快照不携带滚动位置，
场景 106 的 transcript 太短（一屏内全显）天然暴露不了「停在最末 user 消息、回复折在视口外」。
M398 r1 的 P1 正是靠 reviewer 读代码抓的，不是机器抓的。与 m303 `toBeVisible()` 盲区同族
（断言通道读不到关键状态）。

**建议处置**：几何探针防线（transcript 容器 scrollTop 近底断言，或「最末渲染件包围盒落在视口内」
的 geom 断言——M397 的 geom 形态现成）；攒批处理，不单独立项。

### ~~不打开任何文件时 harness 发送直接失败：`context_json` 传了 null（tower 复现期实测，2026-10-09，medium）~~ **已核销（2026-10-09，M398，merge `9a9a422`，核销记录见「已核销」区）**

**症状**：vault 里不打开任何文件（面板上下文行显示「上下文：无（未打开文件）」——UI 明示这是
合法状态）时发消息，立刻报红：`发送失败：invalid args 'context_json' for command 'harness_send':
invalid type: null, expected a string`。前端在无文档上下文时给 `harness_send` 传了 null，
而后端参数要求 string。打开任一文件后发送正常。真机实测（mock provider，场景外手测）。

**建议处置**：无文档时传空串（或后端参数改 Option 并归一到「无上下文」分支）——两侧取一侧修，
判据是「无文件打开也能发起纯对话」；顺手在验收套件加一条无文档发送的场景断言，否则这个状态
组合没有机器防线。

### 无头/后台启动的实例首屏白屏，vite 整页重载后才渲染（tower 复现期三现场，2026-10-09，未定性，low）

**症状**：同一天三个独立现场——手工 `pnpm tauri dev`、验收套件 `launchApp`、套件场景 106
（INVALID「前端 30000ms 内未就绪」）——实例进程正常、后端 vault_open 日志齐全（前端确实
invoke 过）、窗口 chrome 可见，但内容区纯白且 AX 只剩菜单栏；vite HMR 触发整页重载后立刻
完整渲染。Alex 手起的实例未见此症状（其 vite 长期运行、经历过 HMR 重载——相关性未验证）。

**建议处置**：未定性是环境（无头/焦点/副屏合成）还是产品（首载竞态）。下一步收集：Alex 日常
冷启动是否见过首屏白屏；若见过即升级为产品缺陷立项。与「KimiCU AX 快照偶发退化」条目可能
同源（白屏期间 AX 同样退化），先并列登记不合并。

### 会话浮层在极端矮窗（≲392px）下仍越出视口（M397 残余边界，2026-10-09，low）

**症状**：`placeSessPop` 的纵向夹取退到上沿 8px 仍容不下浮层自然高（清单上限 320 + 动作项 ≈ 376px）
时，浮层下端越出视口——`docs/specs/overlay-visibility.md` O2 在「极端矮窗 + 长历史」输入下不成立。
`tauri.conf.json` 无 minHeight，该输入理论可达。

**建议处置**：压清单可滚动区高度（vault 切换浮层 place 的同款手法，O2 括注里的「压其可滚动区高度」）
+ 配一条 resizeWindow 矮窗 geom 断言。M397 不做是 tower 裁决：该修法引入当前场景覆盖不到的新行为
（REVIEW.md 第 9 条「新增行为要给出消费者」）。worker 如实登记见 inbox
`20261009-worker-m397-popup-tower-review-request-m397-r1-p2-1-p2-2-tip-0d36770.md` 末节。

### m303 视觉用例的 `toBeVisible()` 对祖先裁切无区分度（M397 worker finding，2026-10-09，low）

**症状**：`tests/visual/scenes/m303-harness-panel.spec.ts:116` 的 `expect(pop).toBeVisible()` 只查
非空包围盒 + visibility 样式——浮层被祖先 overflow 裁掉期间该用例同样假绿（与 REVIEW.md 假绿章
第 5 条同形态，chromium 侧现场）。

**建议处置**：按 `docs/specs/overlay-visibility.md「与实现的关系」节补包围盒包含断言（元素级
boundingBox 完整且在其锚点邻近区域内）。finding
`.tower/comms/findings/20261009-worker-m397-popup-improve-m303-overflow.md`。

### KimiCU AX 快照偶发退化（M397 worker 观察，2026-10-09，环境边界，low）

**症状**：场景 106 首跑遇一次 AX 快照退化（dump 只剩菜单栏、element_count 16，92 因此 INVALID），
复跑即恢复——注入/快照通道的环境抖动，非产品缺陷。

**建议处置**：攒够第二次现场后写进 `scripts/acceptance/README.md` 的「已知边界」（含「复跑即恢复」
的处置口径）；单次现场不够成条目，先记在此。

### 会话浮层快速「关→再开」可重复追加历史会话行（M392 评审观察，2026-10-08，low，攒批处理）

**症状**：`src/harness-panel.ts` 的 `buildSessList` 在 `harness_list_sessions` 的 invoke 往返内被再次
触发时（快速关闭浮层再打开），会把历史会话行重复追加进清单——cosmetic，下次正常打开自愈，
与既有浮层同口径（M392 review r1/r2 均确认为非阻塞观察项）。

**建议处置**：一行代次戳（每次打开递增 generation，回调只接受当代结果）即可收口；攒批处理，
不单独立项。finding `.tower/comms/findings/20261008-tower-bug-buildsesslist-cosmetic.md`。

### 会话留存：未来评估 wire 原生增量记录（Claude Code / Kimi Code 形态）（M394 登记，2026-10-08，待办）

**是什么**：本期 wire 形态会话留存（change `reshape-harness-session-recording`，即 proposal 里的
「wire-level session recording」）取的是「每次 LLM 调用落完整请求体」，恢复**零拼装**。留一个扣子：
**当会话变长、完整请求体重复落盘的体积成为实际问题时**，改为两家 coding agent 的「wire 原生增量记录
+ 确定性重建」形态——每发生一条消息 / 工具调用追加一行原文（wire 原生消息对象），恢复时按序拼装重建。
与本期已否决的「业务事件流水」不同：增量记的是**发给模型的原文**，不是业务语义事件，拼装因此不变形。

**一手依据（2026-10-08 本机实测两家实现）**：
- **Kimi Code**：`wire.jsonl` 的 `llm.request` **只存哈希、不存请求体**；恢复靠消费 append 事件流重建。
- **Claude Code**：会话文件是 `parentUuid` 链的**完整消息对象逐条 append**。

**与本期的关系（为什么现在不改）**：完整请求体方案的恢复**零拼装、且恢复后 prompt cache 前缀逐字节稳定**
（恢复时逐字节保真决定 provider 侧前缀缓存命中）；增量的代价是恢复代码路径与发送路径各说各话。
**这不是待修缺陷，是一格有触发条件的前瞻记录**——本期已经把权衡写进 design。

**落点 / 触发条件**：写法与完整权衡见 `openspec/changes/reshape-harness-session-recording/design.md`
§8「未来方向（本期不做，留扣子）」。触发条件 = 会话变长、体积成为实际问题（与 design §4 的
「若 dogfood 出现体积实证」同口径；那时第一步仍是 §4 的「压缩旧文件 / 截断附件」类事后整理，
本节记的是更深一层的结构候选）。

### `context.rs` 模块注释称「自动压缩走同一 `assemble_system`」，实际压缩不重装配（M385 survey 顺报，2026-10-08，low）

**症状**：`src-tauri/src/harness/context.rs:10-12` 的模块文档写「装配时机：会话建立 / 「新会话」重置 /
自动压缩开新逻辑会话——三者走同一个 `[assemble_system]`」，与实现不符：全仓 `assemble_system` 只有定义
（`context.rs:49`）与**唯一**调用点（`harness.rs:299`，在 `ensure_session` 内；会话建立与「新会话」重置
走的是这同一条路径）；`compact_now`（`turn.rs:784-859`）通读无 `assemble_system` 调用，只在
`turn.rs:842` `replace_input`（摘要项 + 当前编辑器上下文）后记面板消息与 JSONL `compact`。
压缩后的系统上下文靠 `Session.system` 原样保留——每个请求仍带它（`build_request` 读 `s.system()`，
`turn.rs:526`）。

**行为面**：**不是行为缺陷**。`openspec/specs/harness/spec.md:115` 那条 requirement 要求的「开新逻辑
会话并注入摘要 + 当前编辑器上下文 + 系统上下文」在请求层仍成立（系统上下文是 requests 的 instructions
段、不进历史，因此压缩不碰它也不丢）。失真只在注释：它暗示压缩会重新读一遍 AGENTS.md / Skill 索引，
实际不会——运行期新增的 Skill 要等下一个「新会话」才生效。后果是读者（含 agent）可能据此误判「压缩后
系统上下文是新鲜的」。

**影响**：无假绿、无不可逆、无用户可见错误。与 observability 话题直接相关：观测 / 留存若按注释去记
「压缩时刻的装配清单」，会把没发生的事记成发生了。

**建议处置**：**随 WSR 提案一并裁决**——改 `context.rs:10-12` 的注释与 `compact_now` 实现对齐（压缩
不重装配、系统上下文随 `Session.system` 保留、运行期新增 Skill 下个新会话才生效）是零行为改动的一侧；
反向改法（让压缩**真**重装配并记留存）属行为变更、需另立 change。这条反向改法正是进行中的
**wire-level session recording（WSR）提案**的设计点之一——该提案核心口径①即「会话建立 / 重置 /
**压缩**时落完整装配记录」，即「压缩是否重装配」由 WSR 提案一并定。因此本条不在这里给与提案冲突的
独立处置：裁决方向定为「注释对齐现状」后，注释改动的落点即本条。

**证据**：`.tower/comms/findings/20261008-worker-soi1-improve-harness-context-rs-assemble-system.md`
（M385 survey 顺报，worker-soi1；**finding 头部标 medium、正文自陈 low，本条按正文的行为判定记 low**）。
关联提案：mission M387（分支 `feat/proposal-wire-level-session-recording-ws`，scope
`openspec/changes/**`）。本条指针已按本 worktree 基线（`fb768eb`）逐条磁盘核验：
`context.rs:10-12` / `:49`、`harness.rs:294` 的 `ensure_session`（调用点 `:299`）、
`turn.rs:784-859`（`replace_input` 在 `:842`）、`turn.rs:526`、`openspec/specs/harness/spec.md:115`
全部在位（finding 原文写 `turn.rs:786-859`，本基线为 `784-859`，两行漂移已按实测改准）。

### acceptance README 的正则反斜杠示例与 YAML 引号风格耦合，照抄会在单引号场景写出恒红判据（M383 顺报，2026-10-08，low）

**症状**：`scripts/acceptance/README.md`（约 :390 的「匹配值」节）用**双反斜杠**形态给正则示例——
`要断言「文档末尾」得写 (?![\\s\\S])`，同节下方 `M140 r1 评审实证` 的 `/PAUSE-PROBE[\\s\\S]*$/` 同形。
但场景 YAML 里反斜杠的正确形态取决于标量**引号风格**：单引号标量原样透传反斜杠（须写 `\s` / `\{`），
双引号标量才需 `\\s`（`\\s` 经转义后值为 `\s`，而 `\s` 本身不是合法转义）。照抄 README 代码 span 的人若在
**单引号**场景里写 `\\s\\S`，matcher 拿到的是字面 `\\s` = 正则「反斜杠 + s」，与任何文本都不匹配
⇒ 判据**恒红**。

**现场**：M383 的场景 104（harness thinking / tool 顺序）首跑即踩到——单引号正则里写 `\\s\\S` / `\\{`
让有序判据恒红，改成单反斜杠后转绿；两次现场都在
`test-results/acceptance/2026-10-08-m383-thinktool/104-harness-thinking-tool-order/`。

**影响**：假红方向（不是假绿）——作者照抄文档会写出一个永不通过的判据，排查成本落在「以为产品坏了」上；
触发面窄（只在单引号场景 + 含反斜杠正则时），定 low。

**建议处置**：在「匹配值」节补一句引号风格与反斜杠的对照（单引号写单反斜杠、双引号写双反斜杠，两者最终
都给 matcher 一个单反斜杠值的正则源），或把示例统一改为单引号场景的推荐形态。纯文档，本批只落账、未立项。

**证据**：`.tower/comms/findings/20261008-worker-thinktool1-improve-acceptance-readme-yaml.md`（M383 顺报）；
落点 `scripts/acceptance/README.md` 的「匹配值」节（约 :390）。

### acceptance `run.mjs --help` 静默触发全量真机跑批（M374 现场，2026-10-07，low）

**症状**：`node scripts/acceptance/run.mjs --help` 不打印用法，而是把不识别的 `--help` 当场景 id 前缀
筛选；筛选无匹配即回退「全部场景」，于是命令无输出挂起、后台已经在起真机（app + 跑批锁）。worker-stf1
实测：`--help` 挂起后被 TaskStop，node 主进程虽被杀，tauri dev 子进程树（pnpm → tauri.js → vite:1430 →
lumir）成孤儿残留，需手动按端口 + PID 清理才恢复 1430 空闲。

**根因**：flag 解析把任何 `--xxx` 当筛选参数，非法标志静默退化成「全量」；README 只记载 `--list` /
`--check`，`--help` 本就不是合法 flag。

**影响**：把「查用法」变成「起真机 + 抢跑批锁 + 写证据目录」——静默回退，与 REVIEW.md 第 13 条
（测试 / 套件污染真实环境、场景串场）同族。

**建议处置**：`run.mjs` 参数解析时，任何 `--` 前缀且不在 `{--list, --check, --keep-app}` 白名单内的标志
直接报错退出（退出码 2 并打印用法）；`scripts/acceptance/README.md` 补一句「无合法筛选参数时提示而非
全量」。属套件基建，本批只落账、未立项。

**证据**：`.tower/comms/findings/20261007-worker-stf1-improve-acceptance-run-mjs-help.md`（M374 现场）；
落点 `scripts/acceptance/run.mjs` 的 flag 解析与 README「一条命令跑完」节。

### 验收套件缺一个验证 ⌘-点击 DOM `metaKey=true` 路径的端到端夹具（M379 reviewer 建议，2026-10-07，low）

**是什么**：M379 给验收套件加了 `click` 的 `modifiers` 通道（真机侧按住修饰键再点），但套件里没有一个
可点击的**编辑器内链接**夹具来验证「⌘-点击跟随链接」走的确实是 DOM `metaKey=true` 那条路径——M144 当年
只能用视觉场景覆盖该路径（`tests/visual/scenes/render-link.spec.ts` 桩记录 `open_external_url` 的调用
目标）。M379 reviewer 在 r2 verdict 的 Decision 里留作**遗留跟进（不阻塞）**：另立 mission 补一个端到端
`metaKey` 语义夹具，不计入本次 verdict。

**为什么值得**：`modifiers` 通道的字面意义（按下 meta 再点）与产品路径真正依赖的 DOM 事件字段
（`metaKey`）之间没有端到端判据——通道存在不等于「⌘-点击」那条分支被真实触发；这是 REVIEW.md 第 6 条
（覆盖声明超出真实验证）的同族空白。

**建议处置**：本批**只落账、不立项**（任务书明确）。将来立项时的落点：在验收套件里加一个**可点击的
编辑器内相对路径链接** fixture，用 `modifiers: ["meta"]` + `click` 触发并断言走的是「跟随链接」分支
（而非普通点击的落点 / 选中），即把 DOM `metaKey=true` 这条语义钉成可 FAIL 的判据。

**证据**：`.tower/comms/reviews/review-feat-acceptance-suite-infrastructure-fixes-ac-reviewer-accinf1-r2.md`
Decision 末句「遗留跟进（不阻塞）：modifiers 的 DOM metaKey 端到端夹具另立 mission」；同批 r1 的
Decision 第 ④ 点（worker 披露「探针场景未入库」，建议另立跟进 mission）。对照既有条目「`click` 动作不支持
修饰键（M144）」（本文件「验收套件」节）。

### 共享 `CARGO_TARGET_DIR` 跨 worktree 复用旧测试二进制致假绿（M372 现场，2026-10-07，high）

**症状**：worker 在 wt-372 用 `CARGO_TARGET_DIR=<主仓>/src-tauri/target` 跑 `scripts/gate.sh quick` 时，
`src-tauri/tests/harness_runtime.rs` 的 `multi_call_round_groups_call_items_before_outputs` **首跑假绿**
——跨 worktree 共享 target 复用了旧测试二进制（两轮同一 binary hash，改过源码的测试没有被重编译）。

**根因**：target 目录里的既有产物同时是 cargo 的 fingerprint 依据。同一个 target 被两个 worktree
共用时，另一份构建的结果会让本轮判定「已是最新」而跳过重编译，于是 `cargo test` 跑的是旧二进制。

**影响**：`gate.sh quick` 的 `cargo test` 结论与本轮源码脱钩——改过源码的测试照绿，只有 reviewer
独立复跑才会红。这是「覆盖声明超出真验证」（REVIEW.md 第 6 条族）从工具侧被伪造出一个绿。
与 REVIEW.md 第 10 条（白屏陷阱）同源于「同一个二进制路径被不同上下文共用」，方向相反：那条是
二进制太新（flavour 被换掉），本条是太旧。

**建议处置**：按 REVIEW.md 维护规则并入既有条目，不另起——**已补进 REVIEW.md 第 12 条**（并行 worktree
的 target 纪律）的症状 / 根因 / 证据 / 防线：共享或复用 target 时，`gate.sh quick` 跑完核对该轮确实
重编译了 lumir 测试二进制（二进制 mtime 晚于本轮最早源码改动，或 `cargo test` 前 `touch` 目标源码触发
重编）。同一节点里 M155 建议的「批次内 target 纪律（跑完即删 target 并广播）入 REVIEW.md 第 12 条」
仍待 Alex 裁决，本次未动。

**证据**：`.tower/comms/findings/20261007-tower-bug-cargo-target-dir-worktree.md`（M372 实证）；
对照 REVIEW.md 第 10 条（提交 `791ff0c`）与第 12 条；`docs/backlog.md` 的「工具链与环境（待 Alex 裁决）」
节「tower 并行批次的磁盘预算」条记着「worktree 共享 `CARGO_TARGET_DIR`」这条长期候选——本例正是该
候选落地后的第一个现场，反过来给候选补了代价。

### worker 引门禁读数把 SKIP 并进分母，「8/9 PASS + SKIP 1」误读成全绿（M372 r1 现场，2026-10-07，medium）

**症状**：worker 报「`gate.sh quick` 8/9 PASS + SKIP 1」为全绿，实际 **1 FAIL**（`cargo fmt`）——
`GATE RESULT` 的分母是 pass + fail（`SKIP` 不计入），8/9 = 8 PASS + 1 FAIL；reviewer 独立复跑才抓住。

**根因**：结论的引用口径不统一——用「X/Y PASS」的自由复述替代照抄 `GATE RESULT` 原文行，而分母含不
含 SKIP 只在脚本里定义、报告里看不出来。

**影响**：假绿上报。若 reviewer 不独立复跑，一条真实 FAIL 会带着「本地全绿」的声明进入合并。

**建议处置**：**已落成 REVIEW.md 新条目**（口径与制品脱节族）——报告门禁结果时 MUST 照抄
`GATE RESULT` 原文行并附退出码，「X/Y PASS」不得脱离分母口径引用。

**证据**：`.tower/comms/findings/20261007-tower-improve-worker-skip.md`（M372 r1）；分母口径见
`scripts/gate.sh` 的 `GATE RESULT: ${pass}/$((pass + fail)) PASS（SKIP ${skip}）` 行。同一 mission 的
第二起门禁读数不可靠事件见本节「共享 `CARGO_TARGET_DIR` 跨 worktree 复用旧测试二进制致假绿」条。

### live `done` 事件用固定哨兵串表成功，前端据它判成功 / 失败（M368 备案，2026-10-07，low）

**症状**：harness live 路径上，成功行的参数摘要来自 `started` 事件的 summary，而 `done` 事件成功时
summary 是固定串「成功」——前端必须靠这个哨兵串判成功 / 失败，再换成参数摘要（M368 按前端哨兵实现，
并在注释里标明）。

**根因**：同一条成功语义有两条产出路径各判一次。M367 已把 `panel_summary` 的形状落进持久化路径
（成功 = 参数摘要 / 失败 = 状态·错误码），但 live 的 `done` 事件没有复用同一份，前端只能按字符串猜
——REVIEW.md 第 8 条「同一语义两处真源」的**跨层形态**。

**影响**：Rust 侧若改动成功摘要的字面，前端会**静默**改判成功 / 失败，没有门禁会红。当前实现正确、
无用户可见缺陷，属维护隐患。

**建议处置**：**不另起 REVIEW.md 条目**（单次、low、无已观测的假绿 / 不可逆；且 finding 自述为
第 8 条口味）——已把本例作为第 8 条的第 4 个现场补进该条证据，并把防线从「仓内的表」扩到「跨层传递
的语义」。修法另立小 mission：Rust 的 `done` 事件 summary 直接发 `panel_summary`（与落盘同一份），
前端删掉哨兵判断；需与动 `src-tauri/src/harness/turn.rs` 的 mission 错开。

**证据**：`.tower/comms/findings/20261007-tower-improve-live-tool-done-panel-summary.md`（M368
worker-trr1 备案）；落点 `src-tauri/src/harness/turn.rs` 与 `src/harness-panel.ts` 的 tool 行渲染。

### 在途停止丢掉该轮的 reasoning 回放项：是否触发 400 未实测（M369 登记，2026-10-07，medium，需真 API 才能定性）

**症状**：M369 把停止接进 SSE 读循环后，「流式期间点停止」会提前收流，而 reasoning 回放项随
`response.output_item.done` / `response.completed` 才到达——该轮 assistant 消息因此不带 reasoning 项入
input。

**根因**：改动前停止只在 `complete()` 返回后判到（那时整条响应已读完、reasoning 已在 `TurnOutput` 里），
`abort_turn` 收口仍把 reasoning 原样入 input（M306 纪律完整）；改动后流式期间 break 读循环，返回的
`TurnOutput` 通常没有 reasoning 项（mock 路径例外：fixture 的 reasoning 字段在分片产出之前就落进
output），`abort_turn` 把部分正文入 input 时不带 reasoning。

**影响面与不确定性**：影响真实 deepseek thinking + tools 场景。若下一轮请求因缺 reasoning 被拒
（400 `The reasoning_text in the thinking mode must be passed back to the API`），表现是「停止后继续
提问报错」。**但 M360 的逐项变异实测显示那条 400 的触发条件是项序（`function_call` 与输出交错），
而非缺失 reasoning；且中断轮的 assistant 消息不含 `function_call` 项（未执行的调用不压栈）⇒ 是否
真会触发 400 未实测**——mock 复现不出，需真 API 才能判定。

**建议处置**（供裁决，均超出 M369 scope）：① 真 API 实测一次「思考中停止 → 再提问」路径，据此决定
是否算缺陷；② 若算：在 `abort_turn` 里对「无 reasoning 项的部分轮」不发 reasoning 就从 input 撤掉该轮
assistant 消息（但 M348 的语义与既有集成测试钉住「已产出文本入 LLM 侧历史」，改动面会外溢）；③ 或按
已知边界记录在案。**未实测前 MUST NOT 当缺陷修**。

**证据**：`.tower/comms/findings/20261007-worker-sts1-improve-reasoning-provider-backlog.md`（M369，
worktree wt-369）；`src-tauri/src/harness/llm.rs` 模块头的「真流式与在途停止」节已就地登记这条边界
（含「未实测」字样），指向本条；落点 `src-tauri/src/harness/llm.rs` 的 `parse_sse_reader` 与
`src-tauri/src/harness/turn.rs` 的 `abort_turn`。

### `vault-open-ignore-set` 归档件的 5 处未完成项（M327 归档对账，2026-10-05，medium）

**是什么**：change `vault-open-ignore-set` 已归档（`openspec/changes/archive/2026-10-05-vault-open-ignore-set/`），
其 `tasks.md` 勾 38/43，**5 项如实保留未勾**（其中 8.4 已于 2026-10-12 核销，见下）。归档评审（节点 2）时 Alex 已批准整体，这些未勾项是记录在案的缺口，**MUST NOT 读成已覆盖**；它们的就地注记在归档件 `tasks.md` 顶部「归档对账」块与各未勾项下。

**3 类在办 + 1 类已核销**（对应归档件 5 个未勾项：7.2 / 8.3 / 8.4 / 9.3 / 10.4；按严重度）：

1. **7.2 / 9.3 的 ①②③⑤：真机反向验证（先红后绿）未跑（medium）**——`#[command(async)]` 的反向验证
   （临时摘掉它重跑场景 67，「打开段内界面可响应」应 FAIL）未做；9.3 的 ① ② ⑤ 同样未跑（只做了第 ④
   条读数通道）。「绿」的一侧在档（M296 场景 67），缺「红」的一侧。**这是本 change「验证独立于实现」
   的最后一环**——M292 的 11 组先红后绿都落在单元/集成层，替代不了真机判据。
2. **10.4：视觉门禁未跑（medium）**——本 change 触到 `src/tree.ts` 的树行 / 展开行为面，但
   `bash scripts/gate.sh visual` 未在实现/验收批执行（M292 的 worktree 缺 `tests/visual` 依赖、
   `tsc-visual` 在 quick 里 SKIP；M296 只跑真机）。**本条是 M327 归档对账时新暴露的**：M296 的报告与
   本文件「批次报告索引」的 M296 条只登记了 8.3 / 8.4 / 9.3，未提 10.4。
3. **8.3：真形状读数复采部分完成（low）**——release harness 已在本实现上跑通两次（Rust 侧合计
   **82.3 / 81.4ms**，`test-results/m296/rust-harness-release.txt`，与 M283 时代同形状 92–107ms 同量级
   ⇒ 无回退），但 **166,626 文件量级的「收窄后残余」档未重建** ⇒ change 的 `design.md` §1 的 **65.8ms
   仍是 M289 的手工收口数，不是本实现的实测**。
4. ~~**8.4：Alex 本机 grep 四条读数（medium，需 Alex）**~~ **已核销（2026-10-12，Alex 裁决）**：原话「grep `~/.config/lumir/logs/*.jsonl` 这一条没有输出，估计路径已经过期了（后续迭代改了路径），直接销掉吧。」——该读数动作随日志路径行进而失效，不再跟踪（本文件「待 Alex 裁决」区的同名一格同批移除，两处核销记录一致）。

**证据**：归档件 `tasks.md`（7.2 / 8.3 / 8.4 / 9.3 / 10.4 五条的就地注记）；本文件「批次报告索引」的 M296 条；
`.tower/comms/reviews/review-feat-vault-open-ignore-acceptance-m296-reviewer-acceptance-m296-r2.md`
（r2 复核明确列 8.3 收窄后残余档 / 8.4 Alex 本机 / 9.3 ①②③⑤ 为未完成项）。

**建议处置**：7.2 + 9.3①②⑤ + 10.4 可并成一个小验收 mission（真机反向验证 + `bash scripts/gate.sh visual`
在触到 `src/tree.ts` 的当前 master 上跑一次）；8.3 需要重建 166,626 文件量级的 fixture（成本高，可只做
「残余档」合成复采）。

### ~~真机验收 4 项持续失败（31/47/49/52）：2026-10-02 sweep 起同现，非 pane 化引入（M319 现场，2026-10-04，medium）~~ **已核销（2026-10-04，M323/M324/M325 全部合并，核销记录见「已核销」区）**

**症状**：全量真机验收 77/81 PASS，4 项 FAIL 且单跑复跑仍红（非 flake）：
31-code-variable-highlight（「md 模式文档逐字节未变」判红——标题 caret 显露态随光标行变化，断言与光标位置耦合）、
47-file-tree-context-menu 与 52-dir-rename-expand（右键菜单→「重命名」后行内输入框不出现，两场景同根）、
49-vault-switch-feedback（装载指示未退场 + vault 未回 A，等待用固定时序而非终态）。

**证据与定性**：与主仓 `test-results/acceptance/2026-10-03/summary.md`（2026-10-02T19:52Z 全量 sweep，PASS 75/FAIL 4）**同一集合**，早于 pane 化合并（fc6f489）——预存失败。M319 现场记录：finding `.tower/comms/findings/20261004-worker-pane-keybindings-m319-bug-4-31-47-49-52-sweep-m319.md`、wt-319 复跑 steps.md。

**影响**：不挡 pane 化；但「全量套件跑绿」的验收标准无法满足——**修好前 dogfood 全量验收的通过线显式扣除这 4 项并保留对照**（tower 已采纳为 interim 口径）。

**建议处置**：立项分别修——31 断言前把光标移回中性行；47/52 查行内重命名输入框不出现（菜单命中/焦点/时序，同根修一处）；49 改用 waitFor 终态。修好后恢复「全量绿」口径。

### 场景 49「指示此刻在场」断言存在假红时间窗（M325 现场，2026-10-04，low）

**症状**：`49-vault-switch-feedback` 的「点 A 行后立即快照」步断言 `has: AXProgressIndicator`（点击瞬间指示在场）。该断言依赖 AX 快照恰好落在装载窗口内——快照来晚（装载已完成、指示已退场）时正向断言落空报红。2026-09-28 因此假红过一次；M325 四跑均 PASS 未动它。

**定性**：失败模式经 M325 reviewer 核实是**假红方向**——它不会掩盖真 bug（指示若从不在场，装载窗口内的快照照样红）。

**建议处置**：另开 mission 收口——改法需要更大的观察窗或探针通道（例如轮询「指示曾在场」而非单次快照），属套件判据形态调整，不是产品缺陷。证据：review `.tower/comms/reviews/review-feat-fix-acceptance-49-vault-switch-feedback-reviewer-fix-acceptance49-m325-r1.md` findings 节。

### 验收套件 `press_key` 键名 DSL 没有 `-` 的拼法（M324 现场，2026-10-04，low）

**症状**：`press_key(keys="-")` 报 `error: empty key DSL`；键名表里有 `minus`，但 `keys` 动作的「整串可打印字符」门会把含 `minus` 的整串降级为盲发无重试（REVIEW.md 第 11 条要求逐字符注入走「回读 + 字节未变才重试」通道）。任何需要键入连字符的测试数据（如带 `-` 的文件名）无法走可回读通道。

**影响**：M324 的两场景（47/52）已改用无连字符测试数据绕开，改名机制等断言语义不受影响。

**建议处置**：finding `.tower/comms/findings/20261004-worker-fix-acceptance47-52-m32-bug-press-key-dsl-acceptance.md` 含修法建议——按 `PRINTABLE_KEY_RE` 分段注入，或给 DSL 补字面拼法 + README 补第三类不可达。立项时一并核「是否还有其他可打印字符无拼法」。

### harness 会话以 vault 根路径字符串为键，打开 vault 不做规范化：同目录两种拼写各建一个会话（M312 现场，2026-10-03，medium）

**症状**：harness 会话映射与 `harness:event` 标识都以 vault 根路径**字符串**为键，而 vault 打开
路径不做规范化——macOS 上 `/tmp/lumir-m102-acceptance` 与 `/private/tmp/lumir-m102-acceptance`
（`/tmp` 是指向 `/private/tmp` 的符号链接）会被当成两个 vault，各建一个会话。**切回同一个
vault 的另一种拼写时，那段对话在面板里消失**（内容仍在留存里——现行布局为
`<config_dir>/harness/sessions/<session_id>.jsonl`（每会话一文件，reshape-harness-session-recording
起；此前是按 vault 聚合的 `<config_dir>/harness/<sanitize(vault根)>.jsonl`），可经会话列举对照）。

**影响**：不丢数据；同一目录经两种拼写打开时对话历史在面板上「丢失」，且 M312 起事件流按
vault 标识过滤后，旧拼写 vault 的在途事件会被新面板整条丢掉。真实使用一直经同一路径拼写打开
不触发；验收套件现场因 `/tmp` 符号链接必然踩到（场景 78 的「切回 A 看得到自己的会话」判据
因此撤下并在覆盖边界节登记）。

**建议处置**：在**打开路径**（`src-tauri/src/commands.rs` 的 vault 打开/注册处）做路径规范化
（canonicalize / 解符号链接），让会话键、注册表键、事件标识共用同一份规范化路径。**不要只在
harness 侧规范化**——前端比较基准与事件标识会变成两种拼写，整轮事件反被过滤丢掉（worker
现场论证见 finding）。修完后把场景 78 撤下的「切回 A」判据补回。

证据：`test-results/m312/finding-session-key-现场/`（steps.md 判红、AX dump、JSONL 文件名）；
finding `.tower/comms/findings/20261003-worker-harness-vault-m312-bug-harness-vault-vault.md`。

### `scripts/visual/run.sh --update <filter>` 无法按 spec 过滤：参数被吞两级（M304 登记，2026-10-03，medium；**已核销**：M310，merge `25f7f37`，2026-10-03）

**症状**：① `run.sh --update m149-tabs` 展开为 `playwright test --update-snapshots m149-tabs`，
新版 Playwright（153）的 `--update-snapshots [mode]` 可选值把过滤器吞成 mode 参数，报
`argument 'm149-tabs' is invalid. Allowed choices are all, changed, missing, none.`，退出码 1；
② 加 `--` 分隔则被 pnpm 吃掉，过滤器失效，**全量 595 个测试跑一遍 update**。

**影响**：想「只更新指定基线」必然踩到；全量 update 会把当时在场的任何未批准差异一并刷成基线
（M304 本轮侥幸：默认 changed 模式只重写有差异的，未酿成漂移）——正是基线人肉裁决纪律要防的形态。

**建议处置**：update 分支绕过 package.json 的 update-baselines 脚本，显式钉 mode：
`pnpm --dir tests/visual exec playwright test --update-snapshots=changed "$@"`，头部注释补用法样例。

证据：M304 基线更新轮（2026-10-03）两次实跑；finding
`.tower/comms/findings/20261003-worker-harness-closeout-m304-bug-run-sh-update-spec.md`。

### harness 上下文节用 "\n\n[" 重解析，用户正文含该序列时压缩重注入串味（M302 转派，2026-10-03，low；**已核销**：M309，merge `80cb3ee`，2026-10-03）

**症状**：`run_turn_for` 把「提问 + 上下文节」拼成一条 user 消息（`{message}\n\n[当前编辑器上下文：…]`），
随后 `extract_section`（`src-tauri/src/harness/turn.rs:289-292`）用 `message.split("\n\n[").nth(1)`
把上下文节**从拼好的串里重新解析出来**，存进会话供自动压缩时重注入。用户提问或选区原文里只要
含有 `\n\n[`（正文里写一个左方括号段落就够），切分点就前移——存下的「上下文节」混进用户正文，
压缩续聊时这段串味文本被当作上下文节重注入新逻辑会话。

**影响**：不丢数据、不阻断对话；触发后压缩重注入的上下文节被污染（模型看到一段混杂文本），
属于静默的上下文质量问题。触发面窄（正文恰好含 `\n\n[`），探针期定为 low。

**建议处置**：不要从拼接后的串重解析——`assemble_user_message` 的调用侧本来就持有
`ContextBlock`，把 `context_section(&block)` 的产物作为结构化值直接传给会话（装配与存储
共用同一次生成），`extract_section` 整个删除；或最低限度改用 `rsplit` 取**最后一个**
`\n\n[`（仍是修补，不是根治）。

证据：M302 mission notes（2026-10-02 转派登记）；`src-tauri/src/harness/turn.rs:101-107`
（拼接）与 `:289-292`（重解析）。

### harness JSONL 文件名 sanitize 有碰撞面：/tmp/a b 与 /tmp/a_b 落同一留存文件（M302 转派，2026-10-03，low；**已核销**：M309，merge `80cb3ee`，2026-10-03）

**后续（2026-10-09 登记）**：本条描述的「按 vault 聚合 + sanitize 文件名」布局已随
reshape-harness-session-recording（M391 合并）整体退役——现行留存为每会话一文件
`sessions/<session_id>.jsonl`，sanitize 函数已移除。本条留作历史记录。

**症状**：会话 JSONL 留存路径 = `<config_dir>/harness/<sanitize(vault 根)>.jsonl`，
`sanitize`（`src-tauri/src/harness/jsonl.rs:88-100`）把路径分隔符与空格等非常规字符**统一**
映成 `_`——`/tmp/a b` 与 `/tmp/a_b` 因此得到同一个文件名 `_tmp_a_b.jsonl`（该函数自己的
单测 `sanitize_replaces_separators` 就展示了这个映射）。两个这样的 vault 的会话记录会
append 进同一份 JSONL。

**影响**：不丢记录（append-only 仍成立），但两个 vault 的问答、工具调用与批准决策交织在
一份文件里，归属混淆；留存是 ADR 0007 双向记录机制的本地一侧，审计口径因此被稀释。
触发需要 vault 根路径「只差被消毒字符」，日常少见，定 low。

**建议处置**：sanitize 改成可逆编码（如 `_` 自身先转义为 `__`、其余非常规字符按
`_xHH` 落下），或在文件名后段拼一小段 vault 根路径的哈希（人读前缀 + 机器唯一后缀），
二选一；改完给 `sanitize` 补一条「碰撞对」单测（`/tmp/a b` vs `/tmp/a_b` 必须不同名）。

证据：M302 mission notes（2026-10-02 转派登记）；`src-tauri/src/harness/jsonl.rs:88-100`
与 `:107-113`（单测展示的映射实例）。

### 整页基线捕获的是「首帧 chrome 态」，0.001 容差长期吞掉真实漂移（M297 现场发现，2026-10-01，medium；**已核销**：M311，merge `9cf6eb5`，2026-10-03）

**症状**：M297 动标题显露后 4 张整页基线报红；逐像素拆段发现 diff 有三段——标题行（本次改动，
约 500-600px）、顶部标签栏（tab 名称斜体变正体）、底部 modeline（语言 chip「zh」从无到有）。
后两段与本次改动**无关**：DOM 探针证明基线态与当前态在同一构建上都能复现，基线文件里存的是
**首帧**（tab 未 settle / `applyLanguage` 的语言 chip 还没出现）。base 上这两段 diff 约
840-990px，恰好贴着全局容差 960px（0.001×1200×800）之内，所以整页对比一直绿；本次改动叠上
标题行那约 500px 才把它们顶出容差。

**影响**：这几张基线对 chrome 段的判别力当前是 0；任何在其上新增 ≥(960 − 既有漂移) 像素真实
变化的改动都会撞红，且会被误判成「改动引入的回归」（M297 绕了一轮才定位）。与上面 M281 登记
的「整页基线在标签栏/标题栏文字行已陈旧」是同族不同段（M281 那条是 y15..27 的 40-420px，
本条是 tab 斜体 + modeline chip 两段 840-990px）。

**建议处置**：两步一起——(1) 短期：把这些整页基线统一重刷到「settle 后」的同一帧（按场景逐个
跑、逐个过目）；(2) 结构性：给视觉 harness 的截图入口加一条「chrome 就绪」门（等 `applyLanguage`
落地或断言 `.modeline-language` 可见后再拍），否则首帧捕获随加载时序漂移、每次都被容差吞掉。
容差本身不建议在这条里调。

证据：`.tower/comms/findings/20261001-worker-heading-reveal-m297-bug-chrome-0-001-960px.md`。

### m132-emacs-keys 的 ⌃V/⌥V 翻屏在全量负载下 flake（scrollTop 读到 8 而非 0，poll 5s 超时；M288/M298/M299 三次实证，2026-10-01，medium；**已核销**：M311，merge `9cf6eb5`，2026-10-03）

**症状**：`tests/visual/scenes/m132-emacs-keys.spec.ts:241` 的
`expect.poll(scroller.scrollTop).toBe(0)`（⌥V 翻回顶部）在 `gate.sh visual` 全量跑时偶发判红，
失败读数恒为 Expected 0 / Received 8；单跑该条或该 spec（14/14）必绿。三次现场：09-28 wt-288
（M288 修前构建上同断言同读数）、10-01 M298（tip 0d3b13d，589 passed / 1 failed）、10-01
M299（同断言同读数，连续三次）。与任何产品改动无因果（该场景文档 `LONG_DOC` 无任何标题，
M299 只改标题 fontSize；M298 只碰 CSS hover 层）。

**载荷假说（未坐实）**：失败只出现在全量跑，且同时段常有其他 worktree 在跑自己的全量套件；
CPU 争用下 CM 滚动/测量循环变慢，5s poll 预算不够。失败时的页面快照显示编辑器正常、光标在
首行——行为大概率对、超时预算被吃掉。**这是假红**，会把无关 mission 的本地门禁染红，每次代价
是整轮 8 分钟重跑 + 二分定位。CI `visual.yml` 只跑结构断言，本条只在本地暴露。

**建议处置**：给这条 poll 一个与「界面真静止」同源的判据而非固定 5000ms——或把预算提到覆盖
全量负载的档（如 15000ms），或 poll 前先等一次滚动收敛。两个 finding 给的两个具体方向：
(a) 判据放宽到「落在一屏内容差」+ 保留「光标没动」的严格断言承担区分度；(b) 保留严格判据、
提预算、失败时报读数。**不建议**把期望放宽成「接近 0」吞掉回归（REVIEW.md 第 3 条同族），也
不建议改真机语义——判别层在真机套件，改口径前先确认全量负载下 8px 的来源（滚动条 gutter /
平滑滚动残余步进两种候选）。同时评估其余固定短 timeout 的 poll 是否同病。

与既有条目 `docs/backlog.md`「记录在案」段的 m132 scrollLeft 条目不是同一条（那条是
`scrollLeft + clientWidth >= scrollWidth - 1` 判定必误红）。

证据：`.tower/comms/findings/20261001-worker-zoom-heading-m299-bug-m132-v-v-v-scrolltop-8px-poll-5s.md`、
`.tower/comms/findings/20261001-worker-block-hover-m298-bug-m132-emacs-keys-v-v-flake-scrolltop-8-0.md`。

### `.tab-menu-item` 选择器是死代码，且有门禁断言在验这条无效果规则的原文（M300 现场发现，2026-10-01，low）

**症状**：`src/style.css` 为「两处菜单共用皮肤」写了 `.ft-menu-item, .tab-menu-item` 选择器对，
但标签菜单的项元素只带 `ft-menu-item` 类（`src/tabs.ts` 的 `TabContextMenu.render()` 里
`el.className = "ft-menu-item"`），全仓没有任何元素带 `tab-menu-item` 类——四处
（style.css:1979/1992/1998/2016）的那一半永远不匹配（REVIEW.md 第 9 条同族）。更值得记的：
`tests/visual/scenes/tab-menu.spec.ts:356-360` 的 eink 用例断言的是规则**原文**里同时出现
`.tab-menu-item.is-active` 与 `.ft-menu-item.is-active`（子串断言），对「共用皮肤真的生效」零
区分度（REVIEW.md 第 1 条同族）；同文件里两条 `toHaveCSS` 才是带效果的断言。

**影响**：无用户可见症状。风险在维护：改皮肤的人按 `.tab-menu-item` 改完发现不生效，或新增第三
处菜单时把类名写成 `tab-menu-item` 而丢掉皮肤。

**建议处置（二选一，一次做完）**：(1) 推荐——删掉四处死选择器半边，只留 `.ft-menu-item*`，把
tab-menu.spec.ts 的原文断言改为断言 `.ft-menu-item.is-active` 生效，并在 `src/tabs.ts` render()
处补一句「项元素沿用 ft-menu-item 共用类名，MUST NOT 另起 tab-menu-item」；(2) 给标签菜单项
加 `tab-menu-item` 类并对齐选择器。归属建议：一次小的 UI 皮肤卫生 mission，不动行为、基线应零
变化（若基线有变化，说明死选择器其实在生效，要重判）。

证据：`.tower/comms/findings/20261001-worker-tab-reveal-m300-bug-src-style-css-tab-menu-item.md`。

### 增量建图：暂缓（M283 登记，2026-09-28）

**结论**：`build_graph` 的持久化缓存（mtime/size 比对，只重读变更文件）**本阶段不做**。

**当时的读数（release 直测，复刻真实形状的合成 vault：2142 文件 / 426 目录 / 1341 md / 6.7MB）**：
`scan_workspace` 中位 **10.6 / 13.0ms**、`build_graph` 中位 **81.5 / 94.4ms**（两次独立运行；harness：
`src-tauri/tests/vault_open_readings.rs`，`cargo test --release --test vault_open_readings -- --ignored
--nocapture`）。与 M154 在同一真实 vault 上的 14.0 / 111.2ms 同量级。

**理由**：收益上限 = 消掉这 81.5–94.4ms 里的读盘部分（`scan` 10.6ms 仍必须做——要知道什么变了就得枚举），
而代价是引入缓存键、失效条件与跨会话一致性（M265 §四-1 判定「真实 vault 远未到值得上缓存的规模」；
M154 的 737ms 出现在 45MB md 的 4× 合成规模，不是当前档）。它改不到「几秒」这个量级——「几秒」的那段
是会话恢复（见 change `vault-switch-restore-perf`）。

**若要做，优先局部优化**（M154 §7）：`read_text_file` 每次经 `resolve_in_vault` 做**两次**
`canonicalize`（`src-tauri/src/fs_io.rs:262,271`），1341 个 md 上 `canonicalize(root)` 是 1341 次冗余
系统调用。**同一个 harness 测了这条的上限：外提 + 批量读的复刻实现 55.7 / 61.7ms 对生产复刻 81.5 /
94.4ms ⇒ 收益 ≈26–33ms**，而不是 M154 当时估的 ≈45ms（那时用的是纯裸读对比，没有算 fs 缓存与 vnode 命中）。改动面是
一处调用层重构、无新状态，但**必须自带逃逸校验**（`resolve_in_vault` 的符号链接分支被 6 个既有测试
钉着：`resolve_rejects_escape_and_absolute`、`resolve_rejects_symlink_escape`、
`scan_does_not_follow_symlink_loop`、`scan_does_not_expand_external_symlink`、
`trash_refuses_vault_root_reached_through_symlink`、`resolve_new_rejects_escape_bad_names_and_collisions`）。
裁决点 2 的口径是「`vault_load_open` >250ms 才纳入」，实测 92–107ms（scan + build_graph，不含 watch/IPC）
⇒ **本次不纳入**，账记在这里。

### 树 DOM 虚拟化：否决（M283 登记，2026-09-28）

**结论**：不做。**否决依据是代码结构，不是估算**（M265 §四-2 的建议落点）：

- `renderRow` 只由 `mountNode` 调用（`src/tree.ts:398`）；
- `renderAll` 只对**根级**子节点调 `mountNode`（`src/tree.ts:457`），目录子节点仅在该目录已展开时挂载；
- `setVault` 先 `expanded.clear()`（`src/tree.ts:712`）。

⇒ 切换路径上的 DOM 行数 = **根级条目数**（该 vault 根级 22–24 行），不是「主线程一次建出 8000+ 行」。
虚拟化的目标场景（展开一个几千项的大目录）在这个 vault 上也不存在（最大可见目录 22 项）。收益按代码
结构接近 0，代价是跨 capability 的高风险重写（滚动与坐标映射、选择与复制、树行自身状态）。真正的成本
只是给 2567 个条目建 `Node`/`Map`（O(n)，个位数 ms），随 M283 的 `vault_load_tree` 读数一并留档。

### vault 切换没有 perf 门禁端点（M283 登记，2026-09-28，待 Alex 裁决是否立项）

**现状**：`scripts/perf/` 只有 `cold-start` / `keypress-to-paint` / `memory` / `open-file` 四个端点，
**没有 vault 切换端点** ⇒ 切换的优化效果没有任何门禁能锁住（可被后续改动静默回退）。与「待 Alex 裁决」
冷启动恢复同步跑主线程那次改造（旧编号第 12 条，见「已核销」2026-09-18 条）同族。

**为什么不顺手加**：这是**性能合同语义的扩张**（ADR 0002 §6 的四条合同不含切换；新增门禁数字要先定
「绝对阈值还是相对回归」），不是加一个脚本。端点草案（合成真实形状 vault ≈2500 项 / 1341 md / 7MB +
40 标签会话；测「点击切换 → 目标 vault 就绪」的墙钟，并同记三段 `phaseMs`）留在 change
`openspec/changes/vault-switch-restore-perf/design.md` §6.4 与裁决点 4：**本 change 不新增**，另立 change
才做。可复用的现成件：套件的 `seed.bulkVault`（生成同形状的合成 vault，
`scripts/acceptance/lib/app.mjs`）与 release 读数 harness（`src-tauri/tests/vault_open_readings.rs`）。

**M283 任务 1.5 的真实 vault 读数已回填（2026-09-28，Alex 在本机自助读数）**：`vault_load_restore` 段
——改动前 **422 / 418 / 408 / 471ms**（09-27～09-28 早，四次切真实 vault），M283 合并后
**49 / 35 / 49 / 120 / 64 / 55ms**（六次）。⇒ **真实环境的恢复段从 ~420–470ms 降到 35–120ms**，与合成
形状 vault 的 **1182 → 20ms** 同方向；量级差异来自 vault 形状（真实 vault 的 per-tab 固定成本里含
随索引规模增长的那部分——链接解析 / 附件索引查询，正是 M283 `design.md` §1 标「未验」的那一项）。
**这条读数同时是本节的现场**：它只能靠人肉 grep `~/.config/lumir/logs/*.jsonl` 拿到，优化效果若被
后续改动静默回退，没有任何门禁会红。

### 三份 vault change 的归档顺序（硬依赖，M283 登记，2026-09-28）

`vault-switch-feedback` → `preview-tab-removal` → `vault-switch-restore-perf`，**顺序不可换**：
`vault-switch-restore-perf` 的 spec delta 有两条 MODIFIED，其基线正文现在分别落在那两份**未归档** change
的 delta 里（「装载的即时反馈」只在 `vault-switch-feedback` 里、「装载后恢复标签列表」由
`preview-tab-removal` 改写）。前者不先归档，`openspec archive` 会因「requirement 在 living spec 里找不到」
拒绝本 delta。**验收口径**：归档前跑 `npx --yes @fission-ai/openspec@1.12.0 list` 确认那两份已从活跃列表
消失。

**已执行（M287 归档批，2026-09-28）**：三份按上式顺序归档完毕（`openspec/changes/archive/2026-09-28-*`），
两条 MODIFIED 的落地正文与各自最新一份 delta 逐字相等；另核了「后一份 delta 是否完整承接前一份」——
两条都成立（`装载后恢复标签列表` 的 M283 版把 M254 版的义务全部保留并加上「当帧建壳 + 内容按需」的
两段语义，只丢了两处沿革注记）。

### md 行含 inline widget 时的高度表差（M281 现场发现，2026-09-27，medium）

**症状（新可见面）**：md 的行号 gutter **在场期间**（`always` 档，或 `on-demand` 档下跳转输入条打开时）——**图片 /
行内公式所在的那一行之后**的行号整体低约一个文字盒（实测 Δ18px）。行号与它自己的行对齐，但下一行
起就偏。图片行的行号本身不动（那一行是「模型差值」的发生地，不是受害者）。
默认档（`on-demand`）下 md 平时没有行号列，所以这个差值只在输入条打开期间可见。

**读数（chromium 1200×800，`tests/visual/scenes/m281-goto-line.spec.ts` 的探针现场）**：
320×120 的 SVG 图片行（`.cm-lp-image`，`margin: 6px 0`，`display: inline-block`）：

| 口径 | 该行高度 |
|---|---|
| CM 的 `viewportLineBlocks`（高度表） | **165.5** |
| DOM 的 `.cm-line` rect | **147.5** |

`view.contentHeight` = 297.19，DOM 侧对应高度少 18px（差值 18 = 该行的文字盒高 33.5 与
`max(widget, 文字盒)` 之差的一部分，实测三次都稳定，不是测量时序）。

**根因（未坐实到源码，机制候选照录）**：CM 的 `viewportLineBlocks` 对**含 inline replace widget
的复合行**把高度算成「widget 的 border-box（含 margin）」+ 「该行的文字盒高」，而浏览器把两者排进
**同一个行盒**（重叠，不叠加）。表格（block replace widget，`cm-lp-table-slot`）没有这个问题：
实测 CM 的 73.5 与 DOM 的 73.5 逐值相同。frontmatter 覆盖的行没有行号是另一码事（aria-hidden 之外
的块级替换，见 change design §1.4）。

**这不是本 change 引入的（已用改动前的构建反证）**：`git stash push -- src/` 后重建再测同一 fixture，
`viewportLineBlocks` 仍是 165.5、`contentHeight` 仍多 18px（当时没有 gutter，所以肉眼不可见）。
⇒ **gutter 只是把 CM 自己的模型差显形了**；同一差值今天还影响一切按 `blockTop/height` 换算的路径
（`posAtCoords` / `lineBlockAtHeight` / 阅读位置捕获），只是那些路径的判据都没有覆盖「图片之后的行」。

**复现**：在 md 文档里放一张会渲染成功的图片，跳到图片之后的任意行，比较 `.cm-lineNumbers`
的 gutter 元素顶边与该行 `.cm-line` 的 rect 顶边（差值 ≈ 18px）。

**建议处置（不在 M281 范围内，另立 mission）**：先判定 CM 的高度模型能否被 widget 形态影响——若把
「图片独占一行」渲染为 **block replace widget**（像 frontmatter / 块级数学那样带 `-outer` 包装 +
padding 间距）能让模型与 DOM 重合，那就是最小改动（顺带修掉 `posAtCoords` 在此处的 18px 偏差）；
否则要在 CM 侧找测量入口（`measureVisibleLineHeights` / widget 高度测量）或接受该偏差并把
gutter 的对照口径改成「相对 CM 模型」——后者只是把缺陷写进断言，不建议。
证据与探针读数：`.tower/comms/findings/20260927-worker-impl-goto-line-bug-md-inline-widget-cm-dom-m281-gutter-18px.md`。

### 整页基线在标签栏 / 标题栏文字行已陈旧（M281 现场发现，2026-09-27，medium）

**症状**：**改动前的**构建与入库整页基线在窗口顶部那一行（标签栏文字行 + 标题栏标识块，bbox 全在
`y 15..27`）就已经差 **40–420px**——16 张整页基线里 14 张如此，而 `0.001 × 1200 × 800 = 960px`
的容差把这些全吞了。⇒ 这批基线在像素层早已陈旧，门禁却一直绿（假绿风险，AGENTS.md 的视觉门禁
卫生条同族）。

**发现方式**：M281 的基线过目包用 tolerance=0 的探针把全部像素断言逼出 diff 产物，另跑了一遍
**改动前**的构建做对照，于是分离出「本 change 的足迹（A）」与「改动前↔入库基线（B）」两个差值。

**与本 change 的关系**：**无关**。B 是在改动前的构建上测的，且 bbox 全在窗口顶部那一行（本 change
只动正文列左侧的 gutter 与 modeline 上方的浮层）。M281 的二次改判后基线不再重拍，因此这条**继续
挂账**：下次有人重拍这批基线时会顺手把它写进基线，届时若想先分清「历史遗留 vs 真回归」，需单独
复现一次（用改动前的构建与基线对照）。

证据：`.tower/comms/findings/20260927-worker-impl-goto-line-bug-y-15-27-40-420px-0-001.md`；
量具 `test-results/m281/baseline-review/{baseline-report.py,diff-region-analyze.py}`。

### gutter 的 1px 右缘声明被同文件规则关掉（M281 现场发现，2026-09-27，low）

**症状**：`src/editor.ts` 的 baseTheme 给 `.cm-gutters` 声明了 `border-right: 1px solid var(--border)`，
但同文件核心扩展列表里的 `EditorView.theme({ ".cm-gutters-before": { border: "none" } })` 把它关掉——
两个模式实测 computed `border-right-style` 都是 `none`。声明与生效不符；change `goto-line-command`
的 design §5.2 第 3 条「md 去掉右缘」是拿「code 模式有那条线」当前提写的，前提实际不成立。

**影响**：文档与注释让读者以为共享模式下有一道 gutter 分隔线。若将来有人「修好」它，code 模式的
整页基线会变（有意的视觉改动，要 Alex 过目）。M281 的 md 规则不依赖这条线（它显式 `border: none`），
故本 change 不受影响。

证据：`.tower/comms/findings/20260927-worker-impl-goto-line-improve-gutter-1px-basetheme-cm-gutters-before-border-none-none.md`。

### 验收 vault 根下的非 `.md` 残留不被 `resetVault` 清理（M296 现场发现，2026-09-29，low）

`scripts/acceptance/lib/app.mjs` 的 `resetVault()` 每次运行只清 vault 根下的 **`.md`** 与**目录**，
因此场景经 `fixtures:` 带进来的非 `.md` 产物会**跨场景、跨天留着**。实测：跑完 M284 的全量批之后
`/tmp/lumir-m102-acceptance` 根下留着 40+ 个这类文件，其中 `.gitignore` / `.gitattributes` /
`.secret` / `x.jsonc` 来自场景 46 的 fixture 列表，`huge.log`（**53MB**）来自场景 42，
`aaa` / `aaa-nonmd.txt` 来自场景 42 的 `vaultWrite`。

**当前影响：无**（每个依赖这些文件的场景各自用 `fixtures:` 重新拷一份；`.gitignore` 残留声明的
目录届时都不存在，规则是惰性的）。**但它是一条会咬人的口径**：新场景若「看到某文件在场」就据此
断言（而不是自己声明 `fixtures:` 或 `vaultWrite` 造），会在**换一台机 / 清一次 `/tmp` 之后**变成
随机红——正是 REVIEW.md 第 4 条（写死会跨天复用的产物路径）的同族。M296 已把这条口径写进
`resetVault()` 的注释与套件 README 的隔离表（canonical 居所），并确认场景 67 新增的 `.gitignore`
探针属同一类残留（它已在场景的「覆盖边界」里如实登记）。

**触发条件 / 修法**：值得单开一个小 mission——把 `resetVault()` 改成「先清空 vault 根下的**一切**
条目（文件 + 目录），再拷 `fixtures/` 的 `.md`」。风险面是全部 69 个场景（`fixtures:` 拷进来的
非 `.md` 文件在起 app 之前就位，语义不变），因此需要一次全量真机批来收口，不顺手做。
同族：`resetSecondVault()` 同样只清 `.md`（第二个 vault 的 fixture 目前只有 `.md`，暂无实害）。

### 预览机制移除的遗留项（M254 登记，2026-09-27）

`preview-tab-removal`（M254）把预览标签机制整体移除了：行为面（单击树文件一律开正式标签、
`is-preview` 斜体删除、「首次输入即固定」的提升监听删除）+ 数据面（`EditorSession.preview` 字段与
`src/vault-switcher.ts` 的入盘过滤删除，tower 2026-09-27 批准扩 scope）。落地后只剩两处**不在本批
改动面内**的残留，都不影响行为：

1. `src/save-controller.ts` 的 `OpenIntent` union（约 :50-59）仍写着 `"current" | "preview" | "pinned"`。
   装配层已加显式适配（`src/main.ts` 的 openFile 包装里「非 "current" 一律按 "new" 处理」，附注释），
   因此行为正确；但 union 本身仍保留两个已无意义的取值，`preview` 这个名字会继续误导读者。
   收窄它是一次独立的小改动（union + 注释；调用点两条都只传 `"current"`，可顺带考虑删掉这个参数）。
2. `src/bindings/VaultSession.ts` 的文档注释仍是「有序的 vault 相对路径（固定标签；预览标签不入盘，
   design §4.2）」。它是 ts-rs 从 Rust 侧 doc comment 生成的产物，而 doc comment 的源在 `src-tauri/`
   （本批的改动面之外）。改法：动 Rust 侧注释 + 重导出 bindings（`cargo test` 会重写 `src/bindings/**`）。
   **同一句错误自述还留在** `openspec/specs/vault-workspace/spec.md` 吗？——没有：那条已由
   `preview-tab-removal` 的 MODIFIED delta 改掉（归档后 living spec 同步）。

**触发条件**：任一后续 mission 碰到这两个文件中的任何一个时顺手做掉（第 1 条无行为变化、无需真机；
第 2 条要跑一次 `cargo test` 重导出）。

### 路径拼接同形副本（M258 登记，2026-09-27）

`src/main.ts:582` 有一处「父路径 + 末段名」的拼接逻辑，与 M258 在 `src/tree.ts` 新增的
`relativePathOf`（该拼接的规范居所）是同形副本（REVIEW.md 第 8 条同族）。M258 不持有
`src/main.ts` 的 scope，未就地收口，已在 tree.ts 注释与 mission 报告登记（reviewer 复核为 P2、
不阻塞合并）。**触发条件**：任一后续 mission 改到 `src/main.ts` 该区域时，把 :582 的拼接换成
调用 `relativePathOf`，删掉副本。

### math/mermaid 显露判定未接按压快照（M259 登记，2026-09-27）

M259 修的「按压期间落点判定跨布局」缺陷类在 `src/preview/math.ts:315`、`:359` 与
`src/preview/mermaid.ts:395` 原样存在——这三处的显露判定仍读**活选区**而非按压快照，同样可能在
点击/按压期间因布局位移产生落点漂移。M259 未改它们（不在条款适用面内、无对应验收场景），只落了
finding（`.tower/comms/findings/20260927-worker-bold-click-bug-math-mermaid-m259-livepreview.md`）。
**触发条件**：任一后续 mission 动 math/mermaid 显露逻辑，或 Alex 在公式/图表上点出同类误选时，
把这三处改读 `reveal-gate.ts` 的按压快照（M259 已提供机制与属性测试模板）。

### M256 全量回归现场（2026-09-27 批次收尾）

M256（分支 `feat/final-acceptance-regression-sweep-m256`）跑了**全量真机套件**：57 场景，串行独占
（`node scripts/acceptance/run.mjs`，`caffeinate -dimsu` 包住，1430 专用口，1420 全程未碰）。
读数 **49 PASS / 8 FAIL**；逐场景结论与耗时见「待真机验收」的 M256 一行索引与 git 历史（本文件的逐场景
总表已按体量红线压缩，`git log -p -- docs/backlog.md`），
证据 `test-results/acceptance/2026-09-27/`（git 外）。本节登记本批**新确认**的 finding；
M254 已登记的两条（`OpenIntent` union / `VaultSession.ts` 注释、套件索引重写）不在本节重复——
索引那条的**新现场**补写在了原条目里，`$vault2` 前缀吞噬已由 `8758756` 修好、无残留动作。

~~**M254 移除预览标签机制改了三条场景的前提（陈旧断言，需派活）**（medium）~~ **已修（M266：28 / 29 / 38 三条按现状对齐，真机 PASS；现场见「M266 陈旧断言清理」节）**：
`93bb24b` 删掉了「预览标签不入盘」的过滤（`src/vault-switcher.ts` 的 `sessionSnapshot`，注释自述
「全部**有路径**的标签都入盘」），于是**单击树文件打开的标签会进入下次启动的恢复集合**。三条场景
的判据建立在那条过滤还在的前提上，本批全部转红：
- `28-remember-reading-position` / `38-content-width-drag` 都断言「重启后没有标签（空 vault 引导
  在场）」。M254 之前单击开的文件是预览标签、不入盘 ⇒ 重启确实一个标签都没有；现在重启会把
  `toc-long.md` / `keys.md` 恢复出来（现场 `…/28-…/steps.md`、`…/38-…/steps.md` 的 AX dump：
  `AXTabGroup` 里那条 `AXRadioButton` 就是被恢复的标签）。
- `29-typography-and-zoom`：重启后 `do: open` 命中的是**已被恢复的同名标签**，而 `openFile` 对
  已打开的同路径短路（只激活、不新建），于是「全新装载」这条前提不成立、AX 渲染行快照是上一轮的
  ⇒「配置的 32px 让第 3 章挤出渲染行」判红。指纹很清楚：同一场景后面几步（先 `⌘W` 关标签再
  `open`）的同类断言**全部 PASS**。第二处红（末步「编辑器文档文本逐字节不变」）是同一条前提的
  下游，**未单独定位**（报告里 before/now 被截到 400 字，建议下一批在失败步补一次 `recordEditor` 对照）。
**动作**：三条场景改成不依赖「重启后无标签」（restart 前清会话文件，或把断言改成「恢复出的就是
本场景那一份」）。**这不是产品缺陷**——让全部标签入盘是 M254 已批准的改动。
**待 Alex 的产品面观察（不阻塞）**：单击树文件看一眼，现在会**永久进入下次启动的恢复集合**
（预览机制原有的作用之一正是「随手看看不留痕」）。若这个副作用不可接受，那是产品决策，
场景侧跟着改口径即可。

~~**M254 移除预览机制改了「文件切换后编辑器视图是否复用」（陈旧断言）**（low）~~ **已修（M266：lua / md 两段改成「先断言空查询、再重敲」，三段同形，真机 PASS）**：
`31-code-variable-highlight` 断言「搜索状态跨文件保留」（`⌘F` 后 `AXTextField = "limit"`）。
M254 之前单击树文件是预览意图，就地替换同一个标签（同一个 `EditorView`），CM 的 search state
因此存活；现在一律 `new` ⇒ 新标签 = 新视图 = 空查询。现场：`…/31-…/ax/05-*.txt` 里
`AXTextField (查找)` **没有 Value**（对照 `ax/03-*.txt` 的 `AXTextField = "limit"`），且标签栏同时
挂着 `.js` 与 `.lua` 两个标签（旧机制下前者会被就地替换）。**动作**：改断言（每个标签各自持搜索
状态是分标签编辑器的正常语义），或明确要求跨标签保留并当产品改动立项。

~~**`32-list-filter` 自 2026-09-25 起的那条红定位完毕：断言写死了 UI 不上屏的绝对路径**（low，陈旧断言；与「验收套件（M240 现场发现）」里 2026-09-26 那条同源，此处是定位结论）~~ **已修（M266：断言改成行节点判据 `AXStaticText (…`，真机 PASS）**：M217 裁决后
vault 列表行**不再显示路径**（`src/vault-switcher.ts:828-830` 就地注释：「路径次行按 Alex 裁决裁掉
（M217，gap 表 #12）：单行制收敛后路径不再上屏」），行文本是 `<显示名> <摘要>`
（现场 `…/32-…/ax/09-*.txt`：`lumir-m102-acceptance-b 还没有打开过文件`），绝对路径只在**不可用**
行里以「路径不可用：…」形态出现。因此 2026-09-26 登记的两个候选（「前置失败」/「真实回归」）
都不成立：`-b` 那一行在场且显示名正确（M252 的 `$vault2` 占位符修复 `8758756` 已在 master 生效）。
**动作**：把该断言改成显示名（或删掉），把「路径不可用」形态留给覆盖它的场景。

~~**套件：`button: right` 坐标通道取不到窗口截图 ⇒ 场景 47 / 50 整段 FAIL**（medium；M244 / M249 / M251 / M252 / M254 同族，M254 已落 finding，本条为收口登记）~~ **已修（M266：改读带截图的 `mode=full` 快照，见「M266 陈旧断言清理」节）**：现场错误逐条是
`取不到窗口截图，无法用 right 键在坐标上点击`（`scripts/acceptance/lib/execute.mjs` 的 click
右键分支），并级联出「找不到可点节点」与末端磁盘断言 FAIL。M254 的新证据（**同刻** KimiCU 自己的
`get_app_state(mode=full)` 能取到 1151×768 的图，窗口在前台、套件 `ensureForeground` 报「已取得」）
指向**套件侧取图路径**：`readAxForScreenPoint` 的重试条件只看 `window-local` + `windowBounds`，
**不检查 `ax.image`**。修法（M254 finding 的两条建议原样保留）：把 `ax.image` 并进重试条件，
或让坐标注入复用上一次 full 快照的 image。**不得当产品缺陷**：47 / 50 的右键链路退回 chromium 层
（`tests/visual/scenes/tree-menu.spec.ts` / `tab-menu.spec.ts`）。本批另记 47 的两条**次级**现象：
① 右键目标在视口外时套件按错因报错（`@122,1397`，窗口 1200×800）——已知边界（套件无 scroll 动作），
不是缺陷；② 两条 `do: keys` 步报 `press_key 失败：error: empty key DSL`（场景 YAML 里 `keys` 数组
非空、`--check` 通过，本地成因**未定位**，按原样登记供套件侧排查）。

**`open` 到不了视口外树行的预测被本批实跑证伪（41 / 42 全绿）**（low，口径订正）：
M251 的 finding 推断 `41` / `42` 的 `open: notes.txt`「机制上必然卡 60s」（该 finding 自己也注明
「本批未验证」）。本批两条**都 PASS**（51.3s / 33.2s）。现场：`41-…/ax/01-起点-txt.txt` 里
`notes.txt` 就在 `@15,380`（窗口 800 高），AX 里同时还有 `@15,-220` 这种视口**之上**的行，
而 `openFile`（`lib/drive.mjs`）只做「等 AX 里出现该行按钮 → AXPress」，没有任何滚动逻辑 ⇒
这一轮里该行**够得到**。**机制未坐实**：M251 那次为何够不到，本批留下的候选是「AX 快照被截断」
而非「行不在视口内」——本批所有 dump 都带 `truncated: true`，而 47 的 dump 里树只暴露了三行
（`menu-sub` / `.gitattributes` / `.gitignore`）。**结论按现状写**：M251 finding 里「AX 只暴露
可视范围内的行」这句至少不完整，别把它当成「41/42 必卡」的依据；**右键坐标路径**另有硬约束
（必须在视口内，47 的 `@122,1397` 报错即此），这条是坐实的。

**真机通道：单次 AX 快照往返在秒级、`mode=full`（带截图）更慢**（medium，M252 finding；本批旁证）：
M252 三次实测（43 个标签那轮读到的是装载完成态；把装载撑到 4.6s 后 `shot` 仍拍不到装载中的画面，
三张截图逐字节相同）。本批的旁证见下一条（43）。**动作**：README「已知边界」补一节——延迟量级 +
瞬时状态判据的写法（把窗口撑到数秒，或改用「状态变化前后两次读数差」这类不依赖绝对时刻的形式）；
`readAx` 返回值带读时刻并写进 `steps.md`。

~~**场景 43 的红换了一种成因，且本批未定位**（medium，需派活）~~ **已定位（M266：自动保存自身的 fs 回声被判成「外部修改」而暂停自动保存；已立 finding）**：M240 登记的红是「`do: key tab`
不落地」（那次场景走 Tab）。M249 已把 43 改成经 `[keys]` 绑到 `⌘J` / `⌘⇧J`，并在
`test-results/acceptance/2026-09-27-m249/43-list-tab-indent/` **PASS 过**——所以本批的红**不是**
M240 那条通道问题。本批现场（**连跑两次读数逐字相同**）：第一次缩进（`- bravo` → `  - bravoq`）的
**编辑器内已缩进**（`ax/04-*.txt` 的渲染文本是 `◦ bravoq`，`⌘Z` 后回到 `– bravoq`），但同一步之后
`sleep 2600` 再读盘仍是 `- alpha\n- bravoq\n`；同一轮里有序列表 / 引用内列表 / 嵌套列表三条同类
断言**全部 PASS**（都落了盘）⇒ 现象是「**命令生效、2.6s 内未落盘**」，最可能是注入 + 快照耗时
（上一条）把 2.6s 等待窗口挤穿，但**未坐实**（不能排除保存链路在该时点的真实问题）。**动作**：
下一批把该步等待加长到 6s 复跑一次，并读隔离配置的诊断日志（`document_save`）判定是窗口问题还是
保存问题；顺带修一处**判据强度**问题——紧随其后那条「一次撤销把整次平移还原（源文件回到
`- bravoq`）」在缩进从未发生时**恒真**（本批就是这么空过的），应先断言缩进已落盘、再断言撤销还原。

**会话恢复的「已跳过」提示把两种成因合成一句**（low，M252 finding）：`src/vault-switcher.ts` 的
`restore()` 用一个计数 `plan.skipped + (plan.open.length - opened.length)`，却只给 D108 的
「N 个文件已不在这个 vault 里，已跳过」——文件**还在** vault 里但打不开（类型不支持 / 编码非法）时
提示与事实相反（M252 实测：`notes.txt` / `nonmd-config.yaml` 就在盘上）。**动作**：deck 增/拆一条
（「不在 vault 里」/「打不开」分开计数与呈现），实现侧两处调用点同步改。

**过目包读数两套口径并存**（low，M251 reviewer 的观察项）：`test-results/m251/baseline-review/`
的 `pixel-diff.json` 用 worker 自写的计数器给 `overThreshold=84`，而 README 叙述的口径是 playwright
（threshold 0.2 下 62 额度内）与零容差探针（158px / ratio 0.0025）——两套数字并存时读者无法判断
该信哪个。**动作**：后续过目包统一用 playwright 读数，或显式标注自写计数器的口径与换算关系。

~~**归档不重写相对链接、目录深度 +1 无门禁**（low，M253 finding）~~ **已修（M409，2026-10-09：`scripts/openspec-links.sh` 落成并挂进 `docs-check.sh`，本地 `gate.sh quick` 与 CI `docs-check.yml` 同时继承；428 条相对链接全量 exists() 校验，含行内代码/围栏块/锚点/外链/裸占位词排除口径；反向验证 FAIL→PASS 闭环，现场 `test-results/m409-reverse-validation/`）**：`openspec archive` 移动目录但不改
制品内的相对链接；M150 修 17 处、M253 修 25 处（含 living spec 侧两处反向 −2 级，其一
`specs/ui-design-system/spec.md:11` 是**新建 capability 一出生就带死链**），早期批次
（`2026-09-05-*` / `2026-09-12-remove-threads-and-theme`）至今残留 6 处死链；`docs-check.sh` 明写
不校验 OpenSpec 侧、`openspec validate` 不查链接可达性 ⇒ 没有任何门禁会红。**动作**：
`scripts/openspec-links.sh`（遍历 `openspec/**/*.md`，对 `](相对路径)` 做 `exists()` 并逐条打印，
挂进 `gate.sh quick` 与 CI 的 docs-check 一路）；退一步的最低防线是把「归档后逐一核对相对链接
可达性」写进 `docs/process/openspec-workflow.md` 的批次收尾 checklist。

**M241 翻转 code 模式可编辑性后，living spec 仍断言「只读 code 模式」**（medium，M253 finding；
按 M150 的 retro change 形态另立一件）：`openspec/specs/keymap-commands/spec.md` 的三条 scenario
（`:130` / `:182` / `:795`）仍判「只读 code 模式」下 ⌘Z / 编辑键 / 缩进键「无事发生」，而
`editable-non-md-files` 已明确注册表文本类在 code 模式可编辑（`src/editor.ts:1480-1481` 就地注释）；
`openspec/specs/editor-live-preview/spec.md:5` 的 Purpose 与同文件 `:778` 的 requirement 直接矛盾；
另有 10 处 `只读 code 模式` 模式名失真（`editor-live-preview` 4 / `content-width` 3 /
`keymap-commands` 3）。第 1 类是**行为断言变了**，改写等于替 Alex 决定「code 模式还有没有只读形态」，
属语义裁决，需节点 1。同族提醒：M249 已把验收场景 43 的「只读时缩进无效」改成「不可达、不构成
覆盖声明」，同语义的 living spec 未同步（两处真源只改了一处，REVIEW.md 第 8 条）。

**restyle 归档件 §8.4（假绿防线反向验证）保留未勾**（low，M253 归档对账的如实登记）：
`openspec/changes/archive/2026-09-27-restyle-ui-tokens-v1/tasks.md` 的 §8.4「8.2 重建后人为删掉一个
可见元素、确认门禁 FAIL」未做，承接方 R4（M214）**已 abandoned**；等价动作只被 M246 的「为高危
小元素补元素级基线」部分代替（那解决的是「预算吞掉小变化」，不是「删元素后门禁确实会红」这条
反证本身）。**动作**：要么补一次删元素反证并留读数，要么把该条从「待做」改成「已知缺口、由元素级
基线承担」并写清理由——两者都要有人勾一下，不要留在归档件里当悬空的复选框。

**`slow_callback` 的 spec 口径未跟上 M252 的广义用法**（low，reviewer-vault-switch）：M252 在
`src/main.ts` 加了 `phaseMs()`，装载三段（`vault_load_open` / `vault_load_tree` / `vault_load_restore`）
超 250ms 也各写一条 `slow_callback`（与 `src/diagnostics.ts` 的 `sampleCallback` 同通道），而
`openspec/specs/diagnostics/spec.md` 的描述仍是「同步回调超 16ms」。**动作**：由 diagnostics
capability 的后续 mission 把描述改成「被采样耗时点（同步回调或异步阶段）超各自阈值即记一条，
`name` 区分族」，并注明两类阈值（16ms / 250ms）的来历。

**幂等复核的取块口径要剔块尾空行**（low，M255 reviewer 的观察项）：归档幂等按「delta 与 living
spec 同名 requirement 正文块 sha256 相等」判，而「截到下一 `### Requirement:`」这个口径会把
living spec 侧的**块尾分隔空行**一并取进来，于是两块 sha256 不等而实质内容相同（M255 实测：
diff 仅 `47a48 >` 一行空行；剔除尾随空行后同为 `68796fc7…`）。**动作**：后续同类复核把口径写清
（剔尾随空行后再比），执行记录里别写「逐字节相同」而实际用了不同的取块口径。

**白屏陷阱纪律的补充前提：`cargo build --features custom-protocol` 之前要先 `pnpm build`**
（low，本批现场）：worktree 里第一次跑 `cargo build --features custom-protocol` 直接失败——
`src/lib.rs:146` 的 `tauri::generate_context!()` 在 `frontendDist`（`../dist`）不存在时 proc macro
panic（`error: could not compile lumir (lib)`）。**顺序是先 `pnpm build` 再 `cargo build`**；
AGENTS.md 的白屏陷阱条目只写了「起实例前先 cargo build」，后批照抄时别漏这一步。

### M266 陈旧断言清理与套件右键通道修复（2026-09-27）

M266（分支 `feat/stale-scene-assertion-cleanup-m266`）按 Alex 裁决清理 M254 / M217 留下的陈旧断言，
并修掉套件 `button: right` 的取图通道。**真机读数：28 / 29 / 31 / 32 / 38 / 43 / 50 七条全部 PASS**
（第一轮 4/7；29 与 50 各余一条断言形态错、43 的真因未定位，三处修完后第二轮 3/3）。证据
`test-results/acceptance/2026-09-27/`（git 外）；另存一份**不会被同日后续 run 覆盖**的副本在
`test-results/m266/scenarios/`（同一天目录里的场景目录会被后来的 run 整目录重写，这是既有 finding
「套件每次运行都会重写证据目录」的同族），两轮的运行日志在该目录的同级 `run{1,2}-*.log`。

**M254 改了三条场景的前提（28 / 29 / 38）——已按现状对齐**：`93bb24b` 之后「单击树文件打开的标签
也入盘」，重启会把它恢复出来。改法按场景语义各取其一：

- `28` / `38`：断言从「重启后没有标签（空 vault 引导在场）」改成**正观测**——「恢复出的就是本场景
  那一份」（`AXRadioButton (toc-long.md)` / `(keys.md)`）+ 同一对位置 / 正文断言。28 还多一条
  「第 15 章两行在渲染行里」，比旧写法强（旧写法只有负向断言，编辑器根本没装载时会空过）。
- `29`：问题不是断言本身，而是**前提不成立**——重启恢复出的同名标签让 `open` 走「同路径短路激活」
  （不重新装载），读到的 AX 是启动恢复那一刻的、不是全新的。修法：`configWrite` 之前补一步 `⌘W`
  关标签（+ 等会话落盘），重启落在空文档态、`open` 走真正的装载路径，本场景五次「改字号 → 判定」
  因此完全同形。**顺带纠正一处口径**：关掉最后一个标签落在「无当前文件」的空文档态，**不是** D107
  的空 vault 引导（M266 实测；29 的断言已按此写）。

**`31-code-variable-highlight`：查询词按标签重敲（对齐 M254 的分标签编辑器语义）**：旧断言假设
「搜索状态跨文件保留」，那建立在预览机制「就地替换同一个 `EditorView`」之上；现在一律新标签 = 新视图
= 空查询（M256 现场：lua / md 两段的 `AXTextField (查找)` 没有 Value）。每个文件段先断言「查询为空
（0/0）」作正观测，再重敲一遍，三段落的通道完全同形。

**`32-list-filter`：路径断言改成行节点断言（M217 起路径不上屏）**：旧断言找的是 vault 的绝对路径，
而 M217 裁决后列表行是单行制、路径次行已裁掉——旧断言在健康机器上**恒真**（「看着更强、其实恒真」
那类假绿）。现改成 `AXStaticText (lumir-m102-acceptance-b …)` 形（`(?!-b)` 把命中的那一行排除）；
树头部那条同名读屏名是 `AXPopUpButton`，不会被误命中。

**套件 `button: right` 的取图通道修好了（47 / 50 的整段 FAIL 由此收口）**：旧实现用 `mode=ax` 的快照
找节点 bbox，又要求 `ax.image` 在场——而 mode=ax 的快照**按设计不带图**（header 自述
`screenshot: none — no image attached`），于是这条路径**必然**报「取不到窗口截图」（M244 / M249 /
M251 / M252 / M254 同族）。修法：新增 `readAxWithScreenshot`（`lib/execute.mjs`），坐标路径改读
`mode=full`——同一份快照既带图、bbox 又是**截图像素**口径（与 `click` 的 x,y 同空间），顺带修掉
「可视区上界拿屏幕点 1200×800 去比截图像素」的混用。**同一次实跑即验通**：场景 50 的三条路径（含
脏标签拦截 + 三出口 + 放弃后批量继续）全部走通。

**场景 50 / 51 的 `Close` 锚定断言恒不匹配（断言形态错；50 已修、51 另立 finding）**：
`/^AXMenuItem \(Close\)$/m` 在真机上永远不匹配——AX dump 的节点行形如
`- [366] AXMenuItem (Close) @290,25 …`，行首是缩进与索引，而 `m` 下 `^`/`$` 只认行首行尾。
**50 已改成带括号的项名** `/AXMenuItem \(Close\)/`（另两项的项名里不含 `(Close)` 这个子串，既不必
加锚点也不会三项全中）；**51 不在本 mission 的 scope**，已按规矩落 finding
`.tower/comms/findings/20260927-worker-stale-scene-cleanup-bug-51-close.md`。

~~**场景 43 的红因定案：不是「等得不够」，是自动保存自身的 fs 回声被判成了「外部修改」**（medium，
**产品缺陷**；finding `.tower/comms/findings/20260927-worker-stale-scene-cleanup-bug-fs-dirty-43.md`）：
M266 把该步等待由 2600 加长到 6000 复跑**仍然红**——由此证伪 M256 留下的「注入 + 快照耗时把 2.6s
窗口挤穿」这一支。真因读数：诊断日志（`env:lumir/logs/2026-09-27.jsonl`）在同一秒记下
`save_external_change(path=list-indent-bullet.md)` + `autosave_paused(reason=external)`，而该文件此刻
的 mtime 正是**应用自己那次自动保存**的时刻，两条相隔 177ms——「外部修改」是**自己写盘的回声**。
机制：`src/save-controller.ts` 的 `handleExternalChange` 只在 `saving.has(path)`（保存进行中）时抑制
自身事件，保存一结束抑制即撤；回声到达时若缓冲区**已重新 dirty**，走 `if (isDirty(path))` 分支——
该分支**不做 revision 比对**（干净的兄弟分支有 `reloadDocument(onlyIfChanged)`），直接暂停自动保存 +
弹「检测到外部修改」。后果：这次改动永不落盘（只留一份崩溃备份）。
**场景侧的对策是避开窗口而不是修产品**：先一步 `sleep 3000` + 断言见证字符已落盘，让第一次保存与它的
回声走完再按 ⌘J；判据面另留一条护栏 `ax: { not: "检测到外部修改" }`（竞态回来时红在这一条）。
真机侧**没有任何场景覆盖这条竞态**——它只能由 chromium 桩确定性复现（修法与验证口径见 finding）。~~

**已收口（M278，change `remove-autosave` 的 D2，2026-09-27）**：两个面一起收——
① **主触发面随动作一起消失**：自动保存整条移除后，vault 内文档只由用户的显式动作改写，
「每次停顿 2 秒后都可能产生一次自写回声」这条高频路径不复存在；
② **残余窗口由 D2 关闭**：`handleExternalChange` 的自身写盘判据由「保存进行中」
（`saving.has(path)`，保存一结束即撤）改为「磁盘 revision == 会话已知基准」，并去掉它只作用于
clean 分支的限制——保存之后约一二百毫秒内用户若已重新键入（M266 实测的 177ms 窗口），事件到达时
先比对 revision，一致即判为回声、不产生任何用户可见处置。读取失败按「不是回声」降级（宁可多提示
一次，也不静默忽略真实的外部修改）。回归防线：单测 `tests/unit/save-controller.test.ts` 的两条
回声用例 + 视觉 `tests/visual/scenes/save-hardening-autosave.spec.ts` 的「自身写盘回声」一组；
场景 43 的 `ax: { not: "检测到外部修改" }` 护栏保留为常规判据（不再是绕窗口的权宜）。

**顺带纠正一条套件事实**：诊断日志白名单里**没有「保存成功」这类正向事件**（`src/bindings/LogEventName.ts`
只有 `save_conflict` / `autosave_paused` / `recovery_written` 这类）。M256 建议的「读 `document_save`
诊断日志判定是窗口问题还是保存问题」**在现有事件集下做不到**——「有没有保存」只能从磁盘内容与 mtime
判；真出异步问题时读 `env:lumir/logs/<日期>.jsonl` 的 `save_external_change` / `autosave_paused` 这一对
（M266 就是这么定案的）。

**视觉基线两张按 Alex 已认可的口径重建**：`tests/visual/baselines/tree-menu.spec.ts-snapshots/` 的
`context-menu-file` / `context-menu-dir` 两张元素基线随 M251 的「菜单作用行高亮」各差 23px（角上圆角
透出作用行底色），本轮按 `test-results/m251/baseline-review/tree-menu-menu-target/` 里 Alex 认可的观感
重建——重建产物与过目包里的 `*-after.png` **逐字节相同**（`cmp` 复核）。同目录第三张
`context-menu-file-trash-active` 同因差 5 字节，但**不在 Alex 过目包内**，本轮**未重建**（已改回），
留待一次过目后再一并更新。这两张基线只出现在 `tests/visual/scenes/tree-menu.spec.ts` 的元素级断言里
（全仓 grep），没有任何整页基线把它们包含在内。

**场景 50 正文一处陈旧指向（M269 登记，low，纯文档）**：`50-tab-context-menu.md:200-206` 末句
「场景 51 的那条待其 owner 修」在 M269 落地后不成立（51 已改同形子串写法）。finding：
`.tower/comms/findings/20260927-worker-scene51-close-improve-50-51-owner-m269.md`（附建议改写文本）。
**触发条件**：任一后续 mission 碰到场景 50 文件时顺手把时态改成历史口径。

### 文案 deck D152 编号碰撞（M263 登记，2026-09-27；tower 已裁决分配）

`文案-Copy.md` 末位是 D151，而两份已合并提案都声明「从 D152 起」：M261（`goto-line-command`，
proposal.md:77）与 M267（`ui-language-i18n`，proposal.md:90「新增 D152 起」）。finding：
`.tower/comms/findings/20260927-worker-proposal-block-copy-bug-deck-d152-change-m261-goto-line-m267-ui-language-i18n.md`。
**tower 裁决（2026-09-27）**：M261（先合并、体量小）占 D152 起；**M267 实现期必须把 deck 起点重基到
当时末位续接**（预计 D156 起——M263 已占 D153–D155），并同步改它 proposal / tasks 里的编号声明段。
动因：deck 规则是「只追加、不复用」，而代码注释与单测字面量按 D 编号引用文案，撞号会让这些引用
指错条目。**触发条件**：M267 过节点 1 进实现时，第一个 task 先做这步重基。

**M277 实现期补记（2026-09-27，两块 change 同批落地）**：`code-block-fullscreen` 的提案期声明是
**D152**（与 M261 撞号，且在 tower 裁决之前写成），实现期按同一条裁决改取 **D156**——于是 deck 的
占用变成 **D152 = M261（保留空号，未落地）**、**D153–D155 = block-copy-affordance（M277 已落地）**、
**D156 = code-block-fullscreen（M277 已落地）**。⇒ **M267 的重基起点随之改为 D157 起**（原预计
D156），`ui-language-i18n` 实现时仍需按当时末位再核一次（不盲取）。deck 的编号沿革段（`文案-Copy.md`）
与本条同步记着这次改号。

### table-trigger.ts 注释 deck 编号漂移（M262 登记，2026-09-27）

`src/preview/table-trigger.ts:30` 与 `:42` 两条注释把表格全屏触发钮的读屏名写成「文案 deck D120」，
实际条目是 **D124**（`文案-Copy.md:116` / `:171`）；D120 是栏宽拖拽手柄（`src/content-width.ts:28`）。
断言侧没漂（`tests/unit/table-fullscreen.test.ts:194-196` 写的是 D124），纯注释失真。成因：M240 提案期
按「末位 D119 ⇒ 取 D120」写，实现期落到 D124 后只改了单测与 deck、漏改这两条注释。finding：
`.tower/comms/findings/20260927-worker-proposal-code-fs-b-improve-table-trigger-ts-deck-d120-d124-d120.md`。
**触发条件**：任一后续 mission 碰到 `src/preview/table-trigger.ts` 时顺手把两处 D120 改成 D124。
**已核销（M277，2026-09-27）**：两处注释已改为 D124（M277 恰好动到这个文件——给块级动作钮抽共享类
时逐行过了一遍），并在该处注明这次改动的来历。

### M277 实现期登记的已知边界：块级复制与代码块全屏（2026-09-27）

M277（`block-copy-affordance` + `code-block-fullscreen` 的实现批）落地时**如实登记**的边界，
都不是缺陷、也都不是「以后再修」的待办，写在这里是为了让后续 mission 不必重新发现一遍：

1. **复制结果恒为 LF 换行**（`src/preview/block-copy.ts` 的文件头）：切片取自 `EditorState`
   （`Text.of` 把 CRLF 归一成 `lineBreak`），因此 CRLF 源文件复制出来的也是 LF。这是「从模型复制、
   不从磁盘复制」的既有语义，不是本能力引入的行为。
2. **代码块没有大小上限，表格有**：表格 >64 KiB 整块降级为源码（无 grid DOM、无入口），代码块
   没有降级——点击复制是对整块源码的一次同步 `sliceString`。落地时未专门量超大块（≥512 KiB）的
   点击到 toast 时延（`block-copy-affordance` tasks 5.4 的这一档如实记为**未测量**）。
3. **窄块上的钮会向左溢出**：按钮组锚点是块的 slot 右缘（= 栏宽右缘），固定宽 56px（复制 + 放大 +
   间隙），窄块上这组钮悬在表右侧的内容区上方，hover 期间才出现。跨块的观感归 Alex dogfood。
4. **全屏浮层里 >64 KiB 的块退化为单块纯文本**：文档内该块仍是逐行排版（只是不着色），浮层里
   没有头部条与行样式——设计决定（复用既有的着色阈值，不另立新阈值），观感差如实登记。
5. **命令路径的块定位是视口有界的**（`src/preview/livePreview.ts` 的 `codeBlockAt` 复用装饰层的
   `tableDiscoveryRange`：视口 ± max(首行长 × 2, 2048)）：caret 留在原处、视口滚出该范围之后再按
   `code-block.toggle-fullscreen` 或 `block.copy`，会**静默不动作**（命中判据取不到块）。真机场景 62
   的操作幅度刻意落在 2048px 以内。要覆盖「视口滚得很远、caret 留在原块」这条，需要一条不依赖
   装饰层发现范围的块定位（例如按 caret 位置在语法树上直接解析 + 单独产块序数）——是另一个 change，
   登记在此不夹带（M277 已另开 finding 给 tower）。
6. **浮层的 `blur` 兜底关闭路径真机未覆盖**（`code-block-fullscreen` tasks 6.1 的登记）：在不换文档的
   前提下没有稳定的注入通道把焦点交给别处；单测覆盖「blur 关闭且不抢焦点」，真机侧 MUST NOT 拿
   Esc 路径的绿灯冒充它。
7. **两条新命令默认不绑键**（`block.copy` / `code-block.toggle-fullscreen`）：鼠标入口分别是块上的
   复制钮与放大钮（hover 才出现），键盘入口需用户经 `[keys]` 绑定。`⌘/` 面板会列出它们的「未绑定」行。

### M280 现场发现：ESC 跳变的两个副产物与两条残余（2026-09-27）

M280（修阅读位置原语 + 统一全部交还焦点调用点）的**未收口项**，逐条给出机制链、优先级与建议归属。
M279 报告 §5 的两条副产物在列，判定为**都不随本修复收口**：

1. ~~**跳变那一拍会被落盘成阅读位置 `pos 0`（high，待修，M279 已开 finding
   `20260927-worker-survey-esc-jump-bug-esc-pos-0-anchor-0.md`；建议归属：remember-reading-position
   的下一个 change 或独立小 mission）**~~ **已修（M286，2026-09-28）**——修法与读数见本条末尾的
   「M286 收口」段；下面是当时的机制链原稿（留档）。机制链：`src/reading-position.ts:192-208` 的 `scrolled()`
   在**滚动事件里同步**读 `deps.readPosition()`（`src/main.ts` 注入 `editor.readScrollPosition`），
   读到的时刻早于 CM 的测量周期——而本修复的写回正是在测量周期里落地（`view.dispatch` 的
   `scrollIntoView` 效果）。⇒ 引擎聚焦揭示造成的 `scrollTop S → 0` 那一拍若先派发了 scroll 事件，
   捕获到的仍是 `pos 0`；1s 防抖到期后写盘，而 `applyScrollPosition` 对 `anchor === 0` 刻意不施加
   （M110 口径）⇒ 此后每次打开都从篇首开始。**实证**：M279 的 T5（`test-results/m279/readings/`）
   与 Alex 那份文件盘上的 `pos 0 / y 114`（47 条里 19 条 pos 0）。**M280 的对照读数（两半都给，
   判据不依赖具体数值）**：修后在 `webkit-realua` 场景里越过 1s 防抖，桩收到的
   `reading_position_put` 载荷是**跳变前的那个真实锚**（锚 = 视口顶那一行的文档位置，`pos` 在
   1600 量级），**不是 `pos 0`**——即这一几何下没有把用户位置改写成篇首。`y` 逐轮有亚像素级
   差异（同一份代码两轮实测 72.6 / 74.5），而 `test-results/m280/scene-readings/table-esc.json`
   会被后续每一轮 gate 覆写，因此此处**只记判据、不记具体读数**；要引用数值以当轮现场为准
   （`gate-visual-regression.log` 的 `readingPositionPuts tail` 行）。**但机制仍开着**（捕获读在
   滚动事件的同步回调里，而临时 0 与写回落在同一帧，谁先谁后不由产品代码决定），因此本条
   **保持待修**，修法与验收连同新的探针（注入滚动事件时间线 + 载荷逐次比对）一起做。修法候选：① 交还焦点前后一小段
   窗口内的捕获整体忽略（本模块自己持有一个「正在交还焦点」标记，MUST NOT 靠时间猜测）；
   ② 落盘前把「与上一份 pending 指向同一处」的判据从 `samePosition` 放宽到「锚相同即不覆盖」。
   ①更贴合「谁在动这个视口」的语义，倾向 ①。
   **M286 收口（2026-09-28，mission M286）**：条款落在
   `docs/design-parity-contract/overlay-close-reading-position.md` 的 **CL-2**（应用自身造成的视口
   变动 MUST NOT 进入阅读位置）；按候选 ① 落地——新增 `src/viewport-transition.ts`
   （纯计数器、无 DOM 无时钟的窗口标记），**开窗方是推视口的一方**：`focusPreservingReadingPosition`
   （交还焦点原语）与 `editor.reloadSession`（装载复位 `scrollTop = 0`）都经
   `src/scroll-position-view.ts` 的 `duringViewportTransition` 把这段动作包进窗口，窗口在**下一帧**
   关闭（那一拍 CM 的测量周期已把 `scrollIntoView` 的 `scrollTarget` 落到 DOM 上）；捕获侧唯一消费点
   是 `scrolled()` 的一条早退：窗口内到达的滚动事件**整体忽略**（不读位置、不排期，且不打断已排期的
   落盘）。忽略整个窗口而不是「只忽略篇首」：中间态的口径由引擎决定（实测过 `0` 与 `-1`）。
   **判据与证据**：不变量在 `tests/unit/reading-position.test.ts`（转场窗口一组：中间态不进待写集合、
   不打断已排期的落盘、窗口不粘住捕获）+ `tests/unit/viewport-transition.test.ts`（嵌套安全）；
   消融（删掉那条早退）后单测如实红在 `0 !== 1200`（`test-results/m286/ablation-gate-unit.log`）。
   product 层：`tests/visual/scenes/m280-overlay-esc-scroll.spec.ts` 追加两条载荷判据（落盘位置必须
   落在 ESC 前那一拍的真实锚、整个流程不许出现 `pos 0`），并**断言前提**（webkit-realua 支必须看到
   引擎真的动过视口：`focus` 调用 `before 1540 → after 0`）——修后载荷是 `pos 1628`（真锚，不是 0）。
   同一族的第二条来源（装载复位的中间态）也一并关掉，确定性实证见本条下方第 7 项。
   **如实登记的两点**：① M280 之后这条本已是**竞态**而非稳态复现（跳变修好后，中间态通常在下一帧
   被写回覆盖，载荷多在愈合后落盘）——本修的增量是**把竞态关掉**，不是修一个当下稳定可复现的现场；
   ② 窗口边界是「下一个 rAF」，引擎若把中间态维持到第二帧之后本窗口不覆盖（实测未见）。
2. ~~**外部改写当前文档 ⇒ 重载复位篇首 + 遮罩不自关（high，待修，M279 已开 finding
   `20260927-worker-survey-esc-jump-bug-item.md`；建议归属：overlay/外部变更专项）**~~
   **已修（M286，2026-09-28）**——下面是当时的机制链原稿（留档）。机制链：重载走 `src/main.ts` 的外部变更分流，没有经过 `openFile` 的
   `readingPositions.restoreFor` ⇒ 阅读位置不恢复；`src/table-fullscreen.ts:173-176` 的注释声称
   `blur` 兜底同时兜住「文档代际变化（外部重载）」，M279 的 T6 实测**没有**触发（`scrollTop
   1543 → 0`、遮罩 `hidden=false` 仍开着）。本修复不碰这两条（它们与「聚焦揭示」无关）。
   **M286 收口（2026-09-28，mission M286）**：条款落在
   `docs/design-parity-contract/overlay-close-reading-position.md` 的 **CL-3**（文档就地重载 MUST 与
   装载同口径收口：视口 + 由文档派生的浮层）。两条分开修，方向都是 finding 的建议。
   ① **阅读位置恢复**：`src/save-controller.ts` 的 `reloadDocument` 在前台文档重载后调新 dep
   `restoreReadingPosition(path)`（装配层实现为同一个 `readingPositions.restoreFor`——**与 `openFile`
   同一条口子**，不新造第二条恢复路径）；顺带把 `restoreFor` 的取值从「只读盘上镜像」改成
   `pending ?? mirror`：外部写在用户刚滚过之后的 1s 防抖窗口里到达时，镜像是上一次落盘的位置
   （差可达一屏），待写那份才是「用户此刻在哪」。
   ② **遮罩退出**：新 dep `documentReplaced()` 由装配层实现为 `src/main.ts` 的
   `closeDocumentOverlays()`（表格全屏 + 代码块全屏显式 `close("document")`）。取的是 finding 的
   第二条建议（把「文档代际变化」做成**显式信号**），而不是修 blur 兜底——重载不动焦点这件事是
   结构性的（`reloadSession` 不调 `view.focus()`），指望焦点副作用的那条兜底没有可靠触发点。
   `overlay-state.ts` 因此新增第五条关闭路径 `document`（与三条用户路径同口径：**交还焦点**，
   键盘回到正文），并把「blur 兜住三件事」这句**与实测不符**的注释在 `overlay-state.ts` /
   `table-fullscreen.ts` / `code-block-fullscreen.ts` 三处就地改正。
   **判据与证据**：`tests/visual/scenes/m286-external-reload-viewport.spec.ts`（chromium）第一条：
   重载后 `scrollTop` 逐值回到重载前（`1541 → 1541`，行号同为第 53 行）、遮罩 `hidden=true`、
   载荷里不出现 `pos 0` 且最后一份落在重载前那一行；第二条（负向）：外部改写**后台**标签时
   **不拽走前台视口、不关前台遮罩**。消融（去掉两处 dep 调用）后第一条如实红：
   `重载前 scrollTop=1541、重载后=0`，且 `afterOverlayOpen: true`（`test-results/m286/ablation-reload-deps.log`
   与同目录的证据 json），第二条照旧绿。真机层新增场景 **65**（`scripts/acceptance/scenarios/65-external-reload-reading-position.md`
   + fixture `reading-position-reload.md`：⌃V 到尾部 → ⌘J 开表格全屏 → 外部末尾追加 → 断言「第 15 章
   两行在渲染行里 / 第 1 章两行不在」+ 遮罩已退出 + 内容已重载），邻近护栏场景 07c 同批重跑。
   **真机读数（2026-09-28，wt-286，隔离端口 1430）**：07c **PASS 20.2s**、65 **PASS 35.2s**（2/2）；
   场景 65 的**反向验证**（去掉那两处 dep 调用重跑）**1/1 FAIL**——遮罩未退出 + 第 15 章离场（与 T6
   同症状），恢复后复跑 **1/1 PASS**。证据 `test-results/acceptance/2026-09-28-m286/`（git 外，已同步
   主 checkout）。
   **残余（如实登记）**：图片遮罩（`src/lightbox.ts`）**未**纳入 `closeDocumentOverlays`——`ImageLightbox`
   的对外面只有 `open`（没有关闭口子），且它的状态机是 M184 留下的**第二份实现**（未走
   `src/overlay-state.ts`）。它是同一族（放大图复用内联 `<img>` 的 src，文档换代后那份 DOM 可能已不在），
   收它要动公开接口 + 合并那份重复状态机，超出本 mission 射程，见下方第 7 项。
3. **残余：vault 切换器仍走第二份通道（low，待收）**。`src/vault-switcher.ts:739-744` 的
   `handOffFocus()` 用 CM 自己的 `scrollSnapshot()` / 快照 effect，而全仓其余路径已统一到
   `src/scroll-position-view.ts` 的原语——同一语义两处实现（REVIEW.md 第 8 条）。M280 未收的理由：
   它 M186 起就有保护、真机场景 25 PASS 过三次，换通道要重跑真机；收口时按「先跑场景 25，再换」
   的顺序做。
4. **残余：捕获锚落在文档原点时运行期不写回（low，待收）**。`applyScrollPosition` 的
   `anchor === 0` 早退沿用装载口径（M110 的页首内边距）。触发条件窄（视口停在最上沿 + 引擎揭示
   下方 caret 才会体现），收口时要连带核对 M110 的页首 44px 内边距与 `tests/unit/scroll-position.test.ts`
   的两条往返断言。
5. **验收套件表达不了 CL-1 的判据（medium，待修；归属：验收套件表达力专项，与下面的
   「套件缺 `scroll` 动作」同族）**。M280 试图为条款补两条真机场景（表格 / 代码块全屏 ESC），
   实测**做不出可证伪的判据**，器材侧三条硬约束逐条给实测：
   - 套件没有 `scrollTop` 读数、也没有 `scroll` 动作 ⇒ 「位置没变」只能靠「渲染行是否在场」间接判；
   - 「渲染行」的间接判据依赖 AX 文本窗口，而 M280 真机实测该窗口宽达 ~2500–3600px
     （现场：视口在文档末尾时，视口上方 ~2400px 处的表格行与文档首行仍在 AX 树里——
     `test-results/acceptance/2026-09-27/63-*` 的 ax dump），因此负向那半（"上方那块已不在渲染行里"）
     在 ~2400px 量级的间距上恒真；
   - 拉大间距被**代码侧**卡死：命令入口的块定位走 `tableDiscoveryRange`（视口 ± max(首行长×2, 2048)
     **字符**），caret 距视口顶超过 ~2048 字符时命令静默不动作 ⇒ 「caret 在视口上方 ≥ 一屏 + 命令
     可达」这条带子的宽度不足以超过 AX 窗口。鼠标触发钮入口（`activeElement` 所属容器，不受该范围
     限制）才是能拉大间距的那条，但套件没有 `hover` 动作、触发钮只在 hover 时进 AX 树。
   ⇒ 结论：**在补齐「`scroll` 读数/动作」或「`hover` 动作」之前，CL-1 的真机判据只能靠人肉**
   （Alex 按最小三条件各做一次，M279 §7.2 已提过这条代价）。M280 因此**没有**留下红场景，
   真机层的证据是场景 40 与 62 的 PASS（两条关闭路径的**回归护栏**：修前修后都绿，不构成 CL-1
   通过的证据——判别证据在 `webkit-realua` 层，见条款文档的「判别层」表）。

6. **方法学告警（medium，已开 finding）**：「Playwright WebKit + 真机同款 UA」**不等于**系统
   WKWebView 的行为。M274 的离屏探针测得系统 WKWebView **尊重** `focus({preventScroll:true})`，
   M279 在同一 UA 的 Playwright WebKit 上测得**无视**它并揭示范（`scrollTop 1560 → 0`）。两处读数
   互斥、未定性 ⇒ 涉及 WebKit 分支的判据在真机层与 Playwright 层可能给出相反结论，而**真机层才是
   终审**。finding `20260927-worker-impl-esc-jump-improve-playwright-webkit-ua-wkwebview-preventscroll-webkit-playwrig.md`（本 mission 开）。

7. **残余：图片遮罩（lightbox）不随文档代际变化退出（low，待收；M286 新登记）**。M286 把
   「内容取自旧一份文档的浮层随重载退出」收在 `src/main.ts` 的 `closeDocumentOverlays()` 里，但只
   覆盖表格全屏与代码块全屏两处——**图片遮罩是同一族**（放大图复用内联 `<img>` 的 src，文档换代
   后那份 DOM 可能已不在，遮罩却仍显示旧图），未收的两个具体理由：① `ImageLightbox` 的对外接口
   **只有 `open`**（闭合路径全部在遮罩内部自治，`src/lightbox.ts:36-40`），装配层拿不到关闭口子；
   ② 它的状态机是 M184 留下的**第二份实现**（`createLightboxState`，未走 `src/overlay-state.ts`）
   ——同一语义两处实现（REVIEW.md 第 8 条）。收口顺序建议：先把 lightbox 的状态机并到
   `src/overlay-state.ts` + 给它一条 `close("document")`，再把它加进 `closeDocumentOverlays()`；
   合并那份状态机本身值得一条独立小 mission（它同时消掉 M277 那次抽取留下的例外）。

8. **M286 的确定性实证（补充第 1 条，供后人复核捕获让位窗口的必要性）**：装载复位那条中间态
   （`reloadSession` 的 `scrollTop = 0`）在**消融掉窗口**之后会如实落盘成 finding 记录的那个形态。
   现场：把 `src/editor.ts` 的 `reloadSession` 窗口与 `src/save-controller.ts` 的两处重载 dep 一起
   消融，跑 `tests/visual/scenes/m286-external-reload-viewport.spec.ts`，桩收到第二份载荷
   `{"pos":0,"y":115.109375}`（与 finding 引用的真实 vault `pos 0 / y 114`、M279 T5 的 `y 115.58`
   同形态）；只把窗口放回去（deps 仍消融）时不再出现 `pos 0`——即**读侧的恢复与写侧的让位是两半
   独立防线**：窗口关掉的是「把中间态写进盘」，恢复关掉的是「视口停在篇首」。日志与逐轮读数
   `test-results/m286/ablation-reload-deps-and-load-window.log` + `.evidence.json`（git 外）。

### M252 装载指示立论在打开段不成立（M268 登记，2026-09-27）

已合并未归档的 change `vault-switch-feedback`（M252）的 proposal 立论「等待期间事件循环是空的、界面
会重绘」只在**会话恢复段**（纯 JS 异步）成立；**打开段**由 `src-tauri/src/commands.rs:555` 的
`vault_open_path` 承担——它是**不带 `async`** 的同步 command、在主线程内联执行（对照 `:531` 的
`vault_open` 是 async），该段 webview 不能重绘、指示只能静止。Alex 报的「愣住几秒后才出现系统转圈」
很可能就是这一段的 beachball，不是 Lumir 的指示。finding：
`.tower/comms/findings/20260927-worker-proposal-vault-restore-improve-m252-vault-open-path-command.md`。
**动作**：① 归档 `vault-switch-feedback` 前在它自己的 spec 增量「装载的即时反馈」里补一句已知边界
（打开段指示只取「在场」判据），M268 的 delta 已带同一条边界、两处不冲突；② `vault_open_path`
是否异步化等 M268 tasks 1.2 的 watch 段读数再定；③ 顺带统一 `vault_open`（async）/ `vault_open_path`
（同步）两条 path 的线程语义。

### 验收套件的三处口径限制（M277 现场发现，2026-09-27，前两处已随 M277 落地修正）

1. **剪贴板读数的行尾被 AppleScript 改写（已修）**：`osascript -e 'the clipboard'` 把粘贴板文本按
   **经典 Mac 行尾**（CR）返回，而 app 侧写的是 LF。此前 `clipboard: { exact }` 对**多行内容**必然
   假红（场景 47 是单行，一直没暴露）。M277 在 `scripts/acceptance/lib/execute.mjs` 的 `readClipboard()`
   里加行尾归一（`\r\n` / `\r` → `\n`），README 的两处口径已同步；场景 61 的多行 `exact` 断言因此才可能。
2. **`editor.unchangedSince` 读的是 AX 渲染文本，不是文档模型（已在 M277 的场景里改走磁盘判据）**：
   实测「点一下渲染为 grid 的表」之后，AX 文本会多出一个换行（渲染态随 caret 是否落在渲染块里变化），
   **而文档与磁盘逐字节未变**（磁盘 sha256 断言同时 PASS）。⇒ 真机层的「不改写源文件」判据改成
   `file.unchangedSince`（sha256）；**文档模型层**的逐字节判据在 chromium 场景（`readDocument` 直接读
   CM state）。将来若有人想用 `editor.unchangedSince` 守「不改文档」，这条限制要先知道。
3. **注入通道的可靠性与可点节点面（M277 现场，未修，属环境/工具面）**：长 chain（8–19 个 chord）
   在盲发注入下会丢键或重复键（实测：⌃N ×3 有时走 6 行）；AX 里**只有 token span 组 / AXTable 一类
   节点带 bbox**，块内纯文本节点与 mermaid widget 都报「找不到带 bbox 的节点」。稳定写法：
   「一次点击锚点（`AXTable` / 编辑器首行）+ 4–7 步短链 + 每个目标块 ≥4 行（给 ±1 容错）」，
   并且每条 `clipboard.exact` 都要配一条正向见证（toast），否则「剪贴板里的旧值恰好等于期望值」
   会假绿（M277 实测踩到两次）。M277 的场景 61/62 是按这条口径写的，可作为模板。

### 验收套件（M240 现场发现，2026-09-26）

- **Tab / Shift-Tab 注入在 WKWebView 不生效 ⇒ list-tab-indent（M239）的场景 43 在 master 上恒红**（medium，
  产品行为正确）：全量真机批次 47/49 PASS，两条红里的 `43-list-tab-indent` 红在 `do: key tab` 之后源文件
  未变（前一步键入 `q` 落在预期行、焦点 `AXTextArea` ⇒ 可打印字符的通道是通的）。**三步归因实测**：
  ① 单独复跑 43 仍 FAIL（同样两条断言、同样值）；② `git checkout 93e153a -- src`（src/ 回到 M240 之前
  = M239 合并后的 master）复跑**同样 FAIL**，随后 `git checkout HEAD -- src` 恢复 ⇒ 与 M240 无关；
  ③ chromium 探针：`- alpha\n- bravo` 上 caret 置 `bravo` 行按 `Tab` → 文档变 `- alpha\n  - bravo`，
  `Shift+Tab` 变回 ⇒ **产品功能正确，红在注入通道**（KimiCU 的 `press_key("tab")` 没有以 keydown
  落到 WKWebView；候选成因：xdotool 风格键名映射失败 / macOS 的 Tab 焦点遍历在到达页面前吃掉，
  未定位到哪一条）。
  **风险面**：任何 `do: key tab` 类场景都会得到假 FAIL，而「Tab 无操作」这类**负向断言在真机上
  恒真假绿**（43 的前两处「无操作」步骤就是这种形态，整条只在最后一步才红）。
  **动作**（裁决归 M239 的 owner / tower）：① 低成本——在 `scripts/acceptance/README.md` 的已知边界
  登记该通道缺口，并把 43 改成经 `[keys]` 绑到通道可达的组合来验命令本身（场景内写明默认绑定那条
  路径待修）；② 正解——查 KimiCU 的 `press_key("tab")` 实际发出的键名 / keycode，修通后 43 原样跑绿。
  两条都建议顺手把「负向断言必须配通道可达的正观测」写进 README 的判据纪律。
  **状态更新（2026-09-27，M249 + M256）**：① 方案已落地——场景 43 改成经 `[keys]` 把
  `editor.list-indent` / `editor.list-outdent` 绑到 `⌘J` / `⌘⇧J`，并在 M249 的批次里 PASS 过
  （`test-results/acceptance/2026-09-27-m249/43-list-tab-indent/`）；② 通道缺口本身已固化进
  `scripts/acceptance/README.md` 的「键盘注入通道的两类不可达」；③ 但 43 在 M256 的全量批里**又红了**，
  且**不是这一条**——成因是「命令生效、磁盘 2.6s 内未落盘」，见「M256 全量回归现场」的同名条目。
  证据：`test-results/acceptance/2026-09-26-m240-full/43-list-tab-indent/steps.md`（FAIL 现场）、
  `…/2026-09-26-m240-rerun43/`、`…/2026-09-26-m240-attrib43/`（pre-M240 同红）；finding
  `.tower/comms/findings/20260926-worker-impl-table-fs-bug-tab-shift-tab-wkwebview-m239-43-master.md`。

- **套件每次运行都会重写证据目录的索引文件 ⇒ 多 mission 共用同一日期目录时互相覆盖**（low，M254
  登记，2026-09-27；同一现场 M243 也遇到过并手工重建过索引）：`scripts/acceptance/run.mjs` 每次运行
  重写 `test-results/acceptance/<日期>/summary.md` / `results.json` / `run.log` / `app.log`，而各场景
  目录（`<场景 id>/`）是保留的。一天里跑多次单场景（批次里最常见）之后，索引只反映最后一次 run。
  修法（未做，属套件改动）：按场景增量更新索引（存在则并入一行），或把索引文件名带上 run id。
  现场：M254 收口时按各场景目录重建了 2026-09-27 的索引（四个场景，见该目录 `summary.md` 的说明）。
  **补一条同日现场（M256，2026-09-27）**：被覆盖的不只是索引——**每个场景的 `<场景 id>/` 目录也会被
  同日后续 run 整目录重写**。M256 的全量批把同一天早先 M251 / M252 / M254 留下的
  `2026-09-27/{14-tabs,27-document-end-marker,47-file-tree-context-menu,49-vault-switch-feedback,50-tab-context-menu}/`
  换成了本批的现场（本批按任务书要求仍落 `2026-09-27`，未另开日期目录）。因此引用同一天**同名场景
  目录**的 finding，证据指针会在下一次 run 后指向别人的现场；写 finding 时请改引**场景之外的**目录
  （如 `test-results/m251/**`、`test-results/acceptance/2026-09-27-m252d/**` 这类带 mission 后缀的），
  或在文件名里限定「哪一批跑的那一份」。

### 门禁（M240 现场发现，2026-09-26）

- ~~**master 视觉门禁红：M239 的两条列表命令未归组，键位面板多出兜底「其他」组**（high）~~
  **已修（M240 顺手收，commit `e686cdd`）**：`src/bindings-panel.ts` 新增「列表缩进」组收纳
  `editor.list-indent` / `editor.list-outdent`，`BINDING_GROUPS` 导出给单测对账；
  `tests/unit/bindings-panel.test.ts` 补三条不变量（每条 `COMMAND_IDS` 都有组 ⇒ 零兜底组 /
  组里无幻影 id / 分组互斥），先红后绿留证（撤掉归组行 → 2 条 FAIL 并直接点出这两条 id，
  恢复后 311/311 PASS）；`m133-describe-bindings.spec.ts` 的 GROUPS 期望随之加一组。
  `gate.sh visual` 由 11/12 回到 **12/12 PASS**。现场与证据留痕（原文照录）：
  面板的兜底逻辑（`render()` 里对 `COMMAND_IDS` 求「未归组」的差集）渲染出「其他」组，
  M240 用 `git stash push -- src tests`（摘掉本 change 全部源码与本层测试改动）后 `pnpm build`
  重跑同一场景，**同样 2 failed / 4 passed**，故该红与 M240 无关；直接读数显示「其他」组的内容
  逐字为那两条 id。**防复发已落地**：兜底「其他」是「新命令忘归组」的静默出口（M133 的有意设计，
  保证命令不从面板消失），代价是漏归组只表现为别人的场景红——现在由 unit 层的「零兜底组」
  对账承担，漏归组在引入它的那次改动里就红。完整现场见 finding
  `.tower/comms/findings/20260926-worker-impl-table-fs-bug-master-m239.md`。

### 表格全屏（M240 登记，2026-09-26）

- **长表在全屏遮罩里只看到「已渲染的那部分」**（medium，follow-up change 候选）：快照 = 打开那一刻
  渲染态 grid 的深克隆，而 CM 的 DOM 随视口有界——实测（chromium 1200×800）700 行 / 60,764 B 的表
  只渲染 49 行，其余以 `.cm-gap` 占位（16,651px；克隆时按卫生摘除，所以快照是紧凑的 49 行）。
  后果：打开一张远高于视口的表的全屏视图，只能看到视口附近的行；关闭、在文档里往下滚、再打开才能
  看到下一段。**这是「打开那一刻渲染态 grid 的副本」的字面口径**（spec 已把它写进已知边界），不是
  缺陷，但它是「看一眼整张表」这一诉求在**行方向**上的缺口。完整快照需要另一条渲染路径（design §8
  已否决的「从 TableModel + 源码切片重建」那一类，理由是丢 inline 渲染）或 CM 侧的整块渲染能力。
  **动作**：立项时先答「行方向的完整呈现是否必要」——宽表（列方向）是本 change 的由来，长表的阅读
  在文档里本来就是滚动；若要做，优先考虑「快照分段补齐」而不是第二套渲染口径。
  证据：`test-results/acceptance/2026-09-26/table-fullscreen-before/open-cost.json`。
- **视觉套件 README 的「22 处像素断言」与现状不符**（low，文档漂移）：`tests/visual/README.md:48` 与
  `.github/workflows/visual.yml` 的注释都写「22 处整页像素断言跳过」，M240 实测当前
  `expectScreenshot` 调用点 **34 处**、`tests/visual/baselines/` 下 **34 张 png**（1:1 对应）——
  数字是 M173（2026-09-18）时代的，此后场景增长未回写。本 change 只动了 `tests/visual/**` 与
  `scripts/**`，`visual.yml` 不在 mission scope 内，故不就地改（改一处会与另一处不一致）。
  **动作**：一处改动同时更新 README 与 workflow 注释，并把「基线数字以最近一次全绿输出的『逐张比对
  通过』计数为准」写进 README 的基线纪律段。

- ~~**验收套件的 `--config` 覆盖会静默丢掉 `app.windows[0]` 里的窗口级配置**（2026-09-25，M213 登记，
  **medium**）~~ **2026-09-26 M236 已修**：worker 的修法是「从 `src-tauri/tauri.conf.json` 读
  `app.windows[0]` 原件再 spread」，并加运行期自检 `assertOverlayChrome`；修前/修后对照、反向输入
  实测与验收判据见「已核销」区的同日条目。
- **验收 README 的 `configWrite` / 场景 front-matter `config:` 行没写 `theme` / `fontFamily` /
  `monoFontFamily` / `fontSize`**（2026-09-25，M213 登记，low）：`scripts/acceptance/README.md` 的动作表
  里 `configWrite` 只列 `lastVault、keys、restart、requireVault`，而实现（`lib/execute.mjs、
  lib/app.mjs`）早已支持排版三项（M195）与主题（M210）；场景格式示例的 `config: { keys: {...} }` 同样
  只举了 keys。M213 的场景 34/35 用 `config: { theme }` 与 `configWrite: theme` 时只能靠读实现确认。
  **动作**：README 的两处补上这四个键（属文档面，落点 `scripts/acceptance/README.md`）。
- **真机套件没有计算属性通道 ⇒ 色值 / 主题类判据在真机层只能到「配置层 + 截图」**（2026-09-25，M213
  登记，medium）：`scripts/acceptance` 的断言形态只有 `ax` / `editor` / `file` / `glob` / `shot`
  （`lib/execute.mjs` 的 `EXPECT_KINDS`），**没有任何样式读数通道**。restyle 的三主题与 eink 九条降级
  全是色值 / 线宽效应，AX 文本与文档文本都不随之变化——M213 实测确认「主题在真机上生效」这件事没有
  机器判据可写：能机器判的只有①配置层（`env:config.json` 里的 `ui.theme`）②启动链路层（带该配置起得来、
  骨架在场）③结构层（chromium 场景的计算属性断言），可见性只能靠截图给人看。**后果**：任何「主题 /
  配色 / 对比度」的验收项在真机套件里都写不出可 FAIL 的判据，反向验证也无从下手（tasks §9.2 的
  「去掉主题施加 → 必须 FAIL」在本通道下做不到位）。**动作候选**（需 Alex 裁决，均属套件基建、不在
  任何单个 mission 的 scope）：① 给 KimiCU 的 AX 快照加一条「节点计算样式」读取（工具侧）；② 套件新增
  `style` 断言形态（落点是 `scripts/acceptance/lib/execute.mjs` + README 的断言表），通道可以走
  「在 webview 里 `page.evaluate` 等价物」——但真机没有注入 JS 的现成通道，实际仍需工具侧支持；
  ③ 认账现状，把色值类验收统一交给 chromium 结构层 + Alex 抽审截图（M213 采用的就是这条，并已把边界
  写进场景说明）。**关联**：`docs/process/real-machine-acceptance.md` 的通道边界表应补这一行。
  **部分缓解（M237，2026-09-26，change `live-theme-switch`）**：真机侧现在有了一条**运行期主题状态**
  的读数通道——modeline 右段的主题指示钮（`.modeline-theme`）可见文本就是当前主题名，悬停提示 /
  读屏名是 `主题：{主题名}（点击切换）`（文案 D122），KimiCU 的 AX dump 里读得到
  `AXButton (主题：dark（点击切换）)`。因此「切换命令命中了吗 / 当前是哪一档 / 重启后首帧是哪一档」
  这三类判据在真机上**可写可 FAIL** 了（场景 `44-theme-live-switch` 就是按它写的，含反向输入实测）。
  **仍未缓解的部分照旧**：色值、线宽、对比度、eink 九条降级这些**视觉取值**依然只能靠 chromium
  计算属性 + Alex 抽审（指示钮只说「是哪一档」，不说「看起来对不对」）。上面三条动作候选（工具侧
  读计算样式 / 新增 `style` 断言形态 / 认账现状）**不因本次缓解而作废**，本项保留。
- **`openspec/specs/typography/spec.md` 的 `## Purpose` 段已与实现漂移**（2026-09-25，M213 登记，low）：
  Purpose 第 3 段仍写「shell（左栏、**masthead**、浮层、键位面板、搜索面板）不受影响」与「既有整页基线
  （本 change 落地时 **30 张**）逐张零差异」——masthead 已随 restyle 整块删除、基线已全量重建（张数也
  不再是 30）。**为什么 M213 没修**：openspec 的 change delta 只覆盖 `## Requirements`（ADDED / MODIFIED
  / REMOVED 三类），`## Purpose` 不被 delta 读取，只在 capability **创建**时写入——所以这条只能在归档
  restyle 时手写替换，或另立一条 retro change。**动作**：restyle 归档节点 2 时顺手改这段（与「新建
  capability 的 Purpose 手写」是同一道工序）。
- **`32-list-filter` 自 2026-09-25 起在真机上红（同一断言，可复现）**（2026-09-26，M237 登记，medium）：
  全量真机套件 `46/47`，唯一 FAIL 是 `32-list-filter` 的最后一段——「命中的那一行还在（`-b` 那个 vault
  的完整路径）」（期望 AX 含 `/private/tmp/lumir-m102-acceptance-b`）。`test-results/acceptance/`
  的历史目录显示：**2026-09-24 PASS → 2026-09-25 FAIL（断言逐字相同）→ 2026-09-26 M237 全量复跑
  同一处 FAIL**。因此这是**先于 M237 存在的红**（与本批主题切换改动无关：失败面是 vault 切换器
  浮层的筛选结果集，本批没碰 `src/vault-switcher.ts` / `src/list-filter.ts` / 浮层样式）。
  **证据**：`test-results/acceptance/2026-09-25/32-list-filter/steps.md:79`（旧）
  与 `test-results/acceptance/2026-09-26/32-list-filter/steps.md:79`（本次，含 AX dump）。
  **待定位**：要么是该场景对「第二个 vault 是否已注册」的前置失败（筛选前的那一步骤断了，`) 命中行」
  自然不在），要么是 2026-09-25 那批（M236 的套件窗口/`--config` 改动）引入的真实回归——**未经定位，
  不作结论**。归属调查建议放在下一批的套件收口里（本 change 的 scope 不含它）。
  **定位结论（2026-09-27，M256 全量回归）**：两个候选**都不成立**——是**断言写死了一个不上屏的
  形态**。`-b` 那一行在场且显示名正确（M252 的 `$vault2` 占位符修复 `8758756` 已生效），
  红在那条断言要求 AX 含绝对路径 `/private/tmp/lumir-m102-acceptance-b`，而 M217 裁决后
  vault 列表行**不再显示路径**（`src/vault-switcher.ts:828-830` 就地注释「路径次行按 Alex 裁决
  裁掉（M217，gap 表 #12）」），行文本只有 `<显示名> <摘要>`。完整现场与动作见「待修 findings」
  的「M256 全量回归现场」同名条目。

- **`list-filter` 归档时如实留下的四处覆盖缺口 / 措辞落差**（2026-09-24，M205 登记，low）：
  ① delta scenario「单字符绑定不进统一键位表」里「表内没有任何单字符绑定」这条**无断言**（现只覆盖 ⌃S 那条，
  `tests/visual/scenes/m131-keymap-table.spec.ts:86`）——建议在 `tests/unit/keys.test.ts` 的表不变量循环里补
  一句「token 无修饰键 ⇒ 必须是具名键」；② delta scenario「中文查询串命中中文标题」要求输入法路径，真机
  通道造不出（`design.md` §7 第 1 项已如实登记）⇒ 该 scenario 只有单元 CJK（`tests/unit/list-filter.test.ts`）
  与 chromium 合成组合事件两条替代证据，**无端到端证据**；③ vault delta 的「结果集以本次拉取到的数组下标
  表达，游标 / 当前项 / 动作落点**在同一空间解释**」与实现有措辞落差——实现保留三套空间（源下标 /
  `visible` / 可选中行 `rows`），靠 `id = ITEM_ID_PREFIX${source}` + `dataset.vault` 显式映射
  （`src/vault-switcher.ts`）；toc-outline 那条的 MUST NOT（「并存两套空间**而不显式映射**」）字面成立，
  vault 这条的「同一空间」字面不成立。**Alex 的裁决口径是「delta 不动、只登记」**，故 living spec 保留
  原措辞，在此登记；④ 本 change 改了真机套件的**共享库** `scripts/acceptance/lib/ax.mjs`（value 解析认
  `Value: …`）与 `lib/execute.mjs`（`TEXT_FIELD_ROLES` 收 `AXComboBox`），M199 只重跑了 13 / 17 / 18 / 25 / 32
  五个场景，其余用到 `keys` 回读的场景本批未重跑——按 AGENTS.md 的套件执行时机，应由**批次收尾的全量套件
  运行**覆盖，不必为本 change 单独补跑。

- **两个第三方 Lezer 语法包会静默坑人：`@lezer/yaml@1.0.4` 位置越界、`@fig/lezer-bash@1.2.5` 普通 bash
  上出错**（2026-09-24，M192 提案期实测 + M197 实现期复现，medium，**待修**）：`@lezer/yaml@1.0.4`（官方）
  在「文件以空行 + 注释行开头、其后是区块映射」时产出**越界区间**（`Document [65536, 11)`，`from > to`），
  使按位置取节点的消费者（`iterate` / `resolveInner`）全部失效且**不报错**（只产出 `Stream` 与 `Comment`
  两个节点）；最小复现 `parser.parse("\n# c\nkey: 1\n").topNode.getChild("Document")`，四种对照形态（注释在
  首行 / 无注释的空行 / 内容后注释 / 空行+注释+序列）位置都正常，触发条件很窄。`@fig/lezer-bash@1.2.5`
  （社区包，2023-02 后停更）对含 `local x=1` / `$(( ))` / `function f {` 的普通脚本产出 11 个 error 节点。
  **Lumir 今天不受影响**（两者都没被使用：yaml 的着色走 `legacy-modes`，bash 不在结构表内，M197 已把 yaml
  排除出结构功能表），风险在**将来**：任何「有官方语法就接上」的决策都会踩到它。复现与读数：
  `test-results/m197/yaml-defect.txt` 与 `test-results/m197/probe/yaml-defect.mjs`（M197），
  `openspec/changes/archive/2026-09-24-code-outline/evidence/01-language-stack-survey.md` §6（M192；原指
  `.tower/worktrees/wt-192/...`，那个 worktree 路径已随 worktree 清理失效、change 也已归档，M205 改指归档路径）。
  findings：`20260924-worker-code-intel-proposal-bug-lezer-lezer-yaml-fig-lezer-bash-bash.md`、
  `20260924-worker-code-outline-impl-improve-docs-backlog-md-lezer-yaml-code-outline.md`。
  **建议动作**：① 换管线 / 加语言前先跑最小复现（不得按「有 parser 就支持」接入）；② 若真要支持 yaml 的
  结构功能，先查上游 issue（M192 检索未见对应条目）或固定到其他版本验证；bash 建议先换候选包或维持不支持；
  ③ 长期防线：把这两条最小复现做成随依赖升级跑的「语法可用性探针」（红了即拦下升级）。

### 编辑器 / 键位

- **Alt+Shift token 口径**（M132，medium）：`keyToken` 对含 Alt 组合忽略 Shift，`Alt-KeyF` 同时命中 ⌥F 与 ⌥⇧F。修法已录 spec 已知限制：Alt 分支纳入 shiftKey + 别名拆两条绑定。
- **`ConfigSnapshot.warnings` 无 UI 出口**（M132，medium）：`config.json` 中 `keys` 表的未知命令 warning 只进 console。提示文案/UI 留 UX 重做阶段。
- **toast z-index 10 衬在 ⌘/ 面板遮罩（20）下**（M133）：面板打开时非 sticky toast 自动消失可能未被看见。dogfood v0 可接受，留 UX 重做会话。
- **mermaid/frontmatter 无键盘进入路径**（M118 findings）。
- **caret 停靠隐藏边界时短暂不可见**（M118 已知外观残留）。
- **`\$` 转义误判**（M106，低优先级）。
- **mathSpanCrossed ±4KB 窗口对超大公式块的切割**（M111 review 观察）。
- **代码围栏行尾恰为 `$...$` 时跨行 Ctrl+B 一次移两字符**（M113，罕见且良性）。
- **相邻 grid 表连排时 Ctrl+N/P 每按一次过一张表**（M113，与裁决不冲突）。
- **「已被外部删除」浮条无动作**（2026-09-16 夜间批次，Alex 需求 3 复核时发现）：dirty 时
  「检测到外部修改」浮条**已有**「重载（放弃我的修改）」动作（`src/save-controller.ts:435`），
  但「当前文件已被外部删除」浮条（`src/save-controller.ts:426`）没有任何动作，只能切文件再切回。
  需求 3 据此撤销（主诉场景已被既有动作覆盖），此缺口留作顺手修。
- **文案-Copy.md D40 后空行断表 + 编号未升序**（M141 评审旁证）：既有缺陷，清扫类。
- ~~**rust 字符字面量在围栏代码块里不着色（与 code 模式的 parity 缺口）**（M147 finding，medium）~~
  `src/preview/code.ts` 的 `tagsForStyle` 遇「modifier 开头的复合 token 名」整条丢 tag（CM6 的
  `createTokenType` 只警告并保留其余 part）；rust simpleMode 的 `string.special` 触发——`'a'` 在
  code 模式取字符串色、在 ` ```rust ` 围栏里取正文色，M138 的「围栏与整文件打开 tag/颜色完全一致」
  声明对这类 token 不成立。影响面已枚举：收录语言里只有 rust（字符/字节字符字面量两种构造）。
  修法（finding 附建议 diff）：与 CM6 同语义逐名字段独立结算、跳 part 不丢整条；须配不变量测试
  （「simpleMode 复合 token 在围栏与 code 模式 tag 集合一致」）并走渲染缺陷合同先行流程核对
  rust 场景基线。finding `20260917-worker-jsonhl-bug-tag-token-rust-code.md`。
  **已核销（2026-10-07，M375，merge `b79e13a`）**：M375 按 finding 建议 diff 修 `tagsForStyle`
  （跳 part 不丢整条）、补不变量测试并先红后绿；`openspec/specs/editor-live-preview/spec.md` 的「已知例外 (a)」
  段同批删除。核销记录见「已核销」区。
- **隐藏管道符用 `display:none` 承载，是「caret 落到无位置处」缺陷族的共同结构根因**（M168 finding，
  worker-interaction-fixes-2，2026-09-18，medium）：`src/preview/livePreview.ts:482-519` 的
  `Decoration.replace({})` 隐藏管道符在 DOM 里无盒子，`coordsAtPos(pos, 1)` 退化为全零 rect、DOM 选区
  退化为行元素级位置，浏览器把原生 caret 画到下一条被绘制的行上。M168 只从落点侧规避了 ⌃E；
  **未规避面**：鼠标点 cell 右端（`posAtCoords` 给管道符位置）、⌃N/⌃P 的 `snapIntoCell`（落点
  `slot.to, assoc: -1`）、无对齐空白表格的 ⌃E（只能停到末字素之前）。历史同族：M110/M111/M113/M118/
  M132。修法 A（治根因）：隐藏管道符改零宽 inline-block widget 或给隐藏 span 显式 grid 定位，使该位置
  有可解析盒子——须先验证不产生隐式 grid 行、不吃高度，并过视觉基线；修法 B（保症状不复发）：把
  「不可停靠则回退」推广到所有落在 slot 边界的路径。推荐 A+B 并行。判据载体现成：
  `tests/visual/scenes/m168-table-cell-line-end.spec.ts` 的形态矩阵可加「slot 右缘本身可停靠」一条。
  立项时机建议随下次表格/光标专项。finding
  `20260918-worker-interaction-fixes-2-bug-display-none-caret-m168.md`。
- **cell 内容区间公式两处真源**（M185 finding，worker-cell-ctrle，2026-09-21，low）：「cell 可见内容
  区间 = slot 去掉两侧对齐空白」的算法在 `src/preview/livePreview.ts:386-395`（cell 双击选词）与
  `src/cell-geometry.ts` 的 `cellContentRange`（M185 新增）各有一份，语义逐字同构但无门禁绑定——
  REVIEW.md 第 8 条同族；将来任一侧改口径会静默分叉成「双击选词范围与 ⌃E/⌃K 的 cell 内容边界不一致」。
  修法：装饰层改为 `import { cellContentRange } from "../cell-geometry"`（纯函数、无 view 依赖），删掉
  本地内联算法。finding `20260921-worker-cell-ctrle-improve-cell-cell-geometry-review-8.md`。
- **`src/preview/*` 的 10 处构造函数参数属性阻断 unit 层直接 import `src/editor.ts`**（M185 finding，
  worker-cell-ctrle，2026-09-21，low）：`tests/unit` 是类型剥离（strip-only）运行，遇参数属性这类
  不可擦除写法直接抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`；落点 10 处：`livePreview.ts:69/147/165`、
  `math.ts:212/239`、`callout.ts:161`、`frontmatter.ts:105`、`lists.ts:12/61`、`mermaid.ts:211`。
  任何要让 unit 层测 editor.ts 内判定的 mission 都会撞上（M185 的处置是抽纯模块 `src/cell-geometry.ts`
  绕开）。收敛这 10 处写法后 unit 层可直接 import editor.ts。`tests/unit/tsconfig.json:7-10` 的注释此前
  自称「已记入 backlog」而实际没有条目——本条即该承诺的兑现。finding
  `20260921-worker-cell-ctrle-bug-tests-unit-tsconfig-json-backlog-backlog.md`。
### shell / 系统

- **退出守卫菜单结构假设**（M101 review）；Dock/系统关机路径不覆盖。
- **注册表目录 `{id}.json.tmp` 无扩展名过滤会被当注册项解析**（M126 finding；修复时顺带清掉 sweep_registry 对非 .json 文件的写面）。
- **vault 浮层打开时游标行不会被滚进可视区**（M186 finding，worker-vault-scroll，2026-09-21，low）：
  `src/vault-switcher.ts` 的 `toggle()` 里 `render()`（内含 `row.scrollIntoView`）先于
  `popover.hidden = false` 执行，而 `display:none` 子树里 `scrollIntoView` 是空操作；注册表条目多到
  超过 `.vault-pop` 的 `max-height: 60vh` 时，打开浮层后键盘游标（activeIndex）可能落在可视区外，
  只剩盲按。同族的 `src/toc.ts:260-261` 明确在可见后补滚一次，vault 切换器没补。修法同款一行：
  `hidden = false` 之后补一次 `setActive(activeIndex)`；可顺带加一条 registry 条目较多的 acceptance
  变体。未验证项：只在 Chromium 侧读代码路径，真机没跑过超 60vh 的注册表。finding
  `20260921-worker-vault-scroll-bug-vault-scrollintoview-hidden.md`。
- **「交还焦点 MUST NOT 改阅读位置」建议下沉编辑器层**（M186 finding，worker-vault-scroll，
  2026-09-21，medium，**收敛建议而非已复现缺陷**）：M186 只在 vault 切换器实现了
  「取滚动快照 → 聚焦 → 写回」，其余四条以 `view.focus()` 交还焦点的路径没有这层保护：
  `src/toc.ts:367`（大纲 Esc）、`src/search.ts:248`（⌘F 关闭）、`src/main.ts:95`（图片遮罩）、
  `src/main.ts:480`（⌘/ 键位面板）。**如实标注：这四条路径真机未复现跳动**——场景 25 末尾的对照
  步骤（⌘/ 与 ⌘F 面板滚到尾部 → 打开 → Esc → 断言渲染行仍在尾部）修前修后都 PASS。值得收的理由：
  该不变量的触发条件由浏览器接管（聚焦可编辑元素时浏览器保证光标可见），产品代码无法预测何时发生，
  四处各写一份必然漂移（REVIEW.md 第 8 条）。修法：`src/editor.ts` 暴露
  `focusPreservingReadingPosition()`（scrollSnapshot → focus → dispatch），四处调用点统一改用，
  main.ts 的 vault 切换器两个 dep（readingPosition / restoreReadingPosition）可顺带收回；spec 条款措辞
  收口时上移到编辑器/交互维度。finding `20260921-worker-vault-scroll-idea-must-not-m186-vault.md`。

  **部分落地（M277，2026-09-27）**：`src/editor.ts` 的 `focusPreservingReadingPosition()` 已按同一份
  收敛建议实现（取阅读位置 → `view.focus()` → 经 `readScrollPosition` / `applyScrollPosition` 写回，
  三步同帧、MUST NOT 裸写滚动容器），`src/code-block-fullscreen.ts` 的 `restoreFocus` 已经用它
  （M274 实测：WebKit 下裸 `focus()` 把 `scrollTop` 从 2750 拽到 0）。~~**仍未收口的是上面那四条**：
  `src/toc.ts`（大纲 Esc）、`src/search.ts`（⌘F 关闭）、`src/main.ts` 的图片遮罩与键位面板仍用裸
  `view.focus()`（以及表格全屏——它今天也还是裸 `view.focus()`，同族缺陷待同一批收口）。~~

  ~~**已收口（M280，2026-09-27）**~~：上面那五处（四条 + 表格全屏）全部改走原语；原语本身搬进
  `src/scroll-position-view.ts`（facade 只转发），并修掉第二半根因——运行期**不许**在聚焦后就地
  复核落点（那一拍布局还没反映引擎的滚动，差值恒为 0 ⇒ 写回被自己那句「落点 ≤ 0」吃掉，M279 的
  T4b 实测）。条款落在 [docs/design-parity-contract/overlay-close-reading-position.md](../design-parity-contract/overlay-close-reading-position.md)
  的 CL-1（含输入分布与判别层表）；判别用例 `tests/visual/scenes/m280-overlay-esc-scroll.spec.ts`
  的 `webkit-realua` project（真机同款 UA）；真机层只拿到场景 40/62 的回归护栏（见下条 5）。
  **仍未收口的残余两条**另行登记：
  ① vault 切换器仍走 CM 的 `scrollSnapshot` 通道（同一语义的第二份实现，REVIEW.md 第 8 条）；
  ② 捕获锚落在文档原点时运行期不写回（M110 口径的遗留，触发条件窄）。

### 未复现

- **编辑区全空白偶发**：M114 一次、M116 0/3，复现条件未锁定。运行时诊断日志已落地（M134，
  2026-09-16），下次复现后查 `<config_dir>/lumir/logs/<UTC日期>.jsonl` 的事件序列定位。
- **视觉套件 `markdown-parser` 的 `large-mixed` 偶发失败**（M144 一次，低）：整轮视觉回归里它 `page.evaluate: TypeError: Cannot read properties of undefined (reading 'metrics')` 失败一次（该用例把 `mixed` 文档重复 2000 次喂给解析实验，并挂 CDP profiler 采样），单独重跑与随后整轮重跑都 10/10 PASS。现场没有留下可归因的线索（不是本批次的改动路径——该 fixture 是独立的 vite 子应用，不加载 `src/`）。**给后续跑 `gate.sh visual` 的人**：它若偶发报红，先单独重跑该 spec 再判断，别当成自己的回归。
- **`paragraph.spec.ts`「普通段首对齐 640」全量轮瞬态失败一次**（reviewer-toc finding，2026-09-17）：程序设 DOM 选区后下一拍 `getSelection()` 读到 `""`（预期 `普通段落不再缩进`）；隔离复跑 2/2 PASS、第二轮全量 8/8 PASS，与 M148 diff 无因果（toc 不产生装载后的编辑器 dispatch）。疑似全量负载下 CM 装饰重建把文本节点替换、Range 脱离导致选区坍缩——既有测试的时序敏感面；若发生在 CI 会红掉无关 mission 的门禁。修法：选区断言改为「同一 evaluate 内设选区并立即回读」，或读取端加 `expect.poll` 重试（`tests/visual/scenes/paragraph.spec.ts:38-39`）。finding `20260917-reviewer-toc-bug-paragraph-spec-ts-640-flake.md`。
- **表格 / 代码块全屏 ESC 关闭时的视口跳变**（M274 survey，2026-09-28 裁决降优先级）：M274 在 Alex 的真实文档 + 他的 config（`content_width 1200` + eink）上实跑**没能复现**——caret 关在视口下方 ~800px、`⌘J` 开遮罩、`ESC`，视口读数一动不动；叠加「WebKit 只在 caret 位于视口上方时揭示」的实测 ⇒ 他的那次跳变（视口向下）不是关闭路径的聚焦揭示。当时排除了延迟揭示、选区同步、外部 fs 变更期间关闭与配置差异，剩余候选与判别实验落在 M274 报告 §7（CM 锚定累计 dist / 触控板惯性 / 未命中几何；真机 hover 钮路径因后台窗口不触发 CSS `:hover` 未能驱动）。**Alex 2026-09-28 裁决**：当前 master **不能复现** ⇒ §7 的判别实验**降优先级**，不排后续 mission；该跳变若再现，按 §7 的三条候选重开（相关收口：M280 的 CL-1「交还焦点 MUST NOT 改阅读位置」与 M286 的外部重载收口都在其后落地，本裁决未对它们的因果署名）。

### 验收套件（M144 实测出的表达力缺口）

- **套件缺 `scroll` 动作与页内采样：滚动类缺陷只能用翻屏键近似，亚秒级滚动自校正观察不到**（M187
  finding，worker-svg-scroll，2026-09-21，medium，**待修**）：`scripts/acceptance/lib/execute.mjs` 的
  动作表没有 scroll（`lib/cu.mjs:184` 的 MCP scroll 封装未接进场景 DSL），「慢速倒序滚动」在验收层
  表达不了——M187 只能用 ⌥V 翻屏键近似（每步 600px，等于快滚，而缺陷恰在慢滚时出现）。同时套件
  读不到 scrollTop、每个断言一次 MCP 往返（数百毫秒），观察不到「重建瞬间行块压缩 → CM 滚动锚定推走
  → 字节到达推回」这类毫秒级自校正（两次位移相差一次附件字节到达）。结果：本类缺陷在验收层只能写成
  终态护栏（场景 26 即如此，notes 已如实声明修前修后都绿），判别性验证只能落 chromium 通道
  （`tests/visual/scenes/m187-image-scroll-stability.spec.ts`，可注入 wheel + 逐帧采样）。修法
  （任选其一即可让本类缺陷进验收层）：① execute.mjs 暴露 `scroll` 动作（`{deltaY}` 或 `{page}`，
  走 cu.scroll / 逐次 wheel 注入）；② 加 `sample` 动作跑注入的 rAF 采样器记录 scrollTop 时间线供
  逐点断言——两者都可复用 `test-results/m187/probe-baseline-after.spec.ts` 的采样器与判据
  （「非用户输入的 scrollTop 变化 > 8px」）。finding
  `20260921-worker-svg-scroll-improve-scroll.md`。
- **真机套件造不出 DOM 的 `dblclick`（四条注入通道实测），双击类交互无法在真机层驱动**（M184 finding，
  worker-lightbox-impl，2026-09-19，high，**待修**）：坐标 `count: 2`、AX 索引 `count: 2`（AXPress ×2）、
  两次独立 `click`、`drag_paths` 两条单点路径——四条通道下「双击文件树行 = 新开固定标签」的对照判据都
  停在 1 个标签，而同一点位单次点击正常 ⇒ 落点准确、缺的是 clickCount。影响面：以 dblclick 为唯一打开
  路径的交互（M184 图片放大查看）无法在真机层验收，M184 因此按裁决 A+C 收口（chromium 层判别 + Alex
  人工清单）。修法（按优先级）：① KimiCU 侧给 `click` 加 clickCount 控制（`kCGMouseEventClickState = 2`
  一次性投递），用该 finding 的对照实验验证；② 在此之前真机层不覆盖双击类交互，人工补验（README
  「已知边界」已记）。附带：`lib/cu.mjs` 里 M184 期遗留的 `doubleClick` 包装（造不出 dblclick 的死代码）
  随本条一并处置。**已核销（M209 探针 + M208 归档节点 2，2026-09-25）**：第五条通道实测**可用**——
  `/usr/bin/swift` + `CGEvent` 显式投递 `kCGMouseEventClickState`（两次 down/up、间隔 60ms）能在
  WKWebView 里造出真实 DOM `dblclick`，且已接进套件（`scripts/acceptance/lib/cgevent-click.swift` +
  `doubleClick` 动作；`scripts/acceptance/README.md` 的「已知边界」条已按实测订正）。同时本条引用的
  **判据本身不成立**：「双击文件树行 → 标签数 1→2」恒不成立（`openFile` 对已打开的同路径短路，
  `src/main.ts:380-386`），它既不能证明也不能证伪通道——M184 的「四条通道都造不出 dblclick」推理据此
  作废。承接面：真机场景 `scripts/acceptance/scenarios/33-image-lightbox.md`（2026-09-24 真机 PASS
  36 断言、反向验证 FAIL 7 红），即 change `open-image-lightbox` 的 6.1–6.3 / 6.5 / 8.3 未勾项已由
  M209 补做。**遗留一条**：上面那个附带项（`lib/cu.mjs` 的死包装）**仍未删**——M209 新增的是
  `lib/execute.mjs` 层的同名动作，与它不同层，未合并；随下次动 `lib/` 时清理。finding
  `.tower/comms/findings/20260919-worker-lightbox-impl-improve-dom-dblclick-wkwebview.md`（含四条通道
  复现配方，现场 `test-results/m184/13`～`/17`）。
- **`ax.mjs` 的 `parseNodes` label 提取被嵌套括号截断，按名定位图片节点永远匹配不上**（M184 finding，
  worker-lightbox-impl，2026-09-19，medium，**待修**）：`scripts/acceptance/lib/ax.mjs:47` 用
  `/\(([^)]*)\)/` 取 label，遇嵌套括号截在第一个 `)`；图片节点的 AX label 恰好是整条 Markdown 引用原文
  `![alt](path)`，被截成缺右括号形态，`target.name` 照原文写（含 `\)`）永远报「找不到带 bbox 的节点」。
  `ax: has/count` 类断言不受影响（匹配 dump 全文，不经 `label`）。修法：label 提取换成允许一层嵌套的
  形态（`/\(((?:[^()]|\([^()]*\))*)\)/`），改完逐条核现有场景的 `target.name`（带 `^…$` 锚点的优先）。
  finding `.tower/comms/findings/20260919-worker-lightbox-impl-bug-acceptance-parsenodes-label-alt.md`。
- **场景证据目录跨 run 不清空，`ax/` 与 `shots/` 累积→读 dump 无法分辨新旧**（M182 finding，
  worker-img-width-fix，2026-09-18，medium，**待修**）：`scripts/acceptance/lib/evidence.mjs:30-37` 的
  `startScenario` 只 `mkdirp`，不清理上一次 run 的 `ax/` 与 `shots/`；同一天重复跑同一场景（迭代调试的
  常态）时序号重新计，旧文件被覆盖一半、留下一半——实测同一场景目录里同时存在两轮的 `01-首开.txt` /
  `02-切回.txt`，读数分属两轮，复盘时可能把上一轮 dump 当本轮结论（REVIEW.md 第 2/7 条同族）。本次为把
  红/绿证据归档成可复核目录，只能每次手动 `rm -rf` 场景目录再跑。修法：`startScenario` 里清掉 `ax/` 与
  `shots/`（或整目录重建），并把「一次 run 的目录只含本次 run 的产物」写进 scripts/acceptance/README.md
  的证据布局一节。finding `.tower/comms/findings/20260918-worker-img-width-fix-bug-run-ax-shots-dump.md`。
- **`ax.mjs` 取 `AXTextArea.value` 用非贪婪正则，文档含半角 `"` 时断言真假双向失真**（M180 finding，
  worker-wrap-impl，2026-09-18，medium，**待修**）：`scripts/acceptance/lib/ax.mjs:36` 的正则遇半角
  引号即截断 value——`editor.has` 假红、`editor.not` **假绿**（负断言在截断文本上找不到目标串而
  「通过」）。M180 的真机探针因此刻意不含 `"`；reviewer-wrap-impl 已独立核实真实性。修法：value
  抽取改走结构化解析（AX dump 的字段边界）或转义感知正则，并补一条「文档含引号」的反向验证场景。
  finding `20260918-worker-wrap-impl-bug-acceptance-ax-value-editor-not.md`。
- **验收套件 `config` 通道只透传 `keys`，`[editor]` 新配置项无法构造启动口径**（M180 finding，
  worker-wrap-impl，2026-09-18，medium，**待修**）：`scripts/acceptance/lib/execute.mjs:364` 的
  `config` 步骤把 `mode` 写死、只透传 `keys` 表——M180 新增的 `editor.line_wrap` / `editor.code_block_wrap`
  无法在真机构造「启动口径来自 config.json」的场景，该接线只能在视觉层验（桩外再包一层 `config_get`）。
  修法：`writeConfig`/config 通道按表透传（或显式加 `editor` 可选字段），与 M180 已落地的
  `app.mjs writeConfig` 两可选字段对齐。finding
  `20260918-worker-wrap-impl-improve-acceptance-editor-mode-keys.md`。

- **`click` 动作不支持修饰键**（M144，medium）：`lib/execute.mjs` 的 click 只有 `target` / `count`，没有
  modifier 参数，因此「⌘-Click 跟随链接」这条路径**在真机套件里无法触发**（⌘⏎ 可以，键位动作支持 chord）。
  M144 改用视觉场景覆盖该路径（`tests/visual/scenes/render-link.spec.ts`：stub 记录
  `open_external_url` 的调用目标，断言开的是哪个 URL 且不真开浏览器）。修法：给 click 动作加
  `modifiers: ["meta"]`（KimiCU 的 `click` 底层已支持 mouse_button，修饰键需在 `cu.mjs` 侧按住 meta 再点）。
  **M144 裁决：套件能力改造另开 mission，本批不做。**
- **`type` 动作 `clear:true` 的残余假绿形态**（reviewer-typefix finding，low，pre-existing）：
  clear:true + 旧内容恰好已含一次目标串 + 注入整体 no-op 时，classify 会误判 landed。无任何场景使用
  clear，未被 M143 的 diff 触及。finding `20260916-reviewer-typefix-bug-type-clear-true-no-op`。
- **`checkScenario` 不校验 `do: type` 的 `text` 非空**（worker-typefix finding）：漏写 `text:` 会在
  真机跑成注入 `undefined` 后连报 3 次未落地，而非在 `--check` 阶段就报。
  finding `20260916-worker-typefix-improve-checkscenario-do-type-text-undefined`。
- **`click` 的 `target.name` 与断言的匹配口径不一致**（M148 finding，low）：`findNode`
  （`lib/ax.mjs`）是裸 `new RegExp(name)` 语义（无 `m` flag），断言侧 `matcher()`（`lib/execute.mjs`）
  才是「`/.../`=正则、其余=子串」——`target: { name: "/第一部分/" }` 会去找字面量「/第一部分/」
  而报「找不到可点节点」，与「控件真的不存在」无法区分（M148 为此多跑一整轮真机）；`m` flag 之差
  还决定 `^…$` 是整串锚定还是行锚定（`AXTextArea.value` 是当前渲染区间的行文本、可能跨行，行锚定会误命中编辑器节点）。
  根治法：寻址与断言共用 `matcher()`（提到 `lib/` 公共位置，裸串=子串、RegExp 对象保持原行为）；
  这是全部场景共用的寻址入口，改完需一次全量真机复验，单独立项，不塞进功能 mission。临时口径
  （用 `help` 寻址 / 锚定裸正则）已写进 `scripts/acceptance/README.md` 已知边界。
  finding `20260917-worker-toc-improve-click-target-name.md`。
- **AX 文本可读 ≠ 元素可见：WKWebView 会暴露不可见 svg 的内部文本**（M178 finding，
  worker-svg-impl，2026-09-18，high，**待修**——`scripts/acceptance/README.md` 已知边界加一条）：
  M178 反向验证实测，图片被回退成「735×10 细条」的那版实现里，AX 树照样读得到 svg 内部 `<text>`
  （`AXStaticText = "percent fixture"`）与 alt——拿「AX 里有这段文本」当可见性判据会得到恒真断言
  （REVIEW.md 第 1/2 条同族）；修复版同节点几何 315×106。口径：可见性断言用**带 bbox 的节点几何**
  （`AXImage` / `AXButton` / 文本域给 `@x,y w×h`）；带 `<text>` 的 svg 在 AX 上是无 bbox 的
  `AXGroup`，**不能用来判尺寸**；负向断言必须与同一位置、有几何或结构依据的正观测配对。范式写法
  （`AXImage … @[0-9,-]+ [0-9]+×([5-9][0-9]|[1-9][0-9]{2,})` 计 1）与两条实测读数在 finding 里。
  证据：空白版 AX/截图原目录 `blank-impl-reverse-verification` 已在 playwright cwd 事故中灭失
  （见「视觉套件与整页基线门禁」节同日期条），关键读数留在 M178 tasks.md 证据节与评审记录；修复版
  证据 `test-results/acceptance/2026-09-18/20-image-fallback/`。finding
  `20260918-worker-svg-impl-bug-ax-wkwebview-svg.md`。

### 视觉套件与整页基线门禁（M178/M179 登记，2026-09-18）

- **`tauri-stub.ts` 缺 `fs_read_attachment`：chromium 视觉层此前从未真正渲染过一张图片**（M178
  finding，worker-svg-impl，2026-09-18，medium，**待修**）：`tests/visual/scenes/tauri-stub.ts`
  的 invoke 路由没有 `fs_read_attachment`，缺省抛 `unknown_command`——此前所有视觉场景里的图片
  引用一律落「读取失败」占位；`markdown-combo.spec.ts:34` 的无区分度断言（成功 / 白板 / 报错三态都
  满足）长期存活的部分原因即此。M178 已在该场景内用 `stubAttachmentReads()`（`page.addInitScript`
  包 `__TAURI_INTERNALS__.invoke`）解决本场景，但每个新场景都要抄一遍。修法：桩路由补
  `fs_read_attachment`（`files[path]` → UTF-8 → base64，未收录抛 `fs_not_found`，与 Rust 侧
  `read_attachment` 错误形态一致），并把「图片 / 二进制 fixture 用文本内容表达、空串 = 0 字节」的
  约定写进注释与 `tests/visual/README.md`；补完后删掉场景内的本地包装。finding
  `20260918-worker-svg-impl-improve-fs-read-attachment-chromium.md`。
- **playwright 从错误 cwd 启动会清空 `cwd/test-results`，与验收证据根同名碰撞**（M178 评审实测，
  reviewer-svg-impl，2026-09-18，medium，**待修**——(c) 防线句并入下一批 hygiene，(a)/(b) 待
  Alex 裁决是否立项）：在仓根（无 playwright.config.ts 的目录）跑 `npx playwright test <scene>` 时
  playwright 回落默认配置且 outputDir=cwd/test-results，**启动即清空该目录**——M178 评审中 wt-178
  的 `test-results/acceptance/2026-09-18/` 真机证据被整个抹掉（reviewer 复跑重建
  20-image-fallback；`blank-impl-reverse-verification` 与 `engine-diff-width0` 两目录灭失，关键读数
  已留在 M178 tasks.md 证据节与评审记录）。根因 = 验收套件证据根（仓根 `test-results/`）与
  playwright 默认 outputDir 同名；视觉场景自身 outputDir（`tests/visual/test-results/`）不受影响，
  只有「错误 cwd + 默认配置」这条路径踩中。候选防线：(a) 仓根放最小 playwright.config.ts 显式
  outputDir 并对错误 cwd 报错；(b) 验收证据根改名（如 `acceptance-results/`）；(c)
  `tests/visual/README.md` 与 `scripts/acceptance/README.md` 的「手动单跑」节各加一句防线 + 并入
  REVIEW.md 第 13 条证据节。finding
  `20260918-reviewer-svg-impl-bug-playwright-cwd-cwd-test-results-wipe.md`。
- **整页 0.001 容差（960px）与「局部改色」真实变化同量级：M179 实测 958/960 差 2 像素静默假绿**
  （M179 finding，worker-yaml-hl-impl，2026-09-18，medium，**待修**——①并入下一批 hygiene，
  ②③待 Alex 裁决）：把 yaml 键色改回旧值，新增 1200×800 整页基线差异 958 像素，全局
  `maxDiffPixelRatio: 0.001` 额度 960 像素 → 门禁通过（真变化被吞）；与 REVIEW.md 第 3 条已收的
  mermaid 952/960 同族，但风险面更宽——「只在局部改颜色」的修复其像素量天然落在 100–1500 区间，
  与 960 同阶，整页基线对这类变化是掷硬币式门禁（现有约 20 处整页像素断言里 codeblock / callout /
  toc 都在风险带）。对照：同批元素级那张（766×29，额度 22）差异 92 像素 → 红，元素级区分度够。
  M179 已就地处置：该断言显式覆盖 `maxDiffPixelRatio: 0.0005`（480，留 2 倍余量），读数写进断言
  注释与 design §5。候选：① REVIEW.md #3 补证据 + 防线句「局部改色必须反向验证并按区域截图或
  显式收紧容差，判据 = 实测差异像素数 / 该图额度」；② `expect-screenshot.ts` 在像素模式把每次比对
  的实际差异像素数 / 额度打进 stdout（低成本可观测化）；③ 局部改色断言长期改区域截图。证据：
  `test-results/m179/07-wholepage-diff-count.log` / `06-reverse-verification.log`。finding
  `20260918-worker-yaml-hl-impl-improve-0-001-960px-m179-958-960-2.md`。

### Rust 侧主线程与锁（M154 survey 遗留）

- **`apply_fs_changes` 持 VaultState 锁逐文件做磁盘 IO；`vault_current` 持锁跨全量 scan**（M154 finding，
  worker-rustasync，2026-09-17，medium，**待修**——两处小改、行为等价）：
  `src-tauri/src/commands.rs:172-193` 的 watch 回调在 `let mut inner = self.inner.lock()` 之后，循环里对每个
  变更文件调 `fs_io::read_text_file`（磁盘读 + 双 canonicalize）再 upsert，整批持锁：实测真实 vault 全量
  1341 md = 112.1ms、4× 合成 6100 md = 753.0ms（0.084–0.123ms/文件）。它跑在 `lumir-fs-debounce` 线程上
  （不是主线程），所以是**后台线程持锁挡主线程**——批量变更（git checkout、同步客户端批量回写、批量改名/
  删除）会把整段锁窗口压给主线程的 `link_graph_resolve`（每个 wikilink 渲染都调）、`wikilink_create` 与
  `document_save`。修法（不需要 async）：先在锁外把本批 md 内容读成 `Vec<(path, Option<String>)>`，再取锁
  循环 upsert，持锁降到微秒级（读失败保持现有「宁缺毋滥」语义）。同 file `commands.rs:375-390` 的
  `vault_current` 在锁内调 `reconcile_vault`（含 `sweep_registry` 写盘）与 `scan_workspace`（14ms）；
  `fs_scan_workspace`（`:394-398`）已是正确形态（`state.root()` 短锁 clone 后 IO 在锁外），对齐即可。
  **注意两件事正交**：收窄锁**不会**把 IO 移出主线程，别把「收窄锁」当成「不阻塞主线程」。tower 处置
  建议：P2，与启动恢复移出主线程那次改造（旧编号第 12 条，见「已核销」2026-09-18 条）分开处理（本项可直接做）。finding
  `20260917-worker-rustasync-improve-apply-fs-changes-vaultstate-io-vault-current-scan.md`。

### 启动恢复让位判定与提交返回值（M171 遗留）

- **`finish_restore` 让位判定的第二操作数 `root.is_some()` 零测试、且可达**（M171 finding，
  worker-rm-dead-param，2026-09-18，medium，**待修**）：`src-tauri/src/commands.rs:178` 的拒绝条件是
  `inner.generation != generation || inner.root.is_some()`，而现有测试**全部只把第一个操作数走到 `true`**
  ——`finish_restore_discards_stale_success_and_keeps_user_vault`（`:1120`）、
  `finish_restore_discards_stale_notice`（`:1136`）、`restore_pending_clears_on_every_end_path`
  的「过期丢弃」段（`:1193-1199`）、`finish_restore_rejects_mismatched_generation_without_side_effects`
  （`:1207`）与集成场景 `src-tauri/tests/workspace_scenarios.rs:287`（断言在 `:297`）——它们在
  「先 `begin_restore` 拿到世代、之后才提交 B」的时序下，比对必然落在世代不符上，第二操作数从不被单独判定。
  **可达性（两处代码事实）**：① `begin_restore` 跑在恢复线程上——`src-tauri/src/lib.rs:393-397` 的
  `start_restore` spawn `lumir-vault-restore`，`:473` 的 `restore_last_vault` **第一句**才取世代；用户若
  在这次 spawn 之后、那一句之前成功打开自己的 vault（`vault_open` → `commit_vault_open` → 世代 +1），
  `begin_restore` 记下的就是**打开之后**的世代。② 前端没有把「打开 vault」挡在恢复结束之前——
  `restore_pending` 在 `src/` 里只有 `src/main.ts:784` 一个消费者（空树时用它选 `RESTORING_NOTICE`
  文案），`vault_open` 链路（`src/ipc.ts`、`src/vault-switcher.ts`）不看它。两条合起来：恢复线程随后
  `finish_restore(该世代, Opened(...))` 时世代相等，**唯一挡住「恢复结果盖掉用户已打开的 vault」的就是
  `root.is_some()`**。**影响**：谁若认为「世代比对已蕴含一切」而删掉第二操作数，现有测试不会红——删掉的
  正是这道门。**修法**（finding 已给具体测试，放同一文件的既有测试区即可）：`commit_vault_open(&state,
  prepared(&b))` 先提交 B → 再 `begin_restore()` 取世代 → 断言取到的世代**等于**当前世代（这是「拒绝
  来自第二个条件」的显式证据）→ `assert!(!state.finish_restore(世代, Opened(prepared(&a))))`，并断言
  root 仍是 B、世代未跃迁、notice 为 None、pending 已清。任何后续动 `commands.rs` 的 mission 可顺带做。
  finding `20260918-worker-rm-dead-param-improve-m171-finish-restore-root-is-some.md`。
- **`commit_vault_open` 的 `-> bool` 在删参后恒为 `true`，且无生产消费者**（M171 同批观察，
  worker-rm-dead-param，2026-09-18，low，**待修**）：`src-tauri/src/commands.rs:330-334` 在 M171 删掉
  `expect_generation` 参数后只剩「无条件提交」——函数体是 `inner.commit(prepared); true`，取值面已塌成
  常量（唯一能返回 `false` 的路径随被删的比对一起消失）。生产调用点只有 `:372` 的
  `commit_vault_open(state, prepared);`（忽略返回值、无分支），消费它的只有单测的 `assert!`
  （`:1096` / `:1125` / `:1140` / `:1197` / `:1212`）与集成场景 `src-tauri/tests/workspace_scenarios.rs:297`
  ——REVIEW.md 第 9 条（声明了没有消费者的值）的同族，形态从「死参数」变成「死返回值」。**修法（二选一，
  随下次碰该文件的 mission 顺带做）**：改签名为 `()`，把 6 处 `assert!(commit_vault_open(...))` 改成裸调用；
  或保留 `bool` 并在 doc 注释里写明「恒 `true`，为将来的条件化提交留位」。**与上文的关系**：本文件
  「多 vault 收口遗留」节里 `commit_vault_open` 的 `Some(expect_generation)` 无生产消费者那条，其处置建议
  的「删掉参数」那半**已由 M171 落地**（`efd27f1`，merge `5a944e5`；该条正文按原样留痕，未改），本条记的
  是删参后剩下的那一半。观测出处：M171 review-request 的「未做项」第 1 条
  （`.tower/comms/inbox/20260918-worker-rm-dead-param-tower-review-request-m171-expect-generation-finish-restore-tip-148.md`，
  会话内文件，留名备查）；同一 finding 文件
  `20260918-worker-rm-dead-param-improve-m171-finish-restore-root-is-some.md` 记的是上一条。

### 门禁测量与 CI 环境（治理批遗留）

- **`fs_io::tests::watch_dir_rename_delivers_full_subtree` 时序 flake（M283 r1 评审现场，2026-09-28，low，待观察）**：
  reviewer-vault-perf-m283 独立复跑 `scripts/gate.sh quick` 时 `cargo test` 红了这一条，红的是
  「改回原名后 tutorial 必须进增量，批次：**`[]`**」——即整个收集窗口里**一个批次都没到**；
  随后**隔离复跑该用例与全量复跑 `gate quick` 均转绿**，且 M283 的 diff 不含
  `src-tauri/src/fs_io.rs`（`git diff --name-only` 可核）⇒ 判定为该用例自身的时序敏感面，与 M283 无因果。
  **形态（代码事实）**：它是真 FSEvents 流上的用例（`src-tauri/src/fs_io.rs:1353`）——固定 `sleep 700ms`
  建好目录树 → 起 watch + `seed` → 固定 `sleep 500ms` → `rename` 后 `collect_batches(&rx, 1500ms)`
  收批次，再逐条断言「改名后的新路径必须进增量」，**没有重试**。FSEvents 的合并窗口（`DEBOUNCE`）与机器
  负载都会影响批次到达时刻，窗口外到达即 panic（成因**未坐实**，本轮只有一次红、无重复读数）。
  **影响**：它在 `gate quick` 的 `cargo test` 里，负载高的机器上偶发红会打断无关 mission 的自验
  （本次就是评审侧首轮撞上、复跑转绿——reviewer 的判定与处置见评审 r1 的 Decision）。
  **修法方向（未做，动前先复现）**：断言侧改成带 deadline 的轮询（`wait_until(condition, deadline)`
  代替「固定窗口收集后一次性断言」），或把 debounce 窗口做成可注入参数让用例不受环境负载影响；
  先按「拉高负载跑 N 轮」记录红率，再决定阈值。

- **keypress-to-paint 读数疑似帧量化，统计量宜从 median 改 min/p10**（M174 评审副产物观察，
  2026-09-18，low，**待裁决（是否立项改统计口径）**）：CI 的 9 次 keypress 读数（22.35–53.20ms）
  与 33.3ms 帧间隔呈量化关系，median 对这类量化分布既不敏感也不稳定；min / p10 更贴近「最好可达」
  的渲染耗时。**需先取 CI 原始 samples 证实量化假设再动 spec**；落点会是
  `tests/perf/thresholds.json` 的 `gate` 字段与 `docs/specs/perf-measurement.md` 判据节。
- **CI runner 字体 / 渲染链探针（可选，纯诊断）**（M172 §7 分支 2 建议、M173 声明留白，
  2026-09-18，low）：visual 红的环境根因（runner 侧字体解析）未被直接证实，只是排除了其它候选
  （基线 sha256 40/40 相同、浏览器构建两侧同一、确定性复现）。像素对比已归本地，该探针只剩诊断
  价值——仅当未来想把像素层拿回 CI 才需要。做法：一次性 workflow 步骤跑 `system_profiler
  SPFontsDataType` + 页面内 `document.fonts.check()`，与本地对照。不立项不影响任何现行门禁。

### 文档指针与门禁清单

- **M205 归档后残留的仓内旧路径指针**（2026-09-24，M205 登记，low，**待修**）：五个 change 归档后，仓内仍有
  若干文件按**旧路径** `openspec/changes/<id>/` 指向已移入 `openspec/changes/archive/2026-09-24-<id>/` 的制品
  （归档目录内部制品之间的指针已随归档改准，这里列的是**外部**指针）。逐条（以
  `rg 'changes/(code-outline|code-variable-highlight|list-filter|typography-and-zoom|remember-reading-position)'`
  实测）：① `src/code-structure.ts:118`（指向 code-outline 的 `specs/toc-outline/spec.md`）与
  `src/toc.ts:141`（指向 code-outline 的 `tasks.md` 5.1）——**`src/` 改动不在 M205 的 scope**，按 M181 先例
  （同型的 `src/preview/attachments.ts:253` 当年投 finding）在此登记；② `src/vault-switcher.ts:28`
  （list-filter 的 `specs/vault-workspace/spec.md`）与 `src/code-identifiers.ts:121`（code-variable-highlight 的
  `evidence/03-identifier-positions.md`）——同一条，M205 实测新增；③ `src/code-identifiers.ts:46-53` 的
  「已知边界」段仍把 `with … as` / 推导式 / 海象 / 模式匹配等列为「**未实测**」，而**同一文件** `:197-217`
  的判据表已按 M198 实测落了规则并注明「design §7 点名的未实测形态已补实测」——两段自相矛盾（low）；
  ④ `文案-Copy.md:106` / `:112`（指向 code-outline 的 `tasks.md` 5.1）与
  `scripts/acceptance/scenarios/30-code-outline.md:168`、`31-code-variable-highlight.md:153`、
  `32-list-filter.md:258`——非 openspec 制品，M205 的 scope 不含；⑤
  `scripts/acceptance/scenarios/29-typography-and-zoom.md:4` 的 front-matter `title` 仍在宣传「`⌘⇧=` 的可见
  结果」，与正文已如实登记的「该形态真机未验」不符（旧版残留）；⑥
  `scripts/acceptance/scenarios/28-remember-reading-position.md:104` 的「15 条」应为 **17 条**（与 M205 对
  tasks 同批订正的同一处数字）。**动作**：下次动到 `src/` 或这些文档的 mission 顺手改指归档路径 / 改准数字，
  或单立一条清扫 mission。这些指针不影响任何门禁（`scripts/docs-check.sh` 不查相对链接、`validate` 不查路径），
  但 REVIEW.md 第 7 条的口径是「写不出可 `ls` 的指针就等于没跑」。
- **M208 归档后残留的仓内旧路径指针（两处）**（2026-09-25，M208 登记，low，**待修**）：`document-end-marker`
  与 `open-image-lightbox` 归档后，仓内仍有两处按旧路径 `openspec/changes/<id>/…` 指路（归档件内部指针已随
  归档改准，这里列的是外部指针）：① `src/preview/attachments.ts:415` 的注释指向
  `openspec/changes/open-image-lightbox/design.md` §4.4——`src/` 不在归档 mission 的 scope，按 M205 先例
  只登记（Alex 节点 2 已裁决「只登记 `docs/backlog.md`，不在 M208 改」）；②
  `scripts/acceptance/scenarios/33-image-lightbox.md:151` 的「覆盖」表指向
  `openspec/changes/open-image-lightbox/tasks.md`——非 openspec 制品，同 M205 先例由下次动
  `scripts/acceptance/**` 的 mission 顺带改指 `openspec/changes/archive/2026-09-25-open-image-lightbox/tasks.md`。
  两处都不影响门禁（`docs-check.sh` 不查相对链接、`validate` 不查路径），但 REVIEW.md 第 7 条要求指针可 `ls`。
- **门禁清单三处过期**（M153 finding，worker-testinfra，2026-09-17，low，**已核销**：2026-09-18 治理批
  收尾由 tower 直改闭合，核销记录见「已核销」区）：M153 给
  `gate.sh quick` 加了 `docs-check` 与单测层、给 visual 层加了 isolation 断言，三处复刻门禁清单的文档随之
  过期——① `AGENTS.md:32-34` 逐行复刻了 `scripts/gate.sh` 的用法（现缺 quick 的 `docs-check` 与单测层
  `tsc-unit` + `unit-tests`，也缺 visual 层的 `isolation-runs`）；② `tests/visual/README.md` 全篇未提
  `tests/visual/isolation.test.mjs`（2 用例 / 7 条隔离断言，此前无人运行）；③ `README.md:62` 的
  `visual.yml` 行未提它现在也跑隔离断言。tower 处置建议：① 按 finding 的意见**直接删掉 AGENTS.md 那 3 行
  用法副本、只留指向 `scripts/gate.sh` 的指针**——那 3 行本来就是 gate.sh 头注释的副本，而 AGENTS.md 自己
  的原则是「不复制有 canonical 居所的内容」，删副本才是根治，否则下次改门禁还会漂；②③ 就地各补一句。
  finding `20260917-worker-testinfra-improve-agents-md-gate-sh-tests-visual-readme-md-isolation-readme-vi.md`。
- **四处「代码落点」指针在 M151 拆分后失准**（M151 finding，worker-mainsplit，2026-09-17，medium，**待修**；
  spec 的 SHALL 判据仍成立，只是措辞不精确）：① `文案-Copy.md:91`——键位面板（D63–D67）文案在
  `src/main.ts` 的 `createBindingsPanel` → 实为 `src/bindings-panel.ts`；「链接目标不存在」（D81）与
  「暂不支持锚点跳转」（D82）在 `src/main.ts` 的 `followNoteLink` / `followLink` → 实为
  `src/link-follow.ts`；且「与键位面板把文案写在 `main.ts` 的写法并列」这个前提已不成立（两者都是独立
  模块）。② `src/shell.ts:5,13`——标签栏条目「由 src/main.ts 渲染」→ 实为 `src/tabs.ts`（shell 只给容器
  这一点未变）。③ `openspec/specs/keymap-commands/spec.md:10`——「文档与链接命令在装配层 `src/main.ts`」
  在指向上已不精确：命令**表与 runner 装配**确在 main.ts（`link.follow` → `linkFollow.followAt(...)`、
  `tab.*` → `tabs.*`），但链接能力本体在 `src/link-follow.ts`、标签能力在 `src/tabs.ts`；M127 起 save
  命令已是这个形态（`document.save` → `save.save()`），spec 措辞自那时起就没跟上。
  ④ `scripts/acceptance/scenarios/14-tabs.md:166-167` 同形（标签栏现在 `src/tabs.ts`，打开意图 `openFile`
  与命令表仍在 main.ts）。tower 处置建议：约 6 行改动一次收口，随下次碰这些文件的 mission 顺带做即可，
  不必单开 mission；spec 那句按 finding 的措辞改写为「命令的归属与 runner 装配在装配层 `src/main.ts`，
  能力本体在各自模块（editor / save-controller / link-follow / tabs / bindings-panel）」。finding
  `20260917-worker-mainsplit-improve-m151-main-ts-deck-shell-ts-keymap-spec.md`。
- **文案-Copy.md D64 的键位面板分组枚举已过期**（M166 finding，worker-wrap-proposal-2，2026-09-18，
  low，**待修**）：D64（`文案-Copy.md:55`）列「移动与选择 / 扩选 / 删除 / kill-yank / 翻屏 / 撤销 /
  widget / 全局 / 其他」，与实现不符——`src/bindings-panel.ts:31-45` 的 BINDING_GROUPS 是 9 个固定组，
  末两组为「标签」（M149 起）与「全局」，「其他」是未归组命令的兜底、仅在存在时 push（`:118-119`）；
  m133 门禁冻结的 GROUPS 数组含「标签」。自 M149 起漂移。修法：D64 补「标签」到「全局」之前、「其他」
  改写为兜底说明，编号沿用并附修订记录（D86 于 M160 的先例）；顺带核 D65/D66 是否随 M166 的面板文案
  修订（M166 提案要求 D66 覆盖「默认不占键位」成因）。finding
  `20260918-worker-wrap-proposal-2-improve-copy-md-d64.md`。
- **批次收尾缺「本地 HEAD == origin/master」的机器校验**（M169 finding，worker-archive-survey，
  2026-09-18，medium，**待修**；本次漂移已由 tower 在收尾时手工 push 收口）：AGENTS.md 硬规则「批次
  收尾顺带 push」靠人记，本批一度落后 3 个 merge，CI 从未见过这三个提交（`gh run list --commit` 零
  结果），归档对账只能以旧 push 的 CI 结果为准。修法：把「比对本地 HEAD 与 origin/master，不一致即
  报红」做成批次收尾 checklist 或 `scripts/gate.sh` 收尾步骤，不靠人记。finding
  `20260918-worker-archive-survey-bug-master-origin-master-merge-ci.md`。
- **ADR 0002 §6 的 200MB 合同文本与现行 250MB 门禁阈值分叉，待显式文本修订**（M174 finding，
  worker-perf-gate，2026-09-18，low，**待修**）：Alex 裁决「允许提高 thresholds」后 CI 阈值为 250MB，
  但 ADR 0002 §6 仍写 200MB——ADR 是历史决策记录、不私改，需一次显式修订（把数字改为 250，或把口径
  改写为 phys_footprint 测量值并注明与 200 时代的测量差异）。修订前分叉已在
  `openspec/specs/perf-measurement/spec.md` 与 `tests/perf/thresholds.json` 双处标注。finding
  `20260918-worker-perf-gate-improve-m174-follow-up-adr-0002-6-200mb-ci-250mb.md`。

- **「changeFilter 兜底防线」失实断言的清扫**（M250 落地，2026-09-27，**scope 内已全落；两处已转 M249**）：
  finding `20260927-worker-editable-non-md-bug-editor-ts-changefilter-m101-false` 的处方①（全仓 grep
  `changeFilter`、按真实机制改写失实断言）在本批收口。**错误前提**是：本仓的 `@codemirror/state`（6.7.4）下
  旧形态 `currentMode !== "md" ? [] : true` 里的 `[]` 是**空操作**（`ChangeSet.filter` 的入参是扁平
  position 对，空数组走越界分支把全部 change 原样保留），放宽与否都不吞键；真拦得住的是返回 `false`
  （M241 起）。**已落**：① `src/editor.ts:896-899` 的过期 doc（原称「`changeFilter` 的拦截闭包读 `mode`」）
  改写为按 `currentEditable` 投影的真实机制，`:1434` / `:1501` 两处兜底正文复核本就准确；②
  `openspec/changes/editable-non-md-files/` 的 `design.md`（§2.2 末节 + 「四处窄门」句）与 `proposal.md`
  （§2 的 P1 清单 + 裁决点 D3 表行 + 「按文件类」条）各加一条更正注记（**不改写原文**）；③
  `openspec/changes/list-tab-indent/design.md` 的「任何绕过 DOM 的程序化 dispatch 都会被拦」与 S6 行同款，
  加更正注记。**转 M249 的两处**（tower 2026-09-27 裁决：与 M249 的活 scope 同文件，避免 merge 撞车）：
  `scripts/acceptance/scenarios/43-list-tab-indent.md` 的步骤名与「只读模式」小结各一处「changeFilter 再
  兜一层」——由 M249（worker-gate-hygiene）顺手落，**不计为本批缺口**。另
  `tests/visual/scenes/m130-text-open-trap.spec.ts:19` 的注释经复核**判为准确**（它说的是当前返回 `false`
  形态下「漏同步 `syncProjection` 会吞键」，与真实机制一致），无需改。**独立复现证据**（M250 探针，
  `@codemirror/state` 6.7.4）：`changeFilter` 返回 `[]` → 变更落地 `"helloZZZ\n"`、返回 `false` → 被拦
  `"hello\n"`；另有 M241 的 `test-results/m241/reverse-input/README.md`（m130 场景 9/9 绿 + 探针
  `PROBE STATE="hello\nZZZ"`）。

### openspec 归档制品与实验脚本

- ~~**历史归档文件的相对链接死链扫尾**（M150 finding，worker-speccleanup，2026-09-17，low，**待修**）~~ **已修（M331 修齐 27 条存量 + M409 扫尾最后 3 条并落门禁，2026-10-09；门禁使本类问题此后归档即红，不再静默累积）**：
  （原 finding 附注：**M155 已逐条在磁盘上复核并在本条更正 finding 的两处误差**）：根因已实证——`openspec archive` 把 change
  目录移到 `archive/<日期>-<id>/`（**深一层**）却不重写制品内的相对链接，而 docs-check 不做链接检查
  （`.github/workflows/docs-check.yml` 只有 ADR 结构与 openspec validate 两步），于是每次归档都静默留下
  死链。M150 本批归档件的 17 处已就地修好；历史件里**真正需要扫尾的是 5 个文件 / 9 条链接**（下表；每条
  箭头右侧是该制品内**原样**写着的链接目标，用 `os.path` 在磁盘上解析过，确认全部落到
  `openspec/docs/…` 这类不存在的路径；修法是各补一层 `../` 让它解析到 `docs/…`，已逐条验证补一层后可达）：
  1. `openspec/changes/archive/2026-09-05-add-editor-live-preview/proposal.md` → `../../../docs/adr/0004-…`、`../../../docs/adr/0002-…`、`../../../docs/adr/0003-…`（**3 条**）
  2. `openspec/changes/archive/2026-09-05-add-perf-measurement-methodology/proposal.md` → `../../../docs/adr/0002-…`、`../../../docs/specs/perf-measurement.md`
  3. `openspec/changes/archive/2026-09-05-add-perf-measurement-methodology/specs/perf-measurement/spec.md` → `../../../../../docs/specs/perf-measurement.md`（5 层，要补成 6 层）
  4. `openspec/changes/archive/2026-09-05-add-vault-workspace/proposal.md` → `../../../docs/adr/0004-…`、`../../../docs/adr/0001-…`
  5. `openspec/changes/archive/2026-09-12-remove-threads-and-theme/proposal.md` → `../../../docs/adr/0006-…`

  **M155 对 finding 清单的两处更正**（都用「把链接目标拼到制品所在目录再 `exists()`」的同一口径实测）：①
  第 1 个文件是 **3 条**不是 2 条——finding 漏了
  `../../../docs/adr/0003-obsidian-compatibility-scope.md`（同一文件的 proposal.md 第 11 行那句「Obsidian
  兼容范围」）；② finding 列的
  `openspec/changes/archive/2026-09-05-add-editor-live-preview/specs/attachment-display/spec.md` 里的
  `./assets/shot.png` **是误报，应从清单剔除**——它在 spec 的 Scenario 正文里，是「文档内容长什么样」的示例
  （`**WHEN** 文档同时含 … 与 ![截图](./assets/shot.png)`），不是制品间的引用；该 change 目录下根本没有
  `assets/`，补 `../` 也只会指向另一个不存在的路径。这条同时**印证了 finding 自己给的门禁注意事项**：机器
  检查必须能排除 spec 正文里的示意例子，否则会给所有 spec 报假红。因此清单从 finding 的「6 文件」收敛为
  **5 文件 / 9 条链接**。
  tower 处置建议：① 一次性扫尾（规则：`../` + 原链接能解析到真实文件则补一层；finding 估 5 分钟、可脚本
  校验）；② 加机器门禁「openspec 制品中的相对链接必须可达」（脚本需排除 spec 正文里的示意例子，如
  `[配置](配置)`，或约定示意例子用行内代码而非链接）；③ 只加人工提醒**不推荐**——没有执行者，属 REVIEW.md
  第 9 条已记的反模式，而这条 finding 本身就是它第二次发生。推荐 1+2。finding
  `20260917-worker-speccleanup-bug-archive-6.md`。
- **`scripts/visual/table-probe72/matrix.mjs` 的产出路径指向已移走的 change 目录**（M150 finding，
  worker-speccleanup，2026-09-17，low，**待修**）：`:35` 把 probe 矩阵 JSON 写到
  `openspec/changes/complete-markdown-reading/`，M150 已把该目录移到
  `openspec/changes/archive/2026-09-17-withdrawn-complete-markdown-reading/`，目录不复存在——
  **重跑 probe 会 ENOENT**；该脚本不在 CI 与 `gate.sh` 的任何门里，所以不会报红，而失败信息（父目录不存在）
  与被验证对象无关，容易误导下一次排查。同类引用 `docs/specs/table-reading.md:8` 与 `docs/adr/0004:28`
  已由 M150 就地改指 archive。tower 处置建议：产出改到 `test-results/`（与验收/perf 证据同惯例、已
  gitignore），既有三份 matrix JSON 留 archive 作历史证据；退一步可改指 archive 路径，或在脚本头注明
  「M72 一次性实验，产出目录已随 change 撤回移走，重跑需先自建目录」。finding
  `20260917-worker-speccleanup-bug-table-probe72-matrix-mjs-change.md`。

### 多 vault 收口遗留（M164 登记，2026-09-17）

- **视觉容差再次吞掉真实变化：本次 13 张基线里 6 张是「静默」的**（M164 实测，2026-09-18）：
  M163 的入口形态 A 让「切换」按钮退场（约 780px 的按钮 + 名称布局位移），13 张含左栏树头部的整页/
  元素基线**内容**都变了，但普通模式只报了 7 张（超出 `maxDiffPixelRatio: 0.001`，即 1200×800 下约
  960px）；另外 6 张——math-rendering / math-theme / render-hr / render-link / wikilink-states /
  describe-bindings-panel（后者是键位面板多一条 `⌘O`，不同原因）——差异落在容差之内，**门禁全绿而
  画面里还留着已退场的按钮**。发现方式：`--update-snapshots=all` 重建后逐张 sha256 与 `HEAD` 对比
  （关键坑：Playwright 的 `--update-snapshots` 缺省是 **changed** 模式，只重写超容差的那几张——
  「跑过 update 了」不等于「基线都重建了」）。**处置**：本次按 all 模式重建全部 13 张 + 2 张新增，
  前后截图与逐张清单交 Alex 过目后入库（见 M164 的 review-request）。**建议把本现场补进 REVIEW.md
  第 3 条的证据**（那是 REVIEW.md 的文件，需一个能写它的动作顺带做）。**给后续跑视觉门禁的人**：
  动过会删除/移动 UI 的场景后，`rg` 出引用该元素的场景 → `--update-snapshots=all` 重建 →
  sha256 对比找出「内容变了但没报警」的那几张，别只看门禁颜色。
  **M251（2026-09-27）两个新现场，同一机制**：① 「END」文案改动（`— End —` → `END`）在
  `end-marker.png`（760×82，额度 62px）上真实差异 **158 像素**（零容差读数
  `158 pixels (ratio 0.0025)`，见 `test-results/m251/baseline-review/end-marker/tolerance-probe-ratio0.log`），
  但全量视觉套件照绿（468 passed / 1 skipped）——`threshold 0.2` 先把字形反锯齿的浅色差滤掉，
  剩下的超阈值像素落在 62 之内；② 新增的菜单作用行高亮（`is-menu-target`，取 `--sel` 底色）
  让 `context-menu-file.png` / `context-menu-dir.png`（160×131，额度 ≈21px）各差 **23 像素**，
  差异**只在菜单左上角的圆角处**（`.ft-menu` 有 10px radius，角上透出底下那一行的新底色），
  菜单本体零变化；零容差读数与前后图见 `test-results/m251/baseline-review/tree-menu-menu-target/`。
  两张**未重建**（新 UI 的观感是 Alex 的人肉裁决点，且任务书给的约束是「其它基线零触碰」），
  读数与重建命令留在那个目录的 README 里待裁决。end-marker 那张按任务书授权重建了
  （过目包 `test-results/m251/baseline-review/end-marker/`，含 before/after/差异叠加三图与 sha256）。
  **再次实证裸 `--update-snapshots` 在容差内等于什么都不做**（本批在 end-marker 那张上实测：
  裸跑后 sha256 与 HEAD 逐字节相同，必须 `--update-snapshots=all`）。
- **真机 app 窗口会被放到屏幕外，键盘注入随即整批不落地**（M164 实测，2026-09-18，medium）：
  无人值守的批次里实测 `window_bounds x=193 y=1076`（内置屏只有 ~982pt 高），此后 KimiCU 的
  `type_text` 直接报「target WebArea did not acquire stable keyboard focus; no keys were sent」，
  场景里出现一串与产品无关的 FAIL（同一提交、窗口在屏内时全 PASS）。**处置**：
  `scripts/acceptance/lib/app.mjs` 的 `launchApp` 现在经 `--config` 一并覆写窗口位置
  （`x:120,y:80` + `focus:true`，并把 title/width/height 重述——tauri 的 `--config` 是**整根替换**
  `app.windows` 数组，不重述就会掉成默认尺寸）。**操作纪律**：无人值守的真机批次把命令包在
  `caffeinate -dimsu` 里（机器/显示休眠会让窗口位置漂走，也会让 KimiCU 的注入链路失稳；
  M164 的验收轮实测：包了 caffeinate 后同一场景 33.6s PASS）。
- **编辑器缺 Emacs 的 `M-<` / `M->`，按下去插入 Alt 图层符号**（M157 finding，worker-toc-proposal，
  medium，**推断部分待真机确认**）：`src/keys.ts` 的 `KEY_BINDINGS` 有 `Alt-KeyV` / `Alt-KeyD` /
  `Alt-Backspace` / `Alt-KeyF` / `Alt-KeyB`，**没有** `Alt-Comma` / `Alt-Period`，而 `src/editor.ts`
  未装 CM commands keymap（无第二层兜底）→ 这两个键落到 macOS 的 Alt 图层，推断会把 `¯` / `˘` 量级
  的符号**插进文档**（⌥v→`√`、⌥d→`∂` 是表内已记录的既有事实；具体字符**未在真机验过**）。对
  「只改选区、不改文档」这条铁律（ADR 0003 §3）来说，这是意外写入，不是简单的键位缺口。
  **M164 未验真机**：本 mission 的真机场景不覆盖键位层。复现方式（一条命令级的手工验收）：编辑器里
  按 ⌥⇧, / ⌥⇧.，看文档是否被插入字符、光标是否不动。修法两条待 Alex 裁：补齐（新增
  `editor.doc-start` / `editor.doc-end`，别复用 `C-a` / `C-e` 的**行**首尾语义）或明确「不支持」并
  写进 living spec。finding `20260917-worker-toc-proposal-improve-emacs-m-lt-m-gt-beginning-end-of-buffer-alt.md`。
- **`demo/index.html` 与现行产品脱节三处**（M158 finding，worker-uxmock，medium，**待修**；M164 只落账）：
  ① `:9-56` 是 ADR 0006 之前的「纸 / 石墨 / 墨」三方向 token（现行 `src/style.css` 只有单套基线）；
  ② `:234-247` 自带一套旧 D 编号（其 D1=切换、D2=空态提示、D3=打开 vault；deck 现行是 D1=masthead
  vault 字段、D4=切换（已停用）、D5=空态提示、D6=打开 vault）；③ 右侧仍有一栏 config 探针（现行 shell
  是两栏）。它是 M41/M57 期的视觉方向走查台、不是产品界面，但**会被当成现行口径误读**（M164 收口时
  差点按它的编号去核 D 条）。修法二选一：按现行 token 与 deck 编号重做一版，或在文件头写明「历史走查台，
  现行口径见 `demo/multi-vault.html` 与 `src/style.css`」。finding
  `20260917-worker-uxmock-improve-demo-index-html-token-d-config.md`。
- **`文案-Copy.md` D90 行误引 D15**（M149 遗留；M163 r2 评审发现同形误引，M164 落账，**修法待 Alex 裁**）：
  D90（标签条目的「未保存」读屏名）在备注里把 **D15** 引作「保存成功 toast」族的来源，而保存留痕一族
  实际是 **D55 / D56**，手动「已保存」在 deck 里**没有独立条目**。与 M163 r2 已修的那处同形（那次改的是
  同一族的另一行），可选修法两条：把引用改成 D55 / D56，或删掉该括号。
  **M164 没有就地改**：deck 正文是已评审制品，改哪一处是口径决定，且 M163 r2 的修法（改引用）未必适用于
  D90 的具体语境——与 M163 r2 的「修法待裁决」是同一类处置。证据：`文案-Copy.md` 的 D90 行（备注括号）。
- **`tauri` 未开 `test` feature：带 `AppHandle` 的接线层无法单测**（M159 finding，worker-startup-impl，
  low，**待修**）：`src-tauri/Cargo.toml` 的 tauri 依赖没有 `test` feature，`tauri::test::mock_app()` 不可用；
  凡签名要 `&AppHandle` 的函数（`commands::prepare_vault_open`、`lib::restore_outcome`）只能靠集成测或真机
  覆盖——`src-tauri/tests/` 是外部 crate，`#[cfg(test)]` 项对它不可见。M159 的实测代价：`prepare_vault_open`
  只在建 watcher 时用 `app`（remap 短路分支根本不用），却因此拿不到直接单测。影响面会随「需要 AppHandle 的
  接线层」变多而扩大（M154 survey 的 async 化改造同样会遇到）。修法：给 tauri 依赖开 `test` feature，或用
  feature-gated 构造函数（`#[cfg(any(test, feature = "test-helpers"))]`）。finding
  `20260917-worker-startup-impl-improve-tauri-test-feature-apphandle-m159.md`。
- **重定位缺「只选目录、不开 vault」的后端命令，前端只能借 remap 短路分支**（M163 finding，
  worker-multivault-frontend，medium，**待修**）：`src/main.ts` 的 `requestRelocate` 需要「让用户选一个目录、
  只取路径、不打开、不注册」，但 `open_vault` 在选择器返回后就提交 vault（reconcile + commit）。前端只能借
  `vault_open(force_new=false)` 的 remap 短路分支（未注册路径 + 有失效项时后端不提交）；**门没短路时后端已经
  切换**，前端必须用 `vault_open_path(loadedRoot, true)` 把后端拉回来再拒绝——「先提交再回滚」的形状，回滚失败
  会留下「后端在新 vault、前端显示旧的」的半切换态（此后相对路径的保存落到错误的 vault）。修法：加一个
  picker-only 命令（只返回用户选的路径，不动 `VaultState`）。**不是**本变更引入的缺陷（既有 `vault_open` 语义
  如此），但它是重定位路径的真实脆弱点。finding `20260917-worker-multivault-frontend-improve-vault-remap.md`。
- **`commit_vault_open` 的 `Some(expect_generation)` 分支无生产消费者**（M164 归档期收敛观察；
  low，**待归档评审确认**）：该参数为「启动恢复让位」而加，做法是「比对世代不符则拒绝提交」；但生产路径上
  唯一的调用是 `commands.rs:381` 的 `commit_vault_open(state, prepared, None)`（用户主动打开无条件提交），
  `Some(_)` 只出现在单测（`commands.rs:1216`）——恢复路径用的是**另一处**同语义判定
  （`VaultState::finish_restore` 里的 `inner.generation != generation`，`commands.rs:178`）。即同一个不变量
  有两份实现、其中公开那份没有生产调用者（REVIEW.md 第 9 条的同族）。**处置建议**：归档评审时确认它是否
  只想服务测试；若是，要么删掉参数并让测试走 `finish_restore`，要么在注释里写明「只为测试保留」——两条都比
  现状（读者无法判断它是有意保留还是残留）好。**M164 未改**：动它要碰 `commands.rs`（不在本 mission scope），
  且改动落在提交路径的并发语义上，应由独立 mission 做。**该参数已由 M171 删除**（`efd27f1`，merge
  `5a944e5`），**本条按历史留痕**；删参后剩下的那一半（`-> bool` 恒 `true` 且无生产消费者）另见
  「启动恢复让位判定与提交返回值（M171 遗留）」节。

### restyle 追加修复批（M215 / M216 gap 报告登记，2026-09-25）

（2026-09-25，M220 迁移与补建：本节前六条由 tower 的 `bc963b5` 追加，**原落点在文末「已核销」节内**，
且首条（mermaid）与上一条挤在同一行没有分隔——它们是**进行中的 findings**（待立项 / 待裁决 / 待修），
与「已核销」语义相反，按维护规则（「核销后移入文末」）迁回本节；条目正文除各自补的「状态」行外未改。
末条 C11 为本 mission 补建。）

- 2026-09-25：**0.001 容差实测吞掉小元素删除**（M214 finding，improve；2026-09-26 Alex 裁决：
  采纳建议——为小元素补元素级基线，派视觉门禁增强 mission；**已核销（M246，2026-09-27）**）：§8.4 假绿防线删 modeline
  右段，像素差 **199 px** < 预算 960 ⇒ 像素层通过，拦住它的是 R3 新加的结构断言。落地：为
  `.modeline-*` 级别的小元素补**元素级**基线（元素 crop 的像素预算远小于整页），或按元素重要度
  分级预算。与既有「整页 0.001 容差」条目（mermaid 952/960 同族）合并阅读。
  **核销**：M246 现状盘点（`test-results/m246/element-coverage.md`）点名五个「删除即整页假绿」高危元素，
  补 5 张元素级基线——`modeline-bar`（modeline.spec，守右段 meta / 主题钮 / 左段 path+指示段）、
  `titlebar-identity-block`（titlebar-identity.spec）、`end-marker`（end-marker.spec）；
  doc-meta 行结构断言已完整、记中危留账未补。既有 41 张基线零 `--update`。
- 2026-09-25：**搜索面板 / lightbox / toast 无视觉基线覆盖**（M214 登记，tower 裁决口径；**已核销
  （M246，2026-09-27）**）：34 张基线里这三个周边表面零覆盖。M214 按「缺的补拍」在**证据层**补
  （`test-results/m214/peripheral/` 36 张补拍，不改场景文件、基线保持 34 张）供 Alex 过目。
  **核销**：M246 真基线化——搜索面板两态（`search-panel-hit` / `search-panel-nomatch`，
  search-panel.spec）、lightbox（`lightbox-overlay`，markdown-combo.spec M184 组新增一条）、
  toast（`tab-close-confirm-toast`，m149-tabs.spec ⌘W 用例），基线以当前代码实际渲染重拍
  （M214 补拍只作清单参考），逐张人工核对 + sha256 manifest 落 `test-results/m246/baselines-manifest.md`。
- 2026-09-25：**code 模式行号与代码列之间 150px 空档**（M212 finding，improve，待裁决）：栏宽从
  80% 改定值 664 后，code 模式（`minmax(max-content, 1fr)`）的行号 gutter 与代码列之间出现约
  150px 空档（百分比时代被弹性吸收）。取舍方向：code 模式栏宽跟随 664 定值 / 维持 max-content /
  或 gutter 右对齐。证据与读数在 `test-results/m212/`。
- 2026-09-25：**doc-meta 的 mtime 缓存「保存落盘后刷新」路径未经真机验证**（M218 reviewer r2 verdict
  接受的取舍 2d，待真机补验）：A1 doc-meta 块的 mtime 缓存在 `markCleanOf`（保存落盘）后的刷新路径
  只有单测与探针覆盖，本批验收集合不含真机保存动作。后续 dogfood 真机批补验：保存后 doc-meta 行的
  「修改于」时间应刷新为落盘时刻。
- 2026-09-25：**restyle R4 基线过目包已备齐待 Alex**（M214，唯一挂起项；**2026-09-26 核销 = mission
  销单**：Alex 裁决「好。我同意。」——交付物被后续批次取代，按它入库反而会回滚新基线）：34 张
  一次性重建（`--update-snapshots=all`，mtimes 同批）+ 逐张差异读数（34/34 远超容差，无静默假绿）
  + 删除元素核对（24 张必须刷新全刷新）+ 假绿防线（已还原），批二 34 张曾提交分支 `d96ee84`
  （未合并）。**取代路径**：M228 合并时基线分两波经 Alex 过目更新；M236 以 `=all` 全量重建同 34 张
  （restyle+heading+标识块+760 最新形态，逐张审计硬判据，Alex 授权本批）。残余价值去向：周边表面
  36 张补拍留档 `test-results/m214/peripheral/`，真基线化由上一条（搜索面板/lightbox/toast 零覆盖）
  承接、随元素级基线 mission 顺带。wt-214 已释放。
- **code 模式 eink keyword 700 缺口：`HighlightStyle` 路径无法按 `data-theme` 限定**（2026-09-25，M220
  建条，依据 M216 gap 报告 §2.3 #11，low，**机制缺口 / 待立项**）：eink 规则②（tokens 文档 §eink
  规则 2）要求 keyword 在 eink 下升到 700。**围栏代码块侧已实现**——`src/preview/theme.ts:238` 的
  `.cm-lp-tok-keyword` 基档 600，另有 `:root[data-theme="eink"] & .cm-lp-tok-keyword` 覆盖到 700
  （`src/preview/theme.ts:243`）；那一侧是**类表 + CSS**，`data-theme` 限定天然生效。**code 模式
  （完整代码文件）走另一条路**：`src/editor.ts` 的 `syntaxHighlighting(HighlightStyle.define(…))`
  （`:1016-1022`），role → 色值 / 字重由 `CODE_COLORS` 常量给出（`:1007-1014`，keyword 恒 `600`），
  而 CM6 由 `HighlightStyle` 生成的规则选择器**不带我们的类名**，CSS 侧无从按 `data-theme` 加限定。
  结果：同一份语法高亮在 eink 下围栏侧 700、code 模式 600，两侧字重档不一致。
  **后果面**：① 机器判据只覆盖围栏侧——`tests/visual/scenes/restyle-eink.spec.ts:121-135` 的「规则②」
  用例断言的是围栏侧的 `.cm-lp-tok-keyword`，code 模式这半条规则**零防线**（M216 探针按「运行期规则
  不覆盖 code 模式」自述跳过）；② eink 下 keyword / string / number 同为纯黑，字重是剩下的少数区分
  手段，少一档即少一格对比。
  **本条的立项缘由 = 指针失效**：`src/editor.ts:1003-1006` 的注释自述「**已知缺口（在案）**……修法
  （把本路径改成 code.ts 的 class 表 + 共用一份 theme）见 docs/backlog.md」——但那条注释指向的条目在
  `bc963b5` 之前的 backlog 里**不存在**（M216 实测：`grep 700` **零命中**；`CODE_COLORS` **仅一条命中**，
  出自 M179 的「toml 表头与 legacy mode 共用 `atom` token」条——该条提到 `CODE_COLORS` 只是把它当作
  「要同步改的两处穷尽检查」之一，与 eink 字重无关），读者无从跟进
  （REVIEW.md 第 7 条的同族形态：自报在案、实际不在案）。本条即该指针的落点。
  **候选修法**（择一，均需评审）：
  (a) **按 `src/editor.ts:1006` 注释自己指的做**：code 模式也改成 class 表——每个 role 取
  `.cm-lp-tok-*` 类名，色值与字重全部交给 `theme.ts` 的一份 CSS（与围栏侧共用一个真源，`data-theme`
  限定随之生效）。机制支点已在位：`HighlightStyle` 的 `TagStyle` 支持 `class?: string`
  （`@codemirror/language` 的 `interface TagStyle`），但**给了 `class` 的那条就不再接受内联样式**——
  等于逐 role 把配色真源迁到 CSS，工作量与回归面（code 模式既有基线）都在这里。
  (b) **保留 `HighlightStyle`，改由主题切换时重建扩展**：按 `data-theme` 生成两份 HighlightStyle
  （eink 那份 keyword 700），启动 / 主题切换时 reconfigure 换上。代价是一条扩展重建路径与一处新
  耦合（主题状态 → 编辑器配置）。
  **本条的 (b) 有一条已过时的定语，M237 更正（2026-09-26，change `live-theme-switch`）**：原句后接
  「与 `[ui] theme` 的『重启生效』口径一致」——那条口径**已被推翻**：`[ui] theme` 现在支持运行期
  切换（`view.theme-cycle` / ⌘⇧T / modeline 钮，切换即写回），因此 (b) 的「启动 / 主题切换时
  reconfigure」不再需要把「主题切换」等同于重启——运行期切换的落点已经存在
  （`src/main.ts` 的 `applyTheme` 是唯一施加点，一条 `view.theme-cycle` 命令即可触发扩展重建）。
  这不是说 (b) 变简单了：它仍要引入「主题状态 → 编辑器配置」的耦合，而 (a) 的「配色真源迁到 CSS」
  路径不受本次修订影响；两者的取舍仍待裁决。
  **闭环判据（本条实施时应补）**：断言落在 code 模式侧（eink 下 code 模式 keyword 元素的计算
  `font-weight` = 700）；现有围栏侧断言不能替代。补断言前，code 模式这半条规则维持「已知缺口」。
  **证据**：M216 gap 报告 §2.3 #11 与 §3 规则②行（主 checkout `test-results/m216/gap-report.md`）。

**外部修改事件与自身保存交错时的旧 snapshot 复用，会让缓冲短暂退回上一个已保存版本**（low，
**已知代价、本批不处理**；M278 r1 评审 P2-1 的「反向交错」，2026-09-27）：
`src/save-controller.ts` 的 `dispatchExternalChange` 在收到命中打开中文件的 `modified` 事件时读一次磁盘
（`fs_read_snapshot`），并用这次读数**同时**做两件事：判回声（与 `revisions` 的会话基准比对）与作为
`reloadDocument` 的 snapshot（clean 分支不再读第二次，省一次跨进程 IO）。当读在途期间用户又按了一次
`⌘S` 时，读数与基准分属两个时刻：**读数在前、基准推进在后**（保存 #2 已完成）⇒ 这次读取拿回的是写入前的
R1，而会话基准已到 R2。
**现象**：clean 分支会把 R1 的内容重载进缓冲——屏幕上短暂显示上一个已保存版本（脏缓冲被覆盖的路径不
存在：dirty 时走的是选择权交给用户的那条分支，不自动重载）。
**自愈机制**：保存 #2 自己产生的下一条 watch 事件到达时读数已是 R2，与会话基准一致 ⇒ 判为回声丢弃，
缓冲不再被动过；期间用户若继续键入，dirty 判定与守卫 P1 语义都不受影响（`cleanDoc` 仍是会话侧真源）。
**为什么本批不处理**：修法只有「每次事件都读两次磁盘」或「给 snapshot 加上读时刻、过期即作废」两类，
前者把 D2 的净增 IO 从「读失败路径」扩大到「每次外部事件」，后者要引入一套读时刻簿记——代价都高于
它换来的收益（窗口 = 一次跨进程读的毫秒级，且不产生数据丢失；用户下一次键入或下一条事件即自愈）。
**同批已修的另一半**（同一次评审的 P2-1 正向交错）：基准取样从 `await` 之前挪到之后，消除「读在途期间
的保存被误判成外部修改 ⇒ 弹 sticky 提示（带破坏性动作「重载（放弃我的修改）」）」这条**会误导用户**的
路径；判据与回归见 `tests/unit/save-controller.test.ts` 的「读在途期间完成的那次保存也算进来」。

**tool-only 轮次中断后「空气泡 + 已停止徽标」的实时/恢复路径不一致**（low，纯观感；M348 r1 评审
P2-2，2026-10-06）：无文本产出的轮次（assistant 只发工具调用）在工具执行段被中断时，实时路径不挂
「已停止」徽标（合理——没有气泡可挂），但既有的空文本 assistant 空气泡会被
`mark_last_assistant_stopped` 标上 status=stopped，重载（快照恢复路径）后出现「空气泡 + 已停止
徽标」。两路径对同一条记录呈现不一致，纯观感噪声，无数据问题。修法方向：实时路径对空文本产出也补
徽标，或恢复路径对空文本不渲染徽标，二选一拉齐。来源：reviewer-hp3 r1，
`.tower/comms/reviews/review-feat-rust-turn-abort-capability-hp3-reviewer-hp3-r1.md`。

**harness 入 pane 的两处覆盖缺口（无自动判据）**（low；M349 评审 finding，reviewer-hp4，
2026-10-06）：change `move-harness-to-pane-chat-frame` tasks 2.1/2.2 的两条行为没有自动化判据，
归档后会随之沉底——① 正文列与 harness 列对分隔条的**像素对齐**（design §3 的结果不变量，现只有
结构断言，像素级对齐靠人眼）；② 会话名「首条用户消息截断 20 码点」的派生逻辑（无单测/场景断言）。
补测方向：① 视觉场景加分隔条横坐标 vs 两列缘的计算属性断言；② 面板单测补截断派生用例。
finding `.tower/comms/findings/20261006-reviewer-hp4-improve-harness-20-backlog.md`。

**harness vault_create 工具承诺 mkdir -p 但实现直调 vault_create_file（父目录缺失仍拒绝）**（**已核销——前提不成立**，
原评 medium；M410 r3 评审另案发现，reviewer-m410，2026-10-10；**更正于 2026-10-10 M413**）：原条目称
「实现直调 `vault_create_file`，父目录不存在时仍返回 fs_not_found」——M413 worker 现场核对发现该前提
半失效：`fs_io::vault_create_file`（fs_io.rs:1592）**已内调 `ensure_parent_dirs`**（M407 r1 所落），
harness 工具层经此调用链本具 mkdir -p 语义，缺口不存在。处置：M413 不加重复调用，补一条「深层路径直接
vault_create 成功」钉死用例；本条留痕核销。finding
`.tower/comms/findings/20261010-reviewer-m410-bug-harness-vault-create-mkdir-p-m407.md`。

**turn.rs 仍接受带 text 的 legacy selection 上下文载荷（零活生产者的兼容面）**（**记录在案**，low；
M412 r1 评审 P2-3，reviewer-m412，2026-10-10）：`context_section` 对有 `text` 的 `viewport_range`/selection
载荷仍按「行号：\n原文」渲染，但 M343 退役选区注入、M412 移除视口原文后，该形状**没有任何活的生产者**
（恢复路径用的是留存字符串）。保留出自宽容解析接受面考虑、注释已写明；按 REVIEW.md 第 21 条属于可裁
兼容面。处置建议：不删代码，下次动 turn.rs context 渲染时顺带把该分支与单测
`legacy_selection_with_text_still_renders_source_text` 一并移除或改写为「拒绝/忽略」口径；若未来要做
「重新附上视口原文」的显式手势，该接受面可直接复用——届时再定。

## M455 真机验收 FAIL 归因 + master 视觉门禁修复（2026-10-11，worker-m455）

背景：2026-10-11 真机复验批 5 场景 FAIL（138/140/142/144/145）待归因；另 master 本地视觉门禁
m131/m133 两条红（`text` 作用域经 M453 合并 `59e4f68` 入库后既存）。逐项处置如下——**四项真机
FAIL 均为可确定性复现的产品缺陷或场景 bug，无一项判为环境噪音**；同批 76/87/131/132/133/134
（hover 族）仍属环境项，由 tower 统一安排复跑。

- **138 `harness-draft-send-reject` — 产品缺陷（已修）**：发送被能力闸拒绝后回滚**只还原块、不落
  光标**，`replaceChildren` 打散的 DOM 选区停在边界位 ⇒ 紧随的 `markDraft()` 按错误 caret 判
  「内容变了」，防抖窗口到点把盘上草稿重写一遍——**只有 caret 字段变**（sha `85da85117018` →
  `d6a41e72d3ac`），违反 change `composer-draft-persistence` design §9⑤。修：`src/harness-panel.ts`
  的 send 路径在乐观清空**前**记下发前光标，拒发回滚 `renderComposer(blocks, preSendCaret)` 连同
  光标一起还原。回归：新增 chromium 场景 `tests/visual/scenes/m455-draft-reject-no-rewrite.spec.ts`
  （判据 = `harness_draft_put` 调用次数不因拒发回滚增加；反向验证：还原该行即红，写盘次数 1→2）。
- **140 `harness-composer-nav-move` — 产品缺陷（已修）+ 场景期望值算错（已改准）**：段落**末缘**
  （光标停在末段行尾，键入后的常态位）被 `normalizeComposerCaret` 归一到边界位，列位随之丢失，
  ⌃P 落到上一行**行首**而非同列位（实测 `yabzcdw` ⇧Enter `mn` 后 ⌃P 落在第二段行首
  `yabzcdw\npmn`）。修：`src/harness-panel.ts` 的 `moveLineVertical` 对末缘保留原始光标走段内步进。
  场景原期望 `ypabzcdw`（列 1）与「行尾在列 2」自相矛盾，改准为 `yapbzcdw`（同列位 2）。回归：
  `tests/unit/composer-nav.test.ts` 新增「段落末缘保留列位」用例。
- **142 `harness-composer-nav-no-rerender` — 场景 bug（已修）**：该负向断言 `ax: { not: "z" }` 是
  140/141 的探针形态，但本场景**从未键入探针字符**；单字符负向断言对着整份 AX 文本匹配，命中无关
  界面文案（语言钮 `语言：zh`、窗口按钮 help `…action to zoom…`）⇒ 静默假红（REVIEW.md 第 1 条：
  判据无区分度）。改为钉 composer 节点值 `/AXTextArea = "abcde" @/`（值恰为 `abcde` 才命中）。
- **144 `harness-composer-alt-backspace` — 场景 bug（已修）**：`keys: […, " ", …]` 用字面空格作键名，
  `press_key(" ")` 报 `error: empty key DSL`（键名表里是 `space`，与 `-`→`minus` 同族）。修在套件侧：
  `scripts/acceptance/lib/cu.mjs` 把整串 `" "` 译为 `space`，`lib/execute.mjs` 的可打印判定含空格
  ⇒ 该步仍走可回读通道（不降级盲发）；README 的 `keys` 行同步。
- **145 `harness-composer-kill-yank` — 产品缺陷（已修）**：面板自己的 keydown（挂在 composer 上、
  先于 window 分发器）把 `mod+y`（⌘Y 与 ⌃Y）一律当就地 redo `preventDefault` 掉，分发器对已消费
  事件让路（`src/keys.ts:934`）⇒ composer 的 ⌃Y 永远落不到 `yankAtCaret`，编辑器 ⌃K 写进**跨面
  共用** kill 槽的内容插不回来。同批 143/146 等 ⌃ 系命令能过，正因它们落到 `if (mod) return;` 而
  不 `preventDefault`——`editor.yank` 是唯一被就地路径遮蔽的 `text` 作用域绑定。修：就地 redo 收窄
  到 meta-only（`src/harness-panel.ts`）。回归：新增 chromium 场景
  `tests/visual/scenes/m455-composer-ctrl-y.spec.ts`（编辑器 ⌃K → composer ⌃Y → 被杀文本出现；
  反向验证：还原该行即红，composer 仍空）。
- **m131 视觉用例 `m131-keymap-table.spec.ts` — 场景 bug（已修）**：scope 不变量写死 `["global",
  "editor"]`，M447 新增 `text` 作用域后整表断言红。对齐为三值 + `binding.scope ===
  scopeOfCommand(binding.command)`（与 `tests/unit/keys.test.ts` 同口径），owner 映射改为
  `global → GLOBAL_COMMAND_IDS / 其余（editor + text）→ EDITOR_COMMAND_IDS`。
- **m133 视觉用例 `m133-describe-bindings.spec.ts` — 基线待更新（人肉裁决点）**：M447 给 `text`
  作用域键位**加长了来由文案**（如「M447：编辑器与 composer 两处文本面共用同一绑定」），面板每行
  折行增加 ⇒ 整页像素 4%（32685px）重排；同 spec 的结构断言（分组 / 行数 / 文案 / 未绑定行 / 穿透）
  全过。截图已复制到 `test-results/m455-m133-baseline/`（git 外）呈 Alex 过目，**待 Alex 说「通过」
  后再 `--update`**（AGENTS 硬规则：基线更新前须过目）。

未完成项 / 交 tower：
- m133 基线 `--update` 待 Alex 裁决（如上）；在此之前 `gate.sh visual` 的唯一红即此条。
- 真机复跑由 tower 统一安排：本轮修复落在 **chromium / 单测** 的可确定性判据上（138/140/145 各有
  反向验证）；真机侧 138/140/144/145 与同批 hover 族（76/87/131/132/133/134）待复跑收口。
- 145 同族观察（非本次 FAIL，未改）：面板 keydown 的 `mod+z` 仍把 ⌘Z 与 ⌃Z 都当就地 undo，而统一
  键位表无 `Ctrl-z` 绑定——未遮蔽任何 `text` 命令，留给 change 属主裁是否收窄。

## 工具链与环境（待 Alex 裁决）

1. **1420 端口串行**：vite dev server 固定 `127.0.0.1:1420` 且 strictPort，全机同一时刻只能有一个
   `pnpm tauri dev` 实例。并行批次起实例前先 `lsof -nP -iTCP:1420 -sTCP:LISTEN`，被占则与对方错峰。
   验收套件自身走 1430（`LUMIR_ACCEPTANCE_PORT`），不受此限。来源：批次四 M134/M135 并行实证，2026-09-16。
2. **tower 并行批次的磁盘预算**：每个 worktree 的 cargo debug target 占 1.5–3G（2026-09-16 实测：
   main 4.5G / wt-134 3.8G / wt-135 2.2G / wt-136 2.1G）；磁盘 <1G 时 ENOSPC 硬阻塞所有真机批次
   （实测 219MiB 时 `pnpm tauri dev` 因 vite 临时文件写失败而中止）。验收套件已把「<2G 不起实例」
   写进预检。长期方案候选：worktree 共享 `CARGO_TARGET_DIR`（代价：并发构建互斥）。
   **M142 补充（2026-09-16 晚）**：全机可用空间一度只剩 2.7G（其余被既有 target 占满），按上表预算
   判断装不下一次全新的 worktree debug 构建——建到一半 ENOSPC 会留下半截 target 且不回血，比不构建
   更糟，于是当时先把顺序定为「先跑 chromium 视觉门禁，真机待空间腾出」；随后空间回到 6.8G，同一晚
   完成首次 debug 构建与真机全量验收（19 场景 / 197 断言全 PASS，证据 `test-results/acceptance/2026-09-16/`），
   本轮交付**不是**「只跑视觉」的状态。
   建议把预检口径从「可用 ≥2G」细分出「worktree 首次构建须 ≥3G，target 已热才可用 2G 档」。
3. **KimiCU 键盘注入对 WKWebView 在窗口遮挡时不可靠**（批次四 M134 实证）：返回 `occluded:true`，
   activate 后也未必恢复；AX 写入（`set_value`）可靠。故键盘场景须前台焦点纪律，且**不得用
   set_value 伪造键盘语义**（不经键位分发链路，验不到 `keys.ts`）。长期候选：dev-only 脚本化驱动入口
   （`LUMIR_DEV_SCRIPT` 或 debug-only invoke）。
4. **KimiCU AX 服务会中途全局退化**（2026-09-16 M135 期间出现两次）：`get_app_state` 只剩菜单栏
   （`element_count` 1–18、`truncated: [closed_menu, cycle]`、`window_bounds x=0 y=0 w=1 h=1`），
   Finder / Reminders / Lumir 一起坏，`xpc-ping` 仍报 `accessibility=true screenRecording=true`。
   恢复手段 = 重注册服务（`/Applications/KimiCU.app/Contents/MacOS/kimi-cu install`，tower 两次复验有效）。
   对套件的影响：整套一起报「前端未就绪」，不是场景缺陷。
   **诊断线索**：退化期间 `log show --predicate 'process CONTAINS "kimi-cu"'` 显示服务每秒一次
   `TCCAccessRequest() IPC`（重试循环），而 `xpc-ping` 仍报已授权；两次退化都发生在磁盘 <1G 时，
   疑与服务写不出缓存后进入重试态相关。
5. **`scripts/perf/memory.mjs` 的 WebKit pid 差集归因在非独占主机不可靠**（外来 helper 被误算，
   实测一次 409.7MB 虚高读数）；常驻内存存量超合同（2026-09-06 evidence 已 218–222MB）——
   合同口径裁决随 dogfood 性能专项。
6. **KimiCU `press_key` 逐键注入会整批丢键**（2026-09-16 M138/M139/M140 三方实证）：原生 input 与
   contenteditable 都会发生，丢在 DOM 之前（app 侧 keydown 只收到部分键，如注入 `needle` 只到 `ndl`）；
   间歇性、成因未定位。套件侧已由 M140/M143 的「回读 + 字节未变才重试」口径兜住，工具层缺陷仍在。
   findings：`20260916-worker-search-bug-kimicu-press-key-wkwebview-input-acceptance-keys.md`、
   `20260916-worker-keys-bug-kimicu-press-key-type-text.md`（正文实为 press_key）。
7. **同机第二个 Lumir 实例显著加剧 press_key 丢键**（M140/M142 对照实证）：跑真机验收前的预检
   须同时确认 1420（dev）与 1430（验收）都没有 Lumir 实例在跑。
8. **孤儿进程巡检**（M148 finding，low）：wt-62 遗留两组存活 10 天的 headful Chromium 孤儿
   （ppid=1，带完整子进程树）与历史 `vite preview` 常驻，会干扰真机验收里「谁是前台」的判断
   （M148 全量轮撞到过窗口被挤位）。批次收尾统一回收：`ps -o pid,ppid,etime,command | grep -E
   'playwright|chromium|vite preview'`，找 ppid=1 且 elapsed > 1 天的孤儿、确认不属于在跑 mission
   后 kill；**注意别碰 Alex 的 dogfood 实例（1420 端口的 vite / target/debug/lumir）**。
   finding `20260917-worker-toc-improve-wt-62-headful-chromium-10-vite-preview.md`。
9. **批次内 target 纪律是否沉淀入 REVIEW.md**（M155 评估，2026-09-17；**建议：入 REVIEW.md 第 12 条，不另起
   条目**；需 Alex 裁决）：本批（M150–M154）中途磁盘只剩 **553MiB**，ENOSPC 直接阻塞所有真机批次，tower
   当场立了三条临时纪律（见 06:52 的广播）——每个 worktree 同一时刻至多一份 cargo target；**最后一次 cargo
   门禁跑完后立即删 target 并广播释放**；进真机验收前 `df -h`，<3G 不起构建。纪律生效后水位回到 4.6Gi，
   且 M151（回收 2.2G）/ M152（回收 2.0G）各自按纪律删 target 并广播，此后批次内再未触到水位。
   **建议入 REVIEW.md 第 12 条的理由三条**：① 门槛已满足——本节第 2 条与 REVIEW.md 第 12 条记的是同族事件，
   本批是同族第三次（批次四 219MiB ENOSPC、M142 期 2.7G、本批 553MiB），「重复踩过」成立；② REVIEW.md 的
   维护规则自己写着「重复踩到表内某条：把新现场补进该条的证据，不要另起重复条目」，而第 12 条已有完整的
   症状/根因/证据/防线，本次只是把防线从「看水位」加严到「跑完即删并广播」；③ **留在 backlog 的问题是没有
   执行者**——第 12 条在「开工前检查清单」里，agent 动工前会逐条过，backlog 不会。
   **代价与边界**：本条只动 `docs/backlog.md`（本 mission scope），若 Alex 同意，改 REVIEW.md 第 12 条的
   证据（补本批现场）与防线（加「最后一次 cargo 门禁后立即删 target 并广播；同一 worktree 同时至多一份
   target」）需要一个能写该文件的动作（随下次碰 REVIEW.md 的 mission 顺带做即可）。
   长期方案候选仍是本节第 2 条的「worktree 共享 `CARGO_TARGET_DIR`」与「待 Alex 裁决」第 6 条（旧编号第 8 条），与本条不冲突。

### 块级横滚容器失去焦点入口（M239 登记，2026-09-26，待裁决）

**症状**：change `list-tab-indent` 把编辑器内 `Tab` 绑给列表缩进命令（`editor.list-indent`）之后，
块级横滚容器（围栏 / 缩进代码块与 grid 表格的 `.cm-lp-block-scroll`，`tabindex=0`）**没有任何
真机验通的路径**能让它进入「持有焦点」状态 ⇒ M132 收编、M180 泛化的那五条 widget 滚动键
（`←` `→` `Home` `End` `Escape`）当前无从触发。

**证据**（全部真机，2026-09-26，git 外）：
- 全量跑 `test-results/acceptance/2026-09-26-m239-full/`：`21-wrap-default` 由同日 20:45 的 PASS 变
  FAIL，两条断言实际均为 `focused=AXTextArea`（那是「用 `Tab` 移入容器」的旧入口）。
- 改点容器后 `test-results/acceptance/2026-09-26-m239-21/`：`AXPress` 点
  `role=region` → AXGroup 的容器节点**焦点不动**，两次断言仍红；AX dump 里该节点既无 bbox 也无
  `AXPress` 动作（`ax/03-*`、`04-*`）。
- 代码侧：全仓没有任何命令把焦点送进容器（`src/preview/livePreview.ts` 只有 `view.focus()` 的退出
  方向：`:365` 的 widget-escape、`:456`）；容器只有 `tabindex=0` 等着原生遍历 ✗。

**受影响面**：容器本身的 `overflow-x: auto` 仍在，鼠标 / 触控板横滚照常可用；被切断的是
「容器持有焦点」这一状态与它的加速键（120px 步进、`Home`/`End` 端点、`Escape` 交还）。
living spec 两处已随本 change 改写口径（`keymap-commands` 的「轨道 D 的 widget 滚动键纳入统一
键位表」与 `editor-live-preview` 的「折行渲染与代码块横滚容器」，delta 在
`openspec/changes/list-tab-indent/specs/`），**未删**键位语义（键还在表里、命中条件不变），只把
「入口」如实记为不存在。

**候选处置**（任选其一，须经裁决再动代码）：
1. **新键 / 新命令送回焦点**（推荐）：例如 `editor.focus-block-scroll` 绑一条空闲键位（Emacs 系的
   `⌃⌥→` 之类），命中后把焦点交给当前光标所在块的横滚容器；容器内的五条键与 `Escape` 交还逻辑原样
   复用，等于把 M132 的整套能力接回来。
2. **确认容器的可点区域**：容器若有可见的 padding / 边缘可点（真机目前没找到），把「点容器」写进
   spec 并让场景 21 按坐标点那条边。
3. **接受移除**：则 `keymap-commands` 那五条 widget 滚动键与 `livePreview.ts` 的命令实现一并退场
   （连同表格容器），spec 也要删——这是删除既有能力，代价最大。

## 待真机验收

行为判定已下沉为 agent 可执行场景（入口 [scripts/acceptance/](../scripts/acceptance/README.md)，
设计见 [docs/process/real-machine-acceptance.md](process/real-machine-acceptance.md)）；手感/审美项归 Alex。

分类依据 = **证据目录里真实 PASS 的场景**，不是「场景写了就算覆盖」。全量回归的现场按维护规则的
「一行式索引」留档——报告正文与逐场景读数不再进本文件：

- **M284 全量（2026-09-28，语言面修复批）**：65 场景 / 57 PASS / 8 FAIL、1685 断言 / 53 条失败断言、总耗时 2496s → `test-results/acceptance/2026-09-28/summary.md`。8 条红复跑 4/8 转绿、4 条稳定红（1 条产品缺陷已 file finding、2 条套件注入通道缺陷、1 条 M283 已定的窗口口径），**无一条由 M284 引入**（本批 `src/**`、`src-tauri/**` 零 diff）→ 复跑读数 `test-results/acceptance/2026-09-28-rerun-reds/`。
- **M256 全量（2026-09-27，M282 之前的现场）**：57 场景 / 49 PASS / 8 FAIL——**场景当时跑在 zh 面，读数不再可复现**，本行仅作沿革对照（与 M284 只有 28、47 两条红重合，其余由 M266/M277/M278/M280/M281/M283 各批修完或新增）→ 归因见「待修 findings」的「M256 全量回归现场」条。
- **M240（2026-09-26）**：49 场景 / 47 PASS / 2 FAIL（`32-list-filter`、`43-list-tab-indent`）。
- **M164（2026-09-18，证据目录按 UTC 记为 `2026-09-17`）**：26/26 PASS。
- **M296 的真机批（2026-09-29）**：场景 67 + 多 vault 回归 16 / 17 / 19 / 25 / 48 / 60 → **7/7 PASS**（`test-results/acceptance/2026-09-29-final/`），读数与结论见 `test-results/m296/readings.md`。
- **沿革：真机运行的纪律（M164 起，写场景前必读）**：就绪门的入口读屏名是 `AXPopUpButton`（写死 `AXButton` 会让整套在启动就超时）、窗口经 `--config` 钉主屏（否则 macOS 会把窗口放到屏幕外、键盘注入整批不落地）、每场景清 `workspaces/` 与 `vault-sessions/`、`seed` 预置注册表与会话并挂第二个合成 vault、无人值守用 `caffeinate -dimsu` 包住、`cargo build --features custom-protocol` 之前必须先 `pnpm build`。

**已机验（行为判定落定，有 PASS 证据）**

证据目录统一在 `test-results/acceptance/<批次>/<场景>/`（git 外）；每条只留主题 + 场景 id + 关键边界，
叙述与读数明细看场景文件（`scripts/acceptance/scenarios/*.md` 的「已知边界」节）与 git 历史。

1. **Mermaid 点击进源码编辑** → `01-mermaid-click`：渲染态点击 → 源码显露、widget 让位；渲染中（pending）态窗口极短，只留截图。
7. **M124 三条恢复路径全部覆盖** → `07-recovery-paths`（冲突双动作 + 内存改动未丢 + 磁盘未被静默覆盖）、`07b-recovery-saveas`（真删除触发 `fs_not_found` → 另存为新文件真实落盘）、`07c-external-reload`（干净缓冲 + 外部改写 → 编辑器文本自动换成磁盘内容）。
8. **M127 崩溃备份链路三条子行为** → `08c-crash-recovery`、`08d-crash-discard`、`08e-force-overwrite`；`08-autosave` / `08b-autosave-pause` 断言的是**已移除**的自动保存（M278 随 change `remove-autosave` 删除），「编辑内容不丢」由 41 / 42 / 43 / 46 的显式保存断言承接。
9. **Emacs 键位 / ⌘Z / ⌘/ 面板 / `config.json` keys 表** → `09-emacs-keys`、`09b-keys-config`（⌘Z 未被 macOS 视图层级吃掉、⌘/ 面板打开期间文档逐字节不变、keys 表解绑 ⌘S / 重绑 ⌃S 生效）。
10. **Markdown 渲染三件套**（M138）→ `render-markdown`；配色与几何不进真机，由视觉门禁守。
11. **表格降级文案归因**（M138）→ `render-table-degrade`（M142 起降级只由多列 / 槽位不可映射触发；短行表按矩形渲染）。
12. **文件内搜索 v0**（M139）→ `search-01-find`、`search-02-binding`。
13. **链接渲染与激活（全形态）**（M144 起、M145 补齐；M272 扩面到裸 URL）→ `12-links`（53 断言）、`54-bare-url-cmd-click`；引用式 `[text][ref]` 与无 scheme 字面仍保持原文（半覆盖，如实登记在 change 边界节）。
14. **TOC 大纲 popover**（M148）→ `13-toc`；配色与几何由元素级基线守。
15. **多标签**（M149；M238 扩两段）→ `14-tabs`（51 断言 / 21 步）；⌘W 从关窗改为关当前标签、切换 vault 升级为任一标签 dirty 即拦等语义变化见场景说明。
16. **启动自动恢复 last_vault**（M159）→ `16-startup-restore`（10 断言）；恢复中态本身通常不可见，故断言的是「不残留」而非「看见」；不宣称性能改进（`LUMIR_READY` 的出现时刻不变）。
17. **多 vault 列表与切换**（M164）→ `17-multi-vault-switch`（38 断言，含直读盘的三条 `file` 断言）；「双击固定标签」在该套件不可表达（由视觉通道覆盖）。
18. **启动恢复 vault 并一并恢复它的标签列表**（M164）→ `18-vault-session-restore`（7 断言）；与 16 的分工是「vault 恢复本身」vs「装载后紧接着的标签恢复」。
19. **切换 vault 的 dirty 前置门三条出口**（M164）→ `19-vault-switch-guard`（35 断言）；**未覆盖**「保存能闭环 → 继续切换」那条顺路（由 chromium `mv-vault-switch-guard.spec.ts` 覆盖）——MUST NOT 把 19 的 PASS 读成「每条顺路都在真机验过」。
20. **表格 cell 内 ⌃E→⌃F→⌃E 不再跳回前一 cell**（M185）→ `24-table-cell-ctrl-e-seq`；AX 逐 cell 落点不可回读，用插入字符的归属反推光标位置。
21. **vault 列表 ESC 收起保持阅读位置**（M186）→ `25-vault-list-close-keeps-reading-position`；该缺陷在 chromium 与真机均未复现，修复是结构性的（如实登记）。
22. **svg 倒序滚动终态稳定**（M187 / 场景修复 M190）→ `26-svg-scroll-stability`（17 断言）；两条通道语义（`AXTextArea.value` = CM 当前渲染区间；带 `<text>` 的 svg 在 AX 里的形状不稳）已写进套件 README 与场景说明。
23. **文档末尾完读标记**（M189；M238 / M251 两处变化）→ `27-document-end-marker`（19 断言）；可见性不在真机通道判（AX 不给纯文本节点 bbox），由 chromium 几何断言 + 截图承担。
24. **restyle 主题通道与骨架落位**（M213）→ `34-restyle-theme-skeleton`；eink 色值 / 对比无计算属性通道，只能给截图（手眼项）。
25. **三主题真机呈现 + overlay 标题栏窗口级读数**（M213）→ `35-restyle-three-themes`；标题栏三项窗口级证据（traffic 灯 / 标题文字 / 拖拽）不在断言里，判定归 Alex。
26. **主题运行期切换**（M237）→ `44-theme-live-switch`（34 断言，含反向验证）；色值 / eink 九条降级 / mermaid SVG 内联色三类视觉取值由 chromium 场景守。
27. **文件树条目右键菜单的 M251 增量**（M251）→ `47-file-tree-context-menu` 新增「点在行右侧空白区也作用于该行」；**该批真机判据未取得**（`button: right` 取不到窗口截图，M244 / M249 同因），判定由 chromium 层承担；**待裁决**：两张菜单基线有 23px 真实差异未重建（`test-results/m251/baseline-review/tree-menu-menu-target/`）。
93. **思考块三态（折叠默认 / 展开见原文 / 时长读数在场）**（M364）→ `93-harness-thinking-blocks`（真机 PASS / 22.5s）。
94. **无 reasoning ⇒ 零思考块（反向验证）**（M364）→ `94-harness-thinking-absent`（真机 PASS / 23.4s）。
95. **思考程度 chip 会话态（默认 High / 浮层三档 / 选 Max / 新会话回 High）**（M364）→ `95-harness-thinking-effort`（真机 PASS / 18.7s）；「档位 → 请求参数」那一段由 core 集成测试 `session_thinking_effort_reaches_request` 覆盖。
96. **列表自动模式三态（「1. + 空格」进入 / Enter 续行 / 空项退出）+ IME 组合期不重复**（M461）→ `153-ordered-list-auto-mode`（**真机留 dogfood 批次跑**）；裸 DOM 变更形态不兜、留 dogfood，若复现另立项。

**已机验到渲染/结构层，行为细节仍缺可观测面**

2. 公式进编辑 → `02-math-click`；**「公式后 ⌃B 是否 1–2 次」仍待判定**（AX 不暴露光标 / 选区，纯键盘落位无法回读校验）。
3. Ctrl+N/P 表格行为 → `03-table-ctrl-np`；grid 表渲染成 `AXTable` + `AXRow`，**逐 cell 落点不可回读**。
5. cell 内公式 → `05-cell-math`；**「点击渲染态公式进编辑」不可机验**（KaTeX span 既不进 AX 树也不带 bbox）。
6. Callout → `06-callout-and-width`；**「光标进该行后源码显露」不可机验**；表格宽度只留截图证据。

## 记录在案（无需动作）

- **快捷键治理后置（2026-10-03，Alex 在 pane 化提案节点 1 裁决时裁定）**：当前阶段对快捷键的总体
  要求不高，有基本顺手的快捷键即可；**等 Lumir 产品总体框架基本敲定后，再做专项的快捷键安排和
  治理**。理由（Alex 原话意）：现在追求完美可能白浪费 token——若早前就精细安排好快捷键，pane 化
  这类结构变化会大幅推翻既有安排。适用范围：此后各 change 的键位指配按「单段、顺手、零冲突」从简，
  不做跨功能的全局键位体系设计；专项治理立项时机由 Alex 另裁。
- **Harness UX 一揽子裁决（2026-10-03，Alex 在 harness UX 讨论会话中裁定）**：
  ① harness 事件流带 vault/会话标识、面板按当前 vault 过滤——**采纳**，随「切 vault 后面板不刷新」的
  小修包一并实施（后端会话本就以 vault 根路径为键，见 `src-tauri/src/harness.rs` 的 sessions 映射与
  按 scope 取快照；缺口在前端只在挂载时拉一次 `harness_state`，切 vault 无监听）；② chat UX 大改
  **先在 `design/prototypes/` 出原型再实施**；③ 宽度拖拽、模型选择（运行期切换——配置面已有
  per-provider model 字段且运行时每轮请求时读一次，无需重建会话）、pin 式上下文块（章节锚定、可叠加、
  可移除）——**一律推迟到 pane 化 survey 裁决之后再推进**，避免先做了再大改或重做；④ split view 与
  「四栏困境」走 pane 化（Emacs window 模型：pane 可承载文档或 harness，界面上限三栏）可行性 survey，
  产出 ADR 草案后 Alex 裁决走不走。
  **同会话追加裁决（2026-10-03）**：⑤ 内存风险处置——pane 化过程中按实测提高门禁，内存使用的
  专项治理后置，门禁不阻塞 pane 化工作（已写入 ADR 0008 草案「代价与风险」节）；⑥ 「宽度被 pane
  分隔条吸收」的澄清——阅读栏宽（`ui.content_width` 及编辑器内拖柄）是 pane 内部属性、不受影响，
  被取消的仅是「dock 宽度拖拽」这个拟新做的功能（已写入 ADR 0008 草案 Decision 2）。
- **UX 动荡期整页基线纪律：批次末尾一次性重刷，中间不逐批维护**（2026-10-03，Alex 裁决，M311 基线轮对话）：
  背景是 M311 重刷的 26 张整页基线生命周期预计很短（接下来 UX 讨论可能带来不小改动）。**裁决**：UX
  改动期内，整页像素基线不在每个 UX 批次中途逐批重刷，攒到 UX 批次末尾一次性 `--update-snapshots=all`
  重刷 + Alex 过目一次；元素级断言与 CI 结构层（`LUMIR_VISUAL_STRUCTURAL=1`）照常逐批守，不放宽。
  同批另一项简化（同次裁决）：纯基线增量 commit（零代码）的复审轮由 tower 亲自做机械核验（sha256 与
  Alex 过目图逐字节一致 + 只含基线 png + 门禁复跑绿）后落 verdict，不再派 k3 reviewer——M311 r2 即按
  此执行。UX 定型后恢复逐批维护与 reviewer 复审的完整纪律。
- **S15/S16 · 键位面板维持 680px 三列（有意偏离定稿 440px 两列）**（2026-09-25，Alex 裁决，M220
  登记）：M215 gap 报告 §3.9 / §4 #15–#16 实测实现宽 680、三列（key + 命令 id + 说明；命令列
  11px `--text-3`），定稿 `.kbpanel` 是 440px、两列（key + 说明，index.html:729）。**裁决：维持实现
  形态**——命令列对排查自定义 `keys` 配置有实际用途，信息密度收益大于与定稿的几何差。**口径**：这是
  **有意的偏离、不是缺陷**；随宽度成立的行几何（行 gap / 行字号 / key 列宽 / padding）一并维持实现值，
  后续 parity 复核不再作为新发现上报。
- **A2 · 结束标记维持短双线形态**（2026-09-25，Alex 裁决，M220 登记）：M216 gap 报告 §2.3 #8——定稿
  `.doc-end` 是 `flex: 1` **通栏**双线夹字（index.html:298-302），实现是 48px **短**双线
  （`src/preview/theme.ts` 的 `.cm-lp-end-marker`）；做短是**有意**与作者手写 `---` 的通栏线区分，
  理由写在该处注释。**裁决：维持实现形态**——定稿 CSS 有形，但 12 张定稿图**从未实例化**该元素
  （grep 仅 CSS 一处命中），通栏形态没有可对照的定稿观感，短双线的「封口感 + 与 hr 结构上不同」
  成立。**口径**：同上，不再当偏差发现上报。
- **C6 · 代码块头部条维持围栏行方案（spec 背书，不另造 DOM）**（2026-09-25，Alex 裁决，M220 登记）：
  M216 gap 报告 §2.3 #6——定稿 `.cb-head` 是左右双段头（语言名 + 操作位，index.html:368-372），实现是
  **围栏行原文**（```js）的降级排版（10.5px / `--text-3` / +0.03em，`src/preview/theme.ts:197-206`）。
  **裁决：维持围栏行方案**——既有 spec 口径：围栏行是**源码的一部分**，它要求「围栏代码块的分隔行与
  源码保持可选中的原文」，所以把语言标记提到头部条位置读、而不是另造一个 DOM 元素（另造会把同一信息
  说两遍，且要动块级 widget 的测量路径）。**口径**：单段 / 双段的几何差记录在案、不判缺陷。
  **注意 C6 在这一批里是两件不同的事**：头部条 = 本条（维持）；代码块**容器**（r8 + padding 9·14·10 +
  margin 4·0·12）**随 M217 修复**（原 M218 任务 C6，判据规则落在 `src/style.css:772-864`，已随该文件的
  scope 迁出 M218、由 tower 裁决 2026-09-25 转 M217），不在本条维持范围内。

- **标题栏右侧「动作钮」区本版不渲染任何按钮**（2026-09-25，M213，tower 裁决）：tasks §4.3 的验收口径
  原文写「无打开文件时标题栏只剩 traffic 区**与动作钮**」，实现期由 tower 裁决**本版不加动作钮**——
  理由是动作钮的内容（保存 / 搜索 / 面板入口…）都没有定义，为一个未定义的东西先摆一排按钮会把
  「定稿图里没有的东西」写进产品。落点：`titlebar` 只 `append(traffic, tabStrip)`（`src/shell.ts`），
  delta 与 proposal 已把「右侧动作钮区」改写为**预留槽位（零可见内容）**，与 dock 预留列同一处置；
  真机场景 `34` / `35` 的空态与标题栏判据按「只剩 traffic 区」写。若 Alex 认为应当有动作钮，
  接口是标题栏右段加一个容器 + 定稿后再填内容（不涉及骨架改动）。

- **docs-check 在 master 上红了 5 天没人发现**（M150 期间 worker-testinfra 发现，2026-09-17）：ADR 0005 的 `状态: deferred（…）` 不在 docs-check 的状态枚举里（枚举只列 proposed/accepted/deprecated/superseded），而 `docs/adr/README.md` 的状态生命周期明确把 `deferred` 当合法状态——门禁与文档自相矛盾，于是 ADR 校验 job 自 2026-09-12 起每次 master push 都失败（实测：`gh run list --workflow=docs-check.yml` 最近 6 次全 failure，`gh run view 35184453904 --log-failed` 报「状态字段非法：'deferred（…）'」），**没有任何机制在看这个红**。根因是流程面的：tower 侧合并走本地 `gate.sh`（不含 docs-check 的 ADR 校验），GitHub Actions 的状态无人巡检，「CI 全绿才可合入」这条口径只在 Rust/视觉/perf 三门上有消费者。处置（2026-09-17 当批次已做）：枚举扩展为含 `deferred`（M153 改门禁判据、M150 改 `docs/process/adr-lifecycle.md` 的合法值清单与注解格式，并把 `deferred` 的语义写死为「搁置非放弃、须带全角括号注解、须保留 Revisit 条件」）。
  **待裁决选项（若要消除「红无观察者」这个结构，动作在别处）**：在批次收尾加一条「CI 状态检查」——收尾时跑一次 `gh run list --branch master --limit N` 确认最近若干次 push 的四个 workflow 都绿，红了就当场归因或落 finding。推荐采纳：本次的代价是一条 AP 级规则（`deferred` 合法）与它的执行者脱节了 5 天，而检查成本是一条命令；落点是 `AGENTS.md` 的「tower 操作」硬规则（本批次未改那个文件，故只在本条记录）。若 Alex 认为 GitHub CI 只是给 PR 用的旁路观察、不作为合并准入，则本项保持「记录在案」不动。
- **KimiCU AX 服务全局退化**（2026-09-16，M135 期间实测）：`get_app_state` 只剩菜单栏（`element_count`
  1–16、`truncated: [closed_menu, cycle]`、`window_bounds x=0 y=0 w=1 h=1`），Finder / Reminders / Lumir
  **一起坏**；`xpc-ping` 仍报 `accessibility=true screenRecording=true`。判定为 KimiCU 后台服务进了坏状态，
  恢复手段是重启服务（`/Applications/KimiCU.app/Contents/MacOS/kimi-cu install`）。这是机器级动作，
  已上报 tower 待 Alex 处理；套件本身无问题，恢复后重跑即可。
- **r1 格式崩溃备份**（无 base_revision）恢复后首次保存必报一次冲突——安全方向，仅限跑过 r1 build 的人。
- **kimi-cu `type_text` 走 AX 注入**，编辑器失焦时文本落陈旧原生选区——工具观测，非 app 缺陷。
- **`config.json` 解绑 ≠ 关闭能力**（已录 spec）：解绑后 macOS 原生选择器可能接手（如 ⌃K → `deleteToEndOfLine:`）——dogfood 改配置时预期内行为。
- **js/ts 对象字面量键的复合 `property` token 有意不修**（M147 finding，low）：`{1: "x"}` 的数字键取数字色、字符串键取字符串色（后者是 GitHub/VS Code 同款通行呈现），每次渲染伴一条 `Unknown highlighting tag property` console 噪声（CM6 按 part 名去重，不刷屏）；code 模式与围栏两侧一致，不构成 parity 缺口。若将来裁决「对象键一律属性色」，做法与 M147 相同——javascript/typescript 的 parser 挂 `{ property: tags.propertyName }` tokenTable（两处 LANGUAGES 同源）并核对 js/ts 基线；数字键要属性色还需处理 objprop 复合名（HighlightStyle 条目序裁决）。finding `20260917-worker-jsonhl-improve-javascript-typescript-property-token-console-json-js-ts.md`。
- **`scrollbar-gutter: stable` + 占位滚动条下 `scrollWidth` 恒等式断言必差 15px**（M177 worker
  finding，2026-09-18，low）：`.cm-lp-table-scroll`（`src/style.css:282`）的 `scrollbar-gutter: stable`
  在 classic 滚动条环境（CI macos-26 runner）预留 15px inline-end 沟槽，Chromium 在此状态下
  `scrollWidth` 与钳位可达滚动上限差恰好一个沟槽宽（CI 四次 run 逐位相同：2163 vs 2148；本地 overlay
  滚动条下恒等成立、复现不出，强制 15px 滚动条可复现同数字形状）——「滚到最右」用
  `scrollLeft + clientWidth >= scrollWidth - 1` 判定在此类环境必误红（m132-emacs-keys.spec.ts:373
  存量 CI 确定性失败的根因）。**教训（测试口径）**：这类断言改用环境无关判据——① 内容几何（表格自然宽
  右缘距容器右缘 <2px）；② 行为判据（已在最右时再按方向键不再移动，浏览器钳位是唯一真值）。M177 已把
  m132:351 的实例改完。**未做的可选动作**：重新评估 `scrollbar-gutter: stable` 的必要性（它防的是滚动条
  出现/消失引起的抖宽），或至少在 `src/style.css:282` 注释里写明 classic 环境的 15px 预留——属产品/视觉
  裁决，不急。finding `20260918-worker-m132-m115-bug-scrollbar-gutter-stable-scrollwidth-15px.md`。
- **toml 的表头 `[x]` / `[[x]]` 与布尔、日期共用 legacy mode 的同一个 `atom` token，tokenTable 分不开**（M179，2026-09-18，low）：`@codemirror/legacy-modes@6.5.4` 的 `mode/toml.js:44,57,59` 三处 `return "atom"` 分别对应节头、日期、`true`/`false`；M179 给 yaml 挂的 tokenTable 只按 token 名映射，无法「只把节头改成属性色」——故 toml 的表头与数字、布尔同取字面量色 `rgb(160,94,28)`。观感上 toml 仍有四色区分（键属性蓝、字符串绿、注释灰、字面量棕），与 rust / json 块同档，M179 据此裁决**接受现状**，并把这条记进 `openspec` 的「Markdown 渲染保真」requirement 的「已知例外」段落（与 rust 字符字面量那条并列，不再只列 rust）。**若要修**：只能 patch / fork vendored `mode/toml.js` 让节头产出独立 token 名，再在 `TOKEN_GROUPS` 给它一个角色（`TokenRole` 与 `src/editor.ts` 的 `CODE_COLORS` 两处穷尽检查同步）——等于 fork 依赖，M179 明确非目标。回归保护已在位：`tests/visual/scenes/render-codeblock.spec.ts` 有 toml 六类 token 的取色断言 + 元素级基线 `render-codeblock-toml-line.png`。

- **仅大小写改名不可达（大小写不敏感文件系统）**（2026-09-27，M244 r1 评审 P2-3，**记录在案**）：
  `note.md` → `NOTE.md` 在 macOS 默认 APFS（大小写不敏感）上走不通——前端同缀预检放行（集合里只有
  `note.md`），后端 `fs_io::resolve_new_in_vault` 的 `symlink_metadata` 在目标路径上命中**源文件自己**
  → `fs_already_exists`，行内提示「已存在同名条目：NOTE.md」，而树里并没有这个条目，提示对用户是误导的。
  **方向 fail-safe**（拒绝而非覆盖，磁盘逐字节不变），**tower 已裁（2026-09-27）：本批不做两步改名，登记为已知限制**。
  要修时的落点：`fs_io::rename_entry`（识别「目标存在且与源同一个文件」时先改临时名再改目标名，失败路径
  从一步变两步、要自带回滚与文案），顺带把提示改成能解释「同名但大小写不同」的那一句（需 `文案-Copy.md` 新编号）。
  现状与取舍同时登记在 `openspec/changes/file-tree-context-menu/design.md` §7.1。
- **rename 的「撞名不覆盖」是复查 + 极窄窗口，不是原子保证**（2026-09-27，M244 r1 评审 P2-2，**记录在案**）：
  `std::fs::rename` 的 POSIX 语义是原子替换已存在的目标，因此 `resolve_new_in_vault` 的探测与随后
  `rename` 之间有真实的检查-执行窗口（窗口内外部进程在目标名建出的文件会被静默覆盖）。现状：`rename_entry`
  在写路径上再复查一次，把窗口收窄到两次系统调用之间；零窗口需要平台原子排他改名（macOS
  `renamex_np(RENAME_EXCL)` 等），引 libc 与平台分支的收益与风险不成比例，**本批不引**。
  登记在 `openspec/changes/file-tree-context-menu/design.md` §7.2。
- **`applyListIndent` 的 `state.readOnly` 守卫当前无可达入口（保留守卫，不作覆盖声明）**（2026-09-27，
  M249 finding，tower 裁决采 ① 记录在案）：`src/editor.ts` 的 applyListIndent 有
  `if (view.state.readOnly) return;` 守卫，但 M231（editable-non-md-files）之后凡能进编辑器的文件类
  都可编辑，image/binary 类由三处 openKind 入口拦在编辑器之外——该守卫当前没有可达入口，
  「只读时缩进无效」这条行为也没有测试消费者（REVIEW.md 第 9 条形态）。**裁决：保留守卫**（对未来新增
  只读入口的防御），文档/场景只许写成「不可达、不构成覆盖声明」——场景 43 已在 M249 改正（原「只读模式
  （readOnly 提前返回）」的错误前提改为「非列表行无操作（D4a）」）。finding
  `20260927-worker-gate-hygiene-improve-applylistindent-state-readonly-review-md-9.md`。
- **vault_append（追加工具）视盘点后补**（2026-10-09，change `add-harness-permission-modes` 的 Non-goal 原样登记）：在既有文件末尾的追加写**本包不做**——Alex 打包范围第 ④条原文「视盘点加追加」。触发条件 = vault 写工具的 dogfood 盘点出现「追加」类高频缺口；届时按 ADR 0007 Decision 7 的边界原则（写且需防护才有 vault 工具）判断是否立项、以及追加是否需要 diff 之外的防护形态。

## 已核销（留痕，定期清理）

一行一条（日期 + 主题 + 去向）；从「待 Alex 裁决」区移出的条目沿用原编号（`原第 N 条`），旧引用按它对号。
条目正文已按维护规则移出本文件，需要原文时看 git 历史（`git log -p -- docs/backlog.md`）。

- 2026-09-16：**文件内搜索 v0**（M139，merge `647f519`）→ `src/search.ts` 的 editorial panel（⌘F 走 `keys.ts` 可重绑）；文案 D68–D72（M141 补录）。
- 2026-09-16：**验收套件注入假绿同族核销**（M140 merge `098918d` + M143 merge `d460535`）→ keys / type 动作补回读 + 有限重试、08b 落点重做、`checkScenario` 守卫；口径验证落 `_type-retry-unit/`。
- 2026-09-16：**验收套件 `file` 断言支持 glob 路径**（M144）→ `scripts/acceptance/lib/execute.mjs` 的 `resolveSpecFile`（取 mtime 最新的匹配）；同日重复跑时的残余风险写进场景正文。
- 2026-09-16：**外链渲染与打开快捷键**（M144）→ `⌘⏎` / `⌘-Click` 走 `link.follow`，scheme 白名单 http/https/mailto；其「非外链形态一律不装饰」的表述已被 M145 推翻（见下条）。
- 2026-09-16：**表格合同收窄——短行尾部补空列对齐 GFM**（M137 finding → M142 落地）→ `docs/specs/table-reading.md` §2/§9；证据 `tests/visual/scenes/table-foundation-v2.spec.ts`。
- 2026-09-16：**表格降级文案不暴露原因**（M137 → M138）→ 文案带文档行号与应为列数，单一来源 `src/preview/table.ts` 的 `degradationNotice`。
- 2026-09-16：**视觉门禁容差假绿** → `maxDiffPixelRatio` 0.005→0.001 + 删 UI 后核对基线时间戳（卫生步骤入 `tests/visual/README.md` 与 AGENTS.md）。
- 2026-09-16：**lists 100k 性能预算** → p95 40→60ms（随 dogfood 性能专项复核是否回调）。
- 2026-09-16：**`run.sh` 端口占用检查只查 4173** → 改查 `${LUMIR_VISUAL_PORT:-4173}`。
- 2026-09-17：**链接装饰全形态覆盖**（M145）→ 形态矩阵落 `src/preview/links.ts` 的 `classifyLinkTarget` / `src/main.ts` 的 `followLink` / `src-tauri/src/logging.rs` 的 `link_open{category}`；其两处待复核裁决即「待 Alex 裁决」第 7 条。
- 2026-09-17：**归档积压清理——7 个已合并未归档的 change 批量归档**（M150，Alex「好，采纳。你动手吧」含归档节点 2 批量授权）→ `openspec/changes/archive/2026-09-17-*`；防线 = `openspec-workflow.md` 新增的批次收尾 checklist 三条 + 撤回口径。
- 2026-09-17：**僵尸提案撤回 4 个**（M150）→ `archive/2026-09-17-withdrawn-*`（各 proposal 头部留撤回记录）；遗留缺口：列表对齐与基础表格阅读的 requirement 至今未进 living spec。
- 2026-09-17：**补记两处规格缺口**（M150）→ retro change `add-in-file-search` 与 `align-editor-live-preview-spec` 并归档（新建 living `in-file-search`）。
- 2026-09-17：**`tests/visual/README.md` 卫生节 missing**（M146 finding → M147 `c81b3ed`）→ 补「删除 / 移动 UI 元素后的核对（强制）」一节；finding 里顺带建议的 `run.sh --update` 回显提醒未落地。
- 2026-09-17：**`livePreview.ts:427` 注释引用已删除的 `openDocument`**（M149 r1 nit → M150）→ 改「装载（`editor.reloadSession`）」，同文件头「只读口径」的失实陈述一并改准。
- 2026-09-17：**`real-machine-acceptance.md` 证据落点指针悬空**（M150 顺手修）→ 改指 `test-results/acceptance/`（gitignore）+ 本文件的待真机验收节。
- 2026-09-17：**两条清扫类 finding 由 M152 闭合**（`6e8e70a`）→ `TableModel.reason` 的 `"incomplete"` 死值已删、语言注册表两处漂移收口到 `src/preview/code.ts`；**顺带暴露**：`REVIEW.md` 里 9 处以 `docs/backlog.md:NNN` 为证据指针的条目行号随之漂移，其中 7 处在本次之前就已指错——建议改用可 grep 的条目名（finding `20260917-worker-backlog-improve-review-md-docs-backlog-md-9-7-m155.md`）。
- 2026-09-17：**`link_graph.rs` 的 `MAX_FRONTMATTER_LINES` 注释失联 finding 关闭（前提失效）**（M152）→ 唯一仍成立的一点并入「待 Alex 裁决」第 8 条（frontmatter 上限分歧）。
- 2026-09-17：**openspec 归档 `add-diagnostics-logging`**（原第 6 条）→ `archive/2026-09-17-add-diagnostics-logging/`，living spec 落 `openspec/specs/diagnostics/spec.md`（M150 按批次授权执行；未勾任务 4.2 改由 CI `perf.yml` 承担）。
- 2026-09-18：**归档待办三件核销**（M170 归档节点 2）→ `archive/2026-09-18-startup-restore-off-main-thread/`（M156 提案 / M159 实现，merge `ad93a03`；**原第 12 条**）、`archive/2026-09-18-multi-vault-workspaces/`（M162/M163/M164，**原第 10 条**）、`archive/2026-09-18-toc-popover-emacs-keys-and-max-height/`（M160，merge `d4ca60a`；**原第 20 条**）；`validate --all --strict` 17 passed。
- 2026-09-18：**CI visual/perf 在 master 上长期红的治理批核销**（**原第 17 条**；M172 诊断 → M173 merge `475f069` / M174 `d967ce8` / M175 `7bea675`）：visual = runner 侧渲染环境不等价（非基线失效）；perf = resident-memory 确定性超阈 + `update-baseline` 结构死锁。口径：`visual.yml` 只守结构层、整页像素归本地 `gate.sh visual`（见 `tests/visual/README.md`）。
- 2026-09-18：**门禁清单三处过期**（M153 finding → 治理批 tower 直改）→ `AGENTS.md` 的 gate.sh 副本改指针、`tests/visual/README.md` 补 `isolation.test.mjs`、`README.md` 门禁表补一句。
- 2026-09-18：**另三个 change 归档核销——活跃 change 清零**（M181）→ `archive/2026-09-18-image-svg-and-fallback/`、`…-codeblock-toml-yaml-highlight/`、`…-line-wrap-options/`；`validate --all --strict` 14 passed / 0 failed。**原第 19 条**（图片行显露）在该批节点 1 裁 A = 维持现状，尾巴见「承接残项」。
- 2026-09-24：**五个 change 归档核销——活跃 change 从 8 降到 3**（M205 归档节点 2）→ `archive/2026-09-24-{typography-and-zoom,code-outline,code-variable-highlight,list-filter,remember-reading-position}/`（**原第 22–26 条**；归档顺序是硬约束：code-outline 先于 code-variable-highlight 才无悬空引用）；新建 living `openspec/specs/typography/`。
- 2026-09-25：**表格首列字重 550 静默失效**（M213，tower 收编）→ 判据改列索引 `[aria-colindex="1"]`（`src/style.css`）；闭环断言在 `tests/visual/scenes/restyle-content-types.spec.ts`。
- 2026-09-25：**restyle R3 收尾：场景与真机验收场景全量改写**（M213）→ `tests/visual/scenes/**` 断言随 token 层迁移、新增四个主题场景、真机新增场景 34 / 35；新场景不新增像素基线。
- 2026-09-25：**backlog #27 / #29 / #31 核销**（M213）：#27（原第 27 条）补 `typography` 的 MODIFIED delta ×4（16px → D1 的 15px 锚 + 新 token 名）→ `openspec/changes/restyle-ui-tokens-v1/specs/typography/spec.md`；#29（原第 29 条）的层级错相对链接由 tower 直修（4 层 `../` → 5 层）；#31（原第 31 条，结束标记字号基准与正文分叉）由 R2b 把 `.cm-lp-end-marker` 的基准改 `calc(var(--editor-font-size) * 0.8)` + M213 补双档门禁断言（`tests/visual/scenes/end-marker.spec.ts` 里以「backlog #31」命名的那两条用例）。
- 2026-09-25：**`.cm-lp-quote-line` 的 `padding-left` 声明无消费者**（M213 登记 → M218 任务 C4 修复，merge `456ee47`）→ 双类选择器提权到 14px；探针三主题实测 255/255 PASS。
- 2026-09-25：**mermaid 不随主题**（M214 finding → M219 任务 C10 修复，merge `7208867`）→ 静态 `MERMAID_CONFIG` 改为 `initialize` 时读 token 计算值（`theme: "base"` + themeVariables）；dark 连线对比度 1.07 → 10.45。
- 2026-09-25：**段落间距 / 标题间距未按 tokens 间距阶梯落地**（M212 finding → M218 任务 C1 修复，merge `456ee47`）→ 间距阶梯落 `livePreview.ts` / `theme.ts`，探针三主题 255/255 PASS。
- 2026-09-25：**M208 归档批两件**（**原第 28、30 条**）→ `archive/2026-09-25-document-end-marker/`（M189 实现；含任务的数字 / 口径订正与 15 条相对链接补层）、`archive/2026-09-25-open-image-lightbox/`（M184 实现；双击通道由 M209 打通、真机场景 33 落库）。
- 2026-09-26：**验收套件 `--config` 静默丢掉 `app.windows[0]` 窗口级配置**（M213 登记 → M236 修复）→ `launchApp` 改从 `tauri.conf.json` 读原件再 spread + `assertOverlayChrome` 自检；证据 `test-results/m236/`，反向前置验证红。
- 2026-09-26：**版本号 bump 策略**（**原第 33 条**）→ Alex 裁按 semantic versioning，M238 首 bump `0.0.0 → 0.1.0`（真源 `src-tauri/tauri.conf.json`，`package.json` / Cargo 侧随同批跟改）；口径原文与未落地的那一格见「承接残项」。
- 2026-09-26：**gate.sh PASS 时删临时日志**（**原第 34 条**）→ 已裁已落地（M238：PASS 分支去掉 `rm -f`、PASS 行打印完整日志路径）。
- 2026-09-26：**分模式折行默认（md 折 / code 不折）**（**原第 35 条**）→ 已裁已落地（M247）：新键 `editor.code_mode_line_wrap`（布尔，出厂 `false`，MUST NOT 回读 `line_wrap`），change `code-mode-line-wrap`；证据 `tests/unit/wrap.test.ts` + `tests/visual/scenes/m247-code-mode-line-wrap.spec.ts`。
- 2026-09-26：**配置项可发现性**（**原第 36 条**）→ ① `docs/specs/config-reference.md` 已落地（M247：键值表 + 容错口径 + 写回纪律 + 配置目录布局）；② describe-config 面板中期另立项，尾巴见「承接残项」。
- 2026-09-27：**文档合同卫生批**（M250）→ living spec 路径同步（change `sync-vault-registry-dir-spec`）、`changeFilter` 文字面清扫（含把 scope 扩入两个 change 目录）、场景 39 mousedown 悬案收进 `REVIEW.md` 第 16 条、`tab-cycle-keys` 任务对账（11 项里 10 项核实勾选）。
- 2026-09-27：**watch 增量不覆盖外部新建目录（文件树不刷新）**（**原第 32 条**）→ 已核销（M245，merge `b6ecfd7`）：产品侧无缺陷、原 finding 的根因判断不成立，错在验收断言的观测时序；证据 `test-results/acceptance/m245-final/36-restyle-content/`。
- 2026-09-27：**配置目录改名 `workspaces/` → `vault-registry/`**（**原第 37 条**）→ 已裁已落地（M248，merge `d989197`）；living spec 由 change `sync-vault-registry-dir-spec` 同步并归档（merge `5ac43e3`，幂等替换）。
- 2026-09-27：**change `product-version-display` / `live-theme-switch` 待归档跟踪**（**原两处重复编号的第 32 / 33 条**）→ 早已由 M253 归档批归档（`archive/2026-09-27-product-version-display/`、`archive/2026-09-27-live-theme-switch/`），跟踪条当时未同步核销，2026-10-03 由 M308 批次收尾核销。
- 2026-09-27：**change `sync-vault-registry-dir-spec` 待归档跟踪**（**原第 38 条**）→ 归档已执行（M254 收口，merge `5ac43e3`）。
- 2026-09-28：**M254 两个 change 归档 + 菜单上屏语言裁决点**（**原第 39 条**）→ `archive/2026-09-28-tab-strip-context-menu/`、`archive/2026-09-28-preview-tab-removal/`（M287 归档批）；上屏语言已裁英文并由 M257 落地（merge `cd9142d`）。
- 2026-09-28：**归档 change `goto-line-command`**（**原第 40 条**）→ `archive/2026-09-28-goto-line-command/`（M287 归档批；归档当时基线 18 passed / 0 failed）。
- 2026-10-03：**「保留我的版本」后自动保存暂停但用户无感知**（**原第 3 条**）→ 已失效：自动保存整条移除（change `remove-autosave`，M278，2026-09-27 合并）；若仍有「用户不知道文档仍是 dirty」的诉求，须针对显式保存路径重开新条目。
- 2026-10-04：**真机验收 4 项预存失败（31/47/49/52）全部修复**（M323 merge `f04276d`、M324 merge `801312e`、M325 merge `f872a66`）→ 四项根因全在测试套件 / 场景侧、产品代码零改动；「全量绿通过线显式扣除 4 项」的 interim 口径撤销。
- 2026-10-05：**2026-09 月份归档件的存量断链修齐**（M331，分支 `feat/fix-stale-archive-broken-links-2026-09`）→ 27 条 `](../` 断链修齐（20 条补一层 `../`、2 条多一层改回、5 条有意虚构示例不修）。
- 2026-10-07：**M375 rust 字符字面量在围栏代码块里着色**（merge `b79e13a`）→ `tagsForStyle` 改按 CM6 `createTokenType` 语义逐名结算；同批删 living spec 的 rust 例外句。**M380 移交的旧签名文字核销**（`startup-restore-off-main-thread` 归档件仍记已删的 `expect_generation`）→ 归档件是冻结快照，现行签名由 living spec 与代码承载。**M374 轮次闸门致 m347 主用例红** → 由 M378 把 usage 注入移进开轮窗口修复（merge `2bd79d4`）。
- 2026-10-09：**点历史会话行面板不重建 + 无文档发送 `context_json` null**（M398，merge `9a9a422`）→ `SessionResumeInfo` 携带消息、前端抽 `renderSnapshotMessages` 复用；新增验收场景 107。
- 2026-10-10：**Kimi Responses 端点接受 `input_image`（data URL 形态）实测通过**（M440，`src-tauri/tests/harness_real_kimi_image.rs`）→ Alex 配置里 `k3-256k` 的 `vision` 可声明 `true`，其余模型按「未声明 = 不支持」保守默认。
- 2026-10-12：**M467 结构性清理本次移出的条目**——本节上述带 `原第 N 条` 的行即其去向；**原第 41 条末格（`vault-open-ignore-set` 任务 8.4）核销**：Alex 裁决「grep `~/.config/lumir/logs/*.jsonl` 这一条没有输出，估计路径已经过期了（后续迭代改了路径），直接销掉吧」——读数动作随日志路径行进而失效，不再跟踪（同批从「待 Alex 裁决」区与「待修 findings」的同名条移除）。
- 沿革两条（原文已收进本节索引）：**批次三** = 键位分发三轨并行 + 扩展名注册表漂移（M130/M131/M132）、`save-ipc.ts` 折回 `ipc.ts`（M132）、Ctrl-K/D/T 原生路径风险（M132）；**批次二** = DeepSeek Flash 试用结论（可做 build，review 环节 k3-256k 不能省）。

## 批次报告索引（原 M282–M296 报告节，2026-10-12 按体量红线压缩）

报告正文移出本文件，一行一条留指针；原文看 git 历史（`git log -p -- docs/backlog.md`）。

- **M282 遗留**（change `ui-language-i18n` 实现批，2026-09-28）：D6 参数面已闭合、`picker_title()` 已按语言取值；**残留** = 日志文本语言口径待确认 + 验收套件退出码分档（另条跟踪） → 证据 `test-results/m282/`。
- **M284**（验收套件语言面修复，2026-09-28）：机制 = `run.mjs` 的 `SUITE_LANGUAGE = "zh"`（套件不再依赖产品默认值）；盘点读数与探针落 `test-results/m284/inventory.json`；顺带发现三件（`src/shell.ts:89` 标签段读屏名、preview `eq()` 语言盲区、启动恢复 notice 泄漏中文）已 file finding。
- **M285**（选区自绘 + 标签段读屏名，2026-09-28）：装 CM `drawSelection()` + 标签段读屏名挂 `onRelabel`；先红后绿 `test-results/m285/{pre,post}-fix/`；新增真机取色通道 `lib/pixel.mjs`（口径见 `scripts/acceptance/README.md` 的 `pixel` 小节）。
- **M291 选区族对比度**（三主题，2026-09-28）：token 层拆 `--sel-band` + eink `--sel` 族整体重定；真机读数 `test-results/m291/{before,after}/steps.md`；未收口面（in-flow 底色盖住选区带）见 finding `20260928-worker-selection-contrast-m291-improve-inline-surface-band-coverage`。
- **M288 代码块内选区不可见**（2026-09-28，merge `eef2556`）：块底色搬到容器的负 z-index 伪元素；判据 `tests/visual/scenes/m288-codeblock-selection.spec.ts` + 真机场景 66。
- **M293 eink 字面值归位 token**（2026-09-29，Alex 裁「改。你可以安排时就动手。」）：11 条规则归位、三主题渲染值逐值不变；读数 `test-results/m293/readings-{before,after}.txt`。
- **M294「面」族与一处前景色归位**（2026-09-29，Alex 裁「1. 立；2，删。」）：5 处落点 + 两条 MUST NOT（行区带那一层不动）；读数 `test-results/m294/`。
- **M295 行内 code 药丸选中态不可辨**（2026-09-29，Alex 裁「1. A。2. 顺手收 3. 认。」）：选中段换挡 `--sel-band`；真机场景 68 PASS；同机制未收口面（callout 行底色 / frontmatter 区 / code 模式变量底纹）另立。
- **M296 大 vault 打开忽略集的验收半边**（2026-09-29）：场景 67 落地 + 真机 7/7 PASS + 套件新增 `do: waitFor`；读数 `test-results/m296/readings.md`；**未完成项**（8.3 残余档、归档门禁）见「待修 findings」的 `vault-open-ignore-set` 条。
