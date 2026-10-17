---
# M452（change composer-draft-persistence，design §9 ④）：**发送成功后清除草稿**（含落盘）。
#
# 判据口径：先在输入区打字、等防抖落盘（草稿文件**确实存在**——否则「发完文件没了」是空过），
# 再用 mock provider 真发一条（回合收口 = 回答渲染），然后断言草稿文件**被删除**与输入区清空。
#
# 为什么用 mock 而不是 kimi：本场景判的是**发送被接受之后**的清除，必须真走通一次成功发送；
# mock 档不发网络请求、逐字节确定（同 127/134 的取向）。
id: "137-harness-draft-send-clear"
item: 137
title: composer 草稿：发送成功后清除（草稿文件被删除、输入区清空）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
seed:
  registry:
    - { id: acc-send, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-send:
      panes:
        - { tabs: [harness-note.md], active: harness-note.md }
      harnessPane: true
steps:
  - name: 等 A 装载 + harness pane 按存储装配 + 输入区在位
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "问点什么"]
    timeoutMs: 40000
    expect:
      - shot: 01-起始态

  - name: 点 composer 聚焦并键入待发送内容
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 键入标记串
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|draftclear" }
    text: "draftclear"
    expect:
      - label: 标记落在 composer（注入落地的正观测）
        ax: { has: "draftclear" }

  - name: 等防抖落盘（1s 窗口 + 2.5s 余量）
    do: sleep
    ms: 2500
    expect:
      - label: ④ 前置：草稿文件确实存在且含标记（否则「发完就没了」是空过）
        file: { path: "env:harness/drafts/acc-send.json", has: "draftclear" }
      - shot: 02-发送前-草稿在位

  - name: 发送（Enter；mock 档一次成功回合）
    do: key
    key: enter

  - name: 等回合收口（mock 的回答渲染 = 发送被接受且跑完）
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    timeoutMs: 30000
    expect:
      - label: 提问已沉淀进 transcript（发送确实发生）
        ax: { has: "draftclear" }
      - label: ④ 输入区已清空（空态 = D328 占位读名）
        ax: { has: "问点什么" }
      - label: ④ 草稿文件被删除（内容已进会话，不再是未发送草稿）
        file: { path: "env:harness/drafts/acc-send.json", exists: false }
      - label: ④ 负向：盘上不残留「空壳草稿」文件
        glob: { dir: "env:harness/drafts", pattern: "\\.json$", exact: 0 }
      - shot: 03-发送后-草稿清除

  - name: 等一拍（发送成功后若还有在途的防抖写入，这一拍足够它落地）
    do: sleep
    ms: 1500
    expect:
      - label: ④ 发送窗口里的待写被一并取消（草稿不会被 1s 防抖写回盘上）
        file: { path: "env:harness/drafts/acc-send.json", exists: false }
      - shot: 04-拍后仍无草稿
---

# 137-harness-draft-send-clear —— 发送成功后清除草稿（design §9④）

## 本场景在验什么

spec「composer 草稿自动保存与恢复」的行为条款：**发送成功后草稿 SHALL 清除（含落盘）**——
内容已经进了会话，不再作为「未发送的输入」留存。

## 判据为什么这样写

- **前置「草稿文件存在」不可省**：本场景的主判据是「文件没了」。若起始盘上就没有这份文件，
  「没了」是恒真的空过（REVIEW.md 「读不到当成空」条同族）。先断言它存在且含标记，再断言它消失，
  两条一起才有区分度。
- **发送用 mock 真跑通一次**：清除的触发点是**发送被接受**（`harness_send` resolve）之后，
  不是点击时。mock 档一次成功回合让这条链路真走一遍（真 client 与 mock 同一条代码路径）。
- **「拍后仍无草稿」是发送窗口的判据**：用户在发送前 1s 内打过字时，窗口里可能还压着一份
  待写内容——若那份没被取消，它会在 1s 防抖到点后把已发送的内容写回盘上（草稿「复活」）。
  这一步就是给那个时点留的时间盒。
- **「输入区已清空」既有行为回归**：发送后清空输入区是本能力的既有行为（乐观清空），
  本场景顺带把它钉住，防「清了盘上的却忘了清界面」。

## 覆盖边界（如实登记）

- **真机跑绿状态**：本场景随 change 同 PR 交付，**本轮未跑真机**（前台窗口由 tower 统一安排）。
- **发送被拒 / 失败时的保留**是另一条（design §9⑤，场景 138 走 kimi + vision:false）；本场景
  只判成功路径。**其余失败形态**（busy / 线程起不来）在真机上不易构造，其「草稿原样保留」
  的实现面在 `src/harness-panel.ts` 的 send 失败分支（草稿不被触碰），无独立真机判据。
- **删除失败的降级路径**（磁盘不可写）不在这里：写失败的降级判据由单元层与 Rust 单测覆盖。

## 环境与副作用

- 合成 vault（`/tmp/lumir-m102-acceptance`）+ 隔离 `XDG_CONFIG_HOME`；真实 vault 只读。
- mock provider 会往隔离配置目录写会话 JSONL（套件每场景清 `harness/`）；零网络请求。
- 1420 全程不碰（端口走 `LUMIR_ACCEPTANCE_PORT`，缺省 1430）。
