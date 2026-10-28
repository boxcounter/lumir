---
id: "252-harness-activity-presence"
item: 704
tier: full
title: harness 面板的活动在场：收起期间的在途 / 未读提示，打开面板即清算，停止不点亮
open: harness-note.md
marker: "HNL-ALPHA"
# change add-harness-activity-presence 的真机判据。三条判据本体只能在真机观测：
#   ① 面板**收起**（⌘⇧A）后标题栏 toggle 钮仍是活动的承载体（面板 DOM 已摘、事件订阅仍在）；
#   ② 未读只在面板不在屏幕上时产生，按终态种类分档（成功 = 有新的回复 / 失败 = 有失败结果），
#      用户主动停止（aborted）不产生未读；
#   ③ 重新打开面板即清算（相位若仍在跑则呈在途）。
#
# mock 脚本 `$fixtures/harness-mock-activity.json` 按轮次消费：① 带片间隔的正常流、② 错误终态、
# ③ 带片间隔的流（主动停止）。片间隔 6000ms = 「流式进行中」的可观测窗口（与不可中断的
# `delay_ms` 分工见 llm.rs 模块头）。
#
# **已知首跑风险（AX 面）**：三态的可读承载是 toggle 钮 `aria-describedby` 指向的视觉隐藏状态
# 文本（spec「视觉与主题」：不单靠颜色）。若本机 AX dump 不暴露 clip 隐藏的文本节点，下面几条
# `ax: { has: "处理中" }` 会假红——届时按套件 README 的 AX 判据改判为 toggle 钮的描述属性，或降为
# shot + 送钮两态判据。首跑按 FAIL 项决定改场景还是改实现，不得直接标 PASS。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-activity.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现
        ax: { has: "分隔条" }
      - label: 空闲态：发送钮在场（正观测）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 空闲态没有活动状态文本（三态的空闲档不上屏）
        ax: { not: "处理中" }
      - shot: 01-空闲态

  # ── 轮次一：正常流 → 收起期间结束 → 未读「回复」档 ─────────────────────
  - name: 第一轮提问（可打印序列，注入回读校验由 typeInNode 内部完成）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|act" }
    text: "act"
    expect:
      - label: 提问落在 composer 里（下一步 Enter 才有东西可发）
        ax: { has: "act" }
  - name: 发送
    do: key
    key: enter

  - name: 在途：停止钮与「处理中」同时成立
    do: waitFor
    waitFor:
      has: ["/AXButton \\(停止\\)/"]
    timeoutMs: 30000
    expect:
      - label: 发送钮切停止态（面板内的在途承载体）
        ax: { has: "/AXButton \\(停止\\)/" }
      - label: 标题栏状态文本为「处理中」（D870；收起后它是唯一承载体）
        ax: { has: "处理中" }
      - shot: 02-在途

  - name: 收起面板——活动提示的整个意义所在
    do: keys
    keys: ["cmd+shift+a"]

  - name: 收起态：面板不在场、toggle 钮回到场上、状态仍是在途
    do: settle
    expect:
      - label: 面板已收起（分隔条不在 AX 里）
        ax: { not: "分隔条" }
      - label: toggle 钮重新在场上（收起态的承载体）
        node: { role: AXButton, name: "对话面板", present: true }
      - label: 收起不复活空闲——状态文本仍是「处理中」
        ax: { has: "处理中" }
      - shot: 03-收起仍在途

  - name: 等这一轮在收起期间正常结束（片间隔 6s × 3 片）
    do: waitFor
    waitFor:
      has: ["有新的回复"]
      not: ["处理中"]
    timeoutMs: 60000
    expect:
      - label: 指示转「有新的回复」（D871）
        ax: { has: "有新的回复" }
      - label: 在途档已退场
        ax: { not: "处理中" }
      - label: 面板没有被这一轮自动展开（不抢焦点、不替用户开面板）
        ax: { not: "分隔条" }
      - shot: 04-未读回复

  - name: 重新打开面板：未读立即清算，回答完整在场
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 未读标记已清算（打开即已读）
        ax: { not: "有新的回复" }
      - label: 回答正文在 transcript 里
        ax: { has: "ACT-A 第一片。" }
      - label: 末片也上屏（收起期间产生的增量没有丢）
        ax: { has: "ACT-C 第三片。" }
      - shot: 05-打开即已读

  # ── 轮次二：错误终态在收起期间到达 → 未读「失败」档 ─────────────────────
  - name: 第二轮提问（这一轮的终态是错误）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|act" }
    text: "fail"
  - name: 发送
    do: key
    key: enter
  - name: 立刻收起（错误终态将在收起期间到达）
    do: keys
    keys: ["cmd+shift+a"]

  - name: 等失败档未读
    do: waitFor
    waitFor:
      has: ["有失败结果"]
    timeoutMs: 30000
    expect:
      - label: 指示转「有失败结果」（D872）
        ax: { has: "有失败结果" }
      - label: 不与回复档混（本档没有回复标记）
        ax: { not: "有新的回复" }
      # 失败档与回复档的形状差异（实心点 + 外环 vs 实心点）由 m756 结构场景判；本层留 shot 供人抽审。
      - shot: 06-未读失败

  - name: 打开面板清算，并确认错误行如实上屏
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 打开即清算
        ax: { not: "有失败结果" }
      - label: 错误终态如实上错误行（D348，正文是后端 message）
        ax: { has: "ACT-FAIL" }
      - shot: 07-失败档已清算

  # ── 轮次三：主动停止 → 不产生未读（D2）─────────────────────────────────
  - name: 第三轮提问（这一轮会被主动停止）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|act" }
    text: "stop"
  - name: 发送
    do: key
    key: enter
  - name: 等首个分片到达（流式进行中才有可停的一轮）
    do: waitFor
    waitFor:
      has: ["ACT-STOP-A 第一片。"]
    timeoutMs: 30000
  - name: 停止（running 相位下同一颗钮是停止态）
    do: click
    target: { role: AXButton, name: "^停止$" }
  - name: 收起面板（aborted 终态将在收起期间到达）
    do: keys
    keys: ["cmd+shift+a"]

  - name: 等中断收口
    do: waitFor
    waitFor:
      has: ["已停止"]
      not: ["处理中"]
    timeoutMs: 30000
    expect:
      - label: 指示回到空闲——停止不点亮任何未读档（用户自己按的）
        ax: { not: "有新的回复" }
      - label: 失败档同样不点亮
        ax: { not: "有失败结果" }
      - label: 在途档已退场
        ax: { not: "处理中" }
      - shot: 08-停止不点亮

  - name: 打开面板确认中断标注与已产出正文
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 中断标注「已停止」挂在被打断的消息上（D383）
        ax: { has: "已停止" }
      - label: 已产出正文保留（中断是「不再继续」，不是回滚）
        ax: { has: "ACT-STOP-A 第一片。" }
      - shot: 09-停止收口

---

# 252-harness-activity-presence —— 收起期间的活动在场

## 覆盖边界（如实登记，不冒充已验）

- 状态点的形状 / 尺寸 / 锚点（6×6、空心环 / 实心点 / 实心点 + 外环）由 m756 结构场景判；
  本场景只在 light 主题跑一遍，三主题的可辨性由 m756 的样式条款 + 人工抽审承担。
- 手感 / 审美（提示的显眼程度）不下沉到套件，归 Alex。
