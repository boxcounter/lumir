---
# M863（change fix-list-enter-indent-nov21）：Alex 原始缺陷「段首输入 `- ` 后，下一行缩进」。
# 修前现场（只读复现报告 .local/reports/list-enter-indent-nov21 的矩阵第 7/12 行）：
#   - `alpha\n  + ` 空项退出后该行留 `  `（前导 2），随后键入的字符把空格当可见字符渲染；
#   - `alpha\n  - `（setext 下线）按 Enter 后新行是 `  `——md 没有缩进规则，
#     `insertNewlineAndIndent` 在回落里照抄当前行行首空白。
# 合同：落回裸换行（新行无行首空白、光标列 0）；围栏 / 缩进代码块内仍沿用行首空白。
# 本场景只判落盘源码；行文本左缘的几何归 chromium 场景 lists.spec.ts。
# 对照（MUST NOT 被本修复改动）：`- a\n  text` 的项内段落续行与 `alpha\n  * a` 的真列表项
# 走上游续行命令，缩进是结构——见场景 59 的列表续行用例与 chromium 对照断言。
id: "269-list-enter-indent"
item: 269
tier: full
title: 段首 marker / setext 下线后 Enter 的下一行不带无意义行首缩进（修前留 `  ` 空行）
fixtures: [enter-indent-bare.md, enter-indent-setext.md]
open: enter-indent-bare.md
marker: "ordinary paragraph"
steps:
  # 用例 1：裸空项 `alpha\n  + ` —— 修前留 `  `，修后该行变空行
  - name: 起点：裸空项 fixture 打开且没有纯空白行（下面 not 判据的区分度前提）
    do: clickEditor
    expect:
      - label: 起点干净：fixture 里没有只含空白的行
        file: { path: enter-indent-bare.md, not: '/^ +$/' }
      - label: 起点：`alpha` 行在
        file: { path: enter-indent-bare.md, has: '/^alpha$/' }
      - shot: 起点-裸空项
  - name: 光标移到第 2 行（`  + `）行尾
    do: keys
    keys: ["ctrl+n", "ctrl+e"]
  - name: 记录落盘基线（Enter 有没有落地的正观测走磁盘）
    do: record
    as: 裸空项基线
    file: enter-indent-bare.md
  - name: 按 Enter（裸空项退出：marker 与无意义缩进一并删去）
    do: key
    key: "return"
  - name: 按 ⌘S 落盘（⌘S 发两次换一次丢键的容错）
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对
    do: sleep
    ms: 1200
    expect:
      - label: 正观测：Enter 确实落地（文件被写过）——丢键时这条先红，负向断言不会空过
        file: { path: enter-indent-bare.md, changedSince: 裸空项基线 }
      - label: 修后：没有只含空白的行（修前这里正是 `  `）
        file: { path: enter-indent-bare.md, not: '/^ +$/' }
      - label: 原文段落逐字节未动
        file: { path: enter-indent-bare.md, has: '/^ordinary paragraph$/' }
      - shot: 裸空项-退出后无缩进

  # 用例 2：setext 下线 `alpha\n  - ` —— 修前新行 `  `，修后新行为空
  - name: 打开 setext fixture
    do: open
    file: enter-indent-setext.md
    marker: "ordinary paragraph"
  - name: 建立编辑器焦点
    do: clickEditor
    expect:
      - label: 起点干净：fixture 里没有只含空白的行
        file: { path: enter-indent-setext.md, not: '/^ +$/' }
      - label: 起点：setext 下线行逐字节在
        file: { path: enter-indent-setext.md, has: '/^  - $/' }
  - name: 光标移到第 2 行（`  - `）行尾
    do: keys
    keys: ["ctrl+n", "ctrl+e"]
  - name: 记录落盘基线
    do: record
    as: setext基线
    file: enter-indent-setext.md
  - name: 按 Enter（setext 下线之后：裸换行，不照抄 `  `）
    do: key
    key: "return"
  - name: 按 ⌘S 落盘（⌘S 发两次换一次丢键的容错）
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对
    do: sleep
    ms: 1200
    expect:
      - label: 正观测：Enter 确实落地（文件被写过）
        file: { path: enter-indent-setext.md, changedSince: setext基线 }
      - label: 修后：没有只含空白的行（修前这里正是 `  `）
        file: { path: enter-indent-setext.md, not: '/^ +$/' }
      - label: setext 下线行逐字节未动
        file: { path: enter-indent-setext.md, has: '/^  - $/' }
      - label: 原文段落逐字节未动
        file: { path: enter-indent-setext.md, has: '/^ordinary paragraph$/' }
      - shot: setext-下线后无缩进
teardown:
  - label: 收尾：裸空项 fixture 的原文段落仍在
    file: { path: enter-indent-bare.md, has: '/^ordinary paragraph$/' }
  - label: 收尾：setext fixture 的原文段落仍在
    file: { path: enter-indent-setext.md, has: '/^ordinary paragraph$/' }
---
# 段首 marker / setext 下线后 Enter 的下一行缩进（M863，change `fix-list-enter-indent-nov21`）

Alex 原话：「段首输入 `- ` 后，下一行缩进」。

## 这个场景验什么

| 起始文档 | 修前 | 修后 | 真机判据 |
|---|---|---|---|
| `alpha\n  + `（裸空项） | `alpha\n  `（前导 2、光标列 2） | `alpha\n`（光标列 0） | 落盘全文没有 `/^ +$/` 行 + `changedSince` |
| `alpha\n  - `（setext 下线） | `alpha\n  - \n  ` | `alpha\n  - \n` | 同上 + 原两行逐字节未动 |

修复面只有 md 的**回落**（上游续行命令不接管的行）。`- a\n  text`（项内段落续行）与
`alpha\n  * a`（能打断段落的真列表项）走上游续行命令，缩进是列表项正文列——场景 59 的
列表续行用例与 chromium 场景 `tests/visual/scenes/lists.spec.ts` 的对照断言钉住它们不变。

## 判据的写法纪律

1. **负向断言配正观测**：`/^ +$/` 的 `not` 必须与 `file.changedSince` 同时出现——Enter 是
   盲发注入，丢键时「没有空白行」会静默变绿（REVIEW.md「读不到当成空」条）。
2. **起点必须干净**：fixture 本身不得含空白行，否则 `not` 判据没有区分度（用例 1/2 的起点
   断言都先核这一条）。
3. **不键入见证字符**：本场景判的是 Enter 之后的**源码形态**，键入会改变上下文；行文本左缘
   的几何判据归 chromium 场景（真机 AX 不暴露行级几何，见套件 README「已知边界」）。

## 已知边界

- 光标落点（列 0）在真机只由落盘全文与 `not` 判据间接约束；精确列号归单测
  `tests/unit/enter-indent.test.ts`（断言 `cursor` 绝对位）。
- 围栏 / 缩进代码块的「沿用当前行行首空白」不在本场景内：由场景 59 用例 5 与单测钉住。
