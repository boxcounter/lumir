/**
 * Skill 候选「选中项仍不可见」缺陷回归（change fix-skill-visible-selection-nov25）。
 *
 * 现场：真实规模目录里 ⌃N/P 会滚动列表，但游标走到「最下面可见项的下一项」时，选中状态完全
 * 看不到。合同（`docs/specs/selector-contract.md` C2 / C3、`docs/specs/skill-menu.md` S2）要求
 * 游标 option 完整落在**真实可见带**内并留一行上下文，所以这是缺陷而非重新设计。
 *
 * 判据纪律（本套用例与既有 oracle 的差别，也是这次漏网的成因）：
 * - 真实可见带**独立于实现**计算：菜单 ∩ **全部裁切祖先** ∩ 视口，再扣掉候选自身的边框与
 *   padding。抄实现的 `menuRect ∩ panelRect ∩ viewport` 只能证明「实现和自己一致」。
 * - 逐拍断言 `.is-selected` 与 `aria-selected` 在**同一** option 上，并断言左条宽度 / 颜色与
 *   底色差（C6「标记可辨」），不只测 scrollTop 变了或 AX 里存在。
 * - 目录取真实规模（30 项 + 真实量级的长描述），两种键族、上下两个方向逐拍走完整个列表。
 *
 * 红证据：把 `placeSkillMenu` 与揭示换回 `d0b6927`（用户截图那个 0.16.0 dev 构建——已有 ⌃N/P，
 * 但放置以 composer 区为界、揭示取候选自身 `clientHeight`）后，本文件 7/7 红，报错即
 * 「选中项下缘越出真实可见带，scrollTop=0」；master 的实现下两引擎全绿。
 */
import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";
import { standardProviders } from "./provider-config";

const VAULT: VaultFixture = {
  entries: [{ path: "note.md", kind: "file", size: 8, mtime_ms: 0 }],
  files: { "note.md": "# Note\n" },
  links: {},
};

type Theme = "light" | "dark" | "eink";

/**
 * 真实规模的合成目录：名字长短混合（10–24 字符）、描述取真实 Skill 描述的量级（80–150 字），
 * 另含一条短描述与一条空描述。短描述 + 12 项以下的合成目录测不出放置与揭示的边界。
 */
function realisticSkills(count: number): Array<Record<string, unknown>> {
  const names = [
    "alpha-notes-cli",
    "beta-vault-cli",
    "gamma-reader",
    "delta-search",
    "delta-extract",
    "delta-crawl",
    "delta-map",
    "delta-research",
    "epsilon-cloud",
    "zeta-deploy",
    "eta-docs",
    "eta-sheets",
    "eta-base",
    "eta-calendar",
    "eta-mail",
    "eta-task",
    "theta-bases",
    "theta-markdown",
    "iota-web-guidance",
    "kappa-devtools",
    "lambda-leak-debugging",
    "mu-lcp-optimize",
    "nu-cookie-debugging",
    "xi-a11y-debugging",
    "omicron-bridge",
    "pi-cu",
    "rho-drawing",
    "sigma-extension-install",
    "tau-repos",
    "upsilon-maker",
  ];
  const descriptions = [
    "Use the notes CLI to read and write work time tracking data — list, add, update, delete entries, check commitments progress, view and edit dimensions; trigger when the user asks to log time or check hours worked.",
    "Interact with vaults using the vault CLI to read, create, search and manage notes, tasks, properties and more; also supports plugin and theme development for advanced workflows.",
    "Use the reader CLI to save URLs and bookmarks to the reading library, list and get bookmarks, authenticate, check account status, archive URLs and tag bookmarks by topic.",
    "Web search, content extraction, crawling, and deep research via the search CLI; use whenever the user wants to search the web, find articles, research a topic, or look something up online.",
    "Extract clean markdown or text content from specific URLs via the extract CLI; use when the user has one or more URLs and wants their content pulled from the page for reading.",
    "Crawl websites and extract content from multiple pages via the crawl CLI; use to download documentation, extract an entire docs section, or bulk-extract pages for offline reading.",
    "短描述对照",
    "",
  ];
  return Array.from({ length: count }, (_, index) => ({
    name: names[index % names.length],
    description: descriptions[index % descriptions.length],
    source: "vault",
    user_invocable: true,
    model_invocable: true,
    invocation_valid: true,
  }));
}

async function setup(
  page: Page,
  catalog: Array<Record<string, unknown>>,
  options: { theme?: Theme; scale?: number; deferCatalog?: boolean } = {},
): Promise<void> {
  await stubTauri(page, options.theme === undefined ? VAULT : { ...VAULT, config: { theme: options.theme } });
  await page.addInitScript(({ skills, providers, deferCatalog }) => {
    const w = window as unknown as Record<string, any>;
    w.__sent = [];
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_skills_list") {
        if (deferCatalog) {
          return new Promise((resolve) => {
            w.__resolveSkills = () => resolve(skills);
          });
        }
        return skills;
      }
      if (cmd === "harness_send") {
        w.__sent.push(args);
        return null;
      }
      if (cmd === "harness_draft_get") return null;
      if (cmd === "harness_draft_put") return null;
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approval: null,
          warn_ctx_pct: 85,
        });
      }
      const result = await invoke(cmd, args);
      if (cmd === "config_get" && result?.config) {
        result.config.harness = {
          provider: "mock",
          providers,
          permissions: { allow: [], deny: [] },
          loop_max: 8,
          warn_ctx_pct: 85,
          auto_compact: true,
        };
      }
      return result;
    };
  }, { skills: catalog, providers: standardProviders(), deferCatalog: options.deferCatalog === true });
  await page.goto("/");
  await page.locator('.ft-row[title="note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  if (options.scale !== undefined) {
    await page.locator(".lumir-harness").evaluate((el, value) => {
      (el as HTMLElement).style.setProperty("--lumir-hp-scale", String(value));
    }, options.scale);
  }
  await page.locator(".lumir-hp-composer .cm-content").click();
}

interface NavSnapshot {
  selected: number;
  marked: number;
  optionCount: number;
  scrollTop: number;
  maxScroll: number;
  overflows: boolean;
  clipTop: number;
  clipBottom: number;
  clippers: string[];
  menuTop: number;
  menuBottom: number;
  menuHeight: number;
  inlineMaxHeight: string;
  panelTop: number;
  panelBottom: number;
  viewportHeight: number;
  bandTop: number;
  bandBottom: number;
  rows: Array<{ top: number; bottom: number; height: number }>;
}

/**
 * 每拍读一次完整几何。真实可见带按合同 C2 取「菜单 × 所有裁切祖先 × 视口」，再扣掉滚动口自己的
 * 边框与 padding（C3）——与实现分开算，实现漏了哪个裁切祖先这里会露出来。
 */
async function navSnapshot(page: Page): Promise<NavSnapshot> {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".lumir-hp-skill-menu");
    if (root === null) throw new Error("候选不在场");
    const panel = root.closest(".lumir-harness");
    if (panel === null) throw new Error("候选不在 harness 面板内");
    const menuRect = root.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const options = Array.from(root.querySelectorAll<HTMLElement>("[role=option]"));
    let trueTop = Math.max(menuRect.top, 0);
    let trueBottom = Math.min(menuRect.bottom, window.innerHeight);
    const clippers: string[] = [];
    for (let node = root.parentElement; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX === "visible" && style.overflowY === "visible") continue;
      const rect = node.getBoundingClientRect();
      trueTop = Math.max(trueTop, rect.top);
      trueBottom = Math.min(trueBottom, rect.bottom);
      clippers.push(`${node.className || node.tagName.toLowerCase()}:${rect.top.toFixed(1)}..${rect.bottom.toFixed(1)}`);
    }
    const scrollStyle = getComputedStyle(root);
    const scrollportTop = menuRect.top + root.clientTop;
    const bandTop = Math.max(scrollportTop + (Number.parseFloat(scrollStyle.paddingTop) || 0), trueTop);
    const bandBottom = Math.min(
      scrollportTop + root.clientHeight - (Number.parseFloat(scrollStyle.paddingBottom) || 0),
      trueBottom,
    );
    return {
      selected: options.findIndex((option) => option.getAttribute("aria-selected") === "true"),
      marked: options.findIndex((option) => option.classList.contains("is-selected")),
      optionCount: options.length,
      scrollTop: root.scrollTop,
      maxScroll: root.scrollHeight - root.clientHeight,
      overflows: root.scrollHeight > root.clientHeight,
      clipTop: Math.max(menuRect.top, panelRect.top, 0),
      clipBottom: Math.min(menuRect.bottom, panelRect.bottom, window.innerHeight),
      clippers,
      menuTop: menuRect.top,
      menuBottom: menuRect.bottom,
      menuHeight: menuRect.height,
      inlineMaxHeight: root.style.maxHeight,
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      viewportHeight: window.innerHeight,
      bandTop,
      bandBottom,
      rows: options.map((option) => {
        const rect = option.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height };
      }),
    };
  });
}

function describeState(state: NavSnapshot, step: string): string {
  return `${step} selected=${state.selected} marked=${state.marked} scrollTop=${state.scrollTop}`
    + ` maxScroll=${state.maxScroll} menu=${state.menuTop.toFixed(1)}..${state.menuBottom.toFixed(1)}`
    + ` h=${state.menuHeight} inlineMaxH=${state.inlineMaxHeight}`
    + ` panel=${state.panelTop.toFixed(1)}..${state.panelBottom.toFixed(1)}`
    + ` clip=${state.clipTop.toFixed(1)}..${state.clipBottom.toFixed(1)}`
    + ` band=${state.bandTop.toFixed(1)}..${state.bandBottom.toFixed(1)}`
    + ` clippers=[${state.clippers.join(", ")}]`
    + ` row=${JSON.stringify(state.rows[state.selected] ?? null)}`;
}

/** 游标标记的样式判据：C6 允许 band / bar 两种变体，但「标记可辨」是硬要求——左侧条宽度 /
 *  颜色与底色差必须真的成立，不能只看 class 挂上了。 */
async function markerOf(page: Page): Promise<{
  exactlyOne: boolean;
  borderLeftWidth: string;
  borderLeftColor: string;
  backgroundDiffers: boolean;
  scrollLeft: number;
}> {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".lumir-hp-skill-menu");
    if (root === null) throw new Error("候选不在场");
    const marked = Array.from(root.children).filter((child) => child.classList.contains("is-selected"));
    const style = marked.length === 0 ? null : getComputedStyle(marked[0]);
    const menuStyle = getComputedStyle(root);
    return {
      exactlyOne: marked.length === 1,
      borderLeftWidth: style?.borderLeftWidth ?? "",
      borderLeftColor: style?.borderLeftColor ?? "",
      backgroundDiffers: style === null ? false : style.backgroundColor !== menuStyle.backgroundColor,
      scrollLeft: root.scrollLeft,
    };
  });
}

/** 逐拍走完整个列表再走回来：每拍都断言「选中项完整在真实可见带内」+「标记唯一且同项」。 */
async function walkAndAssert(page: Page, count: number, label: string): Promise<void> {
  const keys = [["Control+n", 1], ["Control+p", -1]] as const;
  let state = await navSnapshot(page);
  expect(state.optionCount, `${label}：目录项数`).toBe(count);
  expect(state.overflows, `${label}：长列表必须真实溢出，滚动断言才不是空测量`).toBe(true);
  const steps: string[] = [];
  for (const [key, delta] of keys) {
    for (let step = 1; step <= count + 2; step += 1) {
      const target = Math.max(0, Math.min(count - 1, state.selected + delta));
      // 无滚动的判据用实现的同一口径（0.5px 取整容差），不用断言的 1px 可见容差：
      // 差 0.4px 时揭示会真的滚，把「可见」写宽会让这条断言报假红。
      const wasVisible = state.rows[target].top >= state.bandTop - 0.5
        && state.rows[target].bottom <= state.bandBottom + 0.5;
      const beforeScrollTop = state.scrollTop;
      await page.keyboard.press(key);
      state = await navSnapshot(page);
      const detail = describeState(state, `${label} ${key} #${step}`);
      steps.push(detail);
      expect(state.selected, `游标必须移到目标项（${detail}）`).toBe(target);
      expect(state.marked, `可见选中标记必须与 aria-selected 同项（${detail}）`).toBe(target);
      const marker = await markerOf(page);
      expect(marker.exactlyOne, `同一时刻只能有一个 .is-selected（${detail}）`).toBe(true);
      expect(marker.borderLeftWidth, `游标左条宽度（${detail}）`).toBe("2px");
      expect(marker.borderLeftColor, `游标左条不得透明（${detail}）`).not.toBe("rgba(0, 0, 0, 0)");
      expect(marker.backgroundDiffers, `游标底色必须与候选底色可区分（${detail}）`).toBe(true);
      expect(marker.scrollLeft, `候选不得横向滚动把游标左条推出视野（${detail}）`).toBe(0);
      expect(state.rows[target].top, `选中项上缘越出真实可见带（${detail}）`)
        .toBeGreaterThanOrEqual(state.bandTop - 1);
      expect(state.rows[target].bottom, `选中项下缘越出真实可见带（${detail}）`)
        .toBeLessThanOrEqual(state.bandBottom + 1);
      if (wasVisible) {
        expect(
          Math.abs(state.scrollTop - beforeScrollTop),
          `C3：按键前目标已完整可见，scrollTop 不得改变（${detail}；steps=${steps.join(" | ")}）`,
        ).toBeLessThanOrEqual(0.5);
      }
    }
  }
}

test("真实规模目录 30 项 × ⌃N/⌃P 逐拍：选中项完整落在真实可见带内且标记唯一", async ({ page }) => {
  await setup(page, realisticSkills(30));
  await page.mouse.move(10, 10);
  await page.keyboard.type("/");
  await expect(page.locator(".lumir-hp-skill-menu [role=option]")).toHaveCount(30);
  await walkAndAssert(page, 30, "默认视口");
});

test("短视口 500px：真实规模目录逐拍可见", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 500 });
  await setup(page, realisticSkills(30));
  await page.mouse.move(10, 10);
  await page.keyboard.type("/");
  await expect(page.locator(".lumir-hp-skill-menu [role=option]")).toHaveCount(30);
  await walkAndAssert(page, 30, "短视口 500");
});

test("短视口 360px + 共享缩放 1.5：真实规模目录逐拍可见", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 360 });
  await setup(page, realisticSkills(30), { scale: 1.5 });
  await page.mouse.move(10, 10);
  await page.keyboard.type("/");
  await expect(page.locator(".lumir-hp-skill-menu [role=option]")).toHaveCount(30);
  await walkAndAssert(page, 30, "短视口 360 × scale1.5");
});

test("异步目录晚到后逐拍可见（真实 catalog 回包路径）", async ({ page }) => {
  await setup(page, realisticSkills(30), { deferCatalog: true });
  await page.mouse.move(10, 10);
  await page.keyboard.type("/");
  await expect
    .poll(async () => page.evaluate(() => typeof (window as any).__resolveSkills))
    .toBe("function");
  await page.evaluate(() => (window as any).__resolveSkills());
  await expect(page.locator(".lumir-hp-skill-menu [role=option]")).toHaveCount(30);
  await walkAndAssert(page, 30, "异步目录");
});

test("静止指针停在候选列表上：键盘导航逐拍仍可见且不被指针抢走", async ({ page }) => {
  await setup(page, realisticSkills(30));
  await page.keyboard.type("/");
  const menu = page.locator(".lumir-hp-skill-menu");
  await expect(menu.locator("[role=option]")).toHaveCount(30);
  // 指针停在候选列表中部（真实用户用键盘滚动时指针常落在浮层上）。
  const box = await menu.boundingBox();
  if (box === null) throw new Error("候选没有盒");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await walkAndAssert(page, 30, "指针停在候选上");
});

test("窄 harness pane（真机 20% 形态）+ 短窗口：候选盒不越出面板且逐拍可见", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 682 });
  await setup(page, realisticSkills(12));
  // 真机现场：harness pane 约 180 CSS px。分隔条比例的作用点是挂载元素的 inline flexGrow
  // （`applySplitRatio`），这里用同一机制把 harness 侧压到 ~17%，比拖拽稳定。
  await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".lumir-harness");
    const mount = panel?.parentElement;
    if (mount === null || mount === undefined) throw new Error("找不到 harness 挂载元素");
    for (const sibling of Array.from(mount.parentElement!.children)) {
      if (sibling !== mount) (sibling as HTMLElement).style.flexGrow = "1";
    }
    mount.style.flexGrow = "0.2";
  });
  await page.waitForTimeout(50);
  const panelBox = await page.locator(".lumir-harness").boundingBox();
  if (panelBox === null) throw new Error("面板不在场");
  expect(panelBox.width, `harness pane 必须真的变窄（实际 ${panelBox.width}px）`).toBeLessThan(320);
  await page.locator(".lumir-hp-composer .cm-content").click();
  await page.mouse.move(10, 10);
  await page.keyboard.type("/");
  await expect(page.locator(".lumir-hp-skill-menu [role=option]")).toHaveCount(12);
  await walkAndAssert(page, 12, "窄 pane 1200x682");
});

test("窗口收缩重排：原本完整可见的游标被新几何挤出时必须补揭示", async ({ page }) => {
  await setup(page, realisticSkills(30));
  await page.mouse.move(10, 10);
  await page.keyboard.type("/");
  await expect(page.locator(".lumir-hp-skill-menu [role=option]")).toHaveCount(30);
  for (let step = 0; step < 10; step += 1) await page.keyboard.press("Control+n");
  const before = await navSnapshot(page);
  expect(before.selected, "收缩前必须已在第 10 项").toBe(10);
  expect(before.rows[10].bottom, "收缩前游标必须完整可见")
    .toBeLessThanOrEqual(before.bandBottom + 0.5);
  // 只改几何、不按任何键：面板 / 视口收缩后候选重排（`reclampOpenOverlays` → if-clipped）。
  await page.setViewportSize({ width: 1200, height: 520 });
  await page.waitForTimeout(120);
  const after = await navSnapshot(page);
  const detail = describeState(after, "收缩后");
  expect(after.menuBottom, `收缩后候选盒底不得越出面板（${detail}）`)
    .toBeLessThanOrEqual(after.panelBottom + 0.5);
  expect(after.selected, `收缩不得改动游标（${detail}）`).toBe(10);
  expect(after.rows[10].top, `收缩后游标上缘必须仍在带内（${detail}）`)
    .toBeGreaterThanOrEqual(after.bandTop - 1);
  expect(after.rows[10].bottom, `收缩后游标下缘必须仍在带内（${detail}）`)
    .toBeLessThanOrEqual(after.bandBottom + 1);
});
