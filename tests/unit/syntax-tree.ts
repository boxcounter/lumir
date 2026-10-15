// 「拿到覆盖整篇的语法树快照」的共享 helper（M520）。
//
// 坑（两份 finding 钉死，2026-10-12 / 2026-10-13）：`syntaxTree(state)` 读的是 `Language.state`
// 字段在 **state 构造时**定格的快照，不是正在推进的 ParseContext。`LanguageState.init` 给初始
// 解析的预算只有 **20ms 墙钟**；机器有负载（多 worktree 并发）时被抢占超预算，快照就停在文档
// 的一部分。`ensureSyntaxTree` 只推进共享的 ParseContext 并返回 `parse.tree`，**不刷新**这份
// field 快照——于是 `assert.ok(ensureSyntaxTree(...) !== null)` 这条守卫守的是另一棵树：守卫过了，
// 被测函数内部读 `syntaxTree(state)` 仍是半截树（假红，实测并发跑 3/12 红）；节点缺失还会让
// 期望 `null` 的负向断言假绿（跑过但其实没跑）。同一份 `syntaxTreeAvailable` 在快照残缺时也报 true。
//
// 刷新机制：`LanguageState.apply()` 在 `this.tree != this.context.tree` 时拿 `context.tree` 重建
// field——`ensureSyntaxTree` 已把 context.tree 推到全篇，走一次空事务即可让快照跟进。空事务不改
// 文档、不改选区（`tr.changes.empty === true`），且不进撤销栈（history 只在有 changes / effects
// 时记事件）。
//
// 确定性验证（M520 探针：人为让 20ms 预算落空，4000 行列表 doc）：
//   docLen 66889 → 初始快照 14 / ensureSyntaxTree 66889 / 快照仍 14（syntaxTreeAvailable=true）
//                → 空事务后快照 66889
//
// 结论：凡测试里把 state 喂给「读语法树」的代码（src/preview/block-copy、preview/lists、
// preview/links、cell-geometry、list-indent、enter-indent）的地方，都先过这个 helper；
// 不要再写 `ensureSyntaxTree(...) !== null` 当守卫。

import assert from "node:assert/strict";
import type { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, language, syntaxTree } from "@codemirror/language";

/**
 * 把解析推进到文档末尾、刷新 `Language.state` 的 field 快照，返回快照已覆盖整篇的 state。
 *
 * 第二条断言（快照长度 === 文档长度）是「快照真的完整」的显式判据——缺了它，第一条
 * `ensureSyntaxTree(...) !== null` 只是错觉：快照与 context 是两棵树，这正是本 helper 要堵的坑。
 */
export function completeTree(state: EditorState): EditorState {
  // 无语言扩展的 state（如纯文本 code 模式的用例：extensions 里没有 language）没有
  // `Language.state` 字段，也不存在可读的快照——原样返回。此时被测代码读 `syntaxTree`
  // 拿到的是空树，红会落在业务断言上，不会被这里静默吞掉。
  if (state.facet(language) === null) return state;
  assert.ok(
    ensureSyntaxTree(state, state.doc.length, 5000) !== null,
    "ensureSyntaxTree 未能在 5000ms 内覆盖整篇（解析预算被抢占）",
  );
  const refreshed = state.update({}).state;
  assert.equal(
    syntaxTree(refreshed).length,
    refreshed.doc.length,
    "语法树快照未覆盖整篇（快照 ≠ context，field 未刷新）——被测代码读到的会是残缺快照",
  );
  return refreshed;
}
