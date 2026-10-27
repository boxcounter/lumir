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
// 下 ⌘P 是否被 webview 截获、粘贴与手感的判定在真机套件 230 的三组场景
// （`scripts/acceptance/scenarios/230a-path-forms.md` / `230b-lazy-and-external-readonly.md` /
// `230c-restart-and-focus-scopes.md`）。

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

/** 20 行的 vault 外文档：第 12 行有标记（`path:12` 的直接行与落点判据用它）。 */
const EXTERNAL_LONG_PATH = "/tmp/lumir-verify/long-draft.md";
const EXTERNAL_LONG_LINES: string[] = ["# Long draft", ""];
while (EXTERNAL_LONG_LINES.length < 20) {
  EXTERNAL_LONG_LINES.push(`外部第 ${EXTERNAL_LONG_LINES.length + 1} 行：落点判据的填充内容。`);
}
EXTERNAL_LONG_LINES[11] = "EXTERNAL-LINE-12-MARKER";
const EXTERNAL_LONG_DOC = `${EXTERNAL_LONG_LINES.join("\n")}\n`;

/** 折叠等值多命中的现场（`A.MD` 同时命中 `A.md` / `a.md`）。 */
const A_DOC = "# Upper\n\nA-UPPER-MARKER\n";
const A_LOWER_DOC = "# Lower\n\nA-LOWER-MARKER\n";

/** 索引外的惰性文件：只在 `files` 里（可打开），**不在** `entries`（不进 `vaultFilePaths`）。 */
const LAZY_PATH = ".local/notes.md";
const LAZY_DOC = "# Lazy\n\nLAZY-700-MARKER\n";

const VAULT: VaultFixture = {
  root: "/v",
  entries: [
    { path: "notes", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "apps", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "notes/plan.md", kind: "file", size: PLAN_DOC.length, mtime_ms: 0 },
    { path: "notes/spec.md", kind: "file", size: SPEC_DOC.length, mtime_ms: 0 },
    { path: "apps/plan.json", kind: "file", size: APP_DOC.length, mtime_ms: 0 },
    { path: "long.md", kind: "file", size: LONG_DOC.length, mtime_ms: 0 },
    { path: "A.md", kind: "file", size: A_DOC.length, mtime_ms: 0 },
    { path: "a.md", kind: "file", size: A_LOWER_DOC.length, mtime_ms: 0 },
  ],
  files: {
    "notes/plan.md": PLAN_DOC,
    "notes/spec.md": SPEC_DOC,
    "apps/plan.json": APP_DOC,
    "long.md": LONG_DOC,
    "A.md": A_DOC,
    "a.md": A_LOWER_DOC,
    // 惰性：文件在盘上、可读，但装载枚举不列出它（真后端由 ignore 规则产生同一形态）。
    [LAZY_PATH]: LAZY_DOC,
  },
  externalFiles: {
    [EXTERNAL_PATH]: EXTERNAL_DOC,
    [EXTERNAL_LONG_PATH]: EXTERNAL_LONG_DOC,
  },
  links: {},
};

/** 候选上限的现场：一个名为 `bulk` 的文件（直接行）+ 300 条路径含 `bulk` 的候选。 */
const BULK_DOC = "# Bulk\n\nBULK-700-MARKER\n";
const BULK_ENTRIES: unknown[] = [
  { path: "bulk", kind: "file", size: BULK_DOC.length, mtime_ms: 0 },
  { path: "bulk-index", kind: "dir", size: 0, mtime_ms: 0 },
];
const BULK_FILES: Record<string, string> = { bulk: BULK_DOC };
for (let i = 0; i < 300; i += 1) {
  const path = `bulk-index/entry-${String(i).padStart(3, "0")}.md`;
  BULK_ENTRIES.push({ path, kind: "file", size: BULK_DOC.length, mtime_ms: 0 });
  BULK_FILES[path] = BULK_DOC;
}
const BULK: VaultFixture = { root: "/v", entries: BULK_ENTRIES, files: BULK_FILES, links: {} };

/**
 * 给桩补一条 `fs_paths_exist` 路由（M700）：惰性文件的「存在探测」在真后端由忽略规则产生，
 * 而 chromium 桩没有这条命令（未路由 = `unknown_command`，被 resolver 按不存在处置）。
 * 这里在页面里包一层 invoke，让 probe 按 `present` 回答；`delayMs` 用来造「迟到结果」。
 */
async function stubPathsExist(page: Page, present: string[], delayMs = 0): Promise<void> {
  await page.evaluate(
    ({ present, delayMs }) => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (...args: any[]) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      const inner = internals.invoke.bind(internals);
      internals.invoke = async (cmd: string, args?: { paths?: string[] }, ...rest: unknown[]) => {
        if (cmd !== "fs_paths_exist") return inner(cmd, args, ...rest);
        const paths = args?.paths ?? [];
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        return paths.filter((path) => present.includes(path));
      };
    },
    { present, delayMs },
  );
}

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
  // 就绪门：文件树渲染出第一条行 = vault 装载完成。⌘P 的绑定在启动装配末尾才接好，在此
  // 之前按键会静默无效（弹层停在 hidden）——新用例不再各自复制一条 expandDir 前置。
  await expect(page.locator(".ft-row").first()).toBeVisible();
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
  // 直接行由探测补帧给出（同步层先探整串）；没动过游标时它必须成为默认游标位
  await expect(page.locator(".lumir-qo-direct-path")).toHaveText("按 Enter 打开 long.md");
  await expect(page.locator(".lumir-qo-direct-line")).toHaveText("第 120 行");
  await expect(page.locator(".lumir-qo-direct")).toHaveClass(/is-active/);
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

  // 标签页（M660 #7，Alex 2026-10-24：「现在 TAB 上显示 read-only，但区分度不够，是否有其他
  // 图像化表达，比如 TAB 上能改为一个小图标」）：可见文字只剩文件名，只读态改由**锁形图标**
  // 表达（`.tab-readonly`，细线 SVG、aria-hidden——它不参与可访问名）；悬停提示仍是**完整绝对
  // 路径**；读屏名仍是 D579 的「{名称}（vault 外只读）」，语义零损失。
  // 旧的可见文字后缀（D578「· 只读」）随本改动退场：可见侧不再有「只读」二字。
  const tab = page.locator(".tab-open").filter({ hasText: "draft.md" });
  await expect(tab.locator(".tab-name")).toHaveText("draft.md");
  await expect(tab).not.toContainText("只读");
  const lock = tab.locator(".tab-readonly");
  await expect(lock).toHaveCount(1);
  await expect(lock).toHaveAttribute("aria-hidden", "true");
  await expect(lock.locator("svg")).toHaveCount(1);
  await expect(tab).toHaveAttribute("title", EXTERNAL_PATH);
  await expect(tab).toHaveAttribute("aria-label", "draft.md（vault 外只读）");
  // 负向对照：vault 内标签不得带这枚图标（判据是 `session.external`，不是「所有标签」）。
  // 开一个 vault 内文件看一眼再关掉——用例末尾按「标签总数 1」判去重，这里不能留残局。
  await page.locator('.ft-row[title="notes/plan.md"]').click();
  const vaultTab = page.locator(".tab").filter({ hasText: "plan.md" });
  await expect(vaultTab.locator(".tab-readonly")).toHaveCount(0);
  await vaultTab.locator(".tab-close").click();
  await page.locator(".tab-open").filter({ hasText: "draft.md" }).click();

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

  // 「不生效**并给一次性提示**」（D2 追加裁决 ③ / D584）：第一次键入就给一句说明，
  // 同一会话里继续键入不重复（每会话一次——去重按会话对象记，见 src/editor.ts 的探针）
  const hint = page.locator(".lumir-toast").filter({ hasText: "vault 外的文件以只读方式打开" });
  await expect(hint).toHaveCount(1);
  await page.keyboard.type("AGAIN");
  await expect(hint).toHaveCount(1);
  await expect(page.locator(".lumir-toast")).toHaveCount(1, { timeout: 2000 });

  // ⌘S 无落点：没有任何写类 invoke，也不出现保存失败提示
  const before = await invokes(page);
  await page.keyboard.press("Meta+s");
  await page.waitForTimeout(150);
  const after = await invokes(page);
  expect(after.slice(before.length)).not.toContain("document_save");
  // 提示条此刻若还在场，只能是上面那条只读说明——MUST NOT 混进「尚未可保存」一类保存失败文案
  await expect(page.locator(".lumir-toast").filter({ hasText: "尚未可保存" })).toHaveCount(0);

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

test("vault 外路径不存在：Enter 前是尝试行（不断言不存在），Enter 后按找不到处置、浮层保持打开", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await expandDir(page, "notes", "notes/plan.md");

  await openQuickOpen(page);
  await page.keyboard.type("/tmp/lumir-verify/nope.md");
  // Enter 之前：vault 外路径在读取前判不了存在性 ⇒ 给一条**尝试行**，MUST NOT 先声称
  // 「没有匹配的条目」（M697 的缺陷面：结果区否认了 Enter 能做的事）。
  await expect(page.locator(".lumir-qo-direct-path")).toHaveText(
    "按 Enter 只读打开 /tmp/lumir-verify/nope.md",
  );
  await expect(page.locator(".lumir-qo-empty")).toBeHidden();
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

// ---------------------------------------------------------------------------
// 5）结果区与 Enter 同源（M700，change quick-open-file-oct23 的「判决同源」requirement）
//
// 判据纪律：直接行用**独立 class** `.lumir-qo-direct` 逐段断言（动作文本 + 落点行标记），
// 「没有匹配的条目」用 `.lumir-qo-empty` 的可见性判——这两条就是 M697 的缺陷面。
// ---------------------------------------------------------------------------

test("vault 外绝对路径：Enter 前就有直接行、不落空态、游标在直接行，Enter 只读打开", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await expandDir(page, "notes", "notes/plan.md");

  await openQuickOpen(page);
  await page.keyboard.type(EXTERNAL_PATH);
  const direct = page.locator(".lumir-qo-direct");
  await expect(direct).toHaveCount(1);
  await expect(direct.locator(".lumir-qo-direct-path")).toHaveText(
    `按 Enter 只读打开 ${EXTERNAL_PATH}`,
  );
  await expect(page.locator(".lumir-qo-empty")).toBeHidden();
  // 直接行与候选同一个游标空间：默认游标停在直接行，aria-activedescendant 指向它
  const directId = await direct.getAttribute("id");
  await expect(direct).toHaveClass(/is-active/);
  await expect(page.locator(".lumir-qo-input")).toHaveAttribute(
    "aria-activedescendant",
    directId as string,
  );

  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".tab-open")).toHaveText(["draft.md"]);
  await expect(page.locator(".modeline-meta")).toContainText("vault 外 · 只读");
  expect(await editorFacts(page).then((facts) => facts.readOnly)).toBe(true);
});

test("vault 外路径带行号：直接行标明落点行，Enter 落到第 12 行（只读语义不变）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openQuickOpen(page);
  await page.keyboard.type(`${EXTERNAL_LONG_PATH}:12`);

  await expect(page.locator(".lumir-qo-direct-path")).toHaveText(
    `按 Enter 只读打开 ${EXTERNAL_LONG_PATH}`,
  );
  await expect(page.locator(".lumir-qo-direct-line")).toHaveText("第 12 行");
  await expect(page.locator(".lumir-qo-empty")).toBeHidden();

  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect.poll(() => editorFacts(page).then((facts) => facts.line)).toBe(12);
  const facts = await editorFacts(page);
  expect(facts.text).toBe(EXTERNAL_LONG_DOC);
  expect(facts.readOnly).toBe(true);
});

test("索引内相对路径：直接行与候选并存（互不抑制），Enter 打开直接行", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openQuickOpen(page);
  await page.keyboard.type("notes/plan.md");

  await expect(page.locator(".lumir-qo-direct-path")).toHaveText("按 Enter 打开 notes/plan.md");
  await expect(page.locator(".lumir-qo-item")).toHaveText(["notes/plan.md"]);
  await expect(page.locator(".lumir-qo-empty")).toBeHidden();
  await expect(page.locator(".lumir-qo-hint")).toHaveText("命中 1 条");

  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".tab-open")).toHaveText(["plan.md"]);
});

test("折叠等值唯一命中：直接行显示索引里的路径（不是输入串），Enter 打开该文件", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openQuickOpen(page);
  await page.keyboard.type("NOTES/PLAN.md");

  await expect(page.locator(".lumir-qo-direct-path")).toHaveText("按 Enter 打开 notes/plan.md");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".tab-open")).toHaveText(["plan.md"]);
  await expect(page.locator(".cm-content")).toContainText("PLAN-MARKER");
});

test("折叠多命中：第一次 Enter 只揭示候选（不猜），↑↓ 后第二次 Enter 打开游标行", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openQuickOpen(page);
  await page.keyboard.type("A.MD");

  await expect(page.locator(".lumir-qo-item")).toHaveText(["A.md", "a.md"]);
  await expect(page.locator(".lumir-qo-direct")).toHaveCount(0);
  await page.keyboard.press("Enter");
  // 第一段：浮层不收起、没有打开任何文件，提示说明为什么
  await expect(page.locator(".lumir-qo")).toBeVisible();
  await expect(page.locator(".lumir-qo-hint")).toHaveText("匹配到多个文件，用 ↑↓ 选择后按 Enter 打开");
  await expect(page.locator(".tab-open")).toHaveCount(0);
  // 第二段：游标移到第二条后 Enter 打开它
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".lumir-qo-item.is-active")).toHaveText("a.md");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".tab-open")).toHaveText(["a.md"]);
  await expect(page.locator(".cm-content")).toContainText("A-LOWER-MARKER");
});

test("目录输入：无直接行，第一次 Enter 只给「是目录」原因，第二次打开游标候选", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openQuickOpen(page);
  await page.keyboard.type("notes");

  await expect(page.locator(".lumir-qo-direct")).toHaveCount(0);
  await expect(page.locator(".lumir-qo-item")).toHaveText(["notes/plan.md", "notes/spec.md"]);
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeVisible();
  await expect(page.locator(".lumir-qo-hint")).toHaveText("notes 是目录，不能打开");
  await expect(page.locator(".tab-open")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".tab-open")).toHaveText(["plan.md"]);
});

test("索引外的惰性文件：探测命中后给直接行（相对 / vault 内绝对同形），Enter 打开", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await stubPathsExist(page, [LAZY_PATH]);
  await openQuickOpen(page);
  await page.keyboard.type(LAZY_PATH);

  // 探测在途期间 MUST NOT 先落空态；补帧之后直接行出现
  await expect(page.locator(".lumir-qo-direct-path")).toHaveText(`按 Enter 打开 ${LAZY_PATH}`);
  await expect(page.locator(".lumir-qo-empty")).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".tab-open")).toHaveText(["notes.md"]);
  await expect(page.locator(".cm-content")).toContainText("LAZY-700-MARKER");

  // vault 内绝对路径收敛成同一个相对路径（与相对路径同一份解析）
  await openQuickOpen(page);
  await page.keyboard.type(`/v/${LAZY_PATH}`);
  await expect(page.locator(".lumir-qo-direct-path")).toHaveText(`按 Enter 打开 ${LAZY_PATH}`);
});

test("探测迟到：旧结果不得覆盖新输入（去抖 + 请求序号）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  // 400ms 后才回的探测：留出「输入已改、结果在路上」的窗口
  await stubPathsExist(page, [LAZY_PATH], 400);
  await openQuickOpen(page);
  await page.keyboard.type(LAZY_PATH);
  // 等去抖（120ms）过去，探测已在途；此时把输入换成另一条
  await page.waitForTimeout(180);
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("notes/");

  await expect(page.locator(".lumir-qo-item")).toHaveText(["notes/plan.md", "notes/spec.md"]);
  // 迟到结果（`.local/notes.md` 存在）不得画到新输入上
  await page.waitForTimeout(600);
  await expect(page.locator(".lumir-qo-direct")).toHaveCount(0);
  await expect(page.locator(".lumir-qo-item")).toHaveText(["notes/plan.md", "notes/spec.md"]);
});

test("真负例：没有匹配的条目在场、没有直接行；Enter 后仍「找不到」且不打开", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openQuickOpen(page);
  await page.keyboard.type("notes/nope.md");

  await expect(page.locator(".lumir-qo-direct")).toHaveCount(0);
  await expect(page.locator(".lumir-qo-empty")).toBeVisible();
  await expect(page.locator(".lumir-qo-empty")).toHaveText("没有匹配的条目");
  await expect(page.locator(".lumir-qo-item")).toHaveCount(0);

  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeVisible();
  await expect(page.locator(".lumir-qo-hint")).toHaveText("找不到：notes/nope.md");
  await expect(page.locator(".tab-open")).toHaveCount(0);
  // Enter 的判决是终态：补帧（同一输入的探测缓存）MUST NOT 把提示覆盖回用法行
  await page.waitForTimeout(300);
  await expect(page.locator(".lumir-qo-hint")).toHaveText("找不到：notes/nope.md");
});

test("候选上限：直接行不占候选名额，候选只渲染 100 条并显示总数，游标不越第 100 条", async ({ page }) => {
  await stubTauri(page, BULK);
  await page.goto("/");
  await openQuickOpen(page);
  await page.keyboard.type("bulk");

  await expect(page.locator(".lumir-qo-direct-path")).toHaveText("按 Enter 打开 bulk");
  await expect(page.locator(".lumir-qo-item")).toHaveCount(100);
  await expect(page.locator(".lumir-qo-hint")).toHaveText("命中 301 条，只显示前 100 条");

  // 游标从直接行一路往下压到底：夹在最后一条候选上，MUST NOT 越过第 100 条
  await page.evaluate(() => {
    const input = document.querySelector(".lumir-qo-input") as HTMLInputElement;
    for (let i = 0; i < 120; i += 1) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    }
  });
  const last = page.locator(".lumir-qo-item").last();
  await expect(last).toHaveClass(/is-active/);
  // 候选从 `bulk` 自己开始（它也是路径子串命中），第 100 条因此是 entry-098：
  // 游标夹在渲染出的最后一条上，MUST NOT 越过第 100 条。
  await expect(last).toHaveText("bulk-index/entry-098.md");
});

test("直接行点击：与 Enter 同一目标（mousedown 不夺焦，点击后浮层收起并打开）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openQuickOpen(page);
  await page.keyboard.type(EXTERNAL_PATH);

  await page.locator(".lumir-qo-direct").click();
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".tab-open")).toHaveText(["draft.md"]);
});
