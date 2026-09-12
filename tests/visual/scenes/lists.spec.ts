import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stubTauri } from './tauri-stub';
import { copyFresh, readDocument } from './parity-checks';
import { summarize } from '../../../scripts/perf/lib/stats.mjs';

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
for (const width of [1280, 640]) {
  test(`列表对齐与源码 ${width}`, async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.setViewportSize({ width, height: 1600 });
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
      expect(await copyFresh(page, `lists-${width}`)).toBe(source);
      expect(await readDocument(page)).toBe(source);
      // task marker 是渲染 widget：点击不得改写文档。
      await page.locator('.cm-lp-task-marker').first().click();
      expect(await readDocument(page)).toBe(source);
      // md 自本地保存契约（f80ef8b）起可编辑：键盘输入按设计进文档，列表装饰
      // 不得拦截编辑。旧断言来自 M1 只读时代，与已落地的可编辑+保存特性冲突，
      // 此处按现行特性修正。
      await page.keyboard.type('a');
      expect(await readDocument(page)).not.toBe(source);
    });
}

test('输入时既有列表装饰不重建：列表文字不左右抖动', async ({ page }) => {
  await open(page);
  // 观测：列表 marker 装饰一旦掉落就计数。旧实现每次击键清空组缓存，装饰整体
  // 消失 ≥16ms 再补回，列表文字随之左右抖动（桌面验收缺陷）；修复后编辑只触发
  // 后台重扫，装饰始终在位。
  await page.evaluate(() => {
    (window as unknown as { listDecorDrops: number }).listDecorDrops = 0;
    let present = document.querySelector('.cm-lp-list-marker') !== null;
    new MutationObserver(() => {
      const now = document.querySelector('.cm-lp-list-marker') !== null;
      if (present && !now) (window as unknown as { listDecorDrops: number }).listDecorDrops += 1;
      present = now;
    }).observe(document.querySelector('.cm-content')!, { childList: true, subtree: true });
  });
  // 桌面验收原始场景：在列表上方的标题行输入，下方列表不得抖动。
  await page.locator('.cm-line').filter({ hasText: '列表' }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('typed', { delay: 40 });
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => (window as unknown as { listDecorDrops: number }).listDecorDrops)).toBe(0);
  await expect(page.locator('.cm-lp-list-marker').first()).toBeVisible();
  // 输入正常进文档，且列表对齐未被输入破坏。
  expect(await readDocument(page)).toContain('typed');
  const alpha = await geometry(page, 'Alpha ordinary');
  const beta = await geometry(page, 'Beta pending');
  expect(Math.abs(alpha.rects[0].x - beta.rects[0].x)).toBeLessThanOrEqual(1);
});

test('嵌套列表：祖先组宽度变化后子组跟随重对齐', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const text = '1. Alpha\n2. Parent\n   1. Child one\n   2. Child two\n';
  await open(page, text);
  const before = await geometry(page, 'Child one');
  // 粘贴是单次 docChanged（Enter 会触发列表自动续标、击键会逐键产生后续
  // 编辑而自愈，都不能用）：顶层列表追加 "10." 项，组 max width +1 unit，
  // 之后不再有编辑。旧实现子组重扫按祖先 stale cached body 登记 indent，
  // 祖先 publish 新 body 后子组错位 ~1 unit 滞留到下一击键（r1 review
  // P2-1）；修复后祖先 stale 视为未就绪，子组下轮 build 拿到新 body 自行
  // 右移 1 unit。
  await page.locator('.cm-line').filter({ hasText: 'Child two' }).click();
  await page.keyboard.press('End');
  await page.evaluate(() => navigator.clipboard.writeText('\n10. New'));
  await page.keyboard.press('Meta+v');
  expect(await readDocument(page)).toContain('10. New');
  await expect.poll(async () => (await geometry(page, 'Child one')).rects[0].x, { timeout: 3000 })
    .toBeGreaterThan(before.rects[0].x + 4);
  // 重对齐稳定，不回落。
  await page.waitForTimeout(200);
  expect((await geometry(page, 'Child one')).rects[0].x).toBeGreaterThan(before.rects[0].x + 4);
});

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

test('partial组超出后台提前范围仍完成且末端标记不重叠', async ({ page }) => {
  const large = Array.from({ length: 18000 }, (_, i) => `${i === 17999 ? '999999999. [x]' : `${i + 1}.`} Item ${i + 1} ${'long list content '.repeat(3)}`).join('\n');
  await stubTauri(page, { entries: [{ path: 'lists.md', kind: 'file', size: large.length, mtime_ms: 0 }], files: { 'lists.md': large } });
  await page.goto('/');
  await page.evaluate(() => {
    (window as any).listStages = [];
    new MutationObserver(() => {
      const content = document.querySelector('.cm-content');
      if (!content?.textContent?.includes('Item 1 long')) return;
      const stage = content.querySelector('.cm-lp-list-marker') ? 'complete' : 'source';
      const stages = (window as any).listStages;
      if (stages.at(-1) !== stage) stages.push(stage);
    }).observe(document.querySelector('.cm-content')!, { childList: true, subtree: true });
  });
  await page.locator('.ft-row[title="lists.md"]').click();
  await expect(page.locator('.cm-lp-list-marker').first()).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => (window as any).listStages)).toEqual(['source', 'complete']);
  expect(await page.locator('.cm-scroller').evaluate(el => el.scrollTop)).toBe(0);
  const before = await geometry(page, 'Item 1 long');
  const scroller = page.locator('.cm-scroller');
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('.cm-lp-list-marker').filter({ hasText: '999999999.' })).toBeVisible();
  const tail = await geometry(page, 'Item 18000');
  expect(Math.abs(tail.rects[0].x - before.rects[0].x)).toBeLessThanOrEqual(1);
  const box = await page.locator('.cm-lp-list-marker').filter({ hasText: '999999999.' }).evaluate(el => {
    const outer = el.getBoundingClientRect();
    return { left: outer.left, right: outer.right, spans: [...el.children].map(child => ({ left: child.getBoundingClientRect().left, right: child.getBoundingClientRect().right })) };
  });
  expect(box.spans[0].left).toBeGreaterThanOrEqual(box.left - 1);
  expect(box.spans[0].right).toBeLessThan(box.spans[1].left);
  expect(box.spans[1].right).toBeLessThan(tail.rects[0].x);
  expect(await page.locator('.cm-lp-list-line').count()).toBeLessThan(300);
  expect(await readDocument(page)).toBe(large);
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight * .5; });
  await page.waitForTimeout(100);
  await page.locator('.cm-lp-list-line').first().click();
  expect(await readDocument(page)).toBe(large);
  await scroller.evaluate(el => { el.scrollTop = 0; });
  await expect(page.locator('.cm-lp-list-line').filter({ hasText: 'Item 1 long' })).toBeVisible();
  expect(Math.abs((await geometry(page, 'Item 1 long')).rects[0].x - before.rects[0].x)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => (window as any).listStages)).toEqual(['source', 'complete']);
});

test('100k密集项完整回调预算与最终标记', async ({ page }, info) => {
  const text = Array.from({ length: 100000 }, (_, i) => `${i === 99999 ? '999999999. [x]' : `${i + 1}.`} z`).join('\n');
  await page.addInitScript(() => {
    const original = window.setTimeout;
    (window as any).listCallbacks = [];
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: any[]) => original(() => {
      const start = performance.now();
      try { if (typeof callback === 'function') callback(...args); }
      finally { if (delay === 16) (window as any).listCallbacks.push(performance.now() - start); }
    }, delay)) as typeof window.setTimeout;
  });
  await stubTauri(page, { entries: [{ path: 'dense.md', kind: 'file', size: text.length, mtime_ms: 0 }], files: { 'dense.md': text } });
  // 预算口径（M128）：单次 max 是负载敏感 flake——一次调度抖动就把与列表无关的
  // 改动打红（M119 r2 复核实证 master 亦间歇失败 1/4）。改为多轮加载采样后取 p95
  // （复用 scripts/perf 的 summarize，全仓唯一分位数实现），仍守"后台回调预算"语义。
  const rounds = 3;
  const durations: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    await page.goto('/');
    await page.locator('.ft-row[title="dense.md"]').click();
    await expect(page.locator('.cm-lp-list-marker').first()).toBeVisible({ timeout: 20000 });
    const sample: number[] = await page.evaluate(() => (window as any).listCallbacks);
    expect(sample.length, `第 ${round + 1} 轮 16ms 回调样本数`).toBeGreaterThan(190);
    durations.push(...sample);
  }
  const { p95, max } = summarize(durations);
  await info.attach('complete-callback-durations', { body: JSON.stringify({ p95, max, rounds, durations }), contentType: 'application/json' });
  expect(p95).toBeLessThan(40);
  await page.locator('.cm-scroller').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('.cm-lp-list-marker').filter({ hasText: '999999999.' })).toHaveText('999999999.[x]');
  expect(await readDocument(page)).toBe(text);
});

test('短编号标记区紧凑而非语法最大容量', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 800 });
  await open(page, '1. Short one\n2. Short two\n');
  const box = await page.locator('.cm-lp-list-line').first().evaluate(el => {
    const marker = el.querySelector('.cm-lp-list-marker')!;
    const text = marker.firstElementChild!.getBoundingClientRect();
    const outer = marker.getBoundingClientRect();
    return { marker: outer.width, text: text.width, gap: outer.right - text.right, line: el.getBoundingClientRect().width, available: el.getBoundingClientRect().width - parseFloat(getComputedStyle(el).paddingLeft) };
  });
  expect(box.marker - box.text).toBeCloseTo(box.gap, 0);
  expect(box.gap).toBeGreaterThan(3);
  expect(box.gap).toBeLessThan(12);
  expect(box.marker).toBeLessThan(35);
  // 行宽由 480px 定案改为窗格 80%（M100）后，可用文本宽不再对齐绝对像素阈值；
  // 约束不变：短编号标记区占行宽不足一成，九成以上留给正文
  expect(box.available).toBeGreaterThan(box.line * 0.9);
});
