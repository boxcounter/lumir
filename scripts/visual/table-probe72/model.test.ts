import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tables} from './model.ts';
import {small, large} from './fixture.ts';

test('parser ranges preserve empty, escaped, nested and optional pipe slots', () => {
  const result = tables(small).tables;
  assert.deepEqual(result.map(t => [t.columns, t.rows.length, t.rectangular]), [[4,3,true],[2,2,true],[2,2,true],[2,2,true],[2,2,false]]);
  assert.deepEqual(result[0].align, ['left','left','center','right']);
  assert.equal(small.slice(result[0].rows[1].slots[1].from,result[0].rows[1].slots[1].to).trim(), '');
  assert.match(small.slice(result[0].rows[2].slots[0].from,result[0].rows[2].slots[0].to), /escaped \\\| pipe/);
});
test('adjacent pipes create a zero-width slot', () => {
  const source = '|a|b|c|\n|---|---|---|\n|x||z|';
  const table = tables(source).tables[0];
  assert.equal(table.rectangular, true);
  assert.equal(table.rows[1].slots[1].from, table.rows[1].slots[1].to);
});
test('unescaped pipe in backticks follows parser, not a second dialect', () => {
  const table = tables('|a|b|\n|---|---|\n|`x|y`|z|').tables[0];
  assert.equal(table.rectangular, false);
});
test('large fixture exceeds 1MB and exposes metadata scan boundary', () => {
  assert.ok(large.length > 1024 * 1024);
  const result = tables(large);
  assert.equal(result.tables[0].rows.length, 14001);
  assert.equal(result.tables[0].rectangular, true);
  console.log(JSON.stringify({characters:large.length,metadataMs:result.metadataMs}));
});
