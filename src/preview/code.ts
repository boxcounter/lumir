// markdown 文档内代码块的 token 着色（M138）。
//
// 为什么在装饰层做，而不是给 markdown 语言挂 `codeLanguages`：嵌套解析要靠
// `markdown({codeLanguages})` 把子语言烘进 parser，而这个调用点在 src/editor.ts
// （`markdown(markdownConfig)`），不在本 mission 的范围里，preview 模块拿不到它。
// 于是改用同一批 @codemirror/legacy-modes parser，经 StreamLanguage 归一化后直接
// 驱动：token 名 → 标准 tag 的解析逐字复刻 CM6 的那套（别名表 + @lezer/highlight
// 的 tags），因此同一段代码在围栏里与整文件打开时得到的 tag、进而颜色完全一致
// （对照实验见 mission 报告：21 种语言逐 token 与「StreamLanguage + highlightTree」
// 参照实现逐一对齐）。配色类名在 theme.ts，色值仍是同一套 editorial token。
//
// 覆盖范围 = legacy-modes 有现成 mode 的常见全栈集；info string 缺失或不在表里
// 一律不着色（保持既有纯文本渲染，不用近似 parser 冒充）。块级 mermaid 走自己的
// widget 渲染，不在此表内。

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

/** 单个 token 的着色区间（偏移相对代码块正文起点）。 */
export interface CodeToken {
  from: number;
  to: number;
  cls: string;
}

/**
 * 语言名 → StreamLanguage。与 src/editor.ts 的 LANGUAGES 同批 parser（code 模式
 * 按扩展名选语言的那张表）；那张表未导出，此处按 fenced info string 的口径重建一份。
 * 两处注册表的同步没有编译期保障——改语言集要同时改这里。
 */
const LANGUAGES: Record<string, StreamLanguage<unknown>> = {
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
  json: StreamLanguage.define(json),
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

/**
 * token → 类名。tag 分组与 src/editor.ts 的 codeHighlight 逐条对应（同一套语义
 * 色），差别只在输出 CSS 类而非内联色值——类名挂在 theme.ts，色值一处定义。
 */
const TOKEN_CLASSES = HighlightStyle.define([
  { tag: [tags.comment, tags.blockComment, tags.docComment], class: "cm-lp-tok-comment" },
  {
    tag: [tags.keyword, tags.definitionKeyword, tags.controlKeyword, tags.operatorKeyword, tags.moduleKeyword, tags.modifier],
    class: "cm-lp-tok-keyword",
  },
  { tag: [tags.string, tags.docString, tags.character, tags.regexp, tags.special(tags.string)], class: "cm-lp-tok-string" },
  { tag: [tags.number, tags.atom, tags.bool, tags.null], class: "cm-lp-tok-literal" },
  { tag: [tags.propertyName, tags.attributeName], class: "cm-lp-tok-property" },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], class: "cm-lp-tok-type" },
]);

/**
 * StreamLanguage 的 streamParser 是运行期字段，d.ts 只声明了 `define`——CM6 没有把
 * 「在编辑器外驱动流式 parser」做成公开合同。这里只需要三件套
 * （startState/token/blankLine，均已被 fullParser 补全默认值），用窄接口取用，
 * 不把整个实例当任意对象透传。
 */
interface StreamInternals {
  streamParser: {
    token(stream: StringStream, state: unknown): string | null | void;
    blankLine(state: unknown, indentUnit: number): void;
    startState(indentUnit: number): unknown;
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
 * createTokenType + defaultTokenTable）：
 * 1. 整个名字先在别名表里查（CM6 的 defaultTable 只按完整名字命中，别名表与它同表）；
 * 2. 未命中则按空格拆成多个 tag（json 键的 `string property`）、按点号拆 modifier
 *    （`string.special`），每个 part 只查 @lezer/highlight 的 tags；
 * 3. 认不出的 part 丢弃（CM6 同此：`string property` 里 property 不是 tags 名，
 *    结果只剩 string——所以 json 键在 code 模式里是字符串色，这里必须一致）。
 * 全部认不出即不着色：未知 token 保持纯文本，不猜颜色。
 */
function tagsForStyle(style: string): Tag[] {
  const aliased = LEGACY_TAGS[style];
  if (aliased) return [aliased];
  const resolved: Tag[] = [];
  for (const name of style.split(" ")) {
    let found: Tag[] = [];
    for (const part of name.split(".")) {
      const value = TAG_TABLE[part];
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

/** 按 fenced info string 解析语言：无标识、未收录一律 null（不着色）。 */
function resolveLanguage(info: string): { name: string; lang: StreamLanguage<unknown> } | null {
  const first = info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const name = ALIASES[first] ?? first;
  return Object.prototype.hasOwnProperty.call(LANGUAGES, name) ? { name, lang: LANGUAGES[name] } : null;
}

function classOf(style: string): string | null {
  let cached = styleClassCache.get(style);
  if (cached !== undefined) return cached;
  const resolved = tagsForStyle(style);
  const cls = resolved.length ? TOKEN_CLASSES.style(resolved) : null;
  styleClassCache.set(style, cls);
  return cls;
}

function tokenize(code: string, lang: StreamLanguage<unknown>): readonly CodeToken[] {
  const { streamParser } = internals(lang);
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
          const cls = classOf(style);
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
  const tokens = tokenize(code, resolved.lang);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, tokens);
  return tokens;
}
