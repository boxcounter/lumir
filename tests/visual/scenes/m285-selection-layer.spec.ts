import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M285：选区自绘（`drawSelection()`）——「选区可见范围 MUST 等于编辑器选区范围」的结构层判据。
//
// 缺陷（M273 survey 定位，全量报告 test-results/m277/findings.md）：md 的 live preview 在
// mouseup 解冻那一拍重建强调段（`**粗体**` 显露）的 DOM，WebKit 没有把重建出来的那段文字画进
// 选中层 ⇒ 选中跨粗体时粗体段没有选中底色（而复制内容是对的——复制走 CM 的 state，这条同时说明
// 「洞」不是「选区没覆盖」，是「没被画上」）。修法是给编辑器装 CM6 的 `drawSelection()`，
// 让选区与光标由编辑器自己的 state 画在 `.cm-selectionLayer` / `.cm-cursorLayer` 上。
//
// **为什么判据落在这里而不是像素**：chromium 的像素层对这条缺陷是**假绿**——survey 实测 4 条
// 交互路径 × 3 主题逐字符底色全绿（无头引擎在装饰重建后会立刻把原生选区同步到新建的文本节点）。
// 可判的是**绘制来源**这条结构事实：`.cm-selectionBackground` 由 CM 依 state + 布局算出，
// 于是本文件断言「逐字符的选区底色覆盖（几何层）= 选区范围」，不再依赖「原生选区的绘制与装饰
// 重建谁先谁后」那条同帧竞态。真机侧的像素判据在
// `scripts/acceptance/scenarios/64-*.md`（本缺陷的真机通道，chromium 判据不能替代它）。
//
// 反向对照（断言不许恒真，REVIEW.md 第 1 条）：
//   ① 空选区时不许有任何 `.cm-selectionBackground`——否则「覆盖」谓词会退化成「总有一层」；
//   ② 紧邻选区两端的字符**不得**被覆盖。
//
// 判据来源：`drawSelection` 的自绘几何（`rectanglesForRange`：跨块的选区在**开放端**取
// 内容元素的左/右内缘，因此跨行选区会把上一行的行尾空白也涂上——这正是「由 CM 画」的签名，
// 原生选区不会那样画）。本文件不断言这条几何细节，只断言覆盖关系。

const DOC = [
  "第一段普通文字，供选区外的对照读数用。",
  "",
  "第二段有 **P粗** 与 *P斜* 与 ~~P删~~ 与 `P码` 四种范围。",
  "",
  "末尾段，供跨行选区的落点用。",
  "",
].join("\n");

/** 打开 DOC 并等渲染态就位；主题由桩配置送达（真实配置通道，不是场景自己贴 `data-theme`）。 */
async function openDoc(page: Page, theme: "light" | "dark" | "eink" = "light"): Promise<void> {
  await stubTauri(page, {
    root: "/mock/vault",
    vault_id: "v1",
    files: { "e.md": DOC },
    entries: [{ path: "e.md", name: "e.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
    config: { theme },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="e.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段普通文字");
  await expect(page.locator(".cm-lp-strong").first()).toBeVisible();
}

/** 把光标挪到文档末尾（回到渲染态）：每次试验都从同一份渲染布局起步。 */
async function reset(page: Page): Promise<void> {
  await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  await page.waitForTimeout(60);
}

/** 程序化选区（覆盖范围的做法：光标落进范围即显露，与 user 拖拽后的终态等价）。 */
async function select(page: Page, from: number, to: number): Promise<void> {
  await page.evaluate(([a, b]) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.focus();
    view.dispatch({ selection: { anchor: a, head: b } });
  }, [from, to] as const);
  await page.waitForTimeout(80);
}

interface Coverage {
  /** 选区里的非空白字符中，中心点没有被任何 `.cm-selectionBackground` 覆盖的（0 = 全覆盖）。 */
  misses: string[];
  /** 紧邻选区两端、却被覆盖了的字符（0 = 不漏画）。 */
  leaks: string[];
  /** 当前绘制出来的选区底色矩形数（0 = 压根没画，M285 修前的形态）。 */
  rects: number;
  /** 选区的文档范围，供失败信息定位。 */
  from: number;
  to: number;
}

/** 逐字符覆盖读数：把「选中底色覆盖」这条判据变成可断言的结构事实。
 *
 *  判据是**字符格的中心点是否落在某个 `.cm-selectionBackground` 矩形内**——即 survey 的
 *  「逐字符底色」判据（每个字符取一点判它是不是被选中底色盖住），只是取点从像素层抬到几何层。
 *  零宽位置（被隐藏的定界符、折叠处）跳过：它们没有可判的字符格，硬判会在空输入上空转。 */
function coverage(page: Page): Promise<Coverage> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const rects = [...document.querySelectorAll(".cm-selectionBackground")].map((el) => el.getBoundingClientRect());
    const inside = (x: number, y: number) => rects.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
    const doc = view.state.doc;
    const sel = view.state.selection.main;
    const box = (pos: number) => {
      const a = view.coordsAtPos(pos);
      const b = view.coordsAtPos(pos + 1);
      if (!a || !b) throw new Error(`位置 ${pos} 不在渲染视口内（本场景的文档只有几行，出现即场景装置坏了）`);
      const x0 = Math.min(a.left, b.left);
      const x1 = Math.max(a.left, b.left);
      return { cx: (x0 + x1) / 2, cy: (a.top + a.bottom) / 2, width: x1 - x0 };
    };
    const probe = (pos: number): string | null => {
      const ch = doc.sliceString(pos, pos + 1);
      if (ch === "" || /\s/.test(ch)) return null; // 空白没有字形格可判
      const b = box(pos);
      if (b.width < 1) return null; // 零宽：被隐藏的定界符 / 折叠位置
      return inside(b.cx, b.cy) ? `${pos}:${ch}` : `-${pos}:${ch}`;
    };
    const misses: string[] = [];
    for (let pos = sel.from; pos < sel.to; pos++) {
      const r = probe(pos);
      if (r !== null && r.startsWith("-")) misses.push(r.slice(1));
    }
    const leaks: string[] = [];
    for (const pos of [sel.from - 1, sel.to]) {
      if (pos < 0 || pos >= doc.length) continue;
      const r = probe(pos);
      if (r !== null && !r.startsWith("-")) leaks.push(r);
    }
    return { misses, leaks, rects: rects.length, from: sel.from, to: sel.to };
  });
}

/** 范围的源码区间 + 渲染态文本（矩阵的每一格）。 */
interface SpanCase {
  id: string;
  text: string;
  raw: string;
}

const SPANS: SpanCase[] = [
  { id: "粗体", text: "P粗", raw: "**P粗**" },
  { id: "斜体", text: "P斜", raw: "*P斜*" },
  { id: "删除线", text: "P删", raw: "~~P删~~" },
  { id: "行内 code", text: "P码", raw: "`P码`" },
  { id: "纯文本", text: "四种范围", raw: "四种范围" },
];

/** 选区取「范围前后各留一个字」：两端都有非空白的邻字符，反向对照因此有落点。 */
function selectionOf(span: SpanCase): [number, number] {
  const start = DOC.indexOf(span.raw);
  return [start - 1, start + span.raw.length + 1];
}

test.describe("选区自绘：逐字符覆盖 = 编辑器选区（drawSelection）", () => {
  test("空选区时没有任何选区底色层（把下面的覆盖断言钉在「真的画了」上）", async ({ page }) => {
    await openDoc(page);
    await reset(page);
    await expect(page.locator(".cm-selectionBackground")).toHaveCount(0);
    await expect(page.locator(".cm-selectionLayer")).toHaveCount(1);
  });

  test("程序化选区 × 五种范围类型：选区内的字符逐字被覆盖，选区外的邻字符不被覆盖", async ({ page }) => {
    await openDoc(page);
    for (const span of SPANS) {
      const [from, to] = selectionOf(span);
      await reset(page);
      await select(page, from, to);
      const cov = await coverage(page);
      expect(cov.rects, `${span.id}：选区底色必须由 CM 自绘（修前这里是 0 个矩形）`).toBeGreaterThan(0);
      expect(cov.misses, `${span.id}：选区内的字符必须逐字被选区底色覆盖（[${from},${to})）`).toEqual([]);
      expect(cov.leaks, `${span.id}：选区外的邻字符 MUST NOT 被覆盖`).toEqual([]);
      expect(await readDocument(page), `${span.id}：选区判定不改文档`).toBe(DOC);
    }
  });

  test("显露态（源码可见、装饰被撤）里覆盖不回退——这正是 WebKit 丢失绘制的那一拍", async ({ page }) => {
    await openDoc(page);
    const span = SPANS[0]; // 粗体：M273 缺陷的主体
    const [from, to] = selectionOf(span);
    await reset(page);
    // 起点：渲染态有样式装饰、源码标记不可见（否则下面的「显露」判据空转）
    await expect(page.locator(".cm-lp-strong")).toHaveCount(1);
    await expect(page.locator(".cm-line", { hasText: "第二段有" })).not.toContainText("**P粗**");

    await select(page, from, to);

    // 显露已落地：`**` 回到 DOM、样式装饰撤下（装饰重建发生）
    await expect(page.locator(".cm-line", { hasText: "第二段有" })).toContainText("**P粗**");
    await expect(page.locator(".cm-lp-strong")).toHaveCount(0);

    // 覆盖仍在（修前这里是「可见高亮由原生选区画、装饰一重建就丢」）
    const cov = await coverage(page);
    expect(cov.rects, "显露后选区底色仍必须由 CM 自绘").toBeGreaterThan(0);
    expect(cov.misses, "显露（DOM 重建）后选区内的字符必须逐字仍被覆盖").toEqual([]);
    expect(cov.leaks, "显露后选区外的邻字符 MUST NOT 被覆盖").toEqual([]);
  });

  test("鼠标路径：在粗体左侧按下、拖过粗体到下一段，按压期间与抬起显露后都逐字覆盖", async ({ page }) => {
    await openDoc(page);
    await reset(page);
    const line = page.locator(".cm-line", { hasText: "第二段有" }).first();
    const strong = line.locator(".cm-lp-strong", { hasText: "P粗" });
    const box = (await strong.boundingBox())!;
    const y = box.y + box.height / 2;

    // 从范围**左侧**按下（落点在普通文字上），再拖进下一段：这条路径的抬起会撤下装饰、重建 DOM。
    await page.mouse.move(box.x - 40, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 4, y, { steps: 6 });

    // 按压期间：范围仍是渲染态（M259 的按压窗口：解冻前不显露），此时选区已经覆盖到它
    await expect(strong, "按压期间强调段应仍是渲染态（未显露）").toBeVisible();
    const during = await coverage(page);
    expect(during.rects, "按压期间就应由 CM 自绘选区").toBeGreaterThan(0);
    expect(during.misses, "按压期间选区内的字符必须逐字被覆盖（含渲染态的粗体段）").toEqual([]);

    // 抬起：解冻 → 显露 → 这一段 DOM 被重建（M273 缺陷发生的那一拍）
    await page.mouse.up();
    await page.waitForTimeout(80);
    await expect(line, "抬起后该范围应显露源码").toContainText("**P粗**");
    await expect(line.locator(".cm-lp-strong")).toHaveCount(0);

    const after = await coverage(page);
    expect(after.rects, "抬起显露后选区底色仍必须由 CM 自绘").toBeGreaterThan(0);
    expect(after.misses, "抬起显露（DOM 重建）后选区内的字符必须逐字仍被覆盖").toEqual([]);
    expect(after.leaks, "抬起后选区外的邻字符 MUST NOT 被覆盖").toEqual([]);
    expect(await readDocument(page), "整条指针路径都不改文档（ADR 0003 §3）").toBe(DOC);
  });

  test("三主题：选区带取 --sel-band；eink 档的编辑器内原生选区不复白（M291 的口径变化）", async ({ page }) => {
    for (const theme of ["light", "dark", "eink"] as const) {
      await openDoc(page, theme);
      const [from, to] = selectionOf(SPANS[0]);
      await reset(page);
      await select(page, from, to);
      const cov = await coverage(page);
      expect(cov.misses, `${theme}：选区内的字符必须逐字被覆盖`).toEqual([]);

      const colors = await page.evaluate(() => {
        const resolve = (value: string): { color: string; background: string } => {
          const probe = document.createElement("div");
          probe.style.color = value;
          probe.style.background = value;
          document.body.appendChild(probe);
          const cs = getComputedStyle(probe);
          const out = { color: cs.color, background: cs.backgroundColor };
          probe.remove();
          return out;
        };
        const bg = document.querySelector<HTMLElement>(".cm-selectionBackground")!;
        const content = document.querySelector<HTMLElement>(".cm-content")!;
        return {
          painted: getComputedStyle(bg).backgroundColor,
          band: resolve("var(--sel-band)").background,
          sel: resolve("var(--sel)").background,
          nativeSelection: getComputedStyle(content, "::selection").color,
          text: resolve("var(--text)").color,
        };
      });
      // M291 的口径变化：编辑器选区带的真源从 `--sel` 换成 `--sel-band`（`--sel` 留给 chrome 的
      // 选中态——树行 / 浮层当前项 / frontmatter 显露态，那里前景是显式写的）。理由是**承载面不同**：
      // 编辑器选区画在文字之下、前景改不了，下界还要压住代码块的行区带（`--code-bg`）。
      // 见 docs/specs/design-tokens-v1.md §编辑器选区带。
      expect(colors.painted, `${theme}：自绘的选区带必须恰好是 --sel-band`).toBe(colors.band);
      if (theme === "eink") {
        // **eink 例外（M291）**：这一档的明度带同时服务 chrome 与编辑器（`--sel` 也已按规则④
        // 改成明度带），两个 token 同值是设计结果，不是漏改。
        expect(colors.band === colors.sel, "eink：--sel-band 与 --sel 同值（明度带同时服务两侧）").toBe(true);
      } else {
        expect(
          colors.band === colors.sel,
          `${theme}：--sel-band MUST NOT 与 --sel 同值（编辑器带还要压住 --code-bg，下界比 chrome 的选中档重）`,
        ).toBe(false);
      }
      if (theme === "eink") {
        // M291 的另一处口径变化（原断言在这里读 `--sel-text`）：eink 的「黑底反白」在编辑器里
        // **只有一半成立**——`::selection { color }` 盖不过语法着色 span 的显式色（`.cm-lp-tok-*`
        // 是 `#000`/`#6e6e6e`），于是选中区里被着色的一段仍是黑字压黑底（真机读数：着色处亮度跨度 0、
        // 未着色处 224）。带改成明度带（`--sel-band` = `#b9b9b9`）后，编辑器内原生选区的字色 MUST
        // 复位成 `--text`——**这条断的就是「复位没随着换带一起落地」**；`--sel-text` 仍服务 chrome 侧
        // 的显式反白（见 src/style.css 与 tests/visual/scenes/restyle-eink.spec.ts 的规则④断言）。
        expect(colors.nativeSelection, "eink：编辑器内原生选区的字色必须复位成 --text（不是 --sel-text）").toBe(colors.text);
      }
    }
  });

  test("区分度对照：未选中的普通文字身上没有被覆盖的字符（覆盖谓词不是恒真）", async ({ page }) => {
    await openDoc(page);
    const [from, to] = selectionOf(SPANS[0]);
    await reset(page);
    await select(page, from, to);
    const cov = await coverage(page);
    // 第一段整段都在选区外：它的字符一个都不许被覆盖（把 coverage 的反向读数扩到整段）
    const leaks = await page.evaluate((firstLineEnd: number) => {
      const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
      const rects = [...document.querySelectorAll(".cm-selectionBackground")].map((el) => el.getBoundingClientRect());
      const inside = (x: number, y: number) => rects.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
      const out: string[] = [];
      for (let pos = 0; pos < firstLineEnd; pos++) {
        const ch = view.state.doc.sliceString(pos, pos + 1);
        if (/\s/.test(ch)) continue;
        const a = view.coordsAtPos(pos);
        const b = view.coordsAtPos(pos + 1);
        if (!a || !b) continue;
        const cx = (Math.min(a.left, b.left) + Math.max(a.left, b.left)) / 2;
        if (inside(cx, (a.top + a.bottom) / 2)) out.push(`${pos}:${ch}`);
      }
      return out;
    }, DOC.indexOf("\n"));
    expect(cov.rects).toBeGreaterThan(0);
    expect(leaks, "选区外（第一段）的字符 MUST NOT 被选区底色覆盖").toEqual([]);
  });
});

