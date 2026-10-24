# Tasks: quote-pipeline-consistency-oct24

> 来源：Alex 2026-10-24 现场反馈 #2 / #3，tower 立项 M662（调查结论见
> `.local/reports/quote-image-pipeline-oct24.md`，git 外）。提案与实现同一批次提交（小型变更）。
> 勾选状态与证据口径：每条完成的判定以本轮实际跑过的命令输出为准（不用「写完即算」）。

## 1. 引用失败留痕与引用语境文案（D585 / D586）

- [x] 1.1 `quoteImagesFromVault` 的结果改为判别联合 `{ ok: true, image } | { ok: false, failure }`（保持数组形态——装配层 `src/main.ts` 的判空与直传契约零改动）
- [x] 1.2 失败人话按调用点分码：`quoteImageErrorText` 把 `attachment_type_unsupported` 在引用路径渲染为 D585（粘贴路径的 D436 不动）
- [x] 1.3 格式预检：`isQuotableImageName`（单一真源见 §3）在 IPC 之前拦下不可引用格式；后端写原语仍是最后一道闸
- [x] 1.4 留痕落点：有文本卡片 → 卡片出处行（`WeakMap<QuoteCard, number>` + D586 读数）；无卡片 → 输入区状态行（`role="status"`，复用出处行小字样式，不新增 CSS）
- [x] 1.5 收口：状态行在下一次引用 / 发送 / 切会话时收起；卡片读数随卡片一起撤销
- [x] 1.6 文案取号：D585 / D586 进 `文案-Copy.md` + `src/copy-data.ts`（含 enOne 复数档），末位更新为 D587
- [x] 1.7 单测 `tests/unit/quote-image.test.ts`：svg 用例（零 IPC、D585、失败读数）、混合批次顺序、后端拒绝兜底、部分失败读数与 toast 同源

## 2. 引用卡片的含图派生读数（D587）

- [x] 2.1 `countExcerptImageRefs(text, filePath?)`（`src/preview/attachments.ts`）：GFM 语法树 Image 节点 + `findWikilinkSpans` embed；表格 / 代码上下文 / 远程 / 非图片扩展不计；同一目标只计一次
- [x] 2.2 卡片出处行渲染「含 N 张图片」（N=0 不显示；读数不进卡片数据 / 序列化 / 投递 / 草稿；不新增行，几何零改动）
- [x] 2.3 单测 `tests/unit/excerpt-image-refs.test.ts`：13 例，含五类「必须判 0」的反向输入
- [x] 2.4 顺带修复 `resolveImagePath` 的栈溢出（ref 自身以 `..` 开头时递归自己）：逃逸改为钳到根，语义与「回退为 vault 根相对」一致

## 3. 格式面单一真源

- [x] 3.1 Rust `fs_io::ATTACHMENT_TARGETS` 成为唯一判定面；`attachment_target` 查表
- [x] 3.2 读回侧从同一张表派生：`harness::attachments` 的 `is_attachment_name` / `mime_of_name`（`mime_of_name` 改为 `Option`，表外扩展名不猜 MIME）
- [x] 3.3 前端镜像 + 派生：`QUOTABLE_TARGETS` → `QUOTABLE_IMAGE_EXTENSIONS` / `ATTACHMENT_STORED_EXTENSIONS` / `quotableImageMimes` / `attachmentMimeOfName`（缩略图 MIME 不再本地二分）
- [x] 3.4 漂移断言 `tests/unit/attachment-format-drift.test.ts`：源 MIME 集合、落盘扩展名集合、读回 MIME 映射逐项对账 + 少一项 / 多一项 / 改一项的反向输入
- [x] 3.5 Rust 单测：`attachment_targets_table_is_the_single_authority`（fs_io）、`read_side_derives_from_write_targets`（attachments）

## 4. 会话名回落口径不泄漏 XML

- [x] 4.1 后端 `first_user_text` 改为「首个非空问题段落」：按 parts 遍历（图片 part 是块边界）、剥 `<quote>` / `<msg-quote>` / `<image …/>`、折叠空白、还原 XML 实体；元素不完整时按原文保留（不丢段）
- [x] 4.2 前端 `firstUserTextOf` 提为模块级导出（口径注释写明与后端同源）
- [x] 4.3 跨层 fixture `tests/unit/fixtures/session-name-fallback.json`（10 例，含旧留存单串 content / 注入上下文节 / 纯图片 / 多行段落 / XML 实体）：前端测试断言 `projectDelivery` 的 parts 与期望值，Rust 单测读同一份文件断言 `first_user_text` 与逐消息口径
- [x] 4.4 Rust 单测：`first_user_text_matches_shared_fixture`、`first_paragraph_text_keeps_malformed_card_text`、`first_paragraph_text_none_without_user_text`
- [x] 4.5 标题事件链路核验：视觉场景 `m662-session-title.spec.ts`（标题栏即时更新 + 已打开浮层当前行原地改名 + 标题已存在时不回落）

## 5. 验证

- [x] 5.1 `node tests/unit/run.mjs`：**1279 pass / 0 fail**（含本批新增的 4 个用例文件）
- [x] 5.2 `pnpm exec tsc --noEmit` 与 `pnpm exec tsc -p tests/unit/tsconfig.json` 均通过
- [x] 5.3 `node scripts/acceptance/run.mjs --check`：227 个场景静态校验通过（场景 222 新增第 ④ 段）
- [x] 5.3b 视觉：`scripts/visual/run.sh`（本地全量，含铬 + webkit 真机近似层）**782 passed / 1 skipped**，退出码 0——像素基线零改动（无 `--update`）
- [x] 5.4 `cargo test` / `cargo fmt --check` / `cargo clippy -- -D warnings` 全绿（gate 日志：913 passed / 0 failed / 5 ignored，12 个测试二进制；共享 `CARGO_TARGET_DIR` 下 `lumir_lib-8098b41bb9e007e7` mtime 08:18:10 晚于本轮 touch 08:14，重编译已核对）
- [x] 5.5 `scripts/gate.sh quick`：`GATE RESULT: 11/11 PASS（SKIP 0）`，退出码 0
- [x] 5.6 openspec：`validate --all --strict`（45 items passed）与 `scripts/docs-check.sh`（含归档对账：28 份 delta / 26 条 MODIFIED / 348 段无静默丢段）通过

## 6. 明确不做

- [x] 6.1 SVG 栅格化 / SVG 源码按文本投递（survey 方案 C / E）：新能力，待 Alex 裁决；本 change 只保「失败可见、文案正确、格式判定一处」
- [x] 6.2 扩格式白名单（gif 等）：无裁决不扩；表结构让扩格式只改一处
- [x] 6.3 命名链路本身（prompt / 模型档 / 真机 163/167）：tower 真机证据表明命名成功，本 change 不碰 title 任务

## 7. r1 评审处置（2026-10-24，verdict `p2-2items` / fix-then-merge）

- [x] 7.1 **P2-1 状态行收口漏两条引用路径**：`insertQuoteCard`（文本摘录）与 `insertMessageQuoteCard`（消息摘录）各补 `applyQuoteFailureNotice(null)`——spec 写的是「存活到下一次引用」，这两条也是引用。视觉 `m633` 新增用例钉住：失败 → 状态行在场 → 文本摘录收口 → 再失败 → 消息摘录收口（判据有区分度，不是恒隐藏）。
- [x] 7.2 **P2-2 `src/main.ts` 旧契约注释**：`insertQuotedImages` 的注释按新契约改准（失败项随结果数组返回 / 按调用点分码 D585 / 留痕是持久态 D586），**代码零改动**（scope 由 tower 限定到这三行注释）。
- [x] 7.3 **rebase 解冲突**：本分支 rebase 到 master `4938aeb9`（含 M660/M661）。`文案-Copy.md` 三处冲突按「谁也别覆盖谁」解：①「编号规则」段取 M660 的措辞（「标签的只读图标与读屏名」）并接上本批 D585–D587 与末位 D587；②「分配记录」保留 M660 的 D578 退场记录 + 本批 M662 行；③「D 区间 → 归属文件」取 M660 的 D577 / D579（无 D578）并接上本批 D585 / D586–D587。`src/copy-data.ts` 自动合并干净（D578 退场 + D585–D587 并存）。
- [x] 7.4 rebase 后复跑：`node tests/unit/run.mjs`（1280/0，含 deck↔表漂移门禁）、tsc root/unit/visual、`scripts/docs-check.sh`（32 份 delta / 27 条 MODIFIED / 355 段）、`openspec validate --all --strict`（46 items）、`acceptance --check`（227 场景）。Rust 源码本轮未动（rebase 干净合并、无冲突），按 tower 指示不占 cargo 锁。
