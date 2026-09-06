import { expect, type Page, type Locator } from '@playwright/test';
export async function readDocument(page: Page): Promise<string> {
  return page.locator('.cm-content').evaluate(el => {
    const tile = (el as unknown as { cmTile?: { root: { view: { state: { doc: { toString(): string } } } } } }).cmTile;
    if (!tile) throw new Error('CodeMirror document inspection unavailable');
    return tile.root.view.state.doc.toString();
  });
}
export async function intersection(locator: Locator, container: string): Promise<boolean> {
  return locator.evaluate((el, selector) => {
    const host = el.closest(selector);
    if (!host) throw new Error('Scroll container not found');
    const a=el.getBoundingClientRect(), b=host.getBoundingClientRect();
    return Math.min(a.right,b.right,innerWidth)>Math.max(a.left,b.left,0) && Math.min(a.bottom,b.bottom,innerHeight)>Math.max(a.top,b.top,0);
  }, container);
}
export async function assertReachable(locator: Locator, container: string) {
  await expect.poll(()=>intersection(locator,container)).toBe(true);
}
export async function copyFresh(page: Page, sentinel: string): Promise<string> {
  await page.evaluate(value=>navigator.clipboard.writeText(value),sentinel);
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Meta+c');
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  expect(copied).not.toBe(sentinel);
  return copied;
}
