# Tasks: file-tree-context-menu

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，
不是「跑过了」的口头声明（[REVIEW.md](../../../../REVIEW.md) 第 7 条）。

**提案阶段状态（M234，2026-09-26）**：本 change 只到节点 1，以下任务**全部未开工**——`[ ]` 是
提案阶段的默认状态。实现批次接手时按第 1 节起手，并把每条任务勾选时的证据指针补进本文件。

**裁决状态（2026-09-26）**：裁决点 2（删除 = 废纸篓 + 确认）、3（重命名 = 树内联）、4（复制 =
绝对路径）Alex 已预裁决，对应任务按此写定；裁决点 1（菜单形态，推荐 web 自绘）与 5（tab 联动，
推荐 remap + 抑制）待节点 1 拍板——若裁决改项，[design.md](design.md) §2 与 §3.2 按新口径改写
后再进实现。

**实现批次收口（M244，2026-09-27，worker-tree-menu / wt-244）**：§1–§6 逐条落地情况见下方各条的
「证据」行；**唯一未达全绿的是 §6 的真机场景**（0/1 PASS，两轮），未达的成因与已实证的条目见
§6 的收口说明与场景正文的「已知边界」——按 M184 口径如实登记，不冒称。

**真机场景取号对账（2026-09-26）**：`scripts/acceptance/scenarios/` 仓内序列到 36；inbox registry
到 43（M230）；44–46 按 tower 简报为在途已占。**本 change 取 47（`47-file-tree-context-menu`），
无撞号、未顺延**，已对全员广播（`.tower/comms/inbox/20260926-worker-proposal-tree-menu-all-
acceptance-scenario-numbering-m234-47.md`）。

## 1. 现状读数与反向验证（实现前，先测再改）

- [x] 1.1 现状读数：右键文件树条目，记录 ① 无任何应用内菜单出现（系统菜单被拦或空白）、
      ② 当前打开文件与 tab 列表不变。
      **收口（M244）：顺序倒了**——本批没有在实现前落 readings-before.json（先写了实现），
      因此这一条按「未按先行口径执行」登记，不补造读数。替代证据：真机两轮运行里
      「右键不改上下文」的核心断言（无当前文件覆盖层 + 标签栏为空）在实现后 PASS，
      见 `test-results/acceptance/2026-09-26/47-file-tree-context-menu/steps.md`。
      **验收口径**：读数落 `test-results/acceptance/<日期>/47-file-tree-context-menu/readings-before.json`
      （可 `ls`），与「全仓无 contextmenu 接线」的代码事实一致。
- [x] 1.2 反向验证（先红）：把「右键 → 菜单浮层可见且含 6 项」断言在未实现前跑一次，必须 FAIL。
      **收口（M244）：同样顺序倒了**（未在实现前跑）。已用**等价的反向输入**代替并留档：
      ① `tests/unit/tree-menu.test.ts` 的「项集分流」断言带反向输入（文件项集与目录项集必须不同）；
      ② `tests/visual/scenes/tree-menu.spec.ts` 的改名回响抑制断言带反向验证——同一个 dirty 会话
      被**真实**外部修改时「检测到外部修改」必须出现（若那条负向断言恒真，这一条就会红）；
      ③ 真机场景 47 的剪贴板断言带反向铺底（复制前先断言剪贴板不含目标绝对路径）。
      未做的是「未实现前跑一次」这一步本身，如实登记。
- [x] 1.3 剪贴板反向用例：清空剪贴板后断言「复制完整路径」读到期望值——未实现时必须 FAIL
      （读到旧值/空），确认断言有区分度（[REVIEW.md](../../../../REVIEW.md) 第 1 条）。
      **收口（M244）**：套件没有「清空剪贴板」的动作（刻意不开通用 shell），改用**反向铺底断言**
      （`clipboard: { not: "$vault/aaa-menu.md" }` 在复制前跑）：首轮真机读数 `剪贴板 = `（空，
      PASS）→ 复制后 `clipboard: { exact: ... }` 才有区分度。证据：steps.md 的两条 clipboard 断言
      与被复制值的逐字读数（首轮误打到了目录菜单，读数是 `/tmp/lumir-m102-acceptance/menu-sub`
      ——反向证明了断言真的在读剪贴板而不是恒真）。

## 2. 后端：文件级命令（fs_io + commands）

- [x] 2.1 `resolve_new_in_vault`：父目录走 `resolve_in_vault`，末段名校验（非空 / 无 `/` /
      非 `.`/`..` / 不命中 `IGNORED_NAMES`），存在性探测 → `fs_already_exists`。
      **验收口径**：Rust 单测覆盖逃逸、忽略集名、撞名、正常路径；`cargo test` 日志落
      `test-results/`。
      **证据（M244）**：`src-tauri/src/fs_io.rs` 的 `resolve_new_rejects_escape_bad_names_and_collisions`
      （逃逸 ×3 / 非法名 ×7 / 撞名 ×2 / 父不存在 / 父是文件 / 正常 ×2）全绿，落在
      `GATE PASS cargo-test` 的日志（`/var/folders/.../lumir-gate-cargo-test.*`，日志路径见本批
      review request）。
- [x] 2.2 `fs_trash_entry`（trash crate）/ `fs_rename_entry` / `fs_create_file` /
      `fs_create_dir` / `fs_reveal_in_finder` 五条 command，错误码按 [design.md](design.md)
      §3.7 表。
      **验收口径**：每条至少「正常 + 两类错误」单测；`Cargo.toml` 的 `trash` 条目附「为什么引、
      为什么不用替代」注释（既有依赖注释格式）。
      **证据（M244）**：五条命令的实现分别在 `commands.rs`（薄封装）+ `fs_io.rs`（判定与 IO）；
      单测 `trash_moves_entry_out_of_vault_and_reports_human_errors`（正常 + fs_not_found +
      fs_path_invalid）、`trash_refuses_vault_root_reached_through_symlink`、
      `rename_moves_within_parent_and_never_overwrites`（正常含嵌套与目录 + 撞名 + 源不存在 +
      非法名）、`create_file_and_dir_are_atomic_and_refuse_collision`（正常 + 撞名 + 忽略集名 +
      逃逸父 + 父不存在）、`validate_new_name_*`。**已知偏离**：macOS 上 `trash::os_limited`
      （list / restore）不参与编译，因此成功路径的测试无法把条目放回——测试注释里写明「会往用户
      废纸篓放一个可辨识的空文件」，并把「可恢复」交给真机场景与 crate 的平台语义。
- [x] 2.3 capabilities 零增量核对：`default.json` 不变；opener 的 webview ACL 仍为默认拒绝
      （grep 确认无 `opener:*` 权限新增）。
      **证据（M244）**：`git status --short` 无 `src-tauri/capabilities/` 改动；
      `rg "opener" src-tauri/capabilities/` 零命中。
- [x] 2.4 ts-rs bindings 导出核对：新命令涉及的 payload 类型（如有）进 `src/bindings/`，
      由 cargo test 顺带导出（既有纪律）。
      **证据（M244）**：五条命令只返回 `String`（新建/改名后的 vault 相对路径），没有新 payload
      类型 → 无 bindings 变化；`GATE PASS bindings-drift`（`git status --porcelain -- src/bindings/`
      为空）即这一条的机器判据。

## 3. 前端：菜单浮层与内联编辑

- [x] 3.1 `src/tree-menu.ts` 浮层模块 + `src/tree.ts` 的 `contextmenu` 接线；项集按条目类型
      分流（design §2.2）；键位 ↑↓/⌃N⌃P/Enter/Esc/外部点击关闭；右键不改上下文。
      **验收口径**：单元测试或 chromium 断言覆盖项集、键位、关闭路径；「右键不改上下文」有
      专项断言。
      **证据（M244）**：`tests/unit/tree-menu.test.ts` 16 例（项集分流含反向输入、打开即持焦点、
      ↑↓/⌃N⌃P 等价与两端钳制、Enter/Esc/外部 mousedown/菜单内 mousedown 四条关闭路径、
      焦点归还锚点行）；`tests/visual/scenes/tree-menu.spec.ts`（chromium，11 例全绿）覆盖渲染与
      「右键不改上下文」（无标签、编辑器仍空态、目录不展开）；真机侧同理（AX 里 AXMenuItem 六项
      齐全，见场景 47 的 `ax/03-目录行右键菜单.txt`）。
- [x] 3.2 内联编辑（重命名 + 新建共用）：Enter 提交 / Esc 与失焦取消 / 行内校验标红；编辑期
      行交互抑制。
      **验收口径**：校验矩阵（空 / 含 `/` / `.`/`..` / 忽略集名 / 撞名）逐项有红→绿记录。
      **证据（M244）**：`tests/unit/tree-paths.test.ts` 的校验矩阵 15 行逐项断言（非法 11 项各给
      原因 + 合法 4 项放行 + 反向输入证明撞名判定真的在用 sibling 集合）；
      `tests/visual/scenes/tree-menu.spec.ts` 的「内联重命名」「撞名拒绝」两例（含元素基线
      `inline-rename.png` / `inline-rename-invalid.png`）；「编辑期交互抑制」是**结构性**的
      ——编辑行整行换成 `div`（原先是 `button`），断言 `button.ft-row` 计数为 0。
- [x] 3.3 复制完整路径：绝对路径拼接一处实现；成功/失败 toast；`navigator.clipboard` 不可用时
      按 design §5.2 的既定退路落后端命令（行为契约不变）。
      **证据（M244）**：拼接唯一一份 = `src/tree.ts` 的 `vaultAbsolutePath`（单测 5 例，
      `tests/unit/tree-paths.test.ts`）；成功 toast 与绝对路径实写在 chromium 断言
      （`tree-menu.spec.ts` 的剪贴板 stub 用例）；**真机实证**：`navigator.clipboard.writeText`
      在真实 WKWebView 下可用（场景 47 首轮 `clipboard` 读数 `/tmp/lumir-m102-acceptance/menu-sub`
      是一个真实绝对路径），因此 **design §5.2 的退路（后端剪贴板命令 + 插件）不需要启用**——
      按「行为契约不变地换通道」的口径，本批不引新依赖。失败路径（写失败 toast + console 线索）
      只有代码路径、无真机读数：**未验**（无法在真机上制造剪贴板拒绝）。
- [x] 3.4 确认对话框（删除）：文件与目录两种文案，目录明示「连同其中全部内容」；焦点管理与
      归还同 bindings-panel 先例。
      **证据（M244）**：`src/tree-menu.ts` 的 `createConfirmDialog`（role=dialog + aria-modal、
      初始焦点在取消、Tab 陷阱、Esc/遮罩取消、关闭归还焦点）；单测 4 例；chromium 两例 + 两张
      元素基线（`trash-confirm-file.png` / `trash-confirm-dir.png`）；**真机**：目录档正文
      「menu-sub 会连同其中全部内容一起移到系统废纸篓。」PASS（场景 47 的
      `shots/06-删除确认框_目录_.jpeg`）。

## 4. tab 联动（裁决点 5 落地）

- [x] 4.1 rename remap：文件 = 单 session 路径替换；目录 = 前缀 remap；dirty / revision / 滚动 /
      光标保留。
      **证据（M244）**：`src/editor.ts` 的 `remapSessionPaths`（只改路径 + 按新路径重裁
      mode/editable + 重建前台装饰），纯函数 `remapPathAfterRename` 在 `src/tree.ts`（单测 6 例：
      文件 / 目录子树 / 同前缀不同条目 / 目录外路径）；**chromium 端到端**：改名后标签可见文本、
      `dataset.path`、未保存标记、编辑器内容四样一起对齐
      （`tree-menu.spec.ts` 的「改名打开中的 dirty 文件」）；**真机未验**（见 §6）。
- [ ] 4.2 watcher 回响一次性抑制：`old→new` 对在 **invoke 发起时**登记、invoke 失败即撤（消除
      乱序窗口）；watcher 批消费时在 **session 链路同时吞 `deleted:old` 与 `created:new` 两个事件**
      （树与索引照常收敛）——remap 后 `session.path` 已是 new，`deleted:old` 匹配不到，真正会误报
      的是 `created:new` 命中 dirty session 走「检测到外部修改」分支（r1 评审指正的机制）。消费
      即清 + 1s 超时；外部改名无抑制条目、走现状处置。
      **验收口径**：真机改名打开中的 dirty 文件 20 次，「已被外部删除」与「检测到外部修改」两种
      误报均零（design §5.3），读数落盘。
      **收口（M244）：20 次循环未跑，本条在真机上未验**（如实登记，不冒称）。已验的是机制本身：
      单测 4 例（两个方向 + 子树都吞 / 撤登记 / 跨批只到一半时留到下一批、超时即清 / 无登记时一条
      都不吞）+ chromium 端到端 1 例（改名后 fire 真实的 `deleted:old` + `created:new` 双事件 →
      无两种误报 + 树照常收敛）**且带反向验证**（同一 dirty 会话被真实外部修改时「检测到外部修改」
      必须出现）。真机 20 次循环没跑的直接原因是注入通道：右键走真实指针坐标，目标行必须在可视区内
      （两轮实测分别撞上「节点 y=1307/1347 超出窗口」与「取不到窗口截图」），且键盘注入有整批丢键 /
      部分落地（M184 既有账）。
- [x] 4.3 删除命中打开 tab：走 `handleExternalChange` 现状分支，不特判；专项断言「sticky 提示
      出现且内容未丢」。
      **证据（M244）**：`src/main.ts` 的抑制**只**跳过已登记的改名回响（`renamed.has(hit.path)`），
      删除事件不在登记对里 → 原样走 `handleExternalChange`；chromium 断言
      「删除打开中的文件：沿用既有外部删除处置」（sticky「当前文件已被外部删除；编辑器中的内容
      未丢失」出现 + 标签保留 + 编辑器内容逐字节不变）。**真机未验**（见 §6）。

## 5. 门禁与文档

- [x] 5.1 文案登记 `文案-Copy.md`（D120 起）：菜单项、确认对话框、错误/成功提示，逐条编号
      并在文末索引节补落点说明。
      **证据（M244）**：D125–D147（23 条：菜单读屏名 + 六个菜单项 + 确认框五句 + 复制两条 toast
      + 内联编辑占位与三条读屏名 + 五条行内校验原因），文末索引节的批次说明与「文案实现备注」的
      落点段都已补；`tests/unit/tree-menu.test.ts` / `tree-paths.test.ts` 按 deck 表格行逐字断言
      （漂移即红）。
- [x] 5.2 `bash scripts/gate.sh quick` 全绿；视觉门禁：菜单与内联输入是新增 UI 元素，新增元素级
      视觉基线（整页基线不动；改动面核对 `tests/visual/README.md` 的卫生纪律——本 change 不删除
      既有 UI 元素，无需核对存量基线时间戳）。
      **证据（M244）**：`GATE RESULT: 9/9 PASS（SKIP 0）`（quick）与 `12/12 PASS`（visual，
      含 `GATE PASS visual-regression 303s`——**448 passed / 1 skipped**，存量基线无一失配）；
      新增 7 张元素级基线在 `tests/visual/baselines/tree-menu.spec.ts-snapshots/`，逐张 sha256
      manifest 与人工核对结论落 `test-results/m244/baselines-manifest.md`（**整页基线零改动**：
      `git status` 里 `baselines/` 下只有新增的那一个目录）。
- [x] 5.3 `npx --yes @fission-ai/openspec@1.12.0 validate file-tree-context-menu --strict` 通过。
      **证据（M244）**：`GATE PASS openspec-validate`（gate.sh quick 的第 10 项，用的就是
      `--strict` 口径；日志路径见本批 review request）。

## 6. 真机验收场景 47

- [x] 6.1 新增 `scripts/acceptance/scenarios/47-file-tree-context-menu.md`，覆盖：右键出菜单
      （文件/目录项集分流）、删除进废纸篓（vault 内消失 + 命令 Ok；废纸篓目录断言按 design §6
      的隔离口径）、内联重命名（含撞名拒绝）、复制完整路径（`osascript -e 'the clipboard'`
      断言绝对路径）、在 Finder 中显示（命令 Ok 弱断言 + 无文件系统变更）、目录下新建文件并
      自动打开、新建子目录、tab 联动（改名 dirty 文件不误报、删除打开文件走现状处置）。
- [x] 6.2 场景正文写明各断言的反向用例与证据落点；`node scripts/acceptance/run.mjs --check 47`
      静态校验通过。
      **证据（M244）**：`node scripts/acceptance/run.mjs --check` →「场景静态校验通过（54 个）」，
      逐行输出里 `CHECK PASS 47-file-tree-context-menu`（`--check` 校验全部场景、不接受 id 过滤，
      这一行就是 47 的结论）。反向用例写在场景里：剪贴板反向铺底、每条负向断言前的正向锚点、
      撞名 / 忽略集拒绝都配「磁盘逐字节不变」。
- [x] 6.3 若右键菜单在真机注入通道不可达（M184 dblclick 前科），按 M184 既定口径转 chromium
      断言 + Alex 手感清单，场景条目如实标注「未验」，不冒称（[REVIEW.md](../../../../REVIEW.md)
      第 6 条）。
      **本批触发的是「半可达」**：目录行的右键可达（六项菜单真机 PASS），文件行与更靠下的行不可达
      （坐标出视口 / 取不到截图 / 窗口被遮挡）。按既定口径处理：场景正文的「已知边界」逐条写明
      未验项与原因，覆盖由 chromium 场景 + 单测承担，**没有**把未验写成已验。套件侧顺手补了一条能
      指出下一步的错误信息（右键目标出视口时明确报「节点 @x,y 超出窗口 W×H，请先把它带进视口」），
      避免下一位作者再撞 KimiCU 那句看不出成因的
      `screenshot coordinate is outside the last get_app_state image`。

## 8. r1 复审处置（2026-09-27，worker-tree-menu）

评审文件 `.tower/comms/reviews/review-feat-implement-file-tree-context-menu-m234-reviewer-tree-menu-r1.md`
（verdict `p2-3items` / fix-then-merge，reviewed commit `47c3ffa`）。三条 P2 + 两项流程项逐条处置：

| 条目 | 处置 | 落点与证据 |
|---|---|---|
| P2-1 注释指向不存在的测试文件 | 改注释里的文件名为 `tests/unit/tree-paths.test.ts` 并写出那一条用例名 | `src/tree.ts` 的 `IGNORED_NAMES` doc 注释 |
| P2-2 `resolve_new_in_vault` 注释言过其实（rename 会原子替换目标） | ① `rename_entry` **写路径加显式复查**：`rename` 前 `symlink_metadata` 命中即返回与 create 路径同一个 `fs_already_exists`，不允许静默覆盖（窗口收窄到两次系统调用之间）；② doc 注释改准——create 两条路径的保证来自 `create_new(true)` / `create_dir`（无窗口），rename 是「复查 + 极窄窗口」不是原子保证，零窗口需要平台原子排他改名，本批不引；③ 补单测 `rename_refuses_existing_target_on_write_path`（撞名目标为**文件**与**目录**两种形态都不覆盖、源与目标逐字节不变、错误码与 message 点名撞的条目） | `src-tauri/src/fs_io.rs` 的 `resolve_new_in_vault` / `rename_entry` 注释与测试模块。**该单测钉不到窗口本身**（无法在两次系统调用之间插入外部进程），这点写在测试注释里 |
| P2-3 仅大小写改名在大小写不敏感 FS 不可达且提示误导 | 按 tower 裁决**不做两步改名**，登记为已知限制（含影响、fail-safe 方向、为什么不修、将来要修时的落点） | `design.md` §7.1（新增「已知限制」节）+ `docs/backlog.md`「记录在案」两条（另一条是 P2-2 的窗口取舍，§7.2） |
| 流程项① README 补登记 | 补三行 + 一行占位符：`clipboardRead` 动作、`clipboard` 断言形态（读不到一律 FAIL）、`click` 的 `button`（非左键走 bbox 中心真实鼠标事件 + 目标须在可视区内）、`$vault` 占位符 | `scripts/acceptance/README.md` 的动作表 / 断言表 / 占位符段 |
| 流程项② 真机证据镜像 | 场景目录 `cp -R` 到主 checkout `test-results/acceptance/2026-09-26/47-file-tree-context-menu/`（git 外、不入 git），并把该现象写进同目录索引：`summary.md` 补 47 行 + 两轮来源与混合证据的备注、`results.json` 补条目、`run.log` 追加两轮结果行 | 主 checkout `/Users/boxcounter/Code/Boxcounter/lumir/test-results/acceptance/2026-09-26/`（证据区；`shots/`、`ax/` 是两轮同名截图互相覆盖后的混合体，`steps.md` 与表内读数是最后一轮） |

处置后门禁（`cargo test` 与 fmt/clippy 都在 `gate.sh quick` 内）：`GATE RESULT: 10/10 PASS（SKIP 0）`——
`cargo-test` 的 lib 用例 **160 passed**（上一轮 159 + 本轮新增的 `rename_refuses_existing_target_on_write_path`）、
`unit-tests` **368 passed**（前端单测本轮无新增，上一轮已计入）、`bindings-drift` / `tsc-root` / `tsc-visual` /
`tsc-unit` / `docs-check` / `openspec-validate` 全 PASS；另跑
`npx --yes @fission-ai/openspec@1.12.0 validate file-tree-context-menu --strict` → `Change 'file-tree-context-menu' is valid`。
