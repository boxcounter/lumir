---
id: "97-harness-stream-visible"
item: 97
title: 真流式与在途停止：分段到达时可见部分正文、片间隔内点停止能中断在途流并保留已产出正文
open: harness-note.md
marker: "HNL-ALPHA"
# mock 的这条响应带 `chunk_delay_ms: 6000`（片间隔）：分片**一片片到达**——第一片发出后
# 睡 6 秒再发第二片，第二片后睡 6 秒再发第三片。这个间隔就是「流式进行中」的窗口：
# ① 第一片到达时整条回答尚未完整（部分正文可见 = 真流式的可观测后果）；
# ② 间隔内点停止 → 产出循环在流中问到停止标志即收流（在途停止），已产出的第一片保留。
# 注意与 `delay_ms`（场景 88 用的那个）的分工：`delay_ms` 是「响应尚未开始」的窗口、
# 不可中断；`chunk_delay_ms` 是「响应正在逐片到达」的窗口、可中断（见 llm.rs 模块头）。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-stream.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 空闲态：发送钮在场（本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问（可打印序列，注入回读校验由 keys 动作内部完成）
    do: keys
    # 探针取 4 个字符：本场景只求 composer 非空以便发送（提问内容不参与任何断言），
    # 序列越短越少受 KimiCU 逐键注入的丢键/串键噪声影响（REVIEW.md 第 11 条）。
    keys: ["s", "t", "r", "m"]
    expect:
      - label: 提问落在 composer 里（注入落地——下一步 Enter 才有东西可发）
        ax: { has: "strm" }
  - name: 发送
    do: key
    key: enter

  - name: 等第一片正文上屏（第二片还隔着 6 秒片间隔，这一步就是「部分到达」的观测点）
    do: waitFor
    waitFor:
      has: ["STREAM-A 第一片。"]
    timeoutMs: 30000
    expect:
      - label: 流式期间已有部分正文上屏（回答尚未完整）
        ax: { has: "STREAM-A 第一片。" }
      - label: 末片尚未到达——增量到达，不是整条一次性上屏（旧实现整条一次上屏时这条必红）
        ax: { not: "STREAM-C 第三片。" }
      - label: 阶段行已从「等待响应…」推进到「正在生成回复…」（首个 chunk 到达的正观测）
        ax: { has: "正在生成回复…" }
      - shot: 01-部分到达

  - name: 片间隔内点停止——中断在途流（harness_abort）
    do: click
    target: { role: AXButton, name: "^停止$" }

  - name: 等中断收口（片间隔内小步轮询问到停止标志即收流，aborted 事件回 idle）
    do: waitFor
    waitFor:
      has: ["已停止"]
    timeoutMs: 30000
    expect:
      - shot: 02-流中停止
      - label: 中断标注「已停止」挂在被打断的消息上（D383）
        ax: { has: "已停止" }
      - label: 已产出正文保留在 transcript（中断是「不再继续」，不是回滚）
        ax: { has: "STREAM-A 第一片。" }
      - label: 未产出的末片始终没有上屏（停止真的收流，不是等它跑完再收）
        ax: { not: "STREAM-C 第三片。" }
      - label: JSONL 记下中断事件
        file: { path: "env:harness/*.jsonl", has: '"kind":"turn_aborted"' }
      - label: 已产出正文也已留存（中断前的 assistant_text）
        file: { path: "env:harness/*.jsonl", has: "STREAM-A 第一片。" }

  - name: composer 收口回空闲（aborted 经 finished 回 idle）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(发送\\)/"]
    timeoutMs: 15000
    expect:
      - label: 停止后钮面回到发送态（本轮结束）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 停止钮已离场
        ax: { not: "/AXButton \\(停止\\)/" }
      - label: 阶段行随相位收起
        ax: { not: "正在生成回复…" }
---

# 97-harness-stream-visible —— 真流式与在途停止（M369）

## 本场景在验什么

「agent 的回复一次性出现」这个观感的根因在 Rust 侧：SSE 增量被攒进 `Vec`、等整条响应读完
才由工具循环一次性补发（`text_chunk` 事件协议与前端 rAF 合帧渲染本就具备）。M369 把转发点
搬到解析层——收到即转发（`StreamSink`），并把停止标志接进读循环。本场景走真机验证这条链路
的两面：

1. **部分正文先到**：`chunk_delay_ms` 把分片之间撑开 6 秒。第一片上屏时末片还隔着两个间隔
   ——「此刻有 A、没有 C」这一对断言就是「增量到达」的可观测后果。**区分度**（REVIEW.md
   第 1 条）：改动前整条回答在 `complete` 返回时一次上屏，A 与 C 必然同拍出现，`not C` 必红。
2. **在途停止**：在片间隔里点停止 → 产出循环在间隔结束、发出下一片**之前**问到停止标志即收流；
   已产出的第一片保留在 transcript 并挂「已停止」（D383），JSONL 记 `turn_aborted` +
   已产出 `assistant_text`。末片始终没有上屏，证明停止真的中断了在途响应，而不是「等它跑完
   再在检查点截住」。

## 与场景 88 的分工（别把两者当重复）

两个场景都验中断，但落在**不同的窗口**上，且语义在这轮升级后不同：

| | 场景 88 | 场景 97（本场景） |
|---|---|---|
| mock 杠杆 | `delay_ms: 12000` | `chunk_delay_ms: 6000` |
| 窗口 | 响应**尚未开始**（一个分片都还没产出） | 响应**正在逐片到达** |
| 停止生效点 | `complete` 返回后的检查点（睡满 12s） | 读/产出循环**流中**（片间隔的轮询步长内，亚秒级） |
| 可中断 | 否（`delay_ms` 一次睡到底） | 是 |
| 验的是 | 产出保留 + 已停止标注 + 两态收口 | 部分到达可见 + 流中真的收流 |

场景 88 保持原样即证明「`delay_ms` 形态未被在途停止破坏」（产出照常完整保留、检查点照旧
生效）——这半边是被保护的回归面，本 mission 未改它的 fixture 与断言。

## 断言口径

- **部分到达**：`ax.has "STREAM-A 第一片。"` 与 `ax.not "STREAM-C 第三片。"` 同一次读取里
  成立。三片标记两两不互为子串、也不与提问串（`strm`）复现，因此负向断言不会被别处文本
  满足（REVIEW.md 第 2 条的反面：判据落在真值上）。
- **阶段行**：`正在生成回复…`（D382）是「首个 chunk 已到达」的正观测——它只在处理中相位且
  已收到至少一个分片时可见（`applyStage`），因此它同时钉住「这一刻仍在 running」这个前提，
  把上面的 `not C` 从一个可能空转的负向断言升级为「在途 + 增量」的联合判据。
- **在途停止**：`已停止`（D383）是中断**已发生**的正观测；`not C` 与 JSONL 的 `turn_aborted`
  是三处独立事实（界面 / 界面 / 盘），任意一处坏了另外两处不会跟着绿。
- **JSONL**：`env:harness/*.jsonl` 取 mtime 最新一份（隔离配置目录每场景清空，glob 口径与
  场景 88 一致）。

## 已知边界（如实登记）

- **片间隔是 mock 的时序杠杆，不是产品时延**：真 provider 的分片节奏由网络与模型决定；
  本场景验的是「分片到达即上屏 + 流中可停」这条通路，不验任何绝对时延。
- **末片断言只判 `STREAM-C`**：停止若发生在较晚的片间隔（机器慢），第二片也可能已经上屏——
  那是合法的「已产出内容保留」，故不判 `not STREAM-B`（判它会在慢机上假红）。
- **停止生效是亚秒级的（M374 起）**：`chunk_gap` 改为小步轮询睡眠（25ms 一问停止标志），
  点停止到收流 ≈ 一个轮询步长，不再等整个片间隔睡满（旧实现最长等一个 6s 间隔）。
  真 provider 侧的同族修复（SSE 读循环独立读线程 + 100ms 超时轮询）由单测
  `sse_abort_during_silence_returns_promptly` 钉住。时长上界的真机断言见场景 99。
- **进度条的不定态动画不在本层**：`.lumir-hp-progress` 是无 role 的 div，动画归视觉层。
- **流停滞期间的停止（M374 起）**：SSE 读循环把读端搬到独立线程、消费端按 100ms 小步
  超时轮询，静默窗口（provider 思考期零事件）里点停止亚秒级收流——旧实现阻塞在
  `reader.lines()` 上，要等到下一条数据到达才生效（「几秒到十秒」现场）。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；不写 vault 文件（只发问、
  停止），JSONL 留存落在隔离配置目录下（`env:harness/*.jsonl`）。真实 vault 只读。
- 本场景耗时主要是一次片间隔（6s）+ 收口；1420 全程不碰（实例走 `LUMIR_ACCEPTANCE_PORT=1430`）。
