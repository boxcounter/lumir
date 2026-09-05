# Tasks: add-wikilink

> 正常循环：实现未开始，全部任务未勾选。经 Alex 提案评审（节点 1）通过后才进入实现；裁决点 G/H/I 的裁决结果落地为 spec 与 fixture 的最终口径。

## 1. Rust 单实现解析（wikilink-resolution）

- [ ] 1.1 `link_graph` 实现 wikilink 词法（链接语义 spec §2）：识别 `[[...]]` / `![[...]]`，code/inline code/frontmatter 内不识别，alias/heading path/块引用分解，非法形态剔除
- [ ] 1.2 名称→路径索引（spec §3.1–§3.2）：vault 打开时建立，根相对精确路径 → 短路径候选集，大小写不敏感，歧义按裁决点 G 排序取 chosen
- [ ] 1.3 标题锚点逐段下钻（spec §3.3，大小写口径按裁决点 H）；`![[...]]` 双语义判别（spec §5）
- [ ] 1.4 索引随 `fs:entry_changed` 增量维护（复用 add-vault-workspace watch 事件流），重建/增量的确定性由 fixture 回归保证
- [ ] 1.5 invoke contract：`link_graph_resolve`、`link_graph_backlinks`、`wikilink_create`；payload 类型 ts-rs 单一来源导出，错误走 CommandError 信封
- [ ] 1.6 `wikilink_create`：当前文件所在目录创建空文件（当前文件在 vault 根时建于根；target 自带 `/` 路径时按 vault 根相对路径并补齐中间目录；裁决点 I 已定稿），MUST NOT 覆盖或改写既有文件，创建后重解析
- [ ] 1.7 Rust 单测跑 `tests/wikilink-fixtures/cases.json` 全部 parseCases 解析字段、resolveCases 与 createCases（裁决点 G/H/I 已定稿，全部期望为硬断言）

## 2. 跳转与链接显示（wikilink-navigation）

- [ ] 2.1 md 模式装饰层做链接 span 定位（视口增量，沿用 live preview 装饰层纪律）；只定位词法范围，语义经 `link_graph_resolve` 取 Rust 结果
- [ ] 2.2 三态显示：正常 / 歧义（标识 + 悬停候选列表）/ 未创建（spec §4.1）
- [ ] 2.3 跳转：打开目标文件并定位标题行；锚点缺失时打开文件并提示"标题未找到"（spec §4.2）
- [ ] 2.4 键位：keys.ts Keymap 注册 chorded 非 modal 快捷键（如 `Mod-Enter` 跳转）+ `Mod-Click`（ADR 0001 §4）
- [ ] 2.5 未创建链接一键创建交互：触发 `wikilink_create`，成功后链接转为正常态
- [ ] 2.6 前端测试：span 定位断言 parseCases 的 span/embed（双解析器纪律——前端不复制解析语义）

## 3. backlinks 只读面板（backlinks-panel）

- [ ] 3.1 反链面板：当前文件的来源文件 + 行级上下文列表，数据来自 `link_graph_backlinks`，只读
- [ ] 3.2 点击反链跳转来源文件对应位置
- [ ] 3.3 （可推迟标注）若实现期时间受挤压，按 ADR 0004 §2 挤压预案将 3.1–3.2 标注放弃原因后随节点 2 评审归档，不阻塞第 1、2 组

## 4. 提案评审（节点 1）

- [x] 4.1 Alex 评审通过（2026-09-05）：裁决点 G/H 按推荐值、I 改判为当前文件所在目录创建；Non-goals、backlinks 可推迟标注均确认
- [x] 4.2 裁决结果落地（2026-09-05）：G/H/I 按裁决值修订链接语义 spec（升 v1.1）与 fixture（`pendingDecision` 标记全撤、新增 createCases），spec 与 fixture 保持同步

## 5. 验证

- [ ] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 5.2 fixture 双解析器纪律验收：Rust 单测全绿（含 resolveCases），前端 span 定位测试全绿（parseCases），两侧消费同一 cases.json
- [ ] 5.3 用作者真实 vault 验收：`[[note]]` 跳转、`[[note#heading]]` 标题定位、未创建链接显示与一键创建、backlinks 面板（若未推迟）可见；perf.yml 与视觉门禁不回归
