---
id: "118-harness-composer-autoscroll"
item: 118
title: composer 断行后视口自动滚到光标行：最下一行带 = 新断出的空行（M419，HC2）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 在位（空输入态 = D328 占位读屏名）
        ax: { has: "问点什么" }

  - name: 真实鼠标点 composer（contenteditable 的 DOM 焦点靠真实 mousedown 建立）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 键入第 1 行（行尾 ⇧Enter）
    do: keys
    keys: ["l", "0", "1"]
  - do: key
    key: "shift+return"
    name: 第 1 行后的 ⇧Enter
  - name: 键入第 2 行
    do: keys
    keys: ["l", "0", "2"]
  - do: key
    key: "shift+return"
    name: 第 2 行后的 ⇧Enter
  - name: 键入第 3 行
    do: keys
    keys: ["l", "0", "3"]
  - do: key
    key: "shift+return"
    name: 第 3 行后的 ⇧Enter
  - name: 键入第 4 行
    do: keys
    keys: ["l", "0", "4"]
  - do: key
    key: "shift+return"
    name: 第 4 行后的 ⇧Enter
  - name: 键入第 5 行
    do: keys
    keys: ["l", "0", "5"]
  - do: key
    key: "shift+return"
    name: 第 5 行后的 ⇧Enter
  - name: 键入第 6 行
    do: keys
    keys: ["l", "0", "6"]
  - do: key
    key: "shift+return"
    name: 第 6 行后的 ⇧Enter
  - name: 键入第 7 行
    do: keys
    keys: ["l", "0", "7"]
  - do: key
    key: "shift+return"
    name: 第 7 行后的 ⇧Enter
  - name: 键入第 8 行
    do: keys
    keys: ["l", "0", "8"]
  - do: key
    key: "shift+return"
    name: 第 8 行后的 ⇧Enter
  - name: 键入第 9 行
    do: keys
    keys: ["l", "0", "9"]
  - do: key
    key: "shift+return"
    name: 第 9 行后的 ⇧Enter
  - name: 键入第 10 行（内容至此超过 composer 的 max-height 150px）
    do: keys
    keys: ["l", "1", "0"]

  - name: 最后一次 ⇧Enter——新行必须落在视口内（HC2）
    do: key
    key: "shift+return"
    expect:
      - label: 断行是真的（composer 处于 max-height 封顶的可滚态：十行内容 236px > 150px）——缺陷形态下十次按键合并成五行、composer 只有 117px 高，本条红
        geom:
          target: { role: AXTextArea, any: "/l0/" }
          minHeight: 140
      - label: 上部的文字行照旧有字形（对照：面板真的在渲染文字，不是空的/塌的）
        pixel:
          contrast:
            - { x: 905, y: 707, as: "倒数第二行文字行（l10）", min: 60 }
      - label: 换行后光标行在视口内：composer 可视区**最下一行带是空白** = 刚断出来的空行（缺陷形态下这一带是「盒子长高但没有可渲染行」留下的幻影空白，本条是行为守卫、不区分显式滚动代码——口径见正文）
        pixel:
          same:
            - [ { x: 905, y: 725, as: "最下一行带（新断出的空行）" }, { x: 1150, y: 725, as: "同一行带右侧空白" } ]
      - label: 十行内容逐行落地（换行真的存在，不是同行拼接）
        ax: { has: "/l09[\r\n]+l10/" }
      - shot: 01-断行后-视口在最末行
---

# 118-harness-composer-autoscroll —— 断行后视口自动滚到光标行（M419 改进项，HC2）

## 本场景在验什么

Alex 原话（2026-10-10）：「Harness composer 里换行时自动滚动到最末一行。现在需要人工滑动。」

成因（M419）：composer 的 DOM 是**重渲**出来的——断行走 `renderComposer` + 用程序化 `Range`
落光标，浏览器「插入后把光标滚进视野」的原生行为因此不生效：内容超过 `max-height`（150px）后
再断行，新行落在可视区之外，视口停在原处，要人工往下滑。修复：`setDomCaret` 收尾把光标行交给
纯函数 `caretScrollTop`，需要时写 `scrollTop`（合同 [docs/specs/harness-composer.md](../../../docs/specs/harness-composer.md) HC2）。

真机可观测回路（mock provider，不发消息、零外部 API）：

1. 逐行键入 `l01`…`l10`，每行行尾一次 ⇧Enter（十行内容 236px > 150px，composer 进入滚动态）。
2. 最后一次 ⇧Enter 后：composer 处于 max-height 封顶的可滚态（包围盒高 144 截图 px），
   且**可视区最下一行带是空白**——那正是新断出来的空行。
3. 对照：上部文字行（y≈707）有字形，排除「composer 整块塌了/空了」导致的空转读数。

## 断言口径

- **判据落在绘制层（像素）+ 几何**：AX 读不到 `scrollTop`（WKWebView 不暴露滚动位），composer
  的包围盒也不随滚动变化（高度被 `max-height` 钉死）——可用的是「哪一带被画出来了」（绘制段）
  与「这个盒子到底有多高」（几何段：十行 = 144px、缺陷形态五行 = 117px，`geom.minHeight` 分开两者），
  与 [overlay-visibility.md](../../../docs/specs/overlay-visibility.md) 的「几何 + 绘制」同一条纪律。
- **本场景的区分度来自「断行有没有真的落地」**（几何段 + AX 段）：缺陷形态下十次按键合并成五行、
  composer 到不了滚动态，两条都变红（实测，见下）。**「最下一行带是空白」那条是行为守卫**——
  把显式滚动代码临时停用后它仍然绿：WKWebView 在程序化改选区时会自己 reveal 光标（Blink 不会：
  chromium 探针里停用显式滚动后视口停在 max 之前 19px、正好差一行）。显式滚动本身的判据挂在
  `caretScrollTop` 的单测上（`tests/unit/harness-composer.test.ts`）；真机这条覆盖的是 Alex 报的
  症状面（「断行后最末一行要在视口里」），不是「哪份代码把它送进视口」。
- **坐标从布局读数来**（1200×800 窗口、⌘⇧A 默认分栏）：composer 底边 y=734、行高 19.5px；
  十行 + 一空行时倒数第二行（`l10`）的行位中心 y≈707、最下一行带（空行）中心 y≈725。
  chromium 探针实测，逐像素可复算；真机 AX 里 composer 的包围盒 @853,561 290×144（截图像素）
  = 窗口点 889,584 302×150，与探针逐值一致。
- **`geom` 的目标按内容定位**（`role: AXTextArea, any: "l01"`）：composer 有内容时 WKWebView 的
  AX 名称为空、值即文本，第一个 AXTextArea 是编辑器——按值定位比按序定位结实。
- **空白带用 `same`（两点同色）**，字形带用 `contrast`（亮度跨度）——「空」要跟同一行带的
  右侧空白比，不能跟背景 token 比（后者会把底板色变化算成差异），也不能用 `not` 类文本框断言。

## 反向验证（2026-10-10 实测）

把 `insertSoftBreakAtCaret` 临时改回缺陷形态（段末追加尾随 `\n`）后重跑本场景：几何条读到
composer 包围盒 **290×117**（修后 290×144）、AX 条读到 `l01l02 / l03l04 / … / l09l10` 同行拼接，
两条红；像素两条仍绿（缺陷形态下盒子长高但没有可渲染行，最下一行带同样是空白）——因此本场景的
覆盖声明只到「断行落地 + 最末行在视口」这一层，不声明「显式滚动代码被覆盖」。

## 已知边界（如实登记）

- 本场景判「断行后新行在视口内」，**不判滚动动画 / 手感**（瞬时滚动位与视觉节奏归 Alex 手感验收）。
- 单次 ⇧Enter 的**内容正确性**（第二行落在下一行）另有场景 117 覆盖；本场景只判视口位置，
  两者断言面不重叠。

## 环境与副作用

- 不发消息（mock fixture 不被消费）：不写 vault、不碰剪贴板、零外部 API。
- 合成 vault + 隔离 `XDG_CONFIG_HOME`；真实 vault 与 `~/.config/lumir` 全程不读写。
- 真机段走 `LUMIR_ACCEPTANCE_PORT`（1430），1420 不碰。
