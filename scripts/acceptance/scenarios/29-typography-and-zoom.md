---
id: "29-typography-and-zoom"
item: 29
title: 排版与字号步进：配置字号端到端生效、⌘= / ⌘− / ⌘0 / ⌘⇧= 的可见结果、config.json 与源文件逐字节不变
fixtures: [toc-long.md]
open: toc-long.md
marker: "第 1 章 概览"
steps:
  - name: 出厂口径前置：第 1、2 章同时在渲染行里（后面「不在」的对照）
    do: settle
    expect:
      - shot: 出厂口径-16px
      - label: 第 1 章在渲染行里
        ax: { has: "第 1 章 概览 第 1 章概览正文。" }
      - label: 第 2 章也在渲染行里（16px 下这屏装得下两章；字号变大后它必须消失）
        ax: { has: "第 2 章 概览 第 2 章概览正文。" }

  - name: 记录基线：隔离 config.json 与源文件的 sha256 + mtime
    do: record
    as: 配置文件基线
    file: "env:config.json"
    expect:
      - label: 隔离 config.json 存在（否则后面的「不变」在空值上恒真）
        file: { path: "env:config.json", exists: true }
      - label: 配置里此刻没有 font_size（下面那次 configWrite 才是它出现的唯一原因）
        file: { path: "env:config.json", not: "font_size" }

  - name: 记录源文件基线（ADR 0003 §3：显示层改动绝不写源文件）
    do: record
    as: 长文文件
    file: toc-long.md

  - name: 配置通道端到端：font_size 32 写进隔离配置并重启（这是配置面唯一入口）
    do: configWrite
    fontSize: 32
    expect:
      - label: 隔离 config.json 现在写着 font_size 32
        file: { path: "env:config.json", has: '"font_size": 32' }

  - name: 重启后重新打开同一文件
    do: open
    file: toc-long.md
    marker: "第 1 章 概览"
    expect:
      - shot: 配置32px
      - label: 第 1 章仍在渲染行里（视口没被推到文末/篇首）
        ax: { has: "第 1 章 概览 第 1 章概览正文。" }
      - label: 第 2 章**已不在**渲染行里——字号真的变大了（这一行装不下第二章了）
        ax: { not: "第 2 章 概览 第 2 章概览正文。" }

  - name: 建立编辑器焦点（键盘注入的前置；⌘= 系绑定是 global，但注入要落在前台窗口里）
    do: clickEditor
    expect:
      - label: 文档已装载（编辑器里能读到首章标题）
        editor: { has: "第 1 章 概览" }

  - name: ⌘− 连按到下限（12px）：可见范围重新变宽，第 2 章回到渲染行里
    do: keys
    keys: ["cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus"]
    gapMs: 220
    expect:
      - shot: 缩小到下限
      - label: 第 2 章回到渲染行里（缩小的可见结果；也证明 ⌘− 的 token 形态在真机上命中）
        ax: { has: "第 2 章 概览 第 2 章概览正文。" }
      - label: 第 1 章仍在（上一条不得建立在「整页跳走」上）
        ax: { has: "第 1 章 概览 第 1 章概览正文。" }

  - name: ⌘0 回到**配置值 32**（不是出厂 16）：第 2 章重新被挤出渲染行
    do: key
    key: "cmd+0"
    expect:
      - shot: 重置回配置值
      - label: 第 2 章又被挤出渲染行
        ax: { not: "第 2 章 概览 第 2 章概览正文。" }
      - label: 第 1 章仍在渲染行里
        ax: { has: "第 1 章 概览 第 1 章概览正文。" }

  - name: ⌘⇧=（真机的 ⌘+ 形态：event.key 为 "+"）从下限放大——可见范围变窄
    do: keys
    keys: ["cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus", "cmd+minus"]
    gapMs: 220
    expect:
      - label: 已在下限：第 2 章在渲染行里
        ax: { has: "第 2 章 概览 第 2 章概览正文。" }

  - name: 单按 ⌘⇧= 十次（12 → 29px）后第 2 章应再次被挤出
    do: keys
    keys: ["cmd+shift+equal", "cmd+shift+equal", "cmd+shift+equal", "cmd+shift+equal", "cmd+shift+equal", "cmd+shift+equal", "cmd+shift+equal", "cmd+shift+equal", "cmd+shift+equal", "cmd+shift+equal"]
    gapMs: 260
    expect:
      - shot: ⌘⇧=放大十档
      - label: 第 2 章不在渲染行里（⌘⇧= 这条绑定真的命中，与 ⌘= 同命令）
        ax: { not: "第 2 章 概览 第 2 章概览正文。" }
      - label: 第 1 章仍在渲染行里（不是「整页跳到别处」造成的假绿）
        ax: { has: "第 1 章 概览 第 1 章概览正文。" }

  - name: 不落盘、不碰源文件：config.json 与长文的 sha256 + mtime 都未变
    do: settle
    expect:
      - label: config.json 内容逐字节不变（字号步进 MUST NOT 回写配置）
        file: { path: "env:config.json", unchangedSince: 配置文件基线 }
      - label: config.json 的 mtime 也未推进（没有被写过同一份内容）
        file: { path: "env:config.json", mtimeUnchangedSince: 配置文件基线 }
      - label: 源文件逐字节不变（ADR 0003 §3）
        file: { path: toc-long.md, unchangedSince: 长文文件 }
      - label: 源文件 mtime 也未推进
        file: { path: toc-long.md, mtimeUnchangedSince: 长文文件 }
---

# 排版与字号步进（M195，change typography-and-zoom）

## 这个场景验什么

真机（WKWebView）上验三件在 chromium 层验不到的事：

1. **配置通道端到端**：`font_size` 从隔离 `config.json` 经 Rust `config_get` → 前端
   `applyTypography` → `documentElement` 上的 token → 编辑器内容面，真的生效。
2. **`⌘=` / `⌘−` / `⌘0` / `⌘⇧=` 四条绑定的真机形态**：`Cmd-+` 这条在合成事件里可能是
   `Cmd-Shift-=`（不命中），只有真机按 ⌘⇧= 才能确认 `event.key === "+"` 这一形态。
3. **不落盘**：命令只改应用运行期，`config.json` 与源文件的 sha256 与 mtime 全程不变。

## 判据形态（为什么是「可见范围」）

字号是**计算属性**，而本套件没有计算属性通道（`scripts/acceptance/README.md` 的断言表）。
因此机器判据取 **AX 渲染行**：`AXTextArea` 的文本按渲染行给出，字号变大 ⇒ 同一屏装下的
内容变少 ⇒ 某些行从 AX 里消失（这一形态在 `28-remember-reading-position` 里已被用来
判「翻屏前后某章在不在」）。

- 每条「不在」都配一条「第 1 章仍在」——否则「整页跳到文末」这类状态会让「不在」恒真
  （REVIEW.md 第 1 条的假绿形态）。
- 每个尺寸档都有 `shot` 截图留档，人眼可复核「字确实大了」。
- **不用「按键注入成功」当判据**（REVIEW.md 第 11 条：WKWebView 注入会整批丢键）：所有
  断言都读 AX 的回读结果。

## 已知边界（如实登记）

- 「第 2 章在 / 不在」是**一屏装得下几章**的代理判据：它与窗口高度、`--line-height: 1.75`、
  阅读栏宽共同决定。窗口尺寸由套件钉死（`--config` 的窗口位置与 `tauri.conf.json` 的
  1200×800），因此档位边界是稳定的；若将来改窗口尺寸或行高，本场景的档位断言需要重估。
- 覆盖不到：鼠标滚轮缩放（本 change 不做）、行宽联动（不做）、字体族配置的真机呈现
  （`font_family` / `mono_font_family` 由视觉场景 `tests/visual/scenes/typography.spec.ts`
  以计算属性覆盖；真机层没有字体族读数通道）。
