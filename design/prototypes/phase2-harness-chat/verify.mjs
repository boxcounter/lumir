// Phase 2 原型校验：screen(1..10) × theme × （含控制面板态） —— 零 JS 错误、零横向溢出
// 用法：node design/prototypes/phase2-harness-chat/verify.mjs
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../../../tests/visual/package.json'));
const { chromium } = require('@playwright/test');

const root = dirname(fileURLToPath(import.meta.url));
const base = pathToFileURL(join(root, 'index.html')).href;

const screens = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const themes = ['light', 'dark', 'eink'];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

let failures = 0;
for (const screen of screens) {
  for (const theme of themes) {
    for (const panel of ['0', '1']) {
      const errors = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
      await page.goto(`${base}?screen=${screen}&theme=${theme}&panel=${panel}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(() => {
        const de = document.documentElement;
        return { scrollW: de.scrollWidth, innerW: window.innerWidth, bodyScrollW: document.body.scrollWidth };
      });
      const wide = overflow.scrollW > overflow.innerW || overflow.bodyScrollW > overflow.innerW;
      const tag = `screen=${screen} theme=${theme} panel=${panel}`;
      if (errors.length || wide) {
        failures++;
        console.log(`FAIL ${tag}${wide ? ` 横向溢出 scrollW=${overflow.scrollW}/${overflow.bodyScrollW} > ${overflow.innerW}` : ''}`);
        errors.forEach((e) => console.log(`  ${e}`));
      } else {
        console.log(`PASS ${tag}`);
      }
      page.removeAllListeners('pageerror');
      page.removeAllListeners('console');
    }
  }
}

await browser.close();
console.log(failures === 0 ? 'VERIFY RESULT: PASS (60/60)' : `VERIFY RESULT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
