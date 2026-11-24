# Tasks: fix-wikilink-caret-reveal-nov24

> 节点 1 未通过前不得实现。`openspec/specs/**` 活跃期只读；规格变更只写本 change 的 delta。本环必须先于 `add-wikilink-suggestion-nov24` 归档并通过归档后审计。

## 1. 合同与失败复现

- [ ] 1.1 按 design §2 先修订 `docs/specs/editor-caret.md` C6、输入分布、实现落点与属性测试表，保留无显露列表区间的原子钳制。
- [ ] 1.2 按 design §4 建立 wikilink 属性矩阵，先证明键盘内部落点、widget 中部点击、pending → resolved 三格在旧实现判红。
- [ ] 1.3 全量回扫 design §5 列出的旧 spec 场景、测试期望与注释；保留 syntax-envelope 不外扩和跨 replace 边界删除的旧判据。

## 2. 实现

- [ ] 2.1 普通 wikilink 装饰复用 `touchesSource`，选区触及时显露完整源码，离开后恢复三态，pending 迁移不遮回编辑面。
- [ ] 2.2 widget 主键入口复用 `enterReplacedSource`，钳制定界符内侧并持焦；只读与非主键不进入。
- [ ] 2.3 仅在属性测试证明事务后仍有隐藏死区时补共享水平移动钳制；不得注册整条 wikilink 原子范围。
- [ ] 2.4 若新增共享 `wikilinkSpanAt`，将 link-follow 现有定位改为同一实现；同步 syntax-envelope / hidden-tail-caret 注释。

## 3. 验收场景

- [ ] 3.1 改准 markdown-editing-stability 的边界点击旧期望与 wikilink.spec 的裸点击旧注释 / 断言，新增进入后编辑、undo、保存与离开恢复。
- [ ] 3.2 为 visual resolver 桩增加可控延迟，覆盖 pending → resolved / ambiguous / unresolved 的连续编辑。
- [ ] 3.3 新增或更新真机验收场景，覆盖 WKWebView 下键盘 / 指针进入、只读不进入与文档字节不变；精确 caret 断言留在 visual。

## 4. 验证与归档

- [ ] 4.1 前端 unit、相关 visual 与 `scripts/gate.sh visual` 通过；不未经 Alex 过目更新像素基线。
- [ ] 4.2 真机验收场景通过，证据落 `.local/acceptance/`；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [ ] 4.3 独立 reviewer clean/merge、节点 2 五要件与归档跟踪记录齐备后归档本环；提交归档结果且 `--archived fix-wikilink-caret-reveal-nov24` PASS 后，下一环才可归档。
