---
# M398 追加（Alex 2026-10-09 下午裁决「修」）：backlog「不打开任何文件时 harness 发送直接失败：
# context_json 传了 null」的验收防线。该状态下 activeSession().path 为 undefined ⇒ 前端组不出
# 上下文块，修复前给 harness_send 传 null（后端参数 string）→ `invalid type: null, expected a
# string` 立刻报红。修复后无文档时传空串，后端 parse_context 走默认块（无上下文纯对话成立）。
id: "107-harness-send-no-doc"
item: 107
title: 无文件打开时 harness 发送成功：无上下文纯对话不发 error（context_json 恒为 string）
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: 启动落在「没有打开的文件」态（无 open:、无预置会话 ⇒ 一个标签都没恢复）
    do: waitFor
    waitFor:
      has: ["这个 vault 还没有打开的文件"]
    timeoutMs: 40000
    expect:
      - shot: 01-无文档态
      - label: 正文是空文档引导 D107——本场景的前置状态就是「没有打开的文件」
        ax: { has: "这个 vault 还没有打开的文件" }

  - name: ⌘⇧A 打开 harness pane（无文档也能开）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - shot: 02-pane
      - label: 分栏成立（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 上下文 chip 落在「无（未打开文件）」态（D333）——发送的前置条件就是无上下文
        ax: { has: "上下文：无（未打开文件）" }

  - name: 点 composer 建立输入焦点
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
    expect:
      - label: composer 是唯一获焦节点（打字落点的正观测——keys 的回读目标因此稳定在 composer，不盯错目标）
        ax: { focused: "AXTextArea" }

  - name: 输入提问（无文档的纯对话）
    do: keys
    keys: ["n", "o", "d", "o", "c"]
    expect:
      - label: 提问落在 composer 里（注入落地的正观测）
        ax: { has: "nodoc" }
  - name: 发送
    do: key
    key: enter

  - name: 等回答到达（修复前这一步永不成立——发送被后端参数反序列化拒掉）
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    timeoutMs: 30000
    expect:
      - label: 无文件打开也能收到回答（无上下文纯对话成立）
        ax: { has: "验收回答：上下文已收到。" }
      - label: 发送没有被拒（不发 D347 错误行）
        ax: { not: "/发送失败/" }
      - label: 提问回声在 transcript 里（回合真实发生）
        ax: { has: "nodoc" }
      - shot: 03-回答
---

# 107-harness-send-no-doc —— 无文档时 harness 发送的回归防线（M398 追加）

## 本场景在验什么

backlog「不打开任何文件时 harness 发送直接失败：`context_json` 传了 null」（tower 复现期实测）：
vault 里一个文件都没打开时——面板上下文行显示「上下文：无（未打开文件）」，UI 明示这是**合法状态**
——发消息立刻报红 `发送失败：invalid args 'context_json' for command 'harness_send': invalid type:
null, expected a string`。前端在无上下文时给 `harness_send` 传了 null，而后端参数是 string。

修复在前端（`src/harness-panel.ts` 传空串 + `src/ipc.ts` 收窄签名为 `string`）：无文档时传空串，
后端 `turn::parse_context` 对空串返回默认块（无上下文分支本就在），无文档纯对话因此成立。本场景是
那条「顺手加一条无文档发送的场景断言」——它独立于场景 106（那条在**有**文档时验恢复重建）。

## 断言口径

- **前置状态是构造出来的**（不是断言推出来的）：front-matter 不写 `open:`、也不预置会话 ⇒ 该 vault
  一个标签都没恢复，启动落在 D107「这个 vault 还没有打开的文件」的空文档态（`waitAppReady` 认这一
  形态，见套件 README 的「严格门」表）。这一状态在步骤里由 D107 正观测 + 步骤③的 D333 chip 两条
  可区分断言共同锁定。
- **chip D333**（`上下文：无（未打开文件）`）证明面板此刻确实是「无上下文」——修复的触发条件。
- **判据落在后果面**：`验收回答：上下文已收到。` 只在真正发出请求、mock 回包后出现；修复前发送被
  参数反序列化拒掉，这一步的 `waitFor` 必超时（区分度自证）。`not: "/发送失败/"`（D347 前缀）是对
  该 bug 症状的直读，与上面的正观测互为对偶。
- **为什么能对到 `harness_send` 的参数面**：m303 起面板发送走 `harnessSend`，无文档时
  `assembleHarnessContext` 返回 null ⇒ 修复前正是这条 call 传 null。

## 已知边界（如实登记）

- **不判「后端改 Option」的那条替代修法**：本 change 取的是前端侧修（传空串），后端
  `harness_send(context_json: String)` 签名不动；若将来改后端参数为 Option，本场景仍应绿（判据是
  行为后果，不是实现）。
- **键盘注入的既有风险不在本场景新增**：`keys` 走可回读 + 有限重试（README「已知边界」），整批丢
  键时会按错因报错——那是通道边界，复跑一次再判（REVIEW.md 第 11 条）。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；mock 只回文案、不写 vault。
- 1420 全程不碰（实例走 `LUMIR_ACCEPTANCE_PORT=1430`）。
