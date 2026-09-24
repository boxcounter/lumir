// 原型方向截图：design/prototypes/direction-{a,b,c}/index.html × screen × theme → shots/
// 用法：node design/prototypes/shoot.mjs
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../../tests/visual/package.json'));
const { chromium } = require('@playwright/test');

const root = join(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'shots');
mkdirSync(outDir, { recursive: true });

const combos = [];
for (const dir of ['direction-a', 'direction-b', 'direction-c']) {
  for (const screen of [1, 2, 3]) combos.push({ dir, screen, theme: 'light' });
  for (const theme of ['dark', 'eink']) combos.push({ dir, screen: 1, theme });
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});

for (const { dir, screen, theme } of combos) {
  const url = pathToFileURL(join(root, dir, 'index.html')).href + `?screen=${screen}&theme=${theme}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const name = `${dir}-s${screen}-${theme}.png`;
  await page.screenshot({ path: join(outDir, name) });
  console.log('shot', name);
}

await browser.close();
console.log('done →', outDir);
