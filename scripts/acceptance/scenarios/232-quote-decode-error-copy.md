---
# M686（change fix-quote-decode-error-copy-oct24）：引用语境解码失败的真机判据。
#   ① 选中一张字节损坏的 vault 图片的源码 → 摘录到对话 → toast 是 D588「无法解码这张图片」
#      （含「无法解码」、透传后端 reason），不含粘贴语境的「剪贴板」，也不与格式不支持的
#      D585 混用；输入区出现 D586 的持久状态行；composer 无图片卡片。
# 为什么走「选中源码」而不是悬停引用钮：坏图在预览里渲染成占位、没有 `<img>`，悬停钮结构性
# 不存在（见 tests/visual/scenes/m633-image-quote.spec.ts 的「占位不可引用」用例）；选区路径
# 照常按源码枚举 `![[…]]`，这正是用户引用坏图时唯一可达的入口。
# 覆盖边界（如实登记）：粘贴侧的解码失败在真机**不可注入**——剪贴板通道用 AppleScript 的
# «class PNGf» 置图只产合法 PNG。粘贴侧由单测锁定映射（tests/unit/error-text.test.ts 的
# 「粘贴侧锁定」用例），粘贴写入口与文案本 change 未改，回归归场景 112 / 127。
id: "232-quote-decode-error-copy"
item: 232
title: 引用坏图：解码失败读 D588（不含「剪贴板」）+ 持久状态行、零卡片
fixtures: [quote-decode-note.md, quote-decode-broken.png]
open: quote-decode-note.md
marker: "QDELTA"
steps:
  # 焦点前提与 222 同一条通道：真实鼠标单击正文建立 webview 焦点（悬停 / 键盘注入的前提）。
  - name: 把光标放进编辑器第 1 行（真实鼠标单击建立 webview 焦点）
    do: clickEditor
    real: true
    retries: 4
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }

  - name: 光标下移到第 5 行的坏图引用（第 1 行是标题、第 3 行是 QDELTA 段）
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]

  - name: ⌃⇧E 从行首扩选到行尾（选区覆盖整条 `![[…]]` 源码）
    do: keys
    keys: ["ctrl+shift+e"]
    expect:
      - label: 浮动摘录钮浮现（选区有效）
        ax: { has: "/AXButton \\(摘录到对话\\)/" }
      - shot: 01-选中坏图源码

  - name: 点「摘录到对话」→ 引用坏图，写入口解码失败
    do: click
    target: { role: AXButton, name: "摘录到对话" }

  # toast 是 transient（3.5s）：出现即断言（同场景 119 的取证口径）。
  - name: 等 D588 的解码失败 toast 出现
    do: waitFor
    waitFor:
      has: ["无法解码这张图片"]
    timeoutMs: 10000
    expect:
      - label: toast 是引用语境的解码失败文案（D588，含「无法解码」并透传后端 reason）
        ax: { has: "/无法解码这张图片：/" }
      - label: 不含粘贴语境的「剪贴板」限定词（M686 的根因就是它）
        ax: { not: "剪贴板" }
      - label: 不与格式不支持的 D585 混用
        ax: { not: "暂不支持引用该格式" }
      - label: 输入区出现持久状态行（D586：不是 3 秒 toast 能代替的那条）
        ax: { has: "/1 张图片未能引用/" }
      - label: composer 里没有该图的图片卡片（该张没进来）
        ax: { not: "/AXButton \\(插入图片引用\\)/" }
      - shot: 02-解码失败toast与状态行
---

# 232-quote-decode-error-copy —— 引用坏图的解码失败文案（M686）

## 本场景在验什么

change `fix-quote-decode-error-copy-oct24` 的唯一在验行为：**引用路径的解码失败**说引用语境的话。

坏图（vault 里一个扩展名是 `.png`、字节不是合法 PNG 的文件）经 `harness_write_image` 时命中
`attachment_decode_failed`。这个 code 与粘贴路径共用，但「剪贴板」三个字只在粘贴语境成立——
用户刚才根本没碰过剪贴板。本 change 按调用点分码：引用路径读 D588「无法解码这张图片：{reason}」，
粘贴路径（`ERROR_COPY`）仍是 D438「无法解码剪贴板图片：{reason}」，一字不动。

判据（与 design §D5 的区分度表一一对应）：

1. toast 含「无法解码这张图片：」——引用语境条目在场；
2. toast 不含「剪贴板」——若映射回落到 D438，这一条与上一条会同时红；
3. toast 不含「暂不支持引用该格式」——解码失败与格式不支持（D585）是两条失败面，不混用；
4. 输入区状态行「1 张图片未能引用」在场——失败留痕是持久态（D586），不是只有 toast；
5. composer 无图片卡片——该张没进 harness 存储，其余张（本场景只有一张）不受影响。

## 判据为什么这样写

- **走选区而不是悬停引用钮**：坏图渲染成占位（没有 `<img>`），悬停钮结构性不存在。选区路径按
  源码枚举 `![[…]]`，是用户引用坏图时唯一可达的入口，也是本 change 的真实现场。
- **断言到「：」为止，不锁后端 reason 原文**：`{reason}` 是 `image` crate 的解码错误串（英文、
  随版本可能变），锁它等于把实现细节钉进判据；「透传」这一点由单测
  （`tests/unit/quote-image.test.ts` 的「引用一张字节损坏的位图」）逐字锁定。
- **负向断言「不含剪贴板」的区分度**：实现若退回 D438，正向断言与它同时红；若映射丢了（回落
  后端 message），toast 是「无法解码剪贴板图片：…」的 Rust message，同样红——三种错法都逃不掉。
- **覆盖边界（如实登记）**：粘贴侧的解码失败**不再真机验**——剪贴板只能经 AppleScript 的
  `«class PNGf»` 置图，只产合法 PNG，造不出「格式是 png、字节解不开」的现场。粘贴侧由单测
  （`tests/unit/error-text.test.ts`）锁定 D438 映射；粘贴写入口与文案本 change 未改，回归由
  场景 112 / 127 承担，MUST NOT 声称两侧都做了真机验证（REVIEW.md「覆盖声明超出真实验证」条）。
