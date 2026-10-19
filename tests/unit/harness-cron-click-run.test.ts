// cron 点击发起运行时面板切屏的结构断言（M612，场景 170 红因）。
//
// 这条缺陷的位置在装配层与面板之间，判据是「上游有没有先打开轮次闸门」这类**调用顺序**，
// 不是某个纯函数的返回值——零 DOM 单测跑不起 createHarnessPanel（见 tests/unit/README.md），
// 因此这里对两份源码做结构对账（与 harness-event-whitelist.test.ts 同一层、同一理由）：
//   1. `handleCronRun` 的交互分支必须在 `invoke("harness_cron_run")` **之前**调用面板的
//      切屏入口——后端不为 cron 回合发 `sent` / `auto_turn_started`，闸门晚开会把先到的
//      正文分片当「已结束轮次的迟到产出」丢掉；
//   2. 切屏入口必须清渲染面、prompt 上屏、开闸门（turnOpen / 发送相位）；
//   3. 回合收尾（done）后必须按后端快照重载一次——专用会话（dedicated）的历史因此回屏，
//      面板内容回到后端的单一真源。
// 真机层的行为判据在验收场景 170（`.local/acceptance/2026-10-19-m612/`）；本层只钉接线。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MAIN_SOURCE = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");
const PANEL_SOURCE = readFileSync(new URL("../../src/harness-panel.ts", import.meta.url), "utf8");

/** 取 `function <name>(...)...{` 之后配对到右花括号的函数体（含声明行）。 */
function functionBodyOf(source: string, name: string): string {
  const header = new RegExp(`function ${name}\\(`);
  const match = header.exec(source);
  if (match === null) throw new Error(`源码里找不到 function ${name}(`);
  const open = source.indexOf("{", match.index);
  if (open === -1) throw new Error(`function ${name} 找不到函数体起点`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, i + 1);
    }
  }
  throw new Error(`function ${name} 的花括号没有配对`);
}

const HANDLE_CRON_RUN = functionBodyOf(MAIN_SOURCE, "handleCronRun");
const BEGIN_CRON_RUN = functionBodyOf(PANEL_SOURCE, "beginCronRun");

// ── 装配层：交互槽位的切屏发生在后端运行被请求之前 ─────────────────────────

test("handleCronRun：交互槽位在 invoke 之前切屏（闸门先开，首段正文不被丢弃）", () => {
  const adopt = HANDLE_CRON_RUN.search(/harnessPanel\.beginCronRun\(/);
  assert.notEqual(adopt, -1, "交互槽位必须调用面板的 beginCronRun（点击运行 = 面板切到该次运行）");
  const invoke = HANDLE_CRON_RUN.search(/await invoke\("harness_cron_run"/);
  assert.notEqual(invoke, -1, "handleCronRun 必须仍经 harness_cron_run 起运行");
  assert.ok(
    adopt < invoke,
    "beginCronRun 必须排在 invoke(\"harness_cron_run\") 之前：后端不为 cron 回合发 sent / auto_turn_started，闸门晚开会把先到的分片丢掉",
  );
});

test("handleCronRun：发起失败回滚面板到后端当前会话（不留在乐观切屏态）", () => {
  const catchStart = HANDLE_CRON_RUN.search(/catch \(error\)/);
  assert.notEqual(catchStart, -1, "handleCronRun 必须有 catch 分支");
  assert.ok(
    HANDLE_CRON_RUN.indexOf("harnessPanel.reloadSession()", catchStart) !== -1,
    "发起失败必须调用 reloadSession() 撤回 beginCronRun 的乐观切屏",
  );
});

// ── 面板：切屏入口的判据 ───────────────────────────────────────────────────

test("beginCronRun：清渲染面 + prompt 上屏 + 开轮次闸门与发送相位", () => {
  assert.match(BEGIN_CRON_RUN, /resetView\(\)/, "切屏必须先清空上一段会话的渲染面");
  assert.match(BEGIN_CRON_RUN, /appendUserMessage\(/, "prompt 必须作为本轮用户消息上屏");
  assert.match(BEGIN_CRON_RUN, /turnOpen = true/, "轮次闸门必须打开（否则正文分片被当作迟到产出丢弃）");
  assert.match(
    BEGIN_CRON_RUN,
    /applySendPhase\(reduceSendPhase\(sendPhase, \{ type: "sent" \}\)\)/,
    "发送相位必须入 running（发送钮 = 停止态，进程内不允许再叠一轮）",
  );
  assert.match(BEGIN_CRON_RUN, /cronRunAdopted = true/, "切屏态必须登记，收尾时据此重载快照");
});

test("done 收尾：cron 切屏态下按后端快照重载（专用会话历史回屏，面板回到单一真源）", () => {
  const doneStart = PANEL_SOURCE.search(/case "done":/);
  assert.notEqual(doneStart, -1, "handleEvent 里找不到 done 分支");
  const doneEnd = PANEL_SOURCE.indexOf('case "aborted":', doneStart);
  assert.notEqual(doneEnd, -1, "done 分支之后找不到 aborted 分支（解析口径已过期）");
  const doneBody = PANEL_SOURCE.slice(doneStart, doneEnd);
  assert.match(doneBody, /if \(cronRunAdopted\) reloadSession\(\);/, "done 后必须按 cronRunAdopted 重载快照");
});
