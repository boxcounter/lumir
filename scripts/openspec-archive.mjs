#!/usr/bin/env node
// scripts/openspec-archive.mjs —— `openspec archive` 的包装器：调真实 archive 命令，随后只修
// 「归档把目录移深一层」造成的相对链接死链。
//
// 背景（finding 20261028-worker-archive-harness-activit…）：`openspec archive` 把 change 目录移进
// `openspec/changes/archive/<日期>-<id>/`（深一层）却不重写制品内的相对链接。活跃期按
// `../../../docs/…` 写的链接归档后落到 `openspec/docs/…`，`scripts/openspec-links.sh` 判红——
// 现场 M787 归档 3 秒后 docs-check 报 3 条不可达，只能手工改深一层再提交。
//
// 修复落在写侧（finding 的方案②「读侧按少一层的基准解析」被否：那会让真死链假绿，links 判据的
// 本意正是抓真实死链）。只有一条规则：对归档目录下每份 *.md 的每条 markdown 相对链接（候选口径
// 与 scripts/openspec-links.sh 一致），逐条验证
//     当前目标（按归档后的真实目录解析）不可达 且 前加一层 `../` 后可达
// 才把目标改成 `../<原目标>`。其余一律不动：
//   - 当前可达（change 内部相对链接、已修过一次的链接）：不动，再跑一次也不会二次改写；
//   - 前加一层仍不可达：不动——归档前就是死链，交给 links 判据抓，包装器不遮蔽真死链；
//   - 要加两层才可达：不动（最小修复，不替作者猜深度）；
//   - 外链 / 纯锚点 / 行内代码跨度 / 围栏代码块 / 非路径占位词：不进判据。
//
// 「失败显式非零」：archive 命令非零、归档目录定位不到、修完仓内链接门禁仍红，都直接非零退出。
// 判红/判绿一律交给真门禁（最后跑 scripts/openspec-links.sh），包装器不另写一份判定，避免
// 「同一语义两处真源」（REVIEW.md 同条）。
//
// 用法：node scripts/openspec-archive.mjs <change-id> [传给 openspec archive 的额外参数…]
// 依赖：node 内置模块 + bash，不引入第三方包（与 openspec-archive-check.mjs 同口径）。
// 判据的区分度测试：node --test scripts/openspec-archive.test.mjs（已接入 scripts/docs-check.sh）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// CLI 版本是全仓唯一约定（docs/process/openspec-workflow.md 的归档步骤与 gate.sh 的 validate 同版本）。
const ARCHIVE_CMD = ['npx', '--yes', '@fission-ai/openspec@1.12.0', 'archive'];
const LINK_GATE = 'scripts/openspec-links.sh';
const EXTERNAL = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export function archiveArgs(changeId, extra = []) {
  return [...ARCHIVE_CMD, changeId, '--yes', ...extra];
}

// 行内代码跨度抹成等长空格：偏移量不变，扫描 `](目标)` 时跳过它们，替换时仍回原文取位置。
// 与 scripts/openspec-links.sh 的 awk 同口径——那里的做法是把 `…` 抹成空白再找 `](`。
export function maskCodeSpans(line) {
  // split('') 按 UTF-16 码元切，与 indexOf / slice 的偏移口径一致（[...line] 会按键位切，emoji 会错位）。
  const chars = line.split('');
  let i = 0;
  while (i < chars.length) {
    if (chars[i] !== '`') {
      i++;
      continue;
    }
    const close = line.indexOf('`', i + 1);
    if (close < 0) {
      // 落单的反引号：只抹掉它本身，行内其余部分照常参与扫描（不整行放弃）。
      chars[i] = ' ';
      i++;
      continue;
    }
    for (let k = i; k <= close; k++) chars[k] = ' ';
    i = close + 1;
  }
  return chars.join('');
}

// 一行里的 `](目标)` 候选：start / end 是目标在**原文**行里的半开区间。目标截到第一个
// `)` / 空格 / 制表符（与 scripts/openspec-links.sh 同口径），故 `[x](a.md "标题")` 只取 `a.md`。
export function scanLineLinks(line) {
  const masked = maskCodeSpans(line);
  const links = [];
  let from = 0;
  for (;;) {
    const open = masked.indexOf('](', from);
    if (open < 0) break;
    const start = open + 2;
    let end = start;
    while (end < masked.length) {
      const c = masked[end];
      if (c === ')' || c === ' ' || c === '\t') break;
      end++;
    }
    if (end > start) links.push({ start, end, target: line.slice(start, end) });
    from = end;
  }
  return links;
}

// 相对链接的分类：返回 null 表示不归本判据管（外链 / 纯锚点 / 非路径占位词——都是正文里的示意
// 例子或仓外目标，口径逐条对齐 scripts/openspec-links.sh 的三类豁免）。
export function classifyTarget(target) {
  let inner = target;
  let wrapped = false;
  if (inner.length >= 2 && inner.startsWith('<') && inner.endsWith('>')) {
    wrapped = true;
    inner = inner.slice(1, -1);
  }
  if (EXTERNAL.test(inner)) return null;
  if (inner.startsWith('#')) return null;
  const hash = inner.indexOf('#');
  const pathPart = hash < 0 ? inner : inner.slice(0, hash);
  if (pathPart === '') return null;
  // 非路径形态的裸占位词（无 `/` 且末段无扩展名，如 `[title](link)`、`[配置](配置)`）。
  if (!pathPart.includes('/') && !pathPart.includes('.')) return null;
  return { wrapped, pathPart, fragment: hash < 0 ? '' : inner.slice(hash) };
}

function renderTarget(info, newPath) {
  const inner = `${newPath}${info.fragment}`;
  return info.wrapped ? `<${inner}>` : inner;
}

function markdownFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(p));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// 只改「当前不可达且前加一层 ../ 可达」的目标；返回 { repaired, remaining, files, links }，
// remaining 是修复规则不覆盖、仍交给门禁判红的链接（诊断用，不是判定依据）。
export function repairArchivedLinks(archivedDir, root = process.cwd()) {
  const files = markdownFiles(archivedDir);
  const repaired = [];
  const remaining = [];
  let links = 0;
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const dir = path.dirname(file);
    let inFence = false;
    let dirty = false;
    lines.forEach((line, idx) => {
      if (/^[ \t]*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;
      const edits = [];
      for (const link of scanLineLinks(line)) {
        const info = classifyTarget(link.target);
        if (!info) continue;
        links++;
        if (fs.existsSync(path.join(dir, info.pathPart))) continue;
        // 加一层 ../ 时顺手吃掉开头的 ./，免得改出 `.././x` 这种等价但难看的写法。
        const up = `../${info.pathPart.startsWith('./') ? info.pathPart.slice(2) : info.pathPart}`;
        if (!fs.existsSync(path.join(dir, up))) {
          remaining.push({ file: path.relative(root, file), line: idx + 1, target: link.target });
          continue;
        }
        const to = renderTarget(info, up);
        edits.push({ start: link.start, end: link.end, text: to });
        repaired.push({ file: path.relative(root, file), line: idx + 1, from: link.target, to });
      }
      if (edits.length === 0) return;
      let out = line;
      for (const edit of edits.sort((a, b) => b.start - a.start)) {
        out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
      }
      lines[idx] = out;
      dirty = true;
    });
    if (dirty) fs.writeFileSync(file, lines.join('\n'));
  }
  return { repaired, remaining, files: files.length, links };
}

// 仓内相对链接门禁的真实现（scripts/openspec-links.sh）。判定只认它的退出码：包装器不复制判据。
export function linkGate(root = ROOT) {
  try {
    const output = execFileSync('bash', [path.join(root, LINK_GATE)], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, output };
  } catch (err) {
    return { status: typeof err.status === 'number' ? err.status : 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function defaultExec(args, cwd) {
  execFileSync(args[0], args.slice(1), { cwd, stdio: 'inherit' });
}

// `openspec archive` + 归档后修链。exec 可注入（测试用假 archive 命令模拟「整体移进 archive/」）。
export function archiveChange({ changeId, extra = [], root = ROOT, exec = defaultExec, log = console.log }) {
  const changesRoot = path.join(root, 'openspec/changes');
  const changeDir = path.join(changesRoot, changeId);
  if (!fs.existsSync(changeDir)) {
    throw new Error(`找不到活跃 change：${path.relative(root, changeDir)}（已归档或 id 写错）`);
  }
  const archiveRoot = path.join(changesRoot, 'archive');
  const before = new Set(fs.existsSync(archiveRoot) ? fs.readdirSync(archiveRoot) : []);
  const args = archiveArgs(changeId, extra);
  log(`openspec-archive: ${args.join(' ')}`);
  try {
    exec(args, root);
  } catch (err) {
    // 失败必须显式：不吞错误；若 change 目录已被搬走，提示现场可能部分执行（本次不做链接修复）。
    const hint = fs.existsSync(changeDir)
      ? '（change 目录仍在原位）'
      : '（change 目录已不在原位——archive 可能已部分执行，先核现场再处理；本次未做链接修复）';
    throw new Error(`openspec archive 失败：${err && err.message ? err.message : err}${hint}`);
  }
  const added = (fs.existsSync(archiveRoot) ? fs.readdirSync(archiveRoot) : []).filter(
    (name) => !before.has(name) && name.endsWith(`-${changeId}`),
  );
  if (added.length !== 1) {
    throw new Error(`归档后无法唯一定位归档目录：openspec/changes/archive/ 下新增 ${added.length} 个 '*-${changeId}'（archive 命令没执行或输出异常）`);
  }
  const archivedDir = path.join(archiveRoot, added[0]);
  const result = repairArchivedLinks(archivedDir, root);
  log(`openspec-archive: 已归档到 ${path.relative(root, archivedDir)}/`);
  for (const r of result.repaired) log(`  INFO 修链 ${r.file}:${r.line}：${r.from} → ${r.to}`);
  for (const r of result.remaining) log(`  INFO 未修（规则不覆盖，留给链接门禁判）${r.file}:${r.line}：${r.target}`);
  log(`openspec-archive: 归档后修链 ${result.repaired.length} 处（扫过 ${result.files} 篇 Markdown / ${result.links} 条相对链接）`);
  return { archivedDir, args, ...result };
}

function usage() {
  console.log('用法：node scripts/openspec-archive.mjs <change-id> [传给 openspec archive 的额外参数…]');
  console.log('  归档 change 并只修「当前不可达且前加一层 ../ 可达」的相对链接；修完跑 scripts/openspec-links.sh，');
  console.log('  红即非零退出（真死链不遮蔽）。规则与背景见文件头与 docs/process/openspec-workflow.md「归档链接修复」。');
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    usage();
    return args.length === 0 ? 2 : 0;
  }
  archiveChange({ changeId: args[0], extra: args.slice(1), root: ROOT });
  const gate = linkGate(ROOT);
  process.stdout.write(gate.output);
  if (gate.status !== 0) {
    console.log('::error::归档已完成但仓内相对链接门禁仍红（scripts/openspec-links.sh）——按上面的 file:line 修或回退本次归档，本次结果不要提交');
    return 1;
  }
  console.log('openspec-archive: PASS（归档完成，仓内相对链接门禁绿）');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv);
  } catch (err) {
    console.log(`::error::openspec-archive 运行失败：${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  }
}
