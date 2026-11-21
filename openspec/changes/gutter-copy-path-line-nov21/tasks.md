# Tasks: gutter-copy-path-line-nov21

## 1. 制品

- [x] 1.1 `proposal.md` / `design.md` / `tasks.md` / `specs/keymap-commands/spec.md` 起草完成
- [x] 1.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（35 passed / 0 failed）
- [x] 1.3 `bash scripts/docs-check.sh` 通过（含相对链接、验收场景契约与覆盖表）

## 2. 纯逻辑与文案

- [x] 2.1 新增 `src/gutter-copy.ts`：`GutterCopyPort` + `pathLineText(path, line)`
- [x] 2.2 `src/copy-data.ts` + `文案-Copy.md` 新增 D943「已复制 {target}」；失败复用 D155、无路径 reason 用 D207
- [x] 2.3 新增 `tests/unit/gutter-copy.test.ts`：相对路径 / 空格 / 中文 / 外部绝对路径 / 首末行 / 无字面花括号
- [x] 2.4 `pnpm test` 绿（1684 tests / 1684 pass / 0 fail）

## 3. 编辑器接线

- [x] 3.1 `src/editor.ts`：`lineNumberGutterExtensions()` 用 `lineNumbers({domEventHandlers})`，md 的 `mdGutterExtensions()` 与 code 分支共用；`installed` 条件与档位重配逻辑不变
- [x] 3.2 `src/editor.ts`：`EditorHandle.setGutterCopy(port)` 注入面；处理器读 `active.path` 与 `doc.lineAt(block.from).number`，不 dispatch / 不 focus；辅助键的 `mousedown` 先消费默认行为（不抢焦点、不触发 `on-demand` 临时 gutter 的 focusout 卸载）
- [x] 3.3 `src/main.ts`：`injectEach` 注入复制端口；`copyPathLine` 写剪贴板 + 成功 / 失败 toast + console 线索

## 4. 测试

- [x] 4.1 新增 `tests/visual/scenes/gutter-copy-path-line.spec.ts`：md / code 首末行、空格 / 中文路径、vault 外绝对路径、剪贴板拒绝、`on-demand` 临时 gutter、`off` 档无 gutter、零副作用、`contextmenu` 默认行为被阻止、焦点不移动
- [x] 4.2 新增 `scripts/acceptance/scenarios/705-gutter-copy.md`：真机 WKWebView 的右键链路与剪贴板逐字；覆盖边界（权限拒绝 / 外部路径的坐标校准）写进场景正文
- [x] 4.3 `node scripts/acceptance/coverage.mjs` 重新生成覆盖表；`run.mjs --check` 通过（246 个场景）

## 5. 验证

- [x] 5.1 根 `pnpm exec tsc --noEmit` 通过
- [x] 5.2 `pnpm test` 通过（1684/1684）
- [x] 5.3 `LUMIR_VISUAL_PORT=4286` 跑受影响 Playwright 场景：新场景 6/6 PASS；`m281-goto-line.spec.ts` 结构 / 计算属性断言 12/12 PASS。该 spec 的 2 条整页像素基线（`m281-md-gutter` / `m281-goto-prompt`）在本机判红，**与本次改动无关**：把 `lineNumbers()` 临时还原为无 handler 后重建，像素计数逐值相同（2474 / 2457），diff 是整页文字抗锯齿差异；未更新基线（基线更新是人肉裁决点）
- [x] 5.4 `node scripts/acceptance/run.mjs --check`（不跑真机）通过
- [x] 5.5 证据落 `.local/missions/gutter-copy-nov21/`（命令、输出、像素漂移对照）
- [x] 5.6 改动面 grep 清扫仓库信息卫生（fixture 全为合成内容，无真实 vault 内容 / 真实路径）
