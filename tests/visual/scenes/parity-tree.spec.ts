import { test, expect } from '@playwright/test';
import { stubTauri } from './tauri-stub';
import { assertReachable } from './parity-checks';

// 长目录下的层级形态（restyle-ui-tokens-v1 后的口径）。
//
// 旧实现用**逐层运行期混色**的明度斜坡区分层级（`color-mix(in srgb, var(--text) 96%, --bg-nav)`
// 一类），随 token 层重建一并退场：定稿的层级靠两档灰 + 底色差 + 字重承担（见 src/style.css
// `.ft-dir` / `.ft-md` 一节与 docs/specs/design-tokens-v1.md）。因此本场景从「重算斜坡的期望色」
// 改为断言**族的形态读数**：行高、字重、颜色三者按文件类型分档，与层级深浅无关。
//
// 这里必须与 src/style.css 同源读数（`--layout-tree-row-h` / `--fw-*` / `--text`），不写死色值
// 字面量——写死等于在判据里复制一份 token 值，改 token 时两边会漂。
for (const height of [900, 600, 480]) {
  test(`长目录深层形态 ${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1000, height });
    const dirs = ['层一', '层一/层二', '层一/层二/层三', '层一/层二/层三/层四'];
    const paths = ['根.md', ...dirs, ...dirs.map(p => `${p}/笔记.md`), ...Array.from({length: 100}, (_,i)=>`长文件名-${String(i).padStart(3,'0')}-用于检查截断和滚动.md`)];
    await stubTauri(page, { entries: paths.map(path => ({path, kind: dirs.includes(path) ? 'dir' : 'file', size: 10, mtime_ms: 0})), files: { '长文件名-099-用于检查截断和滚动.md': '# 末项实际打开成功' } });
    await page.goto('/');
    for(const dir of dirs) await page.locator(`.ft-row[title="${dir}"]`).click();
    const tokens = await page.evaluate(() => {
      const probe = document.createElement('span');
      document.body.append(probe);
      probe.style.color = 'var(--text)';
      const text = getComputedStyle(probe).color;
      probe.remove();
      const row = document.querySelector('.ft-row') as HTMLElement;
      const cs = getComputedStyle(row);
      return {
        text,
        rowHeight: parseFloat(cs.height),
        regularWeight: cs.getPropertyValue('--fw-regular').trim(),
        mediumWeight: cs.getPropertyValue('--fw-medium').trim(),
      };
    });
    const styles=[];
    // 这一组全是**文件**行（`根.md` 与各层的 `笔记.md`）：文件档 = 常字重 + 正文色，
    // 层深只改缩进（行盒左缘），不改颜色与字重（旧斜坡已删除）。
    for(const [depth,p] of ['根.md',...dirs.map(p=>`${p}/笔记.md`)].entries()) {
      const row=page.locator(`.ft-row[title="${p}"]`);
      const actual=await row.evaluate(el=>{const label=el.querySelector('.ft-name')!;const rect=el.getBoundingClientRect();return {height:rect.height,left:rect.left,weight:getComputedStyle(label).fontWeight,color:getComputedStyle(label).color};});
      expect.soft(actual.height).toBe(tokens.rowHeight);
      expect.soft(actual.weight).toBe(tokens.regularWeight);
      expect.soft(actual.color).toBe(tokens.text);
      styles.push({path:p,depth,...actual});
    }
    // 目录行是同一形态的另一档（常字重 → 中字重），与层级深浅无关
    const dirWeight = await page.locator('.ft-row[title="层一/层二"]').evaluate(el=>getComputedStyle(el).fontWeight);
    expect(dirWeight).toBe(tokens.mediumWeight);
    // 缩进是层深的唯一可视化差异：8px 基准 + 14px × 层深（tokens 文档 §布局）。
    // 缩进由 ul 的 padding 承担（`.ft-root-list` 8 / `.ft-children` 14），因此读行盒左缘的**差**。
    const indentStep = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--layout-tree-indent-step')));
    expect(indentStep).toBeGreaterThan(0);
    for (const row of styles) {
      expect
        .soft(row.left - styles[0].left, `${row.path} 的层深缩进`)
        .toBeCloseTo(indentStep * row.depth, 1);
    }
    await page.locator('.tree-pane').evaluate(el=>el.scrollTop=el.scrollHeight);
    const last=page.locator('.ft-row[title="长文件名-099-用于检查截断和滚动.md"]');
    await assertReachable(last,'.tree-pane');
    await last.click();
    await expect(page.locator('.cm-content')).toContainText('末项实际打开成功');
    await info.attach('depth-styles',{body:JSON.stringify(styles,null,2),contentType:'application/json'});
    await page.screenshot({path:info.outputPath('long-tree.png')});
  });
}
