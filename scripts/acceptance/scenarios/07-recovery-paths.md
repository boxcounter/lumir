---
id: "07-recovery-paths"
item: 7
title: M124 三条恢复路径（冲突双动作 / 另存为 / 外部修改重载）
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 启动不被拦（remap 修复后正常装载 vault）
    expect:
      - label: 左栏文件树正常装载（未卡在 remap 拦停）
        ax: { has: "plain.md" }
      - label: 未出现 remap 确认提示
        ax: { not: "发现可能已移动的 vault" }
  - name: 制造 CAS 冲突（内存改动 vs 磁盘被外部改写）
    do: type
    text: "MEM-EDIT"
    expect:
      - label: 内存改动已进入缓冲
        editor: { has: "MEM-EDIT" }
  - name: 外部改写磁盘
    do: vaultWrite
    file: plain.md
    content: "# 纯文本基线\n\n磁盘被外部改写。\n"
    expect:
      - label: 磁盘已按外部内容改写
        file: { path: plain.md, has: "磁盘被外部改写" }
  - name: 保存（应触发冲突双动作）
    do: key
    key: "cmd+s"
    expect:
      - shot: 保存冲突提示
      - label: 冲突提示出现
        ax: { has: "保存冲突" }
      - label: 冲突提示给出两个动作（重载 / 强制覆盖）
        ax: { has: "重新载入" }
      - label: 冲突提示给出强制覆盖动作
        ax: { has: "强制覆盖" }
      - label: 内存改动未丢失
        editor: { has: "MEM-EDIT" }
  - name: 磁盘未被静默覆盖
    expect:
      - label: 冲突期间磁盘仍是外部内容（未被自动覆盖）
        file: { path: plain.md, has: "磁盘被外部改写" }
---

说明：toast 文案取自 `文案-Copy.md`/openspec fs-io spec 的单一来源，断言用其中的稳定子串
（「保存冲突」「重新载入」「强制覆盖」），避免整句标点差异导致假红。`另存为`（文件被外部删除
路径）与「外部修改自动重载」两条在场景 07b。
