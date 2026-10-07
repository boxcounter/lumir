---
id: "87-harness-ctx-warn"
item: 87
title: ctx% 越警示阈值：读数高亮 + hover 读数浮出警示说明（ⓘ 钮已随 M370 移除）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-ctx-warn.json"
    # auto_compact 关掉：本场景只验**读数与警示的呈现**，不断言自动压缩——开着的话 ctx 90%
    # 会触发一轮 compact（再向 mock 要一次响应、fixture 弹尽），把判据搅浑。
    autoCompact: false
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 控制行在位（发送钮）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 还没有警示文案（hover 浮层默认收起，未越线时也没有浮层内容）
        ax: { not: "越过 85% 警示线" }

  - name: 输入提问并 Enter 发送
    do: keys
    keys: ["o", "v", "e", "r"]
  - name: 发送
    do: key
    key: enter

  - name: 等回答到达（usage 118000/131072 ≈ ctx 90%，cached 59000/118000 = cache 50%——确定越线）
    do: waitFor
    waitFor:
      has: ["用量越线回答。"]
    expect:
      - label: 控制行读数 = ctx 90% • cache 50%（118000/131072 与 59000/118000 四舍五入）
        ax: { has: "90% • 50%" }
      - label: 警示文案默认不在界面上（M370：常驻条与 ⓘ 点击气泡都退场，说明只在 hover 读数时浮出）
        ax: { not: "越过 85% 警示线" }
      - label: ⓘ 钮时代已去——D377 读屏名随钮移除，界面上没有它
        ax: { not: "上下文用量说明" }
      - shot: 01-读数越线-警示收起

  - name: 确认 hover 形态没有留下常驻可见的警示句（settle 后复读，挡「闪一下又收」的假绿）
    do: settle
    expect:
      - label: 稳态下警示文案仍不在 AX 树里
        ax: { not: "越过 85% 警示线" }
---

spec 判据（harness「上下文用量显示与触顶处理」，M370 改形后）：读数越过警示阈值
（`[harness].warn_ctx_pct`，缺省 85）时读数高亮（--pending 族，配色面归视觉层），警示说明
= **hover 读数时浮出的 D335 浮层**（Alex 2026-10-07 裁决「去掉感叹号……当使用率超过 85% 时，
XX% hover 时显示」）。入口三代沿革：常驻警示条（M346 前）→ ⓘ 钮点击气泡（M347）→ hover
读数浮层（M370）；常驻可见的警示文案在任何一代之后都不该出现。

- 本场景用默认阈值 85：mock 的 usage 取 118000/131072 ≈ 90.03% ⇒ 读数 90%，cached
  59000/118000 = 50.0% ⇒ 双读数「90% • 50%」，确定越线。`auto_compact` 关掉（见
  front-matter 注释）——本场景判的是**读数与警示的呈现**，压缩行为本身在别的通道判
  （`session.rs` 单测与 mock 的 overflow 响应）。
- **真机套件没有 hover 动词**（runner 的 step 集只有 click/keys 等）——hover 翻浮层的正观测
  归 chromium 视觉层（`tests/visual/scenes/m347-harness-composer.spec.ts` 用 playwright
  hover 断言浮层显隐）。本场景判真机面：双读数上屏、警示文案**默认收起**（`not: "越过 85%
  警示线"`——该串只在浮层文案里出现；浮层 hidden 时不进 AX 树）、稳态复读（settle 后
  再断一次，挡「闪一下又收」的假绿）。
- 「ⓘ 钮已移除」的回归守卫：`not: "上下文用量说明"`（D377 随钮退场、编号停用——串重现
  即说明旧入口回归）。未越线时的负观测归场景 76。

## 已知边界

- **高亮本身是配色**：`is-warn` 类改的是读数颜色，AX 读不到色值；读数的存在与警示文案的
  收态是可判的部分，配色观感归视觉层（m347 场景的计算属性断言 + 像素基线）。
- **hover 显隐不在本场景**：见上——套件无 hover 动词；若在 runner 加了 hover 动词，可把
  m347 的 hover 断言镜像一条过来。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；真实 vault 只读。
- 只读文档、发一条 mock 提问；JSONL 落在隔离配置目录。1420 全程不碰，套件走自带 1430。
