// 命令元数据门禁（change improve-keybindings-lookup-oct24，design §2.1 / §7.1）。
//
// 判据是**机械的**：`COMMAND_META` 的键集必须与 `COMMAND_IDS` 逐项相等（无漏写、无幻影），
// 每条标签在文案表里、中英两列都非空、模板能完整渲染；别名只要求非空字符串——含空格的自然
// 短语（`select all` / `quick open`）是合法形态，MUST NOT 被拒绝。
//
// 搜索语料单独守：来由（`doc` / `docKey` 文本）不进语料，否则「M447」命中 24 条、
// 「已删除」误命中 `toc.toggle`（survey 的读数就是本 change 的 Why）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMAND_META, SCOPE_DESCRIPTION_KEYS, SCOPE_LABEL_KEYS } from "../../src/command-meta.ts";
import {
  COMMAND_IDS,
  KEY_BINDINGS,
  keyToken,
  scopeOfCommand,
} from "../../src/keys.ts";
import { COPY, interpolate } from "../../src/copy.ts";
import {
  buildCommandRows,
  captureCommandRows,
  commandSearchCorpus,
  filterCommandRows,
} from "../../src/bindings-panel.ts";

test("COMMAND_META：键集与 COMMAND_IDS 逐项相等（无漏写、无幻影）", () => {
  const metaKeys = Object.keys(COMMAND_META).sort();
  const commandIds = [...COMMAND_IDS].sort();
  assert.deepEqual(metaKeys, commandIds);
  assert.equal(metaKeys.length, COMMAND_IDS.length);
  for (const entry of Object.values(COMMAND_META)) {
    assert.ok(entry.labelKey in COPY, `标签键 ${entry.labelKey} 不在文案表里`);
  }
});

test("COMMAND_META：每条标签中英两列都非空，模板参数齐全", () => {
  for (const command of COMMAND_IDS) {
    const meta = COMMAND_META[command];
    const entry = COPY[meta.labelKey];
    assert.ok(entry !== undefined, `${command} 的标签 ${meta.labelKey} 缺失`);
    assert.ok(entry.zh.trim() !== "", `${command} 的中文标签为空`);
    assert.ok(entry.en.trim() !== "", `${command} 的英文标签为空`);
    const zh = interpolate(entry.zh, meta.labelKey, meta.labelParams);
    const en = interpolate(entry.en, meta.labelKey, meta.labelParams);
    assert.ok(!zh.includes("{"), `${command} 的中文标签有未插值占位：${zh}`);
    assert.ok(!en.includes("{"), `${command} 的英文标签有未插值占位：${en}`);
  }
});

test("COMMAND_META：别名非空，允许含空格的自然短语（MUST NOT 以空白为由拒绝）", () => {
  const aliases: string[] = [];
  for (const command of COMMAND_IDS) {
    for (const alias of COMMAND_META[command].aliases ?? []) {
      assert.equal(typeof alias, "string");
      assert.ok(alias.trim() !== "", `${command} 有空别名`);
      aliases.push(alias);
    }
  }
  assert.ok(aliases.includes("select all"), "select all 这类自然短语必须能进语料");
  assert.ok(aliases.includes("quick open"), "quick open 这类自然短语必须能进语料");
});

test("搜索语料：中英标签 / 别名 / 命令 id 都在，维护者来由不在", () => {
  const toc = commandSearchCorpus("toc.toggle");
  assert.ok(toc.includes(COPY[COMMAND_META["toc.toggle"].labelKey].zh));
  assert.ok(toc.includes(COPY[COMMAND_META["toc.toggle"].labelKey].en.toLowerCase()));
  assert.ok(toc.includes("outline"), "别名 outline 应在语料里");
  assert.ok(toc.includes("toc.toggle"), "命令 id 应在语料里");
  // survey 的两个反例：来由里的 mission 编号与「已删除」MUST NOT 进任何命令的语料。
  for (const command of COMMAND_IDS) {
    const corpus = commandSearchCorpus(command);
    assert.ok(!corpus.includes("M447"), `${command} 的语料混入了来由词 M447`);
    assert.ok(!corpus.includes("已删除"), `${command} 的语料混入了来由词「已删除」`);
  }
  // 反向：来由确实存在于表里（否则上面两条断言等于空转）。
  assert.ok(KEY_BINDINGS.some((binding) => /M447|已删除/.test(COPY[binding.docKey].zh)));
});

test("查询语义：子串 + 大小写折叠；来由零命中；标签/别名/id 都能定位", () => {
  const rows = buildCommandRows(KEY_BINDINGS);
  const commands = (query: string, scope: "all" | "editor" | "global" | "text" = "all"): string[] =>
    filterCommandRows(rows, query, scope).rows.map((row) => row.command);

  assert.deepEqual(commands("大纲"), ["toc.toggle"]);
  assert.deepEqual(commands("M447"), []);
  assert.deepEqual(commands("已删除"), []);
  const deleted = commands("删除");
  assert.ok(deleted.includes("editor.delete-char-forward"));
  assert.ok(!deleted.includes("toc.toggle"), "「删除」不得误命中来由里写了「已删除」的 toc.toggle");
  assert.deepEqual(commands("全屏").sort(), ["code-block.toggle-fullscreen", "table.toggle-fullscreen"]);
  assert.deepEqual(commands("select all"), ["editor.select-all"]);
  assert.deepEqual(commands("quick open"), ["app.quick-open"]);
  assert.deepEqual(commands("OUTLINE"), ["toc.toggle"], "大小写折叠");
});

test("计数分母 = 作用域筛选后的命令数（不是全量）", () => {
  const rows = buildCommandRows(KEY_BINDINGS);
  for (const scope of ["global", "editor", "text"] as const) {
    const scoped = rows.filter((row) => row.scope === scope);
    const filtered = filterCommandRows(rows, "滚动", scope);
    assert.equal(filtered.total, scoped.length, `${scope} 的分母应为筛选后命令数`);
    assert.ok(filtered.total < rows.length, "分母不得等于全量");
    assert.equal(filtered.matched, filtered.rows.length);
  }
  // 编辑器档 +「滚动」：四条 widget 滚动键 + 聚焦块滚动区 +「退出块滚动区」（真实标签，
  // 不是虚构条件；原型里的 1/5 是合成 fixture，生产表比它多一条 escape）。
  assert.equal(filterCommandRows(rows, "滚动", "editor").matched, 6);
  assert.equal(filterCommandRows(rows, "", "global").total, rows.filter((row) => row.scope === "global").length);
});

test("行聚合：一条命令一行、多键合并、未绑定行仍在、scope 出自 scopeOfCommand", () => {
  const rows = buildCommandRows(KEY_BINDINGS);
  assert.equal(rows.length, COMMAND_IDS.length);
  assert.deepEqual(
    [...rows.map((row) => row.command)].sort(),
    [...COMMAND_IDS].sort(),
    "每条命令恰一行（集合相等；行序 = 分组序，不是 COMMAND_IDS 的原始顺序）",
  );
  const undo = rows.find((row) => row.command === "editor.undo");
  assert.ok(undo !== undefined);
  assert.equal(undo.bindings.length, 3, "撤销的 ⌘Z / ⌃/ / ⌃_ 合并到一行");
  assert.deepEqual(
    undo.bindings.map((binding) => binding.key),
    ["Cmd-z", "Ctrl-/", "Ctrl-_"],
  );
  const wrap = rows.find((row) => row.command === "view.toggle-line-wrap");
  assert.ok(wrap !== undefined);
  assert.equal(wrap.bindings.length, 0, "默认不绑键的命令仍成行");
  for (const row of rows) {
    assert.equal(row.scope, scopeOfCommand(row.command), `${row.command} 的 scope 必须来自单一来源`);
  }
});

test("捕获：keyToken 归一化与表内 token 同源，Alt 组合按物理 code", () => {
  const rows = buildCommandRows(KEY_BINDINGS);
  const home = keyToken({ key: "Home", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false });
  assert.equal(home, "Home");
  assert.deepEqual(captureCommandRows(rows, home as string).map((row) => row.command), ["editor.widget-scroll-home"]);

  // macOS 的 Alt 层把 G 换成 ©：token 只能按 code 判定（表内写 Alt-KeyG）。
  const altG = keyToken({ key: "©", code: "KeyG", metaKey: false, ctrlKey: false, altKey: true, shiftKey: false });
  assert.equal(altG, "Alt-KeyG");
  assert.deepEqual(captureCommandRows(rows, altG as string).map((row) => row.command), ["editor.goto-line"]);

  const shiftTab = keyToken({ key: "Tab", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true });
  assert.equal(shiftTab, "Ctrl-Shift-Tab");
  assert.deepEqual(captureCommandRows(rows, shiftTab as string).map((row) => row.command), ["tab.prev"]);

  assert.deepEqual(captureCommandRows(rows, "F13"), [], "无绑定的 token 给空结果");
});

test("when 不变量：when ⇔ whenKey ⇔ whenShortKey，两个键都在文案表且短徽标非空", () => {
  for (const binding of KEY_BINDINGS) {
    const hasWhen = binding.when !== undefined;
    assert.equal(binding.whenKey !== undefined, hasWhen, `${binding.key} 的 whenKey 与 when 不同生同灭`);
    assert.equal(binding.whenShortKey !== undefined, hasWhen, `${binding.key} 的 whenShortKey 与 when 不同生同灭`);
    if (!hasWhen) continue;
    assert.ok((binding.whenKey as string) in COPY, `${binding.key} 的 whenKey 不在文案表`);
    assert.ok((binding.whenShortKey as string) in COPY, `${binding.key} 的 whenShortKey 不在文案表`);
    assert.ok(COPY[binding.whenShortKey as keyof typeof COPY].zh.trim() !== "");
    assert.ok(COPY[binding.whenShortKey as keyof typeof COPY].en.trim() !== "");
  }
  // 默认表里带 when 的只有三条 widget 键（Home / End / Escape）——count 是判据的一部分，
  // 防止「全都补上 when」稀释。←/→ 自 M795 起改绑水平移动命令（容器焦点分支在命令实现里
  // 分派，见 src/keys.ts 的 KEY_BINDINGS 与 KEYLESS_COMMAND_IDS）。
  assert.equal(KEY_BINDINGS.filter((binding) => binding.when !== undefined).length, 3);
});

test("作用域文案：三档都有上屏名与一句解释", () => {
  for (const scope of ["global", "editor", "text"] as const) {
    assert.ok(SCOPE_LABEL_KEYS[scope] in COPY);
    assert.ok(SCOPE_DESCRIPTION_KEYS[scope] in COPY);
    assert.ok(COPY[SCOPE_LABEL_KEYS[scope]].zh.trim() !== "");
    assert.ok(COPY[SCOPE_DESCRIPTION_KEYS[scope]].en.trim() !== "");
  }
});
