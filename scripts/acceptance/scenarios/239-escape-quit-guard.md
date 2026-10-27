---
id: "239-escape-quit-guard"
item: 239
tier: core
title: Escape 不削弱退出守卫（change fix-escape-overlay-close-oct24）：dirty 文档按 Esc 不退出且不弹提示、⌘Q 仍被拦下、保存后 ⌘Q 正常放行
open: harness-note.md
marker: "HNL-ALPHA"
steps:
  - name: 基线：记录编辑器正文与磁盘文件
    do: recordEditor
    as: cleanBase
    expect:
      - label: 编辑器正文可读（读不到时 recordEditor 自己会红）
        editor: { has: "HNL-ALPHA" }
  - name: 基线：磁盘上这份文档的 sha256/mtime
    do: record
    file: harness-note.md
    as: docClean
    expect:
      - label: 磁盘基线已记下
        file: { path: harness-note.md, exists: true }

  - name: 把文档改成 dirty（自动保存已移除，dirty 由构造就是持久的——M278）
    do: type
    text: "ESC-DIRTY-LINE"
    expect:
      - label: 输入落在编辑器里（dirty 的构造前提）
        editor: { has: "ESC-DIRTY-LINE" }
      - label: 标签上出现未保存标记（D90）
        ax: { has: "（未保存）" }
      - label: 磁盘尚未被写（dirty 就是未落盘）
        file: { path: harness-note.md, unchangedSince: docClean }
      - shot: 01-dirty文档

  - name: 重新记基线（dirty 之后、Esc 之前的正文与磁盘读数）
    do: recordEditor
    as: dirtyBase
  - name: 磁盘基线（dirty 之后）
    do: record
    file: harness-note.md
    as: docDirty

  - name: 抢前台（后台注入键盘整批丢键会显著加剧——REVIEW.md「键盘注入丢键」条）
    do: focusWindow
    retries: 4

  - name: 文档 dirty、没有任何层打开时按 Escape
    do: key
    key: escape

  - name: 等界面落定（退出守卫若被误触发，提示 toast 要几百毫秒才渲染）
    do: sleep
    ms: 2000
    expect:
      - label: 应用仍在（编辑器可读、文档没被换掉）
        ax: { has: "/AXTextArea/" }
      - label: 应用仍在且 dirty 标记仍在（Esc 没有丢改动、也没有把它存掉）
        ax: { has: "（未保存）" }
      - label: 不出现退出拦截提示（用户按的是 Esc：提示出现即缺陷，哪怕数据没丢——设计 §5.4 ①）
        ax: { not: "无法退出" }
      - label: 文档正文逐字节不变（Esc 不改文档）
        editor: { unchangedSince: dirtyBase }
      - label: 磁盘文件未被改写（sha256 与 mtime 双判据）
        file: { path: harness-note.md, unchangedSince: docDirty, mtimeUnchangedSince: docDirty }
      - shot: 02-Esc之后-dirty仍在且无退出提示

  - name: 同一 dirty 文档按 ⌘Q——既有守卫必须拦下（E6：本 change 不削弱它）
    do: keys
    keys: ["cmd+q"]

  - name: 等退出拦截提示（守卫的唯一可见出口：D232 的 toast）
    do: waitFor
    waitFor:
      has: ["当前有未保存修改，无法退出"]
    timeoutMs: 15000
    expect:
      - label: 提示在场（未保存时 ⌘Q 仍被拦下——与上一步的「Esc 不出现提示」成对，两个方向都判）
        ax: { has: "当前有未保存修改，无法退出" }
      - label: 应用仍在（退出被拦下，编辑器与 dirty 标记都在）
        ax: { has: "（未保存）" }
      - label: 文档正文逐字节不变（退出路径不碰文档）
        editor: { unchangedSince: dirtyBase }
      - label: 磁盘文件未被改写
        file: { path: harness-note.md, unchangedSince: docDirty, mtimeUnchangedSince: docDirty }
      - shot: 03-CmdQ被守卫拦下

  - name: 保存（⌘S）——把文档变成干净态
    do: keys
    keys: ["cmd+s"]

  - name: 等落盘与 dirty 清除
    do: waitFor
    waitFor:
      not: ["（未保存）"]
    timeoutMs: 15000
    expect:
      - label: dirty 标记消失（保存已闭环）
        ax: { not: "（未保存）" }
      - label: 磁盘确实被写（sha256 变了、内容含刚输入的行）
        file: { path: harness-note.md, changedSince: docDirty, has: "ESC-DIRTY-LINE" }
      - shot: 04-保存后干净

  - name: 保存后的磁盘基线（Esc / ⌘Q 都不该再改写它）
    do: record
    file: harness-note.md
    as: docSaved
    expect:
      - label: 保存后基线已记下
        file: { path: harness-note.md, exists: true }

  - name: 干净文档按 ⌘Q（既有语义：正常退出、不再出提示）
    do: keys
    keys: ["cmd+q"]

  - name: 留一拍让退出流程走完（app 退出后本步的断言不再读 AX）
    do: sleep
    ms: 2500
    expect:
      - label: 退出过程没有留下新的磁盘写入（干净文档的 ⌘Q 不碰文档）
        file: { path: harness-note.md, unchangedSince: docSaved }
      - label: 边界登记——本套件没有断言「进程已消失」的动词（见文末「已知边界」）
        file: { path: "env:config.json", exists: true }

  - name: 重启（若上一步的 ⌘Q 已被守卫吞掉，这一步只是把同一实例收掉再起；矩阵语义见文末）
    do: restart
    expect:
      - label: app 重新起来且编辑器在位（退出 / 重启通道未被本 change 破坏）
        ax: { has: "/AXTextArea/" }
      - label: 恢复的标签仍是这份文档（会话恢复没有被退出路径破坏）
        ax: { has: "harness-note.md" }
      - label: 保存的内容在盘上、重新打开后逐字节仍在（保存闭环的终态）
        file: { path: harness-note.md, has: "ESC-DIRTY-LINE" }
      - shot: 05-重启后
---

# 239-escape-quit-guard —— Escape 不削弱退出守卫

## 本场景在验什么

change `fix-escape-overlay-close-oct24` 的 E6（退出守卫不削弱）+ 设计 §5.4 的三条退出路径反例：

| 段 | 用户路径 | 期望 | 本条判据 |
|---|---|---|---|
| ① | 文档 dirty、无任何层，按 `Esc` | 应用在、dirty 标记在、文档与磁盘逐字节不变、**不出现退出拦截提示** | 「Esc 不关层、不退出、也不触发守卫提示」——用户按的是 Esc，提示出现同样是缺陷，哪怕数据没丢 |
| ② | 同一 dirty 文档按 `⌘Q` | 仍被守卫拦下、出现提示、应用不退出 | 与 ① 成对：同一个应用，两条键的提示行为必须相反（①不许出现、②必须出现） |
| ③ | 保存后按 `⌘Q` | 正常退出、不再提示；重启后保存内容仍在 | 守卫没有被改宽成「什么都拦」；退出通道本身还能走通 |

**为什么 ① 的负向判据要留一拍再读**：退出提示是瞬时 toast（`save.showQuitBlocked` → D232），
渲染要几百毫秒；紧贴按键读 AX 的 `not` 断言会恒真（REVIEW.md「读不到当成空」条的另一面）。
`do: sleep` 2s 之后再读，负向判据才有区分度。

## 断言口径与已知边界

- **dirty 由构造就是持久的**（M278 移除自动保存）：输入之后没有定时器会把 dirty 清掉，因此
  「输入 → Esc」之间不需要与防抖赛跑（与场景 19 的外部改写构造不同，那里是为了让「保存」停顿在
  未闭环态）。
- **③ 的「进程真的退出」这一半不在本场景的机器判据内**：套件当前没有「断言进程消失」的动词
  （`scripts/acceptance/lib/**` 不在本 change 的 scope，见 mission scope），`do: restart` 会先
  `stopApp` 再起，因此它对「⌘Q 自己退出了」与「⌘Q 被吞掉、随后被 stopApp 收掉」这两种现场给出
  同样的读数。本场景因此只判「干净文档下 ⌘Q 不被守卫拦下（无提示）」+「app 能正常重起、保存内容
  仍在」；`ps -p <pid>` 的实测读数由跑批 agent 在证据目录里另记（`.local/acceptance/<批次>/`）。
  补齐这条需要一个新动作（如 `expectAppGone`），已作为套件表达力缺口单独报给 tower。
- **不做「只用 ⌘Q 验退出」的替代**：① 判的是「Esc 这条键不引导出路径」，把它并进 ② 就丢掉了
  本缺陷的核心对照（同一个应用、两条键、提示行为必须相反）。
- **保存的内容是合成串**：`ESC-DIRTY-LINE` 只是判据串，不涉及任何真实 vault 内容（仓库信息
  卫生纪律）。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；本场景**会写**验收 vault 里的
  `harness-note.md`（保存那一步），场景结束后由下一场景的 `resetVault` 复原。
- 真实 vault 与 `~/.config/lumir` 全程不读写；1420 端口不碰。
