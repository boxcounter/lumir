---
id: "17-multi-vault-switch"
item: 17
title: 多 vault——树头部入口的列表浮层、切到未打开过的 vault 的空态引导、切回后按会话恢复标签
fixtures: [tabs-a.md, tabs-b.md]
seed:
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
steps:
  - name: 打开 tabs-a.md（单击 = 预览标签），随后键入把它固定住
    do: open
    file: tabs-a.md
    marker: "标签场景 A"
    expect:
      - shot: 打开 tabs-a
      - label: 正文是 tabs-a
        editor: { has: "标签场景 A" }
      - label: 已经有一个标签
        ax: { count: { pattern: "关闭 ", exact: 1 } }

  - name: 键入内容——首次输入即把预览标签固定住（此后单击别的文件不会再顶掉它）
    do: type
    text: "APIN"
    expect:
      - shot: 首次输入
      - label: 输入落进文档
        editor: { has: "APIN" }

  - name: ⌘S 保存（把标签留在固定态且回到 clean）
    do: key
    key: "cmd+s"
    expect:
      - shot: 保存之后
      - label: 未保存标记撤下（手动保存或已到期的自动保存都已闭环——本步只判「不再 dirty」，不判是哪条路径写的）
        ax: { not: "（未保存）" }
      - label: 磁盘上确有这次输入（固定下来的内容真的落盘了）
        file: { path: tabs-a.md, has: "APIN" }

  - name: 再打开 tabs-b.md（前一个已固定，所以另开一个新标签）
    do: open
    file: tabs-b.md
    marker: "标签场景 B"
    expect:
      - shot: 两个标签
      - label: 第二个文件上屏
        editor: { has: "标签场景 B" }
      - label: 现在有两个标签（预览语义会就地替换，只剩一个）
        ax: { count: { pattern: "关闭 ", exact: 2 } }

  - name: 第二个标签也键入 + ⌘S 固定并落盘
    do: type
    text: "BPIN"
    expect:
      - label: 输入落进文档
        editor: { has: "BPIN" }

  - name: 保存第二个标签
    do: key
    key: "cmd+s"
    expect:
      - shot: 两个固定标签
      - label: 两个标签都是固定标签（标签栏仍有两个）
        ax: { count: { pattern: "关闭 ", exact: 2 } }
      - label: 第二个标签的内容也落盘
        file: { path: tabs-b.md, has: "BPIN" }

  - name: 点树头部入口打开切换器（形态 A 的入口点击路径）
    do: click
    target: { any: "点击查看全部 vault" }
    expect:
      - shot: 切换器浮层
      - label: 列表里有两个 vault（B 的名字只可能来自列表行——它的目录从没被打开过）
        ax: { has: "lumir-m102-acceptance-b" }
      - label: 当前项带「当前」标且摘要是「2 个标签 · 现在打开」（标签数来自会话落盘，不是前端镜像）
        ax: { has: "当前 2 个标签 · 现在打开" }
      - label: 没有历史的 B 行给 D101 的串（不编一个时间出来）
        ax: { has: "还没有打开过文件" }
      - label: 浮层底部的新增入口在（形态 A 下浮层内唯一的新增入口，D104 的悬停提示）
        ax: { has: "选择一个目录作为新 vault" }

  - name: Esc 收起浮层（浮层内就地消费 Esc，D86 同口径）
    do: key
    key: "escape"
    expect:
      - label: Esc 收起浮层（关闭后列表内容不在 AX 里）
        ax: { not: "选择一个目录作为新 vault" }

  - name: ⌘O 再打开一次
    do: key
    key: "cmd+o"
    expect:
      - shot: ⌘O 打开的浮层
      - label: 浮层重新出现（D96 的键位路径有效）
        ax: { has: "选择一个目录作为新 vault" }

  - name: 点 B 那一行——会话上下文整窗切到 B
    do: click
    target: { role: AXStaticText, any: "lumir-m102-acceptance-b" }
    expect:
      - shot: 切到 B
      - label: 树头部入口换成 B（整窗上下文真的换了）
        ax: { has: "vault：lumir-m102-acceptance-b（点击查看全部 vault）" }
      - label: B 没有打开过的文件——D107 的空 vault 引导
        ax: { has: "这个 vault 还没有打开的文件" }
      - label: B 自己的文件在树里（装载的是 B 的条目，不是空树）
        ax: { has: "beta.md" }
      - label: A 的会话已按稳定 id 落盘，两个固定标签都在
        file: { path: "env:vault-sessions/acc-a.json", has: '"tabs-a.md"' }
      - label: 落盘的顺序与开标签的顺序一致（有序列表，不是集合）
        file: { path: "env:vault-sessions/acc-a.json", has: '/"tabs": \[\n\s*"tabs-a\.md",\n\s*"tabs-b\.md"\n\s*\]/' }
      - label: 激活项是切走时前台那个标签
        file: { path: "env:vault-sessions/acc-a.json", has: '"active": "tabs-b.md"' }

  - name: 再点入口，点 A 那一行切回去
    do: click
    target: { any: "点击查看全部 vault" }
    expect:
      - shot: 第二次浮层
      - label: A 的行按会话给摘要（2 个标签 + 相对时间；它已不是当前项，所以不说「现在打开」）
        ax: { has: '/lumir-m102-acceptance 2 个标签 · /' }

  - name: 点 A 那一行
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance /" }
    expect:
      - shot: 切回 A
      - label: 树头部入口换回 A
        ax: { has: "vault：lumir-m102-acceptance（点击查看全部 vault）" }

  - name: 等装载后的标签恢复跑完（逐标签异步打开）
    do: sleep
    ms: 6000
    expect:
      - shot: 恢复后的两个标签
      - label: 两个标签都恢复了（恢复用的是固定标签意图，否则第二个会顶掉第一个）
        ax: { count: { pattern: "关闭 ", exact: 2 } }
      - label: 激活项是会话里存的那个（tabs-b），不是退化后的第一个
        editor: { has: "BPIN" }
      - label: 第一个标签的正文没有上屏（激活项退化的反证）
        editor: { not: "标签场景 A" }
---

说明：本条对应 change `multi-vault-workspaces` 的任务 6.1 ①，覆盖四条会互相牵连的行为：

1. **入口形态 A**：树头部只有一个入口（`button.ft-vault`，名称 + caret，D96 读屏名），点它开的是
   列表浮层而不是系统目录选择器。因此本场景的每一次切换都是「入口 → 列表行」这条真实路径，
   且**不依赖系统目录选择器**（套件不驱动原生对话框，见 README「已知边界」）。
2. **两个固定标签与按 vault 的会话**：固定标签经「单击打开 → 键入（首次输入即固定，不持久化预览
   标签）」这条真实用户路径得到——**不能用双击**：本套件的注入通道在 WKWebView 里产生不出 DOM 的
   `dblclick`（四条路实测都失败，判据与现场见 README「已知边界」），因此「双击固定」这条路径由
   chromium 视觉通道覆盖（`tests/visual/scenes/m149-tabs.spec.ts`）。
   键入后 ⌘S 把标签留在固定态且 clean——否则 dirty 会触发切换守卫（那是 19 的场景）。
3. **切到没打开过的 vault = 空 vault 首入态**：B 没有会话历史，装载后一条标签都恢复不出来，正文被
   D107 的引导盖住。这也是**启动**的常态（验收 vault 首次打开时没有会话），因此就绪门必须认它
   （见 `lib/drive.mjs` 的 `waitAppReady`）。
4. **切回后按会话恢复**：断言「激活项是 tabs-b 而不是退化的第一个」，靠的是正文内容
   （`BPIN` 只可能来自 tabs-b）；`editor.not "标签场景 A"` 是它的反证——两条一起才有区分度
   （REVIEW.md 第 1 条）。切换前 A 的会话确实落盘这一点另由三条 `file` 断言直接读盘证明
   （存在性 + 有序性 + 激活项）。

**两种寻址为什么不同**：切换用**点列表行**（AX 里的行是 `AXStaticText` + `AXPress`，`any` 匹配
行名），因为列表行的键盘导航依赖**盲发的 ↑↓**——丢一个键就静默切到错的行（REVIEW.md 第 5/11 条：
成功判据不该与被测的不可靠通道耦合）。键位路径另用**打开/关闭**两步覆盖（⌘O 开、Esc 关），
失败只会红、不会错切。两行名字互相是前缀（`lumir-m102-acceptance` 是 `...-b` 的前缀），
所以 A 的行用 `"/lumir-m102-acceptance /"`（名称后紧跟空格）排除 B 的行。

**不覆盖**：新增 vault → 系统目录选择器（套件不驱动原生对话框，见 README「已知边界」）；
双击 / ⌘-点击固定标签（同上，另一条通道覆盖）。
