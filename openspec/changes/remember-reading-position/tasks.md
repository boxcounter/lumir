# Tasks: remember-reading-position

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，不是「跑过了」的口头声明（[REVIEW.md](../../../REVIEW.md) 第 7 条）。

**本文件是提案阶段的实现计划，全部未勾选**（本 mission 只产出提案，不写产品代码；实现待 Alex 节点 1 裁决后另立 mission）。

**条件项**（裁决落在备选上时，实现前先按裁决改写本文件与 delta，不静默按推荐项做）：

- 裁决点 1（记什么）取备选①（滚动 + 光标）→ 追加「光标位置的存储与恢复」一组任务，并单列一条「光标恢复与滚动恢复的先后与争抢」的实测（浏览器会把光标滚进视区）。
- 裁决点 2（适用面）取备选①（只记 md）→ 2.x / 3.x / 4.x 的作用面收窄到 md 会话；5.x 的「md 与 code 各自往返」改为「code 模式不恢复」的反向断言。
- 裁决点 3（条目保留与失效策略）取任一备选 → 5.1 的上限取值、5.2 的清理时机按裁决改写，并保留「清理挂在既有枚举上、不新增 IO」这条约束。
- 裁决点 4（与 #10 的关系）取备选①（塞进标签文件）→ 3.1 的落点改为扩 `vault-session`，并追加一次「标签列表写入与滚动写入互不丢数据」的并发写实测（写放大与覆盖风险）。

## 1. 现状读数与反向验证（先测再改）

- [ ] 1.1 取一次**现状读数**：在一个 vault 里打开一份超过一屏的 md 文档、滚到中部、关闭标签、重新打开同一文件，记录每次的 `scrollDOM.scrollTop` 与顶部可见行；再记录配置目录下的既有文件清单（`config.json` / `workspaces/` / `vault-sessions/` / `logs/`）。
  **验收口径**：读数落 `test-results/<mission>/reading-position-before/readings.json`（可 `ls`）；判据是「重新打开后 `scrollTop` 为 0、顶部可见行为首行」，且配置目录里**没有**任何位置类文件。
- [ ] 1.2 反向验证（先红，[REVIEW.md](../../../REVIEW.md) 第 1 条）：先把三条断言写出来——①「关标签再打开同一文件后顶部可见行与离开时相同」②「已打开的标签再次打开后视口不动」③「打开一份位置为篇首的文档后 `scrollTop` 为 0 且页首内边距可见」——在**未实现前**跑一次，三条都必须 FAIL。
  **验收口径**：红灯日志落 `test-results/<mission>/red-before-implementation.log`；红灯必须落在判据本身（位置/几何），不是「文件不存在」这类退化判据。
- [ ] 1.3 取一次**性能与写入基线**：键入路径的 A/B 口径（`scripts/perf/keypress-to-paint.mjs`）与「一次装载路径上的新增读数次数」的现状（现在的装载路径上没有任何位置相关读数）。
  **验收口径**：读数落 `test-results/<mission>/perf-keypress-before.json`；1MB 打开端点若仍是占位口径（只量读盘 + 解码），**如实标注未测得有效对照**，不当作达标证据。
- [ ] 1.4 **往返精度的可行性探针**（design §7 第 1、2 条）：在 chromium 里对一份长文档做一次「捕获 → 复位到篇首 → 按公开 API 恢复」的往返，读两次 `scrollTop` 与 `view.documentTop` 的坐标语义（相对编辑器还是相对窗口）。
  **验收口径**：读数落 `test-results/<mission>/roundtrip-probe.json`；结论写回 design §7（「已实测」或「实测不成立、改用兜底口径」），MUST NOT 把未跑的探针留成「已验」。

## 2. 后端：阅读位置存储（Rust）

- [ ] 2.1 新增与 `vault_session` 同族的模块 `src-tauri/src/reading_position.rs`：类型（`version` + `entries`：路径 → `{pos, y, x, at}`，TS 类型经 ts-rs 导出）、目录（`config_dir()/reading-positions`）、`load_from` / `save_to`（目录可注入，测试不碰真实配置目录）、`sanitize`（写入与读取共用同一份键校验：绝对路径 / 含 `..` / 带根前缀一律丢弃）、上限淘汰（按 `at` 最旧者）。
  **验收口径**：模块头写清「为什么与标签列表分开存」（照 `src-tauri/src/vault_session.rs:1-14` 的写法）；`cargo test` 的单测覆盖：版本不符 / 坏 JSON / 越界键 / 超限淘汰 / 缺失文件返回无历史。
- [ ] 2.2 注册一对 command（读 / 写）并在 `src-tauri/src/lib.rs:66` 的 `generate_handler!` 里登记；写失败返回 `Ok(())` 且只记 warning（与 `vault_session_put` 同口径，`src-tauri/src/vault_session.rs:129-150`）；`vault_id` 非法才返回错误信封（文件名 = 路径逃逸防护）。
  **验收口径**：`cargo test` 通过；ts-rs 导出的 TS 类型出现在 `src/bindings/`（`ls src/bindings/ | grep -i reading`）。
- [ ] 2.3 读写纪律与既有存储逐条对齐：tmp + rename 原子替换；读取侧对损坏 / 版本不符一律按「无历史」并记 warning，不抛错、不阻断打开。
  **验收口径**：单测断言「写入后目录里没有残留 `.tmp` 文件」「损坏文件读到 None 且不 panic」；与 `src-tauri/src/vault_session.rs:110-120` 的实现逐条对照写进实现说明。

## 3. 前端：捕获与写入

- [ ] 3.1 新增与 `createVaultSessionStore` 同族的 store（无 DOM、可脱离浏览器单测）：换键（装载 vault 时登记 vault id）、内存镜像、防抖写入、`flush`、按本次枚举清理、内容未变不排期。
  **验收口径**：store 的单测覆盖「换键丢弃上一个 vault 的待写内容」「内容未变不排期」「flush 在没有待写内容时也写一份当前快照」（照 `src/vault-switcher.ts:394-493` 的口径）。
- [ ] 3.2 装载 vault 时读一次位置文件并建内存镜像，同时按本次枚举到的条目剔除不在 vault 内的键（挂点：`src/main.ts` 的 `applyVault` / `switcher.onVaultLoaded` 一带，`src/main.ts:709-745`）。
  **验收口径**：视觉场景或单测断言「越界键与已移除路径的键在图里不出现，也不进入下一次落盘内容」。
- [ ] 3.3 捕获：监听 `view.scrollDOM` 的滚动信号（或 CM 的 `viewportChanged`，二者取一，理由写进实现注释），产出 design §2.3 的三个量；滚动停止后防抖落盘（新常量，量级取 `SESSION_WRITE_DEBOUNCE_MS`）。
  **验收口径**：桩的 `reading_position_put` 调用记录（仿 `tests/visual/scenes/tauri-stub.ts:117-160` 的 `__sessionPuts` 做法）显示「连续滚动只产生一次写入」。
- [ ] 3.4 强制 flush 与标签会话同一批：切文件 / 切标签（`syncActiveDocument`，`src/main.ts:286-302`）、切 vault 前、`beforeunload`（`src/main.ts:379-388`）。
  **验收口径**：断言「滚动后立刻切标签 → 落盘内容含切换前的位置」；`beforeunload` 那条按既有口径如实标注为「尽力而为」（异步 invoke 可能赶不上界面拆除，`src/main.ts:380-382`）。
- [ ] 3.5 值形态的构造点收敛到一个函数（唯一构造点，照 `sessionSnapshot` 的写法），并断言「捕获与恢复用同一口径」——这一条是本 change 最容易写错的地方（design §2.3）。
  **验收口径**：单测断言「给定一个位置元组，捕获口径与恢复口径互为逆」（不依赖 DOM 的纯函数部分）；实现注释写明 δ 为什么抵消。

## 4. 前端：恢复

- [ ] 4.1 在**装载之后**施加恢复（`reloadSession` 之后、`afterLoad` 一带）：位置命中时按 design §2.3 的公开 API 施加；未命中时不动；**篇首位置不施加**（design §5）。
  **验收口径**：1.2 的三条红灯在此转为绿；断言必须是几何/滚动读数，不是「函数被调用过」。
- [ ] 4.2 已打开的文档不恢复：恢复的挂点 MUST NOT 落在 `openFile` 的短路分支之前（`src/main.ts:344-350`）。
  **验收口径**：反向验证——把恢复临时挂到短路分支之前，「已打开的标签不被拽走」必须 FAIL（design §8 第 2 行）。
- [ ] 4.3 恢复后无人再写 `scrollTop`：装载路径结束后**再读一次** `scrollTop`，与刚施加时的读数逐像素相同。
  **验收口径**：反向验证——在装载路径尾部临时补一次 `scrollTop = 0`，该断言必须 FAIL。
- [ ] 4.4 恢复失败一律静默退化到篇首：存储不可读 / 位置越界 / `coordsAtPos` 不可读（兜底口径按 design §2.3 二选一，选定的那条写进 spec 的已知边界与实现注释）。
  **验收口径**：断言「存储损坏时打开文档在篇首且界面无任何提示」。

## 5. 失效、容量与降级

- [ ] 5.1 上限淘汰：每 vault ≤ 200 条，超出按 `at` 最旧者淘汰。
  **验收口径**：单测写入 201 条不同路径 → 落盘内容 200 条且最旧的那条不在（design §8 第 7 行）。
- [ ] 5.2 清理时机：装载 vault 后按本次枚举剔除不在 vault 内的键；打不开的键只跳过不删。
  **验收口径**：单测 + 视觉场景各一条；断言「被剔除的键不出现在下一次落盘内容里」。
- [ ] 5.3 降级：读不到 / 版本不符 / 损坏 / 写失败四种情况的行为分别是「无历史且无提示」「无历史且无提示」「无历史且无提示」「记 warning 且不拦停」。
  **验收口径**：单测逐条断言；桩侧各给一个 fixture（照 `tauri-stub.ts` 的会话损坏口径）。
- [ ] 5.4 铁律核对：位置 MUST NOT 进文档、MUST NOT 在 vault 目录里造文件。
  **验收口径**：断言「打开 → 滚动 → 关闭后，vault 目录的文件清单与 mtime 不变、文档字节逐字节相同」（ADR 0003 §3）。

## 6. 单测（`tests/unit`，纯逻辑层）

- [ ] 6.1 把可纯化的部分抽出来加断言：值形态的往返分解、键校验、上限淘汰、按枚举清理、内容未变不写。
  **验收口径**：`node tests/unit/run.mjs` 全绿，用例数与基线（以最近一次全绿输出为准）对得上。
- [ ] 6.2 不把 DOM / 布局行为塞进这一层（`tests/unit/README.md` 的分工：DOM 与布局归 visual）。
  **验收口径**：`git diff tests/unit/harness.ts` 为空（或改动仅在替身层、且说明理由）。

## 7. 视觉场景（chromium，CI 门禁）

- [ ] 7.1 扩展桩：`tests/visual/scenes/tauri-stub.ts` 增加该 command 的路由、初值（模拟「上次已经存了一条位置」）与调用记录（仿 `__sessionPuts`，`:117-160`）。
  **验收口径**：桩的初值能让场景在**不真实重启**的前提下模拟「盘上已有位置」；调用记录可被场景读出。
- [ ] 7.2 新增场景 `tests/visual/scenes/reading-position.spec.ts` + 一份超过一屏的 fixture：①桩给初值 → 打开该文件后顶部可见行 = 记录的位置、`scrollTop` ≠ 0；②滚动后等防抖 → 调用记录里的载荷与当前位置一致；③没有初值时在篇首；④已打开的标签再次打开后视口不动；⑤篇首位置不出现顶部留白被顶出画。
  **验收口径**：1.2 的红灯在此转绿；判据全是几何与滚动读数，没有「函数被调用过」型断言。
- [ ] 7.3 code 模式的往返：把同一份内容以非 md 打开（或另配一份 fixture）→ 恢复同样生效；折行关闭时的横向位置一并还原。
  **验收口径**：场景里两条断言（纵向 + 横向）；若裁决点 2 取「只记 md」，本任务改为反向断言（code 模式不恢复）。
- [ ] 7.4 基线核对（[REVIEW.md](../../../REVIEW.md) 第 3 条 + AGENTS.md「基线更新是人肉裁决点」）：逐张核对现有 13 个像素基线场景是否因「打开后视口不同」而变化——**用内容判据逐张核**（这些场景的 fixture 是否短于视口、是否落在篇首），不能只看时间戳；确有整页变化的先请 Alex 过目再重拍。
  **验收口径**：核对结果落 `test-results/<mission>/baseline-check.md`（逐张 + 判据 + 结论），`bash scripts/gate.sh visual`（本地、含像素层）全绿。

## 8. 真机验收场景（WKWebView，`scripts/acceptance/`）

- [ ] 8.1 **新增场景** `scripts/acceptance/scenarios/28-remember-reading-position.md`（编号按现有最大 27 续；`item` 字段取 28）+ fixture 一份超过一屏的 md（落 `scripts/acceptance/fixtures/`）。步骤：打开长文 → 翻页到尾部 → 记下当前渲染行 → 重启 app（场景的 `restart`）→ 手工点开同一文件 → 断言尾部那两行在 AX 渲染行里、篇首那两行**不在**。
  **验收口径**：`node scripts/acceptance/run.mjs --check` 通过；真机运行 PASS，证据落 `test-results/acceptance/<日期>/28-remember-reading-position/`。
  **断言形态**：MUST NOT 只断言「AX 里有某段文字」——负向断言（篇首两行不在渲染行里）MUST 与同一位置的正观测（尾部两行在场）配对，并优先用带 bbox 的节点几何（M178 finding 的口径与实测，`docs/backlog.md:339-350`）。
- [ ] 8.2 真机反向验证：把恢复整段关掉（或回退到实现前代码）重跑同一场景 → 必须 FAIL。
  **验收口径**：FAIL 的 `status.txt` / `steps.md` 留档；短缺只用于反向验证，随后立即还原并重新构建。
- [ ] 8.3 不改写源文件的真机判据：磁盘文件哈希在整轮场景前后**不变**（`file.unchangedSince`），且 vault 目录内无新增文件。
  **验收口径**：场景里两条断言在位且 PASS（ADR 0003 §3）。

## 9. 验证与收官

- [ ] 9.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
  **验收口径**：`GATE PASS openspec-validate`（`scripts/gate.sh quick` 的一步）。
- [ ] 9.2 `bash scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=<空闲端口> bash scripts/gate.sh visual` 全绿；`bash scripts/docs-check.sh` PASS。
  **验收口径**：日志落 `test-results/<mission>/gate-visual.log`，逐行 `GATE PASS`，退出码 0。
- [ ] 9.3 真机套件至少跑一次新增场景并留档（AGENTS.md：dogfood 批次合并后、Alex 验收前先跑一遍）。
  **验收口径**：`test-results/acceptance/<日期>/` 有本次 PASS 的 `summary.md` 与场景证据目录。
- [ ] 9.4 `git diff --check` 通过；改动文件集合与本 change 的 Impact 清单一致（出现跨 scope 的只读依赖须先报 tower 批准）。
  **验收口径**：`git diff --stat` 的清单与 proposal 的 Impact 逐条对齐；确认 `git diff` 里**没有**对 `vault-sessions` 读写路径、CM 滚动快照通道、`src/style.css` 的改动。
- [ ] 9.5 收官对账：tasks 全部勾选（或标注放弃原因）、spec 增量与实现一致（逐 requirement 对一眼实现与断言）；`docs/backlog.md` 第 10 项的边界段补一句「滚动位置已由 `remember-reading-position` 承接」；living spec 归档另走节点 2。
  **验收口径**：对账表落 tasks 末尾（逐 requirement → 实现落点 → 断言落点）；backlog 的那一句可 `grep`。

## 10. 已声明的边界 / 不做

- [ ] 10.1 不做光标 / 选区 / 撤销史的跨会话恢复；不做未保存内容的跨会话恢复；不做阅读进度读数（百分比 / 进度条 / 剩余行数）；不做最近阅读列表与跨 vault 的全局位置。
  **验收口径**：`grep` 实现与 spec 均无对应的类型 / 字段 / 文案；`git diff` 里没有新增 UI 元素。
- [ ] 10.2 不重开 backlog #10：不扩 `vault-sessions/<id>.json` 的内容、不做标签会话恢复的其余面；不修 M186 遗留的四条焦点路径（`docs/backlog.md:244-254`）。
  **验收口径**：`git diff src/vault-switcher.ts` 只含位置通道的接线，`vault_session.rs` 零改动（或改动只在共享校验函数的可见性上，且说明理由）。
- [ ] 10.3 不新增键位 / 命令 / 可见 UI / 配置项；不改既有渲染口径。
  **验收口径**：`git diff src/keys.ts` 为空；`git diff src-tauri/src/config.rs` 为空（配置项零新增）；`git diff src/preview/` 为空（渲染口径零改动）。
- [ ] 10.4 已知边界如实记录：外部改写 / 改名 / 移动后位置不保证贴切（不做内容比对，design §7 第 7、8 条）；含图文档的落点偏差 MUST 实测后如实落笔；往返精度的容差与实测读数写进实现说明，不宣称未测的达标。
  **验收口径**：design §7 的未验证项逐条有「已实测（读数路径）」或「未实测（如实标注）」的结论。
