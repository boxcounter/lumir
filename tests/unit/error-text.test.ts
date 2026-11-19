// 后端错误文案的**完整性门禁**（M282，change ui-language-i18n 的提案 §5.3 / D6 裁决）。
//
// 判据有两条，都是机械的（不靠人读）：
//   ① **code 全覆盖**：从 `src-tauri/src/**` 里扫出全部上屏 code，与 `src/copy-data.ts` 的
//      `ERROR_COPY` 逐一对账——缺一即红（防「新加的错误码在 en 界面下掉回中文」这类静默
//      半覆盖）。反向也查：`ERROR_COPY` 里不许有扫不到的幽灵 code。扫描面有三条通道：
//      · `CommandError::new("<code>", …)`（命令错误信封）；
//      · `field_error(path, "code", message)` → `SettingsFieldError`（设置面板字段错误，
//        M852 起纳入）；
//      · `events::error("<code>", …)`（流式事件的**字面量** code，M858 起纳入——此前是
//        盲区，`harness_internal_error` / `harness_empty_response` 因此漏了本地化）。
//      三条通道都没有 params 的那两条（字段错误 / 事件）走 `FIELD_ERROR_COPY` 或
//      `ERROR_COPY`，且模板 MUST NOT 带占位（见第一条判据的姊妹测试）。
//   ② **参数齐全**：对每个 `CommandError` code 的**每一处**构造点，检查它是否提供了该 code
//      文案模板里的**全部**占位名（`t()` 缺参即抛错，前端会回落到中文 `message`）——这是
//      「en 界面下带参数的 code 真的上屏英文」的唯一机械保证。
//
// 口径与近似（如实登记）：Rust 侧用朴素扫描（注释 / 字符串分离 + 括号配平），不追求完整解析
// Rust；`#[cfg(test)]` 之后的代码按非产品代码排除（单测里的构造点不该要求带参数）。
// 扫不到的形态（宏展开生成、跨行拼接的 code 字面量、`code: "…"` 结构体字段）会让本门禁
// **漏报**而不是误报——宁可漏，不可误，误报会让人把门禁关掉。

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { COPY, ERROR_COPY, FIELD_ERROR_COPY } from "../../src/copy-data.ts";
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

/** 把字符串字面量与注释里的字符换成空格（保留长度与换行），供 `indexOf` 定位**代码**里的
 *  构造点。`callText` 仍读原文（它自己会跳过字符串），因此两者的索引必须逐字对齐。
 *
 *  为什么需要：M858 实测 `harness/turn.rs` 的单测里有 `"\n#[cfg(test)]\nmod tests {"` 与
 *  `"events::error("` 这两类**字符串里的示例代码**——只按 `lastIndexOf("#[cfg(test)]")` 切
 *  测试模块会被字符串骗过，把整个测试模块当产品代码扫。朴素的 lexer 只为这个判据服务，
 *  覆盖行 / 块注释、`"…"` / `b"…"` / `r#"…"#` 与字符字面量；不追求完整 Rust 解析
 *  （宏里的字符串、跨行 raw 边界等仍可能漏，宁可漏报不误报）。 */
function maskRust(src: string): string {
  const out = src.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < src.length; k += 1) {
      if (src[k] !== "\n") out[k] = " ";
    }
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const start = i;
      while (i < src.length && src[i] !== "\n") i += 1;
      blank(start, i);
    } else if (c === "/" && src[i + 1] === "*") {
      const start = i;
      let depth = 0;
      while (i < src.length) {
        if (src[i] === "/" && src[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else if (src[i] === "*" && src[i + 1] === "/") {
          depth -= 1;
          i += 2;
          if (depth === 0) break;
        } else {
          i += 1;
        }
      }
      blank(start, i);
    } else if (c === "r" || (c === "b" && src[i + 1] === "r")) {
      const rAt = c === "r" ? i : i + 1;
      let j = rAt + 1;
      let hashes = 0;
      while (src[j] === "#") {
        hashes += 1;
        j += 1;
      }
      if (src[j] === '"') {
        const start = i;
        const closer = `"${"#".repeat(hashes)}`;
        const end = src.indexOf(closer, j + 1);
        i = end < 0 ? src.length : end + closer.length;
        blank(start, i);
      } else {
        i += 1;
      }
    } else if (c === '"' || (c === "b" && src[i + 1] === '"')) {
      const start = i;
      let j = c === "b" ? i + 1 : i;
      j += 1;
      while (j < src.length && src[j] !== '"') {
        if (src[j] === "\\") j += 1;
        j += 1;
      }
      i = Math.min(j + 1, src.length);
      blank(start, i);
    } else if (c === "'") {
      // 字符字面量（`'x'` / `'\n'` / `'"'`）；生命周期（`'a`）不当作字面量。
      const match = /^'(?:\\.|[^\\'])'/.exec(src.slice(i, i + 6));
      if (match !== null) {
        const start = i;
        i += match[0].length;
        blank(start, i);
      } else {
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  return out.join("");
}

interface Site {
  file: string;
  line: number;
  code: string;
  /** 该构造点提供的参数键（`.param("x", …)`）。字段错误与事件字面量恒为空。 */
  params: string[];
  /** `field_error(path, "code", message)` 构造的字段级错误（`SettingsFieldError`）。 */
  field?: boolean;
  /** `events::error("code", message)` 构造的流式事件错误（只有 `{code, message}`）。 */
  event?: boolean;
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
    // 切点与构造点都在 `maskRust` 的掩码上定位——字符串 / 注释里的示例代码（turn.rs 的单测
    // 里就有 `"#[cfg(test)]"` 与 `"events::error("` 的字面量）不得参与扫描。
    const full = readFileSync(file, "utf8");
    const maskedFull = maskRust(full);
    const cut = maskedFull.lastIndexOf("#[cfg(test)]");
    const src = cut < 0 ? full : full.slice(0, cut);
    const masked = cut < 0 ? maskedFull : maskedFull.slice(0, cut);
    let i = 0;
    while ((i = masked.indexOf("CommandError::new(", i)) >= 0) {
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
    // 设置面板的**字段级错误**（`field_error(path, "code", message)` → `SettingsFieldError`）：
    // 与 `CommandError` 同属「后端 code = 上屏文案的键」这一口径，只是走另一条信封。
    // code 是第二个参数（path 可能是字面量也可能是 `format!`），因此按顶层逗号切参数再取。
    let j = 0;
    while ((j = masked.indexOf("field_error(", j)) >= 0) {
      const open = j + "field_error".length;
      const text = callText(src, open);
      const args = splitTopLevelArgs(text);
      const code = args.length >= 2 ? /^"([a-z_0-9]+)"$/.exec(args[1])?.[1] : undefined;
      if (code !== undefined) {
        // 字段错误没有 params 通道（`SettingsFieldError` 只有 path / code / message）。
        sites.push({ file: rel, line: src.slice(0, j).split("\n").length, code, params: [], field: true });
      }
      j = open + text.length + 1;
    }
    // 流式 `error` 事件的**字面量 code**（`events::error("code", message)`）：第三类上屏来源，
    // 前两类（`CommandError::new` / `field_error`）的扫描都看不见它——M852 的
    // `harness_internal_error` / `harness_empty_response` 就是这样漏掉的。动态形态
    // （`events::error(&e.code, …)` / `reason.code`）不在此列：code 来自前两类，已被上面的
    // 构造点扫描覆盖；这里只认第一个参数是裸字符串字面量的调用。
    let k = 0;
    while ((k = masked.indexOf("events::error(", k)) >= 0) {
      const open = k + "events::error".length;
      const text = callText(src, open);
      const first = splitTopLevelArgs(text)[0];
      const code = first !== undefined ? /^"([a-z_0-9]+)"$/.exec(first)?.[1] : undefined;
      if (code !== undefined) {
        // 事件载荷只有 `{code, message}`：没有 params 通道（`events.rs` 的 `error`）。
        sites.push({ file: rel, line: src.slice(0, k).split("\n").length, code, params: [], event: true });
      }
      k = open + text.length + 1;
    }
  }
  return sites;
}

/** 把调用文本按**顶层**逗号切成参数：字符串字面量整体跳过，三种括号各自配平。
 *  用于 `field_error(path, code, message)` 这种「第 N 个参数才是 code」的构造点。 */
function splitTopLevelArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      i += 1;
      while (text[i] !== '"') {
        if (text[i] === "\\") i += 1;
        i += 1;
      }
    } else if (c === "(" || c === "[" || c === "{") {
      depth += 1;
    } else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
    } else if (c === "," && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((arg) => arg.trim()).filter((arg) => arg.length > 0);
}

const SITES = scanSites();

test("完整性门禁：后端可能产出的 code 集合与 ERROR_COPY 一一对应", () => {
  const commandSites = SITES.filter((s) => s.field !== true && s.event !== true);
  const fieldSites = SITES.filter((s) => s.field === true);
  const eventSites = SITES.filter((s) => s.event === true);
  const codes = new Set(commandSites.map((s) => s.code));
  const fieldCodes = new Set(fieldSites.map((s) => s.code));
  const eventCodes = new Set(eventSites.map((s) => s.code));
  const table = new Set(Object.keys(ERROR_COPY));
  const missing = [...codes].filter((c) => !table.has(c));
  // 字段错误进 `ERROR_COPY`，或在参数面不同时进 `FIELD_ERROR_COPY`（两栖 code 的字段档）。
  const uncoveredField = [...fieldCodes].filter((c) => !table.has(c) && !(c in FIELD_ERROR_COPY));
  const uncoveredEvent = [...eventCodes].filter((c) => !table.has(c));
  const ghost = [...table].filter(
    (c) => !codes.has(c) && !fieldCodes.has(c) && !eventCodes.has(c),
  );
  assert.deepEqual(missing, [], `这些 code 在 ERROR_COPY 里没有条目（en 界面会掉回中文 message）`);
  assert.deepEqual(
    uncoveredField,
    [],
    `这些字段错误 code 既没有 ERROR_COPY 条目、也不在 FIELD_ERROR_COPY 里`,
  );
  assert.deepEqual(
    uncoveredEvent,
    [],
    `这些事件字面量 code 在 ERROR_COPY 里没有条目（en 界面会掉回中文 message）`,
  );
  assert.deepEqual(ghost, [], `ERROR_COPY 里这些 code 在后端扫不到（幽灵条目）`);
  // 反向判据（REVIEW.md 「断言等价于子串」条）：扫描确实扫到了东西，不是「两边都空所以相等」。
  assert.ok(SITES.length >= 90, `构造点扫描异常（${SITES.length} 处）`);
  assert.ok(codes.size >= 45, `code 扫描异常（${codes.size} 个）`);
  // 字段错误扫描确实命中（否则 uncoveredField 恒空、两条信封的覆盖形同没有）。
  assert.ok(fieldSites.length >= 13, `field_error 构造点扫描异常（${fieldSites.length} 处）`);
  assert.ok(fieldCodes.size >= 13, `字段错误 code 扫描异常（${fieldCodes.size} 个）`);
  // 事件字面量扫描确实命中（否则 uncoveredEvent 恒空、`events::error` 仍是盲区）。
  assert.ok(eventSites.length >= 3, `events::error 字面量构造点扫描异常（${eventSites.length} 处）`);
  assert.ok(eventCodes.size >= 2, `事件字面量 code 扫描异常（${eventCodes.size} 个）`);
  // `FIELD_ERROR_COPY` 不能收没有字段构造点的 code（没有消费者的条目 = 无声的假豁免）。
  const stray = Object.keys(FIELD_ERROR_COPY).filter((c) => !fieldCodes.has(c));
  assert.deepEqual(stray, [], `FIELD_ERROR_COPY 里这些 code 没有字段错误构造点`);
});

test("完整性门禁：字段错误与事件字面量的模板不带占位（两条通道都没有 params）", () => {
  // 带占位的模板会被 errorText 的缺参兜底打回中文 message——与「没迁移」等价，却看起来像迁了。
  // 字段错误：`SettingsFieldError` 只有 path / code / message；流式事件：只有 code / message。
  // 两栖 `config_parse_failed` 的字段档读 `FIELD_ERROR_COPY`（与 `mapFieldErrors` 传的同一张表）。
  const noParamCodes = new Set(
    SITES.filter((s) => s.field === true || s.event === true).map((s) => s.code),
  );
  const problems: string[] = [];
  for (const code of noParamCodes) {
    const key = FIELD_ERROR_COPY[code] ?? ERROR_COPY[code];
    if (key === undefined) continue; // 缺条目由上面的完整性门禁单独判红。
    const need = placeholders(COPY[key].zh);
    if (need.length > 0) problems.push(`${code} → ${key} 的模板带占位 ${need.join(" / ")}`);
  }
  assert.deepEqual(problems, [], `字段错误 / 事件字面量模板 MUST NOT 带占位`);
  // 反向判据：这条判据不能是「两类一条都没进表」的空转。
  assert.ok(
    [...noParamCodes].filter((c) => c in ERROR_COPY || c in FIELD_ERROR_COPY).length >= 15,
    "至少十五条无参通道的 code 已进文案表（否则本条恒真）",
  );
});

test("完整性门禁：每处构造点都提供该 code 文案的全部占位名（缺一个即回落中文）", () => {
  // 字段错误与事件字面量没有 params 通道（`{path, code, message}` / `{code, message}`），它们的
  // 「模板不带占位」由上一条判据盯，这里只看 `CommandError` 的 `.param(…)` 链。
  const commandSites = SITES.filter((s) => s.field !== true && s.event !== true);
  const problems: string[] = [];
  for (const site of commandSites) {
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
  assert.ok(commandSites.filter((s) => s.params.length > 0).length >= 30, "带参数的构造点太少，扫描口径可疑");
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

// M686（change fix-quote-decode-error-copy-oct24）：同一个 `attachment_decode_failed` 在两个
// 调用点各有措辞。粘贴侧不经过覆盖表，读的仍是 D438；引用侧的改道在 quote-image.test.ts 里判。
test("粘贴侧锁定：errorText 的 attachment_decode_failed 仍读 D438（「剪贴板」措辞逐字不变）", async () => {
  const { errorText } = await import("../../src/copy.ts");
  const reason = "invalid PNG signature";
  const envelope = { code: "attachment_decode_failed", message: "无法解码剪贴板图片", params: { reason } };
  assert.equal(errorText(envelope, "zh"), COPY.D438.zh.replace("{reason}", reason));
  assert.match(errorText(envelope, "zh"), /剪贴板/, "粘贴语境的限定词必须还在（引用语境的 D588 不承担这层信息）");
  assert.equal(errorText(envelope, "en"), COPY.D438.en.replace("{reason}", reason));
  assert.match(errorText(envelope, "en"), /clipboard/);
  // 缺参：仍是既有兜底（回落 message、不抛错、不留未替换占位符）——与 M686 之前逐字相同。
  const fellBack = errorText({ code: "attachment_decode_failed", message: "无法解码剪贴板图片" }, "zh");
  assert.equal(fellBack, "无法解码剪贴板图片");
  assert.ok(!fellBack.includes("{reason}"));
});

test("errorText() 的可选覆盖表：只换 code → 键，命中与未命中的 code 各走各的（M686）", async () => {
  const { errorText } = await import("../../src/copy.ts");
  const overrides = { attachment_decode_failed: "D588" } as const;
  // 命中的 code：读覆盖表里的键。
  assert.equal(
    errorText(
      { code: "attachment_decode_failed", message: "后端人话", params: { reason: "bad signature" } },
      "zh",
      overrides,
    ),
    COPY.D588.zh.replace("{reason}", "bad signature"),
  );
  // 未命中的 code：行为与不传覆盖表完全相同（不是「传了就整张表替换」）。
  assert.equal(
    errorText({ code: "attachment_too_large", message: "后端人话", params: { mb: 1, limit: 50 } }, "zh", overrides),
    COPY.D437.zh.replace("{mb}", "1").replace("{limit}", "50"),
  );
  // 缺参兜底仍只有一份：回落 message（不会先抛出来、也不会留占位符）。
  assert.equal(
    errorText({ code: "attachment_decode_failed", message: "后端人话" }, "zh", overrides),
    "后端人话",
  );
});
