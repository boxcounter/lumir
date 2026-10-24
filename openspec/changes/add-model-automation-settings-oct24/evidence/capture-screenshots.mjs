// 节点 1 关键屏截图（M716 r3 / M730 r4）：三主题的已配置 / 自动化 / 删除保护 / 命名关闭 /
// 图片无 vision，外加空清单、添加（重复 id）、校验、警告、冲突、保存中、高级区、关闭态。
//
// 跑法（仓根或 worktree 根）：
//   node openspec/changes/add-model-automation-settings-oct24/evidence/capture-screenshots.mjs
//   REVIEW_DIR=/abs/path/screenshots node .../capture-screenshots.mjs
//   PROTOTYPE_HTML=/abs/path.html node .../capture-screenshots.mjs
//
// 证据目录默认 <repo>/.local/reviews/model-automation-settings-oct24/screenshots
// （.local 不入 git；worktree 里跑时用 REVIEW_DIR 指到主仓）。全部合成数据；画面里不含完整密钥。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 12; i += 1) {
    if (fs.existsSync(path.join(dir, "design/prototypes"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`仓库根未找到（从 ${start} 向上找不到 design/prototypes）`);
}

const repoRoot = findRepoRoot(scriptDir);
const prototypePath = process.env.PROTOTYPE_HTML
  ? path.resolve(process.env.PROTOTYPE_HTML)
  : fs.existsSync(path.join(scriptDir, "prototype.html"))
    ? path.join(scriptDir, "prototype.html")
    : path.join(repoRoot, "design/prototypes/model-automation-settings-oct24.html");
const outDir = process.env.REVIEW_DIR
  ? path.resolve(process.env.REVIEW_DIR)
  : path.join(repoRoot, ".local/reviews/model-automation-settings-oct24/screenshots");
fs.mkdirSync(outDir, { recursive: true });

function findPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_ENTRY,
    path.join(repoRoot, "tests/visual/node_modules/@playwright/test/index.mjs"),
    path.resolve(repoRoot, "../../../tests/visual/node_modules/@playwright/test/index.mjs"),
    path.resolve(repoRoot, "../../tests/visual/node_modules/@playwright/test/index.mjs"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

const entry = findPlaywright();
if (!entry) throw new Error("Playwright not found（设 PLAYWRIGHT_ENTRY 指向 @playwright/test/index.mjs）");
const { chromium } = await import(pathToFileURL(entry).href);

const fileUrl = pathToFileURL(prototypePath).href;
console.log(`PROTOTYPE  ${prototypePath}`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const captured = [];

async function open(query) {
  await page.goto(`${fileUrl}?${query}`);
  await page.waitForSelector("#settings-panel", { state: "attached" });
  await page.evaluate(() => document.fonts?.ready);
  await page.evaluate(() => document.activeElement?.blur?.());
}

async function shot(name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  captured.push(file);
  console.log(`SHOT  ${file}`);
}

for (const theme of ["light", "dark", "eink"]) {
  await open(`theme=${theme}&scene=configured&panel=0`);
  await shot(`01-configured-${theme}`);
}

for (const theme of ["light", "dark", "eink"]) {
  await open(`theme=${theme}&scene=delete&panel=0`);
  await shot(`04-delete-guard-${theme}`);
}

for (const theme of ["light", "dark", "eink"]) {
  await open(`theme=${theme}&scene=configured&panel=0`);
  const file = path.join(outDir, `11-automation-${theme}.png`);
  await page.locator("#automation-pane").screenshot({ path: file });
  captured.push(file);
  console.log(`SHOT  ${file}`);
}

for (const theme of ["light", "dark", "eink"]) {
  await open(`theme=${theme}&scene=naming-off&panel=0`);
  const file = path.join(outDir, `13-naming-off-${theme}.png`);
  await page.locator("#automation-pane").screenshot({ path: file });
  captured.push(file);
  console.log(`SHOT  ${file}`);
}

for (const theme of ["light", "dark", "eink"]) {
  await open(`theme=${theme}&scene=naming-vision&panel=0`);
  const file = path.join(outDir, `14-naming-vision-${theme}.png`);
  await page.locator("#automation-pane").screenshot({ path: file });
  captured.push(file);
  console.log(`SHOT  ${file}`);
}

await open("theme=light&scene=empty&panel=0");
await shot("02-empty-light");

await open("theme=light&scene=add&panel=0");
await shot("03-add-duplicate-light");

await open("theme=light&scene=validation&panel=0");
await page.locator("[data-error-for]").first().scrollIntoViewIfNeeded();
await shot("05-validation-light");

await open("theme=light&scene=warning&panel=0");
await shot("06-warning-light");

await open("theme=light&scene=conflict&panel=0");
await shot("07-conflict-light");

await open("theme=light&scene=saving&panel=0");
await shot("08-saving-light");

await open("theme=light&scene=configured&advanced=1&panel=0");
await page.locator("[data-advanced]").scrollIntoViewIfNeeded();
await shot("09-advanced-light");

await open("theme=dark&scene=configured&advanced=1&panel=0");
await page.locator("[data-advanced]").scrollIntoViewIfNeeded();
await shot("09-advanced-dark");

await open("theme=light&scene=configured&provider=local-lab&advanced=1&panel=0");
await page.locator("[data-advanced]").scrollIntoViewIfNeeded();
await shot("12-generic-advanced-light");

await open("theme=light&scene=closed&panel=0");
await shot("10-closed-light");

await browser.close();
console.log(`RESULT: ${captured.length} screenshots in ${outDir}`);
