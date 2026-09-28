import { expect, test, type Page } from "@playwright/test";
import { configGets, stubTauri } from "./tauri-stub";
import type { VaultFixture } from "./tauri-stub";
import { expectScreenshot } from "./expect-screenshot";
import { GOTO_LINE_LABEL, GOTO_LINE_PLACEHOLDER, gotoLineTotalText } from "../../../src/goto-line";

// M281（change goto-line-command）的键位链路 / 浮层形态 / md 常驻行号 gutter 三层回归。
//
// 本层的分工（别与另外两层重复，也别留缺口）：
//   - `tests/unit/goto-line.test.ts`：`resolveGotoLine` 的输入矩阵与文案常量（纯函数层）。
//   - `tests/unit/keys.test.ts`：表的不变量与 `[keys]` 重绑（表层）。
//   - 本场景：**键位链路 + DOM 形态 + 实测几何**——真 CM view + 真实 DOM KeyboardEvent
//     （`page.keyboard.press("Alt+g")`）→ keys.ts 的分发器 → 命令 → 输入条；以及 md 的常驻
//     行号 gutter（正文列仍居中、行号贴正文列左缘、纵向对准、窄窗不被裁）。
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

/** 把附件字节接上（桩不路由 `fs_read_attachment`）。 */
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
  await expect(gotoInput(page)).toHaveAttribute("aria-label", GOTO_LINE_LABEL);
  await expect(gotoInput(page)).toHaveAttribute("placeholder", GOTO_LINE_PLACEHOLDER);
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
  await expect.poll(async () => Math.abs(await lineCenterOffset(page, 37))).toBeLessThan(30);
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
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
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
// md 行号 gutter（D4 二次改判的三档：on-demand 默认 / always / off）
// ---------------------------------------------------------------------------
//
// 口径与配置链路见 openspec/changes/goto-line-command/ 的 design §5.1 与
// docs/specs/config-reference.md §1.3。本文件的覆盖分工（别与另两层重复，也别留缺口）：
//   - 在场时机：三档各自的行为 + 输入条四条收起路径（Enter / Escape / ⌃G / focusout）都卸除；
//   - 几何：贴正文列左缘、正文列居中、窄窗不裁、纵向对准——在 `always` 档下判（常驻形态是
//     几何压力面）；`on-demand` 档下同一套几何在输入条打开期间成立，故几何用例跑 `always`；
//   - **开关不跳动**：装 / 卸 gutter 那一瞬正文列几何逐值不变（宽窗与窄窗各一次）；
//   - 缺号边界（frontmatter 恒缺）与 code 模式形态不变各一条；
//   - 整页基线两条：`m281-md-gutter.png` 是 **always 档**的常驻形态、`m281-goto-prompt.png`
//     是 **on-demand 档**输入条打开态（两张都属本 change 的新场景基线）。

/** 正文列（`.cm-content`）的实测 rect——「开关 gutter 不改变正文列几何」的判据来源。 */
async function contentBox(page: Page): Promise<Box> {
  return (await readGutter(page)).content;
}

/** 只取「正文列在哪、多宽」三个量：开关 gutter 时这三个必须逐值不变（高度受视口影响，不参与）。 */
function columnShape(box: Box): { left: number; right: number; width: number } {
  return { left: box.left, right: box.right, width: box.width };
}

test("md 行号 gutter（默认 on-demand）：打开时不在场、输入条在场时装上、四条收起路径都卸除", async ({ page }) => {
  await openFile(
    page,
    { "gutter.md": GUTTER_DOC, "assets/pic.svg": IMAGE_SVG },
    "gutter.md",
    { links: IMAGE_LINKS },
    IMAGE_SVG,
  );
  await expect(page.locator(".cm-lp-image img")).toHaveCount(1);

  // ① 打开文档：没有行号列（默认档的「markdown 默认不显示」）
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  await focusLine(page, 3);

  // ② 打开输入条：行号列出现，且行号 = 源文档逻辑行号（与 `always` 档同一套编号）
  await page.keyboard.press("Alt+g");
  await expect(gotoBox(page)).toBeVisible();
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  expect((await readGutter(page)).numbers.map((n) => Number(n.text))).toEqual([1, 3, 5, 7, 9, 11]);

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

test("md 行号 gutter（always 档）：常驻在场，输入条开 / 关不改它在场", async ({ page }) => {
  await openFile(page, { "gutter.md": GUTTER_DOC }, "gutter.md", {
    config: { markdown_line_numbers: "always" },
  });
  // 常驻口径：不按任何命令，打开即可见
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();

  await focusLine(page, 3);
  await page.keyboard.press("Alt+g");
  await expect(gotoBox(page)).toBeVisible();
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(gotoBox(page)).toBeHidden();
  // 输入条收起后仍在场（档位固定 ⇒ 与输入条状态无关）
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
});

test("md 行号 gutter（off 档）：任何时刻都不在场，输入条打开时也没有；跳转照常工作", async ({ page }) => {
  await openFile(page, { "gutter.md": GUTTER_DOC }, "gutter.md", {
    config: { markdown_line_numbers: "off" },
  });
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);

  await focusLine(page, 3);
  await page.keyboard.press("Alt+g");
  await expect(gotoBox(page)).toBeVisible();
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);

  // 档位只管可见面，不改命令语义：跳转仍然落在第 9 行行首
  await page.keyboard.type("9");
  await page.keyboard.press("Enter");
  expect(await caretLine(page)).toBe(9);
});

test("开关不跳动：on-demand 档下装 / 卸 gutter 不改变正文列几何（1200px 与 640px 两档）", async ({ page }) => {
  await openFile(page, { "long.md": LONG_DOC }, "long.md");
  await focusLine(page, 5);

  for (const width of [1200, 640]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
    const before = columnShape(await contentBox(page));

    await page.keyboard.press("Alt+g");
    await expect(page.locator(".cm-lineNumbers")).toBeVisible();
    const during = columnShape(await contentBox(page));
    // 装 gutter 的那一瞬：正文列的 left / right / width 逐值不变（判据是实测 rect）
    expect(during, `${width}px 装 gutter 时正文列动了`).toEqual(before);

    await page.keyboard.press("Escape");
    await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
    const after = columnShape(await contentBox(page));
    // 卸 gutter 后回到原位
    expect(after, `${width}px 卸 gutter 后正文列没回原位`).toEqual(before);
  }
  await page.setViewportSize({ width: 1200, height: 800 });
});

test("md 行号 gutter 的几何（always 档常驻）：行号 = 源行号、贴正文列左缘、正文列仍居中、窄窗不被裁", async ({ page }) => {
  await openFile(
    page,
    { "gutter.md": GUTTER_DOC, "assets/pic.svg": IMAGE_SVG },
    "gutter.md",
    { config: { markdown_line_numbers: "always" }, links: IMAGE_LINKS },
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
  // ③ 行的编号 = 源文档逻辑行号（顺序即源行号序，空分隔行与 0 高元素已滤掉）。
  expect(wide.numbers.map((n) => Number(n.text))).toEqual([1, 3, 5, 7, 9, 11]);

  // ④ 纵向对准（md 的新压力面）：行号元素顶 = 该行行块顶——覆盖标题行 / 表格 widget 的两类行
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
  expect(narrow.numbers.map((n) => Number(n.text))).toEqual([1, 3, 5, 7, 9, 11]);
  for (const n of narrow.numbers) {
    expect(n.textLeft).toBeGreaterThanOrEqual(narrow.scroller.left - 0.5);
    expect(n.textRight).toBeLessThanOrEqual(narrow.content.left + 0.5);
    expect(n.textRight - n.textLeft).toBeGreaterThan(6);
  }
  expect(Math.abs(narrow.content.left - narrow.scroller.left - (narrow.scroller.right - narrow.content.right))).toBeLessThan(1);
  await page.setViewportSize({ width: 1200, height: 800 });
});

test("md gutter 的已知边界：frontmatter 覆盖的源行没有行号（always 档）", async ({ page }) => {
  await openFile(page, { "fm.md": FM_DOC }, "fm.md", {
    config: { markdown_line_numbers: "always" },
  });
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  const reading = await readGutter(page);
  // frontmatter 恒是块级 replace widget ⇒ 它覆盖的源行（1..4）没有行号（`doc.lines` = 8：
  // 标题在第 6 行、正文在第 8 行；5 / 7 是空行 ⇒ 0 高的行号元素已被滤掉）。
  expect(reading.numbers.map((n) => Number(n.text))).toEqual([6, 8]);
  // fm 覆盖的 1..4 逐条缺席（不是「数字恰好对」而是「那几行根本没有行号」）。
  for (const covered of [1, 2, 3, 4]) {
    expect(reading.numbers.map((n) => Number(n.text)), `第 ${covered} 行不该有行号`).not.toContain(covered);
  }
});

test("code 模式的 gutter 形态逐值不变（md 的规则与档位 MUST NOT 外溢）", async ({ page }) => {
  await openFile(page, { "code.ts": CODE_DOC }, "code.ts");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  const reading = await readGutter(page);
  // code 侧保持既有形态：`--frame` 底（非透明）+ 贴列左端（justify-self: start）+ 行号 1..3。
  // 右缘分隔线在两种模式下都不画（`src/editor.ts` 的 base 规则被同层级的 `.cm-gutters-before`
  // 规则关掉，本次不动它）——md 侧的规则显式写 `border: none` 是同一结果的另一条路。
  expect(reading.gutterStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(reading.gutterStyle.borderRightStyle).toBe("none");
  expect(reading.gutter?.left ?? -1).toBeLessThanOrEqual(reading.scroller.left + 0.5);
  expect(reading.numbers.map((n) => Number(n.text))).toEqual([1, 2, 3]);
});

// ---------------------------------------------------------------------------
// 整页基线（本 change 自己新增的两张场景基线；默认档下既有基线逐张不变，因此这里只留
// 本 change 引入的两种形态。MUST NOT 顺手动既有基线。）
// ---------------------------------------------------------------------------

test("整页基线：always 档的常驻 md 行号 gutter", async ({ page }) => {
  await openFile(
    page,
    { "gutter.md": GUTTER_DOC, "assets/pic.svg": IMAGE_SVG },
    "gutter.md",
    { config: { markdown_line_numbers: "always" }, links: IMAGE_LINKS },
    IMAGE_SVG,
  );
  await expect(page.locator(".cm-lp-image img")).toHaveCount(1);
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await page.locator(".cm-content").click({ position: { x: 40, y: 4 } });
  await expectScreenshot(page, "m281-md-gutter.png");
});

test("整页基线：on-demand 档（默认）的跳转输入条打开态", async ({ page }) => {
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
  // 这一屏同时含两件新东西：浮层输入条（本 change 的交互面）与它带出来的行号列（默认档）。
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await expectScreenshot(page, "m281-goto-prompt.png");
});
