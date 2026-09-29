import { expect, test, type Page } from "@playwright/test";
import { stubTauri, configGets } from "./tauri-stub";

// M294：**「面」族与一处处前景色的 eink 字面值归位 token**（三主题；纯收敛，值不变）。
//
// 缘起（Alex 2026-09-29 裁决原文：「1. 立；2，删。」）：M293 把「实心强调 / 边框」两族收干净后，
// 还留在字面值上的是一条「面」族（规则⑤ 的**白底**半边，4 处 `#fff`）与一处**前景色**
// （callout 类型标签的 `#000`）。依据仍是 tokens 文档的**收敛规则 1**（eink 的手工反白语义上
// 属于既有 token 的 eink 值，收敛时归位，不新增色）。
//
// 语义位（M293 的「角色归位」口径：按声明在规则里的**角色**选 token，不按字面值反查——
// eink 下 `#fff` 与四个面 token 同值、`#000` 与五个 token 同值，反查必选错）：
//   · **浅底区块翻白 = 区块不另立色面 ⇒ 取正文面 `--content-bg`**（规则⑤ 的实现口径）：
//     代码块底板（`src/style.css` 的 `::before`）、全屏代码块内容容器、callout 行底色。
//     三处的基规则分别是 `--code-bg` / `--code-bg` / 族 tint——在 eink 全档退场（`--code-bg`
//     的灰在 eink 另有承载者，见下注），区块底因此回落成它所在的面。tokens 文档
//     §callout 语义收敛 规则 3 已把这条写死过：「tint 全 transparent（底色 = `--content-bg`）」
//     ——callout 是同一口径的既有先例，本批把它推广到代码块这两个落点。
//   · **frontmatter 盒：删覆盖**（裁决「2，删。」）。它的基规则本就读 `--agent-bg`
//     （tokens 文档 §bg 层级把 frontmatter 区点名为「次级表面」），而 eink 的 `--agent-bg`
//     也是 `#ffffff` ⇒ 那处 eink 覆盖在本档**冗余**。删掉后由基规则接管，值逐值不变。
//   · **callout 类型标签的前景 = `--text`**（不是族色）：eink 覆盖的作用域是**五族共用的**
//     `.cm-lp-callout-type`，而五族的基规则色分别取 `--accent`/`--ok`/`--pending`/`--danger`/
//     `--text-3`——没有一个「族色 token」能代表五族；且规则②（色相在 eink 不承担信息）之后，
//     标签靠文案区分、颜色只是「统一前景」这件事 ⇒ 语义位是正文色 `--text`。
//     （同口径先例：M291 r3 把 `.lumir-block-trigger` 静止态的 `color: #000` 归位到 `--text`。）
//
// **注（本批查实的两个既有事实，本批不动，只作断言背景）**：
//   ① 代码块在 eink 是**两层**：底板（`::before`，本批归位的那处）与行区带（`::after`，读
//      `--code-bg` = `#f0f0f0`）——restyle-eink 的规则⑤用例把这条写成断言（「只有底板翻转」），
//      故 `--code-bg` 在 eink 不是没有消费者，本批 MUST NOT 把它也一并翻白。
//   ② 全屏代码块内容容器在 eink 是**单层**（整块白），没有行区带那一层。
//
// **本批的不变量是「值逐值不变」**，所以断言分两层（缺一层就退化成假绿）：
//   ① **值**：元素的计算色 == 归属 token 的计算值（三主题；eink 是被改写的那一档）；
//   ② **归属**（REVIEW.md 第 1 条的防线，区分度自证）：把归属 token 临时改成一个三主题都不用的
//      探测色，元素的计算色 MUST 跟着变。**写死字面值的声明不会跟着变**——修前跑本文件时
//      eink 用例全红在 ②、①全绿，正是「值不变、只是不再硬编码」这件事的签名。
//
// 不新增任何像素基线：本批零渲染差异，若哪张既有基线变红，那是**值变了**的警报，
// 不是「基线该更新」——MUST NOT 用 `--update` 把它抹平。

const THEMES = ["light", "dark", "eink"] as const;
type Theme = (typeof THEMES)[number];

const DOC = "m294.md";
/** 场景文档：frontmatter（frontmatter 盒）+ note callout（行底色与类型标签）+ js 代码块
 *  （底板那层，同时是全屏浮层入口）。 */
const SOURCE = [
  "---",
  "title: M294 场景",
  "status: open",
  "---",
  "",
  "# M294 场景",
  "",
  "> [!note] 提示",
  "> callout 正文。",
  "",
  "```js",
  "const alpha = 1;",
  "```",
  "",
].join("\n");
const KEYS = { "Cmd-k": "code-block.toggle-fullscreen" };

type CmView = {
  state: { doc: { toString(): string } };
  dispatch(spec: { selection?: { anchor: number } }): void;
  focus(): void;
};

async function openDoc(page: Page, theme: Theme): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: DOC, kind: "file", size: SOURCE.length, mtime_ms: 0 }],
    files: { [DOC]: SOURCE },
    config: { theme, keys: KEYS },
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${DOC}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(DOC);
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await page.waitForTimeout(80);
}

async function caretAt(page: Page, needle: string): Promise<void> {
  const pos = await page.evaluate((n) => {
    const el = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: CmView } } };
    const text = el.cmTile.root.view.state.doc.toString();
    const at = text.indexOf(n);
    if (at < 0) throw new Error(`fixture 里找不到 ${n}`);
    return at;
  }, needle);
  await page.evaluate((p) => {
    const el = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: CmView } } };
    el.cmTile.root.view.dispatch({ selection: { anchor: p } });
    el.cmTile.root.view.focus();
  }, pos);
}

const TOKEN_NAMES = ["contentBg", "agentBg", "codeBg", "text", "accent", "accentTint"] as const;
type TokenKey = (typeof TOKEN_NAMES)[number];
const TOKEN_VARS: Record<TokenKey, string> = {
  contentBg: "--content-bg",
  agentBg: "--agent-bg",
  codeBg: "--code-bg",
  text: "--text",
  accent: "--accent",
  accentTint: "--accent-tint",
};

type Snapshot = {
  tokens: Record<TokenKey, string>;
  counts: Record<string, number>;
  boxes: Record<string, string | null>;
};

/** 选择器表：`pseudo` 非空时读伪元素的属性（代码块底板是 `::before` 画的，
 *  容器自己的背景是透明的——M288 起是这个形态，`restyle-eink` 规则⑤用例同口径）。 */
const SELECTORS: Record<string, { sel: string; prop: string; pseudo?: string }> = {
  codePlate: { sel: ".cm-lp-codeblock-scroll", prop: "backgroundColor", pseudo: "::before" },
  codeBand: { sel: ".cm-lp-codeblock-scroll", prop: "backgroundColor", pseudo: "::after" },
  fsContent: { sel: ".lumir-codeblock-fs-content", prop: "backgroundColor" },
  callout: { sel: ".cm-line.cm-lp-callout-line", prop: "backgroundColor" },
  frontmatter: { sel: ".cm-lp-frontmatter", prop: "backgroundColor" },
  typeLabel: { sel: ".cm-lp-callout-type", prop: "color" },
  typeLabelZh: { sel: ".cm-lp-callout-type-zh", prop: "color" },
};
/** 元素数量**逐个钉死**（不是「读不到就跳过」）：callout 的两种**行**都在场（提示行 + 正文行
 *  都带 `cm-lp-callout-line`），故它期望 2；其余各 1。数量不符即 FAIL——REVIEW.md 第 2 条
 *  的「读不到 ≠ 为空」在这层的落点。 */
const EXPECTED_COUNTS: Record<string, number> = {
  codePlate: 1,
  codeBand: 1,
  fsContent: 1,
  callout: 2,
  frontmatter: 1,
  typeLabel: 1,
  typeLabelZh: 1,
};

/** 页面侧：把 token 计算值 + 各表面的读数一次读齐（同一帧，避免中途状态变化）。
 *  `counts` 与读数用同一选择器：元素缺失时 count 立刻暴露（**读不到 ≠ 为空**，
 *  REVIEW.md 第 2 条），读数落在 `null` 上不许静默通过。 */
function collect(page: Page): Promise<Snapshot> {
  return page.evaluate(
    ({ selectors, vars }) => {
      const tokenOf = (name: string): string => {
        const probe = document.createElement("div");
        probe.style.background = `var(${name})`;
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      };
      const counts: Record<string, number> = {};
      const boxes: Record<string, string | null> = {};
      for (const [key, spec] of Object.entries(selectors)) {
        counts[key] = document.querySelectorAll(spec.sel).length;
        const el = document.querySelector<HTMLElement>(spec.sel);
        if (el === null) {
          boxes[key] = null;
          continue;
        }
        const cs = getComputedStyle(el, spec.pseudo ?? undefined);
        boxes[key] = spec.prop === "color" ? cs.color : cs.backgroundColor;
      }
      const tokens = {} as Record<string, string>;
      for (const [key, name] of Object.entries(vars)) tokens[key] = tokenOf(name);
      return { tokens: tokens as Record<string, string>, counts, boxes };
    },
    { selectors: SELECTORS, vars: TOKEN_VARS },
  ) as Promise<Snapshot>;
}

const PROBE_COLOR = "rgb(7, 8, 9)";

/** 归属判据的读数口（与 `collect` 同一取值口径，含伪元素）。 */
function propOf(page: Page, key: string, pseudoOverride?: string | null): Promise<string | null> {
  const spec = SELECTORS[key];
  return page.locator(spec.sel).first().evaluate(
    (el, { prop, pseudo }) => {
      const cs = getComputedStyle(el, pseudo ?? undefined);
      return prop === "color" ? cs.color : cs.backgroundColor;
    },
    { prop: spec.prop, pseudo: pseudoOverride === undefined ? spec.pseudo : pseudoOverride },
  );
}

/** 等过渡落定：连续两次采样同值才算落定（改 token 可能触发一次过渡，
 *  紧随其后的同步读数是**过渡起点**，会把「已归位」误判成「没归位」）。 */
async function settle(page: Page, read: () => Promise<string | null>): Promise<void> {
  let prev = await read();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(50);
    const next = await read();
    if (next === prev) return;
    prev = next;
  }
}

/** 归属判据：把 token 临时改成探测色，元素的这条计算属性 MUST 跟着变（改回后 MUST 复原）。 */
async function probeTokenFollows(page: Page, key: string, token: TokenKey) {
  const read = () => propOf(page, key);
  const setToken = (value: string | null) =>
    page.evaluate(
      ({ token, value }) => {
        const root = document.documentElement;
        if (value === null) root.style.removeProperty(token);
        else root.style.setProperty(token, value);
      },
      { token: TOKEN_VARS[token], value },
    );

  const before = await read();
  await setToken(PROBE_COLOR);
  await settle(page, read);
  const during = await read();
  await setToken(null);
  await settle(page, read);
  return { before, during, restored: await read() };
}

/** 归属判据的两条断言：跟着变（写死字面值不会变）+ 探测后复原。 */
function expectFollows(reading: { before: string | null; during: string | null; restored: string | null }, what: string): void {
  // `expect.soft`：一个用例里有 4 处归属判据（面族），首处失败即中断会让「其余三处是否也没归位」
  // 在日志里消失——先红那一轮要看到**每一处**的失败，才能证明它们各自都曾被写死。
  expect.soft(reading.during, `${what} MUST 跟着归属 token 变（写死字面值的声明不会变）`).toBe(PROBE_COLOR);
  expect.soft(reading.restored, `${what} 的探测 MUST 复原`).toBe(reading.before);
}

/** 归属表：`token` = light/dark（基规则）那一档的 token，`einkToken` = eink 覆盖那一档的 token。
 *  frontmatter 两档同一个（基规则 `--agent-bg`，eink 覆盖已删）；callout 的浅底在 light/dark 是
 *  **族 tint**（本 fixture 是 info 族 ⇒ `--accent-tint`；色条才是 `--accent`）。 */
const SURFACE_BASE: Record<string, { token: TokenKey; einkToken: TokenKey; why: string }> = {
  codePlate: {
    token: "codeBg",
    einkToken: "contentBg",
    why: "eink 无灰底可用 ⇒ 底板翻白，取正文面（基规则读 --code-bg）",
  },
  fsContent: {
    token: "codeBg",
    einkToken: "contentBg",
    why: "同上；同一角色（代码块内容面）两处取同一 token，不因所在浮层分家",
  },
  callout: {
    token: "accentTint",
    einkToken: "contentBg",
    why: "tint 在 eink 全退场 ⇒ 底色 = 正文面（callout 语义收敛规则 3 的既有口径）",
  },
  frontmatter: {
    token: "agentBg",
    einkToken: "agentBg",
    why: "基规则本就是 --agent-bg（次级表面），eink 的冗余覆盖已删 ⇒ 基规则接管",
  },
};

for (const theme of THEMES) {
  test(`M294 面族（浅底区块翻白：代码块底板 / 全屏内容 / callout 行 / frontmatter 盒）[${theme}]：值 == 归属 token，且随 token 变`, async ({ page }) => {
    await openDoc(page, theme);
    await expect(page.locator(".cm-lp-codeblock-scroll")).toHaveCount(1);
    await caretAt(page, "const alpha");
    await page.keyboard.press("Meta+k");
    await expect(page.locator(".lumir-codeblock-fs-overlay")).toBeVisible();

    const reading = await collect(page);
    console.log(`[m294-readings] ${theme} 面族 ${JSON.stringify(reading)}`);

    for (const [key, spec] of Object.entries(SELECTORS)) {
      expect(reading.counts[key], `${spec.sel} 数量（读不到 ≠ 为空）`).toBe(EXPECTED_COUNTS[key]);
    }

    // ① 值：三主题各自的归属 token（表见 SURFACE_BASE，逐条理由在 why 里）。
    for (const [key, expected] of Object.entries(SURFACE_BASE)) {
      const tokenKey = theme === "eink" ? expected.einkToken : expected.token;
      expect(reading.boxes[key], `${key} 底色 = ${TOKEN_VARS[tokenKey]}（${expected.why}）`).toBe(
        reading.tokens[tokenKey],
      );
    }
    // 行区带（`::after`）是**另一层**、本批 MUST NOT 动：三主题都读 `--code-bg`，eink 下它是
    // `#f0f0f0` 的灰而不是白（restyle-eink 规则⑤「只有底板翻转」的口径）。
    expect(reading.boxes.codeBand, "行区带 = --code-bg（三主题，含 eink 的灰）").toBe(reading.tokens.codeBg);

    if (theme === "eink") {
      // ② 归属：四处的归属 token 各自都要真的被声明读到。frontmatter 那处是**删覆盖后由基规则
      // 接管**——探测 `--agent-bg` 若不动，说明接管的不是基规则（而是又一处写死的声明）。
      expectFollows(await probeTokenFollows(page, "codePlate", "contentBg"), "代码块底板");
      expectFollows(await probeTokenFollows(page, "fsContent", "contentBg"), "全屏代码块内容容器");
      expectFollows(await probeTokenFollows(page, "callout", "contentBg"), "callout 行底色");
      expectFollows(await probeTokenFollows(page, "frontmatter", "agentBg"), "frontmatter 盒底色");
    }
  });

  test(`M294 前景色（callout 类型标签）[${theme}]：值 == 归属 token，且随 token 变`, async ({ page }) => {
    await openDoc(page, theme);

    const reading = await collect(page);
    console.log(`[m294-readings] ${theme} 前景色 ${JSON.stringify(reading)}`);
    for (const key of ["typeLabel", "typeLabelZh"] as const) {
      expect(reading.counts[key], `${SELECTORS[key].sel} 数量`).toBe(EXPECTED_COUNTS[key]);
    }

    // ① 值：light/dark 的标签是本族的族色（本 fixture 是 info 族 ⇒ `--accent`）；
    // eink 五族合一、色相不再承担信息 ⇒ 取正文色（归位前是字面值 `#000`，逐值相同）。
    const want = theme === "eink" ? reading.tokens.text : reading.tokens.accent;
    expect(reading.boxes.typeLabel, "类型标签色 = 本档归属 token").toBe(want);
    expect(reading.boxes.typeLabelZh, "中文标签段继承同一色（它是可见的那一段）").toBe(want);

    if (theme === "eink") {
      expectFollows(await probeTokenFollows(page, "typeLabel", "text"), "callout 类型标签");
      // 双段里英文名本就取 `--text`（基规则）；eink 归位后两段同色——这是断言，不是巧合。
      expect(reading.boxes.typeLabelZh, "eink 下两段标签同色").toBe(reading.boxes.typeLabel);
    }
  });
}
