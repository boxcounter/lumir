# Proposal: 裸 URL 后紧邻的中文不进入链接目标

- Change ID: `fix-bare-url-cjk-boundary-nov21`
- 日期: 2026-11-21
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

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

- 裸 URL（没有定界符的形态 2）的目标在**首个非 ASCII 字符之前**结束；中文 / 全角标点 / 其它
  非 ASCII 字符是正文，不进入目标、装饰、`title` 或打开路径。
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
   （整条 requirement 复制后改）：新增「裸 URL 的文本边界」段——目标在首个非 ASCII 字符前结束；
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
