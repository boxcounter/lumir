# Proposal: 补记文件内搜索（v0）的功能规格

- Change ID: add-in-file-search
- 日期: 2026-09-17
- 角色: Alex Lee（评审/裁决），AI agent（起草）
- 制品性质: **补记（retro）change**——实现先于规格落地，本 change 把已发布行为倒推为 living spec

## Why

文件内搜索 v0 由 M139 实现并合入（`feat/infilesearch`，merge `647f519`，2026-09-16；能力与 panel 在 `src/search.ts`，⌘F 走 `src/keys.ts` 的统一键位层，装配在 `src/main.ts`），但**没有走 OpenSpec 流程**：仓内既无该功能的提案，也无对应 living spec——搜索能力至今只在实现、`docs/backlog.md` 的核销条目与真机场景 `search-01-find` / `search-02-binding` 里有记录。

后果是能力与意图层的唯一防线（ADR 0004 第 5 条：功能做什么归 OpenSpec，Alex 不看代码即可裁决）在这条能力上失效：改搜索行为时没有可评审的「做什么」基线，也不能凭 living spec 判断某次改动是否越出既有口径。本 change 按实现现状补出规格，使后续任何搜索行为变更都落在既有 spec 的增删改上。

事实依据：`src/search.ts`（v0 能力集与已知边界写在文件头）、`src/keys.ts:157`（`app.search-open` 进 `GLOBAL_COMMAND_IDS`）与 `src/keys.ts:294`（⌘F 绑定与来由）、`src/search-panel.css`（panel 视觉）、真机场景 `scripts/acceptance/scenarios/search-01-find.md` / `search-02-binding.md`。

## What Changes

新增 capability `in-file-search`，把 v0 已发布的行为写成 requirement（内容与实现一致，不引入新行为）：

1. **打开入口与键位**：命令 `app.search-open`（`⌘F`，作用域 `global`），进统一键位表与 `GLOBAL_COMMAND_IDS`，可由 `[keys]` 重绑或解绑、在 `⌘/` 面板可见；面板打开态再按 `⌘F` 把焦点与选区移回输入框。
2. **能力集**：查找（输入即生效，不等回车）、全匹配高亮、上一个 / 下一个、大小写切换、匹配计数（当前/总数，上限 1000 时报下界）；**不做替换**（v1 有意留白，官方 replace 实现无入口）。
3. **关闭与焦点**：`Escape` / `⌃G` / 关闭按钮三条路径关闭面板并把焦点交还编辑器；面板内键位就地消费、不进统一键位表。
4. **只读性**：搜索全程 MUST NOT 改写文档或触发保存链路。

已知边界（如实记录，不作为 requirement 的承诺面）：高亮只覆盖视口（计数仍是全文档）；匹配落在被 replace widget 替换掉的源码上时无可见高亮，`findNext` 仍把选区移过去。

## Non-goals

- 不做替换 / 全部替换：面板不放替换字段，无替换入口（v1 有意留白）。
- 不做正则、整词、跨文件搜索与结果列表（正则与整词的 `SearchQuery` 字段存在但无面板入口，本 change 不为它们背书）。
- 不做搜索历史、高亮配色配置、多标签跨文件检索。
- 不改既有的 `@codemirror/search` 能力底座选型，不改 panel 视觉语言（M139 已落地，本 change 只补规格）。

## Impact

- 影响的 specs：新增 capability `in-file-search`。
- 影响的代码/系统：无代码改动——本 change 是补记，实现已在 `src/search.ts` / `src/keys.ts` / `src/main.ts` / `src/search-panel.css`。
- 关联约束：ADR 0002 §6（keypress-to-paint 路径不得引入全文档同步扫描的额外开销——计数与高亮走官方扩展的既有实现）、ADR 0003 §3（搜索是只读操作，不改写源文件）、ADR 0001 §4（键位走统一键位表、chorded 非 modal）。
