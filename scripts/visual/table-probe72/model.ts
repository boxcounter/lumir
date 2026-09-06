import { parser, GFM } from '@lezer/markdown';

export function tables(source: string) {
  const started = performance.now();
  const tree = parser.configure(GFM).parse(source);
  const result: {from: number; to: number; columns: number; rows: {from: number; to: number; header: boolean; slots: {from: number; to: number}[]}[]; separator: {from: number; to: number}; rectangular: boolean; align: string[]}[] = [];
  tree.iterate({enter(node) {
    if (node.name !== 'Table') return;
    const rows = [];
    let separator = {from: 0, to: 0};
    for (let row = node.node.firstChild; row; row = row.nextSibling) {
      if (row.name === 'TableDelimiter') separator = {from: row.from, to: row.to};
      if (row.name !== 'TableHeader' && row.name !== 'TableRow') continue;
      const delimiters = [];
      for (let child = row.firstChild; child; child = child.nextSibling) {
        if (child.name === 'TableDelimiter') delimiters.push(child);
      }
      const boundaries = [row.from, ...delimiters.flatMap(d => [d.from, d.to]), row.to];
      const slots = [];
      for (let i = 0; i < boundaries.length; i += 2) {
        const from = boundaries[i], to = boundaries[i + 1];
        if (i === 0 && from === to || i === boundaries.length - 2 && from === to) continue;
        slots.push({from, to});
      }
      rows.push({from: row.from, to: row.to, header: row.name === 'TableHeader', slots});
    }
    const columns = rows[0]?.slots.length ?? 0;
    const align = source.slice(separator.from, separator.to).replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(value => /^\s*:.*:\s*$/.test(value) ? 'center' : /:\s*$/.test(value) ? 'right' : 'left');
    result.push({from: node.from, to: node.to, columns, rows, separator, rectangular: columns > 0 && rows.every(row => row.slots.length === columns), align});
    return false;
  }});
  return {tables: result, metadataMs: performance.now() - started};
}
