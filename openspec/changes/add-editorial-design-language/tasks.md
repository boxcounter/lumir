# Tasks

## 提案与视觉

- [ ] 将 `design/editorial` 定稿转为三主题 token：light、dark、eink；eink 必须纯黑白、无透明、无动画、无阴影。
- [ ] 落地正文黑体 16px/1.75、标题宋黑对比、首行缩进 2em、默认 480px 行宽；行宽可调且写入 config，遵循 ADR 0002 §5 配置即数据。
- [ ] 实现 masthead、目录树层级工艺、¶ 选中态、长名截断、深层嵌套及低视口滚动。
- [ ] 将 toast 样式从内联样式归位 CSS；撤除 M1 config 探针及其 UI，说明其不再是产品能力。
- [ ] 让右栏 Context Surface 默认隐藏；编辑点出现时才显示，且不改变正文版位。

## Threads

- [ ] 按 ADR 0005 实现 Thread 最小对象：标题、状态、角色化文件关联、最近活动。
- [ ] 实现进行中、暂停、完成、归档四态及状态转换约束。
- [ ] 实现 Thread 创建、切换、列表；Thread 持久化到 `~/.config/lumir/threads/`。
- [ ] 左栏默认显示目录，Threads 独立分区显示标题、状态、开放/处理中/待回看计数及角色文件；共享文件显示 `×n`，不让 Thread 冒充文件所有者。
- [ ] 明确不实现编辑点、agent 流、Session 管理。

## Copy deck v2

- [ ] 重建 `文案-Copy.md`（v1 已删除），沿用五要素表格格式。
- [ ] 收编新 UI 全部可见文案，逐条提供 zh/en、位置、角色、设计意图与状态。
- [ ] 将新文案接入实现，确保 deck 是 source of truth；后端透传错误保持透传占位。

## 验证与门禁

- [ ] 运行 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`。
- [ ] 对 light/dark/eink 做截图走查，验证排印、导航、低视口和 Threads 状态。
- [ ] 运行视觉回归门禁并更新 tests/visual 的基线/断言以适配 Editorial；不得放宽真实错误检测。
- [ ] 运行既有 perf 合同验证，确认主题装饰层不影响 ADR 0002 §6（冷启动、keypress-to-paint、1MB Markdown 打开、常驻内存）。
- [ ] 验证真实文件仍以 workspace 磁盘目录为 source of truth，Thread 关联仅为角色引用。
