// 权限模式的纯模型层单测（M414，change add-harness-permission-modes 的前端批）：
//   - 档位读取（harnessPermissionMode：闭集合外取值 / 缺键 / 坏形状一律回落默认
//     `vault_write`——与后端 validate 同一条回落语义，界面读的是**生效档**）；
//   - 三档文案的三级读数（短名 D423–D425 / 全名 D427–D429 / 释义 D430–D432：zh/en
//     双档逐档非空，且三档互不相同——档名与释义混同就是把三个档位渲染成同一个）；
//   - 组合命令的呈现拆段（splitCommandSegments：连接符切行、长者优先、`join("")` 逐字符
//     等于原文的不变量——「呈现层不改内容」的判据）；
//   - 恢复路径的批准闸决定（restoredApprovalOutcome：M413 的 decision 字段优先，旧快照的
//     `status === "rejected"` 兜底——M406 遗留的「采纳看得见」那一半）。
// 合同：mission M414 任务 5.1 / `src/harness-panel.ts` 权限段与批准卡段的注释判词，
// design §7（文案分两级）与 §3.4（拆段是纯呈现层）。
// 这一层是零 DOM 环境（tests/unit/README.md）：只驱动 src/harness-panel.ts 导出的纯函数。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PERMISSION_MODES,
  formatArgv,
  harnessPermissionMode,
  humanizeToolArgs,
  permissionDescription,
  permissionFullName,
  permissionShortName,
  restoredApprovalOutcome,
  splitCommandSegments,
} from "../../src/harness-panel.ts";
import { setLanguageRoot } from "../../src/copy.ts";

/** 在给定语言下跑一段断言，结束后恢复语言读取口（默认无 DOM → 取 en 档）。 */
function inLanguage(lang: "zh" | "en", run: () => void): void {
  setLanguageRoot(() => ({ lang }));
  try {
    run();
  } finally {
    setLanguageRoot(undefined);
  }
}

// ── 档位读取（配置即数据：缺 key 不伪造「未知」，读生效档） ──

test("harnessPermissionMode：三档闭集合逐档直读", () => {
  assert.equal(harnessPermissionMode({ permission_mode: "read_only" }), "read_only");
  assert.equal(harnessPermissionMode({ permission_mode: "vault_write" }), "vault_write");
  assert.equal(harnessPermissionMode({ permission_mode: "full_access" }), "full_access");
});

test("harnessPermissionMode：闭集合外的取值回落默认档（与后端 validate 同一条回落）", () => {
  assert.equal(harnessPermissionMode({ permission_mode: "always_ask" }), "vault_write");
  assert.equal(harnessPermissionMode({ permission_mode: 3 }), "vault_write");
  assert.equal(harnessPermissionMode({ permission_mode: null }), "vault_write");
});

test("harnessPermissionMode：缺键 / 非对象输入回落默认档（不当成「未知」档渲染）", () => {
  assert.equal(harnessPermissionMode({}), "vault_write");
  assert.equal(harnessPermissionMode(null), "vault_write");
  assert.equal(harnessPermissionMode(undefined), "vault_write");
  assert.equal(harnessPermissionMode("vault_write"), "vault_write");
});

// ── 三档文案（短名 / 全名 / 释义：逐档非空且互不相同，两条语言都查） ──

test("三档文案：zh 档下短名 / 全名 / 释义逐档非空且互不相同", () => {
  inLanguage("zh", () => {
    const shorts = PERMISSION_MODES.map(permissionShortName);
    const fulls = PERMISSION_MODES.map(permissionFullName);
    const descs = PERMISSION_MODES.map(permissionDescription);
    for (const group of [shorts, fulls, descs]) {
      assert.equal(new Set(group).size, PERMISSION_MODES.length, `三档读数不得重复：${group.join(" / ")}`);
      for (const text of group) assert.notEqual(text.trim(), "", "读数不得为空串");
    }
    // design §7 的裁决口径：chip 短、浮层全名（短名是全名的截省形态，不是另一套命名）。
    assert.equal(shorts.join("/"), "只读/写入/完全");
    assert.equal(fulls.join("/"), "只读/保险库写入/完全访问");
  });
});

test("三档文案：en 档下短名 / 全名 / 释义逐档非空且互不相同", () => {
  inLanguage("en", () => {
    const shorts = PERMISSION_MODES.map(permissionShortName);
    const fulls = PERMISSION_MODES.map(permissionFullName);
    for (const group of [shorts, fulls]) {
      assert.equal(new Set(group).size, PERMISSION_MODES.length, `三档读数不得重复：${group.join(" / ")}`);
    }
    assert.equal(shorts.join("/"), "Read/Write/Full");
    assert.equal(fulls.join("/"), "Read Only/Vault Write/Full Access");
    for (const mode of PERMISSION_MODES) {
      assert.notEqual(permissionDescription(mode).trim(), "");
    }
  });
});

// ── 组合命令拆段（纯呈现层：连接符切行、内容零改动） ──

test("splitCommandSegments：无连接符的普通命令是单段（单行渲染，形态与拆段前一致）", () => {
  assert.deepEqual(splitCommandSegments("cat notes/a.md"), ["cat notes/a.md"]);
  assert.deepEqual(splitCommandSegments(""), [""]);
});

test("splitCommandSegments：`;` / `&&` / 管道各切一段，连接符起首其后每行", () => {
  assert.deepEqual(splitCommandSegments("a; b"), ["a", "; b"]);
  assert.deepEqual(splitCommandSegments("a && b"), ["a ", "&& b"]);
  assert.deepEqual(splitCommandSegments("a | b"), ["a ", "| b"]);
  assert.deepEqual(splitCommandSegments("a; b && c | d"), ["a", "; b ", "&& c ", "| d"]);
});

test("splitCommandSegments：`||` / `&&` 按最长连接符切（不劈成两个单字符连接符）", () => {
  assert.deepEqual(splitCommandSegments("a || b"), ["a ", "|| b"]);
  assert.deepEqual(splitCommandSegments("a &&& b"), ["a ", "&&", "& b"]);
});

test("splitCommandSegments：换行（含 CRLF）也是连接符（多行脚本逐行排开）", () => {
  assert.deepEqual(splitCommandSegments("a\nb"), ["a", "\nb"]);
  assert.deepEqual(splitCommandSegments("a\r\nb"), ["a", "\r\nb"]);
});

test("splitCommandSegments：不变量——join(\"\") 逐字符等于原文（拆段不改内容）", () => {
  const samples = [
    "cat a.md",
    "cd /tmp && rm -f x; ls | wc -l",
    "bash -c \"mkdir -p /tmp/a && mkdir -p /tmp/b\"",
    "python3 -c \"import os; print(os.getcwd())\"",
    "; leading",
    "a;;b",
    "",
  ];
  for (const sample of samples) {
    assert.equal(splitCommandSegments(sample).join(""), sample, `逐字符往返失真：${sample}`);
  }
});

test("splitCommandSegments：引号内的连接符同样拆（bash -c / python -c 的单参数复合命令）", () => {
  const argv = ["bash", "-c", "mkdir -p /tmp/a && mkdir -p /tmp/b"];
  const segments = splitCommandSegments(formatArgv(argv));
  assert.equal(segments.length, 2);
  assert.equal(segments.join(""), 'bash -c "mkdir -p /tmp/a && mkdir -p /tmp/b"');
  assert.match(segments[1], /^&& mkdir -p \/tmp\/b"$/);
});

// ── 恢复路径的批准闸决定（M413 decision 的消费判据） ──
test("restoredApprovalOutcome：decision 优先（approved / rejected 都认）", () => {
  assert.equal(restoredApprovalOutcome({ decision: "approved", status: "done" }), "approved");
  assert.equal(restoredApprovalOutcome({ decision: "rejected", status: "rejected" }), "rejected");
});

test("restoredApprovalOutcome：旧快照的 status 兜底（那条路径上拒绝是 status 而非 decision）", () => {
  assert.equal(restoredApprovalOutcome({ status: "rejected" }), "rejected");
});

test("restoredApprovalOutcome：未进过闸的记录返回 null（allow / deny / 失败行各走原判据）", () => {
  assert.equal(restoredApprovalOutcome({ status: "done" }), null);
  assert.equal(restoredApprovalOutcome({ status: "denied" }), null);
  assert.equal(restoredApprovalOutcome({ status: "error" }), null);
  assert.equal(restoredApprovalOutcome({}), null);
  assert.equal(restoredApprovalOutcome(null), null);
  assert.equal(restoredApprovalOutcome("tool"), null);
});

// ── 两件 vault 工具的行内参数（M414：面板呈现的读数源，tasks 3.2 / 3.3 的呈现半边） ──

test("humanizeToolArgs：vault_move 的行内参数 = 「源 → 目标」路径对", () => {
  assert.equal(
    humanizeToolArgs("vault_move", JSON.stringify({ path: "notes/a.md", new_path: "drafts/a.md" })),
    "notes/a.md → drafts/a.md",
  );
});

test("humanizeToolArgs：vault_move 缺任一段回落到原文（不伪造半条路径对）", () => {
  const half = JSON.stringify({ path: "notes/a.md" });
  assert.equal(humanizeToolArgs("vault_move", half), half);
  const empty = JSON.stringify({ path: "", new_path: "drafts/a.md" });
  assert.equal(humanizeToolArgs("vault_move", empty), empty);
});

test("humanizeToolArgs：vault_delete 的行内参数 = 路径；缺路径回落原文", () => {
  assert.equal(humanizeToolArgs("vault_delete", JSON.stringify({ path: "notes/a.md" })), "notes/a.md");
  assert.equal(humanizeToolArgs("vault_delete", JSON.stringify({})), "{}");
});
