# Tasks: image-svg-and-fallback

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，
不是「跑过了」的口头声明（[REVIEW.md](../../../REVIEW.md) 第 7 条）。

## 1. 复现与定位（实现前，先定位再改）

> 机制已在 M165 修订轮复现（design §8.1），因此本组任务从「判明成因」收紧为「用中招形状做 fixture
> + 按已验证的取点实现」——不再需要先做真机定位。

- [ ] 1.1 fixture 用**中招形状**：一份 `width="100%"` + 仅 `viewBox` 的 svg（不带 `height`，即
      design §8.1 实测矩阵的输入）；实现期若能拿到 Alex 报告的那份 `images/hooks-overview.en.svg`
      就直接用它（M165 修订轮在本机 `mdfind` 与用户 vault 里都没找到，取不到不算阻塞）。
      **MUST NOT** 用带 `width`/`height` 的 `sample.svg` 当本条的输入——那个形状不中招（实测 240×80 正常）。
      **验收口径**：fixture 里 `width="100%"` 命中且无 `height=`；形状与 design §8.1 的实测输入逐字一致。
- [ ] 1.2 反向验证（先红）：在**修复前**跑该 fixture 的断言，必须观测到「源码被替换 + 渲染盒 0×0」，
      并把**两个读数一起**记下来：替换区布局盒 `0×0`、`naturalWidth/naturalHeight = 300×100`。
      **验收口径**：截图 + 两个读数落 `test-results/acceptance/<日期>/<场景>/`；断言在修复前为 FAIL。
      只记自然尺寸会得出「加载正常」的错误结论（实测它与渲染结果相反），必须记布局盒——这正是
      design §3.2「判据落在替换区可见尺寸」的实证理由。这一条同时是第 5.2 条反向验证的输入。
- [ ] 1.3 实现取点：**尺寸兜底（把图画出来），不是只做占位**——加载完成后若替换区布局尺寸为 0
      而 `naturalWidth/naturalHeight > 0`，按后者给 `<img>` 设显式像素宽度（高度留 `auto`，宽高比由
      引擎给出的默认对象尺寸决定）。已验证：该做法把 0×0 变为 **300×100**（chromium 与 webkit 一致），
      且 2000×600 的图片仍按既有 `max-width: 100%` 收窄（不回归）。占位是**兜底之后仍不可见时**的
      第二道保险——不变量条款（design §3.1）不变，回退不是本缺陷的主修法。
      **验收口径**：1.2 的断言由 FAIL 转 PASS；对照样本 `width="240" height="80"` 渲染仍为 240×80、
      2000×600 样本仍按栏宽收窄（与修复前逐值相同）；属性测试里「尺寸兜底」与「兜底后仍不可见 → 占位」
      是两条分支，各有输入覆盖。

## 2. 实现：可见回退不变量

- [ ] 2.1 终态判据改为「替换区自身的可见尺寸」：加载完成后，替换区可见内容尺寸为零即认可为
      「不可见」，回落占位；MUST NOT 只以 `naturalWidth`/`naturalHeight` 单点判定。
      **验收口径**：第 5 节的属性测试矩阵全绿；且第 1.2 条的零尺寸样本从「空白」变为「可见占位」，
      有前后两张截图对照。
- [ ] 2.2 加载中状态在任何终态下都不留空窗：MUST NOT 出现「状态块被移除、占位尚未插入」的中间态。
      **验收口径**：属性测试里「加载中不出现空窗」场景 PASS；人工观察一次大附件（慢读）打开过程无
      可见闪烁，录屏或连续截图留档。
- [ ] 2.3 三种引用形态共用同一终态处置：标准 `![alt](rel)`、标准 `![alt](https://…)`、Obsidian
      `![[file.ext]]`。实现上 MUST NOT 为 `svg` 单立分支（`extensionOf(path) === "svg"` 这类特判
      一律不写）。
      **验收口径**：三条形态在属性测试矩阵里各有覆盖；实现 PR 里贴出 `git diff` 证明没有扩展名特判。
- [ ] 2.4 终态占位文案按 design §5 收口：`图片解码失败：{引用}` 退场，改用成因中立的
      `图片无法显示：{引用}`；读取失败仍用 `图片读取失败：{引用}（{原因}）`（成因得出来才写成因）。
      占位一律保留原始引用文本（alt 与路径都在其中）。
      **验收口径**：三条文案的字符串与 `文案-Copy.md` D111–D113 逐字一致；断言「占位文本含原始引用
      串」在视觉与真机两层都有（不靠肉眼）。
- [ ] 2.5 占位与加载态的样式复用既有视觉语言（`.cm-lp-image-error` / `.cm-lp-image-status`，
      `src/preview/theme.ts:144-156`）；若最终必须补一条最小可见尺寸规则，写清为什么既有样式兜不住。
      **验收口径**：`git diff src/preview/theme.ts` 为空，或有且仅有一条新增规则 + 该理由；无新配色、
      无新字体、无新圆角值。
- [ ] 2.6 尺寸兜底（本缺陷的**主修法**，见 design §8.1 与 tasks 1.3）：加载完成后替换区布局尺寸为 0
      而 `naturalWidth/naturalHeight > 0` 时，按自然尺寸给 `<img>` 设显式像素宽度（高度留 `auto`）；
      MUST NOT 借此改写源文件（ADR 0003 §3），MUST NOT 解析 SVG 文本（design §4.2 的安全边界）。
      **验收口径**：1.2 的 fixture 从 0×0 变为 **300×100**（chromium 与 webkit 一致）；对照样本
      `width="240" height="80"` 仍 240×80、2000×600 仍按栏宽收窄；兜底只在布局尺寸为 0 时触发
      （用一个正常渲染的 fixture 断言其尺寸与修复前**逐值相同**，证明对正常图片零行为变化）。

## 3. 实现：SVG 安全渲染口径固化

- [ ] 3.1 确认渲染路径只经 `<img>`：`rg -n "innerHTML|insertAdjacentHTML|DOMParser" src/preview/`
      在图片渲染链路零命中（`mermaid.ts` 的 `innerHTML` 是图表渲染器的信任边界，不在图片链路内）。
      **验收口径**：命令输出贴进 PR；命中即视为未完成。
- [ ] 3.2 在图片渲染入口写一条**为什么必须用 `<img>`** 的短注释（防将来「顺手改成内联」），指向
      design §4 的规范依据；不复制规范正文。
      **验收口径**：注释在，且不超过三行。

## 4. 单测（`tests/unit`，纯逻辑层）

- [ ] 4.1 把可纯化的判定抽出来并加断言：终态分派（可见 / 不可见）的纯判据与占位文案组装。
      **验收口径**：`node tests/unit/run.mjs`（= `pnpm test`）PASS 且新增用例计入 `gate.sh` 的
      `unit-tests` 行；新增用例数写进 PR 说明。
- [ ] 4.2 不把 DOM 行为硬塞进这一层：真 `EditorView` 需要 DOM，本层用假实现只会得到一层假断言
      （`tests/unit/README.md:21-23` 的分工）。
      **验收口径**：`tests/unit/harness.ts` 不新增 DOM 替身；图片 widget 的行为断言全部落在第 5、
      第 6 节两层。

## 5. 视觉场景（chromium，CI 门禁）

- [ ] 5.1 替换 `tests/visual/scenes/markdown-combo.spec.ts:34` 的无区分度断言：现在它被「加载中」
      状态块单独满足（渲染成功 / 空白 / 报错三者都 PASS）。改为两侧都判——「成功渲染时
      `.cm-lp-image img` 存在且可见」与「不可见时不出现零高度替换区」。
      **验收口径**：新断言在**修复前**对零尺寸样本为 FAIL（这条红是 5.2 的产物）；修复后 PASS。
- [ ] 5.2 反向验证（必做，[REVIEW.md](../../../REVIEW.md) 第 1 条的防线）：先把零尺寸 fixture 塞进
      场景，确认新断言**真的红**，再动实现。
      **验收口径**：红灯的输出（playwright 失败信息）留档在 PR 说明里；没有这一步的绿灯不算数。
- [ ] 5.3 新增 fixture：只声明 `viewBox` 的零尺寸 svg、渲染为空的位图样本、含 `<script>` 与
      `onload` 的 svg、含外部 `<image href="https://example.invalid/...">` 的 svg。放在
      `tests/visual/fixtures/markdown-combo/`，与既有 `sample.svg` / `broken.svg` 同处。
      **验收口径**：`ls tests/visual/fixtures/markdown-combo/` 可见四份新文件；每份在场景里被引用。
- [ ] 5.4 把「不执行脚本、不发起外部请求」变成断言：用 `page.on("request")` 收集请求，断言零外部
      请求；脚本执行用一个可观测副作用（如 `document.title` 或全局标记）断言未发生。
      **验收口径**：把该 svg 改为内联渲染（临时实验，不提交）时断言必须变红——即断言有区分度；
      实验结论写进 PR 说明。
- [ ] 5.5 基线核对（[REVIEW.md](../../../REVIEW.md) 第 3 条 + AGENTS.md 的视觉门禁卫生）：
      核对图片占位出现过的场景与全部整页基线的时间戳；确认本次是否需要重拍。
      **验收口径**：存量事实是 `markdown-combo.spec.ts` 无 `toHaveScreenshot`、`baselines/` 下无其
      snapshot 目录，且无其他场景引用图片占位——PR 里逐条核对后写明「本次零基线更新」或列出被更新
      的基线文件名并请 Alex 过目截图（基线更新是人肉裁决点，不机械执行）。

## 6. 真机验收场景（WKWebView，`scripts/acceptance/`）

- [ ] 6.1 新增场景 `scripts/acceptance/scenarios/<id>-image-fallback.md`，覆盖：带 `width`/`height`
      的 svg 正常显示、零尺寸 svg 出可见占位、目标缺失出占位、含脚本与外链的 svg 不执行不请求。
      **验收口径**：`node scripts/acceptance/run.mjs --check` 静态校验 PASS；`run.mjs <id>` 真机 PASS，
      证据落 `test-results/acceptance/<日期>/<场景>/`（`status.txt` = PASS）。
- [ ] 6.2 场景 fixture 落 `scripts/acceptance/fixtures/`，与 md 一起进合成 vault。
      **验收口径**：场景 PASS 且 `steps.md` 里断言逐条可读；断言形态遵守「不可读一律 FAIL」
      （[REVIEW.md](../../../REVIEW.md) 第 2 条）——不要写「AX 里没有该文本即通过」式的负向空转。
- [ ] 6.3 断言用**正**观测：该位置的 AX 文本非空且含原始引用串（`alt` 与路径都在其中）。
      **验收口径**：把 fixture 换成「空白实现」（临时回退到修复前代码）时该断言 FAIL——即断言能
      区分「有占位」与「空白」。
- [ ] 6.4 与 AGENTS.md 的维护权一致：新功能 mission 的 tasks 必带「新增/更新验收场景」，本 change
      的实现 PR 必须同时含 6.1–6.3。
      **验收口径**：实现 PR 的文件列表里同时出现场景 md 与 fixture。

## 7. 文案 deck

- [ ] 7.1 `文案-Copy.md` 追加 D111（图片加载中）、D112（图片读取失败）、D113（图片无法显示），
      编号按末位连续追加（当前末位 D110），五要素（位置 / 角色 / 中文 / English / 设计意图）齐全。
      **验收口径**：`文案-Copy.md` 里 D111–D113 三行齐备，中文与实现字符串逐字一致。
- [ ] 7.2 文末「文案实现备注」段（`文案-Copy.md:105`）登记归属文件，并记录 `图片解码失败：{引用}`
      的退场理由；`加载中… {引用}` 与 `图片读取失败：{引用}（{原因}）` 标注为补登。
      **验收口径**：备注段有本次的登记条目，含三处出处与一条退场说明。

## 8. 验证

- [ ] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（提案阶段与本 PR
      各跑一次）。
      **验收口径**：输出末行 `Totals: N passed, 0 failed`，且 `change/image-svg-and-fallback` 为 ✓。
- [ ] 8.2 `scripts/gate.sh quick` 与 `scripts/gate.sh visual` 全绿。
      **验收口径**：`GATE PASS` 逐行 + `GATE RESULT` 汇总；FAIL 项逐条修完再提交。
- [ ] 8.3 真机套件至少跑一次新增场景并留档（AGENTS.md：dogfood 批次合并后、Alex 验收前先跑一遍）。
      **验收口径**：`test-results/acceptance/<日期>/summary.md` 里本场景为 PASS。
- [ ] 8.4 不改写源文件：所有场景断言 `EditorState.doc` 与磁盘文件逐字节不变（ADR 0003 §3）。
      **验收口径**：视觉场景的 `readDocument(page)` 逐字节比较、真机场景的 `editor.unchangedSince`
      断言均在位且 PASS。
- [ ] 8.5 本 change 的收官对账：tasks 全部勾选（或标注放弃原因）、spec 增量与实现一致、living spec
      归档另走节点 2（本 change 先完成节点 1 提案评审）。
      **验收口径**：`npx --yes @fission-ai/openspec@1.12.0 list` 里本 change 状态与 tasks 勾选一致。
