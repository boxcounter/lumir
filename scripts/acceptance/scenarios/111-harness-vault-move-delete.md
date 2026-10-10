---
id: "111-harness-vault-move-delete"
item: 111
title: vault 写重定向链 + vault_move / vault_delete 的面板呈现与批准卡（M414 验收面，mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-vault-move-redirect.json"
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

  - name: 输入提问并 Enter 发送
    do: keys
    keys: ["m", "o", "v", "e"]
  - name: 发送
    do: key
    key: enter

  - name: 等改名链跑完（cli_run mv 被改道 → 模型改用 vault_move → 后者自动放行）
    do: waitFor
    waitFor:
      has: ["改名完成，接着把它移进废纸篓。"]
    timeoutMs: 40000
    expect:
      - label: cli_run 没执行而是被改道（错误码 cli_redirected_to_vault_tool 是改道的固定标记）
        ax: { has: "/cli_redirected_to_vault_tool/" }
      - label: JSONL 记下固定标记载荷（模型据此改工具的唯一线索）
        file: { path: "env:harness/sessions/*.jsonl", has: "/LUMIR_REDIRECT_VAULT_TOOL/" }
      - label: 改道建议落到 vault_move
        file: { path: "env:harness/sessions/*.jsonl", has: "/\"suggested_tool\":\"vault_move\"/" }
      - label: vault_move 执行成功——新路径在场
        file: { path: harness-renamed.md, exists: true }
      - label: vault_move 执行成功——原路径已不在
        file: { path: harness-note.md, exists: false }
      - label: mv 没有真的跑（cli_run 被拒后源文件不存在被删/改写）
        file: { path: harness-renamed.md, has: "HNL-ALPHA" }
      - shot: 01-改道链与-vault_move

  - name: 展开工具清单（≥2 行的轮次终态折叠为一行摘要钮，步骤行 hidden 不进 AX）
    do: click
    target: { role: AXButton, name: "个工具调用" }
    expect:
      - label: vault_move 行内参数 = 「源 → 目标」路径对（M414 的面板呈现）
        ax: { has: "/harness-note\\.md → harness-renamed\\.md/" }
      - label: cli_run 行保留改道失败尾注
        ax: { has: "/cli_redirected_to_vault_tool/" }
      - shot: 02-工具行-路径对

  - name: 等 vault_delete 的批准卡（vault_write 档下删除逐个问）
    do: waitFor
    waitFor:
      has: ["要执行这次 vault_delete 调用吗？"]
    timeoutMs: 30000
    expect:
      - label: 批准卡在场（回落问句 D415，M406 起按工具名分发）
        ax: { has: "要执行这次 vault_delete 调用吗？" }
      - label: 卡上是待删路径（vault_delete 的批准预览 = 路径）
        ax: { has: "harness-renamed.md" }
      - label: 后果说明在卡上（D435：移入废纸篓、可恢复——design §5.1 的面板半边）
        ax: { has: "将移入系统废纸篓，可恢复" }
      - label: 次级动作统一在场（D434）
        ax: { has: "采纳且本会话不再问" }
      - shot: 03-vault_delete-批准卡

  - name: 采纳删除（进系统废纸篓）
    do: click
    target: { role: AXButton, name: "^采纳$" }

  - name: 等删除收尾
    do: waitFor
    waitFor:
      has: ["删除请求已发出。"]
    timeoutMs: 30000
    expect:
      - label: 文件已从 vault 移走（进废纸篓，不是原地留下）
        file: { path: harness-renamed.md, exists: false }
      - label: 已采纳终态行在场（D405）
        ax: { has: "已采纳" }
      - shot: 04-删除已采纳
---

# 111-harness-vault-move-delete —— 改道链与两件 vault 工具的面板呈现

## 本场景在验什么

change `add-harness-permission-modes` 的验收面（tasks 6.7 的后两条）：**重定向链**与
**vault_move / vault_delete 的面板呈现**。三件产物的分工：

1. **重定向（design §4）**：`cli_run("mv", "harness-note.md", "harness-renamed.md")` 被分类为写、
   写目标解析进 vault ⇒ 闸门**改道**（错误码 `cli_redirected_to_vault_tool` + 固定标记
   `<<<LUMIR_REDIRECT_VAULT_TOOL>>>` 包裹的 JSON 载荷，含 `suggested_tool`）。闸门**不做自动
   翻译**——模型读到标记后自己改调 `vault_move`（§4.3）。
2. **vault_move 的面板呈现（M414）**：`vault_write` 档下 vault 写工具自动放行，工具行的行内参数
   = 「源 → 目标」路径对（`src/harness-panel.ts` 的 `keyArgOf`）。
3. **vault_delete 的批准卡（design §5.1）**：`vault_write` 档下删除**逐个问**（裁决点 1 的落 B），
   卡上 = 待删路径（批准预览的 argv）+ 一句后果说明「将移入系统废纸篓，可恢复」（D435，后端
   `approval_preview` 只给路径，这句按 design 的口径归面板侧）。工具底层只有 `trash_entry`——
   永久删除路径不存在。

## 断言口径与已知边界

- **改道的两条证据**：错误码进模型可见的工具结果（面板工具行的失败尾注含 `cli_redirected_to_vault_tool`）
  与 JSONL 留存的固定标记载荷（`LUMIR_REDIRECT_VAULT_TOOL` + `"suggested_tool":"vault_move"`）。
  两者一起才能证明「改道发生了，且模型拿到了建议工具」。
- **「mv 没有真的跑」的正观测是文件仍在**：`harness-renamed.md` 在场且含 `HNL-ALPHA`（vault_move
  是 rename 语义，内容逐字节随行）；`harness-note.md` 已不在（被移动而非复制）。
- **工具清单可能折叠**：≥2 行的轮次终态折叠成一行摘要钮（M351 的 D387），步骤行 `hidden` 不进 AX
  ——工具行断言前先点开摘要钮（与场景 75 同口径）。钮名按「个工具调用」锚（计数随轮次变，不写死）。
- **`vault_delete` 的批准问句取回落句 D415**：M406 只给 vault_patch / vault_create / cli_run 三句
  专句，vault_move / vault_delete 落回落句（工具名进问句）。
- **删除的终态判据是「文件不在 vault 里」**：底层走系统废纸篓，套件读不到废纸篓内容，因此只断言
  vault 内不再有它（可恢复性由 core 侧单测钉 `trash_entry` 语义，不在真机重复）。

## 环境与副作用

- 场景改动了验收 vault：`harness-note.md` → `harness-renamed.md`（vault_move）⇒ 移入系统废纸篓
  （vault_delete）。验收 vault 每场景由 runner 从 fixtures 重建（`resetVault`），不污染后续场景；
  副作用只落在用户的系统废纸篓里一条合成笔记（可手工清空）。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；真实 vault 与 `~/.config/lumir`
  全程不读写；1420 不碰。
