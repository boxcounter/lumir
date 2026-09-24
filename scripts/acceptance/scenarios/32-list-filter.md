---
id: "32-list-filter"
item: 32
title: 两处列表浮层的输入筛选（大纲 / vault 切换器）：打字即筛、结果集里的游标与跳转落点、无命中保留浮层、Esc 一步丢弃查询
fixtures: [list-filter.md]
open: list-filter.md
marker: "筛选场景的根节点"
seed:
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
steps:
  - name: 打开筛选 fixture（ASCII 标题，供单字符注入路径命中中文之外的串）
    do: settle
    expect:
      - shot: 文档与位置指示
      - label: 编辑器已装载本 fixture
        editor: { has: "筛选场景的根节点" }
      - label: 未激活时没有浮层
        ax: { not: "⌃N⌃P 选择" }

  - name: 确保窗口在前台（键盘场景的前台纪律：窗口被遮挡时注入整批丢键）
    do: focusWindow

  - name: ⌘⇧O 打开大纲浮层（焦点随打开落到筛选输入框）
    do: key
    key: "cmd+shift+o"
    expect:
      - shot: 浮层打开（输入行 + 列表 + 底部提示）
      - label: 浮层已展开
        ax: { has: "⌃N⌃P 选择" }
      - label: 焦点在可编辑的输入框上（不是列表上）——焦点迁移的判据（change list-filter 的 design §2.3）
        ax: { focused: "AXComboBox" }
      - label: 输入框的占位文案在位（deck D118：本浮层没有提示行，输入的可发现性只靠它）
        ax: { has: "输入以筛选" }

  # 查询串逐字符一步：单字符的注入要么落地要么没落地（`keys` 的回读判据对单字符是完备的），
  # 多字符串一旦部分落地会按「不重试、直接报错」处置（README 的历史教训），本场景因此不用多字符串。
  - name: 键入 b（输入即筛的第一个字符）
    do: keys
    keys: ["b"]
    expect:
      - label: 浮层仍开着（打字不关浮层）
        ax: { has: "⌃N⌃P 选择" }

  - name: 键入 a
    do: keys
    keys: ["a"]

  - name: 键入 n（查询 = ban）
    do: keys
    keys: ["n"]
    expect:
      - shot: 输入 ban 之后
      - label: 查询串落在输入框里（AXValue 逐字；这也正是 `keys` 回读判据读的字段）
        ax: { has: "/AXComboBox \\(筛选\\) Value: ban(?![a-zA-Z])/" }
      - label: 占位文案已让位（查询非空）
        ax: { not: "输入以筛选" }

  - name: ↓ 在**结果集**里移动一条（结果集 = Banana 小节 / Banana 细节）
    do: keys
    keys: ["Down"]

  - name: Enter 跳转（判据取自被测功能自己的产出：modeline 指示段的标题链只可能是光标所在位置生成的）
    do: key
    key: "return"
    expect:
      - shot: 跳转之后
      - label: 浮层已收起
        ax: { not: "⌃N⌃P 选择" }
      - label: 落在「Banana 细节」那一段（查询命中两条，↓ 一条 + Enter = 结果集第 2 条 = 源下标第 4 条）
        ax: { has: "Filter 章节 › Banana 小节 › Banana 细节" }
      - label: 文档内容未被改动（跳转只改选区与视口）
        editor: { has: "Banana 细节正文。" }

  - name: 再开浮层（查询随关闭丢弃 → 空查询、全量态起点 = 当前段，即刚跳到的 Banana 细节）
    do: key
    key: "cmd+shift+o"
    expect:
      - label: 浮层已展开
        ax: { has: "⌃N⌃P 选择" }

  - name: 直接 Enter（不输入查询）
    do: key
    key: "return"
    expect:
      - label: 空查询下全量态起点是当前段 → 链条仍是 Banana 细节这一段（重开没有残留查询，否则会落在 Banana 小节）
        ax: { has: "Filter 章节 › Banana 小节 › Banana 细节" }

  - name: ⌘⇧O 再开并输入一个零命中的查询
    do: key
    key: "cmd+shift+o"
    expect:
      - label: 浮层已展开
        ax: { has: "⌃N⌃P 选择" }

  - name: 键入 z（零命中查询的第一个字符）
    do: keys
    keys: ["z"]

  - name: 键入 z
    do: keys
    keys: ["z"]

  - name: 键入 z
    do: keys
    keys: ["z"]

  - name: 键入 z（查询 = zzzz，无命中）
    do: keys
    keys: ["z"]
    expect:
      - shot: 无命中态（浮层保持打开 + 一行提示 + 底部提示仍常驻）
      - label: 浮层保持打开（无命中不关浮层）
        ax: { has: "↑↓ ⌃N⌃P 选择 · Enter 跳转 · Esc 关闭" }
      - label: 列表区给出无匹配提示（文案 D117）
        ax: { has: "没有匹配的条目" }
      - label: MUST NOT 复用「文档没有标题」那条（两者是不同的情形）
        ax: { not: "这份文档还没有标题" }

  - name: 无命中时按 Enter（没有游标 → 无操作）
    do: key
    key: "return"
    expect:
      - label: 浮层仍在（Enter 没有把浮层关掉）
        ax: { has: "没有匹配的条目" }
      - label: 也没有跳到别处（链条仍是原处）
        ax: { has: "Filter 章节 › Banana 小节 › Banana 细节" }

  - name: Esc 一步关闭浮层并丢弃查询
    do: key
    key: "escape"
    expect:
      - label: 浮层已收起（一次 Esc 就够，不需要按两次）
        ax: { not: "没有匹配的条目" }
      - label: 文档没动
        editor: { has: "Banana 细节正文。" }

  - name: 重开后查小写查询（大小写折叠：小写查询命中混合大小写的文本 `Apple 小节`）
    do: key
    key: "cmd+shift+o"
    expect:
      - label: 浮层已展开、输入框是空的（上一轮的查询已丢弃）
        ax: { has: "输入以筛选" }
      - label: 焦点仍在输入框上
        ax: { focused: "AXComboBox" }

  - name: 键入 a
    do: keys
    keys: ["a"]

  - name: 键入 p
    do: keys
    keys: ["p"]

  - name: 键入 p
    do: keys
    keys: ["p"]

  - name: 键入 l
    do: keys
    keys: ["l"]

  - name: 键入 e（查询 = apple）
    do: keys
    keys: ["e"]
    expect:
      - label: 查询串逐字落进输入框
        ax: { has: "/AXComboBox \\(筛选\\) Value: apple(?![a-z])/" }

  - name: Enter 跳转（小写查询命中 `Apple 小节`，首条命中）
    do: key
    key: "return"
    expect:
      - label: 落在 Apple 小节那一段（大小写折叠成立；若查询被忽略，全量态起点会给出 Banana 细节那一段）
        ax: { has: "Filter 章节 › Apple 小节" }

  - name: 重开后键入一个字符，再用 ⌘A + ⌫ 清空（原生文本编辑清查询）
    do: key
    key: "cmd+shift+o"
    expect:
      - label: 浮层已展开
        ax: { has: "⌃N⌃P 选择" }

  - name: 键入 c
    do: keys
    keys: ["c"]
    expect:
      - label: 查询非空 → 占位文案让位
        ax: { not: "输入以筛选" }

  - name: ⌘A + ⌫ 清空查询
    do: keys
    keys: ["cmd+a", "Backspace"]
    expect:
      - shot: 清空查询之后
      - label: 浮层仍开着
        ax: { has: "⌃N⌃P 选择" }
      - label: 输入框回到空（占位文案回来了）
        ax: { has: "输入以筛选" }

  - name: Enter（清空后回到全量态起点 = 当前段 Apple 小节）
    do: key
    key: "return"
    expect:
      - label: 全量态起点是当前段（Apple 小节）——查询清空后结果集回到全量
        ax: { has: "Filter 章节 › Apple 小节" }

  - name: 再确保窗口在前台（本批实测：跑到这一步时窗口曾被别的窗口盖住，⌘O 整批没落地）
    do: focusWindow

  - name: 确认大纲浮层已收起（下一步点树头部入口；上一段的 Enter 若丢键，浮层会还开着）
    do: key
    key: "escape"
    expect:
      - label: 大纲浮层已收起
        ax: { not: "⌃N⌃P 选择" }

  # 走**点击**入口而不是 ⌘O：chord 注入没有回读与重试（README 的判定边界），本批实测里 ⌘O
  # 整批丢过一次，连带 vault 段全部 FAIL；入口的 AXPress 是确定路径。
  - name: 点树头部的 vault 入口打开切换器（点击路径；入口是 AXPopUpButton）
    do: click
    target: { role: AXPopUpButton, name: "vault：" }
    expect:
      - shot: vault 浮层打开
      - label: 浮层已展开（列表里有预置的两个 vault）——判据取新增入口的**读屏名**（该按钮带 `aria-label`，AX 的 name 就是 `选择一个目录作为新 vault`，可见文本 `＋新增 vault…` 不单独成节点）
        ax: { has: "选择一个目录作为新 vault" }
      - label: 焦点在可编辑的输入框上
        ax: { focused: "AXComboBox" }

  - name: 键入 b（只命中名字含 b 的那个 vault）
    do: keys
    keys: ["b"]
    expect:
      - shot: 输入 b 之后的 vault 列表
      - label: 被筛掉的那一行连路径行一起消失（当前 vault 的行不再在列表里）
        ax: { not: "/\\/private\\/tmp\\/lumir-m102-acceptance(?!-)/" }
      - label: 命中的那一行还在（`-b` 那个 vault 的完整路径）
        ax: { has: "/private/tmp/lumir-m102-acceptance-b" }
      - label: 「新增 vault…」不受筛选影响（它不在列表里；判据同上是它的读屏名）
        ax: { has: "选择一个目录作为新 vault" }
      - label: 当前 vault 没有被改动（树头部名称不变）
        ax: { has: "vault：lumir-m102-acceptance（点击查看全部 vault）" }

  - name: Esc 收起 vault 浮层（查询丢弃）
    do: key
    key: "escape"
    expect:
      - label: 浮层已收起
        ax: { not: "选择一个目录作为新 vault" }
      - label: 文档未变动
        editor: { has: "Apple 小节正文。" }
---

# 32 — 两处列表浮层的输入筛选

需求原话（Alex，2026-09-24）：「Outline 和 vault 列表里支持输入筛选，比如 vault 列表显示时当我输入"s"时
就会筛选出 s 开头的 vaults」。裁决与条款见 `openspec/changes/list-filter/`（节点 1 裁决：五个裁决点全
采纳推荐），实现落点在 `src/list-filter.ts`（匹配与查询状态的唯一实现）+ `src/toc.ts` /
`src/vault-switcher.ts`（两处浮层的接入）。

## 判据为什么这样取

真机套件的两条硬边界决定了本场景的判据形态：

1. **AX 不给几何、不给条目计数**（`scripts/acceptance/README.md` 的「已知边界」）：因此「列表里现在有
   哪几条」不能直接数行，只能取**派生证据**——被测功能自己的产出。本场景用的是 **modeline 指示段的标题链**
   （`src/toc.ts` 的 `itemPath`，口径是「光标在可见范围内取光标」）：跳转后光标必落在目标段里，链条
   就是光标的函数。于是：
   - 查询 `ban` + `↓` + `Enter` 后链条必须是 `Filter 章节 › Banana 小节 › Banana 细节`。
     这条同时判三件事：查询真的筛掉了别的条目（否则全量态起点是当前段 `Filter 章节`）、`↓` 在**结果集**
     里移动（否则落到全文第 2 条 `Apple 小节`）、`Enter` 的落点经「结果集下标 → 源下标」映射回源条目
     （否则落到全文第 1 条）。
   - 重开后直接 `Enter` 给出当前段那一段，判「查询随关闭丢弃、重开是空查询 + 全量态起点」。
2. **单字符注入走 `do: keys` 的回读通道**（`type_text` 会先真实点击编辑器，落不到浮层里的输入框）：
   因此 fixture 的标题用 ASCII（`Apple` / `Banana` / `Cherry`），查询串也取 ASCII，且**一个字符一步**
   （多字符串一旦部分落地会按「不重试、直接报错」处置）。**大小写也只走小写方向**：CGEvent 注入的
   `A` 在真机上落成 `a`（同族边界见 `scripts/acceptance/README.md` 的 ⌘⇧= 那条），因此「大写查询命中
   混合大小写文本」这一半依赖反向情形覆盖——`Apple 小节` 用 `apple` 命中，折叠的语义已经吃到。
   中文查询串的注入依赖输入法，真机通道造不出来
   ——**这一条如实记为未覆盖**（中文匹配由 `tests/unit/list-filter.test.ts` 的 CJK 用例与
   `tests/visual/scenes/list-filter.spec.ts` 覆盖）。

`ax: { focused: "AXComboBox" }` 是「焦点迁移」的判据（change list-filter 的 design §2.3）：焦点从列表移到
输入框后，读屏与键盘的落点都变了。**实测（2026-09-24）**：`<input role="combobox">` 在 WKWebView 的 AX
里落成 **AXComboBox**（不是 AXTextField），且它的文本经 `Value: …` 暴露——本批同时修了套件对这一形态的
两处支持（`lib/ax.mjs` 的 value 解析、`lib/execute.mjs` 的 `TEXT_FIELD_ROLES`），否则 `keys` 的回读会盯
在 label 上、注入的落地永远判不出来（现场读数见 `test-results/m199/`）。

## 覆盖边界（如实记录）

- **未覆盖**：中文 / 拼音查询串的真机注入（通道造不出输入法组合）；点击输入框落焦点的现象在 vault 侧由
  `tests/visual/scenes/list-filter.spec.ts` 覆盖（真机上「点了没反应」只能人工或 chromium 判）；
  击键到渲染完成的时长（读数在 `test-results/m199/filter-keystroke.json`，不是本场景的断言）。
- **手感项归 Alex**：输入即筛的跟手感、无命中态的观感。
- 本场景只判行为，不拍基线（浮层的像素基线归 `tests/visual`）。
