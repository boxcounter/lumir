import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M632（change add-path-line-range-links）的**渲染面**断言，并经 change
// add-path-line-target-highlight-nov02 扩展到「点击后的瞬态行高亮」：
//
//   1. 整段（含 `:起-止`）是一个可点元素，展示文本逐字不变；畸形范围（`止 < 起`）只链接
//      路径本身、后缀留作普通文本（不吞半截）。
//   2. 点击行范围 → 文件在新标签打开、第 `起` 行滚进视口（居中由既有 `revealLine` 算式保证，
//      本场景只判「进了视口」）；**选区保持折叠**（不选中行范围），文档正文逐字节不变；第
//      `起`…`止` 行（闭区间）获得 `.cm-line-highlight` 行装饰。
//   3. 单行 / 行列形态只高亮一行；再次点击另一条链接整块替换（不叠加）；切标签清除；
//      约 1.4s 自动消退，且消退计时在重复点击时重置。
//   4. 三主题（light / dark / eink）下高亮底色非透明、且区别于普通行底色（eink 的 10% 黑
//      覆写在计算值上可判）。
//
// 判据为什么这样写：几何与选区读数取自真 CM view（`.cm-content` 的 `cmTile.root.view`，
// 与 reading-position / m281 同一口径）。「第一行落点」与「没有落点」是**同一份文档上的
// 一组对照**——先点畸形链接（打开在篇首、scrollTop 恒 0、目标行未渲染），再点行范围链接
//（同一标签内滚到第 120 行）。只写正向那半的话，「打开就在第 120 行附近」这类假绿看不出来。
// 高亮的判据读 `.cm-line.cm-line-highlight`（CM 的行装饰就落在 `.cm-line` 上）与计算背景色；
// 计时相关的断言都在 1.4s 窗口内取值，靠「高亮出现 → 立即读」而不是固定 sleep 取巧。
//
// 本场景不覆盖（如实登记）：三种形态的解析边界与畸形矩阵、装饰集的越界 / 上限 / 替换语义在
// `tests/unit/harness-path-link.test.ts`；工具卡片 / 快速打开 / wikilink / ⌥G 不产生高亮由
// 单测（`lineEnd` 不传递即零调用）与代码路径核对承担；真机 WKWebView 的同一链路与 prompt
// 遵从度在 `scripts/acceptance/scenarios/221-*`（AX 读不到装饰类名，真机层只能截图判读）。
// 无新像素基线：元素形态复用既有 `.lumir-hp-pathlink` 与 CM 行装饰，本场景只做结构 / 计算属性断言。

const FILLER = (n: number): string => `第 ${String(n).padStart(3, "0")} 行：行范围跳转的填充内容。`;

/** 起点行（链接写作 `:120-140`）与目标行原文。 */
const START_LINE = 120;
const END_LINE = 140;
const RANGE_LINES = END_LINE - START_LINE + 1;
const TARGET_LINE_TEXT = "LR-632-L120-TARGET";
/** 单行 / 行列形态的目标行（正文里另给两条链接）。 */
const SINGLE_LINE = 5;
const COLUMN_LINE = 7;

const DOC_LINES: string[] = ["# 行范围目标", ""];
while (DOC_LINES.length < END_LINE + 20) DOC_LINES.push(FILLER(DOC_LINES.length + 1));
DOC_LINES[START_LINE - 1] = TARGET_LINE_TEXT;
const TARGET_DOC = `${DOC_LINES.join("\n")}\n`;

const RANGE_TEXT = `range-note.md:${START_LINE}-${END_LINE}`;
const SINGLE_TEXT = `range-note.md:${SINGLE_LINE}`;
const COLUMN_TEXT = `range-note.md:${COLUMN_LINE}:3`;
const MALFORMED_TEXT = `range-note.md:${END_LINE}-${START_LINE}`;
/** 回复正文：一条合法行范围 + 单行 / 行列两条单行形态 + 一条 `止 < 起` 的畸形写法
 *  （路径名相同，便于对照同一标签）。 */
const BODY = `行范围验收：第 ${START_LINE}–${END_LINE} 行在 ${RANGE_TEXT}，单行 ${SINGLE_TEXT}，行列 ${COLUMN_TEXT}，畸形写法 ${MALFORMED_TEXT} 只该链接到文件本身。`;

const NOTE_DOC = "# 行范围验收笔记\n\n给 harness 面板一个前台文档。\n";

const VAULT: VaultFixture = {
  entries: [
    { path: "harness-note.md", kind: "file", size: NOTE_DOC.length, mtime_ms: 0 },
    { path: "range-note.md", kind: "file", size: TARGET_DOC.length, mtime_ms: 0 },
  ],
  files: { "harness-note.md": NOTE_DOC, "range-note.md": TARGET_DOC },
  links: {},
};

const EMPTY_USAGE = { ctx_pct: 0, cache_pct_session: 0 };

/** harness 面板的初值桩：一条 assistant 消息承载本场景的四种后缀形态。 */
async function stubHarness(page: Page): Promise<void> {
  const snapshot = {
    messages: [{ role: "assistant", text: BODY, ts: Math.floor(Date.now() / 1000) - 30 }],
    usage: EMPTY_USAGE,
    pending_approval: null,
    warn_ctx_pct: 85,
  };
  await page.addInitScript((snap) => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
      if (cmd === "harness_state") return JSON.stringify(snap);
      if (cmd === "harness_list_sessions") return [];
      return invoke(cmd, args);
    };
  }, snapshot);
}

async function openPanel(
  page: Page,
  config?: { theme?: "light" | "dark" | "eink" },
): Promise<void> {
  await stubTauri(page, config === undefined ? VAULT : { ...VAULT, config });
  await stubHarness(page);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("行范围验收笔记");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

/** 面板正文里按**可见文本**取路径链接（面板给每个候选一个 `.lumir-hp-pathlink`）。 */
const pathLink = (page: Page, text: string) =>
  page.locator(".lumir-hp-pathlink").filter({ hasText: new RegExp(`^${text}$`) });

/** 反斜杠转义 `.`：可见文本按正则精确匹配。 */
const exact = (text: string): string => text.replace(/\./g, "\\.");

/** 等行装饰的数量恰好是 `expected`（出现即返回；默认超时高于打开链路的 IPC 往返）。 */
async function waitForHighlightCount(page: Page, expected: number): Promise<void> {
  await page.waitForFunction(
    (count) => document.querySelectorAll(".cm-line.cm-line-highlight").length === count,
    expected,
    { timeout: 3000, polling: 20 },
  );
}

/** 当前行装饰覆盖的行文本（文档序）。 */
function highlightedTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".cm-line.cm-line-highlight")).map(
      (el) => el.textContent ?? "",
    ),
  );
}

/** 第 `line` 行的可见文本（FILLER 约定；第 120 行是目标行原文）。 */
const lineText = (line: number): string => (line === START_LINE ? TARGET_LINE_TEXT : FILLER(line));

/** 真 CM view 的读数：选区是否折叠、光标在文档第几行、文档正文。 */
function editorFacts(page: Page): Promise<{
  empty: boolean;
  from: number;
  to: number;
  head: number;
  line: number;
  doc: string;
  scrollTop: number;
}> {
  return page.evaluate(() => {
    const host = document.querySelector(".cm-content") as unknown as {
      cmTile: {
        root: {
          view: {
            state: {
              selection: { main: { empty: boolean; from: number; to: number; head: number } };
              doc: { lineAt(pos: number): { number: number }; toString(): string };
            };
            scrollDOM: { scrollTop: number };
          };
        };
      };
    };
    const view = host.cmTile.root.view;
    const main = view.state.selection.main;
    return {
      empty: main.empty,
      from: main.from,
      to: main.to,
      head: main.head,
      line: view.state.doc.lineAt(main.head).number,
      doc: view.state.doc.toString(),
      scrollTop: view.scrollDOM.scrollTop,
    };
  });
}

test("行范围整段一个可点元素、文本逐字不变；畸形范围只链接路径本身", async ({ page }) => {
  await openPanel(page);
  const body = page.locator(".lumir-hp-msg-assistant .lumir-hp-body").first();
  await expect(body).toContainText(RANGE_TEXT);

  const links = page.locator(".lumir-hp-pathlink");
  await expect(links).toHaveCount(4);
  // 行范围：整段一个元素（不是「路径 + 行号」两个节点），文本含整个后缀。
  const range = pathLink(page, exact(RANGE_TEXT));
  await expect(range).toHaveCount(1);
  await expect(range).toHaveText(RANGE_TEXT);
  // 单行 / 行列：各自整段一个元素（行列后缀同样归可点范围）。
  await expect(pathLink(page, exact(SINGLE_TEXT))).toHaveText(SINGLE_TEXT);
  await expect(pathLink(page, exact(COLUMN_TEXT))).toHaveText(COLUMN_TEXT);
  // 畸形：只链接路径本身，`:140-120` 留作普通文本（不吞半截）。
  const malformed = pathLink(page, "range-note\\.md");
  await expect(malformed).toHaveCount(1);
  await expect(malformed).toHaveText("range-note.md");
  // 展示文本逐字不变：面板把命中候选换成按钮元素，正文文本节点不重写。
  expect(await body.evaluate((el) => el.textContent)).toBe(BODY);
  // 悬停提示与可见文本同一份（面板不另造一份落点文案）。
  await expect(range).toHaveAttribute("title", RANGE_TEXT);
});

test("点行范围链接：滚到起始行、闭区间行装饰在场；不选中、正文不变", async ({ page }) => {
  await openPanel(page);
  await expect(page.locator(".lumir-hp-msg-assistant .lumir-hp-body").first()).toContainText(
    RANGE_TEXT,
  );

  // 对照：先点畸形链接（同一路径、无行落点）——文件打开在篇首，第 120 行不该被滚进视口，
  // 也不该有任何行装饰（没有行号后缀 ⇒ 没有高亮范围）。
  await pathLink(page, "range-note\\.md").click();
  await expect(page.locator(".cm-content")).toContainText("行范围目标");
  await expect(page.locator(".tab-name")).toHaveText(["harness-note.md", "range-note.md"]);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("range-note.md");
  expect(await highlightedTexts(page), "畸形形态不产高亮").toEqual([]);
  const targetLine = page.locator(".cm-line", { hasText: TARGET_LINE_TEXT });
  await expect(targetLine).toHaveCount(0);
  const before = await editorFacts(page);
  expect(before.scrollTop).toBe(0);
  expect(before.line).toBe(1);

  // 正向：点行范围链接——已打开的同一文件只切标签（不重复开），并滚到第 120 行。
  await pathLink(page, exact(RANGE_TEXT)).click();
  await expect(targetLine).toHaveCount(1);
  await expect(targetLine).toBeInViewport();
  await waitForHighlightCount(page, RANGE_LINES);

  const expected = Array.from({ length: RANGE_LINES }, (_, index) => lineText(START_LINE + index));
  expect(await highlightedTexts(page), "闭区间 120…140 含两端，119 / 141 不在内").toEqual(expected);

  const after = await editorFacts(page);
  expect(after.doc, "正文 MUST NOT 被改变").toBe(TARGET_DOC);
  expect(after.scrollTop).toBeGreaterThan(0);
  expect(after.line, "落点 = 起始行").toBe(START_LINE);
  expect(after.empty, "行范围不选中（不准备改写）").toBe(true);
  expect(after.from).toBe(after.to);
  // 标签不重复开：同一文件仍在同一标签里。
  await expect(page.locator(".tab-name")).toHaveText(["harness-note.md", "range-note.md"]);
});

test("单行 / 行列只高亮一行；再点另一条整块替换（不叠加）", async ({ page }) => {
  await openPanel(page);
  await expect(page.locator(".lumir-hp-msg-assistant .lumir-hp-body").first()).toContainText(
    RANGE_TEXT,
  );

  await pathLink(page, exact(SINGLE_TEXT)).click();
  await waitForHighlightCount(page, 1);
  expect(await highlightedTexts(page)).toEqual([lineText(SINGLE_LINE)]);

  // 行列形态：列号只解析，不收窄高亮范围（整行）。
  await pathLink(page, exact(COLUMN_TEXT)).click();
  await waitForHighlightCount(page, 1);
  expect(await highlightedTexts(page)).toEqual([lineText(COLUMN_LINE)]);

  // 再点行范围：整块替换成 21 行——若旧高亮没被替换，这里会同时出现第 7 行与 120–140 行。
  await pathLink(page, exact(RANGE_TEXT)).click();
  await waitForHighlightCount(page, RANGE_LINES);
  const texts = await highlightedTexts(page);
  expect(texts).toHaveLength(RANGE_LINES);
  expect(texts.includes(lineText(COLUMN_LINE)), "旧高亮 MUST NOT 残留").toBe(false);
});

test("切标签即清除行高亮（切回不残留）", async ({ page }) => {
  await openPanel(page);
  await pathLink(page, exact(RANGE_TEXT)).click();
  await waitForHighlightCount(page, RANGE_LINES);

  // 切走再切回（同一个页面内同步两次点击），随后在 0.8s 内要求「正文已渲染 + 零装饰」。
  // 若 activate() 没清，装饰会随会话 state 留在原文档里，直到 1.4s 计时器到点——这段时间
  // 足够判红；反过来，若只是 DOM 尚未重渲染，正文断言也不会成立，同样不会假绿。
  await page.evaluate(([away, back]) => {
    const clickTab = (name: string): void => {
      for (const tab of Array.from(document.querySelectorAll(".tab"))) {
        if (tab.querySelector(".tab-name")?.textContent === name) {
          (tab as HTMLElement).click();
          return;
        }
      }
    };
    clickTab(away);
    clickTab(back);
  }, ["harness-note.md", "range-note.md"]);

  await page.waitForFunction(
    (target) =>
      (document.querySelector(".cm-content")?.textContent ?? "").includes(target) &&
      document.querySelectorAll(".cm-line.cm-line-highlight").length === 0,
    TARGET_LINE_TEXT,
    { timeout: 800, polling: 20 },
  );
  await expect(page.locator(".cm-content")).toContainText(TARGET_LINE_TEXT);
});

test("约 1.4s 后自动消退；重复点击重置消退计时", async ({ page }) => {
  await openPanel(page);
  await pathLink(page, exact(SINGLE_TEXT)).click();
  await waitForHighlightCount(page, 1);

  // 消退：不点任何东西，装饰自行消失（窗口给到 4s，吸收 CI 负载）。
  await waitForHighlightCount(page, 0);

  // 重置：先点单行（1 行）→ 1.1s 后点行范围（21 行，可判别确实是**第二次应用**，而不是
  // 旧高亮还在场）→ 再过 0.5s（距首次点击约 1.6s > 1.4s）仍是 21 行。若第二次点击没有重置
  // 计时，首次的计时器会在 ~1.45s 到点清掉装饰，这条即判红。
  await pathLink(page, exact(SINGLE_TEXT)).click();
  await waitForHighlightCount(page, 1);
  await page.waitForTimeout(1100);
  await pathLink(page, exact(RANGE_TEXT)).click();
  await waitForHighlightCount(page, RANGE_LINES);
  await page.waitForTimeout(500);
  expect(
    await highlightedTexts(page),
    "重复点击重置计时：距首次点击已过 ~1.6s，第二段高亮仍应在场",
  ).toHaveLength(RANGE_LINES);
});

for (const theme of ["light", "dark", "eink"] as const) {
  test(`主题 ${theme}：行高亮底色非透明且区别于普通行`, async ({ page }) => {
    await openPanel(page, { theme });
    await expect(page.locator(".cm-content")).toContainText("行范围验收笔记");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe(theme);

    await pathLink(page, exact(RANGE_TEXT)).click();
    await waitForHighlightCount(page, RANGE_LINES);

    const colors = await page.evaluate(() => {
      const highlighted = document.querySelector(".cm-line.cm-line-highlight") as HTMLElement;
      const plain = document.querySelector(".cm-line:not(.cm-line-highlight)") as HTMLElement;
      return {
        highlighted: getComputedStyle(highlighted).backgroundColor,
        plain: getComputedStyle(plain).backgroundColor,
      };
    });
    expect(colors.highlighted, `${theme}：高亮底色必须可见`).not.toBe("rgba(0, 0, 0, 0)");
    expect(colors.highlighted).not.toBe("transparent");
    expect(colors.highlighted, `${theme}：高亮必须区别于普通行底色`).not.toBe(colors.plain);
    if (theme === "eink") {
      // eink 档 --pending-tint 恒 transparent，按既有裁决转 10% 黑（与摘录跳回高亮同口径）。
      expect(colors.highlighted).toBe("rgba(0, 0, 0, 0.1)");
    }
  });
}
