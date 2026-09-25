// 表格全屏触发钮裁决稿截图：index.html × 12 变体 × 3 主题 + overlay × 3 + board 总览 × 3
// 用法：node design/prototypes/table-fs-trigger/shoot.mjs
//   输出：test-results/m235/shots/（证据不入 git，.gitignore「test-results/」豁免）
//   playwright 模块默认取本仓 tests/visual（同 design/prototypes/shoot.mjs 先例）；
//   worktree 未装依赖时用 LUMIR_VISUAL_PKG=/path/to/tests/visual/package.json 指定主仓。
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, '../../..');
const visualPkg = process.env.LUMIR_VISUAL_PKG || join(repoRoot, 'tests/visual/package.json');
const require = createRequire(visualPkg);
const { chromium } = require('@playwright/test');

const outDir = join(repoRoot, 'test-results/m235/shots');
mkdirSync(outDir, { recursive: true });

const positions = ['inside', 'outside', 'top'];
const icons = ['expand', 'corners'];
const timings = ['hover', 'dim'];
const themes = ['light', 'dark', 'eink'];

const shots = [];
for (const theme of themes) {
  for (const pos of positions)
    for (const icon of icons)
      for (const timing of timings)
        shots.push({ name: `${pos}-${icon}-${timing}-${theme}`, query: `?v=${pos}-${icon}-${timing}&theme=${theme}` });
  shots.push({ name: `overlay-${theme}`, query: `?frame=overlay&theme=${theme}` });
  shots.push({ name: `board-${theme}`, query: `?theme=${theme}`, fullPage: true });
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});

const base = pathToFileURL(join(root, 'index.html')).href;
for (const { name, query, fullPage } of shots) {
  await page.goto(base + query, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: Boolean(fullPage) });
  console.log('shot', name);
}

await browser.close();
console.log('done →', outDir);
