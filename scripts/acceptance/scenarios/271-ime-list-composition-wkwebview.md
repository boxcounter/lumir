---
# WKWebView 列表行 IME 合成序列（dev-only 驱动）。边界：本场景派发的 CompositionEvent /
# InputEvent 全部 isTrusted:false，DOM 默认动作由驱动用 Range/文本节点执行；它证明产品 JS 路径
# 在真实 WKWebView 里按观测到的序列工作，不证明原生 TSM / 候选窗 / marked text。原生终判仍归
# 156 / 262 人工矩阵；本场景只做机器回归门。
id: "271-ime-list-composition-wkwebview"
item: 271
tier: full
title: "列表行 IME 合成序列：deleteCompositionText 接管 / 候选提交与 marker 恢复（合成事件，非原生 IME）"
open: ime-list-setext.md
marker: "词汇"
steps:
  - name: 记录 fixture 基线（不写盘判据）
    do: record
    file: ime-list-setext.md
    as: imeBase

  - name: 组合 s：组合期冻结、前一行 DOM 不被清空、取消后回到基线
    do: imeDrive
    ime: { case: compose, line: 2, timeoutMs: 8000 }
    expect:
      - label: 组合期目标行无 marker widget（含 16ms 发布窗）
        file:
          path: "env:acceptance/ime/compose.jsonl"
          jsonl: { run_tag: "$runTag", case: compose, marker_during: 0, marker_composing_peak: 0, marker_peak: 0 }
      - label: 组合期前一行 DOM 未被清空
        file:
          path: "env:acceptance/ime/compose.jsonl"
          jsonl: { run_tag: "$runTag", case: compose, prev_dom_during: "词汇", prev_never_empty: true }
      - label: 取消组合后文档精确回到三行基线，解析已收束
        file:
          path: "env:acceptance/ime/compose.jsonl"
          jsonl: { run_tag: "$runTag", case: compose, doc_final: "词汇\n- \n后续", settle_timeout: false, parse_pending_at_end: false }
      - shot: 01-组合期

  - name: 组合 s 后 deleteCompositionText 删空：产品必须 preventDefault 并恢复基线
    do: imeDrive
    ime: { case: delete-empty, line: 2, timeoutMs: 8000 }
    expect:
      - label: deleteCompositionText 被产品显式接管
        file:
          path: "env:acceptance/ime/delete-empty.jsonl"
          jsonl: { run_tag: "$runTag", case: delete-empty, delete_prevented: true }
      - label: 删空后文档精确回到三行基线，解析已收束
        file:
          path: "env:acceptance/ime/delete-empty.jsonl"
          jsonl: { run_tag: "$runTag", case: delete-empty, doc_final: "词汇\n- \n后续", settle_timeout: false, parse_pending_at_end: false }
      - label: 删空后前一行 DOM 未被清空、组合期与 250ms 低频窗内均无残留 marker
        file:
          path: "env:acceptance/ime/delete-empty.jsonl"
          jsonl: { run_tag: "$runTag", case: delete-empty, prev_dom_final: "词汇", marker_composing_peak: 0, marker_peak: 0 }
      - shot: 02-删空后

  - name: 不可取消的 pending delete：浏览器默认动作不得吞掉 setext 候选 marker
    do: imeDrive
    ime: { case: delete-uncancelable, line: 2, timeoutMs: 8000 }
    expect:
      - label: 事件不可取消（preventDefault 无法阻止默认动作）
        file:
          path: "env:acceptance/ime/delete-uncancelable.jsonl"
          jsonl: { run_tag: "$runTag", case: delete-uncancelable, uncancelable: true, delete_prevented: false }
      - label: setext 候选由 shield 隔离，默认删除无文本可删
        file:
          path: "env:acceptance/ime/delete-uncancelable.jsonl"
          jsonl: { run_tag: "$runTag", case: delete-uncancelable, shield_present: true, default_delete_attempted: false }
      - label: 源码保留三行基线，解析已收束
        file:
          path: "env:acceptance/ime/delete-uncancelable.jsonl"
          jsonl: { run_tag: "$runTag", case: delete-uncancelable, doc_final: "词汇\n- \n后续", settle_timeout: false, parse_pending_at_end: false }
      - shot: 03-不可取消删空

  - name: 候选提交“是”：文档只新增候选，目标行 marker 恢复
    do: imeDrive
    ime: { case: commit, line: 2, timeoutMs: 8000 }
    expect:
      - label: 候选提交后文档为 词汇\\n- 是\\n后续，解析已收束
        file:
          path: "env:acceptance/ime/commit.jsonl"
          jsonl: { run_tag: "$runTag", case: commit, doc_final: "词汇\n- 是\n后续", settle_timeout: false, parse_pending_at_end: false }
      - label: 目标行 marker 恢复且不重复，组合期无提前渲染
        file:
          path: "env:acceptance/ime/commit.jsonl"
          jsonl: { run_tag: "$runTag", case: commit, marker_composing_peak: 0, marker_final: 1, marker_peak: 1 }
      - label: 相邻行 DOM 保持
        file:
          path: "env:acceptance/ime/commit.jsonl"
          jsonl: { run_tag: "$runTag", case: commit, prev_dom_final: "词汇", next_dom_final: "后续" }
      - label: fixture 未被写盘
        file: { path: ime-list-setext.md, unchangedSince: imeBase }
      - label: fixture mtime 未被写盘
        file: { path: ime-list-setext.md, mtimeUnchangedSince: imeBase }
      - shot: 04-候选提交后
---

# 271 —— 列表行 IME 合成序列（WKWebView 事件复刻）

本场景由验收实例的 Vite dev server 注入 `scripts/acceptance/driver/ime-driver.mjs`，按真实
WKWebView 日志（`deleteCompositionText` → `insertFromComposition` → compositionend）复刻事件序，
在真实 WKWebView 里驱动产品 JS 路径。

**证据边界**：合成事件（`isTrusted:false`）+ DOM Range 改态，不是原生 TSM / 候选窗 / marked
text / 按键时序。PASS 只表示产品 JS 路径在该序列下正确；原生终判仍归 156 / 262 人工矩阵。

**覆盖收窄（2026-11-21，M1 变异实测）**：本场景判别 deleteCompositionText 接管与 compositionend
恢复链——M3（去掉接管）判红。M1（去掉 `update` 里的组合期冻结条件）**仍 PASS**：这条合成序列里
doc 已变为 `- s`，但 state 语法树在组合期尚未跟上 list，`build` 拿不到 list 判定，冻结分支因此
没有区分度（120ms 组合观察窗与 300ms 收束窗都读不到 marker）。**本场景不证明组合期冻结**；
组合期不插入 marker 的承诺仍归 156 / 262 真机人工矩阵。

**不可取消的 pending delete**：WebKit 的 `TypingDeletePendingComposition` 不可取消
（`isBeforeInputEventCancelable` 返回 false），`preventDefault` 无效。本场景新增
`delete-uncancelable` case：派发 `cancelable:false` 的 beforeinput，再由驱动模拟浏览器默认
动作（向后删 caret 前的可编辑文本）。setext 候选的 `- ` 由非可编辑原子 shield 隔离，默认
删除没有可删文本；断言源码保留 `- `、`delete_prevented:false`、`shield_present:true`。

**不写盘**：驱动只改内存 doc；`record` + `file.unchangedSince` / `mtimeUnchangedSince` 钉住
fixture 未被保存。

**不依赖 editor_ime trace**：所有判据来自驱动报告的 JSONL；`editor_ime` 若仍在场只作辅助日志，
任务 4.5 删除后本场景不受影响。
