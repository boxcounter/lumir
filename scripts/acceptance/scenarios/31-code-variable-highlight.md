---
id: "31-code-variable-highlight"
item: 31
title: 双击标识符高亮同一变量：选区成立即判定（底纹在场留截图）、装饰不改文档、T3 与 md 静默
fixtures: [var-highlight.js, var-highlight.lua, var-highlight.md]
open: var-highlight.js
marker: "const LIMIT = 42;"
steps:
  - name: 打开 fixture（触发前）：记录磁盘基线与编辑器基线
    do: record
    as: 磁盘基线
    file: var-highlight.js
    expect:
      - label: 编辑器已装载本 fixture（AX 是活的，后面的负向判据才有意义）
        ax: { has: "const LIMIT = 42;" }
      - label: 触发前没有任何提示（本能力零文案：MUST NOT 出现 toast 一类的可见 UI）
        ax: { not: "这份文件类型暂不支持大纲" }
      - shot: 触发前（无底纹）

  - name: 记下编辑器基线（「装饰不改写源文件」的逐字节判据）
    do: recordEditor
    as: 编辑器基线

  - name: 建立编辑器焦点（左栏点击打开之后焦点在文件树上，编辑器内的键盘命令要先点回正文）
    do: clickEditor
    dy: 6

  - name: ⌘F 打开搜索 panel（此时查询词为空）
    do: key
    key: "cmd+f"
    expect:
      - label: 面板就位
        ax: { has: "上一个" }
      - label: 查询词是空的：计数 0/0（本场景不用「查询词取选区」那条路径，见正文的通道说明）
        ax: { has: "0/0" }
      - shot: 面板已开（查询词为空）

  - name: 逐字符敲入查询词 limit（`keys` 对纯可打印序列做回读 + 有限重试）
    do: keys
    keys: ["l", "i", "m", "i", "t"]
    gapMs: 250
    expect:
      - label: 查询词落地为 limit（回读判据：AXTextField 的 value 逐字等于注入的串）
        ax: { has: '/AXTextField = "limit"/' }

  - name: 回车走到第一个匹配——官方 findNext 把选区移到该匹配上，触发判据在此刻成立
    do: key
    key: "return"
    expect:
      - label: 计数 1/6：文件里共 6 处 LIMIT 文本（4 处变量 + 字符串 + 注释），选区落在第一处
        ax: { has: "1/6" }
      - shot: 触发后（底纹应在第 2、3、6 行上；交 Alex 过目）

  - name: Esc 关闭 panel（焦点交还编辑器）
    do: key
    key: "escape"
    expect:
      - label: 面板已关闭
        ax: { not: "上一个" }
      - label: 触发全程不改文档（编辑器逐字节）
        editor: { unchangedSince: 编辑器基线 }
      - label: 磁盘文件 sha256 未变（高亮是装饰，不写盘）
        file: { path: var-highlight.js, unchangedSince: 磁盘基线 }
      - shot: 触发后（面板已关，底纹仍在）

  - name: 切到不支持档的语言（.lua）：先确认编辑器换了文档
    do: open
    file: var-highlight.lua
    marker: "local LIMIT = 1"
    expect:
      - label: 编辑器已装载
        ax: { has: "local LIMIT = 1" }

  - name: 记下 lua 的编辑器基线
    do: recordEditor
    as: lua基线

  - name: 建立编辑器焦点（换文档后焦点回到文件树）
    do: clickEditor
    dy: 6

  - name: ⌘F 打开面板（查询词沿用上一步的 limit，无需再敲）
    do: key
    key: "cmd+f"
    expect:
      - label: 面板就位且查询词仍在（搜索状态跨文件保留）
        ax: { has: '/AXTextField = "limit"/' }

  - name: 回车走到第一个匹配（lua 里这也是一个变量位置，但该语言没有结构解析）
    do: key
    key: "return"
    expect:
      - label: 计数 1/3：lua 文件里共 3 处 LIMIT，选区落在第一处（第 1 行的局部声明）
        ax: { has: "1/3" }
      - shot: lua 选中后（静默：无装饰、无提示）

  - name: Esc 关面板并复核 lua 未被本能力改动、也没有任何提示
    do: key
    key: "escape"
    expect:
      - label: 不支持的语言静默——文档逐字节未变
        editor: { unchangedSince: lua基线 }
      - label: 也没有任何提示（不是错误态：用户没做错事）
        ax: { not: "这份文件类型暂不支持大纲" }
      - label: 没有意外展开大纲浮层
        ax: { not: "⌃N⌃P 选择" }

  - name: 切到 md 模式（同一段文本在 md 里是正文，不是代码）
    do: open
    file: var-highlight.md
    marker: "变量高亮（md 对照）"
    expect:
      - label: 编辑器已装载
        ax: { has: "变量高亮（md 对照）" }

  - name: 记下 md 的编辑器基线
    do: recordEditor
    as: md基线

  - name: 建立编辑器焦点
    do: clickEditor
    dy: 6

  - name: ⌘F 打开面板（查询词仍是 limit）
    do: key
    key: "cmd+f"
    expect:
      - label: 面板就位且查询词仍在
        ax: { has: '/AXTextField = "limit"/' }

  - name: 回车走到第一个匹配（md 正文里的 LIMIT，md 模式 MUST NOT 有本能力）
    do: key
    key: "return"
    expect:
      - label: 计数 1/1：md 文件里只有一处 LIMIT，选区落在它上面
        ax: { has: "1/1" }
      - shot: md 模式选中后（静默）

  - name: Esc 关面板并复核 md 未被本能力改动
    do: key
    key: "escape"
    expect:
      - label: md 模式下文档逐字节未变（本能力不装进 md 分支）
        editor: { unchangedSince: md基线 }
      - label: 没有任何提示
        ax: { not: "这份文件类型暂不支持大纲" }
      - label: md 的正文仍可读（选区显露口径未被搅动）
        ax: { has: "LIMIT + 1;" }

---

代码文件里「双击标识符高亮同一变量」的真机（WKWebView）行为判定。规格见
`openspec/changes/code-variable-highlight/specs/editor-live-preview/spec.md` 的两条 ADDED；
判据实现见 `src/code-identifiers.ts`（位置类别 / 名字 / 可见域三层），呈现见
`src/preview/theme.ts` 的 `codeBindingTheme`。

## 触发通道：为什么用「⌘F + 逐字符查询词 + 回车」，而不是双击

**双击通道的现状（M209 修订，2026-09-25）**：README「已知边界」的 dblclick 条已整体改写，两处要点
（按条目标题引用，不写行号——行号会漂）：
① M184 那次「四条通道都造不出 `dblclick`」的实测所依据的判据**已被证伪**——判据是「双击文件树行 →
标签数 1→2」，而 `src/main.ts:380-386` 的 `openFile` 对**已打开的同路径**会短路（只把标签从预览
固定住、不新建标签），单击树行又本来就是 `open("preview")` ⇒ 这条判据在任何可达现场恒不成立，
真双击与「只落两次单击」标签数同形。因此「四条通道造不出 dblclick」这个结论**待按修正判据重跑才作数**，
旧文里的「已定死」不再成立。
② 套件从 M209 起**已有 `doubleClick` 动作**（`lib/cgevent-click.swift` 的 swift + `CGEvent` 显式
`kCGMouseEventClickState` 通道；实测能造出 WKWebView 的 DOM `dblclick`，现场见
`test-results/acceptance/<日期>/33-image-lightbox/`）。

**本场景继续走选区通道的理由**：判据写在**选区**上（spec：「选区非空、单区间、完整包含于一个变量类
位置的标识符节点内」），不写在手势上——换通道不改变被测行为，而 `doubleClick` 走真鼠标、要求目标窗口
在前台且不被别的应用遮挡（README「已知边界」那条的纪律），选区通道没有这个环境依赖。

**这条替代通道的落点**：`⌘F` 打开面板 → 逐字符敲入 `LIMIT` → **回车**：回车走官方 `findNext`，
把**选区移到该匹配上**（`src/search.ts` 的既有语义），于是触发判据所要求的「非空、单区间、落在标识符
里」三条同时成立。两条机器证据把这件事钉死：**查询词**（`AXTextField` 的 value 逐字等于 `LIMIT`）证明
查询落地的文本，**计数**（`1/6`）证明选区落在哪一处匹配上（AX 不暴露选区范围，计数是它的函数）。

**为什么不走「⌥⇧F 扩选 → ⌘F 带查询词」那条既有写法**：M198 实测（两轮真机）该组合在本机注入链路
上**不落地**——`⌃E/⌃A/⌃N` 这类 ⌃ 组合正常生效（光标确实移到了末行，截图为证），而 `⌥⇧F` 之后 ⌘F
打开的面板里**查询词是空的**（`search-01-find` 用的是同一条通道；本轮没有回跑它，只作为本场景不采用
该路径的记录）。逐字符注入由 `keys` 的**回读 + 有限重试**（README「已知边界」，≤3 次、只在目标字节
完全未变时重试）兜底，落地结果由查询词的 AX 值判。

## 断言口径（为什么这么写）

- **可判的三条**：① 文档逐字节不变（`editor.unchangedSince` + 磁盘 sha256 两条，铁律核对）；
  ② AX 侧 liveness（编辑器可读、查询词与计数如实）；③ 截图留证（底纹是否可辨识是 Alex 的手感项，
  套件不替它下结论）。
- **装饰的在场 / 缺席在本通道不可判**（如实写明，MUST NOT 把「读不到」当「通过」）：
  - `design.md:89` 与提案都写明 **AX 不暴露装饰与颜色**；M197 的实机 AX dump 可复核
    （`test-results/acceptance/2026-09-24/30-code-outline/ax/01-*.txt`：编辑器只有
    `AXTextArea = "<全文>"` 与逐行 `AXStaticText`，没有任何样式信息）；
  - runner 的断言词表只有 `ax` / `editor` / `file` / `glob` / `shot`，**没有 DOM 探针**；
  - 因此本场景**不做**「字符串 / 注释里的同名文本不亮」这类需要读装饰的步骤——那种步骤在本通道下
    只能得到恒真的断言（**假绿**，REVIEW.md 第 1、2 条）。这两条的**精确判据（装饰覆盖的区间集合）
    由 chromium 层覆盖**：`tests/visual/scenes/m198-code-variable-highlight.spec.ts` 的「排除面」一条
    把 8 门语言的字符串 / 注释 / 成员名 / 字段名 / 类型成员逐条断言成 0 装饰，另有「选不全也命中」
    与「三层可区分」两条；单测层（`tests/unit/code-identifiers.test.ts`，70 条判据语料）另有一层。
  - **反向验证（把判定临时改成全词匹配 → 字符串 / 注释用例必须 FAIL）同样只在 chromium 层做**，
    证据在 `test-results/m198/reverse-verification/`；本文件如实写明这条不在真机层覆盖。
- **AX 探针（M198 实测）**：本场景每步都留 `shot`（截图 + AX dump）。触发前 / 触发后两份 dump
  逐行比对过：编辑器的 `AXTextArea` 与逐行 `AXStaticText` 逐字符相同、`element_count` 也不变
  —— 装饰在 AX 侧没有任何可判信号，因此**没有**把「装饰在场」升级成真机断言
  （读数见 `test-results/m198/task8-ax-probe.md`）。
- **零文案**：本能力不引入任何 toast / 提示；真机侧的判据是「已知提示串一条都不出现」+ 截图。
- **焦点必须先点回正文**：`open` 是点击左栏文件行，焦点在文件树上，编辑器内的键盘命令不会生效
  ——每个文档段落开始都要先 `clickEditor`（M198 首轮实测：漏掉这步会让文档内的按键全部落空）。

## 覆盖边界（如实写）

- **双击手势本身**不在本场景：通道造不出来（见上）。「手势 → 选区」这一段由 chromium 层的真实
  `page.mouse.dblclick` 覆盖（`m198-code-variable-highlight.spec.ts` 的收录面逐语言用例）。
- **字符串 / 注释的排除面、选不全、跨节点、三层配色、生命周期四条清除**都不在本场景，归 chromium 层
  （理由同上：需要读装饰与计算样式）。
- **颜色与底纹可辨识度**归 Alex 手感项，套件只留截图（`shots/02`、`shots/03`）。
- **1MB 级文件的索引构建耗时**不在本场景（fixture 都是短文件），读数与量级见
  `test-results/m198/perf-var-highlight.json`（如实记录：1MB 首次触发 ≈ 0.9s，为不达标项）。
