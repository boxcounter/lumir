---
id: "256-settings-cancel-close-oct29"
item: 256
tier: full
title: 设置面板：底栏「取消」= 关闭（干净直关、脏草稿先确认、确认放弃后关闭且文件逐字节不变）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  # 与 250 同一份现场：只有保留的 mock 条目 ⇒ 列表是显式空态。本场景只碰底栏与自动化区，
  # 不需要 provider；空态同时让「重新打开后草稿按已保存值重建」的判据更好读。
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: ⌘,（与菜单「设置…」走同一条命令）
    do: keys
    keys: ["cmd+,"]
  # 面板打开是异步的（⌘, 还要经过原生菜单项的菜单跟踪，期间 AX 只读得到菜单栏）：先等可观测
  # 终态再判，否则第一次读取会拿菜单树去判面板（251 首跑即此形态）。
  - name: 等面板落到可观测终态
    do: waitFor
    waitFor:
      has: ["模型接入与自动化 · 配置文件", "还没有 provider"]
    timeoutMs: 20000
    expect:
      - label: 面板打开在配置文件上
        ax: { has: "模型接入与自动化 · 配置文件" }
      - label: 干净态：状态行写明没有未保存的修改
        ax: { has: "没有未保存的修改" }
      # 名称仍是「取消」（英文 Cancel）：它的语义是关闭对话框，与另外三条关闭路径同义。
      - label: 底栏「取消」在位
        node: { role: "AXButton", name: "^取消$", present: true }
      - shot: 01-打开-干净态

  - name: 记录配置文件基线（后面每一条「不写盘」都相对它判）
    do: record
    as: before-cancel
    file: "env:config.json"

  # 脏草稿的制造用页级「还原此页默认」：它只改草稿并必然把草稿标脏（draft.pageReset），
  # 不依赖任何输入框回读——API Key 是 password，注入后 AX 只剩圆点遮罩（250 的已知边界）。
  - name: 制造脏草稿（页级还原只改草稿）
    do: click
    target: { role: "AXButton", name: "^还原此页默认$" }
    expect:
      - label: 草稿变脏：状态行转为「有未保存的修改」
        ax: { has: "有未保存的修改" }
      - label: 还原只改草稿、此刻不写盘
        file: { path: "env:config.json", unchangedSince: before-cancel }

  - name: 脏草稿点「取消」
    do: click
    target: { role: "AXButton", name: "^取消$" }
    expect:
      # 旧语义在这里会「在面板里把草稿恢复成已保存配置」并留着面板；Alex 已否定该语义。
      - label: 面板不关闭（脏草稿先确认，MUST NOT 静默丢弃）
        ax: { has: "模型接入与自动化 · 配置文件" }
      - label: 出现两步确认的确认句
        ax: { has: "放弃未保存的修改？" }
      - label: 确认框给「继续编辑」
        node: { role: "AXButton", name: "^继续编辑$", present: true }
      - label: 确认框给「放弃修改」
        node: { role: "AXButton", name: "^放弃修改$", present: true }
      - shot: 02-取消-先确认

  - name: 选「继续编辑」保留草稿
    do: click
    target: { role: "AXButton", name: "^继续编辑$" }
    expect:
      - label: 面板仍在（确认框撤下，不关闭）
        ax: { has: "模型接入与自动化 · 配置文件" }
      - label: 草稿保留（状态仍是「有未保存的修改」）
        ax: { has: "有未保存的修改" }
      - label: 继续编辑不写盘
        file: { path: "env:config.json", unchangedSince: before-cancel }

  - name: 再次点「取消」
    do: click
    target: { role: "AXButton", name: "^取消$" }
  - name: 确认放弃修改
    do: click
    target: { role: "AXButton", name: "^放弃修改$" }
  - name: 等面板关闭
    do: waitFor
    waitFor:
      not: ["模型接入与自动化 · 配置文件"]
    timeoutMs: 10000
    expect:
      - label: 面板关闭（放弃一律走关闭，不是在面板里恢复出一份「已保存配置」）
        ax: { not: "模型接入与自动化 · 配置文件" }
      - label: 放弃草稿不写盘（文件逐字节不变）
        file: { path: "env:config.json", unchangedSince: before-cancel }
      # unchangedSince 只比 sha256：把同一份字节重写一遍也会 PASS。mtime 是另一条判据。
      - label: mtime 未推进（不是把同一份字节重写了一遍）
        file: { path: "env:config.json", mtimeUnchangedSince: before-cancel }
      - shot: 03-放弃后关闭

  - name: 重新打开设置面板
    do: keys
    keys: ["cmd+,"]
  - name: 等面板重新落到终态
    do: waitFor
    waitFor:
      has: ["模型接入与自动化 · 配置文件", "没有未保存的修改"]
    timeoutMs: 20000
    expect:
      - label: 重新打开是干净态（上一份草稿真被丢弃，不是留着旧草稿）
        ax: { has: "没有未保存的修改" }
      - label: 页级还原按钮仍在（草稿没有被写成删除态）
        node: { role: "AXButton", name: "^还原此页默认$", present: true }

  - name: 干净草稿点「取消」
    do: click
    target: { role: "AXButton", name: "^取消$" }
  - name: 等面板关闭
    do: waitFor
    waitFor:
      not: ["模型接入与自动化 · 配置文件"]
    timeoutMs: 10000
    expect:
      # 干净草稿不需要放弃，因此不出现两步确认；旧语义下这里会「重置草稿、面板留着」。
      - label: 干净草稿直接关闭，不出现确认框
        ax: { not: "放弃未保存的修改？" }
      - label: 面板已关闭
        ax: { not: "模型接入与自动化 · 配置文件" }
      - label: 干净关闭同样不写盘
        file: { path: "env:config.json", unchangedSince: before-cancel }
      - shot: 04-干净-直接关闭
---

# 256-settings-cancel-close-oct29 —— 设置面板底栏「取消」= 关闭

## 本场景在验什么

Alex 反馈：底栏「取消」点了没反应，且这个名称联想不到它当时的语义。旧实现点「取消」执行
`resetDraftFrom(snapshot)`——把草稿恢复成已保存配置、面板留在原地；它无法完成「放弃这次修改」的
目的，也与 Cancel 在对话框里的通行含义对不上。Alex 已否定保留该语义，新语义 = **放弃当前草稿并
关闭**，与 × / Escape / 点遮罩同一条 `requestClose`：

1. **干净草稿点「取消」直接关闭**：不出现确认、不写盘（旧语义下面板会留着并重置草稿，判据红）。
2. **脏草稿先确认**：出现「放弃未保存的修改？」两步确认，面板不关闭、文件逐字节不变；
   选「继续编辑」保留草稿（仍是「有未保存的修改」），选「放弃修改」后面板关闭，文件 sha256 与
   mtime 都不变。
3. **关闭路径真的丢弃草稿**：重新打开时状态是「没有未保存的修改」，草稿按已保存值重建——
   证明关闭丢弃了草稿，而不是把它留着或写进文件。
4. 名称保持「取消」（Cancel）：语义既然只有关闭，这个名字与另外三条关闭路径一致，不需要改文案。

## 与视觉场景的分工

- 本场景（真机 WKWebView）验**行为主链**：干净直关 / 先确认 / 继续编辑保留 / 放弃后关闭且不写盘。
- 保存中「取消」禁用、`settings_apply` 零调用、`aria-checked` 草稿保留这些结构化判据在
  `tests/visual/scenes/m734-settings-panel.spec.ts` 的第 10 节（chromium 结构层，能读 DOM 与
  打桩计数，是真机 AX 读不到的那一层）。
- 保存中的真机禁用不重复验：请求要挂住才能观测，而真机场景没有可控的「永不返回」后端；
  这条归视觉场景的 `apply: pending` 桩。

## 判据形态备忘

- `ax.has` / `ax.not` 只收单个字符串或 `/…/` 正则；数组形态只有 `waitFor.has` / `waitFor.not`
  支持（写数组会被 `matcher()` 拼成一个字面串，恒不命中）。
- 节点在场性判据走 `node`（裸正则源），不用 `ax.has`：确认句「放弃未保存的修改？」在状态行 /
  正文里都不会出现，但按钮名「取消」这类短串用 `node` + `role` 才不会被同名的静态文本命中。
- 放弃 = 关闭，所以「文件没被写」要同时判 `unchangedSince`（sha256）与 `mtimeUnchangedSince`
  （mtime 精确相等）——只比 sha256 时把同一份字节重写一遍也会 PASS。
