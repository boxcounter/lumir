---
id: "724-harness-session-order"
item: 724
tier: full
title: 会话清单按最后活动排序（每文件一行）：恢复不置顶、sidecar 不计入、compact 不沿链、缺时间回落、打开期间不重排
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
# 预置现场（change rank-harness-sessions-by-last-activity-nov23）：
#   A：创建 100000、最后活动 400000（1月5日）——创建早、活动晚
#   B：创建 200000、最后活动 230000（1月3日）——创建晚、活动早
#   C：创建 50000、最后活动 600000（1月8日）——活动最晚
#   compact：创建 300000（1月4日）、opened_from=compact、无 restored_from、无轮次；
#            带 session_title 与 A 同名（证明「同名不合并」且 compact 不继承 A 的 400000）
# 时间戳写死（1月2日～1月8日，远离「今天」）⇒ 行时间格显示短日期，判据可写死字符串。
# 读数由 Rust 单测逐值判（list_sessions_*），本场景判 UI 侧的行数、相对位置与展示读数。
seed:
  registry:
    - { id: acc-order, path: $vault, lastOpenedAt: 1757000002000 }
  harnessSessions:
    - vaultId: acc-order
      name: s100000-aaaaaa.jsonl
      raw: |
        {"ts":100000,"payload":{"kind":"session_open","session_id":"s100000-aaaaaa","vault_root":"$vault","opened_from":"new","provider":"mock","model":"mock-model","thinking":"high","system":"S","assembly":[]}}
        {"ts":390000,"payload":{"kind":"llm_request","request":{"system":"S","messages":[{"role":"user","content":[{"type":"input_text","text":"活动排序甲"}]}]}}}
        {"ts":400000,"payload":{"kind":"llm_response","text":"甲回答"}}
        {"ts":101000,"payload":{"kind":"session_title","title":"活动排序甲","decision":"initial","reason":"first-turn"}}
    - vaultId: acc-order
      name: s200000-bbbbbb.jsonl
      raw: |
        {"ts":200000,"payload":{"kind":"session_open","session_id":"s200000-bbbbbb","vault_root":"$vault","opened_from":"new","provider":"mock","model":"mock-model","thinking":"high","system":"S","assembly":[]}}
        {"ts":220000,"payload":{"kind":"llm_request","request":{"system":"S","messages":[{"role":"user","content":[{"type":"input_text","text":"活动排序乙"}]}]}}}
        {"ts":230000,"payload":{"kind":"llm_response","text":"乙回答"}}
    - vaultId: acc-order
      name: s50000-cccccc.jsonl
      raw: |
        {"ts":50000,"payload":{"kind":"session_open","session_id":"s50000-cccccc","vault_root":"$vault","opened_from":"new","provider":"mock","model":"mock-model","thinking":"high","system":"S","assembly":[]}}
        {"ts":590000,"payload":{"kind":"llm_request","request":{"system":"S","messages":[{"role":"user","content":[{"type":"input_text","text":"活动排序丙"}]}]}}}
        {"ts":600000,"payload":{"kind":"llm_response","text":"丙回答"}}
    - vaultId: acc-order
      name: s300000-compact.jsonl
      raw: |
        {"ts":300000,"payload":{"kind":"session_open","session_id":"s300000-compact","vault_root":"$vault","opened_from":"compact","provider":"mock","model":"mock-model","thinking":"high","system":"S","assembly":[],"compact_summary":"压缩摘要"}}
        {"ts":300001,"payload":{"kind":"session_title","title":"活动排序甲","decision":"inherit","reason":"inherit"}}
steps:
  - name: 记 4 份预置留存的基线（步骤末尾判列举只读）
    do: record
    file: "env:harness/sessions/acc-order/s100000-aaaaaa.jsonl"
    as: seedA
  - name: 记 B 的基线
    do: record
    file: "env:harness/sessions/acc-order/s200000-bbbbbb.jsonl"
    as: seedB
  - name: 记 C 的基线
    do: record
    file: "env:harness/sessions/acc-order/s50000-cccccc.jsonl"
    as: seedC
  - name: 记 compact 的基线
    do: record
    file: "env:harness/sessions/acc-order/s300000-compact.jsonl"
    as: seedCompact

  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现
        ax: { has: "分隔条" }

  - name: 打开会话浮层（历史会话列表现拉现建）
    do: click
    target: { role: AXPopUpButton, name: "新会话" }

  - name: 等 C 行出现（活动最晚的会话）
    do: waitFor
    waitFor:
      has: ["活动排序丙"]
    timeoutMs: 15000
    expect:
      - label: 四份留存各一行（每文件一行、不折叠）
        ax: { count: { pattern: "/AXMenuItem \\(/", exact: 4 } }
      - label: compact 与 A 同名不合并（两行同名，行时间格承担区分）
        ax: { count: { pattern: "/AXMenuItem \\(活动排序甲/", exact: 2 } }
      - shot: 01-初始顺序

  - name: 行 0 的 × 进确认态——行 0 应是 C（活动最晚 600000）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 0 }
    expect:
      - label: 行 0 的名字消失 = 行 0 是 C（排序按最后活动；按创建时刻 C 会排最后）
        ax: { not: "/AXMenuItem \\(活动排序丙/" }
      - label: 行内确认态出现
        ax: { has: "删除这段会话的本地留存？" }

  - name: 取消行 0 的确认态（还原 × 钮——确认态会移除该行的 ×，不还原则后续 nth 整体前移）
    do: click
    target: { role: AXButton, name: "^取消$" }
    expect:
      - label: 行 0 的名字回来（取消 = 零副作用）
        ax: { has: "/AXMenuItem \\(活动排序丙/" }

  - name: 行 3 的 × 进确认态——行 3 应是 B（活动最早 230000）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 3 }
    expect:
      - label: 行 3 的名字消失 = 行 3 是 B（创建晚但活动早；按创建时刻 B 会排第二）
        ax: { not: "/AXMenuItem \\(活动排序乙/" }

  - name: 取消行 3 的确认态
    do: click
    target: { role: AXButton, name: "^取消$" }

  - name: 行 1 的 × 进确认态——行 1 应是 A（400000），行 2 是 compact（300000）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 1 }
    expect:
      - label: 剩下的同名行读 compact 自己的创建日期（1月4日）——A 的 1月5日已随行 1 隐藏（compact 不继承 A 的活动时间）
        ax: { has: "/AXMenuItem \\(活动排序甲 1月4日\\)/" }
      - label: A 的活动读数（1月5日）不在场——证明行 1 是 A、不是 compact
        ax: { not: "/AXMenuItem \\(活动排序甲 1月5日\\)/" }

  - name: 取消行 1 的确认态
    do: click
    target: { role: AXButton, name: "^取消$" }

  - name: 收起浮层（行内确认态是临时 DOM，收起即弃）
    do: click
    target: { role: AXPopUpButton, name: "新会话" }

  - name: 列举只读：四份预置留存字节与 mtime 均未变（A）
    do: settle
    expect:
      - label: A 内容逐字节未变
        file: { path: "env:harness/sessions/acc-order/s100000-aaaaaa.jsonl", unchangedSince: seedA }
      - label: A mtime 未推进
        file: { path: "env:harness/sessions/acc-order/s100000-aaaaaa.jsonl", mtimeUnchangedSince: seedA }
      - label: B 内容逐字节未变
        file: { path: "env:harness/sessions/acc-order/s200000-bbbbbb.jsonl", unchangedSince: seedB }
      - label: B mtime 未推进
        file: { path: "env:harness/sessions/acc-order/s200000-bbbbbb.jsonl", mtimeUnchangedSince: seedB }
      - label: C 内容逐字节未变
        file: { path: "env:harness/sessions/acc-order/s50000-cccccc.jsonl", unchangedSince: seedC }
      - label: C mtime 未推进
        file: { path: "env:harness/sessions/acc-order/s50000-cccccc.jsonl", mtimeUnchangedSince: seedC }
      - label: compact 内容逐字节未变
        file: { path: "env:harness/sessions/acc-order/s300000-compact.jsonl", unchangedSince: seedCompact }
      - label: compact mtime 未推进
        file: { path: "env:harness/sessions/acc-order/s300000-compact.jsonl", mtimeUnchangedSince: seedCompact }
      - label: 目录不新增文件
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 4 }

  # ── 恢复不置顶（第一次恢复 A）────────────────────────────────────────────────
  - name: 打开浮层并点 A 行恢复（两行同名，行 1 = A 在 DOM 序上先于 compact）
    do: click
    target: { role: AXPopUpButton, name: "新会话" }
  - name: 等清单出现
    do: waitFor
    waitFor:
      has: ["活动排序丙"]
    timeoutMs: 15000
  - name: 点 A 行（同名两行中的第一行）恢复续聊
    do: clickInNode
    target: { role: AXMenuItem, name: "活动排序甲", nth: 0 }

  - name: 等恢复完成（标题栏会话名落回 A 的回落名）
    do: waitFor
    waitFor:
      has: ["/AXPopUpButton \\(活动排序甲/"]
    timeoutMs: 15000

  - name: 打开浮层，判恢复行的落位
    do: click
    target: { role: AXPopUpButton, name: "活动排序甲" }
  - name: 等清单稳定
    do: settle
    expect:
      - label: 五份文件五行（源 A + 恢复行 + compact + C + B）
        ax: { count: { pattern: "/AXMenuItem \\(/", exact: 5 } }
      - label: 恢复行与源行都读 A 的最后活动（1月5日各一行、共两行）——恢复行不因新文件创建而伪造新读数
        ax: { count: { pattern: "/AXMenuItem \\(活动排序甲 1月5日\\)/", exact: 2 } }
      - shot: 02-恢复一行不置顶

  - name: 行 0 的 × 进确认态——恢复后 C 仍最前（700000 的新文件没有越过 600000）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 0 }
    expect:
      - label: 行 0 仍是 C（恢复动作不置顶）
        ax: { not: "/AXMenuItem \\(活动排序丙/" }

  - name: 取消行 0 的确认态
    do: click
    target: { role: AXButton, name: "^取消$" }

  - name: 行 1 的 × 进确认态——行 1 应是第一次恢复的分支（读 400000）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 1 }
    expect:
      - label: 隐藏行 1 后仍有一行读 1月5日（源行）——证实行 1 也是 A 的活动读数
        ax: { count: { pattern: "/AXMenuItem \\(活动排序甲 1月5日\\)/", exact: 1 } }
  - name: 取消行 1 的确认态
    do: click
    target: { role: AXButton, name: "^取消$" }

  - name: 行 2 的 × 进确认态——行 2 应是源 A（读 400000）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 2 }
    expect:
      - label: 隐藏行 2 后仍有一行读 1月5日（恢复行）——证实行 2 也是 A 的活动读数
        ax: { count: { pattern: "/AXMenuItem \\(活动排序甲 1月5日\\)/", exact: 1 } }
  - name: 取消行 2 的确认态
    do: click
    target: { role: AXButton, name: "^取消$" }

  - name: 行 3 的 × 进确认态——行 3 应是 compact（读自己的 300000）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 3 }
    expect:
      - label: compact 的 1月4日随行 3 消失（不继承 A 的 1月5日、也不与 A 合并）
        ax: { not: "/AXMenuItem \\(活动排序甲 1月4日\\)/" }
  - name: 取消行 3 的确认态
    do: click
    target: { role: AXButton, name: "^取消$" }

  - name: 行 4 的 × 进确认态——行 4 应是 B（活动最早者排最后）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 4 }
    expect:
      - label: B 的名字随行 4 消失
        ax: { not: "/AXMenuItem \\(活动排序乙/" }
      - shot: 03-恢复行相邻

  - name: 收起浮层
    do: click
    target: { role: AXPopUpButton, name: "活动排序甲" }

  # ── 从源行再次恢复＝分支（第三次恢复的整体：源 + 两个分支）──────────────────
  - name: 打开浮层
    do: click
    target: { role: AXPopUpButton, name: "活动排序甲" }
  - name: 等清单出现
    do: waitFor
    waitFor:
      has: ["活动排序丙"]
    timeoutMs: 15000
  - name: 点源 A 行再次恢复（同名三行中第 2 行 = 源 A；行 1 是第一次恢复的分支）
    do: clickInNode
    target: { role: AXMenuItem, name: "活动排序甲", nth: 1 }

  - name: 等第二次恢复完成
    do: waitFor
    waitFor:
      has: ["/AXPopUpButton \\(活动排序甲/"]
    timeoutMs: 15000

  - name: 打开浮层，判分叉行数
    do: click
    target: { role: AXPopUpButton, name: "活动排序甲" }
  - name: 等清单稳定
    do: settle
    expect:
      - label: 六份文件六行（源 + 两个分叉 + compact + C + B）
        ax: { count: { pattern: "/AXMenuItem \\(/", exact: 6 } }
      - label: 三个 A 行都读 1月5日（源 + 两个分叉，各自继承链上活动）
        ax: { count: { pattern: "/AXMenuItem \\(活动排序甲 1月5日\\)/", exact: 3 } }
      - shot: 04-两次恢复三分叉

  # ── 删除一个分叉：只影响该行 ────────────────────────────────────────────────
  - name: 收起浮层后点「＋新会话」——让所有 A 行都成为历史行（活跃会话拒删）
    do: click
    target: { role: AXPopUpButton, name: "活动排序甲" }
  - name: 点「＋新会话」
    do: click
    target: { role: AXButton, name: "^新会话$" }

  - name: 打开浮层
    do: click
    target: { role: AXPopUpButton, name: "新会话" }
  - name: 等清单出现
    do: waitFor
    waitFor:
      has: ["活动排序丙"]
    timeoutMs: 15000
  - name: 点行 1 的 ×（最新分叉）进确认态
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 1 }
    expect:
      - label: 行内确认态出现
        ax: { has: "删除这段会话的本地留存？" }
  - name: 确认删除该分叉
    do: click
    target: { role: AXButton, name: "^删除$" }

  - name: 等删除生效（只该行消失）
    do: waitFor
    waitFor:
      not: ["删除这段会话的本地留存？"]
    timeoutMs: 15000
    expect:
      - label: 只剩五个 A 活动读数行中的两行（源 + 另一分叉仍读 1月5日）
        ax: { count: { pattern: "/AXMenuItem \\(活动排序甲 1月5日\\)/", exact: 2 } }
      - label: C 仍在（删除不联动其它行）
        ax: { has: "/AXMenuItem \\(活动排序丙/" }
      - label: B 仍在
        ax: { has: "/AXMenuItem \\(活动排序乙/" }
      - label: 盘上剩五份留存（初始 4 + 两个分叉 - 删掉的 1）
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 5 }
      - shot: 05-删除单个分叉

  # ── sidecar 不计入活动时间：只给 A 追加标题 / 通知记录 → 顺序不变 ─────────────
  - name: 收起浮层
    do: click
    target: { role: AXPopUpButton, name: "新会话" }
  - name: 给 A 的留存追加 session_title 与 notice_delivered（ts=900000/900001，远晚于 C 的 600000）
    do: envWrite
    file: "harness/sessions/acc-order/s100000-aaaaaa.jsonl"
    content: |
      {"ts":100000,"payload":{"kind":"session_open","session_id":"s100000-aaaaaa","vault_root":"$vault","opened_from":"new","provider":"mock","model":"mock-model","thinking":"high","system":"S","assembly":[]}}
      {"ts":390000,"payload":{"kind":"llm_request","request":{"system":"S","messages":[{"role":"user","content":[{"type":"input_text","text":"活动排序甲"}]}]}}}
      {"ts":400000,"payload":{"kind":"llm_response","text":"甲回答"}}
      {"ts":900000,"payload":{"kind":"session_title","title":"活动排序甲","decision":"rename","reason":"drift"}}
      {"ts":900001,"payload":{"kind":"notice_delivered","notice_id":"n1"}}
  - name: 打开浮层，判 sidecar 不改变顺序
    do: click
    target: { role: AXPopUpButton, name: "新会话" }
  - name: 等清单出现
    do: waitFor
    waitFor:
      has: ["活动排序丙"]
    timeoutMs: 15000
  - name: 行 0 的 × 进确认态——若 sidecar 计入活动，A 会凭 900001 抢到行 0
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 0 }
    expect:
      - label: 行 0 仍是 C（sidecar 不参与排序）
        ax: { not: "/AXMenuItem \\(活动排序丙/" }
      - label: 改为标题后 A 的两行仍读 1月5日（可见行里恰两行）
        ax: { count: { pattern: "/AXMenuItem \\(活动排序甲 1月5日\\)/", exact: 2 } }
      - shot: 06-sidecar不排序

  # ── 在 B 里真实发送一轮：B 的最后活动由后端写成实际当前时间 → 到最前 ────────
  - name: 收起浮层
    do: click
    target: { role: AXPopUpButton, name: "新会话" }
  - name: 打开浮层恢复 B（唯一叫乙的行）
    do: click
    target: { role: AXPopUpButton, name: "新会话" }
  - name: 等清单出现
    do: waitFor
    waitFor:
      has: ["活动排序乙"]
    timeoutMs: 15000
  - name: 点 B 行恢复
    do: clickInNode
    target: { name: "活动排序乙" }
  - name: 等恢复完成（标题栏会话名 = 乙）
    do: waitFor
    waitFor:
      has: ["/AXPopUpButton \\(活动排序乙/"]
    timeoutMs: 15000
  - name: 点 composer 建立输入焦点
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 输入 B 的续聊消息
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|活动排序乙续聊" }
    text: "活动排序乙续聊"
  - name: 发送
    do: key
    key: enter
  - name: 等本轮回答到达（B 的新活动由后端写实际当前时间，不写死）
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    timeoutMs: 30000
    expect:
      - label: 新一轮渲染（回合真实发生）
        ax: { has: "验收回答：上下文已收到。" }
      - label: 续聊落盘（mtime 最新的文件里带恢复谱系与本轮新消息）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "活动排序乙续聊" }
      - label: 恢复出的 B 文件首行标 opened_from=restore
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"opened_from":"restore"' }

  - name: 等回合收口
    do: waitFor
    waitFor:
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 15000

  - name: 打开浮层，判 B 到最前、C 第二
    do: click
    target: { role: AXPopUpButton, name: "活动排序乙" }
  - name: 等清单稳定
    do: settle
    expect:
      - label: 六行（B 的恢复行 + 原有五行）
        ax: { count: { pattern: "/AXMenuItem \\(/", exact: 6 } }
      - label: 只有一行读 1月3日（B 源行）——B 的恢复行不带历史日期
        ax: { count: { pattern: "/AXMenuItem \\(活动排序乙 1月3日\\)/", exact: 1 } }
      - shot: 07-B到最前

  - name: 等 B 的恢复行带上相对时间（单次读取可能撞上退化的 AX 快照，用轮询等它可见）
    do: waitFor
    waitFor:
      has: ["/AXMenuItem \\(活动排序乙 (\\d+(秒|分钟|小时)前|现在)\\)/"]
    timeoutMs: 15000
  - name: 行 0 的 × 进确认态——行 0 应是 B 的恢复行（活动 = 今天）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 0 }
    expect:
      - label: 隐藏行 0 后相对时间行消失——证实行 0 是 B 的恢复行（transcript 含「活动排序乙」子串，不能按名字计数）
        ax: { not: "/AXMenuItem \\(活动排序乙 (\\d+(秒|分钟|小时)前|现在)\\)/" }
      - label: 剩下的乙行（B 源行）读它自己的 1月3日
        ax: { has: "/AXMenuItem \\(活动排序乙 1月3日\\)/" }
  - name: 取消行 0 的确认态
    do: click
    target: { role: AXButton, name: "^取消$" }

  - name: 行 1 的 × 进确认态——C 落到第二
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 1 }
    expect:
      - label: 行 1 是 C（活动第二）
        ax: { not: "/AXMenuItem \\(活动排序丙/" }
      - label: A 的两行仍读 1月5日（都排在 B 之后）
        ax: { count: { pattern: "/AXMenuItem \\(活动排序甲 1月5日\\)/", exact: 2 } }
      - label: compact 仍读自己的 1月4日（不与 A 合并、不继承）
        ax: { has: "/AXMenuItem \\(活动排序甲 1月4日\\)/" }
      - shot: 08-B后-A仍400
  - name: 取消行 1 的确认态
    do: click
    target: { role: AXButton, name: "^取消$" }

  # ── 缺时间旧文件：排最后、不显示时间格 ──────────────────────────────────────
  - name: 收起浮层
    do: click
    target: { role: AXPopUpButton, name: "活动排序乙" }
  - name: 预置一份所有信封都缺 ts 的旧留存
    do: envWrite
    file: "harness/sessions/acc-order/s190000-ffffff.jsonl"
    content: |
      {"payload":{"kind":"session_open","session_id":"s190000-ffffff","vault_root":"$vault","opened_from":"new","provider":"mock","model":"mock-model","thinking":"high","system":"S","assembly":[]}}
      {"payload":{"kind":"llm_request","request":{"system":"S","messages":[{"role":"user","content":[{"type":"input_text","text":"无时间旧会话"}]}]}}}
      {"payload":{"kind":"llm_response","text":"旧回答"}}
  - name: 打开浮层
    do: click
    target: { role: AXPopUpButton, name: "活动排序乙" }
  - name: 等缺时间行出现
    do: waitFor
    waitFor:
      has: ["无时间旧会话"]
    timeoutMs: 15000
    expect:
      - label: 七行（六份有时间 + 一份缺时间）
        ax: { count: { pattern: "/AXMenuItem \\(/", exact: 7 } }
      - label: 缺时间行在场（名字可见 = 行存在）
        ax: { has: "/AXMenuItem \\(无时间旧会话\\)/" }
      - label: 缺时间行的时间格不渲染（见正文「已知边界」：AX 层只能判名字在场，格子缺席由 m662 结构断言判）
        node: { role: AXMenuItem, name: "无时间旧会话", present: true }
      - shot: 09-缺时间行
  - name: 行 6 的 × 进确认态——缺时间行应排最后（无值者最后）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 6 }
    expect:
      - label: 缺时间行的名字消失 = 它确实排在最后一行、不在中间
        ax: { not: "/AXMenuItem \\(无时间旧会话\\)/" }
      - shot: 10-缺时间排最后
  - name: 取消行 6 的确认态
    do: click
    target: { role: AXButton, name: "^取消$" }

  # ── 两个独立同名文件：各占一行、时间格不同 ─────────────────────────────────
  - name: 收起浮层
    do: click
    target: { role: AXPopUpButton, name: "活动排序乙" }
  - name: 预置两份无谱系关系的同名会话（1月1日 / 1月3日）
    do: envWrite
    file: "harness/sessions/acc-order/s170000-dddddd.jsonl"
    content: |
      {"ts":170000,"payload":{"kind":"session_open","session_id":"s170000-dddddd","vault_root":"$vault","opened_from":"new","provider":"mock","model":"mock-model","thinking":"high","system":"S","assembly":[]}}
      {"ts":170001,"payload":{"kind":"session_title","title":"同名独立会话","decision":"initial","reason":"first-turn"}}
  - name: 预置第二份同名会话
    do: envWrite
    file: "harness/sessions/acc-order/s45000-eeeeee.jsonl"
    content: |
      {"ts":45000,"payload":{"kind":"session_open","session_id":"s45000-eeeeee","vault_root":"$vault","opened_from":"new","provider":"mock","model":"mock-model","thinking":"high","system":"S","assembly":[]}}
      {"ts":45001,"payload":{"kind":"session_title","title":"同名独立会话","decision":"initial","reason":"first-turn"}}
  - name: 打开浮层
    do: click
    target: { role: AXPopUpButton, name: "活动排序乙" }
  - name: 等同名行出现
    do: waitFor
    waitFor:
      has: ["同名独立会话"]
    timeoutMs: 15000
    expect:
      - label: 九行（七 + 两份同名）
        ax: { count: { pattern: "/AXMenuItem \\(/", exact: 9 } }
      - label: 同名两行都出现、不合并
        ax: { count: { pattern: "/AXMenuItem \\(同名独立会话/", exact: 2 } }
      - label: 两行时间格不同——第一份读 1月3日
        ax: { has: "/AXMenuItem \\(同名独立会话 1月3日\\)/" }
      - label: 两行时间格不同——第二份读 1月1日
        ax: { has: "/AXMenuItem \\(同名独立会话 1月1日\\)/" }
      - shot: 11-同名两行
  - name: 行 6 的 × 进确认态——行 6 应是同名的第一份（读 1月3日）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 6 }
    expect:
      - label: 第一份的 1月3日随行 6 消失（B 源行也读 1月3日，故判据用「同名 + 日期」的行节点，不用全局 has）
        ax: { not: "/AXMenuItem \\(同名独立会话 1月3日\\)/" }
      - label: 另一份同名行仍读 1月1日
        ax: { has: "/AXMenuItem \\(同名独立会话 1月1日\\)/" }
  - name: 取消行 6 的确认态
    do: click
    target: { role: AXButton, name: "^取消$" }
  - name: 行 7 的 × 进确认态——行 7 应是同名的第二份（读 1月1日）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 7 }
    expect:
      - label: 第二份的 1月1日随行 7 消失
        ax: { not: "/AXMenuItem \\(同名独立会话 1月1日\\)/" }
      - label: 第一份的 1月3日仍在（另一份同名行不受影响）
        ax: { has: "/AXMenuItem \\(同名独立会话 1月3日\\)/" }
  - name: 取消行 7 的确认态
    do: click
    target: { role: AXButton, name: "^取消$" }

  # ── 打开期间后台完成一轮：本层不重排，重开才更新 ───────────────────────────
  - name: 浮层保持打开，外部把 A 的活动推进到 1000000000（模拟后台完成一轮）
    do: envWrite
    file: "harness/sessions/acc-order/s100000-aaaaaa.jsonl"
    content: |
      {"ts":100000,"payload":{"kind":"session_open","session_id":"s100000-aaaaaa","vault_root":"$vault","opened_from":"new","provider":"mock","model":"mock-model","thinking":"high","system":"S","assembly":[]}}
      {"ts":390000,"payload":{"kind":"llm_request","request":{"system":"S","messages":[{"role":"user","content":[{"type":"input_text","text":"活动排序甲"}]}]}}}
      {"ts":400000,"payload":{"kind":"llm_response","text":"甲回答"}}
      {"ts":900000,"payload":{"kind":"session_title","title":"活动排序甲","decision":"rename","reason":"drift"}}
      {"ts":1000000000,"payload":{"kind":"llm_request","request":{"system":"S","messages":[{"role":"user","content":[{"type":"input_text","text":"活动排序甲后台一轮"}]}]}}}
  - name: 已打开的行不重排（A 仍不在行 0）
    do: settle
    expect:
      - label: 行 0 仍是 B 的恢复行（A 没有越到最前）
        ax: { not: "/AXMenuItem \\(活动排序甲 9月9日\\)/" }
      - shot: 12-打开期间不重排
  - name: 行 0 的 × 进确认态——行 0 仍是 B 的恢复行（A 没有 live 重排到最前）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 0 }
    expect:
      - label: 隐藏行 0 后相对时间行消失——证实行 0 仍是 B 的恢复行（A 没有排到它前面）
        ax: { not: "/AXMenuItem \\(活动排序乙 (\\d+(秒|分钟|小时)前|现在)\\)/" }
  - name: 取消行 0 的确认态
    do: click
    target: { role: AXButton, name: "^取消$" }

  - name: 行 1 的 × 进确认态——行 1 仍是 C
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 1 }
    expect:
      - label: C 的名字随行 1 消失（打开期间没有重排）
        ax: { not: "/AXMenuItem \\(活动排序丙/" }
      - label: A 仍读旧活动 1月5日（本层不因后台写入而更新）
        ax: { count: { pattern: "/AXMenuItem \\(活动排序甲 1月5日\\)/", exact: 2 } }
  - name: 取消行 1 的确认态
    do: click
    target: { role: AXButton, name: "^取消$" }

  - name: 收起浮层后重开——新读数才生效
    do: click
    target: { role: AXPopUpButton, name: "活动排序乙" }
  - name: 重开浮层
    do: click
    target: { role: AXPopUpButton, name: "活动排序乙" }
  - name: 等清单出现
    do: waitFor
    waitFor:
      has: ["活动排序丙"]
    timeoutMs: 15000
    expect:
      - label: 重开后 A 上行到 C 之前、B 之后（1000000000 的日期 9月9日上屏）
        ax: { has: "/AXMenuItem \\(活动排序甲 9月9日\\)/" }
      - shot: 13-重开才更新
  - name: 两条 A 行都沿链读到推进后的 9月9日
    do: settle
    expect:
      - label: B 的恢复行仍最前（本轮真实发送的活动晚于 1000000000）
        ax: { has: "/AXMenuItem \\(活动排序乙 (\\d+(秒|分钟|小时)前|现在)\\)/" }
      - label: 重开后两条 A 行都读 9月9日（恢复行沿 restored_from 链继承源文件的新活动）
        ax: { count: { pattern: "/AXMenuItem \\(活动排序甲 9月9日\\)/", exact: 2 } }
      - label: 1月5日 计数为 0（两条 A 行都不再显示旧活动）
        ax: { count: { pattern: "/AXMenuItem \\(活动排序甲 1月5日\\)/", exact: 0 } }
  - name: 行 1 的 × 进确认态——行 1 应是其中一条 A 行（行 0 是 B 的恢复行）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 1 }
    expect:
      - label: 隐藏行 1 后另一条 A 行仍读 9月9日（同值时两条相邻、都沿同一链）
        ax: { count: { pattern: "/AXMenuItem \\(活动排序甲 9月9日\\)/", exact: 1 } }
      - label: 1月5日 仍为 0（隐藏动作不制造旧读数）
        ax: { count: { pattern: "/AXMenuItem \\(活动排序甲 1月5日\\)/", exact: 0 } }
---

# 724-harness-session-order —— 会话清单按最后活动排序（change rank-harness-sessions-by-last-activity-nov23 5.1）

## 本场景在验什么

会话清单的排序与行时间读数从「文件创建时刻」改为「最后活动时间」（该文件与
`session_open.restored_from` 祖先链上 `llm_request` / `llm_response` 信封 ts 的最大值），
每份 JSONL 独立一行。真机层判 UI 侧的后果：

1. **创建与活动相反**：C 创建最早但活动最晚 → 行 0；A 创建早、活动晚 → 在 B 之前；B 创建晚、
   活动早 → 行 3（A 与 compact 在中间）。
2. **恢复不置顶**：恢复 A 后 C 仍在最前；源行与恢复行都读 A 的最后活动（1月5日）、相邻，
   且都不越过活动更晚的 C。
3. **分支**：从源行再次恢复 → 三个 A 行都读 1月5日；删除其中一个分叉只该行消失。
4. **sidecar 不计入**：给 A 追加 `session_title` / `notice_delivered`（ts 远晚于 C）后顺序不变。
5. **真实发送**：在 B 的恢复行里真实发送一轮（后端写实际当前时间）→ B 到最前；C 第二；
   A 的两行仍读 1月5日、都排在 B 之后；compact 仍读 1月4日。
6. **缺时间**：所有信封缺 ts 的旧文件排在最后。
7. **同名不合并**：两份无谱系关系的同名会话各占一行、时间格不同。
8. **打开期间不重排**：浮层打开时后台写入 A 的新活动，本层不动；重开才更新。
9. **列举只读**：打开浮层前后预置留存的 sha256 与 mtime 不变、目录不新增文件。

## 断言口径

- **时间戳写死**（不是运行期生成）：A 的 100000/390000/400000、B 的 200000/220000/230000、
  C 的 50000/590000/600000、compact 的 300000 都是**1970 年 1 月的固定秒数**，落在
  **不同短日期**（1月3日 / 1月4日 / 1月5日 / 1月8日）——行时间格显示短日期，判据因此可写死
  字符串。真实发送产生的活动（B 的续聊）用**后端实际当前时间**，不写死任何历史时间。
- **行序判据用「隐藏行」**：删除钮的确认态会把该行的名字与时间格一起从行里换掉（DOM
  `row.replaceChildren(prompt, 删除, 取消)`），因此「点 × 后某名字 / 日期从 AX 消失」就是
  「该名字 / 日期所在行是第 N 行」的机器判据。**每次隐藏后立即点「取消」还原**：确认态会
  连同该行的 × 一起移除，删除钮的 `nth` 随之后移一位——连续隐藏多行再按固定下标点会错位
  （2026-11-24 真机现场：隐藏行 0 后点 `nth:3` 找不到节点，而实际顺序与行名都正确）。
  `ax.count` 的命名 / 日期计数只在**时间格**与「标题栏 + 行」同名的场合用（日期不会出现在
  标题栏；活跃会话名会额外贡献一次同名命中，故此时用 count 而不是 not）。
- **恢复行不置顶的可区分判据**：恢复行的创建时刻是运行期「现在」（远晚于 600000），若按创建
  时刻排序它会到行 0；本场景判「行 0 仍是 C」与「A 的两行都读 1月5日」。
- **compact 不沿链**：compact 与 A 同名（`session_title`），且创建 300000 < A 的活动 400000。
  若 compact 错沿链继承 A 的 400000，它会与 A 同值并按 id 倒序落到 A 上面（id `s300000` >
  `s100000`），行 1 就会变成 compact → 「隐藏行 1 后仍见 1月5日」必红。
- **不只读脚本断言、也判副作用**：`record` 记 sha256 与 mtime 基线，`unchangedSince` +
  `mtimeUnchangedSince` 成对断言；`glob exact` 判目录条目数。
- **B 恢复行的时间读数可能是「现在」**：浮层的行时间格在**建清单时**算一次、不在原地刷新；
  浮层在发送后同一秒内打开时 `sessionWhen` 走 0 秒档，显示「现在」而不是「N秒前」。判据因此
  写成 `/活动排序乙 (\d+(秒|分钟|小时)前|现在)/`，两者都是「今天的真实活动」。
- **「后台推进 A」用 1000000000 而不是未来时间**：`sessionWhen` 对未来时间做 0 秒钳制
  （`Math.max(0, now - at)` ⇒ 「现在」），写 2000000000 会显示「现在」而不是某个短日期。
  场景要判「行时间格真的换成新活动的日期」，因此取一个仍高于全部历史值、但早于运行期
  「现在」的固定值（1e9 = 2001-09-09 ⇒ 「9月9日」）；重开后两条 A 行都沿
  `restored_from` 链读到它，`1月5日` 计数为 0。
- **真实发送的唯一写盘点**：B 的恢复行首条消息触发惰性落盘；断言挂在发送之后（M535 的
  落盘时机口径，与场景 106 同）。

## 已知边界（如实登记）

- **删除钮的 nth 索引在确认态下会压缩**：`row.replaceChildren(prompt, 删除, 取消)` 会移除该行
  的 ×，其余行的删除钮逐位前移。本场景的每一条「第 N 行」判据都写成「隐藏行 N → 断言 →
  取消还原」，MUST NOT 在多个行同时处于确认态时按固定 nth 定位（2026-11-24 真机 FAIL 的
  根因；产品排序、行名与删除钮可访问性均正确）。

- **「缺时间不渲染时间格」的 AX 判据**：AX 只能读节点，读不出「某 span 不存在」的负向形态；
  本场景判「该行在场且排在最后」，时间格缺席由 `tests/visual/scenes/m662-session-title.spec.ts`
  的结构断言（第三行无 `ts` → 无 `.lumir-hp-sesspop-when`）与 Rust 单测
  `missing_timestamps_sort_last_without_fabricated_reading` 钉住。
- **「精确 session id 集」**：真机 AX 读不到 session id；本场景用「删除钮计数 + 日期读数计数
  + glob 文件数」三角判行数与身份，精确 id 集由 Rust 单测判。
- **打开期间后台一轮用外部写盘模拟**：产品不订阅会话文件（design §5：打开期间不轮询、不
  订阅），外部写盘与「后台真完成一轮」在浮层侧等价；重开浮层才重拉清单。真实后台轮次的行为
  面（B 的续聊）已另在同一步真机验过。
- **不判滚动条 / 行宽**：浮层行布局归视觉门禁；本场景只判文本与顺序。
- **M392 不碰**：恢复产生的多行是显式行为，本场景把它当作判据（每文件一行、各自可删），
  不把重复行当缺陷、不做去重。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；会话留存全部落在隔离
  配置目录的 `harness/sessions/acc-order/` 下（合成 id / 合成内容，不含真实 vault 名与正文）。
  mock 只回文案、不写 vault。1420 全程不碰（实例走 `LUMIR_ACCEPTANCE_PORT=1430`）。
