# Tasks: file-tree-context-menu

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，
不是「跑过了」的口头声明（[REVIEW.md](../../../../REVIEW.md) 第 7 条）。

**提案阶段状态（M234，2026-09-26）**：本 change 只到节点 1，以下任务**全部未开工**——`[ ]` 是
提案阶段的默认状态。实现批次接手时按第 1 节起手，并把每条任务勾选时的证据指针补进本文件。

**裁决状态（2026-09-26）**：裁决点 2（删除 = 废纸篓 + 确认）、3（重命名 = 树内联）、4（复制 =
绝对路径）Alex 已预裁决，对应任务按此写定；裁决点 1（菜单形态，推荐 web 自绘）与 5（tab 联动，
推荐 remap + 抑制）待节点 1 拍板——若裁决改项，[design.md](design.md) §2 与 §3.2 按新口径改写
后再进实现。

**真机场景取号对账（2026-09-26）**：`scripts/acceptance/scenarios/` 仓内序列到 36；inbox registry
到 43（M230）；44–46 按 tower 简报为在途已占。**本 change 取 47（`47-file-tree-context-menu`），
无撞号、未顺延**，已对全员广播（`.tower/comms/inbox/20260926-worker-proposal-tree-menu-all-
acceptance-scenario-numbering-m234-47.md`）。

## 1. 现状读数与反向验证（实现前，先测再改）

- [ ] 1.1 现状读数：右键文件树条目，记录 ① 无任何应用内菜单出现（系统菜单被拦或空白）、
      ② 当前打开文件与 tab 列表不变。
      **验收口径**：读数落 `test-results/acceptance/<日期>/47-file-tree-context-menu/readings-before.json`
      （可 `ls`），与「全仓无 contextmenu 接线」的代码事实一致。
- [ ] 1.2 反向验证（先红）：把「右键 → 菜单浮层可见且含 6 项」断言在未实现前跑一次，必须 FAIL。
      红灯输出留档（[REVIEW.md](../../../../REVIEW.md) 第 1 条防线）。
- [ ] 1.3 剪贴板反向用例：清空剪贴板后断言「复制完整路径」读到期望值——未实现时必须 FAIL
      （读到旧值/空），确认断言有区分度（[REVIEW.md](../../../../REVIEW.md) 第 1 条）。

## 2. 后端：文件级命令（fs_io + commands）

- [ ] 2.1 `resolve_new_in_vault`：父目录走 `resolve_in_vault`，末段名校验（非空 / 无 `/` /
      非 `.`/`..` / 不命中 `IGNORED_NAMES`），存在性探测 → `fs_already_exists`。
      **验收口径**：Rust 单测覆盖逃逸、忽略集名、撞名、正常路径；`cargo test` 日志落
      `test-results/`。
- [ ] 2.2 `fs_trash_entry`（trash crate）/ `fs_rename_entry` / `fs_create_file` /
      `fs_create_dir` / `fs_reveal_in_finder` 五条 command，错误码按 [design.md](design.md)
      §3.7 表。
      **验收口径**：每条至少「正常 + 两类错误」单测；`Cargo.toml` 的 `trash` 条目附「为什么引、
      为什么不用替代」注释（既有依赖注释格式）。
- [ ] 2.3 capabilities 零增量核对：`default.json` 不变；opener 的 webview ACL 仍为默认拒绝
      （grep 确认无 `opener:*` 权限新增）。
- [ ] 2.4 ts-rs bindings 导出核对：新命令涉及的 payload 类型（如有）进 `src/bindings/`，
      由 cargo test 顺带导出（既有纪律）。

## 3. 前端：菜单浮层与内联编辑

- [ ] 3.1 `src/tree-menu.ts` 浮层模块 + `src/tree.ts` 的 `contextmenu` 接线；项集按条目类型
      分流（design §2.2）；键位 ↑↓/⌃N⌃P/Enter/Esc/外部点击关闭；右键不改上下文。
      **验收口径**：单元测试或 chromium 断言覆盖项集、键位、关闭路径；「右键不改上下文」有
      专项断言。
- [ ] 3.2 内联编辑（重命名 + 新建共用）：Enter 提交 / Esc 与失焦取消 / 行内校验标红；编辑期
      行交互抑制。
      **验收口径**：校验矩阵（空 / 含 `/` / `.`/`..` / 忽略集名 / 撞名）逐项有红→绿记录。
- [ ] 3.3 复制完整路径：绝对路径拼接一处实现；成功/失败 toast；`navigator.clipboard` 不可用时
      按 design §5.2 的既定退路落后端命令（行为契约不变）。
- [ ] 3.4 确认对话框（删除）：文件与目录两种文案，目录明示「连同其中全部内容」；焦点管理与
      归还同 bindings-panel 先例。

## 4. tab 联动（裁决点 5 落地）

- [ ] 4.1 rename remap：文件 = 单 session 路径替换；目录 = 前缀 remap；dirty / revision / 滚动 /
      光标保留。
- [ ] 4.2 watcher 回响一次性抑制（old→new 对，消费即清 + 1s 超时），抑制期间不误报「已被外部
      删除」；外部改名无抑制条目、走现状处置。
      **验收口径**：真机改名打开中的 dirty 文件 20 次零误报（design §5.3），读数落盘。
- [ ] 4.3 删除命中打开 tab：走 `handleExternalChange` 现状分支，不特判；专项断言「sticky 提示
      出现且内容未丢」。

## 5. 门禁与文档

- [ ] 5.1 文案登记 `文案-Copy.md`（D120 起）：菜单项、确认对话框、错误/成功提示，逐条编号
      并在文末索引节补落点说明。
- [ ] 5.2 `bash scripts/gate.sh quick` 全绿；视觉门禁：菜单与内联输入是新增 UI 元素，新增元素级
      视觉基线（整页基线不动；改动面核对 `tests/visual/README.md` 的卫生纪律——本 change 不删除
      既有 UI 元素，无需核对存量基线时间戳）。
- [ ] 5.3 `npx --yes @fission-ai/openspec@1.12.0 validate file-tree-context-menu --strict` 通过。

## 6. 真机验收场景 47

- [ ] 6.1 新增 `scripts/acceptance/scenarios/47-file-tree-context-menu.md`，覆盖：右键出菜单
      （文件/目录项集分流）、删除进废纸篓（vault 内消失 + 命令 Ok；废纸篓目录断言按 design §6
      的隔离口径）、内联重命名（含撞名拒绝）、复制完整路径（`osascript -e 'the clipboard'`
      断言绝对路径）、在 Finder 中显示（命令 Ok 弱断言 + 无文件系统变更）、目录下新建文件并
      自动打开、新建子目录、tab 联动（改名 dirty 文件不误报、删除打开文件走现状处置）。
- [ ] 6.2 场景正文写明各断言的反向用例与证据落点；`node scripts/acceptance/run.mjs --check 47`
      静态校验通过。
- [ ] 6.3 若右键菜单在真机注入通道不可达（M184 dblclick 前科），按 M184 既定口径转 chromium
      断言 + Alex 手感清单，场景条目如实标注「未验」，不冒称（[REVIEW.md](../../../../REVIEW.md)
      第 6 条）。
