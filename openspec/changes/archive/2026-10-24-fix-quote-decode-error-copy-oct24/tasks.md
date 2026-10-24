# Tasks: fix-quote-decode-error-copy-oct24

> 本文件是**提案期制品**：所有任务在节点 1（提案评审）通过后才由实现批次勾选。
> **节点 1 前 MUST NOT 动产品代码**（`src/**`、`文案-Copy.md`），MUST NOT 提前改 living spec。
> 勾选口径：以本轮实际跑过的命令输出为准（写完不算完成；REVIEW.md「覆盖声明超出真实验证」条）。
> 节点 1 于 2026-10-24 通过（Alex 原话见 proposal 的评审记录）。

## 1. 取号与文案条目

- [x] 1.1 取号前复核 D588 仍未被占用（`git grep -n "D588"` + 查 `.local/` + `git log --all -S"D588"`），并核 deck 的当前末位仍是 D587
- [x] 1.2 `文案-Copy.md` 新增 D588 单串行：位置「引用图片失败 toast（解码失败）」/ 角色 作者 / 中文「无法解码这张图片：{reason}」/ English "Couldn't decode this image: {reason}" / 设计意图写明「只服务引用语境；粘贴语境读 D438；与 D585 的分工是『格式支持但字节解不开』vs『格式不支持』」
- [x] 1.3 `文案-Copy.md` 的「编号沿革」三处同步：编号规则段的「当前末位：D587」→ D588、分配记录新增一行（本批只取这一号）、「D 区间 → 归属文件」段追加 `D588 — src/quote-image.ts 的 quoteImageErrorText`
- [x] 1.4 `src/copy-data.ts` 的 `COPY_TABLE` 新增 `D588`（zh / en 两列，占位名 `reason`；不需要 `enOne`）
- [x] 1.5 D438 的设计意图列补一句指针（「粘贴语境专用；引用语境读 D588」）——中文 / English 正文列逐字不动

## 2. 引用路径映射

- [x] 2.1 `src/quote-image.ts` 的 `quoteImageErrorText` 增加 `attachment_decode_failed` → D588 分支（与既有 `attachment_type_unsupported` → D585 分支同址、同形）
- [x] 2.2 缺 `{reason}` 参数时走 `errorText` 的既有兜底口径（回落后端 message + console 线索，不抛错）；MUST NOT 在调用点另写一份 try/catch
- [x] 2.3 注释同步：`src/quote-image.ts` 文件头 M666 段那句「→ D438，走的是 quoteImageErrorText 的通用分支」、`quoteImageErrorText` 的 doc（「其余 code 与粘贴路径同一张 ERROR_COPY 表」）、`src/main.ts` `insertQuotedImages` 上方的按调用点分码注释
- [x] 2.4 粘贴路径零改动核验：`git diff` 里 `ERROR_COPY` 的 `attachment_decode_failed: "D438"` 与 D436–D441 的正文 / English 列均为空（其余码的措辞与语境无关，本批一个都不改）

## 3. 单测判据

- [x] 3.1 引用侧正例（`tests/unit/quote-image.test.ts`）：坏 png（`attachment_decode_failed`）与畸形 svg 两条路径都读 D588 文案——含「无法解码」、不含「剪贴板」；失败读数与持久留痕的既有断言不变
- [x] 3.2 区分度反向输入（同文件）：同一引用路径把 code 换成 `attachment_type_unsupported` 必须读 D585、换成 `attachment_too_large` 必须读 D437（证明只改了解码失败这一条）
- [x] 3.3 粘贴侧锁定（`tests/unit/error-text.test.ts`）：`errorText({code:"attachment_decode_failed", params:{reason}})` 在 zh 下仍含「剪贴板」、en 下仍含 "clipboard"（与改动前逐字相同）
- [x] 3.4 缺参兜底（同文件）：不带 `params.reason` 的信封不抛错，上屏回落后端 message，且不含未替换的 `{reason}`
- [x] 3.5 文案漂移门禁：`tests/unit/copy.test.ts` 全绿（deck 行 ↔ 表键一一对应、两列逐字相等、占位名一致），无需改 `MULTI_STRING_ROWS`

## 4. 视觉与真机

- [x] 4.1 `tests/visual/scenes/m633-image-quote.spec.ts` 新增用例：用桩的 `harnessImageFailures` 给 `image/png` 注入 `attachment_decode_failed` 信封，引用 pic.png → toast 是 D588 文案（不含「剪贴板」）、持久状态行「1 张图片未能引用」在场、composer 无图片卡片；同场景既有的 gif 用例仍断言 D585（两条互为反向区分）
- [x] 4.2 新增真机验收场景 `scripts/acceptance/scenarios/232-quote-decode-error-copy.md`（item 232）：合成 fixture（一篇短笔记 + 一个非 PNG 字节的 `.png`）→ 选中 `![[…]]` 源码 → 点「摘录到对话」→ AX 断言 toast 含「无法解码」、不含「剪贴板」、不含「暂不支持引用该格式」，状态行在场，composer 无图片卡片
- [x] 4.3 既有场景 222 零改动核验：svg 成功路径「不产失败留痕 / 不出 D585」的两条断言仍成立（本 change 不改成功路径）
- [x] 4.4 粘贴回归：场景 112 / 127 复跑仍绿（粘贴写入口与文案未变）。覆盖边界如实写进场景说明：粘贴侧解码失败在真机不可注入（AppleScript `«class PNGf»` 只产合法 PNG），由 3.3 的单测锁定

## 5. 验证

- [x] 5.1 `node tests/unit/run.mjs` 全绿
- [x] 5.2 `pnpm exec tsc --noEmit`、`pnpm exec tsc -p tests/unit/tsconfig.json`、`tests/visual` 的 tsc 均通过
- [x] 5.3 `scripts/gate.sh quick` 通过（报告照抄 `GATE RESULT` 原文行并附退出码，SKIP 单列）
- [x] 5.4 动过 `tests/visual/scenes/**` 后本地跑 `scripts/gate.sh visual`（CI 绿不等于像素层没回归）；本 change 无基线更新
- [x] 5.5 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 与 `bash scripts/docs-check.sh` 通过
- [x] 5.6 `node scripts/acceptance/run.mjs --check` 通过；真机跑 `node scripts/acceptance/run.mjs 232 112 127`（实跑 232 112 127 222 四场景：4/4 PASS）

## 6. 明确不做

- [x] 6.1 不新增 / 不改后端错误码，不动 Rust（写原语是粘贴与引用共用的单一判定面）
- [x] 6.2 不改粘贴路径任何串（D436–D441）；D438 只补设计意图列的指针
- [x] 6.3 不扩编码失败（D439 的引用语境同形缺口）：要覆盖先按 D589 取号并重走节点 1
- [x] 6.4 不动 D585 / D586 的文案与行为
- [x] 6.5 不提前改 living spec；不改 `quote-pipeline-consistency-oct24` / `svg-image-quote-oct24` 的 delta 正文
