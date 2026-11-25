---
# Quick Open 外部一层目录与 O7 稳定几何。只使用第二合成 vault，不读取真实目录。
# 本 worker 只提交场景与静态校验；真机窗口被其它批次占用时不得启动本场景。
id: "874-quick-open-external-directory-and-stable-layout"
item: 874
tier: full
title: Quick Open 外部目录一层候选、子目录进入、外部文件只读与输入框 bbox 稳定
open: goto-line-long.md
marker: "JUMP-TARGET-39"
config:
  harness:
    provider: mock
steps:
  - name: 在第二合成 vault 造根文件与深层文件（根层扫描不得看到深层文件）
    do: vaultWrite
    vault: second
    file: root.md
    content: "# External root\n\nQO-874-ROOT\n"
  - name: 在第二合成 vault 造子目录文件
    do: vaultWrite
    vault: second
    file: sub/child.md
    content: "# External child\n\nQO-874-CHILD-READONLY\n"
  - name: 焦点在编辑器，打开 Quick Open
    do: clickEditor
  - name: 按 ⌘P
    do: keys
    keys: ["cmd+p"]
    expect:
      - label: 输入框持焦
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\)/" }
  - name: 输入外部绝对目录（显式尾斜杠）
    do: typeInNode
    target: { role: AXComboBox, name: "按路径快速打开文件|$vault2" }
    text: "$vault2/"
    expect:
      - label: 直接子文件与直接子目录出现，子目录带尾斜杠
        ax: { has: "$vault2/sub/" }
      - label: 深层文件不得出现在根层候选
        ax: { not: "QO-874-CHILD-READONLY" }
      - label: 深层文件路径不得出现在根层候选
        ax: { not: "$vault2/sub/child.md" }
      - label: 提示是直接子项总数
        ax: { has: "直接子项 2 条" }
      - label: 记录两项候选时的输入框 bbox（缺 bbox 即 FAIL）
        geom:
          target: { role: AXComboBox, name: "按路径快速打开文件" }
          minWidth: 280
          minHeight: 18
          record: qo-874-input
      - shot: 01-外部目录两项候选

  - name: 切到不存在的外部目录，形成零候选与长提示
    do: keys
    keys: ["cmd+a"]
  - name: 输入不存在的外部目录
    do: typeInNode
    target: { role: AXComboBox, name: "按路径快速打开文件|$vault2" }
    text: "$vault2/missing-with-a-long-name-for-stable-hint/"
    expect:
      - label: 不存在与普通搜索空态区分
        ax: { has: "目录不存在或不是目录：$vault2/missing-with-a-long-name-for-stable-hint" }
      - label: 零候选与长提示不移动输入框
        geom:
          target: { role: AXComboBox, name: "按路径快速打开文件" }
          unchangedSince: qo-874-input
      - shot: 02-零候选长提示

  - name: 返回外部根目录
    do: keys
    keys: ["cmd+a"]
  - name: 再次输入外部根目录
    do: typeInNode
    target: { role: AXComboBox, name: "按路径快速打开文件|$vault2" }
    text: "$vault2/"
    expect:
      - label: 两项候选恢复后 bbox 仍逐值一致
        geom:
          target: { role: AXComboBox, name: "按路径快速打开文件" }
          unchangedSince: qo-874-input
  - name: 游标移到子目录
    do: key
    key: down
  - name: Enter 进入子目录
    do: key
    key: enter
    expect:
      - label: 输入更新为子目录尾斜杠，浮层保持打开
        ax: { has: "/AXComboBox .*Value: .*\\/sub\\//" }
      - label: 下一层只有直接子文件
        ax: { has: "$vault2/sub/child.md" }
      - label: 直接子项计数为一
        ax: { has: "直接子项 1 条" }
      - label: 一项候选时 bbox 仍逐值一致
        geom:
          target: { role: AXComboBox, name: "按路径快速打开文件" }
          unchangedSince: qo-874-input
      - shot: 03-进入外部子目录

  - name: 记录外部文件字节与 mtime 基线
    do: record
    as: qo-874-child-before
    file: "$vault2/sub/child.md"
  - name: Enter 打开外部文件
    do: key
    key: enter
  - name: 等外部文件装载
    do: waitFor
    waitFor:
      has: ["QO-874-CHILD-READONLY"]
    timeoutMs: 15000
  - name: 外部文件只读现场
    do: settle
    expect:
      - label: 外部文件经既有只读链打开
        ax: { has: "vault 外 · 只读" }
      - label: 文档内容来自第二合成 vault
        editor: { has: "QO-874-CHILD-READONLY" }
      - label: 标签读屏名带只读标记
        ax: { has: "child.md（vault 外只读）" }
  - name: 记录只读文档基线
    do: recordEditor
    as: qo-874-editor-before
  - name: 只读编辑与保存均不得写盘
    do: keys
    keys: ["x", "cmd+s"]
  - name: 零写入终态
    do: settle
    expect:
      - label: 编辑器文档逐字节不变
        editor: { unchangedSince: qo-874-editor-before }
      - label: 外部文件字节不变
        file: { path: "$vault2/sub/child.md", unchangedSince: qo-874-child-before }
      - label: 外部文件 mtime 不变
        file: { path: "$vault2/sub/child.md", mtimeUnchangedSince: qo-874-child-before }
      - label: 没有保存失败提示
        ax: { not: "尚未可保存" }
---

本场景只写第二合成 vault `/tmp/lumir-m102-acceptance-b`。根层有两项、缺失目录零项、子目录一项；根层候选不得出现 `sub/child.md`，证明没有递归。`geom.record` 与 `geom.unchangedSince` 在 0/1/2 候选和长提示之间逐值比较输入框 bbox，缺基线或 bbox 都 FAIL。精确宽度、三主题、100 条截断、pending/迟到与 resize 由 Chromium 矩阵承担；本场景不宣称覆盖这些读数。真机执行留待窗口空闲后由主会话串行。
