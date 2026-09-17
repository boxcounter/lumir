# Tasks: add-toc-outline

## 1. 标题提取与位置指示

- [x] 1.1 `src/toc.ts`：`extractHeadings(state, full)` 从语法树取 ATX 标题（层级 / 行号 / 行范围 / 文本），
      文本口径为「行原文去掉 `#` 标记串」（含 `[ \t]+#+[ \t]*$` 结尾标记）；`full=true` 时先做一次
      25ms 预算的全量解析（只在浮层打开路径调用）。
- [x] 1.2 `src/toc.ts`：frontmatter 块内的 `#` 行排除，判定复用 `src/preview/frontmatter.ts` 的
      `detectFrontmatter`（tower 批准 2026-09-17 的只读 import；被依赖文件零改动）。
- [x] 1.3 `src/toc.ts`：`anchorPos` / `headingIndexAt` / `headingPath` 三个纯函数定义位置口径
      （光标可见取光标、不可见取视口顶部；链路只含祖先链）。
- [x] 1.4 `src/shell.ts`：masthead 增加 `.masthead-section` 按钮把手（`AppShell.masthead` +
      `mastheadSection`），初始 hidden。
- [x] 1.5 `src/toc.ts`：指示段刷新走 `view.dispatch({effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of(...))})` + 120ms 节流（首帧立即同步一次）；无文件 / 无标题 /
      非 md 时隐藏。
- [x] 1.6 `src/style.css`：指示段样式（参与 masthead 行内 flex 收缩、省略号收尾、`::before` 分隔符），
      只用 M55 既有 token。

## 2. 大纲浮层

- [x] 2.1 `src/toc.ts`：浮层 DOM（`role=listbox` + `role=option` 条目 + 底部键位提示），条目按层级缩进
      （`--toc-depth`，以文档最浅层标题归一）、当前段 `.is-current`、键盘游标 `.is-active`。
- [x] 2.2 `src/toc.ts`：开启（点击指示段 / 命令）与四条关闭路径（`Esc` / 再次触发命令 / 点击浮层以外 /
      焦点离开），均把焦点交还编辑器；打开期间持有焦点，`editor` 作用域不穿透。
- [x] 2.3 `src/toc.ts`：`↑↓` 钳制移动、`Enter` 与鼠标点击共用 `jumpTo`（光标落行尾 +
      `scrollIntoView({y:"center"})`），跳转后立即同步指示段；`⌃K` 等其余键不消费。
- [x] 2.4 `src/toc.ts`：无标题文档只给 toast（D84），不展开空浮层。
- [x] 2.5 `src/style.css`：浮层样式（绝对定位贴指示段下方、M55 token、阴影由 `--text` 混色而来），
      JS 侧 `place()` 只做水平定位与右边界钳制。

## 3. 键位与装配

- [x] 3.1 `src/keys.ts`：`GLOBAL_COMMAND_IDS` 增 `toc.toggle`；`KEY_BINDINGS` 增
      `Cmd-Shift-o → toc.toggle`（scope `global`），`doc` 写明作用域理由与零冲突核对结论（表内
      `⌘⇧` 系只有 `⇧⌘Z`；原生菜单 accelerator 集合同样只有 `⇧⌘Z`，macOS Help 子菜单为空）；
      文件头补 M148 段落。
- [x] 3.2 `src/main.ts`：装配 `createToc`（视图 + 指示段 + 浮层挂点 + 有无当前文件 + toast），
      `commands` 增 `toc.toggle`。
- [x] 3.3 `文案-Copy.md`：新增 D84–D87（空标题提示 / 浮层读屏名 / 浮层键位提示 / 指示段悬停提示）与
      出处备注段落。

## 4. 验收与制品

- [x] 4.1 `scripts/acceptance/fixtures/`：`toc-outline.md`（H1–H6 层级）、`toc-frontmatter.md`
      （frontmatter 内含 `#` 注释行 + 真标题）、`toc-plain.md`（无标题）。
- [x] 4.2 `scripts/acceptance/scenarios/13-toc.md`：断言浮层开合、条目覆盖 H3/H6、键盘与鼠标跳转、
      跳转后光标位置（位置指示链条 + `⌃K` 行尾合并两条派生证据）、`Esc` 关闭、空标题 toast、
      frontmatter 边界；`node scripts/acceptance/run.mjs --check` 通过。
- [x] 4.3 `scripts/acceptance/README.md`：已知边界补「真机上光标位置用派生证据断言」一条（本场景的
      口径，供后续场景复用）。
- [x] 4.4 `openspec/changes/add-toc-outline/`：proposal / tasks / 两份 delta（`toc-outline` 新建、
      `keymap-commands` 增绑定与命令）。
- [x] 4.5 `tests/visual/scenes/toc-outline.spec.ts`（新场景）+ 新基线
      `toc-popover-chromium-darwin.png`：钉住整页容差抓不到的新 UI——指示段的有/无（含空态对照）、
      浮层条目与 `--toc-depth` 层级、当前段高亮、键位提示、`↓` 不穿透、`Enter` 后直接读
      CodeMirror 选区断言光标落在标题行尾、`⌘⇧O` / `Esc` 开合。既有 15 张整页基线实测逐字节零变化
      （整页容差 ~960 px 吞掉指示段 ~100 px 的变化），已如实记进 proposal 的 Impact。

## 5. 验证

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [x] 5.2 `scripts/gate.sh quick` 全绿（fmt / clippy / cargo test / bindings 漂移 / tsc / openspec validate）。
- [x] 5.3 真机（WKWebView）全量 `node scripts/acceptance/run.mjs` **21/21 PASS**（含 `13-toc`
      单场景 PASS / 32 断言 0 失败，耗时 31.9s）；证据落 `test-results/acceptance/2026-09-17/`
      （`summary.md` / `results.json` / `13-toc/steps.md` + `shots/` + `ax/`）。此前两轮 13-toc 的
      FAIL 与排查过程一并留档：首轮是 `click.target.name` 口径写错（已修 + 写进套件 README），
      次轮是全量轮里 `Enter` 丢键的连锁（已按「确定性优先」重排步骤，`run.mjs 12 13` 复现后
      消除连锁）。
- [x] 5.4 `git diff --check` 通过；改动文件集合与 mission scope 一致（跨 scope 的只有那一条被批准的
      只读 import，无 preview 文件改动）。
- [ ] 5.5 rebase 到 master（bc98f2f，M147 已合并）后重跑：`scripts/gate.sh quick` 全绿**无 SKIP**、
      `scripts/gate.sh visual` 全绿（含新增 `toc-outline` 场景）、真机全量复跑证据。
