import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import type { VaultFixture } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M132 Emacs 键位包（档 1/2 编辑键 + kill/yank + 翻屏/重定位 + shift-extend + 轨道 D
// 的 widget 滚动键收编）的行为回归。
//
// 断言口径一律落在 CM 的文档源码与选区（readDocument / state 快照）——键位语义在源码层，
// 装饰层只是呈现。表格 cell 的边界纪律另以「管道符数量不变 + 表格仍是 grid」为准：跨过
// 隐藏管道符即破坏结构，破坏后 livePreview 会停止渲染 grid（可观测）。

interface Caret {
  head: number;
  anchor: number;
  from: number;
  to: number;
  empty: boolean;
  line: number;
  lineFrom: number;
  docLength: number;
}

async function caret(page: Page): Promise<Caret> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    const main = view.state.selection.main;
    const line = view.state.doc.lineAt(main.head);
    return {
      head: main.head,
      anchor: main.anchor,
      from: main.from,
      to: main.to,
      empty: main.empty,
      line: line.number,
      lineFrom: line.from,
      docLength: view.state.doc.length,
    };
  });
}

/** 落光标（并聚焦编辑器；键位分发要求事件目标在 contentDOM 内）。 */
async function setSelection(page: Page, anchor: number, head = anchor): Promise<void> {
  await page.evaluate(({ anchor: a, head: h }) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    view.dispatch({ selection: { anchor: a, head: h } });
    view.focus();
  }, { anchor, head });
}

async function openFile(
  page: Page,
  files: Record<string, string>,
  name: string,
  extra: Partial<VaultFixture> = {},
): Promise<void> {
  await stubTauri(page, {
    entries: Object.keys(files).map((path) => ({ path, kind: "file", size: files[path].length, mtime_ms: 0 })),
    files,
    ...extra,
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${name}"]`).click();
  await expect(page.locator(".masthead-file")).toHaveText(name);
}

const pipeCount = (text: string): number => (text.match(/\|/g) ?? []).length;

/** 撑起滚动区域的长文档（翻屏 / recenter 场景）。 */
const LONG_DOC = `${Array.from({ length: 200 }, (_, i) => `第 ${i + 1} 段：用于撑起滚动区域的填充内容。`).join("\n\n")}\n`;

const TABLE_DOC = "前言。\n\n| 名称 | 状态 |\n| --- | --- |\n| 表格 | 正常 |\n\n后记。\n";
/** 数据行的行首管道符位置（从文档派生，避免硬编码随 fixture 漂移）。 */
const ROW_START = TABLE_DOC.indexOf("| 表格");
// 该行源码：0="|" 1=" " 2="表" 3="格" 4=" " 5="|" 6=" " 7="正" 8="常" 9=" " 10="|"

const scroller = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector(".cm-scroller")!;
    return { scrollTop: el.scrollTop, clientHeight: el.clientHeight };
  });

test("⌃D 前删 / ⌃H 后删：字符级，有选区时删除选区", async ({ page }) => {
  const doc = "abcdef\n";
  await openFile(page, { "del.md": doc }, "del.md");

  await setSelection(page, 2); // b 与 c 之间
  await page.keyboard.press("Control+d");
  await expect.poll(() => readDocument(page)).toBe("abdef\n"); // 删掉 c
  await page.keyboard.press("Control+h");
  await expect.poll(() => readDocument(page)).toBe("adef\n"); // 再删掉光标前的 b

  // 选区形态：⌃D 删除整个选区（Emacs delete-active-region 口径）
  await setSelection(page, 1, 3); // "adef" 的 "de"
  await page.keyboard.press("Control+d");
  await expect.poll(() => readDocument(page)).toBe("af\n");
});

test("Alt-D 前删词 / ⌥⌫ 后删词：Emacs kill-word 口径（含跳过非词字符）", async ({ page }) => {
  const doc = "alpha beta gamma end\n";
  await openFile(page, { "word.md": doc }, "word.md");

  // M-d 从词中间杀到词尾：只杀掉该词剩余部分
  await setSelection(page, doc.indexOf("beta") + 2);
  await page.keyboard.press("Alt+d");
  await expect.poll(() => readDocument(page)).toBe("alpha be gamma end\n");

  // M-d 从空格处杀起：跳过非词字符、把下一个词一起杀（Emacs forward-word 口径）
  const second = "alpha be gamma end\n";
  await setSelection(page, second.indexOf(" "));
  await page.keyboard.press("Alt+d");
  await expect.poll(() => readDocument(page)).toBe("alpha gamma end\n");

  // M-DEL：杀回上一个词首（连同中间的空白）
  const third = "alpha gamma end\n";
  await setSelection(page, third.indexOf("gamma"));
  await page.keyboard.press("Alt+Backspace");
  await expect.poll(() => readDocument(page)).toBe("gamma end\n");
});

test("⌃T 转置：行中转置两侧字符并把光标移到两者之后；行尾转置前两个", async ({ page }) => {
  const doc = "abcd\n";
  await openFile(page, { "transpose.md": doc }, "transpose.md");

  await setSelection(page, 2); // b | c
  await page.keyboard.press("Control+t");
  await expect.poll(() => readDocument(page)).toBe("acbd\n");
  expect((await caret(page)).head, "Emacs C-t 把点移到转置后的两个字素之后").toBe(3);

  await setSelection(page, 4); // 行尾（行尾形态：转置前两个字素）
  await page.keyboard.press("Control+t");
  await expect.poll(() => readDocument(page)).toBe("acdb\n");
  expect((await caret(page)).head, "行尾形态光标原地").toBe(4);
});

test("⌃K kill 行：行尾连带换行、连续 kill 合并进同一槽，⌃Y 原样插回", async ({ page }) => {
  const doc = "one\ntwo\nthree\n";
  await openFile(page, { "kill.md": doc }, "kill.md");

  await setSelection(page, 0);
  await page.keyboard.press("Control+k");
  await expect.poll(() => readDocument(page)).toBe("\ntwo\nthree\n");

  // 已在行尾：连带杀掉换行（Emacs C-k 的第二形态）——两行合并
  await page.keyboard.press("Control+k");
  await expect.poll(() => readDocument(page)).toBe("two\nthree\n");

  // 连续两次 kill 合并进同一槽（"one" + "\n"），⌃Y 插回即完整还原
  await page.keyboard.press("Control+y");
  await expect.poll(() => readDocument(page)).toBe(doc);
  expect((await caret(page)).head, "yank 后光标落在插入内容之后").toBe(4);
});

test("后向连续 kill 合并：⌥⌫⌥⌫ 两次杀词进同一槽，⌃Y 一次插回两词（评审 r1 P2-1 回归）", async ({ page }) => {
  const doc = "alpha beta gamma end\n";
  await openFile(page, { "kill-word.md": doc }, "kill-word.md");

  // 光标在 gamma 之后：两次 ⌥⌫ 依次杀掉 "gamma" 与 " beta"（后向相接：光标停在 from）
  await setSelection(page, doc.indexOf("gamma") + "gamma".length);
  await page.keyboard.press("Alt+Backspace");
  await expect.poll(() => readDocument(page)).toBe("alpha beta  end\n");
  await page.keyboard.press("Alt+Backspace");
  await expect.poll(() => readDocument(page)).toBe("alpha  end\n");

  // 两次后向 kill 必须合并成一条（"beta gamma"）：⌃Y 一次插回即完整还原；
  // 若相接判定对后向失效，槽里只剩最后一次 kill（"beta "），插回后是 "alpha beta  end\n"
  await page.keyboard.press("Control+y");
  await expect.poll(() => readDocument(page)).toBe(doc);
});

test("⌃Y 在文档末尾插入：槽内容长于光标之后的剩余文档时不得抛错或静默失败（越界回归）", async ({ page }) => {
  const doc = "abcdefghij\nx\n";
  await openFile(page, { "yank-end.md": doc }, "yank-end.md");

  await setSelection(page, 0);
  await page.keyboard.press("Control+k");
  await expect.poll(() => readDocument(page)).toBe("\nx\n");
  await page.keyboard.press("Meta+z");
  await expect.poll(() => readDocument(page)).toBe(doc);

  // 光标在文档末尾 + 槽长 10 字符：插入目标位置越出当前文档长度。
  // 旧实现在此处按插入后的位置测量坐标（coordsAtPos → doc.lineAt 越界）抛 RangeError，
  // 命令无声失败——文档不变、也没有任何提示。
  await setSelection(page, doc.length);
  await page.keyboard.press("Control+y");
  await expect.poll(() => readDocument(page)).toBe(`${doc}abcdefghij`);
});

test("表格 cell 内 ⌃K 只 kill 到 cell 尾：管道符一个不少、表格仍是 grid", async ({ page }) => {
  await openFile(page, { "table.md": TABLE_DOC }, "table.md");
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);

  await setSelection(page, ROW_START + 2); // 首 cell 内容起点
  await page.keyboard.press("Control+k");
  await expect
    .poll(() => readDocument(page))
    .toBe(TABLE_DOC.replace("| 表格 | 正常 |", "| | 正常 |"));
  expect(pipeCount(await readDocument(page)), "管道符数量不变（结构未被破坏）").toBe(pipeCount(TABLE_DOC));
  // 结构完好 → livePreview 仍以 grid 呈现（破坏后会退回原始 Markdown 源码态）
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
});

test("表格 cell 边界：⌃D / ⌃H / ⌃K 不删隐藏管道符", async ({ page }) => {
  await openFile(page, { "table.md": TABLE_DOC }, "table.md");
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);

  // 末 cell 内容右缘：⌃D 无字符可删（下一个可见位置是隐藏管道符，MUST NOT 吞掉）
  await setSelection(page, ROW_START + 10);
  await page.keyboard.press("Control+d");
  await expect.poll(() => readDocument(page)).toBe(TABLE_DOC);
  await page.keyboard.press("Control+k");
  await expect.poll(() => readDocument(page)).toBe(TABLE_DOC);

  // 行首管道符与首个 cell 内容之间：⌃H 不动文档（管道符不可删）
  await setSelection(page, ROW_START + 1);
  await page.keyboard.press("Control+h");
  await expect.poll(() => readDocument(page)).toBe(TABLE_DOC);
  // cell 内含对齐空白：⌃H 只吃空白、不碰行首管道符
  await setSelection(page, ROW_START + 2);
  await page.keyboard.press("Control+h");
  await expect
    .poll(() => readDocument(page))
    .toBe(TABLE_DOC.replace("| 表格 | 正常 |", "|表格 | 正常 |"));
  expect(pipeCount(await readDocument(page))).toBe(pipeCount(TABLE_DOC));
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
});

test("⌃V / ⌥V 翻屏：视口移动一屏，光标不动", async ({ page }) => {
  await openFile(page, { "long.md": LONG_DOC }, "long.md");
  await setSelection(page, 0);
  const before = await scroller(page);
  expect(before.scrollTop).toBe(0);

  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await scroller(page)).scrollTop).toBeGreaterThan(before.clientHeight * 0.5);
  expect((await caret(page)).head, "翻屏不移动光标").toBe(0);

  await page.keyboard.press("Alt+v");
  await expect.poll(async () => (await scroller(page)).scrollTop).toBe(0);
  expect((await caret(page)).head).toBe(0);
});

test("⌃L recenter：把光标行滚到视口居中", async ({ page }) => {
  await openFile(page, { "long.md": LONG_DOC }, "long.md");
  await setSelection(page, LONG_DOC.indexOf("第 100 段"));
  // 先回到顶部，让 recenter 的效果可观测
  await page.evaluate(() => {
    document.querySelector(".cm-scroller")!.scrollTop = 0;
  });

  await page.keyboard.press("Control+l");
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
          .root.view;
        const scrollerEl = document.querySelector(".cm-scroller")!;
        const box = scrollerEl.getBoundingClientRect();
        const rect = view.coordsAtPos(view.state.selection.main.head, 1);
        return rect ? rect.top - box.top - scrollerEl.clientHeight / 2 : -9999;
      }),
    )
    .toBeLessThan(120);
  const offset = await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root
      .view;
    const scrollerEl = document.querySelector(".cm-scroller")!;
    const box = scrollerEl.getBoundingClientRect();
    const rect = view.coordsAtPos(view.state.selection.main.head, 1);
    return Math.abs(rect!.top - box.top - scrollerEl.clientHeight / 2);
  });
  expect(offset, "光标行应落在视口中央附近").toBeLessThan(120);
});

test("⌃G keyboard-quit：撤下进行中的选区（折叠为光标，不动文档）", async ({ page }) => {
  const doc = "abcdef\n";
  await openFile(page, { "quit.md": doc }, "quit.md");

  await setSelection(page, 1, 4);
  expect((await caret(page)).empty).toBe(false);
  await page.keyboard.press("Control+g");
  const after = await caret(page);
  expect(after.empty).toBe(true);
  expect(after.head).toBe(4);
  expect(await readDocument(page)).toBe(doc);
});

test("shift-extend：⌃⇧F/B/N/P/A/E 与 ⌥⇧F/B 扩选（anchor 保持，head 移动）", async ({ page }) => {
  const doc = "alpha beta gamma\nsecond line here\nthird line\n";
  await openFile(page, { "ext.md": doc }, "ext.md");

  // ⌃⇧F：逐字符向后扩
  await setSelection(page, 0);
  await page.keyboard.press("Control+Shift+f");
  let snap = await caret(page);
  expect([snap.anchor, snap.head, snap.empty]).toEqual([0, 1, false]);

  // ⌃⇧E：扩到行尾（落点口径同 ⌃E）
  await setSelection(page, 6);
  await page.keyboard.press("Control+Shift+e");
  snap = await caret(page);
  expect([snap.anchor, snap.head]).toEqual([6, doc.indexOf("\n")]);

  // ⌃⇧A：扩到行首（anchor 留在原地 → head < anchor）
  await setSelection(page, 6);
  await page.keyboard.press("Control+Shift+a");
  snap = await caret(page);
  expect([snap.anchor, snap.head]).toEqual([6, 0]);

  // ⌃⇧B：逐字符向前扩
  await setSelection(page, 6);
  await page.keyboard.press("Control+Shift+b");
  snap = await caret(page);
  expect([snap.anchor, snap.head]).toEqual([6, 5]);

  // ⌃⇧N / ⌃⇧P：逐行扩选（落点口径同 ⌃N / ⌃P）
  await setSelection(page, 0);
  await page.keyboard.press("Control+Shift+n");
  snap = await caret(page);
  expect([snap.anchor, snap.line]).toEqual([0, 2]);
  await page.keyboard.press("Control+Shift+n");
  expect((await caret(page)).line).toBe(3);
  await page.keyboard.press("Control+Shift+p");
  expect((await caret(page)).line).toBe(2);

  // ⌥⇧F：按词向后扩（Emacs forward-word 口径）；⌥⇧B：按词向前扩
  await setSelection(page, doc.indexOf("beta"));
  await page.keyboard.press("Alt+Shift+f");
  snap = await caret(page);
  expect([snap.anchor, snap.head]).toEqual([doc.indexOf("beta"), doc.indexOf("beta") + 4]);
  await setSelection(page, doc.indexOf("gamma"));
  await page.keyboard.press("Alt+Shift+b");
  snap = await caret(page);
  expect([snap.anchor, snap.head]).toEqual([doc.indexOf("gamma"), doc.indexOf("gamma") - 5]);
});

test("只读 code 模式：编辑键一律无事发生（非 md 只读不退让）", async ({ page }) => {
  const doc = "plain text file\nsecond line\n";
  await openFile(page, { "note.txt": doc }, "note.txt");

  await setSelection(page, 2);
  for (const key of ["Control+d", "Control+h", "Control+k", "Control+y", "Control+t", "Alt+d", "Alt+Backspace"]) {
    await page.keyboard.press(key);
  }
  await page.waitForTimeout(80);
  expect(await readDocument(page)).toBe(doc);
});

test("widget 滚动键走统一键位表；文本里的 ← 仍走原生 caret", async ({ page }) => {
  const cell = "abcdefghijklmnopqrstuvwxyz0123456789ABCD";
  const source = `| c1 | c2 | c3 | c4 | c5 | c6 |\n| --- | --- | --- | --- | --- | --- |\n| ${cell} | ${cell} | ${cell} | ${cell} | ${cell} | ${cell} |\n\n普通段落文本。\n`;
  await openFile(page, { "wide.md": source }, "wide.md");
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  const container = page.locator(".cm-lp-table-scroll").first();
  const scrollLeft = () => page.evaluate(() => document.querySelector(".cm-lp-table-scroll")!.scrollLeft);

  await container.focus();
  expect(await scrollLeft()).toBe(0);
  await page.keyboard.press("ArrowRight");
  await expect.poll(scrollLeft).toBeGreaterThan(0);
  expect(await scrollLeft(), "步进与原 livePreview 手柄一致（120px）").toBeLessThanOrEqual(121);
  await page.keyboard.press("Home");
  await expect.poll(scrollLeft).toBe(0);
  await page.keyboard.press("End");
  const atEnd = await page.evaluate(() => {
    const el = document.querySelector(".cm-lp-table-scroll")!;
    return { scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(atEnd.scrollLeft).toBeGreaterThan(0);
  // 滚到最右：可见右缘覆盖自然宽（scrollLeft 由浏览器钳到 scrollWidth - clientWidth）
  expect(atEnd.scrollLeft + atEnd.clientWidth).toBeGreaterThanOrEqual(atEnd.scrollWidth - 1);

  // Escape：焦点交还编辑器
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => document.activeElement?.className ?? "")).toContain("cm-content");

  // 文本上下文的 ←：绑定带 when 限定容器，事件不消费 → 走原生 caret，且不触发 widget 滚动
  const textPos = source.indexOf("普通段落") + 3;
  await setSelection(page, textPos);
  const scrollBefore = await scrollLeft();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await caret(page)).head).toBe(textPos - 1);
  expect(await scrollLeft(), "文本里的 ← 不得触发 widget 滚动").toBe(scrollBefore);
});
