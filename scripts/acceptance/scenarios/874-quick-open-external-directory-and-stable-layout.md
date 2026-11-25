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
  - name: 在第二合成 vault 造根文件与深层文件（固有 fixture 另有 beta.md；根层扫描不得看到深层文件）
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
  - name: 输入外部精确文件路径，不显示 direct action 伪候选
    do: typeInNode
    target: { role: AXComboBox, name: "按路径快速打开文件|$vault2" }
    text: "$vault2/root.md"
    expect:
      - label: 不显示 vault 内 direct action 文案
        ax: { not: "按 Enter 打开" }
      - label: 不显示外部 direct action 文案
        ax: { not: "按 Enter 只读打开" }
      - label: 保留通用帮助而不新增相似提示
        ax: { has: "输入路径或文件名；可加 :12 这样的行号后缀" }
      - label: 可打开判决与普通零候选并存时也不显示普通空态
        ax: { not: "没有匹配的条目" }
      - shot: 01-外部精确路径无伪候选
  - name: Enter 仍直接只读打开外部精确路径
    do: key
    key: enter
  - name: 等外部精确文件装载
    do: waitFor
    waitFor:
      has: ["QO-874-ROOT"]
    timeoutMs: 15000
  - name: 外部精确文件直接打开能力未删除
    do: settle
    expect:
      - label: 外部文件经既有只读链打开
        ax: { has: "vault 外 · 只读" }
      - label: 文档内容来自第二合成 vault 根文件
        editor: { has: "QO-874-ROOT" }
      - label: 标签读屏名带只读标记
        ax: { has: "root.md（vault 外只读）" }
  - name: 焦点在编辑器，重新打开 Quick Open
    do: clickEditor
  - name: 按 ⌘P 准备目录验收
    do: keys
    keys: ["cmd+p"]
    expect:
      - label: 输入框持焦
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\)/" }
  - name: 输入外部绝对目录（显式尾斜杠）
    do: typeInNode
    target: { role: AXComboBox, name: "按路径快速打开文件|$vault2" }
    text: "$vault2/"
  - name: 等外部根目录一层扫描完成
    do: waitFor
    waitFor:
      has: ["$vault2/sub/", "直接子项 3 条"]
    timeoutMs: 5000
  - name: 根目录三项真实候选与稳定输入框
    do: settle
    expect:
      - label: 直接子文件与直接子目录出现，子目录带尾斜杠
        ax: { has: "$vault2/sub/" }
      - label: 目录语境也不显示 direct action 文案
        ax: { not: "按 Enter 打开" }
      - label: 深层文件不得出现在根层候选
        ax: { not: "QO-874-CHILD-READONLY" }
      - label: 深层文件路径不得出现在根层候选
        ax: { not: "$vault2/sub/child.md" }
      - label: 提示是直接子项总数（固有 beta.md + 新建 root.md + sub/）
        ax: { has: "直接子项 3 条" }
      - label: 记录三项候选时的输入框 bbox（缺 bbox 即 FAIL）
        geom:
          target: { role: AXComboBox, name: "按路径快速打开文件" }
          minWidth: 280
          minHeight: 18
          record: qo-874-input
      - shot: 02-外部目录三项候选

  - name: 切到不存在的外部目录，形成零候选与长提示（聚焦后全选，再用真实键盘注入替换）
    do: typeInNode
    target: { role: AXComboBox, name: "按路径快速打开文件|$vault2" }
    text: "$vault2/missing-with-a-long-name-for-stable-hint/"
    replace: true
  - name: 等不存在目录状态落定
    do: waitFor
    waitFor:
      has: ["目录不存在或不是目录：$vault2/missing-with-a-long-name-for-stable-hint"]
    timeoutMs: 5000
  - name: 零候选长提示与稳定输入框
    do: settle
    expect:
      - label: 不存在与普通搜索空态区分
        ax: { has: "目录不存在或不是目录：$vault2/missing-with-a-long-name-for-stable-hint" }
      - label: 零候选与长提示不移动输入框
        geom:
          target: { role: AXComboBox, name: "按路径快速打开文件" }
          unchangedSince: qo-874-input
      - shot: 03-零候选长提示

  - name: 返回外部根目录（同一真实替换通道）
    do: typeInNode
    target: { role: AXComboBox, name: "按路径快速打开文件|$vault2" }
    text: "$vault2/"
    replace: true
  - name: 等三项候选恢复
    do: waitFor
    waitFor:
      has: ["$vault2/sub/", "直接子项 3 条"]
    timeoutMs: 5000
  - name: 三项候选恢复后输入框不动
    do: settle
    expect:
      - label: 三项候选恢复后 bbox 仍逐值一致
        geom:
          target: { role: AXComboBox, name: "按路径快速打开文件" }
          unchangedSince: qo-874-input
  - name: 游标按确定排序从 beta.md 经 root.md 移到子目录 sub/
    do: keys
    keys: ["down", "down"]
  - name: Enter 进入子目录
    do: key
    key: enter
  - name: 等子目录一层扫描完成
    do: waitFor
    waitFor:
      has: ["$vault2/sub/child.md", "直接子项 1 条"]
    timeoutMs: 5000
  - name: 子目录一项候选与稳定输入框
    do: settle
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
      - shot: 04-进入外部子目录

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

本场景只写第二合成 vault `/tmp/lumir-m102-acceptance-b`。先证明外部精确文件路径不显示 direct action、保留通用帮助且 Enter 仍能只读打开，再验根层三项（固有 `beta.md`、新建 `root.md` 与 `sub/`）、缺失目录零项、子目录一项；根层候选不得出现 `sub/child.md`，证明没有递归。`geom.record` 与 `geom.unchangedSince` 在 0/1/3 候选和长提示之间逐值比较输入框 bbox，缺基线或 bbox 都 FAIL。精确宽度、三主题、100 条截断、pending/迟到与 resize 由 Chromium 矩阵承担；本场景不宣称覆盖这些读数。真机执行留待窗口空闲后由主会话串行。
