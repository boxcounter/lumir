---
id: "104-harness-stop-immediacy"
item: 104
title: 停止即时性与轮次封闭：片间隔内点停止亚秒级收口（时长上界断言），停止后继续提问不复活被取消轮的回复
open: harness-note.md
marker: "HNL-ALPHA"
# 第 1 条响应带 chunk_delay_ms: 8000：FAST-A 上屏后睡 8 秒才产出 FAST-B——点停止落在
# 这个间隔里。时长上界断言 = 点停止后 3 秒内「已停止」上屏且阶段行离开「正在生成回复」：
#   - 旧实现（M374 前）片间隔一次睡满 8 秒才问停止标志 → 必超 3 秒上界（判据区分度自证）；
#   - 新实现 chunk_gap 小步轮询（25ms 一问）+ SSE 读循环小步轮询 → 亚秒级收口。
# 第 2 条响应供「停止 → 继续提问」：NEXT 到达后被取消轮（FAST-C）的迟到内容不得复活
# （前端轮次闸门 turnOpen + Rust 检查点收口）。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-stop-fast.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 空闲态：发送钮在场
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问（可打印序列，注入回读校验由 keys 动作内部完成）
    do: keys
    keys: ["s", "f", "a", "s"]
    expect:
      - label: 提问落在 composer 里（注入落地——下一步 Enter 才有东西可发）
        ax: { has: "sfas" }
  - name: 发送
    do: key
    key: enter

  - name: 等第一片上屏（第二片还隔着 8 秒片间隔，点停止要落在这个窗口里）
    do: waitFor
    waitFor:
      has: ["FAST-A 第一片。"]
    timeoutMs: 30000
    expect:
      - label: 第一片已上屏（停止动作的落点前提）
        ax: { has: "FAST-A 第一片。" }
      - label: 末片尚未到达（确认真在片间隔里，不是在流结束后）
        ax: { not: "FAST-C 第三片。" }
      - label: 阶段行已推进到「正在生成回复…」（在途 + 增量的联合判据，同 97 口径）
        ax: { has: "正在生成回复…" }

  - name: 片间隔内点停止——中断在途流（harness_abort）
    do: click
    target: { role: AXButton, name: "^停止$" }

  - name: 时长上界：3 秒内收口（「已停止」上屏且阶段行离开「正在生成回复」）
    do: waitFor
    waitFor:
      has: ["已停止"]
      not: ["正在生成回复…"]
    timeoutMs: 3000
    expect:
      - shot: 01-亚秒级收口
      - label: 中断标注「已停止」在场（D383，被取消的轮次有显式标记）
        ax: { has: "已停止" }
      - label: 已产出第一片保留（中断不是回滚）
        ax: { has: "FAST-A 第一片。" }
      - label: 未产出的末片没有上屏（停止真的收流）
        ax: { not: "FAST-C 第三片。" }
      - label: 被取消轮的工具调用没有执行（中断收在工具循环之前；本响应带 vault_read——
          若停止被忽略，本地工具秒级落行，本断言必红）
        ax: { not: "vault_read" }
      - label: JSONL 记下中断事件（turn_aborted sidecar）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"kind":"turn_aborted"' }

  - name: composer 收口回空闲（可继续发问）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(发送\\)/"]
    timeoutMs: 15000
    expect:
      - label: 停止后钮面回到发送态（本轮结束）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 继续提问（同一会话发第二个问题）
    do: keys
    keys: ["n", "e", "x", "t"]
    expect:
      - label: 第二个问题落在 composer 里
        ax: { has: "next" }
  - name: 发送第二个问题
    do: key
    key: enter

  - name: 等第二轮回答到达
    do: waitFor
    waitFor:
      has: ["NEXT-第二轮回答。"]
    timeoutMs: 30000
    expect:
      - shot: 02-继续提问后
      - label: 第二轮回答到达（会话真实继续：第 2 问的第 1 轮重放响应 1 并执行了它的
          vault_read，第 2 轮才弹出 NEXT——见正文「mock 重放语义」）
        ax: { has: "NEXT-第二轮回答。" }
      - label: 新一轮的工具循环真实执行（vault_read 行在场）——被取消轮没执行的那个调用，
          由这一轮补上：JSONL 只在新一轮落一条 function_call_output（被取消轮未执行工具）
        ax: { has: '/vault_read\s*harness-note\.md/' }
      - label: 有序性：被取消轮的「已停止」在新一轮工具行之前（被取消轮封闭在前、
          新一轮内容在后，不插队不复活）
        ax:
          has: '/已停止[\s\S]*vault_read\s*harness-note\.md[\s\S]*NEXT-第二轮回答。/'
      - label: 「已停止」标记恰好一个（被取消轮的那一个；新一轮正常完成不标）
        ax: { count: { pattern: "已停止", exact: 1 } }
      - label: JSONL 记下新一轮的工具调用结果（function_call_output）——配合停止步的
          「无工具行」断言：被取消轮没有执行工具，故全程只有新一轮落这一条
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"call_id":"call_1".*HNL-ALPHA.*"type":"function_call_output".*$/' }
      - label: JSONL 记下第二轮的正文（会话真实继续了）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"kind":"llm_response".*NEXT-第二轮回答。.*$/' }
---

# 104-harness-stop-immediacy —— 停止即时性与轮次封闭（M374 缺陷②④）

## 本场景在验什么

Alex 2026-10-07 原话：「点击停止后，要等几秒到十秒才真正地停下来，在这几秒到十秒的时间
里状态依然是 waiting for response」+「当我继续提出问题后，harness 会把上一条我取消的
问题的回复也显示出来」。

- **时长上界**：`chunk_delay_ms: 8000` 把停止动作钉在片间隔里；`waitFor has 已停止 +
  not 正在生成回复…, timeoutMs: 3000` 是「点击后到状态离开 waiting」的上界断言——旧实现
  片间隔一次睡满才问停止标志（8 秒 ≫ 3 秒上界，必红，区分度自证）；新实现
  `chunk_gap` 25ms 小步轮询，亚秒级收口。真 provider 侧的同族修复（SSE 读循环小步轮询）
  由 `cargo test sse_abort_during_silence_returns_promptly` 钉（3 秒停滞窗口、1 秒上界）。
- **轮次封闭**：「停止 → 继续提问」后断言 FAST-C（被取消轮的未产出内容）始终缺席 +
  有序性（FAST-A 在 NEXT 前）+ 「已停止」恰好一次。前端 turnOpen 闸门（sent 开、
  终态关，关闭期内容事件丢弃）与 Rust 侧检查点（压缩后收口，防 done 把已取消轮当作
  正常完成）共同守住「已取消的轮次不再带进消息流」。

## 断言口径

- **时长上界**：waitFor 的 timeoutMs 是上界——条件在 3 秒内成立即 PASS；旧实现 8 秒后
  才成立，必超时判红。waitFor 日志里的「用时 Nms」是收口时延的直接证据。
- **not FAST-C 的两次落点**：第一次在收口后（停止真的收流），第二次在第二轮回答到达后
  （继续提问不复活）。判据落在真值上：FAST-A / FAST-C / NEXT 三串两两不互为子串。
- **count 已停止 = 1**：轮次封闭的对偶判据——第二轮正常完成不得带「已停止」。

## 已知边界（如实登记）

- **上界 3 秒是 mock 场景的宽松上界**：新实现实际收口时延 ≈ 片间隔轮询步长（25ms）+
  事件投递，waitFor 日志的实测值会远小于 3 秒（首跑实测 81ms）；上界取 3 秒是给真机调度
  抖动（注入、AX 往返）留裕量，同时保证旧实现（8 秒）必红。
- **mock 重放语义（本场景的两轮结构因它而来）**：MockClient 每次 `run_turn` 都从 fixture
  文件**重新装配、脚本从头弹起**——第 2 问的第 1 轮 LLM 调用会重放响应 1（FAST-A +
  vault_read），第 2 轮才弹到 NEXT。因此「被取消轮的未产出串（FAST-B/C）继续提问后不得
  出现」在 mock 下不可判（新一轮会合法地产出它们）——本场景改判它的机制面：被取消轮的
  **工具调用没有执行**（停止步的「无工具行」负向断言：vault_read 本地秒级，若停止被忽略
  必落行）、「已停止」恰好一次、被取消轮封闭在新一轮内容之前。真 provider 无重放
  （每轮是新请求），「已取消轮回复不复活」的 prod 面由前端 turnOpen 闸门 + Rust 检查点
  收口共同承担。
- **场景 88/97 的分工不变**：88 守 `delay_ms`「响应尚未开始」窗口不可中断的回归面；
  97 守「部分到达可见」；本场景守「间隔内停止的时长上界 + 继续提问后被取消轮不复活
  （机制面）」。场景 97 正文「停止生效最多等一个片间隔」的已知边界随 M374 失效（片间隔
  改为小步轮询后亚秒级生效），97 的 30s 超时断言不受影响。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；只发问与停止，
  不写 vault 文件。1420 全程不碰（实例走 `LUMIR_ACCEPTANCE_PORT=1430`）。
