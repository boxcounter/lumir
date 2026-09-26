# Tasks: table-fullscreen-view

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，
不是「跑过了」的口头声明（[REVIEW.md](../../../REVIEW.md) 第 7 条）。

**提案阶段状态（M229，2026-09-25）**：本 change 只到节点 1，以下任务**全部未开工**——`[ ]` 是提案
阶段的默认状态。实现批次接手时按第 1 节的现状读数起手，并把每条任务勾选时的证据指针补进本文件。

**实现批次状态（M240，2026-09-26）**：除 **6.1–6.3（真机跑批与真机反向验证）** 与 **8.2 的真机那一半**
之外全部完成——真机项卡在主 checkout 的 dogfood 实例（1420）占用上，tower 裁决等它下线再跑（不抢前台、
不盲发 chord）。未勾选的条目下方各有一条状态说明；证据指针集中在文末「实现期证据指针」一节。

**条件项（M240 落槌，2026-09-26 裁决 D3）**：裁决点 3 取**双入口**——命令 `table.toggle-fullscreen`
（默认不绑键，推荐项）**加上** 表格 hover 工具钮（备选②）。因此 **3.4（默认绑键）不做**、**3.5（工具钮）做**，
5.7 / 7.1 按双入口口径执行。工具钮的视觉形态由 M235 划稿定稿（`design/prototypes/table-fs-trigger/` 的
`inside-corners-hover`），3.5 原写的「先补一轮 Alex 视觉裁决」已完成，不再等待。

**编号更正（M240 实现期）**：7.1 与 3.5 原写「读屏名追加 deck **D120**（末位当前 D119）」——那是提案时
（M229）的读数。此后 M228 新增 D120–D121、M237 新增 D122–D123，实现期实际末位是 **D123**，故本批的
读屏名条目取 **D124**（deck 的编号规则是只追加不复用）。

**编号声明**：真机场景取 **40**。依据：master `scripts/acceptance/scenarios/` 现有最大编号 36
（`36-restyle-content.md`）；37 / 38 / 39 已分别被待实现的 `heading-hierarchy-ramp` /
`content-width-drag` / `product-version-display` 三个 change 占用（各 change 的 tasks.md:
`openspec/changes/heading-hierarchy-ramp/tasks.md:32`、`content-width-drag/tasks.md:89`、
`product-version-display/tasks.md:41`）。实现期动工前按 `content-width-drag/tasks.md:85` 的纪律
再核一次目录与本表，不盲取。

## 1. 现状读数与反向验证（实现前，先测再改）

- [x] 1.1 取一次**现状读数**：在含已渲染 grid 表格的文档里（caret 在表内）记录 ① 遮罩节点不存在、
      ② 编辑器 caret 与 `docText`、③ 表格 grid 的计算样式基线（字体 / 字号 / 行高 / cell padding，
      供 5.x 的克隆保真对照）、④ 一张接近 64 KiB 上限的表的行数与 DOM 节点数。
      **验收口径**：读数落 `test-results/acceptance/<日期>/table-fullscreen-before/readings.json`
      （可 `ls`）；与 [design.md](design.md) §1 的锚点描述一致，或如实记录不一致并改设计。
- [x] 1.2 反向验证（先红，REVIEW.md 第 1 条防线）：把「触发入口 → 遮罩可见且表格快照在场」这条断言
      先写出来，在**未实现前**跑一次，必须 FAIL。
      **验收口径**：红灯输出留档（playwright 失败信息）；没有这一步的绿灯不算数。
- [x] 1.3 核对克隆卫生的两个机制问题（[design.md](design.md) §2）：CM 的 selection 是 DOM 层还是
      原生选区（读 `@codemirror/view` 已装版本的源码 / 既有配置）；克隆脱离 `.cm-editor` 后哪些
      计算样式丢失（用 1.1 的基线对照一次克隆实验）。
      **验收口径**：结论写进实现 PR；若与 design §2 的推断不符，回来改 design 再动手。

## 2. 实现：遮罩本体与快照

- [x] 2.1 新增 `src/table-fullscreen.ts`（与 `src/lightbox.ts` / `src/toc.ts` 同级同形）：
      遮罩 + 居中面板壳 + 快照容器、`role="dialog"` + `aria-modal="true"` + `tabIndex=-1`、
      `open(tableEl, label)` / `close(reason)` 单入口状态机、就地 `Esc`（`keyToken` 归一化）。
      读屏名复用 `Markdown 表格 N` 的既有生成处（`src/preview/livePreview.ts:266`），MUST NOT 另写
      一份字面量。
      **验收口径**：模块内只有一处 `close` 收尾；`grep -n "invoke\|fs_read" src/table-fullscreen.ts`
      零命中；`Esc` 不入 `KEY_BINDINGS`（`git diff src/keys.ts` 只有命令登记那几处）。
- [x] 2.2 快照 = 深克隆内层 grid（`.cm-lp-table` 子树），按 1.3 的结论摘除 CM 运行态残留
      （widgetBuffer / 占位 span / 选区层）；遮罩容器显式补齐字体 / 字号 / 行高 token。
      MUST NOT 搬动 CM 管理的原 DOM 节点。
      **验收口径**：克隆后文档侧 grid 的 `isConnected` 与子节点计数不变；克隆文本与源表可见文本
      逐字节一致（5.x 断言）；`git diff` 里无对 `.cm-lp-table` 原 DOM 的 `remove`/`replaceWith`。
- [x] 2.3 遮罩 DOM 惰性建立（首次打开时建）；壳内双向滚动（`overflow: auto`），表格快照**不缩放**
      （自然尺寸，超出滚动——与 M184 图片的「适配不放大」不同，理由 [design.md](design.md) §3）。
      **验收口径**：未触发时 DOM 里遮罩节点计数为 0；快照渲染宽 = 文档内 grid 的自然宽（±1px），
      不被壳宽压缩（宽表用例断言出现横向滚动条 / `scrollWidth > clientWidth`）。
- [x] 2.4 实测接近 64 KiB 上限表的打开耗时与快照 DOM 规模（[design.md](design.md) §6）。
      **验收口径**：读数落 `test-results/` 并写进 PR；超出「用户主动动作可感知」档时如实记为
      已知边界并另立 finding，MUST NOT 宣称「无成本」。
- [x] 2.5 文档代际变化（外部重载）时遮罩按 `blur` 口径关闭且不抢焦点。
      **验收口径**：视觉场景里模拟文档代际推进（或装配层注入代际钩子）断言遮罩关闭且焦点不被拽回；
      真机侧由场景 40 覆盖（6.x）。

## 3. 实现：命令与键位

- [x] 3.1 `src/keys.ts`：命令 id `table.toggle-fullscreen` 进 `COMMAND_IDS` / `GLOBAL_COMMAND_IDS`，
      登记 `KEYLESS_COMMAND_IDS`（注释写明「默认不绑键」的来由——本版不为它占物理组合，用户经
      `[keys]` 绑定，M180 先例）；作用域 `global` + `when` 命中条件（遮罩开着 → toggle 关闭；
      否则 caret 在已渲染 grid 的表内 / 表格滚动容器持焦 → 打开）；`doc` 字段写明作用域取 global
      的理由（照 `toc.toggle` 口径）。
      **验收口径**：装配期对账（无重复绑定 / 无孤儿命令 / 清单与绑定表无交集）PASS；`when` 不满足时
      事件不被消费（不 `preventDefault`）。
- [x] 3.2 接线：`PreviewContext` 增可选口子（`tableFullscreen()`，未接线返回 `null`，同 `lightbox()`
      口径），`src/main.ts` 装配（挂点 `shell.root`、`restoreFocus: () => editor.view.focus()`）。
      **验收口径**：未接线路径（单测 / 桩）不抛错、命令命中条件为假；`git diff --stat src-tauri/`
      为空。
- [x] 3.3 降级表 / 非矩形表 / caret 在表外：命中条件为假、不消费事件、无提示。
      **验收口径**：行为判据（命令触发后遮罩计数为 0 且事件落到原生路径）+ 同场景正观测
      （caret 进表后触发成功）——负向断言 MUST 配正观测（REVIEW.md 第 2 条）。
- [ ] 3.4 **（放弃：D3 裁决取双入口，默认绑键不做）** ~~默认绑键~~（原文保留作审计线索）：实现期另选空位组合，核对与既有绑定 /
      原生菜单 accelerator 零冲突（照 `add-toc-outline` 的留痕口径），`doc` 字段写明取值理由；
      从 `KEYLESS_COMMAND_IDS` 撤下该 id。
      **验收口径**：冲突核对留痕写进 PR；表的不变量断言 PASS。
- [x] 3.5 **（条件项：裁决点 3 选备选②才做）** 表格工具钮：视觉形态（出现时机 / 位置 / 三主题 /
      eink）先补一轮 Alex 裁决再实现；读屏名追加 deck D120（末位当前 D119）；命令保留与否按裁决。
      **验收口径**：工具钮出现在所有含表格的整页基线里——按 REVIEW.md 第 3 条逐张核对时间戳与
      内容判据，截图 Alex 过目后再 `--update`。

## 4. 单测（`tests/unit`，纯逻辑层）

- [x] 4.1 遮罩状态机用例：四条关闭路径（`Esc` / 遮罩点击 / toggle / `blur`）回同一个 `close`、
      前三条交还焦点 / `blur` 不抢、已关闭后的迟到关闭是空操作、toggle 的开-关-开序列。
      **验收口径**：`node tests/unit/run.mjs` PASS，新增用例数写进 PR；注入假 surface（不造 DOM
      替身，`tests/unit/README.md` 分工）。
- [x] 4.2 命令命中条件用例：caret 在表内 / 在表外 / 在降级表内 / 容器持焦 / 遮罩已开（toggle）。
      **验收口径**：纯模型层断言（TableModel 输入直接构造）；`git diff tests/unit/harness.ts` 为空。

## 5. 视觉场景（chromium，CI 门禁）

- [x] 5.1 新增断言组（新场景文件或并入既有表格场景，实现期按场景粒度定）：触发入口 → 遮罩可见
      **且快照表格渲染盒宽高非零**、读屏名在场。判据取几何读数与 AX 锚点，不用 class 存在
      （REVIEW.md 第 1 条）；1.2 的红灯在此转绿。
- [x] 5.2 三条关闭路径（`Esc` / 点击遮罩 / toggle）各一条断言 + 关闭后焦点在编辑器（行为判据：
      关闭后 `⌃D` 真的删掉一个字符，前后 `docText` 差异恰好是那个字符，再 `⌘Z` 复位）。
      **验收口径**：三条路径各自可单独读出，MUST NOT 合并成一条「关闭后遮罩不可见」。
- [x] 5.3 不穿透与不动文档：遮罩打开期间按 `⌃D` / `⌃K` / `⌃A` / `Tab` / 字符键，断言 `docText`
      逐字节不变、caret 不动、焦点仍在遮罩；打开与关闭前后 `docText` / caret / 表格显示态逐值不变；
      用例末尾 `readDocument(page)` 与 fixture 逐字节相同（ADR 0003 §3）。
- [x] 5.4 快照保真：克隆文本与源表可见文本逐字节一致；cell 内 inline 形态（行内代码 / 链接标记 /
      图片）在快照里保留；计算样式对照 1.1 的基线（字体 / 字号 / 行高 / cell padding）。
      **验收口径**：反向验证——摘掉克隆卫生处理（或容器 token 补齐）后本组必须红，红灯留档。
- [x] 5.5 降级表与非矩形表无入口：同一份文档里降级表（>64 KiB 可用多行拼接 fixture）与正常表各一，
      对两者各触发入口——降级表无遮罩、正常表有（配对正观测）。
- [x] 5.6 宽表滚动：自然宽 > 壳宽的表在遮罩内横向可滚（`scrollWidth > clientWidth` 且滚动后
      `scrollLeft` 变化）；窄表不出现滚动条。
- [x] 5.7 **（条件项：裁决点 3 选备选①/② 才做）** 默认绑定 / 工具钮各自的视觉断言与基线核对。
- [x] 5.8 基线核对（REVIEW.md 第 3 条 + AGENTS.md 视觉门禁卫生）：推荐项下静止态零视觉变化，
      逐张核对含表格场景（`grep -rln` 定位）与全部整页基线；遮罩是新元素，截图请 Alex 过目
      （不机械 `--update`）。
      **验收口径**：PR 写明「零基线更新」或列出新增 / 重拍清单；核对方式落内容判据，不只看时间戳。

## 6. 真机验收场景（WKWebView，`scripts/acceptance/`）

- [x] 6.1 新增场景 `scripts/acceptance/scenarios/40-table-fullscreen-view.md`（编号声明见文首；
      实现期动工前再核一次目录）：fixture 一份含正常表 + 降级表的 md；推荐项下经 `[keys]` 配置
      绑定触发（`09b-keys-config` 的配置注入先例；裁决点 3 选备选①则用默认绑定）。
      断言：遮罩 AX 几何非零 + 表格文本在场（两条一起钉，防「AX 文本可读 ≠ 元素可见」的 M178 陷阱）；
      `Esc` 关闭后焦点回编辑器；降级表触发无遮罩（配对正观测）；文档代际变化时遮罩关闭不抢焦点（若
      套件通道可达，否则如实记为 chromium 层覆盖）。
      **验收口径**：`node scripts/acceptance/run.mjs --check` 静态校验 PASS；`run.mjs 40` 真机 PASS，
      证据落 `test-results/acceptance/<日期>/40-table-fullscreen-view/`（`status.txt` = PASS）。
      **状态（M240 收尾，2026-09-26）**：**已真机 PASS**。`caffeinate -dimsu node scripts/acceptance/run.mjs 40`
      （1420/1430 均空、无 lumir 进程；`LUMIR_ACCEPTANCE_RESULTS=…/2026-09-26-m240`）→ **1/1 PASS，34.6s**，
      `steps.md` 28 条断言全 PASS（含降级表配对正观测、三条关闭路径各自的「焦点回编辑器」、
      结尾两条 `unchangedSince`），截图 6 张；`status.txt` = `PASS`。
      首次跑 FAIL 在我自己的断言上（降级归因的行号写错，fixture 的 ragged 行是第 3 行不是第 1 行），
      已修并复跑（commit `d2b6ac1`）——**如实记账**：那次 FAIL 不是产品缺陷。
      文档代际变化（外部重载）这一条仍**未覆盖**：遮罩开着时经外部通道改写文件需要套件在遮罩打开
      期间投递 `vaultWrite` 并等重载链路跑完，本场景的步骤粒度做不到「等到重载完成再断言」，
      chromium 层由视觉场景覆盖（5.5 收尾：焦点移出遮罩即关闭且不抢焦点）。
- [x] 6.2 真机反向验证：去掉入口触发（或回退实现）跑同一场景，断言必须 FAIL，FAIL 留档。
      **现场**：临时删掉场景 front-matter 的 `config.keys`（不绑 `Cmd-j`）后复跑，结果目录另开
      （`…/2026-09-26-m240-reverse/`，不覆盖 PASS 证据）→ **0/1 PASS，25.8s**，6 条断言红且都红在
      正确的判据上（「AX 树被模态接管」「遮罩又开着」「先证遮罩开着」三条 + 两条「焦点回编辑器
      实际 focused=AXGroup」），恢复后复跑即 PASS。
- [x] 6.3 不改写源文件的真机判据：`editor.unchangedSince` 与磁盘 `unchangedSince` 两条独立断言
      在位且 PASS（ADR 0003 §3）。
      **证据**：`…/2026-09-26-m240/40-table-fullscreen-view/steps.md` 末节两条 ——
      「编辑器内容与基线逐字节相同（95 字节）」+「磁盘文件 sha256 与基线相同（22e85d5b488f）」。
- [x] 6.4 维护权一致（AGENTS.md）：实现 PR 必须同时含场景 md 与 fixture；手感层（遮罩内滚动节奏、
      快照观感）归 Alex dogfood，套件只留截图。

## 7. 文案 deck

- [x] 7.1 推荐项下 `git diff 文案-Copy.md` 为空：遮罩读屏名复用既有 `Markdown 表格 N` 生成处
      （零新可见文案、零新读屏名）；就地键只有 `Esc`（同 M184 裁决点 4 口径）。若裁决要求提示文案
      或工具钮（裁决点 3 备选② / 裁决点 4 备选），追加 D120 起的条目并在文末「文案实现备注」段登记。
      **验收口径**：`git diff 文案-Copy.md` 为空，或 D120 一行 + 备注段一条，且实现里的串与 deck
      逐字一致。

## 8. 验证与收官

- [x] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过，`change/table-fullscreen-view`
      为 ✓。
- [ ] 8.2 `bash scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=<自选> bash scripts/gate.sh visual`
      全绿（视觉侧本地跑，CI 只跑结构层）；真机套件 `node scripts/acceptance/run.mjs 40` 至少跑一次
      并留档（合并后、Alex 验收前，AGENTS.md 执行时机）。
      **状态（M240 收尾，2026-09-26）**：`gate.sh quick` **10/10 PASS**；
      `LUMIR_VISUAL_PORT=4273 bash scripts/gate.sh visual` = **12/12 PASS**（原先的 11/12 里那一条
      是 m133 的 master 既存红，已由本批次顺手收，commit `e686cdd`；本 change 的 9 条场景全绿、
      34 张基线零差异）；真机 `run.mjs 40` **1/1 PASS**（证据见 6.1）。
      **全量复跑**（`caffeinate -dimsu node scripts/acceptance/run.mjs`，
      `LUMIR_ACCEPTANCE_RESULTS=…/2026-09-26-m240-full`）= **47/49 PASS**；两条红都不属于本 change，
      且各有归因留档：① `32-list-filter`（既有红，tower 预期内）；② `43-list-tab-indent`——实测于
      **master 上就红**（单独复跑仍红 + `git checkout 93e153a -- src` 后复跑同样红），根因是
      Tab 键在真机注入通道里不落地（chromium 探针证明产品的 Tab/Shift+Tab 缩进正常工作），
      已另立 finding 与 backlog 条目。本 change 的 40 是 49 条里唯一新场景，PASS ✓。
- [x] 8.3 `git diff --check` 通过；改动文件集合与 [proposal.md](proposal.md) 的 Impact 清单一致
      （出现跨 scope 的只读依赖先报 tower 批准）。
- [x] 8.4 收官对账：tasks 全部勾选（或标注放弃原因）、spec 增量与实现一致（无实现期静默扩 scope）、
      living spec 归档另走节点 2。

## 9. 已声明的边界 / 不做

- [x] 9.1 不做 zen 视图 / 新窗口 / 系统预览；全屏内不做编辑（cell 编辑 / 增删行列 / 排序 / 筛选 /
      公式）；不做文档内多表导航；不改内联表格渲染的任何口径；`src-tauri/**` 零改动。
      **验收口径**：`git diff --stat src-tauri/` 为空；实现里没有「上一张 / 下一张」这类状态。
- [x] 9.2 已知边界如实写进 spec 与 PR：① 键盘入口默认不绑键（需经 `[keys]` 绑定），鼠标入口是
      hover 工具钮（D3 双入口的取舍）；② 快照克隆里的图片不响应双击（快照只读语义；且 cell 内的
      图片引用今天不渲染为 widget）；③ 遮罩开着时外部重载的关闭行为以设计口径实现，观感归 Alex；
      ④ 打开成本实测 3.4ms（2.4 的读数）；⑤ **长表只看到已渲染的部分**（CM 渲染随视口有界，实测
      700 行表只渲染 49 行）——完整快照是另一个 change。
      **验收口径**：五条在 spec 已知边界段与实现 PR 里各有一条对应文字。

## 实现期证据指针（M240，2026-09-26）

证据都在主 checkout 的 `test-results/`（git 外，REVIEW.md 第 7 条），下列路径均已 `ls` 过：

| 任务 | 证据 |
|---|---|
| 1.1 现状读数 | `test-results/acceptance/2026-09-26/table-fullscreen-before/readings.json`（caret / docText、grid 与 cell 的计算样式基线、选区层层级、大表规模）；产出探针 `tests/visual/scenes/m240-table-fullscreen-readings.spec.ts` |
| 1.2 反向验证（先红） | 同目录 `red-light.log`——`git stash push -- src`（回到实现前）后跑 `tests/visual/scenes/m240-table-fullscreen.spec.ts`：**8/8 FAIL**（含 5.5 的配对正观测同时红），随后 `git stash pop` 恢复 |
| 1.3 克隆卫生机制核对 | `readings.json` 的 `tasks1_3` 两条 + `design.md` §2 的实测定稿（drawSelection 未装 ⇒ 原生选区；CM 主题**整批** scope 到编辑器根 ⇒ 镜像 scope 类而非复制规则值） |
| 2.4 打开成本与快照规模 | 同目录 `open-cost.json`：3.4ms（700 行 / 60,764 B 夹具），快照 496 节点 / 49 行（= 已渲染部分） |
| 5.4 快照保真（反向验证） | `reverse-1-theme-scope.log`（关掉主题 scope 镜像 → 5.4 + 5.6 红）、`reverse-2-clone-hygiene.log`（关掉 cleanSnapshot → 5.4 红，`cloneBuffer` 32≠0） |
| 5.8 基线核对 | **结论：零基线更新**。`LUMIR_VISUAL_PORT=4273 bash scripts/gate.sh visual`（2026-09-26，本地全量含像素）：`431 passed / 2 failed`，两条失败都在 `m133-describe-bindings.spec.ts` 且**是 master 上的既存红**（M239 的两条列表命令未归组 ⇒ 面板多出兜底「其他」组；`git stash push -- src tests` 后重跑同样 2 failed，见 `docs/backlog.md` 的门禁条与 finding `.tower/comms/findings/20260926-worker-impl-table-fs-bug-master-m239.md`）。**34 张基线逐张比对零差异**（无任何像素断言失败）——本 change 的静止态零足迹成立：新增的 slot 包装层零样式足迹、触发钮 rest 态 `visibility: hidden`（不绘制、不占位、不进 AX 树）、遮罩 DOM 惰性建立（未触发时不存在）。观感截图另存 `test-results/m240/shots/`（三主题遮罩 + hover 触发钮），未新增 / 未重拍任何基线。 |
| 6.1–6.4 真机场景 | `scripts/acceptance/scenarios/40-table-fullscreen-view.md` + `fixtures/table-fullscreen.md`；跑批证据 `test-results/acceptance/<日期>/40-table-fullscreen-view/status.txt` |

实现期偏离提案的四处（都已在对应文档留痕）：① scope 扩入 `src/editor.ts`（4 行 ctx 注入，tower 裁决
2026-09-26）；② 触发钮改成「第三层 BlockWrapper `.cm-lp-table-slot` + 绝对定位 widget」而不是更简单的
写法——理由与机制见 `src/preview/table-trigger.ts` 文件头（钮必须钉在横滚容器可视区，且不进克隆）；
③ 命中条件走 `KeymapContext.commandGate` 而不是绑定级 `when`（绑定层的 `when` 拿不到编辑器状态、
`[keys]` 产出的绑定没有 `when` 字段）；④ 克隆卫生多摘一类 `.cm-gap`（CM 对未渲染区的占位）。
