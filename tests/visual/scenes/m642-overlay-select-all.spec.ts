// M650（change fullscreen-table-text-selection）：全屏遮罩内的文本可选中、可复制。
//
// 判据分层（design §6.3）：
//   1. ⌘A 的**落面**：选区非空 + 锚点在遮罩内容容器内 + 含 cell 文本 + **不含**遮罩外标题
//      （负向与该场景同批断言：只判「非空」会在「选中整页」上假绿）。
//   2. 菜单「全选」与键盘同一落面（D3）：`app:menu_command` 的 selectAll 载荷经桩送达前端。
//   3. 选中之后三条退出路径逐条不变（spec 场景枚举）：Esc / 点击遮罩 / 再次 toggle——遮罩关闭、
//      DOM 选区清空、焦点回编辑器（行为判据，不读布尔口）、caret 不被重置；Esc 那条另验
//      ⌘C 不再拿到遮罩里的旧文本。
//   4. 「选中态可辨」：遮罩内 `::selection` 与遮罩底色的对比不低于编辑器既有选区带
//      （`--sel-band`）与正文底色的对比（三主题各一档，取既有 token，零新增色值）。
//   5. 拖选能在遮罩内建立选区（chromium 代理；真机结论以 M650 的 `.local/probes/` 探针为准
//      ——真机拖选确实建立选区，问题在「选中了看不见」，见 design §10.3）。
//
// 真机层（WKWebView）的**选区仍不可经 AX 断言**；原生 ⌘C 在窗口为 key window 时可以落地
// （M650 真机探针：pbpaste 逐字读到选中文本），但它不是场景的常规判据通道
// （scripts/acceptance/README.md 的口径收窄）。本场景只覆盖引擎层判据，真机退出路径由验收
// 场景 227 承担。

import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fireMenuCommand, stubTauri, configGets } from "./tauri-stub";
import { readDocument } from "./parity-checks";

const TABLE_SOURCE = readFileSync(new URL("../fixtures/table-fullscreen/scene.md", import.meta.url), "utf8");
const SVG = readFileSync(new URL("../fixtures/markdown-combo/sample.svg", import.meta.url), "utf8");
const CODE_SOURCE = readFileSync(new URL("../fixtures/code-block-fullscreen/scene.md", import.meta.url), "utf8");
const DOC = "scene.md";

const TRIGGER_KEY = "Cmd-j";
const TRIGGER_PRESS = "Meta+j";

type CmView = {
  state: {
    doc: { toString(): string; length: number };
    selection: { main: { head: number; anchor: number } };
  };
  dispatch(spec: { selection?: { anchor: number; head?: number } }): void;
  focus(): void;
  contentDOM: HTMLElement;
};

async function caretAt(page: Page, needle: string, offset = 0): Promise<number> {
  const pos = await page.evaluate(
    ({ needle, offset }) => {
      const el = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: CmView } } };
      const text = el.cmTile.root.view.state.doc.toString();
      const at = text.indexOf(needle);
      if (at < 0) throw new Error(`fixture 里找不到 ${needle}`);
      return at + offset;
    },
    { needle, offset },
  );
  await page.evaluate((p) => {
    const el = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: CmView } } };
    const view = el.cmTile.root.view;
    view.dispatch({ selection: { anchor: p } });
    view.focus();
  }, pos);
  return pos;
}

function caretHead(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: CmView } } };
    return el.cmTile.root.view.state.selection.main.head;
  });
}

function caretRange(page: Page): Promise<{ anchor: number; head: number }> {
  return page.evaluate(() => {
    const el = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: CmView } } };
    const main = el.cmTile.root.view.state.selection.main;
    return { anchor: main.anchor, head: main.head };
  });
}

async function openTableDoc(page: Page, theme: "light" | "dark" | "eink" = "light"): Promise<void> {
  await stubTauri(page, {
    entries: [
      { path: DOC, kind: "file", size: TABLE_SOURCE.length, mtime_ms: 0 },
      { path: "assets/sample.svg", kind: "file", size: SVG.length, mtime_ms: 0 },
    ],
    files: { [DOC]: TABLE_SOURCE, "assets/sample.svg": SVG },
    config: { keys: { [TRIGGER_KEY]: "table.toggle-fullscreen" }, theme },
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${DOC}"]`).click();
  await expect(page.locator(".cm-lp-table")).toHaveCount(2);
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await expect(page.locator(".modeline-path")).toHaveText(DOC);
  await page.waitForTimeout(80);
}

async function openCodeDoc(page: Page): Promise<void> {
  await stubTauri(page, {
    entries: [
      { path: DOC, kind: "file", size: CODE_SOURCE.length, mtime_ms: 0 },
      { path: "notes.txt", kind: "file", size: 12, mtime_ms: 0 },
    ],
    files: { [DOC]: CODE_SOURCE, "notes.txt": "plain text\n" },
    config: { keys: { [TRIGGER_KEY]: "code-block.toggle-fullscreen" } },
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${DOC}"]`).click();
  await expect(page.locator(".cm-lp-codeblock-slot")).toHaveCount(3);
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await expect(page.locator(".modeline-path")).toHaveText(DOC);
  await page.waitForTimeout(80);
}

/** 当前 DOM 选区的读数：文本、锚点 / 焦点归属、焦点面。 */
function selectionReading(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".lumir-table-fs-snapshot, .lumir-codeblock-fs-content");
    const sel = window.getSelection();
    const range = sel !== null && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const contains = (node: Node | null): boolean =>
      node !== null && root !== null && (node === root || root.contains(node));
    const active = document.activeElement as HTMLElement | null;
    return {
      rangeCount: sel?.rangeCount ?? 0,
      collapsed: sel?.isCollapsed ?? true,
      text: sel?.toString() ?? "",
      anchorInRoot: contains(range?.startContainer ?? null),
      focusInRoot: contains(range?.endContainer ?? null),
      activeClass: active?.className ?? "",
      focusInsideOverlay: active !== null && active.closest(".lumir-table-fs-overlay, .lumir-codeblock-fs-overlay") !== null,
    };
  });
}

const overlayVisible = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".lumir-table-fs-overlay, .lumir-codeblock-fs-overlay");
    return el !== undefined && el !== null && !el.hidden;
  });

/** 遮罩内选中带与遮罩底色的对比，对照编辑器选区带与正文底色的对比（同一套合成 / 亮度口径）。 */
function contrastReading(page: Page) {
  return page.evaluate(() => {
    type Rgba = { r: number; g: number; b: number; a: number };
    const parse = (color: string): Rgba => {
      const m = /rgba?\(([^)]+)\)/.exec(color);
      if (m === null) throw new Error(`无法解析颜色：${color}`);
      const parts = m[1].split(",").map((v) => Number(v.trim()));
      return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
    };
    const srgb = (v: number): number => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const luminance = (c: Rgba): number => 0.2126 * srgb(c.r) + 0.7152 * srgb(c.g) + 0.0722 * srgb(c.b);
    const contrast = (a: Rgba, b: Rgba): number => {
      const la = luminance(a);
      const lb = luminance(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    const over = (fg: Rgba, bg: Rgba): Rgba => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });
    /** 逐层向上合成到第一个不透明层（body 的 --content-bg 兜底）。 */
    const surface = (el: Element): Rgba => {
      const layers: Rgba[] = [];
      for (let node: Element | null = el; node !== null; node = node.parentElement) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c.a > 0) layers.push(c);
      }
      let out: Rgba = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = layers.length - 1; i >= 0; i -= 1) out = over(layers[i]!, out);
      return out;
    };
    const token = (name: string): Rgba => {
      const probe = document.createElement("div");
      probe.style.background = `var(${name})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return parse(color);
    };

    const root = document.querySelector<HTMLElement>(".lumir-table-fs-snapshot");
    if (root === null) throw new Error("遮罩快照不在场");
    const cell = root.querySelector<HTMLElement>(".cm-lp-table-cell") ?? root;
    const overlayBg = surface(cell);
    const overlayBand = over(parse(getComputedStyle(cell, "::selection").backgroundColor), overlayBg);
    const bodyBg = token("--content-bg");
    const editorBand = over(token("--sel-band"), bodyBg);
    return {
      overlayContrast: contrast(overlayBand, overlayBg),
      editorContrast: contrast(editorBand, bodyBg),
      overlaySelectionBg: getComputedStyle(cell, "::selection").backgroundColor,
    };
  });
}

// 剪贴板权限只有 chromium 桩通道可授予（Playwright WebKit 没有 clipboard-read 权限；真机
// WKWebView 的原生 ⌘C 注入不落地）。webkit-realua project 跑本文件时，剪贴板断言降级为
// 「只钉选区内容」，理由与 design §6.4 同。
test.beforeEach(async ({ context, browserName }) => {
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  }
});

test("M650 ⌘A 在表格全屏内全选：锚点在快照内、含 cell 文本、不含遮罩外标题", async ({ page, browserName }) => {
  await openTableDoc(page);
  const original = await readDocument(page);
  await caretAt(page, "| 甲 |");
  await page.keyboard.press(TRIGGER_PRESS);
  expect(await overlayVisible(page)).toBe(true);

  await page.keyboard.press("Meta+a");
  await expect.poll(async () => (await selectionReading(page)).rangeCount).toBe(1);
  const reading = await selectionReading(page);

  // ① 选区非空；② 锚点与焦点都在快照容器内；③ 含首行 cell 的文本。
  expect(reading.collapsed, "选区不得坍缩").toBe(false);
  expect(reading.anchorInRoot, "锚点必须落在快照容器内").toBe(true);
  expect(reading.focusInRoot, "焦点端必须落在快照容器内").toBe(true);
  expect(reading.text).toContain("甲");
  expect(reading.text).toContain("code");
  // ④ 负向（与 ②③ 配对）：遮罩外的文档标题不得进入选区——「选中整页」在这条上必红。
  expect(reading.text, "选区不得含遮罩外标题").not.toContain("表格全屏场景");
  expect(reading.text, "选区不得含蒙层后的正文（章节标题）").not.toContain("正常表");
  // 焦点仍在遮罩上（MUST NOT 移动焦点）。
  expect(reading.focusInsideOverlay).toBe(true);
  expect(reading.activeClass).toContain("lumir-table-fs-overlay");

  // ⑤ 剪贴板与选中文本一致（原生复制口径，不新造序列化）。WebKit project 读不到剪贴板
  //（design §6.4 的降级口径），只钉选区内容。
  if (browserName === "chromium") {
    await page.evaluate(() => navigator.clipboard.writeText("sentinel-before"));
    await page.keyboard.press("Meta+c");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(reading.text);
  }

  // 只读：文档逐字节不变。
  expect(await readDocument(page)).toBe(original);
  // 关闭后无残留（Esc 交还焦点使 DOM 选区坍缩）。
  await page.keyboard.press("Escape");
  expect(await overlayVisible(page)).toBe(false);
  const after = await selectionReading(page);
  expect(after.text).toBe("");
  expect(await readDocument(page)).toBe(original);
});

test("M650 ⌘A 在代码块全屏内全选：锚点在内容容器内、不含遮罩外正文", async ({ page, browserName }) => {
  await openCodeDoc(page);
  const original = await readDocument(page);
  await caretAt(page, "const short");
  await page.keyboard.press(TRIGGER_PRESS);
  expect(await overlayVisible(page)).toBe(true);

  await page.keyboard.press("Meta+a");
  await expect.poll(async () => (await selectionReading(page)).rangeCount).toBe(1);
  const reading = await selectionReading(page);
  expect(reading.collapsed).toBe(false);
  expect(reading.anchorInRoot).toBe(true);
  expect(reading.focusInRoot).toBe(true);
  expect(reading.text).toContain("const short");
  expect(reading.text).not.toContain("代码块全屏场景");
  expect(reading.text).not.toContain("文档开头段落");
  expect(reading.focusInsideOverlay).toBe(true);

  if (browserName === "chromium") {
    await page.evaluate(() => navigator.clipboard.writeText("sentinel-before"));
    await page.keyboard.press("Meta+c");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(reading.text);
  }
  expect(await readDocument(page)).toBe(original);
});

test("M650 菜单「全选」与键盘同一落面（遮罩在场时选遮罩内容）", async ({ page }) => {
  await openTableDoc(page);
  const original = await readDocument(page);
  await caretAt(page, "| 甲 |");
  await page.keyboard.press(TRIGGER_PRESS);
  expect(await overlayVisible(page)).toBe(true);

  // 原生 Edit 菜单的「全选」项点击后经 app:menu_command 回到前端（payload = selectAll）。
  await fireMenuCommand(page, "selectAll");
  await expect.poll(async () => (await selectionReading(page)).rangeCount).toBe(1);
  const reading = await selectionReading(page);
  expect(reading.anchorInRoot, "菜单全选必须落在遮罩快照内").toBe(true);
  expect(reading.focusInRoot).toBe(true);
  expect(reading.text).toContain("甲");
  expect(reading.text).not.toContain("表格全屏场景");
  expect(await readDocument(page)).toBe(original);
});

test("M650 选中后 Esc：关闭、选区清空、焦点回编辑器、⌘C 不取遮罩旧文本", async ({ page, browserName }) => {
  await openTableDoc(page);
  const original = await readDocument(page);
  const caret = await caretAt(page, "| 甲 |");
  await page.keyboard.press(TRIGGER_PRESS);
  expect(await overlayVisible(page)).toBe(true);
  // 打开遮罩不得移动编辑器的 state 选区（spec：⌘A MUST NOT 改变编辑器的选区状态）。
  expect(await caretRange(page), "打开遮罩不得移动 caret").toEqual({ anchor: caret, head: caret });
  await page.keyboard.press("Meta+a");
  await expect.poll(async () => (await selectionReading(page)).text.length).toBeGreaterThan(0);
  const selected = (await selectionReading(page)).text;
  expect(await caretRange(page), "遮罩内全选不得改变编辑器 state 选区").toEqual({ anchor: caret, head: caret });

  await page.keyboard.press("Escape");
  expect(await overlayVisible(page)).toBe(false);
  expect((await selectionReading(page)).text).toBe("");
  // 关闭后浏览器可能异步把 DOM 选区搬到内容区起点（M650 实测 300ms 内落定；main.ts 的
  // focusSourcePane 在短窗口内按缺陷签名把捕获的选区兜回来）。等它落定再判 caret。
  await page.waitForTimeout(400);
  expect(await caretRange(page), "Esc 交还焦点后 caret 不得被重置").toEqual({ anchor: caret, head: caret });

  // 行为判据：焦点真的在编辑器里——⌃D 真删一个字符、⌘Z 复位（不读布尔口）。
  await page.keyboard.press("Control+d");
  await expect.poll(() => readDocument(page)).not.toBe(original);
  expect((await readDocument(page)).length).toBe(original.length - 1);
  await page.keyboard.press("Meta+z");
  await expect.poll(() => readDocument(page)).toBe(original);
  expect(await caretRange(page), "撤销后 caret 回到原位").toEqual({ anchor: caret, head: caret });

  // 关闭后按 ⌘C：DOM 选区已随遮罩退场坍缩；CM 在空选区上是**行复制**（拷当前行源码），
  // 关键判据是「复制到的不是遮罩里的选中文本」。WebKit project 读不到剪贴板，跳过该段。
  if (browserName === "chromium") {
    await page.evaluate(() => navigator.clipboard.writeText("sentinel-after-close"));
    await page.keyboard.press("Meta+c");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied, "复制动作必须落地（否则下一条负向断言恒真）").not.toBe("sentinel-after-close");
    expect(copied, "关闭后 ⌘C 不得取到遮罩里的旧文本").not.toBe(selected);
    expect(copied).toContain("| 甲 |");
  }
});

test("M650 选区在场时点击遮罩关闭：选区清空、caret 不动、文档不变", async ({ page }) => {
  await openTableDoc(page);
  const original = await readDocument(page);
  const caret = await caretAt(page, "| 甲 |");
  await page.keyboard.press(TRIGGER_PRESS);
  expect(await overlayVisible(page)).toBe(true);
  await page.keyboard.press("Meta+a");
  await expect.poll(async () => (await selectionReading(page)).text.length).toBeGreaterThan(0);

  // 点击面板以外的遮罩区（m240 5.2 的既有落点）：关闭路径与 Esc 共用同一个 close()。
  await page.mouse.click(4, 4);
  expect(await overlayVisible(page)).toBe(false);
  const after = await selectionReading(page);
  expect(after.text, "关闭后 DOM 选区不得残留").toBe("");
  expect(after.focusInsideOverlay, "焦点不得留在遮罩里").toBe(false);
  await page.waitForTimeout(400);
  expect(await caretRange(page), "点击遮罩关闭后 caret 不得被重置").toEqual({ anchor: caret, head: caret });
  expect(await readDocument(page)).toBe(original);
});

test("M650 选区在场时再次 toggle 关闭：选区清空、caret 不动、文档不变", async ({ page }) => {
  await openTableDoc(page);
  const original = await readDocument(page);
  const caret = await caretAt(page, "| 甲 |");
  await page.keyboard.press(TRIGGER_PRESS);
  expect(await overlayVisible(page)).toBe(true);
  await page.keyboard.press("Meta+a");
  await expect.poll(async () => (await selectionReading(page)).text.length).toBeGreaterThan(0);

  // 再执行一次同一命令（toggle 是命令入口的自然对偶）。
  await page.keyboard.press(TRIGGER_PRESS);
  expect(await overlayVisible(page)).toBe(false);
  const after = await selectionReading(page);
  expect(after.text, "关闭后 DOM 选区不得残留").toBe("");
  expect(after.focusInsideOverlay, "焦点不得留在遮罩里").toBe(false);
  await page.waitForTimeout(400);
  expect(await caretRange(page), "toggle 关闭后 caret 不得被重置").toEqual({ anchor: caret, head: caret });
  expect(await readDocument(page)).toBe(original);
});

for (const theme of ["light", "dark", "eink"] as const) {
  test(`M650 选中态可辨（${theme}）：遮罩内选区带对比不低于编辑器选区带`, async ({ page, browserName }) => {
    await openTableDoc(page, theme);
    await caretAt(page, "| 甲 |");
    await page.keyboard.press(TRIGGER_PRESS);
    expect(await overlayVisible(page)).toBe(true);
    await page.keyboard.press("Meta+a");

    const reading = await contrastReading(page);
    if (browserName !== "chromium" && reading.overlaySelectionBg === "") {
      test.skip(true, "WebKit 不把 ::selection 计算样式暴露给 getComputedStyle；该判据只在 chromium 层");
    }
    // 取的是既有 token（--sel-band），与编辑器同强度。深色档遮罩底 --preview-bg 比正文底
    // --content-bg 略亮，同 token 合成后的对比度差 0.2%（2.051 vs 2.056）——这是承载面亮度差，
    // 不是取档降级；容差 0.01 只吸收这一项，不代表允许降低选区带强度。
    expect(reading.overlaySelectionBg, `${theme}: 选区带必须真的上色（不得是 transparent）`).not.toBe("rgba(0, 0, 0, 0)");
    expect(reading.overlayContrast, `${theme}: 遮罩选区带必须与编辑器同强度`).toBeGreaterThanOrEqual(
      reading.editorContrast - 0.01,
    );
    // 与 weak 档（--accent-tint）拉开：不得回落到 1.13 / 1.28 那一档。
    expect(reading.overlayContrast, `${theme}: 不得回落到 --accent-tint 档`).toBeGreaterThan(1.4);
  });
}

test("M650 拖选在遮罩内建立选区（跨 cell）：锚点在快照内", async ({ page }) => {
  await openTableDoc(page);
  await caretAt(page, "| 甲 |");
  await page.keyboard.press(TRIGGER_PRESS);
  expect(await overlayVisible(page)).toBe(true);

  // 从首行第一个 cell 拖到第三个 cell（跨 cell 拖选）。坐标取自快照行的渲染盒。
  const box = await page.evaluate(() => {
    const row = document.querySelector(".lumir-table-fs-snapshot .cm-lp-table-row");
    if (row === null) throw new Error("快照行不在场");
    const cells = [...row.querySelectorAll(".cm-lp-table-cell")];
    const first = cells[0]?.getBoundingClientRect();
    const last = cells[cells.length - 1]?.getBoundingClientRect();
    if (first === undefined || last === undefined) throw new Error("快照 cell 不在场");
    return { x1: first.left + 2, y1: first.top + first.height / 2, x2: last.right - 2, y2: last.top + last.height / 2 };
  });
  await page.mouse.move(box.x1, box.y1);
  await page.mouse.down();
  await page.mouse.move(box.x2, box.y2, { steps: 8 });
  await page.mouse.up();

  const reading = await selectionReading(page);
  expect(reading.text.length).toBeGreaterThan(0);
  expect(reading.anchorInRoot).toBe(true);
  expect(reading.focusInRoot).toBe(true);
  expect(reading.text).not.toContain("表格全屏场景");
});

test("M650 可选是契约：遮罩内容容器显式 user-select: text，遮罩链上无 none", async ({ page }) => {
  await openTableDoc(page);
  await caretAt(page, "| 甲 |");
  await page.keyboard.press(TRIGGER_PRESS);
  expect(await overlayVisible(page)).toBe(true);

  const reading = await page.evaluate(() => {
    const pick = (el: Element | null) => {
      if (el === null) throw new Error("元素不在场");
      const cs = getComputedStyle(el);
      return { userSelect: cs.userSelect, webkitUserSelect: (cs as unknown as { webkitUserSelect?: string }).webkitUserSelect };
    };
    const snapshot = document.querySelector(".lumir-table-fs-snapshot");
    const overlay = document.querySelector(".lumir-table-fs-overlay");
    const panel = document.querySelector(".lumir-table-fs-panel");
    const cell = snapshot?.querySelector(".cm-lp-table-cell") ?? null;
    return { snapshot: pick(snapshot), overlay: pick(overlay), panel: pick(panel), cell: pick(cell) };
  });
  // 内容容器 SHALL 显式声明 text（不是从祖先继承来的 auto）；遮罩链上任何一层 MUST NOT 为 none
  //（chromium 给 userSelect，WebKit 给 -webkit-user-select——两档都读，判据取有效值）。
  const effective = (value: { userSelect: string; webkitUserSelect?: string }) =>
    value.userSelect !== "" && value.userSelect !== undefined ? value.userSelect : (value.webkitUserSelect ?? "");
  expect(effective(reading.snapshot), "快照容器显式 user-select: text").toBe("text");
  for (const [name, value] of Object.entries(reading)) {
    expect(effective(value), `${name} 不得为 none`).not.toBe("none");
  }
});
