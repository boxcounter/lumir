// 表格放大全屏查看（M240；capability：editor-live-preview，change table-fullscreen-view
// 的裁决点 1/2/4）。本文件与 src/lightbox.ts / src/toc.ts 同级同形：DOM 惰性建立、四条关闭
// 路径回同一个 close、就地 Esc（不进统一键位表）、blur 兜底不抢焦点。
//
// 形态：应用内全屏遮罩 + 居中面板壳，壳内是**打开那一刻渲染态 grid 的只读快照副本**。
// 与 M184 图片 lightbox 的三处差异，各有理由：
//
//   1. 快照**不缩放**。图片 lightbox 的口径是「适配遮罩且不放大」，表格相反——表格的价值就在
//      自然尺寸（宽表在阅读栏里只能看到局部正是本能力的由来），故快照按自然尺寸呈现，放不下
//      由壳内双向滚动承载（src/style.css 的 .lumir-table-fs-panel）。
//   2. 快照由既有 DOM **深克隆**得到。cell 内容是文档的活源码位置（line/mark 装饰，不是 replace
//      widget），cell 里的链接 / 行内代码 / 图片都已是渲染好的 DOM；从源码切片重建第二套呈现
//      口径会丢掉全部 inline 渲染（REVIEW.md 第 8 条的形态，两套口径必然漂移）。克隆也 MUST NOT
//      改成「搬动原节点」：CM 装饰 DOM 归 CM 管，搬走会让编辑器布局与装饰状态脱节（M184 否决
//      「搬 <img>」的同款理由）。
//   3. 关闭路径的第三条是「再执行一次 table.toggle-fullscreen」（toggle），对位 M184 的
//      「遮罩内再次双击图片」——本遮罩没有可双击的内容，命令入口才是它的自然对偶。
//
// 只读是**结构性**的，不是一条要维护的开关：克隆不带事件监听、不在编辑器 contenteditable
// 子树内，因此没有编辑路径可言；快照里也没有「当前选区」——选区是编辑态，克隆时把 CM 的运行态
// 残留一并摘掉（见 cleanSnapshot）。克隆里的 `<img>` 因此不响应双击再放大（快照只读语义的
// 应有之义，写进 change 的 spec 已知边界）。
//
// 打开与关闭 MUST NOT 改写文档：只读一份 DOM 副本、只切换层叠显隐（ADR 0003 §3）。
//
// 读屏名复用表格容器既有的 `Markdown 表格 N` 标签**同一来源**——本模块不生成它，由调用方把
// 源元素上那份既有标签传进来（src/preview/table-trigger.ts 从 `.cm-lp-table` 的 aria-label 取），
// MUST NOT 在本文件里另写一份字面量。
//
// Esc MUST NOT 写进统一键位表：表的不变量是「一个 token 一条绑定」，`Esc` 已被
// `editor.widget-escape` 占用，同 token 第二条绑定会被构造期拒绝（见 src/keys.ts）。就地消费 +
// preventDefault 后，window 上的分发器对已消费事件让路——与本仓其余浮层同款。

// 状态机本体自 M277 起在 src/overlay-state.ts（三处浮层共用一份「四条关闭路径回同一个 close」
// 的守卫）；本文件只保留表格侧的 surface 与遮罩 DOM 装配。

import { keyToken } from "./keys";
import { createOverlayState } from "./overlay-state";
import type { OverlayCloseReason, OverlayState, OverlaySurface } from "./overlay-state";
import { mirrorThemeScope } from "./overlay-scope";

/** 遮罩对外的唯一入口。外部（命令实现）只表达「打开这张表 / 关掉遮罩 / 现在开着吗」，
 *  关闭路径的其余三个（`Esc` / 点击遮罩 / 焦点离开）在遮罩内部自治。 */
export interface TableFullscreen {
  /** 打开遮罩，快照取自 `source`（渲染态的 `.cm-lp-table` 子树）；`label` 是该表既有的
   *  读屏名（同一来源，见文件头）。 */
  open(source: HTMLElement, label: string): void;
  close(reason: TableFullscreenCloseReason): void;
  isOpen(): boolean;
}

/** 遮罩的五个 DOM 动作（状态机的驱动面）。真实现见 createTableFullscreen；单测注入假实现——
 *  「四条关闭路径回到同一个 close、焦点交还与否、打开态再关是空操作」这组守卫因此能在无 DOM 的
 *  层里逐条断言（tests/unit 的纪律：这一层不造 DOM 替身）。
 *
 *  内容类型是 HTMLElement（快照源元素）：状态机原样透传给 surface.load。 */
export type TableFullscreenSurface = OverlaySurface<HTMLElement>;

/** 四条关闭路径。前三条是用户路径（关闭后交还焦点），`blur` 是焦点兜底（不抢焦点）——
 *  它同时兜住「遮罩之上另开了面板」「窗口失活」「文档代际变化（外部重载）」三件事。
 *  M277 起取值来源是 src/overlay-state.ts（三处浮层共用同一份状态机，REVIEW.md 第 8 条）。 */
export type TableFullscreenCloseReason = OverlayCloseReason;

export type TableFullscreenState = OverlayState<HTMLElement>;

/** 状态机本体在 src/overlay-state.ts（M277 抽取，三处浮层共用）；这里保留本模块的类型名，
 *  调用方与既有的单测因此不需要知道那份抽取。 */
export function createTableFullscreenState(surface: TableFullscreenSurface): TableFullscreenState {
  return createOverlayState(surface);
}

/**
 * 克隆卫生（design §2，tasks 2.2）：把 CM 的**运行态残留**从快照里摘掉。
 *
 * 三条各有来处，不是照抄：
 *   - `img.cm-widgetBuffer` / 行内非 cell 的占位元素：CM6 在隐藏的 replace 位置插的零宽
 *     widget buffer，是**自动放置的 grid item**（src/style.css 的
 *     `.cm-lp-table .cm-lp-table-row > :not(.cm-lp-table-cell):not(.lumir-table-fs-trigger)`
 *     规则就是为它们写的，触发钮是那条规则唯一的豁免项）。克隆里物理摘除，不依赖那条 CSS
 *     规则——快照是只读物，不该留着「编辑器运行态」的痕迹。
 *   - 触发钮：本 change 自己加的 `Decoration.widget`（.lumir-table-fs-trigger），它就在
 *     grid 子树里，克隆会带走一份。摘掉它，快照即「零 chrome」。
 *   - 未渲染区的占位（`.cm-gap`，CM 渲染视口外内容用的）：它在 grid 子树里、带着未渲染行的
 *     **高度**，留着会让快照出现一块与任何内容都不对应的空白（实测读数见 tasks 2.4 的现场）。
 *     摘掉之后快照 = 打开那一刻**已渲染**的那部分表格——这正是「打开那一刻渲染态 grid 的副本」
 *     的字面口径；「长表只看到已渲染的部分」写进 change 的已知边界。
 *   - 选区层：M285（装 `drawSelection`）之前本应用走原生 DOM 选区、DOM 里没有 `.cm-selectionLayer`
 *     / `.cm-cursorLayer`（1.1 读数）；**M285 起这两个层真实在场**，克隆会连「当前选区」这个
 *     编辑态假 affordance 一起带走。因此下面这两个选择器从「纯防御」变成真拦得住的那一条——
 *     快照是只读物，不该留着「编辑器运行态」的痕迹。
 */
/** 快照容器的 class（样式、主题 scope 镜像与断言三处共用一份字面量）。 */
const SNAPSHOT_CLASS = "lumir-table-fs-snapshot";

export function cleanSnapshot(root: HTMLElement): void {
  const leftovers = root.querySelectorAll(
    "img.cm-widgetBuffer, .lumir-table-fs-trigger, .lumir-block-trigger, .cm-gap, .cm-selectionLayer, .cm-cursorLayer, .cm-selectionBackground",
  );
  for (const el of [...leftovers]) el.remove();
  // 克隆自身也不带可编辑语义（原元素本就没有，这里是「只读」的显式声明）。
  root.removeAttribute("contenteditable");
  for (const el of root.querySelectorAll("[contenteditable]")) el.removeAttribute("contenteditable");
}

export interface TableFullscreenOptions {
  mount: HTMLElement;
  /** 关闭后把焦点交还编辑器：焦点一直在遮罩上，不交还就「关掉了也走不了」（同键位面板）。 */
  restoreFocus(): void;
}

/** 装配遮罩（DOM、焦点、四条关闭路径）。DOM 惰性建立：首次打开时才建——文档打开路径与
 *  键入路径因此零新增工作（ADR 0002 §6；spec 的「文档打开路径零新增」scenario）。 */
export function createTableFullscreen(options: TableFullscreenOptions): TableFullscreen {
  let state: TableFullscreenState | null = null;

  function ensureState(): TableFullscreenState {
    if (state !== null) return state;

    const overlay = document.createElement("div");
    overlay.className = "lumir-table-fs-overlay";
    overlay.hidden = true;
    overlay.tabIndex = -1;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const panel = document.createElement("div");
    panel.className = "lumir-table-fs-panel";
    const snapshot = document.createElement("div");
    snapshot.className = SNAPSHOT_CLASS;
    panel.append(snapshot);
    overlay.append(panel);
    options.mount.append(overlay);

    const created = createTableFullscreenState({
      load(source, label) {
        overlay.setAttribute("aria-label", label);
        snapshot.replaceChildren();
        mirrorThemeScope(source, snapshot, SNAPSHOT_CLASS);
        const copy = source.cloneNode(true) as HTMLElement;
        cleanSnapshot(copy);
        snapshot.append(copy);
        // 上一张表滚到过右端时，新快照不该继承那个横向位置（壳是同一份 DOM）。
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
    // 关闭键就地消费（Esc）；Tab 挡在遮罩内——快照里没有可聚焦元素，放行 Tab 会让焦点走进
    // 编辑器内容区，而遮罩还开着，后续按键就又能穿透到文档（aria-modal 的语义当场失效）。
    overlay.addEventListener("keydown", (event) => {
      const token = keyToken(event);
      if (token === null) return;
      if (token === "Tab" || token === "Shift-Tab") {
        event.preventDefault();
        return;
      }
      if (!created.handleKeyToken(token)) return;
      // 先于 window 上的分发器消费：分发器对已消费事件（defaultPrevented）让路。
      event.preventDefault();
    });
    // 焦点离开遮罩即关闭，且不抢焦点（照 src/toc.ts 的口径）：它同时兜住「在遮罩之上另开了
    // 面板」（global 作用域的命令在模态层上照常生效，新面板抢走焦点）、窗口失活，以及
    // **文档代际变化**（外部修改重载把焦点交还给编辑器/文档区）三件事。
    overlay.addEventListener("blur", () => created.close("blur"));

    state = created;
    return created;
  }

  return {
    open(source, label) {
      ensureState().open(source, label);
    },
    close(reason) {
      state?.close(reason);
    },
    isOpen() {
      return state?.isOpen() ?? false;
    },
  };
}
