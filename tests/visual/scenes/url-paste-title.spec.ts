import { expect, test, type Page } from "@playwright/test";
import {
  externalWrite,
  fireFsEvent,
  invokes,
  stubTauri,
  urlTitleRequests,
  type VaultFixture,
} from "./tauri-stub";
import { readDocument } from "./parity-checks";

// 粘贴 URL 自动取标题（change add-url-paste-title-nov21）。
//
// 合成剪贴板一律 `DataTransfer` + `ClipboardEvent`（不读系统剪贴板）；取标题的
// `fetch_url_title` 走桩的 URL → 标题表，失败 / 延迟由 fixture 注入。判据覆盖：
//   - 成功：URL 先落地，随后原地换成 `[标题](URL)`；只请求一次、不重复插入；
//   - 无标题 / 网络错误：文档逐字节保留原始 URL；
//   - 等待期间在区间内键入：放弃改写；在区间外键入：映射后仍升级，不覆盖用户输入；
//   - 成功替换：不挪动用户在别处的选区；两次 undo 精确回到 URL / 粘贴前，最终 dirty=false；
//   - 失败：只撤账，不多一次 undo；
//   - 切走再切回、关闭标签、整篇重载：响应不改写其他文档 / 已取消的会话；
//   - 多次并发粘贴：各自只替换一次；
//   - 有选区：保留 CM 既有 `pasteURLAsLink` 语义（`[选中文本](URL)`），本能力不抢；
//   - 非 URL 文本 / 已有 Markdown：默认粘贴逐字节不变，不产生取标题请求。
//
// 本场景不新增像素基线：只读 EditorState 文档、请求记录与既有 DOM。

const START = "# 粘贴 URL\n\n";
const URL = "https://example.invalid/article";
const TITLE = "示例 标题";
const URL2 = "https://example.invalid/second";
const TITLE2 = "第二篇";
const OTHER = "# 另一个文档\n\n另一份内容。\n";

async function openMany(
  page: Page,
  files: Record<string, string>,
  extra: Partial<VaultFixture> = {},
): Promise<void> {
  await stubTauri(page, {
    entries: Object.entries(files).map(([path, content]) => ({
      path,
      kind: "file",
      size: content.length,
      mtime_ms: 0,
    })),
    files,
    ...extra,
  });
  await page.goto("/");
  await page.locator('.ft-row[title="paste.md"]').click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

async function open(page: Page, extra: Partial<VaultFixture> = {}): Promise<void> {
  await openMany(page, { "paste.md": START }, extra);
}

/** 通过标签栏切换（`.tab-open` 是标签的激活钮）。 */
async function switchTab(page: Page, name: string): Promise<void> {
  await page.locator(".tab-open", { hasText: name }).click();
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText(name);
}

/** 合成一次 text/plain 粘贴。 */
async function pasteText(page: Page, text: string): Promise<void> {
  await page.locator(".cm-content").evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

/** 把 CM 选区设到某个偏移并聚焦。 */
async function setCursor(page: Page, pos: number): Promise<void> {
  await page.locator(".cm-content").evaluate((el, p) => {
    const tile = (el as unknown as { cmTile?: { root: { view: { dispatch: (t: unknown) => void; focus: () => void } } } }).cmTile;
    if (!tile) throw new Error("CodeMirror view unavailable");
    tile.root.view.dispatch({ selection: { anchor: p } });
    tile.root.view.focus();
  }, pos);
}

/** 当前空光标位（选区在替换后是否被映射到别处，读这个值）。 */
async function caret(page: Page): Promise<number> {
  return page.locator(".cm-content").evaluate((el) => {
    const tile = (el as unknown as { cmTile?: { root: { view: { state: { selection: { main: { head: number } } } } } } }).cmTile;
    if (!tile) throw new Error("CodeMirror view unavailable");
    return tile.root.view.state.selection.main.head;
  });
}

/** 当前标签的 dirty 点（`.tab-dirty` 只在 dirty 时可见，见 tabs.ts）。 */
function dirtyDot(page: Page) {
  return page.locator(".tab.is-active .tab-dirty");
}

/** 全选正文（经 CM view，不依赖键盘通道的键位映射）。 */
async function selectAll(page: Page): Promise<void> {
  await page.locator(".cm-content").evaluate((el) => {
    const tile = (el as unknown as { cmTile?: { root: { view: { dispatch: (t: unknown) => void; focus: () => void; state: { doc: { length: number } } } } } }).cmTile;
    if (!tile) throw new Error("CodeMirror view unavailable");
    tile.root.view.dispatch({ selection: { anchor: 0, head: tile.root.view.state.doc.length } });
    tile.root.view.focus();
  });
}

test("成功：URL 先落地，标题返回后原地换成 [标题](URL)，只请求一次", async ({ page }) => {
  await open(page, { urlTitles: { [URL]: TITLE }, urlTitleDelayMs: 500 });
  await setCursor(page, START.length);
  await pasteText(page, URL);

  // 异步返回前文档里已经有 URL（不吞文本 / 不延迟插入）。
  expect(await readDocument(page)).toBe(`${START}${URL}`);

  await expect.poll(async () => readDocument(page)).toBe(`${START}[${TITLE}](${URL})`);
  expect(await urlTitleRequests(page)).toEqual([URL]);
  const doc = await readDocument(page);
  expect(doc.split(URL).length - 1, "URL 只出现一次（目标位），没有重复插入").toBe(1);
  expect(doc.split("[").length - 1, "只生成一条链接").toBe(1);
});

test("失败：无可用标题 / 网络错误都保留原始 URL，不产生半截 Markdown", async ({ page }) => {
  // 无标题：请求成功但桩返回 null。
  await open(page, { urlTitles: {} });
  await setCursor(page, START.length);
  await pasteText(page, URL);
  await expect.poll(async () => (await urlTitleRequests(page)).length).toBe(1);
  await page.waitForTimeout(80);
  expect(await readDocument(page)).toBe(`${START}${URL}`);

  // 网络错误：invoke 直接 reject。编辑器必须吞掉异常并保留 URL（不弹未处理拒绝）。
  await open(page, {
    failures: { fetch_url_title: { code: "url_title_failed", message: "请求网页失败" } },
  });
  await setCursor(page, START.length);
  await pasteText(page, URL);
  // `failures` 在 invoke 层拦截，handler 不执行（所以请求记录为 0）；用调用名核对
  // 「确实尝试过取标题」，再判失败路径没有改写文档。
  await expect.poll(async () => (await invokes(page)).includes("fetch_url_title")).toBe(true);
  await page.waitForTimeout(80);
  expect(await readDocument(page)).toBe(`${START}${URL}`);
  expect(await readDocument(page)).not.toContain("[");
});

test("成功替换保留选区；两次 undo 精确回 URL / 粘贴前，最终 dirty=false", async ({ page }) => {
  await open(page, { urlTitles: { [URL]: TITLE }, urlTitleDelayMs: 500 });
  await setCursor(page, START.length);
  await pasteText(page, URL);

  // 应答还在路上：把光标移到标题行（URL 区间之外）。替换只动 URL 区间，光标必须原地不动。
  await setCursor(page, 2);
  await expect.poll(async () => readDocument(page)).toBe(`${START}[${TITLE}](${URL})`);
  expect(await caret(page), "替换不得把用户光标挪到链接末尾").toBe(2);

  // 两次事务都带 isolateHistory：第一次只撤标题升级，第二次撤原粘贴。
  await page.keyboard.press("Meta+z");
  expect(await readDocument(page), "第一次 undo 只回 URL").toBe(`${START}${URL}`);
  await page.keyboard.press("Meta+z");
  expect(await readDocument(page), "第二次 undo 回粘贴前").toBe(START);
  await expect(dirtyDot(page), "回到 cleanDoc 后 dirty 必须归零").toBeHidden();
});

test("失败只撤账：一次 undo 回粘贴前，不多一次历史", async ({ page }) => {
  await open(page, { urlTitles: {} });
  await setCursor(page, START.length);
  await pasteText(page, URL);
  await expect.poll(async () => (await urlTitleRequests(page)).length).toBe(1);
  await page.waitForTimeout(80);
  expect(await readDocument(page)).toBe(`${START}${URL}`);

  await page.keyboard.press("Meta+z");
  expect(await readDocument(page), "失败路径不产生额外 undo 事件").toBe(START);
  await expect(dirtyDot(page)).toBeHidden();
});

test("等待期在区间外键入：区间随事务映射，仍升级且不覆盖输入", async ({ page }) => {
  await open(page, { urlTitles: { [URL]: TITLE }, urlTitleDelayMs: 800 });
  await setCursor(page, START.length);
  await pasteText(page, URL);

  // 光标在 URL 之后键入（区间外）。pending 的 `to` 用 assoc -1，不会把新字符吞进 URL。
  await page.keyboard.type("Z");
  await expect.poll(async () => readDocument(page)).toBe(`${START}[${TITLE}](${URL})Z`);
  expect(await readDocument(page), "用户键入的字符必须留在链接之后").toContain(`${URL})Z`);
});

test("多次并发粘贴：各自只替换一次", async ({ page }) => {
  await open(page, {
    urlTitles: { [URL]: TITLE, [URL2]: TITLE2 },
    urlTitleDelayMs: 600,
  });
  await setCursor(page, START.length);
  await pasteText(page, URL);
  await pasteText(page, URL2);

  await expect.poll(async () => readDocument(page)).toBe(
    `${START}[${TITLE}](${URL})[${TITLE2}](${URL2})`,
  );
  const doc = await readDocument(page);
  expect(doc.split(URL).length - 1, "第一条 URL 只出现一次").toBe(1);
  expect(doc.split(URL2).length - 1, "第二条 URL 只出现一次").toBe(1);
  expect(doc.split("[").length - 1, "两条链接各生成一次").toBe(2);
});

test("切走即取消：A 粘贴→切 B→切回 A，响应不升级", async ({ page }) => {
  await openMany(
    page,
    { "paste.md": START, "other.md": OTHER },
    { urlTitles: { [URL]: TITLE }, urlTitleDelayMs: 800 },
  );
  await setCursor(page, START.length);
  await pasteText(page, URL);

  await page.locator('.ft-row[title="other.md"]').click();
  await expect(page.locator(".tab")).toHaveCount(2);
  await switchTab(page, "paste.md");
  await page.waitForTimeout(1000);

  expect(await readDocument(page), "切走即取消：切回后也不得升级").toBe(`${START}${URL}`);
  await switchTab(page, "other.md");
  expect(await readDocument(page), "另一个文档不做任何改写").toBe(OTHER);
});

test("响应在 inactive 到达：撤账后切回不升级", async ({ page }) => {
  await openMany(
    page,
    { "paste.md": START, "other.md": OTHER },
    { urlTitles: { [URL]: TITLE }, urlTitleDelayMs: 300 },
  );
  await setCursor(page, START.length);
  await pasteText(page, URL);

  await page.locator('.ft-row[title="other.md"]').click();
  await expect(page.locator(".tab")).toHaveCount(2);
  // 让响应在 B 前台时到达（inactive 分支必须只撤 A 的 pending，不碰 B 的 view）。
  await page.waitForTimeout(600);
  expect(await readDocument(page), "B 文档在响应期间不得被改写").toBe(OTHER);

  await switchTab(page, "paste.md");
  expect(await readDocument(page), "inactive 响应到达后，切回 A 也不得升级").toBe(`${START}${URL}`);
});

test("关闭标签：等待中的响应不写回其他文档", async ({ page }) => {
  await openMany(
    page,
    { "paste.md": START, "other.md": OTHER },
    { urlTitles: { [URL]: TITLE }, urlTitleDelayMs: 800 },
  );
  await page.locator('.ft-row[title="other.md"]').click();
  await expect(page.locator(".tab")).toHaveCount(2);
  await switchTab(page, "paste.md");
  await setCursor(page, START.length);
  await pasteText(page, URL);
  await page.keyboard.press("Meta+s");
  await expect(dirtyDot(page)).toBeHidden();

  await page.locator(".tab", { hasText: "paste.md" }).locator(".tab-close").click();
  await expect(page.locator(".tab")).toHaveCount(1);
  await page.waitForTimeout(1000);
  expect(await readDocument(page), "关闭后的响应不得写进邻居文档").toBe(OTHER);
});

test("整篇重载：等待中的响应不写回已替换的正文", async ({ page }) => {
  await open(page, { urlTitles: { [URL]: TITLE }, urlTitleDelayMs: 1200 });
  await setCursor(page, START.length);
  await pasteText(page, URL);
  await page.keyboard.press("Meta+s");
  await expect(dirtyDot(page)).toBeHidden();

  const reloaded = "# 重载后\n\n新的正文。\n";
  await externalWrite(page, "paste.md", reloaded);
  await fireFsEvent(page, [{ kind: "modified", path: "paste.md", entry_kind: "file" }]);
  await expect.poll(async () => readDocument(page)).toBe(reloaded);

  await page.waitForTimeout(1400);
  expect(await readDocument(page), "重载后响应不得改写新正文").toBe(reloaded);
});

test("等待期间在区间内编辑：放弃改写，不覆盖用户输入", async ({ page }) => {
  await open(page, { urlTitles: { [URL]: TITLE }, urlTitleDelayMs: 1500 });
  await setCursor(page, START.length);
  await pasteText(page, URL);

  // 应答还在路上：把光标放进 URL 中间键入一个字符（区间切片随即对不上）。
  await setCursor(page, START.length + 4);
  await page.keyboard.type("Z");
  await expect.poll(async () => readDocument(page)).toContain("httpZs://");
  await page.waitForTimeout(1800);

  const doc = await readDocument(page);
  expect(doc).toContain("httpZs://");
  expect(doc).not.toContain("[");
  expect(await urlTitleRequests(page)).toEqual([URL]);
});

test("有选区：不进入取标题通道（正文按既有粘贴路径处理）", async ({ page }) => {
  await open(page, { urlTitles: { [URL]: TITLE } });
  await setCursor(page, START.length);
  await pasteText(page, "选中文本");
  await selectAll(page);
  await pasteText(page, URL);

  // 本能力只接管空选区的 URL 粘贴；有选区时无论 CM 走 pasteURLAsLink 还是默认替换，
  // 都不得冒出一条取标题请求，也不得生成 `[标题](URL)`。
  expect(await urlTitleRequests(page), "有选区的粘贴不进入取标题通道").toEqual([]);
  const doc = await readDocument(page);
  expect(doc).not.toContain(`[${TITLE}]`);
  expect(doc).toContain(URL);
});

test("非 URL 文本 / 已有 Markdown：默认粘贴逐字节不变，不请求标题", async ({ page }) => {
  await open(page, { urlTitles: { [URL]: TITLE } });
  await setCursor(page, START.length);

  await pasteText(page, "普通文本粘贴");
  expect(await readDocument(page)).toBe(`${START}普通文本粘贴`);

  const markdown = `[已有](${URL})`;
  await pasteText(page, markdown);
  expect(await readDocument(page)).toBe(`${START}普通文本粘贴${markdown}`);
  expect(await urlTitleRequests(page)).toEqual([]);
});
