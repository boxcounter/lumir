// 草稿格式的单测（change composer-draft-persistence，tasks 2.1–2.3）：块模型 ⟺ 草稿 JSON 的
// 无损往返（含引用卡片 / 图片卡片 / 未知块类 / 光标落位）、零编号、**不内联 base64**、
// 坏文件 / 空文件 / 版本不符的安静回落。
//
// 之所以在**本层**判「无损」而不是在真机上判：面板渲染 + 读回只能证明「还原后的块能被正确
// 渲染」，证明不了「还原后的块与保存前逐字段相同」——字段少了一个（比如 headingPath）在界面上
// 看不出来（它只喂 hover title），而下次落盘就把它永久丢了。判据因此落在数据层：往返后与原
// 块序列**深度相等**（REVIEW.md 「断言等价于子串」条：断言必须有区分度）。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DRAFT_VERSION,
  draftUnknownBlockText,
  parseComposerDraft,
  serializeComposerDraft,
  type ComposerBlock,
} from "../../src/quote-card.ts";

/** 一份覆盖四类已知块 + 一个未知块的块序列（含 `headingPath` 与图片尺寸两个易丢字段）。 */
function sampleBlocks(): ComposerBlock[] {
  return [
    { kind: "paragraph", text: "帮我看下这段" },
    {
      kind: "quote",
      card: {
        file: "notes/a.md",
        heading: "标题",
        headingPath: "父 › 标题",
        lines: "3-5",
        text: "摘录原文",
      },
    },
    {
      kind: "msgquote",
      card: { role: "assistant", at: 1_760_000_000_000, text: "消息摘录" },
    },
    { kind: "msgquote", card: { role: "user", at: null, text: "无上屏戳的旧消息" } },
    { kind: "image", card: { name: "pasted-0123456789abcdef.webp", sourceMime: "image/png", width: 800, height: 600 } },
    { kind: "image", card: { name: "pasted-fedcba9876543210.jpg", sourceMime: "image/jpeg" } },
    { kind: "paragraph", text: "" },
  ];
}

test("往返无损：块序 / 块类 / 卡片字段（含 headingPath、图片尺寸）/ 光标逐字段一致", () => {
  const blocks = sampleBlocks();
  const caret = { block: 5, offset: 0 };
  const text = serializeComposerDraft(blocks, caret);
  const parsed = parseComposerDraft(text);
  assert.notEqual(parsed, null);
  assert.deepEqual(parsed?.blocks, blocks, "往返后与原块序列深度相等（任何字段丢失都判红）");
  assert.deepEqual(parsed?.caret, caret);
  assert.equal(parsed?.version, DRAFT_VERSION);
  // 二次往返稳定（序列化是规范形态，不带时间戳 / 随机量）
  assert.equal(serializeComposerDraft(parsed?.blocks ?? [], parsed?.caret ?? null), text);
});

test("未知块类保守保留：原样往返，兜底文本非空（不静默丢内容）", () => {
  const unknown = { kind: "future-block", payload: { deep: [1, 2, 3] } } as unknown as ComposerBlock;
  const blocks: ComposerBlock[] = [{ kind: "paragraph", text: "before" }, unknown];
  const parsed = parseComposerDraft(serializeComposerDraft(blocks, null));
  assert.notEqual(parsed, null);
  assert.deepEqual(parsed?.blocks, blocks, "未知块逐字段原样保留");
  assert.notEqual(draftUnknownBlockText(unknown), "", "渲染兜底不留空（空串 = 静默丢文）");
  assert.equal(draftUnknownBlockText(unknown), JSON.stringify(unknown));
});

test("零编号：每个块的键集合精确有界，不含 index / id / 序号类属性", () => {
  const parsed = parseComposerDraft(serializeComposerDraft(sampleBlocks(), null));
  assert.notEqual(parsed, null);
  const allowed = new Set(["kind", "card", "file", "heading", "headingPath", "lines", "text", "role", "at", "name", "sourceMime", "width", "height"]);
  const blockKeySets: Array<[string[], string]> = [];
  for (const block of parsed?.blocks ?? []) {
    // 顶层：段落是 kind + text，其余是 kind + card
    const blockKeys = Object.keys(block).sort();
    blockKeys.forEach((key) => assert.equal(allowed.has(key), true, `块顶层出现未声明键：${key}`));
    const expectedBlockKeys: string[] = block.kind === "paragraph" ? ["kind", "text"] : ["card", "kind"];
    assert.deepEqual(blockKeys, expectedBlockKeys);
    if (block.kind === "paragraph") continue;
    const cardKeys = Object.keys(block.card).sort();
    cardKeys.forEach((key) => assert.equal(allowed.has(key), true, `卡片出现未声明键：${key}`));
    blockKeySets.push([cardKeys, block.kind]);
  }
  // 逐类精确键集合（任何多出来的键都会红，比 `!includes("index")` 强——不依赖它恰好叫 index）
  assert.deepEqual(blockKeySets, [
    [["file", "heading", "headingPath", "lines", "text"], "quote"],
    [["at", "role", "text"], "msgquote"],
    [["at", "role", "text"], "msgquote"],
    [["height", "name", "sourceMime", "width"], "image"],
    [["name", "sourceMime"], "image"],
  ]);
});

test("图片只存内容寻址引用：草稿原文不含 data:image / base64 字面量", () => {
  const text = serializeComposerDraft(sampleBlocks(), null);
  assert.equal(text.includes("data:image"), false, "MUST NOT 内联 data URL");
  assert.equal(/base64/i.test(text), false, "MUST NOT 内联 base64");
  assert.equal(text.includes("pasted-0123456789abcdef.webp"), true, "存的是引用名");
});

test("坏文件 / 空文件 / 版本不符 / 结构不符 → null（安静回落，不抛错）", () => {
  for (const bad of [
    "",
    "   ",
    "{not json",
    "[]",
    "null",
    '"text"',
    "{}",
    '{"blocks":[]}',
    '{"version":99,"blocks":[]}',
    '{"version":1}',
    '{"version":1,"blocks":{}}',
    '{"version":1,"blocks":[1]}',
    '{"version":1,"blocks":[{}]}',
    '{"version":1,"blocks":[{"kind":"paragraph"}]}',
    '{"version":1,"blocks":[{"kind":"paragraph","text":42}]}',
    // 已知块类不成形：整份草稿按损坏处理（半份草稿会让发送路径上的投影函数抛错）
    '{"version":1,"blocks":[{"kind":"quote","card":{"file":"a","heading":"h","lines":"","text":"t"}}]}',
    '{"version":1,"blocks":[{"kind":"msgquote","card":{"role":"system","at":null,"text":"x"}}]}',
    '{"version":1,"blocks":[{"kind":"image","card":{"name":"","sourceMime":"image/png"}}]}',
  ]) {
    assert.equal(parseComposerDraft(bad), null, JSON.stringify(bad));
  }
});

test("可选字段的宽容读法：headingPath 缺席回落 heading、图片尺寸半对即整对不还原", () => {
  const noPath =
    '{"version":1,"blocks":[{"kind":"quote","card":{"file":"a.md","heading":"H","lines":"1-2","text":"t"}}]}';
  const parsed = parseComposerDraft(noPath);
  assert.deepEqual(parsed?.blocks, [
    { kind: "quote", card: { file: "a.md", heading: "H", headingPath: "H", lines: "1-2", text: "t" } },
  ]);

  const halfDims =
    '{"version":1,"blocks":[{"kind":"image","card":{"name":"pasted-0123456789abcdef.webp","sourceMime":"image/png","width":800}}]}';
  assert.deepEqual(parseComposerDraft(halfDims)?.blocks, [
    { kind: "image", card: { name: "pasted-0123456789abcdef.webp", sourceMime: "image/png" } },
  ]);

  // msgquote 的 at 缺席与显式 null 同义
  const noAt = '{"version":1,"blocks":[{"kind":"msgquote","card":{"role":"user","text":"x"}}]}';
  assert.deepEqual(parseComposerDraft(noAt)?.blocks, [
    { kind: "msgquote", card: { role: "user", at: null, text: "x" } },
  ]);
});

test("光标落位：合法保留，越界 / 非整数 / 缺席 → null", () => {
  const blocks = sampleBlocks();
  const caret = parseComposerDraft(serializeComposerDraft(blocks, { block: 2, offset: 3 }))?.caret;
  assert.deepEqual(caret, { block: 2, offset: 3 });

  for (const bad of [
    '{"version":1,"blocks":[{"kind":"paragraph","text":"x"}],"caret":{"block":5,"offset":0}}',
    '{"version":1,"blocks":[{"kind":"paragraph","text":"x"}],"caret":{"block":-1,"offset":0}}',
    '{"version":1,"blocks":[{"kind":"paragraph","text":"x"}],"caret":{"block":0,"offset":-1}}',
    '{"version":1,"blocks":[{"kind":"paragraph","text":"x"}],"caret":{"block":0.5,"offset":0}}',
    '{"version":1,"blocks":[{"kind":"paragraph","text":"x"}],"caret":"end"}',
  ]) {
    assert.equal(parseComposerDraft(bad)?.caret, null, bad);
  }
  // 缺席 = 「光标在末尾」，由调用方兜
  assert.equal(parseComposerDraft('{"version":1,"blocks":[{"kind":"paragraph","text":"x"}]}')?.caret, null);
});

test("空块序列解析为空数组（= 空输入区；与 null 在面板侧同处置）", () => {
  assert.deepEqual(parseComposerDraft(serializeComposerDraft([], null))?.blocks, []);
});
