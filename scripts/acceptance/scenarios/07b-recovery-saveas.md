---
id: "07b-recovery-saveas"
item: 7
title: M124 恢复路径之二——文件被外部删除后「另存为新文件」
fixtures: [plain.md]
open: plain.md
marker: "纯文本基线"
steps:
  - name: 聚焦编辑器并制造未保存内容
    do: clickEditor
    dy: 6
  - name: 输入
    do: type
    text: "MEM-EDIT-2"
    expect:
      - label: 输入已进入编辑器
        editor: { has: "MEM-EDIT-2" }
  - name: 真删除磁盘上的目标文件
    do: vaultRm
    file: plain.md
    expect:
      - label: 目标文件确已从磁盘删除（不是清空）
        file: { path: plain.md, exists: false }
  - name: 等外部删除事件到达
    do: sleep
    ms: 2500
    expect:
      - shot: 外部删除后现场
      - label: 内存中的修改未丢（编辑器仍有本次输入）
        editor: { has: "MEM-EDIT-2" }
  - name: 保存（目标已不存在）
    do: key
    key: "cmd+s"
    expect:
      - shot: 保存失败提示
      - label: 出现「文件已被外部删除」的保存失败提示
        ax: { has: "已被外部删除" }
      - label: 提示给出「另存为新文件」动作
        ax: { has: "另存为新文件" }
      - label: 内存修改仍在
        editor: { has: "MEM-EDIT-2" }
  - name: 点「另存为新文件」
    do: click
    target: { role: AXButton, name: "另存为新文件" }
    expect:
      - shot: 另存为之后
      - label: 另存产物落盘（plain-恢复.md）
        file: { path: plain-恢复.md, exists: true }
      - label: 另存产物内容就是内存里那份（改动没丢）
        file: { path: plain-恢复.md, has: "MEM-EDIT-2" }
      - label: 另存后给出成功反馈
        ax: { has: "已另存为" }
---

说明：这条路径的触发条件是 `fs_not_found`（保存时目标已不存在），与 07 的 CAS 冲突是**两条不同分支**。
07 用「外部改写文件」触发冲突；本场景用 `vaultRm` **真删除**（不是 `vaultWrite ""` 清空——清空只会走冲突分支），
再断言三件事：① 提示文案是「已被外部删除」而不是「保存冲突」；② 「另存为新文件」动作出现；③ 另存产物
`plain-恢复.md` 真实落盘且内容 = 内存缓冲。若 ⌘S 完全无响应，① 与 ③ 都会 FAIL——不存在「保存没生效也 PASS」
的路径。替换名（`-2`…`-5` 逐级）属实现细节，本场景只钉首级产物。
