#!/usr/bin/env node
// scripts/backlog-check.mjs — docs/backlog.md 的出口门禁（机器判定「条目该不该还在」）。
//
// 背景（Alex 2026-10-24 裁决，M692）：backlog 第二次涨到 299 行，根因不是「人不自觉」，而是规则
// 只覆盖入口、不覆盖出口——「核销即删除」只是文字，行数红线是文件级滞后闹钟且有「已查即过」的
// 免死口。本脚本把出口做成机器判据，挂在 scripts/docs-check.sh 里，本地 `gate.sh quick` 与 CI 的
// docs-check.yml 同时继承同一份实现（REVIEW.md「同一语义两处真源」条）。
//
// 判据（区块由 `## ` 标题分类；一条 bullet 一行，续行不参与判定——backlog 维护规则「一行一题」）：
//   - work（标题含 `待修` / `已立项` / `待真机验收`）：每条必须有一处出口标记（`下一动作：` /
//     `出口：` / `关闭条件` / `→`），缺则 FAIL；出现完成标记（已修 / 已核销 / 已落地 / 已收口 /
//     已接账 / 已解决 / 已关闭 / 已完成）仍留条目也 FAIL——「修好就删条目」不留给下一批清理。
//   - record（标题含 `记录在案` / `承接残项` / `长期口径`）：长期口径必须落到 canonical 居所——
//     有出口，或至少一个 canonical 指针（docs/ openspec/ src/ src-tauri/ scripts/ tests/ demo/
//     .github/ 下的仓内路径），或写 `复核：` 口径；canonical 指针不存在 ⇒ FAIL（死指针）。
//   - decision（标题含 `待 Alex 裁决` / `#decide`）与 queue（标题含 `归档跟踪队列`）：不判出口。
//     前者由 Alex 裁，后者由 scripts/openspec-archive-check.mjs 判条目在场。
//   - 未识别区块：只 WARN，不判红——新区块须显式归类，否则出口判据会静默漏掉一整块。
//
// 全区块适用：
//   - finding 指针（`.tower/comms/findings/<slug>.md` 或 `finding `<slug>``）重复 ⇒ FAIL；
//     指向的文件不存在 ⇒ FAIL（死指针）。`.tower/` 不入 git，CI 检出里没有该目录——**目录整体
//     缺失时只 INFO 跳过**，不把「读不到」当「指针丢了」（REVIEW.md「读不到当成空」条）。
//   - `.local/` 指针缺失只 WARN：`.local` 是本地证据桶、会随清理轮换（.local/README.md）；
//     整个 `.local` 不存在（CI 检出 / 未生成本地证据）时同样只 INFO 跳过。
//   - 行数：docs/backlog.md 超过 80 行 ⇒ FAIL（Alex 2026-10-24 自 300 下调）。硬上限，无 ratchet、
//     无既有豁免；不为压行数删活条目（该删的是已完成 / 无出口的僵尸条目）。
//   - 年龄与无出口计数只进报告，不判红（Alex：「条目年龄先作为报告指标」）。
//
// 已知边界：文本级判据，只认本文件定义的区块标题与标记写法；判据覆盖的是「条目是否该退出」，
// 不判条目内容是否正确（那是 review 的事）。
//
// 测试：node --test scripts/backlog-check.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LINE_CAP = 80;

const CLOSURE_MARKERS = ['已修', '已核销', '已落地', '已收口', '已接账', '已解决', '已关闭', '已完成'];
const CLOSURE_RE = new RegExp(CLOSURE_MARKERS.join('|'), 'g');
// 出口标记：backlog 既有写法是 `→ 下一动作：…`（M691 统一过），`#check` 条目用 `）→ 真机复跑…`
// 的简写；`出口：` / `关闭条件` 是新条目的显式口径。箭头后面必须是空白——中文行文里的
// `关→再开` 这类内联箭头不是出口标记（否则判据退化成「含箭头就放行」，REVIEW.md「断言等价于
// 子串，没有区分度」条）。
const EXIT_RE = /下一动作[:：]|出口[:：]|关闭条件|→\s/;
const REVIEW_RE = /复核[:：]|复核口径/;
const CANONICAL_ROOTS = /^(docs|openspec|src|src-tauri|scripts|tests|demo|\.github)\//;
const FINDING_PATH_TOKEN = /`\.tower\/comms\/findings\/([^`]+)`/g;
const FINDING_SLUG_TOKEN = /\bfinding\s+`([0-9]{8}-[a-z0-9-]+)(?:\.md)?`/g;
const LOCAL_TOKEN = /`(\.local\/[^`]+)`/g;
const DATE_RE = /\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/;

// --- 解析 ---

export function classifySection(title) {
  if (/待\s*Alex\s*裁决|#decide/.test(title)) return 'decision';
  if (/承接残项|记录在案|长期口径/.test(title)) return 'record';
  if (/归档(跟踪)?队列/.test(title)) return 'queue';
  if (/待修|已立项|待真机验收/.test(title)) return 'work';
  return 'other';
}

// 条目 = 顶格 `- ` 列表项（backlog 的「一行一题」写法）；区块 = 最近一个 `## ` 标题。
export function parseBacklog(text) {
  const sections = [];
  let cur = { title: null, kind: 'header', entries: [] };
  text.split('\n').forEach((line, idx) => {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (cur.title !== null || cur.entries.length) sections.push(cur);
      cur = { title: heading[1], kind: classifySection(heading[1]), entries: [] };
      return;
    }
    const bullet = /^- (.*)$/.exec(line);
    if (bullet) cur.entries.push({ line: idx + 1, text: bullet[1] });
  });
  if (cur.title !== null || cur.entries.length) sections.push(cur);
  return sections;
}

export function countLines(text) {
  if (text === '') return 0;
  const parts = text.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts.length;
}

const hasExit = (text) => EXIT_RE.test(text);

// `src/foo.ts:12-34` / `docs/x.md` 这类仓内路径；剥掉行号后缀与尾斜杠。
export function canonicalPath(token) {
  const t = token.trim().replace(/[:：]\d+(?:-\d+)?$/, '').replace(/\/+$/, '');
  if (!CANONICAL_ROOTS.test(t) || /\s/.test(t)) return null;
  return t;
}

export function findingSlugs(text) {
  const slugs = new Set();
  for (const m of text.matchAll(FINDING_PATH_TOKEN)) {
    slugs.add(path.basename(m[1].trim()).replace(/\.md$/, ''));
  }
  for (const m of text.matchAll(FINDING_SLUG_TOKEN)) slugs.add(m[1]);
  return [...slugs];
}

export function localPointers(text) {
  const out = [];
  for (const m of text.matchAll(LOCAL_TOKEN)) out.push(m[1].trim().replace(/\/+$/, ''));
  return out;
}

export function entryDate(text) {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// 日期按 UTC 零点算整天差，避免时区 / 夏令时把边界日算偏。
function dayNumber(value) {
  if (value instanceof Date) return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) throw new Error(`日期格式须为 YYYY-MM-DD：${value}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function ageBucket(days) {
  if (days <= 14) return '0-14';
  if (days <= 30) return '15-30';
  if (days <= 60) return '31-60';
  return '>60';
}

// --- 判定 ---

// text 为 docs/backlog.md 全文；root 用于解析 canonical / .local 指针，findingsDir 单独可注入
//（CI 与 worktree 没有 .tower/，目录缺失时只 INFO 跳过，不冒充死指针）。
export function checkBacklog(text, options = {}) {
  const {
    root = ROOT,
    today = new Date(),
    findingsDir = path.join(root, '.tower', 'comms', 'findings'),
    localRoot = path.join(root, '.local'),
    lineCap = LINE_CAP,
  } = options;

  const problems = [];
  const warnings = [];
  const infos = [];
  const sections = parseBacklog(text);
  const entries = sections.flatMap((s) => s.entries.map((e) => ({ ...e, kind: s.kind, section: s.title })));
  const add = (kind, line, message) => problems.push({ kind, line, message });

  const sectionCounts = { decision: 0, work: 0, record: 0, queue: 0, other: 0 };
  const findingRefs = new Map(); // slug -> [行号]
  const ageBuckets = { '0-14': 0, '15-30': 0, '31-60': 0, '>60': 0 };
  let undated = 0;
  let oldest = null;
  let noExit = 0;
  let recordEntries = 0;
  let recordWithExit = 0;
  let recordWithReview = 0;
  let localRefs = 0;
  const now = dayNumber(today);

  for (const section of sections) {
    if (section.kind === 'other') {
      warnings.push({ kind: 'unknown-section', message: `未归类区块「${section.title}」——出口判据不覆盖它；请用已知区块标题（待修 / 已立项 / 待真机验收 / 记录在案 / 待 Alex 裁决 / 归档跟踪队列）` });
    }
    for (const entry of section.entries) {
      const { line, text: body } = entry;
      const kind = section.kind;
      if (kind in sectionCounts) sectionCounts[kind]++;

      // 年龄只统计进报告，永不判红。
      const date = entryDate(body);
      if (date) {
        const days = Math.max(0, Math.floor((now - dayNumber(date)) / 86400000));
        ageBuckets[ageBucket(days)]++;
        if (!oldest || days > oldest.days) oldest = { date, days };
      } else {
        undated++;
      }

      if (kind === 'work') {
        const closure = body.match(CLOSURE_RE);
        if (closure) {
          add('closure-marker', line, `条目标注完成（命中「${closure[0]}」）却仍留在待办区——核销即删除，修复 PR 同批删除对应条目（docs/backlog.md 维护规则 / openspec-workflow「批次收尾 checklist」）`);
        }
        if (!hasExit(body)) {
          noExit++;
          add('missing-exit', line, '活项缺少出口——没有「下一动作：」/「出口：」/「关闭条件」/「→」，条目无法判定何时关闭');
        }
      }

      if (kind === 'record') {
        recordEntries++;
        const withExit = hasExit(body);
        if (withExit) recordWithExit++;
        if (REVIEW_RE.test(body)) recordWithReview++;
        const pointers = [...body.matchAll(/`([^`]+)`/g)].map((m) => canonicalPath(m[1])).filter(Boolean);
        for (const p of pointers) {
          if (!fs.existsSync(path.join(root, p))) {
            add('dead-canonical-pointer', line, `记录在案条目的 canonical 指针「${p}」不存在（死指针）——指向真实居所，或删除该条目`);
          }
        }
        if (!withExit && pointers.length === 0 && !REVIEW_RE.test(body)) {
          add('missing-record-home', line, '记录在案条目既无出口、也无 canonical 指针 / 复核口径——长期口径必须落到 canonical 居所（docs/ 或 openspec/）');
        }
      }

      for (const slug of findingSlugs(body)) {
        const lines = findingRefs.get(slug) ?? [];
        lines.push(line);
        findingRefs.set(slug, lines);
      }

      // `.local` 指针相对证据根解析（默认 <root>/.local ⇒ 相对 <root>）；显式注入 --local-root
      //（主仓跑 worktree 里的脚本）时同样以它的父目录为根。
      for (const ptr of localPointers(body)) {
        localRefs++;
        if (!fs.existsSync(localRoot)) continue;
        if (!fs.existsSync(path.join(path.dirname(localRoot), ptr))) {
          warnings.push({ kind: 'missing-local', line, message: `.local 证据指针「${ptr}」不存在——只 WARN（.local 随清理轮换，.local/README.md）；如确已轮换，改写指针或删掉「证据在 .local」的说法` });
        }
      }
    }
  }

  // finding 指针：重复与死指针。目录整体缺失时跳存在性核对（CI / worktree 没有 .tower/）。
  const findingsRel = path.relative(root, findingsDir);
  const findingsDisplay = findingsRel && !findingsRel.startsWith('..') ? findingsRel : findingsDir;
  const findingsDirExists = fs.existsSync(findingsDir) && fs.statSync(findingsDir).isDirectory();
  if (findingRefs.size > 0 && !findingsDirExists) {
    infos.push(`跳过 finding 指针存在性核对（${findingsDisplay} 不存在：.tower/ 不入 git，CI 检出与 worktree 都看不到）`);
  }
  for (const [slug, lines] of findingRefs) {
    if (lines.length > 1) {
      add('duplicate-finding', lines[0], `finding 指针「${slug}」重复出现在第 ${lines.join('、')} 行——同一 finding 只能有一条活条目（删除重复条目，而不是各写一份）`);
    }
    if (findingsDirExists && !fs.existsSync(path.join(findingsDir, `${slug}.md`))) {
      for (const line of lines) {
        add('missing-finding', line, `finding 指针「${slug}」在 ${findingsDisplay}/ 下不存在（死指针）——改指真实 finding，或删掉该指针`);
      }
    }
  }
  if (localRefs > 0 && !fs.existsSync(localRoot)) {
    const localDisplay = path.relative(root, localRoot) || localRoot;
    infos.push(`跳过 .local 指针核验（${localDisplay} 不存在：本地证据桶不入 git，CI 检出里没有；此状态不判红）`);
  }
  if (findingRefs.size === 0 && fs.existsSync(findingsDir)) {
    infos.push('docs/backlog.md 没有 finding 指针（.tower/comms/findings/ 下不核对）');
  }

  const lines = countLines(text);
  if (lines > lineCap) {
    add('line-cap', null, `docs/backlog.md 有 ${lines} 行，超过硬上限 ${lineCap} 行——先做结构清理（删已完成 / 无出口条目）；不为压行数删活条目。无 ratchet、无既有豁免`);
  }

  return {
    problems,
    warnings,
    infos,
    stats: {
      lines,
      lineCap,
      sectionCounts,
      entries: entries.length,
      noExit,
      recordEntries,
      recordWithExit,
      recordWithReview,
      findings: findingRefs.size,
      findingsDirExists,
      ageBuckets,
      undated,
      oldest,
    },
  };
}

// --- 报告 ---

const KIND_LABEL = {
  'closure-marker': '完成标记未删',
  'missing-exit': '活项缺出口',
  'duplicate-finding': 'finding 指针重复',
  'missing-finding': 'finding 死指针',
  'dead-canonical-pointer': 'canonical 死指针',
  'missing-record-home': '记录在案无居所',
  'line-cap': '行数超限',
};

function report(result, fileRel) {
  for (const p of result.problems) {
    const where = p.line ? `第 ${p.line} 行：` : '';
    console.log(`::error file=${fileRel}::${where}${p.message}`);
  }
  for (const w of result.warnings) {
    const where = w.line ? `第 ${w.line} 行：` : '';
    console.log(`WARN ${fileRel} ${where}${w.message}`);
  }
  for (const i of result.infos) console.log(`  INFO ${i}`);

  const st = result.stats;
  const age = st.ageBuckets;
  const oldest = st.oldest ? `${st.oldest.date}（${st.oldest.days} 天）` : '无';
  console.log(
    `backlog-check: 年龄分布 0–14 天 ${age['0-14']}｜15–30 天 ${age['15-30']}｜31–60 天 ${age['31-60']}｜>60 天 ${age['>60']}｜未标日期 ${st.undated}；最老 ${oldest}；活项无出口 ${st.noExit}；记录在案 ${st.recordEntries} 条（有出口 ${st.recordWithExit} / 带复核口径 ${st.recordWithReview}）——年龄仅报告，不判红`,
  );

  if (result.problems.length === 0) {
    console.log(
      `backlog-check: PASS（${fileRel} ${st.lines}/${st.lineCap} 行；活项 ${st.sectionCounts.work} 条均有出口；记录在案 ${st.recordEntries} 条合规；finding 指针 ${st.findings} 条不重复${st.findingsDirExists ? '且存在' : '（目录缺失，存在性未核）'}）`,
    );
    return 0;
  }
  const counts = new Map();
  for (const p of result.problems) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
  const detail = [...counts].map(([kind, n]) => `${KIND_LABEL[kind] ?? kind} ${n}`).join(' / ');
  console.log(`backlog-check: FAIL（${result.problems.length} 处：${detail}）`);
  return 1;
}

function main(argv) {
  const args = argv.slice(2);
  let file = path.join(ROOT, 'docs/backlog.md');
  let today = new Date();
  let root = ROOT;
  let findingsDir;
  let localRoot;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--file') file = path.resolve(args[++i]);
    else if (a === '--root') root = path.resolve(args[++i]);
    else if (a === '--today') today = args[++i];
    else if (a === '--findings-dir') findingsDir = path.resolve(args[++i]);
    else if (a === '--local-root') localRoot = path.resolve(args[++i]);
    else if (a === '-h' || a === '--help') {
      console.log('用法：node scripts/backlog-check.mjs [--file <docs/backlog.md>] [--root <repo>] [--today YYYY-MM-DD] [--findings-dir <dir>] [--local-root <dir>]');
      console.log('  默认读 docs/backlog.md，按区块判出口 / 完成标记 / finding 指针 / 80 行上限；脚本由 scripts/docs-check.sh 调用。');
      console.log('  --root：canonical 指针的解析根（默认仓库根）。');
      console.log('  --today：把年龄报告固定在某天（复盘 / 测试用）。');
      console.log('  --findings-dir / --local-root：本地证据根；目录不存在时只 INFO 跳过，不判死指针。');
      return 0;
    } else {
      console.log(`未知参数：${a}（--help 看用法）`);
      return 2;
    }
  }
  const fileRel = path.relative(ROOT, file) || file;
  if (!fs.existsSync(file)) {
    console.log(`::error file=${fileRel}::找不到 ${fileRel}，backlog 出口门禁无法运行`);
    return 1;
  }
  const result = checkBacklog(fs.readFileSync(file, 'utf8'), {
    root,
    today,
    ...(findingsDir ? { findingsDir } : {}),
    ...(localRoot ? { localRoot } : {}),
  });
  return report(result, fileRel);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv);
  } catch (err) {
    console.log(`::error::backlog-check 运行失败：${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  }
}
