// Phase 2 原型校验：screen(1..10) × theme × （含控制面板态） —— 零 JS 错误、零横向溢出、零 pin/旧胶囊条残留
// 屏 5 附加结构断言：混排编辑区（chip 原子节点与问题文字交错 + #N 编号 + textarea 隐藏）、
//   transcript 用户消息 chip 编号与 agent 按编号作答、开发者预览序列化顺序（摘录1→问题1→摘录2→问题2）
// 屏 5 行为断言：「摘录到对话」把新胶囊插入当前光标处（重编号 + 预览更新）；× 移除后回落
// 用法：node design/prototypes/phase2-harness-chat/verify.mjs
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../../../tests/visual/package.json'));
const { chromium } = require('@playwright/test');

const root = dirname(fileURLToPath(import.meta.url));
const base = pathToFileURL(join(root, 'index.html')).href;

const screens = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const themes = ['light', 'dark', 'eink'];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

let failures = 0;
for (const screen of screens) {
  for (const theme of themes) {
    for (const panel of ['0', '1']) {
      const errors = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
      await page.goto(`${base}?screen=${screen}&theme=${theme}&panel=${panel}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(() => {
        const de = document.documentElement;
        return { scrollW: de.scrollWidth, innerW: window.innerWidth, bodyScrollW: document.body.scrollWidth };
      });
      // 结构断言：pin 与旧块级胶囊（.cap/.h-caps，M339 起被混排 chip 取代）全量移除后不得残留；
      // 屏 5 必须有完整混排结构（交错 + 编号 + 序列化）
      const structure = await page.evaluate((scr) => {
        const pinSel = '.pin-card, .att-pin, .att-q, .h-pins, .pins-hint, .pc-icon, .pc-main, .pc-src, .pc-ex, .pc-q, .pc-x, ' +
          '.doc li.pinned, .pin-flag, .pin-hover, .demo-pin-hover, .ap-src, .ap-ex, ' +
          '.h-caps, .caps-hint, .cap, .att-cap, .cap-x, .cap-src, .cap-ex, .cap-glyph, .cap-main, .cap-anchor';
        const pinResidue = !!document.querySelector(pinSel);
        let caps = true;
        const why = [];
        if (String(scr) === '5') {
          const ed = document.getElementById('h-editor');
          if (!ed || ed.getAttribute('contenteditable') !== 'true') why.push('混排编辑区缺失');
          // 交错：前四个有效节点必须是 chip / 非空文本 / chip / 非空文本（尾部追加形态会在此判红）
          const sig = ed ? Array.from(ed.childNodes).filter((n) =>
            n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim())) : [];
          const interleaved = sig.length >= 4 &&
            sig[0].nodeType === 1 && sig[0].classList.contains('chip') &&
            sig[1].nodeType === 3 && sig[1].textContent.trim().length > 0 &&
            sig[2].nodeType === 1 && sig[2].classList.contains('chip') &&
            sig[3].nodeType === 3 && sig[3].textContent.trim().length > 0;
          if (!interleaved) why.push('composer 非交错结构');
          const chips = ed ? Array.from(ed.querySelectorAll(':scope > .chip')) : [];
          if (!(chips.length >= 2 &&
                chips[0].querySelector('.chip-n').textContent === '#1' &&
                chips[1].querySelector('.chip-n').textContent === '#2')) why.push('composer 编号缺失');
          const ta = document.querySelector('.h-box textarea');
          if (!ta || getComputedStyle(ta).display !== 'none') why.push('屏 5 textarea 未隐藏');
          const txChips = document.querySelectorAll('.tx-b .msg.user .chip');
          if (!(txChips.length >= 2 &&
                txChips[0].querySelector('.chip-n').textContent === '#1' &&
                txChips[1].querySelector('.chip-n').textContent === '#2')) why.push('transcript 编号缺失');
          const agentTxt = (document.querySelector('.tx-b .msg:not(.user) .body') || {}).textContent || '';
          if (!(agentTxt.includes('摘录#1') && agentTxt.includes('摘录#2'))) why.push('agent 未按编号作答');
          const pv = (document.getElementById('dev-preview') || {}).textContent || '';
          const i1 = pv.indexOf('[摘录 #1]'), i2 = pv.indexOf('这段内容是什么意思？');
          const i3 = pv.indexOf('[摘录 #2]'), i4 = pv.indexOf('这里的「可执行动作」');
          if (!(i1 > -1 && i2 > i1 && i3 > i2 && i4 > i3 &&
                pv.includes('reading-workflow.md · 收集与筛选') && pv.includes('「先读结论再读论证')))
            why.push('序列化预览顺序/出处缺失');
          if (!document.querySelector('.quote-fab')) why.push('摘录钮缺失');
          caps = why.length === 0;
        }
        return { pinResidue, caps, why };
      }, screen);
      const wide = overflow.scrollW > overflow.innerW || overflow.bodyScrollW > overflow.innerW;
      const tag = `screen=${screen} theme=${theme} panel=${panel}`;
      if (errors.length || wide || structure.pinResidue || !structure.caps) {
        failures++;
        console.log(`FAIL ${tag}${wide ? ` 横向溢出 scrollW=${overflow.scrollW}/${overflow.bodyScrollW} > ${overflow.innerW}` : ''}`);
        if (structure.pinResidue) console.log('  pin/旧胶囊残留检出');
        (structure.why || []).forEach((w) => console.log(`  ${w}`));
        errors.forEach((e) => console.log(`  ${e}`));
      } else {
        console.log(`PASS ${tag}`);
      }
      page.removeAllListeners('pageerror');
      page.removeAllListeners('console');
    }
  }
}

// ---- 屏 5 行为断言（真交互）：光标处插入新胶囊 + 重编号 + 预览更新；× 移除后回落 ----
let behaviorFailures = 0;
{
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`${base}?screen=5&theme=light&panel=0`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);

  // 光标定位到 chip#1 与其问题文本之间，再点「摘录到对话」——新胶囊须落在光标处而非末尾
  await page.evaluate(() => {
    const ed = document.getElementById('h-editor');
    const textNode = Array.from(ed.childNodes).find((n) => n.nodeType === 3 && n.textContent.trim());
    const r = document.createRange();
    r.setStart(textNode, 0);
    r.collapse(true);
    ed.focus();
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.click('.quote-fab');
  const afterInsert = await page.evaluate(() => {
    const ed = document.getElementById('h-editor');
    const chips = Array.from(ed.querySelectorAll('.chip')).map((c) => c.querySelector('.chip-n').textContent);
    const pv = document.getElementById('dev-preview').textContent;
    const i2 = pv.indexOf('[摘录 #2]');
    const iq = pv.indexOf('这段内容是什么意思？');
    const i3 = pv.indexOf('[摘录 #3]');
    const i4 = pv.indexOf('这里的「可执行动作」');
    // 光标处插入：新 #2 块在问题1之前、#3 块在问题2之前；末尾追加形态（#3 落在问题2之后）在此判红
    return { chips, ok: chips.length === 3 && i2 > -1 && iq > i2 && i3 > iq && i4 > i3 };
  });
  if (errors.length || !afterInsert.ok ||
      afterInsert.chips.join(',') !== '#1,#2,#3') {
    behaviorFailures++;
    console.log(`BEHAVIOR FAIL 光标处插入 chips=[${afterInsert.chips}] ok=${afterInsert.ok}`);
    errors.forEach((e) => console.log(`  ${e}`));
  } else {
    console.log('BEHAVIOR PASS 摘录到对话→光标处插入并重编号');
  }

  // × 移除新插入的 chip：编号回落 #1/#2，预览不再含 #3
  await page.click('.h-editor .chip[data-cap="2"] .chip-x');
  const afterRemove = await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('#h-editor .chip')).map((c) => c.querySelector('.chip-n').textContent);
    const pv = document.getElementById('dev-preview').textContent;
    return { chips, has3: pv.includes('[摘录 #3]') };
  });
  if (afterRemove.chips.join(',') !== '#1,#2' || afterRemove.has3) {
    behaviorFailures++;
    console.log(`BEHAVIOR FAIL × 移除后回落 chips=[${afterRemove.chips}] has3=${afterRemove.has3}`);
  } else {
    console.log('BEHAVIOR PASS × 移除后编号与预览回落');
  }
  page.removeAllListeners('pageerror');
}

await browser.close();
const ok = failures === 0 && behaviorFailures === 0;
console.log(ok
  ? 'VERIFY RESULT: PASS (60/60 + 行为 2/2)'
  : `VERIFY RESULT: FAIL (结构 ${failures}, 行为 ${behaviorFailures})`);
process.exit(ok ? 0 : 1);
