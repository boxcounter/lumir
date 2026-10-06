// 文案取值层（M282，change ui-language-i18n）：双列文案表 + 占位插值 + 语言读取 + 重绘注册。
//
// 分层（REVIEW.md 第 8 条：同一语义不留两处真源）：
//   - 本模块：`t()` / `tPlural()` 的取值与插值、运行期当前语言的**读取**（真源是
//     `<html lang>`，本模块不缓存）、`Intl` 格式化、以及长驻 chrome 的重绘注册表；
//   - src/copy-data.ts：**唯一的文案数据**（每键 zh / en 两列，键 = 文案 deck 的 D 编号）；
//   - src/main.ts 的 `applyLanguage`：**唯一施加点**——写 `<html lang>` 并跑重绘注册表，
//     启动装配与运行期切换都经它，MUST NOT 出现第二处语言写入者（与 `applyTheme` 同款纪律）。
//
// 真源与评审面的分工：`文案-Copy.md` 是**规范文本 + 人评审面**（含「设计意图」列），本表是
// **运行时唯一取值入口**，两边由 `tests/unit/copy.test.ts` 的全量漂移门禁钉住（改一处必红）。
// 表不是从 deck 生成的，理由见 design §4.2（deck 的格是编辑性 bundle，不是「一格一条串」）。

import { COPY, ERROR_COPY } from "./copy-data";
import type { CopyEntry, CopyKey } from "./copy-data";

export type { CopyEntry, CopyKey } from "./copy-data";

/** 界面语言两档。与 Rust 侧 `UiLanguage`（src/bindings/UiLanguage.ts）同值域，且与
 *  `[ui] language` 的配置值逐字相同（配置值即语言档，中间不设映射表）。 */
export type Language = "zh" | "en";

/** 出厂默认语言（`UiConfig::default().language` 的同值）。本模块只在「读不到 `<html lang>`」
 *  时用它兜底——那只发生在 DOM 尚未挂载的极早期（如单测环境），正常运行期施加点先写属性。 */
export const DEFAULT_LANGUAGE: Language = "en";

/** 两档循环序（`view.language-cycle` 的循环取下一档）。顺序与 deck 的编号无关，
 *  只表达「按一下换到另一档」——两档语言的循环就是切换，不新增第二套交互。 */
export const LANGUAGE_CYCLE: readonly Language[] = ["en", "zh"];

/** `ui.language` 的档位 → BCP-47 标签（供 `<html lang>` 与 `Intl` 共用一份映射）。 */
const LANGUAGE_TAG: Record<Language, string> = { zh: "zh-Hans", en: "en" };

/** 读 `<html lang>` 的结构边界：只要求有 `lang` 字段，因此纯逻辑层可传结构替身
 *（与 `src/theme.ts` 的 `currentTheme(root)` 同款——单测不造 DOM 替身）。 */
export interface LanguageRoot {
  lang?: string | undefined;
}

export function languageTag(lang: Language): string {
  // 兜底是给**桩环境**的：契约里 `ui.language` 必在场（Rust 的 `UiConfig` 不是 Option），
  // 但测试桩可能落后于契约——那时退回默认档，而不是把 `undefined` 写进 `<html lang>`。
  return LANGUAGE_TAG[lang] ?? LANGUAGE_TAG[DEFAULT_LANGUAGE];
}

/** BCP-47 标签 → 档位。标签缺失或不是 `zh` / `zh-Hans` 一族时落回默认档——**不猜**。 */
export function languageFromTag(tag: string | undefined): Language {
  if (tag === undefined) return DEFAULT_LANGUAGE;
  return /^zh\b/i.test(tag) ? "zh" : tag === "en" ? "en" : DEFAULT_LANGUAGE;
}

/** 语言属性的**读取口**（默认读真实的 `document.documentElement`）。单测环境没有 DOM，
 *  经 `setLanguageRoot` 挂一个结构替身的读取函数——它是「从哪读」，不是「读到什么」，
 *  因此不构成 `currentLanguage` 之外的第二处语言真源（与 `installBackend()` 只造平台边界
 *  同款；MUST NOT 伪造整个 `globalThis.document`，CodeMirror 一类库在导入期做特性探测）。 */
let languageRootProvider: (() => LanguageRoot | undefined) | undefined;

/** 单测专用：换掉语言属性的读取口（传 `undefined` 恢复默认）。 */
export function setLanguageRoot(provider: (() => LanguageRoot | undefined) | undefined): void {
  languageRootProvider = provider;
}

/** 运行期当前语言（唯一真源 = `<html lang>`，MUST NOT 在本模块另存一份）。
 *
 *  根元素默认取 `document.documentElement`；`root` 参数是给纯逻辑层与单测的结构注入点。
 *  DOM 尚未挂载（如 Node 单测环境）时按默认档取值，绝不抛错——文案取值在任何时候都要能返回。 */
export function currentLanguage(root?: LanguageRoot): Language {
  if (root !== undefined) return languageFromTag(root.lang);
  if (languageRootProvider !== undefined) return languageFromTag(languageRootProvider()?.lang);
  const el = typeof document === "undefined" ? undefined : document.documentElement;
  return languageFromTag(el?.lang);
}

/** `Intl` 家族要的 locale 标识（与 `<html lang>` 同一份映射，不另立第二处）。 */
export function intlLocale(lang: Language = currentLanguage()): string {
  return LANGUAGE_TAG[lang];
}

/** 循环取下一档（`view.language-cycle` 的纯逻辑；`current` 缺省时按默认档继续）。 */
export function nextLanguage(current?: Language | null): Language {
  const from = current ?? DEFAULT_LANGUAGE;
  return LANGUAGE_CYCLE[(LANGUAGE_CYCLE.indexOf(from) + 1) % LANGUAGE_CYCLE.length];
}

/**
 * 取某个键在当前语言下的措辞并按 `{占位名}` 插值。
 *
 * - 上屏列锁定条目（`lock`）无视当前语言，恒取锁定列——M257 裁定的三条标签菜单项
 *   （D149–D151）就是这样变成长驻英文的（design §4.5）；
 * - 缺参**报错**而不是留一个空槽：`{name}` 原样上屏既看不懂也查不出，正是要防的静默失败
 *   （REVIEW.md 第 1 条）；多余的参数不报错（向前兼容，调用点可以先备好参数）。
 */
export function t(
  key: CopyKey,
  params?: Record<string, string | number>,
  lang: Language = currentLanguage(),
): string {
  return interpolate(render(COPY[key], lang, false), key, params);
}

/**
 * 复数形态取值：按 `Intl.PluralRules` 判定 `count` 的复数档选形态，**不用 `count === 1 ? a : b`**
 * ——那是把语言的复数规则写死在代码里（design §6.2）。表里只给 en 的 `one` 档（`enOne`）；
 * 其余档（`other`）用主形。中文没有复数区分，`enOne` 缺省即两档同形。
 */
export function tPlural(
  key: CopyKey,
  count: number,
  params?: Record<string, string | number>,
  lang: Language = currentLanguage(),
): string {
  const one = new Intl.PluralRules(intlLocale(lang)).select(count) === "one";
  return interpolate(render(COPY[key], lang, one), key, params);
}

/** 表条目的形态选择（锁定列 > 复数 one 档 > 当前语言列）。 */
function render(entry: CopyEntry, lang: Language, pluralOne: boolean): string {
  if (entry.lock !== undefined) return entry[entry.lock];
  if (lang === "en" && pluralOne && entry.enOne !== undefined) return entry.enOne;
  return entry[lang];
}

const PLACEHOLDER = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/** `{占位名}` 插值。缺参抛错（带键名与缺失的占位名，便于定位）。 */
export function interpolate(
  template: string,
  key: string,
  params?: Record<string, string | number>,
): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    if (params === undefined || !(name in params)) {
      throw new Error(`文案 ${key} 缺少占位参数 {${name}}`);
    }
    return String(params[name]);
  });
}

/** 模板里出现的占位名（按出现顺序，含重名）。漂移门禁与「两列占位名同名」断言共用这一份口径。 */
export function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

/** `CommandError` 信封里本模块关心的字段（避免 copy 层依赖 src/ipc.ts 造成环）。 */
export interface ErrorEnvelope {
  code: string;
  message: string;
  params?: Record<string, string> | null | undefined;
}

/**
 * 后端错误的**上屏**文本（change ui-language-i18n 的 D6 裁决）：按 `code` 取文案表的条目并插
 * 参数；表里没有这个 code 时回落到 `message`（后端的人话，兜底存在但由完整性门禁保证不可达）。
 *
 * 缺参不抛给用户：Rust 侧某个构造点忘了补参数时，`t()` 会因缺参抛错——这里接住并回落到
 * `message`，同时留一条 console 线索（诊断面，不进 UI）。宁可显示一句中文，也不让一次
 * 「忘了补参数」把提示变成异常。日志与诊断面仍走 `message`（`errorMessage`），不随语言变。
 */
export function errorText(e: unknown, lang: Language = currentLanguage()): string {
  if (!isErrorEnvelope(e)) return messageOf(e);
  const key = ERROR_COPY[e.code];
  if (key === undefined) return e.message;
  try {
    return t(key, e.params ?? undefined, lang);
  } catch (err) {
    console.warn(`lumir: 错误文案缺参（${key}）：${String(err)}`);
    return e.message;
  }
}

/** 非信封异常的读法：带 `message` 的对象取 `message`（与 `src/ipc.ts` 的 `errorMessage`
 *  同口径），其余取 `String(e)`——「不是 CommandError」不等于「没有可读的话」。 */
function messageOf(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const message = (e as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(e);
}

/** 信封形状判定（与 `src/ipc.ts` 的 `isCommandError` 同口径）。本模块不 import `ipc.ts`：
 *  那条路会把 Tauri 运行时拖进纯逻辑单测（vault-switcher 原先的本地 helper 就是为此存在）。 */
function isErrorEnvelope(e: unknown): e is ErrorEnvelope {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as ErrorEnvelope).code === "string" &&
    typeof (e as ErrorEnvelope).message === "string"
  );
}

// ---------------------------------------------------------------------------
// 长驻 chrome 的重绘注册（design §5.2 的不变量：任何承载语言相关文案的元素，MUST 有一条
// 能在运行期重跑它的写入路径）。按注册顺序执行——同一模块内的重写顺序因此是确定的。
// ---------------------------------------------------------------------------

const relabels: Array<() => void> = [];

/** 注册一条「语言变了，把长驻文案重写一遍」的回调。按需构建的浮层不需要注册
 *（它们打开时取文案，天然是新语言）。 */
export function onRelabel(fn: () => void): void {
  relabels.push(fn);
}

/** 跑一遍全部重绘回调（施加点唯一调用）。**注册表之外的调用点 = 第二处施加路径**，
 *  除 `applyLanguage` 外 MUST NOT 有人调用它。 */
export function runRelabels(): void {
  for (const fn of relabels) fn();
}

/** 单测用：清空注册表（同一次进程里重复装壳时避免回调重复累积）。 */
export function resetRelabels(): void {
  relabels.length = 0;
}

// ---------------------------------------------------------------------------
// `Intl` 格式化（design §6.2）：数字 / 日期 / 相对时间 / 复数档，零依赖、零 polyfill。
// 这些**不是查表**——它们在两档语言下的差异由 ICU 数据给出，手拼格式等于把语言规则写死。
// ---------------------------------------------------------------------------

/** 分组数字（如行数 1,234）。 */
export function formatNumber(value: number, lang: Language = currentLanguage()): string {
  return new Intl.NumberFormat(intlLocale(lang)).format(value);
}

/** 文档日期的两档形态：`long` = 「2026年9月28日」/「September 28, 2026」，
 *  `short` = 「9月28日」/「September 28」。 */
export function formatDate(
  date: Date,
  style: "long" | "short" = "long",
  lang: Language = currentLanguage(),
): string {
  const options: Intl.DateTimeFormatOptions =
    style === "long"
      ? { year: "numeric", month: "long", day: "numeric" }
      : { month: "long", day: "numeric" };
  return new Intl.DateTimeFormat(intlLocale(lang), options).format(date);
}

/** 相对时间（「5 分钟前」/「5 minutes ago」、「昨天」/「yesterday」）。style 缺省 long；
 *  narrow 给紧凑位（M351 消息 when 行：zh「10秒前」——long 的「10秒钟前」与原型不符，
 *  en「10s ago」），既有消费者（D100 族）不传保持 long。 */
export function formatRelative(
  amount: number,
  unit: Intl.RelativeTimeFormatUnit,
  lang: Language = currentLanguage(),
  style: Intl.RelativeTimeFormatStyle = "long",
): string {
  return new Intl.RelativeTimeFormat(intlLocale(lang), { numeric: "auto", style }).format(amount, unit);
}

export { COPY };
