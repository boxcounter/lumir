// Phase 2 原型校验：screen(1..10) × theme × （含控制面板态） —— 零 JS 错误、零横向溢出、零 pin/旧胶囊条/旧 chip 残留
// 全部 60 组合：UI 渲染文本零 #N 编号残留（M340 r1 修：caps 判定移出屏 5 分支，非 5 屏不再吞 why）
// 屏 5 附加结构断言：block 引用卡片（竖条 + 摘录截断≤2 行 + 出处行 + ×）与问题段落上下交替、
//   XML 序列化预览（<quote index file heading lines> 四属性、lines 非空、index 严格递增、摘录→问题交错顺序）
// 屏 5 行为断言：「摘录到对话」把整张卡片插入当前光标处（段落拆分 + 预览更新）；× 移除后回落
// 反向验证 ×6：checkXml 对乱序 / 空 lines / 乱 index / 缺闭合 / 合法串 的判据区分度（Node 侧 5 条）
//   + 非 5 屏注入 #N 必须如实判红（浏览器侧 1 条，REVIEW.md 条 1；M340 r1 实证过的守卫缺口形态，固化为常驻探针）
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

// ---- 序列化预览的 XML 判据（Node 侧纯函数，结构断言与行为断言共用；反向验证针对它） ----
// 合法形态：每段摘录一行 <quote index="N" file=".." heading=".." lines="A-B">原文</quote>，
// 四属性齐全且 lines 非空，index 从 1 严格递增，摘录块与问题文字按 摘录1→问题1→摘录2→问题2 交错。
function checkXml(pv) {
  const tags = [...pv.matchAll(/<quote index="(\d+)" file="([^"]*)" heading="([^"]*)" lines="([^"]*)">/g)];
  if (tags.length < 2) return false;
  for (let i = 0; i < tags.length; i++) {
    if (Number(tags[i][1]) !== i + 1) return false;          // index 从 1 起严格递增
    if (!tags[i][2] || !tags[i][3] || !tags[i][4]) return false; // file / heading / lines 全非空
    const close = pv.indexOf('</quote>', tags[i].index);
    if (close === -1) return false;                          // 必须有闭合标签
    const body = pv.slice(tags[i].index + tags[i][0].length, close);
    if (!body.trim()) return false;                          // 摘录原文非空
  }
  const q1 = pv.indexOf('<quote index="1"');
  const t1 = pv.indexOf('这段内容是什么意思？');
  const q2 = pv.indexOf('<quote index="2"');
  const t2 = pv.indexOf('这里的「可执行动作」');
  return q1 > -1 && t1 > q1 && q2 > t1 && t2 > q2;           // 交错顺序：摘录1→问题1→摘录2→问题2
}

// ---- 反向验证（Node 侧）：以下输入必须被 checkXml 判红；任何一个漏判说明断言没有区分度 ----
{
  const good = '<quote index="1" file="reading-workflow.md" heading="收集与筛选" lines="9-10">先读结论再读论证——倒序阅读把大部分筛选成本压到开头两段</quote>\n' +
    '这段内容是什么意思？\n' +
    '<quote index="2" file="reading-workflow.md" heading="精读与笔记" lines="16-17">每篇笔记只留一个可执行动作，其余都是参考资料</quote>\n' +
    '这里的「可执行动作」指什么？';
  const bads = {
    '合法序列化被判红（判据本身出错）': !checkXml(good),
    '乱序（摘录2 抢在问题1 前）漏判': checkXml(
      '<quote index="1" file="reading-workflow.md" heading="收集与筛选" lines="9-10">先读结论再读论证</quote>\n' +
      '<quote index="2" file="reading-workflow.md" heading="精读与笔记" lines="16-17">每篇笔记只留一个可执行动作</quote>\n' +
      '这段内容是什么意思？\n这里的「可执行动作」指什么？'),
    'lines 为空漏判': checkXml(good.replace('lines="9-10"', 'lines=""')),
    'index 乱序（2 在 1 前）漏判': checkXml(
      '<quote index="2" file="reading-workflow.md" heading="精读与笔记" lines="16-17">每篇笔记只留一个可执行动作</quote>\n' +
      '这段内容是什么意思？\n' +
      '<quote index="1" file="reading-workflow.md" heading="收集与筛选" lines="9-10">先读结论再读论证</quote>\n' +
      '这里的「可执行动作」指什么？'),
    '缺闭合标签漏判': checkXml(good.replace('</quote>\n这里的', '\n这里的')),
  };
  const leaked = Object.entries(bads).filter(([, v]) => v).map(([k]) => k);
  if (leaked.length) {
    leaked.forEach((k) => console.log(`NEGATIVE FAIL ${k}`));
    console.log('VERIFY RESULT: FAIL (反向验证未通过，断言无区分度)');
    process.exit(1);
  }
  console.log('NEGATIVE PASS 反向验证 5/5（乱序/空 lines/乱 index/缺闭合/合法性 判据均有区分度）');
}

// ---- 页内结构断言（单一真源：主循环与非 5 屏 #N 探针共用同一个函数，防两处真源漂移） ----
// pin、旧块级胶囊（.cap/.h-caps）与旧 inline chip（M340 起被 block 引用卡片取代）全量移除后不得残留；
// 全部屏 UI 不得出现 #N 编号；屏 5 必须有完整卡片结构（竖条/截断/出处行/交替）与 XML 序列化。
// 注意：caps 判定必须对所有屏生效（why 非空即 false）——M340 r1：该判定曾只在屏 5 分支内赋值，
// 非 5 屏的 #N 被 why 吞掉照 PASS，下方浏览器侧探针防此形态回潮。
function structureCheck(scr) {
  const pinSel = '.pin-card, .att-pin, .att-q, .h-pins, .pins-hint, .pc-icon, .pc-main, .pc-src, .pc-ex, .pc-q, .pc-x, ' +
    '.doc li.pinned, .pin-flag, .pin-hover, .demo-pin-hover, .ap-src, .ap-ex, ' +
    '.h-caps, .caps-hint, .cap, .att-cap, .cap-x, .cap-src, .cap-ex, .cap-glyph, .cap-main, .cap-anchor, ' +
    '.chip, .chip-n, .chip-src, .chip-glyph, .chip-x';
  const pinResidue = !!document.querySelector(pinSel);
  // 去编号：渲染文本任何位置不得出现 #N（控制面板的「屏 5」等无 #；XML 预览里是 index="N" 不是 #N）
  const hashResidue = /#\d/.test(document.body.innerText);
  const why = [];
  if (hashResidue) why.push('UI 存在 #N 编号残留');
  if (String(scr) === '5') {
    const ed = document.getElementById('h-editor');
    if (!ed || ed.getAttribute('contenteditable') !== 'true') why.push('混排编辑区缺失');
    // 交替：顶层前四子节点必须是 卡片 / 问题段落 / 卡片 / 问题段落（尾部追加或 inline 形态在此判红）
    const sig = ed ? Array.from(ed.children) : [];
    const interleaved = sig.length >= 4 &&
      sig[0].classList.contains('qcard') &&
      sig[1].classList.contains('qpara') && sig[1].textContent.trim().length > 0 &&
      sig[2].classList.contains('qcard') &&
      sig[3].classList.contains('qpara') && sig[3].textContent.trim().length > 0;
    if (!interleaved) why.push('composer 非卡片/段落交替结构');
    // 卡片结构：竖条（可见宽度）+ 摘录截断≤2 行 + 出处行；卡片原子化（contenteditable=false）
    const cards = ed ? Array.from(ed.querySelectorAll(':scope > .qcard')) : [];
    if (cards.length < 2) why.push('composer 卡片缺失');
    cards.forEach((c) => {
      if (c.getAttribute('contenteditable') !== 'false') why.push('卡片未原子化');
      const bar = c.querySelector('.qc-bar');
      if (!bar || !(parseFloat(getComputedStyle(bar).width) > 0)) why.push('卡片竖条缺失');
      const ex = c.querySelector('.qc-ex');
      if (!ex || getComputedStyle(ex).webkitLineClamp !== '2') why.push('摘录未截断为两行');
      const src = c.querySelector('.qc-src');
      if (!src || !src.textContent.includes('reading-workflow.md') || !src.textContent.includes('·')) why.push('卡片出处行缺失');
      if (!c.querySelector('.qc-x')) why.push('composer 卡片缺 × 移除');
      if (!c.getAttribute('data-lines')) why.push('卡片缺 lines（行范围）');
    });
    const ta = document.querySelector('.h-box textarea');
    if (!ta || getComputedStyle(ta).display !== 'none') why.push('屏 5 textarea 未隐藏');
    // transcript：卡片与问题段落交替；无 ×（已发送不可移除）；无编号
    const txCards = document.querySelectorAll('.tx-b .msg.user .qcard');
    const txParas = document.querySelectorAll('.tx-b .msg.user .body > p');
    if (!(txCards.length >= 2 && txParas.length >= 2)) why.push('transcript 卡片/问题段落缺失');
    if (document.querySelector('.tx-b .qcard .qc-x')) why.push('transcript 卡片不应有 ×');
    txCards.forEach((c) => {
      const ex = c.querySelector('.qc-ex');
      if (!ex || getComputedStyle(ex).webkitLineClamp !== '2') why.push('transcript 摘录未截断为两行');
      if (!c.querySelector('.qc-bar') || !c.querySelector('.qc-src')) why.push('transcript 卡片竖条/出处行缺失');
    });
    const agentTxt = (document.querySelector('.tx-b .msg:not(.user) .body') || {}).textContent || '';
    if (!(agentTxt.includes('「倒序阅读」那段') && agentTxt.includes('「可执行动作」那段'))) why.push('agent 未按内容/出处回指');
    if (/摘录?#\d/.test(agentTxt)) why.push('agent 回复含编号残留');
    // XML 序列化预览（checkXml 的页内镜像：标签、四属性、lines 非空、交错顺序）
    const pv = (document.getElementById('dev-preview') || {}).textContent || '';
    const tags = [...pv.matchAll(/<quote index="(\d+)" file="([^"]*)" heading="([^"]*)" lines="([^"]*)">/g)];
    if (tags.length < 2) why.push('XML 预览 <quote> 标签缺失');
    tags.forEach((t, i) => {
      if (Number(t[1]) !== i + 1) why.push('XML index 非严格递增');
      if (!t[4]) why.push('XML lines 为空');
    });
    const q1 = pv.indexOf('<quote index="1"');
    const t1 = pv.indexOf('这段内容是什么意思？');
    const q2 = pv.indexOf('<quote index="2"');
    const t2 = pv.indexOf('这里的「可执行动作」');
    if (!(q1 > -1 && t1 > q1 && q2 > t1 && t2 > q2)) why.push('XML 交错顺序错误');
    if (!pv.includes('</quote>')) why.push('XML 缺闭合标签');
    const first = pv.slice(q1, pv.indexOf('</quote>', q1));
    if (!(q1 > -1 && first.includes('先读结论再读论证'))) why.push('XML 摘录原文缺失');
    if (!pv.includes('file="reading-workflow.md"') || !pv.includes('heading="收集与筛选"')) why.push('XML 出处属性缺失');
    if (/#\d/.test(pv)) why.push('XML 预览含 #N 残留');
    const dpLabel = (document.querySelector('.dp-label') || {}).textContent || '';
    if (!dpLabel.includes('仅原型调试用途，不进产品')) why.push('预览块缺「不进产品」标注');
    if (!document.querySelector('.quote-fab')) why.push('摘录钮缺失');
  }
  // caps 判定在屏分支之外：任何屏 why 非空（含 #N 残留）都判 false（M340 r1 修复点）
  const caps = why.length === 0;
  return { pinResidue, hashResidue, caps, why };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

// ---- 反向验证（浏览器侧）：非 5 屏注入 #N，structureCheck 必须如实判红 ----
// M340 r1 实证过的守卫缺口形态（caps 只在屏 5 生效时，此探针照 PASS）；探针用独立页面加载，无需还原。
{
  await page.goto(`${base}?screen=1&theme=light&panel=0`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    document.querySelector('.doc h1').textContent += ' #9'; // 屏 1 标题注入编号残留
  });
  const probe = await page.evaluate(structureCheck, 1);
  if (probe.caps || !probe.hashResidue) {
    console.log(`NEGATIVE FAIL 非 5 屏注入 #N 未判红（caps=${probe.caps} hashResidue=${probe.hashResidue}，守卫无区分度）`);
    await browser.close();
    process.exit(1);
  }
  console.log('NEGATIVE PASS 非 5 屏注入 #N 如实判红（全屏 #N 守卫有区分度）');
}

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
      const structure = await page.evaluate(structureCheck, screen);
      const wide = overflow.scrollW > overflow.innerW || overflow.bodyScrollW > overflow.innerW;
      const tag = `screen=${screen} theme=${theme} panel=${panel}`;
      if (errors.length || wide || structure.pinResidue || !structure.caps) {
        failures++;
        console.log(`FAIL ${tag}${wide ? ` 横向溢出 scrollW=${overflow.scrollW}/${overflow.bodyScrollW} > ${overflow.innerW}` : ''}`);
        if (structure.pinResidue) console.log('  pin/旧胶囊/旧 chip 残留检出');
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

// ---- 屏 5 行为断言（真交互）：光标处插入整张卡片（段落拆分）+ 序号刷新 + XML 预览更新；× 移除后回落 ----
let behaviorFailures = 0;
{
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`${base}?screen=5&theme=light&panel=0`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);

  // 光标定位到第一段的段首（卡片1 与问题1 之间），再点「摘录到对话」——
  // 新卡片须拆分段落落在光标处（卡片2 在问题1 之前），而非追加到末尾
  await page.evaluate(() => {
    const ed = document.getElementById('h-editor');
    const para = ed.querySelector('.qpara');
    const textNode = para.firstChild;
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
    // 顶层结构必须是 卡片/卡片/段落/卡片/段落（新卡片拆段插入），追加形态（卡片落在末尾）在此判红
    const sig = Array.from(ed.children).map((n) => n.classList.contains('qcard') ? 'C' : (n.textContent.trim() ? 'P' : '_'));
    const caps = Array.from(ed.querySelectorAll('.qcard')).map((c) => c.getAttribute('data-cap'));
    const pv = document.getElementById('dev-preview').textContent;
    const i2 = pv.indexOf('<quote index="2"');
    const iq = pv.indexOf('这段内容是什么意思？');
    const i3 = pv.indexOf('<quote index="3"');
    const i4 = pv.indexOf('这里的「可执行动作」');
    return { sig: sig.join(''), caps, ok: caps.length === 3 && i2 > -1 && iq > i2 && i3 > iq && i4 > i3 };
  });
  if (errors.length || !afterInsert.ok ||
      afterInsert.sig !== 'CCPCP' ||
      afterInsert.caps.join(',') !== '1,2,3') {
    behaviorFailures++;
    console.log(`BEHAVIOR FAIL 光标处插入 sig=${afterInsert.sig} caps=[${afterInsert.caps}] ok=${afterInsert.ok}`);
    errors.forEach((e) => console.log(`  ${e}`));
  } else {
    console.log('BEHAVIOR PASS 摘录到对话→光标处拆段插入整张卡片并刷新序号');
  }

  // × 移除新插入的卡片：序号回落 1/2，预览不再含 index="3"
  await page.click('.h-editor .qcard[data-cap="2"] .qc-x');
  const afterRemove = await page.evaluate(() => {
    const sig = Array.from(document.getElementById('h-editor').children)
      .map((n) => n.classList.contains('qcard') ? 'C' : (n.textContent.trim() ? 'P' : '_')).join('');
    const caps = Array.from(document.querySelectorAll('#h-editor .qcard')).map((c) => c.getAttribute('data-cap'));
    const pv = document.getElementById('dev-preview').textContent;
    return { sig, caps, has3: pv.includes('<quote index="3"') };
  });
  if (afterRemove.sig !== 'CPCP' || afterRemove.caps.join(',') !== '1,2' || afterRemove.has3) {
    behaviorFailures++;
    console.log(`BEHAVIOR FAIL × 移除后回落 sig=${afterRemove.sig} caps=[${afterRemove.caps}] has3=${afterRemove.has3}`);
  } else {
    console.log('BEHAVIOR PASS × 移除后结构与 XML 预览回落');
  }
  page.removeAllListeners('pageerror');
}

await browser.close();
const ok = failures === 0 && behaviorFailures === 0;
console.log(ok
  ? 'VERIFY RESULT: PASS (60/60 + 行为 2/2 + 反向 6/6)'
  : `VERIFY RESULT: FAIL (结构 ${failures}, 行为 ${behaviorFailures})`);
process.exit(ok ? 0 : 1);
