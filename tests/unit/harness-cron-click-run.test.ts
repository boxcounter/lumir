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
// `handleCronOpenSession` 的参数是对象类型字面量，`functionBodyOf` 的括号配对会把它当函数体
// 提前收尾——这里按「函数声明行 → 行首 `}`」切（本文件的函数体都不含行首单独成行的 `}`）。
function topLevelFunctionBodyOf(source: string, name: string): string {
  const start = source.search(new RegExp(`async function ${name}\\(`));
  if (start === -1) throw new Error(`源码里找不到 async function ${name}(`);
  const end = source.indexOf("\n}\n", start);
  if (end === -1) throw new Error(`function ${name} 的收尾行（行首 }）找不到`);
  return source.slice(start, end + 3);
}

const HANDLE_CRON_OPEN_SESSION = topLevelFunctionBodyOf(MAIN_SOURCE, "handleCronOpenSession");

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

test("handleCronRun：只有真正切屏成功才在失败时回滚（忙时未切屏 ⇒ 不重置渲染面）", () => {
  assert.match(
    HANDLE_CRON_RUN,
    /adopted = harnessPanel\.beginCronRun\(/,
    "必须接住 beginCronRun 的返回值：忙时它不切屏，失败路径也不能回滚",
  );
  const catchStart = HANDLE_CRON_RUN.search(/catch \(error\)/);
  assert.notEqual(catchStart, -1, "handleCronRun 必须有 catch 分支");
  const catchBody = HANDLE_CRON_RUN.slice(catchStart);
  assert.match(
    catchBody,
    /if \(adopted\) harnessPanel\.reloadSession\(\);/,
    "失败回滚必须以「本次确实切了屏」为条件——无条件 reloadSession 会 resetView 掉在途轮次的流式渲染（P2-1）",
  );
});

test("beginCronRun：忙时（活动相位非 idle）不切屏，在途轮次不受影响", () => {
  // 相位自 change add-harness-activity-presence 起由活动状态机持有（`activity.phase`）：
  // 判据语义不变（忙 ⇒ 不切屏、返回 false），只是读的字段换成了状态机的唯一持有者。
  const guard = BEGIN_CRON_RUN.search(/if \(activity\.phase !== "idle"\) return false;/);
  assert.notEqual(guard, -1, "beginCronRun 必须先判忙：交互槽位在途 ⇒ 后端必 busy，乐观切屏注定被回滚");
  const reset = BEGIN_CRON_RUN.search(/resetView\(\)/);
  assert.notEqual(reset, -1, "beginCronRun 正常路径必须清渲染面");
  assert.ok(guard < reset, "忙判定必须排在 resetView 之前——先清屏再判忙会把握手轮次的流式泡清掉（P2-1）");
  assert.match(BEGIN_CRON_RUN, /return false;/, "忙时返回 false（装配层据此跳过失败回滚）");
  assert.match(BEGIN_CRON_RUN, /return true;/, "切屏成功返回 true（装配层据此启用失败回滚）");
});

// ── 面板：切屏入口的判据 ───────────────────────────────────────────────────

test("beginCronRun：清渲染面 + prompt 上屏 + 开轮次闸门与发送相位", () => {
  assert.match(BEGIN_CRON_RUN, /resetView\(\)/, "切屏必须先清空上一段会话的渲染面");
  assert.match(BEGIN_CRON_RUN, /appendUserMessage\(/, "prompt 必须作为本轮用户消息上屏");
  // 闸门与相位由**同一个**接线层函数施加（change add-harness-activity-presence tasks 2.5：
  // 分散写会出现「相位收口了、闸门还开着」的半收口）：`dispatchActivity({ type: "sent" })`
  // 一次完成「相位入 running + turnOpen = true」，判据因此钉这条单一写入口。
  assert.match(
    BEGIN_CRON_RUN,
    /dispatchActivity\(\{ type: "sent" \}\)/,
    "轮次闸门与发送相位必须由状态机一并施加（否则正文分片被当作迟到产出丢弃、或半收口复活）",
  );
  assert.match(BEGIN_CRON_RUN, /cronRunAdopted = true/, "切屏态必须登记，收尾时据此重载快照");
});

test("done 收尾：cron 切屏态下按后端快照只重建内容（专用会话历史回屏，未读存活）", () => {
  const doneStart = PANEL_SOURCE.search(/case "done":/);
  assert.notEqual(doneStart, -1, "handleEvent 里找不到 done 分支");
  const doneEnd = PANEL_SOURCE.indexOf('case "aborted":', doneStart);
  assert.notEqual(doneEnd, -1, "done 分支之后找不到 aborted 分支（解析口径已过期）");
  const doneBody = PANEL_SOURCE.slice(doneStart, doneEnd);
  // 重载仍在（专用会话历史回屏、面板回到单一真源），但口径自 change
  // add-harness-activity-presence r1 P1-2 起改为**只内容档位**：`reloadSession` 经 `resetView`
  // 以 `vault_changed` 结算，会把本轮刚产生的未读吃掉（点击 cron → 收起 → 完成，指示退回空闲）。
  assert.match(doneBody, /const adopted = cronRunAdopted;/, "done 必须在派发前记住 cron 切屏态");
  assert.match(
    doneBody,
    /if \(takeover \|\| adopted\) fetchSnapshot\("content"\)/,
    "done 后必须按 cronRunAdopted 重建内容（与中途接管对账合并成一次只内容档快照）",
  );
  // 本仓钉的 @types/node 档没有声明 `assert.doesNotMatch`（运行时存在、类型面缺）。
  assert.equal(/reloadSession\(\)/.test(doneBody), false, "MUST NOT 复用会清未读的会话复位路径");
});

// ── 目标 vault 的打开交接（M752：同一点击链路上另行发现的合同内交接缺陷） ──────────
//
// 这一层判的是「点击运行前的 vault 交接」的三条不变量。判据是源码里的**判据与顺序**，
// 不是返回值（`ensureCronVault` 依赖整个装配层，零 DOM 单测跑不起来，理由同文件头）。
// 每条都配一份「旧实现形态」的反向样本先证判据有区分度（REVIEW.md「断言等价于子串」
// 条：没有区分度的断言写上去就是假绿）。
//
// **这不是 10-27 原事故的复现**：那次点击没有任何 `cron_click`，根因是投递进程已退出、
// 点击无接收方（新合同，未在本 mission 解决）。这里的三个缺陷是同一条链路上另行发现的
// 合同内问题——一旦点击真的到达，它们就会各自吃掉这次点击。

const ENSURE_CRON_VAULT = functionBodyOf(MAIN_SOURCE, "ensureCronVault");

/** 切换**之后**再判一次「打开成功了吗」的形态。判据只看 `switchToVault(` 之后的部分：
 *  切换前的前置判定不在这个判据里。 */
function reJudgesVaultOpenAfterSwitch(body: string): boolean {
  const switched = body.indexOf("switchToVault(");
  assert.notEqual(switched, -1, "ensureCronVault 必须仍走 switchToVault（既有唯一切换链路）");
  const after = body.slice(switched + "switchToVault(".length);
  return /loadedRoot\s*!==\s*root/.test(after) || /code:\s*"vault_not_open"/.test(after);
}

/** 切换前是否先过 dirty 前置门（`vaultSwitchBlock()` 的调用排在 `switchToVault(` 之前）。 */
function gatesOnDirtyBeforeSwitch(body: string): boolean {
  const gate = body.indexOf("vaultSwitchBlock()");
  const switched = body.indexOf("switchToVault(");
  return gate !== -1 && switched !== -1 && gate < switched;
}

/** 旧实现的形态（M752 之前的 `ensureCronVault`）：raw 字符串前置判 + 切完再判一次。
 *  两份反向样本是上面两个判据的**区分度证明**——判据认不出它们，就没有资格判真实现。 */
const LEGACY_ENSURE_VAULT = `
async function ensureCronVault(root: string): Promise<void> {
  if (loadedRoot === root) return;
  await switchToVault(root);
  if (loadedRoot !== root) {
    throw { code: "vault_not_open", message: "", params: {} };
  }
}`;

test("ensureCronVault 的判据有区分度：反向样本（旧实现）必须被判红", () => {
  assert.equal(
    reJudgesVaultOpenAfterSwitch(LEGACY_ENSURE_VAULT),
    true,
    "「切换后再判一次」的判据认不出旧实现的形态——这条断言没有区分度，等于没判",
  );
  assert.equal(
    gatesOnDirtyBeforeSwitch(LEGACY_ENSURE_VAULT),
    false,
    "dirty 门的判据认不出旧实现的形态——这条断言没有区分度，等于没判",
  );
});

test("ensureCronVault：切换成功后不再由前端复判「vault 是否已打开」（后端是这条判定的单一真源）", () => {
  assert.equal(
    reJudgesVaultOpenAfterSwitch(ENSURE_CRON_VAULT),
    false,
    "切换后 MUST NOT 再用配置原值判一次：`harness_cron_run` 已按 canonicalize 判同一件事，" +
      "前端拿未经规范化的绝对路径比较会在 symlink / 尾斜杠下把一次成功的切换判成失败" +
      "（REVIEW.md「同一语义两处真源」条）",
  );
});

test("ensureCronVault：有未保存修改时不切换 vault（点击不得拿用户的未保存内容当代价）", () => {
  assert.equal(
    gatesOnDirtyBeforeSwitch(ENSURE_CRON_VAULT),
    true,
    "切换会 editor.reset() 掉全部标签：必须先过既有守卫判据 save.vaultSwitchBlock()，且拦下时不得切换",
  );
  assert.match(
    ENSURE_CRON_VAULT,
    /vaultGuardText\(vaultName, [^)]*dirtyCount\)/,
    "拦下的理由要复用既有 D109 文案（点名当前 vault 与脏标签数）——不新增第二份文案",
  );
});

test("ensureCronVault：同一 vault 的判据与切换链路同源（samePath，只去尾斜杠），且命中即返回（标签状态原样保留）", () => {
  assert.match(
    ENSURE_CRON_VAULT,
    /samePath\(loadedRoot, root\)/,
    "同 vault 的判定必须走同一份路径对比（samePath），MUST NOT 用 `===` 比配置原值：尾斜杠差异下会误判成「另一个 vault」",
  );
  assert.equal(
    /loadedRoot === root/.test(ENSURE_CRON_VAULT),
    false,
    "`===` 判据已废止（见上一条）",
  );
  const sameVault = ENSURE_CRON_VAULT.search(/samePath\(loadedRoot, root\)\)?\s*return/);
  const switched = ENSURE_CRON_VAULT.search(/await switchToVault\(/);
  assert.ok(
    sameVault !== -1 && switched !== -1 && sameVault < switched,
    "同一 vault 必须提前返回：走到切换链路会重装树并作废全部标签（当前 TAB 状态必须原样保留）",
  );
  // `samePath` **只去尾斜杠**（`vault-switcher.ts` 的实现就是 strip + 字符串相等），不解析软链。
  // 软链路径的正确性不靠这个 fast path，而靠三件事：①fast path 未命中时**仍然会切换**
  // （不会被这层判成「另一个 vault」而拦下）；②切换后不再用 raw 值复判；③最终由后端
  // `harness_cron_run` 的 canonicalize 判「目标 vault 是否当前 vault」。下面两条把 ①③ 钉住。
  assert.match(
    ENSURE_CRON_VAULT,
    /await switchToVault\(root\)/,
    "fast path 未命中必须照常切换：软链形态下 samePath 判不出来，靠这条兜住（前端不做软链解析，也不该做）",
  );
  assert.equal(
    reJudgesVaultOpenAfterSwitch(ENSURE_CRON_VAULT),
    false,
    "切换后不得用 raw 值复判：软链错配的正确性由后端 canonicalize 终判（本条与上面一条共同构成「samePath 之外」的保障）",
  );
});

test("handleCronRun：先完成目标 vault 的交接再切面板屏（面板切屏属于已打开 vault 之内的事）", () => {
  const vault = HANDLE_CRON_RUN.search(/await ensureCronVault\(/);
  const adopt = HANDLE_CRON_RUN.search(/harnessPanel\.beginCronRun\(/);
  assert.notEqual(vault, -1, "handleCronRun 必须经 ensureCronVault 完成 vault 交接");
  assert.ok(
    vault < adopt,
    "vault 交接必须排在 beginCronRun 之前：切 vault 会重载面板的 vault 作用域，先切屏再换 vault 会把这次运行的渲染面丢掉",
  );
});

// ── 进程退出后的点击（change add-cron-notification-relaunch tasks §3.6）─────────────

test("handleCronOpenSession：恢复点击也走既有 vault 打开链路（dirty 前置门的三出口可直接用）", () => {
  // 恢复点击与前端的 `cron:run` 是两条事件，但**打开目标 vault 必须只有一条链路**：
  // `ensureCronVault` → `switchToVault`（内部含 dirty 三出口）。少了这一步，跨进程恢复会在
  // 「目标 vault 还没打开」时直接去 resume 会话，会话恢复静默失败。
  const guard = HANDLE_CRON_OPEN_SESSION.search(/await ensureCronVault\(payload\.vault\)/);
  assert.notEqual(guard, -1, "handleCronOpenSession 必须先 ensureCronVault（dirty 门与打开链路的唯一入口）");
  const resume = HANDLE_CRON_OPEN_SESSION.search(/await invoke\("harness_resume_session"/);
  assert.notEqual(resume, -1, "handleCronOpenSession 必须仍经 harness_resume_session 恢复会话");
  assert.ok(guard < resume, "vault 打开必须排在恢复会话之前——否则会话恢复发生在错误的 vault 上");
  assert.match(
    HANDLE_CRON_OPEN_SESSION,
    /errorText\(error\)/,
    "失败必须按既有错误码上屏（MUST NOT 新造第二套文案）",
  );
});
