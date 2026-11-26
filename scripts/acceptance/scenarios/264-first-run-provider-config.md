---
id: "264-first-run-provider-config"
item: 264
tier: full
title: 首次安装：无 provider 与网络失败的错误行本地化（en 界面、不含内部 URL），以及添加 provider + 模型后保存重启恢复
open: harness-note.md
marker: "HNL-ALPHA"
config:
  # 首次安装 = 界面默认 en + 配置里一条 provider 都没有。M849 的缺陷正是在这个组合下暴露的：
  # 错误行直接渲染后端中文 message，网络失败还带内部端点。
  language: en
# 本场景判的就是「首启那一刻的默认状态」，因此不预置任何 provider / 会话。
steps:
  # ── 第一段：空配置下发送 ⇒ 无 provider 的错误行 ─────────────────────────────
  - name: ⌘⇧A 打开 Harness 面板（空配置的首次发送面）
    do: keys
    keys: ["cmd+shift+a"]
  - name: 等面板与空会话落定
    do: waitFor
    waitFor:
      has: ["Chat about the current document", "Ask something"]
    timeoutMs: 20000
    expect:
      - label: en 界面（正观测：面板说明句取 English 列，本场景后续的「不含中文」判据才有意义）
        ax: { has: "Chat about the current document" }
      - label: 发送钮在位
        ax: { has: "/AXButton \\(Send\\)/" }
      - shot: 01-空会话-en

  - name: 输入一条消息（此后发送会被 send_preflight 挡下）
    do: typeInNode
    # 非空输入框在 WKWebView 的 AX 里只剩 `= "值"`：目标名必须写「注入前与注入后都能命中」的交替正则。
    target: { role: AXTextArea, name: "Ask something|264-no-provider" }
    text: "264-no-provider"
  - name: Enter 发送
    do: key
    key: enter

  - name: 等错误行上屏
    do: waitFor
    waitFor:
      has: ["/Send failed/"]
    timeoutMs: 20000
    expect:
      - label: 错误行是**英文**整句，并给出可行动方向（指向设置面板）
        ax: { has: "/Send failed: No provider is available yet: add one in the settings panel/" }
      - label: '后端中文原文一个字都不上屏（M849 现场：`Send failed: 还没有可用的 provider：…`）'
        ax: { not: "还没有可用的 provider" }
      - label: 不把 config.json 的内部路径当引导话术
        ax: { not: "config.json" }
      - shot: 02-无provider-错误行-en

  # ── 第二段：设置面板添加 provider + 模型，保存并重启恢复 ────────────────────
  - name: 收起 Harness 面板（让会话按「面板收起」落盘，重启后 ⌘⇧A 的状态才是确定的）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板收起后 composer 不再在场（占位句从 AX 里消失——正观测见上一条把面板打开时的判据）
        ax: { not: "Ask something" }

  - name: ⌘,（与菜单「Settings…」走同一条命令）
    do: keys
    keys: ["cmd+,"]
  - name: 等设置面板落到空态
    do: waitFor
    waitFor:
      has: ["Model access and automation · Config file", "No providers yet"]
    timeoutMs: 20000
    expect:
      - label: 首次安装的空态标题
        ax: { has: "No providers yet" }
      - label: 空态主按钮 = 首次添加入口
        ax: { has: "Add the first provider" }
      - shot: 03-设置空态-en

  - name: 展开添加表单
    do: click
    target: { name: "^\\+ Add provider$" }
    expect:
      - label: id 输入在位
        ax: { has: "AXTextField (Provider id)" }
      - label: 三档预设组在位
        ax: { has: "Provider presets" }

  - name: 填 id
    do: typeInNode
    target: { role: AXTextField, name: "Provider id|local-lab" }
    text: "local-lab"

  - name: 选 OpenAI 兼容预设（本场景要一个能指向 localhost 的 provider）
    do: click
    target: { name: "^OpenAI-compatible" }

  - name: 确认添加（草稿动作）
    do: click
    target: { name: "^Add$" }
    expect:
      - label: 右列进入编辑表单
        ax: { has: "API key" }
      - label: 列表出现该行（id）
        ax: { has: "local-lab" }
      - label: 列表出现该行（预设名，两档语言同一技术名）
        ax: { has: "OpenAI-compatible" }
      - label: 尚缺 Base URL（generic 预设的前置条件，状态行给出缺口）
        ax: { has: "Missing base URL" }

  - name: 展开「高级 · 预设 / Base URL / Wire 方言」段（Base URL 输入在折叠段内）
    do: click
    target: { name: "^▸ Advanced · preset / base URL / wire API$" }
    expect:
      # WKWebView 不把 input 的 placeholder 暴露进 AX（现场实测：占位句读不到），因此判据
      # 落在**字段的可访问名**上——它来自 label（D757「Base URL」）。
      - label: 展开后 Base URL 输入在位
        ax: { has: "AXTextField (Base URL)" }

  - name: 填 Base URL——指向本机 9 端口（connection refused，不发任何外部请求）
    do: typeInNode
    target: { role: AXTextField, name: "Base URL|Required, for example|127\\.0\\.0\\.1:9" }
    text: "http://127.0.0.1:9/v1"

  - name: 添加一个模型行
    do: click
    target: { name: "^\\+ Add model$" }
    expect:
      - label: 模型行出现
        ax: { has: "AXTextField (Model id in row 1)" }

  - name: 填模型 id
    do: typeInNode
    target: { role: AXTextField, name: "Model id in row 1|local-model" }
    text: "local-model"

  - name: 保存
    do: click
    target: { name: "^Save$" }
    expect:
      - label: 保存成功（状态行）
        ax: { has: /Saved/ }
      - label: 文件落盘：条目带 generic preset
        file: { path: "env:config.json", has: '"preset": "generic"' }
      - label: 文件落盘：Base URL（本机回环地址）
        file: { path: "env:config.json", has: '"base_url": "http://127.0.0.1:9/v1"' }
      - label: 文件落盘：模型清单
        file: { path: "env:config.json", has: '"local-model"' }
      - label: 文件落盘：它成为当前使用的 provider
        file: { path: "env:config.json", has: '"provider": "local-lab"' }
      - shot: 04-已添加并保存-en

  - name: 重启（验「保存后重启恢复」）
    do: restart

  - name: 重启后 ⌘, 再开设置
    do: keys
    keys: ["cmd+,"]
  - name: 等面板读到已保存的条目
    do: waitFor
    waitFor:
      has: ["local-lab", "local-model"]
    timeoutMs: 20000
    expect:
      - label: provider 行仍在（重启后恢复）
        ax: { has: "/local-lab/" }
      - label: 它是当前使用项
        ax: { has: "Current" }
      - shot: 05-重启后恢复-en

  - name: 关闭设置（面板右上角 ×，与 Escape 同一条 requestClose）
    do: click
    target: { name: "^Close settings \\(Escape\\)$" }
    expect:
      - label: 设置面板已关闭（设置分组不在 AX 里）
        ax: { not: "AXGroup (Settings)" }

  # ── 第三段：网络失败 ⇒ 错误行不含内部 URL / 原始技术串 ─────────────────────
  - name: ⌘⇧A 打开 Harness 面板
    do: keys
    keys: ["cmd+shift+a"]
  - name: 等面板与发送钮落定
    do: waitFor
    waitFor:
      # composer 里已有**上一轮未清掉的草稿**（发送失败不消费草稿），因此占位句不在——
      # 就绪判据取发送钮，不取占位名。
      has: ["/AXButton \\(Send\\)/"]
    timeoutMs: 20000
    expect:
      - label: 重启后草稿仍在输入区（草稿恢复的正观测）
        ax: { has: "264-no-provider" }

  - name: Enter 发送（这一次 provider 齐备，失败发生在网络层）
    do: key
    key: enter

  - name: 等网络失败的错误行上屏
    do: waitFor
    waitFor:
      has: ["/Failed to send the LLM request/"]
    timeoutMs: 30000
    expect:
      - label: 英文整句（D355 的 English 列）
        ax: { has: "/Failed to send the LLM request: check the network connection and the provider's settings/" }
      # 负向判据落在**静态文本节点**上，不用 `ax.not "127.0.0.1"`：真机 AX 的 web area
      # 首行恒是 `AXWebArea (Lumir) URL: http://127.0.0.1:1430/`（dev server 地址），
      # 整树子串判据会永远命中它、恒红且与被测行为无关（REVIEW.md「断言等价于子串」条）。
      - label: 错误行是唯一提到失败的那条静态文本（正观测：上面已逐字命中整句）
        node: { role: AXStaticText, name: "Failed to send the LLM request", present: true }
      - label: 没有任何静态文本节点含内部端点（M849 现场：url (http://127.0.0.1:9/v1/chat/completions)）
        node: { role: AXStaticText, name: "127\\.0\\.0\\.1:9", present: false }
      - label: 不含 reqwest 原始技术串
        ax: { not: "error sending request" }
      - label: 后端中文原文不上屏
        ax: { not: "LLM 请求发送失败" }
      - shot: 06-网络失败-错误行-en
---

# 264-first-run-provider-config —— 首次安装的错误上屏与 provider 引导（M852）

## 本场景在验什么

M849（首次安装验证）在真机上撞到的两条缺陷，都只在**真栈**里才完整：

1. **错误行绕过文案表**：流式 `error` 事件与本地发送失败都把后端 `message` 直接上屏，en 界面
   于是出现中文原文；`harness_network_failed` 的 `params.reason` 还是 reqwest 的 Display
   （`error sending request for url (http://127.0.0.1:9/v1/chat/completions)`），内部端点与
   原始技术串一起露给用户。
2. **首次安装的 provider 引导**：空配置下错误行必须指向设置面板，并且「添加 provider + 模型 →
   保存 → 重启恢复」这条链真的走得通。

M852 的修法是把三处错误上屏统一到 `errorText`（`ERROR_COPY` 单一映射），并把 D355 的
`{reason}` 占位去掉（后端给不出可上屏的 reason）。本场景判的就是这条链在真机 WKWebView 里的
**上屏结果**：英文整句、可行动、不含内部 URL / 原始技术串、不含后端中文原文。

## 断言口径

- **每条负向断言都配正观测**（REVIEW.md「断言等价于子串」条）：先判 en 说明句、错误行英文
  整句确实上屏，再判「不含中文 / 不含 127.0.0.1 / 不含 error sending request」。否则负向断言
  在「什么都读不到」时同样成立。
- **负向判据用 AX 全文子串**：`ax.not` 匹配整棵 AX 文本树，正文/标签里出现同串即判红——本场景
  fixture 正文（`HNL-ALPHA`）不含这些串，判据有区分度。
- `typeInNode` 的 `target.name` 一律写成「注入前占位名 | 注入后值」的交替正则（README
  「真机 AX 读不到非空值输入框的读屏名」条）——非空输入框在 AX 里只剩 `= "值"`。
- 重启前先 ⌘⇧A 收起面板：会话按 `harness_pane: false` 落盘，重启后 ⌘⇧A 的语义才是确定的
  「打开」，不依赖「面板是否被会话恢复」。

## 已知边界（如实登记）

- **不发任何外部请求**：Base URL 指向 `http://127.0.0.1:9/v1`（本机保留端口，connection
  refused）——网络失败是真实网络栈的失败，不是 mock。
- **模型成功回复不验**：没有真实 API Key，也不发外网请求。本场景只到「provider 配好、重启后
  仍是当前项」；真实模型回包不在本场景范围。
- **`window` / `effort` / `vision` 三个模型字段不填**：保存时按默认值显式写入（D748），
  它们的读写归设置面板场景 250 与配置面单测。
- **gatekeeper / DMG 安装**不在本场景：那属发布流程（M849 的 finding 1）。
