---
id: "08b-autosave-pause"
item: 8
title: 冲突期自动保存暂停——待决冲突期间不得回写磁盘
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 聚焦编辑器正文下方的空白区（把追加落点定在文档末尾）
    do: clickEditor
    dy: 400
  - name: 输入未保存内容（追加到文档末尾）
    do: type
    text: "PAUSE-PROBE"
    expect:
      - label: 输入已进入编辑器
        editor: { has: "PAUSE-PROBE" }
      - label: 探测串落在文档末尾（下面「紧跟其后」的追加断言以此为落点）
        editor: { has: "/PAUSE-PROBE[\\s\\S]*$/" }
  - name: 外部改写磁盘（制造冲突前提）
    do: vaultWrite
    file: plain.md
    content: "# 纯文本基线\n\n外部版本。\n"
    expect:
      - label: 磁盘已是外部版本
        file: { path: plain.md, has: "外部版本" }
  - name: 保存触发冲突
    do: key
    key: "cmd+s"
    expect:
      - shot: 冲突提示
      - label: 进入冲突待决态
        ax: { has: "保存冲突" }
  - name: 记录冲突待决时的磁盘基线
    do: record
    as: atConflict
    file: plain.md
    expect:
      - label: 已记下磁盘基线
        file: { path: plain.md, exists: true }
  - name: 注入前确认键盘落点
    # M140：冲突 toast 出现后不假设注入落点，先按键盘场景的前台纪律复查窗口焦点，
    # 再用 AX 的 focused 标记证明「键盘落点 = 编辑器」——落点可证，就不再靠假设。
    do: focusWindow
    expect:
      - label: AX 焦点标记在编辑器上（键盘注入落点可证）
        ax: { has: "/AXTextArea[\\s\\S]*?\\(focused\\)/" }
  - name: 冲突待决期间继续输入（紧跟在探测串之后）
    # 为什么用 type 而不是盲发 press_key（M138 现场 + M140 复验，详见 README「已知边界」）：
    # 本状态下 press_key 的可打印字符序列会**整批丢键**（连跑 6 次「按键未落地」，工具返回
    # ok/occluded=false；同一 tip 的正常状态下同样序列 3/3 落地）。试过加长间隔、加 settle、
    # 坐标点回编辑器、⌘→ 归位——全部无效：丢的是注入链路本身，不是光标位置。
    # type_text 是套件里的另一条注入通道（显式聚焦目标节点 + 出现次数回读 + 有限重试），
    # 在 press_key 丢键的同一现场能稳定落地。断言仍是**紧跟在探测串之后的真实落地**：
    # 落点不在 PAUSE-PROBE 之后就 FAIL，不是恒真。
    do: type
    text: "more"
    expect:
      - label: 追加输入已生效（紧跟在探测串之后）
        editor: { has: "PAUSE-PROBEmore" }
  - name: 等足够久（远超 2s 去抖）
    do: sleep
    ms: 7000
    expect:
      - label: 冲突待决期间自动保存已暂停——磁盘 sha256 未变
        file: { path: plain.md, unchangedSince: atConflict }
      - label: 磁盘仍是外部版本（没有被内存内容强行覆盖）
        file: { path: plain.md, has: "外部版本" }
      - label: 内存中的改动未丢
        editor: { has: "PAUSE-PROBE" }
      - label: 冲突提示仍在（待决未消解）
        ax: { has: "保存冲突" }
      - shot: 暂停验证之后
---

说明：`save-controller` 的口径是「存在未决冲突/外部修改待决/目标丢失时自动保存暂停，不硬冲 CAS」。
本场景的判据是**磁盘事实**：冲突提出后记录一次 sha256，跨过 2s 去抖再等 7s，磁盘必须逐字节不变。
若自动保存没有暂停（硬写），`unchangedSince` 与「磁盘仍是外部版本」两条会同时 FAIL——不存在假绿路径。
「暂停无用户感知」是 backlog 已记录的产品 finding，本场景不判它。

**探测串为什么落在文档末尾**（M140）：冲突待决期间那一步的断言是「追加的字符紧跟在探测串之后」，
它需要一个**确定的落点**。开局点正文下方的空白区，光标即落在文档末尾；探测串因此追加在末尾，
下面再追加时只要落点还在末尾（光标被保留或被重置到末尾都成立）断言就成立，落点跑到别处即 FAIL。
M140 实测：`⌘S` 提出冲突后，同一段落的落点会回到文档末尾——本场景的落点设计对「光标保留」与
「光标重置到末尾」两种行为都成立，因此不会因为 app 侧的光标行为变化而假绿。

**注入通道的选择**（M138 + M140）：本状态下的 `press_key` 可打印字符序列会整批丢键（工具自报
`ok/occluded=false`，app 侧收到的 keydown 就是没有——M139 的探针实证丢在 DOM 之前）。因此这一步
用 `type`（type_text）注入；`keys` 动作的回读+有限重试（M140 加固）仍覆盖其它场景的盲发按键，
两者都在 README「已知边界」里写清了各自的适用面。
