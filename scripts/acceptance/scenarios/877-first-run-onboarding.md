---
# 877（change add-first-run-onboarding-nov25）：首启模式、命令闸门、首启 tips + 默认 harness、
# 首 vault 打开后的 tips 撤下与老用户回归。
#
# 原生目录选择器边界（README「已知边界」）：套件不驱动 rfd 的 NSOpenPanel。本场景用
# `vaultOpenPath` 动作表达「用户在原生选择器里选中了第二个合成 vault」的终态；该动作只在
# 验收实例的 Vite 注入桥里可用（run.mjs 按场景自动设 LUMIR_ACCEPTANCE_VAULT_OPEN=1），
# 页面侧走 main.ts 的 switchToVault 完整链路（loadUserVault → vaultOpenPath → applyVault），
# 不重启、不 reload，因此保留本次启动的 firstRunPending。
#
# 命令闸门用重绑后的 Cmd-,（配置里改绑到 toc.toggle）复跑：证明 applyKeyConfig 的
# detach/reattach 路径也受同一闸门约束；Cmd-Shift-A / Cmd-/ 走默认表。
id: "877-first-run-onboarding"
item: 877
tier: full
title: 首启模式只添加 vault、命令闸门、tips + 默认 harness、首文档撤下 tips 与老用户回归
seed:
  registry:
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000003000 }
steps:
  - name: 默认启动就绪（正观测：主 vault 已装载，这次 AX 读取是活的）
    do: settle
    expect:
      - label: 树里有 plain.md（后续首启重启的完整性见证）
        ax: { has: "plain.md" }

  - name: 写首启配置（无 last_vault；Cmd-, 重绑到 toc.toggle）
    do: envWrite
    file: config.json
    content: |
      {"version":1,"editor":{"mode":"md"},"ui":{"language":"zh"},"keys":{"Cmd-,":"toc.toggle"}}

  - name: 重启进入启动态首启模式
    do: restart
    requireVault: false
    expect:
      - label: 首启面唯一主操作为「添加 vault」
        ax: { has: "/AXButton[^\\n]*添加 vault/" }
      - label: 没有既有树空态说明行（首启不铺 D5/D6）
        ax: { not: "打开一个目录作为 vault" }
      - label: 没有恢复中阶段行
        ax: { not: "正在恢复上次打开的 vault" }
      - shot: 01-首启模式

  - name: 命令闸门：重绑后的 Cmd-,
    do: key
    key: "cmd+,"
    expect:
      - label: 设置面板未打开
        ax: { not: "模型接入与自动化" }
      - label: 重绑目标 toc 也没有打开
        ax: { not: "大纲" }
  - name: 命令闸门：Cmd-Shift-A
    do: key
    key: "cmd+shift+a"
    expect:
      - label: harness pane 未打开
        ax: { not: "与当前文档对话" }
  - name: 命令闸门：Cmd-/
    do: key
    key: "cmd+/"
    expect:
      - label: 键位速查未打开
        ax: { not: "键位速查（生效中）" }
      - label: 首启面仍在，唯一动作仍可达
        ax: { has: "/AXButton[^\\n]*添加 vault/" }
      - label: 命令闸门没有写会话布局
        file: { path: "env:vault-sessions/acc-b.json", exists: false }
      - shot: 02-命令闸门后

  - name: 用完整前端链路打开第二个合成 vault（等价于原生选择器选中）
    do: vaultOpenPath
    vault: second
    expect:
      - label: 启动面已撤下（树可交互）
        ax: { has: "beta.md" }
      - label: 首启 tips 标题在场
        ax: { has: "开始使用" }
      - label: tips 有真实键位行
        ax: { has: "快速打开文件" }
      - label: tips 脚注注明默认键位与完整出口
        ax: { has: "/默认键位.*查看全部/" }
      - label: harness pane 默认在场（不抢焦点也可见）
        ax: { has: "与当前文档对话" }
      - label: 不再出现空工作区标题
        ax: { not: "没有打开的文档" }
      - label: 不再出现 D882 新建按钮
        ax: { not: "/AXButton[^\\n]*新建笔记/" }
      - label: D369 空 pane 引导让位
        ax: { not: "这个 pane 还没有打开的文件" }
      - shot: 03-首启-tips-与默认-harness

  - name: 等布局防抖落盘，并判无空 JSONL
    do: waitForFile
    waitForFile:
      path: "env:vault-sessions/acc-b.json"
      has: '"harness_pane": true'
    expect:
      - label: harness_pane 已落盘为 true
        file: { path: "env:vault-sessions/acc-b.json", has: '"harness_pane": true' }
      - label: 默认展开不生成空 harness 会话 JSONL
        glob: { dir: "env:harness/sessions/acc-b", pattern: "\\.jsonl$", exact: 0 }

  - name: 打开首篇文档，tips 应消失
    do: open
    file: beta.md
    marker: "第二个 vault 的笔记"
    expect:
      - label: 正文已装载
        editor: { has: "第二个 vault 的笔记" }
      - label: tips 标题已撤下
        ax: { not: "开始使用" }
      - label: tips 脚注已撤下
        ax: { not: "默认键位" }
      - label: 标签在场
        ax: { has: "beta.md" }
      - shot: 04-打开文档后无-tips

  - name: 在正文键入真实文本，验证 tips 撤下后编辑器确实可编辑
    do: type
    text: "TIP-EDIT-877"
    expect:
      - label: 键入的文本进入正文（不是只撤下 tips 的假可编辑）
        editor: { has: "TIP-EDIT-877" }
      - label: tips 仍不在场
        ax: { not: "开始使用" }
      - shot: 05-可编辑-正文变化

  - name: 保存刚才的编辑，避免 dirty 状态污染后续老用户回归
    do: key
    key: "cmd+s"
    expect:
      - label: 编辑落盘（保存而非撤销，老用户空态仍无标签）
        file: { path: "$vault-b/beta.md", has: "TIP-EDIT-877" }

  - name: 关闭标签与 harness，等布局落盘
    do: key
    key: "cmd+w"
  - name: 收起 harness
    do: key
    key: "cmd+shift+a"
  - name: 等 harness_pane:false 且 panes 无标签落盘
    do: waitForFile
    waitForFile:
      path: "env:vault-sessions/acc-b.json"
      has: '"harness_pane": false'
    timeoutMs: 20000
    expect:
      - label: 布局已收成无 harness
        file: { path: "env:vault-sessions/acc-b.json", has: '"harness_pane": false' }
      - label: 标签列表已空
        file: { path: "env:vault-sessions/acc-b.json", has: '"tabs": []' }

  - name: 重启构造老用户空 vault
    do: restart
    expect:
      - label: 老用户空 vault 呈统一空工作区
        ax: { has: "没有打开的文档" }
      - label: 老用户仍有可见新建入口
        ax: { has: "/AXButton[^\\n]*新建笔记/" }
      - label: 老用户不再出现首启 tips
        ax: { not: "开始使用" }
      - label: 老用户不默认展开 harness
        ax: { not: "与当前文档对话" }
      - shot: 06-老用户空vault回归
---

# 877-first-run-onboarding

## 本场景在验什么

首启判定 / 首启模式 / 命令闸门 / 首启 tips + 默认 harness / 一次性资格与老用户回归的**真机**
终态。首启模式只保留唯一「添加 vault」；`Cmd-,`（配置里重绑到 toc）、`Cmd-Shift-A`、
`Cmd-/` 在首启面不得穿透出设置 / harness / 键位面板；首个 vault 打开后 tips 与 harness 默认
在场，打开首个文档后 tips 消失；重启后老用户空 vault 仍是统一空工作区 + 新建入口，不再出现首启 tips /
默认 harness。

## 断言口径

- 每条「未打开」的负向断言都配正观测：首启面「添加 vault」在场、树已装载、tips 标题在场、
  harness 说明句在场。避免在「读不到」的退化快照上空转（REVIEW.md『读不到当成空』条）。
- 命令闸门用**重绑后的** `Cmd-,` 复跑，覆盖 `applyKeyConfig` 的 detach/reattach 路径；
  `Cmd-Shift-A` / `Cmd-/` 走默认表。三条都判无 overlay、无会话布局新写。
- 默认 harness 的「无空 JSONL」用目录级 `glob exact: 0`，并以 harness 说明句在场 +
  `harness_pane:true` 布局文件作正观测；不写 `file.count: 0`（count 读文件内容，文件不存在
  会直接 FAIL）。
- 老用户回归前先关标签与 harness、等 `harness_pane:false` 与空 tabs 落盘，再 `restart`；
  不直接重启，否则会恢复刚打开的标签与 `harness_pane:true`，老用户空态前提不成立。

## 已知边界

- 原生 `NSOpenPanel` 仍不驱动；`vaultOpenPath` 是验收专用桥，页面侧走 `switchToVault`
  完整链路（`loadUserVault → vaultOpenPath → applyVault`），不重启 / 不 reload。桥只在
  `LUMIR_ACCEPTANCE_PORT` + `LUMIR_ACCEPTANCE_VAULT_OPEN=1` + `apply:"serve"` 时注入；
  普通 dev 无端点 / 无全局桥，production build 不含桥接。
- 像素层（首启面居中观感、tips 排版与配色）不在本场景；归视觉门禁 / Alex 过目。
- 首启模式的「唯一按钮」只判 AX 可操作面；原生窗口 chrome（交通灯等）不在判据内。
