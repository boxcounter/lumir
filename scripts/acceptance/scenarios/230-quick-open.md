---
# change quick-open-file-oct23（M655）的真机判据：⌘P 在 WKWebView 下**不被截获**、按路径一次落行、
# vault 外绝对路径只读打开且不入持久化。
#
# 为什么这条判据只能在真机层：
#   1. design §6 第 ③ 条明写「WKWebView 自身是否另有一条 ⌘P 处理」待真机核验——macOS 的打印键
#      不属系统菜单，但 webview / 原生菜单层是否截获只有真机按键断言能答（MUST NOT 只凭推理落章）。
#   2. `⌘S` 在只读会话上**无落点**的判据是「文件字节未变 + 没有保存失败提示」——前者读磁盘、
#      后者读 AX，chromium 桩造不出「真写盘」的对照。
#   3. 「重启后外部标签不回来」要真的重启（会话持久化走 Rust 侧的 vault-sessions 文件）。
#
# 本场景不覆盖（如实登记在正文「覆盖边界」）：行号落点的像素位置（AX 读不到选区）、候选列表的
# 滚动手感与浮层弹出节奏（归 Alex 手感裁决）、Rust 侧读取拒绝矩阵（cargo test）、解析次序矩阵
# 与 ⌘S/只读的结构性判据（tests/unit/quick-open.test.ts 与 tests/visual/scenes/quick-open.spec.ts）。
id: "230-quick-open"
item: 655
title: 按路径快速打开（⌘P）：路径:行一次落行 / 冒号文件名整串优先 / vault 外只读 / 重启不回来
open: goto-line-long.md
marker: "JUMP-TARGET-39"
config:
  harness:
    provider: mock
steps:
  - name: 造两个 fixture —— 深层路径文件与含冒号的文件名（合成内容，起 app 后由 watcher 收进索引）
    do: vaultWrite
    file: notes/deep/plan.md
    content: "# 深入路径\n\nDEEP-655-MARKER\n"
  - name: 造含冒号的文件名（`v1:2.md`：整串优先的现场，拆开就会变成路径 `notes/v1` + 第 2 行）
    do: vaultWrite
    file: "notes/v1:2.md"
    content: "# 冒号文件名\n\nCOLON-655-MARKER\n"
  - name: 等树把两个新文件收编（watcher 回响）
    do: waitFor
    waitFor:
      has: ["plan.md", "v1:2.md"]
    timeoutMs: 15000

  - name: 焦点在编辑器：⌘P 打开输入面（webview 未截获这条键的正观测）
    do: clickEditor
  - name: 按 ⌘P
    do: keys
    keys: ["cmd+p"]
    expect:
      - label: 输入面出现且输入框持焦（读屏名 = 浮层输入框的 aria-label）
        ax: { has: "/AXTextField \\(按路径快速打开文件\\)/" }
      - shot: 01-编辑器焦点下唤起

  - name: 输入深层路径并按 Enter（一次 Enter 打开，不再「先开文件再 ⌥G」）
    do: typeInNode
    target: { role: AXTextField, name: "按路径快速打开文件|notes/deep/plan.md" }
    text: "notes/deep/plan.md"
    expect:
      - label: 路径落进输入框（注入落地的正观测）
        ax: { has: "notes/deep/plan.md" }
      - label: Enter 之前结果区就有直接打开行（与 Enter 同一份判决）
        ax: { has: "按 Enter 打开 notes/deep/plan.md" }
      - label: 有直接打开行时 MUST NOT 出现候选空态
        ax: { not: "没有匹配的条目" }
      - shot: 02-路径输入
  - name: Enter
    do: key
    key: enter

  - name: 等目标文件装载
    do: waitFor
    waitFor:
      has: ["DEEP-655-MARKER"]
    timeoutMs: 15000
  - name: 落点现场
    do: settle
    expect:
      - label: 深层路径文件在**新标签**里且成为前台（与文件树点击同落点）
        ax: { has: "/AXRadioButton \\(plan.md\\) Value: true/" }
      - label: 原标签仍在（新标签意图，不是替换当前标签）
        ax: { has: "/AXRadioButton \\(goto-line-long.md\\)/" }
      - shot: 03-深层路径打开

  - name: 真负例：vault 内不存在的路径（⌘P）
    do: keys
    keys: ["cmd+p"]
  - name: 输入一条不存在的 vault 内路径
    do: typeInNode
    target: { role: AXTextField, name: "按路径快速打开文件|notes/deep/nope.md" }
    text: "notes/deep/nope.md"
  - name: 等候选为空的探测落定（存在探测是异步的，不能拿 settle 抢跑）
    do: waitFor
    waitFor:
      has: ["没有匹配的条目"]
    timeoutMs: 5000
  - name: 真负例现场
    do: settle
    expect:
      - label: 候选空态在场（这是**真实**的零命中：索引与探测都不成立）
        ax: { has: "没有匹配的条目" }
      - label: 没有直接打开行（判据是那条动作文本，不是任意文本）
        ax: { not: "按 Enter 打开" }
      - shot: 03b-真负例空态
  - name: Enter
    do: key
    key: enter
  - name: 真负例的 Enter 现场
    do: settle
    expect:
      - label: 按「找不到」处置并点名输入串（输入内容保留）
        ax: { has: "找不到：notes/deep/nope.md" }
      - label: 没有为它留下标签
        ax: { not: "/AXRadioButton \\(nope.md\\)/" }
      - shot: 03c-真负例找不到
  - name: Esc 收起
    do: key
    key: escape

  - name: 造一个惰性文件（node_modules 是默认 lazy 档：盘上有、索引里没有）
    do: vaultWrite
    file: node_modules/quick-open-lazy.md
    content: "# 惰性文件\n\nLAZY-655-MARKER\n"
  - name: 等惰性行出现在树里（子树不进枚举）
    do: waitFor
    waitFor:
      has: ["node_modules"]
    timeoutMs: 15000
  - name: 按精确路径打开惰性文件（⌘P）
    do: keys
    keys: ["cmd+p"]
  - name: 输入惰性文件的精确路径
    do: typeInNode
    target: { role: AXTextField, name: "按路径快速打开文件|node_modules/quick-open-lazy.md" }
    text: "node_modules/quick-open-lazy.md"
  - name: 等存在探测补帧（索引不含它，直接行由探测命中给出）
    do: waitFor
    waitFor:
      has: ["按 Enter 打开 node_modules/quick-open-lazy.md"]
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
        ax: { has: "/AXRadioButton \\(quick-open-lazy.md\\)/" }
      - label: 打开的是 vault 内文件（可编辑，不是 vault 外只读）
        ax: { not: "vault 外 · 只读" }
      - shot: 03d-惰性文件

  - name: 含冒号的文件名：整串优先（MUST NOT 被拆成路径 + 行号）
    do: keys
    keys: ["cmd+p"]
  - name: 输入含冒号的路径
    do: typeInNode
    target: { role: AXTextField, name: "按路径快速打开文件|notes/v1:2.md" }
    text: "notes/v1:2.md"
  - name: Enter
    do: key
    key: enter
  - name: 等含冒号文件装载
    do: waitFor
    waitFor:
      has: ["COLON-655-MARKER"]
    timeoutMs: 15000
  - name: 含冒号文件落点现场
    do: settle
    expect:
      - label: 打开的是 `v1:2.md` 本身（不是路径 `notes/v1` 的第 2 行）
        ax: { has: "/AXRadioButton \\(v1:2.md\\)/" }
      - shot: 04-冒号文件名

  - name: 行号后缀：已在标签里的文件 `path:行` 只落点、不重开
    do: keys
    keys: ["cmd+p"]
  - name: 输入带行号的路径
    do: typeInNode
    target: { role: AXTextField, name: "按路径快速打开文件|goto-line-long.md:39" }
    text: "goto-line-long.md:39"
  - name: 等直接行补帧（存在探测是异步的：先探整串，再落到剥后缀那一级）
    do: waitFor
    waitFor:
      has: ["第 39 行"]
    timeoutMs: 5000
  - name: Enter 前的结果区
    do: settle
    expect:
      - label: 直接打开行标明落点行（与 Enter 同一份判决）
        ax: { has: "按 Enter 打开 goto-line-long.md" }
      - label: 落点行读数在场
        ax: { has: "第 39 行" }
      - label: 有直接打开行时 MUST NOT 出现候选空态
        ax: { not: "没有匹配的条目" }
      - shot: 04b-带行号的直接行
  - name: Enter
    do: key
    key: enter
  - name: 落点后
    do: waitFor
    waitFor:
      has: ["JUMP-TARGET-39"]
    timeoutMs: 15000
  - name: 行号落点现场
    do: settle
    expect:
      - label: 文件在既有标签里（标签总数不变——`path:行` 不新开标签）
        ax: { has: "/AXRadioButton \\(goto-line-long.md\\)/" }
      - label: 含冒号与深层路径两个标签都还在（MUST NOT 顶掉任何已打开的标签）
        ax: { has: "/AXRadioButton \\(v1:2.md\\)/" }
      - shot: 05-行号落点（选区与居中位置由截图判读）

  - name: 记录 /etc/hosts 的字节基线（vault 外只读的文件，⌘S 不得改动它）
    do: record
    as: hosts-before
    file: /etc/hosts
  - name: vault 外绝对路径：只读打开
    do: keys
    keys: ["cmd+p"]
  - name: 输入 vault 外路径
    do: typeInNode
    target: { role: AXTextField, name: "按路径快速打开文件|/etc/hosts" }
    text: "/etc/hosts"
    expect:
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
        ax: { has: '/AXRadioButton \\(hosts（vault 外只读）\\)/' }
      - label: 内容可读（/etc/hosts 的正文进了编辑器）
        editor: { has: "localhost" }
      - shot: 06-vault 外只读

  - name: 记录只读文档的字节基线（编辑尝试 MUST NOT 改动它）
    do: recordEditor
    as: external-before-edit
  - name: 在只读标签里键入一个字符（不生效 + 一次性提示）
    do: keys
    keys: ["x"]
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

  - name: 重启：外部标签不回来（MUST NOT 入按 vault 持久化的标签列表）
    do: restart
  - name: 重启后的标签栏
    do: settle
    expect:
      - label: 只读标记不在任何标签上（外部标签没有被恢复）
        ax: { not: "vault 外 · 只读" }
      - label: vault 内标签照常恢复（对照：不是「什么都没恢复」的假绿）
        ax: { has: "/AXRadioButton \\(v1:2.md\\)/" }
      - shot: 07-重启后

  - name: vault 外路径不存在：按找不到处置、浮层保持打开
    do: keys
    keys: ["cmd+p"]
  - name: 输入一条不存在的外部路径
    do: typeInNode
    target: { role: AXTextField, name: "按路径快速打开文件|/tmp/lumir-655-missing/notes.md" }
    text: "/tmp/lumir-655-missing/notes.md"
    expect:
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

  - name: 焦点在文件树：⌘P 同样命中（global 作用域）
    do: click
    target: { role: AXRadioButton, name: "^v1:2\\.md$" }
  - name: 树焦点下按 ⌘P
    do: keys
    keys: ["cmd+p"]
    expect:
      - label: 树焦点下同样打开输入面
        ax: { has: "/AXTextField \\(按路径快速打开文件\\)/" }
      - shot: 09-树焦点下唤起
  - name: Esc 收起
    do: key
    key: escape

  - name: 焦点在 harness composer：⌘P 同样命中
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 面板出现（发送钮在场是 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }
  - name: 点 composer 聚焦
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: composer 焦点下按 ⌘P
    do: keys
    keys: ["cmd+p"]
    expect:
      - label: composer 焦点下同样打开输入面
        ax: { has: "/AXTextField \\(按路径快速打开文件\\)/" }
      - shot: 10-composer 焦点下唤起
  - name: Esc 收起且不跳转
    do: key
    key: escape
    expect:
      - label: 收起后输入面不在场
        ax: { not: "/AXTextField \\(按路径快速打开文件\\)/" }
---

# 230-quick-open —— 按路径快速打开（change quick-open-file-oct23 / M655）

## 本场景在验什么

Alex 2026-10-23 的需求原话：「快速便捷地查找、打开文件（类似 Emacs C-x C-f）……增加这个功能后，
我就可以复制文件路径（不包含开头的 open 命令），然后在 Lumir 里打开了」「最好也可以支持打开
`{path}{:line}` 路径，如 `apps/api/package.json:71`」。本场景把需求里**只能在真机判**的五件事
钉住：

1. **⌘P 不被 WKWebView / 原生菜单截获**（design §6 第 ③ 条明写的待验项）：三个焦点位（编辑器 /
   文件树 / harness composer）各按一次，输入面都出现。
2. **一次 Enter 落到目标行**：`goto-line-long.md:39` 打开并落在第 39 行（选区位置 AX 读不到，
   见「覆盖边界」；文件与标签判据见步骤 05）。
3. **文件名里的冒号不被拆开**：`notes/v1:2.md` 打开的是这个文件本身，而不是路径 `notes/v1` 的
   第 2 行——这是「整串优先」在真机侧的判据。
4. **vault 外只读**：`/etc/hosts` 以只读打开、标签页标题带「只读」标记、modeline 右段有
   「vault 外 · 只读」、`⌘S` 不写盘也不出保存失败提示、重启后标签不回来。
5. **结果区与 Enter 同源**（M700）：vault 外路径 / 带行号的路径 / 索引内的路径在 Enter **之前**
   就给「直接打开」行（动作文本 + 落点行），且 MUST NOT 同时出现「没有匹配的条目」；真实的
   零命中（`notes/deep/nope.md`）仍然落空态、Enter 后报「找不到」。

## 判据为什么这样写

- **`/AXTextField \(按路径快速打开文件\)/`**：浮层输入框是原生 `<input>`，AX 里是 AXTextField；
  空值时它的可访问名就是 aria-label（读屏名 D570）。**非空值**时 WKWebView 把可访问名换成值
  ——因此 `typeInNode` 的 `target.name` 一律写成「读屏名|目标值」的交替正则（README 的 typeInNode 条）。
- **直接打开行的断言用动作文本，不用「有内容」**：`按 Enter 打开 <路径>` / `按 Enter 只读打开
  <路径>` 是结果区**判决**的措辞（D589 / D590），落点行是独立的 `第 N 行`（D591）。拿「界面变
  了」当判据挡不住「结果区仍然说没有匹配、Enter 却能打开」这个 M697 的原始缺陷。
- **负例配正向断言**：`ax: { not: "按 Enter 打开" }` 单独写有恒真风险（结果区没渲染这块也成立），
  因此同一步里配 `没有匹配的条目` 在场（D117）——两边一起才说明「这是真的零命中」。
- **`⌘S` 用 `file: { unchangedSince }` 判**：只读的判据不是「按了没反应」，而是「文件字节与
  mtime 都没变」——真正的写盘调用即使被后端拒绝也可能碰 mtime，这条判据能分辨。
- **重启后的对照**：`ax: { not: "vault 外 · 只读" }` 单独写是恒真风险（界面根本没渲染这块），
  因此同一步里配一条 `v1:2.md` 标签仍在的正向断言，证明「标签栏恢复了、只是没有外部标签」。
- **`notes/deep/plan.md` 与 `notes/v1:2.md` 用 `vaultWrite` 现造**：fixture 目录的 .md 由
  `resetVault` 平铺进 vault 根，造不出深层路径与含冒号的文件名；`vaultWrite` 的 `mkdirp` 支持
  嵌套路径（M221 起），含冒号的文件名在 APFS 上合法。

## 覆盖边界（如实登记）

- **行号落点只有「文件与标签」两级机器判据**：`AXTextArea.value` 是整个文档文本，套件读不到
  选区与滚动位置（CL-1 / CL-2 的同一已知边界）。第 39 行是否落在视口中部由 `05` 号截图人工
  判读；选区逐字节判据在 `tests/visual/scenes/quick-open.spec.ts`（真 CM view 上读
  `selection.main.head` 的行号）与 `tests/unit/quick-open.test.ts`（解析层）。
- **`/etc/hosts` 是唯一的「外部文件」现场**：套件没有「往 vault 之外写文件」的动作（`envWrite`
  只能写隔离配置目录、`vaultWrite` 只能写 vault），因此贴近「用户给的仓内路径」那一类用系统自
  带的 `/etc/hosts`（恒定存在、常规文件、合法 UTF-8、内容与用户数据无关）。它的行数随机器不同，
  所以本场景不判「落到第几行」——`:行` 的形态用 vault 内的 `goto-line-long.md:39` 判。
- **候选列表的滚动手感、浮层弹出节奏、`↑↓` 游标手感**：归 Alex 手感裁决，不进机器判据
  （候选集合、上限与游标落点在 `tests/visual/scenes/quick-open.spec.ts` 用真实 DOM 钉住）。
- **Rust 侧的读取拒绝矩阵**（非绝对路径 / `..` / 目录 / 超限 / 非法编码）在 `cargo test` 的
  `read_external_text_ok_and_rejections`，不在真机造现场。
- **「每会话一次」的负向判据不在真机层**：AX 读不到提示条的**条数**（也无法区分「同一个浮条」
  与「第二次弹出的浮条」），本场景只判「第一次键入就有提示」；「第二次不再出现」由
  `tests/visual/scenes/quick-open.spec.ts` 用真实 DOM 计数钉住（`.lumir-toast` 恰为 1 条）。
- **输入法组合期**：本场景用 `typeInNode` 注入 ASCII 路径，中文查询串的组合期行为由
  `tests/visual/scenes/list-filter.spec.ts` 的同款事件序列覆盖。
- **索引外的惰性文件不在真机层**：验收 vault 的忽略规则由套件统一生成（`ignoredDirs` 探针），
  本场景造不出「单个文件不在索引、但盘上存在」的形态；这条由
  `tests/visual/scenes/quick-open.spec.ts` 的 `fs_paths_exist` 桩与 `tests/unit/quick-open.test.ts`
  的探测矩阵（相对 / vault 内绝对两形）覆盖。
- **只读标签的锁形图标是可见标记、不进 AX**（M660 #7）：真机层只判读屏名（`{名称}（vault 外
  只读）`）与可见文字不再带「只读」；图标在场 / `aria-hidden` / SVG 形态 / vault 内标签无图标
  由 `tests/visual/scenes/quick-open.spec.ts` 与 `tests/unit/tabs.test.ts` 钉住。
- **样例全合成**：两个 `vaultWrite` 文件与 `/etc/hosts` 都不含真实 vault 内容；标签名与 marker
  是验收用的合成串。
