# Tasks

## Proposal 阶段（节点 1）

- [ ] 1.1 评审并冻结普通 ≤16 KiB、中型 >16–64 KiB、异常 >64 KiB/极端形状的分层，明确单表 bytes 与形状维度。
- [ ] 1.2 提供不可逆的 M88 脱敏画像 summary，或记录其缺失；不得用 M72 probe 代替使用分布证据。
- [ ] 1.3 裁决普通/中型首屏最终表格、异常完整源码降级与 report-only 的边界。
- [ ] 1.4 裁决极端形状阈值、真实 WK 样本条件与 Table F0/滚入 paint/主线程任务候选预算。

## 实现阶段（节点 1 通过后）

- [ ] 2.1 建立纯 table model：parser 范围、矩形性、四对齐、空槽、escaped pipe、无首尾 pipe、引用/列表容器和完整源码降级原因。
- [ ] 2.2 以 CodeMirror 公开 API 接入可见 decoration、源码 range/selection 映射、局部横滚和稳定列测量；禁止直接改管理 DOM、固定 240px、同步全量扫描、每视口全行遍历和整表 widget。
- [ ] 2.3 完成普通/中型首屏最终表格及异常完整可读源码降级；异常增强失败只 report-only，不放宽源码完整性。
- [ ] 2.4 验证宽表键盘与真实物理触控板到末列、自然 Tab 进出、焦点、AX table/row/cell 关系、窄窗/resize/多表隔离。
- [ ] 2.5 验证鼠标/键盘局部与整表、跨表及正文、全选复制均为原始 Markdown；验证 M1 只读 doc/磁盘 hash，记录 M2 源码编辑承接。
- [ ] 2.6 仅在代表性匿名 ≤256 KiB 真实 WK 出现归因明确 >16ms 主线程任务或 F0 持续失败后，另立 parser worker 实验并验证取消/过期结果/有界失败；不预先生产化 M76 方案。

## 真实 WK 与出口（节点 2 前）

- [ ] 3.1 为普通/中型冷热样本各收集 `N≥30`，报告 Table F0、滚入可见 paint、主线程任务 p50/p95/max；候选阈值须标记为节点裁决结果，不伪称现有 perf 通过。
- [ ] 3.2 运行三套真实主题、宽窄窗口、字体缩放、resize、首屏、滚入中部和异常降级矩阵，保留屏幕/逐帧、AX、console/native log 与失败样本，不覆盖失败证据。
- [ ] 3.3 若 worker 实验触发，独立评审其序列化/重建成本与收益；未触发则保留“未触发”证据。
- [ ] 3.4 运行 `pnpm build`。
- [ ] 3.5 运行 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`。
- [ ] 3.6 核对本 change 新增相对链接目标存在，运行 `git diff --check` 与 scope diff；失败时保留 failure evidence。
- [ ] 3.7 请求独立 review 与 OpenSpec 节点 2；节点 2 通过后方可 archive。
