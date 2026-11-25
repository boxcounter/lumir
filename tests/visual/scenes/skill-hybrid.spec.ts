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

type Theme = "light" | "dark" | "eink";

async function setup(
  page: Page,
  draft: unknown = null,
  deferCatalog = false,
  theme?: Theme,
  catalog: typeof SKILLS = SKILLS,
): Promise<void> {
  await stubTauri(page, theme === undefined ? VAULT : { ...VAULT, config: { theme } });
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
      if (["n", "N", "p", "P", "Enter", "Tab", "ArrowDown", "ArrowUp"].includes(event.key)) {
        w.__keyDefaults.push({
          key: event.key,
          prevented: event.defaultPrevented,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
        });
      }
    });
  }, { skills: catalog, providers: standardProviders(), draft, deferCatalog });
  await page.goto("/");
  await page.locator('.ft-row[title="note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await page.locator(".lumir-hp-composer .cm-content").click();
}

const sent = (page: Page) => page.evaluate(() => (window as unknown as { __sent: any[] }).__sent);

async function composerSnapshot(page: Page) {
  return page.evaluate(() => {
    const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
    const fields: any[] = [];
    const collectFields = (extension: any) => {
      if (Array.isArray(extension)) {
        for (const item of extension) collectFields(item);
      } else if (extension && typeof extension.createF === "function" && typeof extension.updateF === "function") {
        fields.push(extension);
      }
    };
    collectFields(view.state.config.base);
    const historyFields = fields.filter((field) => {
      if (typeof field.spec.toJSON !== "function") return false;
      const value = view.state.field(field, false);
      if (value === undefined) return false;
      const serialized = field.spec.toJSON(value);
      return Array.isArray(serialized?.done) && Array.isArray(serialized?.undone);
    });
    if (historyFields.length !== 1) throw new Error(`Expected one registered history field, got ${historyFields.length}`);
    return {
      head: view.state.selection.main.head,
      doc: view.state.doc.toString(),
      history: view.state.toJSON({ history: historyFields[0] }).history,
    };
  });
}

test("路径前缀 /tmp 只做视觉预选，Enter 仍发送普通文本且不建 ref", async ({ page }) => {
  await setup(page);
  const composer = page.locator(".lumir-hp-composer .cm-content");
  const menu = page.locator(".lumir-hp-skill-menu");
  await page.keyboard.type("/tmp");
  await expect(menu).toBeVisible();
  await expect(menu.locator("[role=option]")).toHaveCount(1);
  // 合同 C4：query 变化自动视觉高亮唯一项；armed 只认显式选择或全名，/tmp 不是 tmp-acc 的全名。
  await expect(menu).toHaveAttribute("data-armed", "false");
  await expect(composer).toHaveAttribute("aria-activedescendant", "lumir-hp-skill-option-0");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sent(page)).length).toBe(1);
  expect((await sent(page))[0].skills_json).toBe("[]");
  await expect(menu).toBeHidden();
});

test("键入完整 Skill 名后自动武装，Enter 直接接受（Alex 已批准的全名接受）", async ({ page }) => {
  await setup(page);
  const composer = page.locator(".lumir-hp-composer .cm-content");
  const menu = page.locator(".lumir-hp-skill-menu");
  await page.mouse.move(10, 10);
  await page.keyboard.type("/tmp-acc");
  await expect(menu).toBeVisible();
  await expect(menu.locator("[role=option]")).toHaveCount(1);
  await expect(menu).toHaveAttribute("data-armed", "true");
  await expect(composer).toHaveAttribute("aria-activedescendant", "lumir-hp-skill-option-0");
  await page.keyboard.press("Enter");
  await expect(composer).toHaveText("/tmp-acc ");
  await expect(composer.locator(".lumir-hp-skill-ref")).toHaveCount(1);
  expect(await sent(page)).toEqual([]);
});

test("全名之后继续输入普通文本则 token 结束，Enter 回到发送语义", async ({ page }) => {
  await setup(page);
  const composer = page.locator(".lumir-hp-composer .cm-content");
  const menu = page.locator(".lumir-hp-skill-menu");
  await page.keyboard.type("/tmp-acc and then");
  await expect(menu).toBeHidden();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sent(page)).length).toBe(1);
  expect((await sent(page))[0].skills_json).toBe("[]");
  await expect(composer).toHaveText("");
});

test("Skill 候选被动态不消费 Tab，保留原生焦点遍历且不创建 ref", async ({ page }) => {
  await setup(page);
  await page.mouse.move(10, 10);
  const composer = page.locator(".lumir-hp-composer .cm-content");
  const menu = page.locator(".lumir-hp-skill-menu");
  await page.keyboard.type("/acc");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-armed", "false");
  await expect(composer).toHaveAttribute("aria-activedescendant", "lumir-hp-skill-option-0");
  await page.keyboard.press("Tab");
  await expect(composer).not.toBeFocused();
  await expect(menu).toBeHidden();
  await expect(composer).toHaveText("/acc");
  await expect(composer.locator(".lumir-hp-skill-ref")).toHaveCount(0);
  expect(await sent(page)).toEqual([]);
  const keys = await page.evaluate(() => (window as unknown as { __keyDefaults: any[] }).__keyDefaults);
  expect(keys.at(-1)).toMatchObject({ key: "Tab", prevented: false });
});

test("方向键进入选择态后 Enter 选中并提交当前 ref", async ({ page }) => {
  await setup(page);
  const composer = page.locator(".lumir-hp-composer .cm-content");
  const menu = page.locator(".lumir-hp-skill-menu");
  // 在菜单打开前移开指针，确保首次 ArrowDown 从自动高亮首项进入键盘选择。
  await page.mouse.move(10, 10);
  await page.keyboard.type("/acc");
  await expect(menu.locator("[role=option]")).toHaveCount(2);
  await expect(menu).toHaveAttribute("data-armed", "false");
  await expect(composer).toHaveAttribute("aria-activedescendant", "lumir-hp-skill-option-0");
  await page.keyboard.press("ArrowDown");
  await expect(menu.locator("[role=option][aria-selected=true]")).toHaveCount(1);
  await expect(menu).toHaveAttribute("data-armed", "true");
  await expect(composer).toHaveAttribute("aria-activedescendant", "lumir-hp-skill-option-1");
  await page.keyboard.press("Enter");
  await expect(composer).toHaveText("/acc-deploy ");
  await expect(composer.locator(".lumir-hp-skill-ref")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sent(page)).length).toBe(1);
  expect((await sent(page))[0].skills_json).toBe('["acc-deploy"]');
});

test("方向键进入选择态后 Tab 接受并提交当前 ref", async ({ page }) => {
  await setup(page);
  const composer = page.locator(".lumir-hp-composer .cm-content");
  const menu = page.locator(".lumir-hp-skill-menu");
  await page.mouse.move(10, 10);
  await page.keyboard.type("/acc");
  await expect(menu.locator("[role=option]")).toHaveCount(2);
  await page.keyboard.press("ArrowDown");
  await expect(composer).toHaveAttribute("aria-activedescendant", "lumir-hp-skill-option-1");
  await page.keyboard.press("Tab");
  await expect(composer).toHaveText("/acc-deploy ");
  await expect(composer.locator(".lumir-hp-skill-ref")).toHaveCount(1);
  await expect(composer).toBeFocused();
  await expect(menu).toBeHidden();
  expect(await sent(page)).toEqual([]);
  const keys = await page.evaluate(() => (window as unknown as { __keyDefaults: any[] }).__keyDefaults);
  expect(keys.at(-1)).toMatchObject({ key: "Tab", prevented: true });
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sent(page)).length).toBe(1);
  expect((await sent(page))[0].skills_json).toBe('["acc-deploy"]');
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

test("候选打开时键盘与指针导航同路选择，composer 文档/caret/撤销栈不变", async ({ page }) => {
  await setup(page);
  await page.mouse.move(10, 10);
  const empty = await composerSnapshot(page);
  await page.keyboard.type("abcdef");
  const edited = await composerSnapshot(page);
  expect(edited.history, "真实键入必须改变 history，证明快照不是空断言").not.toEqual(empty.history);
  expect(edited.history.done.length).toBeGreaterThan(empty.history.done.length);
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("xy");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("/acc");
  const menu = page.locator(".lumir-hp-skill-menu");
  const options = menu.locator("[role=option]");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  const before = await composerSnapshot(page);

  await page.keyboard.press("ArrowDown");
  await expect(menu.locator("[role=option][aria-selected=true]")).toHaveAttribute("id", "lumir-hp-skill-option-1");
  expect(await composerSnapshot(page)).toEqual(before);
  const arrowKeys = await page.evaluate(() => (window as unknown as { __keyDefaults: any[] }).__keyDefaults);
  expect(arrowKeys.at(-1)).toMatchObject({ key: "ArrowDown", prevented: true });

  await page.keyboard.press("Control+p");
  await expect(menu.locator("[role=option][aria-selected=true]")).toHaveAttribute("id", "lumir-hp-skill-option-0");
  expect(await composerSnapshot(page)).toEqual(before);
  const ctrlKeys = await page.evaluate(() => (window as unknown as { __keyDefaults: any[] }).__keyDefaults);
  expect(ctrlKeys.find((event) => event.key === "p")?.prevented).toBe(true);

  await page.keyboard.press("Control+n");
  await expect(menu.locator("[role=option][aria-selected=true]")).toHaveAttribute("id", "lumir-hp-skill-option-1");
  expect(await composerSnapshot(page)).toEqual(before);

  await options.nth(0).hover();
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  expect(await composerSnapshot(page)).toEqual(before);
  // 已在首项时再按上：事件仍被消费、游标不环绕，文档与撤销栈不动
  await page.keyboard.press("ArrowUp");
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  expect(await composerSnapshot(page)).toEqual(before);
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

test("deferred catalog 裸 / 回包后显示合法项且连续输入不重复强制请求", async ({ page }) => {
  await setup(page, null, true);
  const menu = page.locator(".lumir-hp-skill-menu");
  await page.keyboard.type("/");
  await expect(menu).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __skillCalls: number }).__skillCalls)).toBe(1);
  await page.evaluate(() => (window as unknown as { __resolveSkills: () => void }).__resolveSkills());
  await expect(menu).toBeVisible();
  await expect(menu.locator(".lumir-hp-skill-name")).toHaveText(["acc-skill-abc", "tmp-acc", "acc-deploy"]);
  // 迟到 catalog 只补视觉高亮，绝不武装：此刻 Enter 仍必须是发送。
  await expect(menu).toHaveAttribute("data-armed", "false");
  await expect(page.locator(".lumir-hp-composer .cm-content")).toHaveAttribute("aria-activedescendant", "lumir-hp-skill-option-0");
  await page.keyboard.type("acc");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __skillCalls: number }).__skillCalls)).toBe(1);
  await expect(menu).toHaveAttribute("data-armed", "false");
  await expect(menu.locator("[role=option][aria-selected=true]")).toHaveAttribute("id", "lumir-hp-skill-option-0");
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
    // 组合提交中文：最终文档 /acc字 不再是合法 token，组合结束后重算也不会重开候选。
    view.dispatch({ changes: { from: 4, insert: "字" }, selection: { anchor: 5 }, userEvent: "input.compose" });
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

test("IME 组合结束按最终文档重算一次：全名武装可接受，确认 Enter 不被候选抢走", async ({ page }) => {
  await setup(page);
  const composer = page.locator(".lumir-hp-composer .cm-content");
  const menu = page.locator(".lumir-hp-skill-menu");
  await page.keyboard.type("/tmp");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-armed", "false");
  await composer.evaluate((el) => el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  await expect(menu).toBeHidden();
  await composer.evaluate((el) => {
    const view = (el as any).cmTile.root.view;
    view.dispatch({ changes: { from: 4, insert: "-acc" }, selection: { anchor: 8 }, userEvent: "input.compose" });
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });
  // 组合提交的最终文档是完整 Skill 名 → 重算后自动武装；组合期那一拍确认 Enter 由 IME 门处理，
  // 候选不得把它解释成「接受」。
  await expect(menu).toHaveAttribute("data-armed", "true");
  await expect(composer).toHaveAttribute("aria-activedescendant", "lumir-hp-skill-option-0");
  const confirming = await composer.evaluate((el) => {
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    return { prevented: event.defaultPrevented, doc: (el as any).cmTile.root.view.state.doc.toString() };
  });
  expect(confirming.doc).toBe("/tmp-acc");
  await expect(composer.locator(".lumir-hp-skill-ref")).toHaveCount(0);
  expect(await sent(page)).toEqual([]);
  // 确认窗（250ms）之后的下一次 Enter 才是用户真按的接受键。
  await page.waitForTimeout(320);
  await page.keyboard.press("Enter");
  await expect(composer).toHaveText("/tmp-acc ");
  await expect(composer.locator(".lumir-hp-skill-ref")).toHaveCount(1);
});

test("⌃⇧N/P 保留扩选：候选关闭但事件不被消费", async ({ page }) => {
  for (const item of [
    { key: "Control+Shift+p", head: 0 },
    { key: "Control+Shift+n", head: 4 },
  ] as const) {
    await setup(page);
    await page.keyboard.type("/acc");
    const menu = page.locator(".lumir-hp-skill-menu");
    await expect(menu).toBeVisible();
    await page.keyboard.press(item.key);
    await expect(menu).toBeHidden();
    const state = await page.evaluate(() => {
      const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
      const main = view.state.selection.main;
      return { anchor: main.anchor, head: main.head, doc: view.state.doc.toString() };
    });
    expect(state).toEqual({ anchor: 4, head: item.head, doc: "/acc" });
    const keys = await page.evaluate(() => (window as unknown as { __keyDefaults: any[] }).__keyDefaults);
    expect(keys.at(-1)).toMatchObject({ prevented: false, ctrlKey: true, shiftKey: true });
  }
});

test("⇧Arrow 保留原生扩选且不被候选消费，caret 离开 token 后候选关闭", async ({ page }) => {
  for (const item of [
    { key: "Shift+ArrowUp", head: 3 },
    { key: "Shift+ArrowDown", head: 14 },
  ] as const) {
    await setup(page, { version: 3, text: "abcdef\n/acc\nxy", caret: 11, cards: [], skills: [] });
    await page.keyboard.type("-");
    await page.keyboard.press("Backspace");
    const menu = page.locator(".lumir-hp-skill-menu");
    await expect(menu).toBeVisible();
    await page.keyboard.press(item.key);
    await expect.poll(() => page.evaluate(() => {
      const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
      const main = view.state.selection.main;
      return { anchor: main.anchor, head: main.head, empty: main.empty, doc: view.state.doc.toString() };
    })).toEqual({ anchor: 11, head: item.head, empty: false, doc: "abcdef\n/acc\nxy" });
    await expect(menu).toBeHidden();
    const keys = await page.evaluate(() => (window as unknown as { __keyDefaults: any[] }).__keyDefaults);
    expect(keys.at(-1)).toMatchObject({ key: item.key.slice("Shift+".length), prevented: false, shiftKey: true });
  }
});

test("Meta/Alt+N/P 不被候选消费，也不移动候选高亮", async ({ page }) => {
  for (const key of ["Meta+n", "Alt+n", "Meta+p", "Alt+p"]) {
    await setup(page);
    await page.mouse.move(10, 10);
    await page.keyboard.type("/acc");
    const menu = page.locator(".lumir-hp-skill-menu");
    await expect(menu).toBeVisible();
    // 自动视觉高亮在首项；修饰键组合既不得移动它，也不得改变 armed。
    await expect(menu.locator("[role=option][aria-selected=true]")).toHaveAttribute("id", "lumir-hp-skill-option-0");
    await expect(menu).toHaveAttribute("data-armed", "false");
    await page.keyboard.press(key);
    // Alt+N 在 macOS 会产生原生组字（可能改写文档、关闭候选）；Meta 不产生字符。
    // 两支共同的判据只有一条：不得发生候选导航。仍可见时游标必须还在首项。
    if (await menu.isVisible()) {
      await expect(menu.locator("[role=option][aria-selected=true]")).toHaveAttribute("id", "lumir-hp-skill-option-0");
      await expect(menu).toHaveAttribute("data-armed", "false");
    }
    const keys = await page.evaluate(() => (window as unknown as { __keyDefaults: any[] }).__keyDefaults);
    expect(keys.at(-1)).toMatchObject({ prevented: false, [key.startsWith("Meta+") ? "metaKey" : "altKey"]: true });
  }
});

test("候选关闭时 ⌃N/⌃P 不消费，真实行移动保持", async ({ page }) => {
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
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await page.keyboard.press(item.key);
    const head = await page.evaluate(() => {
      const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
      return view.state.selection.main.head;
    });
    expect(head).toBe(item.head);
    const keys = await page.evaluate(() => (window as unknown as { __keyDefaults: any[] }).__keyDefaults);
    expect(keys.at(-1)?.prevented).toBe(false);
  }
});


// ── 键盘导航、局部滚动与响应式尺寸（Alex 2026-11-25 三项实测缺陷） ────────────────
// 合同：docs/specs/skill-menu.md S1–S4。矩阵同时包含不足一屏 / 超出一屏、首末边界、
// 中部可见窗口和鼠标 + 键盘混合；只测「最终选中哪一项」会漏掉高亮在视口外的旧缺陷。
function syntheticSkills(count: number, description = "合成描述"): typeof SKILLS {
  return Array.from({ length: count }, (_, index) => ({
    name: `skill-${String(index).padStart(2, "0")}`,
    description: `${description} ${index}`,
    source: "vault",
    user_invocable: true,
    model_invocable: true,
    invocation_valid: true,
  }));
}

// oracle 必须是**真实可见带**：menuRect ∩ panelRect ∩ viewport。拿 option 比菜单自身矩形
// 与实现同源（REVIEW.md「断言等价于子串」条的同族假绿）——盒被面板裁掉时它照样绿。
async function expectHighlightedVisible(menu: ReturnType<Page["locator"]>): Promise<void> {
  const selected = menu.locator("[role=option][aria-selected=true]");
  await expect(selected).toHaveCount(1);
  const geometry = await menu.evaluate((root) => {
    const option = root.querySelector("[role=option][aria-selected=true]");
    if (option === null) throw new Error("没有高亮 option");
    const harness = root.closest(".lumir-harness");
    if (harness === null) throw new Error("候选不在 harness 面板内");
    const menuRect = root.getBoundingClientRect();
    const panelRect = harness.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    return {
      menuTop: menuRect.top,
      menuBottom: menuRect.bottom,
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      viewportHeight: window.innerHeight,
      clipTop: Math.max(menuRect.top, panelRect.top, 0),
      clipBottom: Math.min(menuRect.bottom, panelRect.bottom, window.innerHeight),
      optionTop: optionRect.top,
      optionBottom: optionRect.bottom,
      rowHeight: optionRect.height,
      scrollTop: root.scrollTop,
    };
  });
  const detail = JSON.stringify(geometry);
  // 盒本身必须先落在面板与视口内，否则「带内」是假的：scrollTop 物理上无法把被裁区里的项搬进屏幕。
  expect(geometry.menuTop, `候选盒顶越过面板顶：${detail}`).toBeGreaterThanOrEqual(geometry.panelTop - 0.5);
  expect(geometry.menuBottom, `候选盒底越过面板底：${detail}`).toBeLessThanOrEqual(geometry.panelBottom + 0.5);
  expect(geometry.menuTop, `候选盒顶越过视口：${detail}`).toBeGreaterThanOrEqual(-0.5);
  expect(geometry.menuBottom, `候选盒底越过视口：${detail}`).toBeLessThanOrEqual(geometry.viewportHeight + 0.5);
  expect(geometry.clipBottom - geometry.clipTop, `真实 clip 没有高度：${detail}`).toBeGreaterThan(0);
  expect(geometry.optionTop, `高亮项上缘越过真实 clip：${detail}`).toBeGreaterThanOrEqual(geometry.clipTop - 0.5);
  expect(geometry.optionBottom, `高亮项下缘越过真实 clip：${detail}`).toBeLessThanOrEqual(geometry.clipBottom + 0.5);
}

async function outsideScrollPositions(page: Page): Promise<Array<{ node: string; scrollTop: number }>> {
  return page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>(".lumir-hp-skill-menu");
    if (menu === null) throw new Error("skill 菜单不在场，无法确定真实滚动祖先");
    const positions = [{
      node: "document.scrollingElement",
      scrollTop: document.scrollingElement?.scrollTop ?? 0,
    }];
    for (let ancestor = menu.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
      positions.push({
        node: ancestor.className || ancestor.tagName.toLowerCase(),
        scrollTop: ancestor.scrollTop,
      });
    }
    return positions;
  });
}

for (const length of [1, 6, 12]) {
  for (const family of ["arrows", "ctrl"] as const) {
    test(`高亮可见性矩阵：${family} × ${length} 项，首末往返与菜单外零滚动`, async ({ page }) => {
      await setup(page, null, false, undefined, syntheticSkills(length));
      await page.mouse.move(10, 10);
      await page.keyboard.type("/skill");
      const menu = page.locator(".lumir-hp-skill-menu");
      const options = menu.locator("[role=option]");
      await expect(options).toHaveCount(length);
      if (length > 6) {
        const overflow = await menu.evaluate((el) => el.scrollHeight > el.clientHeight);
        expect(overflow, "长列表必须先证明确实溢出，滚动断言才不是空测量").toBe(true);
      }
      const outsideBefore = await outsideScrollPositions(page);
      const down = family === "arrows" ? "ArrowDown" : "Control+n";
      const up = family === "arrows" ? "ArrowUp" : "Control+p";

      for (let step = 0; step < length + 1; step += 1) {
        await page.keyboard.press(down);
        await expectHighlightedVisible(menu);
      }
      await expect(options.last()).toHaveAttribute("aria-selected", "true");
      const atEnd = await menu.evaluate((el) => el.scrollTop);
      await page.keyboard.press(down);
      expect(await menu.evaluate((el) => el.scrollTop), "末项已可见时不得继续滚动").toBe(atEnd);

      for (let step = 0; step < length + 1; step += 1) {
        await page.keyboard.press(up);
        await expectHighlightedVisible(menu);
      }
      await expect(options.first()).toHaveAttribute("aria-selected", "true");
      const atStart = await menu.evaluate((el) => el.scrollTop);
      await page.keyboard.press(up);
      expect(await menu.evaluate((el) => el.scrollTop), "首项已可见时不得继续滚动").toBe(atStart);
      expect(await outsideScrollPositions(page), "揭示 option 不得滚动 document 或任何真实祖先").toEqual(outsideBefore);

      if (length > 6) {
        await menu.evaluate((el) => { el.scrollTop = (el.scrollHeight - el.clientHeight) / 2; });
        const middle = await options.evaluateAll((nodes) => {
          const outer = nodes[0].parentElement!.getBoundingClientRect();
          const index = nodes.findIndex((node) => {
            const rect = node.getBoundingClientRect();
            return rect.top >= outer.top && rect.bottom <= outer.bottom;
          });
          return index;
        });
        expect(middle, "中部窗口必须有一个真实可悬停 option").toBeGreaterThanOrEqual(0);
        await options.nth(middle).hover();
        await expect(options.nth(middle)).toHaveAttribute("aria-selected", "true");
        const visibleMiddleScroll = await menu.evaluate((el) => el.scrollTop);
        await page.keyboard.press(family === "arrows" ? "Control+n" : "ArrowDown");
        await expect(options.nth(middle + 1)).toHaveAttribute("aria-selected", "true");
        await expectHighlightedVisible(menu);
        expect(await menu.evaluate((el) => el.scrollTop), "中部已完整可见项之间移动不得改变 scrollTop").toBe(visibleMiddleScroll);
        expect(await outsideScrollPositions(page)).toEqual(outsideBefore);
      }
    });
  }
}

test("可见最底项再移一项：只滚候选、留一行上下文，且不借祖先滚动", async ({ page }) => {
  await setup(page, null, false, undefined, syntheticSkills(12));
  await page.mouse.move(10, 10);
  await page.keyboard.type("/skill");
  const menu = page.locator(".lumir-hp-skill-menu");
  await expect(menu.locator("[role=option]")).toHaveCount(12);
  expect(await menu.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const outsideBefore = await outsideScrollPositions(page);
  const initial = await menu.evaluate((root) => {
    const options = Array.from(root.querySelectorAll<HTMLElement>("[role=option]"));
    const menuRect = root.getBoundingClientRect();
    const panelRect = root.closest(".lumir-harness")!.getBoundingClientRect();
    const clipBottom = Math.min(menuRect.bottom, panelRect.bottom, window.innerHeight);
    let index = -1;
    options.forEach((option, optionIndex) => {
      if (option.getBoundingClientRect().bottom <= clipBottom + 0.5) index = optionIndex;
    });
    return { index, scrollTop: root.scrollTop, rowHeight: options[0].getBoundingClientRect().height };
  });
  expect(initial.index, "长列表必须有完整的最后一整行可见").toBeGreaterThanOrEqual(3);
  expect(initial.scrollTop).toBe(0);
  for (let step = 0; step < initial.index; step += 1) await page.keyboard.press("ArrowDown");
  await expect(menu.locator("[role=option][aria-selected=true]")).toHaveAttribute("id", `lumir-hp-skill-option-${initial.index}`);
  expect(await menu.evaluate((el) => el.scrollTop), "停在最后一个完整可见行时不得滚动").toBe(0);
  await expectHighlightedVisible(menu);

  await page.keyboard.press("ArrowDown");
  const after = await menu.evaluate((root) => {
    const option = root.querySelector("[role=option][aria-selected=true]")!.getBoundingClientRect();
    const menuRect = root.getBoundingClientRect();
    const panelRect = root.closest(".lumir-harness")!.getBoundingClientRect();
    return {
      scrollTop: root.scrollTop,
      clipBottom: Math.min(menuRect.bottom, panelRect.bottom, window.innerHeight),
      optionBottom: option.bottom,
      rowHeight: option.height,
    };
  });
  // 旧实现：菜单盒高出面板，被裁区里的项仍被判「盒内可见」→ scrollTop 停在 0，选中行在屏外。
  expect(after.scrollTop, "高亮进入裁切带时必须真实滚动候选").toBeGreaterThan(0);
  const context = after.clipBottom - after.optionBottom;
  expect(context, `越界后必须保留一行上下文（实际 ${context}px）`).toBeGreaterThanOrEqual(after.rowHeight - 1);
  expect(context, `越界后不得多滚超过一行（实际 ${context}px）`).toBeLessThanOrEqual(after.rowHeight + 6);
  await expectHighlightedVisible(menu);
  expect(await outsideScrollPositions(page), "揭示不得滚动 document 或任何真实祖先").toEqual(outsideBefore);
});

const SHORT_VIEWPORTS = [
  { theme: "light", width: 1100, height: 560, scale: 1 },
  { theme: "dark", width: 1200, height: 600, scale: 1.5 },
  { theme: "eink", width: 1000, height: 520, scale: 0.8 },
] as const;

for (const item of SHORT_VIEWPORTS) {
  test(`短视口 / 三主题 / 缩放：${item.theme} × ${item.width}×${item.height} × scale ${item.scale}`, async ({ page }) => {
    await page.setViewportSize({ width: item.width, height: item.height });
    await setup(page, null, false, item.theme, syntheticSkills(12));
    await page.locator(".lumir-harness").evaluate((el, scale) => {
      (el as HTMLElement).style.setProperty("--lumir-hp-scale", String(scale));
    }, item.scale);
    await page.mouse.move(10, 10);
    await page.keyboard.type("/skill");
    const menu = page.locator(".lumir-hp-skill-menu");
    await expect(menu.locator("[role=option]")).toHaveCount(12);
    // 短视口下菜单仍必须有可用高度（不是被压成 0 的「可见」）
    expect(await menu.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(40);
    await expectHighlightedVisible(menu);
    for (let step = 0; step < 11; step += 1) {
      await page.keyboard.press("ArrowDown");
      await expectHighlightedVisible(menu);
    }
    await expect(menu.locator("[role=option][aria-selected=true]")).toHaveAttribute("id", "lumir-hp-skill-option-11");
    expect(await menu.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    for (let step = 0; step < 11; step += 1) {
      await page.keyboard.press("ArrowUp");
      await expectHighlightedVisible(menu);
    }
    await expect(menu.locator("[role=option][aria-selected=true]")).toHaveAttribute("id", "lumir-hp-skill-option-0");
    expect(await menu.evaluate((el) => el.scrollTop)).toBe(0);
  });
}


test("静止指针不抢键盘高亮，真实指针移动仍可接管且 option DOM 不重建", async ({ page }) => {
  await setup(page, null, false, undefined, syntheticSkills(12));
  await page.mouse.move(10, 10);
  await page.keyboard.type("/skill");
  const menu = page.locator(".lumir-hp-skill-menu");
  const options = menu.locator("[role=option]");
  await expect(options).toHaveCount(12);
  await options.nth(2).hover();
  await expect(options.nth(2)).toHaveAttribute("aria-selected", "true");
  await menu.evaluate((root) => {
    const w = window as unknown as {
      __skillOptionNodes: Element[];
      __skillOptionMutations: number;
      __skillOptionObserver: MutationObserver;
    };
    w.__skillOptionNodes = Array.from(root.children);
    w.__skillOptionMutations = 0;
    w.__skillOptionObserver = new MutationObserver((records) => {
      w.__skillOptionMutations += records.filter((record) => record.type === "childList").length;
    });
    w.__skillOptionObserver.observe(root, { childList: true });
  });
  const expectStableDom = async (index: number) => {
    await expect(options.nth(index)).toHaveAttribute("aria-selected", "true");
    await page.waitForTimeout(120);
    await expect(options.nth(index)).toHaveAttribute("aria-selected", "true");
    const dom = await menu.evaluate((root) => {
      const w = window as unknown as {
        __skillOptionNodes: Element[];
        __skillOptionMutations: number;
      };
      return {
        mutations: w.__skillOptionMutations,
        sameNodes: Array.from(root.children).every((node, nodeIndex) => node === w.__skillOptionNodes[nodeIndex]),
      };
    });
    expect(dom, "高亮更新不得替换 option，静止指针下也不得持续重建").toEqual({ mutations: 0, sameNodes: true });
  };

  await page.keyboard.press("ArrowDown");
  await expectStableDom(3);
  await page.keyboard.press("Control+n");
  await expectStableDom(4);
  await options.nth(5).hover();
  await expectStableDom(5);
  await page.keyboard.press("ArrowDown");
  await expectStableDom(6);
  await menu.evaluate(() => {
    (window as unknown as { __skillOptionObserver: MutationObserver }).__skillOptionObserver.disconnect();
  });
});

test("指针悬停上缘部分可见项：真实 mousemove 后只滚动菜单到最近可见位置", async ({ page }) => {
  await setup(page, null, false, undefined, syntheticSkills(12));
  await page.mouse.move(10, 10);
  await page.keyboard.type("/skill");
  const menu = page.locator(".lumir-hp-skill-menu");
  await expect(menu.locator("[role=option]")).toHaveCount(12);
  expect(await menu.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const outsideBefore = await outsideScrollPositions(page);
  const target = await menu.evaluate((root) => {
    root.scrollTop = (root.scrollHeight - root.clientHeight) / 2;
    const outer = root.getBoundingClientRect();
    const options = Array.from(root.querySelectorAll<HTMLElement>("[role=option]"));
    const index = options.findIndex((option) => {
      const rect = option.getBoundingClientRect();
      return rect.top < outer.top - 1 && rect.bottom > outer.top + 1;
    });
    if (index < 0) throw new Error("中部窗口没有上缘部分可见 option");
    const rect = options[index].getBoundingClientRect();
    const x = rect.left + Math.min(24, rect.width / 2);
    const y = (Math.max(rect.top, outer.top) + Math.min(rect.bottom, outer.bottom)) / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      index,
      x,
      y,
      hit: hit === null ? null : { id: hit.id, className: hit.className, tagName: hit.tagName },
      outer: { top: outer.top, bottom: outer.bottom },
      option: { top: rect.top, bottom: rect.bottom },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollTop: root.scrollTop,
    };
  });
  const hitOption = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[role=option]")?.id ?? null, target);
  expect(hitOption, `指针坐标必须真实命中部分可见 option：${JSON.stringify(target)}`).toBe(`lumir-hp-skill-option-${target.index}`);
  // 不用 locator.hover()：它会先自动 scrollIntoView，无法区分浏览器自动揭示与产品 mousemove 揭示。
  await page.mouse.move(target.x, target.y);
  await expect(menu.locator("[role=option]").nth(target.index)).toHaveAttribute("aria-selected", "true");
  await expectHighlightedVisible(menu);
  expect(await menu.evaluate((el) => el.scrollTop), "上缘部分可见项应向上作最近揭示").toBeLessThan(target.scrollTop);
  expect(await outsideScrollPositions(page), "指针揭示不得滚动任何真实祖先").toEqual(outsideBefore);
});

const SIZE_VIEWPORTS = [
  { name: "narrow", width: 760, height: 800 },
  { name: "normal", width: 1200, height: 800 },
  { name: "ultrawide", width: 2400, height: 1000 },
] as const;

for (const theme of ["light", "dark", "eink"] as const) {
  for (const viewport of SIZE_VIEWPORTS) {
    test(`Skill 长描述响应式宽度：${theme} / ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await setup(page, null, false, theme, syntheticSkills(2, "LONG-DESCRIPTION-".repeat(12)));
      await page.mouse.move(10, 10);
      await page.keyboard.type("/skill");
      const menu = page.locator(".lumir-hp-skill-menu");
      await expect(menu.locator("[role=option]")).toHaveCount(2);
      const geometry = await menu.evaluate((el) => {
        const host = el.parentElement!.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        return {
          hostLeft: host.left,
          hostRight: host.right,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          avail: Math.max(0, host.width - 16),
          fontSize: Number.parseFloat(getComputedStyle(el).fontSize),
        };
      });
      const expected = Math.min(48 * geometry.fontSize, geometry.avail);
      expect(geometry.width, "长描述应使用 Skill 专用 48em/pane 上限，而不是旧 26em").toBeCloseTo(expected, 1);
      expect(geometry.left).toBeGreaterThanOrEqual(geometry.hostLeft - 1);
      expect(geometry.right).toBeLessThanOrEqual(geometry.hostRight + 1);
      const reviewDir = process.env.LUMIR_SKILL_MENU_REVIEW_DIR;
      if (reviewDir) await page.screenshot({ path: `${reviewDir}/size-${theme}-${viewport.name}.png`, animations: "disabled" });
    });
  }
}

for (const viewport of SIZE_VIEWPORTS) {
  test(`Skill 短内容取得响应式目标宽：${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await setup(page, null, false, "light", syntheticSkills(1, "短"));
    await page.mouse.move(10, 10);
    await page.keyboard.type("/skill");
    const menu = page.locator(".lumir-hp-skill-menu");
    await expect(menu.locator("[role=option]")).toHaveCount(1);
    const geometry = await menu.evaluate((el) => {
      const host = el.parentElement!.getBoundingClientRect();
      return { width: el.getBoundingClientRect().width, avail: Math.max(0, host.width - 16), fontSize: Number.parseFloat(getComputedStyle(el).fontSize) };
    });
    const cap = Math.min(48 * geometry.fontSize, geometry.avail);
    const target = Math.min(Math.max(200, 0.85 * geometry.avail), cap);
    expect(geometry.width, "短内容应随可用空间加宽，同时不超过 48em/pane 上限").toBeCloseTo(target, 1);
  });
}

test("Skill 48em 上限随 --lumir-hp-scale 的字号实际增长", async ({ page }) => {
  const measurements: Array<{ scale: number; fontSize: number; width: number; expected: number; avail: number }> = [];
  for (const scale of [1, 0.8, 1.5]) {
    await page.setViewportSize({ width: 2400, height: 1000 });
    await setup(page, null, false, "light", syntheticSkills(2, "LONG-DESCRIPTION-".repeat(12)));
    await page.locator(".lumir-harness").evaluate((el, value) => {
      (el as HTMLElement).style.setProperty("--lumir-hp-scale", String(value));
    }, scale);
    await page.mouse.move(10, 10);
    await page.keyboard.type("/skill");
    const menu = page.locator(".lumir-hp-skill-menu");
    await expect(menu.locator("[role=option]")).toHaveCount(2);
    measurements.push(await menu.evaluate((el, value) => {
      const host = el.parentElement!.getBoundingClientRect();
      const fontSize = Number.parseFloat(getComputedStyle(el).fontSize);
      const avail = Math.max(0, host.width - 16);
      return {
        scale: value,
        fontSize,
        width: el.getBoundingClientRect().width,
        expected: Math.min(48 * fontSize, avail),
        avail,
      };
    }, scale));
  }
  for (const geometry of measurements) {
    expect(geometry.width, `scale=${geometry.scale} 必须按实际字号计算 48em 并受 pane 夹取`).toBeCloseTo(geometry.expected, 1);
  }
  expect(measurements[1].fontSize).toBeCloseTo(measurements[0].fontSize * 0.8, 5);
  expect(measurements[2].fontSize).toBeCloseTo(measurements[0].fontSize * 1.5, 5);
  expect(measurements[2].avail).toBeGreaterThan(48 * measurements[2].fontSize);
  expect(measurements[2].width, "超宽 pane 中放大字号必须真实放大 em 宽度上限").toBeGreaterThan(measurements[0].width);
  expect(measurements[1].width, "超宽 pane 中缩小字号必须真实缩小 em 宽度上限").toBeLessThan(measurements[0].width);
});

for (const item of [
  { name: "极窄", viewportWidth: 1000, availRange: [100, 180] },
  { name: "200附近", viewportWidth: 1280, availRange: [180, 220] },
] as const) {
  test(`Skill 真实 20% harness 几何：${item.name} avail 不被 CSS 组件下限顶出 pane`, async ({ page }) => {
    await page.setViewportSize({ width: item.viewportWidth, height: 800 });
    await setup(page, null, false, "light", syntheticSkills(1, "短"));
    const divider = page.locator(".pane-divider");
    await expect(divider).toBeVisible();
    const drag = await divider.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const row = el.parentElement!.getBoundingClientRect();
      return {
        startX: box.left + box.width / 2,
        y: box.top + box.height / 2,
        targetX: row.left + row.width * 0.8,
      };
    });
    await page.mouse.move(drag.startX, drag.y);
    await page.mouse.down();
    await page.mouse.move(drag.targetX, drag.y, { steps: 8 });
    await page.mouse.up();
    const split = await page.evaluate(() => {
      const harness = document.querySelector<HTMLElement>(".lumir-harness")!.getBoundingClientRect();
      const row = document.querySelector<HTMLElement>(".pane-divider")!.parentElement!.getBoundingClientRect();
      return { harnessWidth: harness.width, rowWidth: row.width };
    });
    expect(split.harnessWidth / split.rowWidth, "分隔条必须真实到达 harness 20% 档").toBeCloseTo(0.2, 2);

    await page.mouse.move(10, 10);
    await page.keyboard.type("/skill");
    const menu = page.locator(".lumir-hp-skill-menu");
    await expect(menu.locator("[role=option]")).toHaveCount(1);
    const geometry = await menu.evaluate((el) => {
      const host = el.parentElement!.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        hostLeft: host.left,
        hostRight: host.right,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        inlineWidth: Number.parseFloat(el.style.width),
        avail: Math.max(0, host.width - 16),
      };
    });
    expect(geometry.avail, `${item.name} 用例必须落在预定 avail 区间`).toBeGreaterThanOrEqual(item.availRange[0]);
    expect(geometry.avail, `${item.name} 用例必须落在预定 avail 区间`).toBeLessThanOrEqual(item.availRange[1]);
    if (item.name === "极窄") expect(geometry.viewportWidth).toBeLessThan(1080);
    expect(geometry.inlineWidth).toBeLessThanOrEqual(geometry.avail + 1);
    expect(geometry.width, "实际 CSS 宽度不得被 min-width 顶过内联裁决").toBeCloseTo(geometry.inlineWidth, 1);
    expect(geometry.width).toBeLessThanOrEqual(geometry.avail + 1);
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.hostLeft + 7.5);
    expect(geometry.right).toBeLessThanOrEqual(geometry.hostRight - 7.5);
  });
}

// ── 浮层壳背景（Alex 2026-11-24 报告「skill 选择的背景似乎是透明的」） ──────────────
// 合同：`docs/specs/design-tokens-v1.md` §使用规则 2——浮层壳 = `--preview-bg` + 1px
// `--border` + `--shadow-raise`。`--preview-bg` 是**不透底**的色阶档（bg 层级最亮档），
// 半透明或缺失即违反「浮层在内容之上」这条不变量：背后的正文会从浮层里读出来。
//
// 三主题期望值写死而不是拿 `var(--preview-bg)` 自比：token 缺失时两边会同时解析成透明，
// 断言就在「透明 == 透明」上空转（REVIEW.md「读不到当成空」条）。取值来源：
// `src/style.css` 的 token 层 / 同文档 §色彩 token 表。
const PREVIEW_BG: Record<Theme, string> = {
  light: "rgb(255, 255, 255)",
  dark: "rgb(38, 39, 43)",
  eink: "rgb(255, 255, 255)",
};

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** 在菜单背后铺一层 test-only 的实底 + 大号文字（inset:0 覆盖整个 composer 区，
 *  z-index 低于菜单的 40）。菜单只要不透底，这层的任何像素都不该进入菜单区域的截图。
 *  两套配色之间的每个像素都不同，因此「换配色后菜单区域截图是否逐字节相同」就是
 *  「底层有没有穿透」的判据——不依赖 z-index 读数，也不依赖背后恰好有什么产品内容。 */
async function paintBleedProbe(page: Page, background: string, color: string): Promise<void> {
  await page.evaluate(({ background, color }) => {
    const area = document.querySelector<HTMLElement>(".lumir-hp-composer-area");
    if (area === null) throw new Error("composer 区不在场");
    let probe = area.querySelector<HTMLElement>(".skill-bleed-probe");
    if (probe === null) {
      probe = document.createElement("div");
      probe.className = "skill-bleed-probe";
      probe.setAttribute("aria-hidden", "true");
      area.append(probe);
    }
    probe.style.cssText = [
      "position:absolute",
      "inset:0",
      "z-index:0",
      "pointer-events:none",
      "overflow:hidden",
      "word-break:break-all",
      "font:700 22px/24px monospace",
      "padding:4px",
      `background:${background}`,
      `color:${color}`,
    ].join(";");
    probe.textContent = "底层文字穿透探针 BLEEDPROBE ".repeat(120);
  }, { background, color });
}

for (const theme of ["light", "dark", "eink"] as const) {
  test(`Skill 候选浮层背景不透底：${theme} 下等于 --preview-bg 且底层文字不穿透`, async ({ page }) => {
    await setup(page, null, false, theme);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    // 指针先移开，避免菜单在指针下出现 hover 高亮，两张截图之间状态不一致。
    await page.mouse.move(10, 10);
    await page.keyboard.type("/acc");
    const menu = page.locator(".lumir-hp-skill-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator("[role=option]")).toHaveCount(2);

    const box = await menu.boundingBox();
    if (box === null) throw new Error("skill 菜单没有布局盒");
    // 只比面板内部：`r6` 圆角之外与 1px 边框（dark 档是半透明的）本来就不属于浮层的可见面，
    // 它们露出底层是圆角 / 边框的语义，不是「背景透底」。内缩 10px 同时避开两者。
    const inset = 10;
    const clip = {
      x: box.x + inset,
      y: box.y + inset,
      width: box.width - inset * 2,
      height: box.height - inset * 2,
    };
    const shot = () => page.screenshot({ clip, animations: "disabled" });

    // ① 像素判据（主判据）：菜单背后换一套高对比底色 + 文字，菜单区域截图必须逐字节相同。
    await paintBleedProbe(page, "rgb(255, 0, 255)", "rgb(0, 255, 0)");
    const magenta = await shot();
    const magentaAgain = await shot();
    expect(
      sameBytes(magenta, magentaAgain),
      `${theme}：同一底色下两次截图必须逐字节相同（仪器自证）`,
    ).toBe(true);

    await paintBleedProbe(page, "rgb(0, 255, 0)", "rgb(255, 0, 255)");
    const green = await shot();
    expect(
      sameBytes(magenta, green),
      `${theme}：换掉菜单背后的底色/文字后菜单像素必须不变（透底则这里必红）`,
    ).toBe(true);

    // 仪器反证：把浮层背景强制改回透明，同一组对比必须立刻见差异——证明探针确实在菜单
    // 背后、且本判据看得见它（REVIEW.md「断言等价于子串」条：先造一个必须让它 FAIL 的输入）。
    const override = await page.addStyleTag({
      content: ".lumir-hp-skill-menu { background: transparent !important; }",
    });
    const transparent = await shot();
    expect(
      sameBytes(green, transparent),
      `${theme}：强制透明后探针必须可见（否则判据没有区分度）`,
    ).toBe(false);
    await override.evaluate((el) => el.parentNode?.removeChild(el));

    const restored = await shot();
    expect(sameBytes(magenta, restored), `${theme}：撤掉强制透明后回到不透底`).toBe(true);

    // ② 计算值判据：背景 = 该主题的 --preview-bg，且 alpha 必须为 1——钉住承载不透明性的
    //    具体 token（像素判据只判「不透底」，判不出用了哪一档底色）。
    const background = await menu.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background, `${theme}：浮层背景必须等于 --preview-bg`).toBe(PREVIEW_BG[theme]);
    const alpha = background.startsWith("rgba(")
      ? Number(background.slice(background.lastIndexOf(",") + 1, -1))
      : 1;
    expect(alpha, `${theme}：浮层背景必须完全不透明`).toBe(1);
  });
}


// ── 机械核验 F1：武装态只接受**无修饰**的 Enter / Tab（delta「武装时无修饰的 Enter / Tab」）──
// 全名自动武装与显式导航两路都要证明：Shift / Alt 组合保持原义，不会被候选吞成一次 Skill 调用。
async function armSkillMenuBy(page: Page, mode: "全名" | "导航"): Promise<void> {
  if (mode === "全名") {
    await page.keyboard.type("/tmp-acc");
  } else {
    await page.keyboard.type("/acc");
    await page.keyboard.press("ArrowDown");
  }
}

async function composerDoc(page: Page): Promise<string> {
  return page.evaluate(() => (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view.state.doc.toString());
}

const ARMED_DOC = { 全名: "/tmp-acc", 导航: "/acc" } as const;

for (const mode of ["全名", "导航"] as const) {
  test(`武装态（${mode}）Shift+Enter 仍插入换行，不创建 Skill 引用`, async ({ page }) => {
    await setup(page);
    const composer = page.locator(".lumir-hp-composer .cm-content");
    const menu = page.locator(".lumir-hp-skill-menu");
    await page.mouse.move(10, 10);
    await armSkillMenuBy(page, mode);
    await expect(menu).toHaveAttribute("data-armed", "true");
    await page.keyboard.press("Shift+Enter");
    expect(await composerDoc(page), "Shift+Enter 必须换行而不是接受候选").toBe(`${ARMED_DOC[mode]}\n`);
    await expect(composer.locator(".lumir-hp-skill-ref")).toHaveCount(0);
    expect(await sent(page)).toEqual([]);
    await expect(menu).toBeHidden();
  });

  test(`武装态（${mode}）Shift+Tab 仍回退焦点，不创建 Skill 引用`, async ({ page }) => {
    await setup(page);
    const composer = page.locator(".lumir-hp-composer .cm-content");
    const menu = page.locator(".lumir-hp-skill-menu");
    await page.mouse.move(10, 10);
    await armSkillMenuBy(page, mode);
    await expect(menu).toHaveAttribute("data-armed", "true");
    await page.keyboard.press("Shift+Tab");
    await expect(composer).not.toBeFocused();
    await expect(menu).toBeHidden();
    await expect(composer).toHaveText(ARMED_DOC[mode]);
    await expect(composer.locator(".lumir-hp-skill-ref")).toHaveCount(0);
    expect(await sent(page)).toEqual([]);
    const keys = await page.evaluate(() => (window as unknown as { __keyDefaults: any[] }).__keyDefaults);
    expect(keys.at(-1)).toMatchObject({ key: "Tab", prevented: false, shiftKey: true });
  });

  test(`武装态（${mode}）Alt+Enter 不被候选接受，按既有 Enter 语义发送纯文本`, async ({ page }) => {
    await setup(page);
    const menu = page.locator(".lumir-hp-skill-menu");
    await page.mouse.move(10, 10);
    await armSkillMenuBy(page, mode);
    await expect(menu).toHaveAttribute("data-armed", "true");
    await page.keyboard.press("Alt+Enter");
    await expect.poll(async () => (await sent(page)).length).toBe(1);
    expect((await sent(page))[0].skills_json, "Alt+Enter 不得被候选解释成接受").toBe("[]");
    await expect(menu).toBeHidden();
  });
}

// ── 机械核验 F2 / F7：下方放置不得压控制行；上翻不得盖 caret，优先收缩 max-height ──
async function overlayGeometry(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".lumir-hp-skill-menu");
    if (root === null) throw new Error("候选不在场");
    const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
    const caret = view.coordsAtPos(view.state.selection.main.head);
    const panel = root.closest(".lumir-harness")!.getBoundingClientRect();
    const ctl = root.closest(".lumir-hp-composer-area")!.querySelector(".lumir-hp-ctl")!.getBoundingClientRect();
    const rect = root.getBoundingClientRect();
    return {
      menuTop: rect.top,
      menuBottom: rect.bottom,
      menuHeight: rect.height,
      panelTop: panel.top,
      panelBottom: panel.bottom,
      ctlTop: ctl.top,
      ctlBottom: ctl.bottom,
      caretTop: caret === null ? null : caret.top,
      caretBottom: caret === null ? null : caret.bottom,
      inlineMaxHeight: root.style.maxHeight,
      computedMaxHeight: getComputedStyle(root).maxHeight,
      overflow: root.scrollHeight > root.clientHeight,
    };
  });
}

test("候选不覆盖控制行：下方放不下的单选项与长列表都不得压住 .lumir-hp-ctl", async ({ page }) => {
  for (const length of [1, 12]) {
    await setup(page, null, false, undefined, syntheticSkills(length));
    await page.mouse.move(10, 10);
    await page.keyboard.type("/skill");
    const menu = page.locator(".lumir-hp-skill-menu");
    await expect(menu.locator("[role=option]")).toHaveCount(length);
    const geometry = await overlayGeometry(page);
    const detail = JSON.stringify(geometry);
    expect(geometry.ctlTop, `控制行不在场：${detail}`).toBeGreaterThan(0);
    expect(geometry.menuBottom, `候选压住控制行：${detail}`).toBeLessThanOrEqual(geometry.ctlTop + 0.5);
    expect(geometry.menuTop, `候选盒顶越出面板：${detail}`).toBeGreaterThanOrEqual(geometry.panelTop - 0.5);
    expect(geometry.menuBottom, `候选盒底越出面板：${detail}`).toBeLessThanOrEqual(geometry.panelBottom + 0.5);
    if (geometry.caretTop !== null && geometry.menuTop < geometry.caretTop) {
      expect(geometry.menuBottom, `上翻时盒底盖住 caret：${detail}`).toBeLessThanOrEqual(geometry.caretTop + 0.5);
    }
  }
});

test("候选下方放置：空间足够时贴在 caret 下方，盒底止于控制行顶缘之上", async ({ page }) => {
  // caret 停在第 1 行、下面还有 3 行：单选项在 caret 到控制行之间放得下 → 走下方分支。
  await setup(page, { version: 3, text: "\n\n\n", caret: 0, cards: [], skills: [] }, false, undefined, syntheticSkills(1));
  await page.mouse.move(10, 10);
  await page.keyboard.type("/skill");
  const menu = page.locator(".lumir-hp-skill-menu");
  await expect(menu.locator("[role=option]")).toHaveCount(1);
  const geometry = await overlayGeometry(page);
  const detail = JSON.stringify(geometry);
  expect(geometry.caretBottom, `caret 不在场：${detail}`).not.toBeNull();
  expect(geometry.menuTop, `下方空间足够时应放在 caret 下方：${detail}`).toBeGreaterThanOrEqual(geometry.caretBottom!);
  expect(geometry.menuBottom, `下方放置越过控制行顶缘：${detail}`).toBeLessThanOrEqual(geometry.ctlTop + 0.5);
  expect(geometry.menuBottom, `候选盒底越出面板：${detail}`).toBeLessThanOrEqual(geometry.panelBottom + 0.5);
});

test("短视口上翻：优先收缩候选 max-height，盒底不盖 caret、盒顶不越面板", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 320 });
  await setup(page, null, false, undefined, syntheticSkills(12));
  await page.mouse.move(10, 10);
  await page.keyboard.type("/skill");
  const menu = page.locator(".lumir-hp-skill-menu");
  await expect(menu.locator("[role=option]")).toHaveCount(12);
  const geometry = await overlayGeometry(page);
  const detail = JSON.stringify(geometry);
  expect(geometry.caretTop, `caret 不在场：${detail}`).not.toBeNull();
  expect(geometry.overflow, "长列表必须真实溢出，滚动断言才不是空测量").toBe(true);
  expect(geometry.menuTop, `上方空间不足时应上翻：${detail}`).toBeLessThan(geometry.caretTop!);
  expect(geometry.menuBottom, `上翻后盒底盖住 caret：${detail}`).toBeLessThanOrEqual(geometry.caretTop! + 0.5);
  expect(geometry.menuTop, `盒顶越出面板：${detail}`).toBeGreaterThanOrEqual(geometry.panelTop - 0.5);
  expect(geometry.menuHeight, `上翻空间不足时必须收缩 max-height：${detail}`).toBeLessThan(200);
  expect(geometry.menuHeight, `收缩后仍须保留至少一行可用高度：${detail}`).toBeGreaterThanOrEqual(20);
});

test("候选 max-height 以 CSS 为单一真源：改 CSS 后 JS 不得按旧常量放宽", async ({ page }) => {
  // 该视口下面板容量约 197px（< 200）：按 200 常量判定的实现会把 CSS 的 90px 覆盖成 197px。
  await page.setViewportSize({ width: 1000, height: 280 });
  await setup(page, null, false, undefined, syntheticSkills(12));
  await page.addStyleTag({ content: ".lumir-hp-skill-menu { max-height: 90px; }" });
  await page.mouse.move(10, 10);
  await page.keyboard.type("/skill");
  const menu = page.locator(".lumir-hp-skill-menu");
  await expect(menu.locator("[role=option]")).toHaveCount(12);
  const geometry = await overlayGeometry(page);
  const detail = JSON.stringify(geometry);
  // 用例前提：面板容量落在 (CSS 上限, 200) 之间——按 200 常量判定的实现会写 inline 上限覆盖 CSS。
  const capacity = geometry.panelBottom - geometry.panelTop - 16;
  expect(capacity, `面板容量必须大于 CSS 上限：${detail}`).toBeGreaterThan(90);
  expect(capacity, `面板容量必须小于旧常量 200：${detail}`).toBeLessThan(200);
  expect(geometry.overflow, "长列表必须真实溢出，max-height 断言才不是空测量").toBe(true);
  expect(geometry.computedMaxHeight, `CSS 上限未被读到：${detail}`).toBe("90px");
  expect(geometry.menuHeight, `候选高度越过 CSS 上限：${detail}`).toBeLessThanOrEqual(90.5);
});

// ── 机械核验 F4：compositionend 之后只重算一次（次数，不是最终态）──
test("IME compositionend 只重算一次：文档回写与 settle 不得各重建一遍", async ({ page }) => {
  await setup(page);
  const composer = page.locator(".lumir-hp-composer .cm-content");
  const menu = page.locator(".lumir-hp-skill-menu");
  await page.keyboard.type("/tmp");
  await expect(menu).toBeVisible();
  await composer.evaluate((el) => {
    const view = (el as any).cmTile.root.view;
    const observer = view.observer;
    const host = document.querySelector(".lumir-hp-skill-menu") as HTMLElement;
    const append = host.append.bind(host);
    const probe = { pending: true, refreshes: 0, checks: 0 };
    (window as any).__skillImeProbe = probe;
    const originalPending = observer.pendingRecords.bind(observer);
    observer.pendingRecords = () => {
      probe.checks += 1;
      return probe.pending ? [{}] : originalPending();
    };
    // renderSkillMenu = replaceChildren() 清空后逐项 append：每轮只数第一项；
    // hideSkillMenu 的空 replaceChildren 不算重算。
    host.append = (...nodes: Array<Node | string>) => {
      if (host.children.length === 0 && nodes.length > 0) probe.refreshes += 1;
      return append(...nodes);
    };
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    // 组合结束后的文档回写（CM 的真实 flush 时序）：此刻同步重算一次。
    Object.defineProperty(view, "compositionStarted", { value: false, configurable: true });
    view.dispatch({ changes: { from: 4, insert: "-acc" }, selection: { anchor: 8 }, userEvent: "input.compose" });
  });
  const immediate = await page.evaluate(() => (window as any).__skillImeProbe);
  expect(immediate.refreshes, "settle 放行前最多一次同步重算").toBeLessThanOrEqual(1);
  const checksBefore = immediate.checks;
  await page.evaluate(() => { (window as any).__skillImeProbe.pending = false; });
  await expect(menu).toHaveAttribute("data-armed", "true");
  await page.waitForTimeout(80);
  const after = await page.evaluate(() => (window as any).__skillImeProbe);
  expect(after.checks, "settle 必须真的重试过，否则次数断言是空测").toBeGreaterThan(checksBefore);
  expect(after.refreshes, "compositionend 之后只能重算一次").toBe(1);
  expect(await composerDoc(page)).toBe("/tmp-acc");
});

// ── 机械核验 F9：技能全名恰好是 tmp 时 /tmp 按全名规则武装（批准规则的明确边界）──
test("技能全名恰好是 tmp 时 /tmp 直接武装并接受", async ({ page }) => {
  await setup(page, null, false, undefined, [
    { name: "tmp", description: "全名恰为路径样式", source: "vault", user_invocable: true, model_invocable: true, invocation_valid: true },
  ]);
  const composer = page.locator(".lumir-hp-composer .cm-content");
  const menu = page.locator(".lumir-hp-skill-menu");
  await page.mouse.move(10, 10);
  await page.keyboard.type("/tmp");
  await expect(menu).toHaveAttribute("data-armed", "true");
  await expect(menu.locator("[role=option]")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(composer).toHaveText("/tmp ");
  await expect(composer.locator(".lumir-hp-skill-ref")).toHaveCount(1);
  expect(await sent(page)).toEqual([]);
});

// ── 机械复核 R1：短视口收缩态连续导航，已完整可见的步不得改变 scrollTop ──────────
// `placeSkillMenu` 每拍都先清 inline max-height 读自然高度；清空的一瞬菜单展开，浏览器会把
// scrollTop 钳到新的 maxScroll。恢复收缩高度后若高亮行仍在新带内，reveal 判「已可见」不回滚，
// 净效果是列表内容下移（C3「带内不动」被破坏）。旧实现实测 320px / 12 项、↑ 10→9 时 234→190。
async function skillMenuNavState(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".lumir-hp-skill-menu");
    if (root === null) throw new Error("候选不在场");
    const panelRect = root.closest(".lumir-harness")!.getBoundingClientRect();
    const menuRect = root.getBoundingClientRect();
    const clipTop = Math.max(menuRect.top, panelRect.top, 0);
    const clipBottom = Math.min(menuRect.bottom, panelRect.bottom, window.innerHeight);
    const options = Array.from(root.querySelectorAll<HTMLElement>("[role=option]"));
    return {
      selected: options.findIndex((option) => option.getAttribute("aria-selected") === "true"),
      scrollTop: root.scrollTop,
      menuHeight: menuRect.height,
      overflows: root.scrollHeight > root.clientHeight,
      clipTop,
      clipBottom,
      rows: options.map((option) => {
        const rect = option.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      }),
    };
  });
}

test("短视口收缩态连续 ↓/↑ 各 11 拍：已完整可见的步 scrollTop 不得改变", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 320 });
  await setup(page, null, false, undefined, syntheticSkills(12));
  await page.mouse.move(10, 10);
  await page.keyboard.type("/skill");
  const menu = page.locator(".lumir-hp-skill-menu");
  await expect(menu.locator("[role=option]")).toHaveCount(12);
  let state = await skillMenuNavState(page);
  const opened = JSON.stringify(state);
  // 用例前提：视口真的逼出了收缩 + 溢出，否则「清上限再恢复」这条路径没被走到。
  expect(state.menuHeight, `短视口必须触发收缩：${opened}`).toBeLessThan(200);
  expect(state.overflows, `长列表必须真实溢出，scrollTop 断言才不是空测量：${opened}`).toBe(true);
  const steps: string[] = [];
  for (const [key, delta] of [["ArrowDown", 1], ["ArrowUp", -1]] as const) {
    for (let step = 1; step <= 11; step += 1) {
      const target = state.selected + delta;
      expect(target, `${key} 第 ${step} 拍越界：导航必须到端停住`).toBeGreaterThanOrEqual(0);
      expect(target, `${key} 第 ${step} 拍越界：导航必须到端停住`).toBeLessThanOrEqual(11);
      const before = state;
      const wasVisible = before.rows[target].top >= before.clipTop - 0.5
        && before.rows[target].bottom <= before.clipBottom + 0.5;
      await page.keyboard.press(key);
      state = await skillMenuNavState(page);
      const label = `${key} #${step} target=${target} scrollTop ${before.scrollTop}→${state.scrollTop}`
        + ` clip ${state.clipTop}..${state.clipBottom}`;
      steps.push(label);
      expect(state.selected, `${key} 第 ${step} 拍必须移到目标项（${label}）`).toBe(target);
      expect(state.rows[target].top, `目标上缘越出可见带（${label}）`).toBeGreaterThanOrEqual(state.clipTop - 0.5);
      expect(state.rows[target].bottom, `目标下缘越出可见带（${label}）`).toBeLessThanOrEqual(state.clipBottom + 0.5);
      if (wasVisible) {
        // C3：按键前目标已完整可见 ⇒ 揭示不得改动 scrollTop（清空 max-height 的钳制也不许漏出来）。
        expect(
          Math.abs(state.scrollTop - before.scrollTop),
          `已完整可见的步不得改变 scrollTop（${label}；steps=${steps.join(" | ")}）`,
        ).toBeLessThanOrEqual(0.5);
      }
    }
  }
  expect(state.selected, "↑ 11 拍必须回到首项").toBe(0);
});

// ── 机械复核 R2：max-height 百分比等非 px 计算值不得被 parseFloat 当作 px ─────────
// 90% 的包含块是 composer 区（约 141px）⇒ CSS 上限约 127px，上方可用约 100px。
// 旧实现读 parseFloat("90%") = 90，把本可用的 100px 压成 90px；C3 之外的尺寸真源也被误读。
test("候选 max-height 为百分比时按实测高度收缩，不得把百分数当 px", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 264 });
  await setup(page, null, false, undefined, syntheticSkills(12));
  await page.addStyleTag({ content: ".lumir-hp-skill-menu { max-height: 90%; }" });
  // 打开前（尚无 inline 收缩值）computed 必须是非 px 的百分比：这条用例判的就是它的解析。
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".lumir-hp-skill-menu")!).maxHeight),
    "前提失败：CSS 声明的 max-height 必须是非 px 的百分比").toMatch(/^\d+(\.\d+)?%$/);
  await page.mouse.move(10, 10);
  await page.keyboard.type("/skill");
  const menu = page.locator(".lumir-hp-skill-menu");
  await expect(menu.locator("[role=option]")).toHaveCount(12);
  const geometry = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".lumir-hp-skill-menu")!;
    const parent = root.offsetParent as HTMLElement;
    const panel = root.closest(".lumir-harness")!.getBoundingClientRect();
    const ctl = root.closest(".lumir-hp-composer-area")!.querySelector(".lumir-hp-ctl")!.getBoundingClientRect();
    const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
    const caret = view.coordsAtPos(view.state.selection.main.head)!;
    const rect = root.getBoundingClientRect();
    return {
      computedMaxHeight: getComputedStyle(root).maxHeight,
      inlineMaxHeight: root.style.maxHeight,
      menuHeight: rect.height,
      menuTop: rect.top,
      menuBottom: rect.bottom,
      caretTop: caret.top,
      caretBottom: caret.bottom,
      panelTop: panel.top,
      panelBottom: panel.bottom,
      ctlTop: ctl.top,
      percentCap: parent.getBoundingClientRect().height * 0.9,
      aboveSpace: caret.top - 4 - (Math.max(panel.top, 0) + 8),
      belowSpace: Math.min(Math.min(panel.bottom, window.innerHeight) - 8, ctl.top - 4) - (caret.bottom + 4),
      overflow: root.scrollHeight > root.clientHeight,
    };
  });
  const detail = JSON.stringify(geometry);
  // 打开后 inline 收缩值覆盖 computed——这里判的是「收缩到多少」，不是 computed 的字符串形态。
  expect(geometry.inlineMaxHeight, `收缩分支必须写入 inline 上限：${detail}`).toMatch(/^\d+(\.\d+)?px$/);
  expect(geometry.overflow, `长列表必须真实溢出：${detail}`).toBe(true);
  expect(geometry.percentCap, `百分比上限必须高于百分数的数字部分：${detail}`).toBeGreaterThan(95);
  expect(geometry.aboveSpace, `收缩分支前提：上方可用空间须大于误读值 90：${detail}`).toBeGreaterThan(95);
  expect(geometry.aboveSpace, `收缩分支前提：可用空间须小于 CSS 百分比上限：${detail}`)
    .toBeLessThan(geometry.percentCap - 1);
  expect(geometry.menuHeight, `候选被误读的 90px 压扁：${detail}`).toBeGreaterThan(95);
  expect(geometry.menuHeight, `候选高度不得超过可用空间与 CSS 上限：${detail}`)
    .toBeLessThanOrEqual(Math.min(geometry.aboveSpace, geometry.percentCap) + 0.5);
  expect(geometry.menuHeight, `候选必须用尽可用空间而不是提前收缩：${detail}`)
    .toBeGreaterThanOrEqual(Math.min(geometry.aboveSpace, geometry.percentCap) - 1.5);
  expect(geometry.menuBottom, `盒底盖住 caret：${detail}`).toBeLessThanOrEqual(geometry.caretTop + 0.5);
});

// ── 机械复核 R3：状态去重与几何重排分开——resize / 同状态回包仍须重排，但不重建 items ──
async function skillMenuPlacement(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".lumir-hp-skill-menu");
    if (root === null) throw new Error("候选不在场");
    const panelRect = root.closest(".lumir-harness")!.getBoundingClientRect();
    const ctl = root.closest(".lumir-hp-composer-area")!.querySelector(".lumir-hp-ctl")!.getBoundingClientRect();
    const menuRect = root.getBoundingClientRect();
    const option = root.querySelector<HTMLElement>("[role=option][aria-selected=true]");
    if (option === null) throw new Error("没有高亮 option");
    const optionRect = option.getBoundingClientRect();
    const clipTop = Math.max(menuRect.top, panelRect.top, 0);
    const clipBottom = Math.min(menuRect.bottom, panelRect.bottom, window.innerHeight);
    return {
      menuTop: menuRect.top,
      menuBottom: menuRect.bottom,
      menuHeight: menuRect.height,
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      ctlTop: ctl.top,
      clipTop,
      clipBottom,
      optionTop: optionRect.top,
      optionBottom: optionRect.bottom,
      scrollTop: root.scrollTop,
      inlineMaxHeight: root.style.maxHeight,
      overflow: root.scrollHeight > root.clientHeight,
      maxScroll: root.scrollHeight - root.clientHeight,
    };
  });
}

/** 重排的机器化边界：只许动几何（style），不许动 items、游标与 ARIA（C2「重排不得改动游标」）。
 *  `styleWrites` 证明这次重排真的跑过——几何与旧位置恰好相同时，菜单位置不变不等于没重排。 */
async function skillMenuA11ySnapshot(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".lumir-hp-skill-menu")!;
    const options = Array.from(root.querySelectorAll<HTMLElement>("[role=option]"));
    const content = document.querySelector<HTMLElement>(".lumir-hp-composer .cm-content")!;
    return {
      optionIds: options.map((option) => option.id),
      selected: options.map((option) => option.getAttribute("aria-selected")),
      armed: root.getAttribute("data-armed"),
      activeDescendant: content.getAttribute("aria-activedescendant"),
    };
  });
}

async function installSkillMenuDomProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".lumir-hp-skill-menu")!;
    const w = window as unknown as Record<string, any>;
    const content = document.querySelector<HTMLElement>(".lumir-hp-composer .cm-content")!;
    const options = Array.from(root.querySelectorAll<HTMLElement>("[role=option]"));
    w.__skillNodes = Array.from(root.children);
    w.__skillMutations = 0;
    w.__skillStyleWrites = 0;
    w.__skillA11y = {
      optionIds: options.map((option) => option.id),
      selected: options.map((option) => option.getAttribute("aria-selected")),
      armed: root.getAttribute("data-armed"),
      activeDescendant: content.getAttribute("aria-activedescendant"),
    };
    w.__skillObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList") w.__skillMutations += 1;
        if (record.type === "attributes" && record.attributeName === "style") w.__skillStyleWrites += 1;
      }
    });
    w.__skillObserver.observe(root, { childList: true, attributes: true, attributeFilter: ["style"] });
  });
}

async function readSkillMenuDomProbe(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".lumir-hp-skill-menu")!;
    const content = document.querySelector<HTMLElement>(".lumir-hp-composer .cm-content")!;
    const w = window as unknown as Record<string, any>;
    const options = Array.from(root.querySelectorAll<HTMLElement>("[role=option]"));
    const result = {
      mutations: w.__skillMutations as number,
      styleWrites: w.__skillStyleWrites as number,
      sameNodes: Array.from(root.children).every((node, index) => node === w.__skillNodes[index]),
      a11yBefore: w.__skillA11y,
      a11y: {
        optionIds: options.map((option) => option.id),
        selected: options.map((option) => option.getAttribute("aria-selected")),
        armed: root.getAttribute("data-armed"),
        activeDescendant: content.getAttribute("aria-activedescendant"),
      },
    };
    w.__skillObserver.disconnect();
    return result;
  });
}

test("窗口缩放后候选重排到新 clip：不重建 items，高亮仍在带内", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await setup(page, null, false, undefined, syntheticSkills(12));
  await page.mouse.move(10, 10);
  await page.keyboard.type("/skill");
  const menu = page.locator(".lumir-hp-skill-menu");
  await expect(menu.locator("[role=option]")).toHaveCount(12);
  const before = await skillMenuPlacement(page);
  expect(before.menuHeight, `前提：800px 下候选不被收缩：${JSON.stringify(before)}`).toBeGreaterThan(190);
  await installSkillMenuDomProbe(page);
  await page.setViewportSize({ width: 1000, height: 320 });
  // 旧实现没有 resize 重放：菜单停在旧位置，盒顶越出面板（实测 menuTop 7 < panelTop 42）。
  await expect.poll(async () => {
    const geometry = await skillMenuPlacement(page);
    return geometry.menuTop >= geometry.panelTop - 0.5 && geometry.menuBottom <= geometry.panelBottom + 0.5;
  }, { timeout: 3000, message: "resize 后候选必须重排到新 clip 内" }).toBe(true);
  const after = await skillMenuPlacement(page);
  const detail = JSON.stringify(after);
  expect(after.menuBottom, `盒底越过控制行：${detail}`).toBeLessThanOrEqual(after.ctlTop + 0.5);
  expect(after.menuHeight, `短视口必须收缩 max-height：${detail}`).toBeLessThan(200);
  expect(after.optionTop, `高亮上缘越出可见带：${detail}`).toBeGreaterThanOrEqual(after.clipTop - 0.5);
  expect(after.optionBottom, `高亮下缘越出可见带：${detail}`).toBeLessThanOrEqual(after.clipBottom + 0.5);
  const probe = await readSkillMenuDomProbe(page);
  expect({ mutations: probe.mutations, sameNodes: probe.sameNodes }, "resize 重排不得重建 items")
    .toEqual({ mutations: 0, sameNodes: true });
  expect(probe.styleWrites, "resize 后必须真的重排几何（样式未被重写 = 没重排）").toBeGreaterThan(0);
  expect(probe.a11y, "重排不得改动游标 / 武装 / aria-activedescendant").toEqual(probe.a11yBefore);
});

test("同状态回包不重建 items，但仍须重排几何", async ({ page }) => {
  await setup(page, null, false, undefined, syntheticSkills(12));
  await page.mouse.move(10, 10);
  await page.keyboard.type("/skill");
  const menu = page.locator(".lumir-hp-skill-menu");
  await expect(menu.locator("[role=option]")).toHaveCount(12);
  await installSkillMenuDomProbe(page);
  const dispatched = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".lumir-hp-skill-menu")!;
    root.style.top = "3000px";
    const staleTop = root.getBoundingClientRect().top;
    const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
    const head = view.state.selection.main.head;
    view.dispatch({ changes: { from: view.state.doc.length, insert: "x" }, selection: { anchor: head } });
    return { doc: view.state.doc.toString(), staleTop, top: root.getBoundingClientRect().top };
  });
  // 前提：插入点落在 token 之后，token / 游标 / items 不变 —— 走的正是同状态去重路径。
  expect(dispatched.doc, "同状态前提：token 不得被这次回包改写").toBe("/skillx");
  expect(dispatched.staleTop, "同状态前提：陈旧 top 必须真的写进去了").toBeGreaterThan(1000);
  await expect.poll(async () => (await skillMenuPlacement(page)).menuTop, {
    timeout: 3000,
    message: "同状态同步必须仍重排几何（陈旧 top 不得保留）",
  }).toBeLessThan(1000);
  const after = await skillMenuPlacement(page);
  const detail = JSON.stringify(after);
  expect(after.menuTop, `盒顶越出面板：${detail}`).toBeGreaterThanOrEqual(after.panelTop - 0.5);
  expect(after.menuBottom, `盒底越出面板：${detail}`).toBeLessThanOrEqual(after.panelBottom + 0.5);
  expect(after.menuBottom, `盒底越过控制行：${detail}`).toBeLessThanOrEqual(after.ctlTop + 0.5);
  expect(after.optionTop, `高亮上缘越出可见带：${detail}`).toBeGreaterThanOrEqual(after.clipTop - 0.5);
  expect(after.optionBottom, `高亮下缘越出可见带：${detail}`).toBeLessThanOrEqual(after.clipBottom + 0.5);
  expect(after.scrollTop, "几何与游标都没变，揭示不得改动 scrollTop").toBe(0);
  const probe = await readSkillMenuDomProbe(page);
  expect({ mutations: probe.mutations, sameNodes: probe.sameNodes }, "同状态同步不得重建 items")
    .toEqual({ mutations: 0, sameNodes: true });
  expect(probe.styleWrites, "同状态同步必须真的重排几何（样式未被重写 = 没重排）").toBeGreaterThan(0);
  expect(probe.a11y, "同状态重排不得改动游标 / 武装 / aria-activedescendant").toEqual(probe.a11yBefore);
});

// ── 机械复核 N1：几何重排与「主动揭示」分开——重排不得把用户手动滚开的阅读位置拉回高亮项 ──
// 合同（selector-contract C2/C3）：没有游标变化的重排只许动几何；揭示只在游标改变、或原本完整可见
// 的游标被新几何挤出带时发生。旧实现（8c1fa6b8）同状态回包与 resize 都无条件 reveal，实测把
// 手动滚到的 scrollTop 140 拉回 0——用户滚开去看别的行，一次 IME settle / 窗口缩放就弹回首项。
const skillMenuStyleWrites = (page: Page) =>
  page.evaluate(() => (window as unknown as Record<string, any>).__skillStyleWrites as number);

async function scrollSkillMenuAway(page: Page) {
  const before = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".lumir-hp-skill-menu")!;
    root.scrollTop = 140;
    const option = root.querySelector<HTMLElement>("[role=option][aria-selected=true]")!;
    const menuRect = root.getBoundingClientRect();
    const panelRect = root.closest(".lumir-harness")!.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    return {
      scrollTop: root.scrollTop,
      menuTop: menuRect.top,
      overflow: root.scrollHeight > root.clientHeight,
      maxScroll: root.scrollHeight - root.clientHeight,
      clipTop: Math.max(menuRect.top, panelRect.top, 0),
      optionBottom: optionRect.bottom,
    };
  });
  const detail = JSON.stringify(before);
  expect(before.overflow, `前提：长列表必须真实溢出，滚动断言才不是空测量：${detail}`).toBe(true);
  expect(before.maxScroll, `前提：滚动余量必须容得下手动位置：${detail}`).toBeGreaterThan(140);
  expect(before.scrollTop, `前提：手动滚动必须真的生效：${detail}`).toBeGreaterThan(100);
  expect(before.optionBottom, `前提：高亮项必须被滚出可见带：${detail}`).toBeLessThan(before.clipTop);
  return before;
}

test("同状态回包只重排几何：用户手动滚开的候选不得被拉回高亮项", async ({ page }) => {
  // 320px 视口下候选必被收缩：inline max-height 每拍都被清空重写，「重排真的跑过」可机器观测。
  await page.setViewportSize({ width: 1000, height: 320 });
  await setup(page, null, false, undefined, syntheticSkills(20));
  await page.mouse.move(10, 10);
  await page.keyboard.type("/skill");
  const menu = page.locator(".lumir-hp-skill-menu");
  await expect(menu.locator("[role=option]")).toHaveCount(20);
  await installSkillMenuDomProbe(page);
  const before = await scrollSkillMenuAway(page);
  const doc = await page.evaluate(() => {
    const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
    const head = view.state.selection.main.head;
    view.dispatch({ changes: { from: view.state.doc.length, insert: "x" }, selection: { anchor: head } });
    return view.state.doc.toString();
  });
  // 前提：插入点落在 token 之后，token / 游标 / items 不变 —— 走的正是同状态去重路径。
  expect(doc, "同状态前提：token / 游标 / items 不得被这次回包改写").toBe("/skillx");
  await expect.poll(() => skillMenuStyleWrites(page), {
    timeout: 3000,
    message: "同状态同步必须仍重排几何（样式未被重写 = 没重排）",
  }).toBeGreaterThan(0);
  const after = await skillMenuPlacement(page);
  const probe = await readSkillMenuDomProbe(page);
  const detail = `${JSON.stringify(before)} => ${JSON.stringify(after)}`;
  expect(Math.abs(after.scrollTop - before.scrollTop),
    `同状态回包不得改动用户手动滚动的 scrollTop（${detail}）`).toBeLessThanOrEqual(0.5);
  expect(after.menuTop, `同状态回包仍须把盒放回面板内：${detail}`).toBeGreaterThanOrEqual(after.panelTop - 0.5);
  expect(after.menuBottom, `同状态回包仍须把盒放回面板内：${detail}`).toBeLessThanOrEqual(after.panelBottom + 0.5);
  expect({ mutations: probe.mutations, sameNodes: probe.sameNodes }, "同状态同步不得重建 items")
    .toEqual({ mutations: 0, sameNodes: true });
  expect(probe.a11y, "同状态重排不得改动游标 / 武装 / aria-activedescendant").toEqual(probe.a11yBefore);
});

test("窗口缩放不得把用户手动滚开的候选拉回高亮项", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await setup(page, null, false, undefined, syntheticSkills(20));
  await page.mouse.move(10, 10);
  await page.keyboard.type("/skill");
  const menu = page.locator(".lumir-hp-skill-menu");
  await expect(menu.locator("[role=option]")).toHaveCount(20);
  await installSkillMenuDomProbe(page);
  const before = await scrollSkillMenuAway(page);
  // 缩到 320：候选必须收缩，inline max-height 会被清空再写回——这就是「重排真的跑过」的证据。
  // 菜单是绝对定位，单纯随布局平移不产生样式写入，不能拿 menuTop 变化当重排证据。
  await page.setViewportSize({ width: 1000, height: 320 });
  await expect.poll(() => skillMenuStyleWrites(page), {
    timeout: 3000,
    message: "窗口缩放后必须重排几何（样式未被重写 = 没重排）",
  }).toBeGreaterThan(0);
  const after = await skillMenuPlacement(page);
  const probe = await readSkillMenuDomProbe(page);
  const detail = `${JSON.stringify(before)} => ${JSON.stringify(after)}`;
  expect(after.menuHeight, `前提：缩放必须触发收缩，重排路径才真的被走到：${detail}`).toBeLessThan(200);
  expect(Math.abs(after.scrollTop - before.scrollTop),
    `窗口缩放不得改动用户手动滚动的 scrollTop（${detail}）`).toBeLessThanOrEqual(0.5);
  expect(after.scrollTop, `窗口缩放不得借重排回弹到高亮首项（${detail}）`).toBeGreaterThan(100);
  expect({ mutations: probe.mutations, sameNodes: probe.sameNodes }, "缩放重排不得重建 items")
    .toEqual({ mutations: 0, sameNodes: true });
  expect(probe.a11y, "缩放重排不得改动游标 / 武装 / aria-activedescendant").toEqual(probe.a11yBefore);
});

// ── 机械复核 N5：if-clipped 的正分支——原本完整可见、被新几何挤出带 ⇒ 必须揭示 ──────
// 现有「不拉回」用例只覆盖反分支（用户滚开 ⇒ 不动）。本用例把高亮项停在可见带底部，
// 再收缩视口把带缩短：高亮项在几何变化前完整可见，变化后必须被揭示回新带内。
test("高亮项原本贴底完整可见、视口收缩把带缩短后必须揭示", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 340 });
  await setup(page, null, false, undefined, syntheticSkills(20));
  await page.mouse.move(10, 10);
  await page.keyboard.type("/skill");
  const menu = page.locator(".lumir-hp-skill-menu");
  await expect(menu.locator("[role=option]")).toHaveCount(20);
  // 往下走到高亮项贴住带底：每次游标揭示都留一行上下文，连续下移后高亮项落在带底附近。
  for (let index = 0; index < 6; index += 1) await page.keyboard.press("ArrowDown");
  await expect(menu.locator("[role=option][aria-selected=true]")).toContainText("skill-06");
  const before = await skillMenuPlacement(page);
  const beforeDetail = JSON.stringify(before);
  expect(before.overflow, `前提：候选必须真实溢出，揭示断言才不是空测量：${beforeDetail}`).toBe(true);
  expect(before.optionTop, `前提：高亮项上缘必须完整可见：${beforeDetail}`).toBeGreaterThanOrEqual(before.clipTop - 0.5);
  expect(before.optionBottom, `前提：高亮项下缘必须完整可见：${beforeDetail}`).toBeLessThanOrEqual(before.clipBottom + 0.5);
  await installSkillMenuDomProbe(page);
  await page.setViewportSize({ width: 1000, height: 240 });
  await expect.poll(async () => (await skillMenuPlacement(page)).menuHeight, {
    timeout: 3000,
    message: "视口收缩后候选必须真的缩短（高度未变 = 没重排）",
  }).toBeLessThan(before.menuHeight - 20);
  const after = await skillMenuPlacement(page);
  const detail = `${beforeDetail} => ${JSON.stringify(after)}`;
  console.log("SKILL_N5", detail);
  expect(after.clipBottom - after.clipTop, `前提：新可见带仍须容得下一行：${detail}`).toBeGreaterThan(26);
  expect(after.optionTop, `高亮项被新几何挤出带（if-clipped 正分支必须揭示）：${detail}`).toBeGreaterThanOrEqual(after.clipTop - 0.5);
  expect(after.optionBottom, `高亮项被新几何挤出带（if-clipped 正分支必须揭示）：${detail}`).toBeLessThanOrEqual(after.clipBottom + 0.5);
  const probe = await readSkillMenuDomProbe(page);
  expect({ mutations: probe.mutations, sameNodes: probe.sameNodes }, "收缩重排不得重建 items")
    .toEqual({ mutations: 0, sameNodes: true });
  expect(probe.styleWrites, "收缩后必须真的重排几何（样式未被重写 = 没重排）").toBeGreaterThan(0);
});

// ── 机械复核 N2：max-height 的 em / vh 实测路径 ────────────────────────────────
// percentage 是 R2 的代表形态（computed 保留 %）；em / vh 在 computed 里已由浏览器解析成 px，
// JS 只许用「清空 inline 后实测的受约束高度」。旧 parseFloat 实现会把 7em 读成 7px、30vh 读成 30px。
for (const [label, css, numeric] of [["em", "7em", 7], ["vh", "30vh", 30]] as const) {
  test(`候选 max-height 为 ${label} 时按实测受约束高度收缩`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await setup(page, null, false, undefined, syntheticSkills(12));
    await page.addStyleTag({ content: `.lumir-hp-skill-menu { max-height: ${css}; }` });
    const cssCap = await page.evaluate(() => Number.parseFloat(
      getComputedStyle(document.querySelector(".lumir-hp-skill-menu")!).maxHeight));
    // 前提：CSS 上限必须远高于字符串里的数字，否则「把数字当 px」的实现也能碰巧通过。
    expect(cssCap, `前提：${css} 必须解析成远大于 ${numeric}px 的高度`).toBeGreaterThan(numeric * 2);
    await page.mouse.move(10, 10);
    await page.keyboard.type("/skill");
    const menu = page.locator(".lumir-hp-skill-menu");
    await expect(menu.locator("[role=option]")).toHaveCount(12);
    const geometry = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(".lumir-hp-skill-menu")!;
      const rect = root.getBoundingClientRect();
      return {
        menuHeight: rect.height,
        inlineMaxHeight: root.style.maxHeight,
        overflow: root.scrollHeight > root.clientHeight,
      };
    });
    const detail = JSON.stringify({ ...geometry, cssCap });
    expect(geometry.overflow, `长列表必须真实溢出，max-height 断言才不是空测量：${detail}`).toBe(true);
    expect(geometry.menuHeight, `候选被字符串里的数字压扁：${detail}`).toBeLessThanOrEqual(cssCap + 0.5);
    expect(geometry.menuHeight, `候选必须用满 CSS 上限而不是提前收缩：${detail}`)
      .toBeGreaterThanOrEqual(cssCap - 1.5);
    expect(geometry.inlineMaxHeight, `上限来自 CSS，可用空间足够时不得写入 inline 收缩值：${detail}`).toBe("");
  });
}
