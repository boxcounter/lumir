import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const require = createRequire(new URL('../../../tests/visual/package.json', import.meta.url));
const {chromium} = require('@playwright/test');
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:920,height:780}});
const results = [];
try {
 await page.goto('http://127.0.0.1:1472');
 for (const theme of ['light','dark','eink']) for (const width of [850,480]) {
  await page.getByRole('button',{name:'Small',exact:true}).click();
  await page.evaluate(({theme,width}) => { document.querySelector('main').style.maxWidth=`${width}px`; document.body.style.background=theme==='dark'?'#181818':'#fafafa';document.body.style.color=theme==='dark'?'#eee':'#202020'; const style=document.getElementById('matrix-theme')??document.head.appendChild(Object.assign(document.createElement('style'),{id:'matrix-theme'}));style.textContent=`[role=columnheader]{background:${theme==='dark'?'#303030':theme==='eink'?'#fff':'#e6edf5'}}`; },{theme,width});
  await page.waitForTimeout(100);
  const geometry=await page.evaluate(()=>{ const rows=[...document.querySelectorAll('.table-row')].slice(0,3);return rows.map(row=>[...row.querySelectorAll('.cell')].map(cell=>{const r=cell.getBoundingClientRect();return{x:r.x,width:r.width,height:r.height}}));});
  if(geometry.some(row=>row.length!==4||row.some((cell,i)=>cell.width!==240||Math.abs(cell.x-geometry[0][i].x)>1)))throw Error('column mismatch');
  await page.getByRole('button',{name:'Focus table',exact:true}).click(); await page.waitForFunction(()=>document.activeElement?.matches('.table-scroll')); await page.keyboard.press('End');
  const reach=await page.evaluate(()=>{const el=document.querySelector('.table-scroll');return el.scrollLeft===el.scrollWidth-el.clientWidth});
  const focusDiagnostic=await page.evaluate(()=>({active:document.activeElement?.className,scrollLeft:document.querySelector('.table-scroll').scrollLeft,max:document.querySelector('.table-scroll').scrollWidth-document.querySelector('.table-scroll').clientWidth}));
  console.log({theme,width,reach,focusDiagnostic});
  results.push({theme,width,geometry,lastColumnReachable:reach,focusDiagnostic});
 }
 const samples=[];
 for(let i=0;i<5;i++) {const start=performance.now();await page.getByRole('button',{name:'Large',exact:true}).click();await page.getByRole('button',{name:'Middle',exact:true}).click();await page.waitForTimeout(100);samples.push(performance.now()-start);}
 await page.getByRole('button',{name:'Measure',exact:true}).click();
 const large=JSON.parse(await page.locator('#report').innerText());
 if(large.renderedRows>=large.totalRows||!large.docUnchanged)throw Error('virtualization/document failed');
 const output={engine:'Playwright Chromium supplemental, NOT native WK or product theme validation',themeScope:'probe color variants only; fixed 240px columns; no production typography',results,large:{length:large.length,renderedRows:large.renderedRows,totalRows:large.totalRows,metadataMs:large.metadataMs,viewport:large.viewport},loadAndMiddleIncluding100msWait:samples,performanceScope:'diagnostic samples, no production perf threshold claim'};
 await writeFile(new URL('../../../openspec/changes/complete-markdown-reading/table-probe72-matrix.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify({cases:results.length,large:output.large}));
} finally {await browser.close();}
