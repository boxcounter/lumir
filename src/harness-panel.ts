// Harness 对话面板（M303，change add-harness-probe，design §10 面板 UI）。
//
// 形态：应用骨架右栏 dock（网格第三列，0px ↔ --layout-dock-w，切换类在 style.css 的
// .app-shell.dock-open）+ 标题栏动作钮槽位的 toggle 钮（产品标识块左侧）。面板 DOM 与
// toggle 钮 DOM 全部由本模块自建（不碰 src/shell.ts——M303 的 scope 不含它，且「容器归
// shell、内容归能力模块」与本文件的分工一致：shell 只提供挂点）。
//
// 分层纪律（ADR 0007 Decision 3）：
//   - 上下文组装在 src/harness-context.ts（只依赖 EditorHandle，本模块是它的唯一消费者）；
//   - 全部后端进出经 src/ipc.ts 的薄封装（tower 钉死的 harness_* 契约）；
//   - 面板只是渲染器：会话状态在 Rust，webview 重载后经 harness_state() 快照恢复渲染。
//
// 渲染纪律（spec harness「对话面板」+ design §10）：
//   - 流式渲染走 rAF 合帧：text_chunk 先进缓冲，rAF 里一次落地——不触碰 CodeMirror 状态，
//     keypress-to-paint 路径零新增（ADR 0002 §6）；纯 DOM，不挂 CodeMirror。
//   - assistant 消息按 Markdown 渲染：解析用已在依赖里的 @lezer/markdown（GFM extension，
//     零新 npm 依赖——选型记录见 mission notes，基准 = GFM 基本面 + 零 XSS 面）；产出全部
//     经 DOM API + textContent 注入，本模块没有任何 innerHTML / outerHTML 赋值——XSS 面
//     因此无由发生（模型输出里的 HTML 块按转义文本展示，永不解析成标记）。
//   - 代码高亮复用既有体系：highlightCode（src/preview/code.ts）出 token、cm-lp-tok-* 类名
//     与编辑器同源；色值经 mirrorThemeScope（src/overlay-scope.ts）把 preview 主题的 scope
//     类镜像到 transcript 容器上——规则值仍只有 src/preview/theme.ts 一处（单一来源），
//     与表格 / 代码块全屏浮层同一条机制。
//   - 流式期间按块增量重渲：已完成块渲染一次不再动，只有进行中的末块随 chunk 重渲；
//     done 到达后对完整源做一次全量重渲（增量渲染在「跨空行的松散列表」这类形态上是
//     近似，全量重渲是收敛点——近似只存在于流式期间）。
//
// 文案：全部取值经 src/copy.ts 的 t()（D326–D348）；长驻元素（标题 / toggle 钮 / 输入框
// placeholder / 按钮 / 用量条 / 上下文 chip / 警示条 / 待决批准项）注册 onRelabel，语言切换
// 时从已存状态重渲（design §5.2 的不变量）；transcript 的历史条目是已发生事实的记录，不随
// 语言切换改写（与 toast 历史同口径）。

import { GFM, parser as commonmarkParser } from "@lezer/markdown";
import { onRelabel, t } from "./copy";
import {
  errorMessage,
  harnessApprove,
  harnessNewSession,
  harnessSend,
  harnessState,
  onHarnessEvent,
  openExternalUrl,
} from "./ipc";
import type { HarnessEvent } from "./ipc";
import { assembleHarnessContext, serializeHarnessContext } from "./harness-context";
import type { HarnessContextBlock, HarnessContextSource } from "./harness-context";
import { highlightCode } from "./preview/code";
import { mirrorThemeScope } from "./overlay-scope";
import type { AppShell } from "./shell";

/** 面板对编辑器句柄的结构需求：上下文组装（HarnessContextSource）+ 关面板时的焦点归还 +
 *  主题 scope 镜像的源元素（view.dom）。写成窄接口，不消费 EditorHandle 的其余面。 */
export interface HarnessPanelEditor extends HarnessContextSource {
  view: HarnessContextSource["view"] & { dom: HTMLElement; focus(): void };
}

export interface HarnessPanelDeps {
  shell: AppShell;
  editor: HarnessPanelEditor;
}

export interface HarnessPanelHandle {
  /** 唤起 / 收起（harness.toggle 命令与标题栏 toggle 钮共用这一条路径）。 */
  toggle(): void;
  isOpen(): boolean;
}

/** 上下文警示阈值的后备值（design §11：默认 85%）。权威值在 [harness].warn_ctx_pct
 *（Rust 侧），快照里带 warn_ctx_pct 时以它为准；快照缺它（或后端未到）用本值。 */
const FALLBACK_WARN_CTX_PCT = 85;

// ---------------------------------------------------------------------------
// Markdown → DOM（零 XSS：纯 DOM API + textContent；解析器 = @lezer/markdown 的 GFM 配置）
// ---------------------------------------------------------------------------

const mdParser = commonmarkParser.configure([GFM]);

/** @lezer/common 不是直接依赖，SyntaxNode 类型从解析器返回值派生。 */
type MdSyntaxNode = ReturnType<typeof mdParser.parse>["topNode"];

/** 不产出的节点：各类「标记」（** 的星号、代码围栏的 ```、链接的 []()、引用的 > 等）与
 *  链接定义行。它们是有名子节点，跳过即可；节点之间的纯文本由间隙填充承担（见
 *  renderInlineChildren——lezer 不给纯文本包节点，有名子节点之间的区间就是文本）。 */
const SKIP_NODES = new Set([
  "EmphasisMark",
  "CodeMark",
  "StrikethroughMark",
  "LinkMark",
  "LinkTitle",
  "URL",
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "LinkReference",
  "Comment",
]);

function textOf(doc: string, node: MdSyntaxNode): string {
  return doc.slice(node.from, node.to);
}

/** 行内渲染：有名子节点逐个交给 renderInlineNode，节点间隙是纯文本直接落地。 */
function renderInlineChildren(container: HTMLElement, node: MdSyntaxNode, doc: string): void {
  let pos = node.from;
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.from > pos) container.append(document.createTextNode(doc.slice(pos, child.from)));
    renderInlineNode(container, child, doc);
    pos = Math.max(pos, child.to);
  }
  if (node.to > pos) container.append(document.createTextNode(doc.slice(pos, node.to)));
}

function renderInlineNode(container: HTMLElement, node: MdSyntaxNode, doc: string): void {
  switch (node.name) {
    case "Emphasis": {
      const el = document.createElement("em");
      container.append(el);
      renderInlineChildren(el, node, doc);
      return;
    }
    case "StrongEmphasis": {
      const el = document.createElement("strong");
      container.append(el);
      renderInlineChildren(el, node, doc);
      return;
    }
    case "Strikethrough": {
      const el = document.createElement("s");
      container.append(el);
      renderInlineChildren(el, node, doc);
      return;
    }
    case "InlineCode": {
      // 类名与编辑器行内代码同源（cm-lp-inline-code）：镜像的 preview 主题把同一颗
      // 药丸样式带进来，面板与正文读起来是同一个东西（REVIEW.md 第 8 条：不另造第二套）。
      const el = document.createElement("code");
      el.className = "cm-lp-inline-code";
      const codeText = node.getChild("CodeText");
      el.textContent = codeText !== null ? textOf(doc, codeText) : textOf(doc, node).replace(/^`|`$/g, "");
      container.append(el);
      return;
    }
    case "Link":
    case "Autolink": {
      const urlNode = node.getChild("URL");
      const href = urlNode !== null ? textOf(doc, urlNode) : "";
      const el = document.createElement("a");
      el.className = "lumir-hp-link";
      // href 只作展示与 title，导航一律被拦下交给 openExternalUrl（scheme 白名单在
      // Rust 侧判定，前端不自行判能不能开——与编辑器内外链同一条信任边界）。
      el.href = href;
      el.title = href;
      el.addEventListener("click", (event) => {
        event.preventDefault();
        if (href !== "") openExternalUrl(href).catch(() => {});
      });
      if (node.name === "Autolink") {
        el.textContent = textOf(doc, node).replace(/^<|>$/g, "");
      } else {
        renderInlineChildren(el, node, doc);
      }
      container.append(el);
      return;
    }
    case "Image": {
      // 不加载模型给出的图片 URL（隐私与 CSP 双重考量）：按转义文本展示引用原文。
      container.append(document.createTextNode(textOf(doc, node)));
      return;
    }
    case "HardBreak": {
      container.append(document.createElement("br"));
      return;
    }
    case "Escape": {
      // Escape 节点覆盖 `\x` 两个字符，上屏的是被转义的那个字符。
      container.append(document.createTextNode(doc.slice(node.from + 1, node.to)));
      return;
    }
    default: {
      if (SKIP_NODES.has(node.name)) return;
      if (node.firstChild !== null) {
        renderInlineChildren(container, node, doc);
      } else {
        container.append(document.createTextNode(textOf(doc, node)));
      }
    }
  }
}

/** 代码块（围栏 / 缩进共用）：highlightCode 出 token，span + cm-lp-tok-* 类（与编辑器
 *  代码块同一张 role 表、同一份色值——镜像 scope 后 theme.ts 的规则直接命中）。 */
function buildCodeBlock(code: string, info: string): HTMLElement {
  const pre = document.createElement("pre");
  pre.className = "lumir-hp-codeblock";
  const codeEl = document.createElement("code");
  pre.append(codeEl);
  const tokens = highlightCode(code, info);
  let pos = 0;
  for (const token of tokens) {
    if (token.from > pos) codeEl.append(document.createTextNode(code.slice(pos, token.from)));
    const span = document.createElement("span");
    span.className = token.cls;
    span.textContent = code.slice(token.from, token.to);
    codeEl.append(span);
    pos = token.to;
  }
  if (code.length > pos) codeEl.append(document.createTextNode(code.slice(pos)));
  return pre;
}

/** 块级渲染：top-level 节点 → 块元素。不认识的块按转义文本段落落地（可见但惰性）。 */
function renderBlock(container: HTMLElement, node: MdSyntaxNode, doc: string): void {
  const heading = /^ATXHeading([1-6])$/.exec(node.name);
  if (heading !== null || node.name === "SetextHeading1" || node.name === "SetextHeading2") {
    const level = heading !== null ? heading[1] : node.name === "SetextHeading1" ? "1" : "2";
    const el = document.createElement(`h${level}`);
    renderInlineChildren(el, node, doc);
    container.append(el);
    return;
  }
  switch (node.name) {
    case "Paragraph": {
      const el = document.createElement("p");
      renderInlineChildren(el, node, doc);
      container.append(el);
      return;
    }
    case "BulletList":
    case "OrderedList": {
      const el = document.createElement(node.name === "BulletList" ? "ul" : "ol");
      for (let child = node.firstChild; child !== null; child = child.nextSibling) {
        if (child.name !== "ListItem") continue;
        const li = document.createElement("li");
        for (let item = child.firstChild; item !== null; item = item.nextSibling) {
          if (item.name === "TaskMarker") {
            const marker = document.createElement("span");
            marker.className = "lumir-hp-task";
            marker.textContent = textOf(doc, item);
            li.append(marker, document.createTextNode(" "));
            continue;
          }
          renderBlock(li, item, doc);
        }
        el.append(li);
      }
      container.append(el);
      return;
    }
    case "Blockquote": {
      const el = document.createElement("blockquote");
      for (let child = node.firstChild; child !== null; child = child.nextSibling) {
        renderBlock(el, child, doc);
      }
      container.append(el);
      return;
    }
    case "FencedCode": {
      const infoNode = node.getChild("CodeInfo");
      const textNode = node.getChild("CodeText");
      container.append(
        buildCodeBlock(
          textNode !== null ? textOf(doc, textNode) : "",
          infoNode !== null ? textOf(doc, infoNode).trim() : "",
        ),
      );
      return;
    }
    case "CodeBlock": {
      container.append(buildCodeBlock(textOf(doc, node), ""));
      return;
    }
    case "Table": {
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const tbody = document.createElement("tbody");
      for (let child = node.firstChild; child !== null; child = child.nextSibling) {
        if (child.name === "TableDelimiter") continue;
        const row = document.createElement("tr");
        const cellTag = child.name === "TableHeader" ? "th" : "td";
        for (let cell = child.firstChild; cell !== null; cell = cell.nextSibling) {
          if (cell.name !== "TableCell") continue;
          const td = document.createElement(cellTag);
          renderInlineChildren(td, cell, doc);
          row.append(td);
        }
        (child.name === "TableHeader" ? thead : tbody).append(row);
      }
      if (thead.childElementCount > 0) table.append(thead);
      if (tbody.childElementCount > 0) table.append(tbody);
      container.append(table);
      return;
    }
    case "HorizontalRule": {
      container.append(document.createElement("hr"));
      return;
    }
    case "HTMLBlock":
    case "CommentBlock": {
      // 模型输出里的 HTML：转义成文本展示（MUST NOT 直插 HTML——它永不解析成标记）。
      const pre = document.createElement("pre");
      pre.className = "lumir-hp-codeblock lumir-hp-rawhtml";
      pre.textContent = textOf(doc, node);
      container.append(pre);
      return;
    }
    default: {
      if (SKIP_NODES.has(node.name)) return;
      if (node.name === "Document") {
        let child = node.firstChild;
        while (child !== null) {
          renderBlock(container, child, doc);
          child = child.nextSibling;
        }
        return;
      }
      const el = document.createElement("p");
      el.textContent = textOf(doc, node);
      container.append(el);
    }
  }
}

/** 一段完整 Markdown → 追加渲染到容器（多块）。 */
function renderMarkdownInto(container: HTMLElement, source: string): void {
  const tree = mdParser.parse(source);
  renderBlock(container, tree.topNode, source);
}

/**
 * 流式源 → 「已完成块 / 进行中尾块」切分：块边界 = 代码围栏之外的空行。围栏内（``` / ~~~
 * 之间）的空行不是边界——那是代码的一部分。返回 finalized（可安全一次性渲染、渲染后不
 * 再变）与 tail（每帧重渲）的分界偏移。
 */
function finalizedUpTo(source: string): number {
  let inFence: string | null = null;
  let boundary = 0;
  let offset = 0;
  for (const line of source.split("\n")) {
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence !== null) {
      if (inFence === null) inFence = fence[1][0];
      else if (fence[1][0] === inFence) inFence = null;
    } else if (inFence === null && line.trim() === "") {
      // +1 把空行本身吃进 finalized：末块从重渲区里整段退出。
      boundary = offset + line.length + 1;
    }
    offset += line.length + 1;
  }
  return boundary;
}

// ---------------------------------------------------------------------------
// 面板本体
// ---------------------------------------------------------------------------

interface UsageReading {
  ctx: number;
  cache: number;
}

/** 待决批准项的已存数据（relabel 时据此重渲，不丢按钮状态）。 */
interface PendingApproval {
  id: string;
  tool: string;
  diff?: string | undefined;
  argv?: string | undefined;
  element: HTMLElement;
}

export function createHarnessPanel(deps: HarnessPanelDeps): HarnessPanelHandle {
  const { shell, editor } = deps;

  // ── DOM：toggle 钮（标题栏动作钮槽位，产品标识块左侧）────────────────────
  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "titlebar-action lumir-hp-toggle";
  toggleButton.setAttribute("aria-pressed", "false");
  // 「别抢焦点」的 mousedown preventDefault MUST NOT 挂容器级元素（REVIEW.md 第 16 条）——
  // 这里挂在具体按钮上，与 tabs.ts 那处同口径。
  shell.titlebar.insertBefore(toggleButton, shell.titlebarIdentity.block);

  // ── DOM：面板本体（dock 列，网格第三列）──────────────────────────────────
  const panel = document.createElement("aside");
  panel.className = "lumir-harness";
  panel.hidden = true;

  const head = document.createElement("header");
  head.className = "lumir-hp-head";
  const title = document.createElement("span");
  title.className = "lumir-hp-title";
  const usage = document.createElement("span");
  usage.className = "lumir-hp-usage";
  const newSession = document.createElement("button");
  newSession.type = "button";
  newSession.className = "lumir-hp-newsession";
  head.append(title, usage, newSession);

  const warn = document.createElement("div");
  warn.className = "lumir-hp-warn";
  warn.hidden = true;

  const transcript = document.createElement("div");
  transcript.className = "lumir-hp-transcript";
  // preview 主题 scope 镜像：cm-lp-tok-* 着色与 cm-lp-inline-code 药丸的规则值只定义在
  // src/preview/theme.ts 一处，这里只搬 scope 类（机制与守卫见 src/overlay-scope.ts）。
  mirrorThemeScope(editor.view.dom, transcript, "lumir-hp-transcript");

  const emptyHint = document.createElement("div");
  emptyHint.className = "lumir-hp-empty";

  const chip = document.createElement("div");
  chip.className = "lumir-hp-chip";

  const composer = document.createElement("textarea");
  composer.className = "lumir-hp-composer";
  composer.rows = 3;
  const sendButton = document.createElement("button");
  sendButton.type = "button";
  sendButton.className = "lumir-hp-send";
  const composerRow = document.createElement("div");
  composerRow.className = "lumir-hp-composer-row";
  composerRow.append(composer, sendButton);

  panel.append(head, warn, transcript, chip, composerRow);
  shell.root.append(panel);

  // ── 状态 ─────────────────────────────────────────────────────────────────
  let open = false;
  let busy = false;
  let warnCtxPct = FALLBACK_WARN_CTX_PCT;
  let lastUsage: UsageReading | null = null;
  let lastChip: HarnessContextBlock | null | "none" = null;
  let streamingEl: HTMLElement | null = null;
  let streamingText = "";
  /** 流式消息里已完成块已渲染到的源偏移（增量渲染的游标）。 */
  let renderedFinalized = 0;
  let tailEl: HTMLElement | null = null;
  let chunkBuffer = "";
  let flushScheduled = false;
  const pendingApprovals = new Map<string, PendingApproval>();
  let lastToolEl: HTMLElement | null = null;

  // ── 长驻文案施加（onRelabel 的重跑路径：全部从已存状态重取，不重放旧字符串）──
  function applyLabels(): void {
    title.textContent = t("D326");
    toggleButton.textContent = t("D326");
    toggleButton.title = t("D327");
    toggleButton.setAttribute("aria-label", t("D327"));
    panel.setAttribute("aria-label", t("D327"));
    newSession.textContent = t("D330");
    composer.placeholder = t("D328");
    sendButton.textContent = t("D329");
    emptyHint.textContent = t("D346");
    applyUsage();
    applyChip();
    applyWarn();
    // 待决批准项是交互中的 UI（不是历史记录）：随语言重渲按钮与标题，输入框内容保留。
    for (const pending of pendingApprovals.values()) relabelApproval(pending);
  }

  function applyUsage(): void {
    usage.textContent =
      lastUsage === null ? "" : t("D334", { ctx: lastUsage.ctx, cache: lastUsage.cache });
  }

  function applyWarn(): void {
    if (lastUsage !== null && lastUsage.ctx > warnCtxPct) {
      warn.textContent = t("D335", { ctx: lastUsage.ctx, warn: warnCtxPct });
      warn.hidden = false;
    } else {
      warn.hidden = true;
    }
  }

  function applyChip(): void {
    if (lastChip === null || lastChip === "none") {
      chip.textContent = t("D333");
      chip.classList.add("is-none");
      return;
    }
    chip.classList.remove("is-none");
    if ("selection" in lastChip) {
      chip.textContent = t("D331", {
        path: lastChip.path,
        from: lastChip.selection.from_line,
        to: lastChip.selection.to_line,
      });
    } else {
      chip.textContent = t("D332", {
        path: lastChip.path,
        from: lastChip.viewport_range.from_line,
        to: lastChip.viewport_range.to_line,
      });
    }
  }

  /** 上下文 chip 刷新（发送前可核对）：打开面板 / 输入框获焦 / 发送后重取。
   *  不挂编辑器选区监听——「发送前」的核对窗口由这三处覆盖，常挂监听是给编辑器热路径
   *  加常驻消费者的反面教材（ADR 0002 §6）。 */
  function refreshChip(): void {
    const block = assembleHarnessContext(editor);
    lastChip = block ?? "none";
    applyChip();
  }

  // ── transcript 追加 ──────────────────────────────────────────────────────
  function scrollToBottom(): void {
    transcript.scrollTop = transcript.scrollHeight;
  }

  function syncEmptyHint(): void {
    if (transcript.childElementCount === 0 && !transcript.contains(emptyHint)) {
      transcript.append(emptyHint);
    } else if (transcript.childElementCount > 1 && transcript.contains(emptyHint)) {
      emptyHint.remove();
    }
  }

  function appendUserMessage(text: string): void {
    const el = document.createElement("div");
    el.className = "lumir-hp-msg lumir-hp-msg-user";
    el.textContent = text;
    transcript.append(el);
    syncEmptyHint();
    scrollToBottom();
  }

  function appendToolCall(name: string, status: "started" | "done", summary: string): void {
    if (status === "started" || lastToolEl === null) {
      const el = document.createElement("div");
      el.className = "lumir-hp-tool";
      el.textContent = status === "done" ? t("D344", { name, summary }) : t("D343", { name });
      if (status === "done") el.classList.add("is-done");
      transcript.append(el);
      lastToolEl = status === "started" ? el : null;
    } else {
      lastToolEl.textContent = t("D344", { name, summary });
      lastToolEl.classList.add("is-done");
      lastToolEl = null;
    }
    syncEmptyHint();
    scrollToBottom();
  }

  function appendCompactMarker(summary: string): void {
    const el = document.createElement("div");
    el.className = "lumir-hp-compact";
    const line = document.createElement("div");
    line.className = "lumir-hp-compact-line";
    line.textContent = t("D341");
    const details = document.createElement("details");
    const summaryEl = document.createElement("summary");
    summaryEl.textContent = t("D342");
    const body = document.createElement("div");
    body.className = "lumir-hp-compact-body";
    body.textContent = summary;
    details.append(summaryEl, body);
    el.append(line, details);
    transcript.append(el);
    syncEmptyHint();
    scrollToBottom();
  }

  function appendError(text: string): void {
    const el = document.createElement("div");
    el.className = "lumir-hp-error";
    el.textContent = text;
    transcript.append(el);
    syncEmptyHint();
    scrollToBottom();
  }

  // ── 批准闸 ───────────────────────────────────────────────────────────────
  function relabelApproval(pending: PendingApproval): void {
    const titleEl = pending.element.querySelector(".lumir-hp-approval-title");
    if (titleEl !== null) {
      titleEl.textContent =
        pending.diff !== undefined ? t("D339", { tool: pending.tool }) : t("D340", { tool: pending.tool });
    }
    const reason = pending.element.querySelector<HTMLInputElement>(".lumir-hp-reason");
    if (reason !== null) reason.placeholder = t("D338");
    const approve = pending.element.querySelector("button[data-act=approve]");
    const reject = pending.element.querySelector("button[data-act=reject]");
    if (approve !== null) approve.textContent = t("D336");
    if (reject !== null) reject.textContent = t("D337");
  }

  function appendApproval(request: { id: string; tool: string; diff?: string; argv?: string }): void {
    const el = document.createElement("div");
    el.className = "lumir-hp-approval";
    const titleEl = document.createElement("div");
    titleEl.className = "lumir-hp-approval-title";
    el.append(titleEl);
    if (request.diff !== undefined) {
      const pre = document.createElement("pre");
      pre.className = "lumir-hp-diff";
      for (const line of request.diff.split("\n")) {
        const row = document.createElement("div");
        row.textContent = line;
        if (line.startsWith("+")) row.className = "lumir-hp-diff-add";
        else if (line.startsWith("-")) row.className = "lumir-hp-diff-del";
        else if (line.startsWith("@@")) row.className = "lumir-hp-diff-hunk";
        pre.append(row);
      }
      el.append(pre);
    } else if (request.argv !== undefined) {
      const pre = document.createElement("pre");
      pre.className = "lumir-hp-argv";
      pre.textContent = request.argv;
      el.append(pre);
    }
    const reason = document.createElement("input");
    reason.type = "text";
    reason.className = "lumir-hp-reason";
    const actions = document.createElement("div");
    actions.className = "lumir-hp-approval-actions";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.dataset.act = "approve";
    const reject = document.createElement("button");
    reject.type = "button";
    reject.dataset.act = "reject";
    actions.append(approve, reject);
    el.append(reason, actions);

    const pending: PendingApproval = { id: request.id, tool: request.tool, diff: request.diff, argv: request.argv, element: el };
    pendingApprovals.set(request.id, pending);
    relabelApproval(pending);

    // 未决项不自动超时：唯一的出口是 Alex 点击。决策后按钮整排禁用（幂等——
    // 重复点击不会向后端发第二次），元素留在 transcript 里作决策记录。
    const decide = (approved: boolean): void => {
      if (!pendingApprovals.delete(request.id)) return;
      approve.disabled = true;
      reject.disabled = true;
      reason.disabled = true;
      el.classList.add(approved ? "is-approved" : "is-rejected");
      harnessApprove(request.id, approved, reason.value.trim() === "" ? undefined : reason.value.trim()).catch(
        (e: unknown) => appendError(t("D348", { message: errorMessage(e) })),
      );
    };
    approve.addEventListener("click", () => decide(true));
    reject.addEventListener("click", () => decide(false));

    transcript.append(el);
    syncEmptyHint();
    scrollToBottom();
  }

  // ── 流式 assistant 消息 ──────────────────────────────────────────────────
  function ensureStreamingMessage(): void {
    if (streamingEl !== null) return;
    streamingEl = document.createElement("div");
    streamingEl.className = "lumir-hp-msg lumir-hp-msg-assistant";
    tailEl = document.createElement("div");
    tailEl.className = "lumir-hp-md-tail";
    streamingEl.append(tailEl);
    transcript.append(streamingEl);
    streamingText = "";
    renderedFinalized = 0;
    syncEmptyHint();
  }

  /** rAF 合帧：chunk 只进缓冲，真正的 DOM 写入每帧至多一次。 */
  function scheduleFlush(): void {
    if (flushScheduled) return;
    flushScheduled = true;
    requestAnimationFrame(() => {
      flushScheduled = false;
      flushChunks();
    });
  }

  function flushChunks(): void {
    if (chunkBuffer === "") return;
    ensureStreamingMessage();
    streamingText += chunkBuffer;
    chunkBuffer = "";
    // 已完成块：渲染过一次就冻结（游标只前进）；进行中的末块整段重渲。
    const boundary = finalizedUpTo(streamingText);
    if (boundary > renderedFinalized && streamingEl !== null && tailEl !== null) {
      const grown = streamingText.slice(renderedFinalized, boundary);
      const finalizedEl = document.createElement("div");
      finalizedEl.className = "lumir-hp-md-final";
      renderMarkdownInto(finalizedEl, grown);
      streamingEl.insertBefore(finalizedEl, tailEl);
      renderedFinalized = boundary;
    }
    if (tailEl !== null) {
      tailEl.replaceChildren();
      renderMarkdownInto(tailEl, streamingText.slice(renderedFinalized));
    }
    scrollToBottom();
  }

  /** 一轮结束：对完整源做一次全量重渲（增量渲染的近似在松散列表等形态上收敛于此）。 */
  function finalizeStreamingMessage(): void {
    flushChunks();
    if (streamingEl === null) return;
    streamingEl.replaceChildren();
    renderMarkdownInto(streamingEl, streamingText);
    streamingEl = null;
    streamingText = "";
    renderedFinalized = 0;
    tailEl = null;
    scrollToBottom();
  }

  function setBusy(next: boolean): void {
    busy = next;
    sendButton.disabled = next;
  }

  // ── 事件流 ───────────────────────────────────────────────────────────────
  function handleEvent(event: HarnessEvent): void {
    switch (event.type) {
      case "text_chunk":
        chunkBuffer += typeof event.text === "string" ? event.text : "";
        scheduleFlush();
        return;
      case "tool_call":
        appendToolCall(
          typeof event.name === "string" ? event.name : "?",
          event.status === "done" ? "done" : "started",
          typeof event.summary === "string" ? event.summary : "",
        );
        return;
      case "approval_request":
        if (typeof event.id === "string") {
          appendApproval({ id: event.id, tool: event.tool, diff: event.diff, argv: event.argv });
        }
        return;
      case "usage":
        if (typeof event.ctx_pct === "number") {
          lastUsage = { ctx: event.ctx_pct, cache: typeof event.cache_pct === "number" ? event.cache_pct : 0 };
          applyUsage();
          applyWarn();
        }
        return;
      case "compact":
        appendCompactMarker(typeof event.summary === "string" ? event.summary : "");
        return;
      case "done":
        finalizeStreamingMessage();
        setBusy(false);
        return;
      case "error":
        finalizeStreamingMessage();
        setBusy(false);
        appendError(t("D348", { message: typeof event.message === "string" ? event.message : event.code }));
        return;
    }
  }

  void onHarnessEvent(handleEvent).catch(() => {});

  // ── 快照恢复（webview 重载 / 首次挂载）：宽容解析，缺键 = 空态 ────────────
  function restoreSnapshot(json: string): void {
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(json);
    } catch {
      return;
    }
    if (typeof snapshot !== "object" || snapshot === null) return;
    const state = snapshot as Record<string, unknown>;
    if (typeof state.warn_ctx_pct === "number") warnCtxPct = state.warn_ctx_pct;
    const usage = state.usage as { ctx_pct?: unknown; cache_pct?: unknown } | null | undefined;
    if (usage !== null && typeof usage === "object" && typeof usage.ctx_pct === "number") {
      lastUsage = { ctx: usage.ctx_pct, cache: typeof usage.cache_pct === "number" ? usage.cache_pct : 0 };
    }
    const messages = Array.isArray(state.messages) ? state.messages : [];
    for (const message of messages) {
      if (typeof message !== "object" || message === null) continue;
      const record = message as Record<string, unknown>;
      const role = record.role;
      if (role === "user" && typeof record.text === "string") appendUserMessage(record.text);
      else if (role === "assistant" && typeof record.text === "string") {
        const el = document.createElement("div");
        el.className = "lumir-hp-msg lumir-hp-msg-assistant";
        renderMarkdownInto(el, record.text);
        transcript.append(el);
      } else if (role === "tool" && typeof record.name === "string") {
        appendToolCall(record.name, "done", typeof record.summary === "string" ? record.summary : "");
      } else if (role === "compact" && typeof record.summary === "string") {
        appendCompactMarker(record.summary);
      }
    }
    const pending = state.pending_approval as { id?: unknown; tool?: unknown; diff?: unknown; argv?: unknown } | null | undefined;
    if (pending !== null && typeof pending === "object" && typeof pending.id === "string") {
      appendApproval({
        id: pending.id,
        tool: typeof pending.tool === "string" ? pending.tool : "?",
        diff: typeof pending.diff === "string" ? pending.diff : undefined,
        argv: typeof pending.argv === "string" ? pending.argv : undefined,
      });
    }
    applyUsage();
    applyWarn();
    syncEmptyHint();
    scrollToBottom();
  }

  // 后端不可用（纯浏览器预览 / 命令未注册）时按空会话降级——面板本身照常可用，
  // 发送时才会报「发送失败」。
  void harnessState().then(restoreSnapshot).catch(() => {});

  // ── 发送与新会话 ─────────────────────────────────────────────────────────
  function send(): void {
    if (busy) return;
    const text = composer.value.trim();
    if (text === "") return;
    const block = assembleHarnessContext(editor);
    lastChip = block ?? "none";
    applyChip();
    appendUserMessage(text);
    composer.value = "";
    setBusy(true);
    harnessSend(text, block !== null ? serializeHarnessContext(block) : null).catch((e: unknown) => {
      setBusy(false);
      appendError(t("D347", { reason: errorMessage(e) }));
    });
  }

  sendButton.addEventListener("click", send);
  composer.addEventListener("keydown", (event: KeyboardEvent) => {
    // IME 组合期不接管（Enter 在组合期是「确认候选」，不是发送）。
    if (event.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });
  composer.addEventListener("focus", refreshChip);

  newSession.addEventListener("click", () => {
    harnessNewSession()
      .then(() => {
        // 清空的是**渲染面**：会话真源在 Rust，重置成功后本地视图随之清空；
        // 待决批准项随会话失效，一并撤下（它们的 id 已不属于任何会话）。
        transcript.replaceChildren();
        pendingApprovals.clear();
        streamingEl = null;
        streamingText = "";
        renderedFinalized = 0;
        chunkBuffer = "";
        lastToolEl = null;
        lastUsage = null;
        setBusy(false);
        applyUsage();
        applyWarn();
        syncEmptyHint();
      })
      .catch((e: unknown) => appendError(t("D348", { message: errorMessage(e) })));
  });

  // 面板内 Escape = 收起（就地消费，不进键位表：Escape token 已被 editor.widget-escape
  // 占用，面板在 contentDOM 之外，那条绑定不命中——与 M139 搜索 panel 同先例同判词）。
  panel.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  // ── 唤起 / 收起 ──────────────────────────────────────────────────────────
  function setOpen(next: boolean): void {
    open = next;
    shell.root.classList.toggle("dock-open", next);
    panel.hidden = !next;
    toggleButton.setAttribute("aria-pressed", String(next));
    if (next) {
      refreshChip();
      composer.focus();
    } else {
      // 焦点归还编辑器——否则焦点落在 hidden 元素上，下一次键入无处落地。
      editor.view.focus();
    }
  }

  function close(): void {
    if (open) setOpen(false);
  }

  toggleButton.addEventListener("click", () => setOpen(!open));

  applyLabels();
  onRelabel(applyLabels);
  syncEmptyHint();

  return {
    toggle: () => setOpen(!open),
    isOpen: () => open,
  };
}
