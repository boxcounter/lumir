---
id: "27-document-end-marker"
item: 27
tier: full
title: 正文末尾的结束标记（所有已完成布局的 md 文档都显示；视口 0 不显示）
fixtures: [end-marker-long.md, end-marker-short.md]
open: end-marker-long.md
marker: "结束标记场景（长文·真机）"
steps:
  - name: 长文装载：磁盘基线与「标记不是正文」的负向判据
    do: record
    as: 长文文件
    file: end-marker-long.md
    expect:
      - label: 编辑器文档文本里没有标记的文案（标记不是正文内容）
        editor: { not: "END" }
      - shot: 长文首屏
  - name: 建立渲染层焦点（后面的翻屏键要落到编辑器上）
    do: clickEditor
    expect:
      - label: 编辑器已就位（AXTextArea 可读）
        editor: { has: "这一段是长文的第 1 段" }
      - label: 首屏（尚未滚动）标记的可读文本节点已在 AX 里（M178 现场：AX 文本不等于可见；**不是可见性判据**，见文末覆盖边界）
        ax: { count: { pattern: "/AXStaticText = \"END\"/", exact: 1 } }
  - name: 翻到文档末尾
    do: keys
    keys: ["ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v"]
    gapMs: 500
  - name: 文档末尾：标记在场、正文未被改写
    do: settle
    expect:
      - label: 末段正文在文档文本里（文档内容完整）
        editor: { has: "它的下面是文件的终点" }
      - label: 标记的可读文本节点仍在 AX 里（长文侧正观测）
        ax: { count: { pattern: "/AXStaticText = \"END\"/", exact: 1 } }
      - label: 标记的文案不在编辑器文档文本里（渲染不写文档）
        editor: { not: "END" }
      - label: 磁盘文件逐字节未变（ADR 0003 §3）
        file: { path: end-marker-long.md, unchangedSince: 长文文件 }
      - shot: 长文滚到底
  - name: 造一个非 md 文件（名字**靠前**：树里靠下的行不在 AX 可达范围内，见「已知边界」）
    do: vaultWrite
    file: aaa-nonmd.txt
    content: "非 md 文件（code 模式）：M251 的孤儿元素回归要在它上面读一次 AX。\n"
    expect:
      - label: 磁盘上有了 aaa-nonmd.txt
        file: { path: aaa-nonmd.txt, exists: true }
  - name: 从长文直接切到非 md 文件：标记必须随模式一起离场（M251 的孤儿元素回归）
    do: open
    file: aaa-nonmd.txt
    marker: "非 md 文件（code 模式）"
    expect:
      - label: 正向锚点在上一步——长文侧刚验过标记节点命中 1 次，这里的「不命中」因此不是恒真空转
        ax: { count: { pattern: "/AXStaticText = \"END\"/", exact: 0 } }
      - label: 读的确实是非 md 那份文件（正观测：文档文本是 aaa-nonmd.txt 的原文）
        editor: { has: "M251 的孤儿元素回归" }
      - label: 编辑器文档文本里也没有标记的文案
        editor: { not: "END" }
      - shot: 非 md 文件（标记应已离场）
  - name: 切到一屏装得下的短文
    do: open
    file: end-marker-short.md
    marker: "结束标记场景（短文·真机）"
  - name: 短文：END 同样在场（2026-11-27 统一口径；旧判据在这里是 0）
    do: record
    as: 短文件
    file: end-marker-short.md
    expect:
      - label: 末段正文在文档文本里（正观测：AX 读的是这份文档）
        editor: { has: "第三段，也是最后一段" }
      - label: 短文侧标记的可读文本节点在场（与长文同一个匹配器；旧判据下这里为 0，是本 change 的行为翻转点）
        ax: { count: { pattern: "/AXStaticText = \"END\"/", exact: 1 } }
      - label: 编辑器文档文本里没有标记的文案
        editor: { not: "END" }
      - label: 磁盘文件逐字节未变
        file: { path: end-marker-short.md, unchangedSince: 短文件 }
      - shot: 短文（END 在末行之下）
  - name: 短文建立编辑器焦点（翻页键要落到编辑器上）
    do: clickEditor
    expect:
      - label: 编辑器仍读的是这份短文
        editor: { has: "第三段，也是最后一段" }
  - name: 短文翻页：标记仍在场（在场与滚动位置无关）
    do: keys
    keys: ["ctrl+v", "ctrl+v"]
    gapMs: 400
    expect:
      - label: 翻页后标记的可读文本节点仍在 AX 里（短文没有可滚动的正文，翻页不改变在场）
        ax: { count: { pattern: "/AXStaticText = \"END\"/", exact: 1 } }
      - label: 翻页没有改写文档
        file: { path: end-marker-short.md, unchangedSince: 短文件 }
      - shot: 短文翻页后
---

说明：本场景是 change `document-end-marker`（M189）的真机取证，并由 change
`show-document-end-marker-all-docs-nov27`（2026-11-27，Alex 采纳）更新为**所有已完成布局的 md 文档都显示**。
两侧仍用**同一个匹配器**：长文与短文两步都必须命中标记的可读文本节点（`AXStaticText = "END"`），
非 md 文件那一步必须完全不命中——「不命中」因此不是恒真的空转（REVIEW.md 「读不到当成空」条），
也同时证明 AX 读数本身是活的。

## 覆盖边界（如实标注，不许读成「已验证」）

- **真机通道读不到标记的几何**：WKWebView 在这条 AX 通道里只给 `AXButton` / `AXImage` / `AXScrollArea` 一类节点 bbox，
  纯文本节点（`AXTextArea` 自身、行内 `AXStaticText`）**没有 `@x,y W×H`**。实测现场（`ax/03-长文滚到底.txt`）：
  标记的节点是 `- [192] AXStaticText = "END"`（M238 当时的原文是「— End —」，M251 改为「END」）、
  与 `AXTextArea` 同级（不在 textbox 里），无 bbox。
  因此「可见性 / 短文 END 是否贴在末行之下」**不在真机通道判**，判据落在：
  1. **chromium 层**（`tests/visual/scenes/end-marker.spec.ts`）：短文 END 在场、盒顶 = 正文内容盒底边、
     末行到标记的间距 = 正文下内边距 + 标记上内边距、离视口底 > 100px、短文 `scrollHeight == clientHeight`、
     视口高度变化不移动标记、长文滚动恒定——几何断言齐全；
  2. **截图证据**（本场景的 `shots/`，人可读、Alex 抽审用；短文三张图应能看到 END 在末行下方而不是窗口底）；
  3. **在场判据**（本场景）：长文 / 短文两侧节点在场、非 md 侧节点缺席——这一对证的是「标记在不在文档场景里」，
     **不是**「在不在视口里」。
- **不要用「AX 里有『END』」当可见性判据**：M178 的现场说的是不可见元素照样有 AX 文本；
  本场景 `建立渲染层焦点` 那一步就实测到了这一点——标记在首屏下方、节点已在 AX 里。所以那条断言只当**在场**证据用。
  标记的挂载要等编辑器首个测量周期（CM 的 `requestMeasure` 走 rAF），窗口被挡住时 rAF 会被 WKWebView 饿住
  （本套件实测：套件拿不到前台的那次运行里，装载后立刻读 AX 读不到节点，`clickEditor` 让窗口可见后才读到）——
  这是通道 / 环境的边界，不是标记的可见性语义。
- **不做 ⌘A / ⌘F 的真机判据**：真机通道没有剪贴板与搜索面板的可断言读数；那两条在 chromium 层有精确断言
  （`end-marker.spec.ts` 的「非文档性」用例：真剪贴板文本 + 搜索面板计数）。真机侧的非文档性落点是
  磁盘逐字节 + `editor.not`（文档文本里没有标记文案）+ 标记节点在 textbox 之外。
- **视口为 0 的判据不在本场景**：真机通道无法稳定把布局压到 clientHeight = 0；该负向断言（隐藏 scroller → 离场）
  在 chromium 层 `end-marker.spec.ts` 的「视口为 0」用例，配恢复后的回场正观测。
- **反向验证**（REVIEW.md 「断言等价于子串」条）：把标记的挂载去掉（回退到实现前代码）后重跑本场景，
  长文与短文两步的节点断言都必须 FAIL——没有这一步的 PASS 不算数。
- **M238（2026-09-26）的三处变化**：① 文案由「到底了」改为「— End —」（Alex 裁决）——本场景所有
  断言与说明已同步；② 标记的挂载改为**推迟到 CM 测量周期之外**落地（`src/preview/endMarker.ts` 的
  **单帧**——一帧即离开测量周期；双帧实测会把阅读位置恢复推离 13px，源码注释里已写「别改回双帧」），
  上一条注里「等首个测量周期」的说法因此变成「等测量周期 + 一帧」，rAF 被饿住的窗口相应长一帧——
  通道边界不变，仍以 `clickEditor` 提起窗口顶掉它；③ **标记的位置不变量（恒贴正文内容盒之下）不在本通道判**
  （真机读不到几何），判据在 chromium 层 `end-marker.spec.ts`（跨视口变化始终贴内容盒底边 +
  「行尺寸不得由 scroller class 键控」的回归探针）与本场景的截图（人可读的旁证）。
- **M251（2026-09-27）的两处变化**：① 文案去掉破折号，改为「END」（Alex 裁决）——本场景的匹配器与说明
  已同步；② 新增一步「从长文直接切到非 md 文件（.txt）」——Alex 真机报告的非 md 漂移（`END` 出现在
  markdown 的正文右侧空白列）根因是**模式切换的历史**：md → code 的切换里，销毁前排进 CM 测量
  队列的那一趟在销毁后照常执行，把元素挂回 `.cm-scroller`（机制与不变量见
  `src/preview/endMarker.ts` 的文件头）。这一步是它的真机判据（正面锚点在上一步的长文节点命中）；
  **不变量级的矩阵属性测试在 chromium 层**（`end-marker.spec.ts` 的「M251 属性」用例扫 源模式 ×
  目标模式 × 打开方式），真机这一步只补「真实 WKWebView 下同一现象不再出现」这一条。
- **`show-document-end-marker-all-docs-nov27`（2026-11-27）的一处变化**：短文侧从「节点缺席」改为
  「节点在场」，并新增「短文翻页后仍在场」。旧判据（内容高度 > 视口高度）被 Alex 的统一口径推翻；
  短文的可见位置由 chromium 层几何断言守（见上），真机只补「真实 WKWebView 下节点同样在场、翻页不改变在场」。
- **「切到非 md 文件」那一步的文件名刻意靠前**（M251 实测）：本套件的 AX 通道只暴露树里**落在窗口
  可视范围内**的行——现场（`ax/03-_动作_从长文直接切到非_md_文件…txt`）里 file tree 的行按钮止于
  `y≈777`（窗口高 800），排序在 `links.md` 之后的行（`notes.txt` / `plain.md` / `x.jsonc` 等）
  **完全不在 AX 里**，`open` 因此以「等待左栏出现 XXX 超时（60000ms）」告终（首跑现场见
  `.local/missions/m251/acceptance-27.log`）。所以这一步用 `vaultWrite` 造一个排序最前的
  `aaa-nonmd.txt` 再打开（场景 47 造 `aaa-menu.md` 是同一约束的同一手法）。**顺带登记**：凡 `open:`
  指向排序靠后 fixture 的场景都会撞这条（`41-editable-non-md-files` / `42-non-md-edit-guardrails`
  的 `open: notes.txt` 即此形态，本批未跑它们，是否真红待验）。
- **同一时刻只跑一份验收**（M251 现场）：本套件的隔离配置目录是**主 checkout 共享**的
  `.local/acceptance/env`（证据落主 checkout 是既定纪律），两个 worktree 的套件并发跑会互相
  污染——M251 那次真机跑里标签栏出现了一批**不属于本场景**的已打开标签（`ax/04-短文.txt`：callout.md /
  headings-ramp.md / identity.md … 二十余个），是另一份并发套件（wt-252 的实例当时仍活着）在本场景
  `resetSessions()` 之后写回的会话。本场景的判据（文档文本 / 标记节点 / 磁盘）不受它影响，但并发跑会
  污染现场——排期按「1430 单占」对待。
