---
id: "875-harness-markdown-bold"
item: 875
tier: full
title: Harness Markdown strong：有序列表空行后的缩进续段在流式中间态与终态均不显示字面星号
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-markdown-bold.json"
steps:
  - name: ⌘⇧A 打开 Harness pane
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: Harness 以旁侧 pane 出现
        ax: { has: "分隔条" }
      - label: 空闲发送钮在场
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入合成提问并发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|bold875" }
    text: "bold875"
    expect:
      - label: 提问落在 composer
        ax: { has: "bold875" }
  - name: 发送
    do: key
    key: enter

  - name: 第一片：第 5 项缩进续段处于流式中间态
    do: waitFor
    waitFor:
      has: ["第五项续段粗体"]
    timeoutMs: 30000
    expect:
      - label: 普通段落 strong 的可见文本在场
        ax: { has: "段落粗体" }
      - label: 第 5 项续段文本在场
        ax: { has: "第五项续段粗体" }
      - label: 第 5 项续段不显示字面 strong delimiter
        ax: { not: "**第五项续段粗体**" }
      - label: 普通段落同样不显示字面 strong delimiter
        ax: { not: "**段落粗体**" }
      - shot: 01-第五项流式中间态

  - name: 第二片：第 5 与第 7 项同时可见，续段都保持 strong
    do: waitFor
    waitFor:
      has: ["第七项续段粗体"]
    timeoutMs: 30000
    expect:
      - label: 第 5 项续段仍在场
        ax: { has: "第五项续段粗体" }
      - label: 第 7 项续段在场
        ax: { has: "第七项续段粗体" }
      - label: 第 5 项无字面星号
        ax: { not: "**第五项续段粗体**" }
      - label: 第 7 项无字面星号
        ax: { not: "**第七项续段粗体**" }
      - shot: 02-第五与第七项中间态

  - name: 第三片与终态：后续顶层段到达后 strong 语义收敛
    do: waitFor
    waitFor:
      has: ["末段粗体", "/AXButton \\(发送\\)/"]
    timeoutMs: 30000
    expect:
      - label: 末段 strong 文本在场
        ax: { has: "末段粗体" }
      - label: 第 5 项终态无字面星号
        ax: { not: "**第五项续段粗体**" }
      - label: 第 7 项终态无字面星号
        ax: { not: "**第七项续段粗体**" }
      - label: 末段无字面星号
        ax: { not: "**末段粗体**" }
      - label: 本轮结束回空闲发送态
        ax: { has: "/AXButton \\(发送\\)/" }
      - shot: 03-终态收敛
---

# 875-harness-markdown-bold —— 流式列表续段 strong

Alex 2026-11-25 报告同一条 Harness 消息里普通段落 strong 正常，部分有序列表项显示字面 `**`。
本场景只用合成中文 fixture 复现同类块级条件，不读取或记录真实会话正文。

mock 三片之间各隔 5 秒：第一片在第 5 项空行后的四空格续段结束，第二片加入第 7 项同形续段，
第三片才加入后续顶层段。旧 `finalizedUpTo` 在空行切断列表上下文，续段被独立解析为缩进代码块；
第二片时第 5 项位于已错误的定稿片段、第 7 项位于尾块，因此两条负向断言能同时抓住旧实现。

AX 的正向文本与负向 delimiter 断言负责真机可见语义；`<strong>` 元素、嵌套范围、代码/链接/转义反例
和计算字重由 `tests/unit/harness-transcript-render.test.ts` 与
`tests/visual/scenes/harness-markdown-bold-nov25.spec.ts` 判定。截图只作人工排版复核，不断言像素基线。

环境为合成 vault 与隔离配置目录；不写 vault，不访问真实配置。后续执行命令：

```bash
node scripts/acceptance/run.mjs 875
```
