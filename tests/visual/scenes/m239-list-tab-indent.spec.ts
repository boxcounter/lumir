import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M239 列表行 TAB / SHIFT+TAB 的**按键链路**（change list-tab-indent；行模型见 change
// rework-list-tab-line-model-nov27 的 D1a / D3a / D4a 与六个裁决点）。
//
// 为什么这条判据必须在这里（真机套件验不到）：
//   KimiCU 的 `press_key("tab")` 注入不落 WKWebView（M240 归因三步实测：单独复跑仍红、把 src/ 整体
//   回到实现前仍红、chromium 探针里行为正常 ⇒ 边界在注入通道，不是产品），因此真机场景 43 / 888 只验
//   「经 `[keys]` 绑到通道可达组合的同一条命令」；**Tab 这个键本身的链路**由本场景覆盖——chromium
//   的 `keyboard.press` 产的是真实 DOM KeyboardEvent（`key="Tab"`，见 README 已知边界那一节）。
//
// 本层与既有两层的分工（别重复也不要留缺口）：
//   - `tests/unit/list-indent.test.ts`：纯判定（选区展开行集 + 逐行归属 + 写回规则 + 编号不动），
//     不碰 view；它自己的文件头写明「runner（readOnly 提前返回 + 单次 dispatch）本层测不到」。
//   - 本场景：**键位层 → 命令 → 文档**（真 CM view、真键位分发、真 History 扩展），即 runner 那一半；
//     多行选区在真键位链路上走一遍（单测已覆盖判定，这里覆盖「Tab / Shift-Tab 按键 + 选区」）。
//   - `scripts/acceptance/scenarios/43-list-tab-indent.md`：真机上的命令链路与落盘（单行 / 引用 /
//     有序 / 非列表）；`888-list-line-indent`：真机上的多行选区（用户截图形态）。
//
// 判据一律落在 **CM 文档源码**（`readDocument`）：列表标记与行首空白在渲染层被 widget 吃掉，
// live preview 的 DOM 读不到它们。

const BULLET = "- alpha\n- bravo\n";
const ORDERED = "1. uno\n2. dos\n";
const NESTED = "- alpha\n  - bravo\n  - charlie\n";
const QUOTE = "> - echo\n> - foxtrot\n";
const PARAGRAPH = "这一行是普通段落。\n";
// 「不带子树」用：bravo 有上一同级项（alpha）、下面挂一个未选中的子项 child。
const WITH_CHILD = "- alpha\n- bravo\n  - child\n";
// 用户截图形态：6 行嵌套选区（第 3–8 行），第 1 / 2 / 9 行未选中。
const BLOCK = "- alpha\n  - bravo\n    - charlie\n    - delta\n  - echo\n  - foxtrot\n    - golf\n  - hotel\n- india\n";
const BLOCK_OUTDENTED =
  "- alpha\n  - bravo\n  - charlie\n  - delta\n- echo\n- foxtrot\n  - golf\n- hotel\n- india\n";

/** 打开 fixture 里的某个文件（装载 vault → 点树行）。 */
async function openFile(page: Page, files: Record<string, string>, name: string): Promise<void> {
  await stubTauri(page, {
    entries: Object.keys(files).map((path) => ({ path, kind: "file", size: files[path].length, mtime_ms: 0 })),
    files,
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${name}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(name);
}

/** 落光标（并把焦点交给编辑器 contentDOM——editor 作用域的绑定要求事件目标在它里面）。 */
async function setCursor(page: Page, pos: number): Promise<void> {
  await page.evaluate((p) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    view.dispatch({ selection: { anchor: p } });
    view.focus();
  }, pos);
}

/** 落选区（anchor / head 分开传，用于正向 / 反向两种形态）。 */
async function setSelection(page: Page, anchor: number, head: number): Promise<void> {
  await page.evaluate(([a, h]) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    view.dispatch({ selection: { anchor: a, head: h } });
    view.focus();
  }, [anchor, head] as const);
}

/** 行号（1 起）→ 字符偏移：fixture 全是单字节 ASCII，行偏移即字符偏移。 */
function lineStart(doc: string, line: number): number {
  return doc.split("\n").slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0);
}
function lineEnd(doc: string, line: number): number {
  return lineStart(doc, line) + doc.split("\n")[line - 1].length;
}

/** 浏览器视角的活动元素——D1a / D4a 的「键被本层命中并消费，焦点不跳出编辑器」这一条。 */
const activeElementClass = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.className ?? "");

/** 打开一份文档、把光标放到 `needle` 之后（文档里 `needle` 必须唯一，避免落点歧义）。 */
async function setup(page: Page, doc: string, needle: string): Promise<void> {
  await openFile(page, { "doc.md": doc }, "doc.md");
  const at = doc.indexOf(needle);
  expect(at, `fixture 里找不到 ${JSON.stringify(needle)}（判据会落空）`).toBeGreaterThanOrEqual(0);
  await setCursor(page, at + needle.length);
  await expect.poll(() => activeElementClass(page)).toContain("cm-content");
}

test("TAB：第二项缩进一层（步长 = `- ` 的内容列 2），焦点被消费、不跳出编辑器", async ({ page }) => {
  await setup(page, BULLET, "bravo");

  await page.keyboard.press("Tab");

  await expect.poll(() => readDocument(page)).toBe("- alpha\n  - bravo\n");
  // D1a 的知情代价：编辑器内 TAB 的原生焦点遍历被本绑定接管——界面上唯一可观测的后果就是
  // 焦点没走（键没落地时原生遍历会把焦点送出 contentDOM，这条因此不是恒真断言）。
  expect(await activeElementClass(page), "TAB 被消费后焦点必须仍在编辑器里").toContain("cm-content");
});

test("SHIFT+TAB：刚缩进的那一项凸排回顶层（逐字节回到原源码）", async ({ page }) => {
  await setup(page, BULLET, "bravo");
  await page.keyboard.press("Tab");
  await expect.poll(() => readDocument(page)).toBe("- alpha\n  - bravo\n");

  await page.keyboard.press("Shift+Tab");

  await expect.poll(() => readDocument(page)).toBe(BULLET);
  // 凸排后光标仍在编辑器里，且落点跟着 change mapping 平移（命令不快照、不重设选区）
  expect(await activeElementClass(page)).toContain("cm-content");
});

test("TAB：有序列表只加空白、源码编号不改写（切断 D2c，3 空格 = `1. ` 的内容列）", async ({ page }) => {
  await setup(page, ORDERED, "dos");

  await page.keyboard.press("Tab");

  // 固定 2 空格在有序列表上嵌不进去（真 lezer 实测），步长仍按上一同级项的内容列取；
  // 但行模型不再按新归属重排编号：`2. dos` 保持字面 `2.`，`1. uno` 逐字节不动。
  await expect.poll(() => readDocument(page)).toBe("1. uno\n   2. dos\n");
});

test("TAB：嵌套列表只动光标所在行（未选中的子项 / 兄弟项逐字节不变）", async ({ page }) => {
  await setup(page, NESTED, "charlie");

  await page.keyboard.press("Tab");

  await expect.poll(() => readDocument(page)).toBe("- alpha\n  - bravo\n    - charlie\n");
});

test("TAB：只缩进光标所在行，不带子树（未选中的子项留在原处）", async ({ page }) => {
  await setup(page, WITH_CHILD, "bravo");

  await page.keyboard.press("Tab");

  // 旧项 / 子树模型会连 `  - child` 一起平移；行模型只动 bravo 这一行。
  await expect.poll(() => readDocument(page)).toBe("- alpha\n  - bravo\n  - child\n");
});

test("TAB：引用内列表把空白插在最内层 `>` 之后（引用结构不动）", async ({ page }) => {
  await setup(page, QUOTE, "foxtrot");

  await page.keyboard.press("Tab");

  await expect.poll(() => readDocument(page)).toBe("> - echo\n>   - foxtrot\n");
});

test("D3a/D4a：第一项 TAB、非列表行 TAB/SHIFT+TAB 都无操作，且键被消费（焦点不跳出编辑器）", async ({ page }) => {
  // 列表第一项：没有可嵌套的父项 ⇒ 无操作（写入只会在源码里留下渲染态看不见的空白 diff）
  await setup(page, BULLET, "alpha");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await page.waitForTimeout(50);
  expect(await readDocument(page), "第一项 TAB / SHIFT+TAB 都不得改动文档").toBe(BULLET);
  expect(await activeElementClass(page)).toContain("cm-content");

  // 非列表行：不插空白、也不把键放回原生路径（D4a）
  await setup(page, PARAGRAPH, "普通段落");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(50);
  expect(await readDocument(page), "非列表行 TAB 不得改动文档").toBe(PARAGRAPH);
  expect(
    await activeElementClass(page),
    "非列表行 TAB 仍被本层消费——焦点跳出编辑器说明键落回了原生遍历",
  ).toContain("cm-content");

  await page.keyboard.press("Shift+Tab");
  await page.waitForTimeout(50);
  expect(await readDocument(page)).toBe(PARAGRAPH);
  expect(await activeElementClass(page)).toContain("cm-content");
});

test("多行选区 SHIFT+TAB：正向逐行凸排（用户截图形态），未选中的行逐字节不动", async ({ page }) => {
  await openFile(page, { "doc.md": BLOCK }, "doc.md");
  await setSelection(page, lineStart(BLOCK, 3), lineEnd(BLOCK, 8));
  await expect.poll(() => activeElementClass(page)).toContain("cm-content");

  await page.keyboard.press("Shift+Tab");

  await expect.poll(() => readDocument(page)).toBe(BLOCK_OUTDENTED);
});

test("多行选区 SHIFT+TAB：反向选区（anchor 在下、head 在上）得到同一结果", async ({ page }) => {
  await openFile(page, { "doc.md": BLOCK }, "doc.md");
  await setSelection(page, lineEnd(BLOCK, 8), lineStart(BLOCK, 3));
  await expect.poll(() => activeElementClass(page)).toContain("cm-content");

  await page.keyboard.press("Shift+Tab");

  await expect.poll(() => readDocument(page)).toBe(BLOCK_OUTDENTED);
});

test("选区尾落在行首不计入：终点那一行不动", async ({ page }) => {
  await openFile(page, { "doc.md": BLOCK }, "doc.md");
  // 第 3 行行首 → 第 6 行行首：只触及第 3–5 行
  await setSelection(page, lineStart(BLOCK, 3), lineStart(BLOCK, 6));
  await expect.poll(() => activeElementClass(page)).toContain("cm-content");

  await page.keyboard.press("Shift+Tab");

  await expect
    .poll(() => readDocument(page))
    .toBe("- alpha\n  - bravo\n  - charlie\n  - delta\n- echo\n  - foxtrot\n    - golf\n  - hotel\n- india\n");
});

test("多行选区 TAB：块内各行按各自结构步长缩进，未选中的首行不动", async ({ page }) => {
  await openFile(page, { "doc.md": BLOCK }, "doc.md");
  await setSelection(page, lineStart(BLOCK, 4), lineEnd(BLOCK, 5));
  await expect.poll(() => activeElementClass(page)).toContain("cm-content");

  await page.keyboard.press("Tab");

  // 第 4 / 5 行各加 2 空格（分别按上一同级项 charlie / bravo 的内容列）；第 1–3 行与其余行不动。
  await expect
    .poll(() => readDocument(page))
    .toBe("- alpha\n  - bravo\n    - charlie\n      - delta\n    - echo\n  - foxtrot\n    - golf\n  - hotel\n- india\n");
});

test("混合列表 / 非列表选区：只处理列表行（段落逐字节不动）", async ({ page }) => {
  const doc = "para\n- alpha\n- bravo\n";
  await openFile(page, { "doc.md": doc }, "doc.md");
  await setSelection(page, lineStart(doc, 1), lineEnd(doc, 3));
  await expect.poll(() => activeElementClass(page)).toContain("cm-content");

  await page.keyboard.press("Tab");

  await expect.poll(() => readDocument(page)).toBe("para\n- alpha\n  - bravo\n");
});

test("混合列表 / 非列表选区：head 在段落行（反向选区）也照常处理列表行", async ({ page }) => {
  // 区分度：旧 head 模型只看 `selection.main.head`，head 在段落上会整体 no-op；行模型按行集处理。
  const doc = "para\n- alpha\n- bravo\n";
  await openFile(page, { "doc.md": doc }, "doc.md");
  await setSelection(page, lineEnd(doc, 3), lineStart(doc, 1));
  await expect.poll(() => activeElementClass(page)).toContain("cm-content");

  await page.keyboard.press("Tab");

  await expect.poll(() => readDocument(page)).toBe("para\n- alpha\n  - bravo\n");
});

test("单次 dispatch：多行选区一次 ⌘Z 还原整次编辑", async ({ page }) => {
  await openFile(page, { "doc.md": BLOCK }, "doc.md");
  await setSelection(page, lineStart(BLOCK, 3), lineEnd(BLOCK, 8));
  await expect.poll(() => activeElementClass(page)).toContain("cm-content");
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => readDocument(page)).toBe(BLOCK_OUTDENTED);

  await page.keyboard.press("Meta+z");

  // 多行编辑是**一次** dispatch（所有被触及行同在一个 changeset）⇒ 一次撤销完整还原。
  await expect.poll(() => readDocument(page)).toBe(BLOCK);
});

test("反向对照：经 `[keys]` 解绑 `Tab` 后同一个键不再缩进（证明上面那些断言不是恒真）", async ({ page }) => {
  // 反向验证（不是新增覆盖）：把默认绑定摘掉，其余现场一字不动——文档必须保持原样。若上面
  // 「TAB 缩进」那几条其实没在判任何东西（例如键从未到达绑定层也照样绿），这条对照就会与它们
  // 同时成立，从而暴露假绿。解绑走 `[keys]`（`src-tauri/src/config.rs` 的 keys 表，形状校验在
  // Rust 侧；前端 applyKeyOverrides 只认 token），不动 src/ 一行。
  await stubTauri(page, {
    entries: [{ path: "doc.md", kind: "file", size: BULLET.length, mtime_ms: 0 }],
    files: { "doc.md": BULLET },
    config: { keys: { Tab: null } },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="doc.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("doc.md");
  await setCursor(page, BULLET.indexOf("bravo") + "bravo".length);
  await expect.poll(() => activeElementClass(page)).toContain("cm-content");

  await page.keyboard.press("Tab");
  await page.waitForTimeout(80);

  expect(await readDocument(page), "Tab 已解绑：文档 MUST NOT 变化").toBe(BULLET);
});

// 未覆盖（如实登记，别读成「已验」）：`src/editor.ts` 的 `applyListIndent` 里的 `state.readOnly`
// 提前返回在当前入口集合下**不可达**——editable-non-md-files（M231）之后凡能进编辑器的文件类都可
// 编辑，image / binary 类由文件树分流拦在编辑器之外（真机场景 43 曾把这条写成「非 md 会话只读」，
// 实为空过：`.js` 早已可编辑，那组断言过是因为非列表行本来就不写）。该守卫的存废按 REVIEW.md「声明了却没有消费者」条另议，不在本场景的覆盖声明里。
