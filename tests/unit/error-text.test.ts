// 后端错误文案的**完整性门禁**（M282，change ui-language-i18n 的提案 §5.3 / D6 裁决）。
//
// 判据有两条，都是机械的（不靠人读）：
//   ① **code 全覆盖**：从 `src-tauri/src/**` 里扫出全部 `CommandError::new("<code>"` 的 code，
//      与 `src/copy-data.ts` 的 `ERROR_COPY` 逐一对账——缺一即红（防「新加的错误码在 en 界面下
//      掉回中文」这类静默半覆盖）。反向也查：`ERROR_COPY` 里不许有扫不到的幽灵 code。
//   ② **参数齐全**：对每个 code 的**每一处**构造点，检查它是否提供了该 code 文案模板里的
//      **全部**占位名（`t()` 缺参即抛错，前端会回落到中文 `message`）——这是「en 界面下
//      带参数的 code 真的上屏英文」的唯一机械保证。
//
// 口径与近似（如实登记）：Rust 侧用朴素扫描（注释 / 字符串分离 + 括号配平），不追求完整解析
// Rust；`#[cfg(test)]` 之后的代码按非产品代码排除（单测里的构造点不该要求带参数）。
// 扫不到的形态（宏展开生成、跨行拼接的 code 字面量）会让本门禁**漏报**而不是误报——宁可漏，
// 不可误，误报会让人把门禁关掉。

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { COPY, ERROR_COPY } from "../../src/copy-data.ts";
import { placeholders } from "../../src/copy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function walkRs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "target" || name === "gen") continue;
      out.push(...walkRs(full));
    } else if (name.endsWith(".rs")) {
      out.push(full);
    }
  }
  return out;
}

interface Site {
  file: string;
  line: number;
  code: string;
  /** 该构造点提供的参数键（`.param("x", …)`）。 */
  params: string[];
}

/** `CommandError::new(` 之后按括号配平取整段调用（字符串字面量整体跳过）。 */
function callText(src: string, openParen: number): string {
  let i = openParen;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      i += 1;
      while (src[i] !== '"') {
        if (src[i] === "\\") i += 1;
        i += 1;
      }
    } else if (c === "(") {
      depth += 1;
    } else if (c === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(openParen + 1, i);
    }
    i += 1;
  }
  throw new Error("括号不配平");
}

function scanSites(): Site[] {
  const sites: Site[] = [];
  for (const file of walkRs(path.join(root, "src-tauri/src"))) {
    const rel = path.relative(root, file);
    // 只切掉**测试模块**（文件里最后一处 `#[cfg(test)]`）：有些文件的函数内部还有
    // `#[cfg(test)]` 小段，用「第一处」会把它之后的产品代码一起切掉（logging.rs 实测）。
    const full = readFileSync(file, "utf8");
    const cut = full.lastIndexOf("#[cfg(test)]");
    const src = cut < 0 ? full : full.slice(0, cut);
    let i = 0;
    while ((i = src.indexOf("CommandError::new(", i)) >= 0) {
      const open = i + "CommandError::new".length;
      const text = callText(src, open);
      const code = /^\s*"([a-z_0-9]+)"/.exec(text)?.[1];
      if (code !== undefined) {
        // `.param("x", …)` 都在同一个调用表达式之后（`CommandError::new(…).param(…)`），
        // 因此从调用末尾往后扫到语句结束（`;` 或换行后的非 `.param` 行）。
        const after = src.slice(open + text.length + 1);
        const tail = after.slice(0, 400);
        const params = [...tail.matchAll(/\.param\("([A-Za-z_][A-Za-z0-9_]*)"/g)]
          .map((m) => m[1])
          // 只取紧邻的那一串链（遇到第一个非 `.param` 的实义字符就停）
          .filter((_, index) => {
            const chain = tail.slice(0, tail.search(/[^.\s]|\.(?!param)/) === -1 ? tail.length : undefined);
            void chain;
            return index < 12;
          });
        sites.push({
          file: rel,
          line: src.slice(0, i).split("\n").length,
          code,
          params,
        });
      }
      i = open + text.length + 1;
    }
  }
  return sites;
}

const SITES = scanSites();

test("完整性门禁：后端可能产出的 code 集合与 ERROR_COPY 一一对应", () => {
  const codes = new Set(SITES.map((s) => s.code));
  const table = new Set(Object.keys(ERROR_COPY));
  const missing = [...codes].filter((c) => !table.has(c));
  const ghost = [...table].filter((c) => !codes.has(c));
  assert.deepEqual(missing, [], `这些 code 在 ERROR_COPY 里没有条目（en 界面会掉回中文 message）`);
  assert.deepEqual(ghost, [], `ERROR_COPY 里这些 code 在后端扫不到（幽灵条目）`);
  // 反向判据（REVIEW.md 第 1 条）：扫描确实扫到了东西，不是「两边都空所以相等」。
  assert.ok(SITES.length >= 90, `构造点扫描异常（${SITES.length} 处）`);
  assert.ok(codes.size >= 45, `code 扫描异常（${codes.size} 个）`);
});

test("完整性门禁：每处构造点都提供该 code 文案的全部占位名（缺一个即回落中文）", () => {
  const problems: string[] = [];
  for (const site of SITES) {
    const key = ERROR_COPY[site.code];
    assert.ok(key !== undefined, `${site.code} 不在 ERROR_COPY 里`);
    const need = placeholders(COPY[key].zh);
    const missing = need.filter((name) => !site.params.includes(name));
    if (missing.length > 0) {
      problems.push(`${site.file}:${site.line} ${site.code} 缺参数 ${missing.join(" / ")}`);
    }
  }
  assert.deepEqual(problems, [], `这些构造点没有给全文案参数 ⇒ en 界面下会回落到中文 message`);
  // 反向判据：确实有一批构造点带参数（否则这条断言恒真）。
  assert.ok(SITES.filter((s) => s.params.length > 0).length >= 30, "带参数的构造点太少，扫描口径可疑");
});

test("errorText()：按 code 渲染并插参；未知 code 与缺参都回落到 message（兜底不可达但存在）", async () => {
  const { errorText } = await import("../../src/copy.ts");
  // 带参数的 code（en）：参数插进去，不出现未替换的占位符
  assert.equal(
    errorText({ code: "fs_not_found", message: "文件不存在：a.md", params: { rel: "a.md" } }, "en"),
    COPY.D174.en.replace("{rel}", "a.md"),
  );
  // 同一个 code 换语言取另一列（zh 与迁移前的 message 逐字相同）
  assert.equal(
    errorText({ code: "fs_not_found", message: "文件不存在：a.md", params: { rel: "a.md" } }, "zh"),
    COPY.D174.zh.replace("{rel}", "a.md"),
  );
  // 多参数的 code
  assert.equal(
    errorText(
      {
        code: "fs_rename_failed",
        message: "改名失败：a.md → b.md（权限）",
        params: { rel: "a.md", newName: "b.md", reason: "权限" },
      },
      "en",
    ),
    COPY.D183.en.replace("{rel}", "a.md").replace("{newName}", "b.md").replace("{reason}", "权限"),
  );
  // 参数缺失（后端某个构造点忘了补）→ 回落 message，不抛给用户
  const fellBack = errorText({ code: "fs_not_found", message: "文件不存在：a.md" }, "en");
  assert.ok(fellBack.includes("文件不存在"), "缺参必须回落到 message 而不是炸掉");
  // 未知 code → 回落 message
  assert.equal(errorText({ code: "no_such_code", message: "人话" }, "en"), "人话");
  // 非信封异常 → 取 message / String(e)
  assert.equal(errorText(new Error("boom")), "boom");
  assert.equal(errorText("plain"), "plain");
});
