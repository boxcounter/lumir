import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M345（change add-harness-quote-cards）：摘录引用卡片的新表面基线。
//
//   1. **浮动「摘录到对话」钮**（文案 D370，design §5）：编辑器选区在场时浮现于选区右下。
//      它是瞬态元素（选区坍缩即离场），整页容差吞得掉，因此配一条元素级 crop 与在场断言。
//   2. **composer 内的引用卡片**（design §2·§3）：3px 引号竖条 + ≤2 行摘录 + 等宽出处行，
//      整页基线钉住这段新布局在被挤压编辑区里的形态。
//   3. **跳回高亮**（`.cm-quote-jump-flash`，design §5）：借用 pending-tint 的瞬态 mark，
//      ~1.4s 消退——判据是「出现 → 消退」两拍，而不是某一帧的像素。
//   4. **粘贴净化**（quirk ①）：带 `text/html` 与 `text/plain` 的 paste 事件只取纯文本面。
//      真机侧合成不出富剪贴板（套件无剪贴板写通道），这条判据在 chromium 侧补全。
//
// 行为层（发送、序列化、失锚降级）不在这里——归验收套件场景 81–86（真机 WKWebView + mock
// provider）；这里只钉结构、像素候选与瞬态纪律。
//
// **已知缺口**：composer 卡片的 × 移除钮当前不在 DOM（`src/harness-panel.ts` 的 createCardEl
// 漏了 append，见 finding `20261006-worker-qc4-bug-composer-dom-createcardel-append.md`）。
// 修好后这里应补一条 `.lumir-hp-qcard .lumir-hp-qc-x` 的结构断言；本文件暂不写，免得把
// 视觉门禁钉在一条已知缺陷上。

const DOC = [
  "# 摘录卡片基线",
  "",
  "第一段用于摘录：先读结论再读论证。",
  "第二段用于摘录：把可执行动作捞出来过一遍。",
  "",
].join("\n");

const VAULT: VaultFixture = {
  entries: [{ path: "harness-quote.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-quote.md": DOC },
  links: {},
};

const QUOTED = "第一段用于摘录：先读结论再读论证。";

/** `harness_state` 的零态桩：与 Rust `StateSnapshot::empty` 同形（m303 同款）。
 *  不补这条桩，用量条会停在「未初始化」的空串——那不是用户看到的形态。 */
async function stubHarnessState(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct: 0 },
          pending_approval: null,
          warn_ctx_pct: 85,
        });
      }
      return invoke(cmd, args);
    };
  });
}

async function openDoc(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await stubHarnessState(page);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-quote.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段用于摘录");
}

/** 程序化选区（与 m285 同手法）：CM 在 focused 时会把选区写进 DOM，
 *  摘录手势监听的 `document` `selectionchange` 因此被触发。 */
async function selectQuotedLine(page: Page): Promise<void> {
  await page.evaluate((quoted) => {
    const view = (document.querySelector(".cm-content") as unknown as {
      cmTile: { root: { view: any } };
    }).cmTile.root.view;
    const start = view.state.doc.toString().indexOf(quoted);
    view.focus();
    view.dispatch({ selection: { anchor: start, head: start + quoted.length } });
  }, QUOTED);
}

test("浮动摘录钮：选区在场时浮现、文案正确", async ({ page }) => {
  await openDoc(page);
  const btn = page.locator(".quote-gesture-btn");
  await expect(btn).toBeHidden();

  await selectQuotedLine(page);
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText("摘录到对话");
  await expect(btn).toHaveAttribute("aria-label", "摘录到对话");

  // 元素级基线：钮的壳 / 尺寸 / 圆角 / 文案（整页容差吞得掉这颗小钮）。
  await expectScreenshot(btn, "m345-quote-gesture-button.png");
});

test("点浮动钮：面板未开先开、卡片入 composer、光标落卡片下一行", async ({ page }) => {
  await openDoc(page);
  await selectQuotedLine(page);

  const panel = page.locator(".lumir-harness");
  await expect(panel).toBeHidden();
  await page.locator(".quote-gesture-btn").click();
  await expect(panel).toBeVisible();

  // 卡片结构三件（design §2·§3）：3px 竖条 + 摘录 + 等宽出处行。
  const card = page.locator(".lumir-hp-composer > .lumir-hp-qcard");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".lumir-hp-qc-bar")).toHaveCount(1);
  await expect(card.locator(".lumir-hp-qc-ex")).toHaveText(QUOTED);
  await expect(card.locator(".lumir-hp-qc-src")).toHaveText("harness-quote.md · 摘录卡片基线");

  // 「插入后光标落到卡片下一行的问题段落」（design §5 的行为合同，结构层判据）。
  const landing = await page.evaluate(() => {
    const composer = document.querySelector(".lumir-hp-composer") as HTMLElement;
    const children = [...composer.children];
    const cardIdx = children.findIndex((c) => c.classList.contains("lumir-hp-qcard"));
    const next = cardIdx >= 0 ? (children[cardIdx + 1] as HTMLElement | undefined) : undefined;
    const anchor = window.getSelection()?.anchorNode ?? null;
    const inNode = anchor === null ? null : anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement;
    return {
      cardIdx,
      nextClass: next?.className ?? "",
      caretInNext: next !== undefined && inNode !== null && next.contains(inNode),
    };
  });
  expect(landing.cardIdx).toBe(0);
  expect(landing.nextClass).toContain("lumir-hp-qpara");
  expect(landing.caretInNext, "插入后焦点/光标应落在卡片下一行的问题段落").toBe(true);

  // 整页基线候选：面板展开 + 卡片在 composer 里的全表面（dock 列宽、被挤压的编辑区）。
  await expectScreenshot(page, "m345-harness-quote-card.png");
});

test("粘贴净化：带 text/html 的粘贴只落纯文本", async ({ page }) => {
  await openDoc(page);
  await selectQuotedLine(page);
  await page.locator(".quote-gesture-btn").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();

  await page.evaluate(() => {
    const composer = document.querySelector(".lumir-hp-composer") as HTMLElement;
    composer.focus();
    const dt = new DataTransfer();
    dt.setData("text/html", "<b>HTML-ONLY</b>");
    dt.setData("text/plain", "PLAIN-ONLY");
    composer.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  });

  const composer = page.locator(".lumir-hp-composer");
  await expect(composer).toContainText("PLAIN-ONLY");
  await expect(composer).not.toContainText("HTML-ONLY");
  await expect(composer.locator("b")).toHaveCount(0);
  // 粘贴不产卡片（quirk ①：只进纯文本段落）。
  await expect(composer.locator(".lumir-hp-qcard")).toHaveCount(1);
});

test("跳回高亮：点卡片跳回原文并瞬态高亮，~1.4s 后退场", async ({ page }) => {
  await openDoc(page);
  await selectQuotedLine(page);
  await page.locator(".quote-gesture-btn").click();

  const flash = page.locator(".cm-quote-jump-flash");
  await expect(flash).toHaveCount(0);

  await page.locator(".lumir-hp-composer > .lumir-hp-qcard").click();
  await expect(flash).toHaveCount(1);
  // 高亮覆盖的正是被摘录那一段（mark 的范围 = 跳回锚点）。
  await expect(flash).toHaveText(QUOTED);

  // 整页基线候选：跳回高亮的瞬态形态（1.4s 窗口内截图；同一 test 里只拍这一张）。
  await expectScreenshot(page, "m345-quote-jump-flash.png");

  // 瞬态纪律：~1.4s 无条件退场（零常驻装饰）。
  await expect(flash).toHaveCount(0, { timeout: 3_000 });
});
