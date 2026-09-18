# Backlog — findings 与待裁决队列

唯一的积压载体（2026-09-16 起自 HANDOFF.md 迁入并入 git）。

维护规则：

- 新 findings 由发现者（worker / reviewer / tower）落成条目，注明**来源 mission/批次**与**日期**；HANDOFF.md 只记 session 状态，不再积压。
- 条目状态：`待裁决` / `待修` / `待验收` / `记录在案`；核销后移入文末「已核销」并定期清理。
- 每条尽量附复现/证据指针；裁决类条目给出选项与推荐。

## 待 Alex 裁决

1. **历史敏感信息是否 filter-repo**：M111/M115 历史提交中的真实文件名；`docs/design-parity-contract/evidence/*.log` 约 20 行本机路径。tower 建议不必（仓库 M3 前不公开）。遗留自批次一。
2. **demo 右侧探针栏去留**：版面/文案决策，建议随 theme 重做一并处理。遗留自批次二。
3. **「保留我的版本」后自动保存暂停但用户无感知**：无回归；提示文案留 UX 重做阶段。遗留自批次二。
4. **宽表横向溢出裁切是否预期**：实测溢出 1549pt vs 栏宽 766pt，AX 层完整。待 Alex 对照设计规格确认。遗留自桌面复验（M116 期）。
5. **Emacs 档 3 与全产品键位**：isearch / mark / region / ⌃X 前缀，及左栏 tree/shell 零键盘支持——待 UX 重做会话与 dogfood 反馈后立项。批次三遗留。
6. ~~**openspec 归档 `add-diagnostics-logging`**（M134 已合并，2026-09-16）：实现与文档已入库，归档评审待 Alex 点头。~~ **2026-09-17 M150 已按批次授权执行**（Alex 对整体 review 的裁决「好，采纳。你动手吧」含归档节点 2 批量授权）：归档为 `openspec/changes/archive/2026-09-17-add-diagnostics-logging`，living spec 落 `openspec/specs/diagnostics/spec.md`；其未勾任务 4.2（`gate.sh all` 全绿）就地标注改由 CI perf.yml 承担（本地 `all` 因既有内存合同超标不可能全绿，见本条下方第 7 项），核销记录见「已核销」。
7. **内存合同存量超标**：2026-09-06 evidence 218–222MB 已超 <200MB 合同（2026-09-16 未复测）——放宽合同还是专项治理，随 dogfood 性能专项拍板。
8. **共享 `CARGO_TARGET_DIR` 与 dev-only 脚本化驱动入口**（工具链节 2/3 的长期候选）：是否立项待裁决。
9. **链接形态矩阵的两处 tower 裁决**（M145，2026-09-17，Alex 未逐条点头）：① 相对路径**非 md**（`[x](./doc.pdf)`）带 `↗︎`（语义「会离开本应用」）而不是 `→`；② **纯锚点** `[x](#sec)` 带 `→` 但激活只给「暂不支持锚点跳转」toast（不做文档内滚动）。附一处同批未单独确认的口径：`[x](note.md#sec)` 按「应用内跳转 + 锚点部分忽略」处理。三处若要翻转，落点是 `src/preview/links.ts` 的 `classifyLinkTarget`（标记）与 `src/main.ts` 的 `followLink`（激活）。
10. **多标签会话恢复**（M149，2026-09-17）：重启后按「路径列表 + 激活项」重开上次的标签。v1 明确不做（当时口径「留 backlog」），做成什么形状与何时做待裁决。建议形状：存 vault 维度（registry 旁 `last_session`）、只存有序路径 + 激活下标（可选滚动 offset），**不存**未保存内容与撤销史；打开必须走 `openFile` 既有链路；文件已删/不在 vault 内时跳过并记诊断；启动日志记一条 `session_restored{count}`（`log_event` 通道已有）。时机建议：等 dogfood 反馈「常态开几个标签」后再定，避免为 2 个标签的场景过度设计。finding `20260917-worker-tabs-idea-m149-backlog.md`。
    **状态更新（M164 收口，2026-09-17；change `multi-vault-workspaces` 任务 7.1 口径）**：本项已由该 change **承接并落地**——后端 M162（`eafd258`）与前端 M163（`fb2dc26`）均已合并；**归档评审已过（2026-09-18，节点 2），已归档**为 `openspec/changes/archive/2026-09-18-multi-vault-workspaces/`（living spec 落 `openspec/specs/vault-workspace/spec.md` 的 7 条 ADD 与 `openspec/specs/multi-tabs/spec.md` 的 1 条 MODIFIED）。落地的形状与上面的建议有**三处有意差异**：① 会话**不与注册项同文件**，单独落在 `<config>/lumir/vault-sessions/<id>.json`（design §2：注册项是身份，其读取路径对解析失败一律跳过，把易变的界面状态混进身份文件会把「会话写坏」升级成「vault 从列表与 remap 候选中消失」）；② 激活项存**相对路径**而不是下标（下标在列表变化后指向别处；不可用时按「退化到第一个可打开的标签」处理）；③ 恢复走 `openFile` 的 **`pinned` 意图**逐标签打开（预览意图会让第二个起顶掉前一个，只剩最后一个）。落定口径见 `openspec/specs/vault-workspace/spec.md` 的「按 vault 持久化标签列表」与「装载后恢复标签列表」；真机证据见本文件「待真机验收」第 18 项。
    **v1 建议里唯一未落地的一条（如实登记，不当缺陷）**：启动日志的 `session_restored{count}` 没有实现——`src-tauri/src/logging.rs` 的事件白名单里没有该事件，`src/vault-switcher.ts` 的恢复路径也不发埋点（实测 `grep -rn session_restored src/ src-tauri/src/` 零命中）。design §9 把它写成「观察点（`log_event` 通道已有）」，那句**与实现不符**；它是建议里的观测手段、不是 spec 的 SHALL，故不改已评审的 design 正文，记在这里。**观测缺口**：目前「上次恢复了几个标签、跳过了几个」只能靠真机截图与场景断言看，跑不套件时看不到。若补，落点是恢复结束时发一条 `log_event`（需同时扩 Rust 白名单）。
    **仍未做的边界**：光标位置、滚动位置与撤销史都不恢复（决策 3 的口径，未变）；「常态开几个标签」的 dogfood 反馈仍未取得，因此本项**不做**「会话数量上限 / 清理策略」这类后续设计。
11. **跨语言 frontmatter 上限 Rust 200 vs TS 512（201–512 行分歧）**（**待裁决**；M152 finding，worker-langunify，
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
12. **冷启动 `restore_last_vault` 在 setup 主线程同步跑（真实 vault ~125ms、4× 规模 ~770ms），推迟首帧且
    perf 门禁看不见**（**已立项并实现**（M156 提案 → M159 实现，2026-09-17；**已归档 2026-09-18，节点 2**，`openspec/changes/archive/2026-09-18-startup-restore-off-main-thread/`）；M154 survey，
    worker-rustasync，2026-09-17，high——本批唯一「用户可感」的主线程阻塞项）：`src-tauri/src/lib.rs:97`
    在 setup 内同步调 `open_vault`，其内部串行做注册表 IO + watch + `scan_workspace` + `build_graph`
    （逐 md 读文件 + 解析 wikilink 建索引，实测 scan 14.0ms + build_graph 111.2ms；4× 规模 32.9 + 736.7ms），
    随 vault 线性放大（约 12–16ms/MB md 字节）。tauri 在 setup 之前就已按 config 建好窗口
    （tauri 2.11.5 `app.rs:2524-2531`），所以这段占着主线程、用户可见首帧被推迟。
    **机制表述更正（M159，证据见 `openspec/changes/archive/2026-09-18-startup-restore-off-main-thread/design.md` §1）**：不是
    「run loop 未启动」——用户 setup hook 由事件循环的**首个 `Ready` 回调**驱动（`app.rs:1423-1427`），
    准确说法是「主线程被占在事件循环首个回调内，回调返回前无法绘制」。结论不变：这段耗时直接加在
    「用户看到可用界面」之前，且它不是 command、`#[tauri::command(async)]` 覆盖不到它。
    **可见性缺口**：perf 合同的冷启动端点是 stdout `LUMIR_READY`（`ready.rs:27-43`），该行在恢复之前打印
    （`lib.rs:94`），因此 <300ms 合同与 CI 相对回归门禁对这段耗时结构性失明；M159 的处置是**让这段工作不再
    占主线程**（ready 行的位置与语义不动，见 `docs/specs/perf-measurement.md` §1 的说明），不是挪 ready 行。
    **tower 处置（已执行）**：P1 立项走 OpenSpec change——finding 明确「改的是启动时序（首帧与恢复的可见性
    顺序），属行为变更，不要作为补丁直推」。提案 `startup-restore-off-main-thread`（M156）已合并且节点 1 已裁决，
    实现见 M159：`VaultState` 增打开世代号 + `restore_pending`，恢复落在命名线程 `lumir-vault-restore`，
    完成信号 `vault:restore_finished` + 前端以 `vault_current` 为权威状态。finding
    `20260917-worker-rustasync-bug-restore-last-vault-setup-scan-build-graph-perf.md`。
13. **`save_markdown` 的 CAS 窗口实测 4–94ms，窗口内的外部改写会被 rename 静默覆盖**（**待裁决（先裁方案
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
14. **前端单测层（`tests/unit`，26 用例）只在本地 gate，未进任何 CI workflow**（**待裁决**；
    reviewer-testinfra finding，2026-09-17，low，无归属 mission）：M153 落地的单测层只接进
    `scripts/gate.sh quick`；`.github/workflows/rust.yml` 的路径过滤仅 `src-tauri/**` 与 `src/bindings/**`
    （不含 `src/**`），`visual.yml` 触发 `src/**` 但步骤里没有 `pnpm test`。于是 `keys.ts` 的 chord 解析、
    `save-controller` 状态机这类纯逻辑若回归，CI 全绿而只有本地红——而 `rust.yml` 文件头自称「AI-only
    模式下 CI 是唯一防线（ADR 0004）」。**tower 处置建议**：待 Alex 裁决「CI 是否也守前端纯逻辑」。
    若要做，成本极低：`visual.yml` 已有 node 22 + pnpm 环境，加一行 `run: pnpm test` 即可（单测层秒级）；
    M153 的 mission 书本身把这一层定位为「本地快速反馈层」，所以这属于**定位裁决**而非缺口补齐。finding
    `20260917-reviewer-testinfra-improve-gate-sh-quick-ci-workflow.md`。
15. **perf 端点 `open-1mb-file` 从「磁盘 IO 占位口径」修订为真实打开路径**（**待裁决（立项）**；
    worker-testinfra idea，M153，2026-09-17，medium）：该端点现在量的是「读 1MB 文件到内存 + UTF-8 解码」
    （M1 遗留占位，实测 p95 1.12ms / median 0.44ms），却被 `perf.yml` 与 `tests/perf/thresholds.json` 以
    100ms 绝对阈值 enforce——它变绿**不等于**「打开文档」体验没退化（不含读取后的解析、CodeMirror 装载与
    首帧渲染）。M153 已在脚本头、`meta.note` 与 artifact 里如实标注「占位端点 + 已 enforce + 修订义务」。
    **tower 处置建议**：立项一个「性能合同端点修订」mission——① 定端点（建议「打开请求 → 编辑器首帧
    渲染」，测量通道复用 keypress-to-paint 的 CDP 注入机制）；② 按新端点重标定 contract 与容忍线（不能
    沿用 100ms）；③ 重建滚动基线并归档旧口径结果，避免新旧数字混比；④ `docs/specs/perf-measurement.md`
    记口径变更与不可比说明。可等 dogfood 性能专项一起做。finding
    `20260917-worker-testinfra-idea-open-1mb-file-io.md`。
16. **「用户主动打开 / 切换 vault」仍走同步路径，大 vault 上会有等量级的界面无响应**（**待裁决（是否立项）**；
    change `multi-vault-workspaces` design §9 登记的后续项，M164 收口时按任务 7.2 落到这里）。M159 只把**启动恢复**
    移出了主线程（`lumir-vault-restore`），用户主动触发的打开/切换仍走 command 线程上的同步 `open_vault`：
    注册表 IO + 建 watch + `scan_workspace` + `build_graph` 全在一段里跑完才返回，实测真实 vault 约 125ms、
    4× 规模约 770ms（同一段代码，数字出自身为本变更提供依据的冷启动实测，见本文件第 12 条），期间界面不重绘。
    change 明确**不修**（非目标），且**刻意不引入进度条 / 遮罩**——同步路径下界面在此期间不重绘，这类元素不可见
    （口径见 spec「vault 切换与整窗上下文替换」最后一句）。**需 Alex 裁的是要不要立项异步化**：① 收益是切换
    「人手可感知的卡顿」消失；② 代价与 M159 同族——先后端把提交移出主线程、再处理与用户后续操作的让位规则
    （M159 已有的 `restore_pending` / 世代号是先例，可复用），前端则要重新设计过渡态（进度或乐观切换），
    这会推翻本变更「不做过渡元素」的口径，因此不属收口范畴。建议时机：与 dogfood 的性能专项一起裁
    （与第 12 条同批），不要单独提前做。
17. **CI 的 visual 与 perf 在 master 上长期红（自 2026-09-13），与本地 gate.sh 全绿结论相反**（**已核销**：治理批 M173/M174/M175 全部合并，核销记录见文末「已核销」节的 2026-09-18 条；M169 survey
    finding，worker-archive-survey，2026-09-18，high）：master 最后一次 push（`2f16f86`）上 visual 30+ 条
    失败（整页基线像素差 3176–7207px，容差仅 ~960px，远超临界抖动）、perf failure（但冷启动 median
    117.76ms < 300ms 合同，失败端点未定位）；rust / docs-check success。同一提交本地 `gate.sh visual`
    12/12 PASS——同 commit 两种结论，说明 CI runner 与本地渲染环境不等价（或基线本身失效）。**需 Alex 裁**：
    ① 先立项判定 visual 红是环境漂移还是基线失效；若确认环境不等价，整页像素断言退出 CI（CI 只守结构/
    计算属性断言、像素归本地），口径写进 `tests/visual/README.md`；② perf 定位失败端点（可能落在第 7 条
    内存合同存量超标）。**修好之前，任何引用「CI 全绿」的裁决依据显式降级为「本地 gate.sh 全绿 +
    rust/docs-check 绿」**。finding
    `20260918-worker-archive-survey-bug-master-ci-visual-2026-09-13-perf-gate-sh.md`。
    **状态更新（2026-09-18，M175 登记）**：**M172 已定位，治理批已立项，本条不核销——核销时点是治理批
    M173 / M174 合并之后**。survey 报告 `.tower/comms/inbox/20260918-worker-ci-diagnosis-tower-survey-summary-m172-ci-visual-perf-perf.md`（M172，已并入 master；survey 零文件改动，正文只活在 `.tower/` 内，此处留名备查）。定位结果：
    - **visual = 渲染环境不等价，不是基线失效（M169 让裁的两选项「环境漂移 / 基线失效」已判定为前者）**：把 CI 的 `visual-diff`
      artifact 里 40 张 `*-expected.png` 与入库基线做 sha256 → **40/40 全同**（CI 没拿错基线、基线也没被改坏）；
      差异只落在字形栅格层——纯色平区域与 4px 实心几何**逐字节相同**、24px 宋体标题**零差异**、字体身份未被替换
      （二值墨迹 IoU 0.46–0.79 而墨量不变）；同 run 首跑与 retry 报**完全相同的像素数**（确定性，不是抖动）；
      runner 镜像与浏览器在绿 run（09-05）与红 run 之间**完全一致**（macos-26-arm64 / macOS 26.6.2 25G83 /
      Chrome for Testing 151.0.7922.34），故漂移源在本地侧或字体解析。形态是 CJK / 拉丁混排行被撑宽
      （导航行末端 +5px/200px ≈2.5%、frontmatter 值列 +7px），纯 ASCII 标签与 mono 元素裁图零差异；
      实测 22 条基线 20 红 2 绿（`22 failed / 232 passed`，run `35295440948` @`007aa086`）。触发窗口 =
      `0804552`（09-06 引入 text-autospace 等 editorial token）→ `cca9462`（09-12 基线重建）。**候选机制
      「入库基线可能由更新构建（chromium-1243）渲染」已被 M173 任务 1 实测推翻（2026-09-18）**：frozen
      lockfile 把 @playwright/test 钉在 1.62.1，其 chromium 即 v1234（Chrome for Testing 151.0.7922.34），
      与 CI 逐字同一构建；本机缓存里的 1243（153.0.8010.12）从未进入任何一次比对；本地同工具链全量
      254 passed。差异只能来自 runner 侧系统字体 / 渲染链。finding
      `20260918-worker-visual-ci-bug-m173-1-m172-frozen-ci-v1234.md`。
      反证已排除「本地假绿」：`scripts/visual/run.sh:12-23` 先查端口占用、再 `pnpm build`，并置
      `LUMIR_VISUAL_FRESH_SERVER=1` 关掉 `reuseExistingServer`，两种结论确实来自两个渲染环境。
    - **perf = 两个端点 + 一处结构性死锁**：`resident-memory` **9/9 确定性超阈**（实测 206.50–215.28MB >
      200MB 合同；2026-09-05 校准值约 110MB，稳态翻倍）；`keypress-to-paint` 9 次 6 红、读数散布
      **22.35–53.20ms（2.4 倍）**，而基线是单样本 28.15ms、40% 容忍线（39.4ms）正好落在散布中间；
      `perf.yml:102-104` 的 update-baseline 条件是 `if: success() && push && master`，内存永久超阈
      ⇒ **滚动基线永久冻结**（日志「最近 1 次 master」即证据）。`cold-start`（median 117.76ms < 300ms）
      与 `open-1mb-file` 全部合格，不动。
    - **治理批已立项（Alex 同日裁决，2026-09-18）**：M173 `feat/visualci`（原话「采纳你的建议」——CI 只守
      结构/计算属性断言、22 处整页像素对比挪回本地 `gate.sh visual`、`@playwright/test` 钉精确版本 +
      浏览器构建自证进日志、`macos-latest` 钉显式镜像）；M174 `feat/perf`（原话「允许提高 thresholds」+
      「无异议」——resident-memory 提阈（建议 250MB 档）、解锁基线死锁、keypress-to-paint 改与最近 N 次
      master 中位数比较或提容忍）。**三支均已合并**（M175 `7bea675`、M174 `d967ce8`、M173 `475f069`，
      评审全 clean，M174 经两轮）；合并后首个 master push（`475f069`）上的 visual / perf run 即新规程首跑。
    - **口径收尾（2026-09-18，治理批合并后）**：本条上段的降级规则解除，但「CI 全绿」的含义已被 M173
      永久改变——`visual.yml` 绿只代表结构层不回归，整页像素没有 CI 兜底（口径见 `README.md` /
      `AGENTS.md` / `tests/visual/README.md`）；像素层断言只能引用本地 `gate.sh visual` 的结果。
18. **远程 http(s) 图片直连分支在现行 CSP 下必然失败，且错误文案误归因为「解码失败」**（M165 finding，
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
19. **图片行不受「光标触及即显露源码」覆盖**（M165 finding，worker-svg-proposal-2，2026-09-18，medium，
    **节点 1 已裁：A = 维持现状**）：`src/preview/livePreview.ts:807-815`
    的 Image 分支无 `touchesSelection` 判断（对照 Link 分支 `:821` 有），图片引用被 replace 装饰整条藏起、
    光标进入该行不显露源码；且无 atomicRanges，光标可落进被替换区间而不可见（与 M119 修过的 callout 缺陷
    同族）。living spec `editor-live-preview/spec.md:25` 的显露枚举不含图片。提案给过两支：A 维持现状、
    单独立项（worker 建议）；B 并入该 change 给 Image 分支加选区判断 + spec 枚举补「图片」+ 一条 Scenario。
    **Alex 于 2026-09-18（change `image-svg-and-fallback` 节点 1）裁决 A = 维持现状**：该 change 不动图片行的
    显露口径（M178 实现期实测确认：`rg touchesSelection src/preview/livePreview.ts` 仍是六处调用、图片分支
    仍未触及它）。「图片行是否与链接/分隔线同口径」**留作将来单独立项**，本条保留、不核销——将来立项时
    落点是 Image 分支的 `touchesSelection` 判断 + `editor-live-preview` spec 的显露覆盖集枚举。
    finding `20260918-worker-svg-proposal-2-bug-live-preview.md`。
20. **change `toc-popover-emacs-keys-and-max-height` 待归档跟踪**（**已核销**：归档前补记、同日随归档核销，核销记录见文末「已核销」节的 2026-09-18 条；2026-09-18，M170）：流程口径要求每个 change 在实现 PR 合并时即落一条待归档记录并跟踪到归档（`docs/process/openspec-workflow.md` 的批次收尾 checklist 第一条）。该 change（浮层 80% 总高 + `⌃N` / `⌃P` 就地键，M160，merge `d4ca60a`）**合并时没有落这条记录**——全仓 grep `toc-popover-emacs-keys` 当时零命中，正是 M150 记过的失效模式（当时 7 个 change 只有 1 个被跟踪）。本 mission（M170 归档节点 2）在归档前补记本条，随后即随归档核销：归档为 `openspec/changes/archive/2026-09-18-toc-popover-emacs-keys-and-max-height/`，living spec 落 `toc-outline`（2 条 MODIFIED）与 `keymap-commands`（1 条 MODIFIED）；未勾任务 3.1 / 3.2 / 6.2 / 6.4 / 6.6 在归档动作里按证据勾齐（3.1 / 3.2 的产物由 tower 的 integration fix `a779cbb` 落在 `文案-Copy.md:77` / `:103` / `:111`；6.2 改由「零 Rust diff + CI `rust.yml` 在 `2f16f86` success」继承；6.4 由 M164 全量 26/26 与此后的 `13-toc` 复跑覆盖；6.6 即本条）。

## 待修 findings（不阻塞）

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
- **rust 字符字面量在围栏代码块里不着色（与 code 模式的 parity 缺口）**（M147 finding，medium）：
  `src/preview/code.ts` 的 `tagsForStyle` 遇「modifier 开头的复合 token 名」整条丢 tag（CM6 的
  `createTokenType` 只警告并保留其余 part）；rust simpleMode 的 `string.special` 触发——`'a'` 在
  code 模式取字符串色、在 ` ```rust ` 围栏里取正文色，M138 的「围栏与整文件打开 tag/颜色完全一致」
  声明对这类 token 不成立。影响面已枚举：收录语言里只有 rust（字符/字节字符字面量两种构造）。
  修法（finding 附建议 diff）：与 CM6 同语义逐名字段独立结算、跳 part 不丢整条；须配不变量测试
  （「simpleMode 复合 token 在围栏与 code 模式 tag 集合一致」）并走渲染缺陷合同先行流程核对
  rust 场景基线。finding `20260917-worker-jsonhl-bug-tag-token-rust-code.md`。
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
### shell / 系统

- **退出守卫菜单结构假设**（M101 review）；Dock/系统关机路径不覆盖。
- **注册表目录 `{id}.json.tmp` 无扩展名过滤会被当注册项解析**（M126 finding；修复时顺带清掉 sweep_registry 对非 .json 文件的写面）。

### 未复现

- **编辑区全空白偶发**：M114 一次、M116 0/3，复现条件未锁定。运行时诊断日志已落地（M134，
  2026-09-16），下次复现后查 `<config_dir>/lumir/logs/<UTC日期>.jsonl` 的事件序列定位。
- **视觉套件 `markdown-parser` 的 `large-mixed` 偶发失败**（M144 一次，低）：整轮视觉回归里它 `page.evaluate: TypeError: Cannot read properties of undefined (reading 'metrics')` 失败一次（该用例把 `mixed` 文档重复 2000 次喂给解析实验，并挂 CDP profiler 采样），单独重跑与随后整轮重跑都 10/10 PASS。现场没有留下可归因的线索（不是本批次的改动路径——该 fixture 是独立的 vite 子应用，不加载 `src/`）。**给后续跑 `gate.sh visual` 的人**：它若偶发报红，先单独重跑该 spec 再判断，别当成自己的回归。
- **`paragraph.spec.ts`「普通段首对齐 640」全量轮瞬态失败一次**（reviewer-toc finding，2026-09-17）：程序设 DOM 选区后下一拍 `getSelection()` 读到 `""`（预期 `普通段落不再缩进`）；隔离复跑 2/2 PASS、第二轮全量 8/8 PASS，与 M148 diff 无因果（toc 不产生装载后的编辑器 dispatch）。疑似全量负载下 CM 装饰重建把文本节点替换、Range 脱离导致选区坍缩——既有测试的时序敏感面；若发生在 CI 会红掉无关 mission 的门禁。修法：选区断言改为「同一 evaluate 内设选区并立即回读」，或读取端加 `expect.poll` 重试（`tests/visual/scenes/paragraph.spec.ts:38-39`）。finding `20260917-reviewer-toc-bug-paragraph-spec-ts-640-flake.md`。

### 验收套件（M144 实测出的表达力缺口）

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
  还决定 `^…$` 是整串锚定还是行锚定（`AXTextArea.value` 是整篇文档文本，行锚定会误命中编辑器节点）。
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
  建议：P2，与「待 Alex 裁决」第 12 条的启动时序分开处理（本项可直接做）。finding
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

- **门禁清单三处过期**（M153 finding，worker-testinfra，2026-09-17，low，**已核销**：2026-09-18 治理批
  收尾由 tower 直改闭合，核销记录见文末「已核销」节）：M153 给
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

### openspec 归档制品与实验脚本

- **历史归档文件的相对链接死链扫尾**（M150 finding，worker-speccleanup，2026-09-17，low，**待修**；
  **M155 已逐条在磁盘上复核并在本条更正 finding 的两处误差**）：根因已实证——`openspec archive` 把 change
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
   长期方案候选仍是本节第 2 条的「worktree 共享 `CARGO_TARGET_DIR`」与「待 Alex 裁决」第 8 条，与本条不冲突。

## 待真机验收

行为判定已下沉为 agent 可执行场景（入口 [scripts/acceptance/](../scripts/acceptance/README.md)，
设计见 [docs/process/real-machine-acceptance.md](process/real-machine-acceptance.md)）；手感/审美项仍归 Alex。

分类依据 = **证据目录里真实 PASS 的场景**，不是「场景写了就算覆盖」。最近一次全量实跑：
**M164 批次（本地 2026-09-18 凌晨；证据目录按 UTC 记为 `2026-09-17`）——26 场景 / 26 PASS 0 FAIL**
（`node scripts/acceptance/run.mjs`，含本批新增的 17/18/19 与 M160 遗留项的 `13-toc` 复跑），
证据 `test-results/acceptance/2026-09-17/`（git 外，`summary.md` + 各场景 `steps.md`/`shots/`/`ax/`）。
上一次全量：M149 批次（2026-09-17）22/22 @ `fab134c`。**本批的套件改动**（M164）：就绪门改判形态 A 的
入口读屏名（`AXPopUpButton`，不是 `AXButton`——写死角色会让整套在启动就超时）、窗口经 `--config`
定位到主屏（否则 macOS 会把窗口放到屏幕外、键盘注入整批不落地）、每场景增清 `workspaces/` 与
`vault-sessions/`、新增 `seed`（注册表 / 会话预置）与第二个合成 vault。**运行纪律**：无人值守批次用
`caffeinate -dimsu <cmd>` 包住（见「多 vault 收口遗留」里的实测现场）。

**M159 单场景实跑（2026-09-17，非全量）**：`16-startup-restore` **PASS / 10 断言 / 0 失败 / 29.4s**
（`node scripts/acceptance/run.mjs 16`，证据 `test-results/acceptance/2026-09-17/16-startup-restore/`，
含两张截图与 AX dump）。套件现 **23** 个场景（本条为该批新增）；全量实跑留待批次收尾，不在此宣称。

**已机验（行为判定落定，有 PASS 证据）**

1. **Mermaid 点击进源码编辑** —— `01-mermaid-click`：渲染态（成功块为 `help=围栏原文` 的 widget、
   失败块给「图表解析失败」+ 原文）→ 点击 widget → 源码显露、widget 让位。渲染中(pending)态窗口极短，
   只留截图。
7. **M124 三条恢复路径全部覆盖** ——
   `07-recovery-paths`（冲突双动作：外部改写后保存给「重新载入 / 强制覆盖」、内存改动未丢、磁盘未被静默覆盖）；
   `07b-recovery-saveas`（**真删除**触发 `fs_not_found`，不是清空——清空走冲突分支：⌘S 给「保存失败：文件
   已被外部删除或移动」+「另存为新文件」，点击后 `plain-恢复.md` 真实落盘且内容 = 内存缓冲）；
   `07c-external-reload`（干净缓冲 + 外部改写 → 编辑器文本自动换成磁盘内容，不打扰用户）。
8. **M127 自动保存链路四条子行为全部覆盖** ——
   `08-autosave`（2s 落盘：磁盘 sha256 变化且内容含输入）；
   `08b-autosave-pause`（**冲突待决期间自动保存暂停**：记录磁盘 sha256，跨 2s 去抖再等 7s，磁盘逐字节不变、
   仍是外部版本、冲突提示未消解；前置断言「探测串落在文档末尾 + AX 焦点在编辑器」M140 重做后稳定 PASS）；
   `08c-crash-recovery`（app 自己在隔离目录写的崩溃备份 →  重启后提示「恢复内容 / 丢弃备份」，
   点「恢复内容」后崩溃前内容回到编辑器）；
   `08d-crash-discard`（同现场点「丢弃备份」：给丢弃反馈且内容**不**进编辑器）；
   `08e-force-overwrite`（强制覆盖的不可撤销二次确认「覆盖保存」；覆盖后磁盘确是内存版本；
   再次冲突仍给同一组动作且磁盘未被静默覆盖）。
9. **Emacs 键位 / ⌘Z / ⌘/ 面板 / `config.json` keys 表** —— `09-emacs-keys`、`09b-keys-config`：
   **⌘Z 未被 macOS 视图层级吃掉**（插入 → ⌘Z → 内容消失，menu swap 真机成立，回退方案不必启用）；
   ⌘/ 面板打开/关闭、打开期间文档逐字节不变（作用域键与可打印字符都不穿透）；
   keys 表解绑 ⌘S / 重绑 ⌃S 生效。
10. **Markdown 渲染三件套**（M138）—— `render-markdown`：`---` 渲染为横线且 frontmatter 定界符
    不误渲（AX 面读到读屏名「分隔线」、`editor.not "---"`）；围栏代码块源码逐字保留、未收录语言
    保持纯文本；引用内有序/无序/嵌套列表按常规列表渲染（`- ` 与 `>` 都不再显露）。
    **配色与几何不进真机**：横线宽度=栏宽且本体 0 高、标记走等宽字体且同级正文列对齐、token 色值
    全部取自既有 editorial token——由视觉门禁 `tests/visual/scenes/render-{hr,codeblock,quote-list}.spec.ts`
    的计算色/几何断言守（chromium），真机只验文本层与 AX 结构。
11. **表格降级文案归因**（M138）—— `render-table-degrade`：表头声明 3 列、第 10 行有 4 格（**多列**，M142 起降级只由多列/槽位不可映射触发）时，
    AX 面读到「第 10 行单元格数与表头不符（应为 3 列）」与「保留原始 Markdown」，同时整块保持
    源码态（不丢列、不截断）；同 fixture 的短行表（末行少一格）自 M142 起按矩形渲染，AX 面读到
    `Markdown 表格`、该行源码不再显露。
12. **文件内搜索 v0**（M139）—— `search-01-find`（⌘F panel 出现、匹配计数、上一个/下一个导航、
    Esc 还原焦点）、`search-02-binding`（`config.json` keys 表重绑搜索命令生效）。
13. **链接渲染与激活（全形态）**（M144 起，M145 补齐）—— `12-links`（53 断言）：外链 / 相对
    路径 md / vault 内非 md 资产 / 纯锚点 / 白名单外 scheme 五类的装饰与激活分流；外链与资产的
    目标源码隐藏、光标触及整条显露、文档逐字节不变；⌘⏎ 开外链（日志 `link_open` 落盘且不含
    URL 原文）/ wikilink 跳转与未创建不建文件 / 相对路径 md 跳进目标笔记 / 解析不到只 toast /
    锚点只提示 / 不可用形态不装饰也不激活；`link_open` 的 `category`（external / internal-md /
    asset / anchor / blocked-scheme）逐类断言。
14. **TOC 大纲 popover**（M148）—— `13-toc`（17 步 / 32 断言）：masthead 当前位置指示段、
    ⌘⇧O 浮层开合、↑↓ 导航不穿透到编辑器、Enter 跳转后光标恰在标题行尾、空 heading 文档给 toast。
    配色与几何由视觉门禁元素级基线 `toc-popover-chromium-darwin.png` 守。
15. **多标签**（M149）—— `14-tabs`（43 断言）：单击预览替换 / 首次输入或双击固定 / ⌘1–9 直达 /
    ⌃⇥ 循环 / ⌘W 关当前标签（未命名 dirty 才确认）/ 后台标签外部删除被浮条点名。
    **语义变化（Alex 使用习惯）**：⌘W 从关窗变为关当前标签（菜单「关闭」项保留但无加速键，
    退出走 ⌘Q / 红灯）；有路径的标签间切换不再有 dirty 守卫；切换 vault 升级为任一标签 dirty 即拦。
16. **启动自动恢复 last_vault**（M159，2026-09-17）—— `16-startup-restore`（10 断言 / 29.4s）：
    默认 config（`last_vault` = 验收 vault）启动后自动进入 vault（树里出现文件）且**不残留**「恢复中」
    提示；`last_vault` 指向不存在目录后重启 → 未打开空态 + 「上次打开的 vault 已不可用：{路径}，
    请重新选择目录」+ 「打开 vault」入口（AXButton）在位、树里没有装载任何文件。
    **边界**：恢复中态本身通常不可见（典型 vault 远比前端挂载快），所以这里断言的是「不残留」而非「看见」；
    入口断言带 `AXButton` role 前缀——裸子串「打开 vault」在该 AX dump 里命中 4 行（masthead 的
    「未打开 vault」、编辑器提示也都含这四个字），带 role 后只命中真正的按钮行（实测 4 → 1）。
    **不宣称性能改进**：恢复耗时不再占主线程，但 `LUMIR_READY` 的出现时刻不变（本 change 不动该行位置）；
    「树晚出现」的观感归 Alex（截图在证据目录）。

17. **多 vault 列表与切换**（M164，2026-09-18）—— `17-multi-vault-switch`（38 断言 / 35.0s）：
    树头部入口（形态 A，D96 读屏名）打开列表浮层 → 浮层里两个 vault（当前项带「当前」标 +
    「2 个标签 · 现在打开」、没有历史的行给 D101 的串、底部 D104 的新增入口）→ ⌘O 开 / Esc 关的键位路径 →
    点列表行切到另一个 vault（整窗上下文替换：入口、树、正文、空 vault 引导都换）→ 切走前把当前 vault 的
    会话按**稳定 id** 落盘（`env:vault-sessions/acc-a.json` 的存在性 + `tabs` 有序 + `active`，三条 `file`
    断言直读盘，不是「界面看起来对」）→ 切回后按会话恢复两个固定标签且激活项正确（`BPIN` 只可能来自被存的
    激活标签；`editor.not "标签场景 A"` 是「激活项退化成了第一个」的反证）。两个固定标签经「单击打开 →
    键入（首次输入即固定）」这条真实路径得到——**双击固定在该套件里不可表达**：索引点击走的是 AXPress ×2
    （不是真 dblclick），`target.count` 也没有 x/y 变体，该路径由视觉通道覆盖。
18. **启动恢复 vault 并一并恢复它的标签列表**（M164，2026-09-18）—— `18-vault-session-restore`
    （7 断言 / 18.1s）：`seed.sessions` 预置 acc-a 的两个固定标签与会话里的激活项 → 启动后 vault 按
    `last_vault` 自动恢复、两个标签按会话恢复（`关闭 ` ×2）、激活项是 tabs-b、不残留空 vault 引导。
    与 16 的分工：16 验「vault 恢复本身」（含失效路径），本条验「装载后紧接着的标签恢复」；会话**写入**侧
    由 17 的 `file` 断言覆盖，本条只验读回与恢复。
19. **切换 vault 的 dirty 前置门三条出口**（M164，2026-09-18）—— `19-vault-switch-guard`
    （35 断言 / 24.2s）：用**外部改写**把 dirty 变成持久状态（冲突待决期间自动保存暂停，08b 已覆盖该行为）
    → 点另一行被拦下（D109 点名**当前** vault + 脏标签数，三出口齐全）→ 取消（留在 A、内容不丢、浮条撤下）
    → 同一条文案的第二次请求再次拦下（浮条按文案去重不得复用旧 proceed，M163 r1 P2-1 那条）→
    保存并切换（**保存未闭环 → 不切走** + 沿用既有的「重载 / 保留我的版本」出口，任务 4.2 的原文）→
    放弃修改并切换（切到 B、被放弃的内存改动不落盘、磁盘仍是外部那一版）。
    **未覆盖（套件表达力缺口，已记 `scripts/acceptance/README.md`「已知边界」）**：保存**能**闭环时
    「保存成功 → 继续切换」那条顺路——真机上它要求「文档变更后 2s 内发出切换请求」（自动保存防抖 2s），
    而键盘注入每键约 250ms + 一次 MCP 往返，抢不到那个窗口（两种抢法都实测不成立）。该路径由 chromium
    视觉通道 `tests/visual/scenes/mv-vault-switch-guard.spec.ts`（4 用例，含 `document_save` 写动作级
    判据）覆盖——**不要把 19 的 PASS 读成「三条出口的每条顺路都在真机验过」**。

**已机验到渲染/结构层，行为细节仍缺可观测面**

2. 公式进编辑 —— `02-math-click`：行内/块级公式均渲染为 KaTeX、源码不显露。
   **「公式后 ⌃B 是否 1–2 次」仍待判定**（需光标停在公式 span 之后；AX 输出不暴露光标/选区，
   纯键盘落位无法回读校验；代码口径 1 次，`mathSpanCrossed` 落点 = span.to−1）。
3. Ctrl+N/P 表格行为 —— `03-table-ctrl-np`：grid 表确实渲染成 `AXTable (Markdown 表格 N)` + `AXRow`
   单元格文本；⌃N/⌃P 序列后表格与文档内容完好。**逐 cell 落点不可回读**；实测按坐标点进 AXTable 的
   bbox 内也不会让渲染态表格让位给源码行，故不做该断言。
5. cell 内公式 —— `05-cell-math`：`$y$`/`$$y$$` 在 cell 内按行内样式渲染（AX 行文本 `行内 / y / 块级 / y`）。
   **「点击渲染态公式进编辑」不可机验**（KaTeX span 既不进 AX 树也不带 bbox，与项 2 同因）。
6. Callout —— `06-callout-and-width`：渲染态下 `[!note]` 标记与 `>` 前缀都不显露、内容按块渲染。
   **「光标进该行后源码显露」不可机验**（需光标落在 callout 首行）；表格宽度只留截图证据。

**仍归 Alex 手感（不下沉）**

4. 表头 cell 双击 padding 的选中手感。
5. 表格 cell 内公式点击手感；6. 表格宽度观感（欠宽不拉伸、超宽横滚是否合意，与「待 Alex 裁决」4 同源）；
7. WKWebView 下三条恢复路径的手感；9. Emacs 翻屏/扩选真机手感。截图在证据目录，判定归 Alex。
10. 分隔线的粗细与上下留白、围栏代码块配色的观感（M138）——机器断言只钉「渲成横线（发丝线、
    宽度=栏宽）」与「色值取自既有 editorial token」，合不合意归 Alex；前后对比见
    `tests/visual/baselines/render-*.spec.ts-snapshots/` 与真机截图。

## 记录在案（无需动作）

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

## 已核销（留痕，定期清理）

- 2026-09-16：**文件内搜索 v0**（M139，merge `647f519`）：`@codemirror/search` 6.7.2 能力底座 +
  editorial panel 重制（`src/search.ts`，createPanel），⌘F 走 keys.ts global 可重绑；匹配计数 /
  上一个/下一个 / 大小写切换。文案 D68–D72（M141 补录）。
- 2026-09-16：**验收套件注入假绿同族核销**（M140 merge `098918d` + M143 merge `d460535`）：
  keys 动作补回读 + 有限重试（≤3，只在目标字节完全未变时重试，partial landing 直接报错）；
  type 动作对齐同一口径（删除「次数校验能抓住前缀型 partial landing」的错误辩护注释）；
  08b 落点重做（探测串移文末 + 改走 type 通道 + `ax.focused` 新断言形态，走解析结果而非正则）；
  checkScenario 守卫（ax 断言必须带 has/not/count/focused 之一）。
  口径级验证 8 判定（假 CU 驱动真实代码路径）在 `_type-retry-unit/`。

- 2026-09-16：**验收套件 `file` 断言支持 glob 路径**（M144 落地，finding `20260916-worker-links-improve-file-glob-dated.md` + tower clarify-reply 裁决）：`file.path` 含 `*` 时按 glob 在父目录里取**匹配文件里 mtime 最新的那一份**再断言内容。动因是诊断日志按 UTC 日期命名、而验收环境的 `env/` 目录跨天复用（`envHome()` 不带日期）——写死日期的断言会在之后每天读到上次 run 留下的旧文件而**永久空过**（假绿），换机又直接 FAIL。落点：`scripts/acceptance/lib/execute.mjs` 的 `resolveSpecFile`（约 20 行）+ `scripts/acceptance/README.md` 断言表一句 + `scenarios/12-links.md` 用 `env:logs/*.jsonl` 断言 `link_open` 落盘并顺带断言日志里没有 URL 原文。**反向验证过**：在日志目录植入一个 mtime 更晚、不含 `link_open` 的文件后场景如实 FAIL（证明确实取最新那份、断言不空转），移除后 PASS。已知残余风险（同日重复跑时最新文件里可能有上一次的事件）写在场景正文，该断言与三条负断言联合构成判定。

- 2026-09-16：**外链渲染与打开快捷键**（M144）→ Alex 裁决采纳（原话「链接（[title](link)）渲染成 title↗︎，并增加打开它的快捷键」「wikilink 内部跳转体系不动」）：`[title](url)` 在 md 模式渲染为 `title` + 尾部 `↗︎`（U+2197 + U+FE0E），括号与 `(url)` 走 replace 装饰隐藏、文档逐字节不变（ADR 0003 §3）；光标/选区触及链接时整条显露源码——编辑态与改动前一致（改动前没有链接装饰，编辑 URL 看到的就是原文），同时避免长 URL 被隐藏后中间出现「按键而光标不动」的死区。`⌘⏎` 与 `⌘-Click` 走同一条命令（`wikilink.follow` → `link.follow`）：外链经 Rust 的 `open_external_url` 交给系统默认应用，wikilink 走既有 link_graph 跳转链路（未解析只提示、不建文件），都不在链接上则无操作。非外链形态（相对路径 / 纯锚点 / 白名单外 scheme / 自动链接 / 引用式链接）当时保持原文不装饰——「能开的才看起来能开」。**这一条口径已被 M145 推翻**（相对路径、锚点改为装饰，见下条核销）：M144 当时的非目标表述不再有效，此处保留原文仅为留痕。落点：`src/preview/links.ts` 新增（判定取自 lezer 语法树，不手写词法；`ensureSyntaxTree` 同步推进避免大文档刚打开时 ⌘⏎ 静默无反应）、`src/preview/livePreview.ts` + `theme.ts`（`Link` 节点装饰、`↗︎` widget、`.cm-lp-link` 样式）、`src/main.ts`（`link.follow` 命令与鼠标路径；⌘-Click 不再以 `currentPath` 提前返回——外链不需要 vault 上下文）、`src/keys.ts`（命令更名）、`src/ipc.ts` + `src-tauri/src/commands.rs`（`open_external_url`：scheme 白名单 **http/https/mailto** + 目标可信性校验，拒绝 → `open_url_rejected`，系统调用失败 → `open_url_failed`）、`src-tauri/src/lib.rs`（注册 `tauri-plugin-opener`，并以 `open_js_links_on_click(false)` 关掉插件注入的「点击 `<a target=_blank>` 直接开浏览器」脚本——那是绕开校验的第二条打开路径）、`src-tauri/src/logging.rs`（`link_open` 事件，字段 `scheme`/`outcome`，**不记 URL 原文**——URL 是文档内容，隐私边界优先于排查便利）。**权限最小化**：capabilities 不新增任何 `opener:*`，webview 对插件 IPC 保持默认拒绝，唯一入口是本仓 command（与 rfd 不引 tauri-plugin-dialog 同一取舍，见 `src-tauri/Cargo.toml` 注释）。提案 `add-external-link-open`。证据：视觉场景 `tests/visual/scenes/render-link.spec.ts` + 基线 `render-link-chromium-darwin.png`（渲染态 / 源码显露 / 文档逐字节不变 / 桩记录 `open_external_url` 的调用目标，零浏览器启动）；真机场景 `scripts/acceptance/scenarios/12-links.md` + fixture `links.md` / `links-wiki.md` / `links-missing.md`。文案 D77–D79。

- 2026-09-16：**表格合同收窄——短行尾部补空列对齐 GFM**（M137 finding `20260916-worker-table-survey-idea-gfm.md`，M142 落地）→ Alex 裁决采纳（原话「好，采纳。」）：数据行 cell 数少于表头时**尾部补空 cell 正常渲染**（GFM spec §4.10，GitHub/Obsidian 同款）；**多列仍整块回退**（GFM 对多列是 excess ignored，静默丢列与「不猜测修复」冲突）。落点：`src/preview/table.ts` 补零宽空 slot（`padShortRow`，一个槽位都没恢复出来的行不补——那是映射失败，必须降级）；`src/preview/livePreview.ts` 零宽空 cell 的空槽装饰改走 point widget（CM6 对零宽 replace 装饰抛 `RangeError: Invalid range for replacement decoration`，两侧默认非 inclusive）。降级文案措辞未变（收窄后只由多列/槽位不可映射触发，D73–D75 仍然准确）。合同 `docs/specs/table-reading.md` §2/§9 收窄；OpenSpec 提案 `narrow-table-short-row-gfm-padding`（含 `complete-markdown-reading` / `foundation-table-reading` 两份未归档 delta 的同主题口径对账）。证据：视觉场景 `tests/visual/scenes/table-foundation-v2.spec.ts`（短行 fixture 翻转为渲染断言 + outline.md 同款 6 列表头/5 cell 行专门断言 + 多列降级断言）；真机场景 `render-table-degrade` 改多列形态并补短行表渲染断言。

- 2026-09-16：**表格降级文案不暴露原因**（M137 finding `20260916-worker-table-survey-improve-reason.md`）→ M138 落地：降级文案带上出错**文档行号**与应为列数（`第 N 行单元格数与表头不符（应为 M 列）`），oversize 走体积/上限文案，无法识别结构走兜底文案；文案单一来源 `src/preview/table.ts` 的 `degradationNotice`，上屏（`::after` 经 data 属性）与 aria-label 同一份。同步断言在视觉场景 `table-foundation-v2` 与真机场景 `render-table-degrade`。
- 2026-09-16：**视觉门禁容差假绿** → Alex 裁决收紧 `maxDiffPixelRatio` 0.005→0.001 + 删 UI 后核对相关基线时间戳（卫生步骤入 tests/visual/README.md 与 AGENTS.md）。
- 2026-09-16：**lists 100k 性能预算** → Alex 裁决放宽 p95 40→60ms（间歇超属环境噪声；随 dogfood 性能专项复核是否回调）。
- 2026-09-16：**run.sh 端口占用检查只查 4173** → 已修，检查 `${LUMIR_VISUAL_PORT:-4173}` 实际端口。

- 2026-09-17：**链接装饰全形态覆盖**（M145）→ Alex dogfood 反馈（第 4 条，原话「我启动后看到的链接并没有渲染成 title↗︎」）驱动的口径补齐。M144 只装饰 http/https/mailto，把「相对路径不装饰」写进 Non-goals 时**未向 Alex 显式确认**（tower 已认领为裁决疏漏）。M145 补齐后的形态矩阵：外链（含 `mailto`）→ `title↗︎` 交系统默认应用；相对路径 md / 无扩展名 → `title→` 应用内跳转（Alex 裁决原话「内部跳转的带→，也就是 title→」）；相对路径非 md 与目录 → `title↗︎` 交系统默认应用；纯锚点 → `title→` 但激活只 toast；白名单外 scheme → 原文不装饰。装饰与激活解耦：分类只看目标原文（`src/preview/links.ts` 的 `classifyLinkTarget`），文件存不存在是激活时才问的问题，因此「目标不存在」的链接照常装饰、代价由 toast 承担。落点：`src/preview/links.ts`（`classifyLinkTarget` 五类 + `standardLinkAt`）、`src/preview/livePreview.ts`（`LinkMarkWidget` 按类别出 `↗︎`/`→`）、`src/main.ts`（`linkTargetAt` 五态 + `followLink` 分流 + 相对路径未解析只 toast 不创建）、`src/ipc.ts`（`linkResolveNote` / `linkOpenPath`）、`src-tauri/src/link_graph.rs`（`relative_vault_path` + `resolve_relative`：相对当前文件目录的路径语义，`./` `..` 归一、`/` 开头按 vault 根相对、`#fragment` 忽略、**不退化到 wikilink 的名称匹配**）、`src-tauri/src/commands.rs`（`link_resolve_note` + `link_open_path`，后者经 `fs_io::resolve_in_vault` 做 vault 内约束与存在性校验）、`src-tauri/src/logging.rs`（`link_open` 增 `category` 字段：external / internal-md / asset / anchor / blocked-scheme）。**权限面未变**：capabilities 仍零 `opener:*`，新增的资产打开走同一条 Rust 侧最小权限路径（`app.opener().open_path`，不经 webview IPC）。规格：修订 `openspec/changes/add-external-link-open` 的两份 spec delta（就地扩为形态矩阵，避免归档后 living spec 出现两条自相矛盾 requirement）；文案 D80–D83。证据：视觉场景 `tests/visual/scenes/render-link.spec.ts`（12 条用例，含分类纯函数与四类激活分流；桩记录 `open_external_url` / `link_open_path` / `link_resolve_note`）+ 更新后的整页基线；真机场景 `scripts/acceptance/scenarios/12-links.md`（25 步，含相对 md 跳转成功 / 未解析 toast、锚点 toast、非 md 打开、不可用不装饰；`link_open` 各类别断言带 `^…$` 行锚）。**两处待 Alex 复核的裁决已录入「待 Alex 裁决」第 9 条**（非 md 带 ↗︎、锚点带 → 仅 toast），另有 `note.md#sec` 锚点忽略口径同批披露。
- 2026-09-17：**归档积压清理——7 个已合并未归档的 change 批量归档**（M150，Alex 对整体 review 的裁决「好，采纳。你动手吧」，含归档节点 2 的批量授权）。归档清单（`openspec/changes/archive/2026-09-17-*`）：`add-wikilink`（积压 12 天）、`add-diagnostics-logging`、`add-external-link-open`、`fix-json-key-highlight`、`add-toc-outline`、`add-multi-tabs`、`narrow-table-short-row-gfm-padding`；对账结果——7 个的 spec 增量与实现逐条一致，其中 `add-wikilink` 的 `specs/backlinks-panel/` 增量**不随归档**（该 capability 已按 ADR 0004 §2 挤压预案推迟且实现已移除，照旧归档会凭空生成一份描述「面板存在」的 living spec），其推迟记录移入 proposal 的「归档对账」节；未勾任务就地标注放弃原因（`add-wikilink` 5.3、`add-diagnostics-logging` 4.2）。**教训（本批次的核心发现）**：7 个 change 里**只有 1 个**（`add-diagnostics-logging`）在 `docs/backlog.md` 里被记为待归档，其余 6 个合并后无人跟踪——living spec 因此长期落后，`editor-live-preview` 甚至与实现直接矛盾（自称「M1 只读口径」而 md 模式早已可编辑）。**防线**：`docs/process/openspec-workflow.md` 新增「批次收尾 checklist（归档跟踪）」三条（每个 merge 的 change 即记待归档并跟踪到归档 / 归档前逐条对账 / 归档后手写新建 capability 的 Purpose）；同文件新增「撤回（withdrawn）」口径（僵尸提案的处置三步）。归档后 `openspec list` 活跃列表为空，`validate --all --strict` 14 项全绿（含 5 处新建 living spec 的手写 Purpose）。
- 2026-09-17：**僵尸提案撤回 4 个**（M150）：`foundation-vault-recovery`（0/9）/ `foundation-markdown-quality`（0/14）/ `foundation-table-reading`（0/17）/ `complete-markdown-reading`（2/17）。处置：整体移到 `openspec/changes/archive/2026-09-17-withdrawn-<id>/`，各自 proposal 头部写入「撤回记录」（理由 / 承接者 / 遗留面）。逐个的对账结论：① `foundation-vault-recovery` 的核心机制**在仓内不存在**（全仓 `grep operation_id` 零命中，`intent` / `ledger` 同样零命中），其要解决的问题已由 `archive/2026-09-12-save-hardening`（崩溃备份 + 启动恢复）与 `archive/2026-09-12-save-and-watch-recovery`（冲突 / 外部修改处置）承接，`docs/specs/vault-recovery.md` 状态头改为「已撤回（留档作重启输入）」；② `foundation-markdown-quality` 是「只立合同」的提案，合同本体 `docs/specs/foundation-markdown.md` 仍在被实现注释引用（`src/preview/table.ts`、`callout.ts`、`math.ts`、`mermaid.ts`），状态头改为「生效中的质量合同」；③ `foundation-table-reading` 同理，合同本体 `docs/specs/table-reading.md` 已被 M142 按 Alex 裁决收窄，状态头同步；④ `complete-markdown-reading` 的四项 requirement 均已实现（列表布局 `src/preview/lists.ts`、表格 `src/preview/table.ts`），但其出口验证从未按其形态执行、节点 2 未过，故撤回而非归档。**遗留缺口（需另立 change，本批不做）**：列表对齐与基础表格阅读的 requirement 文本至今未进 living spec——只有实现、门禁与 `docs/specs/table-reading.md` 合同，没有 requirement 级规格。另：`scripts/visual/table-probe72/matrix.mjs` 的产出路径指向 `openspec/changes/complete-markdown-reading/`（随本次移动失效），已投 finding 待处置。
- 2026-09-17：**补记两处规格缺口（M150）**：① **文件内搜索 v0**（M139 实现先于规格落地，merge `647f519`）→ 补 retro change `add-in-file-search` 并归档，新建 living spec `openspec/specs/in-file-search/spec.md`（入口与键位归属 / 能力集与匹配口径 / 关闭与焦点归还三条 requirement，含「不做替换」「高亮只看视口」等如实边界）；② **`editor-live-preview` 规格对齐 + M138 渲染三件套补记** → retro change `align-editor-live-preview-spec`：删掉 living spec 里与实现矛盾的「M1 只读口径，不含编辑态行为」与「MUST NOT 实现光标所在行 reveal 源码」（现状是 md 模式可编辑、选区触及即显露源码），补入 `Markdown 渲染保真（分隔线 / 围栏代码着色 / 引用内列表）` requirement，并重写 Purpose（`## Purpose` 的增量只在 capability 创建时被读取）。两份 retro change 的 tasks 全部按「已存在实现与证据」核对勾选。
- 2026-09-17：**`tests/visual/README.md` 卫生节 missing**（M146 finding `20260917-worker-reviewmd-bug-ui-readme.md`）→ 已由 M147 `c81b3ed` 闭合：`tests/visual/README.md` 补入「删除 / 移动 UI 元素后的核对（卫生步骤，强制）」一节（现 67–85 行），`playwright.config.ts:11` 与 AGENTS.md 的指针恢复可达。**未做**：finding 里顺带建议的「`scripts/visual/run.sh --update` 输出回显该提醒」未落地（建议项，非必需）。
- 2026-09-17：**`src/preview/livePreview.ts:427` 注释引用已删除的 `openDocument`**（M149 r1 nit `20260917-worker-tabs-improve-m149-nit-livepreview-ts-opendocument-scope.md`）→ M150 改「装载（`editor.reloadSession`）」，与 M149 同批另两处（`mermaid.spec.ts:296` / `toc-outline.spec.ts:84`）同形。同时顺手改掉同文件第 4 行的同族陈述——文件头「只读口径：不做光标行 reveal 源码的编辑态逻辑」同样与实现矛盾（该文件里有完整的选区显露实现），一并改为现行编辑态口径。
- 2026-09-17：**`docs/process/real-machine-acceptance.md` 证据落点指针悬空**（M150 顺手修）：裁决点 1 的备选「摘要表入 `docs/design-parity-contract/evidence/`」指向的契约已随 ADR 0006 失效（`docs/design-parity-contract/README.md` 自述「状态：失效（2026-09-12）」），改为「证据统一落 `test-results/acceptance/`（已 gitignore），摘要表入 `docs/backlog.md` 的待真机验收节」。
- 2026-09-17：**两条清扫类 finding 由 M152 闭合核销**（worker-langunify，commit `6e8e70a`，原「待修
  findings／编辑器·键位」的两条）：① **`TableModel.reason` 的 `"incomplete"` 死值已删**
  （`src/preview/table.ts:37` 的类型联合收敛为 `"oversize" | "non-rectangular"`，全仓零生产零消费）；
  ② **语言注册表两处漂移已收口**（`src/preview/code.ts` 的 `LANGUAGES` 成为唯一一份着色语言表并导出为
  `Record<CodeLanguage, StreamLanguage<unknown>>`，`CodeLanguage` 由 `src/preview/attachments.ts` 的扩展名
  注册表推导、经 `import type` 编译期擦除；`src/editor.ts` 删掉整块 legacy-modes import、7 个具名 parser
  常量与自建表，只留查表；token 的 tag 分组同源落在 `code.ts` 的 `TOKEN_GROUPS`，两侧只做渲染映射——类名与
  内联色值）。**核销口径提示**：M152 分支 `feat/language-registry-and-frontmatter-unify`（tip `59d05a2`）
  在本条落盘时**尚未并入 master**（r2 复审中），所以这两条核销记的是「决策已定」，在 M152 合并后才对 master
  生效。**附带影响（跨文件，本 mission 的 scope 只含 `docs/backlog.md`）**：本次改动净增 171 行
  （264 → 435），`REVIEW.md` 里 9 处以 `docs/backlog.md:NNN` 为证据指针的条目（第 3/4/5/6/7/8/9/11/12 条）
  行号全部随之漂移；**逐条实测发现其中 7 处在本次改动之前就已指向别的条目**（裸行号这种写法早就失效了，本批
  只是让它更失效）——明细与建议见 finding
  `20260917-worker-backlog-improve-review-md-docs-backlog-md-9-7-m155.md`。
  建议 `REVIEW.md` 的证据指针改用可 grep 的条目名 / 节名而不是行号；本次核销涉及的两条已移到本节（内容见上）。
- 2026-09-17：**link_graph.rs `MAX_FRONTMATTER_LINES` 注释失联 finding 关闭（前提失效）**
  （M152 首发 finding `20260917-worker-langunify-improve-link-graph-rs-max-frontmatter-lines-ts-m152.md`；
  severity 标为 medium）：该条写于 512 裁决翻转**之前**，其前提「M152 把 TS 侧收敛为 200、Rust 应改注释指向
  `src/preview/frontmatter.ts`」已被推翻——M152 最终把 TS 侧定为 512。它唯一仍成立的点（`link_graph.rs:105`
  的注释指向的文件名 `src/preview/wikilinks.ts` 不再持有该常量，已成错误自述）已并入现行条目「待 Alex 裁决」
  第 11 条，随该条一并处置。按 finding 正文自己的请求（「请以本条为准，前一条可关」）核销，不再单独立项。
- 2026-09-18：**归档待办三件核销**（M170 归档节点 2；Alex 三件裁决同日）——三个已合并未归档的 change 在本次一次性归档，各自的跟踪一条一条核清；归档后 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` = **17 passed / 0 failed**，活跃 change 只剩 3 个（`codeblock-toml-yaml-highlight` / `image-svg-and-fallback` / `line-wrap-options`）：
  ① **`startup-restore-off-main-thread`**（M156 提案 → M159 实现，merge `ad93a03`）→ `openspec/changes/archive/2026-09-18-startup-restore-off-main-thread/`；「待 Alex 裁决」第 12 条的「归档待 Alex 节点 2」改为已归档。对账：tasks 25/27（3.6 自标「可选证据，非门禁」→ 标注不执行；5.5「冷启动读数前后对比」→ 本地未跑、改取 CI 旁证，两条**保留未勾**并就地标注理由），spec 增量（`vault-workspace` 的 MODIFIED「last_vault 记忆与启动恢复」+ ADDED「启动恢复的时序与可见性」）与实现逐条一致；Alex 节点 2 裁决 design §4.5 的语义边缘「**不收紧**」。
  ② **`multi-vault-workspaces`**（M162 + M163 + M164，merge `eafd258` / `fb2dc26` / `2f16f86`）→ `openspec/changes/archive/2026-09-18-multi-vault-workspaces/`；「待 Alex 裁决」第 10 条状态更新段的「归档评审待 Alex」改为已归档。对账：tasks 39/39、7 条 ADD 落 `vault-workspace`、1 条 MODIFIED 落 `multi-tabs`（与 living 逐字只差 proposal 声明的两处，归档未误删 living 其它内容）；Alex 节点 2 裁决守卫判据的宽窄措辞差「**接受差异**」（living `multi-tabs/spec.md:127` 原文不动，理由是判据先于该 change 存在、行为不变）。
  ③ **`toc-popover-emacs-keys-and-max-height`**（M160，merge `d4ca60a`）→ `openspec/changes/archive/2026-09-18-toc-popover-emacs-keys-and-max-height/`；核销「待 Alex 裁决」第 20 条。对账：tasks 34/34（3.1 / 3.2 的产物由 tower 的 integration fix `a779cbb` 落盘；6.2 改由「零 Rust diff + CI `rust.yml` 在 `2f16f86` success」继承；6.4 由 M164 全量 26/26 与 `2026-09-18/13-toc` PASS 覆盖），2 条 MODIFIED 落 `toc-outline`、1 条 MODIFIED 落 `keymap-commands`。
  三份 living spec 的 Purpose 补了归属记录（`vault-workspace` / `toc-outline` / `keymap-commands`）。**顺带修正的失效指针**：`docs/backlog.md` 第 10 条指向的 `openspec/changes/multi-vault-workspaces/specs/...` 与第 12 条指向的 `openspec/changes/startup-restore-off-main-thread/design.md` 已改为 living spec / archive 路径；另有两处同类失效指针在 `scripts/acceptance/scenarios/13-toc.md:224` 与 `16-startup-restore.md:34`（本 mission scope 外），已投 finding（**M175 已闭合**：两处改指 `openspec/changes/archive/2026-09-18-*` 实际路径）。
- 2026-09-18：**CI visual/perf 长期红治理批核销**（「待 Alex 裁决」第 17 条；M172 诊断 → Alex 三项裁决
  → M173/M174/M175 落地）。M172（survey）定位：visual = runner 侧渲染环境不等价（基线 40/40 sha256
  相同、差异只在字形栅格层、确定性复现）；perf = resident-memory 9/9 确定性超 200MB 阈 + keypress 基线
  单样本冻结 + `update-baseline` 的 `if: success()` 结构性死锁。M173（merge `475f069`）：`visual.yml`
  收窄为结构/计算属性断言（`LUMIR_VISUAL_STRUCTURAL=1`，22 处像素断言经 `expectScreenshot` 包装跳过，
  空基线反向验证证明断言真执行/真跳过）、`@playwright/test` 钉 1.62.1、浏览器构建自证步骤（本地/CI
  同一脚本）、`runs-on` 钉 `macos-26`、结构模式 `--update` 防呆；其任务 1 顺带推翻「基线由更新浏览器
  构建渲染」的候选机制。M174（merge `d967ce8`）：resident-memory 阈 200→250MB（ADR 0002 §6 分叉双处
  标注 + follow-up finding 待文本修订）、`update-baseline`/`cache-save` 改 `always()` 且逐指标裁决落盘
  `perf-results/gate-status.json`（fail 不进基线、缺判据 fail-closed、薄基线 `minRuns=5` 降级不拒合）、
  keypress 容忍线 60% + `spreadHeadroom` 浮动护栏；r1 评审抓出一处「浮动项惰性」措辞失真（真实上界
  57.9%×1.2=69.4%），r2 修三处文字并补两条真差分探针后 clean。M175（merge `7bea675`）：backlog 第 17
  条立项登记与验收场景失效指针修复。合并态 `gate.sh quick` 10/10 PASS。**留白**：runner 字体探针与
  keypress 帧量化观察见「门禁测量与 CI 环境」节；新规程的首次 CI 实证以 `475f069` 上的 visual / perf
  run 为准。
- 2026-09-18：**门禁清单三处过期**（M153 finding `20260917-worker-testinfra-improve-agents-md-gate-sh-tests-visual-readme-md-isolation-readme-vi.md`，
  原「待修 findings／文档指针与门禁清单」首条）→ 治理批收尾由 tower 直改闭合：① `AGENTS.md` 删掉
  gate.sh 三行用法副本、改为指向脚本头注释的指针（canonical 居所原则）；② `tests/visual/README.md`
  目录结构补 `isolation.test.mjs`（2 用例 / 7 条：run 目录隔离、证据脱敏与 fail-closed、symlink 拒绝）；
  ③ `README.md` 门禁表 `visual.yml` 行补「另跑套件隔离断言」——目标行已被 M173 改写为结构层口径，
  在其上补一句而非恢复原措辞。
- 批次三：键位分发三轨并行 + 扩展名注册表漂移（M130/M131/M132）；save-ipc.ts 折回 ipc.ts（M132）；Ctrl-K/D/T 原生路径风险（M132）。
- 批次二：DeepSeek Flash 试用结论——可做 build，review 环节（k3-256k）不能省。
