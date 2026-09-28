---
id: "64-bold-selection-drawselection"
item: 64
title: 选中跨粗体：选区底色由编辑器自绘（drawSelection），粗体段不漏画、行尾空白也涂满
steps:
  - name: 造 fixture（场景自建，不动 fixtures 目录）
    do: vaultWrite
    file: m285-bold.md
    content: |
      选区的起点这一段全是普通文字。

      **粗体段** 与它后面的普通文字。

      选区到这一行结束。
    expect:
      - label: fixture 已落盘（读不到一律 FAIL，不允许在空值上比较）
        file: { path: m285-bold.md, exists: true }
      - label: 起点：粗体定界符此刻仍在源码里（渲染态那一步要靠它）
        file: { path: m285-bold.md, has: "/^\\*\\*粗体段\\*\\*/" }
      - shot: fixture

  - name: 等一拍再读（外部写入后立刻读 AX 会与 DOM 刷新抢）
    do: sleep
    ms: 1200

  - name: 打开 fixture（点左栏树行）
    do: open
    file: m285-bold.md
    marker: "选区的起点这一段"
    expect:
      - label: 渲染态：粗体的 `**` 不出现（起点必须是渲染态，否则「装饰重建」那一拍就没有了）
        editor: { not: "**" }
      - shot: 渲染态起点

  - name: 记下文件基线（本场景的手势一个都不许改文档）
    do: record
    file: m285-bold.md
    as: 手势前

  - name: 把光标放进第 1 行（点编辑器正文起点；正文内元素没有 AX bbox，只能按坐标点）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里（键盘注入的前置）
        ax: { focused: "AXTextArea" }
  - name: 抢前台（同机别的 app 抢走前台时后台注入的 chord 会丢键——REVIEW.md 第 11 条）
    do: focusWindow
    retries: 4
  - name: ⌃⇧N 四次：把选区从第 1 行扩到第 3 段（跨两个段落，含粗体段）
    do: keys
    keys: ["ctrl+shift+n", "ctrl+shift+n", "ctrl+shift+n", "ctrl+shift+n"]
    expect:
      - label: 选区确实覆盖了粗体范围——它显露为源码（没覆盖这条场景就空转了，如实判 FAIL）
        editor: { has: "**粗体段**" }
      - label: 手势不改文档（sha256 + mtime 双比）
        file: { path: m285-bold.md, unchangedSince: 手势前, mtimeUnchangedSince: 手势前 }
      - shot: 跨段选区

  - name: ⌘C 两次并记录剪贴板读数（**记录动作、不做断言**：见正文「已知边界」的 ⌘C 条）
    do: keys
    keys: ["cmd+c", "cmd+c"]
  - name: 把剪贴板读数写进证据（`clipboardRead` 只记录，不判 PASS/FAIL）
    do: clipboardRead

  - name: 判底色（AX 读不到选区，像素层是本缺陷唯一的真机判据）
    do: sleep
    ms: 600
    expect:
      - label: 选区内粗体段的底色 == 选区内普通文字的底色（修前这里是「洞」：粗体段没被画上）
        pixel:
          same:
            - [ { x: 500, y: 201, as: "选区内 粗体段" }, { x: 480, y: 156, as: "选区内 第1行普通文字" } ]
      - label: 第 1 行行尾空白也被涂上选中底色（「选区由编辑器自绘」的签名：原生选区不涂这一块）
        pixel:
          same:
            - [ { x: 900, y: 156, as: "第1行 行尾空白（选区内开放端）" }, { x: 480, y: 156, as: "选区内 第1行普通文字" } ]
      - label: 反向对照：选区外的底色必须与选区内不同（防空转——证明上面两条不是「到处都是同一色」）
        pixel:
          differ:
            - [ { x: 480, y: 156, as: "选区内" }, { x: 300, y: 200, as: "选区外 编辑器左缘外" }, { x: 420, y: 265, as: "选区外 选区下方空白" } ]
      - shot: 选中底色-light

  - name: 切到 eink 档（M291 起选中态是明度带 + 黑字：带内字形必须可辨，不能被自绘层吞掉）
    do: configWrite
    theme: eink
  - name: (eink) 重新打开 fixture
    do: open
    file: m285-bold.md
    marker: "选区的起点这一段"
  - name: (eink) 把光标放进第 1 行
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: (eink) 抢前台
    do: focusWindow
    retries: 4
  - name: (eink) ⌃⇧N 四次，同一条跨段选区
    do: keys
    keys: ["ctrl+shift+n", "ctrl+shift+n", "ctrl+shift+n", "ctrl+shift+n"]
    expect:
      - label: 选区覆盖粗体范围（显露为源码）
        editor: { has: "**粗体段**" }
  - name: (eink) 判底色与带内字形
    do: sleep
    ms: 600
    expect:
      - label: eink 选区内粗体段的底色 == 选区内普通文字的底色（同一选区带）
        pixel:
          same:
            - [ { x: 500, y: 201, as: "选区内 粗体段" }, { x: 480, y: 156, as: "选区内 第1行普通文字" } ]
      - label: eink 选区内是明度带、选区外是白底（两档必须可分辨）
        pixel:
          differ:
            - [ { x: 480, y: 156, as: "选区内（明度带）" }, { x: 300, y: 200, as: "选区外（白底）" } ]
      - label: eink 选区内粗体段仍有可辨字形（带与字同色会让这一条的亮度跨度塌到 0）
        pixel:
          contrast:
            - { x: 500, y: 201, as: "选区内 粗体段", min: 60 }
      - shot: 选中底色-eink
teardown:
  - label: 收尾：两组手势（light 与 eink）都没有改动 fixture 文件
    file: { path: m285-bold.md, unchangedSince: 手势前, mtimeUnchangedSince: 手势前 }
  - label: 收尾：粗体定界符仍在源码里（没有把手势当成编辑）
    file: { path: m285-bold.md, has: "/^\\*\\*粗体段\\*\\*/" }
---

# 选中跨粗体：选区底色由编辑器自绘（drawSelection）

## 这个场景验什么

**缺陷**（M273 survey 定位，全量报告 `test-results/m277/findings.md`）：编辑器此前没装 CM6 的
`drawSelection()`，可见选中高亮全靠浏览器**原生选区**。md 的 live preview 在 `mouseup` 解冻那一拍
重建强调段（`**粗体**` 显露）的 DOM，WKWebView 没有把重建出来的那段画进选中层 ⇒ 选中跨粗体时粗体段
出现一个「洞」（底色缺一块），而复制内容却是对的（复制走 CM 的 state）。

**修法**：`src/editor.ts` 给编辑器装上 `drawSelection()`——选区与光标改由 CM 自己的 state 画在
`.cm-selectionLayer` / `.cm-cursorLayer` 上。选区的可见几何从此由编辑器决定，不再依赖「原生选区的
绘制」与「装饰重建」谁先谁后。

## 为什么判据必须落在真机的像素层

- **AX 读不到选区**（README「已知边界」的「光标/选区不可断言」条）：KimiCU 不暴露
  `AXSelectedTextRange`，所以「哪一块文字被选中底色盖住」在 AX 层不可判。
- **chromium 的像素层对这条缺陷是假绿**（survey 实测 4 条交互路径 × 3 主题逐字符底色全绿）：无头
  引擎在装饰重建后会把原生选区重新同步到新建的文本节点，渲不出那个洞。chromium 侧因此只判**结构**
  （`.cm-selectionBackground` 的逐字符覆盖 = CM 选区，见
  `tests/visual/scenes/m285-selection-layer.spec.ts`），**本场景是这条缺陷唯一的真机判据**。
- 通道是 M285 新加的 `pixel` 断言（窗口截图取底色，见 README 的断言表）：判据以「同色 / 异色」两种
  **相对关系**为主、不写绝对色值（色值真源是 token 层，场景里再抄一份就是第二份真源）；eink 那条字形
  判据是 `contrast`（**绝对阈值**，判「这一块里真有可辨的字形」）——主色读数看不出字色，只有亮度跨度
  能判。

## 判据为什么这样写（区分度是实测钉的，不是推理）

| 判据 | 两轮实测 | 说明 |
|---|---|---|
| 第 1 行行尾空白 == 选区内文字处的底色 | 修前 **FAIL**（`#fdfdfd` / `#e8e8e0`，差 29）→ 修后 **PASS**（差 ≤2） | **本场景唯一的区分度判据**。跨段选区的**开放端**由 CM 自己的几何算出（`rectanglesForRange` 对未闭合的一侧取内容框内缘 ⇒ 整行涂到正文栏右缘），原生选区不涂这一块。它判的不是「某个洞」，而是**绘制来源**（本缺陷的根因） |
| 选区内粗体段的底色 == 选区内普通文字的底色 | 两轮都 PASS | 它是**缺陷的主体读数**（粗体段不许漏画），但在本通道上没有区分度：键盘建立的选区不触发 `mouseup` 那一拍装饰重建 ⇒ 修前那一段也是原生选区正常涂上的。如实登记：钉回归，不充当区分度证据 |
| 选区外底色 != 选区内底色 | 两轮都 PASS | 防空转：只判「同色」时，若某次运行里根本没建立选区（整屏同色），两条「同色」会双双假绿 |
| eink：选中字形的亮度跨度 ≥ 60 | 修前 203（**当时**是黑底白字） | 只判「带里真有可辨的字形」。M291 起 eink 的选中态是**明度带 + 黑字**（`--sel` = `#b9b9b9`、`--sel-text` = 正文色），本条读数随之降到 ≈185 量级，阈值不变；带与字同色时跨度仍会塌到 0 |
| eink：选区内是带、选区外是白底 | 修前 `#333333` / 修后 `#000000` 对外白底 | 顺带读到一处口径：原生选区在 eink 真机渲成 `#333333`，修后由 CM 画的是**恰好**当时的 token 值。**M291 后这一档的带是 `#b9b9b9`**，本条读数随之变化（判据形态不变：带 vs 白底须可辨） |

## 标定读数（2026-09-28，真机 WKWebView，1200×800 窗口）

采样点是**窗口局部坐标**（与 `click` / `drag` 的 `{x,y}` 同一空间）。fixture 由本场景自己写入，
窗口尺寸由套件锁死，因此这组坐标是常数；坐标漂了的直接信号是上面那条「选区覆盖粗体范围」判 FAIL
（不会静默空转）。

| 采样点 | 位置 | light 读数 | eink 读数 |
|---|---|---|---|
| (480, 156) | 选区内 第 1 行普通文字 | `#e9e7e3` | `#010101` |
| (500, 201) | 选区内 粗体段（第 2 段） | `#e9e8e3` | `#000000` |
| (900, 156) | 第 1 行行尾空白（选区开放端） | `#e9e7e2` | `#000000` |
| (300, 200) | 选区外 编辑器左缘外 | `#fdfdfd` | `#ffffff` |
| (420, 265) | 选区外 选区下方空白 | `#fdfdfd` | `#ffffff` |

- 同色组实测差 **1**（两档都是），异色组实测差 light **26** / eink **254** ⇒ 缺省容差（同 8 / 异 16）
  两侧都留了余量，不需要在场景里覆盖。
- eink 选区内粗体段的亮度跨度实测 **243**（黑底白字），阈值取 60。
- 证据：`test-results/acceptance/2026-09-28/m285-probe/{light,eink}-v3/`（标定用的探针现场）。

## 记录手势为什么用「点正文 + ⌃⇧N」而不是鼠标拖拽

`drag` 是缺陷的原始手势（Alex 报的就是拖拽），但**合成拖拽在这台机器上会污染文档**：M285 的三轮
探针里，同一条 `drag` 路径先（v1）把文档截断成 `…**粗体段wo`、后（v3）在文末追加了 `hao`——两次
都是拼音串（我/好），即环境里跑着中文输入法，合成鼠标事件触发了它的预编辑提交。真手拖拽不经过这条
通道，所以这不是产品缺陷、也不该由本场景的红来承担（已记进套件 README 的「已知边界」与
`docs/backlog.md` 的 M285 节）。

**因此本场景用「点正文把光标放进第 1 行 + ⌃⇧N 逐行扩选」建立同一条跨段选区**：判据是「选区可见范围
= 编辑器选区范围」，与手势无关；而两条判据（同色 / 行尾空白）都由 CM 的 state + 布局算出，换手势
不改变它们的区分度。

## 已知边界

- **不判手感**：选中底色的观感、行尾涂满这一块的视觉取舍归 Alex（本场景只钉「它是 CM 画的」，
  留了 light / eink 两张截图）。
- **⌘C 只记读数、不写断言**：本场景用 `do: clipboardRead` 把剪贴板读数写进证据。原因：真机上**键盘
  建立的选区不进 DOM 选区**（CM 的 `updateSelection` 只在 `focused` 或指针更新时写 DOM 选区），而
  ⌘C 是 WKWebView 的**原生**命令（`src/keys.ts` 里没有 ⌘C 绑定）——窗口不是 key window 时它拿不到
  命令，读到的就是上一个 app 的残留。两轮实测：pre-fix 轮「前台焦点：已取得」时可行、post-fix 轮
  前台未取得时读不到。这条是**环境/前台条件**，不是本场景要判的产品行为（套件 README 的「键盘场景的
  前台纪律」已记同族现场）。
- **不判鼠标路径的那一拍**（`mouseup` 解冻 → 装饰重建）：那正是缺陷的触发时序，但合成拖拽在本机
  不可用（见上）。真机时序这一层当前没有被场景覆盖，chromium 侧的 `m259` 场景覆盖按压窗口的几何
  不变量。**如实登记为覆盖缺口**。
- 屏幕上有系统级伪影（选区起点处会短暂出现一个蓝色插入点/拖拽光标，实测在采样点左侧 ≥13px），
  采样点避开了它；若某次运行它漂到采样点上，那一条会红——按截图复核即可。

## 修前 / 修后实测（两轮全量，`src/` 摘掉两处修复 = 修前）

| 轮次 | 结果 | 读数 |
|---|---|---|
| 修前 | **FAIL**（21 条里 1 条红） | 「第 1 行行尾空白 vs 选区内文字」→ `#fdfdfd` / `#e8e8e0`，差 29 > 容差 8 |
| 修后 | **PASS**（21/21） | 同一条读数 `#e9e7e2` / `#e9e7e3`，差 1 |

证据：`test-results/m285/{pre-fix,post-fix}/64-bold-selection-drawselection/`（`steps.md` + `shots/` +
`ax/` 全量）。
