import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  clearMermaidRenderCache,
  ensureMermaidRender,
  invalidateMermaidTheme,
  mermaidBlockSet,
  mermaidRenderCacheSize,
  onMermaidSettled,
  setMermaidLoaderForTests,
  setMermaidTimeoutsForTests,
} from "../../../src/preview/mermaid";
import { logEvents, stubTauri } from "./tauri-stub";

// Mermaid 图表渲染（foundation-markdown 用户裁决，M105 选型 mermaid 官方包）：
// Node 侧单测（缓存/降级/块定位，假 mermaid 注入，不依赖 DOM）+ UI 场景
//（渲染成功/失败降级/懒加载 chunk 隔离/不阻塞 F0/复制保真/排版基线视觉）。

// ---------------------------------------------------------------------------
// 渲染缓存：pending → settle，成功与失败都按源码缓存
// ---------------------------------------------------------------------------

const fakeMermaid = {
  initialize: () => {},
  parse: (source: string) =>
    source.includes("BAD") ? Promise.reject(new Error("Parse error on line 1:\nBAD")) : Promise.resolve({ diagramType: "flowchart" }),
  render: (_id: string, source: string) => Promise.resolve({ svg: `<svg data-source="${source}"></svg>` }),
};

function settleOnce(): Promise<void> {
  return new Promise((resolve) => {
    const off = onMermaidSettled(() => {
      off();
      resolve();
    });
  });
}

test("渲染：pending → settle 成功/失败，按源码缓存", async () => {
  setMermaidLoaderForTests(() => Promise.resolve(fakeMermaid));
  clearMermaidRenderCache();
  try {
    // 未命中先 pending，settle 后命中同一结果对象
    const settled = settleOnce();
    const pending = ensureMermaidRender("graph TD; A-->B");
    expect(pending.status).toBe("pending");
    await settled;
    const ok = ensureMermaidRender("graph TD; A-->B");
    expect(ok.status === "ok" && ok.svg).toContain("graph TD; A-->B");
    expect(ensureMermaidRender("graph TD; A-->B")).toBe(ok); // 缓存命中同一对象
    expect(mermaidRenderCacheSize()).toBe(1);

    // parse 预校验失败 → error 缓存，不重复渲染
    const settledBad = settleOnce();
    ensureMermaidRender("BAD");
    await settledBad;
    const bad = ensureMermaidRender("BAD");
    expect(bad.status === "error" && bad.message).toBe("Parse error on line 1:");
    expect(mermaidRenderCacheSize()).toBe(2);

    // 缓存键即源码（单排版基线，无主题维度）：同源码直接命中，不重复渲染
    expect(ensureMermaidRender("graph TD; A-->B")).toBe(ok);
    expect(mermaidRenderCacheSize()).toBe(2);
  } finally {
    setMermaidLoaderForTests(null);
    clearMermaidRenderCache();
  }
});

// ---------------------------------------------------------------------------
// 有界超时与加载重试（M110）：加载永不 settle / 瞬时失败不得挂死或毒化队列
// ---------------------------------------------------------------------------

test("有界超时：加载永不 settle 转为 load 阶段错误，队列不堵死", async () => {
  setMermaidTimeoutsForTests(50, 50);
  setMermaidLoaderForTests(() => new Promise(() => {}));
  clearMermaidRenderCache();
  try {
    const settled = settleOnce();
    ensureMermaidRender("graph TD; A-->B");
    await settled;
    const err = ensureMermaidRender("graph TD; A-->B");
    expect(err.status === "error" && err.stage).toBe("load");
    expect(err.status === "error" && err.message).toContain("超时");
    // 队列不堵死：恢复加载器后新任务照常完成
    setMermaidLoaderForTests(() => Promise.resolve(fakeMermaid));
    const settledOk = settleOnce();
    ensureMermaidRender("graph TD; C-->D");
    await settledOk;
    expect(ensureMermaidRender("graph TD; C-->D").status).toBe("ok");
  } finally {
    setMermaidLoaderForTests(null);
    setMermaidTimeoutsForTests(null, null);
    clearMermaidRenderCache();
  }
});

test("加载失败可重试：一次拒绝不毒化后续渲染", async () => {
  let calls = 0;
  setMermaidLoaderForTests(() => (++calls === 1 ? Promise.reject(new Error("chunk 404")) : Promise.resolve(fakeMermaid)));
  clearMermaidRenderCache();
  try {
    const settled = settleOnce();
    ensureMermaidRender("graph TD; A-->B");
    await settled;
    const err = ensureMermaidRender("graph TD; A-->B");
    expect(err.status === "error" && err.stage).toBe("load");
    // 失败结果按源码缓存（不自动重渲染）；缓存失效后加载器会被重新调用
    clearMermaidRenderCache();
    const settledRetry = settleOnce();
    ensureMermaidRender("graph TD; A-->B");
    await settledRetry;
    expect(ensureMermaidRender("graph TD; A-->B").status).toBe("ok");
    expect(calls).toBe(2);
  } finally {
    setMermaidLoaderForTests(null);
    clearMermaidRenderCache();
  }
});



// ---------------------------------------------------------------------------
// 主题失效：invalidateMermaidTheme 的幂等性与世代号守卫（M237，change live-theme-switch）
//
// 主题切换时 mermaid 必须按新主题重渲（颜色烧进 SVG 内联样式，CSS 变量无法事后跟随）。
// 这四条跑的是真代码（fake 渲染器注入），判据是「缓存里到底是什么」与「render / initialize
// 被调了几次」这两个可数的事实。
//
// 为什么不进 tests/unit：src/preview/mermaid.ts 用了 TS 参数属性（MermaidBlockWidget 的
// 构造器），Node 的类型剥离（strip-only）拒绝该语法——这正是本文件承载 mermaid 的 Node 侧
// 单测的既有原因（见 tests/unit/tsconfig.json 的注释）。
// ---------------------------------------------------------------------------

/** 可控的假渲染器：render 的 settle 由测试显式放行（模拟「切换瞬间在飞」的渲染）。
 *  每次 render 的产物带 `data-run` 序号——「落地的是哪一次渲染的结果」因此可判（世代号
 *  守卫的核心判据不是「调了几次」而是「哪一次的结果进了缓存」）。 */
function deferredRenderer() {
  const gates: Array<() => void> = [];
  let renders = 0;
  const renderer = {
    initialize: () => {},
    parse: () => Promise.resolve({}),
    render: (_id: string, source: string) => {
      renders++;
      const run = renders;
      return new Promise<{ svg: string }>((resolve) => {
        gates.push(() => resolve({ svg: `<svg data-run="${run}" data-source="${source}"></svg>` }));
      });
    },
  };
  return {
    renderer,
    renderCalls: () => renders,
    releaseFirst: () => gates.shift()?.(),
    releaseAll: () => {
      for (const gate of gates.splice(0)) gate();
    },
  };
}

/** 等微任务队列清空（settle 回调挂在 Promise 链上，落定要让它跑完几拍）。 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

/** 轮询等到条件成立（默认 2s）。
 *
 *  为什么不数微任务拍数：渲染串行队列（`queue`）是**模块级**状态，一次测试里「第 n 次
 *  render 何时开始」取决于队列前面还有没有在飞的 job——拍数写死会在全量套件里红、单跑绿
 * （M237 实测：同一条用例单跑 8/8 过、全量里红）。条件轮询对队列位置不敏感，且超时会报错
 *  而不是静默放过。 */
async function waitUntil(predicate: () => boolean, message: string, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waitUntil 超时：${message}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("主题失效：未懒加载时是幂等 no-op（不触发加载、不产出缓存）", async () => {
  let loads = 0;
  setMermaidLoaderForTests(() => {
    loads++;
    return Promise.resolve(deferredRenderer().renderer);
  });
  clearMermaidRenderCache();
  let settled = 0;
  const off = onMermaidSettled(() => {
    settled++;
  });
  try {
    invalidateMermaidTheme();
    invalidateMermaidTheme(); // 幂等：连调两次与一次等价
    await flushMicrotasks();
    expect(loads).toBe(0); // 失效本身 MUST NOT 触发渲染器加载（懒加载只在首个围栏块出现时发生）
    expect(mermaidRenderCacheSize()).toBe(0);
    expect(settled).toBe(0);
  } finally {
    off();
    setMermaidLoaderForTests(null);
    clearMermaidRenderCache();
  }
});

test("主题失效：世代号守卫丢弃迟到的旧主题结果（缓存里落地的是新世代那一次的结果）", async () => {
  const fake = deferredRenderer();
  setMermaidLoaderForTests(() => Promise.resolve(fake.renderer));
  clearMermaidRenderCache();
  let settled = 0;
  const off = onMermaidSettled(() => {
    settled++;
  });
  const source = "graph TD; A-->B";
  try {
    // ① 切换前入队（旧主题那一次）
    expect(ensureMermaidRender(source).status).toBe("pending");
    await waitUntil(() => fake.renderCalls() === 1, "旧主题的渲染入队");

    // ② 切换主题：缓存整体清空 + 世代号自增
    invalidateMermaidTheme();
    expect(mermaidRenderCacheSize()).toBe(0);

    // ③ 装饰重建路径（previewRefresh）：同一 source 缓存未命中，按新主题再入队一次
    expect(ensureMermaidRender(source).status).toBe("pending");

    // ④ 放行旧世代那一次：它 settle 时被丢弃（不写缓存、不通知），队列随即轮到新世代那次
    fake.releaseFirst();
    await waitUntil(() => fake.renderCalls() === 2, "新世代那次渲染在旧世代 settle 后才开始");
    expect(settled).toBe(0); // 丢弃的那次 MUST NOT 通知 settle
    expect(ensureMermaidRender(source).status).toBe("pending"); // 缓存里仍是新世代的 pending
    expect(mermaidRenderCacheSize()).toBe(1);

    // ⑤ 放行新世代那次：结果落地，且落地的是**新世代的产物**（data-run=2）
    fake.releaseAll();
    await waitUntil(() => ensureMermaidRender(source).status === "ok", "新世代渲染 settle");
    const final = ensureMermaidRender(source);
    expect(final.status === "ok" && final.svg).toContain('data-run="2"');
    expect(final.status === "ok" && final.svg).not.toContain('data-run="1"');
    expect(settled).toBe(1);
    expect(fake.renderCalls()).toBe(2); // 丢弃 MUST NOT 重排队（重渲由 previewRefresh 重建路径承担）
  } finally {
    fake.releaseAll(); // 不留未放行的 gate：队列是模块级的，漏一个会堵住后续用例
    off();
    setMermaidLoaderForTests(null);
    clearMermaidRenderCache();
  }
});

test("对照组：未失效时在飞的渲染照常落缓存并通知（证明上一条的判据有区分度）", async () => {
  const fake = deferredRenderer();
  setMermaidLoaderForTests(() => Promise.resolve(fake.renderer));
  clearMermaidRenderCache();
  let settled = 0;
  const off = onMermaidSettled(() => {
    settled++;
  });
  const source = "graph TD; C-->D";
  try {
    ensureMermaidRender(source);
    await waitUntil(() => fake.renderCalls() === 1, "渲染入队");
    fake.releaseAll();
    await waitUntil(() => ensureMermaidRender(source).status === "ok", "结果落缓存");
    expect(settled).toBe(1);
  } finally {
    fake.releaseAll();
    off();
    setMermaidLoaderForTests(null);
    clearMermaidRenderCache();
  }
});

test("主题失效后重渲会重新 initialize（新主题的 token 计算值才读得进来）", async () => {
  let inits = 0;
  setMermaidLoaderForTests(() =>
    Promise.resolve({
      initialize: () => {
        inits++;
      },
      parse: () => Promise.resolve({}),
      render: (_id: string, source: string) => Promise.resolve({ svg: `<svg data-source="${source}"></svg>` }),
    }),
  );
  clearMermaidRenderCache();
  const source = "graph TD; E-->F";
  try {
    const first = settleOnce();
    ensureMermaidRender(source);
    await first;
    expect(inits).toBe(1);

    // 缓存命中：不再渲染、也不重复 initialize（既有性质不变）。
    // MUST NOT 在这里 await 一次 settle：命中路径不产生 settle 通知，等它必然超时
    //（M237 实测：这条写法在全量套件里 30s 超时，单跑绿——靠上一条用例遗留的 settle 蒙过）
    expect(ensureMermaidRender(source).status).toBe("ok");
    expect(inits).toBe(1);

    invalidateMermaidTheme();
    const third = settleOnce();
    ensureMermaidRender(source);
    await third;
    // initialize 是**全局态**：不复位它，重渲读到的还是旧主题的 token 计算值
    expect(inits).toBe(2);
  } finally {
    setMermaidLoaderForTests(null);
    clearMermaidRenderCache();
  }
});

function blockCount(doc: string, selection?: { anchor: number; head: number }): number {
  const state = EditorState.create({
    doc,
    selection,
    extensions: [markdown({ base: markdownLanguage, extensions: [GFM] })],
  });
  let count = 0;
  mermaidBlockSet(state).between(0, state.doc.length, () => { count++; });
  return count;
}

test("块定位：围栏块识别与排除口径", () => {
  const diagram = "# t\n\n```mermaid\ngraph TD\n  A-->B\n```\n";
  expect(blockCount(diagram)).toBe(1);
  // 普通围栏块（info 非 mermaid）不识别； prose 里的 mermaid 字样不误判
  expect(blockCount("```js\nconst mermaid = 1;\n```\n")).toBe(0);
  expect(blockCount("正文提到 mermaid 一词。\n")).toBe(0);
  // 选区进入块范围：跳过装饰显示原文
  expect(blockCount(diagram, { anchor: 20, head: 25 })).toBe(0);
  // frontmatter 内的围栏不识别
  expect(blockCount("---\ntitle: t\n---\n\n" + diagram)).toBe(1);
});

// ---------------------------------------------------------------------------
// UI 场景
// ---------------------------------------------------------------------------

const MERMAID_MD = `\
# 图表

\`\`\`mermaid
graph TD
  A[开始] --> B{判断}
  B -->|是| C[结束]
\`\`\`

失败图表：

\`\`\`mermaid
graph TD
  A[未闭合
\`\`\`

普通代码块：

\`\`\`js
const mermaid = "not a diagram";
\`\`\`
`;

const VAULT = {
  entries: [
    { path: "diagram.md", kind: "file", size: MERMAID_MD.length, mtime_ms: 0 },
    { path: "plain.md", kind: "file", size: 20, mtime_ms: 0 },
  ],
  files: {
    "diagram.md": MERMAID_MD,
    "plain.md": "# 纯文本\n\n没有图表。\n",
  },
};

async function openDiagram(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="diagram.md"]').click();
  await expect(page.locator(".cm-lp-mermaid svg").first()).toBeVisible();
}

test("渲染成功，失败回落完整原文，普通代码块不误判", async ({ page }) => {
  await openDiagram(page);

  // 成功：SVG 进入占位 widget 原位
  await expect(page.locator(".cm-lp-mermaid svg")).toHaveCount(1);
  await expect(page.locator(".cm-lp-mermaid-pending")).toHaveCount(0);

  // 失败降级：提示 + 完整原文围栏块，不伪装成图表
  const fallback = page.locator(".cm-lp-mermaid-fallback");
  await expect(fallback).toHaveCount(1);
  await expect(fallback).toContainText("图表解析失败");
  await expect(fallback.locator(".cm-lp-mermaid-raw")).toContainText("graph TD");
  await expect(fallback.locator(".cm-lp-mermaid-raw")).toContainText("```mermaid");
  await expect(fallback.locator("svg")).toHaveCount(0);

  // 普通代码块含 mermaid 字样：保持代码行，不渲染
  await expect(page.locator(".cm-lp-codeblock-line").filter({ hasText: "const mermaid" })).toHaveCount(1);

  // 诊断埋点（M136）：降级路径必须**经 log_event 转发** render_error，且只记分类后的
  // 结果——原始错误文本（含图表源码）不得进日志。kind/stage/code 由 src/preview/mermaid.ts
  // 给出，白名单在 src-tauri/src/logging.rs。失败结果入缓存，成功图表不记。
  await expect
    .poll(async () => (await logEvents(page, "render_error")).map((e) => e.fields))
    .toEqual([{ kind: "mermaid", stage: "render", code: "render_failed" }]);

  await expectScreenshot(page, "mermaid-rendering.png");
});

test("复制保真：全选复制输出原始 Markdown", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openDiagram(page);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+c");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(MERMAID_MD);
});

test("选区进入 mermaid 块时显示原文（编辑/选择可见源码）", async ({ page }) => {
  await openDiagram(page);
  await expect(page.locator(".cm-lp-mermaid svg")).toHaveCount(1);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await expect(page.locator(".cm-lp-mermaid")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("graph TD");
});

test("懒加载：无 mermaid 块不请求图表 chunk，首个 mermaid 块触发加载", async ({ page }) => {
  const jsRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/assets/") && req.url().endsWith(".js")) jsRequests.push(req.url());
  });
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="plain.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("纯文本");
  expect(jsRequests.some((u) => u.includes("mermaid"))).toBe(false);

  await page.locator('.ft-row[title="diagram.md"]').click();
  await expect(page.locator(".cm-lp-mermaid svg").first()).toBeVisible();
  expect(jsRequests.some((u) => u.includes("mermaid"))).toBe(true);
});

test("不阻塞 F0：chunk 未就绪时 paint 照常、占位先出，释放后 settle", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/assets/mermaid.core-*.js", async (route) => {
    await gate;
    await route.continue();
  });
  await stubTauri(page, VAULT);
  await page.addInitScript(() => {
    (window as unknown as { __paints: number }).__paints = 0;
    window.addEventListener("lumir:paint", () => {
      (window as unknown as { __paints: number }).__paints++;
    });
  });
  await page.goto("/");
  await page.locator('.ft-row[title="diagram.md"]').click();

  // chunk 被按住：占位可见，且 F0（paint）已派发——渲染不阻塞首帧
  await expect(page.locator(".cm-lp-mermaid-pending").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __paints: number }).__paints)).toBeGreaterThan(0);
  await expect(page.locator(".cm-lp-mermaid svg")).toHaveCount(0);

  // 释放后有限 settle：SVG 替换占位
  release();
  await expect(page.locator(".cm-lp-mermaid svg").first()).toBeVisible();
  await expect(page.locator(".cm-lp-mermaid-pending")).toHaveCount(0);
});

test("图表按排版基线渲染", async ({ page }) => {
  await openDiagram(page);
  const fill = await page
    .locator(".cm-lp-mermaid svg .node rect, .cm-lp-mermaid svg .node polygon, .cm-lp-mermaid svg rect.basic")
    .first()
    .evaluate((el) => getComputedStyle(el).fill);
  expect(fill).not.toBe("rgb(0, 0, 0)");
  await expectScreenshot(page, "mermaid-theme.png");
});

test("大文档：尾部围栏块在增量解析推进后渲染（M110 真实桌面回归）", async ({ page }) => {
  // 文档大到装载（editor.reloadSession）调度时语法树必然未解析到尾部：StateField 初次算出
  // Decoration.none；修复前字段不监听解析推进（Language.setState 事务），
  // 装饰永久缺失、围栏停留源码样式——真实 WKWebView 大 vault 必现、headless
  // 小 fixture 全绿的分歧点。
  const filler = "这一段是填充文本，用来把文档撑大到真实知识库的量级，验证增量解析边界对装饰的影响。".repeat(3);
  let big = "# 大文件\n\n";
  for (let i = 0; i < 2000; i++) big += `第 ${i + 1} 节\n\n${filler}\n\n`;
  big += "```mermaid\ngraph TD\n  A[尾部] --> B[图表]\n```\n";
  await stubTauri(page, {
    entries: [{ path: "big.md", kind: "file", size: big.length, mtime_ms: 0 }],
    files: { "big.md": big },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="big.md"]').click();
  // 块级 widget 只在视口内 materialize：先滚到文档尾，再等解析推进 → 装饰
  // 重算 → 懒加载 → SVG。修复前此处永不出现 svg（也无占位）。
  await page.evaluate(() => {
    document.querySelector<HTMLElement>(".cm-scroller")!.scrollTop = Number.MAX_SAFE_INTEGER;
  });
  await expect(page.locator(".cm-lp-mermaid svg")).toBeVisible({ timeout: 20000 });
});
