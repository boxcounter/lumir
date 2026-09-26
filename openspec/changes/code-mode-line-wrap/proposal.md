# Proposal: code 模式折行口径分离——md 折行、code 不折行（覆盖键 + 出厂分叉）

- Change ID: code-mode-line-wrap
- 日期: 2026-09-27
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 使用反馈原话（2026-09-26，逐字）：

> 「现在默认正文折行。但我的实际使用需求是分场景的，比如对于 markdown 我希望自动折行，但对于代码，我希望默认不折行。但这种习惯比较个人，似乎不适合直接作为硬规则写在代码里。」

**一、现状是「两个模式共用一个折行键」，而 code 模式的代价被 M231 放大成日常问题。**
`editor.line_wrap`（默认 `true`）是**文件级**折行开关，它对 md 与 code 两种模式同样生效
（`src/preview/theme.ts` 的 `wrapSpec` 只把 `mode` 用于代码块那一层，正文行恒读 `line_wrap`）。
M180（change line-wrap-options）把「代码块」从折行里摘出来时，md 里的围栏代码块有了自己的口径
（`code_block_wrap`，默认不折）；但**整个非 md 文件打开后的 code 模式正文行**不在那次的作用面内
（当时的定位是「只读 code 模式的正文行不算代码块」，跟随 `line_wrap`）。M231（change
editable-non-md-files）把非 md 文件变成一等可编辑表面后，用户直接打开 `.ts` / `.json` / `.py` 文件
成为常规动作——这些文件的长行被全局折行切开，缩进与「一行一条语句」的阅读节奏碎掉，正是 M180 为
md 围栏代码块定过的那条理由，只是当时没覆盖到 code 模式。

**二、「md 折 / code 不折」不是个人怪癖，是通行出厂口径。** 主流的两个编辑器都是这个分叉：
VS Code 的 `editor.wordWrap` 出厂为 `off`，而它在 v1.10 专门「turn on word wrap by default for
Markdown files」（[February 2017 (version 1.10)](https://code.visualstudio.com/updates/v1_10)）；
JetBrains 系 IDE 的 Soft Wraps 出厂关闭，官方推荐做法是**按文件类型**打开
（[Enabling Soft Wraps](https://www.jetbrains.com/guide/tips/soft-wraps/)）。因此出厂分叉不是替 Alex
一个人定规则，而是与用户已有的编辑器习惯一致。

**三、「配置即数据」决定了个人偏好的居所。** Alex 的顾虑是「这种习惯比较个人，不适合硬规则」。
ADR 0002 §5 的口径给了直接出路：**机制留键、默认值定分叉**——想要 code 也折的人把新键写成 `true`
即可，偏好住在配置文件里，不硬编码在代码里。

**四、与 Emacs 定位的关系。** 本仓当前定位是 Emacs keybinding PKM（ADR 0006）。Emacs 里这条需求有
直接对应物且形态同构：折行由 `truncate-lines` 一类变量控制，默认值来自全局设定、可在 buffer 内翻转
（[Line Truncation](https://www.gnu.org/software/emacs/manual/html_node/emacs/Line-Truncation.html)）。
「按模式取不同默认值」与本仓既有的「一元素一条规则」（M180：围栏代码块不跟随正文行）是同一条思路的
自然延伸，不是新范式。

## What Changes

1. **新增一个配置键** `editor.code_mode_line_wrap`（`[editor]` 表，布尔，**默认 `false`**，沿用
   「JSON 键名 = Rust 字段名」的既有口径）：code 模式正文行的折行开关。它是**可选覆盖键**——键缺席时
   code 模式取自己的出厂 `false`（不折行），显式写 `true` 则听用户。
2. **出厂默认直接分叉**：`editor.line_wrap` 默认 `true`（md 折）、`editor.code_mode_line_wrap` 默认
   `false`（code 不折）。同一份出厂配置下两个模式的呈现相反，就是第 Why 节第二条那个行业口径。
3. **`code_mode_line_wrap` 不跟随 `line_wrap`**（本 change 明确写死的语义，替换掉提案期「缺省跟随全局
   `line_wrap`」的措辞）：跟随会让缺省值随用户改 `line_wrap` 漂移，出厂分叉随之失效——用户把 md 关掉
   折行时，code 会连带变成折行，那不是任何一方的意图。缺省值只有一个来源：本键自己的出厂 `false`。
4. **折行三键的分工写死为「一元素一条规则 × 模式」**：

   | 模式 | 正文行 | 代码块层 |
   |---|---|---|
   | md | `editor.line_wrap`（默认折行） | `editor.code_block_wrap`（默认不折，块级横滚容器） |
   | code | `editor.code_mode_line_wrap`（默认不折，编辑区横向平移） | 无作用对象（非 md 没有围栏渲染） |

   两个模式各自的轴 MUST NOT 互相改写：`line_wrap` 对 code 无可观测效果，`code_mode_line_wrap` 对 md
   无可观测效果（后者不是漏实现，是作用面本来就不在那里）。「不折行」的呈现路径两个模式共用同一条
   （`.cm-content` 落回 `white-space: pre` + `.cm-scroller` 横向平移）——本 change MUST NOT 为 code
   模式另造一套横向平移机制，也不新增任何 CSS。
5. **`view.toggle-line-wrap` 改为按前台会话模式翻对应的轴**：前台是 md 会话就翻 `line_wrap`，前台是
   code 会话就翻 `code_mode_line_wrap`。理由：code 模式的正文行已只读新键，若这条命令恒翻 `line_wrap`，
   它在 code 模式下按下去将**没有任何可见效果**，与 `keymap-commands` 已有的「按下后折行呈现立即变化、
   不是无反应」正面冲突。命令的 id、作用域（`global`）、默认不绑键状态一律不变；`view.toggle-code-block-wrap`
   的作用面不变。
6. **配置参考文档随本 change 同批落地**（backlog #36① 的裁决）：新建 `docs/specs/config-reference.md`，
   canonical 键值表（每个键的类型 / 默认 / 取值范围 / 生效时机，逐键与 `config.rs` 真源对齐）+ 配置目录
   布局节（`workspaces/` 现名与 #37 更名 `vault-registry/` 的前向注记、`vault-sessions/`、
   `reading-positions/`、`logs/`，并写明「同一 vault 实体刻意分存」的理由与出处）+ 写回纪律节
   （合并写、未知键保留；**明确不推荐**把全量默认写进 `config.json`）。
7. **绑定生成物随 `cargo test` 重导出**（`src/bindings/EditorConfig.ts`），受既有 bindings 漂移门禁约束。

## Non-goals

- **不做 per-language 折行表**：只有 md / code 两个模式，单键比「按扩展名 / 按语言」的表成比例
  （与 M180 明确否决过的「按语言决定折行」同一条理由）。
- **不做应用内 `describe-config` 面板**：backlog #36 的裁决是两步走，①（配置参考文档）随本 change 落地，
  ②（面板）**中期另立项**——本 change MUST NOT 顺手做面板，也不为它预留钩子。
- **不新增命令、不占默认键位**：折行只有既有的两条命令；本 change 不改它们的作用域与默认不绑键状态。
- **不做配置热重载**：装载时点与现状一致（启动读一次，改配置需重启）；运行期变更由两条命令承担。
- **不引入「逐字段类型容忍」**：`code_mode_line_wrap` 给错类型（`"yes"`）走既有的整文件回落，与
  `editor.mode` / `line_wrap` 同路，只如实记录 + 单测钉住。
- **不改 md 模式的行为**：`line_wrap` / `code_block_wrap` 的判定、四组合、代码块横滚容器、键盘可达性
  一律零变化；本 change 对 md 的呈现 MUST NOT 引入任何变化（视觉基线层面的期望是**逐字节不变**）。
- **不做折行增强**：不引入 `visual-line-mode` / `adaptive-wrap` 那类「按词折 + 悬挂缩进」的口径，
  只有「折 / 不折」二态。
- **不改写源文件**：折行（含运行期翻转）MUST NOT 触碰文档内容（ADR 0003 §3）。
- **不动视觉容差、不引入新配色 / 新排版变量 / 新 CSS**。

## Impact

- 影响的 specs：`editor-live-preview`（MODIFIED ×3：「折行口径与配置来源」「折行渲染与代码块横滚容器」
  「折行开关的瞬态口径」）。`keymap-commands` **不改**——其「折行开关命令」requirement 明写「翻转的语义与
  作用面 SHALL 按 `editor-live-preview` 的两条 requirement」，语义本体在本 change 里更新，命令面（id /
  作用域 / 默认不绑键）逐字不变。
- 影响的代码/系统：`src-tauri/src/config.rs`（`EditorConfig` 新增布尔字段 + 宽容镜像 + 逐字段回落 +
  单测）、`src/preview/theme.ts`（`WrapSettings` 第三轴、`DEFAULT_CODE_MODE_LINE_WRAP`、`wrapSpec` 按
  模式取轴）、`src/editor.ts`（运行期折行真源第三轴、`toggleLineWrap` 按前台模式选轴）、`src/main.ts`
  （配置消费点传第三轴）、`src/bindings/EditorConfig.ts`（ts-rs 生成物）。
- 影响的测试/验收：`src-tauri/src/config.rs` 内 Rust 单测（三态：键缺失 = 出厂 `false` / 显式 `true` /
  显式 `false`；类型不符 → 整文件回落）、`tests/unit/wrap.test.ts`（两模式分叉 + 出厂默认两处对账）、
  `tests/visual/scenes/m247-code-mode-line-wrap.spec.ts`（新增场景：出厂分叉两侧同框、显式打开、code 模式
  下翻转命令且不动 md 那一轴）、`tests/visual/scenes/tauri-stub.ts`（桩的 config 形状补第三个折行字段）。
- 真机验收：**本 change 不加真机场景**，理由见 `tasks.md` 的说明（判据是计算属性与文档字节，chromium 层
  已足；真机通道（AX + 截图）读不到 `white-space` 这类计算属性，加了也是派生证据）。既有真机折行场景
  原样保留、口径不变。
- 视觉基线：**预计零更新**。md 侧行为逐字节不变，code 侧既有 fixture 的最长行都短于阅读栏宽
  （`tests/visual/fixtures/render-codeblock/languages.md` 最长代码行 45 字符）——真变了就是实现引入了与
  折行无关的位移，按缺陷处理。任何基线更新仍走 Alex 人肉过目（AGENTS.md 硬规则）。
- 关联约束：ADR 0002 §5（配置即数据 + schema 校验；本 change 的机制选择直接来自它）、ADR 0002 §6
  （性能合同：折行是扩展 reconfigure，本 change 不新增解析 / 不新增测量）、ADR 0003 §3（不改写源文件）、
  ADR 0004 §5（功能变更走 OpenSpec）、ADR 0006（Emacs keybinding 定位）。
- 性能：`wrapSpec` 多一个布尔入参、`setWrap` 多一个轴的比较；无新增解析、无新增 DOM、无新增测量。

## 裁决记录

**Alex 裁决（2026-09-26，backlog #35/#36 同批）**：

- **#35｜机制 = 覆盖键 + 出厂分叉**（采纳 tower 建议）：① 机制 = 可选覆盖键（`editor.code_mode_line_wrap`，
  「缺省跟随全局 `line_wrap`」为提案期措辞）——只有 md/code 两个模式，单键比 per-language 表成比例；
  ② 出厂默认直接分叉（code 默认 `false`）——md 折 / code 不折是行业通行出厂口径，不是个人怪癖；
  「配置即数据」约束下个人偏好的居所是配置文件而非硬编码。
- **#36｜配置项可发现性**：采纳两步走——① 配置参考文档随 #35 同批落地；② `describe-config` 面板中期
  另立项。①的落地口径：canonical 键值表（类型 / 默认 / 取值范围 / 生效时机，真源对齐 `config.rs`）+
  配置目录布局节（`vault-registry/` = vault 注册表（身份，#37 更名后）、`vault-sessions/` = 标签会话
  （易变状态），两者同一 vault 实体刻意分存，出处是 `vault_session.rs` 头注释 / `multi-vault-workspaces`
  design §2；另覆盖 `reading-positions/`、`logs/`）。**明确不推荐**「写全量默认进 `config.json`」——
  会把缺字段跟随出厂默认钉死成旧值，与合并写纪律冲突。

**语义张力点的合读口径（本 change 写死，替换提案期措辞）**：backlog #35① 的「缺省跟随全局 `line_wrap`」
与 #35② 的「出厂默认直接分叉」在 `line_wrap = true`（默认）时字面冲突——跟随全局会让 code 出厂折行，
与分叉相反。本 change 采 #35② 为准：**覆盖键可选；未显式设置时 code 模式出厂 = 不折行；显式设置则
听用户**。缺省值不读 `line_wrap`（spec 的「code 模式缺字段时不跟随 line_wrap」scenario 即钉这条）。

**tower 裁决（2026-09-27，M247 澄清）**：① scope 扩入 `src/preview/theme.ts`（折行判定点与出厂默认
常量所在，判定点保持单一来源，不走「判定拆两处」）；② 批准 `view.toggle-line-wrap` 按前台会话模式选轴
（命令 id / 作用域 / 默认不绑键不变；「code 模式按了没反应」不可接受）。
