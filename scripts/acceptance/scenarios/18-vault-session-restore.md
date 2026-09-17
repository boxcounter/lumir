---
id: "18-vault-session-restore"
item: 18
title: 启动按 last_vault 恢复 vault，并一并恢复它的标签列表与激活项
fixtures: [tabs-a.md, tabs-b.md]
seed:
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-a: { tabs: [tabs-a.md, tabs-b.md], active: tabs-b.md }
steps:
  - name: 等启动恢复（vault + 逐标签恢复）跑完
    do: sleep
    ms: 8000
    expect:
      - shot: 启动后的两个标签
      - label: vault 按 last_vault 自动恢复（形态 A 的入口点名 A，D96 读屏名）
        ax: { has: "vault：lumir-m102-acceptance（点击查看全部 vault）" }
      - label: 会话里的两个固定标签都恢复了
        ax: { count: { pattern: "关闭 ", exact: 2 } }
      - label: 激活项是会话里存的 tabs-b（不是退化后的第一个）
        editor: { has: "标签场景 B" }
      - label: 第一个标签的正文没有上屏（激活项退化的反证）
        editor: { not: "标签场景 A" }
      - label: 树里是 A 的条目（装载的是 last_vault 那个 vault）
        ax: { has: "tabs-a.md" }
      - label: 恢复完毕后不残留空 vault 引导（有标签就不该再盖着正文）
        ax: { not: "这个 vault 还没有打开的文件" }
---

说明：本条对应 change `multi-vault-workspaces` 的任务 6.1 ②。与 M159 的 `16-startup-restore`
分工：16 验的是「vault 恢复本身」（含 `last_vault` 失效的降级路径），本条验的是 **vault 恢复之后
紧接着的标签恢复**（任务 4.5 / 4.6 的衔接）——恢复计划从会话文件出发，逐条用**固定标签**意图打开，
最后激活存储的激活项。

**为什么这样断言**：
- 标签恢复是否真的发生，最直接的证据是「有 2 个标签」而**不是**「编辑器里有内容」——没有会话时
  前端停在空 vault 首入态（正文被 D107 的引导盖住、一个标签都没有），所以 `关闭 ` ×2 是恢复成功的
  判据；
- 「激活项正确」用**正文内容**区分：只有激活项是 tabs-b 时编辑器才含「标签场景 B」。`editor.not
  "标签场景 A"` 是它的反证——若激活项退化成了第一个，这条必 FAIL（两条一起才有区分度，
  REVIEW.md 第 1 条：单看 `has` 无法把「恢复对了」与「恢复成了别的标签」分开）；
- 「树里是 A 的条目」把「vault 恢复」与「标签恢复」绑在同一个 snapshot 里，避免拍到切换中的中间态。

**会话由 `seed.sessions` 预置**（`<隔离配置>/lumir/vault-sessions/acc-a.json`）：会话是前一进程
落盘的状态，本场景只验「读回来并恢复」，写入侧由 17-multi-vault-switch 的 `file` 断言覆盖。

**不覆盖**：会话里越界（绝对路径 / `..`）、缺失、打不开的条目「跳过并给一次计数提示」这条分支
不在这里——它需要一个损坏的会话文件与一次真实重启，属 4.9 的前端单测口径（`tests/unit`），
本场景不宣称覆盖。
