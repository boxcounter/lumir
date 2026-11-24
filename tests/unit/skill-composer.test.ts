import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyComposerTransaction,
  composerContentOf,
  composerRedo,
  composerSkillsJson,
  composerUndo,
  createComposerState,
  mergeRejectedComposerContent,
  selectComposerSkill,
} from "../../src/harness-composer.ts";
import {
  DRAFT_VERSION,
  parseComposerDraft,
  readComposerDraft,
  serializeComposerDraft,
} from "../../src/quote-card.ts";

const selected = () => createComposerState({ text: "/acc", caret: 4, cards: [], skills: [] });

test("多个逆序 refs 按位置排序，同名只取首个", () => {
  const state = createComposerState({
    text: "/beta /alpha /beta",
    caret: 18,
    cards: [],
    skills: [
      { name: "alpha", from: 6 },
      { name: "beta", from: 13 },
      { name: "beta", from: 0 },
    ],
  });
  assert.equal(composerSkillsJson(state), '["beta","alpha"]');
});

test("手打同形文本不产生 ref", () => {
  let state = selected();
  state = applyComposerTransaction(state, selectComposerSkill(state, { name: "acc-skill-abc", from: 0, to: 4 }));
  state = applyComposerTransaction(state, {
    changes: { from: state.doc.length, insert: " /acc-skill-abc" },
    selection: { anchor: state.doc.length + 15 },
    userEvent: "input.type",
  });
  assert.deepEqual(composerContentOf(state).skills, [{ name: "acc-skill-abc", from: 0 }]);
  assert.equal(composerSkillsJson(state), '["acc-skill-abc"]');
});

test("编辑切片、左边界或程序化替换使 ref 失效；undo/redo 与文本同步", () => {
  let state = applyComposerTransaction(selected(), selectComposerSkill(selected(), { name: "acc-skill-abc", from: 0, to: 4 }));
  assert.equal(composerContentOf(state).skills.length, 1);
  state = composerUndo(state);
  assert.equal(state.doc.toString(), "/acc");
  assert.deepEqual(composerContentOf(state).skills, []);
  state = composerRedo(state);
  assert.equal(state.doc.toString(), "/acc-skill-abc ");
  assert.equal(composerContentOf(state).skills.length, 1);
  state = applyComposerTransaction(state, { changes: { from: 4, to: 5 }, userEvent: "delete.backward" });
  assert.deepEqual(composerContentOf(state).skills, []);
});

test("发送拒绝合并保留 restored refs 并偏移 current refs，随后重新校验", () => {
  const restored = { text: "/alpha ", caret: 7, cards: [], skills: [{ name: "alpha", from: 0 }] };
  const current = { text: "/beta ", caret: 6, cards: [], skills: [{ name: "beta", from: 0 }] };
  const merged = mergeRejectedComposerContent(restored, current);
  assert.deepEqual(merged.skills, [{ name: "alpha", from: 0 }, { name: "beta", from: 7 }]);
  const invalid = mergeRejectedComposerContent(restored, { text: "x/beta ", caret: 7, cards: [], skills: [{ name: "beta", from: 1 }] });
  assert.deepEqual(invalid.skills, [{ name: "alpha", from: 0 }]);
});

test("草稿 v3 往返 refs；v1/v2 一次性归一，脏 ref 不影响其他内容", () => {
  const skills = [{ name: "acc-skill-abc", from: 0, to: 14 }];
  const raw = serializeComposerDraft("/acc-skill-abc 问题", 15, [], skills);
  assert.equal(DRAFT_VERSION, 3);
  assert.deepEqual(parseComposerDraft(raw), {
    version: 3,
    text: "/acc-skill-abc 问题",
    caret: 15,
    cards: [],
    skills,
  });
  const v2 = readComposerDraft('{"version":2,"text":"旧草稿","caret":2,"cards":[]}');
  assert.equal(v2?.migrated, true);
  assert.deepEqual(v2?.draft, { version: 3, text: "旧草稿", caret: 2, cards: [], skills: [] });
  const dirty = parseComposerDraft(JSON.stringify({ version: 3, text: "/ok x/bad", caret: 8, cards: [], skills: [
    { name: "ok", from: 0, to: 3 },
    { name: "bad", from: 5, to: 9 },
    { name: "bad grammar", from: 0, to: 3 },
  ] }));
  assert.deepEqual(dirty?.skills, [{ name: "ok", from: 0, to: 3 }]);
  assert.equal(raw.includes("user_invocable"), false);
  assert.equal(raw.includes("model_invocable"), false);
});


test("CRLF 共同出口用同一映射保留 refs、caret 与卡片 at", () => {
  const parsed = readComposerDraft(JSON.stringify({
    version: 3,
    text: "A\r\n/acc-skill-abc ",
    caret: 18,
    cards: [{
      card: { kind: "quote", card: { file: "synthetic.md", heading: "", headingPath: "", lines: "1-1", text: "合成" } },
      at: 18,
    }],
    skills: [{ name: "acc-skill-abc", from: 3, to: 17 }],
  }));
  assert.equal(parsed?.changed, true);
  assert.deepEqual(parsed?.draft, {
    version: 3,
    text: "A\n/acc-skill-abc ",
    caret: 17,
    cards: [{
      card: { kind: "quote", card: { file: "synthetic.md", heading: "", headingPath: "", lines: "1-1", text: "合成" } },
      at: 17,
    }],
    skills: [{ name: "acc-skill-abc", from: 2, to: 16 }],
  });
  const state = createComposerState(parsed!.draft);
  assert.deepEqual(composerContentOf(state).skills, [{ name: "acc-skill-abc", from: 2 }]);
  assert.deepEqual(composerContentOf(state).cards.map((card) => card.anchor), [17]);
  assert.equal(composerSkillsJson(state), '["acc-skill-abc"]');
});
