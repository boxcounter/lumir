---
# M452（change composer-draft-persistence，design §9 ⑦）：**无 vault 打开时不落盘、不报错**。
#
# 现场构造沿用场景 16 的失效路径：把 last_vault 指向一个不存在的目录并重启 ⇒ 应用进入
# 「上次打开的 vault 已不可用」的未打开空态（后端没有 vault 作用域）。此时在 harness 面板的
# 输入区打字：输入区照常可编辑、**不产生任何 drafts/ 文件、不弹错误、不落兜底目录**。
#
# 为什么这是独立场景：本能力全部落盘路径都按「当前 vault 的稳定 id」解析落点，无 vault 是它的
# 边界态；而套件其余场景都在「已装载 vault」的前提下跑，构造不出这个起点。
id: "139-harness-draft-no-vault"
item: 139
title: composer 草稿：无 vault 打开时只在内存工作（不落盘、不报错、不落兜底目录）
steps:
  - name: 默认 config 启动（last_vault = 验收 vault）——先确认应用已就绪
    expect:
      - label: 树已装载验收 vault 的文件（就绪正观测）
        ax: { has: "plain.md" }
      - shot: 01-起始态-已装载 vault

  - name: 把 last_vault 指向不存在的目录并重启（构造「无 vault 打开」，同场景 16 的失效路径）
    do: configWrite
    lastVault: /tmp/lumir-m452-no-such-vault
    requireVault: false
    expect:
      - label: 进入未打开空态并给出失效原因（正观测：空态确实到位，不是「读不到当没有」）
        ax: { has: "上次打开的 vault 已不可用" }
      - label: 「打开 vault」入口在 AX 里可见（入口在 ⇒ 确实停在未打开态）
        ax: { has: "/AXButton[^\\n]*打开 vault/" }
      - shot: 02-无 vault-空态

  - name: ⌘⇧A 打开 harness pane（无 vault 时面板照常可用）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 输入区在位（空态 = D328 占位读名）
        ax: { has: "问点什么" }
      - shot: 03-无 vault-面板与输入区

  - name: 点输入区聚焦并键入内容（无 vault 时照常可编辑）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 键入标记串
    do: keys
    keys: ["n", "o", "v", "a", "u", "l", "t", "m", "a", "r", "k"]
    expect:
      - label: 标记落在输入区（无 vault 不阻断输入）
        ax: { has: "novaultmark" }

  - name: 等防抖窗口（1s）+ 余量（若命令被发出，这一拍足够它落盘）
    do: sleep
    ms: 3000
    expect:
      - label: ⑦ 不产生任何 drafts 目录 / 文件（MUST NOT 落盘、MUST NOT 落兜底目录）
        file: { path: "env:harness/drafts", exists: false }
      - label: ⑦ 负向复核：drafts 下零文件（含 *.json / *.tmp 任何形态）
        glob: { dir: "env:harness/drafts", pattern: ".*", exact: 0 }
      - label: ⑦ 不报错：没有草稿保存失败的提示（D456）
        ax: { not: "草稿保存失败" }
      - label: ⑦ 输入区内容仍在内存里（不落盘 ≠ 丢内容）
        ax: { has: "novaultmark" }
      - label: ⑦ 空态提示仍在（面板可用性与 vault 状态无关，未被草稿逻辑改判）
        ax: { has: "上次打开的 vault 已不可用" }
      - shot: 04-无 vault-编辑后仍无 drafts
---

# 139-harness-draft-no-vault —— 无 vault 时只在内存工作（design §9⑦）

## 本场景在验什么

spec「composer 草稿自动保存与恢复」的无 identity 分支：**无 vault 打开时系统 SHALL 只在内存中
工作——MUST NOT 落盘、MUST NOT 报错、MUST NOT 落任何兜底目录**。

这条的语义在 design §3 里写明了「为什么与附件不同」：附件的写失败要报错（一张丢掉的图会被
误以为已投递），而草稿是**无副作用的 UI 状态**——没有可归属身份 ≠ 错误。本场景把这条钉在真机上。

## 判据为什么这样写

- **`file: { path: "env:harness/drafts", exists: false }` 是主判据**：目录本身不该被创建
  （写路径在「拿不到合格 id」时**在建目录之前**返回）。只判「目录里没有某文件」会漏掉
  「建了一堆空目录」这种半落形态。
- **「不报错」的判据是 D456 文案不在场**：草稿保存失败的人话出口只有这一条（写失败 →
  `harness_draft_write_failed` → D456），它出现即说明命令真的被发出且失败了。配一条**正观测**
  （「上次打开的 vault 已不可用」仍在、输入区文本仍在），避免「AX 读不到 ⇒ 负向恒真」
  （REVIEW.md 第 2 条）。
- **`glob` 复核用 `.*` 通配**：任何形态的文件（`.json` / `.json.tmp` / 别的）都算落盘。
- **无 vault 的现场用场景 16 的失效 last_vault 构造**：`configWrite` 的 `lastVault` 参数 +
  `requireVault: false`（本步重启放宽就绪门——未打开空态下树里没有 `.md` 行），与 16 逐字同源。

## 覆盖边界（如实登记）

- **真机跑绿状态**：本场景随 change 同 PR 交付，**本轮未跑真机**（前台窗口由 tower 统一安排）。
  本场景依赖两件事，运气不好会在首次跑批暴露：(a) 未打开空态下 ⌘⇧A 仍能开出 harness pane
  （`openHarnessPane` 不读 vault，代码上成立）；(b) 未打开空态下就绪门放宽的用法与 16 一致。
  若首次跑红，先按这两条排除构造问题，再判产品缺陷。
- **「不落任何兜底目录」的第二面**（`harness/sessions/_orphaned/` 那类保留名目录）不在本场景：
  草稿路径根本没有兜底分支（`harness::draft::draft_path` 对不合格 id 直接返回 None）。
- **无 vault 时输入的内容在之后首次打开 vault 时随输入区清空而丢弃**：这是**既有行为**
  （`vaultChanged` 一直清输入区），本 change 未改；草稿无归属身份可存，故不在本场景的判据里。

## 环境与副作用

- 合成 vault（`/tmp/lumir-m102-acceptance`）+ 隔离 `XDG_CONFIG_HOME`；真实 vault 只读。
- 本场景先把 last_vault 改成一个不存在的目录（写在隔离配置里，不碰真实配置）。
- 1420 全程不碰（端口走 `LUMIR_ACCEPTANCE_PORT`，缺省 1430）。
