interface SyntaxNodeLike {
  name: string;
  from: number;
  to: number;
  firstChild: SyntaxNodeLike | null;
  nextSibling: SyntaxNodeLike | null;
}

interface SyntaxTreeLike {
  iterate(spec: { enter(ref: { name: string; from: number; to: number; node: SyntaxNodeLike }): boolean | void }): void;
}

export type TableAlignment = "left" | "center" | "right";

export interface TableSlot {
  from: number;
  to: number;
}

export interface TableRow {
  from: number;
  to: number;
  header: boolean;
  slots: TableSlot[];
}

export interface TableModel {
  from: number;
  to: number;
  sourceBytes: number;
  columns: number;
  rows: TableRow[];
  separator: TableSlot;
  align: TableAlignment[];
  rectangular: boolean;
  degraded: boolean;
  reason?: "oversize" | "non-rectangular" | "incomplete";
}

function children(node: { firstChild: { name: string; from: number; to: number; nextSibling: any } | null }): { name: string; from: number; to: number }[] {
  const result: { name: string; from: number; to: number }[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

function slotsForRow(row: { from: number; to: number; firstChild: any }, source: string): TableSlot[] | null {
  const delimiters = children(row).filter((child) => child.name === "TableDelimiter");
  const boundaries = [row.from, ...delimiters.flatMap((delimiter) => [delimiter.from, delimiter.to]), row.to];
  const hasLeadingPipe = source.slice(row.from, delimiters[0]?.from ?? row.to).trimStart().startsWith("|");
  const hasTrailingPipe = source.slice(delimiters.at(-1)?.to ?? row.from, row.to).trimEnd().endsWith("|");
  const slots: TableSlot[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 2) {
    const from = boundaries[i] ?? 0;
    const to = boundaries[i + 1] ?? 0;
    if ((i === 0 && hasLeadingPipe) || (i === boundaries.length - 2 && hasTrailingPipe)) continue;
    if (from > to) return null;
    slots.push({ from, to });
  }
  return slots;
}

function parseAlignment(source: string, separator: TableSlot, columns: number): TableAlignment[] | null {
  if (!separator.to || separator.from >= separator.to) return null;
  const line = source.slice(separator.from, separator.to);
  const cells = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|");
  if (cells.length !== columns) return null;
  return cells.map((cell): TableAlignment => {
    const value = cell.trim();
    if (/^:.*:$/.test(value)) return "center";
    if (/^:/.test(value)) return "left";
    if (/:$/.test(value)) return "right";
    return "left";
  });
}

const modelCache = new WeakMap<object, { tree: object; tables: TableModel[] }>();

export function findTables(source: string, tree: SyntaxTreeLike): TableModel[] {
  const cached = modelCache.get(tree);
  if (cached) return cached.tables;
  const tables: TableModel[] = [];
  tree.iterate({
    enter(ref) {
      if (ref.name !== "Table") return;
      const tableNode = ref.node;
      const rows: TableRow[] = [];
      let separator: TableSlot = { from: 0, to: 0 };
      for (let row = tableNode.firstChild; row; row = row.nextSibling) {
        if (row.name === "TableDelimiter") separator = { from: row.from, to: row.to };
        if (row.name !== "TableHeader" && row.name !== "TableRow") continue;
        const slots = slotsForRow(row, source);
        rows.push({ from: row.from, to: row.to, header: row.name === "TableHeader", slots: slots ?? [] });
      }
      const columns = rows[0]?.slots.length ?? 0;
      const align = parseAlignment(source, separator, columns);
      const complete = separator.to > separator.from && rows.length >= 1 && align !== null && rows.every((row) => row.slots.length === columns);
      const sourceBytes = new TextEncoder().encode(source.slice(ref.from, ref.to)).byteLength;
      const rectangular = columns > 0 && complete;
      const reason = !complete ? "non-rectangular" : sourceBytes > 64 * 1024 ? "oversize" : undefined;
      tables.push({
        from: ref.from,
        to: ref.to,
        sourceBytes,
        columns,
        rows,
        separator,
        align: align ?? Array.from({ length: columns }, () => "left"),
        rectangular,
        degraded: !rectangular || reason === "oversize",
        reason,
      });
      return false;
    },
  });
  modelCache.set(tree, { tree, tables });
  return tables;
}

export function tableAt(tables: readonly TableModel[], from: number, to = from): TableModel | undefined {
  let low = 0;
  let high = tables.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const table = tables[mid];
    if (from < table.from) high = mid - 1;
    else if (from > table.to) low = mid + 1;
    else return to <= table.to ? table : undefined;
  }
  return undefined;
}

export function tableRowsInRange(table: TableModel, from: number, to: number): TableRow[] {
  let low = 0;
  let high = table.rows.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (table.rows[mid].to < from) low = mid + 1;
    else high = mid;
  }
  const start = low;
  while (low < table.rows.length && table.rows[low].from <= to) low++;
  return table.rows.slice(start, low);
}

export function tableLineAt(table: TableModel, from: number, to: number): TableRow | undefined {
  return tableRowsInRange(table, from, to)[0];
}
