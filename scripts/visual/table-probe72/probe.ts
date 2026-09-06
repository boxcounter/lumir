import {EditorState} from '@codemirror/state';
import {BlockWrapper, Decoration, EditorView, ViewPlugin, WidgetType} from '@codemirror/view';
import {small, large} from './fixture';
import {tables} from './model';
import './style.css';

class Empty extends WidgetType {
  toDOM() { const span = document.createElement('span'); span.className = 'cell'; span.setAttribute('role', 'cell'); return span; }
}
let source = small;
let model = tables(source);
let expected = '';
let view: EditorView;
const status = document.querySelector('#status')!;
const report = document.querySelector('#report')!;
const receiver = document.querySelector<HTMLTextAreaElement>('#receiver')!;
function extensions() {
  const valid = model.tables.filter(t => t.rectangular);
  const wrappers = valid.flatMap((table, i) => {
    const from = source.lastIndexOf('\n', table.from - 1) + 1;
    return [BlockWrapper.create({tagName: 'div', rank: 10, attributes: {class: 'table-scroll', role: 'region', 'aria-label': `Source table ${i + 1}`, tabindex: '0', 'data-table': String(i)}}).range(from, table.to), BlockWrapper.create({tagName: 'div', rank: 0, attributes: {class: 'table-inner', role: 'table', 'aria-label': `Source table ${i + 1}`, 'aria-colcount': String(table.columns), style: `--columns:${table.columns}`}}).range(from, table.to)];
  });
  const plugin = ViewPlugin.fromClass(class {
    decorations;
    constructor(v: EditorView) { this.decorations = this.build(v); }
    update(update: any) { if (update.viewportChanged || update.docChanged) this.decorations = this.build(update.view); }
    build(v: EditorView) {
      const ranges = [];
      for (const table of valid) {
        for (const row of table.rows) {
          if (!v.visibleRanges.some(r => row.to >= r.from && row.from <= r.to)) continue;
          const line = v.state.doc.lineAt(row.from);
          ranges.push(Decoration.line({attributes: {class: 'table-row', role: 'row'}}).range(line.from));
          let cursor = line.from;
          row.slots.forEach((slot, i) => {
            if (cursor < slot.from) ranges.push(Decoration.replace({}).range(cursor, slot.from));
            if (slot.from === slot.to) ranges.push(Decoration.widget({widget: new Empty(), side: 1}).range(slot.from));
            else ranges.push(Decoration.mark({class: 'cell', attributes: {role: row.header ? 'columnheader' : 'cell', 'aria-colindex': String(i + 1), style: `text-align:${table.align[i]}`}}).range(slot.from, slot.to));
            cursor = slot.to;
          });
          if (cursor < row.to) ranges.push(Decoration.replace({}).range(cursor, row.to));
        }
        const separator = v.state.doc.lineAt(table.separator.from);
        if (v.visibleRanges.some(r => separator.to >= r.from && separator.from <= r.to)) {
          ranges.push(Decoration.line({attributes: {class: 'table-separator', 'aria-hidden': 'true'}}).range(separator.from));
          ranges.push(Decoration.replace({}).range(separator.from, separator.to));
        }
      }
      return Decoration.set(ranges, true);
    }
  }, {decorations: v => v.decorations});
  return [EditorState.readOnly.of(true), EditorView.lineWrapping, EditorView.blockWrappers.of(BlockWrapper.set(wrappers, true)), plugin, EditorView.updateListener.of(() => { status.textContent = `doc unchanged=${view?.state.doc.toString() === source}; selection=${view?.state.selection.main.from}..${view?.state.selection.main.to}`; })];
}
function load(text: string) {
  source = text; model = tables(source);
  view?.destroy();
  view = new EditorView({parent: document.querySelector('#editor')!, state: EditorState.create({doc: source, extensions: extensions()})});
  status.textContent = `Ready; ${source.length} chars; metadata=${model.metadataMs.toFixed(2)}ms`;
}
function button(text: string, action: () => void) {
  const b = document.createElement('button'); b.textContent = text; b.onclick = action; document.querySelector('#controls')!.append(b);
}
button('Small', () => load(small));
button('Large', () => load(large));
button('Middle', () => { const pos = Math.floor(view.state.doc.length / 2); view.dispatch({selection: {anchor: pos}, effects: EditorView.scrollIntoView(pos, {y: 'center'})}); });
button('Top', () => view.dispatch({effects: EditorView.scrollIntoView(0, {y: 'start'})}));
button('Narrow', () => document.querySelector('main')!.classList.toggle('narrow'));
button('Measure', () => {
  const rows = [...view.dom.querySelectorAll('.table-row')];
  const scrolls = [...view.dom.querySelectorAll<HTMLElement>('.table-scroll')];
  report.textContent = JSON.stringify({userAgent: navigator.userAgent, docUnchanged: view.state.doc.toString() === source, length: source.length, metadataMs: model.metadataMs, viewport: view.viewport, visibleRanges: view.visibleRanges, renderedRows: rows.length, renderedLines: view.dom.querySelectorAll('.cm-line').length, totalRows: model.tables.reduce((sum,t) => sum+t.rows.length,0), scrollerWidth: view.scrollDOM.clientWidth, scrolls: scrolls.map(s => ({width:s.clientWidth, scrollWidth:s.scrollWidth, left:s.scrollLeft, rect:s.getBoundingClientRect().toJSON()})), firstRows: rows.slice(0,5).map(row => [...row.querySelectorAll('.cell')].map(cell => ({text:cell.textContent, x:cell.getBoundingClientRect().x,width:cell.getBoundingClientRect().width,height:cell.getBoundingClientRect().height})))}, null, 2);
});
for (const kind of ['Partial','Table','Cross','All']) button(kind, () => {
  const table = model.tables[0];
  const from = kind === 'Partial' ? table.rows[1].slots[0].from + 1 : kind === 'Table' ? table.from : 0;
  const to = kind === 'Partial' ? from + 3 : kind === 'All' ? source.length : kind === 'Table' ? table.to : Math.min(source.length, table.to + 20);
  expected = source.slice(from, to); receiver.value = '';
  view.dispatch({selection: {anchor: from, head: to}}); view.focus();
});
button('Check paste', () => { status.textContent = `paste matches=${receiver.value === expected}; actual=${receiver.value.length}; expected=${expected.length}; doc unchanged=${view.state.doc.toString() === source}`; });
button('Focus table', () => view.dom.querySelector<HTMLElement>('.table-scroll')?.focus());
button('Focus editor', () => view.focus());
load(small);
