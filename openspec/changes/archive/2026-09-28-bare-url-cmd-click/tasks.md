# Tasks: bare-url-cmd-click

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，不是「跑过了」的口头声明（[REVIEW.md](../../../../REVIEW.md) 第 7 条）。

**裁决记录（Alex 节点 1，2026-09-27 原话）**：「# bare-url-cmd-click 采纳建议。」——即六项裁决点（D1 纳入角括号自动链接 / D2 白名单 scheme / D3 只装饰 URL 部分 / D4 纳入表格 cell / D5 ⌘⏎ 同源覆盖 / D6 编辑态撤下装饰）全部按**推荐项**落地，delta 与任务不需按「裁决改写指引」改写。

**实现期台账（M272，2026-09-27）**：下面逐条勾选，未开工 / 有偏离的条目**保留 `[ ]` 并在行内写明原因**（REVIEW.md 第 6 条：拿不出 PASS 证据的一律写「未验」，不写成已覆盖）。证据落 `test-results/m272/`（git 外）与套件的 `test-results/acceptance/<日期>/54-bare-url-cmd-click/`。

**条件项（随节点 1 的裁决改写）**：正文按推荐项写（D1 纳入 `<…>` 自动链接、D2 白名单 scheme、D3 只装饰 URL 部分、D4 纳入表格 cell、D5 ⌘⏎ 同源覆盖、D6 编辑态撤下装饰）。任一项改判备选时按「裁决改写指引」一节改 delta 与相应任务，不静默扩 scope。

## 1. 现状读数与反向验证（实现前，先测再改）

- [ ] 1.1 取一次**现状读数**（**未按原口径做**：没有落 `readings.json`。替代证据是两条——① 节点形态清点用真实 parser 跑出 19 条 `URL`/`Link` 节点（含 frontmatter 内那条，证明它是被 `inFrontmatter` 剪枝而非「语法树不产出」）；② 反向验证的红灯（见 1.2 / 5.6 / 6.2）证明「实现前这些断言不成立」。请评审按「口径偏离」看待，不要读成已覆盖）：在一份含 `正文里的 https://… 是裸 URL` / `[homepage]: https://…` / `<https://…>` / 表格 cell 内裸 URL 的文档里记录 ① 渲染态文本（三处都不带尾标、`.cm-lp-link` 计数为 0）、② 光标落在裸 URL 上按 ⌘⏎ 时的行为（`link_open` 日志零新增）、③ ⌘-Click 同一位置的 `posAtCoords` 落点偏移。
  **验收口径**：读数落 `test-results/acceptance/<日期>/bare-url-before/readings.json`（可 `ls`）；与 [design.md](design.md) §1 的节点形态表一致，或如实记录不一致并改设计。
- [x] 1.2 反向验证（先红，REVIEW.md 第 1 条防线）：把「裸 URL 装饰出 `.cm-lp-link` + `↗︎`」与「⌘⏎ 打开该 URL」两条断言先写出来，在**未实现前**跑一次，必须 FAIL。
  **验收口径**：红灯输出留档（playwright 失败信息）；没有这一步的绿灯不算数。
- [x] 1.3 核对三处机制（决定判据细节，[design.md](design.md) §6.2 / §9）：
  ① frontmatter 内的 `URL` 节点是否被既有的 `inFrontmatter` 剪枝（fixture 一份带 frontmatter 的文档，frontmatter 里放一个 `https://…`）；
  ② 光标落在裸 URL **末位**后继续键入时，尾标 widget 是否造成落点错位或死区（D6 的显露判据是否需要从严格重叠放宽到含端点）；
  ③ 光标落在**首字符即裸 URL** 的文档开头（选区复位到 0 的现场）时能否命中（沿用 `standardLinkAt` 的两侧 `resolveInner` 手法）。
  **验收口径**：三条结论写进实现 PR；与 design 的推断不符的，回来改 design 再动手。

## 2. 实现：装饰面

- [x] 2.1 `src/preview/links.ts`：新增新形态的定位入口（形态 2 / 3 / 4 的节点识别 → 目标区间 + 目标原文），判据 = 「`URL` 节点 + 祖先无 `Link` / `Image` + 原文带白名单 scheme」；分类仍只调 `classifyLinkTarget`，MUST NOT 复制第二份分类。形态 1 的 `standardLinkAt` / `standardLinkParts` 行为逐条不变。
  **验收口径**：`grep -n "javascript:\|http" src/preview/links.ts` 里不出现新的 scheme 字面量清单（白名单只有 `EXTERNAL_URL_SCHEMES` 一处）；新入口对「无 scheme 的 `URL` 节点」返回 null。
- [x] 2.2 `src/preview/livePreview.ts`：装饰循环新增新形态分支——打 `.cm-lp-link`（`title` = 解码后 URL）+ 在节点末尾插 `LinkMarkWidget(EXTERNAL_LINK_MARK)`；形态 4 额外隐藏两个 `LinkMark`；形态 3 不动 `[tag]: ` 前缀；MUST NOT 隐藏 URL 文本本身。显露沿用既有严格重叠判据。
  **验收口径**：`git diff src/preview/theme.ts src/style.css` 为空（零新 token / 零新类）；渲染态文本与原文档在「URL 文本」这一层逐字节一致（只有尾标与尖括号是增量）。
- [x] 2.3 （条件项：D4 取推荐项才做）表格放行名单（`src/preview/livePreview.ts:872-873`）加 `URL`，并复用同款 cell 边界防御性收窄（`:1046-1051`）。
  **验收口径**：表格 cell 内裸 URL 装饰、同一行其余 cell 不受影响、表格仍是 grid（配对正观测配负向断言，REVIEW.md 第 2 条）。
- [x] 2.4 装饰循环的剪枝顺序核对：`inFrontmatter` 与表格降级剪枝 MUST 在新分支之前生效。
  **验收口径**：frontmatter 内与降级表格内的裸 URL 均不装饰（两条独立断言）。

## 3. 实现：激活面

- [x] 3.1 `src/link-follow.ts`：`linkTargetAt` 在「wikilink → 标准链接」之后加第三段查询（新形态 → `classifyLinkTarget` → 既有的五种 `LinkTarget`）。`blocked` 与「无 scheme 字面 URL」在查询阶段返回 null（不装饰也不激活的自洽）。MUST NOT 新建第二条跟随逻辑。
  **验收口径**：`git diff src/link-follow.ts` 里只有 `linkTargetAt` 内的新增分支（一条查询 + 一次分类）；`followLink` / `openExternalLink` / 鼠标监听三处零改动。
- [x] 3.2 鼠标路径（⌘-Click）与键盘路径（⌘⏎）各自可单独触发新形态。
  **验收口径**：视觉场景两条独立断言；`git diff --stat src-tauri/` 为空（零新字节通道）。
- [x] 3.3 与既有三类的互斥核对：wikilink 上、标准链接上、`blocked` 形态上的行为逐条不变（含 `blocked-scheme` 诊断事件仍在）。
  **验收口径**：既有 `render-link` 断言全绿（不改判据的部分），`blocked` 那条仍记 `link_open` 且日志不含 URL 原文。

## 4. 单测（`tests/unit`，纯逻辑层）

- [x] 4.1 新形态的节点识别与区间：在构造的 `EditorState` 上断言裸 URL / 定义行 / `<…>` 三处都定位到正确的区间与原文；断言 `Link` 标签内与 `Image` 内的 `URL` 节点**不**入选。
  **验收口径**：`node tests/unit/run.mjs` PASS，新增用例数写进 PR。
- [x] 4.2 「带 scheme」前提：`www.example.com` / `a@b.example.com` / `xmpp:a@b` 三类一律不入选；`http` / `HTTP` / `https` / `mailto` 入选。
  **验收口径**：参数化断言（每条一个 case），失败信息里带上被判定的原文。

## 5. 视觉场景（chromium，CI 门禁）

- [x] 5.1 fixture 更新：`tests/visual/fixtures/render-link/links.md:20` 那行按新口径保留，补 `www.` / 裸邮箱 / `xmpp:` / 定义行 / 引用点（定义行 + `[text][ref]`）现场。
  **验收口径**：fixture 覆盖本轮 spec 的全部新 scenario，逐条可指认到行。
- [x] 5.2 装饰断言组：新形态的类名、`title` 属性、尾标文字与文档顺序；`LINKS` / `MARKS` 计数按实际装饰数更新（D1 取推荐项时 +2）。
  **验收口径**：1.2 的红灯在此转绿，且 `MARKS` 逐项比对（不是只比长度）。
- [x] 5.3 激活断言组：⌘⏎ 与 ⌘-Click 各一条（stub 记账 `window.__openedUrls`，断言开的是哪个 URL 且不真开浏览器；⌘-Click 用合成 `mousedown` + `metaKey: true` + `clientX/Y`，先例 `tests/visual/scenes/typography.spec.ts:484` / `:547-558`）。
  **验收口径**：两条路径各自可单独读出，MUST NOT 合并成一条。
- [x] 5.4 负向断言（配对正观测）：`www.` / 裸邮箱 / `xmpp:` / 引用点 / 围栏代码块 / 行内代码 / HTML 注释 / frontmatter 各自的「不装饰」断言，同场景内 MUST 有对应的正观测（同一文档里裸 URL 装饰成功）。
  **验收口径**：每条负向断言都能指出它对应的正观测（REVIEW.md 第 2 条）。
- [x] 5.5 编辑态与文档不变：光标进/出裸 URL 时装饰的撤下与恢复；URL 末位继续键入的行为合判据（1.3 ② 的结论）；用例末尾 `readDocument(page)` 与 fixture 逐字节相同（ADR 0003 §3）。
  **验收口径**：`docText` 前后逐值比较 + 磁盘逐字节比较两条独立断言。
- [x] 5.6 反向验证（**已做**；口径偏离：用 `git checkout 589a9c0 -- src/preview/links.ts src/preview/livePreview.ts src/link-follow.ts` 回退三文件，未用 `git stash push -- src`；实质相同——都是「关掉新分支后跑同一场景」）：回退后跑 `render-link.spec.ts` → **11 failed / 7 passed**，关掉新分支后 5.2–5.5 如期变红。
  **验收口径**：红灯输出落 `test-results/m272/reverse-visual-bare-url.log`；方法偏离见本行括注，请评审按「口径偏离」读，不读成未验。
- [x] 5.7 基线核对（**Alex 已核准并已重拍**，2026-09-27）（REVIEW.md 第 3 条 + AGENTS.md 视觉门禁卫生）：`render-link.png` 变化 26451 px = 0.03 + 新增截图 `render-link-bare-url.png`；三视图与比对包在 `test-results/m272/baseline-review/`，Alex 过目后执行重拍。
  **执行与逐张核对**：`scripts/visual/run.sh --update render-link.spec.ts` 这条写法**不可用**——playwright 的 `--update-snapshots [mode]` 是可选参数，会把文件过滤器当 mode 值吞掉并硬报错（已开 finding 给 tower）；实际执行 `LUMIR_VISUAL_PORT=4297 pnpm --dir tests/visual exec playwright test --update-snapshots=changed render-link.spec.ts`。落盘 **51 → 52** 张：`find tests/visual/baselines -name '*.png'` 逐张比 mtime，**只有 render-link 两张刷新**（重拍 `render-link-chromium-darwin.png` + 新增 `render-link-bare-url-chromium-darwin.png`），其余 **50 张 mtime 未动**；无 UI 元素被删除或移动。两张新基线的 sha256 与 Alex 过目的 actual 逐字节相同（`fe673939086c…`，旧基线 `cfafbf2c…`）。复跑门禁 **12/12**。
  **验收口径**：新增 / 重拍的基线清单与逐张核对方式见本行上一段（内容判据 + mtime 判据双落，不止看时间戳）；裸跑 `--update-snapshots` 不算（本仓两次实证等于什么都不做）。

## 6. 真机验收场景（WKWebView，`scripts/acceptance/`）

- [x] 6.1 新增 `scripts/acceptance/scenarios/54-<slug>.md` + fixture（**编号声明见下**）：fixture 首行即以裸 URL 开头（打开文件时选区复位到 0，⌘⏎ 直接命中——判据见 `src/preview/links.ts:140-145`），另含一条定义行与一条 `<…>` 自动链接、一条 `www.` 字面（负向，配对正观测）。
  断言：装饰态上屏（尾标在场 + URL 文本仍在）+ `do: key cmd+return` 后诊断日志 `link_open` 的 `category=external` / `outcome=opened`（与 `12-links` 同款通道 `env:logs/*.jsonl`）+ 结尾两条 `unchangedSince`（编辑器内容与磁盘 sha256）。
  **验收口径**：`node scripts/acceptance/run.mjs --check` 静态校验 PASS；`run.mjs 54` 真机 PASS，证据落 `test-results/acceptance/<日期>/54-<slug>/`（`status.txt` = PASS）。
  **前置**：本场景依赖裁决点 D5 取推荐项（⌘⏎ 覆盖新形态）——套件的 `click` 动作不支持修饰键（`docs/backlog.md:1048-1053`），⌘-Click 在真机无法表达。D5 若取备选，本任务整份改为「由 chromium 层承担，真机覆盖记为不可达」并如实登记。
- [x] 6.2 真机反向验证（**已做**：`git checkout 589a9c0 -- src/preview/links.ts src/preview/livePreview.ts src/link-follow.ts` 后跑场景 54 → **FAIL / 9 条断言红**，日志 `test-results/m272/reverse-acceptance-54.log`）：去掉入口触发（或回退实现）跑同一场景，断言必须 FAIL，FAIL 留档（结果目录另开，不覆盖 PASS 证据）。
  **验收口径**：红灯输出与 PASS 证据分目录存放，两份都可 `ls`。
- [x] 6.3 真机判据不漏「AX 可读 ≠ 元素可见」（M178 陷阱）：装饰断言同时钉尾标文本在场与编辑器文本可读。
  **验收口径**：steps.md 里两条断言并列出现。
- [x] 6.4 `scripts/acceptance/scenarios/12-links.md` 复核：现有 fixture 不含裸 URL（已核），预期零改动；若实现期为覆盖率补了现场，同批加断言并复跑。
  **验收口径**：`git diff scripts/acceptance/scenarios/12-links.md` 为空，或 diff 里带了同批断言与一次复跑记录。

### 编号声明

真机场景取 **54**。依据：master `scripts/acceptance/scenarios/` 现有最大编号 **50**（`50-tab-context-menu.md`）；**51–53 按 tower 的批次安排预留给同批在飞的三份提案**（M261 goto-line command / M262 code-block fullscreen / M263 block-copy affordance，各取一场景）。实现期动工前须按既定纪律（`openspec/changes/archive/2026-09-27-list-tab-indent/tasks.md` §6 的口径）再核一次目录与那三份 change 的 tasks.md 编号声明，不盲取。

**实现期核验留痕（M272，2026-09-27，维持 54）**：三层核对结论一致，**无冲突，不取 61**。

1. `ls scripts/acceptance/scenarios/` 实测：当前最大编号 **53**（`53-bold-click-selection.md`），**54–60 一个都不存在**；
2. 跨全部分支 `git log --all --name-only -- scripts/acceptance/scenarios/` 扫描：**没有任何 54+ 文件被创建过**；
3. 54 就是本 change（M260 提案）**自己声明的号**，且四份在飞 change 的编号声明互相印证（`goto-line-command` tasks.md:70「54 归 M260」、`ui-language-i18n` tasks.md:132 同句、`code-block-fullscreen` 57、`block-copy-affordance` 58）。
   HANDOFF.md:14 的「51–58 全✓ 59=M264✓ 60=M268✓；下一可用 61」指的是**新声明**用的下一个号，不是「54 被第三方占用」。

tower 裁决（2026-09-27）采纳上述核验结论：bare-url 取 **54**、enter-auto-indent 取 **59**。

## 7. 文案 deck

- [x] 7.1 `git diff 文案-Copy.md` 为空：三种新形态复用既有可见文字（`↗︎` 尾标与链接样式），不产生新读屏名、不产生新提示。
  **验收口径**：diff 为空；或若裁决要求提示文案，追加 D125 起的新条目（末位编号实现期先核 `文案-Copy.md`）并登记在本文件文末「文案实现备注」段。

## 8. 验证与收官

- [x] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过，`change/bare-url-cmd-click` 为 ✓。
- [x] 8.2 `bash scripts/gate.sh quick`（quick **10/10 PASS**）与 `LUMIR_VISUAL_PORT=4297 bash scripts/gate.sh visual`（**12/12 PASS，SKIP 0**；视觉侧本地全量像素，`pixel-skip` 0 条）全绿（视觉侧本地跑，CI 只跑结构层）；真机 `node scripts/acceptance/run.mjs 54` PASS ×2 轮并留档。
  **收官读数（2026-09-27，tip `2da95bb`）**：quick 10/10；visual 12/12，其中 `visual-regression` 门 **498 passed / 1 skipped / 0 failed**（唯一 skip 是 `m240-table-fullscreen.spec.ts` 的「观感截图（不进基线）」既有用例；`render-link` 18/18 含两条像素断言）；`unit-tests` 424 passed / 0 failed；`cargo-test` 全绿；`openspec-validate` 27/27。落点按本 mission 统一在 `test-results/m272/`。
- [x] 8.3 `git diff --check` 通过；改动文件集合与 [proposal.md](proposal.md) 的 Impact 清单一致（出现跨 scope 的只读依赖先报 tower 批准）。
- [x] 8.4 收官对账：tasks 全部勾选（或标注放弃原因）、spec 增量与实现一致（无实现期静默扩 scope）、living spec 归档另走节点 2；`docs/backlog.md` 的「链接渲染与激活（全形态）」条目补一句新形态纳入。

## 9. 已声明的边界 / 不做

- [x] 9.1 不解析引用式链接的**引用点**（`[text][ref]` / `[ref]` 保持原文）；不把无 scheme 的字面 URL（`www.` / 裸邮箱）升级为链接；不改五类分类口径；不改 wikilink 路径；不隐藏定义行的 `[tag]: ` 前缀；`src-tauri/**` 零改动；不新增配置项与打开路径。
  **验收口径**：`git diff --stat src-tauri/` 为空；实现里没有「引用点解析」「URL 猜测」`grep` 命中的新代码；spec 的保持原文清单与实现逐条对应。
- [x] 9.2 已知边界如实写进 spec 与 PR：① 引用点是**半覆盖**（`CODE_OF_CONDUCT.md` 类文档的正文引用点仍不可点，另立 change 的条件见 proposal 裁决面）；② 真机只能验 ⌘⏎（套件不支持修饰键）；③ `mailto:` 裸字面形式会唤起系统邮件客户端；④ frontmatter / 代码块 / HTML 内不装饰是语法树结论而非特例开关。
  **验收口径**：四条在 spec 与实现 PR 里各有一条对应文字。

## 裁决改写指引（任一项改判备选时照此执行）

| 裁决点 | 取备选时的改写动作 |
|---|---|
| D1 排除 `<…>` 自动链接 | delta：删「角括号自动链接装饰为外链」scenario；正文的形态 4 与尖括号隐藏那句删除。tasks：2.2 去掉尖括号隐藏；5.2 计数改为 +1；5.4 负向断言加 `<https://…>`。 |
| D2 严格 http/https | delta：白名单 scheme 那句改为「`http` / `https`」；保持原文清单加 `mailto:` 字面形式。tasks：4.2 的 `mailto` case 翻转为「不入选」。 |
| D3 整行隐藏定义行 | delta：形态 3 那句改为整行替换/隐藏；新增 scenario 描述行不可见态；span 与复制行为要写清新口径。tasks：2.2 新增整行隐藏；5.5 增加「行数/滚动位置变化」的判据；基线影响扩大到含定义行的 fixture。 |
| D4 不纳入表格 cell | delta：保持原文清单加「表格 cell 内的裸 URL」。tasks：删 2.3；5.4 加一条 cell 内负向断言（并声明它与「cell 内链接照常渲染」的口径差异）。 |
| D5 只覆盖鼠标路径 | delta：新增一句「键盘路径（⌘⏎）对新形态无操作」的已知边界。tasks：6.1 整份改为 chromium 承担，真机覆盖记为不可达并如实登记。 |
| D6 编辑态保留装饰 | delta：「光标落在裸 URL 上撤下装饰」scenario 改为「装饰保持，仅撤下…（若取此备选，须说明光标落在 URL 内时是否仍可编辑）」。tasks：5.5 判据翻转。 |

## 实现台账（M272，2026-09-27）——证据指针

| 项 | 读数 | 证据（可 `ls`） |
|---|---|---|
| 单测（新形态节点识别 + 区间 + scheme 前提） | `tests/unit/literal-link.test.ts`：10 组用例全绿（含三种形态的起点/末位/末位之后三态、`Link`/`Image` 祖先排除、无 scheme 字面排除、代码/HTML/frontmatter 上下文） | `node tests/unit/run.mjs` → 424 passed / 0 failed |
| 视觉（装饰 + 激活 + 负向面） | `render-link.spec.ts` 18 个用例：17 绿，1 红是像素基线（5.7 待裁决）；含定义行前缀无操作、末位端点命中、表格 cell 内裸 URL、D6 显露、逐字节不变 | `test-results/m272/visual-render-link-r4.log` |
| 反向验证（视觉） | 回退三文件 → **11 failed / 7 passed** | `test-results/m272/reverse-visual-bare-url.log` |
| 反向验证（真机） | 回退三文件 → 场景 54 **FAIL，9 条断言红**（编辑器中无任何装饰、日志零新增） | `test-results/m272/reverse-acceptance-54.log` |
| 真机场景 54 | **PASS**（38 断言 / 43.9s），与场景 59 同一次运行 2/2 | `test-results/m272/acceptance-final/summary.md`、`.../54-bare-url-cmd-click/{steps.md,shots,ax}` |
| 文案 deck | `git diff HEAD~2 -- 文案-Copy.md` 为空（三种形态复用既有 `↗︎` 与链接样式，零新可见文字） | 本 mission 两次提交的文件清单里无 `文案-Copy.md` |

### 实现期做过的两处「先红后绿」修正（如实登记，防后人重踩）

1. **末位端点取不到 URL**（真机场景 54 第 5 轮实测）：光标停在 `<https://x>|` 的 `>` 位置（= `URL` 节点的 `to`）时两侧 `resolveInner` 都落到尖括号 / 父节点上，⌘⏎ 无反应。修法：`literalLinkAt` 往左邻位补问一次，且只接受「该 URL 的末位正好是 pos」。渲染态下那个位置就是 URL 文本末尾，与标准链接「起点算在链接上」同一条口径。
2. **定义行前缀不是链接本体**：`open` 复位到 0 时 0 落在 `[homepage]: ` 前缀里，⌘⏎ 无操作——装饰的显露范围是整条定义行、激活要求光标落在 `URL` 区间内，两者判据不同。已在 chromium 场景固化成断言对（前缀内无操作 / URL 内命中）。
