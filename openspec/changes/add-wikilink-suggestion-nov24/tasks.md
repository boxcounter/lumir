# Tasks: add-wikilink-suggestion-nov24

> 节点 1 未通过前不得实现。`openspec/specs/**` 活跃期只读；规格变更只写本 change 的 delta。前置 `fix-wikilink-caret-reveal-nov24` 必须先完成归档提交与 `--archived` PASS。

## 1. 纯逻辑与合同测试

- [ ] 1.1 新增 `src/link-suggest.ts` 纯逻辑层：当前行触发 / 关闭判定、完整既有链接与代码 / frontmatter / 只读 / embed 排除，不新增依赖或 IPC。
- [ ] 1.2 复用 `vaultFilePaths` + `fileClassOfPath`、`list-filter` 与 `foldCase`，实现 md 去重、四层稳定分桶、100 上限、零命中与不可表示 target 排除。
- [ ] 1.3 实现唯一 stem / 折叠同名完整路径去 `.md` 的插入文本生成；用真实 Rust 解析 fixture 对账每个可接受串都回到所选文件。

## 2. 编辑器与浮层装配

- [ ] 2.1 在 md 编辑器装 ViewPlugin 与同步索引注入口；编辑器持焦，索引 watch 后下一次允许刷新的输入重算且不按旧行号错位。
- [ ] 2.2 Enter 接入既有 `markupKeymap`，↑↓ / ⌃N/P 接入既有光标命令内分派，Escape 注册 escape-router；Tab 不接管，不新增物理键绑定。
- [ ] 2.3 实现组合期冻结刷新与结束后补一次；`isComposing` / keyCode 229 的 Enter 和其他候选键不消费、不接受。
- [ ] 2.4 实现主键行 `mousedown preventDefault` 接受、点击外部 / 失焦 / 切标签 / 切 vault / 滚出视口关闭；除接受外文档零写入。
- [ ] 2.5 用 `placeOverlay` list 档与现有 token 实现不透明浮层和 Quick Open 同款行几何；将新滚动容器登记到原生 overlay 豁免档。

## 3. 验收场景

- [ ] 3.1 新增 unit 矩阵：触发、过滤分层、去重、Unicode、同名插入、不可表示路径与 Rust 往返；不得只做单一案例回归。
- [ ] 3.2 新增 visual 场景：键鼠接受、方向键、Escape、Tab、焦点、关闭路径、IME、三主题不透明度、几何与文档不变。
- [ ] 3.3 新增或更新真机验收场景，覆盖 WKWebView 下候选完整流程与浮层不裁切；证据落 `.local/acceptance/`。
- [ ] 3.4 增加 1MB 文档 / 万文件索引的键入性能读数，确认无全文档扫描且满足既有 keypress-to-paint 预算。

## 4. 验证与归档

- [ ] 4.1 前端 unit、相关 visual、性能检查与 `scripts/gate.sh visual` 通过；不未经 Alex 过目更新像素基线。
- [ ] 4.2 真机验收场景通过；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [ ] 4.3 独立 reviewer clean/merge、节点 2 五要件与归档跟踪记录齐备后，在前一环归档审计 PASS 的基线上归档本环；提交归档结果且 `--archived add-wikilink-suggestion-nov24` PASS。
