---
# M644（change improve-harness-streaming-scroll，design §5.3）：流式输出期间上滚后阅读位置保持、
# 「回到底部」浮钮浮现 / 保持 / 点击退场，点后底部一行带确有字形。
#
# 真机判据只落在**钮的在场与否 + 像素**上：WKWebView 不暴露 scrollTop（README「已知边界」的
# 滚动条），AX 里「有文字」也不代表视口停在哪儿（离屏内容同样在 AX 树里）——不用 AX 文本冒充
# 滚动生效。
#
# 滚动通道：本场景的 `do: scroll` 显式写 `dy`（行数）。KimiCU 的 scroll 在本 app 上从未产出过
# 位移（M252 / M379 的通道边界），因此套件在它自报无位移时退化到 M644 新增的 swift + CGEvent
# 滚轮注入（`lib/cgevent-click.swift` mode 8，与 doubleClick / drag 同一条已验证通路）。
# 这条兜底是**本次首次落地、尚未在真机跑过**：首跑时若步骤 5 的 `scroll` 仍判红，按 README
# 「已知边界」的滚动条先核通道（证据里有「退到滚轮注入」的自报行），再核产品行为。
id: "224-harness-scroll-lock"
item: 224
title: harness 流式输出期间的跟随滚动与回到底部（M644）：上滚后视口不被拽回、浮钮浮现/保持/退场
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-scroll-lock.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮在场是本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }
      # 静态前提：跟随态 / 内容不足一屏时回底钮不在场（D2 的负向面，正观测在步骤 5）。
      - label: 初始态没有回到底部钮（跟随态、无内容）
        ax: { not: "回到底部" }

  - name: 输入一条提问（串里不含 'e'，避开逐键注入的确定性丢键）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|slk" }
    text: "slk 滚动锁验证"
    expect:
      - label: 提问落在 composer 里（注入落地——下一步 Enter 才有东西可发）
        ax: { has: "slk 滚动锁验证" }
  - name: 发送
    do: key
    key: enter

  - name: 等首片上屏（流式窗口由此打开：mock 逐片产出，片间隔 600ms）
    do: waitFor
    waitFor:
      has: ["SLK-A"]
    timeoutMs: 30000
    expect:
      - label: 首片正文已在 transcript 里
        ax: { has: "SLK-A" }
      - label: 首片到达时仍在跟随态（还没上滚，钮不该出现）
        ax: { not: "回到底部" }
      - shot: 01-首片已上屏

  - name: 等内容长到足以溢出视口（上滚才有可滚的距离）
    do: waitFor
    waitFor:
      has: ["SLK-07"]
    timeoutMs: 60000
    expect:
      # 前提守卫：内容确实高过视口。没有这个前提，上滚步骤会对着不可滚的现场空转
      #（REVIEW.md「断言等价于子串」条的同族形态）。视口高度读不到（AX 不暴露），
      # 判据取「至少 7 片 × 4 段 ≈ 28 个段落」，按行高 19.5px 已明显超过一屏。
      - label: 内容已足够高，上滚一屏在物理上成立
        ax: { has: "SLK-07" }
      - label: 到达这里仍在跟随态（还没上滚，钮不该出现）
        ax: { not: "回到底部" }

  - name: 在 transcript 上上滚一屏（视口离开底部）
    do: scroll
    target: { x: 900, y: 350 }
    dy: -20
    settleMs: 900
    expect:
      # 通道自证：滚轮真的产生了位移。KimiCU 通道在本 app 上产不出位移，失败时套件会退到
      # swift + CGEvent 的 wheel mode（证据里记一条自报行）；本步骤一旦报错就是通道问题，
      # 不是产品行为——README「已知边界」的滚动条。
      - label: 上滚后「回到底部」钮浮现（脱离态被检测到；缺陷形态下钮根本不存在，本条有区分度）
        ax: { has: "回到底部" }
      - shot: 02-上滚后浮钮在场

  - name: 等末片上屏（其余片继续逐片到达，但视口必须停在原处）
    do: waitFor
    waitFor:
      has: ["SLK-Z"]
    timeoutMs: 60000
    expect:
      - label: 末片真的到达了（内容确有其事——钮的在场不是空转读数）
        ax: { has: "SLK-Z" }
      - label: 全部增量落地后钮仍在场（没有任何一次增量把视口拽回并让钮退场）
        ax: { has: "回到底部" }
      - label: 未读提示随新内容点亮（可访问名变「有新内容」档；圆点本身是 aria-hidden 的视觉件）
        ax: { has: "有新内容" }
      - shot: 03-末片后浮钮与未读仍在

  - name: 点「回到底部」浮钮
    do: click
    target: { role: AXButton, name: "回到底部" }
    settleMs: 900
    expect:
      - label: 回底后钮退场（隐藏即离开 AX 树）
        ax: { not: "回到底部" }
      - label: 未读提示一并清除（名字不再含「有新内容」）
        ax: { not: "有新内容" }
      - shot: 04-点钮回底后

  - name: 底部一行带确有字形（「真的回到底部」，不是按钮自说自话）
    do: settle
    expect:
      # 采样点与阈值按场景 118 的同款口径（窗口局部点 + pixel.contrast，min: 60）。
      # 首跑标定：坐标随面板分栏 / 字号变化，首跑截图（04-点钮回底后.png）对齐一次；判据
      # 意图是「transcript 底部那一带画着正文」，不是固定像素值。
      - label: transcript 底部一行带有可辨字形（空白带 = 没滚到底或内容没渲染）
        pixel:
          contrast:
            - { x: 900, y: 612, as: "底部正文带", min: 60 }
---

# 这个场景验什么

Alex 2026-10-23 原话：「改进 harness pane 流式输出时的可操作性：只要正在输出，我就无法阅读
AI 的输出，因为在快速滚屏，用鼠标往上滚动也不行，立刻会被流式输出拽到底部。」

本场景在**真实 WKWebView** 下验行为面（chromium 层的主判据在
`tests/visual/scenes/m638-harness-scroll-lock.spec.ts`，这里不重复）：

1. 首片到达时在跟随态、没有回底钮；
2. 上滚一屏后回底钮浮现（脱离态被检测到）——缺陷形态下钮不存在，这条有区分度；
3. 其余分片（含末片）逐片到达期间，视口停在用户滚到的位置：判据 = 钮**仍在场**、未读提示点亮。
   若实现退化成「每次增量无条件贴底」，每片都会把视口拽回并让钮退场，第二条就红；
4. 点钮回底：钮退场、未读清除；
5. 回底后底部一行带确有字形（`pixel.contrast`）——证明真的回到了内容末尾。

## 判据为什么这样分

- **不用 AX 文本判滚动位置**：WKWebView 的 AX 树包含离屏内容，「AX 里有末片文字」在视口
  停在中部时同样成立；套件也没有 scrollTop 读数（README「已知边界」的滚动条）。能用的只有
  「钮在不在」与像素。
- **未读断言取可访问名**：圆点是 `aria-hidden` 的视觉件，语义载体是钮的名字（D556
  「有新内容，回到底部」）——屏幕阅读器与 AX 通道读的是同一份文案。
- **底部像素用的不是坐标真源**：坐标只是采样手段，判据是「这一带有没有字形」（亮度跨度）。
  首跑按截图对齐一次坐标即可，不改判据。

## 已知边界

- **滚动通道**：`do: scroll` 在本 app 上的 KimiCU 通道从未产出过位移（M252 / M379）；本场景
  依赖 M644 新增的 wheel 注入兜底（`lib/cgevent-click.swift` mode 8）。这条兜底**尚未在真机
  验证**：首跑若步骤 5 红，先看证据里 `scroll：KimiCU 通道自报…退到 swift + CGEvent 滚轮注入`
  那条自报行——报错 = 通道问题，钮该出现却没出现 = 产品缺陷。
- **采样点**：`pixel.contrast` 的点是窗口局部点，随面板分栏比例 / 字号缩放漂移；首跑对齐一次。
- 真机执行由 tower 协调窗口（本次实现只做到静态校验 + 场景落地）；证据落
  `.local/acceptance/<日期>/224-harness-scroll-lock/`。
