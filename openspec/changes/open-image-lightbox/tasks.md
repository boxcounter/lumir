# Tasks: open-image-lightbox

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，
不是「跑过了」的口头声明（[REVIEW.md](../../../REVIEW.md) 第 7 条）。

**提案阶段状态（M183，2026-09-18）**：本 change 只到节点 1，以下任务**全部未开工**——`[ ]` 是提案
阶段的默认状态，不是「已实现未勾」。实现批次接手时按第 1 节的现状读数起手，并把每条任务勾选时的
证据指针补进本文件。

**条件项**：第 3.4 与第 9.2 标了「条件项」，取决于 [proposal.md](proposal.md) 裁决点 3 的裁决
（推荐项 = 不加命令、不绑键）。裁决选备选①或②时，这两条转为必做，并追加 `keymap-commands` 的
delta（[proposal.md](proposal.md) 的 Impact 已写明）。裁决点 2 选备选时，第 2.6 与 5.6 按新口径改写。

**裁决状态（2026-09-19，节点 1 = Alex 原话「B 全推荐」）**：四项全取推荐项，见
[proposal.md](proposal.md) 的「裁决记录」节。因此 **3.4 与 9.2 按「节点 1 未选中」处理——不做**，
delta 与本文档均不改写；2.6 与 5.6 按推荐项（适配遮罩且不放大）实现与断言。任务编号沿用提案原编号
（真机场景一项编号由 23 改为 **24**：23 已被 M182 的 `23-image-first-open-width` 占用；该场景
**未落库**，见下）。

**实现批次状态（M184，2026-09-19）**：实现与 chromium 层完成，**第 6 节（真机验收场景）未做**——
验收套件的注入通道在 WKWebView 里造不出 DOM 的 `dblclick`，以 `dblclick` 为唯一打开路径的交互无法
在真机层驱动（四条通道实测：坐标 `count: 2`、AX 索引 `count: 2`、两次独立 click、`drag_paths` 两条
单点路径；对照判据与现场见 `scripts/acceptance/README.md` 的「已知边界」新增条目与
`test-results/m184/13`～`/17`）。tower 裁决（2026-09-19，**A+C 组合**，原文
`.tower/comms/inbox/20260919-tower-worker-lightbox-impl-clarify-reply-m184-a-c-chromium-alex.md`）：
**行为判别层由 chromium 断言组承担**（第 5 节；反向验证先红后绿），**真机侧留人工清单**给 Alex 的
dogfood 手感项 [manual-acceptance-checklist.md](manual-acceptance-checklist.md)。第 6 节各条按
「真机通道不可达，未做」标注，**不勾选、不冒称**——一个只验前置条件的场景会让人误读为「真机验过」
（[REVIEW.md](../../../REVIEW.md) 第 6 条）；曾按验收口径写好的场景 `24-image-lightbox` 与四个 fixture
已从工作区撤下（**未落库**）。证据根目录：`test-results/m184/` 与 `test-results/acceptance/2026-09-19/`
（本机，git 外）。

## 1. 现状读数与反向验证（实现前，先测再改）

- [x] 1.1 取一次**现状读数**：在含成功渲染图片的文档里双击内联图片，记录 ① 遮罩节点不存在、
      ② 编辑器 caret 行号与 `docText` 与双击前逐值相同、③ 没有源码显露（图片行显示的是图而不是
      `![…](…)`）、④ 无选区产生。
      **验收口径**：读数落 `test-results/acceptance/<日期>/image-lightbox-before/readings.json`（可 `ls`）；
      四项与 [design.md](design.md) §1.1 的机制推断一致，或如实记录不一致的项并改设计（机制推断不是结论）。
      **实现记录（M184）**：四项全部与机制推断一致（实现前双击前后 10 项读数逐值相同：`overlayNodes` 0、
      `caretrHead/anchor` 恒 0、`sourceRevealed` false、选区折叠）。读数
      `test-results/acceptance/2026-09-19/image-lightbox-before/readings.json`（实现前）与
      `readings-after.json`（实现后；双击前的那一组与实现前逐值相同），对照表 `comparison.md`，
      跑法日志 `test-results/m184/08-readings-before.log`、`/18`。
- [x] 1.2 反向验证（先红，[REVIEW.md](../../../REVIEW.md) 第 1 条的防线）：把「双击 → 遮罩可见」
      这条断言先写出来，在**未实现前**跑一次，必须 FAIL（遮罩根本不存在）。
      **验收口径**：红灯输出留档（playwright 失败信息 / 验收 `status.txt` = FAIL）；
      没有这一步的绿灯不算数。
      **实现记录（M184）**：把整个 `src/` 改动（含未跟踪的 `src/lightbox.ts`）`git stash -u` 掉之后跑
      M184 断言组 → **5/5 红**（红在「遮罩不存在」）：`test-results/m184/09-red-authoritative.log`；
      恢复实现后 5/5 绿：`test-results/m184/02-green-attempt-1.log`。
- [x] 1.3 取一次**反向基线**（可与 1.1 合并）：记录双击前后 `fs_read_attachment` 的调用计数，
      作为 5.5 的对照值。
      **验收口径**：计数落在 1.1 的 `readings.json` 里；对照值在 5.5 被复用。
      **实现记录（M184）**：十条引用 = 10 次读取，双击打开遮罩前后仍是 10 次（`readings.json` /
      `readings-after.json` 的 `attachmentReads`），5.5 复用同一读数。

## 2. 实现：lightbox 本体与接线

- [x] 2.1 新增 `src/lightbox.ts`（能力与 DOM 在本模块，与 `src/toc.ts` / `src/bindings-panel.ts` 同级
      同形）：遮罩 + 居中容器 + `<img>`（`alt` = 原始引用文本）、`role="dialog"` + `aria-modal="true"`
      + `tabIndex = -1`、`open(src, rawRef)` / `close(restoreFocus)` 单入口、就地 `Esc`（`keyToken` 归一化）。
      **验收口径**：模块内只有一处 `dblclick` 语义、一处 `close`；**零** `extensionOf(path) === "svg"`
      这类扩展名分支（`grep -n "svg" src/lightbox.ts` 无判定语义）；`Esc` 不入 `KEY_BINDINGS`。
      **实现记录（M184）**：`src/lightbox.ts`（新）。结构：`createLightboxState`（纯状态机，DOM 只经
      `LightboxSurface` 进出）+ `createImageLightbox`（DOM/焦点/四条关闭路径）。`grep -n "svg"
      src/lightbox.ts` 零命中（无扩展名分支）；关闭单入口是状态机的 `close(reason)`（四条路径共用）；
      `git diff src/keys.ts` 为空（`Esc` 就地消费，未进 `KEY_BINDINGS`）。
- [x] 2.2 接线：`PreviewContext` 增可选口子（形如 `openLightbox()`），三处 `ImageWidget` 构造点传参
      （`src/preview/livePreview.ts` 的 `buildStandardImage` 两分支与 `buildWikiEmbedWidget`），
      `src/main.ts` 装配（挂点 `shell.root`、`restoreFocus: () => editor.view.focus()`）。
      **验收口径**：未接线的路径（单测 / 桩）不抛错、无双击行为（与 `attachmentProvider()` 未接线时
      走占位同一口径）；`git diff` 里 `src-tauri/**` 为空。
      **实现记录（M184）**：`PreviewContext` 新增 `lightbox(): ImageLightbox | null`（`src/preview/livePreview.ts`），
      四处构造点传双击回调（`grep -c "imageOpenHandler(ctx)" src/preview/livePreview.ts` = 4，含外部 URL
      分支）；装配在 `src/main.ts`（挂点 `shell.root`、`restoreFocus`）。注入口经 `EditorHandle.setLightbox`
      （`src/editor.ts`，随 `previewRefresh` 重建装饰）——比 Impact 清单多一个 `src/editor.ts`（口子要从
      装配层走到装饰层，这是既有 `setWikilinkResolver` 的同款路径）。未接线时不传回调 → widget 不挂监听
      （`attachments.ts` 的 `if (this.onDoubleClick !== undefined)`）。`git diff --stat src-tauri/` 为空。
- [x] 2.3 **双击只挂在终态渲染出的 `<img>` 上**，MUST NOT 挂在 widget 容器、加载态状态块或占位块上；
      回调不参与 `ImageWidget.eq()`。
      **验收口径**：`src/preview/attachments.ts` 里 `addEventListener("dblclick", …)` 只出现一次且
      在 `<img>` 创建之后；`eq()` 未改动；三条占位形态（加载中 / 读取失败 / 终态不可见）与
      `AttachmentNoticeWidget` 的 DOM 里都没有监听者（可在场景里用 `getEventListeners` 不可用时改判
      「双击后遮罩不出现」这一行为判据，见 5.4）。
      **实现记录（M184）**：`grep -c 'addEventListener("dblclick"' src/preview/attachments.ts` = 1，位置在
      `document.createElement("img")` 之后、同一个 `load().then` 成功分支内；`eq()` 只比 `key` / `rawRef`
      （注释写明回调不参与及其理由）。行为判据走 5.4（逐处双击占位 + 同场景配对的正观测）。
- [x] 2.4 放大图的 `src` = 内联 `<img>` 的 `src`（同一字符串）；MUST NOT 再调 `fs_read_attachment`；
      MUST NOT 把内联 `<img>` 搬进遮罩。
      **验收口径**：5.5 的调用计数断言 PASS；`git diff` 里 lightbox 路径无 `invoke` / `fsReadAttachment`
      调用（`grep -n "invoke\|fsReadAttachment" src/lightbox.ts` 零命中）。
      **实现记录（M184）**：回调取 `img.src` 原样交给遮罩（`livePreview.ts` 的 `imageOpenHandler`），
      遮罩只做一次 `overlayImg.src = src`；`grep -n "invoke\|fsReadAttachment" src/lightbox.ts` 零命中。
      计数判据：5.5（chromium，10 → 10）+ 1.3 的读数。
- [x] 2.5 遮罩 DOM 惰性建立：首次打开时才建（MUST NOT 在文档打开路径上预建）。
      **验收口径**：5.5 的「文档打开路径零新增」断言 PASS（未双击时 DOM 里没有遮罩节点）。
      **实现记录（M184）**：`createImageLightbox` 只在 `open()` 里经 `ensureState()` 建 DOM 与监听；
      5.5 断言「未双击时 `.lumir-lightbox-overlay` 计数为 0」与「再次打开不建第二个节点」。
- [x] 2.6 缩放口径按裁决点 2 的裁决实现（默认：**适配遮罩且不放大**——不设 `width`/`height`，
      `max-width: 100%` + `max-height: 100%` + 父项 `min-width: 0; min-height: 0`；
      MUST NOT 用 `object-fit` 兜一个固定框）。
      **验收口径**：5.6 两侧断言 PASS（大图不越界、小图不放大）；反向验证——去掉 `max-height` 后
      大图断言必须 FAIL，红灯留档。
      **实现记录（M184）**：`src/style.css` 的 `.lumir-lightbox-img` 不设 `width`/`height`（小图不放大由
      浏览器默认行为给出），越界由 `max-*` 挡住，未用 `object-fit`。**反向验证的配方被实现期实测修正**：
      按提案原配方（`wide.svg` 2000×600）去掉 `max-height` **仍然全绿**——它被宽度夹住，高度根本没到界限，
      那条断言没有区分度；改用**高图**（600×2000）后去掉 `max-height` 当场红（渲染 2000px > 可用 921px）：
      `test-results/m184/05-red-no-max-height-tall.log`。另两条（单独去掉 `max-width`、单独去掉 `min-*`）
      实测仍绿（`/06`、`/07`，本布局下宽度一侧由 flex 自动收缩与 `max-*` 各自足够），口径修正已写进
      [design.md](design.md) §5。
- [x] 2.7 实测一次大图放大的开销（decode 复用未验证，见 [design.md](design.md) §8）：同一份 data URL
      在遮罩里第二次使用时的首次打开耗时与内存读数（含一份接近上限的大图样本）。
      **验收口径**：读数写进实现 PR；异常（如内存显著上升）如实记为已知边界并另立 finding，
      MUST NOT 在报告里宣称「复用已解码位图」。
      **实现记录（M184）**：chromium 实测（2600×1800 的 6.1MB PNG data URL）——首次 `decode()` **48.9ms**、
      同一串第二次 **0.1ms**、**像素相同但串不同**的对照 **49.3ms** ⇒ **复用成立，且按 URL 字符串键控**；
      真实路径（1.85MB svg）首次打开 0.5ms、再次 0.2ms。内存读数**读不出**（`usedJSHeapSize` 恒
      33.1MB，如实记为无效量度，不给内存结论）。**样本未到 50MB 上限**（那需要一份极大 fixture），
      按「接近上限的大图表现归 fs-io 既有边界」记。读数 `test-results/m184/10-decode-probe.json`，
      结论落 design §8 与 `src/lightbox.ts` 头部注释。**WKWebView 未测**（真机通道驱动不了双击，见第 6 节）。

## 3. 实现：遮罩行为（焦点、关闭路径、不穿透）

- [x] 3.1 四条关闭路径回到同一个 `close`：`Esc`（就地消费 + `preventDefault`）、点击遮罩
      （`mousedown` + `preventDefault`）、遮罩内再次双击图片（放大图 `mousedown` + `preventDefault`）、
      遮罩 `blur` → `close(false)`（不抢焦点）。
      **验收口径**：`blur` 那条的误伤防线——遮罩点击路径必须先 `preventDefault` 再关闭，否则失焦会把
      `restoreFocus` 吃掉（[design.md](design.md) §4.2 的第二个坑）；5.3 断言「三条用户路径关闭后
      焦点都在编辑器」（用行为判据：关闭后 `⌃D` 真的删字符）。
      **实现记录（M184）**：`close(reason)` 单入口（`escape` / `overlay` / `image` 交还焦点，`blur` 不抢），
      两个 `mousedown` 都在关闭之前 `preventDefault`。状态机层断言见 4.1；DOM 行为见 5.2（三条路径各一条 +
      关闭后 ⌃D 的恰好一个字符差异 + ⌘Z 复位）。
- [x] 3.2 `Tab` / `⇧Tab` 留在遮罩内（`preventDefault`），遮罩持有焦点期间 `editor` 作用域的键不穿透。
      **验收口径**：5.3 的「不穿透」断言 PASS（文档逐字节不变、caret 不动）。
      **实现记录（M184）**：遮罩的 keydown 里 `Tab` / `Shift-Tab` 先 `preventDefault` 返回；5.3 断言
      遮罩打开期间按 `⌃D` / `⌃K` / `⌃A` / `Tab` 之后 `docText` / `caret` 逐值不变、`focusInfo.isOverlay`
      仍为 true。
- [x] 3.3 打开与关闭 MUST NOT 改写文档、MUST NOT 改变选区 / 光标落点、MUST NOT 让图片行显露源码；
      双击 `preventDefault`（防原生 caret 滞留进被替换的 widget DOM）但**不**把光标送进源码区间。
      **验收口径**：5.3 的 `docText` / `caret` / 图片行显示态逐值断言 PASS；对照 1.1 的现状读数逐值相同；
      实现注释写明为什么与 M111 / M112「点击进源码编辑」口径相反（指针到 `design.md` §4.4）。
      **实现记录（M184）**：`src/preview/attachments.ts` 的 `img` 上 `mousedown` 只 `preventDefault`、
      **不** dispatch 选区（注释指向 design §4.4 说明与 M111/M112 的差异）；读数对照见 1.1（打开前后
      `caret` / `docText` / 图片行显示态逐值相同）。
- [ ] 3.4 **（条件项：裁决点 3 选备选①/② 才做）** 加命令 `image.open-lightbox`：作用域、默认绑键
      （或登记进 `KEYLESS_COMMAND_IDS`）、「光标处是图片引用」的定位口径、`doc` 字段来由；
      同步 `keymap-commands` 的 delta（MODIFIED）与键位面板的既有 scenario。
      **验收口径**：装配期对账（无重复绑定 / 无孤儿命令 / 清单与绑定表无交集）PASS；
      面板与 `[keys]` 两条路径各有一条断言；若默认不绑键，面板那行显示「未绑定」并说明成因。
      **实现记录（M184）**：**节点 1 未选中**（裁决点 3 取推荐项：不加命令、不绑键），本 mission 不做；
      `git diff src/keys.ts` 为空。

## 4. 单测（`tests/unit`，纯逻辑层）

- [x] 4.1 把可纯化的部分抽出来并加断言：如「可打开性」判据（终态 DOM 有 `<img>` 才可打开）与
      缩放口径的取整/边界计算（若实现里有像素运算）。
      **验收口径**：`node tests/unit/run.mjs`（= `pnpm test`）PASS，新增用例计入 `gate.sh` 的
      `unit-tests` 行；新增用例数写进 PR 说明。
      **实现记录（M184）**：新增 `tests/unit/lightbox.test.ts`，**6 条用例**（打开的动作顺序
      `load → show → focus`；`Esc` 就地消费并交还、其余 token 不消费；三条用户关闭路径都交还焦点 /
      `blur` 不抢焦点；已关闭后的迟到关闭是空操作；`blur` 先关之后用户路径不再补一次交还；打开态换源）。
      `node tests/unit/run.mjs` = **73 通过 / 0 失败**（此前 67），`gate.sh quick` 的 `unit-tests` 行 PASS。
      **与验收口径的两处偏差，如实记录**：① 「可打开性判据」在本实现里是**结构性事实**（监听器只挂在
      终态 `<img>` 上），在无 DOM 的层里写出来只会是一条恒真断言（[REVIEW.md](../../../REVIEW.md) 第 1 条
      的假绿形态）——因此不在这层加，由 5.4 的行为判据承担；② 「缩放口径的取整/边界计算」不适用（纯 CSS，
      实现里没有像素运算），由 5.6 的两侧几何断言承担。
- [x] 4.2 不把 DOM 行为硬塞进这一层（`tests/unit/README.md:21-23` 的分工）：遮罩行为断言全部落在
      第 5、第 6 节两层，`tests/unit/harness.ts` 不新增 DOM 替身。
      **验收口径**：`git diff tests/unit/harness.ts` 为空。
      **实现记录（M184）**：`git diff tests/unit/harness.ts` 为空；新用例注入的是模块内的假
      `LightboxSurface`（不碰 DOM，也不新增 harness 替身）；`tests/unit/README.md` 的覆盖表补了一行。

## 5. 视觉场景（chromium，CI 门禁）

- [x] 5.1 在 `tests/visual/scenes/markdown-combo.spec.ts` 新增 lightbox 断言组（该场景已有
      `images.md` 的十条引用与附件读桩 `stubAttachmentReads`，是现成的输入面）：双击成功渲染的图片 →
      遮罩出现 **且放大图渲染盒宽高非零**。
      **验收口径**：判据是几何读数而不是 class 存在（[REVIEW.md](../../../REVIEW.md) 第 1 条）；
      1.2 的红灯在此转为绿。
      **实现记录（M184）**：`markdown-combo.spec.ts` 末尾新增「M184」断言组 **5 条用例**。打开判据 =
      放大图渲染盒宽高非零 + `alt` = 原始引用文本 + `src` 与内联那张**逐字符相同**（三条一起，
      不用 class 存在）；红灯转绿的记录见 1.2（`test-results/m184/09` → `/02`）。
- [x] 5.2 三条关闭路径各一条断言 + 关闭后焦点在编辑器（行为判据：关闭后按 `⌃D` 真的删掉字符，
      且断言前后 `docText` 的差异恰好是那一个字符）。
      **验收口径**：三条路径各自可单独读出（MUST NOT 合并成一条「关闭后遮罩不可见」）。
      **实现记录（M184）**：`Esc` / 点击遮罩 / 遮罩内再次双击图片各占一步，每步之后跑同一条行为判据
      （`deletesAtCaretAfterClose`：`⌃D` 删掉光标处那**一个**字符——按「前后两段拼回原文」逐字节判，
      再 `⌘Z` 复位）。三条路径各自的「关闭后焦点在编辑器」也由 `focusInfo().inEditor` 单独断言。
- [x] 5.3 不穿透与不动文档/选区：遮罩打开期间按 `⌃D` / `⌃K` / `⌃A` 与 `Tab`，断言 `docText` 逐字节
      不变、caret 不动、焦点仍在遮罩内；打开与关闭前后 `docText` / `caret` / 图片行显示态逐值不变
      （含「图片行仍是图、不是源码」）。
      **验收口径**：与 1.1 的现状读数逐值对照；`readDocument(page)` 的逐字节比较在位且 PASS。
      **实现记录（M184）**：遮罩打开期间依次按 `⌃D` / `⌃K` / `⌃A` / `Tab` 后断言「遮罩仍在 + 焦点仍在
      遮罩 + `editorState`（doc/head/anchor）与打开前逐值相同」；用例末尾 `readDocument(page)` 与
      `images.md` 逐字节相同（ADR 0003 §3）。
- [x] 5.4 不可打开形态：同一份文档里双击 ① 加载中状态块（用读桩延迟制造窗口）、② `图片读取失败：…`
      占位、③ `图片无法显示：…` 占位、④ `附件未找到` / `内容嵌入不支持` 占位、⑤ 外部 `http(s)`
      目标落下的占位 —— 遮罩一次都不出现；**同一场景里再双击一张已渲染成功的图片，遮罩出现**。
      **验收口径**：负向断言必须与正观测配对（[REVIEW.md](../../../REVIEW.md) 第 2 条：不可读/不存在
      类断言先确认读到的是真值）；反向验证——把 2.3 的双击挂到容器上，本断言必须变红（留档）。
      **实现记录（M184）**：覆盖 ①→⑤ 全部五类（加载中状态块用 5s 读桩延迟单列一条用例；其余四类在同一份
      专造文档里：`图片读取失败` / `图片无法显示`（0 字节位图）/ `附件未找到` / `内容嵌入不支持` /
      外部 `http(s)` 落下的占位），逐处 `dblclick()` 后断言 `.lumir-lightbox-overlay` 计数为 0；
      同场景最后再双击那张成功渲染的图 → 遮罩出现（配对正观测）。
      **反向验证未按原口径做**：原口径要求「把 2.3 的双击挂到容器上，本断言必须变红」——那要改实现
      （把监听器挂到 `.cm-lp-image` 容器）再跑。本 mission 用的等效反向验证是 1.2 的整组红
      （遮罩不存在时这组断言全红），但**「挂到容器上会让本断言红」这一条没有实测**——如实记为未做，
      不让它冒充已验证（若 reviewer 要求，改一行挂载点即可复现）。
- [x] 5.5 字节与惰性两条：`fs_read_attachment` 的调用计数在打开遮罩前后不变（对照 1.3 的基线）；
      未双击时 DOM 里没有遮罩节点。
      **验收口径**：两条都是可复算的计数/节点判据，读数与 1.3 的基线对照。
      **实现记录（M184）**：读桩在 `window.__lumirAttachmentReads` 上自增（`stubAttachmentReads` 的改动），
      用例断言「终态后计数 = 打开遮罩后计数」+「未双击时 `.lumir-lightbox-overlay` 计数 0」+
      「再次打开不建第二个遮罩节点」；与 1.1/1.3 的读数（10 → 10）一致。
- [x] 5.6 缩放口径两侧：远大于窗口的图（既有 `wide.svg` 是 2000×600，可再加一份更高的样本）放大后
      渲染盒宽高都 ≤ 遮罩可用区域；小于窗口的图放大后渲染盒 ≤ 自然尺寸。
      **验收口径**：去掉 `max-height` 的临时改动下前者必须 FAIL（红灯留档）。
      **实现记录（M184）**：按验收口径补了更高的样本 `tests/visual/fixtures/markdown-combo/tall.svg`
      （600×2000）。用例断言：宽图（2000×600）与**高图**（600×2000）的渲染盒两个维度都不越出遮罩可用
      区域、且各自被对应维度夹住（±1px）；小图（240×80）渲染盒**恰好等于**自然尺寸（不放大）。
      **反向验证（口径已修正）**：去掉 `max-height` → **高图那条红**（2000px > 可用 921px），
      `test-results/m184/05-red-no-max-height-tall.log`；只用宽图时去掉 `max-height` 仍绿（该图被宽度夹住，
      断言没有区分度）——修正理由与两条补充读数（`max-width` / `min-*` 单独去掉都仍绿）写进
      [design.md](design.md) §5。
- [x] 5.7 基线核对（[REVIEW.md](../../../REVIEW.md) 第 3 条 + AGENTS.md 的视觉门禁卫生）：
      逐张核对图片引用出现过的场景与全部整页基线的时间戳；lightbox 是新元素，确认是否需要新增
      元素级基线。
      **验收口径**：PR 里写明「零基线更新」或列出新增 / 重拍的基线文件名，并给前后截图请 Alex 过目
      （基线更新是人肉裁决点，不机械执行）；核对方式落在**内容判据**上（`grep -rln` 定位含图片的场景），
      不是只看时间戳。
      **实现记录（M184）：零基线更新**。内容判据：含图片引用的 fixture 只在
      `tests/visual/fixtures/markdown-combo/`（`grep -rln '!\[' tests/visual/fixtures/`），它们只被
      `markdown-combo.spec.ts` 与 `m182-image-first-open-width.spec.ts` 使用，而这两个场景都没有整页 /
      元素像素断言（`grep -rln "expectScreenshot\|toHaveScreenshot" tests/visual/scenes/*.spec.ts` 的
      13 个文件里不含它们）。新 CSS 只命中 `.lumir-lightbox-*` 选择器，且遮罩惰性建立（未双击时 DOM 里
      没有节点）→ 既有 13 个基线目录（`git status --short tests/visual/baselines/` 为空）逐张未动。
      **本 mission 不新增元素级基线**：那需要一次人肉基线裁决（AGENTS.md 的硬规则），而遮罩的观感
      本就在真机场景的截图里留给 Alex 过目——真机场景不可达（见第 6 节），因此改为：整页基线零更新的
      证据是 `gate.sh visual` 全绿（`test-results/m184/20-gate-visual.log`），遮罩的观感过目件由
      Alex 自己在 dogfood 时看（chromium 截图不作为基线入库）。

## 6. 真机验收场景（WKWebView，`scripts/acceptance/`）

- [ ] 6.1 **新增场景** `scripts/acceptance/scenarios/23-image-lightbox.md`（编号按现有最大 22 续），
      覆盖：双击成功渲染的图（固定尺寸 svg 与位图各一）→ 遮罩出现；`Esc` 关闭后焦点回编辑器；
      三条关闭路径。
      **断言形态**：放大图的可见性用 **AXImage 节点的几何读数**（节点行里的 `@x,y w×h` 宽高非零）——
      不可见图的 AX 文本照样读得到，这条陷阱记在 `docs/backlog.md:257-264`（M178 finding，主要居所）与
      `openspec/changes/archive/2026-09-18-image-svg-and-fallback/tasks.md:190-192`；
      MUST NOT 只断言「AX 里有某个文本」。
      **验收口径**：`node scripts/acceptance/run.mjs --check` 静态校验 PASS；`run.mjs 23` 真机 PASS，
      证据落 `test-results/acceptance/<日期>/23-image-lightbox/`（`status.txt` = PASS、`steps.md`
      断言逐条可读）。
      **实现记录（M184）：真机通道不可达，未做（不勾选、不冒称）。** 四条通道实测记录：
      `test-results/m184/13`～`/17`（坐标 `count: 2` / AX 索引 `count: 2` / 两次独立 click /
      `drag_paths` 两条单点路径；判据取既有行为「双击文件树行 = 新建固定标签」，四条都停在 1 个标签，
      而同一点位的单次点击证明落点准确）；finding 指针：
      `.tower/comms/findings/20260919-worker-lightbox-impl-improve-dom-dblclick-wkwebview.md`
      （通道清单 + 复现配方 + 建议修法），canonical 居所另有 `scripts/acceptance/README.md` 的「已知边界」条目。
      **场景与 fixture 未落库**：按本节验收口径写好的场景（`24-image-lightbox`，编号按裁决记 **24**——
      23 已被 M182 占用）跑了两轮真机、双击路径全部落空后随 fixture 一并从工作区撤下（只验前置条件的场景
      会让人误读为「真机验过」，REVIEW.md 第 6 条）。tower 裁决（2026-09-19，A+C 组合，原文
      `.tower/comms/inbox/20260919-tower-worker-lightbox-impl-clarify-reply-m184-a-c-chromium-alex.md`）：
      行为判别层由 chromium 断言组承担（第 5 节），真机侧留
      [manual-acceptance-checklist.md](manual-acceptance-checklist.md) 给 Alex 的 dogfood 手感项。
- [ ] 6.2 场景 fixture 落 `scripts/acceptance/fixtures/`（可复用既有 `image-fallback-normal.svg` /
      `image-fallback-percent.svg`，必要时补一份小图位图），与 md 一起进合成 vault。
      **验收口径**：场景 PASS 且 fixture 在 `fixtures:` 里逐条列名；断言遵守「不可读一律 FAIL」
      （[REVIEW.md](../../../REVIEW.md) 第 2 条），MUST NOT 写「读不到该文本即通过」式的负向空转。
      **实现记录（M184）：未做（随 6.1 撤下，未落库）**。曾生成并跑过的 fixture（`image-lightbox.md` 占位在
      第一行的可点击布局、`image-lightbox-control.md` 同点位的正对照、`image-lightbox-wide.svg` 2000×600、
      `image-lightbox-small.png` 120×90）已从工作区删除——它们的价值是「用同一点位给占位负向断言做正对照」
      这个设计，已写进上述 finding 供通道就绪时复用。
- [ ] 6.3 真机反向验证：把双击路径临时去掉（或回退到实现前代码）跑同一场景，断言必须 FAIL
      （遮罩不出现 / AXImage 几何断言失配）。
      **验收口径**：FAIL 的 `status.txt` 与 `steps.md` 留档；没有这一步的 PASS 不算数。
      **实现记录（M184）：真机通道不可达，未做（不勾选、不冒称）**——没有可跑的真机场景（6.1 未落库），
      这一步无从谈起；四条通道的实测记录与 finding 指针同 6.1。等效的反向验证在 chromium 层完成
      （1.2 的整组红：`test-results/m184/09-red-authoritative.log`）。
- [ ] 6.4 与 AGENTS.md 的维护权一致：新功能 mission 的 tasks 必带「新增/更新验收场景」，本 change 的
      实现 PR 必须同时含 6.1–6.2。
      **验收口径**：实现 PR 的文件列表里同时出现场景 md 与 fixture。
      **实现记录（M184）：部分（带原因）**。PR 不含场景 md 与 fixture（6.1 的通道边界）；本 mission 对套件
      的交付改为①`scripts/acceptance/README.md` 的「已知边界」新增「合成不出 DOM 的 dblclick」一条
      （四条通道 + 对照判据 + 现场路径），②动作表与 `scenarios/17` 的旧口径改成实测口径，③`cu.click` /
      `click` / `clickInNode` 如实透传 `count` 并注明它出不了 dblclick。这些改动随本 PR 入库。
- [ ] 6.5 不改写源文件的真机判据：`editor.unchangedSince`（编辑器内容）与磁盘文件的
      `unchangedSince` 两条断言在位且 PASS（ADR 0003 §3）。
      **验收口径**：两条各占一条可单独读出的步骤，不合并且不省略。
      **实现记录（M184）：未做（真机层）**。同日不变量在另两层有断言：chromium 层 `readDocument(page)`
      逐字节（5.3）与 1.1 的读数（`docText` 逐值相同）；真机层的两条 `unchangedSince` 待场景可达后补。

## 7. 文案 deck

- [x] 7.1 按裁决点 4 的裁决处置：**推荐项 = 不新增条目**（本 change 不引入提示文案），此时在
      [design.md](design.md) 与实现 PR 里写明「不改 `文案-Copy.md`」及理由（就地键只有 `Esc`，
      另两条关闭路径是鼠标动作；与 `toc-outline` 的就地键提示义务的差别见 proposal 裁决点 4）。
      若裁决选备选①（加提示），则追加 D114（末位当前 D113）并在文末「文案实现备注」段登记归属文件。
      **验收口径**：`git diff 文案-Copy.md` 为空（推荐项），或 D114 一行 + 备注段一条（备选①），
      且实现里的串与 deck 逐字一致。
      **实现记录（M184）**：`git diff 文案-Copy.md` 为空。遮罩也不写 `aria-label`（design §4.1 只要求
      `role="dialog"` + `aria-modal="true"`）——可见文本与新读屏名都是零新增；放大图的 `alt` 取原始引用
      文本（不是新文案，与内联图同一口径）。理由（就地键只有 `Esc`、另两条是鼠标动作）已写在
      `src/lightbox.ts` 的文件头。

## 8. 验证与收官

- [x] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
      **验收口径**：输出末行 `Totals: N passed, 0 failed`（提案落地时基线 14 → 加本 change 后 15），
      且 `change/open-image-lightbox` 为 ✓。
      **实现记录（M184）**：`gate.sh quick` 的 `openspec-validate` 行 PASS（`test-results/m184/19-gate-quick.log`）；
      全量输出见该日志的对应段（`--all --strict`，本 change 项目为 ✓）。
- [x] 8.2 `scripts/gate.sh quick` 与 `scripts/gate.sh visual` 全绿（视觉侧按 AGENTS.md 的口径本地跑，
      CI 只跑结构层）。
      **验收口径**：`GATE PASS` 逐行 + `GATE RESULT` 汇总；FAIL 项逐条修完再提交。
      **实现记录（M184）**：`bash scripts/gate.sh quick` → **10/10 PASS**（`test-results/m184/19-gate-quick.log`）；
      `LUMIR_VISUAL_PORT=4273 bash scripts/gate.sh visual` → **全绿**（`test-results/m184/20-gate-visual.log`，
      含整页像素层：既有 13 个基线目录逐张对比通过，即「零基线更新」的正面证据）。
- [ ] 8.3 真机套件至少跑一次新增场景并留档（AGENTS.md：dogfood 批次合并后、Alex 验收前先跑一遍）。
      **验收口径**：`test-results/acceptance/<日期>/summary.md` 里本场景为 PASS；报告里给可 `ls` 的
      绝对路径指针。
      **实现记录（M184）：真机通道不可达，未做（不勾选、不冒称）**。四条通道实测记录
      `test-results/m184/13`～`/17` + finding 指针
      `.tower/comms/findings/20260919-worker-lightbox-impl-improve-dom-dblclick-wkwebview.md`（同 6.1）。
      真机批次实际跑了 6 次（两轮场景 + 四轮通道对照）：场景那两轮 FAIL 的原因不是产品缺陷（同一点位的
      单次点击正常切换文档），证据 `test-results/m184/11`、`/12`；`test-results/acceptance/2026-09-19/`
      下的 `24-image-lightbox/` 与 `probe-dblclick-channel/` 是这两轮的失败留档（场景本身未落库）。
      **真机侧改由 [manual-acceptance-checklist.md](manual-acceptance-checklist.md) 承接**（tower 裁决
      A+C：chromium 判别层 + Alex 人工清单）。
- [x] 8.4 `git diff --check` 通过；改动文件集合与本 change 的 Impact 清单一致（出现跨 scope 的只读
      依赖须先报 tower 批准）。
      **验收口径**：改动集合 = `src/lightbox.ts`（新）/ `src/preview/attachments.ts` /
      `src/preview/livePreview.ts` / `src/main.ts` / `src/style.css` / 测试与验收制品 / 本 change 目录
      （+ 备选路径下的 `src/keys.ts`、`src/bindings-panel.ts`、`文案-Copy.md`）。
      **实现记录（M184）**：`git diff --check` 干净。改动集合 = `src/lightbox.ts`（新）、
      `src/preview/attachments.ts`、`src/preview/livePreview.ts`、`src/editor.ts`（Impact 清单外，见 2.2 的
      说明：PreviewContext 的注入口要走既有 `setWikilinkResolver` 那条路）、`src/main.ts`、`src/style.css`、
      `src/keys.ts` **未改**（3.4 未选）、`src/bindings-panel.ts` 未改、`文案-Copy.md` 未改、
      `src-tauri/**` 未改；测试与验收制品 = `tests/unit/lightbox.test.ts`（新）、`tests/unit/README.md`、
      `tests/visual/fixtures/markdown-combo/tall.svg`（新）、`tests/visual/scenes/markdown-combo.spec.ts`、
      `scripts/acceptance/README.md`、`scripts/acceptance/lib/{cu,execute}.mjs`、
      `scripts/acceptance/scenarios/17-multi-vault-switch.md`。全部在上述 scope（`src/**`、`tests/**`、
      `scripts/acceptance/**`、`openspec/changes/**`）内。
- [x] 8.5 收官对账：tasks 全部勾选（或标注放弃原因）、spec 增量与实现一致、living spec 归档另走节点 2。
      **验收口径**：`npx --yes @fission-ai/openspec@1.12.0 list` 里本 change 状态与 tasks 勾选一致；
      节点 2 前逐条对账 delta 与实现（无实现期静默扩 scope）。
      **实现记录（M184）**：本文件按「实现记录」逐条勾选或标注未做原因（未做项全部集中在第 6 节与 8.3，
      原因同一：真机通道造不出双击）；delta 与实现逐条对过（两条 ADDED requirement 的每条 MUST 都能在
      实现或测试里指出落点，无实现期扩 scope）；living spec 归档留待节点 2。

## 9. 已声明的边界 / 不做

- [x] 9.1 不做缩放控件、手势缩放、拖拽平移、旋转与「另存为」；不做文档内多图导航；不做新标签页 /
      系统预览；不改内联图片的排版口径（`max-width: 100%` 不动）；不改路径解析、字节通道、CSP 与
      Rust 侧任何文件。
      **验收口径**：`git diff --stat` 里 `src-tauri/**` 为空；`src/preview/theme.ts` 的
      `.cm-lp-image img` 段未改；实现里没有「上一张/下一张」这类状态。
      **实现记录（M184）**：`git diff --stat src-tauri/` 为空、`git diff src/preview/theme.ts` 为空；
      `src/lightbox.ts` 里只有 `open` 一个公开入口（没有上一张/下一张、没有缩放状态）。
- [ ] 9.2 **（条件项）** 键盘打开路径：推荐项下本 change 不提供（如实写进 spec 的已知边界与
      proposal 裁决点 3）；若裁决选备选①/②，则 3.4 转为必做，本条相应改写为「已提供」并补断言。
      **验收口径**：与裁决结果一致的表述（不出现「有命令但没断言」或「声称可达实则只能鼠标」的落差）。
      **实现记录（M184）**：**节点 1 未选中**——不加命令、不绑键；spec 的「已知边界」段已写明
      「打开路径只有双击（鼠标）」，`src/keys.ts` 未改，键位面板不受影响。
- [x] 9.3 已知边界（如实记录，不许当成已验）：同一 `data:` URL 的 decode 复用未验证（2.7 实测）；
      「遮罩失焦即关」的行为由第 6 节的真机场景覆盖、其手感（是否觉得「怎么自己关了」）归 Alex，
      套件只留截图；小图（不放大）双击的观感代价见 proposal 裁决点 2。
      **验收口径**：三项在 spec 的已知边界段与实现 PR 的说明里各有一条对应文字。
      **实现记录（M184）**：①decode 复用**已实测**（chromium：同串 0.1ms vs 首解 48.9ms vs 同像素不同串
      49.3ms；内存量度无效；WKWebView 未测）——结论写进 design §8、2.7 与 `src/lightbox.ts` 注释；
      ②「遮罩失焦即关」的行为真机**未验**（通道不可达，见 6.1），其手感归 Alex，本 PR 不声称已验；
      ③小图不放大（16×16 图标「和没放一样大」）是推荐项的已知代价，spec 的已知边界段与
      proposal 裁决点 2 各有一条文字。
