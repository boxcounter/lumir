---
id: "709-persistence-health-healthy"
item: 709
tier: full
title: 持久化健康——健康时不打扰（无横幅 / 无状态行 / 无未落盘提示）
fixtures: [plain.md, harness-note.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 健康态：文档备份正常、没有恢复枚举失败
    expect:
      - label: 文档区没有崩溃备份失败横幅
        ax: { not: "无法为" }
      - label: 也没有「无法检查残留备份」子条件
        ax: { not: "无法检查残留备份" }
      - label: 正常 dirty 文档没有备份失败标签后缀（读屏名不追加备份失败）
        ax: { not: "（备份失败）" }

  - name: 打开 harness pane 读留存健康
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness pane 在位（发送钮是 AX 读取活着的正观测）
        ax: { has: "(发送)" }
      - label: 健康态没有留存健康状态行
        ax: { not: "对话记录写入失败" }
      - label: 没有「此前记录缺失」的缺口文案
        ax: { not: "此前部分记录缺失" }
      - label: 没有「尚未落盘」提示
        ax: { not: "尚未落盘" }
      - label: 没有首次 history 的 sticky 提示
        ax: { not: "这段历史可能无法完整恢复" }
      - shot: 健康态
---

说明：**健康时不打扰**是本次变更最有价值的负向判据。文档侧与 harness 侧的健康载体都是
`hidden`：横幅零占位、状态行不显示、标签读屏名不追加后缀。三条负向断言分别钉住三处
「健康态 MUST NOT 出现」的文案（`D956` / `D957` / `D950`–`D955`）。

**已知边界（A7，不可真机注入）**：harness 会话留存的**正面写失败**在真机上不可稳定构造——
会话目录与文件名由 app 生成，阻断父目录会变成「发送被拒」而不是记录失败。该正面面由 Rust
单测 R1–R10（`LineSink` 故障注入 / 首行失败 / 部分写 / 切 vault / 历史缺口）与
`tests/visual/scenes/persistence-health-nov23.spec.ts` 的结构桩承担，本套件**不伪造**注入。
