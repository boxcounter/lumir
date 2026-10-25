import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";
import { providerEntry, standardProviders } from "./provider-config";

const PROVIDERS = standardProviders();

// M628（Alex 2026-10-23 两条视觉调整）：
//
//   ① **用户消息气泡可读性**。修前气泡 = `--sel` 底 + `--text-2` 正文（M351/M370），
//      实测对比度 light 4.26:1 / dark 4.67:1（WCAG 正文 AA 线 4.5）、eink 5.54:1 且
//      `--sel` 在 eink 是大片 `#b9b9b9` 灰实底（e-ink 屏的中间调靠抖动呈现，整块灰底
//      上的字发糊）。Alex 原话：「user 消息是灰底黑字，难以阅读，特别是 eink 模式下，
//      几乎要趴在显示器上才能看清。」
//      修法（不动色值、只换语义位）：正文取 `--text`（正文档，不是 meta 档）；
//      light / dark 保留 `--sel` 面（M370「扫一眼可分」的裁决不动）；eink 灰实底退场，
//      改白面 + `--border` 描边（tokens 文档 eink 规则⑤ 的同一条口径：区块不另立色面，
//      层次由线宽承担——代码块 eink 翻白同款）。
//
//   ② **代码块横向滚动条改细**。`.lumir-hp-codeblock` 此前没进 M406 的细滚动条配方
//      （`.lumir-hp-diff` / `.lumir-hp-argv` 的 4px + 透明轨道），横向溢出时是系统默认
//      粗条，遮挡代码。配方只有一份：本 spec 断言三处消费者声明值逐值一致（REVIEW.md
//      「同一语义两处真源」条）。
//
// 断言分三层（缺一层就退化成假绿，REVIEW.md「断言等价于子串」条）：
//   ① **归属**：气泡正文色 / 底面 / 描边 == 对应 token 探针的解析值（三主题）；
//   ② **读数**：按计算后的前景与合成后的底面算 WCAG 对比度，要求 ≥ 7（AAA 正文档）——
//      这条与 token 无关，token 值漂了它照样拦；
//   ③ **区分度输入**：代码块场景先断言「确实横向溢出」，滚动条断言才有被测量对象；
//      CSSOM 按**精确选择器**取规则（子串匹配会漏进 `.lumir-hp-codeblock-x`）。
//      厚度判据落在声明层（4px）——macOS overlay 滚动条在 chromium 里不占布局空间，
//      实测占位读 0，「量出来的像素厚度」在这条通道上不存在（那条只守上界）。
//
// 不新增像素基线：本批是「值变了」，基线更新是 Alex 的人肉裁决点（mission 明确禁止
// 自行 `--update`）。证据截图走 `test.info().outputPath`（test-results 下，git 外）。

const DOC = "# 气泡笔记\n\n第一段，给面板一个上下文。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

const EMPTY_STATE = {
  messages: [],
  usage: { ctx_pct: 0, cache_pct_session: 0 },
  pending_approval: null,
  warn_ctx_pct: 85,
};

type Theme = "light" | "dark" | "eink";
const THEMES: Theme[] = ["light", "dark", "eink"];

/** M351 场景桩（同构）：config_get 补 [harness] 段；harness_send 只记录不回复
 *  （回复经 __fireHarnessEvent 注入）。 */
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
    w.__fireHarnessEvent = (payload: unknown) => {
      for (const id of w.__harnessEventHandlerIds) {
        internals.runCallback(id, { event: "harness:event", id, payload });
      }
    };
  }, state);
}

async function openPanel(page: Page, theme: Theme): Promise<void> {
  await stubTauri(page, { ...VAULT, config: { theme } });
  await stubHarness(page, EMPTY_STATE);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

function fire(page: Page, payload: unknown): Promise<void> {
  return page.evaluate(
    (p) => (window as unknown as { __fireHarnessEvent: (x: unknown) => void }).__fireHarnessEvent(p),
    payload,
  );
}

/** token 探针：把 var() 取值解析成计算样式后与目标比对（不硬编 rgb）。 */
async function probeColor(page: Page, prop: string, token: string): Promise<string> {
  return page.evaluate(
    ([p, t]) => {
      const probe = document.createElement("div");
      probe.style.setProperty(p as string, `var(${t})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(p as string);
      probe.remove();
      return value;
    },
    [prop, token] as const,
  );
}

type Rgba = { r: number; g: number; b: number; a: number };

/** `rgb(r, g, b)` / `rgba(r, g, b, a)` → 通道读数。读不懂直接抛（不把「读不到」当黑）。 */
function parseColor(css: string): Rgba {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(
    css.trim(),
  );
  if (!m) throw new Error(`读不懂的颜色：${css}`);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
}

/** 半透明前景压到不透明底上（dark 的 `--sel` 是 rgba(255,255,255,.075)，
 *  getComputedStyle 给的是未合成的值——直接拿它算对比度会算出一个屏幕上不存在的色）。 */
function over(fg: Rgba, bg: Rgba): Rgba {
  const mix = (f: number, b: number) => Math.round(f * fg.a + b * (1 - fg.a));
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 正文可读性下限：WCAG AAA 正文档 7:1（AA 是 4.5——修前的 light 4.26 连 AA 都没到）。 */
const MIN_TEXT_CONTRAST = 7;

for (const theme of THEMES) {
  test(`用户气泡（${theme}）：正文取 --text、对比度 ≥ ${MIN_TEXT_CONTRAST}、与 agent 面可辨`, async ({ page }) => {
    await openPanel(page, theme);

    await page.locator(".lumir-hp-composer").fill("这段怎么用？");
    await page.locator(".lumir-hp-send").click();
    await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);

    const body = page.locator(".lumir-hp-msg-user > .lumir-hp-body");
    await expect(body).toHaveCount(1);
    const style = await body.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        backgroundColor: s.backgroundColor,
        color: s.color,
        borderTopColor: s.borderTopColor,
        borderTopWidth: s.borderTopWidth,
        borderRadius: s.borderRadius,
        padding: s.padding,
      };
    });

    // ① 归属：正文色 = 正文档 token（不是 meta 档 --text-2——那是 tokens 文档给
    //    meta / th / 引用块 / lede 的位）。
    const textToken = await probeColor(page, "color", "--text");
    expect(style.color, "气泡正文色应取 --text").toBe(textToken);
    // 形态不变量（M351）：r6 圆角 + 1px 描边 + sp-3 / sp-4 内边距。
    expect(style.borderRadius).toBe("6px");
    expect(style.borderTopWidth).toBe("1px");
    expect(style.padding).toBe("6px 8px");

    const agentBg = parseColor(await probeColor(page, "background-color", "--agent-bg"));
    if (theme === "eink") {
      // eink：灰实底退场（规则⑤ 同款：区块不另立色面 ⇒ 白面 + 结构档描边）。
      // 断言的是「面 = 正文面、边缘 = 结构档」，而不是白底黑字这两个字面值。
      expect(style.backgroundColor, "eink 气泡底面应回落成正文面").toBe(
        await probeColor(page, "background-color", "--content-bg"),
      );
      expect(style.borderTopColor, "eink 气泡描边应取结构档 --border").toBe(
        await probeColor(page, "border-top-color", "--border"),
      );
    } else {
      // light / dark：底色仍取 --sel（M370 裁决「扫一眼可分」，不动）。可辨性判据取
      // 「气泡面合成后的明度与 agent 面相差一档」——不是「颜色不等」（M370 之前
      // content-bg / agent-bg 也「不等」，但明度差小到一屏内看不出来）。
      expect(style.backgroundColor).toBe(await probeColor(page, "background-color", "--sel"));
      expect(
        Math.abs(luminance(over(parseColor(style.backgroundColor), agentBg)) - luminance(agentBg)),
        "气泡面与 agent 面的明度差（M370 的可辨性判据）",
      ).toBeGreaterThan(0.01);
    }

    // ② 读数：合成后的真实读数算对比度（dark 的 --sel 是半透明，必须压在 agent 面上）。
    const bubbleBg = over(parseColor(style.backgroundColor), agentBg);
    const ratio = contrast(parseColor(style.color), bubbleBg);
    expect(ratio, `气泡正文对比度（${theme}）`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);

    // 证据截图（test-results 下，git 外；Alex 人肉裁决用）。
    await page.locator(".lumir-harness").screenshot({
      path: test.info().outputPath(`m628-bubble-${theme}.png`),
    });
  });
}

const LONG_LINE = `const longIdentifier = mapCellsToViewportWithRoundTrip("${"x".repeat(180)}");`;

test("代码块横向滚动条：声明 4px + 计算档 thin + 实测占位不超过 6px", async ({ page }) => {
  await openPanel(page, "light");
  // 先发一条用户消息：内容事件过轮次闸门（turnOpen），否则 text_chunk 被丢弃
  // （src/harness-panel.ts 的 GATED_EVENT_TYPES 段）。
  await page.locator(".lumir-hp-composer").fill("看一段长代码");
  await page.locator(".lumir-hp-send").click();
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
  await fire(page, { type: "text_chunk", text: `看这段代码：\n\n\`\`\`js\n${LONG_LINE}\n\`\`\`\n` });
  await fire(page, { type: "done" });

  const block = page.locator(".lumir-hp-codeblock");
  await expect(block).toHaveCount(1);
  await expect(block).toContainText("longIdentifier");

  // ③ 区分度输入：先证明「确实横向溢出」——没有溢出的容器上量滚动条厚度是空转。
  const measured = await block.evaluate((node) => {
    const el = node as HTMLElement;
    const s = getComputedStyle(el);
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      offsetHeight: el.offsetHeight,
      clientHeight: el.clientHeight,
      scrollbarWidth: s.scrollbarWidth,
      overflowX: s.overflowX,
    };
  });
  expect(measured.overflowX).toBe("auto");
  expect(
    measured.scrollWidth - measured.clientWidth,
    "长代码行必须在容器内横向溢出（否则本场景没有区分度）",
  ).toBeGreaterThan(120);

  // ① 标准通道：scrollbar-width: thin（计算档，不写死像素）。
  expect(measured.scrollbarWidth).toBe("thin");

  // ② 实测占位的**上界守卫**（不是厚度判据——实测登记：macOS 的 overlay 滚动条在
  //    本机 chromium 里不占布局空间，声明 ::-webkit-scrollbar 之后 offsetHeight −
  //    clientHeight 仍读 0，所以「4px」这个数值的判据落在下面的声明层）。这条守的是
  //    「不许退回占布局的系统粗条」：在会占位的渲染环境（classic 滚动条）上，默认粗条
  //    会让它判红。0 是有效读数（overlay 形态），不是「读不到」。
  const band = measured.offsetHeight - measured.clientHeight;
  expect(band, `横向滚动条实测占位（${band}px）`).toBeLessThanOrEqual(6);

  // ③ 声明值：CSSOM 按**精确选择器**取 ::-webkit-scrollbar 规则（子串匹配会漏进
  //    `.lumir-hp-codeblock-x` 这类名字）。配方只有一份真值：代码块与 M406 的
  //    diff / argv 三处消费者逐值一致（REVIEW.md「同一语义两处真源」条）。
  const rules = await page.evaluate(() => {
    const found: Array<{ selector: string; height: string; width: string }> = [];
    const walk = (list: CSSRuleList) => {
      for (const rule of Array.from(list)) {
        const anyRule = rule as unknown as {
          selectorText?: string;
          style?: CSSStyleDeclaration;
          cssRules?: CSSRuleList;
        };
        if (anyRule.cssRules) walk(anyRule.cssRules);
        if (anyRule.selectorText && anyRule.selectorText.includes("-webkit-scrollbar")) {
          found.push({
            selector: anyRule.selectorText,
            height: anyRule.style?.height ?? "",
            width: anyRule.style?.width ?? "",
          });
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      let list: CSSRuleList;
      try {
        list = sheet.cssRules;
      } catch {
        continue;
      }
      walk(list);
    }
    return found;
  });

  const consumers = [".lumir-hp-codeblock", ".lumir-hp-diff", ".lumir-hp-argv"];
  for (const consumer of consumers) {
    const rule = rules.find((r) => r.selector === `${consumer}::-webkit-scrollbar`);
    expect(rule, `缺 ${consumer}::-webkit-scrollbar 声明`).toBeTruthy();
    expect(rule!.height, `${consumer} 横向滚动条声明厚度`).toBe("4px");
    expect(rule!.width, `${consumer} 纵向滚动条声明厚度`).toBe("4px");
  }

  await page.locator(".lumir-harness").screenshot({
    path: test.info().outputPath("m628-scrollbar.png"),
  });
});
