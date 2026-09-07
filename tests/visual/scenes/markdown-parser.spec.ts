import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
let server: ViteDevServer;
let origin: string;
test.beforeAll(async () => {
  server = await createServer({ configFile: fileURLToPath(new URL('../fixtures/markdown-parser/vite.config.ts', import.meta.url)),
    root: fileURLToPath(new URL('../../../', import.meta.url)), server: { port: 0, strictPort: false } });
  await server.listen();
  origin = server.resolvedUrls!.local[0].replace(/\/$/, '');
});
test.afterAll(async () => { await server?.close(); });

const mixed = '# Header\n\n> quoted **strong**\n>\n> - first\n>   - nested\n\n<div class="x">\n<span>HTML</span>\n</div>\n\ninline <b>bold</b>\n\n```html\n<div>code</div>\n```\n\n| a | b |\n| - | - |\n| x | y |\n';
const table = '| key | value |\n| --- | --- |\n' + Array.from({ length: 14000 }, (_, i) => `| row ${i} | **cell ${i}** |`).join('\n');
for (const [name, doc] of [['mixed', mixed], ['14k-table', table], ['large-mixed', mixed.repeat(2000)]] as const) {
  test(`MarkdownConfig.wrap ${name}`, async ({ page }, info) => {
    const profiler = await page.context().newCDPSession(page);
    await profiler.send('Profiler.enable');
    await profiler.send('Profiler.start');
    await page.goto(`${origin}/tests/visual/fixtures/markdown-parser/index.html`);
    await page.waitForFunction(() => !!(window as any).experiment);
    await page.evaluate(doc => (window as any).experiment.open(doc), doc);
    await expect.poll(() => page.evaluate(() => (window as any).experiment.available()), { timeout: 30000 }).toBe(true);
    const { profile } = await profiler.send('Profiler.stop');
    await info.attach('cpu-profile', { body: JSON.stringify(profile), contentType: 'application/json' });
    const counts = new Map<number, number>();
    for (const sample of profile.samples ?? []) counts.set(sample, (counts.get(sample) ?? 0) + 1);
    const parents = new Map<number, number>();
    const byId = new Map(profile.nodes.map(node => [node.id, node]));
    for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
    const stack = (id: number): string[] => { const parent = parents.get(id); return [...(parent ? stack(parent) : []), byId.get(id)!.callFrame.functionName]; };
    console.log(name, 'cpu-top', profile.nodes.map(node => ({ stack: stack(node.id).join(' > '), count: counts.get(node.id) ?? 0 })).sort((a, b) => b.count - a.count).slice(0, 8));
    const comparison = await page.evaluate(() => (window as any).experiment.compare());
    expect(comparison.actual).toEqual(comparison.expected);
    const metrics = await page.evaluate(() => (window as any).experiment.metrics());
    await info.attach('metrics', { body: JSON.stringify(metrics), contentType: 'application/json' });
    console.log(name, JSON.stringify(Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, Array.isArray(value) ? Math.max(0, ...value) : value]))));
    expect(metrics.baseAdvances).toBe(0);
    await page.evaluate(() => (window as any).experiment.destroy());
  });
}

test('A/B/A and same-length documents cancel obsolete jobs', async ({ page }) => {
  await page.goto(`${origin}/tests/visual/fixtures/markdown-parser/index.html`);
  await page.waitForFunction(() => !!(window as any).experiment);
  await page.evaluate(({ table, mixed }) => {
    const api = (window as any).experiment;
    api.open(mixed); api.open(table); api.open(mixed);
  }, { table, mixed });
  await expect.poll(() => page.evaluate(() => (window as any).experiment.available())).toBe(true);
  const first = await page.evaluate(() => (window as any).experiment.compare());
  expect(first.actual).toEqual(first.expected);
  await page.evaluate(doc => (window as any).experiment.open(doc.replace('Header', 'Change')), mixed);
  await expect.poll(() => page.evaluate(() => (window as any).experiment.available())).toBe(true);
  const second = await page.evaluate(() => (window as any).experiment.compare());
  expect(second.actual).toEqual(second.expected);
  const metrics = await page.evaluate(() => (window as any).experiment.metrics());
  expect(metrics.cancellations).toBeGreaterThanOrEqual(2);
  expect(metrics.baseAdvances).toBe(0);
  await page.evaluate(doc => { (window as any).experiment.open(doc); (window as any).experiment.destroy(); }, table);
  expect(await page.evaluate(() => (window as any).experiment.metrics().activeWorkers)).toBe(0);
});

test('queued obsolete worker events do not affect the current document', async ({ page }) => {
  await page.goto(`${origin}/tests/visual/fixtures/markdown-parser/index.html`);
  await page.waitForFunction(() => !!(window as any).experiment);
  await page.evaluate(({ first, second }) => {
    const api = (window as any).experiment;
    api.open(first);
    api.open(second);
  }, { first: mixed, second: '# current' });
  await expect.poll(() => page.evaluate(() => (window as any).experiment.available())).toBe(true);
  await page.evaluate(() => (window as any).experiment.flushQueued());
  const result = await page.evaluate(() => (window as any).experiment.compare());
  expect(result.actual).toEqual(result.expected);
  expect(await page.evaluate(() => (window as any).experiment.status().fatal)).toBeFalsy();
  await page.evaluate(() => (window as any).experiment.destroy());
});

test('worker error retries and compartment reconfiguration completes', async ({ page }) => {
  await page.goto(`${origin}/tests/visual/fixtures/markdown-parser/index.html`);
  await page.waitForFunction(() => !!(window as any).experiment);
  await page.evaluate(doc => {
    const api = (window as any).experiment;
    api.failNext(); api.open(doc); api.mode('code'); api.mode('md');
  }, mixed);
  await expect.poll(() => page.evaluate(() => (window as any).experiment.available()), { timeout: 10000 }).toBe(true);
  const result = await page.evaluate(() => (window as any).experiment.compare());
  expect(result.actual).toEqual(result.expected);
  const metrics = await page.evaluate(() => (window as any).experiment.metrics());
  expect(metrics.retries).toBe(1);
  expect(metrics.activeWorkers).toBe(0);
  expect(await page.evaluate(() => (window as any).experiment.mode('code'))).toBe('code');
  await expect(page.locator('.cm-lineNumbers')).toBeVisible();
  expect(await page.evaluate(() => (window as any).experiment.mode('md'))).toBe('md');
  await expect(page.locator('.cm-lineNumbers')).toHaveCount(0);
  await page.evaluate(() => (window as any).experiment.reset());
  await expect.poll(() => page.evaluate(() => (window as any).experiment.available())).toBe(true);
  await page.evaluate(() => (window as any).experiment.destroy());
});

for (const fault of ['permanent', 'silent', 'messageerror', 'malformed']) {
  test(`bounded ${fault} failure allows a new document`, async ({ page }) => {
    await page.goto(`${origin}/tests/visual/fixtures/markdown-parser/index.html`);
    await page.waitForFunction(() => !!(window as any).experiment);
    await page.evaluate(({ fault, mixed }) => { const api = (window as any).experiment; api.fault(fault); api.open(mixed); }, { fault, mixed });
    await expect.poll(() => page.evaluate(() => (window as any).experiment.status().fatal), { timeout: 10000 }).toBeTruthy();
    expect(await page.evaluate(() => (window as any).experiment.metrics().activeWorkers)).toBe(0);
    expect(await page.evaluate(() => (window as any).experiment.available())).toBe(false);
    await page.evaluate(() => { const api = (window as any).experiment; api.fault(''); api.open('# recovered'); });
    await expect.poll(() => page.evaluate(() => (window as any).experiment.available())).toBe(true);
    const result = await page.evaluate(() => (window as any).experiment.compare());
    expect(result.actual).toEqual(result.expected);
    await page.evaluate(() => (window as any).experiment.destroy());
  });
}
