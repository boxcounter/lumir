---
# 0.13.0 CM composer 的原生 IME 人工探索矩阵。自动段只建两行现场并做正观测；
# 原生 TSM / 候选窗动作不可合成（M461/M529 的通道探针已逐条证明），人工矩阵在正文按组执行。
# run.mjs 262 的 PASS 只表示前置现场成立，不是 native IME 判定。
id: "262-native-ime-exploration"
item: 262
tier: evidence
title: "原生 IME 人工探索矩阵（0.13.0 CM composer；自动段只建现场，native 人工终判）"
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  # 自动段只负责把「两行文本 + 可点的 composer」建起来，并给出正向锚点与缺陷签名。
  # 它不、也不能证明任何原生 IME 行为；人工组从正文 G0 开始。
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 在位（空输入态 = D328 占位读屏名）
        ax: { has: "问点什么" }
      - shot: 00-面板就位

  - name: 真实鼠标点 composer（CM contentDOM 的 DOM 焦点靠真实 mousedown 建立）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 键入第一行（合成探针串；typeInNode 粘贴通道原样落地）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|hnl-imx-a" }
    text: "hnl-imx-a"

  # 与 156 / 117 同一条既有边界：⇧Enter 的副作用在 AX 里逐次不可观测，不加 verify。
  # 本步只承担「人工矩阵的待验现场」。
  - name: 一次 ⇧Enter（新起第二行——手动复验的待验现场）
    do: key
    key: "shift+return"

  # 键串不含 'e'：press_key 对字母 e 有确定性丢弃（M497/M509）。
  - name: 键入第二行（合成探针串）
    do: keys
    keys: ["h", "n", "l", "-", "i", "m", "x", "-", "b"]
    gapMs: 60
    expect:
      # 跨行判据走**解析值**（M765，与 117 同口径）：dump 原文里的换行是字面 `\n`，
      # `ax.has` 的 `[\r\n]+` 命中 0 次；`node` 匹配 `parseNodes` 还原后的 value。
      - label: 两行态在 IME 之前可达：第二段接在第一段下一行（不是同行拼接）——人工矩阵的前置现场成立
        node: { role: AXTextArea, name: 'hnl-imx-a\n+hnl-imx-b', present: true }
      - label: 缺陷签名串不在场（同行拼接 = 拆行没落地，人工矩阵无从谈起）
        ax: { not: "hnl-imx-ahnl-imx-b" }
      - shot: 01-IME前两行态

  - name: 记录自动化边界（证据型 note，不卡 PASS/FAIL）
    do: note
    text: "自动段到此为止：run.mjs 262 的 PASS 只证明前置现场成立；原生 TSM 组合、候选窗与候选选择尚未执行（NATIVE_IME_NOT_RUN）。人工矩阵按正文 G0–G6 选组执行，结论只落 .local/acceptance/<日期>-ime-matrix/ledger.md。"
    expect:
      - shot: 02-待人工现场
---

# 262 —— 原生 IME 人工探索矩阵（0.13.0 CM composer）

> 机器回归门是场景 271（`imeDrive` 合成事件序列，证明产品 JS 路径，不冒充原生 IME）；262 仍是原生 TSM / 候选窗的人工终判。

## 口径（先读这一节）

1. **自动段 PASS 不是 native IME PASS。** `node scripts/acceptance/run.mjs 262` 只建两行探针现场并
   正观测它；它无法驱动 TSM、候选窗与 marked text。原生通道边界见 README「native WKWebView IME
   不可达」与 156：KimiCU / System Events / CGEvent / TISSelectInputSource 都直落 `insertText`，
   进不了 TSM。报告里该边界单列 `NATIVE_IME_UNREACHED`，**不并入 PASS**，也不拿合成
   CompositionEvent 替代真机判定。
2. **人工结论只来自本正文的组。** 每组按「前置正观测 → 操作 → 预期」执行，结果写进
   `.local/acceptance/<日期>-ime-matrix/ledger.md`；场景自动段的 `status.txt` / `summary.md`
   不承载人工结论。
3. **按变更面选组，不要求每次全跑。** 选组表见下一节；未被选中的组不执行、也不写 PASS。
4. **前置不成立不记产品 FAIL。** 候选窗没出现、输入法没切过去、焦点不在 composer、tray 附件
   没建立起来，一律记 `BLOCKED`（native 未执行），重试一次同组；仍不成立就停下来找 tower，
   不得把环境问题写成产品缺陷，也不得把自动段 PASS 写成 native PASS。
5. **失败保留现场。** 见「失败保留现场」节：不重跑、不退出 app、不切走输入法、不改文档，
   先截屏与记录原始拼音，再判定。

## 选组表：按相关变更挑最小必跑组

矩阵按**变更面**分组。一次改动只跑它触达的组，避免每次全量人工复验；发布前或系统/框架升级
才全跑。

| 变更面（触发条件举例） | 最小必跑组 |
|---|---|
| composer 文本内核、CM 版本、keymap、选区/删除命令 | G1、G2、G5 |
| `compositionstart` / `compositionend`、Enter 发送门、候选确认路径 | G2、G4 |
| CM history、undo / redo、附件 history、`composerAttachmentsField` | G3、G5 |
| composer 布局、`lineWrapping`、min/max 高度、滚动、tray 位置 | G3 |
| 附件 tray、摘录卡片渲染（DOM / 视觉 / 布局） | G3 |
| 焦点管理、pane 切换、transcript 交互、窗口激活/失活 | G4 |
| paste 处理器、剪贴板、附件装配 | G6 |
| macOS / WKWebView / 系统输入法升级、发布前回归 | G0–G6 全跑 |
| 日常 dogfood，无上述改动 | G1、G2（最短回归） |

未列出的改动（文档、文案、无关面板）不必跑本矩阵。每组都可单独执行，但每组开始前都要满足
G0 的共享前置。每组结束时把四态之一写进 `ledger.md` 对应行，前置读数与该组细节落该组的
`notes.md`；未选的组写 `NATIVE_IME_NOT_RUN`。

## G0 共享前置（选中任一组都先做）

- **触发面**：任何原生 IME 复验。
- **前置正观测**（任一不成立 ⇒ `BLOCKED`，该组 native 不执行）：
  1. app 版本是被测版本（本矩阵起草时为 0.13.0），窗口在前台，非最小化。
  2. 系统输入法切到「简体拼音」，菜单栏输入法图标可见；记录 macOS 版本与输入法名称。
  3. 用 `node scripts/acceptance/run.mjs 262 --keep-app` 起现场（或复用同一实例），自动段 PASS，
     证据目录 `.local/acceptance/<日期>/262-native-ime-exploration/` 存在；把该路径抄进
     `env.md`。
  4. 自动段的两行探针在 composer 中可见：第一行 `hnl-imx-a`，第二行 `hnl-imx-b`；截图记录。
  5. 在编辑器里选中一段文字，点浮动「摘录到对话」钮，正观测编辑区外 tray 至少一张附件
     （出处行与 × 可见）；记录附件内容与顺序，并截图。若 tray 为空，本组前置不成立（`BLOCKED`），
     不得继续执行任何「附件不变」判定。
  6. 用真实鼠标点 composer，看到 `focus-within` 边框变化；记录焦点在 composer。
- **操作**：把上述读数写进 `env.md`（版本、macOS、输入法、窗口尺寸、run 证据目录、基线文本、
  附件内容）。
- **判定**：六条前置全部成立 ⇒ G0 PASS（共享前置成立），可进入所选组；任一不成立 ⇒
  `NATIVE_IME_BLOCKED`，该组 native 不执行。
- **记录**：`.local/acceptance/<日期>-ime-matrix/env.md`，ledger 的 G0 行同步写结果。

## 基线复位（G1 / G6 每个编号 case 前）

G1、G6 的每个编号 case 都从同一份 G0 基线独立开始，不得沿用上一 case 的候选窗、marked text，
或已被上一 case 破坏的文本 / 附件状态。每个编号 case 执行前按下面五步复位，复位结果就是该
case 的前置正观测。**G5 不走这套复位**：它直接断言 CM history，任何编辑动作复位都会污染被测
撤销栈，见 G5 的「重启复位」。

1. **结束组合**：按 Esc，确认候选窗消失、composer 里没有下划线拼音串。
2. **文本复位**：删除本组上一 case 追加的字符；若上一 case 撤销 / 删除了基线文本，用重做或
   重新键入补回。目标是 composer 文本逐字回到两行 `hnl-imx-a` / `hnl-imx-b`；截图确认，
   caret 放到第二行行尾。
3. **附件复位**：tray 恢复为 G0 记录的数量、内容与顺序；多出的用 × 移除，缺的重新摘录。
4. **焦点复位**：真实鼠标点 composer 第二行行尾，确认 `focus-within`。
5. **失败兜底**：任一项复位不回去，停止该组，退出 app 并重跑
   `node scripts/acceptance/run.mjs 262 --keep-app`，重新执行 G0 建立附件后再继续；**不得**
   带着残留状态进入下一 case。

复位截图与复位后的文本 / 附件读数写进该组 `notes.md`，作为该 case 的前置证据。

## G1 候选窗：实际拼音 + 数字 / 空格 / 鼠标选择

- **触发面**：composer 文本内核、IME 输入链路、候选窗相关系统升级。
- **前置正观测**：G0 成立；caret 在第二行 `hnl-imx-b` 行尾（截图 + 相邻文本证明）；输入
  `ma` 后候选窗出现、composer 内出现带下划线的拼音串（截图为正观测）；按 Esc 取消，确认
  基线文本逐字未变；若 Esc 后仍有残留或文本变化，先按「基线复位」兜底，仍不成立 ⇒
  `BLOCKED`。**前置只输入 `ma`**，不得用 case 1 的 `nihao` 做前置再在 case 1 重复输入
  （同一串提前消耗会把 case 1 的现场混进前置）。候选窗不出现 ⇒ `BLOCKED`。
- **操作**（每个编号 case 前先按「基线复位」执行，再从第二行行尾独立开始组合；不得沿用上一
  case 的候选窗或 marked text。输入法候选随系统版本变化，以当次实际候选为准，逐项记录原始
  拼音、候选列表与选中项）：
  1. 输入 `nihao`，按 **空格** 选首选候选，提交到 caret 处。
  2. 输入 `ceshi`，按 **数字键 2** 选第二个候选，提交。
  3. 输入 `shijie`，用 **鼠标点击** 候选窗中的一项（任选非首项），提交。
  4. 输入 `wo`，用 **方向键** 移动候选高亮后按空格提交。
- **预期**：
  - 四个 case 都从同一份 G0 基线独立开始；case 间的唯一差异是拼音与选择方式。
  - 前置的 `ma` 只用于观测候选窗，不进入任何 case 的判据。
  - 四种选择方式都只把候选提交到 caret 处，caret 落在提交字之后。
  - 组合期与提交后都**不发送**；第一行、第二行既有内容与 tray 附件不变。
  - 提交后不残留拼音原串（如 `nihao` 不会留在文本里），除非明确按 Esc 取消。
  - 四种方式提交的字与候选窗实际选中项一致。
- **FAIL 签名**：已提交文本丢失、重复提交、提交到错误位置、发送被触发、拼音原串残留、
  候选选择与记录不一致且不可复现、case 间状态串扰（上一 case 的残留文本或候选窗被带进
  下一 case）。
- **记录**：`.local/acceptance/<日期>-ime-matrix/g1/notes.md`，附每次复位截图、候选窗截图、
  提交后截图、`raw.txt`（每次的原始拼音与候选列表）。

## G2 组合期删除 / Esc / Enter

- **触发面**：`compositionstart/end`、Enter 发送门、Backspace 删除路径。
- **前置正观测**：G0 成立；caret 在第二行末尾；先用候选提交一个「我」作为已提交基线，
  截图记录「我」在 composer 中、tray 附件仍在。
- **操作**：
  1. 输入 `s`（或 `shi`）开始组合，marked text 可见；按一次 **Backspace**。
  2. 重新组合多个字符，连续按 **Backspace**，每次记录 composer 实际文本。
  3. 重新组合后按 **Esc**。
  4. 重新组合，按 **Enter** 确认候选；确认后等超过 250ms，再按一次 **Enter**。
- **预期**：
  - 组合中 Backspace 只删组合内容；已提交「我」、第一行 `hnl-imx-a` 与附件不变。
  - 连续 Backspace 不吃已提交文本，也不删行、不删附件。
  - Esc 取消后文本回到组合前，caret 不跳走。
  - 确认候选的 Enter 只提交候选、**不发送**；确认窗外再按 Enter 才发送。
  - 发送后 transcript 中附件上下文在前、完整问题文本在后，消息内容与 composer 终态一致。
- **FAIL 签名**：Backspace 删掉已提交字符 / 整行 / 附件；Esc 后残留组合文本；确认候选时
  发送；发送内容缺行、错序或与 composer 不一致。
- **记录**：`.local/acceptance/<日期>-ime-matrix/g2/notes.md`，逐步前后截图、发送后的
  transcript 截图与消息原文。

## G3 位置矩阵：行首 / 行尾 / 软折行 / 空行 / 附件附近

- **触发面**：composer 布局、`lineWrapping`、高度 / 滚动、tray 位置、附件渲染。
- **前置正观测**：G0 成立；逐格建立 caret 位置，用截图与相邻文本证明位置（光标 / 选区在 AX
  层不可断言，截图是唯一正观测）。
- **操作**（逐格执行，每格前先恢复到 G0 基线）：
  1. **行首**：caret 放到第一行 `hnl-imx-a` 行首，组合 `wo` 并提交。
  2. **行尾**：caret 放到第二行 `hnl-imx-b` 行尾，组合 `nihao` 并提交。
  3. **软折行**：键入一条超过 composer 宽度的长行（记录窗口宽度），在视觉折行边界前后各放
     一次 caret，分别组合 `shi` 并提交。
  4. **空行**：用 ⇧Enter 在两段之间建立空行，caret 落在空行，组合 `wo` 并提交。
  5. **附件附近**：tray 有附件时，分别在首行行首、末行行尾、以及「只有附件、没有文本」的空
     composer 三种位置组合并提交（第三种先用 ⌘A 选文本再 Backspace 删除，附件不参与选区，
     tray 应保留；删完先截图正观测「只有附件」再组合）。
- **预期**：
  - 提交文本落在 caret 所在行，不窜到相邻行，不拆行。
  - 软折行格不得插入硬换行：⌘A 全选后 ⌘C 复制、粘贴到外部纯文本编辑器，整条长行必须仍是
    **一行**（记录粘贴结果）；提交后文本与候选窗不得错位。
  - 空行格只改空行，前后两行内容与顺序不变。
  - 附件附近格：附件内容、顺序、× 钮不变；文本不进入 tray；只有附件时提交文本后仍可发送，
    且附件上下文在前、问题在后。
- **FAIL 签名**：提交文本落到相邻行、插入硬换行、软折行 / 候选窗错位、附件被改动、空行格
  吞掉相邻行。
- **记录**：`.local/acceptance/<日期>-ime-matrix/g3/<位置>/notes.md` + 截图；软折行格另存
  窗口宽度、折行边界截图与外部编辑器粘贴结果。

## G4 组合中切焦点

- **触发面**：焦点管理、pane 切换、transcript / 附件交互、窗口激活与失活。
- **前置正观测**：G0 成立；caret 在第二行；组合 `ni`（或 `nihao`）后 marked text 与候选窗
  可见，截图记录。
- **操作**（每项单独执行，执行前恢复基线并重新进入组合态）：
  1. 组合中点击编辑器正文。
  2. 组合中点击 composer 里的附件卡片，或点附件 × 移除钮。
  3. 组合中 ⌘Tab 切到别的 app，再切回 Lumir。
  4. 组合中点击 harness 面板外的区域（标签栏或文件树），再点回 composer。
- **预期（不变量）**：
  - 任一焦点切换都不得触发发送。
  - 不得丢失已提交文本，不得重复提交组合文本。
  - 附件只按用户点击的动作变化，不因组合取消 / 提交而增删或复制。
  - 回到 composer 后 caret 可继续编辑，组合状态已结束（要么提交、要么取消）。
- **探索读数（不预设结论）**：焦点切换时组合是提交还是取消，由 WebKit / 输入法决定；每组
  记录实际结果与截图，**不要把「取消」或「提交」某一方预写成唯一正确**；只有上面的不变量
  被破坏才判 FAIL。
- **FAIL 签名**：切焦点触发发送、文本丢失或重复、附件意外增删、app 崩溃或白屏。
- **记录**：`.local/acceptance/<日期>-ime-matrix/g4/<case>/notes.md` + 切换前后截图，并写明
  实际是提交还是取消。

## G5 组合中撤销 / 重做

- **触发面**：CM history、undo / redo 键路、附件 history、`composerAttachmentsField`。
- **重启复位（每个编号 case 前必须执行）**：G5 直接断言 CM history；用删除、重打、撤销或
  重做把文本 / 附件「摆回」G0，会往同一个 history 追加条目，复位动作本身就会成为下一个
  ⌘Z 的目标（review 现场：case 1 之后用复位回基线，case 2 取消组合后 ⌘Z 可能撤销的是复位
  的删除 / 重键，而不是本 case 的提交）。因此每个编号 case 都用**全新实例 + 全新 composer
  history** 建立 G0，不得复用上一 case 的实例、history 或 composer state：
  1. 正常退出当前实例：⌘Q（或应用「退出」菜单），用
     `ps aux | grep '[t]arget/debug/lumir'` 确认本次 pid 已不在列表里；不用 SIGKILL，
     不保留旧实例。
  2. 重跑 `node scripts/acceptance/run.mjs 262 --keep-app`，等自动段 PASS，两行探针
     `hnl-imx-a` / `hnl-imx-b` 在 composer 中可见；把本次 run 的证据目录抄进该 case 的
     notes。
  3. 重新执行 G0 的附件建立：编辑器选中一段文字 → 点「摘录到对话」→ 正观测 tray 出处行与
     ×；记录附件内容与顺序。
  4. 真实鼠标点 composer 第二行行尾，确认 `focus-within`；截图记录本次 case 的 G0 基线。
  5. 重启或附件建立失败 ⇒ 该 case `BLOCKED`，不得用编辑动作凑一个看似相同的基线继续。
- **本 case 的撤销目标**：全新实例的 history 里已有 runner 打字与 G0 附件两步；为避免 undo
  落到这些 setup 上，case 1 / 2 在 G0 后先**提交本 case 自有的 sentinel「我」**（组合 `wo`
  并提交，截图记录「我」在 composer 中），再开始该 case 的动作；case 3 / 4 的候选提交本身
  就是本 case 的撤销目标；case 5 新加的第二张附件就是目标。**不得**把 runner 打字、G0 附件
  或复位动作当作被测撤销目标。
- **前置正观测**：每个 case 的重启复位步骤 1–4 全部成立；case 1 / 2 的 sentinel「我」已提交
  并截图；该 case 的 run 证据路径、基线截图、附件读数写进 `g5/<case>/notes.md`。
- **操作**（每个 case 都从本次新建的 G0 开始；case 结束后直接进入下一 case 的重启复位，
  不靠 ⌘Z / Backspace 回基线）：
  1. 提交 sentinel `wo`（我）后，组合 `ni`（marked text 可见）并直接按 ⌘Z（不先 Esc），
     记录实际结果。
  2. 提交 sentinel `wo`（我）后，组合 `ni` 并按 Esc 取消，再立即按 ⌘Z。
  3. 组合 `ni` 并提交候选，再按 ⌘Z。
  4. 组合 `ni` 并提交候选，按 ⌘Z，再按 ⌘⇧Z（或 ⌘Y）重做；redo 只重做本 case 自己的撤销。
  5. 从编辑器再摘录一段，新加第二张附件后 ⌘Z，再 ⌘⇧Z；before / after 都记录两张附件的顺序。
- **预期**：
  - 五个 case 各自在全新实例 / 全新 history 中执行，case 之间不共享撤销栈，也不共享
    composer state。
  - case 1：⌘Z 的实际结果按产品行为记录；不得发送、不得留下残段、不得改动 G0 附件或两行
    基线。若撤销的是 sentinel「我」，记录为实际读数，不算 FAIL。
  - case 2：Esc 取消不产生本 case 的提交；随后的 ⌘Z 必须撤销本 case 的 sentinel「我」，
    文本回到两行基线，附件与 G0 基线不动。撤销到 G0 附件 / runner 打字 ⇒ FAIL。
  - case 3 / 4：undo 的目标是本 case 刚提交的候选；undo 回到两行基线，redo 精确恢复，
    不重复插入；附件不动。
  - case 5：附件操作是一步；undo 只移除本 case 新加的第二张，G0 附件保留；redo 恢复第二张，
    顺序与 before 一致。
  - 任何 case 都不得一次 undo 撤销多步、不得吞掉 G0 附件、不得崩溃。
- **FAIL 签名**：一次 undo 撤销多步、undo 吞掉 G0 附件或基线文本、redo 重复插入、组合期
  undo 留下残段或崩溃、undo 目标落到 runner 打字 / G0 附件 / 复位动作（而不是本 case 的
  sentinel 或候选 / 新加附件）。
- **记录**：`.local/acceptance/<日期>-ime-matrix/g5/<case>/notes.md`，每个 case 记录本次 run
  证据路径、重启与 sentinel 截图、每步后 composer 原文、附件数量与顺序、截图。

## G6 组合中粘贴

- **触发面**：paste 处理器、剪贴板、附件装配、发送内容构造。
- **前置正观测**：G0 成立；先在外部纯文本编辑器准备四份内容：单行 `PASTE-ONE`、多行
  `LINE-1` / `LINE-2`、另一段单行文本、浏览器里一段带格式的文字；**每个编号 case 前重新
  复制并核对当次所需的剪贴板内容**，不得沿用上一 case 的剪贴板；caret 在第二行。
- **操作**（每个编号 case 前先按「基线复位」执行；case 1 / 2 / 3 的组合从复位后的基线独立
  开始，不得沿用上一 case 的候选窗或 marked text）：
  1. 组合 `ni`（marked text 与候选窗可见），按 ⌘V 粘贴 `PASTE-ONE`。
  2. 组合 `ni`（重新进入组合态，marked text 与候选窗可见），粘贴多行文本
     `LINE-1` / `LINE-2`。
  3. 组合并提交一个候选，然后立即 ⌘V 粘贴另一段单行文本。
  4. 先在浏览器复制并核对一段带格式的文字（剪贴板预置），回到 composer 组合 `shi`
     （marked text 与候选窗可见），按 ⌘V 粘贴。
- **预期（不变量）**：
  - 四个 case 独立复位；每个 case 的剪贴板内容都重新核对过，不跨 case 复用。
  - 粘贴永不触发发送。
  - 已提交文本不丢失、不重复；组合与粘贴的先后关系记录为实际读数。
  - 多行粘贴保留换行，不塌成一行。
  - 富文本退化为纯文本，不带样式或 HTML。
  - 附件内容、顺序、× 钮不变；粘贴文本不进入 tray。
- **FAIL 签名**：粘贴触发发送、文本重复或丢失、换行丢失、富文本样式进入源码、附件变化、
  case 间状态串扰（上一 case 的残留文本或剪贴板内容被带进下一 case）。
- **记录**：`.local/acceptance/<日期>-ime-matrix/g6/notes.md` + 每次复位与粘贴前后截图 +
  每次粘贴内容原文（多行内容逐行记录）。

## 证据与记录位置

自动段证据（runner 产出，git 外）：

```
.local/acceptance/<YYYY-MM-DD>/262-native-ime-exploration/
├── status.txt
├── steps.md
├── shots/
└── ax/
```

人工矩阵证据（git 外，按运行日期新建，不与自动段目录混用）：

```
.local/acceptance/<YYYY-MM-DD>-ime-matrix/
├── env.md          # 版本 / macOS / 输入法 / 窗口尺寸 / 自动段证据路径 / 基线文本与附件
├── ledger.md       # 一表：组 / 选组原因 / 前置 / 结果 / 证据路径
├── g0/notes.md     # 可选；G0 的主记录是 env.md
├── g1/notes.md + raw.txt + shots/
├── g2/notes.md + shots/
├── g3/<位置>/notes.md + shots/
├── g4/<case>/notes.md + shots/
├── g5/<case>/notes.md + shots/
└── g6/notes.md + shots/
```

`ledger.md` 每组一行，结果只用四态：`NATIVE_IME_PASS`（该组预期全部成立）、
`NATIVE_IME_FAIL`（前置成立但出现 FAIL 签名）、`NATIVE_IME_BLOCKED`（前置不成立，native 未
执行）、`NATIVE_IME_NOT_RUN`（该组未选或尚未执行——自动段刚跑完时的默认态，不写 PASS）。
报告里 `NATIVE_IME_UNREACHED` 仍只指整条通道不可达的既有边界，不与这四态混用。

## 失败保留现场

任一 FAIL 签名出现时：

1. 立即停手：不重跑场景、不退出 app、不切走输入法、不修改文档、不更新任何基线。
2. 截全窗截图；候选窗仍在时连候选窗一起截；记下原始拼音串、候选列表、caret 位置、tray
   附件内容与顺序。
3. 需要 AX 读数时不要自行重启实例：保持窗口不动，通知 tower，由 agent 用 KimiCU 取 AX
   dump 后再继续。
4. 在 `ledger.md` 把该组标 `NATIVE_IME_FAIL`，写 FAIL 签名与证据路径；证据目录保留，不清理。
5. 只有前置不成立（候选窗没出现、输入法没切过去、焦点不在 composer、附件未建立）时才可标
   `NATIVE_IME_BLOCKED`；已经看到产品签名之后不得再降级成 BLOCKED。
6. 若 app 崩溃或白屏，不自行重启：先记录时间与操作序列，通知 tower 取崩溃现场。
7. 证据取完、现场确认可丢弃后，按正常流程退出 app（⌘Q 或应用「退出」菜单），禁止 SIGKILL；
   `--keep-app` 留下的实例同样按这条收尾，否则会挡住下一次跑批。

## 判据边界（如实声明）

- **自动段**只证明「两行探针 + composer 可聚焦」这一现场成立；它不覆盖原生组合、候选窗、
  marked text、候选选择、发送门与撤销的真实 TSM 行为。
- **光标 / 选区在 AX 层不可断言**：G3 的位置正观测与 G4 的焦点状态都以截图 + 相邻文本为准，
  这让「位置对不对」带人工判读成分，属于本矩阵的既定边界，不写成机器判据。
- **候选列表随系统输入法与版本变化**：矩阵不钉死候选字，只要求记录当次实际候选与选择方式；
  同一拼音在不同机器上提交不同字不判 FAIL，提交不落在 caret 或触发发送才判 FAIL。
- **起草时未跑真机**：本场景于 2026-11-19 起草，任务范围只写场景与文档，未启动真机、
  未生成人工结论。首次执行后把 run 证据路径与 ledger 结论补进本节，不得在未执行时预填 PASS。
- **与 156 的分工**：156 是 composer IME 的固定最小人工终判（两行 + 附件 + Backspace / Esc /
  候选提交 / 确认窗内外 Enter / 撤销）；262 是**按变更面选组**的探索矩阵，覆盖 156 未展开的
  候选选择方式、位置矩阵、切焦点与组合中粘贴。两者都保留，不互相替代。机器合成组合覆盖归
  `tests/visual/scenes/m831-harness-composer-codemirror.spec.ts`（Chromium CDP）与 m361 adapter；
  它们只证明引擎序，不冒充 WKWebView 原生拼音，也不替代本矩阵的人工终判。
