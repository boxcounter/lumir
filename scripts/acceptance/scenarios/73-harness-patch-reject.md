---
id: "73-harness-patch-reject"
item: 73
title: Harness ④ patch 批准闸：拒绝不落盘（change add-harness-probe，mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-patch.json"
steps:
  - name: 记下基线（sha256 + mtime）
    do: record
    as: before
    file: harness-note.md

  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 抢前台（后台注入整批丢键/错键会显著加剧——REVIEW.md 第 11 条）
    do: focusWindow
    retries: 4

  - name: 输入提问并 Enter 发送
    do: keys
    keys: ["p", "a", "t", "c", "h", "i", "t"]
  - name: 发送
    do: key
    key: enter

  - name: 等批准闸出现
    do: waitFor
    waitFor:
      has: ["vault_patch 请求修改文件，采纳后才落盘："]
    expect:
      - label: 批准闸在场（本场景拒绝闸的正观测）
        ax: { has: "vault_patch 请求修改文件，采纳后才落盘：" }
      - shot: 01-批准闸

  - name: 点拒绝原因输入框（批准闸里的 AXTextField）
    do: click
    target: { role: AXTextField }

  - name: 输入拒绝原因（合成串；走可回读通道，丢键会按套件口径重试）
    do: keys
    keys: ["h", "o", "l", "d", "o", "f", "f"]

  - name: 点击拒绝
    do: click
    target: { role: AXButton, name: "^拒绝$" }

  - name: 等循环收尾（拒绝回送模型 → 最终回答）
    do: waitFor
    waitFor:
      has: ["第二行处理完了。"]
    expect:
      - label: 工具终态是 rejected（细分状态进 summary）
        ax: { has: "/rejected · approval_rejected/" }
      - label: 拒绝后磁盘内容逐字节不变
        file: { path: harness-note.md, unchangedSince: before }
      - label: 拒绝后 mtime 也未推进（「不落盘」双判据）
        file: { path: harness-note.md, mtimeUnchangedSince: before }
      - label: 编辑器里仍是旧文本
        editor: { has: "HNL-BETA 第二行，等待 patch。" }
      - label: JSONL 记下拒绝结果（approval sidecar：decision=rejected + 原因）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"decision":"rejected".*"reason":"holdoff".*"tool":"vault_patch".*$/' }
      - label: 拒绝后卡片收敛为终态记录（工具名 + 已拒绝 + 相对时间戳，M384）
        ax: { has: "vault_patch · 已拒绝" }
      - label: 拒绝原因在终态记录里直接可见（无需展开详情，M384）
        ax: { has: "原因：holdoff" }
      - label: 待决语义文案退场（「采纳后才落盘」不再出现，M384）
        ax: { not: "采纳后才落盘" }
      - label: diff 默认折叠（决策后不再常驻显示；「-HNL-」前缀行只在 diff 里出现）
        ax: { not: "-HNL-BETA 第二行，等待 patch。" }
      - shot: 02-拒绝后

  - name: 抢前台（disclosure 三角的 AXPress 以窗口在前台为可靠前提——同 REVIEW.md 第 11 条现场）
    do: focusWindow
    retries: 4

  - name: 展开决策详情回看 diff（点折叠详情的原生 disclosure 三角；文字节点本身不收起/展开）
    do: click
    target: { role: AXDisclosureTriangle, name: "查看详情" }

  - name: 展开后 diff 重新可见
    do: waitFor
    waitFor:
      has: ["-HNL-BETA 第二行，等待 patch。"]
    expect:
      - label: 展开后 diff 内容可见（正观测兜底：折叠时读不到、展开才读得到，证明折叠语义真实）
        ax: { has: "-HNL-BETA 第二行，等待 patch。" }
      - shot: 03-详情展开
---

spec 判据（harness「权限机制 · 采纳与拒绝」的拒绝侧）：拒绝则磁盘逐字节不变，模型收到
对应结果。fixture 与场景 72 共用同一份（harness-mock-patch.json）——同一个 patch 提案，
72 采纳、73 拒绝，两侧判据互斥。

M384 终态呈现（spec「批准闸呈现与决策后收敛」的拒绝侧）：拒绝附原因时，终态记录直接
显示原因文本（无需展开详情）；待决标题与决策按钮退场（不留置灰钮），diff 默认折叠、经
「查看详情」展开后可回看。chromium 结构断言同面：tests/visual/scenes/
m384-harness-approval-decided.spec.ts。
