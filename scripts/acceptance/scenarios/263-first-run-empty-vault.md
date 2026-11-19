---
# M851（0.13.0 初装验证，M849 报告 §B / §E 的 #4 / #5 / #6）：首启空态合同与空 vault 新建入口。
#
# 真机链：空配置 → 无 vault 空态（Open vault 可见可达）→ 空 vault（正文给出可见「新建笔记」）
# → 新建不带扩展名的 note（默认补 .md）→ 编辑保存 → 退出重启恢复。
#
# 原生目录选择器边界（README「已知边界」）：套件不驱动 rfd 的 NSOpenPanel，因此「Open vault」
# 只判入口在 AX 里可见可点；装载空 vault 的终态用「预置注册表 + last_vault + 重启」表达
# （与场景 17 / 67 同一口径）。「空 vault」的「空」由删掉 $vault2 的唯一 fixture 得到——
# 它比主验收 vault 干净，删一个文件就真的空了。
id: "263-first-run-empty-vault"
item: 263
tier: full
title: 首启空态与空 vault 新建：无 SAMPLE / 错误占位、可见新建入口、默认 .md、保存与重启恢复
seed:
  registry:
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000003000 }
steps:
  - name: 默认启动就绪（正观测：主 vault 已装载，这次 AX 读取是活的）
    do: settle
    expect:
      - label: 树里有 plain.md（后续负向断言的完整性见证：AX 读取不是退化快照）
        ax: { has: "plain.md" }

  - name: 删掉第二个合成 vault 的唯一文件（构造真正的空 vault）
    do: vaultRm
    file: $vault-b/beta.md
    expect:
      - label: $vault2 下已无 beta.md（空目录）
        file: { path: "$vault-b/beta.md", exists: false }

  - name: 清掉 last_vault（真·空配置首启的现场），然后退出重启
    do: envWrite
    file: config.json
    content: |
      {"version":1,"editor":{"mode":"md"},"ui":{"language":"zh"}}
  - name: 重启进入「未打开」空态（空配置：无 last_vault、无恢复提示）
    do: restart
    requireVault: false
    expect:
      - label: 左栏空态说明行在位（可读的下一步指引）
        ax: { has: "打开一个目录作为 vault" }
      - label: 「打开 vault」是按钮节点（与说明行里的同族子串区分开）
        ax: { has: "/AXButton[^\\n]*打开 vault/" }
      - label: 不残留恢复类提示（这不是 last_vault 失效路径）
        ax: { not: "上次打开的 vault 已不可用" }
      - label: 不残留「正在恢复」
        ax: { not: "正在恢复上次打开的 vault" }
      - label: 首屏没有 SAMPLE 的内部注解（旧演示把源码注解直接上屏）
        ax: { not: "i18n-exempt" }
      - label: 首屏没有 SAMPLE 的演示标题
        ax: { not: "标题一" }
      - label: 首屏没有错误附件占位（Attachment not found）
        ax: { not: "Attachment not found" }
      - label: 首屏没有图片读取失败占位（Image read failed）
        ax: { not: "Image read failed" }
      - shot: 01-空配置首启-无vault空态

  - name: 打开注册表里的空 vault（等价于 Open vault 选中空目录后的终态），重启进入空 vault 首入态
    do: configWrite
    lastVault: $vault-b
    language: zh
    expect:
      - label: 树头部点名第二个合成 vault（装载的是 $vault2）
        ax: { has: "vault：lumir-m102-acceptance-b（点击查看全部 vault）" }
      - label: 空 vault 引导句给出可执行下一步（D107，M851 改写后的第二句）
        ax: { has: "这个 vault 还没有打开的文件。新建一篇笔记开始。" }
      - label: 正文里有可见的「新建笔记」按钮（入口不藏在右键菜单里）
        ax: { has: "/AXButton[^\\n]*新建笔记/" }
      - label: 空 vault 不残留 SAMPLE 注解
        ax: { not: "i18n-exempt" }
      - label: 空 vault 不残留 SAMPLE 演示标题
        ax: { not: "标题一" }
      - label: 空 vault 不残留错误附件占位
        ax: { not: "Attachment not found" }
      - label: 空 vault 不残留图片读取失败占位
        ax: { not: "Image read failed" }
      - shot: 02-空-vault-空态与新建入口

  - name: 点「新建笔记」进入行内新建（与右键根菜单同一条 tree 命令）
    do: click
    target: { any: "/^新建笔记$/" }
    expect:
      - label: 行内输入框在位（空值态的读屏名）
        ax: { has: "新建文件的名称" }
      - shot: 03-行内新建输入框

  - name: 键入不带扩展名的名字（默认扩展名规则应补 .md）
    do: typeInNode
    target: { role: AXTextField, name: "新建文件的名称|note" }
    text: "note"
  - name: 回车提交
    do: key
    key: "return"
  - name: 等新建文件自动打开落到终态
    do: waitFor
    waitFor: { has: ["note.md"], not: ["新建文件的名称"] }
    expect:
      - label: 盘上出现 note.md（不是无扩展名的 note）
        file: { path: "$vault-b/note.md", exists: true }
      - label: 无扩展名原件不存在（区分度：默认补 .md 真的发生了）
        file: { path: "$vault-b/note", exists: false }
      - label: 新建即自动打开（正文 / 标签 / 树都点名 note.md）
        ax: { has: "note.md" }
      - label: 空态引导已撤下（有打开的文件就不再盖引导）
        ax: { not: "这个 vault 还没有打开的文件" }
      - shot: 04-新建note.md已打开

  - name: 编辑正文（标记串不含小写 e：键盘注入通道的已知边界）
    do: type
    text: "M851-FIRST-RUN-NOTE"
    expect:
      - label: 编辑器里是刚键入的标记串
        editor: { has: "M851-FIRST-RUN-NOTE" }
  - name: 保存
    do: key
    key: "cmd+s"
    expect:
      - label: 盘上字节逐字等于编辑模型终态
        file: { path: "$vault-b/note.md", exact: "M851-FIRST-RUN-NOTE" }

  - name: 等会话防抖落盘（SESSION_WRITE_DEBOUNCE_MS = 1000ms，留余量）
    do: sleep
    ms: 1500

  - name: 退出重启：vault、标签与正文按会话恢复
    do: restart
  - name: 等重启恢复的标签与正文落定（就绪门早于恢复段，见 README 的 M516 条）
    do: waitFor
    waitFor: { has: ["关闭 note.md", "M851-FIRST-RUN-NOTE"], not: ["这个 vault 还没有打开的文件"] }
    expect:
      - label: vault 自动恢复（last_vault）
        ax: { has: "vault：lumir-m102-acceptance-b（点击查看全部 vault）" }
      - label: 关闭钮仍点名 note.md（标签恢复）
        ax: { has: "关闭 note.md" }
      - label: 正文逐字恢复（编辑模型终态）
        editor: { has: "M851-FIRST-RUN-NOTE" }
      - label: 盘上字节与重启前一致
        file: { path: "$vault-b/note.md", exact: "M851-FIRST-RUN-NOTE" }
      - label: 不残留空 vault 引导（有恢复出来的标签）
        ax: { not: "这个 vault 还没有打开的文件" }
      - label: 不残留 SAMPLE 伪文档（重启路径同样不许回来）
        ax: { not: "i18n-exempt" }
      - shot: 05-重启恢复
---

# 263-first-run-empty-vault —— 首启空态与非空「空 vault」

## 本场景在验什么

M849 的 0.13.0 初装验证暴露了首启面的三件事（报告 §B / §E 的 #4–#6）：

1. **无 vault 首屏展示 SAMPLE 演示文档**：`// i18n-exempt: data` 内部注解、`Attachment not
   found` / `Image read failed` 两条错误样式行、en 界面里的中文标题。修复后初始会话是空白
   未命名文档，首屏只剩左栏 D5 说明行 + D6「打开 vault」按钮。
2. **空 vault 没有可见新建入口**：旧 D107 指向「在左栏选一个文件」，而左栏没有任何文件；
   新建只能右键 vault 名。修复后正文空态给出「新建笔记」按钮（D882），与右键根菜单同一条
   `tree.beginCreate("")` 命令。
3. **新建无扩展名输入落成无扩展名 plain text**：修复后末段名不含 `.` 时默认补 `.md`，
   用户显式写的其他扩展名原样保留。

判据全部落在用户可见面（AX 文本 / 按钮节点 / 编辑器正文）与磁盘字节上；两条负向判据
（无 SAMPLE 注解、无错误附件占位）都有正观测配对（D5 + Open vault、D107 + New note），
不是对着「读不到」空转。

## 为什么「空配置」用 envWrite 构造

套件每次启动都会写一份含 `last_vault = 验收 vault` 的隔离 config（就绪门与全部既有场景
依赖它）。真·空配置（无 `last_vault`）因此只能在运行期把 config.json 改写成不含该键的
最小形状再重启；`configWrite` 的 `lastVault` 缺省沿用当前值，表达不了「没有这个键」。
改写内容保留 `ui.language = zh`（套件语言面，见 README「语言面」），其余只留 version 与
`editor.mode`——与产品对「缺省配置」的解释一致。

## 为什么「打开空 vault」不点按钮

「打开 vault」拉起的是 rfd 的 NSOpenPanel，套件不驱动原生对话框（README「已知边界」）。
本场景因此分两段判：① 未打开空态里按钮在 AX 里可见可点（入口存在且可达）；② 空 vault 的
**终态**用「预置注册表 + last_vault + 重启」表达（与场景 17 / 67 的多 vault 手法同源）。
空 vault 的「空」是删掉 `$vault2` 唯一 fixture 后的真实空目录——不是「有文件但没打开标签」。

## 已知边界（不包装成覆盖）

- **原生目录选择器的实际选择动作不在本场景**：按钮点击后的选择器交互仍由人手验（M849 已
  真机走过一遍：标题 `Choose a vault folder`、⌘⇧G 直达路径、选中空目录装载成功）。
- **像素层**（空态观感、按钮配色）不在本场景：`tests/visual/scenes/first-run-empty-state.spec.ts`
  判结构与文案，整页像素归 `scripts/gate.sh visual`（首屏既有基线的变化由基线更新的人肉
  裁决流程处理，本 mission 不自行重录）。
- **语言面只判 zh**（套件钉住；en 列由文案 deck 的漂移门禁与视觉场景覆盖）。
