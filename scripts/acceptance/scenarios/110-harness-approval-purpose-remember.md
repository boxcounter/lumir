---
id: "110-harness-approval-purpose-remember"
item: 110
title: 批准卡（M414）：purpose 用途句 + 组合命令拆段 + 「采纳且本会话不再问」免闸（change add-harness-permission-modes，mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-approval-remember.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 抢前台（后台注入键盘整批丢键/错键会显著加剧——REVIEW.md 第 11 条）
    do: focusWindow
    retries: 4

  - name: 输入提问并 Enter 发送（本场景只发这一条消息——见「已知边界」的键盘注入口径）
    do: keys
    keys: ["s", "e", "g"]
  - name: 发送
    do: key
    key: enter

  - name: 等第一张批准卡（chmod = 写类命令 → vault_write 档逐个问）
    do: waitFor
    waitFor:
      has: ["要运行这条命令吗？"]
    expect:
      - label: 用途句在卡上（purpose 呈现：模型自述原文，属数据读数——命令原文完整可见不被它替代）
        ax: { has: "把两个临时目录收紧到仅本人可读写" }
      - label: 组合命令按连接符拆段——第一段
        ax: { has: "chmod 700 /tmp/lumir-m414-seg-a" }
      - label: 组合命令按连接符拆段——第二段以 && 起首（拆段是排版，连接符仍逐字可见）
        ax: { has: "&& chmod 700 /tmp/lumir-m414-seg-b" }
      - label: 闸语义副句在场（D414，命令类）
        ax: { has: "批准后才会在终端运行，输出回到对话里" }
      - label: 次级动作在场（D434）
        ax: { has: "采纳且本会话不再问" }
      - shot: 01-批准卡-用途句与拆段

  - name: 拒绝这一条（拆段那条命令不执行——真机不许造真副作用）
    do: click
    target: { role: AXButton, name: "^拒绝$" }

  - name: 等第二张批准卡（拒绝后模型拿到结果继续：mkdir -p = 写类命令 → 逐个问）
    do: waitFor
    waitFor:
      has: ["建一个临时目录供后续步骤使用"]
    timeoutMs: 30000
    expect:
      - label: 第二张卡在场（问句 D340 复用；身份靠卡上的用途句与命令区分）
        ax: { has: "要运行这条命令吗？" }
      - label: 第二条命令的用途句在场
        ax: { has: "建一个临时目录供后续步骤使用" }
      - label: 单段命令不拆（原文一行可见）
        ax: { has: "mkdir -p /tmp/lumir-m414-cache" }
      - shot: 02-第二张卡

  - name: 点「采纳且本会话不再问」（次级动作 → harness_approve(remember=true)）
    do: click
    target: { role: AXButton, name: "^采纳且本会话不再问$" }

  - name: 等本轮收尾（第三次调用 = 同主体串 ⇒ 缓存命中免闸，直达最终答复）
    do: waitFor
    waitFor:
      has: ["第二次没有再打扰你。"]
    timeoutMs: 40000
    expect:
      - label: 全程没有再问（若缓存未命中就会挂起在第三张卡上，等不到这句答复）
        ax: { not: "要运行这条命令吗？" }
      - label: JSONL 的批准 sidecar 记下 decision=approved
        file: { path: "env:harness/sessions/*/*.jsonl", has: "/\"decision\":\"approved\"/" }
      - label: JSONL 的批准 sidecar 记下 remember=true（缓存写入的唯一依据，M413 transport）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "/\"remember\":true/" }
      - label: 同主体串的第二次调用确实跑了（wire 留存里有它的 call_id）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "/\"call_id\":\"call_cache2\"/" }
      - shot: 03-收尾

  - name: 回看这一轮的调用行（本 fixture 每段响应一个工具调用 ⇒ 每块 1 行、不折叠，行始终行内可见）
    expect:
      - label: 被采纳的调用行收敛为「已采纳」终态（D405）
        ax: { has: "已采纳" }
      - label: 免闸的第二次调用也在清单里（同主体串第二次没有再出卡）
        ax: { has: "mkdir -p /tmp/lumir-m414-cache" }
      - shot: 04-第二次未再问
---

# 110-harness-approval-purpose-remember —— 批准卡的用途句、命令拆段与会话内免问

## 本场景在验什么

M414 的三项批准卡改动（design §3.4 / §6，Alex 原话：「让询问我的时候，除了命令本身，还请告诉
我它是干什么的……人工检查非常困难」「是否有可能在询问我的时候也把命令做排版上的格式化，让人工检查
轻松一些」「采纳且本会话不再问」）：

1. **purpose 用途句**：cli_run 批准卡在命令**上方**展示模型自述的用途句（数据来自 M413 已落地的
   `ApprovalRequest.purpose` → 事件载荷 `purpose` 键）。信任边界：purpose 是阅读辅助、**不是安全
   判据**（判定管线只看 argv），命令原文永远完整可见、不被它替代或截断。
2. **组合命令拆段**：`chmod 700 /tmp/lumir-m414-seg-a && chmod 700 /tmp/lumir-m414-seg-b` 在卡里
   按连接符（`;` `&&` `||` `|` `&` / 换行）拆成多行、连接符起首——纯排版层，`join("")` 逐字符等于
   原文（不变量由 `tests/unit/harness-permission-modes.test.ts` 钉死）。
3. **「采纳且本会话不再问」**：批准卡主决策行之下的次级动作（D434）。点它走
   `harness_approve(remember=true)`，后端把 (工具, 规范化主体串) 记入**会话内**批准缓存；
   同会话同主体串的后续调用不再出卡（缓存只短路模式默认分层——deny / 重定向 / 黑名单三层永远
   先于缓存，这点由 core 侧集成测试钉，不在本场景）。

## fixture 的四段意图（**全部发生在同一条用户消息内**）

| 段 | 命令 | 期望 |
|---|---|---|
| 1 | `chmod …&& chmod …`（argv 里 `&&` 是**独立 token**） | 出卡：用途句 + 两段拆行；场景**拒绝**它（真机不造副作用） |
| 2 | `mkdir -p /tmp/lumir-m414-cache` | 出卡；点「采纳且本会话不再问」⇒ 执行 + 记缓存 |
| 3 | 同一条 `mkdir …`（同工具 + 同主体串） | **不出卡**，直接执行 |
| 4 | — | 最终答复（能到达即证明第 3 段没被卡住） |

## 断言口径与已知边界

- **「不再出卡」的判据是终态 + 负向断言**：缓存未命中会在第 3 段挂起批准卡 ⇒ 那句
  「第二次没有再打扰你。」永远不到达 ⇒ `waitFor` 超时判 FAIL。加上 `ax: { not: "要运行这条命令吗？" }`
  与「第二次调用的 call_id 在 wire 留存里」两条，合成一条不依赖内部状态的判定。
- **不判「缓存表里有什么」**：批准缓存是**会话内存态**（不落盘、不进 JSONL），真机侧没有读数
  入口。可判的痕迹只有 `approval` sidecar 的 `remember` 字段（写入依据）与「第二次没再问」
  （消费结果）——本场景两条都断言。
- **本场景只发一条用户消息**（首跑实证的取舍）：初版按「每段一条消息」写，首跑在第 2、3 条消息的
  键盘注入上失败——运行记录里 `前台焦点未取得（前台 pid=89637）`，两条注入的目标串均 0 次落地
  （REVIEW.md 第 11 条的丢键形态；同机 1420 有另一个实例）。改成单条消息后，键盘面只剩
  ⌘⇧A + 一次输入（与已稳定通过的场景 109/111 同一形态），而**待验的三件事一件不少**。
  代价如实登记：**「缓存跨消息/跨轮仍免问」不在本场景的覆盖内**——缓存是会话态、不按轮次分，
  轮内第二次调用走的是同一条短路路径；跨消息的存活由 core 集成测试
  （`src-tauri/tests/harness_runtime.rs` 的会话缓存用例）钉。
- **拒绝那条卡片的用途句同样断言**：purpose 的呈现与决策结果无关（用途句是阅读辅助）。
- **`chmod` 那条命令不执行**：argv 里的 `&&` 是字面参数（后端 argv 直传、不 shell 展开），真跑会
  在应用 cwd 下落奇怪的条目——场景刻意拒绝它，只取它的**呈现**证据。
- **`mkdir -p` 是幂等的真命令**：第 2、3 段各执行一次，落在 `/tmp/lumir-m414-cache`（不在 vault
  内、不在验收 vault 的清理面里），对后续场景无影响。
- **终态行始终行内可见**：折叠（一行摘要钮）只在**同一块 ≥2 行**时发生，而本 fixture 每段响应只发
  一个工具调用 ⇒ 每块 1 行、不折叠（初版按场景 75 的形态去点摘要钮，判红是场景写错——75 的
  fixture 在同一响应里发两个 cli_run 才凑出 2 行）。

## 环境与副作用

- vault 文件不被改动（fixture 只跑 cli_run 与文本答复）。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`（wire 留存落
  `env:harness/sessions/<vault 稳定 id>/`，每场景重置）；真实 vault 与 `~/.config/lumir` 全程不读写；1420 不碰。
