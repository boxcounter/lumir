// 按路径快速打开的解析层单测（change quick-open-file-oct23 的 tasks 1.4 / 1.5）。
//
// 判据是 design §2.4 的那张表**逐行**：输入串 → 存在性候选阶梯。这一层是纯函数（零 DOM、
// 零 IPC），解析次序（整串优先 → 剥行号后缀 → 目录 → 找不到）本身就是合同的一部分，
// 所以断言落在**候选数组的逐项形状**上，而不是「最终打开了一个文件」这类端到端结果。
//
// 反向判据（REVIEW.md 「断言等价于子串」条）：每个「不成立」的行都同时断言「没有第二级候选」
// ——只看「有没有命中」会漏掉「半吞」形态（例如 `:40-12` 被拆成路径 + 行 40）。

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CANDIDATE_LIMIT,
  classifyVaultPath,
  lookupVaultPath,
  normalizeQuickOpenInput,
  quickOpenAttempts,
  resolveQuickOpen,
  resolveQuickOpenSync,
  splitLineSuffix,
} from "../../src/quick-open.ts";
import type { VaultLookupEnv } from "../../src/quick-open.ts";
import { filterIndices } from "../../src/list-filter.ts";

/** 测试用的 vault 根（design §2.4 的表就是按这个根写的）。 */
const ROOT = "/v";

function attemptsOf(raw: string, root: string | undefined = ROOT) {
  const plan = quickOpenAttempts(raw, root);
  assert.equal(plan.kind, "ok", `输入 ${raw} 应得到候选阶梯`);
  return plan.kind === "ok" ? plan : { kind: "ok" as const, attempts: [], query: "" };
}

// ---------------------------------------------------------------------------
// 归一化（design §2.3）
// ---------------------------------------------------------------------------

test("归一化：trim、反斜杠拒绝、空串、`..` 段、尾斜杠", () => {
  assert.deepEqual(normalizeQuickOpenInput("  notes/a.md \n", ROOT), {
    kind: "path",
    path: "notes/a.md",
    external: false,
  });
  assert.equal(normalizeQuickOpenInput("   ", ROOT).kind, "empty");
  assert.equal(normalizeQuickOpenInput("notes\\a.md", ROOT).kind, "invalid");
  assert.equal(normalizeQuickOpenInput("../etc/passwd", ROOT).kind, "invalid");
  assert.equal(normalizeQuickOpenInput("notes/../a.md", ROOT).kind, "invalid");
  assert.equal(normalizeQuickOpenInput("notes/", ROOT).kind, "invalid");
  assert.equal(normalizeQuickOpenInput("notes//a.md", ROOT).kind, "invalid");
});

test("归一化：vault 根前缀收敛（原样比 + 折叠比），根自身按目录/无效处置", () => {
  assert.deepEqual(normalizeQuickOpenInput("/v/notes/plan.md", ROOT), {
    kind: "path",
    path: "notes/plan.md",
    external: false,
  });
  // 大小写不同的根前缀仍收敛（macOS 默认大小写不敏感；不收敛会被误判成 vault 外只读）
  assert.deepEqual(normalizeQuickOpenInput("/V/Notes/Plan.md", ROOT), {
    kind: "path",
    path: "Notes/Plan.md",
    external: false,
  });
  // 根前缀必须落在 `/` 边界上：`/vault2/x` 不是 `/v` 之内
  assert.deepEqual(normalizeQuickOpenInput("/vault2/x.md", "/v"), {
    kind: "path",
    path: "/vault2/x.md",
    external: true,
  });
  assert.equal(normalizeQuickOpenInput("/v", ROOT).kind, "invalid");
  assert.equal(normalizeQuickOpenInput("/v/", ROOT).kind, "invalid");
});

test("归一化：`./` 前缀剥除；vault 外绝对路径不作分流（external = true）", () => {
  assert.deepEqual(normalizeQuickOpenInput("./notes/plan.md", ROOT), {
    kind: "path",
    path: "notes/plan.md",
    external: false,
  });
  assert.deepEqual(normalizeQuickOpenInput("/etc/hosts", ROOT), {
    kind: "path",
    path: "/etc/hosts",
    external: true,
  });
  // 未装载 vault（root undefined）时绝对路径一律按外部处理
  assert.deepEqual(normalizeQuickOpenInput("/etc/hosts", undefined), {
    kind: "path",
    path: "/etc/hosts",
    external: true,
  });
});

// ---------------------------------------------------------------------------
// 行号后缀（复用 harness-path-link 的 LINE_SUFFIX 语义）
// ---------------------------------------------------------------------------

test("行号后缀：三种合法形态与冒号文件名的区分", () => {
  assert.deepEqual(splitLineSuffix("notes/plan.md:12"), { path: "notes/plan.md", line: 12 });
  // `:行:列` 是**一个**后缀：从后一个冒号切会错判成路径 `notes/plan.md:12` + 行 3
  assert.deepEqual(splitLineSuffix("notes/plan.md:12:3"), { path: "notes/plan.md", line: 12 });
  // `:起-止` 落点取起（止只参与「后缀是否成立」）
  assert.deepEqual(splitLineSuffix("notes/plan.md:120-140"), { path: "notes/plan.md", line: 120 });
  // 文件名里的冒号：后面紧跟 `.` 是路径延续，整段不成立
  assert.deepEqual(splitLineSuffix("notes/v1:2.md"), { path: "notes/v1:2.md" });
});

test("行号后缀：畸形形态整段不成立（半吞是最难归因的失败形态）", () => {
  for (const raw of [
    "notes/plan.md:0",
    "notes/plan.md:12-",
    "notes/plan.md:40-12",
    "notes/plan.md:9-12-15",
    "notes/plan.md:12x",
    "notes/plan.md:12/5",
  ]) {
    assert.deepEqual(splitLineSuffix(raw), { path: raw }, raw);
  }
});

// ---------------------------------------------------------------------------
// design §2.4 的解析表（逐行断言）
// ---------------------------------------------------------------------------

test("候选阶梯：整串优先、剥后缀次之（vault 内）", () => {
  // 第一级恒是**整串**（文件名里允许冒号：真有一份叫 `plan.md:12` 的文件时先开它）
  assert.deepEqual(attemptsOf("notes/plan.md:12").attempts, [
    { path: "notes/plan.md:12", external: false },
    { path: "notes/plan.md", line: 12, external: false },
  ]);
  // 根前缀剥离后与相对路径逐字同形（往返：tree.ts 的 vaultAbsolutePath 拼、这里拆）
  assert.deepEqual(attemptsOf("/v/notes/plan.md:12").attempts, [
    { path: "notes/plan.md:12", external: false },
    { path: "notes/plan.md", line: 12, external: false },
  ]);
  assert.deepEqual(attemptsOf("./notes/plan.md").attempts, [
    { path: "notes/plan.md", external: false },
  ]);
  assert.deepEqual(attemptsOf("apps/api/package.json:71").attempts, [
    { path: "apps/api/package.json:71", external: false },
    { path: "apps/api/package.json", line: 71, external: false },
  ]);
  // 列不参与落点
  assert.deepEqual(attemptsOf("notes/plan.md:12:3").attempts[1], {
    path: "notes/plan.md",
    line: 12,
    external: false,
  });
  // 越界行号不在解析层改判（钳制归 revealLine 的既有口径）
  assert.deepEqual(attemptsOf("notes/plan.md:9999").attempts[1], {
    path: "notes/plan.md",
    line: 9999,
    external: false,
  });
});

test("候选阶梯：冒号文件名不被拆开（整串命中优先）", () => {
  assert.deepEqual(attemptsOf("notes/v1:2.md").attempts, [
    { path: "notes/v1:2.md", external: false },
  ]);
});

test("候选阶梯：畸形后缀 ⇒ 只有整串一级（找不到，MUST NOT 落任何行）", () => {
  for (const raw of ["notes/plan.md:12-", "notes/plan.md:40-12", "notes/plan.md:9-12-15", "notes/plan.md:0"]) {
    const plan = attemptsOf(raw);
    assert.deepEqual(plan.attempts, [{ path: raw, external: false }], raw);
    assert.ok(plan.attempts.every((attempt) => attempt.line === undefined), raw);
  }
});

test("候选阶梯：vault 外绝对路径走同一次序（带行号 / 畸形后缀两行）", () => {
  assert.deepEqual(attemptsOf("/etc/hosts").attempts, [{ path: "/etc/hosts", external: true }]);
  assert.deepEqual(attemptsOf("/etc/hosts:12").attempts, [
    { path: "/etc/hosts:12", external: true },
    { path: "/etc/hosts", line: 12, external: true },
  ]);
  // 外部路径的后缀畸形同样整段不成立（MUST NOT 吞半截）
  assert.deepEqual(attemptsOf("/tmp/x/notes.md:0").attempts, [
    { path: "/tmp/x/notes.md:0", external: true },
  ]);
  assert.deepEqual(attemptsOf("/tmp/x/notes.md:12-").attempts, [
    { path: "/tmp/x/notes.md:12-", external: true },
  ]);
});

test("候选阶梯：反斜杠 / `..` 一律不产生候选（也不产生第二级）", () => {
  for (const raw of ["notes\\a.md", "../outside/x.md", "notes/../a.md"]) {
    assert.deepEqual(attemptsOf(raw).attempts, [], raw);
  }
});

test("候选阶梯：空输入是 empty（不解析、不列候选）", () => {
  assert.equal(quickOpenAttempts("   ", ROOT).kind, "empty");
});

test("候选阶梯：查询串用剥掉合法后缀后的路径（候选按路径筛，不被 :行 打断）", () => {
  assert.equal(attemptsOf("notes/plan.md:12").query, "notes/plan.md");
  assert.equal(attemptsOf("notes/plan.md:0").query, "notes/plan.md:0");
  assert.equal(attemptsOf("/v/notes/plan.md").query, "notes/plan.md");
});

// ---------------------------------------------------------------------------
// 存在性裁决（索引 → 折叠等值 → 目录 → 批量探测）
// ---------------------------------------------------------------------------

interface FakeEnv {
  files?: string[];
  dirs?: string[];
  present?: string[];
  /** 探测失败（后端不可用 / 未注册命令）：`lookupVaultPath` 与 resolver 都按「不存在」处置。 */
  probeFails?: boolean;
}

function env(over: FakeEnv, probes: string[] = []): VaultLookupEnv {
  const files = over.files ?? [];
  const dirs = new Set(over.dirs ?? []);
  const present = new Set(over.present ?? []);
  return {
    files: () => files,
    isDir: (path) => dirs.has(path),
    probe: async (paths) => {
      probes.push(...paths);
      if (over.probeFails === true) throw new Error("probe unavailable");
      return paths.filter((path) => present.has(path));
    },
  };
}

test("存在性：逐字精确命中优先（哪怕折叠后还有别的等值项）", async () => {
  const e = env({ files: ["A.md", "a.md"] });
  assert.deepEqual(await lookupVaultPath("a.md", e), { kind: "hit", path: "a.md" });
});

test("存在性：无精确命中时折叠等值回退；唯一命中才打开，多命中列候选（不猜）", async () => {
  const unique = env({ files: ["notes/plan.md"] });
  assert.deepEqual(await lookupVaultPath("NOTES/PLAN.md", unique), {
    kind: "hit",
    path: "notes/plan.md",
  });
  const many = env({ files: ["A.md", "a.md"] });
  assert.deepEqual(await lookupVaultPath("A.MD", many), {
    kind: "ambiguous",
    paths: ["A.md", "a.md"],
  });
});

test("存在性：目录提示排在探测之前（探测对目录同样报存在，排在后面会把目录当文件开）", async () => {
  const e = env({ files: [], dirs: ["notes"], present: ["notes"] });
  assert.deepEqual(await lookupVaultPath("notes", e), { kind: "dir" });
});

test("存在性：索引不含的惰性文件经批量存在探测兜底", async () => {
  const e = env({ files: [], present: [".local/notes.md"] });
  assert.deepEqual(await lookupVaultPath(".local/notes.md", e), {
    kind: "hit",
    path: ".local/notes.md",
  });
  assert.deepEqual(await lookupVaultPath(".local/missing.md", e), { kind: "missing" });
});

// ---------------------------------------------------------------------------
// 候选列表（tasks 1.5：匹配对象是完整相对路径，复用 list-filter 的语义、不重测它）
// ---------------------------------------------------------------------------

test("候选过滤：匹配对象是完整相对路径（路径片段可命中，不只看文件名）", () => {
  const files = ["openspec/changes/x/spec.md", "notes/spec.md", "notes/other.md"];
  assert.deepEqual(filterIndices(files, "changes/x"), [0]);
  assert.deepEqual(filterIndices(files, "spec.md"), [0, 1]);
  // 索引顺序即结果顺序（不重排、不打分）
  assert.deepEqual(filterIndices(files, "notes/"), [1, 2]);
  assert.equal(CANDIDATE_LIMIT, 100);
});

// ---------------------------------------------------------------------------
// 判决（M700）：结果区与 Enter 共用同一份解析
//
// 这一层是「结果区不再自成一套判空判据」的机器判据：每条用例同时给出**同步判决**（结果区
// 先画的那一版）与**完整判决**（探测之后的最终版），两者的差异就是异步补帧的全部空间。
// ---------------------------------------------------------------------------

test("判决：索引精确命中 ⇒ 直接打开", () => {
  const e = env({ files: ["notes/plan.md"] });
  assert.deepEqual(resolveQuickOpenSync("notes/plan.md", ROOT, e).verdict, {
    kind: "open",
    path: "notes/plan.md",
    external: false,
  });
  // 归一化后的 vault 内绝对路径与相对路径同形
  assert.deepEqual(resolveQuickOpenSync("/v/notes/plan.md", ROOT, e).verdict, {
    kind: "open",
    path: "notes/plan.md",
    external: false,
  });
});

test("判决：整串优先——索引里真有 `plan.md:12` 时它赢，且一次探测都不发", async () => {
  const probes: string[] = [];
  const e = env({ files: ["notes/plan.md:12", "notes/plan.md"] }, probes);
  assert.deepEqual((await resolveQuickOpen("notes/plan.md:12", ROOT, e)).verdict, {
    kind: "open",
    path: "notes/plan.md:12",
    external: false,
  });
  assert.deepEqual(probes, []);
});

test("判决：同步层不越过待探测的一级（先探整串，整串不成立才落到剥后缀那一级）", async () => {
  const probes: string[] = [];
  const e = env({ files: ["notes/plan.md"] }, probes);
  assert.equal(resolveQuickOpenSync("notes/plan.md:12", ROOT, e).verdict.kind, "undecided");
  assert.deepEqual((await resolveQuickOpen("notes/plan.md:12", ROOT, e)).verdict, {
    kind: "open",
    path: "notes/plan.md",
    line: 12,
    external: false,
  });
  assert.deepEqual(probes, ["notes/plan.md:12"]);
});

test("判决：折叠等值唯一命中 ⇒ 直接打开索引里的那个路径；多命中 ⇒ 不猜", async () => {
  const unique = env({ files: ["notes/plan.md"] });
  assert.deepEqual((await resolveQuickOpen("NOTES/PLAN.md", ROOT, unique)).verdict, {
    kind: "open",
    path: "notes/plan.md",
    external: false,
  });
  const many = env({ files: ["A.md", "a.md"] });
  assert.deepEqual((await resolveQuickOpen("A.MD", ROOT, many)).verdict, {
    kind: "ambiguous",
    path: "A.MD",
    paths: ["A.md", "a.md"],
  });
});

test("判决：目录 ⇒ dir（不打开目录本身）；目录判定排在探测之前", async () => {
  const probes: string[] = [];
  const e = env({ dirs: ["notes"], present: ["notes"] }, probes);
  assert.deepEqual((await resolveQuickOpen("notes", ROOT, e)).verdict, {
    kind: "dir",
    path: "notes",
  });
  assert.deepEqual(probes, []);
});

test("判决：索引外的惰性文件经探测命中 ⇒ 直接打开（相对 / vault 内绝对两形）", async () => {
  const probes: string[] = [];
  const e = env({ files: [], present: [".local/notes.md"] }, probes);
  assert.equal(resolveQuickOpenSync(".local/notes.md", ROOT, e).verdict.kind, "undecided");
  assert.deepEqual((await resolveQuickOpen(".local/notes.md", ROOT, e)).verdict, {
    kind: "open",
    path: ".local/notes.md",
    external: false,
  });
  assert.deepEqual((await resolveQuickOpen("/v/.local/notes.md", ROOT, e)).verdict, {
    kind: "open",
    path: ".local/notes.md",
    external: false,
  });
  assert.deepEqual(probes, [".local/notes.md", ".local/notes.md"]);
});

test("判决：真负例 ⇒ missing（探测过后仍不成立）", async () => {
  const e = env({ files: ["notes/plan.md"] });
  assert.deepEqual((await resolveQuickOpen("notes/nope.md", ROOT, e)).verdict, {
    kind: "missing",
  });
});

test("判决：探测失败按不存在处置（与 lookupVaultPath 同一口径）", async () => {
  const e = env({ files: [], probeFails: true });
  assert.deepEqual((await resolveQuickOpen("notes/plan.md", ROOT, e)).verdict, {
    kind: "missing",
  });
  assert.deepEqual(await lookupVaultPath("notes/plan.md", e), { kind: "missing" });
});

test("判决：vault 外绝对路径是尝试入口，带行号时取剥后缀那一级", () => {
  const probes: string[] = [];
  const e = env({ files: ["notes/plan.md"] }, probes);
  assert.deepEqual(resolveQuickOpenSync("/tmp/x/draft.md", ROOT, e).verdict, {
    kind: "open",
    path: "/tmp/x/draft.md",
    external: true,
  });
  assert.deepEqual(resolveQuickOpenSync("/tmp/x/draft.md:12", ROOT, e).verdict, {
    kind: "open",
    path: "/tmp/x/draft.md",
    line: 12,
    external: true,
  });
  // 外部路径不 probe（`fs_paths_exist` 只接受 vault 相对路径）
  assert.deepEqual(probes, []);
});

test("判决：非法输入 / 空输入不产生任何候选级", () => {
  const e = env({ files: ["notes/plan.md"] });
  assert.deepEqual(resolveQuickOpenSync("notes\\a.md", ROOT, e).verdict, { kind: "invalid" });
  assert.deepEqual(resolveQuickOpenSync("../outside/x.md", ROOT, e).verdict, { kind: "invalid" });
  assert.deepEqual(resolveQuickOpenSync("  ", ROOT, e).verdict, { kind: "empty" });
});

test("判决：结果区与 confirm 共用同一个分类器（精确 / 折叠 / 多命中 / 目录 / 未知）", () => {
  const e = env({ files: ["A.md", "a.md", "notes/plan.md"], dirs: ["notes"] });
  assert.deepEqual(classifyVaultPath("a.md", e), { kind: "hit", path: "a.md" });
  assert.deepEqual(classifyVaultPath("NOTES/PLAN.md", e), {
    kind: "hit",
    path: "notes/plan.md",
  });
  assert.deepEqual(classifyVaultPath("A.MD", e), { kind: "ambiguous", paths: ["A.md", "a.md"] });
  assert.deepEqual(classifyVaultPath("notes", e), { kind: "dir" });
  assert.deepEqual(classifyVaultPath("nope.md", e), { kind: "unknown" });
});
