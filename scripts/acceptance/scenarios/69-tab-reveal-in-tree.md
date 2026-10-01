---
id: "69-tab-reveal-in-tree"
item: 69
title: TAB 右键菜单「在左栏中定位到此文件」——展开祖先、目标行现身（真实 WKWebView + 真实右键通道）
fixtures: [plain.md]
steps:
  - name: 就绪起点——树里根层文件行在场（正向锚点：这次 AX 读取是活的）
    do: settle
    expect:
      # 见证取**文件组最靠前的行**（M296 的 fanout_cap：树是「目录组在前、文件组在后」，快照
      # 被截断时从末尾丢——这一行在场即证明它前面的整个目录组与文件组头部都在这一份快照里）。
      - label: 根层有文件行（后续负向断言的完整性见证）
        ax: { has: "/AXButton \\(block-copy\\.md\\)/" }
      - label: 起点还没有这个场景要用的目录
        ax: { not: "/AXButton \\(reveal-outer\\)/" }
      - shot: 01-起点

  # 目标落在**两级**子目录下（多级祖先才验得出「逐级展开」）：外部造出来，等 watcher 收敛。
  - name: 外部造出两级嵌套的目标文件（vaultWrite 会 mkdirp 父目录）
    do: vaultWrite
    file: reveal-outer/reveal-inner/deep-reveal.md
    content: "# 深目录里的目标\n\n定位场景正文：这一篇要在左栏里被定位出来。\n"
    expect:
      - label: 磁盘上有了这个文件
        file: { path: reveal-outer/reveal-inner/deep-reveal.md, exists: true }
  - name: 等 watcher 收敛（外部写入后先留一拍再读 AX，README 口径）
    do: sleep
    ms: 1500
    expect:
      - label: 一级目录行已在树里（目录组排在最前，不受文件组截断影响）
        ax: { has: "/AXButton \\(reveal-outer\\)/" }
      - label: 起点：两级子目录与目标文件都还看不见（祖先折叠）
        ax: { not: "/AXButton \\(reveal-outer/reveal-inner\\)/" }
      - label: 起点：目标文件行同样不在（它的父目录还没展开）
        ax: { not: "/AXButton \\(reveal-outer/reveal-inner/deep-reveal\\.md\\)/" }
      - shot: 02-造出嵌套文件

  - name: 展开一级目录 → 二级目录行出现，目标文件仍不可见
    do: click
    target: { role: AXButton, name: "^reveal-outer$" }
    expect:
      - label: 二级目录行出现（子行的读屏名是完整相对路径）
        ax: { has: "/AXButton \\(reveal-outer/reveal-inner\\)/" }
      - label: 目标文件行仍然不在（二级目录还没展开——负向断言的邻近见证就是上一行）
        ax: { not: "/AXButton \\(reveal-outer/reveal-inner/deep-reveal\\.md\\)/" }

  - name: 展开二级目录 → 目标文件行出现
    do: click
    target: { role: AXButton, name: "^reveal-outer/reveal-inner$" }
    expect:
      - label: 目标文件行出现
        ax: { has: "/AXButton \\(reveal-outer/reveal-inner/deep-reveal\\.md\\)/" }
      - shot: 03-展开两级

  - name: 点开它——开出一个标签（定位的作用对象就此建立）
    do: click
    target: { role: AXButton, name: "^reveal-outer/reveal-inner/deep-reveal\\.md$" }
    expect:
      - label: 树行点开后出现一个标签
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 它成为前台
        ax: { has: "/AXRadioButton \\(deep-reveal\\.md\\) Value: true/" }
      - label: 正文就位（不只是标签在场）
        editor: { has: "定位场景正文" }
      - shot: 04-打开目标文件

  - name: 收起一级目录——把「祖先折叠」这个现场还回去，定位才有事做
    do: click
    target: { role: AXButton, name: "^reveal-outer$" }
    expect:
      - label: 目标文件行随之从树里消失（祖先折叠）
        ax: { not: "/AXButton \\(reveal-outer/reveal-inner/deep-reveal\\.md\\)/" }
      - label: 见证：同一份快照里根层行照旧在（上一条不是「读不到」）
        ax: { has: "/AXButton \\(block-copy\\.md\\)/" }
      - label: 标签仍在（折叠树不动会话）
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - shot: 05-收起后的现场

  - name: 右键那个标签——菜单出现且含定位项（读屏名按文案表 zh 列）
    do: click
    target: { role: AXRadioButton, name: "^deep-reveal\\.md$", button: right }
    expect:
      - label: 菜单里有「在左栏中定位到此文件」
        ax: { has: "在左栏中定位到此文件" }
      - label: 三条关闭项照旧在场（菜单是增项，不是替换）
        ax: { has: "/AXMenuItem \\(Close\\)/" }
      - label: 右键不改上下文：标签数与前台都不变
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - shot: 06-标签右键菜单

  - name: 点「在左栏中定位到此文件」——祖先展开、目标行重新现身
    do: click
    target: { any: "在左栏中定位到此文件" }
    expect:
      - label: 一级目录展开
        ax: { has: "/AXButton \\(reveal-outer/reveal-inner\\)/" }
      - label: 目标文件行回到树里（两级祖先都被展开）
        ax: { has: "/AXButton \\(reveal-outer/reveal-inner/deep-reveal\\.md\\)/" }
      - label: 定位不改上下文：标签数与前台都不变
        ax: { count: { pattern: "关闭 ", exact: 1 } }
      - label: 前台仍是它（定位 MUST NOT 切换标签）
        ax: { has: "/AXRadioButton \\(deep-reveal\\.md\\) Value: true/" }
      - label: 菜单已收起（定位不是模态动作）
        ax: { not: "在左栏中定位到此文件" }
      - shot: 07-定位之后
---

## 这个场景验什么

M300（change `tab-reveal-in-tree`）为标签右键菜单新增的首项「在左栏中定位到此文件」（Alex
2026-10-01 的需求原话）在**真实 WKWebView + 真实指针右键通道**下的落点：右键某一条标签 → 选定位项
→ 左栏把该文件的**全部祖先目录逐级展开**，目标行回到树里。

一条端到端的判据链，每一步都配了正向见证（REVIEW.md 第 1/2 条）：

1. **起点**是「目标行不在树里」（祖先折叠）——这不是缺陷，是定位要解决的现场；
2. **定位后**目标行必须回到树里（两级祖先都展开），而**标签与前台都不变**——定位只动左栏；
3. 中间用「收起一级目录」把现场还回去，因此最后一步的「行回来了」只可能由定位造成（同一场景里
   先前的两次点击只负责把行渲染出来过一次，收起之后它们的影响已经归零）。

菜单是**增项**而不是替换：同一步里既断言新的中文项在场，也断言 `Close` 三条关闭项照旧（M254 的
既有行为不因本 change 回退）。

## 通道与已知边界（撞上就如实登记，不判产品缺陷）

- **滚动那条判据不在本场景**：套件**没有滚动动作，也滚不动**（M252 三轮探针的结论，
  `scripts/acceptance/README.md` 的「没有滚动动作，也滚不动」条：四种注入组合全部返回
  `no scroll movement`）。因此「目标行被滚进左栏可视区」这条几何判据落在 chromium 层
  （`tests/visual/scenes/tab-menu.spec.ts` 的 M300 用例：矩形包含判据 + 反向对照，口径同 M238 的
  「活跃标签恒完整可见」）。**不要把本场景的 PASS 读成「滚动也在真机验过」**——本场景验的是
  「祖先展开 + 目标行现身 + 不改上下文」。
- **当前行标记（`is-current` / `aria-current`）不在本场景断言**：KimiCU 的 AX dump 里没有一条
  稳定的读数形态能区分「这一行是当前行」（不像标签的 `aria-selected` 会以 `Value: true` 露出）。
  与其写一条形态未经验证的断言（假红或恒真都不可接受），不如把它留在 chromium 层
  （同一条 M300 用例断言 `.ft-row.is-current` 恰好一条且落在目标行上）。
- **菜单项按读屏名点击**：`在左栏中定位到此文件` 是这一项在 zh 界面下的上屏文案（D322 是普通
  双语条目；套件默认钉 zh，见 README 的「语言面」节）。三条关闭项是 M257 的上屏列锁定条目，
  zh 界面下同为英文——因此 `Close` 单点仍要按带括号的项名匹配（`/AXMenuItem \(Close\)/`），
  与场景 50 同口径。
- **`块`类断言依赖 fixture**：`block-copy.md` 被当作「文件组最靠前的行」的完整性见证
  （M296 的 `fanout_cap` 截断源）。若 fixture 集合变化导致它不再靠前，正文与断言一起改。
- **AX dump 的截断方向**：目标文件行在**深层列表**里，与根层文件组的截断互不影响；本场景的
  负向断言都紧邻一条正向见证（父目录行 / 根层首行），因此「读不到」不会被当成「不存在」。
