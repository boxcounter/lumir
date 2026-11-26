import { expect, test, type Page } from "@playwright/test";
import { configApplied, stubTauri } from "./tauri-stub";
import type { VaultFixture } from "./tauri-stub";
import { expectScreenshot } from "./expect-screenshot";
import { SCROLL_SETTLE_TIMEOUT } from "./poll-budgets";
import { GOTO_LINE_LABEL, GOTO_LINE_PLACEHOLDER, gotoLineTotalText } from "../../../src/goto-line";

// M281（change goto-line-command）的键位链路 / 浮层形态 / md 行号 gutter 三层回归。
//
// 本层的分工（别与另外两层重复，也别留缺口）：
//   - `tests/unit/goto-line.test.ts`：`resolveGotoLine` 的输入矩阵与文案常量（纯函数层）。
//   - `tests/unit/keys.test.ts`：表的不变量与 `[keys]` 重绑（表层）。
//   - 本场景：**键位链路 + DOM 形态 + 实测几何**——真 CM view + 真实 DOM KeyboardEvent
//     （`page.keyboard.press("Alt+g")`）→ keys.ts 的分发器 → 命令 → 输入条；以及行号 gutter
//     的全局开关（两档 + 跳转临时档，见下方「行号 gutter 的全局开关」分节头；
//     正文列仍居中、行号贴正文列左缘、纵向对准、窄窗不被裁）。
//   - `scripts/acceptance/scenarios/56-goto-line.md`：真机 WKWebView 上的同一链路 + 零写盘。
//
// 判据一律落在**实测 rect**（不用 CSS 声明值）与 CM 文档状态上：`.cm-scroller` 的列模板 /
// gutter 的 justify-self 这类改动只有实测几何看得见（口径同 tests/visual/README.md）。
//
// **已知边界（实测记录，MUST NOT 当成 gutter 的缺陷回头修，见 change design §1.4）**：
// md 的行若含 **inline replace widget**（图片 / 行内公式），CM 的高度表把该行算成
// 「widget 的 border-box + 该行的文字盒高」，而浏览器把它们排进同一个行盒（两者重叠）——
// 于是 CM 的模型比 DOM 实际高出一个文字盒（实测：320×120 的图片行 165.5 vs DOM 147.5，Δ18），
// 该行**之后**的行号随之整体低 18px。**这不是本 change 引入的**：同一次测量在改动前的构建上
// 逐值相同（无 gutter 时 CM 的行块高度同样是 165.5、`contentHeight` 同样多 18px），
// gutter 只是把 CM 自己的模型差**显形**了。修它要动 livePreview 的 widget 形态或 CM 的
// 高度模型（另一件事），故本场景的纵向对准断言覆盖**不受该差值影响的行**，
// 并把「图片行之后的行号会低一个文字盒」如实记在这里 + 落 finding，不写成断言假冻结。

/** 撑起滚动区域的 md 长文（跳到远处的行才有可判的滚动位移）。 */
const LONG_DOC = `${Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 段的填充内容，用来撑起滚动区域。`).join("\n\n")}\n`;

const IMAGE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect width="320" height="120" fill="#b8b8b8"/></svg>';

/** gutter 场景文档：**无 frontmatter**（doc-title 因此落在 `.cm-scroller` 顶、正文整体下移
 *  一行——正是「行号必须与正文同行」的那条 grid 压力），三类压力行都在：
 *  1 标题（字大）/ 5 表格首行 / 7 表格数据行（表格 widget 的 source 行）/ 9 表格 widget
 *  之后那一段 / 11 图片行。图片放在**最后**：它之后没有再断言的行（见文件头的已知边界）。 */
const GUTTER_DOC = `# 行号从 1 开始

第一段正文，用来给行号一个普通的行高。

| 名称 | 状态 |
| --- | --- |
| 行号 | 有号 |

表格之后的正文（表格 widget 行高不匀，行号必须跟上）。

![[pic.svg]]
`;

/** frontmatter 的已知边界（D4 的 delta ⑤）：被块级 replace widget 覆盖的源行**没有行号**
 *  ——frontmatter 区块恒缺（表格不属于这一类：它的 source 行仍是真行，见上面的场景文档）。 */
const FM_DOC = `---
title: 行号边界
tags: [probe]
---

# 标题

正文。
`;

const CODE_DOC = "const alpha = 1;\nconst bravo = 2;\nconst charlie = 3;";

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface GutterReading {
  scroller: Box;
  content: Box;
  gutter: Box | null;
  gutterStyle: { backgroundColor: string; borderRightWidth: string; borderRightStyle: string; color: string };
  /** 可见行号（高度 > 0；空的块分隔行拿到的是 0 高元素，文字被 `.cm-gutter` 的 overflow 裁掉）。 */
  numbers: Array<{ text: string; box: Box; textLeft: number; textRight: number }>;
  /** 全部行块（含表格 slot 内部的行），带源行号——纵向对准的配对基准。 */
  lines: Array<{ number: number; top: number; height: number }>;
}

/** 读一份 gutter 读数：容器 / 正文列 / 行号元素 / 行块的实测 rect（CSS 像素）。 */
async function readGutter(page: Page): Promise<GutterReading> {
  return page.evaluate(() => {
    const round = (n: number): number => Math.round(n * 100) / 100;
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return {
        left: round(r.left),
        right: round(r.right),
        top: round(r.top),
        bottom: round(r.bottom),
        width: round(r.width),
        height: round(r.height),
      };
    };
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    const content = document.querySelector(".cm-content") as HTMLElement;
    const gutters = document.querySelector(".cm-gutters") as HTMLElement | null;
    const numbers = [...document.querySelectorAll<HTMLElement>(".cm-lineNumbers .cm-gutterElement")]
      // CM 的占位 spacer 同样是 .cm-gutterElement（inline visibility: hidden）；高度 0 的元素是
      // 空的块分隔行（它的文字被 `.cm-gutter` 的 `overflow: hidden` 裁掉，肉眼不可见）。
      .filter((el) => getComputedStyle(el).visibility !== "hidden" && el.getBoundingClientRect().height > 0.5)
      .map((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          text: el.textContent ?? "",
          box: box(el),
          // 文字的可见范围 = 元素盒去掉左右内边距（CM 基础主题给的是 `0 3px 0 5px`）。
          // 「行号有没有被裁 / 有没有压住正文」判的是这一段。
          textLeft: round(rect.left + parseFloat(style.paddingLeft)),
          textRight: round(rect.right - parseFloat(style.paddingRight)),
        };
      });
    const lines = [...document.querySelectorAll<HTMLElement>(".cm-content .cm-line")].map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        number: view.state.doc.lineAt(view.posAtDOM(el, 0)).number as number,
        top: round(rect.top),
        height: round(rect.height),
      };
    });
    const gutterStyle = gutters
      ? {
          backgroundColor: getComputedStyle(gutters).backgroundColor,
          borderRightWidth: getComputedStyle(gutters).borderRightWidth,
          borderRightStyle: getComputedStyle(gutters).borderRightStyle,
          color: getComputedStyle(gutters).color,
        }
      : { backgroundColor: "", borderRightWidth: "", borderRightStyle: "", color: "" };
    return {
      scroller: box(scroller),
      content: box(content),
      gutter: gutters ? box(gutters) : null,
      gutterStyle,
      numbers,
      lines,
    };
  });
}

/** 打开一个 fixture 文件（装载 vault → 点树行）。`attachment` 给出时把 `fs_read_attachment`
 *  接上（**必须在 stubTauri 之后注册**：init script 按注册顺序执行，桩要先建出
 *  `__TAURI_INTERNALS__`），图片行因此有真实高度可判纵向对准。 */
async function openFile(
  page: Page,
  files: Record<string, string>,
  name: string,
  extra: Partial<VaultFixture> = {},
  attachment?: string,
): Promise<void> {
  await stubTauri(page, {
    entries: Object.keys(files).map((path) => ({ path, kind: "file", size: files[path].length, mtime_ms: 0 })),
    files,
    ...extra,
  });
  if (attachment !== undefined) await stubAttachment(page, attachment);
  await page.goto("/");
  await page.locator(`.ft-row[title="${name}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(name);
}

/** 把附件字节接上（桩自 M629 起的缺省应答是合成 PNG；本场景要的是这一段 SVG 文本）。 */
async function stubAttachment(page: Page, svg: string): Promise<void> {
  await page.addInitScript((payload: string) => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => unknown } })
      .__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = async (command: string, argv: unknown) => {
      if (command !== "fs_read_attachment") return original(command, argv);
      const bytes = new TextEncoder().encode(payload);
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary);
    };
  }, svg);
}

/** 图片 fixture 的 links 桩（wikilink 形态的附件引用要它解析）。 */
const IMAGE_LINKS = {
  "![[pic.svg]]": {
    status: "resolved",
    path: "assets/pic.svg",
    candidates: [],
    embed_target: "attachment",
    anchor: { status: "none", heading: null, line: null },
  },
};

/** 光标放到第 `line` 行行首并聚焦（editor 作用域的键位要求事件目标在 contentDOM 内）。 */
async function focusLine(page: Page, line: number): Promise<void> {
  await page.locator(".cm-content").evaluate((el, n) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: view.state.doc.line(n).from } });
    view.focus();
  }, line);
  await expect
    .poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.className ?? ""))
    .toContain("cm-content");
}

/** 当前光标所在行号（「跳到了第几行」的判据取 CM 状态，不靠刻度线）。 */
async function caretLine(page: Page): Promise<number> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    return view.state.doc.lineAt(view.state.selection.main.head).number as number;
  });
}

/** 文档总行数（`共 M 行` 的 M）。 */
async function totalLines(page: Page): Promise<number> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    return view.state.doc.lines as number;
  });
}

/** 文档全文（跳转 MUST NOT 改文档）。 */
async function docText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    return view.state.doc.toString() as string;
  });
}

/** 第 `line` 行行首相对滚动容器中心的偏移（revealLine 的口径是 y:"center"）。 */
async function lineCenterOffset(page: Page, line: number): Promise<number> {
  return page.evaluate((n: number) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    const coords = view.coordsAtPos(view.state.doc.line(n).from);
    const scroller = view.scrollDOM.getBoundingClientRect();
    return coords ? (coords.top + coords.bottom) / 2 - (scroller.top + scroller.bottom) / 2 : Number.NaN;
  }, line);
}

async function activeClass(page: Page): Promise<string> {
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.className ?? "");
}

const gotoBox = (page: Page) => page.locator(".lumir-goto");
const gotoInput = (page: Page) => page.locator(".lumir-goto-input");
const gotoHint = (page: Page) => page.locator(".lumir-goto-hint");

// ---------------------------------------------------------------------------
// 输入条（D1/D2/D3 的交互面）
// ---------------------------------------------------------------------------

test("⌥G 打开输入条：预填当前行号 + 共 M 行 + 只收数字；Enter 跳到该行行首并滚到居中", async ({ page }) => {
  await openFile(page, { "long.md": LONG_DOC }, "long.md");
  await focusLine(page, 12);
  await expect(gotoBox(page)).toBeHidden(); // 常态 hidden（打开前）

  await page.keyboard.press("Alt+g");

  await expect(gotoBox(page)).toBeVisible();
  await expect(gotoInput(page)).toHaveValue("12"); // 预填 = 打开时的当前行号
  await expect(gotoHint(page)).toHaveText(gotoLineTotalText(await totalLines(page)));
  // 输入框的读屏名与占位常量的单一来源是 src/goto-line.ts（文案 deck D152 / D157）。
  await expect(gotoInput(page)).toHaveAttribute("aria-label", GOTO_LINE_LABEL());
  await expect(gotoInput(page)).toHaveAttribute("placeholder", GOTO_LINE_PLACEHOLDER());
  // 打开即全选：键入即替换（判据是「直接键入得到新值」而不是拼接）。
  await page.keyboard.type("37");
  await expect(gotoInput(page)).toHaveValue("37");

  // 只接受数字：字母 / 符号都不产生字符（输入串仍是原值）。
  await page.keyboard.type("a");
  await page.keyboard.type("-");
  await expect(gotoInput(page)).toHaveValue("37");

  const before = await docText(page);
  await page.keyboard.press("Enter");

  await expect(gotoBox(page)).toBeHidden();
  expect(await caretLine(page)).toBe(37);
  // 目标行滚到视口居中（revealLine 的 y:"center"；容差 30px 覆盖行高与滚动舍入）。
  // 滚动收敛类 poll，预算按全量负载档（M311）。
  await expect
    .poll(async () => Math.abs(await lineCenterOffset(page, 37)), { timeout: SCROLL_SETTLE_TIMEOUT })
    .toBeLessThan(30);
  // 焦点交还编辑器（后续按键落回文本上下文），文档零改动。
  await expect.poll(() => activeClass(page)).toContain("cm-content");
  expect(await docText(page)).toBe(before);
});

test("输入条：越界钳到末行、空输入停在当前行、取消路径不动光标、打开期间再按同键无操作", async ({ page }) => {
  await openFile(page, { "long.md": LONG_DOC }, "long.md");
  const total = await totalLines(page);
  await focusLine(page, 5);

  // 越界：9999 → 末行（静默钳制，零提示）。
  await page.keyboard.press("Alt+g");
  await page.keyboard.type("9999");
  await page.keyboard.press("Enter");
  expect(await caretLine(page)).toBe(total);

  // 空输入：清空后 Enter → 停在打开时的当前行（此处即末行）。
  await page.keyboard.press("Alt+g");
  await expect(gotoInput(page)).toHaveValue(String(total));
  await page.keyboard.press("Backspace"); // 打开即全选 ⇒ 一次退格即清空
  await expect(gotoInput(page)).toHaveValue("");
  await page.keyboard.press("Enter");
  expect(await caretLine(page)).toBe(total);

  // 打开期间再按同键：无操作、已输入内容不被清空、也没有 Alt 层字符（`©`）被打进输入框。
  await focusLine(page, 8);
  await page.keyboard.press("Alt+g");
  await page.keyboard.type("11");
  await page.keyboard.press("Alt+g");
  await expect(gotoBox(page)).toBeVisible();
  await expect(gotoInput(page)).toHaveValue("11");

  // Escape 取消：收起、光标与文档都不变。
  const caretBefore = await caretLine(page);
  const docBefore = await docText(page);
  await page.keyboard.press("Escape");
  await expect(gotoBox(page)).toBeHidden();
  expect(await caretLine(page)).toBe(caretBefore);
  expect(await docText(page)).toBe(docBefore);

  // ⌃G 取消：同一条路径。
  await page.keyboard.press("Alt+g");
  await expect(gotoBox(page)).toBeVisible();
  await page.keyboard.press("Control+g");
  await expect(gotoBox(page)).toBeHidden();
  expect(await caretLine(page)).toBe(caretBefore);

  // 点浮层之外（modeline 的路径段，非编辑器、非可聚焦元素）→ 收起且不跳转、光标不变。
  await page.keyboard.press("Alt+g");
  await page.keyboard.type("30");
  await expect(gotoBox(page)).toBeVisible();
  await page.locator(".modeline-path").click();
  await expect(gotoBox(page)).toBeHidden();
  expect(await caretLine(page)).toBe(caretBefore);
  expect(await docText(page)).toBe(docBefore);
});

test("输入条：[keys] 重绑 ⌃J 生效；切标签收起且不跳转", async ({ page }) => {
  await openFile(page, { "a.md": LONG_DOC, "b.md": "# 另一篇\n\n另一篇的正文。\n" }, "a.md", {
    config: { keys: { "Ctrl-j": "editor.goto-line" } },
  });
  await configApplied(page);
  await page.waitForTimeout(80); // [keys] 覆盖在 config_get 之后才重挂分发器
  await focusLine(page, 7);

  await page.keyboard.press("Control+j");
  await expect(gotoBox(page)).toBeVisible();
  await expect(gotoInput(page)).toHaveValue("7");
  await page.keyboard.press("Escape");
  await expect(gotoBox(page)).toBeHidden();

  // 开第二个标签（b.md），再切回 a.md：⌘1 / ⌘2 的落点是标签序号。
  await page.locator('.ft-row[title="b.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("b.md");
  await page.keyboard.press("Meta+1");
  await expect(page.locator(".modeline-path")).toHaveText("a.md");

  // 切标签期间输入条收起、**不跳转**。
  await focusLine(page, 7);
  await page.keyboard.press("Alt+g");
  await page.keyboard.type("40");
  await expect(gotoBox(page)).toBeVisible();
  await page.keyboard.press("Meta+2");
  await expect(gotoBox(page)).toBeHidden();
  await expect(page.locator(".modeline-path")).toHaveText("b.md");
  expect(await caretLine(page)).not.toBe(40);
  await page.keyboard.press("Meta+1");
  await expect(page.locator(".modeline-path")).toHaveText("a.md");
  expect(await caretLine(page)).toBe(7); // 被取消的落点没有留在会话上
});

// ---------------------------------------------------------------------------
// 行号 gutter 的全局开关（change global-line-numbers-toggle-nov23：两档 + 跳转临时档）
// ---------------------------------------------------------------------------
//
// 口径与配置链路见 openspec/changes/global-line-numbers-toggle-nov23/ 的 design §2 / §4 / §5 与
// docs/specs/config-reference.md §1.3。本文件的覆盖分工（别与另两层重复，也别留缺口）：
//   - 在场时机：两档各自的行为 + 输入条四条收起路径（Enter / Escape / ⌃G / focusout）都卸除；
//     两个模式（md / 只读 code）同一开关、同一判据；
//   - 切换入口：⌘⇧N 与 modeline 行号钮共用同一条实现（属性 / gutter / 钮文本 / 配置回写）；
//     非编辑器焦点（搜索框 / harness composer）下同样命中（作用域 global）；
//   - 交叉态两个方向（`on → ⌥G → 切 off`、`off → ⌥G → 切 on`）：`gotoGutterVisible` 的赋值
//     顺序是这两条成立的前提（design §4.2）；
//   - 几何：贴正文列左缘、正文列居中、窄窗不裁、纵向对准——在 `on` 档下判（常驻形态是
//     几何压力面）；**开关不跳动**：md 任意宽度与 code 宽窗的正文列 rect 逐值不变，code 窄窗
//     允许左移但 MUST NOT 横向滚动 / 裁切行号（design §10.1 的已知边界，不是缺陷）；
//   - 持久化：`__uiValueWrites` 断言每次切换恰一笔 `{key:"line_numbers"}`；写失败不回滚 +
//     toast；启动按 `ui.line_numbers` 施加；
//   - 整页基线两条：`m281-md-gutter.png` 是 **on 档**的常驻形态、`m281-goto-prompt.png`
//     是 **off 档（默认）**的输入条打开态（两张都属既有场景基线）。

/** 正文列（`.cm-content`）的实测 rect——「开关 gutter 不改变正文列几何」的判据来源。 */
async function contentBox(page: Page): Promise<Box> {
  return (await readGutter(page)).content;
}

/** 只取「正文列在哪、多宽」三个量：开关 gutter 时这三个必须逐值不变（高度受视口影响，不参与）。 */
function columnShape(box: Box): { left: number; right: number; width: number } {
  return { left: box.left, right: box.right, width: box.width };
}

/** `<html data-line-numbers>` 的当前值（未施加 = null）。 */
function htmlLineNumbers(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.dataset.lineNumbers ?? null);
}

/** 每个 pane 的行号 gutter 数量（双 pane 同步的判据：两栏都要有）。 */
function gutterCountsPerPane(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".editor-pane")].map(
      (pane) => pane.querySelectorAll(".cm-lineNumbers").length,
    ),
  );
}

/** `config_set_ui_value` 的写入序列（桩只记录，不解释）。 */
function uiValueWrites(page: Page): Promise<Array<{ key: string; value: unknown }>> {
  return page.evaluate(
    () => ((window as unknown as { __uiValueWrites?: Array<{ key: string; value: unknown }> })
      .__uiValueWrites ?? []),
  );
}

/** 元素的实测 rect（右段位移判据）。 */
async function rectOf(page: Page, selector: string): Promise<Box | null> {
  return page.locator(selector).evaluate((el) => {
    const round = (n: number): number => Math.round(n * 100) / 100;
    const r = el.getBoundingClientRect();
    return {
      left: round(r.left),
      right: round(r.right),
      top: round(r.top),
      bottom: round(r.bottom),
      width: round(r.width),
      height: round(r.height),
    };
  });
}

test("md 行号 gutter（默认 off）：打开时不在场、⌥G 临时装上、四条收起路径都卸除", async ({ page }) => {
  await openFile(
    page,
    { "gutter.md": GUTTER_DOC, "assets/pic.svg": IMAGE_SVG },
    "gutter.md",
    { links: IMAGE_LINKS },
    IMAGE_SVG,
  );
  await expect(page.locator(".cm-lp-image img")).toHaveCount(1);
  await expect(page.locator(".modeline-line-numbers")).toHaveText("off");

  // ① 打开文档：没有行号列（默认 off 的「两种模式都没有 gutter」）
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  await focusLine(page, 3);

  // ② 打开输入条：行号列临时出现，且行号 = 源文档逻辑行号（与 on 档同一套编号）
  await page.keyboard.press("Alt+g");
  await expect(gotoBox(page)).toBeVisible();
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  // 空行随 M399 恢复正常行高后同样编号（6 是表格分隔行——widget 内无对应渲染行，恒缺）
  expect((await readGutter(page)).numbers.map((n) => Number(n.text))).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]);

  // ③ Enter 确认（完成后隐藏）
  await page.keyboard.press("Enter");
  await expect(gotoBox(page)).toBeHidden();
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);

  // ④ Escape / ⑤ ⌃G 两条取消路径同样卸除
  await focusLine(page, 3);
  for (const key of ["Escape", "Control+g"]) {
    await page.keyboard.press("Alt+g");
    await expect(page.locator(".cm-lineNumbers")).toBeVisible();
    await page.keyboard.press(key);
    await expect(gotoBox(page)).toBeHidden();
    await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  }

  // ⑥ focusout 到浮层之外（点 modeline 的路径段）也卸除
  await page.keyboard.press("Alt+g");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await page.locator(".modeline-path").click();
  await expect(gotoBox(page)).toBeHidden();
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
});

test("⌘⇧N 与 modeline 钮：md / code 同步切换、属性与钮文本同源、切换即回写", async ({ page }) => {
  await openFile(page, { "doc.md": GUTTER_DOC, "code.ts": CODE_DOC }, "doc.md");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  await expect(page.locator(".modeline-line-numbers")).toHaveText("off");
  expect(await htmlLineNumbers(page)).toBe("off");

  // ① ⌘⇧N 从 off 切到 on：md 的 gutter 立即出现、属性与钮文本同步
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+Shift+N");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await expect(page.locator(".modeline-line-numbers")).toHaveText("on");
  expect(await htmlLineNumbers(page)).toBe("on");
  expect(await uiValueWrites(page)).toEqual([{ key: "line_numbers", value: "on" }]);

  // ② 同一个开关对 code 同样生效（切到 code 标签，gutter 从第一帧起就在）
  await page.locator('.ft-row[title="code.ts"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("code.ts");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  expect((await readGutter(page)).numbers.map((n) => Number(n.text))).toEqual([1, 2, 3]);

  // ③ 再按一次：两种模式同时消失、属性与钮文本回 off、写回同样一笔
  await page.keyboard.press("Meta+Shift+N");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  await expect(page.locator(".modeline-line-numbers")).toHaveText("off");
  expect(await htmlLineNumbers(page)).toBe("off");
  expect((await uiValueWrites(page)).at(-1)).toEqual({ key: "line_numbers", value: "off" });

  // ④ modeline 钮是同一条实现路径（点击 = 切换）
  await page.locator(".modeline-line-numbers").click();
  await expect(page.locator(".modeline-line-numbers")).toHaveText("on");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  expect((await uiValueWrites(page)).at(-1)).toEqual({ key: "line_numbers", value: "on" });
});

test("on 档：md 与 code 的 gutter 都常驻，输入条开 / 关不改变在场", async ({ page }) => {
  await openFile(page, { "gutter.md": GUTTER_DOC, "code.ts": CODE_DOC }, "gutter.md", {
    config: { line_numbers: "on" },
  });
  // 常驻口径：不按任何命令，打开即可见
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await expect(page.locator(".modeline-line-numbers")).toHaveText("on");

  await focusLine(page, 3);
  await page.keyboard.press("Alt+g");
  await expect(gotoBox(page)).toBeVisible();
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(gotoBox(page)).toBeHidden();
  // 输入条收起后仍在场（开关固定 ⇒ 与输入条状态无关）
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();

  await page.locator('.ft-row[title="code.ts"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("code.ts");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
});

test("off 档：⌥G 临时带出 gutter（md / code 一致），收起即卸除；跳转照常工作", async ({ page }) => {
  await openFile(page, { "gutter.md": GUTTER_DOC, "code.ts": CODE_DOC }, "gutter.md");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);

  await focusLine(page, 3);
  await page.keyboard.press("Alt+g");
  await expect(gotoBox(page)).toBeVisible();
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  // 开关只管可见面，不改命令语义：跳转仍然落在第 9 行行首
  await page.keyboard.type("9");
  await page.keyboard.press("Enter");
  expect(await caretLine(page)).toBe(9);
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);

  // code 同一口径：临时 gutter 出现、Escape 收起即卸除
  await page.locator('.ft-row[title="code.ts"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("code.ts");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Alt+g");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
});

test("交叉态（两个方向）：`on → ⌥G → 切 off` 收起后才消失；`off → ⌥G → 切 on` 收起后仍常驻", async ({ page }) => {
  // ① on 档：输入条打开期间切到 off —— 输入条还开着，gutter 必须仍在场
  await openFile(page, { "doc.md": GUTTER_DOC }, "doc.md", { config: { line_numbers: "on" } });
  await focusLine(page, 3);
  const before = await docText(page);
  await page.keyboard.press("Alt+g");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await page.keyboard.press("Meta+Shift+N");
  await expect(page.locator(".modeline-line-numbers")).toHaveText("off");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible(); // 输入条仍开着 ⇒ 临时在场
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  expect(await docText(page)).toBe(before);

  // ② off 档：输入条打开期间切到 on —— 收起输入条后 gutter 仍常驻（不因收起而消失）
  await openFile(page, { "doc.md": GUTTER_DOC }, "doc.md");
  await focusLine(page, 3);
  await page.keyboard.press("Alt+g");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await page.keyboard.press("Meta+Shift+N");
  await expect(page.locator(".modeline-line-numbers")).toHaveText("on");
  await page.keyboard.press("Escape");
  await expect(gotoBox(page)).toBeHidden();
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
});

test("开关不跳动：md 1200 / 640 切 on / off 正文列 rect 逐值不变", async ({ page }) => {
  await openFile(page, { "long.md": LONG_DOC }, "long.md");
  await focusLine(page, 5);

  for (const width of [1200, 640]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
    const off = columnShape(await contentBox(page));

    await page.keyboard.press("Meta+Shift+N");
    await expect(page.locator(".cm-lineNumbers")).toBeVisible();
    const on = columnShape(await contentBox(page));
    // 装上 gutter 的那一瞬：正文列的 left / right / width 逐值不变（判据是实测 rect）
    expect(on, `${width}px 装 gutter 时正文列动了`).toEqual(off);

    await page.keyboard.press("Meta+Shift+N");
    await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
    const backOff = columnShape(await contentBox(page));
    expect(backOff, `${width}px 卸 gutter 后正文列没回原位`).toEqual(off);
  }
  await page.setViewportSize({ width: 1200, height: 800 });
});

test("code 的几何让位边界：1200 切 on / off 正文列逐值不变；640 无横滚、行号不裁切", async ({ page }) => {
  // 短行文档：code 模式默认不折行，长行本身就会撑出横向滚动（那是文档的，不是 gutter 的）。
  // 本用例判的是「gutter 有没有引入横向滚动」，因此用一份天然不需要横滚的短行文档。
  const codeDoc = `${Array.from({ length: 20 }, (_, i) => `const v${i + 1} = ${i + 1};`).join("\n")}\n`;
  await openFile(page, { "code.ts": codeDoc }, "code.ts");

  // 1200px：左侧余量的一半 ≥ gutter 自然宽 ⇒ 关 / 开 gutter 不移动正文
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  const wideOff = columnShape(await contentBox(page));
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+Shift+N");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  const wideOn = columnShape(await contentBox(page));
  expect(wideOn, "1200px 切 on 时 code 正文列动了").toEqual(wideOff);
  await page.keyboard.press("Meta+Shift+N");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  expect(columnShape(await contentBox(page))).toEqual(wideOff);

  // 640px（窄档）：正文列允许左移一个 gutter 宽，但 MUST NOT 横向滚动、MUST NOT 裁切行号，
  // 正文从 gutter 右缘起排（design §10.1 的已知边界）。
  await page.setViewportSize({ width: 640, height: 800 });
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+Shift+N");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  const narrow = await readGutter(page);
  const overflow = await page.locator(".cm-scroller").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, "code 窄窗出现横向滚动").toBeLessThanOrEqual(1);
  expect(narrow.gutter).not.toBeNull();
  expect(narrow.content.left).toBeGreaterThanOrEqual((narrow.gutter?.right ?? Number.POSITIVE_INFINITY) - 0.5);
  for (const n of narrow.numbers) {
    expect(n.textLeft).toBeGreaterThanOrEqual(narrow.scroller.left - 0.5);
    expect(n.textRight).toBeLessThanOrEqual(narrow.content.left + 0.5);
    expect(n.textRight - n.textLeft).toBeGreaterThan(6);
  }
  await page.setViewportSize({ width: 1200, height: 800 });
});

test("on 档的几何（常驻）：行号 = 源行号、贴正文列左缘、正文列仍居中、窄窗不被裁", async ({ page }) => {
  await openFile(
    page,
    { "gutter.md": GUTTER_DOC, "assets/pic.svg": IMAGE_SVG },
    "gutter.md",
    { config: { line_numbers: "on" }, links: IMAGE_LINKS },
    IMAGE_SVG,
  );
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await expect(page.locator(".cm-lp-image img")).toHaveCount(1);
  await expect(gotoBox(page)).toBeHidden();

  const wide = await readGutter(page);

  // ① 正文列仍居中（两侧空余等分）：gutter 只改左轨道里放什么，MUST NOT 改列宽。
  expect(Math.abs(wide.content.left - wide.scroller.left - (wide.scroller.right - wide.content.right))).toBeLessThan(1);
  // ② 行号贴正文列左缘（左轨道的右端）、不压住正文，也不被窗口左缘裁掉。
  expect(wide.gutter).not.toBeNull();
  expect(wide.content.left - (wide.gutter?.right ?? 0)).toBeLessThan(1);
  for (const n of wide.numbers) {
    expect(n.textRight).toBeLessThanOrEqual(wide.content.left + 0.5);
    expect(n.textLeft).toBeGreaterThanOrEqual(wide.scroller.left - 0.5);
  }
  // ③ 行的编号 = 源文档逻辑行号（顺序即源行号序；M399 起空行也是正常行、同样编号，
  //    6 是表格分隔行——widget 内无对应渲染行，恒缺）。
  expect(wide.numbers.map((n) => Number(n.text))).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]);

  // ④ 纵向对准（md 的压力面）：行号元素顶 = 该行行块顶——覆盖标题行 / 表格 widget 的两类行
  //    （首行与数据行，它们是 widget 内的真行）/ 表格 widget 之后那一段 / 图片行。
  //    配对成功同时证明「行号 = 源行号」（配错行会差一个行块高）。
  for (const lineNumber of [1, 5, 7, 9, 11]) {
    const line = wide.lines.find((l) => l.number === lineNumber && l.height > 0.5);
    const number = wide.numbers.find((n) => Number(n.text) === lineNumber);
    expect(line, `第 ${lineNumber} 行不在可见行块里（判据会落空）`).toBeDefined();
    expect(number, `第 ${lineNumber} 行没有行号元素`).toBeDefined();
    expect(Math.abs((number?.box.top ?? 0) - (line?.top ?? 0))).toBeLessThanOrEqual(1);
  }

  // ⑤ 当前行的行号有高亮，正文行不改底色（delta 的口径）：md 装 `highlightActiveLineGutter`、
  //    不装 `highlightActiveLine`——判据是「恰一个行号高亮元素 + 正文行高亮类**不在场**」。
  await page.locator(".cm-content").click({ position: { x: 40, y: 4 } });
  await expect(page.locator(".cm-activeLineGutter")).toHaveCount(1);
  await expect(page.locator(".cm-activeLine")).toHaveCount(0);

  // ⑥ 窄窗（640px）：行号文字仍完整可见（左缘不出窗、右缘不压正文、宽度非零），正文列仍居中。
  await page.setViewportSize({ width: 640, height: 800 });
  const narrow = await readGutter(page);
  expect(narrow.numbers.map((n) => Number(n.text))).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]);
  for (const n of narrow.numbers) {
    expect(n.textLeft).toBeGreaterThanOrEqual(narrow.scroller.left - 0.5);
    expect(n.textRight).toBeLessThanOrEqual(narrow.content.left + 0.5);
    expect(n.textRight - n.textLeft).toBeGreaterThan(6);
  }
  expect(Math.abs(narrow.content.left - narrow.scroller.left - (narrow.scroller.right - narrow.content.right))).toBeLessThan(1);
  await page.setViewportSize({ width: 1200, height: 800 });
});

test("md gutter 的已知边界：frontmatter 覆盖的源行没有行号（on 档）", async ({ page }) => {
  await openFile(page, { "fm.md": FM_DOC }, "fm.md", {
    config: { line_numbers: "on" },
  });
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  const reading = await readGutter(page);
  // frontmatter 恒是块级 replace widget ⇒ 它覆盖的源行（1..4）没有行号（`doc.lines` = 9：
  // 标题在第 6 行、正文在第 8 行；5 / 7 / 9 是空行——M399 起空行也是正常行、同样编号）。
  expect(reading.numbers.map((n) => Number(n.text))).toEqual([5, 6, 7, 8, 9]);
  // fm 覆盖的 1..4 逐条缺席（不是「数字恰好对」而是「那几行根本没有行号」）。
  for (const covered of [1, 2, 3, 4]) {
    expect(reading.numbers.map((n) => Number(n.text)), `第 ${covered} 行不该有行号`).not.toContain(covered);
  }
});

test("code 模式的 gutter 形态（on 档）：--frame 底、贴列左端、行号 1..3；off 档没有 gutter", async ({ page }) => {
  await openFile(page, { "code.ts": CODE_DOC }, "code.ts", { config: { line_numbers: "on" } });
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  const reading = await readGutter(page);
  // code 侧保持既有形态：`--frame` 底（非透明）+ 贴列左端（justify-self: start）+ 行号 1..3。
  // 右缘分隔线在两种模式下都不画（`src/editor.ts` 的 base 规则被同层级的 `.cm-gutters-before`
  // 规则关掉，本次不动它）——md 侧的规则显式写 `border: none` 是同一结果的另一条路。
  expect(reading.gutterStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(reading.gutterStyle.borderRightStyle).toBe("none");
  expect(reading.gutter?.left ?? -1).toBeLessThanOrEqual(reading.scroller.left + 0.5);
  expect(reading.numbers.map((n) => Number(n.text))).toEqual([1, 2, 3]);

  // 默认 off 时 code 同样没有 gutter（「code 恒常显」的例外已退场）
  await openFile(page, { "code.ts": CODE_DOC }, "code.ts");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
});

test("非编辑器焦点的 ⌘⇧N：搜索框与 harness composer 内同样命中（作用域 global）", async ({ page }) => {
  await openFile(page, { "doc.md": GUTTER_DOC }, "doc.md");

  // ① 搜索框（⌘F 打开后焦点在输入框里）
  await page.keyboard.press("Meta+f");
  await expect(page.locator(".lumir-search-input")).toBeFocused();
  await page.keyboard.press("Meta+Shift+N");
  await expect(page.locator(".modeline-line-numbers")).toHaveText("on");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await page.keyboard.press("Escape");

  // ② harness composer（⌘⇧A 打开侧栏后焦点进输入框）
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-hp-composer .cm-content")).toBeFocused();
  await page.keyboard.press("Meta+Shift+N");
  await expect(page.locator(".modeline-line-numbers")).toHaveText("off");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
});

test("后台标签同步：切走再切回时后台会话已是新态（不是切回时才补）", async ({ page }) => {
  await openFile(page, { "a.md": GUTTER_DOC, "b.md": "# Beta\n\nBeta 正文。\n" }, "a.md");
  // 第二个标签（b.md）留在后台，再回 a.md
  await page.locator('.ft-row[title="b.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("b.md");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  await page.keyboard.press("Meta+1");
  await expect(page.locator(".modeline-path")).toHaveText("a.md");

  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+Shift+N");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  // 切回后台标签：它经 `session.state.update` 重配过，切回即新态
  await page.keyboard.press("Meta+2");
  await expect(page.locator(".modeline-path")).toHaveText("b.md");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
});

test("双 pane 同步：两个 pane 的前台会话同时变化", async ({ page }) => {
  await openFile(
    page,
    { "a.md": GUTTER_DOC, "b.md": "# Beta\n\nBeta 正文。\n" },
    "a.md",
    { config: { keys: { F2: "pane.split" } } },
  );
  await configApplied(page);
  await page.waitForTimeout(80); // [keys] 覆盖在 config_get 之后才重挂分发器

  // 分栏：新 pane 是空文档；把焦点交给它并从树上打开 b.md
  await page.keyboard.press("F2");
  await expect(page.locator(".editor-pane")).toHaveCount(2);
  const rightPane = page.locator(".editor-pane").nth(1);
  // 空 pane 的水印层盖在编辑器之上（点击它 = 把焦点交给该 pane 的编辑器，见 src/main.ts 的
  // pane-empty-guide）；直接点 `.cm-content` 会被它拦住。
  await rightPane.locator(".pane-empty-guide").click();
  await page.locator('.ft-row[title="b.md"]').click();
  await expect(rightPane.locator(".cm-content")).toContainText("Beta 正文");
  expect(await gutterCountsPerPane(page)).toEqual([0, 0]); // 切换前两个 pane 都没有 gutter

  // 切换：两个 pane 的前台会话同时出现 gutter
  await page.keyboard.press("Meta+Shift+N");
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([1, 1]);
  await expect(page.locator(".modeline-line-numbers")).toHaveText("on");

  // 再切一次：两个 pane 同时消失
  await page.keyboard.press("Meta+Shift+N");
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([0, 0]);
});

test("新 pane：on 档空 pane 无 gutter，打开文档后两 pane 同帧恢复（change fix-no-tab-empty-state-nov27）", async ({ page }) => {
  await openFile(
    page,
    { "a.md": GUTTER_DOC, "b.md": "# Beta\n\nBeta 正文。\n" },
    "a.md",
    { config: { keys: { F2: "pane.split" } } },
  );
  await configApplied(page);
  await page.waitForTimeout(80);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+Shift+N");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();

  await page.keyboard.press("F2");
  await expect(page.locator(".editor-pane")).toHaveCount(2);
  // 新 pane 是空文档：on 档也不出行号（per-pane hasTabs 压过全局开关）。
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([1, 0]);
  // 打开带路径文档后，该 pane 在唯一同步点恢复 on 档 gutter；左 pane 不受影响。
  await page.locator('.ft-row[title="b.md"]').click();
  await expect(page.locator(".editor-pane").nth(1).locator(".cm-content")).toContainText("Beta 正文");
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([1, 1]);
});

test("写回失败不回滚：gutter 与钮保持新态、toast 说明重启回落、另记诊断日志", async ({ page }) => {
  await openFile(page, { "doc.md": GUTTER_DOC }, "doc.md", {
    failures: { config_set_ui_value: { code: "io_error", message: "磁盘只读" } },
  });
  const logsBefore = await page.evaluate(
    () => ((window as unknown as { __invokes?: string[] }).__invokes ?? []).filter((c) => c === "log_event").length,
  );

  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+Shift+N");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await expect(page.locator(".modeline-line-numbers")).toHaveText("on");
  expect(await htmlLineNumbers(page)).toBe("on");
  await expect(page.locator(".lumir-toast").filter({ hasText: "行号已切换" })).toHaveCount(1);
  await expect(page.locator(".lumir-toast").filter({ hasText: "磁盘只读" })).toHaveCount(1);
  // 诊断日志各一笔（config_warning 走 `log_event`）——失败不是静默的。
  await expect
    .poll(async () =>
      page.evaluate(
        () => ((window as unknown as { __invokes?: string[] }).__invokes ?? []).filter((c) => c === "log_event").length,
      ),
    )
    .toBeGreaterThan(logsBefore);
  // 再次切换照常工作
  await page.keyboard.press("Meta+Shift+N");
  await expect(page.locator(".modeline-line-numbers")).toHaveText("off");
});

test("启动按配置施加：ui.line_numbers = on 首帧即有 gutter，off 重新载入后即无", async ({ page }) => {
  // ① 配置 on：打开文件时 gutter 已在（启动装配经 applyLineNumbers 施加）
  await openFile(page, { "doc.md": GUTTER_DOC }, "doc.md", { config: { line_numbers: "on" } });
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await expect(page.locator(".modeline-line-numbers")).toHaveText("on");
  expect(await htmlLineNumbers(page)).toBe("on");

  // ② 桩重载（= 重启）后按配置而不是运行期态：这里换成默认 off 再载入一次
  await openFile(page, { "doc.md": GUTTER_DOC }, "doc.md");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  await expect(page.locator(".modeline-line-numbers")).toHaveText("off");
  expect(await htmlLineNumbers(page)).toBe("off");
});

test("非法值与旧键 warning 进 console（Rust 校验的取证面在 cargo test）", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
  await openFile(page, { "doc.md": GUTTER_DOC }, "doc.md", {
    config: {
      warnings: [
        '配置项 ui.line_numbers 取值 "toggle" 非法（可选：on、off），已回退为 off',
        "配置项 ui.markdown_line_numbers 已退场，取值被忽略（改用 ui.line_numbers：on / off）",
      ],
    },
  });
  // 快照的 warnings 逐条上 console（前端只透传；取值回落的判据在 cargo test 的
  // illegal_ui_line_numbers_warns_and_falls_back_to_off / retired_markdown_… 两条）。
  // 两条判据取互不重叠的子串：退场 warning 的正文里也提到 `ui.line_numbers`（「改用
  // ui.line_numbers」），只按键名数会出现 2 —— 那不是重复告警。
  await expect
    .poll(() => warnings.filter((text) => text.includes("ui.line_numbers") && text.includes("非法")).length)
    .toBe(1);
  await expect.poll(() => warnings.filter((text) => text.includes("已退场")).length).toBe(1);
  // 回落值是 off：两种模式都没有 gutter
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  await expect(page.locator(".modeline-line-numbers")).toHaveText("off");
});

test("施加前的行号钮：config_get 失败时保持 hidden（宁可不显示，也不显示未生效状态）", async ({ page }) => {
  await stubTauri(page, {
    entries: [{ path: "doc.md", kind: "file", size: GUTTER_DOC.length, mtime_ms: 0 }],
    files: { "doc.md": GUTTER_DOC },
    failures: { config_get: { code: "io_error", message: "配置读取失败" } },
  });
  await page.goto("/");
  // 先确认元素**在场**再判 hidden：`toBeHidden` 对不存在的元素同样通过，只判 hidden 会假绿。
  await expect(page.locator(".modeline-line-numbers")).toHaveCount(1);
  await expect(page.locator(".modeline-line-numbers")).toBeHidden();
  expect(await htmlLineNumbers(page)).toBeNull();
});

test("行号指示钮：三主题形态、on / off 等宽、右段其它元素不位移、520px 不溢出", async ({ page }) => {
  const shapes: Array<Record<string, string>> = [];
  for (const theme of ["light", "dark", "eink"] as const) {
    await openFile(page, { "doc.md": GUTTER_DOC }, "doc.md", { config: { theme } });
    const shape = await page.locator(".modeline-line-numbers").evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        borderRadius: style.borderRadius,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        marginLeft: style.marginLeft,
        borderColor: style.borderColor,
        backgroundColor: style.backgroundColor,
      };
    });
    shapes.push(shape);
    if (theme === "eink") {
      // eink 的 chip 描边化：边框取 `--border`（#000）、底色透明；线宽与内边距不变
      expect(shape.borderColor).toBe("rgb(0, 0, 0)");
      expect(shape.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    }
  }
  // 三档的字号 / 字重 / 圆角 / 内边距 / 左外边距逐项一致（同一套 pill 规则）
  for (const shape of shapes.slice(1)) {
    expect({
      fontSize: shape.fontSize,
      fontWeight: shape.fontWeight,
      borderRadius: shape.borderRadius,
      paddingLeft: shape.paddingLeft,
      paddingRight: shape.paddingRight,
      marginLeft: shape.marginLeft,
    }).toEqual({
      fontSize: shapes[0].fontSize,
      fontWeight: shapes[0].fontWeight,
      borderRadius: shapes[0].borderRadius,
      paddingLeft: shapes[0].paddingLeft,
      paddingRight: shapes[0].paddingRight,
      marginLeft: shapes[0].marginLeft,
    });
  }

  // 1200 / 520 两档：切换 on / off 不移动右段其它元素，钮自身两种读数等宽。
  await openFile(page, { "doc.md": GUTTER_DOC }, "doc.md");
  for (const width of [1200, 520]) {
    await page.setViewportSize({ width, height: 800 });
    // 版本号退让段随窗口宽度显隐（matchMedia 重排）：先等它到位再取基线 rect，
    // 否则「before」读到的是重排前的旧布局（那是窗口变化的位移，不是本钮的位移）。
    if (width === 520) await expect(page.locator(".modeline-version")).toBeVisible();
    else await expect(page.locator(".modeline-version")).toBeHidden();
    const selectors = [".modeline-meta", ".modeline-version", ".modeline-theme", ".modeline-language"];
    const before = await Promise.all(selectors.map((selector) => rectOf(page, selector)));
    const buttonOff = await rectOf(page, ".modeline-line-numbers");
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+Shift+N");
    await expect(page.locator(".modeline-line-numbers")).toHaveText("on");
    const after = await Promise.all(selectors.map((selector) => rectOf(page, selector)));
    expect(after, `${width}px 切换后右段其它元素位移了`).toEqual(before);
    const buttonOn = await rectOf(page, ".modeline-line-numbers");
    expect(buttonOn?.width, `${width}px 两种读数的钮宽不同`).toBe(buttonOff?.width);
    // 右缘不越出窗口：五段都在场且不越界
    for (const selector of [...selectors, ".modeline-line-numbers"]) {
      const box = await rectOf(page, selector);
      expect(box, `${width}px 读不到 ${selector}`).not.toBeNull();
      expect(box!.right).toBeLessThanOrEqual(width);
    }
    // 「在场且不互相遮挡」的独立判据（评审 P2-3）：只判右缘会让两段互相覆盖也 PASS。
    // 按 DOM 顺序取在场段的实测 rect——520px 必须五段全在，且后一段左缘不得压进前一段。
    const segments = await page.evaluate(() => {
      const right = document.querySelector(".modeline-right") as HTMLElement;
      const order = [
        ".modeline-meta",
        ".modeline-version",
        ".modeline-line-numbers",
        ".modeline-theme",
        ".modeline-language",
      ];
      const out: Array<{ selector: string; left: number; right: number }> = [];
      for (const selector of order) {
        const el = right.querySelector<HTMLElement>(selector);
        if (el === null) continue;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (style.display === "none" || el.hidden || rect.width <= 0) continue;
        out.push({ selector, left: rect.left, right: rect.right });
      }
      return out;
    });
    expect(segments.map((seg) => seg.selector), `${width}px 右段在场项`).toEqual(
      width === 520
        ? [
            ".modeline-meta",
            ".modeline-version",
            ".modeline-line-numbers",
            ".modeline-theme",
            ".modeline-language",
          ]
        : [".modeline-meta", ".modeline-line-numbers", ".modeline-theme", ".modeline-language"],
    );
    for (let i = 1; i < segments.length; i += 1) {
      expect(
        segments[i].left,
        `${width}px ${segments[i].selector} 压住了 ${segments[i - 1].selector}`,
      ).toBeGreaterThanOrEqual(segments[i - 1].right - 0.5);
    }
    await expect(page.locator(".modeline-theme")).toBeVisible();
    await expect(page.locator(".modeline-language")).toBeVisible();
    // 切回 off，让下一轮的起点一致（本用例的判据是「每次 off → on 的位移」，不是交替态）
    await page.keyboard.press("Meta+Shift+N");
    await expect(page.locator(".modeline-line-numbers")).toHaveText("off");
  }
  await page.setViewportSize({ width: 1200, height: 800 });
});

// ---------------------------------------------------------------------------
// 整页基线（本 change 引入的两种形态：on 档常驻 / off 档的输入条打开态）
// ---------------------------------------------------------------------------

test("整页基线：on 档的常驻 md 行号 gutter", async ({ page }) => {
  await openFile(
    page,
    { "gutter.md": GUTTER_DOC, "assets/pic.svg": IMAGE_SVG },
    "gutter.md",
    { config: { line_numbers: "on" }, links: IMAGE_LINKS },
    IMAGE_SVG,
  );
  await expect(page.locator(".cm-lp-image img")).toHaveCount(1);
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await page.locator(".cm-content").click({ position: { x: 40, y: 4 } });
  await expectScreenshot(page, "m281-md-gutter.png");
});

test("整页基线：off 档（默认）的跳转输入条打开态", async ({ page }) => {
  await openFile(
    page,
    { "gutter.md": GUTTER_DOC, "assets/pic.svg": IMAGE_SVG },
    "gutter.md",
    { links: IMAGE_LINKS },
    IMAGE_SVG,
  );
  await expect(page.locator(".cm-lp-image img")).toHaveCount(1);
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  await focusLine(page, 3);

  await page.keyboard.press("Alt+g");
  await expect(gotoBox(page)).toBeVisible();
  // 这一屏同时含两件东西：浮层输入条（M281 的交互面）与它带出来的行号列（off 档的临时档）。
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await expectScreenshot(page, "m281-goto-prompt.png");
});
