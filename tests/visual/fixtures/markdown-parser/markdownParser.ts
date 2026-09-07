import { ParseContext } from "@codemirror/language";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import type { MarkdownConfig } from "@lezer/markdown";
import { NodeProp, Tree, TreeBuffer } from "@lezer/common";
import type { PackedTree } from "./markdownParser.worker";

export function createMarkdownParserExperiment(makeWorker = () => new Worker(
  new URL("./markdownParser.worker.ts", import.meta.url), { type: "module" },
)) {
  let nodeSet = (markdownLanguage.parser as import("@lezer/markdown").MarkdownParser).configure(GFM).nodeSet;
  const metrics = { requests: 0, cancellations: 0, retries: 0, cacheHits: 0,
    postMs: [] as number[], messageMs: [] as number[], rebuildMs: [] as number[], workerParseMs: [] as number[], workerPackMs: [] as number[] };
  let worker: Worker | undefined;
  let version = 0;
  let document: string | undefined;
  let packed: PackedTree | undefined;
  let pending: Promise<unknown> | undefined;
  let settle: (() => void) | undefined;
  let destroyed = false;
  let failures = 0;
  let fatal: Error | undefined;

  function unpack(value: PackedTree): Tree {
    return new Tree(nodeSet.types[value.type], value.children.map(child => "buffer" in child
      ? new TreeBuffer(child.buffer, child.length, nodeSet) : unpack(child)), value.positions, value.length,
    value.contextHash === undefined ? undefined : [[NodeProp.contextHash, value.contextHash]]);
  }

  function cancel() {
    if (worker) { worker.terminate(); worker = undefined; metrics.cancellations++; }
    settle?.();
    settle = undefined;
    pending = undefined;
  }

  function request(doc: string) {
    const ownVersion = ++version;
    metrics.requests++;
    pending = new Promise<void>(resolve => { settle = resolve; });
    try {
      worker = makeWorker();
      worker.onmessage = event => {
        const start = performance.now();
        if (destroyed || ownVersion !== version || event.data.version !== ownVersion) return;
        packed = event.data.packed;
        metrics.workerParseMs.push(event.data.parseMs);
        metrics.workerPackMs.push(event.data.packMs);
        worker?.terminate();
        worker = undefined;
        settle?.(); settle = undefined;
        metrics.messageMs.push(performance.now() - start);
      };
      worker.onerror = () => {
        if (destroyed || ownVersion !== version) return;
        cancel();
        if (++failures <= 2) { metrics.retries++; request(doc); }
        else fatal = new Error("Markdown worker failed after two retries");
      };
      const start = performance.now();
      worker.postMessage({ version: ownVersion, doc });
      metrics.postMs.push(performance.now() - start);
    } catch (error) {
      cancel();
      fatal = error instanceof Error ? error : new Error(String(error));
    }
  }

  const extension: MarkdownConfig = {
    wrap(_base, input, fragments, ranges) {
      if (destroyed) throw new Error("Markdown parser experiment destroyed");
      if (ranges.length !== 1 || ranges[0].from !== 0 || ranges[0].to !== input.length)
        throw new Error("Markdown parser experiment only supports full documents");
      const doc = input.read(0, input.length);
      if (document !== doc) {
        cancel(); document = doc; packed = undefined; fatal = undefined; failures = 0; request(doc);
      }
      if (fatal) throw fatal;
      if (!packed) return ParseContext.getSkippingParser(pending).startParse(input, fragments, ranges);
      metrics.cacheHits++;
      const start = performance.now();
      const tree = unpack(packed);
      metrics.rebuildMs.push(performance.now() - start);
      return { parsedPos: input.length, stoppedAt: null, stopAt() {}, advance: () => tree };
    },
  };
  return { extension, metrics, bindNodeSet(set: typeof nodeSet) { nodeSet = set; }, destroy() { destroyed = true; version++; cancel(); packed = undefined; document = undefined; } };
}
