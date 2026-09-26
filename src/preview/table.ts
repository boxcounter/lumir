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
  reason?: "oversize" | "non-rectangular";
}

function children(node: { firstChild: { name: string; from: number; to: number; nextSibling: any } | null }): { name: string; from: number; to: number }[] {
  const result: { name: string; from: number; to: number }[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

/**
 * 数据行尾部补空列（GFM spec §4.10：「If there are a number of cells fewer than
 * the number of cells in the header row, empty cells are inserted」；Alex 2026-09-16
 * 裁决，合同见 docs/specs/table-reading.md §2）。补出来的是零宽 slot（`.from === .to`），
 * 与 `||` 零宽空槽同形态，由既有空槽渲染路径画成正常空 cell——空 cell 就是空 cell，
 * 不填占位符、不加缺列标记。
 * 一个槽位都没恢复出来的行不补：那是「槽位不能安全映射」，必须整块降级，不能被一串
 * 空 cell 伪装成正常行。多列（cell 数多于表头）同样不修：GFM 是 excess ignored，
 * 静默丢列与「不猜测修复」冲突，仍整块降级。
 */
function padShortRow(row: TableRow, columns: number): void {
  if (row.slots.length === 0) return;
  while (row.slots.length < columns) row.slots.push({ from: row.to, to: row.to });
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
      for (const row of rows) padShortRow(row, columns);
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

/**
 * 降级归因文案（M138）：整块回退的判定结果翻成用户能照着修的一句话。
 * 「保留原始 Markdown」是合同预期行为，但只说这句话等于没说——用户看不到
 * 哪一行出格（实测案例：四行各缺最后一列，排查花掉一整个 survey mission）。
 * 出错行号取**文档行号**（1 基）而非表内行序：用户照着行号就能定位到源文件。
 * 文案单一来源在这里；`.cm-lp-table-degraded` 的 `::after` 经 data 属性取用。
 */
export function degradationNotice(table: TableModel, lineNumberOf: (pos: number) => number): string {
  if (table.reason === "oversize") {
    const kib = Math.max(1, Math.round((table.sourceBytes || table.to - table.from) / 1024));
    return `表格阅读降级：表格约 ${kib} KiB，超过 64 KiB 阅读上限——保留原始 Markdown`;
  }
  const ragged = table.rows.find((row) => row.slots.length !== table.columns);
  if (ragged) {
    return `表格阅读降级：第 ${lineNumberOf(ragged.from)} 行单元格数与表头不符（应为 ${table.columns} 列）——保留原始 Markdown`;
  }
  return "表格阅读降级：无法识别表格结构——保留原始 Markdown";
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

/**
 * 可放大的表（M240，change table-fullscreen-view 的裁决点 3）：`pos` 落在一张**当前渲染为
 * grid** 的表内时返回它，否则 undefined。
 *
 * 判据是既有渲染条件的补集，不是新条件：装饰层只为 `rectangular && !degraded` 的表建
 * `.cm-lp-table` 子树（见 livePreview 的 tableWrappers / buildDecorations 同一份 filter），
 * 因此「降级表与非矩形表没有任何打开路径」是**结构性事实**——不需要一条「这表不能放大」的
 * 分支，更 MUST NOT 用降级提示或「强制放大」旁路模拟（proposal §二）。
 *
 * 纯函数（只吃 TableModel 列表与位置），单测直接构造模型断言五条命中情形（tests/unit）。
 */
export function fullscreenTableAt(tables: readonly TableModel[], pos: number): TableModel | undefined {
  const table = tableAt(tables, pos);
  return table !== undefined && table.rectangular && !table.degraded ? table : undefined;
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
