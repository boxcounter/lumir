// 活动在场的**接线层**结构对账（change add-harness-activity-presence tasks 5.2）。
//
// 这一层判的是「面板有没有按合同接上纯模型」（进入快照回填相位 / 对账只走内容档位 / 三类
// 终态都把 mounted 传进状态机 / 停止点击经状态机 / 拒绝不改相位 / 收起不复位 / 三态唯一
// 施加点），不是 `reduceActivity` 的返回值——零 DOM 单测跑不起 `createHarnessPanel`
// （见 tests/unit/README.md），因此对源码做结构对账，与 `harness-cron-click-run.test.ts`
// 同一层、同一理由。
//
// 反向纪律（REVIEW.md「断言等价于子串」条）：每条断言都要能对「实现退回旧形态」判红——
// 注释里点名的那种旧写法就是它的反例输入。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PANEL_SOURCE = readFileSync(new URL("../../src/harness-panel.ts", import.meta.url), "utf8");
const MAIN_SOURCE = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");
const ACTIVITY_SOURCE = readFileSync(new URL("../../src/harness-activity.ts", import.meta.url), "utf8");
const PANEL_CSS = readFileSync(new URL("../../src/harness-panel.css", import.meta.url), "utf8");

/** `assert.doesNotMatch` 在本仓钉的 @types/node 档里没有声明（运行时存在、类型面缺）——
 *  用同一个语义的本地断言替代：不给 tsconfig 打补丁，也不改 `skipLibCheck`。 */
function assertNoMatch(source: string, pattern: RegExp, message: string): void {
  assert.ok(!pattern.test(source), message);
}

/** 去掉行注释与块注释后的代码（断言「某机制已删除」时不能把文档里的点名当成实现）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

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

/** 取 `case "<label>":` 到下一个同级 `case` / `default:` 之间的分支体（够用即可：分支里没有嵌套 switch）。 */
function switchCaseOf(source: string, label: string): string {
  const start = source.indexOf(`case "${label}":`);
  if (start === -1) throw new Error(`源码里找不到 case "${label}":`);
  const next = source.slice(start + 1).search(/\n\s{6}(case "|default:)/);
  assert.notEqual(next, -1, `case "${label}" 之后找不到下一个分支`);
  return source.slice(start, start + 1 + next);
}

const DISPATCH = functionBodyOf(PANEL_SOURCE, "dispatchActivity");
const APPLY_ENTER = functionBodyOf(PANEL_SOURCE, "applyEnterSnapshot");
const RESTORE = functionBodyOf(PANEL_SOURCE, "restoreSnapshot");
const FETCH = functionBodyOf(PANEL_SOURCE, "fetchSnapshot");
const ATTACH = functionBodyOf(PANEL_SOURCE, "attachTo");
const BADGE = functionBodyOf(PANEL_SOURCE, "applyActivityBadge");
const HANDLE = functionBodyOf(PANEL_SOURCE, "handleEvent");
const SEND = functionBodyOf(PANEL_SOURCE, "send");

// ── 1. 相位只有一个写入口，状态机的每次跃迁都经 dispatchActivity ─────────────

test("相位写入：applySendPhase 只落 DOM（函数体里不得回写相位）", () => {
  const apply = functionBodyOf(PANEL_SOURCE, "applySendPhase");
  assertNoMatch(apply, /activity\s*=|sendPhase\s*=/, "applySendPhase 必须只落 DOM：回写相位会让状态机出现第二个持有者（r1 P2-2 现场）");
});

test("相位写入：除 dispatchActivity 外没有第二处调 applySendPhase 做跃迁", () => {
  // 允许的两类：dispatchActivity 内部的 `applySendPhase(activity.phase)`，以及 applyLabels 的
  // 重取文案（同一相位重绘 DOM，不是跃迁）。其余调用点都算第二写入口。
  const calls = [...PANEL_SOURCE.matchAll(/applySendPhase\((?!next\)|next:|activity\.phase\))/g)];
  assert.deepEqual(
    calls.map((m) => m.index),
    [],
    "只允许 dispatchActivity(activity.phase) 与 applySendPhase(next) 声明本身",
  );
  assert.match(DISPATCH, /applySendPhase\(activity\.phase\)/, "唯一跃迁落 DOM 点在 dispatchActivity");
});

test("相位写入：旧的 reduceSendPhase(...) 直调没有残留在面板里（跃迁只经模型）", () => {
  assertNoMatch(PANEL_SOURCE, /applySendPhase\(reduceSendPhase\(/, "面板不得再自己推相位（stopping 会有两个持有者）");
});

// ── 2. 进入快照：显式档位、按 in_flight 回填、世代守卫 ─────────────────────

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
  // 全文件里 in_flight 的读取点只有三处：restoreSnapshot 的进入分支、applyEnterSnapshot、
  // 以及恢复会话时点的只读相位取数（`fetchActivitySnapshot`）——对账路径（content 档）不读它。
  const fetchActivity = functionBodyOf(PANEL_SOURCE, "fetchActivitySnapshot");
  const allowed = [RESTORE, APPLY_ENTER, fetchActivity].map((body) => ({
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
  const resume = functionBodyOf(PANEL_SOURCE, "resumeSession");
  assert.match(resume, /fetchActivitySnapshot\(\)/, "恢复会话后必须按快照的 in_flight 回填相位");
  const phaseOnly = functionBodyOf(PANEL_SOURCE, "fetchActivitySnapshot");
  assert.match(phaseOnly, /applyEnterSnapshot\(state\.in_flight/, "只读相位也必须走同一个状态机入口");
  assertNoMatch(phaseOnly, /renderSnapshotMessages/, "内容已由恢复回执铺开，MUST NOT 再重放一遍");
  // 解析与准入只有一份（M312 的旧 vault 丢弃判据）。
  assert.match(functionBodyOf(PANEL_SOURCE, "restoreSnapshot"), /parseSnapshot\(json\)/, "全量恢复同一份解析");
});

test("对账档位必须带世代守卫：请求之后已开始新一轮 ⇒ 整条丢弃", () => {
  // 内容重建 = 清面 + 重放。请求发出后若用户已开始新一轮（`sent` 推进 epoch、新消息乐观上屏），
  // 这份回包落地会把那条新消息清掉——相位有守卫，内容也必须有一道。
  const contentBranch = RESTORE.slice(RESTORE.indexOf('} else {'));
  const guard = contentBranch.search(/if \(epochAtRequest !== phaseEpoch\) return;/);
  assert.notEqual(guard, -1, "内容档必须在清面前丢弃过期回包");
  const clear = contentBranch.search(/clearTranscriptSurface\(\)/);
  assert.ok(guard < clear, "守卫必须排在清渲染面**之前**（清完再判就晚了）");
});

test("对账档位：清渲染面 + 不拽视口；进入档位才强制回底", () => {
  // 对账要把残缺的流式泡换成完整消息 ⇒ 必须先清渲染面（否则 renderSnapshotMessages 只是追加，
  // 屏幕上会出现两份）。它 MUST NOT 走 `resetView`（那会顺手改相位 / 未读 / 跟随态）。
  const contentBranch = RESTORE.slice(RESTORE.indexOf("clearTranscriptSurface()"));
  assert.notEqual(contentBranch.length, 0, "对账档位必须清渲染面");
  assertNoMatch(RESTORE, /resetView\(\)/, "对账档位 MUST NOT 复用 resetView（会顺手复位相位与未读）");
  // 滚动位：进入 = 强制回底（白名单动作）；对账 = 交给跟随态（detached 不拽视口）。
  assert.match(RESTORE, /mode === "enter"[\s\S]{0,200}follow\.jumpToBottom\(\)/, "进入档位强制回底");
  assert.match(RESTORE, /follow\.contentGrew\(\)/, "对账档位按既有跟随态决定滚动位");
});

test("applyEnterSnapshot：缺键（旧后端）整条不应用，不伪造在途", () => {
  assert.match(
    APPLY_ENTER,
    /typeof rawInFlight !== "boolean"/,
    "缺键必须是「不应用」，MUST NOT 当成 false 或 true",
  );
  assert.match(APPLY_ENTER, /type: "enter_snapshot"/, "进入快照必须经状态机（相位唯一投影）");
});

test("fetchSnapshot：请求时记下 phaseEpoch，并把它交给 restoreSnapshot", () => {
  assert.match(FETCH, /const epoch = phaseEpoch/, "发起请求时必须记下当时的世代");
  assert.match(
    FETCH,
    /restoreSnapshot\(json, mode, epoch\)/,
    "响应必须带上请求时的世代（世代不一致 ⇒ 丢弃相位部分）",
  );
  assert.match(FETCH, /mode: "enter" \| "content" = "enter"/, "默认档位是进入（心跳 / 挂载 / 切 vault）");
});

// ── 3. 快照与终态：闸门与接管标志单一施加点 ────────────────────────────────

test("dispatchActivity：turnOpen 与 midTakeover 只在这里写（含进入快照的收口语义）", () => {
  assert.match(DISPATCH, /case "enter_snapshot":/, "进入快照必须在这一处施加闸门");
  assert.match(DISPATCH, /enterSnapshotApplies\(prev, event\)/, "判据必须与模型同源");
  assert.match(DISPATCH, /turnOpen = event\.inFlight/, "闸门与相位同源恢复");
  assert.match(DISPATCH, /midTakeover = event\.inFlight/, "接管标志同源置位 / 清除");
  // 事件处理器不得各自写这两个变量（写在这里之外就是「半收口」）。
  for (const line of HANDLE.split("\n")) {
    assertNoMatch(line, /turnOpen\s*=[^=]/, `handleEvent 里出现第二处 turnOpen 写入：${line}`);
    assertNoMatch(line, /midTakeover\s*=[^=]/, `handleEvent 里出现第二处 midTakeover 写入：${line}`);
  }
});

test("三类终态都经状态机、都把 mounted 传进去（未读只在收起期间产生）", () => {
  for (const kind of ["done", "error", "aborted"]) {
    assert.match(
      HANDLE,
      new RegExp(`type: "terminal", kind: "${kind}", mounted: mountEl !== null`),
      `${kind} 必须把面板是否在屏幕上传给状态机`,
    );
  }
  assert.equal(
    (HANDLE.match(/dispatchActivity\(\{ type: "terminal"/g) ?? []).length,
    3,
    "三类终态各一条派发，不多不少",
  );
});

test("终态对账：只在「中途接管」/ cron 收尾时做，且走内容档位", () => {
  const takeoverReads = [...HANDLE.matchAll(/const takeover = midTakeover;/g)];
  assert.equal(takeoverReads.length, 3, "三类终态都要在派发前记住接管标志（派发会清它）");
  for (const kind of ["error", "aborted"]) {
    const block = switchCaseOf(HANDLE, kind);
    assert.match(block, /if \(takeover\) fetchSnapshot\("content"\)/, `${kind} 分支的对账必须走内容档位`);
  }
  // done 分支：两条理由（中途接管 / cron 点击运行收尾）合并成**一次**内容档请求。
  const done = switchCaseOf(HANDLE, "done");
  assert.match(done, /const adopted = cronRunAdopted;/, "done 必须在派发前记住 cron 切屏态");
  assert.match(done, /if \(takeover \|\| adopted\) fetchSnapshot\("content"\)/, "两种理由合并成一次内容重建");
  // r1 P1-2：cron 收尾 MUST NOT 复用 reloadSession——它经 resetView 以 `vault_changed` 结算，
  // 会把刚产生的未读吃掉（点击 cron → 收起 → 完成，指示退回空闲）。
  assertNoMatch(done, /reloadSession\(\)/, "cron 收尾不得走会清未读的会话复位路径");
  // 反向：对账档 MUST NOT 出现在别处（心跳 / 挂载 / 回滚都必须走进入档）。判据只数**调用**，
  // 注释里点到这个名字不算（`reloadSession` 的注释就是这样提到它的）。
  const contentCalls = stripComments(PANEL_SOURCE).match(/fetchSnapshot\("content"\)/g) ?? [];
  assert.equal(contentCalls.length, 3, `内容档调用只允许出现在 done / error / aborted 三条终态里（实际 ${contentCalls.length} 处）`);
  // 回滚路径仍在：装配层的点击运行发起失败必须以 reloadSession 撤回乐观切屏。
  assert.match(MAIN_SOURCE, /harnessPanel\.reloadSession\(\)/, "发起失败的回滚通道仍须存在（reloadSession）");
});

// ── 4. 发送 / 停止 / 拒绝：三条口径 ───────────────────────────────────────

test("harness_busy：只上错误行 + 读一次相位（只读通道），MUST NOT 直接改相位", () => {
  const busyBranchStart = SEND.indexOf('if (errorCodeOf(e) === "harness_busy")');
  assert.notEqual(busyBranchStart, -1, "send 的 catch 必须有 harness_busy 的专属处置");
  const branch = SEND.slice(busyBranchStart, SEND.indexOf("return;", busyBranchStart));
  assert.match(branch, /appendError\(/, "拒绝要如实上错误行");
  // r1 P1-1：这条重取发生在**已有内容**的 transcript 上（事前没有 resetView / 清渲染面），
  // 走进入档会把历史消息逐条 append 第二遍、并强制回底。只读相位通道没有这两个副作用。
  assert.match(branch, /fetchActivitySnapshot\(\)/, "拒绝的处置是再问一次权威的**相位**，不是本地猜");
  assertNoMatch(branch, /fetchSnapshot\(/, "MUST NOT 走进入档全量恢复（会重复消息 + 强制回底）");
  assertNoMatch(branch, /applySendPhase|dispatchActivity/, "拒绝不得作为在途证据：这里 MUST NOT 改相位（r2 删掉的 busy_rejected 不许以别的名字回来）");
});

test("停止点击：经状态机的 stop_clicked 输入，不绕过状态机直接改相位", () => {
  assert.match(
    PANEL_SOURCE,
    /dispatchActivity\(\{ type: "stop_clicked" \}\);\s*\n\s*stopHandler\?\.\(\);/,
    "停止路径必须「状态机先行（挡连点）再调停止钩子」",
  );
});

test("发送：经状态机的 sent 输入（闸门随相位一并打开）", () => {
  assert.match(SEND, /dispatchActivity\(\{ type: "sent" \}\)/, "发送必须经状态机推进相位与闸门");
});

test("自动回合：auto_turn_started 经状态机（闸门先开，首段分片不被丢弃）", () => {
  assert.match(
    HANDLE,
    /case "auto_turn_started":[\s\S]{0,400}dispatchActivity\(\{ type: "auto_turn_started" \}\)/,
    "自动回合必须自己打开闸门与处理中相位",
  );
});

// ── 5. 收起 / 打开：收起不复位，打开即已读 ──────────────────────────────────

test("attachTo(null)：收起 ≠ 复位——不清相位、不清未读", () => {
  const detachStart = ATTACH.indexOf("} else {");
  assert.notEqual(detachStart, -1, "attachTo 必须有摘下分支");
  const detach = ATTACH.slice(detachStart);
  assertNoMatch(detach, /applySendPhase|dispatchActivity/, "摘下 DOM 不得碰活动状态");
});

test("attachTo(mount)：打开面板经状态机的 opened（已读清算的唯一入口）", () => {
  assert.match(ATTACH, /dispatchActivity\(\{ type: "opened" \}\)/, "挂载即已读");
});

test("resetView：视图换代作废所有在途快照（推进 snapshotSeq）", () => {
  // 新建会话 / 切 vault / cron 切屏都只经 resetView 换代。相位在 idle → idle 的复位里不推进
  // epoch，所以在途的**只内容**回包能同时通过 seq 与 epoch 两道守卫，把旧会话消息重放进新视图
  // （实现评审 r1 P1 的现场）。作废判据因此落在 resetView 里，且必须排在清渲染面之前。
  const reset = functionBodyOf(PANEL_SOURCE, "resetView");
  const bump = reset.search(/snapshotSeq \+= 1/);
  assert.notEqual(bump, -1, "视图换代必须推进 snapshotSeq（作废在途快照）");
  const clear = reset.search(/clearTranscriptSurface\(\)/);
  assert.ok(bump < clear, "作废必须排在清渲染面之前（先清再作废，回包仍有窗口落到新视图）");
  // 单一入口：beginCronRun 不再自己记一次（它走 resetView）。
  const begin = functionBodyOf(PANEL_SOURCE, "beginCronRun");
  assertNoMatch(begin, /snapshotSeq \+= 1/, "换代作废只有一个入口（resetView），别处不重复推进");
});

test("resetView：视图复位经 vault_changed（相位收口 + 未读清空），背面写明回填次序", () => {
  const reset = functionBodyOf(PANEL_SOURCE, "resetView");
  assert.match(reset, /dispatchActivity\(\{ type: "vault_changed" \}\)/, "复位必须经状态机");
  assert.match(reset, /进入快照/, "注释必须写明「复位后由进入快照的 in_flight 回填」的次序");
  assert.match(reset, /对账快照/, "注释必须写明对账快照不回填相位");
});

// ── 6. 三态 DOM：状态点与状态文本的唯一施加点 ──────────────────────────────

test("data-activity：只由 applyActivityBadge 施加（三态唯一函数）", () => {
  const writes = [...PANEL_SOURCE.matchAll(/dataset\.activity\s*=/g)];
  assert.equal(writes.length, 1, `data-activity 只能有一个写点（实际 ${writes.length} 处）`);
  const write = writes[0].index ?? 0;
  assert.ok(write >= PANEL_SOURCE.indexOf(BADGE), "写点必须在 applyActivityBadge 里");
  assert.match(BADGE, /activityStatus\.textContent/, "可访问状态文本与状态点同源施加");
  assert.match(BADGE, /"inflight"[\s\S]*"reply"[\s\S]*"failure"/, "三态（在途 / 回复 / 失败）都要有");
  // 未读清算后必须真的把文本清空（空闲态不残留上一次的状态描述）。
  assert.match(BADGE, /:\s*""/, "空闲态的状态文本为空串");
});

test("状态点与状态文本：常驻 DOM + 可访问描述指向视觉隐藏文本", () => {
  assert.match(PANEL_SOURCE, /className = "lumir-hp-toggle-dot"/, "状态点必须是常驻子元素");
  assert.match(PANEL_SOURCE, /className = "lumir-hp-toggle-status"/, "状态文本必须是常驻元素");
  assert.match(PANEL_SOURCE, /aria-live", "polite"/, "终态经 polite live region 播报");
  assert.match(PANEL_SOURCE, /setAttribute\("aria-describedby", activityStatus\.id\)/, "钮的描述指向状态文本");
});

test("样式：空闲态不产生上屏像素、无动画、三态形状可辨", () => {
  const idleAt = PANEL_CSS.indexOf('[data-activity="idle"]');
  assert.notEqual(idleAt, -1, "空闲态必须有专门条款");
  assert.match(
    PANEL_CSS.slice(idleAt, idleAt + 400),
    /display:\s*none/,
    "空闲态必须 display:none（零像素漂移的机制本身）",
  );
  assertNoMatch(PANEL_CSS, /lumir-hp-toggle-dot[^{]*\{[^}]*animation/, "MUST NOT 引入常态动画");
  for (const state of ["inflight", "reply", "failure"]) {
    assert.match(PANEL_CSS, new RegExp(`\\[data-activity="${state}"\\]`), `${state} 必须有形状条款`);
  }
});

// ── 7. 模型侧：删掉的东西不许以别的名字回来 ────────────────────────────────

test("模型：没有终态记忆、没有「拒绝 ⇒ running」的输入", () => {
  // 只看**代码**：注释里点名这两条被删掉的机制是文档，不是实现。
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
