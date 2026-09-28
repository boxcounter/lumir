# Tasks: goto-line-command

> **状态**：本 mission（M261）只交付提案——实现期任务全部未勾选。**Alex 节点 1 裁决已于 2026-09-27 落地**（D1 / D2 / D3 按推荐项，D4 改判为「md 文档不再豁免行号 gutter」，原话见 [proposal.md](proposal.md) 的裁决节），delta / design / 本文件已按裁决同批修订（M271）。**Alex 二次改判已于 2026-09-28 落地**（D4 再改为 `[ui] markdown_line_numbers` 可配置三档：`on-demand`（默认）/ `always` / `off`，只管 md；code 恒常显、不进配置；原话见 [proposal.md](proposal.md) 的二次改判节）——M281 已在实现中途转向，见 §8。§0 是提案期已完成的动作。

## 0. 提案期（本 mission 已交付）

- [x] 0.1 起草 `openspec/changes/goto-line-command/` 四件套（proposal / design / tasks / `specs/keymap-commands/spec.md` 增量），`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 0.2 键位三条独立来源核对（表内 / 原生菜单 accelerator / macOS 系统级）逐条落地到 [design.md](design.md) §2.2；token 形态取 `Alt-KeyG`（含 Alt 的组合按物理键判定）
- [x] 0.3 落点原语核对：`revealLine`（`src/editor.ts:2019`）已具备 1-based 钳制 + 行首落点 + `y:"center"` 居中，本 change 复用它、不另写算式
- [x] 0.4 场景编号声明（§6）并在 tower 广播登记
- [x] 0.5 节点 1 裁决落地（2026-09-27，M271 同批修订）：D1 / D2 / D3 按推荐项；**D4 改判**为「md 文档不再豁免行号 gutter」，delta 的可见面口径与新增 scenario、[design.md](design.md) §5、本文件 2.9–2.14 与末表的 D4 行、[proposal.md](proposal.md) 的裁决节与「边界与已知限制」同批更新；`npx --yes @fission-ai/openspec@1.12.0 validate --strict` 仍绿
- [x] 0.6 **二次改判的提案修订**（2026-09-28，M281 转向的第一步，先 amend 不改代码）：[proposal.md](proposal.md) 的 Why §二 / What Changes 第 5 条 / 裁决节（追加二次改判节：原话逐字 + 三档落定表）/ D4 行 / Non-goals / Impact / 边界第 6 条；[design.md](design.md) §1.4 / §5（三档口径 + 配置链路 + compartment 重配方案 + 开关不跳动的几何口径）/ §6 / §7 / §8；delta 的常显句改瞬态句 + 新增「md 模式的行号 gutter 三档」与「档位由配置装载」两条 scenario + 已知边界 ⑥ 改写；本文件 2.9–2.14、4.3、5.3、5.4、6.1 同步改写。`validate --all --strict` 复跑绿

## 1. 键位与命令（`src/keys.ts` / `src/editor.ts`）

- [x] 1.1 `src/keys.ts`：`EDITOR_CORE_COMMAND_IDS`（`:135`）加 `editor.goto-line`（属内核组 → 作用域机械派生为 `editor`）
- [x] 1.2 `src/keys.ts`：`KEY_BINDINGS` 加 `{ key: "Alt-KeyG", command: "editor.goto-line", scope: "editor", doc }`——`doc` 写明来由（M-g 的单段近亲、与 `Alt-KeyV/D/B/F` 同族）与三条来源核对结论；**不得**登记进 `KEYLESS_COMMAND_IDS`
  **验收口径**：`tests/unit/keys.test.ts` 的表不变量全绿（无重复 token、每条绑定有实现、命令不在孤儿清单里）——实测 464/464 通过，另补两条 goto-line 专测（token 形态 / 重绑解绑）
- [x] 1.3 `src/editor.ts`：`commands` 记录接 `editor.goto-line`——打开输入条（经注入的 opener）；确认回调 `jumpToLine` 先 `view.focus()` 再落点。**实现期的一处结构调整（如实记账）**：落点/滚动算式从 `revealLine` 就地抽成模块内私有 `revealLineAt(line)`，`revealLine`（wikilink 锚点跳转）与 `jumpToLine` 共用同一份——MUST NOT 复制算式的要求因此是结构性成立的（不是「两处各写一遍但看起来一样」）
- [x] 1.4 `src/editor.ts`：新增注入口 `setGotoLinePrompt(prompt)`（形态照 `setTableFullscreen` / `refreshPreview`），签名只认 `{ open(defaultLine, totalLines) }`；**不**派发 `previewRefresh`——与那几个注入点的差别写进了实现处注释（这个口子在命令执行时才被读，不参与装饰构建）
- [x] 1.5 确认命令不产生任何文档变更：命令体不 dispatch 任何事务；`revealLineAt` 只 dispatch 选区与 `scrollIntoView` effect。单测（`tests/unit/goto-line.test.ts`）+ chromium 场景（跳转前后文档文本逐字节相同）+ 真机场景 56 的 `unchangedSince` / `mtimeUnchangedSince` 三处一起判

## 2. 输入条与 md 行号 gutter（`src/goto-line.ts` 新增 / `src/main.ts` / `src/style.css` / `src/editor.ts` / `src/preview/theme.ts` / `src-tauri/src/config.rs`）

- [x] 2.1 `src/goto-line.ts` 纯逻辑层：`resolveGotoLine(raw, fallbackLine, totalLines)`（解析 + `[1, totalLines]` 钳制；空串 → `fallbackLine`），零 DOM
- [x] 2.2 `src/goto-line.ts` DOM 适配层：`createGotoLinePrompt({ mount, onJump, restoreFocus })` → `{ open(defaultLine, totalLines), close(restoreFocus?), isOpen() }`；浮层 `position: absolute; bottom: 100%` 挂 `shell.modeline`（与 `.lumir-toc` 同挂点同定位）；`hidden` 常态
- [x] 2.3 输入框：预填当前行号并全选（`focus()` + `select()`）、只接受数字字符（keydown 挡可打印非数字 + `beforeinput` 挡非数字插入 + `input` 就地清洗三处）
- [x] 2.4 就地键消费：Enter 确认、Escape / `⌃G` 取消、**`⌥G` 无操作且不把 `©` 打进输入框**（token 走 `keyToken()`，形态的单一来源是 `src/keys.ts`；`preventDefault` 同时让 window 上的分发器让路，见 `Keymap.handle` 的 `defaultPrevented` 早退）
- [x] 2.5 `focusout` 到浮层之外即收起且**不跳转、不抢焦点**（`close(false)`）；`close()` 默认把焦点交还编辑器（装配层注入 `focusPreservingReadingPosition`，MUST NOT 裸 `view.focus()`）
- [x] 2.6 `src/main.ts`：构造浮层（`mount: shell.modeline`）并注入 editor 的 opener；**前台会话切换时收起输入条且不跳转**（落在唯一同步点 `syncActiveDocument`，切标签 / 外部打开请求置换两条路径都汇到这里）
- [x] 2.7 `src/style.css`：`.lumir-goto` / `.lumir-goto-input` / `.lumir-goto-hint`，tokens 复用（`--preview-bg` / `--border` / `--r10` / `--shadow-raise` / `--sp-*` / `--fs-*`），`[hidden]` 分支与 `.lumir-toc[hidden]` 同款；零新色值（eink 的聚焦强调并入 `.lumir-toc-input` 那条既有规则，不另起一条）
- [x] 2.8 键位面板核对：命令归入「翻屏」组（`src/bindings-panel.ts` 的 `BINDING_GROUPS`）。**实测与提案的假设不同**：面板行数不是「EDITOR_COMMAND_IDS 自动派生」——分组表是显式列举，漏登记会落进末尾兜底「其他」组，由 `tests/unit/bindings-panel.test.ts` 的「零兜底组」对账判红（我确实先红后补）；未动任何硬编码行数的场景（`m133-describe-bindings` 的分组标题断言不受影响）
- [ ] 2.9 `src/editor.ts`：md 分支把 `lineNumbers()` 与 `highlightActiveLineGutter()` 装进**独立的 `mdGutterCompartment`**（**不**装 `highlightActiveLine`）——在场由 `mdGutterExtensions()` 按三档 + 输入条状态决定（`on-demand`：默认空，输入条打开时装、收起时卸；`always`：恒装；`off`：恒空）；装 / 卸走 `reconfigureMdGutter()`（照 `reconfigureWrap()` 的前台 dispatch / 后台换代 state 分流），MUST NOT 走 `modeCompartment`（那会连带重建 live preview）。**code 分支不动**（恒常显、不进配置、不进 compartment）。compartment 实例在扩展树里 MUST NOT 出现两次（CM 的 `Configuration.resolve` 会抛 `Duplicate use of compartment`）
- [ ] 2.10 `src/editor.ts` + `src/goto-line.ts` + `src/main.ts`：gutter 的装 / 卸触发源是输入条的开 / 关——浮层在 `open()` 与三条收起路径（`confirm` 的后继 / `close` / `focusout`）处通知装配层，装配层转成 `editor.setGotoLineGutterVisible(on)`；`always` / `off` 档下该标志被忽略。chromium 层的可观测判据是「DOM 里 `.cm-lineNumbers` 在场 / 不在场」
- [ ] 2.11 `src/preview/theme.ts`：md 的 gutter 定位与配色（`".cm-scroller > .cm-gutters"` + `DOC_TITLE_TOP_CLASS` 变体）。**实现期选择（如实记账）**：选择器带 `.cm-scroller >` 锚点是为了用更高的特异性**确定性**压过 `src/editor.ts` 的 base 规则（两条都是 CM theme，生成的 CSS 先后顺序不是可依赖的契约）；md 侧去掉底色与右缘、`justifySelf: end` 贴正文列左缘；有 doc-title 落点时 gridRow 挪到 2（与正文同行），base 规则的 row 1 不再生效
- [ ] 2.12 **配置链路（照 `[ui] theme` 先例，本 change 唯一的 Rust 侧改动面）**：`src-tauri/src/config.rs` 加 `MarkdownLineNumbers` 枚举（`OnDemand` / `Always` / `Off`，serde `lowercase`，`#[ts(export)]`）+ `UiConfig.markdown_line_numbers` + `RawUiConfig` 的 `Option<String>` + `validate()` 的三档匹配（缺字段回落 `OnDemand` 不告警、档外值回落 + 人话 warning）+ 单测三条（三档解析 / 档外值 / 类型不符整文件回落）；`src/bindings/**` 由 ts-rs 重导出（`cargo test` 触发，产物先 `git add`）；`docs/specs/config-reference.md` §1.3 加一行（含「装载时读一次、无运行期回写」）。`src/main.ts` 装载路径读 `snapshot.config.ui.markdown_line_numbers` 并调 `editor.setMarkdownLineNumbers(tier)`（在 `makeSession` 之前，避免首帧闪烁）
- [ ] 2.13 正文列居中的守恒 + **开关瞬间不跳动**：`tests/visual/scenes/m281-goto-line.spec.ts` 的实测几何断言——1200px：两侧空余等分 <1px、gutter 右缘 = 正文列左缘、行号文字左缘不出窗；640px 复测同一组；**同一文档在 gutter 不在场 / 在场两态下 `.cm-content` 的 left / right / width 逐值相同**（宽窗与窄窗各一次）
- [ ] 2.14 行号纵向对准（**在 gutter 在场的前提下**）：断言覆盖标题行 / 表格 widget 的首行与数据行（widget 内的真行）/ 表格 widget 之后那一段 / 图片行（`|行号顶 - 行块顶| ≤ 1px`）
  **已知边界（MUST NOT 当成 gutter 的缺陷回头修，见 design §1.4 之外的实测补充）**：图片这一类**行内** replace widget 所在行之后的行号低约一个文字盒（实测 18px）——根因是 CM 的高度表把「widget 边界盒 + 该行文字盒」相加，而 DOM 排进同一个行盒；**改动前的构建上逐值相同**（`git stash push -- src/` 反证：无 gutter 时 CM 的行块高度同样多 18px、`contentHeight` 同样多 18px），故非本 change 引入，已落 `docs/backlog.md` 与 finding。场景 fixture 因此把图片放在断言行之外，不在「必须对齐」的判据里掺入这一差值
- [ ] 2.15 核对既有断言与判据（逐处，改法见各文件注释）——**新默认档下 md 没有 gutter，凡以「md 有 / 无行号」当判据的原断言按「能回到更强原判据则回，回不去的写原因」处置（判别力优先）**：
  - `tests/visual/scenes/markdown-parser.spec.ts:112`：md 的 `.cm-lineNumbers` 计数 0 的原判据按新默认重核（默认档下重新成立则回；该场景若另有 `always` 档用例则写清）
  - `tests/visual/scenes/end-marker.spec.ts`：`readMarkerState` 的模式判据 MUST NOT 依赖 `markdown_line_numbers` 的取值（默认档下 `.cm-lineNumbers` 不在场、`always` 档下在场），取与档位无关的 live preview 内容级判据；同文件 code 模式用例补「无 live preview class」并改注释
  - `tests/visual/scenes/m130-text-open-trap.spec.ts:84-85`：判据与用例名按同一口径核（不依赖档位）
  - `tests/visual/scenes/doc-title.spec.ts:134`：`scroller.firstElementChild === titleOuter` 的原判据按新默认重核（默认档下 gutter 不在场 ⇒ 原判据可能直接成立）
  - `src/editor.ts` 的 baseTheme 注释（gutter 两模式共用落点 + md 的真源在 theme.ts）与阅读栏宽注释（md 模板不为 gutter 改写）
  - `src/scroll-position.ts:42` 与 `src/scroll-position-view.ts:56` 的注释：md 的 gutter 只在**在场时**（`always` 档，或 `on-demand` 档输入条打开期间）让 `getScrollMargins().left` 非零——注释按两态写
  - 另核未改但逐条确认仍成立的：`readiness.spec.ts:92`、`m120-code-highlight.spec.ts:51`、`end-marker.spec.ts:282` 的 `.cm-gutters` / `.cm-lineNumbers` 断言（都在 code 模式上下文里）
- [ ] 2.16 已知边界（MUST NOT 当成缺陷回头修，且 MUST NOT 为它新增 `lineNumberWidgetMarker` 提供者）：块级替换覆盖的源行缺号——frontmatter 区块恒缺（实测：`fm.md` 的 1–4 行无行号），块级数学 / mermaid 在块回退为源码时补上。**实测补充（与提案的表述不同，已核对）**：表格不是 block replace widget——它的 source 行仍是真行（渲染成 grid 行），因此**有**行号；场景把这一点也钉住了（表格首行与数据行都参与纵向对准断言）

## 3. 文案（`文案-Copy.md`）

- [x] 3.1 新增输入条文案条目（读屏名 / 占位 / `共 {M} 行` 提示模板）。**动工前核到的末位与提案不同（如实记账）**：deck 现末位是 **D156**（M277 一批：D153–D155 块级复制、D156 代码块全屏），而 **D152 是 2026-09-27 tower 裁决留给本 change 的保留号**（`docs/backlog.md` 的「文案 deck D152 编号碰撞」节）。处置：读屏名取 D152（用掉保留号），另两条按 deck 的「新增条目只追加」规则接在当时末位之后 ⇒ **D157 / D158**；M267（`ui-language-i18n`）的重基起点随之从「预计 D157 起」后移到 **D159 起**，已写进 deck 的编号沿革段
- [x] 3.2 文案常量落在 `src/goto-line.ts`（`GOTO_LINE_LABEL` / `GOTO_LINE_PLACEHOLDER` / `gotoLineTotalText`），「能力在哪文案就在哪」；`tests/unit/goto-line.test.ts` 按 deck 逐字断言；chromium 场景与真机场景都从同一份常量取（不手抄字面量）
- [x] 3.3 **不新增**任何 toast / 提示文案：越界钳制（D3 推荐项）静默，取消静默——本批零 toast，输入条内的 `共 M 行` 是既有的三条文案之一

## 4. 单元与视觉测试

- [x] 4.1 `tests/unit/goto-line.test.ts`：`resolveGotoLine` 的输入矩阵（`""` / `"1"` / `"0"` / 越界 / 前导零 / 超长数字串 / 非数字在纯函数层的定义 / 预填值本身也钳制 / 总行数非正数）+ 三条文案常量逐字
- [x] 4.2 `tests/unit/keys.test.ts`：既有表不变量自动纳入 `Alt-KeyG`（实测零红，464/464 通过）；补两条——「⌥G 的 token 形态（含 Alt 按物理键）+ 作用域 editor + 不在默认不绑键清单」与「`[keys]` 重绑 `Ctrl-j` / 解绑 `Alt-KeyG`，其余默认绑定逐条不变」
- [ ] 4.3 新增视觉场景（chromium 层）：`tests/visual/scenes/m281-goto-line.spec.ts`（输入条打开态 / 越界与取消与再按同键 / `[keys]` 重绑与切会话收起 / **md gutter 的三档在场时机 + 结构与几何 + 开关不跳动** / frontmatter 缺号边界 / code 模式形态不变 / 整页基线两条）
  **口径随二次改判更新**：整页基线**不再是人肉裁决点**——默认 `on-demand` 档下 md 打开时没有行号 ⇒ 既有整页基线**逐张不变**，那 22 张重拍作废。硬判据改为「`tests/visual/baselines` 对 master **零 diff**（除本 change 自己新增的场景基线）」；本 change 新增的两张（`m281-always`（`always` 档常驻形态）/ `m281-goto-prompt`（`on-demand` 档输入条打开态））随实现重拍，形态变化写进 review-request
- [x] 4.4 核对键位面板相关视觉场景与 `edit` 分组的既有断言：`m133-describe-bindings.spec.ts` 按分组标题与「每条命令一行」的口径断言，新增一条命令后逐张实跑通过（不硬编码行数）；整页基线里含键位面板的那张（`describe-bindings-panel.png`）归入 4.3 的过目清单

## 5. 门禁

- [x] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（随 `gate.sh quick` 的 openspec-validate 门禁一并跑，绿）
- [x] 5.2 `bash scripts/gate.sh quick` 全绿：**GATE RESULT: 10/10 PASS**（cargo-fmt / cargo-clippy / cargo-test / bindings-drift / tsc-root / tsc-visual / tsc-unit / unit-tests / docs-check / openspec-validate）
- [ ] 5.3 `LUMIR_VISUAL_PORT=4345 bash scripts/gate.sh visual`：**12/12 PASS 且 `tests/visual/baselines` 对 master 零 diff**（除本 change 新增的场景基线）——这是二次改判后的新口径硬判据（默认 `on-demand` 档下 md 打开时无行号 ⇒ 既有 52 张基线应逐字节不变）。若出现非新增基线的 diff，修实现或按逐张归因走人肉过目，MUST NOT 静默 `--update`
- [ ] 5.4 `git diff --check` 通过；改动文件集合与 [proposal.md](proposal.md) 的 Impact 清单一致——**实现期的三处偏差（均已记账）**：① 键位面板分组表 `src/bindings-panel.ts` 需要显式加一条归组（proposal 的 Impact 只写了「键位面板零改动」，实测漏归组会让 `tests/unit/bindings-panel.test.ts` 判红）；② 既有视觉断言必须同批核（proposal 的 Impact 原本只点了两处，实际还涉及 `doc-title.spec.ts`）；③ **二次改判扩了 scope**：`src-tauri/**`（`[ui] markdown_line_numbers` 的解析 / 校验 / 回落）与 `docs/specs/config-reference.md`（新键条目）、`src/bindings/**`（ts-rs 重导出）——scope 已由 tower 扩宽到这三处，非静默扩 scope


## 6. 真机验收场景（WKWebView，`scripts/acceptance/`；随实现同 PR）

- [ ] 6.1 新增 `scripts/acceptance/scenarios/56-goto-line.md` + fixture（`fixtures/goto-line-long.md`，48 行正文、五个 `## 段N` 小标题、第 39 行 `JUMP-TARGET-39`、第 48 行 `LAST-LINE-MARKER`；`doc.lines` = 49）
  **二次改判的判据更新**：步 1（打开文档后）的断言从「md 常驻行号 gutter 在场」改为——**打开时 gutter 不在场；按 `⌥G` 打开输入条后 gutter 在场（行号 = 源文档逻辑行号）；输入条收起后 gutter 消失**（`on-demand` 默认档的三态）
  **静态校验**：`node scripts/acceptance/run.mjs --check` 通过（CHECK PASS 56-goto-line）
  **真机**：`node scripts/acceptance/run.mjs 56` **PASS**（证据落主 checkout `test-results/acceptance/<date>/56-goto-line/`）
  **设计期记录的两条实现期结论（如实记账，首轮各踩一次）**：
  - 套件 `type` 动作用真实点击聚焦编辑器，会把输入条 focusout 收起 ⇒ 改走 `do: keys`（逐位注入 + 按 focused 节点回读 `.value`），**MUST NOT** 用 `set_value` 伪造键盘语义（未用）
  - 输入条的 `aria-label` 在真机 AX 里**读不到**（实测节点是 `AXTextField = "1"`，没有 label/help）⇒ 真机侧判「框在场 + 值 = 光标行号 + 焦点在它身上」，读屏名的断言在 chromium 层
  - 首轮另有两处判据设计错误（都是**通道给不了那个判据**，非产品缺陷）：① 「目标行在第一屏」类断言不成立——`AXTextArea.value` 是**整篇文档**（不是只有视口内的行）；② modeline 指示段的文本在真机快照里读不到（`truncated: true`）。落点判据因此改成**读输入条的预填值**（预填 = 打开时的光标行号，步 4 先证明它跟着光标走），并把 README 那条被证伪的已知边界就地更正
- [ ] 6.2 反向验证（二次改判后重跑）：临时摘掉 `KEY_BINDINGS` 里的 `Alt-KeyG` 绑定（`src/keys.ts` 备份后还原，`git diff --stat src/keys.ts` 核实只多 M281 的新增行）→ 同一场景应在「输入条在场 / gutter 随输入条在场 / 共 49 行 / 焦点在输入框」这几条正向锚点上红（负向断言照旧绿——「负向断言必须有同通道正观测」的现场）
  红灯证据落主 checkout `test-results/m281/acceptance-56-reverse-fail/`（PASS 证据另存 `.../acceptance-56-pass/`，标准位置 `test-results/acceptance/<date>/56-goto-line/`）
- [x] 6.3 性能读数：**chromium 层**量了一次 1.1MB 文档跳末行——keydown → 第 2 帧 **174.2ms**、→ 第 6 帧 **207.5ms**（同链路 49 行文档 ≈ 11–18ms / 44–51ms）；落点在滚动容器内。属一次性视口重建开销、**不是秒级卡顿**，未落 finding、不设阈值。落档 `test-results/m281/perf/README.md`（含量具与复现命令）
  **真机侧拿不到可当判据的读数（如实记账）**：1MB 文档下 WKWebView 的 AX 快照会截断（实测 value 只给文档中段窗口、`truncated: true`，节点级断言会假过），故 1MB 规模的功能面记「未验」，不硬凑数字；md 长文档的滚动帧未观察到异常（真机场景全程无卡顿、无超时）


### 编号声明

真机场景取 **56**。依据（2026-09-27 实测）：本 mission 的 base 分支上 `scripts/acceptance/scenarios/` 现有最大编号 **50**（`50-tab-context-menu.md`）；master 上另有 **52**（`52-dir-rename-expand.md`，M258 已合并）；**51 / 53 归在飞的 M257 / M259**，**54 归 M260**（change `bare-url-cmd-click`，其 tasks.md §6 已声明该号，提案已合并进 master），**55 归 M267**（ui-language-i18n 提案预留）。因此本 change 取 **56**。实现期动工前须按既定纪律（`openspec/changes/archive/2026-09-27-list-tab-indent/tasks.md` §6 的口径）再核一次目录与在飞 change 的编号声明，不盲取。

## 7. 收口与归档跟踪

- [x] 7.1 实现期若 spec 增量与 proposal 的意图出现变更：停下、更新 proposal 并重走节点 1，不静默扩 scope——**未发生**（实现严格按修订后的 delta 与 tasks）。**二次改判（2026-09-28）走的是这条路**：意图变更由 Alex 直接给出，先 amend 提案（§0.6）再改实现，scope 由 tower 扩宽到 `src-tauri/**` 与 `docs/specs/config-reference.md`；上面各条记的三处「与提案表述不同」都是**实现期实测到的既有事实**（键位面板分组是显式表、表格 source 行有行号、图片行的高度表差），不是意图变更
- [ ] 7.2 视觉基线的失配逐张归因（改动的元素在哪些整页基线里出现过、时间戳是否随本次更新），零静默 `--update`——**新默认档下预期零失配**：`tests/visual/baselines` 对 master 逐字节核对（52 张全等）留档；新增的场景基线两张随手核对
- [x] 7.3 实现 PR 合并时在 `docs/backlog.md` 的「待 Alex 裁决」节落一条归档待办（批次收尾 checklist 的强制项）——已落第 40 条（`goto-line-command` 的归档待办，含 delta 对账要点与两处边界）；二次改判后该条的要点按新口径更新
- [ ] 7.4 归档评审（节点 2）：tasks 全勾或标注放弃原因、spec 增量与实现一致后 `npx --yes @fission-ai/openspec@1.12.0 archive goto-line-command --yes`

## 8. 转向记录（2026-09-28 二次改判）

- **为什么要转**：M281 的第一轮实现把 md 的 gutter 做成**常驻**（按 2026-09-27 裁决），并为此准备了一批整页基线重拍（22 张）等 Alex 过目——重拍轮进行中被 tower 叫停，Alex 二次改判为可配置三档（`on-demand` 默认）。
- **转向的执行顺序**（严格按此）：① 先 amend 提案四件套（§0.6）→ ② 实现转向（compartment + 配置链路）→ ③ 几何不变量（开关不跳动）→ ④ 既有断言回修（判别力优先）→ ⑤ 门禁（`gate.sh visual` 必须 12/12 且基线对 master 零 diff）→ ⑥ 收口（对账 + review-request）。
- **作废的动作**：为常驻形态准备的 22 张整页基线重拍全部作废（默认档下既有基线继续有效）；第一轮 `--update` 的中途产物已 `git checkout --` 还原并与 master 逐字节核对（52/52 相等）。
- **保留的动作**：§1（键位与命令）、§3（文案）、§4.1/4.2（单测）、§6 的 fixture / 步序骨架（只改步 1 的判据）都不受转向影响。

## 裁决改写指引（D1–D4 任一项改判备选时照此执行）

| 裁决点 | 取备选时的改写动作 |
|---|---|
| D1 = `⌘L` | delta：默认键位与 token 改为 `Cmd-l`；三条来源核对重做一遍（⌘ 系需另核 muda 预置与 macOS 系统级）；design §2 改写；tasks 1.2 / 6.1 的注入键改 `cmd+l` |
| D1 = 真 chord `M-g g` | 前置新增一个 change（`[keys]` 的 chord 支持 + 面板渲染 + Rust 侧形态校验），本 change 降为它的依赖；tasks 1.2 写两段键位、6.1 的注入改 `alt+g, alt+g` |
| D2 = modeline 内联 | delta：输入条形态改写为「modeline 左段内联输入」并补「modeline 只读派生口径为瞬态输入态开口」的记述；新增 `ui-design-system` 的 MODIFIED requirement；tasks 2.2/2.5/2.7 改写、4.3 补窄窗（`<640px`）退让不被打断的断言；整页基线涉及 modeline 的全部重拍 |
| D3 = 越界拒绝 | delta：钳制那句改为「越界保留输入条 + 提示并要求改正」；新增一条提示文案（deck 追加）；tasks 3.3 改为「新增越界提示文案」、6.1 步 3 的断言从「落到末行」变为「输入条仍在、文档未动」 |
| D4 = **md 行号 gutter 可配置三档**（2026-09-27 改判 + **2026-09-28 二次改判**，已落地） | **二次修订已完成**：delta 的可见面口径（常显句 → 三档句）+ 「md 模式的行号 gutter 三档」与「档位由配置装载」两条 scenario + 已知边界 ⑤⑥；[design.md](design.md) §1.4 / §5（三档口径 + 配置链路 + compartment 重配 + 开关不跳动）/ §6 / §7 / §8；tasks 2.9–2.16、4.3、5.3、5.4、6.1 步 1、6.2、7.2；[proposal.md](proposal.md) 的二次改判节、What Changes 第 5 条、D4 行、Non-goals、Impact、边界第 2 与第 6 条；scope 扩 `src-tauri/**` 与 `docs/specs/config-reference.md` |
| D4 再改为「md 恒不显示行号」 | delta：三档收成一档（`off` 的语义成为唯一形态），requirement 与已知边界同步；proposal 的 D4 行与三档表重写；实现侧 `MarkdownLineNumbers` 枚举与配置键删除（或恒回落到 `off`） |
| D4 再改为「modeline 常驻行号段」 | 新增 `ui-design-system` 的 MODIFIED requirement（右段加光标行号段 + 窄窗退让顺序）；tasks 新增 modeline 显示位实现与全部整页基线重拍；proposal 的「边界与已知限制」第 2 条删除 |
| D4 再改为「运行期可切换」 | 新增 `[ui]` 回写通道与一个命令 / 键位 / UI 落点（照 `ui.theme` 的 modeline 主题钮先例），delta 的「装载时读一次」句改写为 live 切换；tasks 2.12 补回写链路、2.10 补运行期触发源 |
