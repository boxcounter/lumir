import { test, expect } from '@playwright/test';
import { stubTauri } from './tauri-stub';
import { readDocument, copyFresh, intersection } from './parity-checks';

test('反例：真实doc突变不会被旧clipboard或恢复后的内容掩盖',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const text='# 合成只读反例\n\n正文。';
  await stubTauri(page,{entries:[{path:'test.md',kind:'file',size:10,mtime_ms:0}],files:{'test.md':text}});
  await page.goto('/');await page.locator('.ft-row[title="test.md"]').click();await page.locator('.cm-content').click();
  expect(await copyFresh(page,'guard-initial')).toBe(text);
  await page.locator('.cm-content').evaluate(el=>{
    const view=(el as any).cmTile.root.view;
    view.dispatch({changes:{from:0,to:view.state.doc.length,insert:'CONTROLLED_VIOLATION'}});
  });
  expect(await readDocument(page)).not.toBe(text);
  expect(await readDocument(page)).toBe('CONTROLLED_VIOLATION');
  await page.evaluate(()=>document.addEventListener('copy',event=>{event.preventDefault();event.stopImmediatePropagation();},true));
  await expect(copyFresh(page,'guard-copy-blocked')).rejects.toThrow();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('guard-copy-blocked');
});

test('反例：CSS可见但被滚动区域裁剪的末项不可达',async({page})=>{
  await page.setContent('<div id="host" style="height:40px;width:100px;overflow:hidden"><div style="height:200px"></div><button id="last">末项</button></div>');
  const last=page.locator('#last');
  await expect(last).toBeVisible();
  expect(await intersection(last,'#host')).toBe(false);
  await page.locator('#host').evaluate(el=>el.scrollTop=el.scrollHeight);
  expect(await intersection(last,'#host')).toBe(true);
  await last.click();
});
