import { markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { NodeProp, Tree, TreeBuffer } from "@lezer/common";

export type PackedTree = {
  type: number;
  length: number;
  positions: readonly number[];
  contextHash?: number;
  children: (PackedTree | { buffer: Uint16Array; length: number })[];
};

function pack(tree: Tree, transfer: Transferable[]): PackedTree {
  return {
    type: tree.type.id,
    length: tree.length,
    positions: tree.positions,
    contextHash: tree.prop(NodeProp.contextHash),
    children: tree.children.map(child => {
      if (child instanceof TreeBuffer) {
        transfer.push(child.buffer.buffer as ArrayBuffer);
        return { buffer: child.buffer, length: child.length };
      }
      return pack(child, transfer);
    }),
  };
}

const parser = (markdownLanguage.parser as import("@lezer/markdown").MarkdownParser).configure(GFM);
self.onmessage = event => {
  const { version, doc } = event.data;
  const start = performance.now();
  const tree = parser.parse(doc);
  const parsed = performance.now();
  const transfer: Transferable[] = [];
  const packed = pack(tree, transfer);
  self.postMessage({ version, packed, parseMs: parsed - start, packMs: performance.now() - parsed }, { transfer });
};
