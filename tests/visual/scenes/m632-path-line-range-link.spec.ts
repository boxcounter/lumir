import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M632（change add-path-line-range-links）的**渲染面**断言：harness 输出里的
// `{path}:{起}-{止}` 与既有 `{path}:{行}:{列}` 走同一条链路——
//
//   1. 整段（含 `:起-止`）是一个可点元素，展示文本逐字不变；畸形范围（`止 < 起`）只链接
//      路径本身、后缀留作普通文本（不吞半截）。
//   2. 点击行范围 → 文件在新标签打开、第 `起` 行滚进视口（居中由既有 `revealLine` 算式保证，
//      本场景只判「进了视口」）；**选区保持折叠**（不选中行范围、不高亮），文档正文逐字节不变。
//
// 判据为什么这样写：几何与选区读数取自真 CM view（`.cm-content` 的 `cmTile.root.view`，
// 与 reading-position / m281 同一口径）。「第一行落点」与「没有落点」是**同一份文档上的
// 一组对照**——先点畸形链接（打开在篇首、scrollTop 恒 0、目标行未渲染），再点行范围链接
//（同一标签内滚到第 120 行）。只写正向那半的话，「打开就在第 120 行附近」这类假绿看不出来。
//
// 本场景不覆盖（如实登记）：三种形态的解析边界与畸形矩阵在
// `tests/unit/harness-path-link.test.ts`；`止` 越界钳制在 `src/editor.ts` 的既有 revealLine；
// 真机 WKWebView 的同一链路与 prompt 遵从度在 `scripts/acceptance/scenarios/221-*`。
// 无新像素基线：元素形态复用既有 `.lumir-hp-pathlink`，本场景只做结构 / 几何断言。

const FILLER = (n: number): string => `第 ${String(n).padStart(3, "0")} 行：行范围跳转的填充内容。`;

/** 起点行（链接写作 `:120-140`）与目标行原文。 */
const START_LINE = 120;
const END_LINE = 140;
const TARGET_LINE_TEXT = "LR-632-L120-TARGET";

const DOC_LINES: string[] = ["# 行范围目标", ""];
while (DOC_LINES.length < END_LINE + 20) DOC_LINES.push(FILLER(DOC_LINES.length + 1));
DOC_LINES[START_LINE - 1] = TARGET_LINE_TEXT;
const TARGET_DOC = `${DOC_LINES.join("\n")}\n`;

const RANGE_TEXT = `range-note.md:${START_LINE}-${END_LINE}`;
const MALFORMED_TEXT = `range-note.md:${END_LINE}-${START_LINE}`;
/** 回复正文：一条合法行范围 + 一条 `止 < 起` 的畸形写法（路径名相同，便于对照同一标签）。 */
const BODY = `行范围验收：第 ${START_LINE}–${END_LINE} 行在 ${RANGE_TEXT}，畸形写法 ${MALFORMED_TEXT} 只该链接到文件本身。`;

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

/** harness 面板的初值桩：一条 assistant 消息承载本场景的两种后缀形态。 */
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

async function openPanel(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
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
  await expect(links).toHaveCount(2);
  // 行范围：整段一个元素（不是「路径 + 行号」两个节点），文本含整个后缀。
  const range = pathLink(page, `${RANGE_TEXT.replace(/\./g, "\\.")}`);
  await expect(range).toHaveCount(1);
  await expect(range).toHaveText(RANGE_TEXT);
  // 畸形：只链接路径本身，`:140-120` 留作普通文本（不吞半截）。
  const malformed = pathLink(page, "range-note\\.md");
  await expect(malformed).toHaveCount(1);
  await expect(malformed).toHaveText("range-note.md");
  // 展示文本逐字不变：面板把命中候选换成按钮元素，正文文本节点不重写。
  expect(await body.evaluate((el) => el.textContent)).toBe(BODY);
  // 悬停提示与可见文本同一份（面板不另造一份落点文案）。
  await expect(range).toHaveAttribute("title", RANGE_TEXT);
});

test("点行范围链接：新标签打开、滚到起始行居中；不选中、正文不变", async ({ page }) => {
  await openPanel(page);
  await expect(page.locator(".lumir-hp-msg-assistant .lumir-hp-body").first()).toContainText(
    RANGE_TEXT,
  );

  // 对照：先点畸形链接（同一路径、无行落点）——文件打开在篇首，第 120 行不该被滚进视口。
  await pathLink(page, "range-note\\.md").click();
  await expect(page.locator(".cm-content")).toContainText("行范围目标");
  await expect(page.locator(".tab-name")).toHaveText(["harness-note.md", "range-note.md"]);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("range-note.md");
  const targetLine = page.locator(".cm-line", { hasText: TARGET_LINE_TEXT });
  await expect(targetLine).toHaveCount(0);
  const before = await editorFacts(page);
  expect(before.scrollTop).toBe(0);
  expect(before.line).toBe(1);

  // 正向：点行范围链接——已打开的同一文件只切标签（不重复开），并滚到第 120 行。
  await pathLink(page, `${RANGE_TEXT.replace(/\./g, "\\.")}`).click();
  await expect(targetLine).toHaveCount(1);
  await expect(targetLine).toBeInViewport();

  const after = await editorFacts(page);
  expect(after.doc, "正文 MUST NOT 被改变").toBe(TARGET_DOC);
  expect(after.scrollTop).toBeGreaterThan(0);
  expect(after.line, "落点 = 起始行").toBe(START_LINE);
  expect(after.empty, "行范围不选中（不准备改写）").toBe(true);
  expect(after.from).toBe(after.to);
  // 标签不重复开：同一文件仍在同一标签里。
  await expect(page.locator(".tab-name")).toHaveText(["harness-note.md", "range-note.md"]);
});
