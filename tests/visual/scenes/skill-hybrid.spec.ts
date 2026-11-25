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
      if (["n", "p", "Enter", "Tab"].includes(event.key)) w.__keyDefaults.push({ key: event.key, prevented: event.defaultPrevented });
    });
  }, { skills: catalog, providers: standardProviders(), draft, deferCatalog });
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
  // 在菜单打开前移开指针，确保首次 ArrowDown 从无 hover 的被动态进入键盘选择。
  await page.mouse.move(10, 10);
  await page.keyboard.type("/acc");
  await expect(menu.locator("[role=option]")).toHaveCount(2);
  await expect(composer).not.toHaveAttribute("aria-activedescendant", /.*/);
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

test("候选打开时 ⌃N/⌃P 与方向键同路选择，消费事件且 composer 文档/caret 不变", async ({ page }) => {
  for (const item of [
    { key: "Control+n", arrow: "ArrowDown", selected: 0 },
    { key: "Control+p", arrow: "ArrowUp", selected: 1 },
  ] as const) {
    await setup(page);
    await page.mouse.move(10, 10);
    await page.keyboard.type("abcdef");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("xy");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("/acc");
    const menu = page.locator(".lumir-hp-skill-menu");
    await expect(menu.locator("[role=option]")).toHaveCount(2);
    const before = await page.evaluate(() => {
      const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
      return { head: view.state.selection.main.head, doc: view.state.doc.toString() };
    });
    await page.keyboard.press(item.arrow);
    await expect(menu.locator("[role=option][aria-selected=true]")).toHaveAttribute("id", `lumir-hp-skill-option-${item.selected}`);
    const arrowDoc = await page.evaluate(() => (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view.state.doc.toString());
    expect(arrowDoc).toBe(before.doc);

    await setup(page);
    await page.mouse.move(10, 10);
    await page.keyboard.type("abcdef");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("xy");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("/acc");
    await expect(menu.locator("[role=option]")).toHaveCount(2);
    await page.keyboard.press(item.key);
    await expect(menu).toBeVisible();
    await expect(menu.locator("[role=option][aria-selected=true]")).toHaveAttribute("id", `lumir-hp-skill-option-${item.selected}`);
    const after = await page.evaluate(() => {
      const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
      return { head: view.state.selection.main.head, doc: view.state.doc.toString() };
    });
    expect(after).toEqual(before);
    const keys = await page.evaluate(() => (window as unknown as { __keyDefaults: any[] }).__keyDefaults);
    expect(keys.find((event) => event.key === item.key.at(-1))?.prevented).toBe(true);
  }
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
  await page.keyboard.type("acc");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __skillCalls: number }).__skillCalls)).toBe(1);
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

test("⌃⇧N/P 保留扩选：候选关闭但事件不被消费", async ({ page }) => {
  await setup(page);
  await page.keyboard.type("/acc");
  const menu = page.locator(".lumir-hp-skill-menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Control+Shift+p");
  await expect(menu).toBeHidden();
  const state = await page.evaluate(() => {
    const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
    const main = view.state.selection.main;
    return { anchor: main.anchor, head: main.head, doc: view.state.doc.toString() };
  });
  expect(state).toEqual({ anchor: 4, head: 0, doc: "/acc" });
  const keys = await page.evaluate(() => (window as unknown as { __keyDefaults: any[] }).__keyDefaults);
  expect(keys.at(-1)?.prevented).toBe(false);
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

async function expectHighlightedVisible(menu: ReturnType<Page["locator"]>): Promise<void> {
  const selected = menu.locator("[role=option][aria-selected=true]");
  await expect(selected).toHaveCount(1);
  const geometry = await menu.evaluate((root) => {
    const option = root.querySelector("[role=option][aria-selected=true]");
    if (option === null) throw new Error("没有高亮 option");
    const outer = root.getBoundingClientRect();
    const inner = option.getBoundingClientRect();
    return { outerTop: outer.top, outerBottom: outer.bottom, innerTop: inner.top, innerBottom: inner.bottom };
  });
  expect(geometry.innerTop).toBeGreaterThanOrEqual(geometry.outerTop - 1);
  expect(geometry.innerBottom).toBeLessThanOrEqual(geometry.outerBottom + 1);
}

async function outsideScrollPositions(page: Page): Promise<number[]> {
  return page.evaluate(() => [
    document.scrollingElement?.scrollTop ?? 0,
    document.querySelector<HTMLElement>(".lumir-hp-transcript")?.scrollTop ?? 0,
    document.querySelector<HTMLElement>(".lumir-hp-composer")?.scrollTop ?? 0,
  ]);
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
      expect(await outsideScrollPositions(page), "揭示 option 不得滚动整页、transcript 或 composer").toEqual(outsideBefore);

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
        await page.keyboard.press(family === "arrows" ? "Control+n" : "ArrowDown");
        await expect(options.nth(middle + 1)).toHaveAttribute("aria-selected", "true");
        await expectHighlightedVisible(menu);
        expect(await outsideScrollPositions(page)).toEqual(outsideBefore);
      }
    });
  }
}

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
