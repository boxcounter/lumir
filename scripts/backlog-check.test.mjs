// scripts/backlog-check.test.mjs —— backlog 出口门禁判据的区分度测试（node:test，零新增依赖）。
//
// 为什么与脚本同址（而不是 tests/unit/）：它守的是门禁脚本自己的判据，跑法与同目录的
// openspec-archive-check.test.mjs 一致（不进常驻门禁——判据本身已在 docs-check 里当门禁用）：
//   node --test scripts/backlog-check.test.mjs
//
// 纪律（REVIEW.md「断言等价于子串，没有区分度」条）：每条放行断言都配一个必须 FAIL 的输入——
// 完成标记逐个实测、缺出口 / 重复 finding / 死 finding / 死 canonical / 无居所、81 行 vs 80 行，
// 全部走同一份 checkBacklog 实现，不用「看着像」的字符串断言替代。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkBacklog, countLines, classifySection, LINE_CAP } from './backlog-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-10-24';

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lumir-backlog-check-'));
const run = (text, options = {}) => checkBacklog(text, { root: options.root ?? tmpRoot(), today: TODAY, ...options });
const kinds = (result, kind) => result.problems.filter((p) => p.kind === kind);
const work = (body) => `# Backlog\n\n## 待修 findings\n\n${body}\n`;

// --- 完成标记（待修 / 已立项区） ---

for (const marker of ['已修', '已核销', '已落地', '已收口', '已接账', '已解决', '已关闭', '已完成']) {
  test(`待修区出现完成标记「${marker}」⇒ closure-marker FAIL`, () => {
    const result = run(work(`- \`#fix\` **某缺陷**（M1）→ 下一动作：复核；实际${marker}。`));
    const hits = kinds(result, 'closure-marker');
    assert.equal(hits.length, 1);
    assert.match(hits[0].message, new RegExp(marker));
  });
}

test('完成标记是词而不是字：只有「无核销项可清」这类说明 ⇒ 不误报', () => {
  const result = run(work('- `#fix` **某缺陷**（M1）→ 下一动作：复核；无核销项可清时也保留。'));
  assert.equal(kinds(result, 'closure-marker').length, 0);
  assert.equal(result.problems.length, 0);
});

// --- 出口 / 关闭条件 ---

test('活项缺出口 ⇒ missing-exit FAIL；补「下一动作：」后放行', () => {
  const bad = run(work('- `#fix` **某缺陷**（M1，low）：待查。'));
  assert.equal(kinds(bad, 'missing-exit').length, 1);

  const good = run(work('- `#fix` **某缺陷**（M1，low）→ 下一动作：查配置写入点。'));
  assert.equal(good.problems.length, 0);
});

test('「出口：」/「关闭条件：」同样算出口', () => {
  assert.equal(run(work('- `#fix` **甲**（M1）出口：配置迁移后删除。')).problems.length, 0);
  assert.equal(run(work('- `#fix` **乙**（M1）关闭条件：真机复跑 PASS。')).problems.length, 0);
});

test('中文行文里的内联箭头（关→再开）不算出口——否则判据退化成含箭头就放行', () => {
  const result = run(work('- `#hygiene` **浮层**：会话浮层快速关→再开重复历史行。'));
  assert.equal(kinds(result, 'missing-exit').length, 1);
});

// M692 r1 P2-1：标记后没有内容 ⇒ 不算出口（否则空标记可整条绕过「活项缺出口」判据）。
test('空「下一动作：」⇒ missing-exit（含箭头 + 空标记的链式写法）', () => {
  assert.equal(kinds(run(work('- `#fix` **空下一动作** 下一动作：')), 'missing-exit').length, 1);
  assert.equal(kinds(run(work('- `#fix` **空下一动作** → 下一动作：')), 'missing-exit').length, 1);
});

test('空「出口：」⇒ missing-exit', () => {
  assert.equal(kinds(run(work('- `#fix` **空出口** 出口：')), 'missing-exit').length, 1);
});

test('空「关闭条件」/ 空「关闭条件：」⇒ missing-exit', () => {
  assert.equal(kinds(run(work('- `#fix` **空关闭条件** 关闭条件')), 'missing-exit').length, 1);
  assert.equal(kinds(run(work('- `#fix` **空关闭条件** 关闭条件：')), 'missing-exit').length, 1);
});

test('空箭头（`→ ` 后无内容）⇒ missing-exit；箭头后接标记仍需标记带内容', () => {
  assert.equal(kinds(run(work('- `#fix` **空箭头** → ')), 'missing-exit').length, 1);
  assert.equal(kinds(run(work('- `#fix` **链式空复核** → 复核：')), 'missing-exit').length, 1);
  assert.equal(run(work('- `#fix` **链式** → 下一动作：查配置。')).problems.length, 0);
});

test('待真机验收按活项判出口：无出口 FAIL，补箭头后放行', () => {
  const section = (body) => `# Backlog\n\n## 待真机验收（未收口）\n\n${body}\n`;
  assert.equal(kinds(run(section('- `02-math-click`（item 2）：「公式后 ⌃B 是否 1–2 次」仍待判定。')), 'missing-exit').length, 1);
  assert.equal(run(section('- `02-math-click`（item 2）→ 下一动作：真机判定「公式后 ⌃B 是否 1–2 次」。')).problems.length, 0);
});

test('待 Alex 裁决与归档跟踪队列不判出口', () => {
  const text = `# Backlog

## 待 Alex 裁决（\`#decide\`，一行一题）

- **某取舍**（2026-10-18）：A 还是 B。

## 归档跟踪队列（口径见 openspec-workflow）

- **序 1 · \`some-change\`**（M1，1/1）：待归档。
`;
  assert.equal(run(text).problems.length, 0);
});

test('区块分类：标题关键词决定判据', () => {
  assert.equal(classifySection('待修 findings（`#fix` / `#probe`）'), 'work');
  assert.equal(classifySection('已立项'), 'work');
  assert.equal(classifySection('待真机验收（未收口）'), 'work');
  assert.equal(classifySection('承接残项（长期口径 + 未闭合尾巴）'), 'record');
  assert.equal(classifySection('记录在案'), 'record');
  assert.equal(classifySection('待 Alex 裁决（`#decide`）'), 'decision');
  assert.equal(classifySection('归档跟踪队列'), 'queue');
  assert.equal(classifySection('工具链与环境'), 'other');
});

test('未归类区块只 WARN，不判红（而且能看见）', () => {
  const result = run('# Backlog\n\n## 工具链与环境\n\n- 某条没有出口的运行知识。\n');
  assert.equal(result.problems.length, 0);
  assert.equal(result.warnings.filter((w) => w.kind === 'unknown-section').length, 1);
});

// --- finding 指针 ---

const twoEntries = (a, b) => work(`- \`#fix\` **甲**（M1）→ 下一动作：修；${a}\n- \`#fix\` **乙**（M2）→ 下一动作：修；${b}`);

test('同一 finding 指针出现两条 ⇒ duplicate-finding FAIL', () => {
  const result = run(twoEntries('见 finding `20260101-a-bug`', '同 finding `20260101-a-bug`'));
  const hits = kinds(result, 'duplicate-finding');
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /20260101-a-bug/);
});

test('finding 指针不存在 ⇒ missing-finding FAIL（死指针）', () => {
  const root = tmpRoot();
  const dir = path.join(root, '.tower', 'comms', 'findings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '20260101-alive.md'), '# alive\n');
  const result = run(twoEntries('见 finding `20260101-alive`', '见 `.tower/comms/findings/20260102-dead.md`'), { root });
  const hits = kinds(result, 'missing-finding');
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /20260102-dead/);
});

test('finding 目录整体缺失（CI / worktree）⇒ 只 INFO 跳过，不冒充死指针', () => {
  const result = run(twoEntries('见 finding `20260101-a-bug`', '见 finding `20260102-b-bug`'));
  assert.equal(kinds(result, 'missing-finding').length, 0);
  assert.equal(result.problems.length, 0);
  assert.ok(result.infos.some((i) => i.includes('跳过 finding 指针存在性核对')));
});

// --- 记录在案 ---

test('记录在案：canonical 指针存在 ⇒ 放行；死指针 / 无居所 ⇒ FAIL', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'docs', 'specs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'specs', 'live.md'), '# live\n');
  const text = `# Backlog

## 承接残项（长期口径 + 未闭合尾巴）

- **甲**：Alex 裁维持现状；落点 \`docs/specs/live.md\`。
- **乙**：Alex 裁维持现状；复核：2026-10-01 再核。
- **丙**：Alex 裁维持现状。
- **丁**：见 \`docs/specs/missing.md\`。
`;
  const result = run(text, { root });
  const dead = kinds(result, 'dead-canonical-pointer');
  const homeless = kinds(result, 'missing-record-home');
  assert.equal(dead.length, 1);
  assert.match(dead[0].message, /docs\/specs\/missing\.md/);
  assert.equal(dead[0].line, 8);
  assert.equal(homeless.length, 1);
  assert.equal(homeless[0].line, 7);
  assert.equal(result.stats.recordEntries, 4);
  assert.equal(result.stats.recordWithReview, 1);
});

test('记录在案里带出口的开放尾巴不需要 canonical 指针', () => {
  const result = run('# Backlog\n\n## 承接残项（长期口径 + 未闭合尾巴）\n\n- **某尾巴** → 下一动作：并成一个小验收 mission。\n');
  assert.equal(result.problems.length, 0);
  assert.equal(result.stats.recordWithExit, 1);
});

// M692 r1 P2-1：空复核标记同样不算合规形态，recordWithReview 也不得计入。
test('空「复核：」⇒ missing-record-home，且不计入 recordWithReview', () => {
  const result = run('# Backlog\n\n## 承接残项（长期口径 + 未闭合尾巴）\n\n- **空复核** 复核：\n');
  assert.equal(kinds(result, 'missing-record-home').length, 1);
  assert.equal(result.stats.recordWithReview, 0);
});

test('空「复核口径」/「复核口径：」⇒ missing-record-home，且不计入 recordWithReview', () => {
  for (const marker of ['复核口径', '复核口径：']) {
    const result = run(`# Backlog\n\n## 承接残项（长期口径 + 未闭合尾巴）\n\n- **空复核口径** ${marker}\n`);
    assert.equal(kinds(result, 'missing-record-home').length, 1, marker);
    assert.equal(result.stats.recordWithReview, 0, marker);
  }
});

test('复核口径带内容（`复核口径：…`）⇒ 合规并计入 recordWithReview', () => {
  const result = run('# Backlog\n\n## 承接残项（长期口径 + 未闭合尾巴）\n\n- **有内容** 复核口径：每次归档前重读一次。\n');
  assert.equal(result.problems.length, 0);
  assert.equal(result.stats.recordWithReview, 1);
});

// --- 行数上限 ---

const numbered = (n) => `${Array.from({ length: n }, (_, i) => `第 ${i + 1} 行`).join('\n')}\n`;

test(`行数上限：${LINE_CAP} 行 PASS，${LINE_CAP + 1} 行 FAIL`, () => {
  assert.equal(LINE_CAP, 80);
  assert.equal(countLines(numbered(80)), 80);
  const pass = run(numbered(80));
  assert.equal(kinds(pass, 'line-cap').length, 0);
  assert.equal(pass.stats.lines, 80);

  const fail = run(numbered(81));
  assert.equal(kinds(fail, 'line-cap').length, 1);
  assert.match(kinds(fail, 'line-cap')[0].message, /81 行/);
});

// --- 年龄（只报告，不判红） ---

test('年龄只进报告：0–14 / 15–30 / 31–60 / >60 分档正确，不产生 FAIL', () => {
  const text = work(
    [
      '- `#fix` **甲**（2026-10-20）→ 下一动作：修。',
      '- `#fix` **乙**（2026-10-05）→ 下一动作：修。',
      '- `#fix` **丙**（2026-09-10）→ 下一动作：修。',
      '- `#fix` **丁**（2026-08-01）→ 下一动作：修。',
      '- `#fix` **戊**（M5）→ 下一动作：修。',
    ].join('\n'),
  );
  const result = run(text);
  assert.deepEqual(result.stats.ageBuckets, { '0-14': 1, '15-30': 1, '31-60': 1, '>60': 1 });
  assert.equal(result.stats.undated, 1);
  assert.equal(result.stats.oldest.date, '2026-08-01');
  assert.equal(result.problems.length, 0, '年龄不是判红理由');
});

test('超 30 天且无出口：报 missing-exit，不额外报「老化」', () => {
  const result = run(work('- `#fix` **久悬**（2026-08-01）：证据不足。'));
  assert.deepEqual(result.problems.map((p) => p.kind), ['missing-exit']);
});

// --- .local 指针（只 WARN） ---

test('.local 证据缺失只 WARN；整个 .local 缺失只 INFO 跳过', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.local'), { recursive: true });
  const warn = run(work('- `#fix` **甲**（M1）→ 下一动作：修；证据 `.local/probes/m1/`。'), { root });
  assert.equal(warn.warnings.filter((w) => w.kind === 'missing-local').length, 1);
  assert.equal(warn.problems.length, 0);

  const bare = tmpRoot();
  const skip = run(work('- `#fix` **甲**（M1）→ 下一动作：修；证据 `.local/probes/m1/`。'), { root: bare });
  assert.equal(skip.warnings.filter((w) => w.kind === 'missing-local').length, 0);
  assert.ok(skip.infos.some((i) => i.includes('跳过 .local 指针核验')));
  assert.equal(skip.problems.length, 0);
});

// --- 真实 backlog（无 ratchet / 无既有豁免） ---

test('真实 docs/backlog.md ⇒ PASS（80 行以内，活项均有出口）', () => {
  const text = fs.readFileSync(path.join(ROOT, 'docs', 'backlog.md'), 'utf8');
  const result = checkBacklog(text, {
    root: ROOT,
    today: TODAY,
    findingsDir: path.join(ROOT, '.no-such-tower-findings'),
    localRoot: path.join(ROOT, '.no-such-local-evidence'),
  });
  assert.deepEqual(result.problems, []);
  assert.ok(result.stats.lines <= LINE_CAP);
});

// 主仓检出（有 .tower/）时额外核对真实 finding 指针存活；worktree / CI 没有该目录，跳过。
test('真实 backlog 的 finding 指针在主仓检出下存活', () => {
  const findingsDir = path.join(ROOT, '.tower', 'comms', 'findings');
  if (!fs.existsSync(findingsDir)) return;
  const text = fs.readFileSync(path.join(ROOT, 'docs', 'backlog.md'), 'utf8');
  const result = checkBacklog(text, { root: ROOT, today: TODAY, findingsDir });
  assert.deepEqual(result.problems, []);
});
