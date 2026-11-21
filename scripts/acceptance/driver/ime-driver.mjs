// WKWebView 合成 IME 序列驱动（只在验收实例的 Vite dev server 注入）。
//
// 边界：本文件派发的 CompositionEvent / InputEvent 全部 `isTrusted: false`；DOM 默认动作由
// 驱动自己用 Range/文本节点执行。它证明产品 JS 路径（nativeEditGate、ListLayout 冻结、
// scheduleCompositionSettle、有界解析）在真实 WKWebView 里按观测到的序列工作，**不是**原生
// TSM / 候选窗 / marked text 的替代。原生终判仍归 156 / 262 人工矩阵。
//
// 协议：GET /__lumir-ime/command（runner 下发的单条命令）→ 执行 → POST /__lumir-ime/report。
// 报告不含真实 vault 内容；fixture 是合成文本。

const ENDPOINT = "/__lumir-ime";
const POLL_MS = 150;
const RENDER_FRAME_MS = 16;

if (!globalThis.__lumirImeDriver) {
  globalThis.__lumirImeDriver = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const fatal = (message) => {
    const error = new Error(message);
    error.fatal = true;
    throw error;
  };

  const findView = () => {
    const contents = [...document.querySelectorAll(".editor-pane .cm-content")];
    const views = contents.map((el) => el.cmTile?.root?.view).filter(Boolean);
    return (
      views.find((view) => view.hasFocus) ??
      views.find((view) => view.state.doc.toString().includes("词汇")) ??
      views[0] ??
      null
    );
  };

  const lineAt = (view, lineNo) => {
    const doc = view.state.doc;
    if (!Number.isInteger(lineNo) || lineNo < 1 || lineNo > doc.lines) fatal(`目标行 ${lineNo} 不在文档里（共 ${doc.lines} 行）`);
    const line = doc.line(lineNo);
    // fixture 的目标行是 `- `：内容起点在 marker + 一个空格之后；空项也钳到行末。
    const pos = Math.min(line.to, line.from + 2);
    return { line, pos };
  };

  const lineElement = (view, lineNo) => view.contentDOM.querySelectorAll(".cm-line")[lineNo - 1] ?? null;
  const lineText = (view, lineNo) => lineElement(view, lineNo)?.textContent ?? "";
  const markerCount = (view, lineNo) => lineElement(view, lineNo)?.querySelectorAll(".cm-lp-list-marker").length ?? 0;

  const treeAvailable = (view, pos) => {
    const values = view.state.values ?? [];
    const lang = values.find((value) => value && typeof value === "object" && "context" in value && "tree" in value);
    return Boolean(lang?.context?.isDone?.(Math.min(pos, view.state.doc.length)));
  };

  const sample = (view, lineNo, targetPos) => {
    const doc = view.state.doc;
    return {
      doc: doc.toString(),
      doc_len: doc.length,
      marker: markerCount(view, lineNo),
      prev_dom: lineText(view, lineNo - 1),
      target_dom: lineText(view, lineNo),
      next_dom: lineText(view, lineNo + 1),
      head: view.state.selection.main.head,
      target_pos: targetPos,
      composing: view.compositionStarted,
      available: treeAvailable(view, doc.line(lineNo).to),
    };
  };

  const focusAt = async (view, pos) => {
    view.focus();
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    await nextFrame();
    // CM 的模型选区更新与 DOM Selection 不一定同一拍；显式把 DOM Selection 放到目标位，
    // 否则连续 case 会沿用上一 case 留下的 DOM 位置（实测 delete-empty 的 s 落在行首）。
    const dom = view.domAtPos(pos);
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(dom.node, dom.offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    await nextFrame();
    if (!selection || selection.rangeCount === 0 || !view.contentDOM.contains(selection.anchorNode)) {
      fatal("DOM Selection 未落在编辑器 contentDOM 内（焦点/选区前置失败）");
    }
    if (view.state.selection.main.head !== pos) {
      fatal(`DOM Selection 已设置但模型选区 head=${view.state.selection.main.head}，期望 ${pos}`);
    }
  };

  const inputEvent = (type, inputType, data, isComposing) => {
    const event = new InputEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: data ?? null,
      isComposing: Boolean(isComposing),
    });
    if (event.inputType !== inputType) Object.defineProperty(event, "inputType", { value: inputType });
    if (event.isComposing !== Boolean(isComposing)) Object.defineProperty(event, "isComposing", { value: Boolean(isComposing) });
    return event;
  };

  const compositionEvent = (type, data = "") =>
    new CompositionEvent(type, { bubbles: true, cancelable: true, composed: true, data });

  const insertTextAtSelection = (view, text) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) fatal("没有 DOM Selection，无法改 DOM Range");
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const node = document.createTextNode(text);
    range.insertNode(node);
    const after = document.createRange();
    after.setStart(node, node.nodeValue.length);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
    return node;
  };

  const replaceMarkedText = (node, text) => {
    if (!node || !node.isConnected) fatal("marked text 文本节点已失联，无法替换");
    node.nodeValue = text;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(node, node.nodeValue.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const deleteLastGrapheme = (node) => {
    if (!node || !node.isConnected) return false;
    const chars = Array.from(node.nodeValue ?? "");
    if (chars.length === 0) return false;
    node.nodeValue = chars.slice(0, -1).join("");
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(node, node.nodeValue.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  };

  const waitDoc = async (view, predicate, timeoutMs = 3000) => {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (predicate(view.state.doc.toString())) return true;
      await nextFrame();
    }
    return false;
  };

  const waitSettled = async (view, lineNo, expectedMarker, timeoutMs) => {
    const started = performance.now();
    let lastDoc = null;
    let stable = 0;
    let peak = 0;
    let prevMinLen = Infinity;
    let prevFinal = "";
    let nextFinal = "";
    let settleTimeout = false;
    while (performance.now() - started < timeoutMs) {
      await nextFrame();
      const reading = sample(view, lineNo, 0);
      peak = Math.max(peak, reading.marker);
      prevMinLen = Math.min(prevMinLen, reading.prev_dom.length);
      prevFinal = reading.prev_dom;
      nextFinal = reading.next_dom;
      if (reading.doc === lastDoc) stable += 1;
      else {
        stable = 0;
        lastDoc = reading.doc;
      }
      if (!view.compositionStarted && stable >= 2 && reading.marker === expectedMarker) {
        return { peak, prevMinLen, prevFinal, nextFinal, settleMs: performance.now() - started, settleTimeout: false };
      }
      await sleep(RENDER_FRAME_MS);
    }
    settleTimeout = true;
    const final = sample(view, lineNo, 0);
    return {
      peak,
      prevMinLen: prevMinLen === Infinity ? 0 : prevMinLen,
      prevFinal: prevFinal || final.prev_dom,
      nextFinal: nextFinal || final.next_dom,
      settleMs: performance.now() - started,
      settleTimeout,
    };
  };

  const runCase = async (cmd) => {
    const view = findView();
    if (!view) fatal("找不到编辑器 EditorView（.editor-pane .cm-content 无 cmTile）");
    const { line, pos } = lineAt(view, cmd.line);
    const targetLine = cmd.line;
    const base = view.state.doc.toString();
    const report = {
      id: cmd.id,
      run_tag: cmd.runTag,
      case: cmd.case,
      fatal: false,
      error: "",
      synthetic: true,
      event_sequence: [],
      saw_composition_start: false,
      saw_insert_composition_text: false,
      saw_insert_from_composition: false,
      saw_composition_end: false,
      target_line: targetLine,
      target_line_text: line.text,
      target_pos: pos,
      start_pos: pos,
      doc_before: base,
      doc_during: base,
      doc_final: base,
      marker_before: markerCount(view, targetLine),
      marker_during: markerCount(view, targetLine),
      marker_peak: 0,
      marker_final: 0,
      prev_dom_during: lineText(view, targetLine - 1),
      prev_dom_final: lineText(view, targetLine - 1),
      prev_min_len: Infinity,
      prev_never_empty: false,
      next_dom_final: lineText(view, targetLine + 1),
      settle_ms: 0,
      settle_timeout: false,
      parse_pending_at_end: false,
      delete_prevented: null,
      commit_prevented: null,
      model_updated_after_commit: false,
      dom_edit: "range",
    };

    await focusAt(view, pos);
    const content = view.contentDOM;
    content.dispatchEvent(compositionEvent("compositionstart"));
    await nextFrame();
    if (!view.compositionStarted) fatal("compositionstart 后 view.compositionStarted 仍为 false");
    report.saw_composition_start = true;
    report.event_sequence.push("compositionstart");

    const beforeInput = inputEvent("beforeinput", "insertCompositionText", cmd.case === "commit" ? "是" : "s", true);
    const insertNotPrevented = content.dispatchEvent(beforeInput);
    if (!insertNotPrevented) fatal("insertCompositionText 被 preventDefault（不在预期路径上）");
    report.event_sequence.push("beforeinput:insertCompositionText");
    report.saw_insert_composition_text = true;
    const text = cmd.text;
    const marked = insertTextAtSelection(view, text);
    content.dispatchEvent(inputEvent("input", "insertCompositionText", text, true));
    report.event_sequence.push("input:insertCompositionText");
    if (!(await waitDoc(view, (doc) => doc.length > base.length))) fatal("insertCompositionText 后模型 doc 未更新");
    report.doc_during = view.state.doc.toString();
    report.marker_during = markerCount(view, targetLine);
    report.prev_dom_during = lineText(view, targetLine - 1);

    if (cmd.case === "compose") {
      // 取消组合：撤掉 marked text，再结束组合；doc MUST 回到基线。
      marked.nodeValue = "";
      content.dispatchEvent(inputEvent("input", "deleteCompositionText", null, true));
      content.dispatchEvent(compositionEvent("compositionend"));
      report.saw_composition_end = true;
      report.event_sequence.push("compositionend");
    } else if (cmd.case === "delete-empty") {
      const before = inputEvent("beforeinput", "deleteCompositionText", null, true);
      const notPrevented = content.dispatchEvent(before);
      report.delete_prevented = !notPrevented;
      report.event_sequence.push("beforeinput:deleteCompositionText");
      if (notPrevented) {
        deleteLastGrapheme(marked);
        content.dispatchEvent(inputEvent("input", "deleteCompositionText", null, true));
        report.event_sequence.push("input:deleteCompositionText");
      }
      content.dispatchEvent(compositionEvent("compositionend"));
      report.saw_composition_end = true;
      report.event_sequence.push("compositionend");
    } else if (cmd.case === "commit") {
      const commit = cmd.commit;
      if (typeof commit !== "string" || commit === "") fatal("commit case 缺少候选项文本");
      const before = inputEvent("beforeinput", "insertFromComposition", commit, true);
      const notPrevented = content.dispatchEvent(before);
      report.commit_prevented = !notPrevented;
      report.event_sequence.push("beforeinput:insertFromComposition");
      report.saw_insert_from_composition = true;
      if (notPrevented) {
        replaceMarkedText(marked, commit);
        content.dispatchEvent(inputEvent("input", "insertFromComposition", commit, true));
        report.event_sequence.push("input:insertFromComposition");
      }
      // 同一任务内结束组合：不得 await/requestAnimationFrame，否则 CM 的 MutationObserver
      // 先 flush，scheduleCompositionSettle 的 pending 竞态消失。
      content.dispatchEvent(compositionEvent("compositionend"));
      report.saw_composition_end = true;
      report.event_sequence.push("compositionend");
    } else {
      fatal(`未知 case ${cmd.case}`);
    }

    const expectedMarker = cmd.case === "commit" ? 1 : 0;
    const settled = await waitSettled(view, targetLine, expectedMarker, cmd.timeoutMs);
    const final = sample(view, targetLine, pos);
    report.doc_final = final.doc;
    report.marker_final = final.marker;
    report.marker_peak = Math.max(report.marker_during, settled.peak, final.marker);
    report.prev_dom_final = settled.prevFinal;
    report.prev_min_len = settled.prevMinLen;
    report.prev_never_empty = settled.prevMinLen > 0;
    report.next_dom_final = settled.nextFinal;
    report.settle_ms = Math.round(settled.settleMs);
    report.settle_timeout = settled.settleTimeout;
    report.parse_pending_at_end = !final.available;
    report.model_updated_after_commit = cmd.case !== "commit" || final.doc.includes("是");
    return report;
  };

  const postReport = async (report) => {
    await fetch(`${ENDPOINT}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
    }).catch(() => {});
  };

  let lastId = null;
  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      const response = await fetch(`${ENDPOINT}/command`, { cache: "no-store" });
      if (response.status !== 200) return;
      const cmd = await response.json();
      if (!cmd || cmd.id === lastId) return;
      lastId = cmd.id;
      let report;
      try {
        report = await runCase(cmd);
      } catch (error) {
        report = {
          id: cmd.id,
          run_tag: cmd.runTag,
          case: cmd.case,
          fatal: true,
          error: String(error?.message ?? error),
          synthetic: true,
          event_sequence: [],
        };
      }
      await postReport(report);
    } catch {
      // 端点暂不可达 / 页面正在卸载：下一次轮询重试。
    } finally {
      running = false;
    }
  };

  fetch(`${ENDPOINT}/ready`, { method: "POST" }).catch(() => {});
  setInterval(() => void poll(), POLL_MS);
  void poll();
  console.log("[lumir-ime-driver] ready");
}
