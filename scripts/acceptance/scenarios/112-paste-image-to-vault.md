---
id: "112-paste-image-to-vault"
item: 112
tier: core
title: 贴剪贴板图片入 vault（落盘笔记同目录 + 转码 + 内容寻址命名 + 引用 + 渲染）
steps:
  - name: 造 notes/s1.md（vaultWrite 支持嵌套路径）
    do: vaultWrite
    file: notes/s1.md
    content: "# S1 粘贴目标\n\n正文一行。\n"
    expect:
      - label: 嵌套笔记已落盘
        file: { path: notes/s1.md, has: "S1 粘贴目标" }

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

  - name: 打开 notes/s1.md
    do: open
    file: notes/s1.md
    marker: "S1 粘贴目标"
    expect:
      - label: 笔记装载进编辑器
        editor: { has: "S1 粘贴目标" }

  - name: 编辑器建立焦点（paste 前置：真实点击同时把窗口做成 key，cgevent 真键盘事件需要）
    do: clickEditor
    real: true
    expect:
      - shot: S1-打开笔记

  - name: 剪贴板置合成 png（AppleScript «class PNGf» 标准通道）
    do: clipboardImage
    synth: { width: 480, height: 320, seed: 7 }

  # 粘贴通道（M864）：⌘V 走 cgevent 真键盘事件 → 真实 WKWebView 的 paste 事件（M859 真机实测）。
  # 原生上下文菜单 Paste 的 AXPress 会静默 no-op（菜单不收起、paste 不触发，finding
  # 20261120-worker-html-only-paste-improve-cgevent-v-paste-axpress），不再使用。
  - name: ⌘V 投递 paste（cgevent 真键盘事件；真实 WKWebView 的 paste 事件）
    do: key
    key: "cmd+v"
    channel: cgevent
    gapMs: 500

  - name: 等附件落盘并渲染成图片 widget（状态驱动，不用 sleep 猜时长）
    do: waitFor
    waitFor:
      # 判据必须落在**渲染结果**上，不能落在引用原文上（M514 的现场）：图片 widget 挂载之前，
      # 编辑器把这条引用渲染成「附件未找到：![[pasted-<hash16>.webp]]」的占位文本，同一份 AX
      # 文本里也**含有**那串 `![[…]]`——原判据（`has: ["/!\\[\\[pasted-…\\]\\]/"]`）因此在
      # widget 还没挂载时就成立，紧随其后的两条 AX 断言对着「无 AXImage 节点」的快照判红
      # （证据 `.local/acceptance/2026-10-14-full/112-paste-image-to-vault/`：02/03 号
      # dump 只有占位文本，同一 run 的 04 号截图步 dump 里节点完好）。
      # 改等 `AXImage` 节点本身——与下面那条断言同一口径，盘侧两条断言在这之后按终态判。
      has: ["/AXImage[^\\n]*pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 40000
    expect:
      - label: 笔记同目录出现转码后的附件（恰好一个）
        glob: { dir: notes, pattern: "pasted-[0-9a-f]{16}\\.webp$", exact: 1 }
      - label: 落盘字节是 WebP 容器，且文件名哈希 = 落盘字节 sha256 前 16 位
        bytes: { path: "notes/pasted-*.webp", magic: "52494646", nameHash: true }
      - label: 文档插入 ![[pasted-<hash16>.webp]] 引用（编辑器把该行渲染成图片 widget，AXTextArea value 不含它；按实跑 AX 形态断言编辑器子树的图片节点 label）
        ax: { has: "/AXImage \\(!\\[\\[pasted-[0-9a-f]{16}\\.webp\\]\\]\\)/" }
      - label: live preview 渲染出该图片（AX 有引用这条附件的图片节点）
        ax: { has: "/AXImage[^\n]*pasted-[0-9a-f]{16}\\.webp/" }
      - shot: S1-贴图入vault

  # 语义命名（change add-semantic-image-naming，task 8.4）：本场景**不**声明
  # `config.harness.attachment_naming`，走的是验收套件的默认配置——provider 为 kimi（默认值）、
  # 没有声明任何 models（更没有 `vision: true`）⇒ 命名资格判定为「无可用 vision 模型」⇒
  # 不发起请求、保持暂存名、不弹 toast。
  # 观察窗口给足 3 秒（mock / 真 provider 都不该在这段时间里出现语义名），再按终态判一次。
  - name: 观察窗口：默认配置下不发起语义命名（保持暂存名、无命名 toast）
    do: sleep
    ms: 3000
    expect:
      - label: vault 内不存在语义名文件（`<slug>-<hash6>.webp`）
        glob: { dir: notes, pattern: "[a-z0-9-]+-[0-9a-f]{6}\\.webp$", exact: 0 }
      - label: 暂存名文件仍在（重命名没有发生）
        glob: { dir: notes, pattern: "pasted-[0-9a-f]{16}\\.webp$", exact: 1 }
      - label: 没有命名成功 toast、也没有失败 toast（失败是静默降级）
        ax: { not: "/已命名为 /" }
      - shot: S1-无语义命名

  - name: 清理本次产物，不给后续场景留残留
    do: vaultRm
    file: notes/s1.md
---

# 剪贴板贴图入 vault（S1，change paste-clipboard-image）

> **语义命名前提（change add-semantic-image-naming，task 8.3）**：本场景不声明 `config.harness.attachment_naming`，
> 验收默认配置是 `provider = kimi` 且 `models` 未声明任何模型（也就没有 `vision: true`），
> 因此粘贴**不会**触发语义命名，`pasted-<hash16>` 终态期望不变；文末另有一条「观察窗口」步
> 显式断言这一点（无语义名文件、无命名 toast）。

## 这个场景验什么

从**真机粘贴**到**落盘 + 引用 + 渲染**的整条链路：md 笔记聚焦 → 剪贴板置一张合成 png →
⌘V（cgevent 真键盘事件，真实 WKWebView 的 paste 事件）→ 附件落在**当前笔记同目录**、
字节是转码后的 WebP 容器、文件名是**内容寻址**形态（`pasted-<落盘字节 sha256 前 16 位>.webp`），
文档插入 `![[name]]` 引用且 live preview 渲染出来。

## 为什么这么驱动

- **粘贴通道**：`do: key { key: "cmd+v", channel: cgevent }`（M864 起）。M859 真机实测这条通道
  **投递了真实 paste 事件**；README 里「⌘V 注入不落地」是 KimiCU `press_key` 通道的结论
  （M345/M456），不适用于 M767 的 cgevent 通道。旧的「右键唤出原生上下文菜单 → 点 Paste」通道
  已弃用：M859 实测 AXPress 到 AXMenuItem 会**静默 no-op**（菜单不收起、paste 不触发，且间歇
  复现），判据容易变成假 FAIL 或假绿（finding
  `20261120-worker-html-only-paste-improve-cgevent-v-paste-axpress.md`）。
- **cgevent 的前置**：Lumir 在前台、窗口是 key window、焦点在编辑器——`clickEditor real: true`
  一次真实点击同时满足后两条（KimiCU 坐标点击会让窗口丢 key，见 README 的 `clickEditor` 条）。
- **后果断言**：粘贴本身不直接判绿；判据落在**落盘**（glob + WebP 容器 + 内容寻址命名）与
  **渲染**（`AXImage` 节点）上，下方 `waitFor` 等的是 `AXImage` 而非引用原文（M514：图片 widget
  挂载前占位文本同样含 `![[…]]`，按原文等会假绿）。
- **剪贴板置图**：合成 png 经 `osascript` 的 `«class PNGf»`（同一条固定命令纪律，不开通用
  shell 通道），pasteboard 上同时出现 `public.png` 与 `public.tiff`——正是系统截图的形态。

## 覆盖边界（如实登记）

- **逐像素无损**不在本层判：本套件没有 PNG/WebP 解码器（零新增依赖的口径），像素级往返由
  Rust 单测钉住（`fs_io::tests::write_attachment_transcodes_png_to_lossless_webp_and_round_trips_pixels`，
  带 alpha / 无 alpha 两条）。本层判的是「字节确实是 WebP 容器 + 引用渲染得出来」。
- **图片节点的 AX 形态**按实跑读数写：`AXImage` 节点的 label 带整条引用原文（M184 的既有形态），
  断言用它 + 文件名做正则匹配。
