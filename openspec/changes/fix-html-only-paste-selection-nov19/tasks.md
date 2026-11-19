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
      退化类的另一形态（code 模式 + 仅图片剪贴板 + ⌘A 非空选区，修复前同样删选区），另加 md
      纯文本替换选区与 md 图片替换选区两条不回归。
- [ ] 4.2 真机 267 在 tower 串行窗口内执行并把 PASS / 断言数 / 退出码写进证据；**未跑不得记 PASS**
      （等 tower 串行通知；窗口内先修复前构建取证、再修复后复跑）。

## 5. 验证

- [x] 5.1 目标双引擎：chromium `28 passed`（`.local/missions/M859/target-chromium.log`）；
      webkit-realua `27 passed + 1 skipped`（IME CDP-only，`.local/missions/M859/target-webkit.log`）；
      根 tsc 与 `tests/visual` tsc 均通过。
- [ ] 5.2 `scripts/gate.sh quick` 全绿（`CARGO_TARGET_DIR=/tmp/lumir-m859-target`），照抄
      `GATE RESULT` 原文行并附退出码。
- [ ] 5.3 `LUMIR_VISUAL_PORT=4396 scripts/gate.sh visual` 全绿（等 tower 在 M844 槽位结束后批准），
      照抄 `GATE RESULT` 原文行并附退出码；不更新任何像素基线。
- [x] 5.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`（35 passed / 0 failed）、
      `bash scripts/docs-check.sh` PASS、`node scripts/acceptance/run.mjs --check` 通过（提交前复跑一次）。
- [ ] 5.5 临时探针 spec / 探针配置已删除（`git status` 无残留）；提交 TowerComplete 等待独立 review。
