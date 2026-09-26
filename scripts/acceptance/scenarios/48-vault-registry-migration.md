---
id: "48-vault-registry-migration"
item: 48
title: 注册表目录更名迁移——预置旧目录 workspaces/ 与注册项，启动后整个目录被原子搬进 vault-registry/、身份不丢、vault 照常恢复打开、迁移记一条诊断事件
fixtures: [plain.md]
seed:
  legacyRegistry:
    - { id: "legacy-vault", path: "$vault" }
steps:
  - name: 启动就绪：恢复打开的是合成 vault（迁移后的注册项按路径命中同一身份）
    do: settle
    expect:
      - label: 树里有 fixture 行（这次 AX 读取是活的——后面的负向断言才有区分度）
        ax: { has: "plain.md" }
      - shot: 启动后的界面

  - name: 等迁移落定（迁移本身在 setup 内同步跑完，注册项的 last_opened_at 随恢复提交写入）
    do: sleep
    ms: 1500
    expect:
      - label: 注册项出现在新名目录（vault-registry/）下——整目录搬过来的
        file: { path: env:vault-registry/legacy-vault.json, exists: true }
      - label: 旧名目录（workspaces/）已被搬走（MUST NOT 新旧并存）
        file: { path: env:workspaces, exists: false }
      - label: 注册项记的仍是这个 vault 的路径（搬的是整目录，逐项不变形）
        file: { path: env:vault-registry/legacy-vault.json, has: "lumir-m102-acceptance" }
      - label: app 真的用了这条注册项（恢复打开成功后刷了 last_opened_at；路径没命中就会另起一个 id，这条文件根本不会存在）
        file: { path: env:vault-registry/legacy-vault.json, has: "last_opened_at" }

  - name: 身份不丢：注册项恰好一条，旧名目录下一条都不剩
    expect:
      - label: 新名目录下恰好一个注册项文件（没有因「按路径找不到」另生成一个 id）
        glob: { dir: env:vault-registry, pattern: "\\.json$", exact: 1 }
      - label: 旧名目录下没有任何注册项文件残留
        glob: { dir: env:workspaces, pattern: "\\.json$", exact: 0 }

  - name: 迁移记了一条诊断事件（log_event 通道）
    expect:
      - label: 当日日志里有 vault_registry_migrated 事件
        file: { path: env:logs/*.jsonl, has: "\"event\":\"vault_registry_migrated\"" }
      - label: 终局是 migrated（不是 skipped_target_exists / failed）
        file: { path: env:logs/*.jsonl, has: "\"outcome\":\"migrated\"" }

  - name: vault 照常打开：点开 fixture 文件，正文上屏
    do: open
    file: plain.md
    marker: "第一行内容"
    expect:
      - label: 正文渲染出来（vault 装载链路零影响）
        editor: { has: "第一行内容" }
      - shot: 打开文件

  - name: 列表浮层里这一行在多（注册项经 vault_list 可读）
    do: click
    target: { any: "点击查看全部 vault" }
    expect:
      - label: 浮层打开（新增入口在场 = 正向锚点）
        ax: { has: "选择一个目录作为新 vault" }
      - label: 列表里有当前 vault 的一行（行名 = vault 名 + 「当前」标——这一组合只有列表行会渲染）
        ax: { has: "/lumir-m102-acceptance 当前/" }
      - shot: 切换器里的这一行

teardown:
  - label: 收尾：注册项仍在新名目录 vault-registry/ 下
    file: { path: env:vault-registry/legacy-vault.json, exists: true }
  - label: 收尾：旧名目录 workspaces/ 始终没有回来
    file: { path: env:workspaces, exists: false }
---

# 注册表目录更名迁移（M248，backlog #37）

## 这个场景验什么

`<config>/lumir/workspaces/` 更名为 `vault-registry/`（与 `vault-sessions/` 对仗：同一 vault 实体的
两个面）。存量机器上的注册项在那次更名之前就躺在旧名目录里，因此启动路径上要有一次**一次性
迁移**：`fs::rename` 整个目录（同目录同文件系统，原子；新目录已存在则不动作），并记一条诊断事件。

本场景在**隔离配置目录**里先构造「更名落地之前那台机器」的现场（旧名目录 + 一条注册项），
再启动真实 app，逐条验：

1. **迁移真的发生**：旧名目录消失、注册项出现在新名目录下，内容（id / path）不变形。
2. **身份不丢**：新名目录下**恰好一条**注册项——若 app 因为「按路径找不到」另起了一个自动 id，
   这里会是两条，且 `legacy-vault.json` 根本不会存在。
3. **这条注册项被真的用了**：启动恢复按路径命中它（不是新建一条），恢复打开成功后写入
   `last_opened_at`；这一条是「注册表可读、身份复用」最直接的读数。
4. **vault 照常打开**：装载后能打开文件、正文上屏；列表浮层里这一行在（`vault_list` 的 UI 出口）。
5. **迁移记了一条诊断事件**：当日日志里有 `vault_registry_migrated`，且终局是 `migrated`。

## 判据走哪几条通道（可读性如实登记）

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 迁移结果（目录搬家） | **磁盘事实**（`file.exists` / `glob`，路径走 `env:` 前缀） | 套件没有 IPC 读数通道，也不好驱动原生目录选择器；隔离配置目录就在盘上，是名实相符的最终判据 |
| 注册项没丢 / 没被顶掉 | **`glob` 计数（exact）+ 文件内容** | 「恰好一条」是这里唯一有区分度的判据：少一条 = 搬丢，多一条 = app 另起了 id |
| app 真的用了这条注册项 | **`last_opened_at` 出现在**该注册项文件里 | 只有「按路径命中既有注册项」的成功打开路径会刷这个字段（`mark_opened`）；新注册的项不会带它 |
| 迁移的日志记录 | **`env:logs/*.jsonl` 的内容断言** | 日志文件按 UTC 日期命名，用 `*` 取最新一份（写死日期会跨天读到上一轮的旧文件，假绿） |
| 注册表可读的 UI 出口 | **AX 文本**（列表行读数名的「vault 名 + 当前」组合） | 树头部也有 vault 名（`vault：<名>（点击查看全部 vault）`），单拿名字做判据会退化成恒真；「当前」标只出现在列表行。**不**用行摘要串做判据：摘要随会话里的标签数变化（首轮实测该行读的是「还没有打开过文件」，因为浮层取 `vault_list` 时会话尚未写入） |
| 迁移**失败**态 / 两种不动作态 | **不在这里**（单测覆盖） | 见下「已知边界」 |

## 已知边界（如实登记，不读成「全量已验」）

- **四态里只有「旧目录在、新目录不在」能在真机复现**：另三态（新目录已存在 → 不动作、两个都不在
  → 不动作、rename 失败）无法在真机上稳定构造——app 是注册表的唯一写者，而且它每次启动都会先
  做这次迁移。这三态 + 元数据不变由 `src-tauri/src/vault_registry.rs` 的四条单测覆盖
  （`legacy_registry_dir_migrates_and_leaves_no_old_dir` / `migration_is_skipped_when_target_dir_exists`
  / `migration_is_noop_without_legacy_dir` / `migrated_registry_entries_stay_readable`）。
- **未验**：跨设备（`EXDEV`）rename 失败后的降级——需要把配置目录挂到另一个文件系统上，超出本套
  件的环境控制范围。
- **未验**：迁移的耗时与启动时序（迁移在 `setup` 内同步完成，理论上会推迟首帧）。它只做一次
  `rename`，量级是微秒；性能合同另有批次，这里不测。
- **不做手感判定**：列表行的观感（间距 / 高亮）归 Alex；本场景只留截图。
- **不新增像素基线**：`shot` 是给人看的证据。视觉层的目录名同步在
  `tests/visual/isolation.test.mjs` + `scripts/visual/snapshot-isolated.mjs`（两处同改，走快照读盘）。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`（`test-results/acceptance/` 下）；
  端口 1430。**用户的 `~/.config/lumir` 全程不读不写**——Alex 机器上的那次迁移随下一次自然启动
  发生，不由本场景触发。
- `seed.legacyRegistry` 是本 mission 给套件加的预置通道（M248）：它把注册项写进**旧名**目录
  `workspaces/`，供本场景构造「更名之前」的现场。`resetRegistry()` 现在**新旧两名目录一起清**，
  否则本场景预置的旧目录会残留到下一个场景、并在那次启动里被迁进新名。
- 本场景只改隔离配置目录：预置的旧目录会被 app 搬走（这正是被验的行为），没有别的写入。
