// Phase 2 harness pane 原型截图：index.html × screen(1..10) × theme → shots/
// 用法：node design/prototypes/phase2-harness-chat/shoot.mjs
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../../../tests/visual/package.json'));
const { chromium } = require('@playwright/test');

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, 'shots');
mkdirSync(outDir, { recursive: true });

const screens = [
  [1, '单pane骨架'],
  [2, '双pane等宽'],
  [3, '分隔条拖拽'],
  [4, 'harness对话'],
  [5, 'pin上下文'],
  [6, '上下文用量'],
  [7, '新建会话'],
  [8, '复制消息'],
  [9, '思考过程'],
  [10, '思考程度'],
];
const themes = [
  ['light', '浅色'],
  ['dark', '深色'],
  ['eink', 'eink'],
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});

for (const [screen, sName] of screens) {
  for (const [theme, tName] of themes) {
    const url = pathToFileURL(join(root, 'index.html')).href + `?screen=${screen}&theme=${theme}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const name = `${String(screen).padStart(2, '0')}-${sName}-${tName}.png`;
    await page.screenshot({ path: join(outDir, name) });
    console.log('shot', name);
  }
}

await browser.close();
console.log('done →', outDir);
