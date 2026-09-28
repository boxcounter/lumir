# 真机验收场景草案（编号 67）

> **这是草案，不是落地的场景**：实现期任务 4.2 把它落成
> `scripts/acceptance/scenarios/67-vault-open-ignore-set.md`，落之前 MUST 跑
> `node scripts/acceptance/run.mjs --check`（静态校验），且 MUST 先核一次编号占用
> （见 `tasks.md` 的「编号声明」）。
> 两处按首轮真机现场补：① `seed.bulkVault` 的构建产物探针参数（任务 4.1 新增）；
> ② 树行与 vault 列表行的 AX 形态（本草案按 M245 现场记的 `AXButton (名字)`、场景 60 的行选择器写，
> 首轮真机读一次 dump 再定稿）。

```markdown
---
id: "67-vault-open-ignore-set"
item: 67
title: 大 vault 打开：忽略集剪枝与打开段不冻结界面
seed:
  # 仓库形状：bulkVault 生成真实形状的内容（2142 文件 / 426 目录 / 1341 md），
  # ignoredDirs 是任务 4.1 新增的参数：在 vault **根**下生成构建产物族目录（各带若干 md），
  # 形状对标 M289 盘点的真 vault（根 target 19,154 文件 / test-results 9,660 文件）。
  # 探针必须落在**根级**：树默认收起，落在深层目录里的探针断不到（REVIEW.md 第 1 条 —— 判据要有区分度）。
  bulkVault:
    ignoredDirs: { target: 400, dist: 200, test-results: 150 }
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
steps:
  - name: 起始态：A 已装载，构建产物目录不进树、真内容在树里
    do: settle
    expect:
      # 正向见证（同场必须有它，负向断言才算有输入；REVIEW.md 第 2 条）
      - label: 真内容的分区目录在树里（bulkVault 的根级目录）
        ax: { has: "/AXButton \\(area-00\\)/" }
      - label: 真内容的文件行在树里
        ax: { has: "note-0000.md" }
      # 被忽略的三个根级目录：改动前它们是根级行（必在场），改动后不在
      - label: target 目录不进树
        ax: { not: "/AXButton \\(target\\)/" }
      - label: dist 目录不进树
        ax: { not: "/AXButton \\(dist\\)/" }
      - label: test-results 目录不进树
        ax: { not: "/AXButton \\(test-results\\)/" }
      - shot: 01-起始态

  # 放大器：把「切回 A」的打开段撑到秒级（沿用场景 60 的口径：20×8MB，给一次 AX 快照的
  # 秒级往返留约 3s 余量）。**落在被观察的那一侧**（本场景观察的是「切到 A」）。
  # 它是测量放大器，不是产品场景：MUST NOT 拿本场景日志里的 vault_load_open 当规模读数。
  - name: 给 A 塞大文件 01
    do: vaultSparse
    file: big-01.md
    size: 8000000
  （…… 02–20 同形，共 20 个，直接照抄场景 60 的第 3–22 步 ……）

  - name: Cmd-o 打开列表
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层打开
        ax: { has: "Choose a folder as a new vault" }

  - name: 切到 B（小 vault）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }
    expect:
      - shot: 02-切到B

  - name: B 装载完成
    do: settle
    expect:
      - label: 当前 vault 换成 B
        ax: { has: "Vaults: lumir-m102-acceptance-b (click to see all vaults)" }

  - name: Cmd-o 后再点 A 行（这一次的目标是仓库形状的 A + 放大器）
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层打开
        ax: { has: "Choose a folder as a new vault" }

  # ==== 本场景的核心判据：打开段内界面可响应 ====
  # 一次 get_app_state 的往返是秒级（M283 实测采样点约在动作后 4.1s）；放大器把窗口撑到 ~7.5s，
  # 快照因此落在打开段**之内**。下面三条配成一组的道理：
  #   ① 改动前（同步 command）：主线程被打开段的 body 占住，快照只回 element_count: 1（读不到节点）
  #      ⇒ 三条全 FAIL。
  #   ② 改动后（#[command(async)]）：body 在 async 运行的线程上，主线程可答 AX ⇒ 三条 PASS。
  #   ③ 「此刻还该是 B」这条是**时间见证**：证明快照取自装载提交**之前**（即打开段之内），
  #      否则「指示在场」可能只是拍到了别的时刻。A 的路径不含 `-b`，所以 `-b` 在场即证明切换未提交。
  # 判据是「在场 / 可读」，MUST NOT 被写成「动画帧在推进」（spec 的口径，M252 起）。
  - name: 点 A 行后立刻取一次快照（打开段内）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance(?!-b)/" }
    expect:
      - label: 装载指示在打开段内可读（界面没被占死）
        ax: { has: "AXProgressIndicator" }
      - label: 界面节点同样可读（主线程在答 AX）
        ax: { has: "/AXButton \\(/" }
      - label: 时间见证：此刻仍是 B 的界面（切换尚未提交 ⇒ 快照取自打开段之内）
        ax: { has: "lumir-m102-acceptance-b" }
      - shot: 03-打开段内

  - name: A 装载完成
    do: settle
    expect:
      - label: 指示已退场
        ax: { not: "AXProgressIndicator" }
      - label: 当前 vault 换成 A
        ax: { has: "Vaults: lumir-m102-acceptance (click to see all vaults)" }
      - label: 真内容仍在树里（装载没把树弄丢）
        ax: { has: "/AXButton \\(area-00\\)/" }
      - shot: 04-A-稳定态

  # ==== 读数：分段读数通道还活着（不做阈值判定，机器间抖动，REVIEW.md 第 3 条同族）====
  - name: 读数：打开段的分段读数在盘上
    expect:
      - label: scan 段读数在盘上（本 change 新增，刻意不设阈值）
        file: { path: "env:logs/*.jsonl", has: '/^.*"event":"slow_callback".*"name":"vault_open_scan".*$/' }
      - label: graph 段读数在盘上（本 change 新增）
        file: { path: "env:logs/*.jsonl", has: '/^.*"event":"slow_callback".*"name":"vault_open_graph".*$/' }
      - label: 前端打开段总时长读数在盘上（放大器把这一段撑到远超 250ms 阈值）
        file: { path: "env:logs/*.jsonl", has: '/^.*"event":"slow_callback".*"name":"vault_load_open".*$/' }
      - shot: 05-读数现场
---

# 场景说明（人读）

本场景验三件事：

1. **忽略集剪枝**（仓库形状的 vault）：根级 `target/` / `dist/` / `test-results/`
   三行不进树，真内容（`area-00` 与它的 md）在树里。这一对正负断言必须在**同一快照**里
   （负向断言要有正向见证才不是空过，REVIEW.md 第 2 条）。
2. **打开段不冻结界面**：切到仓库形状的 A 期间取一次快照，`AXProgressIndicator` 与界面节点
   都可读。改动前这一条是 FAIL（主线程被同步 command 的 body 占住，快照只回
   `element_count: 1`），改动后才成立——**这是 M283 从场景 60 撤下的那条正观测**，本 change
   把打开段移出主线程之后它可以立起来。
3. **读数通道还活着**：`vault_open_scan` / `vault_open_graph`（本 change 新增）与前端
   `vault_load_open` 三条都在日志里。

## 覆盖边界（如实记录，别读成「已覆盖」）

- **不判动画帧**：一次 `get_app_state` 的往返是秒级，逐帧判「转圈在动」没有通道；spec 的判据
  本来就是「指示在窗口内**在场**」。本条判的是「打开段内 AX 可读 + 指示在场」。
- **耗时不做断言**（机器间抖动，REVIEW.md 第 3 条同族）：三条读数只断言「在盘上」，数值由实现期
  截进 `test-results/` 供人读。
- **20×8MB 是测量放大器**（照抄场景 60 的口径）：它把「切到 A」的打开段撑到秒级，否则打开段
  在收窄可见集之后只剩毫秒级、指示这类瞬时状态根本落不进快照。**MUST NOT** 拿本场景日志里的
  `vault_load_open`（切到 A 那一次）当规模读数。
- **前端装配段不在本条覆盖内**：打开段结束后的 payload 解析与树/索引装配仍跑在 webview 主线程
  （本 change 的已知边界）；本场景的放大器是稀疏大文件、条目数不变，因此**不覆盖**「条目数极大时
  装配段仍有一拍卡顿」这件事。
- **忽略集的误伤面不在本条覆盖内**：场景只验「被忽略的名字不进树」，不验「用户真的把笔记放在
  `build/` 里时他不会撞上这件事」——后者没有可判定的通道（本 change 只提供诊断日志里的忽略计数）。
- **树行的 AX 形态**（`AXButton (名字)`）按 M245 的现场写；首轮真机读一次 dump 确认，若形态不同
  按实际改断言（改的是断言形式，不是判据）。
```
