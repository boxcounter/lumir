---
id: "120-list-lazy-continuation-indent"
item: 120
title: 列表末尾退出后的行键入字符落在行首（M421）——Enter 造空项 → 再 Enter 删标记 → 键入字符，源码落在第 1 列、渲染在行首（lazy continuation 不按列表项缩进）
fixtures: [empty-line-list.md]
open: empty-line-list.md
marker: "alpha"
steps:
  - name: 起点：两 item 列表已打开，光标在文档首行
    do: clickEditor
    expect:
      - label: 打开成功（渲染态可读——正向锚点，本次 AX 读取是活的）
        editor: { has: "alpha" }
      - label: 起点没有空行（后面「不新增行」的判据因此有区分度；用 /\\n\\n/ 而非 /^$/——后者会被尾随换行假绿）
        file: { path: empty-line-list.md, not: '/\n\n/' }
      - label: 起点没有 marker-only 行（后面 `^- $` 断言的正向对照）
        file: { path: empty-line-list.md, not: '/^- $/' }
      - label: 焦点落在编辑器正文里（键盘注入的前置）
        ax: { focused: "AXTextArea" }
      - shot: 起点-两item列表

  - name: 光标移到第二项行尾（⌃N 下移一行、⌃E 到行尾；fixture 只有两行 ⇒ 即文档末尾）
    do: keys
    keys: ["ctrl+n", "ctrl+e"]

  - name: Enter：在列表末尾续出空的第三项（命令层既有行为）
    do: key
    key: "return"

  - name: 落盘（⌘S 发两次换一次丢键的容错——chord 盲发不重试）
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对空项已创建
    do: sleep
    ms: 1200
    expect:
      - label: marker-only 行在场（`- `）——定位键（⌃N / ⌃E）与 Enter 都真的落了地
        file: { path: empty-line-list.md, has: '/^- $/' }
      - label: 前两项逐字节未动
        file: { path: empty-line-list.md, has: '/^- alpha$/' }
      - label: 第二项仍在（续行是在它之后追加，不是改写它）
        file: { path: empty-line-list.md, has: '/^- bravo$/' }
      - shot: 空item已创建

  - name: 在空项上再按 Enter（M399 裁决：删去一级列表标记、该行保留、光标在该行行首、不新增行）
    do: key
    key: "return"

  - name: 落盘
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对退出形态
    do: sleep
    ms: 1200
    expect:
      - label: marker-only 行已消失（标记被删去）
        file: { path: empty-line-list.md, not: '/^- $/' }
      - label: 文档没有多出空行（M399 的不变量：行数不变；`\n\n` 形态必红）
        file: { path: empty-line-list.md, not: '/\n\n/' }
      - label: 前两项逐字节未动
        file: { path: empty-line-list.md, has: '/^- alpha$/' }
      - shot: 删标记后-该行应为可见空行且光标在其行首

  - name: 键入一个字符（本场景的被测动作：Alex 报告里「一输入字符就落到缩进位置」的那一步）
    do: keys
    keys: ["x"]
    expect:
      - label: 字符落在编辑器里（正向锚点：可打印单字符走「回读 + 只在字节未变时重试」，落地即被证实）
        editor: { has: "x" }

  - name: 落盘
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对（源码层判据）
    do: sleep
    ms: 1200
    expect:
      - label: 字符独占一行、位于**第 1 列**（`^x$`——源码里没有前导空白，命令层与渲染层都没有把该行改成列表项续行）
        file: { path: empty-line-list.md, has: '/^x$/' }
      - label: 反向：源码里没有缩进的 x（`^ +x$` 形态必红——这是「把该行写回成列表项续行」的形态）
        file: { path: empty-line-list.md, not: '/^[ \t]+x$/' }
      - label: 反向：marker-only 行没有回来（该行没有被重新解成列表项）
        file: { path: empty-line-list.md, not: '/^- $/' }
      - label: 没有把列表变松 / 没有补分隔空行（M408 候选 B 被否决）
        file: { path: empty-line-list.md, not: '/\n\n/' }
      - label: 该行之后没有别的正文（`x` 之后除尾换行外没有内容——后面长出行会在这里红）
        file: { path: empty-line-list.md, not: '/^x\n[\s\S]*\S/' }
      - label: 前两项逐字节未动（只影响被键入的那一行）
        file: { path: empty-line-list.md, has: '/^- alpha$/' }
      - label: '渲染层：字符的左缘落在正文左缘（不在列表项缩进位置）——在「字符所在列」采样，块内有字形才算过（M421 实测：修复态亮度跨度 217、缺陷态该处是纯底色 0）'
        pixel:
          contrast:
            - { x: 383, y: 219, min: 80, as: 字符列 }
      - shot: 键入字符后-字符与光标应在行首（不在列表项缩进位置）

  - name: 光标移开该行（⌃N 到下一行），复核渲染归属不随光标变
    do: keys
    keys: ["ctrl+n"]

  - name: 落盘后复核（渲染归属只由行内容决定，与光标位置无关）
    do: sleep
    ms: 800
    expect:
      - label: 光标移动不改文档（该行仍是第 1 列的 x）
        file: { path: empty-line-list.md, has: '/^x$/' }
      - shot: 光标移开后-该行仍在行首
teardown:
  - label: 收尾：文档停在「两 item 列表 + 第 1 列的 x」
    file: { path: empty-line-list.md, has: '/^x$/' }
  - label: 收尾：列表两项逐字节未动
    file: { path: empty-line-list.md, has: '/^- alpha$/' }
---

# 120 · 列表末尾退出后的行键入字符落在行首（M421）

## 这个场景验什么

Alex 报告原话：「当我在列表删掉空 item（也就是在原有的 list 的最后一个 item 末尾输入 enter 后
自动创建的新的空的 item）后，光标出现在行首这符合预期，但当我输入字符后字符出现在了缩进的位置
这不符合预期，预期是出现在行首。」M408 survey（Obsidian 1.14.4 真机对照）定位为**渲染层缺陷**：
该行源码无缩进、被 lezer 解析进列表项内段落（CommonMark 的 lazy continuation），旧的渲染归属
把它当「项内段落」加 `--lp-list-body` 缩进；Obsidian live preview 编辑层把同形态渲染在顶层左边距。

本场景在真机 WKWebView 上走完报告的那条链路：

1. 两 item 列表 `- alpha` / `- bravo`，光标移到末项行尾；
2. `Enter` 续出空项（`- `，命令层既有行为）；
3. 再 `Enter` 退出（M399 裁决：删标记、该行保留、光标在行首、不新增行）；
4. 键入 `x`——文档终态必须是 `- alpha\n- bravo\nx`（字符在**第 1 列**，没有缩进、没有补空行）。

**fixture 选择**：`empty-line-list.md`（`- alpha\n- bravo`，**无尾随换行**）与 Alex 的操作现场
逐字节同形。带尾随换行的两 item fixture（如 `list-indent-bullet.md`）会让文档多一条空的逻辑行，
「退出」那一步合法地产生两条相邻空行——用后者写「不新增行」的断言会把 fixture 形状误判成缺陷
（M421 首跑实证，见下「判据形态」）。

## 判据走哪几条通道（可读性如实登记）

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 命令链路的落点（光标是否真的在末项行尾、Enter 是否落地） | **落盘后的 vault 文件**：先判 `^- $/` marker-only 行在场（红即定位键或 Enter 丢了），再判它消失 | 真机 AX 读不到光标位；文件形态是这两步唯一的可观测量。`^- $` 此行**同时是后一条负向断言的配对正观测**（REVIEW.md 第 1 条：负向断言不许在空转的现场下结论） |
| 字符落在**源码第 1 列** | 落盘文件 `/^x$/` + 反向 `/^[ \t]+x$/` 必不命中 | `editor` 的 AX 读数是**渲染后**文本（列表标记被 widget 替换、行首空白不进 AX），源码级判据只能从磁盘取（套件 README「已知边界」） |
| 行没有被写成列表项续行 / 列表没变松 | 反向断言 `/^[ \t]+x$/`、`/\n\n/`、`/^- $/` 都不命中 | 三条各自对应一种「假修好」：把字符行改成带缩进的续行、给列表补分隔空行（M408 候选 B）、把 marker 留在原行 |
| 字符在**屏幕上**的左缘位于正文列（缺陷的可观测量） | `pixel.contrast` 在「字符所在列」采样（窗口局部点 `383,219`，`min: 80`） | AX 通道读不到行级几何；`pixel` 是套件唯一的真机取色通道（README 断言表）。采样点与阈值由本场景首跑截图实测标定（见下「像素判据的标定」） |
| 渲染归属**不随光标位置变**（合同 L3） | 光标移开该行（⌃N）后文档与现场复核 + 截图 | 真机 AX 不暴露行级几何；这一档的观感仍由截图承担（与场景 100 同口径） |

## 像素判据的标定（M421 首跑实测 + 修前红对照）

`pixel.contrast` 的点与 `min` 都是实测取的（README 的口径：绝对阈值判据要留「修前红」的对照）：

- 采样点取窗口局部 `(383,219)`：`x` 行的字形带在真机截图上落在 `y=207..213`、字符左缘 `x≈364`
  （截图 1152×768，窗口 1200×800 pt，换算比 0.96）——该点换算后落在字形正中。
- **修复态**：该处方块（7px）亮度跨度 **217**（`min: 80` 之上，裕量 2.7×）。
- **缺陷态（反向验证）**：判定改回 `first || body` 后同一处跨度 **0**（纯底色），断言必红——
  与 chromium 层量到的 16.78px 位移是同一件事的两种读数（见 `test-results/m421-reverse-validation/`）。
- 空白对照：同一行右侧空白处跨度 0（说明 217 不是「整屏抖动」）。

## 已知边界

- **几何判据落在 `pixel`，截图仍是 Alex 的通道**：`pixel.contrast` 判的是「字符所在列有字形」
  （位置对不对），观感 / 手感（字形间距、光标形态、翻屏节奏）仍归 Alex 看 `shots/`（套件 README：
  手感 / 观感判定不下沉）。同一不变量的**精确 x 坐标**由 chromium 场景
  `tests/visual/scenes/lists.spec.ts` 的 M421 用例承担——那条断言带反向验证（把判定改回缺陷形态
  必红，读数 16.78px = 单层 ul 的 `--lp-list-body`）。
- **像素点依赖窗口布局**：采样点是窗口局部坐标，窗口尺寸来自 `src-tauri/tauri.conf.json`（1200×800，
  由套件 `launchApp` 从真源读入）。改窗口尺寸 / 正文宽度 / 字号默认值都会移动它——那类改动的
  mission 要按 README 的像素判据纪律重标本点。
- **判据形态（首跑实证）**：`/^$/` 在 `m` 语义下会被**尾随换行**满足（文件末尾的「最后一条空逻辑
  行」），拿它判「没有空行」是假红来源——本场景统一用 `/\n\n/`（场景 100 的同类教训）。
- **键盘注入会整批丢键**（REVIEW.md 第 11 条）。⌃N / ⌃E / Enter / ⌘S 都是 chord 或单键盲发，
  红了先按丢键复跑一次再判产品缺陷：`^- $/` 那条红 ⇒ 定位键或 Enter 丢了（产品没被碰到）；
  `^x$` 那条红而文件里**任何一行都没变** ⇒ `x` 丢了；文件里变了但不在期望行 ⇒ 先查落点。
- **不覆盖**：① 引用块内的 lazy continuation（`> - a` 后紧邻 `> b`，合同 `docs/specs/lists.md`
  已知边界一）；② lazy 行带 1–3 个空格缩进的形态（合同已知边界二）；③ 光标/选区的像素位置。
