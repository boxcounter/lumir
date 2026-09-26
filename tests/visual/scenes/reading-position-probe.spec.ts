// design §7 的未验证项实测（M194，task 1.4 / task 3）：往返精度、`documentTop` 的坐标系、
// 含图文档、栏宽变化、页面缩放、code 模式的横向偏移、越界锚、改名后的键。
//
// 这一份是**测量**而不是门禁：它把每个量的原始读数写进 JSON（`LUMIR_PROBE_OUT` 指向的目录），
// 并对「必须成立、否则本能力不成立」的那几条留断言。设计文档里的推导只有在实测读数对上之后
// 才能写成「已验」，因此这里的读数就是 design §7 的证据来源。
//
// 读数的取法（都走**产品自己的代码路径**，不在测试里重写一遍实现）：
//   - 捕获侧：滚动 → 等防抖 → 读桩上的 `__readingPositionPuts` 载荷（那是真实写入的内容）；
//   - 恢复侧：关标签再打开同一文件（走 openFile → reloadSession 复位 → 恢复），读视口读数。
// 页内只读几何：`scrollTop` / `scrollLeft` / 顶部可见行 / 锚的字符盒相对滚动容器的偏移。

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stubTauri, readingPositionGets, readingPositionPuts, type VaultFixture } from "./tauri-stub";

/** 读数落盘：**每条记录立刻写一次**（按测试名分文件）。这样任何一个测试红了都不会丢掉
 *  已经测到的数（证据纪律：跑过就要留得下），也不依赖 worker 的模块状态。 */
const OUT_DIR = process.env.LUMIR_PROBE_OUT ?? "/tmp/lumir-m194-probe";

function record(key: string, value: unknown): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const name = test.info().title.replace(/[^\p{L}\p{N}\-]+/gu, "_").slice(0, 80);
  const file = `${OUT_DIR}/${name}.json`;
  let acc: Record<string, unknown> = {};
  try {
    acc = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    acc = {};
  }
  acc[key] = value;
  writeFileSync(file, `${JSON.stringify(acc, null, 2)}\n`);
}

const VAULT_ID = "probe-vault";
const FILLER = (n: number) => `第 ${String(n).padStart(3, "0")} 行：往返精度探针内容。`;
const LONG_DOC =
  ["# 探针文档", "", ...Array.from({ length: 300 }, (_, i) => FILLER(i + 1)), ""].join("\n") + "\n";
const ANCHOR_LINE = FILLER(220);
const ANCHOR_POS = LONG_DOC.indexOf(ANCHOR_LINE);

/** 含一张大图的文档（design §7 第 3 条）：图片在锚**上方**（它到达后文档高度会变），
 *  字节经 `fs_read_attachment` 延迟到达（见下面那条测试自己挂的补丁）。 */
const TALL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="1600"><rect width="400" height="1600" fill="#ddd"/></svg>';
const IMAGE_DOC =
  [
    "# 含图文档",
    "",
    "![大图](probe-tall.svg)",
    "",
    ...Array.from({ length: 120 }, (_, i) => FILLER(i + 1)),
    "",
  ].join("\n") + "\n";
const IMAGE_ANCHOR_LINE = FILLER(100);
const IMAGE_ANCHOR_POS = IMAGE_DOC.indexOf(IMAGE_ANCHOR_LINE);

/** code 模式（非 md）的长文件：行很长，折行关闭时可横向平移（design §7 第 6 条）。 */
const CODE_LINE = (n: number) => `// 第 ${String(n).padStart(3, "0")} 行 ` + "x".repeat(400);
const CODE_DOC = [...Array.from({ length: 300 }, (_, i) => CODE_LINE(i + 1)), ""].join("\n");
const CODE_ANCHOR_LINE = CODE_LINE(220);
const CODE_ANCHOR_POS = CODE_DOC.indexOf(CODE_ANCHOR_LINE);

function fixture(over: Partial<VaultFixture> = {}): VaultFixture {
  return {
    entries: [
      { path: "long.md", kind: "file", size: LONG_DOC.length, mtime_ms: 0 },
      { path: "image.md", kind: "file", size: IMAGE_DOC.length, mtime_ms: 0 },
      { path: "probe-tall.svg", kind: "file", size: TALL_SVG.length, mtime_ms: 0 },
      { path: "long.txt", kind: "file", size: CODE_DOC.length, mtime_ms: 0 },
      { path: "moved.md", kind: "file", size: LONG_DOC.length, mtime_ms: 0 },
    ],
    files: {
      "long.md": LONG_DOC,
      "image.md": IMAGE_DOC,
      "probe-tall.svg": TALL_SVG,
      "long.txt": CODE_DOC,
      "moved.md": LONG_DOC,
    },
    vault_id: VAULT_ID,
    ...over,
  };
}

function stored(path: string, pos: number, y = 48, x = 0) {
  return { positions: { [VAULT_ID]: { [path]: { pos, y, x, at: 1_700_000_000_000 } } } };
}

// ---------------------------------------------------------------------------
// 页内读数
// ---------------------------------------------------------------------------

interface Geometry {
  scrollTop: number;
  scrollLeft: number;
  boxTop: number;
  boxLeft: number;
  documentTop: number;
  documentPaddingTop: number;
  scaleY: number;
  clientHeight: number;
  scrollHeight: number;
}

function geometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const view = (
      document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }
    ).cmTile.root.view;
    const scroller = view.scrollDOM as HTMLElement;
    const box = scroller.getBoundingClientRect();
    return {
      scrollTop: scroller.scrollTop,
      scrollLeft: scroller.scrollLeft,
      boxTop: box.top,
      boxLeft: box.left,
      documentTop: view.documentTop,
      documentPaddingTop: view.documentPadding.top,
      scaleY: view.scaleY,
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
    };
  });
}

/** 某个文档位置处的三个读数：行块顶（文档坐标）、字符盒（client）、以及两个口径的差。 */
function probePosition(page: Page, pos: number) {
  return page.evaluate((anchor) => {
    const view = (
      document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }
    ).cmTile.root.view;
    const scroller = view.scrollDOM as HTMLElement;
    const box = scroller.getBoundingClientRect();
    const block = view.lineBlockAtHeight(scroller.scrollTop);
    const rect = view.coordsAtPos(anchor);
    return {
      blockFrom: block.from,
      blockTop: block.top,
      coordsNull: rect === null,
      charTop: rect?.top ?? null,
      charLeft: rect?.left ?? null,
      // 本实现采用的口径：字符盒相对滚动容器顶 / 左
      yRelativeToBox: rect === null ? null : rect.top - box.top,
      xRelativeToBox: rect === null ? null : rect.left - box.left,
      // design §2.3 的字面口径：字符盒相对文档顶（实测它随 scrollTop 平移）
      yRelativeToDocTop: rect === null ? null : rect.top - view.documentTop,
      documentTop: view.documentTop,
      boxTop: box.top,
      scrollTop: scroller.scrollTop,
      scrollLeft: scroller.scrollLeft,
    };
  }, pos);
}

function topVisibleLine(page: Page): Promise<string> {
  return page.evaluate(() => {
    const view = (
      document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }
    ).cmTile.root.view;
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    const rect = scroller.getBoundingClientRect();
    const pos = view.posAtCoords({ x: rect.left + 60, y: rect.top + 2 });
    return pos === null ? "" : view.state.doc.lineAt(pos).text;
  });
}

async function open(page: Page, file: string, needle = "探针文档"): Promise<void> {
  await page.locator(`.ft-row[title="${file}"]`).click();
  await expect(page.locator(".cm-content")).toContainText(needle);
}

/** 关标签（⌘W）再打开同一文件：装载路径的复位 → 恢复都走一遍产品代码。
 *  关闭前先点文件树把焦点交给树（⌘W 的关闭语义由标签栏承担，见 tabs.ts）。 */
async function reopen(page: Page, file: string, needle = "探针文档"): Promise<void> {
  // 焦点用 focus() 给而不是点击：点正文会让 CM 把光标滚进视区，把我们刚摆好的位置改掉
  //（m187 的同款处置），那样测到的就不是「离开时的位置」了。
  await page.evaluate(() => (document.querySelector(".cm-content") as HTMLElement).focus());
  await page.keyboard.press("Meta+w");
  await expect(page.locator(".cm-content")).not.toContainText(needle);
  await open(page, file, needle);
}

async function scrollToLine(page: Page, needle: string): Promise<void> {
  await page.evaluate((text) => {
    const view = (
      document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }
    ).cmTile.root.view;
    const at = view.state.doc.toString().indexOf(text);
    if (at < 0) throw new Error(`文档里没有「${text}」`);
    view.scrollDOM.scrollLeft = 0;
    view.scrollDOM.scrollTop = view.lineBlockAt(at).top;
  }, needle);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

// ---------------------------------------------------------------------------
// §7 第 1、2、5 条：往返精度 / documentTop 坐标系 / 缩放
// ---------------------------------------------------------------------------

test("§7-1/2/5 往返精度与 documentTop 坐标系（缩放 = 1）", async ({ page }) => {
  await stubTauri(page, fixture());
  await page.goto("/");
  await open(page, "long.md");

  const atLoad = await geometry(page);
  record("scale", { scaleY: atLoad.scaleY, documentPaddingTop: atLoad.documentPaddingTop });
  // 坐标系实测：documentTop 是**随滚动平移**的文档原点（client 坐标）
  record("documentTopRelation", {
    atScrollTop0: { documentTop: atLoad.documentTop, boxTop: atLoad.boxTop },
    check: "documentTop ?= boxTop - scrollTop + paddingTop",
  });

  // ① 捕获侧：摆到锚那一行，读三个读数 + 顶部可见行，再等防抖把载荷写出来
  await scrollToLine(page, ANCHOR_LINE);
  await page.waitForTimeout(400);
  const captured = await probePosition(page, ANCHOR_POS);
  const capturedTop = await topVisibleLine(page);
  const capturedGeometry = await geometry(page);
  record("capture", { ...captured, topVisibleLine: capturedTop });
  await page.waitForTimeout(1600);
  const payload = (await readingPositionPuts(page)).at(-1)?.entries?.["long.md"];
  record("capturePayload", payload ?? null);

  // ② 远锚处的 coordsAtPos 行为（这是 applyScrollPosition 不做前置门槛的实测依据）
  await scrollToLine(page, FILLER(120));
  await page.waitForTimeout(300);
  const farAnchor = await probePosition(page, ANCHOR_POS);
  record("farAnchor", farAnchor);

  // ③ 恢复侧：回到锚那一行并等载荷落定，然后关标签 → 重新打开
  await scrollToLine(page, ANCHOR_LINE);
  await page.waitForTimeout(1600);
  const beforeReopen = await geometry(page);
  const beforeTop = await topVisibleLine(page);
  await reopen(page, "long.md");
  await expect.poll(async () => (await geometry(page)).scrollTop).toBeGreaterThan(0);
  await page.waitForTimeout(300);

  const restored = await geometry(page);
  const restoredTop = await topVisibleLine(page);
  const restoredPos = await probePosition(page, ANCHOR_POS);
  const latest = (await readingPositionPuts(page)).at(-1)?.entries?.["long.md"];
  record("roundTrip", {
    capturedScrollTop: beforeReopen.scrollTop,
    restoredScrollTop: restored.scrollTop,
    delta: restored.scrollTop - beforeReopen.scrollTop,
    capturedTopLine: beforeTop,
    restoredTopLine: restoredTop,
    payloadBeforeReopen: payload ?? null,
    payloadAfterReopen: latest ?? null,
    restoredAnchorY: restoredPos.yRelativeToBox,
  });
  // 往返精度：scrollTop 与顶部可见行都必须逐项回到捕获时的状态（容差 2px，量取整误差）
  expect(Math.abs(restored.scrollTop - beforeReopen.scrollTop)).toBeLessThanOrEqual(2);
  expect(restoredTop).toBe(beforeTop);
  // 恢复侧的不变量：锚的字符盒相对视口的偏移 = 载荷里的 y（用载荷自己那个锚来量——
  // 恢复后重新捕获时锚可能落到相邻行，拿另一个锚比对会凭空多出一行的差）
  if (latest !== undefined && latest !== null) {
    const atPayloadAnchor = await probePosition(page, latest.pos);
    expect(Math.abs((atPayloadAnchor.yRelativeToBox ?? 0) - latest.y)).toBeLessThanOrEqual(2);
  }
  expect(capturedGeometry.scrollTop).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// §5 第 3 条 / task 4.3：恢复之后不许再有人写 scrollTop
// ---------------------------------------------------------------------------

test("恢复之后无人再写 scrollTop：装载路径结束后逐帧采样，读数稳定在同一处", async ({ page }) => {
  await stubTauri(page, fixture());
  await page.goto("/");
  await open(page, "long.md");
  await scrollToLine(page, ANCHOR_LINE);
  await page.waitForTimeout(1600);
  const captured = await geometry(page);
  const capturedTop = await topVisibleLine(page);

  // 关标签 → 重新打开，并在装载后逐帧采样 scrollTop（每帧一次，2 秒）
  await reopen(page, "long.md");
  const samples = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const el = document.querySelector(".cm-scroller") as HTMLElement;
        const out: number[] = [];
        let frames = 0;
        const tick = () => {
          out.push(el.scrollTop);
          frames += 1;
          if (frames < 120) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
  );
  const finalTop = await topVisibleLine(page);
  const puts = await readingPositionPuts(page);
  record("afterRestoreStability", {
    capturedScrollTop: captured.scrollTop,
    capturedTopLine: capturedTop,
    sampleCount: samples.length,
    firstSample: samples[0],
    maxSample: Math.max(...samples),
    lastTenSamples: samples.slice(-10),
    finalTopLine: finalTop,
    putCount: puts.length,
    lastPut: puts.at(-1)?.entries?.["long.md"] ?? null,
  });
  // 「恢复之后无人再写」：末尾 10 帧读数完全相同（同一处），且确实停在捕获时的位置与行
  const tail = samples.slice(-10);
  expect(new Set(tail).size).toBe(1);
  expect(Math.abs(tail[0] - captured.scrollTop)).toBeLessThanOrEqual(2);
  expect(finalTop).toBe(capturedTop);
});

// ---------------------------------------------------------------------------
// §7 第 4 条：栏宽变化后再打开
// ---------------------------------------------------------------------------

test("§7-4 栏宽变化（视口宽度不同）后再打开：同一条行仍停在视口顶", async ({ page }) => {
  await stubTauri(page, fixture());
  await page.goto("/");
  await open(page, "long.md");
  await scrollToLine(page, ANCHOR_LINE);
  await page.waitForTimeout(1600);
  const before = await geometry(page);
  const beforeTop = await topVisibleLine(page);
  const beforeAnchor = await probePosition(page, ANCHOR_POS);
  const payload = (await readingPositionPuts(page)).at(-1)?.entries?.["long.md"];
  const clientWidth = await page.locator(".cm-scroller").evaluate((el) => el.clientWidth);
  record("columnWidth", {
    before: {
      scrollTop: before.scrollTop,
      topLine: beforeTop,
      anchorY: beforeAnchor.yRelativeToBox,
      clientHeight: before.clientHeight,
      clientWidth,
    },
    payload: payload ?? null,
  });

  // 换栏宽（阅读栏宽是百分比，随窗口变化）：窄一档再打开
  await page.setViewportSize({ width: 900, height: 800 });
  await reopen(page, "long.md");
  await expect.poll(async () => (await geometry(page)).scrollTop).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  const after = await probePosition(page, ANCHOR_POS);
  record("columnWidthAfter", {
    scrollTop: after.scrollTop,
    anchorY: after.yRelativeToBox,
    topLine: await topVisibleLine(page),
    clientWidth: await page.locator(".cm-scroller").evaluate((el) => el.clientWidth),
  });
  // 判据是「同一条行仍在视口顶、锚的视口偏移仍在」，不是像素相等（栏宽变了，行块坐标会变）
  expect(await topVisibleLine(page)).toBe(beforeTop);
  expect(Math.abs((after.yRelativeToBox ?? 0) - (beforeAnchor.yRelativeToBox ?? 0))).toBeLessThanOrEqual(2);
});

// ---------------------------------------------------------------------------
// §7 第 3 条：含异步加载图片的文档
// ---------------------------------------------------------------------------

test("§7-3 含异步加载图片的文档：图片字节在恢复之后到达，参照行是否仍在视口顶", async ({ page }) => {
  await stubTauri(page, fixture());
  // 附件读取延迟（m187 的同一手法）：恢复发生在图片字节到达**之前**
  await page.addInitScript(
    ([content, delay]: [string, number]) => {
      const w = window as unknown as Record<string, any>;
      const internals = w.__TAURI_INTERNALS__;
      const original = internals.invoke;
      internals.invoke = async (command: string, argv: { path?: string }) => {
        if (command !== "fs_read_attachment") return original(command, argv);
        await new Promise((resolve) => setTimeout(resolve, delay));
        const bytes = new TextEncoder().encode(content);
        let binary = "";
        for (const b of bytes) binary += String.fromCharCode(b);
        return btoa(binary);
      };
    },
    [TALL_SVG, 500] as [string, number],
  );
  await page.goto("/");
  await open(page, "image.md", "含图文档");
  await page.waitForTimeout(1000); // 图片到达，文档高度进入终态
  const settledHeight = await page.evaluate(
    () => (document.querySelector(".cm-scroller") as HTMLElement).scrollHeight,
  );
  await scrollToLine(page, IMAGE_ANCHOR_LINE);
  await page.waitForTimeout(1600);
  const before = await probePosition(page, IMAGE_ANCHOR_POS);
  const beforeTop = await topVisibleLine(page);

  await reopen(page, "image.md", "含图文档");
  // 装载后立刻读一次（此刻图片字节还没到：装载时的高度是估算的）
  await page.waitForTimeout(60);
  const early = { y: (await probePosition(page, IMAGE_ANCHOR_POS)).yRelativeToBox, top: await topVisibleLine(page) };
  await page.waitForTimeout(1200); // 图片到达
  const late = {
    y: (await probePosition(page, IMAGE_ANCHOR_POS)).yRelativeToBox,
    top: await topVisibleLine(page),
    scrollHeight: await page.evaluate(
      () => (document.querySelector(".cm-scroller") as HTMLElement).scrollHeight,
    ),
  };
  record("imageDoc", {
    scrollHeightSettled: settledHeight,
    scrollHeightAfterRestore: late.scrollHeight,
    anchorYBefore: before.yRelativeToBox,
    anchorYEarly: early.y,
    anchorYLate: late.y,
    topLineBefore: beforeTop,
    topLineEarly: early.top,
    topLineLate: late.top,
  });
  // 判据：图片到达（文档高度变化）之后，参照行仍停在捕获时的位置
  expect(late.top).toBe(beforeTop);
  expect(Math.abs((late.y ?? 0) - (before.yRelativeToBox ?? 0))).toBeLessThanOrEqual(4);
});

// ---------------------------------------------------------------------------
// §7 第 6 条：code 模式的横向偏移（折行关闭）
// ---------------------------------------------------------------------------

test("§7-6 code 模式 + 折行关闭：纵向与横向偏移一起还原", async ({ page }) => {
  await stubTauri(page, { ...fixture(), config: { line_wrap: false } });
  await page.goto("/");
  await open(page, "long.txt", "// 第 001 行");
  // 非 md 文本自 editable-non-md-files 起可编辑（M130 的只读口径已解除）；本用例钉的
  // 是 code 模式的横向/纵向恢复，前置形态改为「已进编辑器」。
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");

  // 横向可平移的前提：正文比容器宽（实测记录这两条，不假定）
  const widths = await page.evaluate(() => {
    const el = document.querySelector(".cm-scroller") as HTMLElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollLeft: el.scrollLeft };
  });
  record("codeHorizontalWidths", widths);
  expect(widths.scrollWidth).toBeGreaterThan(widths.clientWidth);

  // 纵向摆到锚那一行 + 横向平移一段，等防抖写入
  await scrollToLine(page, CODE_ANCHOR_LINE);
  await page.evaluate(() => {
    (document.querySelector(".cm-scroller") as HTMLElement).scrollLeft = 200;
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.waitForTimeout(1600);
  const before = await geometry(page);
  const beforeTop = await topVisibleLine(page);
  const payload = (await readingPositionPuts(page)).at(-1)?.entries?.["long.txt"];
  record("codeHorizontalBefore", {
    scrollTop: before.scrollTop,
    scrollLeft: before.scrollLeft,
    topLine: beforeTop,
    payload: payload ?? null,
  });

  await reopen(page, "long.txt", "// 第 001 行");
  await expect.poll(async () => (await geometry(page)).scrollTop).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  const after = await geometry(page);
  const afterPayload = (await readingPositionPuts(page)).at(-1)?.entries?.["long.txt"];
  const atAnchor = afterPayload === undefined || afterPayload === null ? null : await probePosition(page, afterPayload.pos);
  record("codeHorizontalAfter", {
    scrollTop: after.scrollTop,
    scrollLeft: after.scrollLeft,
    topLine: await topVisibleLine(page),
    payload: afterPayload ?? null,
    anchorOffsets: atAnchor,
  });
  expect(after.scrollLeft).toBeGreaterThan(0);
  expect(Math.abs(after.scrollLeft - before.scrollLeft)).toBeLessThanOrEqual(4);
  expect(await topVisibleLine(page)).toBe(beforeTop);
  if (afterPayload !== undefined && afterPayload !== null) {
    expect(Math.abs((after.scrollLeft ?? 0) - (before.scrollLeft ?? 0))).toBeLessThanOrEqual(4);
  }
});

// ---------------------------------------------------------------------------
// §7 第 7、8 条：越界锚（外部改写）/ 改名视为丢失
// ---------------------------------------------------------------------------

test("§7-7 锚越出文档（外部改写）：夹到文档内、不报错、不留提示", async ({ page }) => {
  await stubTauri(page, fixture(stored("long.md", LONG_DOC.length + 100_000)));
  await page.goto("/");
  await open(page, "long.md");
  await page.waitForTimeout(400);
  const geo = await geometry(page);
  record("outOfRange", {
    scrollTop: geo.scrollTop,
    maxScrollTop: geo.scrollHeight - geo.clientHeight,
    notice: await page.locator(".editor-notice").isVisible(),
  });
  expect(await page.locator(".editor-notice").isVisible()).toBe(false);
  // 夹到文档末尾：滚到接近底部（不是篇首，也不是未定义）
  expect(geo.scrollTop).toBeGreaterThan(geo.scrollHeight - geo.clientHeight - 400);
});

test("§7-8 改名 / 移动视为位置丢失：新路径没有历史，从篇首开始", async ({ page }) => {
  // 位置记在 old.md 上，文件以 moved.md 出现（改名在应用看来就是「旧路径消失、新路径出现」）
  await stubTauri(page, fixture({ ...stored("old.md", ANCHOR_POS) }));
  await page.goto("/");
  await open(page, "moved.md");
  const geo = await geometry(page);
  record("renamed", { scrollTop: geo.scrollTop, topLine: await topVisibleLine(page) });
  expect(geo.scrollTop).toBe(0);
  expect(await topVisibleLine(page)).toBe("# 探针文档");
});
