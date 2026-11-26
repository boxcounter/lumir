---
id: "884-quit-save-all-dialog"
item: 884
tier: full
title: 退出前的保存全部确认弹框：⌘Q 弹居中模态、Escape 取消留场、保存失败留场不退出、保存全部并退出落盘
open: harness-note.md
marker: "HNL-ALPHA"
steps:
  - name: 基线：编辑器正文（Esc / 取消都不该改它）
    do: recordEditor
    as: cleanBase
    expect:
      - label: 编辑器正文可读
        editor: { has: "HNL-ALPHA" }

  - name: 键入制造 dirty
    do: type
    text: "QDLG-DIRTY"
    expect:
      - label: 输入落在编辑器里
        editor: { has: "QDLG-DIRTY" }
      - label: 标签进入未保存态
        ax: { has: "（未保存）" }
      - shot: 01-dirty文档

  - name: 重新记 dirty 基线（Esc / 取消期间的正文与磁盘读数）
    do: recordEditor
    as: dirtyBase
  - name: 磁盘基线（dirty 之后）
    do: record
    file: harness-note.md
    as: docDirty
    expect:
      - label: 磁盘基线已记下
        file: { path: harness-note.md, exists: true }

  - name: 抢前台（后台注入键盘会丢键——REVIEW.md「键盘注入丢键」条）
    do: focusWindow
    retries: 4

  - name: dirty 时按 ⌘Q——后端守卫拦下并弹居中确认
    do: keys
    keys: ["cmd+q"]

  - name: 等退出确认弹框（居中模态，不是右下角 toast）
    do: waitFor
    waitFor:
      has: ["有未保存的修改", "保存全部并退出"]
    timeoutMs: 15000
    expect:
      - label: 弹框标题在场
        ax: { has: "有未保存的修改" }
      - label: 主按钮「保存全部并退出」在场
        ax: { has: "保存全部并退出" }
      - label: 次按钮「取消」在场
        ax: { has: "/^取消$/" }
      - label: 不提供「丢弃修改」
        ax: { not: "丢弃修改" }
      - label: 应用仍在且 dirty 标记仍在
        ax: { has: "（未保存）" }
      - label: 文档正文逐字节不变
        editor: { unchangedSince: dirtyBase }
      - label: 磁盘文件未被改写
        file: { path: harness-note.md, unchangedSince: docDirty, mtimeUnchangedSince: docDirty }
      - shot: 02-CmdQ弹出退出确认

  - name: 按 Escape 取消退出确认（等同「取消」）
    do: key
    key: escape

  - name: 等弹框关闭（只关弹框：不退出、不保存、不丢弃）
    do: waitFor
    waitFor:
      not: ["保存全部并退出"]
    timeoutMs: 15000
    expect:
      - label: 弹框已关闭
        ax: { not: "保存全部并退出" }
      - label: 应用仍在且 dirty 标记仍在
        ax: { has: "（未保存）" }
      - label: 文档正文逐字节不变
        editor: { unchangedSince: dirtyBase }
      - label: 磁盘文件未被改写
        file: { path: harness-note.md, unchangedSince: docDirty, mtimeUnchangedSince: docDirty }
      - shot: 03-Escape取消后仍在

  - name: 收紧标签会话目录（造保存全部的真实失败点：文档已落盘、会话 flush 失败）
    do: envChmod
    file: "vault-sessions"
    mode: 0o500
    expect:
      - label: 权限已收紧
        shot: 权限收紧

  - name: 再次 ⌘Q 打开退出确认
    do: keys
    keys: ["cmd+q"]

  - name: 等弹框
    do: waitFor
    waitFor:
      has: ["保存全部并退出"]
    timeoutMs: 15000
    expect:
      - label: 弹框在场
        ax: { has: "保存全部并退出" }

  - name: 点「保存全部并退出」——保存屏障在会话 flush 处真实失败
    do: click
    target: { role: AXButton, name: "^保存全部并退出$" }

  - name: 等本次代次的失败记录与可见错误
    do: waitFor
    waitFor:
      has: ["未能保存全部更改，退出已取消", "s2:g1:failed"]
    timeoutMs: 15000
    expect:
      - label: 错误在弹框内可见（不是 toast，也不是静默）
        ax: { has: "未能保存全部更改，退出已取消" }
      - label: 弹框仍在（失败不关闭、不退出）
        ax: { has: "保存全部并退出" }
      - label: 本次代次是 running → failed（没有 ok）
        node: { role: AXStaticText, name: "^save-all-log s0:g0:idle s1:g1:running s2:g1:failed$", present: true }
      - label: 本次代次 MUST NOT 出现 ok
        node: { role: AXStaticText, name: "^save-all-log .*g1:ok", present: false }
      - label: 文档本身已保存（失败点在会话 flush，不是 saveAllDirty）
        file: { path: harness-note.md, changedSince: docDirty, has: "QDLG-DIRTY" }
      - shot: 04-保存失败弹框留场

  - name: 恢复标签会话目录权限
    do: envChmod
    file: "vault-sessions"
    mode: 0o700
    expect:
      - label: 权限已恢复
        shot: 权限恢复

  - name: 同一弹框内手动重试「保存全部并退出」（不自动重试，必须用户再点）
    do: click
    target: { role: AXButton, name: "^保存全部并退出$" }

  - name: 留一拍让受控退出走完（app 退出后本步的 AX 断言不再读）
    do: sleep
    ms: 2500

  - name: 重启恢复现场（若上一步已退出则重新拉起；若未退出则 stopApp 后拉起）
    do: restart
    expect:
      - label: app 重新起来且编辑器在位
        ax: { has: "/AXTextArea/" }
      - label: 恢复的标签仍是这份文档
        ax: { has: "harness-note.md" }
      - label: 保存的内容在盘上、重新打开后仍在（保存闭环的终态）
        file: { path: harness-note.md, has: "QDLG-DIRTY" }
      - label: 原正文仍在（保存没有截断 / 覆盖错文件）
        file: { path: harness-note.md, has: "HNL-ALPHA" }
      - shot: 05-重启后内容仍在
---

# 884-quit-save-all-dialog —— 退出前的保存全部确认弹框

## 本场景在验什么

change `add-quit-save-all-dialog-nov27`：dirty 时 ⌘Q 被后端守卫拦下后，前端显示**居中模态**
（不再是右下角 sticky toast），说明有未保存修改，只有「保存全部并退出」与「取消」两条动作，
不提供「丢弃修改」。

| 段 | 用户路径 | 期望 | 本条判据 |
|---|---|---|---|
| ① | dirty 文档按 `⌘Q` | 应用不退出，弹居中确认，两条动作，无「丢弃修改」 | 弹框标题 / 主按钮 / 次按钮都在 AX 里；正文与磁盘逐字节不变 |
| ② | 按 `Escape` | 只关弹框：不退出、不保存、不丢弃 | 弹框消失、dirty 仍在、正文与磁盘逐字节不变 |
| ③ | 保存屏障真实失败（会话 flush）后点主按钮 | 弹框留场、错误可见、不退出、不自动重试 | `s2:g1:failed` 的完整日志 + 无 `g1:ok` + 文档已落盘（失败点被钉在 flush） |
| ④ | 恢复权限后手动再点主按钮 | 第二次代次成功，随后经受控命令退出；重启后内容仍在 | `s4:g2:ok` 的完整日志（本轮在重启前无法稳定读到，见下文边界）+ 重启后磁盘判据 |

## 断言口径与已知边界

- **退出本身的机器判据缺口**：套件目前没有「断言进程消失」的动词（与 239 同一条边界），
  `do: restart` 会先 `stopApp` 再起，因此「受控命令真的让进程退出」与「命令没退出、随后被
  stopApp 收掉」在套件读数里同形。本场景因此把**保存闭环**（同代次日志 / 磁盘）判死，把
  「原 pid 消失」留给跑批 agent 用 `ps -p <pid>` 另记（`.local/acceptance/<批次>/`）与后续
  `expectAppGone` 动作补齐。
- **成功代次的日志（`s4:g2:ok`）可能在 AX 读到之前进程已退出**：本场景不把它写成硬断言，
  成功路径的终态由「重启后内容仍在」+ 失败代次的完整日志（`g1`）共同承担；真机跑批时若
  能稳定读到 `g2:ok`，再把它升级为节点级断言。
- **失败点选择会话 flush 而不是文档写**：`envChmod` 只能作用于隔离配置目录（`vault-sessions`），
  与 880b 的现场同源；文档写失败 / 冲突 / 同步后新 dirty 的现场由 `tests/unit/quit-flow.test.ts`
  与 `save-all.test.ts` 覆盖（界面上无法从外部合成）。
- **干净 ⌘Q 不弹框** 由 239 的 ③ 段与 Rust `quit_allowed` / 菜单分支共同覆盖；本场景不重复
  一段无法区分「已退出」与「被 stopApp 收掉」的 ⌘Q。
- **合成内容**：`QDLG-DIRTY` / `HNL-ALPHA` 只是判据串，不涉及任何真实 vault 内容。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；本场景**会写**验收 vault 里的
  `harness-note.md`（保存那一步），场景结束后由下一场景的 resetVault 复原。
- `envChmod vault-sessions` 在场景内恢复为 0700；异常中断时由套件的 `restoreEnvChmods` 收尾。
- 真实 vault 与 `~/.config/lumir` 全程不读写；1420 端口不碰。
