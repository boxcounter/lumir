import { expect, test } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M120：非 md 只读文件按扩展名获得语法高亮（@codemirror/legacy-modes →
// StreamLanguage + HighlightStyle，editor.ts LANGUAGES），只读合同
//（M97/M101：editable(false) + readOnly(true)）不动。
// 颜色断言锚定默认 light 主题 token：--accent #b23a2c（关键字）、
// --callout-tip #5a7a3f（字符串）、--callout-warning #a05e1c（数字/atom）、
// --callout-note #4f6f8f（属性名，M147 起 json 键取此色）。
const LIGHT = {
  keyword: "rgb(178, 58, 44)",
  string: "rgb(90, 122, 63)",
  number: "rgb(160, 94, 28)",
  property: "rgb(79, 111, 143)",
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

test("打开 .json 文件：键取属性色、与字符串值分色，数字与 bool 仍取字面量色", async ({ page }) => {
  // 输入维度扫一遍而不是只钉一个案例（渲染缺陷合同先行的不变量口径）：顶层/嵌套/数组内
  // 的键、纯数字与中文键、四种值类型齐上——不变量是「键恒取属性色、字符串值恒取字符串色、
  // 字面量恒取 warning 色」，逐条都得成立；单钉一行只能证明那一行。
  const JSON_DOC = `{
  "name": "lumir",
  "count": 3,
  "ok": true,
  "nothing": null,
  "123": "digits",
  "中文键": "unicode",
  "nested": { "inner": "deep" },
  "list": [{ "a": "b" }]
}
`;
  await stubTauri(page, {
    entries: [{ path: "config.json", kind: "file", size: JSON_DOC.length, mtime_ms: 0 }],
    files: { "config.json": JSON_DOC },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="config.json"]').click();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  // legacy javascript(json) mode 把键标成复合 token `string property`：property 由
  // JSON_TOKEN_TABLE（preview/code.ts，editor.ts 同源 import）解析成 tags.propertyName，
  // 键因此同时带 string 与 propertyName 两个 tag。HighlightStyle 的条目序即优先级——
  // propertyName 的条目在 string 之后，故键落属性色。M147 前 property 无 tag 可用，
  // 键退化成纯 string、与字符串值同色（本断言即当时那条「键同字符串色」旧口径的反转）。
  const keys = ["name", "count", "ok", "nothing", '"123"', "中文键", "nested", "inner", "list", "a"];
  const strings = ["lumir", "digits", "unicode", "deep", "b"];
  const literals = ["3", "true", "null"];
  for (const key of keys) {
    const needle = key.startsWith('"') ? key : `"${key}"`;
    await expect.poll(() => tokenColor(page, needle), { message: `键 ${needle}` }).toBe(LIGHT.property);
  }
  for (const value of strings) {
    await expect.poll(() => tokenColor(page, `"${value}"`), { message: `字符串值 ${value}` }).toBe(LIGHT.string);
  }
  for (const literal of literals) {
    await expect.poll(() => tokenColor(page, literal), { message: `字面量 ${literal}` }).toBe(LIGHT.number);
  }
});
