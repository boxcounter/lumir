import { expect, test } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M120：非 md 只读文件按扩展名获得语法高亮（@codemirror/legacy-modes →
// StreamLanguage + HighlightStyle，editor.ts CODE_LANGUAGES），只读合同
//（M97/M101：editable(false) + readOnly(true)）不动。
// 颜色断言锚定默认 light 主题 token：--accent #b23a2c（关键字）、
// --callout-tip #5a7a3f（字符串）、--callout-warning #a05e1c（数字/atom）。
const LIGHT = {
  keyword: "rgb(178, 58, 44)",
  string: "rgb(90, 122, 63)",
  number: "rgb(160, 94, 28)",
};

const TS_DOC = `// 小工具示例
import { createHash } from "node:crypto";

const LIMIT: number = 42;

export function greet(name: string): string {
  return \`hello \${name}\`;
}
`;

/** 取 token 文本首个匹配 span 的计算颜色；未找到（未着色）返回 null。 */
async function tokenColor(page: import("@playwright/test").Page, token: string): Promise<string | null> {
  return page.evaluate((needle) => {
    for (const span of document.querySelectorAll<HTMLElement>(".cm-line span")) {
      if (span.textContent === needle) return getComputedStyle(span).color;
    }
    return null;
  }, token);
}

test("打开 .ts 文件：关键字/字符串/数字 token 着色且编辑器保持只读", async ({ page }) => {
  await stubTauri(page, {
    entries: [{ path: "util.ts", kind: "file", size: TS_DOC.length, mtime_ms: 0 }],
    files: { "util.ts": TS_DOC },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="util.ts"]').click();

  // 只读合同（M97/M101）：contenteditable 摘除、aria-readonly、code 模式带行号 gutter
  const content = page.locator(".cm-content");
  await expect(content).toHaveAttribute("contenteditable", "false");
  await expect(content).toHaveAttribute("aria-readonly", "true");
  await expect(page.locator(".cm-gutters")).toHaveCount(1);

  // 高亮 token（expect.poll 等语法树推进）：关键字/字符串/数字分别取主题语义色
  await expect.poll(() => tokenColor(page, "import")).toBe(LIGHT.keyword);
  await expect.poll(() => tokenColor(page, '"node:crypto"')).toBe(LIGHT.string);
  await expect.poll(() => tokenColor(page, "42")).toBe(LIGHT.number);

  // 输入被拒收，文档内容不变
  await content.click({ position: { x: 100, y: 60 } });
  await page.keyboard.type("XYZ");
  expect(await readDocument(page)).toBe(TS_DOC);
});

test("打开 .json 文件：键与字符串值同色、数字值分色", async ({ page }) => {
  const JSON_DOC = `{\n  "name": "lumir",\n  "count": 3\n}\n`;
  await stubTauri(page, {
    entries: [{ path: "config.json", kind: "file", size: JSON_DOC.length, mtime_ms: 0 }],
    files: { "config.json": JSON_DOC },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="config.json"]').click();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  // legacy javascript(json) mode 的键 token 是 string+property 复合 tag，tag 优先级
  // 上 string 胜出——键取字符串色（与多数主题「json 键同字符串色」一致），值分色。
  await expect.poll(() => tokenColor(page, '"name"')).toBe(LIGHT.string);
  await expect.poll(() => tokenColor(page, '"lumir"')).toBe(LIGHT.string);
  await expect.poll(() => tokenColor(page, "3")).toBe(LIGHT.number);
});
