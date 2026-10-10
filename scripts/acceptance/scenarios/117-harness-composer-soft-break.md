---
id: "117-harness-composer-soft-break"
item: 117
title: composer 一次 ⇧Enter 即换行：第二行落在下一行的行位（M419，HC1）
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
      - shot: 00-面板就位

  - name: 真实鼠标点 composer（contenteditable 的 DOM 焦点靠真实 mousedown 建立）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 键入第一行（小写——KimiCU 的 press_key 注入字母恒为小写，场景的探针串因此全小写）
    do: keys
    keys: ["h", "n", "l", "-", "b", "r", "k", "-", "a", "a"]

  - name: 一次 ⇧Enter（本场景的待验动作——修前它只追加一个不可见的尾随换行）
    do: key
    key: "shift+return"

  - name: 键入第二行
    do: keys
    keys: ["h", "n", "l", "-", "b", "r", "k", "-", "c", "d"]
    expect:
      - label: 第二行落在**下一行的行位**上有字形（像素层判据：y≈722 是第二行；修前这一带是空白——那一次 ⇧Enter 只写进了不可见的尾随换行）
        pixel:
          contrast:
            - { x: 905, y: 722, as: "第二行行位（hnl-brk-cd 的字形）", min: 60 }
      - label: 对照：第一行行位照旧有字形（防「两块都空」的空转读数）
        pixel:
          contrast:
            - { x: 905, y: 702, as: "第一行行位（hnl-brk-aa 的字形）", min: 60 }
      - label: composer 文本里两串之间有换行（第二段在第一段的下一行，不是同行拼接）
        ax: { has: '/hnl-brk-aa[\r\n]+hnl-brk-cd/' }
      - label: 缺陷签名串不在场（同行拼接 = 那一次 ⇧Enter 没落地）
        ax: { not: "hnl-brk-aahnl-brk-cd" }
      - shot: 01-一次shift-enter-两行
---

# 117-harness-composer-soft-break —— 一次 ⇧Enter 即换行（M419 缺陷，HC1）

## 本场景在验什么

Alex 原话（2026-10-10）：「Harness composer 里按两次 SHIFT + Enter 才会换行」。

根因（M419 定位，实测见 [docs/specs/harness-composer.md](../../../docs/specs/harness-composer.md)
「实测依据」节）：修前段末换行落成**尾随 `\n`**，而 CSS 里尾随换行**不产生行盒**
（`white-space: pre-wrap` 下 `"ab\n"` 与 `"ab"` 同高）——第一次 ⇧Enter 零可见变化、光标停在一个
没被渲染出来的行上；再按一次才把上一次的尾随换行挤成内部换行。修复把段末断行落成**新的空段落块**
（`min-height: 1em`，一行真实落地），光标落到新行。

真机可观测回路（mock provider，不发消息、零外部 API）：

1. `HNL-BRK-AA` → 一次 ⇧Enter → `HNL-BRK-CD`。
2. **像素层**：第二行行位（窗口点 y≈722）上有字形。修前 `CD` 落在第一行（同行拼接），
   y≈722 是空白 ⇒ 该条红——这是本缺陷在真机上唯一有区分度的判据（AX 值里的换行只在修复后
   才出现，且真机 AX 对空行的暴露不可依赖）。
3. **AX 层**：composer 文本里两串之间有换行，且同行拼接的签名字符串不在场。
4. 反面对照：第一行行位照旧有字形（防「两处都空」的空转读数）。

## 断言口径

- **行位像素判据的坐标从布局读数来**（1200×800 窗口、⌘⇧A 默认分栏下 composer 内容左缘 x=897、
  行高 19.5px、第二行行位中心 y≈722）：几何与 CSS 逐像素可复算（chromium 探针实测，
  `docs/specs/harness-composer.md` 的证伪方式节记了口径）。**不用整页基线**——本场景判的是
  「哪一行有字」，不是「画面与上一版比没变」。
- **`contrast` 而非 `same`**：判「这一带真有字形」用亮度跨度（`pixel.contrast`），
  与场景 68 同一口径；两个字形的实际落点不逐像素可预测，`same` 会把噪声当差异。
- **AX 换行断言是第二把锁**，不是唯一判据：真机 AX 对多段落 contenteditable 的文本拼接方式
  依赖 WKWebView 的文本提取（块之间是否插换行），实测**会插**（本条因此可判；换行是主判据的
  补强，不是唯一依据）。
- **区分度实测（反向验证，2026-10-10）**：把 `insertSoftBreakAtCaret` 临时改回缺陷形态（段末
  追加尾随 `\n`）后重跑本场景——像素条读到第二行行位**亮度跨度 0**（修后 186）、AX 两条变红
  （文本是同行拼接的 `hnl-brk-aahnl-brk-cd`），第一行对照条照旧绿。断言对缺陷有区分度。

## 环境与副作用

- 不发消息（mock fixture 不会被消费）：不写 vault、不碰剪贴板、零外部 API。
- 合成 vault + 隔离 `XDG_CONFIG_HOME`；真实 vault 与 `~/.config/lumir` 全程不读写。
- 真机段走 `LUMIR_ACCEPTANCE_PORT`（1430），1420 不碰。
