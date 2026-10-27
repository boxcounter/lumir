---
# change quick-open-file-oct23（M655）真机判据的第 3 组（M747 拆分）：**重启与焦点作用域**。
# 背景与拆分口径见 230a 的头注释（每组自带启动状态与 fixture、断言逐条保留、判据一条不放宽）。
# 其余两组：230a（路径形态）/ 230b（惰性文件与外部只读）。`run.mjs 230` 按 id 前缀选中三组。
#
# 为什么这条判据只能在真机层：
#   1. 「重启后外部标签不回来」要真的重启（会话持久化走 Rust 侧的 vault-sessions 文件）——
#      chromium 桩造不出「进程重启 + 按 vault 恢复标签」这条链路。
#   2. 「⌘P 在三个焦点位都命中」里的文件树与 harness composer 两个焦点位只有真机 AX / 真实
#      键盘注入能建立（composer 的焦点必须真实 mousedown，AXPress 不建 DOM 焦点）。
#
# 本组不覆盖（如实登记在正文「覆盖边界」）：候选列表的滚动手感、浮层弹出节奏（归 Alex 手感裁决）、
# 会话持久化的结构（tests/unit / Rust 侧）。
id: "230c-restart-and-focus-scopes"
item: 655
tier: full
title: 按路径快速打开（⌘P）之三：重启后 vault 外标签不回来、vault 内标签照常恢复、文件树与 harness composer 焦点下同样命中
open: goto-line-long.md
marker: "JUMP-TARGET-39"
config:
  harness:
    provider: mock
steps:
  - name: 造含冒号的文件（restart 后「vault 内标签照常恢复」的正向对照）
    do: vaultWrite
    file: "notes/v1:2.md"
    content: "# 冒号文件名\n\nCOLON-655-MARKER\n"
  - name: 用 ⌘P 打开它（restart 前它是一个打开着的 vault 内标签）
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
  - name: 对照标签就位
    do: settle
    expect:
      - label: v1:2.md 已是打开着的标签（restart 后的正向对照，见末段断言的配对说明）
        ax: { has: "/AXRadioButton \\(v1:2.md\\)/" }
      - shot: 07a-restart-前的对照标签

  - name: restart 前先打开一个 vault 外文件（「外部标签不回来」这条负向判据因此不空转）
    do: keys
    keys: ["cmd+p"]
  - name: 输入 vault 外路径
    do: keys
    keys: ["/", "e", "t", "c", "/", "h", "o", "s", "t", "s"]
    expect:
      - label: 路径落进输入框（逐键注入的正观测；AX 的 Value 是回读面）
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\) Value: /etc/hosts/" }
      - label: 直接打开行把「只读」写进动作里，且目标就是 /etc/hosts（vault 外、读取前判不了存在性；锚定整行，段边界 `\s*` 容错，见 230a 同名注释）
        node: { name: "^按 Enter 只读打开\\s*/etc/\\s*hosts$", present: true }
      - label: 该行的全路径通道（`title` → AX `help`）逐字是 /etc/hosts（零容差：属性不受分段空格影响）
        ax: { has: '/help="\/etc\/hosts"/' }
  - name: Enter
    do: key
    key: enter
  - name: 等 vault 外文件装载
    do: waitFor
    waitFor:
      has: ["localhost"]
    timeoutMs: 15000
  - name: restart 前的只读标签就位（负向断言的正向前置）
    do: settle
    expect:
      - label: modeline 右段出现只读段（vault 外 · 只读）
        ax: { has: "vault 外 · 只读" }
      - label: 标签页的读屏名带「vault 外只读」（可见侧是文件名前的锁形图标，M660 #7）
        ax: { has: '/AXRadioButton \(hosts（vault 外只读）\)/' }
      - shot: 07b-restart-前的只读标签

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

  - name: 焦点在文件树：⌘P 同样命中（global 作用域）
    do: click
    target: { role: AXButton, name: "^block-copy\\.md$" }
  - name: 树焦点下按 ⌘P
    do: keys
    keys: ["cmd+p"]
    expect:
      - label: 树焦点下同样打开输入面
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\)/" }
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
        ax: { has: "/AXComboBox \\(按路径快速打开文件\\)/" }
      - shot: 10-composer 焦点下唤起
  - name: Esc 收起且不跳转
    do: key
    key: escape
    expect:
      - label: 收起后输入面不在场
        ax: { not: "/AXComboBox \\(按路径快速打开文件\\)/" }
---

# 230c —— 按路径快速打开（⌘P）之三：重启与焦点作用域（原场景 230 拆分第 3 组，M747）

## 本组在验什么

1. **重启后 vault 外标签不回来**（MUST NOT 入按 vault 持久化的标签列表）：重启前 `/etc/hosts`
   以只读打开、标签在场（正向前置）；重启后**任何标签都不带只读标记**。
2. **vault 内标签照常恢复**：`v1:2.md` 在重启后仍在标签栏里——这是上一条负向判据的**配对正观测**，
   证明「标签栏恢复了、只是没有外部标签」，不是「什么都没恢复」的假绿。
3. **⌘P 的焦点作用域**（design §6 第 ③ 条的待验项）：文件树焦点与 harness composer 焦点下各按
   一次 ⌘P，输入面都出现；Esc 收起后输入面不在场（且没有因此跳转）。编辑器焦点那一位在 230a。

拆分口径（M747）：断言逐条保留、判据一条不放宽；本组自带启动状态与 fixture，独立诊断。
同族其余两组：`230a-path-forms`（路径形态）/ `230b-lazy-and-external-readonly`（惰性文件与外部
只读）。三组同属 item 655，`run.mjs 230` 按 id 前缀选中全部。

**为什么本组自己再打开一次 `/etc/hosts`**：原场景 230 在同一进程里先打开过外部文件、随后 restart，
那条「重启后只读标记不在任何标签上」的负向断言才有区分度。拆分后本组独立起实例——不先打开一次
外部文件，这条断言就退化成「从没打开过外部文件，所以当然没有」的恒真空转（REVIEW.md「读不到
当成空」条 / 「断言等价于子串」条）。因此那两步（打开 + 只读标签就位）是本组的**正向前置**，
不是重复覆盖；与 230b 的只读段共用同一套断言形态。

## 判据为什么这样写

- **重启后的对照**：`ax: { not: "vault 外 · 只读" }` 单独写是恒真风险（界面根本没渲染这块），
  因此同一步里配一条 `v1:2.md` 标签仍在的正向断言，证明「标签栏恢复了、只是没有外部标签」。
- **重启前的正向前置同样要断言**：只读标签必须在 restart 之前的现场里被读到（modeline 段 + 标签
  读屏名），否则「重启后不在」分不清「没恢复」与「从来没打开」。
- **焦点位的判据是「输入面出现」**：`/AXComboBox \(按路径快速打开文件\)/` 是空值的读屏名
  （D570）；Esc 之后同一条断言翻面（不在场），证明收起真的发生，而不是「按了没反应」。
  composer 的聚焦用 `clickInNode`（AXPress 不建 DOM 焦点，M497 的硬知识）。
- **`v1:2.md` 用 ⌘P 打开**：它是本组的对照标签；打开方式与路径形态一致（`notes/v1:2.md`），
  顺带让「vault 内标签恢复」的现场自带一条真实路径（含冒号的文件名在 APFS 上合法）。
- **直接打开行的断言形态与 230a 同一条**（M755）：`/etc/hosts` 那一步判「只读」动作文本 +
  目标路径时，改用段边界 `\s*` 容错的正则 + 锚定整行的 `node` 断言 + 全路径 `help` 属性零容差
  判据；理由与现场见 230a 正文的同名条目。动作措辞 `只读` 本身仍是判据——vault 内路径的
  直接行 MUST NOT 带这两个字（`按 Enter 打开` 与 `按 Enter 只读打开` 是两条不同的判决措辞，
  D589 / D590）。

## 覆盖边界（如实登记；三组共用的边界见 230a）

- **本组不判「外部文件恢复后内容是否还在」**：外部标签根本不该恢复，判据只是「不在」+「vault 内
  标签在」。外部内容的读取正确性由 230b 判。
- **`⌘P` 的焦点作用域只有「输入面出现」一级**：候选集合与游标落点由
  `tests/visual/scenes/quick-open.spec.ts` 用真实 DOM 钉住；本组不判候选内容。
- **重启的耗时与恢复时序**：套件在 restart 后走严格就绪门（树行 + 编辑器在位）再 settle；
  恢复段本身的结构（`vault-sessions` 形状）不在真机断言，由 Rust 侧 / 单测覆盖。
- **候选列表的滚动手感、浮层弹出节奏**：归 Alex 手感裁决，不进机器判据。

## 环境与副作用

- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；端口 1430。
- 本组在合成 vault 里新建 `notes/v1:2.md`，以**只读**方式打开系统自带的 `/etc/hosts`（不写它），
  并在场景内重启一次 app（重启前后都过严格就绪门）。用户真实 vault 全程只读。
- 本组不抢前台（无 Finder / 无真实鼠标手势之外的激活动作）。
