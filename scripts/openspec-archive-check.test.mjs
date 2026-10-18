// scripts/openspec-archive-check.test.mjs —— 归档对账判据的区分度测试（node:test，零新增依赖）。
//
// 为什么与脚本同址（而不是 tests/unit/）：它守的是门禁脚本自己的判据，跑法与同目录的
// migrate-harness-sessions.test.mjs 一致（不进常驻门禁——判据本身已在 docs-check 里当门禁用）：
//   node --test scripts/openspec-archive-check.test.mjs
//
// 纪律（REVIEW.md「断言等价于子串，没有区分度」条）：每个放行断言都配一个必须 FAIL 的输入——
// 「真丢段」与「整段改写」在文本上只差「delta 里有没有替代段落」，两条都断言。
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkDelta, parseSpec } from './openspec-archive-check.mjs';

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
