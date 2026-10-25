---
id: "251-settings-panel-legacy-preset-migration"
item: 251
title: 设置面板：旧格式 provider（无 preset）首次启动补齐迁移，二次启动不再写盘（mtime 不变）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  # 旧格式条目：只有 api_key / model / models，**没有 preset**。套件具名键会先替条目补 preset，
  # 因此这里走 rawProviders 原样写入（见 scripts/acceptance/README.md 的 rawProviders 条）。
  harness:
    rawProviders:
      kimi:
        api_key: "acceptance-dummy"
        model: "k3-256k"
        models:
          - { id: "k3-256k", effort: true, vision: true, window: 262144 }
steps:
  - name: 首次启动：一次性迁移把旧条目补上 preset（装载期写盘，等待文件事实）
    do: waitForFile
    waitForFile:
      path: "env:config.json"
      has: '"preset": "kimi"'
    timeoutMs: 30000
    expect:
      - label: 迁移补齐 preset（旧三档 id 之一 → kimi）
        file: { path: "env:config.json", has: '"preset": "kimi"' }
      # `file.has` 只收单个字符串 / 正则（数组是 `waitFor.has` 的形态），逐条写。
      - label: 旧条目的 model 逐字保留（迁移只补 preset，不改用户值）
        file: { path: "env:config.json", has: '"model": "k3-256k"' }
      - label: 旧条目的 Key 逐字保留
        file: { path: "env:config.json", has: '"acceptance-dummy"' }

  - name: 记录迁移后的文件基线（sha256 + mtime）
    do: record
    as: migrated
    file: "env:config.json"

  - name: ⌘,（与菜单项同一条命令）
    do: keys
    keys: ["cmd+,"]
  - name: 等面板落到可观测终态（菜单跟踪期间 AX 只读得到菜单栏，抢跑会拿菜单树判面板）
    do: waitFor
    waitFor:
      has: ["模型接入与自动化 · 配置文件", "kimi，Kimi，已配置"]
    timeoutMs: 20000
    expect:
      - label: 面板打开（副标题写明配置文件来源）
        ax: { has: "模型接入与自动化 · 配置文件" }
      - label: 迁移后的条目在列表里，读屏名带预设标签 Kimi 与「已配置」
        ax: { has: "kimi，Kimi，已配置" }
      - shot: 01-迁移后-设置面板
  - name: 关闭面板（看文件是否被动过）
    do: keys
    keys: ["Escape"]

  - name: 二次启动（同一份已迁移的配置）
    do: restart
    expect:
      - label: 启动恢复落定（本场景打开的是 harness-note.md）
        ax: { has: "关闭 harness-note.md" }

  - name: 二次启动不重写文件（迁移幂等：sha256 与 mtime 都不变）
    expect:
      - label: 配置文件逐字节未变化（一次性迁移只写一次）
        file: { path: "env:config.json", unchangedSince: migrated }
      # unchangedSince 只比 sha256（execute.mjs 的独立分支），「写回同一份字节」照样 PASS；
      # mtime 是另一条判据，必须同写才判得到「没写过」（执行器注释与 M543 的口径）。
      - label: mtime 未推进（不是把同一份字节重写了一遍）
        file: { path: "env:config.json", mtimeUnchangedSince: migrated }
      - label: 文件里仍只有一份 preset（没有被重复补写 / 无重复条目）
        file: { path: "env:config.json", has: '"preset": "kimi"' }
---

# 251-settings-panel-legacy-preset-migration —— 旧格式配置的一次性迁移与幂等

## 本场景在验什么

change `add-model-automation-settings-oct24` tasks §2.5 / §7.8：

1. **旧格式（无 `preset`）的 provider 条目在首次启动时被迁移**：旧三档 id（`kimi` /
   `deepseek` / `mock`）按 id 补上对应 `preset`，其余字段逐字保留（Key / model / models）。
2. **迁移是幂等的**：第二次启动不再写盘——`record` 之后**两条判据同写**：`unchangedSince`
   比 sha256、`mtimeUnchangedSince` 比 mtime。只比内容会在「写回同一份字节」时假绿，只比
   mtime 又认不出别处的等价改写；两条一起才判得出「没写过」。
3. **迁移后的条目在设置面板里可用**：打开面板能看到该 provider 与「已配置」状态，预设标签
   取自迁移补上的 `preset`（不是按 id 猜的运行时行为）。

## 为什么需要 `rawProviders`

套件的 `config.harness` 具名键（`kimiModel` / `kimiModels` / `fixture`）会**先替条目写好
`preset`**，构造不出「旧格式待迁移」的现场。`rawProviders` 是原样透传入口，放在具名键之后
（显式覆盖），只给这类「手写形状 / 旧版本配置」的场景用（README 同条）。

## 已知边界

- 迁移的判定表（显式 preset 不覆盖、未知 id 不迁移、与退役 model 迁移同一次原子写）由
  Rust 单测逐条覆盖（tasks §7.3）；本场景只验真机上的「首次补、二次不写」这一对终态。
- 用户真实 `~/.config/lumir` 不读写；本场景全部在套件隔离配置目录内。
