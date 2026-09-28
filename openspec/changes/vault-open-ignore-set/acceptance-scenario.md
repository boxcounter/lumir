# 真机验收场景草案（编号 67）

> **这是草案，不是落地的场景**：实现期任务 9.2 把它落成
> `scripts/acceptance/scenarios/67-vault-open-ignore-set.md`，落之前 MUST 跑
> `node scripts/acceptance/run.mjs --check`（静态校验），且 MUST 先核一次编号占用
> （见 `tasks.md` 的「编号声明」）。
> 两处按首轮真机现场补：① `seed.bulkVault` 的两类探针参数（任务 9.1 新增）；
> ② 树行与 vault 列表行的 AX 形态（本草案按 M245 现场记的 `AXButton (名字)`、场景 60 的行选择器写，
> 首轮真机读一次 dump 再定稿）。
> 本草案已按 Alex 节点 1 裁决（2026-09-28）加入**惰性类可见性**判据（第二组）。

```markdown
---
id: "67-vault-open-ignore-set"
item: 67
title: 大 vault 打开：两类忽略（隐藏 / 惰性可见）与打开段不冻结界面
# 界面语言显式钉为 en（本场景有几处 chrome 文案断言：vault 入口按钮与 ⌘O 浮层）。
# 套件默认面是 zh（见套件 README 的「语言面」节）；场景 60 同款处置。
config:
  language: en
seed:
  # 仓库形状：bulkVault 生成真实形状的内容（2142 文件 / 426 目录 / 1341 md）。
  # 两类探针（任务 9.1 新增的参数）：
  #   ignoredDirs —— 隐藏类构建产物族，落在 vault **根**下（树默认收起，探针必须落在根级才断得到）
  #   lazyDirs    —— 惰性类：写一份 .gitignore 声明 .local/、一份 .git/info/exclude 声明 .excluded-dir/，
  #                  并在这两个目录里各生成一个 md（`.local/tutorial.md` 内容含 marker「本地教程正文」），
  #                  生成器要为它们写死内容（本场景第 3 步按 marker 断言正文就位）
  bulkVault:
    ignoredDirs: { target: 400, dist: 200, test-results: 150 }
    lazyDirs: { gitignore: [".local"], exclude: [".excluded-dir"] }
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
steps:
  # ================= 第一组：两类忽略的可见性 =================
  - name: 起始态：真内容与惰性目录在树里，隐藏类不在
    do: settle
    expect:
      # 正向见证（负向断言要有输入才不是空过；REVIEW.md 第 2 条）
      - label: 真内容的分区目录在树里
        ax: { has: "/AXButton \\(area-00\\)/" }
      - label: 真内容的文件行在树里
        ax: { has: "note-0000.md" }
      # 惰性类：被 .gitignore / info/exclude 挡住，但行必须可见（Alex 裁决 2026-09-28）
      - label: .gitignore 声明的 .local 行在树里
        ax: { has: "/AXButton \\(\\.local\\)/" }
      - label: info/exclude 声明的 .excluded-dir 行在树里
        ax: { has: "/AXButton \\(\\.excluded-dir\\)/" }
      # 隐藏类：三行都不在（本 change 的差异面）
      - label: target 目录不进树
        ax: { not: "/AXButton \\(target\\)/" }
      - label: dist 目录不进树
        ax: { not: "/AXButton \\(dist\\)/" }
      - label: test-results 目录不进树
        ax: { not: "/AXButton \\(test-results\\)/" }
      - shot: 01-起始态

  - name: 展开惰性目录 .local（按需枚举一层）
    do: click
    target: { role: AXButton, name: "^\\.local$" }
    expect:
      - label: 惰性目录展开后，其中的文件出现在树里
        ax: { has: "tutorial.md" }
      - shot: 02-展开-local

  - name: 读惰性目录里的文件（它不在索引里，但打开链路是路径直读）
    do: open
    file: tutorial.md
    marker: "本地教程正文"
    expect:
      - label: 正文就位（能读到，不是空文档）
        editor: { has: "本地教程正文" }
      - shot: 03-读惰性文件

  # ================= 第二组：放大器 + 打开段内界面可响应 =================
  # 放大器：把「切回 A」的打开段撑到秒级（沿用场景 60 的口径：20×8MB 稀疏 md，给一次 AX 快照的
  # 秒级往返留约 3s 余量）。**落点是 vault 根的可见 md**——MUST NOT 放进 .local 等惰性目录
  # （design §9.4：那会把「测量放大器」与「惰性子树」两件事混在一起，判据失去区分度）。
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
      - shot: 04-切到B

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

  # ==== 核心判据：打开段内界面可响应 ====
  # 一次 get_app_state 的往返是秒级（M283 实测采样点约在动作后 4.1s）；放大器把窗口撑到 ~7.5s，
  # 快照因此落在打开段**之内**。三条配成一组的道理：
  #   ① 改动前（同步 command）：主线程被打开段的 body 占住，快照只回 element_count: 1（读不到节点）
  #      ⇒ 三条全 FAIL。
  #   ② 改动后（#[command(async)]）：body 在 async 运行的线程上，主线程可答 AX ⇒ 三条 PASS。
  #   ③ 「此刻还该是 B」是**时间见证**：证明快照取自装载提交**之前**（即打开段之内）。A 的路径不含
  #      `-b`，所以 `-b` 在场即证明切换未提交。
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
      - shot: 05-打开段内

  - name: A 装载完成
    do: settle
    expect:
      - label: 指示已退场
        ax: { not: "AXProgressIndicator" }
      - label: 当前 vault 换成 A
        ax: { has: "Vaults: lumir-m102-acceptance (click to see all vaults)" }
      - label: 真内容仍在树里（装载没把树弄丢）
        ax: { has: "/AXButton \\(area-00\\)/" }
      - label: 惰性目录行仍在树里（可见性不因切换丢失）
        ax: { has: "/AXButton \\(\\.local\\)/" }
      - shot: 06-A-稳定态

  # ================= 第三组：读数通道还活着（不做阈值判定） =================
  - name: 读数：打开段与按需枚举的分段读数在盘上
    expect:
      - label: scan 段读数在盘上（本 change 新增，刻意不设阈值）
        file: { path: "env:logs/*.jsonl", has: '/^.*"event":"slow_callback".*"name":"vault_open_scan".*$/' }
      - label: graph 段读数在盘上（本 change 新增）
        file: { path: "env:logs/*.jsonl", has: '/^.*"event":"slow_callback".*"name":"vault_open_graph".*$/' }
      - label: 前端打开段总时长读数在盘上（放大器把这一段撑到远超 250ms 阈值）
        file: { path: "env:logs/*.jsonl", has: '/^.*"event":"slow_callback".*"name":"vault_load_open".*$/' }
      - label: 隐藏类忽略计数在盘上（本 change 新增的事件名）
        file: { path: "env:logs/*.jsonl", has: '/^.*"event":"vault_scan_ignored".*$/' }
      - shot: 07-读数现场
---

# 场景说明（人读）

本场景验三组判据：

1. **两类忽略的可见性**（Alex 节点 1 裁决的硬性约束）：隐藏类（`target` / `dist` / `test-results`）
   不出现在树里；惰性类（`.gitignore` 声明的 `.local` 与 `info/exclude` 声明的 `.excluded-dir`）
   **行在树里、可展开、可打开读到正文**。这一组必须配正向见证（真内容的行在场），否则负向断言
   可能在「树根本没渲染」的空输入上假绿（REVIEW.md 第 2 条）。
2. **打开段不冻结界面**：切回仓库形状的 A 期间取一次快照，`AXProgressIndicator` 与界面节点都可读，
   且快照的**时间见证**成立（此刻仍显示 B）。改动前这一条是 FAIL（主线程被同步 command 的 body 占住，
   快照只回 `element_count: 1`）——这是 M283 从场景 60 撤下的那条正观测，本 change 把打开段移出
   主线程之后它可以立起来。
3. **读数通道还活着**：`vault_open_scan` / `vault_open_graph`（本 change 新增）、前端
   `vault_load_open`、隐藏类忽略计数 `vault_scan_ignored` 四条都在日志里。

## 覆盖边界（如实记录，别读成「已覆盖」）

- **不判动画帧**：一次 `get_app_state` 的往返是秒级，逐帧判「转圈在动」没有通道；spec 的判据本来就
  是「指示在窗口内**在场**」。
- **耗时不做断言**（机器间抖动，REVIEW.md 第 3 条同族）：读数只断言「在盘上」，数值由实现期截进
  `test-results/` 供人读。
- **20×8MB 是测量放大器**（照抄场景 60 的口径）：它把「切回 A」的打开段撑到秒级，否则打开段在收窄
  之后只剩毫秒级、指示这类瞬时状态落不进快照。**MUST NOT** 拿本场景日志里的 `vault_load_open`
  当规模读数。
- **惰性子树的实时性不在本条覆盖内**：未被展开过的惰性目录内部的变更**不进事件流**（设计如此，
  见 spec 的 watch 口径）；本条只覆盖「可见 + 可展开 + 可读」。物化后的事件投递由单测覆盖
  （tasks 4.1），真机侧不作断言（造「展开后外部改文件」的现场成本高、收益低）。
- **索引降级不在本条覆盖内**：惰性区域的 `[[wikilink]]` 解析为 unresolved 是 spec 写明的已知边界，
  本条不断言它。
- **前端装配段不在本条覆盖内**：打开段结束后的 payload 解析与树/索引装配仍跑在 webview 主线程
  （本 change 的已知边界）；放大器是稀疏大文件、条目数不变，因此**不覆盖**「条目数极大时装配段
  仍有一拍卡顿」。
- **树行与 vault 列表行的 AX 形态**（`AXButton (名字)`）按 M245 的现场写；首轮真机读一次 dump 确认，
  若形态不同按实际改断言（改的是断言形式，不是判据）。
```
