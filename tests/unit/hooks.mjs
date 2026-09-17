// tests/unit/hooks.mjs — 测试期模块解析钩子（经 register.mjs 用 node:module 的 register 挂上）。
//
// 本层的铁律是**不改 src 文件**：src/ 内部用的是 bundler 口径的无扩展名相对导入
//（`from "./ipc"`、`from "./diagnostics"`），而 Node 的 ESM 解析器要求写全扩展名。
// 这个钩子只补这一点差异：相对、无扩展名的说明符再按 `.ts` 解析一次，其余说明符一律
// 交回默认解析。不重写源码、不生成中间产物、不替换任何模块边界——跑的就是 src 里那份。
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.(m|c)?[jt]s$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // 没有对应的 .ts：交回默认解析，让 Node 报它自己的「找不到模块」
    }
  }
  return nextResolve(specifier, context);
}
