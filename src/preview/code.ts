// markdown 文档内代码块的 token 着色（M138）。
//
// 为什么在装饰层做，而不是给 markdown 语言挂 `codeLanguages`：嵌套解析要靠
// `markdown({codeLanguages})` 把子语言烘进 parser，而这个调用点在 src/editor.ts
// （`markdown(markdownConfig)`），不在本 mission 的范围里，preview 模块拿不到它。
// 于是改用同一批 @codemirror/legacy-modes parser，经 StreamLanguage 归一化后直接
// 驱动：token 名 → 标准 tag 的解析逐字复刻 CM6 的那套（别名表 + parser 的 tokenTable
// + @lezer/highlight 的 tags），因此同一段代码在围栏里与整文件打开时得到的 tag、进而
// 颜色完全一致（对照实验见 mission 报告：21 种语言逐 token 与「StreamLanguage +
// highlightTree」参照实现逐一对齐）。配色类名在 theme.ts，色值仍是同一套 editorial token。
//
// 覆盖范围 = legacy-modes 有现成 mode 的常见全栈集；info string 缺失或不在表里
// 一律不着色（保持既有纯文本渲染，不用近似 parser 冒充）。块级 mermaid 走自己的
// widget 渲染，不在此表内。
//
// M152 起本模块同时是**代码语言注册表的单一来源**：LANGUAGES 一张表供 code 模式
// （src/editor.ts 按扩展名选语言）与围栏代码块（本模块按 info string 选语言）共用，
// 键集由 preview/attachments.ts 的 CodeLanguage 在编译期约束；token 的 tag 分组
// （TOKEN_GROUPS）同样是单一来源，两侧只各自渲染（CSS 类名 / 内联色值）。

import { HighlightStyle, StreamLanguage, StringStream } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Tag } from "@lezer/highlight";
import { javascript, json, typescript } from "@codemirror/legacy-modes/mode/javascript";
import { python } from "@codemirror/legacy-modes/mode/python";
import { go } from "@codemirror/legacy-modes/mode/go";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { c, cpp, java, kotlin } from "@codemirror/legacy-modes/mode/clike";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { css, sCSS } from "@codemirror/legacy-modes/mode/css";
import { html, xml } from "@codemirror/legacy-modes/mode/xml";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import type { CodeLanguage } from "./attachments";

/** 单个 token 的着色区间（偏移相对代码块正文起点）。 */
export interface CodeToken {
  from: number;
  to: number;
  cls: string;
}

/** parser 的 `tokenTable` 口径：legacy token 名 → 标准 tag（CM6 额外映射，defaultTable 之外的补位）。 */
type TokenTable = Record<string, Tag>;

/**
 * json 专属的 tokenTable，随 parser 一起声明（`StreamLanguage` 的 `tokenTable` 字段）。
 * legacy json mode 把对象键标成**复合** token `string property`（legacy-modes/mode/
 * javascript.js:518 的 objprop：`cx.marked = cx.style + " property"`），而 @lezer/highlight
 * 的 tags 里没有 `property` 这个名字（只有 propertyName）——CM6 的 createTokenType 逐词
 * 解析复合 token 时会把该词丢掉并 console 警告，而 defaultTable 的 `property → propertyName`
 * 兜底只按完整 token 名命中，复合名查不到。净效果：键退化成纯 string、与值同色。
 * 补上这张表后 `string property` 解析为 [string, propertyName]，套用哪个类由
 * TOKEN_GROUPS 的条目序裁决（见其注释）。
 * json 是本文件唯一带 tokenTable 的语言：javascript/typescript 的 objprop 走同一条
 * `cx.style + " property"` 分支，但那里字符串键本来就该是字符串色，不跟着改。
 * 只挂在下面 LANGUAGES 的 json 项上——那是 code 模式与 markdown 代码块共用的同一张表，
 * 键色两侧同源，不存在各写一份的漂移面（REVIEW.md 第 8 条）。
 */
export const JSON_TOKEN_TABLE: TokenTable = { property: tags.propertyName };

/**
 * 语言名 → StreamLanguage——**代码语言注册表的单一来源**（M152 收口）：code 模式
 * （src/editor.ts 按扩展名选语言）与围栏代码块（本模块按 fenced info string 选语言）
 * 共用这一张表，两边不再各持一份 parser 列表。
 * `Record<CodeLanguage, StreamLanguage<unknown>>` 是编译期合同（CodeLanguage 由
 * preview/attachments.ts 的扩展名注册表推导）：注册表新增语言名而此处未实现、或此处
 * 多出无人引用的实现，编译都会失败。vue/svelte 无对应 legacy mode（SFC 按 html 兜底）；
 * php 无对应 mode，注册表标 null → 纯文本只读，不由近似 parser 冒充。
 */
export const LANGUAGES: Record<CodeLanguage, StreamLanguage<unknown>> = {
  rust: StreamLanguage.define(rust),
  typescript: StreamLanguage.define(typescript),
  javascript: StreamLanguage.define(javascript),
  python: StreamLanguage.define(python),
  go: StreamLanguage.define(go),
  c: StreamLanguage.define(c),
  cpp: StreamLanguage.define(cpp),
  java: StreamLanguage.define(java),
  ruby: StreamLanguage.define(ruby),
  shell: StreamLanguage.define(shell),
  json: StreamLanguage.define({ ...json, tokenTable: JSON_TOKEN_TABLE }),
  toml: StreamLanguage.define(toml),
  yaml: StreamLanguage.define(yaml),
  css: StreamLanguage.define(css),
  scss: StreamLanguage.define(sCSS),
  html: StreamLanguage.define(html),
  xml: StreamLanguage.define(xml),
  swift: StreamLanguage.define(swift),
  kotlin: StreamLanguage.define(kotlin),
  lua: StreamLanguage.define(lua),
  sql: StreamLanguage.define(standardSQL),
};

/** fenced info string 常见写法 → 上表语言名（别名只做归一，不新增 parser）。 */
const ALIASES: Record<string, string> = {
  rs: "rust",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  node: "javascript",
  py: "python",
  python3: "python",
  golang: "go",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  rb: "ruby",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  console: "shell",
  jsonc: "json",
  yml: "yaml",
  htm: "html",
  svg: "xml",
  kt: "kotlin",
};

/** token 的语义分组名：类名与色值两侧映射表的键（各自的 `Record<TokenRole, …>` 穷尽检查）。 */
export type TokenRole = "comment" | "keyword" | "string" | "literal" | "property" | "type";

interface TokenGroup {
  role: TokenRole;
  tags: readonly Tag[];
}

/**
 * token 的语义分组——**单一来源**（M152）：tag 列表只在这里写一次，两侧各自渲染消费
 * （本模块出 CSS 类名，src/editor.ts 的 codeHighlight 出内联色值），任一侧都不得再维护
 * 一份 tag 列表。
 * **条目序即优先级**（原先只在两侧注释里口口相传的隐性规则，在此显式声明）：HighlightStyle
 * 按此序把规则写进样式表，同一节点带多个 tag 时**靠后**的条目命中（CM6 文档原文
 * 「styles defined further down in the list will have a higher CSS precedence」）——所以
 * property 必须留在 string 之后：json 键同时带 string + propertyName 两个 tag，靠前会让
 * 它退回字符串色。
 */
export const TOKEN_GROUPS = [
  { role: "comment", tags: [tags.comment, tags.blockComment, tags.docComment] },
  {
    role: "keyword",
    tags: [tags.keyword, tags.definitionKeyword, tags.controlKeyword, tags.operatorKeyword, tags.moduleKeyword, tags.modifier],
  },
  { role: "string", tags: [tags.string, tags.docString, tags.character, tags.regexp, tags.special(tags.string)] },
  { role: "literal", tags: [tags.number, tags.atom, tags.bool, tags.null] },
  { role: "property", tags: [tags.propertyName, tags.attributeName] },
  { role: "type", tags: [tags.typeName, tags.className, tags.namespace, tags.tagName] },
] as const satisfies readonly TokenGroup[];

/** 类名口径：`cm-lp-tok-<role>`（theme.ts 的选择器按此命名，与 role 一一对应）。 */
export const tokenClassOf = (role: TokenRole): string => `cm-lp-tok-${role}`;

/** 本模块的渲染消费：分组 → CSS 类（色值一处定义在 theme.ts）。 */
const TOKEN_CLASSES = HighlightStyle.define(
  TOKEN_GROUPS.map((group) => ({ tag: group.tags, class: tokenClassOf(group.role) })),
);

/**
 * StreamLanguage 的 streamParser 是运行期字段，d.ts 只声明了 `define`——CM6 没有把
 * 「在编辑器外驱动流式 parser」做成公开合同。这里只需要三件套
 * （startState/token/blankLine，均已被 fullParser 补全默认值）加上 parser 自带的
 * `tokenTable`（fullParser 保证存在，未声明时是 null 原型空对象），用窄接口取用，
 * 不把整个实例当任意对象透传。
 */
interface StreamInternals {
  streamParser: {
    token(stream: StringStream, state: unknown): string | null | void;
    blankLine(state: unknown, indentUnit: number): void;
    startState(indentUnit: number): unknown;
    tokenTable: TokenTable;
  };
}

const internals = (lang: StreamLanguage<unknown>): StreamInternals => lang as unknown as StreamInternals;

/**
 * CM5 token 名 → 标准 tag。别名表与 CM6 的 defaultTokenTable 内建别名逐条同表
 * （node_modules/@codemirror/language 的 defaultTable），其余名字直接查
 * @lezer/highlight 的 tags——CM6 的 createTokenType 也是这么解析的，因此同一段
 * 代码经这里与经 code 模式的 StreamLanguage 得到的是同一个 tag。
 * 查不到（或查到 modifier 函数）即不着色：未知 token 保持纯文本，不猜。
 */
const LEGACY_TAGS: Record<string, Tag> = {
  variable: tags.variableName,
  "variable-2": tags.special(tags.variableName),
  "string-2": tags.special(tags.string),
  def: tags.definition(tags.variableName),
  tag: tags.tagName,
  attribute: tags.attributeName,
  type: tags.typeName,
  builtin: tags.standard(tags.variableName),
  qualifier: tags.modifier,
  error: tags.invalid,
  header: tags.heading,
  property: tags.propertyName,
};

const TAG_TABLE = tags as unknown as Record<string, Tag | ((tag: Tag) => Tag)>;

/**
 * CM5 token 名 → tag 列表，逐字对应 CM6 的 token 名解析（stream parser 的
 * createTokenType + defaultTokenTable + parser 的 tokenTable）：
 * 1. 整个名字先在别名表里查（CM6 的 defaultTable 只按完整名字命中，别名表与它同表），
 *    再查 parser 的 tokenTable（CM6 同序：`this.table[tag]` 命中就返回，否则才走
 *    createTokenType）；
 * 2. 未命中则按空格拆成多个 tag（json 键的 `string property`）、按点号拆 modifier
 *    （`string.special`），每个 part 先查 tokenTable 再查 @lezer/highlight 的 tags
 *    （CM6 的 `extra[part] || tags[part]` 同序）；
 * 3. 认不出的 part 丢弃。json 键的 `string property` 因此解析为 [string, propertyName]
 *    ——property 由 JSON_TOKEN_TABLE 供给（没有这张表时 CM6 会丢掉它并 console 警告，
 *    键只剩 string，与值同色）。
 * 全部认不出即不着色：未知 token 保持纯文本，不猜颜色。
 */
function tagsForStyle(style: string, extra: TokenTable): Tag[] {
  const aliased = LEGACY_TAGS[style] ?? extra[style];
  if (aliased) return [aliased];
  const resolved: Tag[] = [];
  for (const name of style.split(" ")) {
    let found: Tag[] = [];
    for (const part of name.split(".")) {
      const value = extra[part] ?? TAG_TABLE[part];
      if (typeof value === "function") {
        if (!found.length) return [];
        found = found.map(value);
      } else if (value) {
        if (found.length) return [];
        found = [value];
      }
    }
    resolved.push(...found);
  }
  return resolved;
}

// 与 CM6 stream parser 同口径的常量：行内扫描上限保护（C.MaxLineLength）与缩进
// 单位（indentUnit facet 出厂值两个空格）。
const MAX_LINE_LENGTH = 10000;
const INDENT_UNIT = 2;

/**
 * 单个代码块的着色上限（字符）。着色是 O(块长) 的流式扫描，且编辑期间每次击键
 * 都会重算——超大块（整篇塞进一个围栏）会打破 1MB 打开的预算。超过即不着色
 * （回落既有纯文本渲染），与表格 64 KiB 降级同量级。
 */
const MAX_HIGHLIGHT_CHARS = 64 * 1024;
const CACHE_LIMIT = 32;

const EMPTY: readonly CodeToken[] = [];
const cache = new Map<string, readonly CodeToken[]>();
const styleClassCache = new Map<string, string | null>();

/** info string 是任意字符串：只在注册表确有该键时才收窄到 CodeLanguage。 */
const isRegisteredLanguage = (name: string): name is CodeLanguage => Object.prototype.hasOwnProperty.call(LANGUAGES, name);

/** 按 fenced info string 解析语言：无标识、未收录一律 null（不着色）。 */
function resolveLanguage(info: string): { name: string; lang: StreamLanguage<unknown> } | null {
  const first = info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const name = ALIASES[first] ?? first;
  return isRegisteredLanguage(name) ? { name, lang: LANGUAGES[name] } : null;
}

function classOf(langName: string, style: string, extra: TokenTable): string | null {
  // 缓存键含语言：tokenTable 是 per-parser 的，同一个 token 名在不同语言下会落到不同
  // tag——`string property` 在 json（带表）是 [string, propertyName]，在 javascript
  // 是 [string]，类名不同。
  const key = `${langName}\u0000${style}`;
  let cached = styleClassCache.get(key);
  if (cached !== undefined) return cached;
  const resolved = tagsForStyle(style, extra);
  const cls = resolved.length ? TOKEN_CLASSES.style(resolved) : null;
  styleClassCache.set(key, cls);
  return cls;
}

function tokenize(code: string, lang: StreamLanguage<unknown>, langName: string): readonly CodeToken[] {
  const { streamParser } = internals(lang);
  const extra = streamParser.tokenTable;
  const state = streamParser.startState(INDENT_UNIT);
  const tokens: CodeToken[] = [];
  let offset = 0;
  for (const raw of code.split("\n")) {
    // CM6 逐行喂流式 parser：换行符不进 token 输入（CRLF 的 \r 一并剥掉），
    // 但偏移要连同换行一起推进。
    const line = raw.charCodeAt(raw.length - 1) === 13 ? raw.slice(0, -1) : raw;
    const stream = new StringStream(line, 4, INDENT_UNIT);
    if (stream.eol()) {
      streamParser.blankLine(state, INDENT_UNIT);
    } else {
      while (!stream.eol()) {
        stream.start = stream.pos;
        let style: string | null | void = null;
        // parser 不推进游标时最多重试 10 次（CM6 readToken 同口径）；仍不推进就
        // 手工前进一格，坏 mode 不至于把渲染卡死。
        for (let attempt = 0; attempt < 10 && stream.pos === stream.start; attempt++) {
          style = streamParser.token(stream, state);
        }
        if (stream.pos === stream.start) stream.pos++;
        if (style) {
          const cls = classOf(langName, style, extra);
          if (cls !== null) {
            const from = offset + stream.start;
            const to = offset + stream.pos;
            // 相邻同类 token 合并成一个区间：装饰数与 DOM 节点更少，也与
            // CM6 stream parser 的 mergeTokens 同形（同一段文本在两种渲染路径下
            // 切分一致）。
            const last = tokens[tokens.length - 1];
            if (last && last.to === from && last.cls === cls) last.to = to;
            else tokens.push({ from, to, cls });
          }
        }
        if (stream.start > MAX_LINE_LENGTH) break;
      }
    }
    offset += raw.length + 1;
  }
  return tokens;
}

/**
 * 代码块着色：输入 info string 与代码正文，输出 token 区间与样式类。
 * 结果按「语言 + 原文」缓存——同一块在滚动/选区/视口重建时命中缓存不重扫；
 * 编辑使缓存条目自然失效（键含原文）。
 */
export function highlightCode(code: string, info: string): readonly CodeToken[] {
  if (code === "" || code.length > MAX_HIGHLIGHT_CHARS) return EMPTY;
  const resolved = resolveLanguage(info);
  if (!resolved) return EMPTY;
  const key = `${resolved.name}\u0000${code}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const tokens = tokenize(code, resolved.lang, resolved.name);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, tokens);
  return tokens;
}
