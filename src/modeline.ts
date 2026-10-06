// modeline 右段的版本号段 + 标题栏产品标识块（M236，change product-version-display）。
//
// 为什么归在这个模块：D2 裁决（2026-09-25，改选备选）让版本号有两个展示位——宽窗在标题栏
// 标识块（产品名 · 版本号），窄窗（<640px）退到 modeline 右段尾部。两个展示位是同一份
// 元信息的两种排版，显隐切换必须只有一个裁判，否则跨越阈值时两处会同时显示或同时消失。
// M316 曾把双栏（split）加为第二条退让触发（标识块整块退 modeline）；HP1（change
// move-harness-to-pane-chat-frame，Alex 点子 2）把标识块移到标题栏最左的 traffic 灯区，
// 双栏退让**移除**——标识块不再占据右簇，退让对象只剩 harness toggle 钮（双 pane 隐藏归
// harness 面板自己管）。现在唯一的退让触发是窄窗 <640px（版本号退 modeline，产品名留在
// 标题栏）。
//
// 分层（tests/unit 纪律：本层不许造 DOM 替身）：
//   - 纯逻辑层 identityView()：「元信息 × 窗口宽窄」→ 视图模型（哪段显示、各段文本是什么），
//     单测在这一层断言文案组装与降级/退让决策；
//   - DOM 适配层 createTitlebarIdentity()：把视图模型应用到 shell 建的五个元素上。
//     DOM 行为（显隐、三主题计算样式）归视觉场景与真机场景 39。
//
// 文案唯一真源纪律（REVIEW.md 第 8 条）：产品名 / 版本号取自 tauri.conf.json（经
// @tauri-apps/api/app 的 getName()/getVersion()，装配层 src/main.ts 读一次），本模块只
// 排版不取值；分隔符「·」只有 IDENTITY_SEP 一处字面量，标题栏段与 modeline 段都从它派生。

/** 产品名与版本号之间的排版分隔符（纯排版，与标题链「›」同先例，不进文案 deck 编号）。 */
export const IDENTITY_SEP = "·";

/** 窄窗退让阈值（px，D2 裁决采纳的备选量级）：窗口宽 < 640 时版本号退 modeline。
 *  依据见 design §3.2（700px + 4 个短名标签时标题栏右端空闲只剩 ≈6px）。 */
export const IDENTITY_NARROW_PX = 640;

/** 应用元信息（启动时读一次的那对值）。读取失败用 null 表达——不是空串：
 *  「读不到」MUST NOT 被当成「值为空」渲染出去（REVIEW.md 第 2 条）。 */
export interface AppMeta {
  name: string;
  version: string;
}

/** 标识块视图模型：identityView 的输出，createTitlebarIdentity 的输入。 */
export interface IdentityView {
  /** 标识块整体显隐（元信息缺失 = 整体隐藏，MUST NOT 渲染占位串）。 */
  visible: boolean;
  /** 版本号退让中：true 时标题栏不留版本号（含分隔符），它落 modeline 右段尾部。
   *  唯一触发是窄窗 <640px（M236）——标识块移位 traffic 灯区后双栏不再触发退让
   *  （HP1，change move-harness-to-pane-chat-frame）。 */
  versionInModeline: boolean;
  /** 产品名段文本（visible 时有效）。 */
  name: string;
  /** 标题栏版本号段文本（visible 且未退让时有效）。 */
  version: string;
  /** modeline 右段版本号段文本（含前导分隔；仅退让时有效）：窄窗退版本号
   *  （形如「 · 1.2.3」）。示例写成通用版本号而不是本仓当前值：字面抄一份版本号会在每次
   *  bump 后腐掉（M238 r2 收口时把原来那处的 `0.0.0` 去字面化）。 */
  modelineText: string;
}

/** 「元信息 × 窗口宽窄」→ 视图模型。唯一的排版决策点。 */
export function identityView(meta: AppMeta | null, flags: { narrow: boolean }): IdentityView {
  if (meta === null) {
    return {
      visible: false,
      versionInModeline: false,
      name: "",
      version: "",
      modelineText: "",
    };
  }
  const { narrow } = flags;
  return {
    visible: true,
    versionInModeline: narrow,
    name: meta.name,
    version: meta.version,
    // 前导空格要真实生效靠 .modeline-version 的 white-space: pre（flex 项的起始空白会被
    // 折叠）；退让句自带前导「 · 」与 meta 段（「语法 · 行数 · 编码」尾部）的分隔节奏逐字
    // 同形——缺它会读成「UTF-8 · 1.2.3」没有分隔（Alex dogfood 2026-10-05，M330）。展示位
    // 互斥：只在退让态携带文本，宽窗下为空串（消费侧据此清空 textContent，不留残字）。
    modelineText: narrow ? ` ${IDENTITY_SEP} ${meta.version}` : "",
  };
}

/** createTitlebarIdentity 操作的五个元素（shell.ts 建立）。 */
export interface IdentityDom {
  block: HTMLElement;
  name: HTMLElement;
  sep: HTMLElement;
  version: HTMLElement;
  modelineVersion: HTMLElement;
}

export interface TitlebarIdentity {
  /** 元信息读到：填充并显示标识块（此后唯一的状态是真源值，运行期不刷新）。 */
  show(meta: AppMeta): void;
  /** 元信息读取失败：标识块整体隐藏（宁可不显示，不显示假版本号）。 */
  fail(): void;
}

/** 把视图模型应用到 DOM，并监听窗口宽窄变化（matchMedia，零轮询）。
 *  监听器随窗口存活、不卸下：标识块与 app 同生命周期，装配层没有卸载时机。 */
export function createTitlebarIdentity(dom: IdentityDom): TitlebarIdentity {
  const mq = window.matchMedia(`(max-width: ${IDENTITY_NARROW_PX - 1}px)`);
  let meta: AppMeta | null = null;
  const apply = (): void => {
    const view = identityView(meta, { narrow: mq.matches });
    dom.block.hidden = !view.visible;
    dom.name.textContent = view.name;
    dom.sep.textContent = IDENTITY_SEP;
    dom.sep.hidden = view.versionInModeline;
    dom.version.textContent = view.version;
    dom.version.hidden = view.versionInModeline;
    dom.modelineVersion.hidden = !view.visible || !view.versionInModeline;
    dom.modelineVersion.textContent = view.versionInModeline ? view.modelineText : "";
  };
  mq.addEventListener("change", apply);
  apply(); // 初始态：meta 为 null → 整体隐藏（与 shell 的初始 hidden 一致，幂等）
  return {
    show(next) {
      meta = next;
      apply();
    },
    fail() {
      meta = null;
      apply();
    },
  };
}
