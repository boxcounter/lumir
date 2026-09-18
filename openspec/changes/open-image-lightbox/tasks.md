# Tasks: open-image-lightbox

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，
不是「跑过了」的口头声明（[REVIEW.md](../../../REVIEW.md) 第 7 条）。

**提案阶段状态（M183，2026-09-18）**：本 change 只到节点 1，以下任务**全部未开工**——`[ ]` 是提案
阶段的默认状态，不是「已实现未勾」。实现批次接手时按第 1 节的现状读数起手，并把每条任务勾选时的
证据指针补进本文件。

**条件项**：第 3.4 与第 9.2 标了「条件项」，取决于 [proposal.md](proposal.md) 裁决点 3 的裁决
（推荐项 = 不加命令、不绑键）。裁决选备选①或②时，这两条转为必做，并追加 `keymap-commands` 的
delta（[proposal.md](proposal.md) 的 Impact 已写明）。裁决点 2 选备选时，第 2.6 与 5.6 按新口径改写。

## 1. 现状读数与反向验证（实现前，先测再改）

- [ ] 1.1 取一次**现状读数**：在含成功渲染图片的文档里双击内联图片，记录 ① 遮罩节点不存在、
      ② 编辑器 caret 行号与 `docText` 与双击前逐值相同、③ 没有源码显露（图片行显示的是图而不是
      `![…](…)`）、④ 无选区产生。
      **验收口径**：读数落 `test-results/acceptance/<日期>/image-lightbox-before/readings.json`（可 `ls`）；
      四项与 [design.md](design.md) §1.1 的机制推断一致，或如实记录不一致的项并改设计（机制推断不是结论）。
- [ ] 1.2 反向验证（先红，[REVIEW.md](../../../REVIEW.md) 第 1 条的防线）：把「双击 → 遮罩可见」
      这条断言先写出来，在**未实现前**跑一次，必须 FAIL（遮罩根本不存在）。
      **验收口径**：红灯输出留档（playwright 失败信息 / 验收 `status.txt` = FAIL）；
      没有这一步的绿灯不算数。
- [ ] 1.3 取一次**反向基线**（可与 1.1 合并）：记录双击前后 `fs_read_attachment` 的调用计数，
      作为 5.5 的对照值。
      **验收口径**：计数落在 1.1 的 `readings.json` 里；对照值在 5.5 被复用。

## 2. 实现：lightbox 本体与接线

- [ ] 2.1 新增 `src/lightbox.ts`（能力与 DOM 在本模块，与 `src/toc.ts` / `src/bindings-panel.ts` 同级
      同形）：遮罩 + 居中容器 + `<img>`（`alt` = 原始引用文本）、`role="dialog"` + `aria-modal="true"`
      + `tabIndex = -1`、`open(src, rawRef)` / `close(restoreFocus)` 单入口、就地 `Esc`（`keyToken` 归一化）。
      **验收口径**：模块内只有一处 `dblclick` 语义、一处 `close`；**零** `extensionOf(path) === "svg"`
      这类扩展名分支（`grep -n "svg" src/lightbox.ts` 无判定语义）；`Esc` 不入 `KEY_BINDINGS`。
- [ ] 2.2 接线：`PreviewContext` 增可选口子（形如 `openLightbox()`），三处 `ImageWidget` 构造点传参
      （`src/preview/livePreview.ts` 的 `buildStandardImage` 两分支与 `buildWikiEmbedWidget`），
      `src/main.ts` 装配（挂点 `shell.root`、`restoreFocus: () => editor.view.focus()`）。
      **验收口径**：未接线的路径（单测 / 桩）不抛错、无双击行为（与 `attachmentProvider()` 未接线时
      走占位同一口径）；`git diff` 里 `src-tauri/**` 为空。
- [ ] 2.3 **双击只挂在终态渲染出的 `<img>` 上**，MUST NOT 挂在 widget 容器、加载态状态块或占位块上；
      回调不参与 `ImageWidget.eq()`。
      **验收口径**：`src/preview/attachments.ts` 里 `addEventListener("dblclick", …)` 只出现一次且
      在 `<img>` 创建之后；`eq()` 未改动；三条占位形态（加载中 / 读取失败 / 终态不可见）与
      `AttachmentNoticeWidget` 的 DOM 里都没有监听者（可在场景里用 `getEventListeners` 不可用时改判
      「双击后遮罩不出现」这一行为判据，见 5.4）。
- [ ] 2.4 放大图的 `src` = 内联 `<img>` 的 `src`（同一字符串）；MUST NOT 再调 `fs_read_attachment`；
      MUST NOT 把内联 `<img>` 搬进遮罩。
      **验收口径**：5.5 的调用计数断言 PASS；`git diff` 里 lightbox 路径无 `invoke` / `fsReadAttachment`
      调用（`grep -n "invoke\|fsReadAttachment" src/lightbox.ts` 零命中）。
- [ ] 2.5 遮罩 DOM 惰性建立：首次打开时才建（MUST NOT 在文档打开路径上预建）。
      **验收口径**：5.5 的「文档打开路径零新增」断言 PASS（未双击时 DOM 里没有遮罩节点）。
- [ ] 2.6 缩放口径按裁决点 2 的裁决实现（默认：**适配遮罩且不放大**——不设 `width`/`height`，
      `max-width: 100%` + `max-height: 100%` + 父项 `min-width: 0; min-height: 0`；
      MUST NOT 用 `object-fit` 兜一个固定框）。
      **验收口径**：5.6 两侧断言 PASS（大图不越界、小图不放大）；反向验证——去掉 `max-height` 后
      大图断言必须 FAIL，红灯留档。
- [ ] 2.7 实测一次大图放大的开销（decode 复用未验证，见 [design.md](design.md) §8）：同一份 data URL
      在遮罩里第二次使用时的首次打开耗时与内存读数（含一份接近上限的大图样本）。
      **验收口径**：读数写进实现 PR；异常（如内存显著上升）如实记为已知边界并另立 finding，
      MUST NOT 在报告里宣称「复用已解码位图」。

## 3. 实现：遮罩行为（焦点、关闭路径、不穿透）

- [ ] 3.1 四条关闭路径回到同一个 `close`：`Esc`（就地消费 + `preventDefault`）、点击遮罩
      （`mousedown` + `preventDefault`）、遮罩内再次双击图片（放大图 `mousedown` + `preventDefault`）、
      遮罩 `blur` → `close(false)`（不抢焦点）。
      **验收口径**：`blur` 那条的误伤防线——遮罩点击路径必须先 `preventDefault` 再关闭，否则失焦会把
      `restoreFocus` 吃掉（[design.md](design.md) §4.2 的第二个坑）；5.3 断言「三条用户路径关闭后
      焦点都在编辑器」（用行为判据：关闭后 `⌃D` 真的删字符）。
- [ ] 3.2 `Tab` / `⇧Tab` 留在遮罩内（`preventDefault`），遮罩持有焦点期间 `editor` 作用域的键不穿透。
      **验收口径**：5.3 的「不穿透」断言 PASS（文档逐字节不变、caret 不动）。
- [ ] 3.3 打开与关闭 MUST NOT 改写文档、MUST NOT 改变选区 / 光标落点、MUST NOT 让图片行显露源码；
      双击 `preventDefault`（防原生 caret 滞留进被替换的 widget DOM）但**不**把光标送进源码区间。
      **验收口径**：5.3 的 `docText` / `caret` / 图片行显示态逐值断言 PASS；对照 1.1 的现状读数逐值相同；
      实现注释写明为什么与 M111 / M112「点击进源码编辑」口径相反（指针到 `design.md` §4.4）。
- [ ] 3.4 **（条件项：裁决点 3 选备选①/② 才做）** 加命令 `image.open-lightbox`：作用域、默认绑键
      （或登记进 `KEYLESS_COMMAND_IDS`）、「光标处是图片引用」的定位口径、`doc` 字段来由；
      同步 `keymap-commands` 的 delta（MODIFIED）与键位面板的既有 scenario。
      **验收口径**：装配期对账（无重复绑定 / 无孤儿命令 / 清单与绑定表无交集）PASS；
      面板与 `[keys]` 两条路径各有一条断言；若默认不绑键，面板那行显示「未绑定」并说明成因。

## 4. 单测（`tests/unit`，纯逻辑层）

- [ ] 4.1 把可纯化的部分抽出来并加断言：如「可打开性」判据（终态 DOM 有 `<img>` 才可打开）与
      缩放口径的取整/边界计算（若实现里有像素运算）。
      **验收口径**：`node tests/unit/run.mjs`（= `pnpm test`）PASS，新增用例计入 `gate.sh` 的
      `unit-tests` 行；新增用例数写进 PR 说明。
- [ ] 4.2 不把 DOM 行为硬塞进这一层（`tests/unit/README.md:21-23` 的分工）：遮罩行为断言全部落在
      第 5、第 6 节两层，`tests/unit/harness.ts` 不新增 DOM 替身。
      **验收口径**：`git diff tests/unit/harness.ts` 为空。

## 5. 视觉场景（chromium，CI 门禁）

- [ ] 5.1 在 `tests/visual/scenes/markdown-combo.spec.ts` 新增 lightbox 断言组（该场景已有
      `images.md` 的十条引用与附件读桩 `stubAttachmentReads`，是现成的输入面）：双击成功渲染的图片 →
      遮罩出现 **且放大图渲染盒宽高非零**。
      **验收口径**：判据是几何读数而不是 class 存在（[REVIEW.md](../../../REVIEW.md) 第 1 条）；
      1.2 的红灯在此转为绿。
- [ ] 5.2 三条关闭路径各一条断言 + 关闭后焦点在编辑器（行为判据：关闭后按 `⌃D` 真的删掉字符，
      且断言前后 `docText` 的差异恰好是那一个字符）。
      **验收口径**：三条路径各自可单独读出（MUST NOT 合并成一条「关闭后遮罩不可见」）。
- [ ] 5.3 不穿透与不动文档/选区：遮罩打开期间按 `⌃D` / `⌃K` / `⌃A` 与 `Tab`，断言 `docText` 逐字节
      不变、caret 不动、焦点仍在遮罩内；打开与关闭前后 `docText` / `caret` / 图片行显示态逐值不变
      （含「图片行仍是图、不是源码」）。
      **验收口径**：与 1.1 的现状读数逐值对照；`readDocument(page)` 的逐字节比较在位且 PASS。
- [ ] 5.4 不可打开形态：同一份文档里双击 ① 加载中状态块（用读桩延迟制造窗口）、② `图片读取失败：…`
      占位、③ `图片无法显示：…` 占位、④ `附件未找到` / `内容嵌入不支持` 占位、⑤ 外部 `http(s)`
      目标落下的占位 —— 遮罩一次都不出现；**同一场景里再双击一张已渲染成功的图片，遮罩出现**。
      **验收口径**：负向断言必须与正观测配对（[REVIEW.md](../../../REVIEW.md) 第 2 条：不可读/不存在
      类断言先确认读到的是真值）；反向验证——把 2.3 的双击挂到容器上，本断言必须变红（留档）。
- [ ] 5.5 字节与惰性两条：`fs_read_attachment` 的调用计数在打开遮罩前后不变（对照 1.3 的基线）；
      未双击时 DOM 里没有遮罩节点。
      **验收口径**：两条都是可复算的计数/节点判据，读数与 1.3 的基线对照。
- [ ] 5.6 缩放口径两侧：远大于窗口的图（既有 `wide.svg` 是 2000×600，可再加一份更高的样本）放大后
      渲染盒宽高都 ≤ 遮罩可用区域；小于窗口的图放大后渲染盒 ≤ 自然尺寸。
      **验收口径**：去掉 `max-height` 的临时改动下前者必须 FAIL（红灯留档）。
- [ ] 5.7 基线核对（[REVIEW.md](../../../REVIEW.md) 第 3 条 + AGENTS.md 的视觉门禁卫生）：
      逐张核对图片引用出现过的场景与全部整页基线的时间戳；lightbox 是新元素，确认是否需要新增
      元素级基线。
      **验收口径**：PR 里写明「零基线更新」或列出新增 / 重拍的基线文件名，并给前后截图请 Alex 过目
      （基线更新是人肉裁决点，不机械执行）；核对方式落在**内容判据**上（`grep -rln` 定位含图片的场景），
      不是只看时间戳。

## 6. 真机验收场景（WKWebView，`scripts/acceptance/`）

- [ ] 6.1 **新增场景** `scripts/acceptance/scenarios/23-image-lightbox.md`（编号按现有最大 22 续），
      覆盖：双击成功渲染的图（固定尺寸 svg 与位图各一）→ 遮罩出现；`Esc` 关闭后焦点回编辑器；
      三条关闭路径。
      **断言形态**：放大图的可见性用 **AXImage 节点的几何读数**（节点行里的 `@x,y w×h` 宽高非零）——
      不可见图的 AX 文本照样读得到，这是 M178 在 `scripts/acceptance/README.md:70-71` 记下的陷阱；
      MUST NOT 只断言「AX 里有某个文本」。
      **验收口径**：`node scripts/acceptance/run.mjs --check` 静态校验 PASS；`run.mjs 23` 真机 PASS，
      证据落 `test-results/acceptance/<日期>/23-image-lightbox/`（`status.txt` = PASS、`steps.md`
      断言逐条可读）。
- [ ] 6.2 场景 fixture 落 `scripts/acceptance/fixtures/`（可复用既有 `image-fallback-normal.svg` /
      `image-fallback-percent.svg`，必要时补一份小图位图），与 md 一起进合成 vault。
      **验收口径**：场景 PASS 且 fixture 在 `fixtures:` 里逐条列名；断言遵守「不可读一律 FAIL」
      （[REVIEW.md](../../../REVIEW.md) 第 2 条），MUST NOT 写「读不到该文本即通过」式的负向空转。
- [ ] 6.3 真机反向验证：把双击路径临时去掉（或回退到实现前代码）跑同一场景，断言必须 FAIL
      （遮罩不出现 / AXImage 几何断言失配）。
      **验收口径**：FAIL 的 `status.txt` 与 `steps.md` 留档；没有这一步的 PASS 不算数。
- [ ] 6.4 与 AGENTS.md 的维护权一致：新功能 mission 的 tasks 必带「新增/更新验收场景」，本 change 的
      实现 PR 必须同时含 6.1–6.2。
      **验收口径**：实现 PR 的文件列表里同时出现场景 md 与 fixture。
- [ ] 6.5 不改写源文件的真机判据：`editor.unchangedSince`（编辑器内容）与磁盘文件的
      `unchangedSince` 两条断言在位且 PASS（ADR 0003 §3）。
      **验收口径**：两条各占一条可单独读出的步骤，不合并且不省略。

## 7. 文案 deck

- [ ] 7.1 按裁决点 4 的裁决处置：**推荐项 = 不新增条目**（本 change 不引入提示文案），此时在
      [design.md](design.md) 与实现 PR 里写明「不改 `文案-Copy.md`」及理由（就地键只有 `Esc`，
      另两条关闭路径是鼠标动作；与 `toc-outline` 的就地键提示义务的差别见 proposal 裁决点 4）。
      若裁决选备选①（加提示），则追加 D114（末位当前 D113）并在文末「文案实现备注」段登记归属文件。
      **验收口径**：`git diff 文案-Copy.md` 为空（推荐项），或 D114 一行 + 备注段一条（备选①），
      且实现里的串与 deck 逐字一致。

## 8. 验证与收官

- [ ] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
      **验收口径**：输出末行 `Totals: N passed, 0 failed`（提案落地时基线 14 → 加本 change 后 15），
      且 `change/open-image-lightbox` 为 ✓。
- [ ] 8.2 `scripts/gate.sh quick` 与 `scripts/gate.sh visual` 全绿（视觉侧按 AGENTS.md 的口径本地跑，
      CI 只跑结构层）。
      **验收口径**：`GATE PASS` 逐行 + `GATE RESULT` 汇总；FAIL 项逐条修完再提交。
- [ ] 8.3 真机套件至少跑一次新增场景并留档（AGENTS.md：dogfood 批次合并后、Alex 验收前先跑一遍）。
      **验收口径**：`test-results/acceptance/<日期>/summary.md` 里本场景为 PASS；报告里给可 `ls` 的
      绝对路径指针。
- [ ] 8.4 `git diff --check` 通过；改动文件集合与本 change 的 Impact 清单一致（出现跨 scope 的只读
      依赖须先报 tower 批准）。
      **验收口径**：改动集合 = `src/lightbox.ts`（新）/ `src/preview/attachments.ts` /
      `src/preview/livePreview.ts` / `src/main.ts` / `src/style.css` / 测试与验收制品 / 本 change 目录
      （+ 备选路径下的 `src/keys.ts`、`src/bindings-panel.ts`、`文案-Copy.md`）。
- [ ] 8.5 收官对账：tasks 全部勾选（或标注放弃原因）、spec 增量与实现一致、living spec 归档另走节点 2。
      **验收口径**：`npx --yes @fission-ai/openspec@1.12.0 list` 里本 change 状态与 tasks 勾选一致；
      节点 2 前逐条对账 delta 与实现（无实现期静默扩 scope）。

## 9. 已声明的边界 / 不做

- [ ] 9.1 不做缩放控件、手势缩放、拖拽平移、旋转与「另存为」；不做文档内多图导航；不做新标签页 /
      系统预览；不改内联图片的排版口径（`max-width: 100%` 不动）；不改路径解析、字节通道、CSP 与
      Rust 侧任何文件。
      **验收口径**：`git diff --stat` 里 `src-tauri/**` 为空；`src/preview/theme.ts` 的
      `.cm-lp-image img` 段未改；实现里没有「上一张/下一张」这类状态。
- [ ] 9.2 **（条件项）** 键盘打开路径：推荐项下本 change 不提供（如实写进 spec 的已知边界与
      proposal 裁决点 3）；若裁决选备选①/②，则 3.4 转为必做，本条相应改写为「已提供」并补断言。
      **验收口径**：与裁决结果一致的表述（不出现「有命令但没断言」或「声称可达实则只能鼠标」的落差）。
- [ ] 9.3 已知边界（如实记录，不许当成已验）：同一 `data:` URL 的 decode 复用未验证（2.7 实测）；
      「遮罩失焦即关」的行为由第 6 节的真机场景覆盖、其手感（是否觉得「怎么自己关了」）归 Alex，
      套件只留截图；小图（不放大）双击的观感代价见 proposal 裁决点 2。
      **验收口径**：三项在 spec 的已知边界段与实现 PR 的说明里各有一条对应文字。
