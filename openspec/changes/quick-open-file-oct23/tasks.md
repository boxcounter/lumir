# Tasks: quick-open-file-oct23

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现
> proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。
>
> 本文件按 **D2 = 倾向侧（vault 外只读放行）** 展开。若 D2 裁另一侧，第 5 组整组删除，
> 第 1 / 2 / 4 组里带「外部」字样的子项随之删除，spec delta 按 proposal 的说明改写。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/{quick-open,keymap-commands,multi-tabs,fs-io,vault-workspace}/spec.md` / 本文件
- [x] 0.2 Alex 节点 1 评审通过（硬门禁；五个起草期取值 D1–D5 一并裁决，**D2 是唯一改到既有安全边界的一条**）
      —— 2026-10-23 通过，均按提案倾向；D2 追加裁决：标签页标题带可见的只读区分标记 + modeline
      显示完整绝对路径作辅助 + 尝试编辑不生效并给一次性提示（记录见 `proposal.md` 的评审记录）

## 1. 输入解析（纯函数 + 单测）

- [x] 1.1 新增 `src/quick-open.ts` 的解析纯函数：`resolveQuickOpenInput(raw, ctx)`——`trim` →
      绝对路径根前缀剥离（复用 `vaultAbsolutePath` 的拼接口径）→ `./` 归一 → 整串优先 →
      剥后缀（存在性优先，D5）→ 目录判定 → 三类结果。**vault 外绝对路径走同一次序**（整串优先 +
      同样的后缀剥离，命中后只读），MUST NOT 在归一化阶段就把外部路径分流掉
      —— 实现为 `normalizeQuickOpenInput` + `quickOpenAttempts`（候选阶梯）+ `lookupVaultPath`
      （存在性裁决）；三类结果由装配层的「命中 → 打开 / 目录 → 提示 / 都不到 → 找不到」承担
- [x] 1.2 后缀解析复用既有语义：把 `src/harness-path-link.ts` 的 `lineSuffixAt` 导出（或抽成
      共享纯函数模块），MUST NOT 复制 `LINE_SUFFIX`；`harness-path-link.test.ts` 的既有断言原样通过
- [x] 1.3 大小写策略：逐字精确优先；无精确命中时折叠等值回退；折叠多命中 ⇒ 列候选（不猜）
- [x] 1.4 单测（`tests/unit/quick-open.test.ts`）：design §2.4 的表逐行断言（含外部路径带行号 /
      外部路径后缀畸形两行）；另加畸形后缀
      （`:0` / `:12-` / `:40-12` / `:9-12-15` / `:12x`）、冒号文件名、`../` 拒绝、反斜杠拒绝、
      越界行号（钳制交给 revealLine，解析层不改判）
- [x] 1.5 单测：候选过滤以**完整相对路径**为匹配对象（`filterIndices` 复用，不重测其语义）

## 2. 浮层与交互

- [x] 2.1 新增浮层 DOM（形态照 `src/toc.ts` 的 `.lumir-toc`：输入框 + listbox + 空态 + 提示行，
      挂 `shell.modeline`，向上展开）；`aria-activedescendant` 落在持焦元素上，读屏名 / 占位
      走文案表
- [x] 2.2 就地键：Enter（解析 / 选中打开）、Esc 与 `⌃G`（取消）、↑↓ 与 `⌃N⌃P`（游标）；
      组合期不刷新（IME）；`Tab` 不接管（留给原生焦点遍历）
- [x] 2.3 关闭路径：Esc / `⌃G` / `focusout` 到浮层之外 / 点击浮层之外 / 成功打开后；交还焦点走
      `focusPreservingReadingPosition`（CL-1，MUST NOT 裸 `view.focus()`）
- [x] 2.4 前台会话切换 ⇒ 收起且不打开任何东西（与 goto-line 同口径）
- [x] 2.5 无 vault 时：命令给一行提示，MUST NOT 打开空浮层
- [x] 2.6 候选：空查询不列全量（只给用法提示）；渲染上限 `CANDIDATE_LIMIT = 100` 且提示行显示
      命中总数；点击候选不夺焦（`mousedown` preventDefault，照 TOC）
- [x] 2.7 重入：Enter 连按 / 存在性探测在途时改输入——请求序号丢弃过期结果；失败或过期 MUST NOT
      留下空标签

## 3. 键位与命令

- [x] 3.1 `src/keys.ts`：新增命令 `app.quick-open` 进 `NON_TAB_GLOBAL_COMMAND_IDS`；新增默认绑定
      `Cmd-p`（scope 由 `scopeOfCommand` 派生）；**不进** `KEYLESS_COMMAND_IDS`；绑定 docKey 写来由
      （三条来源见 design §6）
- [x] 3.2 `src/main.ts`：命令实现——已打开则收起（toggle），否则打开浮层；焦点进输入框
- [x] 3.3 单测：`tests/unit/keys.test.ts` 的三项对账（有绑定 / 无孤儿 / 清单与表无交集）原样通过；
      `[keys]` 重绑与解绑各一条
- [x] 3.4 真机核验 `⌘P` 不被 WKWebView / 原生菜单截获（design §6 第 3 条），失败则回报并停下等裁
      —— 2026-10-24 真机复核（M700，场景 230）：编辑器 / 文件树 / harness composer 三处焦点各按一次
      `⌘P` 都打开输入面（`AXComboBox（按路径快速打开文件）` 在场），无截获；证据
      `.local/reviews/m700/steps.md` 的「焦点在文件树」「焦点在 harness composer」两段 + `run-summary.md`

## 4. 打开编排与行跳转

- [x] 4.1 抽取装配层的行跳转 plan：把 `src/main.ts:2833` 附近的五件套（`open` / `reveal` /
      `duringTransition` / `nextFrame` / `needsRescroll`）抽成一个函数，harness 路径点击与快速打开
      共用（MUST NOT 复制第二份复核判据）
- [x] 4.2 快速打开 → `openFile(path, openKind(path), "new")`（与树点击同落点，D4）；已打开 ⇒ 既有
      移动 / 激活
- [x] 4.3 带行号 ⇒ `openPathAtLine`；无行号不碰视口；越界由 `revealLine` 钳制
- [x] 4.4 打开失败：浮层保持打开、提示行给原因；MUST NOT 留空标签

## 5. vault 外只读（D2 倾向侧；裁另一侧则整组删除）

- [x] 5.1 后端：`fs_read_external(path)` + `ExternalTextSnapshot { content }`——绝对路径 / 无 `..`
      段 / canonicalize 后必须常规文件 / 复用 `ATTACHMENT_MAX_BYTES` / UTF-8 失败复用既有错误码；
      注册进 `generate_handler!`；**不放宽** `resolve_in_vault` 的任何约束
- [x] 5.2 后端单测：非绝对路径 / `..` / 目录 / 超限 / 非法 UTF-8 五条拒绝 + 一条正常读
- [x] 5.3 ts-rs 重导出 `src/bindings/ExternalTextSnapshot.ts`（重导出产物先 `git add` 再跑门禁）
- [x] 5.4 `src/ipc.ts` 新增调用；`EditorSession` 增显式 `external` 字段（创建点定死），
      `makeSession` / `reloadSession` / `remapSessionPaths` 三处可编辑性判据收敛到同一表达式
      （design §5.2 的风险点）
- [x] 5.5 逐项不参与：保存入口早退、`save.noteOpened` 不登记、崩溃备份不写、watch 增量跳过、
      阅读位置不记、`paneSnapshot` 过滤（`src/vault-switcher.ts:131`）、`resolveBase()` 不给 from、
      `ensureMtime` 不调用
- [x] 5.6 `openExternal(path, line)` 装配：读 → 建只读会话 → `reloadSession` → `afterLoad`；带行号时
      接同一份 `openPathAtLine` 编排（打开后落到起始行）；同一外部路径再次打开切到既有标签
- [x] 5.7 modeline 只读段（「vault 外 · 只读」）+ 标签 `aria-label` 同句；外部图片 / 二进制给提示
- [x] 5.8 单测 / 场景：外部标签不入 `paneSnapshot`；`⌘S` 在外部会话上无 invoke；外部会话不写
      阅读位置

## 6. 文案与视觉

- [x] 6.1 文案取号（实现期从 master 末位顺延，核撞在途 mission）并进 `src/copy-data.ts` +
      `文案-Copy.md` 两列
- [x] 6.2 视觉场景（chromium）：`⌘P` 开浮层 / 空态 / 命中 / 游标 / Enter 打开 / Esc 关闭且阅读
      位置不变（CL-1）；无 vault 提示；候选上限提示
- [x] 6.3 既有整页基线：本 change 不新增色值 / 字号 / 圆角，现有场景不含外部会话 ⇒ 预期**零更新**；
      若出现任何基线差异，停下按「基线更新是人肉裁决点」报 Alex 过目后再 `--update`

## 7. 真机验收场景

- [x] 7.1 新增 `scripts/acceptance/scenarios/<号>-quick-open.md` + 合成 fixture（深层路径文件、
      含冒号的文件名、一个外部文本文件——**全部合成，不含真实内容**）；场景号按实现时批次的分配
      （M647 已占 228、M650 占 227，本 change 预计 229 起，实现期与 tower 核一次）
- [x] 7.2 断言：粘贴 `深层/路径.md:行` → 一次 Enter 落行；粘贴 vault 外绝对路径 → 只读打开 +
      `⌘S` 无反应 + modeline 只读段在场；粘贴 vault 外 `绝对路径:行` → 只读打开并落该行；重启后
      外部标签不回来；`⌘P` 在编辑器 / 树 / composer 三处各按一次都能开
      —— 2026-10-24 真机执行（M700，场景 230）：`结论：1/1 PASS`（60 断言 / 0 失败 / 168.8s，exit 0；
      证据 `.local/reviews/m700/` 的 `run-summary.md` + `steps.md` + `shots/`）。逐组证据：路径:行一次
      落行（「行号后缀」段，落点行读数在场）；vault 外只读 + `⌘S` 不写盘 + modeline 只读段（「vault 外
      只读现场」「⌘S 无落点」段，`/etc/hosts` 字节与 mtime 未变）；重启后外部标签不回来（「重启后的
      标签栏」段，对照 `v1:2.md` 照常恢复）；`⌘P` 三处焦点（「焦点在文件树」「焦点在 harness composer」段）。
      **覆盖边界**：`vault 外 绝对路径:行 → 只读打开并落该行` 不在 230 的断言面内——现有判据在
      chromium 层（`tests/visual/scenes/quick-open.spec.ts` 的「vault 外路径带行号」用例）与 resolver
      单测（`tests/unit/quick-open.test.ts` 的 `/tmp/x/draft.md:12` 判决矩阵）；真机补这条断言要改
      `scripts/acceptance/scenarios/230-quick-open.md`（不在本 mission scope），是否必需交节点 2 判
- [x] 7.3 回扫既有验收场景：`grep` 所有对 `⌘P` / 快速打开 / 标签持久化标签数的期望，逐条确认
      仍然成立；`node scripts/acceptance/run.mjs --check` 通过
- [x] 7.4 如实登记覆盖边界（候选列表的滚动手感、浮层弹出节奏归 Alex 手感裁决，不进机器判据）

## 8. 验证

- [x] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 8.2 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码）
- [x] 8.3 `bash scripts/gate.sh visual` 全绿（动过浮层样式与场景，必须本地跑）
- [x] 8.4 `bash scripts/docs-check.sh` 通过（含 MODIFIED delta 的归档对账）
- [x] 8.5 信息卫生清扫：新增 fixture / 场景 / 文档对改动面做一次 text 级 grep，真实 vault 内容、
      真实路径、真实人名零命中

> 实现期记录（2026-10-23/24）：首次真机执行被 macOS 屏幕录制授权弹窗挡住（KimiCU 的截图 / 读屏
> 动作受阻；tower 明确要求受阻即跳过并如实登记，MUST NOT 点任何系统授权弹窗），当轮 3.4 / 7.2 只
> 登记为未跑，场景 `230-quick-open.md` 只过 `--check` 静态校验。**2026-10-24 已补跑**（M700）：
> `node scripts/acceptance/run.mjs 230` → `结论：1/1 PASS`（60 断言 / 0 失败 / 168.8s，exit 0），
> 3.4 / 7.2 各按条内证据指针勾选（7.2 的「vault 外 绝对路径:行」一组仍是 chromium / 单测层，见条内
> 覆盖边界）。其余各档门的读数：`GATE RESULT: 11/11 PASS（SKIP 0）`（退出码 0）；视觉套件本地全量
> `743 passed / 1 skipped`（含整页像素对比，零基线更新）；`openspec validate --all --strict`
> 43/43；`docs-check` PASS。
>
> rebase 记录（2026-10-24）：本分支已 rebase 到 master（M653 / M654 已合入）。文案号与 M653
> 碰撞：M653 先合并且占走 D564–D569，本 change 的 14 条因此整体顺延为 **D570–D583**（一一对应、
> 顺序不变，deck 两列 + `src/copy-data.ts` + 引用处同批改；末位 D583）。rebase 后复跑：
> `GATE RESULT: 11/11 PASS（SKIP 0）`（退出码 0，单测 1249 PASS）、受影响的视觉场景集
> （quick-open / list-filter / code-outline / editable-host-guard / m642，含 webkit-realua
> project）45 passed。另修一处 master 上的遗留断链：`m642-overlay-select-all.spec.ts` 仍 import
> 已被 M645 删除的 `configGets`（master 的 tsc-visual 因此是红的），改用同一个 change 给出的
> `configApplied`。
>
> r1 评审处置（2026-10-24）：**P1-1**（D2 追加裁决 ③ 的「一次性提示」缺席）已兑现——编辑器层
> 在 contentDOM 上装「编辑尝试」探针（键入 / Enter / Backspace / Delete / 粘贴 / 拖入；每会话
> 一次，去重按会话对象记），装配层注入瞬态 toast；文案 D584（接 D583 末位）；spec delta 补
> 一句 normative 与 scenario「编辑尝试给一次性提示」；视觉场景加「提示出现 + 同会话第二次不再
> 出现」两条断言（并做反向验证：关掉注入即红）；验收场景 230 加第一步键入的 AX 判据（「每会话
> 一次」的负向判据留在 chromium 层，AX 数不到条数）。**P2-1**（tasks 3.3 的「重绑与解绑各一条」
> 专项单测缺席）已补：`tests/unit/keys.test.ts` 加 `app.quick-open` 两条用例（token 形态 /
> 作用域 / 不绑键清单对账 + 重绑与解绑各一条）。

## 9. 结果区与 Enter 同源（M700 / M697 缺陷修复，归档前就地修订）

> 缺陷：Alex 实测真实存在的绝对路径在结果区显示「没有匹配的条目」，Enter 却能打开（截图
> `kimi-code-composer://attachments/m1`）。根因是 render 与 confirm 各持一套判据（render =
> 索引 + 子串；confirm = 索引 → 折叠 → 目录 → 探测）。修复方向是**两端共用一份 resolver**，
> 不新建第二套解析；另外修掉折叠多命中 / 目录输入的键盘死路（两段式，不猜目标）。

- [x] 9.1 抽纯函数 resolver：`classifyVaultPath`（同步段，`lookupVaultPath` 与 resolver 共用）+
      `resolveQuickOpenSync`（阶梯同步段，遇需探测的一级返回 `undecided`）+ `resolveQuickOpen`
      （同一次序 + 异步探测，探测不成立才进入下一级）。MUST NOT 复制路径解析。
- [x] 9.2 结果区接判决：判决 `open` 时画独立 class 的直接打开行（`.lumir-qo-direct`，几何复用
      `.lumir-qo-item` 选择器列表）；D117 收窄为「候选为空且没有直接行」；异步探测去抖 120ms +
      渲染序号（在途不落空态、迟到结果丢弃）。
- [x] 9.3 直接行与候选统一游标 / ARIA / 点击：直接行 `role="option"`、默认游标位、`↑↓` 与
      `⌃N⌃P` 跨两者移动、Enter 打开游标行、点击同一动作；直接行不占 `CANDIDATE_LIMIT`。
- [x] 9.4 两段式：折叠多命中第一次 Enter 只揭示（D592），目录第一次 Enter 给原因（D574），
      第二次 Enter 打开游标行（输入一变即复位「已揭示」状态）。
- [x] 9.5 文案 D589–D592（接 D588 末位，全仓核撞无占用）：直接行（vault 内）/ 直接行（vault 外
      只读）/ 落点行标记 / 折叠多命中两段式提示；`src/copy-data.ts` + `文案-Copy.md` 两列 + 归属表同批。
- [x] 9.6 单测：resolver 判决矩阵（索引精确 / 整串优先（索引里真有 `path:12`）/ 折叠唯一 /
      折叠多命中 / 目录 / 惰性探测命中（相对 + vault 内绝对）/ 真负例 / 探测失败 / 外部尝试入口 /
      非法与空输入 / 分类器同源），并做反向必红（见 9.11）。
- [x] 9.7 视觉矩阵：外部存在 / 外部不存在 / 外部带行号 / 索引内 / 折叠唯一 / 折叠多命中两段式 /
      目录两段式 / 惰性相对与绝对（桩补 `fs_paths_exist` 路由）/ 探测迟到 / 真负例 / 候选上限 /
      直接行点击；每条都做反向必红（见 9.11）。
- [x] 9.8 验收场景 230：Enter 前断言直接行（动作文本 + 落点行）与「没有匹配的条目」不在场；
      补 vault 内真负例（空态 + 找不到）与惰性文件（`vaultWrite node_modules/...`，默认 lazy 档，
      按精确路径打开）。
- [x] 9.9 验证：`bash scripts/gate.sh quick` / `bash scripts/gate.sh visual` /
      `npx openspec validate --all --strict` / `bash scripts/docs-check.sh` /
      `node scripts/acceptance/run.mjs --check`（读数照抄 `GATE RESULT` 原文行 + 退出码，见下）。
- [x] 9.10 真机：`node scripts/acceptance/run.mjs 230` → `结论：1/1 PASS`（60 条断言 / 0 失败 /
      168.8s，exit 0；隔离 vault `/tmp/lumir-m102-acceptance` + 隔离配置 + 端口 1430）。首次真机执行
      暴露并修掉三处场景缺陷（AXTextField → AXComboBox、树里默认折叠读不到深层文件名、YAML 单引号里的
      `\\(` 是两个反斜杠）与一处注入通道边界（`typeInNode` 的 `type_text` 对 focusout 收起的浮层不落地
      → 改逐键 `keys`，冒号用 `shift+semicolon`；惰性目录改用 `dist/`，KimiCU 键名 DSL 没有 `_`）。
- [x] 9.11 反向必红记录：把直接行删掉 / 放开 D117 分支 / 恢复 `ambiguous` 提前 return /
      恢复 `dir` 提前 return / 关掉探测 / 去掉渲染序号各实测一次，确认对应断言变红后还原。

## 10. 归档（节点 2 通过后，M713 执行）

- [ ] 10.1 归档时为新建 capability `quick-open` 手写 living spec 的 Purpose（`archive` 只写占位
      `TBD - created by archiving change …`），写完复跑 `validate --all --strict` 确认全绿

> M700 验证读数（2026-10-24）：`GATE RESULT: 13/13 PASS（SKIP 0）`（`bash scripts/gate.sh visual`，
> exit 0；含 quick 的 11 门 + isolation-runs + visual-regression 551s，单测 1338 pass，**零基线更新**）；
> 独立 `bash scripts/gate.sh quick` 另跑一次 `GATE RESULT: 11/11 PASS（SKIP 0）`（exit 0）；
> `openspec validate --all --strict` → `Totals: 39 passed, 0 failed (39 items)`；`docs-check` PASS；
> `node scripts/acceptance/run.mjs --check` PASS（231 个场景）；真机 230 → `结论：1/1 PASS`（60 条断言 /
> 0 失败 / 168.8s，exit 0）。
