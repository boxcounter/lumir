---
id: "42-non-md-edit-guardrails"
item: 42
title: 非 md 可编辑的护栏矩阵——二进制仍「暂不支持预览」、非 UTF-8 打开即拒、文本类不受牵连
fixtures: [lightbox-bitmap.png, invalid-utf8.bin, notes.txt]
open: notes.txt
marker: "真机验收用的非 md 文件"
steps:
  - name: 正向对照：同一 vault 里的文本类文件是可编辑的（护栏没有把整类文件一起挡掉）
    do: record
    as: txt 基线
    file: notes.txt
    expect:
      - label: 文件存在且可读
        file: { path: notes.txt, exists: true }
      - label: 文本类照常进编辑器（渲染态可读）
        editor: { has: "真机验收用的非 md 文件" }
      - label: 起点干净
        ax: { not: "（未保存）" }
      - shot: 起点-文本类可编辑

  - name: 二进制（image 类）：点击给「暂不支持预览」，不进编辑器
    do: click
    target: { role: AXButton, name: "^lightbox-bitmap.png$" }
    expect:
      - shot: 二进制-提示
      - label: 覆盖层给出「暂不支持预览」（M130 起的护栏，本 change 不动它）
        ax: { has: "暂不支持预览" }
      - label: 提示点名的是被点击的那个文件（判据有区分度：不是别的提示恰好在场）
        ax: { has: "暂不支持预览：lightbox-bitmap.png" }
      - label: 反向：没有出现任何 dirty（二进制不进编辑器 ⇒ 不可能有内存修改）
        ax: { not: "（未保存）" }

  - name: 非 UTF-8（扩展名未收录 ⇒ text 类 ⇒ 真去读文件）：打开即拒
    do: click
    target: { role: AXButton, name: "^invalid-utf8\\.bin$" }
    expect:
      - shot: 非-utf8-提示
      - label: 给出「不是合法 UTF-8 编码」的人话提示（Rust 侧 fs_invalid_utf8 的文案）
        ax: { has: "不是合法 UTF-8 编码（可能是 GBK 等其他编码），暂不支持读取" }
      - label: 提示点名被点击的文件（同一条判据的第二个坐标）
        ax: { has: "文件 invalid-utf8.bin 不是合法 UTF-8 编码" }
      - label: 没有产生 dirty
        ax: { not: "（未保存）" }

  - name: 恢复：点回文本类文件仍可编辑（两次护栏拒绝没有把 app 卡住）
    do: open
    file: notes.txt
    marker: "真机验收用的非 md 文件"
    expect:
      - label: 编辑器重新可读（覆盖层被撤下）
        editor: { has: "真机验收用的非 md 文件" }
  - name: 建立编辑器焦点（`open` 是点树行，焦点留在树行上——不回编辑器就断言不了落点）
    do: clickEditor
    expect:
      - label: 仍是可编辑的（焦点能进编辑器正文，不是退化成只读）
        ax: { focused: "AXTextArea" }

  - name: 造一份 51 MiB 的超大文本文件（稀疏文件：大小 = 51MiB、几乎不占磁盘）
    do: vaultSparse
    file: huge.log
    size: 53477376
  - name: 等文件树吸收新条目（watch 增量 → 树补丁 → 渲染；settle 等界面稳定）
    do: settle
    expect:
      - label: 它已出现在左栏文件树里（稀疏文件同样是 vault 内的一等条目）
        ax: { has: "huge.log" }

  - name: 点击超大文件：打开即拒（按大小，不按扩展名）
    do: click
    target: { role: AXButton, name: "^huge\\.log$" }
    expect:
      - shot: 超大文件-提示
      - label: 给出「超过上限，已拒绝读取」的人话提示（Rust 侧 fs_too_large 的文案）
        ax: { has: "超过 50MB 上限，已拒绝读取" }
      - label: 提示点名被点击的文件（判据有区分度）
        ax: { has: "文件 huge.log" }
      - label: 反向：没有出现 dirty（超大文件不进编辑器）
        ax: { not: "（未保存）" }

  - name: 建立编辑器焦点并键入探针（翻转后的文本类没有被护栏误伤）
    do: open
    file: notes.txt
    marker: "真机验收用的非 md 文件"
    expect:
      - label: 编辑器重新可读（超大文件的提示覆盖层被撤下）
        editor: { has: "真机验收用的非 md 文件" }
  - name: 建立编辑器焦点
    do: clickEditor
    expect:
      - label: 焦点在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 键入
    do: type
    text: "GUARD241"
    expect:
      - label: 键入生效
        editor: { has: "GUARD241" }
      - label: dirty 出现
        ax: { has: "（未保存）" }

  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: 文本类照常落盘（护栏只挡二进制与非 UTF-8）
        file: { path: notes.txt, has: "GUARD241" }
      - label: dirty 收窄
        ax: { not: "（未保存）" }
      - shot: 收尾-文本类可写

teardown:
  - label: 收尾：被拒的二进制文件逐字节未动
    file: { path: lightbox-bitmap.png, exists: true }
  - label: 收尾：被拒的非 UTF-8 文件逐字节未动
    file: { path: invalid-utf8.bin, exists: true }
  - label: 收尾：文本类停在含探针的已保存形态
    file: { path: notes.txt, has: "GUARD241" }
---

# 非 md 可编辑的护栏矩阵（change editable-non-md-files / M241，裁决 D4）

## 这个场景验什么

裁决 D4「护栏维持既有层」：可编辑面放开到注册表全量文本类，**不**放宽边界。本场景把三条边界
在真机 WKWebView 上逐条走一遍，并配一条正向对照（文本类没被误伤）：

| 护栏 | 现状锚点 | 本场景的判据 |
|---|---|---|
| image / binary 类不进编辑器 | `src/tree.ts` 的 `openKind` → `src/main.ts` 的 `showNotice("暂不支持预览：…")` | 点击后覆盖层出现该提示**且点名该文件**；没有 dirty |
| 非 UTF-8 文本打开即拒 | Rust `fs_io::read_text_snapshot` 的 `from_utf8` 失败 → `fs_invalid_utf8` 人话文案 → 前端覆盖层 | 点击后出现「不是合法 UTF-8 编码」；没有 dirty |
| 超 50MB 拒读 | Rust `fs_io::read_file_bytes` 的 `meta.len() > ATTACHMENT_MAX_BYTES` → `fs_too_large` 人话文案 | 点击 51MiB 的 `huge.log` 后出现「超过 50MB 上限，已拒绝读取」；没有 dirty |
| 文本类不被牵连 | —— | 同一 vault 的 `.txt` 编辑、dirty、落盘全程照常 |

`invalid-utf8.bin` 是第二条分支**唯一**的真机入口：扩展名 `.bin` 未收录 ⇒ `fileClass` 为 `text`
⇒ 前端不按二进制分流、真去读文件 ⇒ Rust 解码失败。图像 fixture（如本场景的
`lightbox-bitmap.png`）走不到这里——它被 `openKind → "binary"` 提前分流，**从不读内容**。
两类的分流点在 `openKind` 是同一条（都是 `"binary"`），所以 image 类那次点击覆盖的是同一条
前端护栏路径。

`huge.log` 由 `do: vaultSparse`（M241 起的新动作：`open` + `ftruncate`）造出：**大小 51MiB、
内容全零、几乎不占磁盘**。这是第三条分支能在真机上被触发的唯一干净做法——提交一份 50MB+ 的
实体 fixture 不可接受，而 `vaultWrite` 的 content 是字符串、写不出「大而空」的文件。`.log`
是未收录扩展 ⇒ 文本类 ⇒ 前端真去读 ⇒ Rust 在**分配前**按大小拒绝（`read_file_bytes` 的校验
早于 `std::fs::read`，所以这条拒绝不会真的读进 51MiB 内存）。

## 判据走哪几条通道

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 护栏提示真的出现 | `ax.has`（覆盖层文本）+ **点名文件名的第二条断言** | 只判「暂不支持预览」会与别的提示混淆；点名让断言只可能被这一次点击满足 |
| 提示覆盖层在场 | `ax.has` / `ax.not` | 覆盖层在场时 AX 里**没有** `AXTextArea`（README 已知边界）——此时 `editor.*` 一律记 FAIL，所以本场景在这几处只用 `ax.*` |
| 没产生内存修改 | 标签读屏名的「（未保存）」缺席（D90） | 套件读不到 dirty 位；二进制/非法编码的文件连会话都不该建立，dirty 必然缺席 |
| 文本类没被误伤 | `editor.has` + `type` 回读 + 磁盘内容 | 护栏若写宽（例如按「非 md 一律拒」或「超 50MB 一律禁编辑」）会在这里立刻红——这是本场景的**正向对照**，防止「护栏矩阵全绿但功能整体失效」的假绿 |

## 已知边界

- **不做手感判定**：覆盖层的排版/观感归 Alex，本场景只留截图。
- **`vaultSparse` 只造「大小」，不造内容**：它的用途就是把按大小拒绝这条分支变成可达（第三条
  护栏的判据是文件大小，与内容无关）。因此本场景**不**覆盖「51MiB 的合法文本被拒」这一形态的
  另一面（它必然同样被拒——同一条 `meta.len()` 校验）。
- **`huge.log` 留在验收 vault 里**：套件每次运行都把 vault 重置为 `fixtures/` 的精确副本，
  稀疏文件随之消失，不会跨场景串场（也不占磁盘）。
- 覆盖层的关闭路径：本场景靠「点回一个可打开的文件」撤下覆盖层（`showEditor`），与 M149 的
  既有口径一致；覆盖层自身的其它形态（读取失败等）归 `20-image-fallback` 一族的场景。
