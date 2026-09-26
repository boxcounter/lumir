# Design: code-mode-line-wrap

本文件只写「为什么这么实现」——语义、判定点、配置面与测试策略。配方（改哪些文件、跑哪些命令）见
`tasks.md`；需求面（做什么、不做什么）见 `proposal.md` 与 `specs/editor-live-preview/spec.md`。

## 1. 语义：三个轴，按模式取用

折行口径从 M180 的两个轴扩张为三个，**轴与作用面一一对应**（「一元素一条规则」的延伸）：

| 轴（`WrapSettings` 字段） | 配置键 | 出厂 | 作用面 |
|---|---|---|---|
| `lineWrap` | `editor.line_wrap` | `true` | md 模式的**正文行** |
| `codeBlockWrap` | `editor.code_block_wrap` | `false` | md 模式的**围栏 / 缩进代码块行** |
| `codeModeLineWrap` | `editor.code_mode_line_wrap` | `false` | code 模式的**正文行** |

两条不变量：

1. **互不改写**：任一轴只对它的作用面有效，其余位置的取值对它无可观测效果。
2. **缺省不跟随**：`codeModeLineWrap` 的缺省是它自己的出厂 `false`，MUST NOT 读 `lineWrap`。
   跟随会让「code 取不取折行」变成 `line_wrap` 的函数：用户把 md 的折行关掉时 code 会连带变化，
   出厂分叉在用户改一次全局值之后就失效。缺省值只有一个来源（本键自己的出厂值），这样「出厂分叉」
   才是一条稳定性质，而不是「只在没人动过 `line_wrap` 时成立」的巧合。

为什么不在缺省值上加「模式感知」的逻辑（如「`line_wrap` 为 `true` 时 code 才不折」）：那等于用
`line_wrap` 的取值去决定 code 的缺省，用户无从表达「md 折 / code 折」之外的第三态；单键二态 + 固定
缺省是能覆盖全部意图的最小机制（只有两个模式，见 proposal 的 Non-goals：不做 per-language 表）。

## 2. 判定点与装配：`wrapSpec` 按模式取轴（单一来源）

**改动**：`wrapSpec` 的入参从三个位置参数收成 `(mode, settings: WrapSettings)`，正文行的判定改为
`mode === "md" ? settings.lineWrap : settings.codeModeLineWrap`；代码块那一层不动（`mode !== "md"`
恒 `null`，M180 的既有口径——非 md 没有围栏渲染，装一个没有消费者的 class 就是假声明）。

**为什么收成 `WrapSettings` 而不是加第四个位置参数**：三个布尔位置参数已经是「参数顺序写错就静默错」
的形态（`lineWrap` 与 `codeModeLineWrap` 都是布尔、语义相邻），第四个加进去只会放大这个面。判定点
保持唯一：`src/editor.ts` 的 `wrapExtensions` 只负责把判定结果装成扩展，MUST NOT 在装配层再判一次
模式——两处判定就是 REVIEW.md 第 8 条（同一语义两处真源）的形态。

**被否决的走法**：把 `mode → 轴` 的选取放在 `src/editor.ts`（判定点拆成两处：`wrapSpec` 判 md、调用方
按模式选值），换来 `src/preview/theme.ts` 一字不动。否决理由：折行的出厂默认常量与判定函数都在那个
文件里，拆开会让「同一件事的两半」分居两个文件，且该文件里描述判定口径的注释会与实现不符。tower
2026-09-27 澄清已按此结论把该文件纳入 scope。

## 3. 运行期真源与 `toggle` 选轴

**改动**：`createEditor` 闭包里的运行期真源 `wrap` 增加第三个字段；`setWrap` 的合并与「值没变就返回」
的比较都覆盖三轴；`toggleLineWrap()` 按**前台会话的模式**选轴（`active.mode === "md"` → 翻 `lineWrap`，
否则翻 `codeModeLineWrap`）。

**为什么 toggle 要按模式选轴**（tower 2026-09-27 批准）：code 的正文行此后只读 `codeModeLineWrap`，
若这条命令恒翻 `lineWrap`，它在 code 模式下按下去没有任何可见效果。这与 `keymap-commands` 的
「配置绑定后真的能触发」scenario（「折行呈现立即变化、不是无反应」）正面冲突——那条 scenario 不是
文字洁癖，它守的是「命令有实现、有绑定、按下去真有效果」这条不变量（M131 要消灭的正是「命令实现了但
没人绑 / 绑了没效果」那类静默状态）。

**轴独立与 D1 口径不冲突**：M180 的 D1 说的是「翻转是应用运行期的显示口径，全部会话一致、新标签页取
当前应用态」。本 change 保留这条：翻转作用于**该模式的全部会话**（含后台标签页），新建 / 重载会话仍取
当前应用态；变的只是「翻哪一轴」由前台会话的模式决定。没有第三条状态：三个轴各自是应用级单值。

**既有 md 路径零变化**：前台是 md 时选中的仍是 `lineWrap`，语义与实现路径与 M180 逐字相同
（`toggleLineWrap` 的分支、`wrapExtensions` 的 md 分支都不改行为）。md 的既有视觉场景（
`render-codeblock.spec.ts` 四条组合与 D1 两条）因此期望全绿且基线零更新。

## 4. 配置面：与 `line_wrap` 完全同形，缺省的家只有一个

**Rust 侧形状**（`src-tauri/src/config.rs`）：

- `EditorConfig` 增 `code_mode_line_wrap: bool`；`impl Default for EditorConfig` 给 `false`；
- `RawEditorConfig` 增 `code_mode_line_wrap: Option<bool>`（宽容镜像，与 `line_wrap` / `code_block_wrap`
  相邻，注释写明它**不读** `line_wrap`）；
- `validate()` 里与折行两项**同形**的两行（`if let Some(value) = ... { ... }`），缺字段回落默认、不告警。

**为什么 AppConfig 侧用 `bool` 而不是 `Option<bool>`**：本键的语义是「缺席 = 出厂 `false`」，与显式
写 `false` 在行为上完全等价——用 `Option` 会把一个**没有消费者**的区分（`None` vs `Some(false)`）
带进生效配置类型里（REVIEW.md 第 9 条：声明了却没有消费者的结构就是冒充能力）。选 `bool` 还买到两件事：
① 与既有折行两键同类同路（不给 `editor.*` 造「同类不同治」）；② **默认值的居所唯一**——出厂值住在
`EditorConfig::default()`，而不是 `RawEditorConfig` 的 serde `Default::default()`（后者会让同一个默认值
有两个家，REVIEW.md 第 8 条）。

**「可选覆盖键」落在哪一层**：落在**配置文件**这一层——键可写可不写，不写就走 `EditorConfig::default()`。
这与 backlog #36 的「不推荐把全量默认写进 `config.json`」是同一件事的两面：缺字段跟随出厂默认，
写进去才钉死。

**写回纪律无需改动**：应用回写 `config.json` 只做单键合并（`last_vault` / `ui.theme` /
`ui.content_width` 三处，`src-tauri/src/commands.rs`），新键**不在任何写通道里**——它天然只会被用户
手工写入，因此「未知键保留 + 缺字段跟随出厂」两条性质都自动保持。本 change MUST NOT 为新键新增写通道。

## 5. 测试策略

四层，各守一件它唯一能守的事：

| 层 | 守什么 | 落点 |
|---|---|---|
| Rust 单测 | 三态（键缺失 = 出厂 `false` / 显式 `true` / 显式 `false`）+ **不跟随 `line_wrap`** + 类型不符走整文件回落 | `src-tauri/src/config.rs` 的 `missing_code_mode_line_wrap_takes_factory_false` / `explicit_code_mode_line_wrap_is_loaded` / `wrong_type_code_mode_line_wrap_falls_back_entire_file` |
| TS 纯判定单测 | 判定点的分叉与轴独立（`wrapSpec` 对两模式的结论）+ 出厂默认两处真源对账 | `tests/unit/wrap.test.ts` |
| chromium 结构断言 | 装配后的真实呈现：code 长行不折行且横向可达、显式打开后折行、code 模式下翻转命令真的翻 code 轴且不动 md 轴 | `tests/visual/scenes/m247-code-mode-line-wrap.spec.ts`（纯计算属性，无像素断言） |
| md 侧既有场景 | md 零变化（回归护栏） | `render-codeblock.spec.ts` 的折行组**不改一字**，期望全绿 |

**为什么「不跟随 `line_wrap`」要在两处都测**：Rust 层守配置面的缺省，TS 层守判定的取值来源。只在
Rust 层测（断言字段值 `false`）时，把 TS 判定写成 `settings.lineWrap` 也能过；只在 TS 层测时，把
Rust 的缺省写成 `true` 也能过。两层的判别性断言都写了「把另一轴翻过来、本轴结论必须不变」。

**为什么本 change 不加真机验收场景**：判据是 `white-space` 这类**计算属性**与文档字节。真机通道
（AX 树 + 截图）读不到计算属性，只能给「长行有没有折出第二行」这类派生证据，而同一条证据在
chromium 层是直接读数且可复算；既有真机折行场景（`scripts/acceptance/scenarios/`）守的是配置默认与
`[keys]` 绑定两条**端到端路径**，本 change 不改它们（配置键变了但既有场景的键位/命令不变）。按简报
口径「不加要在 tasks.md 写明理由」——理由记在 `tasks.md` 的验证节。

## 6. 风险与已知边界

- **既有 code 模式视觉场景会不会动基线**：唯一可能的动因是「code 侧原本折行的长行现在不折」。已逐个
  核对带截图的 code 场景 fixture：`markdown-parser` 的 `.ts` 语料最长 238 字符但该场景**不含像素断言**
  （只做解析结构断言、也不进编辑器折行面）；其余带像素断言的 code 场景（`code-outline` /
  `m198` / `end-marker` / `tree-menu`）要么截的是浮层 / 菜单 / 元素级目标，要么语料最长行都短于阅读栏宽。
  处置：**跑本地 `gate.sh visual` 实测**；若任何既有基线需要 `--update` 才绿，立即停手上报（简报纪律
  ⑤）——那说明我漏判了一处 code 侧呈现。
- **`overflow-wrap` 在 code 模式的计算值**：不折行时 `.cm-content` 落回 `white-space: pre`，`overflow-wrap`
  是继承属性、初值 `normal`。本 change MUST NOT 为它加规则（`.cm-lineWrapping` 不在场就没有那条
  `overflow-wrap: anywhere`），视觉场景因此不断言它，只断言 `white-space` 与视觉行数。
- **`mode()` 与 `active.mode` 的一致性**：`toggleLineWrap` 读闭包里的 `active`（与
  `updateDirty` / `currentPath` 同一读法），不引入第二份「当前模式」真源。
- **观感归 Alex**：折/不折的默认值已由裁决给定；本 change 不引入任何视觉参数（零新增 token / 零 CSS），
  因此没有新的手感裁决点。
