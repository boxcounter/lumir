# Tasks: fix-wikilink-caret-reveal-nov24

> 节点 1 未通过前不得实现。`openspec/specs/**` 活跃期只读；规格变更只写本 change 的 delta。与 `add-wikilink-suggestion-nov24` 按真实文件冲突排程，分别独立验收与归档。

## 1. 合同与失败复现

- [x] 1.1 按 design §4 先修订 `docs/specs/editor-caret.md` C6、输入分布、实现落点与属性测试表，保留无显露列表区间的原子钳制。
- [x] 1.2 按 design §6 建立 wikilink 属性矩阵，先证明键盘内部落点、widget 中部点击、pending → resolved 三格在旧实现判红。
- [x] 1.3 增加修饰键与手势反例：Meta 若先进入编辑必须判红；Shift / Alt 若进入 helper 或 collapse 原选区必须判红；把首次 drag 当成 alias 拖选必须判红。
- [x] 1.4 全量回扫 design §7 列出的旧 spec 场景、测试期望与注释；保留 syntax-envelope 不外扩和跨 replace 边界删除的旧判据。

## 2. 实现

- [x] 2.1 普通 wikilink 装饰复用 `touchesSource`，选区触及时显露完整源码，离开后恢复三态，pending 迁移不遮回编辑面。
- [x] 2.2 在 `enterReplacedSource` 之前分流 Meta / Ctrl / Shift / Alt：widget 不 preventDefault、不改选区、不显露、不聚焦；Meta 冒泡给既有跟随，Ctrl 让回系统次级点击，Shift / Alt 保留既有原生手势与选区结果。
- [x] 2.3 仅无修饰主键且可编辑时调用 `enterReplacedSource`；第一次 click / drag 只进入源码，第一次 drag 保持空光标，第二次源码拖选走 CM 原生选区。
- [x] 2.4 仅在属性测试证明事务后仍有隐藏死区时补共享水平移动钳制；不得注册整条 wikilink 原子范围。
- [x] 2.5 若新增共享 `wikilinkSpanAt`，将 link-follow 现有定位改为同一实现；同步 syntax-envelope / hidden-tail-caret 注释。

## 3. 验收场景

- [x] 3.1 改准 markdown-editing-stability 的边界点击旧期望与 wikilink.spec 的裸点击旧注释 / 断言，新增进入后编辑、undo、保存与离开恢复。
- [x] 3.2 在 wikilink-caret-reveal.spec 增加三态 × Meta / Ctrl 真实矩阵：逐格记录原视图选区、widget、焦点、跳转 / toast；unresolved Meta 明确断言选区与焦点不变。另以 span 外的正向 / 反向非空选区跑 Shift-Click / Alt-Click，断言不进入、不显露，anchor / head 与原选区逐值相同，Shift 不 collapse。
- [x] 3.3 用 `page.mouse` 增加首次 drag 与第二次源码拖选矩阵：部分 / 完整 alias、target-only、正反向，断言定界符不隐式并入且文档不变。
- [x] 3.4 为 visual resolver 桩增加可控延迟，覆盖 pending → resolved / ambiguous / unresolved 的连续编辑。
- [ ] 3.5 新增或更新真机验收场景，覆盖 WKWebView 下键盘 / 指针进入、修饰键旧语义、只读不进入与文档字节不变；精确 caret 与拖选断言留在 visual。

## 4. 验证与归档

- [x] 4.1 前端 unit、相关 visual 与 `scripts/gate.sh visual` 通过；不未经 Alex 过目更新像素基线。
- [ ] 4.2 真机验收场景通过，证据落 `.local/acceptance/`；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [ ] 4.3 独立 reviewer clean/merge、节点 2 五要件与归档跟踪记录齐备后独立归档；提交归档结果且 `--archived fix-wikilink-caret-reveal-nov24` PASS，不设置 B 的归档先后门禁。
