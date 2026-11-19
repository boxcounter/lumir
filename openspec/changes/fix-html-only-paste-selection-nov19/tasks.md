# Tasks: fix-html-only-paste-selection-nov19

## 1. 合同与修复前反例

- [x] 1.1 读 REVIEW.md 与 finding `20261119-worker-unicode-clipboard-bug-html-only-cm-dopaste`；核对 CM6
      默认 paste 源码（`handlers.paste`：`doPaste(view, getData("text/plain") || getData("text/uri-list"))`，
      `readOnly` 时提前返回），确认缺陷面只在可编辑会话。
- [x] 1.2 修复前反例（chromium，临时探针 spec，跑完删除）：HTML-only + 正向 / 反向 / 折叠 caret、
      只有文件项 + 非空选区、code 模式同形——前两类的选区被删成 `alta\n`（doc 与选区双读数），
      可插文本（plain / uri-list）用例通过（基线逐字节不变）。证据
      `.local/missions/M859/red-probe-chromium.log`。
- [x] 1.3 规格 delta 落 `clipboard-image-paste`：MODIFIED「非图片剪贴板降级」+ Purpose 修正——无 image
      项且无非空 plain / uri-list（含显式空串）⇒ 严格空操作（doc / 选区 / 撤销栈 / dirty 不变）；
      可插文本与 uri-list 降级顺序、图片优先、只读语义均不变。

## 2. 实现（最小降级闸门）

- [x] 2.1 `src/editor.ts` 的 `baseExtensions()` paste 处理器：图片分支原样在前；其后加闸门——
      `view.state.readOnly` 或 `getData("text/plain")` / `getData("text/uri-list")` 任一非空 ⇒
      `return false`（交回 CM，逐字节不变）；否则 `preventDefault()` + `return true`（严格空操作）。
      判据与 CM 默认粘贴同源，不另立 MIME 表、不解析 HTML、无第二套粘贴管线。
- [x] 2.2 修复后同探针转绿（chromium + webkit-realua 双引擎）：HTML-only / 文件项 / code 模式均空操作，
      可插文本用例逐字节不变，只读（vault 外会话）文档与选区不变。证据
      `.local/missions/M859/green-probe-both-engines.log`。

## 3. 正向合同（M843 文件，合并后追加）

- [x] 3.1 `tests/visual/scenes/text-clipboard-adversarial.spec.ts`：新增第十二节「无可插入文本的粘贴 =
      严格空操作」——四类剪贴板（HTML-only / text/markdown-only / 只有非图片文件项 / 空 text/plain）×
      折叠 caret 与正 / 反向非空选区，逐格断言 doc + 选区不变、⌘Z 不复原被删内容、dirty 不翻转；
      另加既有优先级不回归（plain 压 HTML / uri-list 有选区降级）、code 模式、只读会话三条。
      **M843 的 `text/markdown-only + 非空选区` expected failure（`baseTest.fail`）已转正**并并入矩阵；
      M843 四节的「整段选区」用例插入值从空串改为非空（空 text/plain 自本 change 起属「无可插入文本」）。
- [x] 3.2 `tests/visual/README.md`：M843 节「判据面（合同）」补 no-op 合同与 Markdown/HTML 新口径；
      「已知产品边界」删掉 HTML-only 与 text/markdown-only 两条 finding，改为「已转合同」的说明。

## 4. 真机

- [x] 4.1 新增 `scripts/acceptance/scenarios/267-html-only-paste-selection.md`，`node scripts/acceptance/coverage.mjs`
      重新生成 `COVERAGE.md`（240 场景 / 217 item，不手改）。场景设计如实声明边界：套件只有
      `clipboardText` / `clipboardImage` 两条置剪贴板通道，造不出 HTML-only；真机 witness 取同一
      退化类的另一形态（code 模式 + 仅图片剪贴板 + 非空选区，修复前同样删选区），另加 md 纯文本
      替换选区与 md 图片替换选区两条不回归。粘贴通道是 `do: key` 的 **cgevent ⌘V**（真机实测落地；
      原生上下文菜单 Paste 在本机 AXPress 静默 no-op，已弃用并记录）。
- [x] 4.2 真机 267 在 tower 串行窗口内**先红后绿**：修复前构建（`master` 的 `src/editor.ts`）
      `结论：0/1 PASS`——W1 文档被改成 `alpbeta`（选区 [3,6) 被删）、Backspace 派生观测得 `albeta`；
      修复后 `结论：1/1 PASS`，21 条断言 0 失败，退出码 0。证据
      `.local/missions/M859/267-red-machine-final.log`、`267-green-machine.log` 与
      `267-{red,green}/`（每个落地实例都 `STRAY-SCAN none` 正常退出）。同目录的
      `267-red-machine.log` / `267-red-machine-r2.log` 是**已弃用的原生菜单通道**旧失败记录
      （40 行 fixture、W2 假 FAIL），不是最终红色 witness，不得引作红证据。

## 5. 验证

- [x] 5.1 目标双引擎：chromium `28 passed`（`.local/missions/M859/target-chromium.log`）；
      webkit-realua `27 passed + 1 skipped`（IME CDP-only，`.local/missions/M859/target-webkit.log`）；
      根 tsc 与 `tests/visual` tsc 均通过。rebase 后复跑（tip `216b7f84`）：两 project 合计
      `55 passed + 1 skipped`（`.local/missions/M859/rebase-target-both.log`）。
- [x] 5.2 `scripts/gate.sh quick` 全绿（`CARGO_TARGET_DIR=/tmp/lumir-m859-target`）：
      `GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0；日志 `.local/missions/M859/gate-quick.log`。
      rebase 后复跑：同一原文行 `GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0
      （`.local/missions/M859/gate-quick-rebase.log`）。首跑因机器级 ENOSPC 失败（`ld: write()
      failed, errno=28`），现场 `.local/missions/M859/enospc-cargo-test.log`；tower 清掉两份
      空闲 `/tmp` target 后复跑转绿，产品判据未改。
- [x] 5.3 `LUMIR_VISUAL_PORT=4396 CARGO_TARGET_DIR=/tmp/lumir-m859-target scripts/gate.sh visual`
      （tower 在 M844 槽位结束后批准，tip `21cd34a2`）：`GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0；
      视觉回归 1180 条（1176 passed / 4 skipped / 0 failed，17.8m）。日志 `.local/missions/M859/gate-visual.log`；
      不更新任何像素基线。rebase 后复跑（tip `216b7f84`）：`GATE RESULT: 15/15 PASS（SKIP 0）`，
      退出码 0；视觉回归 1272 条（1268 passed / 4 skipped，18.2m），日志
      `.local/missions/M859/gate-visual-rebase.log`；同样未更新基线。
      **最终 tip `0a629e98` 的两次读数**：①并发条件下（误与 M865 的 visual 并行）全绿
      `1268 passed / 4 skipped / 0 failed`，`GATE RESULT: 15/15 PASS（SKIP 0）`，日志
      `.local/missions/M859/gate-visual-final.log`；②tower 独占授权后复跑同样全绿
      （`1268 passed / 4 skipped / 0 failed`，17.7m），`GATE RESULT: 15/15 PASS（SKIP 0）`，
      日志 `.local/missions/M859/gate-visual-exclusive.log`。此前一条 `m734-settings-panel`
      的 ✘ 经核实来自并行的 M865 日志（误取），隔离复跑该 spec `34 passed / 0 failed`
      （`.local/missions/M859/m734-isolated.log`）。
- [x] 5.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`（35 passed / 0 failed）、
      `bash scripts/docs-check.sh` PASS、`node scripts/acceptance/run.mjs --check` 通过（提交前复跑一次）。
- [x] 5.5 临时探针 spec / 探针配置已删除（`git status` 无残留）；真机窗口后 `/tmp/lumir-m859-target` 已清理；
      提交 TowerComplete 等待独立 review。
- [x] 5.6 rebase 到 master：先 `88886e4f`（COVERAGE.md 冲突用生成器重建，244 场景 / 221 item，
      263–267 全在；editor.ts 自动合并保留 M854/M855 的 beforeinput 统一闸门与本节 paste 降级；
      backlog 仅本 change 一条、未恢复 M854 已核销条目），随后 master 前进到 `09eb4a7c`
      （M855 归档）再 rebase 一次——backlog 冲突按「保留 master 的 M855 活跃队列条目 + 本 change
      条目、不恢复已核销项」解决（80/80 行，上限内），最终 tip `0a629e98`。paste 行为零冲突
      （合并后的 paste 处理器与已审版本逐字一致），267 未复跑。
