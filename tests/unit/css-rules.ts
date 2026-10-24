// 静态 CSS 扫描的共用工具（tests/unit 内部）。
//
// 两个注册表判据（`scrollbar-registry.test.ts` 的滚动条分档、`overlay-width-registry.test.ts`
// 的浮层宽度分档）都建立在「把 src 的 CSS 解析成 规则 → 选择器 → 声明」这一层上。解析口径
// 只应有一份：两份读法漂移时，两条判据会对同一份 CSS 得出不同结论（REVIEW.md「同一语义两处
// 真源」条）。这里只放**读 CSS 的机制**，档位与判据各自留在自己的测试文件里。

export interface Decl {
  prop: string;
  value: string;
}

export interface CssRule {
  selector: string;
  selectors: string[];
  decls: Decl[];
  source: string;
}

/** 注释剔除但保留换行：`/* … *\/` 里的 `overflow: auto` 不是声明（style.css 的注释里就有）。 */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/** 逗号切选择器，尊重括号（`:not(a, b)` / `:has(> .x)`）。 */
export function splitSelectors(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of selector) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(buf.trim());
      buf = "";
    } else buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

function parseDecls(body: string): Decl[] {
  return body
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(":");
      return i < 0 ? { prop: d, value: "" } : { prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() };
    });
}

/** 扁平化 CSS：`@media` / `@supports` 里的规则照收（被扫文件里确有嵌套），at-rule 自身不收。 */
export function parseCss(text: string, source: string): CssRule[] {
  const src = stripCssComments(text);
  const rules: CssRule[] = [];
  const stack: string[] = [];
  let buf = "";
  for (const ch of src) {
    if (ch === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (ch === "}") {
      const head = stack.pop() ?? "";
      if (head && !head.startsWith("@")) {
        rules.push({ selector: head, selectors: splitSelectors(head), decls: parseDecls(buf), source });
      }
      buf = "";
    } else {
      buf += ch;
    }
  }
  return rules;
}

/** 同一 selector 上某属性的**全部**声明（按文档顺序）。多于一条 = 同一语义有两处真源，
 * 判据必须看见它——只取第一条会把「某消费者又抄了一份值」判成绿。 */
export function declValues(rules: CssRule[], selector: string, prop: string): { value: string; rule: CssRule }[] {
  const out: { value: string; rule: CssRule }[] = [];
  for (const rule of rules) {
    if (!rule.selectors.includes(selector)) continue;
    for (const d of rule.decls) if (d.prop === prop) out.push({ value: d.value, rule });
  }
  return out;
}
