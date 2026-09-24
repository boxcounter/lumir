import { expect, test, type Page } from "@playwright/test";
import { invokes, stubTauri, type VaultFixture, type VaultListRow } from "./tauri-stub";

// 两处列表浮层的输入筛选（change list-filter，M199）的行为回归。
//
// 为什么要有这个场景：
//   1. **真机套件判不到条目集合与几何**：AX 不给元素计数、不给浮层高度，而「输入即筛」的判据
//      恰恰是「列表里现在有哪几条」。chromium 直连能逐条读 DOM，这里是唯一能钉住的地方。
//   2. **下标空间是本次真正的缺陷面**（change list-filter 的 design §2.4）：筛选后 `Enter` /
//      点击的落点必须映射回源条目，少一步就是「跳到结果集第 i 条在全文里的另一个标题上」——
//      一条静默跳错位置的路径。这里的判据落在**光标偏移**上（读 CodeMirror 选区），不是
//      「浮层关了就算过」。
//   3. **vault 侧的 `rowEntries` 不能被筛窄**：它还有第二个消费者（重定位的占用判定），收窄会让
//      两个身份静默落到同一路径。那条判据按**调用参数**落在单元层（siblings 仍是完整列表），
//      这里钉的是筛选本身的可见事实。
//
// 判据纪律（REVIEW.md 第 1 条）：条目集合 / 光标偏移 / 几何 / 计算属性 / 计算属性式的 ARIA
// 归属，MUST NOT 只断言「输入框里有字」。反向验证：把筛选整段关掉（查询不参与结果集）重跑本
// 场景必须 FAIL，读数留档 test-results/m199/visual-filter-reverse.md。

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

/** 标题数远超一屏（60 条）：验「新增一行输入行后浮层总高仍在上限内」。 */
const LONG_DOC = Array.from({ length: 15 }, (_, index) => {
  const chapter = index + 1;
  return [
    `# 第 ${chapter} 章 概览`,
    `第 ${chapter} 章概览正文。`,
    "",
    `## 第 ${chapter} 章 小节`,
    `第 ${chapter} 章小节正文。`,
    "",
    `### 第 ${chapter} 章 细目`,
    `第 ${chapter} 章细目正文。`,
    "",
    `#### 第 ${chapter} 章 深一层`,
    `第 ${chapter} 章深一层正文。`,
    "",
  ].join("\n");
}).join("\n");

/** 注册表：失效行在最前（后端把不可用项沉底，这里刻意不按那个顺序写，顺带钉「前端不重排」）。
 *  名字刻意让「子串 vs 前缀」有区分度：查询 `s` 命中 `notes-vault`（s 在末段）与
 *  `sandbox-vault`（在首段），查询 `box` 只命中 `sandbox-vault`（中段）。 */
const REGISTRY: VaultListRow[] = [
  { id: "vault-gone", path: "/Volumes/ext/gone", name: "gone-vault", available: false, last_opened_at: null, tab_count: 0 },
  { id: "fixture-vault", path: "/Users/alex/demo-vault", name: "demo-vault", available: true, last_opened_at: 1757000002000, tab_count: 2 },
  { id: "fv-notes", path: "/Users/alex/notes-vault", name: "notes-vault", available: true, last_opened_at: 1757000001000, tab_count: 0 },
  { id: "fv-sandbox", path: "/Users/alex/sandbox-vault", name: "sandbox-vault", available: true, last_opened_at: 1757000000000, tab_count: 0 },
];

const VAULT: VaultFixture = {
  entries: [
    { path: "toc.md", kind: "file", size: DOC.length, mtime_ms: 0 },
    { path: "toc-long.md", kind: "file", size: LONG_DOC.length, mtime_ms: 0 },
  ],
  files: { "toc.md": DOC, "toc-long.md": LONG_DOC },
  links: {},
  vaults: REGISTRY,
};

/** 1-based 行首偏移（口径与 `doc.line(n).to` 一致）。 */
function lineEnd(doc: string, lineNumber: number): number {
  let pos = 0;
  for (let n = 1; n < lineNumber; n++) pos = doc.indexOf("\n", pos) + 1;
  const next = doc.indexOf("\n", pos);
  return next === -1 ? doc.length : next;
}

function lineNumberAt(doc: string, needle: string): number {
  return doc.slice(0, doc.indexOf(needle)).split("\n").length;
}

async function caret(page: Page): Promise<{ head: number; line: number }> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    const main = view.state.selection.main;
    return { head: main.head, line: view.state.doc.lineAt(main.head).number };
  });
}

/** 持焦点的元素（判「焦点在输入框而不是列表 / 行上」用真实 DOM 焦点，不用自报的状态）。 */
async function activeElement(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null) return "none";
    const classes = el.className === "" ? "" : `.${String(el.className).split(/\s+/).join(".")}`;
    return `${el.tagName.toLowerCase()}${classes}`;
  });
}

async function openToc(page: Page, file = "toc.md"): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator(`.ft-row[title="${file}"]`).click();
  await expect(page.locator(".cm-content")).toContainText("正文");
}

async function openSwitcher(page: Page): Promise<void> {
  await page.locator(".ft-vault").click();
  await expect(page.locator(".vault-row").first()).toBeVisible();
}

/** 清空输入框（原生文本编辑：⌘A + ⌫，MUST NOT 为「清空筛选」新增按钮或键位）。 */
async function clearQuery(page: Page): Promise<void> {
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
}

/** 合成的组合期事件序列（chromium 里没有真输入法，按 WKWebView 的事件序手工派发）。 */
async function composeQuery(page: Page, selector: string, interim: string, final: string): Promise<void> {
  await page.locator(selector).evaluate((el, [mid, done]) => {
    const input = el as HTMLInputElement;
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input.value = mid;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    input.value = done;
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  }, [interim, final]);
}

// ---------------------------------------------------------------------------
// 大纲浮层
// ---------------------------------------------------------------------------

test("大纲筛选：输入即筛（子串非前缀）、结果集里的游标与跳转落点、ARIA 归属", async ({ page }) => {
  await openToc(page);
  await page.locator(".modeline-section").click();
  const popover = page.locator(".lumir-toc");
  const input = page.locator(".lumir-toc-input");
  const items = page.locator(".lumir-toc-item");
  await expect(popover).toBeVisible();

  // 焦点随打开落到输入框（不是列表）；列表本身仍是 listbox，`aria-activedescendant` 在输入框上
  expect(await activeElement(page)).toBe("input.lumir-toc-input");
  await expect(input).toHaveAttribute("role", "combobox");
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(input).toHaveAttribute("aria-controls", "lumir-toc-list");
  await expect(input).toHaveAttribute("aria-label", "筛选");
  await expect(input).toHaveAttribute("placeholder", "输入以筛选");
  await expect(page.locator(".lumir-toc-list")).toHaveAttribute("role", "listbox");
  await expect(page.locator(".lumir-toc-list")).not.toHaveAttribute("aria-activedescendant", /.+/);
  await expect(items).toHaveCount(5);

  // 输入即筛：查询「小节」命中四条（含「甲小节细节」这种命中位置不在串首的），顺序 = 文档顺序
  await page.keyboard.type("小节");
  await expect(input).toHaveValue("小节");
  await expect(items).toHaveCount(4);
  await expect(items).toHaveText(["甲小节", "甲小节细节", "乙小节", "乙小节细节"]);
  // 游标落在**首条命中**，`aria-activedescendant` 指向它（组合框语义的落点）
  const active = page.locator(".lumir-toc-item.is-active");
  await expect(active).toHaveText("甲小节");
  await expect(active).toHaveAttribute("aria-selected", "true");
  const activeId = await active.getAttribute("id");
  await expect(input).toHaveAttribute("aria-activedescendant", activeId as string);

  // 缩进基准仍是**文档级**（H1 为基准 → 甲小节 = 1 层），筛选不改它（裁决点 ⑤）
  expect(
    await items.evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).style.getPropertyValue("--toc-depth")),
    ),
  ).toEqual(["1", "2", "1", "2"]);
  // 全文 H1 被筛掉，但基准不跟着结果集走
  await expect(page.locator(".lumir-toc-item", { hasText: "第一部分" })).toHaveCount(0);

  // 换一个只命中末段两条的查询：游标 → 结果集第一条 = 乙小节；↓ 到第二条后 Enter
  await clearQuery(page);
  await page.keyboard.type("乙小节");
  await expect(items).toHaveText(["乙小节", "乙小节细节"]);
  await page.keyboard.press("ArrowDown");
  await expect(active).toHaveText("乙小节细节");
  // 末端钳制：再按 ↓ 不动（钳的是**结果集**边界，不是全文边界）
  await page.keyboard.press("ArrowDown");
  await expect(active).toHaveText("乙小节细节");

  // Enter 跳到**命中的那一条**（下标空间映射）：光标落在 `### 乙小节细节` 行尾。少了「结果集下标
  // → 源下标」这一步时这里会跳到全文第 1 条（第一部分）——判据因此有区分度。
  await page.keyboard.press("Enter");
  await expect(popover).toBeHidden();
  await expect
    .poll(() => caret(page), { message: "Enter 应跳到结果集里那一条（源下标第 5 条）" })
    .toEqual({
      head: lineEnd(DOC, lineNumberAt(DOC, "### 乙小节细节")),
      line: lineNumberAt(DOC, "### 乙小节细节"),
    });
  // 跳转只改选区与视口：文档内容逐字节不变
  await expect(page.locator(".cm-content")).toContainText("乙小节细节正文");
});

test("大纲筛选：当前段被筛掉不高亮、清空回全量起点、无命中保留浮层、Esc 丢弃查询", async ({ page }) => {
  await openToc(page);
  await page.locator(".modeline-section").click();
  const popover = page.locator(".lumir-toc");
  const items = page.locator(".lumir-toc-item");
  const current = page.locator(".lumir-toc-item.is-current");
  const active = page.locator(".lumir-toc-item.is-active");
  const hint = page.locator(".lumir-toc-hint");
  await expect(popover).toBeVisible();
  // 装载时光标在文档首 → 当前段 = 第一部分，全量态起点就是它
  await expect(current).toHaveText("第一部分");
  await expect(active).toHaveText("第一部分");

  // 查询命中别的标题：当前段不在结果集里 → 没有高亮落到别的条目上
  await page.keyboard.type("乙");
  await expect(items).toHaveCount(2);
  await expect(current).toHaveCount(0);
  await expect(active).toHaveText("乙小节");

  // 无命中态：浮层保持打开、列表区一行提示、底部键位提示仍常驻；MUST NOT 出现 D84 那条
  await clearQuery(page);
  await page.keyboard.type("zzzz");
  await expect(items).toHaveCount(0);
  await expect(popover).toBeVisible();
  await expect(page.locator(".lumir-toc-empty")).toBeVisible();
  await expect(page.locator(".lumir-toc-empty")).toHaveText("没有匹配的条目");
  await expect(hint).toBeVisible();
  await expect(page.locator(".lumir-toast")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("这份文档还没有标题");
  // 无命中 = 没有游标：Enter 无操作（浮层不关、文档不动）
  await page.keyboard.press("Enter");
  await expect(popover).toBeVisible();

  // 清空查询（⌘A + ⌫）：回全量、提示行退场、游标回到**全量态起点**（当前段）
  await clearQuery(page);
  await expect(items).toHaveCount(5);
  await expect(page.locator(".lumir-toc-empty")).toBeHidden();
  await expect(current).toHaveText("第一部分");
  await expect(active).toHaveText("第一部分");

  // Esc 一步关闭（不是「先清查询」那一步）：重开是空查询 + 全量
  await page.keyboard.type("乙");
  await expect(items).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await page.locator(".modeline-section").click();
  await expect(popover).toBeVisible();
  await expect(page.locator(".lumir-toc-input")).toHaveValue("");
  await expect(items).toHaveCount(5);

  // 焦点从输入框离开即收起（Tab 出去）：MUST NOT 留下「浮层还在、焦点已在外」
  await page.keyboard.press("Tab");
  await expect(popover).toBeHidden();
});

test("大纲筛选：组合期不刷新结果集，组合结束后刷一次", async ({ page }) => {
  await openToc(page);
  await page.locator(".modeline-section").click();
  const items = page.locator(".lumir-toc-item");
  await expect(items).toHaveCount(5);

  // 组合期：中间串「甲」若参与筛选会立刻变成 2 条（甚至零命中）——那正是要避免的闪烁
  await composeQuery(page, ".lumir-toc-input", "甲", "乙");
  await expect(items).toHaveCount(2);
  await expect(items).toHaveText(["乙小节", "乙小节细节"]);
  await expect(page.locator(".lumir-toc-input")).toHaveValue("乙");
});

test("大纲筛选：输入行在位且浮层总高仍为窗口内容区高的 80%（长文）", async ({ page }) => {
  await openToc(page, "toc-long.md");
  await page.locator(".modeline-section").click();
  const popover = page.locator(".lumir-toc");
  const input = page.locator(".lumir-toc-input");
  const hint = page.locator(".lumir-toc-hint");
  await expect(page.locator(".lumir-toc-item")).toHaveCount(60);
  await expect(input).toBeVisible();

  const geometry = () =>
    page.evaluate(() => {
      const popoverEl = document.querySelector(".lumir-toc") as HTMLElement;
      const listEl = document.querySelector(".lumir-toc-list") as HTMLElement;
      const inputEl = document.querySelector(".lumir-toc-input") as HTMLElement;
      return {
        height: popoverEl.getBoundingClientRect().height,
        viewport: document.documentElement.clientHeight,
        listScroll: listEl.scrollHeight,
        listClient: listEl.clientHeight,
        inputHeight: inputEl.getBoundingClientRect().height,
      };
    });

  // 上限仍约束**浮层总高**（含新增的输入行与底部提示），且真的用满
  let geo = await geometry();
  expect(geo.inputHeight).toBeGreaterThan(0); // 输入行是固定行，MUST NOT 被 flex 压成 0
  expect(geo.height).toBeLessThanOrEqual(geo.viewport * 0.8 + 0.5);
  expect(geo.height).toBeGreaterThan(geo.viewport * 0.8 - 1.5);
  expect(geo.listScroll).toBeGreaterThan(geo.listClient);
  await expect(hint).toBeVisible();

  // 窗口内容区高变小：上限跟着变、浮层保持打开、输入行与提示都还在
  await page.setViewportSize({ width: 1200, height: 400 });
  await expect.poll(() => geometry().then((now) => now.viewport)).toBe(400);
  geo = await geometry();
  expect(geo.inputHeight).toBeGreaterThan(0);
  expect(geo.height).toBeLessThanOrEqual(geo.viewport * 0.8 + 0.5);
  expect(geo.height).toBeGreaterThan(geo.viewport * 0.8 - 1.5);
  expect(geo.listScroll).toBeGreaterThan(geo.listClient);
  await expect(popover).toBeVisible();
  await expect(input).toBeVisible();
  await expect(hint).toBeVisible();
});

// ---------------------------------------------------------------------------
// vault 浮层
// ---------------------------------------------------------------------------

test("vault 筛选：显示名子串命中（非前缀）、失效行参与、当前项被筛掉", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openSwitcher(page);
  const popover = page.locator(".vault-pop");
  const input = page.locator(".vault-filter");
  const rows = page.locator(".vault-row");

  // 焦点在输入框、ARIA 组合框语义（列表靠 aria-controls 被指认）
  expect(await activeElement(page)).toBe("input.vault-filter");
  await expect(input).toHaveAttribute("role", "combobox");
  await expect(input).toHaveAttribute("aria-controls", "lumir-vault-list");
  await expect(input).toHaveAttribute("aria-label", "筛选");
  await expect(input).toHaveAttribute("placeholder", "输入以筛选");
  await expect(page.locator(".vault-list")).toHaveAttribute("role", "listbox");
  await expect(page.locator(".vault-list")).not.toHaveAttribute("aria-activedescendant", /.+/);
  await expect(rows).toHaveCount(4);

  // 输入 `s`：中段/末段命中（`notes-vault` 的 s 在末段、`sandbox-vault` 在首段），
  // `demo-vault` 与失效的 `gone-vault` 都不含 s → 被筛掉。命中位置与串首无关 = 子串口径。
  await page.keyboard.type("s");
  await expect(rows).toHaveCount(2);
  await expect(rows.locator(".vault-row-name")).toHaveText(["notes-vault", "sandbox-vault"]);
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("notes-vault");
  const activeId = await page.locator(".vault-row.is-active").getAttribute("id");
  await expect(input).toHaveAttribute("aria-activedescendant", activeId as string);

  // 换 `box`（只在中段）：只剩 sandbox-vault —— 前缀匹配在这里会零命中
  await clearQuery(page);
  await page.keyboard.type("box");
  await expect(rows).toHaveCount(1);
  await expect(rows.locator(".vault-row-name")).toHaveText(["sandbox-vault"]);
  // 当前项（demo-vault）被筛掉：结果集里没有当前项标记，当前 vault 不变（树头部名字不动）
  await expect(page.locator(".vault-row.is-current")).toHaveCount(0);
  await expect(page.locator(".ft-vault-name")).toHaveText("demo-vault");

  // 失效行同样参与筛选（它是「重新定位…」的唯一入口）：命中时仍在结果集里，但不进键盘游标空间
  await clearQuery(page);
  await page.keyboard.type("gone");
  await expect(rows).toHaveCount(1);
  await expect(page.locator(".vault-row.is-missing")).toHaveCount(1);
  await expect(page.locator(".vault-row.is-missing .vault-row-act")).toHaveText("重新定位…");
  await expect(page.locator(".vault-row.is-active")).toHaveCount(0);

  // 摘要与路径不参与匹配：输入摘要里的话（D101）零命中，当前 vault 依旧不变
  await clearQuery(page);
  await page.keyboard.type("还没有打开过文件");
  await expect(rows).toHaveCount(0);
  await expect(popover).toBeVisible();
  await expect(page.locator(".ft-vault-name")).toHaveText("demo-vault");
});

test("vault 筛选：无命中保持浮层、新增入口可用、打开只拉取一次、Esc 丢弃查询", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openSwitcher(page);
  const popover = page.locator(".vault-pop");
  const rows = page.locator(".vault-row");

  const listCalls = async (): Promise<number> => (await invokes(page)).filter((name) => name === "vault_list").length;
  const before = await listCalls();

  await page.keyboard.type("zzzz");
  await expect(rows).toHaveCount(0);
  await expect(popover).toBeVisible();
  await expect(page.locator(".vault-empty")).toBeVisible();
  await expect(page.locator(".vault-empty")).toHaveText("没有匹配的条目");
  // 分隔线与「新增 vault…」不被筛掉：它不在列表里，是摆脱空结果的唯一入口
  await expect(page.locator(".vault-add")).toBeVisible();
  await expect(page.locator(".vault-add")).toHaveText("＋新增 vault…");
  // 连续输入不触发第二次拉取（结果集只过滤本地数组，不做常驻镜像）
  await page.keyboard.type("abc");
  await expect(rows).toHaveCount(0);
  expect(await listCalls()).toBe(before);

  // Esc 一步关闭：查询丢弃，重开是空查询 + 全量 + 游标回当前项
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await openSwitcher(page);
  await expect(page.locator(".vault-filter")).toHaveValue("");
  await expect(page.locator(".vault-empty")).toBeHidden();
  await expect(rows).toHaveCount(4);
  await expect(page.locator(".vault-row.is-current")).toHaveCount(1);
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("demo-vault");
});

test("vault 筛选：点击输入框能落焦点（浮层级 mousedown 防夺焦的排除项）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openSwitcher(page);
  const input = page.locator(".vault-filter");

  // 先把焦点移到浮层内的另一个焦点元素（Tab 到行上：行是 button，焦点仍在浮层内 → 不收起）。
  // 浮层级的 mousedown preventDefault 若把输入框一并挡掉，点它就不会把焦点拿回来，
  // 随后的键入落不到查询上——这正是本用例要区分的行为。
  await page.keyboard.press("Tab");
  expect(await activeElement(page)).not.toBe("input.vault-filter");
  await expect(page.locator(".vault-pop")).toBeVisible();

  await input.click();
  expect(await activeElement(page)).toBe("input.vault-filter");
  await page.keyboard.type("box");
  await expect(input).toHaveValue("box");
  await expect(page.locator(".vault-row")).toHaveCount(1);
  await expect(page.locator(".vault-row .vault-row-name")).toHaveText(["sandbox-vault"]);

  // 行仍然不夺焦（点击路径必须活到 click）：点可用行 → 发起切换并收起浮层
  await page.locator(".vault-row").click();
  await expect(page.locator(".vault-pop")).toBeHidden();
});
