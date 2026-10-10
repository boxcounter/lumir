---
id: "109-harness-permission-chip"
item: 109
title: 权限 chip（M414）：短名读数 / 三档浮层（全名 + 每档一行释义）/ 档位写回 config（change add-harness-permission-modes）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: 记下配置文件基线（写回判据在下面按值断言，基线只用于确认写入确实发生了）
    do: record
    as: cfg
    file: "env:config.json"

  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: pane 里的面板在位
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 权限 chip 在场——读屏名 = D426（{mode} 取当前档全名；默认档 vault_write）
        ax: { has: "权限模式：保险库写入（点击切换）" }
      - shot: 01-权限chip-默认档

  - name: 点权限 chip 展开浮层（chip 带 aria-haspopup → WKWebView 映射 AXPopUpButton，target 不锁 role）
    do: click
    target: { name: "^权限模式：" }
    expect:
      - label: 只读档全名在场（D427）
        ax: { has: "只读" }
      - label: 保险库写入档全名在场（D428）
        ax: { has: "保险库写入" }
      - label: 完全访问档全名在场（D429）
        ax: { has: "完全访问" }
      - label: 只读档释义在场（D430：读自动放行、写逐个问）
        ax: { has: "读自动放行；写操作都先问你" }
      - label: 保险库写入档释义在场（D431）
        ax: { has: "库内写自动放行；库外命令先问你" }
      - label: 完全访问档释义在场（D432）
        ax: { has: "全自动；仅危险命令仍问你" }
      - label: 展开浮层不改 chip 的读数
        ax: { has: "权限模式：保险库写入（点击切换）" }
      - shot: 02-三档浮层-全名与释义

  - name: 点「完全访问」（浮层项 role=menuitemradio，target 只给裸正则源 name）
    do: click
    target: { name: "^完全访问" }

  - name: 等 chip 读数翻成「完全访问」档（选择先行，写回随后）
    do: waitFor
    waitFor:
      has: ["权限模式：完全访问（点击切换）"]
    timeoutMs: 15000
    expect:
      - label: 读屏名随档翻转（短名 / 全名的分工见「断言口径」——AX 面只暴露读屏名）
        ax: { has: "权限模式：完全访问（点击切换）" }
      - label: 浮层不自动关（M373 口径：关闭只走 chip 再点 / 浮层外点击 / Esc）
        ax: { has: "全自动；仅危险命令仍问你" }
      - label: 写回落盘——config.json 的 harness.permission_mode 已是 full_access
        file: { path: "env:config.json", has: "\"permission_mode\": \"full_access\"" }
      - label: 配置文件确实被改写（写回不是空转）
        file: { path: "env:config.json", changedSince: cfg }
      - shot: 03-选后-完全访问

  - name: 切回「保险库写入」（浮层仍开——同一次展开里可连续调档）
    do: click
    target: { name: "^保险库写入" }

  - name: 等读数切回默认档
    do: waitFor
    waitFor:
      has: ["权限模式：保险库写入（点击切换）"]
    timeoutMs: 15000
    expect:
      - label: 两次写回都落盘（第二次把档位写回 vault_write）
        file: { path: "env:config.json", has: "\"permission_mode\": \"vault_write\"" }
      - shot: 04-切回默认档

  - name: 再点权限 chip 收起浮层（关闭路径之一：chip 再点）
    do: click
    target: { name: "^权限模式：" }

  - name: 等浮层收起（完全访问档的释义句离场 = 浮层不再暴露）
    do: waitFor
    waitFor:
      not: ["全自动；仅危险命令仍问你"]
    timeoutMs: 15000
    expect:
      - label: 浮层收起后 chip 读数不变（收起不改档位）
        ax: { has: "权限模式：保险库写入（点击切换）" }
      - shot: 05-浮层收起
---

# 109-harness-permission-chip —— 权限 chip 的读数、三档浮层与配置写回

## 本场景在验什么

change `add-harness-permission-modes` 的前端批（M414，tasks 5.1 / 5.2）：composer 控制行的
**第三个 chip**（`src/harness-panel.ts` 的 `.lumir-hp-perm`，位于合并选择器 chip 之后、ctx
读数之前）。三段口径：

1. **chip 面 = 短名**（D423–D425：只读 / 可写 / 完全）——Alex 2026-10-09 裁决：控制行要被模型 /
   权限两个 chip 与 ctx 读数共同挤占，短名才保证三档都完整显示（原「chip 显示全名」口径作废）。
   可访问名 / 悬停提示取 D426 = 「权限模式：{mode}（点击切换）」，{mode} 取当前档**全名**。
2. **浮层 = 全名 + 每档一行释义**（D427–D432）：全名只在浮层里出现一次（那里宽度不受控制行
   约束）；释义消歧档名与实际行为的偏差（Kimi 风格，design §7 的原句口径）。
3. **选择写回**：`config_set_value("harness", "permission_mode", …)` 落盘（`env:config.json`
   断言），chip 读数**先翻**（选择先行，与模型 chip / 思考 chip 同一条口径）。
   切换对**下一个判定**生效，不打断进行中的轮次——本场景全程不发消息，零在途轮次。

## 断言口径

- **chip 与浮层项的 AX role 都不锁定**：chip 带 `aria-haspopup="menu"`，WKWebView 把它映射成
  `AXPopUpButton` 而非 `AXButton`，点击 target 只给裸正则源 `name`（与场景 90 / 95 同口径）。
- **「chip 面只有短名」这一条不在本场景判**：chip 的 AX 名取 `aria-label`（D426，内含**全名**），
  可见的短名落在子文本上——AX 面区分不了「chip 显示短名」与「chip 显示全名」。短名的判据在
  DOM 层：`tests/visual/scenes/m347-harness-composer.spec.ts` 断言 `.lumir-hp-perm-name` 的
  文本 = 短名（可写 / 完全）且浮层项的 `.lumir-hp-permpop-name` = 全名（保险库写入 / 完全访问）。
  本场景判的是 AX 面能读到的两段：读屏名（D426）随档翻转 + 浮层三档全名与释义在场。
- **「当前档 aria-checked」不在真机直接判**（场景 95 的同款边界）：当前档靠 `.is-current` + 勾选
  SVG + `aria-checked` 表达，AX 文本不暴露这些——归 m347 视觉场景与前端单测。
- **浮层收起用负向断言**：收起后「完全访问」档的释义句离场——那条串只出现在浮层项里，是收起语义
  的可判读数。

## 环境与副作用

- 不写 vault 文件、不发消息（零 mock 往返、零 cli 执行）；`harness.permission_mode` 的写回落在
  **隔离** `XDG_CONFIG_HOME` 的 config.json（每场景重生成，不污染后续场景）。
- 合成 vault `/tmp/lumir-m102-acceptance`；真实 vault 与 `~/.config/lumir` 全程不读写；1420 不碰。
