// runner 侧 IME 客户端 + case 校验的机器测试（零依赖，node:test）。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IME_CASES, validateImeCommand } from "../driver/ime-cases.mjs";
import { waitReady, sendCommand, waitReport, writeImeReport } from "./ime-driver.mjs";

const withEnv = async (fn) => {
  const oldPort = process.env.LUMIR_ACCEPTANCE_PORT;
  const oldResults = process.env.LUMIR_ACCEPTANCE_RESULTS;
  const dir = await mkdtemp(path.join(os.tmpdir(), "lumir-ime-test-"));
  process.env.LUMIR_ACCEPTANCE_PORT = "54321";
  process.env.LUMIR_ACCEPTANCE_RESULTS = path.join(dir, "results");
  try {
    return await fn(dir);
  } finally {
    if (oldPort === undefined) delete process.env.LUMIR_ACCEPTANCE_PORT;
    else process.env.LUMIR_ACCEPTANCE_PORT = oldPort;
    if (oldResults === undefined) delete process.env.LUMIR_ACCEPTANCE_RESULTS;
    else process.env.LUMIR_ACCEPTANCE_RESULTS = oldResults;
    await rm(dir, { recursive: true, force: true });
  }
};

const fakeFetch = (handler) => {
  const old = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = old;
  };
};

test("imeDrive case 数据与命令校验", () => {
  assert.deepEqual(Object.keys(IME_CASES).sort(), ["commit", "compose", "delete-empty"]);
  const base = { id: "x", runTag: "t", case: "commit", line: 2, text: "s", commit: "是", timeoutMs: 1000 };
  assert.equal(validateImeCommand(base), null);
  assert.match(validateImeCommand({ ...base, case: "bogus" }), /case/);
  assert.match(validateImeCommand({ ...base, line: 0 }), /line/);
  assert.match(validateImeCommand({ ...base, text: "" }), /text/);
  assert.match(validateImeCommand({ ...base, extra: 1 }), /未知键/);
});

test("waitReady / sendCommand / waitReport 走同一端点", async () => {
  await withEnv(async () => {
    const calls = [];
    const restore = fakeFetch(async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: init.body });
      if (String(url).endsWith("/ready")) return { ok: true, json: async () => ({ ready: true }) };
      if (String(url).endsWith("/command")) return { ok: true, status: 202, json: async () => ({}) };
      if (String(url).includes("/report?id=abc")) return { ok: true, json: async () => ({ id: "abc", case: "compose" }) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    try {
      await waitReady(1000);
      await sendCommand({ id: "abc" });
      assert.deepEqual(await waitReport("abc", 1000), { id: "abc", case: "compose" });
      assert.ok(calls.some((c) => c.method === "POST" && c.url.endsWith("/command")));
    } finally {
      restore();
    }
  });
});

test("waitReady / waitReport 超时抛 InfraError", async () => {
  await withEnv(async () => {
    const restore = fakeFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    try {
      await assert.rejects(() => waitReady(80), /IME 驱动未就绪/);
      await assert.rejects(() => waitReport("missing", 80), /等待报告超时/);
    } finally {
      restore();
    }
  });
});

test("writeImeReport 落到隔离 env 的 acceptance/ime/<case>.jsonl", async () => {
  await withEnv(async (dir) => {
    const file = await writeImeReport("compose", { case: "compose", run_tag: "t" });
    assert.equal(file, path.join(dir, "env", "lumir", "acceptance", "ime", "compose.jsonl"));
    assert.equal(await readFile(file, "utf8"), `${JSON.stringify({ case: "compose", run_tag: "t" })}\n`);
  });
});
