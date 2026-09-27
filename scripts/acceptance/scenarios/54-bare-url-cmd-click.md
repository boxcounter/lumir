---
id: "54-bare-url-cmd-click"
item: 54
title: 裸 URL / 链接定义行 / 角括号自动链接的装饰与 ⌘⏎ 打开（M272）
fixtures: [links-bare.md, links-bare-def.md, links-bare-auto.md]
open: links-bare.md
marker: "bare54"
steps:
  - name: 渲染态：三种字面形态都装饰为外链（URL 原文仍在场，尾标在场）
    do: settle
    expect:
      - label: 裸 URL 装饰上屏——URL 原文本身仍在场（它没有可隐藏的源码），尾标紧跟其后
        editor: { has: '/example\.invalid\/bare54↗/' }
      - label: 同一份文档里 `www.` 字面保持原文——负向断言，配对正观测是上面那条（REVIEW.md 第 2 条）
        editor: { not: '/www\.example\.invalid↗/' }
      - label: "反引号包裹的 `www.` 字面本身可读（正向锚点：这一读是活的，不是空值）"
        editor: { has: "www.example.invalid" }
      - label: 裸邮箱同样保持原文（无 scheme ⇒ 会被判成 vault 内资产，语义是错的）
        editor: { not: '/someone@example\.invalid↗/' }
      - label: "定义行只装饰 URL 部分，`[homepage]: ` 前缀保持原文"
        editor: { has: '/\[homepage\]: https:\/\/example\.invalid\/home54↗/' }
      - label: 角括号自动链接：两个尖括号被隐藏，URL 文本与尾标在场
        editor: { has: '/example\.invalid\/auto54↗/' }
      - label: 反向：尖括号原文不得出现（尖括号是语法定界符，不是目标的一部分）
        editor: { not: "<https://example.invalid/auto54>" }
      - label: 渲染不改写源文件（磁盘仍是 fixture 原文，首行就是裸 URL）
        file: { path: links-bare.md, has: '/^https:\/\/example\.invalid\/bare54$/' }
      - shot: 渲染态

  - name: 记下编辑器与文件的基线（⌘⏎ 之后的「不改文档」逐字节比它们）
    do: recordEditor
    as: 编辑器基线
  - name: 记下源文件基线（装饰层 MUST NOT 改写磁盘内容）
    do: record
    as: 文件基线
    file: links-bare.md

  - name: 回前台（⌘⏎ 注入的前台纪律：窗口被遮挡时键盘注入不落地）
    do: focusWindow
    expect:
      - label: 编辑器仍可读（没有 modal 挡住）
        editor: { has: "bare54" }

  - name: ⌘⏎ 打开裸 URL（光标在文档首，恰好是 URL 节点起点）
    do: key
    key: "cmd+return"
    expect:
      - label: 打开链路没有报错（白名单外 / 系统调用失败都各有专属提示）
        ax: { not: "/打不开这类链接|打开链接失败/" }
      - label: 打开外链不改文档（编辑器文本逐字节不变）
        editor: { unchangedSince: 编辑器基线 }
      - shot: 裸-URL-打开后

  - name: 诊断日志确认外链路径真被走到
    do: sleep
    ms: 1200
    expect:
      - label: 打开尝试落了 link_open 事件（category=external、outcome=opened）
        file: { path: "env:logs/*.jsonl", has: '/^.*"category":"external".*"outcome":"opened".*$/' }
      - label: 日志里没有 URL 原文（logging 的隐私边界：负载不含文档正文）
        file: { path: "env:logs/*.jsonl", not: "example.invalid" }
      - label: 源文件未被打开动作改写（sha256 + mtime 双比）
        file: { path: links-bare.md, unchangedSince: 文件基线, mtimeUnchangedSince: 文件基线 }

  - name: 换到「首行是链接定义行」的 fixture（选区复位到 0 = 定义行起点）
    do: open
    file: links-bare-def.md
    marker: "home54"
    expect:
      - label: "定义行的 URL 部分装饰为外链（`[homepage]: ` 前缀保持原文）"
        editor: { has: '/\[homepage\]: https:\/\/example\.invalid\/home54↗/' }
      - label: 起点是渲染态（光标在文档首，与定义行范围不构成严格重叠 ⇒ 不显露源码）
        editor: { has: "前缀保持原文" }
      - shot: 定义行-渲染态

  - name: 重新拿回前台（点编辑器）——上一次 ⌘⏎ 唤起了系统浏览器并抢走前台
    # 12-links 的同款纪律（那里把开外链的步骤整段排在场景末尾）。这里用 `clickEditor`（**真实
    # 坐标点击**）而不只是 `focusWindow`（AXRaise）：坐标点击本身会把窗口带到前台并给编辑器焦点，
    # AXRaise 是尽力而为、失败只留一条 note（M272 实测：只靠 AXRaise 时后续 ⌘⏎ 静默不落地，
    # 日志零新增而断言看似全绿）。
    do: clickEditor
    expect:
      - label: 编辑器仍可读（前台已回到 Lumir）
        editor: { has: "home54" }
  - name: 把光标移进 URL 区间（⌃E 到行尾，再 ⌃B 退回一个字符）
    # **必须的落点铺垫**：`open` 把选区复位到 0，而 0 落在 `[homepage]: ` **前缀**里——前缀不是
    # URL 节点，⌘⏎ 在那里无操作（M272 实测：漏了这一步，三次 ⌘⏎ 里只有首行就是裸 URL 的那次
    # 真的打开了）。装饰面与激活面在这里的判据不同——装饰的显露范围是整条定义行、激活要「光标落在
    # URL 区间内」，本场景按后者构造（用户的自然动作也是点到 URL 上）。
    # **⌃B 同时是这条铺垫的见证**：光标进到 URL 区间后该处装饰被撤下（显露判据 = 光标落在节点范围内），
    # 下面那条 `not: /home54↗/` 因此是「光标真的到了」的正观测——丢键会红在这条上，而不是让后面的
    # 日志断言空过（REVIEW.md 第 2 条）。
    do: keys
    keys: ["ctrl+e", "ctrl+b"]
    expect:
      - label: 光标已进 URL 区间（该处装饰被撤下 = 显露态）
        editor: { not: '/home54↗/' }
      - label: 反向对照：URL 原文仍在场（撤下的只是样式与尾标）
        editor: { has: "https://example.invalid/home54" }
  - name: 记下日志基线（下一步要证「又落了一条新事件」，而不是复用前面那条）
    do: record
    as: 日志基线
    file: "env:logs/*.jsonl"
  - name: ⌘⏎ 打开定义行的 URL
    do: key
    key: "cmd+return"
    expect:
      - label: 打开链路没有报错
        ax: { not: "/打不开这类链接|打开链接失败/" }
      - shot: 定义行-打开后

  - name: 日志又落了一条（新事件的判据是 sha256 变化 + 类别断言，两条合起来才成立）
    do: sleep
    ms: 1200
    expect:
      - label: 诊断日志文件确实被追加（与上一步记的基线比 sha256）
        file: { path: "env:logs/*.jsonl", changedSince: 日志基线 }
      - label: 追加的是外链打开事件
        file: { path: "env:logs/*.jsonl", has: '/^.*"category":"external".*"outcome":"opened".*$/' }

  - name: 换到「首行是角括号自动链接」的 fixture
    do: open
    file: links-bare-auto.md
    marker: "auto54"
    expect:
      - label: 自动链接装饰为外链（UA 文本在场、尖括号不在）
        editor: { has: '/example\.invalid\/auto54↗/' }
      - label: 反向：尖括号原文不出现
        editor: { not: "<https://example.invalid/auto54>" }
      - shot: 自动链接-渲染态

  - name: 重新拿回前台（同前：上一次 ⌘⏎ 又把浏览器拉到了前台）
    do: clickEditor
    expect:
      - label: 编辑器仍可读（前台已回到 Lumir）
        editor: { has: "auto54" }
  - name: 把光标移进 URL 区间（⌃E 到行尾，再 ⌃B 退到 `>` 之前 = URL 末位）
    do: keys
    keys: ["ctrl+e", "ctrl+b"]
    expect:
      - label: 光标已进 URL 区间（该处装饰被撤下 = 显露态，尖括号随之露出）
        editor: { not: '/auto54↗/' }
      - label: 反向对照：显露态里尖括号原文可见（它本来就是语法定界符）
        editor: { has: "<https://example.invalid/auto54>" }
  - name: 记下日志基线（第二条：证明这一次也落了新事件）
    do: record
    as: 日志基线2
    file: "env:logs/*.jsonl"
  - name: ⌘⏎ 打开角括号自动链接
    do: key
    key: "cmd+return"
    expect:
      - label: 打开链路没有报错
        ax: { not: "/打不开这类链接|打开链接失败/" }
      - shot: 自动链接-打开后

  - name: 收尾断言
    do: sleep
    ms: 1200
    expect:
      - label: 诊断日志再次被追加（这一次的打开确实落到了日志里）
        file: { path: "env:logs/*.jsonl", changedSince: 日志基线2 }
      - label: 追加的仍是外链打开事件
        file: { path: "env:logs/*.jsonl", has: '/^.*"category":"external".*"outcome":"opened".*$/' }
      - label: 三份 fixture 全程逐字节未变（装饰与激活都不改写源文件，ADR 0003 §3）
        file: { path: links-bare-auto.md, has: '/^<https:\/\/example\.invalid\/auto54>$/' }
      - label: "定义行 fixture 的 `[homepage]: ` 前缀仍在磁盘原文里"
        file: { path: links-bare-def.md, has: '/^\[homepage\]: https:\/\/example\.invalid\/home54$/' }
---
# 裸 URL / 链接定义行 / 角括号自动链接（M272，change `bare-url-cmd-click`）

Alex 原话（2026-09-27）：「普通链接（不是 markdown 标准语法 [title](link)）也可以像 markdown 标准
链接那样可以通过 CMD+点击打开。」现场是 `CODE_OF_CONDUCT.md` 末尾的定义行
`[homepage]: https://www.contributor-covenant.org` 里的裸 URL。

## 这个场景验什么

判定面从语法树的 `Link` 节点扩到 `URL` 节点之后的**三种字面形态**（标准链接 `[title](target)` 由
既有场景 12 覆盖）：

| 形态 | 语法树里的形态 | 本场景的 fixture |
|---|---|---|
| 裸 URL | `Paragraph` 直属的顶层 `URL` 节点（GFM 的 `Autolink` 扩展产出） | `links-bare.md` 第 1 行 |
| 链接定义行 `[tag]: url` | `LinkReference` 的 `URL` 子节点 | `links-bare-def.md` 第 1 行、`links-bare.md` 第 5 行 |
| 角括号自动链接 `<url>` | `Autolink` 的 `URL` 子节点 | `links-bare-auto.md` 第 1 行 |

三份 fixture 的**首行就是目标**：`openFile` 把选区复位到 0。**但起点是否可激活，三种形态不同**
（M272 实测到的关键落点事实，第一版场景就栽在这里）：

| 形态 | 选区复位到 0 时 | 本场景的处置 |
|---|---|---|
| 裸 URL（`links-bare.md`） | 0 **就是** `URL` 节点起点 ⇒ ⌘⏎ 直接命中 | 不用移光标 |
| 链接定义行（`links-bare-def.md`） | 0 落在 `[homepage]: ` **前缀**里（前缀不是 `URL` 节点）⇒ ⌘⏎ 无操作 | ⌘⏎ 前 `ctrl+e` 把光标移到行尾（= URL 末位） |
| 角括号自动链接（`links-bare-auto.md`） | 0 是 `<`（`Autolink` 节点起点，`URL` 子节点从 1 开始）⇒ ⌘⏎ 无操作 | 同上，`ctrl+e` |

这三行是**装饰面与激活面的判据差异**：装饰按「整条形态」算（定义行的显露范围含前缀、自动链接含尖括号），
激活要求**光标落在 `URL` 区间内**——用户的实际动作（点到 URL 上、或把光标移到行尾）与后者一致。

起点**不触发源码显露**（显露判据是选区与范围**严格**重叠，空光标在起点不满足），因此渲染态可以直接断言。

## 判据走哪几条通道

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 装饰上屏 | **编辑器 AX 文本**（`URL↗` 紧邻形态） | 尾标是 DOM 里的 widget，AXTextArea.value 包含它（`12-links` 的 `第一条外链↗` 同款） |
| URL 原文仍在场 | 同一条：`example.invalid/bare54` 仍是可见文本 | 这三种形态**没有可隐藏的源码**，唯一的隐藏是形态 4 的两个尖括号 |
| 不装饰的面 | `editor: { not: …↗ }` + 同一份文档里的正观测 | REVIEW.md 第 2 条：负向断言必须配正观测，否则「查询恒 null」也绿 |
| 打开路径 | **诊断日志 `link_open`（category=external / outcome=opened）+ 日志 sha256 变化** | 真机日志**不含 URL 原文**（隐私边界），因此「开的是哪一个 URL」判不了；那条由 chromium 场景 `render-link.spec.ts` 的 `window.__openedUrls` 断言承担。真机能判的是「确实又落了一条外链打开事件」——所以第二、三次打开都先 `record` 日志基线再比 sha256 |
| 不改文档 | 编辑器文本 `unchangedSince` + 文件 sha256 与 mtime 双比 | ADR 0003 §3 铁律：装饰层与激活路径都 MUST NOT 写文档 |

## 已知边界（如实登记）

- **⌘-Click 在真机上不可表达**：套件的 `click` 动作不支持修饰键（`docs/backlog.md` 的既有条目），
  因此鼠标路径由 chromium 场景覆盖（合成 `mousedown` + `metaKey`），本场景只能验 **⌘⏎**。
  这不是本 change 引入的限制。
- **引用点仍是半覆盖**：`[正文][ref]` / `[ref]` 这类引用点**不可点**（lezer 不把定义处的 URL 挂到
  引用点），本 change 只让定义行那一侧的 URL 可点。另立 change 与否由 Alex 裁决。
- **无 scheme 的字面 URL 保持原文**：`www.example.invalid` / 裸邮箱不装饰也不激活——它们没有
  scheme，喂给分类会走成 vault 内资产（把网页当本地路径交给 Rust 校验），语义是错的。
  本场景只判上屏形态；⌘⏎ 在它们上面「无操作」这条判据在真机上不可判（chord 注入无法区分
  「无操作」与「丢键」），归 chromium 层（`render-link.spec.ts` 断言 `__openedUrls` 不变）。
- **会真的唤起系统浏览器三次**（保留域 `example.invalid`，不会加载任何页面）：本场景三处 ⌘⏎ 各开
  一次。若窗口碍事直接关掉即可。
- **日志断言的残余风险**（与 `12-links` 同款，如实记录）：同一 worktree 同一天重复跑时读的是同一个
  JSONL，里面可能有上一次 run 的事件。因此第二、三次打开改用「先 record 日志基线、再比 sha256 变化」
  的形态，不靠「文件里有没有这行」独立成立。
