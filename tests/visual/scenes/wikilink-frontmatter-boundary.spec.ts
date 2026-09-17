import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { Text } from "@codemirror/state";
import { MAX_FRONTMATTER_LINES, detectFrontmatter } from "../../../src/preview/frontmatter";
import { findWikilinkSpans, locateWikilinkSpans } from "../../../src/preview/wikilinks";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// 首部 --- 区块的两条边界各钉一次（M152）：上限**之内**两层都说「这是 frontmatter」
//（properties 区块上屏、块内链接不装饰不查询）；上限**之外**两层都说「这是正文」
//（无区块、块内链接照常装饰并被查询）。装饰层（frontmatter.ts 的 detectFrontmatter）
// 与词法/激活层（wikilinks.ts 的 findWikilinkSpans）共用同一个上限常量——任一层独自
// 改了口径，本文件的四条断言里必有一条红。
// 上限取 512 的理由（保持 properties 区块的既有渲染口径、让排除区跟上它，而不是相反）
// 见 src/preview/frontmatter.ts 的 MAX_FRONTMATTER_LINES 注释。
interface BoundaryFixture {
  path: string;
  frontmatterLineCount: number;
  /** 落在首部 --- 区块内的链接原文（超上限时该区块不再是 frontmatter）。 */
  blockLink: string;
  body: string;
  expected: { frontmatter: boolean; decorated: string[]; queried: string[] };
}

function loadFixture(name: string): BoundaryFixture {
  return JSON.parse(
    readFileSync(join(process.cwd(), "fixtures/wikilink-frontmatter-boundary", name), "utf8"),
  ) as BoundaryFixture;
}

/**
 * 生成文档：首行 `---` 开围栏，blockLink 落在区块末行，闭合围栏与正文随后。
 * 闭合围栏行号恒为 `frontmatterLineCount - 1`（fixture 的行数即边界声明）。
 */
function documentText(fixture: BoundaryFixture): string {
  const lines = Array.from({ length: fixture.frontmatterLineCount - 3 }, (_, index) =>
    index + 2 === fixture.frontmatterLineCount - 2 ? `note: "${fixture.blockLink}"` : `metadata_${index + 1}: value_${index + 1}`,
  );
  return `---\n${lines.join("\n")}\n---${fixture.body}`;
}

/** link_graph_resolve 的调用记录（按调用顺序，场景在 initScript 里挂钩 invoke）。 */
async function resolveQueries(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __wikilinkBoundaryQueries: string[] }).__wikilinkBoundaryQueries);
}

async function assertBoundary(page: Page, fixture: BoundaryFixture): Promise<void> {
  const source = documentText(fixture);

  // 先对合同本身对账：闭合围栏行号 ≤ MAX_FRONTMATTER_LINES + 1（开围栏行不计入上限）
  // ⇒ 判为 frontmatter；越过即判为正文。fixture 的行数必须落在它声明的那一侧。
  const closeLine = fixture.frontmatterLineCount - 1;
  expect(closeLine <= MAX_FRONTMATTER_LINES + 1, "fixture 行数与声明的判定不一致").toBe(fixture.expected.frontmatter);

  // 词法层（激活层口径）与装饰层检测：Node 侧先各算一次，两侧必须同答案。
  expect(detectFrontmatter(Text.of(source.split("\n"))) !== null, "装饰层检测").toBe(fixture.expected.frontmatter);
  expect(
    locateWikilinkSpans(source).map((span) => source.slice(span.from, span.to)),
    "词法层 span",
  ).toEqual(fixture.expected.decorated);

  const vault: VaultFixture = {
    entries: [{ path: fixture.path, kind: "file", size: source.length, mtime_ms: 1 }],
    files: { [fixture.path]: source },
  };
  await stubTauri(page, vault);
  await page.addInitScript(() => {
    const internals = (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__;
    const original = internals.invoke;
    const queries: string[] = [];
    internals.invoke = async (cmd, args) => {
      if (cmd === "link_graph_resolve") {
        queries.push((args as { link?: string }).link ?? "");
      }
      return original(cmd, args);
    };
    (window as unknown as { __wikilinkBoundaryQueries: string[] }).__wikilinkBoundaryQueries = queries;
  });
  await page.goto("/");
  await page.getByRole("button", { name: fixture.path }).click();

  // 装饰层：区块上屏 / 不上屏，与上面 Node 侧的检测同答案。
  const box = page.locator(".cm-lp-frontmatter");
  if (fixture.expected.frontmatter) {
    await expect(box).toBeVisible({ timeout: 15_000 });
  } else {
    await expect(box).toHaveCount(0);
  }
  await page.locator(".cm-scroller").evaluate((element) => { element.scrollTop = element.scrollHeight; });

  // 块内链接：装饰层判为 frontmatter 时它不出现；判为正文时它与正文链接一样被装饰。
  const blockLinkLabel = fixture.blockLink.slice(2, -2);
  await expect(page.locator(".cm-lp-wikilink", { hasText: blockLinkLabel })).toHaveCount(
    fixture.expected.frontmatter ? 0 : 1,
  );
  await expect(page.locator(".cm-lp-wikilink")).toHaveCount(fixture.expected.decorated.length);
  for (const link of fixture.expected.decorated) {
    await expect(page.locator(".cm-lp-wikilink", { hasText: link.slice(2, -2) })).toHaveCount(1);
  }
  await expect.poll(() => resolveQueries(page)).toEqual(fixture.expected.queried);
}

test("上限内（200 行区块）：区块上屏，块内链接不装饰、不触发查询，正文链接仍有效", async ({ page }) => {
  await assertBoundary(page, loadFixture("boundary.json"));
});

test("超上限（600 行区块）：两层都不认它是 frontmatter，块内链接与正文链接同样装饰、同样查询", async ({ page }) => {
  await assertBoundary(page, loadFixture("boundary-over-cap.json"));
});

// 上限值的精确边界（不需要浏览器）：闭合围栏落在上限之内/之外各一次，两层同答案。
test("上限的精确边界：闭合围栏在第 MAX+1 行仍是 frontmatter，第 MAX+2 行起整段按正文", () => {
  const build = (closeLine: number): string => {
    const lines = ["---"];
    for (let n = 2; n < closeLine; n++) lines.push(n === 3 ? `note: "[[inside]]"` : `k${n}: v${n}`);
    lines.push("---", "", "[[outside]]", "");
    return lines.join("\n");
  };
  const atCap = build(MAX_FRONTMATTER_LINES + 1);
  const pastCap = build(MAX_FRONTMATTER_LINES + 2);

  expect(detectFrontmatter(Text.of(atCap.split("\n"))), "装饰层：第 MAX+1 行闭合").not.toBeNull();
  expect(detectFrontmatter(Text.of(pastCap.split("\n"))), "装饰层：第 MAX+2 行闭合").toBeNull();

  const spans = (text: string) => findWikilinkSpans(text).map((span) => text.slice(span.from, span.to));
  expect(spans(atCap), "词法层：块内链接被排除").toEqual(["[[outside]]"]);
  expect(spans(pastCap), "词法层：整段按正文").toEqual(["[[inside]]", "[[outside]]"]);
});
