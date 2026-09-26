---
id: "41-editable-non-md-files"
item: 41
title: 非 md 文本文件可编辑——键入 / dirty / ⌘S 落盘 / 撤销收窄，外部修改走同一组冲突双逃生口
fixtures: [notes.txt, nonmd-config.yaml, LICENSE]
open: notes.txt
marker: "真机验收用的非 md 文件"
steps:
  - name: 起点：.txt 以可编辑 code 模式打开（渲染态可读、dirty 未亮）
    do: record
    as: txt 基线
    file: notes.txt
    expect:
      - label: 文件存在且可读（读不到一律 FAIL，不在空值上比较）
        file: { path: notes.txt, exists: true }
      - label: 渲染态可读（正向锚点：本次 AX 读取是活的）
        editor: { has: "真机验收用的非 md 文件" }
      - label: 起点是干净的（标签读屏名没有「未保存」后缀，D90——dirty 的唯一可读通道）
        ax: { not: "（未保存）" }
      - label: 反向输入铺底：探针此刻**不在**磁盘基线里（后面「磁盘已含探针」那条断言因此有区分度）
        file: { path: notes.txt, not: "NONMD241" }
      - shot: 起点-txt

  - name: 记下原文基线（撤销回到原文的判据要**逐字节**比，不靠「不含探针」的子串口径）
    do: recordEditor
    as: txt 原文

  - name: 建立编辑器焦点（点编辑器顶边）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里（键盘注入的前置）
        ax: { focused: "AXTextArea" }

  - name: 键入探针（非 md 文本此前只读，这一步是翻转的直接判据）
    do: type
    text: "NONMD241"
    expect:
      - label: 键入生效并回读文档文本（只断言属性在场不足以排除「假可编辑」）
        editor: { has: "NONMD241" }
      - label: dirty 出现（标签读屏名，D90）
        ax: { has: "（未保存）" }
      - shot: 键入后-dirty

  - name: 反向否证：探针此刻**不在**磁盘上（还没保存，磁盘断言必须晚于它才成立）
    expect:
      - label: 磁盘仍是基线内容（没保存就不该有）
        file: { path: notes.txt, not: "NONMD241" }
      - label: 焦点仍在编辑器里
        ax: { focused: "AXTextArea" }

  - name: 一次撤销回原文
    do: key
    key: "cmd+z"
  - name: 等标签栏重渲染（dirty 点的读屏名更新）
    do: sleep
    ms: 500
    expect:
      - label: 探针已从文档里消失（回读文档文本，不是看属性）
        editor: { not: "NONMD241" }
      - label: 文档与原文**逐字节**相同（子串口径挡不住「部分撤销」——REVIEW.md 第 1 条）
        editor: { unchangedSince: txt 原文 }
      - shot: 撤销后-回原文

  - name: 再键入探针
    do: type
    text: "NONMD241"
    expect:
      - label: 第二次键入同样生效
        editor: { has: "NONMD241" }

  - name: ⌘S 保存（chord 盲发不重试——丢键时下面的磁盘断言会红，按 README 复跑一次再判）
    do: key
    key: "cmd+s"

  - name: 等 600ms（**短于** 2s 自动保存防抖 ⇒ 下面这条只可能由 ⌘S 满足）
    do: sleep
    ms: 600
    expect:
      - label: 磁盘字节已含探针（⇔ ⌘S 真的走了保存链路，不是自动保存兜的底）
        file: { path: notes.txt, has: "NONMD241" }
      - label: 磁盘上的原句仍在（原子替换没有把文件写残）
        file: { path: notes.txt, has: "真机验收用的非 md 文件" }
      - shot: 保存后-fs

  - name: 等标签栏重渲染后核对保存后的 dirty 收窄
    do: sleep
    ms: 500
    expect:
      - label: 保存成功且此后无编辑 ⇒ dirty 收窄（保存链路与 md 同一条）
        ax: { not: "（未保存）" }

  - name: 换文件：.yaml（注册表的 code 类）
    do: open
    file: nonmd-config.yaml
    marker: "count: 3"
    expect:
      - label: 新文件已装载（渲染态可读）
        editor: { has: "count: 3" }
      - label: 新会话是干净的
        ax: { not: "（未保存）" }

  - name: 建立编辑器焦点
    do: clickEditor
    expect:
      - label: 焦点在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 键入探针（yaml 同样可编辑）
    do: type
    text: "NONMD-YAML"
    expect:
      - label: 键入生效
        editor: { has: "NONMD-YAML" }
      - label: dirty 出现
        ax: { has: "（未保存）" }

  - name: 外部改写磁盘（制造 CAS 冲突；dirty 同时把自动保存置于暂停态，撞窗口问题不存在）
    do: vaultWrite
    file: nonmd-config.yaml
    content: "count: 99\n"
    expect:
      - label: 外部版本已落盘（本步的前提是它确实写进去了）
        file: { path: nonmd-config.yaml, has: "count: 99" }

  - name: ⌘S 触发冲突
    do: key
    key: "cmd+s"
    expect:
      - shot: yaml-冲突提示
      - label: 冲突提示说明内存修改未丢失（M124 文案）
        ax: { has: "保存冲突" }
      - label: 冲突提示给出两个逃生口
        ax: { has: "重新载入" }
      - label: 冲突提示给出强制覆盖动作
        ax: { has: "强制覆盖" }
      - label: 磁盘仍是外部版本（MUST NOT 静默覆盖）
        file: { path: nonmd-config.yaml, has: "count: 99" }

  - name: 点「强制覆盖保存」
    do: click
    target: { role: AXButton, name: "强制覆盖保存" }
    expect:
      - shot: yaml-二次确认
      - label: 出现不可撤销的二次确认文案（覆盖前的知情代价）
        ax: { has: "/不可撤销|确认强制覆盖/" }
      - label: 二次确认给出「覆盖保存」动作
        ax: { has: "覆盖保存" }

  - name: 确认覆盖
    do: click
    target: { role: AXButton, name: "覆盖保存" }
    expect:
      - label: 磁盘已被内存内容覆盖（非 md 的强制覆盖与 md 同一条链路）
        file: { path: nonmd-config.yaml, has: "NONMD-YAML" }
      - label: 覆盖后不再是外部版本
        file: { path: nonmd-config.yaml, not: "count: 99" }
      - label: 给出强制覆盖成功反馈
        ax: { has: "已强制覆盖保存" }
      - shot: yaml-覆盖后

  - name: 再键入一段（`⌘S` 对干净文档会提前返回，不触发保存——先让它回到 dirty）
    do: type
    text: "NONMD-GONE"
    expect:
      - label: 键入生效
        editor: { has: "NONMD-GONE" }
      - label: 文档回到 dirty
        ax: { has: "（未保存）" }

  - name: 外部删除 .yaml 再保存：走「另存为新文件」，副本保留原扩展名（§3.8 / 新命令 create_file 的真机覆盖）
    do: vaultRm
    file: nonmd-config.yaml
    expect:
      - label: 文件已从磁盘删除（下一步的 fs_not_found 才有前提）
        file: { path: nonmd-config.yaml, exists: false }

  - name: ⌘S 触发 fs_not_found
    do: key
    key: "cmd+s"
    expect:
      - shot: 外部删除-提示
      - label: 提示说明内存修改未丢失（SAVE_ERROR_HINTS 的 fs_not_found 文案）
        ax: { has: "已被外部删除或移动" }
      - label: 提示给出「另存为新文件」动作
        ax: { has: "另存为新文件" }

  - name: 点「另存为新文件」
    do: click
    target: { role: AXButton, name: "另存为新文件" }
  - name: 等副本创建 + 写入 + 切标签
    do: sleep
    ms: 2000
    expect:
      - label: 副本保留了原扩展名（`.yaml`，不是 `.md`）且含内存内容
        file: { path: nonmd-config-恢复.yaml, has: "NONMD-GONE" }
      - label: 内存里的前一段修改也在副本里（不是只落了最后一次键入）
        file: { path: nonmd-config-恢复.yaml, has: "NONMD-YAML" }
      - label: 反向：没有生成 `.md` 形态的副本（那正是 §3.8 要修的「错误的文件类型」）
        file: { path: nonmd-config-恢复.md, exists: false }
      - label: 给出「已另存为」反馈
        ax: { has: "已另存为" }
      - shot: 另存为-新副本

  - name: 换文件：无扩展名的 LICENSE
    do: open
    file: LICENSE
    marker: "Permission is hereby granted"
    expect:
      - label: 新文件已装载（basename 无点的文件同样进编辑器）
        editor: { has: "Permission is hereby granted" }

  - name: 建立编辑器焦点
    do: clickEditor
    expect:
      - label: 焦点在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 键入探针（无扩展名文件可编辑）
    do: type
    text: "NONMD-LICENSE"
    expect:
      - label: 键入生效
        editor: { has: "NONMD-LICENSE" }
      - label: dirty 出现
        ax: { has: "（未保存）" }

  - name: 等自动保存落盘（2s 防抖 + 余量；这一步刻意不用 ⌘S，让写盘必然发生）
    do: sleep
    ms: 2600
    expect:
      - label: 无扩展名文件同样落盘（保存链路不看扩展名）
        file: { path: LICENSE, has: "NONMD-LICENSE" }
      - label: dirty 收窄（保存成功）
        ax: { not: "（未保存）" }
      - shot: LICENSE-落盘

teardown:
  - label: 收尾：.txt 停在含探针的已保存形态
    file: { path: notes.txt, has: "NONMD241" }
  - label: 收尾：被外部删除的 .yaml 已由「另存为新文件」落成保留扩展名的副本
    file: { path: nonmd-config-恢复.yaml, has: "NONMD-GONE" }
  - label: 收尾：LICENSE 停在含探针的已保存形态
    file: { path: LICENSE, has: "NONMD-LICENSE" }
---

# 非 md 文本文件可编辑（change editable-non-md-files / M241）

## 这个场景验什么

Alex 节点 1 裁决 D1/D2/D3（注册表全量文本类可编辑 / code 模式编辑 / 保存链路全量复用）落地后，
非 md 文本文件的**编辑—保存闭环**在真实 WKWebView 下的行为链：打开 → 键入 → dirty → 撤销 →
⌘S 落盘 → 冲突双逃生口。三种形态各一：`.txt`（未收录扩展）、`.yaml`（注册表的 code 类）、
`LICENSE`（basename 无点）。

1. **可编辑**：`.txt` 上键入探针后 `AXTextArea.value` 里读得到它（M130 起这里是「整批拒收」）。
2. **dirty 可读**：标签读屏名的「（未保存）」（D90）是 dirty 在 AX 里唯一的出口。
3. **撤销回原文**：一次 ⌘Z 把文档**逐字节**还原到原文（判据是 `recordEditor` 基线 + `unchangedSince`，
   不是「不含探针」的子串口径——那一版挡不住「部分撤销」，M241 首轮真机就踩过）。
4. **⌘S 真的走保存链路**：探针落进磁盘文件；**判据窗口是 600ms（短于 2s 自动保存防抖）**，
   因此这条断言只可能由 ⌘S 满足——否则「文件里有内容」会被自动保存兜底而失去区分度。
   保存后另有一条 dirty 收窄断言（保存成功且此后无编辑 ⇒ 必然收窄，确定性成立）。
5. **冲突与强制覆盖（非 md 与 md 同形）**：外部改写磁盘 → ⌘S → `document_conflict` 的 sticky
   提示（说明内存修改未丢失 + 两个逃生口 + 磁盘未被静默覆盖）→ 点「强制覆盖保存」→ 二次确认
   （不可撤销）→ 确认 → 磁盘变成内存版本。
6. **无扩展名文件**：`LICENSE` 同样可编辑，且自动保存把它写回**原文件**（不是新开 `.md`）。

**「撤销后 dirty 收窄」为什么不在这里断言**：那个状态只在不发生保存时才成立（撤销回原文 ==
撤销回 `cleanDoc`），而本套件的键盘注入每步约 250ms + 一次 MCP 往返，2s 自动保存防抖**必然**
可能落在「键入」与「⌘Z」之间——M241 首轮真机就实测到了：AX 里出现「已自动保存」toast，随后
⌘Z 把内存恢复到原文（逐字节断言 PASS），而内存与**已保存版本**（含探针）不再相同，dirty 如实
保持 true。也就是说 app 行为是对的，是断言选错了通道（与 README「dirty 拦截门的可测窗口很窄」
同一根因）。该状态由 **chromium 视觉通道**覆盖：`tests/visual/scenes/m130-text-open-trap.spec.ts`
的「键入生效 / dirty / ⌘S 落盘 / 撤销回到原文后 dirty 收窄」用例（注入无 MCP 往返，2s 内可稳定
完成「键入 → ⌘Z」，逐字节 + dirty 双判据）。

## 判据走哪几条通道（可读性如实登记）

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 键入是否生效 | **`editor.has`（AXTextArea.value 回读）** | `contenteditable` 属性在场不等于按键能进文档——「假可编辑」形态正是属性绿、按键被 dispatch 层吞掉（REVIEW.md 第 1 条家族）。回读文档文本才有区分度 |
| dirty | **标签读屏名的「（未保存）」（D90）** | 套件读不到 dirty 位；标签 aria-label 是它唯一的可读出口。断言只用在**本场景自己刚编辑过**的文件上（每次运行 vault 都从 fixtures/ 重置） |
| ⌘S 是否真的保存 | **600ms 窗口内的磁盘内容 + 保存前的「磁盘不含探针」反向铺底** | 2s 自动保存防抖会让「文件里有内容」恒真（失去区分度）；反向铺底让「探针出现在磁盘」这件事只可能由保存造成 |
| 冲突与逃生口 | `ax.has`（提示文本 / 动作标签）+ **点动作后的磁盘事实** | 只断言「提示出现了」验不到逃生口真的能用；覆盖后读磁盘才是闭环判据 |
| 覆盖未静默 | **覆盖前断言磁盘仍是外部版本** | 「外部版本还在」是负向事实，必须先确认读到的是真值（file.exists 已在起点断言） |

## 已知边界

- **⌘S / ⌘Z 是 chord，套件盲发不重试**（README「已知边界」）。丢了就是本场景红：`⟨保存后-fs⟩`
  那条红 ⇒ 先复跑一次再判产品缺陷；`⟨撤销后-收窄⟩` 的 `editor.not` 红 ⇒ 可能是 ⌘Z 丢了。
  autosave 兜底那一步（LICENSE）刻意只用 2.6s 等待，不受丢键影响。
- **`type` 走回读 + 只在字节完全未变时重试**（≤3），partial landing 直接报错——所以「键入生效」
  那几条不是盲发的运气。
- **不做手感判定**：非 md 编辑的输入手感（无高亮扩展的纯文本、行号区）归 Alex，本场景只留截图。
- **不覆盖**：① 自动保存单独行为的细节归 `08-autosave`；② 冲突后「重新载入」分支归
  `07-recovery-paths`/`08b-autosave-pause`（本场景只走强制覆盖那条，避免重复）；③ 未被外部删除
  时的「另存为新文件」（非 md 保留原扩展名）由 `tests/unit/save-controller.test.ts` 的
  `recoveryCopyPath` 判定与 Rust `link_graph::tests::create_file_preserves_extension_and_never_overwrites`
  覆盖，本场景不驱动它（真机点 toast 动作 + 读新文件名的链路与 07b 同形，属重复覆盖）。
