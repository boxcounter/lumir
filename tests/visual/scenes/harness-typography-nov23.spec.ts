import { existsSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { stubTauri, type VaultFixture } from "./tauri-stub";
import { standardProviders } from "./provider-config";

const PROVIDERS = standardProviders();
const THEMES = ["light", "dark", "eink"] as const;
const VIEWPORTS = [
  { name: "narrow", width: 1200, height: 800, measure: 448.5 },
  { name: "wide", width: 1800, height: 900, measure: 720 },
  { name: "ultrawide", width: 2400, height: 1000, measure: 720 },
] as const;

type Theme = (typeof THEMES)[number];
type Rgba = { r: number; g: number; b: number; a: number };

const LONG_URL = `https://example.com/typography/URL-LONG-01/${"segment-without-natural-breaks/".repeat(7)}final.md`;
const LONG_CODE = `const LONG_CODE_01 = mapCellsToViewportWithRoundTrip("${"x".repeat(180)}");`;
const BODY = [
  "LONG-PARA-01 这一段用于核对连续阅读，而不是测试短消息。Harness 的回答经常同时包含结论、证据、限制与下一步；当这些内容连续出现时，正文字号、行高、段落间距和外侧留白必须一起工作。The same paragraph also contains enough English words to make line length and mixed-script wrapping visible at both pane widths.",
  "",
  "LONG-PARA-02 第二段保留一个明确边界，用来比较 4px 与 8px 的段落节奏。这里不假设更大字号必然更好：窄 pane 还要容纳工具状态、批准动作与 composer，任何收益都不能以遮挡、横向失控或操作区被推出视口为代价。",
  "",
  "三级嵌套列表：",
  "",
  "1. LEVEL-1-01 第一层包含较长文字，续行必须和正文起点对齐，而不是退回列表标记下面。",
  "   - LEVEL-2-01 第二层继续加长，用来观察窄 pane 下的悬挂缩进与项目间距。",
  "     1. LEVEL-3-01 第三层仍有足够内容形成续行，嵌套层级不能吃掉全部正文宽度。",
  "   - LEVEL-2-02 第二层的第二个项目。",
  "2. LEVEL-1-02 第一层的第二个项目。",
  "",
  `正文长 URL：URL-LONG-01 ${LONG_URL} 后接中文，检查链接断行与正文横向溢出。`,
  "",
  "```js",
  LONG_CODE,
  "const shortLine = true;",
  "```",
  "",
  "宽表：",
  "",
  "| 名称 | 说明 | 状态 | 备注 |",
  "| --- | --- | --- | --- |",
  "| WIDE-甲 | 第一列的说明文字写得再长一点也要放得下 | 进行中状态说明 | 备注文字也写得更长一些才够宽 |",
  "| WIDE-乙 | 第二列的说明文字同样很长也要放得下 | 已完成状态 | 备注文字的第二个例子也够宽了 |",
  "",
  "窄表：",
  "",
  "| 名称 | 标记 |",
  "| --- | --- |",
  "| NARROW-甲 | 1 |",
].join("\n");

const DOC = "# 排版探针\n\n合成正文，仅用于建立 content 与 Harness 的同窗口参照。\n";
const VAULT: VaultFixture = {
  entries: [{ path: "typography-fixture.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "typography-fixture.md": DOC },
  links: {},
};
const NOW_S = Math.floor(Date.now() / 1000);
const STATE = {
  messages: [
    { role: "user", text: "USER-PROBE-01 请把同一组综合内容放在一条回答里，便于比较阅读密度、表格和批准动作。", ts: NOW_S - 95 },
    { role: "assistant", text: BODY, ts: NOW_S - 80 },
    {
      role: "tool",
      name: "vault_read",
      summary: JSON.stringify({ path: `synthetic/${"nested-directory/".repeat(5)}tool-row-long-path.md` }),
      ts: NOW_S - 70,
    },
  ],
  usage: { ctx_pct: 42, cache_pct_session: 18 },
  pending_approvals: [
    {
      id: "approval-typography-01",
      tool: "cli_run",
      argv: ["python3", "-c", "print('APPROVAL-PROBE-01 ' + 'long-command-argument/' * 12)"],
      purpose: "批准卡用途：运行一条合成命令，检查理由、对象、后果与动作在窄 pane 中是否仍然分层。",
      reason: { kind: "mode_default", mode: "read_only" },
      remember: "cli_run:python3",
      persist_rule: "cli_run(python3 *)",
    },
  ],
  warn_ctx_pct: 85,
  in_flight: true,
};
const EMPTY_RUNNING_STATE = {
  messages: [],
  usage: { ctx_pct: 0, cache_pct_session: 0 },
  pending_approvals: [],
  warn_ctx_pct: 85,
  in_flight: true,
};

async function stubHarness(page: Page, state: unknown): Promise<void> {
  await page.addInitScript((providers) => {
    (window as unknown as Record<string, unknown>).__VISUAL_PROVIDERS = providers;
  }, PROVIDERS);
  await page.addInitScript((snapshot) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__harnessEventHandlerIds = [];
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send" || cmd === "harness_abort") return null;
      if (cmd === "harness_state") return JSON.stringify(snapshot);
      if (cmd === "harness_list_sessions") return [];
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      const result = await origInvoke(cmd, args);
      if (cmd === "config_get" && result?.config) {
        result.config.harness = {
          provider: "mock",
          providers: (window as unknown as Record<string, any>).__VISUAL_PROVIDERS,
          permissions: { allow: [], deny: [] },
          loop_max: 8,
          warn_ctx_pct: 85,
          auto_compact: true,
        };
      }
      return result;
    };
  }, state);
}

async function openPanel(page: Page, theme: Theme, state: unknown = STATE): Promise<void> {
  await stubTauri(page, { ...VAULT, config: { theme } });
  await stubHarness(page, state);
  await page.goto("/");
  await page.locator('.ft-row[title="typography-fixture.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("合成正文");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

async function openFixture(page: Page, theme: Theme, viewport: (typeof VIEWPORTS)[number]): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await openPanel(page, theme);
  await expect(page.locator(".lumir-hp-msg-assistant")).toHaveCount(2);
  await expect(page.locator(".lumir-hp-codeblock")).toContainText("LONG_CODE_01");
  await expect(page.locator(".lumir-hp-table")).toHaveCount(2);
  await expect(page.locator(".lumir-hp-approval")).toContainText("APPROVAL-PROBE-01");
  await expect(page.locator(".lumir-hp-tool-row.is-done")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-body a", { hasText: "URL-LONG-01" })).toHaveCount(1);
}

async function style(target: Locator, pseudo?: string) {
  return target.evaluate(
    (el, pseudoElement) => {
      const s = getComputedStyle(el, pseudoElement ?? undefined);
      return {
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        padding: s.padding,
        paddingLeft: s.paddingLeft,
        margin: s.margin,
        marginTop: s.marginTop,
        marginBottom: s.marginBottom,
        gap: s.gap,
        color: s.color,
        backgroundColor: s.backgroundColor,
        borderRadius: s.borderRadius,
        borderTopWidth: s.borderTopWidth,
        borderRightWidth: s.borderRightWidth,
        borderBottomWidth: s.borderBottomWidth,
        borderLeftWidth: s.borderLeftWidth,
        borderBottomColor: s.borderBottomColor,
        minHeight: s.minHeight,
        height: s.height,
        maxInlineSize: s.maxInlineSize,
        overflowWrap: s.overflowWrap,
        wordBreak: s.wordBreak,
        animationName: s.animationName,
        textAlign: s.textAlign,
        position: s.position,
        top: s.top,
        right: s.right,
        bottom: s.bottom,
        left: s.left,
        order: s.order,
      };
    },
    pseudo ?? null,
  );
}

async function token(page: Page, name: string, prop = "color"): Promise<string> {
  return page.evaluate(
    ([tokenName, property]) => {
      const probe = document.createElement("div");
      probe.style.setProperty(property as string, `var(${tokenName})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(property as string);
      probe.remove();
      if (!value) throw new Error(`token ${tokenName} 没有计算值`);
      return value;
    },
    [name, prop] as const,
  );
}

function parseColor(css: string): Rgba {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(css.trim());
  if (!match) throw new Error(`读不懂的颜色：${css}`);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) };
}

function over(fg: Rgba, bg: Rgba): Rgba {
  const mix = (foreground: number, background: number) => Math.round(foreground * fg.a + background * (1 - fg.a));
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

function luminance(color: Rgba): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

function contrast(foreground: Rgba, background: Rgba): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

async function expectContrast(target: Locator, background: Rgba, minimum: number): Promise<void> {
  const foreground = parseColor(await target.evaluate((el) => getComputedStyle(el).color));
  expect(contrast(foreground, background)).toBeGreaterThanOrEqual(minimum);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.locator(".lumir-hp-transcript").evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
}

async function expectLocalHorizontalScroll(target: Locator): Promise<void> {
  const result = await target.evaluate((el) => {
    const before = el.scrollLeft;
    const input = { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    el.scrollLeft = 120;
    const after = el.scrollLeft;
    el.scrollLeft = before;
    return { ...input, after };
  });
  expect(result.scrollWidth).toBeGreaterThan(result.clientWidth);
  expect(result.after).toBeGreaterThan(0);
}

async function expectTranscriptVerticalScroll(page: Page): Promise<void> {
  const scrollTop = await page.locator(".lumir-hp-transcript").evaluate((el) => {
    const before = el.scrollTop;
    el.scrollTop = el.scrollHeight;
    const after = el.scrollTop;
    el.scrollTop = before;
    return after;
  });
  expect(scrollTop).toBeGreaterThan(0);
}

async function expectElementWithin(container: Locator, target: Locator): Promise<void> {
  const outer = await container.boundingBox();
  const inner = await target.boundingBox();
  expect(outer).not.toBeNull();
  expect(inner).not.toBeNull();
  expect(inner!.width).toBeGreaterThan(0);
  expect(inner!.x).toBeGreaterThanOrEqual(outer!.x - 1);
  expect(inner!.x + inner!.width).toBeLessThanOrEqual(outer!.x + outer!.width + 1);
}

async function expectHarnessCandidate(page: Page, name: string): Promise<void> {
  const target = page.locator(".lumir-harness");
  const baseline = test.info().snapshotPath(name);
  if (existsSync(baseline)) {
    await expectScreenshot(target, name);
    return;
  }
  const candidate = test.info().outputPath(name.replace(/\.png$/, "-candidate.png"));
  await target.screenshot({ path: candidate, animations: "disabled" });
  test.info().annotations.push({ type: "pixel-candidate", description: candidate });
  console.log(`[pixel-candidate] ${name} -> ${candidate}`);
}

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test(`Harness 阅读排版：${theme} / ${viewport.name}`, async ({ page }) => {
      await openFixture(page, theme, viewport);
      const transcript = page.locator(".lumir-hp-transcript");
      const assistantBody = page.locator(".lumir-hp-msg-assistant .lumir-hp-body").first();
      const userBody = page.locator(".lumir-hp-msg-user > .lumir-hp-body");
      const code = page.locator(".lumir-hp-codeblock");
      const wideSlot = page.locator('.lumir-hp-block-slot[data-hp-block="table"]').filter({ hasText: "WIDE-甲" });
      const narrowSlot = page.locator('.lumir-hp-block-slot[data-hp-block="table"]').filter({ hasText: "NARROW-甲" });
      const wideTableScroll = wideSlot.locator(".lumir-hp-table-scroll");
      const table = wideSlot.locator("table");
      const approval = page.locator(".lumir-hp-approval");
      const composerArea = page.locator(".lumir-hp-composer-area");
      const composer = page.locator(".lumir-hp-composer");
      const harness = page.locator(".lumir-harness");
      const text2 = await token(page, "--text-2");
      const text3 = await token(page, "--text-3");
      const agentBg = parseColor(await token(page, "--agent-bg", "background-color"));
      const contentBg = parseColor(await token(page, "--content-bg", "background-color"));

      expect(await style(transcript)).toMatchObject({
        fontSize: "15px",
        lineHeight: "23.7px",
        padding: "16px 16px 12px",
        gap: "16px",
      });
      expect(await style(assistantBody)).toMatchObject({ overflowWrap: "anywhere", wordBreak: "normal" });
      expect(await style(composerArea)).toMatchObject({ padding: "12px 16px 16px", maxInlineSize: "none" });
      expect(await style(composer)).toMatchObject({
        fontSize: "15px",
        lineHeight: "23.7px",
        minHeight: "48px",
        padding: "10px 12px 4px",
        maxInlineSize: "none",
      });
      expect(await style(composer, "::before")).toMatchObject({ color: text2 });
      const placeholder = await composer.evaluate((el) => {
        const s = getComputedStyle(el, "::before");
        return { top: s.top, left: s.left };
      });
      expect(placeholder).toEqual({ top: "10px", left: "12px" });
      expect(contrast(parseColor((await style(composer, "::before")).color), contentBg)).toBeGreaterThanOrEqual(4.5);

      expect(await style(userBody)).toMatchObject({ padding: "8px 12px", borderRadius: "6px" });
      const userBg = over(parseColor((await style(userBody)).backgroundColor), agentBg);
      await expectContrast(userBody, userBg, 7);
      const who = page.locator(".lumir-hp-msg-assistant .lumir-hp-who").first();
      expect(await style(who)).toMatchObject({ fontSize: "10.5px", marginBottom: "4px" });
      const role = who.locator(".lumir-hp-role");
      const when = who.locator(".lumir-hp-when");
      expect(await style(role)).toMatchObject({ color: text2, fontSize: "10.5px" });
      expect(await style(when)).toMatchObject({ color: text3, fontSize: "10.5px" });
      await expectContrast(role, agentBg, 4.5);

      const firstParagraph = assistantBody.locator("p").first();
      expect(await style(firstParagraph)).toMatchObject({ marginTop: "0px", marginBottom: "8px" });
      expect(await style(assistantBody.locator("ul").first())).toMatchObject({ paddingLeft: "24px", margin: "8px 0px" });
      const adjacentItem = assistantBody.locator("li + li").first();
      await expect(adjacentItem).toHaveCount(1);
      expect((await style(adjacentItem)).marginTop).toBe("2px");
      const itemParagraph = assistantBody.locator("li p").first();
      await expect(itemParagraph).toHaveCount(1);
      expect(await style(itemParagraph)).toMatchObject({ marginTop: "4px", marginBottom: "4px" });
      const lastBlock = assistantBody.locator(":scope > :last-child");
      expect((await style(lastBlock)).marginBottom).toBe("0px");

      expect(await style(code)).toMatchObject({
        fontSize: "12.5px",
        lineHeight: "19.375px",
        padding: "10px 12px",
        borderRadius: "8px",
      });
      await expectLocalHorizontalScroll(code);
      expect(await style(table)).toMatchObject({ fontSize: "13px", lineHeight: "19.5px" });
      for (const cell of [table.locator("th").first(), table.locator("td").first()]) {
        expect(await style(cell)).toMatchObject({
          padding: "6px 10px",
          borderTopWidth: "0px",
          borderRightWidth: "0px",
          borderBottomWidth: "1px",
          borderLeftWidth: "0px",
        });
      }
      expect((await style(table.locator("th").first())).borderBottomColor).toBe(await token(page, "--border", "border-bottom-color"));
      expect((await style(table.locator("td").first())).borderBottomColor).toBe(
        await token(page, "--border-soft", "border-bottom-color"),
      );

      const toolRow = page.locator(".lumir-hp-tool-row.is-done");
      expect(await style(toolRow)).toMatchObject({ fontSize: "12px", minHeight: "28px" });
      expect(parseFloat((await style(toolRow)).height)).toBeGreaterThanOrEqual(28);
      const toolOut = page.locator(".lumir-hp-tool-out").first();
      await expect(toolOut).toHaveCount(1);
      expect((await style(toolOut)).color).toBe(text2);
      await expectContrast(toolOut, agentBg, 4.5);
      expect(await style(approval)).toMatchObject({ padding: "10px 12px" });
      for (const selector of [".lumir-hp-approval-purpose", ".lumir-hp-approval-basis", ".lumir-hp-argv", ".lumir-hp-reason"]) {
        expect((await style(approval.locator(selector))).marginBottom).toBe("8px");
      }
      for (const selector of [".lumir-hp-approval-basis"]) {
        const secondary = approval.locator(selector);
        expect((await style(secondary)).color).toBe(text2);
        await expectContrast(secondary, contentBg, 4.5);
      }
      const approve = approval.locator('button[data-act="approve"]');
      expect(await style(approve)).toMatchObject({ minHeight: "32px" });
      const buttonPadding = await approve.evaluate((el) => {
        const s = getComputedStyle(el);
        return { left: s.paddingLeft, right: s.paddingRight };
      });
      expect(buttonPadding).toEqual({ left: "12px", right: "12px" });

      const bodyBox = await assistantBody.boundingBox();
      const transcriptBox = await transcript.boundingBox();
      expect(bodyBox).not.toBeNull();
      expect(transcriptBox).not.toBeNull();
      expect(bodyBox!.width).toBeCloseTo(viewport.measure, 0);
      expect(Math.abs(bodyBox!.x - (transcriptBox!.x + 16))).toBeLessThanOrEqual(1);
      expect((await style(page.locator(".lumir-hp-msg-assistant").first())).maxInlineSize).toBe("720px");
      const narrowTableBox = await narrowSlot.locator("table").boundingBox();
      const narrowBodyBox = await narrowSlot.locator(".lumir-hp-table-scroll").boundingBox();
      expect(narrowTableBox).not.toBeNull();
      expect(narrowBodyBox).not.toBeNull();
      expect(Math.abs(narrowTableBox!.width - narrowBodyBox!.width)).toBeLessThanOrEqual(1);
      expect(narrowTableBox!.width).toBeLessThan(bodyBox!.width - 100);
      const composerBox = await composer.boundingBox();
      expect(composerBox!.width).toBeGreaterThanOrEqual(bodyBox!.width - 2);
      if (viewport.name === "ultrawide") expect(composerBox!.width).toBeGreaterThan(720);

      await approval.scrollIntoViewIfNeeded();
      await expectElementWithin(harness, approval);
      await expectElementWithin(approval, approve);
      await expectElementWithin(approval, approval.locator('button[data-act="reject"]'));
      const secondaryActions = approval.locator(".lumir-hp-remember");
      await expect(secondaryActions).toHaveCount(2);
      for (let index = 0; index < 2; index += 1) await expectElementWithin(approval, secondaryActions.nth(index));
      if (viewport.name === "narrow") {
        await expectLocalHorizontalScroll(wideTableScroll);
        await expectLocalHorizontalScroll(approval.locator(".lumir-hp-argv"));
        const lines = await secondaryActions.first().evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
        });
        expect(lines).toBeGreaterThan(1);
      } else {
        const wideDimensions = await wideTableScroll.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
        expect(wideDimensions.scrollWidth).toBe(wideDimensions.clientWidth);
      }

      await expectNoHorizontalOverflow(page);
      await expectTranscriptVerticalScroll(page);
      await expectElementWithin(harness, composerArea);
      await expectElementWithin(harness, page.locator(".lumir-hp-send"));
      await expectHarnessCandidate(page, `harness-typography-${theme}-${viewport.name}.png`);
    });
  }
}

for (const kind of ["patch-sub", "delete-note"] as const) {
  test(`Harness 阅读排版：${kind === "patch-sub" ? "批准副句" : "删除后果"}取 --text-2 且对比度达标`, async ({ page }) => {
    const pending = kind === "patch-sub"
      ? {
          id: "approval-patch-sub",
          tool: "vault_patch",
          diff: "--- a/synthetic.md\n+++ b/synthetic.md\n@@ -1 +1 @@\n-old\n+new",
          reason: { kind: "mode_default", mode: "read_only" },
        }
      : {
          id: "approval-delete-note",
          tool: "vault_delete",
          path: "synthetic.md",
          reason: { kind: "mode_default", mode: "read_only" },
        };
    await openPanel(page, "light", {
      messages: [],
      usage: { ctx_pct: 0, cache_pct_session: 0 },
      pending_approvals: [pending],
      warn_ctx_pct: 85,
      in_flight: true,
    });
    const approval = page.locator(".lumir-hp-approval");
    await expect(approval).toBeVisible();
    const secondary = approval.locator(kind === "patch-sub" ? ".lumir-hp-approval-sub" : ".lumir-hp-approval-note");
    await expect(secondary).toHaveCount(1);
    expect((await style(secondary)).color).toBe(await token(page, "--text-2"));
    await expectContrast(secondary, parseColor(await token(page, "--content-bg", "background-color")), 4.5);
    if (kind === "delete-note") expect((await style(secondary)).marginBottom).toBe("8px");
    else expect((await style(approval.locator(".lumir-hp-diff"))).marginBottom).toBe("8px");
  });
}

test("Harness 阅读排版：共享非默认缩放只变字号与行高，⌘0 回基线", async ({ page }) => {
  await openFixture(page, "light", VIEWPORTS[1]);
  const composer = page.locator(".lumir-hp-composer");
  await composer.click();
  await page.keyboard.press("Meta+=");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--editor-font-size").trim())).toBe("17px");
  const scale = 17 / 15;
  const cases: Array<[string, number, number]> = [
    [".lumir-hp-transcript", 15, 1.58],
    [".lumir-hp-composer", 15, 1.58],
    [".lumir-hp-table", 13, 1.5],
    [".lumir-hp-codeblock", 12.5, 1.55],
    [".lumir-hp-tool-row.is-done", 12, 0],
  ];
  for (const [selector, base, ratio] of cases) {
    const current = await style(page.locator(selector).first());
    expect(parseFloat(current.fontSize)).toBeCloseTo(base * scale, 2);
    if (ratio > 0) expect(parseFloat(current.lineHeight) / parseFloat(current.fontSize)).toBeCloseTo(ratio, 2);
  }
  expect(await style(page.locator(".lumir-hp-transcript"))).toMatchObject({ padding: "16px 16px 12px", gap: "16px" });
  expect((await style(page.locator(".lumir-hp-msg-assistant").first())).maxInlineSize).toBe("720px");
  expect((await style(page.locator(".lumir-hp-composer"))).minHeight).toBe("48px");
  expect((await style(page.locator(".lumir-hp-tool-row.is-done"))).minHeight).toBe("28px");
  expect((await style(page.locator('button[data-act="approve"]'))).minHeight).toBe("32px");
  await page.keyboard.press("Meta+0");
  await expect.poll(() => composer.evaluate((el) => getComputedStyle(el).fontSize)).toBe("15px");
  await expect.poll(() => page.locator(".lumir-hp-transcript").evaluate((el) => getComputedStyle(el).fontSize)).toBe("15px");
});

test("Harness 阅读排版：空态与输出尾行继承排版并留独立候选图", async ({ page }) => {
  await openPanel(page, "light", EMPTY_RUNNING_STATE);
  const empty = page.locator(".lumir-hp-empty");
  await expect(empty).toBeVisible();
  expect(await style(empty)).toMatchObject({
    position: "absolute",
    top: "16px",
    right: "16px",
    bottom: "12px",
    left: "16px",
    fontSize: "13px",
    lineHeight: "20.54px",
    padding: "24px",
    color: await token(page, "--text-2"),
    textAlign: "center",
  });
  const margins = await empty.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      top: parseFloat(s.marginTop),
      right: parseFloat(s.marginRight),
      bottom: parseFloat(s.marginBottom),
      left: parseFloat(s.marginLeft),
    };
  });
  expect(margins).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  await expectContrast(empty, parseColor(await token(page, "--agent-bg", "background-color")), 4.5);
  const stage = page.locator(".lumir-hp-stage");
  await expect(stage).toBeVisible();
  expect((await style(stage)).color).toBe(await token(page, "--text-2"));
  expect((await style(stage)).marginBottom).toBe("4px");
  await expectContrast(stage, parseColor(await token(page, "--agent-bg", "background-color")), 4.5);
  expect(await style(page.locator(".lumir-hp-progress"))).toMatchObject({
    order: "1",
    marginTop: "-12px",
    padding: "0px",
  });
  expect((await style(page.locator(".lumir-hp-bar-fill"))).animationName).toBe("lumir-hp-bar-slide");
  await expectHarnessCandidate(page, "harness-typography-empty-running.png");
});
