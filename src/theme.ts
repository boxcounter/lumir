// 主题域（M237，change live-theme-switch）：三档闭集合的运行期切换口径。
//
// 为什么单独一个模块：主题的**值**由 Rust 侧的 `UiTheme` 闭集合定义（ts-rs 导出到
// src/bindings/UiTheme.ts，单一来源不变），而「切换」这一层有两处只有前端知道的东西——
// 循环序，以及运行期当前值的读取面（`<html data-theme>`）。两者都能脱离 DOM 断言，
// 因此不进装配层 src/main.ts（tests/unit/theme.test.ts 在这一层跑）。
//
// 分层（REVIEW.md 第 8 条：同一语义不留两处真源）：
//   - 本模块：三档顺序、循环取下一档、从根元素读当前主题，以及主题的两条可见文案；
//   - src/main.ts 的 `applyTheme`：**唯一施加点**——写 `data-theme` 并刷新 modeline 指示钮，
//     启动装配与运行期切换都经它，MUST NOT 出现第二处 `data-theme` 写入者；
//   - src/preview/mermaid.ts 的 `invalidateMermaidTheme`：唯一「按主题失效」出口（颜色烧进
//     SVG 内联样式，CSS 变量跟不上，只能重渲）。

import type { UiTheme } from "./bindings/UiTheme";

/** 三档循环序（change live-theme-switch 的 D1 裁决）：light → dark → eink → light。
 *  顺序是**配置面之外**的一条口径，因此在本模块只写一次——命令实现与场景都引用它，
 *  不各自再列一遍三档。 */
export const THEME_CYCLE: readonly UiTheme[] = ["light", "dark", "eink"];

/**
 * 从根元素读运行期当前主题（唯一生效面 = `<html data-theme>`）。
 *
 * 返回 `null` 表示属性尚未施加（配置还没到位 / 桩环境缺 `ui` 表 / `config_get` 失败）——
 * **不是**「主题为空」：那时界面上呈现的是 CSS `:root` 块的出厂档（light，见
 * `src/style.css` 的 `:root` 三主题块），调用方据此继续，MUST NOT 把 `null` 当成第四档。
 */
export function currentTheme(root: { dataset: { theme?: string | undefined } }): UiTheme | null {
  const value = root.dataset.theme;
  return THEME_CYCLE.find((theme) => theme === value) ?? null;
}

/**
 * 循环取下一档（`current` 为 `null` 时按界面的出厂档 light 继续——第一次按键因此落到
 * dark，与屏幕上的可见变化一致，而不是先把 light 重复施加一次）。
 */
export function nextTheme(current: UiTheme | null): UiTheme {
  const from: UiTheme = current ?? "light";
  return THEME_CYCLE[(THEME_CYCLE.indexOf(from) + 1) % THEME_CYCLE.length];
}

/**
 * modeline 主题指示钮的悬停提示与读屏名（文案 D122）：**同一句话两处共用**
 *（与 D96 的 vault 入口同形），可见文本是主题名本身——配置值逐字，dogfood 时
 *「我这是哪个主题」可以直接对上 config.json 的 `[ui] theme`，不经过一层翻译。
 */
export const THEME_INDICATOR_LABEL = (theme: UiTheme): string => `主题：${theme}（点击切换）`;

/**
 * 写盘失败 toast（文案 D123）：`{原因}` 处填后端错误信封的人话（D121 同口径）。
 *
 * 措辞必须同时交代三件事：切换**已经生效**（不回滚）、没存进配置、重启后回到配置文件里的
 * 主题。MUST NOT 点名某个具体主题——写失败时运行期态与文件态分叉，前端说不出文件里到底是
 * 哪一档（上一档的写回也可能失败过），点名就是伪造一个读不到的读数（REVIEW.md 第 2 条）。
 */
export const THEME_SAVE_FAILED_TEXT = (reason: string): string =>
  `主题已切换，但写入配置失败，重启后将回到配置文件里的主题（${reason}）`;
