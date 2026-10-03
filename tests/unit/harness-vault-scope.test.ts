// 会话作用域（M312）：`harness:event` 的事件信封与 `harness_state` 快照都带 vault 标识
//（= 后端 sessions 映射的键），面板只渲染**当前 vault** 的会话——切走之后才到达的旧 vault
// 事件 / 快照一律丢弃。
//
// 这一层钉住那条准入判据的输入形态（纯函数）；接线（handleEvent / restoreSnapshot /
// applyVault 的调用点）由真机场景 `scripts/acceptance/scenarios/78-harness-vault-scope.md`
// 判——那条场景在本修复之前是红的（B 面板里留着 A 的对话、A 在途回答落进 B）。
//
// 为什么不在这里驱动面板本体：harness-panel 的其余部分要 DOM（tests/unit 是零 DOM 环境，
// 见 tests/unit/README.md 的「不在这一层」）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { inCurrentVault } from "../../src/harness-panel.ts";
import { parseHarnessEvent } from "../../src/ipc.ts";

test("会话作用域准入：本 vault 放行、其它 vault 丢弃、缺标识放行", () => {
  // 本 vault：放行
  assert.equal(inCurrentVault("/v/a", "/v/a"), true);
  // 另一个 vault（切走之后才到达的在途事件 / 迟到的快照）：丢弃
  assert.equal(inCurrentVault("/v/b", "/v/a"), false);
  // 缺标识（纯浏览器桩 / 早期载荷形态）：按「归属未知」放行——宽容解析与 harness_state
  // 「缺键 = 空态」同一条纪律
  assert.equal(inCurrentVault(undefined, "/v/a"), true);
  // 当前 vault 未知（尚未装载）而载荷带了标识：丢弃——宁可这一拍不显示，也不显示错的那个
  // vault（装载路径紧随其后会拉一次带标识的快照）
  assert.equal(inCurrentVault("/v/a", null), false);
  assert.equal(inCurrentVault(undefined, null), true);
  // 形态健壮性：非字符串一律当「没带标识」，不抛错打断事件流
  assert.equal(inCurrentVault(42, "/v/a"), true);
  assert.equal(inCurrentVault(null, "/v/a"), true);
});

test("事件解析保留信封字段：宽容入口不吞掉 vault 标识", () => {
  // 真后端发的是对象载荷
  const object = parseHarnessEvent({ type: "text_chunk", text: "x", vault: "/v/a" });
  assert.equal(object?.type, "text_chunk");
  assert.equal((object as { vault?: string } | null)?.vault, "/v/a");
  // 契约里的宽容入口：string 载荷先 JSON.parse 一次
  const text = parseHarnessEvent('{"type":"done","vault":"/v/b"}');
  assert.equal((text as { vault?: string } | null)?.vault, "/v/b");
  // 不认识的 type 仍返回 null（既有口径不变，信封字段不改变判别）
  assert.equal(parseHarnessEvent({ type: "unknown", vault: "/v/a" }), null);
});
