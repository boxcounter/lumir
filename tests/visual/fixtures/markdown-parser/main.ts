import { EditorState, Compartment } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxTree, syntaxTreeAvailable, forceParsing, foldNodeProp, languageDataProp } from '@codemirror/language';
import { highlightTree, classHighlighter } from '@lezer/highlight';
import { NodeProp } from '@lezer/common';
import { createMarkdownParserExperiment } from './markdownParser';

let failNext = false;
let activeWorkers = 0;
const experiment = createMarkdownParserExperiment(() => {
  const worker = new Worker(new URL(failNext ? './failure.worker.ts' : './markdownParser.worker.ts', import.meta.url), { type: 'module' });
  failNext = false;
  activeWorkers++;
  const terminate = worker.terminate.bind(worker);
  let stopped = false;
  worker.terminate = () => { if (!stopped) { stopped = true; activeWorkers--; } terminate(); };
  return worker;
});
const compartment = new Compartment();
const timings: number[] = [];
const { Language } = await import('@codemirror/language');
let baseAdvances = 0;
const outerAdvances: number[] = [];
const measure = { wrap(inner: any) {
  return { get parsedPos() { return inner.parsedPos; }, get stoppedAt() { return inner.stoppedAt; },
    stopAt(pos: number) { inner.stopAt(pos); }, advance() {
      const start = performance.now();
      try { return inner.advance(); } finally { outerAdvances.push(performance.now() - start); }
    } };
} };
const guard = { wrap(inner: any) { return { get parsedPos() { return inner.parsedPos; }, get stoppedAt() { return inner.stoppedAt; },
  stopAt(pos: number) { inner.stopAt(pos); }, advance() { baseAdvances++; throw new Error('Main-thread base parse advanced'); } }; } };
const base = new Language(markdownLanguage.data, (markdownLanguage.parser as any).configure(guard).configure(experiment.extension));
const language = markdown({ base, extensions: [GFM, measure] });
experiment.bindNodeSet((language.language.parser as any).nodeSet);
const view = new EditorView({ parent: document.querySelector('#editor')!, state: EditorState.create({
  doc: '', extensions: [compartment.of(language), EditorView.lineWrapping],
}) });
function snapshot(tree: any, state: EditorState) {
  const nodes: unknown[] = [];
  tree.iterate({ enter(node: any) {
    nodes.push([node.name, node.from, node.to, node.type.prop(NodeProp.closedBy), node.type.prop(NodeProp.openedBy),
      node.type.prop(foldNodeProp)?.(node.node, state), node.type.prop(languageDataProp) ? state.facet(node.type.prop(languageDataProp)) : null,
      node.tree?.prop(NodeProp.contextHash)]);
  } });
  const highlights: unknown[] = [];
  highlightTree(tree, classHighlighter, (from, to, classes) => highlights.push([from, to, classes]));
  const inner = Array.from({ length: state.doc.length }, (_, pos) => tree.resolveInner(pos, 1).name);
  return { nodes, highlights, inner };
}
Object.assign(window, { experiment: {
  open(doc: string) { const start = performance.now(); view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } }); timings.push(performance.now() - start); },
  available() { const start = performance.now(); const result = forceParsing(view, view.state.doc.length, 10); timings.push(performance.now() - start); return result && syntaxTreeAvailable(view.state, view.state.doc.length); },
  compare() {
    const reference = EditorState.create({ doc: view.state.doc, extensions: markdown({ base: markdownLanguage, extensions: [GFM] }) });
    const tree = markdown({ base: markdownLanguage, extensions: [GFM] }).language.parser.parse(view.state.doc.toString());
    return { actual: snapshot(syntaxTree(view.state), view.state), expected: snapshot(tree, reference) };
  },
  failNext() { failNext = true; },
  mode(mode: string) { view.dispatch({ effects: compartment.reconfigure([language, EditorView.theme({ '&': { fontFamily: mode === 'md' ? 'serif' : 'monospace' } })]) }); },
  metrics() { return { ...experiment.metrics, activeWorkers, baseAdvances, outerAdvances, callbacks: timings }; },
  destroy() { view.destroy(); experiment.destroy(); },
} });
