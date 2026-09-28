// UI 上屏文案盘点器（M267，change ui-language-i18n 的现状读数底稿）。
//
// 为什么零依赖手写扫描器而不是用 typescript 的 AST：本仓 worktree 不带 node_modules
// （依赖在检出树里），而这份读数要在任何检出边上可复跑；仓库的既有取向也是零新增依赖
// （tests/unit/run.mjs 的头部注释即该取向的明文）。扫描器只做一件事：把源码切成
// 「注释 / 字符串」两类片段，取字符串里含 CJK 的那些。它不追求完整解析 TS——判据是
// 给提案用的量级与分布，不是编译器。
//
// 跑法（在任意一层检出边，抄下它的输出）：
//   node openspec/changes/ui-language-i18n/evidence/count-ui-strings.mjs > openspec/changes/ui-language-i18n/evidence/ui-string-inventory.md
// 可选第一参数指定仓根（默认按脚本位置回推五层）。
//
// 口径与已知近似（写进 design 的读数说明，MUST NOT 当成精确值）：
//   - 单行 / 双引号 / 反引号串都算；模板串里的 `${…}` 单独标记为「动态」(dyn)。
//   - 只有整条串含 CJK 才计数；纯 ASCII 的可见文案（如 "END"、`Aa`、`×`、`↗︎`）不在此列。
//   - 只进 console / 诊断日志的串无法机械区分（同一条串既可能上屏也可能只进日志），
//     本器不猜：报告里按目录分布给出，人工在 design 里点名哪几条是日志专用。
//   - Rust 侧用同口径的朴素扫描（Rust 有 lifetime 与 raw string，措辞里的 「」 参与计数），
//     因此 Rust 行数偏保守——它的用途是量级，不是清单。

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(scriptDir, "../../../..");

/** 递归列出匹配后缀的文件，跳过给定目录名。 */
function walk(dir, suffix, skipNames) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipNames.has(entry.name)) continue;
      out.push(...walk(full, suffix, skipNames));
    } else if (entry.name.endsWith(suffix)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 把一段源码切成字符串字面量。
 * 状态机：注释 / 普通代码 / 单引号 / 双引号 / 模板串（含 `${}` 嵌套深度）。
 * 返回 { text, dynamic }。
 */
function collectStrings(source) {
  const found = [];
  const n = source.length;
  let i = 0;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      let buf = "";
      let dynamic = false;
      i++;
      while (i < n) {
        const c = source[i];
        if (c === "\\") {
          buf += source[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (c === quote) {
          i++;
          break;
        }
        if (quote === "`" && c === "$" && source[i + 1] === "{") {
          dynamic = true;
          let depth = 1;
          i += 2;
          while (i < n && depth > 0) {
            if (source[i] === "{") depth++;
            else if (source[i] === "}") depth--;
            else if (source[i] === "\\") i++;
            i++;
          }
          continue;
        }
        buf += c;
        i++;
      }
      found.push({ text: buf, dynamic });
      continue;
    }
    i++;
  }
  return found;
}

const rows = [];
let totalStrings = 0;
let totalCjk = 0;
let totalCjkDynamic = 0;
let totalZStrings = 0;

const tsFiles = walk(path.join(root, "src"), ".ts", new Set(["bindings", "node_modules"]));
for (const file of tsFiles) {
  const strings = collectStrings(readFileSync(file, "utf8"));
  totalStrings += strings.length;
  const cjk = strings.filter((s) => CJK.test(s.text));
  const dyn = cjk.filter((s) => s.dynamic);
  if (cjk.length === 0) continue;
  totalCjk += cjk.length;
  totalCjkDynamic += dyn.length;
  rows.push({
    file: path.relative(root, file),
    strings: strings.length,
    cjk: cjk.length,
    dyn: dyn.length,
  });
}

// src/style.css：`content:` 里的可见文本（唯一的候选是排版符，仍扫一遍）。
let cssCjk = 0;
try {
  const css = readFileSync(path.join(root, "src/style.css"), "utf8");
  const bodies = [...css.matchAll(/content:\s*(['"])(.*?)\1/gs)].map((m) => m[2]);
  cssCjk = bodies.filter((t) => CJK.test(t)).length;
} catch {
  /* 文件不在时跳过 */
}

// Rust 侧：朴素扫描可见的双引号串与 format! 串，按文件给出量级。
// 单测模块里的断言语料要排除——`#[cfg(test)]` 之后的内容按非产品代码处理（同族的
// `mod tests` 断言语料会把读数抬高一个量级，是本器的第一个假读数）。
const rustRows = [];
for (const file of walk(path.join(root, "src-tauri/src"), ".rs", new Set(["target", "gen"]))) {
  const source = readFileSync(file, "utf8").split("#[cfg(test)]")[0];
  const strings = collectStrings(source);
  const cjk = strings.filter((s) => CJK.test(s.text));
  if (cjk.length === 0) continue;
  rustRows.push({ file: path.relative(root, file), cjk: cjk.length });
}

rows.sort((a, b) => b.cjk - a.cjk);
rustRows.sort((a, b) => b.cjk - a.cjk);

const pad = (s, w) => String(s).padEnd(w);
console.log("# UI 上屏文案盘点（现状读数）");
console.log("");
console.log(`生成方式：\`node openspec/changes/ui-language-i18n/evidence/count-ui-strings.mjs\`（可复跑）。`);
console.log(`仓根：\`${root}\`。`);
console.log("");
console.log("口径与近似见脚本头部注释。以下数字是**量级读数**，不是逐条清单。");
console.log("");
console.log("## 前端（`src/**/*.ts`，已排除 `src/bindings/**` 生成物）");
console.log("");
console.log(`- 字符串字面量总数（含 ASCII）：**${totalStrings}**`);
console.log(`- 含 CJK 的串：**${totalCjk}**，分布在 **${rows.length}** 个文件`);
console.log(`- 其中含 \`${"${}"}\` 插值的（动态拼接）：**${totalCjkDynamic}**`);
console.log(`- \`src/style.css\` 的 \`content:\` 里含 CJK 的：**${cssCjk}**`);
console.log("");
console.log("| 文件 | 串总数 | 含 CJK | 其中动态 |");
console.log("|---|---|---|---|");
for (const r of rows) console.log(`| \`${r.file}\` | ${r.strings} | ${r.cjk} | ${r.dyn} |`);
console.log("");
console.log("## 后端（`src-tauri/src/**/*.rs`，经 `CommandError` / notice 上屏的部分）");
console.log("");
const rustTotal = rustRows.reduce((sum, r) => sum + r.cjk, 0);
console.log(`- 含 CJK 的串：**${rustTotal}**，分布在 **${rustRows.length}** 个文件`);
console.log("");
console.log("| 文件 | 含 CJK |");
console.log("|---|---|");
for (const r of rustRows) console.log(`| \`${r.file}\` | ${r.cjk} |`);
console.log("");
console.log("## 文案 deck 现状");
console.log("");
try {
  const deck = readFileSync(path.join(root, "文案-Copy.md"), "utf8");
  const deckRows = deck.split("\n").filter((l) => /^\| D\d+ \| /.test(l));
  const numbers = deckRows.map((l) => Number(l.split("|")[1].trim().slice(1)));
  const max = Math.max(...numbers);
  const bothSame = deckRows.filter((l) => {
    const cells = l.split("|").map((c) => c.trim());
    return cells[4] === cells[5];
  });
  console.log(`- 表行数（活跃编号）：**${deckRows.length}**`);
  console.log(`- 最大编号：**D${max}**（差额 ${max - deckRows.length} 为停用编号，deck 明文「不复用」）`);
  console.log(`- 两列同形（语言无关候选）：**${bothSame.length}** → ${bothSame.map((l) => l.split("|")[1].trim()).join("、")}`);
} catch {
  console.log("- 未找到 `文案-Copy.md`");
}
console.log("");
console.log("## 后端错误信封（`CommandError::new` + 中文 message，非测试代码）");
console.log("");
const envelope = /CommandError::new\(\s*"([a-z_]+)"\s*,\s*(?:format!\(\s*)?"((?:[^"\\]|\\.)*)"/g;
const perCode = new Map();
let envelopeSites = 0;
for (const file of walk(path.join(root, "src-tauri/src"), ".rs", new Set(["target", "gen"]))) {
  const source = readFileSync(file, "utf8").split("#[cfg(test)]")[0];
  for (const m of source.matchAll(envelope)) {
    if (!CJK.test(m[2])) continue;
    envelopeSites++;
    if (!perCode.has(m[1])) perCode.set(m[1], new Set());
    perCode.get(m[1]).add(m[2]);
  }
}
const templates = [...perCode.values()].reduce((sum, set) => sum + set.size, 0);
console.log(`- 构造点（带中文 message）：**${envelopeSites}**`);
console.log(`- 不同 code：**${perCode.size}**；不同 message 模板：**${templates}**`);
console.log(`- 单 code 多模板的 code（说明「按 code 映射」不足以直接出文案）：`);
for (const [code, set] of [...perCode].sort((a, b) => b[1].size - a[1].size)) {
  if (set.size > 1) console.log(`  - \`${code}\`：${set.size} 种`);
}
console.log("");
console.log("## 差异读数（本 change 要补的口子）");
console.log("");
console.log(`- 前端含 CJK 串 **${totalCjk}** 条（其中 ${totalCjkDynamic} 条含插值）。`);
console.log(`- 后端带中文 message 的信封构造点 **${envelopeSites}** 个（${perCode.size} 个 code / ${templates} 个模板）。`);
console.log("- 扣除口径（哪几条不进双语面）写在 [design.md](../design.md) §1.4，不在本器里机械猜测：");
console.log("  本器的输出是**上界**，不是最终覆盖清单。");
