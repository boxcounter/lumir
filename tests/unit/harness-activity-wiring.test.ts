// 活动记录的**接线层**结构对账（change add-harness-activity-presence tasks 5.2 ×
// change extend-harness-activity-across-vaults-nov23 tasks 1.2）。
//
// 这一层判的是「面板有没有按合同接上纯模型」（按 vault 记账、记账在 vault 过滤 / 轮次闸门之前、
// 显示门的三条入口、发送 / 停止 / 四类异步动作按发起 vault 收口、无通用 retain、三态唯一施加点），
// 不是 store 的返回值——零 DOM 单测跑不起 `createHarnessPanel`（见 tests/unit/README.md），
// 因此对源码做结构对账；**行为竞态由 deferred Promise 在真实 DOM 里判**
// （`tests/visual/scenes/harness-vault-activity.spec.ts`），本文件只能作补充（design §14.3）。
//
// 反向纪律（REVIEW.md「断言等价于子串」条）：每条断言都要能对「实现退回旧形态」判红——
// 注释里点名的那种旧写法就是它的反例输入。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PANEL_SOURCE = readFileSync(new URL("../../src/harness-panel.ts", import.meta.url), "utf8");
const MAIN_SOURCE = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");
const ACTIVITY_SOURCE = readFileSync(new URL("../../src/harness-activity.ts", import.meta.url), "utf8");
const SWITCHER_SOURCE = readFileSync(new URL("../../src/vault-switcher.ts", import.meta.url), "utf8");
const PANEL_CSS = readFileSync(new URL("../../src/harness-panel.css", import.meta.url), "utf8");
const STYLE_CSS = readFileSync(new URL("../../src/style.css", import.meta.url), "utf8");

/** `assert.doesNotMatch` 在本仓钉的 @types/node 档里没有声明（运行时存在、类型面缺）——
 *  用同一个语义的本地断言替代：不给 tsconfig 打补丁，也不改 `skipLibCheck`。 */
function assertNoMatch(source: string, pattern: RegExp, message: string): void {
  assert.ok(!pattern.test(source), message);
}

/** 去掉行注释与块注释后的代码（断言「某机制已删除」时不能把文档里的点名当成实现）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** 取 `function <name>(...)...{` 之后配对到右花括号的函数体（含声明行）。
 *  参数表里可能有对象类型字面量（`options: { ... }`），因此先配对括号、再找函数体的 `{`。 */
function functionBodyOf(source: string, name: string): string {
  const header = new RegExp(`function ${name}\\(`);
  const match = header.exec(source);
  if (match === null) throw new Error(`源码里找不到 function ${name}(`);
  let parens = 0;
  let afterParams = -1;
  for (let i = source.indexOf("(", match.index); i < source.length; i += 1) {
    if (source[i] === "(") parens += 1;
    else if (source[i] === ")") {
      parens -= 1;
      if (parens === 0) {
        afterParams = i;
        break;
      }
    }
  }
  if (afterParams === -1) throw new Error(`function ${name} 的括号没有配对`);
  const open = source.indexOf("{", afterParams);
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

/** 取 `case "<label>":` 到下一个同级 `case` / `default:` 之间的分支体。 */
function switchCaseOf(source: string, label: string): string {
  const start = source.indexOf(`case "${label}":`);
  if (start === -1) throw new Error(`源码里找不到 case "${label}":`);
  const next = source.slice(start + 1).search(/\n\s{6}(case "|default:)/);
  assert.notEqual(next, -1, `case "${label}" 之后找不到下一个分支`);
  return source.slice(start, start + 1 + next);
}

const ACCOUNT = functionBodyOf(PANEL_SOURCE, "accountActivity");
const ACCOUNT_OF = functionBodyOf(PANEL_SOURCE, "accountEventOf");
const PROJECT = functionBodyOf(PANEL_SOURCE, "projectActivity");
const DISPATCH = functionBodyOf(PANEL_SOURCE, "dispatchActivity");
const RENDER = functionBodyOf(PANEL_SOURCE, "renderActivity");
const CURRENT = functionBodyOf(PANEL_SOURCE, "currentActivity");
const APPLY_ENTER = functionBodyOf(PANEL_SOURCE, "applyEnterSnapshot");
const RESTORE = functionBodyOf(PANEL_SOURCE, "restoreSnapshot");
const FETCH = functionBodyOf(PANEL_SOURCE, "fetchSnapshot");
const ATTACH = functionBodyOf(PANEL_SOURCE, "attachTo");
const BADGE = functionBodyOf(PANEL_SOURCE, "applyActivityBadge");
/** 取 `let <name>: ... = () => { ... }` 箭头函数字段的函数体（含声明行）。 */
function arrowBodyOf(source: string, name: string): string {
  const start = source.indexOf(`let ${name}:`);
  if (start === -1) throw new Error(`源码里找不到 let ${name}:`);
  const open = source.indexOf("=> {", start);
  if (open === -1) throw new Error(`let ${name} 不是块体箭头函数`);
  let depth = 0;
  for (let i = open + 3; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`let ${name} 的花括号没有配对`);
}

/** 取 `private <name>(...)...{` 方法体（含声明行）。 */
function methodBodyOf(source: string, name: string): string {
  const header = new RegExp(`private ${name}\\(`);
  const match = header.exec(source);
  if (match === null) throw new Error(`源码里找不到 private ${name}(`);
  let parens = 0;
  let afterParams = -1;
  for (let i = source.indexOf("(", match.index); i < source.length; i += 1) {
    if (source[i] === "(") parens += 1;
    else if (source[i] === ")") {
      parens -= 1;
      if (parens === 0) {
        afterParams = i;
        break;
      }
    }
  }
  if (afterParams === -1) throw new Error(`private ${name} 的括号没有配对`);
  const open = source.indexOf("{", afterParams);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, i + 1);
    }
  }
  throw new Error(`private ${name} 的花括号没有配对`);
}

const HANDLE = functionBodyOf(PANEL_SOURCE, "handleEvent");
const SEND = functionBodyOf(PANEL_SOURCE, "performSend");
const RESET = functionBodyOf(PANEL_SOURCE, "resetView");
const VAULT_CHANGED = functionBodyOf(PANEL_SOURCE, "vaultChanged");
const PANE_SETTLED = functionBodyOf(PANEL_SOURCE, "paneSettled");
const NEW_SESSION = functionBodyOf(PANEL_SOURCE, "startNewSession");
const RESUME = functionBodyOf(PANEL_SOURCE, "resumeSession");
const CRON_RUN = functionBodyOf(PANEL_SOURCE, "beginCronRun");
const RELOAD = functionBodyOf(PANEL_SOURCE, "reloadTargetSession");
const APPLY_LAYOUT = functionBodyOf(MAIN_SOURCE, "applyStoredLayout");
const CRON_OPEN = functionBodyOf(MAIN_SOURCE, "handleCronOpenSession");
const CRON_HANDLER = functionBodyOf(MAIN_SOURCE, "handleCronRun");
const BEGIN_RETRY = functionBodyOf(PANEL_SOURCE, "beginRetry");
const STOP_HANDLER = arrowBodyOf(PANEL_SOURCE, "stopHandler");
const REFRESH_ACTIVITY = methodBodyOf(SWITCHER_SOURCE, "refreshActivity");

// ── 1. 相位只有一个写入口，状态机的每次跃迁都经 store ─────────────────────────

test("相位写入：applySendPhase 只落 DOM（函数体里不得回写相位）", () => {
  const apply = functionBodyOf(PANEL_SOURCE, "applySendPhase");
  assertNoMatch(apply, /activity\.\w+\s*=/, "applySendPhase 必须只落 DOM：回写记录会让状态机出现第二个持有者（r1 P2-2 现场）");
  assertNoMatch(apply, /renderedPhase\s*=/, "相位投影基准只在 renderActivity 里推进");
});

test("相位写入：除 renderActivity 外没有第二处调 applySendPhase 做跃迁", () => {
  // 允许的两类：renderActivity 内的 `applySendPhase(state.phase)`，以及 applyLabels 的
  // 重取文案（同一相位重绘 DOM，不是跃迁）。其余调用点都算第二写入口。
  const calls = [...PANEL_SOURCE.matchAll(/applySendPhase\((?!state\.phase\)|renderedPhase\)|next:)/g)];
  assert.deepEqual(
    calls.map((m) => m.index),
    [],
    "只允许 renderActivity(state.phase) 与 applyLabels(renderedPhase) 两处",
  );
  assert.match(RENDER, /applySendPhase\(state\.phase\)/, "唯一跃迁落 DOM 点在 renderActivity");
});

test("相位写入：旧的 reduceSendPhase(...) 直调没有残留在面板里（跃迁只经模型）", () => {
  assertNoMatch(PANEL_SOURCE, /applySendPhase\(reduceSendPhase\(/, "面板不得再自己推相位（stopping 会有两个持有者）");
});

test("记录写入：store 的 dispatch 只在 accountActivity 里调（单一写入口）", () => {
  const dispatches = [...stripComments(PANEL_SOURCE).matchAll(/activity\.dispatch\(/g)];
  assert.equal(dispatches.length, 1, `activity.dispatch 只能有一个写点（实际 ${dispatches.length} 处）`);
  assert.match(ACCOUNT, /activity\.dispatch\(vault, event\)/, "写点必须在 accountActivity 里");
  assert.match(DISPATCH, /projectActivity\(vault, event, accountActivity\(vault, event\)\)/, "dispatchActivity = 记账 + 投影");
});

test("记录写入：模型里没有第二套相位状态机（export 面只有 reduceActivity / store / 判据辅助）", () => {
  const exports = [...ACTIVITY_SOURCE.matchAll(/export function (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(exports.sort(), [
    "activityDisplayed",
    "activityKind",
    "activityStatusKey",
    "createVaultActivityStore",
    "enterSnapshotApplies",
    "reduceActivity",
  ], "新增导出只能是 store 与共用的判据 / 取值辅助");
});

// ── 2. 记账前置于 vault 过滤与轮次闸门（本 change 的核心接线）─────────────────

test("handleEvent：记录步骤在 vault 过滤与轮次闸门**之前**", () => {
  const account = HANDLE.indexOf("accountEventOf(event, vault)");
  const accountCall = HANDLE.indexOf("accountActivity(vault, accounted)");
  const filter = HANDLE.indexOf("inCurrentVault(event.vault, currentVault)");
  const gate = HANDLE.indexOf("GATED_EVENT_TYPES.has(event.type)");
  assert.notEqual(account, -1, "必须解析记账输入");
  assert.notEqual(accountCall, -1, "必须先写记录");
  assert.notEqual(filter, -1, "vault 过滤仍在");
  assert.notEqual(gate, -1, "轮次闸门仍在");
  assert.ok(accountCall < filter, "记账必须在 vault 过滤之前（否则跨 vault 终态在这里就丢了）");
  assert.ok(accountCall < gate, "记账必须在轮次闸门之前（终态不受闸门管控）");
});

test("handleEvent：跨 vault 的记录到此为止（projectActivity 首行按 vault 早退）", () => {
  assert.match(PROJECT, /if \(vault !== currentVault\) return;/, "别的 vault 的事件 MUST NOT 碰当前视图的闸门 / DOM");
  // 反向：`handleEvent` 的两个投影点都在 vault 过滤之后（当前 vault 才投影）。
  const filter = HANDLE.indexOf("inCurrentVault(event.vault, currentVault)");
  const firstProject = HANDLE.indexOf("projectActivity(vault, accounted, prevActivity)");
  assert.ok(firstProject > filter, "投影只可能发生在当前 vault 分支里");
});

test("accountEventOf：三类终态与 auto_turn_started 是唯一的记账输入，终态带 displayed", () => {
  for (const kind of ["done", "error", "aborted"]) {
    assert.match(ACCOUNT_OF, new RegExp(`case "${kind}":`), `${kind} 必须进记录`);
  }
  assert.match(ACCOUNT_OF, /type: "terminal"/, "终态映射到 terminal");
  assert.match(ACCOUNT_OF, /displayed: activityDisplayed\(vault, currentVault, panePresent\)/, "displayed 走单一辅助（当前 + 在场）");
  assert.match(ACCOUNT_OF, /case "auto_turn_started":[\s\S]{0,120}type: "turn_started"/, "自动回合记成 turn_started");
  // notice / text_chunk / tool_* / approval 不产生记录（default 返回 null）。
  assert.match(ACCOUNT_OF, /default:\s*\n\s*return null;/, "其余事件不改记录");
});

// ── 3. 进入快照：显式档位、按 in_flight 回填、世代守卫 ─────────────────────

test("restoreSnapshot：档位是必填参数，没有默认值（杜绝「走了完整恢复却只想重建内容」）", () => {
  const header = /function restoreSnapshot\(([^)]*)\)/.exec(PANEL_SOURCE);
  assert.ok(header !== null, "找不到 restoreSnapshot 的声明");
  const params = header[1];
  assert.match(params, /mode:\s*"enter"\s*\|\s*"content"/, "档位必须显式声明为两档联合");
  assertNoMatch(params, /mode[^,)]*=/, "档位 MUST NOT 有默认值");
  assert.match(params, /epochAtRequest:\s*number/, "进入档位还要带上请求时的相位世代");
});

test("restoreSnapshot：in_flight 只在进入档位被读（对账档连读都不读）", () => {
  const guard = RESTORE.indexOf('if (mode === "enter")');
  assert.notEqual(guard, -1, "restoreSnapshot 必须按档位分流");
  const readsInFlight = [...RESTORE.matchAll(/in_flight/g)].map((m) => m.index ?? 0);
  assert.ok(readsInFlight.length > 0, "进入档位必须读 in_flight");
  const applyCall = RESTORE.indexOf("applyEnterSnapshot(");
  assert.ok(applyCall > guard, "applyEnterSnapshot 必须落在档位守卫之内");
  // 全文件里 in_flight 的读取点只有四处：restoreSnapshot 的进入分支、applyEnterSnapshot、
  // 恢复会话时点的只读相位取数（`fetchActivitySnapshot`），以及重试同步拒绝后的轻量快照
  // （`fetchRetrySnapshot`）——对账路径（content 档）不读它。
  const fetchActivity = functionBodyOf(PANEL_SOURCE, "fetchActivitySnapshot");
  const fetchRetry = functionBodyOf(PANEL_SOURCE, "fetchRetrySnapshot");
  const allowed = [RESTORE, APPLY_ENTER, fetchActivity, fetchRetry].map((body) => ({
    start: PANEL_SOURCE.indexOf(body),
    end: PANEL_SOURCE.indexOf(body) + body.length,
  }));
  const elsewhere = [...PANEL_SOURCE.matchAll(/\.in_flight\b|\["in_flight"\]/g)].map((m) => m.index ?? 0);
  for (const index of elsewhere) {
    const inside = allowed.some((range) => index >= range.start && index < range.end);
    assert.ok(inside, `in_flight 出现越界读取（位置 ${index}）：对账路径不得读它`);
  }
});

test("恢复会话也是进入时点：只读相位、不重放内容", () => {
  assert.match(RESUME, /fetchActivitySnapshot\(\)/, "恢复会话后必须按快照的 in_flight 回填相位");
  const phaseOnly = functionBodyOf(PANEL_SOURCE, "fetchActivitySnapshot");
  assert.match(phaseOnly, /applyEnterSnapshot\(state\.in_flight/, "只读相位也必须走同一个状态机入口");
  assertNoMatch(phaseOnly, /renderSnapshotMessages/, "内容已由恢复回执铺开，MUST NOT 再重放一遍");
  assert.match(functionBodyOf(PANEL_SOURCE, "restoreSnapshot"), /parseSnapshot\(json\)/, "全量恢复同一份解析");
});

test("对账档位必须带世代守卫：请求之后已开始新一轮 ⇒ 整条丢弃", () => {
  const contentBranch = RESTORE.slice(RESTORE.indexOf('} else {'));
  const guard = contentBranch.search(/if \(epochAtRequest !== phaseEpoch\) return;/);
  assert.notEqual(guard, -1, "内容档必须在清面前丢弃过期回包");
  const clear = contentBranch.search(/clearTranscriptSurface\(\)/);
  assert.ok(guard < clear, "守卫必须排在清渲染面**之前**（清完再判就晚了）");
});

test("对账档位：清渲染面 + 不拽视口；进入档位才强制回底", () => {
  const contentBranch = RESTORE.slice(RESTORE.indexOf("clearTranscriptSurface()"));
  assert.notEqual(contentBranch.length, 0, "对账档位必须清渲染面");
  assertNoMatch(RESTORE, /resetView\(\)/, "对账档位 MUST NOT 复用 resetView（会顺手复位相位与未读）");
  assert.match(RESTORE, /mode === "enter"[\s\S]{0,200}follow\.jumpToBottom\(\)/, "进入档位强制回底");
  assert.match(RESTORE, /follow\.contentGrew\(\)/, "对账档位按既有跟随态决定滚动位");
});

test("applyEnterSnapshot：缺键（旧后端）整条不应用，不伪造在途", () => {
  assert.match(APPLY_ENTER, /typeof rawInFlight !== "boolean"/, "缺键必须是「不应用」，MUST NOT 当成 false 或 true");
  assert.match(APPLY_ENTER, /type: "enter_snapshot"/, "进入快照必须经状态机（相位唯一投影）");
  assert.match(APPLY_ENTER, /dispatchActivity\(currentVault,/, "快照只服务当前 vault（非当前 vault 无快照可读）");
});

test("fetchSnapshot：请求时记下 phaseEpoch，并把它交给 restoreSnapshot", () => {
  assert.match(FETCH, /const epoch = phaseEpoch/, "发起请求时必须记下当时的世代");
  assert.match(FETCH, /restoreSnapshot\(json, mode, epoch, eventMark\)/, "响应必须带上请求时的世代与 persistence 事件序号");
  assert.match(FETCH, /mode: "enter" \| "content" = "enter"/, "默认档位是进入（心跳 / 挂载 / 切 vault）");
});

// ── 4. 闸门 / 接管标志的单一施加点 ─────────────────────────────────────────

test("projectActivity：turnOpen 与 midTakeover 只在这里写（含进入快照的收口语义）", () => {
  assert.match(PROJECT, /case "enter_snapshot":/, "进入快照必须在这一处施加闸门");
  assert.match(PROJECT, /enterSnapshotApplies\(prev, event\)/, "判据必须与模型同源");
  assert.match(PROJECT, /turnOpen = event\.inFlight/, "闸门与相位同源恢复");
  assert.match(PROJECT, /midTakeover = event\.inFlight/, "接管标志同源置位 / 清除");
  for (const line of HANDLE.split("\n")) {
    assertNoMatch(line, /turnOpen\s*=[^=]/, `handleEvent 里出现第二处 turnOpen 写入：${line}`);
    assertNoMatch(line, /midTakeover\s*=[^=]/, `handleEvent 里出现第二处 midTakeover 写入：${line}`);
  }
});

test("projectActivity：非快照的相位跃迁推进世代；终态一律推进；快照回填不推进", () => {
  assert.match(PROJECT, /event\.type !== "enter_snapshot"/, "快照回填不作废自己这一代");
  assert.match(PROJECT, /next\.phase !== prev\.phase \|\| event\.type === "terminal"/, "终态即使相位已是 idle 也推进世代（拒绝回滚后的终态不能放行旧快照）");
});

test("终态对账：只在「中途接管」/ cron 收尾时做，且走内容档位", () => {
  const takeoverReads = [...HANDLE.matchAll(/const takeover = midTakeover;/g)];
  assert.equal(takeoverReads.length, 3, "三类终态都要在投影前记住接管标志（投影会清它）");
  for (const kind of ["error", "aborted"]) {
    const block = switchCaseOf(HANDLE, kind);
    assert.match(block, /if \(takeover\) fetchSnapshot\("content"\)/, `${kind} 分支的对账必须走内容档位`);
  }
  const done = switchCaseOf(HANDLE, "done");
  assert.match(done, /const adopted = cronRunAdopted;/, "done 必须在投影前记住 cron 切屏态");
  assert.match(done, /if \(takeover \|\| adopted\) fetchSnapshot\("content"\)/, "两种理由合并成一次内容重建");
  assertNoMatch(done, /reloadSession\(\)/, "cron 收尾不得走会清未读的会话复位路径");
  const contentCalls = stripComments(PANEL_SOURCE).match(/fetchSnapshot\("content"\)/g) ?? [];
  assert.equal(contentCalls.length, 3, `内容档调用只允许出现在 done / error / aborted 三条终态里（实际 ${contentCalls.length} 处）`);
  assert.match(MAIN_SOURCE, /harnessPanel\.reloadSession\(adopted\)/, "发起失败的回滚通道仍须存在（带目标与令牌）");
});

test("终态投影排在收口现场之后（takeover 读在投影之前）", () => {
  for (const kind of ["done", "error", "aborted"]) {
    const block = switchCaseOf(HANDLE, kind);
    const read = block.indexOf("const takeover = midTakeover");
    const project = block.indexOf("projectActivity(vault, accounted, prevActivity)");
    assert.notEqual(read, -1, `${kind} 必须先记住接管标志`);
    assert.notEqual(project, -1, `${kind} 必须投影到当前视图`);
    assert.ok(read < project, `${kind} 的投影会清接管标志：读必须在前`);
  }
});

// ── 5. 发送 / 停止 / 拒绝：按发起 vault 收口 ───────────────────────────────

test("harness_busy：回滚乐观气泡 + 上错误行 + 读一次相位（只读通道），MUST NOT 直接改相位", () => {
  const busyBranchStart = SEND.indexOf('if (errorCodeOf(e) === "harness_busy")');
  assert.notEqual(busyBranchStart, -1, "send 的 catch 必须有 harness_busy 的专属处置");
  const branch = SEND.slice(busyBranchStart, SEND.indexOf("return;", busyBranchStart));
  assert.match(branch, /rollbackRejectedSend\(/, "忙拒绝要撤销本次乐观上屏并恢复输入区");
  assert.match(branch, /appendError\(/, "拒绝要如实上错误行");
  assert.match(branch, /fetchActivitySnapshot\(\)/, "拒绝的处置是再问一次权威的**相位**，不是本地猜");
  assertNoMatch(branch, /fetchSnapshot\(/, "MUST NOT 走进入档全量恢复（会重复消息 + 强制回底）");
  assertNoMatch(branch, /dispatchActivity|applySendPhase/, "拒绝不得作为在途证据：这里 MUST NOT 改相位");
});

test("发送：发送时定格 sendVault + 乐观令牌；同步拒绝先无条件 rollback 再走视图守卫", () => {
  assert.match(SEND, /const sendVault = currentVault;/, "发送时定格 vault（迟到拒绝只收口它）");
  assert.match(SEND, /beginSendActivity\(sendVault\)/, "乐观起点走 store 的 beginSend（带版本门）");
  const rollback = SEND.indexOf("activity.rollbackSend(sendVault, sendToken)");
  const guard = SEND.indexOf("viewGeneration !== sendViewGeneration");
  assert.notEqual(rollback, -1, "同步拒绝必须撤销乐观起点");
  assert.notEqual(guard, -1, "视图世代守卫仍在");
  assert.ok(rollback < guard, "撤销必须排在视图守卫**之前**（切走后 A 不能永久停在在途）");
  assert.match(SEND, /if \(restored && sendVault === currentVault\)/, "只有在撤销生效且仍是当前视图时才动本视图的闸门");
  // 反向：本地收口不再走「无条件 local_finish」（那会拿拒绝去改写真实新轮）。
  assertNoMatch(stripComments(SEND), /local_finish/, "local_finish 不得作为拒绝的统一出口复活");
});

test("同步拒绝（非忙 / 非能力闸）：统一回滚 + D347 错误行", () => {
  const tail = SEND.slice(SEND.indexOf("return;", SEND.indexOf('if (errorCodeOf(e) === "harness_busy")')));
  assert.match(tail, /if \(errorCodeOf\(e\) === "harness_image_unsupported"\)/, "能力闸保留专属出口（卡片错误态 + toast）");
  const rollbacks = tail.match(/rollbackRejectedSend\(/g) ?? [];
  assert.equal(rollbacks.length, 2, "能力闸与其后的一般拒绝都走同一份回滚（各一处）");
  assert.match(tail, /deps\.toast\(errorText\(e\)\)/, "能力闸的人话出口是 toast");
  assert.match(tail, /appendError\(t\("D347", \{ reason: errorText\(e\) \}\)\)/, "其余同步拒绝保留 D347 错误行");
});

test("停止：点击定格 vault 与世代，拒绝时只对停止时那一轮收口、错误行只写回发起视图", () => {
  assert.match(
    PANEL_SOURCE,
    /dispatchActivity\(currentVault, \{ type: "stop_clicked" \}\);\s*\n\s*stopHandler\?\.\(\);/,
    "停止路径必须「状态机先行（挡连点）再调停止钩子」，且记到点击时的 vault",
  );
  assert.match(STOP_HANDLER, /const stopVault = currentVault;/, "点击时同步定格 vault");
  assert.match(STOP_HANDLER, /const stopViewGeneration = viewGeneration;/, "点击时同步定格视图世代");
  assert.match(STOP_HANDLER, /activity\.finishIfStopping\(stopVault\)/, "拒绝只收口仍为 stopping 的那一轮");
  const settle = STOP_HANDLER.indexOf("activity.finishIfStopping(stopVault)");
  const guard = STOP_HANDLER.indexOf("stopViewGeneration !== viewGeneration");
  assert.ok(settle < guard, "记录收口排在视图守卫之前；错误行才受世代守卫");
});

test("停止：发送钮的点击路由读当前 vault 的记录（不读局部副本）", () => {
  assert.match(PANEL_SOURCE, /if \(currentActivity\(\)\.phase !== "running"\) return;/, "停止路由按记录判相位");
  assert.match(PANEL_SOURCE, /if \(currentActivity\(\)\.phase === "idle"\) send\(\);/, "发送路由按记录判相位");
});

test("重试拒绝：当前视图不本地收口/不关闸；非当前才按发起 vault 撤销乐观起点", () => {
  assert.match(BEGIN_RETRY, /const retryVault = currentVault;/, "点击时定格 vault");
  assert.match(BEGIN_RETRY, /beginSendActivity\(retryVault\)/, "乐观起点走同一条 beginSend 令牌通道");
  assert.match(
    BEGIN_RETRY,
    /const stale = retryVault !== currentVault \|\| viewGeneration !== generation;/,
    "先判定是否已经不在发起视图",
  );
  // 当前视图：busy 的真实分片要继续上屏 ⇒ 拒绝路径 MUST NOT 写轮次闸门 / 重绘视图。
  assertNoMatch(BEGIN_RETRY, /turnOpen\s*=/, "拒绝路径不得改轮次闸门（busy 的分片会被闸门丢弃）");
  assertNoMatch(BEGIN_RETRY, /midTakeover\s*=/, "拒绝路径不得改接管标志");
  assertNoMatch(BEGIN_RETRY, /renderActivity\(/, "当前视图的相位由权威快照恢复，拒绝路径不重绘");
  // 非当前：只按发起 vault 撤销乐观起点，然后早退（不写 B 的错误行、不请 B 的快照）。
  assert.match(
    BEGIN_RETRY,
    /if \(stale\) \{\s*if \(retryVault !== null && retryToken !== null\) \{\s*activity\.rollbackSend\(retryVault, retryToken\);/,
    "非当前按发起 vault 回滚",
  );
  const stale = BEGIN_RETRY.indexOf("if (stale)");
  const rollback = BEGIN_RETRY.indexOf("activity.rollbackSend(retryVault, retryToken)");
  const append = BEGIN_RETRY.indexOf("appendError(");
  assert.ok(stale !== -1 && rollback > stale && append > rollback, "回滚在 stale 分支内、早于错误行");
});

test("自动回合：auto_turn_started 记账后投影（闸门先开，首段分片不被丢弃）", () => {
  assert.match(ACCOUNT_OF, /case "auto_turn_started":[\s\S]{0,120}type: "turn_started"/, "自动回合进记录");
  const block = switchCaseOf(HANDLE, "auto_turn_started");
  assert.match(block, /projectActivity\(vault, accounted, prevActivity\)/, "自动回合的投影在 case 内（闸门先开）");
});

// ── 6. 收起 / 打开 / 显示门 ────────────────────────────────────────────────

test("attachTo(null)：收起 ≠ 复位——不清相位、不清未读，只把显示门置假", () => {
  const detachStart = ATTACH.indexOf("} else {");
  assert.notEqual(detachStart, -1, "attachTo 必须有摘下分支");
  const detach = ATTACH.slice(detachStart);
  assertNoMatch(detach, /applySendPhase|dispatchActivity|activity\.reset|activity\.drop/, "摘下 DOM 不得碰活动记录");
  assert.match(ATTACH, /panePresent = mount !== null;/, "显示门与挂载态同源");
});

test("attachTo(mount)：打开面板经显式 displayed（已读清算的入口之一）", () => {
  assert.match(ATTACH, /dispatchActivity\(currentVault, \{ type: "displayed" \}\)/, "挂载即已读");
  assertNoMatch(ATTACH, /type: "opened"/, "旧事件名不得残留");
});

test("paneSettled：布局落定信号只置门 + 为真时派发 displayed（幂等）", () => {
  assert.match(PANE_SETTLED, /panePresent = present;/, "门由落定信号施加");
  assert.match(PANE_SETTLED, /if \(present\) dispatchActivity\(currentVault, \{ type: "displayed" \}\)/, "在场即清算当前 vault");
  assertNoMatch(PANE_SETTLED, /activity\.reset|activity\.drop/, "落定信号不得清任何记录（未读由 displayed 清、只清当前 vault）");
});

test("applyStoredLayout：两条分支的末尾都发 paneSettled（已是目标形态也发）", () => {
  const signal = APPLY_LAYOUT.indexOf("harnessPanel.paneSettled(");
  const chrome = APPLY_LAYOUT.indexOf("applySplitChrome()");
  const sync = APPLY_LAYOUT.indexOf("syncActiveDocument()");
  assert.notEqual(signal, -1, "applyStoredLayout 必须发落定信号");
  assert.ok(chrome < signal && sync < signal, "信号排在 applySplitChrome / syncActiveDocument 之后（布局已落定）");
  // 信号在 if/else 之外（两条分支共用同一处收尾）：断言缩进层级——它不在任何 `if (harnessPane)` 体内。
  const elseStart = APPLY_LAYOUT.indexOf("} else {");
  assert.ok(signal > elseStart, "信号在 if/else 之后（两条分支都发）");
  assert.match(APPLY_LAYOUT, /paneLayout\.panes\(\)\.some\(\(pane\) => pane\.handle\.kind === "harness"\)/, "在场判据与 layout 同源");
});

// ── 7. resetView 矩阵：清哪个 vault / 不清 ─────────────────────────────────

test("resetView：签名显式要求 clearActivityFor，未读不清的档必须是 null", () => {
  const header = /function resetView\((options[^)]*)\)/.exec(PANEL_SOURCE);
  assert.ok(header !== null, "resetView 必须接收 options");
  assert.match(header[1], /clearActivityFor: string \| null/, "clearActivityFor 是必填字段（没有默认值）");
  assert.match(RESET, /dispatchActivity\(options\.clearActivityFor, \{ type: "reset_view" \}\)/, "记录复位只作用于目标 vault");
  assert.match(RESET, /options\.clearActivityFor === null \|\| options\.clearActivityFor !== currentVault/, "非当前目标只收口当前视图的投影，不动记录");
});

test("resetView 调用点矩阵：切 vault = null；换会话 = 动作发起时的 vault", () => {
  assert.match(VAULT_CHANGED, /resetView\(\{ clearActivityFor: null \}\)/, "切 vault 不清任何记录（未读保留）");
  assert.match(NEW_SESSION, /resetView\(\{ clearActivityFor: actionVault \}\)/, "新会话清发起 vault");
  assert.match(RESUME, /resetView\(\{ clearActivityFor: actionVault \}\)/, "恢复会话清发起 vault");
  assert.match(CRON_RUN, /resetView\(\{ clearActivityFor: cronVault \}\)/, "cron 切屏清目标 vault");
  assert.match(RELOAD, /resetView\(\{ clearActivityFor: null \}\)/, "cron 回滚的记录已在 reloadTargetSession 里清过，视图复位不再重复清");
  // 五处之外没有其他调用点（防止新路径绕过矩阵）。
  const calls = [...stripComments(PANEL_SOURCE).matchAll(/resetView\(\{/g)];
  assert.equal(calls.length, 5, `resetView 只允许这五个调用点（实际 ${calls.length} 处）`);
});

test("新会话 / 恢复：回包迟到时只清发起 vault，且不重建 B 的视图", () => {
  for (const [name, body] of [["startNewSession", NEW_SESSION], ["resumeSession", RESUME]] as const) {
    const guard = body.indexOf("actionVault !== currentVault || actionToken !== viewGeneration");
    const reset = body.indexOf("activity.reset(actionVault)");
    const view = body.indexOf("resetView({");
    assert.notEqual(guard, -1, `${name} 必须有视图守卫`);
    assert.notEqual(reset, -1, `${name} 迟到回包只清发起 vault 的记录`);
    assert.ok(guard < reset && reset < view, `${name} 的迟到分支必须早退回记录层，MUST NOT 走到 resetView`);
  }
});

test("cron 回滚 / cron 通知：显式 { targetVault, viewToken }，内部不读 currentVault 决定清谁", () => {
  assertNoMatch(stripComments(MAIN_SOURCE), /harnessPanel\.reloadSession\(\)/, "旧的无参回滚不得残留");
  assertNoMatch(stripComments(MAIN_SOURCE), /vaultChanged\("", null\)/, "空哨兵 `vaultChanged(\"\", null)` 不得残留（会破坏显示门）");
  assert.match(CRON_HANDLER, /harnessPanel\.beginCronRun\(payload\.prompt\)/, "点击运行仍走 beginCronRun");
  assert.match(CRON_HANDLER, /const viewToken = harnessPanel\.beginCronRun/, "令牌取自 beginCronRun 的返回值（resetView 之后那一代）");
  assert.match(CRON_HANDLER, /harnessPanel\.reloadSession\(adopted\)/, "失败回滚带上 { targetVault, viewToken }");
  assert.match(CRON_HANDLER, /if \(originCurrent\) void showToast\(/, "发起失败提示只在发起视图仍当前时落地");
  // 发起视图与 adopted 解耦（r2 评审 P1-1）：忙时 beginCronRun 返回 null 也要捕获。
  assert.match(
    CRON_HANDLER,
    /origin = \{ targetVault, viewToken: harnessPanel\.viewToken\(\) \};/,
    "发起视图在 beginCronRun 之后独立捕获（忙时也要）",
  );
  assert.match(CRON_HANDLER, /origin === null \|\|/, "提示身份用 origin");
  assertNoMatch(CRON_HANDLER, /adopted === null \|\|/, "adopted 只决定回滚，不得兼任提示身份");
  assert.match(
    CRON_OPEN,
    /target = \{ targetVault: loadedRoot \?\? payload\.vault, viewToken: harnessPanel\.viewToken\(\) \};/,
    "目标 vault 与视图世代在恢复发起前一次定格（实际装载根）",
  );
  assert.match(CRON_OPEN, /harnessPanel\.reloadSessionView\(target\)/, "resolve 后走 reloadSessionView");
  // 失败提示按发起视图守卫（独立评审 P1-1a）：A 的失败提示 MUST NOT 以 toast 出现在 B 上。
  assert.match(CRON_OPEN, /if \(originCurrent\) void showToast\(/, "恢复失败提示只在发起视图仍当前时落地");
  const still = CRON_OPEN.indexOf("const stillCurrent =");
  const open = CRON_OPEN.indexOf("if (stillCurrent) openHarnessPane(false);");
  assert.ok(still !== -1 && open !== -1 && still < open, "面板打开也要按同一份定格守卫（切走后 MUST NOT 打开 B 的 pane）");
  // reloadTargetSession：内部不读 currentVault 决定清谁（只用于守卫判断「是否仍当前」）。
  assert.match(RELOAD, /options\.targetVault === currentVault/, "守卫只比较目标与当前");
  assert.match(RELOAD, /activity\.reset\(options\.targetVault\)/, "记录复位只作用于目标");
  // 目标非当前：只清记录就返回——MUST NOT 调 renderActivity / 复位视图 / 取快照
  //（独立评审 P1-1b：「切走后 DOM 渲染全部跳过」）。
  assert.match(RELOAD, /if \(!stillCurrent\) return;/, "切走后早退（不复位视图、不取快照）");
  assertNoMatch(RELOAD, /renderActivity\(/, "切走后 MUST NOT 渲染当前视图的 DOM（同值写入也算违规）");
  const resetAt = RELOAD.indexOf("activity.reset(options.targetVault)");
  const early = RELOAD.indexOf("if (!stillCurrent)");
  const view = RELOAD.indexOf("resetView({");
  assert.ok(resetAt < early && early < view, "切走后只清记录就早退（不 resetView、不取快照）");
});

// ── 8. 无 retain / 无第二份未读表 ──────────────────────────────────────────

test("无通用 retain / 无按注册表 path 的周期性清理；drop 只由显式删除 / 重定位调用", () => {
  const code = stripComments(PANEL_SOURCE) + stripComments(MAIN_SOURCE) + stripComments(ACTIVITY_SOURCE);
  assertNoMatch(code, /activity\.retain|vaultActivity\.retain/, "不得出现通用 retain");
  assertNoMatch(code, /sweepActivity|pruneActivity|cleanupActivity/, "不得有周期性清理 API");
  // drop 的调用点只有两个（删除 / 重定位），且都在装配层。
  const drops = [...stripComments(MAIN_SOURCE).matchAll(/vaultActivity\.drop\(/g)];
  assert.equal(drops.length, 2, `drop 只允许显式删除 / 重定位两处（实际 ${drops.length}）`);
  assert.match(MAIN_SOURCE, /const removedRoot = actualRootOf\(row\);/, "删除按实际后端打开根");
  assert.match(MAIN_SOURCE, /const previousRoot = actualRootOf\(row\);/, "重定位按旧的实际后端打开根");
  assert.match(MAIN_SOURCE, /function actualRootOf\(/, "实际根判据只有一份");
});

test("未读只有一个生产者：面板没有第二张按 vault 的表 / 第二个 badge 写点", () => {
  assertNoMatch(stripComments(PANEL_SOURCE), /new Map<string, ActivityState>|Map<string, ActivityState>/, "面板不得自建第二张按 vault 的记录表");
  const writes = [...PANEL_SOURCE.matchAll(/dataset\.activity\s*=/g)];
  assert.equal(writes.length, 1, `data-activity 只能有一个写点（实际 ${writes.length} 处）`);
  assert.ok((writes[0].index ?? 0) >= PANEL_SOURCE.indexOf(BADGE), "写点必须在 applyActivityBadge 里");
  assert.match(BADGE, /activityStatus\.textContent/, "可访问状态文本与状态点同源施加");
  assert.match(BADGE, /activityKind\(state\)/, "三态取值走共用映射（与切换器行同源）");
  assert.match(BADGE, /activityStatusKey\(state, hasPendingApprovals\(\)\)/, "状态词走共用映射（D870–D872 / 待批 D416）");
  assert.match(BADGE, /currentActivity\(\)/, "三态读当前 vault 的记录");
  // 空闲态必须真的把文本清空（不残留上一次的状态描述）。
  assert.match(BADGE, /\?\s*""\s*:/, "空闲态的状态文本为空串");
  assert.match(BADGE, /t\("D327"\)/, "空闲文案逐字复用 D327（既有口径不新增文案编号）");
});

test("状态点与状态文本：常驻 DOM + 可访问描述指向视觉隐藏文本", () => {
  assert.match(PANEL_SOURCE, /className = "lumir-hp-toggle-dot"/, "状态点必须是常驻子元素");
  assert.match(PANEL_SOURCE, /className = "lumir-hp-toggle-status"/, "状态文本必须是常驻元素");
  assert.match(PANEL_SOURCE, /aria-live", "polite"/, "终态经 polite live region 播报");
  assert.match(PANEL_SOURCE, /setAttribute\("aria-describedby", activityStatus\.id\)/, "钮的描述指向状态文本");
});

test("悬停提示承载三态：title 只在 applyActivityBadge 写（AX 通道上唯一读得到的）", () => {
  const writes = [...PANEL_SOURCE.matchAll(/toggleButton\.title\s*=/g)];
  assert.equal(writes.length, 1, `toggle 的 title 只能有一个写点（实际 ${writes.length} 处）`);
  assert.ok((writes[0].index ?? -1) >= PANEL_SOURCE.indexOf(BADGE), "写点必须落在 applyActivityBadge 里");
  assert.match(BADGE, /toggleButton\.title/, "三态文案必须同时落到悬停提示");
  assertNoMatch(
    functionBodyOf(PANEL_SOURCE, "applyLabels"),
    /toggleButton\.title\s*=/,
    "applyLabels 不得写 title：重取文案会把状态词覆盖成纯 D327",
  );
});

test("订阅面：面板不订阅 store（渲染由自己的 dispatch 驱动），切换器订阅并按浮层开关省 DOM", () => {
  assertNoMatch(stripComments(PANEL_SOURCE), /activity\.subscribe\(/, "面板不得额外订阅：写点之后显式 renderActivity，避免双写同一 DOM");
  assert.match(SWITCHER_SOURCE, /deps\.subscribeActivity\(\(\) => this\.refreshActivity\(\)\)/, "切换器订阅记录跃迁");
  assert.match(REFRESH_ACTIVITY, /if \(!this\.open\) return;/, "浮层关闭时零 DOM 工作");
});

test("样式：标题栏状态点空闲零上屏、无动画；行标记三态形状 + 无动画 + 行内右端", () => {
  const idleAt = PANEL_CSS.indexOf('[data-activity="idle"]');
  assert.notEqual(idleAt, -1, "空闲态必须有专门条款");
  assert.match(PANEL_CSS.slice(idleAt, idleAt + 400), /display:\s*none/, "空闲态必须 display:none（零像素漂移的机制本身）");
  assertNoMatch(PANEL_CSS, /lumir-hp-toggle-dot[^{]*\{[^}]*animation/, "MUST NOT 引入常态动画");
  for (const state of ["inflight", "reply", "failure"]) {
    assert.match(PANEL_CSS, new RegExp(`\\[data-activity="${state}"\\]`), `${state} 必须有形状条款`);
  }
  // 行标记（style.css）：三态形状 + 6×6 + 无动画 / 过渡 + 不拦点击。
  const rowMarker = /\.vault-row-activity \{([^}]*)\}/.exec(STYLE_CSS);
  assert.ok(rowMarker !== null, "行标记必须有形状条款");
  assert.match(rowMarker[1], /width:\s*6px/, "同档 6×6（与标题栏状态点一致）");
  assert.match(rowMarker[1], /height:\s*6px/);
  assert.match(rowMarker[1], /margin-left:\s*auto/, "推到行内右端");
  assert.match(rowMarker[1], /pointer-events:\s*none/, "点击永远落到行切换钮");
  for (const state of ["inflight", "reply", "failure"]) {
    assert.match(STYLE_CSS, new RegExp(`\\.vault-row-activity\\[data-activity="${state}"\\]`), `行标记 ${state} 必须有形状条款`);
  }
  const markerRules = STYLE_CSS.slice(STYLE_CSS.indexOf(".vault-row-activity {"), STYLE_CSS.indexOf(".vault-row-sub {"));
  assertNoMatch(markerRules, /animation|transition:/, "标记不得有动画 / 过渡");
});

// ── 9. 模型侧：删掉的东西不许以别的名字回来 ────────────────────────────────

test("模型：没有终态记忆、没有「拒绝 ⇒ running」的输入", () => {
  const activityCode = stripComments(ACTIVITY_SOURCE);
  const panelCode = stripComments(PANEL_SOURCE);
  assertNoMatch(activityCode, /afterTerminal/, "r2 删掉的本地终态记忆不得复活");
  assertNoMatch(activityCode, /busy_rejected/, "r2 删掉的「拒绝即复活」不得复活");
  assertNoMatch(activityCode, /harness_busy/, "模型里不得出现拒绝语义");
  assertNoMatch(panelCode, /afterTerminal|busy_rejected/, "面板里也不得残留这两条旧机制");
});

test("模型：相位逐条委托 reduceSendPhase（三种输入都在）", () => {
  for (const input of ['{ type: "sent" }', '{ type: "stop-clicked" }', '{ type: "finished" }']) {
    assert.ok(ACTIVITY_SOURCE.includes(`reduceSendPhase(state.phase, ${input})`), `缺委托：${input}`);
  }
});
