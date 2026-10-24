# Backlog — findings 与待裁决队列

唯一的积压载体（2026-09-16 起自 HANDOFF.md 迁入并入 git）。**每条只留一行 gist + 证据指针**——正文细节由 git 历史（`git log -p -- docs/backlog.md`）与 `.tower/comms/findings/` 承担。

维护规则：

- 新 findings 由发现者（worker / reviewer / tower）落成条目，注明**来源 mission/批次**与**日期**；HANDOFF.md 只记 session 状态，不再积压。
- 条目状态：`待裁决` / `待修` / `待验收` / `记录在案` / `已立项`；每条尽量附复现与证据指针，裁决类条目给出选项与推荐。
- **核销即删除、不留索引**（2026-10-12 Alex 裁决）：条目一经核销 / 裁决落地即从本文件删除——git history 就是台账，不再有「已核销」区。**唯一例外**：条内含仍在生效的长期口径（将来约束行为的裁决原文）时，移到「承接残项」保留，不擅自迁进其他文件。
- **待裁决准入标准**（2026-10-12 Alex 认可）：进「待裁决」区之前先答「**这题的答案客观可核吗**」——**客观可核**的由 tower 直接裁并记录（可翻案），不进区；只有**价值取舍 / 产品语义**类才进「待裁决」等 Alex。
- **批次报告与总表不留正文**：mission 批次报告、全量回归总表只留一行指针（git 历史 / `.local/` / `.tower/`）。
- **只记改变未来动作的信息**（2026-10-16 Alex 裁决）：条目内容限于结论 / 待办 / 裁决点 / 复现与操作口径；过程性状态（「某项验证跑完、PASS」类）不入账——过程与证据的居所在 git 历史、`.tower/comms/`、`.local/`。已有结论被新证据再次确认时不追加补记；仅当新证据**推翻或收窄**结论时才改写条目。HANDOFF.md 同口径。
- **finding 落账率对账**：批次收尾核对本批 `.tower/comms/findings/` 新增文件数与 backlog 新增条目数一致，不等即查漏（漏落账的 finding 等于没登记）。
- **体量红线 300 行**：全文超 300 行（Alex 2026-10-12 裁决，自 1000 下调）即触发一次结构清理，批次收尾检查一次（`wc -l docs/backlog.md`）。红线是闹钟不是删除规则：触发后若无核销/僵尸项可清，记一句「已查、无僵尸」即过，**不为压行数删活条目**（删除判据仍是核销/僵尸，不是行数本身）。
- **引用 backlog 条目用主题关键词锚**（形如「backlog『内存合同存量超标』条」），MUST NOT 用编号或行号——编号会重排、行号每次改动都漂移（唯一例外：验收场景 front-matter 的 `item:` 字段指向「待真机验收」节的清单项，属套件机制，见该节）。

## 归档跟踪队列（oct24 批剩余：权限链 2 项，tower/agent 记账，不进待裁决区）

口径 = `docs/process/openspec-workflow.md` 的「批次收尾 checklist（归档跟踪）」：每条一行、可客观核对。**「序 N」即批次原始归档顺序**：同 requirement 多 change 时后归档者整块替换前者，删增段数相等时对账门禁按位置配对判「改写」放行（`openspec-workflow.md` 已知边界），顺序只能靠人盯。oct24 批的序 1–9（9 项）与补登的 6 项已于 2026-10-24 归档（节点 2 = Alex 原话「第一组和第二组都可以归档了。」），台账随核销删除。剩余两项也都不满足节点 2 的机器判据替代（都有实质改动的 MODIFIED），节点 2 仍走 Alex 人肉评审。

**权限链阻塞（顺序 M649 → 序 10 → 序 11）**

- **序 10 · `readonly-allowlist-tightening-oct23`**（M664，16/22）：6 项未勾（1.11 安全前提 / 2.3 证据布局 / 3.1 四者一致 / 3.2 顺序处置 / 3.3 finding 落账 / 4.4 真机），场景 231 从未跑过、无证据目录；归档前 MUST 把 MODIFIED 块重写为「master 原文 + M649 解包段 + M664 收紧段」，否则 M649 的解包段会被按「改写」配对静默抹掉而门禁不判。
- **序 11 · `rg-zip-flags-dangerous-oct24`**（M672，11/11）：delta = 序 10 全文 + `-z` / `--search-zip` 两段改写，**必须紧接序 10**；反序时 `-z` 同样被「改写」配对静默抹掉。

**外部前置（不计入本批）**：`harness-permission-rules-oct23`（M649，33/36）须先归档——4.3 已至少被 229 真机 PASS（31 断言，2026-10-24T01:59Z）覆盖，是否足以勾选由 M649 属主按任务原文（「真机跑一遍套件」）裁定；6.2 是归档时改 Purpose。`quick-open-file-oct23`（40/42）同样可先归档（其 delta 自注「归档顺序无关」）。

**本批新完成（无批次序，节点 2 待评审）**

- **`fix-quote-decode-error-copy-oct24`**（M686，tasks 全勾）：引用路径的 `attachment_decode_failed` 改读 D588（「无法解码这张图片」），粘贴路径的 D438 一字不动。delta 是**一条 ADDED requirement**（无 MODIFIED 面，不存在整块替换丢段的风险）；设计依赖链 `add-image-quote-to-chat` → `quote-pipeline-consistency-oct24` → `svg-image-quote-oct24` 已由 M685 归档完毕，顺序无冲突。节点 2 仍走人肉（ADDED 有新增内容，机器判据只证「没丢段」、证不了「新增面是对的」）；归档前后各跑一次 `node scripts/openspec-archive-check.mjs`（无参门禁模式 + `--archived fix-quote-decode-error-copy-oct24`）。

- **`semantic-selection-markdown-oct23`**（M687，28/29；4.5 dogfood 归 Alex、本 mission 不代判）：指针选区的语法包裹外扩（release-snap）——拖选 / 双击结束的**同一事务**把选区扩到被完整覆盖构造的节点范围（封闭集合：ATX 标题 / 强调系 / 标准链接与角括号字面链接），M259 按压布局、M539 空光标修正、M285 选区即高亮三条边界不动。delta 是**一条 ADDED requirement**（无 MODIFIED 面）；机器判据：单测 20 条、chromium 结构场景 `tests/visual/scenes/m687-semantic-selection.spec.ts`（7 条，含断开接线 / 去掉只读门控即红的反向读数）、真机场景 233 PASS（双击 → 摘录 → composer 卡片逐字 `**粗体词**`，编辑器 48 字节与磁盘 sha256/mtime 未变）。r1 返修：去轮数上限（深层嵌套一次到不动点）+ 只读会话门控 + WKWebView 时序探针（shipped 稳态 354ms / 推迟外扩对照 658ms，判据有区分度）。**待 Alex dogfood**：拖选标题 / 粗体松开观感（现状本身有一次 ~350ms 的 Quote 钮 settle、外扩未新增排期）、带 URL 链接整条引用的噪声、编辑时替换外扩选区的代价（D1 的字面后果）。节点 2 仍走人肉（ADDED 有新增内容）；归档前后各跑一次 `node scripts/openspec-archive-check.mjs`（门禁模式 + `--archived semantic-selection-markdown-oct23`）。

## 待 Alex 裁决

只收**价值取舍 / 产品语义**类（客观可核的题由 tower 裁并记录，见维护规则）。

- **harness ctx% meter 的分母口径（主问题已由 change `add-harness-chat-completions-dialect` 收口，2026-10-17 根因调查定论）**（M463/M464，2026-10-12）：原结论「端点实际生效输入上限 ≈ 名义窗口 38%」**已作废**。根因已钉死为 kimi coding 端点 **Responses 路径的前置请求体字节闸**——按请求体 UTF-8 字节数判定，边界实测 `(417,231, 417,512]` 字节；报错文案里的 262,144 是名义窗口、不是闸的计数单位（决定性证据：417,985 B 纯英文合成请求外推仅 ~8.1 万 tokens 仍被 400，而 104,571 tokens / 417,231 B 的请求通过）。同账号同模型走 **Chat Completions** 实证服务到 211,055（普通轮）/ 234,656（压缩轮）input tokens、请求体 0.83–1.1 MB 放行 ⇒ 41.7 万字节是 Responses 方言专属，非账号/模型上限。**结论：chat 方言下 `input_tokens ÷ 262,144` 的分母恢复诚实，`warn_ctx_pct`（默认 85%）重新可达、主动压缩恢复有效**；Responses 方言下 85% 预警结构性不可达（触发需 ~89 万字节请求体），只剩 400 错误路径兜底。切换开关 = `[harness].providers.<id>.wire_api`（回退成本为零）。调查谱系（M464 三发 + 2026-10-16 第四发证伪「reasoning 语义专属计账」、闸口径比 usage 口径密约 2.5 倍；Kimi Code 对照证实差异在两种协议方言的服务端闸口径）见 `.local/probes/m464-probe/`、`.local/probes/ctxdiag-2026-10-17/`、`.local/probes/k3-256k-overflow-2026-10-14/`（均 git 外）。
- **超限时 meter 是否同步读数（待裁，独立子问题）**（2026-10-18 从上方条目拆出）：现行错误路径 return 早于 `record_usage`，**超限那一轮的 usage 读数停在旧值**——是否改为错误轮也同步读数（以及读的是什么数）仍待 Alex 裁决。不在 `add-harness-chat-completions-dialect` 范围内（该 change 只解决分母有效性）；落点 `src-tauri/src/harness/turn.rs` 的超限错误路径。
- **「在途停止丢掉该轮的 reasoning 回放项」是否触发 400**（M369，2026-10-07，medium）：未实测、**需真 API 才能定性**，下批排真 API 探针；在此之前 MUST NOT 当缺陷修。落点 `src-tauri/src/harness/llm.rs` 的 `parse_sse_reader` 与 `turn.rs` 的 `abort_turn`。指针 `.tower/comms/findings/20261007-worker-sts1-improve-reasoning-provider-backlog.md`。
- **M251 的两张菜单基线（23px 真实差异）是否重建**（2026-09-27）：新高亮让菜单左上角圆角处透出的底色变化，未重建（零容差读数 `.local/missions/m251/baseline-review/tree-menu-menu-target/`）；基线更新是人肉裁决点。
- **共享 `CARGO_TARGET_DIR` 与 dev-only 脚本化驱动入口**（工具链节 2/3 的长期候选）：是否立项待裁。副作用现状：跨 worktree 复用旧测试二进制曾致假绿（见「待修 findings」的同名条）。

## 已裁已立项（落地由 tower 派发的 mission 承担）

- **左栏文件拖拽移动 = 产品缺陷，已修复**（2026-10-16 Alex 手拖定性 → M537 合并 `448e3e3`）：根因 = Tauri v2 默认 `dragDropEnabled=true`，wry 的 WKWebView 子类把窗口注册为 OS 拖放目标且 handler 无条件吞拖（返回 Copy 不调 super），页内 dragover/drop 整轮不运行——与 Alex 手拖症状逐点吻合（浮像 ✓、绿色加号 = Copy、无高亮、不落盘）。修复 = `tauri.conf.json` 窗口级 `dragDropEnabled: false`（tower 裁决取 A 不取 pointer 重写；代价 = Finder 拖入关闭，全仓证零消费者）。场景 159 修复后**全自动 56/56 PASS**（M530 功能史上首次端到端成功；合成 drag 通道在 WKWebView 可走的更正一并落实）。**尾巴：主路径 Alex 手拖复验通过（2026-10-16）；根落点（M538 合并 `0db3dc9`：vault 名行 + 列表尾部空白两处落根，159 新增三档全自动）待 Alex 手拖复验**。原 finding 指针 `.tower/comms/findings/20261016-worker-scenfix-bug-html5-dnd-dragover-vs.md`。
- **验收套件 harness 透传面缺 `permission_mode` 键 + 72/73/74 场景期望过期**（agent-m480，2026-10-13）→ 由 M481 落地：app.mjs 透传面加 `permission_mode`、72/73/74 走 `read_only` 档复活批准流断言。归因：M407 权限模式（默认 vault_write 档库内写免闸，2026-10-09 Alex 裁决）合入后场景未回扫。指针 `.tower/comms/findings/20261013-agent-m480-improve-harness-permission-mode.md`。

## 承接残项（仍在生效的长期口径 + 未闭合尾巴）

- **版本号 bump 口径**：canonical = `docs/process/release.md`（M522，2026-10-15 合并 `a752b05`；批次收尾 checklist 已挂钩 `docs/process/openspec-workflow.md`）。要点：0.x 期间功能批 MINOR、缺陷批 PATCH；唯一真源 `src-tauri/tauri.conf.json` 的 `version`，bump 面 = tauri.conf.json / package.json / Cargo.toml / Cargo.lock 四文件（0.7.0 实证 `6579b64`）；视觉桩自 `9f19088`（2026-10-02 Alex 裁决）钉死 9.9.9 不跟随（跟随会让每次 bump 推动标题栏像素基线）。本条核销为指针（M522 finding `20261015-worker-release-doc-a522-bug-docs-backlog-md-bump-9f19088.md`：旧文仍要求视觉桩逐处跟改，与 9f19088 相悖）。
- **多标签会话恢复的观测缺口**：「上次恢复了几个标签、跳过了几个」目前只能靠真机截图与场景断言看——启动日志的 `session_restored{count}` 未实现（`src-tauri/src/logging.rs` 事件白名单没有它、`src/vault-switcher.ts` 恢复路径不发埋点）；补的落点 = 恢复结束时发一条 `log_event`（需同时扩 Rust 白名单）。光标位置与撤销史不恢复（决策 3 口径，未变）。
- **图片行显露口径**：Alex 裁 A = 维持现状（change `image-svg-and-fallback` 不动图片行）；「图片行是否与链接 / 分隔线同口径」留作将来单独立项，落点 = `src/preview/livePreview.ts` 的 Image 分支补 `touchesSelection` + `editor-live-preview` spec 的显露覆盖集枚举。
- **describe-config 面板**：Alex 裁「中期另立项」——照 `describe-bindings` 模式做「每键当前生效值 / 出厂值 / 改法」的面板；本批未做面板、未留钩子（config 参考文档那半边已由 M247 落地 `docs/specs/config-reference.md`）。
- **`vault-open-ignore-set` 归档件的未完成项**（M327 归档对账，medium）：7.2 与 9.3①②⑤ 的真机反向验证（先红后绿）未跑；10.4 的 `bash scripts/gate.sh visual` 未在触到 `src/tree.ts` 的 master 上跑过；8.3 的「收窄后残余」档（166,626 文件量级）未重建 ⇒ change `design.md` §1 的 65.8ms 仍是 M289 的手工收口数、不是本实现的实测。原 8.4（Alex 本机 grep 四条读数）已按 Alex 2026-10-12 裁决核销删除——`~/.config/lumir/logs/*.jsonl` 路径已过期、无输出。**建议**：前三项可并成一个小验收 mission（真机反向验证 + 视觉门禁 + 「残余档」合成复采）。证据：归档件 `tasks.md` 的就地注记 + `.local/missions/m296/rust-harness-release.txt`。

## 待修 findings（不阻塞）

一条一行（主题 + 来源/日期/severity + gist + finding 指针）；叙述与读数明细见 git 历史与指针文件。

- **两条既有配置写入口的读—改—写仍未同锁**（M615，2026-10-20，medium）→ `commands::write_last_vault_to` / `write_config_value_to` 的读发生在取 `CONFIG_WRITE_LOCK` 之前（读在 `src-tauri/src/commands.rs:571` / `:658`，锁只覆盖 `src-tauri/src/config.rs:1819` 起的写段），两个写者仍可各自读到旧版本、后写者把前者改动顶掉（丢键）。change `add-cron-conversational-registration` 只让新写者（调度工具）走 `config.rs` 的 `update_json_atomic`（读—改—写同锁，`config.rs:1826-1860`），旧调用方未迁移；迁移属独立收口（design §4.1 明示不在该 change 面内）。

- **验收套件零步骤场景静默 PASS（loader/--check 都不挡）**（worker-scenfix，2026-10-16，high）→ `steps:` 写到 front-matter 闭合 `---` 之后时整表被忽略（loadScenario 只取第一段），checkScenario 也不挡空 steps——场景 158 曾因此假绿、M529 修复当时真机未验（M535 已修场景本体）；修法 = checkScenario 挡「空 steps」+ loadScenario 对正文里顶层 `steps:`/`teardown:` 给定位提示，均静态零真机成本。指针 `.tower/comms/findings/20261016-worker-scenfix-bug-pass-loader-check-0.md`。
- **验收套件 file 断言一条只判一个键，多写静默失效**（worker-scenfix，2026-10-16，medium）→ `execute.mjs:1089-1145` 的 if 链命中即 return，README 要求的 unchangedSince + mtimeUnchangedSince 双对账写不出（M535 在 159 场景侧拆条规避，未修根因）；修法二选一（命中键逐条判 / --check 挡多键同写）。指针 `.tower/comms/findings/20261016-worker-scenfix-bug-file-readme-sha256-mtime.md`。
- **`src/ipc.ts:396` usage 事件联合类型欠声明 M526/M534 绝对值键**（worker-usagekeys，2026-10-16，medium）→ 类型层脱节（消费点走 `unknown` 故 CI/tsc 全绿，正是「声明了却没有跟着改」的静默面）；修法 = 补五键 + 注释指向 harness spec 的「事件/快照同键同值」不变量，改完跑 `pnpm exec tsc --noEmit`。指针 `.tower/comms/findings/20261016-worker-usagekeys-improve-src-ipc-ts-usage-m526-m534.md`。
- **format_argv（Rust）与 formatArgv（JS）的空白字符类边际分叉**（M528 r1 P2-2，2026-10-16，low）→ Rust `char::is_whitespace` 按 Unicode White_Space、JS `\s` 额外含 U+FEFF——含 FEFF 的参数一侧加引号一侧不加，与两处 doc comment 声明的「逐字一致」相悖；实际不可达（CLI 参数无含 BOM 的现实路径），登记即可。指针 `.tower/comms/reviews/review-feat-fix-transcript-toolcall-summary-and-tabl-reviewer-m528-r1.md`。
- **harness 浮动钮「恒在可视区」缺通用不变量条款**（M531 reviewer 建议，2026-10-16，low）→ Quote to chat 钮曾渲染到视口外（本批事项 8，M531 已修钳制）；建议 openspec/specs/harness 补一条通用条款——浮动操作钮 MUST 钳制在触发它的面板可视区内，下个动 harness spec 的 mission 顺手落。
- **视觉门禁固定端口跨 worktree 串扰**（M530 期两次踩到，2026-10-16，medium）→ 4273 被占时复用他人 dist 属 REVIEW.md 「测试污染真实环境」条同形态；候选处置 = 端口按 worktree 分配 / 强制 FRESH_SERVER。
- **harness usage 读数的跨层收口**（M533 裁决登记，2026-10-16，low）→ M533 后 `cacheTurn` / `cacheNote` / `cacheWrite` / `cacheWriteSession` / `cachedTokens` / `cachedTokensSession` 六键无上屏消费点、只进 JSONL 留存；前端映射按裁决保留（半截跨层删除更糟）。收口口径 = Rust 裁剪 + 前端映射裁剪 + 留存不动；附带清扫已退场行的文本面漂移 6 处（`src/harness-panel.css:1340`、`src/ipc.ts:393/505`、`src-tauri/src/harness/llm.rs:166`、`src-tauri/tests/harness_real_kimi_cache.rs:23`、`scripts/acceptance/lib/drive.mjs:614`、`tests/unit/README.md:28`）。指针 `.tower/comms/findings/20261016-worker-ctxslim-improve-m533-scope-d401-d452-d455-d466.md`。

- **场景 143 定案为产品 bug：composer 贴图后 1 秒内删卡的撤销语义错（high，M510 已修并合并 `367602a`，2026-10-14）**（agent-m508，2026-10-14）→ 删除族模型路径 `withModel(op, force=false)`（`src/harness-panel.ts` deleteAtCaret 两处 + 裸 Backspace 分支一处）撞 undo 1000ms 聚簇：贴图（force=true 压栈）后簇窗口内 ⌃H 删卡不入栈，⌘Z 弹回贴图前空态。回归面 = M447/M453（`1d063fd`），根因深化：M343 从未把聚簇语义写进 spec、「结构操作 force=true」只活在代码注释里。M510 修复 = spec 补条款 + force 单一真源（`STRUCTURAL_EDIT_FORCE` 常量，全 composer 结构路径 14 处 call site 清零字面量）+ 同机制另两实例一并修（kill 族选区档、⇧Enter 拆段）+ 红-绿单测 915 条；三处豁免（键入压栈/⌃T 转置/删除族空转空写）在 spec 点名。**M511 真机坐实（2026-10-14）：场景 143 PASS，「⌘Z 复原卡片」步转绿。本条核销。**指针 `.tower/comms/findings/20261014-agent-m508-bug-143-z-force-false-undo-m447-m453.md`。
- **场景 49「会话恢复丢非 md 标签」已定案并修复**（agent-m508/m511/m513/m514/m516，2026-10-14）→ 真因（M516 实测钉死，订正 M513 的「探测失败」推断）：套件 `fixtures:` 的非 md 文件在**起 app 之后**才拷进 vault（`execute.mjs` 的 `runScenario`），产品打开 vault 时那 3 个文件不在盘上，恢复探测**如实**判不在场并丢弃——探测没有失败。对照实验：启动后零 AX 活动仍 43/46，否掉 AX/钉窗归因。**修复（M516，合并 `1fe42a3`）**：fixtures 前移起 app 之前（单点化，`run.mjs`）+ 启动恢复门（排序纪律）+ 112 waitFor 加固（AXImage 判据）；49 真机 3/3 PASS 46/46，blast 批 25/26（唯一红 121 为既有族）。**M515 产品加固（合并 `30f0d20`）仍成立**：探测真失败时的重试 + 降级日志 + 恢复对账，价值不依赖 49。后续候选（reviewer P2 留项，不阻塞）：重启恢复门改动态分流（stopApp 前读 restoredTabCount>0），现只覆盖 seed 带会话的场景。指针 `.tower/comms/findings/20261014-agent-m508-bug-m508-49-md-46-46-ax.md` + M513/M516 mission notes。
- **M511 复跑残余红 → M514 全量终跑（2026-10-14，139 PASS / 18 FAIL / 0 INVALID）已接账**：修复面 8/8 坐实 + 140 自行转绿，无新增产品回归（唯一新增红 112 证为观测竞态、复跑 PASS，waitFor 加固已由 M516 落地）。18 红归族（**A 族归因经 M517 探针订正**）：A 注入通道族 6 = 三个不同成因——① 117/118/154 是 typeInNode（KimiCU type_text）在 ⇧Enter 软断行后的落点问题（AX 注入不进 composer 模型、DOM 观察器回灌折叠软断行；⇧Enter 本身落地，CGEvent 迁移无收益），M518 改场景走 keys 通道收口；② 134/150 是 post-native-menu 语境（M456 老边界，plain ⌘V 已证正常）；③ 13 经 M521 survey 定性为**套件断言倒置**（M199 把 has 翻成 not，正确落点必红、历史绿只来自注入多落），与 117/118/154 不同族，M509 的「⇧Enter 族按服务健康复跑」对 13 不成立；M523 已改带 `›` 锚点的链条断言（裸文本在正文重现、照抄必假绿），反向验证 + 三轮真机 PASS 收口；B typeInNode 观测限制 3（32/47/52，finding `20261014-agent-m511-improve-m507-typeinnode-axcombobox-axtextfield.md`）；C 摘录卡片结构族 5（82/83/85/121/148）；D 标定待判 2（68/153）；E 启动渠道 1（49，M516 已修）。CGEvent 键盘原语定位降为「保险通道」候选（对本六条无收益，M509 的 cgevent-key.swift 已证可行）。证据 `.local/acceptance/2026-10-14-full/` + `/tmp/m517/`。
- **`reading-position.ts:288-291` 与 M515 同款的静默丢弃**（agent-m515，2026-10-14，medium）→ **2026-10-16 已修（M546，合并 cd7585e）**：M515 同形态落地（失败同批同参重试一次再降级 + `reading_position_probe_retry`/`_failed`/`_reconcile` 三条读数走 slow_callback 通道），反向验证 4 红 1 绿做实，living spec :466 同步收口。指针 `.tower/comms/findings/20261014-agent-m515-bug-reading-position-ts-288-m515.md`。
- **孪生探测助手宜收敛成共享模块**（worker-readpos，2026-10-16，low，idea）→ M546 落地后 `reading-position.ts` 与 `vault-switcher.ts` 各持一份逐字同形的 `diagnostics`/`probeErrorCode`/`probePaths` + 重试段（交叉注释已双向回指）；收敛 = 抽共享模块 + 两处改 import，动 M515 已合并代码，属独立重构面。指针 `.tower/comms/findings/20261016-worker-readpos-improve-reading-position-vault-switcher.md`。
- **M458 标题栏/modeline 偏移（worker-flicker-a524，2026-10-15 探针收窄）**：内置屏 display-sleep/wake 路径已排除——WindowServer 日志证纯面板电源循环（无 display reconfigure / mode change），睡眠前后窗口 backing store 逐字节一致；剩余候选触发源 = 外接显示器插拔 / 分辨率-ProMotion 档位变化 / 跨屏移动 / 合盖（Alex 留意）。症状再现时先截图别动窗口取证；Cmd± 与拖 1px 均不自愈（2026-10-16 Alex 实测）——自愈假设证伪，非瞬态 layout 错位。survey 全文 `.tower/comms/inbox/20261015-worker-flicker-a524-tower-survey-summary.md`。（同源调查的「后台窗口闪烁」问题 2026-10-16 Alex 核销：「最近没有出现，可以销掉」；M525 窗口底色改动保留在库——稳态零像素影响，由 app-window spec 合同与结构断言守。）

- **权限语义类 change 的 tasks 缺「回扫既有场景的闸期望」一项（流程缺口）**（agent-m480，2026-10-13，medium）→ M407 归档 tasks 6.7 只新增 109/110/111、未回扫 72/73/74，导致三轮验收假红才暴露；建议沉淀进 `docs/process/openspec-workflow.md`：凡改权限/闸语义的 change，tasks 必须含「回扫既有验收场景的闸期望」一项。指针 `.tower/comms/findings/20261013-agent-m480-improve-change-72-73-74.md`。

- **`fs_patch_file` 有与 `save_document` 同款的 CAS→rename 静默覆盖窗口**（worker-m470，2026-10-12，medium，vuln）→ **2026-10-16 已修（M545，合并 d117869）**：复用 M470 的 `RenameGuard::ExpectSnapshot` 形态，快照在读字节前取、rename 前比对，冲突回落既有 `document_conflict`；竞态档测试 + 反向验证在 `.local/missions/m545/`。指针 `.tower/comms/findings/20261012-worker-m470-vuln-fs-patch-file-save-document-cas-rename-m470-save-document.md`。
- **harness 面板的外链打开失败一律静默（无 toast）**（worker-m460，2026-10-12，medium）→ 点「看起来能点」的链接零反馈。指针 `.tower/comms/findings/20261012-worker-m460-improve-harness-toast.md`。
- **错误响应落盘丢失 http_status / raw_body / request_id**（2026-10-14 真机溢出复盘，medium）→ **2026-10-16 已修（直接会话落地，gate quick `GATE RESULT: 10/10 PASS（SKIP 0）`）**。根因比原条目记述更窄：`llm_error` sidecar 本就带三件套（M463），但超限走「自动压缩重试」成功即续跑、永远到不了 sidecar，而每轮必落的 `llm_response` 错误分支只落 `code: message`——修法 = `turn.rs` 抽 `append_error_diagnostics` 共用助手，`llm_response` 错误分支同步落 `http_status` / `raw_body` / `body_truncated` / `request_id`。同批顺带落 `llm_response.reasoning_encrypted:{requested,received}`（`LlmClient::requests_encrypted_reasoning()` 与 `wire_body` 同一份布尔），「请求了密文 / 实际收到」一次复发即可分辨。现场 `.local/probes/k3-256k-overflow-2026-10-14/`（git 外）。
- **登录 shell PATH 解析失败静默回退，无可观测信号**（worker-m466，2026-10-12，low，idea）→ M466 后续候选。指针 `.tower/comms/findings/20261012-worker-m466-idea-shell-path-m466.md`。
- **m149-tabs 视觉用例偶发超时（`.ft-row[title="long.md"]` 30s 等不到），负载相关 flake**（tower，2026-10-13，low）→ 同日三次运行：全量 PASS → 全量 FAIL（11.0m 高负载跑）→ 定向 12/12 PASS；非产品回归。复发 ≥2 次再改显式就绪等待。指针 `.tower/comms/findings/20261013-tower-bug-m149-tabs-ft-row-30s-flake.md`。
- **render-codeblock.spec.ts 缺 ⌃⌥S 焦点入口的常驻结构断言**（worker-m474 建议、reviewer-m474 附议，2026-10-12，low）→ M474 用临时 spec 验过的三条断言（⌃⌥S 交焦容器 / `→`=120px / Escape 交还）用完即删、未入库，键盘入口暂无机器判据；断言形态见 M474 完工报告。指针：无独立 finding。

- **composer 导航写回：后块是段落时行级命令把光标写到下一段段首**（worker-m462，2026-10-12，medium，**M465 已修、待验收**）→ 根因在读侧（`normalizeComposerCaret` 无条件把段落末缘折成后块前缘，折出的模型值描述的是下一行行首）；M465 收紧折叠条件。指针：无独立 finding（原文见 git 历史）。
- **「末尾之后」写回：主档已由 M473 修，末块是空段落 / 卡片两子档保留块级边界（可见性未收口）**（worker-m457，2026-10-12，low）→ 空段落子档与「空段落前缘」写回位重合、卡片子档无文本末缘宿主，均受「一步必有位移」机器判据强制保留；收口需先改模型语义或 DOM 结构。口径见 `docs/specs/harness-composer.md` 的 HC3 已知边界。
- **两卡相邻之间无法用 IME 组合输入**（worker-m457，2026-10-12，medium，待修/待验收）→ 组合需要一个可编辑的行内宿主；边界位只派 `beforeinput`、`Range(composer, N)` 量不出 caret 几何（WebKit 与 Blink 同）。指针：无独立 finding。
- **M457 的 WebKit 探针未入 git：DOM 层的永久回归判据缺位**（worker-m457，2026-10-12，medium）→ 核心缺陷只在 DOM / 引擎层可见，探针形状见 `.local/probes/m462-probe/`。指针 `.tower/comms/findings/20261012-worker-m457-improve-composer-dom-m457-git.md`。
- **像素类验收场景的窗口几何不再被钉住 ⇒ 坐标静默腐烂**（worker-m462，2026-10-12，medium，117 已加固、其余未扫）→ 套件 `--config` 只钉位置不钉尺寸，M437 起尺寸按工作区 90% 现算；几何一漂整片读到亮度跨度 0，且与「元素不在场」不可区分。**根因坐实（M484 归因，2026-10-13）**：`src-tauri/src/lib.rs` `apply_startup_size` 把套件 launchApp 传的 1200×800 静默覆盖成「工作区 90%」，且 10-13 轮内 window_bounds 在 1361×855 与 1152×864 之间跳变（工作区取值本身不稳定）；同批实证受害者还有 53/122（坐标场景）。**M491 修复在途（套件启动后确定性钉尺寸）**。指针 `.tower/comms/findings/20261012-worker-m462-improve-m437-117-m456-m462.md`、`.tower/comms/findings/20261013-agent-m484-bug-m434.md`。
- **套件场景复位与上一实例停止之间的时序窗：迟到的会话落盘把 pane 几何写回盘上**（agent-m490 原报「reset 不清 vault-sessions」，M494 查实前提不成立并订正，2026-10-13，medium）→ 会话目录自 M164 起每场景都清；真缺口是复位段跑在 `stopApp` 之前，上一实例的防抖末拍/退出 flush 落在复位之后。已由 **M494 修复**（启动前一刻兑现清场 + seed 铺回）。另经 reviewer 核实：「121/122 吃 pane 比例泄漏」的因果链不成立（无 seed 场景 vault id 每进程唯一），121/122 漂移归因为窗口尺寸 + 10-10 默认比例 2/3→1/2 改版，以 M491 钉尺寸后实测定案。指针 `.tower/comms/findings/20261013-agent-m490-bug-harness-pane-pane-split-ratio-vault-per-scenario-reset.md`。
- **套件 `click {x,y}` 与 `drag {x,y}` 同名不同义：前者截图像素、后者窗口局部点**（agent-m490，2026-10-13，low）→ 换算系数随窗高变，53 原「同一处点一下」从未落在同一处；处置 = 待修，归套件坐标语义统一（未定批）。指针 `.tower/comms/findings/20261013-agent-m490-bug-click-x-y-drag-x-y.md`。
- **场景 53 按压粗体：引入提交 = 12cdaca（M399 空段落正常行高化），非产品回归**（agent-m495 二分，2026-10-13）→ M495 三轮真机：pre-M399 PASS / M399 点 FAIL 同签名 / master tip FAIL 新签名（drag 步已被 M490 修好，残留红在 clickEditor——显露态 `**` 占宽 12px 致同屏幕点映射靠前 1.5 字符）。按压命中/事件投递/焦点路径全部排除。残留标定由 **M496 修**（clickEditor dx 80→94）；M491 finding 中「两轮截图逐像素一致」表述被证伪（粗体行 y≈187 vs ≈197），在此订正。指针 `.tower/comms/findings/20261013-agent-m495-bug-53-master-tip-m490-clickeditor-12px.md`。
- **worktree 的 `node_modules` 软链是未跟踪项：`git add -A` 会把断链提交进仓**（worker-m462，2026-10-12，low）→ `.gitignore` 的 `node_modules/` 带尾斜杠只匹配目录。指针 `.tower/comms/findings/20261012-worker-m462-improve-worktree-node-modules-gitignore-node-modules-git-add-a.md`。
- **验收套件注入通道：菜单 Paste 之后 CGEvent 与套件内 `type_text` 均不落地**（worker-m456，2026-10-11，**high**，阻塞场景 134/141）→ 疑似 TCC 按 responsible process 授权；备选是给套件加一条不依赖键盘注入的通道。指针：无独立 finding（原文见 git 历史）。**收窄（M485 归因，2026-10-13）**：本条的适用面只剩 134 的 ⌘V 探针通道（M456 登记不变）；148/149 的红与此无关——真因是场景用错注入原语（`do: type` 落在 AX 树第一个 AXTextArea = 编辑器，非 composer）与定位器 `/…/` 定界符误用，已由 M489 修复。另：134 的 ⌘V 即使修好测的也是 paste 路径而非 HC3 的 keydown 物化路径，探针通道选择需回到真实 keydown 注入。
- **gate quick 不解析验收套件 lib：块注释内 glob `*/` 闭合注释致全套件 SyntaxError 上了 master**（2026-10-10，medium，防线缺口）→ `scripts/acceptance/lib/app.mjs` 的注释把 `env:harness/sessions/*/*.jsonl` 写进块注释。指针：无独立 finding。
- **切 vault 后新开的 harness pane 缺标题栏会话段**（worker-m433，2026-10-10，medium）→ 面板本体在场可用，标题栏会话段缺席。指针 `.tower/comms/findings/20261010-worker-m433-bug-vault-harness-pane-ax.md`。
- **harness 会话留存路径描述有两处真源**（worker-m433，2026-10-10，low）→ `src-tauri/src/harness/session.rs` 的 ts-rs doc 注释与 `src/ipc.ts` 的 IPC 注释各写一份。指针：无独立 finding。
- **living spec harness 未覆盖 M373/M381 的「models 逐项能力声明」**（worker-m424，2026-10-10，low）→ `[harness].providers.<id>.models` 的 `{id, effort, window}` 与保守默认口径未进 spec。指针 `.tower/comms/findings/20261010-worker-m424-improve-living-spec-harness-m373-m381-models.md`。
- **验收场景 123 的 focusWindow 机制描述失准**（reviewer-m430 非阻塞观察，2026-10-10，low）→ 文档称「拿不到前台即报错」，实际形态不同。指针：无独立 finding。
- **消息摘录跳回三层真机不可判：落点（类名 + 滚动位置）读不进 AX**（worker-m423 留口，2026-10-10，low）→ design §8 的④在真机侧无判据。指针：无独立 finding。
- **消息摘录快照恢复 round-trip 真机无预置口**（worker-m423 留口，2026-10-10，low）→ design §8 的⑤缺预置通道。指针：无独立 finding。
- **transcript 静态文本在 AX 树无 bbox：选区类动词通道结论**（worker-m423，2026-10-10，**已有结论**，medium→low）→ `doubleClick` / `drag` 类动词对无 bbox 节点不可用，结论已定、不再追。指针 `.tower/comms/findings/20261010-worker-m423-improve-transcript.md`。
- **cargo 锁「先复核再创建」存在 check-then-create 竞态**（tower，2026-10-10，low）→ 两个 worker 同秒复核后双双广播持有 `/tmp/lumir-cargo-build.lock`；需原子创建（`O_EXCL` / `mkdir`）。指针 `.tower/comms/findings/20261010-tower-improve-cargo-check-then-create-m419-m421-claim.md`。
- **playwright 探针不设 `outputDir` 会清空 worktree 的 `test-results/`**（worker-m419 实证，2026-10-10，low）→ 默认输出目录与验收证据根同名碰撞。指针 `.tower/comms/findings/20261010-tower-improve-playwright-outputdir-worktree-test-results-m419.md`。
- **「未保存新文档」状态无 UI 入口：贴图退 vault 根这条行为真机不可达**（worker-m416，2026-10-10，medium）→ 产品里没有可达路径能产生「无路径、可编辑」的文档。指针 `.tower/comms/findings/20261010-worker-m416-idea-ui-vault.md`。
- **toast 浮条缺 ARIA live region 语义，读屏不播报瞬时反馈**（worker-m420，2026-10-10，low）→ `.lumir-toast` 无 role、无 `aria-live`。指针 `.tower/comms/findings/20261010-worker-m420-improve-toast-aria-live-region.md`。
- **列表 lazy continuation 渲染归属：引用块内与 1–3 空格缩进两档未覆盖**（worker-m421，2026-10-10，low）→ L1 判据只取「文档第 1 列即非空白」。指针 `.tower/comms/findings/20261010-worker-m421-improve-lazy-continuation-1-3-m421-v1.md`。
- **composer 显式光标 reveal 在真机验收层无区分度，chromium 侧可补断言**（worker-m419，2026-10-10，low）→ WKWebView 程序化改选区时自己 reveal 光标。指针 `.tower/comms/findings/20261010-worker-m419-improve-composer-reveal-chromium.md`。
- **living spec 与实现的矛盾无机器防线：`validate` 只查结构、`docs-check` 只查链接**（worker-m418，2026-10-10，low）→ 现场：living spec harness 写「ⓘ 钮点击展开气泡」而实现早已是 hover 浮层。指针 `.tower/comms/findings/20261010-worker-m418-improve-living-spec-harness-ctx-3-m418.md`。
- **Full Access 档下 `sudo` / `xargs` / `find -exec` 间接调 `rm` 绕过危险命令黑名单**（reviewer-m407 r1，2026-10-09 登记；**Alex 2026-10-10 裁：堵**，medium）→ 分类闸门对 argv 做字面命令名匹配，包装 / 间接形态漏网。指针：无独立 finding；落点 `src-tauri/src/harness/permission.rs` 一类分类闸。
- **harness 恢复路径 decision 回填的次序启发式会错配**（M413 r1 P2-2，low）→ `harness.rs::restored_panel_messages` 按 `(工具名, 第 N 次出现)` 回填 approval sidecar。指针：无独立 finding。
- **验收套件可跑性靠人肉自觉：预检缺磁盘水位与实例占用硬门**（worker-m414，2026-10-10，low）→ runner 预检段应硬门（`df` 水位 + 1420/1430 LISTEN）。指针：无独立 finding。
- **权限档位表前后端两份手工保持一致，漂移无机器防线**（reviewer-m414 r1，2026-10-10，low）→ 前端 `PERMISSION_MODES` 与 Rust `PermissionMode` 闭集合两份手抄。指针：无独立 finding。
- **面板滚动行为无机器防线：AX 不反映滚动位置**（M398 r1，2026-10-09，low）→ 恢复重建后「滚动落底」无任何机器断言。指针：无独立 finding。
- **无头/后台启动的实例首屏白屏，vite 整页重载后才渲染**（tower 复现期三现场，2026-10-09，**未定性**，low）→ 三个独立现场（`pnpm tauri dev` / 套件 `launchApp` / 场景 106）。指针：无独立 finding。
- **会话浮层在极端矮窗（≲392px）下仍越出视口**（M397 残余边界，2026-10-09，low）→ `placeSessPop` 纵向夹取退到上沿 8px 仍容不下自然高（≈376px）。指针 `.tower/comms/findings/20261009-worker-m397-popup-tower-review-request-m397-r1-p2-1-p2-2-tip-0d36770.md`。
- **m303 视觉用例的 `toBeVisible()` 对祖先裁切无区分度**（worker-m397，2026-10-09，low）→ 只查元素自身可见性、不查被 overflow 裁切。指针 `.tower/comms/findings/20261009-worker-m397-popup-improve-m303-overflow.md`。
- **KimiCU AX 快照偶发退化**（worker-m397 观察，2026-10-09，环境边界，low）→ dump 只剩菜单栏、`element_count` 16，场景判 INVALID。指针：无独立 finding（工具层，恢复手段见「工具链与环境」）。
- **会话浮层快速「关→再开」可重复追加历史会话行**（M392 评审观察，2026-10-08，low，攒批处理）→ `buildSessList` 在 `harness_list_sessions` invoke 往返内被再次触发。指针 `.tower/comms/findings/20261008-tower-bug-buildsesslist-cosmetic.md`。
- **会话留存：未来评估 wire 原生增量记录（Claude Code / Kimi Code 形态）**（M394，2026-10-08，待办）→ 现行为全量落盘。指针：无独立 finding。
- **`context.rs` 模块注释称「自动压缩走同一 `assemble_system`」，实际压缩不重装配**（M385 survey 顺报，2026-10-08，low）→ `src-tauri/src/harness/context.rs:10-12` 与实现不符。指针 `.tower/comms/findings/20261008-worker-soi1-improve-harness-context-rs-assemble-system.md`。
- **acceptance README 的正则反斜杠示例与 YAML 引号风格耦合**（M383 顺报，2026-10-08，low）→ 双反斜杠示例照抄进单引号场景会写出恒红判据（约 `README.md:390`）。指针 `.tower/comms/findings/20261008-worker-thinktool1-improve-acceptance-readme-yaml.md`。
- **acceptance `run.mjs --help` 静默触发全量真机跑批**（M374 现场，2026-10-07，low）→ 不识别的 `--help` 被当场景 id 前缀。指针 `.tower/comms/findings/20261007-worker-stf1-improve-acceptance-run-mjs-help.md`。
- **验收套件缺一个验证 ⌘-点击 DOM `metaKey=true` 路径的端到端夹具**（M379 reviewer 建议，2026-10-07，low）→ `click` 的 `modifiers` 通道存在但没有夹具真跑那条分支。指针：无独立 finding。
- **共享 `CARGO_TARGET_DIR` 跨 worktree 复用旧测试二进制致假绿**（M372 现场，2026-10-07，high）→ 门禁拿旧二进制跑出绿。指针 `.tower/comms/findings/20261007-tower-bug-cargo-target-dir-worktree.md`。
- **worker 引门禁读数把 SKIP 并进分母，「8/9 PASS + SKIP 1」误读成全绿**（M372 r1 现场，2026-10-07，medium）→ 实际 1 FAIL（`cargo fmt`）。指针 `.tower/comms/findings/20261007-tower-improve-worker-skip.md`。
- **live `done` 事件用固定哨兵串表成功，前端据它判成功 / 失败**（M368 备案，2026-10-07，low）→ 成功行参数摘要取自 `started` 事件，`done` 成功时不带参数。指针 `.tower/comms/findings/20261007-tower-improve-live-tool-done-panel-summary.md`。
- **场景 49「指示此刻在场」断言存在假红时间窗**（M325 现场，2026-10-04，low）→ 断言依赖 AX 快照恰落在装载窗口内；2026-09-28 假红过一次，四跑均 PASS 未动。指针：无独立 finding。
- **验收套件 `press_key` 键名 DSL 没有 `-` 的拼法**（M324 现场，2026-10-04，low）→ `press_key(keys="-")` 报 `error: empty key DSL`（`space` 同族，已由 M455 侧修）。指针 `.tower/comms/findings/20261004-worker-fix-acceptance47-52-m32-bug-press-key-dsl-acceptance.md`。
- **harness 会话以 vault 根路径字符串为键，打开 vault 不做规范化**（M312 现场，2026-10-03，medium）→ 同目录两种拼写各建一个会话。指针 `.tower/comms/findings/20261003-worker-harness-vault-m312-bug-harness-vault-vault.md`。
- **`.tab-menu-item` 选择器是死代码，且有门禁断言在验这条无效果规则的原文**（M300 现场，2026-10-01，low）→ `src/style.css` 的 `.ft-menu-item, .tab-menu-item` 选择器对。指针 `.tower/comms/findings/20261001-worker-tab-reveal-m300-bug-src-style-css-tab-menu-item.md`。
- **vault 切换没有 perf 门禁端点**（M283 登记，2026-09-28，待裁是否立项）→ 切换优化效果无门禁可锁，可被后续改动静默回退；端点是性能合同语义的扩张（要先定绝对阈值还是相对回归），草案见 `openspec/changes/vault-switch-restore-perf/design.md` §6.4 与裁决点 4。**注意**：该条旧文曾写「读数只能靠人肉 grep `~/.config/lumir/logs/*.jsonl` 拿到」——该路径已过期（Alex 2026-10-12 实证无输出），读数通道本身也需要重定。指针：无独立 finding。
- **md 行含 inline widget 时的高度表差**（M281 现场，2026-09-27，medium）→ gutter 在场期间图片 / widget 行之后的 gutter 行号低约一个文字盒（CM 高度表 vs DOM 行盒的既有差）。指针 `.tower/comms/findings/20260927-worker-impl-goto-line-bug-md-inline-widget-cm-dom-m281-gutter-18px.md`。
- **整页基线在标签栏 / 标题栏文字行已陈旧**（M281 现场，2026-09-27，medium）→ 改动前构建与入库基线在窗口顶部那一行差异 `y≈15/27/40`、420px（0.001 档静默）。指针 `.tower/comms/findings/20260927-worker-impl-goto-line-bug-y-15-27-40-420px-0-001.md`。
- **gutter 的 1px 右缘声明被同文件规则关掉**（M281 现场，2026-09-27，low）→ `src/editor.ts` 的 baseTheme 声明被同文件 `border: none` 覆盖。指针 `.tower/comms/findings/20260927-worker-impl-goto-line-improve-gutter-1px-basetheme-cm-gutters-before-border-none-none.md`。
- **验收 vault 根下的非 `.md` 残留不被 `resetVault` 清理**（M296 现场，2026-09-29，low→medium）→ `resetVault()` 只清 `.md` 与目录；2026-10-13 实证危害：148 场景泄漏的根级 webp 经此缺口跨 run 污染了 127 的「vault 零新增」断言（M485 归因）。**M489 修复在途**。指针：无独立 finding。
- **预览机制移除的遗留项**（M254 登记，2026-09-27）→ `preview-tab-removal` 移除预览标签后仓内仍有按旧语义写的注释 / 字段说明。指针：无独立 finding。
- **路径拼接同形副本**（M258 登记，2026-09-27）→ `src/main.ts:582` 的「父路径 + 末段名」与 `src/tree.ts` 的 `relativePathOf` 是同形副本。指针：无独立 finding。
- **math/mermaid 显露判定未接按压快照**（M259 登记，2026-09-27）→ `src/preview/math.ts:315`、`:359` 与 mermaid 同类落点仍是「跨布局判据」缺陷族的未收口面。指针 `.tower/comms/findings/20260927-worker-bold-click-bug-math-mermaid-m259-livepreview.md`。
- **M256 全量回归现场**（2026-09-27 批次收尾）→ 57 场景 / 49 PASS / 8 FAIL，读数已不可复现（当时跑在 zh 面）；8 条红归因见 git 历史。指针：无独立 finding。
- **M266 陈旧断言清理与套件右键通道修复**（2026-09-27）→ 清理 M254 / M217 留下的陈旧断言，`button: right` 改读 `mode=full`。指针 `.tower/comms/findings/20260927-worker-scene51-close-improve-50-51-owner-m269.md`、`.tower/comms/findings/20260927-worker-stale-scene-cleanup-bug-51-close.md`、`.tower/comms/findings/20260927-worker-stale-scene-cleanup-bug-fs-dirty-43.md`。
- **文案 deck D152 编号碰撞**（M263 登记，2026-09-27；tower 已裁决分配）→ M261 与 M267 都声明「从 D152 起」；裁决把 D152 起分配给先合并的 M261，M267 取 D156。指针 `.tower/comms/findings/20260927-worker-proposal-block-copy-bug-deck-d152-change-m261-goto-line-m267-ui-language-i18n.md`。
- **`table-trigger.ts` 注释 deck 编号漂移**（M262 登记，2026-09-27）→ `src/preview/table-trigger.ts:30`、`:42` 把表格全屏触发钮读屏名写成 D120（实为 D124）。指针 `.tower/comms/findings/20260927-worker-proposal-code-fs-b-improve-table-trigger-ts-deck-d120-d124-d120.md`。
- **M277 实现期登记的已知边界：块级复制与代码块全屏**（2026-09-27）→ 七条：复制结果恒为 LF 换行；代码块无大小上限（表格有 64 KiB 降级）；窄块上的钮向左溢出；全屏浮层里 >64 KiB 块退化为纯文本；命令路径的块定位是视口有界的；浮层 `blur` 兜底关闭路径真机未覆盖；两条新命令默认不绑键。指针：无独立 finding（逐条落点见 git 历史）。
- **M280 现场发现：ESC 跳变的两个副产物与两条残余**（2026-09-27）→ ①①②两条 high 已修；残余三条待收：vault 切换器仍走第二份 `scrollSnapshot` 通道、捕获锚落在文档原点时运行期不写回、lightbox 不随文档代际变化退出；另有验收套件表达不了 CL-1 的判据（medium，属套件表达力专项）与方法学告警「Playwright WebKit + 同款 UA ≠ 系统 WKWebView」（medium）。指针 `.tower/comms/findings/20260927-worker-impl-esc-jump-improve-playwright-webkit-ua-wkwebview-preventscroll-webkit-playwrig.md`、`.tower/comms/findings/20260927-worker-survey-esc-jump-bug-esc-pos-0-anchor-0.md`、`.tower/comms/findings/20260927-worker-survey-esc-jump-bug-item.md`。
- **M252 装载指示立论在打开段不成立**（M268 登记，2026-09-27）→ proposal 的「等待期间事件循环是空的」前提与实现不符（已归档 change 的历史结论，不改写原文）。指针 `.tower/comms/findings/20260927-worker-proposal-vault-restore-improve-m252-vault-open-path-command.md`。
- **验收套件的三处口径限制**（M277 现场，2026-09-27，前两处已随之落地）→ ① 剪贴板读数行尾被 AppleScript 改写（已修）；② `editor.unchangedSince` 读的是 AX 渲染文本（场景已改走磁盘判据）；③ 长 chain 注入（8–19 chord）的可靠性与可点节点面（未修，环境/工具面）。指针：无独立 finding。
- **验收套件（M240 现场，2026-09-26）** → Tab / Shift-Tab 注入在 WKWebView 不生效（场景 43 曾恒红）；套件每次运行重写证据目录索引 ⇒ 多 mission 共用同一日期目录时互相覆盖。指针 `.tower/comms/findings/20260926-worker-impl-table-fs-bug-tab-shift-tab-wkwebview-m239-43-master.md`。
- **表格全屏（M240 登记，2026-09-26）** → 长表在全屏遮罩里只看到已渲染部分（follow-up change 候选）；视觉 README 的「22 处像素断言」与现状不符；验收 README 的 `configWrite` / 场景 front-matter `config:` 行没写 `theme` / `fontFamily` / `content_width`；真机套件无计算属性通道（色值 / 主题类判据只能到「配置层 + 截图」）；`openspec/specs/typography/spec.md` 的 `## Purpose` 已与实现漂移；`32-list-filter` 自 2026-09-25 起真机恒红（同一断言，可复现）；`list-filter` 归档时如实留下的四处覆盖缺口；两个第三方 Lezer 语法包会静默坑人（`@lezer/yaml` 位置越界、`@fig/lezer-bash` 普通 bash 崩溃）。指针 `.tower/comms/findings/20260924-worker-code-intel-proposal-bug-lezer-lezer-yaml-fig-lezer-bash-bash.md`。
- **编辑器 / 键位（M101–M186 期存量，逐条细节见 git 历史）** → Alt+Shift token 口径（M132，`keyToken` 对含 Alt 组合忽略 Shift）；`ConfigSnapshot.warnings` 无 UI 出口（M132，只进 console）；toast z-index 10 衬在 ⌘/ 面板遮罩（20）下（M133）；`\$` 转义误判（M106，低）；`mathSpanCrossed` 的 ±4KB 窗口切割超大公式块（M111）；围栏行尾恰为 `$...$` 时跨行 ⌃B 一次移两字符（M113，良性）；相邻 grid 表连排时 ⌃N/⌃P 每按一次过一张表（M113）；「已被外部删除」浮条无动作；`文案-Copy.md` D40 后空行断表 + 编号未升序（M141，清扫类）；隐藏管道符用 `display:none` 承载是「caret 落到无位置处」缺陷族的共同结构根因（M168）；cell 内容区间公式两处真源（M185）；`src/preview/*` 的 10 处构造函数参数属性阻断 unit 层直接 import `src/editor.ts`（M185）。指针 `.tower/comms/findings/20260917-worker-jsonhl-bug-tag-token-rust-code.md`、`.tower/comms/findings/20260918-worker-interaction-fixes-2-bug-display-none-caret-m168.md`、`.tower/comms/findings/20260921-worker-cell-ctrle-bug-tests-unit-tsconfig-json-backlog-backlog.md`、`.tower/comms/findings/20260921-worker-cell-ctrle-improve-cell-cell-geometry-review-8.md`。
- **shell / 系统（M101–M186 期存量）** → 退出守卫菜单结构假设（M101 review，Dock / 系统关机路径不覆盖）；注册表目录 `{id}.json.tmp` 无扩展名过滤会被当注册项解析（M126）；vault 浮层打开时游标行不会被滚进可视区（M186）；「交还焦点 MUST NOT 改阅读位置」建议下沉编辑器层（M186）。指针 `.tower/comms/findings/20260921-worker-vault-scroll-bug-vault-scrollintoview-hidden.md`、`.tower/comms/findings/20260921-worker-vault-scroll-idea-must-not-m186-vault.md`。
- **未复现（三条，复现条件未锁定）** → 编辑区全空白偶发（M114 一次 / M116 0/3；运行时诊断日志已落地 M134）；视觉套件 `markdown-parser` 的 `large-mixed` 偶发失败（M144 一次，`page.evaluate: TypeError … metrics`）；`paragraph.spec.ts`「普通段首对齐 640」全量轮瞬态失败一次（reviewer-toc，2026-09-17，与 M148 diff 无因果）；表格 / 代码块全屏 ESC 关闭时的视口跳变（M274 survey，Alex 真实文档上未复现，2026-09-28 降优先级）。指针 `.tower/comms/findings/20260917-reviewer-toc-bug-paragraph-spec-ts-640-flake.md`。
- **验收套件（M144 实测出的表达力缺口，逐条一行）** → 缺 `scroll` 动作与页内采样（滚动缺陷只能用翻屏键近似）；造不出 DOM `dblclick`（四条注入通道实测）；`ax.mjs` 的 `parseNodes` label 提取被嵌套括号截断；场景证据目录跨 run 不清空（`ax/` 与 `shots/` 累积 ⇒ 无法分辨新旧）；`ax.mjs` 取 `AXTextArea.value` 用非贪婪正则（文档含半角 `"` 时断言双向失真）；`config` 通道只透传 `keys`（`[editor]` 新配置项无法构造启动口径）；`click` 动作不支持修饰键（M144，medium）；`type` 动作 `clear:true` 的残余假绿形态；`checkScenario` 不校验 `do: type` 的 `text` 非空；`click` 的 `target.name` 与断言的匹配口径不一致（M148）；AX 文本可读 ≠ 元素可见（WKWebView 暴露不可见 svg 内部文本，M178）。**2026-10-13 新增两条**：`do: type` 落在 AX 树第一个 AXTextArea（=编辑器），不是 composer——往 composer 打字的正解是 `clickInNode(composer) + do: keys`（M485 归因，148 的 26 条级联红全由此起）；`ax.has/not` 对整份 AX 原始文本做子串匹配，连 `help=` 等属性值一起搜——负断言的哨兵串若与命令原文 / href 重合会恒假红（M488 归因，151/152 各中一条），候选修法 = 给运行器加「仅可见文本」检索域。指针 `.tower/comms/findings/20260917-worker-toc-improve-click-target-name.md`、`.tower/comms/findings/20260918-worker-svg-impl-bug-ax-wkwebview-svg.md`、`.tower/comms/findings/20260918-worker-wrap-impl-bug-acceptance-ax-value-editor-not.md`、`.tower/comms/findings/20260919-worker-lightbox-impl-bug-acceptance-parsenodes-label-alt.md`、`.tower/comms/findings/20260921-worker-svg-scroll-improve-scroll.md`。
- **视觉套件与整页基线门禁（M178/M179 登记，2026-09-18）** → `tauri-stub.ts` 缺 `fs_read_attachment`（chromium 视觉层此前从未真正渲染过一张图片）；playwright 从错误 cwd 启动会清空 `cwd/test-results`（与验收证据根同名碰撞）；整页 0.001 容差（960px）与「局部改色」同量级（M179 实测 958/960 差 2 像素静默假绿）。指针 `.tower/comms/findings/20260918-reviewer-svg-impl-bug-playwright-cwd-cwd-test-results-wipe.md`、`.tower/comms/findings/20260918-worker-svg-impl-improve-fs-read-attachment-chromium.md`、`.tower/comms/findings/20260918-worker-yaml-hl-impl-improve-0-001-960px-m179-958-960-2.md`。
- **Rust 侧主线程与锁（M154 survey 遗留）** → `apply_fs_changes` 持 VaultState 锁逐文件做磁盘 IO（真实 vault 全量 1341 md = 112.1ms）、`vault_current` 持锁跨全量 scan（14ms）；修法 = 先在锁外读成 `Vec<(path, Option<String>)>` 再取锁 upsert。注意：收窄锁**不会**把 IO 移出主线程。指针 `.tower/comms/findings/20260917-worker-rustasync-improve-apply-fs-changes-vaultstate-io-vault-current-scan.md`。
- **启动恢复让位判定与提交返回值（M171 遗留）** → `finish_restore` 让位判定的第二操作数 `root.is_some()` 零测试且可达；`commit_vault_open` 的 `-> bool` 删参后恒为 `true` 且无生产消费者。指针 `.tower/comms/findings/20260918-worker-rm-dead-param-improve-m171-finish-restore-root-is-some.md`。
- **门禁测量与 CI 环境（治理批遗留）** → `fs_io::tests::watch_dir_rename_delivers_full_subtree` 时序 flake（low，待观察）；keypress-to-paint 读数疑似帧量化，统计量宜从 median 改 min/p10；CI runner 字体 / 渲染链探针（可选，纯诊断）。指针：无独立 finding。
- **文档指针与门禁清单** → M205 与 M208 归档后残留的仓内旧路径指针（各若干处，待修）；四处「代码落点」指针在 M151 拆分后失准（medium）；`文案-Copy.md` D64 的键位面板分组枚举已过期（M166）；批次收尾缺「本地 HEAD == origin/master」的机器校验（M169）；ADR 0002 §6 的 200MB 合同文本与现行 250MB 门禁阈值分叉、待显式文本修订（M174）。指针 `.tower/comms/findings/20260917-worker-mainsplit-improve-m151-main-ts-deck-shell-ts-keymap-spec.md`、`.tower/comms/findings/20260917-worker-testinfra-improve-agents-md-gate-sh-tests-visual-readme-md-isolation-readme-vi.md`、`.tower/comms/findings/20260918-worker-archive-survey-bug-master-origin-master-merge-ci.md`、`.tower/comms/findings/20260918-worker-perf-gate-improve-m174-follow-up-adr-0002-6-200mb-ci-250mb.md`、`.tower/comms/findings/20260918-worker-wrap-proposal-2-improve-copy-md-d64.md`。
- **openspec 归档制品与实验脚本** → `scripts/visual/table-probe72/matrix.mjs` 的产出路径指向已移走的 change 目录（M150 finding）。历史归档文件死链已由 M331（27 条）+ M409（3 条 + 落门禁）修齐并删除本条。指针 `.tower/comms/findings/20260917-worker-speccleanup-bug-table-probe72-matrix-mjs-change.md`。
- **多 vault 收口遗留（M164 登记，2026-09-17）** → 视觉容差再次吞掉真实变化（13 张基线里 6 张静默）；真机 app 窗口会被放到屏幕外、键盘注入整批不落地（medium）；编辑器缺 Emacs 的 `M-<` / `M->`；`demo/index.html` 与现行产品脱节三处（medium）；`文案-Copy.md` D90 行误引 D15（修法待裁）；`tauri` 未开 `test` feature（带 `AppHandle` 的接线层无法单测）；重定位缺「只选目录、不开 vault」的后端命令；`commit_vault_open` 的 `Some(expect_generation)` 分支无生产消费者。指针 `.tower/comms/findings/20260917-worker-multivault-frontend-improve-vault-remap.md`、`.tower/comms/findings/20260917-worker-startup-impl-improve-tauri-test-feature-apphandle-m159.md`、`.tower/comms/findings/20260917-worker-toc-proposal-improve-emacs-m-lt-m-gt-beginning-end-of-buffer-alt.md`、`.tower/comms/findings/20260917-worker-uxmock-improve-demo-index-html-token-d-config.md`。
- **restyle 追加修复批（M215 / M216 gap 报告登记，2026-09-25）** → 0.001 容差实测吞掉小元素删除（M214；2026-09-26 Alex 裁：改）；code 模式行号与代码列之间 150px 空档（M212，待裁）；doc-meta 的 mtime 缓存「保存落盘后刷新」路径未经真机验证（M218 r2）；code 模式 eink keyword 700 缺口（`HighlightStyle` 路径无法按 `data-theme` 限定，M220）。指针 `.tower/comms/findings/20261006-reviewer-hp4-improve-harness-20-backlog.md`。
- **文件树「改名回响窗口内拖拽覆盖 pendingMove 登记」race**（reviewer-m530 r1 P2-1，2026-10-16，low，纯观感）→ pendingMove 单槽双写者（M530 引入拖拽写者）：目录改名提交后、watcher 回响到达前的亚秒窗口内再拖另一条目，改名登记被覆盖 ⇒ 被改名目录展开态（含子孙前缀）丢一档成折叠（重开即愈，零数据影响）；候选修法 = 登记口改队列、或改名回响未消费时 drop 登记排队。指针 `.tower/comms/reviews/review-feat-add-filetree-drag-move-into-directory-reviewer-m530-r1.md`。

## 待真机验收

行为判定已下沉为 agent 可执行场景（入口 [scripts/acceptance/](../scripts/acceptance/README.md)，设计见 [docs/process/real-machine-acceptance.md](process/real-machine-acceptance.md)）；手感 / 审美项归 Alex。分类依据 = **证据目录里真实 PASS 的场景**；全量回归现场只留一行索引（报告正文与逐场景读数不进本文件）：

- **M284 全量（2026-09-28，语言面修复批）**：65 场景 / 57 PASS / 8 FAIL、1685 断言、2496s → `.local/acceptance/2026-09-28/summary.md`；8 条红复跑 4/8 转绿、4 条稳定红（1 条产品缺陷已 file finding、2 条套件注入通道缺陷、1 条 M283 已定的窗口口径），**无一条由 M284 引入**（本批 `src/**`、`src-tauri/**` 零 diff）→ 复跑读数 `.local/acceptance/2026-09-28-rerun-reds/`。
- **M256 全量（2026-09-27，M282 之前的现场）**：57 场景 / 49 PASS / 8 FAIL，**场景当时跑在 zh 面、读数不再可复现**，仅作沿革对照（与 M284 只有 28、47 两条红重合）。
- **M240（2026-09-26）**：49 场景 / 47 PASS / 2 FAIL（`32-list-filter`、`43-list-tab-indent`）。**M164（2026-09-18，证据目录按 UTC 记为 `2026-09-17`）**：26/26 PASS。
- **M296 的真机批（2026-09-29）**：场景 67 + 多 vault 回归 16 / 17 / 19 / 25 / 48 / 60 → **7/7 PASS**（`.local/acceptance/2026-09-29-final/`），读数 `.local/missions/m296/readings.md`。
- **沿革：真机运行纪律（写场景前必读）**：就绪门入口读屏名是 `AXPopUpButton`（写死 `AXButton` 会让整套启动即超时）；窗口经 `--config` 钉主屏（否则窗口跑到屏幕外、键盘注入整批不落地）；每场景清 `workspaces/` 与 `vault-sessions/`；`seed` 预置注册表与会话并挂第二个合成 vault；无人值守用 `caffeinate -dimsu` 包住；`cargo build --features custom-protocol` 之前必须先 `pnpm build`。
- **composer-intercard-caret 归档留下的探针尾巴（M519 归档对账，2026-10-15）**：场景 134 的复跑 2026-10-13/14 多轮仍失败于注入通道（红归族 A 族②，M456 老边界，非产品回归——同「M455 收尾尾巴」条的 134 复跑安排）；「是否启用方案 C」的登记对象已不存在——方案 C 键位层由 composer-emacs-nav（M447）节点 1 裁决吸收。归档件 tasks.md 1.2 的就地标注含全链证据。

**已机验（行为判定落定，有 PASS 证据）**——证据目录统一在 `.local/acceptance/<批次>/<场景>/`（git 外）；叙述与读数明细看场景文件（`scripts/acceptance/scenarios/*.md` 的「已知边界」节）与 git 历史。

1. **Mermaid 点击进源码编辑** → `01-mermaid-click`：渲染态点击 ⇒ 源码显露、widget 让位；pending 态窗口极短、只留截图。
7. **M124 三条恢复路径全部覆盖** → `07-recovery-paths`（冲突双动作 + 内存改动未丢 + 磁盘未被静默覆盖）、`07b-recovery-saveas`（真删除触发 `fs_not_found` ⇒ 另存为新文件真实落盘）、`07c-external-reload`（干净缓冲 + 外部改写 ⇒ 编辑器文本自动换成磁盘内容）。
8. **M127 崩溃备份链路三条子行为** → `08c-crash-recovery`、`08d-crash-discard`、`08e-force-overwrite`；`08-autosave` / `08b-autosave-pause` 断言的是**已移除**的自动保存（M278 随 change `remove-autosave` 删除），「编辑内容不丢」由 41 / 42 / 43 / 46 的显式保存断言承接。
9. **Emacs 键位 / ⌘Z / ⌘/ 面板 / `config.json` keys 表** → `09-emacs-keys`、`09b-keys-config`（⌘Z 未被 macOS 视图层级吃掉、⌘/ 面板打开期间文档逐字节不变、keys 表解绑 ⌘S 与重绑 ⌃S 生效）。
10. **Markdown 渲染三件套**（M138）→ `render-markdown`；配色与几何不进真机，由视觉门禁守。
11. **表格降级文案归因**（M138）→ `render-table-degrade`（M142 起降级只由多列 / 槽位不可映射触发；短行表按矩形渲染）。
12. **文件内搜索 v0**（M139）→ `search-01-find`、`search-02-binding`。
13. **链接渲染与激活（全形态）**（M144 起、M145 补齐；M272 扩面到裸 URL）→ `12-links`（53 断言）、`54-bare-url-cmd-click`；引用式 `[text][ref]` 与无 scheme 字面仍保持原文（半覆盖，如实登记）。
14. **TOC 大纲 popover**（M148）→ `13-toc`；配色与几何由元素级基线守。
15. **多标签**（M149；M238 扩两段）→ `14-tabs`（51 断言 / 21 步）；⌘W 从关窗改为关当前标签、切换 vault 升级为任一标签 dirty 即拦等语义变化见场景说明。
16. **启动自动恢复 last_vault**（M159）→ `16-startup-restore`（10 断言）；恢复中态通常不可见，故断言的是「不残留」而非「看见」；不宣称性能改进（`LUMIR_READY` 出现时刻不变）。
17. **多 vault 列表与切换**（M164）→ `17-multi-vault-switch`（38 断言，含直读盘的三条 `file` 断言）；「双击固定标签」在该套件不可表达（由视觉通道覆盖）。
18. **启动恢复 vault 并一并恢复它的标签列表**（M164）→ `18-vault-session-restore`（7 断言）；与 16 的分工是「vault 恢复本身」vs「装载后紧接着的标签恢复」。
19. **切换 vault 的 dirty 前置门三条出口**（M164）→ `19-vault-switch-guard`（35 断言）；**未覆盖**「保存能闭环 ⇒ 继续切换」那条顺路（由 chromium `mv-vault-switch-guard.spec.ts` 覆盖）——MUST NOT 把 19 的 PASS 读成每条顺路都在真机验过。
20. **表格 cell 内 ⌃E→⌃F→⌃E 不再跳回前一 cell**（M185）→ `24-table-cell-ctrl-e-seq`；AX 逐 cell 落点不可回读，用插入字符的归属反推。
21. **vault 列表 ESC 收起保持阅读位置**（M186）→ `25-vault-list-close-keeps-reading-position`；该缺陷在 chromium 与真机均未复现，修复是结构性的（如实登记）。
22. **svg 倒序滚动终态稳定**（M187 / 场景修复 M190）→ `26-svg-scroll-stability`（17 断言）；两条通道语义（`AXTextArea.value` = CM 当前渲染区间；带 `<text>` 的 svg 在 AX 里的形状不稳）已写进套件 README 与场景说明。
23. **文档末尾完读标记**（M189；M238 / M251 两处变化）→ `27-document-end-marker`（19 断言）；可见性不在真机通道判（AX 不给纯文本节点 bbox），由 chromium 几何断言 + 截图承担。
24. **restyle 主题通道与骨架落位**（M213）→ `34-restyle-theme-skeleton`；eink 色值 / 对比无计算属性通道，只能给截图（手眼项）。
25. **三主题真机呈现 + overlay 标题栏窗口级读数**（M213）→ `35-restyle-three-themes`；标题栏三项窗口级证据（traffic 灯 / 标题文字 / 拖拽）不在断言里，判定归 Alex。
26. **主题运行期切换**（M237）→ `44-theme-live-switch`（34 断言，含反向验证）；色值 / eink 九条降级 / mermaid SVG 内联色三类视觉取值由 chromium 场景守。
27. **文件树条目右键菜单的 M251 增量**（M251）→ `47-file-tree-context-menu` 新增「点在行右侧空白区也作用于该行」；**该批真机判据未取得**（`button: right` 取不到窗口截图，M244 / M249 同因），判定由 chromium 层承担；**待裁决**：两张菜单基线有 23px 真实差异未重建（`.local/missions/m251/baseline-review/tree-menu-menu-target/`）。
93. **思考块三态（折叠默认 / 展开见原文 / 时长读数在场）**（M364）→ `93-harness-thinking-blocks`（真机 PASS / 22.5s）。
94. **无 reasoning ⇒ 零思考块（反向验证）**（M364）→ `94-harness-thinking-absent`（真机 PASS / 23.4s）。
95. **思考程度 chip 会话态（默认 High / 浮层三档 / 选 Max / 新会话回 High）**（M364）→ `95-harness-thinking-effort`（真机 PASS / 18.7s）；「档位 → 请求参数」那一段由 core 集成测试 `session_thinking_effort_reaches_request` 覆盖。
96. **列表自动模式三态（「1. + 空格」进入 / Enter 续行 / 空项退出）+ IME 组合期不重复**（M461）→ `153-ordered-list-auto-mode`（**真机留 dogfood 批次跑**）；裸 DOM 变更形态不兜、留 dogfood，若复现另立项。

**已机验到渲染/结构层，行为细节仍缺可观测面**

2. 公式进编辑 → `02-math-click`；**「公式后 ⌃B 是否 1–2 次」仍待判定**（AX 不暴露光标 / 选区）。
3. Ctrl+N/P 表格行为 → `03-table-ctrl-np`；grid 表渲染成 `AXTable` + `AXRow`，**逐 cell 落点不可回读**。
5. cell 内公式 → `05-cell-math`；**「点击渲染态公式进编辑」不可机验**（KaTeX span 既不进 AX 树也不带 bbox）。
6. Callout → `06-callout-and-width`；**「光标进该行后源码显露」不可机验**；表格宽度只留截图证据。

## 记录在案（无需动作）

一行一条；均为已裁事项的记录，约束未来的措辞 / 口径。

- **UX 重做批（攒批，等 UX 重做会话一起做）**：demo 右侧探针栏去留（版面 / 文案决策，建议随 theme 重做一并处理）；宽表横向溢出裁切是否预期（实测溢出 1549pt vs 栏宽 766pt，AX 层完整）；Emacs 档 3 与全产品键位（isearch / mark / region / ⌃X 前缀、左栏 tree / shell 零键盘支持）；会话名钮的可发现性（`<会话名> ▾` 是会话历史浮层的唯一入口却像文档标签）。
- **dogfood 性能专项（攒批）**：内存合同存量超标（2026-09-06 evidence 218–222MB 已超 <200MB 合同，现门禁 250MB——放宽合同还是专项治理随该专项拍板）；perf 端点 `open-1mb-file` 从「磁盘 IO 占位口径」修订为真实打开路径（现端点只量读文件 + UTF-8 解码，却被 100ms 绝对阈值 enforce）；「用户主动打开 / 切换 vault」仍走同步路径（真实 vault 约 125ms、4× 规模约 770ms，被动恢复那段已由 M159 移出主线程）；vault 切换缺 perf 门禁端点（见「待修 findings」同名条）。
- **链接形态矩阵三处口径：维持现状**（tower 2026-10-12 裁）：相对路径**非 md** 带 `↗︎`（语义「会离开本应用」）；**纯锚点**带 `→` 但激活只给「暂不支持锚点跳转」toast；`[x](note.md#sec)` 按「应用内跳转 + 锚点部分忽略」。落点 `src/preview/links.ts` 的 `classifyLinkTarget` 与 `src/main.ts` 的 `followLink`。
- **`save_markdown` 原子替换方案（CAS 窗口方案 b，未采用）**：macOS `renameatx_np(RENAME_SWAP)` 原子交换 + 读交换出的旧内容算 hash 与 `expected_revision` 比对、不符则 swap 回来报冲突；回滚语义（swap 回失败怎么办）要单独设计，属独立 mission。M470 走方案 a（收窄）。
- **composer 的「一步必有位移」既有豁免档（M473 后口径收窄）**：卡片前缘 `(i,0)` 与其前空段落前缘 `(i-1,0)` 写回同位（两模型位编辑语义不同）；「末尾之后」在末块是空段落 / 卡片时仍为块级容器零几何位（M473 已把主档写回落到末块文本末缘，两子档受机器判据强制保留，见「待修 findings」同名条）。收口先要一条能读「绘制位置」的通道或由 Alex 裁这两档的表现。
- **增量建图：暂缓**（M283 裁）：`build_graph` 的持久化缓存本阶段不做（收益与索引一致性风险不成比例）。
- **树 DOM 虚拟化：否决**（M283 裁）：否决依据是代码结构（切换路径上的 DOM 行数 = 根级条目数，不是「一次建出 8000+ 行」），代价是跨 capability 高风险重写。
- **M455 收尾尾巴**：真机复跑（138/140/144/145 与 hover 族 76/87/131/132/133/134）由 tower 统一安排；145 同族观察（面板 keydown 的 `mod+z` 把 ⌘Z 与 ⌃Z 都当就地 undo）留给 change 属主裁是否收窄。
- **快捷键治理后置**（Alex 2026-10-03 在 pane 化提案节点 1 裁定）：等产品总体框架基本敲定后再做专项键位治理；此后各 change 的键位指配按「单段、顺手、零冲突」从简，不做跨功能全局键位体系。
- **Harness UX 一揽子裁决**（Alex 2026-10-03）：事件流带 vault / 会话标识并按当前 vault 过滤（已随小修包实施）；chat UX 大改先在 `design/prototypes/` 出原型；宽度拖拽、模型选择、pin 式上下文块推迟到 pane 化 survey 之后；split view 走 ADR 0008；内存风险处置按实测提高门禁、专项治理后置；「宽度被 pane 分隔条吸收」的澄清——阅读栏宽是 pane 内部属性、不受影响。
- **UX 动荡期整页基线纪律**（Alex 2026-10-03，M311）：UX 改动期内整页像素基线不在每个批次中途重刷，攒到 UX 批次末尾一次性 `--update-snapshots=all` + Alex 过目一次；元素级断言与 CI 结构层照常逐批守。纯基线增量 commit（零代码）的复审轮由 tower 亲自做机械核验后落 verdict。
- **S15 / S16 · 键位面板维持 680px 三列**（Alex 2026-09-25 裁，M220 登记）：有意偏离定稿的 440px 两列——命令列对排查自定义 `keys` 配置有实际用途。
- **A2 · 结束标记维持短双线形态**（Alex 2026-09-25 裁）：定稿的通栏双线从未实例化（grep 仅 CSS 一处命中），短双线的「封口感 + 与 hr 结构上不同」成立。
- **C6 · 代码块头部条维持围栏行方案**（Alex 2026-09-25 裁，spec 背书）：围栏行是源码的一部分，不另造 DOM 元素（另造会把同一信息说两遍，且要动块级 widget 测量路径）。
- **标题栏右侧「动作钮」区本版不渲染任何按钮**（M213，tower 裁）：动作钮内容没有定义，为一个未定义的东西先摆一排按钮会把「定稿图里没有的东西」写进产品；落点 `titlebar` 只 `append(traffic, tabStrip)`。
- **`docs-check` 在 master 上红了 5 天没人发现**（M150 期间发现，2026-09-17）：根因是 `deferred` 不在门禁状态枚举里而文档视为合法；已扩展枚举。结构问题（GitHub CI 无观察者）的候选处置 = 批次收尾加一条 `gh run list --branch master` 确认，落点 `AGENTS.md` 的「tower 操作」硬规则（本批未改该文件）。
- **r1 格式崩溃备份（无 `base_revision`）恢复后首次保存必报一次冲突**：安全方向，仅限跑过 r1 build 的人。
- **kimi-cu `type_text` 走 AX 注入**：编辑器失焦时文本落陈旧原生选区——工具观测，非 app 缺陷。
- **`config.json` 解绑 ≠ 关闭能力**（已录 spec）：解绑后 macOS 原生选择器可能接手（如 ⌃K ⇒ `deleteToEndOfLine:`）。
- **js / ts 对象字面量键的复合 `property` token 有意不修**（M147，low）：{1: "x"} 的数字键取数字色、字符串键取字符串色（通行呈现）；伴一条 `Unknown highlighting tag property` console 噪声。若将来裁「对象键一律属性色」，做法见 finding。指针 `.tower/comms/findings/20260917-worker-jsonhl-improve-javascript-typescript-property-token-console-json-js-ts.md`。
- **`scrollbar-gutter: stable` + 占位滚动条下 `scrollWidth` 恒等式必差 15px**（M177，low）：classic 滚动条环境（CI runner）预留 15px 沟槽；这类断言改用内容几何或行为判据（浏览器钳位是唯一真值）。**已收口**（M663）：仓内唯一的 `scrollbar-gutter: stable`（`.cm-lp-table-scroll`，其纵向本就 `overflow-y: hidden`）已删除，并写成规范禁则（横向细条容器 MUST NOT 声明它，见 `openspec/specs/ui-design-system/spec.md`「滚动条分档与滚动容器注册表」）——MUST NOT 再加回来。指针 `.tower/comms/findings/20260918-worker-m132-m115-bug-scrollbar-gutter-stable-scrollwidth-15px.md`。
- **toml 的表头 `[x]` / `[[x]]` 与布尔、日期共用 legacy mode 的同一 `atom` token，`tokenTable` 分不开**（M179，low）：接受现状并记进 living spec 的「已知例外」；要修只能 patch / fork vendored `mode/toml.js`（非目标）。
- **仅大小写改名不可达（大小写不敏感文件系统）**（M244 r1 P2-3，tower 已裁「本批不做两步改名」）：方向 fail-safe（拒绝而非覆盖）；要修时的落点 `fs_io::rename_entry`（识别「目标存在且与源同一个文件」时先改临时名再改目标名，自带回滚与文案）。
- **rename 的「撞名不覆盖」是复查 + 极窄窗口，不是原子保证**（M244 r1 P2-2）：零窗口需平台原子排他改名（macOS `renamex_np(RENAME_EXCL)` 等），引 libc 与平台分支收益与风险不成比例。
- **`applyListIndent` 的 `state.readOnly` 守卫当前无可达入口**（M249，tower 裁「保留守卫」）：文档 / 场景只许写成「不可达、不构成覆盖声明」。
- **`vault_append`（追加工具）视盘点后补**（2026-10-09，change `add-harness-permission-modes` 的 Non-goal）：触发条件 = vault 写工具的 dogfood 盘点出现「追加」类高频缺口，届时按 ADR 0007 Decision 7 的边界原则判断是否立项。
- **验收批次条件下的「按键部分落地」：定案为注入通道缺陷（M497/M498，2026-10-13，推翻同日较早的「环境噪音」核销）**：根因 = KimiCU `press_key` 的**字符/键码特异丢弃**——字母 'e' 本机确定性丢失（慢速 4/4 全丢）、`cmd+v` 8/9 不落地，外加随机连续丢键段；跨目标族（composer/搜索框/编辑器）老毛病，M139 时代就有，非批次负载、非产品回归。套件侧处置 = M498 新增 `typeInNode` 原语（type_text 无 index 追加 + M143 回读重试），composer 素材注入 81 步迁移，`do: keys` 只留 chord 与豁免面。残余边界：post-menu 态无可靠通道（148 note-/tag- 步与 caret 定位步 141/154 不迁）。指针 `.tower/comms/findings/20261013-agent-m497-bug-composer-keys-kimicu-press-key-e.md`、`20261014-agent-m498-bug-148-note-post-menu-ax-composer.md`。KimiCU 侧值得独立报 bug（跨目标、慢速稳定复现）。**补记（M500/M502 真机实证，2026-10-14）**：AXPress 插卡语境三通道全死且焦点标记与真实投递背离——clickInNode(composer) 的 `focused=AXTextArea` 正观测 PASS 后，下一拍 do:keys（M502 回退后的原字面量）仍整串/部分落进编辑器（82 "alpha"、83 "q"、85 "tp" 逐字节被抓）；编辑器 contenteditable 与 composer 同为 AXTextArea，marker 不可信。82/83/85 残红归此族，非产品回归（同字面量 pre-M498 有 PASS 记录、同场无注入的第二消息发送正常）；转绿需产品侧 reconcile 或套件新通道，待裁。
- **场景 148 残红（post-menu + composer 模型双边界，medium，2026-10-13）**：原 5 项中 ②③④⑤ 已由 M523 收口（2026-10-15，合并 `057fdec`）——② 负断言收紧为 `not: "/\"text\":\"Image \\d+\"/"`（旧子串口径撞用户段落造成假红）；③④⑤（Escape 收起 / harness_pane / 重开开关）落 R2=⌘⇧A 全局通道，R1=clickEditor 后 Escape 被真机探针证伪（Escape 收起处理器挂 panel 元素 `src/harness-panel.ts:6835-6853`，焦点移出面板后事件不经 panel；面板内 Escape 收 pane 覆盖仍由场景 127 守）。仅余 ①（`has: "tag-Image 1"`）：post-menu 素材注入只到 DOM 不进 composer 模型，pre-menu 重组已证伪。转绿三案待 Alex 裁：P1 产品 reconcile（composer 模型/DOM 对账，回归面高）/ P2 套件自有 CGEvent 探针（post-menu 态是否同死未验证，先探针）/ P3 click 落点参数 + 剪贴板 Paste 通道；survey 备料 `.tower/comms/inbox/20261015-worker-survey-a521-tower-survey-summary-m521-a521-13-148.md`。指针 `20261014-agent-m498-bug-m498-extends-148-note-finding-pre-menu-pane.md`。
- **73 等非 composer 可打印 keys 残留面**（M498，low）：73 拒绝原因 textarea 等少数非 composer 目标仍在 `do: keys` 上，同族丢键风险存在但频次低；复发再迁。指针 `.tower/comms/findings/20261013-agent-m498-improve-m498-73-textarea-composer-keys-press-key.md`。

## 工具链与环境

运行纪律与工具层已知边界（逐条一行）。

1. **1420 端口串行**：vite dev server 固定 `127.0.0.1:1420` 且 strictPort——起实例前 `lsof -nP -iTCP:1420 -sTCP:LISTEN`，被占则与对方错峰；验收套件走 1430（`LUMIR_ACCEPTANCE_PORT`）不受此限。
2. **并行批次的磁盘预算**：每个 worktree 的 cargo debug target 占 1.5–3G；磁盘 <1G 时 ENOSPC 硬阻塞所有真机批次。预检口径细分为「worktree 首次构建须 ≥3G，target 已热才可用 2G 档」。
3. **KimiCU 键盘注入对 WKWebView 在窗口遮挡时不可靠**：返回 `occluded:true`，activate 后也未必恢复；AX 写入（`set_value`）可靠。故键盘场景须前台焦点纪律，且**不得用 `set_value` 伪造键盘语义**（不经键位分发链路，验不到 `keys.ts`）。
4. **KimiCU AX 服务会中途全局退化**：`get_app_state` 只剩菜单栏（`element_count` 1–18、`window_bounds x=0 y=0 w=1 h=1`），Finder / Reminders / Lumir 一起坏而 `xpc-ping` 仍报已授权；恢复手段 = 重注册服务（`/Applications/KimiCU.app/Contents/MacOS/kimi-cu install`，tower 两次复验有效）。诊断线索：退化期间 `log show --predicate 'process CONTAINS "kimi-cu"'` 每秒一次 `TCCAccessRequest() IPC`，两次退化都发生在磁盘 <1G 时。
5. **`scripts/perf/memory.mjs` 的 WebKit pid 差集归因在非独占主机不可靠**：外来 helper 会虚高读数（实测一次 409.7MB）。
6. **KimiCU `press_key` 逐键注入丢键（M497 定案 2026-10-13；M509 探针修正主嫌 2026-10-14）**：字母 'e' 确定性丢失（慢速 4/4 全丢）、`cmd+v` 8/9 不落地，外加随机连续丢键段；原生 input 与 contenteditable 同族，丢在 DOM 之前。套件侧兜底 = M143 回读重试 + M498 `typeInNode` 换通道（type_text 追加）；注意 type_text 带 index 是 bbox 中心点击语义（毁 caret）、不带 index 在 post-menu 态死（M456）。**M509 对照探针（84/84 双通道全绿）**：自有 CGEvent 注入器（`/tmp/m509/cgevent-key.swift`，投 .cghidEventTap）与 press_key 在新服务下同场零丢——全部确定性丢键发生在旧 KimiCU 服务（37h CPU）运行期，**主嫌转为 KimiCU 服务退化态（重启可恢复）**，时间切面干净但因果未钉死（缺新服务长跑至退化复现），置信中等偏强。⇧Enter 族处置 = 先在健康服务下复跑，不先换通道；CGEvent 注入器建议落地为套件原语（channel:"cgevent"，照 cgevent-click 模式）。指针 `.tower/comms/findings/20260916-worker-search-bug-kimicu-press-key-wkwebview-input-acceptance-keys.md`、`20261013-agent-m497-bug-composer-keys-kimicu-press-key-e.md`、`20261014-agent-m509-improve-m509-cgevent-press-key-kimicu.md`。
7. **同机第二个 Lumir 实例显著加剧 press_key 丢键**：跑真机验收前的预检须同时确认 1420（dev）与 1430（验收）都没有 Lumir 实例在跑。
8. **孤儿进程巡检**：批次收尾回收 `ps -o pid,ppid,etime,command | grep -E 'playwright|chromium|vite preview'` 中 ppid=1 且 elapsed > 1 天的孤儿；**别碰 Alex 的 dogfood 实例（1420 端口的 vite / `target/debug/lumir`）**。
9. **批次内 target 纪律**：每个 worktree 同一时刻至多一份 cargo target，最后一次 cargo 门禁跑完立即删 target 并广播释放，进真机验收前 `df -h`、<3G 不起构建。共享 / 复用 `CARGO_TARGET_DIR` 跑 `cargo test` 时，跑完须核对本轮确实重编译了 lumir 测试二进制（二进制 mtime 晚于本轮最早源码改动，或跑前 `touch` 目标源码触发重编）——拿不出这个证据就不算跑过（M372 假绿现场：cargo 拿 target 里既有产物的 fingerprint 判本轮已最新，两轮同一 binary hash；见「待修 findings」同名条）。
10. **真机探针的发键通道可泄漏到真实前台 app**（tower，2026-10-12，medium）：IME 组合态不可合成；探针执行期间注意前台焦点归属。指针 `.tower/comms/findings/20261012-tower-improve-app-ime.md`。
11. **锁屏/息屏 ⇒ 全机 AX 树退化，一切 AX/截图通道失效**（agent-m508 实证 2026-10-14；agent-m511 补息屏族 2026-10-14）：`IOConsoleLocked=Yes` 时 macOS 不向后台暴露窗口 AX 内容——全 app AX 树只剩菜单栏、KimiCU 截图空、System Events 报 0 窗口（CGWindowList 却显示在屏）；重启 KimiCU 服务 / fresh MCP 直连均无效。**合盖/息屏同族**：M511 跑批中 loginwindow 记 `LWDisplayWillSleepCallback`（reason:5 clamshell）后 5 场景 INVALID（「前端 30s 未就绪」），唤醒后重跑即恢复——跑批期间必须保持屏幕唤醒（caffeinate -dimsu 之外，合盖状态本身会强制息屏，需注意）。一行判别：`ioreg -n Root -d1 | grep IOConsoleLocked`；真机批预检加这条，锁屏即停（runner 预检建议内置）。与第 4 条（服务中途退化，可重注册恢复）区分：锁屏/息屏型退化只能等唤醒。
12. **本机装有安装版 /Applications/Lumir.app：绝不按名字 `activate "Lumir"`**（agent-m508 事故，2026-10-14）：按名 activate 会经 LaunchServices 拉起安装版第二个实例，写真实配置（window-state 被覆盖、自动注册新 vault 项）。激活一律用 `System Events set frontmost of first process whose unix id is <pid>`。
13. **KimiCU 长驻服务的 CPU 累积观察**（agent-m508，2026-10-14）：旧服务实例存活周一→周三累计 37h CPU 后被重启；未见功能受损直接证据，但批次开工前值得看一眼服务 CPU 时间，异常偏高就重注册（同第 4 条手段）。
14. **M509 探针硬知识四条**（2026-10-14，写场景前必读）：① 空 composer 的 ⇧Enter 确定性 no-op（app 侧语义，两通道实证 20/20）——「空 composer 起步按 ⇧Enter」类判据必假红；② composer 滚动后其 AXTextArea 读数退化成滑窗（前缀漂移 + 内容重复），长 composer 上逐字节 / endsWith / 行数差判据全不可信；③ composer 焦点必须真实 mousedown（AXPress 3/3 不建 DOM 焦点，CGEvent mousedown 1/1 成）——更正 M497 finding 中「AXPress 建焦点」的表述；④ KimiCU listApps 不列新起的 lumir 实例（get_app_state 按 pid 直寻址正常），长跑批留意。指针 `.tower/comms/findings/20261014-agent-m509-improve-m509-cgevent-press-key-kimicu.md`。
15. **起跑预检须覆盖安装版 /Applications/Lumir.app，不只 dev/调试二进制**（agent-m518，2026-10-14）：起跑自检的 pgrep 模式只盯 `target/debug/lumir` 与端口时，装版实例会漏检并挡道（占用配置/窗口通道）。装版实例**空闲 ≥10 分钟且前台是别的 app 时可优雅退出（Apple Event quit）但必须在完工报告/消息里登记**；若它正处于活跃使用（前台、近期有输入），先问 tower 再动，不自行退出。
16. **display-sleep / 锁屏类探针前先预检「立即要求密码」**（worker-flicker-a524，2026-10-15）：该机设了「显示器睡眠后立即要求密码」，`pmset displaysleepnow` 唤醒后控制台直接锁屏（`IOConsoleLocked=Yes`），探针的唤醒后步骤全被挡（第 11 条形态）、且只能等 Alex 输密码解锁。探针前 `defaults read com.apple.screensaver askForPassword` 预检：=1 则先请 Alex 临时关闭、或改走不触发锁屏的探针路径。
17. **真机注入通道新知识四则**（M536 探针定案，2026-10-16）：① press_key 对 cmd+a 确定性丢弃（5/5，与服务健康无关，与 cmd+v 同属键码级丢弃族；同场 cmd+s/cmd+z/ctrl+e/ctrl+n 照落）——「⌘A 建选区」类判据本机不可行；② 套件自有 CGEvent 拖选（cgevent-click.swift mode 5）在 CM 编辑器造不出任何选区（3/3），shift+点击（mode 6）也不延拓——编辑器侧选区只能靠键盘 chord 或双击族（121/122 能用是因目标是 transcript 静态文本）；③ 可靠编辑器选区构造 = doubleClick 连续无分隔符长行（一词即整行，选区在 AXTextArea.value 显露为源码可正观测，场景 160 现用）；④ 老化 kimi-cu service（存活 >2 天 / CPU 十几小时）污染注入的修饰键状态（press_key 字母全大写而系统级修饰读数干净），重启 service 即恢复——跑批预检加服务龄期/CPU 检查（`ps -Ao pid,etime,time,command | grep -i kimi-cu`，龄期 >1 天或 CPU 异常偏高先重启再跑），uppercase 型失败先按服务退化复跑再判。指针 `.tower/comms/findings/20261016-worker-reds153160-improve-m536-cmd-a-cgevent-cm-shift-kimi-cu-service-shift.md`。

## 批次报告索引

报告正文按维护规则移出本文件，一行一条留指针；原文见 git 历史（`git log -p -- docs/backlog.md`）。

- **M455 遗留**（真机 FAIL 归因 + master 视觉门禁修复，2026-10-11，worker-m455）→ 138/140/142/144/145 五项与 m131/m133 两条红的逐项归因；**尾巴见「待 Alex 裁决」的 m133 基线条与「记录在案」的 M455 条**。指针 `.local/reviews/m455-m133-baseline/`、`tests/visual/scenes/m455-*.spec.ts`。
- **M282 遗留**（change `ui-language-i18n` 实现批，2026-09-28）：D6 参数面已闭合、`picker_title()` 已按语言取值；残留 = 日志文本语言口径待确认 + 验收套件退出码分档（另条跟踪）→ 证据 `.local/missions/m282/`。
- **M284**（验收套件语言面修复，2026-09-28）：机制 = `run.mjs` 的 `SUITE_LANGUAGE = "zh"`（套件不再依赖产品默认值）；顺带发现三件（`src/shell.ts:89` 标签段读屏名、preview `eq()` 语言盲区、启动恢复 notice 泄漏中文）已 file finding → `.local/missions/m284/inventory.json`。
- **M285**（选区自绘 + 标签段读屏名，2026-09-28）：装 CM `drawSelection()` + 标签段读屏名挂 `onRelabel`；新增真机取色通道 `lib/pixel.mjs`（口径见 `scripts/acceptance/README.md` 的 `pixel` 小节）→ `.local/missions/m285/{pre,post}-fix/`。
- **M291 选区族对比度**（三主题，2026-09-28）：token 层拆 `--sel-band` + eink `--sel` 族整体重定；未收口面（in-flow 底色盖住选区带）见 finding `20260928-worker-selection-contrast-m291-improve-inline-surface-band-coverage` → `.local/missions/m291/{before,after}/steps.md`。
- **M288 代码块内选区不可见**（2026-09-28，merge `eef2556`）：块底色搬到容器的负 z-index 伪元素 → `tests/visual/scenes/m288-codeblock-selection.spec.ts` + 真机场景 66。
- **M293 eink 字面值归位 token**（2026-09-29，Alex 裁「改。你可以安排时就动手。」）：11 条规则归位、三主题渲染值逐值不变 → `.local/missions/m293/readings-{before,after}.txt`。
- **M294「面」族与一处前景色归位**（2026-09-29，Alex 裁「1. 立；2，删。」）：5 处落点 + 两条 MUST NOT（行区带那一层不动）→ `.local/missions/m294/`。
- **M295 行内 code 药丸选中态不可辨**（2026-09-29，Alex 裁「1. A。2. 顺手收 3. 认。」）：选中段换挡 `--sel-band`；真机场景 68 PASS；同机制未收口面（callout 行底色 / frontmatter 区 / code 模式变量底纹）另立。
- **M296 大 vault 打开忽略集的验收半边**（2026-09-29）：场景 67 落地 + 真机 7/7 PASS + 套件新增 `do: waitFor`；未完成项见「承接残项」的 `vault-open-ignore-set` 条 → `.local/missions/m296/readings.md`。
