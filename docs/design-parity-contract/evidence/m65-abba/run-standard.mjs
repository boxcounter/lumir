import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
const empty=path.join(root,'empty-config');await mkdir(empty,{recursive:true});
if((await readdir(empty)).length)throw Error('XDG must be empty');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wk=()=>execFileSync('ps',['-axo','pid=,ppid=,rss=,comm='],{encoding:'utf8'}).split('\n').filter(x=>x.includes('com.apple.WebKit.')).map(x=>({pid:Number(x.trim().split(/\s+/)[0]),line:x.trim().replace(/\/Users\/[^/]+/g,'<home>')}));
const metadata={A:'c6cd5f8e38e1e4da94e75d1c2efab3bc849b243f',B:'73af31186cba554b9df36a5a246ed29e3d90d1fc',os:execFileSync('sw_vers',{encoding:'utf8'}),node:process.version,hardware:execFileSync('sysctl',['-n','hw.model','hw.memsize','machdep.cpu.brand_string'],{encoding:'utf8'}),config:JSON.parse(await readFile(path.join(root,'config.json'),'utf8')),build:'pnpm install --frozen-lockfile && pnpm build && TAURI_CONFIG=<config> cargo build --release --features custom-protocol --manifest-path src-tauri/Cargo.toml',runtime:'XDG_CONFIG_HOME=<same-empty-config> PERF_RESULTS_DIR=<round> PERF_MEM_SETTLE_MS=10000 PERF_MEM_SAMPLES=5 node scripts/perf/memory.mjs',diagnostic:'Only baseline and per-sample process capture added in exported scripts; original attribute/statistics/10s+5x2s unchanged',visibility:'Native windows launched normally without GUI actions or minimization; not independently measured per frame',limitations:'Nonexclusive macOS26 host; isolated identifier/incognito; not macos15 CI'};
await writeFile(path.join(root,'metadata.json'),JSON.stringify(metadata,null,2),{flag:'wx'});
for(const [i,version] of ['A','B','B','A'].entries()){
 const out=path.join(root,`standard-${i+1}-${version}`);await mkdir(out);
 const before=wk();const ids=new Set(before.map(x=>x.pid));
 const child=spawn(process.execPath,['scripts/perf/memory.mjs'],{cwd:path.join(root,version),env:{...process.env,XDG_CONFIG_HOME:empty,PERF_RESULTS_DIR:out,PERF_MEM_SETTLE_MS:'10000',PERF_MEM_SAMPLES:'5'},stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',x=>{log+=x;process.stdout.write(x)});child.stderr.on('data',x=>{log+=x;process.stderr.write(x)});
 const code=await new Promise((r,j)=>{child.on('error',j);child.on('exit',r)});
 await writeFile(path.join(out,'run.log'),log.replaceAll(root,'<paired-run>/'),{flag:'wx'});
 if(code!==0)throw Error(`round exit ${code}`);
 let remaining=[];
 for(let n=0;n<30;n++){remaining=wk().filter(p=>!ids.has(p.pid));if(!remaining.length)break;await sleep(1000)}
 await writeFile(path.join(out,'after-exit.json'),JSON.stringify({capturedAt:new Date().toISOString(),remainingNewWebKit:remaining},null,2),{flag:'wx'});
 if(remaining.length)throw Error('New WK remains; stop before next round, do not kill others');
 if((await readdir(empty)).length)throw Error('XDG no longer empty');
}
