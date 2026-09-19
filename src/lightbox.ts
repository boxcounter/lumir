// 图片放大查看（lightbox，M184；capability：attachment-display，change open-image-lightbox）。
//
// 形态（裁决点 1 推荐项）：应用内全屏遮罩 + 图片居中，定位在文档流之外——展开与关闭都不动文档
// 几何。遮罩手法、焦点管理与关闭手法都取既有惯用语（键位查看面板 src/bindings-panel.ts、大纲浮层
// src/toc.ts），不引入新视觉语言。
//
// 打开路径只有一条：双击**终态渲染出的 `<img>`**（接线在 src/preview/attachments.ts 的
// ImageWidget.toDOM）。加载中状态块、字节读取失败与终态不可见三类占位都没有 `<img>`，因此
// 「占位不可点开」是结构性事实，不是一条需要维护的开关。
//
// 图像源只有一条：放大图取内联那张 `<img>` 的 src（同一字符串）。MUST NOT 因此再读一次附件字节
//（那等于把 50MB 上限下的 base64 与位图再造一份），MUST NOT 把内联的 `<img>` 元素搬进来（它属于
// CM 装饰层的 DOM）。**同一 data: URL 的第二次使用会命中已解码位图**——chromium 实测：2600×1800 的
// 6.1MB data URL 首解 48.9ms、同串再解 0.1ms，而「像素相同、串不同」的对照是 49.3ms（复用按 URL 串
// 键控，见 change design §8 与 test-results/m184/10-decode-probe.json）。SVG 与位图同构：这里不按
// 扩展名分支、不做净化、不把图像内容内联进 DOM——同一个源字符串进同一个 `<img>`，M178 的
//「SVG 图片的渲染安全性」条款自动覆盖放大层。
//
// 缩放口径（裁决点 2 推荐项）：适配遮罩且不放大。放大图**不设** width / height——浏览器对
// `<img>` 的默认行为就是按自然尺寸渲染，「小图不放大」由此天然成立；越界由 src/style.css 的
// `.lumir-lightbox-img` 的 max-width / max-height 挡住。MUST NOT 写 `width: 100%`（会把小图拉大失真）。
//
// 关闭（裁决点 4 推荐项）：三条用户路径（`Esc` / 点击遮罩 / 遮罩内再次双击图片）+ 一条焦点兜底
//（焦点离开遮罩）。四条都回到同一个 close：三条用户路径交还焦点，焦点兜底不抢焦点（焦点本来就
// 去了别处——在遮罩之上另开面板、窗口失活）。零新提示文案：就地键只有 `Esc`（macOS 通行的
// 「关掉当前层」约定），另两条关闭路径是鼠标动作。
//
// Esc MUST NOT 写进统一键位表：表的不变量是「一个 token 一条绑定」，`Esc` 已被
// `editor.widget-escape` 占用，同 token 第二条绑定会被构造期拒绝（见 src/keys.ts）。就地消费 +
// preventDefault 后，window 上的分发器对已消费事件让路——与面板 / 浮层同款。

import { keyToken } from "./keys";

/** 遮罩对外的唯一入口（放大图的打开）。关闭的四条路径都在遮罩内部自治：调用方没有任何
 *  「关掉它」的场景要表达——焦点离开遮罩时它会自己退场（design §4.2）。 */
export interface ImageLightbox {
  /** 打开遮罩显示这张图。`src` MUST 取内联 `<img>` 的 src（同一图像源，不重读字节）；
   *  `rawRef` 是引用原文，作放大图的 `alt`（与内联图同一口径，也是真机验收的 AX 锚点）。 */
  open(src: string, rawRef: string): void;
}

/** 遮罩的五个 DOM 动作（状态机的驱动面）。真实现见 createImageLightbox；单测注入假实现——
 *  「四条关闭路径回到同一个 close、焦点交还与否、打开态再关是空操作」这组守卫因此能在无 DOM 的
 *  层里逐条断言（tests/unit 的纪律：这一层不造 DOM 替身）。 */
export interface LightboxSurface {
  /** 载入放大图（同一图像源的第二次使用）。 */
  load(src: string, rawRef: string): void;
  show(): void;
  hide(): void;
  /** 打开即持焦（`role="dialog"` + `aria-modal="true"` 的语义要求）。 */
  focus(): void;
  /** 交还焦点给编辑器（装配层注入 `editor.view.focus`）。 */
  restoreFocus(): void;
}

/** 四条关闭路径。前三条是用户路径（关闭后交还焦点），`blur` 是焦点兜底（不抢焦点）。 */
export type LightboxCloseReason = "escape" | "overlay" | "image" | "blur";

export interface LightboxState {
  open(src: string, rawRef: string): void;
  close(reason: LightboxCloseReason): void;
  /** 就地键：`Escape` 消费并关闭（返回 true），其余 token 一律不消费。 */
  handleKeyToken(token: string | null): boolean;
  isOpen(): boolean;
}

/**
 * 遮罩状态机（纯逻辑，DOM 只经 surface 进出）。
 *
 * 单入口的理由与 src/toc.ts 的 `close(restoreFocus)` 同款：三条用户路径 + 一条焦点兜底若各写一份
 * 收尾，就会出现「某条路径忘了交还焦点」这类漂移；这里把「关闭之后焦点归谁」收在一处。
 * `open` 守卫（已关闭时的 close 是空操作）挡的是被关掉之后的迟到事件：`hide()` 自身会让遮罩
 * 失焦，那条 blur 回调不该再走一遍收尾（也就不会把已经落到编辑器里的焦点再抢一次）。
 */
export function createLightboxState(surface: LightboxSurface): LightboxState {
  let open = false;
  const state: LightboxState = {
    isOpen: () => open,
    open(src, rawRef) {
      surface.load(src, rawRef);
      surface.show();
      surface.focus();
      open = true;
    },
    close(reason) {
      if (!open) return;
      open = false;
      surface.hide();
      if (reason !== "blur") surface.restoreFocus();
    },
    handleKeyToken(token) {
      if (token !== "Escape") return false;
      state.close("escape");
      return true;
    },
  };
  return state;
}

export interface ImageLightboxOptions {
  mount: HTMLElement;
  /** 关闭后把焦点交还编辑器：焦点一直在遮罩上，不交还就「关掉了也走不了」（同键位面板）。 */
  restoreFocus(): void;
}

/** 装配遮罩（DOM、焦点、四条关闭路径）。DOM 惰性建立：首次打开时才建。 */
export function createImageLightbox(options: ImageLightboxOptions): ImageLightbox {
  let state: LightboxState | null = null;

  /** 首次打开时建 DOM 并接线；此后复用同一份（打开与关闭都不在文档打开路径与键入路径上
   *  新增工作，ADR 0002 §6）。 */
  function ensureState(): LightboxState {
    if (state !== null) return state;

    const overlay = document.createElement("div");
    overlay.className = "lumir-lightbox-overlay";
    overlay.hidden = true;
    overlay.tabIndex = -1;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const img = document.createElement("img");
    img.className = "lumir-lightbox-img";
    overlay.append(img);
    options.mount.append(overlay);

    const created = createLightboxState({
      load(src, rawRef) {
        img.alt = rawRef;
        img.src = src;
      },
      show: () => void (overlay.hidden = false),
      hide: () => void (overlay.hidden = true),
      focus: () => overlay.focus(),
      restoreFocus: () => options.restoreFocus(),
    });

    // 点击遮罩（图片以外的区域）关闭。MUST preventDefault：点击非可聚焦元素会让遮罩失焦，
    // 焦点兜底那条 blur 会把遮罩关掉且**不抢焦点**，随后这次点击的关闭路径已经无事可做，
    // 焦点掉到 <body>——表现是「关掉了，但键盘没回到编辑器」（design §4.2 的第二个坑）。
    // 指示段与浮层条目用同一手法（src/toc.ts）。
    overlay.addEventListener("mousedown", (event) => {
      if (event.target !== overlay) return;
      event.preventDefault();
      created.close("overlay");
    });
    // 遮罩内再次双击放大图即关闭（裁决点 4 的推荐项）。mousedown 同样 preventDefault：双击的
    // 第一下若把遮罩的焦点抖掉，blur 会先一步关掉遮罩，第二次点击就落在一个已经关掉的层上。
    img.addEventListener("mousedown", (event) => event.preventDefault());
    img.addEventListener("dblclick", (event) => {
      event.preventDefault();
      created.close("image");
    });
    // 关闭键就地消费（Esc）；Tab 挡在遮罩内——遮罩没有可聚焦子元素，放行 Tab 会让焦点走进编辑器
    // 内容区，而遮罩还开着，后续按键就又能穿透到文档（aria-modal 的语义当场失效）。
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
    // 焦点离开遮罩即关闭，且不抢焦点（照 src/toc.ts 的口径）：它同时兜住「在遮罩之上另开了面板」
    //（global 作用域的命令在模态层上照常生效，新面板抢走焦点）与窗口失活两件事。
    overlay.addEventListener("blur", () => created.close("blur"));

    state = created;
    return created;
  }

  return {
    open(src, rawRef) {
      ensureState().open(src, rawRef);
    },
  };
}
