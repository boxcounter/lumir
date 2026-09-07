import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const require = createRequire(new URL('../../../tests/visual/package.json', import.meta.url));
const {chromium} = require('@playwright/test');
const browser = await chromium.launch({headless:true});
const fault = process.argv.includes('--fault-focus');
const results = [];
let failed = false;
try {
 for (const route of ['button','tab']) for (const theme of ['light','dark','eink']) for (const width of [850,480]) {
  const page = await browser.newPage({viewport:{width:920,height:780}});
  const result = {route,theme,width};
  try {
   await page.goto(`http://127.0.0.1:1472/${fault?'?fault-focus':''}`);
   await page.evaluate(({theme,width}) => { document.querySelector('main').style.maxWidth=`${width}px`; document.body.style.background=theme==='dark'?'#181818':'#fafafa';document.body.style.color=theme==='dark'?'#eee':'#202020'; const style=document.head.appendChild(document.createElement('style'));style.textContent=`[role=columnheader]{background:${theme==='dark'?'#303030':theme==='eink'?'#fff':'#e6edf5'}}`; },{theme,width});
   await page.waitForTimeout(100);
   result.geometry=await page.evaluate(()=>[...document.querySelectorAll('.table-row')].slice(0,3).map(row=>[...row.querySelectorAll('.cell')].map(cell=>{const r=cell.getBoundingClientRect();return{x:r.x,width:r.width,height:r.height}})));
   result.columnsAligned=!result.geometry.some(row=>row.length!==4||row.some((cell,i)=>cell.width!==240||Math.abs(cell.x-result.geometry[0][i].x)>1));
   if(route==='button') await page.getByRole('button',{name:'Focus table',exact:true}).click();
   else { for(let i=0;i<30;i++) {await page.keyboard.press('Tab');if(await page.evaluate(()=>document.activeElement?.matches('.table-scroll')))break;} }
   await page.waitForFunction(()=>document.activeElement?.matches('.table-scroll'),{},{timeout:2000});
   await page.keyboard.press('End');
   result.focus=await page.evaluate(()=>({active:document.activeElement?.className,left:document.querySelector('.table-scroll').scrollLeft,max:document.querySelector('.table-scroll').scrollWidth-document.querySelector('.table-scroll').clientWidth}));
   result.lastColumnReachable=result.focus.left===result.focus.max&&result.focus.active==='table-scroll';
   await page.keyboard.press('Escape');
   result.escapeToEditor=await page.evaluate(()=>document.activeElement?.classList.contains('cm-content'));
   result.pass=result.columnsAligned&&result.lastColumnReachable&&result.escapeToEditor;
  } catch(error) {result.error=String(error);result.pass=false;} finally {await page.close();}
  if(!result.pass)failed=true;
  results.push(result);
 }
} finally {
 await browser.close();
 const output={engine:'Supplemental Chromium, not native WK',freshPagePerCase:true,faultInjected: fault,themeScope:'probe color variants only; fixed240px, not production themes/performance',passed:!failed,results};
 await writeFile(new URL(`../../../openspec/changes/complete-markdown-reading/table-probe72-matrix${fault?'-fault':''}.json`,import.meta.url),JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify({cases:results.length,passed:results.filter(r=>r.pass).length,failed}));
 if(failed)process.exitCode=1;
}
