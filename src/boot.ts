// 启动层（change app-splash-screen，design §3.4）：主模块之外的一层薄入口——读配置、施加主题、
// 画出启动态首帧，然后才装载主模块（`await import("./main")`）。
//
// **不用 top-level await**：实现期在本机（macOS 26 的 WKWebView）确认 TLA 可用，但产品最低支持
// 系统是 10.15，其 WKWebView 是 Safari 13 级、TLA 要 Safari 15——因此照 design §3.4 用 async
// IIFE（与 TLA 语义等价，不押「用户系统都足够新」）。结论与依据见本 change 的 design 实现注记。
//
// 为什么首帧由它画、而不是静态 index.html：主题通道与骨架 DOM 各只有一份真源（design §3.1）。
// 样式在启动层就位：`./style.css` 是 token 表的唯一居所，`./startup-surface` 自带启动面样式
// ——两者因此进入口 chunk，首帧即带样式（主模块对同一份 CSS 的 import 由构建器去重）。
//
// 失败口径：启动层自身异常 / 主模块装载失败都撤下启动态（`degrade`）并让既有 console 路径
// 留痕，MUST NOT 让启动面顶在最前面充当白屏（spec 的降级场景）。

import "./style.css";
import { getName } from "@tauri-apps/api/app";
import type { ConfigSnapshot } from "./bindings/ConfigSnapshot";
import type { UiTheme } from "./bindings/UiTheme";
import { handOffConfig } from "./config-handoff";
import { configGet } from "./ipc";
import { mountStartupSurface, startupSurface } from "./startup-surface";

/** 双 rAF 的兜底上界（ms）。窗口仍不可见时 WebKit 可能不派发渲染帧（design §3.6），
 *  没有上界就等于让主模块装载押在一次可能永远不来的回调上。它只保证「不会卡死」，
 *  正确性不依赖它：绘制被推迟时启动面与主模块首帧落在同一帧，启动面仍先于壳可见。 */
const NEXT_PAINT_FALLBACK_MS = 200;

/** 等一次「尽可能先画」的机会：双 rAF（主路径）与一个上界定时器取先到者。 */
function nextPaint(): Promise<void> {
  const painted = new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  const fallback = new Promise<void>((resolve) => {
    window.setTimeout(resolve, NEXT_PAINT_FALLBACK_MS);
  });
  return Promise.race([painted, fallback]);
}

/** 配置快照里的主题档；读不到（配置读取失败 / 桩环境缺 `ui` 表）返回 null = 不写属性
 *  （CSS 的 `:root` 出厂块照常生效，与 Rust 侧 `[ui] theme` 的回落口径一致）。 */
function themeOf(snapshot: ConfigSnapshot | null): UiTheme | null {
  if (snapshot === null) return null;
  const ui: { theme?: UiTheme } | undefined = snapshot.config.ui;
  return ui?.theme ?? null;
}

async function boot(): Promise<void> {
  // 启动链路本来就要发起的那一次配置读取；应用元信息并发读（spec「不读 vault」：首帧前
  // 只有这两项）。两端都按「读不到 = null」降级，不阻断启动。
  const [snapshot, productName] = await Promise.all([
    configGet().catch(() => null),
    getName().catch(() => null),
  ]);

  // 同一份配置交给主模块复用（MUST NOT 两处各读一次，design §3.4）。
  handOffConfig(snapshot);

  // 首帧之前施加主题：启动面的第一个内容帧就在当前主题下（design §3.5 / D5）。只写
  // `<html data-theme>`：modeline 与其余启动装配归主模块（applyTheme 是那个唯一施加点）。
  const theme = themeOf(snapshot);
  if (theme !== null) document.documentElement.dataset.theme = theme;

  const surface = mountStartupSurface({ productName });
  await nextPaint();
  surface.markFirstFrame();

  await import("./main");
}

void boot().catch((e: unknown) => {
  // 启动层或主模块装载失败：撤下启动态（已挂载时），既有启动路径照走——这里只留 console
  // 线索，不上屏报错（spec「启动层失败降级」）。// i18n-exempt: log
  startupSurface()?.degrade();
  console.error(`lumir: 启动层失败：${String(e)}`); // i18n-exempt: log
});
