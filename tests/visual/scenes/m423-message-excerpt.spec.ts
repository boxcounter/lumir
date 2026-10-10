import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M423（change harness-message-excerpt）：harness transcript 消息摘录的结构 / 行为断言与新表面基线。
//
//   1. **浮动「摘录到对话」钮**（复用 D370 文案与 .quote-gesture-btn 视觉）：transcript 消息体
//      选区在场时浮现（挂 transcript 容器，design §7）。
//   2. **composer 内的消息摘录卡**：复用 .lumir-hp-qcard 整族样式（几何零改动），出处行
//      「对话 · 角色」（D442 + D385/D386），带 × 移除钮。
//   3. **排除面**：消息内的引用卡片内部选区不出钮（design §5）。
//   4. **跳回高亮**：点卡片 → 来源消息瞬态着色（.is-jump-flash），~1.4s 消退。
//   5. **两手势互斥**：编辑器选区与 transcript 选区先后出现时，同屏至多一个浮动钮。
//   6. **序列化结构**：发送时投递文本含 `<msg-quote role="…" at="…">`（无编号）。
//   7. **视口注入 skip**：携带消息摘录卡时 chip 走「仅路径」形态（D373）。
//
// 行为层（真机 WKWebView）归验收套件；这里钉结构、计算属性与瞬态纪律。
//
// 注：两张新表面基线（m423-message-quote-gesture-button / -card）已随本分支提交
//（Playwright 首跑写入，未用 `--update`、未触碰任何既有基线），并在全量视觉里参与像素对比；
// 截图另存一份给 Alex 过目（`test-results/alex-review-2026-10-10/m423/`）——若 Alex 对观感有
// 异议再按 tests/visual/README.md 的基线更新纪律重截。

const DOC = "# 消息摘录基线\n\n第一段，给上下文 chip 一个视口口径。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

const TS_USER = 1759000000; // UNIX 秒（面板 messageTs 乘 1000）
const TS_ASSISTANT = 1759000005;
const ASSISTANT_TEXT = "先读结论再读论证——倒序阅读把大部分筛选成本压到最低。";

/** 会话初值（PanelMessage 形状：role / text / ts；assistant 带 reasoning 渲染思考块）。 */
const STATE = {
  messages: [
    {
      role: "user",
      text:
        '<quote file="harness-note.md" heading="消息摘录基线" lines="3-3">第一段，给上下文 chip 一个视口口径。</quote>\n' +
        "这条用户消息里含引用卡片",
      ts: TS_USER,
    },
    { role: "assistant", text: ASSISTANT_TEXT, ts: TS_ASSISTANT },
    { role: "assistant", text: "带思考块的回复正文。", reasoning: "先分析再回答。", ts: TS_ASSISTANT + 5 },
  ],
  usage: { ctx_pct: 0, cache_pct: 0 },
  pending_approval: null,
  warn_ctx_pct: 85,
};

async function stubHarness(page: Page): Promise<void> {
  await page.addInitScript((snapshot) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__harnessEventHandlerIds = [];
    w.__sentMessages = [];
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send") {
        w.__sentMessages.push({ message: args.message });
        return null;
      }
      if (cmd === "harness_abort") return null;
      if (cmd === "harness_state") return JSON.stringify(snapshot);
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      const result = await origInvoke(cmd, args);
      if (cmd === "config_get" && result?.config) {
        result.config.harness = {
          provider: "mock",
          providers: { kimi: { model: "k2" }, deepseek: { model: "d" }, mock: { fixture: "f.json" } },
          permissions: { allow: [], deny: [] },
          loop_max: 8,
          warn_ctx_pct: 85,
          auto_compact: true,
        };
      }
      return result;
    };
  }, STATE);
}

async function openPanel(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".lumir-hp-msg-assistant").first()).toBeVisible();
}

/** 程序化选区（真 gesture 监听 document selectionchange）：选区落在 selector 命中的第 nth 个元素内。 */
async function selectTextIn(page: Page, selector: string, nth = 0): Promise<string> {
  return page.evaluate(
    ({ sel, i }) => {
      const el = document.querySelectorAll(sel)[i];
      if (!el) throw new Error(`no element ${sel}[${i}]`);
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      if (!selection) throw new Error("no selection");
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return selection.toString();
    },
    { sel: selector, i: nth },
  );
}

/** 编辑器选区（与 m345 同手法：CM dispatch 写 DOM 选区 → selectionchange）。 */
async function selectEditor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as {
      cmTile: { root: { view: any } };
    }).cmTile.root.view;
    const start = view.state.doc.toString().indexOf("第一段");
    view.focus();
    view.dispatch({ selection: { anchor: start, head: start + 3 } });
  });
}

test("浮动钮：transcript 选区 → 「摘录到对话」钮浮现（挂 transcript 内）", async ({ page }) => {
  await openPanel(page);
  const transcriptBtn = page.locator(".lumir-hp-transcript > .quote-gesture-btn");
  await expect(transcriptBtn).toBeHidden();

  const text = await selectTextIn(page, ".lumir-hp-msg-assistant .lumir-hp-body", 0);
  expect(text).toContain("先读结论");
  await expect(transcriptBtn).toBeVisible();
  await expect(transcriptBtn).toHaveText("摘录到对话");
  await expect(transcriptBtn).toHaveAttribute("aria-label", "摘录到对话");

  // 元素级基线（新表面；基线已随分支提交，截图另存 Alex 过目目录）。
  await expectScreenshot(transcriptBtn, "m423-message-quote-gesture-button.png");
});

test("点钮：消息摘录卡入 composer（出处行「对话 · Agent」、× 移除钮、几何复用文档卡族）", async ({
  page,
}) => {
  await openPanel(page);
  const assistantText = await selectTextIn(page, ".lumir-hp-msg-assistant .lumir-hp-body", 0);
  await page.locator(".lumir-hp-transcript > .quote-gesture-btn").click();

  const card = page.locator(".lumir-hp-composer > .lumir-hp-qcard");
  await expect(card).toHaveCount(1);
  await expect(card).toHaveClass(/lumir-hp-msgquote/); // 新块类（样式仍走 .lumir-hp-qcard 整族）
  await expect(card.locator(".lumir-hp-qc-bar")).toHaveCount(1);
  await expect(card.locator(".lumir-hp-qc-ex")).toHaveText(assistantText);
  await expect(card.locator(".lumir-hp-qc-src")).toHaveText("对话 · Agent");
  await expect(card.locator(".lumir-hp-qc-x")).toHaveCount(1);
  // hover title：完整摘录 + 绝对时间（本地化短格式，含年份则证明来自 ts）。
  const title = await card.getAttribute("title");
  expect(title ?? "").toContain(assistantText);

  // 携带消息摘录卡 ⇒ 跳过视口注入：chip 走「仅路径」形态（D373）。
  await expect(page.locator(".lumir-hp-chip")).toHaveText("上下文：harness-note.md");

  // 元素级基线（新表面；基线已随分支提交，截图另存 Alex 过目目录）。
  await expectScreenshot(card, "m423-message-quote-card.png");
});

test("排除面：消息内引用卡片内部选区不出钮；消息体选区出钮（正观测对照）", async ({ page }) => {
  await openPanel(page);
  const btn = page.locator(".lumir-hp-transcript > .quote-gesture-btn");

  // 引用卡片内部：排除。
  await selectTextIn(page, ".lumir-hp-msg-user .lumir-hp-qcard", 0);
  await expect(btn, "卡片内部选区不得出钮").toBeHidden();

  // 同一消息体的问题段落：出钮（证明排除不是「整个消息都不出」的空转）。
  await selectTextIn(page, ".lumir-hp-msg-user .lumir-hp-qtext", 0);
  await expect(btn).toBeVisible();

  // 思考块内部：排除。
  await selectTextIn(page, ".lumir-hp-think-body", 0);
  await expect(btn, "思考块内部选区不得出钮").toBeHidden();
});

test("跳回高亮：点卡片 → 来源消息瞬态着色（~1.4s 退场）", async ({ page }) => {
  await openPanel(page);
  await selectTextIn(page, ".lumir-hp-msg-assistant .lumir-hp-body", 0);
  await page.locator(".lumir-hp-transcript > .quote-gesture-btn").click();

  const flash = page.locator(".lumir-hp-msg.is-jump-flash");
  await expect(flash).toHaveCount(0);

  await page.locator(".lumir-hp-composer > .lumir-hp-qcard").click();
  await expect(flash).toHaveCount(1);
  // 高亮的是来源 assistant 消息（含摘录原文），不是别的消息。
  await expect(flash.locator(".lumir-hp-body")).toContainText("先读结论");

  // 瞬态纪律：~1.4s 无条件退场（零常驻装饰）。
  await expect(flash).toHaveCount(0, { timeout: 3_000 });
});

test("两手势互斥：编辑器选区与 transcript 选区先后出现，同屏至多一个浮动钮", async ({ page }) => {
  await openPanel(page);

  // 文档 pane 的挂载元素与 harness pane 同类名（都是 .editor-pane），故按「不含 .lumir-harness」
  // 排除 harness pane，否则选择器会命中 transcript 里那颗钮。
  const editorBtn = page.locator(".editor-pane:not(:has(.lumir-harness)) .quote-gesture-btn");
  await selectEditor(page);
  await expect(editorBtn).toBeVisible();
  await expect(page.locator(".quote-gesture-btn:visible")).toHaveCount(1);

  await selectTextIn(page, ".lumir-hp-msg-assistant .lumir-hp-body", 0);
  const transcriptBtn = page.locator(".lumir-hp-transcript > .quote-gesture-btn");
  await expect(transcriptBtn).toBeVisible();
  await expect(editorBtn, "后发生的选区来源容器决定哪个钮在场").toBeHidden();
  await expect(page.locator(".quote-gesture-btn:visible")).toHaveCount(1);
});

test("序列化结构：发送投递的文本含 <msg-quote role at>（无编号）", async ({ page }) => {
  await openPanel(page);
  await selectTextIn(page, ".lumir-hp-msg-assistant .lumir-hp-body", 0);
  await page.locator(".lumir-hp-transcript > .quote-gesture-btn").click();

  // 插入后焦点/光标已在卡片下一行的段落——直接键入问题，不填空（填空会替换掉卡片）。
  await page.keyboard.type("这里说的筛选成本具体指什么？");
  await page.locator(".lumir-hp-send").click();

  const sent = await page.evaluate(() => (window as unknown as { __sentMessages: { message: string }[] }).__sentMessages);
  expect(sent.length).toBe(1);
  const message = sent[0].message;
  // role 必选且合法；at 是秒级 ISO 本地串（时区无关断言，只钉形状）。
  expect(message).toMatch(/<msg-quote role="assistant" at="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}">/);
  expect(message).toContain(ASSISTANT_TEXT);
  expect(message).toContain("</msg-quote>");
  expect(message).toContain("这里说的筛选成本具体指什么？");
  // 协议零编号。
  expect(message).not.toMatch(/<msg-quote[^>]*\b(index|idx|id|n)=/);
});
