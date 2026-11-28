# Tasks: clip-markdown-content-to-reading-width-nov27

## 1. 合同与技术定位

- [x] 1.1 阅读 AGENTS/REVIEW/OpenSpec 流程、行业原始材料、CM scrollDOM/contentDOM/scrollHandler 与现有 grid/doc-title/gutter/END/阅读位置实现。
- [x] 1.2 用生产页探针记录当前与 contentDOM scrollport 候选的根几何，确认不能只加 overflow:hidden。
- [x] 1.3 新建 change，记录 Alex 批准方向、四量定义、scrollport 归属、矩阵与反向必红口径；不改 living。

## 2. 实现

- [x] 2.1 Markdown nowrap 条件化 contentDOM scrollport；wrap/code/块级模型不变，滚动容器登记归 native-overlay 档。
- [x] 2.2 用公开 `EditorView.scrollHandler` 实现水平 caret/selection/search 揭示，纵向继续走 CM 默认路径。
- [x] 2.3 阅读位置捕获/恢复、content scroll 订阅与会话内存快照使用真实 inner x；新文档复位 inner/outer x。
- [x] 2.4 保持 doc-title/END/gutter/手柄与 CM contentDOM 所有权，不新增应用 wrapper。

## 3. 自动化与证据

- [x] 3.1 新视觉场景覆盖 wrap/nowrap × 起点/中段/最右 × 行号 × 单双 pane × 宽窄窗 × 三主题，并覆盖编辑/粘贴/搜索/全选复制/阅读位置。
- [x] 3.2 新断言逐条反向必红并恢复绿，红绿日志落主仓 `.local/reviews/markdown-visible-width-nov27/`。
- [x] 3.3 产出三主题/单双 pane/横滚位置的现状与候选图，实际看图，不更新正式基线。
- [x] 3.4 更新真机场景与 COVERAGE，`node scripts/acceptance/run.mjs --check` 通过；native 留给主会话统一执行。
- [x] 3.5 跑目标测试、`pnpm test`、build 与 `scripts/gate.sh quick`；记录原文结果和退出码。完整 visual 与主会话串行，不并行启动。

## 4. 收口

- [x] 4.1 确认未实施容量反馈/A/B 手柄、未改 code 满 pane、未新增设置；记录与容量 change 的 contentDOM x 接口。
- [x] 4.2 在指定独立分支提交实现并 rebase 到 master d356a0f7；不 merge/push/archive。完整视觉、native 与独立 K3 评审仍留主会话。
- [x] 4.3 归档前补齐五态、五要件与独立 reviewer；最终 visual、native 和 Alex 双侧留白批准均已在案。
- [x] 4.4 执行归档包装器，提交归档目录与 living spec，运行 `--archived` 至 PASS 并回填归档提交与审计记录。

## 5. 独立评审 rework

- [x] 5.1 按 CM 6.43.15 宽矩形源码实现 active-head 二次修正，保留 xMargin；正反向纯函数与真实字号消费者回归通过。
- [x] 5.2 pos0/target≤0 只跳过纵向 dispatch，不吞独立 x；真实原点捕获→装载与焦点往返回归通过。
- [x] 5.3 新回归保留旧红新绿；回扫目标、编辑/IME/undo/图层补偿、会话恢复、build、OpenSpec 与 quick，记录 rework readiness。
- [x] 5.4 双侧 44px 留白候选：区分外框 X 与文字窗口 T，contentDOM/caret/selection 同步裁切；行尾可滚空间、原始几何、左右反例、同名候选与看图完成；render-codeblock/IME/quick 通过，待 Alex 视觉确认。
- [x] 5.5 消除行尾伪元素空行回归：CM 空行（含 br）不参与补偿；空/非空行高度、初始 scrollTop、块级尺寸持久回归与反向必红通过；render-codeblock 像素、Markdown 10/10、IME/layer 与 quick 通过。
