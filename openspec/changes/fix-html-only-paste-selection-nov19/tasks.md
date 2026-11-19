# Tasks: fix-html-only-paste-selection-nov19

## 1. 合同与修复前反例

- [ ] 1.1 读 REVIEW.md 与 finding `20261119-worker-unicode-clipboard-bug-html-only-cm-dopaste`；核对 CM6
      默认 paste 源码（`handlers.paste`：`doPaste(view, getData("text/plain") || getData("text/uri-list"))`，
      `readOnly` 时提前返回），确认缺陷面只在可编辑会话。
- [ ] 1.2 修复前反例（chromium，临时探针 spec，跑完删除）：HTML-only + 正向 / 反向 / 折叠 caret、
      只有文件项 + 非空选区、code 模式同形——前两类的选区被删成 `alta\n`（doc 与选区双读数），
      可插文本（plain / uri-list）用例通过（基线逐字节不变）。证据
      `.local/missions/m859-html-only-paste/red-probe-chromium.log`。
- [ ] 1.3 规格 delta 落 `clipboard-image-paste` 的「非图片剪贴板降级」（MODIFIED）：无 image 项且无
      非空 plain / uri-list ⇒ 严格空操作（doc / 选区 / 撤销栈 / dirty 不变）；可插文本与 uri-list
      降级顺序、图片优先、只读语义均不变。

## 2. 实现（最小降级闸门）

- [ ] 2.1 `src/editor.ts` 的 `baseExtensions()` paste 处理器：图片分支原样在前；其后加闸门——
      `view.state.readOnly` 或 `getData("text/plain")` / `getData("text/uri-list")` 任一非空 ⇒
      `return false`（交回 CM，逐字节不变）；否则 `preventDefault()` + `return true`（严格空操作）。
      判据与 CM 默认粘贴同源，不另立 MIME 表、不解析 HTML、无第二套粘贴管线。
- [ ] 2.2 修复后同探针转绿（chromium + webkit-realua 双引擎）：HTML-only / 文件项 / code 模式均空操作，
      可插文本用例逐字节不变，只读（vault 外会话）文档与选区不变。证据
      `.local/missions/m859-html-only-paste/green-probe-*.log`。

## 3. 正向合同（M843 文件，合并后追加）

- [ ] 3.1 `tests/visual/scenes/text-clipboard-adversarial.spec.ts`（M843 合并后追加）：HTML-only 的
      折叠 caret / 正向 / 反向非空选区都断言 doc + 选区不变、事件被消费；只有非图片文件项同判；
      只读会话不拦截；plain 压 HTML、uri-list 降级、图片优先与 code 模式各一条不回归。
- [ ] 3.2 `tests/visual/README.md`：把「已知产品边界」第三条（HTML-only 不写成合同）改为合同描述
      并从 finding 指针清单里删除该条；补充双引擎判据一句话。

## 4. 真机

- [ ] 4.1 新增 `scripts/acceptance/scenarios/267-html-only-paste-selection.md`，`node scripts/acceptance/coverage.mjs`
      重新生成 `COVERAGE.md`（不手改）。场景设计如实声明边界：套件只有 `clipboardText` /
      `clipboardImage` 两条置剪贴板通道，造不出 HTML-only；真机 witness 取同一退化类的另一形态
      （code 模式 + 仅图片剪贴板 + 非空选区，修复前同样删选区），另加 md 纯文本替换选区与
      md 图片替换选区两条不回归。
- [ ] 4.2 真机 267 在 tower 串行窗口内执行并把 PASS / 断言数 / 退出码写进证据；**未跑不得记 PASS**。

## 5. 验证

- [ ] 5.1 目标双引擎：`LUMIR_VISUAL_PORT=4396 pnpm --dir tests/visual exec playwright test scenes/text-clipboard-adversarial.spec.ts`
      （chromium + webkit-realua）全绿，记录条数。
- [ ] 5.2 `scripts/gate.sh quick` 全绿，照抄 `GATE RESULT` 原文行并附退出码。
- [ ] 5.3 `LUMIR_VISUAL_PORT=4396 scripts/gate.sh visual` 全绿，照抄 `GATE RESULT` 原文行并附退出码；
      不更新任何像素基线。
- [ ] 5.4 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`、`bash scripts/docs-check.sh`、
      `node scripts/acceptance/run.mjs --check` 通过。
- [ ] 5.5 临时探针 spec / 探针配置在提交前删除（`git status` 无残留），提交 TowerComplete 等待独立 review。
