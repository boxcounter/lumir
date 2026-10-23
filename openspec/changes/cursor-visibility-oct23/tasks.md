# Tasks: cursor-visibility-oct23

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；
> 实现期发现 proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。
> D1–D3 的裁决结果回填 proposal 的「评审记录」块，再按裁决修正 delta / design / 本文件。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / 两份 spec delta / 本文件
- [ ] 0.2 Alex 节点 1 评审通过（硬门禁；D1–D3 一并裁决，未回的按提案里的倾向落地）
- [ ] 0.3 裁决结果回填 proposal 的「评审记录」块（逐字），按裁决修正 design §3 / §2 与 delta

## 1. 合同与属性测试（先于实现）

- [ ] 1.1 新建 `docs/specs/editor-caret.md`：C1–C5 条款按 design §2 原文落地，附输入分布
      （§2.1）与属性测试指针；文件头写明「渲染缺陷合同先行」的来历与状态
- [ ] 1.2 抽出可单测的纯函数并用 `tests/unit/frontmatter-caret.test.ts` 钉住：
      `firstBodyLineStart`（含 fm 有 / 无正文、空 fm、`---` 结尾、`...` 闭合、无 fm）；
      `frontmatterCaretFilter` 的判定（`fm.from` / `fm.to` / 块内 / 块外 × 空 / 非空选区 ×
      垂直移动 / 普通事务 / `trustedLoad`），断言按来源分流（移动 → 块内；其它 → 正文首行，
      无正文 → 块内）、装载事务不被改写
- [ ] 1.3 新增 `tests/visual/scenes/m647-caret-geometry.spec.ts`：按 design §4.2 的 A–G 组
      建 fixture 矩阵（frontmatter 行数 × 标题有无 × 正文有无 × 入口 × 主题 × 字号），
      断言光标 `getBoundingClientRect().height` = 所在可见行行盒 ±1px、且小于
      `.cm-lp-frontmatter-outer` 高度（区分度对照）；记录一次修前红色读数（properties 渲染时
      光标高度 = 块高度）
- [ ] 1.4 同一场景加光标计算样式断言：`borderLeftWidth` = 2px、颜色 = `--text`、
      `marginLeft` = -1px、`.cm-cursorLayer` 的 `animationName` = none；非聚焦时 `.cm-cursor`
      不可见
- [ ] 1.5 反向验证断言有区分度：正文行光标高度等于正文行盒、H1 行光标高度等于 H1 行盒
      （不是常量）；构造一个「光标高度 = 块高度」的反例确认 §1.3 的断言会红

## 2. 实现

- [ ] 2.1 新建 `src/preview/replaced-source.ts`，把 `enterReplacedSource` 从
      `src/preview/math.ts:176-198` 原样迁入；`math.ts` / `mermaid.ts` 改 import，行为逐字不变
- [ ] 2.2 `src/preview/livePreview.ts`：frontmatter 显露判据改为
      `touchesSource(state, fm.from, fm.to)`（保留 `revealSelection` 的 M259 快照）；
      删掉「覆盖整块」的旧条件
- [ ] 2.3 `src/preview/frontmatter.ts`：`toDOM(view)` 接 view；outer 挂 `mousedown` 路由——
      properties 盒 → `enterReplacedSource`（innerFrom / innerTo 由运行期文档计算）；
      doc-title / padding → `preventDefault` + `view.focus()` +
      `normalizeFrontmatterCaret(view)`；删除 `selected` 字段、构造参数与
      `.cm-lp-frontmatter-selected` 类名拼接
- [ ] 2.4 `src/preview/theme.ts`：删除 `cm-lp-frontmatter-selected` 三条样式（含 eink 覆盖）；
      `rg` 确认 `cm-lp-frontmatter-selected` 全仓零引用
- [ ] 2.5 `src/preview/frontmatter.ts` 新增 `firstBodyLineStart(doc: Text, fm: { from; to })`；
      `src/editor.ts` 的 `loadedState` 与 openFile 的 `dispatchTrusted` 按它把初始选区放到正文
      首行（md 模式；无正文行时不动，code 模式不变）
- [ ] 2.6 `src/preview/frontmatter.ts` 新增 `frontmatterBlockField`（`StateField<FrontmatterBlock
      | null>`，`create` / `docChanged` 时 `detectFrontmatter`，其余 O(1)）；`frontmatterSet`
      改读该 field（扩展组里排在其前），检测只留一处
- [ ] 2.7 新建 `src/editor-annotations.ts`，把 `trustedLoad` 从 `editor.ts:1564` 迁入并改
      editor 的 import；`src/preview/livePreview.ts` 新增 `frontmatterCaretFilter`
      （`transactionFilter`）：空光标在 `fm.from` / `fm.to` 且非 `trustedLoad` 时按来源分流
      ——垂直移动 → 块内一个字符（显露）；其它 → 正文首行（无正文 → 块内）；只在 md 模式装
- [ ] 2.8 `src/preview/livePreview.ts` 装 focus 处理器（md 专属，
      `EditorView.domEventHandlers({ focus })`）调用 `normalizeFrontmatterCaret`；装载路径
      （`loadedState` / openFile）用 `normalizeInitialCaret` 覆盖「已聚焦时装载」；`activate`
      的 `view.setState` 与 `setMode` 重配到 md 之后若 `hasFocus` 也调用 normalizer；MUST NOT
      在 `ViewPlugin.update` 里 dispatch（CM 的更新中禁令）；只改选区、不滚动、不改文档
- [ ] 2.9 `src/editor.ts` 的 `clampAcrossBlockWidgets`：返回块内最近源码位
      （forward `best + 1` / backward `best - 1`）取代块边界；同步改 `blockWidgetBoundaries`
      的注释与 `verticalTarget` 的行为说明（M110 意图保留：不一步跨块）
- [ ] 2.10 `src/editor.ts` 的光标视觉（D2=A）：`.cm-cursor, .cm-dropCursor` 改
      `borderLeft: 2px solid var(--text)` + `marginLeft: -1px`；`.cm-cursorLayer` 取消动画；
      注释指向 `docs/specs/editor-caret.md` 与 D2
- [ ] 2.11 注释清扫：`src/preview/math.ts` / `mermaid.ts` / `frontmatter.ts` 里所有
      「与 frontmatter 的 selected 口径一致」类表述改准（改为「严格重叠即显露」）；
      `rg "frontmatter.*selected|selected.*frontmatter"` 零命中
- [ ] 2.12 更新 `tests/unit/doc-title-placement.test.ts:172-181` 的 FrontmatterWidget 构造参数；
      确认没有第二处构造点漏改（`rg "new FrontmatterWidget"`）

## 3. 文档与值登记

- [ ] 3.1 `docs/specs/design-tokens-v1.md`：在「阴影与 hairline」节追加一行编辑器光标
      组件常量——宽度 2px、常亮、三主题同值（含 eink）；不新增 token 计数（理由：与
      1.2–1.6px 强调线宽 / 2px 引用块竖线同族，见规则⑧）；注明它是交互指示线、不参与
      「三处粗 hairline 是装饰性结构线的全部」清单
- [ ] 3.2 `docs/specs/editor-caret.md` 与 design §2 逐字对账；条款引用处（proposal / design）
      的相对链接全部可达
- [ ] 3.3 实现期回扫：`docs/backlog.md` 的「mermaid / frontmatter 无键盘进入路径」一条
      按「新 findings 首选提议安排处理」规则处置（提议核销，不在本 change 直接改 backlog，
      由 tower 记账）

## 4. 验证

- [ ] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（提案阶段先跑）
- [ ] 4.2 `bash scripts/docs-check.sh` 通过（含 OpenSpec 相对链接可达 + 归档对账）
- [ ] 4.3 `pnpm test` 全绿（新增 / 更新的 unit）
- [ ] 4.4 `bash scripts/gate.sh quick` 全绿，照抄 `GATE RESULT` 原文行与退出码
- [ ] 4.5 `bash scripts/gate.sh visual` 全绿；变化基线逐张列出并由 Alex 过目（光标宽度 /
      常亮带来的像素变化 = 基线更新的人肉裁决点）
- [ ] 4.6 新增真机场景 `scripts/acceptance/scenarios/224-caret-visibility.md` 并 PASS：
      点击 properties / doc-title / 正文前后光标截图证据（含 light + eink）、
      `editor.unchangedSince` + 文件 `unchangedSince` 的字节断言；光标高度是手感项，
      不在真机断言（AX 不暴露 caret 几何，照实登记）
- [ ] 4.7 只有 frontmatter 的文档 / 非法 YAML 回退 / 512 行 frontmatter 三个边界在场景
      224 或 m647 视觉场景里至少各有一条读数
- [ ] 4.8 信息卫生：新增 fixture / 截图 / 文案 MUST NOT 出现真实 vault 内容；改动面做一次
      text 级 grep 清扫（含 `cm-lp-frontmatter-selected`、`selected` 残留）
- [ ] 4.9 真机 dogfood（Alex 手感项）：`pnpm tauri dev` 起真实 app，打开带 frontmatter 的
      合成文档，逐项过——点击 properties 落点是否大致在点击行、编辑 YAML 期间标题让位是否
      可接受、↑ 进入 YAML 是否自然、2px 常亮光标在三主题的观感、eink 下是否刺眼
