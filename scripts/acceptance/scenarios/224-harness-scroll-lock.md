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
#
# dy 的符号（M669 真机标定，M667 的 A/B 读数）：**正数 = 上滚**（视口向文档开头移动），与
# KimiCU legacy `dy` 的约定同向；`dy: 20` 让视口离开底部、浮钮浮现，`dy: -20` 在本 app 上
# 不产生任何位移（M667 现场：同点位 sha256 前后相同）。README「已知边界」的滚动条同口径。
#
# 判据形态：浮钮 / 未读提示一律用 `node`（AXButton 节点在场性）——`ax.has` 在 AX 树**文本**上
# 匹配，而 fixture 正文里写着「浮钮」这类人话，裸串断言会恒红 / 恒绿（M667 的 224 现场）。
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
      # 节点在场性判据（不是 `ax.not` 裸串）：正文里的「浮钮」字样不会满足它。
      - label: 初始态没有回到底部钮（跟随态、无内容）
        node: { role: AXButton, name: "回到底部", present: false }

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
        node: { role: AXButton, name: "回到底部", present: false }
      - shot: 01-首片已上屏

  - name: 等内容长到足以溢出视口（上滚才有可滚的距离）——等首片的尾标记
    do: waitFor
    waitFor:
      has: ["SLK-A-END"]
    timeoutMs: 60000
    expect:
      # 前提守卫：内容确实高过视口。没有这个前提，上滚步骤会对着不可滚的现场空转
      #（REVIEW.md「断言等价于子串」条的同族形态）。视口高度读不到（AX 不暴露），
      # 判据取首片自身：fixture 的首片就是 24 段正文 + 尾标记 SLK-A-END（≈48 行、
      # 按行高 19.5px 已明显超过一屏）。
      # **为什么等首片而不是第 N 片**（M669 实测）：AX 轮询本身很重（每读 ~700–800ms），
      # 前端的流式 rAF 被它拖慢，实测「第 7 片可见」比后端发出晚 7–14s，等到它时流已经
      # 结束——未读判据要的是「视口脱离**之后**内容仍在长」，那样没有增长窗口。首片
      # 自己撑满视口 ⇒ 上滚立刻发生，剩余 7 片全部落在滚动之后。
      - label: 内容已足够高，上滚一屏在物理上成立
        ax: { has: "SLK-A-END" }
      - label: 到达这里仍在跟随态（还没上滚，钮不该出现）
        node: { role: AXButton, name: "回到底部", present: false }

  - name: 让窗口成为 key window 并把焦点放回 webview（真实正文单击；首个 mousedown 会被激活吃掉）
    do: focusWindow
    retries: 4
    click: true

  - name: 在 transcript 上上滚一屏（视口离开底部）
    do: scroll
    target: { x: 900, y: 350 }
    dy: 20
    wheel: true
    settleMs: 900
    expect:
      # 通道自证：滚轮真的产生了位移。KimiCU 通道在本 app 上产不出位移，失败时套件会退到
      # swift + CGEvent 的 wheel mode（证据里记一条自报行）；本步骤一旦报错就是通道问题，
      # 不是产品行为——README「已知边界」的滚动条。dy 符号已标定：正数 = 上滚。
      - label: 上滚后「回到底部」钮浮现（脱离态被检测到；缺陷形态下钮根本不存在，本条有区分度）
        node: { role: AXButton, name: "回到底部", present: true }
      - shot: 02-上滚后浮钮在场

  - name: 等本轮收口（流式结束；期间视口必须停在原处）
    do: waitFor
    waitFor:
      has: ["SLK-05"]
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 60000
    expect:
      # 「末片真的到达」不用末片标记判：这条消息很长（首片 40 段 + 19 片），KimiCU 的
      # AX dump 会把超长 value 截断（`truncated: [closed_menu, fanout_cap]`，末片串不在
      # 里面）——拿它当判据是「读不到当成没有」（REVIEW.md「读不到当成空」条的同族）。
      # 改用两条可判读数：中段片在场（内容确有其事）+ 回合收口（停止钮退场 = 流式结束），
      # 后者同时给出「增量是否会把视口拽回」的终态时刻。
      - label: 中段内容确实落地了（内容确有其事——钮的在场不是空转读数）
        ax: { has: "SLK-05" }
      - label: 全部增量落地后钮仍在场（没有任何一次增量把视口拽回并让钮退场）
        node: { role: AXButton, name: "回到底部", present: true }
      - label: 未读提示随新内容点亮（可访问名变「有新内容」档；圆点本身是 aria-hidden 的视觉件）
        node: { role: AXButton, name: "有新内容", present: true }
      - shot: 03-收口后浮钮与未读仍在

  - name: 点「回到底部」浮钮
    do: click
    target: { role: AXButton, name: "回到底部" }
    settleMs: 900
    expect:
      - label: 回底后钮退场（隐藏即离开 AX 树）
        node: { role: AXButton, name: "回到底部", present: false }
      - label: 未读提示一并清除（名字不再含「有新内容」）
        node: { role: AXButton, name: "有新内容", present: false }
      - shot: 04-点钮回底后

  - name: 底部一行带确有字形（「真的回到底部」，不是按钮自说自话）
    do: settle
    expect:
      # 采样点与阈值按场景 118 的同款口径（窗口局部点 + pixel.contrast，min: 60）。
      # 坐标按 M669 首跑截图标定：harness pane 的正文列很窄（截图像素 x≈710–900），
      # 原先的 (900,612) 落在行尾右侧的空白带上（读数 253..253、跨度 0，恒红）。
      # 现取末段「SLK-Z 末片：…」那一行（视口回底后固定在底部起第四行），窗口局部
      # (760,589) → 截图像素 ≈ (730,565)，落在字形带上。坐标随分栏 / 字号漂移，改布局重标。
      - label: transcript 底部一行带有可辨字形（空白带 = 没滚到底或内容没渲染）
        pixel:
          contrast:
            - { x: 760, y: 589, as: "底部正文带", min: 60 }
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
- **浮钮 / 未读提示用 `node` 断言（节点在场性），不用 `ax.has`**：`ax.has` / `ax.not` 在 AX
  树**文本**上匹配，而 transcript 的正文（`AXStaticText`）与 fixture 同一份字都进树——M667
  首跑时 fixture 正文里写着「…回到底部…」，负向断言恒红、正向断言恒绿（产品行为其实是对的）。
  `node` 走 `findNode`（role 精确 + name 裸正则源），正文里的字不构成节点。fixture 正文也
  同步删掉了这两处判据串（README「加一个场景」的判据串禁则）。
- **未读断言取可访问名**：圆点是 `aria-hidden` 的视觉件，语义载体是钮的名字（D556
  「有新内容，回到底部」）——屏幕阅读器与 AX 通道读的是同一份文案。
- **底部像素用的不是坐标真源**：坐标只是采样手段，判据是「这一带有没有字形」（亮度跨度）。
  首跑按截图对齐一次坐标即可，不改判据。

## 已知边界

- **滚动通道**：`do: scroll` 在本 app 上的 KimiCU 通道从未产出过位移（M252 / M379）；本场景
  依赖 M644 新增的 wheel 注入兜底（`lib/cgevent-click.swift` mode 8）。M669 真机复跑里发现
  KimiCU 有一次**自报成功却滚错了元素**（转写面的 scrollTop 没变、兜底因此没触发、浮钮不出现
  ——证据里也没有兜底自报行），所以本步骤显式写 `wheel: true`：跳过 KimiCU、直接投真实滚轮。
  M669 复跑验证了这条通道真的产位移（`dy: 20` 后浮钮浮现）。**dy 正数 = 上滚**（与 KimiCU
  legacy `dy` 同向，M667 的 A/B 读数与 M669 复跑一致）；报错 = 通道问题，钮该出现却没出现 =
  产品缺陷。
- **key window 前置**：滚轮注入落在 key window 上；「启动即在前台」时窗口未必是 key（M667：
  第一次 KimiCU 点击被激活吃掉、红绿灯转灰）。上滚步之前因此有一次 `focusWindow click: true`
  ——它发一次**真实正文单击**（落在编辑器顶部留白）并在 AX 里校验「编辑器真的拿到了焦点」
  （M678；建立不起来就再点，耗尽按 INVALID 收场）。**MUST NOT 改回点标题栏**：标题栏是拖拽区，
  真实单击会让 webview 失焦，M670 的根因——本场景的滚轮与浮钮判据都在那条通道上。
- **末片标记不参与判据**：这条消息较长（首片 24 段撑满视口 + 7 片），KimiCU 的 AX dump 会
  按 fanout_cap 截断转写面子树（末片串与浮钮节点都可能读不到——截断量与内容长度相关）。收口判据改用「中段片在场 + 停止钮退场」（两条可判读数），
  README「已知边界」的 AX 截断条同口径。
- **采样点**：`pixel.contrast` 的点是窗口局部点，随面板分栏比例 / 字号缩放漂移；首跑对齐一次。
- 证据落 `.local/acceptance/<日期>/224-harness-scroll-lock/`。
