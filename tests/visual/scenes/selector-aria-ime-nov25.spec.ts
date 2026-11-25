import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture, type VaultListRow } from "./tauri-stub";

// 选择器浮层（大纲 / vault）的键盘、ARIA 与焦点口径（change fix-selector-ime-aria-nov25）。
//
// 判据分层：本文件跑 chromium 的真实 DOM，钉「组合期事件序 / ARIA 归属 / Tab 可达性 / 关闭后的
// 焦点去向」；真机 WKWebView 层由验收场景 13 / 17 复跑（IME 组合期与 AX 可发现性只有真机能终审）。
// 合同居所是 docs/specs/selector-contract.md（并行 change 拥有；本 change 只引用、不复制条款）。
//
// 先红后绿：本文件先于实现落地，在旧实现上逐条判红后留证（.local/probes/selector-ime-aria-nov25/），
// 再改 src/toc.ts / src/vault-switcher.ts。断言必须能区分两版实现——「浮层还开着」这类恒真句
// 不单独使用，每条都落在具体条目、属性或计算值上（REVIEW.md「断言等价于子串」条）。

const DOC = `# 第一部分
第一部分说明段落。

## 甲小节
甲小节正文。

### 甲小节细节
细节正文。

## 乙小节
乙小节正文。

### 乙小节细节
乙小节细节正文。
`;

/** 注册表：失效行在前（后端把不可用项沉底，这里刻意不按那个顺序写，顺带钉「前端不重排」）。 */
const REGISTRY: VaultListRow[] = [
  { id: "vault-gone", path: "/Volumes/ext/gone", name: "gone-vault", available: false, last_opened_at: null, tab_count: 0 },
  { id: "fixture-vault", path: "/Users/alex/demo-vault", name: "demo-vault", available: true, last_opened_at: 1757000002000, tab_count: 2 },
  { id: "fv-notes", path: "/Users/alex/notes-vault", name: "notes-vault", available: true, last_opened_at: 1757000001000, tab_count: 0 },
  { id: "fv-sandbox", path: "/Users/alex/sandbox-vault", name: "sandbox-vault", available: true, last_opened_at: 1757000000000, tab_count: 0 },
];

const VAULT: VaultFixture = {
  entries: [{ path: "toc.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "toc.md": DOC },
  links: {},
  vaults: REGISTRY,
};

async function openToc(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="toc.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("正文");
  await page.locator(".modeline-section").click();
  await expect(page.locator(".lumir-toc")).toBeVisible();
}

async function openSwitcher(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator(".ft-vault").click();
  await expect(page.locator(".vault-row").first()).toBeVisible();
}

/** 持焦元素的可读标识（真实 DOM 焦点，不用自报状态）。 */
async function activeElement(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null) return "none";
    const classes = el.className === "" ? "" : `.${String(el.className).split(/\s+/).join(".")}`;
    return `${el.tagName.toLowerCase()}${classes}`;
  });
}

/** 记录 focusin 序列：用于判「被动关闭有没有把焦点拽回编辑器」（焦点最终值会被浏览器的
 *  默认动作覆盖，只看 activeElement 分不出「拽过去又放开」与「从没拽过」）。 */
async function installFocusLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __focusLog: string[] };
    w.__focusLog = [];
    document.addEventListener(
      "focusin",
      (event) => {
        const target = event.target as HTMLElement | null;
        if (target === null) return;
        const classes = target.className === "" ? "" : `.${String(target.className).split(/\s+/).join(".")}`;
        w.__focusLog.push(`${target.tagName.toLowerCase()}${classes}`);
      },
      true,
    );
  });
}

async function focusLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __focusLog: string[] }).__focusLog);
}

/** 组合开始 + 中间串 + 组合期按键（不结束组合）。 */
async function composeKeys(
  page: Page,
  selector: string,
  options: { mid: string; keys?: string[]; keyCode229?: string[] },
): Promise<void> {
  await page.locator(selector).evaluate((el, opts) => {
    const input = el as HTMLInputElement;
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input.value = opts.mid;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: opts.mid, isComposing: true }));
    for (const key of opts.keys ?? []) {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, isComposing: true }),
      );
    }
    for (const key of opts.keyCode229 ?? []) {
      // Safari / 旧 WebKit 的旧口径：keyCode 229 表示「输入法正在处理」。KeyboardEventInit
      // 不保证接受 keyCode，直接在实例上覆盖以复现该分支。
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      Object.defineProperty(event, "keyCode", { value: 229 });
      input.dispatchEvent(event);
    }
  }, options);
}

/** 组合结束：提交最终串；真实引擎随后还会补发一次 `isComposing=false` 的 input。 */
async function composeEnd(
  page: Page,
  selector: string,
  options: { final: string; trailingInput?: boolean },
): Promise<void> {
  await page.locator(selector).evaluate((el, opts) => {
    const input = el as HTMLInputElement;
    input.value = opts.final;
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: opts.final }));
    if (opts.trailingInput !== false) input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }, options);
}

/** 完整组合序列（组合期无按键时用）。 */
async function compose(
  page: Page,
  selector: string,
  options: { mid: string; final: string },
): Promise<void> {
  await composeKeys(page, selector, { mid: options.mid });
  await composeEnd(page, selector, { final: options.final });
}

/** 统计浮层列表的重建次数（组合结束只允许刷新一次）。产品用 `list.replaceChildren()` 重建，
 *  钩住它比数 DOM mutation 稳定：一次重建恰一次调用。 */
async function installRebuildCounter(page: Page, listClass: string): Promise<void> {
  await page.evaluate((className) => {
    const w = window as unknown as { __rebuilds: number; __rebuildsHooked?: boolean };
    w.__rebuilds = 0;
    if (w.__rebuildsHooked === true) return;
    const proto = Element.prototype as unknown as { replaceChildren: (...nodes: Node[]) => void };
    const original = proto.replaceChildren;
    proto.replaceChildren = function (this: Element, ...nodes: Node[]) {
      if (this instanceof HTMLElement && this.classList.contains(className)) w.__rebuilds += 1;
      return original.apply(this, nodes);
    };
    w.__rebuildsHooked = true;
  }, listClass);
}

async function resetRebuilds(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __rebuilds: number }).__rebuilds = 0;
  });
}

async function rebuilds(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __rebuilds: number }).__rebuilds);
}

// ---------------------------------------------------------------------------
// 大纲浮层
// ---------------------------------------------------------------------------

test("大纲：组合期的 ↑↓ / Enter 不移动游标、不接受（isComposing 与 keyCode 229 两条守卫）", async ({ page }) => {
  await openToc(page);
  const popover = page.locator(".lumir-toc");
  const active = page.locator(".lumir-toc-item.is-active");
  // 打开时游标 = 当前段（文档首 → 第一部分）
  await expect(active).toHaveText("第一部分");

  await composeKeys(page, ".lumir-toc-input", {
    mid: "甲",
    keys: ["ArrowDown", "Enter"],
    keyCode229: ["ArrowDown"],
  });

  // 组合期：游标不动（旧实现会被两条 ArrowDown 各推一步）
  await expect(active).toHaveText("第一部分");
  // 组合期 Enter 不跳转：浮层仍开着、焦点仍在输入框
  await expect(popover).toBeVisible();
  expect(await activeElement(page)).toBe("input.lumir-toc-input");

  // 组合结束才按最终串刷新：结果集收窄、游标落在首条命中
  await composeEnd(page, ".lumir-toc-input", { final: "乙", trailingInput: false });
  await expect(popover).toBeVisible();
  await expect(active).toHaveText("乙小节");
});

test("大纲：组合结束按最终串只刷新一次列表", async ({ page }) => {
  await openToc(page);
  await installRebuildCounter(page, "lumir-toc-list");
  await resetRebuilds(page);

  await compose(page, ".lumir-toc-input", { mid: "甲", final: "乙" });

  // 最终串生效：只剩乙小节两条
  await expect(page.locator(".lumir-toc-item")).toHaveText(["乙小节", "乙小节细节"]);
  // 旧实现：compositionend 一次 + 紧随的 input 一次 = 2；本条要求在旧实现上判红
  expect(await rebuilds(page)).toBe(1);
});

test("大纲：aria-selected 只表示键盘游标，当前段用 aria-current，option / activedescendant 闭合", async ({ page }) => {
  await openToc(page);
  const items = page.locator(".lumir-toc-item");
  const input = page.locator(".lumir-toc-input");
  const selected = page.locator('.lumir-toc-item[aria-selected="true"]');
  const current = page.locator('.lumir-toc-item[aria-current="true"]');

  await expect(items).toHaveCount(5);
  // 打开时游标 = 当前段：两个属性同时落在第一部分上，但语义分开
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveText("第一部分");
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("第一部分");
  await expect(page.locator(".lumir-toc-list")).toHaveAttribute("id", "lumir-toc-list");
  await expect(input).toHaveAttribute("aria-controls", "lumir-toc-list");

  // option 的 id 唯一且非空；activedescendant 指向真实存在的 option
  const ids = await items.evaluateAll((els) => els.map((el) => el.id));
  expect(ids.every((id) => id.length > 0)).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  const activeId = await selected.getAttribute("id");
  await expect(input).toHaveAttribute("aria-activedescendant", activeId as string);

  // 游标移开后：当前段只剩 aria-current，游标只剩 aria-selected（两态可区分）
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".lumir-toc-item.is-active")).toHaveText("甲小节");
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveText("甲小节");
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("第一部分");
  await expect(current).toHaveAttribute("aria-selected", "false");
  await expect(selected).toHaveAttribute("aria-current", "false");
  const movedId = await selected.getAttribute("id");
  await expect(input).toHaveAttribute("aria-activedescendant", movedId as string);
});

test("大纲：点浮层外是被动关闭（不抢焦点）、Esc 是主动关闭；hover 不清掉游标标记", async ({ page }) => {
  await openToc(page);
  const popover = page.locator(".lumir-toc");
  const active = page.locator(".lumir-toc-item.is-active");

  // hover 游标行：底色仍是选中带（--sel），不是 hover 底色（--hover）
  const background = () => active.evaluate((el) => getComputedStyle(el).backgroundColor);
  const before = await background();
  await active.hover();
  expect(await background()).toBe(before);
  await expect(active).toHaveCSS("box-shadow", /.+/);

  // 主动关闭：Esc 把焦点交还编辑器
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(page.locator(".cm-content")).toBeFocused();

  // 被动关闭：点浮层外不把焦点拽回编辑器（焦点归用户刚点的目标）
  await page.locator(".modeline-section").click();
  await expect(popover).toBeVisible();
  await installFocusLog(page);
  await page.locator(".pane-filetree").evaluate((el) => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  await expect(popover).toBeHidden();
  const editorFocus = (await focusLog(page)).filter((entry) => entry.includes("cm-content"));
  expect(editorFocus, "被动关闭 MUST NOT 聚焦编辑器").toEqual([]);
  expect(await activeElement(page)).not.toContain("cm-content");
});

// ---------------------------------------------------------------------------
// vault 切换器浮层
// ---------------------------------------------------------------------------

test("vault：组合期的 ↑↓ / Enter 不移动游标、不切换（isComposing 与 keyCode 229 两条守卫）", async ({ page }) => {
  await openSwitcher(page);
  const popover = page.locator(".vault-pop");
  const active = page.locator(".vault-row.is-active");

  await expect(active.locator(".vault-row-name")).toHaveText("demo-vault");
  await composeKeys(page, ".vault-filter", {
    mid: "not",
    keys: ["ArrowDown", "Enter"],
    keyCode229: ["ArrowDown"],
  });

  // 组合期：游标不动、没有发起切换
  await expect(active.locator(".vault-row-name")).toHaveText("demo-vault");
  await expect(popover).toBeVisible();
  expect(await activeElement(page)).toBe("input.vault-filter");
  await expect(page.locator(".ft-vault-name")).toHaveText("demo-vault");

  // 组合结束才按最终串刷新
  await composeEnd(page, ".vault-filter", { final: "notes", trailingInput: false });
  await expect(popover).toBeVisible();
  await expect(page.locator(".vault-row")).toHaveCount(1);
  await expect(active.locator(".vault-row-name")).toHaveText("notes-vault");
});

test("vault：组合结束按最终串只刷新一次列表", async ({ page }) => {
  await openSwitcher(page);
  await installRebuildCounter(page, "vault-list");
  await resetRebuilds(page);

  await compose(page, ".vault-filter", { mid: "b", final: "s" });

  await expect(page.locator(".vault-row .vault-row-name")).toHaveText(["notes-vault", "sandbox-vault"]);
  expect(await rebuilds(page)).toBe(1);
});

test("vault：aria-selected 只表示键盘游标，当前 vault 用 aria-current，失效行有 id 但不进游标空间", async ({ page }) => {
  await openSwitcher(page);
  const input = page.locator(".vault-filter");
  const rows = page.locator(".vault-row");
  const selected = page.locator('.vault-row[aria-selected="true"]');
  const current = page.locator('.vault-row[aria-current="true"]');

  await expect(rows).toHaveCount(4);
  // 打开时游标 = 当前 vault；当前 vault 的标记是 ✓ / 「当前」/ aria-current，不是 aria-selected
  await expect(selected).toHaveCount(1);
  await expect(selected.locator(".vault-row-name")).toHaveText("demo-vault");
  await expect(current).toHaveCount(1);
  await expect(current.locator(".vault-row-name")).toHaveText("demo-vault");
  await expect(current.locator(".vault-row-flag")).toHaveText("当前");
  await expect(current.locator(".vault-dot")).toHaveText("✓");

  // 每个 option（含失效行）都有唯一 id；activedescendant 只指向可用行
  const ids = await rows.evaluateAll((els) => els.map((el) => el.id));
  expect(ids.every((id) => id.length > 0), "每个 option 都要有 id").toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  const missingId = await page.locator(".vault-row.is-missing").getAttribute("id");
  const activeId = await selected.getAttribute("id");
  await expect(input).toHaveAttribute("aria-activedescendant", activeId as string);
  expect(activeId).not.toBe(missingId);

  // 游标下移：aria-selected 跟着游标走，当前 vault 只留 aria-current
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("notes-vault");
  await expect(selected).toHaveCount(1);
  await expect(selected.locator(".vault-row-name")).toHaveText("notes-vault");
  await expect(current).toHaveCount(1);
  await expect(current.locator(".vault-row-name")).toHaveText("demo-vault");
  await expect(current).toHaveAttribute("aria-selected", "false");
  await expect(selected).toHaveAttribute("aria-current", "false");

  // 当前项被筛掉：游标落在首条命中，aria-selected 跟着它，而不是「没有游标」
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("notes");
  await expect(rows).toHaveCount(1);
  await expect(selected).toHaveCount(1);
  await expect(selected.locator(".vault-row-name")).toHaveText("notes-vault");

  // 只剩失效行：没有可用游标，aria-selected 一条都不剩；失效行仍有 id 且不进游标空间
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("gone");
  await expect(rows).toHaveCount(1);
  await expect(rows.locator(".vault-row-name")).toHaveText(["gone-vault"]);
  await expect(selected).toHaveCount(0);
  await expect(input).not.toHaveAttribute("aria-activedescendant", /.+/);
  await expect(page.locator(".vault-row.is-missing")).toHaveAttribute("id", /.+/);
});

test("vault：行与删除钮不进 Tab 遍历、Tab 不被消费；hover 不清掉游标；关闭的焦点口径", async ({ page }) => {
  await openSwitcher(page);
  const popover = page.locator(".vault-pop");
  const input = page.locator(".vault-filter");
  const active = page.locator(".vault-row.is-active");

  // 行按钮与删除钮都不进 Tab 序列（listbox 内的原生 button 会导致不可预测遍历）
  for (const row of await page.locator(".vault-row").all()) {
    await expect(row).toHaveAttribute("tabindex", "-1");
  }
  for (const del of await page.locator(".vault-row-del").all()) {
    await expect(del).toHaveAttribute("tabindex", "-1");
  }

  // hover 游标行：底色仍是选中带，不是 hover 底色
  const background = () => active.evaluate((el) => getComputedStyle(el).backgroundColor);
  const before = await background();
  await active.hover();
  expect(await background()).toBe(before);
  await input.click();

  // Tab 不被消费，且焦点按 DOM 顺序落到「新增 vault…」（不是行 / 删除钮）；
  // 第二次 Tab 离开浮层 → 被动收起。
  await page.evaluate(() => {
    const w = window as unknown as { __tabPrevented: boolean | null };
    w.__tabPrevented = null;
    window.addEventListener("keydown", (event) => {
      if (event.key === "Tab") w.__tabPrevented = event.defaultPrevented;
    });
  });
  await page.keyboard.press("Tab");
  await expect(page.locator(".vault-add")).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { __tabPrevented: boolean | null }).__tabPrevented)).toBe(
    false,
  );
  await expect(popover).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(popover).toBeHidden();

  // 主动关闭：Esc 交还编辑器焦点
  await page.locator(".ft-vault").click();
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(page.locator(".cm-content")).toBeFocused();

  // 被动关闭：点浮层外不把焦点拽回编辑器
  await page.locator(".ft-vault").click();
  await expect(popover).toBeVisible();
  await installFocusLog(page);
  await page.locator(".pane-filetree").evaluate((el) => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  await expect(popover).toBeHidden();
  const editorFocus = (await focusLog(page)).filter((entry) => entry.includes("cm-content"));
  expect(editorFocus, "被动关闭 MUST NOT 聚焦编辑器").toEqual([]);
});
