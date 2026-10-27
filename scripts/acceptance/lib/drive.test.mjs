// scripts/acceptance/lib/drive.test.mjs —— `settle()` / `snapshotBody()` 的自测（M759）。
//
// 为什么需要它：M751 让每次 `get_app_state` 都带 `disable_diff: true`（防空 diff 假绿），副作用是
// KimiCU **每次调用都新建快照**——首行 `AX snapshot_id=<UUID>`（mode=full 另有末行
// `Screenshot: … screenshot_id=…`）每次读都换。`settle()` 原先比整份原文，于是「连续两次一致」
// 永远不成立：post-M751 观察到的 25 次 settle 执行全部 15s 超时（2026-10-27 调查
// `.local/reports/settle-stability-oct27/README.md`）。修法是只剥产物 id 行、正文仍逐字节比较。
//
// 这一层修的缺陷形态是「**永不成立**」与「**放宽成恒真**」两侧都无声——所以用例必须成对：
//   - 正例：正文相同 + id 每次变 ⇒ 快速稳定（改前必红：15s/超时）；
//   - 反例 A：任一节点行变化 ⇒ 仍判未稳定（证明剥的不是整个正文）；
//   - 反例 B：`element_count` / `truncated` 变化 ⇒ 仍判未稳定（证明 header 事实仍参与比较）；
//   - 反例 C：无 `AXTextArea` ⇒ 编辑器门不放宽（正文恒定也要超时）；
//   - 返回值仍是**原始**快照（证据 dump 与 `ax.has` 断言看原文）。
// 只改一处会让另一处悄悄退回旧口径：`settleEditorless` 的同类用例在 execute.test.mjs。
//
// 跑法（经 scripts/acceptance/check-suite.sh 接入 quick 与 docs CI；改过 drive 的等待逻辑后也可单跑）：
//   node --test scripts/acceptance/lib/drive.test.mjs
//
// 纪律：全部用假 `cu.state`，不起真机、不碰 KimiCU / 验收 vault。负例子用短 `timeoutMs`
// （settle 的采样间隔是 700ms，800ms 恰好能读到两次再超时）保证整个文件是秒级。
import assert from "node:assert/strict";
import test from "node:test";

import { settle, snapshotBody, StepError } from "./drive.mjs";

/** KimiCU 快照首行（逐字取自 2026-10-27 的真机 dump）。 */
const snapshotIdLine = (id) =>
  `AX snapshot_id=${id}. Pass this ID with index-based actions; it is separate from the screenshot_id and diff revision.`;

/** mode=full 的末行（同一份 dump 的形态）。 */
const screenshotLine = (id) =>
  `Screenshot: window_id=11500, screenshot_id=${id}; 2048×1365 pixels. Use these IDs with coordinates in this image's pixels, origin (0,0) at its top-left.`;

/** 合成的 AX 快照文本：只有该变的字段可调，其余逐字固定——比较的是「同一份界面」。 */
function axText({
  snapshotId = "AAAAAAAA-0000-0000-0000-000000000000",
  screenshotId = null,
  elementCount = 4,
  truncated = "false",
  nodeLine = '- [8] AXStaticText = "Lumir 0.10.0" @10,10 100×20',
  editor = true,
} = {}) {
  const lines = [
    snapshotIdLine(snapshotId),
    "# Lumir App State",
    "",
    "- app: Lumir",
    "- pid: 42350",
    `- element_count: ${elementCount}`,
    `- truncated: ${truncated}`,
    "- captured_bounds: x=8 y=40 w=1200 h=800 (screen points)",
    "",
    "```text",
    '- [0] AXApplication "Lumir"',
    '  - [1] AXWindow "Lumir" @0,0 1200×800 actions=[AXRaise]',
    "    - [2] AXScrollArea @0,0 1200×800",
    '      - [3] AXWebArea (Lumir) URL: http://127.0.0.1:1430/',
    nodeLine,
  ];
  if (editor) lines.push('      - [9] AXTextArea = "# doc\\nbody" @0,0 1100×700 actions=[AXPress]');
  lines.push("```");
  if (screenshotId) lines.push(screenshotLine(screenshotId));
  return lines.join("\n");
}

/** 假 `CuClient`：按顺序返回给定文本，用完之后重复最后一份（并记录读取次数）。 */
function fakeCu(texts) {
  let i = 0;
  const reads = [];
  return {
    reads,
    state: async (pid, { mode } = {}) => {
      reads.push({ pid, mode });
      const text = texts[Math.min(i, texts.length - 1)];
      i += 1;
      return { text, image: null };
    },
  };
}

test("snapshotBody：只剥行首的产物 id 两行，其余正文逐字节保留（含 pre-M751 无 id 行时原样返回）", () => {
  const text = axText({ snapshotId: "AAAA", screenshotId: "bbbb" });
  const expected = text
    .split("\n")
    .filter((line) => !line.startsWith("AX snapshot_id=") && !line.startsWith("Screenshot: "))
    .join("\n");
  assert.equal(snapshotBody(text), expected, "正文应与「原文去掉两行元数据」逐字节相同");
  assert.ok(!snapshotBody(text).includes("snapshot_id="), "产物 id 不得留在正文里");
  assert.ok(snapshotBody(text).includes("- element_count: 4"), "header 事实必须留在正文里");
  assert.ok(snapshotBody(text).includes('AXStaticText = "Lumir 0.10.0"'), "节点行必须留在正文里");

  // pre-M751 的 dump 没有 id 行：原样返回（不多不少一个字节），证明这只剥元数据、不重排正文。
  const preM751 = axText().split("\n").slice(1).filter((l) => !l.startsWith("Screenshot: ")).join("\n");
  assert.equal(snapshotBody(preM751), preM751, "没有产物 id 行时 snapshotBody 必须是恒等变换");

  // 只剥**行首**：正文 / 节点 value 里恰好写了这串字样的行不受影响（不能吃掉界面内容）。
  const inBody = text.replace(
    '- [8] AXStaticText = "Lumir 0.10.0" @10,10 100×20',
    '- [8] AXStaticText = "AX snapshot_id=keep-me" @10,10 100×20',
  );
  assert.ok(snapshotBody(inBody).includes('"AX snapshot_id=keep-me"'), "行内出现的同名字样不得被剥掉");
});

test("settle：正文相同、snapshot_id / screenshot_id 每次读都变 ⇒ 快速稳定，返回的仍是原始快照", async () => {
  const cu = fakeCu([
    axText({ snapshotId: "AAAA", screenshotId: "1111" }),
    axText({ snapshotId: "BBBB", screenshotId: "2222" }),
    axText({ snapshotId: "CCCC", screenshotId: "3333" }),
  ]);
  const ax = await settle(cu, 0, { timeoutMs: 2000 });
  assert.ok(cu.reads.length <= 3, `应在 ≤3 次读取内稳定，实际读了 ${cu.reads.length} 次`);
  assert.ok(cu.reads.every((r) => r.mode === "ax"), "settle 走 mode=ax：mock 读到的模式应与生产一致");
  assert.match(ax.text, /AX snapshot_id=/, "返回值是原始快照：证据 dump / ax.has 断言继续看原文");
  assert.ok(ax.textarea, "编辑器节点仍由原文解析出来");
});

test("settle：节点行每次读都变 ⇒ 仍判未稳定（剥的是产物 id，不是界面状态）", async () => {
  const cu = fakeCu([
    axText({ snapshotId: "AAAA", nodeLine: '- [8] AXStaticText = "Lumir 0.10.0" @10,10 100×20' }),
    axText({ snapshotId: "BBBB", nodeLine: '- [8] AXStaticText = "Lumir 0.10.1" @10,10 100×20' }),
  ]);
  await assert.rejects(
    settle(cu, 0, { timeoutMs: 800 }),
    (e) => e instanceof StepError && /未稳定/.test(e.message),
    "节点行变化必须判未稳定（否则断言被放宽成恒真）",
  );
  assert.ok(cu.reads.length >= 2, `要到第二次读取才可能发现不一致，实际只读了 ${cu.reads.length} 次`);
});

test("settle：element_count / truncated 变化 ⇒ 仍判未稳定（header 事实仍参与逐字节比较）", async () => {
  const countCu = fakeCu([
    axText({ snapshotId: "AAAA", elementCount: 4 }),
    axText({ snapshotId: "BBBB", elementCount: 5 }),
  ]);
  await assert.rejects(
    settle(countCu, 0, { timeoutMs: 800 }),
    (e) => e instanceof StepError,
    "element_count 变化必须判未稳定",
  );

  const truncatedCu = fakeCu([
    axText({ snapshotId: "AAAA", truncated: "false" }),
    axText({ snapshotId: "BBBB", truncated: "true [closed_menu]" }),
  ]);
  await assert.rejects(
    settle(truncatedCu, 0, { timeoutMs: 800 }),
    (e) => e instanceof StepError,
    "truncated 变化必须判未稳定",
  );
});

test("settle：正文恒定但 AX 里没有 AXTextArea ⇒ 编辑器门不放宽，仍判未稳定", async () => {
  const cu = fakeCu([axText({ snapshotId: "AAAA", editor: false }), axText({ snapshotId: "BBBB", editor: false })]);
  await assert.rejects(
    settle(cu, 0, { timeoutMs: 800 }),
    (e) => e instanceof StepError && /未稳定/.test(e.message),
    "无编辑器节点时 settle 不得因正文一致就返回（编辑器门是既有合同）",
  );
  assert.ok(cu.reads.length >= 2, "编辑器门不成立时要继续轮询，实际只读了一次");
});
