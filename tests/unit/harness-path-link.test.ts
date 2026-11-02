// harness-path-link 的纯函数单测（change harness-path-link 的 1.x / 3.2 / 3.4）。
//
// 判据形状的两条纪律（REVIEW.md『断言等价于子串』条）：
//   - 每条正向断言都配一条**必须让它静默空转不成立**的对照（存在性谓词返回 false、前缀/后缀
//     不合形状、越界行号等），保证判据有输入；
//   - 不以「文本里出现某串」当判据：候选的 from/to 与 path/line 都逐字段断言。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import {
  MAX_CANDIDATE_RUN,
  findPathCandidates,
  isWellFormedVaultPath,
  openPathAtLine,
  parseToolArgs,
  splitToolText,
  toolPathTargets,
} from "../../src/harness-path-link.ts";
import type { PathJumpPlan, PathTargetIndex } from "../../src/harness-path-link.ts";
import {
  LINE_HIGHLIGHT_CLASS,
  MAX_HIGHLIGHT_LINES,
  lineHighlightField,
  setLineHighlight,
} from "../../src/navigation-highlight.ts";

function fileIndex(...paths: string[]): PathTargetIndex {
  const set = new Set(paths);
  return { isFile: (path) => set.has(path), isDir: () => false };
}

/** 目录模型索引（change harness-dir-link）。 */
function dirIndex(...paths: string[]): PathTargetIndex {
  const set = new Set(paths);
  return { isFile: () => false, isDir: (path) => set.has(path) };
}

/** 两类都认（结构性拒绝的对照：形状不合法时谓词恒 true 也不产候选）。 */
const anyTarget: PathTargetIndex = { isFile: () => true, isDir: () => true };

// ---------------------------------------------------------------------------
// 候选：中文、行号、边界收缩
// ---------------------------------------------------------------------------

test("命中文件索引的路径产出候选，展示文本逐字不变", () => {
  const text = "见 notes/a.md 结束";
  const found = findPathCandidates(text, fileIndex("notes/a.md"));
  assert.equal(found.length, 1);
  assert.equal(found[0].path, "notes/a.md");
  assert.equal(found[0].kind, "file");
  assert.equal(found[0].line, undefined);
  assert.equal(found[0].text, "notes/a.md");
  assert.equal(text.slice(found[0].from, found[0].to), "notes/a.md");
});

test("存在性校验是唯一判据：谓词不命中 → 不产候选（反向对照）", () => {
  assert.deepEqual(findPathCandidates("见 notes/a.md 结束", fileIndex()), []);
});

test("中文行文里的对照式斜杠不产候选（扫描里 105 次噪音的形态）", () => {
  const noise = "先把甲方案/乙方案这条过一遍";
  assert.deepEqual(findPathCandidates(noise, fileIndex()), [], "存在性校验是唯一判据");
  // 反证：字符规则确实会把这个 run 当候选交出（候选宽），可点与否完全由索引判定——
  // 谓词若恰好命中同名条目，它才成为链接（design §2.3 的已接受取舍）。
  const wide = findPathCandidates(noise, fileIndex("甲方案/乙方案"));
  assert.equal(wide.length, 1);
  assert.equal(wide[0].path, "甲方案/乙方案");
});

test("紧贴中文的路径两端收缩后命中（见路径 / 路径的）", () => {
  const prefix = "详见notes/a.md";
  const prefixHit = findPathCandidates(prefix, fileIndex("notes/a.md"));
  assert.equal(prefixHit.length, 1);
  assert.equal(prefixHit[0].path, "notes/a.md");
  assert.equal(prefixHit[0].text, "notes/a.md", "可点范围不含行文里的「详见」");
  assert.equal(prefixHit[0].from, 2);

  const suffix = "notes/a.md的内容";
  const suffixHit = findPathCandidates(suffix, fileIndex("notes/a.md"));
  assert.equal(suffixHit.length, 1);
  assert.equal(suffixHit[0].path, "notes/a.md");
  assert.equal(suffixHit[0].to, "notes/a.md".length, "可点范围不含行文里的「的内容」");
});

test("文件本身含中文时整串优先命中，不被两端收缩剥坏", () => {
  const text = "见中文/笔记.md的内容";
  const found = findPathCandidates(text, fileIndex("中文/笔记.md"));
  assert.equal(found.length, 1);
  assert.equal(found[0].path, "中文/笔记.md");
  assert.equal(found[0].text, "中文/笔记.md");
});

test("行号后缀属于可点范围，path 不含后缀", () => {
  const text = "见notes/a.md:12。";
  const found = findPathCandidates(text, fileIndex("notes/a.md"));
  assert.equal(found.length, 1);
  assert.equal(found[0].path, "notes/a.md");
  assert.equal(found[0].line, 12);
  assert.equal(found[0].lineEnd, 12, "单行形态的高亮范围就是该行");
  assert.equal(found[0].column, undefined);
  assert.equal(found[0].text, "notes/a.md:12");
});

test("行:列后缀解析列但不参与 path / 行", () => {
  const found = findPathCandidates("notes/a.md:12:5 完", fileIndex("notes/a.md"));
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 12);
  assert.equal(found[0].lineEnd, 12, "列号不收窄行高亮范围（整行）");
  assert.equal(found[0].column, 5);
  assert.equal(found[0].path, "notes/a.md");
});

test("畸形后缀不吞下一步文本（:0 / :12x / :12:）", () => {
  const zero = findPathCandidates("a.md:0", fileIndex("a.md"));
  assert.equal(zero.length, 1);
  assert.equal(zero[0].line, undefined);
  assert.equal(zero[0].text, "a.md", "行号 0 不合法，后缀不进入可点范围");

  const glued = findPathCandidates("a.md:12x", fileIndex("a.md"));
  assert.equal(glued.length, 1);
  assert.equal(glued[0].line, undefined, "后缀后紧跟 ASCII 路径字符 ⇒ 不是行号引用");

  const trailingColon = findPathCandidates("a.md:12:", fileIndex("a.md"));
  assert.equal(trailingColon.length, 1);
  assert.equal(trailingColon[0].line, 12, "尾随冒号不影响已闭合的 :12 后缀");
});

test("行号后紧跟中文是行文边界，不是路径延续（见a.md:12的内容）", () => {
  const found = findPathCandidates("见a.md:12的内容", fileIndex("a.md"));
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 12);
  assert.equal(found[0].text, "a.md:12", "可点范围含行号、不含行文里的「见 / 的内容」");
});

// ---------------------------------------------------------------------------
// 行范围后缀 `:起-止`（change add-path-line-range-links）
//
// 判据形状：每种畸形形态都**必须**产出「路径本身」这一条候选（存在性命中），再断言它不带
// 行落点且可点范围不含后缀——只看「line === undefined」会在解析器整条失效时同样成立。
// ---------------------------------------------------------------------------

test("行范围后缀属于可点范围：落点取起始行，止只进高亮范围", () => {
  const text = "见notes/plan.md:120-140的内容";
  const found = findPathCandidates(text, fileIndex("notes/plan.md"));
  assert.equal(found.length, 1);
  assert.equal(found[0].path, "notes/plan.md");
  assert.equal(found[0].kind, "file");
  assert.equal(found[0].line, 120, "落点取起始行");
  assert.equal(found[0].lineEnd, 140, "闭区间止行是行高亮的范围上界（含两端）");
  assert.equal(found[0].column, undefined, "行范围不产列号");
  assert.equal(found[0].text, "notes/plan.md:120-140", "可点范围覆盖整个后缀，展示文本不重写");
  assert.equal(text.slice(found[0].from, found[0].to), "notes/plan.md:120-140");
  assert.equal(found[0].from, 1, "行文里的「见」不进可点范围");
});

test("行范围边界：起 = 止 与中文紧贴 / 句号收尾都命中", () => {
  const single = findPathCandidates("notes/plan.md:1-1", fileIndex("notes/plan.md"));
  assert.equal(single[0].line, 1, "起 = 止 是合法范围");
  assert.equal(single[0].lineEnd, 1);
  assert.equal(single[0].text, "notes/plan.md:1-1");

  const glued = findPathCandidates("见a.md:12-40的", fileIndex("a.md"));
  assert.equal(glued[0].line, 12);
  assert.equal(glued[0].lineEnd, 40);
  assert.equal(glued[0].text, "a.md:12-40", "中文是行文边界，不是路径延续");

  const punctuation = findPathCandidates("看a.md:3-9。", fileIndex("a.md"));
  assert.equal(punctuation[0].line, 3);
  assert.equal(punctuation[0].lineEnd, 9);
  assert.equal(punctuation[0].text, "a.md:3-9");
});

test("畸形行范围整段不成立：可点范围止于路径本身、不产行落点", () => {
  const cases: Array<[string, string]> = [
    ["notes/plan.md:12-", "缺止段"],
    ["notes/plan.md:-9", "缺起段"],
    ["notes/plan.md:9-12-15", "三段"],
    ["notes/plan.md:40-12", "止 < 起（MUST NOT 反向钳成合法范围）"],
    ["notes/plan.md:5-0", "止 为 0"],
  ];
  for (const [text, why] of cases) {
    const found = findPathCandidates(text, fileIndex("notes/plan.md"));
    assert.equal(found.length, 1, `${text}：路径本身仍可点`);
    assert.equal(found[0].path, "notes/plan.md", text);
    assert.equal(found[0].line, undefined, `${text}：${why} ⇒ 不产行落点`);
    assert.equal(found[0].lineEnd, undefined, `${text}：${why} ⇒ 不产高亮范围`);
    assert.equal(found[0].text, "notes/plan.md", `${text}：${why} ⇒ 后缀不进可点范围`);
  }
});

test("行范围后缀后紧跟 ASCII 路径字符 ⇒ 整段不成立（沿用既有守卫）", () => {
  for (const text of ["a.md:12-40x", "a.md:12-40/5", "a.md:12-40_"]) {
    const found = findPathCandidates(text, fileIndex("a.md"));
    assert.equal(found.length, 1, text);
    assert.equal(found[0].line, undefined, `${text}：路径还在继续，不是行范围引用`);
    assert.equal(found[0].lineEnd, undefined, text);
    assert.equal(found[0].text, "a.md", text);
  }
});

test("`-` 两侧含空白时按既有 :行号 口径只吞到第一个数字", () => {
  const found = findPathCandidates("notes/plan.md:12 - 40", fileIndex("notes/plan.md"));
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 12, "空白是候选边界");
  assert.equal(found[0].lineEnd, 12, "半截后缀只形成单行高亮");
  assert.equal(found[0].text, "notes/plan.md:12", "` - 40` 留作普通文本");
});

test("三种后缀形态并存时各吞各的（行范围不改变 :行号 / :行号:列号 的读数）", () => {
  const found = findPathCandidates(
    "见a.md:12 与 notes/b.md:3:4 以及 notes/c.md:5-9 完",
    fileIndex("a.md", "notes/b.md", "notes/c.md"),
  );
  assert.deepEqual(
    found.map((c) => ({ path: c.path, line: c.line, lineEnd: c.lineEnd, column: c.column, text: c.text })),
    [
      { path: "a.md", line: 12, lineEnd: 12, column: undefined, text: "a.md:12" },
      { path: "notes/b.md", line: 3, lineEnd: 3, column: 4, text: "notes/b.md:3:4" },
      { path: "notes/c.md", line: 5, lineEnd: 9, column: undefined, text: "notes/c.md:5-9" },
    ],
  );
});

test("组合后缀不叠加：`起-止:列` 只认到行范围，尾随冒号段留作文本", () => {
  const found = findPathCandidates("a.md:12-40:5", fileIndex("a.md"));
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 12);
  assert.equal(found[0].lineEnd, 40);
  assert.equal(found[0].column, undefined, "行范围不产列号（后缀形态互斥）");
  assert.equal(found[0].text, "a.md:12-40", "`:5` 不在可点范围（与 `:12:3:5` 的既有口径同一条）");
});

test("候选声明「止」字段：行范围多出的读数有明确消费者（行高亮范围）", () => {
  const found = findPathCandidates("a.md:12-40", fileIndex("a.md"));
  assert.deepEqual(Object.keys(found[0]).sort(), [
    "column",
    "from",
    "kind",
    "line",
    "lineEnd",
    "path",
    "text",
    "to",
  ]);
  assert.equal(found[0].lineEnd, 40);
});

test("绝对路径、.. 穿越、空段在结构层被拒绝（谓词恒 true 也不产候选）", () => {
  for (const bad of ["/tmp/a.md", "../a.md", "a/../b.md", "a//b.md", "./a.md", "a/b//"]) {
    assert.deepEqual(
      findPathCandidates(`看 ${bad} 完`, anyTarget),
      [],
      `必须结构性拒绝：${bad}`,
    );
  }
});

test("尾斜杠是目录意图：文件索引命中也不链接化，目录索引命中才链接化", () => {
  // `a.md/` 在文件索引里（形状上不带斜杠）——尾斜杠表示目录，MUST NOT 当成文件引用。
  assert.deepEqual(findPathCandidates("看 a.md/ 完", fileIndex("a.md")), []);
  const found = findPathCandidates("看 a.md/ 完", dirIndex("a.md"));
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "dir");
  assert.equal(found[0].path, "a.md");
  assert.equal(found[0].text, "a.md/", "展示文本逐字保留尾斜杠");
});

test("同一段里多个路径按出现序产出，标点与空格都是边界", () => {
  const found = findPathCandidates("见a.md，再看notes/b.md:3 完", fileIndex("a.md", "notes/b.md"));
  assert.deepEqual(
    found.map((c) => ({ path: c.path, line: c.line, text: c.text })),
    [
      { path: "a.md", line: undefined, text: "a.md" },
      { path: "notes/b.md", line: 3, text: "notes/b.md:3" },
    ],
  );
});

test("含空格的文件名不识别（候选规则本身不跨空格）", () => {
  const text = "见my notes/a.md 完";
  // 谓词只认带空格的完整文件名 ⇒ 字符规则切不出它，必须零候选（不许把尾部当路径）。
  assert.deepEqual(findPathCandidates(text, fileIndex("my notes/a.md")), []);
});

test("超过 run 长度上限的无断句串不识别（已知边界）", () => {
  const long = `${"甲".repeat(MAX_CANDIDATE_RUN)}/a.md`;
  assert.ok(long.length > MAX_CANDIDATE_RUN);
  assert.deepEqual(findPathCandidates(long, anyTarget), []);
});

test("路径形状校验的边界", () => {
  for (const ok of ["a.md", "notes/a.md", "a-b_c/d.txt", "中文/笔记.md"]) {
    assert.equal(isWellFormedVaultPath(ok), true, ok);
  }
  for (const bad of ["", "/a.md", "~/a.md", "../a.md", "a/../b", "a//b", "a/", "./a.md", "a\\b.md"]) {
    assert.equal(isWellFormedVaultPath(bad), false, bad);
  }
});

// ---------------------------------------------------------------------------
// 目录候选（change harness-dir-link）：文件未命中再查目录模型
// ---------------------------------------------------------------------------

test("目录命中：kind 为 dir，路径与可点范围逐字段正确", () => {
  const text = "整理 projects/plans 下的材料";
  const found = findPathCandidates(text, dirIndex("projects/plans"));
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "dir");
  assert.equal(found[0].path, "projects/plans");
  assert.equal(found[0].line, undefined);
  assert.equal(found[0].text, "projects/plans");
  assert.equal(text.slice(found[0].from, found[0].to), "projects/plans");
});

test("中文行文紧贴目录名：两端收缩后命中目录（与文件同一条边界规则）", () => {
  const found = findPathCandidates("详见中文目录/笔记 里的内容", dirIndex("中文目录/笔记"));
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "dir");
  assert.equal(found[0].path, "中文目录/笔记");
  assert.equal(found[0].text, "中文目录/笔记");
});

test("目录索引里没有的路径不产候选（深层惰性 / 内置忽略名的形态）", () => {
  assert.deepEqual(findPathCandidates("见 projects/plans 完", dirIndex("projects/other")), []);
  assert.deepEqual(findPathCandidates("见 node_modules/pkg 完", dirIndex()), []);
});

test("目录引用不消费行号后缀（与文件成对对照）", () => {
  const dir = findPathCandidates("见 projects/plans:12 完", dirIndex("projects/plans"));
  assert.equal(dir.length, 1);
  assert.equal(dir[0].kind, "dir");
  assert.equal(dir[0].line, undefined, "目录没有行上下文");
  assert.equal(dir[0].text, "projects/plans", "可点范围止于路径本身");

  // 行范围同口径：`:12-40` 也整段留在正文里，目录候选不带任何行读数。
  const rangeDir = findPathCandidates("见 projects/plans:12-40 完", dirIndex("projects/plans"));
  assert.equal(rangeDir.length, 1);
  assert.equal(rangeDir[0].kind, "dir");
  assert.equal(rangeDir[0].line, undefined);
  assert.equal(rangeDir[0].text, "projects/plans");

  const file = findPathCandidates("见 notes/a.md:12 完", fileIndex("notes/a.md"));
  assert.equal(file[0].line, 12);
  assert.equal(file[0].text, "notes/a.md:12");
});

test("同一路径同时命中两份索引时文件优先（解析顺序可判）", () => {
  const both: PathTargetIndex = { isFile: () => true, isDir: () => true };
  const found = findPathCandidates("见 notes/a.md 完", both);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "file");
});

test("目录候选同样过结构校验：../、绝对路径不因目录索引命中而放行", () => {
  for (const bad of ["../secrets", "/etc", "a/../b", "a//b", "~/x"]) {
    assert.deepEqual(findPathCandidates(`见 ${bad} 完`, dirIndex(bad)), [], bad);
  }
});

// ---------------------------------------------------------------------------
// 工具卡片：结构化参数
// ---------------------------------------------------------------------------

test("Read 的 offset 作落点行；缺省 / 非法 offset 不带行", () => {
  const withOffset = toolPathTargets("vault_read", parseToolArgs('{"path":"a.md","offset":12}'));
  assert.deepEqual(withOffset, [{ path: "a.md", line: 12 }]);
  const noOffset = toolPathTargets("vault_read", parseToolArgs('{"path":"a.md"}'));
  assert.deepEqual(noOffset, [{ path: "a.md", line: undefined }]);
  const badOffset = toolPathTargets("vault_read", parseToolArgs('{"path":"a.md","offset":0}'));
  assert.deepEqual(badOffset, [{ path: "a.md", line: undefined }]);
});

test("写类工具取 path；Move 取源与目标两段；vault_list / 其它不产目标", () => {
  assert.deepEqual(toolPathTargets("vault_create", parseToolArgs('{"path":"a.md"}')), [
    { path: "a.md" },
  ]);
  assert.deepEqual(toolPathTargets("vault_patch", parseToolArgs('{"path":"a.md"}')), [
    { path: "a.md" },
  ]);
  assert.deepEqual(toolPathTargets("vault_delete", parseToolArgs('{"path":"a.md"}')), [
    { path: "a.md" },
  ]);
  assert.deepEqual(
    toolPathTargets("vault_move", parseToolArgs('{"path":"a.md","new_path":"b.md"}')),
    [{ path: "a.md" }, { path: "b.md" }],
  );
  assert.deepEqual(toolPathTargets("vault_list", parseToolArgs('{"path":"/"}')), []);
  assert.deepEqual(toolPathTargets("cli_run", parseToolArgs('{"command":"ls"}')), []);
});

test("截断 / 非 JSON 的摘要解析不出参数（卡片文本照旧、不可点）", () => {
  assert.equal(parseToolArgs('{"path":"a.md","old_string":"x'), null);
  assert.equal(parseToolArgs("命令回显完了"), null);
  assert.deepEqual(toolPathTargets("vault_read", parseToolArgs('{"path":"a.md"')), []);
});

test("工具参数里的越界路径不产目标（结构化 ≠ 可信）", () => {
  assert.deepEqual(toolPathTargets("vault_read", { path: "../a.md" }), []);
  assert.deepEqual(toolPathTargets("vault_patch", { path: "/etc/passwd" }), []);
});

// ---------------------------------------------------------------------------
// 跳转编排：窗口语义（CL-2）与补发纪律
// ---------------------------------------------------------------------------

interface Trace {
  plan: PathJumpPlan;
  events: string[];
  windows: number;
}

function makePlan(options: {
  opened?: boolean;
  needsRescroll?: boolean;
}): Trace {
  const events: string[] = [];
  let windowOpen = false;
  let windows = 0;
  const trace: Trace = { events, windows: 0, plan: null as unknown as PathJumpPlan };
  trace.plan = {
    open: async (path) => {
      events.push(`open:${path}`);
      return options.opened ?? true;
    },
    reveal: (line) => {
      events.push(`reveal:${line}:inWindow=${windowOpen}`);
    },
    duringTransition: (run) => {
      windows += 1;
      trace.windows = windows;
      windowOpen = true;
      events.push("window:begin");
      try {
        run();
      } finally {
        windowOpen = false;
        events.push("window:end");
      }
    },
    nextFrame: (run) => {
      events.push("frame");
      run();
    },
    needsRescroll: () => options.needsRescroll ?? false,
    highlight: (from, to) => {
      events.push(`highlight:${from}-${to}:inWindow=${windowOpen}`);
    },
  };
  return trace;
}

test("打开 → 窗口内 reveal → 下一帧复核；补发单独开窗", async () => {
  const trace = makePlan({ needsRescroll: true });
  await openPathAtLine(trace.plan, "notes/a.md", 12);
  assert.deepEqual(trace.events, [
    "open:notes/a.md",
    "window:begin",
    "reveal:12:inWindow=true",
    "window:end",
    "frame",
    "window:begin",
    "reveal:12:inWindow=true",
    "window:end",
  ]);
  assert.equal(trace.windows, 2, "两轮 reveal 各自开窗，不共用首轮的窗");
});

test("不需要补发时只 reveal 一次", async () => {
  const trace = makePlan({ needsRescroll: false });
  await openPathAtLine(trace.plan, "notes/a.md", 12);
  assert.deepEqual(trace.events, [
    "open:notes/a.md",
    "window:begin",
    "reveal:12:inWindow=true",
    "window:end",
    "frame",
  ]);
});

test("无行号不碰视口；打开失败不 reveal", async () => {
  const noLine = makePlan({});
  await openPathAtLine(noLine.plan, "notes/a.md");
  assert.deepEqual(noLine.events, ["open:notes/a.md"]);

  const failed = makePlan({ opened: false });
  await openPathAtLine(failed.plan, "notes/a.md", 12);
  assert.deepEqual(failed.events, ["open:notes/a.md"]);
});

test("行范围点击：落点取起行，高亮在首轮窗口内施加一次且复核不重设", async () => {
  // 从解析到编排端到端驱动：候选给什么，编排就拿到什么。
  const candidate = findPathCandidates("见notes/a.md:12-40 完", fileIndex("notes/a.md"))[0];
  assert.equal(candidate.line, 12, "落点 = 起");
  assert.equal(candidate.lineEnd, 40, "高亮范围 = 闭区间止行");

  const trace = makePlan({ needsRescroll: true });
  await openPathAtLine(trace.plan, candidate.path, candidate.line, candidate.lineEnd);
  assert.deepEqual(trace.events, [
    "open:notes/a.md",
    "window:begin",
    "reveal:12:inWindow=true",
    "highlight:12-40:inWindow=true",
    "window:end",
    "frame",
    "window:begin",
    "reveal:12:inWindow=true",
    "window:end",
  ]);
  // 高亮只在首轮出现：下一帧的复核补发只重发 reveal（重设高亮会重置消退计时）。
  assert.equal(
    trace.events.filter((event) => event.startsWith("highlight:")).length,
    1,
    "复核补发 MUST NOT 重设高亮",
  );
  // 编排面只多出 highlight 一个入口；reveal 仍只收到一个行号。
  assert.deepEqual(Object.keys(trace.plan).sort(), [
    "duringTransition",
    "highlight",
    "needsRescroll",
    "nextFrame",
    "open",
    "reveal",
  ]);
});

test("不带 lineEnd 的入口（快速打开 / 外部打开 / 工具卡片）零高亮调用", async () => {
  const candidate = findPathCandidates("见notes/a.md:12 完", fileIndex("notes/a.md"))[0];
  // 候选本身带单行高亮范围；但调用方不把它交给编排层时（quick-open 只传 line），
  // 编排 MUST NOT 自行补一个默认范围——高亮只由显式 lineEnd 触发。
  const trace = makePlan({ needsRescroll: false });
  await openPathAtLine(trace.plan, candidate.path, candidate.line);
  assert.deepEqual(trace.events, [
    "open:notes/a.md",
    "window:begin",
    "reveal:12:inWindow=true",
    "window:end",
    "frame",
  ]);
  assert.equal(
    trace.events.some((event) => event.startsWith("highlight:")),
    false,
    "没有 lineEnd ⇒ 不产生高亮",
  );
});

// ---------------------------------------------------------------------------
// 工具行展示文本的切分（结构化目标 → 可点段）
// ---------------------------------------------------------------------------

test("Move 的源 / 目标各自成段，箭头与空格逐字保留", () => {
  const text = "a.md → b.md";
  const segments = splitToolText(text, toolPathTargets("vault_move", { path: "a.md", new_path: "b.md" }));
  assert.deepEqual(
    segments.map((segment) => ({ text: segment.text, target: segment.target?.path })),
    [
      { text: "a.md", target: "a.md" },
      { text: " → ", target: undefined },
      { text: "b.md", target: "b.md" },
    ],
  );
  assert.equal(
    segments.map((segment) => segment.text).join(""),
    text,
    "切分 MUST NOT 改写展示文本",
  );
});

test("同一路径出现两次（源 = 目标）时按目标序各切一次", () => {
  const segments = splitToolText("a.md → a.md", [{ path: "a.md" }, { path: "a.md" }]);
  assert.deepEqual(
    segments.map((segment) => ({ text: segment.text, isTarget: segment.target !== undefined })),
    [
      { text: "a.md", isTarget: true },
      { text: " → ", isTarget: false },
      { text: "a.md", isTarget: true },
    ],
  );
});

test("无目标（截断摘要 / cli_run）→ 整段普通文本", () => {
  const text = "cli_run echo hello";
  assert.deepEqual(splitToolText(text, []), [{ text }]);
});

test("目标在展示文本里找不到时按普通文本留下（不吞文本）", () => {
  assert.deepEqual(splitToolText("raw summary", [{ path: "a.md" }]), [{ text: "raw summary" }]);
});

// ---------------------------------------------------------------------------
// 导航行高亮的装饰与生命周期（change add-path-line-target-highlight-nov02）
//
// 这一层在 node 里直接驱动 `EditorState`：装饰集是 state 的纯函数，不需要 DOM / EditorView。
// 编辑器门面里的计时器与切标签清除（真实 `view.dispatch`）由
// tests/visual/scenes/m632-path-line-range-link.spec.ts 在真 CM view 上断言。
// ---------------------------------------------------------------------------

/** 文档文本：`第 1 行` … `第 N 行`（每行独立，便于按行号核对）。 */
function lineDoc(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `第 ${index + 1} 行`).join("\n");
}

/** 装饰集 → 行号列表（按 range 起点取所在行）。 */
function highlightedLines(state: EditorState): number[] {
  const out: number[] = [];
  state.field(lineHighlightField).between(0, state.doc.length, (from) => {
    out.push(state.doc.lineAt(from).number);
  });
  return out;
}

function stateWithHighlight(): EditorState {
  return EditorState.create({ doc: lineDoc(60), extensions: [lineHighlightField] });
}

test("单行与闭区间：装饰覆盖整段行、位置在行首、类名唯一", () => {
  let state = stateWithHighlight();
  state = state.update({ effects: setLineHighlight.of({ from: 3, to: 3 }) }).state;
  assert.deepEqual(highlightedLines(state), [3], "单行形态只高亮该行");

  state = state.update({ effects: setLineHighlight.of({ from: 12, to: 40 }) }).state;
  const lines = highlightedLines(state);
  assert.equal(lines.length, 29, "闭区间 12…40 含两端共 29 行");
  assert.equal(lines[0], 12);
  assert.equal(lines[lines.length - 1], 40);
  assert.equal(lines.includes(11), false, "起行之前不高亮");
  assert.equal(lines.includes(41), false, "止行之后不高亮");

  const starts: Array<{ line: number; atLineStart: boolean; cls: unknown }> = [];
  state.field(lineHighlightField).between(0, state.doc.length, (from, _to, value) => {
    const line = state.doc.lineAt(from).number;
    starts.push({
      line,
      atLineStart: from === state.doc.line(line).from,
      cls: value.spec.class,
    });
  });
  assert.equal(starts.length, 29);
  assert.equal(
    starts.every((entry) => entry.atLineStart),
    true,
    "Decoration.line 必须落在行首",
  );
  assert.equal(
    starts.every((entry) => entry.cls === LINE_HIGHLIGHT_CLASS),
    true,
  );
});

test("越界钳到文档边界（起 / 止两侧都钳）", () => {
  let state = stateWithHighlight();
  state = state.update({ effects: setLineHighlight.of({ from: 900, to: 1200 }) }).state;
  assert.deepEqual(highlightedLines(state), [60], "起止都越界 ⇒ 只剩末行");

  state = state.update({ effects: setLineHighlight.of({ from: 0, to: -5 }) }).state;
  assert.deepEqual(highlightedLines(state), [1], "非正行号 ⇒ 首行");
});

test("行数上限的正反两例：恰好上限画满、超过上限一行不画", () => {
  const atLimit = EditorState.create({
    doc: lineDoc(MAX_HIGHLIGHT_LINES + 5),
    extensions: [lineHighlightField],
  }).update({ effects: setLineHighlight.of({ from: 1, to: MAX_HIGHLIGHT_LINES }) }).state;
  assert.equal(highlightedLines(atLimit).length, MAX_HIGHLIGHT_LINES);

  const overLimit = EditorState.create({
    doc: lineDoc(MAX_HIGHLIGHT_LINES + 5),
    extensions: [lineHighlightField],
  }).update({ effects: setLineHighlight.of({ from: 1, to: MAX_HIGHLIGHT_LINES + 1 }) }).state;
  assert.deepEqual(highlightedLines(overLimit), [], "超上限 MUST NOT 截断成只画前一段");
});

test("长范围性能护栏：上限内的构建耗时留在单帧预算内", () => {
  const base = EditorState.create({
    doc: lineDoc(MAX_HIGHLIGHT_LINES + 5),
    extensions: [lineHighlightField],
  });
  const started = performance.now();
  base.update({ effects: setLineHighlight.of({ from: 1, to: MAX_HIGHLIGHT_LINES }) });
  const elapsed = performance.now() - started;
  // 本机中位 0.27ms（design §2.2）；上限放到 100ms 只为吸收 CI 负载抖动，仍能拦住
  // 「上限失效 ⇒ 装饰数随行数线性膨胀」的数量级回归。
  assert.ok(elapsed < 100, `2000 行行装饰构建耗时 ${elapsed.toFixed(2)}ms，超出护栏`);
});

test("重复设置整块替换（不叠加），null 清除", () => {
  let state = stateWithHighlight();
  state = state.update({ effects: setLineHighlight.of({ from: 12, to: 40 }) }).state;
  state = state.update({ effects: setLineHighlight.of({ from: 5, to: 6 }) }).state;
  assert.deepEqual(highlightedLines(state), [5, 6], "第二次设置整块替换第一次");

  state = state.update({ effects: setLineHighlight.of(null) }).state;
  assert.deepEqual(highlightedLines(state), [], "null 清除全部装饰");
});

test("效果只加装饰：不改正文、不改选区、docChanged 为假（不进撤销栈 / 不碰 dirty）", () => {
  const before = stateWithHighlight();
  const tr = before.update({ effects: setLineHighlight.of({ from: 2, to: 4 }) });
  assert.equal(tr.docChanged, false, "只有 effects ⇒ 无文档变更（撤销栈与 dirty 的判据都不动）");
  assert.equal(tr.state.doc.toString(), before.doc.toString(), "正文逐字节不变");
  assert.equal(tr.state.selection.main.head, before.selection.main.head, "选区不变");
});

test("文档一变更即清除高亮（行装饰不能落在行中，清掉比漂移诚实）", () => {
  let state = stateWithHighlight();
  state = state.update({ effects: setLineHighlight.of({ from: 12, to: 14 }) }).state;
  assert.deepEqual(highlightedLines(state), [12, 13, 14]);

  state = state.update({ changes: { from: 0, insert: "新增首行\n" } }).state;
  assert.deepEqual(highlightedLines(state), [], "编辑后高亮立即清除");
  assert.equal(state.doc.lines, 61, "文档本身仍按编辑变化（清除高亮不影响正文）");
});
