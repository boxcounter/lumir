// 左栏宽度拖拽 / ⌘B 收起 / vault 根右键新建（M631，change
// add-sidebar-resize-hide-and-root-create）。
//
// 判据一律是**读数**：token 计算值、网格首列、`.pane-filetree` / `.titlebar-traffic` 的实测宽、
// 分隔条的包围盒与视觉线 opacity、`config_set_ui_value` 的写入序列、桩记录的 fs 变更、
// 菜单的项集文本。不写「某个函数被调用过」这类等价于恒真的断言。
//
// 刻意**不新增整页像素基线**：分隔条静止态零足迹（透明、1px 视觉线 opacity 0），收起态是
// 结构变化（列宽 0 / display none），按 tests/visual/README 的「新增低于整页容差预算的 UI
// 元素时，在场守卫落在结构断言」办——本文件的断言即那道守卫。

import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";

const DOC = "# 侧栏场景\n\n宽度与收起都只改骨架，不改文档。\n";

interface UiConfig {
  sidebar_width?: number;
}

/** 打开一个文档页（缺省：一个文件、出厂宽度 236）。 */
async function open(
  page: Page,
  options: { config?: UiConfig; failures?: Record<string, { code: string; message: string }> } = {},
): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: "doc.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
    files: { "doc.md": DOC },
    config: options.config,
    failures: options.failures,
  });
  await page.goto("/");
  await page.locator('.ft-row[title="doc.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("doc.md");
  // 等配置装载完成（setSidebarWidth 在 config_get 的回调里，晚于首帧）。
  await expect.poll(() => page.evaluate(() => (window as never as { __configGets: number }).__configGets)).toBeGreaterThan(0);
  await page.waitForTimeout(80);
}

interface Readings {
  token: string;
  firstColumn: number;
  paneWidth: number;
  trafficWidth: number;
  editorLeft: number;
  dividerLeft: number;
  dividerWidth: number;
  dividerDisplay: string;
  paneDisplay: string;
  valuenow: string | null;
}

/** 骨架的实测读数（一次 evaluate 取全，避免中途重排导致的拼盘读数）。 */
async function readings(page: Page): Promise<Readings> {
  return page.evaluate(() => {
    const shell = document.querySelector(".app-shell") as HTMLElement;
    const pane = document.querySelector(".pane-filetree") as HTMLElement;
    const traffic = document.querySelector(".titlebar-traffic") as HTMLElement;
    const editor = document.querySelector(".pane-editor") as HTMLElement;
    const divider = document.querySelector(".sidebar-divider") as HTMLElement;
    const box = divider.getBoundingClientRect();
    return {
      token: getComputedStyle(document.documentElement).getPropertyValue("--layout-sidebar-w").trim(),
      firstColumn: parseFloat(getComputedStyle(shell).gridTemplateColumns.split(" ")[0]),
      paneWidth: pane.getBoundingClientRect().width,
      trafficWidth: traffic.getBoundingClientRect().width,
      editorLeft: editor.getBoundingClientRect().left,
      dividerLeft: box.left,
      dividerWidth: box.width,
      dividerDisplay: getComputedStyle(divider).display,
      paneDisplay: getComputedStyle(pane).display,
      valuenow: divider.getAttribute("aria-valuenow"),
    };
  });
}

/** 已记录的 `[ui]` 写入序列（桩侧真源）。 */
async function uiValueWrites(page: Page): Promise<Array<{ key: string; value: unknown }>> {
  return page.evaluate(() => [...((window as never as { __uiValueWrites: Array<{ key: string; value: unknown }> }).__uiValueWrites ?? [])]);
}

/** 桩记录的 vault 写操作（fs_create_file / fs_create_dir 的落点）。 */
async function fsMutations(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => [...((window as never as { __fsMutations: Array<Record<string, unknown>> }).__fsMutations ?? [])]);
}

/** 分隔条上按下并横向拖 `dx`；`release=false` 时停在按下态（验拖拽中的 live 施加）。 */
async function dragDivider(page: Page, dx: number, options: { release?: boolean } = {}): Promise<void> {
  const box = (await page.locator(".sidebar-divider").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x + (dx * i) / steps, y);
  }
  if (options.release !== false) await page.mouse.up();
}

// ---------------------------------------------------------------------------
// 默认口径与分隔条形态
// ---------------------------------------------------------------------------

test("缺省配置即出厂口径 236px：token / 侧栏宽 / traffic 区宽三处逐值一致", async ({ page }) => {
  await open(page);
  const r = await readings(page);
  expect(r.token, "token 默认值来自样式表（三处同值的第一处）").toBe("236px");
  expect(r.paneWidth).toBe(236);
  expect(r.firstColumn).toBe(236);
  expect(r.trafficWidth).toBe(236);
  expect(r.editorLeft).toBe(236);
  // 分隔条：6px 透明命中带，从侧栏右缘的 hairline 起向正文一侧伸（不对称——左栏整幅宽度
  // 含右内边距那条带在 M251 起属于行，对称跨线会从行手里抢走最后几像素的右键命中面）
  expect(r.dividerWidth).toBe(6);
  expect(r.dividerLeft).toBeCloseTo(236 - 1, 0);
  // 视觉线静止态不可见（零足迹）
  const idleOpacity = await page.evaluate(() => getComputedStyle(document.querySelector(".sidebar-divider")!, "::before").opacity);
  expect(idleOpacity).toBe("0");
  // 读屏身份（role=separator + 方向 + 读屏名 D549 + 值语义）
  const divider = page.locator(".sidebar-divider");
  await expect(divider).toHaveAttribute("role", "separator");
  await expect(divider).toHaveAttribute("aria-orientation", "vertical");
  await expect(divider).toHaveAttribute("aria-label", "调整左栏宽度");
  await expect(divider).toHaveAttribute("aria-valuemin", "180");
  await expect(divider).toHaveAttribute("aria-valuemax", "480");
  await expect(divider).toHaveAttribute("aria-valuenow", "236");
});

test("hover / 拖拽中显现视觉线，移开恢复", async ({ page }) => {
  await open(page);
  const opacity = () => page.evaluate(() => getComputedStyle(document.querySelector(".sidebar-divider")!, "::before").opacity);
  await page.locator(".sidebar-divider").hover();
  expect(await opacity()).toBe("1");
  await page.locator(".cm-content").hover({ position: { x: 400, y: 300 } });
  expect(await opacity()).toBe("0");
});

// ---------------------------------------------------------------------------
// 拖拽：live 生效、松手写一次、两层钳制
// ---------------------------------------------------------------------------

test("向右拖 80px → 宽度 316（live 生效；拖拽期零写盘，松手恰一次写盘）", async ({ page }) => {
  await open(page);
  await dragDivider(page, 80, { release: false });
  // live：拖拽过程中 token 已经变了（rAF 合并后的最后一次 move）
  await expect.poll(async () => (await readings(page)).token).toBe("316px");
  const mid = await readings(page);
  expect(mid.paneWidth).toBe(316);
  expect(mid.trafficWidth, "标题栏 traffic 宽与侧栏同源跟随").toBe(316);
  expect(mid.firstColumn).toBe(316);
  expect(mid.dividerLeft).toBeCloseTo(316 - 1, 0);
  expect(await uiValueWrites(page), "拖拽过程零写盘（持久化只在松手时发生一次）").toEqual([]);
  await page.mouse.up();
  await expect.poll(async () => uiValueWrites(page)).toEqual([{ key: "sidebar_width", value: 316 }]);
  expect((await readings(page)).valuenow, "aria-valuenow 随宽度更新").toBe("316");
});

test("上下限：触顶 480 后钳住，往窄拖到底停在 180（松开才写一次）", async ({ page }) => {
  await open(page);
  await dragDivider(page, 400); // 236 + 400 = 636 > 480
  await expect.poll(async () => (await readings(page)).token).toBe("480px");
  await dragDivider(page, -400); // 480 - 400 = 80 < 180
  await expect.poll(async () => (await readings(page)).token).toBe("180px");
  expect(await uiValueWrites(page)).toEqual([
    { key: "sidebar_width", value: 480 },
    { key: "sidebar_width", value: 180 },
  ]);
});

test("无位移的按下不写盘（松手只在值有变化时提交）", async ({ page }) => {
  await open(page);
  await dragDivider(page, 0);
  expect(await uiValueWrites(page)).toEqual([]);
  expect((await readings(page)).token).toBe("236px");
});

test("窗口过窄：显示值按窗口四成钳住（不写盘），窗口恢复后回到用户意图值", async ({ page }) => {
  await open(page);
  await dragDivider(page, 80); // 意图值 316（已落盘）
  expect(await uiValueWrites(page)).toEqual([{ key: "sidebar_width", value: 316 }]);
  await page.setViewportSize({ width: 500, height: 800 });
  // 500 × 0.4 = 200 < 316：显示值被钳住（列宽与 token 一起）
  await expect.poll(async () => (await readings(page)).token).toBe("200px");
  const narrow = await readings(page);
  expect(narrow.paneWidth).toBe(200);
  expect(narrow.valuenow).toBe("200");
  // 窗口恢复：回到意图值 316，且没有第二次写盘（钳制只是显示口径）
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect.poll(async () => (await readings(page)).token).toBe("316px");
  expect(await uiValueWrites(page), "窗口钳制 MUST NOT 写盘").toEqual([{ key: "sidebar_width", value: 316 }]);
});

test("写盘失败：toast D550 + 诊断日志，运行期宽度不回滚", async ({ page }) => {
  await open(page, { failures: { config_set_ui_value: { code: "config_write_failed", message: "只读文件系统" } } });
  await dragDivider(page, 60); // 236 + 60 = 296
  await expect.poll(async () => (await readings(page)).token).toBe("296px");
  await expect(page.locator(".lumir-toast", { hasText: "左栏宽度没能存进配置" })).toContainText("只读文件系统");
  await expect(page.locator(".lumir-toast", { hasText: "左栏宽度没能存进配置" })).toContainText("本次调整仍生效，重启后恢复");
  expect((await readings(page)).token, "运行期宽度不回滚（与栏宽 D3 同口径）").toBe("296px");
  const warnings = await page.evaluate(() =>
    ((window as never as { __logEvents: Array<{ event: string; fields: Record<string, string> }> }).__logEvents ?? [])
      .filter((entry) => entry.event === "config_warning")
      .map((entry) => entry.fields.message ?? ""),
  );
  expect(warnings.some((message) => message.includes("只读文件系统"))).toBe(true);
});

test("配置值启动生效（config 320 → token / 侧栏 / traffic 三处 320）", async ({ page }) => {
  await open(page, { config: { sidebar_width: 320 } });
  await expect.poll(async () => (await readings(page)).token).toBe("320px");
  const r = await readings(page);
  expect(r.paneWidth).toBe(320);
  expect(r.trafficWidth).toBe(320);
  expect(r.valuenow).toBe("320");
});

// ---------------------------------------------------------------------------
// ⌘B 收起 / 展开
// ---------------------------------------------------------------------------

test("⌘B 收起：首列 0、侧栏不显示、traffic 回最小宽、正文贴左；再按一次全部复原", async ({ page }) => {
  await open(page);
  await dragDivider(page, 80); // 先拖到 316，验「展开回到收起前的宽度」
  await expect.poll(async () => (await readings(page)).token).toBe("316px");
  const before = await readings(page);

  // 焦点放进左栏（树行），验证焦点交接：收起后焦点必须在文档编辑器里
  await page.locator('.ft-row[title="doc.md"]').focus();
  await page.keyboard.press("Meta+b");

  const hidden = await readings(page);
  expect(hidden.firstColumn, "网格首列归 0").toBe(0);
  expect(hidden.paneDisplay, "侧栏内容不显示（藏 DOM，不销毁）").toBe("none");
  expect(hidden.paneWidth).toBe(0);
  expect(hidden.dividerDisplay, "收起态没有可调宽度：分隔条不显示、不可拖").toBe("none");
  expect(hidden.editorLeft, "正文左缘贴窗口左缘").toBe(0);
  expect(hidden.trafficWidth, "traffic 区不留 236px 空位").toBeLessThan(236);
  expect(hidden.trafficWidth, "traffic 区仍容得下原生交通灯 + 标识块").toBeGreaterThan(78);
  // 焦点交还活跃文档 pane（不可见元素上不留焦点），随即键入落在文档里
  const focusedInEditor = await page.evaluate(() => document.activeElement?.closest(".cm-content") !== null);
  expect(focusedInEditor, "焦点必须交还活跃文档 pane 的编辑器").toBe(true);
  await page.keyboard.type("X");
  await expect(page.locator(".cm-content")).toContainText("X");

  // 再按一次：全部复原（逐值对照收起前读数；树模型的展开态由「同一行仍可点」见证）
  await page.keyboard.press("Meta+b");
  const back = await readings(page);
  expect(back.firstColumn).toBe(before.firstColumn);
  expect(back.paneWidth).toBe(before.paneWidth);
  expect(back.trafficWidth).toBe(before.trafficWidth);
  expect(back.editorLeft).toBe(before.editorLeft);
  expect(back.dividerDisplay).not.toBe("none");
  expect(back.token, "展开回到收起前的宽度（token 未被改写）").toBe("316px");
  await expect(page.locator('.ft-row[title="doc.md"]')).toBeVisible();
});

test("收起时进行中的行内新建按取消处理（不提交、不留临时行、磁盘零变更）", async ({ page }) => {
  await open(page);
  // 根菜单（树头部右键）→ 新建文件 → 输入框在场（行内编辑态）。文件行菜单没有新建项，
  // 因此这里走的就是本 change 的新入口，顺带验证它与收起路径的配合。
  await page.locator(".ft-vault").click({ button: "right" });
  await page.locator(".ft-menu-item", { hasText: "新建文件…" }).click();
  await expect(page.locator(".ft-row.is-editing")).toHaveCount(1);
  await page.keyboard.type("half-typed");
  await page.keyboard.press("Meta+b");
  // 取消：输入框与临时行都撤离，磁盘零写入
  await expect(page.locator(".ft-row.is-editing")).toHaveCount(0);
  expect(await fsMutations(page), "按取消处理：不提交半截输入").toEqual([]);
  expect(await page.locator(".app-shell.is-sidebar-hidden").count()).toBe(1);
});

test("收起时开着的树右键菜单一并关闭，焦点回到文档", async ({ page }) => {
  await open(page);
  await page.locator(".ft-vault").click({ button: "right" });
  await expect(page.locator(".ft-menu")).toBeVisible();
  await page.keyboard.press("Meta+b");
  await expect(page.locator(".ft-menu")).toBeHidden();
  const focusedInEditor = await page.evaluate(() => document.activeElement?.closest(".cm-content") !== null);
  expect(focusedInEditor, "菜单关闭后焦点交还编辑器，不停在不可见元素上").toBe(true);
});

// ---------------------------------------------------------------------------
// vault 根右键新建
// ---------------------------------------------------------------------------

/** 右键落在树的非条目行区域后，校验「根级菜单」的项集与形态。 */
async function expectRootMenu(page: Page): Promise<void> {
  const menu = page.locator(".ft-menu");
  await expect(menu).toBeVisible();
  const labels = await page.locator(".ft-menu-item").allTextContents();
  expect(labels, "根级菜单项集只有两条新建（无通用项、无破坏性项、无 Reload）").toEqual(["新建文件…", "新建子目录…"]);
  await expect(page.locator(".ft-menu-sep")).toHaveCount(0);
  for (const absent of ["重命名…", "复制完整路径", "在 Finder 中显示", "移到废纸篓…", "Reload"]) {
    await expect(menu, `根级菜单不得含「${absent}」`).not.toContainText(absent);
  }
}

test("树头部右键：根级菜单两条新建项，拦下默认菜单，不改当前行与标签", async ({ page }) => {
  await open(page);
  const tabCountBefore = await page.locator(".tab").count();
  // 记录 contextmenu 的 defaultPrevented：window 冒泡监听晚于树容器的监听，
  // 读到 true 即「应用拦下了 webview 默认菜单」。
  await page.evaluate(() => {
    (window as never as { __ctxPrev: boolean | null }).__ctxPrev = null;
    window.addEventListener("contextmenu", (event) => {
      (window as never as { __ctxPrev: boolean | null }).__ctxPrev = event.defaultPrevented;
    });
  });
  await page.locator(".ft-vault").click({ button: "right" });
  await expectRootMenu(page);
  expect(await page.evaluate(() => (window as never as { __ctxPrev: boolean | null }).__ctxPrev)).toBe(true);
  // 右键不改上下文：当前行与标签不变
  expect(await page.locator(".tab").count()).toBe(tabCountBefore);
  await expect(page.locator('.ft-row[title="doc.md"]')).toHaveAttribute("aria-current", "true");
  // Esc 关闭，焦点归还树头部入口
  await page.keyboard.press("Escape");
  await expect(page.locator(".ft-menu")).toBeHidden();
  const focusedOnVault = await page.evaluate(() => document.activeElement?.classList.contains("ft-vault") ?? false);
  expect(focusedOnVault, "关闭后焦点归还树头部的 vault 名入口").toBe(true);
  await expect(page.locator('.ft-row[title="doc.md"]')).toHaveAttribute("aria-current", "true");
});

test("列表尾部空白右键：与树头部同形同项集", async ({ page }) => {
  await open(page);
  const box = (await page.locator(".filetree").boundingBox())!;
  // 列表很短（一行），底部空白一定在末行之下——落在容器命中面内、任何行带之外
  await page.mouse.click(box.x + 80, box.y + box.height - 20, { button: "right" });
  await expectRootMenu(page);
  await page.keyboard.press("Escape");
});

test("根菜单新建文件：parentRel 为空串（落 vault 根）且自动打开", async ({ page }) => {
  await open(page);
  await page.locator(".ft-vault").click({ button: "right" });
  await page.locator(".ft-menu-item", { hasText: "新建文件…" }).click();
  await expect(page.locator(".ft-row.is-editing")).toHaveCount(1);
  const input = page.locator(".ft-row.is-editing input");
  await expect(input).toHaveAttribute("aria-label", "新建文件的名称");
  await input.fill("root-note.md");
  await page.keyboard.press("Enter");
  await expect.poll(async () => fsMutations(page)).toEqual([{ cmd: "fs_create_file", path: "root-note.md" }]);
  // 新建文件成功即自动打开（§3.5，不等 watcher 回响）
  await expect(page.locator(".modeline-path")).toHaveText("root-note.md");
});

test("根菜单新建目录：parentRel 为空串，不自动打开、不新增标签", async ({ page }) => {
  await open(page);
  const tabCountBefore = await page.locator(".tab").count();
  await page.locator(".ft-vault").click({ button: "right" });
  await page.locator(".ft-menu-item", { hasText: "新建子目录…" }).click();
  const input = page.locator(".ft-row.is-editing input");
  await expect(input).toHaveAttribute("aria-label", "新建子目录的名称");
  await input.fill("notes");
  await page.keyboard.press("Enter");
  await expect.poll(async () => fsMutations(page)).toEqual([{ cmd: "fs_create_dir", path: "notes" }]);
  await expect(page.locator(".modeline-path"), "新建目录不自动打开").toHaveText("doc.md");
  expect(await page.locator(".tab").count()).toBe(tabCountBefore);
});

test("条目行右键行为不变（反向验证：仍为既有项集，不出现根级菜单）", async ({ page }) => {
  await open(page);
  await page.locator('.ft-row[title="doc.md"]').click({ button: "right" });
  const labels = await page.locator(".ft-menu-item").allTextContents();
  expect(labels).toEqual(["重命名…", "复制完整路径", "在 Finder 中显示", "移到废纸篓…"]);
  await expect(page.locator(".ft-menu-sep")).toHaveCount(1);
  // 缩进区（行带之内、行左缘之外）不产根菜单：它是保守的既有口径（M530/M631）
  await page.keyboard.press("Escape");
  await expect(page.locator(".ft-menu")).toBeHidden();
});
