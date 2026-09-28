import { expect, test, type Page } from "@playwright/test";
import { stubTauri, configGets } from "./tauri-stub";

// M293：**eink 实心强调族 / 边框族的字面值归位 token**（三主题；纯收敛，值不变）。
//
// 缘起（Alex 2026-09-29 裁决「改。你可以安排时就动手。」）：M291 r3 的 review-request 登记了同族残留
// ——搜索面板的两处**实心档**（大小写开关「开」态、当前搜索匹配）用 `#000` 底 + `#fff` 字，
// 代码块区的 eink 黑框用 `1px solid #000`。它们的字面值与 eink 的 token 同值（行为未变），
// 因此不在 M291 的裁决面内，单独一批收。tokens 文档的**收敛规则 1**（「组件里只剩 eink 的手工
// 反白，它们语义上属于既有 token 的 eink 值，收敛时归位，不新增色」）就是本批的依据。
//
// 两族与归属：
//   · **实心强调族** = `--accent-fill` / `--accent-fill-text`（eink `#000000` / `#ffffff`）：
//     `src/search-panel.css` 的两处 eink 覆盖（大小写开关「开」态、当前搜索匹配）。
//   · **边框族** = `--border`（eink `#000000`）：`src/style.css` 的代码块横滚容器 eink 黑框、
//     文件树「打开目录」入口的 eink 描边、表格全屏 / 代码块全屏 / 全屏内容三处 eink 黑框。
//     线宽（1.4px = eink 规则⑧「强调 = 加粗线宽」的那一档）不动，只归位颜色。
//
// **本批的不变量是「值逐值不变」**，所以断言分两层（缺一层就退化成假绿）：
//   ① **值**：元素的计算色 == 归属 token 的计算值（三主题；eink 是被改写的那一档）；
//   ② **归属**（REVIEW.md 第 1 条的防线，区分度自证）：把归属 token 临时改成一个三主题都不用的
//      探测色，元素的计算色 MUST 跟着变。**写死字面值的声明不会跟着变**——修前跑本文件时
//      ②全红、①全绿，正是「值不变、只是不再硬编码」这件事的签名；改了字面值（比如误写成别的色）
//      则①红。两条一起才能钉住「归位」。
//
// 不新增任何像素基线：本批零渲染差异，若哪张既有基线变红，那是**值变了**的警报，
// 不是「基线该更新」——MUST NOT 用 `--update` 把它抹平。

const THEMES = ["light", "dark", "eink"] as const;
type Theme = (typeof THEMES)[number];

const DOC = "m293.md";
/** 场景文档：标题（含大写 M293）+ 正文两处小写 m293（大小写开关的判别物）+ 一张矩形表 +
 *  一块 js 代码块（全屏两处浮层的入口各自要一块）。 */
const SOURCE = [
  "# M293 场景",
  "",
  "正文里有 m293 目标词与另一个 m293 目标词。",
  "",
  "| 甲 | 乙 |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "```js",
  "const alpha = 1;",
  "```",
  "",
].join("\n");
const QUERY = "m293";
/** 搜索面板的「当前匹配」只在**选区恰好等于某处匹配**时上标记（@codemirror/search 的
 *  `r.from == from && r.to == to` 判据）⇒ 必须真的步进一次，不能只填查询词。 */
const TRIGGER_KEYS = { "Cmd-j": "table.toggle-fullscreen", "Cmd-k": "code-block.toggle-fullscreen" };

type CmView = {
  state: { doc: { toString(): string }; selection: { main: { head: number } } };
  dispatch(spec: { selection?: { anchor: number } }): void;
  focus(): void;
  contentDOM: HTMLElement;
};

async function openDoc(page: Page, theme: Theme, doc = DOC, source = SOURCE): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: doc, kind: "file", size: source.length, mtime_ms: 0 }],
    files: { [doc]: source },
    config: { theme, keys: TRIGGER_KEYS },
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${doc}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(doc);
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
    const view = el.cmTile.root.view;
    view.dispatch({ selection: { anchor: p } });
    view.focus();
  }, pos);
}

interface BoxReading {
  borderTopWidth: string;
  borderTopStyle: string;
  borderTopColor: string;
  /** 左侧边框单独读一份：callout 的色条只有左边框（`borderLeft`），顶边读数是 0。 */
  borderLeftWidth: string;
  borderLeftStyle: string;
  borderLeftColor: string;
  backgroundColor: string;
  color: string;
  decorationLine: string;
}

interface Snapshot {
  boxes: Record<string, BoxReading | null>;
  counts: Record<string, number>;
  tokens: { border: string; accentFill: string; accentFillText: string; accentTint: string; accent: string };
}

/** 页面侧：把选择器集合 + 归属 token 的计算值一次读齐（同一帧，避免中途状态变化）。
 *  `count` 与 `read` 用同一个选择器：元素缺失时 count 立刻暴露（**读不到 ≠ 为空**，
 *  REVIEW.md 第 2 条），读数落在 `null` 上不许静默通过。 */
function collect(page: Page, selectors: Record<string, string>): Promise<Snapshot> {
  return page.evaluate((sels) => {
    const tokenOf = (name: string): string => {
      const probe = document.createElement("div");
      probe.style.background = `var(${name})`;
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    };
    const boxes: Record<string, BoxReading | null> = {};
    const counts: Record<string, number> = {};
    for (const [key, selector] of Object.entries(sels)) {
      counts[key] = document.querySelectorAll(selector).length;
      const el = document.querySelector<HTMLElement>(selector);
      if (el === null) {
        boxes[key] = null;
        continue;
      }
      const cs = getComputedStyle(el);
      boxes[key] = {
        borderTopWidth: cs.borderTopWidth,
        borderTopStyle: cs.borderTopStyle,
        borderTopColor: cs.borderTopColor,
        borderLeftWidth: cs.borderLeftWidth,
        borderLeftStyle: cs.borderLeftStyle,
        borderLeftColor: cs.borderLeftColor,
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        decorationLine: cs.textDecorationLine,
      };
    }
    return {
      boxes,
      counts,
      tokens: {
        border: tokenOf("--border"),
        accentFill: tokenOf("--accent-fill"),
        accentFillText: tokenOf("--accent-fill-text"),
        accentTint: tokenOf("--accent-tint"),
        accent: tokenOf("--accent"),
      },
    };
  }, selectors);
}

/** 等 CSS 过渡落定：`.lumir-search-button` 带 `transition: background var(--dur-ui)`（120ms），
 *  「刚点上大小写开关」那一拍的读数是**过渡中的间值**（实测读到 `rgba(0,0,0,0)`、稳态是
 *  `rgb(0,0,0)`）——按间值断言会拿一个不存在的缺陷报红。判据：连续两次采样同值才算落定。 */
async function settle(page: Page, read: () => Promise<string>): Promise<void> {
  let prev = await read();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(50);
    const next = await read();
    if (next === prev) return;
    prev = next;
  }
}

function bgOf(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);
}

function propOf(page: Page, selector: string, prop: keyof BoxReading): Promise<string> {
  return page.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p as "borderTopColor"], prop);
}

const PROBE_COLOR = "rgb(7, 8, 9)";

/** 归属判据：把 token 临时改成探测色，元素的这条计算属性 MUST 跟着变（改回后 MUST 复原）。
 *  三次读数各自先等过渡落定——`.lumir-search-button` 带 `transition: background`，改 token 会
 *  触发一次过渡，紧接着的同步读数是**过渡起点**（实测读到旧值 `rgb(0,0,0)`），
 *  那会把「已归位」误判成「没归位」（REVIEW.md 第 1 条的反向形态：判据拿错了输入）。 */
async function probeTokenFollows(page: Page, selector: string, token: string, prop: keyof BoxReading) {
  const read = () => propOf(page, selector, prop);
  const setToken = (value: string | null) =>
    page.evaluate(
      ({ token, value }) => {
        const root = document.documentElement;
        if (value === null) root.style.removeProperty(token);
        else root.style.setProperty(token, value);
      },
      { token, value },
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
function expectFollows(reading: { before: string; during: string; restored: string }, what: string): void {
  expect(reading.during, `${what} MUST 跟着归属 token 变（写死字面值的声明不会变）`).toBe(PROBE_COLOR);
  expect(reading.restored, `${what} 的探测 MUST 复原`).toBe(reading.before);
}

const SEARCH_SELECTORS = {
  caseOn: ".lumir-search-case.is-on",
  selected: ".cm-searchMatch-selected",
  plain: ".cm-searchMatch:not(.cm-searchMatch-selected)",
};

for (const theme of THEMES) {
  test(`M293 实心强调族（搜索面板两处实心档）[${theme}]：值 == 归属 token，且随 token 变`, async ({ page }) => {
    await openDoc(page, theme);

    await page.keyboard.press("Meta+f");
    await expect(page.locator(".lumir-search")).toBeVisible();
    await page.locator(".lumir-search-input").fill(QUERY);
    await page.getByRole("button", { name: "区分大小写" }).click();
    await expect(page.locator(".lumir-search-case.is-on")).toHaveCount(1);
    // 步进一次才产生「当前匹配」（见 QUERY 旁的说明）。
    await page.getByRole("button", { name: "下一个" }).click();
    await expect(page.locator(".cm-searchMatch-selected")).toHaveCount(1);
    await settle(page, () => bgOf(page, SEARCH_SELECTORS.caseOn));

    const reading = await collect(page, SEARCH_SELECTORS);
    console.log(`[m293-readings] ${theme} 实心强调族 ${JSON.stringify(reading)}`);
    for (const [key, selector] of Object.entries(SEARCH_SELECTORS)) {
      expect(reading.counts[key], `${selector} MUST 恰好一处（读不到 ≠ 为空）`).toBe(1);
    }

    // ① 值：大小写开关「开」态在基础规则（light / dark）是**淡底强调**（`--accent-tint` 底 +
    // `--accent` 字）；eink 的 tint 整档退场（规则①）⇒ 该档的覆盖走**实心强调**族——本批归位的
    // 那对（`--accent-fill` / `--accent-fill-text` = 修前的 `#000` / `#fff` 字面值，逐值相同）。
    const caseBg = theme === "eink" ? reading.tokens.accentFill : reading.tokens.accentTint;
    const caseFg = theme === "eink" ? reading.tokens.accentFillText : reading.tokens.accent;
    expect(reading.boxes.caseOn!.backgroundColor, "「开」态底色 = 本档归属 token").toBe(caseBg);
    expect(reading.boxes.caseOn!.color, "「开」态字色 = 本档归属 token").toBe(caseFg);
    // 当前匹配取同一对；未选中的匹配在本档是「tint 退场 ⇒ 透明底 + 下划线」（eink 规则①⑨），
    // 故当前匹配 MUST 把它压成实心 + 无下划线——这是 eink 覆盖块里非冗余的那一半。
    expect(reading.boxes.selected!.backgroundColor, "当前匹配底色 = --accent-fill").toBe(reading.tokens.accentFill);
    expect(reading.boxes.selected!.color, "当前匹配字色 = --accent-fill-text").toBe(reading.tokens.accentFillText);
    if (theme === "eink") {
      expect(reading.boxes.plain!.backgroundColor, "eink 未选中匹配 = tint 退场（透明底）").toBe("rgba(0, 0, 0, 0)");
      expect(reading.boxes.plain!.decorationLine, "eink 未选中匹配靠下划线").toBe("underline");
      expect(reading.boxes.selected!.decorationLine, "当前匹配 MUST 无下划线（实心档自己承担层级）").toBe("none");
      // ② 归属：这两个 token 各自都要真的被这四条声明读到。
      expectFollows(await probeTokenFollows(page, SEARCH_SELECTORS.caseOn, "--accent-fill", "backgroundColor"), "「开」态底色");
      expectFollows(await probeTokenFollows(page, SEARCH_SELECTORS.caseOn, "--accent-fill-text", "color"), "「开」态字色");
      expectFollows(await probeTokenFollows(page, SEARCH_SELECTORS.selected, "--accent-fill", "backgroundColor"), "当前匹配底色");
      expectFollows(await probeTokenFollows(page, SEARCH_SELECTORS.selected, "--accent-fill-text", "color"), "当前匹配字色");
    }
  });

  test(`M293 边框族（代码块 / 全屏两处浮层 / 全屏内容）[${theme}]：值 == --border，且随 token 变`, async ({ page }) => {
    await openDoc(page, theme);

    // 文档内代码块的横滚容器：eink 才有这一圈 1px 黑框（light/dark 无框，靠浅底区分）。
    const inner = await collect(page, { codeScroll: ".cm-lp-codeblock-scroll" });
    expect(inner.counts.codeScroll, "文档内代码块容器 MUST 在场").toBe(1);
    if (theme === "eink") {
      expect(inner.boxes.codeScroll!.borderTopWidth, "eink 代码块黑框仍是 1px（本批只归位颜色）").toBe("1px");
      expect(inner.boxes.codeScroll!.borderTopStyle).toBe("solid");
      expect(inner.boxes.codeScroll!.borderTopColor, "eink 代码块黑框 = --border").toBe(inner.tokens.border);
    } else {
      expect(inner.boxes.codeScroll!.borderTopStyle, `${theme} 的代码块无框（规则⑤是 eink 专属）`).toBe("none");
    }

    // 表格全屏浮层（eink 规则⑦⑧：阴影退场、边框升级 1.4px 实心黑）。
    await caretAt(page, "| 甲 |");
    await page.keyboard.press("Meta+j");
    await expect(page.locator(".lumir-table-fs-overlay")).toBeVisible();
    const table = await collect(page, { tablePanel: ".lumir-table-fs-panel" });
    await page.keyboard.press("Escape");
    await expect(page.locator(".lumir-table-fs-overlay")).toBeHidden();

    // 代码块全屏浮层 + 全屏内容容器（后者的 1px 黑框也是 eink 专属，light/dark 无框）。
    await caretAt(page, "const alpha");
    await page.keyboard.press("Meta+k");
    await expect(page.locator(".lumir-codeblock-fs-overlay")).toBeVisible();
    const overlay = await collect(page, { cbPanel: ".lumir-codeblock-fs-panel", cbContent: ".lumir-codeblock-fs-content" });

    const reading: Snapshot = {
      tokens: inner.tokens,
      boxes: {
        codeScroll: inner.boxes.codeScroll,
        tablePanel: table.boxes.tablePanel,
        cbPanel: overlay.boxes.cbPanel,
        cbContent: overlay.boxes.cbContent,
      },
      counts: { ...inner.counts, ...table.counts, ...overlay.counts },
    };
    console.log(`[m293-readings] ${theme} 边框族 ${JSON.stringify(reading)}`);
    for (const [key, selector] of Object.entries({
      tablePanel: ".lumir-table-fs-panel",
      cbPanel: ".lumir-codeblock-fs-panel",
      cbContent: ".lumir-codeblock-fs-content",
    })) {
      expect(reading.counts[key], `${selector} MUST 恰好一处`).toBe(1);
    }

    // 三处浮层边框：值 == --border。线宽档本批**不动**（源码里仍是 1px / 1.4px，1.4px 是 eink
    // 规则⑧的强调档）——但 chromium 在 dsf=1 下把 1.4px 折成整数档，计算值读回仍是 `1px`
    //（实测），所以这一层只钉「有框 + 颜色 == --border」，线宽由源码逐字复核 + 未变的像素基线兜底。
    // 表格 / 代码块全屏面板在 light/dark 本就有 1px --border 的壳（基础规则）；
    // 全屏**内容**容器的黑框是 eink 专属（light/dark 无框，靠 --code-bg 区分）。
    for (const [key, what, einkOnly] of [
      ["tablePanel", "表格全屏面板", false],
      ["cbPanel", "代码块全屏面板", false],
      ["cbContent", "代码块全屏内容容器", true],
    ] as const) {
      const box = reading.boxes[key]!;
      if (einkOnly && theme !== "eink") {
        expect(box.borderTopStyle, `${what} 在 ${theme} 无框（规则⑤的两个落点之一）`).toBe("none");
        expect(box.borderTopWidth).toBe("0px");
        continue;
      }
      expect(box.borderTopStyle, `${what} MUST 有框`).toBe("solid");
      expect(box.borderTopWidth, `${what} 线宽（1.4px 档在 dsf=1 下折成 1px）`).toBe("1px");
      expect(box.borderTopColor, `${what} 边框 = --border`).toBe(reading.tokens.border);
    }

    if (theme === "eink") {
      expectFollows(await probeTokenFollows(page, ".cm-lp-codeblock-scroll", "--border", "borderTopColor"), "eink 代码块黑框");
      expectFollows(await probeTokenFollows(page, ".lumir-table-fs-panel", "--border", "borderTopColor"), "表格全屏面板边框");
      expectFollows(await probeTokenFollows(page, ".lumir-codeblock-fs-panel", "--border", "borderTopColor"), "代码块全屏面板边框");
      expectFollows(await probeTokenFollows(page, ".lumir-codeblock-fs-content", "--border", "borderTopColor"), "代码块全屏内容边框");
    }
  });

  test(`M293 边框族（文件树「打开目录」入口）[${theme}]：值 == --border，且随 token 变`, async ({ page }) => {
    // 未打开 vault 的空态：`.ft-open-btn` 唯一的落点（src/style.css 的 eink 覆盖把它从基础规则的
    // `var(--border)` 再写成字面值 `#000`——本批归位，值不变）。
    // 这一态没有 vault fixture，主题改由**运行期切换**给（⌘⇧T 循环 light→dark→eink，与
    // theme-live-switch 场景同一条入口）；循环次数按目标档算，切换后以 `data-theme` 为准。
    await stubTauri(page, null);
    await page.goto("/");
    await expect(page.locator(".ft-open-btn")).toBeVisible();
    await expect.poll(() => configGets(page)).toBeGreaterThan(0);
    for (let i = 0; i < THEMES.indexOf(theme); i++) await page.keyboard.press("Meta+Shift+T");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);

    const reading = await collect(page, { openBtn: ".ft-open-btn" });
    console.log(`[m293-readings] ${theme} 边框族（打开入口）${JSON.stringify(reading)}`);
    expect(reading.counts.openBtn).toBe(1);
    expect(reading.boxes.openBtn!.borderTopStyle).toBe("solid");
    expect(reading.boxes.openBtn!.borderTopWidth).toBe("1px");
    expect(reading.boxes.openBtn!.borderTopColor, "打开入口描边 = --border").toBe(reading.tokens.border);
    if (theme === "eink") {
      expectFollows(await probeTokenFollows(page, ".ft-open-btn", "--border", "borderTopColor"), "打开入口描边");
    }
  });
}

// ── 编辑器**内容面**的 eink 黑框（真源在 src/preview/theme.ts，CM 主题注入而不是 CSS 文件）─────
// frontmatter 区（规则⑤的另一半）、fm 状态 chip 与 tags chip（规则⑥）、callout 左色条。
// 同一批裁决（Alex 2026-09-29）里 tower 把本 mission 的 scope 扩到 theme.ts，理由就是这一组：
// 它们的字面值与 eink 的 `--border` 同值，行为未变，属「边框族」的收敛面。
// 同文件里**不动**的两处（`backgroundColor: "#fff"` 的白底半边、callout 类型标签的
// `color: "#000"` 前景色）不属本批两族，理由与清单见 docs/backlog.md 的 M293 节。
const CONTENT_DOC = "m293-content.md";
const CONTENT_SOURCE = [
  "---",
  "title: M293 内容面",
  "status: open",
  "tags: [probe]",
  "---",
  "",
  "# M293 内容面",
  "",
  "> [!note] 提示",
  "> callout 正文。",
  "",
].join("\n");

const CONTENT_SELECTORS = {
  frontmatter: ".cm-lp-frontmatter",
  fmStatus: ".cm-lp-fm-status",
  tag: ".cm-lp-tag",
  callout: ".cm-line.cm-lp-callout-line",
};

for (const theme of THEMES) {
  test(`M293 边框族（内容面：frontmatter / 两个 chip / callout 色条）[${theme}]：值 == --border，且随 token 变`, async ({ page }) => {
    await openDoc(page, theme, CONTENT_DOC, CONTENT_SOURCE);
    // callout 的两种**行**都在场（提示行 + 正文行都带 `cm-lp-callout-line`，色条与底色取第一行）。
    const expectedCounts = { frontmatter: 1, fmStatus: 1, tag: 1, callout: 2 } as const;
    await expect(page.locator(".cm-lp-frontmatter")).toHaveCount(expectedCounts.frontmatter);
    await expect(page.locator(".cm-lp-fm-status")).toHaveCount(expectedCounts.fmStatus);
    await expect(page.locator(".cm-lp-tag")).toHaveCount(expectedCounts.tag);
    await expect(page.locator(".cm-line.cm-lp-callout-line")).toHaveCount(expectedCounts.callout);

    const reading = await collect(page, CONTENT_SELECTORS);
    console.log(`[m293-readings] ${theme} 边框族（内容面）${JSON.stringify(reading)}`);
    for (const [key, selector] of Object.entries(CONTENT_SELECTORS)) {
      expect(reading.counts[key], `${selector} 数量（读不到 ≠ 为空）`).toBe(expectedCounts[key as keyof typeof expectedCounts]);
    }

    // frontmatter 区、两个 chip：eink 专属的黑框（light/dark 靠浅底 + 无框区分）。
    for (const [key, what] of [
      ["frontmatter", "frontmatter 盒"],
      ["fmStatus", "fm 状态 chip"],
      ["tag", "tags chip"],
    ] as const) {
      const box = reading.boxes[key]!;
      if (theme === "eink") {
        expect(box.borderTopStyle, `${what} MUST 有框（eink 规则⑤⑥）`).toBe("solid");
        expect(box.borderTopWidth, `${what} 线宽仍是 1px`).toBe("1px");
        expect(box.borderTopColor, `${what} 描边 = --border`).toBe(reading.tokens.border);
      } else {
        expect(box.borderTopStyle, `${what} 在 ${theme} 无框`).toBe("none");
      }
    }

    // callout 左色条：三主题都是 2px 实线；eink 五族合一取黑（本批归位到 --border），
    // light/dark 是族色（本 fixture 是 info 族 ⇒ --accent）。
    const callout = reading.boxes.callout!;
    expect(callout.borderLeftWidth, "callout 色条线宽仍是 2px").toBe("2px");
    expect(callout.borderLeftStyle).toBe("solid");
    expect(callout.borderLeftColor, "callout 色条色 = 本档归属 token").toBe(
      theme === "eink" ? reading.tokens.border : reading.tokens.accent,
    );

    if (theme === "eink") {
      expectFollows(await probeTokenFollows(page, CONTENT_SELECTORS.frontmatter, "--border", "borderTopColor"), "frontmatter 盒描边");
      expectFollows(await probeTokenFollows(page, CONTENT_SELECTORS.fmStatus, "--border", "borderTopColor"), "fm 状态 chip 描边");
      expectFollows(await probeTokenFollows(page, CONTENT_SELECTORS.tag, "--border", "borderTopColor"), "tags chip 描边");
      expectFollows(await probeTokenFollows(page, CONTENT_SELECTORS.callout, "--border", "borderLeftColor"), "callout 色条");
    }
  });
}
