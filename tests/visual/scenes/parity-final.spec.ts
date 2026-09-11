import { test, expect } from '@playwright/test';
import { stubTauri } from './tauri-stub';
import { readDocument, copyFresh, assertReachable } from './parity-checks';
for (const theme of ['light','dark','eink']) test(`最终长文短段只读 ${theme}`, async ({page,context},info)=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const text='# 标题\n\n短段。\n\n紧随下一段。\n\n'+Array.from({length:300},(_,i)=>`第${i}段 长文虚拟化与只读测试。`).join('\n\n');
  await stubTauri(page,{entries:[{path:'long.md',kind:'file',size:text.length,mtime_ms:0}],files:{'long.md':text}});
  await page.addInitScript(t=>localStorage.setItem('lumir-theme',t),theme);
  await page.goto('/');await page.locator('.ft-row[title="long.md"]').click();
  await expect(page.locator('.cm-content')).toContainText('短段。');
  const lines=page.locator('.cm-line');
  const short=lines.filter({hasText:'短段。'});const next=lines.filter({hasText:'紧随下一段。'});
  const rect=await short.boundingBox();const nrect=await next.boundingBox();
  expect(nrect!.y).toBeGreaterThan(rect!.y);
  await page.locator('.cm-content').click();
  expect(await copyFresh(page, `${theme}-before-edit`)).toBe(text);
  // md 自本地保存契约（f80ef8b）起可编辑：输入按设计进文档（旧断言来自 M1 只读时代）。
  // copyFresh 的全选先折叠到文末再输入，后续虚拟化断言仍依赖完整文档。
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('EDITED');
  expect(await readDocument(page)).not.toBe(text);
  expect(await readDocument(page)).toContain('第299段');
  await page.locator('.cm-scroller').evaluate(el=>el.scrollTop=el.scrollHeight);
  await assertReachable(lines.filter({hasText:'第299段'}), '.cm-scroller');
  await lines.filter({hasText:'第299段'}).click();
  expect(await lines.count()).toBeLessThan(300);
  await page.screenshot({path:info.outputPath('long-end.png')});
});
