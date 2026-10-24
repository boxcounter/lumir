// 浮层宽度与落点的单一实现（M702，change overlay-width-contract-oct24）。
//
// 为什么要有这个模块：M698 的只读盘点（`.local/reports/m698-overlay-width-audit-oct24.md`）
// 确认同族缺陷有两层——① 浮层宽度写死 px、不随内容 / 字号变化（⌘P 300px 截断长路径、
// ctxpop 224px 折行、会话浮层 200px 裁掉 81% 的名字）；② 夹取逐案复制（clampCtxPop /
// clampPermPop / placeSessPop 三份，常量还不一致），selpop 与 effhint 干脆没有。前者需要
// **档位**（内容短不空旷、内容长不折行），后者需要**一处实现**（REVIEW.md「同一语义两处
// 真源」条）。
//
// 分层与本仓既有同族模块一致：纯几何层（`resolveOverlayWidth` / `placeOverlay`）零 DOM，
// 单测直接驱动；DOM 适配层只做三件事——量自然宽、取字号、把结果写回 inline style。
//
// 三档（按内容类别，不按组件；数值出处见 design §2）：
//   - `compact` 单行定长（跳转行、浮钮）：上限 24em、下限 160px；
//   - `list`    单行列表（⌘P / 大纲 / vault / 会话 / 选择器）：上限 26em、下限 200px；
//   - `prose`   多行说明（ctxpop / 权限释义 / effort hint）：上限 34em、下限 200px。
// 上限用 em（相对浮层自身 font-size）是合同条款 W2：harness 浮层的文字随
// `--lumir-hp-scale` 缩放 0.8–2.13 倍，px 上限在放大档会把同一句话挤成 3 行。
//
// 落点算法（W4）：两侧锚定边各算一个默认落点、各夹进宿主可用区，选**位移最小**的一侧
// ——换边优先于长距平移；位移相同才回落到组件默认边。浮层宽度接近宿主可用宽时两侧都要
// 位移，此时按可用宽铺满（视作 pane 级浮层），不为了「换边」制造更大的位移。

/** 浮层的内容档位。 */
export type OverlayTier = "compact" | "list" | "prose";

export interface OverlayTierSpec {
  /** 档位下限（px）；组件可经 `minWidth` 覆盖（如 ctxpop 保留既有 224px 作下限）。 */
  minWidth: number;
  /** 可读宽上限（em，相对浮层自身 font-size）。 */
  maxEm: number;
  /** 宿主两侧留白（px）。 */
  inset: number;
}

export const OVERLAY_TIERS: Readonly<Record<OverlayTier, OverlayTierSpec>> = {
  compact: { minWidth: 160, maxEm: 24, inset: 8 },
  list: { minWidth: 200, maxEm: 26, inset: 8 },
  prose: { minWidth: 200, maxEm: 34, inset: 8 },
};

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export interface OverlayWidthInput {
  tier: OverlayTier;
  /** 内容固有宽（border-box，px）——短内容不得被拉伸、长内容不得被定值挤窄。 */
  natural: number;
  /** 宿主可用宽（pane / 视口，px）。 */
  host: number;
  /** 浮层自身 font-size（px）：em 上限的换算基准，含 `--lumir-hp-scale`。 */
  fontSize: number;
  /** 组件级下限覆盖（px）；缺省取档位下限。 */
  minWidth?: number;
  /** 宿主两侧留白（px）；缺省取档位值（8）。 */
  inset?: number;
}

export interface OverlayWidth {
  /** 最终宽（px）：`clamp(natural, floor, min(cap, avail))`。 */
  width: number;
  /** 生效的 em 上限（px）。 */
  cap: number;
  /** 宿主可用宽（`host − 2×inset`）。 */
  avail: number;
  /** 生效的下限（被可用宽钳过——极窄宿主下不会宽于可用区）。 */
  floor: number;
}

/**
 * 宽度裁决（W1/W2）：内容固有宽 → 钳到 `[floor, min(cap, avail)]`。
 *
 * 三个边界都显式写出来，是因为它们各自对应一个实测缺陷：
 *   - `natural > max` ⇒ 必须收窄（否则越出 pane 被祖先裁掉）；
 *   - `natural < floor` ⇒ 抬到下限（短内容不空旷）；
 *   - `natural < max` 且 `> floor` ⇒ **原样**（不得为了「看起来整齐」拉宽——统一拉宽正是
 *     M698 否决的方案）。
 */
export function resolveOverlayWidth(input: OverlayWidthInput): OverlayWidth {
  const spec = OVERLAY_TIERS[input.tier];
  const inset = finite(input.inset ?? spec.inset);
  const natural = Math.max(0, finite(input.natural));
  const host = Math.max(0, finite(input.host));
  const fontSize = finite(input.fontSize) > 0 ? finite(input.fontSize) : 12;
  const cap = spec.maxEm * fontSize;
  const avail = Math.max(0, host - 2 * inset);
  const max = Math.min(cap, avail);
  const floor = Math.min(finite(input.minWidth ?? spec.minWidth), max);
  return { width: Math.min(Math.max(natural, floor), max), cap, avail, floor };
}

export interface OverlayPlacementInput extends OverlayWidthInput {
  /** 宿主左缘（视口坐标，px）。 */
  hostLeft: number;
  /** 锚点矩形（视口坐标）：harness 浮层取包裹 chip / 读数的 wrapper。 */
  anchor: { left: number; right: number };
  /** 组件默认锚定边：`left` = 盒左缘对锚点左缘；`right` = 盒右缘对锚点右缘。 */
  preferred: "left" | "right";
  /** 左锚时的额外偏移（px，正 = 向右）。 */
  leftOffset?: number;
  /** 右锚时的额外偏移（px，正 = 盒右缘越过锚点右缘，如 ctxpop 的 18）。 */
  rightOffset?: number;
}

export interface OverlayPlacement extends OverlayWidth {
  /** 最终左缘（视口坐标）。 */
  left: number;
  /** 最终锚定边（换边后的值）。 */
  side: "left" | "right";
  /** 相对该侧默认落点的横向位移（px，正 = 右）。 */
  shift: number;
}

/**
 * 宽度 + 落点裁决（W3/W4）：先收窄，再在两侧锚定边里选位移最小者，最后把落点夹进宿主。
 *
 * 返回值里的 `left` 已经是**最终**左缘——调用方不需要再叠加 `translate`；`side` 与 `shift`
 * 是给判据与诊断用的（测试直接断言「该换边时换边」「不该动时零位移」）。
 */
export function placeOverlay(input: OverlayPlacementInput): OverlayPlacement {
  const spec = OVERLAY_TIERS[input.tier];
  const inset = finite(input.inset ?? spec.inset);
  const sized = resolveOverlayWidth({ ...input, inset });
  const width = sized.width;
  const hostLeft = finite(input.hostLeft);
  const host = Math.max(0, finite(input.host));
  const anchorLeft = finite(input.anchor.left);
  const anchorRight = finite(input.anchor.right);
  const minLeft = hostLeft + inset;
  // 可用宽已被 width 的钳制吸收，这里只需保证区间非空（极窄宿主下 maxLeft === minLeft）。
  const maxLeft = Math.max(minLeft, hostLeft + host - inset - width);

  const place = (side: "left" | "right"): { side: "left" | "right"; left: number; shift: number } => {
    const defaultLeft =
      side === "left"
        ? anchorLeft + finite(input.leftOffset ?? 0)
        : anchorRight + finite(input.rightOffset ?? 0) - width;
    const left = Math.min(Math.max(defaultLeft, minLeft), maxLeft);
    return { side, left, shift: left - defaultLeft };
  };

  const preferred = place(input.preferred);
  const alternate = place(input.preferred === "left" ? "right" : "left");
  // 位移最小者胜出；相等时保留组件默认边（`<` 而不是 `<=`）。
  const picked = Math.abs(alternate.shift) < Math.abs(preferred.shift) ? alternate : preferred;
  return { ...sized, left: picked.left, side: picked.side, shift: picked.shift };
}

// ---------------------------------------------------------------------------
// DOM 适配层（单测不覆盖；浏览器里由 harness-panel 消费）
//
// 三个函数都对「没有布局能力的假 DOM」保持空操作：单测层用元素替身驱动面板逻辑（无 style /
// 无矩形），定位与宽度在那里不可观测、也不该由这一层断言——纯几何在 `overlay-placement.test.ts`
// 判，DOM 结果在 tests/visual 与真机层判。缺了这层守护，替身元素会在 `el.style.width` 上抛错。
// ---------------------------------------------------------------------------

/** 元素是否具备本层需要的布局能力（有 inline style 且可量矩形）。 */
export function isLayoutCapable(el: HTMLElement): boolean {
  const style = (el as Partial<HTMLElement>).style;
  return style !== undefined && typeof el.getBoundingClientRect === "function";
}

/** 量浮层的内容固有宽：清掉上一次写入的内联 `width` / `min-width`，让 CSS 的
 * `width: max-content` + `max-width: <N>em` 生效后取盒宽（border-box）。
 *
 * 前提：元素已可见（`hidden` 撤掉之后调用）——`display: none` 下量到 0 会让浮层塌成一条。
 */
export function measureOverlayNaturalWidth(el: HTMLElement): number {
  if (!isLayoutCapable(el)) return 0;
  el.style.width = "";
  el.style.minWidth = "";
  return el.getBoundingClientRect().width;
}

/** 浮层自身计算后的 font-size（px）；取不到时回落 12（= `--fs-meta`）。 */
export function overlayFontSize(el: HTMLElement): number {
  if (!isLayoutCapable(el) || typeof getComputedStyle !== "function") return 12;
  const size = Number.parseFloat(getComputedStyle(el).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 12;
}

/**
 * 把裁决写回元素：`width` 恒写（收窄 / 抬到下限都靠它），`left` 恒写（换边后的落点），
 * `right` / `translate` 清空（避免与 CSS 的默认锚定边重复叠加）。
 *
 * 坐标基准：`position: fixed` 的浮层以视口为包含块；`absolute` 的以 `offsetParent` 为包含块
 * （本仓是 chip 外面的 wrapper）。两者都从视口坐标折算，调用方不必各判一次。
 */
export function applyOverlayPlacement(el: HTMLElement, placement: OverlayPlacement): void {
  if (!isLayoutCapable(el)) return;
  el.style.width = `${placement.width}px`;
  el.style.translate = "";
  el.style.right = "auto";
  const offsetParent = el.offsetParent as HTMLElement | null;
  const base =
    offsetParent !== null && typeof offsetParent.getBoundingClientRect === "function"
      ? offsetParent.getBoundingClientRect().left
      : 0;
  el.style.left = `${placement.left - base}px`;
}
