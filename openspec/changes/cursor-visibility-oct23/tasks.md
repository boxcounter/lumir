# Tasks: cursor-visibility-oct23

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；
> 实现期发现 proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。
> D1–D3 的裁决结果回填 proposal 的「评审记录」块，再按裁决修正 delta / design / 本文件。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / 两份 spec delta / 本文件
- [x] 0.2 Alex 节点 1 评审通过（硬门禁；D1–D3 一并裁决，未回的按提案里的倾向落地）
      ——2026-10-23 裁决：「D1–D3 全部按倾向」。
- [x] 0.3 裁决结果回填 proposal 的「评审记录」块（逐字），按裁决修正 design §3 / §2 与 delta
      ——proposal 已回填；delta 的「点击 doc-title / padding 只聚焦」场景补了边界光标前置
      （与 C3 / design §3.2 的 `normalizeFrontmatterCaret` 口径对齐，语义不变）。

## 1. 合同与属性测试（先于实现）

- [x] 1.1 新建 `docs/specs/editor-caret.md`：C1–C5 条款按 design §2 原文落地，附输入分布
      （§2.1）与属性测试指针；文件头写明「渲染缺陷合同先行」的来历与状态
- [x] 1.2 抽出可单测的纯函数并用 `tests/unit/frontmatter-caret.test.ts` 钉住：
      `firstBodyLineStart`（含 fm 有 / 无正文、空 fm、`---` 结尾、`...` 闭合、无 fm）；
      `frontmatterCaretFilter` 的判定（`fm.from` / `fm.to` / 块内 / 块外 × 空 / 非空选区 ×
      垂直移动 / 普通事务 / `trustedLoad`），断言按来源分流（移动 → 块内；其它 → 正文首行，
      无正文 → 块内）、装载事务不被改写
      ——15 条用例；过滤器判定实体是 `frontmatter.ts` 的 `frontmatterCaretSpecs`（见 2.7 的
      落点说明），测试直接驱动真实事务过滤器，不是复述一份同义函数。
- [x] 1.3 新增 `tests/visual/scenes/m647-caret-geometry.spec.ts`：按 design §4.2 的 A–G 组
      建 fixture 矩阵（frontmatter 行数 × 标题有无 × 正文有无 × 入口 × 主题 × 字号），
      断言光标 `getBoundingClientRect().height` = 所在可见行行盒 ±1px、且小于
      `.cm-lp-frontmatter-outer` 高度（区分度对照）；记录一次修前红色读数（properties 渲染时
      光标高度 = 块高度）
      ——修前红色读数：场景在 master 代码上 12/15 红（`.local/reviews/M654/prefix-red-readings.log`）；
      直接读数 `.local/reviews/M654/prefix-probe-reading.json`：光标高 205.2px = 块高 205.2px。
- [x] 1.4 同一场景加光标计算样式断言：`borderLeftWidth` = 2px、颜色 = `--text`、
      `marginLeft` = -1px；非聚焦时 `.cm-cursor` 不可见
      ——三主题各一条（light / dark / eink）。闪烁断言在 2026-10-24 改裁后改为
      `animationName` ∈ {`cm-blink`, `cm-blink2`}、`animationDuration` = 1.2s、动画运行中，
      并加亮 / 灭相位的 opacity 读数（见 5.2）。
- [x] 1.5 反向验证断言有区分度：正文行光标高度等于正文行盒、H1 行光标高度等于 H1 行盒
      （不是常量）；构造一个「光标高度 = 块高度」的反例确认 §1.3 的断言会红
      ——「H1 > 正文行」用例 + 1.3 的修前红色读数（修前光标高度 = 块高度、≠ 行盒）。

## 2. 实现

- [x] 2.1 新建 `src/preview/replaced-source.ts`，把 `enterReplacedSource` 从
      `src/preview/math.ts:176-198` 原样迁入；`math.ts` / `mermaid.ts` 改 import，行为逐字不变
- [x] 2.2 `src/preview/livePreview.ts`：frontmatter 显露判据改为
      `touchesSource(state, fm.from, fm.to)`（保留 `revealSelection` 的 M259 快照）；
      删掉「覆盖整块」的旧条件
- [x] 2.3 `src/preview/frontmatter.ts`：`toDOM(view)` 接 view；outer 挂 `mousedown` 路由——
      properties 盒 → `enterReplacedSource`（innerFrom / innerTo 由运行期文档计算）；
      doc-title / padding → `preventDefault` + `view.focus()` +
      `normalizeFrontmatterCaret(view)`；删除 `selected` 字段、构造参数与
      `.cm-lp-frontmatter-selected` 类名拼接
- [x] 2.4 `src/preview/theme.ts`：删除 `cm-lp-frontmatter-selected` 三条样式（含 eink 覆盖）；
      `rg` 确认 `cm-lp-frontmatter-selected` 全仓零引用
      ——仅剩两处文字引用：theme.ts 的「已删除」注释与 change 目录内的 tasks / design 文本。
- [x] 2.5 `src/preview/frontmatter.ts` 新增 `firstBodyLineStart(doc: Text, fm: { from; to })`；
      `src/editor.ts` 的 `loadedState` 与 openFile 的 `dispatchTrusted` 按它把初始选区放到正文
      首行（md 模式；无正文行时不动，code 模式不变）
- [x] 2.6 `src/preview/frontmatter.ts` 新增 `frontmatterBlockField`（`StateField<FrontmatterBlock
      | null>`，`create` / `docChanged` 时 `detectFrontmatter`，其余 O(1)）；`frontmatterSet`
      改读该 field（扩展组里排在其前），检测只留一处
      ——`buildDecorations` 的块范围也改读同一 field。
- [x] 2.7 新建 `src/editor-annotations.ts`，把 `trustedLoad` 从 `editor.ts:1564` 迁入并改
      editor 的 import；`src/preview/livePreview.ts` 新增 `frontmatterCaretFilter`
      （`transactionFilter`）：空光标在 `fm.from` / `fm.to` 且非 `trustedLoad` 时按来源分流
      ——垂直移动 → 块内一个字符（显露）；其它 → 正文首行（无正文 → 块内）；只在 md 模式装
      ——实现期调整落点：过滤器**判定实体**放 `frontmatter.ts` 的 `frontmatterCaretSpecs`
      （导出、纯函数），`livePreview.ts` 只做 `EditorState.transactionFilter.of(...)` 装配。
      理由：Node 单测可直接驱动真实过滤器（livePreview 的模块图不适合进零 DOM 单测），
      且 frontmatter 光标语义集中在一处。另加一条守卫：**没有设置选区的事务（effects-only）**
      原样放行——`tr.newSelection` 此时等于当前选区，装载复位后的 0 会被误判成「把光标放到
      边界」，导致打开只有 frontmatter 的文档自动变源码（m647 实测现场）。
- [x] 2.8 `src/preview/livePreview.ts` 装 focus 处理器（md 专属，
      `EditorView.domEventHandlers({ focus })`）调用 `normalizeFrontmatterCaret`；装载路径
      （`loadedState` / openFile）用 `normalizeInitialCaret` 覆盖「已聚焦时装载」；`activate`
      的 `view.setState` 与 `setMode` 重配到 md 之后若 `hasFocus` 也调用 normalizer；MUST NOT
      在 `ViewPlugin.update` 里 dispatch（CM 的更新中禁令）；只改选区、不滚动、不改文档
      ——`loadedState` 用纯 state 版 `initialCaretState`（无 view 可读），openFile 之后用
      view 版 `normalizeInitialCaret`；`activate` / `setMode` 的 normalizer 已装。
- [x] 2.9 `src/editor.ts` 的 `clampAcrossBlockWidgets`：返回块内最近源码位
      （forward `best + 1` / backward `best - 1`）取代块边界；同步改 `blockWidgetBoundaries`
      的注释与 `verticalTarget` 的行为说明（M110 意图保留：不一步跨块）
- [x] 2.10 `src/editor.ts` 的光标视觉：`.cm-cursor, .cm-dropCursor` 改
      `borderLeft: 2px solid var(--text)` + `marginLeft: -1px`；注释指向
      `docs/specs/editor-caret.md` 与 D2
      ——原 D2=A 曾以 `animation: none !important` 取消闪烁（CM 在光标移动时把 `animationName`
      写成**内联样式**，无 `!important` 的样式表声明一律输给它）；2026-10-24 改裁后该覆盖
      **整条删除**：闪烁交回 CM 原生 `cm-blink`，任何 animation 覆盖——尤其 `!important`——
      都会压住内联相位重启，MUST NOT 再加回（见 5.1）。
- [x] 2.11 注释清扫：`src/preview/math.ts` / `mermaid.ts` / `frontmatter.ts` 里所有
      「与 frontmatter 的 selected 口径一致」类表述改准（改为「严格重叠即显露」）；
      `rg "frontmatter.*selected|selected.*frontmatter"` 零命中
      ——math / mermaid 两处已改准；frontmatter.ts 的旧表述随 2.3 一并删除。
- [x] 2.12 更新 `tests/unit/doc-title-placement.test.ts:172-181` 的 FrontmatterWidget 构造参数；
      确认没有第二处构造点漏改（`rg "new FrontmatterWidget"`）
      ——构造点只剩 livePreview 一处（`new FrontmatterWidget(fm.inner, title)`）。

## 3. 文档与值登记

- [x] 3.1 `docs/specs/design-tokens-v1.md`：在「阴影与 hairline」节追加一行编辑器光标
      组件常量——宽度 2px、1.2s 周期闪烁、三主题同值（含 eink；2026-10-24 改裁后由
      「常亮」改准）；不新增 token 计数（理由：与 1.2–1.6px 强调线宽 / 2px 引用块竖线同族，
      见规则⑧）；注明它是交互指示线、不参与「三处粗 hairline 是装饰性结构线的全部」清单
- [x] 3.2 `docs/specs/editor-caret.md` 与 design §2 逐字对账；条款引用处（proposal / design）
      的相对链接全部可达
      ——`scripts/docs-check.sh` PASS（584 条相对链接全部可达）。
- [x] 3.3 实现期回扫：`docs/backlog.md` 的「mermaid / frontmatter 无键盘进入路径」一条
      按「新 findings 首选提议安排处理」规则处置（提议核销，不在本 change 直接改 backlog，
      由 tower 记账）
      ——本 change 的 C4 兑现了「键盘进入块内源码」；已在完成报告里向 tower 提议核销该条。

## 4. 验证

- [x] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（提案阶段先跑）
      ——42 passed / 0 failed（42 items）。
- [x] 4.2 `bash scripts/docs-check.sh` 通过（含 OpenSpec 相对链接可达 + 归档对账）
      ——PASS（584 条链接 / 24 份 delta / 304 段对账）。
- [x] 4.3 `pnpm test` 全绿（新增 / 更新的 unit）
      ——1221 pass / 0 fail（含新增 15 条）。
- [x] 4.4 `bash scripts/gate.sh quick` 全绿，照抄 `GATE RESULT` 原文行与退出码
      ——`gate.sh visual` 内含 quick：13 门全 PASS；单跑 quick 的原文行是
      `GATE RESULT: 11/11 PASS（SKIP 0）`（首轮 tsc-unit 红，修的是单测 helper 的
      `TransactionSpec` 类型标注，非产品代码；修复后含在 13/13 的复跑里）。
- [x] 4.5 `bash scripts/gate.sh visual` 全绿；变化基线逐张列出并由 Alex 过目（光标宽度 /
      闪烁带来的像素变化 = 基线更新的人肉裁决点；截图冻结 CSS 动画 ⇒ 预期零变化）
      ——`GATE RESULT: 13/13 PASS（SKIP 0）`，exit 0；visual-regression 522s 全绿，
      **零像素基线变化**（没有需要 Alex 过目的基线更新；**未执行任何 `--update`**）。
- [x] 4.6 新增真机场景 `scripts/acceptance/scenarios/228-caret-visibility.md` 并 PASS：
      点击 properties / doc-title / 正文前后光标截图证据（含 light + eink）、
      `editor.unchangedSince` + 文件 `unchangedSince` 的字节断言；光标高度是手感项，
      不在真机断言（AX 不暴露 caret 几何，照实登记）
      ——场景已写、`run.mjs --check` PASS；真机 PASS `228-caret-visibility` 28 断言 0 失败
      （2026-10-24T01:58:27Z，同日 05:26:05Z 复跑同 PASS；证据目录
      `.local/acceptance/2026-10-24/228-caret-visibility/`，历次读数见日期目录
      `.local/acceptance/2026-10-24/run.log`）。
      字节口径按场景设计改用 `file.unchangedSince` + `mtimeUnchangedSince`（本场景可见文本按设计
      会变：围栏进出），理由见场景「判据为什么这样写」；光标观感归 4.9。
- [x] 4.7 只有 frontmatter 的文档 / 非法 YAML 回退 / 512 行 frontmatter 三个边界在场景
      228 或 m647 视觉场景里至少各有一条读数
      ——m647 三条各一条（「只有 frontmatter（无正文行）」/「非法 YAML 回退块」/
      「512 行 frontmatter（上限档）」）。
- [x] 4.8 信息卫生：新增 fixture / 截图 / 文案 MUST NOT 出现真实 vault 内容；改动面做一次
      text 级 grep 清扫（含 `cm-lp-frontmatter-selected`、`selected` 残留）
      ——fixture 全合成（`示例笔记` / `示例` / `已确认` / `正文首行`）；无真实 vault 路径或人名。
- [ ] 4.9 真机 dogfood（Alex 手感项）：`pnpm tauri dev` 起真实 app，打开带 frontmatter 的
      合成文档，逐项过——点击 properties 落点是否大致在点击行、编辑 YAML 期间标题让位是否
      可接受、↑ 进入 YAML 是否自然、2px + 1.2s 闪烁光标在三主题的观感（是否「一眼扫到」）、
      eink 下闪烁的残影 / 刺眼程度
      ——归 Alex（手感项，agent 不代判）。

## 5. 改裁：恢复光标闪烁（2026-10-24，Alex 反馈 #6）

> 原 D2=A（2px 常亮）在 dogfood 后被 Alex 改判：「光标可见性调地有些过头了 —— 现在光标
> 不闪了，也不容易一眼扫到。」D2 改判 **B**：保留 2px 宽度与 `--text` 颜色，恢复约 1.2s
> 周期闪烁（CM 原生 `cm-blink`），三主题同口径（含 eink）。本节记录改裁的实际改动。

- [x] 5.1 `src/editor.ts`：删除 `&.cm-focused > .cm-scroller > .cm-cursorLayer
      { animation: none !important }` 整条覆盖，闪烁交回 CM 原生口径（基础主题 +
      `cursorBlinkRate` facet + 内联相位重启）；注释写清「MUST NOT 用 `!important` 覆盖
      animation」的机制与改裁来由
- [x] 5.2 `tests/visual/scenes/m647-caret-geometry.spec.ts`：G 组断言从 `animationName = none`
      改为 `animationName` ∈ {`cm-blink`, `cm-blink2`}、`animationDuration` = 1.2s、无限循环、
      动画运行中；新增亮 / 灭相位读数（暂停在 0ms → opacity 1，700ms → opacity 0）——
      该断言在 M654 的常亮实现上必红（没有可暂停的动画）
- [x] 5.3 change 文档改准：`proposal.md` 评审记录 + D2 候选表、`design.md` §3.5 / §4.2 / §4.3 /
      §5 / §6 / §8、`specs/ui-design-system/spec.md` 的 requirement 与两个场景、
      `docs/specs/editor-caret.md`、`docs/specs/design-tokens-v1.md`、
      `scripts/acceptance/scenarios/228-caret-visibility.md` 全部去掉「常亮 / 无闪烁」口径
- [x] 5.4 可发现性证据：light / dark / eink 三主题的亮 / 灭相位截图与计算样式读数落
      `.local/reviews/cursor-visibility-oct24/`（真机段挂起，截图证据来自 chromium 视觉套件）
- [x] 5.5 `pnpm test` 与 `bash scripts/gate.sh quick` 全绿；`GATE RESULT` 原文行进完成报告
      ——`GATE RESULT: 11/11 PASS（SKIP 0）`，exit 0；`scripts/visual/run.sh` 全量像素回归
      780 passed / 1 skipped / 0 failed（9.0m，**零像素基线变化**，未执行 `--update`）。
      改裁证据（三主题亮 / 灭相位截图 + 读数）在 `.local/reviews/cursor-visibility-oct24/`。
