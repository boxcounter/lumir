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
  truncateSessionName,
} from "../../src/harness-panel.ts";

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
