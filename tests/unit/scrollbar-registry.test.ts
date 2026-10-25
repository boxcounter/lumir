// 滚动条分档注册表（M663，change scrollbar-tiers-oct24）：
// ui-design-system 的「滚动条分档与滚动容器注册表」条款的可执行判据。
//
// 为什么是静态扫描而不是给每个消费者写一条 CSSOM 断言：m628 场景只钉了 harness 的三个
// 已知选择器，新代码换一个类名就绕过去了；本层把判据反过来——**凡声明 overflow auto/scroll
// 的选择器都必须先在注册表归挡**，拦的是「新增容器」，不需要逐个写用例。注册表同时还守
// 两个方向：登记了但源码里已不存在（改名 / 删除后的僵尸条目）同样判红。
//
// 档位按容器分配、不按轴分配：WebKit 一旦给某容器自绘 ::-webkit-scrollbar 就把它的两条轴
// 一起从 overlay 切成占位经典条（逐轴的 ::-webkit-scrollbar:horizontal 是死规则，
// scrollbar-width 不改 overlay 条）——所以「一轴细条、一轴 overlay」不可达，见 checksFor 的注释。
//
// 判据分四层（缺一层就退化成登记表抄写）：
//   ① 覆盖：扫到的每个滚动容器在注册表里；
//   ② 新鲜度：注册表每个条目（除 CodeMirror 自带的）在源码里查得到；
//   ③ 档位声明：细条 / 隐藏档必须真的持有该档声明且**全档共用同一份规则**；豁免档必须一条
//      滚动条声明都没有（写了就翻成占位条，与该档前提相悖）；
//   ④ 禁则：细条 / 隐藏档容器 MUST NOT 声明 scrollbar-gutter。
// 反向输入（区分度）在本文件末尾逐条跑：每条判据都先造一个必须让它红的输入。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { declValues, parseCss } from "./css-rules.ts";
import type { CssRule } from "./css-rules.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------------------
// 注册表（本条的可执行居所；规范条款正文是它的自然语言版本）
//
// origin: "cm" = 声明确在 CodeMirror 自己的 baseTheme 里（node_modules/@codemirror/view 的
// `.cm-scroller` 有 overflow-x: auto），三个被扫文件里没有它的 overflow 声明，故跳过
// 新鲜度核对；档位声明与豁免自检（③）照跑。
// ---------------------------------------------------------------------------

type Tier = "hidden" | "thin" | "native-overlay";

interface RegistryEntry {
  tier: Tier;
  selectors: string[];
  origin?: "cm";
  note: string;
}

const REGISTRY: RegistryEntry[] = [
  {
    tier: "hidden",
    selectors: [".tabstrip", ".vault-list", ".lumir-hp-sesspop-list", ".lumir-hp-permpop-rules"],
    note:
      "标签栏（M257）+ 右缘 0 留白且逐行有常驻钮的三处浮层列表（M660）。隐藏档的准入判据：" +
      "容器右缘 12px 内有常驻可交互件——4px 细条仍会盖住 20px 钮的右缘，只有 0px 才彻底解决。",
  },
  {
    tier: "thin",
    selectors: [
      ".lumir-hp-codeblock",
      ".lumir-hp-diff",
      ".lumir-hp-argv",
      ".lumir-hp-table-scroll",
      ".cm-lp-block-scroll",
      ".cm-lp-table-scroll",
      ".cm-lp-math-block",
      ".cm-lp-mermaid",
    ],
    note:
      "harness 的代码块 / diff / argv（M406 / M628）、harness 对话表格的横滚容器（M703）+ 编辑器" +
      "预览的四个块级横滚容器（M663）。配方（4px / --border thumb / 透明轨道 / scrollbar-width: thin）" +
      "全档只有一份共用规则。",
  },
  {
    tier: "native-overlay",
    selectors: [
      ".tree-pane",
      ".pane",
      ".lumir-bindings-body",
      ".lumir-set-body",
      ".lumir-table-fs-panel",
      ".lumir-codeblock-fs-panel",
      ".lumir-toc-list",
      ".lumir-qo-list",
      ".lumir-hp-transcript",
      ".lumir-hp-composer",
    ],
    note:
      "纵向阅读面与浮层列表：右缘 ≥8px 是留白 / 空轨道，overlay 条不压可点件；改档会让全部" +
      "编辑面像素基线失效而收益只是「滚动瞬间看着细」。`.pane` 是备而不用的兜底（编辑器撑满" +
      "高度时实际不滚）。",
  },
  {
    tier: "native-overlay",
    origin: "cm",
    selectors: [".cm-scroller"],
    note:
      "编辑器主滚动（CM baseTheme 的 overflow-x: auto ⇒ 两轴 auto）。纵向必须留平台 overlay，" +
      "而 WebKit 自绘即双轴占位——所以它一条滚动条声明都不写（M663 实测，tower 裁 A）。",
  },
];

// ---------------------------------------------------------------------------
// 解析层（机制在 `css-rules.ts`，与浮层宽度注册表共用同一份读法）
// ---------------------------------------------------------------------------

interface ThemeOverflow {
  selector: string;
  prop: string;
  value: string;
}

/** theme.ts 的 CM theme 对象：`".cm-lp-math-block": { …, overflowX: "auto" }`。走 TS 语法树
 *  （不写正则）——嵌套对象、引号 / 标识符键、多行对象都按真实结构取。 */
export function scanThemeObjects(text: string, source: string): ThemeOverflow[] {
  const sf = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true);
  const out: ThemeOverflow[] = [];
  const propName = (name: ts.PropertyName): string | null => {
    if (ts.isStringLiteral(name) || ts.isIdentifier(name) || ts.isNumericLiteral(name)) return name.text;
    return null;
  };
  const visit = (node: ts.Node, selector: string): void => {
    if (ts.isPropertyAssignment(node)) {
      const name = propName(node.name);
      if (name === "overflow" || name === "overflowX" || name === "overflowY") {
        if (ts.isStringLiteral(node.initializer)) {
          out.push({ selector, prop: name, value: node.initializer.text });
        }
        return;
      }
      if (name && ts.isObjectLiteralExpression(node.initializer)) {
        for (const child of node.initializer.properties) visit(child, name);
        return;
      }
    }
    ts.forEachChild(node, (c) => visit(c, selector));
  };
  visit(sf, "");
  return out;
}

type Axis = "x" | "y";

interface ScrollContainer {
  selector: string;
  axes: Set<Axis>;
  sources: Set<string>;
}

/** 声明值 → 滚动轴。`overflow: hidden auto` 这类两值 shorthand 按 x/y 拆；`hidden` 不是滚动。 */
function scrollingAxes(prop: string, rawValue: string): Axis[] {
  const value = rawValue.replace(/!important\s*$/i, "").trim().toLowerCase();
  if (!value) return [];
  const isScroll = (v: string) => v === "auto" || v === "scroll" || v === "overlay";
  if (prop === "overflow-x") return isScroll(value) ? ["x"] : [];
  if (prop === "overflow-y") return isScroll(value) ? ["y"] : [];
  const parts = value.split(/\s+/);
  if (parts.length === 1) return isScroll(parts[0]) ? ["x", "y"] : [];
  const axes: Axis[] = [];
  if (isScroll(parts[0])) axes.push("x");
  if (isScroll(parts[1])) axes.push("y");
  return axes;
}

// ---------------------------------------------------------------------------
// 判据
// ---------------------------------------------------------------------------

interface World {
  styleCss: string;
  harnessCss: string;
  /** 设置面板样式（change add-model-automation-settings-oct24）：新 CSS 文件同样在注册表
   *  的覆盖范围内——只扫两个文件时，换一个类名的滚动容器就能绕过全部门禁（REVIEW.md
   *  『新增 / 修改 overflow 容器没先定档』条）。 */
  settingsCss: string;
  themeTs: string;
  registry: RegistryEntry[];
}

export interface Problem {
  kind:
    | "missing-tier"
    | "stale-entry"
    | "duplicate-entry"
    | "thin-declaration"
    | "hidden-declaration"
    | "exempt-declaration"
    | "gutter";
  selector: string;
  detail: string;
}

const THIN_SIZE = "4px";
const THIN_THUMB = "var(--border)";
const THIN_TRACK = "transparent";

function scrollContainers(world: World): Map<string, ScrollContainer> {
  const found = new Map<string, ScrollContainer>();
  const add = (selector: string, prop: string, value: string, source: string): void => {
    const axes = scrollingAxes(prop, value);
    if (axes.length === 0) return;
    const cur = found.get(selector) ?? { selector, axes: new Set<Axis>(), sources: new Set<string>() };
    for (const a of axes) cur.axes.add(a);
    cur.sources.add(source);
    found.set(selector, cur);
  };
  for (const [text, source] of [
    [world.styleCss, "src/style.css"],
    [world.harnessCss, "src/harness-panel.css"],
    [world.settingsCss, "src/settings-panel.css"],
  ] as const) {
    for (const rule of parseCss(text, source)) {
      for (const sel of rule.selectors) {
        for (const d of rule.decls) {
          if (d.prop === "overflow" || d.prop === "overflow-x" || d.prop === "overflow-y") {
            add(sel, d.prop, d.value, source);
          }
        }
      }
    }
  }
  for (const d of scanThemeObjects(world.themeTs, "src/preview/theme.ts")) {
    add(d.selector, d.prop, d.value, "src/preview/theme.ts");
  }
  return found;
}

function declValue(rules: CssRule[], selector: string, prop: string): { value: string; rule: CssRule } | null {
  return declValues(rules, selector, prop)[0] ?? null;
}

/** 以 `selector::` 开头的伪元素规则（::-webkit-scrollbar 家族）。 */
function pseudoRules(rules: CssRule[], selector: string): CssRule[] {
  return rules.filter((r) => r.selectors.some((s) => s.startsWith(`${selector}::`)));
}

function checkDeclarations(rules: CssRule[], entry: RegistryEntry): Problem[] {
  const problems: Problem[] = [];
  const push = (kind: Problem["kind"], selector: string, detail: string): void => {
    problems.push({ kind, selector, detail });
  };

  // 全档共用一份规则：同一档里每个选择器取到的必须是**同一个** CssRule 实例，且同一属性
  // 只能有一条声明。这两条把「组件各抄一份值」变成红灯，而不是靠 reviewer 记得比。
  const shared = (
    selectors: string[],
    pick: (sel: string) => { value: string; rule: CssRule }[],
    want: string,
    role: string,
  ) => {
    let groupRule: CssRule | null = null;
    for (const sel of selectors) {
      const all = pick(sel);
      if (all.length === 0) {
        push(entry.tier === "thin" ? "thin-declaration" : "hidden-declaration", sel, `缺 ${role} 声明`);
        continue;
      }
      if (all.length > 1) {
        push(
          entry.tier === "thin" ? "thin-declaration" : "hidden-declaration",
          sel,
          `${role} 被声明了 ${all.length} 次（同一语义两处真源：${all.map((a) => `${a.rule.source}「${a.rule.selector}」`).join(" / ")}）`,
        );
      }
      const got = all[0];
      if (got.value !== want) {
        push(entry.tier === "thin" ? "thin-declaration" : "hidden-declaration", sel, `${role} 应为 ${want}，实际 ${got.value}`);
      }
      if (!groupRule) groupRule = got.rule;
      else if (groupRule !== got.rule) {
        push(
          entry.tier === "thin" ? "thin-declaration" : "hidden-declaration",
          sel,
          `${role} 与同档其它消费者不在同一份共用规则里（同一语义两处真源）`,
        );
      }
    }
  };

  if (entry.tier === "thin") {
    shared(entry.selectors, (sel) => declValues(rules, sel, "scrollbar-width"), "thin", "scrollbar-width");
    // ::-webkit-scrollbar 只按「整条宽度」断言——WebKit 里 width/height 缺一不可，缺了另一轴
    // 会退回系统默认厚度（M663 实测：只写 height 时纵向变 17px 占位条）。
    shared(entry.selectors, (sel) => declValues(rules, `${sel}::-webkit-scrollbar`, "width"), THIN_SIZE, "::-webkit-scrollbar width");
    shared(entry.selectors, (sel) => declValues(rules, `${sel}::-webkit-scrollbar`, "height"), THIN_SIZE, "::-webkit-scrollbar height");
    shared(entry.selectors, (sel) => declValues(rules, `${sel}::-webkit-scrollbar-thumb`, "background"), THIN_THUMB, "thumb 底色");
    shared(entry.selectors, (sel) => declValues(rules, `${sel}::-webkit-scrollbar-track`, "background"), THIN_TRACK, "轨道底色");
  } else if (entry.tier === "hidden") {
    shared(entry.selectors, (sel) => declValues(rules, sel, "scrollbar-width"), "none", "scrollbar-width");
    shared(entry.selectors, (sel) => declValues(rules, `${sel}::-webkit-scrollbar`, "display"), "none", "::-webkit-scrollbar display");
  } else {
    // 豁免档的判据是「一条声明都没有」：写了 scrollbar-width（任何值）或任意
    // ::-webkit-scrollbar 规则，就把该容器翻成占位经典条，与「静止态不占宽」的前提相悖。
    for (const sel of entry.selectors) {
      const sw = declValue(rules, sel, "scrollbar-width");
      if (sw) push("exempt-declaration", sel, `豁免档不应声明 scrollbar-width（实际 ${sw.value}）`);
      const pseudos = pseudoRules(rules, sel);
      if (pseudos.length > 0) {
        push("exempt-declaration", sel, `豁免档不应有 ::-webkit-scrollbar 规则（${pseudos[0].source}）`);
      }
    }
  }

  if (entry.tier !== "native-overlay") {
    for (const sel of entry.selectors) {
      const gutter = declValue(rules, sel, "scrollbar-gutter");
      if (gutter) push("gutter", sel, `MUST NOT 声明 scrollbar-gutter（实际 ${gutter.value}）`);
    }
  }
  return problems;
}

export function audit(world: World): Problem[] {
  const problems: Problem[] = [];
  const scanned = scrollContainers(world);
  const registered = new Set<string>();
  for (const entry of world.registry) {
    for (const sel of entry.selectors) {
      if (registered.has(sel)) problems.push({ kind: "duplicate-entry", selector: sel, detail: "同一选择器登记了多档" });
      registered.add(sel);
    }
  }
  // ① 覆盖：源码里滚、注册表里没有。
  for (const [sel, c] of scanned) {
    if (!registered.has(sel)) {
      problems.push({
        kind: "missing-tier",
        selector: sel,
        detail: `声明了 overflow ${[...c.axes].join("/")} 滚动（${[...c.sources].join(", ")}）但未在注册表归挡`,
      });
    }
  }
  // ② 新鲜度：注册表里有、源码里没有（CodeMirror 自带的除外）。
  for (const entry of world.registry) {
    if (entry.origin === "cm") continue;
    for (const sel of entry.selectors) {
      if (!scanned.has(sel)) problems.push({ kind: "stale-entry", selector: sel, detail: "注册表条目的选择器在三个被扫文件里已不存在（改名 / 删除后的僵尸条目）" });
    }
  }
  // ③④ 档位声明与禁则。
  const rules = [
    ...parseCss(world.styleCss, "src/style.css"),
    ...parseCss(world.harnessCss, "src/harness-panel.css"),
    ...parseCss(world.settingsCss, "src/settings-panel.css"),
  ];
  for (const entry of world.registry) problems.push(...checkDeclarations(rules, entry));
  return problems;
}

// ---------------------------------------------------------------------------
// 真仓读数
// ---------------------------------------------------------------------------

function realWorld(): World {
  return {
    styleCss: readFileSync(path.join(root, "src/style.css"), "utf8"),
    harnessCss: readFileSync(path.join(root, "src/harness-panel.css"), "utf8"),
    settingsCss: readFileSync(path.join(root, "src/settings-panel.css"), "utf8"),
    themeTs: readFileSync(path.join(root, "src/preview/theme.ts"), "utf8"),
    registry: REGISTRY,
  };
}

test("滚动条注册表与源码双向对齐，且各档声明实际成立", () => {
  const problems = audit(realWorld());
  assert.deepEqual(
    problems,
    [],
    "滚动条分档判据判红：\n" + problems.map((p) => `  - [${p.kind}] ${p.selector}：${p.detail}`).join("\n"),
  );
});

test("注册表覆盖盘点出的全部滚动容器（21 个面 = 22 个选择器）", () => {
  const scanned = scrollContainers(realWorld());
  assert.deepEqual(
    [...scanned.keys()].sort(),
    [
      ".cm-lp-block-scroll",
      ".cm-lp-math-block",
      ".cm-lp-mermaid",
      ".cm-lp-table-scroll",
      ".lumir-bindings-body",
      ".lumir-codeblock-fs-panel",
      ".lumir-hp-argv",
      ".lumir-hp-codeblock",
      ".lumir-hp-composer",
      ".lumir-hp-diff",
      ".lumir-hp-permpop-rules",
      ".lumir-hp-sesspop-list",
      ".lumir-hp-table-scroll",
      ".lumir-hp-transcript",
      ".lumir-qo-list",
      ".lumir-set-body",
      ".lumir-table-fs-panel",
      ".lumir-toc-list",
      ".pane",
      ".tabstrip",
      ".tree-pane",
      ".vault-list",
    ],
    "被扫出的滚动容器集合变了：新增容器请先在 REGISTRY 归挡，删除容器请同步删条目",
  );
  assert.deepEqual(
    [...scanned.get(".cm-lp-table-scroll")!.axes].sort(),
    ["x"],
    "宽表容器只应横向滚动（纵向 hidden）——纵向一旦变成滚动，细条档的两轴代价判断要重做",
  );
  assert.deepEqual(
    [...scanned.get(".lumir-hp-table-scroll")!.axes].sort(),
    ["x"],
    "harness 表格的横滚容器只应横向滚动（纵向 hidden），与正文 .cm-lp-table-scroll 同口径",
  );
});

// ---------------------------------------------------------------------------
// 反向输入：每条判据先造一个必须让它红的输入（REVIEW.md「断言等价于子串」条）
// ---------------------------------------------------------------------------

const FIXTURE_STYLE = `
/* 注释里的 overflow: auto 不算声明（这是本层剔除注释的区分度输入） */
.a { overflow: auto; }
.b, .c { overflow-x: auto; overflow-y: hidden; }
.d { overflow: hidden auto; }
.e { overflow: hidden; }
.a, .b, .c, .d { scrollbar-width: thin; }
.a::-webkit-scrollbar, .b::-webkit-scrollbar, .c::-webkit-scrollbar, .d::-webkit-scrollbar { width: 4px; height: 4px; }
.a::-webkit-scrollbar-thumb, .b::-webkit-scrollbar-thumb, .c::-webkit-scrollbar-thumb, .d::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.a::-webkit-scrollbar-track, .b::-webkit-scrollbar-track, .c::-webkit-scrollbar-track, .d::-webkit-scrollbar-track { background: transparent; }
.x { overflow: auto; }
`;

function fixture(overrides: Partial<World> = {}): World {
  return {
    styleCss: FIXTURE_STYLE,
    harnessCss: "",
    settingsCss: "",
    themeTs: "",
    registry: [
      { tier: "thin", selectors: [".a", ".b", ".c", ".d"], note: "fixture" },
      { tier: "native-overlay", selectors: [".x"], note: "fixture" },
    ],
    ...overrides,
  };
}

test("反向输入：未登记的滚动容器判红", () => {
  const problems = audit(fixture({ styleCss: `${FIXTURE_STYLE}\n.y { overflow-y: scroll; }` }));
  const hit = problems.filter((p) => p.kind === "missing-tier");
  assert.equal(hit.length, 1, `应恰好报一个未登记容器，实际：${JSON.stringify(problems)}`);
  assert.equal(hit[0].selector, ".y");
});

test("反向输入：注册表里的僵尸条目判红", () => {
  const problems = audit(
    fixture({
      registry: [
        { tier: "thin", selectors: [".a", ".b", ".c", ".d"], note: "fixture" },
        { tier: "native-overlay", selectors: [".x", ".gone"], note: "fixture" },
      ],
    }),
  );
  const hit = problems.filter((p) => p.kind === "stale-entry");
  assert.equal(hit.length, 1);
  assert.equal(hit[0].selector, ".gone");
});

test("反向输入：细条配方漂移（5px）判红", () => {
  const problems = audit(fixture({ styleCss: FIXTURE_STYLE.replace("width: 4px; height: 4px", "width: 5px; height: 4px") }));
  const hit = problems.filter((p) => p.kind === "thin-declaration" && p.detail.includes("width"));
  assert.ok(hit.length >= 1, `应报配方值漂移，实际：${JSON.stringify(problems)}`);
});

test("反向输入：细条消费者各写一份值（不在同一共用规则里）判红", () => {
  const split = `${FIXTURE_STYLE}\n.b::-webkit-scrollbar { width: 4px; height: 4px; }`;
  const problems = audit(fixture({ styleCss: split }));
  const hit = problems.filter(
    (p) => p.kind === "thin-declaration" && (p.detail.includes("两处真源") || p.detail.includes("同一份共用规则")),
  );
  assert.ok(hit.length >= 1, `应报「两处真源」，实际：${JSON.stringify(problems)}`);
});

test("反向输入：豁免档容器写了滚动条声明判红", () => {
  const problems = audit(
    fixture({
      styleCss: `${FIXTURE_STYLE}\n.x { scrollbar-width: thin; }\n.x::-webkit-scrollbar { width: 4px; }`,
    }),
  );
  const hit = problems.filter((p) => p.kind === "exempt-declaration");
  assert.ok(hit.length >= 2, `scrollbar-width 与 ::-webkit-scrollbar 两条都应报，实际：${JSON.stringify(problems)}`);
});

test("反向输入：细条容器声明 scrollbar-gutter 判红", () => {
  const problems = audit(fixture({ styleCss: `${FIXTURE_STYLE}\n.c { scrollbar-gutter: stable; }` }));
  const hit = problems.filter((p) => p.kind === "gutter");
  assert.equal(hit.length, 1);
  assert.equal(hit[0].selector, ".c");
});

test("反向输入：注释掉的 overflow 不算滚动容器（剔除注释有区分度）", () => {
  const scanned = scrollContainers(fixture());
  assert.deepEqual([...scanned.keys()].sort(), [".a", ".b", ".c", ".d", ".x"]);
  // overflow: hidden / hidden auto（只有 y 滚）/ 只写 hidden 的三类都不进集合
  assert.deepEqual([...scanned.get(".d")!.axes], ["y"]);
});

test("反向输入：theme.ts 的 CM theme 对象按语法树取到选择器", () => {
  const theme = `export const t = { ".cm-lp-x": { padding: "0", overflowX: "auto" }, nested: { "&.y": { overflow: "scroll" } } };`;
  const decls = scanThemeObjects(theme, "fixture.ts");
  assert.deepEqual(
    decls.map((d) => `${d.selector} ${d.prop}: ${d.value}`),
    [".cm-lp-x overflowX: auto", "&.y overflow: scroll"],
  );
  const world = fixture({ styleCss: "", themeTs: theme, registry: [] });
  const missing = audit(world).filter((p) => p.kind === "missing-tier").map((p) => p.selector);
  assert.deepEqual(missing.sort(), [".cm-lp-x", "&.y"].sort());
});
