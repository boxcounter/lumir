# Tasks: enter-auto-indent

**本 change 目前只到提案**：下面全部为实现清单，除「0. 前置」外**一律未开工**。任务原子化、
可勾选；跑不动的项写「未验」并附原因，MUST NOT 写成已验（REVIEW.md 第 6 条）。

**裁决记录（Alex 节点 1，2026-09-27 原话）**：「# enter-auto-indent 无异议。」——即五项裁决点
（D1 = a 机制落点在编辑器内核 / D2 = a 默认 `true` / D3 = a 围栏内不做语法缩进 / D4 = a 不接管
md 列表续行 / D5 = a 只关新增的两处）全部按**推荐项**落地，`specs/` 增量与本清单不需按备选改写。

**实现期台账（M272，2026-09-27）**：逐条勾选，偏离与未做的条目**保留 `[ ]` 并在行内写明原因**
（REVIEW.md 第 6 条）。两条实现期的结构性偏离如实登记：

1. **命令体单独成模块**（`src/enter-indent.ts`）：原计划写进 `src/editor.ts` 的内联闭包，但
   `tests/unit` 这一层（Node 类型剥离）**无法 import `src/editor.ts`**——它的模块图里有 TypeScript
   参数属性（`livePreview.ts` / `math.ts` / `mermaid.ts`），剥离器直接抛
   `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。判定单独成模块后，3.1 的矩阵跑的是**生产那份判定本身**，
   不是复刻（REVIEW.md 第 8 条）。装配点仍是 `editor.ts` 的 `modeExtensions`，tasks 2.1 / 2.2 的
   落点不变。
2. **配置三态的两侧钉法**：Rust 侧（键解析与整文件回落）由 `config.rs` 的三条新单测钉住；
   TS 侧钉的是**出厂常量同值 + 判定在 true/false 下的行为**（TS 侧没有配置解析层，`src/main.ts`
   只是把 Rust 给的值透传——在那里再写一份解析就是第二处真源）。

## 0. 前置

- [x] 0.1 提案四件套起草并 `validate --all --strict` 通过（本 mission 的产出：
      `proposal.md` / `design.md` / `tasks.md` / `specs/editor-live-preview/spec.md`）
- [x] 0.2 Alex 节点 1（提案评审）通过——**未经本项不得进入实现**（2026-09-27「无异议」，原话记入 `proposal.md` 的裁决记录）

## 1. 配置与装配（`src-tauri/src/config.rs` → bindings → 装配层）

- [x] 1.1 `EditorConfig` 增 `pub auto_indent: bool`（带文档注释：`[editor]` 表第四个布尔键，
      默认 `true`，键缺席 = 出厂 `true`，**不跟随任何别的键**）；`impl Default for EditorConfig`
      给 `true`（与 `line_wrap: true` 同一处）
- [x] 1.2 `RawEditorConfig` 增 `auto_indent: Option<bool>`（`#[serde(default)]`），
      `validate()` 按既有形态 `if let Some(value) = raw.editor.auto_indent` 逐字段覆盖；
      MUST NOT 引入逐字段类型容忍（类型不符走既有整文件回落，与 `line_wrap` 同路）
- [x] 1.3 `config.rs` 单测：键缺失 ⇒ `true`；显式 `true` / 显式 `false` 各一条；
      `"auto_indent": "yes"` ⇒ 整份配置按默认解释 + warning（与 `wrong_type_line_wrap_…`
      同一形态）；`cargo test` 全绿
- [x] 1.4 `src/bindings/EditorConfig.ts` 由 `cargo test` 重导出；按 M249 纪律**先 `git add`
      这些重导出产物、再跑 `quick`**（否则 bindings 漂移门禁报红）
- [x] 1.5 `src/main.ts` 的配置消费点（与 `editor.setWrap` 同一处，`:1383-1393`）把
      `config.editor.auto_indent` 传进编辑器句柄；MUST NOT 为它另开一条装载路径

## 2. `Enter` 键位与自动缩进（`src/editor.ts`）

- [x] 2.1 **md 分支**装一条 `Prec.highest(keymap.of([...]))` 的 `Enter` 键位：`autoIndent`
      为假 ⇒ `return false`（落回浏览器默认）；否则先委派上游
      `insertNewlineContinueMarkup(view)`（返回 `true` 即交回，列表 / 引用续行零改动），
      未命中才 `insertNewlineAndIndent(view)`。注释写清三条依据：上游 `markdownKeymap` 的
      `Prec.high` 优先级、`getContext` 遇 `FencedCode` 返回空、本层返回 `false` 才会轮到他
      （design §1.1 / §2.1）
- [x] 2.2 **code 分支**装同形键位（去掉委派那一步：code 模式没有 md 语法树与上游键位）
- [x] 2.3 `autoIndent` 的传入与 Compartment 归属：与折行 / 模式同一装配点
      （`modeExtensions` / `sessionState` 的既有参数通道），MUST NOT 新增第二条装配路径；
      行为口径 = 启动装载一次（不加运行期开关命令）
- [x] 2.4 `src/keys.ts` 的 M239 段注释校正：删掉 / 改写「CM 侧……任何 `keymap.of` 全仓零命中」
      被读成「编辑器里没有任何 CM keymap」的推论，写明上游 `markdown()` 默认装入了
      `markdownKeymap`（Enter → 续行、Backspace → 删标记）。**只改注释，零行为变化**
- [x] 2.5 复核（不是改）：`src/editor.ts:1486` 的空 keydown 手柄仍保留——它的作用（观察列表
      非空、命令读到 flush 过的 state）不因本 change 而改变

## 3. 单测（`tests/unit/`，零新增依赖）

- [x] 3.1 新文件 `tests/unit/enter-indent.test.ts`（真 `EditorState` + 真 parser，先例 =
      `cell-geometry.test.ts` / `list-indent.test.ts`）：矩阵覆盖 design §4 的实测表——
      有缩进规则的语言（js / json / python 各一）⇒ 语法缩进；无规则的语言（toml / shell）与
      纯文本 ⇒ 沿用当前行行首空白；md 围栏内 ⇒ 沿用当前行缩进；md 正文段落 ⇒ 平换行；
      md 列表 / 引用 ⇒ 委派上游、续写标记
- [x] 3.2 配置口径单测：三态（缺失 / `true` / `false`）与类型不符的整文件回落（与 1.3 的 Rust
      侧断言分别钉住，两侧各一份，MUST NOT 只测一边）
- [x] 3.3 `node tests/unit/run.mjs` 全绿（含既有计数；`scripts/gate.sh quick` 的 `tsc-unit` 同绿）

## 4. chromium 键位链路场景（`tests/visual/scenes/`）

- [x] 4.1 新增 `tests/visual/scenes/m264-enter-auto-indent.spec.ts`：真 CM view + 真实 DOM
      `KeyboardEvent`（`page.keyboard.press("Enter")`），判据落 CM 文档源码（`readDocument`）。
      用例：code 模式语法缩进；md 围栏内沿用缩进；**md 列表续行不被本 change 打断**；
      `auto_indent = false` 回退；`Shift-Enter` 维持裸换行（Non-goals 的不对称）
- [ ] 4.2 场景零像素基线（**已复核**：本 change 的 chromium 场景 `m264-enter-auto-indent.spec.ts` 只做 `readDocument` 文档文本断言、零像素断言；`gate.sh visual` 里该场景 8/8 绿。整页基线变化只来自 `render-link`（bare-url 那一半），与此 change 无关）（只做文档文本断言）；按 AGENTS.md：动过 `tests/visual/scenes/**`
      后本地跑一次 `bash scripts/gate.sh visual`，预期**零基线更新**（`--update` 前须 Alex 过目）

## 5. spec 增量对账

- [x] 5.1 `specs/editor-live-preview/spec.md` 的 ADDED / MODIFIED 与最终实现逐句对账：实现期
      发现口径偏差时**先改 spec 再写代码**，不反向漂移。MODIFIED 那段的豁免面 = `proposal.md`
      「Impact」列的五处对账清单（折行限定词 ×4 + 第四键指向段 ×1）；**这五处之外必须与 living
      spec 逐字一致**，清单本身若在实现期有增删，须同步改 `proposal.md` 的清单（防归档时的静默
      改写）。对账手法：把 living spec 的该 requirement 与增量的 MODIFIED 段逐行 `diff`，差异条数
      与清单条数一致才算过——`proposal.md` 的清单就是按这个 `diff` 实测写出来的

## 6. 真机验收（agent 执行，不进 CI；随实现同 PR）

编号按 tower registry：**59 = enter-auto-indent**。草案全文见 `design.md` §7，落地时按 fixture
实际行号核对 `ctrl+n` 次数。

**编号声明（按 M230/M234 起的编号协议，2026-09-27 登记）**：本 change 取 **59**
（`scripts/acceptance/scenarios/59-enter-auto-indent.md`）。依据：HANDOFF 的占用表记「M264 起从
**59** 派」；在飞 change 已登记 51 = M257、52 = M258、53 = M259、54 = M260、55 = M267、
56 = M261、57 = M262、58 = M263（各自的 tasks.md / 广播）。**实现期动工前再核一次目录与在飞
change 的编号声明**（对冲条款：本表是登记时的快照，不是终局）；若 59 已被他人取用，按当时最大
编号顺延并在本节留痕。

**实现期核验留痕（M272，2026-09-27，维持 59）**：`ls scripts/acceptance/scenarios/` 实测最大编号
**53**；跨全部分支 `git log --all --name-only -- scripts/acceptance/scenarios/` 扫描**没有任何 54+
文件被创建过**；**59 归本 change（M264 提案，tower 简报指派）**，与本表登记的快照一致。同批的
`bare-url-cmd-click` 取 54（其自身 tasks.md §6 声明，三层核对同样无冲突）。HANDOFF.md:14 的
「59=M264✓」正是本 change。**无冲突，未顺延。**

- [x] 6.1 套件侧扩展两处：`lib/app.mjs` 的 `writeConfig()` 多认 `autoIndent`；
      `lib/execute.mjs` 的 `configWrite` case 加 `autoIndent`（缺省**沿用当前值**，与
      `theme` / `contentWidth` 同形）
- [x] 6.2 新增五个 fixture：`enter-indent.js` / `enter-indent.toml` / `enter-indent.md` /
      `enter-indent-list.md` / `enter-indent-fence.md`（内容要点见 `design.md` §7 的表）
- [x] 6.3 新增 `scripts/acceptance/scenarios/59-enter-auto-indent.md`（草案照抄后按实际行号
      校准）：六组用例——code 语法缩进 / toml 沿用当前行 / md 段落平换行 / md 列表续行不变 /
      md 围栏内沿用缩进且不续列表标记 / `auto_indent = false` 回退（6a 列表仍续行、6b code 回退）
- [ ] 6.4 `node scripts/acceptance/run.mjs --check 59`（静态校验绿；真机 **PASS**（29 断言 / 95.2s），与场景 54 同一次运行 2/2，证据 `test-results/m272/acceptance-final/`） 静态校验绿；真机跑通后证据落
      `test-results/acceptance/`（git 外）。**纪律**：`Enter` 是 chord 类盲发注入 ⇒ 负向断言
      一律配 `editor.changedSince` / `file.changedSince` 正观测（design §4.1 与 §7），红了先按丢键复跑一次
- [x] 6.5 `scripts/acceptance/README.md` 的 `configWrite` 行补上 `autoIndent` 这个键名

## 7. 验证

- [x] 7.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 7.2 `bash scripts/gate.sh quick` 全绿（**10/10 PASS**，日志 `test-results/m272/gate-visual.log` 头部；落点按本 mission 统一在 `test-results/m272/` 而非 `m264/`——两个 change 合并在同一 mission 实现）
- [ ] 7.3 `bash scripts/gate.sh visual` 本地全绿（**11/12**：唯一红项是 `render-link` 的整页基线，属 bare-url 那一半的预期变化、待 Alex 过目后 `--update`；本 change 的 chromium 场景与其余 494 条断言全绿）（本 change 动过 `src/editor.ts` 与
      `tests/visual/scenes/**`）——预期零基线更新；若出现整页像素差异，按缺陷处理
- [ ] 7.4 节点 2（归档评审）前的收口（本清单除上面四条「待裁决/待归档」外全勾；spec 增量与实现逐条对账见 5.1 的 5 处 diff；`proposal.md` 的裁决记录已补 Alex 原话——见文末台账）：本清单全勾或标注放弃原因；spec 增量与实现一致；
      `proposal.md` 的裁决记录已补 Alex 原话

## 实现台账（M272，2026-09-27）——证据指针

| 项 | 读数 | 证据（可 `ls`） |
|---|---|---|
| Rust 配置（第四个键三态 + 类型不符整文件回落） | `config.rs` 新增 3 条单测；`cargo test` 174 passed / 0 failed | `test-results/m272/cargo-test2.log` |
| bindings 重导出 | `src/bindings/EditorConfig.ts` 含 `auto_indent: boolean`（ts-rs 生成）；`bindings-drift` PASS | `src/bindings/EditorConfig.ts` |
| 判定单测（矩阵 + 三态投影） | `tests/unit/enter-indent.test.ts` 17 组用例（6 门有缩进规则语言 / 4 门无规则 / md 围栏与缩进块 / md 段落 / md 列表与引用委派 / 只读 / 关配置 / 出厂常量） | `node tests/unit/run.mjs` → 424 passed |
| chromium 键位链路 | `m264-enter-auto-indent.spec.ts` 8 用例全绿（含 `Shift-Enter` 维持裸换行、关配置回退、列表续行不被本 change 打断、一次撤销一步） | `test-results/m272/gate-visual.log`（该场景 8 passed） |
| 真机场景 59 | **PASS**（29 断言 / 95.2s） | `test-results/m272/acceptance-final/ 59-enter-auto-indent/{steps.md,shots}` |
| spec 增量对账（tasks 5.1） | living spec 与 delta 的 diff **恰好 5 个 hunk**，与 proposal Impact 的五处对账清单一一对应 | `test-results/m272/spec-delta-reconcile.diff` |
| 文档 | `docs/specs/config-reference.md` 补 `editor.auto_indent` 行 + 分工段 + 整文件回落清单；`src/keys.ts` 的 M239 段更正条 | 本 mission 的提交清单 |

### Alex 节点 1 裁决原话（2026-09-27）

> 「# enter-auto-indent 无异议。」

五项裁决点（D1 机制落点 / D2 默认 true / D3 围栏内不做语法缩进 / D4 不接管 md 列表续行 /
D5 只关新增的两处）全部按**推荐项**实现，delta 与任务清单未按备选改写。原话同时记入
`proposal.md` 的「裁决记录」节。
