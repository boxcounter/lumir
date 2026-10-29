# Backlog — findings 与待裁决队列
唯一的积压载体。**一条 = 一个可关闭单元**：只留结论 gist + 证据指针 + 出口 / 下一动作；叙述与过程状态进 git 历史、`.tower/comms/`、`.local/`。场景清单见 [COVERAGE.md](../scripts/acceptance/COVERAGE.md)，长期口径与已裁暂缓见 [standing-decisions.md](specs/standing-decisions.md)，运行纪律见 [scripts/acceptance/README.md](../scripts/acceptance/README.md)。维护规则：`#decide` 只收价值取舍 / 产品语义（客观可核的由 tower 裁并记录）；**已裁项不留在 `#decide`**——裁决结论随实施条目走（工作项点名裁决与日期），长期口径迁 standing-decisions；`#fix` 客观可核；`#probe` 需实验；`#check` 证据不足；`#hygiene` 已定案的小收尾。**核销即删除、不留索引**（2026-10-12 Alex 裁决），**修复 PR 同批删除对应条目、reviewer 合并前核对**（2026-10-24）；含长期口径时迁 standing-decisions，不留在本文件。**只记改变未来动作的信息**（2026-10-16 Alex 裁决）；**体量红线 80 行**（Alex 2026-10-24，自 300 下调），不为压行数删活条目；引用用主题关键词锚，MUST NOT 用编号或行号；finding 落账率由批次收尾核对（`.tower/comms/findings/` 新增数 = 新增条目数）。出口由 `scripts/backlog-check.mjs` 机器判定（完成标记 / 缺出口 / 重复或死 finding 指针 / 记录在案无 canonical 居所 / 80 行硬上限，无 ratchet、无既有豁免；随 docs-check 跑）。

## 待 Alex 裁决（`#decide`，一行一题）

- **「末尾之后」空段落 / 卡片两子档的呈现**（M457/M473）：末尾空段落是否渲染成可键入的空行、卡片两子档的模型语义——口径草案见 `docs/specs/harness-composer.md` 的 HC3，需 Alex 定表现。
- **「未保存新文档」是否提供创建入口**（M416）：当前无路径产生「无路径、可编辑」文档；做不做、做成什么形态，待 Alex 定义。

## 待修 findings（`#fix` / `#probe` / `#check` / `#hygiene`；★ = 首批六项，无需 Alex 即可立项，按行序执行）

- ★ `#fix` **harness 默认 `wire_api` 切 `chat_completions`**（Alex 2026-10-25 裁）→ 下一动作：`src-tauri/src/config.rs` 的 provider 缺省 `wire_api` 改 `ChatCompletions`；实施项注明支持矩阵（v1 仅 kimi 实现 chat 档，DeepSeek 回落 `responses`，回落告警口径随默认值调整），同步 `openspec/specs/harness/spec.md` / `docs/specs/config-reference.md` 与 `session_open.wire_api` 用例。
- ★ `#fix` **超限轮 usage 读数**（Alex 2026-10-25 裁）→ 下一动作：错误路径拿得到 usage 时同样 `record_usage` 并 emit `usage`；补一条超限轮读数用例（`src-tauri/src/harness/turn.rs` 成功分支之外）。
- ★ `#probe` **82/83/85 与场景 148：套件自有 CGEvent 探针**（Alex 2026-10-25 裁，见 `docs/specs/standing-decisions.md`）→ 下一动作：先落一条套件自有 CGEvent **键盘**注入原语（照 `scripts/acceptance/lib/cgevent-click.swift` 的通道形态；M509 的 `cgevent-key.swift` 探针已证可行）并拿 post-menu 态定性；产品 reconcile（P1）不按首批立项，P3 留备选；结论决定「菜单 Paste 之后注入不落地」条的去向。
- ★ `#probe` **vault 切换 perf 端点**（Alex 2026-10-25 裁：用相对回归，见 `docs/specs/standing-decisions.md`）→ 下一动作：按 M283 草案 §6.4（`openspec/changes/archive/2026-09-28-vault-switch-restore-perf/design.md`）加 `vault-switch` 端点（≈2500 项合成 vault + 40 标签会话，记总时长与三段 `phaseMs`），判据沿用 `docs/specs/perf-measurement.md`「相对回归门禁」的既有口径（当次 median vs 滚动基线 median + 逐指标容忍线），不设绝对阈值。
- ★ `#hygiene` **两处整页基线重建**（Alex 2026-10-25 裁）→ 下一动作：先重截出 diff（M251 菜单左上圆角透底 23px / M281 标签栏·标题栏文字行陈旧），diff 交 Alex 过目后再 `--update`；人肉基线闸不变。
- ★ `#hygiene` **`CARGO_TARGET_DIR` 防假绿防线**（Alex 2026-10-25 裁，见 `docs/specs/standing-decisions.md`）→ 下一动作：把「测试二进制 mtime 晚于本轮最早源码改动」做成门禁判据（跑前 `touch` 目标源码，或核对 binary mtime 二选一）。
- `#fix` **配置写入口读—改—写未同锁**（M615，medium）→ 下一动作：`commands::write_last_vault_to` 迁 `config::update_json_atomic`（`write_config_value_to` 已走同锁入口，只剩这一条）。
- `#fix` **harness usage 六键无消费点**（M533，low）→ 下一动作：核对 `currentUsageReadings` 下游后裁掉六键（`cacheTurn` / `cacheNote` / `cacheWrite` / `cacheWriteSession` / `cachedTokens` / `cachedTokensSession`）与映射、`last*` 转存；Rust 载荷与 JSONL 留存不动。
- `#fix` **孪生探测助手收敛**（M546 后，low）→ 下一动作：抽共享模块（`probeErrorCode` / 批量存在探测 / 失败重试口径），`reading-position.ts` / `vault-switcher.ts` 改 import；finding `20261016-worker-readpos-improve-reading-position-vault-switcher`。
- `#fix` **登录 shell PATH 解析失败静默回退**（M466，low）→ 下一动作：回落时发一条 `log_event`（解析超时 / 标记缺失 / 旗标不支持分类）并扩 `src-tauri/src/logging.rs` 白名单，别只留「继承 PATH」的静默降级。
- `#fix` **两卡相邻间 IME 组合**（M457，medium）→ 下一动作：设计可编辑行内宿主；边界位只派 `beforeinput`、`Range(composer,N)` 量不出 caret。
- `#fix` **M457 的 WebKit 探针未入 git**（medium）→ 下一动作：把 `.local/probes/m462-probe/m462-probe.spec.ts` 入库（选 `tests/unit` 或 `tests/visual` 落点并跑通）。
- `#fix` **click / drag 坐标语义不同**（M490，low）→ 下一动作：README「已知边界」加坐标空间表（哪个动作收截图像素 / 窗口局部点、换算系数）并给 `target: {x,y}` 两种语义改名（`point` / `shotPixel`）；统一换算需先全量统计 `click {x,y}` 用法。
- `#fix` **菜单 Paste 之后注入不落地**（M456/M498，high）→ 阻塞等 82/83/85 与 148 的 CGEvent 探针结论，不另开修法；134/141/150 同族。
- `#fix` **lazy continuation 引用块 / 1–3 空格两档未覆盖**（M421，low）→ 下一动作：补这两档覆盖（几何 + 归属两侧）；`docs/specs/lists.md` 已登记为 v1 已知边界。
- `#fix` **living spec 与实现矛盾无机器防线**（M418，low）→ 下一动作：提议 `docs-check` 增加「现状断言」检查（先例：harness ctx ⓘ 已是 hover 浮层）。
- `#fix` **decision 回填次序启发式**（M413，low）→ 下一动作：恢复路径改用面板记录的 `decision`（或按 call_id 配对），删 `src-tauri/src/harness.rs` 的 `restored_panel_messages` 里「同工具第 N 次」消费 approval sidecar 的启发式。
- `#fix` **权限档位表前后端两份手抄**（M414，low）→ 下一动作：单一来源（Rust 生成或前端共享类型）；现值 `src/harness-panel.ts` 的 `PERMISSION_MODES` 与 Rust 校验表各一份。
- `#fix` **极端矮窗会话浮层越界**（M397，low）→ 下一动作：收紧 `placeSessPop` 纵向夹取（≲392px 时高度也要夹，现在只夹 top）。
- `#fix` **m303 `toBeVisible()` 对祖先裁切无区分度**（M397，low）→ 下一动作：补 overflow 祖先裁切断言（`geom.painted` 已有通道）。
- `#fix` **md 行含 inline widget 时高度表差**（M281，medium）→ 下一动作：定测量通道；只在 gutter 在场时复现。
- `#fix` **路径拼接同形副本**（M258，low）→ 下一动作：`src/main.ts` 的内联「父路径 + 末段名」改用 `src/tree.ts` 的 `relativePathOf`。
- `#fix` **启动恢复让位判定 / `commit_vault_open -> bool`**（M171）→ 下一动作：补 `root.is_some()` 测试；删恒真返回值（`src-tauri/src/commands.rs` 的 `commit_vault_open` 恒 `true`）。
- `#fix` **pendingMove 单槽双写者**（M530，low）→ 下一动作：登记口改队列，或改名回响未消费时 drop 排队（`src/tree.ts`）。
- `#probe` **在途停止丢 reasoning 回放项是否触发 400**（M369，medium）→ 下一动作：下批排真 API 探针；在此之前 MUST NOT 当缺陷修。
- `#check` **切 vault 后新 harness pane 缺标题栏会话段**（M433）→ 下一动作：真机复跑或查标题栏装配。
- `#check` **会话留存路径两处真源**（M433）→ 下一动作：对照 `src-tauri/src/harness/session.rs` doc 与 `src/ipc.ts` 注释，收一份（两处现都写 `sessions/<vault 稳定 id>/<id>.jsonl`）。
- `#check` **gutter 1px 右缘**（M281）→ 下一动作：先确认原缺陷指 md 还是 code；`src/preview/theme.ts` 的 `border:none` 是 md 侧有意口径。
- `#check` **preview-tab 遗留**（M254）→ 下一动作：`rg "预览标签|preview tab"` 逐条确认注释 / 字段说明无旧语义。
- `#check` **math / mermaid 显露判定**（M259）→ 下一动作：确认是否已接 `pointerPressFrame`（`src/preview/reveal-gate.ts`）。
- `#check` **M291 in-flow 底色盖住选区带 / 场景 68 标定待判**（M514）→ 下一动作：确认真机是否仍开；finding `20260928-worker-selection-contrast-m291-bug-in-flow-code-callout-frontmatter`。
- `#check` **历史聚合逐项对账**（M240 表格全屏 / M101–M186 编辑器·键位·shell·系统 / M144 套件表达力与文档指针 / M164 多 vault）→ 下一动作：一个对账 mission，逐子项给三分类（现覆盖 / 失效 / 转独立条目），未分类项不得删；子项明细见 git 历史。
- `#hygiene` **验收套件 README 的双反斜杠示例** → 下一动作：`scripts/acceptance/README.md` 的 `(?![\\s\\S])` 示例改单反斜杠（代码跨度内无需二次转义），并核对该段其它正则示例的转义层数。
- `#hygiene` **`run.mjs --help` 退出码** → 下一动作：加 `--help` 分支打印用法并 `exit 0`（现无该分支），本地跑一次确认退出码与用法文本。
- `#hygiene` **日志文本语言口径**（M282 遗留）→ 下一动作：按 M267 裁决「日志固定英文、存量中文不改写」把口径写进 `src-tauri/src/logging.rs` 模块头，并核对 M282 之后新增的日志文本无中文。
- `#hygiene` **tabs 菜单死选择器** → 下一动作：删 `.tab-menu-item`（`src/style.css` 现 2962–2985）并改 `tests/visual/scenes/tab-menu.spec.ts` 的 CSSOM 断言，或给 tabs 改类名（二选一）。
- `#hygiene` **外链打开失败无可感知反馈** → 下一动作：`src/harness-panel.ts` 的 `openExternalUrl(href).catch(() => {})` 改为失败给 toast（文案走 deck）。
- `#hygiene` **`.lumir-toast` 缺读屏语义** → 下一动作：toast 工厂（`src/main.ts`）加 `role="status"` / `aria-live="polite"`，不打断既有 dismiss 行为。
- `#hygiene` **composer 光标 reveal 无 chromium 断言** → 下一动作：补一条断言（`tests/visual/scenes/` composer 族：光标进入视口后被 reveal）。
- `#hygiene` **缺 `modifiers:["meta"]` 真机夹具** → 下一动作：加一条带 meta 修饰的真机夹具（`scripts/acceptance/`，覆盖 meta+键的落点）。
- `#hygiene` **重启恢复门改动态分流** → 下一动作：`stopApp` 前读 `restoredTabCount>0`，按是否有恢复内容决定是否走恢复门。
- `#fix` **捕获锚在文档原点时运行期不写回**（M280 残余）→ 下一动作：`src/scroll-position-view.ts` 的 `anchor === 0` 提前返回也写回，补判据。
- `#fix` **lightbox 不随文档代际退出**（M280 残余）→ 下一动作：给 `ImageLightbox` 加关闭口子并接入 `closeDocumentOverlays` 的代际信号（`src/main.ts:1408` 已登记），顺手收编它的重复状态机。
- `#probe` **长 chain 注入（8–19 chord）可靠性** → 下一动作：跑一轮量落地率与「可点节点」判定边界，结论落 `scripts/acceptance/README.md`「已知边界」。
- `#fix` **会话浮层快速关→再开重复历史行**（M392）→ 下一动作：复现并定位重复行来源后修，补一条真机判据。

## 承接残项（长期口径 + 未闭合尾巴）

- **多标签会话恢复观测缺口**：启动日志 `session_restored{count}` 未实现（`src-tauri/src/logging.rs` 白名单没有、`src/vault-switcher.ts` 不发）；下一动作：恢复结束时发 `log_event` 并扩白名单。
- **图片行显露口径**：Alex 裁 A = 维持现状；「图片行是否与链接 / 分隔线同口径」将来单独立项，落点 `src/preview/livePreview.ts` Image 分支 + `editor-live-preview` spec 覆盖集。
- **describe-config 面板**：Alex 裁「中期另立项」；照 `describe-bindings` 做「每键生效值 / 出厂值 / 改法」，config 参考文档已由 M247 落地 `docs/specs/config-reference.md`。
- **`vault-open-ignore-set` 未完成项**（M327）：7.2 / 9.3①②⑤ 真机反向验证、10.4 visual 门禁、8.3 残余档复采；下一动作：并成一个小验收 mission。
- **UX 重做批（攒批）**：demo 探针栏去留、宽表横向溢出裁切是否预期、Emacs 档 3 与全产品键位、会话名钮可发现性；下一动作：随 UX 重做会话一起做。
- **dogfood 性能专项（攒批）**：内存合同存量超标（218–222MB vs <200MB，门禁 250MB）、`open-1mb-file` 端点仍是占位口径、vault 打开 / 切换仍同步；下一动作：专项立项时拍板。

## 待真机验收（未收口；场景清单与 item 编号见 COVERAGE.md）

- `02-math-click`（item 2）→ 下一动作：真机判定「公式后 ⌃B 是否 1–2 次」（AX 不暴露光标 / 选区）。
- 左栏拖拽（场景 159）→ 下一动作：Alex 手拖复验根落点（M538）。
- `M455 收尾复跑`（138/140/144/145 与 hover 族 76/87/131/132/133/134）→ 下一动作：真机复跑并登记读数（145 的 `mod+z` 同族观察留给 change 属主裁）。
## 归档跟踪队列（oct24 批剩余；口径见 `docs/process/openspec-workflow.md`）
- **`improve-keybindings-lookup-oct24`**（M715）：delta = keymap-commands 1 条 MODIFIED（键位面板行模型）+ 3 条 ADDED（查找/捕获/详情、非自指入口、命令元数据与字形单一来源），节点 2 走人肉；实现批附带新增真机场景 235 / 236 / 237（查询 / 捕获 / 键盘）与 m133 视觉场景重写——**像素基线待 Alex 过目后重截**（未经过目不得 `--update`）；归档前后各跑 `node scripts/openspec-archive-check.mjs`。
- **`overlay-width-contract-oct24`**（M702，34/37）：节点 1 追认材料已备（D1–D5 落地 + 证据 + 否决回改面，见 proposal）；真机 231/232 PASS（5 + 11 断言，`.local/acceptance/2026-10-24-m711/`）；残留：0.3 / 0.4 待 Alex 追认、9.1 归档期执行；delta = ui-design-system 1 条 ADDED，归档前后各跑 `node scripts/openspec-archive-check.mjs`。
- **`fix-escape-overlay-close-oct24`**（M718，收尾中）：节点 1 已裁（Alex 2026-10-24「采纳你的提案。」，D1 裁 B）；先红后绿——238 红跑（master，Esc 后 AX `element_count: 1`、`ps` 空输出、浮层重建后 0 个 focused 节点）→ 绿跑 PASS（38 断言，`.local/acceptance/2026-10-24/238-escape-overlay-close/RED-before-fix/` 与同目录的 `GREEN-after-fix/`）；239 退出反例 PASS（①②③，含 dirty 文档 Esc 不弹提示）。delta = `keymap-commands` 1 条 ADDED + `harness` 1 条 MODIFIED（节点 2 走人肉）；残留：5.4 全量真机批与 6.x 门禁按本次收尾输出填写；归档前后各跑 `node scripts/openspec-archive-check.mjs`。
- **`add-path-line-range-links`**（M552，19/19）：节点 2 走人肉（delta = harness 两条 MODIFIED）；221 真机 PASS（10 断言，`.local/acceptance/2026-10-24-m711/221-harness-path-line-range/`）；归档前后各跑 `node scripts/openspec-archive-check.mjs`。
- **`add-cron-notification-relaunch`**（2026-10-28 实现批）：delta = cron / harness 等 4 条 capability 增量，详见 change。节点 1 已裁（Alex 2026-10-28「按推荐」）。真机：169 PASS；213 / 252-cron 未通过——① 验收 bundle 的 fail-closed 隔离包装自身有缺陷（`build-bundle.mjs:95` 的 `case` 模式与套件隔离根不匹配 ⇒ 任何拉起都被拒；拒绝分支 `set -u` 下崩溃），见 finding `20261028-worker-automated-acceptance-ev-bug-bundle-case-env-set-u-bundle-invalid.md`；② 绕开①后通知授权被拒（`UNErrorDomain error 1`），到点通知从未投递；③ 点击段按 README「cron 通知点击在当前 macOS 构建上不可自动驱动」条仍不可自动驱动（170 人工段按任务显式跳过）。冷启动本机读数 median 175.65ms / p95 181.57ms（`.local/perf/cold-start.json`），对照合同 <300ms 未退化。**非 macOS 编译未验证（本机只有 macOS 目标链，见 tasks 同名记录）**。**6.4 / 6.5 未通过前不得归档。**
- **`add-proactive-subagent-delegation`**（M806 / M807 实现与场景批 + M812 真实 provider 验收）：delta = `harness-subagents` 1 条 ADDED（委派的触发时机）+ 1 条 MODIFIED（内建定义：`explore` 四件、新增 full-9 `general`）× `harness` 1 条 MODIFIED（`llm_request.tool_names`）；节点 1 已裁（Alex 2026-10-29，含 full-9 `general`），节点 2 按五要件走机器判据。真机 `180` / `194` / `257` PASS（`.local/acceptance/2026-10-30-m807-mock-3of3/`）、`187` / `200` PASS；真实 provider 六格 + 两轮 A 措辞修订通过（`.local/reviews/proactive-subagent-delegation-oct29/real-provider.md`）；改动面含 `src-tauri/src/harness/tools.rs`（判据一一处）与 `docs/specs/subagent-definitions.md`（逐字抄录）。**MUST 在 `add-harness-vault-workspace-list` 之后归档（design §8 的闭集合前提）**；归档前后各跑 `node scripts/openspec-archive-check.mjs`。
