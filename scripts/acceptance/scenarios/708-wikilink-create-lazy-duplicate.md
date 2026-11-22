---
id: "708-wikilink-create-lazy-duplicate"
item: 708
tier: full
title: 一键创建——索引外同名笔记（用户规则惰性目录）安全拒绝，不造重复
fixtures: [links-lazy-duplicate.md]
seed:
  # 合成惰性现场：根 `.gitignore` 声明 `.local/`，其下有 `tutorial.md`（正文 marker 见
  # `lib/app.mjs` 的 LAZY_PROBE_MD）。惰性条目不进链接索引 ⇒ 根文档里的 `[[tutorial]]`
  # 解析为 unresolved，这正是本场景要压的路径。bulkVault 的形状参数取小档：本场景判的是
  # 行为，不是规模读数（规模口径归场景 67 / perf 通道）。
  bulkVault:
    markdown: 25
    files: 10
    dirs: 8
    mdBytes: 900000
    maxMdBytes: 20000
    ignoredMd: 1
    lazyDirs:
      gitignore: [".local"]
open: links-lazy-duplicate.md
marker: "tutorial"
steps:
  - name: 记录惰性目录里同名笔记的初始字节（record 目标不存在即报错）
    do: record
    as: lazyNote
    file: ".local/tutorial.md"
    expect:
      - label: 基线文件在盘上且正文 marker 可读（「同名笔记真实存在」的见证）
        file: { path: ".local/tutorial.md", has: "本地教程正文" }

  - name: 渲染态：wikilink 装饰为目标名，源码不显露
    do: settle
    expect:
      - label: 链接渲染成目标名（光标在文档首、不触发源码显露）
        editor: { has: "tutorial" }
      - label: 源码方括号不显露
        editor: { not: "[[tutorial]]" }
      - shot: 01-渲染态

  - name: ⌘⏎ 跟随未解析的 wikilink
    do: key
    key: "cmd+return"
    expect:
      - shot: 02-未创建提示
      - label: 只给「未创建的链接」提示（带一键创建入口）
        ax: { has: "未创建的链接" }
      - label: 提示里有「创建并打开」动作按钮
        ax: { has: "创建并打开" }
      - label: 跟随不自动创建文件（创建必须是作者在提示里的显式动作）
        file: { path: "tutorial.md", exists: false }

  - name: 点「创建并打开」——索引外同名笔记必须安全拒绝
    do: click
    target: { name: "^创建并打开$" }

  - name: 等 D192 上屏
    do: waitFor
    waitFor:
      has: ["目标已存在（索引可能已过期）"]
    timeoutMs: 15000

  - name: 拒绝后：仍在原文档、零新文件、既有字节与 mtime 不变
    do: settle
    expect:
      - label: D192 文案在场（目标已存在、索引可能已过期）
        ax: { has: "目标已存在（索引可能已过期）" }
      - label: 没有自动打开或重绑——仍停在原文档
        editor: { has: "占位段落：点「创建并打开」之后仍应停在这里。" }
      - label: vault 根没有多出一份 tutorial.md（拒绝不落盘）
        file: { path: "tutorial.md", exists: false }
      - label: 惰性目录里那份笔记逐字节不变（sha256）
        file: { path: ".local/tutorial.md", unchangedSince: lazyNote }
      - label: 且没有被改写（mtime 精确相等；sha256 相同不足以排除同内容重写）
        file: { path: ".local/tutorial.md", mtimeUnchangedSince: lazyNote }
      - shot: 03-拒绝后仍原文档

  - name: 正见证：被拒绝的那份笔记真实存在且可读（惰性目录路径直读）
    do: open
    file: .local/tutorial.md
    marker: 本地教程正文
    expect:
      - label: 正文就位（拒绝针对的是真实存在的笔记，不是空输入上的假绿）
        editor: { has: 本地教程正文 }
      - shot: 04-惰性笔记可读
---

# 708 一键创建：索引外同名笔记安全拒绝

判据一句话：**索引里没有 ≠ 磁盘上没有**。`[[tutorial]]` 在打开的文档里是未创建态，但
`.local/tutorial.md` 真实存在（用户规则命中 ⇒ 不进索引）。点「创建并打开」必须得到 D192，
而不是在文档所在目录新建一份 `tutorial.md` 造成重复。

为什么用 `seed.bulkVault.lazyDirs` 而不是 `vaultWrite`：`[[tutorial]]` 必须在 **vault 打开
时**就解析为 unresolved——惰性判定来自根 `.gitignore`，`vaultWrite` 在起 app 之后才写，晚于
首次枚举与索引建立。

证据口径：

- 「拒绝」的正向见证 = D192 文案 + 提示按钮（同一份 AX 快照里读到）；
- 「不造重复」= 根下 `tutorial.md` 不存在 + 原文档逐字仍在（编辑器未被替换）；
- 「既有文件零改动」= `record` 的 sha256 与 mtime 两项都比（只比 sha256 会被「同内容重写」
  瞒过，只比 mtime 会被「改了又改回」瞒过）；
- 「同名笔记真实存在」= 最后一步按路径直读 `.local/tutorial.md`，正文 marker 上屏。
