// tests/unit/register.mjs — 用 `node --import` 挂上解析钩子（run.mjs 负责传入）。
// 拆成两个文件是因为 register() 的第一个参数是相对本文件的说明符，钩子本体在 hooks.mjs。
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);

// 单测层的界面语言（M282，change ui-language-i18n）：文案层按 `<html lang>` 取值，而单测环境
// 没有 DOM——这里挂一个**读取口替身**把界面语言钉在 `zh`（不是完整 DOM 替身：`globalThis.document`
// 一旦伪造，CodeMirror 之类在导入期做特性探测的库会走进浏览器分支而报错）。
// 钉住 `zh` 的理由：既有断言全部是中文措辞，钉住它才证明「迁移是纯搬运」；`en` 面的断言在
// tests/unit/copy.test.ts 里显式传 `lang` 参数，不经这个替身。
const { setLanguageRoot } = await import("../../src/copy.ts");
setLanguageRoot(() => ({ lang: "zh-Hans" }));
