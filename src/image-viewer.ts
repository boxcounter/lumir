// 图片查看面（M629，change add-image-file-preview §2）：每个文档 pane 一个**惰性建立**的
// `.image-viewer`，挂在 pane 的挂载元素里、与 CM 视图同级互斥显示（`hidden` 切换）。
//
// 不复用 `.editor-notice`：后者是 `shell.editor` 上的整块遮罩，双 pane 时会盖住两栏
//（`src/main.ts` 的既有注释明写这一点）——图片查看面必须是 pane 局部元素。
//
// 分层（与 `src/lightbox.ts` 同一条纪律：状态机纯逻辑、DOM 只经 surface 进出）：
//   - `createImageViewerState`：装载态 / 终态 / 失败态的状态迁移、在途作废、D3 的释放与重读，
//     全部可在 tests/unit 直接断言（不造 DOM 替身）；
//   - `createImageViewer`：把 surface 接到真 DOM（`<img>` 解码 / 双击进 lightbox / 显隐）。
//     真实解码与像素归视觉场景与真机验收。
//
// 三态（design §2.1 / §2.3）：
//   - 装载态：一段文本，文案取 `attachments.ts` 的 `imageLoadingText`（D111，文档内图片同源）；
//   - 终态：一个 `<img>`（不设 width / height —— 浏览器按自然尺寸渲染、由 CSS 约束适配，
//     「小图不放大」因此天然成立，与 lightbox 的缩放口径同源）；
//   - 失败：占位 chip，文案取 `imageReadErrorText`（D112，读失败，带原因）/ `imageFallbackText`
//     （D113，读成但渲染不出可见像素），chip 形态取文档内图片同一个 `.cm-lp-image-error`。
//     三条都**不新增文案**（design §6 的硬约束）。
//
// 字节来源：调用方注入 `readDataUrl`（既有 `createInvokeAttachmentProvider().readDataUrl`，
// `fs_read_attachment` + `mimeTypeOf`）——零新后端命令、零新 IPC 面。
//
// 双击：进既有 lightbox（`open(src, rawRef)`），`src` 与 `<img>` 逐字相同（同一 data: URL
// 串，lightbox 侧命中已解码位图，不重读字节）。加载态 / 失败占位都没有 `<img>`，因此
// 「占位不可点开」是结构性事实，不是一条要维护的开关（与内联 ImageWidget 同形）。
//
// 内存（D3）：只保留**当前激活图片**的 src。`release()` 撤下 `<img>` 并把 src 置空——切走即
// 释放；切回由调用方重读一次。常驻内存合同 <200MB（ADR 0002 §6）不靠「记得别留着」维护，
// 而是靠这里只有一份 src 这个结构事实。

import { errorMessage } from "./ipc";
import { formatNumber, t } from "./copy";
import { imageFallbackText, imageLoadingText, imageReadErrorText } from "./preview/attachments";

/** 装载成功后 modeline 右段要的两个读数（宽高取 `<img>` 的自然尺寸）。 */
export interface ImageInfo {
  width: number;
  height: number;
  /** 文件字节数（由 data: URL 的 base64 载荷反推，不另取一次 IPC）。 */
  bytes: number;
}

/** modeline 右段的段落分隔（纯排版，与 D208 的「 · 」同形）——不是文案，不进 deck。 */
const MODELINE_SEP = " · ";

/** data: URL 的 base64 载荷 → 解码后的字节数。不带 `=` 填充的串按 4/3 折算；空载荷为 0。 */
export function dataUrlByteLength(src: string): number {
  const comma = src.indexOf(",");
  if (comma < 0) return 0;
  const payload = src.slice(comma + 1);
  if (payload === "") return 0;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

/** 字节数 → 人话读数（B / KB / MB，单位是 ASCII、两档语言同形，与 deck D437 的 MB 用法同源）。
 *  只做数量级压缩，不做本地化宽度对齐：读数出现在 modeline 右段，同一行还会有「宽×高」。 */
export function imageSizeText(bytes: number): string {
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * modeline 右段的图片读数（D5 裁决：「图片 · 宽×高 · 文件大小」）。
 *
 * 两态各一条 deck 文案：装载中 / 无法读取只给标签（D546），装载完成给标签 + 读数（D547）。
 * `info === null` 就是「还没有读数」——MUST NOT 用它冒充 0×0（REVIEW.md「读不到当成空」条）。
 */
export function imageModelineText(info: ImageInfo | null): string {
  const label = t("D546");
  if (info === null) return label;
  const readout = t("D547", {
    width: formatNumber(info.width),
    height: formatNumber(info.height),
    size: imageSizeText(info.bytes),
  });
  return `${label}${MODELINE_SEP}${readout}`;
}

/**
 * 查看面的 DOM 动作面（状态机的驱动面）。真实现见 `createImageViewer`；单测注入假实现——
 * 「装载 → 终态 / 失败、在途作废、释放后重读」这组守卫因此能在无 DOM 的层里逐条断言
 *（与 `src/lightbox.ts` 的 LightboxSurface 同款分层）。
 */
export interface ImageViewerSurface {
  /** 显示装载态文本，并让查看面在场。 */
  loading(text: string): void;
  /**
   * 显示终态 `<img>`。`onSettled` 由适配层在解码终态调用：`visible === false` 表示引擎
   * 画不出可见像素（解码失败 / 零尺寸）→ 状态机转失败占位；`natural` 是引擎给出的自然尺寸。
   */
  image(src: string, alt: string, onSettled: (result: { visible: boolean; natural: { width: number; height: number } }) => void): void;
  /** 失败占位（chip）。 */
  fail(text: string): void;
  /** 撤下内容并隐藏。 */
  clear(): void;
}

export interface ImageViewerState {
  /**
   * 装载 `path`。同一路径在途时复用同一次装载的 promise（同步点每次都会重算，幂等是硬要求）；
   * 已装载 / 已失败是终态，不重读。返回的 promise 在**终态**（成功或失败）resolve。
   */
  show(path: string, load: (path: string) => Promise<string>): Promise<void>;
  /** 释放：清空内容并回落状态。返回被释放的路径（没有内容时 undefined）。 */
  release(): string | undefined;
  /** 当前显示的路径（装载中 / 已装载 / 失败都算；未显示为 undefined）。 */
  currentPath(): string | undefined;
  /** 装载成功后的读数；装载中 / 失败 / 已释放为 null。 */
  info(): ImageInfo | null;
  /** 终态 `<img>` 的 src（双击放大的图像源）；没有终态图片时为 null。 */
  shownSrc(): string | null;
}

/** 查看面的状态机（纯逻辑，DOM 只经 surface 进出）。 */
export function createImageViewerState(
  surface: ImageViewerSurface,
  onChange: () => void = () => {},
): ImageViewerState {
  let shownPath: string | undefined;
  let state: "idle" | "loading" | "loaded" | "failed" = "idle";
  let info: ImageInfo | null = null;
  let src: string | null = null;
  /** 在途装载的作废标记：切走 / 换图后迟到的字节不许落进当前表面。 */
  let serial = 0;
  let inflight: { path: string; promise: Promise<void> } | null = null;

  function fail(text: string): void {
    surface.fail(text);
    state = "failed";
    info = null;
    src = null;
    onChange();
  }

  async function load(path: string, loadDataUrl: (path: string) => Promise<string>): Promise<void> {
    const token = ++serial;
    shownPath = path;
    state = "loading";
    info = null;
    src = null;
    surface.loading(imageLoadingText(path));
    let dataUrl: string;
    try {
      dataUrl = await loadDataUrl(path);
    } catch (e) {
      if (token !== serial) return;
      fail(imageReadErrorText(path, errorMessage(e)));
      return;
    }
    if (token !== serial) return;
    await new Promise<void>((resolve) => {
      surface.image(dataUrl, path, (result) => {
        if (token !== serial) {
          resolve();
          return;
        }
        if (!result.visible) {
          fail(imageFallbackText(path));
          resolve();
          return;
        }
        info = {
          width: result.natural.width,
          height: result.natural.height,
          bytes: dataUrlByteLength(dataUrl),
        };
        src = dataUrl;
        state = "loaded";
        onChange();
        resolve();
      });
    });
  }

  return {
    show(path: string, loadDataUrl: (path: string) => Promise<string>): Promise<void> {
      if (inflight !== null && inflight.path === path) return inflight.promise;
      if (shownPath === path && (state === "loaded" || state === "failed")) return Promise.resolve();
      const promise = load(path, loadDataUrl);
      inflight = { path, promise };
      void promise.then(() => {
        if (inflight?.promise === promise) inflight = null;
      });
      return promise;
    },
    release(): string | undefined {
      const path = shownPath;
      if (path === undefined) return undefined;
      ++serial; // 在途装载作废
      surface.clear();
      shownPath = undefined;
      state = "idle";
      info = null;
      src = null;
      onChange();
      return path;
    },
    currentPath: () => shownPath,
    info: () => info,
    shownSrc: () => src,
  };
}

/** 查看面依赖面（DOM 适配层）。全部由装配层注入，模块本身只 import ipc / copy / 附件文案。 */
export interface ImageViewerDeps {
  /** 字节供给（既有 provider 的 `readDataUrl`；失败 reject）。 */
  readDataUrl(path: string): Promise<string>;
  /** 放大遮罩（既有 lightbox；未注入时双击无落点——维护性调用 / 纯桩形态）。 */
  lightbox(): { open(src: string, rawRef: string): void } | null;
  /** 状态跃迁（装载完成 / 失败 / 释放）后回调：装配层据此重算 modeline 读数。 */
  onChange(): void;
}

export interface ImageViewerHandle {
  readonly element: HTMLElement;
  /** 装载 `path` 并让查看面在场（语义见 `ImageViewerState.show`）。 */
  show(path: string): Promise<void>;
  /** 释放（D3）：隐藏、撤下 `<img>`、置空 src；返回被释放的路径。 */
  release(): string | undefined;
  /** 当前显示的路径（见状态机同名方法）。 */
  currentPath(): string | undefined;
  /** 当前装载成功后的读数（见状态机同名方法）。 */
  info(): ImageInfo | null;
  /** 终态 `<img>` 的图像源（双击放大取它；见状态机同名方法）。 */
  shownSrc(): string | null;
}

/**
 * 建立一个查看面（惰性建立的落点：装配层在**首次打开图片**时才调它，不随 pane 启动创建）。
 *
 * 元素由本函数创建并 append 到 `parent`：`position:absolute; inset:0`（CSS 在
 * `src/style.css` 的 `.image-viewer`），底色 `--content-bg`，图片居中；`tabindex=0` 让它
 * 可持焦（图片会话前台时 editor 作用域的键位按 contentDOM 判定，焦点不进去自然不命中）。
 */
export function createImageViewer(parent: HTMLElement, deps: ImageViewerDeps): ImageViewerHandle {
  /** 状态机本体（在 surface 之后建立；surface 的回调只在用户交互 / 异步终态里跑，那时已就位）。 */
  let viewerState: ImageViewerState | null = null;
  const element = document.createElement("div");
  element.className = "image-viewer";
  element.tabIndex = 0;
  element.hidden = true;
  parent.append(element);

  const surface: ImageViewerSurface = {
    loading(text: string): void {
      element.replaceChildren(document.createTextNode(text));
      element.hidden = false;
    },
    image(dataUrl, alt, onSettled): void {
      const img = document.createElement("img");
      img.className = "image-viewer-img";
      // alt 取路径：读屏与真机验收的 AX 锚点（与内联图取引用原文同一条口径——这里是文件）。
      img.alt = alt;
      img.addEventListener("mousedown", (event) => event.preventDefault());
      img.addEventListener("dblclick", (event) => {
        event.preventDefault();
        // 放大图取**装载时那一份图像源字符串**（与这张 `<img>` 的 src 逐字相同，同一个 data:
        // URL —— lightbox 侧命中已解码位图，不重读字节）。读状态机而不是 `img.src`：后者是
        // URL 序列化后的读回值，绕开任何归一化差异，两处用的就是同一个变量。
        const src = viewerState?.shownSrc() ?? null;
        if (src !== null) deps.lightbox()?.open(src, alt);
      });
      const settle = (): void => {
        onSettled({
          visible: img.naturalWidth > 0 && img.naturalHeight > 0,
          natural: { width: img.naturalWidth, height: img.naturalHeight },
        });
      };
      img.onload = settle;
      img.onerror = () => onSettled({ visible: false, natural: { width: 0, height: 0 } });
      element.replaceChildren(img);
      img.src = dataUrl;
      // data: URL 常在赋 src 后**同步** complete（与内联 ImageWidget 同一条实测口径）：
      // 不补一次探测就等不到 load 事件，查看面会一直停在装载态。
      if (img.complete) {
        if (img.naturalWidth === 0) img.onerror(new Event("error"));
        else settle();
      }
    },
    fail(text: string): void {
      const chip = document.createElement("span");
      chip.className = "cm-lp-image-error";
      chip.textContent = text;
      element.replaceChildren(chip);
      element.hidden = false;
    },
    clear(): void {
      element.replaceChildren();
      element.hidden = true;
    },
  };

  const state = createImageViewerState(surface, deps.onChange);
  viewerState = state;
  return {
    element,
    show: (path) => state.show(path, (target) => deps.readDataUrl(target)),
    release: () => state.release(),
    currentPath: () => state.currentPath(),
    info: () => state.info(),
    shownSrc: () => state.shownSrc(),
  };
}
