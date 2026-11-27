// tests/unit/editing-oracle-model.ts —— 编辑对抗测试的**独立参照模型**（M832）。
//
// 纪律：本文件 MUST NOT import 生产代码。期望值全部由这里的模型算出，生产实现只当适配器
// （见 tests/unit/editing-oracle.test.ts 与 tests/visual/scenes/editing-oracle.spec.ts）。
// 同时 MUST NOT 重新实现 CommonMark：正文列表只覆盖顶层 `- / + / * / 数字[.)]` 单行形态，
// 嵌套、引用、代码块、表格一律不进生成器。
//
// 浏览器兼容：只用 JS 内置对象（Intl.Segmenter / Math.imul），不碰 node:*，因此 Playwright
// 场景与 Node 单测可以共用同一份模型。
//
// 两个模型各自是「状态 + 显式操作 + 压快照」：
// - BodyOracle：doc / anchor / head / past / future / saved，对应正文 CM EditorState；
// - ComposerOracle：text / anchor / head / cards / past / future / draft / sends，对应
//   M831 之后的 text+caret+cards 架构（旧 blocks 模型已退役，不再为它建平行测试）。
//
// 历史口径（REVIEW 的「假绿」教训：别猜生产的分组）：模型按**显式操作**一步一压，
// 适配器侧用时间屏障 / isolateHistory 把生产 history 对齐到同一粒度；对拍只断言逻辑步，
// 不把 CM 的击键聚簇行为写进期望值。

// ---------------------------------------------------------------------------
// 确定性 PRNG（mulberry32）——固定 seed 可复跑；失败读数带 seed / step / op
// ---------------------------------------------------------------------------

export interface Rng {
  next(): number;
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function rngInt(rng: Rng, bound: number): number {
  return Math.min(bound - 1, Math.floor(rng.next() * bound));
}

export function pickOne<T>(rng: Rng, list: readonly T[]): T {
  return list[rngInt(rng, list.length)];
}

/** `LUMIR_ORACLE_SEEDS=17,23` 只复跑指定 seed；未设置 / 非法时用默认集合。 */
export function seedsFromEnv(raw: string | undefined, fallback: readonly number[]): number[] {
  if (!raw) return [...fallback];
  const parsed = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0);
  return parsed.length > 0 ? parsed : [...fallback];
}

// ---------------------------------------------------------------------------
// 字素簇边界（正文模型删除 / composer 组合中删除共用）
// ---------------------------------------------------------------------------

let segmenter: Intl.Segmenter | null = null;

function graphemeSegments(text: string): Intl.Segments {
  segmenter ??= new Intl.Segmenter("en", { granularity: "grapheme" });
  return segmenter.segment(text);
}

/** `pos` 之前一个字素簇的起点。 */
export function graphemeBefore(text: string, pos: number): number {
  if (pos <= 0) return 0;
  let start = 0;
  for (const piece of graphemeSegments(text.slice(0, pos))) {
    start = piece.index;
  }
  return start;
}

/** `pos` 之后一个字素簇的终点。 */
export function graphemeAfter(text: string, pos: number): number {
  if (pos >= text.length) return text.length;
  let seen = false;
  for (const piece of graphemeSegments(text.slice(pos))) {
    if (seen) return pos + piece.index;
    seen = true;
  }
  return text.length;
}

/** 列宽（tab 推进到下一个 tabSize 倍数），与 CM `countColumn` 同口径。 */
function columnOf(text: string, tabSize = 4): number {
  let col = 0;
  for (const ch of text) col = ch === "\t" ? col + tabSize - (col % tabSize) : col + 1;
  return col;
}

/** 退格删除的起点。折叠 caret 落在「整行前缀全是行首缩进」的区间内时，CM 的
 *  `deleteCharBackward` 按缩进档（默认 indentUnit = 2）删，而不是单字素——这是生产命令的
 *  显式行为（`deleteByChar` 的 byIndentUnit 分支），模型照此对齐。其余位置按字素边界。 */
export function backwardDeleteStart(doc: string, pos: number): number {
  if (pos <= 0) return 0;
  const line = lineSpanAt(doc, pos);
  const before = doc.slice(line.from, pos);
  if (pos > line.from && pos < line.from + 200 && /^[ \t]*$/.test(before)) {
    if (before.endsWith("\t")) return pos - 1;
    const drop = columnOf(before) % 2 || 2;
    let start = pos;
    for (let index = 0; index < drop && doc[start - 1] === " "; index += 1) start -= 1;
    return start;
  }
  return graphemeBefore(doc, pos);
}

/** CM `doc.lineAt(pos)` 的同一口径：`pos` 落在换行符上时归属前一行；空行 [from, from]。 */
export function lineSpanAt(doc: string, pos: number): { from: number; to: number } {
  const clamped = Math.max(0, Math.min(pos, doc.length));
  const from = clamped === 0 ? 0 : doc.lastIndexOf("\n", clamped - 1) + 1;
  const nl = doc.indexOf("\n", clamped);
  return { from, to: nl === -1 ? doc.length : nl };
}

export function lineEnds(doc: string): number[] {
  const ends: number[] = [];
  let from = 0;
  while (true) {
    const nl = doc.indexOf("\n", from);
    ends.push(nl === -1 ? doc.length : nl);
    if (nl === -1) break;
    from = nl + 1;
  }
  return ends;
}

// ---------------------------------------------------------------------------
// 正文模型
// ---------------------------------------------------------------------------

export interface BodySnapshot {
  doc: string;
  anchor: number;
  head: number;
}

export interface BodyReading extends BodySnapshot {
  saved: string;
  dirty: boolean;
}

interface MarkerText {
  markerFrom: number;
  markerTo: number;
  contentFrom: number;
  marker: string;
  ordered: boolean;
  number: number | null;
  delimiter: string;
}

/** 顶层列表 marker 的文本形态；行首缩进 / 引用前缀不在本模型范围（生成器不产出）。 */
const MARKER_RE = /^((\d{1,9})([.)])|([-+*]))([ \t]+)(.*)$/;
const MARKER_ONLY_RE = /^((\d{1,9})([.)])|([-+*]))([ \t]+)$/;
/** 行尾无空白的**有序**空项（`2.`）：真实列表里是合法空项；`-` / `*` / `+` 单独一行
 *  不是同一形态（真机探针：`- a\n-` 的 Enter 是普通换行），故只收有序 marker。 */
const MARKER_EOL_RE = /^(\d{1,9})([.)])$/;

function markerTextAt(lineText: string, lineFrom: number): MarkerText | null {
  const match = MARKER_RE.exec(lineText);
  if (!match) {
    const eol = MARKER_EOL_RE.exec(lineText);
    if (!eol) return null;
    return {
      markerFrom: lineFrom,
      markerTo: lineFrom + eol[0].length,
      contentFrom: lineFrom + eol[0].length,
      marker: eol[0],
      ordered: true,
      number: Number(eol[1]),
      delimiter: eol[2],
    };
  }
  const marker = match[1];
  const whitespace = match[5];
  const markerFrom = lineFrom;
  const markerTo = lineFrom + marker.length;
  return {
    markerFrom,
    markerTo,
    contentFrom: Math.min(markerTo + whitespace.length, lineFrom + lineText.length),
    marker,
    ordered: match[2] !== undefined,
    number: match[2] === undefined ? null : Number(match[2]),
    delimiter: match[3] ?? "",
  };
}

function nextMarkerText(marker: MarkerText): string {
  return marker.ordered ? `${(marker.number ?? 0) + 1}${marker.delimiter} ` : `${marker.marker} `;
}

/** 裸 marker 行的文本级近似：**空 marker 行**且上一行是普通正文（非列表行、非空行）。
 *
 *  生产侧的裸行判定走语法树（`bareListMarkerLine`）；本模型不重建语法树，只在生成器实际
 *  会产出的形态上给出等价判据：`para\n1. `。真实列表的空项（如 `- a\n- `）上一行是列表行，
 *  不在裸行分支，Backspace 由原生单字符删除接管——本模型不覆盖那一半。 */
export function isBareMarkerLine(doc: string, pos: number): boolean {
  const line = lineSpanAt(doc, pos);
  const text = doc.slice(line.from, line.to);
  const only = MARKER_ONLY_RE.exec(text);
  if (only === null) return false;
  // 只认 `1. ` / `+ ` / `* `：`3. ` 紧跟段落时解析器可能接成 setext 等其它形态。
  if (only[2] !== undefined && Number(only[2]) !== 1) return false;
  if (only[4] !== undefined && only[4] === "-") return false;
  if (line.from === 0) return false;
  const previous = lineSpanAt(doc, line.from - 1);
  const previousText = doc.slice(previous.from, previous.to);
  if (previousText.trim() === "") return false;
  if (MARKER_RE.test(previousText)) return false;
  if (previousText.startsWith(">") || previousText.startsWith("```")) return false;
  // `para\n- ` 是 setext 标题下线（生产侧 bareListMarkerLine 的 SetextHeading 排除）。
  if (/^-([ \t]*)$/.test(text)) return false;
  // 上一行必须自己是一个块的开头（文档首行 / 空行之后）。否则它可能是某个未闭合列表
  // 的 lazy continuation——此时 marker 行会被语法树接回那个列表，不是裸行。
  // 覆盖生成器实际产出的裸行形态 `para\n1. `；更复杂的 open-list 形态不猜。
  if (previous.from > 0) {
    const above = lineSpanAt(doc, previous.from - 1);
    if (doc.slice(above.from, above.to).trim() !== "") return false;
  }
  return true;
}

export function bareBackspacePositions(doc: string): number[] {
  return lineEnds(doc).filter((pos) => isBareMarkerLine(doc, pos));
}

/** 行首列表 marker 在渲染层被隐藏的源码区间（合同 docs/specs/lists.md 的 L5 / editor-caret C6）：
 *  `from = 行首`，`to = 内容起点`。非 marker 行返回 null。水平移动的期望值由它给出，
 *  不从生产 `listHiddenRangeAt` 反推。 */
export function hiddenMarkerRangeAt(doc: string, pos: number): { from: number; to: number } | null {
  const line = lineSpanAt(doc, pos);
  const marker = markerTextAt(doc.slice(line.from, line.to), line.from);
  if (marker === null) return null;
  return { from: line.from, to: marker.contentFrom };
}

/** 水平移动一步的期望落点：字素步进；落点严格落在隐藏 marker 区间内部时钳到可见一侧。 */
export function bodyHorizontalStep(doc: string, pos: number, forward: boolean): number {
  const next = forward ? graphemeAfter(doc, pos) : graphemeBefore(doc, pos);
  const hidden = hiddenMarkerRangeAt(doc, next);
  if (hidden !== null && next > hidden.from && next < hidden.to) {
    return forward ? hidden.to : hidden.from;
  }
  return next;
}

/** 生成器可用的安全光标位：各行的行尾 + 非 marker 行内的行首 / 行中位置。
 *  刻意排除 marker 行内部（行首到 marker 之后）：那里生产侧是上游命令的行首分支，
 *  不属于本模型的「行尾 / 内容位」两态口径。 */
function bodySafePositions(doc: string): number[] {
  const positions = new Set<number>();
  const lines = lineEnds(doc);
  for (const end of lines) positions.add(end);
  let from = 0;
  for (const end of lines) {
    const text = doc.slice(from, end);
    // 只取行首与行尾：任意行中位置可能落在代理对 / ZWJ 簇内部（插入会劈开字素），
    // 那属于「按 UTF-16 offset 插入」的另一类语义，不在本模型范围。
    if (markerTextAt(text, from) === null) positions.add(from);
    from = end + 1;
  }
  return [...positions].filter((pos) => pos >= 0 && pos <= doc.length).sort((a, b) => a - b);
}

export class BodyOracle {
  doc: string;
  anchor: number;
  head: number;
  saved: string;
  private past: BodySnapshot[] = [];
  private future: BodySnapshot[] = [];

  constructor(doc: string, caret = doc.length) {
    this.doc = doc;
    this.anchor = Math.max(0, Math.min(caret, doc.length));
    this.head = this.anchor;
    this.saved = doc;
  }

  get dirty(): boolean {
    return this.doc !== this.saved;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  reading(): BodyReading {
    return {
      doc: this.doc,
      anchor: this.anchor,
      head: this.head,
      saved: this.saved,
      dirty: this.dirty,
    };
  }

  setSelection(anchor: number, head = anchor): void {
    const a = Math.max(0, Math.min(anchor, this.doc.length));
    const h = Math.max(0, Math.min(head, this.doc.length));
    this.anchor = a;
    this.head = h;
  }

  private snapshot(): BodySnapshot {
    return { doc: this.doc, anchor: this.anchor, head: this.head };
  }

  private push(): void {
    this.past.push(this.snapshot());
    this.future = [];
  }

  private replace(from: number, to: number, insert: string): void {
    const start = Math.max(0, Math.min(from, to));
    const end = Math.max(from, to);
    this.push();
    this.doc = this.doc.slice(0, start) + insert + this.doc.slice(end);
    this.anchor = start + insert.length;
    this.head = this.anchor;
  }

  insert(text: string): void {
    const from = Math.min(this.anchor, this.head);
    const to = Math.max(this.anchor, this.head);
    this.replace(from, to, text);
  }

  deleteBackward(): void {
    const from = Math.min(this.anchor, this.head);
    const to = Math.max(this.anchor, this.head);
    if (from !== to) {
      this.replace(from, to, "");
      return;
    }
    const start = backwardDeleteStart(this.doc, from);
    if (start === from) return;
    this.replace(start, from, "");
  }

  deleteForward(): void {
    const from = Math.min(this.anchor, this.head);
    const to = Math.max(this.anchor, this.head);
    if (from !== to) {
      this.replace(from, to, "");
      return;
    }
    const end = graphemeAfter(this.doc, to);
    if (end === to) return;
    this.replace(from, end, "");
  }

  /** `⌘⌫`（deleteSoftLine/HardLineBackward）：空光标在行中删到行首；已在行首则删前一个
   *  换行（把本行并入上一行）。两引擎实测同口径（M836 探针）。 */
  deleteLineBackward(): void {
    const from = Math.min(this.anchor, this.head);
    const to = Math.max(this.anchor, this.head);
    if (from !== to) {
      this.replace(from, to, "");
      return;
    }
    const line = lineSpanAt(this.doc, this.head);
    if (this.head > line.from) {
      this.replace(line.from, this.head, "");
      return;
    }
    if (line.from === 0) return;
    this.replace(line.from - 1, line.from, "");
  }

  /** 非列表行 / setext 邻接行的普通换行（生产与文档的同一合同）：
   *  - 不把行首空白复制给新行（散文里它不是结构）；
   *  - 空光标在行首 / 行首空白内时，换行归一到整段空白之前：被下移的内容行保留自己的
   *    行首空白，新行为空，光标落在内容行行首空白之后（不拆开空白、不产生纯空白行）；
   *  - 光标右侧的空白并入换行（`foo   |` + Enter → `foo\n`，上游既有处理）。 */
  private plainEnter(from: number, to: number): void {
    const line = lineSpanAt(this.doc, this.head);
    const lineText = this.doc.slice(line.from, line.to);
    const leading = /^[ \t]*/.exec(lineText)?.[0] ?? "";
    if (from === to && this.head <= line.from + leading.length) {
      this.push();
      this.doc = this.doc.slice(0, line.from) + "\n" + this.doc.slice(line.from);
      this.anchor = line.from + 1 + leading.length;
      this.head = this.anchor;
      return;
    }
    // 非空选区的 Enter 是「用换行替换选区」：两引擎probe（2026-11-27）实测
    // `alpha beta` 的 [2,6) → `al\nbeta`，不额外吞掉选区之外的尾随空白。尾随空白并入换行
    // 只适用于折叠 caret（`foo   |` → `foo\n`）。
    let cutTo = to;
    if (from === to) while (cutTo < line.to && /\s/.test(this.doc[cutTo])) cutTo++;
    this.replace(from, cutTo, "\n");
  }

  /** 顶层列表行 Enter 的两态口径（见文件头与 docs/specs/lists.md 的 B 条）：
   *  - marker 后只有空白 ⇒ 删 marker 与其后空白，该行保留为空行、不新增行；
   *  - marker 后有内容 ⇒ 在光标处插 `\n<下一 marker>`（有序 +1 沿用分隔符，无序同标记）。
   *  非列表行 ⇒ 普通换行（不复制行首空白；行首 / 行首空白内的归一化见 `plainEnter`）。
   *  调用位限定在行尾 / 内容位。 */
  enter(): void {
    const from = Math.min(this.anchor, this.head);
    const to = Math.max(this.anchor, this.head);
    // 非空选区的 Enter 一律是「用换行替换选区」：两引擎 probe（2026-11-27）实测
    // `alpha beta` 的 [2,6) → `al\nbeta`、`- a\n- b` 的 [2,4) → `- \n- b`、
    // 表格 cell 选区 [26,30) → `| \nd |`——列表续行 / 重编号 / 表格钳制都只在折叠 caret 上生效。
    if (from !== to) {
      this.replace(from, to, "\n");
      return;
    }
    const line = lineSpanAt(this.doc, this.head);
    const marker = markerTextAt(this.doc.slice(line.from, line.to), line.from);
    // 行尾无空白的 `2.`：只有真实列表块里才是空项；`p\n2.` 的空项不能打断段落，
    // 生产侧是普通换行（`1.` 同理，空项即使是 1 也不能打断段落）。
    const eolMarkerOnly =
      marker !== null && marker.ordered && marker.contentFrom === marker.markerTo && marker.markerTo === line.to;
    if (eolMarkerOnly && !this.isRealListBlock(line.from)) {
      this.plainEnter(from, to);
      return;
    }
    // `para\n- ` 是 setext 标题下线：生产侧的裸行判定把它排除（bareListMarkerLine 的
    // SetextHeading 分支），Enter 落回普通换行。模型只识别这一种文本形态，覆盖生成器
    // 可能造出的 `- ` 空行。`* ` / `+ ` / 有序 marker 不受 setext 影响。
    const setextUnderline =
      marker !== null &&
      marker.marker === "-" &&
      this.doc.slice(marker.contentFrom, line.to).trim() === "" &&
      line.from > 0 &&
      (() => {
        const previous = lineSpanAt(this.doc, line.from - 1);
        const previousText = this.doc.slice(previous.from, previous.to);
        // setext 下线只能紧跟段落行；列表项的 lazy continuation 行不是段落
        // （`2. x\n😀😀文\n- ` 的 `- ` 是真实空列表项，不是标题下线）。
        return (
          previousText.trim() !== "" &&
          markerTextAt(previousText, previous.from) === null &&
          !this.isItemContinuation(previous.from)
        );
      })();
    if (marker !== null && !setextUnderline) {
      // 真实列表 / 重编号判据必须在任何文档改动**之前**求值：空项删掉 marker 之后该行
      // 不再是 marker 行。裸行（lazy continuation）走字的续行、不套 loose / 重编号规则。
      const real = this.isRealListBlock(line.from);
      const renumber = marker.ordered && real;
      const content = this.doc.slice(marker.contentFrom, line.to);
      if (content.trim() === "") {
        // 空项退出（M399 的上游分支 + 裸行分支；行尾位置口径）：删 marker 与其后空白，
        // 该行保留为空行、不新增行。真实有序列表项还要把后续同分隔符兄弟项重编号从
        // 本项号码接上（`1. a\n2. \n3. b` → `1. a\n\n2. b`）；裸行 / 无序不重编号。
        this.push();
        this.doc = this.doc.slice(0, marker.markerFrom) + this.doc.slice(line.to);
        this.anchor = marker.markerFrom;
        this.head = marker.markerFrom;
        if (renumber) this.renumberFollowingOrdered(marker.delimiter, marker.number ?? 0);
        return;
      }
      // 行尾回车且下一行是空行、空行之后仍是同型列表项时，上游把新项插在空行**之后**
      // （保持 loose list 的空行分隔）：`1. a\n\n2. b` → `1. a\n\n2. \n\n3. b`。
      // 空行后不是同型列表（不同标记 / 不同分隔符 / 普通文本 / 文件末尾）时按普通插入处理。
      if (this.head === line.to && this.doc[line.to] === "\n") {
        let scanFrom = line.to + 1;
        let sawBlank = false;
        while (true) {
          const next = lineSpanAt(this.doc, scanFrom);
          const nextText = this.doc.slice(next.from, next.to);
          if (nextText.trim() === "") {
            sawBlank = true;
            if (next.to >= this.doc.length) break;
            scanFrom = next.to + 1;
            continue;
          }
          const nextMarker = markerTextAt(nextText, next.from);
          const sameType =
            nextMarker !== null &&
            nextMarker.ordered === marker.ordered &&
            (marker.ordered ? nextMarker.delimiter === marker.delimiter : nextMarker.marker === marker.marker);
          if (sawBlank && sameType) {
            const nextLabel = nextMarkerText(marker);
            // 列表续行会先删掉本行尾随空白（上游 `insertNewlineContinueMarkup`）。
            const trimmed = this.doc.slice(line.from, line.to).replace(/[ \t]+$/, "");
            const trimmedTo = line.from + trimmed.length;
            this.push();
            this.doc =
              this.doc.slice(0, trimmedTo) + `\n\n${nextLabel}\n` + this.doc.slice(line.to + 1);
            this.anchor = trimmedTo + 2 + nextLabel.length;
            this.head = this.anchor;
            if (renumber) this.renumberFollowingOrdered(marker.delimiter, (marker.number ?? 0) + 2);
            return;
          }
          break;
        }
      }
      const insert = `${real && this.isLooseList(line.from) ? "\n\n" : "\n"}${nextMarkerText(marker)}`;
      // 行尾回车：上游先删掉本行尾随空白再续 marker（`1. one ` → `1. one\n2. `）。
      const trailing = this.head === line.to ? /[ \t]+$/.exec(this.doc.slice(line.from, line.to)) : null;
      const cutFrom = trailing === null ? from : line.to - trailing[0].length;
      const cutTo = trailing === null ? to : line.to;
      this.replace(cutFrom, cutTo, insert);
      // 有序列表的后续兄弟项由上游 `insertNewlineContinueMarkup` 连续重编号（`1. a\n2. b`
      // 在 a 后回车 → 新 `2. `、旧 b 变 `3. b`）。裸 marker 块（lazy continuation）走
      // `enterBareMarkerLine`，只续字面下一 marker、不重编号——判据是块首能否打断段落。
      if (renumber) this.renumberFollowingOrdered(marker.delimiter, (marker.number ?? 0) + 2);
      return;
    }
    this.plainEnter(from, to);
  }

  /** 当前项所在的列表是不是 loose list（项之间出现过空行）。loose list 的 Enter 在
   *  新项前多插一个空行（上游保持列表松紧风格）。向上找最近的同型 marker，途中出现过
   *  空行即 loose；空行之后先遇到「自身是新块开头」的非 marker 行视为已离开该列表。 */
  private isLooseList(lineFrom: number): boolean {
    const here = lineSpanAt(this.doc, lineFrom);
    const hereMarker = markerTextAt(this.doc.slice(here.from, here.to), here.from);
    if (hereMarker === null) return false;
    let sawBlank = false;
    let scanFrom = lineFrom;
    while (scanFrom > 0) {
      const line = lineSpanAt(this.doc, scanFrom - 1);
      const text = this.doc.slice(line.from, line.to);
      if (text.trim() === "") {
        sawBlank = true;
        scanFrom = line.from;
        continue;
      }
      const marker = markerTextAt(text, line.from);
      if (marker !== null) {
        const sameType =
          marker.ordered === hereMarker.ordered &&
          (hereMarker.ordered ? marker.delimiter === hereMarker.delimiter : marker.marker === hereMarker.marker);
        return sawBlank && sameType;
      }
      // 非 marker 行：上一行也是空行（或它是文档首行）⇒ 已跨出列表；否则是上一项的
      // lazy continuation（`1. rf...\n文中\n\n2. b`），继续上找。
      const previousBlank =
        line.from === 0 ||
        (() => {
          const above = lineSpanAt(this.doc, line.from - 1);
          return this.doc.slice(above.from, above.to).trim() === "";
        })();
      if (sawBlank && previousBlank) return false;
      scanFrom = line.from;
    }
    return false;
  }

  /** 当前 marker 行所属的列表是不是真实列表（而不是段落 lazy continuation）。
   *  先沿 lazy continuation 行向上找到这条链上最上面的 marker：链首在文档开头 / 空行
   *  之后 ⇒ 真实；链首紧跟段落时，只有「非空无序项」或「非空且从 1 开始的有序项」能
   *  打断段落（CommonMark），否则整条链都是段落。 */
  private isRealListBlock(lineFrom: number): boolean {
    const here = lineSpanAt(this.doc, lineFrom);
    const hereMarker = markerTextAt(this.doc.slice(here.from, here.to), here.from);
    if (hereMarker === null) return false;
    let top = lineFrom;
    let scan = lineFrom;
    while (scan > 0) {
      const above = lineSpanAt(this.doc, scan - 1);
      const text = this.doc.slice(above.from, above.to);
      if (text.trim() === "") break;
      const aboveMarker = markerTextAt(text, above.from);
      if (aboveMarker !== null) {
        const sameType =
          aboveMarker.ordered === hereMarker.ordered &&
          (hereMarker.ordered ? aboveMarker.delimiter === hereMarker.delimiter : aboveMarker.marker === hereMarker.marker);
        if (!sameType) break;
        top = above.from;
      }
      scan = above.from;
    }
    if (top === 0) return true;
    const before = lineSpanAt(this.doc, top - 1);
    const beforeText = this.doc.slice(before.from, before.to);
    if (beforeText.trim() === "") return true;
    // 紧邻上一种是列表 marker（换列表类型 / 不同分隔符）⇒ 新列表真实存在。
    if (markerTextAt(beforeText, before.from) !== null) return true;
    const first = lineSpanAt(this.doc, top);
    const firstText = this.doc.slice(first.from, first.to);
    const firstMarker = markerTextAt(firstText, first.from);
    if (firstMarker === null) return false;
    const firstContent = this.doc.slice(firstMarker.contentFrom, first.to).trim();
    if (!firstMarker.ordered) return firstContent !== "";
    return firstMarker.number === 1 && firstContent !== "";
  }

  /** 从光标所在的新行之后，把后续同分隔符顶层有序项重编号为 expected 起。
   *  重编号穿过空行与 lazy continuation 行（`3. d\n4. \n中😀Z😀é\n4. 😀b` 的末行
   *  属于同一列表、要变 5）；空行之后另起一段（非 marker、上一行也是空行）或遇到不同
   *  类型 / 分隔符的 marker 即停。 */
  private renumberFollowingOrdered(delimiter: string, expected: number): void {
    const line = lineSpanAt(this.doc, this.head);
    const lines = this.doc.slice(line.to).split("\n");
    let number = expected;
    let sawBlank = false;
    for (let index = 1; index < lines.length; index += 1) {
      const text = lines[index];
      if (text.trim() === "") {
        sawBlank = true;
        continue;
      }
      const spaced = MARKER_RE.exec(text);
      const eol = MARKER_EOL_RE.exec(text);
      if (spaced !== null || eol !== null) {
        const ordered = spaced === null || spaced[2] !== undefined;
        const sameDelimiter = ordered && (spaced !== null ? spaced[3] === delimiter : eol![2] === delimiter);
        if (!sameDelimiter) break;
        lines[index] = spaced !== null
          ? `${number}${delimiter}${spaced[5]}${spaced[6]}`
          : `${number}${delimiter}`;
        number += 1;
        sawBlank = false;
        continue;
      }
      // 空行之后另起一段：列表已结束；否则是上一项的 lazy continuation，继续扫描。
      if (sawBlank && (index === 0 || lines[index - 1].trim() === "")) break;
    }
    this.doc = this.doc.slice(0, line.to) + lines.join("\n");
  }

  /** 折叠 caret 的 Backspace 会不会删掉空 marker 行的尾随空白（把 `2. ` 变成行尾
   *  `2.`）——裸 marker 行的这个位置由 `backspaceBareMarkerLine` 接管（删整段标记，
   *  与模型的单字素删除不同口径），生成器绕开这种形态。 */
  wouldDropMarkerWhitespace(): boolean {
    if (this.anchor !== this.head) return false;
    const line = lineSpanAt(this.doc, this.head);
    if (this.head !== line.to) return false;
    const match = MARKER_RE.exec(this.doc.slice(line.from, line.to));
    if (match === null) return false;
    return match[6] === "" && match[1].length < line.to - line.from;
  }

  /** 该位置是否落在某个已打开列表项的 lazy continuation / 续行里（向上先遇到 marker 而
   *  不是空行 / 文档开头）。在续行上按 Enter 是上游的另一套行为（会在项内插段落并重排
   *  后续项号），不在本模型范围；生成器不在这里发 Enter。 */
  isItemContinuation(pos: number): boolean {
    const line = lineSpanAt(this.doc, pos);
    const text = this.doc.slice(line.from, line.to);
    if (text.trim() === "" || markerTextAt(text, line.from) !== null) return false;
    let scanFrom = line.from;
    while (scanFrom > 0) {
      const above = lineSpanAt(this.doc, scanFrom - 1);
      const aboveText = this.doc.slice(above.from, above.to);
      if (aboveText.trim() === "") return false;
      if (markerTextAt(aboveText, above.from) !== null) return true;
      scanFrom = above.from;
    }
    return false;
  }

  /** marker 行所在的连续块是否「简单列表块」：从块首到块尾全是同型、带空白的 marker
   *  行，块内没有空行 / 续行 / 行尾无空白 marker。这类块上的 Enter 只走本模型的
   *  续行 / 空项退出两种口径；其它形态（lazy continuation、loose、EOL marker、
   *  setext 邻接）是上游另有分支的边角，生成器不在此发 Enter。 */
  private isSimpleMarkerBlock(lineFrom: number): boolean {
    const line = lineSpanAt(this.doc, lineFrom);
    const marker = markerTextAt(this.doc.slice(line.from, line.to), line.from);
    if (marker === null || marker.contentFrom === marker.markerTo) return false;
    const sameType = (text: string, from: number): boolean => {
      const other = markerTextAt(text, from);
      return (
        other !== null &&
        other.contentFrom !== other.markerTo &&
        other.ordered === marker.ordered &&
        (marker.ordered ? other.delimiter === marker.delimiter : other.marker === marker.marker)
      );
    };
    let scan = line.to;
    while (scan < this.doc.length) {
      const next = lineSpanAt(this.doc, scan + 1);
      const text = this.doc.slice(next.from, next.to);
      if (text.trim() === "") break;
      if (!sameType(text, next.from)) return false;
      scan = next.to;
    }
    scan = line.from;
    while (scan > 0) {
      const above = lineSpanAt(this.doc, scan - 1);
      const text = this.doc.slice(above.from, above.to);
      if (text.trim() === "") break;
      if (!sameType(text, above.from)) return false;
      scan = above.from;
    }
    return true;
  }

  /** 生成器可安全发 Enter 的位置：普通非缩进行（非列表续行），或简单列表块里的 marker 行。 */
  canEnterAt(pos: number): boolean {
    if (this.isItemContinuation(pos)) return false;
    const line = lineSpanAt(this.doc, pos);
    const text = this.doc.slice(line.from, line.to);
    if (text.trim() === "") return false;
    if (/^[ \t]/.test(text)) return false;
    if (markerTextAt(text, line.from) === null) return true;
    return this.isSimpleMarkerBlock(line.from);
  }

  canBareBackspaceAt(pos: number): boolean {
    const line = lineSpanAt(this.doc, pos);
    return pos === line.to && isBareMarkerLine(this.doc, pos);
  }

  /** 裸 marker 行内容起点的 Backspace：单次删去 marker 与其后空白，保留该行空行。 */
  bareMarkerBackspace(): void {
    if (!this.canBareBackspaceAt(this.head)) return;
    const line = lineSpanAt(this.doc, this.head);
    this.push();
    this.doc = this.doc.slice(0, line.from) + this.doc.slice(line.to);
    this.anchor = line.from;
    this.head = line.from;
  }

  undo(): void {
    const before = this.past.pop();
    if (before === undefined) return;
    this.future.push(this.snapshot());
    this.doc = before.doc;
    this.anchor = before.anchor;
    this.head = before.head;
  }

  redo(): void {
    const after = this.future.pop();
    if (after === undefined) return;
    this.past.push(this.snapshot());
    this.doc = after.doc;
    this.anchor = after.anchor;
    this.head = after.head;
  }

  save(): void {
    this.saved = this.doc;
  }

  safePositions(): number[] {
    return bodySafePositions(this.doc);
  }

  bareBackspacePositions(): number[] {
    return lineEnds(this.doc).filter((pos) => this.canBareBackspaceAt(pos));
  }
}

export type BodyOp =
  | { kind: "setSelection"; anchor: number; head: number }
  | { kind: "insert"; text: string }
  | { kind: "deleteBackward" }
  | { kind: "deleteForward" }
  | { kind: "deleteLineBackward" }
  | { kind: "enter"; at?: number }
  | { kind: "bareBackspace"; at?: number }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "save" };

export function applyBodyOp(model: BodyOracle, op: BodyOp): void {
  switch (op.kind) {
    case "setSelection":
      model.setSelection(op.anchor, op.head);
      return;
    case "insert":
      model.insert(op.text);
      return;
    case "deleteBackward":
      model.deleteBackward();
      return;
    case "deleteForward":
      model.deleteForward();
      return;
    case "deleteLineBackward":
      model.deleteLineBackward();
      return;
    case "enter":
      if (op.at !== undefined) model.setSelection(op.at);
      model.enter();
      return;
    case "bareBackspace":
      if (op.at !== undefined) model.setSelection(op.at);
      model.bareMarkerBackspace();
      return;
    case "undo":
      model.undo();
      return;
    case "redo":
      model.redo();
      return;
    case "save":
      model.save();
      return;
  }
}

export function describeBodyOp(op: BodyOp): string {
  switch (op.kind) {
    case "setSelection":
      return `setSelection(${op.anchor},${op.head})`;
    case "insert":
      return `insert(${JSON.stringify(op.text)})`;
    case "enter":
      return `enter(at=${op.at ?? "caret"})`;
    case "bareBackspace":
      return `bareBackspace(at=${op.at ?? "caret"})`;
    default:
      return op.kind;
  }
}

export type BodyCategory = "plain" | "list" | "marker" | "history" | "save";

export function bodyCategory(op: BodyOp): BodyCategory {
  switch (op.kind) {
    case "setSelection":
    case "insert":
    case "deleteBackward":
    case "deleteForward":
    case "deleteLineBackward":
      return "plain";
    case "enter":
      return "list";
    case "bareBackspace":
      return "marker";
    case "undo":
    case "redo":
      return "history";
    case "save":
      return "save";
  }
}

// 生成器刻意不产出空格（不扩大 CommonMark 生成范围）。行首空白的新回落口径由本模型的
// `plainEnter` 与 `tests/unit/editing-oracle.test.ts` 的确定性对拍直接覆盖，不靠生成器。
const BODY_ALPHABET = ["a", "b", "Z", "中", "文", "😀", "é", "\n"] as const;

/** 生成**当前状态上合法**的下一步正文操作；所有位置来自模型自己的安全位。 */
export function randomBodyOp(rng: Rng, model: BodyOracle): BodyOp {
  const positions = model.safePositions();
  const roll = rng.next();
  if (roll < 0.3) {
    const count = 1 + rngInt(rng, 3);
    let text = "";
    for (let index = 0; index < count; index += 1) text += pickOne(rng, BODY_ALPHABET);
    return { kind: "insert", text };
  }
  if (roll < 0.43) {
    return model.wouldDropMarkerWhitespace() ? { kind: "insert", text: "d" } : { kind: "deleteBackward" };
  }
  if (roll < 0.55) {
    // M836 起行尾 forward Delete 由 beforeinput 闸门接管（删且只删换行），
    // 与模型的单字素删除同口径，不再绕开「并成嵌套列表」的 marker 邻接格。
    return { kind: "deleteForward" };
  }
  if (roll < 0.7) {
    const anchor = pickOne(rng, positions);
    const head = rng.next() < 0.5 ? anchor : pickOne(rng, positions);
    return { kind: "setSelection", anchor, head };
  }
  if (roll < 0.82) {
    const enterPositions = positions.filter((pos) => model.canEnterAt(pos));
    if (enterPositions.length > 0) return { kind: "enter", at: pickOne(rng, enterPositions) };
    return { kind: "insert", text: "e" };
  }
  if (roll < 0.87) {
    const bare = model.bareBackspacePositions();
    if (bare.length > 0) return { kind: "bareBackspace", at: pickOne(rng, bare) };
    return { kind: "deleteBackward" };
  }
  if (roll < 0.93) return model.canUndo ? { kind: "undo" } : { kind: "insert", text: "u" };
  if (roll < 0.97) return model.canRedo ? { kind: "redo" } : { kind: "insert", text: "r" };
  return { kind: "save" };
}

// ---------------------------------------------------------------------------
// Composer 模型（M831 最终架构：text / caret / cards）
// ---------------------------------------------------------------------------

export type CardId = string;

export interface ComposerSnapshot {
  text: string;
  anchor: number;
  head: number;
  cards: CardId[];
  cardAnchors?: number[];
}

export interface ComposerDraft {
  text: string;
  caret: number | null;
  cards: CardId[];
}

export interface ComposerReading extends ComposerSnapshot {
  draft: ComposerDraft | null;
  sends: number;
}

interface CompositionState {
  before: ComposerSnapshot;
  start: number;
  marked: string;
}

function mapCardAnchors(anchors: readonly number[], from: number, to: number, insertLength: number): number[] {
  const delta = insertLength - (to - from);
  return anchors.map((anchor) => {
    if (anchor <= from) return anchor;
    if (anchor >= to) return anchor + delta;
    return from;
  });
}

function sortCardsByAnchor(cards: readonly CardId[], anchors: readonly number[]): { cards: CardId[]; anchors: number[] } {
  const pairs = cards.map((card, index) => ({ card, anchor: anchors[index], index }));
  pairs.sort((a, b) => a.anchor - b.anchor || a.index - b.index);
  return { cards: pairs.map((pair) => pair.card), anchors: pairs.map((pair) => pair.anchor) };
}

export class ComposerOracle {
  text: string;
  anchor: number;
  head: number;
  cards: CardId[];
  private cardAnchors: number[];
  draft: ComposerDraft | null = null;
  sends = 0;
  private past: ComposerSnapshot[] = [];
  private future: ComposerSnapshot[] = [];
  /** 与 past/future 平行的「该撤销事件是否携带 changes」标记：CM 的 history 对
   *  `input.type.compose` 一律并入上一笔 **changes** 事件（不看时间窗），文档改动之外的
   *  事件（附件增删）不参与合并。模型按同一规则决定组合提交是否新开撤销步。 */
  private pastKind: ("changes" | "other")[] = [];
  private futureKind: ("changes" | "other")[] = [];
  private composition: CompositionState | null = null;

  constructor(content: { text?: string; caret?: number | null; cards?: readonly CardId[] } = {}) {
    this.text = content.text ?? "";
    const caret = content.caret ?? this.text.length;
    this.anchor = Math.max(0, Math.min(caret, this.text.length));
    this.head = this.anchor;
    this.cards = [...(content.cards ?? [])];
    this.cardAnchors = this.cards.map(() => 0);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get composing(): boolean {
    return this.composition !== null;
  }

  reading(): ComposerReading {
    return {
      text: this.text,
      anchor: this.anchor,
      head: this.head,
      cards: [...this.cards],
      draft: this.draft === null ? null : { ...this.draft, cards: [...this.draft.cards] },
      sends: this.sends,
    };
  }

  setSelection(anchor: number, head = anchor): void {
    const a = Math.max(0, Math.min(anchor, this.text.length));
    const h = Math.max(0, Math.min(head, this.text.length));
    this.anchor = a;
    this.head = h;
  }

  private snapshot(): ComposerSnapshot {
    return {
      text: this.text,
      anchor: this.anchor,
      head: this.head,
      cards: [...this.cards],
      cardAnchors: [...this.cardAnchors],
    };
  }

  private push(kind: "changes" | "other" = "changes"): void {
    this.past.push(this.snapshot());
    this.pastKind.push(kind);
    this.future = [];
    this.futureKind = [];
  }

  private lastEventKind(): "changes" | "other" | null {
    return this.pastKind.length === 0 ? null : this.pastKind[this.pastKind.length - 1];
  }

  private replace(from: number, to: number, insert: string): void {
    const start = Math.max(0, Math.min(from, to));
    const end = Math.max(from, to);
    this.push();
    this.text = this.text.slice(0, start) + insert + this.text.slice(end);
    this.cardAnchors = mapCardAnchors(this.cardAnchors, start, end, insert.length);
    const sorted = sortCardsByAnchor(this.cards, this.cardAnchors);
    this.cards = sorted.cards;
    this.cardAnchors = sorted.anchors;
    this.anchor = start + insert.length;
    this.head = this.anchor;
  }

  insert(text: string): void {
    if (this.composition !== null) throw new Error("oracle: 组合期不调用 insert（应走 compositionUpdate）");
    const from = Math.min(this.anchor, this.head);
    const to = Math.max(this.anchor, this.head);
    this.replace(from, to, text);
  }

  deleteBackward(): void {
    if (this.composition !== null) throw new Error("oracle: 组合期不调用 deleteBackward（应走 compositionDelete）");
    const from = Math.min(this.anchor, this.head);
    const to = Math.max(this.anchor, this.head);
    if (from !== to) {
      this.replace(from, to, "");
      return;
    }
    const start = backwardDeleteStart(this.text, from);
    if (start === from) return;
    this.replace(start, from, "");
  }

  deleteForward(): void {
    if (this.composition !== null) throw new Error("oracle: 组合期不调用 deleteForward（应走 compositionDelete）");
    const from = Math.min(this.anchor, this.head);
    const to = Math.max(this.anchor, this.head);
    if (from !== to) {
      this.replace(from, to, "");
      return;
    }
    const end = graphemeAfter(this.text, to);
    if (end === to) return;
    this.replace(from, end, "");
  }

  /** ⇧Enter：插入一个 `\n`，光标落插入文本之后；独立撤销步。 */
  softBreak(): void {
    if (this.composition !== null) throw new Error("oracle: 组合期不调用 softBreak");
    const from = Math.min(this.anchor, this.head);
    const to = Math.max(this.anchor, this.head);
    this.replace(from, to, "\n");
  }

  addCard(id: CardId): void {
    this.push("other");
    const head = this.head;
    const lineStart = this.text.lastIndexOf("\n", Math.max(0, head - 1)) + 1;
    const nextBreak = this.text.indexOf("\n", head);
    const lineEnd = nextBreak < 0 ? this.text.length : nextBreak;
    let anchor = head;
    if (this.text.length > 0 && head !== lineStart) {
      if (head < lineEnd || nextBreak < 0) {
        this.text = this.text.slice(0, head) + "\n" + this.text.slice(head);
        anchor = head + 1;
      } else {
        anchor = head + 1;
      }
    }
    this.anchor = anchor;
    this.head = anchor;
    this.cards = [...this.cards, id];
    this.cardAnchors = [...this.cardAnchors, anchor];
    const sorted = sortCardsByAnchor(this.cards, this.cardAnchors);
    this.cards = sorted.cards;
    this.cardAnchors = sorted.anchors;
  }

  removeCard(index: number): void {
    if (index < 0 || index >= this.cards.length) return;
    this.push("other");
    this.cards = [...this.cards.slice(0, index), ...this.cards.slice(index + 1)];
    this.cardAnchors = [...this.cardAnchors.slice(0, index), ...this.cardAnchors.slice(index + 1)];
  }

  /** 组合开始：文本与卡片冻结为 `before`；组合期更新只改 marked 区。 */
  compositionStart(): void {
    if (this.composition !== null) return;
    if (this.anchor !== this.head) this.setSelection(this.head);
    this.composition = { before: this.snapshot(), start: this.head, marked: "" };
  }

  private compositionApply(marked: string): void {
    const composition = this.composition;
    if (composition === null) return;
    const previousMarkedLength = composition.marked.length;
    composition.marked = marked;
    const base = composition.before.text;
    this.text = base.slice(0, composition.start) + marked + base.slice(composition.start);
    this.cardAnchors = mapCardAnchors(
      composition.before.cardAnchors ?? [],
      composition.start,
      composition.start + previousMarkedLength,
      marked.length,
    );
    const sorted = sortCardsByAnchor(this.cards, this.cardAnchors);
    this.cards = sorted.cards;
    this.cardAnchors = sorted.anchors;
    this.anchor = composition.start + marked.length;
    this.head = this.anchor;
  }

  compositionUpdate(marked: string): void {
    if (this.composition === null) return;
    this.compositionApply(marked);
  }

  /** 组合中 Backspace：只删 marked 区最后一个字素，绝不越过到 committed 文本或卡片。 */
  compositionDelete(): void {
    const composition = this.composition;
    if (composition === null) return;
    const start = graphemeBefore(composition.marked, composition.marked.length);
    this.compositionApply(composition.marked.slice(0, start));
  }

  /** 取消组合：文本 / 选区 / 卡片全等于组合前；不进 history。 */
  compositionCancel(): void {
    const composition = this.composition;
    if (composition === null) return;
    this.text = composition.before.text;
    this.anchor = composition.before.anchor;
    this.head = composition.before.head;
    this.cards = [...composition.before.cards];
    this.cardAnchors = [...(composition.before.cardAnchors ?? [])];
    this.composition = null;
  }

  /** 提交候选：在原 caret 位置恰好插入候选一次；整段组合 = 一个撤销步。 */
  compositionCommit(candidate: string): void {
    const composition = this.composition;
    if (composition === null) return;
    // CM：`input.type.compose` 的提交并入上一笔 changes 事件（撤销点沿用那一笔的
    // startState / startSelection）；上一笔不是 changes（附件操作）时才新开一步。
    if (this.lastEventKind() !== "changes") {
      this.past.push(composition.before);
      this.pastKind.push("changes");
    }
    this.future = [];
    this.futureKind = [];
    const base = composition.before.text;
    this.text = base.slice(0, composition.start) + candidate + base.slice(composition.start);
    this.anchor = composition.start + candidate.length;
    this.head = this.anchor;
    this.cards = [...composition.before.cards];
    this.cardAnchors = mapCardAnchors(composition.before.cardAnchors ?? [], composition.start, composition.start, candidate.length);
    const sorted = sortCardsByAnchor(this.cards, this.cardAnchors);
    this.cards = sorted.cards;
    this.cardAnchors = sorted.anchors;
    this.cardAnchors = [...(composition.before.cardAnchors ?? [])];
    this.composition = null;
  }

  undo(): void {
    const before = this.past.pop();
    if (before === undefined) return;
    const kind = this.pastKind.pop() ?? "changes";
    this.future.push(this.snapshot());
    this.futureKind.push(kind);
    this.text = before.text;
    this.anchor = before.anchor;
    this.head = before.head;
    this.cards = [...before.cards];
    this.cardAnchors = [...(before.cardAnchors ?? [])];
  }

  redo(): void {
    const after = this.future.pop();
    if (after === undefined) return;
    const kind = this.futureKind.pop() ?? "changes";
    this.past.push(this.snapshot());
    this.pastKind.push(kind);
    this.text = after.text;
    this.anchor = after.anchor;
    this.head = after.head;
    this.cards = [...after.cards];
    this.cardAnchors = [...(after.cardAnchors ?? [])];
  }

  /** 草稿落盘快照：v3 的 text / caret / placed cards。 */
  saveDraft(): void {
    this.draft = { text: this.text, caret: this.head, cards: [...this.cards] };
  }

  /** 发送成功：清空文本与附件，新输入是新的编辑史（HC2.4），草稿一并清除。 */
  send(): void {
    this.sends += 1;
    this.text = "";
    this.anchor = 0;
    this.head = 0;
    this.cards = [];
    this.cardAnchors = [];
    this.past = [];
    this.future = [];
    this.pastKind = [];
    this.futureKind = [];
    this.draft = null;
    this.composition = null;
  }
}

export type ComposerOp =
  | { kind: "setSelection"; anchor: number; head: number }
  | { kind: "insert"; text: string }
  | { kind: "deleteBackward" }
  | { kind: "deleteForward" }
  | { kind: "softBreak" }
  | { kind: "addCard"; id: CardId }
  | { kind: "removeCard"; index: number }
  | { kind: "compositionStart" }
  | { kind: "compositionUpdate"; text: string }
  | { kind: "compositionDelete" }
  | { kind: "compositionCancel" }
  | { kind: "compositionCommit"; text: string }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "saveDraft" }
  | { kind: "send" };

export function applyComposerOp(model: ComposerOracle, op: ComposerOp): void {
  switch (op.kind) {
    case "setSelection":
      model.setSelection(op.anchor, op.head);
      return;
    case "insert":
      model.insert(op.text);
      return;
    case "deleteBackward":
      model.deleteBackward();
      return;
    case "deleteForward":
      model.deleteForward();
      return;
    case "softBreak":
      model.softBreak();
      return;
    case "addCard":
      model.addCard(op.id);
      return;
    case "removeCard":
      model.removeCard(op.index);
      return;
    case "compositionStart":
      model.compositionStart();
      return;
    case "compositionUpdate":
      model.compositionUpdate(op.text);
      return;
    case "compositionDelete":
      model.compositionDelete();
      return;
    case "compositionCancel":
      model.compositionCancel();
      return;
    case "compositionCommit":
      model.compositionCommit(op.text);
      return;
    case "undo":
      model.undo();
      return;
    case "redo":
      model.redo();
      return;
    case "saveDraft":
      model.saveDraft();
      return;
    case "send":
      model.send();
      return;
  }
}

export function describeComposerOp(op: ComposerOp): string {
  switch (op.kind) {
    case "setSelection":
      return `setSelection(${op.anchor},${op.head})`;
    case "insert":
      return `insert(${JSON.stringify(op.text)})`;
    case "addCard":
      return `addCard(${op.id})`;
    case "removeCard":
      return `removeCard(${op.index})`;
    case "compositionUpdate":
      return `compositionUpdate(${JSON.stringify(op.text)})`;
    case "compositionCommit":
      return `compositionCommit(${JSON.stringify(op.text)})`;
    default:
      return op.kind;
  }
}

export type ComposerCategory = "plain" | "ime" | "cards" | "history" | "draft" | "send";

export function composerCategory(op: ComposerOp): ComposerCategory {
  switch (op.kind) {
    case "setSelection":
    case "insert":
    case "deleteBackward":
    case "deleteForward":
    case "softBreak":
      return "plain";
    case "addCard":
    case "removeCard":
      return "cards";
    case "compositionStart":
    case "compositionUpdate":
    case "compositionDelete":
    case "compositionCancel":
    case "compositionCommit":
      return "ime";
    case "undo":
    case "redo":
      return "history";
    case "saveDraft":
      return "draft";
    case "send":
      return "send";
  }
}

const COMPOSER_ALPHABET = ["a", "b", "问", "题", "😀", " ", "\n"] as const;
const COMPOSER_IME_UPDATES = ["s", "sh", "shi", "shuang", "候", "选"] as const;

/** 生成**当前状态上合法**的下一步 composer 操作（1..n 条，IME 操作以 burst 形式成组返回）。 */
export function randomComposerOps(rng: Rng, model: ComposerOracle, step: number): ComposerOp[] {
  if (model.composing) {
    const roll = rng.next();
    if (roll < 0.45) return [{ kind: "compositionUpdate", text: pickOne(rng, COMPOSER_IME_UPDATES) }];
    if (roll < 0.65) return [{ kind: "compositionDelete" }];
    if (roll < 0.85) return [{ kind: "compositionCommit", text: pickOne(rng, ["是", "吗", "候"]) }];
    return [{ kind: "compositionCancel" }];
  }
  const roll = rng.next();
  if (roll < 0.26) {
    const count = 1 + rngInt(rng, 3);
    let text = "";
    for (let index = 0; index < count; index += 1) text += pickOne(rng, COMPOSER_ALPHABET);
    return [{ kind: "insert", text }];
  }
  if (roll < 0.38) return [{ kind: "deleteBackward" }];
  if (roll < 0.46) return [{ kind: "deleteForward" }];
  if (roll < 0.56) {
    const anchor = rngInt(rng, model.text.length + 1);
    const head = rng.next() < 0.6 ? anchor : rngInt(rng, model.text.length + 1);
    return [{ kind: "setSelection", anchor, head }];
  }
  if (roll < 0.63) return [{ kind: "softBreak" }];
  if (roll < 0.72) return [{ kind: "addCard", id: `card-${step}` }];
  if (roll < 0.78) return model.cards.length > 0 ? [{ kind: "removeCard", index: rngInt(rng, model.cards.length) }] : [{ kind: "addCard", id: `card-${step}` }];
  if (roll < 0.9) {
    const commit = rng.next() < 0.7;
    const updates = [pickOne(rng, COMPOSER_IME_UPDATES), pickOne(rng, COMPOSER_IME_UPDATES)];
    // 组合起点是折叠 caret：有选区时先折叠（IME 在真实浏览器里会替换选区，本模型不覆盖
    // 「组合替换选区」这一支，生成器因此显式归一）。
    const collapse: ComposerOp[] =
      model.anchor === model.head ? [] : [{ kind: "setSelection", anchor: model.head, head: model.head }];
    return [
      ...collapse,
      { kind: "compositionStart" },
      { kind: "compositionUpdate", text: updates[0] },
      ...(rng.next() < 0.5 ? ([{ kind: "compositionDelete" }] as ComposerOp[]) : []),
      { kind: "compositionUpdate", text: updates[1] },
      commit
        ? { kind: "compositionCommit", text: pickOne(rng, ["是", "吗", "候"]) }
        : { kind: "compositionCancel" },
    ];
  }
  if (roll < 0.94) return model.canUndo ? [{ kind: "undo" }] : [{ kind: "insert", text: "u" }];
  if (roll < 0.97) return model.canRedo ? [{ kind: "redo" }] : [{ kind: "insert", text: "r" }];
  if (roll < 0.99) return [{ kind: "saveDraft" }];
  return model.text === "" && model.cards.length === 0 ? [{ kind: "insert", text: "send" }] : [{ kind: "send" }];
}

// ---------------------------------------------------------------------------
// 失败读数：seed / step / op / before / expected / actual（不开发 shrinker）
// ---------------------------------------------------------------------------

export interface OracleFailure {
  seed: number;
  step: number;
  op: string;
  before: string;
  expected: string;
  actual: string;
}

export function formatOracleFailure(failure: OracleFailure): string {
  return [
    `ORACLE FAIL seed=${failure.seed} step=${failure.step} op=${failure.op}`,
    `before  : ${failure.before}`,
    `expected: ${failure.expected}`,
    `actual  : ${failure.actual}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 编辑状态迁移模型（change add-editor-transition-oracle-nov27）
// ---------------------------------------------------------------------------
//
// 复盘（2026-11-27 编辑器治理）的 P0：编辑器缺陷的高发形态不是同一个 bug 复发，而是「同一操作
// 换一个上下文 / 状态就漏」。既有 BodyOracle 只有 idle 一条路径（正文）与组合一条路径
// （composer），没有「状态」这一维。本段补的是**状态机**：把 idle / composing / settling /
// readOnly 四态与折叠 / 非空选区、上下文、动作组合起来，期望值仍全部由模型算出。
//
// 纪律与文件头一致：不 import 生产代码。上下文是**输入**而不是从文档反推的判据——矩阵声明每格
// 属于哪个上下文，模型只据此给期望；装饰是否在场由执行层断言（见 matrix 模块的 widget 选择器）。
// 动作是否应被生产闸门消费（`consumed`）同理：它取决于上下文（表格 cell 才接管折叠键入），
// 因此由矩阵的 case 声明，模型不猜。
//
// 已知边界（如实登记，不在本模型里假装覆盖）：
// - 组合期的撤销语义归 IME 提交事件（CM 把 `input.type.compose` 并入上一笔 changes），合成
//   通道无法忠实复现「组合前 → 组合后」的历史粒度；composing 的 `history.steps` 因此是 null
//   （不判），对应格只断言源码 / 选区 / 保存载荷。
// - 组合中的 Enter（候选确认）与指针（会结束组合）无法在合成通道上确定复现，矩阵标 N/A。

export type EditState = "idle" | "composing" | "settling" | "readOnly";
export type SelectionShape = "collapsed" | "range";
export type EditContext = "plain" | "inline-replace" | "block-replace" | "list-marker" | "table-cell";
export type EditActionKind = "type" | "deleteBackward" | "deleteForward" | "enter" | "paste" | "pointer";

export interface EditAction {
  kind: EditActionKind;
  /** 键入 / 粘贴的文本。 */
  text?: string;
  /** 指针动作点击的源码位置。 */
  at?: number;
}

export interface TransitionSnapshot {
  doc: string;
  anchor: number;
  head: number;
}

export interface TransitionHistory {
  /** 期望新增的撤销步数；null = 本通道无法忠实复现撤销语义，执行层不判这一列。 */
  steps: 0 | 1 | null;
  /** steps > 0 时，一次 undo 应恢复的源码与选区。 */
  restores: TransitionSnapshot | null;
}

export interface TransitionExpectation extends TransitionSnapshot {
  history: TransitionHistory;
  /** 动作触及的源码行（1 基闭区间）；null = 源码未变。 */
  touched: { fromLine: number; toLine: number } | null;
  /** settling 态：动作后是否仍有未结算的组合收尾。 */
  settle: "none" | "pending" | "resolved";
}

/** 两个文档之间真正变化的行区间（1 基闭区间）。用于「非目标行不变」的**失败定位**：
 *  期望值本身来自模型，这里的区间只把「哪几行该变」显式化，不改判据。 */
export function changedLineRange(before: string, after: string): { fromLine: number; toLine: number } | null {
  if (before === after) return null;
  let prefix = 0;
  const limit = Math.min(before.length, after.length);
  while (prefix < limit && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const lineOf = (doc: string, pos: number): number => {
    let line = 1;
    const end = Math.min(pos, doc.length);
    for (let index = 0; index < end; index += 1) if (doc[index] === "\n") line += 1;
    return line;
  };
  return {
    fromLine: lineOf(before, prefix),
    toLine: lineOf(after, Math.max(prefix, after.length - suffix)),
  };
}

interface BodyCompositionState {
  /** 组合开始时的 caret（折叠）与全文快照；提交只把 marked 文本写回这一位置。 */
  start: number;
  marked: string;
  base: TransitionSnapshot;
}

/** 四态状态机：在 `BodyOracle` 的 idle 语义之上叠加组合 / 结算 / 只读三态。
 *
 *  `apply(action)` 一步一压（既改内部状态又返回期望）；`expect(action)` 在副本上算一次，不改
 *  自身。两者的返回形状相同，调用方不需要区分。 */
export class TransitionOracle {
  readonly body: BodyOracle;
  state: EditState;
  private composition: BodyCompositionState | null = null;
  private settlePending = false;

  constructor(doc: string, caret = doc.length, state: EditState = "idle") {
    this.body = new BodyOracle(doc, caret);
    this.state = state;
  }

  get composing(): boolean {
    return this.composition !== null;
  }

  get pendingSettle(): boolean {
    return this.settlePending;
  }

  snapshot(): TransitionSnapshot {
    return { doc: this.body.doc, anchor: this.body.anchor, head: this.body.head };
  }

  /** 组合开始：只在折叠 caret 上，起点 = 当前 head；marked 从空串开始。 */
  startComposition(): void {
    if (this.state !== "composing" && this.state !== "settling") {
      throw new Error(`oracle: ${this.state} 态不能开始组合`);
    }
    if (this.composition !== null) return;
    if (this.body.anchor !== this.body.head) this.body.setSelection(this.body.head);
    this.composition = { start: this.body.head, marked: "", base: this.snapshot() };
  }

  /** 组合更新：把 marked 整段换成新串（IME 的 compositionupdate 语义）。 */
  compositionSetMarked(marked: string): void {
    if (this.composition === null) throw new Error("oracle: compositionupdate 前必须先 startComposition");
    this.composition.marked = marked;
    this.renderComposition();
  }

  /** 组合中 Backspace：只删 marked 区的最后一个字素簇，绝不越过 committed 文本。 */
  compositionDelete(): void {
    if (this.composition === null) throw new Error("oracle: 组合中删除前必须先 startComposition");
    this.composition.marked = this.composition.marked.slice(
      0,
      graphemeBefore(this.composition.marked, this.composition.marked.length),
    );
    this.renderComposition();
  }

  /** 组合结束（提交 marked）。提交后进入 settling：组合收尾的装饰重建还没跑完。 */
  endComposition(): void {
    if (this.composition === null) return;
    this.composition = null;
    this.state = "settling";
    this.settlePending = true;
  }

  /** 结算回调完成：源码与选区 MUST NOT 因此改变（只允许装饰重建）。 */
  flushSettle(): void {
    this.settlePending = false;
    if (this.state === "settling") this.state = "idle";
  }

  private renderComposition(): void {
    const composition = this.composition;
    if (composition === null) return;
    const { base } = composition;
    const caret = composition.start + composition.marked.length;
    this.body.doc =
      base.doc.slice(0, composition.start) + composition.marked + base.doc.slice(composition.start);
    this.body.setSelection(caret);
  }

  private clone(): TransitionOracle {
    const copy = new TransitionOracle(this.body.doc, 0, this.state);
    copy.body.setSelection(this.body.anchor, this.body.head);
    copy.composition = this.composition === null ? null : { ...this.composition, base: { ...this.composition.base } };
    copy.settlePending = this.settlePending;
    return copy;
  }

  /** 当前状态下动作的期望值；不改内部状态。 */
  expect(action: EditAction): TransitionExpectation {
    const probe = this.clone();
    return probe.apply(action);
  }

  /** 执行动作并返回期望。 */
  apply(action: EditAction): TransitionExpectation {
    const before = this.snapshot();
    if (this.state === "readOnly") {
      // 只读拒收的是**编辑**，不是选区：指针点击仍会移动 caret（C5 只要求不改写文档）。
      const at = action.kind === "pointer"
        ? Math.max(0, Math.min(action.at ?? this.body.head, this.body.doc.length))
        : null;
      return {
        ...before,
        ...(at === null ? {} : { anchor: at, head: at }),
        history: { steps: 0, restores: null },
        touched: null,
        settle: "none",
      };
    }
    if (this.composition !== null) return this.runComposing(action, before);
    const settle: TransitionExpectation["settle"] =
      this.state === "settling" ? (this.settlePending ? "pending" : "resolved") : "none";
    switch (action.kind) {
      case "type":
      case "paste":
        this.body.insert(action.text ?? "");
        break;
      case "deleteBackward":
        this.body.deleteBackward();
        break;
      case "deleteForward":
        this.body.deleteForward();
        break;
      case "enter":
        this.body.enter();
        break;
      case "pointer": {
        const at = Math.max(0, Math.min(action.at ?? this.body.head, this.body.doc.length));
        this.body.setSelection(at);
        break;
      }
    }
    return this.finish(before, settle);
  }

  private runComposing(action: EditAction, before: TransitionSnapshot): TransitionExpectation {
    switch (action.kind) {
      case "type":
        this.compositionSetMarked(this.composition!.marked + (action.text ?? ""));
        break;
      case "deleteBackward":
        this.compositionDelete();
        break;
      default:
        throw new Error(`oracle: 组合态不支持动作 ${action.kind}（矩阵应标 N/A）`);
    }
    return {
      ...this.snapshot(),
      history: { steps: null, restores: null },
      touched: changedLineRange(before.doc, this.body.doc),
      settle: "none",
    };
  }

  private finish(before: TransitionSnapshot, settle: TransitionExpectation["settle"]): TransitionExpectation {
    const after = this.snapshot();
    const changed = before.doc !== after.doc;
    return {
      ...after,
      history: changed ? { steps: 1, restores: before } : { steps: 0, restores: null },
      touched: changedLineRange(before.doc, after.doc),
      settle,
    };
  }
}

export function describeEditAction(action: EditAction): string {
  switch (action.kind) {
    case "type":
      return `type(${JSON.stringify(action.text ?? "")})`;
    case "paste":
      return `paste(${JSON.stringify(action.text ?? "")})`;
    case "pointer":
      return `pointer(at=${action.at ?? "?"})`;
    default:
      return action.kind;
  }
}
