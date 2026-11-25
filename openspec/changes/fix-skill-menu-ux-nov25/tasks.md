# Tasks: fix-skill-menu-ux-nov25

## 1. 合同与回归判据

- [x] 1.1 记录 Alex 2026-11-25 三项实测缺陷为节点 1 批准依据，写明 scope、非目标与输入分布不变量。
- [x] 1.2 先增加能区分旧实现的键盘类型 × 列表长度 × 可见窗口位置矩阵测试，以及可用宽度分布测试；保存旧实现失败日志。
- [x] 1.3 回扫既有 Skill 测试，移除「Ctrl+N/P 关闭且不消费」的旧期望，保留 Enter、Escape、IME 与 refs 合同。

## 2. 实现

- [x] 2.1 Ctrl+N/P 与 ArrowDown/Up 共用高亮移动路径；候选打开时消费事件且不改 composer 文档或 caret，候选关闭时保留 Emacs 行移动。
- [x] 2.2 高亮变化后只滚动候选容器以完整揭示当前项；覆盖首尾、长列表和鼠标 + 键盘混合，不滚动整页。
- [x] 2.3 Skill 候选按宿主可用宽度响应式加宽，保留 em 缩放与 pane 夹取；通用 list 档不变，滚动条细条档不变。

## 3. 验收与证据

- [x] 3.1 新增合成 fixture 的 WKWebView 场景 868，覆盖 Ctrl+N/P、长列表高亮揭示与候选加宽；场景静态校验通过。
- [x] 3.2 相关前端单测、Skill 目标视觉测试（含三主题与三宽度）、OpenSpec strict validate 与 docs-check 通过，日志落 `.local/missions/skill-menu-ux-nov25/`。
- [x] 3.3 不更新视觉基线；若有预期像素差异，把候选图与精确清单落 `.local/reviews/skill-menu-ux-nov25/` 待 Alex 过目。
- [x] 3.4 主会话串行执行 `node scripts/acceptance/run.mjs 868`；本 worker 不启动真机，交付时不得宣称真机通过。**已完成（2026-11-25，最终 tip `d0b6927c`）：868 1/1 PASS、38 断言、63.2s，证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-25-skill-menu-ux-r4/`。**
