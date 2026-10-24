// scripts/openspec-archive-check.test.mjs —— 归档对账判据的区分度测试（node:test，零新增依赖）。
//
// 为什么与脚本同址（而不是 tests/unit/）：它守的是门禁脚本自己的判据，跑法与同目录的
// migrate-harness-sessions.test.mjs 一致（不进常驻门禁——判据本身已在 docs-check 里当门禁用）：
//   node --test scripts/openspec-archive-check.test.mjs
//
// 纪律（REVIEW.md「断言等价于子串，没有区分度」条）：每个放行断言都配一个必须 FAIL 的输入——
// 「真丢段」与「整段改写」在文本上只差「delta 里有没有替代段落」，两条都断言。归档队列面同理：
// 「有条目」与「正文提到过它」只差条目的行形态，两条都断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkDelta, parseSpec, taskProgress, archiveQueueEntries, queueProblems, listActiveChanges } from './openspec-archive-check.mjs';

const LIVING = `# demo Specification

## Requirements

### Requirement: 演示条

第一段：系统 SHALL 做甲。

第二段：系统 SHALL 做乙；MUST NOT 做丙。这一段的长度足够长，用来测试是否被静默删除。

第三段：系统 SHALL 做丁。

#### Scenario: 场景甲

- **WHEN** 发生甲
- **THEN** 得到甲结果
`;

const HEAD = `# demo 增量规格

## MODIFIED Requirements

### Requirement: 演示条

`;

const silentDrops = (result) => result.problems.filter((p) => p.kind === 'silent-drop');

test('整段丢失（无替代）⇒ 报出该段', () => {
  const delta = `${HEAD}第一段：系统 SHALL 做甲。

第三段：系统 SHALL 做丁。

#### Scenario: 场景甲

- **WHEN** 发生甲
- **THEN** 得到甲结果
`;
  const drops = silentDrops(checkDelta(delta, LIVING));
  assert.equal(drops.length, 1);
  assert.match(drops[0].paragraph, /第二段：系统 SHALL 做乙/);
});

test('整段改写（1:1 替换）⇒ 放行（改写是 delta 里可见的改动）', () => {
  const delta = `${HEAD}第一段：系统 SHALL 做甲。

第二段：系统 SHALL 做乙；MUST NOT 做丙。这一段的长度足够长，用来测试是否被静默删除。（改写版。）

第三段：系统 SHALL 做丁。

#### Scenario: 场景甲

- **WHEN** 发生甲
- **THEN** 得到甲结果
`;
  assert.equal(silentDrops(checkDelta(delta, LIVING)).length, 0);
});

test('丢一段 + 相邻段被改写（删 2 增 1）⇒ 落单的那段报出', () => {
  const delta = `${HEAD}第一段：系统 SHALL 做甲（改写版）。

第三段：系统 SHALL 做丁。

#### Scenario: 场景甲

- **WHEN** 发生甲
- **THEN** 得到甲结果
`;
  const drops = silentDrops(checkDelta(delta, LIVING));
  assert.equal(drops.length, 1);
  assert.match(drops[0].paragraph, /第二段/);
});

test('声明行认领后放行，且认领被单独记账', () => {
  const delta = `# demo 增量规格

> 归档对账声明：删除「第二段：系统 SHALL 做乙」

## MODIFIED Requirements

### Requirement: 演示条

第一段：系统 SHALL 做甲。

第三段：系统 SHALL 做丁。

#### Scenario: 场景甲

- **WHEN** 发生甲
- **THEN** 得到甲结果
`;
  const result = checkDelta(delta, LIVING);
  assert.equal(silentDrops(result).length, 0);
  assert.equal(result.declaredDrops.length, 1);
});

test('声明片段写错 ⇒ 照旧报红（只可能假红、不可能假绿）', () => {
  const delta = `# demo 增量规格

> 归档对账声明：删除「第二段：系统 SHALL 做戊（错片段）」

## MODIFIED Requirements

### Requirement: 演示条

第一段：系统 SHALL 做甲。

第三段：系统 SHALL 做丁。

#### Scenario: 场景甲

- **WHEN** 发生甲
- **THEN** 得到甲结果
`;
  assert.equal(silentDrops(checkDelta(delta, LIVING)).length, 1);
});

test('场景整块丢失（标题 + 内容）⇒ 两段都报出', () => {
  const delta = `${HEAD}第一段：系统 SHALL 做甲。

第二段：系统 SHALL 做乙；MUST NOT 做丙。这一段的长度足够长，用来测试是否被静默删除。

第三段：系统 SHALL 做丁。
`;
  const drops = silentDrops(checkDelta(delta, LIVING));
  assert.equal(drops.length, 2);
  assert.ok(drops.some((p) => p.paragraph === '#### Scenario: 场景甲'));
  assert.ok(drops.some((p) => p.paragraph.startsWith('- **WHEN** 发生甲')));
});

test('ADDED 与 living 同名 ⇒ 报出覆盖风险', () => {
  const delta = `# demo 增量规格

## ADDED Requirements

### Requirement: 演示条

新正文 SHALL 覆盖旧正文。

#### Scenario: 场景乙

- **WHEN** 发生乙
- **THEN** 得到乙结果
`;
  const problems = checkDelta(delta, LIVING).problems.map((p) => p.kind);
  assert.deepEqual(problems, ['added-exists']);
});

test('MODIFIED / REMOVED 指向不存在的 requirement ⇒ 报出', () => {
  const delta = `# demo 增量规格

## MODIFIED Requirements

### Requirement: 不存在的条

正文 SHALL 存在。

#### Scenario: 场景丙

- **WHEN** 发生丙
- **THEN** 得到丙结果

## REMOVED Requirements

### Requirement: 也不存在的条

整条移除。
`;
  const kinds = checkDelta(delta, LIVING).problems.map((p) => p.kind);
  assert.deepEqual(kinds.sort(), ['modified-missing', 'removed-missing']);
});

test('delta 的 requirement 归属按 ## 段解析（ADDED 不参与对账）', () => {
  const delta = `# demo 增量规格

## ADDED Requirements

### Requirement: 新条

正文 SHALL 说话。

#### Scenario: 场景丁

- **WHEN** 发生丁
- **THEN** 得到丁结果

## MODIFIED Requirements

### Requirement: 演示条

第一段：系统 SHALL 做甲。

第二段：系统 SHALL 做乙；MUST NOT 做丙。这一段的长度足够长，用来测试是否被静默删除。

第三段：系统 SHALL 做丁。

#### Scenario: 场景甲

- **WHEN** 发生甲
- **THEN** 得到甲结果
`;
  const sections = parseSpec(delta).map((b) => `${b.section}:${b.name}`);
  assert.deepEqual(sections, ['ADDED:新条', 'MODIFIED:演示条']);
  const result = checkDelta(delta, LIVING);
  assert.equal(result.checked, 1);
  assert.equal(result.problems.length, 0);
});

// --- 归档队列面（tasks 全勾的活跃 change 必须有且仅有一条 backlog 条目） ---

const DONE_TASKS = '# 任务\n\n## 1. 实现\n\n- [x] 1.1 甲\n- [x] 1.2 乙\n';
const OPEN_TASKS = '# 任务\n\n## 1. 实现\n\n- [x] 1.1 甲\n- [ ] 1.2 乙\n';
const entry = (id, seq) =>
  seq === undefined ? `- **\`${id}\`**（M1，1/1）：待节点 2。` : `- **序 ${seq} · \`${id}\`**（M1，1/1）：待节点 2。`;

test('队列：已完成 + 无条目 ⇒ 缺失报红', () => {
  const { problems, checked } = queueProblems([{ id: 'alpha', tasks: DONE_TASKS }], `# Backlog\n\n${entry('beta', 1)}\n`);
  assert.equal(checked, 1);
  assert.deepEqual(problems.map((p) => [p.kind, p.id]), [['missing-entry', 'alpha']]);
  assert.equal(problems[0].progress.total, 2);
});

test('队列：条目解析只认条目行（正文提及不计）并记行号', () => {
  const backlog = `# Backlog\n\n${entry('alpha', 1)}\n正文提及 \`beta\` 不算条目。\n${entry('beta')}\n`;
  assert.deepEqual([...archiveQueueEntries(backlog)], [
    ['alpha', [3]],
    ['beta', [5]],
  ]);
});

test('队列：已完成 + 唯一条目（含省略「序 N ·」的写法）⇒ 放行', () => {
  for (const line of [entry('alpha', 3), entry('alpha')]) {
    const { problems, checked } = queueProblems([{ id: 'alpha', tasks: DONE_TASKS }], `# Backlog\n\n${line}\n`);
    assert.equal(checked, 1);
    assert.deepEqual(problems, []);
  }
});

test('队列：两条条目 ⇒ 重复报红并给行号', () => {
  const backlog = `# Backlog\n\n${entry('alpha', 1)}\n\n- 说明\n\n${entry('alpha')}\n`;
  const { problems } = queueProblems([{ id: 'alpha', tasks: DONE_TASKS }], backlog);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'duplicate-entry');
  assert.deepEqual(problems[0].lines, [3, 7]);
});

test('队列：未完成 + 无条目 ⇒ 放行（未完成不进队列义务）', () => {
  const { problems, checked } = queueProblems([{ id: 'alpha', tasks: OPEN_TASKS }], '# Backlog\n');
  assert.equal(checked, 0);
  assert.deepEqual(problems, []);
});

test('队列：零任务项 ⇒ 不判完成（空真不放行）', () => {
  assert.equal(taskProgress('# 任务\n\n## 1. 实现\n\n只有说明文字。\n').complete, false);
  const { problems, checked } = queueProblems([{ id: 'alpha', tasks: '# 任务\n\n- 无 checkbox\n' }], '');
  assert.equal(checked, 0);
  assert.deepEqual(problems, []);
});

test('队列：`- [ ]（…）` 无空格写法算未勾（不让未完成漏数成完成）', () => {
  assert.deepEqual(taskProgress('- [x] 1.1 甲\n- [ ]（归档时执行）1.2 乙\n'), { total: 2, done: 1, open: 1, complete: false });
});

test('队列：正文提及不算条目（外部前置段的提及 ⇒ 仍判缺失）', () => {
  const mentions = [
    '**外部前置（不计入本批）**：`add-harness-block-fullscreen`（✓ Complete）先归档可消掉悬空引用；\n',
    '- **外部前置（不计入本批）**：`add-harness-block-fullscreen`（✓ Complete）先归档可消掉悬空引用；\n',
  ];
  for (const backlog of mentions) {
    const { problems } = queueProblems([{ id: 'add-harness-block-fullscreen', tasks: DONE_TASKS }], backlog);
    assert.deepEqual(problems.map((p) => [p.kind, p.id]), [['missing-entry', 'add-harness-block-fullscreen']]);
  }
});

test('队列：条目 id 必须精确相等，只认加粗首段（不做子串匹配）', () => {
  for (const backlog of [entry('add-image-quote'), '- **序 1 · `other`**（M1）：正文里提到 `add-image-quote-to-chat`。\n']) {
    const { problems } = queueProblems([{ id: 'add-image-quote-to-chat', tasks: DONE_TASKS }], backlog);
    assert.deepEqual(problems.map((p) => [p.kind, p.id]), [['missing-entry', 'add-image-quote-to-chat']]);
  }
});

test('队列：tasks.md 读不到 ⇒ 报红（不可读不等于没有任务）', () => {
  const { problems } = queueProblems([{ id: 'alpha', tasks: null }], '');
  assert.deepEqual(problems.map((p) => [p.kind, p.id]), [['tasks-missing', 'alpha']]);
});

test('活跃面按位置判：archive/ 下的撤回件不进活跃面，活跃 id 含 withdrawn 字样照判', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumir-archive-queue-'));
  try {
    for (const dir of ['alpha', 'withdrawn-looking-id', 'archive/2026-09-17-withdrawn-old']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
      fs.writeFileSync(path.join(root, dir, 'tasks.md'), DONE_TASKS);
    }
    fs.writeFileSync(path.join(root, 'README.md'), '不是 change 目录\n');
    const active = listActiveChanges(root);
    assert.deepEqual(active, ['alpha', 'withdrawn-looking-id']);
    const changes = active.map((id) => ({ id, tasks: fs.readFileSync(path.join(root, id, 'tasks.md'), 'utf8') }));
    const { problems } = queueProblems(changes, '');
    assert.deepEqual(problems.map((p) => [p.kind, p.id]).sort(), [
      ['missing-entry', 'alpha'],
      ['missing-entry', 'withdrawn-looking-id'],
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
