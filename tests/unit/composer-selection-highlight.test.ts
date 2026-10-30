import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composerSelectionBandIndexes,
  type ComposerCaret,
  type ComposerSelection,
} from "../../src/harness-panel.ts";
import type { ComposerBlock } from "../../src/quote-card.ts";

const para = (text: string): ComposerBlock => ({ kind: "paragraph", text });
const paragraphLength = (block: ComposerBlock): number => block.kind === "paragraph" ? block.text.length : 0;
const quote: ComposerBlock = {
  kind: "quote",
  card: { file: "synthetic.md", heading: "合成", headingPath: "合成", lines: "1-1", text: "引用" },
};
const message: ComposerBlock = {
  kind: "msgquote",
  card: { role: "assistant", at: null, text: "消息摘录" },
};
const image: ComposerBlock = {
  kind: "image",
  card: { name: "pasted-0123456789abcdef.png", sourceMime: "image/png" },
};
const selection = (anchor: ComposerCaret, focus: ComposerCaret): ComposerSelection => ({ anchor, focus });

test("HC6 高亮集合：三类卡片在首位 / 中间 / 末位都进入全选带", () => {
  for (const blocks of [
    [quote, para("后")],
    [para("前"), message, para("后")],
    [para("前"), image],
    [quote, para("一"), message, para("二"), image, para("三")],
  ]) {
    assert.deepEqual(
      composerSelectionBandIndexes(blocks, selection({ block: 0, offset: 0 }, { block: blocks.length, offset: 0 })),
      blocks.map((_, index) => index),
    );
  }
});

test("HC6 高亮集合：方向不影响结果，局部段落不夸大成整段", () => {
  const blocks = [para("abc"), quote, message, image, para("xyz")];
  const forward = selection({ block: 0, offset: 1 }, { block: 4, offset: 2 });
  const backward = selection({ block: 4, offset: 2 }, { block: 0, offset: 1 });
  assert.deepEqual(composerSelectionBandIndexes(blocks, forward), [1, 2, 3]);
  assert.deepEqual(composerSelectionBandIndexes(blocks, backward), [1, 2, 3]);
  assert.deepEqual(
    composerSelectionBandIndexes(blocks, selection({ block: 0, offset: 0 }, { block: 0, offset: 3 })),
    [0],
  );
  assert.deepEqual(
    composerSelectionBandIndexes(blocks, selection({ block: 4, offset: 0 }, { block: 4, offset: 3 })),
    [4],
  );
});

test("HC6 高亮集合：块前缘是排除端点，跨块空段落仍有完整高亮", () => {
  const blocks = [para("abc"), quote, para("")];
  assert.deepEqual(
    composerSelectionBandIndexes(blocks, selection({ block: 0, offset: 0 }, { block: 1, offset: 0 })),
    [0],
  );
  assert.deepEqual(
    composerSelectionBandIndexes(blocks, selection({ block: 0, offset: 0 }, { block: 3, offset: 0 })),
    [0, 1, 2],
  );
  assert.deepEqual(
    composerSelectionBandIndexes([para(""), quote, para("")], selection({ block: 0, offset: 0 }, { block: 3, offset: 0 })),
    [0, 1, 2],
  );
});

test("HC6 高亮集合：null、折叠和越界输入不产生不存在或残留块", () => {
  const blocks = [para("abc"), quote, para("def")];
  assert.deepEqual(composerSelectionBandIndexes(blocks, null), []);
  const positions: ComposerCaret[] = [];
  for (let block = 0; block < blocks.length; block += 1) {
    const length = paragraphLength(blocks[block]);
    for (let offset = 0; offset <= length; offset += 1) positions.push({ block, offset });
  }
  positions.push({ block: blocks.length, offset: 0 });
  for (const caret of positions) {
    assert.deepEqual(composerSelectionBandIndexes(blocks, selection(caret, caret)), []);
  }
  assert.deepEqual(
    composerSelectionBandIndexes(blocks, selection({ block: -10, offset: 0 }, { block: 99, offset: 0 })),
    [0, 1, 2],
  );
});

test("HC6 高亮属性：块类型 × 位置 × 方向 × 折叠分布均满足集合边界", () => {
  const sequences = [
    [para("a")],
    [quote],
    [para("ab"), message],
    [image, para("cd")],
    [quote, para("ab"), message, para("cd"), image],
    [para(""), quote, para("")],
  ];
  for (const blocks of sequences) {
    const carets: ComposerCaret[] = [{ block: blocks.length, offset: 0 }];
    for (let block = 0; block < blocks.length; block += 1) {
      const length = paragraphLength(blocks[block]);
      const offsets = new Set([0, length, Math.floor(length / 2)]);
      for (const offset of offsets) carets.push({ block, offset });
    }
    for (const anchor of carets) {
      for (const focus of carets) {
        const bands = composerSelectionBandIndexes(blocks, selection(anchor, focus));
        const reverse = composerSelectionBandIndexes(blocks, selection(focus, anchor));
        assert.deepEqual(bands, reverse, `方向对称：${JSON.stringify({ anchor, focus })}`);
        assert.equal(new Set(bands).size, bands.length, "下标不得重复");
        for (const index of bands) assert.ok(index >= 0 && index < blocks.length, "下标必须对应既有块");
        if (anchor.block === focus.block && anchor.offset === focus.offset) assert.deepEqual(bands, []);
        for (let index = 0; index < blocks.length; index += 1) {
          if (blocks[index].kind === "paragraph") continue;
          const start = anchor.block < focus.block || (anchor.block === focus.block && anchor.offset <= focus.offset) ? anchor : focus;
          const end = start === anchor ? focus : anchor;
          const intersects = start.block <= index && end.block >= index && !(end.block === index && end.offset <= 0);
          assert.equal(bands.includes(index), intersects, `原子卡片相交必画：${JSON.stringify({ anchor, focus, index })}`);
        }
      }
    }
  }
});
