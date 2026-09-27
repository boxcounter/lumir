# Proposal: Enter 换行自动缩进——code 模式与 md 代码块内继承语法缩进（新增配置键 `editor.auto_indent`）

- Change ID: enter-auto-indent
- 日期: 2026-09-27
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

Alex 原话（2026-09-27，逐字）：

> 「在代码中敲 Enter 键换行后，光标固定停在行首，而没有根据语法结构自动缩进。这个你有什么看法和建议？」

### 一、现状：Enter 在「代码里」确实没有任何人接管（提案期实测，逐条附来源）

**1. Lumir 自己没有装 CM 的换行 / 缩进扩展。** `defaultKeymap` / `indentOnInput` /
`insertNewlineAndIndent` / `indentWithTab` / 任何 `keymap.of` 在 `src/` 下全仓零命中
（`src/keys.ts:81-82` 的 M239 段记着这条现状，并对「TAB 因此落到原生焦点遍历」做过知情取舍——
统一键位表是唯一的命令分发路径，不引入 CM 侧的旁路）。
两处真正需要缩进的上下文因此都没有处理器：

- **code 模式**：该分支的扩展集里没有任何键位（`src/editor.ts:1435-1437`），`StreamLanguage`
  也不自带键盘表 ⇒ `Enter` 落回浏览器 contenteditable 默认 = 裸换行、零缩进。
- **md 的围栏 / 缩进代码块内**：上游处理器的行为见下条，它在围栏内主动退出 ⇒ 同样落回原生。

**2. 「md 模式完全没有 Enter 处理器」这个说法不成立（本提案对任务书前提的实测更正）。**
`@codemirror/lang-markdown` 的 `markdown()` 默认 `addKeymap = true`，它把一份 `markdownKeymap`
以 `Prec.high` 装进了编辑器（`node_modules/.pnpm/@codemirror+lang-markdown@6.5.2/.../dist/index.js:398-401`
定义、`:407` 默认值、`:423-424` 安装），其中 `Enter → insertNewlineContinueMarkup`。而本仓
`createEditor` 的默认 `markdownConfig` 是 `{ base: markdownLanguage, extensions: [GFM] }`
（`src/editor.ts:1137`），唯一调用点 `src/main.ts:97` 未传 `addKeymap: false`。

后果是：**md 的列表项与引用今天按 Enter 已经会续写标记并保持层级**（本 mission 实测，四次）：

```
`- alpha`        → `- alpha\n- `
`  - bravo`（嵌套）→ 续 `  - `（层级跟着走）
`1. uno` / `2. dos` → 续 `3. `（序号按新归属续排）
`> quoted`       → `> quoted\n> `
```

**该命令在围栏代码块内主动放弃**：它遇 `FencedCode` 祖先时 `getContext()` 直接返回空
（同文件 `:124-126`），命令据此 `return false`（`:206-213` 判 `dont`、`:280-281` 的
`if (dont) return false`；本 mission 实测：围栏内无论光标在哪一行，上游 `handled=false`）。
此时 Enter 落回浏览器默认 ⇒ 零缩进。
上游自己的文档注释还专门警告过这条（`:292-294`：「The command does nothing in non-Markdown
context, so it should not be used as the only binding for Enter」）。

**结论：这是缺失能力，不是 bug。** 两处上下文都是「没人接管 Enter」，而不是「接管了但算错」；
md 的列表 / 引用处反而是唯一已经工作的地方。

### 二、这是通行出厂口径，不是替 Alex 一个人定规则

- **CM6 官方的标准键位表本来就是这么做的**：本仓依赖的 `@codemirror/commands@6.11.0` 里
  `defaultKeymap` 把 `Enter` 与 `Shift-Enter` 绑到 `insertNewlineAndIndent`
  （`dist/index.js:1762`，一手来源、可复核）。也就是说「装了 CM 标准键位表的编辑器本来就自动
  缩进」——Lumir 因为不装任何键位表，恰好缺了这一步。
- **Emacs 侧有同构能力，且位置一致**：`electric-indent-mode` 是 Emacs 24.1 引入的全局 minor
  mode（打字触发重缩进，[NEWS.24.1](https://www.gnu.org/software/emacs/news/NEWS.24.1)）。
  本仓定位是 Emacs keybinding PKM（ADR 0006），「可关的自动缩进行为」正是它那一档的东西。
- **与 M247 的裁决口径同构**：机制留键、默认值定出厂（`line_wrap` 默认 `true`）。个人偏好住
  在配置文件里，不硬编码进代码。

### 三、性质与流程

新增能力（把一个缺失的编辑行为补上），只动一个 capability 的行为 ⇒ 走 OpenSpec change，
不产生 ADR。本 change 的**提案先行**：Alex 需要在实现前裁决 D1–D5（机制落点 / 默认值 /
围栏内的缩进口径 / 与 md 列表续行的关系 / 关掉配置的作用面）。本稿只产制品，不动 `src/`。

## What Changes

1. **`Enter` 的自动缩进（新增行为，逐上下文）** —— 完整口径见 `specs/editor-live-preview/spec.md`
   的 ADDED requirement「Enter 换行与自动缩进」：

   | 光标所在上下文 | 本 change 之后 | 与本 change 之前比 |
   |---|---|---|
   | code 模式 | 新行取**该语言的语法缩进**；语言无缩进规则时沿用光标所在行的行首空白 | **新增**（之前恒为裸换行） |
   | md 围栏 / 缩进代码块内 | 新行沿用光标所在行的行首空白 | **新增**（之前恒为裸换行） |
   | md 列表项 / 引用内 | 续写同级标记并保持层级 | **不变**（上游既有行为，本 change 只把它写进 living spec） |
   | md 正文段落（行首无空白） | 平换行 | **不变** |

   实测的语法缩进效果（本 mission 探针，真实 `EditorState` + 真实 parser，命令与输出见
   `design.md` §4）：`.js` 的 `const alpha = () => {` 行尾按 Enter → 新行两个空格；
   `.py` 的 `def f():`、`.rust` / `.go` / `.c` 的 `if (x) {`、`.json` 的 `{` 同理；
   `.toml` / `.yaml` / `.sh` / 未收录扩展没有缩进规则 ⇒ 沿用当前行行首空白。

   > 口径说明（防误读）：表里「之前恒为裸换行」的机制依据是「这两处没有处理器、`Enter` 落回浏览器
   > 默认」，由源码与 headless 探针确证（`design.md` §1.1 / §4）；**浏览器实际插入的形态**本 mission
   > 未在 WKWebView 单独复核，旁证是 Alex 上面的现象描述。该表述的正面复验归真机场景 59
   > （见 `design.md` §3 第 10 条）。

2. **新增配置键 `editor.auto_indent`**（`[editor]` 表，布尔，**默认 `true`**）：关掉即回到本
   change 之前的行为（作用面 = 上表标「新增」的两行）。键缺席 = 出厂 `true`；与既有
   `editor.mode` 及三个折行键走**同一条装配链**（`impl Default` / `#[serde(default)]` 的宽容
   镜像 / `validate()` 逐字段回落 / ts-rs 导出 / 启动时装载一次）；类型不符走既有的整文件回落
   （与 `line_wrap` 同路），不发明逐字段类型容忍。

3. **`Enter` 不进统一键位表**（`src/keys.ts` 的 `KEY_BINDINGS`）：本 change 的落点是编辑器内核
   mode 扩展里的一条 `Prec.highest` 键位——先委派上游的列表 / 引用续行，未命中才自动缩进。
   代价（知情接受）：`Enter` 不进 `[keys]` 的重绑面、不进 `describe-bindings` 面板；理由与备选
   见裁决项 D1。

4. **顺手校正 `src/keys.ts` 那句失真的注释**（M239 段）：它说「CM 侧未装 `indentWithTab`、
   也未装 `defaultKeymap` / 任何 `keymap.of`……全仓零命中」——字面为真，但被读成「编辑器里没有
   任何 CM keymap」就是**假的**（`markdown()` 的 `addKeymap` 默认值把上游 `markdownKeymap` 带
   了进来）。它已经是误导源：本 mission 任务书里的前提就据它写错了。改注释不改行为。

5. **真机验收场景**：新增 `scripts/acceptance/scenarios/59-enter-auto-indent.md`（编号由 tower
   registry 派定：「M264 起从 59 派」），草案全文见 `design.md` §7，随实现同 PR
   （AGENTS.md：新功能 mission 必须附带「新增 / 更新验收场景」）。

## 待 Alex 裁决

| # | 裁决点 | 选项 | 推荐 | 一句话理由 |
|---|---|---|---|---|
| D1 | `Enter` 的机制落点 | a. 编辑器内核 mode 扩展内的 `Prec.highest` 键位（**推荐**）；b. 进统一键位表 `KEY_BINDINGS`（可经 `[keys]` 重绑、进 `describe-bindings` 面板） | **a** | b 与表内既有纪律根本冲突：md 的列表 / 引用已被上游 `Prec.high` 的 `markdownKeymap` 先消费，表内 `Enter` 要嘛**吞掉列表续行**、要嘛违反「命中即消费、MUST NOT 放回原生路径」（`keymap-commands` spec「统一键位分发表」的明文），二选一都是缺陷；且表内绑定只有作用域 / `when`（事件目标谓词），表达不了「光标在围栏代码块内」。CM 侧的优先级合并是本仓唯一能表达「高优先级处理器返回 false 即让位」的机制（`@codemirror/view` 的 `keymap` facet 文档：优先级高的先查，返回 true 即不再往下）。代价如 What Changes 第 3 条 |
| D2 | `editor.auto_indent` 的默认值 | a. `true`（**推荐**）；b. `false`（要用户显式打开） | **a** | 默认 `false` 等于把 Alex 报的现象留在出厂态；M247 的裁决口径是「机制留键、默认值定出厂」，偏好住配置文件。b 的唯一收益是「与现状零差异」，而现状就是被报告的问题 |
| D3 | md 围栏代码块内要不要**真语法缩进** | a. 本批不做（沿用当前行缩进），另立项（**推荐**）；b. 同批把 `codeLanguages` 接进 `markdown()` | **a** | b 会改 md 模式的解析管线（M138 刻意选择「装饰层着色、不给 markdown 挂 `codeLanguages`」，理由写在 `src/preview/code.ts:1-10`），牵动打开与击键的解析成本、需要独立的测量面；捆在一起会让本 change 的验收面翻倍（list-tab-indent D5 的同一条收敛理由）。**b 是真实的能力缺口**：本 change 如实登记为已知边界，不假装已覆盖 |
| D4 | md 列表 / 引用的 Enter 续行算不算本 change 的作用面 | a. 不算：维持上游现状，本 change 只把它**写进 living spec**（**推荐**）；b. 一并接管（例如让列表内的 Enter 也遵守本 change 的缩进口径） | **a** | 上游今天已经正确工作（上面四条实测），接管的收益只是「口径统一」，代价是把一条活的既有行为拉进本 change 的验证面，并与 M239 的 Tab 缩进、未来列表类 change 交叉。b 想达成的「层级归 Tab、续写归 Enter」**已经是现状** |
| D5 | `auto_indent = false` 的作用面 | a. 只关本 change 新增的两处（围栏代码块 / code 模式），列表 / 引用续行不受影响（**推荐**）；b. 连列表 / 引用续行一起关（`Enter` 恒为裸换行） | **a** | b 要求本 change **遮蔽**上游行为（我们的键位得返回 true 并插裸换行），把一条活的上游能力拉进本 change 的版本风险；a 的语义可解释（「自动缩进」指缩进的计算，列表标记续写不是缩进计算）。代价如实登记：`auto_indent = false` 时列表里按 Enter 仍会得到缩进的标记，这条不对称会写进 spec 的 scenario |

## Non-goals

- **不做围栏代码块内的语法级缩进**（D3a）：不接 `codeLanguages`、不改 `markdown()` 的解析配置、
  不改装饰层着色管线（`src/preview/code.ts` 的单一来源口径不动）。围栏内只保证「沿用当前行缩进」。
- **不接管、不改写 md 的列表 / 引用续行**（D4a）：上游 `markdownKeymap` 的行为一条不动，本 change
  只把它写进 living spec（此前它没有任何 spec 认领）。
- **不新增命令、不占新键位、不动 `KEY_BINDINGS` 表**：`Enter` 的落点在编辑器内核内，零新命令 id。
- **不给 `Shift-Enter` 新增语义**：它今天与 `Enter` 一样落原生路径（都是裸换行），本 change 只收
  `Enter`。后果如实登记：**code 模式下两键从此不同**（`Enter` 自动缩进、`Shift-Enter` 仍是裸换行）。
  这既是「保留一个不缩进的裸换行」的逃生口，也是一处知情的不对称；若 Alex 要两键一致，实现是
  一条绑定的事（CM 官方 `defaultKeymap` 正是两键同绑）。
- **不做 per-language 缩进宽度表**：缩进单位沿用编辑器内核算法的出厂值（两个空格），不为某门
  语言单设 4 空格。
- **不做运行期开关命令**（如 `view.toggle-auto-indent`）：配置键是启动时装载的输入面，与
  `line_wrap` 等三键同一时点；本 change 不新增 UI 面、不新增命令。
- **不改写源文件铁律之外的任何写回口径**：`Enter` 是用户输入，天然要改文档；本 change 不新增
  任何「程序化改写源文件」的路径（ADR 0003 §3）。
- **不动 `src/preview/**` 的渲染层**、不新增 CSS、不动视觉基线。

## Impact

- **影响的 specs**：`editor-live-preview`
  - ADDED 一条 requirement「Enter 换行与自动缩进」（行为逐上下文 + `editor.auto_indent` 的配置口径）。
  - MODIFIED 一条 requirement「折行口径与配置来源」：新增第四个 `[editor]` 键后原句失真，必须同步。
    改动面**只在折行限定词与第四键指向**，共五处（逐条列明，供归档时对账；清单与两份文本的 `diff`
    实测一致）：

    1. 首句「`[editor]` 表 SHALL 支持三个布尔项」→「…支持三个**折行**布尔项」；
    2. 新增一段指向：第四个布尔键 `editor.auto_indent` 不在本 requirement 作用面内，口径见新 requirement；
    3. 「三项 SHALL 与既有 `editor.mode` 走同一条装配链」→「三个折行项（连同 `editor.auto_indent`）
       SHALL…」（该段因插入文字重新折行，逐字内容除该限定词外一致）；
    4. 「三个配置项是**输入面**」→「折行三个配置项是**输入面**」；
    5. Scenario「缺字段时取默认」里的「没有这三个字段」→「没有这三个**折行**字段」。

    除这五处之外，正文与七个 scenario 与 living spec 逐字一致（防归档时的静默改写）。
  - `keymap-commands` **不改**：零新命令 id、零新表内绑定（D1a 的落点不在表内），「统一键位分发表」
    的纪律原样成立。
- **影响的代码/系统（实现期）**：`src-tauri/src/config.rs`（`EditorConfig` 增 `auto_indent` +
  `impl Default` 为 `true` + 宽容解析镜像 + `validate()` 逐字段回落 + 单测）、
  `src/bindings/EditorConfig.ts`（ts-rs 重导出，受 bindings 漂移门禁）、`src/main.ts`（配置消费
  点，与 `setWrap` 同一处）、`src/editor.ts`（mode 扩展内两条 `Enter` 键位 + 运行期 flag 传入）、
  `src/keys.ts`（**仅注释校正**）。
- **影响的测试 / 验收**：`tests/unit/`（配置三态 + 判定，真 `EditorState` 先例 =
  `cell-geometry.test.ts` / `list-indent.test.ts`）、`tests/visual/scenes/m264-enter-auto-indent.spec.ts`
  （chromium 里的真实 DOM `KeyboardEvent` 键位链路，先例 = `m239-list-tab-indent.spec.ts`）、
  `scripts/acceptance/scenarios/59-enter-auto-indent.md`（真机；`Enter` 的注入键名是 `return`，
  不在套件的「键不可达」清单里）、`scripts/acceptance/lib/execute.mjs` 与 `lib/app.mjs` 的
  `configWrite` 需要多认一个键（现只认 lastVault / mode / keys / 排版三项 / theme / contentWidth；
  先例 = M195 / M210 / M228 各自扩过一次）。
- **视觉基线**：**预计零更新**。`Enter` 只在按键之后改变文本，静止态渲染零足迹；任何基线差异都
  按缺陷处理，不靠 `--update` 收口（AGENTS.md：基线更新是人肉裁决点）。
- **性能**：一次 `Enter` = 一次 `getIndentation`（语法树查询）+ 一次 dispatch。md 模式本来就有
  markdown 语法树、code 模式本来就有 `StreamLanguage` 树，本 change 不新增解析器、不新增测量、
  不新增 DOM。
- **关联约束**：ADR 0002 §5（配置即数据 + schema 校验）、§6（性能合同：keypress-to-paint <16ms）、
  ADR 0003 §3（不改写源文件——本 change 不新增程序化写回路径）、ADR 0004 §5（功能变更走 OpenSpec）、
  ADR 0006（Emacs keybinding 定位，D2 / Why 第二节的理由来源）。
- **与其他活跃 change 的关系**：无交集——本 change 不碰渲染层、不碰键位表、不碰列表结构
  （M239 的 `editor.list-indent` 是另一条轴：Tab 改层级，Enter 只续写）。

## 裁决记录

**待填**：本稿为本 mission 的唯一产物，实现待**节点 1（提案评审）**通过后开始。Alex 落槌后按
list-tab-indent 的先例办理：原话逐字记入本节，凡与推荐项不一致的裁决**先回改 `specs/` 增量与
`tasks.md` 再动代码**（口径先于代码），本节的选项表与理由保留作历史档。
