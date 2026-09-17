import { expect, test } from '@playwright/test';
import { stubTauri } from './tauri-stub';
import { assertReachable, copyFresh, readDocument } from './parity-checks';

const opening = '读一篇长文，总会碰到几处卡顿。一个术语没有解释，一个论断缺少出处。';
const ordinary = '普通段落不再缩进，首行与后续行从相同位置开始。保留两端对齐与自然换行，不改变阅读源码。';
const source = `# 段落对齐\n\n${opening}\n\n${ordinary}\n这是同一段落的第二条源码行。\n\n短段。\n\n- 一级列表\n  - 二级列表\n`;

for (const viewport of [{ width: 1280, height: 900 }, { width: 640, height: 480 }]) {
  test(`普通段首对齐 ${viewport.width}`, async ({ page, context }, info) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.setViewportSize(viewport);
      await stubTauri(page, {
        entries: [{ path: 'paragraph.md', kind: 'file', size: source.length, mtime_ms: 0 }],
        files: { 'paragraph.md': source },
      });
      await page.goto('/');
      await page.locator('.ft-row[title="paragraph.md"]').click();
      const paragraph = page.locator('.cm-lp-paragraph-start').filter({ hasText: ordinary });
      await assertReachable(paragraph, '.cm-scroller');
      const geometry = await paragraph.evaluate(el => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const node = walker.nextNode()!;
        const first = document.createRange();
        first.setStart(node, 0); first.setEnd(node, 1);
        const style = getComputedStyle(el);
        return { firstX: first.getBoundingClientRect().x, left: el.getBoundingClientRect().x + parseFloat(style.paddingLeft), indent: style.textIndent, align: style.textAlign };
      });
      expect(geometry.indent).toBe('0px');
      expect(geometry.align).toBe('justify');
      expect(Math.abs(geometry.firstX - geometry.left)).toBeLessThan(0.5);
      await page.screenshot({ path: info.outputPath('paragraph.png') });
      await info.attach('geometry', { body: JSON.stringify({ viewport, geometry }), contentType: 'application/json' });
      // 选区断言此前是「一拍设、下一拍读」的两拍结构，全量负载下偶发读到塌成 "" 的选区
      //（CM 的装饰重建替换掉文本节点、Range 随之脱离；docs/backlog.md:70 的 finding）。
      // 现在「设选区 + 立即回读」在同一次 evaluate 内完成，并由 expect.poll 重试——
      // 每轮尝试都重设一次，单次装饰重建不再能让断言读到空选区。
      const selectHead = () => paragraph.evaluate(el => {
        const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
        if (node === null || node.nodeType !== Node.TEXT_NODE) return '';
        const text = node as Text;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, Math.min(8, text.length));
        const selection = window.getSelection();
        if (selection === null) return '';
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString();
      });
      await expect.poll(selectHead).toBe(ordinary.slice(0, 8));
      await page.evaluate(() => navigator.clipboard.writeText('paragraph-partial-sentinel'));
      // ⌘C 拷的是**当前实时选区**，所以这一路同样每轮先重设选区再按：否则上一拍塌掉的
      // 选区会让复制读到哨兵值，把时序缺陷报成无关 mission 的回归。
      await expect.poll(async () => {
        await selectHead();
        await page.keyboard.press('Meta+c');
        return page.evaluate(() => navigator.clipboard.readText());
      }).toBe(ordinary.slice(0, 8));
      await paragraph.click();
      expect(await copyFresh(page, 'paragraph-source-sentinel')).toBe(source);
      expect(await readDocument(page)).toBe(source);
    });
}
