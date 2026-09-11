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

/** 表格宽度合同的双态输出。 */
export interface TableWidthPlan {
  /** 每列轨道宽：恒为 max-content——任何栏宽下列不收缩、cell 不折行。 */
  tracks: number[];
  /** 表框宽 = Σmax = 内容自然宽。 */
  tableWidth: number;
  /** 表框可见宽 = min(自然宽, 栏宽)，超出部分由滚动容器横滚承载。 */
  visibleWidth: number;
  /** 自然宽 ≤ 栏宽 ⇒ fit（整表可见）；否则 scroll（横滚，零裁切）。 */
  mode: "fit" | "scroll";
}

/**
 * 表格宽度合同的纯函数：输入每列 min/max 度量与阅读栏宽，输出双态布局计划。
 * 与 style.css 的声明式规则同构：表框 `inline-size: max-content` + 轨道
 * `minmax(min-content, max-content)` ⇒ 轨道恒解析为 max-content；栏宽 clamp
 * （`max-inline-size: 100%`）与 `overflow-x: auto` 都在滚动容器
 * .cm-lp-table-scroll 上——栏宽只决定表框可见形态，不影响轨道宽度。
 * 不存在折行收缩态（W 方案已被 tower 裁决否决）；min 度量无收缩路径可参与，
 * 仅为度量完整性保留。
 * 运行时布局由 CSS grid 执行（声明式同构，避免测量回写引入 M110/M115 类
 * 测量-布局反馈错位）；本函数供属性测试生成期望与 Node 侧钉死不变量。
 */
export function planTableWidth(columns: readonly ColumnMeasure[], columnWidth: number): TableWidthPlan {
  const tracks = columns.map((c) => c.max);
  const tableWidth = tracks.reduce((sum, w) => sum + w, 0);
  const visibleWidth = Math.min(tableWidth, columnWidth);
  return { tracks, tableWidth, visibleWidth, mode: tableWidth <= columnWidth ? "fit" : "scroll" };
}
