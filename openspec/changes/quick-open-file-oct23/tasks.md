# Tasks: quick-open-file-oct23

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现
> proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。
>
> 本文件按 **D2 = 倾向侧（vault 外只读放行）** 展开。若 D2 裁另一侧，第 5 组整组删除，
> 第 1 / 2 / 4 组里带「外部」字样的子项随之删除，spec delta 按 proposal 的说明改写。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/{quick-open,keymap-commands,multi-tabs,fs-io,vault-workspace}/spec.md` / 本文件
- [ ] 0.2 Alex 节点 1 评审通过（硬门禁；五个起草期取值 D1–D5 一并裁决，**D2 是唯一改到既有安全边界的一条**）

## 1. 输入解析（纯函数 + 单测）

- [ ] 1.1 新增 `src/quick-open.ts` 的解析纯函数：`resolveQuickOpenInput(raw, ctx)`——`trim` →
      绝对路径根前缀剥离（复用 `vaultAbsolutePath` 的拼接口径）→ `./` 归一 → 整串优先 →
      剥后缀（存在性优先，D5）→ 目录判定 → 三类结果
- [ ] 1.2 后缀解析复用既有语义：把 `src/harness-path-link.ts` 的 `lineSuffixAt` 导出（或抽成
      共享纯函数模块），MUST NOT 复制 `LINE_SUFFIX`；`harness-path-link.test.ts` 的既有断言原样通过
- [ ] 1.3 大小写策略：逐字精确优先；无精确命中时折叠等值回退；折叠多命中 ⇒ 列候选（不猜）
- [ ] 1.4 单测（`tests/unit/quick-open.test.ts`）：design §2.4 的表逐行断言；另加畸形后缀
      （`:0` / `:12-` / `:40-12` / `:9-12-15` / `:12x`）、冒号文件名、`../` 拒绝、反斜杠拒绝、
      越界行号（钳制交给 revealLine，解析层不改判）
- [ ] 1.5 单测：候选过滤以**完整相对路径**为匹配对象（`filterIndices` 复用，不重测其语义）

## 2. 浮层与交互

- [ ] 2.1 新增浮层 DOM（形态照 `src/toc.ts` 的 `.lumir-toc`：输入框 + listbox + 空态 + 提示行，
      挂 `shell.modeline`，向上展开）；`aria-activedescendant` 落在持焦元素上，读屏名 / 占位
      走文案表
- [ ] 2.2 就地键：Enter（解析 / 选中打开）、Esc 与 `⌃G`（取消）、↑↓ 与 `⌃N⌃P`（游标）；
      组合期不刷新（IME）；`Tab` 不接管（留给原生焦点遍历）
- [ ] 2.3 关闭路径：Esc / `⌃G` / `focusout` 到浮层之外 / 点击浮层之外 / 成功打开后；交还焦点走
      `focusPreservingReadingPosition`（CL-1，MUST NOT 裸 `view.focus()`）
- [ ] 2.4 前台会话切换 ⇒ 收起且不打开任何东西（与 goto-line 同口径）
- [ ] 2.5 无 vault 时：命令给一行提示，MUST NOT 打开空浮层
- [ ] 2.6 候选：空查询不列全量（只给用法提示）；渲染上限 `CANDIDATE_LIMIT = 100` 且提示行显示
      命中总数；点击候选不夺焦（`mousedown` preventDefault，照 TOC）
- [ ] 2.7 重入：Enter 连按 / 存在性探测在途时改输入——请求序号丢弃过期结果；失败或过期 MUST NOT
      留下空标签

## 3. 键位与命令

- [ ] 3.1 `src/keys.ts`：新增命令 `app.quick-open` 进 `NON_TAB_GLOBAL_COMMAND_IDS`；新增默认绑定
      `Cmd-p`（scope 由 `scopeOfCommand` 派生）；**不进** `KEYLESS_COMMAND_IDS`；绑定 docKey 写来由
      （三条来源见 design §6）
- [ ] 3.2 `src/main.ts`：命令实现——已打开则收起（toggle），否则打开浮层；焦点进输入框
- [ ] 3.3 单测：`tests/unit/keys.test.ts` 的三项对账（有绑定 / 无孤儿 / 清单与表无交集）原样通过；
      `[keys]` 重绑与解绑各一条
- [ ] 3.4 真机核验 `⌘P` 不被 WKWebView / 原生菜单截获（design §6 第 3 条），失败则回报并停下等裁

## 4. 打开编排与行跳转

- [ ] 4.1 抽取装配层的行跳转 plan：把 `src/main.ts:2833` 附近的五件套（`open` / `reveal` /
      `duringTransition` / `nextFrame` / `needsRescroll`）抽成一个函数，harness 路径点击与快速打开
      共用（MUST NOT 复制第二份复核判据）
- [ ] 4.2 快速打开 → `openFile(path, openKind(path), "new")`（与树点击同落点，D4）；已打开 ⇒ 既有
      移动 / 激活
- [ ] 4.3 带行号 ⇒ `openPathAtLine`；无行号不碰视口；越界由 `revealLine` 钳制
- [ ] 4.4 打开失败：浮层保持打开、提示行给原因；MUST NOT 留空标签

## 5. vault 外只读（D2 倾向侧；裁另一侧则整组删除）

- [ ] 5.1 后端：`fs_read_external(path)` + `ExternalTextSnapshot { content }`——绝对路径 / 无 `..`
      段 / canonicalize 后必须常规文件 / 复用 `ATTACHMENT_MAX_BYTES` / UTF-8 失败复用既有错误码；
      注册进 `generate_handler!`；**不放宽** `resolve_in_vault` 的任何约束
- [ ] 5.2 后端单测：非绝对路径 / `..` / 目录 / 超限 / 非法 UTF-8 五条拒绝 + 一条正常读
- [ ] 5.3 ts-rs 重导出 `src/bindings/ExternalTextSnapshot.ts`（重导出产物先 `git add` 再跑门禁）
- [ ] 5.4 `src/ipc.ts` 新增调用；`EditorSession` 增显式 `external` 字段（创建点定死），
      `makeSession` / `reloadSession` / `remapSessionPaths` 三处可编辑性判据收敛到同一表达式
      （design §5.2 的风险点）
- [ ] 5.5 逐项不参与：保存入口早退、`save.noteOpened` 不登记、崩溃备份不写、watch 增量跳过、
      阅读位置不记、`paneSnapshot` 过滤（`src/vault-switcher.ts:131`）、`resolveBase()` 不给 from、
      `ensureMtime` 不调用
- [ ] 5.6 `openExternal(path, line)` 装配：读 → 建只读会话 → `reloadSession` → `afterLoad`；同一
      外部路径再次打开切到既有标签
- [ ] 5.7 modeline 只读段（「vault 外 · 只读」）+ 标签 `aria-label` 同句；外部图片 / 二进制给提示
- [ ] 5.8 单测 / 场景：外部标签不入 `paneSnapshot`；`⌘S` 在外部会话上无 invoke；外部会话不写
      阅读位置

## 6. 文案与视觉

- [ ] 6.1 文案取号（实现期从 master 末位顺延，核撞在途 mission）并进 `src/copy-data.ts` +
      `文案-Copy.md` 两列
- [ ] 6.2 视觉场景（chromium）：`⌘P` 开浮层 / 空态 / 命中 / 游标 / Enter 打开 / Esc 关闭且阅读
      位置不变（CL-1）；无 vault 提示；候选上限提示
- [ ] 6.3 既有整页基线：本 change 不新增色值 / 字号 / 圆角，现有场景不含外部会话 ⇒ 预期**零更新**；
      若出现任何基线差异，停下按「基线更新是人肉裁决点」报 Alex 过目后再 `--update`

## 7. 真机验收场景

- [ ] 7.1 新增 `scripts/acceptance/scenarios/<号>-quick-open.md` + 合成 fixture（深层路径文件、
      含冒号的文件名、一个外部文本文件——**全部合成，不含真实内容**）；场景号按实现时批次的分配
      （M647 已占 228、M650 占 227，本 change 预计 229 起，实现期与 tower 核一次）
- [ ] 7.2 断言：粘贴 `深层/路径.md:行` → 一次 Enter 落行；粘贴 vault 外绝对路径 → 只读打开 +
      `⌘S` 无反应 + modeline 只读段在场；重启后外部标签不回来；`⌘P` 在编辑器 / 树 / composer
      三处各按一次都能开
- [ ] 7.3 回扫既有验收场景：`grep` 所有对 `⌘P` / 快速打开 / 标签持久化标签数的期望，逐条确认
      仍然成立；`node scripts/acceptance/run.mjs --check` 通过
- [ ] 7.4 如实登记覆盖边界（候选列表的滚动手感、浮层弹出节奏归 Alex 手感裁决，不进机器判据）

## 8. 验证

- [ ] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 8.2 `bash scripts/gate.sh quick` 全绿（照抄 `GATE RESULT` 原文行 + 退出码）
- [ ] 8.3 `bash scripts/gate.sh visual` 全绿（动过浮层样式与场景，必须本地跑）
- [ ] 8.4 `bash scripts/docs-check.sh` 通过（含 MODIFIED delta 的归档对账）
- [ ] 8.5 信息卫生清扫：新增 fixture / 场景 / 文档对改动面做一次 text 级 grep，真实 vault 内容、
      真实路径、真实人名零命中
