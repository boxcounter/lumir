---
# M447（change composer-emacs-nav）：kill 槽跨面共用——编辑器里 ⌃K 杀掉一段文本，焦点移到 composer
# 按 ⌃Y 能把它插出来（编辑器与 composer 是同一个槽、同一份相接判定）。
id: "145-harness-composer-kill-yank"
item: 145
title: kill 槽跨面共用：编辑器 ⌃K → composer ⌃Y（M447）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: 建立编辑器焦点并把光标移到第三行行首
    do: clickEditor
    dy: 6
    expect:
      - label: 文档已装载
        editor: { has: "HNL-ALPHA" }

  - name: ⌃A 归位后 ⌃N 两次到第三行（HNL-ALPHA 那一行）
    do: keys
    keys: ["ctrl+a", "ctrl+n", "ctrl+n", "ctrl+a"]
    gapMs: 150

  - name: ⌃K 杀掉第三行整行文本（并入 kill 槽）
    do: key
    key: "ctrl+k"
    expect:
      - label: 编辑器里该行文本已被杀掉
        editor: { not: "HNL-ALPHA" }
      - shot: 01-编辑器ctrl-k

  - name: ⌘⇧A 打开 harness pane，点 composer 建立焦点
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: composer 在位（空输入态 = D328 占位读屏名）
        ax: { has: "问点什么" }

  - name: 真实鼠标点 composer
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: ⌃Y 把编辑器杀掉的那段文本插进 composer
    do: key
    key: "ctrl+y"
    expect:
      - label: 编辑器侧杀掉的那段文本出现在 composer（同一个 kill 槽）
        ax: { has: "/HNL-ALPHA[^\\n]*第一行/" }
      - shot: 02-composer-ctrl-y
---

# 145-harness-composer-kill-yank —— kill 槽跨面共用（M447）

## 本场景在验什么

合同：kill 槽 SHALL 是**跨面共用**的单一真源（编辑器与 composer 同一个槽、同一份连续 kill 相接
判定）；编辑器侧行为逐字节不变（change 的 harness 增量「kill 与 yank」段、裁决点 4）。

现场：`harness-note.md` 的第三行是 `HNL-ALPHA 第一行。`。

1. 编辑器里 ⌃A ⌃N ⌃N ⌃A 把光标移到第三行行首，⌃K 杀掉该行文本；
2. 断言编辑器里该行文本已消失（⌃K 生效）；
3. ⌘⇧A 打开 harness pane、点 composer；
4. ⌃Y → 编辑器杀掉的那段文本出现在 composer —— 只有**同一个槽**才会这样。

## 判据为什么这样写

- **正向跨面读数**：composer 的 ⌃Y 读到的必须是编辑器**刚刚**写进槽的内容（`HNL-ALPHA 第一行。`）。
  槽不共用的形态（composer 另立一个槽）下，composer 的 ⌃Y 会读到空槽、什么都不插 ——
  `has` 那条因此对「两个槽」的实现有区分度。
- **编辑器侧先判一次「文本已被杀掉」**：否则「composer 里出现该串」可能是「⌃K 根本没生效、
  文本原来就在 composer」这类空转。
- **面板打开期间 AX 里没有编辑器节点**（场景 09 的既有口径）——所以第 4 步读到的 `HNL-ALPHA`
  只可能来自 composer，不会是编辑器。
- **反向方向（composer ⌃K → 编辑器 ⌃Y）不再单判**：它与本方向走同一个槽的同一次读写，
  反向判据在「两个槽」的缺陷形态下**没有区分度**（编辑器槽里本来就有本场景第 1 步写入的同一段
  文本），写进去也只是重复一条无区分的断言（REVIEW.md 第 1 条）。槽的单一性由本条与模型层
  单测（`mergeKillText` 的相接判定）共同守住。

## 已知边界（如实登记）

- 不改动 vault 文件：⌃K 只改编辑器内存缓冲区（本场景不保存）。
- 不发消息；真实 vault 与 `~/.config/lumir` 全程不读写；真机段走 `LUMIR_ACCEPTANCE_PORT`（1430）。
