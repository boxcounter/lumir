import { EditorState, Compartment } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { syntaxTree, syntaxTreeAvailable, forceParsing, foldNodeProp, languageDataProp } from '@codemirror/language';
import { highlightTree, classHighlighter } from '@lezer/highlight';
import { NodeProp } from '@lezer/common';
import { createMarkdownParserExperiment } from './markdownParser';

let failNext = false;
let fault = '';
let activeWorkers = 0;
const queued: (() => void)[] = [];
const experiment = createMarkdownParserExperiment(() => {
  const url = new URL(failNext || fault ? './failure.worker.ts' : './markdownParser.worker.ts', import.meta.url);
  url.searchParams.set('fault', fault);
  const worker = new Worker(url, { type: 'module' });
  if (fault === 'messageerror') setTimeout(() => worker.onmessageerror?.call(worker, new MessageEvent('messageerror')), 10);
  failNext = false;
  activeWorkers++;
  const post = worker.postMessage.bind(worker);
  worker.postMessage = ((message: any) => {
    const onmessage = worker.onmessage;
    const onerror = worker.onerror;
    queued.push(() => {
      onmessage?.call(worker, new MessageEvent('message', { data: { version: message.version, packed: null } }));
      onerror?.call(worker, new ErrorEvent('error', { cancelable: true }));
    });
    post(message);
  }) as typeof worker.postMessage;
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
const { createEditor } = await import('../../../../src/editor');
const editor = createEditor(document.querySelector('#editor')!, 'md', { base, extensions: [GFM, measure] });
const view = editor.view;
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
  open(doc: string) { const start = performance.now(); editor.openDocument(doc, 'experiment.md'); timings.push(performance.now() - start); },
  available() { const start = performance.now(); const result = forceParsing(view, view.state.doc.length, 10); timings.push(performance.now() - start); return result && syntaxTreeAvailable(view.state, view.state.doc.length); },
  compare() {
    const reference = EditorState.create({ doc: view.state.doc, extensions: markdown({ base: markdownLanguage, extensions: [GFM] }) });
    const tree = markdown({ base: markdownLanguage, extensions: [GFM] }).language.parser.parse(view.state.doc.toString());
    return { actual: snapshot(syntaxTree(view.state), view.state), expected: snapshot(tree, reference) };
  },
  failNext() { failNext = true; },
  fault(value: string) { fault = value; },
  flushQueued(count = queued.length) { queued.splice(0, count).forEach(callback => callback()); },
  status() { return experiment.status(); },
  mode(mode: 'md' | 'code') { editor.setMode(mode); return editor.mode(); },
  reset() { editor.reset(); },
  metrics() { return { ...experiment.metrics, activeWorkers, baseAdvances, outerAdvances, callbacks: timings }; },
  destroy() { view.destroy(); experiment.destroy(); },
} });
