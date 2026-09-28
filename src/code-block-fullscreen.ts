// 代码块放大全屏查看（M277；capability：editor-live-preview，change code-block-fullscreen）。
// 本文件与 src/table-fullscreen.ts / src/lightbox.ts 同级同形：DOM 惰性建立、四条关闭路径回
// 同一个 close（状态机在 src/overlay-state.ts）、就地 Esc（不进统一键位表）、blur 兜底不抢焦点。
//
// 形态：应用内全屏遮罩 + 居中面板壳，壳内是**该代码块的整块源码**按行渲染。
// 内容来源与表格侧的差异是刻意的，理由只有一条（change design §2.1）：
//
//   表格侧克隆渲染 DOM 是被**渲染形态**逼出来的（cell 内容是活源码位置 + 富 inline DOM，从源码
//   重建会丢掉全部 inline 渲染）。代码块的渲染产物是「行 + token 着色 + 头部条」，三者都有可
//   复用的单一出口（`highlightCode` 与既有 class），重建**不产生第二套呈现口径**；而克隆有一个
//   对代码块致命的代价——DOM 里只有**已渲染的视口**那一部分（CM 按视口渲染），长块在全屏里会
//   看到一半就断，恰恰在本能力最需要它的场合失效。
//
// 只读是**结构性**的：重建出的节点不在编辑器的 contenteditable 子树内、不带事件监听、不接 CM
// 的任何 API，因此没有编辑路径可言；文本保持原生可选可复制（MUST NOT `user-select: none`）。
//
// 打开与关闭 MUST NOT 改写文档：只读 `EditorState` 的文本、只切换层叠显隐（ADR 0003 §3）。
//
// 读屏名复用文档内容器既有的 `Markdown 代码块 N` 标签**同一来源**（src/preview/livePreview.ts
// 的 codeBlockLabel），由调用方把那份既有标签传进来，MUST NOT 在本文件里另写一份字面量。
//
// Esc MUST NOT 写进统一键位表：表的不变量是「一个 token 一条绑定」，`Esc` 已被
// `editor.widget-escape` 占用，同 token 第二条绑定会被构造期拒绝（见 src/keys.ts）。

import { keyToken } from "./keys";
import { createOverlayState } from "./overlay-state";
import type { OverlayCloseReason, OverlayState, OverlaySurface } from "./overlay-state";
import { mirrorThemeScope } from "./overlay-scope";
import { CODEBLOCK_NOWRAP_CLASS, CODEBLOCK_WRAP_CLASS } from "./preview/theme";
import type { CodeBlockRender } from "./preview/code-block-content";

/** 遮罩对外的唯一入口。外部（命令实现 / 触发钮）只表达「打开这块 / 关掉遮罩 / 现在开着吗」。 */
export interface CodeBlockFullscreen {
  /** 打开遮罩；`render` 是装配层按当前 `EditorState` 现取的呈现计划，`label` 是该块既有的
   *  读屏名（同一来源，见文件头）。 */
  open(render: CodeBlockRender, label: string): void;
  close(reason: CodeBlockFullscreenCloseReason): void;
  isOpen(): boolean;
}

export type CodeBlockFullscreenSurface = OverlaySurface<CodeBlockRender>;

export type CodeBlockFullscreenCloseReason = OverlayCloseReason;

export type CodeBlockFullscreenState = OverlayState<CodeBlockRender>;

/** 状态机本体在 src/overlay-state.ts（与表格全屏、图片 lightbox 共用一份）。 */
export function createCodeBlockFullscreenState(surface: CodeBlockFullscreenSurface): CodeBlockFullscreenState {
  return createOverlayState(surface);
}

/** 内容容器的 class（样式、主题 scope 镜像与断言三处共用一份字面量）。 */
const CONTENT_CLASS = "lumir-codeblock-fs-content";

/** 折行口径 class 的落点：容器带 `CodeBlockRender` 之外的 wrap class（与 `.cm-content` 上那两个
 *  同名，theme.ts 用 `:is(.cm-content, .lumir-codeblock-fs-content)` 让同一份规则两处命中）。 */
const PLAIN_CLASS = "lumir-codeblock-fs-plain";

export interface CodeBlockFullscreenOptions {
  mount: HTMLElement;
  /** 关闭后把焦点交还编辑器：焦点一直在遮罩上，不交还就「关掉了也走不了」（同键位面板）。
   *
   *  **MUST NOT 写成裸 `editor.view.focus()`**：M274 实测证明 WebKit 下那次聚焦会把阅读位置
   *  拽回（`scrollTop` 2750 → 0）。装配层注入的是 `editor.focusPreservingReadingPosition()`
   *  （取阅读位置 → `view.focus()` → 经 editor 的 readScrollPosition / applyScrollPosition
   *  写回，MUST NOT 裸写滚动容器）——change design §5.1。 */
  restoreFocus(): void;
  /** 主题 scope 的镜像源（编辑器根元素）：浮层内容脱离编辑器根后，CM 注入的主题规则整批不命中，
   *  需要把 scope 类镜像到内容容器上（机制见 src/overlay-scope.ts）。 */
  themeScopeSource(): HTMLElement;
}

function buildLines(render: CodeBlockRender): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (render.kind === "plain") {
    // 超过单块着色上限：单块纯文本（同一份源码逐字节一致，不逐行建 DOM、不着色）。
    const line = document.createElement("div");
    line.className = "cm-line cm-lp-codeblock-line";
    line.textContent = render.text;
    fragment.append(line);
    return fragment;
  }
  for (const line of render.lines) {
    const el = document.createElement("div");
    el.className = line.head ? "cm-line cm-lp-codeblock-line cm-lp-codeblock-head" : "cm-line cm-lp-codeblock-line";
    let cursor = 0;
    for (const token of line.tokens) {
      if (token.from > cursor) el.append(document.createTextNode(line.text.slice(cursor, token.from)));
      const span = document.createElement("span");
      span.className = token.cls;
      span.textContent = line.text.slice(token.from, token.to);
      el.append(span);
      cursor = token.to;
    }
    if (cursor < line.text.length) el.append(document.createTextNode(line.text.slice(cursor)));
    fragment.append(el);
  }
  return fragment;
}

/** 装配遮罩（DOM、焦点、四条关闭路径）。DOM 惰性建立：首次打开时才建。 */
export function createCodeBlockFullscreen(options: CodeBlockFullscreenOptions): CodeBlockFullscreen {
  let state: CodeBlockFullscreenState | null = null;

  function ensureState(): CodeBlockFullscreenState {
    if (state !== null) return state;

    const overlay = document.createElement("div");
    overlay.className = "lumir-codeblock-fs-overlay";
    overlay.hidden = true;
    overlay.tabIndex = -1;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const panel = document.createElement("div");
    panel.className = "lumir-codeblock-fs-panel";
    const content = document.createElement("div");
    content.className = CONTENT_CLASS;
    panel.append(content);
    overlay.append(panel);
    options.mount.append(overlay);

    const created = createCodeBlockFullscreenState({
      load(render, label) {
        overlay.setAttribute("aria-label", label);
        content.replaceChildren();
        // 折行口径：容器拿与 `.cm-content` 同名的那个 class（MUST NOT 在浮层内引入第二个
        // 折行开关，也 MUST NOT 另写一套折行规则值——theme.ts 的那条规则同时命中两处）。
        content.className = [CONTENT_CLASS, render.kind === "plain" ? PLAIN_CLASS : "", overlayWrapClass(options.themeScopeSource())]
          .filter(Boolean)
          .join(" ");
        // 主题 scope 镜像挂在**面板**上（内容容器的父级）：CM 注入的主题规则前缀是编辑器根的
        // 生成类，脱离编辑器根后整批不命中；镜像必须落在**内容容器的祖先**上，规则里的
        // `:is(.cm-content, .lumir-codeblock-fs-content).<wrap-class> .cm-line…` 才可能成立
        //（把 scope 类挂在内容容器自己身上是不够的——那要求该容器是自己的祖先；M277 实现期
        // 实测踩到过：white-space 停在 normal、超长行按折行排而容器宽度撑不开）。
        mirrorThemeScope(options.themeScopeSource(), panel, "lumir-codeblock-fs-panel");
        content.append(buildLines(render));
        panel.scrollTop = 0;
        panel.scrollLeft = 0;
      },
      show: () => void (overlay.hidden = false),
      hide: () => void (overlay.hidden = true),
      focus: () => overlay.focus(),
      restoreFocus: () => options.restoreFocus(),
    });

    // 点击遮罩（面板以外的区域）关闭。MUST preventDefault：点击非可聚焦元素会让遮罩失焦，
    // 焦点兜底那条 blur 会把遮罩关掉且**不抢焦点**，随后这次点击的关闭路径已经无事可做，
    // 焦点掉到 <body>——表现是「关掉了，但键盘没回到编辑器」（M184 design §4.2 的坑）。
    overlay.addEventListener("mousedown", (event) => {
      if (event.target !== overlay) return;
      event.preventDefault();
      created.close("overlay");
    });
    // 关闭键就地消费（Esc）；Tab 挡在遮罩内——浮层内容里没有可聚焦元素，放行 Tab 会让焦点
    // 走进编辑器内容区，而遮罩还开着，后续按键就又能穿透到文档（aria-modal 的语义当场失效）。
    overlay.addEventListener("keydown", (event) => {
      const token = keyToken(event);
      if (token === null) return;
      if (token === "Tab" || token === "Shift-Tab") {
        event.preventDefault();
        return;
      }
      if (!created.handleKeyToken(token)) return;
      event.preventDefault();
    });
    // 焦点离开遮罩即关闭，且不抢焦点（照 src/toc.ts 的口径）：兜住「遮罩之上另开了面板」与
    // 窗口失活两件事。**文档代际变化不在它的射程**（M286 改正，原稿声称它兜住三件事）：重载
    // 不移动焦点，这条 blur 在外部重载下从不触发——那一路由装配层显式 `close("document")`
    //（src/main.ts 的 `closeDocumentOverlays`），口径与表格全屏逐字相同。
    overlay.addEventListener("blur", () => created.close("blur"));

    state = created;
    return created;
  }

  return {
    open(render, label) {
      ensureState().open(render, label);
    },
    close(reason) {
      state?.close(reason);
    },
    isOpen() {
      return state?.isOpen() ?? false;
    },
  };
}

/** 当前折行口径的 class（与 `.cm-content` 上那两个同名）：容器上只有一个，取自编辑器内容面
 *  的实际 class——配置是单一真源，浮层只**读**它，不回写、不缓存（design §7 的边界条目）。 */
function overlayWrapClass(editorRoot: HTMLElement): string {
  const content = editorRoot.querySelector(".cm-content");
  return content?.classList.contains(CODEBLOCK_WRAP_CLASS) ? CODEBLOCK_WRAP_CLASS : CODEBLOCK_NOWRAP_CLASS;
}
