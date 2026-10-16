import { readFileSync } from "node:fs";
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
//   5. **浮动钮的落点钳制**（M531，change fix-quote-button-viewport-clamp）：选区包围盒越出挂载
//      容器（多行选区的并集盒 right = 最宽行右缘；不折行的长行会把它推得更远）时，钮 MUST 被
//      收进容器可视区、MUST NOT 被可用宽压成逐字换行的窄条、MUST NOT 把 `.pane-editor`
//      撑成横向可滚（Alex 现场：两个 pane 被拖着一起横滑、钮落在视口之外）。
//
// 行为层（发送、序列化、失锚降级）不在这里——归验收套件场景 81–85（真机 WKWebView + mock
// provider）；这里只钉结构、像素候选与瞬态纪律。
//
// **DOM 装配必须被断言**（M343 的教训）：composer 卡片的 × 移除钮曾在 `createCardEl` 里被创建
// 却漏了 append，而模型层（removeBlockAt）单测全绿——模块装的缺陷只能由 DOM 侧判据挡住。
// 本文件的两条 × 判据（结构在场 + 点击移除卡片）就是那道防线，见 finding
// `20261006-worker-qc4-bug-composer-dom-createcardel-append.md`。

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
 *  不补这条桩，transcript 停在「未初始化」的空壳——那不是用户看到的空会话形态。 */
async function stubHarnessState(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
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

test("点浮动钮：面板未开先开（pane 口径）、卡片入 composer、光标落卡片下一行", async ({ page }) => {
  await openDoc(page);
  await selectQuotedLine(page);

  const panel = page.locator(".lumir-harness");
  await expect(panel).toBeHidden();
  await page.locator(".quote-gesture-btn").click();
  // HP1（change move-harness-to-pane-chat-frame）：「未开先开」= 装配层自动分栏（harness:
  // 文档 = 1:1），面板挂进旁侧 pane——dock 列已移除。
  await expect(panel).toBeVisible();
  await expect(page.locator(".pane-divider")).toBeVisible();

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

  // 整页基线候选：面板在场 + 卡片在 composer 里的全表面（pane 分栏形态、被挤压的编辑区）。
  await expectScreenshot(page, "m345-harness-quote-card.png");
});

test("× 移除钮：DOM 装配完整、点击移除整张卡片", async ({ page }) => {
  await openDoc(page);
  await selectQuotedLine(page);
  await page.locator(".quote-gesture-btn").click();

  const card = page.locator(".lumir-hp-composer > .lumir-hp-qcard");
  await expect(card).toHaveCount(1);

  // 结构判据（M343 的模块装缺陷就出在这里：按钮创建了却没 append）。
  const remove = card.locator(".lumir-hp-qc-x");
  await expect(remove, "composer 卡片必须挂出 × 移除钮（读屏名 D371）").toHaveCount(1);
  await expect(remove).toHaveAttribute("aria-label", "移除摘录");
  await expect(remove).toHaveText("×");

  // 行为判据：点击按「卡片整体作用」移除，composer 回落到一个空段落。
  await remove.click();
  await expect(card).toHaveCount(0);
  await expect(page.locator(".lumir-hp-composer > .lumir-hp-qpara")).toHaveCount(1);
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

// M531（fix-quote-button-viewport-clamp）：浮动钮落点钳制的专用 fixture。
// **不改既有 DOC**：整页基线 m345-harness-quote-card.png 钉着它的正文，加字就会漂基线。
const CLAMP_LONG_CODE_LINE =
  'const probeAlpha = "alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india-juliett-kilo-lima-mike-november-oscar-papa-quebec-romeo-sierra-tango-uniform-victor-whiskey-xray-yankee-zulu";';

const CLAMP_DOC = [
  "# 摘录钮钳制",
  "",
  "这一段故意写得足够长，长到在收窄后的文档 pane 里必然折行很多次，于是整段选区的并集盒右缘会顶住正文列右缘，"
  + "浮动钮的候选落点也随之越出挂载容器的右缘——这是现场形态之一（多行选区的包围盒是并集盒，right 取最宽行右缘，"
  + "比单行选区更靠右）。钳制缺位时这颗钮会推到可视区之外，并把整页的可滚动溢出区撑宽，用户可以横向滑走两个 pane。",
  "",
  "```",
  CLAMP_LONG_CODE_LINE,
  "```",
  "",
  ...Array.from({ length: 40 }, (_, i) => `tail filler line ${String(i + 1).padStart(2, "0")}`),
  "",
].join("\n");

const CLAMP_VAULT: VaultFixture = {
  entries: [{ path: "harness-clamp.md", kind: "file", size: CLAMP_DOC.length, mtime_ms: 0 }],
  files: { "harness-clamp.md": CLAMP_DOC },
  links: {},
};

/** 钳制场景的几何读数（M531）：挂载容器 / 钮 / 编辑器列的横向可滚动量 + 钮的自然内容宽。
 *  「自然内容宽」必须先把宽切成 `width: max-content` 再量——abspos 收缩盒的可用宽 = 「left 到
 *  容器右缘」，落点贴右缘时量到的是被压窄后的逐字换行宽（不是内容宽）。量完立刻还原，
 *  后面的截图断言因此不受影响。 */
async function clampGeometry(page: Page) {
  return page.evaluate(() => {
    const column = document.querySelector(".pane-editor") as HTMLElement;
    const mount = [...document.querySelectorAll(".editor-pane")].find(
      (el) => el.querySelector(".quote-gesture-btn") !== null,
    ) as HTMLElement;
    const button = mount.querySelector(".quote-gesture-btn") as HTMLElement;
    const m = mount.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    const keep = button.style.width;
    button.style.width = "max-content";
    const natural = button.getBoundingClientRect();
    button.style.width = keep;
    const selection = document.getSelection();
    const sel = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null;
    return {
      selectionRight: sel === null ? null : sel.right - m.left,
      selectionBottom: sel === null ? null : sel.bottom - m.top,
      clientWidth: mount.clientWidth,
      clientHeight: mount.clientHeight,
      buttonLeft: b.left - m.left,
      buttonTop: b.top - m.top,
      buttonRight: b.right - m.left,
      buttonBottom: b.bottom - m.top,
      buttonWidth: b.width,
      naturalWidth: natural.width,
      columnScrollWidth: column.scrollWidth,
      columnClientWidth: column.clientWidth,
    };
  });
}

/** 编辑器列（`.pane-editor` = `.pane`，`overflow: auto`）的横向读数：钮 MUST NOT 让它可滚。 */
async function columnMetrics(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => {
    const column = document.querySelector(".pane-editor") as HTMLElement;
    return { scrollWidth: column.scrollWidth, clientWidth: column.clientWidth };
  });
}

/** 「钮恒在挂载容器可视区内」的一整组判据（M531）。
 *  0.5 是亚像素取整余量；4 是钮与容器边缘的留白（与触发放置的「选区右下 +4」同值）。 */
function expectButtonInsideMount(r: Awaited<ReturnType<typeof clampGeometry>>, columnBefore: number): void {
  expect(r.buttonLeft, "钮左缘越出容器可视区").toBeGreaterThanOrEqual(-0.5);
  expect(r.buttonTop, "钮上缘越出容器可视区").toBeGreaterThanOrEqual(-0.5);
  expect(r.buttonRight, "钮右缘越出容器右缘（4px 留白）").toBeLessThanOrEqual(r.clientWidth - 4 + 0.5);
  expect(r.buttonBottom, "钮下缘越出容器下缘（4px 留白）").toBeLessThanOrEqual(r.clientHeight - 4 + 0.5);
  expect(Math.abs(r.buttonWidth - r.naturalWidth), "钮被可用宽压成逐字换行的窄条").toBeLessThanOrEqual(0.5);
  expect(
    r.columnScrollWidth,
    "编辑器列被这颗钮撑成横向可滚（Alex 现场：两个 pane 一起横滑、钮落在视口外）",
  ).toBeLessThanOrEqual(columnBefore);
}

test("钳制：越出挂载容器的选区落点被收进容器可视区，编辑器列不再横向可滚", async ({ page }) => {
  await stubTauri(page, CLAMP_VAULT);
  await stubHarnessState(page);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-clamp.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("摘录钮钳制");

  const btn = page.locator(".editor-pane:not(:has(.lumir-harness)) .quote-gesture-btn");
  const select = (fromNeedle: string, toNeedle: string) =>
    page.evaluate(
      ({ a, b }) => {
        const view = (document.querySelector(".cm-content") as unknown as {
          cmTile: { root: { view: any } };
        }).cmTile.root.view;
        const text: string = view.state.doc.toString();
        view.focus();
        view.dispatch({ selection: { anchor: text.indexOf(a), head: text.indexOf(b) + b.length } });
      },
      { a: fromNeedle, b: toNeedle },
    );

  // 形态一（单栏｜文档 pane 就是最右侧的元素）：「钮落在视口之外、两个 pane 一起横滑」。
  // 选区并集盒靠围栏代码块的长行**越出**容器右缘（`code_block_wrap` 出厂 false ⇒ 长行不折，
  // 右缘远远伸到容器外）。
  const singlePane = await columnMetrics(page);
  expect(singlePane.scrollWidth, "前置：编辑器列本来就横向可滚——判据失去区分度").toBeLessThanOrEqual(
    singlePane.clientWidth,
  );
  await select("这一段故意", CLAMP_LONG_CODE_LINE);
  await expect(btn).toBeVisible();
  const extended = await clampGeometry(page);
  // 反向验证的读数（M531 实测）：未钳制时选区并集盒右缘 ≈ 1540、钮落在 left ≈ 1544（容器宽 964）
  // ——钮整体在视口外，编辑器列 scrollWidth 964 → 1575（用户可把两个 pane 一起横滑）。
  expect(
    extended.selectionRight,
    "本用例的前提是选区并集盒越出容器右缘（否则这条判据空转）",
  ).toBeGreaterThan(extended.clientWidth);
  expectButtonInsideMount(extended, singlePane.scrollWidth);

  // 形态二（分栏｜出厂口径下的收窄 pane）：「钮的位置跑到最右边、还被压成两行」。
  // 选区右缘距容器右缘 69px，钮的可用宽容不下文案——未钳制时它被压成 64.5×49 的两行窄条、
  // 顶在容器右缘（离选区一大截）。
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  const splitBefore = (await columnMetrics(page)).scrollWidth;
  await select("这一段故意", "用户可以横向滑走两个 pane。");
  await expect(btn).toBeVisible();
  expectButtonInsideMount(await clampGeometry(page), splitBefore);

  // 纵向：选区贴容器底缘时钮同样越出（不可视区之外）；这一半在编辑器里**够不到**判别性落点
  //（文档尾留白 + 文档结束标记恒留 ≈58px 余量 > 钮高 + 4），故只作不变式断言——
  // 有区分度的纵向现场在 transcript 那颗钮（m423：transcript 的底部内边距只有 sp-2）。
  await page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    scroller.scrollTop = scroller.scrollHeight;
  });
  const tailBefore = (await columnMetrics(page)).scrollWidth;
  await select("tail filler line 36", "tail filler line 40");
  await expect(btn).toBeVisible();
  expectButtonInsideMount(await clampGeometry(page), tailBefore);
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

/** 真机验收场景 160 的前提（M531）：它按「⌃N ×11 把光标插到第 12 行、⌃⇧N 选中该行」造现场，
 *  行号与 fixture 的行结构绑定。那条通道（真机键盘注入）在 chromium 里没有断言，这里补上——
 *  fixture 的行结构一旦变（多一行 / 少一行），场景 160 会在真机上静默选错行，而本用例当场判红。
 *  读 fixture 原文而不是抄一份：抄一份就是第二份真源（REVIEW.md 第 8 条）。 */
test("钳制：真机场景 160 的前提在本层可复现（键盘选区 ⇒ 选区越出容器 ⇒ 钮被收进容器）", async ({ page }) => {
  const src = readFileSync(new URL("../../../scripts/acceptance/fixtures/code-block-fullscreen.md", import.meta.url), "utf8");
  await stubTauri(page, {
    entries: [{ path: "probe160.md", kind: "file", size: src.length, mtime_ms: 0 }],
    files: { "probe160.md": src },
    links: {},
  });
  await stubHarnessState(page);
  await page.goto("/");
  await page.locator('.ft-row[title="probe160.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("TOP-MARK");
  await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as {
      cmTile: { root: { view: any } };
    }).cmTile.root.view;
    view.focus();
  });

  const read = () =>
    page.evaluate(() => {
      const view = (document.querySelector(".cm-content") as unknown as {
        cmTile: { root: { view: any } };
      }).cmTile.root.view;
      const selection = view.state.selection.main;
      const doc = view.state.doc;
      const mount = document.querySelector(".editor-pane") as HTMLElement;
      const m = mount.getBoundingClientRect();
      const button = mount.querySelector(".quote-gesture-btn") as HTMLElement | null;
      const b = button === null ? null : button.getBoundingClientRect();
      const dom = document.getSelection();
      const range = dom !== null && dom.rangeCount > 0 ? dom.getRangeAt(0).getBoundingClientRect() : null;
      const column = document.querySelector(".pane-editor") as HTMLElement;
      return {
        anchorLine: doc.lineAt(selection.anchor).number,
        headLine: doc.lineAt(selection.head).number,
        collapsed: selection.empty,
        selectionRight: range === null ? null : range.right - m.left,
        clientWidth: mount.clientWidth,
        buttonRight: b === null ? null : b.right - m.left,
        buttonTop: b === null ? null : b.top - m.top,
        buttonBottom: b === null ? null : b.bottom - m.top,
        clientHeight: mount.clientHeight,
        columnScrollWidth: column.scrollWidth,
        columnClientWidth: column.clientWidth,
      };
    });

  for (let i = 0; i < 11; i += 1) await page.keyboard.press("Control+n");
  expect((await read()).anchorLine, "场景 160 的 ⌃N ×11 必须落在 fixture 的长代码行（第 12 行）").toBe(12);

  await page.keyboard.press("Control+Shift+n");
  await expect(page.locator(".editor-pane .quote-gesture-btn")).toBeVisible();
  const r = await read();
  expect(r.collapsed, "⌃⇧N 必须真的建出选区").toBe(false);
  expect(
    r.selectionRight,
    "前提：选区并集盒越出挂载容器（否则场景 160 在真机上会静默选错行）",
  ).toBeGreaterThan(r.clientWidth);
  expect(r.buttonRight, "钮右缘越出容器右缘（4px 留白）").toBeLessThanOrEqual(r.clientWidth - 4 + 0.5);
  expect(r.buttonTop, "钮上缘越出容器可视区").toBeGreaterThanOrEqual(-0.5);
  expect(r.buttonBottom, "钮下缘越出容器可视区").toBeLessThanOrEqual(r.clientHeight - 4 + 0.5);
  expect(r.columnScrollWidth, "编辑器列被这颗钮撑成横向可滚").toBeLessThanOrEqual(r.columnClientWidth);
});
