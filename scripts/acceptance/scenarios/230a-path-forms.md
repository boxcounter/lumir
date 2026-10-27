---
# change quick-open-file-oct23（M655）真机判据的第 1 组（M747 拆分）：**路径形态**。
# 背景用户原话：「长场景在 fail-fast 后会让一次失败跳过后续覆盖。拆分是为了独立诊断和有效覆盖，
# 不是为了减少场景数或规避既有失败。」因此：每组带自己的启动状态与 fixture，组间不共享运行期
# 状态；原断言逐条保留、逐字不改判据。其余两组：230b（惰性文件与外部只读）/ 230c（重启与焦点
# 作用域）。`node scripts/acceptance/run.mjs 230` 按 **id 前缀**或 item 号选中三组。
#
# 为什么这条判据只能在真机层：
#   1. design §6 第 ③ 条明写「WKWebView 自身是否另有一条 ⌘P 处理」待真机核验——macOS 的打印键
#      不属系统菜单，但 webview / 原生菜单层是否截获只有真机按键断言能答（MUST NOT 只凭推理落章）。
#   2. 「一次 Enter 落到目标行」的落点在 chromium 桩里可以读 `selection.main.head`，但「WKWebView
#      里这条链路真的通」只有真机按键 → 浮层 → 装载的端到端断言能答。
#
# 本组不覆盖（如实登记在正文「覆盖边界」）：行号落点的像素位置（AX 读不到选区）、候选列表的滚动
# 手感与浮层弹出节奏（归 Alex 手感裁决）、Rust 侧读取拒绝矩阵（cargo test）、解析次序矩阵与
# ⌘S/只读的结构性判据（tests/unit/quick-open.test.ts 与 tests/visual/scenes/quick-open.spec.ts）。
id: "230a-path-forms"
item: 655
tier: full
title: 按路径快速打开（⌘P）之一：深层路径一次 Enter 落文件 / 冒号文件名整串优先 / path:line 落点不重开 / vault 内零命中
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
  - name: 焦点在编辑器：⌘P 打开输入面（webview 未截获这条键的正观测）
    do: clickEditor
  - name: 按 ⌘P
    do: keys
    keys: ["cmd+p"]
    expect:
      - label: 输入面出现且输入框持焦（读屏名 = 浮层输入框的 aria-label）
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\)/" }
      - shot: 01-编辑器焦点下唤起

  - name: 输入深层路径并按 Enter（一次 Enter 打开，不再「先开文件再 ⌥G」）
    do: keys
    keys: ["n", "o", "t", "e", "s", "/", "d", "e", "e", "p", "/", "p", "l", "a", "n", ".", "m", "d"]
    expect:
      - label: 路径落进输入框（逐键注入的正观测；AX 的 Value 是回读面）
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\) Value: notes/deep/plan.md/" }
      - label: 完整路径也出现在 AX 文本里（回读面之外的第二条正观测）
        ax: { has: "notes/deep/plan.md" }
  - name: 等结果区给出直接打开行（索引收编后才出现；探针命中也算）
    do: waitFor
    waitFor:
      has: ["按 Enter 打开 notes/deep/plan.md"]
    timeoutMs: 15000
  - name: Enter 前的结果区
    do: settle
    expect:
      - label: 直接打开行在场（与 Enter 同一份判决）
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
    do: keys
    keys: ["n", "o", "t", "e", "s", "/", "d", "e", "e", "p", "/", "n", "o", "p", "e", ".", "m", "d"]
    expect:
      - label: 路径落进输入框（逐键注入的正观测；AX 的 Value 是回读面）
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\) Value: notes/deep/nope.md/" }
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

  - name: 含冒号的文件名：整串优先（MUST NOT 被拆成路径 + 行号）
    do: keys
    keys: ["cmd+p"]
  - name: 输入含冒号的路径
    do: keys
    keys: ["n", "o", "t", "e", "s", "/", "v", "1", "shift+semicolon", "2", ".", "m", "d"]
    expect:
      - label: 路径落进输入框（逐键注入的正观测；AX 的 Value 是回读面）
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\) Value: notes/v1:2.md/" }
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
    do: keys
    keys: ["g", "o", "t", "o", "-", "l", "i", "n", "e", "-", "l", "o", "n", "g", ".", "m", "d", "shift+semicolon", "3", "9"]
    expect:
      - label: 路径落进输入框（逐键注入的正观测；AX 的 Value 是回读面）
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\) Value: goto-line-long.md:39/" }
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
---

# 230a —— 按路径快速打开（⌘P）之一：路径形态（原场景 230 拆分第 1 组，M747）

## 本组在验什么

Alex 2026-10-23 的需求原话：「快速便捷地查找、打开文件（类似 Emacs C-x C-f）……增加这个功能后，
我就可以复制文件路径（不包含开头的 open 命令），然后在 Lumir 里打开了」「最好也可以支持打开
`{path}{:line}` 路径，如 `apps/api/package.json:71`」。本组钉住其中**路径形态**这一层：

1. **⌘P 不被 WKWebView / 原生菜单截获**（design §6 第 ③ 条明写的待验项）：编辑器焦点下按一次，
   输入面出现且输入框持焦。
2. **一次 Enter 落到目标文件**：深层路径 `notes/deep/plan.md` 一次 Enter 就在新标签打开。
3. **文件名里的冒号不被拆开**：`notes/v1:2.md` 打开的是这个文件本身，而不是路径 `notes/v1` 的
   第 2 行——「整串优先」在真机侧的判据。
4. **`path:行` 只落点、不重开**：`goto-line-long.md:39` 落到第 39 行且复用既有标签。
5. **结果区与 Enter 同源**（M700）：索引内的路径在 Enter **之前**就给「直接打开」行（动作文本 +
   落点行），且 MUST NOT 同时出现「没有匹配的条目」；真实的零命中（`notes/deep/nope.md`）仍然
   落空态、Enter 后报「找不到」。

拆分口径（M747）：断言逐条保留、判据一条不放宽；每组自带启动状态与 fixture，独立诊断。
同族其余两组：`230b-lazy-and-external-readonly`（惰性文件与外部只读）/
`230c-restart-and-focus-scopes`（重启与焦点作用域）。三组同属 item 655，`run.mjs 230` 按 id 前缀
选中全部。

## 判据为什么这样写

- **输入用逐键 `keys`，不用 `typeInNode`**（M700 真机实测）：`typeInNode` 的无 index 通道
  （`type_text`）对这个浮层的 `<input>` 不落地——工具回 `delivery_unverified`，且 `focusout`
  把浮层收起（真实用户逐键键入不经过这条路径，浮层行为正确；同一场景的手工探针里逐键键入与
  `set_value` 都正常）。逐键 `keys` 在本输入框上逐字符落地（含 `/` `.` 与字母），冒号没有键名
  字面量，写 `shift+semicolon`（`semicolon` 是 KimiCU 的键名，实测产出 `:`）。回读面是 AX 的
  `Value:` 字段，因此每一步都配一条 `Value: <路径>` 断言。
- **`/AXComboBox \(按路径快速打开文件\)/`**（M700 修正）：旧断言按 `AXTextField` 写、从未跑过真机
  ——带 `role="combobox"` 的原生 `<input>` 在 WKWebView 里是 **AXComboBox**（13 处 target /
  断言因此首次真机执行时全部找不到节点；截图证明浮层当时是好的）。空值时读屏名是 aria-label
  （D570）；非空值时值在 `Value:` 字段（读屏名不随之改变）。
- **直接打开行的断言用动作文本，不用「有内容」**：`按 Enter 打开 <路径>` / `按 Enter 只读打开
  <路径>` 是结果区**判决**的措辞（D589 / D590），落点行是独立的 `第 N 行`（D591）。拿「界面变
  了」当判据挡不住「结果区仍然说没有匹配、Enter 却能打开」这个 M697 的原始缺陷。
- **负例配正向断言**：`ax: { not: "按 Enter 打开" }` 单独写有恒真风险（结果区没渲染这块也成立），
  因此同一步里配 `没有匹配的条目` 在场（D117）——两边一起才说明「这是真的零命中」。
- **`notes/deep/plan.md` 与 `notes/v1:2.md` 用 `vaultWrite` 现造**：fixture 目录的 .md 由
  `resetVault` 平铺进 vault 根，造不出深层路径与含冒号的文件名；`vaultWrite` 的 `mkdirp` 支持
  嵌套路径（M221 起），含冒号的文件名在 APFS 上合法。

## 覆盖边界（如实登记，三组共用一份）

- **行号落点只有「文件与标签」两级机器判据**：`AXTextArea.value` 是整个文档文本，套件读不到
  选区与滚动位置（CL-1 / CL-2 的同一已知边界）。第 39 行是否落在视口中部由 `05` 号截图人工
  判读；选区逐字节判据在 `tests/visual/scenes/quick-open.spec.ts`（真 CM view 上读
  `selection.main.head` 的行号）与 `tests/unit/quick-open.test.ts`（解析层）。
- **候选列表的滚动手感、浮层弹出节奏、`↑↓` 游标手感**：归 Alex 手感裁决，不进机器判据
  （候选集合、上限与游标落点在 `tests/visual/scenes/quick-open.spec.ts` 用真实 DOM 钉住）。
- **Rust 侧的读取拒绝矩阵**（非绝对路径 / `..` / 目录 / 超限 / 非法编码）在 `cargo test` 的
  `read_external_text_ok_and_rejections`，不在真机造现场。
- **输入法组合期**：本组用逐键 `keys` 注入 ASCII 路径，中文查询串的组合期行为由
  `tests/visual/scenes/list-filter.spec.ts` 的同款事件序列覆盖。
- **样例全合成**：`vaultWrite` 文件不含真实 vault 内容；标签名与 marker 是验收用的合成串。
  外部文件只用系统自带的 `/etc/hosts`（见 230b）。
- **`⌘P` 的焦点作用域**：本组只验编辑器焦点；文件树焦点与 harness composer 焦点在 230c。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；端口 1430。
- 本组只在合成 vault 里新建 `notes/deep/plan.md` 与 `notes/v1:2.md`；用户真实 vault 全程只读。
- 本组不打开 vault 外文件、不重启、不抢前台（`clickEditor` 只点本窗口正文）。
