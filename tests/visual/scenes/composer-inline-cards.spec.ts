import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";
import { standardProviders } from "./provider-config";

const QUOTED = "CW-CARD-A";
const DOC = `# inline cards\n\n${QUOTED}\n`;
const VAULT: VaultFixture = {
  entries: [{ path: "inline.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "inline.md": DOC },
  links: {},
};
const QUOTE = {
  kind: "quote",
  card: { file: "inline.md", heading: "inline cards", headingPath: "inline cards", lines: "3-3", text: QUOTED },
};
const IMAGE = { name: "pasted-0f9a8b7c6d5e4f.webp", width: 640, height: 360 };
const EMPTY_STATE = {
  messages: [],
  usage: { ctx_pct: 0, cache_pct_session: 0 },
  pending_approval: null,
  warn_ctx_pct: 85,
};

async function openComposer(page: Page, draft: unknown = null): Promise<void> {
  await stubTauri(page, VAULT);
  await page.addInitScript(
    ({ providers, draft, emptyState, written }) => {
      const w = window as unknown as Record<string, any>;
      w.__sentMessages = [];
      w.__imageReads = 0;
      const invoke = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
        if (cmd === "harness_send") {
          w.__sentMessages.push(args.parts_json);
          return null;
        }
        if (cmd === "harness_state") return JSON.stringify(emptyState);
        if (cmd === "harness_draft_get") return draft === null ? null : JSON.stringify(draft);
        if (cmd === "harness_draft_put") return null;
        if (cmd === "harness_write_image") return written;
        if (cmd === "harness_read_image") {
          w.__imageReads += 1;
          return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        }
        const result = await invoke(cmd, args);
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
    },
    { providers: standardProviders(), draft, emptyState: EMPTY_STATE, written: IMAGE },
  );
  await page.goto("/");
  await page.locator('.ft-row[title="inline.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-hp-composer .cm-content")).toBeVisible();
}

async function insertQuote(page: Page): Promise<void> {
  await page.evaluate((quoted) => {
    const view = (document.querySelector(".editor-pane .cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const start = view.state.doc.toString().indexOf(quoted);
    view.focus();
    view.dispatch({ selection: { anchor: start, head: start + quoted.length } });
  }, QUOTED);
  await page.locator(".quote-gesture-btn").click();
}

async function composerViewState(page: Page): Promise<{ doc: string; head: number }> {
  return page.locator(".lumir-hp-composer .cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    return { doc: view.state.doc.toString(), head: view.state.selection.main.head };
  });
}

async function pasteImage(page: Page): Promise<void> {
  await page.locator(".lumir-hp-composer .cm-content").evaluate((el) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([137, 80, 78, 71])], "inline.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(page.locator(".lumir-hp-cwidget .lumir-hp-imgcard")).toHaveCount(1);
}

test("行首 anchor：零长度 widget 在 CM 文本内且位于文字之前，tray 与占位符退场", async ({ page }, testInfo) => {
  await openComposer(page);
  await insertQuote(page);
  await page.keyboard.type("CW-TEXT-B");
  const content = page.locator(".lumir-hp-composer .cm-content");
  await expect(content.locator(".lumir-hp-cwidget > .lumir-hp-qcard")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-composer-tray")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-composer")).not.toHaveClass(/is-empty/);
  await expect(content.locator(".lumir-hp-cwidget")).toHaveAttribute("contenteditable", "false");
  const order = await content.evaluate((el) => [...el.children].flatMap((child) => {
    if (child.classList.contains("lumir-hp-cwidget")) return [["card", child.textContent]];
    if (child.classList.contains("cm-line")) return [["text", child.textContent]];
    return [];
  }));
  expect(order[0]?.[0]).toBe("card");
  expect(order.at(-1)).toEqual(["text", "CW-TEXT-B"]);
  expect((await composerViewState(page)).doc).toBe("CW-TEXT-B");
  await content.screenshot({ path: testInfo.outputPath("line-start.png") });
});

test("行中 anchor：widget 把一行拆成文字 / 卡片 / 文字，doc 不新增换行", async ({ page }, testInfo) => {
  await openComposer(page, { version: 3, text: "AB", caret: 0, cards: [{ card: QUOTE, at: 1 }] });
  const content = page.locator(".lumir-hp-composer .cm-content");
  await expect(content.locator(".lumir-hp-cwidget > .lumir-hp-qcard")).toHaveCount(1);
  const order = await content.evaluate((el) => [...el.children].flatMap((child) => {
    if (child.classList.contains("lumir-hp-cwidget")) return [["card", child.textContent]];
    if (child.classList.contains("cm-line")) return [["text", child.textContent]];
    return [];
  }));
  expect(order.map(([kind]) => kind)).toEqual(["text", "card", "text"]);
  expect(order[0]?.[1]).toBe("A");
  expect(order[2]?.[1]).toBe("B");
  expect((await composerViewState(page)).doc).toBe("AB");
  await content.screenshot({ path: testInfo.outputPath("line-mid.png") });
});

test("应用内 copy 事件逐字节只含选区文本，不带卡片、按钮或哨兵", async ({ page }) => {
  await openComposer(page, { version: 3, text: "AB", caret: 0, cards: [{ card: QUOTE, at: 1 }] });
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__copied = null;
    document.addEventListener("copy", (event) => {
      w.__copied = event.clipboardData?.getData("text/plain") ?? null;
    });
  });
  await page.locator(".lumir-hp-composer .cm-line").first().click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+c");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __copied: string | null }).__copied)).toBe("AB");
  const copied = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
  expect(copied).not.toContain(QUOTED);
  expect(copied).not.toContain("×");
  expect(copied).not.toContain("@");
  expect(copied).not.toContain("�");
});

test("空选区 copy 不意外复制整段，视觉摘录由 ::before 保留", async ({ page }) => {
  await openComposer(page, { version: 3, text: "AB", caret: 0, cards: [{ card: QUOTE, at: 1 }] });
  const excerpt = page.locator(".lumir-hp-cwidget .lumir-hp-qc-ex");
  await expect(excerpt).toHaveAttribute("data-excerpt", QUOTED);
  expect(await excerpt.evaluate((el) => getComputedStyle(el, "::before").content)).toBe(JSON.stringify(QUOTED));
  const accessibleName = await page.locator(".lumir-hp-cwidget .lumir-hp-qcard").getAttribute("aria-label");
  expect(accessibleName).toContain(QUOTED);
  expect(accessibleName).toContain("inline cards");
  const copied = await page.evaluate(() => {
    const view = (document.querySelector(".lumir-hp-composer .cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: 0 } });
    const data = new DataTransfer();
    data.setData("text/plain", "SENTINEL");
    view.contentDOM.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data }));
    return data.getData("text/plain");
  });
  expect(copied).toBe("");
  const nativeFallback = await page.locator(".lumir-hp-composer .cm-content").evaluate((el) => (
    el.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true }))
  ));
  expect(nativeFallback).toBe(true);
});

test("200 字连续输入复用卡片 DOM 且不重复读图", async ({ page }) => {
  await openComposer(page);
  await pasteImage(page);
  const before = await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__inlineCardNode = document.querySelector(".lumir-hp-cwidget .lumir-hp-imgcard");
    return w.__imageReads as number;
  });
  const started = Date.now();
  await page.keyboard.type("x".repeat(200));
  const elapsed = Date.now() - started;
  const result = await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    return {
      sameNode: w.__inlineCardNode === document.querySelector(".lumir-hp-cwidget .lumir-hp-imgcard"),
      reads: w.__imageReads as number,
      doc: (document.querySelector(".lumir-hp-composer .cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view.state.doc.toString(),
    };
  });
  expect(result.sameNode).toBe(true);
  expect(result.reads).toBe(before);
  expect(result.doc).toBe("x".repeat(200));
  console.log(`[composer-perf-200chars] elapsed_ms=${elapsed} dom_identity=${result.sameNode} image_reads=${before}->${result.reads}`);
});
