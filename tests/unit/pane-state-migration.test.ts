// 跨 pane 移动标签的状态迁移回归（M317 tasks 4.1，tower 裁决采 (a)，2026-10-03；r1 评审
// P1-1 后补入「基础层换绑」的两实例断言）。
//
// 为什么这一层测「机制」而不是直接测 editor.ts：`createEditor` 需要真 DOM 与 EditorView，
// 且 editor.ts 的模块图里有 TypeScript 参数属性（src/preview/livePreview.ts / math.ts），
// Node 的类型剥离吃不下——editor.ts 在本层**不可 import**（与 src/preview/* 的单测处境同源）。
// 因此本用例分三层：
//   A. 用真 `EditorState` + `Compartment` 复现「共享 compartment ⇒ 迁移来的 state 仍可重配、撤销史随迁」
//      与「重配只作用于被施加的 state」，含反向断言（换一个 compartment 实例时重配被静默丢弃）；
//   B. 两实例替身（DOM-free）：复刻 `sessionState` 的基础层写法（changeFilter 读实例级投影 +
//      「视图 dispatch 时运行 state 配置里的闭包」），钉住 P1-1——迁移会话在目标实例被编辑时，
//      **换绑后**回写 / 过滤 / dirty 落目标实例、不污染源实例；并给出「不换绑即复现 P1-1 后果」
//      的反向断言；
//   C. 读 `src/editor.ts` 源文本，钉住四处 Compartment 是**模块级声明**、`sessionState` 把基础层
//      收进 `baseCompartment`、`adoptSession` 调 `rebindEffects` 换绑——把实现改回逐实例 / 不换绑
//      时本用例立刻变红（反向断言）。源文本断言有仓内先例（tests/unit/registry-drift.test.ts）。
//
// B 段用 `Facet` 承载「绑实例的闭包」并在 dispatch 时手工调用它：真实 `EditorView.updateListener`
// 由视图在 dispatch 时运行，且运行的是**该 state 配置里**那一个闭包——facet 值同样由 state 的
// config（compartment 内容）决定，因此「绑哪个实例」的判据与真实 updateListener 同源。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Compartment, EditorState, Facet } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { history, undo, undoDepth } from "@codemirror/commands";

// ---------------------------------------------------------------------------
// A. CodeMirror 机制层
// ---------------------------------------------------------------------------

test("共享 compartment：迁移来的 state 仍可被目标实例重配，撤销史随迁", () => {
  const tabSize = new Compartment();
  let migrated = EditorState.create({
    doc: "a",
    extensions: [history(), tabSize.of(EditorState.tabSize.of(2))],
  });
  migrated = migrated.update({ changes: { from: 1, insert: "b" } }).state;
  assert.equal(migrated.doc.toString(), "ab");
  assert.equal(undoDepth(migrated), 1, "迁移前有一条可撤销的历史");

  migrated = migrated.update({ effects: tabSize.reconfigure(EditorState.tabSize.of(8)) }).state;
  assert.equal(migrated.facet(EditorState.tabSize), 8, "目标实例的重配对迁移来的 state 生效");
  assert.equal(undoDepth(migrated), 1, "重配不丢撤销史");

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
  const tabSize = new Compartment();
  const paneA = EditorState.create({ extensions: [tabSize.of(EditorState.tabSize.of(2))] });
  const paneB = EditorState.create({ extensions: [tabSize.of(EditorState.tabSize.of(4))] });
  const paneAAfter = paneA.update({ effects: tabSize.reconfigure(EditorState.tabSize.of(8)) }).state;
  assert.equal(paneAAfter.facet(EditorState.tabSize), 8, "被施加的 state 生效");
  assert.equal(paneB.facet(EditorState.tabSize), 4, "另一个 state 的配置不被波及");
});

test("反向断言：换一个 compartment 实例时，重配对迁移来的 state 被静默丢弃", () => {
  // 这正是「逐实例 compartment」的病：目标实例拿自己的 compartment 去重配迁移来的 state，
  // CodeMirror 在 config 树里找不到该实例，效果被静默丢弃（不抛错）。
  const source = new Compartment();
  const foreign = new Compartment();
  const state = EditorState.create({
    doc: "x",
    extensions: [source.of(EditorState.tabSize.of(2))],
  });
  const after = state.update({ effects: foreign.reconfigure(EditorState.tabSize.of(8)) }).state;
  assert.equal(after.facet(EditorState.tabSize), 2, "外来 compartment 的重配不生效（静默丢弃）");
});

// ---------------------------------------------------------------------------
// B. 两实例替身：基础层换绑（P1-1）
// ---------------------------------------------------------------------------

/** 与 editor.ts 同构的模块级共享 base compartment（基础层闭包也要能换绑）。 */
const baseCompartment = new Compartment();

/** 基础层里「绑实例闭包」的载荷（复刻 updateListener 的副作用）：dispatch 时由视图运行，
 *  运行的是**该 state 配置里**那一个闭包——绑哪个实例由 compartment 内容决定，正是 P1-1 的判据。 */
type Rebinder = (tr: { state: EditorState; docChanged: boolean }) => void;
const rebindFacet = Facet.define<Rebinder>();

interface FakeSession {
  state: EditorState;
  dirty: boolean;
  cleanDoc: string;
}

/** 一个「编辑器实例」的最小替身（DOM-free）：复刻 editor.ts `sessionState` 的基础层写法——
 *  changeFilter 读**实例级**投影、绑实例闭包（回写 / dirty / 事件计数）收进 baseCompartment。 */
function makeInstance() {
  const projection = { editable: true };
  let active: FakeSession | null = null;
  const dirtyEvents: number[] = [];

  function baseExtensions(): Extension[] {
    return [
      EditorState.changeFilter.of((tr) => (tr.docChanged && !projection.editable ? false : true)),
      rebindFacet.of((tr) => {
        // 复刻 updateListener：active.state 回写 + dirty 判定 + 事件广播（这里只数 dirty 事件）。
        if (active === null) return;
        active.state = tr.state;
        if (tr.docChanged) {
          active.dirty = tr.state.doc.toString() !== active.cleanDoc;
          dirtyEvents.push(1);
        }
      }),
    ];
  }

  return {
    projection,
    dirtyEvents,
    sessionState(doc: string): EditorState {
      return EditorState.create({ doc, extensions: [history(), baseCompartment.of(baseExtensions())] });
    },
    /** 迁移会话：整体迁入 + 用**本实例**的闭包换绑基础层（复刻 editor.ts 的 adoptSession）。 */
    adopt(session: FakeSession): void {
      session.state = session.state.update({ effects: baseCompartment.reconfigure(baseExtensions()) }).state;
    },
    setActive(session: FakeSession | null): void {
      active = session;
    },
  };
}

function makeSession(state: EditorState): FakeSession {
  return { state, dirty: false, cleanDoc: state.doc.toString() };
}

/** 视图在某个会话上编辑：transaction 走 `session.state` 的 config（过滤生效），随后运行**该
 *  state 配置里**的 rebind 闭包——等价于真实视图 dispatch 时跑 updateListener。 */
function dispatchEdit(session: FakeSession, insert: string): void {
  const tr = session.state.update({ changes: { from: session.state.doc.length, insert } });
  for (const hook of tr.state.facet(rebindFacet)) hook({ state: tr.state, docChanged: tr.docChanged });
}

test("P1-1 正向：迁移会话在目标实例编辑——回写 / dirty 落目标实例，不污染源实例，撤销史保留", () => {
  const A = makeInstance();
  const B = makeInstance();
  const x = makeSession(A.sessionState("hello")); // 在 A 里建的会话
  // 迁移前作为后台会话改一次（显式赋值，模拟后台/装载路径）：制造一条撤销史。
  x.state = x.state.update({ changes: { from: x.state.doc.length, insert: "?" } }).state;
  assert.equal(x.state.doc.toString(), "hello?");
  assert.equal(undoDepth(x.state), 1);

  // 迁移到 B：整体迁入 + 换绑。
  B.adopt(x);
  assert.equal(undoDepth(x.state), 1, "换绑不丢撤销史");

  const aActive = makeSession(A.sessionState("source-doc")); // 源实例的前台会话
  A.setActive(aActive);
  B.setActive(x); // 迁移会话成为 B 的前台

  // B 的投影是只读：编辑应被拦（changeFilter 读**目标**实例 B 的投影）。
  B.projection.editable = false;
  dispatchEdit(x, "!");
  assert.equal(x.state.doc.toString(), "hello?", "过滤读目标实例 B 的只读投影（编辑被拦）");

  // 放开 B 的可编辑，真正编辑：回写落 x（B 的前台）。
  B.projection.editable = true;
  dispatchEdit(x, "!");
  assert.equal(x.state.doc.toString(), "hello?!", "迁移会话自身 state 被回写（切标签不丢编辑）");
  assert.equal(x.dirty, true, "dirty 落在迁移会话上（退出守卫可见）");
  assert.equal(aActive.state.doc.toString(), "source-doc", "源实例前台会话 state 不被覆写");
  assert.equal(B.dirtyEvents.length, 1, "dirty 事件数落在目标实例");
  assert.equal(A.dirtyEvents.length, 0, "源实例不收到迁移会话的 dirty 事件");
});

test("P1-1 反向：不换绑时复现后果（源实例被污染 / 迁移会话不回写 / dirty 漏判）", () => {
  // 复刻**未修复**形态：adopt 只把 state 当 B 的会话用，不换绑基础层闭包。
  const A = makeInstance();
  const B = makeInstance();
  const x = makeSession(A.sessionState("hello"));
  const aActive = makeSession(A.sessionState("source-doc"));
  A.setActive(aActive);
  B.setActive(x);
  B.projection.editable = true;

  dispatchEdit(x, "!");

  // 未换绑 ⇒ 闭包仍绑源实例 A：回写落进 A 的前台会话，x 自身 state 不更新，dirty 落 A。
  assert.equal(aActive.state.doc.toString(), "hello!", "（病态）源实例前台 state 被迁移会话的编辑覆写");
  assert.equal(x.state.doc.toString(), "hello", "（病态）迁移会话自身 state 未被回写（切标签即丢编辑）");
  assert.equal(x.dirty, false, "（病态）dirty 未落在迁移会话上（退出守卫漏判）");
  assert.equal(A.dirtyEvents.length, 1, "（病态）dirty 事件落到源实例");
});

// ---------------------------------------------------------------------------
// C. 实现守卫（读 src/editor.ts 源文本）
// ---------------------------------------------------------------------------

test("实现守卫：四处 Compartment 模块级、基础层进 baseCompartment、adopt 走 rebindEffects", () => {
  const source = readFileSync(new URL("../../src/editor.ts", import.meta.url), "utf8");

  // 1. 四个 compartment 必须**模块级**声明（行首、无缩进）——回退到 createEditor 体内即红。
  for (const name of ["modeCompartment", "wrapCompartment", "mdGutterCompartment", "baseCompartment"]) {
    assert.match(
      source,
      new RegExp(`^const ${name} = new Compartment\\(\\);$`, "m"),
      `${name} 必须是模块级声明（供跨实例状态迁移共享）`,
    );
  }
  // 2. createEditor 体内 MUST NOT 出现缩进的 `new Compartment()`（逐实例形态）。
  assert.ok(
    !/^ {2}const \w+Compartment = new Compartment\(\);/m.test(source),
    "createEditor 体内不得再逐实例创建 Compartment（M317 已提为模块级共享）",
  );

  // 3. rebindEffects 必须同时换绑 mode/wrap 与基础层。
  const rebind = /function rebindEffects\([^)]*\)[^{]*\{\n([\s\S]*?)\n  \}/.exec(source);
  assert.ok(rebind !== null, "找不到 rebindEffects 的实现体");
  assert.ok(/modeAndWrapEffects\(/.test(rebind[1]), "rebindEffects 必须带上 mode/wrap 换绑");
  assert.ok(/baseCompartment\.reconfigure\(baseExtensions\(\)\)/.test(rebind[1]), "rebindEffects 必须换绑基础层");

  // 4. adoptSession 必须整体迁入（不重建）+ 换绑。
  const adopt = /adoptSession\(session: EditorSession\) \{\n([\s\S]*?)\n    \},/.exec(source);
  assert.ok(adopt !== null, "找不到 adoptSession 的实现体");
  assert.ok(/rebindEffects\(/.test(adopt[1]), "adoptSession 必须调 rebindEffects 换绑（P1-1）");
  assert.ok(!/sessionState\(/.test(adopt[1]), "adoptSession 不得重建 state（会清空撤销史）");

  // 5. sessionState 的基础层必须经 baseCompartment（不得再有内联的实例闭包）。
  const sessionState = /function sessionState\([^)]*\)[^{]*\{\n([\s\S]*?)\n  \}/.exec(source);
  assert.ok(sessionState !== null, "找不到 sessionState 的实现体");
  assert.ok(
    /baseCompartment\.of\(baseExtensions\(\)\)/.test(sessionState[1]),
    "sessionState 必须把基础层收进 baseCompartment",
  );
  assert.ok(!/changeFilter\.of/.test(sessionState[1]), "sessionState 内不得再有内联 changeFilter（P1-1）");
  assert.ok(!/updateListener\.of/.test(sessionState[1]), "sessionState 内不得再有内联 updateListener（P1-1）");
});
