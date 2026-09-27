---
id: "53-bold-click-selection"
item: 53
title: 点击粗体不产生幻影选区（M259）——指针按压期间的落点判定不跨布局
steps:
  - name: 造 fixture（场景自建，不动 fixtures 目录）
    do: vaultWrite
    file: bold-click.md
    content: |
      点击粗体之前这一行是普通文本。

      **abcdefghijklmnopqrst**
    expect:
      - label: fixture 已落盘（读不到一律 FAIL，不允许在空值上比较）
        file: { path: bold-click.md, exists: true }
      - label: 起点：粗体行是 20 个小写字母（下面「插入一个字符」的正向判据就靠这个长度）
        file: { path: bold-click.md, has: "/^\\*\\*[a-z]{20}\\*\\*$/" }
      - shot: fixture

  - name: 等一拍再读（外部写入后立刻读 AX 会与 DOM 刷新抢）
    do: sleep
    ms: 1200

  - name: 打开 fixture（点左栏树行）
    do: open
    file: bold-click.md
    marker: "普通文本"
    expect:
      - label: 渲染态：粗体的 `**` 不出现（起点必须是渲染态，否则按压不会引起布局位移、这条场景就空转了）
        editor: { not: "**" }
      - label: 文档末行可读（正向锚点：本次 AX 读取是活的）
        editor: { has: "abcdefghijklmnopqrst" }
      - shot: 渲染态起点

  - name: 记录文件基线（无操作类断言比 sha256 + mtime）
    do: record
    as: 基线
    file: bold-click.md

  - name: 在粗体文字上按下并按 1px 位移（= 一次带指针抖动的点击；套件的 click 发不出按压中的 mousemove）
    do: drag
    target: { x: 430, y: 200 }
    dx: 1
    expect:
      - label: 落点确实进了粗体范围——源码显露（没进范围这条场景就空转了，如实判 FAIL 而不是继续跑）
        editor: { has: "**abcdefghijklmnopqrst**" }
      - label: 按压期间文档逐字节不变（ADR 0003 §3：装饰层不改文档）
        file: { path: bold-click.md, unchangedSince: 基线, mtimeUnchangedSince: 基线 }
      - shot: 点击后

  - name: 键入见证字符 0（`keys` 走回读 + 只在字节未变时重试）
    do: keys
    keys: ["0"]
    expect:
      - label: 见证字符已落地（它在粗体范围里，源码此刻是显露态）
        editor: { has: "0" }

  - name: 按 ⌘S 落盘（⌘S 发两次换一次丢键的容错）
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对落点
    do: sleep
    ms: 1200
    expect:
      - label: 见证字符落在**点击坐标对应的位置上**（e 与 f 之间：插入成 `abcde0f…` 或替换掉 f 成 `abcde0…`，两种都算落点正确）
        file: { path: bold-click.md, has: "/^\\*\\*abcde0/" }
      - label: 反向：落点前移一个字符（`abcd0…` = 布局位移把同一坐标映射到靠前字符的签名）不存在——这一对互为区分度对照
        file: { path: bold-click.md, not: "/^\\*\\*abcd0/" }
      - label: 粗体行仍是 20 或 21 个字符位（至多被一次点击抖动的原生语义消费 1 个字符）
        file: { path: bold-click.md, has: "/^\\*\\*[a-z0-9]{20,21}\\*\\*$/" }
      - label: 普通文本那一行逐字节未动（只动粗体行）
        file: { path: bold-click.md, has: "/^点击粗体之前这一行是普通文本。$/" }
      - shot: 见证字符落点

  - name: 记下点击后的文件基线（下一步的「点击不消费字符」判据比它）
    do: record
    as: 点击后基线
    file: bold-click.md

  - name: 同一处**不带位移**点一下（= Alex 报告的那一次单击：不带抖动的点击不应产生任何选区）
    do: click
    target: { x: 430, y: 200 }
    expect:
      - label: 源码仍显露（落点仍在粗体范围里）
        editor: { has: "**" }
      - label: 无位移的点击不改文档（sha256 + mtime 双比）
        file: { path: bold-click.md, unchangedSince: 点击后基线, mtimeUnchangedSince: 点击后基线 }
      - shot: 无位移点击后

  - name: 键入第二个见证字符
    do: keys
    keys: ["9"]
    expect:
      - label: 第二个见证字符已落地
        editor: { has: "9" }

  - name: 按 ⌘S 落盘（⌘S 发两次换一次丢键的容错）
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对字符位
    do: sleep
    ms: 1200
    expect:
      - label: 无位移的点击 + 一次键入 = 纯插入：字符位比上一步多 1（21 或 22）
        file: { path: bold-click.md, has: "/^\\*\\*[a-z0-9]{21,22}\\*\\*$/" }
      - label: 反向：点击若消费过字符，位数会卡在上一档（20 或 21 中的较低者）——19/20 位不存在
        file: { path: bold-click.md, not: "/^\\*\\*[a-z0-9]{19,20}\\*\\*$/" }
      - label: 前一步的落点前缀未被吃掉（无位移的点击没有把见证字符卷进选区）
        file: { path: bold-click.md, has: "/^\\*\\*abcde0/" }
      - shot: 第二次点击后
teardown:
  - label: 收尾：粗体行停在「两次点击 + 两次键入」的形态（21 或 22 个字符位，含 0 与 9）
    file: { path: bold-click.md, has: "/^\\*\\*[a-z0-9]{21,22}\\*\\*$/" }
  - label: 收尾：普通文本那一行从未被写过
    file: { path: bold-click.md, has: "/^点击粗体之前这一行是普通文本。$/" }
---

# 点击粗体不产生幻影选区（M259）

Alex 原话：「点击 markdown 文本中的粗体后，容易选中部份，如 Image 4（我猜测这是因为粗体会进入
编辑阶段，会瞬间出现额外的文字（出现额外星号 `*` 字符））。」截图现场：点击 **pnpm** 后字母 p 被选中。

## 这个场景验什么

**缺陷机理**（chromium 层已实证，见 `tests/visual/scenes/m259-bold-click-selection.spec.ts`）：显露一落地
就改变布局——被隐藏的 `**` 重新占宽（实测 ≈12px）。CM 的鼠标选区在**按下**时按渲染态布局算一次落点，
之后每次指针移动又按**当时的布局**重算一次（`basicMouseSelection.get` 比对 `start.pos` / `cur.pos`）；
两次之间布局位移，同一屏幕坐标便映射到靠前 1–2 个字符的位置，两个落点被当成一次拖拽 ⇒ 选中 1–2 个字符。
12px 位移下这不是偶发：指针抖动 1px 就足以跨过字符边界。

**修法**（M259）：按压期间把显露判定用的选区冻成「按下瞬间的快照」，布局因此从按下到抬起不动、
落点判定自始至终在同一份布局里做；抬起后解冻，显露照常跟随（只是推到 `mouseup` 落地）。实现见
`src/preview/reveal-gate.ts`。

**判据链条**（用「键入见证字符后读落盘文件」把「有没有选区」变成可读事实）。fixture 的粗体行是
20 个小写字母：见证字符 `0` 必须落在**点击坐标对应的那个位置**（`e` 与 `f` 之间），落盘形态因此是

| 情形 | 见证字符的后果 | 粗体行前缀 | 本场景的断言 |
|---|---|---|---|
| 无选区（正确） | 插入 | `**abcde0f…` | `/^\*\*abcde0/` 通过 |
| 原生抖动语义的 1 字符选区（正确） | 替换掉 `f` | `**abcde0…` | 同上（两种都算落点正确） |
| 布局位移把落点前移（缺陷） | 落在 `e` 上 | `**abcd0f…` | `/^\*\*abcd0/` 判红 |

**为什么判「落点位置」而不是「有没有选区」**：CM 的鼠标选区取「落点最近边界」语义——指针在按下与
抬起之间移动 1px，若跨过某个字符的中线就会选中那一个字符。这与布局位移无关，是点击抖动的原生后果
（同一支探针在**无强调范围的普通文本**上同样消费 1 个字符）。所以「零选区」在带抖动的通道上不是一个
可判的期望值；可判的是**落点**：布局不动时，见证字符必然落在点击坐标对应的位置；布局动了（缺陷），
同一坐标被映射到靠前 1 个字符的位置，见证字符就前移一格。

**修前修后实测**（同一场景、同一坐标，真机 WKWebView，1440 端口隔离）：

| src | 结果 | 落点读数 |
|---|---|---|
| master（修前） | **FAIL** | `**abcd0fghijklmnopqrst**` —— 前移 1 个字符 |
| 本分支（修后） | **PASS** | `**abcde0ghijklmnopqrst**` —— 点击坐标处 |

证据（git 外）：`test-results/m259/53-before-fix/`、`test-results/m259/53-after-fix/`（两轮的
ax/steps/shots 全量）与同目录两份 run.log。**第一版判据（字符位数）修前也 PASS——那是一条假绿**：
WKWebView 里 `**` 的显宽与粗体回退的净位移只相当于 1 个字符（chromium 上是 2 个），位数落不出
区分度；改用 1 个字符分辨率的落点判据才有区分度（REVIEW.md 第 1 条）。

## 判据走哪几条通道

| 要判的东西 | 通道 | 为什么不是别的 |
|---|---|---|
| 有没有选区 | **键入见证字符后读落盘文件**（长度形态） | 套件读不到选区（README「已知边界」：AX 读不到选区）。落盘文件是唯一能区分「插入」与「替换」的可读事实 |
| 落点是否进了粗体范围 | **编辑器的 AX 文本里出现 `**`** | 显露出源码是「光标落在范围内」的直接后果（M168）。没进范围这条会红——避免后面的断言在空转 |
| 按压是否改文档 | **文件 sha256 + mtime 双比** | 装饰层 MUST NOT 改写文档（ADR 0003 §3） |
| 布局是否真的动了 | 不在本场景（真机读不到坐标） | 归 chromium：`tests/visual/scenes/m259-bold-click-selection.spec.ts` 断言同坐标映射在按下前后逐值不变 |

## 为什么既有 `drag {dx: 1}` 也有 `click`

两条都在，缺一不可：

- **`drag {dx: 1}`**：缺陷**只在按压期间发生指针移动时**才出现（没有移动 ⇒ CM 不会重算落点 ⇒ 无幻影），
  而套件的 `click`（含坐标路径）发不出「按住期间的 mousemove」。`drag` 是套件里唯一能在按住期间注入
  移动的动作（CGEvent `leftMouseDown → 插值 dragged ×N → leftMouseUp`，M228 起的通道）；`dx: 1` 是
  点击抖动量级（真机指针按下时的自然位移），不是拖拽。这一步是**缺陷的复现路径**。
- **`click {x,y}`**：Alex 报告的是「点击」，不带抖动的单击是它的干净形态。这一步验**无位移 ⇒ 无选区**
  （`click` 不注入按压期间的移动）——它是缺陷的**用户形态**，也是「零选区」这条更窄的断言唯一能成立的地方。

## 坐标的来历

`target: {x: 430, y: 200}` 是**窗口局部坐标**（窗口 1200×800 由套件起实例时指定）。粗体行的位置由本场景
自己写的 fixture 决定（第 3 行），窗口尺寸与字体固定 ⇒ 坐标确定。落点是否命中的**直接判据**是
「按压后编辑器里出现 `**`」（上表第 2 行）——坐标漂了就红在那一条上，不会静默空转。

标定读数（2026-09-27 本地真机，`test-results/acceptance/2026-09-27/53-bold-click-selection/shots/02-渲染态起点.jpeg`，
截图 1152×768 = 窗口 1200×800 的 0.96 缩放）：粗体文本在截图里 x∈[367,517]、行中线 y≈193，
换算成窗口坐标 x∈[383,538]、y≈200。落点取 x=430（粗体文本内第 7 个字符附近）、y=200（行中线）。
**窗口尺寸一变这组数字就失效**——套件锁死 1200×800，所以它是常数；断言链里第一步就是「落点是否进了范围」。

## 已知边界

- **0 与 9 两个见证字符会留在 fixture 里**（验收 vault 每次运行都从 fixtures/ 重置，且本场景的收尾断言按
  含 `0`/`9` 的形态写）。
- **不判手感**：点击后光标跳到哪一列、显露出源码的观感归 Alex，本场景只留截图证据。
- **`click` 那一步落在「已显露态」里**：`drag` 那一步之后光标已在粗体范围内，`**` 已经占宽——它验的是
  「已显露态下的无位移点击不消费字符」，与第一步（渲染态 → 按压 → 显露）互补。两条合起来覆盖
  「渲染态点击」与「显露态点击」两种起点。
- **`keys: ["0"]` / `["9"]` 走回读 + 有限重试**（README 的键盘注入纪律）：若丢键，`editor: {has: "0"}`
  那一条会红——按 REVIEW.md 第 11 条先复跑一次再判产品缺陷。
