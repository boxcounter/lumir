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
- 证据：`tests/visual/playwright.config.ts:9-14`（现行 0.001 及其来历）；提交 `c9a3c20` / `736b3f7` / `d439184`；`docs/backlog.md:213`。
- 防线：下次动容差、或加会删/移 UI 的场景时，本地先把该元素删掉跑一次，确认门禁确实 FAIL；删 UI 后逐一核对该元素出现过的所有整页基线时间戳是否随本次更新。

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
- 证据：`docs/backlog.md:115`；提交 `e5ef190`、`6ed8a63`、`6d48d47`（都是把数字/表述改准的收口）。
- 防线：下次写「已验 / 已覆盖」时逐条给出证据指针（场景名 + PASS 计数），拿不出 PASS 证据的一律写「未验」；跑完回来核对文档数字与证据目录一致。

**7. 证据只在终端跑过，没落成文件或指针已失效**
- 症状：评审复验发现报告里声称的证据目录不存在（M143 r1 P2-1）；另一处证据实际留在 worktree 内，worktree 清理后指针失效（M138 r1 P2-2）。
- 根因：自报证据不落盘，或落在会被清理的位置——合并评审无从复核。
- 证据：`scripts/acceptance/README.md:123`（证据布局）与 `:196`（「重试次数写进证据」）；`docs/backlog.md:204`（`_type-retry-unit/` 8 判定落盘的终态）；AGENTS.md 硬规则「批次收尾顺带 `git push origin master`」（同族：落地动作无人校验）。
- 防线：下次声称「跑过了」之前，用绝对路径 `ls` 一遍自己写下的证据路径再写进报告；证据落在 `test-results/`（本地留存、git 外）而不是 worktree 内；写不出可 `ls` 的指针就等于没跑。

**8. 同一语义两处真源，改动只落到一处**
- 症状：frontmatter 行数上限 `src/preview/wikilinks.ts:19` 是 200、`src/preview/frontmatter.ts:19` 是 512；`src/editor.ts:878` 与 `src/preview/code.ts:46` 各有一份着色语言表（后者注释自认「与 editor.ts 同批」）；扩展名集合也漂过（`e33e10b` 收敛过一次）。
- 根因：没有单一来源，跨文件一致性没有门禁。
- 证据：上列 file:line（本仓现值）；`docs/backlog.md:42-43`；提交 `e33e10b`。
- 防线：下次改「语言 / 扩展名 / 上限」这类表时先 `rg` 全仓确认是否已有同类表，只改一处就不算完成；发现存量两份时写进 `docs/backlog.md` 收口，不要就地再抄一份。

**9. 值或开关声明了却没有消费者**
- 症状：`src/preview/table.ts:37` 的 `"incomplete"` 在类型联合里、生产从不产出、`src/` 零消费者；`editor.measure` 能在 config.json 里配、还给校验 warning，但完全不生效（假开关）。
- 根因：数据结构先于消费者落地，没有「声明即被消费」的检查。
- 证据：`docs/backlog.md:40-41`；`src/preview/table.ts:37`；现场 `.tower/comms/findings/20260912-worker-hygiene-improve-src-tauri-editorconfig-measure-css-measure.md`。
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
- 证据：`docs/backlog.md:102-108`；`scripts/acceptance/README.md:177-199`。
- 防线：跑真机场景前确认 1420 与 1430 都没有 Lumir 实例；断言走「回读 + 只在字节未变才重试」，不用重试次数当判据；失败先按丢键复跑一次再判产品缺陷（同一场景曾 M138 FAIL、M142 PASS）。

**12. 磁盘水位与并行 worktree 的 target 预算**
- 症状：磁盘 <1G 时 ENOSPC 硬阻塞真机批次（219MiB 时 `pnpm tauri dev` 因 vite 写临时文件失败而中止）；建到一半 ENOSPC 会留下半截 target 且不回血，比不构建更糟。
- 根因：每个 worktree 各带 1.5–3G 的 debug target，磁盘是单例资源，预检是事后长出来的。
- 证据：`docs/backlog.md:77-86`；`scripts/acceptance/README.md:35`。
- 防线：起真机实例前 `df -h` 看水位，worktree 首次构建按 ≥3G 估；空间不够就只跑 chromium 视觉门禁，并在报告里如实声明覆盖范围，不写「全量验收」。

**13. 测试或套件污染真实环境、场景间串场**
- 症状：一个中间版本让单元测试把 13 行事件写进真实 `~/.config/lumir/logs/`（M134）；验收套件不清 `recovery/` 时 08c 恢复出了上一场景的 vault 内容；视觉门禁默认 4173 被别的 worktree 的 `vite preview` 占着，`reuseExistingServer` 复用别人的 dist，对比对象不是本次构建。
- 根因：并行 worktree + 真实主机，隔离没写进预检，靠事后逐条补。
- 证据：提交 `58b54bd`；`scripts/acceptance/README.md:51-53`；`tests/visual/README.md:53-55`；`tests/visual/playwright.config.ts:3-4`。
- 防线：下次写会碰全局状态的功能时，先确认落点在 `XDG_CONFIG_HOME` / 临时目录而不是 `~/.config`；跑视觉门禁前设 `LUMIR_VISUAL_PORT` 并确认无人占用；结论异常时先查 dist 是不是本次构建的。

## 维护

- 重复踩到表内某条：把新现场（commit / 证据路径）补进该条的「证据」，不要另起重复条目。
- 新坑：过门槛才收；能固化的部分落进 canonical 文档（门禁脚本、README、backlog），本表只留「开工前检查」这一层。
