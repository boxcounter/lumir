---
id: "38-content-width-drag"
item: 38
title: 栏宽双侧拖拽手柄：拖拽写回 config.json（合并写、不抹其他键）、文档零写盘、重启保持
fixtures: [keys.md]
open: keys.md
marker: "键位场景"
steps:
  - name: 记录文档与配置基线（拖拽 MUST NOT 碰文档，只碰 config.json 的一个键）
    do: record
    as: 场景文件
    file: keys.md
    expect:
      - label: 基线文件存在且可读（读不到一律 FAIL，不允许在空值上比较）
        file: { path: keys.md, exists: true }
      - label: 配置基线可读（出厂口径下 config.json 没有 content_width 键）
        file: { path: "env:config.json", not: "content_width" }

  - name: 记录编辑器文本基线（拖拽不是编辑，dirty 与文本都不许动）
    do: recordEditor
    as: 编辑器基线

  - name: 手柄的读屏身份在场（D120：两条 separator，共用同一读屏名）
    do: settle
    expect:
      - label: AX 树里恰有两条「调整内容宽度」（左右缘各一，读屏可辨）
        ax: { count: { pattern: "/AXSplitter \\(调整内容宽度\\)/", exact: 2 } }

  - name: 拖右缘手柄向右 80pt：松手后栏宽 920（760+2×80 对称律）写回 config.json
    do: drag
    target: { textareaEdge: "right" }
    dx: 80
    expect:
      - label: config.json 出现了 ui.content_width = 920（D3：松手写一次，通用键值合并写通道；位移确定值，钉字面量）
        file: { path: "env:config.json", has: '"content_width": 920' }
      - label: 合并写不抹其他键：version / last_vault / editor.mode 仍在
        file: { path: "env:config.json", has: '"version": 1' }
      - label: editor.mode 仍在（合并写的相邻键存活证据）
        file: { path: "env:config.json", has: '"mode": "md"' }
      - label: 文档 sha256 与 mtime 未动（拖拽 MUST NOT 写 vault）
        file: { path: keys.md, unchangedSince: 场景文件, mtimeUnchangedSince: 场景文件 }
      - label: 编辑器文本逐字节未变（拖拽不改文档、不碰 dirty 文本面）
        editor: { unchangedSince: 编辑器基线 }
      - shot: 拖拽后-栏宽加宽

  - name: 拖左缘手柄向左 40pt（左缘向左 = 放宽；对称手柄同效的另一侧）：920 + 2×40 = 1000
    do: drag
    target: { textareaEdge: "left" }
    dx: -40
    expect:
      - label: content_width = 1000（合并写通道第二次落盘，左缘手柄对称生效）
        file: { path: "env:config.json", has: '"content_width": 1000' }
      - shot: 拖拽后-栏宽收回

  - name: 重启后栏宽保持（D3 的持久化语义：config.json 的值被启动读取）
    do: restart
    expect:
      - label: 重启后 config.json 的 content_width = 1000 仍在（持久化不是运行期假象）
        file: { path: "env:config.json", has: '"content_width": 1000' }
      - label: 重启后 vault 照常装载（栏宽配置不挡启动链路；重启不自动重开文档——与场景 28 同口径）
        ax: { has: "这个 vault 还没有打开的文件" }

  - name: 重开 keys.md：栏宽配置下编辑器照常装载
    do: open
    file: keys.md
    expect:
      - label: 编辑器照常装载（1000 的配置值经启动读取 → 生效，不报错不白屏）
        editor: { has: "键位场景" }
      - shot: 重启后-栏宽保持

  - name: 下限钳制：从当前值大幅往窄拖（位移足以越过钳制阈值 120pt），宽度停在 760（默认值即下限，D2）
    do: drag
    target: { textareaEdge: "right" }
    dx: -400
    expect:
      - label: 钳到下限 760（越界回落端点，不是负值也不是报错）
        file: { path: "env:config.json", has: '"content_width": 760' }
teardown:
  - label: 场景结束文档仍是基线（拖拽全过程对 vault 零副作用）
    file: { path: keys.md, unchangedSince: 场景文件, mtimeUnchangedSince: 场景文件 }
---

## 已知边界

- **写盘失败路径（toast D121 + 不回滚）不在真机验**：harness 没有「把隔离配置目录置只读」的
  动作（chmod 需要 shell 通道，套件刻意不引入）；该路径已由 chromium 场景
  （`tests/visual/scenes/content-width.spec.ts` 的「写盘失败」一条，failures 注入）与
  Rust 侧 `config_set_ui_value` 的 cargo test 覆盖。
- **拖拽帧耗（1MB 文档）不进本套件**：性能探针归 mission 的 6.5 任务（playwright chromium
  一次性探针，数据落 `test-results/m228/`），真机手感归 Alex。
- dx 是**窗口局部点**（CGEvent 通道与 doubleClick 同口径，不经过截图像素的 0.96 缩放），
  因此栏宽增量是确定值（±80pt → 宽度 ±160），断言钉字面量 920 / 1000 / 760（760 为 2026-09-26
  修订后的默认值与下限）。
- **拖拽起止点都必须在窗口内**（harness 显式越界报错，防坐标空间错乱假现场）——钳制档
  用 -400pt（远超 120pt 的钳制阈值）而不是「拖出窗外」来表达大幅往窄。
- **起拖点取编辑器列缘（textareaEdge）而不是手柄节点**：WKWebView 把 `role=separator` 暴露成
  **无 bbox 的 AXSplitter**（M228 实测：节点在树里、名字对，但 frame 为空，tabindex / role 变体
  均如此）——AXTextArea 的 bbox 即 `.cm-content` 的 border box，手柄命中区贴其左右缘 ±5px，
  从列缘中高处起拖等价于抓住手柄。手柄的 AX 身份（读屏名 D120）仍由 AX 断言覆盖（节点在树即可）。
