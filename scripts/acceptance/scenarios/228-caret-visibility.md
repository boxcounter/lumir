---
id: "228-caret-visibility"
item: 228
title: 光标可见性——属性盒按下即进 YAML 源码（不再出现贯穿整块的竖线）、doc-title / 正文按下不改文档、光标 2px 且以约 1.2s 周期闪烁（light + eink 截图证据）
fixtures: [caret-fm.md]
open: caret-fm.md
marker: "正文首行"
steps:
  - name: 起点：属性盒渲染态（frontmatter 围栏不在可见文本里）
    do: settle
    expect:
      - label: 渲染态：frontmatter 围栏 `---` 被属性盒替换（源围栏不进可见文本——本场景「是否显露」的判据就取它）
        editor: { not: "---" }
      - label: 正文可读（正向锚点，证明文档真的打开了）
        editor: { has: "正文首行" }
      - label: 起点是干净的（没有未保存标记）
        ax: { not: "（未保存）" }
      - shot: 起点-属性盒渲染态

  - name: 记录文档基线（本场景的手势一个都不许改文档；sha256 + mtime 双口径）
    do: record
    file: caret-fm.md
    as: 文档基线

  - name: 点属性盒（编辑器顶边 dy=6 落在属性盒首行）
    do: clickEditor
    dy: 6
    expect:
      - label: 属性盒按下即进源码编辑态（围栏回到可见文本 = 属性盒已撤下、换成了 YAML 源码）
        editor: { has: "---" }
      - label: 光标落在 YAML 行里——源行形态（渲染态的键值分列不含冒号与空格，所以这一条只在源码态成立）
        editor: { has: "title: 示例笔记" }
      - label: 零写盘（sha256 + mtime 双比：显露不改文档）
        file: { path: caret-fm.md, unchangedSince: 文档基线, mtimeUnchangedSince: 文档基线 }
      - label: 没有变 dirty
        ax: { not: "（未保存）" }
      - shot: 点击属性盒-显露-YAML

  - name: 点正文（编辑器下段），选区离开 frontmatter
    do: clickEditor
    dy: 300
    expect:
      - label: 选区离开块 → 属性盒恢复渲染（围栏再次不在可见文本）
        editor: { not: "---" }
      - label: 零写盘（进出源码态都不改文档）
        file: { path: caret-fm.md, unchangedSince: 文档基线, mtimeUnchangedSince: 文档基线 }
      - shot: 点击正文-属性盒恢复

  - name: 记录可见文本基线（合成面点击 MUST NOT 改变它）
    do: recordEditor
    as: 可见文本基线

  - name: 点 doc-title（属性盒下方折叠的标题行；y 坐标按本 fixture 的 3 行属性盒标定）
    do: clickEditor
    dy: 110
    expect:
      - label: 合成面不是源码入口——属性盒 MUST NOT 撤下（围栏不进可见文本）
        editor: { not: "---" }
      - label: 可见文本逐字节不变（点标题不把光标放进 YAML、不改渲染态）
        editor: { unchangedSince: 可见文本基线 }
      - label: 零写盘
        file: { path: caret-fm.md, unchangedSince: 文档基线, mtimeUnchangedSince: 文档基线 }
      - shot: 点击-doc-title-属性盒仍在

  - name: 切 eink 主题（配置通道；重启生效，与场景 35 同款口径）
    do: configWrite
    theme: eink
    expect:
      - label: 隔离 config.json 里 ui.theme = eink
        file: { path: "env:config.json", has: '"theme": "eink"' }

  - name: 重启后重新打开文件（不靠会话恢复）
    do: open
    file: caret-fm.md
    marker: "正文首行"
    expect:
      - label: 文档已装载（eink 档）
        editor: { has: "正文首行" }
      - label: eink 下属性盒仍是渲染态（该档的光标同为 2px + 约 1.2s 闪烁，靠本步截图人工过目）
        editor: { not: "---" }
      - shot: eink-起点-属性盒渲染态

  - name: eink 档点属性盒
    do: clickEditor
    dy: 6
    expect:
      - label: eink 档同样按下即进源码（行为不随主题变化）
        editor: { has: "---" }
      - label: 零写盘
        file: { path: caret-fm.md, unchangedSince: 文档基线, mtimeUnchangedSince: 文档基线 }
      - shot: eink-点击属性盒-显露-YAML

  - name: 回到出厂默认主题（给后续场景留干净起点）
    do: configWrite
    theme: light
    expect:
      - label: 配置回到 light
        file: { path: "env:config.json", has: '"theme": "light"' }
---

# 场景 228：光标可见性（change `cursor-visibility-oct23`，M654；2026-10-24 改裁恢复闪烁）

Alex 2026-10-23 原话：「1. 当点击 frontmatter 时，光标特别高（截图：frontmatter 区域光标是一条
贯穿整个 frontmatter 块高度的竖线，远超行高）2. 光标太细，不容易快速一眼扫到」。
本场景判**真机 WKWebView 上的行为链路**；光标矩形的几何与光标闪烁的机器判据在 chromium 层
（`tests/visual/scenes/m647-caret-geometry.spec.ts`），不在本场景重复。

2026-10-24 改裁（Alex 反馈 #6「光标可见性调地有些过头了 —— 现在光标不闪了，也不容易一眼
扫到」）：D2 由「2px 常亮」改判「2px + 约 1.2s 闪烁」。本场景的可见文本 / 文档不变断言
不受影响；截图里的光标可能落在亮的相位、也可能落在灭的相位（截图不控制动画相位），
闪烁节奏以 m647 的计算样式与相位读数为准。

## 判据为什么这样写

- **「属性盒是否撤下」的真机读数是可见文本里的围栏**：套件的 `editor` 断言读的是
  AXTextArea 的**可见文本**（先例：`render-markdown` 场景的 `editor: { not: "---" }` 判分隔线与
  frontmatter 已渲染）。渲染态下围栏与 YAML 原文都不在可见文本里；显露后它们逐字回来。
  因此 `not: "---"` / `has: "---"` 是「属性盒在场 / 撤下」的直接读数，而不是靠截图猜。
- **点击入口只能按坐标**：编辑器内元素没有 AX bbox（README「编辑器内元素没有 AX bbox」），
  所以用 `clickEditor` 从 AXTextArea 顶边往下取点。dy=6 落在属性盒首行；dy=300 落在正文；
  dy=110 按本 fixture 的 3 行属性盒 + 折叠标题的位置标定——**这三条坐标是本场景唯一脆弱处**，
  若属性盒高度变了（改了行高 / 间距），dy=110 可能落空；落空的形态是「点的是正文」，本场景的
  断言不会因此误报产品缺陷（可见文本仍不变），但「点了标题」这件事只剩截图证据。
- **零写盘**：`file.unchangedSince`（sha256）+ `mtimeUnchangedSince`（mtime）成对用——
  写了同一份内容时 sha256 相同而 mtime 会推进。显露、光标归一与指针入口 MUST NOT 改文档
  （合同 C5 / ADR 0003 §3）。
- **合成面点击用 `editor.unchangedSince`**：点 doc-title 不改变可见文本（属性盒不撤下、光标仍在
  原行），所以「可见文本逐字节不变」是这一步的行为判据；它同时挡住「点标题顺手把光标放进
  YAML」的回归。

## 覆盖边界（如实记账）

- **光标矩形的高度（C1）与闪烁节奏真机 AX 不可断言**：KimiCU 的 AX 不暴露
  `AXSelectedTextRange`，也没有光标矩形节点；截图还可能恰好落在闪烁的「灭」相位。本场景给的是
  「光标是短竖线 / 属性盒是否撤下」的截图证据（light + eink）；高度 = 行盒、2px 宽度、
  1.2s 闪烁（计算样式 + 亮 / 灭相位）的机器判据在 m647 场景（chromium 层），观感归 Alex
  手感项。
- **点击落点的精度**（点击位置与显露后光标所在的 YAML 行是否大致对应）不在这里断言：
  属手感项（design §5.2 的已知代价），截图留证、Alex dogfood 判。
- **本场景不验**：拖拽跨块、⌘A、goto-line 第 1 行的边界（事务层已由 m647 + 单测
  `tests/unit/frontmatter-caret.test.ts` 覆盖；真机不再多花一次启动成本）。
