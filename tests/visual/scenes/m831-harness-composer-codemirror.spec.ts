import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";
import { standardProviders } from "./provider-config";

const DOC = "# CDP IME\n\n用于组合测试的引用原文。\n";
const QUOTED = "用于组合测试的引用原文。";
const VAULT: VaultFixture = {
  entries: [{ path: "ime.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "ime.md": DOC },
  links: {},
};

async function setup(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await page.addInitScript((providers) => {
    const w = window as unknown as Record<string, any>;
    w.__sentMessages = [];
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send") {
        w.__sentMessages.push(args.parts_json);
        return null;
      }
      if (cmd === "harness_state") return JSON.stringify({ messages: [], usage: { ctx_pct: 0, cache_pct_session: 0 }, pending_approval: null, warn_ctx_pct: 85 });
      const result = await invoke(cmd, args);
      if (cmd === "config_get" && result?.config) result.config.harness = { provider: "mock", providers, permissions: { allow: [], deny: [] }, loop_max: 8, warn_ctx_pct: 85, auto_compact: true };
      return result;
    };
  }, standardProviders());
  await page.goto("/");
  await page.locator('.ft-row[title="ime.md"]').click();
  await page.evaluate((quoted) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const start = view.state.doc.toString().indexOf(quoted);
    view.focus();
    view.dispatch({ selection: { anchor: start, head: start + quoted.length } });
  }, QUOTED);
  await page.locator(".quote-gesture-btn").click();
  await page.locator(".lumir-hp-composer .cm-content").click();
  await page.keyboard.type("我");
}

test("Chromium CDP 真引擎组合：Backspace 不吃 committed 文本，取消/提交/Enter 与附件 history", async ({ page }) => {
  await setup(page);
  const content = page.locator(".lumir-hp-composer .cm-content");
  const tray = page.locator(".lumir-hp-composer-tray > .lumir-hp-qcard");
  const cdp = await page.context().newCDPSession(page);
  const compose = async (text: string, replacementStart: number) => {
    await cdp.send("Input.imeSetComposition", {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
      replacementStart,
      replacementEnd: replacementStart,
    });
  };

  await tray.locator(".lumir-hp-qc-x").click();
  await expect(tray).toHaveCount(0);
  await page.keyboard.press("Meta+z");
  await expect(tray).toHaveCount(1);
  await expect(tray.locator(".lumir-hp-qc-ex")).toHaveText(QUOTED);
  await expect(content).toHaveText("我");

  await compose("s", 1);
  await expect(content).toHaveText("我s");
  await page.keyboard.press("Backspace");
  await expect(content).toHaveText("我");
  await expect(tray).toHaveCount(1);

  await compose("shuang", 1);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  expect((await content.textContent())?.startsWith("我")).toBe(true);
  await cdp.send("Input.imeSetComposition", {
    text: "",
    selectionStart: 0,
    selectionEnd: 0,
    replacementStart: 1,
    replacementEnd: 5,
  });
  await expect(content).toHaveText("我");
  await expect(tray).toHaveCount(1);

  await compose("shi", 1);
  await cdp.send("Input.insertText", { text: "是" });
  await expect(content).toHaveText("我是");
  await expect(tray).toHaveCount(1);

  await compose("ma", 2);
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => (window as unknown as { __sentMessages: string[] }).__sentMessages)).toEqual([]);
  await cdp.send("Input.insertText", { text: "吗" });
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sentMessages: string[] }).__sentMessages.length)).toBe(1);
  await expect(content).toHaveText("");
});

// ── 竖直移动的列位口径（M834）─────────────────────────────────────────────────────────
// CM 的 cursorLineUp/Down 把 goal column 当**像素 x**；composer 字体是比例字体（13px SF Pro），
// 两行同一字符列的像素宽不相等 ⇒ 真机 140：第二段行尾（列 2）按 ⌃P 落列 3。合同（HC1）要求
// 列位是**行内字符列**：行选仍交给 CM moveVertically，落点按字符列在目标渲染行里重算。
type ComposerViewState = { head: number; anchor: number; goal: number | null; doc: string };

async function composerState(page: Page): Promise<ComposerViewState> {
  return page.evaluate(() => {
    const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
    const main = view.state.selection.main;
    return { head: main.head, anchor: main.anchor, goal: main.goalColumn ?? null, doc: view.state.doc.toString() };
  });
}

async function setComposerCaret(page: Page, pos: number): Promise<void> {
  await page.evaluate((at) => {
    const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
    view.dispatch({ selection: { anchor: at } });
  }, pos);
}

async function openDraftComposer(page: Page, text: string, caret: number): Promise<void> {
  await stubTauri(page, VAULT);
  await page.addInitScript((draft) => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
      if (cmd === "harness_draft_get") return JSON.stringify({ version: 2, ...draft, cards: [] });
      if (cmd === "harness_draft_put") return null;
      if (cmd === "harness_state") {
        return JSON.stringify({ messages: [], usage: { ctx_pct: 0, cache_pct_session: 0 }, pending_approval: null, warn_ctx_pct: 85 });
      }
      return invoke(cmd, args);
    };
  }, { text, caret });
  await page.goto("/");
  await page.locator('.ft-row[title="ime.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect.poll(async () => (await composerState(page)).doc).toBe(text);
  await page.locator(".lumir-hp-composer .cm-content").click();
  await setComposerCaret(page, caret);
}

test("⌃P 从短行行尾按字符列回长行（140 现场：同列 2，不是像素最近的列 3）", async ({ page }) => {
  await openDraftComposer(page, "yabzcdw\nmn", 10);
  await page.keyboard.press("Control+p");
  expect(await composerState(page)).toEqual({ head: 2, anchor: 2, goal: 2, doc: "yabzcdw\nmn" });
  await page.keyboard.type("p");
  await expect.poll(async () => (await composerState(page)).doc).toBe("yapbzcdw\nmn");
});

test("⌃N 到短行钳到行尾并保留目标列，回长行恢复原列", async ({ page }) => {
  await openDraftComposer(page, "abcdefghij\nxy", 10);
  await page.keyboard.press("Control+n");
  expect(await composerState(page)).toEqual({ head: 13, anchor: 13, goal: 10, doc: "abcdefghij\nxy" });
  await page.keyboard.press("Control+p");
  expect((await composerState(page)).head).toBe(10);
});

test("连续 ⌃P/⌃N 穿过短行仍按目标列往返", async ({ page }) => {
  await openDraftComposer(page, "0123456789\nxy\nABCDEFGHIJ", 24);
  for (const [key, head] of [["Control+p", 13], ["Control+p", 10], ["Control+n", 13], ["Control+n", 24]] as const) {
    await page.keyboard.press(key);
    const state = await composerState(page);
    expect({ head: state.head, goal: state.goal }).toEqual({ head, goal: 10 });
  }
  expect((await composerState(page)).doc).toBe("0123456789\nxy\nABCDEFGHIJ");
});

test("⇧Enter 换行并键入后 ⌃P 按字符列落点", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
      if (cmd === "harness_draft_get") return null;
      if (cmd === "harness_state") {
        return JSON.stringify({ messages: [], usage: { ctx_pct: 0, cache_pct_session: 0 }, pending_approval: null, warn_ctx_pct: 85 });
      }
      return invoke(cmd, args);
    };
  });
  await page.goto("/");
  await page.locator('.ft-row[title="ime.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await page.locator(".lumir-hp-composer .cm-content").click();
  await page.keyboard.type("yabzcdw");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("mn");
  await expect.poll(async () => (await composerState(page)).doc).toBe("yabzcdw\nmn");
  await page.keyboard.press("Control+p");
  expect((await composerState(page)).head).toBe(2);
  await page.keyboard.type("p");
  await expect.poll(async () => (await composerState(page)).doc).toBe("yapbzcdw\nmn");
});

test("软折行仍逐屏行移动（行选归 CM，列位按屏行内字符列）", async ({ page }) => {
  const long = "abcdefghij".repeat(20);
  await openDraftComposer(page, long, 75);
  // 折行点由 CM 的 moveToLineBoundary(includeWrap) 决定：取第 2 屏行行首，按字符列 5 回上一屏行
  const rowStarts = await page.evaluate(() => {
    const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
    const EditorSelection = view.state.selection.constructor as { cursor(pos: number): any };
    const starts: number[] = [0];
    let pos = 0;
    for (;;) {
      const next = view.moveToLineBoundary(EditorSelection.cursor(pos), true, true).head;
      if (next <= pos || next >= view.state.doc.length) break;
      starts.push(next);
      pos = next;
    }
    return starts;
  });
  expect(rowStarts.length).toBeGreaterThan(1);
  const second = rowStarts[1];
  await setComposerCaret(page, second + 5);
  await page.keyboard.press("Control+p");
  expect((await composerState(page)).head).toBe(rowStarts[0] + 5);
  await page.keyboard.press("Control+n");
  expect((await composerState(page)).head).toBe(second + 5);
});
