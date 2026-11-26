// 留存健康的前端层单测（change add-persistence-health-status-nov23，design §4.4 / §4.7）：
//   - 快照 / 事件两路共用的宽容解析（缺键按旧后端：ok / 无缺口 / history_written=true）；
//   - 状态行文案的两维优先级（缺口优先、ok+gap 不呈现健康、未落盘提示的追加与消退）；
//   - 首次 history sticky 的触发条件（含 gap 首次出现；annotation 不触发；每会话一条）。
//
// 零 DOM 层（tests/unit/README.md）：状态行 / sticky 元素的真实渲染归 harness-panel 的接线，
// 本层用源码结构对账钉住四处不可从纯函数观测的接线：事件分支、快照路径、新会话 / 恢复重置、
// 切 vault 只藏行。判据与 spec 条款一一对应，注释里写明条款出处。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  persistenceEventAdmitted,
  persistenceSessionTokenOf,
  persistenceSnapshotAdmitted,
  persistenceStickyDue,
  persistenceText,
  persistenceViewOf,
} from "../../src/harness-panel.ts";
import { t } from "../../src/copy.ts";

const PANEL_SOURCE = readFileSync(new URL("../../src/harness-panel.ts", import.meta.url), "utf8");
const MAIN_SOURCE = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");
const TABS_SOURCE = readFileSync(new URL("../../src/tabs.ts", import.meta.url), "utf8");

// ── 快照 / 事件宽容解析（U5 / U6） ─────────────────────────────────────────

test("persistenceViewOf：旧快照缺 persistence / history_gap / history_written 键 → ok / 无缺口 / 不误报未落盘", () => {
  const view = persistenceViewOf(undefined);
  assert.deepEqual(view, { state: "ok", severity: null, historyWritten: true, gap: false });
  // 空对象同形（缺键不是「degraded」也不是「尚未落盘」）。
  assert.deepEqual(persistenceViewOf({}), {
    state: "ok",
    severity: null,
    historyWritten: true,
    gap: false,
  });
  assert.equal(persistenceText(persistenceViewOf(undefined)), null, "缺键不得显示状态行");
  assert.equal(
    persistenceStickyDue(persistenceViewOf(undefined), "/tmp/v", new Set()),
    false,
    "缺键不得弹 sticky",
  );
});

test("persistenceViewOf：显式两维读数原样带出（degraded / history / gap / history_written=false）", () => {
  const view = persistenceViewOf({
    state: "degraded",
    since_ts: 1795000000,
    severity: "history",
    detail: "llm_request:write",
    history_written: false,
    history_gap: { present: true, since_ts: 1795000001, detail: "llm_request:write" },
  });
  assert.deepEqual(view, {
    state: "degraded",
    severity: "history",
    historyWritten: false,
    gap: true,
  });
  // 非法 / 类型不符的字段不得把健康读成告警（宽容读，不误报）。
  assert.deepEqual(
    persistenceViewOf({ state: "weird", severity: "nope", history_written: "false", history_gap: { present: "true" } }),
    { state: "ok", severity: null, historyWritten: true, gap: false },
  );
});

// ── 状态行文案（U4 / U9 / U13） ───────────────────────────────────────────

test("persistenceText：ok 且无缺口 → null（隐藏，不打扰）", () => {
  assert.equal(
    persistenceText({ state: "ok", severity: null, historyWritten: false, gap: false }),
    null,
    "history_written=false 本身不构成告警",
  );
});

test("persistenceText：缺口优先且 ok+gap 不得呈现为健康", () => {
  assert.equal(
    persistenceText({ state: "ok", severity: null, historyWritten: true, gap: true }),
    t("D950"),
  );
  assert.equal(
    persistenceText({ state: "degraded", severity: "history", historyWritten: true, gap: true }),
    t("D951"),
  );
  assert.notEqual(
    persistenceText({ state: "ok", severity: null, historyWritten: true, gap: true }),
    null,
    "写入恢复但缺口仍在时 MUST NOT 回到健康态",
  );
});

test("persistenceText：degraded 无缺口按 severity 分档", () => {
  assert.equal(
    persistenceText({ state: "degraded", severity: "history", historyWritten: true, gap: false }),
    t("D952"),
  );
  assert.equal(
    persistenceText({ state: "degraded", severity: "annotation", historyWritten: true, gap: false }),
    t("D953"),
  );
  // severity 缺失（后端不该产出，防御）按 history 档，不静默成空。
  assert.equal(
    persistenceText({ state: "degraded", severity: null, historyWritten: true, gap: false }),
    t("D952"),
  );
});

test("persistenceText / 横幅文案：新文案 zh/en 逐字（Alex 2026-11-23 裁决）", () => {
  // 当前写失败：直说没保存 + 查磁盘 / 权限 + 恢复后继续写。
  assert.equal(
    t("D952", undefined, "zh"),
    "对话暂未保存。请检查磁盘空间或目录权限；恢复后会继续写入。",
  );
  assert.equal(
    t("D952", undefined, "en"),
    "This conversation isn't saved right now. Check disk space or folder permissions; writing will resume once it recovers.",
  );
  // 写入已恢复、历史仍有缺口：先说自己恢复，再说此前缺失。
  assert.equal(t("D950", undefined, "zh"), "此前部分对话记录未能保存；新内容已恢复写入。");
  assert.equal(
    t("D950", undefined, "en"),
    "Earlier messages couldn't be saved; new content is being written again.",
  );
  // 两者同时：当前失败与历史缺口同句，不拆成两条状态行。
  assert.equal(
    t("D951", undefined, "zh"),
    "对话暂未保存，此前部分记录也未能保存。请检查磁盘空间或目录权限；恢复后会继续写入。",
  );
  assert.equal(
    t("D951", undefined, "en"),
    "This conversation isn't saved right now, and earlier messages couldn't be saved either. Check disk space or folder permissions; writing will resume once it recovers.",
  );
  // 尚无 history 写入的退出风险：直白短句，不出现「落盘」等实现术语。
  assert.equal(t("D954", undefined, "zh"), "现在退出，这段对话将无法恢复。");
  assert.equal(t("D954", undefined, "en"), "If you quit now, this conversation can't be recovered.");
  // 首次 history sticky 与警示块同一口径。
  assert.equal(
    t("D955", undefined, "zh"),
    "对话暂未保存。若继续对话，这段历史可能无法完整恢复。",
  );
  assert.equal(
    t("D955", undefined, "en"),
    "This conversation isn't saved right now. If you keep chatting, this history may not be fully recoverable.",
  );
  // 文档横幅：主句先说未保存修改无备份 + 关闭可能丢失；数量 / 路径是次要信息，
  // 不出现「崩溃备份 / 首个」等实现术语。
  const bannerZh = t("D956", { n: "2", path: "notes/a.md" }, "zh");
  assert.equal(
    bannerZh,
    "未保存的修改暂时没有备份，关闭应用可能丢失。涉及 2 份文档（如 notes/a.md）。",
  );
  assert.ok(!bannerZh.includes("崩溃备份") && !bannerZh.includes("首个"));
  const bannerEn = t("D956", { n: "2", path: "notes/a.md" }, "en");
  assert.equal(
    bannerEn,
    "Unsaved changes have no backup right now; quitting the app may lose them. 2 documents affected (e.g. notes/a.md).",
  );
  assert.ok(!bannerEn.includes("crash backup"));
});

test("persistenceText：history_written=false + 告警追加未落盘提示；转 true 后该句消失、缺口文案仍在", () => {
  const gapNotWritten = persistenceText({
    state: "ok",
    severity: null,
    historyWritten: false,
    gap: true,
  });
  assert.equal(gapNotWritten, `${t("D950")} ${t("D954")}`);
  const gapWritten = persistenceText({
    state: "ok",
    severity: null,
    historyWritten: true,
    gap: true,
  });
  assert.equal(gapWritten, t("D950"));
  assert.ok(!gapWritten!.includes(t("D954")), "history_written 转 true 后未落盘提示必须消失");
  // degraded 无缺口同样追加（有告警即可，不限于缺口）。
  assert.equal(
    persistenceText({ state: "degraded", severity: "annotation", historyWritten: false, gap: false }),
    `${t("D953")} ${t("D954")}`,
  );
});

// ── 首次 history sticky（U7 / U11） ───────────────────────────────────────

test("persistenceStickyDue：annotation 只亮状态行；首次 history / gap 各触发一次；每会话一条", () => {
  const shown = new Set<string>();
  const annotation = { state: "degraded" as const, severity: "annotation" as const, historyWritten: true, gap: false };
  assert.equal(persistenceStickyDue(annotation, "/tmp/vault-a", shown), false);
  assert.equal(shown.size, 0, "annotation 不占「已提示」标记");

  const history = { state: "degraded" as const, severity: "history" as const, historyWritten: true, gap: false };
  assert.equal(persistenceStickyDue(history, "/tmp/vault-a", shown), true);
  shown.add("/tmp/vault-a");
  assert.equal(
    persistenceStickyDue(history, "/tmp/vault-a", shown),
    false,
    "同一逻辑会话只给一条（含 annotation→history 升级后的重复载荷）",
  );

  // 缺口首次出现也触发；另一个 vault 是另一个逻辑会话，可再次触发。
  const gap = { state: "ok" as const, severity: null, historyWritten: true, gap: true };
  assert.equal(persistenceStickyDue(gap, "/tmp/vault-b", shown), true);
  assert.equal(persistenceStickyDue(gap, "/tmp/vault-a", shown), false, "A 已提示过");
});

// ── 接线对账（U6 / U10 / U11 的不可从纯函数观测部分） ─────────────────────

function occurrenceCount(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

test("接线：事件分支与快照路径走同一份解析（U4 / U6）", () => {
  assert.equal(occurrenceCount(PANEL_SOURCE, 'case "persistence":'), 1, "handleEvent 缺 persistence 分支");
  assert.ok(
    PANEL_SOURCE.includes("applyPersistence(persistenceViewOf(event))"),
    "persistence 事件必须经同一份宽容解析落到状态行",
  );
  assert.ok(
    PANEL_SOURCE.includes(
      "applyPersistenceSnapshot(state.session_token, state.persistence, eventMarkAtRequest)",
    ),
    "快照恢复 / 重载 / 切回 vault 必须按 persistence 键 + 逻辑会话 token 重建",
  );
});

test("接线：新会话重置、恢复以完整快照为地板，切 vault 只藏行不清健康（U10 / U11 / P1-3）", () => {
  // 重置只在新会话一处调用；恢复路径只在**发起时捕获的**旧会话身份上退役，MUST NOT 在回执
  // 落地时退役当前水位（那会把先于回执到达的新会话 token 记进退役集，见 V6）。
  const newSession = PANEL_SOURCE.slice(
    PANEL_SOURCE.indexOf("function startNewSession("),
    PANEL_SOURCE.indexOf("segNew.addEventListener"),
  );
  assert.ok(
    newSession.includes("resetPersistenceView(previousToken);"),
    "resetPersistenceView 只应在 startNewSession 调用（恢复路径 MUST NOT 在回执里清告警）",
  );
  const resume = PANEL_SOURCE.slice(
    PANEL_SOURCE.indexOf("function resumeSession("),
    PANEL_SOURCE.indexOf("// 会话名下拉：展开/收起浮层"),
  );
  assert.ok(
    resume.includes("sessionTokens.adopt(actionVault, persistenceSessionTokenOf(info.session_token))"),
    "恢复必须采纳回执里的新逻辑会话 token",
  );
  assert.ok(
    resume.includes("const previousToken = sessionTokens.watermark(actionVault);"),
    "旧会话身份必须在恢复发起时定格",
  );
  assert.ok(
    resume.includes("sessionTokens.retire(actionVault, previousToken);"),
    "回执 / 迟到旧回包只退役发起时捕获的旧 token",
  );
  assert.ok(
    !resume.includes("sessionTokens.retire(actionVault);"),
    "恢复 MUST NOT 按回执落地时的水位退役（会退役新会话自己的 token）",
  );
  assert.ok(
    resume.includes("fetchPersistenceSnapshot();"),
    "恢复后的完整 persistence 快照必须是地板",
  );
  assert.ok(
    !resume.includes("resetPersistenceView()"),
    "恢复回执 MUST NOT 重置健康（会把先到的真实写失败告警抹掉）",
  );
  const vaultChanged = PANEL_SOURCE.slice(
    PANEL_SOURCE.indexOf("function vaultChanged("),
    PANEL_SOURCE.indexOf("function setPathLinkIndex("),
  );
  assert.ok(vaultChanged.includes("hidePersistenceLine();"), "切 vault 必须藏掉旧状态行");
  assert.ok(
    !vaultChanged.includes("resetPersistenceView"),
    "切 vault MUST NOT 清除健康 / 已提示标记（切回要显示该会话自己的缺口）",
  );
  assert.ok(
    PANEL_SOURCE.includes("historyStickyShown.delete(currentVault ?? \"\")"),
    "新逻辑会话的「已提示」标记按 vault 键作废，未来仍可再次触发",
  );
});

test("接线：警示块独立类 + role=status，健康时 hidden、无关闭按钮（不复用引用状态行）", () => {
  const start = PANEL_SOURCE.indexOf("const persistenceNote = document.createElement");
  const end = PANEL_SOURCE.indexOf(
    "composerArea.append(chip, quoteNote, persistenceNote, composerBox);",
  );
  assert.ok(start > 0 && end > start, "找不到 persistenceNote 的创建段");
  const declaration = PANEL_SOURCE.slice(start, end);
  assert.ok(declaration.includes('className = "lumir-hp-persist-warning"'));
  assert.ok(declaration.includes('dataset.persistenceHealth = "true"'));
  assert.ok(
    !declaration.includes("lumir-hp-quote-note"),
    "警示块不复用引用失败状态行的类（后者仍单行省略）",
  );
  assert.ok(declaration.includes('setAttribute("role", "status")'));
  assert.ok(declaration.includes("hidden = true"), "健康态初始 hidden（零占位）");
  assert.ok(
    !declaration.includes("button") && !declaration.includes("addEventListener"),
    "警示块不提供关闭按钮（关闭 sticky 不等于静音）",
  );
});

test("接线：history sticky 显式开启原生键盘关闭面，旧 sticky 调用不传 options", () => {
  assert.ok(
    PANEL_SOURCE.includes(
      'deps.stickyToast(t("D955"), { dismissible: true, dismissLabel: t("D961") })',
    ),
    "只有 history sticky 显式开启关闭钮（其他无动作 sticky 保持旧 DOM）",
  );
  assert.ok(
    MAIN_SOURCE.includes(
      'showToast(harnessPaneMount(), text, [], true, "neutral", undefined, {',
    ),
    "装配层把 options 透传给共享 sticky 实现",
  );
  assert.ok(MAIN_SOURCE.includes("options: ToastOptions = {}"), "options 缺省为空对象（旧调用零变化）");
  assert.ok(MAIN_SOURCE.includes('close.className = "toast-close"'), "原生关闭钮");
  assert.ok(
    MAIN_SOURCE.includes("const disposition = escapeDisposition(event)"),
    "Escape 准入必须复用 escapeDisposition（不得另写一套判据）",
  );
  assert.ok(
    MAIN_SOURCE.includes("restoreToastFocus(activeBeforeToast, options.focusFallback)"),
    "关闭后焦点回还到出现前的元素（失效时用 fallback）",
  );
  assert.ok(MAIN_SOURCE.includes("focusFallback: () =>"), "失效焦点回落到 composer");
  assert.ok(!MAIN_SOURCE.includes('event.key !== "Escape"'), "不得保留旁路判据");
});

test("接线：横幅订阅同时重绘横幅与标签条；两段各自接 saveAllDirty / checkRecovery（U1 / U12）", () => {
  assert.ok(MAIN_SOURCE.includes("save.onRecoveryFailureChange("));
  assert.match(
    MAIN_SOURCE,
    /save\.onRecoveryFailureChange\(\(\) => \{[\s\S]*?renderRecoveryBanner\(\);[\s\S]*?renderAllTabStrips\(\);[\s\S]*?\}\);/,
    "失败集合变化必须同时重绘横幅与标签读屏名",
  );
  assert.ok(MAIN_SOURCE.includes("() => void save.saveAllDirty()"), "写失败段给「全部保存」");
  assert.ok(MAIN_SOURCE.includes("() => void save.checkRecovery()"), "枚举失败段给「重新检查」");
  assert.ok(MAIN_SOURCE.includes('recoveryBanner.setAttribute("role", "status")'));
  assert.ok(MAIN_SOURCE.includes("recoveryBanner.hidden = true"), "健康态横幅 hidden、零占位");
  assert.ok(
    MAIN_SOURCE.includes("const failures = save.recoveryFailures();"),
    "横幅数据源只有 save-controller 的失败集合（不另存第二份）",
  );
});

test("接线：标签的备份失败后缀只进 aria-label / title，可见像素不变（U2 可见面）", () => {
  assert.ok(TABS_SOURCE.includes('const backupSuffix = backupFailed ? ` ${t("D960")}` : "";'));
  assert.ok(TABS_SOURCE.includes('open.setAttribute("aria-label", `${baseLabel}${backupSuffix}`);'));
  assert.ok(TABS_SOURCE.includes('open.title = `${path}${backupSuffix}`;'));
  // 反向：后缀不得进 .tab-name 的可见文本（renderTabs 里可见名仍是 name）。
  assert.ok(!TABS_SOURCE.includes("name = `${name}${backupSuffix}`"));
});

test("接线：状态行与横幅随语言切换重取（长驻文案不钉死旧语言）", () => {
  assert.match(
    PANEL_SOURCE,
    /function applyLabels\(\): void \{[\s\S]*?renderPersistenceLine\(\);/,
    "harness 状态行是长驻文案，applyLabels 必须按当前读数重取",
  );
  assert.match(
    MAIN_SOURCE,
    /onRelabel\(\(\) => \{[\s\S]*?renderRecoveryBanner\(\);/,
    "崩溃备份横幅是长驻文案，onRelabel 必须按当前失败集合重取",
  );
});


// ── 逻辑会话归属（P1-3） ──────────────────────────────────────────────────

test("persistenceSessionTokenOf：只接纳正有限数；缺失 / 0 / 非法 = null（旧后端或无会话）", () => {
  assert.equal(persistenceSessionTokenOf(42), 42);
  assert.equal(persistenceSessionTokenOf(1), 1);
  for (const bad of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, "42", {}]) {
    assert.equal(persistenceSessionTokenOf(bad), null, String(bad));
  }
});

test("persistenceEventAdmitted：旧后端放行、已退役丢弃、新会话首事件接纳、旧 token 不回退", () => {
  const retired = new Set([41]);
  // 旧后端没有 token：放行（不误报）。
  assert.equal(persistenceEventAdmitted(null, 42, retired), true);
  // 显式新会话 / 恢复后退役的旧 token：丢弃。
  assert.equal(persistenceEventAdmitted(41, null, retired), false);
  assert.equal(persistenceEventAdmitted(41, 42, retired), false);
  // 新会话尚未建立（current=null）：接纳第一条新事件。
  assert.equal(persistenceEventAdmitted(43, null, retired), true);
  // 同一 token / 更新的 token：接纳；更旧且未退役：丢弃（防串会话）。
  assert.equal(persistenceEventAdmitted(42, 42, retired), true);
  assert.equal(persistenceEventAdmitted(43, 42, retired), true);
  assert.equal(persistenceEventAdmitted(40, 42, retired), false);
});


test("persistenceSnapshotAdmitted：空会话 / 旧 token 快照不得覆盖已接纳的新 token", () => {
  const retired = new Set([41]);
  // 空会话快照（token 0 / 缺失）只有在当前也没有 token 时才能落地。
  assert.equal(persistenceSnapshotAdmitted(null, null, retired), true);
  assert.equal(persistenceSnapshotAdmitted(null, 43, retired), false);
  // 已退役 / 更旧 token：丢弃。
  assert.equal(persistenceSnapshotAdmitted(41, null, retired), false);
  assert.equal(persistenceSnapshotAdmitted(42, 43, retired), false);
  // 同一 token / 更新的 token：快照权威。
  assert.equal(persistenceSnapshotAdmitted(43, 43, retired), true);
  assert.equal(persistenceSnapshotAdmitted(44, 43, retired), true);
  assert.equal(persistenceSnapshotAdmitted(42, null, retired), true);
});

test("接线：轻量快照与 restoreSnapshot 共用带事件序号的准入，陈旧快照丢弃重读一次", () => {
  assert.ok(
    PANEL_SOURCE.includes(
      "applyPersistenceSnapshot(state.session_token, state.persistence, eventMarkAtRequest)",
    ),
    "restoreSnapshot 必须与轻量快照共用同一准入入口（带请求时事件序号）",
  );
  assert.match(
    PANEL_SOURCE,
    /function fetchSnapshot\([\s\S]*?const eventMark = persistenceEventRevision;[\s\S]*?restoreSnapshot\(json, mode, epoch, eventMark\)/,
    "完整快照请求必须捕获请求时的事件序号",
  );
  assert.match(
    PANEL_SOURCE,
    /if \(!applied && !retry\) \{[\s\S]*?fetchPersistenceSnapshot\(true\)/,
    "陈旧轻量快照必须丢弃并重读一次",
  );
});
