---
# 两个 URL 编辑需求的真机判定（change add-url-paste-title-nov21 +
# fix-bare-url-cjk-boundary-nov21）：
#   1. 裸 URL 后紧邻中文时，中文不进入链接目标 / 装饰；文档源码逐字节不变。
#   2. 粘贴 URL 取标题失败（不可解析域名）时保留原始 URL，不产生半截 Markdown。
#   3. 粘贴 URL 取标题成功时落成 `[标题](URL)`。成功路径用**本应用自己的 dev server**
#      （`http://127.0.0.1:1430/`，缺省 `LUMIR_ACCEPTANCE_PORT`）作为确定性本地页面：
#      `index.html` 的 `<title>` 是 `Lumir`，不依赖外网。若主会话覆盖了
#      `LUMIR_ACCEPTANCE_PORT`，本步的 URL 需同步改端口。
#
# 真机 AX 读到的编辑器文本是**渲染后文本**，所以「合并 / 未合并」的判据优先用
# 「`abc中文说明` 是否作为连续子串出现」与磁盘源码；成功标题的最终判据落在 ⌘S 后的
# 文件源码（渲染态是否显露链接源码不影响这条）。
id: "269-url-paste-and-cjk-boundary-nov21"
item: 269
tier: full
title: 粘贴 URL 取标题（成功 / 失败保留）与裸 URL 中文边界（真机）
steps:
  # ---------------------------------------------------------------------------
  # A. 裸 URL 中文边界：中文是正文，不是链接目标；源码不变
  # ---------------------------------------------------------------------------
  - name: 造中文边界笔记
    do: vaultWrite
    file: notes/url-cjk.md
    content: "# URL 边界\n\n裸网址 https://example.invalid/abc中文说明 在这里。\n"
    expect:
      - label: 笔记已落盘（源码里中文紧贴 URL）
        file: { path: notes/url-cjk.md, has: "https://example.invalid/abc中文说明" }

  - name: 等 watch 增量把 notes 目录刷进树
    do: waitFor
    waitFor:
      has: ["/AXButton \\(notes\\)/"]
    timeoutMs: 30000

  - name: 展开 notes 目录
    do: click
    target: { any: "/^notes$/" }
    expect:
      - label: notes 目录行在场
        ax: { has: "/AXButton \\(notes\\)/" }

  - name: 打开中文边界笔记
    do: open
    file: notes/url-cjk.md
    marker: "URL 边界"
    expect:
      - label: 笔记装载进编辑器
        editor: { has: "URL 边界" }
      - label: ASCII 前缀作为链接上屏
        editor: { has: "https://example.invalid/abc" }
      - label: 中文仍是正文（边界没有吞字）
        editor: { has: "中文说明" }
      - label: 中文没有被并进链接文本（合并时这里会出现连续串）
        editor: { not: "abc中文说明" }
      - label: 装饰不改源码（磁盘仍是紧贴的中文原文）
        file: { path: notes/url-cjk.md, has: "https://example.invalid/abc中文说明" }

  # ---------------------------------------------------------------------------
  # B. 取标题失败：保留原始 URL，不产生 `[`，⌘S 后源码仍是 URL
  # ---------------------------------------------------------------------------
  - name: 造粘贴失败笔记
    do: vaultWrite
    file: notes/url-paste-fail.md
    content: "# 粘贴失败\n\n"
    expect:
      - label: 失败笔记已落盘
        file: { path: notes/url-paste-fail.md, has: "粘贴失败" }

  - name: 等 tree 刷到新文件
    do: waitFor
    waitFor:
      has: ["/url-paste-fail\\.md/"]
    timeoutMs: 30000

  - name: 打开粘贴失败笔记
    do: open
    file: notes/url-paste-fail.md
    marker: "粘贴失败"
    expect:
      - label: 笔记装载进编辑器
        editor: { has: "粘贴失败" }

  - name: 窗口前台 + 编辑器焦点（cgevent ⌘V 需要前台）
    do: focusWindow
    retries: 4
    click: true
    expect:
      - label: 焦点在编辑器正文
        ax: { focused: "AXTextArea" }

  - name: 剪贴板置不可解析域名的 URL（.invalid 保留 TLD，DNS 必失败）
    do: clipboardText
    text: "https://url-paste-check.invalid/fail"

  - name: ⌘V 投递 paste
    do: key
    key: "cmd+v"
    channel: cgevent
    gapMs: 500

  - name: 等 URL 落地（网络失败最多 5s，留余量）
    do: waitFor
    waitFor:
      has: ["/url-paste-check\\.invalid\\/fail/"]
    timeoutMs: 20000
    expect:
      - label: 原始 URL 在正文里（没有被吞掉）
        editor: { has: "https://url-paste-check.invalid/fail" }
      - label: 没有生成标题链接（失败路径不写 `[` 结构）
        editor: { not: "[" }

  - name: ⌘S 保存（失败路径的终态写盘）
    do: key
    key: "cmd+s"
    channel: cgevent
    gapMs: 500
    expect:
      - label: 磁盘源码保留原始 URL
        file: { path: notes/url-paste-fail.md, has: "https://url-paste-check.invalid/fail" }
      - label: 磁盘源码没有标题链接结构
        file: { path: notes/url-paste-fail.md, not: "[" }

  # ---------------------------------------------------------------------------
  # C. 取标题成功：本地 dev server 的 `<title>Lumir</title>` → `[Lumir](URL)`
  # ---------------------------------------------------------------------------
  - name: 造粘贴成功笔记
    do: vaultWrite
    file: notes/url-paste-ok.md
    content: "# 粘贴成功\n\n"
    expect:
      - label: 成功笔记已落盘
        file: { path: notes/url-paste-ok.md, has: "粘贴成功" }

  - name: 等 tree 刷到成功笔记
    do: waitFor
    waitFor:
      has: ["/url-paste-ok\\.md/"]
    timeoutMs: 30000

  - name: 打开粘贴成功笔记
    do: open
    file: notes/url-paste-ok.md
    marker: "粘贴成功"
    expect:
      - label: 笔记装载进编辑器
        editor: { has: "粘贴成功" }

  - name: 窗口前台 + 编辑器焦点
    do: focusWindow
    retries: 4
    click: true
    expect:
      - label: 焦点在编辑器正文
        ax: { focused: "AXTextArea" }

  - name: 剪贴板置本应用 dev server 的 URL（确定性本地页面，不依赖外网）
    do: clipboardText
    text: "http://127.0.0.1:1430/"

  - name: ⌘V 投递 paste
    do: key
    key: "cmd+v"
    channel: cgevent
    gapMs: 500

  - name: 等标题返回并上屏（渲染态是 `Lumir↗︎`；窗口标题里的 Lumir 不带尾标，不能当判据）
    do: waitFor
    waitFor:
      has: ["/Lumir↗/"]
    timeoutMs: 20000
    expect:
      - label: 标题渲染上屏（正文里能看到 Lumir）
        editor: { has: "Lumir" }

  - name: ⌘S 保存（成功路径的终态写盘）
    do: key
    key: "cmd+s"
    channel: cgevent
    gapMs: 500
    expect:
      - label: 磁盘源码是 `[标题](URL)`（标题纯文本，URL 原文）
        file: { path: notes/url-paste-ok.md, has: "[Lumir](http://127.0.0.1:1430/)" }
      - label: 成功路径只写一条链接（没有重复插入）
        file: { path: notes/url-paste-ok.md, not: "[Lumir](http://127.0.0.1:1430/)[Lumir]" }

  - name: 清理三份验收笔记
    do: vaultRm
    file: notes/url-cjk.md

  - name: 清理失败笔记
    do: vaultRm
    file: notes/url-paste-fail.md

  - name: 清理成功笔记
    do: vaultRm
    file: notes/url-paste-ok.md
---

# 粘贴 URL 取标题 + 裸 URL 中文边界（真机）

## 这个场景验什么

两条需求的行为判定下沉到真机 WKWebView：

1. **裸 URL 后的中文**（`fix-bare-url-cjk-boundary-nov21`）：GFM 的 `urlRE` 会把中文吞进
   `URL` 节点，链接层在首个非 ASCII 字符前截断。真机判据是「`abc中文说明` 不再作为连续串
   出现」+「中文仍可见」+「磁盘源码不变」——只看 `editor.has("中文说明")` 会在「中文被吞进
   链接但链接文本仍显示」时也绿。
2. **取标题失败**（`add-url-paste-title-nov21`）：`.invalid` 域名的请求必失败；URL 必须先落地、
   失败后仍逐字留在正文，⌘S 后磁盘不出现 `[` 结构。
3. **取标题成功**：`http://127.0.0.1:1430/` 是套件自己起的 vite dev server，`index.html` 的
   `<title>` 恒为 `Lumir`。真机走完整链路：粘贴 → Rust `fetch_url_title`（reqwest loopback）→
   异步替换 → ⌘S 落盘 `[Lumir](http://127.0.0.1:1430/)`。这条同时证 Rust command 的注册与
   前端端口注入在真栈上接通，不只停在 chromium 桩。

## 已知边界

- 成功路径的端口按缺省 `LUMIR_ACCEPTANCE_PORT=1430` 写死；主会话若覆盖端口，需同步改 URL。
- 真机 AX 读到的是渲染后文本：成功路径的编辑器可能显示 `Lumir↗︎` 而不是源码，所以最终
  判据落在 ⌘S 后的文件源码；`editor.has("Lumir")` 只做「标题已上屏」的锚点。
- 网络失败最长等 5s（Rust 侧 `FETCH_TIMEOUT`），`waitFor` 给 20s 余量。
