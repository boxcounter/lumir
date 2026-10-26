// scripts/acceptance/lib/evidence.test.mjs —— 证据索引（summary.md / results.json）的自测
//（node:test，零新增依赖；只写 os.tmpdir()，不碰验收 vault / 用户的 ~/.config/lumir / .local/）。
//
// 为什么需要它（M745）：summary.md 头部长期用 `status !== "PASS"` 当 FAIL 计数，把 INVALID
// 「本次运行无效」（基建错误，README「退出码」三档）并进 FAIL——M743 全量跑的头部写「FAIL 31」，
// 同一目录的 results.json 实为 FAIL 24 / INVALID 7，三处口径里只有头部这一处合并（finding
// `.tower/comms/findings/20261025-worker-archive-model-settings-improve-summary-md-invalid-fail-results-json-readme.md`）。
// 只读头部的人（含写 tasks 记录的 agent）会拿到与 JSON 不一致的 FAIL 数，而这类数字会进归档
// 记录与批次报告。三态判据因此要有区分度：拿一份「2 PASS / 1 FAIL / 1 INVALID」的输入，
// 头部必须写 FAIL 1（旧口径在这份输入上写 FAIL 2，本文件的第二条用例正是它）。
//
// 跑法（与 execute / app 自测同例，经 scripts/acceptance/check-suite.sh 接入 quick 与 docs CI）：
//   node --test scripts/acceptance/lib/evidence.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeSummary } from "./evidence.mjs";

/** 临时根（每个用例一份，`os.tmpdir()` 下，跑完不清也无妨）。 */
function tmpRoot() {
  return mkdtemp(path.join(os.tmpdir(), "lumir-acceptance-evidence-"));
}

/** 与 `run.mjs` 交给 `writeSummary` 的行同形（字段少一个都不行：头部与表格都读它）。 */
function row(id, status, { at = "2026-10-25T10:00:00.000Z" } = {}) {
  return { id, title: `场景 ${id}`, status, asserts: 3, failed: status === "PASS" ? 0 : 1, seconds: 1.5, at };
}

/** 头部那一行（「本次 run …；索引累计 …」）：断言只对准它。**恰好一行**才返回——行数不对时
 *  返回 `undefined` 会让 `assert.equal(undefined, undefined)` 空转成「通过」（REVIEW.md
 *  「读不到当成空」条同族），故这里直接抛。 */
async function headerLine(root) {
  const md = await readFile(path.join(root, "summary.md"), "utf8");
  const lines = md.split("\n").filter((l) => l.startsWith("本次 run "));
  if (lines.length !== 1) throw new Error(`summary.md 头部应有恰好一行「本次 run …」，实际 ${lines.length} 行：${JSON.stringify(lines)}`);
  return lines[0];
}

test("summary 头部三态分列：INVALID 不并进 FAIL", async () => {
  const root = await tmpRoot();
  await writeSummary(root, [row("a", "PASS"), row("b", "PASS"), row("c", "FAIL"), row("d", "INVALID")]);
  const line = await headerLine(root);
  assert.equal(line, "本次 run 4 个场景（PASS 2、FAIL 1、INVALID 1）；索引累计 4 个场景：PASS 2、FAIL 1、INVALID 1。");
  // 旧口径（`status !== "PASS"` 当 FAIL）在这份输入上写「FAIL 2」——判据对三态有区分度，
  // 而不是换了个措辞的等价改写（REVIEW.md「断言等价于子串」条）。
  assert.doesNotMatch(line, /FAIL 2/);
});

test("INVALID 为 0 时头部不写 INVALID（既有小样本 run 的头部逐字不变）", async () => {
  const root = await tmpRoot();
  await writeSummary(root, [row("a", "PASS"), row("b", "PASS")]);
  assert.equal(await headerLine(root), "本次 run 2 个场景（PASS 2、FAIL 0）；索引累计 2 个场景：PASS 2、FAIL 0。");
});

test("跨 run 合并后的累计计数同样三态（上一轮 INVALID 不被本次 run 洗成 FAIL）", async () => {
  const root = await tmpRoot();
  // 上一次 run 留在同一目录的索引：一条 INVALID（M743 的 189/190/191/206 就长这样）。
  await writeFile(path.join(root, "results.json"), `${JSON.stringify([row("old-invalid", "INVALID", { at: "2026-10-24T09:00:00.000Z" })], null, 2)}\n`);
  await writeSummary(root, [row("new-pass", "PASS"), row("new-fail", "FAIL")]);
  assert.equal(
    await headerLine(root),
    "本次 run 2 个场景（PASS 1、FAIL 1）；索引累计 3 个场景：PASS 1、FAIL 1、INVALID 1。",
  );
  // 行本身的状态不被改判（INVALID 仍是 INVALID，表格与 JSON 逐条一致）。
  const merged = JSON.parse(await readFile(path.join(root, "results.json"), "utf8"));
  assert.deepEqual(
    merged.map((r) => [r.id, r.status]),
    [
      ["old-invalid", "INVALID"],
      ["new-pass", "PASS"],
      ["new-fail", "FAIL"],
    ],
  );
});

test("phases 随最新场景行保留，旧结果缺字段仍可合并", async () => {
  const root = await tmpRoot();
  await writeFile(path.join(root, "results.json"), `${JSON.stringify([row("a", "PASS")], null, 2)}\n`);
  const phases = { reset: 10, stop: 20, launch: 30, ready: 40, scenario: 50 };
  await writeSummary(root, [{ ...row("a", "FAIL"), phases }, row("b", "PASS")]);
  const merged = JSON.parse(await readFile(path.join(root, "results.json"), "utf8"));
  assert.deepEqual(merged.find((r) => r.id === "a").phases, phases);
  assert.equal(merged.find((r) => r.id === "b").phases, undefined);
  assert.equal(await headerLine(root), "本次 run 2 个场景（PASS 1、FAIL 1）；索引累计 2 个场景：PASS 1、FAIL 1。");
});
