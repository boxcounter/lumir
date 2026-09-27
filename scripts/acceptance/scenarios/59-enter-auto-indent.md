---
id: "59-enter-auto-indent"
item: 59
title: Enter 换行自动缩进的真机链路——code 模式继承语法缩进、无缩进规则的语言沿用当前行、md 围栏内沿用当前行且不续列表标记、md 列表续行不变、auto_indent=false 回退
fixtures: [enter-indent.js, enter-indent-off.js, enter-indent.toml, enter-indent.md, enter-indent-list.md, enter-indent-fence.md]
open: enter-indent.js
marker: "const alpha"
steps:
  # 用例 1：code 模式 · 有缩进规则的语言（语法缩进）
  - name: 起点：js fixture 进 vault、打开且光标落在第 1 行（`const alpha = () => {`）
    do: clickEditor
    expect:
      - label: 打开成功，渲染态可读
        editor: { has: "const alpha = () => {" }
      - label: 起点没有「只含两个空格」的行（下面那条 `/^  $/` 因此有区分度，不是恒真）
        file: { path: enter-indent.js, not: '/^  $/' }
      - shot: 起点
  - name: 光标移到第 1 行行尾（⌃E 是 editor 作用域绑定；落点由下一步的 Enter 结果反证）
    do: key
    key: "ctrl+e"
  - name: 按 Enter（第 1 行以 `{` 结尾 ⇒ 语法缩进应给 2 空格）
    do: key
    key: "return"
  - name: 等自动保存落盘（2s 防抖，刻意不用 ⌘S）
    do: sleep
    ms: 2600
    expect:
      - label: 源文件出现「只有两个空格」的新行 —— 语法缩进落地的唯一正判据
        file: { path: enter-indent.js, has: '/^  $/' }
      - label: 触发那一行逐字节未动
        file: { path: enter-indent.js, has: '/^const alpha = \(\) => \{$/' }
      - shot: code-模式-语法缩进

  # 用例 2：code 模式 · 无缩进规则的语言（沿用当前行行首空白）
  - name: 打开 toml fixture（第 3 行 `  [tool]` 带两空格，toml 没有缩进规则）
    do: open
    file: enter-indent.toml
    marker: "root = true"
  - name: 建立编辑器焦点（点编辑器顶边；键盘注入的前置）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 光标移到第 3 行行尾
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+e"]
  - name: 按 Enter
    do: key
    key: "return"
  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: 新行沿用该行的两个空格（不是行首、也不是凭空一层）
        file: { path: enter-indent.toml, has: '/^  $/' }
      - label: 原行逐字节未动
        file: { path: enter-indent.toml, has: '/^  \[tool\]$/' }
      - shot: toml-沿用当前行

  # 用例 3：md 正文段落 · 平换行（与现状一致）
  - name: 打开 md fixture（光标点顶边后落在第 1 行 = 标题行）
    do: open
    file: enter-indent.md
    marker: "enter indent"
  - name: 建立编辑器焦点
    do: clickEditor
  - name: 光标移到第 3 行（普通段落）行尾
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+e"]
  - name: 记录 md fixture 的文件基线（Enter 有没有落地的正观测走**磁盘**）
    # 为什么不用 `recordEditor` 立即读编辑器：Enter 是盲发注入（丢键不重试），而落盘要经 2s
    # 防抖——磁盘判据与后面的负向断言在同一条时间线上（都等 2.6s），比「按完立刻读 AX」稳。
    # 代价如实登记：这条正观测不区分「光标在第 3 行」与「光标仍在第 1 行」（两处按 Enter 的结果
    # 都是平换行），落点由本场景的第一步（`clickEditor` 落在第 1 行）与 `ctrl+n` 的次数共同约束。
    do: record
    as: md基线
    file: enter-indent.md
  - name: 按 Enter
    do: key
    key: "return"
  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: 正观测：Enter 确实落地（文件被写过）——「不缩进」这类负向断言必须配它，否则丢键会假绿
        file: { path: enter-indent.md, changedSince: md基线 }
      - label: 没有凭空加缩进（全文没有只含空白的行）
        file: { path: enter-indent.md, not: '/^ +$/' }
      - shot: md-段落-平换行

  # 用例 4：md 列表续行 · 与 change 之前逐字节一致（上游既有行为，本 change 委派）
  - name: 打开列表 fixture
    do: open
    file: enter-indent-list.md
    marker: "alpha"
  - name: 建立编辑器焦点
    do: clickEditor
  - name: 光标移到 `- alpha` 行尾（第 3 行）
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+e"]
  - name: 按 Enter
    do: key
    key: "return"
  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: 续写同级标记（`- ` 行出现）—— 上游续行未被本 change 打断的唯一判据
        file: { path: enter-indent-list.md, has: '/^- $/' }
      - label: 原项逐字节未动
        file: { path: enter-indent-list.md, has: '/^- alpha$/' }
      - shot: md-列表-续行不变

  # 用例 5：md 围栏代码块内 · 沿用当前行缩进，且不把它当列表
  - name: 打开围栏 fixture
    do: open
    file: enter-indent-fence.md
    marker: "gamma"
  - name: 建立编辑器焦点
    do: clickEditor
  - name: 光标移动到块内那一行（第 4 行）行尾
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+e"]
  - name: 按 Enter
    do: key
    key: "return"
  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: 新行沿用块内该行的两个空格
        file: { path: enter-indent-fence.md, has: '/^  $/' }
      - label: 围栏内的代码文本行逐字节未动
        file: { path: enter-indent-fence.md, has: '/^  beta\(\);$/' }
      - shot: md-围栏内-沿用缩进

  # 用例 6：auto_indent = false ⇒ 只回退本 change 新增的两处（D5a）
  - name: 记下列表 fixture 当前落盘状态（用例 4 之后它已含一个 `- ` 行；基线用于 6a 的 changedSince）
    do: record
    as: 列表基线
    file: enter-indent-list.md
  - name: 配置写入 `editor.auto_indent = false` 并重启
    do: configWrite
    autoIndent: false
  - name: 重开列表 fixture
    do: open
    file: enter-indent-list.md
    marker: "alpha"
  - name: 建立编辑器焦点
    do: clickEditor
  - name: 光标移到 `- alpha` 行尾
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+e"]
  - name: 按 Enter
    do: key
    key: "return"
  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: 正观测：文件又变了（Enter 落地）
        file: { path: enter-indent-list.md, changedSince: 列表基线 }
      - label: 列表续行照旧 —— 本键 MUST NOT 把上游的续行一起关掉（D5a 的显式不对称）
        file: { path: enter-indent-list.md, has: '/^- $/' }
      - shot: 关配置-md-列表仍续行

  # 6b：code 模式的自动缩进回退（关配置后 Enter 落回浏览器默认 = 裸换行）
  # **刻意用一份没被前面的用例碰过的 fixture**（`enter-indent-off.js`）：用例 1 已经在
  # `enter-indent.js` 里留下一行「恰好两个空格」，拿同一个文件判 `not: '/^  $/'` 会恒红
  # ——负向断言的现场必须是干净的起点（断言对象被自己前面的步骤污染过），这是写本场景时
  # 第一版踩到的坑，如实留在这里。
  - name: 打开未被前面用例碰过的 js fixture（光标点顶边后落在第 1 行）
    do: open
    # marker 会被 `lib/drive.mjs` 的 openFile 用 `new RegExp(marker)` 编译：写 `()` 时它被当成
    # **空捕获组**，模式实际是「const gamma =  => {」（`()` 位置变成两个空格）⇒ 永远匹配不上
    # （M272 实测：这一条把 `open` 拖成 60s 超时，而文件其实已经打开）。只取不含正则元字符的子串。
    file: enter-indent-off.js
    marker: "const gamma"
  - name: 建立编辑器焦点
    do: clickEditor
    expect:
      - label: 起点干净：这份 fixture 里没有「只含两个空格」的行（下面那条负向断言因此有区分度）
        file: { path: enter-indent-off.js, not: '/^  $/' }
  - name: 记录文件基线（同用例 3：正观测走磁盘）
    do: record
    as: 关配置基线
    file: enter-indent-off.js
  - name: 光标到行尾后按 Enter
    do: keys
    keys: ["ctrl+e", "return"]
  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: 正观测：Enter 确实落地（文件被写过）——丢键时这条会红，而不是让下面那条负向断言空过
        file: { path: enter-indent-off.js, changedSince: 关配置基线 }
      - label: 没有缩进行 ⇒ code 模式回到本 change 之前的行为
        file: { path: enter-indent-off.js, not: '/^  $/' }
      - label: 配对对照：同一个能力**开着**配置时是会缩进的（用例 1 的 fixture 里有那一行）
        file: { path: enter-indent.js, has: '/^  $/' }
      - shot: 关闭配置-回退
teardown:
  - label: 收尾：js fixture 里那两行 `const alpha = () => {` 与 `  return alpha;` 仍在
    file: { path: enter-indent.js, has: '/^const alpha = \(\) => \{$/' }
  - label: 收尾：md 列表 fixture 仍以 `- alpha` 起头（用例 4/6a 各续了一行 `- `）
    file: { path: enter-indent-list.md, has: '/^- alpha$/' }
---
# Enter 换行自动缩进（M272，change `enter-auto-indent`）

Alex 原话（2026-09-27）：「在代码中敲 Enter 键换行后，光标固定停在行首，而没有根据语法结构自动
缩进。这个你有什么看法和建议？」

## 这个场景验什么

`Enter` 在**两处新接管的上下文**里自动缩进，并**不动**上游已经工作的那一处：

| 上下文 | 本 change 之后 | 真机判据 |
|---|---|---|
| code 模式 · 有缩进规则的语言（`.js`） | 新行取语法缩进（两空格） | 落盘文件出现 `/^  $/` 行 |
| code 模式 · 无缩进规则的语言（`.toml`） | 沿用光标所在行的行首空白 | 落盘文件出现 `/^  $/` 行（原行 `  [tool]` 未动） |
| md 围栏代码块内 | 沿用块内该行的行首空白，且**不**续写列表标记 | 落盘文件出现 `/^  $/` 行 + `  beta();` 未动 |
| md 正文段落 | 平换行（与变更前一致） | 文档变了（正观测）+ 全文没有只含空白的行 |
| md 列表项 | 续写 `- `（**上游既有行为**，本 change 委派、一条不动） | 落盘文件出现 `/^- $/` + `- alpha` 未动 |
| `editor.auto_indent = false` | code 模式回到裸换行；列表续行**不受影响** | 关配置后 js 无 `/^  $/` 行、列表仍出现 `/^- $/` |

三条口径的来源与实测表见 `openspec/changes/enter-auto-indent/design.md` 的 §4（本场景的五个
fixture 与那批探针逐条同源）。判定层（判定函数本体、委派上游、关配置不接管）由
`tests/unit/enter-indent.test.ts` 覆盖；键位链路（`Prec.highest` 的优先级、上游键位让位、
`Shift-Enter` 不命中、配置经 `src/main.ts` 的消费点到达编辑器）由 chromium 场景
`tests/visual/scenes/m264-enter-auto-indent.spec.ts` 覆盖；本场景管**真机 WKWebView 的按键 →
落盘闭环**、自动保存时序，以及 `configWrite` 重启后的回退。

## 判据的写法纪律（两条本能力特有的坑）

1. **见证字符不许放在触发行**（design §4.1 实测）：本套件钉落点的惯例是「键入一个见证字符并回读」，
   但这一步会改变语法上下文——`const alpha = () => {` 后append `q` 会让缩进规则不再触发
   （实测 `getIndentation` 从 2 变 0）。因此本场景的正观测改用
   **`file: { has: '/^  $/' }`（落盘内容）+ `editor.changedSince`**，不键入任何见证字符。
2. **负向断言一律配正观测**（REVIEW.md 第 2 条）：`Enter` 是 chord 类盲发注入（丢键时不重试），
   所以「文档没有缩进行」这类断言必须与 `editor: { changedSince: 基线 }` / `file.changedSince`
   同时出现——否则丢键会让整条用例静默变绿。用例 3 与 6b 的「无缩进」判据都按这条写。

## 已知边界（如实登记）

- **围栏内没有语法级缩进**（裁决 D3a）：围栏内容在编辑器语法树里是 `CodeText`，没有子语言
  （`markdownConfig` 未传 `codeLanguages`），`getIndentation` 返回 null ⇒ 只能沿用当前行空白。
  这是**真实的能力缺口**，不是漏测。
- **`Shift-Enter` 与 `Enter` 从此不同**（code 模式）：本 change 只收 `Enter`，`Shift-Enter` 维持裸换行
  ——既是「要一个不缩进的裸换行」的逃生口，也是知情的不对称。两键的差由 chromium 场景覆盖
  （真机侧注入 `Shift+Enter` 的通道未被本场景使用）。
- **一次撤销一步**、只读会话不产生文档变更：由 chromium 场景断言（真机侧无法可靠注入 ⌘Z 语义的
  判定链）。
- **手感/审美不下沉**：缩进观感、光标落点在视觉上的稳定性归 Alex 目视，本场景只留截图证据。
