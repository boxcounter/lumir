// 首启 tips / 默认 harness 的一次性资格（change add-first-run-onboarding-nov25）。
// 纯状态机单测：首个 applyVault 领取后，后续 vault 不得覆盖 / 继承；恢复收尾清 claim 后
// 也不得再被后续空态领回。竞态用「第一个 restore 未收尾、第二个空态先到」的调用序表达。

import assert from "node:assert/strict";
import { test } from "node:test";
import { createFirstRunClaim } from "../../src/first-run-claim.ts";

test("首个 vault 领取资格；第二个 vault 的 claim 被忽略，不覆盖首个", () => {
  const claim = createFirstRunClaim();
  assert.equal(claim.claim("vault-a"), true);
  assert.equal(claim.claim("vault-b"), false);
  assert.equal(claim.claimed, true);
  assert.equal(claim.matches("vault-a"), true);
  assert.equal(claim.matches("vault-b"), false);
});

test("消费后不再匹配（打开首个文档 / tips 出现一次）", () => {
  const claim = createFirstRunClaim();
  claim.claim("vault-a");
  claim.consume();
  assert.equal(claim.matches("vault-a"), false);
});

test("首个 applyVault 收尾清 claim；后续空 vault 即使先到也不继承", () => {
  const claim = createFirstRunClaim();
  claim.claim("vault-a");
  // 第二个 vault 的空态先到达（第一个 restore 还没收尾）：claim 仍指向 a，b 不匹配。
  assert.equal(claim.matches("vault-b"), false);
  claim.clear("vault-a");
  // 清掉之后，b 的空态才到达：claimed 仍为 true，claim 不会被 b 重新领取。
  assert.equal(claim.claim("vault-b"), false);
  assert.equal(claim.matches("vault-b"), false);
});

test("clear 只清匹配的 vaultId，不会误清新 claim", () => {
  const claim = createFirstRunClaim();
  claim.claim("vault-a");
  claim.clear("vault-b");
  assert.equal(claim.matches("vault-a"), true);
  claim.clear("vault-a");
  assert.equal(claim.matches("vault-a"), false);
});
