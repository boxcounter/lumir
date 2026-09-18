import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  clearMermaidRenderCache,
  ensureMermaidRender,
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
