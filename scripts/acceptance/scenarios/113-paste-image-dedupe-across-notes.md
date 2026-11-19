---
id: "113-paste-image-dedupe-across-notes"
item: 113
tier: full
title: 同图跨笔记再贴不产生副本（全 vault 内容寻址去重，首贴位置赢）
steps:
  - name: 造两个不同目录下的笔记
    do: vaultWrite
    file: notes/a.md
    content: "# S2 首贴笔记\n\n"
    expect:
      - label: 首贴笔记已落盘
        file: { path: notes/a.md, has: "S2 首贴笔记" }

  - name: 造第二篇（嵌套一层的目录）
    do: vaultWrite
    file: notes/sub/b.md
    content: "# S2 再贴笔记\n\n"
    expect:
      - label: 再贴笔记已落盘
        file: { path: notes/sub/b.md, has: "S2 再贴笔记" }

  - name: 等 watch 增量把 notes 目录刷进树
    do: waitFor
    waitFor:
      has: ["/AXButton \\(notes\\)/"]
    timeoutMs: 30000

  - name: 展开 notes 目录（含它的 sub 子目录）
    do: click
    target: { any: "/^notes$/" }

  - name: 等 sub 子目录行出现
    do: waitFor
    waitFor:
      has: ["/AXButton \\(notes\\/sub\\)/"]
    timeoutMs: 30000

  - name: 展开 notes/sub
    do: click
    target: { name: "notes/sub" }
    expect:
      - label: 子目录展开后 b.md 行在场
        ax: { has: "notes/sub/b.md" }

  - name: 打开首贴笔记并贴图
    do: open
    file: notes/a.md
    marker: "S2 首贴笔记"
    expect:
      - label: 首贴笔记装载
        editor: { has: "S2 首贴笔记" }

  - name: 编辑器建立焦点（paste 前置：真实点击同时把窗口做成 key，cgevent 真键盘事件需要）
    do: clickEditor
    real: true

  - name: 剪贴板置合成 png（seed=11）
    do: clipboardImage
    synth: { width: 400, height: 260, seed: 11 }

  # 粘贴通道（M864）：⌘V 走 cgevent 真键盘事件（M859 真机实测）；原生上下文菜单 Paste 的
  # AXPress 会静默 no-op（菜单不收起、paste 不触发），不再使用——见 112 的同段注释。
  - name: ⌘V 投递 paste（第一次粘贴，cgevent 真键盘事件）
    do: key
    key: "cmd+v"
    channel: cgevent
    gapMs: 500

  - name: 等第一篇插上引用
    do: waitFor
    waitFor:
      # 等 AXImage 而非引用原文（M514）：widget 挂载前占位文本也含 `![[…]]`，按原文等会假绿。
      has: ["/AXImage[^\\n]*pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 40000
    expect:
      - label: 首贴位置 = notes/（当前笔记同目录）
        glob: { dir: notes, pattern: "pasted-[0-9a-f]{16}\\.webp$", exact: 1 }
      - shot: S2-首贴

  - name: 切到第二篇笔记
    do: open
    file: notes/sub/b.md
    marker: "S2 再贴笔记"
    expect:
      - label: 再贴笔记装载
        editor: { has: "S2 再贴笔记" }

  - name: 编辑器建立焦点（同首贴：真实点击建立 key window）
    do: clickEditor
    real: true

  - name: 剪贴板置**同一张**图（同 seed ⇒ 同字节 ⇒ 同内容寻址名）
    do: clipboardImage
    synth: { width: 400, height: 260, seed: 11 }

  - name: ⌘V 投递 paste（第二次粘贴，cgevent 真键盘事件）
    do: key
    key: "cmd+v"
    channel: cgevent
    gapMs: 500

  - name: 等第二篇也插上引用
    do: waitFor
    waitFor:
      has: ["/AXImage[^\\n]*pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 40000
    expect:
      - label: 全 vault 该哈希名文件仍只有一个（首贴位置 notes/）
        glob: { dir: notes, pattern: "pasted-[0-9a-f]{16}\\.webp$", exact: 1 }
      - label: 第二篇所在目录**没有**产生副本
        glob: { dir: notes/sub, pattern: "pasted-", exact: 0 }
      - label: 第二篇插入的是同一个文件名（去重命中，不是新副本；同 S1——引用行走图片 widget，按 AXImage label 判）
        ax: { has: "/AXImage \\(!\\[\\[pasted-[0-9a-f]{16}\\.webp\\]\\]\\)/" }
      - shot: S2-跨笔记去重

  - name: 清理本次产物
    do: vaultRm
    file: notes/a.md
---

# 同图跨笔记去重（S2，change paste-clipboard-image）

> **语义命名前提（change add-semantic-image-naming，task 8.3）**：本场景不声明 `config.harness.attachment_naming`，
> 验收默认配置没有声明 `vision` 能力的模型 ⇒ 粘贴不会触发语义命名，两处引用都是
> `pasted-<hash16>.webp`；去重判据（内容哈希）与语义命名无关，本场景的期望因此逐字不变。

## 这个场景验什么

同一张图在**两个不同目录**的笔记里各贴一次：附件只落一份（首贴位置赢），第二次不写盘、
只插引用。判据是「全 vault 该内容寻址名的文件恰好一个」+「第二个笔记所在目录没有新文件」，
不是「编辑器里看着像不像」。

`clipboardImage` 的 `seed` 相同 ⇒ 合成出的 png **逐字节相同** ⇒ 转码后 WebP 相同 ⇒
内容寻址名相同。这是本场景可复现的前提（换 seed 就是另一张图，不会再命中）。

## 覆盖边界（如实登记）

- 判的是「不该出现第二份」，不判「第二次调用确实没写盘」——后者要靠 mtime 逐字节相等
  （`mtimeUnchangedSince`）；真机上两次粘贴之间必然有别的写盘动作，因此这里用「副本数」这个
  更稳的判据，mtime 口径归 Rust 单测
  （`write_attachment_dedupes_same_image_across_dirs` 里断言首贴文件未被改写）。
