import { readdir, mkdir, copyFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const results = new URL("../../tests/visual/test-results/", import.meta.url);
const output = new URL("../../docs/design-parity-contract/evidence/", import.meta.url);
await mkdir(output, { recursive: true });
const sections = [];
for (const name of (await readdir(results)).filter(name => name.startsWith("parity-原型对照")).sort()) {
  for (const side of ["prototype", "production"]) await copyFile(new URL(`${name}/${side}.png`, results), new URL(`${name}-${side}.png`, output));
  sections.push(`<h2>${name}</h2><div><figure><figcaption>冻结原型，同fixture</figcaption><img src="${name}-prototype.png"></figure><figure><figcaption>生产 Chromium + IPC stub</figcaption><img src="${name}-production.png"></figure></div>`);
}
await writeFile(new URL("index.html", output), `<!doctype html><html lang="zh"><meta charset="utf-8"><title>M62 原型生产对照</title><style>body{font:14px system-ui;margin:16px}div{display:flex;gap:16px}figure{margin:0;width:50%}img{width:100%;border:1px solid #777}h2{margin-top:32px}</style><h1>M62 最终组合原型生产对照</h1><p>左原型，右生产。几何与功能结果见契约；保留导航结构差异，截图不代表标准性能通过。</p>${sections.join("")}</html>`);
console.log(fileURLToPath(new URL("index.html", output)));
