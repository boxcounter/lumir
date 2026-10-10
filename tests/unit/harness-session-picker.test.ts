// 会话恢复选择器纯模型层的单测（M392，change reshape-harness-session-recording design §6.1）：
//   - sessionEntriesOf：harness_list_sessions 载荷的宽容解析（M392 + M395 合同形状
//     SessionSummary[] = { session_id, first_user_text, ts }）+ 时间倒序兜底；
//   - truncateSessionName：会话名截断（标题栏会话名与选择器行同一份口径）；
//   - sessionWhen：行时间读数（同日相对时间、跨天回落短日期）。
// 合同：mission M392 任务 1 / 2，与 src/harness-panel.ts 该段的注释判词、
// openspec/changes/reshape-harness-session-recording/design.md §6.1 对账。
// 这一层是零 DOM 环境（tests/unit/README.md）：只驱动 src/harness-panel.ts 导出的纯函数；
// 浮层行与恢复点击的 DOM 面归真机验收（change 验证节 3.7 恢复场景）。
// 反向验证（REVIEW.md 第 1 条）：非法项丢弃 / 乱序重排 / 坏 JSON 这些用例就是「必须 FAIL
// 的输入」——若解析吞掉坏形状或把顺序交给网络序，下列长度与顺序断言必红。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_NAME_MAX,
  sessionEntriesOf,
  sessionWhen,
  sessPopDecision,
  sessPopDom,
  truncateSessionName,
} from "../../src/harness-panel.ts";
import type { SessListOutcome } from "../../src/harness-panel.ts";

// ── 清单解析（任务 1：合同形状 → SessionEntry） ──

test("合同数组原样提取：三项键齐全 → 字段直取", () => {
  const entries = sessionEntriesOf([
    { session_id: "s1759912345678-k3x9ab", first_user_text: "帮我整理这份笔记", ts: 1759912345 },
    { session_id: "s1759912000000-a1b2c3", first_user_text: null, ts: null },
  ]);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    sessionId: "s1759912345678-k3x9ab",
    firstUserText: "帮我整理这份笔记",
    ts: 1759912345,
  });
  assert.deepEqual(entries[1], { sessionId: "s1759912000000-a1b2c3", firstUserText: null, ts: null });
});

test("JSON string 载荷先 parse；坏 JSON / 非数组 / 非对象 → 空清单（不抛错）", () => {
  const ok = sessionEntriesOf(JSON.stringify([{ session_id: "s1-x", first_user_text: "hi", ts: 100 }]));
  assert.equal(ok.length, 1);
  assert.equal(ok[0].sessionId, "s1-x");
  // 反向验证：坏 JSON、标量、对象（非数组）一律空清单——桩 / M395 合并前的旧后端口径。
  assert.deepEqual(sessionEntriesOf("{not json"), []);
  assert.deepEqual(sessionEntriesOf(""), []);
  assert.deepEqual(sessionEntriesOf(42), []);
  assert.deepEqual(sessionEntriesOf(null), []);
  assert.deepEqual(sessionEntriesOf({ session_id: "s1-x" }), []);
  assert.deepEqual(sessionEntriesOf(undefined), []);
});

test("非法项丢弃：缺 id / 空串 id / 非字符串 id / 裸值项不进清单", () => {
  const entries = sessionEntriesOf([
    { first_user_text: "没有 id", ts: 1 }, // 缺 session_id：无法恢复，死项
    { session_id: "", first_user_text: "空 id", ts: 1 },
    { session_id: 42, first_user_text: "非字符串 id", ts: 1 },
    null,
    "s1-x",
    { session_id: "s1759912345678-k3x9ab", first_user_text: "合法项", ts: 1 },
  ]);
  // 反向验证：上面 5 个非法项若任何一个混进来，长度就不是 1。
  assert.equal(entries.length, 1);
  assert.equal(entries[0].firstUserText, "合法项");
});

test("宽容提取：first_user_text 空白 / 非串 → null；ts 非数 / 非正 → null", () => {
  const entries = sessionEntriesOf([
    { session_id: "a", first_user_text: "   ", ts: 0 },
    { session_id: "b", first_user_text: 42, ts: -5 },
    { session_id: "c", first_user_text: null, ts: Number.NaN },
    { session_id: "d", first_user_text: "有原文", ts: 3.5 },
  ]);
  // 解析自带 id 降序重排——按 id 排回输入序再比对字段。
  const byId = [...entries].sort((x, y) => (x.sessionId < y.sessionId ? -1 : 1));
  assert.deepEqual(byId.map((e) => e.firstUserText), [null, null, null, "有原文"]);
  assert.deepEqual(byId.map((e) => e.ts), [null, null, null, 3.5]);
});

test("时间倒序兜底：乱序 / 升序输入一律按 session_id 字典序降序输出", () => {
  // 时间序前缀可排序 ⇒ 字典序与时间序同向；渲染序不让给网络序。
  const entries = sessionEntriesOf([
    { session_id: "s100-a", first_user_text: "旧", ts: 100 },
    { session_id: "s300-c", first_user_text: "新", ts: 300 },
    { session_id: "s200-b", first_user_text: "中", ts: 200 },
  ]);
  assert.deepEqual(entries.map((e) => e.sessionId), ["s300-c", "s200-b", "s100-a"]);
});

// ── 会话名截断（任务 1：与标题栏会话名同一口径） ──

test("截断：21 字 → 20 字 + 省略号；恰 20 字原样；CJK / emoji 按 1 字计", () => {
  const cjk21 = "一二三四五六七八九十一二三四五六七八九十野"; // 21 码点
  assert.equal(Array.from(cjk21).length, 21);
  assert.equal(truncateSessionName(cjk21), "一二三四五六七八九十一二三四五六七八九十…");
  const cjk20 = cjk21.slice(0, 20);
  assert.equal(truncateSessionName(cjk20), cjk20); // 恰 20：不加省略号
  // emoji 是代理对：Array.from 按码点计 1 字（不按 UTF-16 单元）。
  assert.equal(truncateSessionName("😀".repeat(SESSION_NAME_MAX + 1)), "😀".repeat(SESSION_NAME_MAX) + "…");
  // 不超长原样返回（含首尾空白——用户原文不改写）。
  assert.equal(truncateSessionName(" 短名 "), " 短名 ");
});

// ── 行时间读数（任务 1：同日相对、跨天短日期） ──

const NOW = new Date(2026, 9, 8, 15, 0, 0).getTime(); // 2026-10-08 15:00 本地

test("同日给 narrow 相对时间：1 分钟内秒、1 小时内分、24h 内且同日给小时", () => {
  const at = (msAgo: number): number => (NOW - msAgo) / 1000;
  assert.equal(sessionWhen(at(30_000), NOW, "zh"), "30秒前");
  assert.equal(sessionWhen(at(5 * 60_000), NOW, "zh"), "5分钟前");
  assert.equal(sessionWhen(at(3 * 3_600_000), NOW, "zh"), "3小时前");
  assert.equal(sessionWhen(at(5 * 60_000), NOW, "en"), "5m ago");
});

test("跨天回落短日期：23 小时前但昨天 → 短日期，不是「23小时前」", () => {
  // NOW = 10-08 15:00；10-07 17:00 是 22h 前、不同日——必须走日期支。
  const yesterday = new Date(2026, 9, 7, 17, 0, 0).getTime();
  const out = sessionWhen(yesterday / 1000, NOW, "zh");
  assert.ok(!out.includes("小时前"), `跨天不应输出相对小时：${out}`);
  assert.ok(out.includes("10月7日") || out.includes("7"), `短日期应含月/日：${out}`);
});

test("未来时间钳进 0 秒档（时钟回拨不产出负数读数）", () => {
  const out = sessionWhen((NOW + 60_000) / 1000, NOW, "zh");
  assert.ok(!out.includes("-"), `不产出负时间：${out}`);
});

// ── 会话浮层揭示决策与可见态（M442，合同 docs/specs/overlay-visibility.md 的 O5） ──
//   O5：内容已确认为非空才揭示；空清单 / 取数失败一律不揭示且给可感知反馈（不得静默）；
//   aria-expanded 与浮层实际可见态同源（sessPopDom 从同一布尔派生两面）。这两条纯函数是
//   DOM 层（setSessPop / applySessPop）的唯一决策来源——真机层判后果（不闪现 + 有反馈）。

const OUTCOME_SWEEP: SessListOutcome[] = [
  { kind: "empty" },
  { kind: "failed" },
  { kind: "entries", count: 0 },
  { kind: "entries", count: 1 },
  { kind: "entries", count: 3 },
  { kind: "entries", count: 99 },
];

test("O5 空清单：不揭示且有反馈（不得静默）", () => {
  assert.deepEqual(sessPopDecision({ kind: "empty" }), { visible: false, notify: true });
});

test("O5 取数成功但零条 = 空态（边界）：不揭示且有反馈", () => {
  // 反向验证：{ kind: "entries", count: 0 } 若被判成「有内容」（visible true），
  // 就会重演「先开出空浮层」的 M442 形态——这条断言因此有区分度。
  assert.deepEqual(sessPopDecision({ kind: "entries", count: 0 }), { visible: false, notify: true });
});

test("O5 非空清单：正常揭示，且不额外打扰（无反馈）", () => {
  assert.deepEqual(sessPopDecision({ kind: "entries", count: 1 }), { visible: true, notify: false });
  assert.deepEqual(sessPopDecision({ kind: "entries", count: 3 }), { visible: true, notify: false });
});

test("O5 取数失败：不揭示且有反馈（后端不可用 / 命令未注册 / 读取报错）", () => {
  assert.deepEqual(sessPopDecision({ kind: "failed" }), { visible: false, notify: true });
});

test("O5 不变量扫掠：visible ⟺ 取数成功且 count>0；visible 与 notify 恒互斥", () => {
  // 输入分布按「内容体量 × 取数结果」取样（O5 的可证伪表述）：逐点断言不变量本体，
  // 而不是逐个案例。任一取样点被误判（如 count 0 判 visible）即红。
  for (const outcome of OUTCOME_SWEEP) {
    const decision = sessPopDecision(outcome);
    const nonEmpty = outcome.kind === "entries" && outcome.count > 0;
    const tag = JSON.stringify(outcome);
    assert.equal(decision.visible, nonEmpty, `visible 判据（${tag}）`);
    assert.equal(decision.notify, !nonEmpty, `notify 判据（${tag}）`);
    assert.notEqual(decision.visible, decision.notify, `visible 与 notify MUST 恰一为真（${tag}）`);
  }
});

test("sessPopDom：hidden 与 aria-expanded 由同一布尔派生（单一写入口的同源保证）", () => {
  assert.deepEqual(sessPopDom(true), { hidden: false, ariaExpanded: "true" });
  assert.deepEqual(sessPopDom(false), { hidden: true, ariaExpanded: "false" });
});

test("O5 aria 一致性：aria-expanded==='true' ⟺ 浮层可见（hidden===false），覆盖决策全分布", () => {
  // 组合决策与 DOM 两面（与 DOM 层 applySessPop 的消费链同形）：任取样点都不得出现
  // 「aria 说开着、浮层实际隐藏」或反过来的脱节——那正是 M442 的属性与真实态不同步形态。
  for (const outcome of OUTCOME_SWEEP) {
    const decision = sessPopDecision(outcome);
    const dom = sessPopDom(decision.visible);
    const tag = JSON.stringify(outcome);
    assert.equal(dom.hidden, !decision.visible, `hidden 与可见态一致（${tag}）`);
    assert.equal(dom.ariaExpanded === "true", !dom.hidden, `aria-expanded 与可见态一致（${tag}）`);
  }
});

