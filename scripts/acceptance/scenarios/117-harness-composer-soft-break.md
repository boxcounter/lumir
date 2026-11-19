---
id: "117-harness-composer-soft-break"
item: 117
tier: core
title: composer 一次 ⇧Enter 即换行：第二行落在下一行的行位（M419，HC1）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  # M462：本场景的行位判据是**逐像素**的，而窗口尺寸自 M437 起由产品按工作区 90% 现算（套件的
  # `--config` 只钉位置、不钉尺寸）——同一台机器换个分辨率，整页几何就漂、像素点全部落空
  # （2026-10-12 实测：1152×864 下旧坐标读到亮度跨度 0/9）。显式钉住尺寸，坐标才有意义。
  - name: 钉窗口尺寸（像素判据的几何前提）
    do: resizeWindow
    width: 1200
    height: 800
    settleMs: 900

  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 在位（空输入态 = D328 占位读屏名）
        ax: { has: "问点什么" }
      - shot: 00-面板就位

  - name: 真实鼠标点 composer（CM contentDOM 的 DOM 焦点靠真实 mousedown 建立）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 键入第一行（小写探针串；typeInNode 粘贴通道原样落地）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|hnl-brk-aa" }
    text: "hnl-brk-aa"

  # M507 裁决（勿迁）：本步 chord 的副作用在 AX 里**逐次不可观测**——段末 ⇧Enter 落的空段落不序列化
  # （AX 只在块之间插 \n），bbox 又受 composer min-height 封顶。**不要加 `verify`**：命中会被判
  # 「未落地」重注后假 FAIL，重注还可能多落一个查不出来的空段落。判据与证据见 README「已知边界」的
  # chord verify 条（⇧Enter 族的根治方向 = 套件自有 CGEvent 键盘注入通道，M509 探针立项中）。
  - name: 一次 ⇧Enter（本场景的待验动作——修前它只追加一个不可见的尾随换行）
    do: key
    key: "shift+return"

  # M518：⇧Enter 之后的素材注入改走 keys（逐键 press_key），不再用 typeInNode——M517 探针定案
  # （2026-10-14）：typeInNode 走的 type_text 是无 index 的 AX 注入，不进 composer 模型；软断行
  # typeInNode 条本就写明：caret 由键盘导航定位、落点即判据的步骤不适用）。键串全为可打印字符
  # 且不含 'e'（press_key 丢键史字符，M497/M509）。
  - name: 键入第二行
    do: keys
    keys: ["h", "n", "l", "-", "b", "r", "k", "-", "c", "d"]
    gapMs: 60
    expect:
      - label: 第二行落在**下一行的行位**上有字形（像素层判据：y≈723 是第二行；修前这一带是空白——那一次 ⇧Enter 只写进了不可见的尾随换行）
        pixel:
          contrast:
            - { x: 780, y: 723, as: "第二行行位（hnl-brk-cd 的字形）", min: 60 }
      - label: 对照：第一行行位照旧有字形（防「两行都空」的空转读数）
        pixel:
          contrast:
            - { x: 780, y: 702, as: "第一行行位（hnl-brk-aa 的字形）", min: 60 }
      # M763：正向判据走**解析值**（`node` 断言 → `parseNodes` 的 value），不走 `ax.has`。
      # 来历：KimiCU 0.6.8 起把 UI 文本的换行渲染成两个字符 `\n`（一份 dump 仍是一行一个元素），
      # `ax.has` 匹配的是 dump **原文**，`[\r\n]+` 在字面转义上命中 0 次 ⇒ M762 真机假红（产品与
      # 像素全绿）。`ax.mjs` 的 `parseNodes` 现在把这条编码还原成真换行，因此 node 断言表达的是
      # 场景真正要的东西（「两串之间有没有换行」），和对上游表示法无关；改回 `ax.has` 会把
      # KimiCU 的转义表示写进场景，上游下次再改格式又全体失效。
      - label: composer 文本里两串之间有换行（第二段在第一段的下一行，不是同行拼接）
        node: { role: AXTextArea, name: 'hnl-brk-aa\n+hnl-brk-cd', present: true }
      - label: 缺陷签名串不在场（同行拼接 = 那一次 ⇧Enter 没落地）
        ax: { not: "hnl-brk-aahnl-brk-cd" }
      - shot: 01-一次shift-enter-两行

  # ── M462：光标在**最后一行行末**按 ⇧Enter 的落点（HC1 第 3 条）────────────────────────
  # 为什么必须先 ⌃A 再 ⌃E：本缺陷只在光标处于「末尾之后」（末段末缘的归一等价表示、写回 DOM
  # 就对（WebKit 探针逐档实测：点在字后、点在本行右侧、点在本行下方空白带，三种点击法都落
  # 原始末缘）。行级命令才是把光标放到该表示的路径：⌃E 从行内**到行末**会写回等价值（探针读数
  # M768 通道审计：⌃A 要的是应用自己的 `editor.line-start`（把光标送到末行行首，缺陷形态才可达
  # ——见正文「为什么必须先 ⌃A 再 ⌃E」）。KimiCU 0.6.8 的 press_key 对 ctrl+a 走 AX 全选兼容
  # 路径（零键盘事件），应用键位层命中不到，本步只会留下一个全文选区。channel: cgevent 改走真
  # 键盘事件；断言一条未动。
  - name: ⌃A（光标移到末行行首）
    do: key
    channel: cgevent
    key: "ctrl+a"

  - name: ⌃E（到末行行末＝归一表示「末尾之后」；缺陷形态在这一档可达）
    do: key
    key: "ctrl+e"

  - name: ⇧Enter（本步是待验动作：新空行必须落在**末行之后**）
    do: key
    key: "shift+return"

  - name: 键入第三行（探针串）
    # M518：同走 keys。探针串由 `hnl-brk-ee` 改为 `hnl-brk-gg`——原串含 'e'（press_key 确定性
    # 丢键史字符，M497/M509），改字符不改语义（判据仍是「探针串另起一行、不接在 cd 行首」）。
    do: keys
    keys: ["h", "n", "l", "-", "b", "r", "k", "-", "g", "g"]
    gapMs: 60
    expect:
      - label: 第二行（hnl-brk-cd）**没有被挤下去**（像素：y≈702 有字形——三行态下这是第二行）。缺陷形态下那一带是**空白**：`\n` 被插到末段文本第 0 位，cd 整行被挤到下一行
        pixel:
          contrast:
            - { x: 780, y: 702, as: "第二行（hnl-brk-cd）的行位（三行态第二行）", min: 60 }
      - label: 对照：探针串落在**新的一行**（y≈723 有字形——三行态第三行；防「换行把字挤没了」的空转读数）
        pixel:
          contrast:
            - { x: 780, y: 723, as: "第三行行位（hnl-brk-gg 的字形）", min: 60 }
      - label: AX：探针串另起一行接在第二行之后（换行 = CM 新行落在末行之后）
        node: { role: AXTextArea, name: 'hnl-brk-cd\n+hnl-brk-gg', present: true }
      - label: 缺陷签名串不在场（探针串接在 `cd` **行首** = 空行插到了当前行之前）
        ax: { not: "hnl-brk-gghnl-brk-cd" }
      - shot: 02-末行行末shift-enter-新行落在末行之后
---
# 117 —— CM composer 的一次 ⇧Enter 换行

## 判据

一次 ⇧Enter 在当前文本选区插入一个换行，caret 落在插入文本之后，不发送。场景同时覆盖段内、逻辑行尾和连续换行；AX 换行值、下一行探针文本和编辑器文档不变共同构成判据。文本与 caret 由 CM state 持有，不再有段落块、末尾边界映射或 DOM 重渲合同。

## 通道边界

⇧Enter chord 的副作用不在每一步后盲目 verify 重注，避免重复换行。逐键导航后的文本注入沿用场景内既有通道纪律；这些限制只影响机器输入，不改变产品 oracle。
