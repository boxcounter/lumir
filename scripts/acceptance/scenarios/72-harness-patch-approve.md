---
id: "72-harness-patch-approve"
item: 72
title: Harness ③ patch 批准闸：采纳落盘、未触及部分逐字节不变、打开中会话同步（change add-harness-probe，mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-patch.json"
steps:
  - name: 记下 patch 前的磁盘基线（sha256 + mtime）
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

  - name: 抢前台（后台注入整批丢键/错键会显著加剧——REVIEW.md 第 11 条；72/73 的提问串
      与拒绝原因都走逐键注入）
    do: focusWindow
    retries: 4

  - name: 输入提问并 Enter 发送
    do: keys
    keys: ["p", "a", "t", "c", "h", "i", "t"]
  - name: 发送
    do: key
    key: enter

  - name: 等批准闸出现（写类工具默认 ask，循环挂起）
    do: waitFor
    waitFor:
      has: ["要修改这个文件吗？"]
    expect:
      - label: 批准闸在场——问句（D339，M406 起不带工具名：卡挂在工具行下方，行徽章已承担身份）
        ax: { has: "要修改这个文件吗？" }
      - label: 闸语义副句在场（D413，采纳前不落盘）
        ax: { has: "批准后才会落盘" }
      - label: 待决工具行尾注「等待批准」（D416，M406 单行生命周期的待决态）
        ax: { has: "等待批准" }
      - label: diff 预览有删除行
        ax: { has: "-HNL-BETA 第二行，等待 patch。" }
      - label: diff 预览有新增行
        ax: { has: "+HNL-BETA 第二行，patch 已落盘。" }
      - label: 闸悬停期间磁盘逐字节不变（未采纳不落盘）
        file: { path: harness-note.md, unchangedSince: before }
      - shot: 01-批准闸

  - name: 点击采纳
    do: click
    target: { role: AXButton, name: "^采纳$" }

  - name: 等循环收尾（patch 落盘 + 最终回答）
    do: waitFor
    waitFor:
      has: ["第二行处理完了。"]
    expect:
      - label: 决策后同一行就地收敛为终态（M406：名徽章 + diff 头文件名 + 结果词已采纳——
          不再另存工具行；done 被抑制槽吞掉，不产第二份留痕）
        ax: { has: '/vault_patch\s*harness-note\.md[\s\S]*已采纳/' }

  - name: 等打开中会话经 watch → 外部变更分流同步（留一拍再读）
    do: sleep
    ms: 1500
  - name: 界面落定
    do: settle
    expect:
      - label: 打开中的编辑器会话已同步到新内容
        editor: { has: "HNL-BETA 第二行，patch 已落盘。" }
      - label: 编辑器里旧文本已不在
        editor: { not: "等待 patch" }
      - label: 落盘内容 = 只换命中段、未触及部分逐字节不变（三行连续块整体断言）
        file: { path: harness-note.md, has: "HNL-ALPHA 第一行。\nHNL-BETA 第二行，patch 已落盘。\nHNL-GAMMA 第三行，不动。" }
      - label: 磁盘确实变了（与基线对比）
        file: { path: harness-note.md, changedSince: before }
      - label: JSONL 记下这次工具调用（wire 口径：llm_response 的 tool_calls）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"kind":"llm_response".*"id":"call_p1","name":"vault_patch".*$/' }
      - label: JSONL 记下采纳决定（approval sidecar）
        file: { path: "env:harness/sessions/*.jsonl", has: '/^.*"decision":"approved".*"tool":"vault_patch".*$/' }
      - label: 终态结果词在场（已采纳，D405）
        ax: { has: "已采纳" }
      - label: 待决语义整体退场（卡片被移除：问句与副句都不再出现，M406）
        ax: { not: "要修改这个文件吗？" }
      - label: 闸语义副句同退（「批准后才会落盘」不再出现）
        ax: { not: "批准后才会落盘" }
      - label: 决策按钮退场——采纳钮不留置灰（置灰会被误读为还在等待，M384）
        ax: { not: "/AXButton \\(采纳\\)/" }
      - label: 决策按钮退场——拒绝钮不留置灰
        ax: { not: "/AXButton \\(拒绝\\)/" }
      - label: diff 默认折叠（决策后不再常驻显示；「-HNL-」前缀行只在 diff 里出现）
        ax: { not: "-HNL-BETA 第二行，等待 patch。" }
      - shot: 02-采纳后

  - name: 抢前台（终态行的 AXPress 在窗口后台时可能不生效——同 REVIEW.md 第 11 条现场）
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

spec 判据（harness「权限机制 · 采纳与拒绝」的采纳侧 + fs-io「局部 patch 写入」）：
采纳前磁盘逐字节不变；采纳后 patch 按口径落盘——old_string 唯一命中替换、未触及部分
不变（用三行连续块断言：若未触及部分被动过，连续块必然断开）；被 patch 文件有打开中的
编辑器会话，经既有 watch → 会话刷新通路同步（本场景的编辑器从开头就开着
harness-note.md，且全程未手动编辑 = clean 会话，外部变更自动重载）。

M406 终态呈现（收敛单行生命周期，原型 variant B；spec「批准闸呈现与决策后收敛」）：
批准卡挂在该调用工具行下方的待决壳里（行尾注「等待批准」）；采纳后卡片整体退场、**同一行**
就地翻终态（✓ + 工具名徽章 + diff 头文件名 + 已采纳 · 相对时间戳），同一调用的 done 事件
被抑制槽吞掉不再另建行；diff 收进默认折叠的详情体、点终态行（「查看详情」入口随行）展开
可回看。chromium 结构断言同面：tests/visual/scenes/m384-harness-approval-decided.spec.ts。
