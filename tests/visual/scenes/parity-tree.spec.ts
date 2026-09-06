import { test, expect } from '@playwright/test';
import { stubTauri } from './tauri-stub';
for (const theme of ['light', 'dark', 'eink']) for (const height of [900, 600, 480]) {
  test(`长目录深层颜色 ${theme} ${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1000, height });
    const dirs = ['层一', '层一/层二', '层一/层二/层三', '层一/层二/层三/层四'];
    const paths = ['根.md', ...dirs, ...dirs.map(p => `${p}/笔记.md`), ...Array.from({length: 100}, (_,i)=>`长文件名-${String(i).padStart(3,'0')}-用于检查截断和滚动.md`)];
    await stubTauri(page, { entries: paths.map(path => ({path, kind: dirs.includes(path) ? 'dir' : 'file', size: 10, mtime_ms: 0})), files: {} });
    await page.addInitScript(t=>localStorage.setItem('lumir-theme',t),theme);
    await page.goto('/');
    for(const dir of dirs) await page.locator(`.ft-row[title="${dir}"]`).click();
    const styles=[];
    for(const [depth,p] of ['根.md',...dirs.map(p=>`${p}/笔记.md`)].entries()) {
      const row=page.locator(`.ft-row[title="${p}"]`);
      const actual=await row.evaluate(el=>{const label=el.querySelector('.ft-name')!;return {height:el.getBoundingClientRect().height,weight:getComputedStyle(label).fontWeight,color:getComputedStyle(label).color};});
      const expected=await page.evaluate(({theme,depth})=>{const e=document.createElement('span'); const ratio=[100,96,91,86,81][depth];e.style.color=theme==='eink'?'#000':depth===0?'var(--text)':`color-mix(in srgb, var(--text) ${ratio}%, var(--bg-nav))`;document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c;},{theme,depth});
      expect.soft(actual.height).toBe(27);expect.soft(actual.weight).toBe('400');expect.soft(actual.color).toBe(expected);styles.push({path:p,depth,...actual,expected});
    }
    await page.locator('.tree-pane').evaluate(el=>el.scrollTop=el.scrollHeight);
    await expect(page.locator('.ft-row[title="长文件名-099-用于检查截断和滚动.md"]')).toBeVisible();
    await expect(page.getByRole('button',{name:'+ 新建'})).toBeVisible();
    await info.attach('depth-styles',{body:JSON.stringify(styles,null,2),contentType:'application/json'});
    await page.screenshot({path:info.outputPath('long-tree.png')});
  });
}
