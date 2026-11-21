# Tasks: fix-ime-list-composition-nov20

> `openspec/specs/**` 活跃期只读；规格变更只写本 change 的 delta。

## 1. 复现与诊断

- [x] 1.1 用 CDP `Input.imeSetComposition` 在 `词汇\n- ` 的内容起点复现组合输入与删除；修前断言
      证实源码恢复但「词汇」行的 DOM 文本为空。
- [x] 1.2 Alex 在 master 工作区 dev 实例复验首轮实现，现象不变；`editor_ime` 日志证明当前代码
      已加载，并取得 WKWebView 的 `insertCompositionText` → `deleteCompositionText` →
      compositionend 真实事件序。现场无原生列表命令，首轮命令拦截假设撤销。
- [x] 1.3 组合期冻结后在 dev 实例第二轮复验：删除导致的上一行消失已消失；候选提交后 marker
      未恢复。据此在 compositionend 先 `forceParsing` 补齐当前文档解析，再用 effect 唤醒冻结期
      跳过的装饰重建；这一版尚未经 Alex 复验。

## 2. 实现

- [x] 2.1 在 md 编辑器统一 beforeinput 闸门中记录组合源码起点；组合中 Backspace 仅在即将删空时
      以显式事务删除最后一个完整字素，同时接受 `deleteContentBackward` 与
      `deleteCompositionText`；接管面限定为 L6 列表内容起点（真列表项 / 裸 marker / 段落后
      `- ` 的 setext 候选，复用 `listLineRender` 与 `markerTextAt`），普通段落、表格、代码块
      交回原生 IME；其余组合内删除同样交回。
- [x] 2.2 组合期冻结 ListLayout 的 DOM 重建与后台发布；compositionend 只对提交行末做有界补解析
      （≤5ms 分片，未完成按 16ms / 100ms 重试，4s 截止），解析覆盖后统一刷新。恢复链第一拍
      异步启动——MUST NOT 在 `EditorView.update` 内 dispatch（`forceParsing` 会把空事务
      打进正在进行的 update，CM 抛错并让插件崩溃、装饰整段消失）。不把同步解析整篇文档当成
      刷新前提；组合期保留组合前 marker 形态。
- [x] 2.3 `history.joinToEvent` 阻止 compose.start 与紧邻普通输入并组；新增无 500ms 屏障的
      真实组合用例，验证一次 undo 回到组合前、redo 回提交后，dirty 随保存基线变化。

## 3. 合同与回归

- [x] 3.1 用真实 Chromium 组合事件覆盖真 bullet / 有序 / 嵌套 / 裸 marker / 段落后 setext 切换；
      每格验证首字符、删空、组合起点 no-op、家庭 emoji 整簇删除、候选提交、精确保存与一次撤销，
      且相邻行 DOM 不清空；提交与 undo/redo 稳定后逐行比较 marker 数量、glyph / 序号、计算样式
      与正文 x；历史边界用例撤销 joinToEvent 防线后必红（本分支实测：同一用例在 undo 断言判红），
      恢复后绿。
- [x] 3.2 新增 WKWebView `deleteCompositionText` 合同与组合期装饰冻结用例：删空显式事务、
      起点 no-op、组合中 marker 数量不增加、提交后刷新；Chromium 构造器归一 inputType 的
      测试装置陷阱已用 defineProperty 排除。
- [x] 3.3 更新 `docs/specs/lists.md` L6 与本 change 的 MODIFIED requirement，保留既有全部场景，
      清除已被现场反证的原生列表命令归因；明确接管面只限列表内容起点、非列表位置交回原生 IME，
      以及组合结束后的有界恢复口径。
- [x] 3.4 新增确定性恢复用例：非列表位置（普通段落 / 围栏代码块 / 表格 cell）不接管；组合中
      后台 timer 到期不发布、compositionend 后补回新组 marker；取消组合恢复组合前形态；
      1MB+ 文档解析未完成时组合结束走有界恢复并最终补回 marker（记录同步切片与总恢复耗时，
      并断言不出现 CodeMirror plugin crash）；另以大文档顶部提交记录同步耗时，证明恢复链
      只补提交行、不解析整篇。

## 4. 验证与交付边界

- [x] 4.1 `LUMIR_VISUAL_PORT=4281 scripts/visual/run.sh scenes/editing-oracle.spec.ts --grep
      'IME|WebKit 组合删除|正文 CDP'` 实测 17/17 通过（chromium project；`webkit-realua` 因本机
      无 Playwright webkit 构建被跳过）。WebKit 侧证据仍只有合成 `beforeinput` 与 dev 日志，
      不冒充原生 IME。
- [ ] 4.2 最终 `scripts/gate.sh visual`（含 quick）通过；本分支只跑了目标组，全量门禁与 cargo
      由主会话协调；不更新像素基线。
- [ ] 4.3 独立 reviewer 对真实 WKWebView 事件路径、组合期装饰冻结与历史语义做最终复核；
      preliminary review（2026-11-21）为 hold（P2-1 / P2-2 / P3-1 / P3-2），本批处置后需复评。
- [ ] 4.4 Alex 自行运行的 dev 实例复验输入与删除；已完成第二轮（删除 / 相邻行消失已消失，
      候选提交后 marker 未恢复），最新 `forceParsing` 版待复验；agent 不启动或操作 Lumir、
      不执行真机验收。
- [ ] 4.5 诊断完成后移除临时 `editor_ime` 诊断：前端 `traceIme` 及其 `compositionupdate` /
      `input` 埋点、Rust `LogEventName::EditorIme` 与字段白名单、ts-rs 重导出
      `src/bindings/LogEventName.ts`；随后复跑 tsc、单测、目标视觉组与 bindings 漂移检查。
      移除前不得归档。
