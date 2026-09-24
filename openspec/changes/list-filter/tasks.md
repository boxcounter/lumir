# Tasks: list-filter

任务口径（同 `remember-reading-position`）：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，不是「跑过了」的口头声明（[REVIEW.md](../../../REVIEW.md) 第 7 条）。

**本文件是提案阶段的实现计划；除第 0 组外全部未勾选**——本 mission 只产出提案（proposal / design / spec delta / tasks + validate），零产品代码；实现待 Alex 节点 1 裁决后另立 mission。

**条件项**（裁决落在备选上时，实现前先按裁决改写本文件与 delta，不静默按推荐项做）见第 10 组；逐条改写路径在 [design.md](design.md) §6。

## 0. 提案阶段（M196，留档）

- [x] 0.1 动工前读完 [REVIEW.md](../../../REVIEW.md) 与 [openspec 工作流](../../../docs/process/openspec-workflow.md)（提案 PR 与实现 PR 拆开；两个 Alex 节点是硬门禁）。
  **验收口径**：本 change 只产制品、零产品代码；实现另立 mission。
- [x] 0.2 两处列表的现状盘点（渲染 / 键盘通道 / 焦点 / `Esc` 语义 / 空态）逐条带 `file:line` 写进 [design.md](design.md) §1。
  **验收口径**：design §1 的每条断言都能按锚点复核（`src/toc.ts`、`src/vault-switcher.ts`、`src/keys.ts`、`src/style.css`、`openspec/specs/`）。
- [x] 0.3 四件制品起草完毕并自验。
  **验收口径**：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 全绿；`bash scripts/docs-check.sh` PASS（命令可复算，输出见 M196 的 review-request）。

## 1. 匹配与筛选状态（纯逻辑层，两处共用）

- [ ] 1.1 新增纯函数模块（暂名 `src/list-filter.ts`，实现期定稿）承担匹配判定：大小写折叠 + 子串包含 + 多字节安全；**只有一份实现**，两处浮层共用。
  **验收口径**：`rg -n "toLowerCase" src/` 只在模块内命中（无第二份匹配实现）；模块无 DOM 依赖（可被单测直接 import）。
- [ ] 1.2 结果集表达为「源条目数组的下标数组」，游标 / 当前项高亮 / 动作落点全部从这一处取。
  **验收口径**：大纲侧的 `Enter` 落在**命中条目**（不是源下标的同名位置）；反向验证：去掉映射后该断言必须 FAIL（design §5 第 9 项）。
- [ ] 1.3 查询状态：置空回到全量、首条命中为游标起点、关闭即丢弃查询。
  **验收口径**：单测逐条断言三条转移；证据落 `test-results/<mission>/`（读数/日志）。

## 2. 大纲浮层接入（`src/toc.ts` + `src/style.css`）

- [ ] 2.1 浮层内新增输入行（列向 flex 的固定行，不被压缩；颜色 / 边框 / 圆角取既有 token，不引入新视觉语言）。
  **验收口径**：chromium 断言「浮层总高 ≤ 窗口内容区高的 80%」仍成立（既有场景照绿）、列表仍是唯一滚动容器（列表 `scrollHeight > clientHeight` 而浮层自身不滚）。
- [ ] 2.2 焦点迁移的五处挂点（design §2.3）：打开时聚焦输入框、失焦收起挂点外移到浮层容器、`aria-activedescendant` 移到输入框（`role=combobox` + `aria-controls`）、就地键挂点上移到容器、逐条目 `mousedown` 防夺焦维持不变。
  **验收口径**：真机三条关闭路径（`Tab` 出去 / 点浮层外 / 再按 `⌘⇧O`）各收起一次；design §5 第 6、7 项有实测记录。
- [ ] 2.3 结果集渲染 + 游标（复用既有 `move()` / `setActive()` / `jumpTo()`，MUST NOT 第二套下标逻辑）。
  **验收口径**：`git diff src/toc.ts` 里没有新增的下标钳制 / 移动实现（只有结果集映射与渲染）。
- [ ] 2.4 无命中态：保持浮层打开 + 一行提示；MUST NOT 复用 D84（文档没有标题）。
  **验收口径**：真机与 chromium 各一条断言；MUST NOT 出现「这份文档还没有标题」。
- [ ] 2.5 缩进基准沿用文档级（`src/toc.ts:304` 不动，裁决点 ⑤ 推荐项）。
  **验收口径**：筛选到只剩深层标题时，缩进与筛选前逐条一致（chromium 读 `--toc-depth`）。

## 3. vault 浮层接入（`src/vault-switcher.ts` + `src/style.css`）

- [ ] 3.1 输入行与焦点迁移（同 2.1 / 2.2 的口径）；**MUST 把输入框排除在浮层级 `mousedown` 的 `preventDefault` 之外**（`src/vault-switcher.ts:589`），否则点输入框无法落焦点。
  **验收口径**：真机点输入框后能直接键入（design §5 第 7 项）。
- [ ] 3.2 `rowEntries` 保持**本次拉取的完整列表**，另加结果集下标数组；「重新定位…」的 `siblings` 仍传完整列表（`src/main.ts:669-679` 的占用判定）。
  **验收口径**：把一个已被筛掉的 vault 占用的路径当重定位目标，仍被拒绝；反向验证：把 `siblings` 换成结果集后该断言必须 FAIL（design §5 第 10 项）。
- [ ] 3.3 失效行参与筛选、`Enter` 三支动作不变；「新增 vault…」与分隔线不参与筛选、无命中时仍可用；当前项被筛掉时不显示标记且不改当前 vault。
  **验收口径**：四条各有断言（单测或 chromium 场景），证据落 `test-results/<mission>/`。
- [ ] 3.4 打开路径不变：仍只拉取一次（输入不触发第二次 `list()`）。
  **验收口径**：桩的调用记录里 `list()` 次数 = 1（仿 `tests/visual/scenes/tauri-stub.ts` 的调用记录做法）。

## 4. 文案

- [ ] 4.1 `文案-Copy.md` 追加三条（现最大 D114，从 D115 续）：D115 无匹配提示、D116 输入框占位、D117 输入框读屏名；两处浮层共用同一批文案。
  **验收口径**：`rg -n "D11[567]" 文案-Copy.md` 三条在位；实现侧引用同一常量（不在两处各写一份字面量）。
- [ ] 4.2 大纲浮层底部提示文案**不动**（裁决点 ④ 推荐项下无需改写）。
  **验收口径**：`git diff` 里 `src/toc.ts:103` 与 `文案-Copy.md` D86 零改动；`13-toc` 的 15 处断言与 `tests/visual/scenes/toc-outline.spec.ts:153` 均未改。

## 5. 单测（`tests/unit/`，纯逻辑层）

- [ ] 5.1 匹配与查询状态的单测：子串命中 / 大小写折叠 / 空查询回到全量 / 首条命中为起点 / 关闭丢弃查询 / 中文串命中。
  **验收口径**：`node tests/unit/run.mjs` 全绿，用例数与基线（最近一次全绿输出）对得上；不把 DOM 与布局行为塞进这一层（`tests/unit/README.md` 的分工）。

## 6. 视觉场景（chromium，CI 门禁）

- [ ] 6.1 新增 `tests/visual/scenes/list-filter.spec.ts`：判「输入即筛」（条目集合变化）、「结果集里的游标落点」、「无命中态」、「清空回全量」、「输入行在位且浮层总高仍在上限内」。
  **验收口径**：判据全落在条目集合 / 几何 / 计算属性上，MUST NOT 只断言「输入框里有字」（REVIEW.md 第 1 条）；先造一个必须让断言 FAIL 的输入实测一次。
- [ ] 6.2 更新既有两处浮层场景（`toc-outline.spec.ts` / `mv-vault-switcher.spec.ts`）以纳入输入行；`13` 之外的既有断言 MUST NOT 被削弱。
  **验收口径**：两场景全绿；失败项逐条说明是「新增元素的必然变化」而非行为回归。
- [ ] 6.3 基线核对（REVIEW.md 第 3 条 + AGENTS.md「基线更新是人肉裁决点」）：逐张核对**元素级**（`toc-popover.png` / `toc-popover-long.png` / `vault-popover.png`）与所有「浮层打开时」的**整页**基线，先请 Alex 过目再重拍。
  **验收口径**：核对结果落 `test-results/<mission>/baseline-check.md`（逐张 + 判据 + 结论）；`bash scripts/gate.sh visual` 本地全绿。

## 7. 真机验收场景（WKWebView，`scripts/acceptance/`）

- [ ] 7.1 **新增** `scripts/acceptance/scenarios/29-list-filter.md`（编号按现有最大 28 续）+ fixture：两处浮层各自的「打字即筛 / 结果集游标 / `Esc` 一步关闭并丢弃查询 / 无命中态 / 清空回全量」。
  **验收口径**：`node scripts/acceptance/run.mjs --check` 通过；真机 PASS，证据落 `test-results/acceptance/<日期>/29-list-filter/`。
- [ ] 7.2 按 design §5 第 2 项的实测结论**改写 `13-toc.md` 的游标判据**（焦点迁移后 `(focused)` 归属若变化，四处 `↑↓` / `⌃N` / `⌃P` 判据必须同步）。
  **验收口径**：`13-toc` 全量重跑 PASS；判据改写处在新旧通道的差异说明里写清「为什么变、怎么判」。
- [ ] 7.3 既有 `17-multi-vault-switch.md` / `18-vault-session-restore.md` 全量重跑（防「筛选把既有浮层行为挤坏」）。
  **验收口径**：两场景 PASS 或 FAIL 项逐条给出成因与结论，不静默跳过。
- [ ] 7.4 反向验证：把筛选整段关掉（或回退到实现前代码）重跑 29 → 必须 FAIL。
  **验收口径**：FAIL 的 `status.txt` / `steps.md` 留档；随后立即还原并重建。

## 8. 实现期实测（design §5 的十项，逐项留读数）

- [ ] 8.1 非可编辑宿主收不到 IME 输入（真机拼音 + chromium CDP 各一次）。
  **验收口径**：读数与结论落 `test-results/<mission>/probe-ime.md`，结论回写 design §2.2；实测与预期相反时停下并回报 tower（形态选择要重新评估）。
- [ ] 8.2 焦点迁移后的 AX 判据形态（真机 AX 快照读 `(focused)` 归属）。
  **验收口径**：结论落 design §2.3，并据此改写 7.2 的判据。
- [ ] 8.3 WKWebView 组合期事件顺序（`compositionstart` / `input(isComposing)` / `compositionend`）。
  **验收口径**：事件序留档；实现按「组合期不刷新、结束后刷一次」落地并有一处断言。
- [ ] 8.4 击键到结果集渲染完成的时长（60 条与约 1000 条标题两份 fixture，N≥50 取 median；真机补一组观感读数）。
  **验收口径**：读数落 `test-results/<mission>/filter-keystroke.json`；超预算则启用退化预案（打开时建全量 DOM + 切 `hidden`）并把读数写进实现说明；**未实测前 MUST NOT 写「达标」**。
- [ ] 8.5 短窗口下浮层底边是否越出（285 / 300 / 320px）。
  **验收口径**：读数如实改写 spec 的已知边界段（`openspec/specs/toc-outline/spec.md` 的 80% 那条）。
- [ ] 8.6 三条关闭路径 + 点输入框落焦点（真机）。
  **验收口径**：四条断言进 29 场景或既有场景。
- [ ] 8.7 用户单字符 `[keys]` 绑定在浮层打开期间让位、关闭后恢复（用 `s = "document.save"` 的配置跑一次）。
  **验收口径**：两端各一条断言（浮层内不保存、浮层外保存），读数落 `test-results/<mission>/probe-single-key-binding.md`。

## 9. 验证与收官

- [ ] 9.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
  **验收口径**：`GATE PASS openspec-validate`（`scripts/gate.sh quick` 的一步）。
- [ ] 9.2 `bash scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=<空闲端口> bash scripts/gate.sh visual` 全绿；`bash scripts/docs-check.sh` PASS。
  **验收口径**：日志落 `test-results/<mission>/gate-visual.log`，逐行 `GATE PASS`，退出码 0。
- [ ] 9.3 真机套件至少跑一次新增场景并留档（AGENTS.md：dogfood 批次合并后、Alex 验收前先跑一遍）。
  **验收口径**：`test-results/acceptance/<日期>/` 有本次 PASS 的 `summary.md` 与场景证据目录。
- [ ] 9.4 `git diff --check` 与改动集合核对（与 proposal 的 Impact 逐条对齐）。
  **验收口径**：`git diff --stat` 的清单与 Impact 一致；确认**没有**对 `src/keys.ts` 的改动（零键位）、没有新增命令 / 配置项、没有落盘写入。
- [ ] 9.5 收官对账：tasks 全部勾选或标注放弃原因；spec 增量与实现逐条对一眼；design §5 的十项都有「已实测（读数路径）」或「未实测（如实标注）」的结论。
  **验收口径**：对账表落本文件末尾（逐 requirement → 实现落点 → 断言落点）；`design.md` 的未验项逐条可见。

## 10. 条件项（按 Alex 节点 1 的裁决改写；未裁决前按推荐项执行）

- [ ] 10.1 若 ① 取「前缀匹配」→ 改匹配判定措辞与场景（「只命中前缀」），并把 proposal 的「有意偏离」一段改为「按原话字面口径」。
- [ ] 10.2 若 ① 取「模糊匹配」或「命中高亮」→ 追加一条独立的裁决（是否允许引入新视觉语言 / 排序），并要求单独一轮设计；本 change 的 delta 与 tasks 暂不按此形态起草。
- [ ] 10.3 若 ② 取「无输入框的纯 typeahead」→ 删掉输入框与 ARIA 组合框条款，改为「列表持焦点 + 自建查询缓冲」，并把 8.1 的实测结论一并改写（实测证明非可编辑宿主能收 IME 才有讨论价值）。
- [ ] 10.4 若 ② 取「两段式」→ 追加「进入筛选态」的键位裁决（回键位表找免费 token，MUST NOT 占 `⌃S`），并补一条「进入筛选态」的验收场景。
- [ ] 10.5 若 ③ 翻转宿主 → 两个 delta 文件内容对调（规则写 `vault-workspace`、大纲侧引用）；条文文字不动。
- [ ] 10.6 若 ③ 取「新建 `list-filter` capability」→ 新增 `openspec/specs/list-filter/spec.md`，两处 delta 改为引用它；archive 时按流程手写 Purpose（`docs/process/openspec-workflow.md:57`）。
- [ ] 10.7 若 ④ 取「两步 `Esc`」→ 改 `Esc` 条款与 interaction requirement 的对应句，**并必须**改写底部提示文案：同步 `src/toc.ts:103`、`文案-Copy.md` D86、`scripts/acceptance/scenarios/13-toc.md` 的 15 处 `ax:` 断言、`tests/visual/scenes/toc-outline.spec.ts:153`，再加一条「第一次 `Esc` 只清查询」的断言。
- [ ] 10.8 若 ④ 取「无命中即关浮层」→ 删掉无命中态 requirement 与其场景，并把「无匹配」文案条目一并删除（不留无人消费的文案）。
- [ ] 10.9 若 ⑤ 取「按匹配集归一层级缩进」→ 把 living spec 的「文档里出现的最浅层标题」改写为「结果集里出现的最浅层标题」，并补一条筛选态缩进的断言。
