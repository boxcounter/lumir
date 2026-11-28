import { expect, test, type Page } from "@playwright/test";
import { invokes, remapCalls, stubTauri, type VaultFixture, type VaultListRow } from "./tauri-stub";

// 选择器浮层（大纲 / vault）的键盘、ARIA 与焦点口径（change fix-selector-ime-aria-nov25）。
//
// 判据分层：本文件跑 chromium 的真实 DOM，钉「组合期事件序 / ARIA 归属 / Tab 可达性 / 关闭后的
// 焦点去向」；真机 WKWebView 层由验收场景 13 / 17 复跑关闭与 Tab，IME 组合期与 AX 可发现性只
// 有真机能终审（手工复核）。
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

/** 当前 vault 恰好失效：注册表把当前 vault 行标成不可用（外置盘拔出 / 目录改名）。
 *  「失效」是可用性，「当前」是身份——两者同时为真，是 aria-current + aria-disabled 的组合现场。 */
const MISSING_CURRENT: VaultFixture = {
  ...VAULT,
  vaults: [
    { id: "fixture-vault", path: "/Volumes/ext/demo-vault", name: "demo-vault", available: false, last_opened_at: 1757000002000, tab_count: 2 },
    { id: "fv-notes", path: "/Users/alex/notes-vault", name: "notes-vault", available: true, last_opened_at: 1757000001000, tab_count: 0 },
  ],
};

/** 「重新定位…」的落点（vault_open 在重映射门返回的候选 + 选中后的完整 fixture）。
 *  Enter 落在失效行上走的是这条链，不是「切换已注册 vault」。 */
const MOVED_ROOT = "/Users/alex/moved-vault";
const MOVED_VAULT: VaultFixture & { root: string } = {
  root: MOVED_ROOT,
  entries: [{ path: "moved.md", kind: "file", size: 8, mtime_ms: 0 }],
  files: { "moved.md": "# Moved\n\n重定位后的 vault。\n" },
  vault_id: "vault-gone",
  remapCandidates: [{ id: "vault-gone", path: MOVED_ROOT }],
};

async function openToc(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="toc.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("正文");
  await page.locator(".modeline-section").click();
  await expect(page.locator(".lumir-toc")).toBeVisible();
}

async function openSwitcherWith(page: Page, fixture: VaultFixture): Promise<void> {
  await stubTauri(page, fixture);
  await page.goto("/");
  await page.locator(".ft-vault").click();
  await expect(page.locator(".vault-row").first()).toBeVisible();
}

async function openSwitcher(page: Page): Promise<void> {
  await openSwitcherWith(page, VAULT);
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

/** 一个元素的「前景 vs 实际背景」对比度（WCAG 2.1 相对亮度比）。
 *
 *  背景按祖先链逐层 alpha 合成（dark 的 `--sel` 是半透明白；只读一层的 `backgroundColor`
 *  会拿到 `rgba(...)`，与前景算比值没有意义）；前景自身若半透明也先合成到背景上。 */
async function contrastRatioOf(
  page: Page,
  selector: string,
): Promise<{ ratio: number; color: string; background: string }> {
  return page.locator(selector).evaluate((el) => {
    interface Rgba {
      r: number;
      g: number;
      b: number;
      a: number;
    }
    const parse = (value: string): Rgba => {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(value);
      if (m === null) throw new Error(`无法解析颜色：${value}`);
      return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
    };
    const over = (top: Rgba, bottom: Rgba): Rgba => ({
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: 1,
    });
    const layers: Rgba[] = [];
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg.a > 0) layers.push(bg);
    }
    let background: Rgba = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i -= 1) background = over(layers[i] as Rgba, background);
    const style = getComputedStyle(el);
    const color = over(parse(style.color), background);
    const luminance = (c: Rgba): number => {
      const channel = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    };
    const front = luminance(color);
    const back = luminance(background);
    return {
      ratio: (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05),
      color: style.color,
      background: style.backgroundColor,
    };
  });
}

/** 组合期可派发的按键：裸 key，或带 ctrlKey / metaKey 的 chord（`⌃N` / `⌃P` / `⌘A` 与
 *  `↑` / `↓` 共用同一条组合期守卫）。 */
type ComposeKey = string | { key: string; ctrlKey?: boolean; metaKey?: boolean };

/** 组合开始 + 中间串 + 组合期按键（不结束组合）。返回每个按键的 `defaultPrevented`——组合期
 *  MUST NOT 消费就地键：只看「游标没动」分不出「浮层让路」与「浮层接了但没生效」，这个读数与它
 *  成对才构成区分度（同一条键在组合期外必须为 true，见各用例的后半段）。 */
async function composeKeys(
  page: Page,
  selector: string,
  options: { mid: string; keys?: ComposeKey[]; keyCode229?: ComposeKey[] },
): Promise<Array<{ key: string; prevented: boolean }>> {
  return page.locator(selector).evaluate((el, opts) => {
    const input = el as HTMLInputElement;
    const sent: Array<{ key: string; prevented: boolean }> = [];
    const norm = (raw: string | { key: string; ctrlKey?: boolean; metaKey?: boolean }): {
      key: string;
      ctrlKey: boolean;
      metaKey: boolean;
    } => (typeof raw === "string" ? { key: raw, ctrlKey: false, metaKey: false } : { ctrlKey: false, metaKey: false, ...raw });
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input.value = opts.mid;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: opts.mid, isComposing: true }));
    for (const raw of opts.keys ?? []) {
      const key = norm(raw);
      const event = new KeyboardEvent("keydown", {
        key: key.key,
        bubbles: true,
        cancelable: true,
        isComposing: true,
        ctrlKey: key.ctrlKey,
        metaKey: key.metaKey,
      });
      input.dispatchEvent(event);
      sent.push({ key: event.key, prevented: event.defaultPrevented });
    }
    for (const raw of opts.keyCode229 ?? []) {
      const key = norm(raw);
      // Safari / 旧 WebKit 的旧口径：keyCode 229 表示「输入法正在处理」。KeyboardEventInit
      // 不保证接受 keyCode，直接在实例上覆盖以复现该分支。
      const event = new KeyboardEvent("keydown", {
        key: key.key,
        bubbles: true,
        cancelable: true,
        ctrlKey: key.ctrlKey,
        metaKey: key.metaKey,
      });
      Object.defineProperty(event, "keyCode", { value: 229 });
      input.dispatchEvent(event);
      sent.push({ key: event.key, prevented: event.defaultPrevented });
    }
    return sent;
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

/** 键盘事件在窗口冒泡末端的 `defaultPrevented` 读数：判「输入面有没有显式接管该键」。
 *  只看选区分不出「产品接管了」与「webview 原生默认行为顺手做了」——后者在 WKWebView 上不成立
 *  （用户实测的 ⌘A 缺陷正是这条差异）。 */
async function installKeyConsumptionLog(
  page: Page,
  match: { key: string; meta?: boolean },
): Promise<void> {
  await page.evaluate((m) => {
    const w = window as unknown as { __keyLog: Array<{ key: string; prevented: boolean }> };
    w.__keyLog = [];
    window.addEventListener("keydown", (event) => {
      if (event.key !== m.key) return;
      if ((m.meta === true) !== event.metaKey) return;
      w.__keyLog.push({ key: event.key, prevented: event.defaultPrevented });
    });
  }, match);
}

async function keyConsumptionLog(page: Page): Promise<Array<{ key: string; prevented: boolean }>> {
  return page.evaluate(
    () => (window as unknown as { __keyLog: Array<{ key: string; prevented: boolean }> }).__keyLog,
  );
}

/** 输入框的选区读数（全选的判据是 selectionStart/End，不是「值没变」）。 */
async function inputSelection(
  page: Page,
  selector: string,
): Promise<{ start: number | null; end: number | null; value: string }> {
  return page.locator(selector).evaluate((el) => {
    const input = el as HTMLInputElement;
    return { start: input.selectionStart, end: input.selectionEnd, value: input.value };
  });
}

/** 编辑器（CodeMirror）的选区读数：判 ⌘A 没有绕到 `editor.select-all`（那会整篇选中）。 */
async function editorSelection(page: Page): Promise<{ anchor: number; head: number }> {
  return page.evaluate(() => {
    const el = document.querySelector(".cm-content") as unknown as {
      cmTile: {
        root: {
          view: { state: { selection: { main: { anchor: number; head: number } } } };
        };
      };
    };
    const main = el.cmTile.root.view.state.selection.main;
    return { anchor: main.anchor, head: main.head };
  });
}

// ---------------------------------------------------------------------------
// 大纲浮层
// ---------------------------------------------------------------------------

test("大纲：组合期的 ↑↓ / ⌃N⌃P / Enter 不移动游标、不接受、不消费（isComposing 与 keyCode 229 两条守卫）", async ({ page }) => {
  await openToc(page);
  const popover = page.locator(".lumir-toc");
  const active = page.locator(".lumir-toc-item.is-active");
  // 打开时游标 = 当前段（文档首 → 第一部分）
  await expect(active).toHaveText("第一部分");

  const sent = await composeKeys(page, ".lumir-toc-input", {
    mid: "甲",
    keys: [
      "ArrowDown",
      "Enter",
      { key: "n", ctrlKey: true },
      { key: "p", ctrlKey: true },
      { key: "a", metaKey: true },
    ],
    keyCode229: ["ArrowDown", "Enter"],
  });

  // 组合期七次按键都不被浮层消费（MUST NOT preventDefault）——与「游标没动」成对，
  // 才分得出「浮层让路」和「浮层接了但没生效」。⌘A 也在其中：组合期它归输入法 / 原生路径，
  // MUST NOT 被输入面的全选分支接管。
  expect(sent.map((entry) => entry.prevented)).toEqual([
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
  const composingSelection = await inputSelection(page, ".lumir-toc-input");
  expect(composingSelection.start, "组合期 ⌘A MUST NOT 建立全选").toBe(composingSelection.end);
  // 组合期：游标不动（旧实现会被两条 ArrowDown / ⌃N 推走）
  await expect(active).toHaveText("第一部分");
  // 组合期 Enter 不跳转：浮层仍开着、焦点仍在输入框
  await expect(popover).toBeVisible();
  expect(await activeElement(page)).toBe("input.lumir-toc-input");

  // 组合结束才按最终串刷新：结果集收窄、游标落在首条命中
  await composeEnd(page, ".lumir-toc-input", { final: "乙", trailingInput: false });
  await expect(popover).toBeVisible();
  await expect(active).toHaveText("乙小节");

  // 同一批键在组合期之外会被就地消费（defaultPrevented 为真）——上一条全 false 的矩阵
  // 因此有区分度，不是恒假断言。
  await page.evaluate(() => {
    const w = window as unknown as { __consumed: Array<{ key: string; prevented: boolean }> };
    w.__consumed = [];
    window.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "n") {
        w.__consumed.push({ key: event.key, prevented: event.defaultPrevented });
      }
    });
  });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Control+n");
  expect(
    await page.evaluate(
      () => (window as unknown as { __consumed: Array<{ key: string; prevented: boolean }> }).__consumed,
    ),
  ).toEqual([
    { key: "ArrowDown", prevented: true },
    { key: "n", prevented: true },
  ]);
});

test("大纲：⌘A 在筛选框内全选输入串（输入面合同，与 Quick Open 同源）", async ({ page }) => {
  await openToc(page);
  const input = page.locator(".lumir-toc-input");
  const popover = page.locator(".lumir-toc");

  await page.keyboard.type("部分");
  await expect(input).toHaveValue("部分");
  const editorBefore = await editorSelection(page);
  await installKeyConsumptionLog(page, { key: "a", meta: true });
  await page.keyboard.press("Meta+a");

  // 输入面必须显式接管（旧实现没有这条分支：Chromium 的原生 select-all 会把选区做出来，
  // 但 defaultPrevented 为假——WKWebView 上就是用户实测的「⌘A 不能全选」）。
  expect(await keyConsumptionLog(page)).toEqual([{ key: "a", prevented: true }]);
  expect(await inputSelection(page, ".lumir-toc-input")).toEqual({ start: 0, end: 2, value: "部分" });
  await expect(popover).toBeVisible();

  // 全选后键入替换整串（不是追加），列表按新串筛；⌘A MUST NOT 绕到 editor.select-all。
  await page.keyboard.type("乙");
  await expect(input).toHaveValue("乙");
  await expect(page.locator(".lumir-toc-item")).toHaveText(["乙小节", "乙小节细节"]);
  expect(await editorSelection(page), "⌘A 不得选中编辑器正文").toEqual(editorBefore);
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

test("vault：组合期的 ↑↓ / ⌃N⌃P / Enter 不移动游标、不切换、不消费（isComposing 与 keyCode 229 两条守卫）", async ({ page }) => {
  await openSwitcher(page);
  const popover = page.locator(".vault-pop");
  const active = page.locator(".vault-row.is-active");

  await expect(active.locator(".vault-row-name")).toHaveText("demo-vault");
  const switchesBefore = (await invokes(page)).filter((cmd) => cmd === "vault_open_path").length;
  const sent = await composeKeys(page, ".vault-filter", {
    mid: "not",
    keys: [
      "ArrowDown",
      "Enter",
      { key: "n", ctrlKey: true },
      { key: "p", ctrlKey: true },
      "Delete",
      "Backspace",
      { key: "a", metaKey: true },
    ],
    keyCode229: ["ArrowDown", "Enter", "Delete"],
  });

  // 组合期十次按键都不被浮层消费（MUST NOT preventDefault），游标不动、没有发起切换、没有进入
  // 删除确认（Delete / Backspace 的组合期反例），⌘A 也不被输入面的全选分支接管。
  expect(sent.map((entry) => entry.prevented)).toEqual([
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
  const composingSelection = await inputSelection(page, ".vault-filter");
  expect(composingSelection.start, "组合期 ⌘A MUST NOT 建立全选").toBe(composingSelection.end);
  await expect(page.locator(".vault-row-confirm")).toHaveCount(0);
  await expect(active.locator(".vault-row-name")).toHaveText("demo-vault");
  await expect(popover).toBeVisible();
  expect(await activeElement(page)).toBe("input.vault-filter");
  await expect(page.locator(".ft-vault-name")).toHaveText("demo-vault");
  expect((await invokes(page)).filter((cmd) => cmd === "vault_open_path").length).toBe(switchesBefore);
  expect((await invokes(page)).filter((cmd) => cmd === "vault_remove")).toEqual([]);

  // 组合结束才按最终串刷新
  await composeEnd(page, ".vault-filter", { final: "notes", trailingInput: false });
  await expect(popover).toBeVisible();
  await expect(page.locator(".vault-row")).toHaveCount(1);
  await expect(active.locator(".vault-row-name")).toHaveText("notes-vault");

  // 同一批键在组合期之外会被就地消费且真的移动游标——上一条全 false 的矩阵因此有区分度。
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".vault-row")).toHaveCount(4);
  await page.evaluate(() => {
    const w = window as unknown as { __consumed: Array<{ key: string; prevented: boolean }> };
    w.__consumed = [];
    window.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "n") {
        w.__consumed.push({ key: event.key, prevented: event.defaultPrevented });
      }
    });
  });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Control+n");
  expect(
    await page.evaluate(
      () => (window as unknown as { __consumed: Array<{ key: string; prevented: boolean }> }).__consumed,
    ),
  ).toEqual([
    { key: "ArrowDown", prevented: true },
    { key: "n", prevented: true },
  ]);
  await expect(active.locator(".vault-row-name")).toHaveText("sandbox-vault");
});

test("vault：⌘A 在筛选框内全选输入串（输入面合同，与 Quick Open 同源）", async ({ page }) => {
  await openSwitcher(page);
  const input = page.locator(".vault-filter");
  const popover = page.locator(".vault-pop");

  await page.keyboard.type("vault");
  await expect(input).toHaveValue("vault");
  const editorBefore = await editorSelection(page);
  await installKeyConsumptionLog(page, { key: "a", meta: true });
  await page.keyboard.press("Meta+a");

  // 与 Quick Open 的「输入面内的全选（⌘A）」同一条合同：显式接管、选中输入串、不依赖原生
  // Select All。旧实现的 defaultPrevented 为假（Chromium 原生路径会顺手做选区，WKWebView 不会）。
  expect(await keyConsumptionLog(page)).toEqual([{ key: "a", prevented: true }]);
  expect(await inputSelection(page, ".vault-filter")).toEqual({ start: 0, end: 5, value: "vault" });
  await expect(popover).toBeVisible();

  // 全选后键入替换整串；列表按新串筛；编辑器正文不被选中。
  await page.keyboard.type("box");
  await expect(input).toHaveValue("box");
  await expect(page.locator(".vault-row .vault-row-name")).toHaveText(["sandbox-vault"]);
  expect(await editorSelection(page), "⌘A 不得选中编辑器正文").toEqual(editorBefore);
});

test("vault：组合结束按最终串只刷新一次列表", async ({ page }) => {
  await openSwitcher(page);
  await installRebuildCounter(page, "vault-list");
  await resetRebuilds(page);

  await compose(page, ".vault-filter", { mid: "b", final: "s" });

  await expect(page.locator(".vault-row .vault-row-name")).toHaveText(["notes-vault", "sandbox-vault"]);
  expect(await rebuilds(page)).toBe(1);
});

test("vault：aria-selected 只表示键盘游标，当前 vault 用 aria-current；失效行可被指向且仍是 aria-disabled", async ({ page }) => {
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

  // 每个 option（含失效行）都有唯一 id
  const ids = await rows.evaluateAll((els) => els.map((el) => el.id));
  expect(ids.every((id) => id.length > 0), "每个 option 都要有 id").toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  const activeId = await selected.getAttribute("id");
  await expect(input).toHaveAttribute("aria-activedescendant", activeId as string);

  // 游标下移：aria-selected 跟着游标走，当前 vault 只留 aria-current
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("notes-vault");
  await expect(selected).toHaveCount(1);
  await expect(selected.locator(".vault-row-name")).toHaveText("notes-vault");
  await expect(current).toHaveCount(1);
  await expect(current.locator(".vault-row-name")).toHaveText("demo-vault");
  await expect(current).toHaveAttribute("aria-selected", "false");
  await expect(selected).toHaveAttribute("aria-current", "false");

  // ↑ 越过当前项落到失效行：它同样可被指向（Enter = 重新定位，Delete = 清理），但语义仍是
  // 「不能切换过去」——aria-disabled 保留，aria-selected 表示的是游标而不是可用性。
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("gone-vault");
  const missing = page.locator(".vault-row.is-missing");
  await expect(missing).toHaveAttribute("aria-disabled", "true");
  await expect(missing).toHaveAttribute("aria-selected", "true");
  await expect(input).toHaveAttribute("aria-activedescendant", (await missing.getAttribute("id")) as string);

  // 只剩失效行：游标落在它上面（不是「没有游标」）
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("gone");
  await expect(rows).toHaveCount(1);
  await expect(selected).toHaveCount(1);
  await expect(selected.locator(".vault-row-name")).toHaveText("gone-vault");
});

test("vault：当前 vault 失效时保留 aria-current=true 与 ✓ /「当前」，同时 aria-disabled=true", async ({ page }) => {
  await openSwitcherWith(page, MISSING_CURRENT);
  const currentMissing = page.locator('.vault-row[aria-current="true"]');

  // 身份维度：仍是当前项（aria-current + ✓ + 「当前」+ is-current），MUST NOT 因失效被写成非当前
  await expect(currentMissing).toHaveCount(1);
  await expect(currentMissing.locator(".vault-row-name")).toHaveText("demo-vault");
  await expect(currentMissing).toHaveClass(/is-missing/);
  await expect(currentMissing).toHaveClass(/is-current/);
  await expect(currentMissing.locator(".vault-dot")).toHaveText("✓");
  await expect(currentMissing.locator(".vault-row-flag")).toHaveText("当前");
  // 可用性维度：同时是 aria-disabled
  await expect(currentMissing).toHaveAttribute("aria-disabled", "true");

  // 策略起点是当前项——它失效也一样；游标因此落在它上面，activedescendant 指向同一条
  await expect(page.locator('.vault-row[aria-selected="true"] .vault-row-name')).toHaveText("demo-vault");
  const missingId = await currentMissing.getAttribute("id");
  expect(missingId, "失效行也要有 option id").toBeTruthy();
  await expect(page.locator(".vault-filter")).toHaveAttribute("aria-activedescendant", missingId as string);

  // ↓ 离开后当前身份不动（游标与身份是两个维度）
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("notes-vault");
  await expect(currentMissing).toHaveCount(1);
  await expect(currentMissing).toHaveAttribute("aria-selected", "false");
});

test("vault：当前失效行 is-current + is-missing 的计算样式与对比度（失效不另起一套色、文字仍可读）", async ({ page }) => {
  /** 当前行三个读点：行底色 / 行前景 / 名称前景——「失效」不得改变任何一项。 */
  const readCurrent = async (): Promise<{ background: string; color: string; nameColor: string }> =>
    page.locator('.vault-row[aria-current="true"]').evaluate((el) => {
      const style = getComputedStyle(el);
      const name = el.querySelector(".vault-row-name");
      if (name === null) throw new Error("当前行没有名称节点");
      return { background: style.backgroundColor, color: style.color, nameColor: getComputedStyle(name).color };
    });

  // 基线：可用 vault 的当前行
  await openSwitcher(page);
  const normal = await readCurrent();
  const normalName = await contrastRatioOf(page, '.vault-row[aria-current="true"] .vault-row-name');
  expect(normalName.ratio, `当前行名称对比度不足：${JSON.stringify(normalName)}`).toBeGreaterThanOrEqual(4.5);

  // 现场：同一个当前 vault 变成失效（盘拔出 / 目录改名）。身份色不得因可用性换一套，
  // 名称与「路径不可用…」两处文字仍须达到 AA 正文对比度。
  await openSwitcherWith(page, MISSING_CURRENT);
  const missing = await readCurrent();
  expect(missing).toEqual(normal);
  const missingName = await contrastRatioOf(page, '.vault-row[aria-current="true"] .vault-row-name');
  expect(missingName.ratio, `当前失效行名称对比度不足：${JSON.stringify(missingName)}`).toBeGreaterThanOrEqual(4.5);
  const warn = await contrastRatioOf(page, '.vault-row[aria-current="true"] .vault-row-sub.is-warn');
  expect(warn.ratio, `当前失效行「路径不可用」对比度不足：${JSON.stringify(warn)}`).toBeGreaterThanOrEqual(4.5);
});

test("vault：Delete / Backspace 在游标行上走同一套两步确认，查询编辑与当前项不被接管", async ({ page }) => {
  await openSwitcher(page);
  const popover = page.locator(".vault-pop");
  const input = page.locator(".vault-filter");
  const confirm = page.locator(".vault-row-confirm");
  const wraps = page.locator(".vault-row-wrap");

  // 当前项没有移除入口：Delete 不进入确认态、不消费按键（后端 vault_remove 同样拒绝）
  await page.keyboard.press("Delete");
  await expect(confirm).toHaveCount(0);
  await expect(popover).toBeVisible();
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("demo-vault");

  // 查询编辑中：Backspace 归输入框（删字），MUST NOT 被读成「删除行」
  await page.keyboard.type("notes");
  await expect(input).toHaveValue("notes");
  await page.keyboard.press("Backspace");
  await expect(input).toHaveValue("note");
  await expect(confirm).toHaveCount(0);

  // 清空查询 → 游标移到 notes-vault（非当前、可移除）
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await expect(input).toHaveValue("");
  await expect(page.locator(".vault-row")).toHaveCount(4);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("notes-vault");

  // 第一次按下 Delete：进入与点行尾 × 相同的两步确认（确认句点名该行），不发起移除
  await page.keyboard.press("Delete");
  await expect(confirm).toHaveText(/notes-vault/);
  await expect(popover).toBeVisible();
  expect((await invokes(page)).filter((cmd) => cmd === "vault_remove")).toEqual([]);
  await expect(input).toBeFocused();

  // 第二次按下 Backspace：提交移除——只发一次请求，列表按后端结果重拉
  await page.keyboard.press("Backspace");
  await expect(wraps).toHaveCount(3);
  await expect(page.locator(".vault-row-name")).toHaveText(["gone-vault", "demo-vault", "sandbox-vault"]);
  await expect(popover).toBeVisible();
  expect((await invokes(page)).filter((cmd) => cmd === "vault_remove")).toEqual(["vault_remove"]);
});

test("vault：失效行 Delete 走同一套两步确认并移除（端到端，覆盖到「第二次按下真的删掉」）", async ({ page }) => {
  await openSwitcher(page);
  const input = page.locator(".vault-filter");
  const popover = page.locator(".vault-pop");
  const confirm = page.locator(".vault-row-confirm");
  const removes = async (): Promise<string[]> => (await invokes(page)).filter((cmd) => cmd === "vault_remove");

  // 游标从当前项 ↑ 落到失效行（它在前端不重排，仍是第一行）
  await page.keyboard.press("ArrowUp");
  const active = page.locator(".vault-row.is-active");
  await expect(active.locator(".vault-row-name")).toHaveText("gone-vault");
  await expect(active).toHaveAttribute("aria-disabled", "true");

  // 第一次 Delete：与指针同一套两步确认，确认句点名失效行，零移除请求、浮层不收起
  await page.keyboard.press("Delete");
  await expect(confirm).toHaveText(/gone-vault/);
  await expect(popover).toBeVisible();
  await expect(input).toBeFocused();
  expect(await removes()).toEqual([]);

  // 第二次 Backspace：只发一次请求，失效行消失，其余行序不变
  await page.keyboard.press("Backspace");
  await expect(page.locator(".vault-row")).toHaveCount(3);
  await expect(page.locator(".vault-row-name")).toHaveText(["demo-vault", "notes-vault", "sandbox-vault"]);
  await expect(popover).toBeVisible();
  expect(await removes()).toEqual(["vault_remove"]);
});

test("vault：失效行 Enter 走重定位（选目录 → vault_remap → 按新根装载），不发起切换", async ({ page }) => {
  await openSwitcherWith(page, { ...VAULT, switchTo: MOVED_VAULT });
  const popover = page.locator(".vault-pop");

  // 游标 ↑ 到失效行，Enter：不是切换（那条路径只对可用行开放），是「重新定位…」
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("gone-vault");
  await page.keyboard.press("Enter");
  await expect(popover).toBeHidden();

  // 映射意图点名失效项的稳定 id + 用户选中的新目录，随后按新根装载
  await expect.poll(() => remapCalls(page)).toEqual([{ id: "vault-gone", path: MOVED_ROOT }]);
  await expect(page.locator(".ft-vault-name")).toHaveText("moved-vault");
  await expect(page.locator('.ft-row[title="moved.md"]')).toBeVisible();
  // 走的是重定位链（vault_open → vault_remap → vault_open_path），不是「打开另一个已注册 vault」
  const calls = await invokes(page);
  expect(calls.filter((cmd) => cmd === "vault_remap")).toHaveLength(1);
  expect(calls.filter((cmd) => cmd === "vault_open_path")).toHaveLength(1);
});

test("vault：Delete / Backspace 只在筛选输入框持焦时接管（Tab 到新增入口后不触发）", async ({ page }) => {
  await openSwitcher(page);
  const input = page.locator(".vault-filter");
  const popover = page.locator(".vault-pop");
  const confirm = page.locator(".vault-row-confirm");
  const removes = async (): Promise<string[]> => (await invokes(page)).filter((cmd) => cmd === "vault_remove");

  // 游标到一条非当前行
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("notes-vault");

  // Tab 到「新增 vault…」：按键仍冒泡到浮层容器，但那两个键是它的原生键，浮层 MUST NOT 接管
  await page.keyboard.press("Tab");
  await expect(page.locator(".vault-add")).toBeFocused();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await expect(confirm).toHaveCount(0);
  await expect(popover).toBeVisible();
  expect(await removes()).toEqual([]);

  // 焦点回到筛选框：同一个键进入确认态（同一行，未换目标）
  await input.click();
  await page.keyboard.press("Delete");
  await expect(confirm).toHaveText(/notes-vault/);
  // 确认态的行离开游标空间（Enter 不会误切到它）
  await expect(page.locator(".vault-row.is-active")).toHaveCount(0);
});

test("vault：Esc 第一次只撤确认、第二次关浮层；游标移动取消确认", async ({ page }) => {
  await openSwitcher(page);
  const input = page.locator(".vault-filter");
  const popover = page.locator(".vault-pop");
  const confirm = page.locator(".vault-row-confirm");
  const removes = async (): Promise<string[]> => (await invokes(page)).filter((cmd) => cmd === "vault_remove");

  await page.keyboard.press("ArrowDown"); // demo-vault → notes-vault
  await page.keyboard.press("Delete");
  await expect(confirm).toHaveCount(1);
  // 取消钮在 Tab 序列之外，但它读得出 Esc 这条出口
  await expect(page.locator(".vault-row-confirm-no")).toHaveAttribute("aria-keyshortcuts", "Escape");
  await expect(page.locator(".vault-row-confirm-no")).toHaveAttribute("tabindex", "-1");

  // 第一次 Esc：只撤确认——浮层还在、焦点仍在筛选框、确认行回到游标
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(popover).toBeVisible();
  await expect(input).toBeFocused();
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("notes-vault");

  // 再进确认后按 ↓：游标移动取消确认，且不删原确认行
  await page.keyboard.press("Delete");
  await expect(confirm).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await expect(confirm).toHaveCount(0);
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("sandbox-vault");
  expect(await removes()).toEqual([]);

  // 第二次 Esc（没有确认态）：既有规则——关层并交还焦点；空工作区落在主操作「打开笔记…」
  //（change make-no-tab-empty-workspace-nov28：正文不是空态的焦点落点）。
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(page.locator(".pane-empty-open")).toBeFocused();
  await expect(page.locator(".cm-content")).not.toBeFocused();
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

  // 主动关闭：Esc 交还焦点——空工作区落在主操作「打开笔记…」（不再是正文）
  await page.locator(".ft-vault").click();
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(page.locator(".pane-empty-open")).toBeFocused();
  await expect(page.locator(".cm-content")).not.toBeFocused();

  // 被动关闭：点浮层外不把焦点拽回编辑器，也不替用户聚焦空态主操作
  await page.locator(".ft-vault").click();
  await expect(popover).toBeVisible();
  await installFocusLog(page);
  await page.locator(".pane-filetree").evaluate((el) => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  await expect(popover).toBeHidden();
  const editorFocus = (await focusLog(page)).filter(
    (entry) => entry.includes("cm-content") || entry.includes("pane-empty-open"),
  );
  expect(editorFocus, "被动关闭 MUST NOT 聚焦编辑器或空态主操作").toEqual([]);
});
