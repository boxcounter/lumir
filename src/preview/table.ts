interface SyntaxNodeLike {
  name: string;
  from: number;
  to: number;
  firstChild: SyntaxNodeLike | null;
  nextSibling: SyntaxNodeLike | null;
}

interface SyntaxTreeLike {
  iterate(spec: { from?: number; to?: number; enter(ref: { name: string; from: number; to: number; node: SyntaxNodeLike }): boolean | void }): void;
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

type SourceReader = string | ((from: number, to: number) => string);

function readSource(source: SourceReader, from: number, to: number): string {
  return typeof source === "string" ? source.slice(from, to) : source(from, to);
}

function slotsForRow(row: { from: number; to: number; firstChild: any }, source: SourceReader): TableSlot[] | null {
  const delimiters = children(row).filter((child) => child.name === "TableDelimiter");
  const boundaries = [row.from, ...delimiters.flatMap((delimiter) => [delimiter.from, delimiter.to]), row.to];
  const rowSource = readSource(source, row.from, row.to);
  const hasLeadingPipe = rowSource.trimStart().startsWith("|");
  const hasTrailingPipe = rowSource.trimEnd().endsWith("|");
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

function parseAlignment(source: SourceReader, separator: TableSlot, columns: number): TableAlignment[] | null {
  if (!separator.to || separator.from >= separator.to) return null;
  const line = readSource(source, separator.from, separator.to);
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

export function findTables(source: SourceReader, sourceLength: number, tree: SyntaxTreeLike, from = 0, to = sourceLength): TableModel[] {
  const tables: TableModel[] = [];
  tree.iterate({
    from,
    to,
    enter(ref) {
      if (ref.name !== "Table" || ref.to < from || ref.from > to) return;
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
      const sourceBytes = ref.from >= from && ref.to <= to && ref.to - ref.from <= 64 * 1024
        ? new TextEncoder().encode(readSource(source, ref.from, ref.to)).byteLength
        : 0;
      const rectangular = columns > 0 && complete;
      const reason = !complete ? "non-rectangular" : ref.to - ref.from > 64 * 1024 || sourceBytes > 64 * 1024 ? "oversize" : undefined;
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

// ---------------------------------------------------------------------------
// 宽度统一合同（M119，docs/specs/table-reading.md §3）的可执行表述
// ---------------------------------------------------------------------------

/** 单列度量：min = min-content（不可再压缩宽），max = max-content（自然宽）。 */
export interface ColumnMeasure {
  min: number;
  max: number;
}

/**
 * 表格宽度合同的纯函数：输入每列 min/max 度量与阅读栏宽，输出每列轨道宽度。
 * 与 style.css 的声明式规则同构（grid `minmax(min-content, max-content)` 轨道 +
 * 表框 `max-content / min-content / 100%` 三值钳制，cell 无固定像素上限）：
 * - Σmax ≤ 栏宽：各列取 max——贴合内容，无折行，总宽 = 自然宽 ≤ 栏宽；
 * - Σmax > 栏宽且 Σmin ≤ 栏宽：从 min 起向 max 均摊富余（water-filling，先到
 *   max 的列退出分摊），总宽恰好 = 栏宽——折行只发生在栏宽用尽时；
 * - Σmin > 栏宽：各列取 min，总宽 = Σmin > 栏宽——无法折行容纳，容器横滚承载。
 * 运行时布局由 CSS grid 执行（声明式同构，避免测量回写引入 M110/M115 类
 * 测量-布局反馈错位）；本函数供属性测试生成期望与 Node 侧钉死不变量。
 */
export function computeColumnWidths(columns: readonly ColumnMeasure[], columnWidth: number): number[] {
  const mins = columns.map((c) => c.min);
  const totalMin = mins.reduce((a, b) => a + b, 0);
  const totalMax = columns.reduce((a, c) => a + c.max, 0);
  if (totalMax <= columnWidth) return columns.map((c) => c.max);
  if (totalMin >= columnWidth) return [...mins];
  // water-filling：富余均摊给尚未到达 max 的列，封顶列退出后继续，直到栏宽用尽
  const widths = [...mins];
  let free = columnWidth - totalMin;
  let open = columns.map((_, i) => i).filter((i) => columns[i].max > columns[i].min);
  while (free > 1e-9 && open.length > 0) {
    const share = free / open.length;
    const stillOpen: number[] = [];
    for (const i of open) {
      const room = columns[i].max - widths[i];
      if (room <= share) {
        widths[i] = columns[i].max;
      } else {
        widths[i] += share;
        stillOpen.push(i);
      }
    }
    free = columnWidth - widths.reduce((a, b) => a + b, 0);
    open = stillOpen;
  }
  return widths;
}
