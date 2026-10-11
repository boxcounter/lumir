---
# M450（change composer-intercard-caret）：composer「相邻两张卡片之间的可编辑光标位」的真机判据
# ——HC3 行为层，同时是裁决点 2 的**实测闸**（原生 ⌃B 能不能把光标挪到两张相邻卡片之间）。
#
# 三组读数（design §6）：① 光标落点（模型读回）在本套件没有直接观测通道（AX 不暴露
# contenteditable 内的光标位），用「打完字落在哪一格」+「撤销回到什么前态」两条后果读数代替；
# ② 光标可见性是截图（人工过目）；③ 打字落点是 AX 文本里探针串的**位置**（夹在两条卡片
# 元信息行之间）。
#
# 不成立时的处置（两条路都在 change 的授权面内，不回来二次裁决）：见 design §6 的判定表——
# 落位/落点读不到边界 ⇒ 启用方案 C（键位层接管 composer 的水平移动）。本次读数如实记入
# change 的 tasks 对账。
#
# 【M456 通道阻塞，2026-10-11 实测，如实登记】本场景的**探针串注入**在现有配套通道下不可达：
# ① 原生菜单 Paste 之后，CGEvent 逐键注入（`do: keys` / `do: key`）对 composer **确定性死亡**
#    （3/3，工具自报 ok、目标串 0 命中；聚焦断言 `ax: {focused: AXTextArea}` 同期 PASS ⇒ 不是聚焦）；
# ② 改走 KimiCU `type_text`（带 `index` 定向 composer，AX-focus + editing-command 路径）在
#    **套件 spawn 的 MCP 会话里也不落地**（返回 `delivery_unverified`）——**同一 index=236、
#    同一二进制**（套件 `/Applications/KimiCU.app/Contents/MacOS/kimi-cu mcp`，
#    插件 wrapper 也是 exec 同一个），**插件侧直调该 index 立刻落地**；不带 index 的「当前焦点」
#    分支同样不落。
# ③ 结论：注入通道（MCP 会话/调用方上下文）是本场景当前唯一阻塞；菜单落点本身已由 M456 的
#    布局修复打通（`src/harness-panel.css` 的 composer 末尾空行）。HC3 真机判据**待注入通道修复
#    或换判据形态**，由 tower 呈 Alex 裁决——本场景文件保持原判据不动。
id: "134-harness-composer-intercard-caret"
item: 134
title: composer 两张相邻卡片之间：⌃B 落位 → 键入落在两卡之间 → 一次撤销回到前态（M450，HC3）
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

  - name: 记编辑器文档基线（打字不得漏进文档——焦点争议的通用防线，场景 100 同口径）
    do: recordEditor
    as: doc-before-caret

  - name: 剪贴板置合成 png #1（360×200，seed 41；两图尺寸不同 ⇒ 内容寻址名与元信息行都可区分）
    do: clipboardImage
    synth: { width: 360, height: 200, seed: 41 }

  - name: 右键 composer 唤出 WebKit 原生菜单（Paste 通道，M415 探针口径）
    do: click
    target: { role: AXTextArea, name: "问点什么", button: right }
    expect:
      - label: 原生菜单出现且 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste 贴第一张图（空 composer 的段落起始 → [图片1, 空段落]，光标落末尾空段落）
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }

  - name: 等第一张卡片落定
    do: waitFor
    waitFor:
      has: ["/pasted-[0-9a-f]{16}\\.webp[\\s\\S]{0,80}?360×200/"]
    timeoutMs: 30000

  - name: 剪贴板置合成 png #2（200×120，seed 42）
    do: clipboardImage
    synth: { width: 200, height: 120, seed: 42 }

  - name: 右键 composer 的**末尾空段落带**（dy 0.94 落在最下一块＝末尾段落上；卡片本体是
      contenteditable=false，右键落在其上会换掉原生菜单的编辑项 ⇒ 没有 Paste）
    do: click
    target: { role: AXTextArea, name: "360×200", button: right, dy: 0.94 }
    expect:
      - label: 原生菜单出现且 Paste 项在场（落点在编辑区 ⇒ 编辑菜单）
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste 贴第二张图（光标在末尾空段落段首 → 图片插在它之前 ⇒ [图片1, 图片2, 空段落]）
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }

  - name: 等第二张卡片落定（两张卡相邻、之间无段落 = 本场景的现场）
    do: waitFor
    waitFor:
      has: ["/360×200[\\s\\S]{0,120}?200×120/"]
    timeoutMs: 30000
    expect:
      - label: 两张图片卡片相邻在场（两条元信息行按大小可区分）
        ax: { has: "/360×200[\\s\\S]{0,120}?200×120/" }
      - shot: 01-两张相邻卡片-光标在末尾段落

  # M456：原生菜单的 Paste 点完之后，window 的键盘焦点会丢（⌃B / 探针串注入因此 0/3 落地，
  # 套件的 keys 回读退到「编辑器优先」）。用一次真实鼠标点回到末尾空行重建 DOM 焦点——
  # 布局修复后末尾空行恒有一条可见、可点入的行（本步不移动光标语义：点的是空段落自身）。
  - name: 点末尾空行重建 composer 的 DOM 焦点（原生菜单粘贴后 window 失焦，M456 实测）
    do: clickInNode
    target: { role: AXTextArea, name: "200×120" }
    dy: 0.97
    expect:
      - label: composer 拿到键盘焦点（AX 里恰一个 focused 的 AXTextArea）
        ax: { focused: "AXTextArea" }

  - name: 抢回窗口前台（原生菜单交互后键盘焦点可能没回 webview——M456 在排查）
    do: focusWindow
    retries: 3

  - name: ⌃B（原生 caret 回移——实测闸：它到底把光标挪到了哪一格）
    do: key
    key: "ctrl+b"

  # M456：`do: keys` 的逐键注入在这里 0/3（focus 断言已 PASS、focusWindow 也做了 ⇒ 不是聚焦
  # 问题，是注入没落地，README「键盘注入整批丢键」同族）。改走剪贴板文本 + ⌘V 的粘贴通道。
  - name: 探针串置剪贴板（keys 注入 0/3 不落地 ⇒ 换粘贴通道）
    do: clipboardText
    text: "xqzk"

  - name: ⌘V 把探针串贴进 composer（落进哪一格 = 上面那一次 ⌃B 把光标挪到了哪）
    do: key
    key: cmd+v
    expect:
      - label: 探针串落在**两张卡片之间**（AX 文本里 xqzk 夹在 360×200 与 200×120 两条元信息行之间）
        ax: { has: "/360×200[\\s\\S]{0,200}?xqzk[\\s\\S]{0,200}?200×120/" }
      - label: 未落位签名不在场（缺陷形态：字落进末尾段落 ⇒ 它紧跟第二张卡的元信息行）
        ax: { not: "/200×120[\\s\\S]{0,20}?xqzk/" }
      - label: 打字没有漏进编辑器文档（焦点确在 composer）
        editor: { unchangedSince: doc-before-caret }
      - shot: 02-⌃B后在两卡之间打字

  - name: 一次撤销（物化 + 首次输入合一个撤销步）
    do: key
    key: "cmd+z"
    expect:
      - label: 探针串消失（一次撤销把「新段落 + 其中的字」一并收回）
        ax: { not: "xqzk" }
      - label: 两张卡片仍在（撤销不吞卡、两卡次序不变）
        ax: { has: "/360×200[\\s\\S]{0,200}?200×120/" }
      - shot: 03-撤销一次回到前态
---

# 134-harness-composer-intercard-caret —— 两卡之间可停光标、可在那里打字（M450，HC3）

## 本场景在验什么

Alex 原话（2026-10-11）：「我使用时发现 harness composer 里先贴两张图之后，不能通过 CTRL+B 把
光标挪到两张图之间。但我有时候需要这样的能力——先截几张图贴进去，然后在写内容。」

合同条款是 [docs/specs/harness-composer.md](../../../docs/specs/harness-composer.md) 的 **HC3**
（边界光标位 + 内容输入物化段落 + 导航不成撤销步），change 提案、design 与裁决点见
`openspec/changes/composer-intercard-caret/`。本场景覆盖其中三条**行为层**判据：

1. **⌃B 落位**（= 裁决点 2 的实测闸）：从末尾段落回移一次，光标应当落到两张卡之间的边界位；
2. **在边界位打字落点**：字落在两卡**之间**的新段落里，两张卡片原样保留；
3. **一次撤销**：回到「两张卡相邻、之间无段落」的前态（新段落与其内容一并收回）。

## 判据为什么这样写

- **为什么用「打字落点」代替「光标落点」**：本套件的 AX 通道不暴露 contenteditable 内的光标
  位置（套件 README「光标/选区不可断言」条），因此模型读回的光标位没有直接读数。但**模型读回的
  光标决定字落在哪一格**——字落在两卡之间 ⇒ 那一次 ⌃B 的落位被模型读成了「后一张卡的前缘」；
  字落进末尾段落 ⇒ 没读到。这条是「读数换形态」，不是判据放宽。
- **位置判据用尺寸后缀而不是卡片名**：两张图的文件名是内容寻址哈希（无从预知），但元信息行带
  像素尺寸（`· 360×200` / `· 200×120`，由 `harness_write_image` 回传的真实尺寸，M449 起恢复
  路径也会补上），两条元信息行因此可按大小区分；`[\s\S]{0,120}` 的正则窗口要求**顺序**成立
  （先 360×200 再 200×120），把「两张卡相邻且探针串夹在中间」编成一条判据。
- **未落位签名**：缺陷形态下探针串紧跟第二张卡的元信息行（间距只有换行 + 移除钮的 `×`），
  故 `200×120` 之后 20 字符内不得出现 `xqzk`——这条对「⌃B 没挪动光标」的形态有区分度。
- **右键落点 `dy: 0.94`**：末尾段落是 composer 的最下一块（其 `margin-bottom` 被
  `:last-child` 规则收口为 0，段落高 `1em`、composer 底 padding 只有 `--sp-1` = 2px），
  0.94 的比例落点稳定落在**段落**上而不是卡片上；落在卡片上会换掉原生菜单的编辑项（卡片是
  `contenteditable=false`），Paste 就不在了——菜单断言因此顺带守住这一步的落点。
- **`gapMs: 100`**：撤销栈的聚簇窗口是 1000ms（`createUndoHistory`）。物化与首次键入合成一个
  撤销步之后，后续键入靠聚簇挂进同一步；注入间隔放大到默认 250ms 时四拍合计可能越过窗口、
  变成第二个撤销步，一次 ⌘Z 就只收回最后一个字符——故显式压小间隔。

## 已知边界（如实登记）

- **光标可见性（设计 §6 的读数 ②）没有机器判据**：AX 不暴露光标几何，本场景留截图给 Alex
  人工过目（`shots/`），不写像素断言（光标是单像素级形态，采样点断言会退化成脆判据）。
- **模型读回的光标值本身（读数 ①）**：本套件读不到 JS 模型，见上「为什么用打字落点代替」。
- **IME 组合路径不在真机断言面**：`compositionstart` 的物化（design §3.2）走合成键注入造不出
  真实组合态（套件 README「合成鼠标拖拽会提交输入法的预编辑文本」条），该路径的判据落在单测层
  （`tests/unit/harness-composer.test.ts` 的边界光标位用例）与实现评审。
- **本场景不改动任何文件、不发送消息**：mock provider 只在内存里备着，零外部 API 调用；
  贴进去的图片落在隔离配置目录的 `harness/attachments/<vault id>/` 下（vault 零新增，
  与场景 127 同一条隔离口径）。
