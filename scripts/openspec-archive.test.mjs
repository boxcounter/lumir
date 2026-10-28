// scripts/openspec-archive.test.mjs —— 归档链接修复包装器（scripts/openspec-archive.mjs）的区分度测试
// （node:test，零新增依赖）。
//
// 与脚本同址的理由同 openspec-archive-check.test.mjs：它守的是包装器自己的判据。跑法：
//   node --test scripts/openspec-archive.test.mjs
// 已接入 scripts/docs-check.sh（本地 gate.sh quick 与 CI 的 docs-check.yml 共用），改判据后自测随门禁跑。
//
// 判红/判绿一律跑**真门禁**：fixture 根里拷一份 scripts/openspec-links.sh（它按自身位置定位仓根），
// 不在测试里复制判据（REVIEW.md「同一语义两处真源」条）。
//
// 纪律（REVIEW.md「断言等价于子串，没有区分度」条）：每条「修好了」的断言都先造一个必须 FAIL 的输入——
// fixture 在归档后先跑一次门禁、断言它确实判红（复现 finding 现场），修链后再跑同一条门禁断言转绿；
// 「不可修复死链」反着来：修链后门禁必须仍红，且文件字节不变。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { archiveArgs, archiveChange, linkGate, repairArchivedLinks, scanLineLinks, maskCodeSpans } from './openspec-archive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_GATE = path.join(HERE, 'openspec-links.sh');

// 活跃期正确的写法：从 openspec/changes/<id>/ 往上是仓根。
const ACTIVE_DOC_LINK = '../../../docs/process/openspec-workflow.md';
// 归档后正确一层（包装器应当修成这个）。
const ARCHIVED_DOC_LINK = '../../../../docs/process/openspec-workflow.md';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumir-openspec-archive-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(REAL_GATE, path.join(root, 'scripts', 'openspec-links.sh'));
  fs.mkdirSync(path.join(root, 'docs/process'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/process/openspec-workflow.md'), '# 流程\n');
  fs.mkdirSync(path.join(root, 'docs/adr'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/adr/0001-demo.md'), '# ADR 0001\n');
  return root;
}

function writeChange(root, id, files) {
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(root, 'openspec/changes', id, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
}

// 模拟 `openspec archive`：change 目录整体移进 archive/<日期>-<id>/（深一层，内容不变）。
function simulateArchive(root, id, date = '2026-10-28') {
  const to = path.join(root, 'openspec/changes/archive', `${date}-${id}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(path.join(root, 'openspec/changes', id), to);
  return to;
}

const read = (p) => fs.readFileSync(p, 'utf8');
const withFixture = (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};
const SPEC = '## ADDED Requirements\n\n### Requirement: 演示\n\n系统 SHALL 做甲。\n\n#### Scenario: 甲\n\n- **WHEN** 甲\n- **THEN** 乙\n';

test('活跃期 ../../../docs 链接：归档后门禁先判红（复现现场），修一层后判绿', (t) => {
  const root = withFixture(t);
  writeChange(root, 'demo-change', {
    'proposal.md': `# 提案\n\n参考 [流程](${ACTIVE_DOC_LINK})。\n`,
    'tasks.md': '# 任务\n\n- [x] 1.1 甲\n',
    'specs/demo/spec.md': SPEC,
  });
  assert.equal(linkGate(root).status, 0, '归档前：链接按活跃期深度可达');

  const archived = simulateArchive(root, 'demo-change');
  const red = linkGate(root);
  assert.equal(red.status, 1, '归档深一层后必须是死链——门禁不红则本测试没有区分度');
  assert.match(red.output, /相对链接目标不存在：\.\.\/\.\.\/\.\.\/docs\/process\/openspec-workflow\.md/);

  const result = repairArchivedLinks(archived, root);
  assert.equal(result.repaired.length, 1);
  assert.equal(result.repaired[0].file, path.join('openspec/changes/archive/2026-10-28-demo-change/proposal.md'));
  assert.equal(result.repaired[0].from, ACTIVE_DOC_LINK);
  assert.equal(result.repaired[0].to, ARCHIVED_DOC_LINK);
  assert.ok(read(path.join(archived, 'proposal.md')).includes(`[流程](${ARCHIVED_DOC_LINK})`));

  const green = linkGate(root);
  assert.equal(green.status, 0, green.output);
});

test('已修好的链接不会被二次改写（再跑一次零修复、字节不变）', (t) => {
  const root = withFixture(t);
  writeChange(root, 'demo-change', { 'proposal.md': `# 提案\n\n[流程](${ACTIVE_DOC_LINK})\n` });
  const archived = simulateArchive(root, 'demo-change');
  assert.equal(repairArchivedLinks(archived, root).repaired.length, 1);
  const once = read(path.join(archived, 'proposal.md'));

  const second = repairArchivedLinks(archived, root);
  assert.deepEqual(second.repaired, []);
  assert.deepEqual(second.remaining, []);
  assert.equal(read(path.join(archived, 'proposal.md')), once, '二次运行必须逐字节不动');
  assert.equal(linkGate(root).status, 0);
});

test('change 内部相对链接不动（目录整体搬动后仍可达，没有理由改写）', (t) => {
  const root = withFixture(t);
  const proposal = '# 提案\n\n见 [设计](design.md)、[增量](specs/demo/spec.md) 与 [场景](specs/demo/spec.md#场景甲)。\n';
  const design = '# 设计\n\n[返回提案](proposal.md)\n';
  writeChange(root, 'demo-change', { 'proposal.md': proposal, 'design.md': design, 'specs/demo/spec.md': SPEC });
  const archived = simulateArchive(root, 'demo-change');

  const result = repairArchivedLinks(archived, root);
  assert.deepEqual(result.repaired, []);
  assert.equal(read(path.join(archived, 'proposal.md')), proposal);
  assert.equal(read(path.join(archived, 'design.md')), design);
  assert.equal(linkGate(root).status, 0);
});

test('深层制品（specs/<cap>/）按归档后的真实目录解析：修一层即达', (t) => {
  const root = withFixture(t);
  writeChange(root, 'demo-change', {
    'proposal.md': '# 提案\n',
    // 活跃期：openspec/changes/<id>/specs/demo/ 往上五层 = 仓根
    'specs/demo/spec.md': `${SPEC}\n参考 [ADR](../../../../../docs/adr/0001-demo.md)。\n`,
  });
  assert.equal(linkGate(root).status, 0, '归档前可达');
  const archived = simulateArchive(root, 'demo-change');
  assert.equal(linkGate(root).status, 1, '归档后同一写法落到 openspec/changes/archive/ 之下 ⇒ 死链');

  const result = repairArchivedLinks(archived, root);
  assert.equal(result.repaired.length, 1);
  assert.equal(result.repaired[0].to, '../../../../../../docs/adr/0001-demo.md');
  assert.equal(linkGate(root).status, 0);
});

test('不可修复死链 / 要加两层才可达：一律不改写，门禁仍红（不遮蔽真死链）', (t) => {
  const root = withFixture(t);
  writeChange(root, 'demo-change', {
    // 两条在活跃期就是死链（差两层 / 目标不存在），归档后仍然死：包装器不得猜深度去修。
    'proposal.md': '# 提案\n\n[差两层](../../../../../docs/adr/0001-demo.md)\n',
    'specs/demo/spec.md': `${SPEC}\n[不存在](../../../docs/adr/9999-missing.md)\n`,
  });
  const archived = simulateArchive(root, 'demo-change');
  const before = { proposal: read(path.join(archived, 'proposal.md')), spec: read(path.join(archived, 'specs/demo/spec.md')) };

  const result = repairArchivedLinks(archived, root);
  assert.deepEqual(result.repaired, []);
  assert.deepEqual(result.remaining.map((r) => r.target), ['../../../../../docs/adr/0001-demo.md', '../../../docs/adr/9999-missing.md']);
  assert.equal(read(path.join(archived, 'proposal.md')), before.proposal);
  assert.equal(read(path.join(archived, 'specs/demo/spec.md')), before.spec);

  const red = linkGate(root);
  assert.equal(red.status, 1, '真死链必须仍被门禁抓住');
  assert.match(red.output, /9999-missing\.md/);
});

test('外链 / 纯锚点 / 行内代码 / 围栏代码 / 非路径占位词：不进判据（不改写也不报未修）', (t) => {
  const root = withFixture(t);
  const frozen = [
    '# 提案',
    '',
    '- [外链](https://example.com/x/y.md)',
    '- [锚点](#场景甲)',
    '- 示意写法：`[代码](../../../docs/process/openspec-workflow.md)`',
    '- [占位](link)、[占位二](配置)',
    '',
    '```md',
    '[围栏](../../../docs/process/openspec-workflow.md)',
    '```',
    '',
  ].join('\n');
  writeChange(root, 'demo-change', { 'proposal.md': frozen });
  const archived = simulateArchive(root, 'demo-change');

  const result = repairArchivedLinks(archived, root);
  assert.deepEqual(result.repaired, [], '代码跨度 / 围栏 / 外链 / 锚点 / 占位词都不该被当路径链接修');
  assert.deepEqual(result.remaining, [], '也不该被报成「未修的死链」——它们不进判据');
  assert.equal(read(path.join(archived, 'proposal.md')), frozen);
  assert.equal(linkGate(root).status, 0, '门禁自身也跳过这些形态，fixture 结论一致');
});

test('带片段、角括号与开头 ./ 的相对链接：只改路径部分，片段 / 角括号原样保留', (t) => {
  const root = withFixture(t);
  writeChange(root, 'demo-change', {
    'proposal.md': `# 提案\n\n[甲](${ACTIVE_DOC_LINK}#归档链接修复)、[乙](<${ACTIVE_DOC_LINK}>)、[丙](./${ACTIVE_DOC_LINK})\n`,
  });
  const archived = simulateArchive(root, 'demo-change');
  const result = repairArchivedLinks(archived, root);
  assert.deepEqual(result.repaired.map((r) => r.to), [`${ARCHIVED_DOC_LINK}#归档链接修复`, `<${ARCHIVED_DOC_LINK}>`, ARCHIVED_DOC_LINK]);
  assert.equal(linkGate(root).status, 0);
});

test('scanLineLinks / maskCodeSpans：目标截断口径与门禁一致（跳过代码跨度、停在空格与右括号）', () => {
  assert.deepEqual(scanLineLinks('`[a](b/c.md)` [真](x/y.md "标题") [空]()').map((l) => l.target), ['x/y.md']);
  assert.equal(maskCodeSpans('`a`b').trim(), 'b');
  // 落单的反引号只抹掉它本身，后面的链接照常参与扫描
  assert.deepEqual(scanLineLinks('` 未闭合 [真](x/y.md)').map((l) => l.target), ['x/y.md']);
});

test('archiveChange：调真实命令序列，归档后定位新目录并修链', (t) => {
  const root = withFixture(t);
  writeChange(root, 'demo-change', { 'proposal.md': `# 提案\n\n[流程](${ACTIVE_DOC_LINK})\n` });
  const calls = [];
  const exec = (args, cwd) => {
    calls.push({ args, cwd });
    simulateArchive(root, 'demo-change');
  };
  const logs = [];
  const result = archiveChange({ changeId: 'demo-change', root, exec, log: (line) => logs.push(line) });

  assert.deepEqual(calls[0].args, ['npx', '--yes', '@fission-ai/openspec@1.12.0', 'archive', 'demo-change', '--yes']);
  assert.equal(calls[0].cwd, root);
  assert.equal(path.basename(result.archivedDir), '2026-10-28-demo-change');
  assert.equal(result.repaired.length, 1);
  assert.equal(linkGate(root).status, 0);
  assert.ok(logs.some((l) => /INFO 修链 .*proposal\.md:3/.test(l)), logs.join('\n'));
  assert.deepEqual(archiveArgs('demo-change', ['--skip-specs']).slice(-2), ['--yes', '--skip-specs']);
});

test('archiveChange：命令没产出归档目录 / change 不存在 / 命令非零 ⇒ 抛错（显式失败，不静默放过）', (t) => {
  const root = withFixture(t);
  assert.throws(() => archiveChange({ changeId: 'nope', root, exec: () => {}, log: () => {} }), /找不到活跃 change/);

  writeChange(root, 'demo-change', { 'proposal.md': '# 提案\n' });
  assert.throws(
    () => archiveChange({ changeId: 'demo-change', root, exec: () => {}, log: () => {} }),
    /无法唯一定位归档目录/,
  );

  const boom = () => {
    throw new Error('Command failed: npx exit 1');
  };
  assert.throws(
    () => archiveChange({ changeId: 'demo-change', root, exec: boom, log: () => {} }),
    /openspec archive 失败：Command failed: npx exit 1（change 目录仍在原位）/,
  );
});
