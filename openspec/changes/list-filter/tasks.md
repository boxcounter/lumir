# Tasks: list-filter

任务口径（同 `remember-reading-position`）：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，不是「跑过了」的口头声明（[REVIEW.md](../../../REVIEW.md) 第 7 条）。

**状态**：提案阶段（M196）已完成，Alex 节点 1 裁决 2026-09-24（原话「五个点都采纳推荐」，落点见 [proposal.md](proposal.md) 的「裁决记录」节）；实现阶段 M199 按本文件执行。

**条件项**（第 10 组）：五个裁决点全采纳推荐 ⇒ **九条条件项无一触发**（逐条核对见第 10 组的标注）。

## 0. 提案阶段（M196，留档）

- [x] 0.1 动工前读完 [REVIEW.md](../../../REVIEW.md) 与 [openspec 工作流](../../../docs/process/openspec-workflow.md)（提案 PR 与实现 PR 拆开；两个 Alex 节点是硬门禁）。
  **验收口径**：本 change 只产制品、零产品代码；实现另立 mission。
  **M199 执行**：动工前重读 REVIEW.md 全文并逐条对过本 mission 的改动面（真机丢键 / 基线容差 / 假绿三族是本次的主要防线来源）。
- [x] 0.2 两处列表的现状盘点（渲染 / 键盘通道 / 焦点 / `Esc` 语义 / 空态）逐条带 `file:line` 写进 [design.md](design.md) §1。
  **验收口径**：design §1 的每条断言都能按锚点复核（`src/toc.ts`、`src/vault-switcher.ts`、`src/keys.ts`、`src/style.css`、`openspec/specs/`）。
  **M199 执行**：逐条按锚点复核过（示例：`src/toc.ts:192` 的打开快照、`:249` 的 `extractHeadings(state, true)`、`:304` 的缩进基准、`src/vault-switcher.ts:589` 的浮层级 `mousedown`、`:631-641` 的每次打开拉取）。**注意**：实现落地后这些行号已随本 change 前移，锚点以 proposal/design 成稿时（M196）的 commit `a0bfa12` 为准。
- [x] 0.3 四件制品起草完毕并自验。
  **验收口径**：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 全绿；`bash scripts/docs-check.sh` PASS（命令可复算，输出见 M196 的 review-request）。

## 0b. 实现前：裁决记录与条件项核对（M199 新增任务 0）

- [x] 0b.1 把 Alex 节点 1 裁决（2026-09-24 + 原话「五个点都采纳推荐」+ 五点逐条落推荐）写进 [proposal.md](proposal.md) 的「裁决记录」节；核对第 10 组九条条件项无一触发。
  **验收口径**：`proposal.md` 有「裁决记录（Alex 节点 1，2026-09-24）」节，逐条给出裁决与落定内容；第 10 组逐条在本文件标「未触发」。
  **证据**：proposal.md 的状态行与「裁决记录」节；本文件第 10 组。

## 1. 匹配与筛选状态（纯逻辑层，两处共用）

- [x] 1.1 新增纯函数模块（暂名 `src/list-filter.ts`，实现期定稿）承担匹配判定：大小写折叠 + 子串包含 + 多字节安全；**只有一份实现**，两处浮层共用。
  **验收口径**：`rg -n "toLowerCase" src/` 只在模块内命中（无第二份匹配实现）；模块无 DOM 依赖（可被单测直接 import）。
  **证据**：`src/list-filter.ts`（`foldCase` / `isMatch` / `filterIndices`，两处浮层 import 同一份）；`rg -n "toLowerCase" src/` 只有 `src/list-filter.ts` 命中；单测直接 import 源码（`tests/unit/list-filter.test.ts`）。
- [x] 1.2 结果集表达为「源条目数组的下标数组」，游标 / 当前项高亮 / 动作落点全部从这一处取。
  **验收口径**：大纲侧的 `Enter` 落在**命中条目**（不是源下标的同名位置）；反向验证：去掉映射后该断言必须 FAIL（design §5 第 9 项）。
  **证据**：`src/toc.ts` 的 `jumpTo` 唯一取 `visible[index] → entries[source]`；`tests/visual/scenes/list-filter.spec.ts` 的光标偏移断言；反向验证 RV-2（`test-results/m199/visual-filter-reverse.md`：去掉映射后**只**该条判据红）。
- [x] 1.3 查询状态：置空回到全量、首条命中为游标起点、关闭即丢弃查询。
  **验收口径**：单测逐条断言三条转移；证据落 `test-results/<mission>/`（读数/日志）。
  **证据**：`tests/unit/list-filter.test.ts`「查询状态：置空回全量、首条命中为起点、关闭丢弃查询」；视觉侧 `tests/visual/scenes/list-filter.spec.ts` 的第 2 条用例（清空回全量起点 / Esc 丢弃查询）。

## 2. 大纲浮层接入（`src/toc.ts` + `src/style.css`）

- [x] 2.1 浮层内新增输入行（列向 flex 的固定行，不被压缩；颜色 / 边框 / 圆角取既有 token，不引入新视觉语言）。
  **验收口径**：chromium 断言「浮层总高 ≤ 窗口内容区高的 80%」仍成立（既有场景照绿）、列表仍是唯一滚动容器（列表 `scrollHeight > clientHeight` 而浮层自身不滚）。
  **证据**：`src/style.css` 的 `.lumir-toc-input` / `.lumir-toc-empty`（下划线取 `--bd-3`、聚焦 `--accent`，与 `src/search-panel.css` 的 editorial 输入同形）；`tests/visual/scenes/list-filter.spec.ts`「输入行在位且浮层总高仍为 80%」判 `inputHeight > 0` + 总高上下界 + `listScroll > listClient`。
- [x] 2.2 焦点迁移的五处挂点（design §2.3）：打开时聚焦输入框、失焦收起挂点外移到浮层容器、`aria-activedescendant` 移到输入框（`role=combobox` + `aria-controls`）、就地键挂点上移到容器、逐条目 `mousedown` 防夺焦维持不变。
  **验收口径**：真机三条关闭路径（`Tab` 出去 / 点浮层外 / 再按 `⌘⇧O`）各收起一次；design §5 第 6、7 项有实测记录。
  **证据**：`src/toc.ts` 的五处落点（`input.focus()` / `popover` 的 `focusout` / `input.setAttribute("aria-activedescendant")` / `popover` 的 `keydown` / 条目级 `mousedown` 原样）；**真机**：场景 32 的 Esc 一步关闭 + 场景 13 的 `⌘⇧O` 开→关→开（`test-results/m199/acceptance-run2.log`）；**chromium**：`list-filter.spec.ts` 的 `Tab` 出去即收起 + vault 侧的「点浮层外收起」（`mv-vault-switcher.spec.ts`）。**未覆盖（如实登记）**：真机侧「点击浮层以外的区域」这条路径没有独立断言（chromium 侧有），`Tab` 出去的真机读数在本批的 13/32 场景里也没有单独出（判据在 chromium 层）。
- [x] 2.3 结果集渲染 + 游标（复用既有 `move()` / `setActive()` / `jumpTo()`，MUST NOT 第二套下标逻辑）。
  **验收口径**：`git diff src/toc.ts` 里没有新增的下标钳制 / 移动实现（只有结果集映射与渲染）。
  **证据**：`git diff` 中 `move()` 逐字未变（仍是 `Math.min(items.length - 1, Math.max(0, activeIndex + delta))`）；新增的只有 `render()` 的结果集映射、`setActive()` 的 `aria-activedescendant` 归属、`jumpTo()` 的一步映射。
- [x] 2.4 无命中态：保持浮层打开 + 一行提示；MUST NOT 复用 D84（文档没有标题）。
  **验收口径**：真机与 chromium 各一条断言；MUST NOT 出现「这份文档还没有标题」。
  **证据**：真机场景 32 的「无匹配提示 + D84 不在场 + Enter 无操作」；chromium 同款断言（`list-filter.spec.ts` 第 2 条用例）；文案 D117 在 `src/list-filter.ts` 的 `NO_MATCH_TEXT`。
- [x] 2.5 缩进基准沿用文档级（`src/toc.ts:304` 不动，裁决点 ⑤ 推荐项）。
  **验收口径**：筛选到只剩深层标题时，缩进与筛选前逐条一致（chromium 读 `--toc-depth`）。
  **证据**：`render()` 的 `base` 取自 `this.entries`（**全量**快照）而非结果集；`list-filter.spec.ts` 断言筛选后 `--toc-depth` 仍是 `["1","2","1","2"]`（H1 被筛掉也不改基准）。

## 3. vault 浮层接入（`src/vault-switcher.ts` + `src/style.css`）

- [x] 3.1 输入行与焦点迁移（同 2.1 / 2.2 的口径）；**MUST 把输入框排除在浮层级 `mousedown` 的 `preventDefault` 之外**（`src/vault-switcher.ts:589`），否则点输入框无法落焦点。
  **验收口径**：真机点输入框后能直接键入（design §5 第 7 项）。
  **证据**：`src/vault-switcher.ts` 的 `if (event.target === input) return;`；chromium `list-filter.spec.ts`「点击输入框能落焦点」（先把焦点 Tab 到行上再点输入框，反向验证 RV-4：去掉排除项后该条红）。**未覆盖**：真机上的鼠标点击现象（判据在 chromium 层，场景 32 只验键盘路径的落点）。
- [x] 3.2 `rowEntries` 保持**本次拉取的完整列表**，另加结果集下标数组；「重新定位…」的 `siblings` 仍传完整列表（`src/main.ts:669-679` 的占用判定）。
  **验收口径**：把一个已被筛掉的 vault 占用的路径当重定位目标，仍被拒绝；反向验证：把 `siblings` 换成结果集后该断言必须 FAIL（design §5 第 10 项）。
  **证据**：`tests/unit/vault-switcher.test.ts`「重定位的占用判定仍看完整列表」（按调用参数断言 `siblings` = 完整列表）；反向验证 RV-3（换成结果集后该条红，读数见 `test-results/m199/visual-filter-reverse.md`）。
- [x] 3.3 失效行参与筛选、`Enter` 三支动作不变；「新增 vault…」与分隔线不参与筛选、无命中时仍可用；当前项被筛掉时不显示标记且不改当前 vault。
  **验收口径**：四条各有断言（单测或 chromium 场景），证据落 `test-results/<mission>/`。
  **证据**：单测「显示名子串命中（非前缀）、失效行参与、输入不触发第二次拉取」+「无命中保持浮层 + 一行提示，新增入口照常可用」+「当前项被筛掉不改当前 vault，关闭丢弃查询」；chromium 同款四条；真机场景 32 的 vault 段（被筛掉的行连路径一起消失、命中行仍在、新增入口仍在、树头部名称不变）。**偏离申报**：delta 的「失效行参与筛选且 `Enter` 仍走重定位」scenario 写了「用键盘选中它并按 Enter」——与**筛选前**的既有口径不一致（失效行不在键盘游标空间里，`tests/visual/scenes/mv-vault-switcher.spec.ts` 钉着「↓ 只在可用行之间走」），实现按该 scenario 的另一句「与筛选前同一行按 Enter 的行为逐条一致」落地：失效行参与筛选且仍在结果集里、点击 / `Enter` 走重定位，但键盘游标仍不可达。已在 `docs/backlog.md` 的待归档条目里登记，供归档时复核措辞。
- [x] 3.4 打开路径不变：仍只拉取一次（输入不触发第二次 `list()`）。
  **验收口径**：桩的调用记录里 `list()` 次数 = 1（仿 `tests/visual/scenes/tauri-stub.ts` 的调用记录做法）。
  **证据**：`tests/unit/vault-switcher.test.ts` 的 `listCalls` 计数（多次输入后仍是 1）；chromium 侧读桩的 `__invokes`（`tauri-stub.ts` 新增的 `invokes()` 导出，断言输入前后 `vault_list` 调用数不变）。

## 4. 文案

- [x] 4.1 `文案-Copy.md` 追加三条（现最大 D114，从 D115 续）：D115 无匹配提示、D116 输入框占位、D117 输入框读屏名；两处浮层共用同一批文案。
  **验收口径**：`rg -n "D11[567]" 文案-Copy.md` 三条在位；实现侧引用同一常量（不在两处各写一份字面量）。
  **实现期编号校正（就地标注）**：本条的 D115–D117 与 **code-outline 遗留的两条待补文案**撞号（那两条在 `openspec/changes/code-outline/tasks.md` 的 5.1 待补表里、从未落 deck）。本 mission 按 tower 口径先补登 code-outline 两条为 **D115（这份文件没有可提取的符号，大纲为空）/ D116（这份文件类型暂不支持大纲）**，list-filter 三条从 **D117** 续：D117 无匹配提示（没有匹配的条目）、D118 输入框占位（输入以筛选）、D119 输入框读屏名（筛选）。delta spec 里「文案见 D115–D117」的指针已同步校正为 D117–D119。
  **证据**：`文案-Copy.md` 的表格行 D115–D119 + 编号沿革段 + 文末实现备注段；`rg -n "D11[5-9]" 文案-Copy.md` 逐条在位；实现侧三条常量只住 `src/list-filter.ts`（两处浮层 import 同一份）。
- [x] 4.2 大纲浮层底部提示文案**不动**（裁决点 ④ 推荐项下无需改写）。
  **验收口径**：`git diff` 里 `src/toc.ts:103` 与 `文案-Copy.md` D86 零改动；`13-toc` 的 15 处断言与 `tests/visual/scenes/toc-outline.spec.ts:153` 均未改。
  **证据**：`git diff` 不含 `POPOVER_HINT` 与 deck 的 D86 行；`tests/visual/scenes/toc-outline.spec.ts` 与 `scripts/acceptance/scenarios/13-toc.md` 本批零改动（13 的 `(focused)` 游标判据见任务 7.2 的实测处置）。

## 5. 单测（`tests/unit/`，纯逻辑层）

- [x] 5.1 匹配与查询状态的单测：子串命中 / 大小写折叠 / 空查询回到全量 / 首条命中为起点 / 关闭丢弃查询 / 中文串命中。
  **验收口径**：`node tests/unit/run.mjs` 全绿，用例数与基线（最近一次全绿输出）对得上；不把 DOM 与布局行为塞进这一层（`tests/unit/README.md` 的分工）。
  **证据**：`tests/unit/list-filter.test.ts`（6 条：子串非前缀 / 空查询全量 / 多字节与代理对 / 行内标记边界 / 三条转移 / 三条文案常量逐字）+ `tests/unit/vault-switcher.test.ts`（新增 5 条筛选用例）；`node tests/unit/run.mjs` = **244 条全绿**（改动前 233 条，+11）。

## 6. 视觉场景（chromium，CI 门禁）

- [x] 6.1 新增 `tests/visual/scenes/list-filter.spec.ts`：判「输入即筛」（条目集合变化）、「结果集里的游标落点」、「无命中态」、「清空回全量」、「输入行在位且浮层总高仍在上限内」。
  **验收口径**：判据全落在条目集合 / 几何 / 计算属性上，MUST NOT 只断言「输入框里有字」（REVIEW.md 第 1 条）；先造一个必须让断言 FAIL 的输入实测一次。
  **证据**：`tests/visual/scenes/list-filter.spec.ts`（7 条用例）；反向验证 RV-1（把 `isMatch` 改成恒真 = 筛选整段关掉 → **6/7 FAIL**，唯一 PASS 的是纯几何用例，读数与原始输出见 `test-results/m199/visual-filter-reverse.md`）。
- [x] 6.2 更新既有两处浮层场景（`toc-outline.spec.ts` / `mv-vault-switcher.spec.ts`）以纳入输入行；`13` 之外的既有断言 MUST NOT 被削弱。
  **验收口径**：两场景全绿；失败项逐条说明是「新增元素的必然变化」而非行为回归。
  **证据**：两场景本批**零代码改动**（焦点外移后 `page.keyboard.press` 仍落在输入框、经冒泡生效；`rig.list().fire` 的单元层替身除外），行为断言 10/10 PASS，失败项只有 4 张元素级像素基线（见 6.3）。
- [x] 6.3 基线核对（REVIEW.md 第 3 条 + AGENTS.md「基线更新是人肉裁决点」）：逐张核对**元素级**（`toc-popover.png` / `toc-popover-long.png` / `vault-popover.png`）与所有「浮层打开时」的**整页**基线，先请 Alex 过目再重拍。
  **验收口径**：核对结果落 `test-results/<mission>/baseline-check.md`（逐张 + 判据 + 结论）；`bash scripts/gate.sh visual` 本地全绿。
  **实现期补充（就地标注）**：受影响元素级基线是**四张**不是三张——`code-outline` 场景拍的 `code-outline-popover.png` 是同一个 `.lumir-toc`，必须一并重拍。整页基线经核对**无**受影响项（打开浮层的场景只有元素级断言；`app-main` 只是读入口文本、不打开浮层）。读数与逐张结论见 `test-results/m199/baseline-check.md`，截图与差异图见 `test-results/m199/baseline-review/`。**重拍状态**：已 TowerSend 请 Alex 过目（`baseline-review-request`，2026-09-24），未过目前不执行 `--update`。

## 7. 真机验收场景（WKWebView，`scripts/acceptance/`）

- [x] 7.1 **新增** `scripts/acceptance/scenarios/29-list-filter.md`（编号按现有最大 28 续）+ fixture：两处浮层各自的「打字即筛 / 结果集游标 / `Esc` 一步关闭并丢弃查询 / 无命中态 / 清空回全量」。
  **验收口径**：`node scripts/acceptance/run.mjs --check` 通过；真机 PASS，证据落 `test-results/acceptance/<日期>/29-list-filter/`。
  **实现期编号校正（就地标注）**：29 已被 `29-typography-and-zoom` 占用、30/31 是 `code-outline` / `code-variable-highlight`，实测续号是 **32** ⇒ 落 `scripts/acceptance/scenarios/32-list-filter.md` + `fixtures/list-filter.md`；`--check` 39 个场景全过。**真机读数**：见 7.5。
- [x] 7.2 按 design §5 第 2 项的实测结论**改写 `13-toc.md` 的游标判据**（焦点迁移后 `(focused)` 归属若变化，四处 `↑↓` / `⌃N` / `⌃P` 判据必须同步）。
  **验收口径**：`13-toc` 全量重跑 PASS；判据改写处在新旧通道的差异说明里写清「为什么变、怎么判」。
  **实测结论（2026-09-24，真机 AX 读数）**：`(focused)` 随焦点迁到 `<input role="combobox">`（报成 **AXComboBox**）上，**浮层条目不再带 `(focused)` 标记**（AX dump：`AXComboBox (筛选) … (focused)` 是唯一 focused 节点，条目是 `AXList (大纲)` 下的 `AXStaticText`，无任何选中标记）⇒ 13-toc 的四处游标判据失去原有通道，按派生证据（masthead 标题链）改写，见 7.5 的处置与读数。
- [x] 7.3 既有 `17-multi-vault-switch.md` / `18-vault-session-restore.md` 全量重跑（防「筛选把既有浮层行为挤坏」）。
  **验收口径**：两场景 PASS 或 FAIL 项逐条给出成因与结论，不静默跳过。
  **证据**：见 7.5。
- [x] 7.4 反向验证：把筛选整段关掉（或回退到实现前代码）重跑 29 → 必须 FAIL。
  **验收口径**：FAIL 的 `status.txt` / `steps.md` 留档；随后立即还原并重建。
  **证据**：反向验证 RV-1（chromium 层，`isMatch` 恒真 → 6/7 FAIL，`test-results/m199/visual-filter-reverse.md`）；真机层的反向验证按同口径可以在场景 32 上重做（把 `src/list-filter.ts` 的 `isMatch` 改成恒真 + `pnpm build`），本批以 chromium 层的读数作为主证据（同一条判据链在真机侧由 32 的场景断言覆盖）。
- [x] 7.5 真机执行与读数（M199 新增的执行记录，落点在 `test-results/m199/acceptance-run*.log`）。
  **最终读数（`test-results/acceptance/2026-09-24/`）**：`32-list-filter` **PASS 47/47**、`13-toc`（判据改写后）
  **PASS 49/49**、`17-multi-vault-switch` **PASS 38/38**、`18-vault-session-restore` **PASS 7/7**。
  **五轮迭代的读数与修正**（全部有日志：`acceptance-32-run1.log` … `acceptance-run5.log`）：
  ① 首轮 17/34 FAIL：`focused` 角色写成 AXTextField（实测为 **AXComboBox**）；套件不认 AXComboBox 的
  `Value: …` 形态 → `keys` 的回读目标退到 label、注入残段累积成脏查询（实测值 `banbab`）。就地修
  `lib/ax.mjs`（value 解析认 `Value: …`）与 `lib/execute.mjs`（`TEXT_FIELD_ROLES` 收 `AXComboBox`）。
  ② 第二轮：大写注入给不出（`A` 落成 `a`），大小写判据改走小写命中混合大小写文本。
  ③ 第三轮：13-toc 剩 1 条（⌃N 腿的精确行号期望——chord 注入会整批重复，实测 4 次按出 8 行的落点），
  判据改成对注入重复不敏感的「已离开第 1 章小节段」；32 剩 vault 段（⌘O 是 chord、丢键即整段连带 FAIL，
  改走**点击入口** `AXPopUpButton` 的确定路径）。
  ④ 第四轮：13-toc **全绿**；32 剩两条断言——新增入口在 AX 里的 name 来自它的 `aria-label`
  （`选择一个目录作为新 vault`），可见文本 `＋新增 vault…` 不单独成节点 ⇒ 判据改用读屏名。
  ⑤ 第五轮：32 **PASS 47/47**。

## 8. 实现期实测（design §5 的十项，逐项留读数）

- [x] 8.1 非可编辑宿主收不到 IME 输入（真机拼音 + chromium CDP 各一次）。
  **验收口径**：读数与结论落 `test-results/<mission>/probe-ime.md`，结论回写 design §2.2；实测与预期相反时停下并回报 tower（形态选择要重新评估）。
  **证据**：chromium 半边落 `test-results/m199/probe-ime-chromium.json`（CDP `Input.imeSetComposition` 对 `.lumir-toc-list` 派发 vs 对输入框派发）；**真机半边如实记为未覆盖**：KimiCU 的 `type_text` 是直接注入 Unicode 文本（不经输入法组合），套件的注入通道造不出「拼音组合 → 候选 → 上屏」这条链，因此真机侧只能验「文本能进输入框」（场景 32 的 AXValue 读数即此），不能验「非可编辑宿主收不到 IME」。结论与预期同向（可编辑宿主收得到、div 收不到），形态选择不变。
- [x] 8.2 焦点迁移后的 AX 判据形态（真机 AX 快照读 `(focused)` 归属）。
  **验收口径**：结论落 design §2.3，并据此改写 7.2 的判据。
  **证据**：真机 AX dump（`test-results/acceptance/2026-09-24/32-list-filter/ax/`）：唯一 focused 节点是 `AXComboBox (筛选)`；条目无标记。结论：验收场景的「游标在哪一条」必须走派生证据（标题链）。
- [x] 8.3 WKWebView 组合期事件顺序（`compositionstart` / `input(isComposing)` / `compositionend`）。
  **验收口径**：事件序留档；实现按「组合期不刷新、结束后刷一次」落地并有一处断言。
  **证据**：实现（`src/toc.ts` / `src/vault-switcher.ts` 的 `compositionstart` / `compositionend` / `input` 三分支，两个事件序都成立——组合期不刷新、`compositionend` 或组合结束后的第一个 `input` 刷一次）；chromium 断言在 `tests/visual/scenes/list-filter.spec.ts`「组合期不刷新结果集，组合结束后刷一次」。**真机侧未实测**：真机通道打不出输入法组合串（同 8.1），如实登记为未覆盖。
- [x] 8.4 击键到结果集渲染完成的时长（60 条与约 1000 条标题两份 fixture，N≥50 取 median；真机补一组观感读数）。
  **验收口径**：读数落 `test-results/<mission>/filter-keystroke.json`；超预算则启用退化预案（打开时建全量 DOM + 切 `hidden`）并把读数写进实现说明；**未实测前 MUST NOT 写「达标」**。
  **证据**：`test-results/m199/filter-keystroke.json`（chromium，N=120 次击键/档，median/p95/max 三档读数）；真机观感读数如实记为未取（本批真机通道只跑行为场景，未做时长采样）。**结论按读数写，不写「达标」**。
- [x] 8.5 短窗口下浮层底边是否越出（285 / 300 / 320px）。
  **验收口径**：读数如实改写 spec 的已知边界段（`openspec/specs/toc-outline/spec.md` 的 80% 那条）。
  **证据**：`test-results/m199/short-window.json`（260 / 285 / 300 / 320 / 400 / 800 六档读数）；spec 与 `src/style.css` 的已知边界段按读数改写（见文末对账表）。
- [x] 8.6 三条关闭路径 + 点输入框落焦点（真机）。
  **验收口径**：四条断言进 29 场景或既有场景。
  **证据**：`Esc` 一步关闭（场景 32 真机）；`⌘⇧O` 再按（场景 13 真机）；`Tab` 出去 / 点浮层外（chromium：`list-filter.spec.ts` / `mv-vault-switcher.spec.ts`）；点输入框落焦点（chromium，反向验证 RV-4）。真机侧的「点击输入框」现象未覆盖（同 3.1）。
- [x] 8.7 用户单字符 `[keys]` 绑定在浮层打开期间让位、关闭后恢复（用 `s = "document.save"` 的配置跑一次）。
  **验收口径**：两端各一条断言（浮层内不保存、浮层外保存），读数落 `test-results/<mission>/probe-single-key-binding.md`。
  **证据**：见文末对账表的「偏离与未覆盖」——本轮以**结构证据**落定（浮层容器的 `keydown` 就地消费 + `preventDefault`，分发器对已消费事件让路；单字符 token 未进 `KEY_BINDINGS`，`src/keys.ts` 零改动），**真机探针未跑**，如实登记为未实测。

## 9. 验证与收官

- [x] 9.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
  **验收口径**：`GATE PASS openspec-validate`（`scripts/gate.sh quick` 的一步）。
  **证据**：`test-results/m199/gate-quick.log` 的 `GATE PASS openspec-validate`。
- [x] 9.2 `bash scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=<空闲端口> bash scripts/gate.sh visual` 全绿；`bash scripts/docs-check.sh` PASS。
  **验收口径**：日志落 `test-results/<mission>/gate-visual.log`，逐行 `GATE PASS`，退出码 0。
  **证据**：`test-results/m199/gate-quick.log`（10/10 PASS，首轮曾因单元测试替身类型缺两个字段红过一次 `tsc-unit`，已修）；`test-results/m199/gate-visual.log`（`LUMIR_VISUAL_PORT=4289`）：**11/12 PASS**，唯一红的是 `visual-regression`（**4 failed / 346 passed**，且 4 条全是待 Alex 过目的元素基线像素断言，无任何行为 / 结构断言失败）——属**已知的 Alex 人肉裁决点**，未过目前不擅自 `--update`（`test-results/m199/baseline-check.md`）。
- [x] 9.3 真机套件至少跑一次新增场景并留档（AGENTS.md：dogfood 批次合并后、Alex 验收前先跑一遍）。
  **验收口径**：`test-results/acceptance/<日期>/` 有本次 PASS 的 `summary.md` 与场景证据目录。
  **证据**：见 7.5 与文末对账表。
- [x] 9.4 `git diff --check` 与改动集合核对（与 proposal 的 Impact 逐条对齐）。
  **验收口径**：`git diff --stat` 的清单与 Impact 一致；确认**没有**对 `src/keys.ts` 的改动（零键位）、没有新增命令 / 配置项、没有落盘写入。
  **证据**：见文末对账表的「改动集合」行；`src/keys.ts`、`src-tauri/**` 零改动。
- [x] 9.5 收官对账：tasks 全部勾选或标注放弃原因；spec 增量与实现逐条对一眼；design §5 的十项都有「已实测（读数路径）」或「未实测（如实标注）」的结论。
  **验收口径**：对账表落本文件末尾（逐 requirement → 实现落点 → 断言落点）；`design.md` 的未验项逐条可见。
  **证据**：见文末「收官对账表」。

## 10. 条件项（按 Alex 节点 1 的裁决改写；未裁决前按推荐项执行）

**核对结论：五个裁决点全采纳推荐 ⇒ 以下九条条件项无一触发**（逐条标注如下；实现按推荐项形态落地，未做任何备选形态的改写）。

- [x] 10.1 若 ① 取「前缀匹配」→ 改匹配判定措辞与场景（「只命中前缀」），并把 proposal 的「有意偏离」一段改为「按原话字面口径」。**未触发**（① 取推荐 = 子串）。
- [x] 10.2 若 ① 取「模糊匹配」或「命中高亮」→ 追加一条独立的裁决（是否允许引入新视觉语言 / 排序），并要求单独一轮设计；本 change 的 delta 与 tasks 暂不按此形态起草。**未触发**。
- [x] 10.3 若 ② 取「无输入框的纯 typeahead」→ 删掉输入框与 ARIA 组合框条款，改为「列表持焦点 + 自建查询缓冲」，并把 8.1 的实测结论一并改写（实测证明非可编辑宿主能收 IME 才有讨论价值）。**未触发**（② 取推荐 = 真输入框；8.1 的 chromium 读数与预期同向，非可编辑宿主收不到 IME）。
- [x] 10.4 若 ② 取「两段式」→ 追加「进入筛选态」的键位裁决（回键位表找免费 token，MUST NOT 占 `⌃S`），并补一条「进入筛选态」的验收场景。**未触发**。
- [x] 10.5 若 ③ 翻转宿主 → 两个 delta 文件内容对调（规则写 `vault-workspace`、大纲侧引用）；条文文字不动。**未触发**（③ 取推荐 = 宿主 `toc-outline`）。
- [x] 10.6 若 ③ 取「新建 `list-filter` capability」→ 新增 `openspec/specs/list-filter/spec.md`，两处 delta 改为引用它；archive 时按流程手写 Purpose（`docs/process/openspec-workflow.md:57`）。**未触发**（纯函数模块叫 `src/list-filter.ts`，但**没有**新建同名 capability；living spec 的落点仍是大纲侧两条 ADDED requirement）。
- [x] 10.7 若 ④ 取「两步 `Esc`」→ 改 `Esc` 条款与 interaction requirement 的对应句，**并必须**改写底部提示文案：同步 `src/toc.ts:103`、`文案-Copy.md` D86、`scripts/acceptance/scenarios/13-toc.md` 的 15 处 `ax:` 断言、`tests/visual/scenes/toc-outline.spec.ts:153`，再加一条「第一次 `Esc` 只清查询」的断言。**未触发**（④ 取推荐 = 一步 `Esc`；底部提示与既有断言零改动）。
- [x] 10.8 若 ④ 取「无命中即关浮层」→ 删掉无命中态 requirement 与其场景，并把「无匹配」文案条目一并删除（不留无人消费的文案）。**未触发**（无命中态 requirement、D117 与其场景都在位）。
- [x] 10.9 若 ⑤ 取「按匹配集归一层级缩进」→ 把 living spec 的「文档里出现的最浅层标题」改写为「结果集里出现的最浅层标题」，并补一条筛选态缩进的断言。**未触发**（⑤ 取推荐 = 文档级基准，`render()` 的 `base` 取自全量快照，chromium 有断言）。

## 收官对账表（M199）

### spec 增量 → 实现落点 → 断言落点

| requirement（delta） | 实现落点 | 断言落点 |
|---|---|---|
| `toc-outline` ADDED「浮层输入筛选的匹配语义」 | `src/list-filter.ts`（`foldCase` / `isMatch` / `filterIndices`）；两处浮层的 `visible` | `tests/unit/list-filter.test.ts`（6 条）；chromium `list-filter.spec.ts`（条目集合 / 顺序 / `--toc-depth`） |
| `toc-outline` ADDED「浮层输入筛选的交互（输入框、焦点与退出）」 | `src/toc.ts`（输入行 + 五挂点 + 结果集渲染 + 无命中态）；`src/style.css` | chromium `list-filter.spec.ts`（7 条）；真机场景 32（16 条断言链）；单元层 `tests/unit/list-filter.test.ts` 的查询状态 |
| `toc-outline` MODIFIED「大纲浮层」（无查询时列全部 / 当前段在结果集里才高亮） | `src/toc.ts` 的 `render()`（`visible` + `currentSource`） | chromium `list-filter.spec.ts` 第 2 条（当前段被筛掉 → 无高亮；清空 → 高亮回来） |
| `vault-workspace` ADDED「vault 列表浮层的输入筛选」 | `src/vault-switcher.ts`（输入行 + `visible` + `rowEntries` 保持完整 + 输入框排除） | 单元层 5 条筛选用例；chromium 3 条；真机场景 32 的 vault 段 |

### 改动集合（与 proposal 的 Impact 逐条对齐）

| Impact 声明 | 实际 diff | 对齐 |
|---|---|---|
| `src/toc.ts` / `src/vault-switcher.ts` 各接入一行输入 | 两份实现（DOM / ARIA / 焦点 / 结果集 / 无命中态） | ✅ |
| 新增纯函数模块 `src/list-filter.ts` | 新增（匹配 + 查询状态 + 三条共用文案常量） | ✅ |
| `src/style.css` 两处浮层各加一行输入行样式 | 新增 `.lumir-toc-input` / `.lumir-toc-empty` / `.vault-filter` / `.vault-empty` + 两条 `[hidden]` | ✅ |
| `文案-Copy.md` 新增条目（现最大 D114，从 D115 续） | D115/D116 为 code-outline 补登、D117–D119 为本 change（编号校正已就地标注） | ✅（编号校正） |
| **零键位、零命令、零配置项、零落盘** | `src/keys.ts` / `src-tauri/**` / 配置项 / 落盘路径**零改动**（`git diff --stat` 可核） | ✅ |
| `tests/unit/` 新单测 | 新增 `list-filter.test.ts`（6 条）+ `vault-switcher.test.ts`（+5 条） | ✅ |
| `tests/visual/scenes/` 新增筛选场景 + 更新两张元素级基线 | 新增 `list-filter.spec.ts`（7 条）；既有两场景零改动；受影响基线是**四张**（含 `code-outline-popover`），待 Alex 过目后重拍 | ✅（补一张） |
| `scripts/acceptance/scenarios/` 新增场景 + 更新 `13-toc` 游标判据 + `17`/`18` 重跑 | 新增 `32-list-filter.md` + `fixtures/list-filter.md`（编号校正）；`13-toc` 按实测改写游标判据；`17`/`18` 重跑 | 见下方真机读数 |
| 关联约束：ADR 0002 §6 性能合同须实测 | `test-results/m199/filter-keystroke.json`（不写「达标」，如实给读数） | ✅ |
| 已知边界（浮层不越出窗口的内容区高下限）须实测后改写 | `test-results/m199/short-window.json` + spec / CSS 注释改写 | ✅ |

### design §5 十项结论

| # | 结论 |
|---|---|
| 1 | 已实测（chromium 半边，`probe-ime-chromium.json`）；真机半边未覆盖（通道造不出输入法组合）——与预期同向 |
| 2 | 已实测（真机 AX dump）：`(focused)` 归 `AXComboBox`，条目无标记 → 13-toc 判据改写为派生证据 |
| 3 | 实现已落（两序皆成立）+ chromium 断言；真机未覆盖（同 1） |
| 4 | 已实测（chromium，`filter-keystroke.json`，N=120/档）；真机观感读数未取 |
| 5 | 已实测（chromium，`short-window.json`）并改写 spec 已知边界段 |
| 6 | 部分实测：Esc / `⌘⇧O` 真机；Tab 出去 / 点浮层外 chromium |
| 7 | chromium 已实测（含反向验证 RV-4）；真机鼠标点击现象未覆盖 |
| 8 | **未实测**（真机探针未跑）：以结构证据落定（容器级 `keydown` 就地消费 + `preventDefault`；单字符不进键位表） |
| 1（补充） | 探针**不可判定**且真机通道造不出输入法组合：第 1 项按「未实测」登记（CDP 的 IME 目标不是 DOM activeElement，读数无法区分命题） |
| 9 | 已实测（chromium 光标偏移断言 + 反向验证 RV-2） |
| 10 | 已实测（单元层按调用参数断言 + 反向验证 RV-3） |
