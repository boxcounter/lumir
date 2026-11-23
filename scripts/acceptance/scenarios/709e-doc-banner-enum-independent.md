---
id: "709e-doc-banner-enum-independent"
item: 709
tier: full
title: 文档备份失败横幅——枚举失败子条件独立保留，保存成功不撤下
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
seed:
  envFiles:
    - { path: "recovery", from: "$fixtures/recovery-blocker.txt" }
steps:
  - name: 启动时 recovery_list 失败 ⇒ 枚举失败子条件在场
    do: waitFor
    waitFor:
      has: ["无法检查残留备份"]
    timeoutMs: 20000
    expect:
      - label: 横幅给出枚举失败文案
        ax: { has: "无法检查残留备份" }
      - label: 枚举失败段给出「重新检查」动作
        ax: { has: "重新检查" }
      - label: 前提：尚未有写失败子条件
        ax: { not: "无法为 " }

  - name: 制造 dirty 内容并等备份失败（两个子条件并存）
    do: clickEditor
    dy: 6
  - name: 输入内容
    do: type
    text: "PERSIST-ENUM-INDEPENDENT"
    expect:
      - label: 输入已生效
        editor: { has: "PERSIST-ENUM-INDEPENDENT" }
  - name: 等备份 debounce 到期
    do: sleep
    ms: 4000
    expect:
      - label: 前提：写失败子条件也出现（同一横幅两段）
        ax: { has: "无法为 1 份未保存的文档写入崩溃备份" }
      - label: 枚举失败仍在
        ax: { has: "无法检查残留备份" }

  - name: 点「全部保存」（写失败子条件清空）
    do: click
    target: { role: AXButton, name: "全部保存" }
  - name: 等保存落地
    do: sleep
    ms: 1200
    expect:
      - shot: 全部保存之后
      - label: 内容已进 vault
        file: { path: plain.md, has: "PERSIST-ENUM-INDEPENDENT" }
      - label: 写失败子条件清空
        ax: { not: "无法为 1 份未保存的文档写入崩溃备份" }
      - label: 枚举失败子条件独立保留（横幅不撤下）
        ax: { has: "无法检查残留备份" }
      - label: 枚举段动作仍在（重新检查）
        ax: { has: "重新检查" }
---

说明：V5 已纳入的双子条件独立性。`seed.envFiles` 在**起 app 之前**把隔离配置目录里的
`lumir/recovery` 预置为一个**普通文件**（来源是仓内 fixture）——vault 装载后的
`recovery_list` 读它必然失败，进入枚举失败子条件；这份失败是磁盘上真实存在的形态，不是假
注入。随后 dirty 文档的备份也失败，两个子条件同处一条横幅；「全部保存」只清写失败子条件，
**MUST NOT** 撤下枚举失败子条件（`D957` / `D959` 仍在）。
