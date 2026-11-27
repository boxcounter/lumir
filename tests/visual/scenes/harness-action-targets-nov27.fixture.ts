import { expect, type ElementHandle, type Locator, type Page } from "@playwright/test";
import { standardProviders } from "./provider-config";
import { decodePng } from "./selection-pixel";
import { SYNTHETIC_PNG_BASE64, stubTauri, type VaultFixture } from "./tauri-stub";

export const ACTION_ROOT = "/tmp/lumir-action-targets";
export const COPY_SOURCE = "复制 **源文本**";
export const QUOTED = "第一段用于命中区：先读结论再读论证。";
export const IMAGE_NAME = "pasted-action-target.webp";

const DOC = `# 次级动作命中区\n\n${QUOTED}\n第二段用于区分跳回前后的选区。\n`;
const PROVIDERS = standardProviders();
const VAULT: VaultFixture = {
  entries: [{ path: "action-targets.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "action-targets.md": DOC },
  links: {},
  root: ACTION_ROOT,
  vault_id: "action-targets",
};

export interface ActionFixtureOptions {
  theme?: "light" | "dark" | "eink";
  language?: "zh" | "en";
  fontSize?: number;
}

export async function openActionPanel(page: Page, opts: ActionFixtureOptions = {}): Promise<void> {
  await stubTauri(page, {
    ...VAULT,
    config: { theme: opts.theme ?? "light", language: opts.language ?? "zh", font_size: opts.fontSize ?? 15 },
  });
  await page.addInitScript(
    ({ providers, png, copySource, imageName }) => {
      const w = window as unknown as Record<string, any>;
      const internals = w.__TAURI_INTERNALS__;
      const origInvoke = internals.invoke;
      w.__copied = [] as string[];
      w.__withdrawCalls = [] as Array<{ confirm: boolean }>;
      w.__harnessEventHandlerIds = [] as number[];
      w.__busy = false;
      const snapshot = {
        messages: [
          { role: "user", text: "PREFIX-Q1" },
          { role: "assistant", text: "前缀答复。" },
          { role: "user", text: copySource },
          { role: "assistant", text: "这一轮的回答。" },
        ],
        usage: { ctx_pct: 0, cache_pct_session: 0 },
        pending_approval: null,
        warn_ctx_pct: 85,
        withdrawable: true,
        session_token: 11,
        in_flight: false,
      };
      internals.invoke = async (cmd: string, args: any) => {
        if (cmd === "harness_state") return JSON.stringify({ ...snapshot, in_flight: w.__busy });
        if (cmd === "harness_withdraw") {
          w.__withdrawCalls.push({ confirm: args.confirm === true });
          throw { code: "harness_withdraw_tail_notice", message: "命中区测试保留会话", params: {} };
        }
        if (cmd === "harness_write_image") return { name: imageName, width: 640, height: 360 };
        if (cmd === "harness_read_image") return png;
        if (cmd === "harness_new_session") return null;
        if (cmd === "harness_list_sessions" || cmd === "harness_skills_list") return [];
        if (cmd === "harness_draft_get" || cmd === "harness_draft_put") return null;
        if (cmd === "plugin:event|listen" && args.event === "harness:event") {
          w.__harnessEventHandlerIds.push(args.handler ?? 0);
        }
        const result = await origInvoke(cmd, args);
        if (cmd === "config_get" && result?.config) {
          result.config.harness = {
            provider: "mock",
            providers,
            permissions: { allow: [], deny: [] },
            loop_max: 8,
            warn_ctx_pct: 85,
            auto_compact: true,
          };
        }
        return result;
      };
      Object.assign(navigator.clipboard, {
        writeText: (text: string) => {
          w.__copied.push(text);
          return Promise.resolve();
        },
      });
      w.__fireHarnessEvent = (payload: unknown) => {
        if ((payload as { type?: string }).type === "auto_turn_started") w.__busy = true;
        if ((payload as { type?: string }).type === "done") w.__busy = false;
        for (const id of w.__harnessEventHandlerIds) {
          internals.runCallback(id, { event: "harness:event", id, payload });
        }
      };
    },
    { providers: PROVIDERS, png: SYNTHETIC_PNG_BASE64, copySource: COPY_SOURCE, imageName: IMAGE_NAME },
  );
  await page.goto("/");
  await page.locator('.ft-row[title="action-targets.md"]').click();
  await expect(page.locator(".cm-content").first()).toContainText("第一段用于命中区");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".lumir-hp-withdraw")).toHaveCount(1);
}

export async function addQuoteCard(page: Page): Promise<void> {
  await page.evaluate((quoted) => {
    const view = (document.querySelector(".cm-content") as unknown as {
      cmTile: { root: { view: any } };
    }).cmTile.root.view;
    const start = view.state.doc.toString().indexOf(quoted) as number;
    view.focus();
    view.dispatch({ selection: { anchor: start, head: start + quoted.length } });
  }, QUOTED);
  await page.locator(".quote-gesture-btn").click();
  await expect(quoteCard(page)).toHaveCount(1);
}

export async function addImageCard(page: Page): Promise<void> {
  await page.locator(".lumir-hp-composer").evaluate((el) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], "action-target.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
  });
  await expect(imageCard(page)).toHaveCount(1);
}

export async function addCompositeCards(page: Page): Promise<void> {
  await addQuoteCard(page);
  await addImageCard(page);
}

export function quoteCard(page: Page): Locator {
  return page.locator(".lumir-hp-composer .lumir-hp-cwidget > .lumir-hp-qcard:not(.lumir-hp-imgcard)");
}

export function imageCard(page: Page): Locator {
  return page.locator(".lumir-hp-composer .lumir-hp-cwidget > .lumir-hp-imgcard");
}

export function lastUserMessage(page: Page): Locator {
  return page.locator(".lumir-hp-msg-user").last();
}

export async function fireHarnessEvent(page: Page, payload: Record<string, unknown>): Promise<void> {
  await page.evaluate((event) => {
    (window as unknown as { __fireHarnessEvent: (payload: unknown) => void }).__fireHarnessEvent(event);
  }, { vault: ACTION_ROOT, session_token: 11, ...payload });
}

export interface RectReading {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface HitReading {
  rect: RectReading;
  misses: Array<{ name: string; x: number; y: number; actual: string }>;
}

export async function readRect(locator: Locator): Promise<RectReading> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  });
}

export async function readHits(locator: Locator): Promise<HitReading> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const points = [
      { name: "center", x: r.left + r.width / 2, y: r.top + r.height / 2 },
      { name: "top", x: r.left + r.width / 2, y: r.top + 1 },
      { name: "right", x: r.right - 1, y: r.top + r.height / 2 },
      { name: "bottom", x: r.left + r.width / 2, y: r.bottom - 1 },
      { name: "left", x: r.left + 1, y: r.top + r.height / 2 },
      { name: "top-left", x: r.left + 2, y: r.top + 2 },
      { name: "bottom-right", x: r.right - 2, y: r.bottom - 2 },
    ];
    const misses: Array<{ name: string; x: number; y: number; actual: string }> = [];
    for (const point of points) {
      const hit = document.elementFromPoint(point.x, point.y);
      if (hit !== el && (hit === null || !el.contains(hit))) {
        misses.push({ ...point, actual: hit === null ? "null" : hit.outerHTML.slice(0, 180) });
      }
    }
    return {
      rect: { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom },
      misses,
    };
  });
}

export function horizontalGap(a: RectReading, b: RectReading): number {
  return Math.max(a.x, b.x) - Math.min(a.right, b.right);
}

export function rectsOverlap(a: RectReading, b: RectReading): boolean {
  return Math.max(a.x, b.x) < Math.min(a.right, b.right) && Math.max(a.y, b.y) < Math.min(a.bottom, b.bottom);
}

export async function readMessageTextRects(locator: Locator): Promise<RectReading[]> {
  return locator.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const rects: RectReading[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent === null || parent.closest(".lumir-hp-copy, .lumir-hp-withdraw") !== null) continue;
      if ((node.textContent ?? "").trim() === "") continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width > 0 && r.height > 0) {
          rects.push({ x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom });
        }
      }
    }
    return rects;
  });
}

export async function readComposerState(page: Page): Promise<unknown> {
  return page.locator(".lumir-hp-composer .cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    return {
      doc: view.state.doc.toString(),
      selection: view.state.selection.ranges.map((range: { from: number; to: number }) => [range.from, range.to]),
      cards: el.querySelectorAll(".lumir-hp-qcard").length,
    };
  });
}

export async function readCopied(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
}

export async function readWithdrawCalls(page: Page): Promise<Array<{ confirm: boolean }>> {
  return page.evaluate(() => (window as unknown as { __withdrawCalls: Array<{ confirm: boolean }> }).__withdrawCalls);
}

interface InkMask {
  pixels: number[];
  count: number;
  bounds: { x: number; y: number; right: number; bottom: number } | null;
}

export interface ActionInkReading {
  plate: RectReading;
  svg: RectReading | null;
  content: RectReading | null;
  missingInk: number;
  centerOffset: { x: number; y: number } | null;
}

function readRedInk(buffer: Buffer, clip: RectReading): InkMask {
  const image = decodePng(buffer);
  const scale = image.width / clip.width;
  const pixels: number[] = [];
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      if (image.data[offset] - image.data[offset + 1] <= 24 || image.data[offset] - image.data[offset + 2] <= 24 || image.data[offset] <= 100) continue;
      pixels.push(y * image.width + x);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    pixels,
    count: pixels.length,
    bounds: pixels.length === 0 ? null : {
      x: clip.x + minX / scale,
      y: clip.y + minY / scale,
      right: clip.x + (maxX + 1) / scale,
      bottom: clip.y + (maxY + 1) / scale,
    },
  };
}

export async function readActionInk(button: Locator): Promise<ActionInkReading> {
  const page = button.page();
  const geometry = await button.evaluate((el) => {
    const rect = (node: Element | null): RectReading | null => {
      if (node === null) return null;
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const r = el.getBoundingClientRect();
    const before = getComputedStyle(el, "::before");
    const left = parseFloat(before.left);
    const right = parseFloat(before.right);
    const bottom = parseFloat(before.bottom);
    const width = parseFloat(before.width);
    const height = parseFloat(before.height);
    const plateWidth = Number.isFinite(width) ? width : r.width - left - right;
    const plateX = before.left === "auto" ? r.right - right - plateWidth : r.left + left;
    const plateY = r.bottom - bottom - height;
    const plate = { x: plateX, y: plateY, width: plateWidth, height, right: plateX + plateWidth, bottom: plateY + height };
    const svg = el.querySelector("svg");
    let content: RectReading | null = rect(svg);
    if (svg === null) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode();
      if (text !== null && (text.textContent ?? "").trim() !== "") {
        const range = document.createRange();
        range.selectNodeContents(text);
        const textRect = range.getBoundingClientRect();
        content = { x: textRect.x, y: textRect.y, width: textRect.width, height: textRect.height, right: textRect.right, bottom: textRect.bottom };
      }
    }
    return { plate, svg: rect(svg), content };
  });
  const clip = {
    x: Math.floor(geometry.plate.x) - 1,
    y: Math.floor(geometry.plate.y) - 1,
    width: 0,
    height: 0,
    right: Math.ceil(geometry.plate.right) + 1,
    bottom: Math.ceil(geometry.plate.bottom) + 1,
  };
  clip.width = clip.right - clip.x;
  clip.height = clip.bottom - clip.y;
  const probe = await page.addStyleTag({ content: `
    .lumir-hp-copy, .lumir-hp-withdraw {
      color: #ff0000 !important;
      opacity: 1 !important;
      transition: none !important;
      background: #ffffff !important;
    }
    .lumir-hp-copy::before, .lumir-hp-withdraw::before { background: #ffffff !important; }
  ` });
  let referenceStyle: ElementHandle<Node> | undefined;
  try {
    const actual = readRedInk(await page.screenshot({ clip, animations: "disabled" }), clip);
    referenceStyle = await page.addStyleTag({ content: `
      .lumir-hp-copy::before, .lumir-hp-withdraw::before { visibility: hidden !important; }
    ` });
    const reference = readRedInk(await page.screenshot({ clip, animations: "disabled" }), clip);
    const actualPixels = new Set(actual.pixels);
    const centerOffset = reference.bounds === null ? null : {
      x: (reference.bounds.x + reference.bounds.right - geometry.plate.x - geometry.plate.right) / 2,
      y: (reference.bounds.y + reference.bounds.bottom - geometry.plate.y - geometry.plate.bottom) / 2,
    };
    return {
      ...geometry,
      missingInk: reference.pixels.filter((pixel) => !actualPixels.has(pixel)).length,
      centerOffset,
    };
  } finally {
    if (referenceStyle !== undefined) await referenceStyle.evaluate((el) => el.parentNode?.removeChild(el));
    await probe.evaluate((el) => el.parentNode?.removeChild(el));
  }
}
