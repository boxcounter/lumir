---
# M447（change composer-emacs-nav）：相邻两张卡片之间「一步跨过」的落点判据——⌃B 两次把光标
# 推到**第一张卡片的前缘**，在那里键入探针串，断言它落在两张卡片之前（不是两卡之间、也不是
# 末尾段落）。同时是「原子卡片一步跨过」这条语义的真机读数。
#
# 与场景 134 的关系：134 判「⌃B 一次到两卡之间」（M444 的边界位）；本场景判**再一步跨过第一张
# 卡片**（M447 的「卡片一步跨过」）。两条都走同一套模型层移动纯函数。
#
# 【M456 通道阻塞，2026-10-11 实测，如实登记】与 134 同因：原生菜单 Paste 之后 CGEvent 逐键注入
# （`keys` / `key`）对 composer 确定性死亡；KimiCU `type_text(index)` 在套件 spawn 的 MCP 会话里
# 也不落地（插件侧直调同 index 立刻落地）。⇒ 本场景的探针串注入同样**待注入通道修复**；
# 「⌃B 是否真的落地」也因此无法侧证（探针串是它的观测手段）。判据不动，由 tower 呈 Alex 裁决。
# **降级登记**（Alex 2026-10-11 裁决）：卡片「一步跨过」的模型层语义由单测覆盖
# （`tests/unit/harness-composer.test.ts`），本场景的真机读数在通道修好前不再刷红；
# 完整归因与修法方向见 backlog「待修 findings」的「菜单 Paste 之后注入不落地」条与 README 的「原生剪贴板命令」已知边界。
id: "141-harness-composer-nav-intercard"
item: 141
tier: full
title: composer 相邻卡片：⌃B 一步跨过 → 探针落在两卡之前（M447）
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

  - name: 剪贴板置合成 png #1（360×200，seed 41；两图尺寸不同 ⇒ 元信息行可按大小区分）
    do: clipboardImage
    synth: { width: 360, height: 200, seed: 41 }

  - name: 右键 composer 唤出 WebKit 原生菜单（Paste 通道）
    do: click
    target: { role: AXTextArea, name: "问点什么", button: right }
    expect:
      - label: 原生菜单出现且 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste 贴第一张图（空 composer 的段落起始 → [图片1, 空段落]）
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

  - name: 右键 composer 的末尾空段落带（dy 0.94 落在最下一块＝末尾段落上）
    do: click
    target: { role: AXTextArea, name: "360×200", button: right, dy: 0.94 }
    expect:
      - label: 原生菜单出现且 Paste 项在场（落点在编辑区 ⇒ 编辑菜单）
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste 贴第二张图（光标在末尾空段落段首 → 图片插在它之前 ⇒ [图片1, 图片2, 空段落]）
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }

  - name: 等第二张卡片落定（两张卡相邻、之间无段落）
    do: waitFor
    waitFor:
      has: ["/360×200[\\s\\S]{0,120}?200×120/"]
    timeoutMs: 30000
    expect:
      - label: 两张图片卡片相邻在场（两条元信息行按大小可区分）
        ax: { has: "/360×200[\\s\\S]{0,120}?200×120/" }
      - shot: 01-两张相邻卡片

  # M456：原生菜单 Paste 之后 window 键盘焦点丢失，⌃B / 探针串注入不落地——先点一次末尾空行
  # 重建 DOM 焦点（布局修复后末尾空行恒有一条可见、可点入的行）。
  - name: 点末尾空行重建 composer 的 DOM 焦点（原生菜单粘贴后 window 失焦，M456 实测）
    do: clickInNode
    target: { role: AXTextArea, name: "200×120" }
    dy: 0.97

  - name: ⌃B 两次（末尾段落 → 两卡之间 → 第一张卡片前缘）
    do: keys
    keys: ["ctrl+b", "ctrl+b"]
    gapMs: 150

  # M498 迁移边界（如实登记）：本步的落点即判据（⌃B 把光标推到两卡之前，探针串必须落在那里），
  # 而 typeInNode 的可靠通道是「追加到末尾」——语义不合，留在 do:keys。press_key 逐键通道
  # 对 composer 丢键（M497）在本步的形态：探针串 xqzk 无 'e'，暴露在随机连续丢键段风险下。
  - name: 键入探针串 xqzk（落进哪一格 = 上面两条 ⌃B 把光标推到了哪）
    do: keys
    keys: ["x", "q", "z", "k"]
    gapMs: 100
    expect:
      - label: 探针串落在**两张卡片之前**（AX 文本里 xqzk 在 360×200 之前）
        ax: { has: "/xqzk[\\s\\S]{0,200}?360×200/" }
      - label: 未跨过两张卡的签名不在场（只跨一张时 xqzk 会夹在两条元信息行之间）
        ax: { not: "/360×200[\\s\\S]{0,200}?xqzk[\\s\\S]{0,200}?200×120/" }
      - shot: 02-两次ctrl-b后打字

  - name: 一次撤销（物化 + 首次输入合一个撤销步）
    do: key
    key: "cmd+z"
    expect:
      - label: 探针串消失（一次撤销把「新段落 + 其中的字」一并收回）
        ax: { not: "xqzk" }
      - label: 两张卡片仍在且次序不变
        ax: { has: "/360×200[\\s\\S]{0,200}?200×120/" }
---

# 141-harness-composer-nav-intercard —— 相邻卡片一步跨过（M447）

## 本场景在验什么

change `composer-emacs-nav` 的移动族语义：**原子卡片在停靠点序列上只贡献一个停靠点**（前缘），
因此 ⌃B/⌃F 把整张卡片**一步跨过**。本场景用两张相邻合成图片卡片造现场：

- 起始光标在末尾段落段首；按 ⌃B 一次 → 落到两卡之间（后一张卡的前缘，M444 的边界位）；
- 再按 ⌃B → 落到**第一张卡片的前缘**（一步跨过第二张卡）；
- 在该处键入探针串 → 它落在两张卡片**之前**（AX 文本里在两条卡片元信息行之前）。

## 判据为什么这样写

- **落点用「打字落点」代替「光标落点」**：AX 不暴露 contenteditable 内的光标位；模型读回的
  光标决定字落在哪一格（与场景 134 同一口径，读数换形态）。
- **位置判据用尺寸后缀**：两张图的文件名是内容寻址哈希，但元信息行带真实像素尺寸
  （`· 360×200` / `· 200×120`），两条元信息行因此可按大小区分；`[\s\S]{0,200}` 的窗口要求
  **顺序**成立。
- **未跨过两张卡的负向断言**：只跨一张的形态下探针串夹在两条元信息行之间——`not` 那条对
  「跨得不够」的形态有区分度（REVIEW.md 「断言等价于子串」条：判据要有区分度）。
- **一次撤销**：物化与首次键入合成一个撤销步（HC3 的既有口径），探针串与它所在的新段落一并
  收回，两张卡片不丢。

## 已知边界（如实登记）

- 光标可见性没有机器判据（AX 不暴露光标几何），留截图人工过目。
- 本场景不发消息、不发送任何 wire（mock provider 只备着）；贴图落在隔离配置目录的
  `harness/attachments/<vault id>/` 下（vault 零新增，与场景 127/134 同一条隔离口径）。
- 真实 vault 与 `~/.config/lumir` 全程不读写；真机段走 `LUMIR_ACCEPTANCE_PORT`（1430）。
