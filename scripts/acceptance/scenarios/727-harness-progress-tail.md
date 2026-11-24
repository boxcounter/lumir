---
id: "727-harness-progress-tail"
item: 727
tier: full
title: 输出尾行：状态矩阵 / 工具先行 / 待批 / 停止 / 跨 vault 接管 / 空态与自动回合 detached
open: harness-note.md
marker: "HNL-ALPHA"
seed:
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-progress-tail.json"
    permission_mode: read_only
    permissions:
      allow: ["cli_run(sleep *)"]
steps:
  - name: 写入合成后台 agent 定义
    do: vaultWrite
    file: ".lumir/agents/research.md"
    content: |
      ---
      name: research
      description: 合成通用样本
      ---

  - name: ⌘⇧A 打开 harness pane，记录 idle 空态
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 空态提示在场，尾行尚未产生任何阶段文案
        ax: { has: "与当前文档对话——发送时会携带上方显示的上下文，发送前可核对。" }
      - label: 空闲态发送钮在场
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: idle 不显示等待 / 生成 / 接管 / 停止阶段行
        ax: { not: "/等待响应…|正在生成回复…|正在继续本轮…|正在停止…/" }
      - shot: 00-idle-空态

  - name: 发起后台父回合，建立可滚 transcript
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|ptail-auto" }
    text: "ptail-auto"
  - name: 发送
    do: key
    key: enter
  - name: 等父回合长回答完成
    do: waitFor
    waitFor:
      has: ["PT-AUTO-PARENT-END 父回合完成。"]
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 30000
    expect:
      - label: 可滚内容已经落地（后续 detached 的正观测前提）
        ax: { has: "PT-AUTO-PARENT-END 父回合完成。" }
      - label: 终态后阶段行已离场
        ax: { not: "正在生成回复…" }
      - shot: 01-父回合终态

  - name: 自动回合前上滚进入 detached
    do: scroll
    target: { x: 900, y: 350 }
    dy: 20
    wheel: true
    settleMs: 900
    expect:
      - label: 回底钮证明 detached 已成立
        node: { role: AXButton, name: "回到底部", present: true }
      - shot: 02-自动回合前-detached

  - name: 等后台唤醒自动回合（等待尾行在文档流末尾；通知本身的未读不归尾行）
    do: waitFor
    waitFor:
      has: ["等待响应…"]
    timeoutMs: 30000
    expect:
      - label: 自动回合与普通发送同从等待档开始
        ax: { has: "等待响应…" }
      - label: 自动回合不强制回底，detached 浮钮仍在
        node: { role: AXButton, name: "回到底部", present: true }
      - shot: 03-自动回合-detached-等待

  - name: 等自动回合产出并收口
    do: waitFor
    waitFor:
      has: ["PT-AUTO-END 自动回合正文完成。"]
      not: ["等待响应…"]
    timeoutMs: 30000
    expect:
      - label: 自动回合正文在场
        ax: { has: "PT-AUTO-END 自动回合正文完成。" }
      - label: 自动回合结束后尾行离场
        ax: { not: "正在生成回复…" }
      - shot: 04-自动回合终态

  - name: 工具先行轮次：延迟首个产出，先看等待档
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|ptail-tool" }
    text: "ptail-tool"
  - name: 发送
    do: key
    key: enter
  - name: 等工具调用到达并停在后续正文分片间隔（工具已产出、响应未终态）
    do: waitFor
    waitFor:
      has: ["vault_read", "PT-TOOL-STREAM-A 工具结果已返回，后续正文仍在生成。"]
      not: ["PT-TOOL-END 工具先行轮次完成。"]
    timeoutMs: 20000
    expect:
      - label: 首个有效产出是工具时也离开等待，读生成档（此时 PT-TOOL-END 尚未到达）
        ax: { has: "正在生成回复…", not: "PT-TOOL-END 工具先行轮次完成。" }
      - label: 不停在旧实现的等待档
        ax: { not: "等待响应…" }
      - label: 工具细节由工具行承担
        ax: { has: "vault_read" }
      - label: 停止钮证明轮次仍在途
        node: { role: AXButton, name: "^停止$", present: true }
      - shot: 05-工具先行-生成档

  - name: 等工具轮次终态
    do: waitFor
    waitFor:
      has: ["PT-TOOL-END 工具先行轮次完成。"]
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 20000
    expect:
      - label: 工具循环没有第三档工具文案，终态尾行隐藏
        ax: { not: "正在生成回复…" }
      - shot: 06-工具轮次终态

  - name: 发起需要批准的写工具
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|ptail-approval" }
    text: "ptail-approval"
  - name: 发送
    do: key
    key: enter
  - name: 等批准卡与待批尾行
    do: waitFor
    waitFor:
      has: ["要修改这个文件吗？", "等待批准…"]
    timeoutMs: 20000
    expect:
      - label: 待批压过普通生成档
        ax: { has: "等待批准…" }
      - label: 滚动区外标题栏审批信号仍在
        ax: { has: "等待批准" }
      - shot: 07-待批尾行与标题栏信号

  - name: 采纳并等终态清算
    do: click
    target: { role: AXButton, name: "^采纳$" }
  - name: 等批准后的回答
    do: waitFor
    waitFor:
      has: ["PT-APPROVAL-END 批准后的轮次完成。"]
      not: ["等待批准…"]
    timeoutMs: 20000
    expect:
      - label: 待批已清算，尾行随终态离场
        ax: { not: "等待批准…" }
      - shot: 08-批准后终态

  - name: 发起流式停止轮次
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|ptail-stop" }
    text: "ptail-stop"
  - name: 发送
    do: key
    key: enter
  - name: 等第一片正文与生成档
    do: waitFor
    waitFor:
      has: ["PT-STOP-A 第一片已到达。", "正在生成回复…"]
    timeoutMs: 20000
  - name: 点击停止并记录 stopping 冻结帧
    do: click
    target: { role: AXButton, name: "^停止$" }
    expect:
      - label: stopping 优先于其他文案
        ax: { has: "正在停止…" }
      - shot: 09-stopping-条形冻结

  - name: 等 aborted 收口
    do: waitFor
    waitFor:
      has: ["已停止"]
      not: ["正在停止…"]
    timeoutMs: 30000
    expect:
      - label: 已停止标记在场，尾行先离场
        ax: { has: "已停止", not: "正在停止…" }
      - label: 已产出第一片保留
        ax: { has: "PT-STOP-A 第一片已到达。" }
      - label: 未产出的第二片没有复活
        ax: { not: "PT-STOP-B" }
      - shot: 10-aborted-终态

  - name: 发起跨 vault 接管轮次
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|ptail-takeover" }
    text: "ptail-takeover"
  - name: 发送
    do: key
    key: enter
  - name: 等第一片后收起面板
    do: waitFor
    waitFor:
      has: ["PT-TAKEOVER-A 切走前的第一片。"]
    timeoutMs: 20000
  - name: 收起面板
    do: keys
    keys: ["cmd+shift+a"]

  - name: 切到 vault B
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 点 B 行
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }
  - name: 等 B 装载
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000

  - name: 切回 vault A
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 点 A 行
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance(?!-b)/" }
  - name: 等 A 装载（在途快照接管）
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance（点击查看全部 vault）", "处理中"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000
  - name: 重新打开面板，检查中途接管文案
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 接管不闪等待，读 D983
        ax: { has: "正在继续本轮…" }
      - label: 无待批时不得读等待批准或等待响应
        ax: { not: "/等待批准…|等待响应…/" }
      - label: 接管时仍是停止钮而不是假空闲
        ax: { has: "/AXButton \\(停止\\)/" }
      - shot: 11-中途接管-D983

  - name: 等接管轮次完成
    do: waitFor
    waitFor:
      has: ["PT-TAKEOVER-C 接管后的最后一片。"]
      not: ["/AXButton \\(停止\\)/"]
    timeoutMs: 60000
    expect:
      - label: 接管后续分片与终态正常，尾行离场
        ax: { has: "PT-TAKEOVER-C 接管后的最后一片。", not: "正在继续本轮…" }
      - label: 历史对账后回到 idle 发送态
        ax: { has: "/AXButton \\(发送\\)/" }
      - shot: 12-接管终态-idle
---

# 727-harness-progress-tail —— 真机输出尾行

本场景只使用合成 vault、合成后台任务与 mock fixture。它按真实 WKWebView 用户路径串行覆盖：
idle 空态 → 自动回合 detached → 工具先行 → 待批 → stopping / aborted → 跨 vault 中途接管 → idle。
浏览器层 m347 / m638 / m756 另守 DOM 末位、4px 净间距、空态中心、停止计算样式和 scrollTop；
真机 AX 不提供这些 DOM / 几何读数，因此这里以 AX 文案、按钮在场性与截图证据分工，不伪造断言。

自动回合前的后台完成通知本身属于真实新内容，可能合法点亮未读；本场景不把那枚未读误记成尾行缺陷。
「尾行显隐自身不假未读」的严格反例由 m638 与 `harness-scroll-lock` 纯模型测试承担。

未在本 worker 内启动真机；本场景需由主会话串行执行并复核 `.local/acceptance/` 的实际 PASS 与截图。
