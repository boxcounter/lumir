---
id: "12-links"
item: 12
title: 链接渲染与激活（外链 / 相对 md / 资产 / 锚点 / 不可用）
fixtures: [links.md, links-wiki.md, links-missing.md, links-relative.md, links-missing-relative.md, links-anchor.md, links-asset.md, links-blocked.md, notes.txt]
open: links.md
marker: "第一条外链"
steps:
  - name: 渲染态：全形态装饰，URL 与目标源码不显露
    do: settle
    expect:
      - shot: 渲染态
      - label: 外链渲染成 title + ↗︎ 上屏（光标在文档首、不触发源码显露）
        editor: { has: "/第一条外链↗/" }
      - label: 渲染态下 URL 源码不显露
        editor: { not: "example.invalid/alpha" }
      - label: 第二条外链同样渲染（同段落其余文本不受影响）
        editor: { has: "/第二条外链↗/" }
      - label: 相对路径链接装饰为「→」而不是原文（M145 口径）
        editor: { has: "/相对路径→/" }
      - label: 相对路径的目标源码同样不显露
        editor: { not: "note.md" }
      - label: 白名单外 scheme 保持原文
        editor: { has: "[别开我](javascript:alert(1))" }
      - label: 渲染不改写文档（磁盘仍是源文件逐字节内容）
        file: { path: links.md, has: "[第一条外链](https://example.invalid/alpha)" }

  - name: 切到「首行是 wikilink」的文档
    do: open
    file: links-wiki.md
    marker: "plain"
    expect:
      - label: wikilink 文档已装载（渲染成 target 名，源码未显露）
        editor: { has: "plain" }
      - label: wikilink 渲染链路未变（源码方括号不显露）
        editor: { not: "[[plain]]" }

  - name: ⌘⏎ 跳转 wikilink（既有链路）
    do: key
    key: "cmd+return"
    expect:
      - shot: wikilink-跳转后
      - label: 跳到目标文件（plain.md 的内容上屏）
        editor: { has: "纯文本基线" }

  - name: 切到「首行是未创建 wikilink」的文档
    do: open
    file: links-missing.md
    marker: "missing-note"
    expect:
      - label: 未创建链接文档已装载
        editor: { has: "missing-note" }

  - name: ⌘⏎ 跟随未创建的 wikilink
    do: key
    key: "cmd+return"
    expect:
      - shot: 未创建链接提示
      - label: 只给提示（不是错误弹窗）
        ax: { has: "未创建的链接" }
      - label: 不自动创建文件（创建必须是作者在提示里的显式动作）
        file: { path: "missing-note.md", exists: false }
      - label: 没有跳到别处（仍在原文档）
        editor: { has: "占位段落" }

  - name: 相对路径 md：装饰为「→」且目标源码不显露
    do: open
    file: links-relative.md
    marker: "相对路径"
    expect:
      - label: 相对路径链接装饰为应用内标记
        editor: { has: "/相对路径→/" }
      - label: 目标源码不显露
        editor: { not: "note.md" }

  - name: ⌘⏎ 跟随相对路径 md（应用内跳转）
    do: key
    key: "cmd+return"
    expect:
      - shot: 相对链接跳转后
      - label: 跳到目标笔记（note.md 的内容上屏）
        editor: { has: "相对目标内容" }
      - label: 不是「未创建的链接」提示（相对路径链接不继承一键创建）
        # 上一步的未创建 wikilink 提示可能还挂着（带动作的 toast 挂 8s），所以判「没有第二条」
        # 而不是「一条都没有」——跨步骤的残留是正常现象，不是回归（M144 同款口径）。
        ax: { count: { pattern: "未创建的链接", max: 1 } }

  - name: 相对路径 md 的跳转落了内部跳转诊断
    do: sleep
    ms: 800
    expect:
      - label: 应用内跳转记 category=internal-md、outcome=opened
        file: { path: "env:logs/*.jsonl", has: '/^.*"category":"internal-md".*"outcome":"opened".*$/' }

  - name: 「首行是相对路径但目标不存在」的文档
    do: open
    file: links-missing-relative.md
    marker: "未建的相对链接"
    expect:
      - label: 解析不到的目标照样装饰（装饰与激活解耦）
        editor: { has: "/未建的相对链接→/" }

  - name: ⌘⏎ 跟随未解析的相对路径
    do: key
    key: "cmd+return"
    expect:
      - shot: 相对链接未解析
      - label: 只给「链接目标不存在」提示
        ax: { has: "链接目标不存在" }
      - label: 不创建文件（凭空多出一个文件不是作者要的）
        file: { path: "missing-relative.md", exists: false }
      - label: 没有跳到别处（仍在原文档）
        editor: { has: "这一段占位" }

  - name: 未解析落了对账用的诊断事件
    do: sleep
    ms: 800
    expect:
      - label: 未解析记 category=internal-md、outcome=unresolved
        file: { path: "env:logs/*.jsonl", has: '/^.*"category":"internal-md".*"outcome":"unresolved".*$/' }

  - name: 「首行是纯锚点」的文档
    do: open
    file: links-anchor.md
    marker: "纯锚点"
    expect:
      - label: 纯锚点也装饰为「→」
        editor: { has: "/纯锚点→/" }

  - name: ⌘⏎ 跟随纯锚点
    do: key
    key: "cmd+return"
    expect:
      - shot: 锚点提示
      - label: 给「暂不支持锚点跳转」提示（能力边界说清楚）
        ax: { has: "暂不支持锚点跳转" }
      - label: 没有发生文档内滚动跳转（仍在原文档的正文位置）
        editor: { has: "这一段说明" }

  - name: 纯锚点的激活落了诊断
    do: sleep
    ms: 800
    expect:
      - label: 锚点激活记 category=anchor
        file: { path: "env:logs/*.jsonl", has: '/^.*"category":"anchor".*$/' }

  - name: 「首行是白名单外 scheme」的文档
    do: open
    file: links-blocked.md
    marker: "保持原文"
    expect:
      - label: 不可用形态保持原文（不装饰、没有标记）
        editor: { has: "[别开我](javascript:alert(1))" }

  - name: ⌘⏎ 落在不可用形态上
    do: key
    key: "cmd+return"
    expect:
      - shot: 不可用形态
      - label: 没有把它当外链去开（拒绝提示也不该出现——压根没走到打开路径）
        ax: { not: "/打不开这类链接|打开链接失败/" }
      - label: 文档没被动过
        editor: { has: "保持原文" }

  - name: 不可用形态的激活也落了诊断（「按了没反应」可归因）
    do: sleep
    ms: 800
    expect:
      - label: 不可用记 category=blocked-scheme
        file: { path: "env:logs/*.jsonl", has: '/^.*"category":"blocked-scheme".*$/' }

  - name: 回到外链文档并确认键盘落点
    do: open
    file: links.md
    marker: "第一条外链"
    expect:
      - label: 回到外链文档
        editor: { has: "/第一条外链↗/" }

  - name: 回前台（⌘⏎ 注入的前台纪律）
    do: focusWindow
    expect:
      - label: 编辑器仍可读（没有 modal 挡住，且窗口已在前台）
        editor: { has: "/第二条外链↗/" }

  - name: ⌘⏎ 开外链（光标在首行的外链上）
    do: key
    key: "cmd+return"
    expect:
      - shot: cmd-enter-之后
      - label: 打开链路没有报错（不在白名单外 / 系统调用失败都各有专属提示）
        ax: { not: "/打不开这类链接|打开链接失败/" }
      - label: 打开外链不改文档
        editor: { has: "/第一条外链↗/" }
      - label: 外链没有多出一条「未创建的链接」提示（外链走打开路径，不进 wikilink 路径）
        # 更早步骤的未创建提示可能还在（带动作的 toast 挂 8s），所以判「没有第二条」而不是
        # 「一条都没有」——跨步骤的残留是正常现象，不是回归。
        ax: { count: { pattern: "未创建的链接", max: 1 } }

  - name: 诊断日志确认 opener 真被调用
    do: sleep
    ms: 800
    expect:
      - label: 打开尝试落了 link_open 事件（scheme=https、outcome=opened）
        file: { path: "env:logs/*.jsonl", has: '/"event":"link_open".*"outcome":"opened"/' }
      - label: 日志里没有 URL 原文（logging 的隐私边界：负载不含文档正文）
        file: { path: "env:logs/*.jsonl", not: "example.invalid" }

  - name: 非 md 相对路径：装饰为「↗︎」
    do: open
    file: links-asset.md
    marker: "附件"
    expect:
      - label: 非 md 相对路径带「会离开本应用」的标记
        editor: { has: "/附件↗/" }
      - label: 目标源码不显露
        editor: { not: "notes.txt" }

  - name: ⌘⏎ 打开 vault 内非 md 文件（本场景最后一步）
    do: key
    key: "cmd+return"
    expect:
      - shot: 非-md-打开后
      - label: 打开链路没有报错（越界 / 不存在各有专属提示）
        ax: { not: "/打不开这个目标|打开文件失败/" }
      - label: 没有把它当应用内笔记打开（仍在原文档）
        editor: { has: "这一段说明" }

  - name: 诊断日志确认资产走的是系统默认应用
    do: sleep
    ms: 1200
    expect:
      - label: 资产打开记 category=asset、outcome=opened
        file: { path: "env:logs/*.jsonl", has: '/^.*"category":"asset".*"outcome":"opened".*$/' }
---

链接（标准 Markdown 链接 `[title](target)`）的渲染与激活**行为**判定（M144 起，M145 补齐全形态）。

## 断言口径

- **形态矩阵**（装饰与激活解耦：装饰只看目标原文，文件存不存在是激活时才问的问题）：
  `http`/`https`/`mailto` → `title↗︎` 交系统默认应用；相对路径 md（含无扩展名）→ `title→`
  应用内跳转；相对路径非 md 与目录 → `title↗︎` 交系统默认应用；纯锚点 → `title→` 但激活
  只给提示；白名单外 scheme（`javascript:` 等）→ 原文，不装饰也不激活。
- **渲染**：渲染态下 `[title](target)` 的 `(target)` 源码不显露。光标停在文档首
  （`openFile` 把选区复位到 0），恰好落在首行链接的起点上——该位置**不触发**源码显露
  （显露判定是选区与链接范围的严格重叠），所以渲染态可以直接断言。
- **激活**：每个形态各用一份「首行就是链接」的 fixture，光标天然在链接起点上，
  ⌘⏎ 一次只验一条路径，不依赖光标移动（`ctrl+n` 之类的注入会引入不必要的脆弱性）。
- **诊断对账**：`link_open` 事件按类别记录（`category` ∈ external / internal-md /
  asset / anchor / blocked-scheme）。断言写成 `^.*"category":"…".*"outcome":"…".*$`——
  JSONL 是**一行一事件**，加 `^`/`$` 后正则不能跨行进到别的事件上（MATCHER 带 `m` flag，
  不加锚点的 `.*` 会被同一文件里更早/更晚的事件满足，变成假绿）。日志文件名是 UTC 日期、
  而验收环境的 `env/` 目录跨天复用（`lib/util.mjs` 的 `envHome()` 不带日期），所以路径写成
  glob——`path: "env:logs/*.jsonl"` 由 `lib/execute.mjs` 取**匹配文件里 mtime 最新的那一份**
  再断言内容。写死日期的断言会在之后每天读到上次 run 的旧文件而永久空过。
- **这条日志断言的残余风险（如实记录）**：同一 worktree 同一天重复跑时，最新文件就是同一个
  （同日线同一个 JSONL），里面可能有**上一次 run** 落下的事件。因此它不独立成立——与同步骤的
  正向/负向 UI 断言联合构成判定。真机上每轮全量只跑一次本场景，风险可接受；人工核对可直接
  `grep '"category":"asset"' test-results/acceptance/env/lumir/logs/*.jsonl`。
- **⌘-Click**：**本套件无法表达**。`click` 动作不支持修饰键（`lib/execute.mjs` 的 click 只有
  target/count）——给 click 加修饰键是套件能力改造（已投 finding，记进 `docs/backlog.md`）。
  因此该路径由视觉场景 `tests/visual/scenes/render-link.spec.ts` 覆盖（stub 记录
  `open_external_url` / `link_open_path` 的调用参数，断言开的是哪个目标且不真开）。

## 环境与副作用

隔离 `XDG_CONFIG_HOME` 与合成 vault（`/tmp/lumir-m102-acceptance`），端口
`LUMIR_ACCEPTANCE_PORT`（默认 1430）。本场景会 AXRaise Lumir 抢前台焦点（⌘⏎ 需要前台）。

**会真的唤起系统应用两次**（都排在场景末尾，避免抢焦点影响后续键盘注入）：

1. ⌘⏎ 开外链 → 系统默认浏览器打开保留域 `https://example.invalid/alpha`（不会加载任何页面）；
2. ⌘⏎ 开非 md 资产 → 系统默认应用打开 `notes.txt`（stock macOS 上是「文本编辑」）。
   `notes.txt` 由 `fixtures` 在场景开始时拷进 vault；这个动作是「非 md 交系统默认应用」
   这条能力的唯一可观测终点，没有更轻的等价断言（打开成功才会落 `link_open` 的
   `outcome=opened`）。若这两个窗口碍事，直接关掉即可。
