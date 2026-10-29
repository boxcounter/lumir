---
id: "254-harness-vault-workspace-list"
item: 254
tier: full
title: harness 工作区与 vault_list：system 绝对根 / cli_run cwd / 列表到读取链路（mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
# 判据全部落在会话留存（`session_open.system` / `assembly` / 工具输出）与 AX 树上：
# - 工作区段在场且含 vault 绝对根（system 层）；
# - `vault_list` 真执行：递归层级的 sibling 文件出现在结果里，hidden 档不出现、lazy 子树不展开；
# - `vault_read` 读到列表里看到的 sibling（列表 → 读取链路）；
# - `cli_run("pwd")` 不再返回 `/`，`cli_run("cat", ["wsl-vault/keep.md"])` 用相对路径读到 vault 内
#   文件（子进程 cwd 就是当前 vault 的强证据，且与路径拼写无关）；
# - 全程没有批准卡（`vault_list` / `vault_read` / `pwd` / `cat` 都免闸）。
#
# 留存里有**两种编码形态**，两类断言不要互抄：
# - `session_open` 的 system / assembly 与行顶层字段是普通 JSON 对象，`file.has` 直接对字节判子串；
# - 工具结果在 `llm_request.request.messages[]` 的 `function_call_output.output` 里，是**字符串化的
#   JSON**（`turn.rs` 把结果 `serde_json::to_string` 后放进该字段）——原文的 `"` 落到字节是 `\"`、
#   原文的 `\n`（反斜杠 + n 两字符）是 `\\n`。这类断言 MUST 用 `file.jsonlOutput`（逐行解析、
#   再把 `output` 解析一层，按字段值判），不要手写转义：M777 现场三条手写断言全错（列表项形状与
#   cat 两条恒假红、pwd 负向恒绿），根因就是这层转义；`jsonlOutput` 的 `tool` 还经 `call_id` 把
#   结果绑到具体工具（输出项自身不带工具名），两次 `vault_list` 的结果因此也能分辨。
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-workspace.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 抢前台（后台注入键盘整批丢键错键会显著加剧——REVIEW.md 「键盘注入丢键」条）
    do: focusWindow
    retries: 4

  - name: 预置验收目录：一层文件
    do: vaultWrite
    file: "wsl-vault/keep.md"
    content: |
      WSL-KEEP sibling
  - name: 预置嵌套 sibling（递归才看得到）
    do: vaultWrite
    file: "wsl-vault/notes/deep.md"
    content: |
      WSL-DEEP nested
  - name: 预置 hidden 档条目（.DS_Store 默认不可见）
    do: vaultWrite
    file: "wsl-vault/.DS_Store"
    content: "junk\n"
  - name: 预置 lazy 子树（node_modules 默认惰性：出一行、不展开）
    do: vaultWrite
    file: "wsl-vault/node_modules/ignored.js"
    content: "module.exports = 1\n"

  - name: 输入提问并发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|vaultws" }
    text: "vaultws"
  - name: 发送
    do: key
    key: enter

  - name: 等工具链跑完（五轮工具 + 收尾）
    do: waitFor
    waitFor:
      has: ["WSL-DONE 工作区与列表验收完成。"]
    timeoutMs: 60000
    expect:
      - label: 会话留存首行是 session_open（装配事实的载体）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '"kind":"session_open"' }
      - label: system 里有工作区段（固定段的标题行）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "===== 工作区 =====" }
      - label: 工作区段含 vault 绝对根（行前缀「Vault 绝对根路径：/」）
        file: { path: "env:harness/sessions/*/*.jsonl", has: "Vault 绝对根路径：/" }
      - label: 工作区段写明 cli_run 从该目录启动
        file: { path: "env:harness/sessions/*/*.jsonl", has: "cli_run 的每次子进程都从这个目录启动" }
      - label: 装配清单有 workspace 条目（模板的仓内相对路径，审计可反查）
        file:
          path: "env:harness/sessions/*/*.jsonl"
          has: '/\{(?=[^}]*"source":"workspace")[^}]*"path":"src-tauri\/src\/harness\/prompts\/workspace-reference\.md"/'
      - label: 同一条目 exists=true 且字节数非零（「在场」不是「登记过」）
        file:
          path: "env:harness/sessions/*/*.jsonl"
          has: '/\{(?=[^}]*"source":"workspace")(?=[^}]*"exists":true)(?=[^}]*"bytes":[1-9][0-9]*)[^}]*\}/'
      # 以下九条判工具结果（见文件头：`output` 是字符串化 JSON，走解析后的判据，不写转义）。
      - label: vault_list 递归结果里有嵌套 sibling（工具真执行了）
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: vault_list
            has: { path: wsl-vault/notes/deep.md }
      # 条目是 {kind, path} 两个字段的子集语义：这两个值同时在场才算这一行（不是「串在文件里出现过」）。
      - label: 列表项形状是 {kind, path}（目录类型在场——lazy 目录出一行）
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: vault_list
            has: { kind: directory, path: wsl-vault/node_modules }
      - label: hidden 档条目（.DS_Store）不出现在任何一页
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: vault_list
            not: { path: wsl-vault/.DS_Store }
      - label: lazy 子树不展开（node_modules 下的文件不出现）
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: vault_list
            not: { path: wsl-vault/node_modules/ignored.js }
      # 读回的就是列表里看到的那份 sibling：path 与 content 逐字相等（content 不含尾换行——**vault_read
      # 逐行切分后 join，文件尾换行不产生空行**，tools.rs 的 vault_read）。
      - label: 列表 → 读取链路走通（读回的是列表里看到的那份 sibling）
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: vault_read
            has: { path: wsl-vault/notes/deep.md, content: WSL-DEEP nested }
      # pwd 的 stdout 原文是 `"/\n"`（JSON 文本里的两字符 `\n` 是**真换行**）——解析后是 "/" + 换行。
      # 两个形态都判：只要任一 cli_run 的 stdout 恰为根目录（有/无换行）就红；并额外要求 pwd 这次
      # 调用真的成功（exit_code=0），否则「stdout 不含 /」在命令根本没跑时也会恒绿。
      - label: pwd 这次调用真的成功（不只是「stdout 里没有 /」）
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: cli_run
            has: { command: pwd, exit_code: 0, ok: true }
      - label: pwd 不再返回 /（stdout 恰为根目录的形态不出现）
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: cli_run
            not: { stdout: "/\n" }
      - label: pwd 的 stdout 也不是无换行的根目录（同一回归的另一形态）
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: cli_run
            not: { stdout: "/" }
      # 钉到 stdout 的完整值（含 `cat` 打出的行尾换行，即上方 `content: |` 的收尾换行），比只钉前缀
      # 更能证明「读到的正是这份 sibling」——多一个字节都不成立；`command` / `args` 一起钉，把判据
      # 绑到 cat 那一次调用上（同场景还有 pwd 也是 cli_run）。
      - label: 相对路径 cat 读到 vault 内文件（子进程 cwd 就是当前 vault）
        file:
          path: "env:harness/sessions/*/*.jsonl"
          jsonlOutput:
            tool: cli_run
            has: { command: cat, args: [wsl-vault/keep.md], stdout: "WSL-KEEP sibling\n" }
      - label: 全程没有批准卡（读工具与只读白名单命令都免闸）
        ax: { not: "要运行这条命令吗？" }
      - shot: 01-工作区与列表
---

# 254 —— 工作区合同与 `vault_list`

本场景验的是 change `add-harness-vault-workspace-list` 的可见契约：

1. **上下文层**：新会话的 system 里有一段「工作区」，逐字节含当前 vault 的绝对根，并写明
   「`vault_*` 用相对路径 / `cli_run` 从该目录启动 / vault 外目标用绝对路径」；装配清单多一条
   `workspace`（模板仓内相对路径 + `exists:true` + 代入后字节数）。判据取自 `session_open`
   首行，不是面板文案。
2. **执行层**：`cli_run("pwd")` 调用成功（`exit_code: 0`）且不再返回 `/`（有 / 无换行两种形态都判
   不出现）；`cli_run("cat", ["wsl-vault/keep.md"])` 用**相对路径**读到 vault 内文件——后者是与路径
   拼写无关的强证据（cwd 若不是 vault，`cat` 必然找不到文件），判据钉到完整 `stdout`（含行尾换行）。
3. **工具层**：`vault_list` 的递归结果里有嵌套 sibling；hidden 档（`.DS_Store`）不出现；lazy 子树
   （`node_modules`）出一行但不展开；条目带 `path` / `kind` 两字段（值逐字匹配）；随后 `vault_read`
   读到列表里看到的那份 sibling，证明「列表 → 读取」这条链路在真栈成立。工具结果类判据全部按
   **解析后**的字段判（`file.jsonlOutput`），不写 JSONL 的转义层。

## 边界（如实登记）

- **模型遵从度不做机器断言**：真实模型是否真的「先 `vault_list`、不再 `pwd` / 广域 `find`」属抽样
  观察（判据 6），mock provider 代表不了它；本场景钉的是能力与装配在场。
- **多 vault 切换的 root 归属**由单测钉住（`cli_run_roots_follow_current_vault` 两个 root 各跑一次
  `pwd`、`workspace_section_is_per_vault` 两次装配互不串根）；本真机场景只跑单 vault 交互路径。
- **子代理与 cron 的 system root / `cli_run` cwd** 由两条走**真实运行链**的单测钉住
  （`harness::subagents::tests::subagent_workspace_root_reaches_system_and_cli_run_cwd` 经
  `start_task` → 子运行循环 → `cli_run`；`harness::run::tests::
  cron_run_workspace_root_reaches_system_and_cli_run_cwd` 经 `cron::handoff` →
  `Runtime::isolated` → `runtime.set_tool_policy` → `turn::run_turn_for`）；本场景不覆盖这两条
  运行路径，MUST NOT 据此声称子代理 / cron 已在真机验证。子运行继承**发起时的当前 vault**
  （`task` 没有 `vault` 参数，跨 vault 委派不在本契约内）。
- **`vault_list` 分页 / 过滤 / 排序 / 默认一层 / 三档放行**由单测钉住
  （`vault_list_paginates_stably` / `vault_list_recursive_and_path_glob` /
  `vault_list_lists_one_layer_by_default` / `vault_list_auto_allows_in_all_modes`）。本场景的两次
  `vault_list` 输出落在同一份会话留存里：`jsonlOutput` 的 `has` 能钉住「某个条目出现在某个工具的某次
  结果里」（条目值唯一时据此归属调用），但判据形态没有「按调用参数选择那次结果」的能力——默认调用
  的结果没有可用于挑选的区分字段，因此**默认一层**与分页都不在本场景的判据内；本场景的小目录也不会
  触发 `truncated`。
- **工具定义（description）不进会话留存**：`session_open` 只记 system / 装配清单 / provider 等
  （`jsonl.*` 的字段表），模型看到的工具 schema 不在 JSONL 里，本场景因此无从断言 `vault_list`
  的 description 文本。它的三组边界句由 `tools.rs` 单测 `vault_list_description_keeps_boundaries`
  钉住；「模型是否照它选工具」属判据 6 的真实 provider 抽样，不在本场景。

