#!/usr/bin/env node
// scripts/openspec-archive-check.mjs — OpenSpec 归档对账：MODIFIED requirement 的静默丢段面
// + 归档队列面（tasks 全勾的活跃 change 是否已进 docs/backlog.md 的归档跟踪队列）。
//
// 背景（finding 20261018-worker-m566）：`openspec archive`（1.12.0，无 dry-run / diff，`archive --help`
// 只有 --yes / --skip-specs / --no-validate / --json）对 MODIFIED requirement 的做法是**整块替换**——
// living spec 里该条 requirement 的正文与场景全被 delta 的同名块覆盖。于是 delta 少抄的段落会在归档时
// 静默消失，`validate --all --strict` 与 docs-check 都看不见（两者只看结构与链接，不看 requirement 段落
// 是否被截）。现场：add-harness-chat-completions-dialect 的「会话本地留存」漏抄一段 847 字符的既有正文，
// 归档后从 openspec/specs/harness/spec.md 消失，事后人工恢复。对账口径见
// docs/process/openspec-workflow.md「MODIFIED 是整块替换」节。
//
// 判据（段落级 diff，不是文本相似度打分）：把 living requirement 的段落与 delta 同名块按**逐字相等**
// 做最长公共子序列对齐，逐 gap 看「删」与「增」：
//   - gap 里删减段落被增补段落按相似度（字符 5-gram Dice ≥ 0.4）配对、或剩余的删增数目相等时按位置
//     1:1 配对 ⇒ 判「改写」：内容在 delta 里看得见，放行；
//   - 剩下的删减段落 = **静默删除**：delta 没有任何替代内容，归档会把它从 living spec 里抹掉 ⇒ 报红，
//     除非在 delta 文件首个 `## ` 之前用声明行显式认领：
//         > 归档对账声明：删除「<该段里 8 字以上的原样片段>」
//     一个声明行里的每个「…」片段只认领含该片段的段落（片段写错 ⇒ 照旧报红，只会假红不会假绿）。
//
// 两种模式：
//   1. 默认（门禁模式）：扫活跃 change（openspec/changes/*，不含 archive/）的每个 delta，对同名
//      living requirement 做上面的对账。挂在 scripts/docs-check.sh 里 ⇒ 本地 `gate.sh quick` 与 CI 的
//      docs-check.yml 同时继承同一份判据（REVIEW.md「同一语义两处真源」条）。
//   2. `--archived <change-id>`（事后审计）：在 git 里定位该 change 的归档提交 C，把 C^ 的 living spec
//      当快照、C 归档后的 living spec 当结果，逐条检查静默删除的段落是否真的丢了——归档当场还在的
//      报 INFO「已人工恢复」，当场丢了但当前 HEAD 已含的报 INFO「后续提交补回」，真丢了才报红
//      （findings 的 847 字符段现场就落在第一档：delta 漏抄、但归档提交里已恢复）。同时核对 delta
//      自身的段落是否完整落进了归档后的 living spec（CLI 少并 / 并错即报红）。
//
// 已知边界（诚实标注，不当判据用）：删增段落在**同一 gap 里数目相等**时按位置配对判「改写」，故
// 「删一段、同位置增一段无关内容」会被当作改写放行；这类改动在 PR diff 里是可见的，不属本脚本守的
// 静默丢失面。
//
// 归档队列面（2026-10-24，M684）：规则出处是 docs/process/openspec-workflow.md「批次收尾 checklist
// （归档跟踪）」的「每个 change 在实现 PR 合并时即落一条归档跟踪记录」。人读规则整批漏记过一次
// （oct24 批 11 个 change 在 docs/backlog.md 里零条目，M682 补账；另有 6 个已完成 change 从未进过任何
// 队列，M684 补登），故门禁模式同时判台账：
//   - **完成判定**：tasks.md 的 checkbox 行（`- [x]` / `- [ ]`，`]` 之后是否紧跟正文不限——既有
//     tasks 有 `- [ ]（归档时执行…）` 这种无空格写法）全部勾选且至少一项 ⇒ 完成。零任务项不判完成
//     （避免空真放行；tasks.md 本身缺失才报红，制品完整性另有 validate 兜底）。
//   - **条目判定**：docs/backlog.md 里一行列表项，加粗首段**恰好**是 `序 N · `<change-id>``（新批次可
//     省略「序 N ·」，只写 `<change-id>`），即 `- **序 3 · `scrollbar-tiers-oct24`**（…）`。正文里的
//     提及不算条目（如「外部前置」段落），否则判据退化成子串匹配（REVIEW.md「断言等价于子串，没有
//     区分度」条）。同一 change 两条即判重复。
//   - **活跃面按位置判**：只有 openspec/changes/ 的直接子目录是活跃 change；撤回件在
//     changes/archive/<日期>-withdrawn-<id>/ 之下，天然不在扫描面。不按名字里的 `withdrawn` / `archive`
//     字样过滤——活跃 id 恰好含这些字样时仍是活跃 change。
//   - 本判据只判台账在场：不判节点 2 是否通过、不判归档顺序、不执行 archive。
//
// 依赖：node 内置模块 + git，不引入第三方包（CI 的 docs-check.yml 直接 `bash scripts/docs-check.sh`，
// ubuntu runner 自带 node；同目录 openspec-links.sh 是纯 bash 的同类判据）。
// 判据的区分度测试（真丢段 / 整段改写 / 声明认领 / 场景整块丢失 / 队列缺失与重复 / 撤回件与提及不误报）：
//   node --test scripts/openspec-archive-check.test.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DELTA_SECTIONS = /^(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\b/i;
const DECLARATION_MARK = '归档对账声明';
const SIMILAR = 0.4;

// --- 解析 ---

// 把 spec 文本拆成 requirement 块。delta 文件里每块记下所属的 `## XXX Requirements` 段；
// living spec 里 section 为 null（其 requirement 都在 `## Requirements` 之下）。
export function parseSpec(text) {
  const requirements = [];
  let section = null;
  let cur = null;
  const flush = () => {
    if (cur) {
      requirements.push(cur);
      cur = null;
    }
  };
  for (const line of text.split('\n')) {
    const sectionMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (sectionMatch) {
      flush();
      const kind = DELTA_SECTIONS.exec(sectionMatch[1]);
      section = kind ? kind[1].toUpperCase() : null;
      continue;
    }
    if (/^### Requirement: /.test(line)) {
      flush();
      cur = { section, name: line.replace(/^### Requirement: /, '').trim(), lines: [line] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  flush();
  return requirements;
}

const normalize = (s) => s.replace(/\s+/g, ' ').trim();

// requirement 块 → 段落数组（空行分段；`### Requirement:` 标题行本身不算段落，
// 但它下面的 `#### Scenario:` 标题行另起一段——场景名与场景内容都参与对账）。
export function paragraphs(blockLines) {
  const out = [];
  let buf = [];
  for (const line of blockLines.slice(1)) {
    if (line.trim() === '') {
      if (buf.length) {
        out.push(buf.join('\n'));
        buf = [];
      }
      continue;
    }
    buf.push(line);
  }
  if (buf.length) out.push(buf.join('\n'));
  return out;
}

// 声明行只在 requirement 块之外生效（块内写声明会被归档原样搬进 living spec）。
export function declaredSnippets(text) {
  const inBlock = new Set();
  let inside = false;
  text.split('\n').forEach((line, idx) => {
    if (/^### Requirement: /.test(line)) inside = true;
    else if (/^## /.test(line)) inside = false;
    if (inside) inBlock.add(idx);
  });
  const snippets = [];
  text.split('\n').forEach((line, idx) => {
    if (inBlock.has(idx) || !line.includes(DECLARATION_MARK)) return;
    for (const m of line.matchAll(/「([^」]+)」/g)) {
      const snippet = normalize(m[1]);
      if (snippet.length >= 8) snippets.push(snippet);
    }
  });
  return snippets;
}

const isDeclared = (paragraph, snippets) => snippets.some((s) => normalize(paragraph).includes(s));

function shingles(s, n = 5) {
  const t = normalize(s);
  const set = new Set();
  if (t.length === 0) return set;
  for (let i = 0; i + n <= t.length; i++) set.add(t.slice(i, i + n));
  if (t.length < n) set.add(t);
  return set;
}

export function dice(a, b) {
  const A = shingles(a);
  const B = shingles(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}

// 逐字相等的 LCS 对齐，输出 gap 序列：matched 之间的「删减 / 增补」簇。
export function alignGaps(living, delta) {
  const n = living.length;
  const m = delta.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = living[i] === delta[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const gaps = [];
  let cur = { dropped: [], added: [] };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && living[i] === delta[j]) {
      if (cur.dropped.length || cur.added.length) gaps.push(cur);
      cur = { dropped: [], added: [] };
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      cur.added.push(delta[j++]);
    } else {
      cur.dropped.push(living[i++]);
    }
  }
  if (cur.dropped.length || cur.added.length) gaps.push(cur);
  return gaps;
}

// 一个 gap 里哪些删减段落是「静默删除」：先按相似度配对（改写），剩余的删增按位置 1:1 配对
// （整段替换也算改写），仍落单的删减段落没有任何替代内容 ⇒ 静默删除。
export function silentDrops(livingParagraphs, deltaParagraphs) {
  const living = livingParagraphs.map(normalize).filter(Boolean);
  const delta = deltaParagraphs.map(normalize).filter(Boolean);
  const silent = [];
  const rewrites = [];
  for (const gap of alignGaps(living, delta)) {
    if (gap.dropped.length === 0) continue;
    const usedDrop = new Set();
    const usedAdd = new Set();
    const candidates = [];
    gap.dropped.forEach((d, di) => {
      gap.added.forEach((a, ai) => candidates.push([dice(d, a), di, ai]));
    });
    candidates.sort((x, y) => y[0] - x[0]);
    for (const [score, di, ai] of candidates) {
      if (score < SIMILAR || usedDrop.has(di) || usedAdd.has(ai)) continue;
      usedDrop.add(di);
      usedAdd.add(ai);
      rewrites.push({ dropped: gap.dropped[di], added: gap.added[ai], score });
    }
    const restDrop = gap.dropped.map((_, i) => i).filter((i) => !usedDrop.has(i));
    const restAdd = gap.added.map((_, i) => i).filter((i) => !usedAdd.has(i));
    const swaps = Math.min(restDrop.length, restAdd.length);
    for (let k = 0; k < swaps; k++) {
      usedDrop.add(restDrop[k]);
      rewrites.push({ dropped: gap.dropped[restDrop[k]], added: gap.added[restAdd[k]], score: dice(gap.dropped[restDrop[k]], gap.added[restAdd[k]]) });
    }
    gap.dropped.forEach((d, i) => {
      if (!usedDrop.has(i)) silent.push(d);
    });
  }
  return { silent, rewrites };
}

export function checkDelta(deltaText, livingText) {
  const livingByName = new Map(parseSpec(livingText).map((b) => [b.name, b]));
  const snippets = declaredSnippets(deltaText);
  const problems = [];
  const rewrites = [];
  const declaredDrops = [];
  let checked = 0;
  let compared = 0;
  for (const block of parseSpec(deltaText)) {
    if (block.section === 'ADDED') {
      if (livingByName.has(block.name)) {
        problems.push({ kind: 'added-exists', name: block.name, text: 'ADDED requirement 与 living spec 同名（归档会静默覆盖整条既有 requirement）' });
      }
      continue;
    }
    if (block.section === 'REMOVED') {
      if (!livingByName.has(block.name)) {
        problems.push({ kind: 'removed-missing', name: block.name, text: 'REMOVED 指向的 requirement 不在 living spec 里（归档时是空操作）' });
      }
      continue;
    }
    if (block.section !== 'MODIFIED') continue;
    const living = livingByName.get(block.name);
    if (!living) {
      problems.push({ kind: 'modified-missing', name: block.name, text: 'MODIFIED 指向的 requirement 不在 living spec 里' });
      continue;
    }
    checked++;
    const livingParas = paragraphs(living.lines);
    const deltaParas = paragraphs(block.lines);
    compared += livingParas.length;
    const { silent, rewrites: rw } = silentDrops(livingParas, deltaParas);
    rewrites.push(...rw.map((r) => ({ name: block.name, ...r })));
    for (const para of silent) {
      if (isDeclared(para, snippets)) {
        declaredDrops.push({ name: block.name, paragraph: normalize(para) });
        continue;
      }
      problems.push({ kind: 'silent-drop', name: block.name, paragraph: normalize(para) });
    }
  }
  return { problems, rewrites, declaredDrops, checked, compared };
}

// delta 的每个 requirement 块（MODIFIED / ADDED）都应逐段落进归档后的 living spec。
function unlandedDeltaParagraphs(deltaText, afterText) {
  const afterByName = new Map(parseSpec(afterText).map((b) => [b.name, b]));
  const unlanded = [];
  for (const block of parseSpec(deltaText)) {
    if (block.section !== 'MODIFIED' && block.section !== 'ADDED') continue;
    const post = afterByName.get(block.name);
    if (!post) {
      unlanded.push({ name: block.name, missingRequirement: true });
      continue;
    }
    const landed = new Set(paragraphs(post.lines).map(normalize));
    for (const para of paragraphs(block.lines)) {
      const n = normalize(para);
      if (n && !landed.has(n)) unlanded.push({ name: block.name, paragraph: n });
    }
  }
  return unlanded;
}

// --- 归档队列 ---

// checkbox 行；`]` 后是否紧跟正文不限（既有 tasks 有 `- [ ]（归档时执行…）` 的写法，REVIEW.md
// 「断言等价于子串」条的近邻陷阱：要求 `]` 后有空格会把这类未勾项漏数成 0，进而把未完成判成完成）。
const TASK_ITEM = /^\s*[-*]\s+\[([^\]]*)\]/;
// 队列条目：列表项 + 加粗首段恰好是 `序 N · `<id>`` 或 `<id>`。正文提及不在判据内。
const QUEUE_ENTRY = /^\s*[-*]\s+\*\*(?:序\s*\d+\s*·\s*)?`([^`]+)`\*\*/;

export function taskProgress(text) {
  let total = 0;
  let done = 0;
  for (const line of text.split('\n')) {
    const m = TASK_ITEM.exec(line);
    if (!m) continue;
    total++;
    if (/^[xX]$/.test(m[1].trim())) done++;
  }
  return { total, done, open: total - done, complete: total > 0 && total === done };
}

// change-id → 出现的行号（1 基）。行号供「重复条目」报错直接定位。
export function archiveQueueEntries(text) {
  const entries = new Map();
  text.split('\n').forEach((line, idx) => {
    const m = QUEUE_ENTRY.exec(line);
    if (!m) return;
    const lines = entries.get(m[1]) ?? [];
    lines.push(idx + 1);
    entries.set(m[1], lines);
  });
  return entries;
}

// changes: [{ id, tasks }]，tasks 为 tasks.md 全文，读不到时传 null。
// 已完成（tasks 全勾）的活跃 change 必须有且仅有一条队列条目。
export function queueProblems(changes, backlogText) {
  const entries = archiveQueueEntries(backlogText);
  const problems = [];
  let checked = 0;
  for (const { id, tasks } of changes) {
    if (typeof tasks !== 'string') {
      problems.push({ kind: 'tasks-missing', id });
      continue;
    }
    const progress = taskProgress(tasks);
    if (!progress.complete) continue;
    checked++;
    const lines = entries.get(id) ?? [];
    if (lines.length === 0) problems.push({ kind: 'missing-entry', id, progress });
    else if (lines.length > 1) problems.push({ kind: 'duplicate-entry', id, lines, progress });
  }
  return { problems, checked };
}

// --- 文件与 git ---

const readFile = (p) => fs.readFileSync(p, 'utf8');

// 活跃 change = openspec/changes/ 的直接子目录（`archive` 除外）。撤回件在
// changes/archive/<日期>-withdrawn-<id>/ 之下，天然不在这里；不按名字里的 withdrawn / archive 字样判。
export function listActiveChanges(changesRoot) {
  if (!fs.existsSync(changesRoot)) return [];
  return fs
    .readdirSync(changesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'archive')
    .map((d) => d.name)
    .sort();
}

function listDeltaFiles(changesRoot) {
  const files = [];
  if (!fs.existsSync(changesRoot)) return files;
  for (const id of listActiveChanges(changesRoot)) {
    const specsDir = path.join(changesRoot, id, 'specs');
    if (!fs.existsSync(specsDir)) continue;
    for (const cap of fs.readdirSync(specsDir).sort()) {
      const delta = path.join(specsDir, cap, 'spec.md');
      if (fs.existsSync(delta)) files.push({ id, cap, delta });
    }
  }
  return files;
}

function shortPreview(text, limit = 80) {
  const t = normalize(text);
  return t.length > limit ? `${t.slice(0, limit)}…` : t;
}

function reportProblems(problems, deltaPath) {
  for (const p of problems) {
    if (p.kind === 'silent-drop') {
      const snippet = normalize(p.paragraph).slice(0, 30);
      console.log(`::error file=${deltaPath}::MODIFIED「${p.name}」静默删除 living spec 的段落（归档整块替换后会消失，${normalize(p.paragraph).length} 字）：${shortPreview(p.paragraph)}`);
      console.log(`    若确为本次删除，在 delta 首个 '## ' 之前加一行（块内写声明会被归档搬进 living spec）：`);
      console.log(`    > 归档对账声明：删除「${snippet}」`);
    } else {
      console.log(`::error file=${deltaPath}::${p.text}：${p.name}`);
    }
  }
}

function reportQueueProblems(problems, backlogRel) {
  for (const p of problems) {
    if (p.kind === 'missing-entry') {
      console.log(`::error file=${backlogRel}::活跃 change「${p.id}」tasks 已全部完成（${p.progress.total}/${p.progress.total}），但没有任何归档跟踪条目——按 docs/process/openspec-workflow.md「批次收尾 checklist（归档跟踪）」补一条：`);
      console.log(`    - **序 N · \`${p.id}\`**（M…，${p.progress.total}/${p.progress.total}）：<节点 2 状态 / 归档顺序 / 阻塞>`);
    } else if (p.kind === 'duplicate-entry') {
      console.log(`::error file=${backlogRel}::活跃 change「${p.id}」有 ${p.lines.length} 条归档跟踪条目（第 ${p.lines.join('、')} 行）——有且仅有一条，删到只剩一条`);
    } else {
      console.log(`::error file=openspec/changes/${p.id}/tasks.md::tasks.md 读不到，无法判定归档队列义务（该制品由 validate / docs-check.yml 的 openspec job 兜底）`);
    }
  }
}

// 归档队列面：已完成（tasks 全勾）的活跃 change 必须在 docs/backlog.md 有且仅有一条队列条目。
function checkArchiveQueue(changesRoot, backlogPath, targetChange) {
  if (!fs.existsSync(backlogPath)) {
    console.log(`::error file=${path.relative(ROOT, backlogPath)}::找不到 docs/backlog.md，归档队列无法对账`);
    return { problems: 1, checked: 0 };
  }
  const ids = listActiveChanges(changesRoot).filter((id) => !targetChange || id === targetChange);
  const changes = ids.map((id) => {
    const tasksPath = path.join(changesRoot, id, 'tasks.md');
    return { id, tasks: fs.existsSync(tasksPath) ? readFile(tasksPath) : null };
  });
  const result = queueProblems(changes, readFile(backlogPath));
  reportQueueProblems(result.problems, path.relative(ROOT, backlogPath));
  return { problems: result.problems.length, checked: result.checked };
}

function gateMode(targetChange) {
  const changesRoot = path.join(ROOT, 'openspec/changes');
  let files = listDeltaFiles(changesRoot);
  if (targetChange) files = files.filter((f) => f.id === targetChange);
  if (targetChange && files.length === 0) {
    console.log(`::error::找不到活跃 change '${targetChange}' 的 spec delta（openspec/changes/${targetChange}/specs/*/spec.md）`);
    return 1;
  }
  let problems = 0;
  let checked = 0;
  let compared = 0;
  let scanned = 0;
  for (const f of files) {
    const livingPath = path.join(ROOT, 'openspec/specs', f.cap, 'spec.md');
    if (!fs.existsSync(livingPath)) continue;
    const result = checkDelta(readFile(f.delta), readFile(livingPath));
    scanned++;
    checked += result.checked;
    compared += result.compared;
    if (result.problems.length) {
      problems += result.problems.length;
      reportProblems(result.problems, path.relative(ROOT, f.delta));
    }
  }
  const deltaProblems = problems;
  const queue = checkArchiveQueue(changesRoot, path.join(ROOT, 'docs/backlog.md'), targetChange);
  problems += queue.problems;
  const scope = targetChange ? `（--change ${targetChange}）` : '';
  if (problems) {
    console.log(`openspec-archive-check: FAIL（${problems} 处：静默丢段面 ${deltaProblems} / 归档队列面 ${queue.problems}；扫过 ${scanned} 份 delta，${checked} 条 MODIFIED，对比 ${compared} 段；已完成 change ${queue.checked} 项${scope}）`);
    return 1;
  }
  console.log(`openspec-archive-check: PASS（扫过 ${scanned} 份 delta，${checked} 条 MODIFIED，对比 ${compared} 段，无静默丢段；归档队列 ${queue.checked} 项已完成 change 均有唯一条目${scope}）`);
  return 0;
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function resolveArchivedDir(arg) {
  if (arg.includes('/')) {
    const dir = path.resolve(ROOT, arg);
    if (!fs.existsSync(dir)) throw new Error(`找不到目录：${arg}`);
    return dir;
  }
  const archiveRoot = path.join(ROOT, 'openspec/changes/archive');
  const hits = fs.readdirSync(archiveRoot).filter((name) => name.endsWith(`-${arg}`)).map((name) => path.join(archiveRoot, name));
  if (hits.length === 0) throw new Error(`openspec/changes/archive/ 下没有 '*-${arg}'`);
  if (hits.length > 1) throw new Error(`openspec/changes/archive/ 下有多个 '*-${arg}'：${hits.map((h) => path.basename(h)).join(', ')}`);
  return hits[0];
}

// 归档提交当场丢了的段落，可能是后续提交补回的——判 FAIL 前先看当前 HEAD 还在不在。
function inHead(livingRel, requirementName, paragraph) {
  let text;
  try {
    text = git(['show', `HEAD:${livingRel}`]);
  } catch {
    return false;
  }
  const requirement = parseSpec(text).find((b) => b.name === requirementName);
  if (!requirement) return false;
  return paragraphs(requirement.lines).map(normalize).includes(paragraph);
}

function archivedMode(arg, showRewrites) {
  const dir = resolveArchivedDir(arg);
  const dirRel = path.relative(ROOT, dir);
  const commit = git(['log', '--diff-filter=A', '--format=%H', '-1', '--', `${dirRel}/proposal.md`]).trim();
  if (!commit) {
    console.log(`::error::无法在 git 历史里定位 ${dirRel} 的归档提交（proposal.md 的首次加入提交）`);
    return 1;
  }
  const specsDir = path.join(dir, 'specs');
  if (!fs.existsSync(specsDir)) {
    console.log(`openspec-archive-check: PASS（${dirRel} 没有 specs/ 增量，无需对账）`);
    return 0;
  }
  let failures = 0;
  let restored = 0;
  let declared = 0;
  let compared = 0;
  let checked = 0;
  for (const cap of fs.readdirSync(specsDir).sort()) {
    const deltaPath = path.join(specsDir, cap, 'spec.md');
    if (!fs.existsSync(deltaPath)) continue;
    const livingRel = `openspec/specs/${cap}/spec.md`;
    let before;
    try {
      before = git(['show', `${commit}^:${livingRel}`]);
    } catch {
      console.log(`  INFO ${cap}：归档提交前没有 living spec（新建 capability），无基线可对账`);
      continue;
    }
    let after;
    try {
      after = git(['show', `${commit}:${livingRel}`]);
    } catch {
      console.log(`::error file=${livingRel}::归档提交 ${commit.slice(0, 8)} 里没有该 living spec（归档未并入增量？）`);
      failures++;
      continue;
    }
    const deltaText = readFile(deltaPath);
    const result = checkDelta(deltaText, before);
    checked += result.checked;
    compared += result.compared;
    if (showRewrites) {
      for (const rw of result.rewrites) {
        console.log(`  INFO ${cap} / ${rw.name}：改写（相似度 ${rw.score.toFixed(2)}）${shortPreview(rw.dropped, 60)}`);
      }
    }

    const afterByName = new Map(parseSpec(after).map((b) => [b.name, b]));

    for (const accounted of result.declaredDrops) {
      declared++;
      console.log(`  INFO ${cap} / ${accounted.name}：delta 漏抄的段落已由声明认领（${accounted.paragraph.length} 字）：${shortPreview(accounted.paragraph, 60)}`);
    }

    for (const problem of result.problems) {
      if (problem.kind === 'silent-drop') {
        const postParagraphs = afterByName.has(problem.name) ? paragraphs(afterByName.get(problem.name).lines).map(normalize) : [];
        const surviving = postParagraphs.includes(problem.paragraph);
        if (surviving) {
          restored++;
          console.log(`  INFO ${cap} / ${problem.name}：delta 漏抄的段落（${problem.paragraph.length} 字）在归档后仍在 living spec 里——已人工恢复，非丢段：${shortPreview(problem.paragraph, 60)}`);
        } else if (inHead(livingRel, problem.name, problem.paragraph)) {
          restored++;
          console.log(`  INFO ${cap} / ${problem.name}：归档提交 ${commit.slice(0, 8)} 当场丢了该段（${problem.paragraph.length} 字），当前 living spec 已含——后续提交补回：${shortPreview(problem.paragraph, 60)}`);
        } else {
          failures++;
          console.log(`::error file=${livingRel}::归档丢段：delta 未含、归档后 living spec 也缺失（${problem.paragraph.length} 字）${shortPreview(problem.paragraph, 60)}`);
          console.log(`    归档提交前的原文可用：git show ${commit}^:${livingRel}`);
        }
        continue;
      }
      failures++;
      reportProblems([problem], path.relative(ROOT, deltaPath));
    }

    // delta 自己的内容必须完整落进归档后的 living spec（CLI 少并 / 并错即报红）。
    for (const item of unlandedDeltaParagraphs(deltaText, after)) {
      failures++;
      if (item.missingRequirement) {
        console.log(`::error file=${livingRel}::delta 的 requirement「${item.name}」没有出现在归档后的 living spec 里`);
      } else {
        console.log(`::error file=${livingRel}::delta 段落未落进 living spec：${shortPreview(item.paragraph, 60)}`);
      }
    }
  }
  if (failures) {
    console.log(`openspec-archive-check: FAIL（${failures} 处 / ${dirRel}，${checked} 条 MODIFIED，对比 ${compared} 段）`);
    return 1;
  }
  console.log(`openspec-archive-check: PASS（${dirRel}：${checked} 条 MODIFIED，对比 ${compared} 段；人工恢复 ${restored} 段，声明认领 ${declared} 段）`);
  return 0;
}

function main(argv) {
  const args = argv.slice(2);
  let change = null;
  let archived = null;
  let showRewrites = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--change') change = args[++i];
    else if (a === '--archived') archived = args[++i];
    else if (a === '--verbose') showRewrites = true;
    else if (a === '-h' || a === '--help') {
      console.log('用法：node scripts/openspec-archive-check.mjs [--change <active-change-id>] [--archived <change-id|归档目录>] [--verbose]');
      console.log('  默认：门禁模式，扫所有活跃 change 的 delta 对账 living spec，并判已完成 change 的归档队列条目（scripts/docs-check.sh 调的就是这条）。');
      console.log('  --change：把上面两条判据都收窄到单个活跃 change。');
      console.log('  --archived：事后审计，用 git 里归档提交的前后快照核对是否真的丢了段落。');
      return 0;
    } else {
      console.log(`未知参数：${a}（--help 看用法）`);
      return 2;
    }
  }
  if (archived) return archivedMode(archived, showRewrites);
  return gateMode(change);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv);
  } catch (err) {
    console.log(`::error::openspec-archive-check 运行失败：${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  }
}
