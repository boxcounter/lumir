// 行号开关域（change global-line-numbers-toggle-nov23）：全局二元开关的运行期口径。
//
// 为什么单独一个模块：开关的**值**由 Rust 侧的 `LineNumbers` 闭集合定义（ts-rs 导出到
// src/bindings/LineNumbers.ts，单一来源不变），而「取反」与「当前值的读取面」
// （`<html data-line-numbers>`）只有前端知道，且都能脱离 DOM 断言——照 src/theme.ts 的分层
// 放进本模块（tests/unit/line-numbers.test.ts 在这一层跑），不进装配层 src/main.ts。
//
// 分层（REVIEW.md「同一语义两处真源」条）：
//   - 本模块：当前值的只读口径、取反、以及两条可见文案；
//   - src/main.ts 的 `applyLineNumbers`：**唯一施加点**——写 `data-line-numbers`、把同一值写给
//     全部文档 pane 的编辑器、刷新 modeline 指示钮；启动装配与运行期切换都经它；
//   - src/main.ts 的 `toggleLineNumbers`：**唯一切换路径**——命令（⌘⇧N）与 modeline 行号钮
//     直接调它，不另存第三份「当前开关」状态；
//   - src/editor.ts 的 `setLineNumbers`：编辑器实例态的唯一写入者（gutter 在场判据在那边）。

import type { LineNumbers } from "./bindings/LineNumbers";
import { t } from "./copy";

/**
 * 从根元素读运行期当前开关（唯一生效面 = `<html data-line-numbers>`）。
 *
 * 返回 `null` 表示属性尚未施加（配置还没到位 / 桩环境缺 `ui` 表）——**不是**第四档：那时
 * 界面上没有行号，与出厂默认 `off` 同形，调用方（取反）据此把它当 `off` 处理。
 */
export function currentLineNumbers(root: {
  dataset: { lineNumbers?: string | undefined };
}): LineNumbers | null {
  const value = root.dataset.lineNumbers;
  return value === "on" || value === "off" ? value : null;
}

/**
 * 取反（`current` 为 `null` 时按默认 `off` 继续——第一次按键因此落到 `on`，与屏幕上的
 * 可见变化一致，而不是先把 `off` 重复施加一次）。
 */
export function nextLineNumbers(current: LineNumbers | null): LineNumbers {
  return current === "on" ? "off" : "on";
}

/**
 * modeline 行号指示钮的悬停提示与读屏名（文案 D974）：**同一句话两处共用**（与 D122 的
 * 主题钮同形）。可见文本是 `on` / `off` 读数本身——配置值逐字，dogfood 时可以直接对上
 * config.json 的 `[ui] line_numbers`，不经过一层翻译；`{state}` 因此 MUST NOT 译成中文。
 */
export const LINE_NUMBERS_INDICATOR_LABEL = (state: LineNumbers): string =>
  t("D974", { state });

/**
 * 写盘失败 toast（文案 D975）：`{reason}` 处填后端错误信封的人话（D123 同口径）。
 *
 * 措辞必须同时交代三件事：切换**已经生效**（不回滚）、没存进配置、重启后回到配置文件里的
 * 值。MUST NOT 点名具体档位——写失败时运行期态与文件态分叉，前端说不出文件里到底是哪一档
 * （REVIEW.md「读不到当成空」条）。
 */
export const LINE_NUMBERS_SAVE_FAILED_TEXT = (reason: string): string => t("D975", { reason });
