---
id: "104-harness-thinking-tool-order"
item: 104
title: 思考块与工具行的到达序：think→tool→think 交错按真实时序呈现（M383）
open: harness-note.md
marker: "HNL-ALPHA"
# 这条 mock 脚本的第 1 条响应 = 思考 ALPHA + 正文 ORD1 + vault_read 调用，第 2 条 = 思考
# BETA + 正文 ORD2——真实事件序：ALPHA → ORD1 → 工具 → BETA → ORD2（工具循环第二轮的
# 思考在工具之后到达）。旧实现把后到的思考块一律插到首个正文段之前：呈现序变成
# ALPHA → BETA → ORD1 → 工具（Alex 2026-10-08 截图实证）。本场景展开两块思考后，用
# 整树有序正则钉死到达序合同（与场景 103 的 M374 有序正则同写法）。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-thinking-tool-order.json"
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
    keys: ["t", "t", "o", "q"]
    expect:
      - label: 提问落在 composer 里（注入落地——下一步 Enter 才有东西可发）
        ax: { has: "ttoq" }

  - name: 发送
    do: key
    key: enter

  - name: 等工具循环跑完（工具 → 回送 → 第二段思考 + ORD2 到达 = 本轮定稿）
    do: waitFor
    waitFor:
      has: ["TTO-ORD2-答案在第二段思考之前。"]
    timeoutMs: 30000
    expect:
      - label: 首轮正文保留（ORD1 与 ORD2 同轮共存）
        ax: { has: "TTO-ORD1-先读文件再回答。" }
      - label: 工具行带参数摘要在场（成功行口径同场景 103）
        ax: { has: '工具 vault_read：{"path":"harness-note.md"}' }
      - label: 两个折叠行都在场（两段思考各成一块）
        ax: { has: "/思考过程 · \\d+ 秒/" }

  - name: 展开第一块思考（DOM 首位的折叠行）
    do: click
    target: { role: AXButton, name: "^思考过程", nth: 0 }

  - name: 展开第二块思考（DOM 第二位的折叠行）
    do: click
    target: { role: AXButton, name: "^思考过程", nth: 1 }

  - name: 两块展开后：整树有序正则钉死到达序
    do: waitFor
    waitFor:
      has: ["TTO-THINK-ALPHA 先读文件。", "TTO-THINK-BETA 读完再答。"]
    expect:
      - shot: 01-到达序-两块展开
      - label: 有序性判据（整树正则）：ALPHA → ORD1 → 工具行 → BETA → ORD2——思考块 /
          工具块 / 正文段严格按事件到达序排列（M383；旧实现呈现为 ALPHA → BETA →
          ORD1 → 工具，本正则必红）
        ax:
          has: '/TTO-THINK-ALPHA 先读文件。[\s\S]*TTO-ORD1-先读文件再回答。[\s\S]*工具 vault_read：\{"path":"harness-note.md"\}[\s\S]*TTO-THINK-BETA 读完再答。[\s\S]*TTO-ORD2-答案在第二段思考之前。/'
      - label: 反向判据：第二段思考原文不出现在工具行之前（旧实现的倒挂形态）
        ax:
          not: '/TTO-THINK-BETA 读完再答。[\s\S]*工具 vault_read/'

  - name: "收起两块思考（三态闭环回程，同场景 93 口径；折叠不挪块位，第二块仍在 nth: 1）"
    do: click
    target: { role: AXButton, name: "^思考过程", nth: 0 }
  - name: 再收起第二块
    do: click
    target: { role: AXButton, name: "^思考过程", nth: 1 }
  - name: 收起后：思考原文不可见、正文与工具行仍在
    do: waitFor
    waitFor:
      not: ["TTO-THINK-ALPHA"]
    expect:
      - label: 收起后思考原文不进 AX
        ax: { not: "TTO-THINK-ALPHA" }
      - label: 正文与工具行不受折叠影响
        ax: { has: "TTO-ORD2-答案在第二段思考之前。" }
      - shot: 02-再折叠
---

# 104-harness-thinking-tool-order —— 思考块 / 工具行到达序（M383）

## 本场景在验什么

Alex 2026-10-08 dogfood 截图实证：「思考过程和 tool use 的顺序是错的……正确的顺序是先
tool vault_read 然后才是第二个 thinking」。根因：`ensureThinkingView` 把思考块一律插到
首个正文段容器（`.lumir-hp-body`）之前，注释自承「思考相对工具的位置由到达序决定」——
该自承只在「首个正文段尚未建立」时成立；工具循环第二轮的思考到达时，首轮正文段早已建
立（其间还隔着工具块），思考块于是跳到在途工具块前面。

修复（M383）：思考块 / 工具块 / 正文段在 assistant 消息内严格按事件到达序排列（结构性
创建按到达序号合并落位，正文段在思考 / 工具处切分）。本场景的有序正则
（ALPHA → ORD1 → 工具 → BETA → ORD2）就是这条到达序合同在真机 WKWebView 下的可观测
形态；合同的完整交错矩阵由视觉层 `tests/visual/scenes/m383-harness-thinking-order.spec.ts`
的结构断言守（零像素）。

## 断言口径

- **有序性**：`ax.text` 是整棵 AX 树的扁平文本，有序正则一次读取钉死五段相对位置
  （REVIEW.md 第 1 条的写法：旧实现下本正则必红，区分度已自证）。思考块折叠时原文不进
  AX，故先展开两块再断言顺序——展开/收起本身另有场景 93 的三态闭环。
  **YAML 单引号正则的反斜杠纪律**：场景文件里 `/.../ ` 正则写在 YAML 单引号标量中，
  单反斜杠原样透传（`\s` `\{`）——写双反斜杠会让 matcher 拿到字面的 `\\s`（正则语义 =
  反斜杠 + 字母 s），与任何文本都不匹配、判据恒红（M383 首跑实证，与场景 103 的
  既有写法对齐后转绿）。
- **`nth` 锚定**：两个折叠行文案相同（「思考过程 · N 秒」），按 DOM 位次 `nth: 0/1`
  逐个点开。
- **反向判据**：`not` 正则钉死「BETA 不出现在工具行之前」——正向有序正则单看可能被
  「BETA 在两处都出现」之类形态糊弄，负向判据把倒挂形态直接判红。
- **时长读数在 mock 下恒为 0 秒**：同场景 93 的口径（`turn.rs` 连发分片，墙钟差为 0），
  只断言「思考过程 · \d+ 秒」格式在场。

## 环境与副作用

- 不写 vault 文件、不碰剪贴板；mock provider 只在内存里弹脚本，零外部 API 调用。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；vault_read 只读
  harness-note.md。1420 全程不碰（实例走 `LUMIR_ACCEPTANCE_PORT=1430`）。
