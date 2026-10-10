---
id: "116-paste-image-transcode-size"
item: 116
title: 转码体积实证（2560×1920 类截图：剪贴板字节 vs 落盘字节，证据型）
steps:
  - name: 造笔记并打开（落盘目录 = 当前笔记同目录）
    do: vaultWrite
    file: notes/s5.md
    content: "# S5 体积实证\n\n"
    expect:
      - label: 笔记已落盘
        file: { path: notes/s5.md, has: "S5 体积实证" }

  - name: 等 watch 增量把 notes 目录刷进树（行进场再点，不等则点击会扑空）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(notes\\)/"]
    timeoutMs: 30000

  - name: 展开 notes 目录
    do: click
    target: { any: "/^notes$/" }
    expect:
      - label: notes 目录行在场（watch 增量已刷新）
        ax: { has: "/AXButton \\(notes\\)/" }

  - name: 打开笔记
    do: open
    file: notes/s5.md
    marker: "S5 体积实证"

  - name: 编辑器建立焦点
    do: clickEditor

  - name: 剪贴板置 Retina 尺寸（2560×1920）的合成类截图
    do: clipboardImage
    synth: { width: 2560, height: 1920, seed: 31 }
    expect:
      - shot: S5-置剪贴板

  - name: 右键 → 原生菜单 Paste
    do: click
    target: { role: AXTextArea, button: right }

  - name: 点 Paste
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }

  - name: 等落盘完成
    do: waitFor
    waitFor:
      has: ["/!\\[\\[pasted-[0-9a-f]{16}\\.webp\\]\\]/"]
    timeoutMs: 40000
    expect:
      - label: 落盘出现转码后的附件
        glob: { dir: notes, pattern: "pasted-[0-9a-f]{16}\\.webp$", exact: 1 }
      - label: 落盘字节是 WebP 容器
        bytes: { path: "notes/pasted-*.webp", magic: "52494646" }
      - shot: S5-落盘

  # 证据型读数（不卡 PASS/FAIL）：两行 note 分别是落盘 WebP 的字节数与剪贴板合成 png 的字节数
  # ——比值（落盘 / 剪贴板）由人读证据目录时算，回填 design §4.2 的经验值表。
  - name: 记录落盘文件字节数（证据）
    do: note
    text: "S5 落盘"
    file: "notes/pasted-*.webp"
    expect:
      - shot: S5-读数

  - name: 再记一次剪贴板侧读数（同一张图重合成一次，读数与本次粘贴的输入逐字节相同）
    do: clipboardImage
    synth: { width: 2560, height: 1920, seed: 31 }

  - name: 清理
    do: vaultRm
    file: notes/s5.md
---

# 转码体积实证（S5，change paste-clipboard-image）

## 这个场景验什么

Alex 的原始动机（节点 1 裁决原话）：「macOS 系统截图到剪贴板很大，经常十几兆二十几兆」。
本场景把「转码后到底小多少」落成**可复现的实测读数**：合成一张 2560×1920（Retina 2x）的类截图
→ 经真机粘贴落盘 → 证据目录里同时得到「剪贴板 png 字节数」与「落盘 WebP 字节数」。

**证据型，不卡 PASS/FAIL**（design §7 的口径）：数字本身随图片内容变，硬编码一个阈值只会
制造一条碰运气的断言。这里只判「落盘出现且是 WebP 容器」，比值由这两个读数算出。

## 读数怎么取

- 剪贴板侧：`clipboardImage` 动作把合成 png 的字节数写进证据（note 行），同一 seed 重合成
  两次得到的是**逐字节相同**的图，因此第二次的读数就是本次粘贴的输入大小。
- 落盘侧：`note` 动作带 `file` 时把命中文件（glob 取 mtime 最新一份）的 `size` 附在 note 行里。

## 与 design §4.2 的关系

design §4.2 的经验值表（WebP 无损 ≈ PNG 的 30–60%）标注为「未实测，实现期 fixture 填实测」；
本场景产出的比值即回填来源（M415 探针的另一半读数：剪贴板经 WebKit 归一化后是 **PNG 字节**
约 0.6MB，不是 pasteboard 上那个十几兆的 TIFF flavor——§4.1 引用的 18.8MB 不进入 web 链路）。
