# Backlog — findings 与待裁决队列
唯一的积压载体。**一条 = 一个可关闭单元**：只留结论 gist + 证据指针 + 出口 / 下一动作；叙述与过程状态进 git 历史、`.tower/comms/`、`.local/`。场景清单见 [COVERAGE.md](../scripts/acceptance/COVERAGE.md)，长期口径与已裁暂缓见 [standing-decisions.md](specs/standing-decisions.md)，运行纪律见 [scripts/acceptance/README.md](../scripts/acceptance/README.md)。
维护规则：`#decide` 只收价值取舍 / 产品语义（客观可核的由 tower 裁并记录）；`#fix` 客观可核；`#probe` 需实验；`#check` 证据不足；`#hygiene` 已定案的小收尾。**核销即删除、不留索引**（2026-10-12 Alex 裁决），**修复 PR 同批删除对应条目、reviewer 合并前核对**（2026-10-24）；含长期口径时迁 standing-decisions，不留在本文件。
维护规则续：**只记改变未来动作的信息**（2026-10-16 Alex 裁决）；**体量红线 80 行**（Alex 2026-10-24，自 300 下调），不为压行数删活条目；引用用主题关键词锚，MUST NOT 用编号或行号；finding 落账率由批次收尾核对（`.tower/comms/findings/` 新增数 = 新增条目数）。出口由 `scripts/backlog-check.mjs` 机器判定（完成标记 / 缺出口 / 重复或死 finding 指针 / 记录在案无 canonical 居所 / 80 行硬上限，无 ratchet、无既有豁免；随 docs-check 跑）。

## 待 Alex 裁决（`#decide`，一行一题）

- **harness 默认 `wire_api` 是否切 `chat_completions`**（M463/M464，2026-10-17 定论；当前默认仍 `responses`）：Responses 路径有 ~41.7 万字节请求体闸，chat 方言下 `input_tokens ÷ 262,144` 才诚实、85% 预警才可达；开关 `[harness].providers.<id>.wire_api`，回退成本为零。
- **超限那轮 meter 是否同步读数**（2026-10-18）：错误路径 return 早于 `record_usage`，超限轮读数停在旧值；改不改、读什么数。
- **M251 两张菜单基线（23px 差异）是否重建**（2026-09-27）：菜单左上圆角透底变化；基线更新是人肉裁决点。
- **共享 `CARGO_TARGET_DIR` 与 dev-only 脚本化驱动入口是否立项**（M372，合并原两条）：复用旧测试二进制曾致假绿；驱动入口是另一条长期候选。
- **vault 切换是否设 perf 门禁端点**（M283）：绝对阈值还是相对回归；端点属性能合同扩张（草案 `openspec/changes/archive/2026-09-28-vault-switch-restore-perf/design.md` §6.4）。
- **整页基线在标签栏 / 标题栏文字行陈旧是否重建**（M281）：0.001 档静默；人肉基线裁决点。
- **`gh run list` 观察者规则是否写进 AGENTS.md 硬规则**（M150）：CI 无观察者的结构问题；需 Alex 过目。
- **82/83/85 注入通道：产品 reconcile 还是套件新通道**（M497/M498/M500/M502）：AXPress 插卡语境三通道全死、焦点标记与投递背离；产品侧回归面高，套件通道未验证。
- **场景 148 残红三案选哪条**（M523）：P1 产品 reconcile（模型 / DOM 对账）/ P2 套件自有 CGEvent 探针 / P3 click + 剪贴板 Paste。

## 待修 findings（`#fix` / `#probe` / `#check` / `#hygiene`）

- `#fix` **两条配置写入口读—改—写未同锁**（M615，medium）→ 下一动作：`commands::write_last_vault_to` / `write_config_value_to` 迁 `config::update_json_atomic`（`src-tauri/src/config.rs:1826-1860`）。
- `#fix` **harness usage 六键跨层收口**（M533，low）→ 下一动作：核对 `src/harness-panel.ts:1964-1975` 消费点后裁剪或结案；Rust + 前端映射同批，留存不动。
- `#fix` **孪生探测助手收敛**（M546 后，low）→ 下一动作：抽共享模块，`reading-position.ts` / `vault-switcher.ts` 改 import。
- `#fix` **登录 shell PATH 解析失败静默回退**（M466，low）→ 下一动作：加可观测信号，或作为 idea 关闭。
- `#fix` **「末尾之后」空段落 / 卡片两子档**（M457/M473）→ 下一动作：需模型语义或 Alex 裁表现；口径见 `docs/specs/harness-composer.md` HC3。
- `#fix` **两卡相邻间 IME 组合**（M457，medium）→ 下一动作：设计可编辑行内宿主；边界位只派 `beforeinput`、`Range(composer,N)` 量不出 caret。
- `#fix` **M457 的 WebKit 探针未入 git**（medium）→ 下一动作：把 DOM 回归探针入库；形状见 `.local/probes/m462-probe/`。
- `#fix` **click / drag 坐标语义不同**（M490，low）→ 下一动作：统一坐标空间或改名；`click {x,y}` 是截图像素、`drag {x,y}` 是窗口局部点。
- `#fix` **菜单 Paste 之后注入不落地**（M456/M498，high）→ 下一动作：阻塞等 DECIDE「82/83/85」「148 三案」，不另开修法；134/141/150 同族。
- `#fix` **「未保存新文档」无 UI 入口**（M416，medium）→ 下一动作：产品缺口，待 Alex 定义；当前无路径产生「无路径、可编辑」文档。
- `#fix` **lazy continuation 引用块 / 1–3 空格两档未覆盖**（M421，low）→ 下一动作：补这两档覆盖；`docs/specs/lists.md` 已登记为 v1 边界。
- `#fix` **living spec 与实现矛盾无机器防线**（M418，low）→ 下一动作：提议 `docs-check` 增加现状断言检查（先例：harness ctx ⓘ 已是 hover 浮层）。
- `#fix` **decision 回填按「第 N 次出现」错配**（M413，low）→ 下一动作：回填键改为（工具名 + 调用 id）。
- `#fix` **权限档位表前后端两份手抄**（M414，low）→ 下一动作：单一来源（Rust 生成或前端共享类型）。
- `#fix` **极端矮窗会话浮层越界**（M397，low）→ 下一动作：收紧 `placeSessPop` 纵向夹取（≲392px）。
- `#fix` **m303 `toBeVisible()` 对祖先裁切无区分度**（M397，low）→ 下一动作：补 overflow 祖先裁切断言（`geom.painted` 已有通道）。
- `#fix` **md 行含 inline widget 时高度表差**（M281，medium）→ 下一动作：定测量通道；只在 gutter 在场时复现。
- `#fix` **路径拼接同形副本**（M258，low）→ 下一动作：`src/main.ts` 的内联「父路径 + 末段名」改用 `src/tree.ts` 的 `relativePathOf`。
- `#fix` **Rust 锁内磁盘 IO**（M154）→ 下一动作：先在锁外读成 `Vec<(path, Option<String>)>` 再取锁 upsert；收窄锁不移 IO 出主线程。
- `#fix` **启动恢复让位判定 / `commit_vault_open -> bool`**（M171）→ 下一动作：补 `root.is_some()` 测试；删恒真返回值。
- `#fix` **pendingMove 单槽双写者**（M530，low）→ 下一动作：登记口改队列，或改名回响未消费时 drop 排队。
- `#probe` **在途停止丢 reasoning 回放项是否触发 400**（M369，medium）→ 下一动作：下批排真 API 探针；在此之前 MUST NOT 当缺陷修。
- `#check` **切 vault 后新 harness pane 缺标题栏会话段**（M433）→ 真机复跑或查标题栏装配。
- `#check` **会话留存路径两处真源**（M433）→ 对照 `session.rs` doc 与 `ipc.ts` 注释，收一份。
- `#check` **gutter 1px 右缘**（M281）→ 先确认原缺陷指 md 还是 code；`src/preview/theme.ts:440-455` 的 `border:none` 是 md 侧有意口径。
- `#check` **preview-tab 遗留**（M254）→ 逐条确认注释 / 字段说明是否仍有旧语义。
- `#check` **math / mermaid 显露判定**（M259）→ 确认是否已接 `pointerPressFrame`（`src/preview/reveal-gate.ts`）。
- `#check` **表格全屏聚合**（M240）→ 逐子项对账：长表 / visual README 22 处 / config theme / 计算属性 / typography Purpose / 32-list-filter / Lezer 包。
- `#check` **编辑器 / 键位聚合**（M101–M186）→ 逐子项对账：Alt+Shift、warnings UI、toast z-index、`$` 转义、mathSpanCrossed、⌃B、grid 表、删浮条、D40、hidden pipe、cell 公式、构造函数属性。
- `#check` **shell / 系统聚合**（M101–M186）→ 逐子项对账：退出守卫、`{id}.json.tmp` 过滤、vault 滚动、焦点建议。
- `#check` **验收套件表达力聚合**（M144）→ 逐项对账余下子项，明细见 git 历史。
- `#check` **文档指针聚合** → 逐项对账：M205/M208 旧路径、M151 失准、D64 过期、HEAD==origin/master、ADR 0002 200MB vs 250MB。
- `#check` **多 vault 聚合**（M164）→ 逐项对账：视觉容差、窗口屏外、`M-<` / `M->`、demo 脱节、D90、tauri test feature、目录选择、`commit_vault_open` 分支。
- `#check` **restyle 聚合**（M215/M216）→ 逐项对账：0.001 容差、code 模式 150px、doc-meta mtime、eink keyword 700。
- `#check` **M291 in-flow 底色盖住选区带 / 场景 68 标定待判（M514）** → 确认真机是否仍开；finding `20260928-worker-selection-contrast-m291-bug-in-flow-code-callout-frontmatter`。
- `#hygiene` **机械收尾（文档 / 套件 / 配置）** → 下一动作：场景 123 改 `focusWindow` 为 `click:true` 口径；README 的 `(?![\\s\\S])` 双反斜杠示例改为单反斜杠；`run.mjs --help` 打印用法退出 0；删除 `.tab-menu-item` 死选择器（`src/style.css:2529-2568`）并改 `tests/visual/scenes/tab-menu.spec.ts:358` 的 CSSOM 断言，或给 tabs 改类名（二选一）；M282 日志文本语言口径确认。
- `#hygiene` **产品行为收尾** → 下一动作：外链失败加 toast（`src/harness-panel.ts:2805`）；`.lumir-toast` 加 `role="status"` / `aria-live="polite"`；补 composer 光标 reveal 的 chromium 断言；重启恢复门改动态分流（`stopApp` 前读 `restoredTabCount>0`）；加一条 `modifiers:["meta"]` 真机夹具；M280 ESC 三条残余（vault 切换器第二份 `scrollSnapshot` / 捕获锚在原点不写回 / lightbox 不随文档代际退出）；套件长 chain 注入（8–19 chord）可靠性与可点节点面；会话浮层快速关→再开重复历史行（M392）攒批处理。

## 承接残项（长期口径 + 未闭合尾巴）

- **多标签会话恢复观测缺口**：启动日志 `session_restored{count}` 未实现（`src-tauri/src/logging.rs` 白名单没有、`src/vault-switcher.ts` 不发）；下一动作：恢复结束时发 `log_event` 并扩白名单。
- **图片行显露口径**：Alex 裁 A = 维持现状；「图片行是否与链接 / 分隔线同口径」将来单独立项，落点 `src/preview/livePreview.ts` Image 分支 + `editor-live-preview` spec 覆盖集。
- **describe-config 面板**：Alex 裁「中期另立项」；照 `describe-bindings` 做「每键生效值 / 出厂值 / 改法」，config 参考文档已由 M247 落地 `docs/specs/config-reference.md`。
- **`vault-open-ignore-set` 未完成项**（M327）：7.2 / 9.3①②⑤ 真机反向验证、10.4 visual 门禁、8.3 残余档复采；下一动作：并成一个小验收 mission。
- **UX 重做批（攒批）**：demo 探针栏去留、宽表横向溢出裁切是否预期、Emacs 档 3 与全产品键位、会话名钮可发现性；下一动作：随 UX 重做会话一起做。
- **dogfood 性能专项（攒批）**：内存合同存量超标（218–222MB vs <200MB，门禁 250MB）、`open-1mb-file` 端点仍是占位口径、vault 打开 / 切换仍同步；下一动作：专项立项时拍板。
- **M455 收尾尾巴** → 下一动作：真机复跑 138/140/144/145 与 hover 族 76/87/131/132/133/134；145 的 `mod+z` 同族观察留给 change 属主裁。

## 待真机验收（未收口；场景清单与 item 编号见 COVERAGE.md）

- `02-math-click`（item 2）→ 下一动作：真机判定「公式后 ⌃B 是否 1–2 次」（AX 不暴露光标 / 选区）。
- `153-ordered-list-auto-mode`（item 153）→ 下一动作：留 dogfood 批次真机跑列表自动模式三态 + IME 组合期不重复；裸 DOM 变更形态不兜。
- 左栏拖拽（场景 159）→ 下一动作：Alex 手拖复验根落点（M538）。

## 归档跟踪队列（oct24 批剩余；口径见 `docs/process/openspec-workflow.md`）

- **序 10 · `readonly-allowlist-tightening-oct23`**（M664，16/22）：6 项未勾，场景 231 未跑；归档前 MUST 把 MODIFIED 块重写为「master 原文 + M649 解包段 + M664 收紧段」，否则 M649 段会被「改写」配对静默抹掉。
- **序 11 · `rg-zip-flags-dangerous-oct24`**（M672，11/11）：delta = 序 10 全文 + `-z` / `--search-zip` 改写，必须紧接序 10。
- **`fix-quote-decode-error-copy-oct24`**（M686，tasks 全勾）：一条 ADDED requirement；节点 2 走人肉，归档前后各跑 `node scripts/openspec-archive-check.mjs`。
- **`semantic-selection-markdown-oct23`**（M687，28/29）：一条 ADDED requirement；4.5 dogfood 归 Alex，节点 2 走人肉，归档前后各跑门禁。
- 外部前置：`harness-permission-rules-oct23`（33/36）与 `quick-open-file-oct23`（40/42）可先归档；前者 4.3 已由 229 真机 PASS 覆盖，是否勾选由 M649 属主按任务原文裁定。
