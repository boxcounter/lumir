import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { DEMO_VAULT, externalWrite, fileText, fireFsEvent, fsMutations, stubTauri } from "./tauri-stub";

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

/** 恢复目录的轻量桩：只记 `recovery_backup` / `recovery_discard` 的落点与内容（备份归属判据）。
 *  与 `save-hardening-autosave.spec.ts` 的同族桩同形，不预置任何备份。 */
async function stubRecovery(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: any) => unknown;
    w.__recoveryStore = {} as Record<string, string>;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (cmd === "recovery_backup") {
        (w.__recoveryStore as Record<string, string>)[args.path] = args.content;
        return null;
      }
      if (cmd === "recovery_discard") {
        delete (w.__recoveryStore as Record<string, string>)[args.path];
        return null;
      }
      if (cmd === "recovery_list") return Object.keys(w.__recoveryStore as Record<string, string>);
      return invoke(cmd, args);
    };
  });
}

async function recoveryStore(page: Page): Promise<Record<string, string>> {
  return page.evaluate(
    () => (window as unknown as { __recoveryStore: Record<string, string> }).__recoveryStore,
  );
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
  // **必须真的改磁盘**（`externalWrite`）：改名已把磁盘 revision 基准迁到新路径（M278 r1），
  // 只 fire 事件而磁盘内容不动的话，读数与会话基准一致 ⇒ 按设计就该被当成回声丢弃。
  await externalWrite(page, "RENAMED.md", "# External version\n");
  await fireFsEvent(page, [{ kind: "modified", path: "RENAMED.md", entry_kind: "file" }]);
  await expect(page.locator(".lumir-toast", { hasText: "检测到外部修改" })).toBeVisible();
});

test("改名 dirty 文档：备份资源随路径迁移（旧键作废、新键补一份、改名后仍可保存）", async ({ page }) => {
  // M278 r1 评审 P2-2：备份与磁盘 revision 基准都按**路径**键控，而改名换的正是那个键。
  // 不迁的话：旧路径的备份成孤儿（下次启动弹一个指向已改名文件的恢复提示），新路径落进
  // 「未登记磁盘版本」的不可保存态（⌘S 被 reportUnsaveable 挡回、一个字都写不出去）。
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await stubRecovery(page);
  await page.goto("/");

  await page.locator('.ft-row[title="README.md"]').click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("ZZQ");
  await expect(page.locator(".modeline-path")).toContainText("未保存");
  // 前提：备份确实按旧路径落盘（等它自己的 debounce 到期）。
  await expect
    .poll(async () => Object.keys(await recoveryStore(page)), { timeout: 6000 })
    .toEqual(["README.md"]);

  await openMenu(page, "README.md");
  await page.locator(".ft-menu .ft-menu-item", { hasText: "重命名…" }).click();
  await page.locator('.ft-item[data-path="README.md"] .ft-edit').fill("RENAMED.md");
  await page.keyboard.press("Enter");
  await expect(page.locator(".tab.is-active")).toHaveAttribute("data-path", "RENAMED.md");

  // 备份跟着路径走：旧键那份作废，新键立即补一份（内容含刚键入的探针）
  await expect.poll(async () => Object.keys(await recoveryStore(page))).toEqual(["RENAMED.md"]);
  expect((await recoveryStore(page))["RENAMED.md"]).toContain("ZZQ");

  // 基准随键迁移 ⇒ 改名后 ⌘S 仍是真实可达的保存（这是「不可保存态」那条缺陷的反证）
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+s");
  await expect.poll(() => fileText(page, "RENAMED.md")).toContain("ZZQ");
  await expect(page.locator(".modeline-path")).not.toContainText("未保存");
  await expect(page.locator(".lumir-toast", { hasText: "尚未可保存" })).toHaveCount(0);
  // 保存成功 ⇒ 备份清空（新键那份也随 dirty 转 clean 作废）
  await expect.poll(async () => recoveryStore(page)).toEqual({});
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

// ---------------------------------------------------------------------------
// M251：菜单作用行高亮（tower 裁决的 A 形态）
//
// Alex 2026-09-27 真机报告：「右键点击那一行但不在文件名上，它不会被选中」——他要的是
// 「菜单作用在哪一行」的**视觉反馈**。裁决：那一行获得一个**只在菜单开着时在场**的高亮
// （`MENU_TARGET_CLASS = is-menu-target`），不复用 `.is-current`（后者是「当前打开的文档」，
// 右键不改上下文，两个语义混用一个类会让「哪一行是打开的」失去信号）。
// 样式在 `src/style.css` 的树行段：底色取 `--sel`、不加 550 字重（强度低于 `.is-current`），
// 且**压过 `:hover`**——菜单在指针位置弹出，指针下的那一行本来就是 hover 态，让 hover 盖过它
// 等于没有反馈。装卸的唯一真源是 `src/tree-menu.ts` 的 `open` / `close`。
// ---------------------------------------------------------------------------

/** 把某个 CSS 变量在**当前主题下**解析成计算值（不给测试硬编码色值：token 换值时断言跟着走）。 */
async function resolveToken(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${name})`;
    probe.style.backgroundColor = `var(${name})`;
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const out = `${style.backgroundColor}|${style.color}`;
    probe.remove();
    return out;
  }, token);
}

test("M251：菜单作用行高亮只在菜单开着时在场，且离场后底色复原（同指针位置对照）", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");
  const row = page.locator('.ft-row[title="README.md"]');
  const readRow = () =>
    row.evaluate((el) => {
      const style = getComputedStyle(el);
      return { bg: style.backgroundColor, weight: style.fontWeight, color: style.color };
    });

  await openMenu(page, "README.md");
  // 作用行 = 唯一带标记的那一行（其余行不许带——「哪一行」有区分度）
  await expect(row).toHaveClass(new RegExp("is-menu-target"));
  await expect(page.locator(".ft-row.is-menu-target")).toHaveCount(1);
  // 底色就是选中档 token（不硬编码色值：与 --sel 在当前主题下的解析值逐字节相等）。
  // 用 toHaveCSS 而不是读一次：`.ft-row` 的 background 有 0.1s 过渡，读一次会读到过渡中间值。
  const sel = (await resolveToken(page, "--sel")).split("|")[0];
  await expect(row).toHaveCSS("background-color", sel);
  // 强度低于 .is-current：字重不动（is-current 会加 550）
  expect(await readRow().then((r) => r.weight)).toBe("400");

  // 反向对照：**不移动指针**、只关菜单（Esc）——底色变化因此只能归给这个 class，不能是 hover
  await page.keyboard.press("Escape");
  await expect(page.locator(".ft-menu")).toBeHidden();
  await expect(row).not.toHaveClass(new RegExp("is-menu-target"));
  await expect(row).not.toHaveCSS("background-color", sel);
  expect(await readRow().then((r) => r.weight)).toBe("400");

  // Esc 之外的第二条关闭路径（点菜单项）同样要撤高亮
  await openMenu(page, "README.md");
  await expect(row).toHaveClass(new RegExp("is-menu-target"));
  await page.locator(".ft-menu .ft-menu-item", { hasText: "复制完整路径" }).click();
  await expect(row).not.toHaveClass(new RegExp("is-menu-target"));
  // 第三条：点菜单外面（外部 mousedown 关闭）
  await openMenu(page, "README.md");
  await expect(row).toHaveClass(new RegExp("is-menu-target"));
  await page.mouse.click(600, 400);
  await expect(page.locator(".ft-menu")).toBeHidden();
  await expect(page.locator(".ft-row.is-menu-target")).toHaveCount(0);
});

test("M251：eink 档下菜单作用行同为黑底反白（可读性规则不因 hover 穿透）", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT, config: { theme: "eink" } });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "eink");

  await openMenu(page, "README.md");
  const target = page.locator('.ft-row[title="README.md"]');
  const selBg = (await resolveToken(page, "--sel")).split("|")[0];
  const selText = (await resolveToken(page, "--sel-text")).split("|")[1];
  await expect(target).toHaveCSS("background-color", selBg);
  await expect(target).toHaveCSS("color", selText);
  // 组件内次级元素也手工反白（行内没有颜色继承链：.ft-name / .ft-caret 各自写了字色）
  await expect(target.locator(".ft-name")).toHaveCSS("color", selText);
  await expect(target.locator(".ft-caret")).toHaveCSS("color", selText);
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

// ---------------------------------------------------------------------------
// M251：右键目标行 = 菜单作用行（不变量）
//
// Alex 2026-09-27 真机报告：「如果光标不在文件名或目录名上，它不会被选中（右键点击 .env.example
// 的右侧，也就是那一行但是不在文件名上）」。实测两段（见 review-request 的证据包）：
//   ① 行元素自己的盒子里（名字右侧被 `.ft-name` 的 `flex:1` 撑住的空白、以及行元素右缘之前）
//      右键本来就作用于该行——M244 之后监听挂在行元素上，命中面 = 它的盒子；
//   ② 缺的是**行元素右缘到面板右缘之间那条带**（`.filetree` 的右内边距，实测 ~9px：
//      `button.ft-row` 的盒子止于内边距之前）。用户在那一带上点右键时说的仍是「这一行」。
// 修法：命中判定提升到**容器**层（`src/tree.ts` 的 `rowLiAt`），行内/行右侧带同一判定；面板空白、
// 树头部、编辑中的行照旧不参与（后者的抑制是 M244 §2.3 的既有要求）。零视觉变化——行元素的
// 盒子、hover / 选中底色的范围一个像素都没动。
// ---------------------------------------------------------------------------

test("M251：右键落在行右侧的空白带也作用于该行（含面板右内边距）", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");

  const row = page.locator('.ft-row[title="README.md"]');
  await expect(row).toBeVisible();
  // 反向铺底：这一行此刻不是当前文档（下面断言的「作用行」因此不是「已经是当前行」的空转）
  await expect(row).toHaveAttribute("aria-current", "false");
  const box = await row.boundingBox();
  const tree = await page.locator(".filetree").boundingBox();
  if (!box || !tree) throw new Error("缺少行 / 树容器的 bbox");
  const y = box.y + box.height / 2;

  /** 在某个横向落点右键，并用「菜单动作落在哪一行」反查菜单的作用行：选「重命名…」后
   *  输入框的行内读屏名带的是该行的名字（比看菜单在屏幕上出现的位置更有区分度）。 */
  const rightClickAt = async (x: number): Promise<void> => {
    await page.mouse.click(x, y, { button: "right" });
    await expect(page.locator(".ft-menu")).toBeVisible();
    await page.locator(".ft-menu .ft-menu-item", { hasText: "重命名…" }).click();
    await expect(page.locator(".ft-edit")).toHaveAttribute("aria-label", "重命名 README.md");
    await page.keyboard.press("Escape");
    await expect(page.locator(".ft-edit")).toHaveCount(0);
  };

  // ① 行元素盒子内、名字右侧的空白区（`.ft-name` 弹性撑满的那一段）
  await rightClickAt(box.x + box.width * 0.9);
  // ② 行元素右缘之外、树容器右缘之内（面板右内边距）——M251 之前这里连菜单都不出
  await rightClickAt(tree.x + tree.width - 2);

  // 不变量之外的两条边界：面板空白与树头部不参与（解析不到行时不拦系统菜单、更不弹应用菜单）
  await page.mouse.click(tree.x + 60, tree.y + tree.height - 4, { button: "right" });
  await expect(page.locator(".ft-menu")).toBeHidden();
  await page.mouse.click(tree.x + tree.width - 2, tree.y + 4, { button: "right" });
  await expect(page.locator(".ft-menu")).toBeHidden();
  // 右键全程不改上下文（M244 的不变量，M251 不碰它）
  await expect(page.locator(".tab")).toHaveCount(0);
});
