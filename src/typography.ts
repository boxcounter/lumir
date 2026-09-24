// 排版口径（change typography-and-zoom）：编辑器内容面的字体族与字号——配置来源、运行期
// 档位计算、以及**唯一的 token 写入路径**。
//
// 作用面（D1 裁决）：编辑器**内容**面（md 正文 / 代码块 / frontmatter / code 模式）。shell
//（左栏 / masthead / 浮层 / 键位面板）引用的仍是基线的 `--font-body` / `--font-mono`，本模块
// 只写 `--editor-*` 三个 token（声明在 `src/style.css` 的 `:root`）。这条边界由 token 分层
// **结构性**保证，不靠逐处记得改——直接覆盖 shell token 会让界面密度一起漂（被否决的方案见
// change 的 design §3）。
//
// 为什么是 CSS 变量而不是 CM 的 Compartment 重配：字号与字体族是纯样式值，不是 CM 扩展；
// 一份变量天然覆盖全部会话（含后台标签页）与两种模式，而 Compartment 路线要遍历 sessions
// 重配（漏掉后台会话正是 M180 记过的出错面）。代价是「变更后必须重测量」要靠显式调用——
// 施加点（`src/editor.ts` 的 `applyTypographySettings`）因此每次都请求一次重测量。
//
// 三处出厂默认写值的处置（与 M180 的 DEFAULT_LINE_WRAP 同族）：Rust `EditorConfig::default()`
// 的 `font_size` / CSS `--editor-font-size` 的默认值 / 本文件的 `DEFAULT_FONT_SIZE`。三处语义
// 相同、各有断言钉住（`cargo test` 的 config 单测、`tests/unit/typography.test.ts`、
// 视觉场景的默认口径计算属性断言），改一处必须同步其余两处（REVIEW.md 第 8 条）。

/**
 * 编辑器内容字号的出厂默认（px）。与 Rust 侧 `src-tauri/src/config.rs` 的
 * `DEFAULT_FONT_SIZE` 同值（那边是配置面的真源，TS 侧是「配置到达之前」的起步值）。
 */
export const DEFAULT_FONT_SIZE = 16;

/** 字号钳制区间（含端点）。与 Rust 侧的 `FONT_SIZE_MIN` / `FONT_SIZE_MAX` 同值：
 *  Rust 侧管**配置值**的合法区间（越界回落默认 + warning），这里管**运行期步进**的钳制。 */
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 32;

/** 步进倍率：Emacs 的 `text-scale-mode-step` 默认 1.2，本仓取 1.1——步幅更细，代价是多按
 *  一次；理由是可逆性（越细越容易试错回退），记录在 change 的 design §2.4。 */
export const TEXT_SCALE_FACTOR = 1.1;

/** 三个编辑器 token 的**名字**（单一来源）：CSS 声明处按字面量写（样式表不是 JS），JS 的
 *  写入点（applyTypography）与取值点（`src/preview/lists.ts` 的 canvas 测量）都引这里。 */
export const EDITOR_FONT_FAMILY_TOKEN = "--editor-font-family";
export const EDITOR_MONO_FAMILY_TOKEN = "--editor-mono-family";
export const EDITOR_FONT_SIZE_TOKEN = "--editor-font-size";

/** 基线族的 token 名：用户字体值的**后备栈**来源（读它们的现值拼在用户值之后）。 */
export const BASELINE_FONT_FAMILY_TOKEN = "--font-body";
export const BASELINE_MONO_FAMILY_TOKEN = "--font-mono";

/** 排版口径的三个配置项（Rust `EditorConfig` 的对应字段；`null` = 沿用基线）。 */
export interface TypographySettings {
  /** 正文族（`editor.font_family`）；`null` / 空串 / 纯空白都归一为「沿用基线」。 */
  readonly fontFamily: string | null;
  /** 等宽族（`editor.mono_font_family`）：列表标记的渲染与测量共用它。 */
  readonly monoFontFamily: string | null;
  /** 编辑器内容字号 px（配置值，或运行期的步进值）。 */
  readonly fontSize: number;
}

/** 步进方向（`reset` 回到**配置值**，不是出厂 16px——Emacs 的 `C-x C-0` 同义）。 */
export type TextScaleDirection = "up" | "down" | "reset";

/** 一档步进的结果（纯函数）：`up` = `round(size × 1.1)`、`down` = `round(size ÷ 1.1)`，
 *  再钳到 `[12, 32]`。取整成整数 px 是为了让读数可逐值比对（浮点会让「当前字号是多少」
 *  变成一个不稳定问题）。到界后返回原值——调用方据此判定「无变化、无提示、不报错」。 */
export function nextFontSize(current: number, direction: "up" | "down"): number {
  const scaled = direction === "up" ? current * TEXT_SCALE_FACTOR : current / TEXT_SCALE_FACTOR;
  const rounded = Math.round(scaled);
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, rounded));
}

/** 把任意字号读数归一进合法区间（越界时取端点）。 */
export function clampFontSize(size: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size));
}

/** 施加的产物：实际写进 token 的值 + 人话 warning + 生效字号（调用方读它做断言/记账）。 */
export interface TypographyWriteResult {
  /** 生效的内容字号（px）。 */
  readonly fontSize: number;
  /** 写进 `--editor-font-family` 的完整值（含基线后备栈）；`null` = 未写（沿用 CSS 默认）。 */
  readonly fontFamily: string | null;
  readonly monoFontFamily: string | null;
  readonly warnings: readonly string[];
}

/**
 * 算出该写进 token 的值（**纯函数**，DOM 判定由调用方注入 `isFamilyValid`——浏览器里是
 * `CSS.supports`，单测里是替身，两者因此可以分开验证）。
 *
 * 为什么值要拼上基线后备栈：CSS 变量替换出非法值时，声明在 computed-value 阶段失效并回落到
 * **initial**（浏览器默认字体）——那是最难自己发现的一类退化。拼上后备栈后，「字族名写错 /
 * 本机没装这个字体」退化成**基线观感**，与配置缺省不可区分（这是可接受的方向）。
 *
 * 非法值（含空串）→ 一条 warning + 不写该 token（观感保持基线），不抛错、不阻断启动。
 */
export function planTypography(
  settings: TypographySettings,
  baselines: { readonly body: string; readonly mono: string },
  isFamilyValid: (value: string) => boolean,
): TypographyWriteResult {
  const warnings: string[] = [];
  const planFamily = (
    value: string | null,
    baseline: string,
    field: string,
  ): string | null => {
    if (value === null || value.trim() === "") return null;
    // 基线为空（无 CSS 环境 / 样式表未加载）时只用用户值，避免拼出 `"Inter", ` 这种以逗号
    // 结尾的非法值把合法配置一并打成 warning。
    const combined = baseline.trim() === "" ? value : `${value}, ${baseline}`;
    if (!isFamilyValid(combined)) {
      warnings.push(
        `配置项 editor.${field} 的取值 ${JSON.stringify(value)} 不是合法的 CSS 字族值，已回退为基线字体`,
      );
      return null;
    }
    return combined;
  };
  return {
    fontSize: clampFontSize(settings.fontSize),
    fontFamily: planFamily(settings.fontFamily, baselines.body, "font_family"),
    monoFontFamily: planFamily(settings.monoFontFamily, baselines.mono, "mono_font_family"),
    warnings,
  };
}

/**
 * **唯一的 token 写入路径**（装配层与三条步进命令共用；`src/` 里只有这里写 `--editor-*`）。
 *
 * 字体族只在**配置了**才写：未配置时 `:root` 的默认值（`var(--font-body)` / `var(--font-mono)`）
 * 就是基线观感，多写一次同义字面量只会变成「同一语义两处真源」。字号每次都写——它有两个
 * 来源（配置 / 运行期步进），写一次即表达「当前生效值」。
 *
 * 写在 `document.documentElement` 上：`src/preview/lists.ts` 的列表标记测量正是观察
 * documentElement 的 `style` 属性变化的既有消费者，一次赋值即触发它按新字号 / 新字体族重测。
 */
export function applyTypography(settings: TypographySettings): TypographyWriteResult {
  const root = document.documentElement;
  const rootStyle = getComputedStyle(root);
  const planned = planTypography(
    settings,
    {
      body: rootStyle.getPropertyValue(BASELINE_FONT_FAMILY_TOKEN),
      mono: rootStyle.getPropertyValue(BASELINE_MONO_FAMILY_TOKEN),
    },
    (value) => CSS.supports("font-family", value),
  );
  root.style.setProperty(EDITOR_FONT_SIZE_TOKEN, `${planned.fontSize}px`);
  if (planned.fontFamily !== null) {
    root.style.setProperty(EDITOR_FONT_FAMILY_TOKEN, planned.fontFamily);
  }
  if (planned.monoFontFamily !== null) {
    root.style.setProperty(EDITOR_MONO_FAMILY_TOKEN, planned.monoFontFamily);
  }
  return planned;
}
