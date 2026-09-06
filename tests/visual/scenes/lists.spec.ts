import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stubTauri } from './tauri-stub';
import { copyFresh, readDocument } from './parity-checks';

const source = readFileSync(new URL('../fixtures/lists/mixed.md', import.meta.url), 'utf8');
async function open(page: Page, text = source) {
  await stubTauri(page, { entries: [{ path: 'lists.md', kind: 'file', size: text.length, mtime_ms: 0 }], files: { 'lists.md': text } });
  await page.goto('/');
  await page.locator('.ft-row[title="lists.md"]').click();
  await expect(page.locator('.cm-lp-list-marker').first()).toBeVisible();
}
async function geometry(page: Page, text: string) {
  return page.locator('.cm-lp-list-line').filter({ hasText: text }).evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const rects: { x: number; y: number }[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest('.cm-lp-list-marker')) continue;
      for (let i = 0; i < (node.textContent?.length ?? 0); i++) {
        const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && !rects.some(r => Math.abs(r.y - rect.y) < 1)) rects.push({ x: rect.x, y: rect.y });
      }
    }
    return { rects, marker: el.querySelector('.cm-lp-list-marker')?.getBoundingClientRect().right, style: el.getAttribute('style') };
  });
}
for (const theme of ['light', 'dark', 'eink']) {
  for (const width of [1280, 640]) {
    test(`列表对齐与源码 ${theme} ${width}`, async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.setViewportSize({ width, height: 1600 });
      await page.addInitScript(value => localStorage.setItem('lumir-theme', value), theme);
      await open(page);
      for (const names of [['Alpha', 'Beta', 'Gamma completed', 'Physical continuation'], ['Round ordinary', 'Round pending', 'Round completed'], ['Bullet ordinary', 'Bullet pending', 'Bullet completed', 'physical bullet'], ['Nested ordinary', 'Nested completed'], ['Plus ordinary', 'Plus pending'], ['Star ordinary', 'Star completed']]) {
        const rows = await Promise.all(names.map(name => geometry(page, name)));
        const x = rows[0].rects[0].x;
        for (const row of rows) {
          for (const rect of row.rects) expect(Math.abs(rect.x - x)).toBeLessThanOrEqual(1);
          if (row.marker) expect(row.marker).toBeLessThanOrEqual(x + 1);
        }
      }
      expect((await geometry(page, 'Nested ordinary')).rects[0].x).toBeGreaterThan((await geometry(page, 'Gamma completed')).rects[0].x);
      expect((await geometry(page, 'Third level')).rects[0].x).toBeGreaterThan((await geometry(page, 'Nested ordinary')).rects[0].x);
      await expect(page.locator('.cm-lp-list-marker').filter({ hasText: '100.' })).toHaveText('100.[x]');
      await expect(page.locator('.cm-lp-codeblock-line.cm-lp-list-line')).toHaveCount(0);
      await page.setViewportSize({ width: width === 640 ? 1280 : 640, height: 1600 });
      expect(await readDocument(page)).toBe(source);
      const resized = await geometry(page, 'Beta');
      for (const rect of resized.rects) expect(Math.abs(rect.x - resized.rects[0].x)).toBeLessThanOrEqual(1);
      await page.locator('.cm-lp-list-line').filter({ hasText: 'Alpha ordinary' }).evaluate(el => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent?.startsWith('Alpha ordinary')) continue;
          const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 5);
          const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
          break;
        }
      });
      await page.evaluate(() => navigator.clipboard.writeText('partial-list-sentinel'));
      await page.keyboard.press('Meta+c');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Alpha');
      expect(await readDocument(page)).toBe(source);
      await page.locator('.cm-content').click();
      expect(await copyFresh(page, `lists-${theme}-${width}`)).toBe(source);
      expect(await readDocument(page)).toBe(source);
      for (const key of ['a', 'Backspace', 'Delete', 'Meta+x']) {
        await page.keyboard.press(key);
        expect(await readDocument(page)).toBe(source);
      }
      await page.evaluate(() => navigator.clipboard.writeText('paste-attempt'));
      await page.keyboard.press('Meta+v');
      expect(await readDocument(page)).toBe(source);
      await page.locator('.cm-lp-task-marker').first().click();
      expect(await readDocument(page)).toBe(source);
    });
  }
}

test('列表模式隔离与嵌套代码保护', async ({ page }) => {
  const text = '- parent\n\n  ```\n  - fenced code\n  ```\n\n      - indented code\n\n- next\n';
  await stubTauri(page, { entries: ['list.md', 'list.ts'].map(path => ({ path, kind: 'file', size: text.length, mtime_ms: 0 })), files: { 'list.md': text, 'list.ts': text } });
  await page.goto('/');
  await page.locator('.ft-row[title="list.md"]').click();
  await expect(page.locator('.cm-lp-list-first')).toHaveCount(2);
  await expect(page.locator('.cm-lp-codeblock-line.cm-lp-list-line')).toHaveCount(0);
  expect(await readDocument(page)).toBe(text);
  await page.locator('.ft-row[title="list.ts"]').click();
  await expect(page.locator('.cm-lp-list-line')).toHaveCount(0);
  expect(await readDocument(page)).toBe(text);
  await page.locator('.ft-row[title="list.md"]').click();
  await expect(page.locator('.cm-lp-list-first')).toHaveCount(2);
  expect(await readDocument(page)).toBe(text);
});

test('大列表跨视口编号槽稳定且装饰有界', async ({ page }) => {
  const large = Array.from({ length: 18000 }, (_, i) => `${i + 1}. ${i === 15000 ? '[x] ' : ''}Item ${i + 1} ${'long list content '.repeat(3)}`).join('\n');
  await open(page, large);
  const before = await geometry(page, 'Item 1 long');
  const scroller = page.locator('.cm-scroller');
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight * .8; });
  await page.waitForTimeout(500);
  const middle = await page.locator('.cm-lp-list-line').first().getAttribute('style');
  expect(middle).toBe(before.style);
  expect(await page.locator('.cm-lp-list-line').count()).toBeLessThan(300);
  expect(await readDocument(page)).toBe(large);
  await scroller.evaluate(el => { el.scrollTop = 0; });
  await expect(page.locator('.cm-lp-list-line').filter({ hasText: 'Item 1 long' })).toBeVisible();
  expect((await geometry(page, 'Item 1 long')).style).toBe(before.style);
  expect(await readDocument(page)).toBe(large);
});
