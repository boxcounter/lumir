---
id: "45-tab-cycle-keys"
item: 45
tier: full
title: 标签循环键——⌃⇥ / ⌃⇧⇥ 与 ⌘⇧] / ⌘⇧[ 的真机循环语义（末端 / 首端回卷、单标签无操作）
fixtures: [tabs-a.md, tabs-b.md, tabs-long.md]
seed:
  registry:
    - { id: acc-tabcycle, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-tabcycle: { tabs: [tabs-a.md, tabs-b.md, tabs-long.md], active: tabs-a.md }
steps:
  - name: 等启动恢复（vault + 三个标签）跑完
    do: sleep
    ms: 8000
    expect:
      - label: 会话里的三个标签都恢复了（每个标签恰好一个关闭钮）
        ax: { count: { pattern: "关闭 ", exact: 3 } }
      - label: 激活项是会话里存的 tabs-a——标签栏的 aria-selected 落到 AXRadioButton 的 Value
        ax: { has: "/AXRadioButton \\(tabs-a\\.md\\) Value: true/" }
      - label: tabs-a 的正文上屏（回读通道：AXTextArea.value 就是前台文档）
        editor: { has: "标签场景 A" }
      - label: 另两份文档的正文都没有上屏（激活项读数的反证，REVIEW.md 「断言等价于子串」条）
        editor: { not: "标签场景 B" }
      - label: 长文正文也没有上屏
        editor: { not: "TOP-MARK" }
      - shot: 启动后的三个标签

  - name: 注入前把窗口带到前台（键盘注入的前台纪律，README「起实例前的环境纪律」）
    do: focusWindow
    expect:
      - label: 编辑器仍可读（正向锚点：这次 AX 读取是活的，后面的负向断言才不是空转）
        editor: { has: "标签场景 A" }
      - label: 起点仍在第一个标签
        ax: { has: "/AXRadioButton \\(tabs-a\\.md\\) Value: true/" }

  # ⌃⇥ / ⌃⇧⇥ 与 ⌘} / ⌘{ 指向的**同两条命令**（tab.next / tab.prev），实现在 src/tabs.ts 的
  # cycleTab 里只有一份（D3 裁决：复用、零新命令 id ⇒ 循环语义不可能因触发键不同而分叉）。
  # ⌘} / ⌘{ 的按键链路由本场景后面的 ⌘⇧] / ⌘⇧[ 两步验（change fix-tab-cycle-shift-symbols-nov27）；
  # 物理键盘手感仍归 Alex dogfood（注入形态 ≠ 物理 HID，见文末一节）。
  - name: ⌃⇥ 第一次：第一个 → 第二个
    do: key
    key: "ctrl+tab"
    expect:
      - label: 激活标签切到 tabs-b（标签栏 aria-selected 的 AX 读数）
        ax: { has: "/AXRadioButton \\(tabs-b\\.md\\) Value: true/" }
      - label: 反向：tabs-a 不再是激活项（不是「两个都 true」）
        ax: { not: "/AXRadioButton \\(tabs-a\\.md\\) Value: true/" }
      - label: tabs-b 的正文上屏（切标签必须真的换文档，不只是换高亮）
        editor: { has: "标签场景 B" }
      - label: tabs-a 的正文不在编辑器里
        editor: { not: "标签场景 A" }
      - shot: 循环-第二次

  - name: ⌃⇥ 第二次：第二个 → 第三个
    do: key
    key: "ctrl+tab"
    expect:
      - label: 激活标签切到 tabs-long
        ax: { has: "/AXRadioButton \\(tabs-long\\.md\\) Value: true/" }
      - label: 长文正文上屏
        editor: { has: "TOP-MARK" }
      - shot: 循环-第三次

  - name: ⌃⇥ 第三次：在末端回卷到第一个（D1 裁决的环绕）
    do: key
    key: "ctrl+tab"
    expect:
      - label: 已在最后一个标签仍往后切 → 回卷到第一个
        ax: { has: "/AXRadioButton \\(tabs-a\\.md\\) Value: true/" }
      - label: tabs-a 的正文上屏（回卷真的换了文档，不是「到末端就停住」）
        editor: { has: "标签场景 A" }
      - label: 反向：不是停在第三个（若实现是 D1-b「停住」，这条会红）
        ax: { not: "/AXRadioButton \\(tabs-long\\.md\\) Value: true/" }
      - shot: 末端回卷

  - name: ⌃⇧⇥ 第一次：在首端回卷到最后一个（D1）
    do: key
    key: "ctrl+shift+tab"
    expect:
      - label: 在第一个标签往前切 → 回卷到最后一个（tabs-long）
        ax: { has: "/AXRadioButton \\(tabs-long\\.md\\) Value: true/" }
      - label: 长文正文上屏
        editor: { has: "TOP-MARK" }
      - label: 反向：不是停在第一个（若实现是「停住」，这条会红）
        ax: { not: "/AXRadioButton \\(tabs-a\\.md\\) Value: true/" }
      - shot: 首端回卷

  - name: ⌃⇧⇥ 第二次：最后一个 → 中间那个
    do: key
    key: "ctrl+shift+tab"
    expect:
      - label: 激活标签切到 tabs-b
        ax: { has: "/AXRadioButton \\(tabs-b\\.md\\) Value: true/" }
      - label: tabs-b 的正文上屏
        editor: { has: "标签场景 B" }

  - name: ⌃⇧⇥ 第三次：回到第一个（与起点闭环）
    do: key
    key: "ctrl+shift+tab"
    expect:
      - label: 回到起点 tabs-a
        ax: { has: "/AXRadioButton \\(tabs-a\\.md\\) Value: true/" }
      - label: tabs-a 的正文上屏
        editor: { has: "标签场景 A" }

  # —— ⌘⇧] / ⌘⇧[：与 ⌃⇥ / ⌃⇧⇥ 同两条命令（tab.next / tab.prev），token 归一后本通道可达
  # （change fix-tab-cycle-shift-symbols-nov27；形态证据见文末一节）。放在 ⌃⇧⇥ 闭环之后：
  # 此时前台是 tabs-a，两条命令各自的第一步都有明确读数。
  - name: ⌘⇧]（cmd+shift+rightbracket）：第一个 → 第二个
    do: key
    key: "cmd+shift+rightbracket"
    expect:
      - label: 激活标签切到 tabs-b（⌘⇧] 与 ⌃⇥ 同指 tab.next）
        ax: { has: "/AXRadioButton \\(tabs-b\\.md\\) Value: true/" }
      - label: 反向：tabs-a 不再是激活项
        ax: { not: "/AXRadioButton \\(tabs-a\\.md\\) Value: true/" }
      - label: tabs-b 的正文上屏（切标签必须真的换文档）
        editor: { has: "标签场景 B" }
      - shot: ⌘⇧] 切到第二个

  - name: ⌘⇧[（cmd+shift+leftbracket）：第二个 → 第一个
    do: key
    key: "cmd+shift+leftbracket"
    expect:
      - label: 回到 tabs-a（⌘⇧[ 与 ⌃⇧⇥ 同指 tab.prev）
        ax: { has: "/AXRadioButton \\(tabs-a\\.md\\) Value: true/" }
      - label: tabs-a 的正文上屏
        editor: { has: "标签场景 A" }
      - label: 反向：tabs-b 不再是激活项
        ax: { not: "/AXRadioButton \\(tabs-b\\.md\\) Value: true/" }
      - shot: ⌘⇧[ 回到第一个

  # —— 单标签时的无操作。放在场景末尾，是为了让「这两条命令真的会切标签」这件事在前面几步
  # 已被同一对绑定的正向步骤证实（同一次运行、同一条注入通道）——否则负向断言在「键根本没
  # 落地」时会空转（REVIEW.md 「断言等价于子串」条）。三个标签都是 seed 恢复的干净标签，⌘W 直接关、不弹确认。
  - name: 收窄到单标签——⌘W 关掉当前标签（第一个，右邻接管）
    do: key
    key: "cmd+w"
    expect:
      - label: 只剩两个标签
        ax: { count: { pattern: "关闭 ", exact: 2 } }
      - label: 前台交给右邻（tabs-b，closeSession 的既有口径）
        ax: { has: "/AXRadioButton \\(tabs-b\\.md\\) Value: true/" }
      - label: tabs-b 的正文上屏
        editor: { has: "标签场景 B" }

  - name: 再 ⌘W 关掉第二个
    do: key
    key: "cmd+w"
    expect:
      - label: 只剩一个标签
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 剩下的是 tabs-long 且它是前台
        ax: { has: "/AXRadioButton \\(tabs-long\\.md\\) Value: true/" }
      - label: 长文正文上屏
        editor: { has: "TOP-MARK" }
      - shot: 单标签

  - name: 记下单标签态的编辑器基线（负向断言的逐字节比较基准）
    do: recordEditor
    as: solo
    expect:
      - label: 基线非空（记的是真文档；不可读时 recordEditor 直接报错，不在空串上空转）
        editor: { has: "TOP-MARK" }

  - name: 单标签时 ⌃⇥ 无操作（标签数 < 2，cycleTab 直接返回）
    do: key
    key: "ctrl+tab"
    expect:
      - label: 前台标签没变（仍是唯一的那个，它的 AXRadioButton Value 仍是 true）
        ax: { has: "/AXRadioButton \\(tabs-long\\.md\\) Value: true/" }
      - label: 标签数仍是 1（没有凭空多出标签）
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 文档逐字节未变（不是「切到别的文档又切回来」——只看子串挡不住这种）
        editor: { unchangedSince: solo }
      - shot: 单标签-⌃⇥

  - name: 单标签时 ⌃⇧⇥ 同样无操作
    do: key
    key: "ctrl+shift+tab"
    expect:
      - label: 前台标签仍未变
        ax: { has: "/AXRadioButton \\(tabs-long\\.md\\) Value: true/" }
      - label: 标签数仍是 1
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 文档逐字节未变（与上一步记的同一基线比——上一步的 ⌃⇥ 也没能改动它）
        editor: { unchangedSince: solo }
      - shot: 单标签-⌃⇧⇥
---

# 标签循环键（change tab-cycle-keys / M242）

## 这个场景验什么

本 change（`⌘}` → `tab.next`、`⌘{` → `tab.prev`，零新命令、复用 `tab.next` / `tab.prev`）在真机上能
验的部分：

1. **循环切换与两侧环绕**（D1 裁决）：三个真标签上逐次 `⌃⇥` 到末端回卷到第一个、`⌃⇧⇥` 在首端
   回卷到最后一个。**这两条键指向的是与新键完全相同的两条命令与同一份 `cycleTab` 实现**
   （`src/tabs.ts`，D3 裁决零新命令、零分叉）——所以这里验的循环语义就是 `⌘}` / `⌘{` 会走的那份。
2. **单标签无操作**（`cycleTab` 的既有边界）：只剩一个标签时 `⌃⇥` / `⌃⇧⇥` 都不改变前台标签与文档
   （逐字节比较）。
3. `⌘W` 关标签的右邻接管口径（作为把标签收窄到 1 个的顺带覆盖，不是本 change 的新行为）。

**本场景也验**：`⌘⇧]` / `⌘⇧[` 自己的「按键 → 切标签」链路（change fix-tab-cycle-shift-symbols-nov27
之后本通道可达；形态证据与边界见下一节）。仍未验的是**物理键盘**的 `characters` 取值——修复对两种形态
都成立，这一差异不影响行为判据。

## ⌘} / ⌘{ 的真机通道：形态差异已由归一化收口（change fix-tab-cycle-shift-symbols-nov27）

**结论**：本场景现在**验** `⌘⇧]` / `⌘⇧[` 的按键链路（见上方两步）。旧版这里登记的是「验不了」——
原因是当时只收 `Cmd-}` 这一种 token，而注入通道给的是 `key="]" + shiftKey`（下表三条实测）。

**旧口径的前提失效了**：M242 假设「真机给 `key="}"`（Shift 隐含在字符里）」，但这条**没有任何真机
证据**；2026-11-27 的独立 WKWebView 探针（裸 WKWebView + 与 Tauri 同 accelerator 集合的菜单，
经自建 CGEvent 与 System Events 两条通道注入 keycode + flags）实测：

| 层 | `⌘⇧]` 的实测值 |
|---|---|
| NSEvent | `characters="]"`、`charactersIgnoringModifiers="}"` |
| DOM `KeyboardEvent` | `key="]"`、`code="BracketRight"`、`shiftKey=true`、`metaKey=true` |
| 旧 token | `Cmd-Shift-]`（表内只有 `Cmd-}` ⇒ 永不命中） |

来源核对：WebKit 的 `keyForKeyEvent`（`Source/WebCore/platform/mac/PlatformEventFactoryMac.mm`）
在**无 Control** 时取 `[event characters]`，不是 `charactersIgnoringModifiers`——Command+Shift 下
`characters` 是未 Shift 的字符。探针工程与原始事件日志见 `.local/probes/tab-navigation-keys-nov27/`
（git 外）。

**修复口径**：`normalizeKey` 把「Shift + 未 Shift 字符」与 Shift 后的字符归一到同一 token
（`SHIFTED_SYMBOLS`，与 `key-glyphs.ts` 同一来源），事件与 `[keys]` 配置两侧一致；表内仍只写
`Cmd-}` / `Cmd-{` 一条绑定，不双写。

**本场景能验到哪、验不到哪**：
- 能验：KimiCU 注入 → DOM keydown → token 归一 → `tab.next` / `tab.prev` → `cycleTab` 的整条链路
  （注入形态恰是修复覆盖的形态）。
- 验不到：**物理键盘**按下时 macOS 填进 `characters` 的到底是 `}` 还是 `]`——注入事件与物理事件
  在 TSM 翻译层可能不同（本仓没有物理按键的自动化通道）。修复对两种形态都成立，因此这一差异
  不影响行为判据；真机手感与物理键确认仍由 Alex 在 dogfood 时给一次读数（按 ⌘⇧] 看标签是否切换）。

**旧实测三条**（2026-09-26，日志 `.local/missions/m232/`，git 外，保留作历史）：
1. 键名形态：KimiCU 用 `rightbracket` / `leftbracket`；xdotool 的 `bracketright` 会被拒。
2. 注入形态：`cmd+shift+rightbracket` 落地为 `key="]" + shiftKey`。
3. 字面字符形态 `cmd+}` 被解析器拒（`unknown key`）。

## 断言口径

- **「当前激活哪个标签」的读数 = 标签栏的 `AXRadioButton (文件名) Value: true`**。标签栏用
  `role="tab"` + `aria-selected`（`src/tabs.ts:104-105`），WKWebView 把它暴露成 `AXRadioButton` 的
  `Value`（未选中的是 `Value: false`）。判据直接指向「哪一个是前台」，不靠按键自报成功。
- **第二条独立判据 = 编辑器文档文本**（`AXTextArea.value`）。切标签必须连带换文档，只有
  `editor.has / editor.not` 能证这一点；两条一起用才有区分度。
- **负向断言都带正向配对**：每个 `ax: { not: ... }` 都跟一条 `ax: { has: ... }` 在位；`editor.not`
  也都配一条 `editor.has`——避免「读不到 / 本来就没有」被当成「已切换」。
- **单标签无操作走逐字节比较**（`recordEditor` + `editor.unchangedSince`），不用子串：
  「切走又切回」同样满足子串断言，只有字节比较能挡住。

## 为什么三个标签用 `seed.sessions` 预置

多标签的打开语义是「首次输入即固定」，现场凑三个标签要把前两个敲脏、收尾关它们还得过确认浮条。
`seed.sessions` 让启动直接恢复三个**干净**标签，顺序固定为 `[tabs-a, tabs-b, tabs-long]`，收尾
`⌘W` 直接关、不弹确认。

## 已知边界（如实登记，不读成「全量已验」）

- **⌘} / ⌘{ 的按键链路**：本场景已验（注入形态 `key="]" + shiftKey` 经 `SHIFTED_SYMBOLS` 归一到
  `Cmd-}`）；**物理键盘**的 `characters` 取值仍未验（见上节），修复对两种形态都成立，不影响判据。
- **Tab / Shift-Tab 的注入边界**仍登记在 `scripts/acceptance/README.md` 的「键盘注入通道的两类不可达」；
  该节第 2 条（Shift 隐含符号）已由 change fix-tab-cycle-shift-symbols-nov27 收口，本节只留本场景结论。
- **注入通道丢键**：`press_key` 对 WKWebView 间歇整批丢键（REVIEW.md 「键盘注入丢键」条，同机第二个实例
  显著加剧）。**红了先按丢键复跑一次再判产品缺陷**——丢键的表现就是激活标签读数没变。
- **不做手感判定**：标签切换的动画 / 高亮观感归 Alex，本场景只留截图。
- **不新增像素基线**：`shot` 是给人看的证据（Alex 抽审），不做逐像素比较。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance`，隔离 `XDG_CONFIG_HOME`；用户真实 vault 只读。
- 本场景只关标签、不写盘（标签都是 seed 恢复的干净标签）。
