# Tasks: add-image-quote-to-chat

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现
> proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/harness/spec.md` / 本文件
- [x] 0.2 Alex 节点 1 评审通过（硬门禁；四个起草期取值 D1–D4 一并裁决）

## 1. 预览侧：图片上的引用钮

- [x] 1.1 `src/preview/attachments.ts`：`ImageWidget` 增加可选 `onQuote`（形态照 `onDoubleClick`：
      未注入即不渲染钮）；钮只挂在**终态 `<img>`** 上（占位 / 加载中 / 失败态没有 `<img>`，因此结构性
      不可引用）；点击前 `preventDefault` / `stopPropagation`（不触发双击放大与选区变化）
- [x] 1.2 `src/preview/livePreview.ts`：`PreviewContext` 增加 `quoteImage()` 口子，三处 `ImageWidget`
      构造点（标准 md 图片 / `![[...]]` 有解析器 / 无解析器降级）全部接入同一口子
- [x] 1.3 `src/style.css`：位置 class（图片右下角内侧 `right: 6px; bottom: 6px`），形态复用
      `.lumir-block-trigger` 家族共享类；MUST NOT 新写一套壳 / 热态 / eink 规则；文案取既有 `D370`
- [x] 1.4 `src/main.ts`：装配口子——注入「按路径引用图片」的处理器（走 §3 的事务）
- [x] 1.5 渲染层判据（落在视觉场景：这一层需要真 DOM，见 tasks 5.2 / 5.4）：终态图片产出引用钮；
      加载中 / 失败占位不产钮（反向用例）；点击回调拿到的是解析后的 vault 路径与引用原文
      （单测层另钉 widget 相等性的接线有无参与——注入前后必须重建 DOM）

## 2. 选区侧：图片枚举

- [x] 2.1 新增纯函数 `collectImageRefs(state, from, to, ctx)`（落既有解析层，`livePreview.ts` 或
      `attachments.ts`）：标准 md 图片走语法树 `Image` 节点、`![[...]]` 走 `findWikilinkSpans` 的 embed
      分支；解析走既有 `resolveImagePath` / `resolveByNameUnique`；MUST NOT 新写第三份图片语法
- [x] 2.2 排除与去重：代码块内的同形文本不命中（语法树天然覆盖）、`![[note]]` 非图片跳过、解析不到跳过、
      同一路径去重、按 `from` 升序（文档序）
- [x] 2.3 `src/quote-gesture.ts`：手势 deps 增加 `collectImages(from, to)`；点击时把图片集合与卡片一起
      交给面板（无图时走既有单卡片路径，逐字节不变）
- [x] 2.4 单测：两种语法各命中 / 代码块不命中 / 非图片嵌入跳过 / 解析失败跳过 / 同路径去重 / 多图文档序 /
      选区跨多张图

## 3. 引用事务（读 vault → 写 harness 存储 → 插块）

- [x] 3.1 读：`fsReadAttachment(path)` → base64；`sourceMime = mimeTypeOf(extensionOf(path))`
      （既有注册表，不新写 MIME 表）
- [x] 3.2 写：`harnessWriteImage(base64, sourceMime)`（png→WebP 无损 / jpeg / webp 原样 / 其余拒绝 /
      50MB 上限），得到 `{name, width, height}`；**先落盘再插块**（不留「卡片在场、缩略图读不回」的破图态）
- [x] 3.3 失败处置：不支持的格式、超限、读写失败 → 既有错误文案 toast；多图部分失败时其余照常插入，
      toast 说明失败张数与原因（MUST NOT 整体回滚）
- [x] 3.4 单测（mock IPC）：写盘顺序、内容寻址去重（同一图引用两次只有一份文件）、部分失败语义、
      零 vault 写入（断言没有 `fs_write_*` / `document_write` 类调用）

## 4. composer 插入协议

- [x] 4.1 `src/harness-panel.ts`：新入口 `insertQuoteWithImages(card | null, images)`——未打开先开面板、
      插入点取 `caretFromDom()`、**一次** `withModel(…, STRUCTURAL_EDIT_FORCE)` 完成「卡片 + 若干图片块」、
      光标落尾部新段落；与既有 `insertQuoteCard` 共用插入原语（MUST NOT 复制一份）
- [x] 4.2 人侧来源标注：图片卡片缩略图的 `title` 写 vault 相对路径（deck 无「来自 …」模板，取裸路径
      模板 D91；见 design §10 的实现期取值）；该文本不进序列化、不进投递、不进草稿存储
- [x] 4.3 图片块与粘贴图片同协议：编号（`imageOrdinals`）、`@` 引用、删除、投递标签（`serializeDelivery`）、
      transcript 沉淀、草稿 round-trip——逐条核对无新增字段
- [x] 4.4 模型层单测：块序 = [卡, 图1, 图2]（同一组插入原语的链式编排）；无文本选区只插图；
      纯文本引用走既有单卡片路径（AXPress 回归锚点）。一次撤销 = 一次 withModel（视觉场景判「⌘Z 一次全撤」）；
      草稿 round-trip 由既有 composer-draft / quote-card 单测覆盖（图片块字段未变）

## 5. 视觉门禁（chromium + `tauri-stub`）

- [x] 5.1 `tests/visual/scenes/tauri-stub.ts`：补 `harness_write_image` / `harness_read_image` 路由
      （`fs_read_attachment` 自 M629 起已在；写失败的按 MIME 注入走 `harnessImageFailures`），
      场景侧另给 96×48 合成 PNG（1×1 太小，引用钮会盖住整张图）
- [x] 5.2 新增场景：悬停已渲染图片 → 引用钮出现（`ax` 可见）；点击 → composer 出现图片卡片、编号
      `Image 1`、缩略图在场；一次 ⌘Z 后卡片消失
- [x] 5.3 同场景：选区跨文字与图片 → composer 依次出现引用卡与图片块；一次 ⌘Z 全撤
- [x] 5.4 同场景反向验证：加载中 / 失败占位图片 hover **不**出现钮；`svg` 引用给 toast 且不插卡片
- [x] 5.5 既有整页基线：**零更新**（`git status` 对 `tests/visual/baselines` 零改动；gate visual 全量像素层跑过两轮，均 13/13 PASS）

## 6. 真机验收场景

- [x] 6.1 新增 `scripts/acceptance/scenarios/<编号>-image-quote-to-chat.md` + 合成 fixture（含一张
      合成 PNG 与一段含图中引用的文字）
- [x] 6.2 断言：悬停引用 → 发送 → mock provider 收到含 image part 的请求（parts 里 `Image 1` 标签在场、
      无 vault 路径文本）；跨图选区引用 → 发送 → transcript 同构沉淀；⌘Z 一次撤掉整次引用
- [x] 6.3 回扫既有验收场景：grep 所有对「摘录手势 / composer 图片卡片 / 投递 parts」有期望的场景，逐条
      确认不受影响或改准；`node scripts/acceptance/run.mjs --check` 通过
- [x] 6.4 如实登记覆盖边界（钮的浮现手感、图片卡片观感归 Alex，不进机器判据）

## 7. 验证

- [x] 7.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（`Totals: 33 passed, 0 failed (33 items)`）
- [x] 7.2 `bash scripts/gate.sh quick` 全绿：`GATE RESULT: 11/11 PASS（SKIP 0）`（退出码 0；final 树的 `gate.sh visual` 里 quick 段同样 11/11 PASS）。
      rebase 到 bf5ac46f 后复跑：同样 `GATE RESULT: 11/11 PASS（SKIP 0）`（退出码 0，2026-10-23 20:54）
- [x] 7.3 `bash scripts/gate.sh visual` 全绿：`GATE RESULT: 13/13 PASS（SKIP 0）`（退出码 0；visual-regression 489s，含整页 / 元素像素对比）。
      rebase 到 bf5ac46f 后复跑视觉面（与 gate 的 visual-regression 同一条命令 `scripts/visual/run.sh`，端口 4291）：
      **722 passed / 1 skipped（8.5m，退出码 0）**；isolation-runs 2 pass。零基线更新（`tests/visual/baselines` 对本分支零改动）
- [x] 7.4 信息卫生清扫：改动面（新增 / 修改的全部文件）对真实 vault 内容、真实路径、真实人名做 text 级
      grep——零命中；图片 fixture 全为合成像素（1×1 / 96×48 纯色 PNG、纯几何 SVG）
