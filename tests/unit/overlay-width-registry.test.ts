// 浮层宽度分档注册表（M702，change overlay-width-contract-oct24）：
// ui-design-system 「浮层宽度分档与可读宽度注册表」条款的可执行判据。
//
// 为什么是静态扫描 + 注册表：M698 的盘点发现 14 个浮层里 5 处固定像素宽、4 处夹取各写一份，
// 其中两处（selpop / effhint）**完全没有夹取**。只给已知消费者写 CSSOM 断言的话，新浮层换一个
// 类名就绕过去了（REVIEW.md「新增 overflow 容器没先定档」条的同族教训）。本层把判据反过来：
// **凡同时声明「绝对 / 固定定位」与浮层 elevation 配方（box-shadow: var(--shadow-raise)）的
// 选择器，都必须先在注册表归挡**；登记了但源码里已不存在同样判红。
//
// 判据分四层（缺一层就退化成登记表抄写）：
//   ① 覆盖：浮层壳集合 ⊆ 注册表；
//   ② 新鲜度：注册表每个选择器在 CSS 里查得到；
//   ③ 形状：按档位核验宽度声明本身——L / P 档 MUST NOT 持有裸 px 的 `width`，
//      文字随字号缩放的条目 MUST 有 `em` 上限，每条目 MUST 有宽度声明；
//   ④ 声明唯一性：同一选择器同一属性多条声明视为「两处真源」，判红。
// 反向输入（区分度）在文件末尾逐条造红：未登记浮层 / 定值回潮 / 删 em 上限 / 僵尸条目 /
// 重复登记 / 豁免档被改成定值。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { declValues, parseCss } from "./css-rules.ts";
import type { CssRule } from "./css-rules.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------------------
// 注册表
//
// tier：compact（C 单行定长）/ list（L 单行列表）/ prose（P 说明折行）/ exempt（健康反例，
// 形态不改、只登记）。shape 是「宽度声明应长什么样」的机器可读形态：
//   relative  = width 非裸 px（min() / clamp() / % / vw / max-content 等）
//   em-capped = width 非裸 px，且 max-width 含 em（文字随字号缩放的必要形态）
//   fixed     = width 是裸 px（仅 C 档定长内容允许）
//   bounded   = 没有 width，靠 min/max-width 收缩（指针菜单 / toast / 全屏面板）
//   intrinsic = 没有任何宽度声明（尺寸由内容 + 内边距决定，如摘录浮钮）
// scaledText：该浮层的文字随 --lumir-hp-scale 缩放 ⇒ 上限必须是 em（W2）。
// ---------------------------------------------------------------------------

type Tier = "compact" | "list" | "prose" | "exempt";
type Shape = "relative" | "em-capped" | "fixed" | "bounded" | "intrinsic";

interface RegistryEntry {
  tier: Tier;
  shape: Shape;
  selectors: string[];
  scaledText?: boolean;
  note: string;
}

const REGISTRY: RegistryEntry[] = [
  {
    tier: "list",
    shape: "relative",
    selectors: [".lumir-qo", ".lumir-toc"],
    note:
      "快速打开 / 大纲：`min(26em, 100vw − 28px)`（容器 font-size = 行文本 12.5px ⇒ 325px）。" +
      "26em 的上限按「典型 48 字符 vault 路径 302px」定；列表宽度不随输入抖动，深路径靠行的" +
      "两段结构（目录可省略 + 文件名完整 + title）承担。",
  },
  {
    tier: "list",
    shape: "relative",
    selectors: [".vault-pop"],
    note: "vault 切换浮层：`min(320px, 100vw − 16px)`——窗口能缩到比浮层窄（本仓无最小窗口尺寸）。",
  },
  {
    tier: "compact",
    shape: "fixed",
    selectors: [".lumir-goto"],
    note: "跳转行：内容定长（输入框 + 「共 M 行」），C 档定值 200px 不是缺陷形态。",
  },
  {
    tier: "compact",
    shape: "fixed",
    selectors: [".lumir-hp-jumpbottom"],
    note: "「回到底部」浮钮：26×26 图标钮，尺寸即内容。",
  },
  {
    tier: "compact",
    shape: "intrinsic",
    selectors: [".quote-gesture-btn"],
    note: "摘录浮动钮：尺寸由文案 + 内边距决定，不声明宽度。",
  },
  {
    tier: "prose",
    shape: "em-capped",
    scaledText: true,
    selectors: [".lumir-hp-ctxpop", ".lumir-hp-effhint", ".lumir-hp-permpop"],
    note:
      "Context 气泡 / effort hint / 权限释义：内容驱动 + 34em 上限 + 组件下限（ctxpop / effhint " +
      "224px、permpop 208px）。em 上限随 --lumir-hp-scale 缩放——px 上限在 2.13 档把同一句话" +
      "挤成 3 行。下限保留既有设计宽，是为让短内容 fixture 的像素零漂移。",
  },
  {
    tier: "list",
    shape: "em-capped",
    scaledText: true,
    selectors: [".lumir-hp-selpop", ".lumir-hp-sesspop"],
    note:
      "合并选择器 / 会话历史：内容驱动 + 26em 上限 + 既有下限（selpop 188px、sesspop 200px）。" +
      "两处此前的形态是「无夹取」与「定值 200px」——2.13 档 + 320px pane 实测越界 85px / 名字裁 81%。",
  },
  {
    tier: "exempt",
    shape: "bounded",
    selectors: [".ft-menu", ".tab-menu", ".toast-surface", ".lumir-toast", ".lumir-table-fs-panel", ".lumir-lightbox-img"],
    note:
      "健康反例（M698 §4）：指针菜单内容驱动 + min/max 160–280、toast 按 pane 的 70%、表格全屏壳与" +
      "图片灯箱由 max-width:100% 收住。形态不改，只登记——漂移（如给菜单塞一个裸 px width）判红。",
  },
  {
    tier: "exempt",
    shape: "relative",
    selectors: [".ft-confirm", ".lumir-bindings-panel", ".lumir-codeblock-fs-panel", ".lumir-codeblock-fs-content"],
    note:
      "健康反例：删除确认 `min(440px, 100%)`、键位面板 `100%` + `max-width:680px`、代码块全屏壳与" +
      "内容 `max-content` + `max-width:100%`。",
  },
];

const PX = /^\d+(\.\d+)?px$/;

interface World {
  styleCss: string;
  harnessCss: string;
  /** 设置面板样式（change add-model-automation-settings-oct24）：与滚动条注册表同一条覆盖
   *  理由——新 CSS 文件必须进同一套浮层宽度判据，否则换个类名就绕过夹取要求。 */
  settingsCss: string;
  registry: RegistryEntry[];
}

export type ProblemKind =
  | "missing-tier"
  | "stale-entry"
  | "duplicate-entry"
  | "fixed-width"
  | "missing-em-cap"
  | "missing-width"
  | "unexpected-width";

export interface Problem {
  kind: ProblemKind;
  selector: string;
  detail: string;
}

function rulesOf(world: World): CssRule[] {
  return [
    ...parseCss(world.styleCss, "src/style.css"),
    ...parseCss(world.harnessCss, "src/harness-panel.css"),
    ...parseCss(world.settingsCss, "src/settings-panel.css"),
  ];
}

/** 浮层壳 = 同时有「绝对 / 固定定位」与 elevation 配方（`box-shadow: var(--shadow-raise)`）。 */
function floatingSelectors(rules: CssRule[]): Set<string> {
  const positioned = new Set<string>();
  const raised = new Set<string>();
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      for (const d of rule.decls) {
        if (d.prop === "position" && (d.value === "absolute" || d.value === "fixed")) positioned.add(selector);
        if (d.prop === "box-shadow" && d.value.includes("var(--shadow-raise)")) raised.add(selector);
      }
    }
  }
  const out = new Set<string>();
  for (const selector of positioned) if (raised.has(selector)) out.add(selector);
  return out;
}

function checkEntry(rules: CssRule[], entry: RegistryEntry): Problem[] {
  const problems: Problem[] = [];
  if (entry.tier !== "compact" && entry.tier !== "exempt" && entry.shape === "fixed") {
    problems.push({
      kind: "fixed-width",
      selector: entry.selectors[0] ?? "(empty)",
      detail: `${entry.tier} 档不允许 fixed 形态——定值宽度正是「越长越挤」的缺陷形态`,
    });
  }
  for (const selector of entry.selectors) {
    const width = declValues(rules, selector, "width");
    const minWidth = declValues(rules, selector, "min-width");
    const maxWidth = declValues(rules, selector, "max-width");
    const all = [...width, ...minWidth, ...maxWidth];
    const push = (kind: ProblemKind, detail: string): void => {
      problems.push({ kind, selector, detail });
    };

    // ④ 同一属性多条声明 = 两处真源（组件各抄一份值），判据必须看见它。
    for (const [prop, list] of [
      ["width", width],
      ["min-width", minWidth],
      ["max-width", maxWidth],
    ] as const) {
      if (list.length > 1) {
        push(
          "fixed-width",
          `${prop} 被声明了 ${list.length} 次（${list.map((d) => `${d.rule.source}「${d.rule.selector}」`).join(" / ")}）——同一语义两处真源`,
        );
      }
    }

    if (entry.shape !== "intrinsic" && all.length === 0) {
      push("missing-width", "没有任何宽度声明（width / min-width / max-width）");
    }

    switch (entry.shape) {
      case "relative":
        if (width.length === 0) push("missing-width", "relative 形态需要一条 width 声明");
        for (const d of width) {
          if (PX.test(d.value)) push("fixed-width", `width 是裸 px（${d.value}）——窄内容会越出视口 / pane`);
        }
        break;
      case "em-capped":
        for (const d of width) {
          if (PX.test(d.value)) push("fixed-width", `width 是裸 px（${d.value}）——上限必须随字号走`);
        }
        if (width.length === 0) push("missing-width", "内容驱动形态需要 width: max-content");
        if (!maxWidth.some((d) => d.value.includes("em"))) {
          push("missing-em-cap", "文字随 --lumir-hp-scale 缩放，但没有 em 上限（max-width 缺 em）");
        }
        break;
      case "fixed":
        if (width.length === 0) push("missing-width", "fixed 形态需要一条 width 声明");
        if (!width.some((d) => PX.test(d.value))) push("missing-width", "fixed 形态的 width 应为裸 px");
        break;
      case "bounded":
        if (width.length > 0) push("fixed-width", "bounded 形态不应声明 width（应靠 min/max-width 收缩）");
        if (all.length === 0) push("missing-width", "bounded 形态需要 min-width 或 max-width");
        break;
      case "intrinsic":
        if (all.length > 0) push("unexpected-width", "intrinsic 形态不应声明任何宽度");
        break;
    }

    // W2：文字随字号缩放的浮层，上限必须含 em（不限于 max-width——width 里的 min(26em, …) 也算）。
    if (entry.scaledText === true && !all.some((d) => d.value.includes("em"))) {
      push("missing-em-cap", "文字随 --lumir-hp-scale 缩放，但宽度声明里没有 em 上限");
    }
  }
  return problems;
}

export function audit(world: World): Problem[] {
  const problems: Problem[] = [];
  const rules = rulesOf(world);
  const registered = new Set<string>();
  for (const entry of world.registry) {
    for (const selector of entry.selectors) {
      if (registered.has(selector)) problems.push({ kind: "duplicate-entry", selector, detail: "同一选择器登记了多条" });
      registered.add(selector);
    }
  }
  // ① 覆盖：源码里的浮层壳、注册表里没有。
  for (const selector of floatingSelectors(rules)) {
    if (!registered.has(selector)) {
      problems.push({
        kind: "missing-tier",
        selector,
        detail: "同时声明了 position:absolute|fixed 与 box-shadow:var(--shadow-raise)，但未在宽度注册表归挡",
      });
    }
  }
  // ② 新鲜度：注册表里有、源码里没有（改名 / 删除后的僵尸条目）。
  for (const entry of world.registry) {
    for (const selector of entry.selectors) {
      if (!rules.some((r) => r.selectors.includes(selector))) {
        problems.push({ kind: "stale-entry", selector, detail: "注册表条目的选择器在 CSS 里已不存在" });
      }
    }
  }
  // ③ 形状与声明。
  for (const entry of world.registry) problems.push(...checkEntry(rules, entry));
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
    registry: REGISTRY,
  };
}

test("浮层宽度注册表与源码双向对齐，且各档声明实际成立", () => {
  const problems = audit(realWorld());
  assert.deepEqual(
    problems,
    [],
    "浮层宽度分档判据判红：\n" + problems.map((p) => `  - [${p.kind}] ${p.selector}：${p.detail}`).join("\n"),
  );
});

test("注册表覆盖盘点出的全部浮层壳（15 个选择器）", () => {
  const detected = [...floatingSelectors(rulesOf(realWorld()))].sort();
  assert.deepEqual(
    detected,
    [
      ".ft-menu",
      ".lumir-goto",
      ".lumir-hp-ctxpop",
      ".lumir-hp-effhint",
      ".lumir-hp-jumpbottom",
      ".lumir-hp-permpop",
      ".lumir-hp-selpop",
      ".lumir-hp-sesspop",
      ".lumir-qo",
      ".lumir-toast",
      ".lumir-toc",
      ".quote-gesture-btn",
      ".tab-menu",
      ".toast-surface",
      ".vault-pop",
    ],
    "被扫出的浮层壳集合变了：新增浮层请先在 REGISTRY 归挡，删除浮层请同步删条目",
  );
});

// ---------------------------------------------------------------------------
// 反向输入：每条判据先造一个必须让它红的输入（REVIEW.md「断言等价于子串」条）
// ---------------------------------------------------------------------------

const FIXTURE = `
.a-pop {
  position: absolute;
  z-index: 30;
  box-shadow: var(--shadow-raise);
  width: max-content;
  min-width: 224px;
  max-width: 34em;
}
.b-pop {
  position: absolute;
  box-shadow: var(--shadow-raise);
  width: min(26em, calc(100vw - 28px));
}
.c-btn {
  position: absolute;
  box-shadow: var(--shadow-raise);
  width: 26px;
}
`;

function fixture(overrides: Partial<World> = {}): World {
  return {
    styleCss: FIXTURE,
    harnessCss: "",
    settingsCss: "",
    registry: [
      { tier: "prose", shape: "em-capped", scaledText: true, selectors: [".a-pop"], note: "fixture" },
      { tier: "list", shape: "relative", selectors: [".b-pop"], note: "fixture" },
      { tier: "compact", shape: "fixed", selectors: [".c-btn"], note: "fixture" },
    ],
    ...overrides,
  };
}

test("反向输入：未登记的浮层壳判红", () => {
  const problems = audit(
    fixture({
      styleCss: `${FIXTURE}\n.d-pop { position: fixed; box-shadow: var(--shadow-raise); width: 300px; }`,
    }),
  );
  const hit = problems.filter((p) => p.kind === "missing-tier");
  assert.equal(hit.length, 1, `应恰好报一个未登记浮层，实际：${JSON.stringify(problems)}`);
  assert.equal(hit[0].selector, ".d-pop");
});

test("反向输入：P 档定值回潮（width: 224px）判红", () => {
  const problems = audit(fixture({ styleCss: FIXTURE.replace("width: max-content;", "width: 224px;") }));
  const hit = problems.filter((p) => p.kind === "fixed-width" && p.selector === ".a-pop");
  assert.ok(hit.length >= 1, `应报定值回潮，实际：${JSON.stringify(problems)}`);
});

test("反向输入：删掉 em 上限判红（px 上限 / 完全没有上限都要红）", () => {
  const noCap = audit(fixture({ styleCss: FIXTURE.replace("max-width: 34em;", "") }));
  assert.ok(noCap.some((p) => p.kind === "missing-em-cap"), `缺 em 上限应红：${JSON.stringify(noCap)}`);
  const pxCap = audit(fixture({ styleCss: FIXTURE.replace("max-width: 34em;", "max-width: 408px;") }));
  assert.ok(pxCap.some((p) => p.kind === "missing-em-cap"), `px 上限应红：${JSON.stringify(pxCap)}`);
});

test("反向输入：僵尸条目判红", () => {
  const problems = audit(
    fixture({
      registry: [
        { tier: "prose", shape: "em-capped", scaledText: true, selectors: [".a-pop"], note: "fixture" },
        { tier: "list", shape: "relative", selectors: [".b-pop", ".gone-pop"], note: "fixture" },
        { tier: "compact", shape: "fixed", selectors: [".c-btn"], note: "fixture" },
      ],
    }),
  );
  const hit = problems.filter((p) => p.kind === "stale-entry");
  assert.equal(hit.length, 1);
  assert.equal(hit[0].selector, ".gone-pop");
});

test("反向输入：同一选择器登记两档判红", () => {
  const problems = audit(
    fixture({
      registry: [
        { tier: "prose", shape: "em-capped", scaledText: true, selectors: [".a-pop"], note: "fixture" },
        { tier: "list", shape: "relative", selectors: [".b-pop", ".a-pop"], note: "fixture" },
        { tier: "compact", shape: "fixed", selectors: [".c-btn"], note: "fixture" },
      ],
    }),
  );
  assert.ok(problems.some((p) => p.kind === "duplicate-entry" && p.selector === ".a-pop"));
});

test("反向输入：豁免档被改成定值 / 同一属性两处真源判红", () => {
  const bounded = audit(
    fixture({
      styleCss: `${FIXTURE}\n.e-pop { position: absolute; box-shadow: var(--shadow-raise); min-width: 160px; max-width: 280px; width: 260px; }`,
      registry: [
        ...fixture().registry,
        { tier: "exempt", shape: "bounded", selectors: [".e-pop"], note: "fixture" },
      ],
    }),
  );
  assert.ok(bounded.some((p) => p.kind === "fixed-width" && p.selector === ".e-pop"));
  const doubled = audit(
    fixture({
      styleCss: `${FIXTURE}\n.a-pop { max-width: 30em; }`,
    }),
  );
  assert.ok(doubled.some((p) => p.detail.includes("两处真源")), `同属性两条声明应红：${JSON.stringify(doubled)}`);
});

test("反向输入：注释里的浮层声明不算数（剔除注释有区分度）", () => {
  const problems = audit(
    fixture({
      styleCss: `${FIXTURE}\n/* .z-pop { position: fixed; box-shadow: var(--shadow-raise); width: 200px; } */`,
    }),
  );
  assert.equal(problems.filter((p) => p.selector === ".z-pop").length, 0, JSON.stringify(problems));
});
