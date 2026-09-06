# Change: 落地 Editorial 设计语言与 Threads 最小模型

- **Change ID**：`add-editorial-design-language`
- **日期**：2026-09-06
- **角色**：产品负责人、设计、前端与 Rust 实现者；Alex 负责节点 1 提案裁决

## Why

Lumir 已由 Alex 裁决采用 Editorial（编辑部）方向：排印即界面，正文黑体、标题宋体、报头一线、目录与页边注记组成低 chrome 的工作台。现有实现仍是三栏壳层与调试期配置探针，缺少稳定的视觉 token、真实的左栏信息架构和 Thread 导航，导致设计参照无法成为产品契约。

本 change 将已定稿的 `design/editorial` 视觉裁决转为实现可验收的产品行为，并补足 Thread 的最小持久化模型。文件仍属于 workspace，角色只属于 Thread；因此目录树与 Threads 区必须同屏共存，不能用 Thread 索引冒充文件系统。

## What changes

- 建立 light/dark/eink 三主题 token、Editorial 排印参数、masthead 与 CSS toast；行宽默认 480px，并作为 config 数据可调。
- 移除 M1 调试残留的 config 探针，右栏 Context Surface 默认隐藏，只有存在编辑点时出现且不推动正文版位。
- 左栏改为目录默认在上、Threads 分区在下。目录落实缩进、字重、明度、¶ 选中态、截断、深层嵌套与低视口滚动；共享文件显示 `×n` 引用计数。
- 引入 Thread 最小模型：标题、四态生命周期（进行中/暂停/完成/归档）、角色化文件关联、最近活动；支持创建、切换、列表，持久化于 `~/.config/lumir/threads/`。vault 引用以稳定 id 与 vault 相对路径存储，路径变动必须经过重映射而不得静默断联；Thread brief 是 vault 内可由外部 Agent、人或 git 管理的真实文件，Thread 注册表仅保存其相对路径引用，并为 genesis 入站预留接口。
- 重建 Copy deck v2，收编新 UI 全部可见文案，提供 zh/en 与五要素，作为文案 source of truth。
- 适配视觉回归门禁和三主题走查，同时保持 ADR 0002 §6 性能合同与真实文件 source of truth。

## Not changing

本 change 不实现编辑点交互、agent 流或 Session 管理，不实现完整可扩展主题系统，不做移动端布局。Thread 不拥有文件，不改变 workspace 目录事实；Session 将随 agent 接入波次处理。

## Impact

影响前端壳层、目录树、主题与配置读取，以及新增的 Threads 本地存储与导航呈现。现有 workspace 文件读写契约保持不变。实现阶段需要更新视觉回归基线，但不得削弱回归断言。

## Acceptance

Alex 可仅依据本提案与 spec delta 判断范围。实现必须通过 strict OpenSpec validate；三主题截图走查无溢出、无 eink 灰阶/动画/透明；性能合同测试与既有 perf fixture 不受影响。
