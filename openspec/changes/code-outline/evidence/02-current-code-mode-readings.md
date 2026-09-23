# 证据 02：code 模式（StreamLanguage）的语法树形态与现状读数

本文件是同批两份提案共用的现场记录——[code-outline](../proposal.md) 与 [code-variable-highlight](../../code-variable-highlight/proposal.md) 的 Why 都引用它。两份提案的 design.md §1 也以它为依据。

## 环境与复现

- 日期：2026-09-24；机器：Alex 的本机（macOS）；Node v26.10.0。
- 跑的是 **master 上的源码**（只读；探针脚本在 `/tmp/probe-m192/`，不入仓）：`src/preview/code.ts` 的 `LANGUAGES` 与 `@codemirror/*` 依赖来自主 checkout。
- 命令（`node_modules` 只在主 checkout 里，故 cwd 取主 checkout；脚本本身在 `/tmp`）：

```bash
cd /Users/boxcounter/Code/Boxcounter/lumir
node --experimental-strip-types --import ./tests/unit/register.mjs /tmp/probe-m192/probe.mjs
node --experimental-strip-types --import ./tests/unit/register.mjs /tmp/probe-m192/probe2.mjs
```

- 口径声明 1：探针在 **headless EditorState** 上跑，不经视图、不经 WKWebView。数值是**下界**，只用于「同一次探针内的相对比较」，MUST NOT 当作真机或产品端点读数。
- 口径声明 2：`ATXHeading` 的判定内联了 `src/toc.ts:119-141`（`extractHeadings`）的同一正则 `^ATXHeading([1-6])$` 与 `tree.iterate` 口径。内联而不 import 的原因：`src/toc.ts` 的传递依赖 `src/preview/frontmatter.ts:105` 用了构造器参数属性，Node 的 strip-only 类型剥离加载不了它（`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`，实测）。因此本读数**只复刻了那种判定，不覆盖 frontmatter 排除那一步**——排除 frontmatter 与本结论无关。

## 读数 1：code 模式的树是扁平的 token 序列

输入（`.ts` 语料）：

```ts
// 工具模块
const LIMIT: number = 42;

export class Util {
  greet(name: string): string {
    return "hello " + name;
  }
}
```

`EditorState.create({ doc, extensions: [LANGUAGES.typescript] })` → `ensureSyntaxTree` → 游标遍历：

```
code 模式（.ts → LANGUAGES.typescript / StreamLanguage）
  distinct node names: 11
  top: keyword:7 variableName.definition:5 typeName:5 operator:3 variableName.local:2
       Document:1 comment:1 number:1 propertyName:1 string:1 variableName:1
  ATXHeading 命中（toc.toggle 的条目数）: 0

游标顺序前 18 个节点：
  Document [0,121)
    comment [0,7)
    keyword [8,13)
    variableName.definition [14,19)     ← `LIMIT`
    typeName [21,27)
    operator [28,29)
    number [30,32)
    keyword [35,41)
    keyword [42,47)
    variableName.definition [48,52)     ← `Util`
    propertyName [57,62)                ← `greet`
    variableName.definition [63,67)     ← `name`
    typeName [69,75)
    typeName [78,84)
    keyword [91,97)
    string [98,106)
    operator [107,108)
    variableName.local [109,113)        ← `name`（函数体里那次引用）
  节点总数: 18   max depth: 1
  Document 的直接子节点数: 17（= 全文 token 数）
```

对照组：

```
对照 1：同一段文本走 lezer markdown parser（非 md 文件不装它）
  distinct node names: 2（Paragraph:3 Document:1）   ATXHeading: 0
对照 2：真 md 文档（`# 甲` + `## 乙`）
  distinct node names: 5（HeaderMark:2 Document:1 ATXHeading1:1 ATXHeading2:1 Paragraph:1）
  ATXHeading: 2   → extractor 本身工作正常
```

**结论（两份提案共同依据）**：

1. `max depth: 1` + 「`Document` 的直接子节点数 = 全文 token 数」= **扁平结构**：整篇文档只有一层 token 叶节点，没有函数 / 类 / 方法 / 常量这类带名字与范围的声明节点。
2. 节点名（`variableName.definition` / `variableName.local` / `propertyName` / `typeName` / `keyword` / `string` / `comment` / `number` / `operator`）是 **token 级分类**：它标的是「这一段上什么色」，不带符号名、不带范围、不带嵌套关系。举例：`greet(name: string): string {` 这一行碎成 `propertyName` + `variableName.definition` + `typeName` + `typeName`，看不出「这是 `Util` 的一个方法、它叫 `greet`、它有一个参数 `name`」。
3. 于是今天在一个 `.ts`/`.py`/… 文件里按 `⌘⇧O`（`toc.toggle`）拿到 0 条条目，命中空态提示「这份文档还没有标题，大纲为空」（D84）——**这句话在代码文件上是错的**。
4. 同一段代码交给 markdown parser 也拿不到任何结构（判据都不存在），所以「用 md parser 兜底」在代码文件上没有出路。
5. 「语法上的变量」（双击高亮的诉求）在扁平 token 树上同样不可判：`variableName.definition` 与 `variableName.local` 的区分只是**类别**，判不了「这两个 `name` 是不是同一个变量」（`greet(name)` 的参数 vs 函数体里的 `name` 引用在这里恰好同类，语义上的同 binding 无从确认，也判不了遮蔽）。

## 读数 2：现状（StreamLanguage 全量解析）的耗时基线

同一探针，headless，`ensureSyntaxTree(state, doc.length, 60000)`，median of 5：

| 语料 | 现状耗时 |
|---|---|
| 100KB `.ts` | 7.9 ms |
| 1MB `.ts` | 69.5 ms |
| 1MB `.py` | 104.2 ms |

口径声明 3：**产品里不是这么跑的**——code 模式只按视口增量解析（CM 默认行为），滚动到哪解析到哪；上表量的是「把整篇文档一次解析完」的成本，用来回答「若为了结构而全文解析一次，量级是多少」。它是下界（不含视图、WKWebView、真实打开路径），MUST NOT 当作达标证据。

## 本文件不覆盖的读数

- lezer 解析器的可用性 / 体积 / 结构节点 / 解析耗时：见 [evidence/01-language-stack-survey.md](01-language-stack-survey.md)。
- 视图层与真机层的读数（装饰重绘、浮层观感、双击落点手感）：归实现期的视觉场景与真机场景，本提案不宣称已验。
