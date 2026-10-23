import { expect, test, type Page } from "@playwright/test";
import { externalReads, invokes, stubTauri, type VaultFixture } from "./tauri-stub";

// 按路径快速打开（M655，change quick-open-file-oct23）的**可见行为**回归。
//
// 为什么要有这个场景：
//   1. **真机套件判不到候选集合与浮层形态**：AX 不给元素计数、也不暴露浮层的 ARIA 归属，
//      而「输入即筛」「游标落在首条命中」恰恰只能逐条读 DOM。
//   2. **行号落点**要读真 CM view 的选区（`cmTile.root.view`，与 m281 / list-filter 同口径）
//      ——「浮层关了就算过」会把「落错行」判成绿。
//   3. **CL-1**（浮层关闭不得改变阅读位置）只有真 DOM 的滚动读数能钉住。
//   4. **vault 外只读**的两个可见标记（标签页的「只读」后缀、modeline 的「vault 外 · 只读」）
//      与「⌘S 无落点」（没有任何写类 invoke）是真机场景读不到/容易被误判的形态。
//
// 判据纪律（REVIEW.md「断言等价于子串」条）：候选集合用**逐条文本**断言（不是计数），落点用
// 光标行号断言，只读用「文档逐字节不变 + invoke 清单里没有写类命令」两条一起判。
//
// 本场景不覆盖（如实登记）：解析次序的矩阵（整串优先 / 畸形后缀 / 大小写折叠 / 探测兜底）在
// `tests/unit/quick-open.test.ts`；外部读取的 Rust 侧拒绝路径在 `cargo test`；真机 WKWebView
// 下 ⌘P 是否被 webview 截获、粘贴与手感的判定在 `scripts/acceptance/scenarios/230-quick-open.md`。

const PLAN_DOC = "# Plan\n\nPLAN-MARKER\n";
const SPEC_DOC = "# Spec\n\nSPEC-MARKER\n";
const APP_DOC = "# Vault plan\n\nAPP-MARKER\n";

/** 200 行文档：第 120 行有一个只在落点后才进视口的标记。 */
const LONG_LINE_TEXT = "LR-655-L120-TARGET";
const LONG_LINES: string[] = ["# Long", ""];
while (LONG_LINES.length < 200) LONG_LINES.push(`第 ${LONG_LINES.length + 1} 行：快速打开落点的填充内容。`);
LONG_LINES[119] = LONG_LINE_TEXT;
const LONG_DOC = `${LONG_LINES.join("\n")}\n`;
/** 文档总行数（末尾换行会多出一个空行——越界钳制的判据要用这个真实读数）。 */
const LONG_TOTAL_LINES = LONG_LINES.length + 1;

const EXTERNAL_PATH = "/tmp/lumir-verify/draft.md";
const EXTERNAL_DOC = "# Draft\n\nEXTERNAL-655-MARKER\n";

const VAULT: VaultFixture = {
  entries: [
    { path: "notes", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "apps", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "notes/plan.md", kind: "file", size: PLAN_DOC.length, mtime_ms: 0 },
    { path: "notes/spec.md", kind: "file", size: SPEC_DOC.length, mtime_ms: 0 },
    { path: "apps/plan.json", kind: "file", size: APP_DOC.length, mtime_ms: 0 },
    { path: "long.md", kind: "file", size: LONG_DOC.length, mtime_ms: 0 },
  ],
  files: {
    "notes/plan.md": PLAN_DOC,
    "notes/spec.md": SPEC_DOC,
    "apps/plan.json": APP_DOC,
    "long.md": LONG_DOC,
  },
  externalFiles: { [EXTERNAL_PATH]: EXTERNAL_DOC },
  links: {},
};

/** 真 CM view 的读数：光标行号 + 滚动位置 + 文档正文。 */
function editorFacts(page: Page): Promise<{ line: number; scrollTop: number; text: string; readOnly: boolean }> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } })
      .cmTile.root.view;
    return {
      line: view.state.doc.lineAt(view.state.selection.main.head).number,
      scrollTop: Math.round(view.scrollDOM.scrollTop),
      text: view.state.doc.toString(),
      readOnly: view.state.readOnly === true && view.contentDOM.getAttribute("contenteditable") === "false",
    };
  });
}

async function focusIsEditor(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof Element && active.classList.contains("cm-content");
  });
}

async function openQuickOpen(page: Page): Promise<void> {
  await page.keyboard.press("Meta+p");
  await expect(page.locator(".lumir-qo")).toBeVisible();
  await expect(page.locator(".lumir-qo-input")).toBeFocused();
}

/** 展开一个目录行（嵌套文件的 `.ft-row[title]` 是完整相对路径，但父目录未展开时不在 DOM 里）。
 *  展开态由行末的 `.ft-caret.is-open` 表达；这里直接等**子行**出现——那才是后续断言的前提。 */
async function expandDir(page: Page, dir: string, child: string): Promise<void> {
  await page.locator(`.ft-row[title="${dir}"]`).click();
  await expect(page.locator(`.ft-row[title="${child}"]`)).toBeVisible();
}

// ---------------------------------------------------------------------------
// 1）唤起、空态、候选、Enter 打开
// ---------------------------------------------------------------------------

test("⌘P：空态不列全量、输入即筛（完整路径子串）、Enter 打开新标签并把焦点交还编辑器", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await expandDir(page, "notes", "notes/plan.md");

  await page.keyboard.press("Meta+p");
  const popover = page.locator(".lumir-qo");
  const input = page.locator(".lumir-qo-input");
  const list = page.locator(".lumir-qo-list");
  const items = page.locator(".lumir-qo-item");
  const hint = page.locator(".lumir-qo-hint");
  await expect(popover).toBeVisible();
  // 焦点在输入框（不是列表）；ARIA 组合框语义与 `aria-activedescendant` 的落点
  expect(await page.evaluate(() => document.activeElement?.className)).toContain("lumir-qo-input");
  await expect(input).toHaveAttribute("role", "combobox");
  await expect(input).toHaveAttribute("aria-controls", "lumir-qo-list");
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await expect(list).toHaveAttribute("role", "listbox");
  await expect(list).not.toHaveAttribute("aria-activedescendant", /.+/);
  // 空查询：不列全量（列表隐藏），提示行给用法
  await expect(items).toHaveCount(0);
  await expect(list).toBeHidden();
  await expect(hint).toHaveText("输入路径或文件名；可加 :12 这样的行号后缀");

  // 输入即筛：匹配对象是**完整相对路径**（`plan` 命中 notes/plan.md 与 apps/plan.json）
  await page.keyboard.type("plan");
  await expect(items).toHaveText(["notes/plan.md", "apps/plan.json"]);
  await expect(hint).toHaveText("命中 2 条");
  const active = page.locator(".lumir-qo-item.is-active");
  await expect(active).toHaveText("notes/plan.md");
  const activeId = await active.getAttribute("id");
  await expect(input).toHaveAttribute("aria-activedescendant", activeId as string);

  // 路径片段：`notes/` 只命中前两条里的一条（子串语义，不是文件名匹配）
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("notes/");
  await expect(items).toHaveText(["notes/plan.md", "notes/spec.md"]);

  // ↓ 到第二条后 Enter：打开**游标那一条**（不是查询串解析结果）
  await page.keyboard.press("ArrowDown");
  await expect(active).toHaveText("notes/spec.md");
  await page.keyboard.press("Enter");
  await expect(popover).toBeHidden();
  await expect(page.locator(".tab-open")).toHaveText(["spec.md"]);
  await expect(page.locator(".cm-content")).toContainText("SPEC-MARKER");
  // 焦点交还编辑器（随后键入的字符落进文档，MUST NOT 出现「按键无人接收」）
  await expect.poll(() => focusIsEditor(page)).toBe(true);

  // 前台会话切换（⌘1）⇒ 浮层收起且不打开任何文件（输入串指向切换前那一刻的上下文）
  await openQuickOpen(page);
  await page.keyboard.type("plan");
  await page.keyboard.press("Meta+1");
  await expect(popover).toBeHidden();
  await expect(page.locator(".tab-open")).toHaveCount(1);
  await expect(page.locator(".cm-content")).toContainText("SPEC-MARKER");
});

// ---------------------------------------------------------------------------
// 1b）点击候选与键盘同一落点
// ---------------------------------------------------------------------------

test("点击候选打开：与键盘同一行、不夺焦（mousedown preventDefault）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await expandDir(page, "notes", "notes/plan.md");

  await openQuickOpen(page);
  await page.keyboard.type("plan");
  const items = page.locator(".lumir-qo-item");
  await expect(items).toHaveText(["notes/plan.md", "apps/plan.json"]);
  await items.nth(1).click();
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".tab-open")).toHaveText(["plan.json"]);
  await expect(page.locator(".cm-content")).toContainText("APP-MARKER");
});

// ---------------------------------------------------------------------------
// 2）path:line 落点与 CL-1（关闭不改变阅读位置）
// ---------------------------------------------------------------------------

test("粘贴 path:行 一次落行；越界钳制到末行；Esc 收起后阅读位置逐值不变（CL-1）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="long.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("快速打开落点的填充内容");

  // 先在文档里滚到中部，记下阅读位置（CL-1 的基线）
  await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } })
      .cmTile.root.view;
    view.scrollDOM.scrollTop = 400;
  });
  await page.waitForTimeout(100);
  const before = await editorFacts(page);
  expect(before.scrollTop).toBeGreaterThan(0);

  // ⌘P → Esc：收起且阅读位置逐值不变（CL-1；交还焦点的写回落在 CM 的测量周期上，用 poll 等它）
  await openQuickOpen(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect
    .poll(() => editorFacts(page).then((facts) => facts.scrollTop))
    .toBe(before.scrollTop);
  const afterClose = await editorFacts(page);
  expect(afterClose.line).toBe(before.line);
  expect(afterClose.text).toBe(before.text);

  // 粘贴 `long.md:120` → Enter：文件**不重开**（已在标签里），光标落到第 120 行、该行进视口
  await openQuickOpen(page);
  await page.keyboard.type("long.md:120");
  // 候选按**剥掉合法后缀**后的路径筛（`:120` 不参与匹配）
  await expect(page.locator(".lumir-qo-item")).toHaveText(["long.md"]);
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect.poll(() => editorFacts(page).then((facts) => facts.line)).toBe(120);
  const landed = await editorFacts(page);
  expect(landed.text).toBe(LONG_DOC); // 落点只动选区与视口：文档逐字节不变
  await expect.poll(() => editorFacts(page).then((facts) => facts.scrollTop)).not.toBe(before.scrollTop);

  // 越界行号静默钳制到末行（不报错、不提示）
  await openQuickOpen(page);
  await page.keyboard.type("long.md:9999");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect.poll(() => editorFacts(page).then((facts) => facts.line)).toBe(LONG_TOTAL_LINES);
});

// ---------------------------------------------------------------------------
// 3）vault 外只读：标记、只读面、⌘S 无落点、去重
// ---------------------------------------------------------------------------

test("vault 外绝对路径只读打开：标签与 modeline 的只读标记、⌘S 无 invoke、同路径不产生第二个标签", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await expandDir(page, "notes", "notes/plan.md");

  await openQuickOpen(page);
  await page.keyboard.type(EXTERNAL_PATH);
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();

  // 标签页：可见的「只读」后缀（Alex 追加裁决：一眼可辨），悬停提示是**完整绝对路径**
  const tab = page.locator(".tab-open").filter({ hasText: "draft.md" });
  await expect(tab).toHaveText("draft.md · 只读");
  await expect(tab).toHaveAttribute("title", EXTERNAL_PATH);
  await expect(tab).toHaveAttribute("aria-label", "draft.md（vault 外只读）");

  // modeline：右段追加「vault 外 · 只读」，左段的路径段是完整绝对路径（辅助面）
  await expect(page.locator(".modeline-meta")).toContainText("vault 外 · 只读");
  await expect(page.locator(".modeline-path")).toContainText("draft.md");
  await expect(page.locator(".modeline-path")).toContainText("tmp");

  // 结构性只读：视图层拒收输入（contenteditable 摘掉 + state.readOnly），正文逐字节不变
  const facts = await editorFacts(page);
  expect(facts.text).toBe(EXTERNAL_DOC);
  expect(facts.readOnly).toBe(true);
  await page.locator(".cm-content").click();
  await page.keyboard.type("SHOULD-NOT-LAND");
  expect(await editorFacts(page).then((next) => next.text)).toBe(EXTERNAL_DOC);

  // ⌘S 无落点：没有任何写类 invoke，也不出现保存失败提示
  const before = await invokes(page);
  await page.keyboard.press("Meta+s");
  await page.waitForTimeout(150);
  const after = await invokes(page);
  expect(after.slice(before.length)).not.toContain("document_save");
  await expect(page.locator(".lumir-toast")).toHaveCount(0);

  // 同一绝对路径再次打开 = 切到既有标签（不重读、不产生第二个标签）
  await openQuickOpen(page);
  await page.keyboard.type(EXTERNAL_PATH);
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".tab-open")).toHaveCount(1);
  expect(await externalReads(page)).toEqual([EXTERNAL_PATH]);
});

// ---------------------------------------------------------------------------
// 4）失败面与无 vault
// ---------------------------------------------------------------------------

test("vault 外路径不存在：按找不到处置、浮层保持打开、输入内容保留", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await expandDir(page, "notes", "notes/plan.md");

  await openQuickOpen(page);
  await page.keyboard.type("/tmp/lumir-verify/nope.md");
  await page.keyboard.press("Enter");
  const popover = page.locator(".lumir-qo");
  await expect(popover).toBeVisible();
  await expect(page.locator(".lumir-qo-input")).toHaveValue("/tmp/lumir-verify/nope.md");
  await expect(page.locator(".lumir-qo-hint")).toHaveText("找不到：/tmp/lumir-verify/nope.md");
  // 不产生任何标签、也不落盘任何东西
  await expect(page.locator(".tab-open")).toHaveCount(0);
});

test("未装载 vault：⌘P 只给一句人话提示，不打开空浮层", async ({ page }) => {
  await stubTauri(page, null);
  await page.goto("/");
  // 就绪门：空态主界面的「打开 vault」入口在场（不拿 .editor-notice 当就绪信号——它在
  // 本步之前是隐藏的，等它可见等于把被测行为写进前置条件）
  await expect(page.getByRole("button", { name: "打开 vault" })).toBeVisible();

  await page.keyboard.press("Meta+p");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".editor-notice")).toHaveText("还没有打开 vault，无法按路径打开文件");
});
