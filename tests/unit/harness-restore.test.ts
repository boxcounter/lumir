// 工具行终态摘要 + 快照恢复记录的纯判定单测（M368）：
//   - restoredAssistantText：空正文 assistant 记录的跳过判据（旧快照防御——core 侧 M367 起
//     不再落 `text: Some("")` 的轮次；面板消息活在 core 内存里，升级前起的会话可能仍带它）；
//   - toolDoneSummary：工具行 `{summary}` 的两态判定（成功 = 参数摘要、失败 = 状态+错误码）。
// 合同：mission M368 任务 1 / 3，与 src/harness-panel.ts 该段的注释判词、
// src-tauri/src/harness/turn.rs 的 summarize_args / summarize_result（跨语言的形状约定）。
// 这一层是零 DOM 环境（tests/unit/README.md）：只驱动 src/harness-panel.ts 导出的纯函数；
// 行元素与恢复循环的 DOM 面归真机验收场景 096 与 71。

import { test } from "node:test";
import assert from "node:assert/strict";
import { restoredAssistantText, restoredReasoningText, toolDoneSummary } from "../../src/harness-panel.ts";
import { t } from "../../src/copy.ts";

// ── 空正文 assistant 记录（任务 1：旧快照防御） ──

test("空正文 assistant 记录不渲染：空串 / 纯空白 / 缺 text / 非字符串 → null", () => {
  // 形状来自 M367 之前的 core：模型只发工具调用、无正文的轮次落一条 text: Some("") 的记录。
  assert.equal(restoredAssistantText({ role: "assistant", text: "" }), null);
  // 纯空白正文经 Markdown 渲染后同样只剩光秃 who 行，故一并跳过（trim 而非 === ""）。
  assert.equal(restoredAssistantText({ role: "assistant", text: "   \n\t " }), null);
  // 协议里 text 是 Option<String>：缺键与 null 都是「没有正文」。
  assert.equal(restoredAssistantText({ role: "assistant" }), null);
  assert.equal(restoredAssistantText({ role: "assistant", text: null }), null);
  // 形状不对（非字符串 / 非对象）不抛错、不渲染——宽容解析与快照其余字段同口径。
  assert.equal(restoredAssistantText({ role: "assistant", text: 42 }), null);
  assert.equal(restoredAssistantText(null), null);
  assert.equal(restoredAssistantText("assistant"), null);
});

test("有正文的 assistant 记录原样返回（含首尾空白——正文是模型原文，不改写）", () => {
  assert.equal(restoredAssistantText({ role: "assistant", text: "我先读一下目标文件。" }), "我先读一下目标文件。");
  assert.equal(restoredAssistantText({ role: "assistant", text: " 留白正文 " }), " 留白正文 ");
});

// ── 恢复消息的思考展示文本（M398：有 reasoning 明文才建思考块） ──

test("无 reasoning 明文的记录不建思考块：缺字段 / null / 空串 / 纯空白 / 非字符串 → null", () => {
  // 活会话快照的面板记录本就不带 reasoning，恢复记录里 kimi 的不透明项也取不到明文。
  assert.equal(restoredReasoningText({ role: "assistant", text: "正文" }), null);
  assert.equal(restoredReasoningText({ role: "assistant", reasoning: null }), null);
  assert.equal(restoredReasoningText({ role: "assistant", reasoning: "" }), null);
  assert.equal(restoredReasoningText({ role: "assistant", reasoning: "  \n\t " }), null);
  // 形状不对（非字符串 / 非对象）：宽容解析不抛错、不建块。
  assert.equal(restoredReasoningText({ role: "assistant", reasoning: 42 }), null);
  assert.equal(restoredReasoningText(null), null);
  assert.equal(restoredReasoningText("assistant"), null);
});

test("有 reasoning 明文的记录原样返回（含首尾空白——思考文本是模型原文，不改写）", () => {
  assert.equal(restoredReasoningText({ role: "assistant", reasoning: "先读文件再回答" }), "先读文件再回答");
  assert.equal(restoredReasoningText({ role: "assistant", reasoning: " 留白 " }), " 留白 ");
});

// ── 工具行终态摘要（任务 3：成功 = 参数摘要、失败 = 状态+错误） ──

test("成功行取参数摘要：done 发哨兵「成功」、started 带参数摘要 → 上屏参数摘要", () => {
  assert.equal(toolDoneSummary("成功", '{"path":"harness-note.md"}'), '{"path":"harness-note.md"}');
  // 空对象的参数摘要也是真读数（`{}` 是「这次没带参数」的事实），不当作空串回落。
  assert.equal(toolDoneSummary("成功", "{}"), "{}");
});

test("失败行原样保留状态与错误码：认的是失败形状 → done 原文不改写", () => {
  const denied = "denied · permission_denied: 权限规则拒绝了 cli_run（rm harness-note.md）";
  assert.equal(toolDoneSummary(denied, '{"command":"rm"}'), denied);
  const unknown = "error · tool_unknown: 未知工具：vault_bogus";
  assert.equal(toolDoneSummary(unknown, "{}"), unknown);
  const rejected = "rejected · approval_rejected: 用户拒绝了这次调用";
  assert.equal(toolDoneSummary(rejected, '{"path":"a.md"}'), rejected);
});

test("成功行回落 done 原文：没有更早的那份摘要时不伪造", () => {
  // 恢复路径（无 started 行）、乱序 done、桩环境（事件不带 summary）都落这条。
  assert.equal(toolDoneSummary("成功", ""), "成功");
  // 认不出的摘要（桩 / 视觉场景直接 fire 的自定义摘要）走「不是失败」那一支：有 started 摘要
  // 就用它、没有就原样上屏——两条都不吞信息。m351 视觉场景的 fire 全是不带 summary 的
  // started + 自定义 done 摘要，落的是后一条。
  assert.equal(toolDoneSummary("命中 5 篇", '{"query":"笔记"}'), '{"query":"笔记"}');
  assert.equal(toolDoneSummary("命中 5 篇", ""), "命中 5 篇");
});

// ── 上屏形态（真机场景锚的就是这几串，卡住模板与摘要的组合） ──

test("工具行上屏形态：live 成功行 = 名称 + 参数摘要（D344 模板 × 判定）", () => {
  const live = t(
    "D344",
    { name: "vault_read", summary: toolDoneSummary("成功", '{"path":"harness-note.md"}') },
    "zh",
  );
  assert.equal(live, '工具 vault_read：{"path":"harness-note.md"}');
  // 失败行不出现「成功」，状态与错误码都在（真实运行里 done 的摘要就是这一串）。
  const failed = t(
    "D344",
    { name: "vault_read", summary: toolDoneSummary("error · tool_unknown: 未知工具：vault_bogus", "") },
    "zh",
  );
  assert.equal(failed, "工具 vault_read：error · tool_unknown: 未知工具：vault_bogus");
});
