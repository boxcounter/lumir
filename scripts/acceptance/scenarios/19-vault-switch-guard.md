---
id: "19-vault-switch-guard"
item: 19
title: 切换 vault 的 dirty 前置门——「取消 / 保存并切换 / 放弃修改并切换」三条出口各自闭环
fixtures: [tabs-a.md, tabs-b.md]
open: tabs-a.md
marker: "标签场景 A"
seed:
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
steps:
  - name: 制造未保存修改（首次输入即把预览标签固定住）
    do: type
    text: "GUARD-EDIT-1"
    expect:
      - shot: 未保存现场
      - label: 输入落进文档
        editor: { has: "GUARD-EDIT-1" }
      - label: 未保存标记上屏（masthead 常驻标记，与退出守卫的判据同源）
        ax: { has: "（未保存）" }

  - name: 外部改写同一个文件——把 dirty 变成**持久**状态
    do: vaultWrite
    file: tabs-a.md
    content: "---\ntitle: 标签场景 A\n---\n\n# 标签场景 A\n\nDISK-VERSION\n"
    expect:
      - shot: 外部改写之后
      - label: 检测到外部修改（浮条点名文件）
        ax: { has: "检测到外部修改" }
      - label: 内存里的修改没丢（冲突不会静默丢弃用户输入）
        editor: { has: "GUARD-EDIT-1" }
      - label: dirty 仍成立（冲突待决期间自动保存暂停）
        ax: { has: "（未保存）" }

  - name: 点树头部入口打开切换器
    do: click
    target: { any: "点击查看全部 vault" }
    expect:
      - shot: 切换器（dirty 不影响开列表）
      - label: 浮层已打开
        ax: { has: "选择一个目录作为新 vault" }

  - name: 点 B 那一行请求切换——被 dirty 门拦下
    do: click
    target: { role: AXStaticText, any: "lumir-m102-acceptance-b" }
    expect:
      - shot: dirty 拦截浮条
      - label: 提示点名**当前** vault 与脏标签数（D109：未保存修改属于当前 vault）
        ax: { has: "「lumir-m102-acceptance」里有 1 个标签有未保存修改，切换会丢弃这些修改" }
      - label: 出口一「保存并切换」在（这一条有落盘基准 → 三出口齐全）
        ax: { has: "保存并切换" }
      - label: 出口二「放弃修改并切换」在
        ax: { has: "放弃修改并切换" }
      - label: 出口三「取消」在
        ax: { has: "取消" }
      - label: 拦下时上下文没变（仍停在 A）
        ax: { has: "vault：lumir-m102-acceptance（点击查看全部 vault）" }

  - name: 出口三「取消」——什么都不做，留在 A 且改动不丢
    do: click
    target: { role: AXButton, name: "^取消$" }
    expect:
      - shot: 取消之后
      - label: 仍停在 A
        ax: { has: "vault：lumir-m102-acceptance（点击查看全部 vault）" }
      - label: 未保存的修改还在编辑器里
        editor: { has: "GUARD-EDIT-1" }
      - label: 拦截浮条已撤下（点任一动作即关掉浮条）
        ax: { not: "切换会丢弃这些修改" }

  - name: 再请求一次切换（同一条文案的第二次请求）
    do: click
    target: { any: "点击查看全部 vault" }
    expect:
      - shot: 第二次浮层
      - label: 浮层已打开
        ax: { has: "选择一个目录作为新 vault" }

  - name: 点 B 那一行——第二次拦截
    do: click
    target: { role: AXStaticText, any: "lumir-m102-acceptance-b" }
    expect:
      - shot: 第二次拦截
      - label: 浮条再次给出同一条提示（同文案的第二次请求不能复用旧浮条——复用会把新的目标丢掉）
        ax: { has: "「lumir-m102-acceptance」里有 1 个标签有未保存修改，切换会丢弃这些修改" }

  - name: 出口一「保存并切换」——保存闭环不了时不继续切换（任务 4.2）
    do: click
    target: { role: AXButton, name: "^保存并切换$" }
    expect:
      - shot: 保存并切换（冲突未闭环）
      - label: 没有切走（保存未闭环 → MUST NOT 继续切换）
        ax: { has: "vault：lumir-m102-acceptance（点击查看全部 vault）" }
      - label: 沿用既有保存链路的出口（重载 / 保留我的版本）而不是静默失败
        ax: { has: "保留我的版本" }
      - label: 内存里的修改仍在
        editor: { has: "GUARD-EDIT-1" }

  - name: 第三次请求切换，这次走「放弃修改并切换」
    do: click
    target: { any: "点击查看全部 vault" }
    expect:
      - shot: 第三次浮层
      - label: 浮层已打开
        ax: { has: "选择一个目录作为新 vault" }

  - name: 点 B 那一行——第三次拦截
    do: click
    target: { role: AXStaticText, any: "lumir-m102-acceptance-b" }
    expect:
      - shot: 第三次拦截
      - label: 拦下（dirty 门对每次请求都成立，不因前两次处置过就放行）
        ax: { has: "切换会丢弃这些修改" }

  - name: 出口二「放弃修改并切换」——直接切，改动随整窗复位作废
    do: click
    target: { role: AXButton, name: "^放弃修改并切换$" }
    expect:
      - shot: 放弃修改并切换之后
      - label: 已切到 B
        ax: { has: "vault：lumir-m102-acceptance-b（点击查看全部 vault）" }
      - label: 被放弃的内存修改没有落盘
        file: { path: tabs-a.md, not: "GUARD-EDIT-1" }
      - label: 磁盘上仍是外部那一版（放弃的是我的改动，不是把文件改坏）
        file: { path: tabs-a.md, has: "DISK-VERSION" }
---

说明：本条对应 change `multi-vault-workspaces` 的任务 6.1 ③（评审口径：三条出口各自闭环）。
每一条出口都用「**落盘事实 + 上下文归属**」两类断言一起钉：

| 出口 | 上下文归属 | 落盘事实 / 链路出口 | 反证 |
|---|---|---|---|
| 取消 | 仍停在 A | 不适用（不产生写） | 编辑器仍含 `GUARD-EDIT-1`（没有静默丢弃） |
| 保存并切换 | **不**切走（保存未闭环，任务 4.2） | 沿用既有保存链路的「重载 / 保留我的版本」 | 内存修改仍在（不是静默失败） |
| 放弃修改并切换 | 切到 B | `tabs-a.md` 不含 `GUARD-EDIT-1`、仍是 `DISK-VERSION` | 两条 `file` 互为反证 |

**为什么用「外部改写成冲突」而不是「改完立刻切」**：dirty 前置门的判据是「任一**有路径**的标签
dirty」（`src/save-controller.ts:vaultSwitchBlock`），而自动保存的防抖是**停止输入后 2s**
（`AUTOSAVE_DEBOUNCE_MS`）——落盘后 dirty 就收回 false。首两轮实测验过两种抢窗口的写法都不成立：
① 跨步（先改 → 再开浮层 → 再切）必然等到自动保存（门不触发，直接切走）；② 把刷新字符与
`⌘O`/`↓`/`Enter` 塞进同一个 `keys` 步也不行——`keys` 每键之间 sleep 250ms 且每键一次 MCP 往返，
整串 2s 以上，仍越过窗口。**外部改写把 dirty 变成持久状态**（冲突待决期间自动保存暂停，08b 已覆盖
该行为），于是这条守卫可以被稳定地触发，不再与注入耗时赛跑。

**这一版覆盖到的与没覆盖到的（如实声明）**：
- 覆盖：三出口的**呈现**（点名当前 vault + 脏标签数 + 三个动作）、取消的「不丢内容」、
  保存并切换的「保存未闭环则不切走 + 沿用既有出口」（任务 4.2 的原文），以及放弃的「改动不落盘」。
- **未覆盖**：保存并切换在**保存能闭环**时「保存成功 → 继续切换」那条顺路。它在真机上要求
  「文档变更后 2s 内发出切换请求」，而本套件的键盘注入每键约 250ms+一次 MCP 往返，做不到
  确定性；该路径由 chromium 视觉通道覆盖（`tests/visual/scenes/mv-vault-switch-guard.spec.ts`
  用 stub 直连、无注入耗时），本场景不宣称覆盖——这是**套件表达力缺口**，已记在
  `scripts/acceptance/README.md`「已知边界」。
- **未覆盖**：不可保存的脏标签（无名文档）不给「保存并切换」这条分支——同样在
  `tests/unit/vault-switcher.test.ts` 的状态机口径里。

**为什么第二次拦截要单独断言一次「同一条文案」**：浮条按文案去重（`toast` 的 sticky 语义），
而守卫浮条的动作带着「切到哪一个」。同文案的第二次请求若复用旧元素，被丢弃的是**新的** proceed
——用户看到的仍是绑着上一次目标的出口（M163 r1 P2-1 修的就是这条）。所以第二次拦截必须自己成一步
断言，不能靠第一次的结论继承。

**为什么点列表行而不是 `↓` + `Enter`**：列表行在 AX 里是 `AXStaticText` + `AXPress`，点击是确定性的；
而 `keys` 对非可打印键不做回读重试，丢一个键会让本步的断言红（不会静默切错目标），但也多一次不确定
因素。键盘开合（`⌘O` 开 / `Esc` 关）与键盘导航由 17-multi-vault-switch 与视觉通道覆盖。两行名字
互相是前缀，所以 A 的行用 `"/lumir-m102-acceptance /"`（名称后紧跟空格）排除 B 的行。
