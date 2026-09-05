# Proposal: wikilink 跳转——Rust 单实现解析、未创建链接、backlinks 只读面板

- Change ID: add-wikilink
- 日期: 2026-09-05
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

M1 内容清单含 wikilink 跳转（[ADR 0004 §1](../../../docs/adr/0004-development-and-openness-strategy.md)），其前置任务"冻结 wikilink spec + 按冻结 spec 合成 fixture 集"（ADR 0003 §4）已完成：冻结 spec 在 [docs/specs/wikilink/link-semantics.md](../../../docs/specs/wikilink/link-semantics.md)（下称"链接语义 spec"），合成 fixture 在 [tests/wikilink-fixtures/](../../../tests/wikilink-fixtures/)。本 change 按冻结 spec 实现解析、跳转与链接图。

架构裁决在先：link graph 在 Rust core（[ADR 0002 §3](../../../docs/adr/0002-technical-route.md)）；架构复查 P1-4 进一步要求 wikilink 语义解析只有一份实现（Rust link_graph），前端只做装饰定位——双解析器会在 Obsidian 方言的长尾上必然漂移。本提案把该纪律落成可验收的 requirement。

## What Changes

新增三个 capability：`wikilink-resolution`、`wikilink-navigation`、`backlinks-panel`。

1. **Rust 单实现解析**（`wikilink-resolution`）：在 `link_graph` 模块（现为占位骨架）实现链接语义 spec §2–§5 的词法与解析：wikilink 识别（code/frontmatter 内不识别）、target 分解（alias/heading path/块引用标记）、名称→路径解析（根相对精确路径 → 短路径候选集，大小写不敏感，歧义按裁决点 G）、标题锚点逐段下钻（裁决点 H）、`![[...]]` 双语义判别。名称→路径索引随 vault 打开建立、随 `fs:entry_changed` 增量维护（复用 add-vault-workspace 的 watch 事件流）。对前端暴露 invoke contract：`link_graph_resolve`（单条链接解析，装饰与跳转用）、`link_graph_backlinks`（反链查询，backlinks 面板用）、`wikilink_create`（未创建链接一键创建）。
2. **跳转与链接显示**（`wikilink-navigation`）：md 模式装饰层在视口内做链接 span 定位（只做词法范围识别，断言语义一律经 `link_graph_resolve` 取 Rust 结果），按解析三态显示（正常 / 歧义带标识 / 未创建）；点击与键位跳转到目标文件并定位标题行；锚点缺失时打开文件并提示"标题未找到"。键位走既有 keys.ts Keymap，**chorded 非 modal**（ADR 0001 §4）：注册 `Mod-Enter`（跳转光标/点击处链接）与鼠标 `Mod-Click`，具体 chord 在实现期定稿，不引入 mode。
3. **未创建链接显示与一键创建**（`wikilink-navigation` + `wikilink-resolution`）：`unresolved` 链接区分显示（spec §4.1），提供一键创建入口；创建经 `wikilink_create` 在当前文件所在目录（当前文件在 vault 根时建于根；target 自带 `/` 路径时按 vault 根相对路径并补齐中间目录）建空文件（裁决点 I，已定稿），创建后重解析转为正常链接。铁律约束：只创建新文件，MUST NOT 改写任何既有文件（ADR 0003 §3）。
4. **backlinks 只读面板**（`backlinks-panel`）：当前文件的反链列表（来源文件 + 行级上下文），点击跳转来源位置；数据来自 `link_graph_backlinks`，面板只读。**⚠ 可推迟标注**：ADR 0004 §2 挤压预案明确 backlinks 可推迟——若实现期时间受挤压，本 capability 整组任务可标注放弃原因后随节点 2 评审归档，不阻塞其余两项。

**裁决点 G——短路径歧义选取规则**（2026-09-05 Alex 裁决：按推荐值定稿）：候选按相对路径段数最少优先，并列取字典序第一；选中的 `chosen` 参与跳转但链接带歧义标识与候选列表。备选（已否决）：Obsidian 式"最短路径优先"且不给歧义标识。

**裁决点 H——标题锚点大小写**（2026-09-05 Alex 裁决：按推荐值定稿）：大小写敏感精确匹配。备选（已否决）：大小写不敏感。文件名匹配的大小写不敏感（spec §3.1）不在裁决范围——那是 Obsidian 方言的既定行为（[官方论坛](https://forum.obsidian.md/t/maintain-casing-of-text-when-using-link-autosuggestion/23041)）与文件系统现实。

**裁决点 I——未创建链接的创建位置**（2026-09-05 Alex 改判定稿）：**当前文件所在目录**（当前文件在 vault 根时建于根），非推荐值"一律建于 vault 根"；target 含 `/` 路径时仍按 vault 根相对路径创建并补齐中间目录；内容为空文件。Obsidian 对此有设置项，本提案不引入设置。

裁决点已全部定稿并同步落地：spec 升至 v1.1，fixture 的 `pendingDecision` 标记全部移除（G/H 期望不变），并新增 `createCases` 锁定一键创建行为（spec §7 修订纪律）。

## Non-goals

- 不做内容嵌入（`![[note]]` transclusion）递归渲染、块引用 `[[note#^block]]`、Dataview、Canvas、插件语义（ADR 0003 §2 声明不做）；`![[...]]` 解析到笔记时显示"内容嵌入不支持"占位（链接语义 spec §5）。
- 前端不复制解析语义（架构复查 P1-4）：span 定位之外的任何语义判断 MUST NOT 出现在 webview 层。
- 不做链接自动补全、链接重命名时的反向改写（写操作超出 M1 只读范围，铁律）；不做 frontmatter 内链接提取（spec §2.3）。
- 不改动 attachment-display 的渲染语义；但其临时解析口径（add-editor-live-preview 裁决点 F 的"唯一匹配 + 歧义从简"）被本 change 的 `link_graph_resolve` 统一取代——归档时按合并顺序协调两份 change 的 spec 增量（living spec 以链接语义 spec 为最终口径）。
- 不做标准 Markdown 链接 `[text](path)` 的跳转（非 wikilink 语法，独立 change 候选）。

## Impact

- 影响的 specs：新增 capability `wikilink-resolution`、`wikilink-navigation`、`backlinks-panel`。
- 影响的代码/系统：`src-tauri/src/link_graph.rs`（占位骨架充实为解析器 + 索引 + 反链查询）、`src-tauri/src/commands.rs`（新增 `link_graph_resolve` / `link_graph_backlinks` / `wikilink_create`，payload 类型经 ts-rs 单一来源导出）、`src-tauri/src/lib.rs`（装配 vault 打开/事件流接入索引维护）；前端 `src/preview/`（wikilink 装饰与三态显示）、`src/ipc.ts`（薄封装）、`src/keys.ts`（注册 chord）、`src/tree.ts`/`src/main.ts`（跳转打开文件接线、backlinks 面板挂载）。测试：Rust 单测跑 `tests/wikilink-fixtures/cases.json` 全部用例；前端 span 定位测试跑 parseCases 的 span 断言。
- 关联约束：ADR 0003 §1（兼容范围）、§2（不做清单）、§3（铁律：一键创建只建新文件）、§4（spec + fixture 为兼容性本体）；ADR 0002 §3（link graph 在 Rust core）、§6（性能合同：装饰定位沿用视口增量纪律）、§7（图结构不耦合 UI 层）；ADR 0001 §4（键位 chorded 非 modal）；ADR 0004 §2（backlinks 挤压预案）；架构复查 P1-4（单实现解析）。
