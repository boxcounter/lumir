---
id: "49-vault-switch-feedback"
item: 252
title: vault 切换的即时反馈（浮层收起 / 装载指示起止）与切换器浮层的完整可读
fixtures: [callout.md, end-marker-long.md, end-marker-short.md, headings-ramp.md, identity.md, image-fallback.md, image-width-probe-other.md, image-width-probe.md, keys.md, lightbox.md, links-anchor.md, links-asset.md, links-blocked.md, links-missing-relative.md, links-missing.md, links-relative.md, links-wiki.md, links.md, list-filter.md, list-indent-bullet.md, list-indent-nested.md, list-indent-ordered.md, list-indent-paragraph.md, list-indent-quote.md, math.md, mermaid.md, note.md, plain.md, render-markdown.md, render-table-degrade.md, search-probe.md, svg-scroll.md, table-fullscreen.md, table.md, tabs-a.md, tabs-b.md, tabs-long.md, theme-mermaid.md, toc-frontmatter.md, toc-long.md, toc-outline.md, toc-plain.md, var-highlight.md, x.jsonc, var-highlight.js, var-highlight.lua]
seed:
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    # 第二个 vault 写 `$vault-b` 而不是 `$vault2`：execute.mjs 的占位符替换是
    # `"$vault2".replaceAll("$vault", <vault 路径>)`，`$vault2` 会被前缀吃掉成
    # `<vault 路径>2`（一个不存在的目录 → 该行变成「路径不可用」）。`$vault-b` 与
    # `secondVaultDir()` 的兜底口径（`${vaultDir()}-b`）逐字一致，两种写法都成立。
    # 这条套件缺陷已随 M252 落 finding（`scripts/acceptance/lib/execute.mjs` 的
    # `appMetaTokens`/`substituteTokens`，修法是按 token 长度倒序替换或加词边界）。
    - { id: acc-b, path: $vault-b, lastOpenedAt: 1757000001000 }
  # A 的会话 = 验收 vault 里全部可打开的 fixture（46 个标签）。**为什么要这么多**：套件单次
  # AX 快照的实测延迟是秒级（见正文「覆盖边界」），装载指示这类瞬时状态要在快照里出现，装载
  # 窗口必须显著长于那次延迟——合成 vault 只有 65 个文件，只能靠「把会话塞满 + 给 vault 塞
  # 大文件」把窗口撑开。
  sessions:
    acc-a:
      tabs: [callout.md, end-marker-long.md, end-marker-short.md, headings-ramp.md, identity.md, image-fallback.md, image-width-probe-other.md, image-width-probe.md, keys.md, lightbox.md, links-anchor.md, links-asset.md, links-blocked.md, links-missing-relative.md, links-missing.md, links-relative.md, links-wiki.md, links.md, list-filter.md, list-indent-bullet.md, list-indent-nested.md, list-indent-ordered.md, list-indent-paragraph.md, list-indent-quote.md, math.md, mermaid.md, note.md, plain.md, render-markdown.md, render-table-degrade.md, search-probe.md, svg-scroll.md, table-fullscreen.md, table.md, tabs-a.md, tabs-b.md, tabs-long.md, theme-mermaid.md, toc-frontmatter.md, toc-long.md, toc-outline.md, toc-plain.md, var-highlight.md, x.jsonc, var-highlight.js, var-highlight.lua]
      active: plain.md
steps:
  - name: 起始态：A 已装载、会话标签逐个恢复完成
    do: settle
    expect:
      - label: 当前 vault 是 A
        ax: { has: "vault：lumir-m102-acceptance（点击查看全部 vault）" }
      - label: 会话里的 46 个标签都已恢复
        ax: { count: { pattern: "关闭 ", exact: 46 } }
      - shot: 01-起始态

  - name: 点入口打开列表：列表完整可读
    do: click
    target: { any: "点击查看全部 vault" }
    expect:
      - label: 浮层打开（底部新增入口在场）
        ax: { has: "选择一个目录作为新 vault" }
      - label: 另一 vault 的行也在（列表没被裁掉）
        ax: { has: "lumir-m102-acceptance-b" }
      - shot: 02-列表完整

  - name: 点 B 行：浮层收起是点击的即时反馈之一
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }
    expect:
      - label: 浮层已收起
        ax: { not: "选择一个目录作为新 vault" }
      - shot: 03-点击后立即

  - name: B 装载完成：空 vault 首入态、指示已退场
    do: settle
    expect:
      - label: 当前 vault 换成了 B
        ax: { has: "vault：lumir-m102-acceptance-b（点击查看全部 vault）" }
      - label: B 没有会话历史 → 空 vault 首入态
        ax: { has: "这个 vault 还没有打开的文件" }
      - label: 装载指示不在场（B 这一次装载已结束）
        ax: { not: "AXProgressIndicator" }
      - shot: 04-B-稳定态

  # 给 A 塞 12 个大文件（每个 8MB 稀疏、几乎不占磁盘）：切回 A 时后端的链接索引要逐个读+解析
  # 它们，装载窗口因此从 ~1.2s 拉到秒级中段——指示这类瞬时状态才有机会落在 AX 快照里。
  # 这是**测量放大器**，不是产品场景（`vaultSparse` 的用途与边界见套件 README）。
  - name: 给 A 塞大文件（撑开装载窗口）
    do: vaultSparse
    file: big-01.md
    size: 8000000
  - name: 给 A 塞大文件 02
    do: vaultSparse
    file: big-02.md
    size: 8000000
  - name: 给 A 塞大文件 03
    do: vaultSparse
    file: big-03.md
    size: 8000000
  - name: 给 A 塞大文件 04
    do: vaultSparse
    file: big-04.md
    size: 8000000
  - name: 给 A 塞大文件 05
    do: vaultSparse
    file: big-05.md
    size: 8000000
  - name: 给 A 塞大文件 06
    do: vaultSparse
    file: big-06.md
    size: 8000000
  - name: 给 A 塞大文件 07
    do: vaultSparse
    file: big-07.md
    size: 8000000
  - name: 给 A 塞大文件 08
    do: vaultSparse
    file: big-08.md
    size: 8000000
  - name: 给 A 塞大文件 09
    do: vaultSparse
    file: big-09.md
    size: 8000000
  - name: 给 A 塞大文件 10
    do: vaultSparse
    file: big-10.md
    size: 8000000
  - name: 给 A 塞大文件 11
    do: vaultSparse
    file: big-11.md
    size: 8000000
  - name: 给 A 塞大文件 12
    do: vaultSparse
    file: big-12.md
    size: 8000000

  - name: Cmd-o 打开列表（准备切回 A）
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层打开
        ax: { has: "选择一个目录作为新 vault" }
      - label: A 的行带标签数摘要（数字来自会话落盘，不是前端镜像）
        ax: { has: "/lumir-m102-acceptance [0-9]+ 个标签/" }

  - name: 点 A 行：浮层收起 + 装载指示在场（装载 + 会话恢复还在跑）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance [0-9]+ 个标签/" }
    expect:
      - label: 浮层已收起
        ax: { not: "选择一个目录作为新 vault" }
      - label: 装载指示此刻在场（不等装载跑完就给「在处理中」）
        ax: { has: "AXProgressIndicator" }
      - shot: 05-点击A行后立即

  - name: 装载途中的第二拍（再取一张截图：指示应当还在）
    do: sleep
    ms: 400
    expect:
      - shot: 06-装载途中

  - name: 切回 A 完成：指示退场、标签全部回来
    do: settle
    expect:
      - label: 装载指示已退场
        ax: { not: "AXProgressIndicator" }
      - label: 当前 vault 回到 A
        ax: { has: "vault：lumir-m102-acceptance（点击查看全部 vault）" }
      - label: 46 个标签都恢复出来了（装载 + 会话恢复都跑完）
        ax: { count: { pattern: "关闭 ", exact: 46 } }
      - shot: 07-切回A完成
---

# 场景说明（人读）

判据挂在三件事上，都是「用户能观察到什么」，不是内部状态：

1. **点击的即时反馈有两条**：浮层在同一拍收起（负向断言「新增 vault… 不在场」）与装载指示在场
   （正向断言，指示的 AX 节点）。指示那条断言与点击**同一步**：动作发完立刻取 AX 快照，因此它
   证明的是「装载还在跑的时候指示已经在屏上」，而不是「装载结束后界面对了」。
2. **指示必须退场**：`do: settle`（连续两次 AX 快照逐字节一致）之后断言指示不在场，且 46 个标签
   全部恢复出来——「装载完成才消失」这条因此有正观测与负观测一对（REVIEW.md 第 2 条：负向断言
   必须有配对的真观测，否则「读不到」会被当成「为空」）。
3. **浮层列表完整可读**：列表打开后另一 vault 的行与底部新增入口都在 AX 里。KimiCU 的 dump 会
   裁掉窗口外的节点，所以「浮层被推到窗口外」这种状态在这条断言下会当场红。

## 覆盖边界（如实记录，别读成「已覆盖」）

- **「左栏滚到中部」这个前置状态造不出来**：套件的动作表里没有 scroll，`src/tree.ts` 也没有任何
  `scrollIntoView`（打开文件不会把树行滚进视口），`resizeWindow` 不改变 `scrollTop`，键盘通道进不了
  树（Tab 在 WKWebView 上不落地，见 README「已知边界」）。因此本场景验的是**未滚动**下的列表完整
  与端到端切换闭环；「入口被滚出视口后浮层贴视口上沿」那条只有代码级复算（`place` 的夹取算式）
  与人工复算，没有自动化判据——建议给套件加一个 scroll 动作（已随 M252 落 finding）。
- **为什么给 A 塞 12 个 16MB 稀疏 md（`big-*.md`）**：套件单次 AX 快照的往返延迟是**秒级**——
  43 个标签（恢复实测 1180ms）那一轮，紧随点击的快照读到的已经是「装载完成」态（43 个标签全在、
  无指示节点）。指示这类瞬时状态要在快照里出现，装载窗口必须显著长于那次延迟；合成 vault 只有
  65 个文件，只能靠「会话塞满 46 个标签 + 给 vault 塞大文件」把窗口撑到 4.6s（实测
  `vault_load_open` = 4615ms，≈48ms/MB）。**放大的是观察窗口，不是判据**：指示要么在场要么不在场。
- **指示的判据形态与它的可见性**：WKWebView 把 `role="progressbar"` 暴露成
  `AXProgressIndicator = "50"`（无 bbox——这类节点在 KimiCU 的 dump 里没有几何）。`hidden`
  （`display:none`）的元素**不会**出现在 AX 树里（同一份 dump 里空闲态的指示节点确实不在 ✓），
  因此「该节点在场」这件事同时证明元素真的被布局渲染了，而不是留在 DOM 里没显示。
- **「<100ms 出现」不是被这条场景量出来的**：套件没有耗时断言（`results.json` 只记场景总秒数）。
  指示在点击的同一个任务里 `begin`（没有定时器、没有 await），结构上不可能晚于下一帧；场景验的是
  「装载还在跑时它已经在场」这一时序性质。
- **指示「长什么样」没有真机截图**：`shot` 走带全窗截图的快照，实测比纯 AX 快照慢得多——这一轮的
  三张截图（点击后立即 / 装载途中 / 切换完成）逐字节相同，都落在装载结束之后，所以截不到转圈本身。
  外观（转速、大小、出现时标识块左移约 19px）归 Alex 的 dogfood 手感项，本场景不声称已验。
- **两次切换的观察面不等价**：切到 B（无会话历史、无大文件）时装载很快，那一步只验「浮层收起」；
  追指示的断言落在切回 A 那一步。
