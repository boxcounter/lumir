import { expect, test, type Page } from "@playwright/test";
import { readDocument } from "./parity-checks";
import {
  externalWrite,
  fileText,
  fireFsEvent,
  fireMenuCommand,
  stubTauri,
  type VaultFixture,
} from "./tauri-stub";

// M149 多标签。为什么要有这个场景（判据都是实测结论，不是设想）：
//
//   1. **整页基线抓不到标签栏**：标签栏只有约 30px 高、被横向撑满，而整页容差
//      `maxDiffPixelRatio: 0.001`（1200×800 ≈ 960 px）能把它整个吞掉——M147/M148 两次
//      实测（REVIEW.md 第 3 条）。所以标签栏的视觉回归**只有元素级基线能守**。
//   2. **验收套件（scripts/acceptance）表达不了这些通道**：它的 `click` 动作没有修饰键、
//      `target.count` 被 cu.mjs 丢掉（双击不可表达）、也点不到 macOS 原生菜单栏。因此
//      「⌘-点击 / 双击的打开意图」「菜单关闭项 → tab.close」「撤销史与滚动的逐标签保留」
//      三条在本场景覆盖，14-tabs 覆盖真机上的键盘与浮条链路。
//
// 本场景不验证的：真机 WKWebView 的行为（归 14-tabs）、⌘W 被原生菜单让出的那一步
//（归 src-tauri/src/lib.rs 的单测 + 真机菜单目视）。

const ALPHA = "# Alpha 标题\n\nAlpha 的第一段。\n";
const BETA = "# Beta 标题\n\nBeta 的第一段。\n";

/** 长文：用来验证「滚动位置逐标签保留」——必须长到能滚出多屏。 */
const LONG = ["# 顶部 TOP-MARK", "", ...Array.from({ length: 80 }, (_, i) => `填充 ${i + 1} 行。`)].join("\n") + "\n";

const VAULT: VaultFixture = {
  entries: [
    { path: "alpha.md", kind: "file", size: ALPHA.length, mtime_ms: 0 },
    { path: "beta.md", kind: "file", size: BETA.length, mtime_ms: 0 },
  ],
  files: { "alpha.md": ALPHA, "beta.md": BETA },
  links: {},
};

const LONG_VAULT: VaultFixture = {
  entries: [
    { path: "long.md", kind: "file", size: LONG.length, mtime_ms: 0 },
    { path: "beta.md", kind: "file", size: BETA.length, mtime_ms: 0 },
  ],
  files: { "long.md": LONG, "beta.md": BETA },
  links: {},
};

/** .cm-scroller 就是 CM 的 scrollDOM；滚动位置**不在** EditorState 里，所以它是否被
 *  逐标签存取只能从 DOM 读——这是本场景能给出 acceptance 给不出的判据的原因。 */
function scrollTop(page: Page): Promise<number> {
  return page.locator(".cm-scroller").evaluate((el) => el.scrollTop);
}

/** 视口顶部那一行的文本——滚动位置的**语义**判据。
 *
 *  为什么不比 scrollTop 数值：恢复走的是 CM 的 `scrollTarget`，它由 CM 自己的测量周期
 *  落地，会对齐到行边界；两侧行高/内边距的任何一点差异都会让像素值差出几十像素，
 *  而那并不表示「没恢复到原来的位置」。真正要证的是「视口回到了文档里的同一处」。
 *  返回空串表示取不到位置（那是读失败，不是「位置为空」，调用方必须自己判 FAIL）。 */
function topVisibleLine(page: Page): Promise<string> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } })
      .cmTile.root.view;
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    const rect = scroller.getBoundingClientRect();
    const pos = view.posAtCoords({ x: rect.left + 60, y: rect.top + 2 });
    return pos === null ? "" : view.state.doc.lineAt(pos).text;
  });
}

test("标签栏：空态隐藏、单标签常驻、预览斜体、dirty 点（元素级基线）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");

  const strip = page.locator(".tabstrip");
  // 空态：整条隐藏（且不占行高）——空态整页基线因此不需要更新。
  await expect(strip).toBeHidden();

  await page.locator('.ft-row[title="alpha.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("Alpha 的第一段");
  // 单标签也常驻显示：它承载 dirty 点与位置上下文（tower 裁决）。
  await expect(strip).toBeVisible();
  await expect(page.locator(".tab")).toHaveCount(1);
  await expect(page.locator(".tab-name")).toHaveText("alpha.md");
  // 单击树文件 = 预览标签：标题斜体（临时态的唯一视觉线索）。
  await expect(page.locator(".tab").first()).toHaveClass(/is-preview/);
  await expect(page.locator(".tab").first()).toHaveClass(/is-active/);
  await expect(page.locator(".tab-dirty")).toBeHidden();

  await expect(strip).toHaveScreenshot("tab-bar-preview.png");

  // 「首次输入即固定」：内容第一次变化就清掉预览标记，并亮起 dirty 点。
  await page.locator(".cm-content").click();
  await page.keyboard.type("X");
  await expect(page.locator(".cm-content")).toContainText("X");
  await expect(page.locator(".tab").first()).not.toHaveClass(/is-preview/);
  await expect(page.locator(".tab-dirty")).toBeVisible();
  // 读屏名带上该标签自己的未保存状态（文案 D90）。
  await expect(page.locator(".tab-open")).toHaveAttribute("aria-label", /alpha\.md（未保存）/);

  await expect(strip).toHaveScreenshot("tab-bar-dirty.png");
});

test("打开意图：单击复用预览标签、⌘-点击新开固定标签、双击固定住已有预览标签", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");

  await page.locator('.ft-row[title="alpha.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("Alpha 的第一段");

  // 单击第二次：复用预览标签（alpha 被就地替换成 beta，标签总数不变、位置不变）。
  await page.locator('.ft-row[title="beta.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("Beta 的第一段");
  await expect(page.locator(".tab")).toHaveCount(1);
  await expect(page.locator(".tab-name")).toHaveText("beta.md");

  // ⌘-点击 = 新开固定标签。
  await page.locator('.ft-row[title="alpha.md"]').click({ modifiers: ["Meta"] });
  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("alpha.md");
  await expect(page.locator(".tab.is-active")).not.toHaveClass(/is-preview/);

  // 双击一个已打开的预览标签 = 固定住它（第一次单击把它开成预览，第二次单击走
  // 「已打开 → 切过去」并因 pinned 意图清掉预览标记）。
  await page.locator('.ft-row[title="beta.md"]').dblclick();
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("beta.md");
  await expect(page.locator(".tab.is-active")).not.toHaveClass(/is-preview/);
  await expect(page.locator(".tab")).toHaveCount(2);

  // 固定之后，单击树文件不再顶掉它：alpha 已开过 → 切过去；新文件才另开。
  await page.locator('.ft-row[title="alpha.md"]').click();
  await expect(page.locator(".tab")).toHaveCount(2);

  // 元素级基线：两个固定标签并存 + 激活态（预览斜体在上面那条基线里）。
  await expect(page.locator(".tabstrip")).toHaveScreenshot("tab-bar-two-pinned.png");
});

test("切标签保留滚动位置与撤销史（逐标签，不重新解析、不清栈）", async ({ page }) => {
  await stubTauri(page, LONG_VAULT);
  await page.goto("/");
  const content = page.locator(".cm-content");
  await page.locator('.ft-row[title="long.md"]').click();
  await expect(content).toContainText("TOP-MARK");

  // 键入一个只可能来自本次输入的记号（undo 判据用它，避免子串撞车）。
  await content.click();
  await page.keyboard.type("QMQ");
  // 文档级断言一律读 CM 的 state.doc（`readDocument`），不读渲染出的可见行——后者只含
  // 视口内的行，用它判「文档里有没有某个串」会随滚动位置漂。
  await expect.poll(() => readDocument(page)).toContain("QMQ");

  // 用 ⌃V 翻两屏把视口推到中段。**不直接写 `el.scrollTop`**：文档刚改过、CM 的测量与
  // 滚动锚点维护还没结束，直接赋值会被它拉回光标附近（实测 `before` 被拉回 ~50，于是
  // 「after - before」凭空多出 1430 的假差异）。⌃V 是 editor.scroll-page-down，走的
  // 是用户真会用的那条路径（acceptance 场景 14-tabs 同款）。
  await page.keyboard.press("Control+v");
  await page.keyboard.press("Control+v");
  const before = await scrollTop(page);
  const beforeTop = await topVisibleLine(page);
  expect(before).toBeGreaterThan(0);
  expect(beforeTop).not.toBe(""); // 取不到位置是读失败，不许当成「位置为空」混过去
  expect(beforeTop).not.toBe("# 顶部 TOP-MARK"); // 确实滚离了篇首

  // 切到另一个标签再切回来。
  await page.locator('.ft-row[title="beta.md"]').click();
  await expect(content).toContainText("Beta 的第一段");
  await page.locator(".tab-open", { hasText: "long.md" }).click();
  await expect.poll(() => readDocument(page)).toContain("QMQ");

  // 滚动位置**逐标签**恢复。判据是**视口顶行与离开时同一行**（见 topVisibleLine 的注释：
  // 比 scrollTop 数值可靠，也不依赖「渲染出的行是不是只有视口内那些」——本应用的
  // scroller 是 grid 布局，CM 的视口范围比可见区大得多，`textContent` 里能查到很远的行，
  // 因此「正文里有没有某个串」根本不是滚动位置的判据）。
  //
  // 只断言语义，**不断言像素值**：恢复走 CM 的 scrollTarget、由它自己的测量周期落地，
  // 而 `.cm-scroller` 的 scrollTop 在本应用里不足以当判据——实测同一行仍置顶时该值可以
  // 读到 0（CM 的视口状态与 DOM 的滚动位置在测量周期里会短暂不一致，这个 scroller 还是
  // `display:grid` 的布局）。复位到篇首这个真实回归由两条一起挡住：顶行不再是原来那行、
  // 且切回来之后顶行仍是中段。
  // 反向验证：把 editor.ts 的 activate() 里那一句 scroll 恢复注释掉重跑，本用例即在
  // 「顶行是同一行」这条上变红（Expected "填充 44 行。" / Received "# 顶部 TOP-MARK"，
  // 实测过，不是设想）。
  const afterTop = await topVisibleLine(page);
  expect(afterTop).not.toBe("");
  expect(afterTop).toBe(beforeTop);

  // 撤销史**逐标签**保留：⌘Z 撤回的是切走之前那次输入（不是无事发生、也不是撤到别篇）。
  await content.click();
  await page.keyboard.press("Meta+z");
  await expect.poll(() => readDocument(page)).not.toContain("QMQ");
});

test("菜单关闭项 → tab.close（原生菜单与键盘走同一条命令）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");

  await page.locator('.ft-row[title="alpha.md"]').click();
  await page.locator('.ft-row[title="beta.md"]').click({ modifiers: ["Meta"] });
  await expect(page.locator(".tab")).toHaveCount(2);

  // lib.rs 把 File / Window 两个预置 Close 换成不带加速键的自定义项，点击经
  // app:menu_command 发载荷 "close"（平台术语，不是前端命令 id）。
  await fireMenuCommand(page, "close");
  await expect(page.locator(".tab")).toHaveCount(1);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("alpha.md");
});

test("⌘W 关当前标签：干净标签直接关，dirty 标签先给三个出口", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  const content = page.locator(".cm-content");

  await page.locator('.ft-row[title="alpha.md"]').click();
  await page.locator('.ft-row[title="beta.md"]').click({ modifiers: ["Meta"] });
  await expect(page.locator(".tab")).toHaveCount(2);

  // 干净的当前标签：⌘W 直接关掉，激活权交给右邻（没有右邻则左邻）。
  await content.click();
  await page.keyboard.press("Meta+w");
  await expect(page.locator(".tab")).toHaveCount(1);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("alpha.md");

  // dirty 的当前标签：⌘W 先给确认，不直接关（文案 D92 / D93）。
  await page.keyboard.type("Y");
  await expect(page.locator(".tab-dirty")).toBeVisible();
  await page.keyboard.press("Meta+w");
  const confirm = page.locator(".lumir-toast", { hasText: "关闭后修改将丢失" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button", { name: "保存并关闭" })).toBeVisible();
  await expect(confirm.getByRole("button", { name: "放弃修改并关闭" })).toBeVisible();
  // 还没选：标签仍在。
  await expect(page.locator(".tab")).toHaveCount(1);

  await confirm.getByRole("button", { name: "放弃修改并关闭" }).click();
  await expect(page.locator(".tab")).toHaveCount(0);
  await expect(page.locator(".tabstrip")).toBeHidden();
  await expect(page.locator(".masthead-file")).toHaveText("无当前文件");
});

// ---------------------------------------------------------------------------
// 逐标签的保存粒度（reviewer r1 P2-3：这三条是 per-tab 粒度升级的核心行为合同，
// 此前只有真机场景的间接覆盖、或根本没有回归防线——重引入共享状态不会有任何测试变红）
// ---------------------------------------------------------------------------
test("⌘S 只存前台标签：另一个标签的未保存内容不落盘", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  const content = page.locator(".cm-content");

  // 标签一：改脏 alpha，随后用一次外部写入把它钉在「自动保存已暂停」态——否则 2s 后
  // 自动保存会把 alpha 也落盘，这条用例就分不出「⌘S 只存前台」了。
  await page.locator('.ft-row[title="alpha.md"]').click();
  await content.click();
  await page.keyboard.type("AAA");
  await externalWrite(page, "alpha.md", ALPHA);
  await fireFsEvent(page, [{ kind: "modified", path: "alpha.md", entry_kind: "file" }]);
  await expect(page.locator(".lumir-toast", { hasText: "检测到外部修改" })).toBeVisible();

  // 标签二：新开 beta、改脏，让它当前台。
  await page.locator('.ft-row[title="beta.md"]').click({ modifiers: ["Meta"] });
  await content.click();
  await page.keyboard.type("BBB");
  await expect(page.locator(".tab")).toHaveCount(2);

  await page.keyboard.press("Meta+s");
  await expect(page.locator(".lumir-toast", { hasText: "已保存" })).toBeVisible();

  // 前台标签落盘；另一个标签的未保存内容仍在内存里、没有被写进任何文件。
  await expect.poll(() => fileText(page, "beta.md")).toContain("BBB");
  expect(await fileText(page, "alpha.md")).not.toContain("AAA");
  await expect(page.locator(".tab", { hasText: "alpha.md" }).locator(".tab-dirty")).toBeVisible();
});

test("自动保存的 debounce 逐标签独立：切标签不把待写内容带到新文档", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");

  await page.locator('.ft-row[title="alpha.md"]').click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("AAA");
  // 立刻另开 beta 并切过去：alpha 的 debounce 还在跑，而前台已经不是它了。
  await page.locator('.ft-row[title="beta.md"]').click({ modifiers: ["Meta"] });
  await expect(page.locator(".cm-content")).toContainText("Beta 的第一段");

  // debounce 到期后写的是 alpha——它自己的路径与内容。若定时器是共享的、到点再去读
  // 「当前前台是谁」，写的就会是 beta，而 alpha 永远等不到落盘（这正是代码注释里
  // 「把 A 的内容写进 B 的路径」那类静默数据损坏的回归点）。
  await expect.poll(() => fileText(page, "alpha.md"), { timeout: 6000 }).toContain("AAA");
  expect(await fileText(page, "beta.md")).not.toContain("AAA");
  // beta 也没被别人的写入算到自己头上：它仍是干净的。
  await expect(page.locator(".tab", { hasText: "beta.md" }).locator(".tab-dirty")).toBeHidden();
});

test("后台标签的外部修改也自动重载，且不抢前台", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  const content = page.locator(".cm-content");

  await page.locator('.ft-row[title="alpha.md"]').click();
  await page.locator('.ft-row[title="beta.md"]').click({ modifiers: ["Meta"] });
  await expect(content).toContainText("Beta 的第一段");
  await expect(page.locator(".tab")).toHaveCount(2);

  // 外部改写**后台**标签的文件。
  await externalWrite(page, "alpha.md", "# Alpha 标题\n\n外部改写过的正文。\n");
  await fireFsEvent(page, [{ kind: "modified", path: "alpha.md", entry_kind: "file" }]);

  // 浮条点名 alpha；前台的 beta 不被抢（后台分支只换代它的 state，不碰 view）。
  await expect(page.locator(".lumir-toast", { hasText: "alpha.md" })).toBeVisible();
  await expect(content).toContainText("Beta 的第一段");

  // 切回 alpha：看到的是磁盘上的新内容——后台分支确实重载了它。
  await page.locator(".tab-open", { hasText: "alpha.md" }).click();
  await expect(content).toContainText("外部改写过的正文");
});

test("零标签时 ⌘W 无操作：未命名文档不是标签（reviewer r1 P2-1）", async ({ page }) => {
  // vault 未装载：编辑器里是启动时的 SAMPLE 演示文档，没有任何标签（标签栏隐藏）。
  await stubTauri(page, null);
  await page.goto("/");
  await expect(page.locator(".tabstrip")).toBeHidden();
  const before = await readDocument(page);
  expect(before.length).toBeGreaterThan(0);

  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+w");

  // 无操作：文档逐字节不变（P2-1 修之前它会被静默换成一份空文档）、没有确认浮条。
  expect(await readDocument(page)).toBe(before);
  await expect(page.locator(".tabstrip")).toBeHidden();
  await expect(page.locator(".lumir-toast")).toHaveCount(0);

  // dirty 的未命名文档同样无操作：P2-1 修之前会弹出主体为空的确认浮条（`「」有未保存…`）。
  await page.locator(".cm-content").click();
  await page.keyboard.type("Z");
  await page.keyboard.press("Meta+w");
  expect(await readDocument(page)).toContain("Z");
  await expect(page.locator(".lumir-toast", { hasText: "关闭后修改将丢失" })).toHaveCount(0);
  await expect(page.locator(".tabstrip")).toBeHidden();
});
