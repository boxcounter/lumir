import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { test as baseTest } from "@playwright/test";
import { documentWrites, fireFsEvent, fsMutations, guardPageChannel, stubTauri } from "./tauri-stub";
import type { VaultFixture } from "./tauri-stub";

// 首启与空 vault 两态（change add-first-run-onboarding-nov25；M851 的旧口径保留在非首启）：
//   1. **真正首次启动**（启动快照 last_vault === null）：启动态进入首启模式——只有唯一
//      「添加 vault」主操作，整窗居中，无骨架 / 产品标记 / 阶段行 / 树空态；#app inert，
//      命令闸门阻断设置 / harness / 键位面板（含原生菜单来源）。
//   2. **首启空工作区**（首个 vault 无标签）：content pane 出 tips + 默认 harness；统一空工作区
//      的标题与两个动作让位；打开首个文档后 tips 消失，编辑器恢复可编辑。
//   3. **非首启空 vault**（老用户）：统一空工作区（「没有打开的文档」+ Open note… / New note）；
//      新建默认 .md、显式扩展名保留。判据取后端收到的实际创建路径，不是输入框里的文本。
//
// 判据落点一律是「用户可见文本 / 后端调用参数」：前者在 DOM 上直接读，后者读桩的
// `__fsMutations` / `__documentWrites` 记录。没有新增像素基线（「保持视觉合同」= 既有整页
// 基线不因本场景新增或重录；首屏本体的基线变化由独立的人肉裁决承担，见 mission M851）。
//
// 页面场景统一经通道守卫跑（M793，tests/visual/README.md「页面 target 死亡」节）：浏览器
// 偶发收掉 target 时换新页面整场重跑，产品断言失败不重跑。
const pageTest = (name: string, body: (page: Page) => Promise<void>): void => {
  baseTest(name, async ({ page }, testInfo) => {
    await guardPageChannel(page, body, { testInfo });
  });
};

/** 合成空 vault：条目为空、无会话历史——开箱即触发统一空工作区。 */
const EMPTY_VAULT: VaultFixture = {
  root: "/Users/alex/empty-vault",
  vault_id: "empty-vault",
  entries: [],
  files: {},
  // 产品出厂语言是 en（桩缺省 zh 只为既有整页基线）；这里显式钉 en，验出厂首启面。
  config: { language: "en" },
};

/** WCAG 2.x 对比度。首启按钮是正文档（`--fs-ui` 13px / `--fw-emphasis` 550，不构成大字号），
 *  按 AA 正文阈值 4.5:1 判。UA 系统色（`buttontext`）不随 CSS 主题走——按钮若只设背景不设
 *  前景，深色主题会拿到近黑文字，这类缺陷只有量对比度才判得出来。 */
const relativeLuminance = (rgb: [number, number, number]): number => {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
};

/** 只接受不透明 `rgb()`：按钮底色是 `--content-bg`，三主题都无 alpha；带 alpha 时必须先合成
 *  才能算比值，出现即判红，不静默按通道值算。 */
const opaqueRgb = (css: string): [number, number, number] => {
  const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(css.trim());
  if (m === null) throw new Error(`期望不透明 rgb()，实际 ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

const contrastRatio = (fg: string, bg: string): number => {
  const [hi, lo] = [relativeLuminance(opaqueRgb(fg)), relativeLuminance(opaqueRgb(bg))].sort(
    (a, b) => b - a,
  );
  return (hi + 0.05) / (lo + 0.05);
};

for (const theme of ["light", "dark", "eink"] as const) {
  pageTest(`真首启（${theme}）：添加 vault 按钮文字对底色达 WCAG AA 4.5:1`, async (page) => {
    await stubTauri(page, null, { theme });
    await page.goto("/");

    const open = page.getByRole("button", { name: "添加 vault" });
    await expect(open).toBeVisible();
    const colors = await open.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, backgroundColor: cs.backgroundColor };
    });
    const ratio = contrastRatio(colors.color, colors.backgroundColor);
    expect(
      ratio,
      `${theme}: 文字 ${colors.color} / 底色 ${colors.backgroundColor} 对比 ${ratio.toFixed(2)}:1 低于 4.5:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  // 老用户空 vault 的「New note」（`.editor-notice-action`）与首启按钮同根因：只设背景不设
  // 前景，深色下同样落 UA buttontext 近黑。两处各判一次，避免修复只覆盖其中一个入口。
  pageTest(`老用户空 vault（${theme}）：New note 按钮文字对底色达 WCAG AA 4.5:1`, async (page) => {
    await stubTauri(page, { ...EMPTY_VAULT, config: { language: "en", theme } });
    await page.goto("/");

    const newNote = page.getByRole("button", { name: "New note" });
    await expect(newNote).toBeVisible();
    const colors = await newNote.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, backgroundColor: cs.backgroundColor };
    });
    const ratio = contrastRatio(colors.color, colors.backgroundColor);
    expect(
      ratio,
      `${theme}: 文字 ${colors.color} / 底色 ${colors.backgroundColor} 对比 ${ratio.toFixed(2)}:1 低于 4.5:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });
}

pageTest("真首启：启动态首启模式唯一 Add vault，整窗居中，无树空态/正文", async (page) => {
  await stubTauri(page, null);
  // 原生菜单事件的测试通道：stubTauri 已把 __TAURI_INTERNALS__ 装好，这里包一层记录
  // app:menu_command 的 listener，再按 Tauri 的真实回调形状触发一次。
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    w.__menuListeners = [];
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      const result = await invoke(cmd, args);
      if (cmd === "plugin:event|listen" && args?.event === "app:menu_command") {
        (w.__menuListeners as number[]).push(args.handler as number);
      }
      return result;
    };
    w.__fireMenuCommand = (payload: string) => {
      for (const id of w.__menuListeners as number[]) {
        w.__TAURI_INTERNALS__.runCallback(id, { event: "app:menu_command", id, payload });
      }
    };
  });
  await page.goto("/");

  const startup = page.locator("#startup.startup-first-run");
  await expect(startup).toBeVisible();
  await expect(page.locator(".startup-sidebar")).toHaveCount(0);
  await expect(page.locator(".startup-mark")).toHaveCount(0);
  await expect(page.locator(".startup-phase")).toHaveCount(0);
  const open = page.getByRole("button", { name: "添加 vault" });
  await expect(open).toBeVisible();
  // 首启屏不是 content pane：既有树空态 / 树行 / 标签栏都不出现
  await expect(page.locator(".ft-empty")).toHaveCount(0);
  await expect(page.locator(".ft-row")).toHaveCount(0);
  await expect(page.locator(".tabstrip")).toBeHidden();
  await expect(page.locator(".startup-titlebar")).toHaveAttribute("data-tauri-drag-region", "deep");

  const geometry = await page.evaluate(() => {
    const app = document.querySelector<HTMLElement>("#app");
    const button = document.querySelector<HTMLElement>(".startup-open");
    if (app === null || button === null) throw new Error("首启面 / #app 缺元素");
    const r = button.getBoundingClientRect();
    return {
      appInert: app.inert,
      appAriaHidden: app.getAttribute("aria-hidden"),
      centerX: r.x + r.width / 2,
      centerY: r.y + r.height / 2,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(geometry.appInert).toBe(true);
  expect(geometry.appAriaHidden).toBe("true");
  expect(Math.abs(geometry.centerX - geometry.viewportWidth / 2)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(geometry.centerY - geometry.viewportHeight / 2)).toBeLessThanOrEqual(1.5);

  // 命令闸门：三条全局键都不产生工作区 DOM / 布局副作用；首启面仍只有唯一按钮
  await page.keyboard.press("Meta+,");
  await page.keyboard.press("Meta+Shift+A");
  await page.keyboard.press("Meta+/");
  await expect(page.locator(".lumir-set-overlay")).toBeHidden();
  await expect(page.locator(".lumir-bindings-overlay")).toBeHidden();
  await expect(page.locator(".pane-divider")).toHaveCount(0);
  await expect(page.locator("#startup.startup-first-run")).toBeVisible();
  await expect(page.getByRole("button", { name: "添加 vault" })).toBeVisible();

  // 原生菜单来源（settings / describe-bindings）同样被闸门挡住。
  await page.evaluate(() => (window as unknown as { __fireMenuCommand: (payload: string) => void }).__fireMenuCommand("settings"));
  await page.evaluate(() => (window as unknown as { __fireMenuCommand: (payload: string) => void }).__fireMenuCommand("describe-bindings"));
  await expect(page.locator(".lumir-set-overlay")).toBeHidden();
  await expect(page.locator(".lumir-bindings-overlay")).toBeHidden();
  await expect(page.locator("#startup.startup-first-run")).toBeVisible();
});

/** 竞态现场：首 vault 有恢复标签，正文读取被延迟；第二个空 vault 先完成空态。 */
const SECOND_EMPTY: VaultFixture & { root: string } = {
  root: "/Users/alex/second-empty-vault",
  vault_id: "second-empty",
  entries: [],
  files: {},
};

const FIRST_RUN_RACE: VaultFixture = {
  root: "/Users/alex/first-tabbed-vault",
  vault_id: "first-tabbed",
  entries: [{ path: "readme.md", kind: "file", size: 20, mtime_ms: 1 }],
  files: { "readme.md": "# First vault\n" },
  sessions: { "first-tabbed": { tabs: ["readme.md"], active: "readme.md" } },
  snapshotDelayMs: { "readme.md": 1800 },
  lastVault: null,
  config: { language: "en" },
  vaults: [
    {
      id: "second-empty",
      path: "/Users/alex/second-empty-vault",
      name: "second-empty-vault",
      available: true,
      last_opened_at: null,
      tab_count: 0,
    },
  ],
  switchTo: SECOND_EMPTY,
};

/** 首启 workspace：有文件但没有会话历史——按首启规则出 tips + 默认 harness。 */
const FIRST_RUN_VAULT: VaultFixture = {
  root: "/Users/alex/first-run-vault",
  vault_id: "first-run-vault",
  entries: [{ path: "note.md", kind: "file", size: 20, mtime_ms: 1 }],
  files: { "note.md": "# Note\n" },
  lastVault: null,
  config: { language: "en" },
};

pageTest("首启空工作区：tips + 默认 harness，空工作区标题与动作让位；打开文档 tips 消失", async (page) => {
  await stubTauri(page, FIRST_RUN_VAULT);
  await page.goto("/");

  const tips = page.locator(".first-run-tips");
  await expect(tips).toBeVisible();
  await expect(tips).toContainText("Get started");
  await expect(tips).toContainText("Quick open a file");
  await expect(tips).toContainText("press ⌘/ for all shortcuts");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".pane-divider")).toHaveCount(1);
  await expect(page.locator(".editor-notice")).toBeHidden();
  expect(await page.evaluate(() => document.querySelector<HTMLElement>("#app")?.inert)).toBe(false);
  await expect(page.locator(".pane-empty-workspace")).toBeHidden();
  await expect(tips).not.toContainText("No document open");
  await expect(tips).not.toContainText("Open note…");

  // tips 只覆盖 root doc pane；harness 是另一个 pane，不被 tips 盖住。
  const structure = await page.evaluate(() => {
    const tipsEl = document.querySelector<HTMLElement>(".first-run-tips");
    const harness = document.querySelector<HTMLElement>(".lumir-harness");
    const tipsPane = tipsEl?.closest<HTMLElement>(".editor-pane");
    const harnessPane = harness?.closest<HTMLElement>(".editor-pane");
    if (tipsEl === null || harness === null || tipsPane === null || harnessPane === null) {
      throw new Error("tips / harness / pane 缺元素");
    }
    const t = tipsEl.getBoundingClientRect();
    const h = harness.getBoundingClientRect();
    return {
      samePane: tipsPane === harnessPane,
      tipsRight: t.right,
      harnessLeft: h.left,
      editable: document.querySelector<HTMLElement>(".cm-content")?.getAttribute("contenteditable"),
    };
  });
  expect(structure.samePane).toBe(false);
  expect(structure.tipsRight).toBeLessThanOrEqual(structure.harnessLeft + 1);
  expect(structure.editable).toBe("false");

  await page.locator('.ft-row[title="note.md"]').click();
  await expect(tips).toHaveCount(0);
  const editorContent = page.locator(".editor-pane .cm-content").first();
  await expect(editorContent).toContainText("Note");
  expect(await editorContent.getAttribute("contenteditable")).not.toBe("false");
});

pageTest("首 vault restore 延迟、第二空 vault 先完成：第二不继承 tips / 默认 harness", async (page) => {
  await stubTauri(page, FIRST_RUN_RACE);
  await page.goto("/");

  // 正观测：首 vault 的树与标签壳已建立（正文读取仍在 1800ms 延迟里）。
  await expect(page.locator('.ft-row[title="readme.md"]')).toBeVisible();
  await expect(page.locator("#startup")).toHaveCount(0);
  await expect(page.locator(".tab-name")).toHaveText("readme.md");

  // 首个 restore 未收尾时切到第二个空 vault（走 vault 切换器；不是重启 / reload）。
  await page.keyboard.press("Meta+O");
  const second = page.locator('.vault-row[data-vault="second-empty"]');
  await expect(second).toBeVisible();
  await second.click();
  // 先等切换真的完成（树头部点名第二个 vault），再看空态；首个 restore 的延迟与切换
  // 收尾可能交错，固定 5s 断言容易把「还在装载」误读成产品 FAIL。
  await expect(page.locator(".ft-vault-name")).toHaveText("second-empty-vault", { timeout: 10_000 });

  // 第二个空 vault 先完成空态：资格仍属于第一个 vault，第二个不得继承 tips / harness。
  // 先判 tips / harness（本用例的核心），再判空工作区；首个 restore 的迟到结果不遮盖这条判据。
  await expect(page.locator(".first-run-tips")).toHaveCount(0);
  await expect(page.locator(".pane-divider")).toHaveCount(0);
  await expect(page.locator(".pane-empty-workspace")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".pane-empty-title")).toHaveText("No document open", { timeout: 10_000 });

  // 等过第一个 restore 的延迟窗：迟到的首个 restore 也不得把 tips / harness 补到第二个。
  await page.waitForTimeout(2400);
  await expect(page.locator(".first-run-tips")).toHaveCount(0);
  await expect(page.locator(".pane-divider")).toHaveCount(0);
});

pageTest("老用户空 vault：统一空工作区 + 可见 New note；新建默认 .md、显式扩展名保留", async (page) => {
  await stubTauri(page, EMPTY_VAULT);
  await page.goto("/");

  await expect(page.locator(".ft-vault-name")).toHaveText("empty-vault");

  // 空 vault 正文空态：统一空工作区（标题 + 两个动作），不再有 D107 覆盖层。
  const surface = page.locator(".editor-pane").first().locator(".pane-empty-workspace");
  await expect(surface).toBeVisible();
  await expect(surface.locator(".pane-empty-title")).toHaveText("No document open");
  await expect(page.locator(".editor-notice")).toBeHidden();
  const newNote = surface.getByRole("button", { name: "New note" });
  await expect(newNote).toBeVisible();
  await expect(surface.getByRole("button", { name: "Open note…" })).toBeVisible();

  // 旧病串（SAMPLE 的 frontmatter / 错误附件占位）不得出现在可见正文面。
  for (const junk of ["i18n-exempt", "Attachment not found", "Image read failed", "标题一"]) {
    await expect(surface, `空态正文不得含 ${junk}`).not.toContainText(junk);
  }

  // 入口开始同一套行内新建（tree.beginCreate("")）：输入框落在树里并持焦点。
  await newNote.click();
  const input = page.locator(".ft-row.is-editing input");
  await expect(input).toHaveAttribute("aria-label", "New file name");
  await expect(input).toBeFocused();

  // 无扩展名输入 → 后端收到的实际创建名是 note.md（判据不是输入框里的文本）。
  await input.fill("note");
  await page.keyboard.press("Enter");
  await expect.poll(async () => fsMutations(page)).toEqual([{ cmd: "fs_create_file", path: "note.md" }]);

  // 新建成功即自动打开；空态覆盖层随之撤下。
  await expect(page.locator(".modeline-path")).toHaveText("note.md");
  await expect(page.locator(".tab-name")).toHaveText("note.md");
  await expect(surface).toBeHidden();
  // watcher 回响把真实条目收敛进树（桩只让 fixture 世界前进、事件由场景显式发，与
  // tree-menu.spec 同一口径）——后面「撞名预检」要对着树模型里的 note.md 判。
  await fireFsEvent(page, [{ kind: "created", path: "note.md", entry_kind: "file" }]);
  await expect(page.locator('.ft-row[title="note.md"]')).toBeVisible();

  // 编辑 + 保存：写入落在 note.md（桩的 document_save 记录）。
  await page.locator(".cm-content").click();
  await page.keyboard.type("First note from a brand new user.");
  await page.keyboard.press("Meta+s");
  await expect
    .poll(async () => documentWrites(page))
    .toEqual([{ path: "note.md", content: "First note from a brand new user." }]);

  // 用户显式写扩展名时原样保留（同一入口之外的既有右键根菜单路径）：todo.txt 不得被补 .md。
  await page.locator(".ft-vault").click({ button: "right" });
  await page.locator(".ft-menu-item", { hasText: "New file" }).click();
  const explicit = page.locator(".ft-item.is-new .ft-edit");
  await explicit.fill("todo.txt");
  await page.keyboard.press("Enter");
  await expect.poll(async () => fsMutations(page)).toEqual([
    { cmd: "fs_create_file", path: "note.md" },
    { cmd: "fs_create_file", path: "todo.txt" },
  ]);
  await fireFsEvent(page, [{ kind: "created", path: "todo.txt", entry_kind: "file" }]);
  await expect(page.locator('.ft-row[title="todo.txt"]')).toBeVisible();

  // 撞名预检对着**最终落盘名**判：输入 note（无扩展名）撞上已有 note.md 时当场标红，
  // 不等到后端 fs_already_exists 才报错。
  await page.locator(".ft-vault").click({ button: "right" });
  await page.locator(".ft-menu-item", { hasText: "New file" }).click();
  const collision = page.locator(".ft-item.is-new .ft-edit");
  await collision.fill("note");
  await expect(page.locator(".ft-item.is-new .ft-edit-error")).toHaveText(
    "An entry with that name already exists: note.md",
  );
  // 非法状态不提交：Esc 取消后磁盘无第三笔创建。
  await page.keyboard.press("Escape");
  await expect(page.locator(".ft-item.is-new")).toHaveCount(0);
  expect(await fsMutations(page)).toHaveLength(2);
});
