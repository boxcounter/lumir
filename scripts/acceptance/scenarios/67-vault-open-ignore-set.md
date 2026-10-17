---
id: "67-vault-open-ignore-set"
item: 67
title: 大 vault 打开：hidden 档隐藏 / 其余名字惰性可见，且打开段不冻结界面
# 界面语言**显式钉为 en**：本场景的 chrome 断言取文案表的 en 列（树头部的 vault 入口 D96、
# 浮层底部的「新增 vault」入口 D104.2）。套件默认面是 zh（见 README 的「语言面」节），
# 场景 60 同款处置——跟随产品出厂默认会在默认值改判时整批静默变红（M282 的根因）。
config:
  language: en
seed:
  # 复刻真实形状的批量内容 + 两类忽略探针（change vault-open-ignore-set §9.3；
  # change ignore-tiers-config 起改口径）。探针必须落在 vault **根**下：树默认收起，
  # 根级才断得到「这一行在不在」。
  #   ignoredDirs —— 默认 `lazy` 档的构建产物族（根下 target / dist / test-results，各带若干 md）。
  #                  本 change 之后它们**出惰性行**（可见、可展开），不再是「不进树」。
  #   lazyDirs    —— 用户规则：根 `.gitignore` 声明 `.local` 并带一条取反 `!target/`；根
  #                  `.git/info/exclude` 声明 `.excluded-dir`；两者各带一个 tutorial.md。
  #                  取反那条是刻意的：真机上也要有一条「用户规则的取反不能推翻两档」的判据。
  #                  默认 `hidden` 档只剩 `.git` / `.DS_Store`——本 fixture 的 `.git/`
  #                  （`info/exclude` 所在）就是它的探针。
  bulkVault:
    ignoredDirs: { target: 400, dist: 200, test-results: 150 }
    lazyDirs:
      gitignore: [".local"]
      gitignoreNegations: ["target/"]
      exclude: [".excluded-dir"]
  # 两个 vault 都预置成「此前打开过」（真机上第一次把目录加进列表要走系统目录选择器，套件不驱动
  # 原生对话框）——本场景验的是**切换**，不是首次加入。
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
steps:
  # ================= 第一组：两类忽略的可见性 =================
  - name: 起始态：真内容行在树里；两档惰性行在、hidden 档的行不在
    do: settle
    expect:
      # 正向见证先立住：负向断言要有输入才不是空过（REVIEW.md 「读不到当成空」条）——同一步的同一份快照里
      # 既要有真内容的行，负向断言才有区分度。
      - label: 正向见证：真内容的分区目录在树里（这一份 AX 快照读得到节点）
        ax: { has: "/AXButton \\(area-00\\)/" }
      - label: 正向见证：真内容的文件行在树里（fixture 落在 vault 根）
        ax: { has: "/AXButton \\(plain\\.md\\)/" }
      # dump 完整性见证：树是「目录组在前、文件组在后」排的，而 AX 快照要截断只会从**末尾**丢行
      # （M296 实测多一种截断源：`truncated: [closed_menu, fanout_cap]` —— 根节点子行列表超上限
      # 时被从末尾截掉）。只要**任一文件组行**在场，就证明排在它前面的整个目录组都在这一份快照
      # 里。**见证必须取文件组最靠前的行**：字母表靠后的行会被 fanout_cap 截掉（现场：
      # `var-highlight.md` 被截、`block-copy.md` 在）。两条一起给：文件组首行 + 目录组末行。
      - label: 正向见证：文件组的一行在场（⇒ 它前面的整个目录组都在快照里）
        ax: { has: "/AXButton \\(block-copy\\.md\\)/" }
      - label: 正向见证：目录组排到末位（area-23 在 ⇒ 目录组不是被截断的半截）
        ax: { has: "/AXButton \\(area-23\\)/" }
      # 用户规则命中：行必须可见（Alex 2026-09-28 裁决；读屏名是 vault 相对路径）
      - label: 用户规则命中：.gitignore 声明的 .local 行在树里
        ax: { has: "/AXButton \\(\\.local\\)/" }
      - label: 用户规则命中：info/exclude 声明的 .excluded-dir 行在树里
        ax: { has: "/AXButton \\(\\.excluded-dir\\)/" }
      # 默认 lazy 档命中：行必须可见（change ignore-tiers-config 的差异面）。注意 fixture 的
      # `.gitignore` 里有一条 `!target/` —— 它不能把 target 翻成「完全可见」（两档先判且命中即
      # 定格），但 target 本来就在 lazy 档里，行照常出现。
      - label: lazy 档命中：target 出惰性行（.gitignore 里的 !target/ 不影响它的去向）
        ax: { has: "/AXButton \\(target\\)/" }
      - label: lazy 档命中：dist 出惰性行
        ax: { has: "/AXButton \\(dist\\)/" }
      - label: lazy 档命中：test-results 出惰性行
        ax: { has: "/AXButton \\(test-results\\)/" }
      - label: lazy 档命中：node_modules 出惰性行（批量内容里的既有探针，回归见证）
        ax: { has: "/AXButton \\(node_modules\\)/" }
      # hidden 档命中：`.git` 的行不在（本 fixture 的 `.git/` 是 info/exclude 的宿主）。
      # 区分度由上面的文件组见证保证：`.git` 排在目录组最前，若它存在必然落在同一份快照里。
      - label: hidden 档命中：.git 不进树
        ax: { not: "/AXButton \\(\\.git\\)/" }
      - shot: 01-起始态

  # 运行时探针（不靠 fixture 的**事件**路径，区别于第一组的扫描路径）：外部往惰性目录
  # 内部、以及新造一个惰性档目录（`vaultWrite` 会 mkdirp 父目录）。判据分两半：
  #   - 惰性目录**内部**的子孙事件 MUST NOT 进树（未展开 ⇒ 事件被祖先判定挡下），
  #     否则树里会出现一行枚举永远不会产生的幻影行（r2 评审 P1-2）；
  #   - 惰性档目录**自身**的 created SHALL 进树（一行惰性条目）——枚举同样会给出这一行，
  #     两边一致；其子孙同样不补。
  # **负向断言必须配正向见证**：同一步在 vault 根写一个普通文件，它必须出现，证明事件确实
  # 已被处理过（否则「读得太早」会让负向断言假绿，REVIEW.md 「断言等价于子串 / 读不到当成空」条）。
  - name: 外部写入：vault 根下的普通文件（正见证）
    do: vaultWrite
    file: external-probe.md
    content: "外部写入的正见证\n"
    expect:
      - label: 磁盘上有了 external-probe.md
        file: { path: external-probe.md, exists: true }
  - name: 外部写入：target/probe.md（惰性目录内部，未展开）
    do: vaultWrite
    file: target/probe.md
    content: "外部构建产出\n"
  # **这一条才是 r2 评审 P1-2 的直接判据**：`target` 是 fixture 早就造好的惰性目录，往它里面
  # 写只产生「子孙」事件；幻影行的形态是「未展开的惰性目录内部出现一行」。`.venv` 刻意选一个
  # lazy 档里、而本场景的 fixture **没有**造过的名字（`vaultWrite` 会 mkdirp 出它）——它考的是
  # 「外部新建惰性档目录」：目录自身的 created 应当投递一行惰性条目，子孙不补。
  - name: 外部写入：新造一个 fixture 没有的惰性档目录 .venv/probe.md
    do: vaultWrite
    file: .venv/probe.md
    content: "外部虚拟环境产出\n"
  - name: 等一拍再读 AX（写后立刻读会与 DOM 刷新抢）
    do: sleep
    ms: 1200
    expect:
      - label: 正见证：根下的普通文件出现了（事件确实已被处理）
        ax: { has: "/AXButton \\(external-probe\\.md\\)/" }
      - label: 正见证：外部新建的惰性档目录 .venv 出一行（目录自身的 created 投递）
        ax: { has: "/AXButton \\(\\.venv\\)/" }
      - label: 反见证：外部往未展开的 target 里写不产生幻影行
        ax: { not: "/AXButton \\(target/probe\\.md\\)/" }
      - label: 反见证：外部新建的 .venv 不补出子孙行
        ax: { not: "/AXButton \\(\\.venv/probe\\.md\\)/" }
      - shot: 02-外部-target-不出现

  - name: 展开用户规则命中的 .local（按需枚举一层）
    do: click
    target: { role: AXButton, name: "^\\.local$" }
    expect:
      - label: 展开后，其中的文件出现在树里（子行的读屏名是完整相对路径）
        ax: { has: "/AXButton \\(\\.local\\/tutorial\\.md\\)/" }
      - shot: 03-展开-local

  - name: 读用户规则目录里的文件（它不在索引里，打开链路是路径直读）
    do: open
    file: .local/tutorial.md
    marker: 本地教程正文
    expect:
      - label: 正文就位（能读到，不是空文档）
        editor: { has: 本地教程正文 }
      - shot: 04-读惰性文件

  # 惰性档（默认 lazy 的 target）与用户规则同待遇：展开时按需取一层，内容可读。
  # 位置刻意在外部写入之后：展开前 target 未被物化，所以上一步的 progeny 事件被挡下；
  # 展开后取回的这一层来自磁盘（含外部写进去的 probe.md 也照常出现——那是取数，不是事件）。
  - name: 展开 lazy 档命中的 target（按需枚举一层）
    do: click
    target: { role: AXButton, name: "^target$" }
    expect:
      - label: 展开后，target 的第一份产物出现在树里（子行读屏名是完整相对路径）
        ax: { has: "/AXButton \\(target/artifact-0000\\.md\\)/" }
      - shot: 04b-展开-target

  # ================= 第二组：放大器 + 打开段内界面可响应 =================
  # 先切到 B（小 vault），好让**切换目标 A** 处在不被 watch 的集合里：放大器写进 A 时不会产生
  # 增量事件与链接索引 upsert（口径与场景 60 一致——那次放大器也是写进当时非当前的 B）。
  - name: Cmd-o 打开列表
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层打开
        ax: { has: "Choose a folder as a new vault" }
      - label: 另一个 vault（B）的行也在（列表没被裁掉）
        ax: { has: "lumir-m102-acceptance-b" }
  - name: 切到 B（小 vault）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }
    expect:
      - label: 浮层收起
        ax: { not: "Choose a folder as a new vault" }
      - shot: 05-切到B
  - name: B 装载完成
    do: settle
    expect:
      - label: 当前 vault 换成 B
        ax: { has: "Vaults: lumir-m102-acceptance-b (click to see all vaults)" }
      - label: B 没有会话历史 → 空 vault 首入态
        ax: { has: "No files opened in this vault yet" }
      - shot: 06-B-稳定态

  # 放大器：20×8MB 稀疏 md 写进**切换目标 A** 的 vault 根（此刻当前 vault 是 B ⇒ A 不被 watch）。
  # 口径照抄场景 60：一次 `get_app_state` 的往返是秒级（M283 实测采样点约在动作后 4.1s），
  # 放大器把切回 A 的打开段撑到 ~7.5s ⇒ 快照落在打开段**之内**。
  # **MUST NOT** 放进 .local 等惰性目录（design §9.4：那会把「测量放大器」与「惰性子树」两件事
  # 混在一起，判据失去区分度）；也**不是**规模读数——MUST NOT 拿本场景日志里的 vault_load_open
  # 当规模口径（场景 60 已立此惯例，这里照抄）。
  - name: 给 A 塞大文件 01
    do: vaultSparse
    file: big-01.md
    size: 8000000
  - name: 给 A 塞大文件 02
    do: vaultSparse
    file: big-02.md
    size: 8000000
  - name: 给 A 塞大文件 03
    do: vaultSparse
    file: big-03.md
    size: 8000000
  - name: 给 A 塞大文件 04
    do: vaultSparse
    file: big-04.md
    size: 8000000
  - name: 给 A 塞大文件 05
    do: vaultSparse
    file: big-05.md
    size: 8000000
  - name: 给 A 塞大文件 06
    do: vaultSparse
    file: big-06.md
    size: 8000000
  - name: 给 A 塞大文件 07
    do: vaultSparse
    file: big-07.md
    size: 8000000
  - name: 给 A 塞大文件 08
    do: vaultSparse
    file: big-08.md
    size: 8000000
  - name: 给 A 塞大文件 09
    do: vaultSparse
    file: big-09.md
    size: 8000000
  - name: 给 A 塞大文件 10
    do: vaultSparse
    file: big-10.md
    size: 8000000
  - name: 给 A 塞大文件 11
    do: vaultSparse
    file: big-11.md
    size: 8000000
  - name: 给 A 塞大文件 12
    do: vaultSparse
    file: big-12.md
    size: 8000000
  - name: 给 A 塞大文件 13
    do: vaultSparse
    file: big-13.md
    size: 8000000
  - name: 给 A 塞大文件 14
    do: vaultSparse
    file: big-14.md
    size: 8000000
  - name: 给 A 塞大文件 15
    do: vaultSparse
    file: big-15.md
    size: 8000000
  - name: 给 A 塞大文件 16
    do: vaultSparse
    file: big-16.md
    size: 8000000
  - name: 给 A 塞大文件 17
    do: vaultSparse
    file: big-17.md
    size: 8000000
  - name: 给 A 塞大文件 18
    do: vaultSparse
    file: big-18.md
    size: 8000000
  - name: 给 A 塞大文件 19
    do: vaultSparse
    file: big-19.md
    size: 8000000
  - name: 给 A 塞大文件 20
    do: vaultSparse
    file: big-20.md
    size: 8000000
  - name: 放大器就位（20 份都在 A 的 vault 根上——后面的打开段读数靠它们）
    expect:
      - label: 放大器的头一份在盘上
        file: { path: big-01.md, exists: true }
      - label: 放大器的末一份在盘上
        file: { path: big-20.md, exists: true }

  - name: Cmd-o 打开列表（准备切回 A）
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层打开
        ax: { has: "Choose a folder as a new vault" }

  # ==== 核心判据：打开段内界面可响应 ====
  # 三条共用**同一份** AX 快照（execute.mjs 的 `state.ax` 每步缓存一次），配成一组的道理：
  #   ① 改动前（同步 command）：主线程被打开段的 body 占住，快照只回 element_count: 1（读不到
  #      任何节点）⇒ 三条全 FAIL（M252/M283 的现场实测：见 49 与 60 的 ax dump）。
  #   ② 改动后（#[command(async)]）：body 在 async 运行时的 worker 上，主线程可答 AX ⇒ 可读。
  #   ③ 「此刻还该是 B」是**时间见证**：证明快照取自装载提交**之前**（即打开段之内）。
  # 判据是「在场 / 可读」，MUST NOT 被写成「动画帧在推进」（spec 的口径）。
  - name: 点 A 行后立刻取一次快照（打开段内）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance(?!-b)/" }
    expect:
      - label: 装载指示在打开段内可读（界面没被占死）
        ax: { has: "AXProgressIndicator" }
      - label: 界面节点同样可读（主线程在答 AX）
        ax: { has: "/AXButton \\(/" }
      - label: 时间见证：此刻仍是 B 的界面（切换尚未提交 ⇒ 快照取自打开段之内）
        ax: { has: "Vaults: lumir-m102-acceptance-b (click to see all vaults)" }
      - shot: 07-打开段内

  # **等装载完成要用状态驱动，不能用 `settle`**（M296 首跑的现场）：本 change 把打开段移出 IPC
  # 主线程之后，装载期间界面保持响应、AX 快照逐字节不变 ⇒ `settle` 会在装载**途中**返回（首跑
  # 实测：它返回时 AX 里还是 `Vaults: …-b` + 指示在场，本步四条断言因此全判红）。`do: waitFor`
  # 轮询两个**只在切换真正提交后**才成立的观测点：入口按钮换成 A、装载指示退场。
  - name: 等切回 A 的装载与恢复跑完（状态驱动，最多 90s）
    do: waitFor
    waitFor:
      has: ["Vaults: lumir-m102-acceptance (click to see all vaults)"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000

  - name: A 装载完成
    do: settle
    expect:
      - label: 指示已退场
        ax: { not: "AXProgressIndicator" }
      - label: 当前 vault 换成 A
        ax: { has: "Vaults: lumir-m102-acceptance (click to see all vaults)" }
      - label: 真内容仍在树里（装载没把树弄丢）
        ax: { has: "/AXButton \\(area-00\\)/" }
      - label: 快照完整性见证：文件组首行 + 目录组末行（下面的负向断言才有区分度）
        ax: { has: "/AXButton \\(block-copy\\.md\\)/" }
      - label: 目录组排到末位（area-23 在 ⇒ 目录组不是被截断的半截）
        ax: { has: "/AXButton \\(area-23\\)/" }
      - label: 用户规则命中的目录行仍在树里（可见性不因切换丢失）
        ax: { has: "/AXButton \\(\\.local\\)/" }
      - label: 切换后 target 仍是惰性行（lazy 档不因重新装载而松口）
        ax: { has: "/AXButton \\(target\\)/" }
      - shot: 08-A-稳定态

  # ================= 第三组：读数通道还活着（不做阈值判定） =================
  - name: 读数：分段读数与忽略计数都在盘上（耗时由实现期截进 test-results/ 供人读）
    expect:
      - label: scan 段读数在盘上（本 change 新增，刻意不设阈值）
        file: { path: "env:logs/*.jsonl", has: '/^.*"event":"slow_callback".*"name":"vault_open_scan".*$/' }
      - label: graph 段读数在盘上（本 change 新增，刻意不设阈值）
        file: { path: "env:logs/*.jsonl", has: '/^.*"event":"slow_callback".*"name":"vault_open_graph".*$/' }
      - label: 前端打开段总时长读数在盘上（放大器把这一段撑到远超 250ms 阈值）
        file: { path: "env:logs/*.jsonl", has: '/^.*"event":"slow_callback".*"name":"vault_load_open".*$/' }
      - label: hidden 档的忽略计数在盘上（本 change 起只数 hidden 档）
        file: { path: "env:logs/*.jsonl", has: '/^.*"event":"vault_scan_ignored".*$/' }
      - shot: 09-读数现场
---

# 场景 67：忽略分档的可见性 + 打开段不冻结界面

对应 change `openspec/changes/vault-open-ignore-set/`（M290 提案 / M292 实现），口径随
change `ignore-tiers-config` 修订。本场景是它的**验收半边**：把提案里「用户能观察到什么」的
判据落成真机可执行、可复现的断言。

## 这个场景验什么

1. **三档的可见性**：`hidden` 档命中的（默认只有 `.git` —— 本 fixture 的 `.git/` 是
   `info/exclude` 的宿主）不出现在树里；`lazy` 档命中的（默认 `target` / `dist` /
   `test-results` / `node_modules`）**出惰性行、可展开、可打开**——**且 vault 根 `.gitignore`
   里那条 `!target/` 取反不能改变它的去向**（两档先判且命中即定格）；用户规则命中的（根
   `.gitignore` 声明的 `.local`、根 `.git/info/exclude` 声明的 `.excluded-dir`）同待遇。
2. **外部写入的两种形态**：运行时往 `target/probe.md`（未展开的惰性目录里的**子孙**）写一份
   ⇒ MUST NOT 进树（幻影行判据）；同时 `vaultWrite` **新建** `.venv/`（默认 `lazy` 档里、
   fixture 没造过的名字）⇒ 该目录**自身**投递一行惰性条目，子孙不补。同一步写一份可见的
   `external-probe.md` 作正见证，证明事件确实已被处理过。
3. **打开段不冻结界面**：切回仓库形状的 A 期间取一次快照，`AXProgressIndicator` 与界面节点
   都可读，且快照的**时间见证**成立（此刻仍显示 B ⇒ 快照取自装载提交之前）。
4. **读数通道还活着**：`vault_open_scan` / `vault_open_graph`（vault-open-ignore-set 新增）、
   前端 `vault_load_open`、`hidden` 档的忽略计数 `vault_scan_ignored` 四条都在日志里。

## 判据为什么是这几条

| 要判的东西 | 判据 | 为什么是它 |
|---|---|---|
| `hidden` 档命中的条目不可见 | `.git` 那行**不在**同一份 AX 快照里，而同一步有真内容行作正向见证 | 负向断言单独写会在「树根本没渲染」的空输入上假绿（REVIEW.md 「断言等价于子串 / 读不到当成空」条）；判别式写 `AXButton \(名字\)` 而不是裸名字，是因为子行的读屏名是**完整相对路径**，裸名字既会命中别处、也分不出目录行与文件行。**截断面另有一对见证**：树是「目录组在前、文件组在后」，截断只从末尾丢行（`closed_menu` / `fanout_cap` 两种源）⇒ 文件组**首行**在场就证明排它前面的整个目录组都在快照里，而四个负向断言的目标全是目录组的行；再配一条目录组**末行**（`area-23`）证明目录组不是被截的半截。取证时踩过一次：见证原先取文件组里字母表最靠后的 `var-highlight.md`，加了 20 个 `big-*.md` 之后 fanout 上限把它截掉了 |
| 用户规则命中的条目可见 | `.local` / `.excluded-dir` 的**行**在快照里；展开后 `.local/tutorial.md` 的行在；打开后正文出现在编辑器 | 三条覆盖「可见 → 可展开 → 可打开」的完整链路——只判「行在」会漏掉「可见但展不开」（那正是 M258 的形态） |
| 取反不能推翻 `lazy` 档 | `.gitignore` 里写 `!target/` 而 `target` 仍是一行惰性条目 | 这是两档优先级的边界口径；没有它，一个把两份规则编进同一个匹配器的实现也能全绿 |
| 外部写入的两种形态 | 同一份快照里 `external-probe.md` 与 `.venv` 行在、`target/probe.md` 与 `.venv/probe.md` 不在 | 只判「不在」会在「事件还没被处理」的空输入上假绿——两个条件必须同一步同快照；`.venv` 是**新建**的惰性档目录，只有它能判「目录自身的 created 投递、子孙不补」这一形态 |
| 打开段内界面可响应 | `AXProgressIndicator` + 界面节点 + 「此刻仍是 B」三条同快照 | 前两条是「主线程在答 AX」，第三条是**时间见证**（证明快照落于提交之前）；缺第三条时「装载早就完成了、所以节点可读」也能过 |

## 覆盖边界（如实登记，别读成「已覆盖」）

- **不判动画帧**：一次 `get_app_state` 的往返是秒级，逐帧判「转圈在动」没有通道；spec 的判据
  本来就是「指示在窗口内**在场**」。
- **耗时不做断言**（机器间抖动，REVIEW.md 「容差吞掉真实变化」条同族）：读数只断言「在盘上」，数值由实现期截进
  `test-results/` 供人读。
- **20×8MB 是测量放大器**：它把「切回 A」的打开段撑到秒级，否则打开段收窄之后只剩毫秒级、
  指示这类瞬时状态落不进快照。**MUST NOT** 拿本场景日志里的 `vault_load_open` 当规模读数。
  放大器落在 **A 的 vault 根**（可见 md），不在 `.local` 之下（design §9.4）。
- **用户规则命中的子树，其实时性不在本条覆盖内**：未被展开过的惰性目录内部的变更**不进事件流**
  （设计如此）；物化后的事件投递由 Rust 单测覆盖，真机侧不构造「展开后外部改文件」的现场。
- **索引降级不在本条覆盖内**：用户规则命中的区域里的 `[[wikilink]]` 解析为 unresolved 是 spec
  写明的已知边界（`build_graph` 按同一份规则表跳过它们），本条不断言它。
- **前端装配段不在本条覆盖内**：打开段结束后的 payload 解析与树 / 索引装配仍跑在 webview 主线程
  （本 change 的已知边界）；放大器是稀疏大文件、条目数不变，因此**不覆盖**「条目数极大时装配段
  仍有一拍卡顿」。
- **配置项 `vault.rule_files` / `vault.hidden` / `vault.lazy` 的真机语义不在本条覆盖内**：本场景走**默认**值
  （`[".gitignore", ".git/info/exclude"]`）；套件的 `config:` 白名单不为它新增键，配置项语义
  （空列表 / 不存在跳过 / 非法项忽略 / 生效时点）由 `src-tauri` 的单测覆盖（tasks 2.5）。
- **本场景往验收 vault 的根写一份 `.gitignore`（用户规则探针）**：`.git` 与 `.local` /
  `.excluded-dir` 都是目录，会被下一次 `resetVault` 连根清掉；`.gitignore` 是文件，不受那次清理
  覆盖，会留到后面的场景（与既有场景 46 留下的那份同类，且残留内容是惰性的——它声明的目录届时
  都不存在）。这条残留已记进 `docs/backlog.md`（验收 vault 根的非 md 残留没被清理）。
- **不进 CI（v0）**：真机套件的既有口径。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance`（A=仓库形状）与 `/tmp/lumir-m102-acceptance-b`（B）
  + 隔离 `XDG_CONFIG_HOME`；端口 1430。
- 本场景在合成 vault 里真写入：两份规则文件（`.gitignore` / `.git/info/exclude`）、两个惰性目录
  及其 `tutorial.md`、三份构建产物探针目录及其 md、20 份 8MB 稀疏 md、`external-probe.md`、
  `target/probe.md` 与 `.venv/probe.md`。用户真实 vault（真实路径按信息卫生纪律不落库）全程只读，
  `~/.config/lumir` 全程不读不写。
