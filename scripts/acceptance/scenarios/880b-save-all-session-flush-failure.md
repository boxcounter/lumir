---
id: "880b-save-all-session-flush-failure"
item: 880
tier: full
title: 保存全部——标签会话真实写失败时判失败、不出本次完成标记；恢复权限后可再次成功
fixtures: [tabs-a.md]
seed:
  registry:
    - { id: acc-save-all-fail, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-save-all-fail: { tabs: [tabs-a.md], active: tabs-a.md }
steps:
  - name: 等启动恢复出标签，并确认代次初始态
    do: waitFor
    waitFor:
      has: ["/AXRadioButton \\(tabs-a\\.md\\)/"]
    expect:
      - label: 保存全部状态日志初始态
        node: { role: AXStaticText, name: "^save-all-log s0:g0:idle$", present: true }

  - name: 制造标签会话目录的真实写失败（权限 0500）
    do: envChmod
    file: "vault-sessions"
    mode: 0o500
    expect:
      - label: 权限已收紧（下一步的 flush 必须真的失败，而不是「没跑」）
        shot: 权限收紧

  - name: 编辑产生脏标签（文档本身可写盘；失败点必须落在会话 flush）
    do: type
    text: "SAVEALL-FAIL"
    expect:
      - label: 输入已生效
        editor: { has: "SAVEALL-FAIL" }

  - name: 触发 File → Save All（按 pid 的 AX 菜单通道）
    do: clickMenuItem
    menu: File
    item: Save All

  - name: 等本次代次的失败标记（会话 flush 真实失败 → 不得出现 ok）
    do: waitFor
    waitFor:
      has: ["s2:g1:failed"]
    timeoutMs: 15000
    expect:
      - shot: 会话 flush 失败之后
      - label: 日志是本次操作的 running → failed（没有 ok）
        node: { role: AXStaticText, name: "^save-all-log s0:g0:idle s1:g1:running s2:g1:failed$", present: true }
      - label: 成功记录 MUST NOT 出现
        node: { role: AXStaticText, name: "^save-all-log .*g1:ok", present: false }
      - label: 文档本身确实已保存（失败点在会话 flush，不是 saveAllDirty）
        file: { path: tabs-a.md, has: "SAVEALL-FAIL" }

  - name: 恢复会话目录权限（后续步骤与收尾需要可写）
    do: envChmod
    file: "vault-sessions"
    mode: 0o700

  - name: 再次触发保存全部（恢复后必须成功，且代次加一）
    do: clickMenuItem
    menu: File
    item: Save All
  - name: 等第二次的完成标记
    do: waitFor
    waitFor:
      has: ["s4:g2:ok"]
    timeoutMs: 15000
    expect:
      - label: 第二次是新的代次且成功（g1 failed 不覆盖、g2 running → ok）
        node: { role: AXStaticText, name: "^save-all-log s0:g0:idle s1:g1:running s2:g1:failed s3:g2:running s4:g2:ok$", present: true }
      - label: 第一次的 failed 仍留在日志里（不得被后来的 ok 覆盖）
        node: { role: AXStaticText, name: "^save-all-log .*s2:g1:failed", present: true }
---

**判据说明（K3 P1-1 / P1-3）**

- 原生菜单走 `clickMenuItem`（Swift Accessibility，按 pid）：KimiCU 的 AX 文本不暴露
  `AXMenuBarItem` 节点；动作成功即证明 File → Save All 菜单项真的在并已被按下，找不到时
  helper 非零退出、FAIL 里带现有菜单 / 项标题。

- `envChmod` 把隔离配置下的 `vault-sessions/` 收紧到 0500，制造**真实磁盘写失败**。产品的
  `vault_session_put` 会记 warning 并返回 `false`；保存全部屏障据此判失败——不会因为「只打了
  warning」就发成功终态。
- 判据是**归属日志**（`s2:g1:failed` / `s4:g2:ok` 所在的完整日志，节点级精确形态），不是 toast
  文本：第一次失败后旧 toast 仍在场，第二次必须由新的 running g2 归属、且同代次 ok 才算成功；
  第一次的 failed 仍保留在日志里。
- 文档本身已保存（`file.has`），把「失败点确实在会话 flush」与「saveAllDirty 没跑」区分开。
- 阅读位置写失败 / 后端镜像同步失败 / 同步等待期间的新 dirty / 并发触发由 `tests/unit/save-all.test.ts`
  覆盖（界面上无法从外部合成这几种现场）。
