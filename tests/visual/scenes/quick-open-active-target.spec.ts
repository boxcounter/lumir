import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// Quick Open「高亮项必须等于 Enter 目标」（change quick-open-active-target）的可见行为矩阵。
//
// 为什么要有这个场景：缺陷在 DOM 层才看得见——旧的 `apply()` 恒把游标放在首条真实候选，
// 而 `confirm()` 在用户未主动移动时绕过游标直接打开精确路径。输入 `plan.md` 命中
// `notes/plan.md` / `apps/plan.md` / `plan.md` 三条时，屏幕高亮第一条、Enter 打开第三条。
//
// 判据纪律：每条用例同时读**高亮行**（`.lumir-qo-item.is-active` 的逐条文本）、**ARIA**
// （`aria-activedescendant` 指向同一行）与**实际打开的文档**（正文 marker）——只断言其中
// 之一会把「高亮≠目标」重新放进来。目录两段式、lazy、外部只读与 `path:line` 的既有合同
// 在这里是同批回归面：它们不得随本次改动变化。
//
// 角落（「普通查询 = 索引外精确路径且是其它候选子串」）：判决在探测落地前是未定的——探测
// 命中时 Enter 打开候选之外的那条路径，不命中时才落到首行。未定期间 MUST NOT 高亮任何行
// （旧实现亮首行、Enter 却打开索引外文件）；本场景用一条带延迟的探测把「在途」与「落地」
// 两段都钉住，并证明落地后仍不亮、Enter 打开的是那条精确路径。
//
// 本场景不覆盖：解析次序矩阵（tests/unit/quick-open.test.ts）、纯策略起点与异步保位/回落
// 的纯函数判据（同文件的「游标起点」「异步补帧的保位」段）、真机 WKWebView 手感
// （验收场景 230a/230b/230c/230d/231/874）。

/** `notes/plan.md`：20 行，第 12 行有 marker（`notes/plan.md:12` 的落点判据）。 */
const NOTES_PLAN_LINES: string[] = ["# Plan", "", "QO-TARGET-PLAN", ""];
while (NOTES_PLAN_LINES.length < 20) {
  NOTES_PLAN_LINES.push(`notes plan 第 ${NOTES_PLAN_LINES.length + 1} 行：落点判据的填充内容。`);
}
NOTES_PLAN_LINES[11] = "QO-TARGET-NOTES-L12";
const PLAN = `${NOTES_PLAN_LINES.join("\n")}\n`;
const GUIDE = "# Guide\n\nQO-TARGET-GUIDE\n";
const APPS_PLAN = "# Apps plan\n\nQO-TARGET-APPS-PLAN\n";
const DEEP = "# Deep\n\nQO-TARGET-DEEP\n";
const UPPER = "# Upper\n\nQO-TARGET-UPPER\n";
const LOWER = "# Lower\n\nQO-TARGET-LOWER\n";

/** 根目录的 `plan.md`：20 行，第 12 行有 marker（`plan.md:12` 的落点判据）。 */
const ROOT_PLAN_LINES: string[] = ["# Root plan", ""];
while (ROOT_PLAN_LINES.length < 20) {
  ROOT_PLAN_LINES.push(`根 plan 第 ${ROOT_PLAN_LINES.length + 1} 行：落点判据的填充内容。`);
}
ROOT_PLAN_LINES[11] = "QO-TARGET-ROOT-L12";
const ROOT_PLAN = `${ROOT_PLAN_LINES.join("\n")}\n`;

/** 索引外的惰性文件：探测可得，但不在普通索引里（`fs_paths_exist` 桩回答存在）。 */
const LAZY_PATH = ".local/lazy-notes.md";
const LAZY_DOC = "# Lazy\n\nQO-TARGET-LAZY\n";

/**
 * 角落现场：根层 `scratch.md` **在盘上但不在索引里**（被忽略规则挡在枚举之外），索引里只有
 * 同子串的 `apps/scratch.md` / `drafts/scratch.md`。输入 `scratch.md` 因此在同步层是
 * `undecided`，探测命中后 Enter 打开候选之外的根层文件。
 */
const ROOT_SCRATCH = "# Root scratch\n\nQO-TARGET-SCRATCH\n";
const DRAFTS_SCRATCH = "# Drafts scratch\n\nQO-TARGET-DRAFTS-SCRATCH\n";
const APPS_SCRATCH = "# Apps scratch\n\nQO-TARGET-APPS-SCRATCH\n";

/** vault 外只读文档：20 行，第 12 行有 marker。 */
const EXTERNAL_PATH = "/tmp/lumir-verify/active-target.md";
const EXTERNAL_LINES: string[] = ["# External", ""];
while (EXTERNAL_LINES.length < 20) {
  EXTERNAL_LINES.push(`外部第 ${EXTERNAL_LINES.length + 1} 行：落点判据的填充内容。`);
}
EXTERNAL_LINES[11] = "QO-TARGET-EXTERNAL-L12";
const EXTERNAL_DOC = `${EXTERNAL_LINES.join("\n")}\n`;

/**
 * 索引顺序刻意让 **判决行不在首位**：`plan.md` 排在 `notes/plan.md` / `apps/plan.md` 之后。
 * 这正是旧实现判红的位置——旧策略高亮第一条，Enter 却打开第三条。
 */
const VAULT: VaultFixture = {
  root: "/v",
  entries: [
    { path: "notes", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "drafts", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "apps", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "notes/plan.md", kind: "file", size: PLAN.length, mtime_ms: 0 },
    { path: "notes/guide.md", kind: "file", size: GUIDE.length, mtime_ms: 0 },
    { path: "notes/sub", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "notes/sub/deep.md", kind: "file", size: DEEP.length, mtime_ms: 0 },
    { path: "apps/plan.md", kind: "file", size: APPS_PLAN.length, mtime_ms: 0 },
    { path: "apps/scratch.md", kind: "file", size: APPS_SCRATCH.length, mtime_ms: 0 },
    { path: "drafts/scratch.md", kind: "file", size: DRAFTS_SCRATCH.length, mtime_ms: 0 },
    { path: "plan.md", kind: "file", size: ROOT_PLAN.length, mtime_ms: 0 },
    { path: "A.md", kind: "file", size: UPPER.length, mtime_ms: 0 },
    { path: "a.md", kind: "file", size: LOWER.length, mtime_ms: 0 },
  ],
  files: {
    "notes/plan.md": PLAN,
    "notes/guide.md": GUIDE,
    "notes/sub/deep.md": DEEP,
    "apps/plan.md": APPS_PLAN,
    "apps/scratch.md": APPS_SCRATCH,
    "drafts/scratch.md": DRAFTS_SCRATCH,
    "plan.md": ROOT_PLAN,
    "A.md": UPPER,
    "a.md": LOWER,
    // 只有读取表、没有 entries 行 = 盘上存在但不在索引（惰性 / 被忽略规则挡住）
    "scratch.md": ROOT_SCRATCH,
    [LAZY_PATH]: LAZY_DOC,
  },
  externalFiles: { [EXTERNAL_PATH]: EXTERNAL_DOC },
  links: {},
};

/** 给桩补 `fs_paths_exist`：惰性文件的探测在真后端由忽略规则产生。`delayMs` 造「探测在途」。
 *  每次应答落进 `__probeAnswers`——断言可以钉在「探测已经回来之后」，而不是靠猜时间。 */
async function stubPathsExist(page: Page, present: string[], delayMs = 0): Promise<void> {
  await page.evaluate(
    ({ present, delayMs }) => {
      const w = window as unknown as { __probeAnswers?: Array<{ paths: string[]; found: string[] }> };
      w.__probeAnswers = [];
      const internals = (
        w as unknown as {
          __TAURI_INTERNALS__: { invoke: (...args: any[]) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      const inner = internals.invoke.bind(internals);
      internals.invoke = async (cmd: string, args?: { paths?: string[] }, ...rest: unknown[]) => {
        if (cmd !== "fs_paths_exist") return inner(cmd, args, ...rest);
        const paths = args?.paths ?? [];
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        const found = paths.filter((path) => present.includes(path));
        (w.__probeAnswers ??= []).push({ paths, found });
        return found;
      };
    },
    { present, delayMs },
  );
}

/** 已经应答过的探测次数（>0 表示第一级探测回来了，`path:line` 的第二级是 2）。 */
function probeAnswers(page: Page): Promise<number> {
  return page.evaluate(
    () => ((window as unknown as { __probeAnswers?: unknown[] }).__probeAnswers ?? []).length,
  );
}

async function openQuickOpen(page: Page): Promise<void> {
  // 就绪门：文件树渲染出第一条行 = vault 装载完成（⌘P 的绑定在装配末尾才接好）。
  await expect(page.locator(".ft-row").first()).toBeVisible();
  await page.keyboard.press("Meta+p");
  await expect(page.locator(".lumir-qo")).toBeVisible();
  await expect(page.locator(".lumir-qo-input")).toBeFocused();
}

async function start(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openQuickOpen(page);
}

async function fill(page: Page, value: string): Promise<void> {
  await page.locator(".lumir-qo-input").fill(value);
}

/** 真 CM view 的光标行号（落点判据）。 */
function cursorLine(page: Page): Promise<number> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } })
      .cmTile.root.view;
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  });
}

/** 高亮行、ARIA 指向与「至多一个高亮」一起读——三者必须同时成立。 */
async function expectActiveRow(page: Page, text: string): Promise<void> {
  const active = page.locator(".lumir-qo-item.is-active");
  await expect(active).toHaveCount(1);
  await expect(active).toHaveText(text);
  await expect(active).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".lumir-qo-input")).toHaveAttribute(
    "aria-activedescendant",
    (await active.getAttribute("id")) ?? "",
  );
}

/** 无高亮：没有 `.is-active`、没有任何 `aria-selected=true`、input 不报 activedescendant。 */
async function expectNoActiveRow(page: Page): Promise<void> {
  await expect(page.locator(".lumir-qo-item.is-active")).toHaveCount(0);
  await expect(page.locator('.lumir-qo-item[aria-selected="true"]')).toHaveCount(0);
  await expect(page.locator(".lumir-qo-input")).not.toHaveAttribute("aria-activedescendant", /.+/);
}

// ---------------------------------------------------------------------------
// 1）精确路径：高亮行 = Enter 目标
// ---------------------------------------------------------------------------

test("精确路径唯一候选：高亮该行，Enter 打开同一路径", async ({ page }) => {
  await start(page);
  await fill(page, "notes/plan.md");

  await expect(page.locator(".lumir-qo-direct")).toHaveCount(0);
  await expect(page.locator(".lumir-qo-item")).toHaveText(["notes/plan.md"]);
  await expectActiveRow(page, "notes/plan.md");

  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".tab-open")).toHaveText(["plan.md"]);
  await expect(page.locator(".cm-content")).toContainText("QO-TARGET-PLAN");
});

test("精确路径多候选且判决行不在首位：高亮判决行（不是首行），Enter 直接打开它", async ({ page }) => {
  await start(page);
  await fill(page, "plan.md");

  await expect(page.locator(".lumir-qo-direct")).toHaveCount(0);
  await expect(page.locator(".lumir-qo-item")).toHaveText([
    "notes/plan.md",
    "apps/plan.md",
    "plan.md",
  ]);
  // 旧实现这里高亮 notes/plan.md（首行），而 Enter 打开 plan.md —— 本用例的判红点。
  await expectActiveRow(page, "plan.md");

  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("QO-TARGET-ROOT-L12");
});

test("移动后覆盖默认：↑ 到 apps/plan.md 后 Enter 只打开游标行", async ({ page }) => {
  await start(page);
  await fill(page, "plan.md");
  await expectActiveRow(page, "plan.md");

  await page.keyboard.press("ArrowUp");
  await expectActiveRow(page, "apps/plan.md");

  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("QO-TARGET-APPS-PLAN");
});

test("普通过滤查询：探测落地后首行高亮，Enter 打开首行（默认承诺不回归）", async ({ page }) => {
  await start(page);
  await fill(page, "plan");
  await expect(page.locator(".lumir-qo-item")).toHaveText([
    "notes/plan.md",
    "apps/plan.md",
    "plan.md",
  ]);
  // 普通查询的同步判决也是 undecided：探测落地为「找不到」后才回落到首行
  await expectActiveRow(page, "notes/plan.md");

  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("QO-TARGET-PLAN");
});

// 角落：普通 query 恰好是**索引外**文件的精确路径，同时又命中索引内的同子串候选。
// 旧实现：有候选的普通查询不发起探测 ⇒ 同步 undecided 直接高亮首行（apps/scratch.md），
// 按下 Enter 后完整探测改判为 `open scratch.md`（盘上的根层文件）——屏幕承诺与 Enter 目标
// 分叉，与原始缺陷同类。修后：未定期间不亮任何行，落地为候选外路径后同样不亮，Enter 打开它。
test("普通查询 = 索引外精确路径且是其它候选子串：未定与落地都不亮，Enter 打开那条精确路径", async ({ page }) => {
  await start(page);
  await stubPathsExist(page, ["scratch.md"], 400);
  await fill(page, "scratch.md");

  await expect(page.locator(".lumir-qo-item")).toHaveText(["apps/scratch.md", "drafts/scratch.md"]);
  // 判红点（旧实现）：填完立刻高亮 apps/scratch.md，而 Enter 打开 scratch.md
  await expectNoActiveRow(page);

  // 探测在途（去抖 120ms + 400ms 应答）：目标未定，不亮
  await page.waitForTimeout(200);
  await expectNoActiveRow(page);

  // 探测已回来：判决是 `open scratch.md`，它不在候选里 ⇒ 落地之后也 MUST NOT 亮任何行
  await expect.poll(() => probeAnswers(page)).toBeGreaterThan(0);
  await page.waitForTimeout(150);
  await expectNoActiveRow(page);

  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".tab-open")).toHaveText(["scratch.md"]);
  await expect(page.locator(".cm-content")).toContainText("QO-TARGET-SCRATCH");
});

test("path:line 异步补帧：在途不高亮，落地后高亮判决行并保留行号落点", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await stubPathsExist(page, ["plan.md"], 400);
  await openQuickOpen(page);
  await fill(page, "plan.md:12");

  // 探测在途（去抖 120ms + 两级探测各 400ms）：目标还没定，禁止用首行冒充
  await page.waitForTimeout(200);
  await expect(page.locator(".lumir-qo-item")).toHaveText([
    "notes/plan.md",
    "apps/plan.md",
    "plan.md",
  ]);
  await expectNoActiveRow(page);

  // 落地：判决路径 = plan.md（非首行），高亮与 ARIA 一起挪到判决行
  await expect(page.locator(".lumir-qo-item.is-active")).toHaveText("plan.md", { timeout: 5000 });
  await expectActiveRow(page, "plan.md");

  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect.poll(() => cursorLine(page)).toBe(12);
  await expect(page.locator(".cm-content")).toContainText("QO-TARGET-ROOT-L12");
});

// 异步保位的判别现场：判决行是第三条 `plan.md`，用户在探测在途时移到第二条 `apps/plan.md`。
// 探测落地只补画结果区——按行身份保位停在 apps/plan.md；若实现回落到策略起点，游标会跳到
// 判决行 plan.md（两条路径的打开 marker 不同，测试因此能分辨这两种实现）。
test("探测在途移到非判决行：落地后按行身份保位（不被挪回判决行），Enter 打开保位行", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await stubPathsExist(page, ["plan.md"], 400);
  await openQuickOpen(page);
  await fill(page, "plan.md:12");

  // 两级探测都还没回来：目标未定，不亮
  await page.waitForTimeout(200);
  await expect(page.locator(".lumir-qo-item")).toHaveText([
    "notes/plan.md",
    "apps/plan.md",
    "plan.md",
  ]);
  await expectNoActiveRow(page);

  // 用户移到非判决行：apps/plan.md（判决行是第三条 plan.md）
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expectActiveRow(page, "apps/plan.md");

  // 落地之后仍停在这一行（保位）；回落到策略起点的话这里会变成 plan.md
  await expect.poll(() => probeAnswers(page)).toBeGreaterThan(0);
  await page.waitForTimeout(150);
  await expectActiveRow(page, "apps/plan.md");

  // 主动移动过 ⇒ Enter 接受游标行（不打 `:12` 落点：行号只属于判决路径的精确打开）
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".tab-open")).toHaveText(["plan.md"]);
  await expect(page.locator(".cm-content")).toContainText("QO-TARGET-APPS-PLAN");
  await expect.poll(() => cursorLine(page)).toBe(1);
});

test("游标落在判决行本身：在途 ↓ 后 Enter 仍落到 :行（移动不吃掉行号）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await stubPathsExist(page, ["notes/plan.md"], 400);
  await openQuickOpen(page);
  await fill(page, "notes/plan.md:12");

  // 探测在途：按合同不高亮；此时按 ↓ 落在唯一候选上（= 判决路径），形成「移动过」的状态
  await page.waitForTimeout(200);
  await expect(page.locator(".lumir-qo-item")).toHaveText(["notes/plan.md"]);
  await expectNoActiveRow(page);
  await page.keyboard.press("ArrowDown");
  await expectActiveRow(page, "notes/plan.md");

  // 游标行就是判决行 ⇒ 仍按精确路径打开并保留粘贴时的行号（不是 openRow 的第 1 行）
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect.poll(() => cursorLine(page)).toBe(12);
  await expect(page.locator(".cm-content")).toContainText("QO-TARGET-NOTES-L12");
});

// ---------------------------------------------------------------------------
// 2）direct-only：可打开但无对应候选行 ⇒ 不高亮，Enter 仍直接打开
// ---------------------------------------------------------------------------

test("direct-only（lazy / vault 外）：不高亮任何行，Enter 仍直接打开", async ({ page }) => {
  await start(page);
  await stubPathsExist(page, [LAZY_PATH]);
  await fill(page, LAZY_PATH);
  await page.waitForTimeout(250);

  await expect(page.locator(".lumir-qo-direct")).toHaveCount(0);
  await expect(page.locator(".lumir-qo-item")).toHaveCount(0);
  await expect(page.locator(".lumir-qo-empty")).toBeHidden();
  await expectNoActiveRow(page);

  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("QO-TARGET-LAZY");

  // vault 外绝对路径 + 行号：同一条「无候选也不亮」的路径，Enter 仍只读落第 12 行
  await openQuickOpen(page);
  await fill(page, `${EXTERNAL_PATH}:12`);
  await expect(page.getByRole("option")).toHaveCount(0);
  await expectNoActiveRow(page);
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect.poll(() => cursorLine(page)).toBe(12);
  await expect(page.locator(".cm-content")).toContainText("QO-TARGET-EXTERNAL-L12");
});

// ---------------------------------------------------------------------------
// 3）目录：两段式与进入子目录的既有合同不回归
// ---------------------------------------------------------------------------

test("目录语境：首行高亮，两段式 Enter 与进入子目录后的复位不回归", async ({ page }) => {
  await start(page);
  // 裸目录（无尾斜杠）才是两段式；尾斜杠是「一次接受当前候选」的另一条既有合同。
  await fill(page, "notes");
  await expect(page.locator(".lumir-qo-item")).toHaveText([
    "notes/plan.md",
    "notes/guide.md",
    "notes/sub/",
  ]);
  await expectActiveRow(page, "notes/plan.md");

  // 两段式：第一次 Enter 只揭示原因，游标不动
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo-hint")).toHaveText("notes 是目录，不能打开");
  await expectActiveRow(page, "notes/plan.md");

  // 移到子目录并接受：进入下一层，游标复位到新的首行
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expectActiveRow(page, "notes/sub/");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo-input")).toHaveValue("notes/sub/");
  await expect(page.locator(".lumir-qo-item")).toHaveText(["notes/sub/deep.md"]);
  await expectActiveRow(page, "notes/sub/deep.md");
});
