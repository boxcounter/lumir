---
id: "226-vault-remove"
item: 226
title: vault 列表移除（M646）：当前项无移除入口 / 行内两步确认 / 只删注册表项 / 8s 撤销
fixtures: [tabs-a.md]
seed:
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
  # 被移除项的 per-id 数据：移除 MUST NOT 碰它（D2 裁决「只删注册表项」）。
  sessions:
    acc-b: { tabs: [beta.md], active: beta.md }
steps:
  - name: 打开一个文件（当前 vault 有标签历史，行摘要因此与「还没有打开过文件」区分得开）
    do: open
    file: tabs-a.md
    marker: "标签场景 A"
    expect:
      - shot: 01-打开文件
      - label: 正文上屏
        editor: { has: "标签场景 A" }

  - name: 记下被移除 vault 里那个文件的字节基线（移除 MUST NOT 碰 vault 目录）
    do: record
    as: vault-b-beta
    file: "$vault-b/beta.md"
    expect:
      - label: 第二 vault 的 fixture 文件在场（基线有对象，不是空基线）
        file: { path: "$vault-b/beta.md", exists: true }

  - name: 点树头部入口打开切换器
    do: click
    target: { any: "点击查看全部 vault" }
    expect:
      - shot: 02-列表
      - label: 两行都在（当前项 + 另一行）
        ax: { has: "lumir-m102-acceptance-b" }
      - label: 非当前行有移除钮，读屏名点名该行显示名（`×` 是图形、不成词）
        ax: { has: "从列表移除 lumir-m102-acceptance-b" }
      - label: 当前行 MUST NOT 有移除钮（两行名字互为前缀，边界正则排除 b 那一枚）
        ax: { not: '/从列表移除 lumir-m102-acceptance(?![\w-])/' }

  - name: 点另一行的 × —— 进入行内两步确认（未执行任何删除）
    do: click
    target: { role: AXButton, name: "^从列表移除 lumir-m102-acceptance-b$" }
    expect:
      - shot: 03-确认态
      - label: 确认句点名显示名并写明盘上数据不受影响
        ax: { has: "从列表移除「lumir-m102-acceptance-b」？磁盘上的目录与文件不受影响。" }
      - label: 破坏侧与取消侧两个按钮都在
        ax: { has: "/AXButton \\(移除\\)/" }
      - label: 取消钮是 D136 的串（破坏性动作的默认落点）
        ax: { has: "/AXButton \\(取消\\)/" }
      - label: 进入确认态 = 零副作用（注册项还在）
        file: { path: "env:vault-registry/acc-b.json", exists: true }

  - name: 点「取消」——该行逐字还原，零副作用
    do: click
    target: { role: AXButton, name: "^取消$" }
    expect:
      - shot: 04-取消后
      - label: 确认句撤下（行还原）
        ax: { not: "磁盘上的目录与文件不受影响" }
      - label: 移除钮回来（行回到初始形态）
        ax: { has: "从列表移除 lumir-m102-acceptance-b" }
      - label: 取消 = 零副作用（注册项还在）
        file: { path: "env:vault-registry/acc-b.json", exists: true }

  - name: 再点 × 进入确认态，随后确认移除
    do: click
    target: { role: AXButton, name: "^从列表移除 lumir-m102-acceptance-b$" }
    expect:
      - label: 确认态再次出现
        ax: { has: "磁盘上的目录与文件不受影响" }

  - name: 点「移除」——执行移除
    do: click
    target: { role: AXButton, name: "^移除$" }

  - name: 等移除生效（该行的移除钮从列表消失）
    do: waitFor
    waitFor:
      not: ["从列表移除 lumir-m102-acceptance-b"]
    timeoutMs: 15000
    expect:
      - shot: 05-已移除
      - label: 该行从列表消失（注册表项已删，列表是重新拉取的）
        ax: { not: "从列表移除 lumir-m102-acceptance-b" }
      - label: 浮层保持打开（移除是列表动作，不收起浮层）
        ax: { has: "选择一个目录作为新 vault" }
      - label: 当前项仍在（D98 的「当前」标只出现在当前项那一行，且移除入口对它不可达）
        ax: { has: "当前" }
      - label: 注册表项文件被删（唯一写点）
        file: { path: "env:vault-registry/acc-b.json", exists: false }
      - label: 当前项的注册项不受影响
        file: { path: "env:vault-registry/acc-a.json", exists: true }
      - label: vault 目录内的文件逐字节不变（移除 MUST NOT 删盘上数据）
        file: { path: "$vault-b/beta.md", unchangedSince: vault-b-beta, mtimeUnchangedSince: vault-b-beta }
      - label: 被移除项的标签会话留着（per-id 数据不是移除的删除面，成为不可达孤儿）
        file: { path: "env:vault-sessions/acc-b.json", has: "beta.md" }
      - label: 撤销提示上屏（非 sticky，8s 后自消）
        ax: { has: "已从列表移除「lumir-m102-acceptance-b」" }

  - name: 点提示上的「撤销」——按原值写回注册项
    do: click
    target: { role: AXButton, name: "^撤销$" }

  - name: 等撤销生效（该行回到列表）
    do: waitFor
    waitFor:
      has: ["从列表移除 lumir-m102-acceptance-b"]
    timeoutMs: 15000
    expect:
      - shot: 06-撤销后
      - label: 该行回到列表（refresh 重拉，浮层仍开着）
        ax: { has: "从列表移除 lumir-m102-acceptance-b" }
      - label: 注册项按原值写回（稳定 id 不变）
        file: { path: "env:vault-registry/acc-b.json", has: '"id": "acc-b"' }
      - label: 撤销不打开、不切换（当前项仍是 acc-a 那一行）
        ax: { has: "当前" }

  - name: 再移除一次（为「重开浮层仍在」这条持久化判据留现场）
    do: click
    target: { role: AXButton, name: "^从列表移除 lumir-m102-acceptance-b$" }
    expect:
      - label: 确认态出现
        ax: { has: "磁盘上的目录与文件不受影响" }

  - name: 点「移除」
    do: click
    target: { role: AXButton, name: "^移除$" }

  - name: 等该行再次消失
    do: waitFor
    waitFor:
      not: ["从列表移除 lumir-m102-acceptance-b"]
    timeoutMs: 15000
    expect:
      - label: 该行消失（第二次移除同样只删注册表项）
        ax: { not: "从列表移除 lumir-m102-acceptance-b" }

  - name: Esc 收起浮层
    do: key
    key: "escape"

  - name: 等浮层收起生效（Esc 是盲发 chord，读得太早会读到收起前的帧）
    do: waitFor
    waitFor:
      not: ["选择一个目录作为新 vault"]
    timeoutMs: 15000

  - name: ⌘O 再打开浮层
    do: key
    key: "cmd+o"

  - name: 等浮层重新出现
    do: waitFor
    waitFor:
      has: ["选择一个目录作为新 vault"]
    timeoutMs: 15000
    expect:
      - shot: 07-重开
      - label: 该行仍不在（删除落在注册表上，不是界面上的过滤）
        ax: { not: "从列表移除 lumir-m102-acceptance-b" }
      - label: 当前项仍在列表里（D98 的「当前」标）
        ax: { has: "当前" }
      - label: 注册表项文件仍不在
        file: { path: "env:vault-registry/acc-b.json", exists: false }
---

# 226-vault-remove —— vault 列表移除（M646，change vault-and-session-removal）

## 本场景在验什么

浮层里除当前项之外的每一行都有行尾移除钮（`×`，读屏名 D557），点它进入**行内两步确认**
（D558 确认句 + 「移除」D559 / 「取消」D136），确认后后端只删注册表项
`<config>/vault-registry/<id>.json`；成功后给一条**非 sticky** 提示（D560 + 撤销 D561，8s 后
自消）。真机判据五条链，每条都落在可观测终态上：

1. **入口形态**：当前项那一行没有移除钮（spec「当前项没有移除入口」），其余行有；移除钮与
   切换钮是**兄弟**（嵌套 button 在 WKWebView 里是叶子，M351），因此 AX 里能读到它的
   可访问名「从列表移除 {显示名}」——这一条同时是 design §3.1「listbox 内兄弟按钮在读屏树里
   的实际形态」的现场读数（读不到就是该条登记的已知边界，不是静默放过）。
2. **两步确认**：× → 确认句 + 两个按钮；取消逐字还原（确认句撤下、移除钮回来、注册项还在）。
3. **只删注册表项**：确认后注册项文件消失、当前项与其它项文件不动；vault 目录里的文件
   **逐字节不变**（`unchangedSince` + `mtimeUnchangedSince` 成对写——只判 sha256 时「写了同样的
   内容」会假绿）；`vault-sessions/<id>.json` 这类 per-id 数据留着（D2 裁决：成为不可达孤儿）。
4. **撤销**：点提示上的「撤销」→ 注册项按原值写回（`id` 原样）、该行回到列表、不打开不切换。
5. **持久化**：第二次移除后收起再重开浮层，该行仍不在——删的是注册表，不是界面上的过滤。

## 边界

- 「回到列表」的判据用**移除钮的可访问名**而不是行名：行名 `lumir-m102-acceptance` 是
  `-b` 的前缀，而移除提示的文案里也带被移除项的名字——按行名判「在不在」会在提示上屏期间
  恒绿（REVIEW.md「断言等价于子串」条）。可访问名只可能来自那一行的移除钮。
- **兄弟按钮在 AX 里的可读性**（design §3.1 的已知边界）：本场景的第一步就断言
  「从列表移除 {显示名}」出现在 AX 里，因此它同时是这条边界的现场读数——同形态的会话浮层
  （M406，`div` 壳 + 兄弟 `×`）已被场景 108 钉住 `AXButton (删除该会话)`，预期本场景读到同样的
  形态；若读不到（WKWebView 把兄弟按钮吞了），这条断言会当场判红而不是静默放过，届时按
  design §3.1 的备选形态（行内 `×` 但读屏名挂在 option 上）改形并回到这里登记。
- 撤销提示 8s 后自消，因此撤销步骤紧跟在移除之后（中间只隔一轮 `waitFor` 与读盘断言）。
- 第二次移除后不再撤销：收尾不处理「重开浮层仍在」之外的持久化形态，下一次运行由
  `resetRegistry` 清空隔离配置目录。
- 不覆盖：只有一个 vault 时移除入口整体不可达（D1 = A 的代价，spec 明写「除当前项之外」）；
  移除失败（权限 / IO）的提示走 `vault_remove_failed`（D563），真机上造不出稳定的权限失败，
  该档只在后端单测与 `ERROR_COPY` 的完整性门禁里验。
