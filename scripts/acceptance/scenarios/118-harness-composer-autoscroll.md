---
id: "118-harness-composer-autoscroll"
item: 118
tier: full
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
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|l01" }
    text: "l01"
  # M507 裁决（勿迁）：本步 chord 的副作用在 AX 里**逐次不可观测**——段末 ⇧Enter 落的空段落不序列化
  # （AX 只在块之间插 \n），bbox 又受 composer min-height 封顶。**不要加 `verify`**：命中会被判
  # 「未落地」重注后假 FAIL，重注还可能多落一个查不出来的空段落。判据与证据见 README「已知边界」的
  # chord verify 条（⇧Enter 族的根治方向 = 套件自有 CGEvent 键盘注入通道，M509 探针立项中）。
  - do: key
    key: "shift+return"
    name: 第 1 行后的 ⇧Enter
  # M518：⇧Enter 之后的素材注入改走 keys（逐键 press_key），不再用 typeInNode——M517 探针定案
  # （2026-10-14）：typeInNode 的 type_text 是无 index 的 AX 注入、不进 composer 模型，软断行之后
  # composerObserver 从 DOM 回灌模型时把软断行块折叠掉，注入文本落进上一块（M514 批的 118 现场 =
  # AXTextArea 值 "l01l02\nl03l04\nl05l06\nl07l08l09l10"：十行被折成五块）。键串不含 'e'
  # （press_key 丢键史字符，M497/M509）。第 1 行（软断行之前）仍走 typeInNode。
  - name: 键入第 2 行
    do: keys
    keys: ["l", "0", "2"]
    gapMs: 60
  - do: key
    key: "shift+return"
    name: 第 2 行后的 ⇧Enter
  - name: 键入第 3 行
    do: keys
    keys: ["l", "0", "3"]
    gapMs: 60
  - do: key
    key: "shift+return"
    name: 第 3 行后的 ⇧Enter
  - name: 键入第 4 行
    do: keys
    keys: ["l", "0", "4"]
    gapMs: 60
  - do: key
    key: "shift+return"
    name: 第 4 行后的 ⇧Enter
  - name: 键入第 5 行
    do: keys
    keys: ["l", "0", "5"]
    gapMs: 60
  - do: key
    key: "shift+return"
    name: 第 5 行后的 ⇧Enter
  - name: 键入第 6 行
    do: keys
    keys: ["l", "0", "6"]
    gapMs: 60
  - do: key
    key: "shift+return"
    name: 第 6 行后的 ⇧Enter
  - name: 键入第 7 行
    do: keys
    keys: ["l", "0", "7"]
    gapMs: 60
  - do: key
    key: "shift+return"
    name: 第 7 行后的 ⇧Enter
  - name: 键入第 8 行
    do: keys
    keys: ["l", "0", "8"]
    gapMs: 60
  - do: key
    key: "shift+return"
    name: 第 8 行后的 ⇧Enter
  - name: 键入第 9 行
    do: keys
    keys: ["l", "0", "9"]
    gapMs: 60
  - do: key
    key: "shift+return"
    name: 第 9 行后的 ⇧Enter
  - name: 键入第 10 行（内容至此超过 composer 的 max-height 150px）
    do: keys
    keys: ["l", "1", "0"]
    gapMs: 60

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
            - { x: 748, y: 702, as: "倒数第二行文字行（l10）", min: 60 }
      - label: 换行后光标行在视口内：composer 可视区**最下一行带是空白** = 刚断出来的空行（缺陷形态下这一带是「盒子长高但没有可渲染行」留下的幻影空白，本条是行为守卫、不区分显式滚动代码——口径见正文）
        pixel:
          same:
            - [ { x: 748, y: 723, as: "最下一行带（新断出的空行）" }, { x: 1150, y: 723, as: "同一行带右侧空白" } ]
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
- **坐标从布局读数来**（1200×800 窗口、⌘⇧A 默认分栏）：composer 底边 y=734、行高 ≈20.8；
  十行 + 一空行时倒数第二行（`l10`）的行位中心 y≈702、最下一行带（空行）中心 y≈723。
  **M518 重测**（换通道后真机复跑，读数落 `.local/acceptance/2026-10-14/118-…/`）：真机 AX 里
  composer 的包围盒 @699,561 **444**×144（截图像素）= 窗口点 728,584 462×150；截图像素逐行扫描
  实测字形行 y=568/588/608/628/648/669（步长 20px，即窗口点 20.8），最后一行文字（`l10`）的行位中心
  落在窗口点 701、其下的空行带 722。**旧的 x=905 已不成立**：那份读数是分栏宽 290px（窗口点左缘
  889）时代的，M462 之后的真机分栏是 444px（左缘 728）——`l05`…`l10` 的字形横跨截图像素
  x≈708..727（窗口点 737..757），905 落在文本右侧的空白上，于是这条对照条被**静默喂成恒空**
  （2026-10-13 起 118 的像素对照条就是这样红的：不是产品缺陷，是坐标漂了）。新 x=748 取字形中段
  （截图像素 718），对分栏左缘的漂移比旧的右段坐标结实。
- **`geom` 的目标按内容定位**（`role: AXTextArea, any: "l01"`）：composer 有内容时 WKWebView 的
  AX 名称为空、值即文本，第一个 AXTextArea 是编辑器——按值定位比按序定位结实。
- **空白带用 `same`（两点同色）**，字形带用 `contrast`（亮度跨度）——「空」要跟同一行带的
  右侧空白比，不能跟背景 token 比（后者会把底板色变化算成差异），也不能用 `not` 类文本框断言。

## 注入通道（M518）

- **第 1 行用 `typeInNode`**（软断行之前，caret 在空 composer 末尾，与追加语义等价）；**第 2…10 行一律
  `do: keys`**（逐键 `press_key`）——软断行之后的素材注入不能走 `typeInNode`：它的 `type_text` 是无
  index 的 AX 注入、不进 composer 模型，`composerObserver` 从 DOM 回灌模型时把软断行块折叠，注入的
  行落进上一块（M514 批的现场：十行折成五块，AXTextArea 值 `l01l02\nl03l04\n…`）。M517 探针定案
  （2026-10-14），产品级判据一字未动。键串（`l02`…`l10`）不含 'e'（`press_key` 丢键史字符，M497/M509）。
- 本场景的几何条正对着「断行真的落地」判（十行 = 144px，缺陷形态五行 = 117px）——通道换掉之前，
  正是折叠把这个高度判据喂成缺陷形态。

## 反向验证（2026-10-10 实测）

把 `insertSoftBreakAtCaret` 临时改回缺陷形态（段末追加尾随 `\n`）后重跑本场景：几何条读到
composer 包围盒 **290×117**（修后 290×144；宽度是那次运行时的分栏宽，高度才是判据——M518 的真机
分栏已是 444px 宽）、AX 条读到 `l01l02 / l03l04 / … / l09l10` 同行拼接，
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
