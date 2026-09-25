// heading-hierarchy 对比稿截图：index.html?v={base,a,b,c} × theme → shots/
// 用法：node design/prototypes/heading-hierarchy/shoot.mjs
// window = 1280×900 视口实景（窗口 chrome + 层级速览首屏）；
// full = expand=1 整页（覆盖真实密度全文）。
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// worktree 不装依赖：锚到主 checkout 已安装的 tests/visual/node_modules
const require = createRequire('/Users/boxcounter/Code/Boxcounter/lumir/tests/visual/package.json');
const { chromium } = require('@playwright/test');

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, 'shots');
mkdirSync(outDir, { recursive: true });

const combos = [];
for (const v of ['base', 'a', 'b', 'c']) {
  combos.push({ v, theme: 'light', mode: 'window' });
  combos.push({ v, theme: 'light', mode: 'full' });
}
for (const v of ['a', 'b', 'c']) {
  for (const theme of ['dark', 'eink']) combos.push({ v, theme, mode: 'full' });
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});

for (const { v, theme, mode } of combos) {
  const expand = mode === 'full' ? '&expand=1' : '';
  const url = pathToFileURL(join(root, 'index.html')).href + `?v=${v}&theme=${theme}&ui=0${expand}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const name = `${v}-${theme}-${mode}.png`;
  await page.screenshot({ path: join(outDir, name), fullPage: mode === 'full' });
  console.log('shot', name);
}

await browser.close();
console.log('done →', outDir);
