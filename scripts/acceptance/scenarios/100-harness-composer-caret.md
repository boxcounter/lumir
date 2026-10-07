---
id: "100-harness-composer-caret"
item: 100
title: 发送后焦点回 composer：点击发送钮后焦点落回输入区，续打字进 composer 不进文档
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-caret.json"
seed:
  # 预置「上次会话里 harness 面板在场」⇒ 启动即装配出面板（场景 95 口径：全程零键盘打开面板；
  # composer 聚焦走真实鼠标点击，不走 ⌘⇧A）。
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-a:
      panes:
        - { tabs: [harness-note.md], active: harness-note.md }
      harnessPane: true
steps:
  - name: 等启动恢复落定——面板与 composer 就位
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "问点什么"]
    timeoutMs: 40000
    expect:
      - label: harness 面板按存储恢复成旁侧 pane（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 在场（占位文案 = 空输入态的 D328 读屏名）
        ax: { has: "问点什么" }

  - name: 真实鼠标点 composer（clickInNode 走坐标点击——contenteditable 的 DOM 焦点靠真实 mousedown 建立）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 记文档基线（后续「打字没进文档」的逐字节对照）
    do: recordEditor
    as: doc-before-send

  - name: 键入提问（keys 对可打印序列做回读 + 重试）
    do: keys
    keys: ["c", "a", "r", "e", "t", "p", "r", "o", "b", "e", "1"]
    expect:
      - label: 提问落在 composer 里（点焦点成立——下一步发送才有内容）
        ax: { has: "caretprobe1" }

  - name: 真实鼠标点发送钮（坐标点击路径——按钮拿到 DOM 焦点，正是缺陷现场的发送方式）
    do: clickInNode
    target: { role: AXButton, name: "^发送$" }

  - name: 等回答到达（mock fixture 弹脚本 ⇒ 本轮完成）
    do: waitFor
    waitFor:
      has: ["CARET-ANSWER-01"]
    timeoutMs: 30000

  - name: 发送后焦点断言——focused 节点是 AXTextArea（= composer；修前焦点留在发送钮 = AXButton，本条 FAIL）
    do: settle
    expect:
      - label: 焦点回到输入区（composer 的 AXTextArea；REVIEW.md 第 1 条——落点断言走 focused 解析形态）
        ax: { focused: "AXTextArea" }
      - shot: 01-发送后-焦点回-composer

  - name: 续打字 probe（落点 = 上一步验过的 focused 节点）
    do: keys
    keys: ["c", "a", "r", "e", "t", "b", "a", "c", "k", "2"]
    expect:
      - label: 续打字落进 composer（AX 里 composer 值含 probe）
        ax: { has: "caretback2" }
      - label: 文档逐字节未变（打字没有落进编辑器——焦点确在 composer 而非文档）
        editor: { unchangedSince: doc-before-send }
      - shot: 02-续打字落-composer
---

# 100-harness-composer-caret —— 发送后 composer 焦点与光标复位（M372 缺陷 3）

## 本场景在验什么

Alex 原话：「在发送了消息后，composer 中光标位置变成最左上角，而不是默认的位置」。根因：
`send()` 清空 composer 走 `replaceChildren()`，WebKit 把既有的 DOM 选区塌到 composer 元素
边界——视觉上光标跑到输入区最左上角；点击发送钮的路径里焦点更是留在按钮上。修复：
清空后显式 `composer.focus()` + `setDomCaret({block: 0, offset: 0})`，焦点与光标回到输入区。

真机可观测回路（mock provider，零外部 API）：

1. **真实鼠标点发送钮**发送（坐标点击路径——按钮按 WKWebView 语义拿到 DOM 焦点，是缺陷
   报告的同款发送方式；AXPress 路径不挪焦点，验不到这条缺陷）。
2. **焦点断言**：回答到达后 AX 里唯一 focused 节点是 `AXTextArea`（= composer）。修前焦点
   留在发送钮（`AXButton`），本条 FAIL——区分度自证。
3. **续打字双锁**：再键入 `caretback2` ⇒ 它出现在 AX 里（落进了 composer 的值）**且**
   编辑器文本相对基线逐字节未变（没落进文档）。两条联合排除「焦点其实在编辑器」的假绿。

## 断言口径

- **落点断言走 `ax: { focused: "AXTextArea" }` 解析形态**（REVIEW.md 第 1 条），不用跨节点
  正则。composer 与编辑器都是 `AXTextArea`，单看 role 分不出谁——所以续打字那条用
  「composer 值出现 probe + 文档逐字节不变」联合锁定是 composer 而不是编辑器。
- **`clickInNode` 是真实鼠标事件**（节点 bbox 内坐标点击）：composer 的 contenteditable
  DOM 焦点与按钮的 DOM 焦点都靠真实 mousedown 建立；`click` 的 AX 索引路径走 AXPress，
  不挪 DOM 焦点，本场景刻意不用它点这两处。
- **Enter 发送路径的「光标在段落内 vs 元素边界」是像素面**：两条路径下 composer 都保持
  DOM 焦点（AX 不可分辨光标在空段落内的像素位置），该形态归 Alex 手感验收，如实登记。

## 已知边界（如实登记）

- **光标像素位置（最左上角 vs 段落内）不在本场景**：AX 不暴露 contenteditable 内光标的
  几何位置；本场景断言的是「焦点落在 composer + 续打字落点正确」这条机器可判定链。
- **Enter 路径不重复覆盖**：如上节，其 AX 形态与点击路径修复后相同，差异仅在 caret 渲染
  位置（手感层）。
- **「空 text 不进请求」（M372 缺陷 1）不在真机断言**：真机套件没有读请求体的通道——
  请求组装级判据由 Rust 单测钉死（`assistant_item_omits_empty_text_message` 与
  `tool_only_round_skips_empty_assistant_and_persists_tool_summary` 的 ③），真实 provider
  侧残留风险见 mission 报告。

## 环境与副作用

- 不写 vault 文件、不碰剪贴板；mock provider 只在内存里弹脚本，零外部 API 调用。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；真实 vault 与
  `~/.config/lumir` 全程不读写。1420 全程不碰。
