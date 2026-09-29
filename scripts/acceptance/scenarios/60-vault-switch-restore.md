---
id: "60-vault-switch-restore"
item: 60
title: vault 切换的写盘段反馈与「标签栏当帧齐、正文按需装载」
# 界面语言**显式钉为 en**（本场景的断言里有几处是 chrome 文案：树头部、守卫浮条、dirty 标记、
# 空 vault 引导，都取文案表的 en 列）。**套件默认面是 `zh`**（run.mjs 的 `SUITE_LANGUAGE`，理由与
# 两侧覆盖边界见套件 README 的「语言面」节）：存量场景的 chrome 断言全取 zh 列，只有本场景断言
# en 列，因此在身上钉住。M282 把产品出厂默认裁成 en 时，跟随默认值的那些场景整批静默变红
# （M284 修的正是这个根因）。
config:
  language: en
seed:
  # 复刻真实形状的批量内容（M283 的 1.3）：2142 文件 / 426 目录 / 1341 md / ≈7MB、行长正常、
  # 含一个 node_modules 用于验证忽略生效。**用它而不是 M252 的稀疏单行放大器**——M265 §三
  # 已证 48ms/MB 是测量假象，本场景的读数要与 M154 的 scan 14.0ms / build_graph 111.2ms
  # 并列可比。生成物在 /tmp（套件按场景重置），不进仓库。
  bulkVault: {}
  registry:
    - { id: acc-a, path: $vault, lastOpenedAt: 1757000002000 }
    # 第二 vault 的惯用记号 `$vault2`（由 app.mjs 的 resolveSeedPath 解析成 secondVaultDir()）。
    - { id: acc-b, path: $vault2, lastOpenedAt: 1757000001000 }
  # A 的会话 = 40 个 fixture 标签。**为什么是 40**：本 change 的卖点就是恢复段的等待与标签数
  # 脱钩，读数要与 M252 的「46 个标签 992–1359ms（≈21–30ms/标签）」并列可比；40 个标签在改动前
  # 意味着约 1s 的恢复段（>250ms 阈值 ⇒ 旧口径也会记进日志），改动后才量得出「脱钩」。
  sessions:
    acc-a:
      tabs: [callout.md, end-marker-long.md, end-marker-short.md, headings-ramp.md, identity.md, image-fallback.md, keys.md, lightbox.md, links-anchor.md, links-asset.md, links-blocked.md, links-missing.md, links-missing-relative.md, links-relative.md, links-wiki.md, links.md, list-filter.md, list-indent-bullet.md, list-indent-nested.md, list-indent-ordered.md, list-indent-paragraph.md, list-indent-quote.md, math.md, mermaid.md, note.md, plain.md, render-markdown.md, render-table-degrade.md, search-probe.md, svg-scroll.md, table-fullscreen.md, table.md, tabs-a.md, tabs-b.md, tabs-long.md, theme-mermaid.md, toc-frontmatter.md, toc-long.md, toc-outline.md, toc-plain.md]
      active: plain.md
steps:
  - name: 起始态：A 已装载、会话里的 40 个标签都在（真实形状的 vault 上）
    do: settle
    expect:
      - label: 当前 vault 是 A
        ax: { has: "Vaults: lumir-m102-acceptance (click to see all vaults)" }
      - label: 会话里的 40 个标签都在
        ax: { count: { pattern: "Close ", exact: 40 } }
      - label: 激活项是存储里的那一个（plain.md）
        ax: { has: "/AXRadioButton \\(plain\\.md\\) Value: true/" }
      - label: 它的正文已就位（不是空文档）
        editor: { has: "纯文本基线" }
      - shot: 01-起始态

  - name: 制造 dirty（写盘段反馈的前置状态）
    do: type
    text: "M283 写盘段"
    expect:
      - label: 编辑器里有了刚输入的内容
        editor: { has: "M283 写盘段" }
      - label: 未保存标记上屏
        ax: { has: "(unsaved)" }

  # 给**切换目标** B 塞 20 个 8MB 稀疏文件：套件单次 AX 快照的往返延迟是秒级（49 的实测；
  # M283 实测采样点在点击后约 4.1s），「选定出口后指示在场」这类瞬时判据要落在快照里，装载窗口
  # 必须显著长于那次延迟（20×8MB ≈ 7.5s，留约 3s 余量；12 个曾因只留 0.4s 而假红）。放大器落在
  # **目标一侧**（不是给 A 的会话塞大文件）：它只把 B 的 `vault_load_open` 撑到秒级中段，
  # A 的标签栏 / 按需装载判据一律不经过它——本场景的**读数**因此仍取切回 A 那一次
  #（A 上没有放大器，是真实形状的 7MB）。测量放大器，不是产品场景（49 已立此惯例）。
  - name: 给 B 塞大文件 01（撑开「切到 B」的装载窗口）
    do: vaultSparse
    vault: second
    file: big-01.md
    size: 8000000
  - name: 给 B 塞大文件 02
    do: vaultSparse
    vault: second
    file: big-02.md
    size: 8000000
  - name: 给 B 塞大文件 03
    do: vaultSparse
    vault: second
    file: big-03.md
    size: 8000000
  - name: 给 B 塞大文件 04
    do: vaultSparse
    vault: second
    file: big-04.md
    size: 8000000
  - name: 给 B 塞大文件 05
    do: vaultSparse
    vault: second
    file: big-05.md
    size: 8000000
  - name: 给 B 塞大文件 06
    do: vaultSparse
    vault: second
    file: big-06.md
    size: 8000000
  - name: 给 B 塞大文件 07
    do: vaultSparse
    vault: second
    file: big-07.md
    size: 8000000
  - name: 给 B 塞大文件 08
    do: vaultSparse
    vault: second
    file: big-08.md
    size: 8000000
  - name: 给 B 塞大文件 09
    do: vaultSparse
    vault: second
    file: big-09.md
    size: 8000000
  - name: 给 B 塞大文件 10
    do: vaultSparse
    vault: second
    file: big-10.md
    size: 8000000
  - name: 给 B 塞大文件 11
    do: vaultSparse
    vault: second
    file: big-11.md
    size: 8000000
  - name: 给 B 塞大文件 12
    do: vaultSparse
    vault: second
    file: big-12.md
    size: 8000000

  - name: 给 B 塞大文件 13
    do: vaultSparse
    vault: second
    file: big-13.md
    size: 8000000
  - name: 给 B 塞大文件 14
    do: vaultSparse
    vault: second
    file: big-14.md
    size: 8000000
  - name: 给 B 塞大文件 15
    do: vaultSparse
    vault: second
    file: big-15.md
    size: 8000000
  - name: 给 B 塞大文件 16
    do: vaultSparse
    vault: second
    file: big-16.md
    size: 8000000
  - name: 给 B 塞大文件 17
    do: vaultSparse
    vault: second
    file: big-17.md
    size: 8000000
  - name: 给 B 塞大文件 18
    do: vaultSparse
    vault: second
    file: big-18.md
    size: 8000000
  - name: 给 B 塞大文件 19
    do: vaultSparse
    vault: second
    file: big-19.md
    size: 8000000
  - name: 给 B 塞大文件 20
    do: vaultSparse
    vault: second
    file: big-20.md
    size: 8000000
  - name: Cmd-o 打开列表
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层打开
        ax: { has: "Choose a folder as a new vault" }
      - label: A 的行带标签数摘要（数字来自会话落盘，不是前端镜像）
        ax: { has: "/lumir-m102-acceptance.*[0-9]+ tabs/" }

  - name: 点 B 行 → dirty 守卫拦下（此刻 MUST NOT 有指示）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }
    expect:
      - label: 守卫浮条给出三条出口
        ax: { has: "Save and switch" }
      - label: 此刻 MUST NOT 有装载指示（还没开始干活）
        ax: { not: "AXProgressIndicator" }
      - shot: 02-守卫浮条

  # 为什么**没有**「选定出口后指示在场」的断言（M283 实测结论，任务 2.3 的判据改由探针承担）：
  # 套件的 AX 读取要主线程空闲才读得到节点——打开段（`vault_open_path`）与写盘段
  # （`document_save`）都是**同步 command**（主线程内联执行），实测阻塞期间 `get_app_state`
  # 只回 `element_count: 1`（读不到任何节点；按 REVIEW.md 第 2 条这**不算**「指示不在场」，
  # 不可读与为空不是一回事）；而本 change 之后恢复段只剩毫秒级 ⇒ 指示的窗口在本场景里没有
  # **可读**部分。正观测与区分度因此落在探针上（`test-results/m283/probe-indicator-window/`：
  # 用定时器把写盘段拉长 ⇒ 主线程空闲、可读；同一条断言在「指示起点回退到装载壳」的注入版下
  # 必须 FAIL——先红后绿，REVIEW.md 第 1 条）。
  - name: 选「保存并切换」
    do: click
    target: { role: AXButton, name: "^Save and switch$" }
    expect:
      - shot: 03-出口后立即

  # **等装载完成要用状态驱动，不能用 `settle`**（M296 首跑的现场）：本 change 把打开段移出 IPC
  # 主线程之后，装载期间界面保持响应、AX 快照逐字节不变 ⇒ `settle` 会在装载**途中**返回 ——
  # 首跑实测：它返回时 AX 里还是 A 的 40 个标签 + 指示在场，本步三条断言因此判红，后面的
  # 「按需装载」两步也跟着超时（当时的场景以为已经切到 B）。这里轮询两个**只在提交后才成立**的
  # 观测点：入口按钮换成 B、装载指示退场。B 的装载窗口是放大器撑出来的（本批实测
  # `vault_load_open` = 8,076ms），故超时给到 90s。
  - name: 等切到 B 的装载跑完（状态驱动，最多 90s）
    do: waitFor
    waitFor:
      has: ["Vaults: lumir-m102-acceptance-b (click to see all vaults)"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000

  - name: B 装载完成
    do: settle
    expect:
      - label: 指示已退场
        ax: { not: "AXProgressIndicator" }
      - label: 当前 vault 换成 B
        ax: { has: "Vaults: lumir-m102-acceptance-b (click to see all vaults)" }
      - label: B 没有会话历史 → 空 vault 首入态
        ax: { has: "No files opened in this vault yet" }
      - shot: 04-B-稳定态

  - name: Cmd-o 打开列表（准备切回 A）
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层打开
        ax: { has: "Choose a folder as a new vault" }
      - label: A 的会话摘要仍是 40 个标签（切换没截断会话文件）
        ax: { has: "/lumir-m102-acceptance.*[0-9]+ tabs/" }

  - name: 点 A 行（切换的第二次：这一次的目标是真实形状的 A）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance.*[0-9]+ tabs/" }
    expect:
      - label: 浮层收起
        ax: { not: "Choose a folder as a new vault" }

  # 同一个状态驱动的等待（理由见上面那次）：这一次的目标 vault 是 A（真实形状 + 40 个标签的
  # 会话恢复），因此两个观测点之外再等「恢复出来的 40 个标签都在」——那是本步首要断言的前置。
  - name: 等切回 A 的装载与 40 个标签的恢复跑完（状态驱动，最多 90s）
    do: waitFor
    waitFor:
      has: ["Vaults: lumir-m102-acceptance (click to see all vaults)"]
      not: ["AXProgressIndicator"]
    timeoutMs: 90000

  - name: 切回 A 完成：标签栏完整、激活项正确
    do: settle
    expect:
      - label: 标签栏完整（40 个）
        ax: { count: { pattern: "Close ", exact: 40 } }
      - label: 激活项回到存储里的那一个
        ax: { has: "/AXRadioButton \\(plain\\.md\\) Value: true/" }
      - label: 激活项的正文已就位
        editor: { has: "纯文本基线" }
      - label: 指示已退场
        ax: { not: "AXProgressIndicator" }
      - shot: 05-切回A

  - name: 按需装载（标签栏路径）：点一个非激活标签，它的正文应当出现
    do: click
    target: { role: AXRadioButton, name: "^tabs-a\\.md$" }
    expect:
      - label: 它成为前台
        ax: { has: "/AXRadioButton \\(tabs-a\\.md\\) Value: true/" }
      - label: 它的正文被装载了（不是空文档）
        editor: { has: "标签场景 A" }
      - label: 标签数不变（装载不新开标签）
        ax: { count: { pattern: "Close ", exact: 40 } }
      - shot: 06-按需装载-标签路径

  - name: 按需装载（树路径）：树里点一个已在会话里的文件，同一次打开链路
    do: open
    file: table.md
    marker: "短表"
    expect:
      - label: 该文件成为前台且正文已装载
        editor: { has: "短表" }
      - label: 标签数不变（它早已在会话里 ⇒ 不新开标签）
        ax: { count: { pattern: "Close ", exact: 40 } }
      - shot: 07-按需装载-树路径

  - name: 会话快照未被截断（纯惰性案的致命症状：标签被写成 1 条）
    do: sleep
    ms: 1500
    expect:
      - label: A 的会话文件仍在（防抖窗口 1s 之后已落盘）
        file: { path: "env:vault-sessions/acc-a.json", exists: true }
      - label: 首位标签在（列表头没被截掉）
        file: { path: "env:vault-sessions/acc-a.json", has: "callout.md" }
      - label: 末位标签在（列表尾没被截掉）
        file: { path: "env:vault-sessions/acc-a.json", has: "toc-plain.md" }
      - shot: 08-会话快照

  - name: 读数：日志里能读到本次切换的分段读数（不做阈值判定，由人读）
    expect:
      - label: watch 建流读数在盘上（本 change 新增，刻意不设阈值）
        file: { path: "env:logs/*.jsonl", has: '/^.*"event":"slow_callback".*"name":"vault_open_watch".*$/' }
      - label: 恢复段读数在盘上（本 change 新增，刻意不设阈值——阈值会把「变快了」写成「没有这一行」）
        file: { path: "env:logs/*.jsonl", has: '/^.*"event":"slow_callback".*"name":"vault_load_restore".*$/' }
      - shot: 09-读数现场
---

# 场景说明（人读）

本场景验三件事，都是「用户能观察到什么」：

1. **写盘段的前置状态与三出口**：A 里有个脏标签 → 点 B → 守卫浮条给出三条出口（此刻
   MUST NOT 有指示，负向配对）。**「选定出口后指示在场」这条正观测不在本场景里**——见上面那段
   注释与「覆盖边界」：同步 command 阻塞期间 AX 读不到节点，本 change 之后恢复段又只剩毫秒级，
   指示的窗口没有可读部分；它由探针（`test-results/m283/probe-indicator-window/`，先红后绿）
   与门层的单测（`tests/unit/vault-switcher.test.ts` 的「指示窗口」组：`begin` 早于 `saveAll`、
   `end` 紧随其后）分别承担真机与逻辑两侧。
2. **标签栏当面**：切回 A 之后标签栏是完整的 40 个（不是逐个长出来），激活项与存储一致，
   且激活项的正文已就位。
3. **按需装载的正面证据**（两条触发路径各一条）：点一个非激活标签、以及从树里点一个已在会话
   里的文件，正文都出现（按需实现若把「激活时装载」做丢，这两步会红：打开的是空文档），
   且**不新开标签**（它们各有自己的标签）。

## 覆盖边界（如实记录，别读成「已覆盖」）

- **「指示在场」这条正观测不属于本场景（M283 实测结论，比草案的预期更硬）**：草案说「快照延迟
  秒级，分辨不了指示起于写盘前」。实测更进一步——**套件读不到**：`get_app_state` 需要主线程
  空闲，而打开段（`vault_open_path`）与写盘段（`document_save`）都是同步 command、跑在主线程，
  阻塞期间 AX 只回 `element_count: 1`（2026-09-28 首轮实测，见
  `test-results/m283/probe-indicator-window/`）；本 change 又把恢复段压到毫秒级 ⇒ 指示的窗口
  在真机上没有可读部分。**所以本场景不写这条断言**（写了会是一条恒假红），它改由探针承担：
  同一场景的临时版本 + 把写盘段用定时器拉长 ⇒ 主线程空闲、可读 ⇒ 有修复时 PASS、把指示起点
  回退到装载壳时 FAIL（先红后绿，两次现场都留档）。**逻辑层**另有一对判据
  （`tests/unit/vault-switcher.test.ts` 的「指示窗口」组）。
  **MUST NOT** 把「AX 读不到」写成「指示不在场」——那是 REVIEW.md 第 2 条。
- **「标签栏当帧齐」同样分辨不了**：eager（今天）与 shell + 按需的差别落在装载窗口内的几百毫秒
  （读数为证），快照延迟秒级 ⇒ 两者的终态断言相同。本条判据的强度靠**读数**
  （`vault_load_restore` 的真机数字，改动前后各一次）与代码结构，不靠本场景。本场景在这里提供
  的是**回归保护**（别把标签栏弄丢、别把会话文件截断）与**按需路径的两个正面证据**。
- **给 B 塞 20 个 8MB 稀疏文件是测量放大器**（第 3–22 步）：它把「切到 B」的 `vault_load_open`
  撑到 7.5s 量级，否则指示这类瞬时状态根本落不进 AX 快照。**为什么是 20 而不是场景 49 的 12**：
  M283 实测采样点在点击后约 **4.1s**（一次 `get_app_state` 的往返），而 12×8MB 的窗口是 4.5s
  （`vault_load_open` = 4498ms）——只留 0.4s 余量，首轮真机就丢过一次（判据假红）。20×8MB 给
  采样留约 3s 余量。它**只**服务于
  「指示在场 / 不在场」这条是非判据，**不是**任何耗时口径；本场景的读数取切回 A 的那一次
  （A 上没有放大器，是 bulkVault 生成的真实形状 7MB）。**MUST NOT** 拿本场景日志里的
  `vault_load_open`（切到 B 那一次）当规模读数——那是放大器读数。
- **耗时不做断言**（机器间抖动，REVIEW.md 第 3 条同族问题）：三段读数走 `env:logs/*.jsonl` 的
  `vault_load_*` / `vault_open_watch`，实现期把读数截进 `test-results/m283/` 供人读，不做阈值判定。
  末步只断言「这两条读数在盘上」——它管的是**读数通道还活着**（本 change 新增的两条埋点不至于
  被静默摘掉），不是耗时。
- **`vault_load_open` / `vault_load_tree` 在本场景的日志里可能缺席**：两者沿用 M252 的 250ms 阈值，
  而真实形状 vault 上 open ≈92–107ms（release 直测两次：scan 10.6/13.0ms + build_graph 81.5/94.4ms，harness 见
  `src-tauri/tests/vault_open_readings.rs`）⇒ 低于阈值就不记。这是 M252 的既定口径，本 change 不动；
  想要那两段的数就用那个 harness。恢复段刻意改成**无条件记录**（本 change 动的是它，阈值会把
  「变快了」写成「没有这一行」）。
- **阅读位置没有判据**：按需装载下「各标签回到各自上次的位置」由同一条 `openFile` 链路承担
  （`readingPositions.restoreFor`），可观察结果不变、时间点后移；本场景不逐标签断言滚动位置
  （滚动断言在本套件里没有通道，见 49 的同类记录）。
- **未装载标签的外部变更检测时点后移**（design §3.4 风险 1）：本场景不断言它（要造「文件在磁盘上
  被外部改写、而该标签尚未装载」的现场，随后首次装载取到的是改写后的内容——属行为变化，
  记在 change 的 spec delta 边界里）。
