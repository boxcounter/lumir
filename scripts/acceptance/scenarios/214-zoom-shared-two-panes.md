---
# M627（Alex 2026-10-23「harness pane 无法通过 CMD +/- 调整字号」）：
# 字号是**一套设置**——⌘= / ⌘− / ⌘0 同时作用于编辑器与 harness 面板，焦点在哪都不影响结果。
# 本场景在真机上验「焦点在 composer 里按 ⌘=，编辑器内容字号真的变大」（修前：只有面板自己的
# 字号会动，编辑器 token 不动）；harness 面板自身的字号缩放是**计算属性**，本套件没有该通道
# （README「判据形态」），判据落在 chromium 的 tests/visual/scenes/m347-harness-composer.spec.ts
# ——本场景只留截图供人眼复核（见正文「覆盖边界」）。
id: "214-zoom-shared-two-panes"
item: 214
tier: full
title: 一套字号两个 pane：焦点在 composer 内按 ⌘= / ⌘0，编辑器内容字号同步放大 / 复位（M627）
fixtures: [toc-long.md, harness-note.md]
open: toc-long.md
marker: "第 1 章 概览"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: 出厂口径前置（15px）：第 1、3 章都在渲染行里（M195 场景 29 标定的档位基线）
    do: settle
    expect:
      - shot: 01-出厂口径-15px
      - label: 第 1 章在渲染行里
        ax: { has: "第 1 章 概览 第 1 章概览正文。" }
      - label: 第 3 章也在渲染行里（32px 档它必然消失，见后面的档位判据）
        ax: { has: "第 3 章 概览 第 3 章概览正文。" }

  - name: 记录源文件与配置的基线（字号步进 MUST NOT 落盘 / 改文档）
    do: record
    as: 长文文件
    file: toc-long.md
    expect:
      - label: 隔离 config.json 存在（否则后面的「不变」在空值上恒真）
        file: { path: "env:config.json", exists: true }

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

  - name: 记编辑器文档基线（打字不得漏进文档——「焦点确在 composer」的通用防线）
    do: recordEditor
    as: 键盘前文档

  - name: 焦点确认：在 composer 里键入探针串 zz
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|zz" }
    text: "zz"
    expect:
      - label: 探针串落进 composer（焦点确在 composer，不是编辑器）
        ax: { has: "zz" }
      - label: 打字没有漏进编辑器文档
        editor: { unchangedSince: 键盘前文档 }

  - name: 注入前确保窗口在前台（README 的前台纪律）
    do: focusWindow

  # 焦点留在 composer 里（不再点编辑器）：这是修前「只缩面板、不缩编辑器」的现场。
  # ⌘= 连按十次（15 → 32 到顶；单批跨 3s+，留两次丢键余量）。
  - name: 焦点在 composer 内，⌘= 连按十次
    do: keys
    keys: ["cmd+equals", "cmd+equals", "cmd+equals", "cmd+equals", "cmd+equals", "cmd+equals", "cmd+equals", "cmd+equals", "cmd+equals", "cmd+equals"]
    gapMs: 260

  - name: 面板字号已变大的截图留档（计算属性判据在 chromium，这里只供人眼复核）
    do: settle
    expect:
      - shot: 02-焦点在-composer-放大后

  - name: ⌘⇧A 收起 harness pane——AX 渲染行快照只在回到全宽后的「重新装载」时才是场景 29 标定的形态
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 分隔条消失（回到单 pane 全宽）
        ax: { not: "分隔条" }

  - name: 注入前确保窗口在前台
    do: focusWindow

  - name: 关掉当前标签（⌘W）——AX 渲染行快照只在**重新装载**时才刷新（场景 29 的仪器口径）
    do: key
    key: "cmd+w"

  - name: 重新打开同一文件（同字号、全新装载）：字号已到 32px 档，第 3 章被挤出渲染行
    do: open
    file: toc-long.md
    marker: "第 1 章 概览"
    expect:
      - shot: 03-焦点在-composer-放大后重装
      - label: 第 1 章在渲染行里（视口在篇首——判定不建立在「整页跳走」上）
        ax: { has: "第 1 章 概览 第 1 章概览正文。" }
      - label: 第 3 章**不在**渲染行里——焦点在 composer 里按的 ⌘= 真的放大了编辑器字号（修前它仍在场）
        ax: { not: "第 3 章 概览 第 3 章概览正文。" }

  - name: 注入前确保窗口在前台
    do: focusWindow

  - name: ⌘0（回配置字号）——两个面一起回各自的基线
    do: key
    key: "cmd+0"

  - name: 注入前确保窗口在前台
    do: focusWindow

  - name: 关掉当前标签（⌘W）
    do: key
    key: "cmd+w"

  - name: 重新打开同一文件（全新装载）：回到 15px 档，第 3 章回到渲染行里
    do: open
    file: toc-long.md
    marker: "第 1 章 概览"
    expect:
      - shot: 04-⌘0-复位后重装
      - label: 第 1 章在渲染行里
        ax: { has: "第 1 章 概览 第 1 章概览正文。" }
      - label: 第 3 章**在**渲染行里——⌘0 把编辑器字号复位（面板同时回基线由 chromium 判据覆盖）
        ax: { has: "第 3 章 概览 第 3 章概览正文。" }

  - name: 不落盘、不碰文档、不碰源文件
    do: settle
    expect:
      - label: 源文件逐字节不变（ADR 0003 §3）
        file: { path: toc-long.md, unchangedSince: 长文文件 }
      - label: 源文件 mtime 也未推进
        file: { path: toc-long.md, mtimeUnchangedSince: 长文文件 }
      - label: 编辑器文档文本逐字节不变（字号命令只改样式：不进撤销栈、不改文档、不碰 dirty）
        editor: { unchangedSince: 键盘前文档 }

---

# 一套字号两个 pane（M627）

## 这个场景验什么

Alex 2026-10-23 报告「harness pane 无法通过 CMD +/- 调整字号」，同批裁决口径是「编辑器和
harness 一起变，一套字号设置，无论焦点在哪」。修法是：**编辑器内容字号是唯一的字号设置**，
harness 面板按同一缩放比（当前字号 ÷ 配置基线）缩放自己的字号阶梯；M378 的「焦点在哪个
pane 就只缩哪个」路由已废止。

本场景在真机上验**编辑器这一半**：焦点留在 composer 里连按 ⌘=，随后重新装载文档，AX 渲染行
按 32px 档收缩（第 3 章消失）——修前这条必然红（编辑器字号不被触碰，仍是 15px 档，第 3 章在
场）。⌘0 再验一次复位。

## 覆盖边界（如实登记）

- **harness 面板自身的字号缩放不在本场景判**：它是计算属性，本套件没有计算属性通道（README
  「判据形态与档位标定」）。判据落在 chromium 的
  `tests/visual/scenes/m347-harness-composer.spec.ts`（读 `getComputedStyle`：焦点在
  composer / 编辑器两种情况下，编辑器 token 与 composer 的 fontSize 都随 ⌘= / ⌘0 同步变化）。
  本场景的两张截图（`01-出厂口径-15px` / `02-焦点在-composer-放大后`）供人眼复核面板字确实
  变大了。
- **前置的 AX 档位标定沿用场景 29**（第 3 章在 15px 在场、32px 不在场）。收起 harness pane
  再判定是为了回到场景 29 的**全宽**标定现场——半宽文档 pane 的折行不同，档位边界不可移植。
- `⌘+`（⇧⌘= 的字符形态 `Cmd-+`）在真机注入通道给不出（README「键盘注入通道的两类不可达」的
  Shift 隐含符号条），本场景只用正键形态 `⌘=`；`Cmd-+` 的表内形态由
  `tests/unit/keys.test.ts` 与 chromium 场景覆盖。
