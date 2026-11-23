// 待批信号的**接线层**结构对账（change fix-harness-approval-visibility-nov23 tasks 1.2 / design §3）。
//
// 这一层判的是「面板有没有按合同把单一判据接到三个输出面并覆盖全部清算出口」，不是选择器的
// 返回值（那部分在 `harness-approval-signal.test.ts`）。零 DOM 单测跑不起完整面板，因此对
// 源码做结构对账；行为竞态由四个视觉场景在真实 DOM 里判。
//
// 反向纪律（REVIEW.md「断言等价于子串」条）：每条断言都点名「旧实现的那一行长什么样」——
// 三元表达式分支、第二份 `size > 0`、内联撤卡循环、无重施的清面，都是它的反例输入。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PANEL_SOURCE = readFileSync(new URL("../../src/harness-panel.ts", import.meta.url), "utf8");
const PANEL_CSS = readFileSync(new URL("../../src/harness-panel.css", import.meta.url), "utf8");

function assertNoMatch(source: string, pattern: RegExp, message: string): void {
  assert.ok(!pattern.test(source), message);
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

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

function switchCaseOf(source: string, label: string): string {
  const start = source.indexOf(`case "${label}":`);
  if (start === -1) throw new Error(`源码里找不到 case "${label}":`);
  const next = source.slice(start + 1).search(/\n\s{6}(case "|default:)/);
  assert.notEqual(next, -1, `case "${label}" 之后找不到下一个分支`);
  return source.slice(start, start + 1 + next);
}

const HAS = functionBodyOf(PANEL_SOURCE, "hasPendingApprovals");
const STAGE = functionBodyOf(PANEL_SOURCE, "applyStage");
const BADGE = functionBodyOf(PANEL_SOURCE, "applyActivityBadge");
const REFRESH = functionBodyOf(PANEL_SOURCE, "refreshApprovalSignal");
const WITHDRAW = functionBodyOf(PANEL_SOURCE, "withdrawPendingApprovals");
const APPROVAL = functionBodyOf(PANEL_SOURCE, "appendApproval");
const CLEAR = functionBodyOf(PANEL_SOURCE, "clearTranscriptSurface");
const RESTORE = functionBodyOf(PANEL_SOURCE, "restoreSnapshot");
const PROJECT = functionBodyOf(PANEL_SOURCE, "projectActivity");
const APPLY_ENTER = functionBodyOf(PANEL_SOURCE, "applyEnterSnapshot");
const ATTACH_TASK = functionBodyOf(PANEL_SOURCE, "attachTaskApproval");
const HANDLE = functionBodyOf(PANEL_SOURCE, "handleEvent");
const SEND = functionBodyOf(PANEL_SOURCE, "send");

// ── 1. 单一判据：全仓只有 hasPendingApprovals 读集合大小 ─────────────────────

test("单一判据：pendingApprovals.size > 0 只在 hasPendingApprovals 里出现一次", () => {
  const occurrences = [...stripComments(PANEL_SOURCE).matchAll(/pendingApprovals\.size\s*>\s*0/g)];
  assert.equal(occurrences.length, 1, `待批判据只能有一处（实际 ${occurrences.length} 处）`);
  assert.match(HAS, /return pendingApprovals\.size > 0;/, "判据本体在 hasPendingApprovals");
});

test("单一判据：applyStage / applyActivityBadge / 新一轮清 stale 都只读 hasPendingApprovals()", () => {
  assert.match(
    STAGE,
    /stageCopyKey\(currentActivity\(\)\.phase, hasPendingApprovals\(\), stageWaiting\)/,
    "阶段行只能从纯选择器取键（函数里不再写第二份优先级分支）",
  );
  assertNoMatch(STAGE, /\? t\("D400"\)/, "旧的三元优先级分支必须删除");
  assertNoMatch(STAGE, /pendingApprovals\.(size|has)/, "阶段行不得自己读集合");
  assert.match(
    BADGE,
    /activityStatusKey\(state, hasPendingApprovals\(\)\)/,
    "标题栏状态只能从纯选择器取键",
  );
  assertNoMatch(BADGE, /pendingApprovals\.(size|has)/, "徽标不得自己读集合");
  const started = PROJECT.slice(PROJECT.indexOf('case "turn_started":'), PROJECT.indexOf('case "terminal":'));
  assert.match(started, /prev\.phase === "idle" && hasPendingApprovals\(\)/, "清 stale 只认「上一相位空闲 + 集合非空」");
});

// ── 2. 三个输出面：同源写点与幂等写入 ───────────────────────────────────────

test("阶段行：乐观确认前比较旧文本（同一待批集合不重复触发 DOM mutation）", () => {
  assert.match(STAGE, /stageLine\.textContent !== text/, "文本值不变即不重写");
});

test("标题栏：段状态词与 toggle 同源，只在待批键上显示且先比较旧值", () => {
  assert.match(BADGE, /const segWord = key === "D416" \? status : ""/, "段状态词复用同一状态词（D416 同一串）");
  assert.match(BADGE, /segStatus\.textContent !== segWord/, "段状态词文本先比较再写");
  assert.match(BADGE, /segStatus\.hidden !== hideSeg/, "段状态词显隐先比较再写");
  assert.match(BADGE, /activityStatus\.textContent !== status/, "aria-live 文本先比较再写（不重复播报）");
});

test("标题栏：段状态词节点在会话名之后、加号钮之前；段是 flex 子项", () => {
  assert.match(PANEL_SOURCE, /segStatus\.className = "lumir-hp-seg-status"/);
  assert.match(PANEL_SOURCE, /segStatus\.hidden = true/, "初始隐藏（idle 零像素）");
  assert.match(PANEL_SOURCE, /seg\.append\(sessionWrap, segStatus, segNew\)/, "位置：会话名 → 状态词 → 加号");
});

test("刷新入口：非 idle 才重绘阶段行，标题栏无条件重绘", () => {
  assert.match(REFRESH, /if \(currentActivity\(\)\.phase !== "idle"\) applyStage\(\);/);
  assert.match(REFRESH, /applyActivityBadge\(\);/);
});

// ── 3. 到达与决策：同一同步批次内重施 ──────────────────────────────────────

test("appendApproval：入口 idle 守卫在一切 DOM 之前（陈旧项不建泡 / 不落卡 / 不入集合）", () => {
  const guard = APPROVAL.indexOf('if (currentActivity().phase === "idle") return;');
  const ensure = APPROVAL.indexOf("ensureStreamingMessage()");
  const set = APPROVAL.indexOf("pendingApprovals.set(");
  assert.notEqual(guard, -1, "必须在函数入口判 idle");
  assert.ok(guard < ensure, "守卫必须在建流式泡 / 工具块之前");
  assert.ok(guard < set, "守卫必须在写集合之前");
});

test("appendApproval：重复投递幂等（已在待决 / 已决策的 id 不再落第二张卡）", () => {
  assert.match(
    APPROVAL,
    /pendingApprovals\.has\(request\.id\) \|\| decidedApprovals\.has\(request\.id\)/,
    "重复投递不得重建卡片或重复播报",
  );
});

test("appendApproval：集合写入 + relabel 之后、contentGrew 之前重施", () => {
  const set = APPROVAL.indexOf("pendingApprovals.set(request.id, pending)");
  const relabel = APPROVAL.indexOf("relabelApproval(pending)");
  const refresh = APPROVAL.indexOf("refreshApprovalSignal()");
  const grew = APPROVAL.indexOf("follow.contentGrew()");
  assert.notEqual(refresh, -1, "未决项到达必须重施");
  assert.ok(set < refresh && relabel < refresh, "重施必须发生在集合与卡都就位之后");
  assert.ok(refresh < grew, "状态与卡同帧出现，然后才走内容增长");
});

test("decide：delete + settle 之后、回送后端之前重施（幂等早退路径不重施）", () => {
  const decide = APPROVAL.slice(APPROVAL.indexOf("const decide = (approved"));
  const del = decide.indexOf("pendingApprovals.delete(request.id)");
  const settle = decide.indexOf("settleApprovalRecord(");
  const refresh = decide.indexOf("refreshApprovalSignal()");
  const send = decide.indexOf("harnessApprove(");
  assert.ok(del !== -1 && settle !== -1 && refresh !== -1 && send !== -1, "决策闭包的四步都在");
  assert.ok(del < settle && settle < refresh && refresh < send, "顺序：delete → settle → refresh → 后端");
});

// ── 4. 清算：终态统一撤回与 stale 清理 ─────────────────────────────────────

test("withdrawPendingApprovals：撤卡 / 标未执行或已停止 / 清集合 / 失效闭包 / 重施", () => {
  assert.match(WITHDRAW, /pending\.element\.remove\(\)/, "撤卡");
  assert.match(WITHDRAW, /pending\.wrap\.replaceWith\(pending\.row\)/, "解壳回工具行");
  assert.match(WITHDRAW, /const labelKey = reason === "aborted" \? "D383" : "D977"/, "aborted 沿用「已停止」，done / error 标「未执行」");
  assert.match(WITHDRAW, /t\(labelKey\)/, "标签在落 DOM 时才取文案");
  assert.match(WITHDRAW, /pendingApprovals\.clear\(\)/, "清空集合（决策闭包随之失效）");
  assert.match(WITHDRAW, /settledAwaitingDone = null/, "清 done 抑制槽");
  assert.match(WITHDRAW, /refreshApprovalSignal\(\)/, "撤完之后重施，避免幻影状态");
});

test("终态：done / error / aborted 都在施加终态之前走同一撤回函数", () => {
  for (const kind of ["done", "error"] as const) {
    const block = switchCaseOf(HANDLE, kind);
    const withdraw = block.indexOf('withdrawPendingApprovals("unfinished")');
    const project = block.indexOf("projectActivity(vault, accounted, prevActivity)");
    assert.notEqual(withdraw, -1, `${kind} 必须撤回未决批准项`);
    assert.ok(project !== -1 && withdraw < project, `${kind} 的撤回必须排在终态投影之前`);
  }
  const aborted = switchCaseOf(HANDLE, "aborted");
  assert.match(aborted, /withdrawPendingApprovals\("aborted"\)/, "aborted 走同一函数");
  assertNoMatch(
    aborted,
    /for \(const pending of pendingApprovals\.values\(\)\)/,
    "aborted 的内联撤卡循环必须删除（不得保留第二份实现）",
  );
  const clears = [...stripComments(PANEL_SOURCE).matchAll(/pendingApprovals\.clear\(\)/g)];
  assert.equal(clears.length, 2, `清集合只允许两处：统一撤回 + 清面（实际 ${clears.length}）`);
});

test("新一轮：sent / auto_turn_started 置闸门之前清 stale（处理中的轮次不清合法待批）", () => {
  const started = PROJECT.slice(PROJECT.indexOf('case "turn_started":'), PROJECT.indexOf('case "terminal":'));
  const clear = started.indexOf('withdrawPendingApprovals("stale")');
  const open = started.indexOf("turnOpen = true");
  assert.notEqual(clear, -1, "新一轮开始前必须清上一视图的遗留待批");
  assert.ok(clear < open, "清 stale 必须在闸门打开之前");
  assert.match(started, /prev\.phase === "idle"/, "只有上一相位为空闲时才清（处理中的轮次不清）");
});

test("清面：pendingApprovals.clear() 之后重施（换会话 / 切 vault / 新会话 / 对账清面共用）", () => {
  const clear = CLEAR.indexOf("pendingApprovals.clear()");
  const refresh = CLEAR.indexOf("refreshApprovalSignal()");
  assert.notEqual(clear, -1);
  assert.ok(refresh > clear, "清完集合必须重施，否则幻影状态留在标题栏");
});

test("快照：待决列表重放结束后无条件重施（列表为空是幻影的主要出口）", () => {
  const loop = RESTORE.indexOf("for (const raw of pendingList)");
  const refresh = RESTORE.indexOf("refreshApprovalSignal()");
  const readings = RESTORE.indexOf("applyTaskReadings(state)");
  assert.ok(loop !== -1, "待决列表重放仍在");
  assert.ok(refresh > loop, "重施必须在重放之后");
  assert.ok(refresh < readings, "重施紧跟重放结束（不依赖后续读数路径）");
  // 不能写成「只在列表非空时重施」：空列表同样要把上一视图的幻影清掉。
  const around = RESTORE.slice(loop, refresh);
  assert.match(around, /^\s*\}\s*$/m, "重放循环必须闭合");
  assertNoMatch(around, /if \(pendingList\.length > 0\)/, "重施不得以列表非空为条件");
});

test("进入快照自身不清面（清理由构造 / resetView 的前置不变量承担）", () => {
  assertNoMatch(APPLY_ENTER, /clearTranscriptSurface|pendingApprovals\.clear/, "enter 不得内联清面");
  assertNoMatch(functionBodyOf(PANEL_SOURCE, "fetchActivitySnapshot"), /clearTranscriptSurface|pendingApprovals\.clear/);
});

test("子运行待批不计入父会话：任务区卡不调待批重施", () => {
  assertNoMatch(ATTACH_TASK, /refreshApprovalSignal|pendingApprovals\.clear/, "父子两条呈现路径不互相触发");
});

// ── 5. 发送最终几何：只加在 send()，且只有一次 ─────────────────────────────

test("send：beginSendActivity 之后按最终几何再回底一次（幂等；本文件内唯一一次跳底）", () => {
  const begin = SEND.indexOf("beginSendActivity(sendVault)");
  const jumps = [...SEND.matchAll(/follow\.jumpToBottom\(\)/g)];
  assert.equal(jumps.length, 1, `send() 里只允许一次显式跳底（实际 ${jumps.length}）`);
  assert.notEqual(begin, -1, "乐观起点仍在");
  assert.ok((jumps[0].index ?? 0) > begin, "第二跳必须在相位 / 进度块落定之后");
});

// ── 6. 段状态词的样式与收缩链路（design §6.1 / tasks 3.2）──────────────────

test("CSS：段状态词 flex:none / nowrap / --pending，[hidden] 零像素", () => {
  const block = /\.lumir-hp-seg-status\s*\{([\s\S]*?)\}/.exec(PANEL_CSS);
  assert.ok(block !== null, "缺 .lumir-hp-seg-status 规则");
  const body = block[1];
  assert.match(body, /flex:\s*none/, "状态词不参与收缩");
  assert.match(body, /white-space:\s*nowrap/);
  assert.match(body, /color:\s*var\(--pending\)/, "三主题均有定义，eink 为黑");
  assertNoMatch(body, /background|border|box-shadow/, "不新增底色 / 边框 / 阴影");
  assert.match(PANEL_CSS, /\.lumir-hp-seg-status\[hidden\]\s*\{\s*display:\s*none;/, "[hidden] 零像素");
});

test("CSS：会话名链路允许收缩（wrapper / button / sname 全部 flex 0 1 auto + min-width 0）", () => {
  const wrap = /\.lumir-hp-sessionwrap\s*\{([\s\S]*?)\}/.exec(PANEL_CSS);
  const button = /\.lumir-hp-session\s*\{([\s\S]*?)\}/.exec(PANEL_CSS);
  const sname = /\.lumir-hp-session \.lumir-hp-sname\s*\{([\s\S]*?)\}/.exec(PANEL_CSS);
  assert.ok(wrap !== null && button !== null && sname !== null);
  assert.match(wrap[1], /flex:\s*0 1 auto/);
  assert.match(wrap[1], /min-width:\s*0/);
  assert.match(button[1], /flex:\s*0 1 auto/);
  assert.match(button[1], /min-width:\s*0/);
  assert.match(sname[1], /min-width:\s*0/);
  assert.match(sname[1], /text-overflow:\s*ellipsis/, "省略号仍生效");
});
