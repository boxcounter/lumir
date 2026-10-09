// 工具行摘要人话化 + 快照恢复记录的纯判定单测（M368 起，M406 重写）：
//   - restoredAssistantText / restoredReasoningText：空正文 / 无 reasoning 明文的跳过判据
//    （旧快照防御——core 侧 M367 起不再落 `text: Some("")` 的轮次；面板消息活在 core
//     内存里，升级前起的会话可能仍带它）；
//   - humanizeToolArgs / humanizeToolArgsStrict：工具行参数格的展示层提取（按工具名取
//     关键参数；严格版取不到 → ""，宽松版回落原文，都不伪造）；
//   - rejectedReasonOf / failureTextOf：恢复路径的拒绝原因与失败尾注（数据源是面板
//     记录 text 里的工具输出 JSON 原文——summary 里那份被 core 80 字截断，不取）；
//   - formatArgv / diffPathOf / approvalArgsText：批准载荷关键参数全文的拼取。
// 合同：mission M406 任务 1，与 src/harness-panel.ts 该段的注释判词、
// src-tauri/src/harness/turn.rs 的 summarize_args / summarize_result 与 tools.rs 的
// ToolOutput::err 信封（{"ok":false,"code","message"}，跨语言的形状约定）。
// 这一层是零 DOM 环境（tests/unit/README.md）：只驱动 src/harness-panel.ts 导出的纯函数；
// 行元素与恢复循环的 DOM 面归真机验收场景 096 与 71。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approvalArgsText,
  diffPathOf,
  failureTextOf,
  formatArgv,
  humanizeToolArgs,
  humanizeToolArgsStrict,
  rejectedReasonOf,
  restoredAssistantText,
  restoredReasoningText,
} from "../../src/harness-panel.ts";

// ── 空正文 assistant 记录（旧快照防御） ──

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

// ── argv 单行拼接（展示层；含空白 / 引号的参数加双引号） ──

test("formatArgv：裸参数直连；含空白 / 引号的参数加双引号并转义内层引号与反斜杠", () => {
  assert.equal(formatArgv(["rm", "harness-note.md"]), "rm harness-note.md");
  assert.equal(formatArgv(["git", "commit", "-m", "fix bug"]), 'git commit -m "fix bug"');
  assert.equal(formatArgv(['echo', 'say "hi"']), 'echo "say \\"hi\\""');
  assert.equal(formatArgv(["echo", "a\\b"]), "echo a\\b"); // 无空白 / 引号：反斜杠原样
  assert.equal(formatArgv(["echo", "it's"]), 'echo "it\'s"'); // 单引号也触发加壳
  assert.equal(formatArgv([]), "");
});

// ── 参数人话化（按工具名取关键参数；严格版取空 → 调用方回落） ──

test("humanizeToolArgsStrict：六工具各取关键参数（cli_run 拼完整命令行）", () => {
  assert.equal(
    humanizeToolArgsStrict("cli_run", '{"command":"rm","args":["harness-note.md"]}'),
    "rm harness-note.md",
  );
  assert.equal(humanizeToolArgsStrict("cli_run", '{"command":"ls"}'), "ls"); // args 缺省
  assert.equal(humanizeToolArgsStrict("vault_read", '{"path":"harness-note.md"}'), "harness-note.md");
  assert.equal(humanizeToolArgsStrict("vault_create", '{"path":"a.md","content":"…"}'), "a.md");
  assert.equal(humanizeToolArgsStrict("vault_patch", '{"path":"a.md","diff":"…"}'), "a.md");
  assert.equal(humanizeToolArgsStrict("vault_search", '{"query":"笔记"}'), "笔记");
  assert.equal(humanizeToolArgsStrict("skill_load", '{"name":"obsidian-cli"}'), "obsidian-cli");
});

test("humanizeToolArgsStrict 取空：非 JSON / 截断半边 / 非对象 / 缺关键参数 / 未知工具 → \"\"", () => {
  // 反向验证：这些输入若漏出非空串，恢复路径的拒绝行参数格就会拿失败摘要冒充参数。
  assert.equal(humanizeToolArgsStrict("vault_read", '{"path":"harness-n…'), ""); // 80 字截断的半边
  assert.equal(humanizeToolArgsStrict("cli_run", "denied · permission_denied: 权限规则拒绝了 cli_run"), "");
  assert.equal(humanizeToolArgsStrict("vault_read", "42"), "");
  assert.equal(humanizeToolArgsStrict("vault_read", '["a.md"]'), "");
  assert.equal(humanizeToolArgsStrict("vault_read", "{}"), ""); // 缺 path
  assert.equal(humanizeToolArgsStrict("cli_run", '{"args":["x"]}'), ""); // 缺 command
  assert.equal(humanizeToolArgsStrict("vault_bogus", '{"path":"a.md"}'), ""); // 未知工具
});

test("humanizeToolArgs 宽松版：严格版取空时回落摘要原文（不吞信息），空摘要 → 空串", () => {
  // 截断 JSON：截下来的半边仍比光秃工具名有信息量 → 原文上屏。
  assert.equal(humanizeToolArgs("vault_read", '{"path":"harness-n…'), '{"path":"harness-n…');
  // 桩 / 视觉场景直接 fire 的自定义摘要（不是参数 JSON）：原样上屏。
  assert.equal(humanizeToolArgs("vault_search", "命中 5 篇"), "命中 5 篇");
  assert.equal(humanizeToolArgs("vault_read", ""), "");
});

test("vault_list 空 path 回落根目录「/」（列的是 vault 根，不是「没参数」）", () => {
  assert.equal(humanizeToolArgsStrict("vault_list", '{"path":""}'), "/");
  assert.equal(humanizeToolArgsStrict("vault_list", "{}"), "/");
});

// ── diff 头文件名（批准载荷写工具的关键参数全文） ──

test("diffPathOf：取 `+++ b/{path}` 头的文件名；无该头 → null", () => {
  const diff = "--- a/notes/a.md\n+++ b/notes/a.md\n@@ -1 +1 @@\n-old\n+new\n";
  assert.equal(diffPathOf(diff), "notes/a.md");
  // 新建文件的 diff（core diff.rs 同口径，旧侧是 /dev/null）：仍取 +++ 头。
  const created = "--- /dev/null\n+++ b/新建.md\n@@ -0,0 +1 @@\n+hi\n";
  assert.equal(diffPathOf(created), "新建.md");
  assert.equal(diffPathOf("没有 diff 头"), null);
  assert.equal(diffPathOf(""), null);
});

// ── 批准载荷关键参数全文（argv 优先于 diff） ──

test("approvalArgsText：argv → 命令行全文；只有 diff → 文件名；都无 → \"\"", () => {
  assert.equal(approvalArgsText({ argv: ["rm", "a b"] }), 'rm "a b"');
  assert.equal(approvalArgsText({ diff: "--- a/x.md\n+++ b/x.md\n" }), "x.md");
  // argv 在场即胜（cli_run 的 diff 恒缺席，分支不真冲突；判序写死防将来载荷变化）。
  assert.equal(approvalArgsText({ argv: ["ls"], diff: "--- a/x\n+++ b/x\n" }), "ls");
  assert.equal(approvalArgsText({}), "");
});

// ── 恢复路径的拒绝原因（输出 JSON 原文里的 message；summary 那份被 80 字截断不取） ──

test("rejectedReasonOf：approval_rejected 输出的 message 全文；其它形状 → null", () => {
  const text = JSON.stringify({ ok: false, code: "approval_rejected", message: "先别动这条命令" });
  assert.equal(rejectedReasonOf({ role: "tool", text }), "先别动这条命令");
  // 反向验证：缺 text / 非 JSON / 非 rejection 码 / 空 message / 非对象记录一律 null
  // （不伪造原因行——恢复出的拒绝行可以没有原因，不能有编出来的原因）。
  assert.equal(rejectedReasonOf({ role: "tool" }), null);
  assert.equal(rejectedReasonOf({ role: "tool", text: "不是 JSON" }), null);
  assert.equal(rejectedReasonOf({ role: "tool", text: '{"ok":false,"code":"permission_denied","message":"x"}' }), null);
  assert.equal(rejectedReasonOf({ role: "tool", text: '{"ok":false,"code":"approval_rejected","message":"  "}' }), null);
  assert.equal(rejectedReasonOf(null), null);
});

// ── 恢复路径的失败尾注（denied / error 行 = code + message 全文） ──

test("failureTextOf：ok=false 且有 code → `code: message`；message 缺省 → 只 code；成功 / 非 JSON → null", () => {
  const denied = JSON.stringify({ ok: false, code: "permission_denied", message: "权限规则拒绝了 cli_run" });
  assert.equal(failureTextOf({ role: "tool", text: denied }), "permission_denied: 权限规则拒绝了 cli_run");
  const noMessage = JSON.stringify({ ok: false, code: "tool_unknown" });
  assert.equal(failureTextOf({ role: "tool", text: noMessage }), "tool_unknown");
  // 成功输出与非 JSON 原文都不是失败形状。
  assert.equal(failureTextOf({ role: "tool", text: '{"ok":true,"content":"…"}' }), null);
  assert.equal(failureTextOf({ role: "tool", text: "不是 JSON" }), null);
  assert.equal(failureTextOf({ role: "tool" }), null);
});
