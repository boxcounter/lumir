// harness-path-link 的纯函数单测（change harness-path-link 的 1.x / 3.2 / 3.4）。
//
// 判据形状的两条纪律（REVIEW.md『断言等价于子串』条）：
//   - 每条正向断言都配一条**必须让它静默空转不成立**的对照（存在性谓词返回 false、前缀/后缀
//     不合形状、越界行号等），保证判据有输入；
//   - 不以「文本里出现某串」当判据：候选的 from/to 与 path/line 都逐字段断言。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CANDIDATE_RUN,
  findPathCandidates,
  isWellFormedVaultPath,
  openPathAtLine,
  parseToolArgs,
  splitToolText,
  toolPathTargets,
} from "../../src/harness-path-link.ts";
import type { PathJumpPlan } from "../../src/harness-path-link.ts";

function indexOf(...paths: string[]): (path: string) => boolean {
  const set = new Set(paths);
  return (path) => set.has(path);
}

// ---------------------------------------------------------------------------
// 候选：中文、行号、边界收缩
// ---------------------------------------------------------------------------

test("命中文件索引的路径产出候选，展示文本逐字不变", () => {
  const text = "见 notes/a.md 结束";
  const found = findPathCandidates(text, indexOf("notes/a.md"));
  assert.equal(found.length, 1);
  assert.equal(found[0].path, "notes/a.md");
  assert.equal(found[0].line, undefined);
  assert.equal(found[0].text, "notes/a.md");
  assert.equal(text.slice(found[0].from, found[0].to), "notes/a.md");
});

test("存在性校验是唯一判据：谓词不命中 → 不产候选（反向对照）", () => {
  assert.deepEqual(findPathCandidates("见 notes/a.md 结束", indexOf()), []);
});

test("中文行文里的对照式斜杠不产候选（扫描里 105 次噪音的形态）", () => {
  const noise = "先把甲方案/乙方案这条过一遍";
  assert.deepEqual(findPathCandidates(noise, () => false), [], "存在性校验是唯一判据");
  // 反证：字符规则确实会把这个 run 当候选交出（候选宽），可点与否完全由索引判定——
  // 谓词若恰好命中同名条目，它才成为链接（design §2.3 的已接受取舍）。
  const wide = findPathCandidates(noise, (path) => path === "甲方案/乙方案");
  assert.equal(wide.length, 1);
  assert.equal(wide[0].path, "甲方案/乙方案");
});

test("紧贴中文的路径两端收缩后命中（见路径 / 路径的）", () => {
  const prefix = "详见notes/a.md";
  const prefixHit = findPathCandidates(prefix, indexOf("notes/a.md"));
  assert.equal(prefixHit.length, 1);
  assert.equal(prefixHit[0].path, "notes/a.md");
  assert.equal(prefixHit[0].text, "notes/a.md", "可点范围不含行文里的「详见」");
  assert.equal(prefixHit[0].from, 2);

  const suffix = "notes/a.md的内容";
  const suffixHit = findPathCandidates(suffix, indexOf("notes/a.md"));
  assert.equal(suffixHit.length, 1);
  assert.equal(suffixHit[0].path, "notes/a.md");
  assert.equal(suffixHit[0].to, "notes/a.md".length, "可点范围不含行文里的「的内容」");
});

test("文件本身含中文时整串优先命中，不被两端收缩剥坏", () => {
  const text = "见中文/笔记.md的内容";
  const found = findPathCandidates(text, indexOf("中文/笔记.md"));
  assert.equal(found.length, 1);
  assert.equal(found[0].path, "中文/笔记.md");
  assert.equal(found[0].text, "中文/笔记.md");
});

test("行号后缀属于可点范围，path 不含后缀", () => {
  const text = "见notes/a.md:12。";
  const found = findPathCandidates(text, indexOf("notes/a.md"));
  assert.equal(found.length, 1);
  assert.equal(found[0].path, "notes/a.md");
  assert.equal(found[0].line, 12);
  assert.equal(found[0].column, undefined);
  assert.equal(found[0].text, "notes/a.md:12");
});

test("行:列后缀解析列但不参与 path / 行", () => {
  const found = findPathCandidates("notes/a.md:12:5 完", indexOf("notes/a.md"));
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 12);
  assert.equal(found[0].column, 5);
  assert.equal(found[0].path, "notes/a.md");
});

test("畸形后缀不吞下一步文本（:0 / :12x / :12:）", () => {
  const zero = findPathCandidates("a.md:0", indexOf("a.md"));
  assert.equal(zero.length, 1);
  assert.equal(zero[0].line, undefined);
  assert.equal(zero[0].text, "a.md", "行号 0 不合法，后缀不进入可点范围");

  const glued = findPathCandidates("a.md:12x", indexOf("a.md"));
  assert.equal(glued.length, 1);
  assert.equal(glued[0].line, undefined, "后缀后紧跟路径字符 ⇒ 不是行号引用");

  const trailingColon = findPathCandidates("a.md:12:", indexOf("a.md"));
  assert.equal(trailingColon.length, 1);
  assert.equal(trailingColon[0].line, 12, "尾随冒号不影响已闭合的 :12 后缀");
});

test("绝对路径、.. 穿越、空段在结构层被拒绝（谓词恒 true 也不产候选）", () => {
  for (const bad of ["/tmp/a.md", "../a.md", "a/../b.md", "a//b.md", "./a.md", "a.md/"]) {
    assert.deepEqual(
      findPathCandidates(`看 ${bad} 完`, () => true),
      [],
      `必须结构性拒绝：${bad}`,
    );
  }
});

test("同一段里多个路径按出现序产出，标点与空格都是边界", () => {
  const found = findPathCandidates("见a.md，再看notes/b.md:3 完", indexOf("a.md", "notes/b.md"));
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
  assert.deepEqual(findPathCandidates(text, indexOf("my notes/a.md")), []);
});

test("超过 run 长度上限的无断句串不识别（已知边界）", () => {
  const long = `${"甲".repeat(MAX_CANDIDATE_RUN)}/a.md`;
  assert.ok(long.length > MAX_CANDIDATE_RUN);
  assert.deepEqual(findPathCandidates(long, () => true), []);
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
