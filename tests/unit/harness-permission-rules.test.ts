// 持久权限规则与两枚次级动作的前端模型层单测（change harness-permission-rules-oct23
// tasks 3.6 / 3.7 / 5.5）：
//   - 次级动作的**字段驱动**渲染判据（`approvalSecondaryActions`）：字段在场才渲染；
//     缺键 / null / 非字符串一律不渲染——M413 的「缺键按可见处理」契约按 D3 裁决翻转，
//     否则危险黑名单卡经快照恢复会复活两枚死按钮；
//   - 规则列表的宽容解析（`harnessPermissionRules`）：空表 / 错形状 → 空列表（浮层整段
//     不渲染），非字符串 / 空串逐项丢弃（与后端 `validate_harness_rules` 同口径）；
//   - 文案插值（D564 / D565 / D567）不留 `{…}` 占位符，且按钮文案把粒度 / 规则原文写出来
//     （授权面在按下前可见）；
//   - IPC 契约：删除走 `harness_permission_rule_remove`、批准带 `persist_rule`（后端单写者，
//     前端不做数组读改写）。
// 这一层是零 DOM 环境（tests/unit/README.md）：面板 DOM 的最终形态归真机验收场景
// （229 号场景）与视觉门禁，这里只钉纯判据与 IPC 形状。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approvalActionsFromPayload,
  approvalRememberText,
  approvalSecondaryActions,
  harnessPermissionRules,
} from "../../src/harness-panel.ts";
import { harnessApprove, harnessPermissionRuleRemove } from "../../src/ipc.ts";
import { setLanguageRoot, t } from "../../src/copy.ts";
import { installBackend } from "./harness.ts";

/** 在给定语言下跑一段断言，结束后恢复语言读取口（默认无 DOM → 取 en 档）。 */
function inLanguage(lang: "zh" | "en", run: () => void): void {
  setLanguageRoot(() => ({ lang }));
  try {
    run();
  } finally {
    setLanguageRoot(undefined);
  }
}

// ── 次级动作：字段是渲染的唯一开关 ──

test("approvalSecondaryActions：两个字段在场即各给一枚按钮的素材", () => {
  assert.deepEqual(
    approvalSecondaryActions({
      remember: "tvly search",
      persistRule: "cli(tvly search *)",
    }),
    { remember: "tvly search", persistRule: "cli(tvly search *)" },
  );
  // 只有会话记忆（vault_delete / cron_task_*：Q7 不给持久入口）。
  assert.deepEqual(approvalSecondaryActions({ remember: "notes/a.md" }), {
    remember: "notes/a.md",
    persistRule: undefined,
  });
});

test("approvalSecondaryActions：缺键 / null / 非字符串一律不渲染（D3 翻转后的缺键语义）", () => {
  // 危险黑名单卡的载荷：两项都缺席 ⇒ 两枚按钮都不建。
  assert.deepEqual(approvalSecondaryActions({}), {
    remember: undefined,
    persistRule: undefined,
  });
  // 旧载荷 / 旧前端形状（bool）不再被当成「可见」。
  assert.deepEqual(
    approvalSecondaryActions({ remember: true, persistRule: false } as unknown as {
      remember?: string;
      persistRule?: string;
    }),
    { remember: undefined, persistRule: undefined },
  );
  assert.deepEqual(approvalSecondaryActions({ remember: null as unknown as string }), {
    remember: undefined,
    persistRule: undefined,
  });
});

test("approvalActionsFromPayload：事件 / 快照 / 子运行三条通道同一条解析", () => {
  // 事件载荷（camelCase 的线格式里 remember 是字符串、persist_rule 是 snake_case）。
  assert.deepEqual(
    approvalActionsFromPayload({
      remember: "tvly search",
      persist_rule: "cli(tvly search *)",
    }),
    { remember: "tvly search", persistRule: "cli(tvly search *)" },
  );
  // 危险卡的事件 / 快照载荷：两个键都缺席 ⇒ 两项都 undefined（快照恢复不会复活死按钮）。
  const dangerousPayload: Record<string, unknown> = { id: "ap-1", tool: "bash" };
  assert.deepEqual(approvalActionsFromPayload(dangerousPayload), {
    remember: undefined,
    persistRule: undefined,
  });
  // 旧快照形状（M413 的 bool remember）：按「不渲染」处理。
  assert.deepEqual(approvalActionsFromPayload({ remember: true, persist_rule: null }), {
    remember: undefined,
    persistRule: undefined,
  });
});

// ── 文案：粒度 / 规则原文必须出现在按钮上，且不留占位符 ──

test("approvalRememberText：带粒度用 D565，空粒度回退 D434", () => {
  inLanguage("zh", () => {
    assert.equal(approvalRememberText("tvly search"), "采纳且本会话不再问（记住 tvly search）");
    assert.equal(approvalRememberText("  "), "采纳且本会话不再问");
  });
  inLanguage("en", () => {
    assert.equal(
      approvalRememberText("tvly search"),
      "Approve and don't ask again this session (remember tvly search)",
    );
    assert.equal(approvalRememberText(""), "Approve and don't ask again this session");
  });
});

test("新增文案：插值后无 {} 占位符残留，zh / en 都逐字带上规则原文", () => {
  const rule = "cli(tvly search *)";
  for (const lang of ["zh", "en"] as const) {
    inLanguage(lang, () => {
      const persist = t("D564", { rule });
      const remove = t("D567", { rule });
      const heading = t("D566");
      for (const text of [persist, remove, heading]) {
        assert.ok(!/\{[a-zA-Z_]+\}/.test(text), `${lang} 残留占位符：${text}`);
      }
      assert.ok(persist.includes(rule), `${lang} 持久规则按钮必须逐字显示规则原文`);
      assert.ok(remove.includes(rule), `${lang} 删除钮可访问名必须带规则原文`);
      assert.equal(heading.trim() === "", false);
    });
  }
});

// ── 规则列表的宽容解析（浮层「已记住的规则」段的数据面） ──

test("harnessPermissionRules：空表 / 错形状 → 空列表（浮层整段不渲染）", () => {
  assert.deepEqual(harnessPermissionRules(undefined), []);
  assert.deepEqual(harnessPermissionRules(null), []);
  assert.deepEqual(harnessPermissionRules({}), []);
  assert.deepEqual(harnessPermissionRules({ permissions: null }), []);
  assert.deepEqual(harnessPermissionRules({ permissions: { allow: "cli(x *)" } }), []);
  assert.deepEqual(harnessPermissionRules({ permissions: { allow: [] } }), []);
});

test("harnessPermissionRules：非字符串 / 空串逐项丢弃，其余按原顺序保留", () => {
  assert.deepEqual(
    harnessPermissionRules({
      permissions: {
        allow: ["cli(tvly search *)", 3, null, "  ", " vault_patch(notes/*) ", ""],
        deny: ["cli(rm *)"],
      },
    }),
    ["cli(tvly search *)", "vault_patch(notes/*)"],
  );
});

test("harnessPermissionRules：反例区分度——删掉最后一条规则后列表变空", () => {
  const one = { permissions: { allow: ["cli(tvly *)"] } };
  assert.deepEqual(harnessPermissionRules(one), ["cli(tvly *)"]);
  assert.deepEqual(harnessPermissionRules({ permissions: { allow: [] } }), []);
});

// ── IPC 契约：后端单写者 + 两个布尔透传 ──

test("harnessPermissionRuleRemove 走 harness_permission_rule_remove 且参数是规则原文", async () => {
  const backend = installBackend();
  backend.handle("harness_permission_rule_remove", () => true);
  assert.equal(await harnessPermissionRuleRemove("cli(tvly search *)"), true);
  assert.deepEqual(backend.argsOf("harness_permission_rule_remove"), [
    { rule: "cli(tvly search *)" },
  ]);
  assert.equal(backend.countOf("harness_permission_rule_remove"), 1);
});

test("harnessApprove 把 remember / persist_rule 两个布尔透传（缺省 = null）", async () => {
  const backend = installBackend();
  backend.handle("harness_approve", () => undefined);
  await harnessApprove("ap-1", true, undefined, true, true);
  await harnessApprove("ap-2", false, "不要", undefined, undefined);
  const [first, second] = backend.argsOf("harness_approve");
  assert.deepEqual(first, {
    request_id: "ap-1",
    approved: true,
    reason: null,
    remember: true,
    persist_rule: true,
  });
  assert.deepEqual(second, {
    request_id: "ap-2",
    approved: false,
    reason: "不要",
    remember: null,
    persist_rule: null,
  });
});
