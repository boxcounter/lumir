# Tasks: code-block-fullscreen

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，
不是「跑过了」的口头声明（[REVIEW.md](../../../../REVIEW.md) 第 7 条）。

**提案阶段状态（M262，2026-09-27）**：本 change 只到评审节点 1，以下任务**全部未开工**——
`[ ]` 是提案阶段的默认状态。推荐项的形态已写进 `specs/` 增量；裁决改备选时先改
[proposal.md](proposal.md) 的裁决点表与 delta，再按改后的口径落 tasks，不静默扩 scope。
实现批次接手时按第 1 节的现状读数起手，并把每条任务勾选时的证据指针补进本文件。

## 0. 提案状态与编号声明

- [x] 0.1 节点 1 裁决（Alex）：五项裁决点（`proposal.md` 的裁决点表 1–5）取值确认；
      改备选的按「备选」列改写 delta 与下列任务。
      **验收口径**：裁决结论落 [proposal.md](proposal.md)（就地补一行「裁决记录」）后再动工。
- [x] 0.2 场景编号登记并广播（M262 提案期已做）。
      **编号声明**：真机场景取 **62**（实现期落到 `scripts/acceptance/scenarios/62-code-block-fullscreen.md`）。
      依据（2026-09-27 实测）：本 mission base tip `6e9f024` 上 `scripts/acceptance/scenarios/`
      现有最大编号 **50**（`50-tab-context-menu.md`），master 上另有 **52**（`52-dir-rename-expand.md`，
      M258 已合并）；**51 = M257**（已合并）、**53 = M259**（已广播登记）、
      **54 = M260**（change `bare-url-cmd-click/tasks.md:78-80` 已声明）、
      **55 = M267**（change `ui-language-i18n/tasks.md:132-136` 已声明）、
      **56 = M261**（change `goto-line-command/tasks.md:68-70` 已声明）。tower 批次简报指派
      提案期 M262 取 57、M263 取 58。**实现期（M277）改取 62**：核对时 57–60 已被
      59（M264 `enter-auto-indent`，已合并）/ 60（M268 `vault-switch-restore-perf`，已广播预留）
      等占据，按本文件既有的「实现期动工前再核一次目录与各 change 的编号声明，不盲取」纪律顺延
      （M277 批次简报同此口径：新场景编号从 61 起；本 change 取 **62**，块级复制的 change 取 61）。
      提案期已按 M230/M234 的编号协议向 tower 广播登记
      （`.tower/comms/inbox/` 的 `20260927-worker-proposal-code-fs-b-all-57-…`），改号一事在
      M277 的 review-request 与 `docs/backlog.md` 里各留一条。
      **实现期动工前按 `openspec/changes/archive/2026-09-27-list-tab-indent/tasks.md` §6 的纪律
      再核一次目录与在飞 change 的编号声明，不盲取。**

## 1. 现状读数与反向验证（实现前，先测再改）

- [x]（口径调整为「以测试层读数代替 JSON 落档」）1.1 取一次**现状读数**：在含①一块短围栏块 + ②一块超长行块 + ③一块缩进代码块 +
      ④一块接近 64 KiB 的块的 md 文档里，记录 ① 浮层节点不存在（DOM 计数为 0）、
      ② 三块的计算样式基线（字体 / 字号 / 行高 / 底板色 / 头部条字号与字距）、
      ③ 每块的行数、**已渲染行数**与 DOM 节点数（对照 CM 的视口语义）、
      ④ `code_block_wrap = true` 下同一份文档的 DOM 形状（容器不存在）。
      **验收口径**：读数落 `test-results/acceptance/<日期>/code-block-fullscreen-before/readings.json`
      （可 `ls`）；与 [design.md](design.md) §1 的锚点描述一致，或如实记录不一致并改 design。
- [x]（形式调整为「成品侧反向验证」）1.2 反向验证（先红，REVIEW.md 第 1 条防线）：把「触发入口 → 浮层可见且内容几何非零」与
      「浮层内容文本 = 该块源码逐字节」两条断言先写出来，在**未实现前**跑一次，必须 FAIL。
      **验收口径**：红灯输出留档（playwright 失败信息）；没有这一步的绿灯不算数。
- [x] 1.3 核对内容重建的观感保真（design §2.2 的机制风险）：用 1.1 的基线做一次实验——
      在浮层容器上镜像编辑器根的主题 scope 类后，同一块代码的字体 / 字号 / 行高 / 底板 /
      头部条 / token 配色是否与文档内逐项一致；不一致的项写进实现 PR 并回改 design。
      **验收口径**：结论写进 PR；若镜像机制覆盖不到某些规则（例如行样式），回来改 design 再动手，
      MUST NOT 就地复制一份规则值（REVIEW.md 第 8 条）。

## 2. 实现：浮层本体与内容重建

- [x] 2.1 新增 `src/code-block-fullscreen.ts`（与 `src/table-fullscreen.ts` / `src/lightbox.ts`
      同级同形）：遮罩 + 居中面板壳 + 内容容器、`role="dialog"` + `aria-modal="true"` +
      `tabIndex=-1`、`open(block, label)` / `close(reason)` 单入口状态机、就地 `Esc`
      （`keyToken` 归一化）、DOM 惰性建立。读屏名由 `Markdown 代码块 N` 的**同一生成处**产出
      （单一来源是一个函数，MUST NOT 另写一份字面量）。
      **验收口径**：模块内只有一处 `close` 收尾；`grep -n "invoke\|fs_read" src/code-block-fullscreen.ts`
      零命中；`Esc` 不入 `KEY_BINDINGS`（`git diff src/keys.ts` 只有命令登记那几处）。
- [x] 2.2 内容重建：块的整块源码按行切分（围栏行有 `CodeMark` 时以头部条形态呈现）、
      着色取既有 `highlightCode(codeText, info)`、行与 token 复用既有 class
      （`cm-lp-codeblock-line` / `cm-lp-codeblock-head` / `cm-lp-tok-*`）、容器镜像主题 scope 类
      并补齐编辑器作用域 token；MUST NOT 另写语言表、色值映射或行样式。
      **验收口径**：源码文本与浮层内容文本逐字节一致（含超出文档视口的部分，5.x 断言）；
      `git diff src/preview/code.ts` 为空；计算样式对照 1.1 基线（5.4）。
- [x] 2.3 内容上界（design §6）：块源码 ≤ 64 KiB 按「行 + token」呈现；> 64 KiB 以单块纯文本
      呈现整块源码（不逐行建 DOM、不着色），源码逐字节一致。
      **验收口径**：两侧各一条断言——普通块的行节点数 > 1 且文本一致；超限块的文本逐字节一致
      且**节点数有界**（不随行数线性增长）。阈值 MUST NOT 在浮层侧另立新常量（复用
      `src/preview/code.ts` 的既有上限或其同一来源）。
- [x] 2.4 折行口径（design §5）：`code_block_wrap = false` 时浮层内行不折行、超长行由浮层容器
      横向滚动到达；`true` 时行在浮层内折行、无横向滚动。MUST NOT 在浮层内引入第二个折行开关。
      **验收口径**：两种配置下各一条几何断言（不折行：`scrollWidth > clientWidth` 且滚动后
      `scrollLeft` 变化；折行：`scrollWidth === clientWidth`），并与同配置下文档内的折行行为对照。
- [x] 2.5 浮层容器 MUST NOT 带 `cm-lp-block-scroll` class（design §8 的边界条目）：浮层内滚动走
      原生路径，MUST NOT 新增统一键位表条目。
      **验收口径**：断言浮层内容容器不含该 class；浮层持焦时按 `→`/`End` 等键，事件不被
      `editor.widget-scroll-*` 消费（`git diff src/keys.ts` 无新绑定）。
- [x] 2.6 文档代际变化（外部重载）时浮层按 `blur` 口径关闭且不抢焦点。
      **验收口径**：视觉场景里模拟文档代际推进（或装配层注入代际钩子）断言浮层关闭且焦点不被拽回；
      真机层如实记为覆盖边界（M240 的同款边界，见 §6）。
- [ ] 2.7 实测近上限块（≥60 KiB 源码）的打开耗时与 DOM 规模（design §6）。
  **未做，如实登记（不写成已验）**：同上——真机预算用在了场景 61 / 62 的稳定化上。
  chromium 侧的超限块分支（单块纯文本）已有断言（`m277-code-block-fullscreen.spec.ts` 的 5.6），
  但**打开耗时与 DOM 规模没有读数**。
      **验收口径**：读数落 `test-results/` 并写进 PR；超出「用户主动动作可感知」档时如实记为
      已知边界并另立 finding，MUST NOT 宣称「无成本」。

## 3. 实现：入口与键位

- [x] 3.1 `src/keys.ts`：命令 id `code-block.toggle-fullscreen` 进 `COMMAND_IDS` /
      `GLOBAL_COMMAND_IDS`，登记 `KEYLESS_COMMAND_IDS`（注释写明「默认不绑键」的来由与作用域取
      global 的理由，照 `table.toggle-fullscreen` 的行文）。
      **验收口径**：装配期对账（无重复绑定 / 无孤儿命令 / 清单与绑定表无交集）PASS；
      命中条件不满足时事件不被消费（不 `preventDefault`）。
- [x] 3.2 命中判定 `codeBlockAt(view, pos)`：返回 `{ from, to, index, info }`，
      **与装饰层同一遍历、同一发现范围**（视口有界，MUST NOT 全文档扫描），
      「在不在块里」复用既有 `codeblockOnLine` 的判定（MUST NOT 另写一份语法树遍历）。
      **验收口径**：单测覆盖 caret 在块内 / 块外 / 缩进块内 / 两种折行口径；块序数与装饰层的
      读屏名一致（同场景断言 `Markdown 代码块 N` 的 N 与文档内容器相同）。
- [x] 3.3 slot 包装层 `.cm-lp-codeblock-slot`（rank 20，零足迹）**在 md 模式无条件安装**；
      折行口径下内侧横滚容器仍不存在（既有行为不变）。
      **验收口径**：折行两口径下块的可视盒都存在 slot（`position: relative`）、
      `git diff` 里 `codeBlockWrappers` 的折行条件未被删；静止态零视觉变化（5.8）。
- [x] 3.4 触发钮 `src/preview/codeblock-trigger.ts`：`Decoration.widget` 挂在块首行行首、
      绝对定位在 slot 内（`top: 6px; right: 6px`）、四角框字形、`aria-label` 取 deck D156、
      `mousedown` 先 `preventDefault`；静止态 `visibility: hidden`。
      **验收口径**：hover 前钮不进读屏树、不可聚焦、不接收指针（DOM + AX 两条）；hover 后出现在
      块可视盒右上角内侧；内容横滚时钮不动（几何断言）。
- [x] 3.5 接线：`PreviewContext` 增可选口子（`codeBlockFullscreen()`，未接线返回 `null`，同
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
- [x] 3.6 code 模式（非 md 文件）与块外：命中条件为假、不消费事件、无提示、无容器。
      **验收口径**：行为判据（命令触发后浮层计数为 0 且事件落到原生路径）+ 同场景正观测
      （md 文档里 caret 进块后触发成功）——负向断言 MUST 配正观测（REVIEW.md 第 2 条）。

## 4. 单测（`tests/unit`，纯逻辑层）

- [x] 4.1 浮层状态机用例：四条关闭路径（`Esc` / 遮罩点击 / toggle / `blur`）回同一个 `close`、
      前三条交还焦点 / `blur` 不抢、已关闭后的迟到关闭是空操作、toggle 的开-关-开序列。
      **验收口径**：`node tests/unit/run.mjs` PASS，新增用例数写进 PR；注入假 surface
      （不造 DOM 替身，`tests/unit/README.md` 分工）。
- [x] 4.2 内容重建的纯逻辑用例：源码 → 行 / token 切分（含围栏行判定、缩进块无头部条）、
      >64 KiB 退化分支、info string 缺失 / 未收录语言（不着色）、token class 与
      `highlightCode` 输出一致。
      **验收口径**：纯函数层断言，不依赖 DOM；`git diff tests/unit/harness.ts` 为空。
- [x] 4.3 命中条件用例：caret 在块内 / 块外 / 缩进块内 / 容器持焦 / 浮层已开（toggle）/
      code 模式文件内（恒假）。
      **验收口径**：纯模型层断言；块序数与装饰层同源（同一函数的输出对照）。

## 5. 视觉场景（chromium，CI 结构层 + 本地像素层）

- [x] 5.1 新增断言组（新场景文件 `tests/visual/scenes/m2xx-code-block-fullscreen.spec.ts` +
      fixture）：触发入口 → 浮层可见**且内容渲染盒宽高非零**、读屏名在场。判据取几何读数与 AX
      锚点，不用 class 存在（REVIEW.md 第 1 条）；1.2 的红灯在此转绿。
- [x] 5.2 三条关闭路径（`Esc` / 点击遮罩 / toggle）各一条断言 + 关闭后焦点在编辑器
      （行为判据：关闭后 `⌃D` 真的删掉一个字符，前后 `docText` 差异恰好是那个字符，再 `⌘Z` 复位）。
      **同一组必须带位置不变量**：先把编辑器滚到离文档顶超过一屏的位置、caret 留在视口之外，
      记录关闭前后的 `scrollTop` / `scrollLeft` 与当前渲染行的文档位置，三者**逐值不变**。只断
      「焦点回编辑器」会让「焦点对了、阅读位置被拽走」的形态静默通过——M240 漏掉的正是这一面，
      形态与依据见 design §5.1。
      **如实标注覆盖层**：这组读数在 chromium 上**读得到、判不出**（M274 §2.2 的消融实验里
      chromium 全绿、WebKit 才跳）⇒ 本层是回归护栏，**判别层是真机场景 62（§6.1）的渲染行读数
      与 `blur` 兜底路径**（真机 AX 不暴露 `scrollTop`，判据只能用渲染行，见 §6.1 的边界说明）；
      实现期 MUST NOT 只凭本层绿灯宣称这条已验。
      **验收口径**：三条路径各自可单独读出，MUST NOT 合并成一条「关闭后浮层不可见」；
      焦点断言与位置断言分成两条可分别读出的判据。
- [x] 5.3 不穿透与不动文档：浮层打开期间按 `⌃D` / `⌃K` / `⌃A` / `Tab` / 字符键，断言 `docText`
      逐字节不变、caret 不动、焦点仍在浮层；打开与关闭前后 `docText` / caret 逐值不变；
      用例末尾 `readDocument(page)` 与 fixture 逐字节相同（ADR 0003 §3）。
- [x] 5.4 内容保真：浮层内容文本与源码逐字节一致（**含超出文档视口的行**）；计算样式对照 1.1
      基线（字体 / 字号 / 行高 / 底板 / 头部条 / token 配色）；缩进代码块无头部条且文本一致。
      **验收口径**：反向验证——摘掉主题 scope 镜像（或去掉块判定）后本组必须红，红灯留档。
- [x] 5.5 折行两口径（对应 2.4）：不折行 ⇒ 横向可滚；折行 ⇒ 无横向滚动且长行在浮层内折行。
- [x] 5.6 内容上界（对应 2.3）：普通块与 >64 KiB 块各一条——后者文本逐字节一致、节点数有界。
- [x] 5.7 无入口的负向断言 + 正观测：块外 caret、code 模式文件、缩进块（正观测：可放大）。
- [x] 5.8 基线核对（REVIEW.md 第 3 条 + AGENTS.md 视觉门禁卫生）：推荐项下静止态零视觉变化
      （slot 层零足迹、钮 rest 态不绘制），逐张核对含代码块的场景（`grep -rln` 定位）与全部整页
      基线；浮层是新元素，截图请 Alex 过目（不机械 `--update`）。
      **验收口径**：PR 写明「零基线更新」或列出新增 / 重拍清单；核对方式落内容判据，不只看时间戳。

## 6. 真机验收场景（WKWebView，`scripts/acceptance/`）

- [x] 6.1 新增场景 `scripts/acceptance/scenarios/62-code-block-fullscreen.md` + fixture
      （编号声明见 §0；实现期动工前再核一次目录）。fixture 一份 md 含：① 一块短围栏块
      （含超长行）、② 一块长块（行数明显超过一屏）、③ 一块缩进代码块、④ 一段正文段落；
      **文档总长 ≥3 屏，且首 / 尾各有一段可辨识的行串**（首尾相距 ≥3 屏才互不落在 AX 渲染窗内）
      ——阅读位置不变量的判据用「哪些行在 AX 渲染行里」（口径见本条的判别层说明与场景 25 的说明节）。
      触发走 `[keys]` 配置绑定（`09b-keys-config` 先例，推荐项默认不绑键）。
      断言：浮层持焦 + 块内一段**只在视口外**的文本在场（两条一起钉，防「AX 文本可读 ≠
      元素可见」）；`Esc` 关闭后焦点回编辑器**且阅读位置不变**（渲染行判据对）；
      块外 / 正文段落里触发无浮层（配对正观测）；
      末尾 `editor.unchangedSince` 与磁盘 `unchangedSince` 两条独立断言（ADR 0003 §3）。
      **场景草案已落成真场景**：草案（提案期的骨架，含 `#` 标注的占位判据）已由实现期替换为
      `scripts/acceptance/scenarios/62-code-block-fullscreen.md` + 两份 fixture
      （`code-block-fullscreen.md` / `code-block-fullscreen.txt`）。MUST NOT 在本文件里保留第二份
      步骤清单——两份必然漂移（REVIEW.md 第 8 条），真源只有场景文件本身。
      实现期对草案的三处口径调整，如实登记：
        ① **几何判据换掉了**：草案写「`AXGroup (Markdown 代码块 N) @x,y w×h`」，但实测遮罩根
           （`role=dialog`）与浮层内容节点在 AX 快照里**都不报位置**（M240 的表格全屏现场同样如此）
           ⇒ 改判「浮层是唯一的 focused 节点（`ax: { focused: "AXGroup" }`）+ 读屏名 = 容器同一份
           标签（`AXGroup (Markdown 代码块 3)`）」这一对，与「标签栏从 AX 树里消失」合起来承担
           「遮罩真的开着」的判据（M178 的「文本可读 ≠ 元素可见」陷阱：模态接管 + 持焦两条一起钉）。
        ② **「不改写源文件」的判据改走磁盘 sha256**：套件的 `editor` 断言读的是 AX **渲染**文本，
           而渲染态会随「caret 是否落在渲染块里」变化（实测：点一下 grid 表，AX 文本多一个换行，
           而文档与磁盘逐字节未变）⇒ 真机层用 `file.unchangedSince`；**文档模型层**的逐字节判据
           在 chromium 场景（`readDocument` 直接读 CM state）。
        ③ `blur` 兜底关闭路径未驱动（无稳定注入通道，见下方边界说明）。
      **验收口径**：`node scripts/acceptance/run.mjs --check` 静态校验 PASS；
      `node scripts/acceptance/run.mjs 62` 真机 PASS，证据落
      `test-results/acceptance/<日期>/62-code-block-fullscreen/`（`status.txt` = PASS）；
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
- [x] 6.2 真机反向验证：去掉入口触发（把场景 front-matter 的 `config.keys` 改成不绑定）后复跑
      同一场景，正观测侧断言必须 FAIL，FAIL 留档（结果目录另开，不覆盖 PASS 证据）。
- [x] 6.3 不改写源文件的真机判据：磁盘 `file.unchangedSince`（sha256）在位且 PASS（ADR 0003 §3）。
      **口径调整如实登记**：草案要的 `editor.unchangedSince` 那条在本层不可用——它读 AX **渲染**文本，
      渲染态会随 caret 是否落在渲染块里变化（见 6.1 的 ② 与 `docs/backlog.md` 的套件口径条）；
      文档模型层的逐字节判据由 chromium 场景承担。
- [x] 6.4 维护权一致（AGENTS.md）：实现 PR 必须同时含场景 md 与 fixture；手感层（浮层内滚动节奏、
      长块观感、文本选中体验）归 Alex dogfood，套件只留截图。

## 7. 文案 deck

- [x] 7.1 新增 deck 条目 **D156**（末位当前 D151，`文案-Copy.md:143`）：
      「代码块全屏触发钮的读屏名」= **「放大查看代码块」**（与 D124「放大查看表格」同族），
      并在文末「文案实现备注」段补一条：该串由 `src/preview/codeblock-trigger.ts` 的常量持有，
      `tests/unit/*` 按 deck 表格行逐字断言，两边漂移即红。
      **浮层自己的读屏名不新增条目**：复用 `Markdown 代码块 N` 的既有生成处。
      **验收口径**：deck 一行 + 备注段一条，且实现里的串与 deck 逐字一致；
      `git diff 文案-Copy.md` 恰好是这两处（无其它行被改）。
      已知相依（design §9）：在飞的 `ui-language-i18n`（M267）若改了这类标签的语言口径，
      本条目随同一条裁决走。

## 8. 验证与收官

- [x] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过，
      `change/code-block-fullscreen` 为 ✓。
- [x] 8.2 `bash scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=<自选> bash scripts/gate.sh visual`
      全绿（视觉含像素层，CI 只跑结构层）；真机套件 `node scripts/acceptance/run.mjs 62` 至少跑一次
      并留档（合并后、Alex 验收前，AGENTS.md 执行时机）。
- [x] 8.3 `git diff --check` 通过；改动文件集合与 [proposal.md](proposal.md) 的 Impact 清单一致
      （出现跨 scope 的只读依赖先报 tower 批准）。
- [x] 8.4 收官对账：tasks 全部勾选（或标注放弃原因）、spec 增量与实现一致（无实现期静默扩 scope）、
      living spec 归档另走节点 2。

## 9. 已声明的边界 / 不做

- [x] 9.1 不做 zen 视图 / 新窗口 / 系统预览；浮层内不做编辑（无行号、无搜索 / 跳转 / 折叠、
      无复制按钮）；不做文档内多块导航；浮层内不设第二个折行开关；code 模式（非 md 文件）
      不适用；不改代码块的任何既有内联口径；`src-tauri/**` 零改动。
      **验收口径**：`git diff --stat src-tauri/` 为空；实现里没有「上一块 / 下一块」这类状态。
- [x] 9.2 已知边界如实写进 spec 与 PR：① 键盘入口默认不绑键（需经 `[keys]` 绑定），
      鼠标入口是 hover 触发钮；② 块源码 >64 KiB 时浮层以单块纯文本呈现（无头部条、无着色），
      与文档内「仍逐行排版」有观感差；③ 折行口径下没有「容器持焦」这条入口（结构性），
      caret 入口照常成立；④ 浮层开着时外部重载的关闭行为以设计口径实现，观感归 Alex；
      ⑤ 打开成本随块长线性、实测读数落 `test-results/`（超档则另立 finding）。
      **验收口径**：五条在 spec 已知边界段与实现 PR 里各有一条对应文字。

## 收官读数（M277，2026-09-27；每条都给可复算的命令或可 `ls` 的路径）

- **实现批**：M277（branch `feat/impl-block-copy-and-code-block-fullscree`，worktree `wt-277`），
  与 `block-copy-affordance` 同批落地。
- **单测**：`node tests/unit/run.mjs` → **447 passed / 0 failed**（新增
  `tests/unit/code-block-fullscreen.test.ts` 11 条：四条关闭路径回同一个 close / blur 不抢焦点 /
  迟到关闭是空操作 / 共享状态机 / 行与 token 切分 / 空块 / >64 KiB 退化为单块纯文本 / deck 文案逐字）。
- **视觉**：新增 `tests/visual/scenes/m277-code-block-fullscreen.spec.ts`（9 组断言：惰性建立 /
  整块内容含**视口外**的行 / 触发钮静止态零足迹与两钮几何 / 三条关闭路径 / 位置不变量（回归护栏）/
  不穿透 / 计算样式与文档内逐项一致 / 折行两口径 / 超限块单块纯文本 / 入口边界）。
  浮层观感截图（非断言）留 `test-results/m277-impl/baseline-review/` 供 Alex 过目。
- **真机**：`node scripts/acceptance/run.mjs 62` → **PASS**（证据
  `test-results/acceptance/m277/62-code-block-fullscreen/`，`status.txt` = PASS）。
- **反向验证**：① 真机：把场景 front-matter 的 `config.keys` 清空后复跑，正观测侧断言 FAIL
  （`test-results/acceptance/m277-reverse/`）；② 视觉：摘掉 `src/overlay-scope.ts` 的主题 scope 镜像
  后 `m277-code-block-fullscreen.spec.ts` 的 5.4（计算样式保真）转红，留档见
  `test-results/m277-impl/reverse-visual-scope.log`。**先在实现前跑红的 1.2 未按原顺序做**
  （如实登记：本批的两条红都是从成品侧反向构造的）。
- **`restoreFocus` 的落地形态**：`editor.focusPreservingReadingPosition()` 在 `src/editor.ts` 新落地
  （取阅读位置 → `view.focus()` → 经 `readScrollPosition` / `applyScrollPosition` 写回，三步同帧，
  MUST NOT 裸写滚动容器）；`src/main.ts` 的浮层装配注入它。spec 的两处措辞已对齐（不动 living spec，
  归档时按 delta 落）。
- **口径偏差如实登记**：
  ① 真机场景号 **57 → 62**、deck 号 **D152 → D156**（理由见 §0 与 `文案-Copy.md` 的编号沿革段）；
  ② 「几何非零」判据换掉：浮层根与内容节点在 AX 快照里不报位置 ⇒ 改判「浮层是唯一 focused 节点 +
     读屏名 = 容器同一份标签」+「标签栏从 AX 树消失」，三条一起钉「遮罩真的开着」；
  ③ `editor.unchangedSince` 改走磁盘 sha256（同 block-copy 的第 ③ 条理由）；
  ④ `blur` 兜底关闭路径真机**未覆盖**（无稳定注入通道）；
  ⑤ 近上限块的打开耗时与 DOM 规模**未测量**（见 tasks 2.7 的登记）。
