---
id: "883-file-open-harness-affordance"
item: 883
tier: full
title: 文件树打开意图（普通点击=当前标签、⌘点击=新标签并保留）与无标签时 Harness 图标贴右缘 / 文案
fixtures: [tabs-a.md, tabs-b.md]
open: tabs-a.md
marker: "标签场景 A"
steps:
  - name: 起点：一个标签、编辑器装载 tabs-a
    do: settle
    expect:
      - shot: 起点
      - label: 编辑器装载 tabs-a
        editor: { has: "标签场景 A" }
      - label: 标签栏只有一个标签
        ax: { count: { pattern: "关闭 ", exact: 1 } }

  # change improve-file-open-harness-affordance-nov26 的合同 1：普通点击 = 当前标签就地打开。
  - name: 普通点击 tabs-b——当前标签就地打开（不新开、旧内容不再保留）
    do: click
    target: { role: AXButton, name: "^tabs-b\\.md$" }
    expect:
      - shot: 当前标签已换成 tabs-b
      - label: 正文换成 tabs-b
        editor: { has: "标签场景 B" }
      - label: 旧文档正文不在编辑器里（当前标签被就地替换）
        editor: { not: "标签场景 A" }
      - label: 标签总数不变（没有新开）
        ax: { count: { pattern: "关闭 ", exact: 1 } }

  - name: 键入让当前标签 dirty（后面验 ⌘-点击不改动它）
    do: type
    text: "NOV26"
    expect:
      - label: 输入落进文档
        editor: { has: "NOV26" }
      - label: 未保存标记在场（D90）
        ax: { has: "（未保存）" }

  - name: 拿前台（修饰键点击走真实指针通道，要求 Lumir 是 key window）
    do: focusWindow
    retries: 4

  # 合同 1 的另一半：⌘-点击 = 新开标签并保留当前标签（内容 / 未保存状态都不动）。
  - name: ⌘-点击 tabs-a——新开一个标签并激活
    do: click
    target: { role: AXButton, name: "^tabs-a\\.md$", modifiers: ["cmd"] }
    expect:
      - shot: 两个标签
      - label: 新标签上屏 tabs-a
        editor: { has: "标签场景 A" }
      - label: 现在有两个标签（现有标签没有被顶掉）
        ax: { count: { pattern: "关闭 ", exact: 2 } }

  - name: ⌘1 切回原标签——内容与未保存状态原样保留
    do: key
    key: "cmd+1"
    expect:
      - shot: 切回原标签
      - label: 键入的探针仍在正文里
        editor: { has: "NOV26" }
      - label: 未保存状态没有被 ⌘-点击带走
        ax: { has: "（未保存）" }

  # 收尾到无标签态（先保存再关，避免走关闭确认——那条路径由场景 14 覆盖）。
  - name: 保存当前标签（清 dirty）
    do: key
    key: "cmd+s"
    expect:
      - label: 落盘后未保存标记消失
        ax: { not: "（未保存）" }

  - name: ⌘W 关掉当前标签，再 ⌘W 关掉剩下的一个——回到无标签空态
    do: key
    key: "cmd+w"
    expect:
      - label: 只剩一个标签
        ax: { count: { pattern: "关闭 ", exact: 1 } }
  - name: 关掉最后一个标签
    do: key
    key: "cmd+w"
    expect:
      - shot: 无标签空态
      - label: 标签全部关闭
        ax: { count: { pattern: "关闭 ", exact: 0 } }

  # 合同 2：没有任何 TAB 时 harness toggle 贴标题栏右端（左栏宽 236px 处是旧缺陷的落点）。
  # 真机套件读不到任意节点的 bbox（geom 只有可见性 / 最小宽高），因此判据取**可点性**：
  # 点窗口右上角（1200 宽窗口的 x≈1180、标题栏中线 y=21）能打开 harness pane——旧缺陷下
  # 该点落在标题栏空白（drag region），点击不产生任何结果。
  #
  # 为什么带 `modifiers: ["shift"]`：套件的 `click {x,y}` 无修饰键时走 KimiCU 的**截图像素**
  # 坐标，而有修饰键时走 `windowLocalTarget` 的**窗口局部点**（与 doubleClick / hover 同一份
  # 换算）。toggle 不区分修饰键（DOM click 照常触发），因此用 shift 只是选中窗口局部点通道，
  # 不改任何产品语义。
  - name: 拿前台（真实指针点击要求窗口在最前）
    do: focusWindow
    retries: 4
  - name: 点窗口右上角（右端 toggle 的真实落点；窗口局部点通道）
    do: click
    target: { x: 1180, y: 21, modifiers: ["shift"] }
    expect:
      - shot: 从右端图标打开 harness pane
      - label: harness pane 真的打开了（右端那颗图标可点）
        ax: { has: "问点什么" }

  # 合同 3：hover / 可访问名用 Harness 措辞。
  - name: ⌘⇧A 收起 harness pane，toggle 回到标题栏右端
    do: key
    key: "cmd+shift+a"
    expect:
      - label: 面板收起后 toggle 在场且读屏名取 D327（zh 档）
        ax: { has: "/AXCheckBox \\(Harness 面板\\)/" }
      - label: 旧措辞不再出现在可读身份里
        ax: { not: "/AXCheckBox \\(对话面板\\)/" }
  - name: 悬停提示同为 Harness 面板（空闲态逐字 D327）
    do: hover
    target: { role: AXCheckBox, name: "^Harness 面板$" }
    expect:
      - shot: 右端图标（无标签）
      - label: hover 提示（AX help）逐字是 Harness 面板
        ax: { has: "Harness 面板" }
---
# 883-file-open-harness-affordance —— 文件树打开意图 + 无标签 Harness 图标

change `improve-file-open-harness-affordance-nov26` 的三条合同在本场景的真机判据：

1. **普通点击 = 当前标签就地打开**：点第二个文件后标签总数仍是 1，正文换成目标文件、旧文档
   正文不再在编辑器里（`editor.not` 是「就地替换」与「新开一个」的区分判据——新开时旧文档
   仍留在后台标签里，`editor.not` 会红）。
2. **⌘-点击 = 新开标签并保留当前标签**：标签数 1 → 2；切回原标签时键入探针与
   `（未保存）` 都还在——证明 ⌘-点击没有改动当前标签的文档内容或 dirty 状态。
3. **无标签时图标贴右端 / 文案**：关掉全部标签后点窗口右上角（x=1180、y=21）能打开 harness
   pane。旧缺陷下 toggle 紧贴左栏宽（236px）右缘，该点落在标题栏空白处，点击不产生结果；
   面板打开 / 收起后读屏名与 hover 提示取 D327 的 zh 档「Harness 面板」。

## 为什么位置判据用「可点性」而不是几何

验收套件没有任意节点的 bbox 读数（`geom` 断言只支持 target + minWidth / minHeight /
painted，见 `scripts/acceptance/README.md` 的断言表）。坐标点击是套件已有的真实指针通道，
落点固定在窗口右上角：产品把图标放在右端时点击命中，放在左栏宽处时同一坐标不命中——两端
的可观察结果不同，判据因此有区分度。像素级落位（右缘 = 视口右缘 − 12px）由视觉结构层
`tests/visual/scenes/titlebar-identity.spec.ts` 的 boundingBox 断言守。

## 已知边界

- 本场景用 `modifiers: ["cmd"]` 走 swift + CGEvent 通道（M379），要求 Lumir 是 key window；
  `focusWindow` 步骤只把 app 拿到前台、不做正文单击（不改变编辑器焦点）。
- 图片文件不在本条合同内（`openImage` 没有「就地替换」态，普通点击图片仍新开图片标签；
  边界见 proposal「已知边界与风险」）。
- 普通点击替换一个 **dirty** 标签会丢未保存内容（既有 `openFile("current")` 没有 dirty
  守卫）。本场景刻意先切到一个干净标签再收尾，不把那条风险固化成期望；风险本身交
  tower / Alex 裁决是否另立项。
