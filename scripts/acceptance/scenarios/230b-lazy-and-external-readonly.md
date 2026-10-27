---
# change quick-open-file-oct23（M655）真机判据的第 2 组（M747 拆分）：**索引外惰性文件 + vault 外只读**。
# 背景与拆分口径见 230a 的头注释（每组自带启动状态与 fixture、断言逐条保留、判据一条不放宽）。
# 其余两组：230a（路径形态）/ 230c（重启与焦点作用域）。`run.mjs 230` 按 id 前缀选中三组。
#
# 为什么这条判据只能在真机层：
#   1. `⌘S` 在只读会话上**无落点**的判据是「文件字节未变 + 没有保存失败提示」——前者读磁盘、
#      后者读 AX，chromium 桩造不出「真写盘」的对照。
#   2. 「索引外的惰性文件按精确路径可打开」依赖真实 watcher 与存在探测两条异步链路（`dist` 是
#      默认 lazy 档：盘上有、索引里没有），桩造不出这个现场。
#
# 本组不覆盖（如实登记在正文「覆盖边界」）：只读标签的锁形图标形态（视觉层）、「每会话一次」的
# 提示条计数（chromium 层）、Rust 侧读取拒绝矩阵（cargo test）。
id: "230b-lazy-and-external-readonly"
item: 655
tier: full
title: 按路径快速打开（⌘P）之二：索引外惰性文件按精确路径打开 / vault 外只读打开（⌘S 不写盘、键入不生效）/ 外部路径不存在按找不到处置
open: goto-line-long.md
marker: "JUMP-TARGET-39"
config:
  harness:
    provider: mock
steps:
  - name: 造一个惰性文件（dist 是默认 lazy 档：盘上有、索引里没有）
    do: vaultWrite
    file: dist/quickopen-lazy.md
    content: "# 惰性文件\n\nLAZY-655-MARKER\n"
  - name: 等惰性行出现在树里（子树不进枚举）
    do: waitFor
    waitFor:
      has: ["dist"]
    timeoutMs: 15000
  - name: 按精确路径打开惰性文件（⌘P）
    do: keys
    keys: ["cmd+p"]
  - name: 输入惰性文件的精确路径
    do: keys
    keys: ["d", "i", "s", "t", "/", "q", "u", "i", "c", "k", "o", "p", "e", "n", "-", "l", "a", "z", "y", ".", "m", "d"]
    expect:
      - label: 路径落进输入框（逐键注入的正观测；AX 的 Value 是回读面）
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\) Value: dist/quickopen-lazy.md/" }
  - name: 等存在探测补帧（索引不含它，直接行由探测命中给出）
    do: waitFor
    waitFor:
      has: ["按 Enter 打开 dist/quickopen-lazy.md"]
    timeoutMs: 5000
  - name: Enter
    do: key
    key: enter
  - name: 等惰性文件装载
    do: waitFor
    waitFor:
      has: ["LAZY-655-MARKER"]
    timeoutMs: 15000
  - name: 惰性文件打开现场
    do: settle
    expect:
      - label: 惰性文件按精确路径可打开（候选里找不到它，但探测命中）
        ax: { has: "/AXRadioButton \\(quickopen-lazy.md\\)/" }
      - label: 打开的是 vault 内文件（可编辑，不是 vault 外只读）
        ax: { not: "vault 外 · 只读" }
      - shot: 03d-惰性文件

  - name: 记录 /etc/hosts 的字节基线（vault 外只读的文件，⌘S 不得改动它）
    do: record
    as: hosts-before
    file: /etc/hosts
  - name: vault 外绝对路径：只读打开
    do: keys
    keys: ["cmd+p"]
  - name: 输入 vault 外路径
    do: keys
    keys: ["/", "e", "t", "c", "/", "h", "o", "s", "t", "s"]
    expect:
      - label: 路径落进输入框（逐键注入的正观测；AX 的 Value 是回读面）
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\) Value: /etc/hosts/" }
      - label: 直接打开行把「只读」写进动作里（vault 外、读取前判不了存在性）
        ax: { has: "按 Enter 只读打开 /etc/hosts" }
      - label: 有直接打开行时 MUST NOT 出现候选空态
        ax: { not: "没有匹配的条目" }
  - name: Enter
    do: key
    key: enter
  - name: 等 vault 外文件装载
    do: waitFor
    waitFor:
      has: ["localhost"]
    timeoutMs: 15000
  - name: vault 外只读现场
    do: settle
    expect:
      - label: modeline 右段出现只读段（vault 外 · 只读）
        ax: { has: "vault 外 · 只读" }
      - label: 标签页的读屏名带「vault 外只读」（可见侧是文件名前的锁形图标，M660 #7）
        ax: { has: '/AXRadioButton \(hosts（vault 外只读）\)/' }
      - label: 内容可读（/etc/hosts 的正文进了编辑器）
        editor: { has: "localhost" }
      - shot: 06-vault 外只读

  - name: 记录只读文档的字节基线（编辑尝试 MUST NOT 改动它）
    do: recordEditor
    as: external-before-edit
  - name: 在只读标签里键入一个字符（不生效 + 一次性提示；单键盲发——只读面的回读判据本来就是「没变」）
    do: key
    key: x
    expect:
      - label: 提示条说明「vault 外的文件以只读方式打开」（D2 追加裁决 ③ / D584）
        ax: { has: "vault 外的文件以只读方式打开" }
      - label: 文档逐字节不变（键入没有落进正文）
        editor: { unchangedSince: external-before-edit }
      - shot: 06b-只读编辑尝试的提示

  - name: ⌘S 在只读会话上无落点（MUST NOT 写盘、MUST NOT 出保存失败提示）
    do: keys
    keys: ["cmd+s"]
  - name: 保存后现场
    do: settle
    expect:
      - label: /etc/hosts 的字节与 mtime 逐项未变（没有写盘调用落到它身上）
        file: { path: /etc/hosts, unchangedSince: hosts-before }
      - label: 没有保存失败提示（「尚未可保存」一类红字）上屏
        ax: { not: "尚未可保存" }
      - label: 文档仍是打开那一刻的快照
        editor: { has: "localhost" }

  - name: vault 外路径不存在：按找不到处置、浮层保持打开
    do: keys
    keys: ["cmd+p"]
  - name: 输入一条不存在的外部路径
    do: keys
    keys: ["/", "t", "m", "p", "/", "l", "u", "m", "i", "r", "-", "6", "5", "5", "-", "m", "i", "s", "s", "i", "n", "g", "/", "n", "o", "t", "e", "s", ".", "m", "d"]
    expect:
      - label: 路径落进输入框（逐键注入的正观测；AX 的 Value 是回读面）
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\) Value: /tmp/lumir-655-missing/notes.md/" }
      - label: Enter 之前给的是**尝试行**（不断言它不存在——读取前判不了）
        ax: { has: "按 Enter 只读打开 /tmp/lumir-655-missing/notes.md" }
      - label: 尝试行在场时 MUST NOT 出现候选空态
        ax: { not: "没有匹配的条目" }
  - name: Enter
    do: key
    key: enter
  - name: 找不到现场
    do: settle
    expect:
      - label: 提示行给出「找不到」且**点名**了输入串（输入内容保留）
        ax: { has: "找不到：/tmp/lumir-655-missing/notes.md" }
      - label: 没有为此留下空标签
        ax: { not: "/AXRadioButton \\(notes.md\\)/" }
      - shot: 08-找不到
  - name: Esc 收起
    do: key
    key: escape
---

# 230b —— 按路径快速打开（⌘P）之二：惰性文件与外部只读（原场景 230 拆分第 2 组，M747）

## 本组在验什么

1. **索引外的惰性文件**：`dist/quickopen-lazy.md`（`dist` 是默认 `lazy` 档：盘上有、索引里没有）
   按**精确路径**可打开——候选里找不到它，Enter 前的直接行由存在探测补帧给出；打开的是 vault
   内文件（可编辑，不是 vault 外只读）。
2. **vault 外只读**：`/etc/hosts` 以只读打开、标签页读屏名带「vault 外只读」、modeline 右段有
   「vault 外 · 只读」；键入一个字符**不生效**且有一次性提示；`⌘S` 不写盘（字节与 mtime 逐项
   未变）也不出保存失败提示。
3. **外部路径不存在**：Enter 前给的是**尝试行**（读取前判不了存在性），Enter 后按「找不到」处置
   并点名输入串，浮层保持打开、不留空标签。

拆分口径（M747）：断言逐条保留、判据一条不放宽；本组自带启动状态与 fixture，独立诊断。
同族其余两组：`230a-path-forms`（路径形态）/ `230c-restart-and-focus-scopes`（重启与焦点
作用域）。三组同属 item 655，`run.mjs 230` 按 id 前缀选中全部。

**顺序口径**：外部路径不存在这一段放在只读段之后（原场景 230 里它排在 restart 之后，这里是拆分
后的组内顺序）。它不依赖重启：浮层的判定逻辑与重启无关，前置状态（一个只读标签在前台）与产物
（找不到提示）都不受上面两步影响。

## 判据为什么这样写

- **`⌘S` 用 `file: { unchangedSince }` 判**：只读的判据不是「按了没反应」，而是「文件字节与
  mtime 都没变」——真正的写盘调用即使被后端拒绝也可能碰 mtime，这条判据能分辨。
- **键入尝试用「文档逐字节不变」+「提示条在场」两条一起判**：单看「没变」会在键没落地时恒真；
  提示条是本动作的正向锚点（一次性的「vault 外的文件以只读方式打开」，D2 追加裁决 ③ / D584）。
- **只读标签的读屏名判「vault 外只读」这个后缀**（`hosts（vault 外只读）`）：可见侧是文件名
  前的锁形图标，图标进不了 AX（见「覆盖边界」）。
- **负例配正向断言**：`not: "vault 外 · 只读"`（惰性文件那条）旁边配「标签读屏名是
  quickopen-lazy.md」；`not: "没有匹配的条目"` 旁边配「直接打开行在场」——单独写负向断言有恒真
  风险。

## 覆盖边界（如实登记；三组共用的边界见 230a，本组只列本组相关的）

- **`/etc/hosts` 是唯一的「外部文件」现场**：套件没有「往 vault 之外写文件」的动作（`envWrite`
  只能写隔离配置目录、`vaultWrite` 只能写 vault），因此贴近「用户给的仓内路径」那一类用系统自
  带的 `/etc/hosts`（恒定存在、常规文件、合法 UTF-8、内容与用户数据无关）。它的行数随机器不同，
  所以本组不判「落到第几行」——`:行` 的形态用 vault 内的 `goto-line-long.md:39` 判（230a）。
- **`⌘S` 的判据是「字节与 mtime 逐项未变」**：`file` 断言的 `unchangedSince` 比 sha256，
  `mtimeUnchangedSince` 比 mtime，两个一起写才覆盖「写了同一份内容」这条路径；本组的写法
  见上一步（`unchangedSince` 引用 `record` 的基线）。
- **「每会话一次」的负向判据不在真机层**：AX 读不到提示条的**条数**（也无法区分「同一个浮条」
  与「第二次弹出的浮条」），本组只判「第一次键入就有提示」；「第二次不再出现」由
  `tests/visual/scenes/quick-open.spec.ts` 用真实 DOM 计数钉住（`.lumir-toast` 恰为 1 条）。
- **只读标签的锁形图标是可见标记、不进 AX**（M660 #7）：真机层只判读屏名（`{名称}（vault 外
  只读）`）与可见文字不再带「只读」；图标在场 / `aria-hidden` / SVG 形态 / vault 内标签无图标
  由 `tests/visual/scenes/quick-open.spec.ts` 与 `tests/unit/tabs.test.ts` 钉住。
- **索引外的惰性文件**：真机用 `vaultWrite dist/quickopen-lazy.md` 造（`dist` 是默认 `lazy` 档：
  盘上有、索引里没有），Enter 前的直接行由存在探测补帧给出；相对 / vault 内绝对两形的探测矩阵
  在 `tests/unit/quick-open.test.ts`，chromium 层另有 `fs_paths_exist` 桩的同款断言。
  文件名不用 `node_modules/` 是因为 KimiCU 的键名 DSL 没有 `_`（逐键注入的通道限制）。
- **`/etc/hosts` 的 mtime 判据只读不写**：基线在打开之前记，判的是「这次运行没有写盘调用落到
  它身上」；系统自身对 `/etc/hosts` 的写（用户改配置）会让这条如实判红——跑批期间不要动它。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；端口 1430。
- 本组在合成 vault 里新建 `dist/quickopen-lazy.md`，并以**只读**方式打开系统自带的 `/etc/hosts`
  （不写它、`⌘S` 也不写它）；用户真实 vault 全程只读。
- 本组不重启、不抢前台（`⌘P` 是应用内快捷键）。
