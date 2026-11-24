# Tasks: add-wikilink-suggestion-nov24

> 节点 1 未通过前不得实现。`openspec/specs/**` 活跃期只读；规格变更只写本 change 的 delta。与 `fix-wikilink-caret-reveal-nov24` 按真实文件冲突排程，分别独立验收与归档。

## 1. 纯逻辑与合同测试

- [ ] 1.1 新增 `src/link-suggest.ts` 纯逻辑层：当前行触发 / 关闭判定、完整既有链接、代码 / frontmatter / 只读 / embed 排除；opener 与 head 的 lezer `Link` / `Image` 上下文（含未闭合 label / alt）均排除。
- [ ] 1.2 复用 `vaultFilePaths`、`list-filter` 与 `foldCase`，按 Rust `is_markdown` 的 `.md` 后缀过滤，明确拒绝 `.markdown` 与 `fileClassOfPath` 的较宽全集；实现去重、四层稳定分桶、100 上限与零命中。
- [ ] 1.3 按 design §3 实现完整路径含实际扩展名的接受证书：非根精确路径、根文件精确文件名唯一、可表示性与接受时复核；无证书不提供接受。
- [ ] 1.4 建立真实 Rust fixture 组合矩阵：`.markdown`、`foo.md` / `foo.md.md`、`a/note.md` / `a/note.MD`、根 / 子目录精确同名、folded 变体、Unicode；逐项断言 `resolved && path === P` 或不可接受零插入，并证明旧算法会失败。

## 2. 编辑器与浮层装配

- [ ] 2.1 在 md 编辑器装 ViewPlugin 与同步索引注入口；编辑器持焦，索引 watch 后下一次允许刷新的输入重算且不按旧行号错位，接受时重新证明证书。
- [ ] 2.2 Enter 接入既有 `markupKeymap`，↑↓ / ⌃N/P 接入既有光标命令内分派，Escape 注册 escape-router；Tab 不接管，不新增物理键绑定。
- [ ] 2.3 复用 / 提取列表 composition settle 的 pending MutationRecord flush 与组合标志等待，结束后重读最终 state 只刷新一次；handler 不同步 dispatch，`isComposing` / keyCode 229 不消费。
- [ ] 2.4 实现主键行 `mousedown preventDefault` 接受、点击外部 / 失焦 / 切标签 / 切 vault / 滚出视口关闭；除证书有效的接受外文档零写入。
- [ ] 2.5 用 `placeOverlay` list 档与现有 token 实现不透明浮层和 Quick Open 同款行几何；将新滚动容器登记到原生 overlay 豁免档。

## 3. 验收场景

- [ ] 3.1 新增 unit / lezer visual 矩阵：触发、过滤分层、去重、Unicode、不可表示路径、标准 `Link` / `Image` 与未闭合 label / alt 的触发和接受负例。
- [ ] 3.2 新增 visual 场景：键鼠接受、方向键、Escape、Tab、焦点、关闭路径、接受前证书失效、三主题不透明度、几何与文档不变；接受后 caret 在 `]]` 外，独立验收不依赖 A。
- [ ] 3.3 增加 compositionend 时 state 暂旧的区分度测试：pending flush 前不按旧 query 刷新、不 dispatch，flush 后最终 query 只刷新一次。
- [ ] 3.4 新增或更新真机验收场景，覆盖 WKWebView 下候选完整流程与浮层不裁切；证据落 `.local/acceptance/`。
- [ ] 3.5 增加 1MB 文档 / 万文件索引的键入性能读数，确认无全文档扫描且满足既有 keypress-to-paint 预算。

## 4. 验证与归档

- [ ] 4.1 前端 unit、相关 visual、性能检查与 `scripts/gate.sh visual` 通过；不未经 Alex 过目更新像素基线。
- [ ] 4.2 真机验收场景通过；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [ ] 4.3 独立 reviewer clean/merge、节点 2 五要件与归档跟踪记录齐备后独立归档；提交归档结果且 `--archived add-wikilink-suggestion-nov24` PASS，不设置 A 的归档先后门禁。
