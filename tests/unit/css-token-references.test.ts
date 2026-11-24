// CSS token 引用链的静态防线（2026-11-24，change fix-skill-menu-opaque-background-nov24）：
// 「浮层背景透明」这条缺陷的成因不是取错档，而是**引用了一个从未存在的 token**
// （`var(--bg-raise, var(--bg))`，两个名字都被 token v1 收敛删除）。同类形态在 Skill 样式里
// 还有一处 `var(--text-1)`——肉眼审计能发现，但没有任何门禁能拦住下一处。
//
// 本判据把「每条 var() 引用都要有归宿」写成可执行的不变量：
//   ① token 在 src/**/*.css 里有定义（任意主题块 / 组件块）；或
//   ② token 在运行期由 TS 写入（白名单，且白名单条目必须有真实赋值点）；或
//   ③ 引用带**有效回退**——回退可以是字面量，也可以是一条能解析到底的 var() 链。
//
// 「有 fallback」不等于「有效」：`var(--bg-raise, var(--bg))` 的回退本身也是未定义 token，
// 整条声明在 computed-value 阶段失效（这正是缺陷现场）。因此判据必须沿回退链求值，不能只
// 收集变量名（REVIEW.md「断言等价于子串」条的同族：看着覆盖、实际不判）。
//
// 边界（已知且有意）：判据只看 CSS 文件里的 `var()` 文本与 TS 里的运行时写入点，不做级联 /
// 主题作用域分析——某个 token 只在 `[data-theme="eink"]` 块里定义时，本判据视其为「有定义」。
// 这是定义存在性判据，不是「该主题下一定生效」判据。
//
// 白名单纪律：只收**真实有赋值点**的 token。新增一条就等于给一类未定义引用开口子，必须同时
// 在 TS 里找到 `setProperty("--x"` 或 `"--x:${…}"` 的写入；测试会双向核对（赋值点 + CSS 引用）。

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 运行期由 TS 写入、CSS 里没有定义的 token（逐条核实过赋值点，测试会复验）。 */
const RUNTIME_ASSIGNED = ["--lumir-hp-scale", "--toc-depth", "--cm-lp-table-columns"] as const;

interface CssSource {
  file: string;
  text: string;
}

interface Fallback {
  text: string;
  /** fallback 文本在原文件里的绝对起点（用于报行号）。 */
  start: number;
}

interface VarRef {
  token: string;
  fallback: Fallback | null;
  /** `var(` 在原文件里的绝对下标。 */
  index: number;
}

interface Violation {
  file: string;
  line: number;
  chain: string[];
  reason: string;
}

/** 注释剔除但保留换行：注释里的 `var(--ghost)` 不是引用。 */
function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function parseVarCall(text: string, open: number): { token: string; fallback: Fallback | null; end: number } | null {
  let i = open + 1;
  while (i < text.length && /\s/.test(text[i])) i++;
  const token = /^--[A-Za-z0-9_-]+/.exec(text.slice(i));
  if (token === null) return null;
  i += token[0].length;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] === ")") return { token: token[0], fallback: null, end: i };
  if (text[i] !== ",") return null;
  let depth = 1;
  let j = i + 1;
  for (; j < text.length; j++) {
    if (text[j] === "(") depth++;
    else if (text[j] === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (j >= text.length) return null;
  return { token: token[0], fallback: { text: text.slice(i + 1, j), start: i + 1 }, end: j };
}

/** 只收**这一层**的 var() 调用：回退里的调用留给 `defectOf` 按需递归（主引用已定义时回退是死代码）。 */
function collectVarRefs(text: string, base = 0): VarRef[] {
  const refs: VarRef[] = [];
  const re = /var\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const call = parseVarCall(text, match.index + match[0].length - 1);
    if (call === null) continue;
    refs.push({
      token: call.token,
      fallback: call.fallback === null ? null : { text: call.fallback.text, start: base + call.fallback.start },
      index: base + match.index,
    });
    re.lastIndex = call.end + 1;
  }
  return refs;
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

/** 沿回退链求值：主引用未定义时，回退里的每个 var() 都必须能解析，否则整条声明失效。 */
function defectOf(ref: VarRef, defined: Set<string>, runtime: Set<string>): { chain: string[]; reason: string } | null {
  if (defined.has(ref.token) || runtime.has(ref.token)) return null;
  if (ref.fallback === null) {
    return { chain: [ref.token], reason: "无 CSS 定义、无运行时赋值、无回退" };
  }
  if (ref.fallback.text.trim() === "") {
    return { chain: [ref.token], reason: "无 CSS 定义，且回退为空" };
  }
  for (const child of collectVarRefs(ref.fallback.text, ref.fallback.start)) {
    const inner = defectOf(child, defined, runtime);
    if (inner !== null) return { chain: [ref.token, ...inner.chain], reason: inner.reason };
  }
  return null;
}

interface ScanResult {
  definitions: Set<string>;
  references: number;
  violations: Violation[];
}

function scanCss(sources: readonly CssSource[], runtime: readonly string[] = RUNTIME_ASSIGNED): ScanResult {
  const runtimeSet = new Set(runtime);
  const definitions = new Set<string>();
  const violations: Violation[] = [];
  let references = 0;
  // 定义先全量收集：token 块写在 style.css、消费点在 harness-panel.css 是常态。
  for (const source of sources) {
    const text = stripCssComments(source.text);
    for (const match of text.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) definitions.add(match[1]);
  }
  for (const source of sources) {
    const text = stripCssComments(source.text);
    for (const ref of collectVarRefs(text)) {
      references++;
      const defect = defectOf(ref, definitions, runtimeSet);
      if (defect !== null) {
        violations.push({ file: source.file, line: lineAt(text, ref.index), ...defect });
      }
    }
  }
  return { definitions, references, violations };
}

function listFiles(dir: string, suffix: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, suffix));
    else if (name.endsWith(suffix)) out.push(full);
  }
  return out;
}

function stripTsComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 该 token 是否有运行期写入点：`setProperty("--x"` 或内联样式串里的 `--x:`。 */
function runtimeAssignmentSite(token: string, sources: readonly { file: string; text: string }[]): string | null {
  const setProperty = new RegExp(`setProperty\\(\\s*["']${escapeRegExp(token)}["']`);
  const inlineStyle = new RegExp(`${escapeRegExp(token)}\\s*:`);
  for (const source of sources) {
    const text = stripTsComments(source.text);
    if (setProperty.test(text) || inlineStyle.test(text)) return source.file;
  }
  return null;
}

function readCssSources(): CssSource[] {
  return listFiles(path.join(root, "src"), ".css").map((file) => ({
    file: path.relative(root, file),
    text: readFileSync(file, "utf8"),
  }));
}

function readTsSources(): { file: string; text: string }[] {
  return listFiles(path.join(root, "src"), ".ts").map((file) => ({
    file: path.relative(root, file),
    text: readFileSync(file, "utf8"),
  }));
}

// ---------------------------------------------------------------------------
// 真实源码：零缺陷
// ---------------------------------------------------------------------------

test("src/**/*.css 的每条 var() 引用都能落到 CSS 定义、运行时赋值或有效回退", (t) => {
  const sources = readCssSources();
  assert.ok(sources.length > 0, "没有扫到任何 CSS——判据形同没有");
  const result = scanCss(sources);
  t.diagnostic(
    `扫描 ${sources.length} 个 CSS：${result.definitions.size} 个 token 定义、` +
      `${result.references} 处 var() 引用、${result.violations.length} 处未落地引用`,
  );
  assert.deepEqual(
    result.violations,
    [],
    `未落地的 token 引用（无定义 / 无运行时赋值 / 回退链也解析不到）：\n${result.violations
      .map((v) => `  ${v.file}:${v.line} ${v.chain.join(" → ")}：${v.reason}`)
      .join("\n")}`,
  );
});

test("运行时白名单的每条都真的有赋值点，且都被 CSS 引用", (t) => {
  const tsSources = readTsSources();
  const cssRefs = new Set<string>();
  for (const source of readCssSources()) {
    for (const ref of collectVarRefs(stripCssComments(source.text))) cssRefs.add(ref.token);
  }
  for (const token of RUNTIME_ASSIGNED) {
    const site = runtimeAssignmentSite(token, tsSources);
    assert.notEqual(site, null, `白名单里的 ${token} 在 src/**/*.ts 里找不到运行期赋值点（白名单过期）`);
    t.diagnostic(`白名单 ${token}：赋值点 ${site}`);
    assert.ok(cssRefs.has(token), `白名单里的 ${token} 没有任何 CSS 引用（白名单应删）`);
  }
});

// ---------------------------------------------------------------------------
// 区分度：每条正向 / 反向判据各造一个必须让它红的输入
// ---------------------------------------------------------------------------

test("反向：无定义且无回退的 bare 引用必须判红（--text-1 现场）", () => {
  const result = scanCss([{ file: "synthetic.css", text: '.lumir-hp-skill-name {\n  color: var(--text-1);\n}\n' }]);
  assert.equal(result.violations.length, 1);
  assert.deepEqual(result.violations[0].chain, ["--text-1"]);
  assert.equal(result.violations[0].line, 2);
});

test("反向：回退本身也是未定义 token 必须判红（--bg-raise / --bg 现场）", () => {
  const result = scanCss([
    { file: "synthetic.css", text: '.m {\n  background: var(--bg-raise, var(--bg));\n}\n' },
  ]);
  assert.equal(result.violations.length, 1);
  assert.deepEqual(result.violations[0].chain, ["--bg-raise", "--bg"]);
  assert.match(result.violations[0].reason, /无 CSS 定义/);
});

test("正向：回退到已定义 token 合法（--border-strong / --border 现场）", () => {
  const result = scanCss([
    {
      file: "synthetic.css",
      text: ':root {\n  --border: #000;\n}\n.m {\n  outline: 1px solid var(--border-strong, var(--border));\n}\n',
    },
  ]);
  assert.deepEqual(result.violations, []);
  assert.ok(result.definitions.has("--border"));
});

test("正向：字面量回退与多级回退链合法", () => {
  const result = scanCss([
    {
      file: "synthetic.css",
      text: '.a {\n  color: var(--missing, red);\n  padding: var(--missing, var(--also-missing, 4px));\n}\n',
    },
  ]);
  assert.deepEqual(result.violations, []);
});

test("正向：运行时赋值的 token 无需 CSS 定义", () => {
  const result = scanCss(
    [
      {
        file: "synthetic.css",
        text: '.a {\n  font-size: calc(var(--fs-ui) * var(--lumir-hp-scale, 1));\n  padding-left: var(--toc-depth, 0);\n}\n:root {\n  --fs-ui: 13px;\n}\n',
      },
    ],
    ["--lumir-hp-scale", "--toc-depth"],
  );
  assert.deepEqual(result.violations, []);
});

test("正向：主引用有定义时，回退里的未定义 token 不判红（死回退不误报）", () => {
  const result = scanCss([
    { file: "synthetic.css", text: ':root {\n  --a: red;\n}\n.m {\n  color: var(--a, var(--ghost));\n}\n' },
  ]);
  assert.deepEqual(result.violations, []);
});

test("反向排除：注释里的 var() 不算引用", () => {
  const result = scanCss([
    { file: "synthetic.css", text: '/* 旧写法 var(--bg-raise, var(--bg)) 已删 */\n.m {\n  color: red;\n}\n' },
  ]);
  assert.deepEqual(result.violations, []);
});

test("反向排除：定义在别的文件里也算有定义（token 块与消费点分离是常态）", () => {
  const result = scanCss([
    { file: "tokens.css", text: ':root {\n  --preview-bg: #fff;\n}\n' },
    { file: "consumer.css", text: '.m {\n  background: var(--preview-bg);\n}\n' },
  ]);
  assert.deepEqual(result.violations, []);
});
