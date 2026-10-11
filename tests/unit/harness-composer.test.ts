// 混排 composer 纯模型层的单测（M343，change add-harness-quote-cards 任务 2.3 / 2.4 / 2.5
// 与发送链路 1.2 的模型侧不变量）。合同：openspec/changes/add-harness-quote-cards 的
// spec「混排对话输入区」（拆段插入、光标落卡片下一行）与 design §3（序列化协议）。
//
// 这一层是零 DOM 环境（tests/unit/README.md）：只驱动 src/harness-panel.ts 导出的纯函数
// （模型运算 + 序列化消息解析），DOM 渲染 / 光标 / 四 quirk 的接线归真机验收（M344/QC4 场景）。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backspaceAtCaret,
  boundaryCaretAt,
  caretScrollTop,
  createUndoHistory,
  deleteForwardAtCaret,
  deleteSelectionRange,
  domCaretTarget,
  imageCardMetaText,
  imageDimensionsFromNatural,
  insertCardAtCaret,
  insertBlockAtCaret,
  insertPlainTextAtCaret,
  insertSoftBreakAtCaret,
  isCardFrontCaret,
  parseQuoteMessage,
  removeBlockAt,
  unescapeXmlEntities,
} from "../../src/harness-panel.ts";
import { serializeQuoteMessage } from "../../src/quote-card.ts";
import type { ComposerBlock, QuoteCard } from "../../src/quote-card.ts";

const cardA: QuoteCard = {
  file: "reading-workflow.md",
  heading: "筛选",
  headingPath: "阅读工作流 › 筛选",
  lines: "9-10",
  text: "先读结论再读论证",
};
const cardB: QuoteCard = {
  file: "reading-workflow.md",
  heading: "复盘",
  headingPath: "阅读工作流 › 复盘",
  lines: "16-17",
  text: "每周捞出可执行动作",
};
const para = (text: string): ComposerBlock => ({ kind: "paragraph", text });
const quote = (card: QuoteCard): ComposerBlock => ({ kind: "quote", card });
// 图片卡片块（change harness-composer-image-paste）：HC1 生成器的第三类原子卡片。
const imageBlock: ComposerBlock = {
  kind: "image",
  card: {
    name: "pasted-0123456789abcdef.webp",
    sourceMime: "image/png",
    width: 640,
    height: 360,
  },
};

// ── 光标处拆段插入（spec 场景「光标处拆段插入」+ Alex 裁决：光标落卡片下一行） ──

test("insertCardAtCaret：段落中间 → 拆两段、卡片居中、光标落卡片下一行段落段首", () => {
  const { blocks, caret } = insertCardAtCaret([para("这段是什么意思？")], { block: 0, offset: 2 }, cardA);
  assert.deepEqual(blocks, [para("这段"), quote(cardA), para("是什么意思？")]);
  assert.deepEqual(caret, { block: 2, offset: 0 });
});

test("insertCardAtCaret：段落起始 → 卡片在前、原段落承接光标（复用，不新建）", () => {
  const { blocks, caret } = insertCardAtCaret([para("问题一")], { block: 0, offset: 0 }, cardA);
  assert.deepEqual(blocks, [quote(cardA), para("问题一")]);
  assert.deepEqual(caret, { block: 1, offset: 0 });
});

test("insertCardAtCaret：段落末尾 → 卡片在后、新建空段落承接光标", () => {
  const { blocks, caret } = insertCardAtCaret([para("问题一")], { block: 0, offset: 4 }, cardA);
  assert.deepEqual(blocks, [para("问题一"), quote(cardA), para("")]);
  assert.deepEqual(caret, { block: 2, offset: 0 });
});

test("insertCardAtCaret：空段落 → 卡片在前、该空段落承接光标", () => {
  const { blocks, caret } = insertCardAtCaret([para("")], { block: 0, offset: 0 }, cardA);
  assert.deepEqual(blocks, [quote(cardA), para("")]);
  assert.deepEqual(caret, { block: 1, offset: 0 });
});

test("insertCardAtCaret：光标在卡片前缘 → 新卡片插在其前、其后补空段落", () => {
  const { blocks, caret } = insertCardAtCaret(
    [para("前"), quote(cardA), para("后")],
    { block: 1, offset: 0 },
    cardB,
  );
  assert.deepEqual(blocks, [para("前"), quote(cardB), para(""), quote(cardA), para("后")]);
  assert.deepEqual(caret, { block: 2, offset: 0 });
});

test("insertCardAtCaret：末尾追加（无块）→ 卡片 + 空段落", () => {
  const { blocks, caret } = insertCardAtCaret([], { block: 0, offset: 0 }, cardA);
  assert.deepEqual(blocks, [quote(cardA), para("")]);
  assert.deepEqual(caret, { block: 1, offset: 0 });
});

test("insertBlockAtCaret：图片卡片块与引用卡同语义（段中拆两段、卡片居中、光标落其后段落）", () => {
  const { blocks, caret } = insertBlockAtCaret(
    [para("前段文字后段")],
    { block: 0, offset: 2 },
    imageBlock,
  );
  assert.deepEqual(blocks, [para("前段"), imageBlock, para("文字后段")]);
  assert.deepEqual(caret, { block: 2, offset: 0 });
});

// ── 粘贴净化（quirk ①）：纯文本经模型插入，\n 拆段落 ─────────────────────────

test("insertPlainTextAtCaret：单行插入、光标落插入文本末尾", () => {
  const { blocks, caret } = insertPlainTextAtCaret([para("ab")], { block: 0, offset: 1 }, "XY");
  assert.deepEqual(blocks, [para("aXYb")]);
  assert.deepEqual(caret, { block: 0, offset: 3 });
});

test("insertPlainTextAtCaret：多行粘贴 → 拆成多个段落块（quirk ④ 的模型侧）", () => {
  const { blocks, caret } = insertPlainTextAtCaret([para("")], { block: 0, offset: 0 }, "一\n二\n三");
  assert.deepEqual(blocks, [para("一"), para("二"), para("三")]);
  assert.deepEqual(caret, { block: 2, offset: 1 });
});

test("insertPlainTextAtCaret：段落中间多行粘贴 → 首尾与残段正确拼接", () => {
  const { blocks, caret } = insertPlainTextAtCaret([para("abcd")], { block: 0, offset: 2 }, "X\nY");
  assert.deepEqual(blocks, [para("abX"), para("Ycd")]);
  assert.deepEqual(caret, { block: 1, offset: 1 });
});

test("insertPlainTextAtCaret：光标在卡片前缘 → 视该处为空段落，且**不吞卡**（M450 缺陷修复位）", () => {
  // 缺陷形态（design §3.3）：旧实现用 `blocks.slice(at + 1)` 跳过了 `blocks[at]`，
  // 把光标后面的那张卡片直接删掉——与函数自身注释（「视为在该处有一个空段落」）矛盾。
  const { blocks, caret } = insertPlainTextAtCaret([quote(cardA), para("后")], { block: 0, offset: 0 }, "问");
  assert.deepEqual(blocks, [para("问"), quote(cardA), para("后")]);
  assert.deepEqual(caret, { block: 0, offset: 1 });
});

test("insertPlainTextAtCaret：两张相邻卡片之间粘贴 → 文本落在新段落、两卡留在原位", () => {
  const { blocks, caret } = insertPlainTextAtCaret(
    [imageBlock, quote(cardA), para("后")],
    { block: 1, offset: 0 },
    "问",
  );
  assert.deepEqual(blocks, [imageBlock, para("问"), quote(cardA), para("后")]);
  assert.deepEqual(caret, { block: 1, offset: 1 });
});

test("insertPlainTextAtCaret：卡片前缘多行粘贴 → 逐行拆段、卡片次序不变", () => {
  const { blocks, caret } = insertPlainTextAtCaret(
    [imageBlock, quote(cardA)],
    { block: 1, offset: 0 },
    "一\n二",
  );
  assert.deepEqual(blocks, [imageBlock, para("一"), para("二"), quote(cardA)]);
  assert.deepEqual(caret, { block: 2, offset: 1 });
});

test("insertPlainTextAtCaret：composer 以卡片开头（block 0）→ 文本落在卡片之前，卡片不丢", () => {
  const { blocks, caret } = insertPlainTextAtCaret([quote(cardA)], { block: 0, offset: 0 }, "问");
  assert.deepEqual(blocks, [para("问"), quote(cardA)]);
  assert.deepEqual(caret, { block: 0, offset: 1 });
});

// ── 边界光标位（M450，change composer-intercard-caret design §3.1）────────────────
//
// 模型里「相邻两个原子块之间」= `{block: 后一块下标, offset: 0}`（卡片前缘）。这一组用例钉
// 两件事：① 哪一档光标算边界位（内容输入要走物化路径）；② DOM 写回 / 读回共用同一条规则
// ——`domCaretTarget` 与 `boundaryCaretAt` 互为逆运算（单测层是零 DOM，往返的同一性靠这
// 一对纯函数表达；真机侧的落位由验收场景 134 判）。

test("isCardFrontCaret：指向卡片且 offset 0 → 真；段落 / 卡片内偏移 / 越界 → 假", () => {
  const blocks = [imageBlock, quote(cardA), para("后")];
  assert.equal(isCardFrontCaret(blocks, { block: 0, offset: 0 }), true); // 相邻卡片之间
  assert.equal(isCardFrontCaret(blocks, { block: 1, offset: 0 }), true); // 卡片与段落之间
  assert.equal(isCardFrontCaret(blocks, { block: 2, offset: 0 }), false); // 段落前缘不是边界位
  assert.equal(isCardFrontCaret(blocks, { block: 0, offset: 1 }), false); // 卡片上无文本偏移
  assert.equal(isCardFrontCaret(blocks, { block: 9, offset: 0 }), false); // 越界没有「前缘」
});

test("边界光标位往返：写回的落点形态恒是同一个块级边界、读回得到同一个模型值（全枚举）", () => {
  const sequences: ComposerBlock[][] = [
    [imageBlock, quote(cardA)],
    [quote(cardA), imageBlock, para("后")],
    [para("前"), imageBlock, quote(cardA), para("后")],
    [imageBlock, quote(cardA), imageBlock],
  ];
  for (const blocks of sequences) {
    // 关键性质：边界位的读回归一不依赖块种类——「第 N 块前缘」只由 N 与块数决定。
    for (let n = 0; n <= blocks.length; n += 1) {
      const caret = boundaryCaretAt(n, blocks.length);
      assert.deepEqual(caret, { block: n, offset: 0 });
      const target = domCaretTarget(blocks, caret);
      assert.equal(target.index, n, `${JSON.stringify(blocks)} @${n}`); // 落点下标不漂
      const block = blocks[n];
      if (block === undefined || block.kind !== "paragraph") {
        assert.deepEqual(target, { kind: "boundary", index: n }, `${JSON.stringify(blocks)} @${n}`);
      }
    }
    // 反向：段落内的光标仍走文本偏移档（边界档没有把普通段落位吃掉）。
    for (let n = 0; n < blocks.length; n += 1) {
      const block = blocks[n];
      if (block.kind !== "paragraph") continue;
      assert.deepEqual(domCaretTarget(blocks, { block: n, offset: 1 }), { kind: "text", index: n, offset: 1 });
    }
    // 越界钳制：越前的下标钳到 0、越后的下标钳到块数（不产出越界块下标）。
    assert.deepEqual(boundaryCaretAt(-3, blocks.length), { block: 0, offset: 0 });
    assert.deepEqual(boundaryCaretAt(99, blocks.length), { block: blocks.length, offset: 0 });
  }
});

test("removeBlockAt 的兜底光标可指向卡片前缘（相邻卡片中删掉中间那张）", () => {
  // next = [cardA, cardC]，index = 1，前一块不是段落 ⇒ 走 `{block: min(index, len-1), offset: 0}`
  // 兜底（design §1 第 11 条）——这是「写回 DOM 再读回应当同一值」要护住的形态之一。
  const { blocks, caret } = removeBlockAt([quote(cardA), imageBlock, quote(cardB)], 1);
  assert.deepEqual(blocks, [quote(cardA), quote(cardB)]);
  assert.deepEqual(caret, { block: 1, offset: 0 });
  assert.equal(isCardFrontCaret(blocks, caret), true);
  assert.deepEqual(domCaretTarget(blocks, caret), { kind: "boundary", index: 1 });
  assert.deepEqual(boundaryCaretAt(caret.block, blocks.length), caret);
});

test("insertSoftBreakAtCaret：两张相邻卡片之间 → 在边界处落一个新空段落（HC1 的边界档）", () => {
  const { blocks, caret } = insertSoftBreakAtCaret([imageBlock, quote(cardA)], { block: 1, offset: 0 });
  assert.deepEqual(blocks, [imageBlock, para(""), quote(cardA)]);
  assert.deepEqual(caret, { block: 1, offset: 0 });
});

test("边界光标位的删除语义（读回修好后可达）：退格删前一张卡、前删删后一张卡、块首退格无操作", () => {
  const blocks = [imageBlock, quote(cardA), para("后")];
  assert.deepEqual(backspaceAtCaret(blocks, { block: 1, offset: 0 }), {
    blocks: [quote(cardA), para("后")],
    caret: { block: 0, offset: 0 },
  });
  assert.deepEqual(deleteForwardAtCaret(blocks, { block: 1, offset: 0 }), {
    blocks: [imageBlock, para("后")],
    caret: { block: 1, offset: 0 },
  });
  assert.equal(backspaceAtCaret(blocks, { block: 0, offset: 0 }), null);
});

// ── 软换行（⇧Enter）：不变量 HC1 / HC2（docs/specs/harness-composer.md）──────────────
//
// 缺陷现场（M419，Alex 2026-10-10）：「Harness composer 里按两次 SHIFT + Enter 才会换行」。
// 根因：段末的换行以往落成**尾随 \n**，而 CSS 里尾随换行不产生行盒（pre-wrap 下
// "ab\n" 与 "ab" 同高）——一次 ⇧Enter 因此零可见变化，第二次才把前一次的尾随换行挤成
// 内部换行。HC1 把「一次 ⇧Enter 恰好加一行、且光标落在可见行上」写死成不变量。

/**
 * 一个段落的**渲染行数**（渲染口径的纯函数复刻）：`pre-wrap` 下**尾随换行不产生行盒**
 * （"ab\n" 与 "ab" 同高，探针实测见 docs/specs/harness-composer.md §实测依据），空段落
 * 仍占 1 行（`min-height:1em`）。计数与 `visibleLines` / 光标可见性判据共用一份。
 */
function renderedLines(text: string): number {
  if (text === "") return 1;
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

/** 段落文本里第 `offset` 个字符之前有几个换行 = 光标落在第几行（0 基）。 */
function lineOfOffset(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length - 1;
}

/** 可见行数（HC1 的增量断言用）：卡片不占文本行，只数段落。 */
function visibleLines(blocks: readonly ComposerBlock[]): number {
  return blocks.reduce(
    (n, block) => n + (block.kind === "paragraph" ? renderedLines(block.text) : 0),
    0,
  );
}

/**
 * 光标是否落在**可见行**上（HC1 第二条判据）：所在块是段落，且光标的行号 < 该段落的渲染行数。
 *
 * 判据必须是**充要**形态、不能省成「段落文本不以 \n 结尾」：后者只是充分条件——段落文本
 * 可以以 \n 结尾（原生编辑残留的 `<br>` 经 `paraTextOf` 记为 `\n`、`normalize` 不剥除），
 * 此时「段落尾随 \n」与「光标落在最后一行的尾随换行之后」是两件事：`"\na\n"` 的光标在
 * offset 1（第二行行首）是**可见**的，而 `"a\n"` 的光标在 offset 2（尾随换行之后）不是。
 * 详见 docs/specs/harness-composer.md §证伪方式。
 */
function caretOnVisibleLine(blocks: readonly ComposerBlock[], caret: { block: number; offset: number }): boolean {
  const block = blocks[caret.block];
  if (block === undefined || block.kind !== "paragraph") return false;
  return lineOfOffset(block.text, caret.offset) < renderedLines(block.text);
}

test("insertSoftBreakAtCaret：段内插软换行、光标前进一格", () => {
  const { blocks, caret } = insertSoftBreakAtCaret([para("ab")], { block: 0, offset: 1 });
  assert.deepEqual(blocks, [para("a\nb")]);
  assert.deepEqual(caret, { block: 0, offset: 2 });
});

test("insertSoftBreakAtCaret：段末一次 ⇧Enter = 新空段落一块（不是不可见的尾随 \\n）", () => {
  // 缺陷回归位：旧实现给 [para("ab")] 段末插出 [para("ab\n")]——渲染上与 [para("ab")] 同高，
  // 用户看到的是「按了没反应」；新段落块 min-height:1em，一行真实落地。
  const { blocks, caret } = insertSoftBreakAtCaret([para("ab")], { block: 0, offset: 2 });
  assert.deepEqual(blocks, [para("ab"), para("")]);
  assert.deepEqual(caret, { block: 1, offset: 0 });
});

test("insertSoftBreakAtCaret：空段落上一按 = 光标落到第二行（首行留白）", () => {
  const { blocks, caret } = insertSoftBreakAtCaret([para("")], { block: 0, offset: 0 });
  assert.deepEqual(blocks, [para(""), para("")]);
  assert.deepEqual(caret, { block: 1, offset: 0 });
});

test("insertSoftBreakAtCaret：卡片前缘 → 光标所在处落一个新空段落（新行在卡片之上）", () => {
  const { blocks, caret } = insertSoftBreakAtCaret([para("前"), quote(cardA)], { block: 1, offset: 0 });
  assert.deepEqual(blocks, [para("前"), para(""), quote(cardA)]);
  assert.deepEqual(caret, { block: 1, offset: 0 });
});

test("insertSoftBreakAtCaret：composer 以卡片开头（无前段落）→ 照样加一行（不静默无操作）", () => {
  const { blocks, caret } = insertSoftBreakAtCaret([quote(cardA), para("后")], { block: 0, offset: 0 });
  assert.deepEqual(blocks, [para(""), quote(cardA), para("后")]);
  assert.deepEqual(caret, { block: 0, offset: 0 });
});

// ── 尾随换行段落（原生 <br> 残留形态，P2-1）：判据的充要形态 ────────────────────────────
//
// 模型里**可以**出现以 \n 结尾的段落：原生编辑路径（如删空一行后 WebKit 留下的 `<br>`）经
// `paraTextOf` 记为 \n、`normalize` 不剥除。它同时也是「光标在可见行上」判据的试金石——
// 「段落文本不以 \n 结尾」只是**充分**条件，对本形态会假红。

test("insertSoftBreakAtCaret：段落已以 \\n 结尾 → 仍恰好加一行，光标不停在尾随换行之后", () => {
  // 段首按（offset 0 < length）走段中分支：换行插在段首 ⇒ "\na\n"，光标落第二行行首（可见）。
  const head = insertSoftBreakAtCaret([para("a\n")], { block: 0, offset: 0 });
  assert.deepEqual(head.blocks, [para("\na\n")]);
  assert.deepEqual(head.caret, { block: 0, offset: 1 });
  assert.equal(renderedLines("\na\n"), 2);
  assert.equal(caretOnVisibleLine(head.blocks, head.caret), true);

  // 段末（光标本就在尾随换行之后）走段末分支：落新空段落块，光标离开那个没有行盒的位置。
  const tail = insertSoftBreakAtCaret([para("a\n")], { block: 0, offset: 2 });
  assert.deepEqual(tail.blocks, [para("a\n"), para("")]);
  assert.deepEqual(tail.caret, { block: 1, offset: 0 });
  assert.equal(caretOnVisibleLine(tail.blocks, tail.caret), true);
});

test("caretOnVisibleLine 判据的充要性：同一段「以 \\n 结尾」的文本里，行内光标与尾随换行之后的光标必须分开判", () => {
  // 反例一对：\n 之后的光标不可见（尾随换行不产生行盒），段内第二行行首的光标可见。
  assert.equal(caretOnVisibleLine([para("a\n")], { block: 0, offset: 2 }), false);
  assert.equal(caretOnVisibleLine([para("\na\n")], { block: 0, offset: 1 }), true);
  // 反例二对：卡片的「前缘」不是可见文本行；段落任何 < 渲染行号 的位置都在可见行上。
  assert.equal(caretOnVisibleLine([quote(cardA)], { block: 0, offset: 0 }), false);
  assert.equal(caretOnVisibleLine([para("")], { block: 0, offset: 0 }), true);
});

// ── HC1 的不变量（属性测试：输入维度 = 块序列 × 光标位置全枚举）────────────────────────
//
// 合同条款（docs/specs/harness-composer.md HC1）：「对任意块序列与任意光标位置，一次
// ⇧Enter 恰好增加一行可见行，且结束后光标落在可见行上」。逐案断言只能证明报告里的那个
// 案例被修好（docs/process/rendering-defect-contract-first.md §反例），这里扫全枚举。

/**
 * 生成器：段落文本分布（4 个长度/结构档 × 卡片在场形态）。文本档覆盖：
 * 空段落 · 单字 · 多字 · **已含内部换行**（粘贴 / 快照恢复带进来的 `\n`） · **以换行结尾**
 * （原生编辑路径可达：WebKit 删空一行后残留 `<br>`，`paraTextOf` 记为 `\n`、`normalize`
 * 不剥除）。末一档是 P2-1 补的——它会把「光标落在尾随换行之后」与「光标在可见行上」的
 * 区别暴露出来，见 `caretOnVisibleLine` 的判据说明。
 */
function blockSequences(): ComposerBlock[][] {
  const texts = ["", "a", "abc", "a\nb", "a\n"];
  const sequences: ComposerBlock[][] = [];
  for (const first of texts) {
    sequences.push([para(first)]);
    for (const second of texts) {
      sequences.push([para(first), para(second)]);
      sequences.push([para(first), quote(cardA), para(second)]);
      // 图片卡片（change harness-composer-image-paste）：与引用卡同族的「不占文本行」
      // 原子块——HC1 的可见行判据对两类卡片必须同口径成立。
      sequences.push([para(first), imageBlock, para(second)]);
    }
    sequences.push([quote(cardA), para(first)]);
    sequences.push([para(first), quote(cardA)]);
    sequences.push([imageBlock, para(first)]);
    sequences.push([para(first), imageBlock]);
    // 相邻卡片序列（M450，change composer-intercard-caret tasks 4.2）：两张卡之间没有段落是
    // **合法状态**（方案 A 的骨干），HC1 的「对任意块序列」承诺必须把它纳进来——旧生成器只
    // 有「卡片与段落交错」形态，边界光标位这一档因此从未被属性测试网住。
    sequences.push([quote(cardA), imageBlock]);
    sequences.push([imageBlock, quote(cardA)]);
    sequences.push([para(first), imageBlock, quote(cardA), para(first)]);
    sequences.push([quote(cardA), para(first), imageBlock]);
  }
  sequences.push([quote(cardA)]);
  sequences.push([imageBlock]);
  sequences.push([quote(cardA), imageBlock, quote(cardB)]);
  sequences.push([imageBlock, imageBlock]);
  return sequences;
}

test("HC1 属性：任意块序列 × 任意光标处，一次 ⇧Enter 恰好 +1 可见行且光标落可见行", () => {
  let cases = 0;
  for (const blocks of blockSequences()) {
    const offsetsOf = (index: number): number[] => {
      const block = blocks[index];
      if (block === undefined || block.kind !== "paragraph") return [0];
      return Array.from({ length: block.text.length + 1 }, (_, i) => i);
    };
    for (let index = 0; index < blocks.length; index += 1) {
      for (const offset of offsetsOf(index)) {
        const before = visibleLines(blocks);
        const result = insertSoftBreakAtCaret(blocks, { block: index, offset });
        cases += 1;
        const at = `${JSON.stringify(blocks)} @${index}:${offset}`;
        assert.equal(
          visibleLines(result.blocks),
          before + 1,
          `${at}：一次 ⇧Enter 必须恰好增加一行可见行（旧形态：段末尾随 \\n 不产生行盒）`,
        );
        assert.equal(
          caretOnVisibleLine(result.blocks, result.caret),
          true,
          `${at}：断行后光标必须落在可见行上，实际落在 ${JSON.stringify(result.caret)}`,
        );
      }
    }
  }
  assert.ok(cases >= 40, `枚举样本过少（${cases}），属性测试会空转`);
});

test("HC1 属性：断行不吞内容（除换行外逐字符守恒）", () => {
  const flatten = (blocks: readonly ComposerBlock[]): string =>
    blocks.map((b) => (b.kind === "paragraph" ? b.text : "")).join("");
  for (const blocks of blockSequences()) {
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const text = block !== undefined && block.kind === "paragraph" ? block.text : "";
      for (let offset = 0; offset <= text.length; offset += 1) {
        const result = insertSoftBreakAtCaret(blocks, { block: index, offset });
        assert.equal(
          flatten(result.blocks).replace(/\n/g, ""),
          flatten(blocks).replace(/\n/g, ""),
          `${JSON.stringify(blocks)} @${index}:${offset}：断行只应影响换行，不得增删其它字符`,
        );
      }
    }
  }
});

// ── HC2：断行 / 光标移动后的 composer 视口自动滚动（纯函数，DOM 只喂读数）─────────────
//
// 合同条款（docs/specs/harness-composer.md HC2）：「composer 视口必须把光标所在行纳入可见区，
// 不需要人工滑动」。composer 的 DOM 是重渲出来的（renderComposer → setDomCaret 用
// Range 程序化落光标），浏览器的「插入后把光标滚进视野」因此不生效——视口停在原处，
// 用户要手动往下滑。判据（该滚到哪）抽成纯函数，DOM 侧只负责量读数、写 scrollTop。

test("caretScrollTop：光标在可视区下方 → 滚到光标行贴底（留边距）", () => {
  const target = caretScrollTop(
    { scrollTop: 0, clientHeight: 100, scrollHeight: 400 },
    { top: 180, bottom: 200 },
  );
  assert.equal(target, 200 + 4 - 100); // 光标行下沿 + 边距 = 可视区底边
});

test("caretScrollTop：光标在可视区上方 → 滚到光标行贴上沿（留边距）", () => {
  const target = caretScrollTop(
    { scrollTop: 104, clientHeight: 100, scrollHeight: 400 },
    { top: 40, bottom: 60 },
  );
  assert.equal(target, 36);
});

test("caretScrollTop：光标已在可视区内 → 原值（不因重渲抖动视口）", () => {
  const view = { scrollTop: 100, clientHeight: 100, scrollHeight: 400 };
  assert.equal(caretScrollTop(view, { top: 120, bottom: 140 }), 100);
  // 边界有余量：光标行正好落在「下沿 - 边距」处不动，越过 1px 才滚。
  assert.equal(caretScrollTop(view, { top: 176, bottom: 196 }), 100);
  assert.equal(caretScrollTop(view, { top: 177, bottom: 197 }), 101);
});

test("caretScrollTop：内容不足一屏 → 0（无滚动空间，视口不动）", () => {
  assert.equal(caretScrollTop({ scrollTop: 0, clientHeight: 150, scrollHeight: 120 }, { top: 0, bottom: 20 }), 0);
});

test("caretScrollTop：结果钳在 [0, scrollHeight - clientHeight]（不产生越界滚动）", () => {
  const view = { scrollTop: 0, clientHeight: 100, scrollHeight: 400 };
  // 光标远在下方：贴底算式会超出最大滚动位，钳到 300。
  assert.equal(caretScrollTop(view, { top: 395, bottom: 420 }), 300);
  // 光标在内容原点：贴顶算式会产出负值，钳到 0。
  assert.equal(caretScrollTop({ ...view, scrollTop: 50 }, { top: 0, bottom: 10 }), 0);
});

test("caretScrollTop：边距可显式调小 / 归零（调用方按容器 padding 覆盖）", () => {
  const view = { scrollTop: 0, clientHeight: 100, scrollHeight: 400 };
  assert.equal(caretScrollTop(view, { top: 180, bottom: 200 }, 0), 100);
  assert.equal(caretScrollTop(view, { top: 180, bottom: 200 }, 20), 120);
});

// ── 选区删除（跨块安全：区间内卡片整块移除） ────────────────────────────────

test("deleteSelectionRange：同段内删字符", () => {
  const { blocks, caret } = deleteSelectionRange([para("abcdef")], {
    anchor: { block: 0, offset: 2 },
    focus: { block: 0, offset: 4 },
  });
  assert.deepEqual(blocks, [para("abef")]);
  assert.deepEqual(caret, { block: 0, offset: 2 });
});

test("deleteSelectionRange：跨块（含卡片）→ 卡片整块移除、两端截断保留", () => {
  const { blocks, caret } = deleteSelectionRange(
    [para("012345"), quote(cardA), para("abcdef")],
    { anchor: { block: 0, offset: 2 }, focus: { block: 2, offset: 3 } },
  );
  assert.deepEqual(blocks, [para("01"), para("def")]);
  assert.deepEqual(caret, { block: 0, offset: 2 });
});

test("deleteSelectionRange：反向选区（focus 在 anchor 前）按序归一", () => {
  const { blocks, caret } = deleteSelectionRange(
    [para("abcdef")],
    { anchor: { block: 0, offset: 4 }, focus: { block: 0, offset: 1 } },
  );
  // 与正向选区 1–4 等价：删掉 "bcd"，留下 "aef"。
  assert.deepEqual(blocks, [para("aef")]);
  assert.deepEqual(caret, { block: 0, offset: 1 });
});

// ── 退格 / 前删：卡片按整体作用（原子节点语义的模型侧） ──────────────────────

test("backspaceAtCaret：段内删字符（光标随字符退）", () => {
  const result = backspaceAtCaret([para("abc")], { block: 0, offset: 3 });
  assert.deepEqual(result, { blocks: [para("ab")], caret: { block: 0, offset: 2 } });
});

test("backspaceAtCaret：段首遇卡片 → 整块移除（第二次退格才删的「先选中」形态不接受）", () => {
  const result = backspaceAtCaret([quote(cardA), para("问题")], { block: 1, offset: 0 });
  assert.deepEqual(result, { blocks: [para("问题")], caret: { block: 0, offset: 0 } });
});

test("backspaceAtCaret：段首遇段落 → 合并、光标落接缝", () => {
  const result = backspaceAtCaret([para("前"), para("后")], { block: 1, offset: 0 });
  assert.deepEqual(result, { blocks: [para("前后")], caret: { block: 0, offset: 1 } });
});

test("backspaceAtCaret：composer 起点 → null（无物可删）", () => {
  assert.equal(backspaceAtCaret([para("")], { block: 0, offset: 0 }), null);
  assert.equal(backspaceAtCaret([para("a")], { block: 0, offset: 0 }), null);
});

test("deleteForwardAtCaret：段末遇卡片 → 整块移除", () => {
  const result = deleteForwardAtCaret([para("问题"), quote(cardA)], { block: 0, offset: 2 });
  assert.deepEqual(result, { blocks: [para("问题")], caret: { block: 0, offset: 2 } });
});

test("deleteForwardAtCaret：段末遇段落 → 合并", () => {
  const result = deleteForwardAtCaret([para("前"), para("后")], { block: 0, offset: 1 });
  assert.deepEqual(result, { blocks: [para("前后")], caret: { block: 0, offset: 1 } });
});

// ── 卡片移除（× 钮）：光标落被删块的前一个文本块末尾 ─────────────────────────

test("removeBlockAt：移除中间卡片、光标贴前段末尾", () => {
  const { blocks, caret } = removeBlockAt([para("前"), quote(cardA), para("后")], 1);
  assert.deepEqual(blocks, [para("前"), para("后")]);
  assert.deepEqual(caret, { block: 0, offset: 1 });
});

test("removeBlockAt：移除唯一块 → 落回一个空段落", () => {
  const { blocks, caret } = removeBlockAt([quote(cardA)], 0);
  assert.deepEqual(blocks, [para("")]);
  assert.deepEqual(caret, { block: 0, offset: 0 });
});

// ── 序列化消息的解析（transcript 快照恢复同构呈现的逆运算） ──────────────────

test("unescapeXmlEntities：链式转义按单次扫描正确收敛", () => {
  // 用户原文 "&lt;" 的序列化形态是 "&amp;lt;"——解码必须还原成 "&lt;" 而不是 "<"。
  assert.equal(unescapeXmlEntities("&amp;lt;"), "&lt;");
  assert.equal(unescapeXmlEntities("&lt;quote&gt;"), "<quote>");
  assert.equal(unescapeXmlEntities("&quot;&amp;&quot;"), `"&"`);
  // 未知实体原样保留（宽容，不吞字符）。
  assert.equal(unescapeXmlEntities("&nbsp;"), "&nbsp;");
});

test("parseQuoteMessage：与 serializeQuoteMessage 互逆（含转义与多行摘录）", () => {
  const source = [
    quote({ ...cardA, heading: '筛 & 选', text: "第一行\n第二行 <带标签>" }),
    para("这段是什么意思？"),
    quote(cardB),
    para("这里的「可执行动作」指什么？"),
  ];
  const text = serializeQuoteMessage(source);
  const parsed = parseQuoteMessage(text);
  // 协议四字段逐字节还原；headingPath 不在协议里（人侧专用），恢复值退化为 heading。
  assert.equal(parsed.length, 4);
  const first = parsed[0];
  assert.equal(first.kind, "quote");
  if (first.kind === "quote") {
    assert.equal(first.card.file, "reading-workflow.md");
    assert.equal(first.card.heading, "筛 & 选");
    assert.equal(first.card.lines, "9-10");
    assert.equal(first.card.text, "第一行\n第二行 <带标签>");
  }
  assert.deepEqual(parsed[1], para("这段是什么意思？"));
  const third = parsed[2];
  assert.equal(third.kind, "quote");
  if (third.kind === "quote") {
    // 协议四字段（file/heading/lines/text）逐字节还原；headingPath 不进协议，
    // 恢复值按设计退化为 heading（hover 的完整标题链只在当次会话的 composer 里）。
    assert.equal(third.card.file, cardB.file);
    assert.equal(third.card.heading, cardB.heading);
    assert.equal(third.card.lines, cardB.lines);
    assert.equal(third.card.text, cardB.text);
    assert.equal(third.card.headingPath, cardB.heading);
  }
  assert.deepEqual(parsed[3], para("这里的「可执行动作」指什么？"));
  // 往返稳定：再序列化一次逐字节不变。
  assert.equal(serializeQuoteMessage(parsed), text);
});

test("parseQuoteMessage：多行摘录（卡片原文含换行）正确聚合到闭合标签", () => {
  const text = [
    '<quote file="a.md" heading="" lines="1-3">一行',
    "二行",
    "三行</quote>",
    "问题",
  ].join("\n");
  const parsed = parseQuoteMessage(text);
  assert.equal(parsed.length, 2);
  const first = parsed[0];
  assert.equal(first.kind, "quote");
  if (first.kind === "quote") {
    assert.equal(first.card.heading, "");
    assert.equal(first.card.text, "一行\n二行\n三行");
  }
  assert.deepEqual(parsed[1], para("问题"));
});

test("parseQuoteMessage：不成形的引用行按段落宽容落地（不抛错、不吞内容）", () => {
  const original = '前文\n<quote file="a.md" heading="" lines="1">未闭合\n后文';
  const parsed = parseQuoteMessage(original);
  // 不抛错、内容守恒（逐块都是段落，拼回原文逐字节不变）；切分形状不做承诺（防御路径）。
  assert.equal(parsed.every((b) => b.kind === "paragraph"), true);
  assert.equal(
    parsed.map((b) => (b.kind === "paragraph" ? b.text : "")).join("\n"),
    original,
  );
});

// ── 撤销栈历史（quirk ③ 的正确性纪律；P2-1 复现链，假时钟驱动） ─────────────

test("撤销栈：聚簇合并连续编辑成一个撤销步", () => {
  let t = 1000;
  const history = createUndoHistory<string>({ now: () => t });
  history.push("", false); //  burst 起点：前态 ""
  t = 1300;
  history.push("", false); // 聚簇：跳过
  t = 1600;
  history.push("", false); // 聚簇：跳过
  assert.equal(history.size, 1);
  assert.equal(history.undo("abc"), "");
  assert.equal(history.size, 0);
});

test("撤销栈：快撤销快重打——undo 后 1s 内键入可撤销、旧 redo 立即作废（P2-1 复现链）", () => {
  let t = 1000;
  const history = createUndoHistory<string>({ now: () => t });
  // t=1.0 键入 "a"、t=1.3 键入 "b"（聚簇共用一个前态 ""）
  history.push("", false);
  t = 1300;
  history.push("", false);
  assert.equal(history.size, 1);
  // t=1.5 ⌘Z：弹回 ""，redo=["ab"]
  t = 1500;
  assert.equal(history.undo("ab"), "");
  assert.equal(history.redoSize, 1);
  // t=1.8 键入 "x"：撤销已重置簇计时 → 强制压前态 "ab"；且旧 redo 当场作废
  t = 1800;
  history.push("ab", false);
  assert.equal(history.redoSize, 0, "任何新编辑都必须作废旧 redo");
  assert.equal(history.size, 1);
  // 再 ⌘Z：弹回 "ab"——"x" 可撤销（旧行为：无物可弹，x 永久残留）
  assert.equal(history.undo("abx"), "ab");
  // ⌘⇧Z：redo 回 "abx"（redo 栈里是同步的新链，不是过期态）
  assert.equal(history.redo("ab"), "abx");
});

test("撤销栈：force 跳过聚簇、栈顶同态去重不产生幽灵步", () => {
  let t = 1000;
  const history = createUndoHistory<string>({ now: () => t });
  history.push("a", true);
  t = 1100;
  history.push("a", true); // 同态强制压入前仍去重（no-op 操作）
  assert.equal(history.size, 1);
  t = 1100;
  history.push("b", true); // 不同态：即使同刻也独立成步
  assert.equal(history.size, 2);
});

test("撤销栈：breakCluster 让下一拍聚簇失效（IME 组合整段一步）；clear 全清", () => {
  let t = 1000;
  const history = createUndoHistory<string>({ now: () => t });
  history.push("", false);
  history.breakCluster();
  t = 1100;
  history.push("a", false); // 无 breakCluster 时 100ms 会聚簇跳过
  assert.equal(history.size, 2);
  history.clear();
  assert.equal(history.size, 0);
  assert.equal(history.redoSize, 0);
  assert.equal(history.undo("x"), null);
  assert.equal(history.redo("x"), null);
});

// ── 图片卡片元信息行的恢复路径宽高补记（M449）──────────────────────────────
//
// 恢复路径（快照从 wire 引用重建，ImageCard.width/height 可选）的图片卡片首帧无尺寸、元信息行
// 只显文件名；缩略图 <img> load 后读 naturalWidth/naturalHeight 补记。DOM 侧接线归真机验收
// （scripts/acceptance），这一层覆盖两条纯判据——文案格式 `imageCardMetaText` 与「哪个读数算
// 有效尺寸」`imageDimensionsFromNatural`（createImageCardEl 的首帧渲染与 load 回调共用这两条）。

test("imageCardMetaText：有宽高显「文件名 · W×H」、无宽高只显文件名", () => {
  assert.equal(imageCardMetaText("a.webp", 640, 360), "a.webp · 640×360");
  assert.equal(imageCardMetaText("a.webp", undefined, undefined), "a.webp");
  // 半缺（只在数据被改坏时可达）按无尺寸处理，不产出「a.webp · 640×undefined」。
  assert.equal(imageCardMetaText("a.webp", 640, undefined), "a.webp");
  assert.equal(imageCardMetaText("a.webp", undefined, 360), "a.webp");
});

test("恢复卡片无宽高 → <img> load 报出有效自然尺寸 → 元信息行出现宽高", () => {
  const name = "pasted-0123456789abcdef.webp";
  // 恢复态首帧：卡片无尺寸，只显文件名
  assert.equal(imageCardMetaText(name, undefined, undefined), name);
  // load 回调读到自然尺寸 → 补记
  const dims = imageDimensionsFromNatural(1024, 768);
  assert.deepEqual(dims, { width: 1024, height: 768 });
  assert.equal(imageCardMetaText(name, dims?.width, dims?.height), `${name} · 1024×768`);
});

test("加载失败 / 未就绪 → 尺寸判据返回 null，元信息行保持只显文件名（不出 0/NaN/undefined）", () => {
  const name = "pasted-0123456789abcdef.webp";
  const invalid: ReadonlyArray<readonly [number, number]> = [
    [0, 0], // 加载失败：naturalWidth/Height 全 0
    [0, 600], // 半读数
    [800, 0],
    [Number.NaN, Number.NaN], // 未就绪
    [Number.POSITIVE_INFINITY, 600],
    [-5, 10], // 非法负值
  ];
  for (const [w, h] of invalid) {
    const dims = imageDimensionsFromNatural(w, h);
    assert.equal(dims, null, `natural ${w}×${h} 不应算作有效尺寸`);
    const meta = imageCardMetaText(name, dims?.width, dims?.height);
    assert.equal(meta, name);
    assert.equal(
      /NaN|undefined|Infinity|·/.test(meta),
      false,
      `无效读数不得落进元信息行，实际 ${meta}`,
    );
  }
});
