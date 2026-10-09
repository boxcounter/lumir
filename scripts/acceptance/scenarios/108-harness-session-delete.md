---
id: "108-harness-session-delete"
item: 108
title: 会话删除（M406）：活跃会话拒删（harness_session_active 错误行）→ 历史会话行内两步确认删除（取消还原 / 确认删文件）
open: harness-note.md
marker: "HNL-ALPHA"
# mock 只有一条响应且每轮从脚本头重放（场景 104 记过这条重放语义）——两轮回答文案相同，
# 第二轮的 waitFor 靠「＋新会话 resetView 清空 transcript 后该串重新出现」区分（与场景 106
# 恢复后第二轮同手法）。会话清单按 session id 倒序（harness.rs list_sessions，id 时间序）：
# 行 0 = 后建的 deltwo（活跃），行 1 = 先建的 delone（历史）。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位（发送钮在场是本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入第一条提问并发送（产生历史会话 delone）
    do: keys
    keys: ["d", "e", "l", "o", "n", "e"]
  - name: 发送
    do: key
    key: enter

  - name: 等第一轮回答到达（delone 会话产生完成）
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    timeoutMs: 30000
    expect:
      - label: 首轮回答渲染（源会话产生的正观测）
        ax: { has: "验收回答：上下文已收到。" }
      - label: delone 会话落盘（session_open 在场）
        file: { path: "env:harness/sessions/*.jsonl", has: '"kind":"session_open"' }

  - name: 等回合收口（无在途轮次——「＋新会话」要求非 busy）
    do: waitFor
    waitFor:
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 15000

  - name: 点「＋新会话」把 delone 切成历史会话（＋钮是唯一叫「新会话」的 AXButton；
      会话名钮带 aria-haspopup → AXPopUpButton，role 分流，场景 92 同口径）
    do: click
    target: { role: AXButton, name: "^新会话$" }

  - name: 等新会话重置完成（transcript 回到空态——resetView 的正观测）
    do: waitFor
    waitFor:
      has: ["与当前文档对话"]
    timeoutMs: 15000

  - name: 点 composer 建立输入焦点（点钮后 DOM 焦点不在输入框——场景 106 同法）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 输入第二条提问并发送（产生活跃会话 deltwo）
    do: keys
    keys: ["d", "e", "l", "t", "w", "o"]
  - name: 发送
    do: key
    key: enter

  - name: 等第二轮回答到达（resetView 清过 transcript，该串重新出现 = 本轮产出）
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    timeoutMs: 30000
    expect:
      - label: 第二轮回答渲染（活跃会话 deltwo 的回合真实收口）
        ax: { has: "验收回答：上下文已收到。" }
      - label: 会话名钮落到 deltwo（活跃会话 = 第二条提问）
        ax: { has: "/AXPopUpButton \\(deltwo/" }
      - label: 两份留存文件都在盘（delone + deltwo）
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 2 }

  - name: 等回合收口（删除操作前无在途轮次）
    do: waitFor
    waitFor:
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 15000

  - name: 打开会话浮层（会话名钮带 aria-haspopup → AXPopUpButton）
    do: click
    target: { role: AXPopUpButton, name: "deltwo" }

  - name: 等历史清单出现（清单现拉现建——harness_list_sessions 往返）
    do: waitFor
    waitFor:
      has: ["delone"]
    timeoutMs: 15000
    expect:
      - label: 两行都在（活跃会话 deltwo 也列出——M406 起清单不排除活跃会话）
        ax: { count: { pattern: "/AXButton \\(删除该会话\\)/", exact: 2 } }
      - shot: 01-浮层两行

  # ── 第一步：删活跃会话 deltwo（行 0，清单按 id 倒序 = 最新在前）——后端必拒 ────────
  - name: 点活跃会话行的 ×（行内两步确认的第一段）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 0 }
    expect:
      - label: 行内确认态出现（D418 确认句）
        ax: { has: "删除这段会话的本地留存？" }

  - name: 确认删除活跃会话——后端拒绝（harness_session_active）
    do: click
    target: { role: AXButton, name: "^删除$" }

  - name: 等拒绝错误行上屏（失败 = 收浮层 + transcript 错误行，D348 包 D420）
    do: waitFor
    waitFor:
      has: ["该会话正在进行中，不能删除"]
    timeoutMs: 15000
    expect:
      - label: 活跃会话拒删的错误文案上屏（errorText 按 code 映射 D420）
        ax: { has: "该会话正在进行中，不能删除" }
      - label: 两份留存都还在（拒删 = 零副作用）
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 2 }
      - label: 活跃会话名钮未变（会话本身没被删）
        ax: { has: "/AXPopUpButton \\(deltwo/" }
      - shot: 02-活跃拒删

  # ── 第二步：删历史会话 delone（行 1）——取消先还原，再确认真删 ────────────────────
  - name: 重新打开会话浮层（失败收过浮层，清单重拉）
    do: click
    target: { role: AXPopUpButton, name: "deltwo" }

  - name: 等历史清单重新出现
    do: waitFor
    waitFor:
      has: ["delone"]
    timeoutMs: 15000

  - name: 点历史会话行的 ×（行 1 = delone）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 1 }
    expect:
      - label: 行内确认态出现
        ax: { has: "删除这段会话的本地留存？" }

  - name: 点「取消」——确认态还原回行（不删）
    do: click
    target: { role: AXButton, name: "^取消$" }
    expect:
      - label: 确认句消失（行还原）
        ax: { not: "删除这段会话的本地留存？" }
      - label: 两行的 × 钮都回来（还原 = 回到初始行形态）
        ax: { count: { pattern: "/AXButton \\(删除该会话\\)/", exact: 2 } }
      - label: 两份留存都还在（取消 = 零副作用）
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 2 }

  - name: 再点历史会话行的 ×（重新进入确认态）
    do: click
    target: { role: AXButton, name: "^删除该会话$", nth: 1 }
    expect:
      - label: 行内确认态再次出现
        ax: { has: "删除这段会话的本地留存？" }

  - name: 确认删除历史会话——成功（行 remove，留存文件删除）
    do: click
    target: { role: AXButton, name: "^删除$" }

  - name: 等删除生效（delone 行从浮层消失——harnessDeleteSession 成功后 row.remove）
    do: waitFor
    waitFor:
      not: ["delone"]
    timeoutMs: 15000
    expect:
      - label: delone 行消失、delone 串不进 AX（transcript 无该串，该串只可能来自浮层行）
        ax: { not: "delone" }
      - label: 活跃会话行仍在（删的是历史行，浮层不收——还剩一行）
        ax: { has: "deltwo" }
      - label: 盘上只剩一份留存（活跃会话的）
        glob: { dir: "env:harness/sessions", pattern: "\\.jsonl$", exact: 1 }
      - label: 留下的那份是 deltwo 的（删对了对象——留存内容正观测）
        file: { path: "env:harness/sessions/*.jsonl", has: "deltwo" }
      - label: 留下的那份不含 delone 的记录（反向核对）
        file: { path: "env:harness/sessions/*.jsonl", not: "delone" }
      - shot: 03-历史已删
---

# 108-harness-session-delete —— 会话删除（M406，harness 面板改进批次）

## 本场景在验什么

M406 给会话浮层的每行加了删除钮（×，D417 读屏名），删除走**行内两步确认**（× → D418
确认句 + 删除/取消 → 确认才调 `harness_delete_session`），后端对**活跃会话拒删**
（`harness_session_active` → D420「该会话正在进行中，不能删除」经 D348 错误行上屏）。

真机判据三条链：

1. **活跃会话拒删**：对活跃会话（deltwo，清单行 0）走完整两步确认，后端拒绝——错误文案
   上屏、两份留存文件都在、会话名钮未变（零副作用三判据）。
2. **取消还原**：对历史会话（delone，行 1）点 × 进确认态后点「取消」——行还原（确认句消失、
   × 钮回来）、留存不变。
3. **确认真删**：再进确认态点「删除」——行消失、盘上只剩一份留存、留下的那份内容是 deltwo
   的（删对了对象，不是删错了另一个）。

## 断言口径

- **行序钉死**：`harness.rs` 的 `list_sessions` 按 session id 字符串倒序（id 是
  `s<unix_millis>-<后缀>` 时间序），后建的 deltwo 恒在行 0、delone 恒在行 1——`nth` 锚定
  的语义因此稳定（不是 DOM 巧合）。
- **两轮同文案的区分**（mock 重放语义的副作用）：fixture 只有一条响应，两轮回答都是
  「验收回答：上下文已收到。」。第二轮的 waitFor 之所以有区分度，是因为「＋新会话」的
  resetView 把 transcript 清成了空态——该串重新出现只可能是第二轮产出（场景 106 恢复后
  第二轮同手法）。
- **活跃会话也在清单里**（M406 口径）：`list_sessions` 列全部 jsonl 留存，不排除活跃会话
  ——所以浮层打开后是两行，「删活跃会话」这条拒删链才有真机落点。
- **「delone 不进 AX」的正观测**：transcript 里没有 delone 串（第一轮内容随 resetView 清掉、
  当前会话是 deltwo），该串只可能来自浮层的历史行——它消失 = 行被 remove。
- **删对对象的判据在盘上**：`glob exact 1` 只证明少了一份，不证明删的是哪份——补
  `file has deltwo` + `not delone`（glob 路径取 mtime 最新一份，此时只剩一份，取到的必是它）
  把「删错对象」的形态判红。
- **失败路径的 UI 口径**：拒删失败 = 收浮层 + transcript 错误行（浮层留着会挡住错误行，
  harness-panel.ts 的 catch 注释）。本场景断言错误文案上屏（它同时是「浮层已收」的间接
  读数——浮层不收，重开那步的点击会失配而红）。

## 已知边界（如实登记）

- **IO 失败分支（D421）不在真机判**：需要制造「文件删不掉」的现场（权限/占用），合成环境
  下不可移植；该分支的文案映射由 `tests/unit` 的 error-text 完整性门禁与 copy 表钉住。
- **「删空收浮层」不在本场景**：活跃会话不可删 ⇒ 清单恒剩一行，造不出「删到空」的形状
  （先删 delone 再删 deltwo 会被拒删链卡住）。该分支只有一行 `if (sessList.childElementCount === 0)`，
  判据归视觉层 / 单测，本场景不判。
- **删除不做二次确认模态**：行内两步确认就是全部防线（× → 确认句 → 删除），没有第三个
  「你真的确定吗」——这是 M406 的既定交互，不是遗漏。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；删除只作用在验收环境的
  `env:harness/sessions/` 下（合成会话留存），真实 vault 与用户配置全程不碰。mock 只回文案、
  不写 vault。1420 全程不碰（实例走 `LUMIR_ACCEPTANCE_PORT=1430`）。
