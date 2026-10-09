// M399：空行渲染不变量与三个缺陷的端到端钉固（合同先行——本 spec 先行于修复落地）。
//
// 合同条款（openspec/specs/editor-live-preview/spec.md「空行渲染不变量」）：
// md live preview 下，任何**语法上属于正文顶层**的空行（trim 后为空、不含 frontmatter）SHALL
// 以正常正文行高渲染（与一条普通正文行等高，±1px），光标落在其上时 caret 坐标高度 SHALL 非零
//（光标可见）——含紧邻列表 / 标题 / 代码块 / callout 的空行、文档首尾的空行、连续空行。
// 缺陷史：cm-lp-block-separator 把空行压成 0 高（M218 间距模型的实现选择），导致「行首 Enter
// 看似无效 / 空列表项退出后行与光标消失 / 删 marker 后行消失」三连缺陷（命令层均正确）。
import { expect, test } from "@playwright/test";
import { stubTauri } from "./tauri-stub";

async function openDoc(page: import("@playwright/test").Page, source: string, name = "probe.md") {
  await stubTauri(page, { entries: [{ path: name, kind: "file", size: source.length, mtime_ms: 0 }], files: { [name]: source } });
  await page.goto("/");
  await page.locator(`.ft-row[title="${name}"]`).click();
  await expect(page.locator(".cm-content")).toBeAttached();
  await page.waitForTimeout(200);
}

interface LineInfo {
  text: string;
  classes: string;
  height: number;
  top: number;
}

async function lines(page: import("@playwright/test").Page): Promise<LineInfo[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".cm-content .cm-line")].map((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return { text: el.textContent ?? "", classes: el.className, height: (el as HTMLElement).offsetHeight, top: r.top };
    }),
  );
}

async function caret(page: import("@playwright/test").Page): Promise<{ head: number; height: number; top: number }> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const head: number = view.state.selection.main.head;
    const c = view.coordsAtPos(head);
    return { head, height: c ? c.bottom - c.top : 0, top: c?.top ?? -1 };
  });
}

async function docText(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    return view.state.doc.toString();
  });
}

// ---------------------------------------------------------------------------
// 不变量（属性级）：空行 × 上下文矩阵——任何上下文的顶层空行都以正常行高渲染
// ---------------------------------------------------------------------------

test("空行渲染不变量：段落间 / 列表后 / 标题后 / 代码块邻接 / 文档首尾 / 连续空行均为正常行高", async ({ page }) => {
  const source = [
    "# 标题", // 0
    "", // 1 空：标题后
    "正文一段。", // 2
    "", // 3 空：段落间
    "- 列表甲", // 4
    "- 列表乙", // 5
    "", // 6 空：列表后
    "```js", // 7
    "const x = 1;", // 8
    "```", // 9
    "", // 10 空：代码块后
    "正文二段。", // 11
    "", // 12 空：连续空行 1/2
    "", // 13 空：连续空行 2/2
    "收尾。", // 14
    "", // 15 空：文档末尾
  ].join("\n");
  await openDoc(page, source);
  const ls = await lines(page);
  // 基准「正常正文行高」：.cm-content 的计算行高（--lh-reading × 编辑器字号）——空行的
  // offsetHeight 应与它相等（±1px 取整容差）。caret 高度是字形度量（≠行高），不作基准。
  const normal = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector(".cm-content")!).lineHeight),
  );
  expect(normal, "基准行高应是非零真行高").toBeGreaterThan(15);
  const blankLines = ls.filter((l) => l.text.trim() === "");
  expect(blankLines.length, "fixture 应含 6 条空行（标题后/段落间/列表后/代码块后/连续×2/末尾，首部 fence 信息串行不在 DOM）").toBeGreaterThanOrEqual(6);
  for (const blank of blankLines) {
    expect(
      Math.abs(blank.height - normal),
      `空行（class=${blank.classes}）高度 ${blank.height}px 应等于正常行高 ${normal}px（±1px）`,
    ).toBeLessThanOrEqual(1);
  }

  // 光标落在空行上：caret 坐标高度非零且落在该行的几何范围内（光标可见）。
  const caretOnBlank = await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const doc: string = view.state.doc.toString();
    const pos = doc.indexOf("正文一段。") + "正文一段。".length + 1; // 段后空行的行首
    view.dispatch({ selection: { anchor: pos } });
    const c = view.coordsAtPos(pos);
    return { pos, height: c ? c.bottom - c.top : 0, top: c?.top ?? -1 };
  });
  await page.waitForTimeout(100);
  expect(caretOnBlank.height, "空行上的 caret 高度应非零").toBeGreaterThan(10);
});

// ---------------------------------------------------------------------------
// 问题 1：光标在有内容行的行首按 Enter——换行发生且新空行可见
// ---------------------------------------------------------------------------

test("P1：有内容行的行首 Enter——新空行以正常行高插入在该行之前，内容行下移一整行", async ({ page }) => {
  await openDoc(page, "hello world");
  await page.locator(".cm-line").first().click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Home");
  const before = await lines(page);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  expect(await docText(page)).toBe("\nhello world");
  const after = await lines(page);
  expect(after.length).toBe(2);
  expect(after[0].text).toBe("");
  const listLineNormal = after[1].height; // hello world 行（段末 padding 含在内，空行不含）
  expect(after[0].height, "新空行应可见（非 0 高）").toBeGreaterThan(15);
  // 内容行下移量 = 新空行高度（原 top + 空行高 = 新 top）
  expect(Math.abs(after[1].top - (before[0].top + after[0].height))).toBeLessThanOrEqual(1);
  void listLineNormal;
});

// ---------------------------------------------------------------------------
// 问题 2：空列表项上 Enter——去标记、行保留为可见空行、光标留在该行行首
// ---------------------------------------------------------------------------

test("P2：空列表项 Enter（三 item 的空第三项）——行保留且可见，光标在该行", async ({ page }) => {
  await openDoc(page, "- a\n- b\n- ");
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  expect(await docText(page)).toBe("- a\n- b\n");
  const ls = await lines(page);
  expect(ls.length).toBe(3);
  expect(ls[2].text).toBe("");
  expect(ls[2].height, "退出列表后的空行应可见").toBeGreaterThan(15);
  const c = await caret(page);
  expect(c.head, "光标应在文档末（空行行首 = 文件尾）").toBe(8);
  expect(c.height, "光标应可见（caret 高度非零）").toBeGreaterThan(15);
});

test("P2b：tight 两 item 列表的空第二项 Enter——按裁决去标记，MUST NOT 插空行变松", async ({ page }) => {
  await openDoc(page, "- a\n- ");
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  expect(await docText(page), "上游默认的「变松」分支（- a\\n\\n- ）不得再出现").toBe("- a\n");
  const c = await caret(page);
  expect(c.head).toBe(4); // 空行行首
  expect(c.height).toBeGreaterThan(15);
});

test("P2c：有序列表空项 Enter——去标记且前序编号不变", async ({ page }) => {
  await openDoc(page, "1. a\n2. ");
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  expect(await docText(page)).toBe("1. a\n");
});

// ---------------------------------------------------------------------------
// 问题 3：删掉空列表项的行首「-」——行保留为可见的普通空行，光标不消失
// ---------------------------------------------------------------------------

test("P3：删除空列表项的行首 marker 后，该行保留、可见、光标在场", async ({ page }) => {
  await openDoc(page, "- a\n- ");
  await page.locator(".cm-content").click();
  await page.keyboard.press("End"); // 光标到 '- ' 行尾
  await page.keyboard.press("Backspace"); // 删空格
  await page.keyboard.press("Backspace"); // 删 '-'
  await page.waitForTimeout(150);
  expect(await docText(page)).toBe("- a\n");
  const ls = await lines(page);
  expect(ls.length, "行 MUST 保留（普通空行）").toBe(2);
  expect(ls[1].height, "删除 marker 后的空行应可见").toBeGreaterThan(15);
  const c = await caret(page);
  expect(c.head).toBe(4);
  expect(c.height, "光标不得消失").toBeGreaterThan(15);
});
