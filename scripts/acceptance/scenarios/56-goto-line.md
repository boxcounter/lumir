---
id: "56-goto-line"
item: 56
title: 跳转到行命令的真机链路——⌥G 打开输入条（预填当前行号 + `共 M 行`）、行号列随输入条出现并在收起后隐藏（`on-demand` 默认档）、Enter 落到目标行（落点由 modeline 指示段与预填值双证）、越界静默钳到末行、取消不动光标与文档、[keys] 重绑通道
fixtures: [goto-line-long.md]
open: goto-line-long.md
marker: "段一"
config:
  keys: { "Ctrl-j": "editor.goto-line" }
steps:
  - name: 起点：文档已打开、光标在首行、输入条不在场、行号列也不在场（默认档）
    do: settle
    expect:
      - label: 正向锚点——文档可读（本 fixture 第 2 行）
        editor: { has: "第 2 行：填充段落" }
      - label: 起点是干净的（标签读屏名没有「未保存」后缀，D90——dirty 的唯一可读通道）
        ax: { not: "（未保存）" }
      - label: 输入条不在场（浮层的输入框是全应用唯一的 AXTextField，常态不该有它）
        ax: { not: "AXTextField" }
      - label: "[keys] 覆盖已写进隔离配置（步 10/12 的重绑通道靠它；没写进去则那两步全程空转）"
        file: { path: env:config.json, has: "\"Ctrl-j\": \"editor.goto-line\"" }
      - shot: 起点-输入条与行号列都不在场

  - name: 建立编辑器焦点（点编辑器顶边；光标落在首行 = 预填值的来源）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里（键盘注入的前置；`open` 之后焦点在树行上）
        ax: { focused: "AXTextArea" }

  - name: 记录文档基线（后面的「零写盘」断言比 sha256 + mtime 两个口径）
    do: record
    as: 文档基线
    file: goto-line-long.md

  - name: ⌥G 打开输入条（默认键通道；套件的 key 注入支持 alt+g——先例 26 号场景的 alt+v）
    do: key
    key: "alt+g"
    expect:
      - label: 输入条在场且**预填 = 打开时的当前行号**（`AXTextField = "1"`；WKWebView 不暴露本框的 aria-label，读屏名那条判据在 chromium 层，见场景正文的覆盖边界）
        ax: { has: '/AXTextField = "1"/' }
      - label: 提示行显示文档总行数（deck D158；49 = 本 fixture 的 doc.lines）
        ax: { has: "共 49 行" }
      - label: 焦点在输入框里（keys 动作的回读目标因此是它，字符真的落进行号框而不是编辑器）
        ax: { focused: "AXTextField" }
      - shot: alt+g-输入条打开-行号列随之出现

  - name: 键入 39（逐位注入；输入条打开时预填值已全选 ⇒ 键入即替换）
    do: keys
    keys: ["3", "9"]
    expect:
      - label: 两位都落在输入框里（keys 的出现次数判据在本步内自证：基线 "1" 里没有 "39"）
        ax: { has: '/AXTextField = "39"/' }

  - name: Enter 确认
    do: key
    key: "return"
    expect:
      - label: 输入条已收起（浮层的输入框从 AX 里消失）
        ax: { not: "AXTextField" }
      - label: 焦点交还编辑器（后续按键落回文本上下文）
        ax: { focused: "AXTextArea" }
      - label: 零写盘：文档逐字节不变 + mtime 不变（跳转不是修改文档）
        file: { path: goto-line-long.md, unchangedSince: 文档基线, mtimeUnchangedSince: 文档基线 }
      - label: 没有变 dirty（跳转不改 dirty）
        ax: { not: "（未保存）" }
      - shot: Enter-后-输入条与行号列都已收起

  - name: 落点读数：再开一次输入条，读预填（预填值 = 光标所在行号，故它是「跳到了第几行」的直接读数）
    do: key
    key: "alt+g"
    expect:
      - label: 光标在第 39 行——落点正确（跳到别处会读出别的值；这是 13 号场景「用被测功能自己产出的读数当判据」的同一手法）
        ax: { has: '/AXTextField = "39"/' }
      - shot: 跳到第-39-行

  - name: 越界钳制：在上面的输入条里键入 9999
    do: keys
    keys: ["9", "9", "9", "9"]
    expect:
      - label: 四位都在框里（替换掉全选的 "39"，不是拼接）
        ax: { has: '/AXTextField = "9999"/' }

  - name: Enter 确认：钳到末行
    do: key
    key: "return"
    expect:
      - label: 输入条收起
        ax: { not: "AXTextField" }
      - label: 零写盘（越界钳制同样不改文档）
        file: { path: goto-line-long.md, unchangedSince: 文档基线, mtimeUnchangedSince: 文档基线 }
      - label: 没有变 dirty
        ax: { not: "（未保存）" }
      - shot: 越界-钳到末行

  - name: 记录编辑器基线（取消路径比它：文档逐字节不变）
    do: recordEditor
    as: 编辑器基线

  - name: 取消路径：⌥G 读预填（同时是「越界钳到第 49 行」的判据）
    do: key
    key: "alt+g"
    expect:
      - label: 输入条在场，预填 = 49（**这条同时把「越界钳到末行」钉死**：预填值取自光标所在行）
        ax: { has: '/AXTextField = "49"/' }
      - label: 焦点在输入框里
        ax: { focused: "AXTextField" }

  - name: 键入 5（取消前的半成品输入）
    do: keys
    keys: ["5"]
    expect:
      - label: 字符落进输入框（基线 "49" 里没有 "5"，出现次数判据因此有区分度）
        ax: { has: '/AXTextField = "5"/' }

  - name: Escape 取消
    do: key
    key: "escape"
    expect:
      - label: 输入条收起
        ax: { not: "AXTextField" }
      - label: 文档逐字节不变
        editor: { unchangedSince: 编辑器基线 }
      - label: 零写盘
        file: { path: goto-line-long.md, unchangedSince: 文档基线, mtimeUnchangedSince: 文档基线 }

  - name: 取消后光标读数：再开一次输入条
    do: key
    key: "alt+g"
    expect:
      - label: 光标仍停在第 49 行（仍是 49）——取消路径没有挪动光标；若上面那次 Escape 误跳转（例如跳到刚键入的 5），这里会读出别的值
        ax: { has: '/AXTextField = "49"/' }
      - label: 焦点交还逻辑不干扰：此刻焦点在输入框上
        ax: { focused: "AXTextField" }

  - name: 关掉上面那个输入条（为 ⌃J 重绑通道清场）
    do: key
    key: "escape"
    expect:
      - label: 输入条收起
        ax: { not: "AXTextField" }

  - name: 重绑通道：[keys] 把 editor.goto-line 绑到 ⌃J，⌃J 照常打开输入条
    do: key
    key: "ctrl+j"
    expect:
      - label: 重绑生效——输入条打开（与 ⌥G 同一形态），预填仍是 49
        ax: { has: '/AXTextField = "49"/' }
      - label: 提示行同形（`共 M 行`）
        ax: { has: "共 49 行" }
      - label: 焦点在输入框里
        ax: { focused: "AXTextField" }
      - shot: ctrl+j-重绑通道

  - name: Escape 收起（收尾：不留浮层）
    do: key
    key: "escape"
    expect:
      - label: 输入条收起、焦点交还编辑器
        ax: { not: "AXTextField" }
      - label: 焦点在编辑器里
        ax: { focused: "AXTextArea" }
      - label: 零写盘（整场没有一次写盘）
        file: { path: goto-line-long.md, unchangedSince: 文档基线, mtimeUnchangedSince: 文档基线 }
---

# 场景 56：跳转到行（change `goto-line-command`，M281）

Alex 原话（2026-09-27）：「增加类似 Emacs 那样跳转到指定行号的快捷键。」M261 提案（节点 1 裁决
D1–D4 已落定）、M271 修订、M281 实现。本场景判**真机 WKWebView 上的行为链路**。

fixture：`goto-line-long.md`，48 行正文 + 尾换行（`doc.lines` = 49），五个 `## 段N` 小标题
（1 / 12 / 23 / 34 / 45 行），第 39 行是 `JUMP-TARGET-39`，第 48 行是 `LAST-LINE-MARKER`。
行号与打印的「第 N 行」逐一对齐，便于人工核对。

md 行号 gutter 走**默认档 `on-demand`**（`[ui] markdown_line_numbers` 缺席 = 不带这条配置，
与出厂口径同值）：打开文档时没有行号列，`⌥G` 打开输入条时出现、收起后隐藏——本场景的三张
配对截图（步 1 / 步 4 / 步 6）就是这条口径的真机证据。

## 判据为什么这样写（实现期实测校正后的口径）

- **默认键通道**：步 4/8/12/15 走 `alt+g`——套件的 `key` 动作支持 Alt 组合（先例 26 号场景的
  `alt+v`）；`Alt-KeyG` 是**物理键** token（macOS 的 Alt 层把 G 换成 `©`），命中的是 `KeyboardEvent.code`。
- **字符落点**：输入条是浮层里的原生 `<input>`，套件的 `type` 动作会先点编辑器聚焦（那会把输入条
  focusout 收起，实测确认），因此用 `keys`（逐位注入 + 按 focused 节点回读 `.value`）。
- **输入条的在场判据 = `AXTextField` 的有无 + 它的值**：WKWebView 把这个 `<input>` 暴露成
  `AXTextField = "…"`（值可读、**不暴露 `aria-label`**）——全应用只有它一个原生文本框（搜索面板 /
  树内联编辑 / vault 筛选器在本场景都不开），因此「AX 里有 `AXTextField`」等价于「输入条开着」；
  预填值 = 打开时的光标行号这一条也由它的值直接判（步 8 的 `"39"`、步 12 的 `"49"` 顺便把
  「光标停在第几行」钉死）。
- **落点判据 = 输入条自己的预填值**（`AXTextField = "…"` 读两次）：KimiCU 的 AX 不暴露
  `AXSelectedTextRange`（README 的已知边界「光标/选区不可断言」），而**整篇文档都在
  `AXTextArea.value` 里**（不是只有视口内的行——首轮实测推翻了 README 里那句「长文档只有视口内的
  行在 AX 里」，见下面的覆盖边界），所以「目标行在视口里」这类断言没有区分度。改用的判据是
  **读输入条的预填值**：预填 = 打开时的光标行号（实现口径，本场景步 4 的 `"1"` 先证明它确实跟着
  光标走），因此「跳到第 39 行 ⇒ 再开一次读出 39」是光标位置的正函数，跳到别处会读出别的值——
  这是 13 号场景「用被测功能自己产出的读数当判据」的同一手法（那里的判据是标题链条，这里是预填值）。
  同一个读数还把两件事一起钉死：越界钳制落在第 49 行（步 11 读出 `"49"`）、取消路径没挪动光标
  （步 14 再读仍是 `"49"`）。
  **不用 modeline 指示段当判据**（首轮试过）：它的文本在真机 AX 快照里读不到（本场景的 dumps 里
  没有它的节点，快照本身 `truncated: true`），拿一个读不到的值当判据会退化成恒真/恒假。
- **零写盘**：`unchangedSince`（sha256）+ `mtimeUnchangedSince` 一起用——写了同一份内容时 sha256
  相同而 mtime 会推进。跳转 MUST NOT 改文档、MUST NOT 进撤销栈、MUST NOT 改 dirty（ADR 0003 §3）。
- **[keys] 重绑**：配置在前置的 front-matter 里声明（`Ctrl-j` → `editor.goto-line`），默认键 `⌥G`
  照常可用，步 14 再走重绑后的 `ctrl+j`；同一场景内两条通道都验，不需要 restart。

## 覆盖边界（如实记账，别读成「全验过」）

- **md 行号 gutter 的在场只能用截图证据**（AX 通道看不见它）：CM 给 `.cm-gutters` 带
  `aria-hidden="true"`，WKWebView 的 AX 树里没有它。本场景的覆盖方式是**三张配对截图**——
  步 1（打开文档：输入条与行号列都不在场 = 默认 `on-demand` 档的「markdown 默认不显示」）、
  步 4（`⌥G` 打开输入条：行号列随之出现）、步 6（Enter 收起：输入条与行号列都已收起）。
  行号与源行号一致、贴正文列左缘、正文列仍居中、纵向对准、窄窗不被裁、以及**开关瞬间正文列
  不跳动**这些**几何判据**在 chromium 层断言（`tests/visual/scenes/m281-goto-line.spec.ts`，
  实测 rect）。本场景不设 `ui.markdown_line_numbers`（走默认 `on-demand`）；`always` / `off`
  两档的在场时机同样在 chromium 层覆盖（那里能改配置起两轮），真机不再多花一次启动成本。
- **输入条的读屏名（deck D152）在真机 AX 里读不到**（实测 `AXTextField = "1"`，没有 label/help）：
  真机侧判「框在场 + 值正确 + 焦点在它身上」，`aria-label` 的断言在 chromium 层（同一常量）。
- **README 的一句已知边界被本场景证伪（已落 finding）**：`scripts/acceptance/README.md` 写
  「长文档只有视口内的行在 AX 里」，实测 `AXTextArea.value` 是**整篇文档**（45 行 fixture 的
  第 37 行标记在视口外也读得到）。任何「某行在/不在视口」类断言在真机上因此没有区分度，别再用。
- **图片行之后的行号会低约一个文字盒**（已知边界，非本 change 引入）：md 的行若含 inline replace
  widget，CM 的高度表比 DOM 行盒高一个文字盒（实测 165.5 vs 147.5）。改动前的构建上逐值相同，
  见 change 的 design §1.4 与 `tests/visual/scenes/m281-goto-line.spec.ts` 文件头；修它要动
  livePreview 的 widget 形态或 CM 的高度模型，不在本 change 范围内。
- **本场景不验**：跳转历史（Emacs 的 `goto-line-history`）、mark 回跳、`M-g` 家族的其它成员、
  越界提示文案（D3 裁决的推荐项是静默钳制）——都是 change 的 Non-goals。
