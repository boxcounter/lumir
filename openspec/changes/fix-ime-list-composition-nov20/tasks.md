# Tasks: fix-ime-list-composition-nov20

> `openspec/specs/**` 活跃期只读；规格变更只写本 change 的 delta。

## 1. 复现与诊断

- [x] 1.1 用 CDP `Input.imeSetComposition` 在 `词汇\n- ` 的内容起点复现组合输入与删除；修前断言
      证实源码恢复但「词汇」行的 DOM 文本为空。
- [x] 1.2 Alex 在 master 工作区 dev 实例复验首轮实现，现象不变；`editor_ime` 日志证明当前代码
      已加载，并取得 WKWebView 的 `insertCompositionText` → `deleteCompositionText` →
      compositionend 真实事件序。现场无原生列表命令，首轮命令拦截假设撤销。
- [x] 1.3 组合期冻结后在 dev 实例第二轮复验：删除导致的上一行消失已消失；候选提交后 marker
      未恢复。据此在 compositionend 唤醒冻结期跳过的装饰重建；后续按 r2 评审把「同步
      forceParsing 整篇」改为有界分片 + 低频恢复。该版尚未经 Alex 复验。

## 2. 实现

- [x] 2.1 在 md 编辑器统一 beforeinput 闸门中记录组合源码起点；组合中 Backspace 仅在即将删空时
      以显式事务删除最后一个完整字素，同时接受 `deleteContentBackward` 与
      `deleteCompositionText`；接管面限定为 L6 列表内容起点（真列表项 / 裸 marker / 段落后
      `- ` 的 setext 候选，复用 `listLineRender` 与 `markerTextAt`），普通段落、表格、代码块
      交回原生 IME；其余组合内删除同样交回。
- [x] 2.2 组合期冻结 ListLayout 的 DOM 重建与后台发布；compositionend handler MUST NOT 同步
      dispatch——最终候选可能已写进 DOM 而 CM 的 pending MutationRecord 尚未 flush，同步
      dispatch 会在 `EditorView.update` 的 `observer.clear()` 里丢掉候选。等 pending 清空后
      重读 `selection.main.head`，再把提交行末交给有界恢复链：每次推进一个有界解析分片
      （8KB / 低频期 64KB，≤5ms 预算），未完成按 16ms / 100ms 重试，4s 后转 250ms 低频
      恢复直到覆盖提交行（不取消目标、不依赖下一次用户编辑）。恢复链第一拍异步启动，
      MUST NOT 在 `EditorView.update` 内 dispatch（会让插件崩溃）。不把同步解析整篇文档
      当成刷新前提；组合期保留组合前 marker 形态。
- [x] 2.3 `history.joinToEvent` 阻止 compose.start 与紧邻普通输入并组；新增无 500ms 屏障的
      真实组合用例，验证一次 undo 回到组合前、redo 回提交后，dirty 随保存基线变化。

## 3. 合同与回归

- [x] 3.1 用真实 Chromium 组合事件覆盖真 bullet / 有序 / 嵌套 / 裸 marker / 段落后 setext 切换；
      每格验证首字符、删空、组合起点 no-op、家庭 emoji 整簇删除、候选提交、精确保存与一次撤销，
      且相邻行 DOM 不清空；提交与 undo/redo 稳定后逐行比较 marker 数量、glyph / 序号、计算样式
      与正文 x；真列表目标行提交后与组合前逐项比较 padding / fontSize / color / bodyX，setext
      与同文档同字体顶层参考 bullet 逐项数值比较（不保留任意 px / 任意数字通配）；历史边界用例
      撤销 joinToEvent 防线后必红（本分支实测：同一用例在 undo
      断言判红），恢复后绿。
- [x] 3.2 新增 WKWebView `deleteCompositionText` 合同与组合期装饰冻结用例：删空显式事务、
      起点 no-op、组合中 marker 数量不增加、提交后刷新；Chromium 构造器归一 inputType 的
      测试装置陷阱已用 defineProperty 排除。
- [x] 3.3 更新 `docs/specs/lists.md` L6 与本 change 的 MODIFIED requirement，保留既有全部场景，
      清除已被现场反证的原生列表命令归因；明确接管面只限列表内容起点、非列表位置交回原生 IME，
      以及组合结束后的有界恢复口径。
- [x] 3.4 新增确定性恢复用例：非列表位置（普通段落 / 围栏代码块 / 表格 cell）不接管；组合中
      后台 timer 到期不发布、compositionend 后补回新组 marker；取消组合恢复组合前形态；
      compositionend 前 DOM 已有候选、doc 未更新且 pending MutationRecord ≥1 时，候选必须进入
      文档且 marker 恢复；1MB+ 文档解析未完成时组合结束走有界恢复并最终补回 marker；用可控
      时钟进入 4s 后的低频分支，断言 250ms 调度、最终恢复且无重复 marker；另测候选提交到两次
      rAF 的绘制路径与真实 settleStep 回调切片。

- [x] 3.5 新增 WKWebView 合成 IME 序列自动回归：验收实例 Vite dev server 仅在
      `LUMIR_ACCEPTANCE_PORT` + `LUMIR_ACCEPTANCE_IME=1` 时注入
      `scripts/acceptance/driver/ime-driver.mjs` 与 `/__lumir-ime/*`；runner 新增 `imeDrive`
      action（封闭 case/参数校验、报告写隔离 env、bundle INVALID），场景 271 覆盖
      `词汇\n- \n后续` 的 compose / delete-empty / commit。合成事件 ≠ 原生 IME，
      原生终判仍归 156 / 262。

## 4. 验证与交付边界

- [x] 4.1 `LUMIR_VISUAL_PORT=4281 scripts/visual/run.sh scenes/editing-oracle.spec.ts --grep
      'IME|WebKit 组合删除|正文 CDP'` 实测 20/20 通过（chromium project；`webkit-realua` 因本机
      无 Playwright webkit 构建被跳过）。WebKit 侧证据仍只有合成 `beforeinput` 与 dev 日志，
      不冒充原生 IME。
- [ ] 4.2 最终 `scripts/gate.sh visual`（含 quick）通过；本分支只跑了目标组，全量门禁与 cargo
      由主会话协调；不更新像素基线。
- [ ] 4.3 独立 reviewer 对真实 WKWebView 事件路径、组合期装饰冻结与历史语义做最终复核；
      preliminary review 与第二轮 review（2026-11-21）均为 hold（P1 pending flush / P2 截止后
      恢复 / P3-1 目标行几何 / P3-2 实际测量），本批处置后需复评。
- [x] 4.4 Alex 自行运行的 dev 实例复验输入与删除；已完成第二轮（删除 / 相邻行消失已消失，
      候选提交后 marker 未恢复）。**2026-11-21 Alex 原生复验：中文候选提交后正式列表符恢复，
      行为符合预期**（insertText 提交、无 compositionend 的路径也已覆盖）；agent 不启动或
      操作 Lumir、不执行真机验收。
- [x] 4.6 用 runner 真实执行场景 271（自动启动隔离 dev），保存截图 / 报告 / JSONL；
      并用未修复 mutant 证明对应字段判红、恢复后复绿（证据 `.local/acceptance/` 与
      `.local/missions/ime-list-composition-nov21/worker/`）。
- [x] 4.5 诊断完成后移除临时 `editor_ime` 诊断：前端 `traceIme` / `traceSettle` /
      `forensicDetail` 及事件埋点、Rust `LogEventName::EditorIme` 与字段白名单、ts-rs 重导出
      `src/bindings/LogEventName.ts`；随后复跑 tsc ×3、单测、目标视觉组、271、docs-check、
      OpenSpec validate 与 cargo test 绑定核对。
