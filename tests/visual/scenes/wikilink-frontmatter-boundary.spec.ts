import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { locateWikilinkSpans } from "../../../src/preview/wikilinks";
import { stubTauri, type VaultFixture } from "./tauri-stub";

interface BoundaryFixture {
  path: string;
  frontmatterLineCount: number;
  frontmatterLink: string;
  body: string;
  expected: { decorated: string[]; queried: string[] };
}

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures/wikilink-frontmatter-boundary/boundary.json"), "utf8"),
) as BoundaryFixture;

function documentText(): string {
  const lines = Array.from({ length: fixture.frontmatterLineCount - 3 }, (_, index) =>
    index + 2 === fixture.frontmatterLineCount - 2 ? `note: "${fixture.frontmatterLink}"` : `metadata_${index + 1}: value_${index + 1}`,
  );
  return `---\n${lines.join("\n")}\n---${fixture.body}`;
}

const source = documentText();

const vault: VaultFixture = {
  entries: [{ path: fixture.path, kind: "file", size: source.length, mtime_ms: 1 }],
  files: { [fixture.path]: source },
};

test("200行frontmatter边界：隐藏区间不装饰、不触发查询，正文链接仍有效", async ({ page }) => {
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

  await expect(page.locator(".cm-lp-frontmatter")).toBeVisible({ timeout: 15_000 });
  const bodyLink = page.locator(".cm-lp-wikilink");
  await page.locator(".cm-scroller").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(bodyLink).toHaveCount(1);
  await expect(bodyLink).toContainText("visible-body");
  await expect(page.locator(".cm-lp-wikilink", { hasText: "hidden-frontmatter" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __wikilinkBoundaryQueries: string[] }).__wikilinkBoundaryQueries,
  )).toEqual(fixture.expected.queried);

  expect(locateWikilinkSpans(source).map((span) => source.slice(span.from, span.to))).toEqual(
    fixture.expected.decorated,
  );
});
