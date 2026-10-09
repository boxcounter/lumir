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
      has: ["要修改这个文件吗？"]
    expect:
      - label: 批准闸在场（本场景拒绝闸的正观测；M406 起问句不带工具名，行徽章承担身份）
        ax: { has: "要修改这个文件吗？" }
      - shot: 01-批准闸

  - name: 点拒绝原因输入框（M406 起多行 textarea → AXTextArea；aria-label = D338 全文，
      按名与 composer 分流；clickInNode 真实点进节点移焦点——裸 click 的 AXPress 对
      textarea 不移焦点，键会落进仍持有焦点的 composer，复跑实证）
    do: clickInNode
    target: { role: AXTextArea, name: "拒绝原因" }

  - name: 输入拒绝原因第一行（合成串；走可回读通道，丢键会按套件口径重试）
    do: keys
    keys: ["h", "o", "l", "d"]

  - name: Enter 换行（M406 多行化：裸 Enter = 换行不提交——若提交，决策会提前触发、
      下一步输入落空，后续断言必红）
    do: key
    key: enter

  - name: 输入拒绝原因第二行
    do: keys
    keys: ["o", "f", "f"]

  - name: ⌘Enter 提交拒绝（M406：⌘/Ctrl+Enter 与拒绝钮同一路径；裸 Enter 已证明是换行）
    do: key
    key: cmd+enter

  - name: 等循环收尾（拒绝回送模型 → 最终回答）
    do: waitFor
    waitFor:
      has: ["第二行处理完了。"]
    expect:
      - label: 终态行结果词是已拒绝（D406；同一行就地收敛，done 被抑制槽吞掉不再另建行）
        ax: { has: "已拒绝" }
      - label: 多行拒绝原因在终态行下方的原因行直接可见（D408；无需展开详情）
        ax: { has: '/原因：hold\s*off/' }
      - label: 拒绝后磁盘内容逐字节不变
        file: { path: harness-note.md, unchangedSince: before }
      - label: 拒绝后 mtime 也未推进（「不落盘」双判据）
        file: { path: harness-note.md, mtimeUnchangedSince: before }
      - label: 编辑器里仍是旧文本
        editor: { has: "HNL-BETA 第二行，等待 patch。" }
      - label: JSONL 记下拒绝结果（approval sidecar：decision=rejected + 多行原因原文——
          \n 在 JSON 里是转义的 \n 两字符）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"decision":"rejected".*"reason":"hold\\noff".*"tool":"vault_patch".*$/' }
      - label: 待决语义整体退场（卡片被移除：问句不再出现，M406）
        ax: { not: "要修改这个文件吗？" }
      - label: 闸语义副句同退（「批准后才会落盘」不再出现）
        ax: { not: "批准后才会落盘" }
      - label: diff 默认折叠（决策后不再常驻显示；「-HNL-」前缀行只在 diff 里出现）
        ax: { not: "-HNL-BETA 第二行，等待 patch。" }
      - shot: 02-拒绝后

  - name: 抢前台（终态行的 AXPress 以窗口在前台为可靠前提——同 REVIEW.md 第 11 条现场）
    do: focusWindow
    retries: 4

  - name: 展开决策详情回看 diff（M406：终态行整行即展开钮 role=button，无 disclosure 三角；
      行名含全部行文本，按「查看详情」子串命中）
    do: click
    target: { role: AXButton, name: "查看详情" }

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

M406 终态呈现（收敛单行生命周期，原型 variant B）的拒绝侧：原因框是多行 textarea（裸
Enter 换行、⌘/Ctrl+Enter 提交——本场景两条都验：Enter 后还能继续输入 = 未提前提交，
⌘Enter 触发拒绝）；拒绝后卡片整体退场、同一行就地翻终态（✕ + 已拒绝 · 相对时间戳），
多行原因在终态行下方的原因行直接可见（无需展开详情），diff 收进默认折叠的详情体、点
终态行（「查看详情」入口随行）展开回看。chromium 结构断言同面：tests/visual/scenes/
m384-harness-approval-decided.spec.ts。
