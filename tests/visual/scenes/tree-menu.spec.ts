import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { DEMO_VAULT, fireFsEvent, fsMutations, stubTauri } from "./tauri-stub";

// 文件树条目操作的视觉与 DOM 回归（M244，change file-tree-context-menu）。
//
// 为什么要有这个场景：
//   1. 菜单浮层、行内联输入框、删除确认框是**三个新增 UI 元素**（tasks §5.2）——元素级基线
//      钉住它们的形态。整页容差吞得掉一个新浮层的细节（REVIEW.md 第 3 条），所以基线按
//      元素盒给。
//   2. 这里是「右键 → 菜单 → 动作 → tab 联动」这条链路在本机唯一能稳定跑通的通道：真机
//      场景 47 走 KimiCU 注入，双击 / 右键类注入有不可达的前科（M184），本场景把判定钉在
//      DOM 上，真机那一侧只补「真实 WKWebView + 真实文件系统」的差异。
//   3. 改名回响抑制（design §3.2）的**反向验证**需要能精确控制回响什么时候到——桩可以显式
//      fireFsEvent，真机做不到这一点。
//
// 桩的边界：文件级操作由 tests/visual/scenes/tauri-stub.ts 的对应命令做「记录调用 + 让世界
// 前进」的最小模拟，**不过滤任何非法输入**（逃逸 / 忽略集 / 撞名是 Rust 侧的真实边界，归
// cargo test 与真机场景 47）。因此这里的断言都建立在「合法输入 + 后端按契约应答」之上。

const VAULT_ROOT = "/Users/alex/demo-vault";

/** 右键一个树条目行并等菜单出现（右键是上下文菜单唯一的真实入口）。 */
async function openMenu(page: Page, path: string): Promise<void> {
  await page.locator(`.ft-row[title="${path}"]`).click({ button: "right" });
  await expect(page.locator(".ft-menu")).toBeVisible();
}

/** 菜单项文案（顺序即项集顺序）。 */
async function menuLabels(page: Page): Promise<string[]> {
  return page.locator(".ft-menu .ft-menu-item").allTextContents();
}

/** 打开一个**固定**标签并让它变 dirty（未保存标记出现即证明 dirty 已生效）。 */
async function openDirty(page: Page, path: string): Promise<void> {
  await page.locator(`.ft-row[title="${path}"]`).dblclick();
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText(path.split("/").pop() as string);
  await page.locator(".cm-content").click();
  await page.keyboard.type("EDIT");
  await expect(page.locator(".tab.is-active .tab-open")).toHaveAttribute("aria-label", /（未保存）/);
}

test("文件行右键：菜单四项、无新建项，且不改上下文", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");

  await openMenu(page, "README.md");
  const menu = page.locator(".ft-menu");
  await expect(menu).toHaveAttribute("role", "menu");
  await expect(menu).toHaveAttribute("aria-label", "条目操作");
  await expect(page.locator(".ft-menu .ft-menu-item")).toHaveCount(4);
  expect(await menuLabels(page)).toEqual([
    "重命名…",
    "复制完整路径",
    "在 Finder 中显示",
    "移到废纸篓…",
  ]);
  // 破坏性项固定尾部 + 分隔线（spec）
  await expect(page.locator(".ft-menu .ft-menu-sep")).toHaveCount(1);
  await expect(page.locator(".ft-menu .ft-menu-item").last()).toHaveText("移到废纸篓…");
  // 打开即持焦点，游标落在首项
  await expect(page.locator(".ft-menu .ft-menu-item.is-active")).toHaveText("重命名…");
  // 右键不改上下文：没有打开任何文件（仍是无当前文件的覆盖层）、标签栏为空
  await expect(page.locator(".tab")).toHaveCount(0);
  await expect(page.locator(".editor-notice")).toBeVisible();

  await expectScreenshot(menu, "context-menu-file.png");

  // 键盘游标走到破坏性项：悬停/选中底色与 danger 色的组合单独钉一张
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".ft-menu .ft-menu-item.is-active")).toHaveText("移到废纸篓…");
  await expectScreenshot(menu, "context-menu-file-trash-active.png");

  // Esc 收起并把焦点还给那一行（行还在，且拿到焦点）
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.locator('.ft-row[title="README.md"]')).toBeFocused();
});

test("目录行右键：多出新建文件 / 新建子目录", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");

  await openMenu(page, "docs");
  expect(await menuLabels(page)).toEqual([
    "新建文件…",
    "新建子目录…",
    "重命名…",
    "复制完整路径",
    "在 Finder 中显示",
    "移到废纸篓…",
  ]);
  await expect(page.locator(".ft-menu .ft-menu-sep")).toHaveCount(2);
  await expectScreenshot(page.locator(".ft-menu"), "context-menu-dir.png");
  // 目录行的右键同样不改上下文：目录没有被展开/折叠（右键不是 click）
  await expect(page.locator('.ft-row[title="docs/guide.md"]')).toHaveCount(0);
});

test("内联重命名：行名换成输入框、非法名即时标红、Esc 还原", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");

  await openMenu(page, "README.md");
  await page.locator(".ft-menu .ft-menu-item", { hasText: "重命名…" }).click();
  const input = page.locator('.ft-item[data-path="README.md"] .ft-edit');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("README.md");
  await expect(input).toHaveAttribute("aria-label", "重命名 README.md");
  // 编辑期该行的打开交互被抑制：那一行已经不是 button（结构性抑制，不是一堆 if 开关）
  await expect(page.locator('.ft-item[data-path="README.md"] button.ft-row')).toHaveCount(0);
  await expectScreenshot(page.locator('.ft-item[data-path="README.md"] .ft-row'), "inline-rename.png");

  // 非法名：行内标红 + 原因，MUST NOT 提交（没有命令调用）
  await input.fill("a/b");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator('.ft-item[data-path="README.md"] .ft-edit-error')).toHaveText(
    "名称不能包含斜杠：a/b",
  );
  await expectScreenshot(page.locator('.ft-item[data-path="README.md"] .ft-row'), "inline-rename-invalid.png");
  expect(await fsMutations(page)).toEqual([]);

  // Esc 取消：行名还原、树恢复原样
  await page.keyboard.press("Escape");
  await expect(page.locator('.ft-item[data-path="README.md"] .ft-edit')).toHaveCount(0);
  await expect(page.locator('.ft-row[title="README.md"]')).toContainText("README.md");
  expect(await fsMutations(page)).toEqual([]);
});

test("内联重命名撞名：行内给原因、不调后端", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");
  await page.locator('.ft-row[title="docs"]').click(); // 展开目录，让同级条目都在场

  await openMenu(page, "docs/guide.md");
  await page.locator(".ft-menu .ft-menu-item", { hasText: "重命名…" }).click();
  const input = page.locator('.ft-item[data-path="docs/guide.md"] .ft-edit');
  await input.fill("notes.txt");
  await expect(page.locator('.ft-item[data-path="docs/guide.md"] .ft-edit-error')).toHaveText(
    "已存在同名条目：notes.txt",
  );
  await page.keyboard.press("Enter");
  expect(await fsMutations(page)).toEqual([]);
  // 仍停在编辑态（撞名不改名）
  await expect(input).toBeVisible();
});

test("改名打开中的 dirty 文件：tab 就地 remap、回响不误报（含反向验证）", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");
  await openDirty(page, "README.md");
  const before = await page.locator(".cm-content").innerText();

  await openMenu(page, "README.md");
  await page.locator(".ft-menu .ft-menu-item", { hasText: "重命名…" }).click();
  const input = page.locator('.ft-item[data-path="README.md"] .ft-edit');
  await input.fill("RENAMED.md");
  await page.keyboard.press("Enter");

  // 交给后端的是旧路径 + 新名（界面观测不到的那一半）
  expect(await fsMutations(page)).toEqual([
    { cmd: "fs_rename_entry", rel: "README.md", new_name: "RENAMED.md", to: "RENAMED.md" },
  ]);

  // tab 就地 remap：可见文本、dataset.path、未保存标记（dirty 保留）三样一起对齐
  const tab = page.locator(".tab.is-active");
  await expect(tab.locator(".tab-name")).toHaveText("RENAMED.md");
  await expect(tab).toHaveAttribute("data-path", "RENAMED.md");
  await expect(page.locator(".tab.is-active .tab-open")).toHaveAttribute(
    "aria-label",
    /RENAMED\.md（未保存）/,
  );
  // 内容与编辑态保留（改名不改字节，光标/滚动/撤销史都不动）
  expect(await page.locator(".cm-content").innerText()).toBe(before);

  // watcher 回响（改名被拆成 deleted:old + created:new）到达：会话链路必须跳过处置
  await fireFsEvent(page, [
    { kind: "deleted", path: "README.md", entry_kind: null },
    { kind: "created", path: "RENAMED.md", entry_kind: "file" },
  ]);
  await page.waitForTimeout(300);
  await expect(page.locator(".lumir-toast", { hasText: "已被外部删除" })).toHaveCount(0);
  await expect(page.locator(".lumir-toast", { hasText: "检测到外部修改" })).toHaveCount(0);
  // 树照常收敛（抑制只作用在会话链路，不影响树）
  await expect(page.locator('.ft-row[title="README.md"]')).toHaveCount(0);
  await expect(page.locator('.ft-row[title="RENAMED.md"]')).toBeVisible();

  // 反向验证（REVIEW.md 第 1 条：上面的负向断言必须有区分度）：同一个 dirty 文件被**真实**
  // 外部修改时，「检测到外部修改」提示必须照常出现。不出现就说明上面的负向断言恒真。
  await fireFsEvent(page, [{ kind: "modified", path: "RENAMED.md", entry_kind: "file" }]);
  await expect(page.locator(".lumir-toast", { hasText: "检测到外部修改" })).toBeVisible();
});

test("删除确认框：文件与目录两种正文，确认后调命令、回响收敛树", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");

  // 文件档
  await openMenu(page, "README.md");
  await page.locator(".ft-menu .ft-menu-item", { hasText: "移到废纸篓…" }).click();
  const dialog = page.locator(".ft-confirm");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.locator(".ft-confirm-title")).toHaveText("移到废纸篓？");
  await expect(page.locator(".ft-confirm-body")).toHaveText("README.md 会移到系统废纸篓。");
  // 初始焦点在「取消」：破坏性动作的默认落点必须是安全的那一个
  await expect(page.locator(".ft-confirm-cancel")).toBeFocused();
  await expectScreenshot(dialog, "trash-confirm-file.png");

  // 取消不产生任何调用
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await fsMutations(page)).toEqual([]);

  // 目录档：正文必须明示「连同其中全部内容」
  await openMenu(page, "docs");
  await page.locator(".ft-menu .ft-menu-item", { hasText: "移到废纸篓…" }).click();
  await expect(page.locator(".ft-confirm-body")).toHaveText(
    "docs 会连同其中全部内容一起移到系统废纸篓。",
  );
  await expectScreenshot(page.locator(".ft-confirm"), "trash-confirm-dir.png");

  // 确认：命令收到目录路径；删除后的表现由 watcher 的 deleted 统一收敛
  await page.locator(".ft-confirm-ok").click();
  await expect(page.locator(".ft-confirm")).toBeHidden();
  expect(await fsMutations(page)).toEqual([{ cmd: "fs_trash_entry", rel: "docs" }]);
  await fireFsEvent(page, [
    { kind: "deleted", path: "docs", entry_kind: "dir" },
    { kind: "deleted", path: "docs/guide.md", entry_kind: null },
  ]);
  await expect(page.locator('.ft-row[title="docs"]')).toHaveCount(0);
  await expect(page.locator('.ft-row[title="docs/guide.md"]')).toHaveCount(0);
});

test("删除打开中的文件：沿用既有外部删除处置（提示内容未丢失、tab 保留）", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");
  await openDirty(page, "README.md");
  const before = await page.locator(".cm-content").innerText();

  await openMenu(page, "README.md");
  await page.locator(".ft-menu .ft-menu-item", { hasText: "移到废纸篓…" }).click();
  await page.locator(".ft-confirm-ok").click();
  await fireFsEvent(page, [{ kind: "deleted", path: "README.md", entry_kind: null }]);

  // 不特判：与外部删除同一处置——sticky 提示 + tab 保留 + 内容不丢
  await expect(page.locator(".lumir-toast", { hasText: "当前文件已被外部删除；编辑器中的内容未丢失" })).toBeVisible();
  await expect(page.locator(".tab")).toHaveCount(1);
  expect(await page.locator(".cm-content").innerText()).toBe(before);
});

test("复制完整路径：写进剪贴板的是绝对路径 + 成功 toast", async ({ page }) => {
  await page.addInitScript(() => {
    const written: string[] = [];
    (window as unknown as { __clipboard: string[] }).__clipboard = written;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
  });
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");

  await page.locator('.ft-row[title="docs"]').click(); // 展开目录（嵌套条目才在 DOM 里）
  await openMenu(page, "docs/guide.md");
  await page.locator(".ft-menu .ft-menu-item", { hasText: "复制完整路径" }).click();
  await expect(page.locator(".lumir-toast", { hasText: "已复制完整路径" })).toBeVisible();
  const written = await page.evaluate(
    () => (window as unknown as { __clipboard: string[] }).__clipboard,
  );
  expect(written).toEqual([`${VAULT_ROOT}/docs/guide.md`]);
});

test("在 Finder 中显示：只调命令、不产生文件系统变更", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");
  const files = await page.evaluate(() => Object.keys((window as never as { __TAURI_STUB_FILES?: object }).__TAURI_STUB_FILES ?? {}));

  await page.locator('.ft-row[title="docs"]').click(); // 展开目录
  await openMenu(page, "docs/notes.txt");
  await page.locator(".ft-menu .ft-menu-item", { hasText: "在 Finder 中显示" }).click();
  expect(await fsMutations(page)).toEqual([{ cmd: "fs_reveal_in_finder", rel: "docs/notes.txt" }]);
  // 只读动作：没有任何 toast（成功是静默的——Finder 的窗口就是反馈）
  await expect(page.locator(".lumir-toast")).toHaveCount(0);
  void files;
});

test("目录下新建文件：内联命名、命令参数、回响收敛树并自动打开", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");

  await openMenu(page, "docs");
  await page.locator(".ft-menu .ft-menu-item", { hasText: "新建文件…" }).click();
  const input = page.locator(".ft-item.is-new .ft-edit");
  await expect(input).toHaveAttribute("placeholder", "未命名");
  await expect(input).toHaveAttribute("aria-label", "新建文件的名称");
  await input.fill("note.md");
  await page.keyboard.press("Enter");

  expect(await fsMutations(page)).toEqual([{ cmd: "fs_create_file", path: "docs/note.md" }]);
  // 临时行撤掉（真实节点等回响），新建文件已自动打开（固定标签）
  await expect(page.locator(".ft-item.is-new")).toHaveCount(0);
  await expect(page.locator(".tab-name")).toHaveText("note.md");
  await fireFsEvent(page, [{ kind: "created", path: "docs/note.md", entry_kind: "file" }]);
  await expect(page.locator('.ft-row[title="docs/note.md"]')).toBeVisible();
});

test("目录下新建子目录：命令参数与树收敛，不自动展开", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");

  await openMenu(page, "docs");
  await page.locator(".ft-menu .ft-menu-item", { hasText: "新建子目录…" }).click();
  const input = page.locator(".ft-item.is-new .ft-edit");
  await expect(input).toHaveAttribute("aria-label", "新建子目录的名称");
  await input.fill("deep");
  await page.keyboard.press("Enter");

  expect(await fsMutations(page)).toEqual([{ cmd: "fs_create_dir", path: "docs/deep" }]);
  await fireFsEvent(page, [{ kind: "created", path: "docs/deep", entry_kind: "dir" }]);
  await expect(page.locator('.ft-row[title="docs/deep"]')).toBeVisible();
  // 新建出来的目录自己不展开（折叠态是用户状态，树不主动改）
  await expect(page.locator('.ft-row[title="docs/deep/a.md"]')).toHaveCount(0);
});
