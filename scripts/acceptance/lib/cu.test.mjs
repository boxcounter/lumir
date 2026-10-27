// scripts/acceptance/lib/cu.test.mjs —— CuClient 发到 MCP stdio 上的请求帧自测（M751）
//（node:test，零新增依赖；只写 os.tmpdir()，不碰 KimiCU、不碰验收 vault / 用户的 ~/.config/lumir / .local/）。
//
// 为什么需要它（M751）：KimiCU 新版把 `get_app_state` 的缺省行为改成「返回与上一次快照的增量
// diff」——套件只给 pid/mode 时，第二次读取拿到的是空 diff，而空 diff 与「这个 app 真的没有
// 节点」在 markdown 文本上无法区分：`settle`（连续两次快照逐字节一致）会在第二次就「一致」、
// `waitFor` 轮询与 `ax.has` / `ax.not` 断言对着空树判红/假绿。`CuClient.state` 因此无条件带
// `disable_diff: true`，本文件钉住三件事：
//   ① 每次 `state` 发出的 `tools/call` arguments 里都有 `disable_diff: true`（含第二次、第三次）；
//   ② 既有参数（pid / mode / window_id / ax_filter）的字段集与条件写入形态逐字未变；
//   ③ `get_app_state` 仍只有 `CuClient.state` 一个发出点——新开调用点会绕过这条口径。
//
// 判据读的是**实际写到 stdio 上的帧**：假 MCP server（本文件在 os.tmpdir() 里现写）把收到的
// `params.name` / `params.arguments` 原样回显成 text，断言对着回显做 `deepEqual`——字段缺失、
// 多写、改名都会红（不是「看着更强、其实等价于子串」的断言，REVIEW.md「断言等价于子串」条）。
//
// 跑法（与 execute / app / evidence 自测同例，经 scripts/acceptance/check-suite.sh 接入 quick 与 docs CI）：
//   node --test scripts/acceptance/lib/cu.test.mjs
import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CuClient } from "./cu.mjs";

/** 假 MCP server：只实现 initialize / notifications/initialized / tools/call。
 *  tools/call 的 `{ name, arguments }` 原样回显成 text，测试据此断言线上帧。 */
const FAKE_SERVER = `#!/usr/bin/env node
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id === undefined) return; // 通知（notifications/initialized）不回应答
  const result =
    msg.method === "initialize"
      ? { protocolVersion: "2024-11-05", capabilities: {} }
      : {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, tool: msg.params.name, arguments: msg.params.arguments }),
            },
          ],
        };
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
});
`;

/** 起一个假 server 的 CuClient；用例结束（含断言失败）都会 kill 掉子进程。 */
async function startedClient(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lumir-acceptance-cu-"));
  const bin = path.join(dir, "fake-kimicu-mcp.mjs");
  await writeFile(bin, FAKE_SERVER, "utf8");
  await chmod(bin, 0o755);
  const client = await CuClient.start({ bin });
  t.after(() => client.stop());
  return client;
}

/** 一次 `state` 实际发出的 tools/call arguments。回显对不上时直接报错，不让 `undefined`
 *  参与后续比较（`assert.deepEqual(undefined, undefined)` 会空转成「通过」，REVIEW.md
 *  「读不到当成空」条同族）。 */
function sentArguments(res) {
  assert.equal(res.json?.ok, true, `假 server 应回 ok:true，实际 text：${String(res.text).slice(0, 300)}`);
  assert.equal(res.json.tool, "get_app_state", `应发 get_app_state，实际 ${res.json.tool}`);
  assert.ok(res.json.arguments && typeof res.json.arguments === "object", "帧里没有 arguments 对象");
  return res.json.arguments;
}

test("state：缺省级调用也带 disable_diff:true，且字段集与既有形态一致", async (t) => {
  const cu = await startedClient(t);
  // 逐字段面（不是子串）：多写、少写、改名都会让 deepEqual 红。
  assert.deepEqual(sentArguments(await cu.state(4321)), { pid: 4321, mode: "full", disable_diff: true });
});

test("state：window_id / ax_filter 的既有条件写入不变（给才写，不给不写）", async (t) => {
  const cu = await startedClient(t);
  assert.deepEqual(sentArguments(await cu.state(7, { mode: "ax" })), { pid: 7, mode: "ax", disable_diff: true });
  assert.deepEqual(sentArguments(await cu.state(7, { mode: "image", windowId: 3 })), {
    pid: 7,
    mode: "image",
    disable_diff: true,
    window_id: 3,
  });
  assert.deepEqual(sentArguments(await cu.state(7, { axFilter: "AXButton" })), {
    pid: 7,
    mode: "full",
    disable_diff: true,
    ax_filter: "AXButton",
  });
  assert.deepEqual(sentArguments(await cu.state(7, { windowId: 3, axFilter: "AXButton" })), {
    pid: 7,
    mode: "full",
    disable_diff: true,
    window_id: 3,
    ax_filter: "AXButton",
  });
});

test("state：连续多次读取（含第二次）每一次都取全树，不落到增量 diff", async (t) => {
  const cu = await startedClient(t);
  const frames = [];
  for (let i = 0; i < 3; i += 1) frames.push(sentArguments(await cu.state(9001)));
  assert.equal(frames.length, 3);
  frames.forEach((args, i) => {
    assert.equal(args.disable_diff, true, `第 ${i + 1} 次 state 丢了 disable_diff：${JSON.stringify(args)}`);
  });
  // 「第一次带、之后省略」是这条口径最可能的退化形态——末次按整字段面钉住。
  assert.deepEqual(frames[2], { pid: 9001, mode: "full", disable_diff: true });
});

test("get_app_state 只有 CuClient.state 一个发出点（新开调用点会绕过 disable_diff 口径）", async () => {
  const libDir = path.dirname(fileURLToPath(import.meta.url));
  const scriptsDir = path.dirname(libDir);
  const sources = [
    ...(await readdir(libDir)).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")).map((f) => path.join(libDir, f)),
    ...(await readdir(scriptsDir)).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")).map((f) => path.join(scriptsDir, f)),
  ];
  const hits = [];
  for (const file of sources) {
    // 只认**双引号字面量**：注释里以反引号提及 get_app_state 的地方不算发出点。
    const count = (await readFile(file, "utf8")).split('"get_app_state"').length - 1;
    if (count > 0) hits.push([path.relative(libDir, file), count]);
  }
  assert.deepEqual(hits, [["cu.mjs", 1]]);
});
