---
id: "111-harness-vault-move-delete"
item: 111
tier: full
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

  - name: 抢前台（后台注入键盘整批丢键/错键会显著加剧——REVIEW.md 「键盘注入丢键」条）
    do: focusWindow
    retries: 4

  - name: 输入提问并 Enter 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|move" }
    text: "move"
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
      # 工具结果在留存里是**字符串化 JSON**（M783 的口径见 scripts/acceptance/README.md 的 `file` 行）：
      # 按解析后的字段判（`jsonlOutput`），不写字节层的转义。改道的载荷（含 `suggested_tool`）在
      # ToolOutput 里是**嵌在 `message` 字符串中的 JSON 文本**、不是嵌套对象，而 `jsonlOutput` 的字段
      # 判据是深度相等、不下探字符串 ⇒ 载荷与固定标记整段逐字钉在 `message` 上（旧的
      # `/suggested_tool.{0,12}vault_move/` 只证明这两个串在文件里相隔不超过 12 字符：既不限定工具、
      # 也不限定同一条结果，`vault_movex` 之类同样命中）。**mv 的写目标是两侧各一个**
      # （源 `harness-note.md` 被移除、目标 `harness-renamed.md` 被写入），故载荷的 `targets` 是两项、
      # 人话说明里按 `、` 并列——M784 真机首跑按单目标写判红，读数即此。
      - label: JSONL 里那条 cli_run 结果是改道（同一结果对象：ok=false + 改道错误码）
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: cli_run
            has: { ok: false, code: cli_redirected_to_vault_tool }
      - label: 回送模型的那条 message 逐字 = 人话说明 + 固定标记 + 载荷（targets 两侧、suggested_tool = vault_move）
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: cli_run
            has:
              message: |-
                写目标在 vault 内（harness-note.md、harness-renamed.md），已被闸门改道：请改用 vault 工具完成 vault 内写操作，不要经 cli_run 写 vault。可用工具：vault_patch（局部替换）/ vault_create（新建，自动建父目录）/ vault_move（移动 / 重命名）/ vault_delete（删除）。建议改用 vault_move。
                <<<LUMIR_REDIRECT_VAULT_TOOL>>>
                {"reason":"write_target_in_vault","targets":["harness-note.md","harness-renamed.md"],"suggested_tool":"vault_move"}
                <<<END_LUMIR_REDIRECT_VAULT_TOOL>>>
      - label: vault_move 执行成功——新路径在场
        file: { path: harness-renamed.md, exists: true }
      - label: vault_move 执行成功——原路径已不在
        file: { path: harness-note.md, exists: false }
      - label: mv 没有真的跑（cli_run 被拒后源文件不存在被删/改写）
        file: { path: harness-renamed.md, has: "HNL-ALPHA" }
      - label: vault_move 行内参数 = 「源 → 目标」路径对（M414 的面板呈现；此刻批准卡还没批、
          整轮未收尾，工具行是行内展开的，不必点折叠摘要钮）
        # 路径对同样按钮化（change add-path-line-range-links）：源是 `AXButton (harness-note.md)`
        # 节点，目标落在紧随其后的 `→ harness-renamed.md` 文本里——旧的同段相邻串断言恒红
        # （M743，M745 修）。窗口 200 字符见正文「断言口径」。
        ax: { has: '/AXButton \(harness-note\.md\)[\s\S]{0,200}?→ harness-renamed\.md/' }
      - shot: 01-改道链与-vault_move

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
      - shot: 04-删除收尾

  - name: 回看这一轮的调用行（本 fixture 每段响应一个工具调用 ⇒ 每块 1 行、不折叠，行始终行内可见）
    expect:
      - label: 已采纳终态行在场（D405）
        ax: { has: "已采纳" }
      - label: cli_run 行保留改道失败尾注
        ax: { has: "/cli_redirected_to_vault_tool/" }
      - label: vault_move 行内参数 = 「源 → 目标」路径对（M414 的面板呈现）
        ax: { has: '/AXButton \(harness-note\.md\)[\s\S]{0,200}?→ harness-renamed\.md/' }
      - shot: 05-工具行-路径对
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
  与 JSONL 留存的固定标记载荷（`LUMIR_REDIRECT_VAULT_TOOL` + `suggested_tool` 的值 = `vault_move`）。
  两者一起才能证明「改道发生了，且模型拿到了建议工具」。
  **JSONL 侧按解析后的字段判（M784）**：工具结果在留存里是字符串化 JSON（`function_call_output.output`，
  两层编码，见 `scripts/acceptance/README.md` 的 `file` 行），字节层的引号是 `\\\"`；断言走
  `file.jsonlOutput`、限定 `tool: cli_run`，落在**同一条结果对象**上（`ok=false` + 改道错误码）。
  **载荷够不到字段层**：`jsonlOutput` 只解析两层——`suggested_tool` 的 JSON 是**嵌在 `message` 字符串里
  的文本**（`Redirect::message` 把人话说明 + 固定标记 + 载荷拼成一个字符串），深度相等的字段判据不下探
  字符串 ⇒ 判据改为**逐字钉整条 `message`**（人话说明 + 两个固定标记 + 载荷，`suggested_tool` / `targets`
  / `reason` 三个字段值随之一并钉住），比旧的 `/suggested_tool.{0,12}vault_move/` 强：旧写法只证明这两
  个串在文件里相隔不超过 12 字符，既不限定工具、也不限定同一条结果，`vault_movex` 之类同样命中。
  代价是 `Redirect::message` 的措辞改动会让本场景判红——那是**模型可见的契约文案**，红是提醒同步场景，
  不是产品回归。历史（不变）：首跑用 `/"suggested_tool":"vault_move"/` 判红是断言口径错（转义层），
  不是产品缺陷。
- **`mv` 的写目标是两侧各一个**：`write_targets` 把 `mv` 的源与目标都算作被写的一侧（源被移除、目标
  被写入），故载荷是 `targets: ["harness-note.md", "harness-renamed.md"]`、人话说明里按 `、` 并列。
  M784 迁移时先按「只有目标」写过期望值，真机首跑判红——红因是期望值写错了产品事实，不是产品缺陷
  （同一形态的教训见下方「工具行断言」条的 M743 现场）。
- **「mv 没有真的跑」的正观测是文件仍在**：`harness-renamed.md` 在场且含 `HNL-ALPHA`（vault_move
  是 rename 语义，内容逐字节随行）；`harness-note.md` 已不在（被移动而非复制）。
- **工具行的断言全在行内时点取**（首跑实证的时序）：折叠（一行摘要钮）只在**同一块 ≥2 行**时发生
  （`collapseBlock` 的 `rows.length < 2` 直接返回），而本 change 的 fixture 每段响应只发一个工具
  调用 ⇒ 每块 1 行、整轮**不折叠**，工具行始终行内可见。首跑把这里写成「先点折叠摘要钮」是照抄
  了场景 75 的形态（那条 fixture 在同一响应里发两个 cli_run，才凑出 2 行并折叠）——判红是场景
  写错，不是产品缺陷。批准卡挂起期间同样不折叠（folding 只发生在轮次终态 / 新用户消息时），
  故路径对在卡挂着时就能读到。
- **工具行的路径是可点按钮（M745）**：change `add-path-line-range-links` 把工具参数里的路径渲染成
  `AXButton (…)` 节点。本场景的「源 → 目标」因此横跨两个节点：源是 `AXButton (harness-note.md)`、
  目标落在紧随其后的 `AXStaticText = "→ harness-renamed.md …"` 里，旧的同段相邻串
  `/harness-note\.md → harness-renamed\.md/` 恒不命中（M743 全量跑 111 恒红即此）。判据改为
  `/AXButton \(harness-note\.md\)[\s\S]{0,200}?→ harness-renamed\.md/`——上界 200 只容 2–3 个
  节点行（M743 现场实测间距 94 字符，含 bbox 与 actions 字段），既吸收索引位数 / 几何读数变化，
  又不会跨到无关区域；反向自证（改回纯文本形态必红）见场景 103 的「断言口径」同条。
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
