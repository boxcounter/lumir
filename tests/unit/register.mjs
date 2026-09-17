// tests/unit/register.mjs — 用 `node --import` 挂上解析钩子（run.mjs 负责传入）。
// 拆成两个文件是因为 register() 的第一个参数是相对本文件的说明符，钩子本体在 hooks.mjs。
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
