// 跨 pane 移动标签的状态迁移回归（M317 tasks 4.1，tower 裁决采 (a)，2026-10-03）。
//
// 为什么这一层测「机制」而不是直接测 editor.ts：`createEditor` 需要真 DOM 与 EditorView，
// 且 editor.ts 的模块图里有 TypeScript 参数属性（src/preview/livePreview.ts / math.ts），
// Node 的类型剥离吃不下——editor.ts 在本层**不可 import**（与 src/preview/* 的单测处境同源）。
// 因此本用例分两段：
//   A. 用真 `EditorState` + `Compartment` 复现「共享 compartment ⇒ 迁移来的 state 仍可重配、
//      撤销史随迁」，并给出反向断言（换一个 compartment 实例时重配被静默丢弃——逐实例
//      compartment 的病），这条是 4.1 依赖的 CodeMirror 机制的直接判据；
//   B. 读 `src/editor.ts` 源文本，钉住三处 Compartment 是**模块级声明**、`adoptSession` 不再
//      重建 state——把实现改回逐实例 / 重建时本用例立刻变红（反向断言）。
// 源文本断言有仓内先例（tests/unit/registry-drift.test.ts 读 Rust 源对账）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Compartment, EditorState } from "@codemirror/state";
import { history, undo, undoDepth } from "@codemirror/commands";

test("共享 compartment：迁移来的 state 仍可被目标实例重配，撤销史随迁", () => {
  // 与 editor.ts 同构的一份 compartment（M317 后 mode/折行/md gutter 三处都是模块级共享单例）。
  const tabSize = new Compartment();
  // 实例 A 造会话 state：一条历史 + A 的 compartment 内容。
  let migrated = EditorState.create({
    doc: "a",
    extensions: [history(), tabSize.of(EditorState.tabSize.of(2))],
  });
  // 一次真实编辑，制造可撤销的历史。
  migrated = migrated.update({ changes: { from: 1, insert: "b" } }).state;
  assert.equal(migrated.doc.toString(), "ab");
  assert.equal(undoDepth(migrated), 1, "迁移前有一条可撤销的历史");

  // 迁移到实例 B：B 经**同一个** compartment 实例重配（共享单例）。
  migrated = migrated.update({ effects: tabSize.reconfigure(EditorState.tabSize.of(8)) }).state;
  assert.equal(migrated.facet(EditorState.tabSize), 8, "目标实例的重配对迁移来的 state 生效");

  // 撤销史随 state 整体迁移、仍可撤销回编辑前。
  let current = migrated;
  const ok = undo({
    state: current,
    dispatch: (tr) => {
      current = tr.state;
    },
  });
  assert.equal(ok, true, "撤销命令在迁移后的 state 上仍可用");
  assert.equal(current.doc.toString(), "a", "撤销回到迁移前的编辑内容");
});

test("共享 compartment 的重配只作用于被施加的 state（pane 间互不串）", () => {
  // 「只作用于该 pane」的判据：两个 state 引用同一个 compartment 实例、各带各的内容，
  // 对其中一个施加 reconfigure 不改另一个。
  const tabSize = new Compartment();
  const paneA = EditorState.create({ extensions: [tabSize.of(EditorState.tabSize.of(2))] });
  const paneB = EditorState.create({ extensions: [tabSize.of(EditorState.tabSize.of(4))] });
  const paneAAfter = paneA.update({ effects: tabSize.reconfigure(EditorState.tabSize.of(8)) }).state;
  assert.equal(paneAAfter.facet(EditorState.tabSize), 8, "被施加的 state 生效");
  assert.equal(paneB.facet(EditorState.tabSize), 4, "另一个 state 的配置不被波及");
});

test("反向断言：换一个 compartment 实例时，重配对迁移来的 state 被静默丢弃", () => {
  // 这正是「逐实例 compartment」的病：目标实例拿自己的 compartment 去重配迁移来的 state，
  // CodeMirror 在 config 树里找不到该实例，效果被静默丢弃（不抛错），表现为「移动过去的
  // 标签切不动折行 / 换不了模式」。本用例钉住这条反向事实，作为共享单例必要性的判据。
  const source = new Compartment();
  const foreign = new Compartment();
  const state = EditorState.create({
    doc: "x",
    extensions: [source.of(EditorState.tabSize.of(2))],
  });
  const after = state.update({ effects: foreign.reconfigure(EditorState.tabSize.of(8)) }).state;
  assert.equal(after.facet(EditorState.tabSize), 2, "外来 compartment 的重配不生效（静默丢弃）");
});

test("实现守卫：三处 Compartment 是模块级声明，adoptSession 不重建 state", () => {
  const source = readFileSync(new URL("../../src/editor.ts", import.meta.url), "utf8");

  // 1. 三个 compartment 必须**模块级**声明（行首、无缩进）——回退到 createEditor 体内即红。
  for (const name of ["modeCompartment", "wrapCompartment", "mdGutterCompartment"]) {
    assert.match(
      source,
      new RegExp(`^const ${name} = new Compartment\\(\\);$`, "m"),
      `${name} 必须是模块级声明（供跨实例状态迁移共享）`,
    );
  }
  // 2. createEditor 体内 MUST NOT 出现缩进的 `new Compartment()`（逐实例形态）。
  assert.ok(
    !/^ {2}const \w+Compartment = new Compartment\(\);/m.test(source),
    "createEditor 体内不得再逐实例创建 Compartment（M317 4.1 已提为模块级共享）",
  );
  // 3. adoptSession 的方法体里 MUST NOT 调 sessionState（重建 state 的旧实现）。
  const adopt = /adoptSession\(session: EditorSession\) \{\n([\s\S]*?)\n    \},/.exec(source);
  assert.ok(adopt !== null, "找不到 adoptSession 的实现体");
  assert.ok(!/sessionState\(/.test(adopt[1]), "adoptSession 不得重建 state（会清空撤销史）");
});
