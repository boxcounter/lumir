import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";
import { standardProviders } from "./provider-config";

const VAULT: VaultFixture = {
  entries: [{ path: "note.md", kind: "file", size: 8, mtime_ms: 0 }],
  files: { "note.md": "# Note\n" },
  links: {},
};
const SKILLS = [
  { name: "acc-skill-abc", description: "默认", source: "vault", user_invocable: true, model_invocable: true, invocation_valid: true },
  { name: "tmp-acc", description: "路径前缀", source: "vault", user_invocable: true, model_invocable: true, invocation_valid: true },
  { name: "acc-deploy", description: "禁自动", source: "vault", user_invocable: true, model_invocable: false, invocation_valid: true },
  { name: "acc-background", description: "禁手动", source: "vault", user_invocable: false, model_invocable: true, invocation_valid: true },
  { name: "acc-invalid", description: "非法", source: "vault", user_invocable: false, model_invocable: false, invocation_valid: false },
];

async function setup(page: Page, draft: unknown = null, deferCatalog = false): Promise<void> {
  await stubTauri(page, VAULT);
  await page.addInitScript(({ skills, providers, draft, deferCatalog }) => {
    const w = window as unknown as Record<string, any>;
    w.__sent = [];
    w.__keyDefaults = [];
    w.__skillCalls = 0;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_skills_list") {
        w.__skillCalls += 1;
        if (deferCatalog) {
          return new Promise((resolve) => {
            w.__resolveSkills = () => resolve(skills);
          });
        }
        return skills;
      }
      if (cmd === "harness_send") {
        w.__sent.push(args);
        return null;
      }
      if (cmd === "harness_draft_get") return draft === null ? null : JSON.stringify(draft);
      if (cmd === "harness_draft_put") return null;
      if (cmd === "harness_state") return JSON.stringify({ messages: [], usage: { ctx_pct: 0, cache_pct_session: 0 }, pending_approval: null, warn_ctx_pct: 85 });
      const result = await invoke(cmd, args);
      if (cmd === "config_get" && result?.config) result.config.harness = { provider: "mock", providers, permissions: { allow: [], deny: [] }, loop_max: 8, warn_ctx_pct: 85, auto_compact: true };
      return result;
    };
    document.addEventListener("keydown", (event) => {
      if (["n", "p", "Enter", "Tab"].includes(event.key)) w.__keyDefaults.push({ key: event.key, prevented: event.defaultPrevented });
    });
  }, { skills: SKILLS, providers: standardProviders(), draft, deferCatalog });
  await page.goto("/");
  await page.locator('.ft-row[title="note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await page.locator(".lumir-hp-composer .cm-content").click();
}

const sent = (page: Page) => page.evaluate(() => (window as unknown as { __sent: any[] }).__sent);

test("Skill 候选被动态不抢 Enter，方向键选择后才提交 ref", async ({ page }) => {
  await setup(page);
  const composer = page.locator(".lumir-hp-composer .cm-content");
  const menu = page.locator(".lumir-hp-skill-menu");
  await page.keyboard.type("/tmp");
  await expect(menu).toBeVisible();
  await expect(menu.locator("[role=option]")).toHaveCount(1);
  await expect(composer).not.toHaveAttribute("aria-activedescendant", /.*/);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sent(page)).length).toBe(1);
  expect((await sent(page))[0].skills_json).toBe("[]");
  await expect(menu).toBeHidden();
});

test("方向键进入选择态后 Enter 选中并提交当前 ref", async ({ page }) => {
  await setup(page);
  const composer = page.locator(".lumir-hp-composer .cm-content");
  const menu = page.locator(".lumir-hp-skill-menu");
  await page.keyboard.type("/acc");
  await expect(menu.locator("[role=option]")).toHaveCount(2);
  await page.keyboard.press("ArrowDown");
  await expect(menu.locator("[role=option][aria-selected=true]")).toHaveCount(1);
  await expect(composer).toHaveAttribute("aria-activedescendant", "lumir-hp-skill-option-0");
  await page.keyboard.press("Enter");
  await expect(composer).toHaveText("/acc-skill-abc ");
  await expect(composer.locator(".lumir-hp-skill-ref")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sent(page)).length).toBe(1);
  expect((await sent(page))[0].skills_json).toBe('["acc-skill-abc"]');
});

test("chip 只按 refs 与最新成功 catalog 标 missing/disabled，候选过滤禁手动和非法", async ({ page }) => {
  await setup(page, {
    version: 3,
    text: "/acc-background /acc-invalid /missing /tmp",
    caret: 0,
    cards: [],
    skills: [
      { name: "acc-background", from: 0, to: 15 },
      { name: "acc-invalid", from: 16, to: 28 },
      { name: "missing", from: 29, to: 37 },
    ],
  });
  const composer = page.locator(".lumir-hp-composer .cm-content");
  await expect(composer.locator(".is-disabled")).toHaveCount(2);
  await expect(composer.locator(".is-missing")).toHaveCount(1);
  await expect(composer.locator(".is-disabled").first()).toHaveAttribute("title", "This Skill is not user-invocable");
  await expect(composer.locator(".is-disabled").nth(1)).toHaveAttribute("title", "This Skill has invalid invocation metadata");
  await page.keyboard.press("End");
  await page.keyboard.type(" /acc");
  const menu = page.locator(".lumir-hp-skill-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator(".lumir-hp-skill-name")).toHaveText(["acc-skill-abc", "acc-deploy"]);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(composer).toBeFocused();
});

test("⌃N/⌃P 关闭候选但不消费，真实行移动保持", async ({ page }) => {
  await setup(page);
  await page.keyboard.type("abcdef");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("xy");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("/tmp");
  const menu = page.locator(".lumir-hp-skill-menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Control+p");
  await expect(menu).toBeHidden();
  const state = await page.evaluate(() => {
    const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
    return { head: view.state.selection.main.head, doc: view.state.doc.toString() };
  });
  expect(state).toEqual({ head: 9, doc: "abcdef\nxy\n/tmp" });
  const keys = await page.evaluate(() => (window as unknown as { __keyDefaults: any[] }).__keyDefaults);
  expect(keys.find((event) => event.key === "p")?.prevented).toBe(false);
});


test("草稿恢复 catalog 恰好一次且零新键入不打开候选", async ({ page }) => {
  await setup(page, {
    version: 3,
    text: "/acc-skill-abc",
    caret: 14,
    cards: [],
    skills: [{ name: "acc-skill-abc", from: 0, to: 14 }],
  });
  const composer = page.locator(".lumir-hp-composer .cm-content");
  await expect(composer.locator(".lumir-hp-skill-ref")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-skill-menu")).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __skillCalls: number }).__skillCalls)).toBe(1);
  await expect(page.locator(".lumir-hp-skill-menu")).toBeHidden();
});

test("Esc/失焦/切会话后 catalog 回包不得复活候选", async ({ page }) => {
  for (const cancel of ["escape", "blur", "session"] as const) {
    await setup(page, null, true);
    const menu = page.locator(".lumir-hp-skill-menu");
    await page.keyboard.type("/acc");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __skillCalls: number }).__skillCalls)).toBeGreaterThan(0);
    if (cancel === "escape") await page.keyboard.press("Escape");
    if (cancel === "blur") await page.locator(".lumir-hp-composer .cm-content").evaluate((el) => el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    if (cancel === "session") await page.locator(".lumir-hp-seg-new").click();
    await page.evaluate(() => (window as unknown as { __resolveSkills: () => void }).__resolveSkills());
    await expect(menu).toBeHidden();
  }
});

test("IME compositionstart 后组合更新不重开候选，确认 Enter 不吞且不创建 ref", async ({ page }) => {
  await setup(page);
  const composer = page.locator(".lumir-hp-composer .cm-content");
  const menu = page.locator(".lumir-hp-skill-menu");
  await page.keyboard.type("/acc");
  await expect(menu).toBeVisible();
  await composer.evaluate((el) => el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  await expect(menu).toBeHidden();
  const enterPrevented = await composer.evaluate((el) => {
    const view = (el as any).cmTile.root.view;
    view.dispatch({ changes: { from: 1, to: 4, insert: "a" }, userEvent: "input.compose" });
    const arrow = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true, isComposing: true });
    el.dispatchEvent(arrow);
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true });
    el.dispatchEvent(enter);
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    return { arrowPrevented: arrow.defaultPrevented, enterPrevented: enter.defaultPrevented, composing: view.compositionStarted };
  });
  expect(enterPrevented.arrowPrevented).toBe(false);
  expect(enterPrevented.enterPrevented).toBe(false);
  await expect(menu).toBeHidden();
  await expect(composer.locator(".lumir-hp-skill-ref")).toHaveCount(0);
  expect(await sent(page)).toEqual([]);
});

test("⌃N/⌃P 单行边界与多行跨行均关闭候选且不消费", async ({ page }) => {
  for (const item of [
    { text: "/tmp", caret: 4, key: "Control+n", head: 4 },
    { text: "/tmp", caret: 4, key: "Control+p", head: 0 },
    { text: "/tmp\nabcdef", caret: 4, key: "Control+n", head: 11 },
    { text: "abcdef\nxy\n/tmp", caret: 12, key: "Control+p", head: 9 },
  ] as const) {
    if (item.key === "Control+p" && item.text.includes("\n")) {
      await setup(page);
      for (const [index, line] of item.text.split("\n").entries()) {
        if (index > 0) await page.keyboard.press("Shift+Enter");
        await page.keyboard.type(line);
      }
    } else {
      await setup(page, { version: 3, text: item.text, caret: item.caret, cards: [], skills: [] });
      await page.keyboard.type("-");
      if (!item.text.includes("\n")) await page.keyboard.press("Backspace");
    }
    const menu = page.locator(".lumir-hp-skill-menu");
    await expect(menu).toBeVisible();
    await page.keyboard.press(item.key);
    await expect(menu).toBeHidden();
    const head = await page.evaluate(() => {
      const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
      return view.state.selection.main.head;
    });
    expect(head).toBe(item.head);
    const keys = await page.evaluate(() => (window as unknown as { __keyDefaults: any[] }).__keyDefaults);
    expect(keys.at(-1)?.prevented).toBe(false);
  }
});
