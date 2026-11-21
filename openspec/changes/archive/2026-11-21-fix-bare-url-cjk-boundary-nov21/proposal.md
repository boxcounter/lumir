# Proposal: 裸 URL 后紧邻的中文不进入链接目标

- Change ID: `fix-bare-url-cjk-boundary-nov21`
- 日期: 2026-11-21
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**通过**——来源是 Alex 2026-11-21 需求批里的原始需求「裸 URL 后中文字符
> 误纳入链接」，并以「请你继续」批准推进；本提案按这条原话的最小读法落地，实现期未新增其它
> 产品行为。
> 节点 2（归档放行）：**机器 + 独立评审放行**（[openspec-workflow.md](../../../../docs/process/openspec-workflow.md)
> 「节点 2：归档默认由独立评审 + 机器判据放行」五要件），逐条事实与证据指针见下「节点 2 记录（归档前）」。

## 节点 2 记录（归档前，2026-11-21）

口径见 [openspec-workflow.md](../../../../docs/process/openspec-workflow.md)「节点 2」，五要件逐条：

1. **方案已批准**：节点 1 于 2026-11-21 通过——Alex 原始需求「裸 URL 后中文字符误纳入链接」+
   「请你继续」批准推进（见上方「评审记录」）。实现期没有静默扩 scope：唯一产品改动是
   `src/preview/links.ts` 的 `literalLinkOfNode` 裸 URL 边界与 `literalLinkAt` 拒绝边界之后的位置，
   对应「What Changes」那一条 MODIFIED；未改 GFM 解析器、未 fork `@lezer/markdown`、未改写源码。
2. **独立 reviewer clean / merge**：独立 reviewer agent-36 判 `clean/merge`，无 P1 / P2 findings，
   绑定 integration tip `7d632e03e09fa11aa50f298d43db8d76c33aedc9`；评审文件
   `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/editing-batch-nov21/review-final.md`。
   当前分支 tip 与该评审 tip 相同；评审结论明记「评审后仅基线、验收场景和光标测试变化，无产品代码
   增量」，delta 自评审后未再改动。
3. **tasks 完成**：`tasks.md` 10/10 全勾（`grep -c '^- \[x\]'` = 10，未勾项 0），无放弃项。
   其中 2.4 记录的两条 `render-link` 整页像素差异属环境级字形差异；本机 CJK 渲染基线后经 Alex
   「允许」重截（集成批 `b514d015`，含 `render-link-bare-url` / `render-link` 两张），基线更新
   是人肉裁决点、已获准，不改变本 change 的 delta 与行为。
4. **要求的门禁与真机证据**：动过 `tests/visual/scenes/**`（新增 `url-cjk-boundary-nov21.spec.ts`），
   按 `scripts/gate.sh visual` 档取读数——`GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0（含整页 /
   元素像素层，基线为 Alex 已过目的 `b514d015`）。真机场景
   `269-url-paste-and-cjk-boundary-nov21` 的 A 段 PASS；整场景 18 断言、0 FAIL（`status.txt` =
   `PASS`），证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-21-requirements-batch/269-url-paste-and-cjk-boundary-nov21/`
   （`steps.md` / `shots/` / `ax/`）。
5. **规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS——`扫过
   15 份 delta，14 条 MODIFIED，对比 275 段，无静默丢段；归档队列 2 项已完成 change 均有唯一条目`
   （退出码 0）；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `Totals: 42
   passed, 0 failed (42 items)`（退出码 0）。归档跟踪队列有且仅有一条本 change 条目
   （`docs/backlog.md`）。delta 是 1 条 MODIFIED（整条复制 living 后加「裸 URL 的文本边界」段），
   是真实增量，不是纯目录移动。

未命中「必须找 Alex 的例外类别」：视觉基线更新已单独获 Alex「允许」，无未决的价值 / 行为裁决、
无影响面升级、评审结论与 tip 均无异常、证据无缺口，故不另送 Alex。

## Why

### 需求来源（Alex 原话，逐字保留）

> 「裸 URL 后中文字符误纳入链接」

这是 2026-11-21 已下达的需求批中的一条；需求来源为先于本提案的产品裁决，不是 agent 自行发现的
改进项。

### 现象

正文里写 `https://example.invalid/abc中文说明`，链接层把 `中文说明` 一起算进链接目标：
`↗︎` 尾标落在中文之后，⌘⏎ / ⌘-Click 打开的是带中文的整串。用户的原意通常是「URL 到此为止，
后面是中文正文」——中文被当成 URL 的一部分既改变打开目标，也让装饰覆盖到正文。

### 机制（已实测）

GFM 的 `Autolink` 扩展用 `urlRE = /[\w-]+(\.[\w-]+)+(:\d+)?(\/[^\s<]*)?/gy` 取 URL，路径段是
`[^\s<]*`：除空白与 `<` 之外一律吞入。因此中文、全角标点（`，` / `。`）以及中文后的后续字符都会
进入 `URL` 节点（实测：`https://example.invalid/abc中文，后续` 整段是一个 `URL` 节点）。前端
`src/preview/links.ts` 的 `literalLinkOfNode` 直接取节点区间，装饰与激活因此一起错。

### 现有合同与边界

living spec「标准 Markdown 链接的形态分类与 live preview 渲染」只规定裸 URL 取自 GFM 的
`Autolink`，**没有**规定中文路径 / 查询的语义。本 change 因此明确一条可执行边界：

- 裸 URL（没有定界符的形态 2）的目标在**首个 CJK / 全角字符之前**结束；CJK 字符（Han / 假名 / 谚文等）
  与全角字符是正文，不进入目标、装饰、`title` 或打开路径。
- **其它 Unicode 不裁**：café、西里尔、希腊等非 CJK Unicode 路径仍是合法 URL，完整保留；
  本 change 不是把裸 URL 收窄成 ASCII-only。
- **显式 URL 语法不裁**：角括号自动链接 `<https://…/中文>` 与定义行 `[home]: https://…/中文`
  有定界符，中文可以是 URL 的一部分，保持完整目标。
- **百分号编码的中文是 ASCII**（`%E4%B8%AD`），完整保留；这是中文路径 / 查询的受支持形态。
  裸中文与百分号编码的取舍写进 spec，MUST NOT 由实现各自猜。

### 为什么现在做

它是本批两条 URL 编辑需求之一；`paste-url-title` 的成功路径会把 URL 变成标准链接（不受本边界
影响），失败路径保留裸 URL——两条需求同一批落地，边界必须一次说清，避免失败路径与成功路径对
「中文算不算 URL」给出相反答案。

## What Changes

1. **`editor-live-preview` 的「标准 Markdown 链接的形态分类与 live preview 渲染」MODIFIED**
   （整条 requirement 复制后改）：新增「裸 URL 的文本边界」段——目标在首个 CJK / 全角字符前结束；
   显式语法与百分号编码的例外；边界只在链接层实现一次（装饰与激活共用 `literalLinkOfNode`）。
   新增 scenario「裸 URL 后紧邻中文时中文不进入链接」。

## Non-goals

- 不改 GFM 解析器 / 不 fork `@lezer/markdown`：语法树仍产出原 `URL` 节点，收窄在链接层完成。
- 不改标准链接 `[title](target)`、角括号自动链接、链接定义行的任何既有语义。
- 不把裸中文路径 / 查询自动转成百分号编码，也不改写文档源码。
- 不处理中文域名（raw IDN host）：GFM 的 host 词法本来就不接受非 ASCII，本 change 不扩这个面。
- 不动 `harness` 转写面的 Markdown 渲染（它有自己的解析器与链接入口，不属于编辑器正文）。

## Impact

- 影响的 specs：`editor-live-preview`（MODIFIED 一条 requirement）。
- 影响的代码：`src/preview/links.ts`（边界与区间）；测试 `tests/unit/literal-link.test.ts`、
  新增 `tests/visual/scenes/url-cjk-boundary-nov21.spec.ts`；真机场景
  `scripts/acceptance/scenarios/269-url-paste-and-cjk-boundary-nov21.md`。
- 关联约束：ADR 0003 §3（装饰不改文档）；ADR 0002 §6（链接判定走语法树，不在键入路径新增
  全量解析）。不新增依赖、不更新视觉基线。
