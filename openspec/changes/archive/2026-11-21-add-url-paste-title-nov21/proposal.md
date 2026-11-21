# Proposal: 粘贴 URL 自动取网页标题

- Change ID: `add-url-paste-title-nov21`
- 日期: 2026-11-21
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**通过**——来源是 Alex 2026-11-21 需求批里的原始需求「贴 URL 自动提取
> 标题（成功 `[title](url)`，失败保留 URL）」，并以「请你继续」批准推进；本提案按这条原话的
> 最小读法落地，实现期未新增其它产品行为。
> 节点 2（归档放行）：**机器 + 独立评审放行**（[openspec-workflow.md](../../../../docs/process/openspec-workflow.md)
> 「节点 2：归档默认由独立评审 + 机器判据放行」五要件），逐条事实与证据指针见下「节点 2 记录（归档前）」。

## 节点 2 记录（归档前，2026-11-21）

口径见 [openspec-workflow.md](../../../../docs/process/openspec-workflow.md)「节点 2」，五要件逐条：

1. **方案已批准**：节点 1 于 2026-11-21 通过——Alex 原始需求「贴 URL 自动提取标题（成功
   `[title](url)`，失败保留 URL）」+「请你继续」批准推进（见上方「评审记录」）。实现期没有静默扩
   scope：产品增量严格对应「What Changes」三条（`src/paste-url.ts` / `src/editor.ts` /
   `src/main.ts` / `src/ipc.ts` / `src-tauri/src/url_title.rs` / `commands.rs` / `lib.rs`），
   另有归档前发现的 `fetch_url_title` 阻塞调用线程语义修复（`ddf91773` 的 `spawn_blocking`），
   属同一命令的实现缺陷修复、不改行为约定。
2. **独立 reviewer clean / merge**：独立 reviewer agent-36 判 `clean/merge`，无 P1 / P2 findings，
   绑定 integration tip `7d632e03e09fa11aa50f298d43db8d76c33aedc9`；评审文件
   `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/editing-batch-nov21/review-final.md`
   （含「`ddf91773` 的 spawn_blocking 修复」已在评审面内）。评审时 integration tip 为
   `7d632e03e09fa11aa50f298d43db8d76c33aedc9`；归档分支自该 tip 之后仅文档变化（无产品代码增量）。
3. **tasks 完成**：`tasks.md` 16/16 全勾（`grep -c '^- \[x\]'` = 16，未勾项 0），无放弃项。
4. **要求的门禁与真机证据**：动过 `tests/visual/scenes/**`（新增 `url-paste-title.spec.ts`），
   按 `scripts/gate.sh visual` 档取读数——`GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0。
   真机场景 `269-url-paste-and-cjk-boundary-nov21` PASS（18 断言，0 FAIL；`status.txt` = `PASS`），
   证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-21-requirements-batch/269-url-paste-and-cjk-boundary-nov21/`
   （`steps.md` / `shots/` / `ax/`）。解析成功与失败保留 URL 两段均由该场景覆盖；网络失败段用
   `.invalid` 域名，成功段用本机 loopback server。
5. **规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS——`扫过
   15 份 delta，14 条 MODIFIED，对比 275 段，无静默丢段；归档队列 3 项已完成 change 均有唯一条目`
   （退出码 0）；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `Totals: 42
   passed, 0 failed (42 items)`（退出码 0）。归档跟踪队列有且仅有一条本 change 条目
   （`docs/backlog.md`）。delta 是**新 capability** `url-paste` 的 2 条 ADDED，不是纯目录移动；
   归档后须手写 living spec 的 Purpose（`archive` 会写占位 `TBD`）。

未命中「必须找 Alex 的例外类别」：无未决的价值 / 行为裁决、无审美手感项、无影响面升级、评审结论与
tip 均无异常、证据无缺口，故不另送 Alex。

## 节点 2 记录（归档后，2026-11-21）

- **归档提交**：`94b5ed6a23552bd64d9ddc2c4b86e9031eafe93d`（归档目录 + 并入后的 living spec +
  `docs/backlog.md` 队列条目核销同一提交；本段记录本身是其后一笔文档提交，审计仍定位该归档提交）。
- **`openspec archive` 实际输出**（`node scripts/openspec-archive.mjs add-url-paste-title-nov21`，
  包装器内调 `npx --yes @fission-ai/openspec@1.12.0 archive add-url-paste-title-nov21 --yes`，
  退出码 0）：`Task status: ✓ Complete` / `Specs to update:` / `url-paste: create` /
  `+ 2 added` / `Totals: + 2, ~ 0, - 0, → 0` / `Specs updated successfully.` /
  `Change 'add-url-paste-title-nov21' archived as '2026-11-21-add-url-paste-title-nov21'.`。
  新 capability，故不是 `Specs already in sync; no files changed`。
- **新 capability Purpose**：`openspec/specs/url-paste/spec.md` 的占位
  `TBD - created by archiving change …` 已手写替换为 capability 用途说明（粘贴 URL 取标题通道、
  失败保留 URL、接管边界），随后与归档结果同提交。
- **归档后修链**：`归档后修链 2 处（扫过 4 篇 Markdown / 3 条相对链接）`——
  `proposal.md:11` 与 `proposal.md:16` 的 `../../../docs/process/openspec-workflow.md` →
  `../../../../docs/process/openspec-workflow.md`。包装器末置门禁
  `openspec-links: PASS（校验 642 条相对链接，全部可达）`。
- **归档后审计**（`node scripts/openspec-archive-check.mjs --archived
  add-url-paste-title-nov21`，2026-11-21T14:29Z，退出码 0）：
  `INFO url-paste：归档提交前没有 living spec（新建 capability），无基线可对账` /
  `PASS（openspec/changes/archive/2026-11-21-add-url-paste-title-nov21：0 条 MODIFIED，对比 0 段；
  人工恢复 0 段，声明认领 0 段）`。
- **归档后复跑读数**：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` →
  `Totals: 42 passed, 0 failed (42 items)`（退出码 0）；`node scripts/openspec-archive-check.mjs`
  门禁模式 → PASS（`扫过 15 份 delta，14 条 MODIFIED，对比 275 段，无静默丢段；归档队列 2 项已完成
  change 均有唯一条目`）；`bash scripts/docs-check.sh` → `docs-check: PASS`（退出码 0）。

## Why

### 需求来源（Alex 原话，逐字保留）

> 「贴 URL 自动提取标题（成功 `[title](url)`，失败保留 URL）」

这是 2026-11-21 已下达的需求批中的一条；需求来源为先于本提案的产品裁决，不是 agent 自行发现的
改进项。

### 现状与缺口

现在粘贴一个 URL 只是把 URL 原文插进正文。用户想把它变成可读链接时，得自己去网页复制标题再手写
`[标题](URL)`。本 change 把这一步自动化：URL 先按普通粘贴落地，标题在后台取回后原地升级成
`[title](url)`；取不到就什么都不做，保留 URL——**失败不是错误态**，粘贴本身已经成功。

### 关键约束

- **不能吞文本 / 不能延迟落地**：网络可能慢 / 失败；文档必须先出现 URL，不能等标题返回才插入。
- **不能写坏位置**：用户在等待期间继续编辑，异步返回的改写只能落在「仍是当初那段 URL」的区间；
  区间随事务映射，区间内被编辑就放弃。
- **标题是纯文本**：网页标题不可信，不能把 `<b>`、`[x](url)`、`|`、`$` 等原样写进链接标签变成
  HTML / 第二条链接 / 表格 / 公式；转义规则要有机器判据。
- **不抢别的粘贴**：图片 / 文件 / HTML-only / 已有 Markdown / 非空选区 / code 模式都不归本能力。
- **网络能力在 Rust**：webview 不直接发网络请求（ADR 0002 第 3 条）；`reqwest` 已在依赖树里
  （harness 用），本 change 复用，不新增第三方依赖。

## What Changes

1. **新 capability `url-paste`：粘贴 URL 自动取标题（ADDED 两条 requirement）**
   - 成功：URL 先落地，异步取标题后原地变为 `[title](url)`；失败 / 超时 / 非 2xx / 非 HTML /
     无标题 / 空标题 / 超长标题一律保留 URL。
   - 标题纯文本转义；空选区 + md + 可编辑 + 整段单个 http(s) URL 才接管。
2. **Rust 侧新增 `fetch_url_title` command**：5 秒超时、只认 http(s)、只读 2xx、`Content-Type`
   必须存在且 media type 精确为 `text/html` / `application/xhtml+xml`、正文 512 KiB、UTF-8、
   标题 500 字符；HTML 标题提取是纯函数、可离线单测。
3. **前端新增 `src/paste-url.ts` 纯判据 + `EditorHandle.setPasteUrlTitlePort`**；装配层
   `src/main.ts` 注入 `ipc.fetchUrlTitle`；异步区间用 `StateField` 随事务映射。

## Non-goals

- 不做标题缓存 / 预取 / 后台抓取；一次粘贴只对用户明确粘贴的那个 URL 请求一次。
- 不把标题写进文件名、不修改 URL、不生成引用块或卡片。
- 不接管非空选区（保留 CM 既有粘贴语义）、不接管图片 / 文件 / HTML-only / code 模式 / 只读。
- 不支持 `mailto:` / `file:` / `javascript:` / `www.` / 裸邮箱；只认 http(s)。
- 不引入 HTML 解析库、`encoding_rs` 或新 HTTP 客户端；不执行 JS、不解析完整 DOM。
- 不新增用户可见的「取标题失败」toast / 状态；失败静默保留 URL。

## Impact

- 影响的 specs：新增 `url-paste`。
- 影响的代码：`src/paste-url.ts`（新）、`src/editor.ts`（paste 分支 / 端口 / StateField）、
  `src/main.ts`（端口注入）、`src/ipc.ts`（command 包装）、`src-tauri/src/url_title.rs`（新）、
  `src-tauri/src/commands.rs` 与 `src-tauri/src/lib.rs`（command 注册）。
- 测试：`tests/unit/paste-url.test.ts`（新）、`tests/visual/scenes/url-paste-title.spec.ts`（新）、
  真机场景 `269-url-paste-and-cjk-boundary-nov21` 的 B / C 段。
- 关联约束：ADR 0002 第 3 条（Rust core 承担网络）、ADR 0003 §3（粘贴是用户动作，允许改文档，
  但不改写用户已有内容）；不新增依赖、不更新视觉基线。
