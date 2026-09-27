# Tasks: code-block-fullscreen

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，
不是「跑过了」的口头声明（[REVIEW.md](../../../REVIEW.md) 第 7 条）。

**提案阶段状态（M262，2026-09-27）**：本 change 只到评审节点 1，以下任务**全部未开工**——
`[ ]` 是提案阶段的默认状态。推荐项的形态已写进 `specs/` 增量；裁决改备选时先改
[proposal.md](proposal.md) 的裁决点表与 delta，再按改后的口径落 tasks，不静默扩 scope。
实现批次接手时按第 1 节的现状读数起手，并把每条任务勾选时的证据指针补进本文件。

## 0. 提案状态与编号声明

- [ ] 0.1 节点 1 裁决（Alex）：五项裁决点（`proposal.md` 的裁决点表 1–5）取值确认；
      改备选的按「备选」列改写 delta 与下列任务。
      **验收口径**：裁决结论落 [proposal.md](proposal.md)（就地补一行「裁决记录」）后再动工。
- [x] 0.2 场景编号登记并广播（M262 提案期已做）。
      **编号声明**：真机场景取 **57**（实现期落到 `scripts/acceptance/scenarios/57-code-block-fullscreen.md`）。
      依据（2026-09-27 实测）：本 mission base tip `6e9f024` 上 `scripts/acceptance/scenarios/`
      现有最大编号 **50**（`50-tab-context-menu.md`），master 上另有 **52**（`52-dir-rename-expand.md`，
      M258 已合并）；**51 = M257**（已合并）、**53 = M259**（已广播登记）、
      **54 = M260**（change `bare-url-cmd-click/tasks.md:78-80` 已声明）、
      **55 = M267**（change `ui-language-i18n/tasks.md:132-136` 已声明）、
      **56 = M261**（change `goto-line-command/tasks.md:68-70` 已声明）。tower 批次简报指派
      M262 取 57、M263 取 58。已按 M230/M234 的编号协议向 tower 广播登记
      （`.tower/comms/inbox/` 的 `20260927-worker-proposal-code-fs-b-all-57-…`）。
      **实现期动工前按 `openspec/changes/archive/2026-09-27-list-tab-indent/tasks.md` §6 的纪律
      再核一次目录与在飞 change 的编号声明，不盲取。**

## 1. 现状读数与反向验证（实现前，先测再改）

- [ ] 1.1 取一次**现状读数**：在含①一块短围栏块 + ②一块超长行块 + ③一块缩进代码块 +
      ④一块接近 64 KiB 的块的 md 文档里，记录 ① 浮层节点不存在（DOM 计数为 0）、
      ② 三块的计算样式基线（字体 / 字号 / 行高 / 底板色 / 头部条字号与字距）、
      ③ 每块的行数、**已渲染行数**与 DOM 节点数（对照 CM 的视口语义）、
      ④ `code_block_wrap = true` 下同一份文档的 DOM 形状（容器不存在）。
      **验收口径**：读数落 `test-results/acceptance/<日期>/code-block-fullscreen-before/readings.json`
      （可 `ls`）；与 [design.md](design.md) §1 的锚点描述一致，或如实记录不一致并改 design。
- [ ] 1.2 反向验证（先红，REVIEW.md 第 1 条防线）：把「触发入口 → 浮层可见且内容几何非零」与
      「浮层内容文本 = 该块源码逐字节」两条断言先写出来，在**未实现前**跑一次，必须 FAIL。
      **验收口径**：红灯输出留档（playwright 失败信息）；没有这一步的绿灯不算数。
- [ ] 1.3 核对内容重建的观感保真（design §2.2 的机制风险）：用 1.1 的基线做一次实验——
      在浮层容器上镜像编辑器根的主题 scope 类后，同一块代码的字体 / 字号 / 行高 / 底板 /
      头部条 / token 配色是否与文档内逐项一致；不一致的项写进实现 PR 并回改 design。
      **验收口径**：结论写进 PR；若镜像机制覆盖不到某些规则（例如行样式），回来改 design 再动手，
      MUST NOT 就地复制一份规则值（REVIEW.md 第 8 条）。

## 2. 实现：浮层本体与内容重建

- [ ] 2.1 新增 `src/code-block-fullscreen.ts`（与 `src/table-fullscreen.ts` / `src/lightbox.ts`
      同级同形）：遮罩 + 居中面板壳 + 内容容器、`role="dialog"` + `aria-modal="true"` +
      `tabIndex=-1`、`open(block, label)` / `close(reason)` 单入口状态机、就地 `Esc`
      （`keyToken` 归一化）、DOM 惰性建立。读屏名由 `Markdown 代码块 N` 的**同一生成处**产出
      （单一来源是一个函数，MUST NOT 另写一份字面量）。
      **验收口径**：模块内只有一处 `close` 收尾；`grep -n "invoke\|fs_read" src/code-block-fullscreen.ts`
      零命中；`Esc` 不入 `KEY_BINDINGS`（`git diff src/keys.ts` 只有命令登记那几处）。
- [ ] 2.2 内容重建：块的整块源码按行切分（围栏行有 `CodeMark` 时以头部条形态呈现）、
      着色取既有 `highlightCode(codeText, info)`、行与 token 复用既有 class
      （`cm-lp-codeblock-line` / `cm-lp-codeblock-head` / `cm-lp-tok-*`）、容器镜像主题 scope 类
      并补齐编辑器作用域 token；MUST NOT 另写语言表、色值映射或行样式。
      **验收口径**：源码文本与浮层内容文本逐字节一致（含超出文档视口的部分，5.x 断言）；
      `git diff src/preview/code.ts` 为空；计算样式对照 1.1 基线（5.4）。
- [ ] 2.3 内容上界（design §6）：块源码 ≤ 64 KiB 按「行 + token」呈现；> 64 KiB 以单块纯文本
      呈现整块源码（不逐行建 DOM、不着色），源码逐字节一致。
      **验收口径**：两侧各一条断言——普通块的行节点数 > 1 且文本一致；超限块的文本逐字节一致
      且**节点数有界**（不随行数线性增长）。阈值 MUST NOT 在浮层侧另立新常量（复用
      `src/preview/code.ts` 的既有上限或其同一来源）。
- [ ] 2.4 折行口径（design §5）：`code_block_wrap = false` 时浮层内行不折行、超长行由浮层容器
      横向滚动到达；`true` 时行在浮层内折行、无横向滚动。MUST NOT 在浮层内引入第二个折行开关。
      **验收口径**：两种配置下各一条几何断言（不折行：`scrollWidth > clientWidth` 且滚动后
      `scrollLeft` 变化；折行：`scrollWidth === clientWidth`），并与同配置下文档内的折行行为对照。
- [ ] 2.5 浮层容器 MUST NOT 带 `cm-lp-block-scroll` class（design §8 的边界条目）：浮层内滚动走
      原生路径，MUST NOT 新增统一键位表条目。
      **验收口径**：断言浮层内容容器不含该 class；浮层持焦时按 `→`/`End` 等键，事件不被
      `editor.widget-scroll-*` 消费（`git diff src/keys.ts` 无新绑定）。
- [ ] 2.6 文档代际变化（外部重载）时浮层按 `blur` 口径关闭且不抢焦点。
      **验收口径**：视觉场景里模拟文档代际推进（或装配层注入代际钩子）断言浮层关闭且焦点不被拽回；
      真机层如实记为覆盖边界（M240 的同款边界，见 §6）。
- [ ] 2.7 实测近上限块（≥60 KiB 源码）的打开耗时与 DOM 规模（design §6）。
      **验收口径**：读数落 `test-results/` 并写进 PR；超出「用户主动动作可感知」档时如实记为
      已知边界并另立 finding，MUST NOT 宣称「无成本」。

## 3. 实现：入口与键位

- [ ] 3.1 `src/keys.ts`：命令 id `code-block.toggle-fullscreen` 进 `COMMAND_IDS` /
      `GLOBAL_COMMAND_IDS`，登记 `KEYLESS_COMMAND_IDS`（注释写明「默认不绑键」的来由与作用域取
      global 的理由，照 `table.toggle-fullscreen` 的行文）。
      **验收口径**：装配期对账（无重复绑定 / 无孤儿命令 / 清单与绑定表无交集）PASS；
      命中条件不满足时事件不被消费（不 `preventDefault`）。
- [ ] 3.2 命中判定 `codeBlockAt(view, pos)`：返回 `{ from, to, index, info }`，
      **与装饰层同一遍历、同一发现范围**（视口有界，MUST NOT 全文档扫描），
      「在不在块里」复用既有 `codeblockOnLine` 的判定（MUST NOT 另写一份语法树遍历）。
      **验收口径**：单测覆盖 caret 在块内 / 块外 / 缩进块内 / 两种折行口径；块序数与装饰层的
      读屏名一致（同场景断言 `Markdown 代码块 N` 的 N 与文档内容器相同）。
- [ ] 3.3 slot 包装层 `.cm-lp-codeblock-slot`（rank 20，零足迹）**在 md 模式无条件安装**；
      折行口径下内侧横滚容器仍不存在（既有行为不变）。
      **验收口径**：折行两口径下块的可视盒都存在 slot（`position: relative`）、
      `git diff` 里 `codeBlockWrappers` 的折行条件未被删；静止态零视觉变化（5.8）。
- [ ] 3.4 触发钮 `src/preview/codeblock-trigger.ts`：`Decoration.widget` 挂在块首行行首、
      绝对定位在 slot 内（`top: 6px; right: 6px`）、四角框字形、`aria-label` 取 deck D152、
      `mousedown` 先 `preventDefault`；静止态 `visibility: hidden`。
      **验收口径**：hover 前钮不进读屏树、不可聚焦、不接收指针（DOM + AX 两条）；hover 后出现在
      块可视盒右上角内侧；内容横滚时钮不动（几何断言）。
- [ ] 3.5 接线：`PreviewContext` 增可选口子（`codeBlockFullscreen()`，未接线返回 `null`，同
      `lightbox()` / `tableFullscreen()` 口径），`src/main.ts` 装配（挂点 `shell.root`）与命令级门。
      **`restoreFocus` 写成「取阅读位置 → `view.focus()` → 写回」**（design §5.1）：取快照 MUST 在
      聚焦之前、三步同帧；写回走 `src/editor.ts:2027-2090` 的 `readScrollPosition()` /
      `applyScrollPosition()`（装配侧注入点 `src/main.ts:634-635` 的 `readPosition` / `applyPosition`），
      **MUST NOT 裸写 `scrollDOM.scrollTop`**（CM 的滚动锚点簿记会改掉它）。
      **落地次序核对**：实现期先核 M274 的修复是否已落地 `editor.focusPreservingReadingPosition()`
      ——已落地则直接复用该原语（不再在本 change 里写三步序列），未落地则按上式实现；
      两种情形都写进 PR（REVIEW.md 第 8 条：同一语义不两处实现）。
      **验收口径**：未接线路径（单测 / 桩）不抛错、命令命中条件为假；`git diff --stat src-tauri/`
      为空；`git diff src/main.ts` 的浮层装配段里，`restoreFocus` 指向三步序列或复用的原语，
      且**新增行里不出现 `scrollDOM.scrollTop` / `scrollLeft` 的赋值**（`src/main.ts:440` 那条
      M149 的既有注释不算，判据按 diff 的新增行看，不按全文件 grep）。
- [ ] 3.6 code 模式（非 md 文件）与块外：命中条件为假、不消费事件、无提示、无容器。
      **验收口径**：行为判据（命令触发后浮层计数为 0 且事件落到原生路径）+ 同场景正观测
      （md 文档里 caret 进块后触发成功）——负向断言 MUST 配正观测（REVIEW.md 第 2 条）。

## 4. 单测（`tests/unit`，纯逻辑层）

- [ ] 4.1 浮层状态机用例：四条关闭路径（`Esc` / 遮罩点击 / toggle / `blur`）回同一个 `close`、
      前三条交还焦点 / `blur` 不抢、已关闭后的迟到关闭是空操作、toggle 的开-关-开序列。
      **验收口径**：`node tests/unit/run.mjs` PASS，新增用例数写进 PR；注入假 surface
      （不造 DOM 替身，`tests/unit/README.md` 分工）。
- [ ] 4.2 内容重建的纯逻辑用例：源码 → 行 / token 切分（含围栏行判定、缩进块无头部条）、
      >64 KiB 退化分支、info string 缺失 / 未收录语言（不着色）、token class 与
      `highlightCode` 输出一致。
      **验收口径**：纯函数层断言，不依赖 DOM；`git diff tests/unit/harness.ts` 为空。
- [ ] 4.3 命中条件用例：caret 在块内 / 块外 / 缩进块内 / 容器持焦 / 浮层已开（toggle）/
      code 模式文件内（恒假）。
      **验收口径**：纯模型层断言；块序数与装饰层同源（同一函数的输出对照）。

## 5. 视觉场景（chromium，CI 结构层 + 本地像素层）

- [ ] 5.1 新增断言组（新场景文件 `tests/visual/scenes/m2xx-code-block-fullscreen.spec.ts` +
      fixture）：触发入口 → 浮层可见**且内容渲染盒宽高非零**、读屏名在场。判据取几何读数与 AX
      锚点，不用 class 存在（REVIEW.md 第 1 条）；1.2 的红灯在此转绿。
- [ ] 5.2 三条关闭路径（`Esc` / 点击遮罩 / toggle）各一条断言 + 关闭后焦点在编辑器
      （行为判据：关闭后 `⌃D` 真的删掉一个字符，前后 `docText` 差异恰好是那个字符，再 `⌘Z` 复位）。
      **同一组必须带位置不变量**：先把编辑器滚到离文档顶超过一屏的位置、caret 留在视口之外，
      记录关闭前后的 `scrollTop` / `scrollLeft` 与当前渲染行的文档位置，三者**逐值不变**。只断
      「焦点回编辑器」会让「焦点对了、阅读位置被拽走」的形态静默通过——M240 漏掉的正是这一面，
      形态与依据见 design §5.1。
      **如实标注覆盖层**：这组读数在 chromium 上**读得到、判不出**（M274 §2.2 的消融实验里
      chromium 全绿、WebKit 才跳）⇒ 本层是回归护栏，**判别层是真机场景 57（§6.1）的渲染行读数
      与 `blur` 兜底路径**（真机 AX 不暴露 `scrollTop`，判据只能用渲染行，见 §6.1 的边界说明）；
      实现期 MUST NOT 只凭本层绿灯宣称这条已验。
      **验收口径**：三条路径各自可单独读出，MUST NOT 合并成一条「关闭后浮层不可见」；
      焦点断言与位置断言分成两条可分别读出的判据。
- [ ] 5.3 不穿透与不动文档：浮层打开期间按 `⌃D` / `⌃K` / `⌃A` / `Tab` / 字符键，断言 `docText`
      逐字节不变、caret 不动、焦点仍在浮层；打开与关闭前后 `docText` / caret 逐值不变；
      用例末尾 `readDocument(page)` 与 fixture 逐字节相同（ADR 0003 §3）。
- [ ] 5.4 内容保真：浮层内容文本与源码逐字节一致（**含超出文档视口的行**）；计算样式对照 1.1
      基线（字体 / 字号 / 行高 / 底板 / 头部条 / token 配色）；缩进代码块无头部条且文本一致。
      **验收口径**：反向验证——摘掉主题 scope 镜像（或去掉块判定）后本组必须红，红灯留档。
- [ ] 5.5 折行两口径（对应 2.4）：不折行 ⇒ 横向可滚；折行 ⇒ 无横向滚动且长行在浮层内折行。
- [ ] 5.6 内容上界（对应 2.3）：普通块与 >64 KiB 块各一条——后者文本逐字节一致、节点数有界。
- [ ] 5.7 无入口的负向断言 + 正观测：块外 caret、code 模式文件、缩进块（正观测：可放大）。
- [ ] 5.8 基线核对（REVIEW.md 第 3 条 + AGENTS.md 视觉门禁卫生）：推荐项下静止态零视觉变化
      （slot 层零足迹、钮 rest 态不绘制），逐张核对含代码块的场景（`grep -rln` 定位）与全部整页
      基线；浮层是新元素，截图请 Alex 过目（不机械 `--update`）。
      **验收口径**：PR 写明「零基线更新」或列出新增 / 重拍清单；核对方式落内容判据，不只看时间戳。

## 6. 真机验收场景（WKWebView，`scripts/acceptance/`）

- [ ] 6.1 新增场景 `scripts/acceptance/scenarios/57-code-block-fullscreen.md` + fixture
      （编号声明见 §0；实现期动工前再核一次目录）。fixture 一份 md 含：① 一块短围栏块
      （含超长行）、② 一块长块（行数明显超过一屏）、③ 一块缩进代码块、④ 一段正文段落；
      **文档总长 ≥3 屏，且首 / 尾各有一段可辨识的行串**（首尾相距 ≥3 屏才互不落在 AX 渲染窗内）
      ——阅读位置不变量的判据用「哪些行在 AX 渲染行里」（口径见本条的判别层说明与场景 25 的说明节）。
      触发走 `[keys]` 配置绑定（`09b-keys-config` 先例，推荐项默认不绑键）。
      断言：浮层 AX 几何非零 + 块内一段**只在视口外**的文本在场（两条一起钉，防「AX 文本可读 ≠
      元素可见」）；`Esc` 关闭后焦点回编辑器**且阅读位置不变**（渲染行判据对）；
      块外 / 正文段落里触发无浮层（配对正观测）；
      末尾 `editor.unchangedSince` 与磁盘 `unchangedSince` 两条独立断言（ADR 0003 §3）。
      **场景草案**（front-matter 与步骤骨架，实现期直接落文件）：

      ```markdown
      ---
      id: "57-code-block-fullscreen"
      item: 57
      title: 代码块放大全屏查看：命令打开遮罩、整块源码在场（含视口外的行）、Esc 关闭焦点回编辑器、块外无入口、不改写源文件
      fixtures: [code-block-fullscreen.md]
      open: code-block-fullscreen.md
      marker: "代码块全屏场景"
      config:
        keys: { "Cmd-j": "code-block.toggle-fullscreen" }
      steps:
        - name: 终态：三块代码块在场（围栏块 / 长块 / 缩进块），正文段落就位
          expect:
            - label: 围栏块渲染为代码块 region（AX 名取自既有生成处）
              ax: { has: "AXGroup (Markdown 代码块 1)" }   # role 以实现期实测的 AX 原文为准
            - label: 长块的首行文本在场（下面用它证明浮层里能看到「不止视口那一段」）
              ax: { has: "<长块关键词-A>" }
            - label: 文档首两行在渲染行里（位置判据的正观测支点）
              ax: { has: "<文档首两行合并串>" }
            # AX 只给可见区 ± ~1000px 的行建节点（判据口径见场景 25 的说明节）；
            # fixture 须 ≥3 屏且首 / 尾各有可辨识的行串
            - label: 文档尾两行此刻不在 AX 里
              ax: { not: "<文档尾两行合并串>" }
            - shot: 终态
        - name: 基线：记录编辑器内容与磁盘 sha256（供末尾两条 unchangedSince 比较）
          do: recordEditor
          as: before
        - name: 基线：记录磁盘文件
          do: record
          file: code-block-fullscreen.md
          as: doc
        - name: 负对照·定位：caret 落在正文段落里
          do: clickInNode
          target: { role: "AXParagraph", any: "<段落特征串>" }
          expect:
            - label: 焦点落在编辑器正文里（键盘注入的前置）
              ax: { focused: "AXTextArea" }
        - name: 负对照·执行：在段落里执行 code-block.toggle-fullscreen（⌘J）→ 无浮层
          do: key
          key: "cmd+j"
          expect:
            - label: 浮层未出现（命中条件为假；这条与下面正观测同键对照，防丢键假绿）
              ax: { has: "关闭 code-block-fullscreen.md" }
            - label: 正文未被改写
              editor: { unchangedSince: before }
            - shot: 段落里执行命令后
        - name: 正观测：caret 进长块 → 命令打开浮层，几何非零 + 块文本在场
          do: clickInNode
          target: { role: "AXGroup", any: "Markdown 代码块 2" }
          expect: []
        # 位置前置：⌃V（editor.scroll-page-down）只滚视口、不动光标 ⇒ caret 仍留在长块里、已在
        # 视口上方，正是 M274 判定的触发条件；次数以实现期实测为准，要保证长块整块离开视口
        - name: 位置前置：⌃V 翻屏把视口移到文档尾部，caret 留在视口之外
          do: keys
          keys: [ "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v", "ctrl+v" ]
          expect:
            - label: 长块的首行文本已不在渲染行里（视口真的离开了长块，与浮层里那条同串对照）
              ax: { not: "<长块关键词-A>" }
            # 正观测：AX 此刻读得到，后面的负向断言不得在「读不到」上空转（场景 25 的判据对）
            - label: 文档尾两行在渲染行里
              ax: { has: "<文档尾两行合并串>" }
        - name: 执行 code-block.toggle-fullscreen（经 [keys] 绑定的 ⌘J）
          do: key
          key: "cmd+j"
          expect:
            - label: 浮层里的内容几何读数非零（不可见元素在 AX 里照样有文本行，所以判几何）
              ax: { count: { pattern: "/AX\\w+ \\(Markdown 代码块 2\\) @\\d+,\\d+ [1-9]\\d*×[1-9]\\d*/", exact: 1 } }
            - label: "**只在视口外**的那段文本在场（整块呈现的判据；视口切片方案在这里必红）"
              ax: { has: "<长块关键词-B（位于块尾）>" }
            - label: AX 树被模态接管（标签栏从树里消失 ⇒ 上两条判的是浮层里那份）
              ax: { not: "关闭 code-block-fullscreen.md" }
            - shot: 浮层打开
        - name: 关闭路径一：Esc（就地消费）关闭并交还焦点，且阅读位置不动
          do: key
          key: "escape"
          expect:
            - label: 浮层已退场
              ax: { has: "关闭 code-block-fullscreen.md" }
            - label: 焦点回到编辑器
              ax: { focused: "AXTextArea" }
            # 阅读位置不变量：正观测 + 负向两条一起钉。位置被拽走的形态在这里红（AX 不暴露
            # scrollTop，判据用被测行为自己产出的渲染行，口径与场景 25 同款）
            - label: "**阅读位置不变量**：文档尾两行仍在渲染行里（与位置前置步同一条串）"
              ax: { has: "<文档尾两行合并串>" }
            - label: 长块首行仍不在渲染行里（负向那一半，防上一条在「读不到」上空转）
              ax: { not: "<长块关键词-A>" }
            - shot: Esc 关闭后
        - name: 关闭路径二：点遮罩（面板以外区域）
          # 先证浮层开着 → 点 (600,60) → 断言退场 + 焦点回编辑器 + 阅读位置不变量
          #（与关闭路径一同款的两条渲染行断言：文档尾两行仍在、长块首行仍不在）
        - name: 关闭路径三：再次执行同一命令（toggle）
          # 先证浮层开着 → 再按 ⌘J → 断言退场 + 焦点回编辑器 + 阅读位置不变量（同上两条）
        - name: 缩进代码块同样可放大（正观测：它不是「无入口」的一类）
          # caret 进缩进块 → ⌘J → 断言几何非零 + 文本在场 → Esc
        - name: 全程不改写源文件（ADR 0003 §3）
          expect:
            - label: 编辑器内容与基线逐字节相同
              editor: { unchangedSince: before }
            - label: 磁盘文件 sha256 与基线相同
              file: { path: code-block-fullscreen.md, unchangedSince: doc }
            - shot: 收尾
      ```

      **验收口径**：`node scripts/acceptance/run.mjs --check` 静态校验 PASS；
      `node scripts/acceptance/run.mjs 57` 真机 PASS，证据落
      `test-results/acceptance/<日期>/57-code-block-fullscreen/`（`status.txt` = PASS）；
      实现期以实测的 AX 原文替换草案里 `#` 标注的占位判据（role 名与特征串），
      MUST NOT 把「未实测的匹配器」留进场景。

      **阅读位置不变量的判别层与表达力边界（如实标注，M274 §6.2 / 场景 25 的说明节）**：
      套件不暴露 `scrollTop`（整窗只有一个 `AXScrollArea`），也不提供 `scroll` 动作
      （`docs/backlog.md` 的「套件缺 scroll 动作与页内采样」条，M252 实测该通道在本 app 上产不出滚动），
      所以本场景用**渲染行**当判据（AX 只给可见区 ± ~1000px 的行建节点）。这条判据在真机是**判别层**
      ——chromium 层结构性看不见该缺陷（M274 §2.2 的消融实验：chromium 全绿、WebKit 才跳），
      但表达力上只覆盖整屏级跳变，小幅漂移属手感、归 Alex 人肉（同场景 25 的口径）。
      另如实记录：能驱动的关闭路径是「⌥V/⌃V 翻屏把视口移开 + caret 留在块内」这一族；
      `blur` 兜底（焦点被别处拿走）在真机的驱动方式由实现期定，若无法在不换文档的前提下驱动，
      就在 PR 里如实写「该路径真机未覆盖」——MUST NOT 拿 ESC 路径的绿灯冒充它。
- [ ] 6.2 真机反向验证：去掉入口触发（把场景 front-matter 的 `config.keys` 改成不绑定）后复跑
      同一场景，正观测侧断言必须 FAIL，FAIL 留档（结果目录另开，不覆盖 PASS 证据）。
- [ ] 6.3 不改写源文件的真机判据：`editor.unchangedSince` 与磁盘 `unchangedSince` 两条独立断言
      在位且 PASS（ADR 0003 §3）。
- [ ] 6.4 维护权一致（AGENTS.md）：实现 PR 必须同时含场景 md 与 fixture；手感层（浮层内滚动节奏、
      长块观感、文本选中体验）归 Alex dogfood，套件只留截图。

## 7. 文案 deck

- [ ] 7.1 新增 deck 条目 **D152**（末位当前 D151，`文案-Copy.md:143`）：
      「代码块全屏触发钮的读屏名」= **「放大查看代码块」**（与 D124「放大查看表格」同族），
      并在文末「文案实现备注」段补一条：该串由 `src/preview/codeblock-trigger.ts` 的常量持有，
      `tests/unit/*` 按 deck 表格行逐字断言，两边漂移即红。
      **浮层自己的读屏名不新增条目**：复用 `Markdown 代码块 N` 的既有生成处。
      **验收口径**：deck 一行 + 备注段一条，且实现里的串与 deck 逐字一致；
      `git diff 文案-Copy.md` 恰好是这两处（无其它行被改）。
      已知相依（design §9）：在飞的 `ui-language-i18n`（M267）若改了这类标签的语言口径，
      本条目随同一条裁决走。

## 8. 验证与收官

- [ ] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过，
      `change/code-block-fullscreen` 为 ✓。
- [ ] 8.2 `bash scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=<自选> bash scripts/gate.sh visual`
      全绿（视觉含像素层，CI 只跑结构层）；真机套件 `node scripts/acceptance/run.mjs 57` 至少跑一次
      并留档（合并后、Alex 验收前，AGENTS.md 执行时机）。
- [ ] 8.3 `git diff --check` 通过；改动文件集合与 [proposal.md](proposal.md) 的 Impact 清单一致
      （出现跨 scope 的只读依赖先报 tower 批准）。
- [ ] 8.4 收官对账：tasks 全部勾选（或标注放弃原因）、spec 增量与实现一致（无实现期静默扩 scope）、
      living spec 归档另走节点 2。

## 9. 已声明的边界 / 不做

- [ ] 9.1 不做 zen 视图 / 新窗口 / 系统预览；浮层内不做编辑（无行号、无搜索 / 跳转 / 折叠、
      无复制按钮）；不做文档内多块导航；浮层内不设第二个折行开关；code 模式（非 md 文件）
      不适用；不改代码块的任何既有内联口径；`src-tauri/**` 零改动。
      **验收口径**：`git diff --stat src-tauri/` 为空；实现里没有「上一块 / 下一块」这类状态。
- [ ] 9.2 已知边界如实写进 spec 与 PR：① 键盘入口默认不绑键（需经 `[keys]` 绑定），
      鼠标入口是 hover 触发钮；② 块源码 >64 KiB 时浮层以单块纯文本呈现（无头部条、无着色），
      与文档内「仍逐行排版」有观感差；③ 折行口径下没有「容器持焦」这条入口（结构性），
      caret 入口照常成立；④ 浮层开着时外部重载的关闭行为以设计口径实现，观感归 Alex；
      ⑤ 打开成本随块长线性、实测读数落 `test-results/`（超档则另立 finding）。
      **验收口径**：五条在 spec 已知边界段与实现 PR 里各有一条对应文字。
