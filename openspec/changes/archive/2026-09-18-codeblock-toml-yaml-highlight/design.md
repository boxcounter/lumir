# Design: codeblock-toml-yaml-highlight

本文件承载提案的技术依据：现场实测、注册点盘点、修复设计、parity 校验方法、边界清单。

## 1. 现场实测（master@2f16f86）

### 1.1 方法与可复跑性

用仓内现成的视觉设施在**真实渲染**下取计算色，不做读代码推断：

- 起 `vite` dev server（端口 4299，与 Alex 手头的 1420 隔离）指向**主 checkout 的 src**（本 worktree 无 `node_modules`，无法自建构建；内容与 master 一致），用 `tests/visual/scenes/tauri-stub.ts` 给浏览器打 Tauri 桩，`page.goto("/")` 后点文件树打开笔记，逐 `.cm-line` dump `getComputedStyle` 的色值与 span 类名。
- 探针与日志（本机、git 外，同 `test-results/` 的留存惯例）：
  - `/tmp/lumir-probe-m167/`：`m167.spec.ts`（fence 放置边界 + code 模式文件）、`real.spec.ts`（真实 vault 块）、`real.log`（逐 span dump）、`placements.png`、`real.png`
  - `/tmp/lumir-probe/`：`toml-yaml.spec.ts`（合成块）、`extended.spec.ts`（边角）、`codemode2.spec.ts`（code 模式）、`evidence.spec.ts`（本 change 的截图与整体 token 普查）
  - 运行：`cd tests/visual && ./node_modules/.bin/playwright test --config /tmp/lumir-probe/playwright.config.ts <spec>`
- **入 git 的证据**（`evidence/`，随本 change 一起评审）：
  - [`01-yaml-block-as-is.png`](evidence/01-yaml-block-as-is.png)：Alex 真实 vault 那个 `yaml` 块的**实现前**现状截图
  - [`02-toml-block-as-is.png`](evidence/02-toml-block-as-is.png)：toml 块的实现前现状截图（对照）
  - [`03-复核记录.md`](evidence/03-复核记录.md)：前提复核底稿（注册点、迁移历史、语料普查、命令原样抄录）

### 1.2 决定性证据：Alex 真实 vault 里的实际块

源：`/Users/boxcounter/Downloads/Everything-copy/4_Archives/Engineering/Logbook/README.md` 的第一个围栏块（```yaml，30 行，`dimensions:` 表），**原样**渲染（只读 vault，不改动）。

首个块（14 个着色 span）：

| 源码 | legacy token | 类名 / 计算色 |
|---|---|---|
| `dimensions` / `name` / `key` / `source` / `values`（**键**，共 13 处） | `atom` | `cm-lp-tok-literal` / `rgb(160, 94, 28)` |
| `# 特殊维度：values 来自当月 _monthly.md` | `comment` | `cm-lp-tok-comment` / `rgb(141, 132, 113)` |
| `Goal` / `monthly` / `Slax Reader` / `ZSXQ` …（值） | `null` | 无 span，正文色 `rgb(38, 34, 25)` |
| `-` / `:` | `meta` | 无 span，正文色 |

该笔记的另一块（含 `commitments`、45 行）合计：**39 个 `cm-lp-tok-literal` + 1 个 `cm-lp-tok-comment`**，`property` / `string` / `keyword` **零命中**（`/tmp/lumir-probe-m167/real.log`）。即**整块只出一种颜色**——键的赭色与值的正文色之外没有任何区分，这就是「看起来没有高亮」的可复现来源（截图 `evidence/01-yaml-block-as-is.png`）。

### 1.3 语料普查：报告里的「toml / yml」在可触及语料里没有现场

在 Alex 真实 vault 上复跑（只读）：

```
$ find . -name '*.md' | wc -l                                    # 1525
$ rg -o '^[[:space:]]*(```|~~~)[A-Za-z0-9._-]*' --glob '*.md' . \
    | sed 's/.*[`~]//' | sort | uniq -c | sort -rn
    227 markdown  194 json  101 sql  100 bash  72 rust  51 ts  28 typescript
     28 javascript  21 html  11 text   8 yaml   5 mermaid   5 js   4 python
      4 awk   3 xml   2 shell   2 css   1 …（其余各 1）
$ rg -n '^\s*(```|~~~)(toml|yml)' --glob '*.md' .                # 0 命中
```

`vault` 里的 `.yml` 文件只有隐藏目录下的 `.ok/config.yml` 一份（其余命中全在某个 `node_modules/` 里）。仓内与合成验收 vault `/tmp/lumir-m102-acceptance` 同样没有 toml / yml 围栏。

**结论**：Alex 的「toml 和 yml 代码块」在可触及的语料里找不到对应现场，`yaml` 围栏有 8 处（其中一处即 §1.2 复现的那个块）。因此本 change 以 **yaml** 的可复现缺陷为修复面，toml 只做现状核实与门禁覆盖。

### 1.4 合成块：toml 现状正常、yaml 逐 token 全貌

| 语言 | 源码 | legacy token | 类名 / 计算色 |
|---|---|---|---|
| ```toml | `[package]` / `[[hooks]]` | `atom` | `cm-lp-tok-literal` / `rgb(160, 94, 28)` |
| | `name` / `port` / `event` | `property` | `cm-lp-tok-property` / `rgb(79, 111, 143)` |
| | `"lumir"` / `"PreToolUse"` | `string` | `cm-lp-tok-string` / `rgb(90, 122, 63)` |
| | `1420` / `true` / `1979-05-27` | `number` / `atom` | `cm-lp-tok-literal` |
| | `# comment` | `comment` | `cm-lp-tok-comment` / `rgb(141, 132, 113)` |
| ```yaml / ```yml（两者逐条相同） | 键（`name`/`port`/`hooks`/`matcher`） | `atom` | `cm-lp-tok-literal` / `rgb(160, 94, 28)` |
| | `Alex`、列表标量 `a` | `null` | 无 span，正文色 |
| | `1420` | `number` | `cm-lp-tok-literal` |
| | `true` / `false` | `keyword` | `cm-lp-tok-keyword` / `rgb(178, 58, 44)` |
| | `"Bash"` | `string` | `cm-lp-tok-string` |
| | `# c` | `comment` | `cm-lp-tok-comment` |
| | `---` / `...` | `def` | 无 span（见 §6） |
| | `- ` / `:` | `meta` | 无 span |
| | `&a` / `*a` | `variable` | 无 span |

一处既有行为（本 change 不改）：yaml 键的 span 含前导缩进（如 `"    key"`），因为 `yaml.js` 的键正则 `^\s*` 把缩进吃进了 token。

### 1.5 边角放置（实测结果）

| 形态 | 结果 |
|---|---|
| 文档首行、引用（`>`）内、列表项内缩进、callout 内 | 正常着色 |
| 四反引号 ` ````toml `、`~~~toml` | 正常着色 |
| ```` ```toml title="t" ````（info string 带附加词） | 正常着色（只取首段） |
| ```` ```TOML ```` / ```` ``` yml ```` | 正常着色（trim + 小写） |
| ```` ```.toml ```` | **不着色**（见 §2.2） |
| ```yaml 内容为纯列表（`- a`） | **整块不着色**（parser 只给 `meta` 与 `null`） |

### 1.6 只读 code 模式（`.toml` / `.yml` / `.yaml` 文件）

同一套 token、同一套计算色，逐条与 §1.4 的围栏结果相等：`config.toml` 键 `rgb(79, 111, 143)`、字符串 `rgb(90, 122, 63)`、数字 `rgb(160, 94, 28)`、注释 `rgb(141, 132, 113)`；`config.yml` / `config.yaml` 键 `rgb(160, 94, 28)`（字面量色）、`"Bash"` `rgb(90, 122, 63)`。**M138 的 parity 不变量在 toml/yaml 上当前成立**（两侧类名生成方式不同：围栏用 `cm-lp-tok-*`、code 模式用 CM6 自动生成的 `ͼ*` 类名，色值相同）。

### 1.7 vendored 依赖核实

- 版本：`@codemirror/legacy-modes` **6.5.4**（`node_modules/@codemirror/legacy-modes/package.json` 的 `version`；声明在根 `package.json:18` 的 `^6.5.4`）。
- 模式文件**都在**，无需替代来源：
  - `node_modules/@codemirror/legacy-modes/mode/toml.js`（导出 `toml`；同目录另有 `.cjs` / `.d.ts`）
  - `node_modules/@codemirror/legacy-modes/mode/yaml.js`（导出 `yaml`；同目录另有 `.cjs` / `.d.ts`）
- 两者从 M138 起就被本仓引用（`src/preview/code.ts:31-32` 的 import）。

## 2. 注册点与信息流盘点（M138 → M152 拓扑）

### 2.1 单一来源与两个消费侧

| 环节 | 落点 |
|---|---|
| 语言注册表（parser 实例） | `src/preview/code.ts:75-97` 的 `LANGUAGES`（`json` `:86`、`toml` `:87`、`yaml` `:88`） |
| fence 别名表 | `src/preview/code.ts:99-125` 的 `ALIASES`（**`yml → yaml` 在 `:121`**） |
| info string 解析 | `src/preview/code.ts:259-267`（`isRegisteredLanguage` / `resolveLanguage`：`trim` → 取首个空白分隔段 → 小写 → 别名归一 → 查表） |
| 着色入口 | `src/preview/code.ts:331-342` 的 `highlightCode`（超上限返回空，上限在 `:252` 的 `MAX_HIGHLIGHT_CHARS` = 64 KiB） |
| token 名 → tag | `src/preview/code.ts:190-203` 的 `LEGACY_TAGS`（复刻 CM6 的 defaultTable 别名）＋ `:205` 的 `TAG_TABLE`（`@lezer/highlight`）＋ parser 自带的 `tokenTable`；次序见 `:207-240` 的 `tagsForStyle` |
| tag → 语义分组 | `src/preview/code.ts:128`（`TokenRole`）＋ `:145-155`（`TOKEN_GROUPS`，**单一来源**；字面量组 `:152` 含 `tags.atom`，属性组 `:153`） |
| 围栏侧渲染 | `src/preview/code.ts:161-163` 出 `cm-lp-tok-<role>` 类名；色值在 `src/preview/theme.ts:63-68`；挂载点 `src/preview/livePreview.ts:618-635`（`collectCodeTokens`）与 `:792-798`（`FencedCode` / `CodeBlock` 分支） |
| code 模式侧渲染 | `src/editor.ts:25` import `LANGUAGES`/`TOKEN_GROUPS`；`:938-944` 的 `codeLanguageFor` 按扩展名取语言；`:949-962` 的 `codeHighlight` 用同一份 `TOKEN_GROUPS` 定义内联色值 |
| 扩展名 → 语言名 | `src/preview/attachments.ts:33-68` 的 `CODE_EXTENSIONS`（`toml` `:54`、`yaml` `:55`、`yml` `:56`）；`CodeLanguage` 联合类型由它推导，`LANGUAGES` 的 `Record<CodeLanguage, …>` 是编译期合同 |

**迁移历史**（核过，不是推断）：`git show ca81b7c:src/preview/code.ts | grep -n 'toml\|yaml\|yml'` → 26 / 27 / 58 / 59 / 92 行（M138 就有）；`git show 6e8e70a -- src/preview/code.ts | grep -c '^[-+].*toml\|^[-+].*yaml'` → 0（M152 未触碰）。

**结论**：`toml` / `yaml` / `yml` 三个 fence 名与两个扩展名当下都能命中注册表；两处消费侧共用同一份 `LANGUAGES` 与 `TOKEN_GROUPS`，M138 的 parity 不变量是**结构性保证**。

### 2.2 info string 归一化的实测边界（本 change 只记录不改）

对同一段 `name = "x"` 逐个 info string 实测（`highlightCode` 非空即「命中」）：

| 形态 | 结果 |
|---|---|
| `toml`、`TOML`、`tOmL`、`toml `（尾随空格）、` yml `、`yaml title="x"`、`yaml` + 不换行空格（U+00A0）、BOM（U+FEFF）前缀 | **命中**（`trim` + 小写 + 取首段） |
| `.toml`、`.yml`、`config.toml`、`toml;`、`yml,`、首字符为零宽空格（U+200B）的 `​yml` | **静默纯文本**（不在别名表内，且 U+200B 不是 `trim` 认可的空白） |

## 3. 修复设计（yaml 键取属性色）

### 3.1 为什么 `atom` 在 yaml 里等价于「键」

`node_modules/@codemirror/legacy-modes/mode/yaml.js` 全文只有一处 `return "atom"`，位于「pairs → key」分支：

```js
if (!state.pair && stream.match(/^\s*(?:[,\[\]{}&*!|>'"%@`][^\s'":]|[^,\[\]{}\#&*!|>'"%@`])[^#]*?(?=\s*:($|\s))/)) {
  state.pair = true;
  state.keyCol = stream.indentation();
  return "atom";
}
```

其余产出是 `comment` / `string` / `def` / `meta` / `variable` / `number` / `keyword` 与**普通标量值的 `null`**（兜底 `stream.next(); return null;`），因此把 `atom` 重映射为属性名不会牵连值、数字或布尔。

### 3.2 改动形态（与 M147 的 json 同机制、同挂点）

```ts
/** yaml 专属 tokenTable：legacy yaml mode 用 `atom` 标记键（yaml.js 全文唯一一处 return "atom"）。 */
export const YAML_TOKEN_TABLE: TokenTable = { atom: tags.propertyName };

export const LANGUAGES: Record<CodeLanguage, StreamLanguage<unknown>> = {
  // …
  yaml: StreamLanguage.define({ ...yaml, tokenTable: YAML_TOKEN_TABLE }),
};
```

- 挂点在**单一来源**处（`src/preview/code.ts` 的 `LANGUAGES`），两处消费侧同时生效，`src/editor.ts` 与 `src/preview/theme.ts` 不动。
- 两侧解析次序一致：`tagsForStyle`（围栏，`src/preview/code.ts:221-240`）与 CM6 的 `createTokenType`（code 模式）都按「parser 的 `tokenTable` 优先于 `@lezer/highlight` 的 tags」解析——M147 已用对照实验验证过这条次序，本 change 沿用。
- 预期结果：yaml 的键从 `cm-lp-tok-literal`（`rgb(160, 94, 28)`）变为 `cm-lp-tok-property`（`rgb(79, 111, 143)`），与 json / toml 的键同色。**不新增颜色**，色值仍出自既有 editorial token（[`01-yaml-block-as-is.png`](evidence/01-yaml-block-as-is.png) 与 [`02-toml-block-as-is.png`](evidence/02-toml-block-as-is.png) 是改动前后对照的「前」）。
- 缓存纪律（复核项，不新增逻辑）：`classOf` 的缓存键含语言名（`src/preview/code.ts:269-280`）——同一个 `atom` 在 yaml 落属性名、在 toml 落字面量，必须分语言缓存；既有实现已满足，实现期用回归断言钉住。

### 3.3 回归面

只有 yaml 一项受影响；其余 20 种语言的 parser 与 token 解析路径零变化。`highlightCode` 的复杂度、`MAX_HIGHLIGHT_CHARS` 安全阀与装饰层视口增量纪律（ADR 0002 §6）都不变。

## 4. toml 为什么不改（以及为什么不能照做）

### 4.1 `atom` 在 toml 里过载

`node_modules/@codemirror/legacy-modes/mode/toml.js` 有三处 `return "atom"`：节头 `[x]` / `[[x]]`、日期字面量、`true` / `false`。三者在 **token 名层面不可区分**，parser 级 tokenTable 只能按 token 名映射，无法「只改节头」。要区分只能改 vendored parser 自身（等于 fork 依赖），明确不做。

因此 toml 的现状（节头与布尔、日期同取字面量色）**保留**：它仍是有颜色区分的（键属性蓝、字符串绿、注释灰、字面量棕），观感与 rust / json 块同档（`evidence/02-toml-block-as-is.png`）。

### 4.2 其它不取色的 token 为什么不补

toml 数组的 `[` `]` 是 `bracket`、yaml 的结构标点是 `meta`——`@lezer/highlight` 里 `tags.bracket` / `tags.meta` 都存在，但**既有配色表没有这两个角色**，而 rust 的 `{}` `;`、json 的 `{` `}` 同样不取色。给它们补色要新增配色角色（进而改动全部语言的呈现），违反「token 色 MUST 只取既有 editorial token」的既有不变量，不在本 change 范围内。

## 5. parity 校验方法（沿用 M138 口径）

**口径定义**（M138 落地、M147 沿用）：同一段代码在「md 围栏代码块」与「整文件 code 模式」两条路径下，`token 原文 → tag → 计算色`逐条相等，MUST NOT 两侧漂移。

本 change 的校验分三层，全部落在 `tests/visual`：

1. **非 DOM 层**（`highlightCode` 直调，不依赖浏览器）：逐 token 断言 `from` / `to` / `cls`——键 = `cm-lp-tok-property`、引号值 = `cm-lp-tok-string`、布尔 = `cm-lp-tok-keyword`、数字与日期 = `cm-lp-tok-literal`、注释 = `cm-lp-tok-comment`；并按**输入维度扫描**（M147 的做法），不只钉一个 fixture：纯标量值、嵌套映射、列表、内联 `{a: 1}`、锚点与别名、无键的纯列表块、超 64 KiB 块。fixture 里 MUST 含 §1.2 那个真实块形态。
2. **DOM 层**（chromium 计算色）：md 文档里的围栏块断言 `span.cm-lp-tok-*` 的类名**与** `getComputedStyle` 色值；同内容的 `.yml` / `.toml` 只读文件断言计算色。两侧类名生成方式不同（围栏 `cm-lp-tok-*`、code 模式 CM6 自动生成的 `ͼ*`），**必须比色值而不是比类名**。整页基线守不住折叠线以下的代码块（M147 实证、本 change 的 `evidence/01` 就是被折叠截断的例子），因此补一张**元素级**基线（口径同 m133 / M147 的 `render-codeblock-json-line.png`）。
3. **反向验证**（[REVIEW.md](../../../../REVIEW.md) 第 1 条）：摘掉 `YAML_TOKEN_TABLE` 重跑，第 1、2 层的键色断言必须转红；改回后必须转绿。

补充两条既有口径的沿用：

- **64 KiB 安全阀同样适用**：超大 yaml/toml 围栏 MUST 不着色（与 M138 对 rust 的断言同口径），本次不改该常量。
- **既有整页基线零变更**：yaml / toml 此前不在 fixture 里，其键色从未进过任何整页基线；实现期按 M147 的做法实测核对（全量无 `--update` 通过 + 相关基线 sha256 对照），新增基线 `--update` 前截图须 Alex 过目（AGENTS.md 硬规则、[tests/visual/README.md](../../../../tests/visual/README.md)）。
- **新增整页基线的容差必须覆盖**（实现期实测，[REVIEW.md](../../../../REVIEW.md) 第 3 条的新现场）：把 yaml 的键色改回旧值（键回到字面量赭色）后，新增那张 1200×800 的整页基线差异是 **958 像素**，而全局 `maxDiffPixelRatio` 0.001 的额度是 **960 像素**——差 2 像素就静默通过。故该断言显式覆盖为 0.0005（480 像素，留 2 倍余量）；元素级那张（766×29）额度 22 像素、差异 92 像素，不受此问题影响。这次「改回旧值跑一遍看红不红」的反向验证连同两个读数记在 `tasks.md` 的 3.7。

## 6. 边界与已知缺口（本 change 只记录、不修）

| 现象 | 根因 | 处置 |
|---|---|---|
| yaml 普通标量值无 token（`Goal`、`Slax Reader` 取正文色） | `yaml.js` 兜底 `stream.next(); return null;` | 不修：vendored parser 的 token 产出，两侧一致 |
| yaml `---` / `...` 无颜色 | `yaml.js` 返回 `def`；`LEGACY_TAGS`（`src/preview/code.ts:194`）把 `def` 映射为 `definition(variableName)`，不属任何分组 | 不修：`def` 在 yaml 是文档分隔符、在别的语言是定义，语义撞名；补色要新增角色 |
| yaml 锚点与别名 `&a` / `*a` 无颜色 | 返回 `variable` → `tags.variableName` 不在任何分组 | 不修：同上 |
| yaml `:` / `- ` / 内联括号无颜色 | 返回 `meta` | 不修：与全仓「标点不取色」一致（rust 的 `{}` `;` 同） |
| 无键的 yaml 块（纯列表 / 纯标量）整块不着色 | parser 只给 `meta` 与 `null` | 不修：vendored parser 的能力边界，两侧一致；作为已知边界写进 spec 的 scenario |
| 带引号的键（`"k": v` / `'k': v`）取字符串色 | `yaml.js` 的引号分支排在键判定之前，产出 `string` token（与引号值同一个 token 名，`mode/yaml.js:16-17`） | 不修：token 名层面分不开键与值，要分开须改 vendored parser；已写成 spec 的边界 scenario（实现期实测：`"quoted key": v` → `cm-lp-tok-string`） |
| toml 节头 `[x]` 与布尔、日期同色 | `atom` 过载（§4.1） | 不修：需 fork parser |
| ```` ```.toml ```` / ```` ```config.toml ```` / 零宽空格前缀 | §2.2 的归一化边界 | 不修：放宽别名面需要需求证据；记录在案 |
| 围栏 yaml 键的 span 含前导缩进 | `yaml.js` 键正则 `^\s*` 消耗缩进 | 不修：与 code 模式的 span 边界一致，改它会引入新的 parity 漂移 |

## 7. 影响面与风险

- **specs**：`editor-live-preview` 一条 ADDED requirement（「YAML 代码块的键名配色」）+ 一条 MODIFIED requirement（「Markdown 渲染保真」第 2 款：接进 yaml 的键名口径、并把 toml 的 `atom` 复用记进「已知例外」段落）。**该款另含两条 M138/M152 既有行为的 spec 回填**（回填既有行为、不新增产品行为，本次一并申报，避免 delta 超出申报面）：①「该一致性 SHALL 由两侧共用同一张语言表（`src/preview/code.ts` 的 `LANGUAGES`）保证，MUST NOT 由两侧各自维护一份语言或配色表」+ Scenario「两侧语言与配色表同源」；②「着色 SHALL 受单一代码块长度上限约束（超过即回落纯文本，MUST NOT 因语言不同而放宽）」+ Scenario「着色受长度上限约束且与语言无关」。见 `specs/editor-live-preview/spec.md` 增量。
- **代码**：`src/preview/code.ts` 一处（新增常量 + yaml 项包 tokenTable）。零 Rust 改动、零新依赖、零新颜色。
- **测试/验收**：`tests/visual` 的 fixture 与场景（含新增元素级基线）、`scripts/acceptance/scenarios/render-markdown.md` 补一张截图证据（着色是像素级呈现，AX 树不承载颜色，真机侧不写颜色断言）。
- **风险**：低。风险面集中在「视觉基线是否被误判为零变更」——故实现期必须逐张核对相关基线的 sha256 与时间戳（REVIEW.md 第 3 条）。
