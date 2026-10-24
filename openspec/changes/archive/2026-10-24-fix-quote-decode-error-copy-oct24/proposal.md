# Proposal: 引用路径的解码失败不再借用「剪贴板」措辞

- Change ID: `fix-quote-decode-error-copy-oct24`
- 日期: 2026-10-24
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**通过**（2026-10-24）。Alex 原话：「好，我理解了，我没有异议，请你安排处理。」
> 来源是交接遗留：change `svg-image-quote-oct24` 在 design §D6 与 tasks 6.2 登记了一条已知缺口
> ——引用语境下 `attachment_decode_failed` 仍读粘贴语境的 D438（「无法解码剪贴板图片」），按调用点
> 分码需要新 D 编号，而那个 mission 的改动面不含 `src/copy-data.ts` / `文案-Copy.md`，故另立本
> change。节点 1 通过后按本 proposal / design / tasks 实现。
> 实现期补记（2026-10-24）：**Impact 原清单漏列 `src/copy.ts`**——design §D4 的两条单点兜底形态
> （`errorText` 的可选覆盖表 / 抽内部函数共用）都落在 `errorText` 所属文件，实现采用前者，已补进
> 下面的 Impact 清单（tower 已同步扩 scope）。
> 节点 2（归档评审）：**通过**（2026-10-24，Alex 原话：「批准。」）。评审包
> `.local/reviews/archive-node2-wave1/README.md`（七项批次逐项批准；本 change 为包内第 1 项，无特殊
> 后续动作）。本 change 由 M713 归档。

## Why

引用一张图（把 vault 里的图片搬进 harness 存储）与粘贴一张图**共用同一个写原语、同一个失败码**，
但「剪贴板」这三个字只在粘贴语境成立。这条缺口今天可达，不是纯理论：

- `attachment_decode_failed` 在 `ERROR_COPY` 里映射到 D438（`src/copy-data.ts:1949`），D438 的
  正文是「无法解码剪贴板图片：{reason}」（`文案-Copy.md:433`）。
- 引用路径的失败人话由 `quoteImageErrorText` 渲染：它只给 `attachment_type_unsupported` 换过
  引用语境的 D585，其余 code **直通粘贴语境那张表**（`src/quote-image.ts:99-106`）。
- M666 起 svg 走栅格化成功路径，畸形 SVG（XML 不完整 / 画布尺寸非法）与损坏的位图都会在写入口
  命中 `attachment_decode_failed`（`src-tauri/src/svg_raster.rs:117`、`:126`、`:134`；
  `src-tauri/src/fs_io.rs:2384`）。也就是说：**用选区引用一张坏的 vault 图片（例如
  `![[broken.png]]`；坏图渲染成占位、悬停引用钮拿不到，但选区照常枚举它），看到的仍是
  「无法解码剪贴板图片」——而用户刚才根本没有碰过剪贴板。**

**为什么不能直接改 D438**：真实粘贴动作的语境就是剪贴板，那个限定词在粘贴侧准确且有用（用户刚
复制过东西，提示要能对上他刚才的动作）。改成中性措辞等于让一条没有缺陷的路径失去这层信息，且
改动面从「引用路径的一处映射」扩到「粘贴路径的既有文案与它的既有判据」。两个调用点、两条串、
同一个错误码——这正是 D585 已经立下的模式（错误码是语义分类，不是消息 id，见 living spec
`ui-language` 的「Rust 侧错误的文案归属」）。

## What Changes

1. **新增一条文案条目 D588**（取号已核：全仓、`.local`、git 历史均无占用；当前末位 D587）。
   推荐措辞：中文「无法解码这张图片：{reason}」/ English "Couldn't decode this image: {reason}"。
   位置是「引用图片失败 toast（解码失败）」，设计意图列写明只服务引用语境。最终措辞以节点 1 裁决为准。
2. **引用路径按调用点分码**：`quoteImageErrorText` 对 `attachment_decode_failed` 渲染 D588，其余
   code 维持原映射；信封缺 `{reason}` 时按 `errorText` 的既有口径兜底（回落后端 message，不抛错、
   不留未替换占位符）。
3. **粘贴路径一字不动**：`ERROR_COPY` 仍把 `attachment_decode_failed` 映射到 D438，
   D436 / D437 / D438 / D439 的正文与 English 列全部不改。D438 的设计意图列只补一句指针
   （「粘贴语境专用；引用语境读 D588」），不改串本身。
4. **两条失败面不混**：D588 说的是「格式支持，但这份字节解不开」，D585（「暂不支持引用该格式」）
   说的是「这种格式还不支持」。两条文案互不为子串；引用一张坏图走前者，引用一张 gif 走后者。
5. **判据**：单测锁两侧（引用读 D588 / 粘贴读 D438）+ 区分度反向输入（把 code 换成格式不支持或
   超限，文案必须跟着变）+ 视觉用例（真实 DOM 上屏）+ 真机验收新场景（选中坏图源码 → toast +
   持久留痕）。

## Non-goals

- **不改后端错误码、不动 Rust**：写原语由粘贴与引用共用，而 `harness_write_image` 这一条**同时**
  服务 composer 粘贴（`src/harness-panel.ts:4930`）与引用（`src/quote-image.ts:131`）——后端按命令
  分不出「谁在调用」。要后端分码就得把调用点参数穿过共用原语，或在 harness 命令边界改写 code，
  两者都在「格式 / 字节」这个单维判定面上再叠一维，制造第二个真源。
- **不动粘贴路径的任何串**（D436 / D437 / D438 / D439）：粘贴语境没有缺陷，改它只扩大评审面。
- **不扩到编码失败（D439 的同形缺口）**：「无法编码剪贴板图片」在引用语境同样不成立，但可达性
  极低（WebP 无损编码器失败基本只剩内存耗尽），没有现场，且它需要第二个新 D 号与第二组判据。
  本 change 按「有现场才修」处置；要一并覆盖请在节点 1 指出，届时按 D589 另取号扩入。
- **不动 D585 / D586 的文案与行为**：格式不支持的引用语境措辞、未引用留痕的读数形态都不变。
- **不提前改 living spec**（节点 1 前），不改 `quote-pipeline-consistency-oct24` 与
  `svg-image-quote-oct24` 的 delta 正文。
- **不做 UI 形态变化**：toast 的位置 / 时长 / 样式与状态行样式都不碰，只换字。

## Impact

- 影响的 specs：`harness`（一条 ADDED requirement「引用路径解码失败的文案」）。它依附活跃 change
  `quote-pipeline-consistency-oct24` 已立的「失败人话按调用点分码」原则，但那条尚未归档，故本
  change 不能 MODIFIED 它。
- 影响的代码 / 制品：`文案-Copy.md`（新增 D588 行 + 编号沿革的末位 / 分配记录 / D 区间归属）、
  `src/copy-data.ts`（`COPY_TABLE` 加 D588）、`src/copy.ts`（`errorText` 的可选覆盖表——design
  §D4 的单点兜底形态，实现期补记）、`src/quote-image.ts`（`quoteImageErrorText` 一处覆盖表 +
  文件头注释）、`src/main.ts`（`insertQuotedImages` 上方的按调用点分码注释同步）、
  `tests/unit/quote-image.test.ts`、`tests/unit/error-text.test.ts`、
  `tests/visual/scenes/m633-image-quote.spec.ts`（新增解码失败用例）、
  `scripts/acceptance/scenarios/232-quote-decode-error-copy.md`（新场景）+ 两个合成 fixture。
- 关联约束：`ui-language` 的「Rust 侧错误的文案归属」（前端按 code 渲染、不为每条 message 模板
  新增 code）；ADR 0004（判据必须机器可执行）；REVIEW.md「同一语义两处真源」条（D588 的消费者只有
  引用路径，`ERROR_COPY` 仍是粘贴路径的唯一映射，两者各管一个调用点）；仓库信息卫生
  （fixture 全部合成）。
- **归档顺序**：`add-image-quote-to-chat` → `quote-pipeline-consistency-oct24` →
  `svg-image-quote-oct24` → 本 change（前两者的顺序由 svg change 的 design §D8 定义）。
