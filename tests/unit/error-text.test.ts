// 后端错误文案的**完整性门禁**（M282，change ui-language-i18n 的提案 §5.3 / D6 裁决）。
//
// 判据有两条，都是机械的（不靠人读）：
//   ① **code 全覆盖**：从 `src-tauri/src/**` 里扫出全部上屏 code，与 `src/copy-data.ts` 的
//      `ERROR_COPY` 逐一对一对账——缺一即红（防「新加的错误码在 en 界面下掉回中文」这类静默
//      半覆盖）。反向也查：`ERROR_COPY` 里不许有扫不到的幽灵 code。扫描面有五条通道：
//      · `CommandError::new("<code>", …)`（命令错误信封）；
//      · `field_error(path, "code", message)` → `SettingsFieldError`（设置面板字段错误，
//        M852 起纳入）；
//      · `events::error("<code>", …)`（流式事件的**字面量** code，M858 起纳入——此前是
//        盲区，`harness_internal_error` / `harness_empty_response` 因此漏了本地化）；
//      · `ConfigDiagnostic{code, path, message}`（装载期配置诊断，M865 起纳入）——产出点是
//        `DiagnosticSink::warn` / `warn_at`（`sink.warn(...)` / `sink.warn_at(...)`）、
//        `failed_snapshot(path, code, …)` 与 `ConfigDiagnostic { code: "…" }` 字面量；
//      · `invalid_file("code", …)` → `SettingsFileState::Invalid`（配置文件状态横幅，
//        M866 起纳入——此前横幅直出后端 message，en 界面露中文且可能露 os / parser 内部串）。
//      后四条通道都没有 params（字段错误 / 事件 / 诊断 / 文件状态）走 `ERROR_COPY`（或字段
//      错误的 `FIELD_ERROR_COPY`），且模板 MUST NOT 带占位（见第一条判据的姊妹测试）。诊断通道
//      另有一张 **log-only 豁免表**（`LOG_ONLY_DIAGNOSTIC_CODES`）：这些 code 的键路径永远
//      不在设置快照范围内，只进 console / 诊断日志（`i18n-exempt: log` 口径），不要求文案
//      条目；反向判据是豁免项必须真实存在构造点（没有静默豁免）。
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
import type { CopyKey } from "../../src/copy-data.ts";
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
  /** `ConfigDiagnostic{code, path, message}` 的产出点（装载期配置诊断，M865）。 */
  diag?: boolean;
  /** `SettingsFileState::Invalid` 的构造点（配置文件状态信封，M866）：code 是第一个参数。 */
  fileState?: boolean;
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
    // 两个事件构造口都要扫：`error`（既有）与 `error_with_retry`（change
    // add-harness-turn-retry-nov23 的可重试形态，第一个参数仍是裸字面量 code）。
    for (const needle of ["events::error(", "events::error_with_retry("]) {
      let k = 0;
      while ((k = masked.indexOf(needle, k)) >= 0) {
        const open = k + needle.length - 1;
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
    // `TurnError::new("<code>", …)`：LLM 回合错误的**字面量** code（change
    // add-harness-turn-retry-nov23 起纳入）。这些错误经 `events::error(&error.code, …)` /
    // `error_with_retry` 上屏，第一参数是动态的，上面那条事件通道扫不到；字面量只在
    // `TurnError::new` 的构造点出现一次（`harness_stream_incomplete` / `harness_stream_interrupted`
    // / `fixture_exhausted`），不纳入就是第三处盲区。
    let t = 0;
    while ((t = masked.indexOf("TurnError::new(", t)) >= 0) {
      const open = t + "TurnError::new".length;
      const text = callText(src, open);
      const code = splitTopLevelArgs(text)[0];
      const literal = code !== undefined ? /^"([a-z_0-9]+)"$/.exec(code)?.[1] : undefined;
      if (literal !== undefined) {
        sites.push({ file: rel, line: src.slice(0, t).split("\n").length, code: literal, params: [], event: true });
      }
      t = open + text.length + 1;
    }
    // 装载期**配置诊断**（M865）：`ConfigDiagnostic{code, path, message}` 是第三条上屏信封，
    // 三条构造通道——`DiagnosticSink` 的 `sink.warn(...)` / `sink.warn_at(...)`（code 是第一个
    // 参数）、`failed_snapshot(path, "code", …)`（code 是第二个参数）、直接写
    // `ConfigDiagnostic { code: "…" }` 的字面量。诊断没有 params 通道（见 Site.diag）。
    for (const [needle, argIndex] of [
      ["sink.warn_at(", 0],
      ["sink.warn(", 0],
      ["failed_snapshot(", 1],
    ] as const) {
      let m = 0;
      while ((m = masked.indexOf(needle, m)) >= 0) {
        const open = m + needle.length - 1;
        const text = callText(src, open);
        const code = /^"([a-z_0-9]+)"$/.exec(splitTopLevelArgs(text)[argIndex] ?? "")?.[1];
        if (code !== undefined) {
          sites.push({ file: rel, line: src.slice(0, m).split("\n").length, code, params: [], diag: true });
        }
        m = open + text.length + 1;
      }
    }
    let d = 0;
    while ((d = masked.indexOf("ConfigDiagnostic {", d)) >= 0) {
      // 字面量的字段区：在掩码上配平花括号（字符串内容已被掩掉，括号只来自代码），
      // 再回到原文取 `code: "…"`——`code: code.to_string()` 这类动态形态不在本通道。
      const brace = masked.indexOf("{", d);
      let depth = 0;
      let end = brace;
      for (; end < masked.length; end += 1) {
        if (masked[end] === "{") depth += 1;
        else if (masked[end] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const code = /code:\s*"([a-z_0-9]+)"/.exec(src.slice(brace + 1, end))?.[1];
      if (code !== undefined) {
        sites.push({ file: rel, line: src.slice(0, d).split("\n").length, code, params: [], diag: true });
      }
      d = end + 1;
    }
    // 配置文件状态信封（M866）：`SettingsFileState::Invalid` 的 code 由 `settings.rs` 的
    // `invalid_file("code", …)` 唯一出口构造（四个真实变体 / 三个 code）。与字段错误 / 诊断
    // 同属「后端 code = 上屏文案的键」，只是走第三条信封；没有 params（行号是结构化字段）。
    let f = 0;
    while ((f = masked.indexOf("invalid_file(", f)) >= 0) {
      const open = f + "invalid_file".length;
      const text = callText(src, open);
      const code = /^"([a-z_0-9]+)"$/.exec(splitTopLevelArgs(text)[0] ?? "")?.[1];
      if (code !== undefined) {
        sites.push({ file: rel, line: src.slice(0, f).split("\n").length, code, params: [], fileState: true });
      }
      f = open + text.length + 1;
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

/** `config.rs` 的阻断级词表（`REJECT_ON_WRITE_CODES` + `diagnostic_severity` 里补的两个名字）：
 *  `settings.rs` 的 `plan_and_apply` 把这些诊断经 `field_error(path, diagnostic.code, …)` 转成
 *  保存被拒的字段错误。它们的 code 是**动态**的（`diagnostic.code.clone()`，扫描器看不见），
 *  但确实是字段错误信封的第二来源；`FIELD_ERROR_COPY` 因此允许收录这些 code（`harness_model_*`
 *  一族的保存现场措辞与装载期诊断相反，D928–D939）。 */
function scanRejectOnWriteCodes(): Set<string> {
  const src = readFileSync(path.join(root, "src-tauri/src/config.rs"), "utf8");
  const block = /const REJECT_ON_WRITE_CODES[^=]*=\s*\[([\s\S]*?)\];/.exec(src)?.[1] ?? "";
  const codes = new Set([...block.matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]));
  for (const extra of ["settings_naming_model_missing", "settings_unknown_field"]) codes.add(extra);
  return codes;
}
const REJECT_ON_WRITE_CODES = scanRejectOnWriteCodes();

/**
 * 诊断通道的 log-only 豁免表（M865）：这些 code 的键路径**永远不在设置快照范围内**
 * （`src-tauri/src/settings.rs` 的 `in_settings_scope` 只放行 `harness.provider*`、naming 与
 * `harness.subagents.enabled`），因此只经 `ConfigSnapshot.warnings` 进 console / 诊断日志
 * （`i18n-exempt: log` 口径，见 `openspec/specs/ui-language/spec.md`「不随语言变化的面」）。
 * 设置面板没有它们的消费者，给它们造文案条目 = 无声的假覆盖（REVIEW.md『值或开关声明了却
 * 没有消费者』）。**反向判据**：本表的每一项都必须在后端有真实构造点、且不得进 `ERROR_COPY`
 * ——豁免是给「扫到了但不上屏」的 code 留的白名单，不是关闭门禁的开关。
 *
 * 装载失败三类（`config_read_failed` / `config_invalid_json` / `config_invalid_structure`）
 * 曾在此表（M865）：M866 给 `SettingsFileState::Invalid` 补了稳定 code 后，设置面板横幅成为
 * 它们的消费者，三条因此转入 `ERROR_COPY`（D940–D942）——同一个 code 在 console 诊断与横幅
 * 上是同一句话。
 */
const LOG_ONLY_DIAGNOSTIC_CODES = new Set([
  // editor / ui / keys / log / vault / cron / version / last_vault：设置面范围外的配置 warning。
  "config_last_vault_invalid",
  "config_version_newer",
  "cron_task_invalid",
  "editor_font_family_empty",
  "editor_font_size_range",
  "editor_mode_invalid",
  "editor_mono_font_family_empty",
  "keys_invalid",
  "log_invalid",
  "log_level_invalid",
  "ui_content_width_range",
  "ui_language_invalid",
  "ui_line_numbers_invalid",
  "ui_markdown_line_numbers_retired",
  "ui_sidebar_width_range",
  "ui_theme_invalid",
  "vault_ignore_name_invalid",
  "vault_ignore_tier_invalid",
  "vault_rule_file_invalid",
  // harness 子树的**范围外路径**：`harness.subagents` 整节（settings 只放行
  // `harness.subagents.enabled`）、权限与轮次 / 上下文阈值（设置面板不渲染这三类）。
  "harness_subagents_clamped",
  "harness_subagents_invalid",
  "harness_permission_mode_invalid",
  "harness_permission_rule_invalid",
  "harness_loop_max_range",
  "harness_warn_ctx_pct_range",
]);

test("完整性门禁：后端可能产出的 code 集合与 ERROR_COPY 一一对应", () => {
  const commandSites = SITES.filter((s) => s.field !== true && s.event !== true && s.diag !== true && s.fileState !== true);
  const fieldSites = SITES.filter((s) => s.field === true);
  const eventSites = SITES.filter((s) => s.event === true);
  const diagnosticSites = SITES.filter((s) => s.diag === true);
  const fileSites = SITES.filter((s) => s.fileState === true);
  const codes = new Set(commandSites.map((s) => s.code));
  const fieldCodes = new Set(fieldSites.map((s) => s.code));
  const eventCodes = new Set(eventSites.map((s) => s.code));
  const diagnosticCodes = new Set(diagnosticSites.map((s) => s.code));
  const fileCodes = new Set(fileSites.map((s) => s.code));
  const table = new Set(Object.keys(ERROR_COPY));
  const missing = [...codes].filter((c) => !table.has(c));
  // 字段错误进 `ERROR_COPY`，或在参数面不同时进 `FIELD_ERROR_COPY`（两栖 code 的字段档）。
  const uncoveredField = [...fieldCodes].filter((c) => !table.has(c) && !(c in FIELD_ERROR_COPY));
  const uncoveredEvent = [...eventCodes].filter((c) => !table.has(c));
  // 诊断：设置面可达的 code 必须进表；log-only 的 code 走显式豁免（表见上方常量）。
  const uncoveredDiagnostic = [...diagnosticCodes].filter(
    (c) => !table.has(c) && !LOG_ONLY_DIAGNOSTIC_CODES.has(c),
  );
  // 配置文件状态横幅（M866）：`SettingsFileState::Invalid` 的 code 必须进表（横幅按 code 上屏）。
  const uncoveredFile = [...fileCodes].filter((c) => !table.has(c));
  const ghost = [...table].filter(
    (c) =>
      !codes.has(c) &&
      !fieldCodes.has(c) &&
      !eventCodes.has(c) &&
      !diagnosticCodes.has(c) &&
      !fileCodes.has(c),
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
  assert.deepEqual(
    uncoveredDiagnostic,
    [],
    `这些诊断 code 既没有 ERROR_COPY 条目、也不在 LOG_ONLY_DIAGNOSTIC_CODES 里`,
  );
  assert.deepEqual(
    uncoveredFile,
    [],
    `这些配置文件状态 code 在 ERROR_COPY 里没有条目（横幅在 en 界面会掉回中文 message）`,
  );
  assert.deepEqual(ghost, [], `ERROR_COPY 里这些 code 在后端扫不到（幽灵条目）`);
  // 豁免表的反向判据：每一项都必须真实扫到（不存在的豁免 = 一条静默关掉的判据），且不得同时也是
  // 已覆盖 code（覆盖与豁免并存说明分类写错了）。
  const staleExemptions = [...LOG_ONLY_DIAGNOSTIC_CODES].filter((c) => !diagnosticCodes.has(c));
  assert.deepEqual(staleExemptions, [], `LOG_ONLY_DIAGNOSTIC_CODES 里这些 code 在诊断构造点扫不到`);
  const exemptButCovered = [...LOG_ONLY_DIAGNOSTIC_CODES].filter((c) => table.has(c));
  assert.deepEqual(exemptButCovered, [], `这些 code 已在 ERROR_COPY 里，不应再列 log-only 豁免`);
  // 反向判据（REVIEW.md 「断言等价于子串」条）：扫描确实扫到了东西，不是「两边都空所以相等」。
  assert.ok(SITES.length >= 90, `构造点扫描异常（${SITES.length} 处）`);
  assert.ok(codes.size >= 45, `code 扫描异常（${codes.size} 个）`);
  // 字段错误扫描确实命中（否则 uncoveredField 恒空、两条信封的覆盖形同没有）。
  assert.ok(fieldSites.length >= 13, `field_error 构造点扫描异常（${fieldSites.length} 处）`);
  assert.ok(fieldCodes.size >= 13, `字段错误 code 扫描异常（${fieldCodes.size} 个）`);
  // 事件字面量扫描确实命中（否则 uncoveredEvent 恒空、`events::error` 仍是盲区）。
  assert.ok(eventSites.length >= 3, `events::error 字面量构造点扫描异常（${eventSites.length} 处）`);
  assert.ok(eventCodes.size >= 2, `事件字面量 code 扫描异常（${eventCodes.size} 个）`);
  // 诊断通道同理：`sink.warn` 一族是设置面板诊断的唯一生产形态，扫不到就等于没门禁。
  assert.ok(diagnosticSites.length >= 70, `ConfigDiagnostic 构造点扫描异常（${diagnosticSites.length} 处）`);
  assert.ok(diagnosticCodes.size >= 50, `ConfigDiagnostic code 扫描异常（${diagnosticCodes.size} 个）`);
  // 配置文件状态通道：四个真实构造点 / 三个 code——扫不到就等于横幅重新直出 message。
  assert.ok(fileSites.length >= 4, `invalid_file 构造点扫描异常（${fileSites.length} 处）`);
  assert.ok(fileCodes.size >= 3, `配置文件状态 code 扫描异常（${fileCodes.size} 个）`);
  // `FIELD_ERROR_COPY` 不能收没有消费者的 code（没有消费者的条目 = 无声的假豁免）：合法来源
  // 只有两类——字面量 `field_error(...)` 构造点，与 `plan_and_apply` 动态转发的 RejectOnWrite
  // 诊断 code。
  assert.ok(REJECT_ON_WRITE_CODES.size >= 20, `REJECT_ON_WRITE_CODES 解析异常（${REJECT_ON_WRITE_CODES.size} 个）`);
  const stray = Object.keys(FIELD_ERROR_COPY).filter(
    (c) => !fieldCodes.has(c) && !REJECT_ON_WRITE_CODES.has(c),
  );
  assert.deepEqual(stray, [], `FIELD_ERROR_COPY 里这些 code 既没有字段错误构造点、也不是 RejectOnWrite 诊断 code`);
});

/** 判据本体：给定「code → 文案键」的取值面，返回带占位的条目。主线用真实表调用；
 *  mutant 用例把它喂一条带占位的假条目——证明这条判据不是恒真（REVIEW.md『断言等价于
 *  子串』条）。 */
function placeholderProblems(entries: Readonly<Record<string, CopyKey>>): string[] {
  const problems: string[] = [];
  for (const [code, key] of Object.entries(entries)) {
    const entry = (COPY as Record<string, { zh: string } | undefined>)[key];
    if (entry === undefined) {
      problems.push(`${code} → ${key} 不在文案表里`);
      continue;
    }
    const need = placeholders(entry.zh);
    if (need.length > 0) problems.push(`${code} → ${key} 的模板带占位 ${need.join(" / ")}`);
  }
  return problems;
}

test("完整性门禁：字段错误 / 事件字面量 / 装载期诊断的模板不带占位（按信封分列检查）", () => {
  // 带占位的模板会被 errorText 的缺参兜底打回中文 message——与「没迁移」等价，却看起来像迁了。
  // **必须按信封分列**：12 个 RejectOnWrite code 同时出现在两条信封上，若只用
  // `FIELD_ERROR_COPY[code] ?? ERROR_COPY[code]` 取一张模板，装载期诊断档（D902/D904/D906–D910/
  // D914–D916/D918/D920）根本不会被这条判据检查——它们带占位时门禁仍绿，运行时
  // `errorText(entry)` 因无 params 回落 Rust message（M865 r1 P2-1 的现场）。
  const commandCodes = new Set(
    SITES.filter((s) => s.field !== true && s.event !== true && s.diag !== true && s.fileState !== true).map((s) => s.code),
  );
  const fieldCodes = new Set(SITES.filter((s) => s.field === true).map((s) => s.code));
  const eventCodes = new Set(SITES.filter((s) => s.event === true).map((s) => s.code));
  const diagnosticCodes = new Set(SITES.filter((s) => s.diag === true).map((s) => s.code));
  const fileCodes = new Set(SITES.filter((s) => s.fileState === true).map((s) => s.code));

  // ① 字段错误档：字面量 `field_error(...)` 构造点 ∪ `plan_and_apply` 动态转发的
  //    RejectOnWrite 诊断 code；取值面是 FIELD_ERROR_COPY（缺省回落 ERROR_COPY）。
  const fieldEntries: Record<string, CopyKey> = {};
  for (const code of new Set([...fieldCodes, ...REJECT_ON_WRITE_CODES])) {
    const key = FIELD_ERROR_COPY[code] ?? ERROR_COPY[code];
    if (key !== undefined) fieldEntries[code] = key;
  }
  // ② 装载期诊断档：诊断 code 一律读 ERROR_COPY（**包括**同 code 的字段错误档已有改道键
  //    的那 12 个——诊断侧不走 FIELD_ERROR_COPY）。
  const diagnosticEntries: Record<string, CopyKey> = {};
  for (const code of diagnosticCodes) {
    if (commandCodes.has(code)) continue; // 与 CommandError 共用的 code，模板归 params 通道判。
    const key = ERROR_COPY[code];
    if (key !== undefined) diagnosticEntries[code] = key;
  }
  // ③ 事件字面量档：事件没有 params，模板不带占位。
  const eventEntries: Record<string, CopyKey> = {};
  for (const code of eventCodes) {
    const key = ERROR_COPY[code];
    if (key !== undefined) eventEntries[code] = key;
  }
  // ④ 配置文件状态横幅档（M866）：`SettingsFileState::Invalid` 没有 params 通道，行号由 D850
  //    承担——模板同样 MUST NOT 带占位（带占位会被 errorText 的缺参兜底打回 Rust message）。
  const fileEntries: Record<string, CopyKey> = {};
  for (const code of fileCodes) {
    const key = ERROR_COPY[code];
    if (key !== undefined) fileEntries[code] = key;
  }

  assert.deepEqual(placeholderProblems(fieldEntries), [], `字段错误模板 MUST NOT 带占位`);
  assert.deepEqual(placeholderProblems(diagnosticEntries), [], `装载期诊断模板 MUST NOT 带占位`);
  assert.deepEqual(placeholderProblems(eventEntries), [], `事件字面量模板 MUST NOT 带占位`);
  assert.deepEqual(placeholderProblems(fileEntries), [], `配置文件状态横幅模板 MUST NOT 带占位`);

  // 反向判据：三类都真的查到了条目（不是「集合为空所以相等」）。双信封的装载期诊断档尤其要
  // 非空——这正是 r1 P2-1 指出的漏检面。
  assert.ok(Object.keys(fieldEntries).length >= 13, `字段错误档只查到 ${Object.keys(fieldEntries).length} 条`);
  assert.ok(Object.keys(diagnosticEntries).length >= 29, `诊断档只查到 ${Object.keys(diagnosticEntries).length} 条`);
  assert.ok(Object.keys(eventEntries).length >= 2, `事件档只查到 ${Object.keys(eventEntries).length} 条`);
  assert.ok(Object.keys(fileEntries).length >= 3, `配置文件状态档只查到 ${Object.keys(fileEntries).length} 条`);
  const dualEnvelope = [...diagnosticCodes].filter((code) => REJECT_ON_WRITE_CODES.has(code));
  assert.ok(dualEnvelope.length >= 12, `双信封诊断 code 只查到 ${dualEnvelope.length} 个`);
  for (const code of dualEnvelope) {
    assert.ok(code in diagnosticEntries, `${code} 的装载期诊断档没有被分列检查`);
  }

  // mutant 反向验证：给装载期档塞一条带占位的条目，判据必须如实报红。用真实带占位的模板
  // （D174 的 `{rel}`）而不是自造的假 COPY 条目——证明检查走的是与主线同一条取值路径。
  assert.deepEqual(
    placeholderProblems({ mutant_loading_diagnostic: "D174" }),
    ["mutant_loading_diagnostic → D174 的模板带占位 rel"],
    "装载期条目带占位时判据必须报红（否则本条是恒真的假绿）",
  );
});

/** CJK 统一表意文字（含扩展 A 与兼容区）：en 列出现任何一个都算漏译。 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

test("诊断 / 配置文件状态通道：设置面可达的 code 都有双语条目（en 列无中文、两列不是同一句）", () => {
  // 完整性门禁只判「有没有条目」；这条判**条目本身是不是真的两档文案**——把英文列抄成中文
  // 或反过来，覆盖计数照样满，但 en 界面仍然露中文。
  const diagnosticCodes = new Set(SITES.filter((s) => s.diag === true).map((s) => s.code));
  const fileCodes = new Set(SITES.filter((s) => s.fileState === true).map((s) => s.code));
  const surface = [...new Set([...diagnosticCodes, ...fileCodes])].filter(
    (c) => !LOG_ONLY_DIAGNOSTIC_CODES.has(c),
  );
  const problems: string[] = [];
  for (const code of surface) {
    const key = ERROR_COPY[code];
    if (key === undefined) continue; // 缺条目由完整性门禁判红。
    const entry = COPY[key];
    if (CJK.test(entry.en)) problems.push(`${code} → ${key} 的 English 列含中文`);
    if (entry.en === entry.zh) problems.push(`${code} → ${key} 两列同形（en 没有独立文案）`);
    if (!CJK.test(entry.zh)) problems.push(`${code} → ${key} 的中文列不含中文（zh 档写错了）`);
  }
  assert.deepEqual(problems, [], `这些诊断 / 配置文件状态条目不是双语两档`);
  // 反向判据：设置面可达的诊断 code 确实是两位数（不是扫空了导致上面恒真）。
  assert.ok(surface.length >= 32, `设置面诊断 / 配置文件状态 code 数量异常（${surface.length}）`);
});

test("完整性门禁：每处构造点都提供该 code 文案的全部占位名（缺一个即回落中文）", () => {  // 字段错误 / 事件字面量 / 诊断没有 params 通道（`{path, code, message}` / `{code, message}`），
  // 它们的「模板不带占位」由上一条判据盯，这里只看 `CommandError` 的 `.param(…)` 链。
  const commandSites = SITES.filter((s) => s.field !== true && s.event !== true && s.diag !== true && s.fileState !== true);
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
