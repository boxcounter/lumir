# Design: 引用路径解码失败的文案分码

- Change ID: `fix-quote-decode-error-copy-oct24`
- 日期: 2026-10-24

行为口径的 canonical 居所是 `specs/harness/spec.md` 的增量；本文只记「为什么是这种做法」与
各条判据的区分度设计。

## D1 取号与条目形态：D588，一条独立 deck 行

- 当前末位是 D587（`文案-Copy.md` 的「编号规则」段自述，表内最大编号齐平）。取了 D588。
- 取号前做了三处检索：仓内工作区（`src/` / `openspec/` / `tests/` / `scripts/` / deck 与 docs）、
  `.local/`（git 外的报告与评审材料）、`git log --all -S"D588"`——均无命中，D589 起同样未被占用。
- 形态按 deck 的单串行：一格一条串，不需要 `.1` 后缀，也不进 `tests/unit/copy.test.ts` 的
  `MULTI_STRING_ROWS` 显式声明表（那张表只收一格多串的行）。
- 占位符只有 `{reason}`（与 D438 同形）。后端四类解码失败构造点全部带 `.param("reason", …)`
  （`src-tauri/src/fs_io.rs:2142` / `:2384`、`src-tauri/src/harness/attachments.rs:167`、
  `src-tauri/src/svg_raster.rs:117` / `:126` / `:134`），所以正常运行期不会缺参；缺参兜底见 D4。

## D2 为什么是「前端按调用点映射」，不是「改 D438」或「新后端 code」

三个候选，逐个说为什么落选：

| 候选 | 评价 |
|---|---|
| **改 D438 为中性措辞**（如「无法解码图片」），两侧共用 | 让粘贴侧丢掉「来源是剪贴板」这层信息——粘贴语境的用户手势就是 ⌘V，提示要能对上动作。且 D438 有既有判据与既有消费者，改动面扩到一条没有缺陷的路径。 |
| **后端为引用语境新增一个 code**（如 `quote_image_decode_failed`） | 后端无法可靠分辨调用点：`harness_write_image` **同时**服务 composer 粘贴（`src/harness-panel.ts:4930` 的 `pasteClipboardImage`）与引用（`src/quote-image.ts:131` 的 `quoteImagesFromVault`）——同一个命令、同一个写原语、同一个失败码。要分码就得把调用点参数穿过 `fs_io` 的共用转换入口，或在命令边界改写 code；前者把「格式 / 字节」的单维判定面扩成二维，后者让同一个失败在两层有两个身份。两者都违反 `ui-language` 的「code 是语义分类，不是消息 id」。 |
| **前端按调用点映射（选定）** | 调用点在前端是两个明确的函数（`quoteImageErrorText` 与 `errorText`），语境信息本来就在这一层；D585 已用同一手法处理过格式不支持，新增一个分支是同处、同形的最小改动。 |

**代价**：同一条失败在两个语境下有两处渲染入口。防线是判据而不是结构——单测同时钉住两侧
（见 D5），任何一侧被误改都会红。

## D3 措辞边界：D588 / D585 / D438 三分

| 失败 | 调用点 | 中文 | English | 条目 |
|---|---|---|---|---|
| 格式不支持 | 粘贴 | 不支持的剪贴板图片格式：{type} | Unsupported clipboard image format: {type} | D436（不动） |
| 格式不支持 | 引用 | 暂不支持引用该格式：{type} | Can't quote this image format yet: {type} | D585（不动） |
| 解码失败 | 粘贴 | 无法解码剪贴板图片：{reason} | Couldn't decode the clipboard image: {reason} | D438（不动） |
| 解码失败 | 引用 | **无法解码这张图片：{reason}** | **Couldn't decode this image: {reason}** | **D588（新）** |
| 编码失败 | 粘贴 | 无法编码剪贴板图片：{reason} | Couldn't encode the clipboard image: {reason} | D439（不动，见 D7） |

**为什么是「无法解码这张图片」**：

- 与 D438 的最小差异是语境限定词（「剪贴板图片」→「这张图片」），保留「无法解码」这个关键字——
  同一失败在两个语境下仍是同族措辞，用户不会以为遇到了另一种错误。
- 「这张」指向本次失败的那一张（toast 逐张触发）；文件名不必进 toast——它已经在卡片 / 引用原文
  里，3.5 秒的提示多塞一个路径只会挤掉原因。
- 备选「无法解码引用的图片」被否：它把理解成本压在「引用」这个动作上，而这句要回答的是「为什么
  没进来」；且它与 D585 的「引用该格式」读起来像同一条失败，正是本 change 要避免的混淆。

**其余失败码的措辞与语境无关，保持原映射，一条都不改**：`attachment_too_large`（图片过大：{mb}MB…）、
`attachment_write_failed`（保存图片失败）、`attachment_write_unknown`（保存图片结果未知）与读侧的
`fs_*` 失败都不含「剪贴板」这类语境词；引用它们时读者不需要知道调用点，换措辞只会平添评审面。

**区分判据（机器可判，不是人读）**：

- D588 的 zh 含「解码」、不含「剪贴板」；en 含 "decode"、不含 "clipboard"（大小写不敏感）。
- D588 与 D585 的渲染结果互不为子串；D588 不含「不支持」，D585 不含「解码」。
- 粘贴侧锁：`errorText({code:"attachment_decode_failed"})` 的 zh 必须仍含「剪贴板」。

## D4 缺参与未知 code 的兜底：复用 `errorText` 的既有口径

`errorText` 对「表里有键但缺参」的处理是：接住 `t()` 抛的错 → 回落 `e.message` → 留一条 console
诊断线索（`src/copy.ts:159-169`）。新分支 MUST 走同一条兜底，MUST NOT 在 `quoteImageErrorText`
里裸调 `t()` 另写一份 try/catch（那会成为第二份兜底口径）。

实现形态留给实现批次，但两条不变量先定：

1. 「code → 键」的解析与「缺参兜底」只有一处实现（可让 `errorText` 接受可选的覆盖表，或抽一个
   内部函数给两个调用点共用）；
2. 覆盖表只登记 `attachment_decode_failed` 一项——不在本 change 顺手把别的 code 也改道（那是
   「静默扩面」，评审看不见）。

## D5 判据的区分度设计（每条断言都配一条必须让它红的输入）

单测层最容易写成「看着有覆盖、实际不判东西」（REVIEW.md「假绿」族）。本 change 的每条断言
都绑定一个反向输入：

| 断言 | 反向输入（必须让它红） |
|---|---|
| 引用路径的解码失败读 D588 | 把测试信封的 code 换成 `attachment_type_unsupported` → 必须读 D585；换成 `attachment_too_large` → 必须读 D437 |
| 引用路径的文案不含「剪贴板」 | 若映射没生效，渲染结果就是 D438 的串（含「剪贴板」），断言立刻红 |
| 粘贴路径仍是 D438 | 若有人把 `ERROR_COPY` 的映射改到 D588，zh 断言的「剪贴板」立刻红 |
| 缺参不抛 | 给一个不带 `params.reason` 的信封：断言不抛且上屏等于 message |

层次分工：

- **单测**只测 `quoteImageErrorText` / `errorText` 的返回值，测不到 DOM 上屏；
- **视觉场景 m633** 用桩的 `harnessImageFailures`（按 `source_mime` 注入信封，桩已存在）造一次
  引用解码失败，断言真实 toast 文本、持久状态行在场、composer 无卡片；同场景既有的 gif 用例
  继续断言 D585，两条用例互为反向区分；
- **真机验收**用合成坏图（不是合法 PNG 字节的 `.png`）+ 选中源码的方式触发（坏图渲染成占位、
  没有 `<img>`，悬停引用钮拿不到；选区路径照常枚举引用）。判据是 AX 文本 + 状态行 + 无卡片。

**覆盖边界（如实登记）**：粘贴侧的解码失败在真机造不出来——剪贴板通道用 AppleScript 的
`«class PNGf»` 置图，只能产出合法 PNG。因此粘贴侧由单测锁定映射 + 既有场景 112 / 127 回归，
**不声称两侧都做了真机验证**（REVIEW.md「覆盖声明超出真实验证」条）。

## D6 归档顺序与依赖

本 change 的 requirement 依附 `quote-pipeline-consistency-oct24` 的「引用失败的留痕与引用语境反馈」
（它已立「按调用点分码」原则，只覆盖格式不支持），而那条还在活跃列表里；`openspec archive` 不允许
MODIFIED 一条只存在于另一个活跃 change 的 requirement，所以本 delta 是 ADDED 而非 MODIFIED。

顺序 MUST 是：`add-image-quote-to-chat` → `quote-pipeline-consistency-oct24` →
`svg-image-quote-oct24` → 本 change。前两者的次序由 svg change 的 design §D8 定义；本 change 排在
最后，是因为它修的是 svg change 自己登记的缺口（design §D6 / tasks 6.2）——先让 svg 的成功路径与
失败回落落地，再改失败回落的措辞，评审时两段 diff 各自可读。

若顺序被打乱（本 change 先归档），语义不冲突（两条 requirement 各管一个失败面），但评审时
「为什么解码失败的措辞要单独一条」会失去前文的缺口登记作为上下文。

## D7 相邻缺口：编码失败（D439）为什么不在本 change

`attachment_encode_failed` 在引用语境同样会读「无法编码剪贴板图片」——形态与 D438 完全一致。
不并在本 change 的理由是**证据与代价**，不是「它不重要」：

- **可达性**：编码失败只发生在 WebP 无损编码器失败时（逐像素无损，正常输入下不失败；现实成因
  基本只剩内存耗尽）。解码失败则可由一张损坏的 vault 文件稳定触发。
- **代价**：并进来要取第二个新号（D589）、加一条映射、加一组判据，评审面翻倍；而它没有现场。
- **处置**：本 proposal 把它登记在 Non-goals 里，并把「要一并覆盖请在节点 1 指出」写明。批准后
  再按 D589 取号扩入——MUST NOT 在实现期发现「顺手也改一下」就静默加上（工作流文档的
  「发现 proposal 意图需要变更时停下」）。

本 proposal 不预写 D589 的串：未裁决先占号会让下一个取号的人无处可去。
