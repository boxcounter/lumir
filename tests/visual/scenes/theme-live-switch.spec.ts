import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";

// 主题运行期切换（M237，change live-theme-switch）：命令 / 快捷键 / modeline 钮三个入口
// 切到同一条实现路径，`data-theme` 即时改写、代表性表面跟随、mermaid 按新主题重渲、
// 切换即写回配置。
//
// 三条口径（与 restyle-theme.spec.ts 的分工，MUST NOT 互相替代）：
//   - restyle-theme / restyle-eink 守「每个主题**长什么样**」——桩注入固定主题，断言色值表；
//   - 本场景守「切换这件事**做对了什么**」——桩注入启动主题，再经命令 / 点击切换，
//     断言 `data-theme` 变化、计算样式跟随、eink 组件级覆盖命中与失效、mermaid SVG 内联色
//     随重渲更新、配置写回被调用；
//   - **不新增像素基线**（design §4 末行：基线口径不变，切换场景只加结构层断言）。
//
// 判据用「探针 token 的计算值」而不是再抄一份色值表：主题取值表的真源是
// docs/specs/design-tokens-v1.md + restyle-theme.spec.ts，本场景要比的是**跟随关系**
// （表面 = 当前主题的 token 计算值），两处各抄一份色值表就是两处真源（REVIEW.md 第 8 条）。

const DOC = "# 主题切换\n\n切换用的一段正文。\n";

const MERMAID_DOC = [
  "# 图表",
  "",
  "切换主题后这个块要按新主题重渲。",
  "",
  "```mermaid",
  "graph TD",
  "  A[入口] --> B[出口]",
  "```",
  "",
].join("\n");

const VAULT = {
  entries: [
    { path: "doc.md", kind: "file", size: DOC.length, mtime_ms: 0 },
    { path: "diagram.md", kind: "file", size: MERMAID_DOC.length, mtime_ms: 0 },
  ],
  files: { "doc.md": DOC, "diagram.md": MERMAID_DOC },
};

/** 打开文档并等主题施加完成（`data-theme` 与指示钮文案都到位）。 */
async function openWithTheme(page: Page, file: string, theme?: "light" | "dark" | "eink"): Promise<void> {
  await stubTauri(page, theme === undefined ? VAULT : { ...VAULT, config: { theme } });
  await page.goto("/");
  await page.locator(`.ft-row[title="${file}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(file);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme ?? "light");
}

/** 读当前主题的读数面：dataset + modeline 指示钮（文案 / 悬停提示 / 读屏名）+ 可选表面。 */
async function readTheme(page: Page) {
  return page.evaluate(() => {
    const chip = document.querySelector<HTMLElement>(".modeline-theme");
    return {
      dataset: document.documentElement.dataset.theme ?? null,
      chipText: chip?.textContent ?? null,
      chipTitle: chip?.title ?? null,
      chipAriaLabel: chip?.getAttribute("aria-label") ?? null,
      chipHidden: chip?.hidden ?? null,
    };
  });
}

/** 探针取某个 token 的**计算值**：`getPropertyValue` 的字面量与计算值不是同一口径
 *（Chromium 把颜色类自定义属性按最短形式序列化，`#ffffff` 读回是 `#fff`），
 *  落到探针元素的 `background-color` 上读回才与表面的计算值同口径（restyle-theme 同法）。 */
async function tokenColors(page: Page, names: string[]): Promise<Record<string, string>> {
  return page.evaluate((list: string[]) => {
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const out: Record<string, string> = {};
    for (const name of list) {
      probe.style.backgroundColor = `var(${name})`;
      out[name] = getComputedStyle(probe).backgroundColor;
    }
    probe.remove();
    return out;
  }, names);
}

/** 一组代表性表面的计算值（chrome 面 + 编辑器面）。 */
async function surfaces(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const read = (selector: string, prop: "backgroundColor" | "color" | "borderTopColor") => {
      const el = document.querySelector(selector);
      return el === null ? "(缺席)" : getComputedStyle(el)[prop];
    };
    return {
      shell: read(".app-shell", "backgroundColor"),
      editor: read(".cm-editor", "backgroundColor"),
      editorText: read(".cm-editor", "color"),
      modeline: read(".modeline", "backgroundColor"),
      chipBorder: read(".modeline-theme", "borderTopColor"),
    };
  });
}

/** mermaid 节点的填充色（themeVariables 的 primaryColor 落在节点矩形上；
 *  它是**烧进 SVG 内联样式**的色，CSS 变量跟不上——切换后必须重渲才会变）。 */
async function mermaidNodeFill(page: Page): Promise<string> {
  return page
    .locator(".cm-lp-mermaid svg .node rect, .cm-lp-mermaid svg .node polygon, .cm-lp-mermaid svg rect.basic")
    .first()
    .evaluate((el) => getComputedStyle(el).fill);
}

/** 切换用的键盘注入：⌘⇧T（keys.ts 的默认绑定）。
 *  注意合成事件的 token 形态——Playwright 的 `Meta+Shift+T` 给的是 `key="T"` + shiftKey，
 *  归一成 `Cmd-Shift-T`，与表内写法一致（keys.test.ts 有同口径的单测）。 */
async function pressThemeKey(page: Page): Promise<void> {
  await page.keyboard.press("Meta+Shift+T");
}

/** 等指示钮文案变成 target（切换是同步的，但写 DOM 与断言之间隔一拍事件循环）。 */
async function expectTheme(page: Page, theme: "light" | "dark" | "eink"): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
  await expect(page.locator(".modeline-theme")).toHaveText(theme);
}

test("出厂首帧：指示钮显示启动主题，且它就在 modeline 右段（常驻归因出口）", async ({ page }) => {
  await openWithTheme(page, "doc.md", "light");
  const now = await readTheme(page);
  expect(now.dataset).toBe("light");
  expect(now.chipText).toBe("light");
  expect(now.chipTitle).toBe("主题：light（点击切换）"); // 文案 D122：title 与 aria-label 同串
  expect(now.chipAriaLabel).toBe("主题：light（点击切换）");
  expect(now.chipHidden).toBe(false);
  await expect(page.locator(".modeline-theme")).toBeVisible();
  // 常驻可见：不需要任何交互就在场（D3 遗留的「我这是哪个主题」归因成本）
  await expect(page.locator(".modeline-right .modeline-theme")).toHaveCount(1);
});

test("⌘⇧T：三档循环一周，每档 data-theme 与代表性表面的计算样式跟随", async ({ page }) => {
  await openWithTheme(page, "doc.md", "light");

  // 起点读数与「跟随」的判据基准（同一时刻的 token 计算值）
  const lightTokens = await tokenColors(page, ["--content-bg", "--frame", "--text"]);
  const lightSurfaces = await surfaces(page);
  expect(lightSurfaces.editor).toBe(lightTokens["--content-bg"]);
  expect(lightSurfaces.shell).toBe(lightTokens["--frame"]);
  expect(lightSurfaces.editorText).toBe(lightTokens["--text"]);

  await pressThemeKey(page);
  await expectTheme(page, "dark");
  const darkTokens = await tokenColors(page, ["--content-bg", "--frame", "--text"]);
  const darkSurfaces = await surfaces(page);
  // 表面 = 当前主题的 token 计算值（不是「别处的绝对值」——真源是 token 层）
  expect(darkSurfaces.editor).toBe(darkTokens["--content-bg"]);
  expect(darkSurfaces.shell).toBe(darkTokens["--frame"]);
  expect(darkSurfaces.editorText).toBe(darkTokens["--text"]);
  // 反向判据：跟随是**真的换了值**，不是两边都读到同一个默认值（REVIEW.md 第 1 条）
  expect(darkTokens["--content-bg"]).not.toBe(lightTokens["--content-bg"]);
  expect(darkSurfaces.editor).not.toBe(lightSurfaces.editor);

  await pressThemeKey(page);
  await expectTheme(page, "eink");
  const einkTokens = await tokenColors(page, ["--content-bg", "--text"]);
  const einkSurfaces = await surfaces(page);
  expect(einkSurfaces.editor).toBe(einkTokens["--content-bg"]);
  expect(einkSurfaces.editorText).toBe(einkTokens["--text"]);
  expect(einkTokens["--content-bg"]).not.toBe(darkTokens["--content-bg"]);

  // 第三档再按一次回到 light：循环一周
  await pressThemeKey(page);
  await expectTheme(page, "light");
  const back = await surfaces(page);
  expect(back.editor).toBe(lightSurfaces.editor);
  expect(back.editorText).toBe(lightSurfaces.editorText);
});

test("eink 组件级覆盖：命中（描边化）与失效（切回后不再命中）", async ({ page }) => {
  await openWithTheme(page, "doc.md", "light");
  const lightChipBorder = (await surfaces(page)).chipBorder;
  // eink 规则⑥「chip 描边化」：底色退场、描边取 --border（eink = #000）。
  // 基础档的边框是 transparent 占位（保线宽、切主题零位移），因此这两档的 border-color
  // 必然不同——这条断言就是「覆盖命中」的判据。
  expect(lightChipBorder).not.toBe("rgb(0, 0, 0)");

  await pressThemeKey(page); // light → dark
  await expectTheme(page, "dark");
  await pressThemeKey(page); // dark → eink
  await expectTheme(page, "eink");
  const einkChip = await page.locator(".modeline-theme").evaluate((el) => {
    const style = getComputedStyle(el);
    return { border: style.borderTopColor, background: style.backgroundColor, shadowPop: getComputedStyle(document.documentElement).getPropertyValue("--shadow-pop").trim() };
  });
  expect(einkChip.border).toBe("rgb(0, 0, 0)");
  // 底色退场：读的是**过渡落定后**的值。chip 的 background 有一条 0.12s 过渡
  //（tokens 文档「动效」：只有 hover 过渡），紧跟 data-theme 之后直接读会拿到插值中的
  // rgba(0, 0, 0, 0.04)——那是过渡态，不是终态（实测踩到过：第一次写这条断言就红在这里）。
  await expect
    .poll(() => page.locator(".modeline-theme").evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe("rgba(0, 0, 0, 0)");
  expect(einkChip.shadowPop).toBe("none"); // eink 规则⑦：阴影全退场（三主题分档的既有常量）

  // 覆盖**失效**：切回 light 后 eink 的那条组件级规则不再命中（否则「命中」这条断言
  // 可能只是读到了一条对所有主题都成立的规则）
  await pressThemeKey(page); // eink → light
  await expectTheme(page, "light");
  expect((await surfaces(page)).chipBorder).toBe(lightChipBorder);
});

test("modeline 指示钮点击 = 同一条切换路径（不再经键盘）", async ({ page }) => {
  await openWithTheme(page, "doc.md", "light");
  await page.locator(".modeline-theme").click();
  await expectTheme(page, "dark");
  // 点第二次照常推进（钮不是一次性入口）
  await page.locator(".modeline-theme").click();
  await expectTheme(page, "eink");
  // 三项对账的观测面：写回调用与主题一一对应（key=theme，value=新主题）
  const writes = await page.evaluate(
    () => (window as unknown as { __uiValueWrites?: Array<{ key: string; value: unknown }> }).__uiValueWrites ?? [],
  );
  expect(writes).toEqual([
    { key: "theme", value: "dark" },
    { key: "theme", value: "eink" },
  ]);
});

test("切换即写回配置：每次切换一次 config_set_ui_value（不等结果、不重复写）", async ({ page }) => {
  await openWithTheme(page, "doc.md", "light");
  const invokesBefore = await page.evaluate(
    () => (window as unknown as { __invokes: string[] }).__invokes.filter((c) => c === "config_set_ui_value").length,
  );
  expect(invokesBefore).toBe(0); // 启动装配 MUST NOT 写回（配置是启动真源，启动不产生写）

  await pressThemeKey(page);
  await expectTheme(page, "dark");
  const after = await page.evaluate(
    () => (window as unknown as { __invokes: string[] }).__invokes.filter((c) => c === "config_set_ui_value").length,
  );
  expect(after).toBe(1); // 一次切换一次写，不重复
  // 写回失败路径（toast + config_warning）不改主题：运行期值不回滚
});

test("mermaid：切换后按新主题重渲（SVG 内联色跟到新 token），旧色不残留", async ({ page }) => {
  await openWithTheme(page, "diagram.md", "light");
  await expect(page.locator(".cm-lp-mermaid svg").first()).toBeVisible();
  const lightFill = await mermaidNodeFill(page);
  const lightToken = (await tokenColors(page, ["--accent-tint"]))["--accent-tint"];
  expect(lightFill).toBe(lightToken); // 渲染时读的是当前主题的计算值（M219 的既有接线）
  expect(lightFill).not.toBe("rgb(0, 0, 0)");

  await pressThemeKey(page); // light → dark
  await expectTheme(page, "dark");
  // 重渲是异步的（先回落 pending 占位、经串行队列 settle），等它落到新主题的色
  const darkToken = (await tokenColors(page, ["--accent-tint"]))["--accent-tint"];
  await expect.poll(() => mermaidNodeFill(page)).toBe(darkToken);
  const darkFill = await mermaidNodeFill(page);
  // 判据的区分度：新色 ≠ 旧色。旧 SVG 的色烧在内联样式里，**不可能**自己变——
  // 颜色变了只能是路径真的重渲了一遍（这也是「旧色不残留」的判据）
  expect(darkFill).not.toBe(lightFill);
});

test("mermaid：切换时块先回落 pending 占位，再以新主题的色 settle（三态经过，不是原地换色）", async ({ page }) => {
  await openWithTheme(page, "diagram.md", "light");
  await expect(page.locator(".cm-lp-mermaid svg").first()).toBeVisible();

  // 观察面：MutationObserver 记下每个 mermaid 容器**经历过的**状态序列。
  // 为什么不用「切换后轮询到 pending」：重渲可能在两次轮询之间就结束了，那样只能靠运气。
  // 观察器在微任务检查点收到变更，而 settle 至少晚一个 promise 链，因此 pending 那一段
  // 必然被记下（这条断言就是「先回落占位」这个行为的判据）。
  await page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { __mermaidStates: string[] }).__mermaidStates = log;
    const read = (box: Element): string => {
      if (box.classList.contains("cm-lp-mermaid-pending")) return "pending";
      if (box.classList.contains("cm-lp-mermaid-fallback")) return "fallback";
      return box.querySelector("svg") !== null ? "ok" : "empty";
    };
    new MutationObserver(() => {
      const box = document.querySelector(".cm-lp-mermaid");
      const state = box === null ? "missing" : read(box);
      if (log[log.length - 1] !== state) log.push(state);
    }).observe(document.body, { childList: true, subtree: true });
    // 起手记下切换前的状态（此时 SVG 已可见，见上一条断言）：观察器只在**变更**时回调，
    // 不主动记一次的话，「先回落 pending」就少了前一半（序列会读成 pending→ok）
    log.push(read(document.querySelector(".cm-lp-mermaid")!));
  });

  await pressThemeKey(page);
  await expectTheme(page, "dark");
  await expect(page.locator(".cm-lp-mermaid svg").first()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __mermaidStates: string[] }).__mermaidStates.join("→")))
    .toBe("ok→pending→ok");
  // 终态仍不是降级：pending 之后落到 ok 而不是 fallback
  const sequence = await page.evaluate(() => (window as unknown as { __mermaidStates: string[] }).__mermaidStates);
  expect(sequence).not.toContain("fallback");
});

test("mermaid：切换后的渲染结果按新主题落定，且块不残留 pending 占位", async ({ page }) => {
  await openWithTheme(page, "diagram.md", "light");
  await expect(page.locator(".cm-lp-mermaid svg").first()).toBeVisible();

  await pressThemeKey(page);
  await expectTheme(page, "dark");
  // settle 的终态判据：SVG 在、pending 占位不在、降级块不在（三态里落在了 ok）
  await expect(page.locator(".cm-lp-mermaid svg").first()).toBeVisible();
  await expect(page.locator(".cm-lp-mermaid-pending")).toHaveCount(0);
  await expect(page.locator(".cm-lp-mermaid-fallback")).toHaveCount(0);
  // 文档正文没有被切换动作改写（装饰层只改视图：ADR 0003 §3）
  await expect(page.locator(".cm-content")).toContainText("切换主题后这个块要按新主题重渲。");
});
