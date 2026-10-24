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
//      ——真机拖选确实建立选区，问题在「选中了看不见」，见 design §10.3）。端点取首 / 末 cell 的
//      文本几何（不是边框盒 + 偏移），并同手势断言产品不变量（mousedown 未被拦截 / selectstart
//      已触发 / 未点穿遮罩），另附同页通道探针留痕——口径与边界见 tests/visual/README.md
//      「指针选中（拖选）的口径」节。
//
// 真机层（WKWebView）的**选区仍不可经 AX 断言**；原生 ⌘C 在窗口为 key window 时可以落地
// （M650 真机探针：pbpaste 逐字读到选中文本），但它不是场景的常规判据通道
// （scripts/acceptance/README.md 的口径收窄）。本场景只覆盖引擎层判据，真机退出路径由验收
// 场景 227 承担。

import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { configApplied, fireMenuCommand, stubTauri } from "./tauri-stub";
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
  // M645 起「配置已施加」的就绪信号是 `configApplied`（旧 `configGets` 计数器已随该
  // change 删除——本场景的 import 是 master 上遗留的一处断链，随 M655 的 rebase 一并修正）。
  await configApplied(page);
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
  await configApplied(page);
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

/** 拖选手势的产品不变量读数（采集点见 `installDragProbe`）。 */
type DragProbeState = {
  mousedown: Array<{ prevented: boolean; insideSnapshot: boolean; target: string | null }>;
  selectstart: number;
};

/**
 * 不变量探针：在 window 冒泡段记录 mousedown 的 `defaultPrevented` 与 selectstart 次数。
 * 业务监听都挂在 window 之下的元素上，事件冒泡到 window 时已包含它们的处理结果。
 */
function installDragProbe(page: Page): Promise<void> {
  return page.evaluate(() => {
    const state: DragProbeState = { mousedown: [], selectstart: 0 };
    (window as unknown as { __dragProbe?: DragProbeState }).__dragProbe = state;
    window.addEventListener(
      "mousedown",
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        state.mousedown.push({
          prevented: event.defaultPrevented,
          insideSnapshot: target !== null && target.closest(".lumir-table-fs-snapshot") !== null,
          target: target?.nodeName ?? null,
        });
      },
      false,
    );
    window.addEventListener("selectstart", () => {
      state.selectstart += 1;
    }, false);
  });
}

function readDragProbe(page: Page): Promise<DragProbeState> {
  return page.evaluate(() => (window as unknown as { __dragProbe: DragProbeState }).__dragProbe);
}

/**
 * 拖选端点由**文本几何**给出：首 / 末 cell 内首个 / 末个非空文本节点的 `Range.getClientRects()`
 * 首 / 末个字形盒（宽 ≥ 4，滤掉折叠空白留下的零宽盒）的中心点。
 *
 * 不用 cell 边框盒 + 像素偏移：拖选能否延伸对命中点极其敏感（M720 调查 §2.3：同一行相邻 1–8px
 * 就从「逐字延伸」翻成「每次 mousemove 重新落锚点、永不延伸」），而 CI runner 与本地存在已入库的
 * 字形栅格差异（README「本地与 CI 的渲染口径」节：混排行被撑宽约 2.5%）。字形盒中心跟随文本
 * 本身，度量变化后仍落在同一个字形里。依据与现场：`.local/reports/visual-drag-ci-oct24/README.md`。
 */
function textDragPoints(page: Page) {
  return page.evaluate(() => {
    const row = document.querySelector(".lumir-table-fs-snapshot .cm-lp-table-row");
    if (row === null) throw new Error("快照行不在场");
    const cells = [...row.querySelectorAll(".cm-lp-table-cell")];
    if (cells.length < 2) throw new Error(`快照行 cell 不足（${cells.length}）`);

    const glyph = (cell: Element, which: "first" | "last") => {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if ((node.textContent ?? "").trim() !== "") nodes.push(node as Text);
      }
      if (nodes.length === 0) throw new Error("cell 内没有非空文本节点");
      const node = which === "first" ? nodes[0]! : nodes[nodes.length - 1]!;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((rect) => rect.width >= 4);
      if (rects.length === 0) throw new Error(`字形盒取不到：${JSON.stringify(node.textContent)}`);
      const rect = which === "first" ? rects[0]! : rects[rects.length - 1]!;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        x,
        y,
        hit: hit?.nodeName ?? null,
        hitInsideSnapshot: hit !== null && hit.closest(".lumir-table-fs-snapshot") !== null,
      };
    };

    return { start: glyph(cells[0]!, "first"), end: glyph(cells[cells.length - 1]!, "last") };
  });
}

/**
 * 同页通道探针的对照面：状态栏路径（非可编辑文本，`user-select: auto`，与遮罩开关无关）。
 * 返回同型拖选的两端与中线；对照面取不到就是测试自身坏了，调用方必须判红而不是当「通道不可用」。
 */
function channelProbeSpan(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector(".modeline-path");
    if (el === null) return { ok: false as const, why: ".modeline-path 不在场" };
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    if (node === null) return { ok: false as const, why: ".modeline-path 内没有文本节点" };
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = [...range.getClientRects()].find((item) => item.width >= 4);
    if (rect === undefined) return { ok: false as const, why: ".modeline-path 内取不到字形盒" };
    return { ok: true as const, x1: rect.left + 1, x2: rect.right - 1, y: rect.top + rect.height / 2 };
  });
}

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

  await installDragProbe(page);
  // 跨 cell 拖选：首行第一个 cell 的首个字形 → 最后一个 cell 的末个字形（文本几何，见 helper）。
  const points = await textDragPoints(page);
  // 端点必须真的落在快照上：命中在遮罩外时，后面判的就不是这段产品行为了。
  expect(points.start.hitInsideSnapshot, `起点命中 ${points.start.hit}，不在快照内`).toBe(true);
  expect(points.end.hitInsideSnapshot, `终点命中 ${points.end.hit}，不在快照内`).toBe(true);

  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 8 });
  await page.mouse.up();

  const reading = await selectionReading(page);
  const probe = await readDragProbe(page);

  // 产品自有不变量（与「引擎有没有把锚点延伸成范围」无关，逐条对应一条可辨的坏法）：
  //   ① 拖选没被应用拦截——路径上的 mousedown 全部 defaultPrevented=false；
  //   ② 没有点穿遮罩——拖选之后遮罩仍在场；
  //   ③ 引擎确实开始了选区手势——selectstart 至少一次（快照不可选时它为 0）。
  // M720 的 CI 失败签名下三条全部成立，而这三种坏法各有一条必红（§2.5 的反向输入）。
  const pressed = probe.mousedown.filter((entry) => entry.insideSnapshot);
  expect(pressed.length, "拖选起点必须命中快照内的 mousedown").toBeGreaterThanOrEqual(1);
  expect(pressed.filter((entry) => entry.prevented), "应用不得对拖选路径上的 mousedown 调 preventDefault").toEqual([]);
  expect(await overlayVisible(page), "拖选不得点穿遮罩（遮罩必须仍在场）").toBe(true);
  expect(probe.selectstart, "拖选必须触发 selectstart（否则快照不可选）").toBeGreaterThanOrEqual(1);

  // 落面判据（保留原判据）：锚点 / 焦点都在快照容器内，选区不含遮罩外标题。
  expect(reading.anchorInRoot, "锚点必须落在快照容器内").toBe(true);
  expect(reading.focusInRoot, "焦点端必须落在快照容器内").toBe(true);
  expect(reading.text, "选区不得含遮罩外标题").not.toContain("表格全屏场景");

  // 通道探针只能放在产品拖选之后：遮罩是整窗覆盖层，任何点在外面的手势都会让它失焦关闭。
  await page.keyboard.press("Escape");
  expect(await overlayVisible(page), "通道探针前遮罩必须已关闭").toBe(false);
  const channel = await channelProbeSpan(page);
  if (!channel.ok) throw new Error(`通道探针的对照面不可定位：${channel.why}`);

  const beforeProbe = await readDragProbe(page);
  await page.mouse.move(channel.x1, channel.y);
  await page.mouse.down();
  await page.mouse.move(channel.x2, channel.y, { steps: 6 });
  await page.mouse.up();
  const channelText = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  const afterProbe = await readDragProbe(page);
  const channelMousedown = afterProbe.mousedown.slice(beforeProbe.mousedown.length);
  const channelSelectstart = afterProbe.selectstart - beforeProbe.selectstart;

  test.info().annotations.push({
    type: "pointer-selection-channel",
    description: `${channelText.length > 0 ? "available" : "unavailable"}（对照面选区长度 ${channelText.length}）`,
  });

  if (channelText.length > 0) {
    // 通道可用：最强判据——产品拖选必须建立非空、跨 cell 的选区（本地 chromium 走这支）。
    expect(reading.text.length, "通道可用时拖选必须建立非空选区").toBeGreaterThan(0);
    expect(reading.text, "拖选必须跨过中间 cell").toContain("内容");
  } else {
    // 通道不可用：不 skip。先把「不可用」钉成可复核的读数——对照面上的同一手势收到 mousedown、
    // 未被 preventDefault、selectstart 已触发，只是引擎没有把它延伸成范围。三条不满足就说明
    // 对照面本身不可选，那是判据坏了（不是 runner 能力问题），照旧判红。
    expect(channelMousedown.length, "对照面必须收到 mousedown").toBeGreaterThanOrEqual(1);
    expect(channelMousedown.filter((entry) => entry.prevented), "对照面的 mousedown 不得被 preventDefault").toEqual([]);
    expect(channelSelectstart, "对照面必须触发 selectstart（否则它不可选，不能当通道判据）").toBeGreaterThanOrEqual(1);
    console.log(
      `[pointer-selection-channel] unavailable：.modeline-path 同型拖选得到空选区（产品拖选文本长度 ` +
        `${reading.text.length}）；三条产品不变量照判`,
    );
  }
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
