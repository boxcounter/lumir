# Design: enter-auto-indent

本文是 `proposal.md` 的技术方案与实测依据。制品读者两类（Alex 不看代码即可裁决；实现 agent 按
本文件施工），故每条断言都带 file:line 或实测输出。

## 1. 现状（2026-09-27 全量核对）

### 1.1 `Enter` 今天有三条可能路径，Lumir 只拥有其中零条

| 上下文 | 谁在管 | 实测结果 |
|---|---|---|
| md 列表项 / 引用内 | **上游** `markdownKeymap`（`@codemirror/lang-markdown` 的 `markdown()` 默认 `addKeymap: true` 装进来的 `Prec.high` 键位） | 续写标记并保持层级（§4 段 4） |
| md 围栏 / 缩进代码块内 | 无人（上游 `getContext()` 遇 `FencedCode` 返回空 ⇒ 命令 `return false`） | 落浏览器默认 = 裸换行 |
| code 模式 | 无人（该分支扩展集里没有任何键位） | 落浏览器默认 = 裸换行 |

逐条来源：

- 上游键位的定义与安装：`node_modules/.pnpm/@codemirror+lang-markdown@6.5.2/node_modules/@codemirror/lang-markdown/dist/index.js`
  `:398-401`（`markdownKeymap = [{ key: "Enter", run: insertNewlineContinueMarkup }, { key: "Backspace", ... }]`）、
  `:406`（`addKeymap = true` 默认值）、`:423-424`（`support.push(Prec.high(keymap.of(markdownKeymap)))`）。
- 围栏内主动退出：同文件 `:124-126`（`if (cur.name == "FencedCode") return context;`）、
  `:206-213`（`context` 为空即 `dont = { range }`）、`:295`（`if (dont) return false`）。
  上游自己的文档注释 `:288-292` 明写「should not be used as the only binding for Enter」。
- 本仓未关掉它：`src/editor.ts:1137` 的 `createEditor(parent, initialMode = "md", markdownConfig =
  { base: markdownLanguage, extensions: [GFM] })`；唯一调用点 `src/main.ts:97` 不传第二 / 第三个
  参数（全仓 `addKeymap` 零命中）⇒ `markdown(markdownConfig)`（`src/editor.ts:1331`）走默认值。
- code 模式零键位：`src/editor.ts:1435-1437`（code 分支 = `editability` + 语言 / 高亮 + 主题 +
  `lineNumbers()` + `highlightActiveLine()`）。
- 全仓零 CM 换行 / 缩进扩展：`defaultKeymap` / `indentWithTab` / `insertNewlineAndIndent` /
  `indentOnInput` / `keymap.of` 在 `src/` 下零命中（`src/keys.ts:81-82` 的 M239 段载明这是**有意
  取舍**）。`@codemirror/commands` 的 import 只有 `history, redo, undo`（`src/editor.ts:9`）。
- `Enter` 不被浏览器之外的人拦：`@codemirror/view` 的 `beforeinput` 处理器只在 **Chrome Android**
  上伪造 Enter / Backspace 键（`.../view@6.43.11/dist/index.js:5330-5336` 与 `:4719-4724` 的
  `PendingKeys` 表），macOS 上 Enter 走浏览器默认 + CM 的 DOM 观察器读入。

> **对 `src/keys.ts:81-82` 的更正（本 change 的实现项之一）**：那句「CM 侧未装 `indentWithTab`、
> 也未装 `defaultKeymap` / 任何 `keymap.of`……在 src/ 下全仓零命中」字面为真，但被读成「编辑器里
> 没有任何 CM keymap」就是假的（上游 `markdown()` 默认带进一份）。它已是误导源——本 mission 的
> 任务书前提就据它写错。因此任务书里「Enter 走 contenteditable 原生换行零缩进」只在
> **围栏代码块内与 code 模式**成立，md 的列表 / 引用处不成立。

### 1.2 缩进从哪里来：CM 的缩进服务（依赖已在仓内，无需新增）

- `@codemirror/language@6.12.4`：`indentService` facet（`dist/index.js:800`）、`indentUnit` facet
  （`:806-818`，出厂 `"  "` 两个空格）、`getIndentation(context, pos)`（`:849-863`，先问
  `indentService`，再查语法树节点的 `indentNodeProp`，都没有则返回 `null`）。
- `@codemirror/commands@6.11.0`：`insertNewlineAndIndent`（`dist/index.js:1533`，= `newlineAndIndent(false)`）
  的实现 `:1534-1556` —— 它调 `getIndentation`，**取到 `null` 时回落到「当前行的行首空白列宽」**
  （`:1543-1546` 的 `countColumn(/^\s*/.exec(...))`）。这条回落就是「无缩进规则的语言沿用当前行缩进」
  的机制来源，不需要我们自己写。
- 语言侧：`StreamLanguage` 把 `indentNodeProp` 挂在 Document 节点上（`@codemirror/language`
  `:2572` 的 `indentNodeProp.add(() => cx => lang.getIndent(cx))`），`getIndent` 调 stream parser 的
  `indent`（`:2290`；未声明时是 `:2209` 的 `() => null`）。本仓 code 模式的注册表共 24 个键
  （23 门语言——`json` / `jsonc` 共用同一实例，`src/preview/code.ts` 的 `LANGUAGES`），**18 门带
  `indent` 规则**（本 mission 逐门实测：rust / typescript / javascript / python / go / c / cpp /
  java / kotlin / ruby / json / css / scss / html / xml / swift / lua / sql），**5 门不带**
  （`shell` / `toml` / `yaml` 与自写的 dotfile parser 两键）——§4 段 1-2 是其中的代表样本。
- md 语言**没有**缩进服务：`@codemirror/lang-markdown` 显式写了 `indentNodeProp.add({ Document: () => null })`
  （同文件 `:18-20`）⇒ md 文档里 `getIndentation` 恒为 `null` ⇒ 一律走「沿用当前行行首空白」这条回落。
- 依赖确认（任务书要求）：`package.json` 已有 `"@codemirror/language": "^6.12.4"` 与
  `"@codemirror/commands": "^6.11.0"`，**本 change 零新增依赖**。

### 1.3 统一键位表的既有纪律（D1 的论据来源）

`openspec/specs/keymap-commands/spec.md` 的「统一键位分发表」requirement 明写两条：

1. **「分发 SHALL 只有一条路径……MUST NOT 存在并列的键位旁路」**；
2. **「SHALL 在命中绑定时吞掉默认行为——命令本身无事可做时同样吞掉（例如撤销栈为空时的 ⌘Z），
   MUST NOT 把按键放回原生 contenteditable 路径」**（= list-tab-indent 的 D4a 裁决口径）。

第 2 条与本能力的「按上下文让位」需求**直接冲突**：`Enter` 在 md 的列表 / 引用处必须让上游续行
（不能吞），在围栏 / 段落 / code 模式处必须自己接管。表内一个 token 一条绑定、`when` 只收事件目标
谓词（M132 的 widget 键就是这种谓词），表达不了「光标在围栏代码块内」这种语法上下文判据。故落点在
CM 的 keymap facet（D1a），并把理由与代价写进 proposal 的裁决项。

## 2. 机制（推荐方案 D1a + D2a + D3a + D4a + D5a）

### 2.1 一条 `Prec.highest` 键位，先委派上游、未命中才自动缩进

```
Prec.highest(keymap.of([{ key: "Enter", run: enterWithAutoIndent }]))

function enterWithAutoIndent(view) {
  if (!autoIndent) return false;              // 关掉配置 ⇒ 不接管，落回浏览器默认（= 本 change 之前的行为）
  if (insertNewlineContinueMarkup(view)) return true;   // 委派上游：命中列表 / 引用即交回，既有行为零改动
  return insertNewlineAndIndent(view);        // 其余上下文：自动缩进（code 模式 / md 围栏 / 段落）
}
```

三条机制事实（都可复核）：

1. **优先级能表达「让位」**：`@codemirror/view` 的 `keymap` facet 文档（`dist/index.js:9070-9077`）：
   「You can add multiple keymaps to an editor. Their priorities determine their precedence (the ones
   specified early or with high priority get checked first). When a handler has returned `true` for a
   given key, no further handlers are called.」`buildKeymap` 把同键的多个 handler 按 facet 值顺序
   追加进 `run` 数组（`:9138-9145`）⇒ 我们返回 `false` 时上游 `Prec.high` 的
   `insertNewlineContinueMarkup` 照常执行。
2. **委派比自己重写判据稳**：上游的「我在不在列表 / 引用里」判据是它自己的
   `markdownLanguage.isActiveAt` + `getContext`（`:204-213`），自己抄一份 = 两份真源（REVIEW.md
   第 8 条）。实测：上游在围栏内、段落内、缩进代码块内一律返回 `false`，在列表 / 引用内返回 `true`
   （§4 段 4-5），委派因此**恰好**等于「只接管本来没人管的那部分」。
3. **不新增 keydown 观察开销**：base 层已有一条空的 `EditorView.domEventHandlers({ keydown: () => false })`
   （`src/editor.ts:1486`），它的注释写明作用是「让 keydown 留在观察列表里，保证命令读到 flush 过的
   state」。新增 keymap 也会带上 CM 自己的 keydown 手柄（`:9064`），但观察列表本来就不空 ⇒
   **flush 时机不变**，本 change 不引入新的时序性质。

### 2.2 两模式的键位差异

| 模式 | 装什么 | 为什么 |
|---|---|---|
| md | 上面那一条（含委派上游） | 上游键位只存在于 md 模式（`markdown()` 的产物）；code 模式调它没有意义 |
| code | 同一条去掉委派（`autoIndent ? insertNewlineAndIndent : false`） | code 模式没有上游键位，也没有 md 语法树；直接自动缩进 |

两条都装在 `modeExtensions` 的分支里（`src/editor.ts:1326-1438` 是模式相关扩展的唯一装配点），
随 `modeCompartment` 的重配一起换 —— 与折行 / 可编辑性同一形态。**`Enter` 不进 `KEY_BINDINGS`**：
它不产生命令 id、不进 `[keys]` 重绑面、不进 `describe-bindings` 面板（代价与备选见 D1）。

### 2.3 配置键的装配链（与既有四键逐条同形）

1. `src-tauri/src/config.rs`：`EditorConfig` 增 `pub auto_indent: bool`；`impl Default` 给 `true`
   （与 `line_wrap: true` 同一处）；宽容解析镜像 `RawEditorConfig` 增 `auto_indent: Option<bool>`
   （`#[serde(default)]`）；`validate()` 里按既有形态 `if let Some(value) = raw.editor.auto_indent`
   逐字段覆盖 —— **不读其它键**（无「跟随」语义，与 `code_mode_line_wrap` 的「键缺席 = 出厂值」
   同一条口径，不重犯 M247 提案期的「缺省跟随全局」措辞错误）。
2. ts-rs 重导出 `src/bindings/EditorConfig.ts`（受 `scripts/gate.sh` 的 bindings 漂移门禁）。
3. 装配层：`src/main.ts` 的配置消费点（与 `setWrap` 同一处，`:1383-1393`）把 `auto_indent` 传进
   编辑器句柄（新增一个与 `setWrap` 同形的方法，或并入同一份 settings 对象——实现期定，二者都不
   新增第二条装载路径）。
4. 装载时点与现状一致：启动读一次，无 watcher；改配置需重启（本 change 不加运行期开关命令）。

### 2.4 缩进单位

写入用编辑器内核的 `indentUnit` facet（出厂 `"  "` = 两个空格），与仓内 2 空格惯例一致
（`src/preview/code.ts:348-350` 的 `INDENT_UNIT = 2`、列表缩进步长按语法树的同一条口径）。
**不设 per-language 宽度表**：legacy stream parser 的 `indent` 以 `cx.unit`（= 本 facet）为步长，
本 change 不动它。

## 3. 可观测的边界（如实登记，写进 spec 或 Non-goals）

1. **`insertNewlineAndIndent` 会吃掉光标之后的行尾空白**（`@codemirror/commands` `:1546` 的
   `while (to < line.to && /\s/.test(...)) to++`）。即在被接管的上下文里，`Enter` 除了插新行还会
   让**当前行**丢掉行尾空白——这是 CM 标准行为（VS Code 同口径），但与浏览器默认的「裸插入」有
   一处可观测差异。spec 的 scenario 不假装它不存在。
2. **围栏代码块内没有语法级缩进**（D3a）：围栏内容在 CM 的语法树里是 `CodeText`，没有子语言
   （`markdownConfig` 未传 `codeLanguages`，`src/preview/code.ts:1-10` 记了这一取舍的理由）⇒
   `getIndentation` 返回 `null` ⇒ 只能沿用当前行缩进。**这是真实的能力缺口**，不是漏测。
3. **md 的缩进代码块**（4 空格缩进的代码块）也归「沿用当前行缩进」：实测 `    foo` → `    foo\n    `
   （此前是裸换行 ⇒ 该场景同样是净改善）。
4. **无缩进规则的语言只保证「沿用当前行缩进」**：`shell` / `toml` / `yaml` / 自写 dotfile parser /
   未收录扩展（纯文本）实测 `getIndentation=null`；当前行无空白时结果就是裸换行（与现状一致）。
5. **语法缩进的质量 = legacy CM5 mode 自带规则的质量**：本 change 不写、不修任何 per-language
   缩进规则。实测到一处已知古怪：`{` 之后若同行还有别的字符（`if (x) {q`），该 mode 的缩进规则
   不再触发（`getIndentation=0`）—— 属上游 parser 的行为，Lumir 不代偿（这正是 D3b「另立项」的
   同一类议题：parser 质量与我们的键位是两件事）。
6. **`Enter` 与 `Shift-Enter` 将不对称**：本 change 只收 `Enter`；`Shift-Enter` 维持现状（裸换行）。
   两键从此在 code 模式不同 —— 既是「要一个不缩进的裸换行」的逃生口，也是知情的不对称（Non-goals）。
7. **`auto_indent = false` 时列表 / 引用续行照旧**（D5a）：上游行为不受本键影响。这条不对称
   必须写进 spec（否则「关了自动缩进怎么列表还缩进」会变成下一个 finding）。
8. **`Enter` 不进 `[keys]` / 不进键位面板**（D1a 的代价）。
9. **只读会话**（`EditorState.readOnly`）：`insertNewlineAndIndent` 自身在 `readOnly` 时返回 `false`
   ⇒ 不产生文档变更；`changeFilter` 兜底不变（`src/editor.ts:1499`）。
10. **「落回浏览器默认」这一段是机制推定 + 用户现象，不是本 mission 的 WKWebView 实测**：
    「围栏内 / code 模式没有处理器」由源码（§1.1）与 headless 探针（§4，上游 `handled=false`）
    确证；而**实际插入的形态**（裸 `\n` / `<br>` / 块级元素）本 mission **未**在 WKWebView 里单独
    复核。旁证是 Alex 的现象描述（换行确实发生、缩进为零）；正面复验归本 change 的真机场景 59。
    MUST NOT 把这条读成「已实测插入的是裸 `\n`」。

## 4. 实测探针（本 mission 跑的，原样可复算）

在**仓根**（`node_modules` 所在处）执行以下脚本；它用真实的 `EditorState` + 真实 parser +
真实的 `insertNewlineAndIndent`，不依赖浏览器：

```bash
cd <repo-root> && node --input-type=module -e '
import { EditorState, EditorSelection } from "@codemirror/state";
import { StreamLanguage, ensureSyntaxTree, getIndentation, IndentContext } from "@codemirror/language";
import { insertNewlineAndIndent } from "@codemirror/commands";
import { markdown, markdownLanguage, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
const md = [markdown({ base: markdownLanguage, extensions: [GFM] })];
const legacy = {
  javascript: (await import("@codemirror/legacy-modes/mode/javascript")).javascript,
  python: (await import("@codemirror/legacy-modes/mode/python")).python,
  rust: (await import("@codemirror/legacy-modes/mode/rust")).rust,
  go: (await import("@codemirror/legacy-modes/mode/go")).go,
  c: (await import("@codemirror/legacy-modes/mode/clike")).c,
  json: (await import("@codemirror/legacy-modes/mode/javascript")).json,
  toml: (await import("@codemirror/legacy-modes/mode/toml")).toml,
  yaml: (await import("@codemirror/legacy-modes/mode/yaml")).yaml,
  shell: (await import("@codemirror/legacy-modes/mode/shell")).shell,
};
function probe(label, ext, doc, cmd = (a) => insertNewlineAndIndent(a)) {
  const state = EditorState.create({ doc, extensions: ext, selection: EditorSelection.cursor(doc.length) });
  ensureSyntaxTree(state, doc.length, 2000);
  const ind = getIndentation(new IndentContext(state), doc.length);
  let out = null;
  const handled = cmd({ state, dispatch: (tr) => { out = tr.state.doc.toString(); } });
  console.log(label.padEnd(38), "| getIndentation=" + String(ind).padEnd(5), "| handled=" + String(handled).padEnd(5), "| ->", JSON.stringify(out));
}
probe("js  `const alpha = () => {`", [StreamLanguage.define(legacy.javascript)], "const alpha = () => {");
probe("py  `def f():`", [StreamLanguage.define(legacy.python)], "def f():");
probe("rust `if (x) {`", [StreamLanguage.define(legacy.rust)], "if (x) {");
probe("go  `if (x) {`", [StreamLanguage.define(legacy.go)], "if (x) {");
probe("c   `if (x) {`", [StreamLanguage.define(legacy.c)], "if (x) {");
probe("json `{`", [StreamLanguage.define(legacy.json)], "{");
probe("toml `[a]`", [StreamLanguage.define(legacy.toml)], "[a]");
probe("toml `  [a]`", [StreamLanguage.define(legacy.toml)], "  [a]");
probe("shell `echo 1`", [StreamLanguage.define(legacy.shell)], "echo 1");
probe("纯文本（未收录扩展）`    foo`", [], "    foo");
probe("md 围栏内 `  beta();`", md, "```js\n  beta();");
probe("md 缩进代码块 `    foo`", md, "    foo");
probe("md 正文段落 `hello`", md, "hello");
probe("md 列表 `- alpha`", md, "- alpha", insertNewlineContinueMarkup);
probe("md 嵌套 `  - bravo`", md, "- alpha\n  - bravo", insertNewlineContinueMarkup);
probe("md 有序 `1. uno`/`2. dos`", md, "1. uno\n2. dos", insertNewlineContinueMarkup);
probe("md 引用 `> quoted`", md, "> quoted", insertNewlineContinueMarkup);
probe("[反证] 列表里不走上游、直接 insertNewlineAndIndent", md, "- alpha");
probe("md 围栏内 `- x` 走上游", md, "```\n- x", insertNewlineContinueMarkup);
probe("md 围栏内 `- x` 走本 change 的命令", md, "```\n- x");
'
```

实跑输出（2026-09-27，本 mission，逐行原样）：

```
js  `const alpha = () => {`            | getIndentation=2     | handled=true  | -> "const alpha = () => {\n  "
py  `def f():`                         | getIndentation=2     | handled=true  | -> "def f():\n  "
rust `if (x) {`                        | getIndentation=2     | handled=true  | -> "if (x) {\n  "
go  `if (x) {`                         | getIndentation=2     | handled=true  | -> "if (x) {\n  "
c   `if (x) {`                         | getIndentation=2     | handled=true  | -> "if (x) {\n  "
json `{`                               | getIndentation=2     | handled=true  | -> "{\n  "
toml `[a]`                             | getIndentation=null  | handled=true  | -> "[a]\n"
toml `  [a]`                           | getIndentation=null  | handled=true  | -> "  [a]\n  "
shell `echo 1`                         | getIndentation=null  | handled=true  | -> "echo 1\n"
纯文本（未收录扩展）`    foo`           | getIndentation=null  | handled=true  | -> "    foo\n    "
md 围栏内 `  beta();`                  | getIndentation=null  | handled=true  | -> "```js\n  beta();\n  "
md 缩进代码块 `    foo`                | getIndentation=null  | handled=true  | -> "    foo\n    "
md 正文段落 `hello`                    | getIndentation=null  | handled=true  | -> "hello\n"
md 列表 `- alpha`                      | getIndentation=null  | handled=true  | -> "- alpha\n- "
md 嵌套 `  - bravo`                    | getIndentation=null  | handled=true  | -> "- alpha\n  - bravo\n  - "
md 有序 `1. uno`/`2. dos`              | getIndentation=null  | handled=true  | -> "1. uno\n2. dos\n3. "
md 引用 `> quoted`                     | getIndentation=null  | handled=true  | -> "> quoted\n> "
[反证] 列表里不走上游、直接 insertNewlineAndIndent | getIndentation=null  | handled=true  | -> "- alpha\n"
md 围栏内 `- x` 走上游                   | getIndentation=null  | handled=false | -> null
md 围栏内 `- x` 走本 change 的命令        | getIndentation=null  | handled=true  | -> "```\n- x\n"
```

读法（四条结论）：

1. **有缩进规则的语言给真语法缩进**（`getIndentation=2` → 新行两个空格）。
2. **没有缩进规则的语言给「沿用当前行缩进」**（`getIndentation=null` → 落回 `countColumn` 那条
   回落；当前行无空白时结果就是裸换行）。
3. **md 里 `getIndentation` 恒为 `null`** ⇒ 围栏 / 缩进代码块一律「沿用当前行缩进」；
   **正文段落**（行首无空白）结果与现状一致（裸换行）。
4. **上游在列表 / 引用里 `handled=true`、在围栏里 `handled=false`** ⇒ 委派策略（§2.1）恰好等于
   「只接管本来没人管的那部分」；反证一行同时证明：**若不加委派直接走 `insertNewlineAndIndent`，
   列表续行会被打断**（`- alpha\n`，标记没了）——即 D4a「不动列表续行」必须靠委派实现，不能靠
   我们的命令自己判断。

### 4.1 写验收场景时的一个实测陷阱（见证字符会破坏语法缩进）

本套件的键盘场景惯例是「先键入一个见证字符 `q` 并回读」来钉住落点（场景 43 的写法）。但在本能力
上，**见证字符会改变语法上下文**：实测（同一探针，js 语言）

```
"const alpha = () => {"   | getIndentation=2 | -> "const alpha = () => {\n  "
"const alpha = () => {q"  | getIndentation=0 | -> "const alpha = () => {q\n"
"if (x) {"                | getIndentation=2 | -> "if (x) {\n  "
"if (x) {q"               | getIndentation=0 | -> "if (x) {q\n"
```

⇒ 场景 MUST NOT 把见证字符放在触发行（`{` 所在行）的行尾。§7 的草案改用
**`recordEditor` 基线 + `editor.changedSince`** 作「Enter 确实落地」的正观测，见证字符只放在
不受语法影响的行上（或不用）。

## 5. 备选方案与否决理由

| # | 备选 | 否决理由 |
|---|---|---|
| V1 | `Enter` 进统一键位表 `KEY_BINDINGS`（获得 `[keys]` 可重绑与面板可见性） | 与表内「命中即消费、MUST NOT 放回原生路径」的纪律冲突（§1.3）：表内 `Enter` 在 md 列表里要么吞掉上游续行、要么放回原生，二选一都是缺陷；表内绑定也无法表达「光标在围栏代码块内」这个判据。见 D1 |
| V2 | 给 `markdown()` 接 `codeLanguages`，让围栏内容有子语言 ⇒ 围栏内也拿到真语法缩进 | 改 md 模式解析管线（M138 刻意选择装饰层着色，理由见 `src/preview/code.ts:1-10`），牵动打开 / 击键的解析成本，需要独立的测量面与验收面 ⇒ 另立项。见 D3 |
| V3 | 自写 per-language 缩进表（不看 parser 的 `indent`） | 与既有单一来源冲突：语言注册表（`src/preview/code.ts` 的 `LANGUAGES`）已经是 code 模式与围栏着色共用的真源，再加一张缩进表 = 第二份真源、两处必然漂移（REVIEW.md 第 8 条）。且 18 门语言自带规则，自写只会更差（更要紧的是：自写的那张表会与注册表漂移） |
| V4 | 用 `indentOnInput()`（打字即重排缩进）扩展代替键位 | 那是另一个能力（改动既有行的缩进），会碰用户手写的对齐（表格、续行、多行字符串），验收面完全不同；`Enter` 只插新行、不动旧行 |
| V5 | 把 `Enter` 交给 `keys.ts` 的 window 层，靠「让路」规则自然分派 | `keys.ts` 的让路判据是 `event.defaultPrevented`（`src/keys.ts:712-717`），而 CM 的 keymap 只有在**命中**时才 `preventDefault`——上游在围栏 / 段落里返回 `false`，事件没被消费，window 层会拿到它并「命中即消费」⇒ 列表 / 引用处与围栏处**由同一个绑定处理，无法区分**，仍要回头在命令里判上下文，等于把 V1 的缺陷原样搬一遍 |

## 6. 裁决项

见 `proposal.md` 的「待 Alex 裁决」表（D1 机制落点 / D2 默认值 / D3 围栏内的缩进口径 /
D4 与 md 列表续行的关系 / D5 `auto_indent = false` 的作用面），五条均给出推荐项与一句话理由；
推荐项与本文件的 §2 / §3 一一对应。落槌后先回改 `specs/` 增量与 `tasks.md`，再动代码。

## 7. 真机验收场景草案（实现期落为 `scripts/acceptance/scenarios/59-enter-auto-indent.md`）

场景号 59 由 tower registry 派定（HANDOFF 的占用表：「M264 起从 **59** 派」）。fixture 与
`ctrl+n` 次数在实现期按实际文件核对；`Enter` 的注入键名是 `return`（既有场景 13 / 30 / 31 / 32 的
用法），它**不在**套件的「键不可达」清单里，但属 chord 类注入（盲发、不重试）⇒ 负向断言一律配
`editor.changedSince` 作正观测（见 §4.1），红了先按丢键复跑一次（README 的既有纪律）。

```markdown
---
id: "59-enter-auto-indent"
item: 59
title: Enter 自动缩进的真机链路——code 模式继承语法缩进、无缩进规则的语言沿用当前行、md 围栏内沿用当前行且不续列表标记、md 列表续行不变、auto_indent=false 回退
fixtures: [enter-indent.js, enter-indent.toml, enter-indent.md, enter-indent-list.md, enter-indent-fence.md]
open: enter-indent.js
marker: "const alpha"
steps:
  # 用例 1：code 模式 · 有缩进规则的语言（语法缩进）
  - name: 起点：js fixture 进 vault、打开且光标落在第 1 行（`const alpha = () => {`）
    do: clickEditor
    expect:
      - label: 打开成功，渲染态可读
        editor: { has: "const alpha = () => {" }
      - label: 起点没有缩进行（后面的逆向断言以它为前提）
        file: { path: enter-indent.js, not: "/^  $/" }
      - label: 起点干净
        ax: { not: "（未保存）" }
      - shot: 起点
  - name: 光标移到第 1 行行尾（⌃E 是 editor 作用域绑定；落点由下一步的 Enter 结果反证）
    do: key
    key: "ctrl+e"
  - name: 按 Enter（第 1 行以 `{` 结尾 ⇒ 语法缩进应给 2 空格）
    do: key
    key: "return"
  - name: 等自动保存落盘（2s 防抖，刻意不用 ⌘S）
    do: sleep
    ms: 2600
    expect:
      - label: 源文件出现「只有两个空格」的新行 —— 语法缩进落地的唯一正判据
        file: { path: enter-indent.js, has: "/^  $/" }
      - label: 触发那一行逐字节未动
        file: { path: enter-indent.js, has: "/^const alpha = \\(\\) => \\{$/" }
      - shot: code-模式-语法缩进

  # 用例 2：code 模式 · 无缩进规则的语言（沿用当前行行首空白）
  - name: 打开 toml fixture（第 2 行 `  [a]` 带两空格）
    do: open
    file: enter-indent.toml
    marker: "[a]"
  - name: 建立编辑器焦点（点编辑器顶边；键盘注入的前置，`open` 之后焦点在树行上）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 光标移到第 2 行行尾
    do: keys
    keys: ["ctrl+n", "ctrl+e"]
  - name: 按 Enter
    do: key
    key: "return"
  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: 新行沿用该行的两个空格（不是行首、也不是凭空一层）
        file: { path: enter-indent.toml, has: "/^  $/" }
      - label: 原行逐字节未动
        file: { path: enter-indent.toml, has: "/^  \\[a\\]$/" }
      - shot: toml-沿用当前行

  # 用例 3：md 正文段落 · 平换行（与现状一致）
  - name: 打开 md fixture（光标点顶边后落在第 1 行 = 标题行 `# enter indent`）
    do: open
    file: enter-indent.md
    marker: "enter indent"
  - name: 建立编辑器焦点
    do: clickEditor
  - name: 记录编辑器文本基线（Enter 到底有没有落地，靠它判）
    do: recordEditor
    as: 段落基线
  - name: 按 Enter
    do: key
    key: "return"
  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: 正观测：Enter 确实落地（文档变了）——本场景的「不缩进」断言必须配它，否则丢键会假绿
        editor: { changedSince: 段落基线 }
      - label: 段落行不缩进（MUST NOT 凭空加缩进）
        file: { path: enter-indent.md, not: "/^  $/" }
      - shot: md-段落-平换行

  # 用例 4：md 列表续行 · 与 change 之前逐字节一致（上游既有行为，本 change 委派）
  - name: 打开列表 fixture
    do: open
    file: enter-indent-list.md
    marker: "alpha"
  - name: 建立编辑器焦点
    do: clickEditor
  - name: 光标移到 `- alpha` 行尾
    do: keys
    keys: ["ctrl+n", "ctrl+e"]      # 次数按 fixture 实际行号核对
  - name: 按 Enter
    do: key
    key: "return"
  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: 续写同级标记（`- ` 行出现）—— 上游续行未被本 change 打断的唯一判据
        file: { path: enter-indent-list.md, has: "/^- $/" }
      - label: 原项逐字节未动
        file: { path: enter-indent-list.md, has: "/^- alpha$/" }
      - shot: md-列表-续行不变

  # 用例 5：md 围栏代码块内 · 沿用当前行缩进，且不把它当列表
  - name: 打开围栏 fixture
    do: open
    file: enter-indent-fence.md
    marker: "beta();"
  - name: 建立编辑器焦点
    do: clickEditor
  - name: 光标移动到块内那一行行尾
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+e"]   # 次数按 fixture 实际行号核对
  - name: 按 Enter
    do: key
    key: "return"
  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: 新行沿用块内该行的两个空格
        file: { path: enter-indent-fence.md, has: "/^  $/" }
      - label: 块内的 `- x` 行 MUST NOT 被续写成列表（围栏内是代码文本）
        file: { path: enter-indent-fence.md, not: "/^- xq?\\n- /" }
      - shot: md-围栏内-沿用缩进

  # 用例 6：auto_indent = false ⇒ 只回退本 change 新增的两处（D5a）
  # 6a：md 列表续行不受本键影响（它仍是上游行为；这里的基线比较是「Enter 确实又落了一次」的正观测）
  - name: 记下列表 fixture 当前落盘状态（用例 4 之后它已含一个 `- ` 行；基线用于 6a 的 changedSince）
    do: record
    as: 列表基线
    file: enter-indent-list.md
  - name: 配置写入 `editor.auto_indent = false`（需要套件支持这个键）并重启
    do: configWrite
    autoIndent: false
  - name: 重开列表 fixture
    do: open
    file: enter-indent-list.md
    marker: "alpha"
  - name: 建立编辑器焦点
    do: clickEditor
  - name: 光标移到 `- alpha` 行尾
    do: keys
    keys: ["ctrl+n", "ctrl+e"]      # 次数按 fixture 实际行号核对
  - name: 按 Enter
    do: key
    key: "return"
  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: 正观测：文件又变了（Enter 落地）
        file: { path: enter-indent-list.md, changedSince: 列表基线 }
      - label: 列表续行照旧 —— 本键 MUST NOT 把上游的续行一起关掉
        file: { path: enter-indent-list.md, has: "/^- $/" }
      - shot: 关配置-md-列表仍续行
  # 6b：code 模式的自动缩进回退
  - name: 重开 js fixture（光标点顶边后落在第 1 行）
    do: open
    file: enter-indent.js
    marker: "const alpha"
  - name: 建立编辑器焦点
    do: clickEditor
  - name: 记录编辑器文本基线
    do: recordEditor
    as: 关配置基线
  - name: 光标到行尾后按 Enter
    do: keys
    keys: ["ctrl+e", "return"]
  - name: 等自动保存落盘
    do: sleep
    ms: 2600
    expect:
      - label: 正观测：Enter 确实落地
        editor: { changedSince: 关配置基线 }
      - label: 无缩进行 ⇒ code 模式回到本 change 之前的行为
        file: { path: enter-indent.js, not: "/^  $/" }
      - shot: 关闭配置-回退
---
```

fixture 设计（实现期创建，内容与上面的行号 / `ctrl+n` 次数必须一致）：

| fixture | 内容要点 | 服务用例 |
|---|---|---|
| `enter-indent.js` | 第 1 行 `const alpha = () => {`；全文**没有**只含空白的行、没有恰好两空格的行 | 1、6 |
| `enter-indent.toml` | 第 2 行 `  [a]`（带两空格，toml 无缩进规则） | 2 |
| `enter-indent.md` | 第 1 行 `# enter indent`；不含只含空白的行 | 3 |
| `enter-indent-list.md` | 一行 `- alpha`（前后可有标题 / 空行） | 4、6 |
| `enter-indent-fence.md` | 一个 ```js 围栏，块内依次 `  beta();` 与 `- x` | 5 |

**场景 MUST NOT** 把见证字符放在 `{` 所在行的行尾（§4.1 实测），也 MUST NOT 在
`auto_indent = false` 的用例里只用 `not` 断言（丢键会假绿）——两条都已在本草案的写法里规避。

### 7.1 套件侧要改的两处（随实现同 PR）

1. `scripts/acceptance/lib/app.mjs` 的 `writeConfig()`：多认 `autoIndent`（`editor.auto_indent`）。
2. `scripts/acceptance/lib/execute.mjs` 的 `configWrite` case：`autoIndent` 缺省**沿用当前值**
   （与 `theme` / `contentWidth` 同形，否则一次 `configWrite` 会把它悄悄抹掉）。README 的
   `configWrite` 行同步补一个键名。

## 8. 验证计划（三层，各管一段，别重复也別留缺口）

| 层 | 文件 | 管什么 |
|---|---|---|
| unit（`node tests/unit/run.mjs`） | `tests/unit/enter-indent.test.ts`（新）+ 配置单测 | 判定与配置口径：三态（键缺失 = `true` / 显式 `true` / 显式 `false`）、类型不符 ⇒ 整文件回落；`getIndentation` + 回落口径的矩阵（有规则 / 无规则 / 空行首 / md 围栏），用真 `EditorState`（先例 `cell-geometry.test.ts`） |
| chromium（`tests/visual/scenes/`） | `m264-enter-auto-indent.spec.ts`（新） | **键位链路**：真 CM view + 真实 DOM `KeyboardEvent`（`page.keyboard.press("Enter")`）→ 命令 → 文档。覆盖：code 模式语法缩进、md 围栏内沿用缩进、md 列表续行不被本 change 打断、`auto_indent = false` 回退、`Shift-Enter` 维持裸换行。先例 `m239-list-tab-indent.spec.ts`（同一层解决过「KimiCU 注入不落地」的键） |
| 真机（`node scripts/acceptance/run.mjs 59`） | `scripts/acceptance/scenarios/59-enter-auto-indent.md` | WKWebView 下的按键 → 落盘闭环、自动保存时序、`configWrite` 重启后的回退 |

视觉基线：新增 chromium 场景**只做文档文本断言**（`readDocument`），不引入像素断言 ⇒ 预计零基线
更新；若实现触发了任何整页像素差异，按缺陷处理并按 AGENTS.md 的硬规则走 Alex 人肉过目。
