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
   **已失效（2026-09-28，M287 归档批）**：自动保存整条移除（change `remove-autosave`，M278，2026-09-27 合并）
   后「自动保存暂停」这个状态不再存在，本条随之作废。冲突处置后若仍有「用户不知道文档仍是 dirty」的提示
   诉求，那要针对**显式保存**路径重开一条新条目（本条不再承接）。
4. **宽表横向溢出裁切是否预期**：实测溢出 1549pt vs 栏宽 766pt，AX 层完整。待 Alex 对照设计规格确认。遗留自桌面复验（M116 期）。
5. **Emacs 档 3 与全产品键位**：isearch / mark / region / ⌃X 前缀，及左栏 tree/shell 零键盘支持——待 UX 重做会话与 dogfood 反馈后立项。批次三遗留。
6. ~~**openspec 归档 `add-diagnostics-logging`**（M134 已合并，2026-09-16）：实现与文档已入库，归档评审待 Alex 点头。~~ **2026-09-17 M150 已按批次授权执行**（Alex 对整体 review 的裁决「好，采纳。你动手吧」含归档节点 2 批量授权）：归档为 `openspec/changes/archive/2026-09-17-add-diagnostics-logging`，living spec 落 `openspec/specs/diagnostics/spec.md`；其未勾任务 4.2（`gate.sh all` 全绿）就地标注改由 CI perf.yml 承担（本地 `all` 因既有内存合同超标不可能全绿，见本条下方第 7 项），核销记录见「已核销」。
7. **内存合同存量超标**：2026-09-06 evidence 218–222MB 已超 <200MB 合同（2026-09-16 未复测）——放宽合同还是专项治理，随 dogfood 性能专项拍板。
8. **共享 `CARGO_TARGET_DIR` 与 dev-only 脚本化驱动入口**（工具链节 2/3 的长期候选）：是否立项待裁决。
9. **链接形态矩阵的两处 tower 裁决**（M145，2026-09-17，Alex 未逐条点头）：① 相对路径**非 md**（`[x](./doc.pdf)`）带 `↗︎`（语义「会离开本应用」）而不是 `→`；② **纯锚点** `[x](#sec)` 带 `→` 但激活只给「暂不支持锚点跳转」toast（不做文档内滚动）。附一处同批未单独确认的口径：`[x](note.md#sec)` 按「应用内跳转 + 锚点部分忽略」处理。三处若要翻转，落点是 `src/preview/links.ts` 的 `classifyLinkTarget`（标记）与 `src/main.ts` 的 `followLink`（激活）。
10. **多标签会话恢复**（M149，2026-09-17）：重启后按「路径列表 + 激活项」重开上次的标签。v1 明确不做（当时口径「留 backlog」），做成什么形状与何时做待裁决。建议形状：存 vault 维度（registry 旁 `last_session`）、只存有序路径 + 激活下标（可选滚动 offset），**不存**未保存内容与撤销史；打开必须走 `openFile` 既有链路；文件已删/不在 vault 内时跳过并记诊断；启动日志记一条 `session_restored{count}`（`log_event` 通道已有）。时机建议：等 dogfood 反馈「常态开几个标签」后再定，避免为 2 个标签的场景过度设计。finding `20260917-worker-tabs-idea-m149-backlog.md`。
    **状态更新（M164 收口，2026-09-17；change `multi-vault-workspaces` 任务 7.1 口径）**：本项已由该 change **承接并落地**——后端 M162（`eafd258`）与前端 M163（`fb2dc26`）均已合并；**归档评审已过（2026-09-18，节点 2），已归档**为 `openspec/changes/archive/2026-09-18-multi-vault-workspaces/`（living spec 落 `openspec/specs/vault-workspace/spec.md` 的 7 条 ADD 与 `openspec/specs/multi-tabs/spec.md` 的 1 条 MODIFIED）。落地的形状与上面的建议有**三处有意差异**：① 会话**不与注册项同文件**，单独落在 `<config>/lumir/vault-sessions/<id>.json`（design §2：注册项是身份，其读取路径对解析失败一律跳过，把易变的界面状态混进身份文件会把「会话写坏」升级成「vault 从列表与 remap 候选中消失」）；② 激活项存**相对路径**而不是下标（下标在列表变化后指向别处；不可用时按「退化到第一个可打开的标签」处理）；③ 恢复走 `openFile` 的 **`pinned` 意图**逐标签打开（预览意图会让第二个起顶掉前一个，只剩最后一个）。落定口径见 `openspec/specs/vault-workspace/spec.md` 的「按 vault 持久化标签列表」与「装载后恢复标签列表」；真机证据见本文件「待真机验收」第 18 项。
    **v1 建议里唯一未落地的一条（如实登记，不当缺陷）**：启动日志的 `session_restored{count}` 没有实现——`src-tauri/src/logging.rs` 的事件白名单里没有该事件，`src/vault-switcher.ts` 的恢复路径也不发埋点（实测 `grep -rn session_restored src/ src-tauri/src/` 零命中）。design §9 把它写成「观察点（`log_event` 通道已有）」，那句**与实现不符**；它是建议里的观测手段、不是 spec 的 SHALL，故不改已评审的 design 正文，记在这里。**观测缺口**：目前「上次恢复了几个标签、跳过了几个」只能靠真机截图与场景断言看，跑不套件时看不到。若补，落点是恢复结束时发一条 `log_event`（需同时扩 Rust 白名单）。
    **仍未做的边界**：光标位置、滚动位置与撤销史都不恢复（决策 3 的口径，未变）；**其中「滚动位置」这一格已由** change `remember-reading-position` **承接**（M194，2026-09-24 实现完成：按 vault 存在 `<config>/lumir/reading-positions/<id>.json`，装载时恢复该文档上次离开的位置；光标与撤销史仍不做，本项其余面不重开）。「常态开几个标签」的 dogfood 反馈仍未取得，因此本项**不做**「会话数量上限 / 清理策略」这类后续设计。
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
21. **行内（同一行还有正文）图片引用现在会独占一行**（M182，worker-img-width-fix，2026-09-18，medium，
    **待 Alex 裁决**）：M182 把图片替换区包装盒的宽度定成栏宽（`src/preview/theme.ts` 的 `.cm-lp-image`
    `width: 100%`，机制说明见 `docs/specs/image-reading.md` §3），换来「显示宽度不因加载时序 / 缓存命中 /
    打开次序而变」这条不变量（条款同文件 §2）。代价是行内图片引用会把所在行切开：引用前的正文 / 图片 /
    引用后的正文各自成行。**实测输入分布**（真实 vault 只读统计）：256 条独占行引用 / 16 条同行含他字符，
    后者多为被链接包裹的 `[![…](…)](…)`（本身仍独占一行）与样本文件里的 JSON 字符串，未见正文混排的
    行内图。**裁决选项**：(a) 维持现状——图片一律块级栏宽（口径简单，与 Obsidian 阅读观感一致；M182 已
    按此实现）；(b) 只在引用独占一行时给包装盒栏宽、行内引用保留旧的 shrink-to-fit（代价：行内引用回到
    时序依赖的旧宽度，不变量只覆盖独占行形态，需要一处行内容判定）。worker 建议 (a)。证据（真机两态
    几何读数 / 反向验证）：`test-results/m182/`、`test-results/acceptance/2026-09-18/23-image-first-open-width/`。

22. **change `code-variable-highlight` 待归档跟踪**（2026-09-24，M198 实现完成；**已核销**：M205 归档节点 2，2026-09-24）：
    流程口径要求每个 change 在实现 PR 合并时即落一条待归档记录并跟踪到归档
    （`docs/process/openspec-workflow.md` 的批次收尾 checklist 第一条）。本 change 的提案四件在 2026-09-24
    节点 1 裁决通过（裁决点 2 原话「采纳推荐」，其余 5 点按推荐落定；逐条落点见 `proposal.md` 的
    「裁决记录」节），实现在 M198 完成：判据落 `src/code-identifiers.ts`（位置类别 / 名字 / 可见域三层，
    8 门 T1 语言）、呈现落 `src/preview/theme.ts` 的 `codeBindingTheme`、解析复用 M197 的
    `src/code-structure.ts`（新增一条只读入口 `structureTree`，解析次数仍为 1）。**归档动作的三处口径**：
    ① 实现期有两处偏离已在 `tasks.md` 就地标注并在 M198 的 review-request 里单列——呈现色值取 `--bg-3`
    而非 `--bg-2`（后者与 code 模式当前行底色重合、底纹会隐形，tower 2026-09-24 裁决采纳），真机验收的
    触发通道改用「⌘F + 查询词 + 回车」生成选区（双击手势在该通道合成不出、AX 不暴露装饰，tower 裁决
    采纳）；② **一张新增元素级视觉基线待 Alex 过目**
    （`tests/visual/baselines/m198-code-variable-highlight.spec.ts-snapshots/binding-highlight-chromium-darwin.png`，
    截图副本与说明见 `test-results/m198/baseline-check.md`）——AGENTS.md 的「基线更新是人肉裁决点」；
    ③ 1MB 级文件的索引构建读数**不达标**：落盘读数是**首次触发 648.4 ms = 解析 205.8 + 索引构建 442.6**
    （本行原写「首次触发 ≈ 0.9s（解析 0.28s + 索引构建 0.64s）」，与 `test-results/m198/perf-var-highlight.json`
    不符，M205 归档时按落盘读数改准；**超标归因是索引构建**——解析 205.8 ms 落在 design §1.6 的
    78–291 ms 估计区间内，索引构建 442.6 ms 远超该处 6–8 ms 的树遍历估计），后续路径按 design §8 备选②。
    **核销（M205 归档节点 2，2026-09-24）**：归档为 `openspec/changes/archive/2026-09-24-code-variable-highlight/`，
    `editor-live-preview` 落 2 条 ADDED，tasks 37/37 全勾；delta 正文两次引用的「代码文件的结构解析
    （语言分层注册表）」requirement 由**同批先归档**的 code-outline 并入（归档顺序硬约束，避免 living spec
    里出现指向不存在 requirement 的引用）；归档件内 18 条相对链接按「补一层 `../` / 改指归档目录名」两类
    逐条改准；design §7 的「未实测的声明位形态」按 M198 实测收口（tasks 9.4 就地标注「实现期未做、M205
    补齐」）、`--bg-2` 三处按实现的 `--bg-3` 改准；证据指针的四处失效文件名（`index-cost.json` /
    `perf-var-highlight-*.json` / `task8-ax-probe.md` / `29-code-variable-highlight/`）一并改准。
    **残留人肉点**：② 的那张新增元素级基线在归档件里仍标「待 Alex 过目」——本批没有可引的过目记录，
    标注按原样保留、未擅改，需要时请在批次验收里一并确认。

23. **change `list-filter` 待归档跟踪**（2026-09-24，M199 实现；**已核销**：M205 归档节点 2，2026-09-24）：流程口径要求
    每个 change 在实现 PR 合并时即落一条待归档记录并跟踪到归档
    （`docs/process/openspec-workflow.md` 的批次收尾 checklist 第一条）。本 change 的四件制品在 2026-09-24
    节点 1 裁决通过（Alex 原话「五个点都采纳推荐」，逐条落点见 `proposal.md` 的「裁决记录」节，五个条件是
    第 10 组全部未触发），实现在 M199：匹配与查询状态落 `src/list-filter.ts`（**唯一**一份实现，两处浮层
    共用），接入落 `src/toc.ts`（输入行 / 焦点迁移五挂点 / 结果集下标映射 / 无命中态）与
    `src/vault-switcher.ts`（输入行 + 同款迁移 + `rowEntries` 保持完整列表 + 输入框排除在浮层级
    `mousedown` 之外），样式落 `src/style.css`（取既有 token）。**归档动作须一并看的三处**：
    ① 实现期两处编号漂移已就地校正——真机场景编号取 **32**（提案里写的 29 已被 `29-typography-and-zoom`
    占用；30/31 为 code-outline / code-variable-highlight），文案编号 **D117–D119**（code-outline 遗留的
    两条空态提示先占 D115/D116，随本 mission 一并补登），delta 里的 `D115–D117` 指针已同步校正；
    ② **四张浮层元素级基线待 Alex 过目后重拍**（`toc-popover` / `toc-popover-long` / `vault-popover`，
    外加实现期发现的第四张 `code-outline-popover`——它拍的是同一个 `.lumir-toc`），截图与读数见
    `test-results/m199/baseline-check.md` 与 `test-results/m199/baseline-review/`——AGENTS.md 的
    「基线更新是人肉裁决点」；③ delta 的「失效行参与筛选且 Enter 仍走重定位」scenario 里「用键盘选中它」
    一句与**筛选前**的既有口径不一致（失效行不在键盘游标空间里，`mv-vault-switcher.spec.ts` 钉着
    「↓ 只在可用行之间走」），实现按「与筛选前逐条一致」落地（失效行参与筛选、点击走重定位、键盘仍不
    可达）。
    **核销（M205 归档节点 2，2026-09-24）**：归档为 `openspec/changes/archive/2026-09-24-list-filter/`，
    `toc-outline` 落 2 条 ADDED + 1 条 MODIFIED、`vault-workspace` 落 1 条 ADDED，tasks 48/48 全勾。
    三处的处置：① 场景编号已按实测 32 改准（`proposal.md` 两处同步）；② 四张基线**已结清**——`03ca450`
    按 Alex 过目口径「合并指示即通过」重拍并随 merge `b517052` 入库，随后 `gate-visual-final.log` 为
    12/12 PASS（`test-results/m199/baseline-update.log` 那次 `--update` 是失败的尝试）；③ 按 Alex 裁决
    改写该 scenario 为「失效行 SHALL 出现在结果集里但 MUST NOT 进入键盘游标空间（与筛选前一致）」，删去
    Enter 一句；同一 requirement 的**正文**里那句「`Enter` 与点击的动作 SHALL 保持现状」按同一裁决只保留
    「**点击**」半（r1 评审指出首轮只改了 scenario、正文漏改，已由 r1 修复提交补齐；delta 与 living 两处
    同改，`tests/unit/vault-switcher.test.ts` 覆盖点击那半）。归档件内 3 条相对链接补一层 `../`；`tasks.md`
    1.1 的判据由「`rg toLowerCase` 只在模块内命中」（实测 8 处、字面为假）改准为「两处消费者 import
    同一份模块」。本 change 的四处覆盖缺口另立条目（见「待修 findings」节）。

24. **change `code-outline` 待归档跟踪**（2026-09-24，M197 实现完成；**已核销**：M205 归档节点 2，2026-09-24；本条由 M199
    按 M197 的 finding 补登，findings 原文：`.tower/comms/findings/20260924-worker-code-outline-impl-improve-docs-backlog-md-lezer-yaml-code-outline.md`）：
    本 change 的实现已在 `feat/code-outline-implementation` 上完成（指示段 / 浮层 / 跳转落点 / 两条新文案
    全部落地，有真机与视觉证据），但 backlog 里没有待归档记录——`docs/backlog.md` 不在 M197 的改动范围，
    M197 按协议投出 finding 由 tower 路由，本 mission（M199）顺带补登。**归档时须一并处理的两处**：
    ① 两条空态文案（`src/toc.ts` 的 `NO_SYMBOLS_TEXT` / `NO_STRUCTURE_TEXT`）在 M197 实现期未进 deck，
    已由 M199 补登为 **D115/D116**（逐字取自 `openspec/changes/code-outline/tasks.md` 的 5.1 待补表）；
    ② 证据目录：`test-results/m197/`（本机，git 外）与 `test-results/acceptance/2026-09-24/30-code-outline/`。
    **核销（M205 归档节点 2，2026-09-24）**：归档为 `openspec/changes/archive/2026-09-24-code-outline/`，
    `editor-live-preview` 与 `toc-outline` 各落 1 条 ADDED，tasks 36/36 全勾。**补记一处本条第①段原未
    记入的实质矛盾**：delta 的解析时机条款原写「换文件、外部重载、切换标签 SHALL 使缓存失效」、scenario
    原写「切回时缓存按『换文件即失效』重建」，而实现按「语言 + 文档内容」缓存（切回同一份内容命中旧键、
    不重建）——tasks 9.3 自陈过但 delta 未改。**Alex 节点 2 裁决取前者**：措辞改为「缓存身份 = 文档内容」，
    实现侧零改动；M205 已在归档提交里改准 delta 的两处（requirement ③ + scenario）与同批 design 的对应
    措辞——`code-variable-highlight/design.md` §1.6 / §4.3 在归档提交里改准，**`code-outline/design.md` §1.6
    首轮漏改**（自报已改、实际 diff 为零），由 r1 修复提交按同一口径补齐（r1 评审 P2-1，2026-09-24），并入
    living `editor-live-preview` 后与实现一致。归档件内 19 条相对链接分两类改准（10 条补一层
    `../`、9 条改指归档目录名含自指一条）；5 处文本/指针漂移 + 上述缓存矛盾共 6 处一并收口（`40 张 *-expected.png` → 实际命名与
    32 张、`(focused)` 形态按 M199 改写、`visual-toast-d84.log` → `-reused.log`、deck 编号待分配 → D115/D116、
    基线「待 Alex 过目」由 backlog #23 承接）。`src/` 侧两处失效注释指针与其余仓内旧路径指针不在本 mission
    scope，已登记进「文档指针与门禁清单」节。

25. **change `typography-and-zoom` 待归档跟踪**（**补登 + 核销同日**，2026-09-24，M205）：流程口径要求每个
    change 在实现 PR 合并时即落一条待归档记录（`docs/process/openspec-workflow.md` 的批次收尾 checklist
    第一条）。本 change（M195 实现 merge `c988c80`）**合并时没有落这条记录**——全仓 grep `typography` 在
    `docs/backlog.md` 只命中 list-filter 条目里的一处顺带提及，`M195` / `M193` 零命中，正是 M150 记过的
    失效模式。M205 在归档前补登本条、随归档核销：归档为
    `openspec/changes/archive/2026-09-24-typography-and-zoom/`，**新建 living capability `typography`**
    （ADDED ×4，`## Purpose` 已按惯例手写替换掉 `archive` 生成的 TBD 占位）+ `keymap-commands` 落 1 条
    ADDED，tasks 43/43 全勾。归档动作的四处收口：① `tasks.md` 三条 `../../../REVIEW.md` 补一层；② 登记性
    缺陷就地改准——8.1① 的 `font_size: 20` → 实测场景用的 **32**（含 `⌘0` 回配置值 32）、`36 个场景全通过`
    → **39**（M195 时点 36、归档复跑 39）、`proposal.md` 的 Impact 条目名「编辑器内字体引用的单一来源」→
    delta 实际交付的 **「字号步进的运行期口径」**、delta req4 的「30 张既有基线」→ 改成带时点的写法并补
    内容级判据（`30` 在 M195 时点准确，今日 non-typography 基线已 32 张——数字写死在 living spec 里会一直
    过期）；③ 覆盖缺口如实留在归档件里（「全会话一致」零断言、config 的 12/32 与 code 模式同步未在渲染层
    验、`⌘⇧=` 真机形态未验）；④ 跨 change 风险已单列（见第 27 条）。

26. **change `remember-reading-position` 待归档跟踪**（**补登 + 核销同日**，2026-09-24，M205）：同上，本
    change（M194 实现）合并时没有落待归档记录（backlog 里只有第 10 条边界段的一句能力承接）。归档为
    `openspec/changes/archive/2026-09-24-remember-reading-position/`，`multi-tabs` 落 1 条 ADDED、
    `vault-workspace` 落 1 条 ADDED + 2 条 MODIFIED，tasks 38/38 全勾；两份 living spec 的 `## Purpose`
    按 M170 惯例补归属记录。四处证据口径按磁盘实况改准：1.1 的 `reading-position-before/readings.json`
    与 1.2 的 `red-before-implementation.log` **未留档**（以反向验证现场代替，已如实标注）、1.4 的读数实际
    落在 `test-results/m194/design7-probe/`、8.1 的 fixture 实际复用既有 `toc-long.md`（**无新增 fixture
    文件**）、单测条数 15 → **17**；4.2 / 4.3 的反向验证**红侧未单独留档**已就地如实标注（绿侧断言在位）；
    `tasks.md` 三条 `../../../REVIEW.md` 补一层。

27. ~~**前置提醒：`restyle-ui-tokens-v1` 实现时必须补一条 `typography` 的 MODIFIED delta**~~
    （2026-09-24，M205 登记；**2026-09-25 由 M213 核销**）：`restyle-ui-tokens-v1` 的 D1 把编辑器内容字号
    默认值 **16 → 15px**（`tasks.md` 的 3.4，Rust `DEFAULT_FONT_SIZE` 同步），而它的 delta 集当时只有
    `editor-live-preview` / `file-tree` / `frontmatter-properties` / `multi-tabs` / `ui-design-system`，
    **没有 `typography`**——不补就会复现 M150 记过的形态：**living spec 与实现直接矛盾**（spec 说 16px、
    实现出 15px），且 `validate` 不查这类矛盾。**核销落点**：
    `openspec/changes/restyle-ui-tokens-v1/specs/typography/spec.md`（新增 MODIFIED ×4：token 层与配置来源 /
    字号步进的运行期口径 / 排版变更后的重测量 / 出厂默认口径不变，四处 16px 字面值与「与本 change 之前
    逐项相同」的表述一并改写为 D1 的 15px 锚 + 新 token 名 `--font-sans` / `--lh-reading` /
    `--layout-doc-measure`）；proposal 的 Impact 同步补 `typography —— MODIFIED ×4`。
    **未做的部分（另立条目跟踪，见本文件「待修 findings」的「living spec Purpose 漂移」条）**：
    `openspec/specs/typography/spec.md` 的 `## Purpose` 段仍写「shell（左栏、masthead、浮层…）」与
    「30 张基线零差异」——openspec 的 delta 格式只覆盖 `## Requirements`，Purpose 只能等归档时手写。

28. **change `document-end-marker` 待归档跟踪**（2026-09-24，M205 finding 补登，**待 Alex 节点 2**）：
    M205 归档五件后 `openspec list` 复核发现 `document-end-marker` 已 `✓ Complete` 却仍留活跃列表，且
    实现合并时未落待归档记录——M150 记过的漏跟踪失效模式复现（finding
    `.tower/comms/findings/20260924-worker-archive-five-bug-document-end-marker-complete-change.md`）。
    归档评审须带上 M189 的**机制偏离签字**（没用 design 候选 A/B，落在「真元素挂 .cm-scroller」的第三条路，
    reviewer r1/r2 已判成立）；若要给完读标记加像素基线，先过目
    `test-results/m189/acceptance-27-pass/shots/` 再 `--update`。归档后按其 living 落点补 Purpose 归属
    记录、实测归档件内相对链接层级。
    **核销（M208 归档节点 2，2026-09-25）**：归档为 `openspec/changes/archive/2026-09-25-document-end-marker/`，
    `editor-live-preview` 落 2 条 ADDED（无新建 capability），tasks 37/37 全勾（未触发的条件项 7.2 已就地
    标注「不适用」）。归档期四处收口：① tasks 6.1 把 `test-results/acceptance/2026-09-20/27-document-end-marker/`
    从「同一场景在前一版代码上的首次 PASS」改准为**反向验证 FAIL**（实测 `status.txt` = FAIL、14 断言 /
    2 失败，与 6.4 的记载同一场地）；② 验收数字三处按 `test-results/acceptance/2026-09-21/results.json`
    改准为 **14 断言 / 0 失败 / 30.195s**（原 tasks 6.1 写 25.4s、8.3 写 15 断言 / 26.7s、本条下游的
    「待真机验收」节写 15 断言）；③ delta 的「已知边界」句与同文件规范性条款的矛盾改准（判据读的是
    **不含标记自身贡献**的内容盒高度与滚动容器的可用高度，不是原文写的「滚动容器的可滚动高度」；
    「实现期须实测是否被编辑器的尺寸观察机制观测到」改为已实测的无反应结论 + 归档件 design §7 指针）；
    ④ 归档件内 **15 条** `../../../` 链接各补一层（脚本逐条拼路径 `exists()` 实测：补前 15 条不可达、
    补后 0 条不可达；= M206 对账时的 14 条 + 本 mission 在 proposal 补「机制偏离记录」时新增的 1 条
    `[REVIEW.md]` 链接）。另：proposal 补「机制偏离记录」
    （design 候选 A 的三条判据不可断言 → 落第三条路「真元素挂 `.cm-scroller`」，含 reviewer r1/r2 判定
    与节点 2 签字），`editor-live-preview` 的 Purpose 补本 change 的归属句。**未追改的两处（如实留档）**：
    tasks 5.7 的「13 个像素基线场景 / 43 处像素断言」是 M189 时点读数（现 `tests/visual/baselines/` 已有
    16 个快照目录），且 `43` 只在 `gate.sh visual` 的汇总结论里有支撑——归档件按原样保留，读时带时点。

29. ~~**`restyle-ui-tokens-v1` 的 ui-design-system delta 有一条层级错的相对链接**~~（**已核销**，
    2026-09-25）：tower 直接修（4 层 `../` → 5 层），`test -f` 实测可解析、`validate --strict` 绿。
    遗留建议仍有效：把 M205 的「相对链接可达性实测」做成归档收尾可复跑脚本（docs-check 与 validate
    都不查相对链接）。

30. **change `open-image-lightbox` 待归档跟踪**（**补登 + 核销同日**，2026-09-25，M208）：流程口径要求每个
    change 在实现 PR 合并时即落一条待归档记录（`docs/process/openspec-workflow.md` 的批次收尾 checklist
    第一条）。本 change（M184 实现 merge `501369c`）**合并时没有落这条记录**——全仓 grep
    `open-image-lightbox` 在 `docs/backlog.md` 只命中 dblclick 通道条与 `src/preview/attachments.ts` 的旧
    路径指针，没有待归档条目，正是 M150 记过的失效模式。它此前还**卡在通道边界上**：以 `dblclick` 为唯一
    打开路径的交互被记作「真机不可验」（见「验收套件」节的 dblclick 条）。处置：① 双击通道由 M209 打通
    （swift + `CGEvent` 显式 `kCGMouseEventClickState`），真机场景 33 落库并 PASS（36 断言）+ 反向验证
    FAIL 7 红，6.1–6.3 / 6.5 / 8.3 五条未勾项补做；② 归档期两项 chromium 断言缺口（G1①②③ 方言形态 /
    位图形态 / 放大层不发起外链与无脚本副作用、G2 模态期间的字符键）由 M209 补齐并各自反向验证；③ 归档期
    措辞改准：读取计数按实现口径为 **9**（十处引用里有一条外部 `http(s)` 直连分支不读附件字节，「计数等于
    引用条数」的等式不成立）、requirement 的三种形态列表注明外部 `http(s)` 只在渲染成可见图像时落在射程内
    （出厂 CSP 下它必然落占位、没有打开路径）、proposal 与 design 的场景编号 23 → 33、人工清单收窄到
    手感层（行为判别层由场景 33 + chromium 断言组承担）。**核销**：归档为
    `openspec/changes/archive/2026-09-25-open-image-lightbox/`，`attachment-display` 落 2 条 ADDED（无新建
    capability），tasks 34/37（3 条未勾各有就地理由：6.4 的判据钉在「本 change 的实现 PR」上，场景与 fixture
    是 M209 的 PR 才落的；3.4 与 9.2 是可裁决条件项且节点 1 未选中）；归档件内 14 条 `../../../` 链接各补
    一层（拼接 `exists()` 实测 0 条不可达；= M207 对账时的 13 条 + 本 mission 收口时在 6.1 记录里新增的
    1 条 `[REVIEW.md]` 链接），`attachment-display` 的 Purpose 补本 change 归属句并回填 M178
    （`image-svg-and-fallback`）漏掉的那半句。**另有两处残留如实登记**：① `src/preview/attachments.ts:415`
    与 `scripts/acceptance/scenarios/33-image-lightbox.md:151` 的旧路径指针见「文档指针与门禁清单」节；
    ② M184 探针实测的运行期 `attachmentReads` = 10 与「9 处引用需要读字节」这个静态条数不一致（成因未定位，
    机制上装饰被滚动淘汰后重建会再读一次）——归档件把两个数都如实写出、**不编造解释**，若要对齐先起一次
    读数实测。

31. ~~**结束标记（`.cm-lp-end-marker`）的字号基准与正文分叉**~~（2026-09-25，M208 登记；
    **2026-09-25 由 M213 核销**）：标记旧口径的 `0.82em` / `4em` 以 `.cm-scroller` 为基准，而它没有自己的
    字号声明、只继承 `.cm-editor` 写死的 `14px` ⇒ M195 的排版能力放大正文时标记**不跟随**
    （线宽反推 45.9px = 4 × 0.82 × 14px 佐证基准是 14px）。**核销落点（R2b 修复 + M213 补门禁断言）**：
    ① 修复 `src/preview/theme.ts` 的 `.cm-lp-end-marker`——字号改 `calc(var(--editor-font-size) * 0.8)`
    （基准 = 内容字号的单一来源；默认锚 15px ⇒ 12px = 字号阶梯的 doc-meta 档），线段仍写 `4em`
    （随根字号解析，因而随基准缩放）；真机分叉的探针读数与修前/修后对照见
    `test-results/m212/backlog-31-end-marker.md`（15px 档 12px / 线段 48px；24px 档 19.2px / 线段 76.8px；
    修前两档恒为 11.48px）。② 门禁断言：`tests/visual/scenes/end-marker.spec.ts` 新增
    「backlog #31：标记字号跟随内容字号」——两档（15px / 24px）各断言标记字号 = 0.8 × 内容字号、
    线段长 = 4 × 标记字号，并前置断言两页内容字号确实不同（否则比值判据会在「两页一样」上空转）。
32. ~~**watch 增量不覆盖外部新建目录：文件树不刷新（重启可见）**~~ **已核销（M245，2026-09-27）——
    产品侧无缺陷，原 finding 的根因判断不成立；错在验收断言的观测时序**（2026-09-25，M221 finding，
    worker-fix-closeout，low；**2026-09-26 Alex 裁决：修**——「你在 Finder 里整理 vault 是常态操作，
    树不刷新会显得 app 死了」）：原 finding 依据「app 运行中经外部在 vault 里新建目录（含文件）后，
    文件树 60 秒内不刷新出该目录行；重启后可见」判定 watch 增量不覆盖「新建目录」形态。
    **M245 逐段定位（每一段都有落盘证据）**：
    ① 后端**确实**发出该增量——真机实测 `flush − 文件 mtime = 104–122ms`，批次为
    `[Created restyle-dir (dir), Created restyle-dir/note-in-dir.md (file)]`
    （`test-results/acceptance/m245-probe5/app.log`；定位用的临时 `eprintln!` 已随 06a64c7 撤除）；
    ② 前端 `applyChanges` 对该批次的处理正确：目录行模型→DOM 一步到位、可展开、可级联删
    （`tests/unit/tree-increment.test.ts` 六例，含「父缺失丢弃」反向对照）；
    ③ 真机五轮探针（`test-results/acceptance/m245-probe1…5/`）：**写完立刻读 AX 必 FAIL，先
    `sleep 200` 再读必 PASS**，其后每一次读都 PASS——紧跟写入的第一次 AX 读取与那次刷新抢
    （候选机制：AX 枚举本身占着 webview 主线程；未直接证实）；
    ④ 原 finding 的「60 秒」是**断言链级联**：第一读漏掉目录行 → 下一步点不到目录行 → 再下一步
    `open restyle-dir/note-in-dir.md` 等的是「左栏出现**子文件行**」，而目录折叠时子行永远不会
    出现，于是 60s 超时（probe1/probe2 逐字复现这条级联）；
    ⑤ 外部新建**文件**（原 finding 未测的那一半）同一条 watch 路径、无此问题：场景 47 的
    「树里有 aaa-menu.md / aab-tab.md」「目录行已在树里」三条断言在本分支真机运行 PASS
    （`test-results/acceptance/m245-final/47-file-tree-context-menu/steps.md`）。
    **落地（M245，分支 `feat/fix-watch-external-mkdir-tree-refresh-m2`，提交 `06a64c7`，合并 `b6ecfd7`）**：验收场景 36
    删掉 `do: restart` 绕行步，断言翻为「运行中刷新可见」（前置 `sleep 1000` 只取观测时序，判据未
    弱化，口径写进场景「已知边界」）；后端补 `watch_delivers_external_new_dir_with_nested_file` 与
    `refine_with_known_keeps_new_dir_created_and_normalizes_seeded_replay`（Rust lib 162 全绿）；
    前端补 `tests/unit/tree-increment.test.ts`（374 全绿）；真机场景 36 PASS（14/14，证据
    `test-results/acceptance/m245-final/36-restyle-content/`）；`gate.sh quick` 9/9 PASS。
    finding `20260925-worker-fix-closeout-bug-watch.md`（其结论已被本条更正）。
    **同因的另一条 finding**：`20260927-worker-watch-mkdir-improve-vaultwrite-ax-do-settle-60.md`
    （`do: settle` 其实只读一次 AX，名实不符；建议把「外部写入后先留一拍再读」写进套件 README）。
33. **版本号 bump 策略**（2026-09-25，M225 finding，worker-proposal-version，low；
    **2026-09-26 Alex 裁决：按 semantic versioning**）：版本号真源 `src-tauri/tauri.conf.json:4` 的
    `version` 是占位 `"0.0.0"`（`package.json:3` 同），仓内无任何 bump 工具链或发布流程
    （`bundle.active = false`）。M236 把产品名+版本号常显到标题栏后界面会如实显示 0.0.0。
    **执行口径（tower 按 semver 裁决细化）**：起始 0.1.0；0.x 期间 MINOR = 功能批次、PATCH = 缺陷
    修复批；bump 时机 = 每个合并批次收尾由 tower 执行、随批次 push；唯一真源 tauri.conf.json，
    package.json 同步跟 bump；首次 bump（0.0.0 → 0.1.0）随下一个缺陷/工具批落地。bump 动作补进
    批次收尾 checklist。finding
    `20260925-worker-proposal-version-idea-tauri-conf-json-version-0-0-0-0-0-0.md`。
    **已裁已落地（M238，2026-09-26）**：首次 bump 落 `0.0.0 → 0.1.0`——`src-tauri/tauri.conf.json:4`
    与 `package.json:3` 同步；两处「真源副本」同批跟改（REVIEW.md 第 8 条）：视觉桩的缺省 appMeta
    （`tests/visual/scenes/tauri-stub.ts` 的 `{ name: "Lumir", version: "0.1.0" }`）与
    `tests/visual/scenes/titlebar-identity.spec.ts` 的 `VERSION`（两处刻意各写一份：桩模拟后端、
    场景断言「前端如实显示后端给的值」）；真机场景 39 的两处 dump 示例同步改准（断言本身早就走
    `$appVersion` 占位符，从 `tauri.conf.json` 读真值）；**Cargo 侧两处随同批改（r2 追加）**——
    `src-tauri/Cargo.toml:3` 与 `src-tauri/Cargo.lock` 的 `[[package]] name = "lumir"` 一并落 `0.1.0`，
    理由见下条。**此后口径**（本条即 canonical 记录）：
    批次收尾时按 semver bump——**功能批 MINOR、缺陷批 PATCH**（0.x 期间），唯一真源
    `src-tauri/tauri.conf.json` 的 `version`，`package.json` 的 `version` 同步跟随，随批次 push；
    改真源副本时按上列清单逐处跟改（桩 / 场景示例 / 文档示例 / **`src-tauri/Cargo.toml` +
    `src-tauri/Cargo.lock`**）。**未落地的一格**：把 bump 动作写进
    `docs/process/openspec-workflow.md` 的「批次收尾 checklist」不在 M238 的 scope 内，待 tower 补。
    **Cargo 侧纳入跟改清单（r1 P2-4 提出 → r2 落地）**：`src-tauri/Cargo.toml:3` 与 `Cargo.lock` 的
    `[[package]] name = "lumir"` 的 `version` 本次**已随批改为 `0.1.0`**（tower r2 裁决：不接受
    「有意不跟随」——它是同一语义的第三份拷贝，留着正是 REVIEW.md 第 8 条要灭的隐患）。
    **为什么要跟改（r1 的查证结论保留在此当理由）**：① tauri 的配置 schema 明写 `version` 字段
    「If removed the version number from `Cargo.toml` is used」
    （`node_modules/@tauri-apps/cli/config.schema.json:34`，同句还写「recommended to manage the app
    versioning in the Tauri config」）——**字段在场时 Cargo 侧不是版本来源**，但一旦有人删掉该字段
    （或在别的 change 里把它改成指向 package.json 的路径），应用版本会**静默回落**到 Cargo 侧那个号，
    陈旧号因此是「将来踩坑」的形态；② 实测佐证该字段当前确实压过 Cargo：M238 的真机场景 39（断言
    AX 树含 `$appVersion`，占位符从 `tauri.conf.json` 读真值）在 Cargo 侧仍是 `0.0.0` 的状态下 PASS
    ——运行期读到的就是配置里那个 `0.1.0`。两处一起跟改后，「运行时取哪个」与「仓里躺着哪个」
    不再有分叉。**非副本、无需动**（r1 同批核过）：`tests/visual/package.json`（独立私有包）、
    `scripts/visual/table-probe72/tauri.conf.json`（独立探针工程）、`tests/unit/modeline.test.ts` 的
    `0.0.0`（渲染输入 fixture，不是真源副本）。
34. **gate.sh PASS 时删临时日志，看不到逐用例读数**（2026-09-25，M214 worker-restyle-r4-baseline
    提的改进点，tower 转录登记，low；**2026-09-26 Alex 裁决：改**——PASS 也保留日志并打印路径）：
    `scripts/gate.sh` 的 `run_gate` 只在 FAIL 时打印日志路径，PASS 即删临时日志——门禁输出只有
    一行 `GATE PASS visual-regression`，用例数、逐用例读数都看不到；M214 当时不得不改用
    `scripts/visual/run.sh` 同端口补跑一次才把「34 张逐张比对通过」落成可 grep 的证据。落地：
    PASS 时保留日志、输出打印一行路径（不展开内容），临时文件不再即删。
    **已裁已落地（M238，2026-09-26）**：`run_gate` 的 PASS 分支去掉 `rm -f "$log"`、PASS 行改为
    `GATE PASS <名> <耗时>s — 完整日志：<路径>`（FAIL 行为不变：路径 + 末 30 行回显）；脚本头部
    注释同步写明「PASS 也留日志」的理由与落点。日志走 `mktemp -t`（`$TMPDIR` 下），按门禁名命名。
35. **分模式折行默认（md 折 / code 不折）**（2026-09-26，Alex 使用反馈发起探讨，tower 登记；
    **2026-09-26 Alex 裁决：采纳 tower 建议**——机制=覆盖键 + 出厂分叉）：现状
    `[editor] line_wrap`（默认 true）是全局单键，`code_block_wrap` 只管 md 围栏块；M231（非 md
    可编辑）落地后 code 模式是一等表面，长代码行被全局折行基本不可读。落地口径：① 机制 = 可选
    覆盖键（如 `editor.code_mode_line_wrap`，缺省跟随全局 `line_wrap`）——只有 md/code 两个模式，
    单键比 per-language 表成比例；② 出厂默认直接分叉（code 默认 false）——md 折 / code 不折是
    行业通行出厂口径（VS Code / JetBrains 出厂不折行），不是个人怪癖；「配置即数据」约束下个人
    偏好的居所是配置文件而非硬编码。
    **已裁已落地（M247，2026-09-27）**：键名定为 `editor.code_mode_line_wrap`（布尔，出厂 `false`），
    全链落地——`config.rs`（字段 + 宽容镜像 + 逐字段回落 + 三条单测）、`src/preview/theme.ts`
    （`WrapSettings` 第三轴、`DEFAULT_CODE_MODE_LINE_WRAP`、`wrapSpec` 按模式取轴）、`src/editor.ts`
    （运行期真源第三轴 + `toggleLineWrap` 按前台会话模式选轴）、`src/main.ts`（配置消费点）、
    bindings 重导出。**语义收紧一处（本 mission 写死，覆盖上面 ① 的措辞）**：①里的「缺省跟随全局
    `line_wrap`」与 ②的「出厂分叉」在 `line_wrap = true` 时字面冲突——跟随会让 code 出厂折行；采 ②
    为准：缺省值 = 本键自己的出厂 `false`，MUST NOT 读 `line_wrap`（spec 的「code 模式缺字段时
    不跟随 line_wrap」scenario 钉这条）。证据：`openspec/changes/code-mode-line-wrap/`
    （proposal/design/tasks + `editor-live-preview` delta）、`tests/unit/wrap.test.ts`、
    `tests/visual/scenes/m247-code-mode-line-wrap.spec.ts`。
36. **配置项可发现性**（2026-09-26，Alex 使用反馈发起探讨，tower 登记；**2026-09-26 Alex 裁决：
    采纳两步走**——① 配置参考文档随 #35 同批落地；② describe-config 面板中期另立项）：`config.json`
    只落用户显式设过的键，完整键面（`editor.*` 6 键 / `ui.*` 2 键 / `keys` 表 / `log.level`）与
    默认值只写在 `config.rs` 注释里，用户无从知晓有什么可配。落地口径：① 配置参考文档
    （canonical 键值表：类型 / 默认 / 取值范围 / 生效时机，真源对齐 `config.rs`；附配置目录布局节
    ——`vault-registry/` = vault 注册表（身份，#37 更名后）、`vault-sessions/` = 标签会话（易变
    状态），两者同一 vault 实体刻意分存（`vault_session.rs` 头注释 / multi-vault-workspaces
    design §2），另覆盖 `reading-positions/`、`logs/`）；② 中期应用内 `describe-config` 面板
    （照 `describe-bindings` 模式：每键当前生效值 / 出厂值 / 改法）。**明确不推荐**「写全量默认
    进 config.json」——会把缺字段跟随出厂默认钉死成旧值，与合并写纪律冲突。
    **① 已裁已落地（M247，2026-09-27）**：`docs/specs/config-reference.md` 新建——顶层 4 项 +
    `[editor]` 7 键（含 #35 的新键）+ `[ui]` 2 键的键值表（逐键给类型 / 默认 / 取值范围 / 生效时机 /
    `config.rs` 真源行号）、解析容错口径节（逐字段回落 vs 整文件回落）、写回纪律节（合并写、
    未知键保留、不推荐写全量默认）、配置目录布局节（`workspaces/` 现名 + #37 更名前向注记 /
    `vault-sessions/` / `reading-positions/` / `logs/`，同一 vault 实体刻意分存的生产原因引
    `vault_session.rs` 头注释）。**② 保持「中期另立项」不动**——本 mission 未做面板、未留钩子。
37. **配置目录改名 `workspaces/` → `vault-registry/`**（2026-09-26，Alex 裁决：**改**——他
    对 tower「不建议动」的唯一不同意见）：`workspaces/` 装的是 vault 注册表（身份：id ↔ path、
    治理标记、`last_opened_at`），名字与「工作区状态」语义错位，与 `vault-sessions/` 并置时
    误导为两个业务概念。落地口径：① 目录名改 `vault-registry/`（与 `vault-sessions/` 对仗，
    「同一 vault 实体的两个面」从名字可读）；② 迁移 = 启动时一次性 `fs::rename`（同目录同文件
    系统，原子；新目录已存在则不动作），迁移记一条诊断事件；③ Rust 模块 `workspaces.rs` →
    `vault_registry.rs` 连带引用更新（commands/lib/reading_position/recovery/vault_session），
    保持名实一致；④ 验收套件隔离 `XDG_CONFIG_HOME` 下补迁移场景（旧目录 + 文件 → 启动后新目录
    可见、注册项不丢）。历史文档（multi-vault-workspaces 等 change 名）不改写。
    **已落地（M248，2026-09-27）**：① 目录名 = `vault-registry/`，真源是 `src-tauri/src/vault_registry.rs`
    的 `REGISTRY_DIR_NAME`；② 迁移 = 启动路径上一次 `fs::rename`（同目录同文件系统，原子；新目录已存在
    则不动作；rename 失败原地保留、下次启动重试），四态单测落在同文件的 `#[cfg(test)] mod tests`，迁移
    记一条 `vault_registry_migrated` 诊断事件（`logging` 新增事件名，`src/bindings/LogEventName.ts` 增量
    一行字面量）；③ 模块 `workspaces.rs` → `vault_registry.rs`，`commands` / `lib` / `reading_position`
    / `vault_session` 的引用与注释一并同步；**类型名 `VaultWorkspace` 与 `workspace_read|write|path`
    错误码刻意保留**——它们经 ts-rs 进 `src/bindings/`、被前端 import，改名会波及 webview 契约面，属
    另一件事；④ 真机场景 `48-vault-registry-migration`（套件新增 `seed.legacyRegistry` 预置通道与
    `resetRegistry()` 同清新旧两名目录）。文档面同步：`docs/specs/config-reference.md` §4 改为现状描述
    并删 #35 写的前向注记；历史文档（change `multi-vault-workspaces` 等）仍按原口径不改写。
    **合同文本同步（M250，2026-09-27）**：living spec 的注册表路径此前仍写旧名（`openspec/specs/
    vault-workspace/spec.md:49`），与实现矛盾——新增 change `sync-vault-registry-dir-spec`
    （MODIFIED「vault 注册表与显式重映射」：路径字面改 `~/.config/lumir/vault-registry/` + 迁移口径段 +
    新增 scenario「旧注册表目录在启动时迁移」，其余条款逐字携带）并同批把 delta 应用到 living spec
    （两侧同名 requirement 正文 sha256 相同 ⇒ 归档是幂等替换）。`validate --all --strict` 28/28 绿；
    归档节点 2 待 Alex（见「待 Alex 裁决」第 38 条）。至此本条 ①②③④ 与文档面全部落地。

32. **change `product-version-display` 待归档跟踪**（2026-09-26，M236 登记；**已核销**：经核该 change 早已由
    M253 归档批归档（2026-09-27，archive/2026-09-27-product-version-display 在场、validate 绿），本跟踪条
    当时未同步核销；2026-10-03 M308 批次收尾由 tower 核销）：流程口径要求
    每个 change 在实现 PR 合并时即落一条待归档记录（`docs/process/openspec-workflow.md` 的批次收尾
    checklist 第一条）。本 change（提案评审节点 1 已于 2026-09-25 通过，D1/D2/D3 裁决见 `proposal.md`
    头部）**实现已完成、未归档**，卡在两件事上：
    ① **视觉基线待 Alex 裁决**——标识块让 21 张整页基线 + 3 张标签栏元素基线内容变化，过目包在
    `test-results/m236/baseline-review/`（**基线一律未改**，等批准才 `--update`）；
    ② **归档顺序**——本 change 的 `specs/ui-design-system/spec.md` delta 含 **MODIFIED Requirements**，
    而它依赖的 `restyle-ui-tokens-v1` **仍未归档**（`openspec list`：49/51 tasks），此时 archive 会被拒。
    按裁决「不强行 archive」，等 ① 过、② 的前置 change 归档后再走节点 2。归档对账要点预记：本 change
    的 tasks.md §1–§5 已逐条勾选并附证据指针；真机判据为场景 39（`scripts/acceptance/scenarios/
    39-titlebar-identity.md`，1/1 PASS）。

33. **change `live-theme-switch` 待归档跟踪**（2026-09-26，M237 登记；**已核销**：经核该 change 早已由
    M253 归档批归档（2026-09-27，archive/2026-09-27-live-theme-switch 在场、validate 绿），本跟踪条
    当时未同步核销；2026-10-03 M308 批次收尾由 tower 核销）：流程口径要求
    每个 change 在实现 PR 合并时即落一条待归档记录（`docs/process/openspec-workflow.md` 的批次收尾
    checklist 第一条）。本 change（提案节点 1 已于 2026-09-25 通过，D1/D2/D3 裁决见 `proposal.md`
    头部）**实现已完成、未归档**，卡在两件事上：
    ① **视觉门禁对本 change 的可见变化是「看不见」的（如实登记，不是绿灯）**——modeline 右段新增
    主题指示钮（`.modeline-theme`，可见文本 = 当前主题名），该元素实测整块 **41.6×19.75 ≈ 821 px²**
    （证据 `test-results/m237/chip-area-probe.log`），而 1200×800 下 `maxDiffPixelRatio: 0.001` 的预算是
    **960 px**：即使钮内每个像素都变，diff 比例也只有 0.000856 < 0.001。后果是**全量视觉套件照绿**，
    但那不等于「基线与界面一致」——21 张整页基线都少了这个钮。**2026-09-26 tower 裁决（依据 Alex 总授权 +
    M236 立范流程）：随本批重建**——21 张整页基线已 `--update` 重建，过目包在
    `test-results/m237/baseline-review/`：逐张 pre/post 差异对账 `audit-table.md`、逐张对照图
    `img/*-pair.png`、sha256 manifest `baselines-{pre,post}-sha256.txt`，另有独立复核脚本
    `independent-check.py` / `independent-profile.py` 与其日志（列级墨迹谱对账）。重建后的像素对账结论：
    21 张的差异**全部**落在 modeline 条带（y778..797）内，形态 = 新增指示钮（右对齐 x1144..1185，宽 42px）
    + 既有 modeline 右段文本整体左移 54px（钮宽 41.6 + 间距 12），条带外像素逐字节不变；钮区域像素在
    6 个场景间逐字节相同。**这仍是 REVIEW.md 第 3 条的同族现场**——容差按「最小真实变化的下限」核算时，
    41×20 ≈ 821 px² 的新增元素在 0.001 档（预算 960 px）结构性不可见，基线要靠人裁决推动才重建、门禁
    本身照绿；若 Alex 认为该收，落点是给这类小元素补元素级基线（标识块已有先例）或收紧容差，二者都不
    在本 change 的 scope 内（proposal 明写「不动视觉基线口径」）。
    ② **归档顺序**——本 change 的 `specs/ui-design-system/spec.md` delta 含 **MODIFIED Requirements**，
    而它依赖的 `restyle-ui-tokens-v1` **仍未归档**（`openspec list`：49/51 tasks；2026-09-26 复检仍如此），
    此时 archive 会被拒。按 task §5.1 的口径「不强行 archive」，等 ① 有结论、② 的前置 change 归档后再走
    节点 2。归档对账要点预记：本 change
    的 tasks.md §1–§5 已逐条勾选并附证据指针（含两处**过时项修正**：§3.1 不新增 Rust 命令、走 M228 的
    通用合并写 IPC；§4.3 场景号 44）；真机判据为场景 44（`scripts/acceptance/scenarios/
    44-theme-live-switch.md`）；文案新增 D122（主题钮的悬停提示 / 读屏名）与 D123（写盘失败 toast）；
    附带修订两处既有自述：`35-restyle-three-themes` 正文的「不存在运行期切换通道」与本文件
    restyle 段里「`[ui] theme` 的『重启生效』口径」。

38. **change `sync-vault-registry-dir-spec` 待归档跟踪**（2026-09-27，M250 登记，**待 Alex 节点 2**）：
    流程口径要求每个 change 在实现 PR 合并时即落一条待归档记录（`docs/process/openspec-workflow.md`
    的批次收尾 checklist 第一条）。本 change 是 **retro 型**（实现先于规格：M248 已合并 `d989197`，
    而 living spec 的注册表路径仍是旧名、与实现矛盾），**无代码 diff**；制品 = delta（MODIFIED ×1，
    路径字面 + 迁移口径段 + 新增 scenario）+ living spec 同步落盘（两侧同名 requirement 正文
    `sha256` 相同，归档是幂等替换）。**节点 1 由 M248 的 #37 裁决覆盖**（改名 + 启动迁移是 Alex
    2026-09-26 已裁行为，proposal 的「裁决记录」节写明这一点）。归档对账要点预记：delta 与 living spec
    逐句一致、requirement 名在 living spec 出现恰好一次、`validate --all --strict` 28/28；节点 2 通过后
    `npx --yes @fission-ai/openspec@1.12.0 archive sync-vault-registry-dir-spec --yes`，预期 living
    spec **零 diff**。
    **状态更新（2026-09-27，M254 收口）**：归档**已执行**——`5ac43e3`（master，M255 的
    `6f301b4` 「归档 sync-vault-registry-dir-spec 并复核幂等」，节点 2 已授权）把该 change 移入
    `openspec/changes/archive/2026-09-27-sync-vault-registry-dir-spec/`，living spec 的注册表路径与
    迁移口径已并入，无代码 diff。本条核销。（M254 的分支 base 早于该合并，因此本分支上
    `openspec list` 仍会列出它——不是漏归档，是合并顺序。）


39. **M254 两个 change 待归档跟踪 + 一个待裁决点**（2026-09-27，worker-tab-strip 登记，**待 Alex 节点 2**）：
    同批两个 change：`tab-strip-context-menu`（标签右键菜单三条关闭路径，ADDED ×1）与
    `preview-tab-removal`（移除预览标签机制：`multi-tabs` 一条 REMOVED + 一条 ADDED + 一条 MODIFIED，
    `vault-workspace` 两条 MODIFIED）。节点 1 的口径已由 tower 2026-09-27 的裁决覆盖（标签菜单三条关闭
    路径 + 移除预览机制 + 扩 scope 到 `src/editor.ts` / `src/vault-switcher.ts` / 场景 14、31），
    本条是实现 PR 合并时的待归档记录（`docs/process/openspec-workflow.md` 的批次收尾 checklist 第一条）。
    归档对账要点预记：delta 与 living spec 逐条对账——`preview-tab-removal` 的 MODIFIED 块保留了三个
    历史 scenario 名（`dirty 与预览态在标签上可见` / `预览标签不入盘` / `固定标签语义`），理由写在 delta
    正文与该 change 的 design §三（OpenSpec 1.12 的 MODIFIED 块不允许改 scenario 名，改名通道是整条
    REMOVED + 新增承接条）；`validate --all --strict` 期望 21 passed / 0 failed；真机判据为场景 50
    （实现期另改齐 14 / 31 两条既有场景的预览断言）；文案新增 D148–D151、改述 D99。
    待裁决点：**菜单三项的上屏语言**——Alex 给的原文是英文（Close / Close Other Tabs /
    Close Tabs to the Right），而上屏取的是中文列（关闭 / 关闭其他标签 / 关闭右侧标签；英文原文逐字进
    deck 的 English 列）。依据是界面语言是中文、全仓唯一不跟界面语言走的可见文案仍只有 D114 的 END。
    若 Alex 要菜单直接上英文，改动面是 `src/tabs.ts` 的三个常量 + deck 两列对调 + 一条视觉断言
    （`tests/visual/scenes/tab-menu.spec.ts` 的菜单文案断言）。
    **已裁决（2026-09-27，Alex「上屏」英文）**：菜单三项改英文上屏由 M257 落地并合并（`cd9142d`：
    `src/tabs.ts` 三常量改 Close / Close Other Tabs / Close Tabs to the Right，deck D149–D151 双列对调、
    原中文措辞移右列备查）。场景 50 与 change spec 的中文文案残留归 M266 收口。本条待节点 2 归档时
    一并核销。
    **归档动作已执行（2026-09-28，M287 归档批）**：两个 change 都已归档（`openspec/changes/archive/2026-09-28-tab-strip-context-menu` / `…-preview-tab-removal`），`multi-tabs` 的
    REMOVED ×1 + ADDED ×1 + MODIFIED ×1 与 `vault-workspace` 的两条 MODIFIED 逐字落进 living spec
    （逐 requirement 字节比对，`openspec list` 已空）。**Alex 节点 2 的过目包见 M287 的 review-request**，
    本条随该评审一并核销。
40. **归档 change `goto-line-command`**（M281 实现，2026-09-27；**2026-09-28 Alex 二次改判 D4**，**待 Alex 节点 2**）：
    Alex 原话「增加类似 Emacs 那样跳转到指定行号的快捷键」；节点 1 裁决（2026-09-27）已落定 D1/D2/D3
    并**改判 D4**（md 不再豁免行号 gutter）；**二次改判（2026-09-28）把 D4 收成可配置三档**——
    `[ui] markdown_line_numbers = "on-demand"（默认）/ "always" / "off"`，只管 md；code 恒常显、
    不进配置（Alex 原话：「显示行号是可配置的，markdown 默认不显示、go-to-line 时出现、完成后隐藏。
    代码默认显示」）。M261 交付提案、M271 按第一次裁决修订、M281 实现 + 中途按二次改判转向（先 amend
    提案再改实现）。本条是 `docs/process/openspec-workflow.md` 批次收尾 checklist 第一条要求的待归档记录。
    归档对账要点预记：delta（`keymap-commands` 一条 ADDED ×1，**11 条 scenario**）与实现逐条对账；归档时
    living spec 落 `openspec/specs/keymap-commands/spec.md`；`validate --all --strict` 的 passed 数按
    归档当时的基线核（不背口头值）。
    **三处与本文件的既有登记不同步，归档时要读准**：
    ① md 的行号 gutter 在真机 AX 树里不可读（CM 给 `.cm-gutters` 带 `aria-hidden`），真机只留截图证据
    （场景 56 的步 1 / 步 4 / 步 6 三张配对图），几何判据在 chromium 层；
    ② 图片行之后的行号会低约一个文字盒（CM 高度表 vs DOM 行盒的既有差，非本 change 引入）——见下面
    「md 行含 inline widget 时的高度表差」条；
    ③ **md 默认档下没有行号列**，因此整页视觉基线对 master 零 diff（22 张常显形态的重拍随二次改判作废）；
    只有本 change 自己新增的两张场景基线（`m281-md-gutter` = `always` 档常驻形态、`m281-goto-prompt` =
    `on-demand` 档输入条打开态）。
    归档时若 Alex 对 md gutter 的观感（贴正文列左缘的位置、无底色）有改判，改动面是
    `src/preview/theme.ts` 的 gutter 段 + `always` 档的整页基线重拍；若要**运行期**切换档位（照 Emacs
    `display-line-numbers` 的随时 toggle），那是一个新 change（`[ui]` 回写通道 + 一个命令 / 键位 / UI
    落点，先例是 `ui.theme` 的 modeline 主题钮）。
    **归档动作已执行（2026-09-28，M287 归档批）**：已归档为
    `openspec/changes/archive/2026-09-28-goto-line-command`，delta 的 ADDED ×1（11 条 scenario）逐字落进
    `openspec/specs/keymap-commands/spec.md`；归档当时的基线读数 **18 passed / 0 failed**（不背口头值）。
    **Alex 节点 2 的过目包见 M287 的 review-request**，本条随该评审一并核销。

## 待修 findings（不阻塞）

### harness 会话以 vault 根路径字符串为键，打开 vault 不做规范化：同目录两种拼写各建一个会话（M312 现场，2026-10-03，medium）

**症状**：harness 会话映射与 `harness:event` 标识都以 vault 根路径**字符串**为键，而 vault 打开
路径不做规范化——macOS 上 `/tmp/lumir-m102-acceptance` 与 `/private/tmp/lumir-m102-acceptance`
（`/tmp` 是指向 `/private/tmp` 的符号链接）会被当成两个 vault，各建一个会话。**切回同一个
vault 的另一种拼写时，那段对话在面板里消失**（内容仍在 `<config_dir>/harness/*.jsonl` 留存里，
JSONL 文件名即后端会话键可对照）。

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
第 12 条（同类缺口）同族。

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
读数 **49 PASS / 8 FAIL**；逐场景结论与耗时见「待真机验收」的 **M256 全量回归总表**，
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

**归档不重写相对链接、目录深度 +1 无门禁**（low，M253 finding）：`openspec archive` 移动目录但不改
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
  实测与验收判据见文末「已核销」的同日条目。
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
设计见 [docs/process/real-machine-acceptance.md](process/real-machine-acceptance.md)）；手感/审美项仍归 Alex。

分类依据 = **证据目录里真实 PASS 的场景**，不是「场景写了就算覆盖」。最近一次全量实跑：
**M284（2026-09-28，语言面修复批）——65 场景 / 57 PASS / 8 FAIL**（`node scripts/acceptance/run.mjs`，
`caffeinate -dimsu` 包住、串行独占 1430），证据 `test-results/acceptance/2026-09-28/`（git 外，
`summary.md` + 各场景 `steps.md`/`shots/`/`ax/`）；8 条红逐条归因见下面的 M284 总表。**上一次全量：
M256（2026-09-27）——57 场景 / 49 PASS / 8 FAIL，那是 M282 改判默认语言之前的现场（场景当时跑在 zh
面），读数不再可复现**：M256 的 8 条红（28/29/31/32/38/43/47/50）与本批的 8 条红（见下）只有 **28、
47** 两条重合，其余是 M266/M277/M278/M280/M281/M283 各批修完或新增的。M256 的表格保留在下面仅作
沿革对照。**上一次全量：
M240 批次（2026-09-26）49 场景 / 47 PASS / 2 FAIL（`32-list-filter`、`43-list-tab-indent`）**；更早 M164 批次（本地 2026-09-18 凌晨，
证据目录按 UTC 记为 `2026-09-17`）26/26 PASS，其套件改动与运行纪律（就绪门改判形态 A、窗口经
`--config` 钉主屏、每场景清 `workspaces/` 与 `vault-sessions/`、新增 `seed` 与第二个合成 vault、
`caffeinate -dimsu` 包住）见本文件「多 vault 收口遗留」一节。

**M296 的真机批已跑完（2026-09-29）**——新增的场景 `67-vault-open-ignore-set` **PASS**，
多 vault 回归 16 / 17 / 19 / 25 / 48 / 60 **全绿**（`node scripts/acceptance/run.mjs 67 16 17 19 25 48 60`
→ **7/7 PASS**，证据 `test-results/acceptance/2026-09-29-final/`，git 外）。读数与结论（
`#[command(async)]` 成立、忽略集收窄在验收 vault 上量不出来、`vault_scan_ignored` 计数）见本文件末尾的
「M296」节，原始读数落 `test-results/m296/readings.md`。

### M284 全量回归总表（2026-09-28）

前提已 `lsof` 复核：1420 / 1430 起跑前后均无监听、无 `target/debug/lumir` 残留；磁盘 21G 可用；
套件自带隔离配置与两个合成 vault（`~/.config/lumir` 与用户真实 vault 全程未读写）；`caffeinate -dimsu`
包住、串行独占 1430。**65 场景 / 57 PASS / 8 FAIL，1685 断言 / 53 条失败断言，总耗时 2496s。**

| 场景 | 结果 | 断言 | 失败 | 耗时 |
|---|---|---|---|---|
| `01-mermaid-click` | PASS | 9 | 0 | 13.2s |
| `02-math-click` | PASS | 8 | 0 | 20.9s |
| `03-table-ctrl-np` | PASS | 15 | 0 | 28.6s |
| `05-cell-math` | PASS | 8 | 0 | 16.4s |
| `06-callout-and-width` | PASS | 10 | 0 | 25.2s |
| `07-recovery-paths` | PASS | 10 | 0 | 15.4s |
| `07b-recovery-saveas` | PASS | 12 | 0 | 22.1s |
| `07c-external-reload` | PASS | 6 | 0 | 14.9s |
| `08c-crash-recovery` | PASS | 15 | 0 | 35.4s |
| `08d-crash-discard` | PASS | 8 | 0 | 31.8s |
| `08e-force-overwrite` | PASS | 12 | 0 | 21.2s |
| `09-emacs-keys` | PASS | 15 | 0 | 22.6s |
| `09b-keys-config` | PASS | 6 | 0 | 18.6s |
| `12-links` | PASS | 53 | 0 | 55.4s |
| `13-toc` | PASS | 49 | 0 | 47.3s |
| `14-tabs` | PASS | 51 | 0 | 74.7s |
| `16-startup-restore` | PASS | 10 | 0 | 20.7s |
| `17-multi-vault-switch` | PASS | 38 | 0 | 36.4s |
| `18-vault-session-restore` | PASS | 7 | 0 | 19.2s |
| `19-vault-switch-guard` | PASS | 35 | 0 | 26.4s |
| `20-image-fallback` | PASS | 17 | 0 | 13.9s |
| `21-wrap-default` | PASS | 15 | 0 | 21.4s |
| `22-wrap-toggle` | PASS | 17 | 0 | 18.3s |
| `23-image-first-open-width` | PASS | 9 | 0 | 20.7s |
| `24-table-cell-ctrl-e-seq` | PASS | 11 | 0 | 27.2s |
| `25-vault-list-close-keeps-reading-position` | PASS | 26 | 0 | 28.9s |
| `26-svg-scroll-stability` | PASS | 17 | 0 | 33.6s |
| `27-document-end-marker` | PASS | 19 | 0 | 33.1s |
| `28-remember-reading-position` | **FAIL** | 16 | 6 | 103.5s |
| `29-typography-and-zoom` | PASS | 31 | 0 | 87.4s |
| `30-code-outline` | PASS | 38 | 0 | 53.5s |
| `31-code-variable-highlight` | PASS | 29 | 0 | 47.5s |
| `32-list-filter` | PASS | 47 | 0 | 47.5s |
| `33-image-lightbox` | PASS | 36 | 0 | 34.5s |
| `34-restyle-theme-skeleton` | PASS | 16 | 0 | 19.5s |
| `35-restyle-three-themes` | **FAIL** | 16 | 1 | 61.9s |
| `36-restyle-content` | PASS | 14 | 0 | 21.0s |
| `37-heading-hierarchy` | PASS | 11 | 0 | 14.8s |
| `38-content-width-drag` | PASS | 18 | 0 | 30.9s |
| `39-titlebar-identity` | **FAIL** | 19 | 1 | 49.0s |
| `40-table-fullscreen-view` | PASS | 30 | 0 | 29.5s |
| `41-editable-non-md-files` | PASS | 58 | 0 | 51.1s |
| `42-non-md-edit-guardrails` | PASS | 29 | 0 | 34.5s |
| `43-list-tab-indent` | PASS | 70 | 0 | 76.8s |
| `44-theme-live-switch` | PASS | 38 | 0 | 57.2s |
| `45-tab-cycle-keys` | PASS | 44 | 0 | 48.7s |
| `46-dotfile-jsonc-highlight` | PASS | 46 | 0 | 50.7s |
| `47-file-tree-context-menu` | **FAIL** | 101 | 23 | 98.3s |
| `48-vault-registry-migration` | PASS | 17 | 0 | 18.6s |
| `49-vault-switch-feedback` | **FAIL** | 22 | 1 | 25.2s |
| `50-tab-context-menu` | PASS | 46 | 0 | 40.8s |
| `51-tab-overflow` | PASS | 25 | 0 | 28.2s |
| `52-dir-rename-expand` | **FAIL** | 32 | 15 | 36.0s |
| `53-bold-click-selection` | **FAIL** | 23 | 4 | 43.4s |
| `54-bare-url-cmd-click` | PASS | 38 | 0 | 42.7s |
| `55-ui-language-switch` | PASS | 29 | 0 | 42.1s |
| `56-goto-line` | PASS | 39 | 0 | 55.7s |
| `59-enter-auto-indent` | **FAIL** | 29 | 2 | 116.9s |
| `60-vault-switch-restore` | PASS | 39 | 0 | 51.7s |
| `61-block-copy` | PASS | 31 | 0 | 57.9s |
| `62-code-block-fullscreen` | PASS | 45 | 0 | 60.0s |
| `render-markdown` | PASS | 14 | 0 | 19.8s |
| `render-table-degrade` | PASS | 9 | 0 | 13.9s |
| `search-01-find` | PASS | 22 | 0 | 42.1s |
| `search-02-binding` | PASS | 10 | 0 | 19.8s |

#### 8 条红逐条归因（每条都复跑过一轮，读数 `test-results/acceptance/2026-09-28-rerun-reds/`）

复跑 **4/8 转绿**、**4 条稳定红**；**无一条由 M284 的语言面改动引入**（本批只动 `scripts/acceptance/**`
与本文档，`src/**`、`src-tauri/**` 零 diff）。当轮读数的环境因子：跑批期间 Alex 在用机，
`Chrome`(pid 1103) / `Ghostty`(pid 1206) / `Lark`(pid 5842) 反复抢走前台 ⇒ 依赖「目标窗口前台且未被遮挡」
的键鼠注入类断言区间性失效（套件自己的 `前台焦点：未取得` 行是现场证据）。

| 场景 | 本轮现象 | 复跑 | 归因 |
|---|---|---|---|
| `28` | 视口类断言（「第 1 章两行不在渲染行里」）+ `env:reading-positions/*.json` 不存在 | PASS | **判据本身不稳**：README「已知边界」已记「AXTextArea.value 会截断、`行在不在 AX 里`不是视口判据」（M281 实测），28 用的正是这条形态 ⇒ 随快照截断位置摇摆。**待修**（改判据形态），不是产品缺陷 |
| `35` | `/AXTabGroup \(打开的文档\)/` 读到 `Open documents` | FAIL | **产品缺陷**（M284 新发现，finding `20260928-worker-fix-zh-scenarios-bug-relabel-zh-axtabgroup-en.md`：`src/shell.ts:89` 的标签段读屏名无 relabel 通道）。**本批的 zh 面把它照出来了**——若按「断言改 en」的修法，这条会被永久掩盖。**已修（M285，2026-09-28）**：`shell.ts` 的标签段读屏名挂进 `onRelabel`；场景 35 先红后绿，见本文件末的「M285」节 |
| `39` | 标识块上拖拽窗口成立 → `Δ=(0,0)` | PASS | **环境**：CGEvent 拖拽落在最上层那扇窗上（跑批时前台在别的 app）。REVIEW.md 第 16 条的同类症状另见，但那需要 DOM 里存在 `mousedown`+preventDefault 的监听（本批未复核到新增） |
| `47` | `press_key 失败：error: empty key DSL`（`keys` 里的裸 `-`）+ 级联 23 条 | FAIL | **套件注入通道已知未修**（finding `20260927-worker-impl-remove-autosave-bug-keys-kimicu-press-key-empty-key-dsl-47-52.md`；本文件 M256 节亦有登记）。建议单独派一个套件 mission |
| `49` | 「装载指示此刻在场」（`AXProgressIndicator`）读不到 | FAIL | **M283 之后的已知窗口问题**：M283 的 finding 已证「同步 command 阻塞期间主线程不空闲、AX 读不到节点；本 change 又把恢复段压到毫秒级」，指示窗口在真机上没有可读部分（本文件「M252 装载指示立论在打开段不成立」同族）。49 的快照采样窗口因此不够；**修法是探针口径**（M283 在场景 60 已按此处置），不是产品缺陷 |
| `52` | 同 `47` 的 `empty key DSL`（新名 `ren-subx` 含 `-`）+ 级联 15 条 | FAIL | 同 `47` |
| `53` | 拖拽类动作「目标窗口不在前台」（实测前台 pid=1206 = Ghostty）+ 见证字符未落地 | PASS | **环境**（前台被抢） |
| `59` | 两条「正观测：Enter 确实落地」sha256 未变 | PASS | **环境**（键盘注入丢键；当轮 59 相关步骤重试到 116.9s）。丢键是间歇的，REVIEW.md 第 11 条要求先按丢键复跑再判产品缺陷——复跑即绿 |

⇒ **本批把语言面假红清干净了**（语言面无一条红），剩下的 4 条稳定红各有归属：1 条产品缺陷（已 file
finding）、2 条套件注入通道缺陷（既有 finding）、1 条 M283 已定的窗口口径问题。

### M256 全量回归总表（2026-09-27，**M282 之前的现场**：场景当时跑在 zh 面，读数不再可复现）

前提已 `lsof` 复核：1420 / 1430 起跑前后均无监听、无 `target/debug/lumir` 残留；磁盘 35Gi 可用；
套件自带隔离配置与两个合成 vault（`~/.config/lumir` 与用户真实 vault 全程未读写）。

| 场景 | 结果 | 断言 | 失败 | 耗时 |
|---|---|---|---|---|
| `01-mermaid-click` | PASS | 9 | 0 | 22.3s |
| `02-math-click` | PASS | 8 | 0 | 22.7s |
| `03-table-ctrl-np` | PASS | 15 | 0 | 28.4s |
| `05-cell-math` | PASS | 8 | 0 | 15.8s |
| `06-callout-and-width` | PASS | 10 | 0 | 23.6s |
| `07-recovery-paths` | PASS | 10 | 0 | 15.0s |
| `07b-recovery-saveas` | PASS | 12 | 0 | 22.2s |
| `07c-external-reload` | PASS | 6 | 0 | 14.5s |
| `08-autosave` | PASS | 6 | 0 | 21.7s |
| `08b-autosave-pause` | PASS | 13 | 0 | 26.7s |
| `08c-crash-recovery` | PASS | 11 | 0 | 31.7s |
| `08d-crash-discard` | PASS | 7 | 0 | 30.9s |
| `08e-force-overwrite` | PASS | 12 | 0 | 21.0s |
| `09-emacs-keys` | PASS | 15 | 0 | 22.4s |
| `09b-keys-config` | PASS | 6 | 0 | 27.6s |
| `12-links` | PASS | 53 | 0 | 52.4s |
| `13-toc` | PASS | 49 | 0 | 49.2s |
| `14-tabs` | PASS | 51 | 0 | 52.6s |
| `16-startup-restore` | PASS | 10 | 0 | 21.3s |
| `17-multi-vault-switch` | PASS | 38 | 0 | 37.0s |
| `18-vault-session-restore` | PASS | 7 | 0 | 18.7s |
| `19-vault-switch-guard` | PASS | 35 | 0 | 27.6s |
| `20-image-fallback` | PASS | 17 | 0 | 14.0s |
| `21-wrap-default` | PASS | 15 | 0 | 22.8s |
| `22-wrap-toggle` | PASS | 17 | 0 | 26.2s |
| `23-image-first-open-width` | PASS | 9 | 0 | 20.8s |
| `24-table-cell-ctrl-e-seq` | PASS | 11 | 0 | 21.7s |
| `25-vault-list-close-keeps-reading-position` | PASS | 26 | 0 | 29.2s |
| `26-svg-scroll-stability` | PASS | 17 | 0 | 33.9s |
| `27-document-end-marker` | PASS | 19 | 0 | 35.3s |
| `28-remember-reading-position` | **FAIL** | 17 | 1 | 40.6s |
| `29-typography-and-zoom` | **FAIL** | 29 | 2 | 68.8s |
| `30-code-outline` | PASS | 38 | 0 | 52.5s |
| `31-code-variable-highlight` | **FAIL** | 27 | 4 | 38.8s |
| `32-list-filter` | **FAIL** | 47 | 1 | 47.7s |
| `33-image-lightbox` | PASS | 36 | 0 | 34.7s |
| `34-restyle-theme-skeleton` | PASS | 16 | 0 | 28.5s |
| `35-restyle-three-themes` | PASS | 16 | 0 | 59.6s |
| `36-restyle-content` | PASS | 14 | 0 | 21.0s |
| `37-heading-hierarchy` | PASS | 11 | 0 | 14.4s |
| `38-content-width-drag` | **FAIL** | 17 | 1 | 30.5s |
| `39-titlebar-identity` | PASS | 19 | 0 | 48.2s |
| `40-table-fullscreen-view` | PASS | 30 | 0 | 38.1s |
| `41-editable-non-md-files` | PASS | 58 | 0 | 51.3s |
| `42-non-md-edit-guardrails` | PASS | 29 | 0 | 33.2s |
| `43-list-tab-indent` | **FAIL** | 66 | 2 | 84.0s |
| `44-theme-live-switch` | PASS | 38 | 0 | 52.3s |
| `45-tab-cycle-keys` | PASS | 44 | 0 | 28.6s |
| `46-dotfile-jsonc-highlight` | PASS | 46 | 0 | 48.9s |
| `47-file-tree-context-menu` | **FAIL** | 80 | 45 | 108.2s |
| `48-vault-registry-migration` | PASS | 17 | 0 | 18.0s |
| `49-vault-switch-feedback` | PASS | 22 | 0 | 26.6s |
| `50-tab-context-menu` | **FAIL** | 24 | 12 | 17.2s |
| `render-markdown` | PASS | 14 | 0 | 18.3s |
| `render-table-degrade` | PASS | 9 | 0 | 13.3s |
| `search-01-find` | PASS | 22 | 0 | 26.2s |
| `search-02-binding` | PASS | 10 | 0 | 27.8s |

**8 条红的一行结论**（详细归因与动作见「待修 findings」的「M256 全量回归现场」）：

- `28` / `38` —— **陈旧断言**：判据是「重启后没有标签（空 vault 引导在场）」，而 M254 移除预览
  机制后标签一律入盘、重启会恢复，空 vault 引导不再出现。非产品缺陷。
- `29` —— **陈旧断言**（同上族）：重启后 `do: open` 命中的是已被恢复的同名标签，`openFile` 对
  同路径短路 ⇒ 「全新装载」前提不成立，渲染行快照是上一轮的。同场景后面先 `⌘W` 再 `open` 的
  同类断言全 PASS 即为指纹。第二处红（末步逐字节比较）未单独定位。
- `31` —— **陈旧断言**：断言「搜索状态跨文件保留」；M254 前是预览标签就地替换（同一个
  `EditorView`），现在新标签 = 新视图 = 空查询。
- `32` —— **陈旧断言**：断言 AX 含 vault 的绝对路径，而 M217 裁决后列表行不再上屏路径
  （`src/vault-switcher.ts:828-830`）。第二个 vault 本身注册正确。
- `43` —— **未定位（need triage）**：编辑器内已缩进、`sleep 2600` 后磁盘仍是旧内容；同一轮里
  有序 / 引用 / 嵌套三条同类断言都落了盘。命令生效而落盘窗口被挤穿的嫌疑最大，但需加长等待 +
  读 `document_save` 诊断日志坐实。**不是** M240 登记的那条 Tab 通道红（M249 已改走 ⌘J 并 PASS 过）。
- `47` / `50` —— **套件通道边界**：`button: right` 取不到窗口截图（M244 / M249 / M251 / M252 /
  M254 同族），右键类断言整段 FAIL 并级联出下游红；判定退回 chromium 层，**不判产品缺陷**。
  `47` 另含一条已知边界（右键目标在视口外）与两条 `empty key DSL` 的套件侧未定位异常。
- 并发污染 / 探针污染：本批**未出现**（串行独占、单实例、起跑前已复核端口与进程）。
  同日的证据目录覆盖问题见「待修 findings」的「套件每次运行都会重写证据目录的索引文件」条。

**M164 批次的套件改动（历史读数，保留原文要点）**：就绪门改判形态 A 的
入口读屏名（`AXPopUpButton`，不是 `AXButton`——写死角色会让整套在启动就超时）、窗口经 `--config`
定位到主屏（否则 macOS 会把窗口放到屏幕外、键盘注入整批不落地）、每场景增清 `workspaces/` 与
`vault-sessions/`、新增 `seed`（注册表 / 会话预置）与第二个合成 vault。**运行纪律**：无人值守批次用
`caffeinate -dimsu <cmd>` 包住（见「多 vault 收口遗留」里的实测现场）；本批另加一条——
`cargo build --features custom-protocol` 之前必须先 `pnpm build`（见「M256 全量回归现场」末条）。

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
8. **M127 崩溃备份链路三条子行为全部覆盖**（本项 2026-09-27 由 M278 收窄：`08-autosave` 与
   `08b-autosave-pause` 断言的是**已移除**的自动保存——2s 落盘与冲突期待决期间的暂停——随 change
   `remove-autosave` 一并删除；「编辑内容不丢」的覆盖由 43/41/42/46 的显式保存断言承接） ——
   ~~`08-autosave`（2s 落盘：磁盘 sha256 变化且内容含输入）；~~
   ~~`08b-autosave-pause`（**冲突待决期间自动保存暂停**：记录磁盘 sha256，跨 2s 去抖再等 7s，磁盘逐字节不变、
   仍是外部版本、冲突提示未消解；前置断言「探测串落在文档末尾 + AX 焦点在编辑器」M140 重做后稳定 PASS）；~~
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
    **M272（2026-09-27）扩面**：判定面从 `Link` 节点扩到 `URL` 节点——**裸 URL 与链接定义行的
    URL 纳入判定面**（含角括号自动链接），三者的装饰、⌘⏎ 激活与「光标触及撤下装饰」由场景
    `54-bare-url-cmd-click` 真机验收；引用点 `[text][ref]` / `[ref]` 与无 scheme 的字面
    （`www.` / 裸邮箱 / `xmpp:`）仍保持原文（半覆盖，如实登记在 change 的边界节）。

14. **TOC 大纲 popover**（M148）—— `13-toc`（17 步 / 32 断言）：masthead 当前位置指示段、
    ⌘⇧O 浮层开合、↑↓ 导航不穿透到编辑器、Enter 跳转后光标恰在标题行尾、空 heading 文档给 toast。
    配色与几何由视觉门禁元素级基线 `toc-popover-chromium-darwin.png` 守。
15. **多标签**（M149）—— `14-tabs`（**51 断言** / 21 步；M238 起由 43 增至 51）：单击预览替换 /
    首次输入或双击固定 / ⌘1–9 直达 / ⌃⇥ 循环 / ⌘W 关当前标签（未命名 dirty 才确认）/
    后台标签外部删除被浮条点名。
    **语义变化（Alex 使用习惯）**：⌘W 从关窗变为关当前标签（菜单「关闭」项保留但无加速键，
    退出走 ⌘Q / 红灯）；有路径的标签间切换不再有 dirty 守卫；切换 vault 升级为任一标签 dirty 即拦。
    **M238（2026-09-26）新增两段**：① 标签**整区可点**——凑满三个标签 + 各点边缘 / 空白区即切换、
    `×` 仍独立（点击可表达的判据在真机，几何与 hit-area 的严格断言在 chromium
    `tests/visual/scenes/m149-tabs.spec.ts`）；② 标签栏**溢出时活跃标签完整可见**——三标签 + 窗口
    收窄到 520（标签栏可视区随之收窄）+ `⌘1` 再 `⌘3` 直达最后一个，真机只留截图证据（本套件读不到
    标签 bbox，矩形判据在 chromium 同一条用例里，含「手动滚走即判红」的反向配对）。
    证据 `test-results/acceptance/2026-09-26/14-tabs/`（51 PASS / 55.5s）。
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
    （35 断言 / 24.2s）：用**外部改写**把 dirty 变成持久状态（M278 之后这一步其实已无必要——
    写盘只由用户的显式动作触发，dirty 天然持久、不被任何定时器清掉；改述见场景 19 的说明段）
    → 点另一行被拦下（D109 点名**当前** vault + 脏标签数，三出口齐全）→ 取消（留在 A、内容不丢、浮条撤下）
    → 同一条文案的第二次请求再次拦下（浮条按文案去重不得复用旧 proceed，M163 r1 P2-1 那条）→
    保存并切换（**保存未闭环 → 不切走** + 沿用既有的「重载 / 保留我的版本」出口，任务 4.2 的原文）→
    放弃修改并切换（切到 B、被放弃的内存改动不落盘、磁盘仍是外部那一版）。
    **未覆盖（套件表达力缺口，已记 `scripts/acceptance/README.md`「已知边界」）**：保存**能**闭环时
    「保存成功 → 继续切换」那条顺路（M278 之前它要求「文档变更后 2s 内发出切换请求」，因为自动保存的
    防抖 2s 会把 dirty 清掉，而键盘注入每键约 250ms 抢不到那个窗口；自动保存移除后这个窗口约束**不再
    存在**，但**场景 19 仍未覆盖该顺路**）。该路径由 chromium
    视觉通道 `tests/visual/scenes/mv-vault-switch-guard.spec.ts`（4 用例，含 `document_save` 写动作级
    判据）覆盖——**不要把 19 的 PASS 读成「三条出口的每条顺路都在真机验过」**。
20. **表格 cell 内 ⌃E→⌃F→⌃E 不再跳回前一 cell**（M185，2026-09-20/21）—— `24-table-cell-ctrl-e-seq`：
    cell 内 ⌃E 到内容尾 → ⌃F 越过闭合管道符落进下一 cell → 再按 ⌃E 应停在**当前** cell 内容尾
    （修复前会跳回前一 cell 尾部）。判据形态：序列后键入 `x`，断言它落在正确的 cell
    （AX 逐 cell 落点不可回读，用插入字符的归属反推光标位置）。证据
    `test-results/acceptance/2026-09-20/24-table-cell-ctrl-e-seq/`；2026-09-21 在 master `b82834e`
    （含 M189 完读标记）复跑仍 PASS（24.5s）。
21. **vault 列表 ESC 收起保持阅读位置**（M186，2026-09-20/21）—— `25-vault-list-close-keeps-reading-position`
    （真机 PASS 三次 / 22–29s）：⌃V 滚到长文档尾部 → 打开 vault 浮层 → Esc 收起 → 断言渲染行仍在尾部。
    **如实标注：该缺陷在 chromium 与真机均未复现**（修前跑同场景也 PASS），修复是结构性的
    （收起 = 取滚动快照 → 聚焦 → 写回，走 `scrollSnapshot()` + dispatch）；场景末尾带 ⌘/ 键位面板与
    ⌘F 搜索面板两条对照步骤（同样修前修后都 PASS）。唯一未覆盖现场：触控板滚动 + 编辑器从未聚焦
    （套件造不出）。证据 `test-results/acceptance/2026-09-20/25-vault-list-close-keeps-reading-position/`；
    2026-09-21 在 master `b82834e`（含 M189 完读标记）复跑仍 PASS（27.4s）。
22. **svg 倒序滚动终态稳定**（M187，场景修复 M190，2026-09-21）—— `26-svg-scroll-stability`
    （17 断言 / 真机 PASS 两次，merge `e06f295`）：正向翻屏过大图（渲染、几何进会话记忆）→ 到底
    （widget 销毁、节点缺席）→ 倒序三屏回到大图（重建在场、不在加载中、图片行仍被装饰）→ 停手
    一拍终态稳定。同一匹配器在 起点(不在)/三屏(在)/到底(不在)/倒序(在) 四态断言，负向不空转。
    **这是该场景的出生首个真机 PASS**（M187 时未起真机只过 `--check`）；首跑 FAIL 两条均为场景
    设计误差（图片在初始渲染视口内、「AX 含 svg 滚动夹具」只在冷渲染 AXGroup 形状成立），M189
    与 M187 产品代码均无缺陷（M190 三分支判别，`test-results/m190/M190-root-cause.md`）。
    **两条通道语义坐实**（后来者写场景的硬知识，已写进场景说明）：① `AXTextArea.value` = CM
    **当前渲染区间**（可见区 ±1000px）的 DOM 文本，不是整篇——且渲染区间 == 装饰区间，「装饰前
    源码可见」在本通道结构性不可达；② 带 `<text>` 的 svg 在 AX 里的形状（AXImage 叶子 vs
    AXGroup 含子文本）由 WebKit 曝光时机决定、夹具稳不住——终态可见性只能判「节点在场 + 几何归
    chromium 层 + 截图」。场景 25 说明与 M148 finding 条目里「value 是整篇文本」的错误口径已随
    本批订正。判别性验证（瞬态）仍在 chromium 层 `tests/visual/scenes/m187-image-scroll-stability.spec.ts`。
    证据 `test-results/m190/26-pass-2026-09-21/`、`test-results/m190/batch-2026-09-21/`（24/25/26/27
    同批 4/4 PASS）。
23. **文档末尾完读标记**（M189，2026-09-21）—— `27-document-end-marker`（**14 断言** / 30.2s，
    master `b82834e` 真机 PASS；断言数订正于 M208 归档节点 2，ground truth =
    `test-results/acceptance/2026-09-21/results.json`）：长文档（超一屏）末尾出现「到底了」节点、短文档（装得下）不出现
    （同一匹配器，非恒真）、文档文本纯度与磁盘逐字节不变。**覆盖边界（场景说明已写）**：这条 AX
    通道不给纯文本节点 bbox，「可见性」不在真机通道判——真机只判节点在场/缺席 + 纯度，可见性由
    chromium 几何断言（`tests/visual/scenes/end-marker.spec.ts`）+ 截图承担。反向验证（判据改成
    恒不显示 → **2/14** 红）留档 `test-results/m189/acceptance-27-reverse-fail/`。证据
    `test-results/acceptance/2026-09-21/27-document-end-marker/`。归档为
    `openspec/changes/archive/2026-09-25-document-end-marker/`（2026-09-25 节点 2）。
    **M238（2026-09-26）三处变化**：① 可见文案由「到底了」改为「**— End —**」（Alex 裁决，
    场景断言与说明同步改；deck D114 两列同形）；② 挂载改为推迟到 CM 测量周期之外（一帧落地，
    双帧实测会把阅读位置恢复推离 13px，见 `tests/visual/scenes/reading-position-probe.spec.ts`
    的 §7-3）；③ 正文行的尺寸口径与标记在场解耦（`minmax(max-content, 1fr)` + 行尺寸口径不再由
    scroller class 键控），位置不变量的判据落在 chromium 层新增的两条用例（跨判据两方向翻转 +
    「行尺寸口径不得由 class 键控」回归探针，修前实测红：`|markerTop−contentBottom| = 1369.7`）。
    复跑读数 `test-results/acceptance/2026-09-26/27-document-end-marker/`（14 断言 / 27.7s PASS）。
    **M251（2026-09-27）两处变化**：① 可见文案**去掉破折号**改为「**END**」（Alex 裁决；deck D114
    两列同形照旧），本场景的匹配器（`AXStaticText = "END"`）与说明同步改；② 修掉「**非 md 文件里
    标记漂在正文右侧空白区**」（Alex 真机报告：`.gitignore` / `NOTICE` / `lefthook.yml` 等）——
    根因是**模式切换的历史**：md → code 的 `EditorView.setState` 里插件确实被 `destroy`、元素当场离场，
    但**销毁前排进 CM 测量队列的请求在销毁后照常执行**（CM 的 `requestMeasure` 没有取消口），
    那一趟走回插件的 `write` 排下新的一帧，帧回调把元素挂回 `.cm-scroller`；此时 state 已不含该插件，
    元素成了孤儿——而 code 模式的 `.cm-scroller` 同样是三列 grid（行 1 前两列被 gutter 与正文占住），
    孤儿没有 md 那套定位声明，自动落位到第 3 列，于是显示在正文右侧的空白列。修法是**生命周期守卫**
    （`src/preview/endMarker.ts` 的 `destroyed` 标志 + `schedule`/`apply` 守卫），不变量是
    「元素在场 ⇔ 当前 state 装配了该插件且判据成立」；**不变量级的矩阵属性测试**在 chromium 层
    （`end-marker.spec.ts` 的「M251 属性」用例扫 源模式 × 目标模式 × 打开方式，修前实测红：
    `dblclick end-marker-long.md → end-marker-code-long.txt` 处 `Expected 0 / Received 1`）。
    证据与前后图见 `test-results/m251/`；**真机复跑读数：19 断言 / 0 FAIL / 32.2s**（本场景由 14 断言
    增至 19，证据 `test-results/acceptance/2026-09-27/27-document-end-marker/`，新增那一步的截图
    `shots/03-非_md_文件_标记应已离场_.jpeg` 可直接肉眼复核：code 模式 + 正文列干净、无游离标记）。
    首跑在新增那一步 FAIL 的现场与成因（`open` 的目标文件名排序靠后 → 树里那一行不在 AX 可达范围内）
    登记在场景的「已知边界」，原始日志 `test-results/m251/acceptance-27.log`。
24. **restyle 主题通道与骨架落位**（M213，2026-09-25）—— `34-restyle-theme-skeleton`：
    `ui.theme: "eink"` 经**配置通道**（front-matter 的 `config`，与 `font_size` / `[keys]` 同形）
    起一个实例 → 断言 `env:config.json` 里确实是 `eink`、应用起得来、骨架与信息落位三点各自在场
    （侧栏头 vault 入口 / modeline 文件路径 / modeline 右段「Markdown · N 行 · UTF-8」）、
    **旧 masthead 的独有 AX 指纹**（vault 名与路径合并成的那一条 `AXStaticText`）不出现、
    整轮前后验收 vault 文件 sha256 与 mtime 不变。**覆盖边界（场景说明已详述）**：本套件无计算属性
    通道，eink 的色值/对比只能给截图（手眼项）；主题接线由 chromium 场景
    `tests/visual/scenes/restyle-theme.spec.ts` 守。见「待修 findings」的「真机套件没有计算属性通道」条。
25. **三主题真机呈现 + overlay 标题栏窗口级读数**（M213，2026-09-25）—— `35-restyle-three-themes`：
    `light → dark → eink` 各走一次 `configWrite`（默认重启）+ 截图，三步各自断言配置里就是该主题、
    上一步的主题已被覆盖（「读到 dark」≠「读到任意一份 config」）；末步落一张带 `AXTabGroup` /
    文件树节点的读数截图，供标题栏与 traffic 灯位核对。**标题栏的三项窗口级证据**（traffic 灯原生绘制、
    标题文字不显示、栏区可拖拽）不在断言里——真机截图 + 拖拽前后的窗口 bounds 读数落
    `test-results/m213/titlebar/`，判定归 Alex（手感/审美不下沉）。
26. **主题运行期切换**（M237，2026-09-26，change `live-theme-switch`）—— `44-theme-live-switch`
    （**34 断言 / 55.5s**，证据 `test-results/acceptance/2026-09-26/44-theme-live-switch/`：
    `steps.md` + 8 张截图 + 8 份 AX dump）：⌘⇧T 连按三次走完 `light → dark → eink → light` 的循环、
    再点 modeline 主题钮推进一档，**每档**断言当时主题（读数是 modeline 主题钮的 AX 文本
    `AXButton (主题：{主题名}（点击切换）)`，实测 dump 见 `ax/08-重启-首帧.txt:81`）与
    `env:config.json` 的 `[ui] theme` 已写回、上一档已被覆盖；含 mermaid 块的文档切换后断言块
    重渲完成（源码仍不在编辑器文本里、不残留 pending 占位、不降级）；末步重启实例断言首帧即最后
    切换的那一档（持久性闭环）。**反向验证**（判据换成必须 FAIL 的输入实测 3/3 红：主题没切 /
    mermaid 源码可见 / 配置未写回）：`test-results/m237/reverse-validation-acceptance.log`。
    **覆盖边界（场景说明已详述）**：本套件无计算属性通道，色值 / eink 九条降级 / mermaid SVG 内联色
    这三类**视觉取值**真机判不了——它们由 chromium 场景 `tests/visual/scenes/theme-live-switch.spec.ts`
    （8 条，含 4 条反向验证）守；指示钮的「是哪一档」与「看起来对不对」是两件事，本场景只判前者。
27. **文件树条目右键菜单的 M251 增量：命中面与作用行高亮**（2026-09-27，M251，change
    `file-tree-context-menu`）—— `47-file-tree-context-menu` 新增一步「右键点在行的空白区（名字右侧、
    行盒右缘之内）也作用于该行」。三件事逐个登记：
    ① **右键目标行 = 菜单作用行**：命中判定从每行元素提升到**树容器**（`src/tree.ts` 的 `rowLiAt` +
    纯函数 `rowBandHit`）：行元素内任意横向位置、以及**行元素右缘到面板右缘之间那条带**
    （`.filetree` 的右内边距，实测 ~9px）都作用于该行；树头部 / 面板空白 / 编辑中的行照旧不参与。
    真机侧判「名字右侧的空白区」（`dx` 比例落点），**右内边距那条带只在 chromium 层判**（真机坐标
    通道只能表达节点 bbox 内的比例，越界那条带无法按比例表达；判据在
    `tests/visual/scenes/tree-menu.spec.ts` 的「M251：右键落在行右侧的空白带也作用于该行」，
    按容器 bbox 实测）。修前实测：同一落点 `menu=false`（旧监听在行元素上）。
    ② **作用行高亮**（`is-menu-target`，只在菜单开着时在场）：**真机侧只能给截图**（套件无计算属性
    通道，与第 26 项的边界同因），取值判据在 chromium 层两条用例（在场/离场 + 同指针位置对照 +
    eink 黑底反白）。形态是 tower 裁决的 A 形态（不改树的选中语义、不动 tab）。
    ③ **两张菜单基线出现 23px 真实差异（未重建，待裁决）**：新高亮让菜单左上角圆角处透出的底色变化，
    零容差读数见 `test-results/m251/baseline-review/tree-menu-menu-target/`（含前后图与差异图）；
    新 UI 的观感是 Alex 的人肉裁决点，因此没有跟着重建。
    **本批真机执行情况（如实登记，不读成「真机已验」）**：场景 47 在本机**卡在第一条右键步**——
    `button: right` 的坐标路径要求一张窗口截图，KimiCU 本机取不到（`取不到窗口截图，无法用 right 键在
    坐标上点击`），其后依赖菜单节点的步骤级联失败（原始日志 `test-results/m251/acceptance-47.log`；
    与 M244 / M249 的同一现场同因，是通道限制不是产品缺陷）。所以 ①② 的**真机判据本批未取得**，
    判定全部由 chromium 层承担（两条 M251 用例，含「删掉容器级命中即红」的反向验证）。

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
  三份 living spec 的 Purpose 补了归属记录（`vault-workspace` / `toc-outline` / `keymap-commands`）。**顺带修正的失效指针**：`docs/backlog.md` 第 10 条指向的 `openspec/changes/multi-vault-workspaces/specs/...` 与第 12 条指向的 `openspec/changes/startup-restore-off-main-thread/design.md` 已改为 living spec / archive 路径；另有两处同类失效指针在 `scripts/acceptance/scenarios/13-toc.md:224` 与 `16-startup-restore.md:34`（本 mission scope 外），已投 finding（**M175 已闭合**：两处改指 `openspec/changes/archive/2026-09-18-*` 实际路径）。**追踪闭环（同日补记，M181）**：本条第 1 行记的「活跃 change 只剩 3 个」随后清零——那三个 change 同日由 M181 归档节点 2 归档，核销记录见本节 2026-09-18 的「另三个 change 归档核销——活跃 change 清零」条；`validate --all --strict` 从本条记录时的 17 项（3 change + 14 spec）落到 14 项（0 change + 14 spec）。
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
- 2026-09-18：**另三个 change 归档核销——活跃 change 清零**（M181 归档节点 2；Alex 拍板原话「归档」）——`image-svg-and-fallback` / `codeblock-toml-yaml-highlight` / `line-wrap-options` 三个已合并未归档的 change 本次一次性归档。归档前后实测：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 由 **17 passed / 0 failed（3 个活跃 change + 14 份 living spec）** 变为 **14 passed / 0 failed（0 活跃 change + 14 份 living spec）、退出码 0**；`openspec list` = 「No active changes found.」（无 `✓ Complete` 残留）；`scripts/docs-check.sh` PASS（ADR 6 份 + README 索引）。三项对账结论：
  ① **`image-svg-and-fallback`**（M165 提案 merge `fe46310` → M178 实现 merge `e471b88`，r1 clean）→ `openspec/changes/archive/2026-09-18-image-svg-and-fallback/`：tasks **全部勾选、无放弃项**；`attachment-display` 落 **2 条 MODIFIED + 2 条 ADDED**（`openspec archive` 报 `+ 2, ~ 2, - 0, → 0`），逐 requirement 与 delta 字节比对**全部 EXACT**，living 的删除行只落在两条被 MODIFIED 的 requirement 内部（零误删、零未申报改动）；实现与 delta 一致（`src/preview/attachments.ts` 的 `ImageWidget`：`<img>` 是图片链路唯一渲染路径、尺寸兜底是主修法、三种引用形态共用同一条终态处置且无扩展名特判），**无实现期静默扩 scope**。节点 1 裁决 A（图片行维持现状、不加选区显露）落账不动，第 19 条**保留、不核销**；第 18 条外链直连分支的 (a)/(b) 处置权仍在 Alex，不在本次归档范围。
  ② **`codeblock-toml-yaml-highlight`**（M167 提案 merge `ef8f596` → M179 实现 merge `485dba5`，三轮评审 r3 clean @`8710036`）→ `openspec/changes/archive/2026-09-18-codeblock-toml-yaml-highlight/`：tasks **27/27**（2.3 / 3.8 标注放弃原因——裁决点 2 = 方案 A 不实现；归档期三条 5.2 / 5.3 / 6.5 本次在归档件里逐条收口）；`editor-live-preview` 落 **1 条 MODIFIED + 1 条 ADDED**（`+ 1, ~ 1, - 0, → 0`），逐 requirement 字节比对 EXACT——**「Markdown 渲染保真」的「已知例外」段并入后并列 rust 与 toml 两条**（归档前只列 rust，这正是本 change 要补的那格），另两条 M138/M152 既有行为的 spec 回填（语言表同源 / 长度上限）也在位。实现期两处订正（5.4 把「带引号的键」从 MUST 收成边界 scenario、3.7 的整页容差 958/960 → 0.0005）都已在 delta 与 design §5/§6 落定，无静默扩 scope。toml 的 `atom` 复用缺陷作为**记录在案**留在本节（见「记录在案」节的条目），本次不修。
  ③ **`line-wrap-options`**（M166 提案 merge `bda4fe4` → M180 实现 merge `9a15a65`，两轮评审 r2 clean @`d5e860f`）→ `openspec/changes/archive/2026-09-18-line-wrap-options/`：tasks **54/56**（9.4 / 9.5 按**如实标注的覆盖边界**保留未勾——sha256 逐字节口径下无 mtime 断言词汇、真机无计算属性通道，按节点 2 口径接受为边界，不当缺陷也不冒称已验；9.2 由 tower 复裁决收口：`scripts/acceptance/lib/execute.mjs` 的 1 行 scope 外改动理由成立、scope 已扩纳入）；`editor-live-preview` 落 **3 条 ADDED**、`keymap-commands` 落 **1 条 ADDED + 3 条 MODIFIED**（`+ 4, ~ 3, - 0, → 0`），两份 delta 的 7 条 requirement 逐 requirement 字节比对 EXACT、零误删（living 的删除行只落在三条被 MODIFIED 的 requirement 内部，含「表格滚动容器」→「块级横滚容器」泛化与命中条件收紧两处申报过的修订）；D1–D5 五件裁决与 proposal 的「裁决记录」节一致，四件制品已改写为应用级语义（grep 无标签页级残留）。**无实现期静默扩 scope**。
  **归档动作的配套收尾**：① 三个 archive 目录内的相对链接各补一层 `../`（`openspec archive` 把目录移深一层却不重写制品内链接，这是本节「openspec 归档制品与实验脚本」记过的根因）——三个目录共 20 条相对链接逐条用「拼到制品所在目录再 `exists()`」实测，**19 条补一层后可达、1 条为 spec 正文里的示意例子**（`specs/attachment-display/spec.md` 的 `./assets/shot.png`，按 M155 坐实的误报形态排除、不改）；② `scripts/acceptance/scenarios/20-image-fallback.md:76` 指向旧 change 目录的指针改指 archive 路径。`src/preview/attachments.ts:253` 的同型指针在 mission scope 外，已投 finding 不在本次改。**三个 change 均未新建 capability**（落点全在既有 living spec），故无 Purpose 占位待补。

- 2026-09-24：**五个 change 归档核销——活跃 change 从 8 降到 3**（M205 归档节点 2；Alex 逐件确认五件全部
  归档，另下两项裁决：① code-outline delta 的缓存条款改措辞为「缓存身份 = 文档内容」（实现零改动）；
  ② list-filter 的「失效行参与筛选」scenario 改写为「SHALL 出现在结果集里但 MUST NOT 进入键盘游标空间
  （与筛选前一致）」，删去 Enter 句）。**归档顺序是硬约束**：`typography-and-zoom` → `code-outline` →
  `code-variable-highlight` → `list-filter` → `remember-reading-position`——code-variable-highlight 的 delta
  明文引用「代码文件的结构解析（语言分层注册表）」这条 requirement（它只由 code-outline 引入），`validate`
  不查这类引用，先归后者才不会有悬空引用。**归档前后实测**：`validate --all --strict` 由
  **22 passed / 0 failed**（8 活跃 change + 14 living spec）逐件降到 **18 passed / 0 failed**（3 活跃 change +
  15 living spec）、退出码 0；`bash scripts/docs-check.sh` = PASS（ADR 6 份 + README 索引双向一致）；
  `openspec list` 里五件均已移出活跃列表。**五件的落点**：typography-and-zoom → **新建 living
  `openspec/specs/typography/`**（ADDED ×4，`## Purpose` 已按 toc-outline 的句式手写替换 `archive` 生成的
  TBD 占位）+ `keymap-commands` 1 条 ADDED；code-outline → `editor-live-preview`、`toc-outline` 各 1 条 ADDED；
  code-variable-highlight → `editor-live-preview` 2 条 ADDED；list-filter → `toc-outline` 2 条 ADDED +
  1 条 MODIFIED、`vault-workspace` 1 条 ADDED；remember-reading-position → `multi-tabs` 1 条 ADDED、
  `vault-workspace` 1 条 ADDED + 2 条 MODIFIED。归档后逐条核对：五件的 requirement 名在各自 living spec 里
  各出现**恰好一次**（无重复并入）、六份 living spec 的 `## Purpose` 补齐了新并入 change 的归属记录。
  **归档动作的配套收尾**：① **相对链接 108 条逐条实测**（脚本：把每条 `](相对路径)` 按制品所在目录拼出
  绝对路径再 `exists()`）——**0 条不可达**；本次改动到链接**目标**的共 **46 处**（逐件：typography 3 /
  code-outline 19 / code-variable-highlight 18 / list-filter 3 / remember-reading-position 3；口径是
  「新旧文件的相对链接目标做多重集差」实测，不按行数估），分两类：「把相对路径改深一层（补 `../`）」
  **24 处**（typography 3 / code-outline 10 / code-variable-highlight 5 / list-filter 3 /
  remember-reading-position 3——其中 2 处是两个 evidence/01 的 `../../../../REVIEW.md`：survey 判它「已正确、
  无需改」，归档后实测还差一层，**实测捞回**）、「把目录名改指归档名（跨 change 与自指 1 处）」**22 处**
  （code-outline 9 / code-variable-highlight 13，其中 1 处是 code-variable-highlight 的 evidence/03
  把 `[code-outline]` 链到了自己的 proposal）。
  **M181 记过的失效模式在本批的形态**：survey 只数了「需要补层的」与「跨 change 的」，漏掉的正是
  4 层变 5 层这类**深度换算错**——所以本批以脚本实测为判据，不认清单。② 一批数字/指针订正（详见第 22–26
  条与「文档指针与门禁清单」节）；③ 五件归档件内**零**声明式扩 scope：所有文本改动都是「与实现/磁盘对齐」
  或按裁决改措辞，实现侧零改动。**未做的（如实声明）**：M195 的两张 typography 基线、M198 的一张
  var-highlight 基线在归档件里仍标「待 Alex 过目」——本批没有可引的过目记录，标注按原样保留未擅改；
  `src/` 侧的失效注释指针与仓内其余旧路径指针按 scope 登记进「文档指针与门禁清单」节。
  **r1 评审（2026-09-24，p2-2items / fix-then-merge）的两处修复**：① `code-outline` 归档件的 `design.md`
  §1.6 缓存矛盾句**首轮漏改**（backlog 与 review-request 都自报已改，实际 diff 为零——「自报改了、diff 为零」
  正是 REVIEW.md 第 7 条的同族形态），已按 `code-variable-highlight` 的同型口径补齐并加归档标注；②
  `list-filter` 的裁决②首轮只改了 scenario，同一 requirement **正文**（delta 与 living 两处）仍留
  「`Enter` 与点击的动作 SHALL 保持现状」的 Enter 半，已按裁决删 Enter 半、保留点击半（点击那半由
  `tests/unit/vault-switcher.test.ts` 覆盖）。两处均在 r1 修复提交里改准，backlog 第 23/24 条的核销表述
  按实情对齐。
- 批次三：键位分发三轨并行 + 扩展名注册表漂移（M130/M131/M132）；save-ipc.ts 折回 ipc.ts（M132）；Ctrl-K/D/T 原生路径风险（M132）。
- 批次二：DeepSeek Flash 试用结论——可做 build，review 环节（k3-256k）不能省。

- 2026-09-25：**表格首列字重 550 静默失效（`td:first-child` 撞 CM 的 widgetBuffer）修复**（M213，
  tower 收编）：`src/style.css` 的 `.cm-lp-table-row:not(:first-child) .cm-lp-table-cell:first-child`
  永不匹配——CM6 会在行内自动放置 `img.cm-widgetBuffer` / 占位 span，它们可能落在第一个 cell **之前**，
  于是「首列 550」（tokens 文档的 td 层次档）整条静默失效（M212 reviewer 独立复现；M212 探针先发现）。
  **修法**：判据改**列索引**——`[aria-colindex="1"]`（装饰层按列写死、与 DOM 子节点次序无关，
  且它同时是读屏的列号语义，两处同源）。**闭环断言**：`tests/visual/scenes/restyle-content-types.spec.ts`
  的「表格」条按列号取首列断言 550（旧 CSS 下该断言恒为 400 ⇒ 红）。**连带影响（如实登记）**：首列 550
  让 cell 的 `min-inline-size: 7ch` 略微变宽（`ch` 随字重变），原本「贴合不横滚」的 fixture 会掉进
  「横滚」档——`m119-table-width.spec.ts` 的欠宽用例把填充字数从 34 收到 30 以留在同一判据档内
  （用例守的合同不变，见该处注释）。
- 2026-09-25：**restyle R3 收尾：场景与真机验收场景全量改写**（M213，`feat/restyle-r3-scenes-acceptance-closeout`）：
  ① `tests/visual/scenes/**` 的既有断言随 token 层/R2b 渲染层迁移（`.masthead-*` → `.modeline-*` /
  `.ft-vault-name`，callout 图标体系退役 → `.cm-lp-callout-type`，旧色字面量 → `--tk-*` / `--border-soft` /
  `--code-bg`，栏宽 80% → 定值 664 且「栏宽」改为读 `.cm-content` 的**内容盒**，typography 的基准
  16px/1.75/.85em → 15px/1.7/.9em）；② 新增四个场景：`restyle-theme`（三主题 + tasks §1.2 的三条判据）、
  `restyle-skeleton`（骨架几何 / 信息落位 / 标题栏空态）、`restyle-eink`（eink 九条逐条）、
  `restyle-content-types`（表格首列 550 / 代码块头部条 / 引用 / 列表）；③ 视觉桩补 `ui.theme`
  注入通道（`tauri-stub.ts`）并同步 `font_size` 出厂值 16→15；④ 真机新增场景 `34` / `35`（见「待真机验收」）。
  **口径**：新场景不新增像素基线（实现期禁止零碎基线动作），三主题的截图证据走 Playwright 的
  `info.attach` 产物（`tests/visual/test-results/`，git 外）。
- 2026-09-25：**backlog #27 / #31 核销**（M213）：#27 补 `typography` 的 MODIFIED delta ×4（16px → D1 的
  15px 锚 + 新 token 名），#31 由 R2b 修 `.cm-lp-end-marker` 的字号基准 + M213 补「正文放大后标记随之缩放」
  的双档门禁断言。两条的详细落点见各自条目。
  （2026-09-25，M220 补记：本条之后原本紧接六条 restyle findings，且第一条（mermaid）与「各自条目。」
  挤在同一行没有分隔。那六条是**进行中的 findings**（待立项 / 待裁决 / 待修），与本节「已核销」的语义
  相反，已按维护规则迁到「待修 findings（不阻塞）」的「restyle 追加修复批」小节；本节的语义恢复为
  「进来的是已核销条目」。）

- 2026-09-25：**`.cm-lp-quote-line` 的 `padding-left` 声明无消费者（引用块文字贴竖线）核销**（M213 登记，
  M218 任务 C4 修复，tower 收尾）：CM baseTheme 的 `.cm-line { padding: 0 }` 与引用行规则同等特异性、
  注入更晚，实测计算值 0px。修法 = 双类选择器 `.cm-line.cm-lp-quote-line` 提权到 14px（定稿
  index.html:293）。**核销判据（合并后实测，非「分支上有提交」）**：M218 merge `456ee47`，探针三主题
  实测 `paddingLeft` 计算值 = 14px（255/255 中逐项），reviewer-fix-content r1 独立复跑一致。
- 2026-09-25：**mermaid 不随主题（dark 连线对比度 1.07 / eink off-palette 淡紫）核销**（M214 finding，
  M219 任务 C10 修复，tower 收尾）：静态 MERMAID_CONFIG 拆为 initialize 时读 `getComputedStyle` 的
  token 计算值（`theme: "base"` + themeVariables），TS 侧零硬编码色值，单一真源 = style.css 三组
  `:root[data-theme]`。**核销判据（合并后三主题实测取色，三份不再相同）**：M219 merge `7208867`，
  dark 连线/箭头对比度 1.07 → **10.45**、eink 全 #000 对比度 21 且填充 transparent（淡紫消除）、
  light 连线 14.44 / 描边 5.02——reviewer-fix-mermaid r1 重建 dist 独立复跑逐项一致；两个 mermaid
  视觉场景 fail 坐实为 pre-restyle 旧基线漂移（delta 严格限定 SVG 区，master 同跑同红）。
- 2026-09-25：**段落间距 / 标题间距未按 tokens 间距阶梯落地核销**（M212 finding，M218 任务 C1 修复，
  tower 收尾）：间距阶梯全量值（段落 8 / h1 24-9 / h2 20-6 / h3 16-5 / li 2 / hr 20，M216 gap 报告
  §2.3 #1）落进 livePreview.ts 分隔行高度与 theme.ts，替换旧基线魔术数；代码块邻接外距 4 上/12 下
  经 tower 裁决同走分隔行通道（CM heightmap 对 margin 不可见，M110 缺陷 1 同族）。
  **核销判据（合并后实测间距读数）**：M218 merge `456ee47`，探针三主题逐项对照 gap 表全量值
  255/255 PASS，reviewer-fix-content r1 独立复跑一致。**已接受取舍（reviewer r2 落 checks）**：
  CM 无 margin 折叠，段落→标题 ≤8px、代码块→标题 ≤12px 偏松；li 下缘 2px 放弃（末 item 无机制）。
- 2026-09-26：**验收套件 `--config` 静默丢掉 `app.windows[0]` 窗口级配置**（原「待修 findings」medium 条，
  M213 登记 → **M236 修复**）：Alex 在自测实例截图里看到「两行标题栏」，根因即此——`pnpm tauri dev
  --config` 的深合并对**数组按下标整体替换**，`app.mjs` 里手抄的 `{title,width,height,x,y,focus}`
  把 `titleBarStyle: "Overlay"` 与 `hiddenTitle: true` 静默吃掉，套件实例因此长出原生标题栏
  （webview 让出 32pt、屏幕上出现窗口标题「Lumir」），**全程零报错**。落点：
  `scripts/acceptance/lib/app.mjs` 的 `launchApp` 改成从 `src-tauri/tauri.conf.json` 读
  `app.windows[0]` **原件再 spread**、只叠 `x/y/focus`（窗口配置单一真源，REVIEW.md 第 8 条；
  读不到窗口对象直接抛错，不回落手抄）；`lib/drive.mjs` 的 `waitAppReady` 就绪点上加
  `assertOverlayChrome`（`AXScrollArea` 顶边与高度对 `AXWindow` 的差 >4px 即 FAIL 并点名成因，
  `restart` 后重启同样过）；`scripts/acceptance/README.md` 补自检与配置侧纪律。
  **判据（tower 验收口径）**：修后 AX 读数 `AXScrollArea @0,0 1152×768` 与窗口重合（修前
  `@0,31 1152×737`）；套件实例截图单行 tab 栏、红灯叠在 tab 栏上，无原生标题栏行。
  **反向前置验证**：把 `windows` 临时改回手抄写法跑场景 39 → 自检报「顶边差 32、高度差 32」如实 FAIL
  （证明自检有区分度，也坐实该 bug 真实存在），改回 spread 后场景 39 **1/1 PASS**。
  证据：`test-results/m236/baseline-review/backlog366-before-after/`（修前/修后截图 + AX 各两份）、
  `test-results/m236/reverse-probe-backlog366-buggy-config.log`、
  `test-results/m236/acceptance-39-backlog366-fixed.log`。
  **连带修正**：本修复让全量场景从「非 overlay」切到「真 overlay」（视口 768 → 800），凡把视口高度
  烘进断言的场景都要重算——扫描后只有 `scripts/acceptance/scenarios/33-image-lightbox.md` 烘了绝对坐标
  （三条读数按 `水平 40+(1120-w)/2`、`垂直 40+(720-h)/2` 重算，场景内写明推导）。

- 2026-09-27：**文档合同卫生批（M250）**（`feat/docs-contract-hygiene-m250`）：living spec 路径同步 +
  changeFilter 文字面清扫 + 场景 39 悬案入 `REVIEW.md` + `tab-cycle-keys` 任务对账，四件。
  ① **living spec 路径同步**：M248 的注册表更名（`workspaces/` → `vault-registry/`，merge `d989197`）
  此前只在代码与 `docs/specs/config-reference.md` 落地，living spec 仍写旧名——新增 change
  `sync-vault-registry-dir-spec`（MODIFIED ×1：路径字面 + 迁移口径 + 新增迁移 scenario，其余条款逐字
  携带）并同批把 delta 应用到 `openspec/specs/vault-workspace/spec.md`；两侧同名 requirement 正文
  `sha256` 相同（`0856d8db…`）⇒ 归档是幂等替换。`validate --all --strict` 28/28。节点 2 待 Alex（「待 Alex
  裁决」第 38 条）。② **changeFilter 文字面（scope 内）**：改掉 `src/editor.ts:896-899` 的过期 doc（原称
  「`changeFilter` 的拦截闭包读 `mode`」，M241 后闭包读 `currentEditable` 投影），并核 `:1434` / `:1501`
  两处兜底正文已与真实机制一致。**tower 2026-09-27 裁决把 scope 扩入** `openspec/changes/editable-non-md-files/**`
  与 `openspec/changes/list-tab-indent/design.md`（两处失实断言最集中的落点），按「不改写历史结论原文、只加更正
  注记」落：`editable-non-md-files` 的 `design.md`（§2.2 末节 + 「四处窄门」句）与 `proposal.md`（§2 的 P1 清单 +
  裁决点 D3 表行 + 「按文件类」条）各一条注记、`list-tab-indent/design.md`（「任何绕过 DOM 的程序化 dispatch 都会
  被拦」+ S6 行）一条注记。**转 M249 两处**（与 M249 的活 scope 同文件，避免 merge 撞车）：
  `scripts/acceptance/scenarios/43-list-tab-indent.md` 的两处「changeFilter 再兜一层」由 M249 顺手落，**不计为
  本批缺口**；`tests/visual/scenes/m130-text-open-trap.spec.ts:19` 的注释经复核**判为准确**（说的是当前返回
  `false` 形态下漏同步 `syncProjection` 会吞键），无需改。**独立复现**（`@codemirror/state` 6.7.4 探针）：
  `changeFilter` 返回 `[]` 时 change 照常落地、返回 `false` 才拦——与 M241 的
  `test-results/m241/reverse-input/README.md` 一致。
  **M101/M97 复盘结论**：M97 的只读结论**确实只靠旧 changeFilter 成立**（M101 的提交自述逐字：「M97 只靠
  changeFilter 在事务层拒绝，contenteditable 恒为 true，真实 WKWebView 的 AX 注入 / IME 组合路径下 DOM
  回滚不可靠，文本滞留内存并误标 dirty」）；该缺口已在 M101 当年闭合（视图层 `editable(false)` /
  `readOnly(true)` 拒收 + 真机复验 + `tests/visual/scenes/save-guard.spec.ts` 四场景），M241 把该行改成
  `false` 后 dispatch 层兜底才第一次真实存在（判据 = m130 的切标签序列用例 + m241 探针）。**逐仓复查未发现
  任何以「changeFilter / 程序化 dispatch」为目标的验收断言**（`tests/**`、`scripts/acceptance/**` 里
  `changeFilter` 只出现在注释中）⇒ **无需要补的真判据**；清扫的逐处结论见「待修 findings」的「文档指针与
  门禁清单」节。③ **场景 39 mousedown 悬案**：依 finding
  `20260926-worker-fix-pack-improve-39-mousedown-preventdefault` 收进 `REVIEW.md` **第 16 条**（四段式，
  根因照录「未定位」+ 候选机制，未虚构因果）。④ **`tab-cycle-keys` 任务对账**：11 个未勾项里 10 项对照
  master 已合并实现（`c672be7`）逐条核实属实并勾选（键位表两条绑定 + 两条 doc + 文件头 M242 留痕 / 单测
  定点断言与 token 形态专测 / spec 对账无偏差 / 场景 45 与真机 2/2 PASS），第 11 项（§5.1 归档评审核对）
  如实不勾——它是节点 2 的动作。证据：`openspec/changes/sync-vault-registry-dir-spec/**`、`REVIEW.md`
  第 16 条、`src/editor.ts` 注释、`gate quick` 9/9 PASS（SKIP 1 = `tsc-visual` 依赖未装）、单测 375/375。

## M282（change `ui-language-i18n` 实现批，2026-09-28）遗留

- ~~**后端错误文案的参数面（D6 的后半）未落地**~~ **2026-09-28 已闭合**：`CommandError` 加 `params`
  （空时不序列化）+ `param(k, v)` 链式构造；35 处构造点按「模板里的 `{name}` 就是 Rust `format!` 的
  内联变量名」补参数（`e` 一类的 Display 值映射成 `reason`）；`tests/unit/error-text.test.ts` 立了两条
  机械门禁（code 集合与 `ERROR_COPY` 一一对应 + **每处构造点都提供该 code 文案的全部占位名**），
  en 界面下带参数的 code 上屏英文且参数插值正确（不再回落中文 `message`）。
- **验收套件把「环境无效运行」与「产品判红」都表达成 0/1 PASS + 退出码 1**（M281 的 low finding，
  `.tower/comms/findings/20260928-worker-impl-goto-line-c-improve-0-1-pass-1.md`）：环境类失败
  （磁盘水位、app 没起来、端口被占）与产品类失败在读数上不可区分，复盘时要人读 run.log。**待修**：
  run.mjs 的退出码分档（0 = 全 PASS、1 = 有产品失败、2 = 环境无效），`status.txt` 同步分档。
- ~~**原生目录选择器标题未按语言取值**~~ **2026-09-28 已闭合**：`commands.rs` 的 `picker_title()` 在
  弹出时读一次 `config::load()` 的语言（`current_ui_language()`）再设标题，两档文案落在 deck 的
  D321（**全仓唯一一处 Rust 持有可见文案的地方**，理由与边界写在那一行的设计意图列里）；已弹出的
  对话框不跟随切换（如实登记）。
- ~~**启动首帧闪烁未实测**~~ **2026-09-28 已实测、未测出可见闪烁**：真机（`ui.language = zh` 的隔离
  环境）逐帧采样（每帧记 `document.documentElement.lang` + 可见文本长度 + modeline/树文本），首帧
  确实还没有语言属性（文案层在那 16ms 里按默认档 `en` 取值），但**首帧没有任何语言相关的可见文案**
  （modeline 左段与文件树都为空——承载文案的 chrome 都在配置到达之后才写入），第二帧起就是配置语言。
  逐帧读数落 `test-results/m282/ui-language-startup-flash/README.md`；两条候选缓解因此不采用
  （现状的写入次序已经满足缓解 ①，缓解 ② 会换来「配置到位前整窗空白」）。
- **视觉层的覆盖选择如实登记**：`tests/visual/scenes/tauri-stub.ts` 的桩把界面语言**钉在 `zh`**
  （与产品出厂默认 `en` 不同），理由是既有整页基线全是 zh 形态、它们承担「结构与外观」的回归面；
  `en` 面由新场景 `tests/visual/scenes/m282-ui-language.spec.ts` 覆盖。**代价**：视觉套件不再代表
  产品的默认语言面；若要让基线代表默认语言，需一次性重拍全部整页基线（人肉裁决点）。
- **zh 侧唯一一处可见措辞变化**：`src/vault-switcher.ts` 的相对时间改走
  `Intl.RelativeTimeFormat`，zh 下的数字与量词之间不再有空格（`5 分钟前` → `5分钟前`）。这是
  design §6.2「相对时间走 Intl」的直接后果，已在 `tests/unit/vault-switcher.test.ts` 就地标注；
  若 Alex 要保留空格，则相对时间不能走 `Intl`（回到查表），两条不能同时成立。
- **日志文本语言的口径待确认（沿 proposal 的报备）**：终裁说「日志消息固定用英文」，而现状日志
  `message` 是中文（事件名 / 字段名是英文标识符）。本批按「日志面不进语言面、文本不动」执行，
  未改写任何日志文本。

## M284（验收套件语言面修复，2026-09-28）

### 修的是什么

M282（change `ui-language-i18n`）把 `[ui] language` 的**出厂默认从 `zh` 裁成 `en`**，但验收套件里
断言 chrome 文案（`关闭 {name}` / `保存并切换` / `vault：{name}（点击查看全部 vault）` / `（未保存）` /
`Markdown 表格 1` / 右键菜单 7 项 …）的场景**从没钉过语言**——它们一直隐式跟随产品默认值。默认值一
改，这些断言在默认面下整批变红，而失败形态与真实产品缺陷一模一样（M283 首轮真机跑撞上，现场
`test-results/m283/before-run-language-face/`）。**根因不是「钉错了语言」，是「没钉」。**

### 盘点（实测，不是 finding 里那个 27）

机械口径（探针脚本与读数落 `test-results/m284/inventory.{txt,json}`，脚本 `copy2.mjs` / `inv4.mjs` 同目录）：
把场景 front-matter 里**真正送给 AX 匹配器**的字段（`ax.has/not/focused/count.pattern`、`target.name/
any/help`、`clickNodeText.text`、`clipboard.*`）全部抽出，与 `src/copy-data.ts` 的**字面片段**（按
`{占位名}` 切分，不做 trim；CJK 片段 ≥3 字符、纯 ASCII 片段 ≥4 字符）做双向包含比对。

| 读数 | 值 |
|---|---|
| 场景总数 | 65 |
| 断言里的 matcher 总数 | 867 |
| **消费了文案表某条目字面片段的场景** | **54 / 65** |
| 命中记录数（同一条 matcher 命中多个文案键时**重复计**） | 759 |
| **被命中的 matcher 条数（去重口径：同一场景内同一个 `where` 只计一次，再逐场景求和——与上面「按场景逐条对照」的口径一致）** | **403** |

（**口径记账（M284 r1 评审 P2-1）**：本表首版写的是 379——那是探针**中间版本**的读数，改了字面片段
切分口径后没回改；`inventory.json` 的三个可复现数是：raw hits **759**、逐场景去重 **403**、
跨场景全局去重 **137**。下文提到的「403 条 matcher」一律指逐场景去重那一档。）

finding 报的「约 27 个」是拿四条中文串 grep 出来的**下限**；实际面更大——finding 没列的还有
`Markdown 表格 {n}`（表格 widget 的读屏名）、`Markdown 代码块 {n}`、`关闭 {name}`（标签列）、
`（未保存）`（D90）、`保存并切换` / `放弃修改并切换`（D110.x）、`关闭其他标签` / `关闭右侧标签`（D150/D151）、
`主题：{theme}（点击切换）`（D122）、`键位（生效中）`（D63）、`输入以筛选` / `没有匹配的条目`（D117/D118）
这些面。口径是**静态启发式**，已知两侧误差：**欠包含**（`/A|B/` 正则形态的 matcher 与短于阈值的片段
会漏检）与**少量过包含**（`vault` 这类 ASCII 短串会把个别 fixture 文本算进来）。要按场景逐条对照，
看 `test-results/m284/inventory.json` 的 `hits[].where` / `.val`。

### 修法：套件自己钉住语言面（不是逐场景改断言）

| | 决定 | 理由 |
|---|---|---|
| 机制 | `run.mjs` 的 `SUITE_LANGUAGE = "zh"`：每个场景起 app 之前把 `[ui] language` 写进隔离 `config.json` | 一条线消掉整类问题：套件不再依赖**产品**默认值，产品的默认值以后再改也不会动到套件 |
| 取值 | `zh`（存量断言取的就是 zh 列） | 另一条路是把 403 条 matcher 改写成 en 列——机械改写 + 逐条核对插值/复数/`Intl` 格式，风险与收益不成比例；且断言是 M282 之前逐条评审过的制品 |
| 先例 | 与视觉层同一条：`tests/visual/scenes/tauri-stub.ts` 的桩同样钉 `zh`（`en` 面交给 `m282-ui-language.spec.ts`） | 两层的覆盖选择一致，代价一次说清（见下） |
| 覆盖方式 | 场景要验别的面就自己钉：front-matter `config: { language: "en" }`（场景 60） | 场景 55 两端都断言，保持 `zh` 起点 |
| 静态门 | `run.mjs --check` 校验 `config.language ∈ {zh, en}` 且 `config` 的键在白名单内（`lib/app.mjs` 的 `SCENARIO_CONFIG_KEYS`，单点真源） | 拼错即静默落回产品默认——正是本批要根除的形态 |

**顺带修掉的一处代价**：`config:` 原先在场景执行期写第二次并触发一次 app 重启；本批折进 `launchApp()`
之前的那次写（首帧即场景声明的起点，与 backlog:366 的「窗口配置只有一份真源」同一取向）。因此钉语言
面**不额外花重启**，全量批还比原来少 11 次重启（原先声明 `config` 的场景）。

**反向验证（先红后绿，REVIEW.md 第 1 条）**：把 `SUITE_LANGUAGE` 临时改成 `en` 跑场景 16 →
**FAIL**（AX dump 里 `AXButton (Open vault)` / `Open a folder as a vault…`，现场
`test-results/m284/reverse-en-face/`）；改回 `zh` 复跑 → **PASS**（`test-results/m284/precheck-zh/`，
同批 34 / 09b 也 PASS，证明 `theme` / `keys` 从场景 `config` 折到起 app 之前同样生效）。

### 覆盖边界（如实登记）

- `zh` 面：本套件全量 + 视觉套件（桩钉 `zh`）；
- `en` 面：本套件场景 **55**（⌘⇧L 切换，两端都断言）与 **60**（钉 `en`，走完守卫三出口 / 空 vault 引导 /
  dirty 标记 / 标签计数）；视觉 `m282-ui-language.spec.ts`（直接 import `COPY`）；文案表本身的漂移与占位
  门禁在 `tests/unit/copy.test.ts`。
- 因此**产品出厂默认面（`en`）在真机上的整场景覆盖只有 55 / 60 两块**——这是本批选择的已知代价，与
  上面「M282 遗留」里视觉侧的同款代价并列。
- **本批没做**：把 403 条 matcher 改写成 en 列（见上表理由）。若 Alex 要求套件整体代表出厂默认面，
  那是一次独立的重写批。

### 本批顺带发现（都已 file finding，不在本批修）

1. **`src/shell.ts:89` 的标签段读屏名不在 relabel 通道**（medium，真机实证）：配置 `zh` 时
   `AXTabGroup` 停在 `Open documents`。同一类型的长驻 chrome 违反点**只有这一处**（其余 6 类都已有
   `onRelabel`，逐项 file:line 见 finding）。finding：`20260928-worker-fix-zh-scenarios-bug-relabel-zh-axtabgroup-en.md`。
   **这就是场景 35 在本批全量里唯一那条红**——它是**产品缺陷**，不是套件问题（本批的 zh 面把 M282 的
   迁移缺口照出来了；若按「断言改 en」的那条修法，这条缺陷会被永久掩盖）。
2. **preview widget 的 `eq()` 语言盲区**（low–medium，静态实证）：一批 widget 的 `eq()` 只比语言无关
   字段，`applyLanguage` 依赖的 `refreshPreview()` 因而不重建 DOM，`toDOM()` 里的 `t()` 钉死在首次渲染
   那一档（含**可见文本**的 mermaid/frontmatter/math 一类）。清单与对照组在同一个 finding 里。
3. **启动恢复 notice 在 en 面泄漏中文**（low，实测）：`src-tauri/src/lib.rs:513` 的
   `"上次打开的 vault 已不可用：{last}，请重新选择目录"` 是硬编码中文串、不走文案表——reverse-en 跑
   的 AX dump 里可见「中文前缀 + 英文尾巴」混排。这条**已在 change `ui-language-i18n` 的 tasks 5.5 里
   记为未勾选项**，故不另立 finding，只在这里记账。

## M285（选区自绘 + 标签段读屏名，2026-09-28）

两个真机缺陷一批修。分支 `feat/fix-bold-selection-drawselection-and-tab`（**核销**：M284 那句
「场景 35 唯一稳定红」的成因，即下面 B）。

### A. 选中跨粗体时粗体段没有选中底色（M273 survey 定位）

**根因**（全量报告 `test-results/m277/findings.md`）：编辑器没装 CM6 的 `drawSelection()`，可见高亮
全靠浏览器原生选区；md 的 live preview 在 `mouseup` 解冻那一拍重建强调段（`**粗体**` 显露）的 DOM，
WebKit 没把重建出来的那段画进选中层 ⇒ 粗体段是一个「洞」（而复制内容是对的——复制走 CM 的 state）。

**修法**（四个落点，后两条是实现期实测才发现必须一起做的）：

| 落点 | 改动 | 为什么 |
|---|---|---|
| `src/editor.ts` sessionState | 装 `drawSelection()`（模式无关的基础层） | 选区与光标改由 CM 的 state 画在 `.cm-selectionLayer` / `.cm-cursorLayer` 上，绕开「原生选区的绘制 vs 装饰重建」那条同帧竞态；此前 `.cm-selectionBackground` / `.cm-cursor` 那几条规则是「声明了没有消费者」的存量（REVIEW.md 第 9 条） |
| `src/editor.ts` baseTheme | `.cm-selectionBackground` 的底色加 `!important` | CM base theme 自带 `.ͼ2.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground { #d7d4f0 }`——**5 个类的选择器**（实测把 `document.styleSheets` 里所有含 `cm-selectionBackground` 的规则逐条读出来），应用自己的 2–3 类规则特异性上必然输；不写 `!important` 时选区会变成库默认**淡紫**（chromium 实测 `rgb(215,212,240)`），`--sel` 被静默架空。`::selection` 那条**不写** `!important`（要有意让 `hideNativeSelection` 赢，否则原生层与自绘层叠成两层）；eink 的反白靠它的 `color` 生效（`hideNativeSelection` 只写 backgroundColor） |
| `src/preview/theme.ts` | 删掉与 baseTheme **逐字重复**的一份选中底色 / 光标声明 | 两处写入点（REVIEW.md 第 8 条）；选择底色的真源收口到 `editor.ts` 的 baseTheme（两模式共用） |
| `src/table-fullscreen.ts`（仅注释） | 快照拒绝表那两条选择器从「纯防御」改成「真拦得住」 | M285 起这两个层真实在场；旧注释自述「实测本应用未装 drawSelection」已成错误自述 |

**chromium 侧判据**（`tests/visual/scenes/m285-selection-layer.spec.ts`，6 条，结构层）：逐字符
`.cm-selectionBackground` 覆盖 = CM 选区（5 种范围类型 × 3 主题）、显露态（源码可见、装饰已撤）
不回退、鼠标按压窗口内与抬起后都覆盖、空选区时零覆盖层、选区外字符零覆盖；色值判据是
`.cm-selectionBackground` 的计算样式 == `--sel`、eink 的 `::selection` 前景 == `--sel-text`。
**它不能替代真机判据**：chromium 的像素层对这条缺陷是假绿（survey 实测 4 条交互路径 × 3 主题逐字符
底色全绿——无头引擎在装饰重建后会把原生选区重新同步到新建的文本节点）。

**真机侧判据**（场景 64）：见「先红后绿」与「M285 新增的 pixel 断言通道」。

**M273 两问的关闭（Alex 2026-09-28 裁决，dogfood 实证）**：① 选中底色 α≈0.77（当时疑似 eink + 失焦
dimming）——Alex dogfood 后答「**已好**」⇒ 本条修复在真实手感上成立，不再跟踪；② 行内 code 药丸
padding 窄条不染色（M277 报告 §5 的独立小观感项，survey 当时建议另立）——Alex 裁决「**不立**」⇒ 不立项、
不收进待办（`test-results/m277/findings.md` §5 与 finding
`20260927-worker-survey-bold-sel-m277-improve-code-padding-selection.md` 留档即可）。

### B. 标签段读屏名不在 relabel 通道（M284 照出的产品缺陷）

`src/shell.ts` 的标签段读屏名只在构造期取一次 `t("D88")`——那时配置还没到达，取值落默认档 `en`，
且全文没有 `onRelabel` 注册 ⇒ 配置 `zh` 时读屏名永久停在 `Open documents`（M282 design §5.2 的
不变量「承载语言相关文案的长驻元素 MUST 有一条能在运行期重跑它的写入路径」被违反）。
修法：抽成 `applyTabStripLabel()`（**保持单一写入点**）并挂进 `onRelabel`，与 `src/toc.ts` 的指示段、
`src/tree.ts` 的树头入口同形。判据两层：真机场景 35（`AXTabGroup (打开的文档)`）+ chromium
`tests/visual/scenes/m282-ui-language.spec.ts` 的「标签段的读屏名跟着语言走」（zh 桩下取中文列、
⌘⇧L 切 en 后取英文列——同一 DOM 元素上的值随语言变，证明重绘回调真的注册了）。

### 先红后绿（真机，`node scripts/acceptance/run.mjs 64 35`，两轮）

| 场景 | 修前（`src/` 摘掉两处修复） | 修后 |
|---|---|---|
| `35` | **FAIL**（1 条红）：`AXTabGroup (Open documents)` —— zh 面里唯一一处英文 | **PASS** |
| `64` | **FAIL**（1/21 条红）：「第 1 行行尾空白 vs 选区内文字」应同色却不同（`#fdfdfd` / `#e8e8e0`，最大通道差 **29** > 容差 8） | **PASS**（21/21） |

证据（git 外，均已同步到主 checkout）：`test-results/m285/pre-fix/`、`test-results/m285/post-fix/`
（两轮的 `steps.md` / `shots/` / `ax/` 全量）；标定探针现场
`test-results/acceptance/2026-09-28/m285-probe/{light,eink}-v3/`。

**判据为什么是「行尾空白」而不是「某个洞」**：M273 的洞只在鼠标那条时序（`mouseup` 解冻 → 装饰重建）
出现，而合成的 CGEvent 拖拽在本机不可用（见下「已知边界」）⇒ 真机判据改判**绘制来源**：跨段选区的
**开放端**由 CM 自己的几何算出（`rectanglesForRange` 对未闭合的一侧取内容框内缘 ⇒ 整行涂到正文栏
右缘），原生选区不涂这一块。这一条的区分度已由上面两轮实测钉住（修前 29 / 修后 ≤ 2）。
「粗体段底色 == 选区内普通文字底色」那条在两轮里都 PASS —— 它在**这条通道上**没有区分度（键盘建立的
选区不触发那一拍重建），它的价值是钉住缺陷的主体读数不回归；如实登记，不当作区分度证据。

**顺带实测到的两处口径**（不是本批引入，登记备查）：

- **eink 档的选中底色在修前不是 token 值**：原生选区在真机渲染成 `#333333`（实测），修后由 CM 画的
  是恰好 `--sel`（`#000000`）。即本修法顺带让「选中底色 == token」在像素层成立。
- **键盘建立的选区不进 DOM 选区（窗口非前台时）**：`⌘C` 在真机对这类选区复制不到内容（原生 ⌘C 需要
  key window；窗口在前台时正常——两轮实测：pre-fix 轮「前台焦点：已取得」时 DOM 选区有内容、
  post-fix 轮前台未取得时剪贴板是上一个 app 的残留）。**场景 64 因此只把剪贴板当「读数」记进证据、
  不写断言**（`do: clipboardRead`）。真机上前台是场景级前置条件（套件 README 的「键盘场景的前台
  纪律」），不是本批引入的行为。

### M285 新增的 pixel 断言通道（真机取色的第一处通道）

渲染类缺陷在真机的既有通道里**全不可见**（AX 读不到选区、文件与剪贴板只看内容），M273 的 survey 把
这类判据落到「逐字符底色」上，而真机此前只有截图没有取色通道。本批补上：`lib/pixel.mjs` +
`expect.pixel`（`same` / `differ` / `contrast` 三种相对关系，窗口局部坐标采样、窗口截图经 `sips` 转
BMP 后取采样方块主色）。细节与边界见 `scripts/acceptance/README.md` 的断言表与 `pixel` 小节。

### 已知边界与未覆盖

- **鼠标路径那一拍（缺陷的原始触发时序）在真机没有被场景覆盖**：合成拖拽在本机不可用——三轮探针
  里同一条 `drag` 路径先（v1）把文档截断成 `…**粗体段wo`、后（v3）在文末追加 `hao`，两次都是拼音串
  （环境里有中文输入法在跑，合成鼠标事件触发了它的预编辑提交；真手拖拽不经这条通道）。已记进
  套件 README 的「已知边界」。该时序的几何不变量由 chromium 的 `m259` 场景覆盖。
- ~~**`openspec/specs/editor-live-preview/spec.md` 的合同条款未落**：M277 报告 §6 建议新增一条不变量
  （「选区可见范围 MUST 等于编辑器选区范围」）。本批 scope 不含 `openspec/**`，故只把结构判据落成
  测试（`m285-selection-layer.spec.ts`），条款落点留给后续 proposal/归档批。~~
  **已落（M287 归档批，2026-09-28）**：条款作为不变量段落 + 配套 scenario 落进
  `openspec/specs/editor-live-preview/spec.md` 的 `Requirement: live preview 装饰层`（M277 §6 指定的
  落点，与 M259 那条同层），`openspec validate --all --strict` 绿。判据层按条款要求写成「chromium 结构层
  + 真机层」，并写明 chromium 的像素层对本条是假绿。
- **基线未动**：装 `drawSelection` 动了编辑器的绘制层，但整套视觉回归（含 22 处整页 / 元素像素断言）
  **一条基线都没红**——实测那些场景里没有「有选区的编辑器」形态。两条新场景（`m285-selection-layer`
  与 m282 的那条）都是结构 / 计算属性断言，不新增整页基线。

## M291 选区族对比度（三主题；2026-09-28，已修，合并以后补记）

- **现象（Alex 报告，同一族的多个面）**：① light / dark 下看不出选区落点（「我人眼压根看不出来我从哪里
  选中的」，他从「取消」的「取」字开始选）；② eink 下代码块里「几乎看不到文字」；③ Alex 裁决 eink 的
  chrome 侧反白也不可用（「现在是白字灰底，我人眼几乎看不清字是什么」）；④ 补充现场：eink 下引用块内
  **粗体**被选中后不可见（普通文字呈浅色、粗体段与黑底融为一体）。
- **定性（两档机制，都不是「画不出来」）**：
  1. **撞色**（①②③的共同底色）：编辑器选区带的真源 `--sel` 与它要压住的承载面太近。真机读数
     （窗口局部 7×7 主色）：light 正文带 `#e8e7e2` vs 纸 `#fdfdfd` = **27**、代码块内 vs 纸 = 27
     （M288 时的块内撞色读数 11）；dark 正文带 `#323337` vs 底 `#222327` = **16**、代码块内
     `#47484c` vs 底 = 37。
  2. **eink 的「黑底反白」只有一半**：反白靠原生选区的 `::selection { color }`，而它只作用于**仍被
     原生选区覆盖**的文字——选区驱动的装饰重建（显露强调段）把那段 DOM 重建出来，WKWebView 不把
     重建出的节点画进选中层（M273 的机理；M285 只修了**底色**那一半）。同一条选区里普通文字正常、
     重建段被吞。另一半：**行内 code 药丸**自带底色画在选区带**之上**，`::selection` 把药丸里的字改成
     白字 ⇒ 白字压浅灰（chromium 实测跨度 **15**）。
  3. **chrome 侧的反白靠逐表面 `:not(:hover)` 排除条款兜底**：`--hover` 档会压过选中底色，于是
     「白字压 `#f0f0f0`」只差漏一条条款或一个过渡帧（过渡帧实测差 **15**，稳态差 255/240）。
  4. **起点位置对现象无判定意义**（Alex 从引用块中间起选的疑点）：显露判据按**节点源码区间**接壤
     判定，与选区起点落在行内哪个位置无关 —— 起点在块外、块内、行首都产生同一条读数。
- **复现边界（如实登记，不粉饰）**：
  - **可复现**：light / dark 的撞色（真机 27 / 21）；eink 的**行内 code 药丸**被吞（真机跨度 15，
    chromium 15）；chrome 侧「白字压 `#f0f0f0`」的形态（chromium 15，**由注入复现**）。
  - **未复现**：① Alex 的「eink 引用块粗体被选中后不可见」——我这套 replicate（真机 + 同一场景）
    修前读到强调段跨度 **193（可读）**；② 「eink chrome 白字灰底」在**稳态**读数是白字压黑底
    （255）与悬停后黑字压浅底（240）——CSS 里每个表面都带着一条 `:not(:hover)` 排除条款兜着它，
    只有**过渡帧**或**漏掉条款**才落到 15。两条都按 Alex 的裁决做了**类级消除**（反白整条退场），
    因此这两类现场在本版之后不可能再造出来；若 Alex 手上仍有可复现的现场，请给表面名/截图，
    按新判据补一栏（判据落在 `m291-selection-contrast.spec.ts` 的 chrome 用例，加一个选择器即可）。
- **修法（token 层，真源 `docs/specs/design-tokens-v1.md`）**：
  - 编辑器选区带的真源从 `--sel` 拆出为 **`--sel-band`**（画在文字之下、前景改不了，下界还要压住
    `--code-bg`）：light `#c6c5bf` / dark `rgba(255,255,255,.22)` / eink `#b9b9b9`；
    `src/editor.ts` 的 `.cm-selectionBackground` 改读它，并删掉那段**从未生效**的 `::selection` 底色
    声明（CM 的 `hideNativeSelection` 用 `!important` 置透明，裸声明永远输）。
  - **eink 的 `--sel` 族整体重定**（Alex 裁决，chrome 与编辑器同批）：`--sel` 纯黑 → 明度带
    `#b9b9b9`、`--sel-text` 白 → 黑（= `--text`）。反白路线整条退场 ⇒ 任选区内文字都可辨，
    也不再依赖原生选区的覆盖；`src/style.css` 里 5 处 `:not(:hover)` 排除条款随之删除（它们此前是
    唯一的可读性保障）。
- **修前 → 修后读数（同一天、同一台机）**：

  | 判据（窗口局部 7×7 主色） | light | dark | eink |
  |---|---|---|---|
  | 正文带 vs 选区外（**真机**，起点/中段/代码块三处同值） | `#e8e7e2`/`#fdfdfd` = **27** → `#c6c5c0`/`#fdfdfd` = 61 | `#37383a`/`#222327` = **21** → `#5a5b5d`/`#222327` = 58 | `#000`/`#fff` = 255 → `#b9b9b9`/`#fff` = 70 |
  | 带在代码块内 == 块外（同色判据） | 修前 0 → 修后 0（不透明带，形态不变） | 相对判据（半透明，合成色随面变） | 修前 0 → 修后 0 |
  | 代码块内带 vs 代码行区带（chromium） | 11 → 45 | 16 → 44 | 240 → 55 |
  | 选区**起点**两侧（chromium） | 27 → 61 | 16 → 49 | 255 → 70 |
  | **强调段**（显露重建）字形跨度（真机；chromium 对这条假绿） | 117 → 85 | 96 → 66 | 修前 **193（可读，未复现 Alex 的现场）** → 修后 141 |
  | **行内 code 药丸**字形跨度（真机） | — | — | **15 → 227** |
  | 着色字符串字形跨度（真机） | — | — | 169 → 120 |
  | chrome 树当前行（指针在行上，底色被 `--hover` 压过；chromium） | — | — | **15**（「白字灰底」的形态，注入复现）→ 240 |
  | chrome 浮层当前项（chromium） | — | — | 255 → 185 |

  （真机两轮：先红 `test-results/m291/before/steps.md`、后绿 `test-results/m291/after/steps.md`；
  chromium 读数 `test-results/m291/chromium-{before,after}.txt`。）

- **判据**：chromium `tests/visual/scenes/m291-selection-contrast.spec.ts`（编辑器矩阵 + eink 字形 +
  chrome 侧含 hover 组合 + 区分度自证，4 用例）；真机场景 **68**（先红 / 后绿两轮，含 eink 强调段与
  药丸的 `contrast` 判据、chrome 侧截图证据）。三处既有断言按新口径更新并逐条注明理由：
  `m285-selection-layer`（`--sel` → `--sel-band`；eink 的 `::selection` 断言从「反白 = --sel-text」改成
  「字色 = 正文色」）、`m198-code-variable-highlight`（三层可区分里的选区一层改读 `--sel-band`）、
  `restyle-eink` 规则④（黑底反白 → 明度带 + 黑字）、场景 66（eink 的标签与说明按新 token 更新，
  **断言与阈值未动**）。
- **未收口（另立）**：**行内 code 药丸 / callout 行底色 / frontmatter 区**这类 `.cm-content` 内的
  in-flow 底色仍画在选区带之上（选中时那一段读到的是它自己的底而不是带色）——M288 已登记的同类
  表面、M291 只保证「那里的字可读」，覆盖问题见 finding
  `20260928-worker-selection-contrast-m291-improve-inline-surface-band-coverage`。
- **r3（Alex 追加裁决）**：`.lumir-block-trigger` 在 eink 下的**热态**原先是硬编码黑底白字
  （`src/style.css` 的 eink 块），按 M291 的方向**退场**——改为选中族（`--sel` 明度带 + `--sel-text`
  黑字），同时把该块静止态的三处字面值（`#fff`/`#000`/`#000`）按收敛规则 1 归位到
  `--preview-bg` / `--border` / `--text`（值不变）。**light/dark 没有硬编码可退**：基础规则本就取
  `--preview-bg` + `--text`（hot 只是字色深一档），只有 eink 需要一整块实心底。**同族残留（登记待
  裁决，本批未改）**：搜索面板的两处实心档（大小写开关「开」态、当前搜索匹配）与代码块 / frontmatter
  区的 eink 黑框仍是字面值（与 `--accent-fill` 那对 / `--border` 在这一档同值，行为未变）。
  **（M293 已核销，2026-09-29）**：这批字面值已按收敛规则 1 归位到 `--accent-fill` 那对与
  `--border`（三主题渲染值逐值不变，核对表见本文件末的 M293 节）；同批随 scope 扩宽一并收了
  `src/preview/theme.ts` 侧的 frontmatter 盒 / 两个 chip 描边 / callout 左色条。仍留在字面值上的
  只剩「面」族（`#fff` 白底四处）与 callout 类型标签的一处前景色（同节列明，未动）。
- **r3 复现路径的验证（已跑完，结论 PASS，先红后绿都在档）**：Alex 给的路径
  （`docs/design-parity-contract/README.md`，从「另见的上一行」拖到「2026-09-06」，跨引用块与标题，
  **等 1 秒**）在**他的原文件区域**（前 20 行逐字，eink）上实测：
  - **master 等价形态（3497478）复现**：带纯黑 `#000000`，带内字形跨度 **0 / 57 / 0 / 62**
    （`另见` 行 / `独立` 行 / 正文 / 药丸）⇒ 字被吞、正是 Alex 的现场；
  - **修复版（42cc1dd）通过**：带 `#b8b8b8`（= `--sel`）对纸 **71**，带内跨度 **185 / 127 / 189 / 215**
    ⇒ 全部可读。截图与逐点读数：`test-results/m291/{repro-real-before,repro-real-after}/` +
    `r3-repro-verdict.md`（复量脚本 `measure.mjs`，与套件 `pixel` 同一口径）。
  - 机制：mouseup 后 livePreview 重建强调段 DOM，重建出的节点不再被原生选区覆盖 ⇒ `::selection` 的
    反白够不到它们（M285 只修了底色那一半）；改成明度带 + 黑字后字色不再依赖原生选区覆盖。
- **套件通道的两条边界（本轮实测，供后批）**：
  1. **超长 fixture 会让 AX 快照退化**：把整份 127 行的 README 写进 vault 时，像素断言一律报
     「取不到窗口截图，像素断言无法判定」；截成前 20 行（覆盖被选区域）即恢复。要看这种长文的真机读数，
     只能用「套件存 shot + 自己按 `lib/pixel.mjs` 口径复量」这条路（本轮的读数就是这么来的）。
  2. **合成拖选后紧跟的 `pixel` 断言也常取不到截图**（同一时刻的 `shot` 步骤却能存下）⇒ 拖拽类场景的
     像素判据要么挪到 shot 之后，要么接受「复量证据」。已 file finding（见下）。
- **核销**：M288 的 finding `20260928-worker-codeblock-selection-m28-improve-m288-sel-code-bg-11-callout-code.md`
  的「11 够不够」人裁决点由本 mission 回答（不够 ⇒ 已按 `--sel-band` 收口），finding 核销；
  callout 色与 code-bg 的关系未变，那半条不在本 mission 面内。

## M288 代码块内选区不可见（2026-09-28，已修 dac89c0，合并 eef2556）

- 现象：md 的围栏代码块里扩选 / 拖选看不见选区（Alex 报告；他猜「撞色」）。
- 定性（机制）：**绘制顺序**。drawSelection 的 `.cm-selectionLayer` 是 `.cm-scroller` 里的
  **负** z-index 层（CM `layer({above:false})` ⇒ `-1 - pos`，实测 **-2**），而块底色（容器 +
  行两个 in-flow 背景）按 CSS 绘制顺序排在它之后 ⇒ 整块盖住。真机三主题修前读数：light 差 0、
  eink 差 0、dark 差 14（半透明 --code-bg 恰好透出来，故 dark 修前也可辨 **= 非缺陷档**）。
- 修法：块底色搬到容器的两个负 z-index 伪元素（`::before` 底板 / `::after` 行区带，
  `padding: inherit` + `background-clip: content-box` 让行区带与容器 padding 同源）；折行档
  由 `.cm-lp-codeblock-slot::before` 承担；行底色在 slot 在场时让位（`:has()`）。
  **容器与行 MUST NOT 定位**——否则块级动作钮的包含块从 slot 变成容器、横滚时跟着内容滚
  （M240 口径，实测钮 x 992 → 692）。零新增 token、不动 drawSelection 装配。
- **残差（待 Alex 裁决）**：修后 light 的块内选区与块底色仍只差 **11**（`--sel` #e8e7e1 vs
  `--code-bg` #f2f1ec；正文档差 21），dark 14、eink 240。要更重只能改 token（`--sel` /
  `--code-bg`，真源 docs/specs/design-tokens-v1.md）或给块内选区造更重的变体（需动 drawSelection
  装配或新增 token）——finding 已记（`20260928-worker-codeblock-selection-m28-improve-m288-sel-code-bg-11-callout-code.md`）。
- 判据：chromium `tests/visual/scenes/m288-codeblock-selection.spec.ts`（三主题 × 两种折行口径 ×
  四种选区形态 + 区分度自证；修前 2 failed → 修后 3 passed）；真机场景 **66**（修前 FAIL 0/1 →
  修后 PASS 1/1，三主题读数在档）。**未给 m285-selection-layer spec 加 code 块分支**：那条几何覆盖
  对本缺陷无区分度（加了是假绿）。
- 同类表面（**机制推演、未逐一实测**，候选另立 survey）：行内 code 药丸 / callout 行底色 /
  frontmatter 区 / code 模式的变量底纹——同一机制（.cm-content 内的 in-flow 底色盖住负 z-index
  选区层），其中不透明的几处预期 100% 盖住选区。
- 门禁：gate quick 10/10、gate visual 12/12（556 passed / 1 skipped，22 处像素对比零基线 diff、
  未做 --update）；三处既有计算样式断言按新落点更新（理由就地注明；reviewer 复核确认保住原不变量）。

## M293 eink 字面值归位 token（2026-09-29，Alex 裁决「改。你可以安排时就动手。」，已修）

- **缘起**：M291 r3 的 review-request 登记了同族硬编码残留（搜索面板两处**实心档** = 大小写开关
  「开」态与当前搜索匹配、代码块 / frontmatter 区的 eink 黑框），当时判「与 token 同值、行为未变，
  不属 M291 的裁决面」。本 mission 单独一批收，依据是 `docs/specs/design-tokens-v1.md` 的
  **收敛规则 1**（eink 的手工反白语义上属于既有 token 的 eink 值，收敛时归位、不新增色）。
  tower 2026-09-29 按 task 2 的需要把本 mission 的 scope 扩到 `src/preview/theme.ts`（frontmatter
  半边的唯一真源在那里）。
- **不变量**：**归位后三主题渲染值逐值不变**——纯收敛，不是改设计。因此本批**零基线更新**：
  若哪张既有像素基线变红，那是「值变了」的警报，不是「基线该更新」。
- **判据两层（缺一层即假绿）**：
  ① **值**：元素的计算色 == 归属 token 的计算值（三主题）；
  ② **归属**：把归属 token 临时改成一个三主题都不用的探测色（`rgb(7,8,9)`），该元素的计算色
  MUST 跟着变——**写死字面值的声明不会跟着变**。②才是「不再硬编码」的判据（REVIEW.md 第 1 条）。
  实证（先红后绿）：修前跑 `tests/visual/scenes/m293-eink-literal-tokens.spec.ts`，eink 的 4 条用例
  全红在 ②（读到 `rgb(0,0,0)` 纹丝不动）、① 全绿；修后 12/12 绿。
- **归位清单（11 条规则 / 3 个文件；线宽一律不动）**：

| 文件:行 | 选择器（eink 覆盖块） | 属性 | 原字面值 | 归位 token |
|---|---|---|---|---|
| `src/search-panel.css:108` | `:root[data-theme="eink"] .lumir-search-case.is-on` | background / color | `#000` / `#fff` | `--accent-fill` / `--accent-fill-text` |
| `src/search-panel.css:143` | `:root[data-theme="eink"] … .cm-searchMatch-selected` | background / color | `#000` / `#fff` | 同上 |
| `src/style.css:1051` | `:root[data-theme="eink"] .cm-lp-codeblock-scroll` | border | `1px solid #000` | `1px solid var(--border)` |
| `src/style.css:955` | `:root[data-theme="eink"] .ft-open-btn` | border-color | `#000` | `var(--border)` |
| `src/style.css:1456` | `:root[data-theme="eink"] .lumir-table-fs-panel` | border | `1.4px solid #000` | `1.4px solid var(--border)` |
| `src/style.css:1512` | `:root[data-theme="eink"] .lumir-codeblock-fs-panel` | border | `1.4px solid #000` | 同上 |
| `src/style.css:1541` | `:root[data-theme="eink"] .lumir-codeblock-fs-content` | border | `1px solid #000` | `1px solid var(--border)` |
| `src/preview/theme.ts:198` | `:root[data-theme="eink"] & .cm-line.cm-lp-callout-line` | borderLeftColor | `#000` | `var(--border)`（与引用块 `2px` 竖线同属结构档：`theme.ts:156` 本就是 `2px solid var(--border)`） |
| `src/preview/theme.ts:449` | `:root[data-theme="eink"] & .cm-lp-frontmatter` | border | `1px solid #000` | `1px solid var(--border)` |
| `src/preview/theme.ts:490` | `:root[data-theme="eink"] & .cm-lp-fm-status` | border | `1px solid #000` | `1px solid var(--border)` |
| `src/preview/theme.ts:506` | `:root[data-theme="eink"] & .cm-lp-tag` | border | `1px solid #000` | `1px solid var(--border)` |

- **三主题值不变核对表**（chromium，计算色；`test-results/m293/readings-{before,after}.txt` 逐字节
  `diff` 为空——4 组 × 3 主题共 12 条读数行，含各 token 的计算值）：

| 读数面 | light | dark | eink（归位前 → 归位后） |
|---|---|---|---|
| `.lumir-search-case.is-on` 底 / 字 | `rgb(238,241,251)` / `rgb(58,95,205)` | `rgba(128,152,232,.15)` / `rgb(139,163,239)` | `rgb(0,0,0)` / `rgb(255,255,255)`（同值） |
| `.cm-searchMatch-selected` 底 / 字 | `rgb(58,95,205)` / `rgb(255,255,255)` | `rgb(100,126,207)` / `rgb(255,255,255)` | `rgb(0,0,0)` / `rgb(255,255,255)`（同值） |
| `.cm-lp-codeblock-scroll` 框 | 无框 | 无框 | `1px solid rgb(0,0,0)`（同值） |
| `.ft-open-btn` 框 | `1px solid rgb(227,226,221)` | `1px solid rgba(255,255,255,.094)` | `1px solid rgb(0,0,0)`（同值） |
| 两处全屏面板（`.lumir-{table,codeblock}-fs-panel`）框 | `1px solid rgb(227,226,221)` | `1px solid rgba(255,255,255,.094)` | `1px solid rgb(0,0,0)`（声明 1.4px，见下注；同值） |
| `.lumir-codeblock-fs-content` 框 | 无框 | 无框 | `1px solid rgb(0,0,0)`（同值） |
| `.cm-lp-frontmatter` 框 | 无框 | 无框 | `1px solid rgb(0,0,0)`（同值） |
| `.cm-lp-fm-status` / `.cm-lp-tag` 框 | 无框 | 无框 | `1px solid rgb(0,0,0)`（同值） |
| `.cm-line.cm-lp-callout-line` 左色条 | `2px solid rgb(58,95,205)` | `2px solid rgb(139,163,239)` | `2px solid rgb(0,0,0)`（同值） |

  **注（本批新查实的平台口径）**：chromium 在 `deviceScaleFactor=1`（视觉门禁与 CI 的口径）下把
  1.4px 边框折成整数档，`getComputedStyle` 读回 `1px` ⇒ 规则⑧的 1.4px 强调档在**视觉层没有判别力**，
  这一层只能钉「有框 + 色 = `--border`」；该档的可辨差异要到真机（WKWebView，dsf=2）才成立。
  已写进 `docs/specs/design-tokens-v1.md` 的字面值归位节。

- **本批不动（不属裁决的两族，逐条理由）**：

| 位置 | 字面值 | 不动的理由 |
|---|---|---|
| `src/style.css:1049` `.cm-lp-codeblock-scroll::before`（eink） | `background-color: #fff` | 属「面」族（规则⑤的**白底**半边），不是「实心强调 / 边框」；eink 下 `#fff` 与 4 个 token 同值（`--preview-bg` / `--frame` / `--content-bg` / `--agent-bg`），归位要先定语义位 |
| `src/style.css:1542` `.lumir-codeblock-fs-content`（eink） | 同上 | 同上 |
| `src/preview/theme.ts:198` `.cm-line.cm-lp-callout-line`（eink） | `backgroundColor: "#fff"` | 同上 |
| `src/preview/theme.ts:449` `.cm-lp-frontmatter`（eink） | 同上 | 同上；**附加**：这一处的覆盖在本档是**冗余**的（基规则读 `--agent-bg`，eink 的 `--agent-bg` 也是 `#ffffff`）——归位到 `var(--agent-bg)` 或直接删都能值不变，两种收法都行，等裁决 |
| `src/preview/theme.ts:202` `.cm-lp-callout-type`（eink） | `color: "#000"` | **前景色**，不是两族；且 eink 下与 `--accent` / `--ok` / `--pending` / `--danger` / `--text` 同值（五族合一），归位要先定语义位（族色还是正文色） |

- **（M294 已核销，2026-09-29）**：上表 5 行按 Alex 2026-09-29 裁决「1. 立；2，删。」全部收干净——
  4 处「面」字面值逐处定了语义位（代码块底板 / 全屏代码块内容容器 / callout 行 → `--content-bg`；
  frontmatter 盒那处**冗余覆盖删除**、由基规则 `--agent-bg` 接管）、callout 类型标签的前景归位
  `--text`（不是族色）。语义位理由、两条 MUST NOT（行区带那一层不动）与读数对照见本文件末的 M294 节。

- **判据与证据**：
  - 新增场景 `tests/visual/scenes/m293-eink-literal-tokens.spec.ts`（12 用例 = 4 组 × 3 主题：
    实心强调族 / 边框族（文档内 + 两处全屏浮层）/ 边框族（打开入口）/ 边框族（内容面 frontmatter +
    两个 chip + callout 色条）；每组都断言「值 == 归属 token」并做 token 探测归属判据）。
  - 先红后绿：`test-results/m293/before.log`（eink 4 条红在归属判据 + light/dark 8 条绿）、
    `after.log`（12 passed）；读数对照 `readings-{before,after}.txt`（diff 为空）。
  - **旁证（既有断言在原值层面照绿）**：`restyle-eink.spec.ts` 的规则⑤⑥用例断言的是**硬编码 rgb
    值**（代码块底板白 / frontmatter 白底黑框 / chip 1px 黑框），本批若不值变它们必然红——它们照绿
    即「值不变」的第二条独立证据。
  - 门禁：见本 mission 的 review-request（视觉全量本地跑、**零基线 diff、未做 `--update`**）。
- **核销**：本文件 M291 节的 r3 同族残留清单（搜索面板两处实心档 + 代码块 / frontmatter 黑框）
  核销；同批随 scope 扩宽收了 `theme.ts` 侧的 frontmatter 盒 / 两个 chip / callout 色条。
- **留给后批的一条现场**：`docs/specs/design-tokens-v1.md` 的「字面值归位」节已把两族口径与两层判据
  写成规则——下次再遇到 eink 硬编码，直接按「角色（实心底 / 边框）→ token」归位 + 补 token 探测
  判据，不要按「哪个 token 恰好也是这个值」反查（eink 下 `#000` 与 5 个 token 同值，反查会选错语义位）。

## M294「面」族与一处处前景色归位（2026-09-29，Alex 裁决「1. 立；2，删。」，已修）

- **缘起**：M293 把「实心强调 / 边框」两族收干净后，M293 节留了一张「本批不动」清单（4 处
  `background-color: #fff` 的「面」字面值 + callout 类型标签的 `color: "#000"`）。Alex 2026-09-29
  裁决把这条尾巴一次收完：「**1. 立；2，删。**」——① 立「面族 / 前景」的语义位口径并归位那 4 处；
  ② frontmatter 盒那处**冗余**覆盖直接删。依据仍是 tokens 文档的**收敛规则 1**，口径是 M293
  「角色归位」的推广：按声明在规则里的**角色**选 token，不按字面值反查（eink 下 `#fff` 与四个面
  token 同值、`#000` 与五个 token 同值，反查必选错语义位）。
- **不变量**：**归位 / 删除前后三主题渲染值逐值不变**——纯收敛，零基线更新（若哪张既有像素基线
  变红，那是「值变了」的警报，MUST NOT 用 `--update` 抹平）。
- **5 处落点与语义位理由**（行号为本批提交时的值）：

| 文件:行 | 选择器（eink） | 属性 | 原字面值 | 处置 | 语义位理由 |
|---|---|---|---|---|---|
| `src/style.css:1048` | `.cm-lp-codeblock-scroll::before`（底板） | background-color | `#fff` | → `var(--content-bg)` | 规则⑤ 的「白底」半边：eink「无灰底可用」⇒ 区块**不另立色面**、回落成它所在的面（正文面）。`--code-bg` 在本档另有承载者（行区带 `::after` 仍是 `#f0f0f0` 的灰，见下面的 MUST NOT），取不得 |
| `src/style.css:1545` | `.lumir-codeblock-fs-content` | background-color | `#fff` | → `var(--content-bg)` | 与上一处**同一角色**（代码块内容面）⇒ 取同一 token，不因它坐在全屏浮层里而分家（否则同一语义在 eink 落到两个 token 上） |
| `src/preview/theme.ts:197` | `.cm-line.cm-lp-callout-line`（底色） | backgroundColor | `#fff` | → `var(--content-bg)` | tint 在 eink 全退场 ⇒ 底色 = 正文面——tokens 文档 §callout 语义收敛 规则 3 早就把这条写死过（「tint 全 transparent（底色 = `--content-bg`）」），本批是把它推广到代码块 |
| `src/preview/theme.ts:452` | `.cm-lp-frontmatter` | backgroundColor | `#fff` | **删除**（裁决「2，删。」） | 基规则（`theme.ts:444`）已读 `--agent-bg`——§bg 层级把 frontmatter 区点名为「次级表面」；eink 的 `--agent-bg` 同为 `#ffffff` ⇒ 这处覆盖在本档**冗余**，删后由基规则接管、值不变 |
| `src/preview/theme.ts:203` | `.cm-lp-callout-type` | color | `#000` | → `var(--text)` | 角色是「五族合一后的**统一前景**」，不是族色：五族族色分散在 `--accent` / `--ok` / `--pending` / `--danger` / `--text-3` 上，**没有一个 token 能代表五族**；规则② 之后 eink 的颜色不承担信息，标签靠文案区分。同口径先例：M291 r3 把触发钮静止态的 `color` 归到 `--text` |

- **两条 MUST NOT（本批查实的既有事实，防后人顺手「修」错）**：
  1. 代码块在 eink 是**两层**——底板（`::before`，本批归位的那处，白）与**行区带**（`::after`，
     读 `--code-bg` = `#f0f0f0` 的灰）；`restyle-eink` 规则⑤的用例把这条写成断言（「只有底板翻转」），
     `--code-bg` 在本档另有消费者（行区带、变量绑定底纹 `theme.ts:108`、mermaid 集群底色）。**MUST NOT
     把 `--code-bg` 一并翻白**——场景为此单列一条断言钉住行区带的值。
  2. `.lumir-codeblock-fs-content`（全屏）是**单层**（整块白，没有行区带那一层）——两处取同一 token，
     但形态不同，改一处不应推及另一处的层数。
- **判据与证据**（`test-results/m294/`）：
  - 新场景 `tests/visual/scenes/m294-surface-and-foreground-literals.spec.ts`（6 用例 = 2 组 ×
    3 主题：面族 4 处 / 前景 1 处）。两层判据（M293 同形）：① 计算色 == 归属 token 的计算值；
    ② 把归属 token 改成三主题都不用的探测色 `rgb(7, 8, 9)`，元素计算色 MUST 跟着变——**写死字面值
    的声明不会变**（②用 `expect.soft`，让五位落点的失败在同一轮日志里各自可见）。
  - 先红后绿（同一份 spec，`git stash` 掉 `src/` 前后各跑一轮）：`before.log` = light / dark 4 条绿 ·
    **eink 2 条红**，红点全落在 ②——「代码块底板 / 全屏代码块内容容器 / callout 行底色 / frontmatter
    盒底色 / callout 类型标签」五处**逐一**读到写死的 `rgb(255, 255, 255)` / `rgb(0, 0, 0)` 纹丝不动，
    ① 全绿；`after.log` = 6 passed。
  - 三主题读数对照 `readings-{before,after}.txt`（6 行 = 2 组 × 3 主题，每行含 7 个表面读数 + 6 个
    token 计算值）`diff` **退出码 0、零输出行**（`readings.diff.txt`）。
  - **旁证（既有断言在原值层面照绿）**：`restyle-eink.spec.ts` 的规则⑤⑥用例断言的是**硬编码 rgb 值**
    （代码块底板白 / 行区带 `#f0f0f0` / frontmatter 白底黑框 / chip 1px 黑框）——本批若不值变它们必然红，
    它们照绿即「值不变」的第二条独立证据。
  - 门禁：视觉全量本地跑，**零基线 diff、未做任何 `--update`**；`cargo` 层未跑的缺口与理由同 M293
    （磁盘水位）——见本 mission 的 review-request。
- **核销**：本文件 M293 节的「本批不动（不属裁决的两族）」5 行全部核销；`docs/specs/design-tokens-v1.md`
  新增「面族与前景区位（v1.5 增补）」节，把这三族角色 → token 的口径与两条 MUST NOT 写成规则。

## M295 行内 code 药丸的选中态不可辨（2026-09-29，Alex 裁决「1. A。2. 顺手收 3. 认。」，已修）

- **现象（Alex 报告，附 light / eink 两张截图）**：「选中态的问题没有彻底解决，举例 1. 在图一中，
  light theme，我肉眼看不清选中了什么。（实际我选中了 tests/visual/scenes/paragraph.spec.ts，
  但分辨不出）2. 在图二中，eink theme，问题同上」。两张图都是列表项里的行内 code 药丸。
- **定性（绘制顺序，不是撞色）**：药丸自带的底色是 **in-flow 行内底色**（`--code-bg`），按 CSS
  绘制顺序排在 `drawSelection` 的负 z-index 选区层（`.cm-selectionLayer`，M288 实测 -2）**之后**
  ⇒ 药丸盒内读到的是药丸自己的灰，选中与未选中**逐像素同色**。与 M288（代码块内选区不可见）同一
  条机制；M291 已把这批「`.cm-content` 内的 in-flow 底色」登记为未收口，本 mission 收其中
  **行内 code 药丸**那一份。M285 的「逐字符覆盖」判据是**几何层**，对药丸**恒真**（带矩形确实
  盖着药丸，只是被药丸底色挡住）——这是本缺陷能长期假绿的原因，判据因此落到像素层。
- **修前读数（chromium，隔离端口，7×7 主色，与 M291 同口径）**：

| 读数 | light | dark | eink |
|---|---|---|---|
| 整行选中：选中药丸内 / 未选中药丸内 | `#f2f1ec` / `#f2f1ec` | `#5a5b5d` / `#2d2e31` | `#f0f0f0` / `#f0f0f0` |
| 同一选区在药丸外的带色 / 纸 | `#c6c5bf` / `#fdfdfc` | `#525355` / `#222326` | `#b9b9b9` / `#ffffff` |
| ① 选中 vs 未选中药丸（判据 ≥ 40） | **0 ✗** | 45 ✓ | **0 ✗** |
| ② 选中药丸 vs 药丸外的带（不透明档 ≤ 8） | **45 ✗** | （本档相对判据） | **55 ✗** |
| 选中药丸内字形跨度（M291 不变量 ≥ 60） | 201 ✓ | 129 ✓ | 230 ✓ |

  选区**恰好等于药丸**（Alex 的现场形态）时：带矩形 x `464..777` **完全落在**药丸盒 `459..782`
  内部 ⇒ 没有一像素露出药丸，肉眼完全看不出选中（light / eink 差 0）。
- **顺带纠正一件旧事**：Alex 早先裁「不立」的「药丸 padding 窄条不染色」**不是带的几何缺口**——
  带矩形按文档位置算、边界落在**文本盒**上；整行选中时带矩形 `399..876` 覆盖药丸**整个盒**（含
  左右各 5px 内边距），只是那一段被药丸自己的底色盖住了。旧判断的现场与真因不一样。
- **修法（token 层零新增色，不动明度梯队）**：**选中的药丸 = 选区带的一部分**——被选区盖住的
  那一段底色**换挡到 `--sel-band`**（`--sel-band` 的第二处消费者）。落点：
  - `src/preview/livePreview.ts` 新增 `pushInlineCodeMarks`：InlineCode 分支按**活选区**
    （`view.state.selection`，不用 reveal-gate 的按压快照——本改动不改布局，用快照会让药丸高亮
    滞后到 mouseup）与药丸区间求交，拆成 ≤3 段 mark（覆盖段 / 左未覆盖段 / 右未覆盖段）；
  - `src/preview/theme.ts` 三条类：`.cm-lp-inline-code-sel`（覆盖段 = `var(--sel-band)`）、
    `.cm-lp-inline-code-flat-left` / `-flat-right`（**不落在药丸左 / 右端**的段：内边距与圆角归零）。
- **三条不变量**：① **零基线 diff**（类只在「选区与药丸相交」时挂上，静止帧逐像素不变）；
  ② **零几何位移**（拆段的 padding/圆角按「内边 0」重分配：原 5+5 → 5+0 / 0+5，段宽总和与拆前
  逐值相同、字形坐标不动——M259 按压窗口的前提）；③ **逐字符精确**（部分选中时未覆盖段保持药丸灰，
  「选区内每个字符显示选中底色」与「选区外不得出现选中呈现」两向同时成立）。
- **修前 → 修后读数（同一台机、同一 fixture、同一采样口径）**：

| 判据 | light | dark | eink |
|---|---|---|---|
| 整行选中：选中药丸内 | `#f2f1ec` → **`#c6c5bf`** | `#5a5b5d` → `#78787a` | `#f0f0f0` → **`#b9b9b9`** |
| ① 选中 vs 未选中药丸（≥ 40） | 0 → **45** | 45 → **75** | 0 → **55** |
| ② 选中药丸 vs 药丸外的带（≤ 8） | 45 → **0** | （相对判据 37 ≥ 16） | 55 → **0** |
| 选中药丸内字形跨度（≥ 60） | 201 → 159 | 129 → 101 | 230 → 178 |
| 选区 == 药丸时药丸内 | `#f2f1ec` → `#c6c5bf` | → `#525355`/`#78787a`/`#525355` | `#f0f0f0` → `#b9b9b9` |
| 部分选中：覆盖段 / 未覆盖段 | `#f2f1ec`/`#f2f1ec` → `#c6c5bf`/`#f2f1ec` | → `#78787a`/`#2d2e31` | `#f0f0f0`/`#f0f0f0` → `#b9b9b9`/`#f0f0f0` |

  dark 的选中态药丸读到 `#78787a`（`--sel-band` 的半透明白叠在带之上）⇒ 与带（`#525355`）差 37、
  与未选中药丸（`#2d2e31`）差 75：本档的带是半透明，合成色随承载面变，判据用**相对判据**（M288
  对 dark 的同一登记）。顺带修正一处推测：本 mission 的方案预估 dark 的选中态可辨差为 75 ✓、但与
  带的差 37（不是 0）——因为药丸的两端 5px 内边距落在带的 x 之外，读到的是 `.22` 叠在纸面上的色。
- **纯 CSS 不可达（三条实测理由，防后人重试）**：原生 `::selection` 被 CM 的 `hideNativeSelection`
  以 `!important` 置透明（M291 已实测「裸声明永远输」）；抬选区层到文字之上会盖住字（M288 明文
  禁止）；`mix-blend-mode` 会改静止帧的渲染色（与承载面耦合，light 的纸不是纯白 ⇒ 静止帧不再逐值
  不变）。**被否的候选**：① 让位（覆盖段 `transparent`）——带的边界落在文本盒上，药丸两端会各露
  5px 纸色缺口；② 保留药丸块的第三档面色——light / dark 的既有档位里没有一个值与药丸灰、带色
  都拉开 ≥40（light：`--sel` 距药丸 11、`--border` 15、`--text-3` 距带 36；eink 只有
  `--tk-c`/`--text-3` `#6e6e6e` 数值上够，但黑字压它约 4.1:1、会破 M291 的「药丸里的字可读」），
  要新增明度档位 = design system 改动 ⇒ Alex 裁决取 A、不走此路；③ 选中态文字反色——M291 已把
  「黑底反白」整条退场。
- **同场收 M294 的 finding（Alex 裁决「顺手收」）**：`eink + editor.code_block_wrap: true` 时
  规则⑤ 的黑框无处可挂（容器按既有口径不装）⇒ 折行档的 eink 代码块是「无框的 `--code-bg` 灰带」。
  修法：框改挂 `.cm-lp-codeblock-slot`（`--border` 1px + r8）。**白底半边在折行档不可表达**（如实
  登记）：容器档靠容器那一圈 padding 让底板（容器盒）与行区带（容器内容盒）分成两层，折行档没有
  容器、**slot 盒与行盒并集逐值重合**（实测两侧同为 slot 盒）⇒ 两层无从分开；且本档 `--content-bg`
  与纸面同值（写上去 = 零消费者的声明，REVIEW.md 第 9 条）。因此折行档保留 `--code-bg` 行区带、
  只补框——这也保住了 m288 的「块底色 MUST 与块外正文可辨 ≥ 8」不变量（若把行区带翻白，该断言
  当场红：白底压白纸 = 差 0，整块只剩框）。**残差**：eink 折行档与容器档的差异只剩「白边那一圈」。
- **判据与证据**（`test-results/m295/`）：
  - 新场景 `tests/visual/scenes/m295-inline-code-pill-selection.spec.ts`（**7 用例**）：三主题 ×
    整行选中（① 可辨 ≥ 40 + 反向对照）、三主题 × **选区 == 药丸**（Alex 现场形态）、light / eink
    绝对判据（选中药丸 == 药丸外的带，≤ 8）、三主题可读性（跨度 ≥ 60，M291 的不变量不许退化）、
    **零几何位移**（选区进 / 出药丸时药丸盒与两侧字符格逐值相等）、区分度自证（注入修前形态后
    ① 判红）。**先红 4 failed / 2 passed（提交 `c538e6f`）→ 修后 7 passed**，同一份判据闭环。
  - `tests/visual/scenes/restyle-eink.spec.ts` 新增「规则⑤（折行档）」用例：容器 MUST 缺席（前提
    防空转）+ 计算色 == token（框 = `--border`、行区带 = `--code-bg`、r8）+ 像素层（框那一列读
    `#000000`、框内读 `#f0f0f0`）+ 区分度自证（按回无框形态后框那条判红）。
  - **一处既有断言按新口径更新**（M291 的 spec）：`m291-selection-contrast.spec.ts` 的
    「区分度自证」用例在 eink 段追加 `.cm-lp-inline-code-sel { background-color: var(--code-bg)
    !important }`。理由：M295 起药丸的选中底色跟随 `--sel-band`，而该用例的注入把 `--sel-band`
    设成纯黑（造 M291 的修前形态）⇒ 药丸跟着变黑，白字压黑底跨度为 246、自证反而假红。**只补
    这一条构造、不动任何阈值**——判据与口径不变，变的是「修前形态」得怎么造。
  - 门禁：视觉全量本地跑（隔离端口）**587 passed / 1 skipped**（1 skipped 与 M294 基线同）、
    **零基线 diff**（54 张基线 sha256 逐字节相同、未做任何 `--update`）；quick 层非 Rust 部分全绿；
    `cargo` 层按磁盘水位未跑（同 M293 / M294 先例，`src-tauri/` 零改动；旁证是本次真机运行完成了
    一次成功的 `cargo build`）。真机运行把 `CARGO_TARGET_DIR` 指向主仓的 warm target（零 Rust 改动
    ⇒ 产物等价），以避开本 worktree 的首次全量构建（磁盘 3.6G，REVIEW.md 第 12 条）。
- **真机复验（scenario 68，1/1 PASS，100.0s）**：before / after 读数——light 药丸内部 `#f2f1ec`
  → **`#c6c5c0`**（= 药丸外的带色，逐值相同）、eink `#f0f0f0` → **`#b9b9b9`**（同上）、dark
  `#5c5b5d` → `#79797b`（与未选中药丸差 75）。before 侧复用 M291 的 after 轮 scenario 68 截图
  （同一台机、同一 fixture、同一口径；M291 分支即「M295 之前」的状态）。**覆盖边界**：scenario 68
  的形态是「选区**跨过**药丸」；Alex 现场的「选区恰好等于药丸」与「部分选中」两种形态**没有既有
  验收场景**，而 `scripts/acceptance/scenarios/**` 不在本 mission scope 内 ⇒ 这两种只有 chromium
  读数（要补真机读数需给临时探针场景的写权限，M291 r3 用过该路径）。
- **仍在册未收口（同一机制，另立）**：`.cm-content` 内的其他 in-flow 底色——**callout 行底色**
  （含族 tint）、**frontmatter 区**、**code 模式的变量绑定底纹**（`.cm-lp-code-binding`）——三处与
  药丸同机制（选中时读到的是自己的底而不是带色）。callout 行在选区内是「整行染色」还是「随带」
  需要先定语义；不在 M295 面内。另：本 mission 未测**药丸折行**（同一药丸跨行）的形态。

## M296 大 vault 打开忽略集的验收半边（2026-09-29，**真机批 7/7 PASS**；收窄在验收 vault 上量不出来）

对应 change `openspec/changes/vault-open-ignore-set/`（M290 提案 / M292 实现）。本 mission 是它的
**验收半边**：把提案的三组判据落成真机可执行场景，外加多 vault 回归与性能复采。**产品代码零改动**。

### 1. 场景 67 落地（三组判据）

`scripts/acceptance/scenarios/67-vault-open-ignore-set.md`（35 步，47 条断言全绿）：

- **两类忽略的可见性**：内置规则命中的 `target` / `dist` / `test-results` / `node_modules`
  **不在**树里——且 fixture 根 `.gitignore` 里那条 `!target/` **取反也放不回来**；用户规则命中的
  `.local`（根 `.gitignore`）与 `.excluded-dir`（根 `.git/info/exclude`）**行在**树里、展开后
  `.local/tutorial.md` 行出现、点开后正文「本地教程正文」进编辑器。
- **外部写入不产生幻影行**：`target/probe.md`（子孙事件）与 `.venv/probe.md`（**新建**一个内置
  规则目录——r2 评审 P1-2 的直接形态），同一步配 `external-probe.md` 正见证证明事件已被处理。
- **打开段不冻结界面**：放大器撑开的 ~8s 窗口里同一份 AX 快照同时读到 `AXProgressIndicator`、
  界面节点、以及「此刻入口仍是 B」的**时间见证**（证明快照取自提交之前）。

配套的生成器扩展（`generateBulkVault` 新增 `ignoredDirs` / `lazyDirs`，只在 JS 侧——Rust 读数
harness 不生成忽略探针，它们不参与读数口径）+ `--check` 的对应校验 + 套件 README 的 2 处口径更新，
细节见 change 的 `acceptance-scenario.md` 顶部「落地记录」。

### 2. 真机批：**7/7 PASS**

`node scripts/acceptance/run.mjs 67 16 17 19 25 48 60`（实际执行序 16→17→19→25→48→60→67），
证据 `test-results/acceptance/2026-09-29-final/`（git 外）。**多 vault 回归 16 / 17 / 19 / 25 / 48 / 60
全绿**——其中 **16 / 19 / 25 / 48 首跑（batch1）即绿，17 / 60 在 rerun1 转绿**；场景 67 **经两处形式
修复后转绿**——它的首绿在 rerun2（batch1 与 rerun1 都红，见下表与 §1 的三份复跑目录）。

首跑（batch1）是 4/7（17 / 60 / 67 红），三处红**全部是套件的等待/断言形式问题，产品零缺陷**——
M292 把打开段移出主线程之后，`do: settle`（判「界面此刻静止」）不再顺带兼任「等装载跑完」：

| 红项 | 根因 | 修法（只改形式，判据语义不动） |
|---|---|---|
| 60 / 67 切换后的终态断言 | 装载期间界面保持响应、AX 快照逐字节一致 ⇒ `settle` 在装载**途中**返回（返回时仍是旧 vault + 指示在场） | 新增 `do: waitFor`（轮询可观测终态：入口按钮换成目标 vault + 指示退场） |
| 17 的浮层开合 | `Esc` / `⌘O` 都是**盲发 chord**，紧随的 AX 读取与「按键被处理」那一拍抢，两个按键叠在一起 | 两次按键各自 `do: waitFor` 确认生效 |
| 67 的完整性见证 | AX 新见一种截断源 `truncated: [closed_menu, fanout_cap]`：根节点子行列表按上限截断，字母表靠后的 `var-highlight.md` 被截掉 | 见证改取文件组**首行**（`block-copy.md`）+ 目录组末行（`area-23`） |

**新增能力 `do: waitFor`**（`scripts/acceptance/lib/execute.mjs`，约 30 行）：轮询 `has`/`not` 两份
字符串清单直到成立，超时**抛错判 FAIL**（不静默），成立时把「第几次读取成立/耗时」记进证据。
套件 README 的「动作」表、`settle` 行与新增的「`settle` 不是等异步活儿干完」一节是它的 canonical
居所；`fanout_cap` 那条截断边界也写进了 README 的「已知边界」。

### 3. 性能读数：**`#[command(async)]` 成立；忽略集收窄在验收 vault 上量不出来**

读数与完整口径见 `test-results/m296/readings.md`（+ `readings.json`），要点：

| 读数（同形状、同通道） | M292 前 | M292 后 | 结论 |
|---|---|---|---|
| bulk 验收 vault 的「切回」打开段（`vault_load_open`） | **616.0ms**（2026-09-28 批） | **647.0ms**（最终批）/ 639.0ms | **+3~5%，噪声内** |
| 同段期间界面可响应 | 主线程被同步 command 占住，快照只回 `element_count: 1`（M283 实测，判不了） | 装载全程 AX 可读（67 的三条判据） | **质变，本批最强实证** |
| `vault_scan_ignored`（内置规则剪掉的内置名条目数） | —（本 change 新增的事件名） | 验收 vault **1**（只有 `node_modules`）/ 带探针时 **5**、外部新建 `.venv` 后 **6** | 机制在跑、计数对得上 |
| **release harness 的 Rust 侧合计**（`scan + build_graph`，2,142 文件形状，5 次中位） | **92–107ms**（M283 时代同形状） | **82.3 / 81.4ms**（本实现两次跑） | **同量级、无回退**（change tasks 8.3 的复采落地） |

**为什么收窄量不出来**：验收 vault 的可见集本来就等于真内容，**没有可剪的子树**——收窄收益是
「被剪子树有多大」的函数。真形状上的收益有既有读数（M289 harness，release，166,626 文件 /
200,274 条目的复刻真 vault 形状）：`scan 1,231.1 + build_graph 1,879.1 = 3,110.2ms` →
收口后 `14.0 + 51.7 = 65.8ms`（change `design.md` §1）。本批**没有**在验收环境重建那个量级的形状。

**如实入档但不作结论**：20×8MB 放大器把打开段撑到 M292 前 **4,474ms** → M292 后
**7,619 / 7,643 / 7,915 / 7,953 / 7,986ms**。两个数**不可比**（放大器读数按场景 60/67 的明文声明
不是规模口径；两次 RUN 相隔 3 小时、机器负载不同，而该段是 debug 构建下对 160MB 零填充 md 做
正则解析，纯 CPU、对负载敏感）。这是本批唯一一个「看起来是回归」的数字，**没有机制支持**，也不
构成结论。

### 4. 本批现场发现（已登记 / 已收口）

- **验收 vault 根下的非 `.md` 残留不被 `resetVault` 清理**（low，会咬人的口径）——见「待修 findings」
  的同名条目；套件 README 里「重置为 fixtures 的精确副本」这句不准确的表述已改准。
- **`settle` 不能当「等异步活儿干完」用**（§2 第 1 行）——已固化进套件 README 的「动作」表与
  「已知边界」，连同 `waitFor` 的正确用法。
- **AX 快照的 `fanout_cap` 截断**（§2 第 3 行）——已写进套件 README 的「已知边界」，含
  「负向断言的完整性见证要取被截断方向的反面」这条可执行口径。

### 5. 仍未完成（如实登记，MUST NOT 读成已覆盖）

- **change tasks 8.3 的读数复采：部分完成**。`src-tauri/tests/vault_open_readings.rs`（M289 的
  release harness）**已在本实现上跑通两次**（Rust 侧合计 82.3 / 81.4ms，与 M283 时代的 92–107ms
  同量级 ⇒ 无回退），原始输出 `test-results/m296/rust-harness-release.txt`。**未跑的是「主动枚举量
  收窄后残余」那一档**（166,626 文件量级）——harness 自身只生成 2,142 文件的形状，本 mission 未重建
  那个量级的 fixture，因此 `design.md` §1 的 65.8ms 仍是 M289 的手工收口数，**不是**本实现的实测。
- **change tasks 8.4**：Alex 在本机切一次真实 vault 后 grep 四条读数——**agent 不能打开他的真实
  vault**（会写 registry / `last_vault` 到 `~/.config/lumir`），由 tower 另行向他收取。
- change 的归档（§10 / §11 的门禁项）不在本 mission 面内。
