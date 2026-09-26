// M240 表格放大全屏查看（change table-fullscreen-view）：打开 / 四条关闭路径 / 不穿透 /
// 快照保真 / 降级表无入口 / 宽表滚动 / 静止态零足迹。对应 tasks.md 的 5.1–5.6 与 2.3。
//
// 判据纪律（REVIEW.md 第 1、2 条）：
//   - 「遮罩可见」不靠 class 存在或 `hidden` 属性，靠**渲染几何**（快照盒宽高非零）与
//     **AX 锚点**（role=dialog + aria-label）两条一起钉：M178 的陷阱是「AX 文本可读 ≠ 元素可见」。
//   - 每条负向断言都配一条同场景正观测（降级表无遮罩 ↔ 正常表有遮罩；窄表不滚 ↔ 宽表滚）。
//   - 焦点归属一律读 `document.activeElement`，不靠假设；「关闭后焦点回编辑器」用**行为判据**
//     （⌃D 真删掉一个字符、⌘Z 复位），不用布尔口。
//
// 触发走 [keys] 配置绑定（D3 裁决：命令默认不绑键，用户经配置绑；表格 hover 触发钮是另一条
// 入口，单独一条用例覆盖）——与真机场景 40 同一条路径，两侧可逐条对照。

import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubTauri, configGets } from "./tauri-stub";
import { readDocument } from "./parity-checks";

const fixtureDir = new URL("../fixtures/table-fullscreen/", import.meta.url);
const SOURCE = readFileSync(new URL("scene.md", fixtureDir), "utf8");
const SVG = readFileSync(new URL("../fixtures/markdown-combo/sample.svg", import.meta.url), "utf8");
const DOC = "scene.md";

/** 触发键：本 change 的命令默认不绑键（D3），场景经 [keys] 绑一个空位组合。 */
const TRIGGER_KEY = "Cmd-j";
const TRIGGER_PRESS = "Meta+j";

type CmView = {
  state: { doc: { toString(): string; length: number }; selection: { main: { head: number; anchor: number } } };
  dispatch(spec: { selection?: { anchor: number } }): void;
  focus(): void;
  contentDOM: HTMLElement;
};

async function openDoc(page: Page): Promise<void> {
  await stubTauri(page, {
    entries: [
      { path: DOC, kind: "file", size: SOURCE.length, mtime_ms: 0 },
      { path: "assets/sample.svg", kind: "file", size: SVG.length, mtime_ms: 0 },
    ],
    files: { [DOC]: SOURCE, "assets/sample.svg": SVG },
    config: { keys: { [TRIGGER_KEY]: "table.toggle-fullscreen" } },
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${DOC}"]`).click();
  // 三张表：正常表 + 宽表渲染为 grid，非矩形表整块回退（无 .cm-lp-table）。
  await expect(page.locator(".cm-lp-table")).toHaveCount(2);
  // [keys] 覆盖在 config_get 之后才挂上分发器（m132 的时序口径）：等它到位再按键。
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await expect(page.locator(".modeline-path")).toHaveText(DOC);
  await page.waitForTimeout(80);
}

/** 把 caret 放到 fixture 里第一处 `needle` 上（找不到即抛，防 fixture 改名后静默空跑）。 */
async function caretAt(page: Page, needle: string, offset = 0): Promise<number> {
  const pos = await page.evaluate(
    ({ needle, offset }) => {
      const el = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: CmView } } };
      const text = el.cmTile.root.view.state.doc.toString();
      const at = text.indexOf(needle);
      if (at < 0) throw new Error(`fixture 里找不到 ${needle}`);
      return at + offset;
    },
    { needle, offset },
  );
  await page.evaluate((p) => {
    const el = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: CmView } } };
    const view = el.cmTile.root.view;
    view.dispatch({ selection: { anchor: p } });
    view.focus();
  }, pos);
  return pos;
}

function caretHead(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: CmView } } };
    return el.cmTile.root.view.state.selection.main.head;
  });
}

const overlay = (page: Page): Locator => page.locator(".lumir-table-fs-overlay");
const trigger = (page: Page): Locator => page.locator(".lumir-table-fs-trigger").first();

/** 遮罩的渲染读数：节点数 / 可见性 / 读屏名 / 快照盒几何 / 壳的滚动读数。 */
function overlayReading(page: Page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll(".lumir-table-fs-overlay");
    const el = nodes[0] as HTMLElement | undefined;
    const snapshot = el?.querySelector<HTMLElement>(".lumir-table-fs-snapshot") ?? null;
    const clone = snapshot?.firstElementChild as HTMLElement | null | undefined;
    const panel = el?.querySelector<HTMLElement>(".lumir-table-fs-panel") ?? null;
    const box = clone?.getBoundingClientRect();
    return {
      count: nodes.length,
      visible: el !== undefined && !el.hidden,
      role: el?.getAttribute("role") ?? null,
      ariaModal: el?.getAttribute("aria-modal") ?? null,
      label: el?.getAttribute("aria-label") ?? null,
      roleOfClone: clone?.getAttribute("role") ?? null,
      cloneWidth: box?.width ?? 0,
      cloneHeight: box?.height ?? 0,
      copyCount: snapshot?.children.length ?? 0,
      panelClientWidth: panel?.clientWidth ?? 0,
      panelScrollWidth: panel?.scrollWidth ?? 0,
      panelScrollLeft: panel?.scrollLeft ?? 0,
      focusedInside: el !== undefined && el.contains(document.activeElement),
    };
  });
}

/** 表格可视盒（含与不含触发钮两态对比用）。 */
function tableBox(page: Page, index = 0) {
  return page.evaluate((i) => {
    const scroll = document.querySelectorAll(".cm-lp-table-scroll")[i] as HTMLElement;
    const slot = scroll.parentElement as HTMLElement;
    const rect = scroll.getBoundingClientRect();
    return { slotClass: slot.className, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }, index);
}

test("5.1 打开：遮罩惰性建立、快照几何非零、读屏名在场、焦点在遮罩", async ({ page }) => {
  await openDoc(page);

  // 2.3 / spec「文档打开路径零新增」：未触发时 DOM 里没有遮罩节点。
  expect(await overlay(page).count()).toBe(0);

  await caretAt(page, "| 甲 |");
  await page.keyboard.press(TRIGGER_PRESS);

  const reading = await overlayReading(page);
  expect(reading.count).toBe(1);
  expect(reading.visible).toBe(true);
  expect(reading.role).toBe("dialog");
  expect(reading.ariaModal).toBe("true");
  // 读屏名复用表格容器既有的 `Markdown 表格 N`（同一来源，零新字面量）。
  expect(reading.label).toBe("Markdown 表格 1");
  expect(reading.roleOfClone).toBe("table");
  // 渲染几何非零 + 只装一份快照（AX 文本可读 ≠ 元素可见，两条一起钉）。
  expect(reading.cloneWidth).toBeGreaterThan(100);
  expect(reading.cloneHeight).toBeGreaterThan(10);
  expect(reading.copyCount).toBe(1);
  expect(reading.focusedInside).toBe(true);
});

test("5.1b 触发钮：hover 才出现（静止态不可见、不占位），点击打开遮罩", async ({ page }) => {
  await openDoc(page);
  const before = await tableBox(page);

  // 静止态：钮在 DOM 里（装饰层的结构事实），但不可见、不进读屏树、不改动几何。
  expect(await trigger(page).count()).toBe(1);
  expect(await trigger(page).evaluate((el) => getComputedStyle(el).visibility)).toBe("hidden");
  expect(await trigger(page).evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
  const resting = await tableBox(page);
  expect(resting.width).toBeCloseTo(before.width, 1);
  expect(resting.height).toBeCloseTo(before.height, 1);

  // hover 表格可视盒即浮现；钮钉在容器坐标系（表格右上角内侧 6px）。
  await page.hover(".cm-lp-table-slot");
  await expect.poll(() => trigger(page).evaluate((el) => getComputedStyle(el).visibility)).toBe("visible");
  const placed = await page.evaluate(() => {
    const button = document.querySelector(".lumir-table-fs-trigger") as HTMLElement;
    const slot = button.closest(".cm-lp-table-slot") as HTMLElement;
    const b = button.getBoundingClientRect();
    const s = slot.getBoundingClientRect();
    return { right: s.right - b.right, top: b.top - s.top, width: b.width, height: b.height };
  });
  expect(placed.right).toBeCloseTo(6, 0);
  expect(placed.top).toBeCloseTo(6, 0);
  expect(placed.width).toBeCloseTo(26, 0);
  expect(placed.height).toBeCloseTo(24, 0);

  // 钮不参与布局：浮现前后表格盒子逐值不变（静止态零足迹的结构判据）。
  const hovering = await tableBox(page);
  expect(hovering.width).toBeCloseTo(resting.width, 1);
  expect(hovering.height).toBeCloseTo(resting.height, 1);

  // 鼠标入口：点钮打开遮罩（D3 双入口的第二条）。
  await page.mouse.move(0, 0); // 先把指针挪开，避免 hover 态影响后续读数
  await page.hover(".cm-lp-table-slot");
  await trigger(page).click();
  const reading = await overlayReading(page);
  expect(reading.visible).toBe(true);
  expect(reading.label).toBe("Markdown 表格 1");
});

test("5.6 宽表在遮罩内横向可滚；窄表不出现滚动条", async ({ page }) => {
  await openDoc(page);

  // 宽表（第二张）：caret 进表 → 打开 → 壳内横向可滚。
  await caretAt(page, "| Deep Work |", 3);
  await page.keyboard.press(TRIGGER_PRESS);
  const wide = await overlayReading(page);
  expect(wide.visible).toBe(true);
  expect(wide.label).toBe("Markdown 表格 2");
  expect(wide.panelScrollWidth).toBeGreaterThan(wide.panelClientWidth);
  await page.evaluate(() => {
    const panel = document.querySelector(".lumir-table-fs-panel") as HTMLElement;
    panel.scrollLeft = 400;
  });
  const scrolled = await overlayReading(page);
  expect(scrolled.panelScrollLeft).toBeGreaterThan(0);
  await page.keyboard.press("Escape");

  // 窄表（第一张）：不缩放也不产生滚动条。
  await caretAt(page, "| 甲 |");
  await page.keyboard.press(TRIGGER_PRESS);
  const narrow = await overlayReading(page);
  expect(narrow.visible).toBe(true);
  expect(narrow.panelScrollWidth).toBeLessThanOrEqual(narrow.panelClientWidth + 1);
  // 快照按自然尺寸呈现（不被壳宽压缩）：克隆宽 >= 文档内 grid 的宽 - 1。
  const sourceWidth = await page.evaluate(() => document.querySelectorAll(".cm-lp-table")[0].getBoundingClientRect().width);
  expect(narrow.cloneWidth).toBeGreaterThanOrEqual(sourceWidth - 1);
});

test("5.4 快照保真：文本逐字节一致、inline 形态保留、计算样式与文档内表格一致", async ({ page }) => {
  await openDoc(page);
  await caretAt(page, "| 甲 |");
  await page.keyboard.press(TRIGGER_PRESS);
  await expect(overlay(page)).toBeVisible();

  const fidelity = await page.evaluate(() => {
    const doc = document.querySelectorAll(".cm-content .cm-lp-table")[0] as HTMLElement;
    const clone = document.querySelector(".lumir-table-fs-snapshot")!.firstElementChild as HTMLElement;
    const props = ["fontFamily", "fontSize", "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "color", "backgroundColor", "borderRadius"] as const;
    const pick = (el: Element | null) => {
      if (el === null) return null;
      const cs = getComputedStyle(el);
      return Object.fromEntries(props.map((p) => [p, cs[p]]));
    };
    // inline 形态的渲染类（不是标签名：链接与行内代码在本仓渲染成 span，不是 <a>/<code>）。
    const forms = [".cm-lp-inline-code", ".cm-lp-link", ".cm-lp-link-mark", ".cm-lp-image", "img:not(.cm-widgetBuffer)"];
    return {
      docText: doc.textContent,
      cloneText: clone.textContent,
      formCounts: Object.fromEntries(
        forms.map((sel) => [sel, { doc: doc.querySelectorAll(sel).length, clone: clone.querySelectorAll(sel).length }]),
      ),
      docBuffer: doc.querySelectorAll("img.cm-widgetBuffer").length,
      cloneBuffer: clone.querySelectorAll("img.cm-widgetBuffer").length,
      docTrigger: doc.querySelectorAll(".lumir-table-fs-trigger").length,
      cloneTrigger: clone.querySelectorAll(".lumir-table-fs-trigger").length,
      docCellStyle: pick(doc.querySelector(".cm-lp-table-cell")),
      cloneCellStyle: pick(clone.querySelector(".cm-lp-table-cell")),
      // 行内形态自身的计算样式（主题 scope 镜像的判据：CM 主题规则 scope 到编辑器根，
      // 不镜像时行内代码会退回 sans / 13.5px，列宽跟着短一截）。
      docInlineCodeStyle: pick(doc.querySelector(".cm-lp-inline-code")),
      cloneInlineCodeStyle: pick(clone.querySelector(".cm-lp-inline-code")),
      docLinkStyle: pick(doc.querySelector(".cm-lp-link")),
      cloneLinkStyle: pick(clone.querySelector(".cm-lp-link")),
      docRows: doc.querySelectorAll(".cm-lp-table-row").length,
      cloneRows: clone.querySelectorAll(".cm-lp-table-row").length,
      cloneSnapshotClasses: document.querySelector(".lumir-table-fs-snapshot")!.className,
    };
  });

  // 文本逐字节一致（可见文本，含表头与所有 cell）。
  expect(fidelity.cloneText).toBe(fidelity.docText);
  // inline 形态**成对**保留：每种形态在克隆里的数量与源表逐类相同（行内代码 / 链接标记 /
  // 图片 widget；本仓的 cell 图片引用今天不是 widget 渲染，计数为 0 时两边同为 0——
  // 断言形态是「克隆不改变渲染形态」，不预设某一种形态一定在场）。
  for (const [sel, counts] of Object.entries(fidelity.formCounts)) {
    expect(counts.clone, sel).toBe(counts.doc);
  }
  expect(fidelity.formCounts[".cm-lp-inline-code"].doc).toBeGreaterThan(0);
  expect(fidelity.formCounts[".cm-lp-link"].doc).toBeGreaterThan(0);
  // 行数一致 + 克隆卫生（CM 运行态残留与触发钮都不进快照）。
  expect(fidelity.cloneRows).toBe(fidelity.docRows);
  expect(fidelity.docBuffer).toBeGreaterThan(0);
  expect(fidelity.cloneBuffer).toBe(0);
  expect(fidelity.cloneTrigger).toBe(0);
  // 计算样式对照：cell 与 inline 形态各自逐项相同（容器补齐 + 主题 scope 镜像）。
  expect(fidelity.cloneCellStyle).toEqual(fidelity.docCellStyle);
  expect(fidelity.cloneInlineCodeStyle).toEqual(fidelity.docInlineCodeStyle);
  expect(fidelity.cloneLinkStyle).toEqual(fidelity.docLinkStyle);
  // 镜像的是 scope 类（非 cm- 前缀的生成类），容器自己的类保留。
  expect(fidelity.cloneSnapshotClasses).toContain("lumir-table-fs-snapshot");
  expect(fidelity.cloneSnapshotClasses.split(/\s+/).filter((c) => !c.startsWith("cm-") && c !== "lumir-table-fs-snapshot").length).toBeGreaterThan(0);
});

test("5.2 三条关闭路径各自独立 + 关闭后焦点真的回到编辑器（行为判据）", async ({ page }) => {
  await openDoc(page);
  const original = await readDocument(page);
  await caretAt(page, "| 甲 |");
  const caret = await caretHead(page);

  const closed = async (label: string) => {
    await expect(overlay(page)).toBeHidden();
    expect((await overlayReading(page)).visible, label).toBe(false);
    // 行为判据：焦点真的在编辑器里 —— ⌃D 删掉 caret 后一个字符，⌘Z 复位。
    await page.keyboard.press("Control+d");
    await expect.poll(() => readDocument(page)).not.toBe(original);
    const afterDelete = await readDocument(page);
    expect(afterDelete.length, label).toBe(original.length - 1);
    await page.keyboard.press("Meta+z");
    await expect.poll(() => readDocument(page)).toBe(original);
    expect(await caretHead(page), label).toBe(caret);
  };

  // ① Esc（遮罩上就地消费）
  await page.keyboard.press(TRIGGER_PRESS);
  await expect(overlay(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await closed("Esc");

  // ② 点击遮罩（面板以外的区域）
  await caretAt(page, "| 甲 |");
  await page.keyboard.press(TRIGGER_PRESS);
  await expect(overlay(page)).toBeVisible();
  await page.mouse.click(4, 4);
  await closed("点击遮罩");

  // ③ 再执行一次同一命令（toggle）
  await caretAt(page, "| 甲 |");
  await page.keyboard.press(TRIGGER_PRESS);
  await expect(overlay(page)).toBeVisible();
  await page.keyboard.press(TRIGGER_PRESS);
  await closed("toggle");
});

test("5.3 遮罩持焦期间不穿透不动文档；关闭后文档与 caret 逐值不变", async ({ page }) => {
  await openDoc(page);
  const original = await readDocument(page);
  const caret = await caretAt(page, "| 甲 |");
  await page.keyboard.press(TRIGGER_PRESS);
  await expect(overlay(page)).toBeVisible();

  for (const key of ["Control+d", "Control+k", "Control+a", "Tab", "x", "a"]) {
    await page.keyboard.press(key);
  }
  const during = await overlayReading(page);
  expect(during.visible).toBe(true);
  expect(during.focusedInside).toBe(true);
  expect(await readDocument(page)).toBe(original);
  expect(await caretHead(page)).toBe(caret);

  await page.keyboard.press("Escape");
  await expect(overlay(page)).toBeHidden();
  expect(await readDocument(page)).toBe(original);
  expect(await readDocument(page)).toBe(SOURCE);
  expect(await caretHead(page)).toBe(caret);
});

test("5.5 降级表（非矩形）无入口；正常表有（配对正观测）", async ({ page }) => {
  await openDoc(page);

  // 负向：caret 落在非矩形表的源码里（整块降级，没有 grid DOM）。
  const caret = await caretAt(page, "| one | two | three |", 3);
  await page.keyboard.press(TRIGGER_PRESS);
  const degraded = await overlayReading(page);
  expect(degraded.count).toBe(0);
  expect(degraded.visible).toBe(false);
  // 事件未被消费 ⇒ 文档与 caret 逐值不变（不是「没反应」的空转）。
  expect(await readDocument(page)).toBe(SOURCE);
  expect(await caretHead(page)).toBe(caret);

  // 正观测：同文档里正常表命中（保证上面那条不是恒真）。
  await caretAt(page, "| 甲 |");
  await page.keyboard.press(TRIGGER_PRESS);
  const normal = await overlayReading(page);
  expect(normal.visible).toBe(true);
  expect(normal.label).toBe("Markdown 表格 1");

  // 焦点兜底（第四条路径）：把焦点移出遮罩即关闭且不抢焦点。
  await page.evaluate(() => (document.querySelector(".cm-content") as HTMLElement).focus());
  await expect(overlay(page)).toBeHidden();
});

test("5.6b 容器持焦时命中（命中条件 ③），caret 不在表内也能打开", async ({ page }) => {
  await openDoc(page);
  // 把 caret 放到表外的段落（命中条件 ② 为假）。
  await caretAt(page, "前段落", 1);
  await page.locator(".cm-lp-table-scroll").first().evaluate((el) => (el as HTMLElement).focus());
  expect(await page.evaluate(() => document.activeElement?.className ?? "")).toContain("cm-lp-table-scroll");

  await page.keyboard.press(TRIGGER_PRESS);
  const reading = await overlayReading(page);
  expect(reading.visible).toBe(true);
  expect(reading.label).toBe("Markdown 表格 1");

  // 焦点兜底断言：blur 关闭且不抢焦点（焦点去向由「谁抢走」决定）。
  await page.evaluate(() => (document.querySelector(".cm-content") as HTMLElement).focus());
  await expect(overlay(page)).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.className ?? "")).toContain("cm-content");
});

test("观感截图：遮罩在三主题下的样子（供 Alex 过目，不进基线）", async ({ page }) => {
  const dir = process.env.LUMIR_TABLE_FS_SHOT_DIR;
  test.skip(dir === undefined, "未设 LUMIR_TABLE_FS_SHOT_DIR：观感截图是证据产出，不进门禁");
  await openDoc(page);
  await caretAt(page, "| Deep Work |", 3);
  await page.keyboard.press(TRIGGER_PRESS);
  await expect(overlay(page)).toBeVisible();
  for (const theme of ["light", "dark", "eink"]) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.waitForTimeout(80);
    await page.screenshot({ path: `${dir}/overlay-wide-${theme}.png` });
  }
  // 触发钮的浮现态（hover 时机）也留一张：静止态零足迹，只有 hover 帧有钮。
  await page.keyboard.press("Escape");
  await page.hover(".cm-lp-table-slot");
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${dir}/trigger-hover-light.png` });
});
